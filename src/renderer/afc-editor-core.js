// AFC editor logic without the DOM (afc-editor.js is the view): reads the
// curves of AnimalFoodCalculator's xmls/animals.xml, writes changed curves
// back into the text, and saves the file into the mod's zip.
//
// Developer tool only (IS_DEV_BUILD). The one place the app writes into the
// game's mods folder: only FS25_AnimalFoodCalculator.zip, only its
// xmls/animals.xml, only with the game closed (the view checks), after a copy
// of the zip into Documents\Farmer Planner\backups\afc-mod\ (the last 5).
// The new zip is written next to the old one and replaces it only when every
// entry reads back with the right size and CRC and animals.xml is what was
// saved.
//
// Only the <key> lines of a changed curve are rewritten, so the rest of the
// file stays byte for byte as it was.
const fs = require('fs');
const path = require('path');
const { readZipDirectory, readZipEntry } = require('./mod-files');
const { writeFolderZip, readZipEntryChecked, zipEntryTarget, backupStamp } = require('./mod-library-core');

const AFC_EDITOR_MOD = 'FS25_AnimalFoodCalculator';
const AFC_EDITOR_ENTRY = 'xmls/animals.xml';
const AFC_EDITOR_BACKUPS_KEPT = 5;
const AFC_EDITOR_INPUTS = ['food', 'water', 'straw'];

function afcAttr(tag, name) {
    const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"'));
    return m ? m[1] : null;
}

// The elements of `text` (from `from` to `to`) one level down:
// [{ tag, attrs, start, innerStart, innerEnd, end }]. Self-closing ones have
// no inner part. Comments must already be blanked out.
function afcChildren(text, from, to) {
    const out = [];
    const open = /<([A-Za-z_][\w.-]*)\b([^>]*?)(\/?)>/g;
    open.lastIndex = from;
    let m;
    while ((m = open.exec(text)) && m.index < to) {
        const tag = m[1];
        const innerStart = m.index + m[0].length;
        if (m[3]) {
            out.push({ tag, attrs: m[2], start: m.index, innerStart, innerEnd: innerStart, end: innerStart });
            continue;
        }
        // The matching close tag, counting nested elements of the same name.
        const re = new RegExp('<(/?)' + tag + '\\b[^>]*?(/?)>', 'g');
        re.lastIndex = innerStart;
        let depth = 1, c;
        while (depth && (c = re.exec(text))) {
            if (c[1]) depth--;
            else if (!c[2]) depth++;
        }
        if (depth || !c || c.index > to) break;
        out.push({ tag, attrs: m[2], start: m.index, innerStart, innerEnd: c.index, end: c.index + c[0].length });
        open.lastIndex = c.index + c[0].length;
    }
    return out;
}

function afcReadKeys(text, from, to) {
    const keys = [];
    const re = /<key\b([^>]*)>/g;
    re.lastIndex = from;
    let m;
    while ((m = re.exec(text)) && m.index < to) {
        const ageMonth = parseFloat(afcAttr(m[1], 'ageMonth'));
        const value = parseFloat(afcAttr(m[1], 'value'));
        if (!isNaN(ageMonth) && !isNaN(value)) keys.push({ ageMonth, value });
    }
    return keys;
}

// -> [{ type, subType, curves: [{ id, group: 'input' | 'output', tag,
//       fillType, keys: [{ ageMonth, value }], innerStart, innerEnd }] }]
function afcParseAnimals(xml) {
    // Comments become spaces of the same length: offsets stay right.
    const text = xml.replace(/<!--[\s\S]*?-->/g, c => ' '.repeat(c.length));
    const breeds = [];
    const root = afcChildren(text, 0, text.length).find(e => e.tag === 'animals');
    if (!root) return breeds;
    afcChildren(text, root.innerStart, root.innerEnd).filter(e => e.tag === 'animal').forEach(animal => {
        const type = afcAttr(animal.attrs, 'type') || '';
        afcChildren(text, animal.innerStart, animal.innerEnd).filter(e => e.tag === 'subType').forEach(sub => {
            const subType = afcAttr(sub.attrs, 'subType') || afcAttr(sub.attrs, 'name');
            if (!subType) return;
            const curves = [];
            const seen = {};
            afcChildren(text, sub.innerStart, sub.innerEnd)
                .filter(e => e.tag === 'input' || e.tag === 'output')
                .forEach(group => {
                    afcChildren(text, group.innerStart, group.innerEnd).forEach(el => {
                        if (el.innerEnd === el.innerStart && !/<key\b/.test(text.slice(el.start, el.end))) {
                            // A self-closing curve has no keys to edit.
                            if (el.end === el.innerStart) return;
                        }
                        const fillType = afcAttr(el.attrs, 'fillType') || '';
                        let id = [subType, group.tag, el.tag, fillType].join('|');
                        seen[id] = (seen[id] || 0) + 1;
                        if (seen[id] > 1) id += '#' + seen[id];
                        curves.push({
                            id, group: group.tag, tag: el.tag, fillType,
                            keys: afcReadKeys(text, el.innerStart, el.innerEnd),
                            innerStart: el.innerStart, innerEnd: el.innerEnd
                        });
                    });
                });
            if (curves.length) breeds.push({ type, subType, curves });
        });
    });
    return breeds;
}

