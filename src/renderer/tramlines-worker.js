// Tramlines tool — the heavy work, in its own Node process (forked by
// tramlines.js with ELECTRON_RUN_AS_NODE), so an 8192² density map never
// freezes the window. Keeps the loaded save in memory and answers
// { id, op, args } messages with { id, ok, result | error }.
//
// Library entry = <name>.png (RGBA, the tramlines plus a clear margin to draw in) + <name>.json
// { x, y, w, h, mapSize, px, source, createdAt }. A tramline pixel's RGB is
// the fruits value packed like a grleConverter PNG (R = bits 0-7, ...).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const core = require('./tramlines-core');
const { readMapFarmlands } = require('./savegame-soil');

const FRUITS = 'densityMap_fruits.gdm';
const GROUND = 'densityMap_ground.gdm';
const WEED = 'densityMap_weed.gdm';
const BACKUP_DIR = 'farmer_planner_backup';
const KEEP_BACKUPS = 5;
const THICK_RADIUS = 6;     // no-crop areas (2r+1)² and wider aren't tramlines, at 8192²
const MIN_SPECK_PX = 10;    // smaller separate bits are noise along the field edge
const LAND_SHARE = 0.1;     // a farmland counts for a field from this share of its outline

function backupList(dir, kind = 'fruits') {
    const re = new RegExp('^densityMap_' + kind + '_\\d{8}_\\d{6}\\.gdm$');
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => re.test(f)).sort() : [];
}

let state = null;   // { saveDir, dim, channels, values, soil, ground: { labels, fields } }

function fail(code, extra) {
    const e = new Error(code);
    e.code = code;
    if (extra) e.extra = extra;
    throw e;
}

function readEntry(jsonPath) {
    const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const png = core.decodePng(fs.readFileSync(jsonPath.replace(/\.json$/i, '.png')));
    return { meta, png };
}

function writeEntry(outDir, name, rgba, w, h, x, y, mapSize, source) {
    let px = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) px++;
    fs.mkdirSync(outDir, { recursive: true });
    const base = path.join(outDir, name);
    const img = core.padRgba(rgba, w, h, x, y, mapSize);
    fs.writeFileSync(base + '.png', core.encodePngRgba(img.rgba, img.w, img.h));
    const meta = { x: img.x, y: img.y, w: img.w, h: img.h, mapSize, px, source: source || '', createdAt: new Date().toISOString() };
    fs.writeFileSync(base + '.json', JSON.stringify(meta, null, 2));
    return meta;
}

// RGBA of a whole-map-sized (or any) image -> entry cropped to its visible pixels.
function cropRgba(rgba, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
            if (rgba[row + x * 4 + 3]) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                y1 = y;
            }
        }
    }
    if (x1 < 0) return null;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const out = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
        const s = ((y0 + y) * w + x0) * 4;
        out.set(rgba.subarray(s, s + cw * 4), y * cw * 4);
    }
    return { x: x0, y: y0, w: cw, h: ch, rgba: out };
}

// ---------- masks ----------
// Fills a polygon (pixel coords) into a dim² mask, pixel centres, non-zero
// winding: a lasso that crosses itself leaves no hole, and polygons filled one
// after another add up where they overlap.
function fillPolygon(mask, dim, P) {
    const ys = P.map(p => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(dim - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
        const yc = y + 0.5, xs = [];
        for (let i = 0; i < P.length; i++) {
            const [ax, ay] = P[i], [cx, cy] = P[(i + 1) % P.length];
            if ((ay <= yc) !== (cy <= yc)) xs.push([ax + (yc - ay) * (cx - ax) / (cy - ay), cy > ay ? 1 : -1]);
        }
        xs.sort((a, b) => a[0] - b[0]);
        let wind = 0;
        for (let k = 0; k + 1 < xs.length; k++) {
            wind += xs[k][1];
            if (!wind) continue;
            const from = Math.max(0, Math.ceil(xs[k][0] - 0.5)), to = Math.min(dim - 1, Math.floor(xs[k + 1][0] - 0.5));
            for (let x = from; x <= to; x++) mask[y * dim + x] = 1;
        }
    }
}

// Shrinks a mask by r px (square): keeps a pixel only if the whole
// (2r+1)² square around it is set. Separable: rows, then columns.
function erode(mask, w, h, r) {
    if (r <= 0) return mask;
    const tmp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        let x = 0;
        while (x < w) {
            if (!mask[y * w + x]) { x++; continue; }
            let e = x;
            while (e + 1 < w && mask[y * w + e + 1]) e++;
            for (let k = x + r; k <= e - r; k++) tmp[y * w + k] = 1;
            x = e + 1;
        }
    }
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
        let y = 0;
        while (y < h) {
            if (!tmp[y * w + x]) { y++; continue; }
            let e = y;
            while (e + 1 < h && tmp[(e + 1) * w + x]) e++;
            for (let k = y + r; k <= e - r; k++) out[k * w + x] = 1;
            y = e + 1;
        }
    }
    return out;
}

