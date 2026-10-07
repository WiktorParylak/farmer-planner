// Per-field soil composition straight from the game files — the same numbers
// Precision Farming shows in-game, which it never saves: it counts soil-map
// pixels inside each field polygon at runtime. We do the same:
//   savegame/precisionFarming_soilMap.grle  soil type per 2 m pixel (value & 3 =
//                                           PF soilTypeIndex 1..4; bit 4 = sampled)
//   <map>.i3d  gameplay/fields/fieldNN/polygonPoints   field outlines (no margins)
//   <map>.i3d  InfoLayer "farmlands"        farmland id per pixel -> field id
// The map is found from careerSavegame.xml <mapId> ("FS25_Solek.SampleModMap"
// -> mods/FS25_Solek, unpacked folder or .zip). Base-game maps live inside the
// game's archives and aren't supported.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { locateMod } = require('./mod-locator');

// --- Map source: an unpacked mod folder or a mod .zip -----------------------
// Reads only the central directory and the requested entries (map mods can be
// well over 1 GB, so the archive is never loaded whole).
function openZip(zipPath) {
    const fd = fs.openSync(zipPath, 'r');
    const size = fs.fstatSync(fd).size;
    const readAt = (pos, len) => { const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, pos); return buf; };
    const tailLen = Math.min(size, 65557);
    const tail = readAt(size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) { fs.closeSync(fd); throw new Error('not a zip: ' + zipPath); }
    const count = tail.readUInt16LE(eocd + 10);
    const cd = readAt(tail.readUInt32LE(eocd + 16), tail.readUInt32LE(eocd + 12));
    const entries = {};
    let p = 0;
    for (let n = 0; n < count; n++) {
        const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20);
        const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
        const local = cd.readUInt32LE(p + 42);
        const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
        entries[name.toLowerCase()] = { method, csize, local };
        p += 46 + nameLen + extraLen + commentLen;
    }
    return {
        read(rel) {
            const e = entries[rel.replace(/\\/g, '/').toLowerCase()];
            if (!e) return null;
            const lh = readAt(e.local, 30);
            const data = readAt(e.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28), e.csize);
            return e.method === 0 ? data : zlib.inflateRawSync(data);
        },
        // Entry paths (lower-cased) directly inside folder `prefix` ("xmls/").
        list(prefix) {
            const p = prefix.toLowerCase();
            return Object.keys(entries).filter(n => n.startsWith(p) && n.length > p.length && !n.slice(p.length).includes('/'));
        },
        close() { fs.closeSync(fd); }
    };
}

function openMod(modsDir, modName) {
    const dir = path.join(modsDir, modName);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return {
            read: rel => { const f = path.join(dir, rel); return fs.existsSync(f) ? fs.readFileSync(f) : null; },
            list: prefix => {
                try {
                    return fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })
                        .filter(e => e.isFile()).map(e => (prefix + e.name).toLowerCase());
                } catch { return []; }
            },
            close() {}
        };
    }
    const zip = dir + '.zip';
    if (fs.existsSync(zip)) return openZip(zip);
    return null;
}

// FS lets the player move the mods folder (gameSettings.xml modsDirectoryOverride).
function findModsDir(gameDir) {
    try {
        const gs = fs.readFileSync(path.join(gameDir, 'gameSettings.xml'), 'utf-8');
        const m = gs.match(/<modsDirectoryOverride\s+active="true"\s+directory="([^"]+)"/);
        if (m && fs.existsSync(m[1])) return m[1];
    } catch { /* no settings file — default location */ }
    return path.join(gameDir, 'mods');
}

