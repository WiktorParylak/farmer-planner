// Dev-time generator for `default-crops.json` (bundled base/vanilla FS25 crop
// calendar). NOT used at runtime by the app — run manually whenever the game
// updates its foliage growth definitions and the base calendar needs a
// refresh.
//
// Usage:
//   node tools/generate-default-crops.js "<path to FS25 install>\data\foliage"
//
// It mirrors parseCropGrowthXml/buildCropsCalendarFromFiles in renderer.js
// (same fruitType/growth/seasonal/period/update/foliageState schema, same
// harvest-state detection rule, same fixed multi-transition-per-period growth
// walk), but re-implemented with plain regex instead of DOMParser, since this
// runs under plain Node (no browser DOM available) rather than inside
// Electron's renderer process.

const fs = require('fs');
const path = require('path');

const FS_PERIODS = ["EARLY_SPRING", "MID_SPRING", "LATE_SPRING", "EARLY_SUMMER", "MID_SUMMER", "LATE_SUMMER", "EARLY_AUTUMN", "MID_AUTUMN", "LATE_AUTUMN", "EARLY_WINTER", "MID_WINTER", "LATE_WINTER"];
const FS_PERIOD_TO_MONTH = ["MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER", "JANUARY", "FEBRUARY"];

function formatCropName(rawName) {
    return rawName
        .toLowerCase()
        .split(/[_\s]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function getAttr(attrString, attrName) {
    const m = attrString.match(new RegExp(attrName + '\\s*=\\s*"([^"]*)"'));
    return m ? m[1] : null;
}

function parseCropGrowthXml(xmlText) {
    const fruitTypeMatch = xmlText.match(/<fruitType\b([^>]*)>/i);
    if (!fruitTypeMatch) return null;
    const rawName = getAttr(fruitTypeMatch[1], 'name');
    if (!rawName) return null;

    const seasonalMatch = xmlText.match(/<seasonal\b([^>]*)>([\s\S]*?)<\/seasonal>/i);
    if (!seasonalMatch) return null;
    const seasonalAttrs = seasonalMatch[1];
    const seasonalBody = seasonalMatch[2];

    // Harvest-ready states: attribute-flagged, OR literally named
    // "harvestReady" (same fallback rule as parseCropGrowthXml in
    // renderer.js — some crops flag a player-action state instead).
    const harvestStateNames = new Set();
    const foliageStateRe = /<foliageState\b([^>]*?)\/?>/gi;
    let fsMatch;
    while ((fsMatch = foliageStateRe.exec(xmlText))) {
        const attrs = fsMatch[1];
        const n = getAttr(attrs, 'name');
        if (!n) continue;
        if (getAttr(attrs, 'isHarvestReady') === 'true') harvestStateNames.add(n);
        if (n === 'harvestReady') harvestStateNames.add(n);
    }
    if (harvestStateNames.size === 0) return null;

    const periodData = FS_PERIODS.map(() => ({ plantingAllowed: false, updates: [] }));
    const periodRe = /<period\b([^>]*?)(?:\/>|>([\s\S]*?)<\/period>)/gi;
    let pMatch;
    let hasInvisibleRule = false;
    while ((pMatch = periodRe.exec(seasonalBody))) {
        const attrs = pMatch[1];
        const inner = pMatch[2] || '';
        const idx = FS_PERIODS.indexOf(getAttr(attrs, 'name'));
        if (idx === -1) continue;
        periodData[idx].plantingAllowed = getAttr(attrs, 'plantingAllowed') === 'true';

        const updateRe = /<update\b([^>]*?)\/?>/gi;
        let uMatch;
        while ((uMatch = updateRe.exec(inner))) {
            const uAttrs = uMatch[1];
            const from = getAttr(uAttrs, 'startState');
            const to = getAttr(uAttrs, 'endState');
            if (from && to) {
                periodData[idx].updates.push({ from, to });
                if (from === 'invisible') hasInvisibleRule = true;
            }
        }
    }

    // Most annual crops sow into an "invisible" state (freshly tilled,
    // nothing visible yet). A few (e.g. rice, which never leaves standing
    // water bare) have no "invisible" state anywhere in their growth chain
    // at all — for those, fall back to the <seasonal initialState="..."> the
    // file itself declares as where a freshly planted crop starts.
    const sowStartState = hasInvisibleRule ? 'invisible' : (getAttr(seasonalAttrs, 'initialState') || 'invisible');

    const calendar = {};
    const harvestUntil = {};

    for (let sowIdx = 0; sowIdx < 12; sowIdx++) {
        if (!periodData[sowIdx].plantingAllowed) continue;

        let state = sowStartState;
        let harvestIdx = null;
        let firstStep = 0;

        // Crops grow once per period: as a period ends, a field takes one step by
        // that period's rules (the rules of one period are a table for every
        // state, not a chain), so a step shows from the next period on, and the
        // period it is sown in counts. Checked against the fields of real saves.
        for (let step = 0; step < 24; step++) {
            const idx = (sowIdx + step) % 12;
            const rule = periodData[idx].updates.find(u => u.from === state);
            if (!rule) continue;
            state = rule.to;
            if (harvestStateNames.has(state)) {
                harvestIdx = (idx + 1) % 12;
                firstStep = step + 1;
                break;
            }
        }

        if (harvestIdx !== null) {
            calendar[FS_PERIOD_TO_MONTH[sowIdx]] = FS_PERIOD_TO_MONTH[harvestIdx];
            // The last month it can be harvested: the one whose end takes it
            // out of the ready states. One that stays ready has no last month.
            for (let step = firstStep; step < firstStep + 12; step++) {
                const idx = (sowIdx + step) % 12;
                const rule = periodData[idx].updates.find(u => u.from === state);
                if (!rule) continue;
                state = rule.to;
                if (harvestStateNames.has(state)) continue;
                if (idx !== harvestIdx) harvestUntil[FS_PERIOD_TO_MONTH[sowIdx]] = FS_PERIOD_TO_MONTH[idx];
                break;
            }
        }
    }

    if (Object.keys(calendar).length === 0) return null;
    return { name: formatCropName(rawName), calendar, harvestUntil };
}

function walkXmlFiles(dir) {
    let results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results = results.concat(walkXmlFiles(full));
        else if (/\.xml$/i.test(entry.name)) results.push(full);
    }
    return results;
}

function main() {
    const foliageDir = process.argv[2];
    if (!foliageDir || !fs.existsSync(foliageDir)) {
        console.error('Usage: node tools/generate-default-crops.js "<FS25 install>\\data\\foliage"');
        process.exit(1);
    }

    const files = walkXmlFiles(foliageDir);
    const combined = {};
    const windows = {};
    const found = [];

    for (const file of files) {
        let text;
        try { text = fs.readFileSync(file, 'utf-8'); } catch (e) { continue; }
        const parsed = parseCropGrowthXml(text);
        if (parsed) {
            combined[parsed.name] = { ...(combined[parsed.name] || {}), ...parsed.calendar };
            if (Object.keys(parsed.harvestUntil).length) windows[parsed.name] = { ...(windows[parsed.name] || {}), ...parsed.harvestUntil };
            found.push(`${parsed.name} <- ${path.relative(foliageDir, file)}`);
        }
    }

    found.sort().forEach(l => console.log(l));
    console.log(`\n${Object.keys(combined).length} crop(s) found out of ${files.length} XML file(s) scanned.`);

    const outPath = path.join(__dirname, '..', 'data', 'default-crops.json');
    fs.writeFileSync(outPath, JSON.stringify(combined, null, 2) + '\n', 'utf-8');
    console.log(`Written to ${outPath}`);
    const windowsPath = path.join(__dirname, '..', 'data', 'default-harvest-windows.json');
    fs.writeFileSync(windowsPath, JSON.stringify(windows, null, 2) + '\n', 'utf-8');
    console.log(`Written to ${windowsPath}`);
}

main();