// Grows a mask by r px (square), the opposite of erode.
function dilate(mask, w, h, r) {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        let until = -1;
        for (let x = 0; x < w; x++) {
            if (mask[row + x]) {
                for (let k = Math.max(until + 1, x - r); k < x; k++) tmp[row + k] = 1;
                until = x + r;
            }
            if (x <= until) tmp[row + x] = 1;
        }
    }
    for (let x = 0; x < w; x++) {
        let until = -1;
        for (let y = 0; y < h; y++) {
            if (tmp[y * w + x]) {
                for (let k = Math.max(until + 1, y - r); k < y; k++) out[k * w + x] = 1;
                until = y + r;
            }
            if (y <= until) out[y * w + x] = 1;
        }
    }
    return out;
}

// Clears separate bits (8-neighbours) smaller than min px from a keep mask.
function dropSpecks(keep, w, h, min) {
    const seen = new Uint8Array(w * h);
    for (let i = 0; i < keep.length; i++) {
        if (!keep[i] || seen[i]) continue;
        const stack = [i], part = [i];
        seen[i] = 1;
        while (stack.length) {
            const p = stack.pop(), x = p % w, y = (p / w) | 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const n = ny * w + nx;
                if (keep[n] && !seen[n]) {
                    seen[n] = 1;
                    stack.push(n);
                    if (part.length < min) part.push(n);
                }
            }
        }
        if (part.length < min) part.forEach(n => { keep[n] = 0; });
    }
}

// The save's worked soil: { dim, cell, nz } (nz = 1 where densityMap_ground
// isn't 0), or null when the file can't be used. Tramlines lie on worked soil.
function soilOf() {
    if (state.soil !== undefined) return state.soil;
    state.soil = null;
    try {
        const g = core.gdmDecode(fs.readFileSync(path.join(state.saveDir, GROUND)));
        const cell = state.dim / g.dim;
        if (cell >= 1 && cell === Math.floor(cell)) {
            const nz = new Uint8Array(g.dim * g.dim);
            for (let i = 0; i < nz.length; i++) nz[i] = g.values[i] ? 1 : 0;
            state.soil = { dim: g.dim, cell, nz };
        }
    } catch (e) { /* no soil map: the no-crop pixels aren't narrowed down by it */ }
    return state.soil;
}

