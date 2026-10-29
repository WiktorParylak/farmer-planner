// Map scaling tool — doubles the resolution of a map's layers, no DOM. Used by
// map-scale-worker.js. Every format is read and written in strips, so even a
// 4x map's 16384² layer (32768² after scaling, ~1 G pixels) never sits in
// memory whole.
//
// GDM (density maps) and GRLE / PNG (info layers) hold codes, so a pixel
// becomes a 2×2 block. dem.png holds heights on a 2^n+1 grid, so it becomes
// 2^(n+1)+1 with the new points interpolated.
// The GDM block rules follow tramlines-core.js (checked against the game).

const fs = require('fs');
const zlib = require('zlib');

// ---------- output file ----------
// Buffered writer on a file descriptor; patch() writes at a fixed offset.
function openOut(file) {
    const fd = fs.openSync(file, 'w');
    let buf = Buffer.alloc(1 << 22), o = 0, size = 0;
    const flush = () => { if (o) { fs.writeSync(fd, buf, 0, o); size += o; o = 0; } };
    return {
        need(n) { if (o + n > buf.length) { flush(); if (n > buf.length) buf = Buffer.alloc(n); } },
        byte(v) { if (o >= buf.length) flush(); buf[o++] = v; },
        bytes(b) { this.need(b.length); b.copy(buf, o); o += b.length; },
        get buf() { return buf; },
        get o() { return o; },
        set o(v) { o = v; },
        close() { flush(); fs.closeSync(fd); return size; }
    };
}

// FNV-1a over the bytes of what was written, compared with the read-back.
function hashNew() { return { h: 0x811c9dc5 }; }
function hashBytes(st, b, from = 0, to = b.length) {
    let h = st.h;
    for (let i = from; i < to; i++) h = Math.imul(h ^ b[i], 16777619);
    st.h = h;
}
function hashValues(st, v, from = 0, to = v.length) {
    let h = st.h;
    for (let i = from; i < to; i++) {
        const x = v[i];
        h = Math.imul(h ^ (x & 255), 16777619);
        h = Math.imul(h ^ ((x >>> 8) & 255), 16777619);
        h = Math.imul(h ^ (x >>> 16), 16777619);
    }
    st.h = h;
}

// Lets the worker answer messages (progress, cancel) between strips.
const tick = () => new Promise(r => setImmediate(r));

// ---------- GDM ----------
function gdmHeader(d) {
    let hs, dlAt, nch, nr;
    const magic = d.toString('latin1', 0, 4);
    if (magic === '!MDF') { hs = 9; dlAt = 4; nch = d[7]; nr = d[8]; }
    else if (magic === '"MDF') { hs = 16; dlAt = 8; nch = d[11]; nr = d[12]; }
    else throw Object.assign(new Error('MS_BAD_FILE'), { code: 'MS_BAD_FILE' });
    const bounds = [0];
    for (let i = 0; i < nr - 1; i++) bounds.push(d[hs + i]);
    bounds.push(nch);
    return { dim: 1 << (d[dlAt] + 5), cs: 1 << d[dlAt + 1], bounds, channels: nch, dataStart: hs + nr - 1, dlAt };
}

// Decodes chunk row `cy` (cs rows × dim) into `strip` from byte `pos`; returns the next pos.
function gdmDecodeRow(d, pos, hd, strip) {
    const { dim, cs, bounds } = hd;
    const nr = bounds.length - 1, cd = dim / cs, npx = cs * cs;
    strip.fill(0);
    for (let cx = 0; cx < cd; cx++) {
        const base = cx * cs;
        for (let r = 0; r < nr; r++) {
            const bd = d[pos], pc = d[pos + 1];
            pos += 2;
            const pal = [];
            for (let i = 0; i < pc; i++) pal.push(d[pos + 2 * i] | (d[pos + 2 * i + 1] << 8));
            pos += 2 * pc;
            const shift = bounds[r];
            if (bd === 0) {
                const v = (pc ? pal[0] : 0) << shift;
                if (v) for (let row = 0; row < cs; row++) {
                    const o = base + row * dim;
                    for (let col = 0; col < cs; col++) strip[o + col] |= v;
                }
                continue;
            }
            const usePal = bd <= 2 && pc > 0;
            let bit = 0;
            for (let i = 0; i < npx; i++) {
                let v = 0;
                for (let b = 0; b < bd; b++, bit++) v |= ((d[pos + (bit >> 3)] >> (bit & 7)) & 1) << b;
                if (usePal) v = pal[v];
                if (v) strip[base + ((i / cs) | 0) * dim + (i % cs)] |= v << shift;
            }
            pos += bd * npx / 8;
        }
    }
    return pos;
}

