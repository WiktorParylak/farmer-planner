// Dev-time generator for `data/default-agronomy.json`: per crop, the base
// game's seed rate, harvest yield and straw from each fruitType XML, in
// litres per hectare (litersPerSqm × 10000). NOT used at runtime — run it when
// the game updates its foliage definitions.
//
// Usage:
//   node tools/generate-default-agronomy.js "<path to FS25 install>\data\foliage"
//
// Same attributes as cropAgronomyFromXml in renderer.js (which reads a map's
// own crop files at runtime), re-implemented with regex for plain Node:
//   <seeding litersPerSqm>              -> seed
//   <harvest litersPerSqm>              -> yield
//   <windrow fillType="straw" litersPerSqm> -> straw

const fs = require('fs');
const path = require('path');

function formatCropName(rawName) {
    return String(rawName || '')
        .replace(/[^\p{L}\p{N}_\s-]/gu, '')
        .toLowerCase()
        .split(/[_\s]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function attr(tag, name) {
    const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"'));
    return m ? m[1] : null;
}

function agronomy(xml) {
    const fruit = (xml.match(/<fruitType\b[^>]*>/) || [''])[0];
    const name = attr(fruit, 'name');
    if (!name) return null;
    const perHa = tag => {
        const v = parseFloat(attr(tag, 'litersPerSqm'));
        return v > 0 ? Math.round(v * 10000) : null;
    };
    const seeding = (xml.match(/<seeding\b[^>]*>/) || [''])[0];
    const harvest = (xml.match(/<harvest\b[^>]*>/) || [''])[0];
    const windrow = (xml.match(/<windrow\b[^>]*>/) || [''])[0];
    const out = {};
    if (perHa(seeding)) out.seed = perHa(seeding);
    if (perHa(harvest)) out.yield = perHa(harvest);
    if (windrow && /straw/i.test(attr(windrow, 'fillType') || '') && perHa(windrow)) out.straw = perHa(windrow);
    return Object.keys(out).length ? { name: formatCropName(name).replace(/\s+/g, ''), data: out } : null;
}

function walk(dir, files) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p, files);
        else if (entry.name.toLowerCase().endsWith('.xml')) files.push(p);
    }
    return files;
}

const root = process.argv[2];
if (!root || !fs.existsSync(root)) {
    console.error('Usage: node tools/generate-default-agronomy.js "<FS25>\\data\\foliage"');
    process.exit(1);
}
const result = {};
walk(root, []).forEach(file => {
    const a = agronomy(fs.readFileSync(file, 'utf-8'));
    if (a && !result[a.name]) result[a.name] = a.data;
});
const sorted = Object.fromEntries(Object.keys(result).sort().map(k => [k, result[k]]));
const out = path.join(__dirname, '..', 'data', 'default-agronomy.json');
fs.writeFileSync(out, JSON.stringify(sorted, null, 2) + '\n');
console.log(`Wrote ${Object.keys(sorted).length} crops to ${out}`);