function afcFormatNumber(v) {
    return String(Math.round(v * 10000) / 10000);
}

// The new inside of a curve element, in the layout of the old one (line
// ending, indentation, "/>" or " />").
function afcCurveInner(oldInner, keys) {
    const nl = /\r\n/.test(oldInner) ? '\r\n' : '\n';
    const first = oldInner.match(/(^|\n)([ \t]*)<key\b[^>]*?( ?)\/>/);
    const closeIndent = (oldInner.match(/\n([ \t]*)$/) || [, ''])[1];
    const indent = first ? first[2] : closeIndent + '    ';
    const end = first ? first[3] + '/>' : ' />';
    if (!keys.length) return nl + closeIndent;
    return keys.map(k => nl + indent + `<key ageMonth="${afcFormatNumber(k.ageMonth)}" value="${afcFormatNumber(k.value)}"${end}`).join('') + nl + closeIndent;
}

function afcCleanKeys(keys) {
    const byAge = new Map();
    (keys || []).forEach(k => {
        const a = Number(k.ageMonth), v = Number(k.value);
        if (isFinite(a) && a >= 0 && isFinite(v) && v >= 0) byAge.set(a, v);
    });
    return [...byAge].sort((a, b) => a[0] - b[0]).map(([ageMonth, value]) => ({ ageMonth, value }));
}

function afcSameKeys(a, b) {
    return a.length === b.length && a.every((k, i) => k.ageMonth === b[i].ageMonth && Math.abs(k.value - b[i].value) < 1e-9);
}

// `edits`: { curveId: [{ ageMonth, value }] }. Curves not in the file are
// left out of the result's `skipped`; curves equal to the file's are ignored.
// -> { xml, changed: [ids], skipped: [ids] }
function afcApplyEdits(xml, edits) {
    const curves = new Map();
    afcParseAnimals(xml).forEach(b => b.curves.forEach(c => curves.set(c.id, c)));
    const changed = [], skipped = [];
    const todo = [];
    Object.keys(edits || {}).forEach(id => {
        const c = curves.get(id);
        if (!c) { skipped.push(id); return; }
        const keys = afcCleanKeys(edits[id]);
        if (afcSameKeys(keys, c.keys)) return;
        todo.push({ c, keys });
        changed.push(id);
    });
    todo.sort((a, b) => b.c.innerStart - a.c.innerStart);
    let out = xml;
    todo.forEach(({ c, keys }) => {
        out = out.slice(0, c.innerStart) + afcCurveInner(out.slice(c.innerStart, c.innerEnd), keys) + out.slice(c.innerEnd);
    });
    return { xml: out, changed, skipped };
}

// ---------- the zip ----------
function afcZipEntry(zipPath) {
    const entries = readZipDirectory(zipPath);
    const entry = entries && entries.get(AFC_EDITOR_ENTRY);
    if (!entry) throw Object.assign(new Error('No ' + AFC_EDITOR_ENTRY + ' in ' + zipPath), { code: 'AFC_NO_XML' });
    return { entries, entry };
}

// -> { xml, version } of the zip's animals.xml and modDesc.
function afcReadZip(zipPath) {
    const { entries, entry } = afcZipEntry(zipPath);
    const data = readZipEntry(zipPath, entry);
    if (!data) throw Object.assign(new Error('Unreadable ' + AFC_EDITOR_ENTRY), { code: 'AFC_NO_XML' });
    const desc = entries.get('moddesc.xml');
    const descXml = desc ? (readZipEntry(zipPath, desc) || '').toString('utf-8') : '';
    return { xml: data.toString('utf-8'), version: (descXml.match(/<version>\s*([^<]+?)\s*</) || [])[1] || '' };
}