// Encodes one chunk row held in `strip` (cs rows × dim) into `out`.
function gdmEncodeRow(strip, hd, dim, out) {
    const { cs, bounds } = hd;
    const nr = bounds.length - 1, cd = dim / cs, npx = cs * cs;
    const v = new Uint32Array(npx), idx = new Uint8Array(npx), pal = [0, 0, 0, 0];
    for (let cx = 0; cx < cd; cx++) {
        const base = cx * cs;
        for (let r = 0; r < nr; r++) {
            const width = bounds[r + 1] - bounds[r];
            const mask = (1 << width) - 1, shift = bounds[r];
            let c = 0;
            for (let i = 0; i < npx; i++) {
                const x = (strip[base + ((i / cs) | 0) * dim + (i % cs)] >>> shift) & mask;
                v[i] = x;
                if (c <= 4) {
                    let j = 0;
                    while (j < c && pal[j] !== x) j++;
                    if (j === c) { if (c < 4) pal[c] = x; c++; }
                    idx[i] = j;
                }
            }
            out.need(2 + 8 + width * npx / 8);
            const b = out.buf;
            let o = out.o;
            if (c <= 4) {
                const bd = [0, 1, 2, 2][c - 1];
                b[o++] = bd; b[o++] = c;
                for (let j = 0; j < c; j++) { b[o++] = pal[j] & 255; b[o++] = pal[j] >> 8; }
                if (bd) {
                    const len = bd * npx / 8;
                    b.fill(0, o, o + len);
                    let bit = 0;
                    for (let i = 0; i < npx; i++) for (let k = 0; k < bd; k++, bit++) {
                        if ((idx[i] >> k) & 1) b[o + (bit >> 3)] |= 1 << (bit & 7);
                    }
                    o += len;
                }
            } else {
                b[o++] = width; b[o++] = 0;
                const len = width * npx / 8;
                b.fill(0, o, o + len);
                let bit = 0;
                for (let i = 0; i < npx; i++) for (let k = 0; k < width; k++, bit++) {
                    if ((v[i] >> k) & 1) b[o + (bit >> 3)] |= 1 << (bit & 7);
                }
                o += len;
            }
            out.o = o;
        }
    }
}

function gdmInfo(d) {
    const hd = gdmHeader(d);
    return { w: hd.dim, h: hd.dim, channels: hd.channels };
}

// Scales `src` (GDM bytes) by `f` (1 or 2) into `file`. Returns the hash of the values written.
async function gdmScale(src, file, f, progress) {
    const hd = gdmHeader(src);
    const { dim, cs } = hd, dim2 = dim * f, cd = dim / cs;
    if (dim2 / cs !== Math.floor(dim2 / cs)) throw Object.assign(new Error('MS_BAD_FILE'), { code: 'MS_BAD_FILE' });
    const out = openOut(file);
    try {
        const head = Buffer.from(src.subarray(0, hd.dataStart));
        head[hd.dlAt] = Math.log2(dim2) - 5;
        out.bytes(head);
        const strip = new Uint32Array(cs * dim), big = new Uint32Array(cs * dim2);
        const st = hashNew();
        let pos = hd.dataStart;
        for (let cy = 0; cy < cd; cy++) {
            pos = gdmDecodeRow(src, pos, hd, strip);
            // Source chunk row -> f output chunk rows (each source row repeated f times).
            for (let part = 0; part < f; part++) {
                for (let row = 0; row < cs; row++) {
                    const sr = ((part * cs + row) / f) | 0, so = sr * dim, bo = row * dim2;
                    if (f === 1) big.set(strip.subarray(so, so + dim), bo);
                    else for (let x = 0; x < dim; x++) { const v = strip[so + x]; big[bo + 2 * x] = v; big[bo + 2 * x + 1] = v; }
                }
                hashValues(st, big);
                gdmEncodeRow(big, hd, dim2, out);
            }
            if ((cy & 15) === 15) { if (progress) progress((cy + 1) / cd); await tick(); }
        }
        if (pos !== src.length) throw Object.assign(new Error('MS_BAD_FILE'), { code: 'MS_BAD_FILE' });
        out.close();
        return st.h;
    } catch (e) { try { out.close(); } catch (_) { /* closed */ } throw e; }
}

