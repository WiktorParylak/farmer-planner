// DDS textures -> RGBA pixels, for mod icons (modDesc <iconFilename>). Only the
// first mip level. Mods ship their icons as DXT1 almost always, sometimes DXT5
// or plain 32-bit; anything else returns null and the view shows a placeholder.

const DDS_MAGIC = 0x20534444;  // "DDS "

// DXGI formats in a DX10 header that map to the same blocks as the old FourCCs.
const DXGI_BC = { 71: 'DXT1', 72: 'DXT1', 74: 'DXT3', 75: 'DXT3', 77: 'DXT5', 78: 'DXT5' };
const DXGI_RGBA = { 28: 'rgba', 29: 'rgba', 87: 'bgra', 91: 'bgra' };

function rgb565(c) {
    const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
    return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

// Colour part of a BC1/2/3 block at `p`, written into a 4x4 block of `out`.
function colorBlock(buf, p, out, w, h, bx, by, oneBitAlpha) {
    const c0 = buf.readUInt16LE(p), c1 = buf.readUInt16LE(p + 2);
    const a = rgb565(c0), b = rgb565(c1);
    const pal = [a.concat(255), b.concat(255)];
    if (c0 > c1 || !oneBitAlpha) {
        pal.push([0, 1, 2].map(i => ((2 * a[i] + b[i]) / 3) | 0).concat(255));
        pal.push([0, 1, 2].map(i => ((a[i] + 2 * b[i]) / 3) | 0).concat(255));
    } else {
        pal.push([0, 1, 2].map(i => ((a[i] + b[i]) / 2) | 0).concat(255));
        pal.push([0, 0, 0, 0]);
    }
    const bits = buf.readUInt32LE(p + 4);
    for (let i = 0; i < 16; i++) {
        const x = bx + (i & 3), y = by + (i >> 2);
        if (x >= w || y >= h) continue;
        const c = pal[(bits >>> (2 * i)) & 3], o = (y * w + x) * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
    }
}

function alphaExplicit(buf, p, out, w, h, bx, by) {
    for (let i = 0; i < 16; i++) {
        const x = bx + (i & 3), y = by + (i >> 2);
        if (x >= w || y >= h) continue;
        const v = (buf[p + (i >> 1)] >> ((i & 1) * 4)) & 15;
        out[(y * w + x) * 4 + 3] = v * 17;
    }
}

function alphaInterpolated(buf, p, out, w, h, bx, by) {
    const a0 = buf[p], a1 = buf[p + 1];
    const pal = [a0, a1];
    if (a0 > a1) for (let i = 1; i <= 6; i++) pal.push((((7 - i) * a0 + i * a1) / 7) | 0);
    else { for (let i = 1; i <= 4; i++) pal.push((((5 - i) * a0 + i * a1) / 5) | 0); pal.push(0, 255); }
    // 48 bits of 3-bit indices; split in two 24-bit halves to stay in 32-bit maths.
    const lo = buf[p + 2] | (buf[p + 3] << 8) | (buf[p + 4] << 16);
    const hi = buf[p + 5] | (buf[p + 6] << 8) | (buf[p + 7] << 16);
    for (let i = 0; i < 16; i++) {
        const x = bx + (i & 3), y = by + (i >> 2);
        if (x >= w || y >= h) continue;
        const idx = i < 8 ? (lo >> (3 * i)) & 7 : (hi >> (3 * (i - 8))) & 7;
        out[(y * w + x) * 4 + 3] = pal[idx];
    }
}

function decodeBlocks(buf, p, w, h, kind) {
    const out = new Uint8ClampedArray(w * h * 4);
    const blockBytes = kind === 'DXT1' ? 8 : 16;
    const need = Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes;
    if (p + need > buf.length) return null;
    for (let by = 0; by < h; by += 4) {
        for (let bx = 0; bx < w; bx += 4) {
            if (kind === 'DXT1') colorBlock(buf, p, out, w, h, bx, by, true);
            else {
                colorBlock(buf, p + 8, out, w, h, bx, by, false);
                if (kind === 'DXT3') alphaExplicit(buf, p, out, w, h, bx, by);
                else alphaInterpolated(buf, p, out, w, h, bx, by);
            }
            p += blockBytes;
        }
    }
    return out;
}

function maskShift(mask) {
    if (!mask) return { shift: 0, max: 0 };
    let shift = 0;
    while (!((mask >>> shift) & 1)) shift++;
    return { shift, max: mask >>> shift };
}

function decodeMasked(buf, p, w, h, bpp, masks) {
    const bytes = bpp / 8;
    if (![2, 3, 4].includes(bytes) || p + w * h * bytes > buf.length) return null;
    const ch = masks.map(maskShift);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++, p += bytes) {
        const v = bytes === 4 ? buf.readUInt32LE(p) : bytes === 3 ? buf.readUIntLE(p, 3) : buf.readUInt16LE(p);
        for (let c = 0; c < 4; c++) {
            const { shift, max } = ch[c];
            out[i * 4 + c] = max ? Math.round((((v & masks[c]) >>> shift) / max) * 255) : 255;
        }
    }
    return out;
}

// Buffer -> { width, height, data: Uint8ClampedArray RGBA } or null.
function decodeDds(buf) {
    if (!buf || buf.length < 128 || buf.readUInt32LE(0) !== DDS_MAGIC) return null;
    const h = buf.readUInt32LE(12), w = buf.readUInt32LE(16);
    if (!w || !h || w > 8192 || h > 8192) return null;
    const pfFlags = buf.readUInt32LE(80);
    const fourCC = buf.toString('latin1', 84, 88);
    let data = null;
    if (fourCC === 'DX10') {
        const dxgi = buf.readUInt32LE(128);
        if (DXGI_BC[dxgi]) data = decodeBlocks(buf, 148, w, h, DXGI_BC[dxgi]);
        else if (DXGI_RGBA[dxgi] === 'rgba') data = decodeMasked(buf, 148, w, h, 32, [0xff, 0xff00, 0xff0000, 0xff000000]);
        else if (DXGI_RGBA[dxgi] === 'bgra') data = decodeMasked(buf, 148, w, h, 32, [0xff0000, 0xff00, 0xff, 0xff000000]);
    } else if (pfFlags & 0x4) {
        if (fourCC === 'DXT1' || fourCC === 'DXT3' || fourCC === 'DXT5') data = decodeBlocks(buf, 128, w, h, fourCC);
        else if (fourCC === 'DXT2' || fourCC === 'DXT4') data = decodeBlocks(buf, 128, w, h, fourCC === 'DXT2' ? 'DXT3' : 'DXT5');
    } else if (pfFlags & 0x40) {
        const masks = [buf.readUInt32LE(92), buf.readUInt32LE(96), buf.readUInt32LE(100), (pfFlags & 0x1) ? buf.readUInt32LE(104) : 0];
        data = decodeMasked(buf, 128, w, h, buf.readUInt32LE(88), masks);
    }
    return data ? { width: w, height: h, data } : null;
}

module.exports = { decodeDds };