// --- Bitmap layers ------------------------------------------------------------
// GRLE: 21-byte header (width/height as u16 multiples of 256 at 6 / 10), then
// RLE — a byte, and if the next byte repeats it, a run length (0xFF bytes
// summed + a final byte) of further copies.
function decodeGrle(b) {
    const w = b.readUInt16LE(6) * 256, h = b.readUInt16LE(10) * 256;
    const out = Buffer.alloc(w * h);
    let i = 21, o = 0;
    while (i < b.length && o < out.length) {
        const v = b[i++];
        out[o++] = v;
        if (i < b.length && b[i] === v) {
            i++;
            let n = 0;
            while (b[i] === 255) { n += 255; i++; }
            n += b[i++];
            out.fill(v, o, Math.min(out.length, o + n + 1));
            o += n + 1;
        }
    }
    return { w, h, data: out };
}

// 8-bit greyscale PNG (what map info layers are authored as).
function decodePngGray(b) {
    let p = 8, w = 0, h = 0, bpp = 1;
    const idat = [];
    while (p < b.length) {
        const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') {
            w = d.readUInt32BE(0); h = d.readUInt32BE(4);
            if (d[8] !== 8) throw new Error('unsupported PNG bit depth');
            bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[d[9]] || 1;
        }
        if (type === 'IDAT') idat.push(d);
        p += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * bpp, full = Buffer.alloc(stride * h);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const cur = full.subarray(y * stride, (y + 1) * stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
            let v = src[x];
            if (f === 1) v += a;
            else if (f === 2) v += up;
            else if (f === 3) v += (a + up) >> 1;
            else if (f === 4) {
                const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? up : c);
            }
            cur[x] = v & 255;
        }
        prev = cur;
    }
    if (bpp === 1) return { w, h, data: full };
    const data = Buffer.alloc(w * h);
    for (let k = 0; k < w * h; k++) data[k] = full[k * bpp];
    return { w, h, data };
}

// An i3d <File> is authored as .png but the game ships/uses the .grle beside it.
function readLayer(mod, rel) {
    const grle = mod.read(rel.replace(/\.png$/i, '.grle'));
    if (grle) return decodeGrle(grle);
    const png = mod.read(rel);
    return png ? decodePngGray(png) : null;
}

function infoLayerFile(i3d, layerName) {
    const m = i3d.match(new RegExp('<InfoLayer\\s+name="' + layerName + '"\\s+fileId="(\\d+)"'));
    if (!m) return null;
    const f = i3d.match(new RegExp('<File\\s+fileId="' + m[1] + '"\\s+filename="([^"]+)"'));
    return f ? f[1] : null;
}