function gdmHashFile(d) {
    const hd = gdmHeader(d);
    const strip = new Uint32Array(hd.cs * hd.dim), st = hashNew();
    let pos = hd.dataStart;
    for (let cy = 0; cy < hd.dim / hd.cs; cy++) { pos = gdmDecodeRow(d, pos, hd, strip); hashValues(st, strip); }
    if (pos !== d.length) throw Object.assign(new Error('MS_VERIFY'), { code: 'MS_VERIFY' });
    return st.h;
}

// ---------- GRLE ----------
// 21-byte header: "GRLE", version, width / 256 (u16 @6), height / 256 (u16 @10),
// data length (u32 @17). Then RLE: a byte; if the next byte repeats it, a run
// length follows (0xFF bytes summed + a final byte) of further copies.
function grleInfo(b) {
    if (b.toString('latin1', 0, 4) !== 'GRLE') throw Object.assign(new Error('MS_BAD_FILE'), { code: 'MS_BAD_FILE' });
    return { w: b.readUInt16LE(6) * 256, h: b.readUInt16LE(10) * 256, channels: 8 };
}

function grleReader(b) {
    let i = 21, val = 0, left = 0;
    return function readRow(row) {
        let o = 0;
        const n = row.length;
        while (o < n) {
            if (left > 0) {
                const k = Math.min(left, n - o);
                row.fill(val, o, o + k);
                o += k; left -= k;
                continue;
            }
            if (i >= b.length) throw Object.assign(new Error('MS_BAD_FILE'), { code: 'MS_BAD_FILE' });
            const v = b[i++];
            row[o++] = v;
            if (i < b.length && b[i] === v) {
                i++;
                let c = 0;
                while (b[i] === 255) { c += 255; i++; }
                c += b[i++];
                val = v; left = c + 1;
            }
        }
    };
}

function grleWriter(out) {
    let cur = -1, run = 0;
    const emit = () => {
        if (run <= 0) return;
        out.byte(cur);
        if (run > 1) {
            out.byte(cur);
            let c = run - 2;
            while (c >= 255) { out.byte(255); c -= 255; }
            out.byte(c);
        }
    };
    return {
        row(r) {
            for (let k = 0; k < r.length; k++) {
                const v = r[k];
                if (v === cur) run++;
                else { emit(); cur = v; run = 1; }
            }
        },
        end() { emit(); run = 0; }
    };
}

async function grleScale(src, file, f, progress) {
    const { w, h } = grleInfo(src);
    const w2 = w * f, h2 = h * f;
    const out = openOut(file);
    try {
        const head = Buffer.from(src.subarray(0, 21));
        head.writeUInt16LE(w2 / 256, 6);
        head.writeUInt16LE(h2 / 256, 10);
        out.bytes(head);
        const read = grleReader(src), wr = grleWriter(out);
        const row = Buffer.alloc(w), big = Buffer.alloc(w2), st = hashNew();
        for (let y = 0; y < h; y++) {
            read(row);
            if (f === 1) row.copy(big);
            else for (let x = 0; x < w; x++) { big[2 * x] = row[x]; big[2 * x + 1] = row[x]; }
            for (let k = 0; k < f; k++) { wr.row(big); hashBytes(st, big); }
            if ((y & 255) === 255) { if (progress) progress((y + 1) / h); await tick(); }
        }
        wr.end();
        const len = Buffer.alloc(4);
        const total = out.close();
        len.writeUInt32LE(total - 21);
        const fd = fs.openSync(file, 'r+');
        fs.writeSync(fd, len, 0, 4, 17);
        fs.closeSync(fd);
        return st.h;
    } catch (e) { try { out.close(); } catch (_) { /* closed */ } throw e; }
}

