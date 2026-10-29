// Map scaling tool — the heavy work, in its own Node process (forked by
// map-scale.js with ELECTRON_RUN_AS_NODE). Answers { id, op, args } with
// { id, ok, result | error } and sends { progress } while a run goes.
// Never writes into the mods folder: originals are copied to
// <out>/backup/<stamp>/ and the scaled files go to <out>/scaled/<stamp>/,
// both keeping the mod's own paths (map/data/...).

const fs = require('fs');
const path = require('path');
const core = require('./map-scale-core');
const { openMod } = require('./savegame-soil');

const MAX_DIM = 32768;               // GDM / GRLE / PNG layers above this aren't offered
const LAYER_RE = /^(densitymap_[^/]*|infolayer_[^/]*)\.(gdm|grle|png)$/i;

let cancelled = false;

function fail(code, extra) {
    const e = new Error(code);
    e.code = code;
    if (extra) e.extra = extra;
    throw e;
}

// A path from a mod (zip entry, i3d / xml reference) as a clean relative path,
// or null when it is absolute or climbs out with "..": mods come from the
// internet, and these paths decide where the output is written.
function safeRel(rel) {
    if (typeof rel !== 'string' || !rel) return null;
    const p = path.posix.normalize(rel.replace(/\\/g, '/'));
    if (p.startsWith('/') || p === '..' || p.startsWith('../') || /^[a-z]:/i.test(p) || p.includes(':') || p.includes('\0')) return null;
    return p;
}

// `rel` joined to `root`, refusing anything that would land outside it.
function inside(root, rel) {
    const r = safeRel(rel);
    const dst = r && path.resolve(root, r);
    if (!dst || !dst.startsWith(path.resolve(root) + path.sep)) fail('MS_BAD_FILE');
    return dst;
}

function attr(tag, name) {
    const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"'));
    return m ? m[1] : null;
}

function readText(mod, rel) {
    const b = mod.read(rel);
    return b ? b.toString('utf-8') : null;
}