// --- Field polygons -----------------------------------------------------------
// gameplay > fields > fieldNN > polygonPoints > point*, each a TransformGroup
// with a local translation (and optionally a Y rotation) — composed up the
// chain to world x/z (map centre = 0,0).
function readFieldPolygons(i3d) {
    const start = i3d.indexOf('<TransformGroup name="fields"');
    if (start < 0) return [];
    const re = /<(\/?)TransformGroup\b([^>]*?)(\/?)>/g;
    re.lastIndex = start;
    const vec = (s, a) => { const r = s.match(new RegExp(' ' + a + '="([^"]*)"')); return r ? r[1].trim().split(/\s+/).map(Number) : null; };
    const toWorld = (chain, px, pz) => {
        for (let i = chain.length - 1; i >= 0; i--) {
            const n = chain[i], a = (n.r ? n.r[1] : 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
            const nx = px * c + pz * s, nz = -px * s + pz * c;
            px = nx + n.t[0]; pz = nz + n.t[2];
        }
        return [px, pz];
    };
    const stack = [], fields = [];
    let m;
    while ((m = re.exec(i3d))) {
        if (m[1]) { stack.pop(); if (!stack.length) break; continue; }
        const node = { name: (m[2].match(/name="([^"]*)"/) || [])[1] || '', t: vec(m[2], 'translation') || [0, 0, 0], r: vec(m[2], 'rotation') };
        const parent = stack[stack.length - 1];
        if (parent && parent.name === 'polygonPoints' && stack.length >= 2) {
            const field = stack[stack.length - 2];
            if (!field.pts) { field.pts = []; fields.push(field); }
            field.pts.push(toWorld(stack, node.t[0], node.t[2]));
        }
        if (!m[3]) stack.push(node);
    }
    return fields.filter(f => f.pts.length >= 3);
}

// PrecisionFarming.xml <pHMap><valueTransformations>: optimal pH per soil type
// (soil map 0..3 = loamySand, sandyLoam, loam, siltyClay) and its pH state.
const PH_OPTIMAL = [6.0, 6.5, 6.75, 7.0];
const PH_OPTIMAL_STATE = PH_OPTIMAL.map(v => Math.round((v - 4.375) / 0.125));
// <limeUsage usagePerState="730">: litres per ha per 0.125 pH step.
const LIME_L_PER_STATE = 730;

// --- Main entry ---------------------------------------------------------------
// Returns { ok:true, mapTitle, fields: { "<fieldId>": { ha, counts:[4 soils] } } }
// or { ok:false, reason } with reason one of nopath | nosave | nomapid |
// nomod | nomap | nofields | nosoil | parse.
function readFieldSoilFromSave(careerSavegamePath) {
    let mod = null;
    try {
        if (!careerSavegamePath || !fs.existsSync(careerSavegamePath)) return { ok: false, reason: 'nosave' };
        const saveDir = path.dirname(careerSavegamePath);
        const career = fs.readFileSync(careerSavegamePath, 'utf-8');
        const mapId = (career.match(/<mapId>([^<]+)<\/mapId>/) || [])[1];
        const mapTitle = (career.match(/<mapTitle>([^<]+)<\/mapTitle>/) || [])[1] || '';
        if (!mapId || mapId.indexOf('.') < 0) return { ok: false, reason: 'nomapid' };

        const modName = mapId.split('.')[0];
        const modsDir = locateMod(careerSavegamePath, modName);
        mod = modsDir ? openMod(modsDir, modName) : null;
        if (!mod) return { ok: false, reason: 'nomod', modName };

        const modDesc = (mod.read('modDesc.xml') || '').toString('utf-8');
        const cfgRel = (modDesc.match(/<map\b[^>]*configFilename="([^"]+)"/) || [])[1];
        const cfg = cfgRel ? (mod.read(cfgRel) || '').toString('utf-8') : '';
        const i3dRel = (cfg.match(/<filename>\s*([^<\s]+)\s*<\/filename>/) || [])[1];
        const i3dBuf = i3dRel ? mod.read(i3dRel) : null;
        if (!i3dBuf) return { ok: false, reason: 'nomap', modName };
        const i3d = i3dBuf.toString('utf-8');
        const mapSize = parseFloat((cfg.match(/<map\b[^>]*\swidth="([\d.]+)"/) || [])[1]) || 2048;
        const i3dDir = path.posix.dirname(i3dRel.replace(/\\/g, '/'));

        const fields = readFieldPolygons(i3d);
        const flFile = infoLayerFile(i3d, 'farmlands');
        const farmlands = flFile ? readLayer(mod, path.posix.join(i3dDir, flFile)) : null;
        if (!fields.length || !farmlands) return { ok: false, reason: 'nofields', modName };

        // The savegame copy is the live one (and carries the "sampled" bit);
        // fall back to the map's own soil layer before the first save with PF.
        const saveSoil = path.join(saveDir, 'precisionFarming_soilMap.grle');
        let soil = fs.existsSync(saveSoil) ? decodeGrle(fs.readFileSync(saveSoil)) : null;
        if (!soil) {
            const soilFile = infoLayerFile(i3d, 'soilMap');
            soil = soilFile ? readLayer(mod, path.posix.join(i3dDir, soilFile)) : null;
        }
        if (!soil) return { ok: false, reason: 'nosoil', modName };

        // Precision Farming's live pH and nitrogen maps (same grid as the soil
        // map), when the save has them. PrecisionFarming.xml: pH state = bits
        // 0-4, pH = 4.375 + state × 0.125 (state 0 = no data); nitrogen state =
        // bits 0-5, kg N/ha = (state - 1) × 5.
        const readSaveLayer = name => {
            const p = path.join(saveDir, name);
            if (!fs.existsSync(p)) return null;
            const layer = decodeGrle(fs.readFileSync(p));
            return layer && layer.w === soil.w && layer.h === soil.h ? layer : null;
        };
        const phMap = readSaveLayer('precisionFarming_phMap.grle');
        const nMap = readSaveLayer('precisionFarming_nitrogenMap.grle');

        // Rasterise each polygon on the farmland grid (finest of the two
        // layers), sampling soil at each pixel centre.
        const res = farmlands.w, scale = res / mapSize, soilStep = soil.w / res;
        const pxArea = (mapSize / res) * (mapSize / res);
        const out = {};
        fields.forEach(f => {
            const P = f.pts.map(([wx, wz]) => [(wx + mapSize / 2) * scale, (wz + mapSize / 2) * scale]);
            const ys = P.map(p => p[1]);
            const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(res - 1, Math.ceil(Math.max(...ys)));
            const counts = [0, 0, 0, 0], farmVotes = {};
            let n = 0;
            // pH: sum of states and lime states short of each pixel's soil optimum.
            let phN = 0, phSum = 0, limeStates = 0, nN = 0, nSum = 0;
            for (let y = y0; y <= y1; y++) {
                const yc = y + 0.5, xs = [];
                for (let i = 0; i < P.length; i++) {
                    const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length];
                    if ((ay <= yc) !== (by <= yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
                }
                xs.sort((a, b) => a - b);
                const soilRow = Math.floor(y * soilStep) * soil.w;
                for (let k = 0; k + 1 < xs.length; k += 2) {
                    for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x + 0.5 < xs[k + 1] && x < res; x++) {
                        n++;
                        const si = soilRow + Math.floor(x * soilStep);
                        const soilType = soil.data[si] & 3;
                        counts[soilType]++;
                        if (phMap) {
                            const ph = phMap.data[si] & 31;
                            if (ph) {
                                phN++;
                                phSum += ph;
                                limeStates += Math.max(0, PH_OPTIMAL_STATE[soilType] - ph);
                            }
                        }
                        if (nMap) {
                            const nv = nMap.data[si] & 63;
                            if (nv) { nN++; nSum += nv - 1; }
                        }
                        const fid = farmlands.data[y * res + x];
                        if (fid) farmVotes[fid] = (farmVotes[fid] || 0) + 1;
                    }
                }
            }
            if (!n) return;
            // Field id = the farmland the polygon sits on (FS25 numbers fields
            // after their farmland); the node name ("field168") as a fallback.
            const best = Object.entries(farmVotes).sort((a, b) => b[1] - a[1])[0];
            const id = best ? best[0] : ((f.name.match(/(\d+)$/) || [])[1] || '').replace(/^0+/, '');
            if (!id) return;
            const prev = out[id];
            const pf = { phN, phSum, limeStates, nN, nSum, px: n, pxHa: pxArea / 10000 };
            if (prev) {
                prev.counts = prev.counts.map((c, i) => c + counts[i]);
                prev.ha += n * pxArea / 10000;
                Object.keys(pf).forEach(k => { if (k !== 'pxHa') prev.pf[k] += pf[k]; });
            } else out[id] = { ha: n * pxArea / 10000, counts, pf };
        });
        // Per field: average pH, the optimum for its soil mix, lime litres to
        // bring every pixel up to its soil's optimum (PF <limeUsage
        // usagePerState="730"> l/ha per 0.125 pH step) and average N kg/ha.
        Object.values(out).forEach(f => {
            const p = f.pf;
            const optimal = f.counts.reduce((s, c, i) => s + c * PH_OPTIMAL[i], 0) / Math.max(1, f.counts.reduce((s, c) => s + c, 0));
            f.ph = p.phN ? { avg: 4.375 + (p.phSum / p.phN) * 0.125, optimal, limeL: p.limeStates * LIME_L_PER_STATE * p.pxHa, coverage: p.phN / p.px } : null;
            f.nitrogen = p.nN ? { avg: (p.nSum / p.nN) * 5, coverage: p.nN / p.px } : null;
            delete f.pf;
        });
        return { ok: true, mapTitle, modName, fields: out, hasPh: !!phMap, hasNitrogen: !!nMap };
    } catch (e) {
        console.error('readFieldSoilFromSave failed', e);
        return { ok: false, reason: 'parse', error: String(e && e.message || e) };
    } finally {
        if (mod) mod.close();
    }
}

// Whole-farmland (land plot) area — what the game shows when buying land:
// field plus margins, meadows, yards. Not stored anywhere; counted from the
// map's "farmlands" info layer like the game does. Owned plots come from the
// savegame's farmland.xml (the player's farmId, 1 in single player).
// Returns { ok:true, mapId, areas: { "<farmlandId>": ha }, owned: [ids] } or
// { ok:false, reason } (same reasons as readFieldSoilFromSave).
function readFarmlandAreas(careerSavegamePath, farmId = '1') {
    let mod = null;
    try {
        if (!careerSavegamePath || !fs.existsSync(careerSavegamePath)) return { ok: false, reason: 'nosave' };
        const saveDir = path.dirname(careerSavegamePath);
        const career = fs.readFileSync(careerSavegamePath, 'utf-8');
        const mapId = (career.match(/<mapId>([^<]+)<\/mapId>/) || [])[1];
        if (!mapId || mapId.indexOf('.') < 0) return { ok: false, reason: 'nomapid' };

        const modName = mapId.split('.')[0];
        const modsDir = locateMod(careerSavegamePath, modName);
        mod = modsDir ? openMod(modsDir, modName) : null;
        if (!mod) return { ok: false, reason: 'nomod', modName };

        const modDesc = (mod.read('modDesc.xml') || '').toString('utf-8');
        const cfgRel = (modDesc.match(/<map\b[^>]*configFilename="([^"]+)"/) || [])[1];
        const cfg = cfgRel ? (mod.read(cfgRel) || '').toString('utf-8') : '';
        const i3dRel = (cfg.match(/<filename>\s*([^<\s]+)\s*<\/filename>/) || [])[1];
        const i3dBuf = i3dRel ? mod.read(i3dRel) : null;
        if (!i3dBuf) return { ok: false, reason: 'nomap', modName };
        const i3d = i3dBuf.toString('utf-8');
        const mapSize = parseFloat((cfg.match(/<map\b[^>]*\swidth="([\d.]+)"/) || [])[1]) || 2048;
        const i3dDir = path.posix.dirname(i3dRel.replace(/\\/g, '/'));

        const flFile = infoLayerFile(i3d, 'farmlands');
        const farmlands = flFile ? readLayer(mod, path.posix.join(i3dDir, flFile)) : null;
        if (!farmlands) return { ok: false, reason: 'nofields', modName };

        const counts = {};
        const d = farmlands.data;
        for (let i = 0; i < d.length; i++) if (d[i]) counts[d[i]] = (counts[d[i]] || 0) + 1;
        const pxHa = (mapSize / farmlands.w) * (mapSize / farmlands.h) / 10000;
        const areas = {};
        Object.keys(counts).forEach(id => { areas[id] = counts[id] * pxHa; });

        const owned = [];
        try {
            const fl = fs.readFileSync(path.join(saveDir, 'farmland.xml'), 'utf-8');
            for (const m of fl.matchAll(/<farmland\s+id="(\d+)"\s+farmId="(\d+)"/g)) if (m[2] === String(farmId)) owned.push(m[1]);
        } catch { /* no farmland.xml yet */ }
        return { ok: true, mapId, modName, areas, owned };
    } catch (e) {
        console.error('readFarmlandAreas failed', e);
        return { ok: false, reason: 'parse', error: String(e && e.message || e) };
    } finally {
        if (mod) mod.close();
    }
}

module.exports = { readFieldSoilFromSave, readFarmlandAreas, openMod, findModsDir };
