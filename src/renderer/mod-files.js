// Reading files out of the player's FS25 mods folder — mods are either
// unpacked folders or .zip archives. Shared by the breed pictures
// (animal-images.js) and the mixer wagon lookup (feed planner).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { modsDirsForSave, primaryModsDir } = require('./mod-locator');

// --- Minimal ZIP reader (central directory + stored/deflated entries) ---
function readZipDirectory(zipPath) {
    const fd = fs.openSync(zipPath, 'r');
    try {
        const size = fs.fstatSync(fd).size;
        const tailLen = Math.min(size, 65557);
        const tail = Buffer.alloc(tailLen);
        fs.readSync(fd, tail, 0, tailLen, size - tailLen);
        let eocd = -1;
        for (let i = tailLen - 22; i >= 0; i--) {
            if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) return null;
        const count = tail.readUInt16LE(eocd + 10);
        const cdSize = tail.readUInt32LE(eocd + 12);
        const cdOffset = tail.readUInt32LE(eocd + 16);
        if (cdOffset + cdSize > size) return null;
        const cd = Buffer.alloc(cdSize);
        fs.readSync(fd, cd, 0, cdSize, cdOffset);

        const entries = new Map();
        let p = 0;
        for (let n = 0; n < count && p + 46 <= cd.length; n++) {
            if (cd.readUInt32LE(p) !== 0x02014b50) break;
            const method = cd.readUInt16LE(p + 10);
            const compSize = cd.readUInt32LE(p + 20);
            const nameLen = cd.readUInt16LE(p + 28);
            const extraLen = cd.readUInt16LE(p + 30);
            const commentLen = cd.readUInt16LE(p + 32);
            const localOffset = cd.readUInt32LE(p + 42);
            const name = cd.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
            entries.set(name.toLowerCase(), { name, method, compSize, localOffset });
            p += 46 + nameLen + extraLen + commentLen;
        }
        return entries;
    } finally {
        fs.closeSync(fd);
    }
}

function readZipEntry(zipPath, entry) {
    const fd = fs.openSync(zipPath, 'r');
    try {
        const head = Buffer.alloc(30);
        fs.readSync(fd, head, 0, 30, entry.localOffset);
        if (head.readUInt32LE(0) !== 0x04034b50) return null;
        const dataStart = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
        const data = Buffer.alloc(entry.compSize);
        fs.readSync(fd, data, 0, entry.compSize, dataStart);
        if (entry.method === 0) return data;
        if (entry.method === 8) return zlib.inflateRawSync(data);
        return null;
    } finally {
        fs.closeSync(fd);
    }
}

// The mods folder holding most of this savegame's mods (override folder, the
// default <FarmingSimulator2025>/mods, or a Mod Assistant collection) — see
// mod-locator.js.
function findModsDir(saveGamePath) {
    return primaryModsDir(saveGamePath);
}

// Every candidate mods folder for this savegame, best match first.
function findModsDirs(saveGamePath) {
    return modsDirsForSave(saveGamePath);
}

// Reads a file the savegame points at as "$moddir$FS25_Mod/some/file.xml"
// (from <mods>/FS25_Mod/ or <mods>/FS25_Mod.zip). `modsDirs` is one folder or
// a list tried in order. Null for base-game files ("data/...") or anything
// missing.
function readModFile(modsDirs, gamePath) {
    if (!modsDirs || !gamePath) return null;
    const m = String(gamePath).replace(/\\/g, '/').match(/^\$moddir\$([^/]+)\/(.+)$/i);
    if (!m) return null;
    const [, modName, rel] = m;
    const modsDir = (Array.isArray(modsDirs) ? modsDirs : [modsDirs])
        .find(d => fs.existsSync(path.join(d, modName)) || fs.existsSync(path.join(d, modName + '.zip')));
    if (!modsDir) return null;
    try {
        const folderFile = path.join(modsDir, modName, rel);
        if (fs.existsSync(folderFile)) return fs.readFileSync(folderFile);
        const zip = path.join(modsDir, modName + '.zip');
        if (!fs.existsSync(zip)) return null;
        const entries = readZipDirectory(zip);
        const entry = entries && entries.get(rel.toLowerCase());
        return entry ? readZipEntry(zip, entry) : null;
    } catch (e) {
        return null;
    }
}

module.exports = { readZipDirectory, readZipEntry, findModsDir, findModsDirs, readModFile };
