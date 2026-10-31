// Packs link-mod/ into FS25_FarmerPlannerLink.zip, the mod players copy to
// their mods folder. The icon is the 256 px image from Assets/Logo.ico,
// written as an uncompressed DDS. The app ships the zip as an extra resource
// (package.json) and builds it on demand when started with `npm start`.
//
//   node tools/build-link-mod.js [outFile]
//   default outFile: build-cache/link-mod/FS25_FarmerPlannerLink.zip

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { decodePng } = require('../src/renderer/tramlines-core.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'link-mod');
const DEFAULT_OUT = path.join(ROOT, 'build-cache', 'link-mod', 'FS25_FarmerPlannerLink.zip');
const ICON_NAME = 'icon_FarmerPlannerLink.dds';

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// entries: [{ name, data }] -> zip bytes (deflate, no directories).
function zipFiles(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    // Fixed DOS date/time (2026-01-01 00:00) so the zip is the same on every build.
    const dosTime = 0;
    const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const packed = zlib.deflateRawSync(data, { level: 9 });
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);          // UTF-8 names
        local.writeUInt16LE(8, 8);               // deflate
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, nameBuf, packed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(dosTime, 12);
        central.writeUInt16LE(dosDate, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(packed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuf);
        offset += local.length + nameBuf.length + packed.length;
    }
    const centralBuf = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralBuf, end]);
}

// The largest PNG image inside an .ico file.
function pngFromIco(ico) {
    const count = ico.readUInt16LE(4);
    let best = null;
    for (let i = 0; i < count; i++) {
        const o = 6 + i * 16;
        const size = ico[o] || 256;
        const len = ico.readUInt32LE(o + 8);
        const at = ico.readUInt32LE(o + 12);
        const bytes = ico.subarray(at, at + len);
        if (bytes.readUInt32BE(0) !== 0x89504E47) continue;
        if (!best || size > best.size) best = { size, bytes };
    }
    if (!best) throw new Error('No PNG image in the icon');
    return best.bytes;
}

// RGBA -> uncompressed 32-bit DDS (A8R8G8B8), the format FS25 accepts for mod icons.
function ddsFromRgba(rgba, w, h) {
    const header = Buffer.alloc(128);
    header.write('DDS ', 0, 'ascii');
    header.writeUInt32LE(124, 4);
    header.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x8, 8);   // CAPS | HEIGHT | WIDTH | PIXELFORMAT | PITCH
    header.writeUInt32LE(h, 12);
    header.writeUInt32LE(w, 16);
    header.writeUInt32LE(w * 4, 20);
    header.writeUInt32LE(32, 76);                               // pixel format size
    header.writeUInt32LE(0x1 | 0x40, 80);                       // ALPHAPIXELS | RGB
    header.writeUInt32LE(32, 88);
    header.writeUInt32LE(0x00FF0000, 92);
    header.writeUInt32LE(0x0000FF00, 96);
    header.writeUInt32LE(0x000000FF, 100);
    header.writeUInt32LE(0xFF000000, 104);
    header.writeUInt32LE(0x1000, 108);                          // TEXTURE
    const pixels = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        pixels[i * 4] = rgba[i * 4 + 2];
        pixels[i * 4 + 1] = rgba[i * 4 + 1];
        pixels[i * 4 + 2] = rgba[i * 4];
        pixels[i * 4 + 3] = rgba[i * 4 + 3];
    }
    return Buffer.concat([header, pixels]);
}

function buildIcon() {
    const png = decodePng(pngFromIco(fs.readFileSync(path.join(ROOT, 'Assets', 'Logo.ico'))));
    return ddsFromRgba(png.rgba, png.w, png.h);
}

// Every file under link-mod/, with forward-slash names.
function modFiles(dir, prefix = '') {
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) out.push(...modFiles(full, prefix + name + '/'));
        else out.push({ name: prefix + name, data: fs.readFileSync(full) });
    }
    return out;
}

// The mod's version from modDesc.xml ("1.0.0.0").
function linkModVersion() {
    const desc = fs.readFileSync(path.join(SRC, 'modDesc.xml'), 'utf8');
    const m = desc.match(/<version>([^<]+)<\/version>/);
    return m ? m[1].trim() : '';
}

function buildLinkMod(outFile = DEFAULT_OUT) {
    const entries = modFiles(SRC);
    entries.push({ name: ICON_NAME, data: buildIcon() });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, zipFiles(entries));
    return outFile;
}

module.exports = { buildLinkMod, linkModVersion, DEFAULT_OUT };

if (require.main === module) {
    const out = buildLinkMod(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT);
    console.log(`${out} (version ${linkModVersion()})`);
}
