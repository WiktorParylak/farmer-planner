// Mod manager logic, no DOM: mod libraries (one folder of mods each, like FSG
// Mod Assistant's collections), what is in them, what is wrong with them, how
// they compare with a savegame, switching the game between them and moving
// mods around. The view is mod-manager.js.
//
// Writing outside Farmer Planner's own folder, agreed with the user (2026-11-06):
//   - gameSettings.xml: only the directory/active attributes of
//     <modsDirectoryOverride>, with the game closed, after a copy of the file;
//   - the library folders themselves: copy, move, rename, install and delete
//     mods (delete = Recycle Bin, done by the caller through electron's shell).
// Savegames are only read.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readZipDirectory, readZipEntry } = require('./mod-files');

const LIBRARIES_FILE = 'mod-libraries.json';
const SETTINGS_BACKUPS_KEPT = 5;
const MODHUB_URL = 'https://jtsage.dev/modHubData25_combo.json';
const MODHUB_MAX_AGE_MS = 24 * 3600 * 1000;
const FS25_STEAM_URL = 'steam://rungameid/2300320';

// The game only loads mods whose name starts with a letter and has nothing but
// letters, digits and underscores.
const VALID_MOD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function sameDir(a, b) {
    if (!a || !b) return false;
    return path.resolve(a).replace(/[\\/]+$/, '').toLowerCase() === path.resolve(b).replace(/[\\/]+$/, '').toLowerCase();
}

// ---------- libraries file ----------
function readLibraries(dataDir) {
    try {
        const list = JSON.parse(fs.readFileSync(path.join(dataDir, LIBRARIES_FILE), 'utf-8'));
        return Array.isArray(list) ? list.filter(l => l && typeof l.dir === 'string' && l.id) : [];
    } catch { return []; }
}

function writeLibraries(dataDir, libs) {
    const file = path.join(dataDir, LIBRARIES_FILE);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(libs, null, 2));
    fs.renameSync(tmp, file);
}