function grleHashFile(b) {
    const { w, h } = grleInfo(b);
    const read = grleReader(b), row = Buffer.alloc(w), st = hashNew();
    for (let y = 0; y < h; y++) { read(row); hashBytes(st, row); }
    return st.h;
}

// ---------- PNG ----------
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type, data) {
    const t = Buffer.from(type, 'latin1');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(t)) >>> 0);
    return Buffer.concat([len, t, data, crc]);
}

function pngParse(b) {
    if (!b.subarray(0, 8).equals(PNG_SIG)) throw Object.assign(new Error('MS_BAD_FILE'), { code: 'MS_BAD_FILE' });
    let pos = 8, ihdr = null;
    const idat = [], extra = [];
    while (pos < b.length) {
        const len = b.readUInt32BE(pos), t = b.toString('latin1', pos + 4, pos + 8), data = b.subarray(pos + 8, pos + 8 + len);
        if (t === 'IHDR') ihdr = data;
        else if (t === 'IDAT') idat.push(data);
        else if (t === 'IEND') break;
        else if (t === 'PLTE' || t === 'tRNS') extra.push(pngChunk(t, Buffer.from(data)));
        pos += 12 + len;
    }
    if (!ihdr) throw Object.assign(new Error('MS_BAD_FILE'), { code: 'MS_BAD_FILE' });
    const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), depth = ihdr[8], type = ihdr[9];
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    if (!ch || ihdr[12] || (depth !== 8 && depth !== 16) || (type === 3 && depth !== 8)) throw Object.assign(new Error('MS_PNG_FORMAT'), { code: 'MS_PNG_FORMAT' });
    return { w, h, depth, type, bpp: ch * depth / 8, ihdr, idat, extra };
}

function pngInfo(b) {
    const p = pngParse(b);
    return { w: p.w, h: p.h, depth: p.depth, type: p.type };
}

