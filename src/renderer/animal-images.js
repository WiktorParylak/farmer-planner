// Breed pictures for the Animals panel, read straight from the player's FS25
// mods. Animal definition XMLs (e.g. FS25_AnimalPackage's xmls/animals/*.xml)
// list, per subType, one <visual minAge=".." image=".."> per growth stage;
// the image is a BC7/DXT .dds inside the mod zip. Chromium can't show DDS,
// so each one is decoded once through WebGL's compressed-texture support and
// cached as a small PNG in the app's data folder.
//
// Base-game animals live inside the game's packed .gar archives, which we
// can't read — those (and anything else not found) fall back to icons.

const fs = require('fs');
const path = require('path');
const { readZipDirectory, readZipEntry, findModsDir } = require('./mod-files');

const INDEX_VERSION = 2;
const PICTURE_SIZE = 192;

// --- Animal XML -> { visuals: { SUBTYPE: [{ minAge, image }] }, reproduction: { SUBTYPE: {...} } } ---
function parseReproduction(body) {
    const m = body.match(/<reproduction\s([^>]*?)\/?>/i);
    if (!m) return null;
    const attr = (name) => { const a = m[1].match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]+)"', 'i')); return a ? a[1] : null; };
    const num = (name) => { const v = parseFloat(attr(name)); return isNaN(v) ? null : v; };
    return {
        supported: attr('supported') !== 'false',
        minAgeMonth: num('minAgeMonth'),
        durationMonth: num('durationMonth'),
        minHealthFactor: num('minHealthFactor')
    };
}

function parseAnimalDefs(xmlText) {
    const out = { visuals: {}, reproduction: {} };
    if (!/<animals[\s>]/i.test(xmlText) || !/<subType\s/i.test(xmlText)) return out;
    const blocks = xmlText.split(/<subType\s/i).slice(1);
    blocks.forEach(block => {
        const idMatch = block.match(/^[^>]*\bsubType\s*=\s*"([^"]+)"/i);
        if (!idMatch) return;
        const body = block.split(/<\/subType>/i)[0];
        const subType = idMatch[1].toUpperCase();
        const repro = parseReproduction(body);
        if (repro) out.reproduction[subType] = repro;
        const visuals = [];
        const re = /<visual\s([^>]*)>/gi;
        let m;
        while ((m = re.exec(body))) {
            const attrs = m[1];
            const img = attrs.match(/\bimage\s*=\s*"([^"]+)"/i);
            if (!img || /^\$/.test(img[1])) continue;   // $data/... = base game archive
            const age = attrs.match(/\bminAge\s*=\s*"([^"]+)"/i);
            visuals.push({ minAge: age ? parseFloat(age[1]) || 0 : 0, image: img[1].replace(/\\/g, '/') });
        }
        if (visuals.length) out.visuals[subType] = visuals.sort((a, b) => a.minAge - b.minAge);
    });
    return out;
}

// The image attribute names a .png, but mods ship the .dds the game really
// loads — try the .dds first, then the name as written.
function imageCandidates(image) {
    const base = image.replace(/\.(png|dds)$/i, '');
    return [base + '.dds', image];
}

function modsSignature(modsDir) {
    try {
        return fs.readdirSync(modsDir).map(name => {
            try { const st = fs.statSync(path.join(modsDir, name)); return `${name}:${st.size}:${Math.round(st.mtimeMs)}`; }
            catch (e) { return name; }
        }).sort().join('|');
    } catch (e) {
        return '';
    }
}

function walkXmlFiles(dir, depth, out) {
    if (depth < 0) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    items.forEach(it => {
        const full = path.join(dir, it.name);
        if (it.isDirectory()) walkXmlFiles(full, depth - 1, out);
        else if (/\.xml$/i.test(it.name) && /animal/i.test(full)) out.push(full);
    });
}

// Scans every mod (zipped or unpacked) for animal definitions: pictures per
// growth stage and reproduction settings per subType.
function buildIndex(modsDir) {
    const index = { visuals: {}, reproduction: {} };
    const add = (defs, source) => {
        Object.keys(defs.visuals).forEach(subType => {
            if (index.visuals[subType]) return;   // first definition wins
            index.visuals[subType] = defs.visuals[subType].map(v => ({ minAge: v.minAge, image: v.image, ...source }));
        });
        Object.keys(defs.reproduction).forEach(subType => {
            if (!index.reproduction[subType]) index.reproduction[subType] = defs.reproduction[subType];
        });
    };

    let items = [];
    try { items = fs.readdirSync(modsDir, { withFileTypes: true }); } catch (e) { return index; }
    items.forEach(it => {
        const full = path.join(modsDir, it.name);
        try {
            if (it.isFile() && /\.zip$/i.test(it.name)) {
                const entries = readZipDirectory(full);
                if (!entries) return;
                entries.forEach(entry => {
                    if (!/\.xml$/i.test(entry.name) || !/animal/i.test(entry.name) || /l10n/i.test(entry.name)) return;
                    const data = readZipEntry(full, entry);
                    if (data) add(parseAnimalDefs(data.toString('utf8')), { zip: full });
                });
            } else if (it.isDirectory()) {
                const files = [];
                walkXmlFiles(full, 5, files);
                files.forEach(f => add(parseAnimalDefs(fs.readFileSync(f, 'utf8')), { dir: full }));
            }
        } catch (e) {
            console.warn('animal-images: could not scan', full, e.message);
        }
    });
    return index;
}

