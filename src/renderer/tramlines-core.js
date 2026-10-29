// Tramlines tool — file formats, no DOM. Used by tramlines.js and by the
// worker (tramlines-worker.js), so it only needs Node's Buffer/zlib.
// Ported from program-sciezki (sciezki.py: gdm_header / gdm_decode /
// gdm_encode / xcf_*), which was checked byte for byte against the game.

const zlib = require('zlib');

// ---------- GDM (density map) ----------
// File: header, channel range bounds, then for every 32x32 chunk (row by row)
// one block per range: bit depth, palette length, palette (u16), bitmap (bits
// from the lowest). The game writes blocks only as: 1 value -> depth 0,
// 2 -> 1 bit, 3-4 -> 2 bits with the palette in first-seen order, more -> raw
// values at the full width of the range. Other depths (3-5 bits, as some
// converters write) the game reads wrongly.

function gdmHeader(d) {
    let hs, dl, cl, nch, nr;
    const magic = d.toString('latin1', 0, 4);
    if (magic === '!MDF') { hs = 9; dl = d[4]; cl = d[5]; nch = d[7]; nr = d[8]; }
    else if (magic === '"MDF') { hs = 16; dl = d[8]; cl = d[9]; nch = d[11]; nr = d[12]; }
    else throw new Error('GDM_BAD_HEADER');
    const bounds = [0];
    for (let i = 0; i < nr - 1; i++) bounds.push(d[hs + i]);
    bounds.push(nch);
    return { dim: 1 << (dl + 5), cs: 1 << cl, bounds, channels: nch, dataStart: hs + nr - 1 };
}

function newValues(channels, n) {
    return channels <= 16 ? new Uint16Array(n) : new Uint32Array(n);
}

// GDM bytes -> { dim, channels, values } (values[y * dim + x], all channels
// packed like a grleConverter PNG: channel bits from the lowest).
function gdmDecode(d) {
    const { dim, cs, bounds, channels, dataStart } = gdmHeader(d);
    const nr = bounds.length - 1, cd = dim / cs, npx = cs * cs;
    const values = newValues(channels, dim * dim);
    let pos = dataStart;
    const pal = new Uint32Array(256);
    for (let k = 0; k < cd * cd; k++) {
        const cy = Math.floor(k / cd), cx = k % cd;
        const base = cy * cs * dim + cx * cs;
        for (let r = 0; r < nr; r++) {
            const bd = d[pos], pc = d[pos + 1];
            pos += 2;
            for (let i = 0; i < pc; i++) pal[i] = d[pos + 2 * i] | (d[pos + 2 * i + 1] << 8);
            pos += 2 * pc;
            const shift = bounds[r];
            if (bd === 0) {
                const v = (pc ? pal[0] : 0) << shift;
                if (v) for (let row = 0; row < cs; row++) {
                    const o = base + row * dim;
                    for (let col = 0; col < cs; col++) values[o + col] |= v;
                }
                continue;
            }
            const usePal = bd <= 2 && pc > 0;
            let bit = 0;
            for (let i = 0; i < npx; i++) {
                let v = 0;
                for (let b = 0; b < bd; b++, bit++) v |= ((d[pos + (bit >> 3)] >> (bit & 7)) & 1) << b;
                if (usePal) v = pal[v];
                if (v) values[base + ((i / cs) | 0) * dim + (i % cs)] |= v << shift;
            }
            pos += bd * npx / 8;
        }
    }
    if (pos !== d.length) throw new Error('GDM_BAD_LENGTH');
    return { dim, channels, values };
}

