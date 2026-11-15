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
// Money per animal by age, right under <subType> (AFC 1.2, as in the base game).
const AFC_EDITOR_PRICES = ['buyPrice', 'sellPrice', 'transportPrice'];

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

// -> [{ type, subType, curves: [{ id, group: 'input' | 'output' | 'price', tag,
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
            afcChildren(text, sub.innerStart, sub.innerEnd)
                .filter(e => AFC_EDITOR_PRICES.includes(e.tag) && e.innerEnd > e.innerStart)
                .forEach(el => {
                    const id = [subType, 'price', el.tag, ''].join('|');
                    if (seen[id]) return;
                    seen[id] = 1;
                    curves.push({
                        id, group: 'price', tag: el.tag, fillType: '',
                        keys: afcReadKeys(text, el.innerStart, el.innerEnd),
                        innerStart: el.innerStart, innerEnd: el.innerEnd
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

// ---------- the herd: what it eats, gives and earns ----------
// Feed category (feed.js FEED_CATEGORIES) -> the fill type its price comes from.
const AFC_FEED_PRICE_FILLTYPE = {
    GRASS: 'GRASS_WINDROW', HAY: 'DRYGRASS_WINDROW', SILAGE: 'SILAGE', STRAW: 'STRAW', MINERAL: 'MINERAL_FEED',
    PIG_BASE: 'MAIZE', GRAIN: 'WHEAT', PROTEIN: 'SOYBEAN', EARTH: 'POTATO', OAT: 'OAT'
};
// Outputs the ration's productionWeight doesn't touch (feed.js FEED_UNSCALED_OUTPUT).
const AFC_RATION_FREE_OUTPUT = ['MANURE', 'LIQUIDMANURE'];
const AFC_OUTPUT_TAG_FILLTYPE = { milk: 'MILK', manure: 'MANURE', liquidmanure: 'LIQUIDMANURE' };
const AFC_YEAR_MONTHS = 12;

// The fill type an output curve gives.
function afcCurveFillType(curve) {
    return curve.fillType || AFC_OUTPUT_TAG_FILLTYPE[curve.tag.toLowerCase()] || curve.tag.toUpperCase();
}

// A curve's value at an age, as the game reads it (renderer.js interpolateNeedCurve).
function afcCurveAt(keys, age) {
    if (!keys || !keys.length) return 0;
    if (age <= keys[0].ageMonth) return keys[0].value;
    for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        if (age <= b.ageMonth) return a.value + (b.ageMonth === a.ageMonth ? 0 : (age - a.ageMonth) / (b.ageMonth - a.ageMonth)) * (b.value - a.value);
    }
    return keys[keys.length - 1].value;
}

// A breed of afcParseAnimals as { food, water, straw, production: { FILLTYPE: keys } },
// the shape of the planner's ANIMAL_NEEDS_DATA. keysOf(curve) picks the keys
// (the file's, or the editor's).
function afcBreedCurves(breed, keysOf) {
    const out = { production: {}, prices: {} };
    breed.curves.forEach(c => {
        const keys = keysOf ? keysOf(c) : c.keys;
        if (c.group === 'input') out[c.tag] = keys;
        else if (c.group === 'price') out.prices[c.tag] = keys;
        else out.production[afcCurveFillType(c)] = keys;
    });
    return out;
}

// Price of one ration ingredient: its chosen fill types (average of the
// priced ones), else its category's. -> [price | null, fillType label]
function afcIngredientPrice(ing, prices) {
    const picks = (ing.fillTypes || []).filter(ft => prices[ft] != null);
    if (picks.length) return [picks.reduce((s, ft) => s + prices[ft], 0) / picks.length, picks.join('+')];
    const ft = AFC_FEED_PRICE_FILLTYPE[ing.category] || ing.category;
    return [prices[ft] != null ? prices[ft] : null, ft];
}

// What a herd eats and gives over its next month and year, and what that's
// worth. groups: [{ id, subType, numAnimals, age, efficiency (1 = full),
// ingredients: [{ category, pct, fillTypes? }] | null, absolute?,
// months?: [{ food, milk }] — EnhancedAnimalSystem's lactation factors for
// month 0..11 (food × food, every MILK output × milk; missing = 1) }];
// curvesOf(subType) -> afcBreedCurves shape or null; prices: { FILLTYPE: money
// per 1000 l } (missing = no price); scale: AFC's factor. The year counts each
// group one month older every month. Water is free; feed is priced by its
// ration's ingredients, straw as STRAW.
// -> { month, year, groups: [{ id, year }], skipped: [subType], unpriced: [FILLTYPE] };
// month / year: { food, water, straw, out, revenue, feedCost, profit,
// sellValue (the herd's sale price at the span's end) }
//    month / year: { food, water, straw, out: { FILLTYPE: l }, revenue, feedCost, profit }
function afcHerdEconomics(groups, curvesOf, prices, scale = 1) {
    prices = prices || {};
    const unpriced = new Set(), skipped = new Set();
    const empty = () => ({ food: 0, water: 0, straw: 0, out: {}, revenue: 0, feedCost: 0, profit: 0, sellValue: 0 });
    const add = (into, from) => {
        ['food', 'water', 'straw', 'revenue', 'feedCost', 'profit', 'sellValue'].forEach(k => { into[k] += from[k]; });
        Object.keys(from.out).forEach(ft => { into.out[ft] = (into.out[ft] || 0) + from.out[ft]; });
    };
    const total = { month: empty(), year: empty() };
    const perGroup = [];
    groups.forEach(g => {
        const cv = curvesOf(g.subType);
        if (!cv || !(g.numAnimals > 0)) { if (!cv) skipped.add(g.subType); return; }
        const eff = g.efficiency == null ? 1 : g.efficiency;
        const span = months => {
            const r = empty();
            for (let m = 0; m < months; m++) {
                const age = (g.age || 0) + m;
                const f = (g.months && g.months[m]) || {};
                ['food', 'water', 'straw'].forEach(k => {
                    r[k] += afcCurveAt(cv[k], age) * g.numAnimals * scale * (k === 'food' && f.food != null ? f.food : 1);
                });
                Object.keys(cv.production || {}).forEach(ft => {
                    const lact = /MILK/.test(ft) && f.milk != null ? f.milk : 1;
                    const l = afcCurveAt(cv.production[ft], age) * g.numAnimals * scale * lact * (AFC_RATION_FREE_OUTPUT.includes(ft) ? 1 : eff);
                    if (l > 0) r.out[ft] = (r.out[ft] || 0) + l;
                });
            }
            Object.keys(r.out).forEach(ft => {
                if (prices[ft] != null) r.revenue += r.out[ft] * prices[ft] / 1000;
                else unpriced.add(ft);
            });
            if (r.food > 0) {
                const ings = g.ingredients || [];
                const sum = g.absolute ? 100 : (ings.reduce((s, i) => s + (parseFloat(i.pct) || 0), 0) || 100);
                if (!ings.length) unpriced.add('FOOD');
                ings.forEach(i => {
                    const [price, ft] = afcIngredientPrice(i, prices);
                    const l = r.food * (parseFloat(i.pct) || 0) / sum;
                    if (price != null) r.feedCost += l * price / 1000;
                    else if (l > 0) unpriced.add(ft);
                });
            }
            if (r.straw > 0) {
                if (prices.STRAW != null) r.feedCost += r.straw * prices.STRAW / 1000;
                else unpriced.add('STRAW');
            }
            r.profit = r.revenue - r.feedCost;
            // What the group sells for at the end of the span (its sellPrice curve).
            const sell = cv.prices && cv.prices.sellPrice;
            if (sell && sell.length) r.sellValue = afcCurveAt(sell, (g.age || 0) + months) * g.numAnimals;
            return r;
        };
        const month = span(1), year = span(AFC_YEAR_MONTHS);
        add(total.month, month);
        add(total.year, year);
        perGroup.push({ id: g.id, year });
    });
    return { ...total, groups: perGroup, skipped: [...skipped], unpriced: [...unpriced] };
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
    AFC_EDITOR_MOD, AFC_EDITOR_ENTRY, AFC_EDITOR_INPUTS, AFC_EDITOR_PRICES,
    afcParseAnimals, afcApplyEdits, afcCleanKeys, afcSameKeys,
    afcCurveFillType, afcCurveAt, afcBreedCurves, afcHerdEconomics,
    afcReadZip, afcSaveZip, afcRestoreZip, afcBackupList
};