function unfilter(f, line, cur, prev, bpp) {
    const n = cur.length;
    for (let i = 0; i < n; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
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
}

// Calls onRow(row, y) for every unfiltered row of the PNG, streaming the inflate.
async function pngRows(p, onRow) {
    const stride = p.w * p.bpp, lineLen = stride + 1;
    const inf = zlib.createInflate();
    p.idat.forEach(d => inf.write(d));
    inf.end();
    let carry = Buffer.alloc(0), y = 0;
    let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
    for await (const chunk of inf) {
        let data = carry.length ? Buffer.concat([carry, chunk]) : chunk, at = 0;
        while (data.length - at >= lineLen && y < p.h) {
            unfilter(data[at], data.subarray(at + 1, at + lineLen), cur, prev, p.bpp);
            await onRow(cur, y++);
            const t = prev; prev = cur; cur = t;
            at += lineLen;
        }
        carry = Buffer.from(data.subarray(at));
    }
    if (y !== p.h) throw Object.assign(new Error('MS_BAD_FILE'), { code: 'MS_BAD_FILE' });
}

// A height map has 2^n + 1 samples a side (16-bit grey): interpolate between them.
function isHeightGrid(p) {
    return p.depth === 16 && p.type === 0 && p.w === p.h && ((p.w - 1) & (p.w - 2)) === 0 && p.w > 2;
}

async function pngScale(src, file, f, progress) {
    const p = pngParse(src);
    const grid = f === 2 && isHeightGrid(p);
    const w2 = grid ? (p.w - 1) * 2 + 1 : p.w * f, h2 = grid ? (p.h - 1) * 2 + 1 : p.h * f;
    const bpp = p.bpp, stride2 = w2 * bpp;
    const fd = fs.openSync(file, 'w');
    const st = hashNew();
    try {
        const ihdr = Buffer.from(p.ihdr);
        ihdr.writeUInt32BE(w2, 0); ihdr.writeUInt32BE(h2, 4);
        fs.writeSync(fd, Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), ...p.extra]));
        const def = zlib.createDeflate({ level: 6, chunkSize: 1 << 20 });
        def.on('data', d => fs.writeSync(fd, pngChunk('IDAT', d)));
        const done = new Promise((res, rej) => { def.on('end', res); def.on('error', rej); });
        let prevOut = Buffer.alloc(stride2);
        const line = Buffer.alloc(stride2 + 1);
        // Writes one output row, filtered "Sub" (or "Up" when it repeats the last row).
        const put = async row => {
            hashBytes(st, row);
            if (row.equals(prevOut)) { line[0] = 2; line.fill(0, 1); }
            else {
                line[0] = 1;
                for (let i = 0; i < stride2; i++) line[i + 1] = (row[i] - (i >= bpp ? row[i - bpp] : 0)) & 255;
            }
            row.copy(prevOut);
            if (!def.write(Buffer.from(line))) await new Promise(r => def.once('drain', r));
        };
        const wide = Buffer.alloc(stride2), mid = Buffer.alloc(stride2);
        let last = null;
        const widen = (row, dst) => {
            if (!grid) {
                if (f === 1) { row.copy(dst); return; }
                for (let x = 0; x < p.w; x++) {
                    const s = x * bpp, d = 2 * x * bpp;
                    row.copy(dst, d, s, s + bpp); row.copy(dst, d + bpp, s, s + bpp);
                }
                return;
            }
            for (let x = 0; x < p.w; x++) {
                const v = row.readUInt16BE(2 * x);
                dst.writeUInt16BE(v, 4 * x);
                if (x + 1 < p.w) dst.writeUInt16BE((v + row.readUInt16BE(2 * x + 2) + 1) >> 1, 4 * x + 2);
            }
        };
        await pngRows(p, async (row, y) => {
            widen(row, wide);
            if (grid) {
                if (last) {
                    for (let i = 0; i < w2; i++) mid.writeUInt16BE((last.readUInt16BE(2 * i) + wide.readUInt16BE(2 * i) + 1) >> 1, 2 * i);
                    await put(mid);
                }
                await put(wide);
                last = last || Buffer.alloc(stride2);
                wide.copy(last);
            } else {
                for (let k = 0; k < f; k++) await put(wide);
            }
            if (progress && (y & 255) === 255) progress((y + 1) / p.h);
        });
        def.end();
        await done;
        fs.writeSync(fd, pngChunk('IEND', Buffer.alloc(0)));
        fs.closeSync(fd);
        return st.h;
    } catch (e) { try { fs.closeSync(fd); } catch (_) { /* closed */ } throw e; }
}

async function pngHashFile(b) {
    const p = pngParse(b), st = hashNew();
    await pngRows(p, row => { hashBytes(st, row); });
    return st.h;
}

// ---------- dispatch ----------
function kindOf(name) {
    const n = name.toLowerCase();
    if (n.endsWith('.gdm')) return 'gdm';
    if (n.endsWith('.grle')) return 'grle';
    if (n.endsWith('.png')) return 'png';
    return null;
}

function info(name, b) {
    const k = kindOf(name);
    if (k === 'gdm') return gdmInfo(b);
    if (k === 'grle') return grleInfo(b);
    const p = pngInfo(b);
    return { ...p, grid: isHeightGrid({ ...p, bpp: 0 }) };
}

async function scale(name, src, file, f, progress) {
    const k = kindOf(name);
    if (k === 'gdm') return gdmScale(src, file, f, progress);
    if (k === 'grle') return grleScale(src, file, f, progress);
    return pngScale(src, file, f, progress);
}

async function hashFile(name, b) {
    const k = kindOf(name);
    if (k === 'gdm') return gdmHashFile(b);
    if (k === 'grle') return grleHashFile(b);
    return pngHashFile(b);
}

module.exports = { kindOf, info, scale, hashFile, gdmHeader };