// Index is cached on disk and rebuilt only when the mods folder changes.
function loadIndex(modsDir, cacheDir) {
    const indexFile = path.join(cacheDir, 'index.json');
    const signature = modsSignature(modsDir);
    try {
        const cached = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        if (cached.version === INDEX_VERSION && cached.modsDir === modsDir && cached.signature === signature) return cached.index;
    } catch (e) { /* no cache yet */ }

    const index = buildIndex(modsDir);
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(indexFile, JSON.stringify({ version: INDEX_VERSION, modsDir, signature, index }));
    } catch (e) { /* cache is optional */ }
    return index;
}

// The growth-stage picture for an animal of this age.
function pickVisual(index, subType, age) {
    const list = index && index.visuals && index.visuals[String(subType).toUpperCase()];
    if (!list || !list.length) return null;
    let best = list[0];
    list.forEach(v => { if ((age || 0) >= v.minAge) best = v; });
    return best;
}

function cacheFileFor(cacheDir, visual) {
    const key = visual.image.replace(/\.(png|dds)$/i, '').replace(/[^a-z0-9]+/gi, '_').slice(-80);
    return path.join(cacheDir, key + '.png');
}

function readVisualBytes(visual) {
    for (const candidate of imageCandidates(visual.image)) {
        if (visual.zip) {
            const entries = readZipDirectory(visual.zip);
            const entry = entries && entries.get(candidate.toLowerCase());
            if (entry) return readZipEntry(visual.zip, entry);
        } else if (visual.dir) {
            const file = path.join(visual.dir, candidate);
            if (fs.existsSync(file)) return fs.readFileSync(file);
        }
    }
    return null;
}

// Decodes a DDS (BC1/BC3/BC7 or plain 32-bit) into a canvas through WebGL.
function decodeDdsToCanvas(buf, maxSize) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length < 128 || dv.getUint32(0, true) !== 0x20534444) return null;   // "DDS "
    const height = dv.getUint32(12, true), width = dv.getUint32(16, true);
    const fourCC = String.fromCharCode(u8[84], u8[85], u8[86], u8[87]);
    let offset = 128, fmt = null;
    if (fourCC === 'DX10') {
        fmt = { 71: 'BC1', 72: 'BC1', 77: 'BC3', 78: 'BC3', 98: 'BC7', 99: 'BC7', 28: 'RGBA', 29: 'RGBA', 87: 'BGRA', 91: 'BGRA' }[dv.getUint32(128, true)] || null;
        offset += 20;
    } else if (fourCC === 'DXT1') fmt = 'BC1';
    else if (fourCC === 'DXT5') fmt = 'BC3';
    else if ((dv.getUint32(80, true) & 0x40) && dv.getUint32(88, true) === 32) fmt = dv.getUint32(92, true) === 0xff0000 ? 'BGRA' : 'RGBA';
    if (!fmt || !width || !height) return null;

    const glCanvas = document.createElement('canvas');
    glCanvas.width = width; glCanvas.height = height;
    const gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    try {
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        if (fmt === 'RGBA' || fmt === 'BGRA') {
            const px = u8.slice(offset, offset + width * height * 4);
            if (fmt === 'BGRA') for (let i = 0; i < px.length; i += 4) { const t = px[i]; px[i] = px[i + 2]; px[i + 2] = t; }
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        } else {
            const ext = fmt === 'BC7' ? gl.getExtension('EXT_texture_compression_bptc') : gl.getExtension('WEBGL_compressed_texture_s3tc');
            if (!ext) return null;
            const glFmt = fmt === 'BC7' ? ext.COMPRESSED_RGBA_BPTC_UNORM_EXT
                : (fmt === 'BC1' ? ext.COMPRESSED_RGBA_S3TC_DXT1_EXT : ext.COMPRESSED_RGBA_S3TC_DXT5_EXT);
            const size = Math.ceil(width / 4) * Math.ceil(height / 4) * (fmt === 'BC1' ? 8 : 16);
            if (offset + size > u8.length) return null;
            gl.compressedTexImage2D(gl.TEXTURE_2D, 0, glFmt, width, height, 0, u8.subarray(offset, offset + size));
        }

        const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
        const prog = gl.createProgram();
        gl.attachShader(prog, shader(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = vec4(p,0.,1.); }'));
        gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 uv; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, uv); }'));
        gl.linkProgram(prog);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (gl.getError() !== gl.NO_ERROR) return null;

        const scale = maxSize ? Math.min(1, maxSize / Math.max(width, height)) : 1;
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(width * scale));
        out.height = Math.max(1, Math.round(height * scale));
        const ctx = out.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(glCanvas, 0, 0, out.width, out.height);
        return out;
    } finally {
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
    }
}

// Cached PNG path for this visual, decoding it first if needed. Null when
// the picture can't be found or decoded.
function ensurePicture(cacheDir, visual) {
    const file = cacheFileFor(cacheDir, visual);
    if (fs.existsSync(file)) return file;
    const bytes = readVisualBytes(visual);
    if (!bytes) return null;
    let png = null;
    if (bytes.readUInt32LE(0) === 0x20534444) {
        const canvas = decodeDdsToCanvas(bytes, PICTURE_SIZE);
        if (canvas) png = Buffer.from(canvas.toDataURL('image/png').split(',')[1], 'base64');
    } else if (bytes.readUInt32LE(0) === 0x474e5089) {
        png = bytes;   // already a PNG
    }
    if (!png) return null;
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, png);
    return file;
}

module.exports = { findModsDir, loadIndex, pickVisual, cacheFileFor, ensurePicture, parseAnimalDefs, parseReproduction };