// Adds to `mask` the soil the seed outlines really stand on: flooded from the
// worked soil inside them, along worked soil, within their farmlands. A field
// merged in the game or worked past its outline is covered as a whole, while a
// neighbour behind unworked ground stays out.
function growOverLand(mask, dim, seed) {
    const soil = soilOf();
    let fl = null;
    try { fl = readMapFarmlands(path.join(state.saveDir, 'careerSavegame.xml')); } catch (e) { /* outline only */ }
    if (!soil || !fl || !fl.ok) return;
    const fw = fl.w / dim, fh = fl.h / dim;
    const landAt = i => fl.data[Math.floor(((i / dim) | 0) * fh) * fl.w + Math.floor((i % dim) * fw)];
    const soilAt = i => soil.nz[Math.floor(((i / dim) | 0) / soil.cell) * soil.dim + Math.floor((i % dim) / soil.cell)];
    const counts = new Map();
    let total = 0;
    for (let i = 0; i < seed.length; i++) {
        if (!seed[i]) continue;
        const id = landAt(i);
        total++;
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    const lands = new Set([...counts].filter(([, n]) => n >= total * LAND_SHARE).map(([id]) => id));
    if (!lands.size) return;
    const seen = new Uint8Array(dim * dim), stack = [];
    const take = i => { if (!seen[i] && soilAt(i) && lands.has(landAt(i))) { seen[i] = 1; mask[i] = 1; stack.push(i); } };
    for (let i = 0; i < seed.length; i++) if (seed[i]) take(i);
    while (stack.length) {
        const i = stack.pop(), x = i % dim;
        if (x) take(i - 1);
        if (x < dim - 1) take(i + 1);
        if (i >= dim) take(i - dim);
        if (i < dim * (dim - 1)) take(i + dim);
    }
}

// ---------- ops ----------
const ops = {
    load({ saveDir }) {
        state = null;
        const d = fs.readFileSync(path.join(saveDir, FRUITS));
        const r = core.gdmDecode(d);
        state = { saveDir, dim: r.dim, channels: r.channels, values: r.values, ground: null, soil: undefined };
        return { dim: r.dim, channels: r.channels };
    },

    unload() { state = null; return true; },

    pick({ x, y }) {
        if (!state) fail('TL_NOT_LOADED');
        x = Math.floor(x); y = Math.floor(y);
        if (x < 0 || y < 0 || x >= state.dim || y >= state.dim) return null;
        return state.values[y * state.dim + x];
    },

    // Viewport: (x0, y0) = map pixel at the canvas corner, scale = canvas px per
    // map px. Zoomed out, a canvas pixel shows its block's first pixel, or the
    // highlight colour if any pixel of the block has a picked colour.
    view({ x0, y0, scale, w, h, colors, highlight }) {
        if (!state) fail('TL_NOT_LOADED');
        const { dim, values } = state;
        const out = new Uint8ClampedArray(w * h * 4);
        const set = new Set(highlight ? colors || [] : []);
        const step = scale < 1 ? Math.ceil(1 / scale) : 1;
        for (let sy = 0; sy < h; sy++) {
            const my = Math.floor(y0 + sy / scale);
            for (let sx = 0; sx < w; sx++) {
                const mx = Math.floor(x0 + sx / scale);
                const o = (sy * w + sx) * 4;
                if (mx < 0 || my < 0 || mx >= dim || my >= dim) { out[o] = 24; out[o + 1] = 32; out[o + 2] = 28; out[o + 3] = 255; continue; }
                let v = values[my * dim + mx], hit = set.size && set.has(v);
                if (!hit && set.size && step > 1) {
                    const ye = Math.min(dim, my + step), xe = Math.min(dim, mx + step);
                    for (let yy = my; yy < ye && !hit; yy++) for (let xx = mx; xx < xe; xx++) if (set.has(values[yy * dim + xx])) { hit = true; break; }
                }
                if (hit) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 255; }
                else { out[o] = v & 255; out[o + 1] = (v >> 8) & 255; out[o + 2] = (v >> 16) & 255; }
                out[o + 3] = 255;
            }
        }
        return out;
    },

    // Fields from densityMap_ground: a field = a 4-connected area of non-zero
    // pixels (black = no soil; neighbouring fields are split by a black line).
    // The ground map may be coarser than fruits (whole multiple): labels stay
    // at its resolution. The soil is shrunk by `edge` fruits px only to tell
    // fields apart where a thin strip joins them; each then grows back over all
    // its soil, so nothing along its edge is lost.
    groundFields({ minPx, edge }) {
        if (!state) fail('TL_NOT_LOADED');
        const soil = soilOf();
        if (!soil) fail('TL_GROUND_SIZE');
        const gd = soil.dim, cell = soil.cell, nz = soil.nz;
        let mask = erode(nz, gd, gd, Math.ceil((edge || 0) / cell));
        // Two-pass labelling with union-find (4-neighbours).
        const lab = new Int32Array(gd * gd);
        const parent = [0];
        const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
        for (let y = 0; y < gd; y++) for (let x = 0; x < gd; x++) {
            const i = y * gd + x;
            if (!mask[i]) continue;
            const up = y ? lab[i - gd] : 0, left = x ? lab[i - 1] : 0;
            if (!up && !left) { parent.push(parent.length); lab[i] = parent.length - 1; }
            else if (up && left) {
                const a = find(up), b = find(left);
                lab[i] = Math.min(a, b);
                if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
            } else lab[i] = up || left;
        }
        mask = null;
        for (let i = 0; i < lab.length; i++) if (lab[i]) lab[i] = find(lab[i]);
        // Grow back, one pixel ring at a time, over the soil the shrinking took.
        let ring = [];
        const spread = (i, l) => { if (nz[i] && !lab[i]) { lab[i] = l; ring.push(i); } };
        const around = (i, l) => {
            const x = i % gd;
            if (x) spread(i - 1, l);
            if (x < gd - 1) spread(i + 1, l);
            if (i >= gd) spread(i - gd, l);
            if (i < gd * (gd - 1)) spread(i + gd, l);
        };
        for (let i = 0; i < lab.length; i++) if (lab[i]) around(i, lab[i]);
        while (ring.length) {
            const now = ring;
            ring = [];
            for (let k = 0; k < now.length; k++) around(now[k], lab[now[k]]);
        }
        const area = new Map(), box = new Map();
        for (let i = 0; i < lab.length; i++) {
            if (!lab[i]) continue;
            const l = lab[i];
            area.set(l, (area.get(l) || 0) + 1);
            const x = i % gd, y = (i / gd) | 0, b = box.get(l);
            if (!b) box.set(l, [x, y, x, y]);
            else { if (x < b[0]) b[0] = x; if (x > b[2]) b[2] = x; if (y < b[1]) b[1] = y; if (y > b[3]) b[3] = y; }
        }
        const fields = [];
        const keep = new Map();
        [...area.entries()].filter(([, a]) => a * cell * cell >= (minPx || 0)).forEach(([l, a]) => {
            const b = box.get(l);
            keep.set(l, fields.length + 1);
            fields.push({ label: fields.length + 1, bbox: [b[0] * cell, b[1] * cell, (b[2] + 1) * cell, (b[3] + 1) * cell], px: a * cell * cell });
        });
        if (fields.length > 65535) fail('TL_TOO_MANY');
        const labels = new Uint16Array(gd * gd);
        for (let i = 0; i < lab.length; i++) if (lab[i]) labels[i] = keep.get(lab[i]) || 0;
        state.ground = { labels, dim: gd, cell, fields };
        // Sorted in reading order (bands of 256 px), like program-sciezki.
        return fields.slice().sort((a, b) => Math.floor(a.bbox[1] / 256) - Math.floor(b.bbox[1] / 256) || a.bbox[0] - b.bbox[0]);
    },

    // Cuts tramlines into a library entry. area (map pixels): { polys: [...] }
    // exactly as drawn, { growPolys: [...] } grown over the farmland's worked
    // soil, or { labels: [..] } from groundFields. colors: values that count as
    // tramlines (empty = every pixel in the area). The no-crop value also needs
    // worked soil and a narrow shape: the same value covers everything outside
    // fields and unsown ground, which aren't tramlines.
    cut({ area, colors, outDir, name }) {
        if (!state) fail('TL_NOT_LOADED');
        const { dim, values } = state;
        const inArea = new Uint8Array(dim * dim);
        if (area.labels) {
            const g = state.ground;
            if (!g) fail('TL_NOT_LOADED');
            const ids = new Set(area.labels);
            if (!g.fields.some(f => ids.has(f.label))) fail('TL_EMPTY');
            for (let i = 0; i < inArea.length; i++) {
                if (ids.has(g.labels[Math.floor(((i / dim) | 0) / g.cell) * g.dim + Math.floor((i % dim) / g.cell)])) inArea[i] = 1;
            }
        }
        (area.polys || []).forEach(P => fillPolygon(inArea, dim, P));
        if (area.growPolys && area.growPolys.length) {
            const seed = new Uint8Array(dim * dim);
            area.growPolys.forEach(P => fillPolygon(seed, dim, P));
            for (let i = 0; i < seed.length; i++) if (seed[i]) inArea[i] = 1;
            growOverLand(inArea, dim, seed);
        }
        let x0 = dim, y0 = dim, x1 = -1, y1 = -1;
        for (let y = 0; y < dim; y++) {
            const row = y * dim;
            for (let x = 0; x < dim; x++) {
                if (!inArea[row + x]) continue;
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                y1 = y;
            }
        }
        if (x1 < 0) fail('TL_OUTSIDE');
        const set = new Set(colors || []), anyPixel = !set.size;
        // Over a region wider than the area, so the area's own edge doesn't
        // make a wide no-crop stretch look narrow.
        const r = Math.max(THICK_RADIUS, Math.round(THICK_RADIUS * dim / 8192));
        const rx = Math.max(0, x0 - r), ry = Math.max(0, y0 - r);
        const rw = Math.min(dim, x1 + r + 1) - rx, rh = Math.min(dim, y1 + r + 1) - ry;
        const keep = new Uint8Array(rw * rh);
        if (anyPixel) {
            for (let i = 0; i < keep.length; i++) keep[i] = inArea[(ry + ((i / rw) | 0)) * dim + rx + i % rw];
        } else {
            const soil = soilOf(), noCrop = new Uint8Array(rw * rh);
            if (set.has(0)) {
                for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
                    const mx = rx + x, my = ry + y;
                    if (values[my * dim + mx] !== 0) continue;
                    if (soil && !soil.nz[Math.floor(my / soil.cell) * soil.dim + Math.floor(mx / soil.cell)]) continue;
                    noCrop[y * rw + x] = 1;
                }
            }
            const wide = dilate(erode(noCrop, rw, rh, r), rw, rh, r);
            for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
                const i = (ry + y) * dim + rx + x, o = y * rw + x;
                if (!inArea[i]) continue;
                const v = values[i];
                if (v === 0 ? noCrop[o] && !wide[o] : set.has(v)) keep[o] = 1;
            }
            dropSpecks(keep, rw, rh, MIN_SPECK_PX);
        }
        const rgba = new Uint8Array(rw * rh * 4);
        for (let o = 0; o < keep.length; o++) {
            if (!keep[o]) continue;
            const v = values[(ry + ((o / rw) | 0)) * dim + rx + o % rw];
            rgba[o * 4] = v & 255; rgba[o * 4 + 1] = (v >> 8) & 255; rgba[o * 4 + 2] = (v >> 16) & 255; rgba[o * 4 + 3] = 255;
        }
        const c = cropRgba(rgba, rw, rh);
        if (!c) fail('TL_EMPTY');
        return writeEntry(outDir, name, c.rgba, c.w, c.h, rx + c.x, ry + c.y, dim, path.basename(state.saveDir));
    },

    // Pastes entries into a save: backup, decode, overwrite the fruits pixels
    // with alpha >= threshold and clear the weeds under them, encode, verify,
    // then replace the files. Both maps change together or not at all.
    paste({ saveDir, entries, threshold, converter }) {
        const target = path.join(saveDir, FRUITS), weedTarget = path.join(saveDir, WEED);
        const orig = fs.readFileSync(target);
        const weedOrig = fs.existsSync(weedTarget) ? fs.readFileSync(weedTarget) : null;
        const backupDir = path.join(saveDir, BACKUP_DIR);
        fs.mkdirSync(backupDir, { recursive: true });
        const d = new Date(), p2 = n => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
        const backup = path.join(backupDir, `densityMap_fruits_${stamp}.gdm`);
        fs.writeFileSync(backup, orig);
        if (!fs.readFileSync(backup).equals(orig)) fail('TL_BACKUP');
        if (weedOrig) {
            const weedBackup = path.join(backupDir, `densityMap_weed_${stamp}.gdm`);
            fs.writeFileSync(weedBackup, weedOrig);
            if (!fs.readFileSync(weedBackup).equals(weedOrig)) fail('TL_BACKUP');
        }

        const { dim, values } = core.gdmDecode(orig);
        const weed = weedOrig ? core.gdmDecode(weedOrig) : null;
        const counts = [];
        let weedCleared = 0;
        entries.forEach(file => {
            const { meta, png } = readEntry(file);
            if (meta.mapSize !== dim) fail('TL_SIZE', { name: path.basename(file, '.json'), size: meta.mapSize, dim });
            let n = 0;
            for (let y = 0; y < png.h; y++) {
                const my = meta.y + y;
                if (my < 0 || my >= dim) continue;
                for (let x = 0; x < png.w; x++) {
                    const mx = meta.x + x, o = (y * png.w + x) * 4;
                    if (mx < 0 || mx >= dim || png.rgba[o + 3] < threshold) continue;
                    values[my * dim + mx] = core.packRgb(png.rgba[o], png.rgba[o + 1], png.rgba[o + 2]);
                    n++;
                    if (weed) {
                        // The weed map can have another resolution: every pixel touching this one.
                        const wd = weed.dim, wx1 = Math.ceil((mx + 1) * wd / dim), wy1 = Math.ceil((my + 1) * wd / dim);
                        for (let wy = Math.floor(my * wd / dim); wy < wy1; wy++) for (let wx = Math.floor(mx * wd / dim); wx < wx1; wx++) {
                            if (weed.values[wy * wd + wx]) { weed.values[wy * wd + wx] = 0; weedCleared++; }
                        }
                    }
                }
            }
            counts.push({ name: path.basename(file, '.json'), px: n });
        });

        const tmp = target + '.farmer_planner_tmp', weedTmp = weedTarget + '.farmer_planner_tmp';
        // Verify before anything in the save changes.
        const encodeChecked = (vals, template, file) => {
            const out = core.gdmEncode(vals, template);
            const check = core.gdmDecode(out).values;
            for (let i = 0; i < vals.length; i++) if (check[i] !== vals[i]) fail('TL_VERIFY');
            fs.writeFileSync(file, out);
            if (converter) verifyWithConverter(converter, file, vals, backupDir);
        };
        try {
            encodeChecked(values, orig, tmp);
            if (weedCleared) encodeChecked(weed.values, weedOrig, weedTmp);
            fs.renameSync(tmp, target);
            if (weedCleared) {
                try { fs.renameSync(weedTmp, weedTarget); }
                catch (e) { fs.writeFileSync(target, orig); throw e; }
            }
        } finally {
            [tmp, weedTmp].forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* replaced or never written */ } });
        }
        if (state && path.resolve(state.saveDir) === path.resolve(saveDir)) state.values = values;
        // Each backup is the whole map (tens of MB): keep the newest few.
        const kept = backupList(backupDir).slice(-KEEP_BACKUPS);
        backupList(backupDir).slice(0, -KEEP_BACKUPS).forEach(f => fs.rmSync(path.join(backupDir, f), { force: true }));
        backupList(backupDir, 'weed').filter(f => !kept.includes(f.replace('_weed_', '_fruits_'))).forEach(f => fs.rmSync(path.join(backupDir, f), { force: true }));
        return { backup, counts, weedCleared };
    },

    // Puts the newest backup back: the fruits map and the weed map saved with it.
    restore({ saveDir }) {
        const dir = path.join(saveDir, BACKUP_DIR);
        const list = backupList(dir);
        if (!list.length) fail('TL_NO_BACKUP');
        const last = path.join(dir, list[list.length - 1]);
        const lastWeed = last.replace('densityMap_fruits_', 'densityMap_weed_');
        if (fs.existsSync(lastWeed)) fs.copyFileSync(lastWeed, path.join(saveDir, WEED));
        fs.copyFileSync(last, path.join(saveDir, FRUITS));
        if (state && path.resolve(state.saveDir) === path.resolve(saveDir)) state = null;
        return last;
    },

    // PNGs (program-sciezki library: whole-map RGBA, transparent outside the
    // tramlines) -> cropped entries.
    importPngs({ files, outDir }) {
        const done = [];
        files.forEach(file => {
            const png = core.decodePng(fs.readFileSync(file));
            const c = cropRgba(png.rgba, png.w, png.h);
            if (!c) return;
            const name = safeName(path.basename(file).replace(/\.png$/i, ''));
            writeEntry(outDir, name, c.rgba, c.w, c.h, c.x, c.y, png.w, path.basename(file));
            done.push(name);
        });
        return done;
    },

    // GIMP .xcf: every layer (not groups, not empty, not fully opaque) -> an entry.
    importXcf({ file, outDir }) {
        const d = fs.readFileSync(file);
        const x = core.xcfOpen(d);
        const done = [];
        x.layers.filter(l => !l.group).forEach(l => {
            const img = core.xcfLayerRgba(d, l);
            let opaque = true;
            for (let i = 3; i < img.rgba.length && opaque; i += 4) if (img.rgba[i] !== 255) opaque = false;
            if (opaque) return;
            const c = cropRgba(img.rgba, img.w, img.h);
            if (!c) return;
            const name = safeName(l.name);
            writeEntry(outDir, name, c.rgba, c.w, c.h, l.ox + c.x, l.oy + c.y, x.w, path.basename(file));
            done.push(name);
        });
        return done;
    },

    // Entry -> whole-map RGBA PNG (for GIMP or program-sciezki).
    exportFull({ entry, outPath }) {
        const { meta, png } = readEntry(entry);
        const dim = meta.mapSize;
        const full = new Uint8Array(dim * dim * 4);
        for (let y = 0; y < png.h; y++) {
            const my = meta.y + y;
            if (my < 0 || my >= dim) continue;
            const x0 = Math.max(0, meta.x), x1 = Math.min(dim, meta.x + png.w);
            if (x1 <= x0) continue;
            full.set(png.rgba.subarray((y * png.w + (x0 - meta.x)) * 4, (y * png.w + (x1 - meta.x)) * 4), (my * dim + x0) * 4);
        }
        fs.writeFileSync(outPath, core.encodePngRgba(full, dim, dim));
        return outPath;
    }
};