// values -> GDM bytes, with the header of `template` (the original GDM of this
// layer). For unchanged data the result is byte for byte the game's file.
function gdmEncode(values, template) {
    const { dim, cs, bounds, dataStart } = gdmHeader(template);
    if (values.length !== dim * dim) throw new Error('GDM_SIZE_MISMATCH');
    const nr = bounds.length - 1, cd = dim / cs, npx = cs * cs;
    const parts = [template.subarray(0, dataStart)];
    // Worst case per chunk: every range raw.
    let out = Buffer.alloc(1 << 22), o = 0;
    const flush = () => { parts.push(Buffer.from(out.subarray(0, o))); o = 0; };
    const v = new Uint32Array(npx);
    const pal = [0, 0, 0, 0];
    const idx = new Uint8Array(npx);
    for (let k = 0; k < cd * cd; k++) {
        if (o > out.length - 8192 * nr) flush();
        const cy = Math.floor(k / cd), cx = k % cd;
        const base = cy * cs * dim + cx * cs;
        for (let r = 0; r < nr; r++) {
            const width = bounds[r + 1] - bounds[r];
            const mask = (1 << width) - 1, shift = bounds[r];
            let c = 0;
            for (let i = 0; i < npx; i++) {
                const x = (values[base + ((i / cs) | 0) * dim + (i % cs)] >>> shift) & mask;
                v[i] = x;
                if (c <= 4) {
                    let j = 0;
                    while (j < c && pal[j] !== x) j++;
                    if (j === c) { if (c < 4) pal[c] = x; c++; }
                    idx[i] = j;
                }
            }
            if (c <= 4) {
                const bd = [0, 1, 2, 2][c - 1];
                out[o++] = bd; out[o++] = c;
                for (let j = 0; j < c; j++) { out[o++] = pal[j] & 255; out[o++] = pal[j] >> 8; }
                if (bd) {
                    const len = bd * npx / 8;
                    out.fill(0, o, o + len);
                    let bit = 0;
                    for (let i = 0; i < npx; i++) for (let b = 0; b < bd; b++, bit++) {
                        if ((idx[i] >> b) & 1) out[o + (bit >> 3)] |= 1 << (bit & 7);
                    }
                    o += len;
                }
            } else {
                out[o++] = width; out[o++] = 0;
                const len = width * npx / 8;
                out.fill(0, o, o + len);
                let bit = 0;
                for (let i = 0; i < npx; i++) for (let b = 0; b < width; b++, bit++) {
                    if ((v[i] >> b) & 1) out[o + (bit >> 3)] |= 1 << (bit & 7);
                }
                o += len;
            }
        }
    }
    flush();
    return Buffer.concat(parts);
}

// ---------- PNG ----------
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32Fast(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32Fast(td));
    return Buffer.concat([len, td, crc]);
}

// RGBA (Uint8Array w*h*4) -> PNG bytes.
function encodePngRgba(rgba, w, h) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const stride = w * 4;
    const raw = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (stride + 1)] = 0;
        Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }
    const idat = zlib.deflateSync(raw, { level: 6 });
    return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// PNG bytes -> { w, h, rgba } for 8-bit grey / grey+alpha / RGB / RGBA /
// palette, non-interlaced, all filters.
function decodePng(buf) {
    if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('PNG_BAD_HEADER');
    let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
    const idat = [];
    let plte = null, trns = null;
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const t = buf.toString('latin1', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (t === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
        else if (t === 'PLTE') plte = data;
        else if (t === 'tRNS') trns = data;
        else if (t === 'IDAT') idat.push(data);
        else if (t === 'IEND') break;
        pos += 12 + len;
    }
    if (depth !== 8 || interlace) throw new Error('PNG_UNSUPPORTED');
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    if (!ch) throw new Error('PNG_UNSUPPORTED');
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * ch;
    const px = new Uint8Array(stride * h);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const cur = px.subarray(y * stride, (y + 1) * stride);
        for (let i = 0; i < stride; i++) {
            const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
            let p;
            if (f === 0) p = 0;
            else if (f === 1) p = a;
            else if (f === 2) p = b;
            else if (f === 3) p = (a + b) >> 1;
            else {
                const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
                p = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
            }
            cur[i] = (line[i] + p) & 255;
        }
        prev = cur;
    }
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
        if (type === 6) { rgba[j] = px[i * 4]; rgba[j + 1] = px[i * 4 + 1]; rgba[j + 2] = px[i * 4 + 2]; rgba[j + 3] = px[i * 4 + 3]; }
        else if (type === 2) { rgba[j] = px[i * 3]; rgba[j + 1] = px[i * 3 + 1]; rgba[j + 2] = px[i * 3 + 2]; rgba[j + 3] = 255; }
        else if (type === 0) { rgba[j] = rgba[j + 1] = rgba[j + 2] = px[i]; rgba[j + 3] = 255; }
        else if (type === 4) { rgba[j] = rgba[j + 1] = rgba[j + 2] = px[i * 2]; rgba[j + 3] = px[i * 2 + 1]; }
        else {
            const k = px[i];
            rgba[j] = plte[k * 3]; rgba[j + 1] = plte[k * 3 + 1]; rgba[j + 2] = plte[k * 3 + 2];
            rgba[j + 3] = trns && k < trns.length ? trns[k] : 255;
        }
    }
    return { w, h, rgba, grey: type === 0 || type === 4 };
}

// A tramline pixel in a library PNG is RGB = the packed value (like a
// grleConverter PNG of the fruits map: R = bits 0-7, G = 8-15, B = 16-23).
function packRgb(r, g, b) {
    return (r | (g << 8) | (b << 16)) >>> 0;
}