function newLibraryId() {
    return 'lib_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

// Adds folders not on the list yet (by path). Returns how many were added.
function addLibraries(libs, entries) {
    let added = 0;
    entries.forEach(e => {
        if (!e.dir || libs.some(l => sameDir(l.dir, e.dir))) return;
        libs.push({ id: newLibraryId(), name: e.name || path.basename(e.dir), dir: e.dir, notes: e.notes || '' });
        added++;
    });
    return added;
}

// ---------- FSG Mod Assistant (one-time import) ----------
// %APPDATA%\FSModAssistant\config.json "modFolders" lists the collections; a
// collection's name is its folder name, its notes sit in col_notes.json under
// "col_" + md5(folder path).
const FSG_APP_DIRS = ['FSModAssistant', 'fsg-mod-assistant', 'FSG Mod Assistant'];

function readFsgCollections(appDataRoot) {
    for (const app of FSG_APP_DIRS) {
        const dir = path.join(appDataRoot, app);
        let cfg;
        try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8')); } catch { continue; }
        if (!Array.isArray(cfg.modFolders)) continue;
        let notes = {};
        try { notes = JSON.parse(fs.readFileSync(path.join(dir, 'col_notes.json'), 'utf-8')) || {}; } catch { notes = {}; }
        return cfg.modFolders.filter(p => typeof p === 'string' && isDir(p)).map(p => {
            const n = notes['col_' + crypto.createHash('md5').update(p).digest('hex')] || {};
            // FSG keeps FS22 collections in the same list.
            const game = n.notes_version === 22 ? 22 : 25;
            const text = [n.notes_tagline, n.notes_notes].filter(s => typeof s === 'string' && s.trim()).join('\n');
            return { dir: p, name: path.basename(p), notes: text, game };
        });
    }
    return [];
}

// ---------- modDesc ----------
function xmlText(s) {
    return String(s || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
        .trim();
}

function xmlTag(xml, tag) {
    const m = xml.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
    return m ? m[1] : null;
}

// <title><en>…</en><pl>…</pl></title> or plain <title>…</title> -> { en, pl, … }.
function localized(xml, tag) {
    const inner = xmlTag(xml, tag);
    if (inner == null) return {};
    const out = {};
    let any = false;
    inner.replace(/<([a-z]{2,3})\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, lang, text) => { out[lang.toLowerCase()] = xmlText(text); any = true; return m; });
    if (!any) out.en = xmlText(inner);
    return out;
}

function parseModDesc(xml) {
    const root = (xml.match(/<modDesc\b[^>]*>/i) || [''])[0];
    const desc = (root.match(/\bdescVersion\s*=\s*["'](\d+)["']/) || [])[1];
    return {
        title: localized(xml, 'title'),
        description: localized(xml, 'description'),
        version: xmlText(xmlTag(xml, 'version')),
        author: xmlText(xmlTag(xml, 'author')),
        iconFile: xmlText(xmlTag(xml, 'iconFilename')),
        descVersion: desc ? Number(desc) : null,
        multiplayer: /<multiplayer\b[^>]*supported\s*=\s*["']true["']/i.test(xml)
    };
}

function folderSize(dir) {
    let total = 0;
    try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) total += folderSize(p);
            else { try { total += fs.statSync(p).size; } catch { /* gone */ } }
        }
    } catch { /* unreadable */ }
    return total;
}

// One entry of a library folder (a .zip or a folder) -> mod record. Never throws.
function readModEntry(dir, fileName) {
    const full = path.join(dir, fileName);
    let st;
    try { st = fs.statSync(full); } catch { return null; }
    const isZip = st.isFile() && /\.zip$/i.test(fileName);
    if (!isZip && !st.isDirectory()) return null;
    const mod = {
        name: isZip ? fileName.slice(0, -4) : fileName,
        file: fileName,
        path: full,
        isZip,
        size: isZip ? st.size : 0,
        mtime: st.mtimeMs,
        title: {}, description: {}, version: '', author: '', iconFile: '', descVersion: null, multiplayer: false,
        hasModDesc: false, isPack: false, corrupt: false, problems: []
    };
    try {
        if (isZip) {
            const entries = readZipDirectory(full);
            if (!entries) { mod.corrupt = true; return mod; }
            const md = entries.get('moddesc.xml');
            if (md) {
                const buf = readZipEntry(full, md);
                if (buf) { Object.assign(mod, parseModDesc(buf.toString('utf8'))); mod.hasModDesc = true; }
                else mod.corrupt = true;
            } else {
                // A zip of zips: a mod pack downloaded in one file.
                mod.isPack = [...entries.keys()].some(k => k.endsWith('.zip'));
            }
        } else {
            mod.size = folderSize(full);
            const mdPath = path.join(full, 'modDesc.xml');
            if (fs.existsSync(mdPath)) { Object.assign(mod, parseModDesc(fs.readFileSync(mdPath, 'utf-8'))); mod.hasModDesc = true; }
        }
    } catch (e) {
        mod.corrupt = true;
    }
    return mod;
}

// Same file, same time, same size -> the record read last time.
const scanCache = new Map();

async function scanLibrary(dir, onProgress) {
    let names;
    try { names = fs.readdirSync(dir); } catch { return { mods: [], missing: true }; }
    const mods = [];
    for (let i = 0; i < names.length; i++) {
        const full = path.join(dir, names[i]);
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        const key = full.toLowerCase();
        const hit = scanCache.get(key);
        let mod;
        if (hit && hit.mtime === st.mtimeMs && (st.isDirectory() || hit.size === st.size)) mod = hit;
        else {
            mod = readModEntry(dir, names[i]);
            if (mod) scanCache.set(key, mod);
        }
        if (mod) mods.push({ ...mod, problems: [] });
        // Let the page breathe on a big folder.
        if (i % 25 === 24) {
            if (onProgress) onProgress(i + 1, names.length);
            await new Promise(r => setTimeout(r, 0));
        }
    }
    findProblems(mods);
    return { mods, missing: false };
}

// ---------- problems ----------
// "FS25_Tractor (1)", "FS25_Tractor - Copy", "FS25 Tractor" -> "FS25_Tractor".
function suggestModName(name) {
    let s = String(name)
        .replace(/\s*\(\d+\)\s*$/, '')
        .replace(/\s*-\s*(copy|kopia|kopie|копия)(\s*\(\d+\))?\s*$/i, '')
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_]/g, '');
    if (!s) s = 'Mod';
    if (!/^[A-Za-z]/.test(s)) s = 'FS25_' + s;
    return s;
}