function afcBackupList(backupDir) {
    try {
        return fs.readdirSync(backupDir).filter(f => /^FS25_AnimalFoodCalculator_.*\.zip$/.test(f)).sort().reverse()
            .map(f => path.join(backupDir, f));
    } catch { return []; }
}

function afcBackupZip(zipPath, backupDir) {
    fs.mkdirSync(backupDir, { recursive: true });
    let backup = path.join(backupDir, `${AFC_EDITOR_MOD}_${backupStamp()}.zip`);
    for (let n = 2; fs.existsSync(backup); n++) backup = path.join(backupDir, `${AFC_EDITOR_MOD}_${backupStamp()}_${n}.zip`);
    fs.copyFileSync(zipPath, backup);
    if (fs.statSync(backup).size !== fs.statSync(zipPath).size) throw Object.assign(new Error('Backup size mismatch'), { code: 'AFC_BACKUP' });
    afcBackupList(backupDir).slice(AFC_EDITOR_BACKUPS_KEPT).forEach(f => { try { fs.unlinkSync(f); } catch { /* in use */ } });
    return backup;
}

// Writes `xml` as the zip's animals.xml. The caller checks that the game is
// closed. -> path of the backup.
async function afcSaveZip(zipPath, xml, backupDir) {
    const { entries, entry } = afcZipEntry(zipPath);
    const newData = Buffer.from(xml, 'utf-8');
    const backup = afcBackupZip(zipPath, backupDir);
    const work = zipPath + '.fp-edit';
    const staged = zipPath + '.fp-new';
    const files = [...entries.values()].filter(e => !e.name.endsWith('/'));
    try {
        // Every file of the mod out of the zip, animals.xml replaced.
        await fs.promises.rm(work, { recursive: true, force: true });
        await fs.promises.mkdir(work, { recursive: true });
        const zip = await fs.promises.open(zipPath, 'r');
        try {
            for (const e of files) {
                const full = zipEntryTarget(work, e.name);
                await fs.promises.mkdir(path.dirname(full), { recursive: true });
                if (e === entry) { fs.writeFileSync(full, newData); continue; }
                const parts = [];
                await readZipEntryChecked(zipPath, zip, e, async chunk => { parts.push(chunk); }, null);
                fs.writeFileSync(full, Buffer.concat(parts));
            }
        } finally {
            await zip.close();
        }
        await writeFolderZip(work, files.map(e => e.name), staged, () => {});

        // Read back: the same files, the same data, the new animals.xml.
        const after = readZipDirectory(staged);
        if (!after || after.size !== files.length) throw Object.assign(new Error('Zip check failed'), { code: 'AFC_ZIP_CHECK' });
        const fh = await fs.promises.open(staged, 'r');
        try {
            for (const e of files) {
                const a = after.get(e.name.toLowerCase());
                if (!a) throw Object.assign(new Error('Missing ' + e.name), { code: 'AFC_ZIP_CHECK' });
                const parts = [];
                await readZipEntryChecked(staged, fh, a, async chunk => { parts.push(chunk); }, null);
                const data = Buffer.concat(parts);
                const ok = e === entry ? data.equals(newData) : (a.crc === e.crc && a.size === e.size);
                if (!ok) throw Object.assign(new Error('Changed ' + e.name), { code: 'AFC_ZIP_CHECK' });
            }
        } finally {
            await fh.close();
        }
        fs.renameSync(staged, zipPath);
    } catch (e) {
        await fs.promises.rm(staged, { force: true });
        throw e;
    } finally {
        await fs.promises.rm(work, { recursive: true, force: true });
    }
    return backup;
}

// Puts a backup back in place of the zip (after a backup of the current one).
function afcRestoreZip(zipPath, backupPath, backupDir) {
    afcZipEntry(backupPath);
    const current = fs.existsSync(zipPath) ? afcBackupZip(zipPath, backupDir) : null;
    const tmp = zipPath + '.fp-new';
    fs.copyFileSync(backupPath, tmp);
    if (fs.statSync(tmp).size !== fs.statSync(backupPath).size) {
        try { fs.unlinkSync(tmp); } catch { /* gone */ }
        throw Object.assign(new Error('Copy size mismatch'), { code: 'AFC_ZIP_CHECK' });
    }
    fs.renameSync(tmp, zipPath);
    return current;
}

module.exports = {
    AFC_EDITOR_MOD, AFC_EDITOR_ENTRY, AFC_EDITOR_INPUTS,
    afcParseAnimals, afcApplyEdits, afcCleanKeys, afcSameKeys,
    afcReadZip, afcSaveZip, afcRestoreZip, afcBackupList
};
