// Where a savegame's mods actually live. Players don't always use the default
// <FarmingSimulator2025>/mods folder:
//   - gameSettings.xml <modsDirectoryOverride active="true" directory="…"/>
//     points the game at another folder (set by hand or by a mod manager);
//   - FSG Mod Assistant keeps several "collections" (one folder each, listed
//     in its config.json "modFolders") and switches the override between them,
//     so a savegame may belong to a collection that isn't active right now.
// modsDirsForSave() returns every candidate folder that exists, the one holding
// most of the savegame's active mods (careerSavegame.xml <mod modName>) first;
// locateMod() finds the folder that has a given mod (folder or .zip).
const fs = require('fs');
const path = require('path');
const os = require('os');

function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function attr(tag, name) {
    const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"'));
    return m ? m[1] : null;
}

// <savegameN>/careerSavegame.xml -> <FarmingSimulator2025>
function gameDirForSave(saveGamePath) {
    return saveGamePath ? path.dirname(path.dirname(saveGamePath)) : null;
}

function overrideDir(gameDir) {
    try {
        const gs = fs.readFileSync(path.join(gameDir, 'gameSettings.xml'), 'utf-8');
        const tag = (gs.match(/<modsDirectoryOverride\b[^>]*>/) || [])[0];
        if (tag && attr(tag, 'active') === 'true') {
            const dir = attr(tag, 'directory');
            if (dir && isDir(dir)) return dir;
        }
    } catch { /* no gameSettings.xml — default folder only */ }
    return null;
}

// FSG Mod Assistant (electron-store config.json in %APPDATA%\<app>).
const MOD_ASSISTANT_APP_DIRS = ['FSModAssistant', 'fsg-mod-assistant', 'FSG Mod Assistant'];
function modAssistantFolders() {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    for (const app of MOD_ASSISTANT_APP_DIRS) {
        try {
            const cfg = JSON.parse(fs.readFileSync(path.join(appData, app, 'config.json'), 'utf-8'));
            if (Array.isArray(cfg.modFolders)) return cfg.modFolders.filter(p => typeof p === 'string' && isDir(p));
        } catch { /* not installed / unreadable */ }
    }
    return [];
}

function activeModsOfSave(saveGamePath) {
    try {
        const career = fs.readFileSync(saveGamePath, 'utf-8');
        return [...career.matchAll(/<mod\b[^>]*\bmodName="([^"]+)"/g)].map(m => m[1]);
    } catch { return []; }
}

function hasMod(dir, modName) {
    return isDir(path.join(dir, modName)) || fs.existsSync(path.join(dir, modName + '.zip'));
}

// Short cache: every panel asks for the same save's folders right after each
// other, and auto-sync re-reads the save every few seconds.
const CACHE_MS = 15000;
const cache = new Map();

function modsDirsForSave(saveGamePath) {
    if (!saveGamePath) return [];
    const hit = cache.get(saveGamePath);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.dirs;

    const gameDir = gameDirForSave(saveGamePath);
    const seen = new Set();
    const dirs = [];
    const add = (p, source) => {
        if (!p || !isDir(p)) return;
        const key = path.resolve(p).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        dirs.push({ dir: p, source });
    };
    add(overrideDir(gameDir), 'override');
    add(path.join(gameDir, 'mods'), 'default');
    modAssistantFolders().forEach(p => add(p, 'modAssistant'));

    const mods = activeModsOfSave(saveGamePath);
    dirs.forEach((d, i) => { d.order = i; d.score = mods.filter(m => hasMod(d.dir, m)).length; });
    dirs.sort((a, b) => b.score - a.score || a.order - b.order);

    const result = dirs.map(d => d.dir);
    cache.set(saveGamePath, { at: Date.now(), dirs: result });
    return result;
}

// Folder holding most of this save's mods — for "scan the whole mods folder"
// jobs like breed pictures.
function primaryModsDir(saveGamePath) {
    return modsDirsForSave(saveGamePath)[0] || null;
}

function locateMod(saveGamePath, modName) {
    if (!modName) return null;
    return modsDirsForSave(saveGamePath).find(dir => hasMod(dir, modName)) || null;
}

module.exports = { modsDirsForSave, primaryModsDir, locateMod, modAssistantFolders, overrideDir };