function findProblems(mods) {
    const byName = new Map();
    mods.forEach(m => {
        m.problems = [];
        if (m.corrupt) m.problems.push('corrupt');
        else if (m.isPack) m.problems.push('pack');
        else if (!m.hasModDesc) m.problems.push('noModDesc');
        if (!VALID_MOD_NAME.test(m.name)) {
            m.problems.push(/\(\d+\)\s*$|-\s*(copy|kopia)/i.test(m.name) ? 'copyName' : 'badName');
            m.suggestedName = suggestModName(m.name);
        }
        if (!m.isZip && m.hasModDesc) m.problems.push('folder');
        if (m.hasModDesc && m.descVersion == null) m.problems.push('noDescVersion');
        const key = (m.suggestedName || m.name).toLowerCase();
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(m);
    });
    // The same mod twice: zip and folder, or "X.zip" next to "X (1).zip".
    byName.forEach(list => {
        if (list.length < 2) return;
        list.forEach(m => { m.problems.push('duplicate'); m.duplicateOf = list.filter(o => o !== m).map(o => o.file); });
    });
    return mods;
}

// A zip the player wants to add: is it something the game will load?
function checkModZip(zipPath) {
    const mod = readModEntry(path.dirname(zipPath), path.basename(zipPath));
    if (!mod || !mod.isZip) return { ok: false, reason: 'notZip' };
    findProblems([mod]);
    if (mod.corrupt) return { ok: false, reason: 'corrupt', mod };
    if (mod.isPack) return { ok: false, reason: 'pack', mod };
    if (!mod.hasModDesc) return { ok: false, reason: 'noModDesc', mod };
    return { ok: true, mod, rename: mod.suggestedName || null };
}

// ---------- savegame ----------
function readSaveMods(careerSavegamePath) {
    let xml;
    try { xml = fs.readFileSync(careerSavegamePath, 'utf-8'); } catch { return null; }
    return [...xml.matchAll(/<mod\b[^>]*>/g)].map(m => {
        const tag = m[0];
        const a = n => { const r = tag.match(new RegExp('\\b' + n + '\\s*=\\s*"([^"]*)"')); return r ? xmlText(r[1]) : ''; };
        return { name: a('modName'), title: a('title'), version: a('version'), required: a('required') !== 'false' };
    }).filter(m => m.name);
}

// DLCs are in the save's list too, but live in the game's pdlc folder.
function compareWithSave(mods, saveMods) {
    const lib = new Map(mods.map(m => [m.name.toLowerCase(), m]));
    const used = new Set();
    const missing = [], versionDiff = [];
    saveMods.forEach(s => {
        if (/^pdlc_/i.test(s.name)) return;
        const m = lib.get(s.name.toLowerCase());
        if (!m) { missing.push(s); return; }
        used.add(m);
        if (s.version && m.version && s.version !== m.version) versionDiff.push({ save: s, mod: m });
    });
    const unused = mods.filter(m => !used.has(m) && m.hasModDesc);
    return { missing, unused, versionDiff, used: used.size };
}

// ---------- gameSettings.xml ----------
function readOverride(gameDir) {
    try {
        const xml = fs.readFileSync(path.join(gameDir, 'gameSettings.xml'), 'utf-8');
        const tag = (xml.match(/<modsDirectoryOverride\b[^>]*>/) || [])[0];
        if (!tag) return { active: false, directory: '' };
        const attr = n => { const r = tag.match(new RegExp('\\b' + n + '\\s*=\\s*"([^"]*)"')); return r ? xmlText(r[1]) : ''; };
        return { active: attr('active') === 'true', directory: attr('directory') };
    } catch { return null; }
}

function xmlAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The new text of gameSettings.xml: only the override tag changes. `dir` null =
// back to the default <game>/mods folder (active="false", directory kept).
function withOverride(xml, dir) {
    const re = /<modsDirectoryOverride\b[^>]*?(\/?)>/;
    const m = xml.match(re);
    const setAttr = (tag, name, value) => {
        const r = new RegExp('(\\b' + name + '\\s*=\\s*")[^"]*(")');
        return r.test(tag) ? tag.replace(r, (all, a, b) => a + xmlAttr(value) + b) : tag.replace(/\s*(\/?)>$/, ` ${name}="${xmlAttr(value)}"$1>`);
    };
    if (m) {
        let tag = setAttr(m[0], 'active', dir ? 'true' : 'false');
        if (dir) tag = setAttr(tag, 'directory', dir);
        return xml.replace(m[0], tag);
    }
    if (!dir) return xml;
    if (!/<\/gameSettings>/.test(xml)) throw Object.assign(new Error('No </gameSettings>'), { code: 'MM_BAD_SETTINGS' });
    const indent = (xml.match(/\n([ \t]+)<\w/) || [, '    '])[1];
    return xml.replace(/(\s*)<\/gameSettings>/, `\n${indent}<modsDirectoryOverride active="true" directory="${xmlAttr(dir)}"/>$1</gameSettings>`);
}

function backupStamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Points the game at `dir` (null = its own mods folder). The caller checks that
// the game is closed. Returns the backup's path.
function setOverride(gameDir, dir, backupDir) {
    const file = path.join(gameDir, 'gameSettings.xml');
    const before = fs.readFileSync(file, 'utf-8');
    const after = withOverride(before, dir);

    fs.mkdirSync(backupDir, { recursive: true });
    let backup = path.join(backupDir, 'gameSettings_' + backupStamp() + '.xml');
    for (let n = 2; fs.existsSync(backup); n++) backup = path.join(backupDir, `gameSettings_${backupStamp()}_${n}.xml`);
    fs.copyFileSync(file, backup);
    const old = fs.readdirSync(backupDir).filter(f => /^gameSettings_.*\.xml$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - SETTINGS_BACKUPS_KEPT)).forEach(f => { try { fs.unlinkSync(path.join(backupDir, f)); } catch { /* in use */ } });

    if (after === before) return backup;
    const tmp = file + '.fp-tmp';
    fs.writeFileSync(tmp, after, 'utf-8');
    // Read it back before it replaces the real file: the override says what it
    // should, and nothing outside the tag moved.
    const written = fs.readFileSync(tmp, 'utf-8');
    const tag = (written.match(/<modsDirectoryOverride\b[^>]*>/) || [''])[0];
    const attr = n => { const r = tag.match(new RegExp('\\b' + n + '\\s*=\\s*"([^"]*)"')); return r ? xmlText(r[1]) : ''; };
    const strip = s => s.replace(/\s*<modsDirectoryOverride\b[^>]*>/, '');
    const ok = written === after && strip(written) === strip(before)
        && (dir ? attr('active') === 'true' && attr('directory') === dir : !tag || attr('active') === 'false');
    if (!ok) {
        try { fs.unlinkSync(tmp); } catch { /* gone */ }
        throw Object.assign(new Error('gameSettings.xml check failed'), { code: 'MM_WRITE_CHECK' });
    }
    fs.renameSync(tmp, file);
    return backup;
}

