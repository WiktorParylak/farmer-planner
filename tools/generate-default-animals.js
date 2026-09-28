// Dev-time generator for `default-animals.json` (bundled base/vanilla FS25
// animal needs + production data). NOT used at runtime by the app — run
// manually whenever the game updates its animal definitions and the base
// data needs a refresh.
//
// Usage:
//   node tools/generate-default-animals.js "<path to FS25 install>\sdk\xmlDoku\character\animals.xml"
//
// Mirrors parseAnimalNeedsXml in renderer.js (same animals/animal/subType/
// input/output/key schema, same generic fillType-attribute-first production
// lookup), re-implemented with plain regex since this runs under plain Node
// (no browser DOM) rather than inside Electron's renderer process.

const fs = require('fs');
const path = require('path');

function getAttr(attrString, attrName) {
    const m = attrString.match(new RegExp(attrName + '\\s*=\\s*"([^"]*)"'));
    return m ? m[1] : null;
}

const OUTPUT_VALUE_ATTRS = ['value', 'literPerDay', 'numPerDay', 'literPerHour', 'kgPerDay'];
const OUTPUT_TAGS = { milk: 'MILK', wool: 'WOOL', egg: 'EGG', manure: 'MANURE', liquidmanure: 'LIQUIDMANURE' };

// Reads every <key ageMonth="" value=".../literPerDay=.../..."/> directly
// inside `body` (one curve's raw XML content).
function readKeys(body) {
    const keys = [];
    const keyRe = /<key\b([^>]*?)\/?>/gi;
    let m;
    while ((m = keyRe.exec(body))) {
        const attrs = m[1];
        const ageMonth = parseFloat(getAttr(attrs, 'ageMonth'));
        let value = NaN;
        for (const attr of OUTPUT_VALUE_ATTRS) {
            const raw = getAttr(attrs, attr);
            if (raw !== null) { value = parseFloat(raw); break; }
        }
        if (!isNaN(ageMonth) && !isNaN(value)) keys.push({ ageMonth, value });
    }
    return keys.sort((a, b) => a.ageMonth - b.ageMonth);
}

// Reads the (single) <tagName>...</tagName> or self-closing <tagName/>
// block directly under `body`, returning its opening-tag attrs + inner body.
function readChildBlock(body, tagName) {
    const re = new RegExp('<' + tagName + '\\b([^>]*?)(?:/>|>([\\s\\S]*?)</' + tagName + '>)', 'i');
    const m = body.match(re);
    if (!m) return null;
    return { attrs: m[1], body: m[2] || '' };
}

function readCurveOf(body, tagName) {
    const block = readChildBlock(body, tagName);
    return block ? readKeys(block.body) : [];
}

// Every direct-child element of <output>...</output>, in order, as
// { tagName, attrs, body }.
function readOutputChildren(outputBody) {
    const children = [];
    const re = /<(\w+)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let m;
    while ((m = re.exec(outputBody))) {
        children.push({ tagName: m[1].toLowerCase(), attrs: m[2], body: m[3] || '' });
    }
    return children;
}

function parseAnimalNeedsXml(xmlText) {
    if (!/<animals\b/i.test(xmlText)) return null;

    const needs = {};
    const subTypeRe = /<subType\b([^>]*?)>([\s\S]*?)<\/subType>/gi;
    let stMatch;
    while ((stMatch = subTypeRe.exec(xmlText))) {
        const subTypeAttrs = stMatch[1];
        const subTypeBody = stMatch[2];
        const subType = getAttr(subTypeAttrs, 'subType');
        if (!subType) continue;

        const inputBlock = readChildBlock(subTypeBody, 'input');
        if (!inputBlock) continue;

        const food = readCurveOf(inputBlock.body, 'food');
        const water = readCurveOf(inputBlock.body, 'water');
        const straw = readCurveOf(inputBlock.body, 'straw');
        if (!food.length && !water.length && !straw.length) continue;

        const entry = { food, water, straw };

        const outputBlock = readChildBlock(subTypeBody, 'output');
        if (outputBlock) {
            const production = {};
            readOutputChildren(outputBlock.body).forEach(child => {
                const fillType = getAttr(child.attrs, 'fillType') || getAttr(child.attrs, 'type') || OUTPUT_TAGS[child.tagName] || child.tagName.toUpperCase();
                if (!fillType || production[fillType]) return;
                const curve = readKeys(child.body);
                if (curve.length) production[fillType] = curve;
            });
            if (Object.keys(production).length > 0) entry.production = production;
        }

        needs[subType] = entry;
    }

    return Object.keys(needs).length > 0 ? needs : null;
}

function main() {
    const xmlPath = process.argv[2];
    if (!xmlPath || !fs.existsSync(xmlPath)) {
        console.error('Usage: node tools/generate-default-animals.js "<FS25 install>\\sdk\\xmlDoku\\character\\animals.xml"');
        process.exit(1);
    }

    const text = fs.readFileSync(xmlPath, 'utf-8');
    const needs = parseAnimalNeedsXml(text) || {};

    Object.keys(needs).sort().forEach(subType => {
        const prod = needs[subType].production ? Object.keys(needs[subType].production).join(', ') : '(none)';
        console.log(`${subType} — production: ${prod}`);
    });
    console.log(`\n${Object.keys(needs).length} animal subType(s) found.`);

    const outPath = path.join(__dirname, '..', 'data', 'default-animals.json');
    fs.writeFileSync(outPath, JSON.stringify(needs, null, 2) + '\n', 'utf-8');
    console.log(`Written to ${outPath}`);
}

main();
