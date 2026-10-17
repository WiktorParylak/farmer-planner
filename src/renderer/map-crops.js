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
            let name = null, calendar = null, rawName = null, agronomy = null;
            if (!/^\$data\//i.test(norm)) {
                const xml = read(norm.replace(/^\$moddir\$[^/]+\//i, ''));
                const parsed = xml ? parseGrowthXml(xml) : null;
                if (parsed) { name = parsed.name; calendar = parsed.calendar; agronomy = parsed.agronomy || null; }
                if (xml) rawName = attr((xml.match(/<fruitType\b[^>]*>/) || [''])[0], 'name');
            }
            // "meadowUS.xml" -> the folder name ("meadow") is the crop.
            if (!name) name = formatName(path.posix.basename(path.posix.dirname(norm)) || base);
            const key = name.replace(/[_\s]+/g, '').toUpperCase();
            if (seen.has(key)) continue;
            seen.add(key);
            crops.push({ name, rawName: rawName || name, calendar, agronomy, fromBase: calendar === null });
        }
        if (!crops.length) return { ok: false, reason: 'nofruittypes', modName };

        // Crop names as the map shows them ("centeno" -> "Rye"), from its
        // translations: fillType_<crop> in l10n files or inline in modDesc.
        const l10n = readModL10n(read, modDesc, ['en', 'pl', 'de']);
        crops.forEach(c => {
            const k = ('filltype_' + c.rawName).toLowerCase();
            if (l10n[k]) c.titles = l10n[k];
        });

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

function decodeXmlText(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

// A mod's translations: { lowercased key: { en: '…', pl: '…' } }. Mods use
// either separate files (<l10n filenamePrefix="dir/l10n"/> -> dir/l10n_en.xml
// with <e k="…" v="…"/> or <text name="…" text="…"/>) or inline
// <l10n><text name="…"><en>…</en><pl>…</pl></text></l10n> in modDesc.xml.
function readModL10n(read, modDesc, langs) {
    const out = {};
    const put = (k, lang, v) => {
        if (!k || !v) return;
        const key = k.toLowerCase();
        // Mod text ends up in the UI's HTML (crop and mixer names), so markup
        // characters are dropped — a mod must not be able to inject HTML (the
        // renderer has Node access).
        (out[key] || (out[key] = {}))[lang] = decodeXmlText(v).replace(/[<>"'`]/g, '');
    };
    const prefix = attr((modDesc.match(/<l10n\b[^>]*filenamePrefix="[^"]*"[^>]*>/) || [''])[0], 'filenamePrefix');
    if (prefix) {
        langs.forEach(lang => {
            const xml = read(`${prefix}_${lang}.xml`);
            if (!xml) return;
            for (const m of xml.matchAll(/<e\b[^>]*>/g)) put(attr(m[0], 'k'), lang, attr(m[0], 'v'));
            for (const m of xml.matchAll(/<text\b[^>]*\bname="[^"]*"[^>]*\btext="[^"]*"[^>]*>/g)) put(attr(m[0], 'name'), lang, attr(m[0], 'text'));
        });
    }
    const inline = (modDesc.match(/<l10n>([\s\S]*?)<\/l10n>/) || [])[1];
    if (inline) {
        for (const m of inline.matchAll(/<text\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
            langs.forEach(lang => {
                const v = (m[2].match(new RegExp('<' + lang + '>([\\s\\S]*?)</' + lang + '>')) || [])[1];
                if (v) put(m[1], lang, v.replace(/<!\[CDATA\[|\]\]>/g, ''));
            });
        }
    }
    return out;
}

// Precision Farming's variable seed rates for the savegame:
// FS25_precisionFarming's PrecisionFarming.xml <seedRateMap>, with the map's
// own <precisionFarming><seedRateMap> (in its map config) on top per crop.
// Per crop: lha = [low, standard, high] litres/ha (usages × 10000) and auto =
// the rate PF's automatic mode picks on each soil — the lowest one reaching
// the best <soilType yields>. -> { ok, rates: { CropKey: { lha, auto } } }
const PF_SOIL_IDS = ['loamySand', 'sandyLoam', 'loam', 'siltyClay'];

function parseSeedRateMap(xml, formatName) {
    const out = {};
    const block = (xml.match(/<seedRateMap>([\s\S]*?)<\/seedRateMap>/) || [])[1];
    if (!block) return out;
    for (const m of block.matchAll(/<fruitType\b([^>]*)>([\s\S]*?)<\/fruitType>/g)) {
        const name = attr(m[1], 'name');
        const rates = (m[2].match(/<seedRates\b[^>]*>/) || [''])[0];
        const usages = (attr(rates, 'usages') || '').trim().split(/\s+/).map(parseFloat);
        if (!name || usages.length !== 3 || usages.some(isNaN)) continue;
        const auto = {};
        for (const s of m[2].matchAll(/<soilType\b[^>]*>/g)) {
            const idx = parseInt(attr(s[0], 'index'), 10) - 1;
            const yields = (attr(s[0], 'yields') || '').trim().split(/\s+/).map(parseFloat);
            if (!PF_SOIL_IDS[idx] || yields.length !== 3) continue;
            const best = Math.max(...yields);
            auto[PF_SOIL_IDS[idx]] = yields.findIndex(y => y >= best - 1e-9);
        }
        out[formatName(name).replace(/\s+/g, '')] = {
            lha: usages.map(u => Math.round(u * 10000 * 10) / 10),
            auto
        };
    }
    return out;
}

function readPfSeedRates(careerSavegamePath, formatName) {
    const fs = require('fs');
    const opened = [];
    const openSaveMod = name => {
        const dir = locateMod(careerSavegamePath, name);
        const mod = dir ? openMod(dir, name) : null;
        if (mod) opened.push(mod);
        return mod;
    };
    try {
        if (!careerSavegamePath || !fs.existsSync(careerSavegamePath)) return { ok: false, reason: 'nosave' };
        const rates = {};
        const pf = openSaveMod('FS25_precisionFarming');
        const pfXml = pf ? (pf.read('PrecisionFarming.xml') || '').toString('utf-8') : '';
        Object.assign(rates, parseSeedRateMap(stripComments(pfXml), formatName));
        const career = fs.readFileSync(careerSavegamePath, 'utf-8');
        const mapId = (career.match(/<mapId>([^<]+)<\/mapId>/) || [])[1];
        if (mapId && mapId.indexOf('.') > 0) {
            const map = openSaveMod(mapId.split('.')[0]);
            if (map) {
                const modDesc = (map.read('modDesc.xml') || '').toString('utf-8');
                const cfgRel = (modDesc.match(/<map\b[^>]*configFilename="([^"]+)"/) || [])[1];
                const cfg = cfgRel ? stripComments((map.read(cfgRel) || '').toString('utf-8')) : '';
                const pfBlock = (cfg.match(/<precisionFarming>([\s\S]*?)<\/precisionFarming>/) || [])[1] || '';
                Object.assign(rates, parseSeedRateMap(pfBlock, formatName));
            }
        }
        return { ok: Object.keys(rates).length > 0, rates };
    } catch (e) {
        console.error('readPfSeedRates failed', e);
        return { ok: false, reason: 'parse' };
    } finally {
        opened.forEach(m => m.close());
    }
}

module.exports = { readMapCrops, readModL10n, readPfSeedRates };
