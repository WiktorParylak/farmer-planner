// Tramlines tool — the heavy work, in its own Node process (forked by
// tramlines.js with ELECTRON_RUN_AS_NODE), so an 8192² density map never
// freezes the window. Keeps the loaded save in memory and answers
// { id, op, args } messages with { id, ok, result | error }.
//
// Library entry = <name>.png (RGBA, cropped to the tramlines) + <name>.json
// { x, y, w, h, mapSize, px, source, createdAt }. A tramline pixel's RGB is
// the fruits value packed like a grleConverter PNG (R = bits 0-7, ...).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const core = require('./tramlines-core');

const FRUITS = 'densityMap_fruits.gdm';
const GROUND = 'densityMap_ground.gdm';
const BACKUP_DIR = 'farmer_planner_backup';
const KEEP_BACKUPS = 5;

function backupList(dir) {
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^densityMap_fruits_\d{8}_\d{6}\.gdm$/.test(f)).sort() : [];
}

let state = null;   // { saveDir, dim, channels, values, ground: { labels, fields } }

function fail(code, extra) {
    const e = new Error(code);
    e.code = code;
    if (extra) e.extra = extra;
    throw e;
}

function readEntry(jsonPath) {
    const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const png = core.decodePng(fs.readFileSync(jsonPath.replace(/\.json$/i, '.png')));
    return { meta, png };
}

function writeEntry(outDir, name, rgba, w, h, x, y, mapSize, source) {
    let px = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) px++;
    fs.mkdirSync(outDir, { recursive: true });
    const base = path.join(outDir, name);
    fs.writeFileSync(base + '.png', core.encodePngRgba(rgba, w, h));
    const meta = { x, y, w, h, mapSize, px, source: source || '', createdAt: new Date().toISOString() };
    fs.writeFileSync(base + '.json', JSON.stringify(meta, null, 2));
    return meta;
}

// RGBA of a whole-map-sized (or any) image -> entry cropped to its visible pixels.
function cropRgba(rgba, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
            if (rgba[row + x * 4 + 3]) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                y1 = y;
            }
        }
    }
    if (x1 < 0) return null;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const out = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
        const s = ((y0 + y) * w + x0) * 4;
        out.set(rgba.subarray(s, s + cw * 4), y * cw * 4);
    }
    return { x: x0, y: y0, w: cw, h: ch, rgba: out };
}

// ---------- masks ----------
// Fills polygons (pixel coords) into a mask over the bbox (even-odd, pixel centres).
function polygonMask(polys, bx, by, bw, bh) {
    const mask = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) {
        const yc = by + y + 0.5, xs = [];
        polys.forEach(P => {
            for (let i = 0; i < P.length; i++) {
                const [ax, ay] = P[i], [cx, cy] = P[(i + 1) % P.length];
                if ((ay <= yc) !== (cy <= yc)) xs.push(ax + (yc - ay) * (cx - ax) / (cy - ay));
            }
        });
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const from = Math.max(0, Math.ceil(xs[k] - 0.5 - bx)), to = Math.min(bw - 1, Math.floor(xs[k + 1] - 0.5 - bx));
            for (let x = from; x <= to; x++) mask[y * bw + x] = 1;
        }
    }
    return mask;
}

// Shrinks a mask by r px (square): keeps a pixel only if the whole
// (2r+1)² square around it is set. Separable: rows, then columns.
function erode(mask, w, h, r) {
    if (r <= 0) return mask;
    const tmp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        let x = 0;
        while (x < w) {
            if (!mask[y * w + x]) { x++; continue; }
            let e = x;
            while (e + 1 < w && mask[y * w + e + 1]) e++;
            for (let k = x + r; k <= e - r; k++) tmp[y * w + k] = 1;
            x = e + 1;
        }
    }
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
        let y = 0;
        while (y < h) {
            if (!tmp[y * w + x]) { y++; continue; }
            let e = y;
            while (e + 1 < h && tmp[(e + 1) * w + x]) e++;
            for (let k = y + r; k <= e - r; k++) out[k * w + x] = 1;
            y = e + 1;
        }
    }
    return out;
}