// ---------- XCF (GIMP) ----------
// RGB / greyscale, 8 bits per channel, compression none / RLE / zlib.
// Tiles of 64x64 row by row; RLE codes every byte of a pixel (channel) separately.
function xcfOpen(d) {
    if (d.toString('latin1', 0, 9) !== 'gimp xcf ') throw new Error('XCF_BAD_HEADER');
    const ver = d.toString('latin1', 9, 13) === 'file' ? 0 : parseInt(d.toString('latin1', 10, 13), 10);
    let pos = 14;
    const w = d.readUInt32BE(pos), h = d.readUInt32BE(pos + 4), base = d.readUInt32BE(pos + 8);
    pos += 12;
    if (ver >= 4) pos += 4;
    if (base === 2) throw new Error('XCF_INDEXED');
    const psz = ver >= 11 ? 8 : 4;
    const props = p => {
        const out = {};
        for (;;) {
            const t = d.readUInt32BE(p), n = d.readUInt32BE(p + 4);
            out[t] = d.subarray(p + 8, p + 8 + n);
            p += 8 + n;
            if (t === 0) return [out, p];
        }
    };
    const ptr = p => [psz === 8 ? Number(d.readBigUInt64BE(p)) : d.readUInt32BE(p), p + psz];
    let iprops;
    [iprops, pos] = props(pos);
    const comp = iprops[17] ? iprops[17][0] : 0;
    if (comp > 2) throw new Error('XCF_COMPRESSION');
    const layers = [];
    for (;;) {
        let lp;
        [lp, pos] = ptr(pos);
        if (!lp) break;
        const lw = d.readUInt32BE(lp), lh = d.readUInt32BE(lp + 4), lt = d.readUInt32BE(lp + 8), nl = d.readUInt32BE(lp + 12);
        const name = d.toString('utf8', lp + 16, lp + 15 + nl);
        const [pr, q] = props(lp + 16 + nl);
        const ox = pr[15] ? pr[15].readInt32BE(0) : 0, oy = pr[15] ? pr[15].readInt32BE(4) : 0;
        const [hptr] = ptr(q);
        layers.push({ name, w: lw, h: lh, type: lt, ox, oy, group: !!pr[29], hptr, psz, comp });
    }
    return { w, h, layers };
}

function xcfRle(d, pos, n, bpp, out) {
    for (let c = 0; c < bpp; c++) {
        let i = 0;
        while (i < n) {
            const op = d[pos];
            let cnt;
            if (op < 127) { cnt = op + 1; for (let k = 0; k < cnt; k++) out[(i + k) * bpp + c] = d[pos + 1]; pos += 2; }
            else if (op === 127) { cnt = (d[pos + 1] << 8) | d[pos + 2]; for (let k = 0; k < cnt; k++) out[(i + k) * bpp + c] = d[pos + 3]; pos += 4; }
            else {
                if (op === 128) { cnt = (d[pos + 1] << 8) | d[pos + 2]; pos += 3; }
                else { cnt = 256 - op; pos += 1; }
                for (let k = 0; k < cnt; k++) out[(i + k) * bpp + c] = d[pos + k];
                pos += cnt;
            }
            i += cnt;
        }
    }
}

// Pixels of one layer -> RGBA Uint8Array (layer size, offset not applied).
function xcfLayerRgba(d, layer) {
    const channels = { 0: 3, 1: 4, 2: 1, 3: 2 }[layer.type];
    if (!channels) throw new Error('XCF_INDEXED');
    const rd = p => (layer.psz === 8 ? Number(d.readBigUInt64BE(p)) : d.readUInt32BE(p));
    const bpp = d.readUInt32BE(layer.hptr + 8);
    if (bpp !== channels) throw new Error('XCF_NOT_8BIT');
    const lvl = rd(layer.hptr + 12);
    const w = d.readUInt32BE(lvl), h = d.readUInt32BE(lvl + 4);
    const tw = Math.ceil(w / 64), th = Math.ceil(h / 64);
    const rgba = new Uint8Array(w * h * 4);
    const tile = new Uint8Array(64 * 64 * bpp);
    for (let k = 0; k < tw * th; k++) {
        const tp = rd(lvl + 8 + k * layer.psz);
        const ty = Math.floor(k / tw), tx = k % tw;
        const x0 = tx * 64, y0 = ty * 64, cw = Math.min(64, w - x0), ch = Math.min(64, h - y0);
        const n = cw * ch;
        let t = tile;
        if (layer.comp === 1) xcfRle(d, tp, n, bpp, tile);
        else if (layer.comp === 2) t = zlib.inflateSync(d.subarray(tp), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).subarray(0, n * bpp);
        else t = d.subarray(tp, tp + n * bpp);
        for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
            const s = (yy * cw + xx) * bpp, o = ((y0 + yy) * w + x0 + xx) * 4;
            if (channels >= 3) { rgba[o] = t[s]; rgba[o + 1] = t[s + 1]; rgba[o + 2] = t[s + 2]; }
            else { rgba[o] = rgba[o + 1] = rgba[o + 2] = t[s]; }
            rgba[o + 3] = channels === 2 || channels === 4 ? t[s + bpp - 1] : 255;
        }
    }
    return { w, h, rgba };
}

module.exports = { gdmHeader, gdmDecode, gdmEncode, encodePngRgba, decodePng, packRgb, xcfOpen, xcfLayerRgba };