function safeName(s) {
    return String(s).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '') || 'field';
}

// Optional extra check with GIANTS grleConverter: its PNG of the new GDM must
// hold the same values (its reading = the game's).
function verifyWithConverter(exe, gdmPath, values, workDir) {
    const out = path.join(workDir, 'verify.png');
    try {
        execFileSync(exe, [gdmPath, '-out', out], { windowsHide: true, timeout: 120000 });
        const png = core.decodePng(fs.readFileSync(out));
        if (png.w * png.h !== values.length) fail('TL_VERIFY_CONVERTER');
        for (let i = 0; i < values.length; i++) {
            const v = png.grey ? png.rgba[i * 4] : core.packRgb(png.rgba[i * 4], png.rgba[i * 4 + 1], png.rgba[i * 4 + 2]);
            if (v !== (png.grey ? values[i] & 255 : values[i] & 0xffffff)) fail('TL_VERIFY_CONVERTER');
        }
    } catch (e) {
        try { fs.unlinkSync(gdmPath); } catch (_) { /* already gone */ }
        throw e.code ? e : Object.assign(new Error('TL_CONVERTER'), { code: 'TL_CONVERTER', extra: { msg: e.message } });
    } finally {
        try { fs.unlinkSync(out); } catch (_) { /* not written */ }
    }
}

process.on('message', msg => {
    const { id, op, args } = msg || {};
    try {
        if (!ops[op]) fail('TL_BAD_OP');
        const result = ops[op](args || {});
        process.send({ id, ok: true, result });
    } catch (e) {
        process.send({ id, ok: false, error: e.code || 'TL_ERROR', extra: e.extra || { msg: e.message } });
    }
});