// ---------- ops ----------
const ops = {
    load({ saveDir }) {
        state = null;
        const d = fs.readFileSync(path.join(saveDir, FRUITS));
        const r = core.gdmDecode(d);
        state = { saveDir, dim: r.dim, channels: r.channels, values: r.values, ground: null };
        return { dim: r.dim, channels: r.channels };
    },

    unload() { state = null; return true; },

    pick({ x, y }) {
        if (!state) fail('TL_NOT_LOADED');
        x = Math.floor(x); y = Math.floor(y);
        if (x < 0 || y < 0 || x >= state.dim || y >= state.dim) return null;
        return state.values[y * state.dim + x];
    },

    // Viewport: (x0, y0) = map pixel at the canvas corner, scale = canvas px per
    // map px. Zoomed out, a canvas pixel shows its block's first pixel, or the
    // highlight colour if any pixel of the block has a picked colour.
    view({ x0, y0, scale, w, h, colors, highlight }) {
        if (!state) fail('TL_NOT_LOADED');
        const { dim, values } = state;
        const out = new Uint8ClampedArray(w * h * 4);
        const set = new Set(highlight ? colors || [] : []);
        const step = scale < 1 ? Math.ceil(1 / scale) : 1;
        for (let sy = 0; sy < h; sy++) {
            const my = Math.floor(y0 + sy / scale);
            for (let sx = 0; sx < w; sx++) {
                const mx = Math.floor(x0 + sx / scale);
                const o = (sy * w + sx) * 4;
                if (mx < 0 || my < 0 || mx >= dim || my >= dim) { out[o] = 24; out[o + 1] = 32; out[o + 2] = 28; out[o + 3] = 255; continue; }
                let v = values[my * dim + mx], hit = set.size && set.has(v);
                if (!hit && set.size && step > 1) {
                    const ye = Math.min(dim, my + step), xe = Math.min(dim, mx + step);
                    for (let yy = my; yy < ye && !hit; yy++) for (let xx = mx; xx < xe; xx++) if (set.has(values[yy * dim + xx])) { hit = true; break; }
                }
                if (hit) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 255; }
                else { out[o] = v & 255; out[o + 1] = (v >> 8) & 255; out[o + 2] = (v >> 16) & 255; }
                out[o + 3] = 255;
            }
        }
        return out;
    },

    // Fields from densityMap_ground: a field = a 4-connected area of non-zero
    // pixels (black = no soil; neighbouring fields are split by a black line).
    // The ground map may be coarser than fruits (whole multiple): labels stay
    // at its resolution. An edge band of `edge` fruits px is left out.
    groundFields({ minPx, edge }) {
        if (!state) fail('TL_NOT_LOADED');
        const g = core.gdmDecode(fs.readFileSync(path.join(state.saveDir, GROUND)));
        const gd = g.dim, cell = state.dim / gd;
        if (cell !== Math.floor(cell) || cell < 1) fail('TL_GROUND_SIZE');
        let mask = new Uint8Array(gd * gd);
        for (let i = 0; i < mask.length; i++) mask[i] = g.values[i] ? 1 : 0;
        g.values = null;
        mask = erode(mask, gd, gd, Math.ceil((edge || 0) / cell));
        // Two-pass labelling with union-find (4-neighbours).
        const lab = new Int32Array(gd * gd);
        const parent = [0];
        const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
        for (let y = 0; y < gd; y++) for (let x = 0; x < gd; x++) {
            const i = y * gd + x;
            if (!mask[i]) continue;
            const up = y ? lab[i - gd] : 0, left = x ? lab[i - 1] : 0;
            if (!up && !left) { parent.push(parent.length); lab[i] = parent.length - 1; }
            else if (up && left) {
                const a = find(up), b = find(left);
                lab[i] = Math.min(a, b);
                if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
            } else lab[i] = up || left;
        }
        mask = null;
        const area = new Map(), box = new Map();
        for (let i = 0; i < lab.length; i++) {
            if (!lab[i]) continue;
            const l = find(lab[i]);
            lab[i] = l;
            area.set(l, (area.get(l) || 0) + 1);
            const x = i % gd, y = (i / gd) | 0, b = box.get(l);
            if (!b) box.set(l, [x, y, x, y]);
            else { if (x < b[0]) b[0] = x; if (x > b[2]) b[2] = x; if (y < b[1]) b[1] = y; if (y > b[3]) b[3] = y; }
        }
        const fields = [];
        const keep = new Map();
        [...area.entries()].filter(([, a]) => a * cell * cell >= (minPx || 0)).forEach(([l, a]) => {
            const b = box.get(l);
            keep.set(l, fields.length + 1);
            fields.push({ label: fields.length + 1, bbox: [b[0] * cell, b[1] * cell, (b[2] + 1) * cell, (b[3] + 1) * cell], px: a * cell * cell });
        });
        if (fields.length > 65535) fail('TL_TOO_MANY');
        const labels = new Uint16Array(gd * gd);
        for (let i = 0; i < lab.length; i++) if (lab[i]) labels[i] = keep.get(lab[i]) || 0;
        state.ground = { labels, dim: gd, cell, fields };
        // Sorted in reading order (bands of 256 px), like program-sciezki.
        return fields.slice().sort((a, b) => Math.floor(a.bbox[1] / 256) - Math.floor(b.bbox[1] / 256) || a.bbox[0] - b.bbox[0]);
    },

    // Cuts tramlines into a library entry. area: { polys: [[[x,y],...],...] }
    // (map pixels) or { labels: [..] } (from groundFields). colors: values that
    // count as tramlines (empty = every pixel in the area).
    cut({ area, colors, edge, outDir, name }) {
        if (!state) fail('TL_NOT_LOADED');
        const { dim, values } = state;
        let bx, by, bw, bh, inArea;
        if (area.polys) {
            const xs = area.polys.flat().map(p => p[0]), ys = area.polys.flat().map(p => p[1]);
            bx = Math.max(0, Math.floor(Math.min(...xs))); by = Math.max(0, Math.floor(Math.min(...ys)));
            bw = Math.min(dim, Math.ceil(Math.max(...xs)) + 1) - bx; bh = Math.min(dim, Math.ceil(Math.max(...ys)) + 1) - by;
            if (bw <= 0 || bh <= 0) fail('TL_OUTSIDE');
            const m = erode(polygonMask(area.polys, bx, by, bw, bh), bw, bh, edge || 0);
            inArea = (x, y) => m[(y - by) * bw + (x - bx)];
        } else {
            const g = state.ground;
            if (!g) fail('TL_NOT_LOADED');
            const ids = new Set(area.labels);
            const boxes = g.fields.filter(f => ids.has(f.label)).map(f => f.bbox);
            if (!boxes.length) fail('TL_EMPTY');
            bx = Math.min(...boxes.map(b => b[0])); by = Math.min(...boxes.map(b => b[1]));
            bw = Math.max(...boxes.map(b => b[2])) - bx; bh = Math.max(...boxes.map(b => b[3])) - by;
            inArea = (x, y) => ids.has(g.labels[Math.floor(y / g.cell) * g.dim + Math.floor(x / g.cell)]);
        }
        const set = new Set(colors || []);
        const rgba = new Uint8Array(bw * bh * 4);
        for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
            if (!inArea(x, y)) continue;
            const v = values[y * dim + x];
            if (set.size && !set.has(v)) continue;
            const o = ((y - by) * bw + (x - bx)) * 4;
            rgba[o] = v & 255; rgba[o + 1] = (v >> 8) & 255; rgba[o + 2] = (v >> 16) & 255; rgba[o + 3] = 255;
        }
        const c = cropRgba(rgba, bw, bh);
        if (!c) fail('TL_EMPTY');
        return writeEntry(outDir, name, c.rgba, c.w, c.h, bx + c.x, by + c.y, dim, path.basename(state.saveDir));
    },

    // Pastes entries into a save's fruits map: backup, decode, overwrite the
    // pixels with alpha >= threshold, encode, verify, then replace the file.
    paste({ saveDir, entries, threshold, converter }) {
        const target = path.join(saveDir, FRUITS);
        const orig = fs.readFileSync(target);
        const backupDir = path.join(saveDir, BACKUP_DIR);
        fs.mkdirSync(backupDir, { recursive: true });
        const d = new Date(), p2 = n => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
        const backup = path.join(backupDir, `densityMap_fruits_${stamp}.gdm`);
        fs.writeFileSync(backup, orig);
        if (!fs.readFileSync(backup).equals(orig)) fail('TL_BACKUP');

        const { dim, values } = core.gdmDecode(orig);
        const counts = [];
        entries.forEach(file => {
            const { meta, png } = readEntry(file);
            if (meta.mapSize !== dim) fail('TL_SIZE', { name: path.basename(file, '.json'), size: meta.mapSize, dim });
            let n = 0;
            for (let y = 0; y < png.h; y++) {
                const my = meta.y + y;
                if (my < 0 || my >= dim) continue;
                for (let x = 0; x < png.w; x++) {
                    const mx = meta.x + x, o = (y * png.w + x) * 4;
                    if (mx < 0 || mx >= dim || png.rgba[o + 3] < threshold) continue;
                    values[my * dim + mx] = core.packRgb(png.rgba[o], png.rgba[o + 1], png.rgba[o + 2]);
                    n++;
                }
            }
            counts.push({ name: path.basename(file, '.json'), px: n });
        });

        const out = core.gdmEncode(values, orig);
        // Verify before anything in the save changes.
        const check = core.gdmDecode(out).values;
        for (let i = 0; i < values.length; i++) if (check[i] !== values[i]) fail('TL_VERIFY');
        const tmp = target + '.farmer_planner_tmp';
        fs.writeFileSync(tmp, out);
        if (converter) verifyWithConverter(converter, tmp, values, backupDir);
        fs.renameSync(tmp, target);
        if (state && path.resolve(state.saveDir) === path.resolve(saveDir)) { state.values = values; state.ground = null; }
        // Each backup is the whole map (tens of MB): keep the newest few.
        backupList(backupDir).slice(0, -KEEP_BACKUPS).forEach(f => fs.rmSync(path.join(backupDir, f), { force: true }));
        return { backup, counts };
    },

    // Puts the newest backup back.
    restore({ saveDir }) {
        const dir = path.join(saveDir, BACKUP_DIR);
        const list = backupList(dir);
        if (!list.length) fail('TL_NO_BACKUP');
        const last = path.join(dir, list[list.length - 1]);
        fs.copyFileSync(last, path.join(saveDir, FRUITS));
        if (state && path.resolve(state.saveDir) === path.resolve(saveDir)) state = null;
        return last;
    },

    // PNGs (program-sciezki library: whole-map RGBA, transparent outside the
    // tramlines) -> cropped entries.
    importPngs({ files, outDir }) {
        const done = [];
        files.forEach(file => {
            const png = core.decodePng(fs.readFileSync(file));
            const c = cropRgba(png.rgba, png.w, png.h);
            if (!c) return;
            const name = safeName(path.basename(file).replace(/\.png$/i, ''));
            writeEntry(outDir, name, c.rgba, c.w, c.h, c.x, c.y, png.w, path.basename(file));
            done.push(name);
        });
        return done;
    },

    // GIMP .xcf: every layer (not groups, not empty, not fully opaque) -> an entry.
    importXcf({ file, outDir }) {
        const d = fs.readFileSync(file);
        const x = core.xcfOpen(d);
        const done = [];
        x.layers.filter(l => !l.group).forEach(l => {
            const img = core.xcfLayerRgba(d, l);
            let opaque = true;
            for (let i = 3; i < img.rgba.length && opaque; i += 4) if (img.rgba[i] !== 255) opaque = false;
            if (opaque) return;
            const c = cropRgba(img.rgba, img.w, img.h);
            if (!c) return;
            const name = safeName(l.name);
            writeEntry(outDir, name, c.rgba, c.w, c.h, l.ox + c.x, l.oy + c.y, x.w, path.basename(file));
            done.push(name);
        });
        return done;
    },

    // Entry -> whole-map RGBA PNG (for GIMP or program-sciezki).
    exportFull({ entry, outPath }) {
        const { meta, png } = readEntry(entry);
        const dim = meta.mapSize;
        const full = new Uint8Array(dim * dim * 4);
        for (let y = 0; y < png.h; y++) {
            const my = meta.y + y;
            if (my < 0 || my >= dim) continue;
            const x0 = Math.max(0, meta.x), x1 = Math.min(dim, meta.x + png.w);
            if (x1 <= x0) continue;
            full.set(png.rgba.subarray((y * png.w + (x0 - meta.x)) * 4, (y * png.w + (x1 - meta.x)) * 4), (my * dim + x0) * 4);
        }
        fs.writeFileSync(outPath, core.encodePngRgba(full, dim, dim));
        return outPath;
    }
};