// ---------- files ----------
// Copies a mod (zip or folder) into `destDir`. onProgress(bytesDone, bytesTotal).
async function copyMod(src, destDir, destName, onProgress) {
    const dest = path.join(destDir, destName || path.basename(src));
    const st = fs.statSync(src);
    if (st.isDirectory()) {
        await fs.promises.cp(src, dest, { recursive: true, force: true });
        if (onProgress) onProgress(1, 1);
        return dest;
    }
    const tmp = dest + '.fp-part';
    await new Promise((resolve, reject) => {
        let done = 0;
        const rd = fs.createReadStream(src);
        const wr = fs.createWriteStream(tmp);
        rd.on('data', chunk => { done += chunk.length; if (onProgress) onProgress(done, st.size); });
        rd.on('error', reject);
        wr.on('error', reject);
        wr.on('finish', resolve);
        rd.pipe(wr);
    }).catch(e => { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; });
    if (fs.statSync(tmp).size !== st.size) {
        try { fs.unlinkSync(tmp); } catch { /* gone */ }
        throw Object.assign(new Error('Size mismatch'), { code: 'MM_COPY_CHECK' });
    }
    await fs.promises.rm(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    return dest;
}

// Rename in place when on the same drive; otherwise copy, then hand the
// original to `trash` (the Recycle Bin, from the caller).
async function moveMod(src, destDir, destName, trash, onProgress) {
    const dest = path.join(destDir, destName || path.basename(src));
    if (fs.existsSync(dest)) await trash(dest);
    try {
        fs.renameSync(src, dest);
        if (onProgress) onProgress(1, 1);
        return dest;
    } catch (e) {
        if (e.code !== 'EXDEV') throw e;
    }
    await copyMod(src, destDir, destName, onProgress);
    await trash(src);
    return dest;
}

function renameMod(mod, newName) {
    if (!VALID_MOD_NAME.test(newName)) throw Object.assign(new Error('Bad name'), { code: 'MM_BAD_NAME' });
    const dest = path.join(path.dirname(mod.path), newName + (mod.isZip ? '.zip' : ''));
    if (fs.existsSync(dest) && !sameDir(dest, mod.path)) throw Object.assign(new Error('Exists'), { code: 'MM_EXISTS', extra: { name: path.basename(dest) } });
    fs.renameSync(mod.path, dest);
    return dest;
}

// ---------- icons ----------
// The icon file's bytes (DDS, sometimes PNG) or null. modDesc names a .png
// that ships as .dds; the game swaps the extension the same way.
function readModIcon(mod) {
    if (!mod.iconFile) return null;
    const rel = mod.iconFile.replace(/\\/g, '/').replace(/^\.?\//, '');
    const tries = [rel, rel.replace(/\.png$/i, '.dds'), rel.replace(/\.dds$/i, '.png')];
    try {
        if (mod.isZip) {
            const entries = readZipDirectory(mod.path);
            if (!entries) return null;
            for (const r of tries) {
                const e = entries.get(r.toLowerCase());
                if (e) return readZipEntry(mod.path, e);
            }
        } else {
            for (const r of tries) {
                const p = path.join(mod.path, r);
                if (fs.existsSync(p)) return fs.readFileSync(p);
            }
        }
    } catch { /* unreadable */ }
    return null;
}

function iconCacheName(mod) {
    return crypto.createHash('md5').update(mod.path.toLowerCase() + '|' + mod.mtime + '|' + mod.size).digest('hex') + '.png';
}

// ---------- ModHub ----------
// FSG Mod Assistant's list of ModHub mods (jtsage.dev, rebuilt daily):
// { mods: { "FS25_Name": "<id>" }, version: { "<id>": "1.0.0.0" } }.
// Only the ModHub list is fetched. ModHub's zips are downloaded by the player
// on the mod's page in their browser (the Giants CDN refuses anything else);
// mod-manager.js then picks the zip up from Downloads.
const ALLOWED_HOSTS = /(^|\.)jtsage\.dev$/i;

// GET over https, following redirects -> Buffer.
function httpGet(url, redirects = 5) {
    return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(url); } catch (e) { reject(Object.assign(e, { code: 'MM_MODHUB_NET' })); return; }
        if (u.protocol !== 'https:' || !ALLOWED_HOSTS.test(u.hostname)) {
            reject(Object.assign(new Error('Host not allowed: ' + u.hostname), { code: 'MM_MODHUB_NET' }));
            return;
        }
        const req = require('https').get(u, { headers: { 'User-Agent': 'FarmerPlanner', 'Cache-Control': 'no-cache' }, timeout: 30000 }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
                res.resume();
                httpGet(new URL(res.headers.location, u).href, redirects - 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) { res.resume(); reject(Object.assign(new Error('HTTP ' + res.statusCode), { code: 'MM_MODHUB_HTTP' })); return; }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', e => reject(Object.assign(e, { code: 'MM_MODHUB_NET' })));
        });
        req.on('timeout', () => req.destroy(Object.assign(new Error('Timeout'), { code: 'MM_MODHUB_NET' })));
        req.on('error', e => reject(Object.assign(e, { code: e.code && String(e.code).startsWith('MM_') ? e.code : 'MM_MODHUB_NET' })));
    });
}

async function fetchJson(url) {
    const buf = await httpGet(url);
    try { return JSON.parse(buf.toString('utf8')); }
    catch (e) { throw Object.assign(e, { code: 'MM_MODHUB_DATA' }); }
}