// modDesc.xml -> { title, config } when the mod is a map.
function mapOfMod(mod) {
    const desc = readText(mod, 'modDesc.xml');
    if (!desc) return null;
    const tag = (desc.match(/<map\b[^>]*\bconfigFilename="[^"]*"[^>]*>/) || [])[0];
    if (!tag) return null;
    const titleBlock = (desc.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const title = ((titleBlock.match(/<en>\s*(?:<!\[CDATA\[)?([^<\]]+)/) || [])[1] || '').trim();
    return { title, config: attr(tag, 'configFilename') };
}

const ops = {
    // Every map mod in the given folders: [{ dir, name, title, zip }].
    listMaps({ dirs }) {
        const seen = new Set(), out = [];
        (dirs || []).forEach(dir => {
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
            entries.forEach(e => {
                const zip = e.isFile() && /\.zip$/i.test(e.name);
                if (!zip && !e.isDirectory()) return;
                const name = zip ? e.name.slice(0, -4) : e.name;
                if (seen.has(name.toLowerCase())) return;
                let mod = null;
                try {
                    mod = openMod(dir, name);
                    const map = mod && mapOfMod(mod);
                    if (map) { seen.add(name.toLowerCase()); out.push({ dir, name, title: map.title || name, zip }); }
                } catch (err) { /* not a readable mod */ }
                finally { if (mod) mod.close(); }
            });
        });
        return out.sort((a, b) => a.title.localeCompare(b.title));
    },

    // The map's terrain and its scalable layer files.
    inspect({ dir, name }) {
        const mod = openMod(dir, name);
        if (!mod) fail('MS_NO_MOD');
        try {
            const map = mapOfMod(mod);
            if (!map) fail('MS_NO_MAP');
            const cfg = readText(mod, map.config) || '';
            const i3dRel = safeRel((cfg.match(/<filename>\s*([^<\s]+)\s*<\/filename>/) || [])[1] || '');
            const i3d = i3dRel && /\.i3d$/i.test(i3dRel) ? readText(mod, i3dRel) : null;
            if (!i3d) fail('MS_NO_I3D');
            const baseDir = path.posix.dirname(i3dRel);
            const terrain = (i3d.match(/<TerrainTransformGroup\b[^>]*>/) || [])[0] || '';
            const upp = parseFloat(attr(terrain, 'unitsPerPixel')) || 1;
            const demId = (attr(terrain, 'heightMapId') || '').match(/^\d+$/) ? attr(terrain, 'heightMapId') : null;
            const demTag = demId ? (i3d.match(new RegExp('<File\\b[^>]*\\bfileId="' + demId + '"[^>]*>')) || [])[0] : null;
            const demRel = (safeRel(demTag ? path.posix.join(baseDir, (attr(demTag, 'filename') || '').replace(/\\/g, '/')) : path.posix.join(baseDir, 'data/dem.png')) || '').toLowerCase();
            // Layers can sit anywhere under the map folder (data/, data/density/,
            // data/fieldGround/…); the height map is whatever the terrain names.
            const files = [];
            let demW = 0;
            mod.listAll(baseDir.toLowerCase() + '/').sort().forEach(low => {
                const base = path.posix.basename(low);
                const dem = low === demRel;
                if (!dem && !LAYER_RE.test(base)) return;
                const b = mod.read(low);
                if (!b) return;
                const out = safeRel(mod.realPath ? mod.realPath(low) : low);
                if (!out || !safeRel(low)) return;
                const name = path.posix.basename(out), kind = core.kindOf(base);
                let inf;
                try { inf = core.info(base, b); } catch (e) { files.push({ rel: low, out, name, kind, bytes: b.length, reason: 'format' }); return; }
                const grid = dem && inf.grid;
                if (dem) demW = inf.w;
                const w2 = grid ? (inf.w - 1) * 2 + 1 : inf.w * 2, h2 = grid ? (inf.h - 1) * 2 + 1 : inf.h * 2;
                const reason = Math.max(grid ? w2 - 1 : w2, grid ? h2 - 1 : h2) > MAX_DIM ? 'max' : (dem && !grid ? 'dem' : '');
                files.push({ rel: low, out, name, kind, dem, w: inf.w, h: inf.h, w2, h2, bytes: b.length, reason });
            });
            return { i3dRel, upp, demW, sizeM: demW ? (demW - 1) * upp : 0, files };
        } finally { mod.close(); }
    },

    cancel() { cancelled = true; return true; },

    // Copies the picked files to backup/<stamp>, scales them into scaled/<stamp>
    // and reads every result back. With dem.png the i3d's unitsPerPixel halves.
    async run({ dir, name, files, outRoot }) {
        cancelled = false;
        // The file list comes from the mod again, not from the window.
        const info = ops.inspect({ dir, name });
        const d = new Date(), p2 = n => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
        const backupDir = path.join(outRoot, 'backup', stamp), scaledDir = path.join(outRoot, 'scaled', stamp);
        const picked = info.files.filter(f => files.includes(f.rel) && !f.reason);
        if (!picked.length) fail('MS_NOTHING');
        const need = picked.reduce((s, f) => s + f.bytes * 5, 0);
        try {
            fs.mkdirSync(outRoot, { recursive: true });
            const st = fs.statfsSync(outRoot);
            if (st.bavail * st.bsize < need) fail('MS_DISK', { need: Math.ceil(need / 1e6) });
        } catch (e) { if (e.code === 'MS_DISK') throw e; }
        const mod = openMod(dir, name);
        if (!mod) fail('MS_NO_MOD');
        const done = [];
        try {
            for (let i = 0; i < picked.length; i++) {
                const f = picked[i];
                const send = frac => {
                    if (cancelled) fail('MS_CANCELLED');
                    process.send({ progress: { i, n: picked.length, name: f.name, frac } });
                };
                send(0);
                const src = mod.read(f.rel);
                if (!src) fail('MS_READ', { name: f.name });
                const bak = inside(backupDir, f.out), out = inside(scaledDir, f.out);
                fs.mkdirSync(path.dirname(bak), { recursive: true });
                fs.mkdirSync(path.dirname(out), { recursive: true });
                fs.writeFileSync(bak, src);
                const h = await core.scale(f.name, src, out, 2, send);
                send(1);
                if (await core.hashFile(f.name, fs.readFileSync(out)) !== h) fail('MS_VERIFY', { name: f.name });
                done.push({ name: f.name, out: f.out, w: f.w2, h: f.h2, bytes: fs.statSync(out).size });
            }
            let i3d = null;
            if (picked.some(f => f.dem)) {
                const text = mod.read(info.i3dRel).toString('utf-8');
                const tag = (text.match(/<TerrainTransformGroup\b[^>]*>/) || [])[0];
                const upp = parseFloat(attr(tag, 'unitsPerPixel')) || 1;
                const upp2 = upp / 2;
                const tag2 = /\bunitsPerPixel="/.test(tag) ? tag.replace(/\bunitsPerPixel="[^"]*"/, `unitsPerPixel="${upp2}"`) : tag.replace(/\s*(\/?)>$/, ` unitsPerPixel="${upp2}"$1>`);
                const bakI3d = inside(backupDir, info.i3dRel), outI3d = inside(scaledDir, info.i3dRel);
                fs.mkdirSync(path.dirname(bakI3d), { recursive: true });
                fs.writeFileSync(bakI3d, text);
                fs.mkdirSync(path.dirname(outI3d), { recursive: true });
                fs.writeFileSync(outI3d, text.replace(tag, tag2));
                i3d = { rel: info.i3dRel, from: upp, to: upp2 };
            }
            return { stamp, backupDir, scaledDir, files: done, i3d };
        } catch (e) {
            // Half a result is no use: leave nothing behind.
            [backupDir, scaledDir].forEach(p => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* gone */ } });
            throw e;
        } finally { mod.close(); }
    }
};

process.on('message', async msg => {
    const { id, op, args } = msg || {};
    try {
        if (!ops[op]) fail('MS_BAD_OP');
        const result = await ops[op](args || {});
        process.send({ id, ok: true, result });
    } catch (e) {
        process.send({ id, ok: false, error: e.code || 'MS_ERROR', extra: e.extra || { msg: e.message } });
    }
});
