// The crops a farm's map actually offers, in the order the game lists them,
// read straight from the map mod — no folder import needed:
//   careerSavegame.xml <mapId>   "FS25_Solek.SampleModMap" -> mods/FS25_Solek(.zip)
//   modDesc.xml <map configFilename>  -> map config (mapUS.xml / map.xml)
//   map config <fruitTypes filename>  -> the map's fruitTypes list
//   each <fruitType filename>         -> that crop's growth XML
// The game loads the base crops first and the map's list after (re-declared
// base crops keep their slot), unless the map replaces the base list — see
// replacesBase. "$data/..." entries are base-game crops; their growth
// data lives in the game archives, so the caller fills them from the bundled
// default calendar instead.
const path = require('path');
const { openMod } = require('./savegame-soil');
const { locateMod } = require('./mod-locator');

function attr(tag, name) {
    const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"'));
    return m ? m[1] : null;
}

// Strips XML comments so commented-out <fruitType> lines don't count.
function stripComments(xml) {
    return xml.replace(/<!--[\s\S]*?-->/g, '');
}

// parseGrowthXml(text) -> { name, calendar } | null  (renderer's parseCropGrowthXml)
// formatName(raw) -> crop key as the rest of the app uses it
function readMapCrops(careerSavegamePath, parseGrowthXml, formatName) {
    let mod = null;
    try {
        if (!careerSavegamePath) return { ok: false, reason: 'nosave' };
        const fs = require('fs');
        if (!fs.existsSync(careerSavegamePath)) return { ok: false, reason: 'nosave' };
        const career = fs.readFileSync(careerSavegamePath, 'utf-8');
        const mapId = (career.match(/<mapId>([^<]+)<\/mapId>/) || [])[1];
        // Base-game maps ("MapUS", "MapEU"…) have no dot and use the base list.
        if (!mapId || mapId.indexOf('.') < 0) return { ok: false, reason: 'basemap' };

        const modName = mapId.split('.')[0];
        const modsDir = locateMod(careerSavegamePath, modName);
        mod = modsDir ? openMod(modsDir, modName) : null;
        if (!mod) return { ok: false, reason: 'nomod', modName };

        const read = rel => { const b = mod.read(rel.replace(/^\/+/, '')); return b ? b.toString('utf-8') : null; };
        const modDesc = read('modDesc.xml') || '';
        const cfgRel = (modDesc.match(/<map\b[^>]*configFilename="([^"]+)"/) || [])[1];
        const cfg = cfgRel ? stripComments(read(cfgRel) || '') : '';
        const ftRel = (cfg.match(/<fruitTypes\b[^>]*filename="([^"]+)"/) || [])[1];
        if (!ftRel) return { ok: false, reason: 'nofruittypes', modName };
        if (/^\$data\//i.test(ftRel)) return { ok: false, reason: 'basemap', modName };
        const ftXml = stripComments(read(ftRel) || '');
        const listBody = (ftXml.match(/<fruitTypes>([\s\S]*?)<\/fruitTypes>/) || [])[1] || '';

        const crops = [];
        const seen = new Set();
        for (const m of listBody.matchAll(/<fruitType\b[^>]*>/g)) {
            const file = attr(m[0], 'filename');
            if (!file) continue;
            const norm = file.replace(/\\/g, '/');
            const base = path.posix.basename(norm, path.posix.extname(norm));
            let name = null, calendar = null;
            if (!/^\$data\//i.test(norm)) {
                const xml = read(norm.replace(/^\$moddir\$[^/]+\//i, ''));
                const parsed = xml ? parseGrowthXml(xml) : null;
                if (parsed) { name = parsed.name; calendar = parsed.calendar; }
            }
            // "meadowUS.xml" -> the folder name ("meadow") is the crop.
            if (!name) name = formatName(path.posix.basename(path.posix.dirname(norm)) || base);
            const key = name.replace(/[_\s]+/g, '').toUpperCase();
            if (seen.has(key)) continue;
            seen.add(key);
            crops.push({ name, calendar, fromBase: calendar === null });
        }
        if (!crops.length) return { ok: false, reason: 'nofruittypes', modName };

        // Normally a map's list is added on top of the base game's crops. A
        // map that overrides FruitTypeManager.loadDefaultTypes in one of its
        // scripts (e.g. Krajów) replaces the base list with its own instead.
        let replacesBase = false;
        for (const m of modDesc.matchAll(/<sourceFile\b[^>]*filename="([^"]+)"/g)) {
            const lua = read(m[1]);
            if (lua && /FruitTypeManager\.loadDefaultTypes/.test(lua)) { replacesBase = true; break; }
        }
        return { ok: true, modName, crops, replacesBase };
    } catch (e) {
        console.error('readMapCrops failed', e);
        return { ok: false, reason: 'parse' };
    } finally {
        if (mod) mod.close();
    }
}

module.exports = { readMapCrops };