async function loadModHub(cacheFile, force) {
    try {
        const st = fs.statSync(cacheFile);
        if (!force && Date.now() - st.mtimeMs < MODHUB_MAX_AGE_MS) return { ...JSON.parse(fs.readFileSync(cacheFile, 'utf-8')), fetchedAt: st.mtimeMs };
    } catch { /* no cache yet */ }
    const data = await fetchJson(MODHUB_URL);
    if (!data || typeof data.mods !== 'object' || typeof data.version !== 'object') throw Object.assign(new Error('Bad data'), { code: 'MM_MODHUB_DATA' });
    const slim = { mods: data.mods, version: data.version };
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(slim));
    return { ...slim, fetchedAt: Date.now() };
}

// "1.0.0.10" > "1.0.0.9". Missing parts count as 0.
function compareVersions(a, b) {
    const pa = String(a || '').split(/[^\d]+/).filter(Boolean).map(Number);
    const pb = String(b || '').split(/[^\d]+/).filter(Boolean).map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d > 0 ? 1 : -1;
    }
    return 0;
}

function modHubInfo(mod, hub) {
    if (!hub || !hub.mods) return null;
    const id = hub.mods[mod.name];
    if (!id) return null;
    const latest = hub.version[id] || '';
    return {
        id,
        latest,
        url: 'https://www.farming-simulator.com/mod.php?mod_id=' + id,
        newer: !!(latest && mod.version && compareVersions(latest, mod.version) > 0)
    };
}

// The browser saved "<Mod>.zip" (or "<Mod> (1).zip" next to an older one) in
// `dir` after `sinceMs`, complete: the newest such file whose zip directory
// reads, or null while it is still coming.
function findDownloadedZip(dir, modName, sinceMs) {
    const re = new RegExp('^' + modName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( \\(\\d+\\))?\\.zip$', 'i');
    let best = null;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return null; }
    names.filter(n => re.test(n)).forEach(n => {
        const p = path.join(dir, n);
        try {
            const st = fs.statSync(p);
            if (st.mtimeMs < sinceMs - 2000 || !st.size) return;
            if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs, size: st.size };
        } catch { /* gone */ }
    });
    if (!best) return null;
    try { if (!readZipDirectory(best.path)) return null; } catch { return null; }
    return best;
}

// Puts `zipPath` (a new version of `mod`) in the mod's place; the old copy
// goes to `trash`. Nothing is replaced unless the zip is a mod, has the same
// name and isn't older. The zip itself is copied, not moved.
async function replaceModWithZip(mod, zipPath, trash) {
    const check = checkModZip(zipPath);
    if (!check.ok) throw Object.assign(new Error(check.reason), { code: 'MM_HUB_MISMATCH' });
    if (check.mod.version && mod.version && compareVersions(check.mod.version, mod.version) < 0) {
        throw Object.assign(new Error(check.mod.version + ' < ' + mod.version), { code: 'MM_HUB_MISMATCH' });
    }
    const libDir = path.dirname(mod.path);
    const dest = path.join(libDir, mod.name + '.zip');
    // The new zip lands next to the old one first, so a failed copy
    // leaves the library as it was.
    const staged = await copyMod(zipPath, libDir, mod.name + '.zip.fp-new');
    let oldGone = false;
    try {
        // The old copy (a zip, or an unzipped folder of the same mod).
        await trash(mod.path);
        oldGone = true;
        if (fs.existsSync(dest)) await trash(dest);
        fs.renameSync(staged, dest);
    } catch (e) {
        // Once the old one is in the Recycle Bin the new one stays, to be renamed by hand.
        if (!oldGone) { try { fs.unlinkSync(staged); } catch { /* gone */ } }
        throw e;
    }
    return { version: check.mod.version, path: dest };
}

module.exports = {
    VALID_MOD_NAME, FS25_STEAM_URL,
    sameDir, readLibraries, writeLibraries, addLibraries, newLibraryId, readFsgCollections,
    parseModDesc, readModEntry, scanLibrary, findProblems, suggestModName, checkModZip,
    readSaveMods, compareWithSave,
    readOverride, withOverride, setOverride,
    copyMod, moveMod, renameMod,
    readModIcon, iconCacheName,
    loadModHub, compareVersions, modHubInfo,
    findDownloadedZip, replaceModWithZip
};