function safeName(s) {
    return String(s).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '') || 'field';
}

// Optional extra check with GIANTS grleConverter: its PNG of the new GDM must
// hold the same values (its reading = the game's).
function verifyWithConverter(exe, gdmPath, values, workDir) {
    const out = path.join(workDir, 'verify.png');
    try {
        execFileSync(exe, [gdmPath, '-out', out], { windowsHide: true, timeout: 120000 });
        const png = core.decodePng(fs.readFileSync(out));
        if (png.w * png.h !== values.length) fail('TL_VERIFY_CONVERTER');
        for (let i = 0; i < values.length; i++) {
            const v = png.grey ? png.rgba[i * 4] : core.packRgb(png.rgba[i * 4], png.rgba[i * 4 + 1], png.rgba[i * 4 + 2]);
            if (v !== (png.grey ? values[i] & 255 : values[i] & 0xffffff)) fail('TL_VERIFY_CONVERTER');
        }
    } catch (e) {
        try { fs.unlinkSync(gdmPath); } catch (_) { /* already gone */ }
        throw e.code ? e : Object.assign(new Error('TL_CONVERTER'), { code: 'TL_CONVERTER', extra: { msg: e.message } });
    } finally {
        try { fs.unlinkSync(out); } catch (_) { /* not written */ }
    }
}

process.on('message', msg => {
    const { id, op, args } = msg || {};
    try {
        if (!ops[op]) fail('TL_BAD_OP');
        const result = ops[op](args || {});
        process.send({ id, ok: true, result });
    } catch (e) {
        process.send({ id, ok: false, error: e.code || 'TL_ERROR', extra: e.extra || { msg: e.message } });
    }
});
