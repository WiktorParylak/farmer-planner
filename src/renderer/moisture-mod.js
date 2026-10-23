// FS25_MoistureSystem: field moisture scales the yield at the cutter, read
// from the savegame and the mod itself so the yield forecast matches the game.
//
// Moisture at a spot (MoistureSystem:getMoistureAtPosition, src/main.lua):
//   one farm-wide currentMoisturePercent (0..1, <savegame>/MoistureSystem.xml),
//   ± up to 2 pp by terrain height against the map's median field height
//   (not read here — needs the terrain), clamped to the month's weather
//   profile, + the irrigation boost of the farmland (<irrigation><boost
//   farmlandId value>), capped at 1.
// Yield (CropValueMap.getYieldMultiplier, src/data/CropValueMap.lua):
//   1 inside [idealMin, idealMax]; drier -> linearly down to 1 - yieldLossMaxDry
//   at yieldCurveFloor; wetter -> down to 1 - yieldLossMaxWet at
//   qualityCurveFloor. Crops not in its table keep 1.
// The table is read from the mod's Lua file, so it follows mod updates.
const fs = require('fs');
const path = require('path');
const { openMod } = require('./savegame-soil');
const { locateMod } = require('./mod-locator');

const MOISTURE_MOD = 'FS25_MoistureSystem';
const CROP_VALUE_MAP = 'src/data/CropValueMap.lua';

function attr(tag, name) {
    const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"'));
    return m ? m[1] : null;
}

// ["WHEAT"] = { idealMin = 0.11, ... } -> { WHEAT: { idealMin: 0.11, ... } }
function parseCropValueMap(lua) {
    const out = {};
    for (const m of lua.matchAll(/\["([A-Z0-9_]+)"\]\s*=\s*\{([^}]*)\}/g)) {
        const def = {};
        for (const v of m[2].matchAll(/(\w+)\s*=\s*(-?[\d.]+)/g)) def[v[1]] = parseFloat(v[2]);
        if (def.idealMin >= 0 && def.idealMax >= def.idealMin) out[m[1]] = def;
    }
    return out;
}

// -> null when the mod isn't in the save or its file is missing, else
//    { moisture (0..1), boosts: { farmlandId: 0..1 }, witheringEnabled, crops: {...} }
// knownCrops: the crop table read before (auto-sync re-reads only the save).
function readMoistureSystem(careerSavegamePath, knownCrops = null) {
    if (!careerSavegamePath || !fs.existsSync(careerSavegamePath)) return null;
    let career = '';
    try { career = fs.readFileSync(careerSavegamePath, 'utf-8'); } catch { return null; }
    if (!new RegExp('<mod\\b[^>]*\\bmodName="' + MOISTURE_MOD + '"').test(career)) return null;
    let xml;
    try {
        xml = fs.readFileSync(path.join(path.dirname(careerSavegamePath), 'MoistureSystem.xml'), 'utf-8');
    } catch { return null; }   // the game hasn't saved with the mod yet
    const root = (xml.match(/<MoistureSystem\b[^>]*>/) || [''])[0];
    const moisture = parseFloat(attr(root, 'currentMoisturePercent'));
    if (!(moisture >= 0)) return null;
    const settings = (xml.match(/<settings\b[^>]*>/) || [''])[0];
    const boosts = {};
    const irrigation = (xml.match(/<irrigation\b[\s\S]*?(?:<\/irrigation>|\/>)/) || [''])[0];
    for (const b of irrigation.matchAll(/<boost\b[^>]*>/g)) {
        const id = attr(b[0], 'farmlandId');
        const value = parseFloat(attr(b[0], 'value'));
        if (id && value > 0) boosts[id] = value;
    }

    let crops = knownCrops || {};
    let mod = null;
    if (!knownCrops) try {
        const dir = locateMod(careerSavegamePath, MOISTURE_MOD);
        mod = dir ? openMod(dir, MOISTURE_MOD) : null;
        const lua = mod && mod.read(CROP_VALUE_MAP);
        if (lua) crops = parseCropValueMap(lua.toString('utf-8'));
    } catch (e) { console.warn('MoistureSystem crop table unreadable', e); }
    finally { if (mod) mod.close(); }

    return { moisture, boosts, witheringEnabled: attr(settings, 'witheringEnabled') === 'true', crops };
}

// CropValueMap.getYieldMultiplier for one crop definition (null = not tracked).
function moistureYieldFactor(def, moisture) {
    if (!def) return 1;
    const curve = (m, start, floor, lossMax) => {
        if (floor >= start) return 0;
        return Math.max(0, Math.min(1, (start - m) / (start - floor))) * lossMax;
    };
    if (moisture < def.idealMin) return 1 - curve(moisture, def.idealMin, def.yieldCurveFloor, def.yieldLossMaxDry || 0);
    if (moisture > def.idealMax) return 1 - curve(-moisture, -def.idealMax, -def.qualityCurveFloor, def.yieldLossMaxWet || 0);
    return 1;
}

module.exports = { readMoistureSystem, moistureYieldFactor, parseCropValueMap };
