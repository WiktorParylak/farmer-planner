// =============================================================
// Diagnostic file for bug reports
// =============================================================
// Settings -> Help -> "Save diagnostic file": one .json with what's needed to
// reproduce a player's problem — app/system versions, the chosen farm's data,
// the text of the small savegame XMLs and the renderer's recent warnings
// (collected by the main process, see get-console-log in main.js).
// Nothing is sent anywhere; the player attaches the file themselves.
// The user's home folder is masked as %USERPROFILE% everywhere in the file.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Savegame files worth having to rebuild a farm's state (all plain XML).
const SAVE_FILES = [
    'careerSavegame.xml', 'environment.xml', 'farms.xml', 'fields.xml', 'farmland.xml',
    'precisionFarming.xml', 'placeables.xml', 'leaseDeals.xml', 'fieldLeasingAgreements.xml'
];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// --- Masking ----------------------------------------------------------------
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// C:\Users\name, C:/Users/name and C:\\Users\\name (inside escaped text) -> %USERPROFILE%
function homeMasker() {
    const home = os.homedir();
    if (!home) return s => s;
    const parts = home.split(/[\\/]+/).filter(Boolean).map(escapeRegExp);
    const re = new RegExp(parts.join('(?:\\\\{1,2}|/)'), 'gi');
    return s => s.replace(re, '%USERPROFILE%');
}

function maskDeep(value, mask) {
    if (typeof value === 'string') return mask(value);
    if (Array.isArray(value)) return value.map(v => maskDeep(v, mask));
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).forEach(k => { out[mask(k)] = maskDeep(value[k], mask); });
        return out;
    }
    return value;
}

// --- Savegame files ---------------------------------------------------------
// An oversized placeables.xml keeps only the animal buildings (the barns are
// what the Animals panel reads); any other oversized file is left out.
function readSaveFile(dir, name) {
    const file = path.join(dir, name);
    let st;
    try { st = fs.statSync(file); } catch (err) { return null; }
    try {
        const text = fs.readFileSync(file, 'utf-8');
        if (st.size <= MAX_FILE_BYTES) return { size: st.size, modified: st.mtime.toISOString(), text };
        if (name === 'placeables.xml') {
            const barns = (text.match(/<placeable\b[\s\S]*?<\/placeable>/g) || []).filter(p => /husbandry/i.test(p));
            const kept = barns.join('\n');
            if (kept.length <= MAX_FILE_BYTES) {
                return { size: st.size, modified: st.mtime.toISOString(), note: 'animal buildings only', text: kept };
            }
        }
        return { size: st.size, modified: st.mtime.toISOString(), note: 'too large, left out' };
    } catch (err) {
        return { size: st.size, error: String(err && err.message || err) };
    }
}

function readSaveFiles(saveGamePath) {
    if (!saveGamePath) return null;
    const dir = path.dirname(saveGamePath);
    if (!fs.existsSync(dir)) return { folderMissing: true };
    const out = {};
    SAVE_FILES.forEach(name => {
        const entry = readSaveFile(dir, name);
        if (entry) out[name] = entry;
    });
    return out;
}

// --- The file -----------------------------------------------------------------
// info: { appVersion, lang, isDevBuild, settings, farm, farmFiles, log }
function buildDiagnostics(info) {
    const farm = info.farm || null;
    const report = {
        exportFormat: 'farmer-planner-diagnostics',
        exportVersion: 1,
        createdAt: new Date().toISOString(),
        app: {
            version: info.appVersion,
            devBuild: !!info.isDevBuild,
            language: info.lang,
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node
        },
        system: {
            platform: process.platform,
            arch: process.arch,
            release: os.release(),
            locale: (typeof navigator !== 'undefined' && navigator.language) || null,
            screen: (typeof screen !== 'undefined') ? `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}` : null
        },
        settings: info.settings || {},
        farm: farm,
        farmFiles: info.farmFiles || null,
        savegame: farm ? readSaveFiles(farm.saveGamePath) : null,
        log: info.log || []
    };
    return maskDeep(report, homeMasker());
}

module.exports = { buildDiagnostics };
