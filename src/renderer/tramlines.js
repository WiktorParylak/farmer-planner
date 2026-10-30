// Tramlines tool (ścieżki technologiczne) — moves tramlines between saves of
// the same map. They live in savegameN/densityMap_fruits.gdm as pixels with
// no crop; the tool cuts them out per field into a library
// (<data>/tramlines/<map title>/) and pastes them into another save.
// A classic <script> after renderer.js; the heavy work runs in
// tramlines-worker.js (own process). This is the only part of the app that
// writes a game file — only with the game closed, after a backup, and only
// when the new file reads back exactly as intended.

const tlCore = require('./tramlines-core');
const { readMapFieldPolygons } = require('./savegame-soil');

const TL_DEFAULTS = { threshold: 128, edge: 4, minPx: 2000, brush: 9, converter: '', gameDir: '' };
const TL_EDIT_MARGIN = 64;

const tl = {
    tab: 'paste',
    saves: [],
    saveDir: '',
    loaded: null,            // { saveDir, dim, title }
    view: null,              // { x0, y0, scale }
    image: null,             // last ImageData from the worker
    colors: [0],             // values that count as tramlines (0 = no crop)
    highlight: true,
    mapFields: null,         // [{ key, id, poly: [[x,y]] }] in map pixels
    groundFields: null,      // [{ key, label, bbox, px }]
    selected: new Set(),
    lasso: [],               // closed polygons
    lassoOn: false,
    lassoPts: [],
    entries: [],             // library of the selected save's map
    pasteSel: new Set(),
    overlays: {},            // entry name -> canvas
    editor: null,            // { name, x, y, w, h, rgba, undo: [], mode }
    busy: false
};

function tlSettings() {
    let s = {};
    try { s = JSON.parse(getSetting('tramlines') || '{}') || {}; } catch (e) { s = {}; }
    return { ...TL_DEFAULTS, ...s };
}
function tlSaveSettings(patch) {
    setSetting('tramlines', JSON.stringify({ ...tlSettings(), ...patch }));
}

function tlGameDir() {
    return tlSettings().gameDir || path.join(path.dirname(appDataDir), 'My Games', 'FarmingSimulator2025');
}

function tlSafeName(s) {
    return String(s).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '') || 'map';
}

function tlLibraryDir(title) {
    return path.join(appDataDir, 'tramlines', tlSafeName(title || 'map'));
}

function tlMapTitle(saveDir) {
    try {
        const xml = fs.readFileSync(path.join(saveDir, 'careerSavegame.xml'), 'utf-8');
        const m = xml.match(/<mapTitle>([\s\S]*?)<\/mapTitle>/);
        if (m) return m[1].trim();
    } catch (e) { /* no career file */ }
    return '';
}

function tlListSaves() {
    const dir = tlGameDir();
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return []; }
    return names.map(n => ({ n, m: n.match(/^savegame(\d+)$/) }))
        .filter(x => x.m && fs.existsSync(path.join(dir, x.n, 'densityMap_fruits.gdm')))
        .map(x => ({ dir: path.join(dir, x.n), name: x.n, num: +x.m[1], title: tlMapTitle(path.join(dir, x.n)) }))
        .sort((a, b) => a.num - b.num);
}

function tlCurrentSave() {
    return tl.saves.find(s => s.dir === tl.saveDir) || null;
}

// ---------- worker ----------
let tlWorker = null, tlCallId = 0;
const tlPending = {};

function tlStartWorker() {
    if (tlWorker) return tlWorker;
    const { fork } = require('child_process');
    tlWorker = fork(path.join(__dirname, 'tramlines-worker.js'), [], {
        execPath: process.execPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        serialization: 'advanced',
        stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });
    tlWorker.on('message', m => { const p = tlPending[m.id]; if (p) { delete tlPending[m.id]; p(m); } });
    tlWorker.on('exit', () => {
        tlWorker = null;
        tl.loaded = null;
        Object.keys(tlPending).forEach(k => { tlPending[k]({ ok: false, error: 'TL_WORKER_EXIT' }); delete tlPending[k]; });
    });
    return tlWorker;
}

function tlCall(op, args) {
    const w = tlStartWorker();
    return new Promise((resolve, reject) => {
        const id = ++tlCallId;
        tlPending[id] = m => (m.ok ? resolve(m.result) : reject(Object.assign(new Error(m.error), { code: m.error, extra: m.extra || {} })));
        w.send({ id, op, args });
    });
}

function tlStopWorker() {
    if (tlWorker) { tlWorker.kill(); tlWorker = null; }
    tl.loaded = null;
}

function tlErrorText(e) {
    const key = 'tlErr_' + (e.code || 'TL_ERROR');
    const txt = TRANSLATIONS.en[key] ? t(key) : t('tlErr_TL_ERROR');
    const x = e.extra || {};
    return txt.replace('{name}', x.name || '').replace('{size}', x.size || '').replace('{dim}', x.dim || '').replace('{msg}', x.msg || e.message || '');
}

async function tlBusy(text, fn) {
    if (tl.busy) return null;
    tl.busy = true;
    const el = document.getElementById('tl-busy');
    if (el) { el.textContent = text; el.hidden = false; }
    try { return await fn(); }
    catch (e) { console.error(e); await showNotice(t('tlTitle'), tlErrorText(e), true); return null; }
    finally {
        tl.busy = false;
        if (el) el.hidden = true;
    }
}

function tlGameRunning() {
    return new Promise(resolve => {
        require('child_process').execFile('tasklist', ['/FI', 'IMAGENAME eq FarmingSimulator2025.exe', '/NH'], { windowsHide: true }, (err, out) => {
            resolve(!err && /FarmingSimulator2025\.exe/i.test(out || ''));
        });
    });
}

// ---------- library ----------
function tlReadLibrary(title) {
    const dir = tlLibraryDir(title);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json')); } catch (e) { return []; }
    return files.map(f => {
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
            return { name: f.replace(/\.json$/i, ''), file: path.join(dir, f), ...meta };
        } catch (e) { return null; }
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function tlRefreshLibrary() {
    const save = tlCurrentSave();
    tl.entries = save ? tlReadLibrary(save.title) : [];
    const names = new Set(tl.entries.map(e => e.name));
    [...tl.pasteSel].forEach(n => { if (!names.has(n)) tl.pasteSel.delete(n); });
    tl.overlays = {};
}

// The entry as a canvas (tramline pixels tinted) for drawing over the map.
function tlEntryCanvas(entry) {
    if (tl.overlays[entry.name]) return tl.overlays[entry.name];
    try {
        const png = tlCore.decodePng(fs.readFileSync(entry.file.replace(/\.json$/i, '.png')));
        const c = document.createElement('canvas');
        c.width = png.w; c.height = png.h;
        const img = c.getContext('2d').createImageData(png.w, png.h);
        for (let i = 0; i < png.w * png.h; i++) {
            if (png.rgba[i * 4 + 3] < tlSettings().threshold) continue;
            img.data[i * 4] = 255; img.data[i * 4 + 1] = 210; img.data[i * 4 + 2] = 40; img.data[i * 4 + 3] = 255;
        }
        c.getContext('2d').putImageData(img, 0, 0);
        tl.overlays[entry.name] = c;
        return c;
    } catch (e) { return null; }
}

// ---------- view ----------
function tlOpen() {
    const view = document.getElementById('tramlines-view');
    if (!view) return;
    tl.saves = tlListSaves();
    if (!tl.saves.some(s => s.dir === tl.saveDir)) tl.saveDir = tl.saves.length ? tl.saves[0].dir : '';
    tlRefreshLibrary();
    if (dashboardView) dashboardView.style.display = 'none';
    view.hidden = false;
    tlRenderSide();
    tlResizeCanvas();
    tlEnsureLoaded();
}

// Unsaved editor changes: ask before throwing them away.
async function tlDiscardOk() {
    if (!tl.editor || !tl.editor.dirty) return true;
    return (await showConfirm({ title: t('tlTitle'), body: t('tlEditorDiscard'), confirmText: t('tlDiscard'), danger: true })) === true;
}

async function tlClose() {
    if (!(await tlDiscardOk())) return;
    tl.editor = null;
    const view = document.getElementById('tramlines-view');
    if (view) view.hidden = true;
    if (dashboardView) dashboardView.style.display = 'flex';
    tlStopWorker();
    tl.image = null;
}

async function tlEnsureLoaded() {
    const save = tlCurrentSave();
    if (!save) { tlDraw(); return; }
    if (tl.loaded && tl.loaded.saveDir === save.dir) { tlRequestView(); return; }
    await tlBusy(t('tlLoading').replace('{save}', save.name), async () => {
        const r = await tlCall('load', { saveDir: save.dir });
        tl.loaded = { saveDir: save.dir, dim: r.dim, title: save.title };
        tl.mapFields = null; tl.groundFields = null; tl.selected.clear(); tl.lasso = []; tl.lassoPts = [];
        tlFit();
    });
    tlRenderSide();
    tlRequestView();
}

function tlCanvas() { return document.getElementById('tl-canvas'); }

function tlResizeCanvas() {
    const c = tlCanvas();
    if (!c) return;
    const r = c.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    c.style.width = r.width + 'px';
    c.style.height = r.height + 'px';
    if (tl.loaded && !tl.view) tlFit();
    tlRequestView();
}

function tlFit() {
    const c = tlCanvas();
    if (!c || !tl.loaded) return;
    const s = Math.min(c.width, c.height) / tl.loaded.dim;
    tl.view = { scale: s, x0: -(c.width / s - tl.loaded.dim) / 2, y0: -(c.height / s - tl.loaded.dim) / 2 };
}

function tlZoomTo(bbox) {
    const c = tlCanvas();
    if (!c || !tl.loaded) return;
    const [x0, y0, x1, y1] = bbox, pad = 40;
    const s = Math.min(16, Math.min(c.width / (x1 - x0 + pad * 2), c.height / (y1 - y0 + pad * 2)));
    tl.view = { scale: s, x0: (x0 + x1) / 2 - c.width / s / 2, y0: (y0 + y1) / 2 - c.height / s / 2 };
    tlRequestView();
}

let tlViewBusy = false, tlViewAgain = false;
async function tlRequestView() {
    const c = tlCanvas();
    if (!c || !tl.loaded || !tl.view) { tlDraw(); return; }
    if (tlViewBusy) { tlViewAgain = true; tlDraw(); return; }
    tlViewBusy = true;
    try {
        const v = { ...tl.view };
        const data = await tlCall('view', { x0: v.x0, y0: v.y0, scale: v.scale, w: c.width, h: c.height, colors: tl.colors, highlight: tl.highlight && tl.tab === 'cut' });
        tl.image = { data: new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), c.width, c.height), view: v };
    } catch (e) { /* worker gone — next open restarts it */ }
    tlViewBusy = false;
    tlDraw();
    if (tlViewAgain) { tlViewAgain = false; tlRequestView(); }
}

const tlToScreen = (x, y) => [(x - tl.view.x0) * tl.view.scale, (y - tl.view.y0) * tl.view.scale];
const tlToMap = (sx, sy) => [tl.view.x0 + sx / tl.view.scale, tl.view.y0 + sy / tl.view.scale];

// Editor cursor: a ring the size of the brush at the current zoom — solid
// with a dot to paint, dashed with a cross to erase. Ctrl (pick a colour)
// and brushes too big for a cursor image fall back to a crosshair.
function tlUpdateCursor(ctrl) {
    const c = tlCanvas();
    if (!c) return;
    const ed = tl.editor;
    if (tl.tab !== 'editor' || !ed || !tl.view || ctrl) { c.style.cursor = tl.tab === 'editor' && ed ? 'crosshair' : ''; return; }
    const d = Math.max(6, Math.round(tlSettings().brush * tl.view.scale / (window.devicePixelRatio || 1)));
    if (d > 120) { c.style.cursor = 'crosshair'; return; }
    const size = d + 4, h = size / 2, r = d / 2;
    const erase = ed.mode === 'erase';
    const ring = (stroke, width, dash) => `<circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash ? ' stroke-dasharray="3 2"' : ''}/>`;
    const mark = erase
        ? `<path d="M${h - 3} ${h - 3}L${h + 3} ${h + 3}M${h + 3} ${h - 3}L${h - 3} ${h + 3}" stroke="#000" stroke-width="3"/><path d="M${h - 3} ${h - 3}L${h + 3} ${h + 3}M${h + 3} ${h - 3}L${h - 3} ${h + 3}" stroke="#fff" stroke-width="1.2"/>`
        : `<circle cx="${h}" cy="${h}" r="1.5" fill="#fff" stroke="#000" stroke-width="0.8"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${ring('#000', 3, false)}${ring(erase ? '#f08a6c' : '#fff', 1.2, erase)}${mark}</svg>`;
    c.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(h)} ${Math.round(h)}, crosshair`;
}

function tlDraw() {
    const c = tlCanvas();
    if (!c) return;
    tlUpdateCursor();
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#18201c';
    g.fillRect(0, 0, c.width, c.height);
    if (!tl.loaded || !tl.view) return;
    if (tl.image) {
        // The last frame, moved/scaled to the current view until the new one arrives.
        const iv = tl.image.view, k = tl.view.scale / iv.scale;
        const off = document.createElement('canvas');
        off.width = tl.image.data.width; off.height = tl.image.data.height;
        off.getContext('2d').putImageData(tl.image.data, 0, 0);
        g.imageSmoothingEnabled = false;
        g.drawImage(off, (iv.x0 - tl.view.x0) * tl.view.scale, (iv.y0 - tl.view.y0) * tl.view.scale, off.width * k, off.height * k);
    }
    const dpr = window.devicePixelRatio || 1;
    g.lineWidth = 1.5 * dpr;
    g.font = `${12 * dpr}px sans-serif`;
    const s = tl.view.scale;
    // Library entries (Paste tab: the ticked ones; Editor: the open one).
    const drawEntry = (e, alpha) => {
        const cv = tlEntryCanvas(e);
        if (!cv) return;
        const [sx, sy] = tlToScreen(e.x, e.y);
        g.globalAlpha = alpha;
        g.drawImage(cv, sx, sy, e.w * s, e.h * s);
        g.globalAlpha = 1;
    };
    if (tl.tab === 'paste') tl.entries.filter(e => tl.pasteSel.has(e.name) && e.mapSize === tl.loaded.dim).forEach(e => drawEntry(e, 0.9));
    if (tl.tab === 'editor' && tl.editor) {
        const ed = tl.editor;
        if (!ed.canvas) tlEditorCanvas();
        const [sx, sy] = tlToScreen(ed.x, ed.y);
        g.drawImage(ed.canvas, sx, sy, ed.w * s, ed.h * s);
        g.strokeStyle = 'rgba(255,255,255,0.5)';
        g.setLineDash([4 * dpr, 4 * dpr]);
        g.strokeRect(sx, sy, ed.w * s, ed.h * s);
        g.setLineDash([]);
    }
    if (tl.tab === 'cut') {
        const poly = (pts, close) => {
            g.beginPath();
            pts.forEach(([x, y], i) => { const [a, b] = tlToScreen(x, y); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
            if (close) g.closePath();
        };
        (tl.mapFields || []).forEach(f => {
            const sel = tl.selected.has(f.key);
            poly(f.poly, true);
            if (sel) { g.fillStyle = 'rgba(0,255,102,0.18)'; g.fill(); }
            g.strokeStyle = sel ? '#00ff66' : 'rgba(80,200,255,0.8)';
            g.stroke();
            if (s * (f.bbox[2] - f.bbox[0]) > 30) {
                const [a, b] = tlToScreen((f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2);
                g.fillStyle = sel ? '#00ff66' : '#bfe8ff';
                g.fillText(f.id, a - g.measureText(f.id).width / 2, b);
            }
        });
        (tl.groundFields || []).forEach(f => {
            const sel = tl.selected.has(f.key);
            const [a, b] = tlToScreen(f.bbox[0], f.bbox[1]);
            g.strokeStyle = sel ? '#00ff66' : 'rgba(255,200,80,0.8)';
            g.strokeRect(a, b, (f.bbox[2] - f.bbox[0]) * s, (f.bbox[3] - f.bbox[1]) * s);
            if (sel) { g.fillStyle = 'rgba(0,255,102,0.12)'; g.fillRect(a, b, (f.bbox[2] - f.bbox[0]) * s, (f.bbox[3] - f.bbox[1]) * s); }
        });
        g.strokeStyle = '#00ff66';
        tl.lasso.forEach(p => { poly(p, true); g.fillStyle = 'rgba(0,255,102,0.18)'; g.fill(); g.stroke(); });
        if (tl.lassoPts.length) { poly(tl.lassoPts, false); g.stroke(); }
    }
}

// ---------- side panel ----------
function tlRenderSide() {
    const side = document.getElementById('tl-side');
    if (!side) return;
    tlUpdateCursor();
    document.querySelectorAll('#tramlines-view .tl-tab').forEach(b => {
        const on = b.dataset.tltab === tl.tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const save = tlCurrentSave();
    const saveSel = `<label class="settings-field"><span>${t('tlSave')}</span><select id="tl-save">${tl.saves.map(s => `<option value="${escapeHtml(s.dir)}" ${s.dir === tl.saveDir ? 'selected' : ''}>${escapeHtml(s.name)}${s.title ? ' · ' + escapeHtml(s.title) : ''}</option>`).join('')}</select></label>`;
    // Which view this is, so the panel itself says where you are.
    const tabKey = { paste: 'tlTabPaste', cut: 'tlTabCut', editor: 'tlTabEditor', settings: 'tlTabSettings' }[tl.tab];
    let html = `<div class="tl-view-head"><h2 class="tl-view-title">${t(tabKey)}</h2><p class="tl-view-desc">${escapeHtml(t('tlViewDesc_' + tl.tab))}</p></div>`;
    html += tl.tab === 'settings' ? '' : (tl.saves.length ? saveSel : `<p class="settings-hint">${escapeHtml(t('tlNoSaves').replace('{dir}', tlGameDir()))}</p>`);
    if (tl.tab === 'paste') html += tlPasteHtml(save);
    else if (tl.tab === 'cut') html += tlCutHtml(save);
    else if (tl.tab === 'editor') html += tlEditorHtml(save);
    else html += tlSettingsHtml();
    side.innerHTML = html;
}

function tlEntryRowHtml(e, withCheck) {
    const date = e.createdAt ? new Date(e.createdAt).toLocaleDateString(FIN_LOCALE()) : '';
    const wrong = tl.loaded && e.mapSize !== tl.loaded.dim;
    return `<li class="tl-entry${wrong ? ' is-wrong' : ''}" data-name="${escapeHtml(e.name)}">
        ${withCheck ? `<input type="checkbox" class="fp-check tl-entry-check" ${tl.pasteSel.has(e.name) ? 'checked' : ''} ${wrong ? 'disabled' : ''}>` : ''}
        <span class="tl-entry-name">${escapeHtml(e.name)}</span>
        <span class="tl-entry-meta">${(e.px || 0).toLocaleString(FIN_LOCALE())} px${date ? ' · ' + date : ''}${wrong ? ' · ' + escapeHtml(t('tlWrongSize')) : ''}</span>
        <span class="tl-entry-tools">
            <button type="button" class="feed-ration-tool tl-entry-zoom" title="${escapeHtml(t('tlZoom'))}"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></button>
            <button type="button" class="feed-ration-tool tl-entry-export" title="${escapeHtml(t('tlExport'))}"><i class="fa-solid fa-file-export" aria-hidden="true"></i></button>
            <button type="button" class="feed-ration-tool feed-ration-tool--danger tl-entry-delete" title="${escapeHtml(t('delete'))}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
        </span>
    </li>`;
}

function tlPasteHtml(save) {
    if (!save) return '';
    const n = tl.pasteSel.size;
    return `<p class="settings-hint">${escapeHtml(t('tlPasteHint'))}</p>
        <div class="tl-row"><strong>${escapeHtml(t('tlLibrary').replace('{map}', save.title || '?'))}</strong>
            ${tl.entries.length ? `<button type="button" class="tl-link tl-select-all">${t('tlSelectAll')}</button><button type="button" class="tl-link tl-select-none">${t('tlSelectNone')}</button>` : ''}</div>
        ${tl.entries.length ? `<ul class="tl-entries">${tl.entries.map(e => tlEntryRowHtml(e, true)).join('')}</ul>` : `<p class="settings-hint">${escapeHtml(t('tlLibraryEmpty'))}</p>`}
        <button type="button" class="settings-btn tl-paste" ${n ? '' : 'disabled'}>${escapeHtml(t('tlPasteBtn').replace('{n}', n).replace('{save}', save.name))}</button>
        <div class="tl-row">
            <button type="button" class="settings-btn reset-btn tl-restore">${t('tlRestore')}</button>
            <button type="button" class="settings-btn tl-import">${t('tlImport')}</button>
            <button type="button" class="settings-btn tl-open-lib">${t('tlOpenLibrary')}</button>
        </div>`;
}

function tlCutHtml(save) {
    if (!save) return '';
    const chips = tl.colors.map((c, i) => `<span class="tl-color-chip"><span class="tl-swatch" style="background:rgb(${c & 255},${(c >> 8) & 255},${(c >> 16) & 255})"></span>${c}${c === 0 ? ' · ' + escapeHtml(t('tlNoCrop')) : ''}<button type="button" class="tl-color-remove" data-i="${i}" title="${escapeHtml(t('delete'))}">×</button></span>`).join('');
    const fields = [...(tl.mapFields || []).map(f => ({ key: f.key, label: t('tlFieldName').replace('{n}', f.id), bbox: f.bbox })),
        ...(tl.groundFields || []).map((f, i) => ({ key: f.key, label: t('tlAreaName').replace('{n}', i + 1), bbox: f.bbox }))];
    const sel = tl.selected.size + tl.lasso.length;
    return `<div class="tl-row">
            <button type="button" class="settings-btn tl-detect-map" title="${escapeHtml(t('tlDetectMapHint'))}">${t('tlDetectMap')}</button>
            <button type="button" class="settings-btn tl-detect-ground" title="${escapeHtml(t('tlDetectGroundHint'))}">${t('tlDetectGround')}</button>
            <button type="button" class="settings-btn tl-lasso${tl.lassoOn ? ' is-active' : ''}" title="${escapeHtml(t('tlLassoHint'))}">${t('tlLasso')}</button>
        </div>
        <div class="tl-colors"><strong>${t('tlColors')}</strong> ${chips || `<span class="settings-hint">${t('tlColorsNone')}</span>`}</div>
        <p class="settings-hint">${escapeHtml(t('tlColorsHint'))}</p>
        <label class="tl-check"><input type="checkbox" class="fp-check" id="tl-highlight" ${tl.highlight ? 'checked' : ''}> ${t('tlHighlight')}</label>
        ${fields.length ? `<div class="tl-row"><strong>${t('tlFields')}</strong><button type="button" class="tl-link tl-fields-all">${t('tlSelectAll')}</button><button type="button" class="tl-link tl-fields-none">${t('tlSelectNone')}</button></div>
            <ul class="tl-entries tl-fields">${fields.map(f => `<li class="tl-entry" data-key="${escapeHtml(f.key)}"><input type="checkbox" class="fp-check tl-field-check" ${tl.selected.has(f.key) ? 'checked' : ''}><span class="tl-entry-name">${escapeHtml(f.label)}</span><span class="tl-entry-tools"><button type="button" class="feed-ration-tool tl-field-zoom" title="${escapeHtml(t('tlZoom'))}"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></button></span></li>`).join('')}</ul>` : ''}
        ${tl.lasso.length ? `<p class="settings-hint">${t('tlLassoCount').replace('{n}', tl.lasso.length)} <button type="button" class="tl-link tl-lasso-clear">${t('tlLassoClear')}</button></p>` : ''}
        <label class="settings-field"><span>${t('tlName')}</span><input type="text" id="tl-name" maxlength="60" placeholder="${escapeHtml(t('tlNamePlaceholder'))}"></label>
        <label class="tl-check"><input type="checkbox" class="fp-check" id="tl-merge"> ${t('tlMerge')}</label>
        <button type="button" class="settings-btn tl-cut" ${sel ? '' : 'disabled'}>${escapeHtml(t('tlCutBtn').replace('{n}', sel))}</button>`;
}

function tlEditorHtml(save) {
    if (!save) return '';
    const ed = tl.editor;
    const st = tlSettings();
    return `<label class="settings-field"><span>${t('tlEditorEntry')}</span><select id="tl-editor-entry"><option value="">–</option>${tl.entries.map(e => `<option value="${escapeHtml(e.name)}" ${ed && ed.name === e.name ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}</select></label>
        ${ed ? `<div class="tl-row">
                <button type="button" class="settings-btn tl-mode${ed.mode === 'paint' ? ' is-active' : ''}" data-mode="paint"><i class="fa-solid fa-paintbrush" aria-hidden="true"></i> ${t('tlPaint')}</button>
                <button type="button" class="settings-btn tl-mode${ed.mode === 'erase' ? ' is-active' : ''}" data-mode="erase"><i class="fa-solid fa-eraser" aria-hidden="true"></i> ${t('tlErase')}</button>
            </div>
            <label class="settings-field"><span>${t('tlBrush')} (${st.brush} px)</span><input type="range" id="tl-brush" min="1" max="61" step="2" value="${st.brush}"></label>
            <p class="settings-hint">${escapeHtml(t('tlEditorHint'))}</p>
            <div class="tl-row">
                <button type="button" class="settings-btn tl-undo" ${ed.undo.length ? '' : 'disabled'}>${t('tlUndo')}</button>
                <button type="button" class="settings-btn tl-editor-save" ${ed.dirty ? '' : 'disabled'}>${t('tlEditorSave')}</button>
            </div>` : `<p class="settings-hint">${escapeHtml(t('tlEditorPick'))}</p>`}`;
}

function tlSettingsHtml() {
    const s = tlSettings();
    const num = (id, key, min, max, label, hint) => `<label class="settings-field"><span>${label}</span><input type="number" id="${id}" data-key="${key}" class="tl-setting" min="${min}" max="${max}" value="${s[key]}"></label>${hint ? `<p class="settings-hint">${hint}</p>` : ''}`;
    return `<label class="settings-field"><span>${t('tlGameDir')}</span><input type="text" class="tl-setting" data-key="gameDir" value="${escapeHtml(s.gameDir)}" placeholder="${escapeHtml(path.join(path.dirname(appDataDir), 'My Games', 'FarmingSimulator2025'))}"></label>
        ${num('tl-thr', 'threshold', 1, 255, t('tlThreshold'), t('tlThresholdHint'))}
        ${num('tl-edge', 'edge', 0, 64, t('tlEdge'), t('tlEdgeHint'))}
        ${num('tl-minpx', 'minPx', 0, 1000000, t('tlMinPx'), t('tlMinPxHint'))}
        <label class="settings-field"><span>${t('tlConverter')}</span><input type="text" class="tl-setting" data-key="converter" value="${escapeHtml(s.converter)}" placeholder="grleConverter.exe"></label>
        <p class="settings-hint">${t('tlConverterHint')}</p>
        <p class="settings-hint">${escapeHtml(t('tlLibraryWhere').replace('{dir}', path.join(appDataDir, 'tramlines')))}</p>`;
}

// ---------- actions ----------
async function tlDetectMap() {
    const save = tlCurrentSave();
    if (!save || !tl.loaded) return;
    const r = readMapFieldPolygons(path.join(save.dir, 'careerSavegame.xml'));
    if (!r.ok) { await showNotice(t('tlTitle'), t('tlDetectMapFail_' + (['nomod', 'nomap', 'nofields'].includes(r.reason) ? r.reason : 'other')).replace('{mod}', r.modName || ''), true); return; }
    const k = tl.loaded.dim / r.mapSize;
    tl.mapFields = r.fields.map(f => {
        const poly = f.pts.map(([x, z]) => [(x + r.mapSize / 2) * k, (z + r.mapSize / 2) * k]);
        const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
        return { key: 'm:' + f.id, id: f.id, poly, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    tl.groundFields = null;
    [...tl.selected].forEach(k2 => { if (!k2.startsWith('m:')) tl.selected.delete(k2); });
    tlRenderSide();
    tlDraw();
}

async function tlDetectGround() {
    if (!tl.loaded) return;
    const s = tlSettings();
    const fields = await tlBusy(t('tlDetecting'), () => tlCall('groundFields', { minPx: s.minPx, edge: s.edge }));
    if (!fields) return;
    tl.groundFields = fields.map(f => ({ ...f, key: 'g:' + f.label }));
    tl.mapFields = null;
    [...tl.selected].forEach(k => { if (!k.startsWith('g:')) tl.selected.delete(k); });
    tlRenderSide();
    tlDraw();
}

async function tlCut() {
    const save = tlCurrentSave();
    if (!save || !tl.loaded) return;
    const s = tlSettings();
    const nameIn = (document.getElementById('tl-name') || {}).value || '';
    const merge = (document.getElementById('tl-merge') || {}).checked;
    const outDir = tlLibraryDir(save.title);
    const items = [];
    (tl.mapFields || []).filter(f => tl.selected.has(f.key)).forEach(f => items.push({ label: t('tlFieldName').replace('{n}', f.id), area: { polys: [f.poly] } }));
    (tl.groundFields || []).forEach((f, i) => { if (tl.selected.has(f.key)) items.push({ label: t('tlAreaName').replace('{n}', i + 1), area: { labels: [f.label] } }); });
    tl.lasso.forEach((p, i) => items.push({ label: t('tlLassoName').replace('{n}', i + 1), area: { polys: [p] } }));
    if (!items.length) return;
    if (!tl.colors.length) {
        const ok = await showConfirm({ title: t('tlTitle'), body: t('tlNoColorsAsk'), confirmText: t('tlCutAnyway') });
        if (ok !== true) return;
    }
    let jobs;
    if (merge || items.length === 1) {
        const polys = items.filter(i => i.area.polys).flatMap(i => i.area.polys), labels = items.filter(i => i.area.labels).flatMap(i => i.area.labels);
        if (polys.length && labels.length) { await showNotice(t('tlTitle'), t('tlMergeMixed'), true); return; }
        jobs = [{ name: tlSafeName(nameIn.trim() || items[0].label), area: polys.length ? { polys } : { labels } }];
    } else {
        jobs = items.map(i => ({ name: tlSafeName(nameIn.trim() ? `${nameIn.trim()} ${i.label}` : i.label), area: i.area }));
    }
    const exists = jobs.filter(j => fs.existsSync(path.join(outDir, j.name + '.json'))).map(j => j.name);
    if (exists.length) {
        const ok = await showConfirm({ title: t('tlTitle'), body: t('tlOverwrite').replace('{list}', exists.slice(0, 15).join(', ')), confirmText: t('tlOverwriteYes'), danger: true });
        if (ok !== true) return;
    }
    const done = [], empty = [];
    await tlBusy(t('tlCutting'), async () => {
        for (const j of jobs) {
            try {
                const meta = await tlCall('cut', { area: j.area, colors: tl.colors, edge: s.edge, outDir, name: j.name });
                done.push(`${j.name} (${meta.px.toLocaleString(FIN_LOCALE())} px)`);
            } catch (e) {
                if (e.code === 'TL_EMPTY') empty.push(j.name); else throw e;
            }
        }
    });
    tl.selected.clear(); tl.lasso = [];
    tlRefreshLibrary();
    tlRenderSide();
    tlDraw();
    if (done.length || empty.length) {
        await showNotice(t('tlTitle'), [done.length ? t('tlCutDone').replace('{list}', done.join('\n')) : '', empty.length ? t('tlCutEmpty').replace('{list}', empty.join(', ')) : ''].filter(Boolean).join('\n\n'), !done.length);
    }
}

async function tlPaste() {
    const save = tlCurrentSave();
    if (!save || !tl.pasteSel.size) return;
    const entries = tl.entries.filter(e => tl.pasteSel.has(e.name));
    if (await tlGameRunning()) { await showNotice(t('tlTitle'), t('tlGameRunning'), true); return; }
    const ok = await showConfirm({
        title: t('tlPasteTitle'),
        body: t('tlPasteConfirm').replace('{n}', entries.length).replace('{save}', save.name).replace('{map}', save.title || '?').replace('{list}', entries.map(e => e.name).join(', ')),
        confirmText: t('tlPasteYes'), icon: 'fa-road'
    });
    if (ok !== true) return;
    const s = tlSettings();
    const r = await tlBusy(t('tlPasting'), () => tlCall('paste', { saveDir: save.dir, entries: entries.map(e => e.file), threshold: s.threshold, converter: s.converter.trim() }));
    if (!r) return;
    tlRequestView();   // the worker already holds the pasted map
    await showNotice(t('tlTitle'), t('tlPasteDone').replace('{save}', save.name).replace('{list}', r.counts.map(c => `${c.name}: ${c.px.toLocaleString(FIN_LOCALE())} px`).join('\n')).replace('{backup}', r.backup));
}

async function tlRestore() {
    const save = tlCurrentSave();
    if (!save) return;
    if (await tlGameRunning()) { await showNotice(t('tlTitle'), t('tlGameRunning'), true); return; }
    const ok = await showConfirm({ title: t('tlRestore'), body: t('tlRestoreConfirm').replace('{save}', save.name), confirmText: t('tlRestore'), danger: true });
    if (ok !== true) return;
    const r = await tlBusy(t('tlRestoring'), () => tlCall('restore', { saveDir: save.dir }));
    if (!r) return;
    tl.loaded = null;
    await tlEnsureLoaded();
    await showNotice(t('tlTitle'), t('tlRestored').replace('{file}', path.basename(r)));
}

async function tlImport() {
    const save = tlCurrentSave();
    if (!save) return;
    const res = await ipcRenderer.invoke('show-open-dialog', {
        title: t('tlImport'),
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PNG / GIMP', extensions: ['png', 'xcf'] }]
    });
    if (!res || res.canceled || !res.filePaths.length) return;
    const outDir = tlLibraryDir(save.title);
    const pngs = res.filePaths.filter(f => /\.png$/i.test(f)), xcfs = res.filePaths.filter(f => /\.xcf$/i.test(f));
    const names = await tlBusy(t('tlImporting'), async () => {
        const out = pngs.length ? await tlCall('importPngs', { files: pngs, outDir }) : [];
        for (const x of xcfs) out.push(...await tlCall('importXcf', { file: x, outDir }));
        return out;
    });
    if (!names) return;
    tlRefreshLibrary();
    tlRenderSide();
    tlDraw();
    await showNotice(t('tlTitle'), names.length ? t('tlImported').replace('{n}', names.length).replace('{map}', save.title || '?') : t('tlImportedNone'), !names.length);
}

async function tlExport(entry) {
    const res = await ipcRenderer.invoke('show-save-dialog', { title: t('tlExport'), defaultPath: entry.name + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!res || res.canceled || !res.filePath) return;
    await tlBusy(t('tlExporting'), () => tlCall('exportFull', { entry: entry.file, outPath: res.filePath }));
}

async function tlDeleteEntry(entry) {
    const ok = await showConfirm({ title: t('tlTitle'), body: t('tlDeleteConfirm').replace('{name}', entry.name), confirmText: t('delete'), danger: true });
    if (ok !== true) return;
    [entry.file, entry.file.replace(/\.json$/i, '.png')].forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* already gone */ } });
    if (tl.editor && tl.editor.name === entry.name) tl.editor = null;
    tlRefreshLibrary();
    tlRenderSide();
    tlDraw();
}

// ---------- editor ----------
function tlEditorOpen(name) {
    const e = tl.entries.find(x => x.name === name);
    if (!e) { tl.editor = null; return; }
    const png = tlCore.decodePng(fs.readFileSync(e.file.replace(/\.json$/i, '.png')));
    const m = TL_EDIT_MARGIN, w = png.w + 2 * m, h = png.h + 2 * m;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < png.h; y++) rgba.set(png.rgba.subarray(y * png.w * 4, (y + 1) * png.w * 4), ((y + m) * w + m) * 4);
    tl.editor = { name, entry: e, x: e.x - m, y: e.y - m, w, h, rgba, undo: [], mode: 'paint', dirty: false, canvas: null };
    tlZoomTo([e.x, e.y, e.x + e.w, e.y + e.h]);
}

// The open entry as a canvas: tramline pixels bright, the rest clear.
function tlEditorCanvas(rect) {
    const ed = tl.editor;
    if (!ed.canvas) {
        ed.canvas = document.createElement('canvas');
        ed.canvas.width = ed.w; ed.canvas.height = ed.h;
        rect = [0, 0, ed.w, ed.h];
    }
    const [x0, y0, x1, y1] = rect;
    if (x1 <= x0 || y1 <= y0) return;
    const img = new ImageData(x1 - x0, y1 - y0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const s = (y * ed.w + x) * 4, o = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
        if (ed.rgba[s + 3]) { img.data[o] = 255; img.data[o + 1] = 210; img.data[o + 2] = 40; img.data[o + 3] = 230; }
    }
    ed.canvas.getContext('2d').putImageData(img, x0, y0);
}

// One brush dab at map (mx, my); records the changed rectangle for undo.
function tlEditorStamp(mx, my, stroke) {
    const ed = tl.editor;
    const r = Math.floor(tlSettings().brush / 2);
    const cx = Math.floor(mx) - ed.x, cy = Math.floor(my) - ed.y;
    stroke.last = [mx, my];
    const x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r), x1 = Math.min(ed.w, cx + r + 1), y1 = Math.min(ed.h, cy + r + 1);
    if (x1 <= x0 || y1 <= y0) return;
    const v = tl.colors.length ? tl.colors[0] : 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r + r) continue;
        const i = (y * ed.w + x) * 4;
        if (!stroke.saved.has(i)) stroke.saved.set(i, ed.rgba.slice(i, i + 4));
        if (ed.mode === 'erase') ed.rgba[i + 3] = 0;
        else { ed.rgba[i] = v & 255; ed.rgba[i + 1] = (v >> 8) & 255; ed.rgba[i + 2] = (v >> 16) & 255; ed.rgba[i + 3] = 255; }
    }
    ed.dirty = true;
    tlEditorCanvas([x0, y0, x1, y1]);
}

// Dabs from the stroke's last point to (mx, my), so a fast mouse leaves no gaps.
function tlEditorLine(mx, my, stroke) {
    if (!stroke.last) { tlEditorStamp(mx, my, stroke); return; }
    const [lx, ly] = stroke.last;
    const step = Math.max(1, tlSettings().brush / 4);
    const n = Math.ceil(Math.hypot(mx - lx, my - ly) / step);
    for (let i = 1; i <= n; i++) tlEditorStamp(lx + (mx - lx) * i / n, ly + (my - ly) * i / n, stroke);
}

function tlEditorUndo() {
    const ed = tl.editor;
    const last = ed && ed.undo.pop();
    if (!last) return;
    last.forEach((px, i) => ed.rgba.set(px, i));
    ed.canvas = null;
    ed.dirty = true;
    tlRenderSide();
    tlDraw();
}

async function tlEditorSave() {
    const ed = tl.editor;
    const save = tlCurrentSave();
    if (!ed || !save) return;
    // Crop to what's left and write the entry again.
    let x0 = ed.w, y0 = ed.h, x1 = -1, y1 = -1;
    for (let y = 0; y < ed.h; y++) for (let x = 0; x < ed.w; x++) if (ed.rgba[(y * ed.w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    if (x1 < 0) { await showNotice(t('tlTitle'), t('tlEditorEmpty'), true); return; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const out = new Uint8Array(w * h * 4);
    let px = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const s = ((y + y0) * ed.w + x + x0) * 4, o = (y * w + x) * 4;
        out[o] = ed.rgba[s]; out[o + 1] = ed.rgba[s + 1]; out[o + 2] = ed.rgba[s + 2]; out[o + 3] = ed.rgba[s + 3];
        if (out[o + 3]) px++;
    }
    const meta = { ...ed.entry, x: ed.x + x0, y: ed.y + y0, w, h, px, editedAt: new Date().toISOString() };
    delete meta.name; delete meta.file;
    fs.writeFileSync(ed.entry.file.replace(/\.json$/i, '.png'), tlCore.encodePngRgba(out, w, h));
    fs.writeFileSync(ed.entry.file, JSON.stringify(meta, null, 2));
    const name = ed.name;
    tlRefreshLibrary();
    tlEditorOpenKeepView(name);
    tlRenderSide();
    tlDraw();
}

function tlEditorOpenKeepView(name) {
    const view = tl.view;
    tlEditorOpen(name);
    tl.view = view;
}

// ---------- wiring ----------
(function wireTramlines() {
    const view = document.getElementById('tramlines-view');
    const side = document.getElementById('tl-side');
    const c = tlCanvas();
    if (!view || !side || !c) return;
    const openBtn = document.getElementById('tramlines-btn');
    if (openBtn) openBtn.addEventListener('click', tlOpen);
    document.getElementById('tl-back').addEventListener('click', tlClose);
    view.querySelectorAll('.tl-tab').forEach(b => b.addEventListener('click', () => {
        tl.tab = b.dataset.tltab;
        tl.lassoOn = false; tl.lassoPts = [];
        tlRenderSide();
        tlRequestView();
    }));
    window.addEventListener('resize', () => { if (!view.hidden) tlResizeCanvas(); });

    side.addEventListener('change', async e => {
        const el = e.target;
        if (el.id === 'tl-save') {
            if (!(await tlDiscardOk())) { el.value = tl.saveDir; return; }
            tl.saveDir = el.value; tl.editor = null; tl.pasteSel.clear();
            tlRefreshLibrary(); tlRenderSide(); tlEnsureLoaded();
        } else if (el.classList.contains('tl-entry-check')) {
            const name = el.closest('.tl-entry').dataset.name;
            if (el.checked) tl.pasteSel.add(name); else tl.pasteSel.delete(name);
            tlRenderSide(); tlDraw();
        } else if (el.classList.contains('tl-field-check')) {
            const key = el.closest('.tl-entry').dataset.key;
            if (el.checked) tl.selected.add(key); else tl.selected.delete(key);
            tlRenderSide(); tlDraw();
        } else if (el.id === 'tl-highlight') {
            tl.highlight = el.checked; tlRequestView();
        } else if (el.id === 'tl-editor-entry') {
            if (!(await tlDiscardOk())) { el.value = tl.editor.name; return; }
            tlEditorOpen(el.value); tlRenderSide(); tlDraw();
        } else if (el.id === 'tl-brush') {
            tlSaveSettings({ brush: parseInt(el.value, 10) || 9 }); tlRenderSide();
        } else if (el.classList.contains('tl-setting')) {
            const key = el.dataset.key;
            const val = el.type === 'number' ? Math.max(+el.min || 0, Math.min(+el.max || 1e9, parseInt(el.value, 10) || 0)) : el.value.trim();
            tlSaveSettings({ [key]: val });
            if (key === 'gameDir') { tl.saves = tlListSaves(); tl.saveDir = tl.saves.length ? tl.saves[0].dir : ''; tlStopWorker(); tlRefreshLibrary(); }
            if (key === 'threshold') tl.overlays = {};
        }
    });

    side.addEventListener('click', e => {
        const tg = e.target;
        const entryEl = tg.closest('.tl-entry[data-name]');
        const entry = entryEl && tl.entries.find(x => x.name === entryEl.dataset.name);
        if (tg.closest('.tl-paste')) tlPaste();
        else if (tg.closest('.tl-restore')) tlRestore();
        else if (tg.closest('.tl-import')) tlImport();
        else if (tg.closest('.tl-open-lib')) { const save = tlCurrentSave(); if (save) { const d = tlLibraryDir(save.title); fs.mkdirSync(d, { recursive: true }); require('electron').shell.openPath(d); } }
        else if (tg.closest('.tl-select-all')) { tl.entries.forEach(x => { if (!tl.loaded || x.mapSize === tl.loaded.dim) tl.pasteSel.add(x.name); }); tlRenderSide(); tlDraw(); }
        else if (tg.closest('.tl-select-none')) { tl.pasteSel.clear(); tlRenderSide(); tlDraw(); }
        else if (tg.closest('.tl-entry-zoom') && entry) { if (tl.tab === 'paste') tl.pasteSel.add(entry.name); tlRenderSide(); tlZoomTo([entry.x, entry.y, entry.x + entry.w, entry.y + entry.h]); }
        else if (tg.closest('.tl-entry-export') && entry) tlExport(entry);
        else if (tg.closest('.tl-entry-delete') && entry) tlDeleteEntry(entry);
        else if (tg.closest('.tl-detect-map')) tlDetectMap();
        else if (tg.closest('.tl-detect-ground')) tlDetectGround();
        else if (tg.closest('.tl-lasso')) { tl.lassoOn = !tl.lassoOn; tl.lassoPts = []; tlRenderSide(); tlDraw(); }
        else if (tg.closest('.tl-lasso-clear')) { tl.lasso = []; tlRenderSide(); tlDraw(); }
        else if (tg.closest('.tl-color-remove')) { tl.colors.splice(+tg.closest('.tl-color-remove').dataset.i, 1); tlRenderSide(); tlRequestView(); }
        else if (tg.closest('.tl-fields-all')) { [...(tl.mapFields || []), ...(tl.groundFields || [])].forEach(f => tl.selected.add(f.key)); tlRenderSide(); tlDraw(); }
        else if (tg.closest('.tl-fields-none')) { tl.selected.clear(); tlRenderSide(); tlDraw(); }
        else if (tg.closest('.tl-field-zoom')) {
            const key = tg.closest('.tl-entry').dataset.key;
            const f = [...(tl.mapFields || []), ...(tl.groundFields || [])].find(x => x.key === key);
            if (f) tlZoomTo(f.bbox);
        }
        else if (tg.closest('.tl-cut')) tlCut();
        else if (tg.closest('.tl-mode')) { tl.editor.mode = tg.closest('.tl-mode').dataset.mode; tlRenderSide(); }
        else if (tg.closest('.tl-undo')) tlEditorUndo();
        else if (tg.closest('.tl-editor-save')) tlEditorSave();
    });

    // Canvas: wheel = zoom, drag = pan (right/middle always), Ctrl+click =
    // pick a tramline colour, click = select a field / lasso point; in the
    // editor the left button paints or erases.
    let drag = null;
    const pos = e => { const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; };
    c.addEventListener('wheel', e => {
        if (!tl.view) return;
        e.preventDefault();
        const [sx, sy] = pos(e), [mx, my] = tlToMap(sx, sy);
        const k = e.deltaY < 0 ? 1.25 : 0.8;
        const minS = Math.min(c.width, c.height) / (tl.loaded ? tl.loaded.dim : 1) / 2;
        const s = Math.max(minS, Math.min(32, tl.view.scale * k));
        tl.view = { scale: s, x0: mx - sx / s, y0: my - sy / s };
        tlDraw();
        tlRequestView();
    }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('mousedown', e => {
        if (!tl.view) return;
        const [sx, sy] = pos(e);
        const painting = e.button === 0 && tl.tab === 'editor' && tl.editor && !e.ctrlKey;
        drag = { sx, sy, x0: tl.view.x0, y0: tl.view.y0, moved: false, button: e.button, paint: painting ? { saved: new Map() } : null };
        if (painting) { const [mx, my] = tlToMap(sx, sy); tlEditorStamp(mx, my, drag.paint); tlDraw(); }
    });
    window.addEventListener('mousemove', e => {
        if (!drag || view.hidden) return;
        const [sx, sy] = pos(e);
        if (Math.abs(sx - drag.sx) + Math.abs(sy - drag.sy) > 4) drag.moved = true;
        if (drag.paint) { const [mx, my] = tlToMap(sx, sy); tlEditorLine(mx, my, drag.paint); tlDraw(); return; }
        if (!drag.moved || (drag.button === 0 && tl.lassoOn)) return;
        tl.view = { ...tl.view, x0: drag.x0 - (sx - drag.sx) / tl.view.scale, y0: drag.y0 - (sy - drag.sy) / tl.view.scale };
        tlDraw();
        tlRequestView();
    });
    window.addEventListener('mouseup', async e => {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (d.paint) {
            if (d.paint.saved.size) tl.editor.undo.push(d.paint.saved);
            if (tl.editor.undo.length > 40) tl.editor.undo.shift();
            tlRenderSide();
            return;
        }
        if (d.moved || d.button !== 0 || !tl.view) return;
        const [mx, my] = tlToMap(...pos(e));
        if (e.ctrlKey && (tl.tab === 'cut' || tl.tab === 'editor')) {
            const v = await tlCall('pick', { x: mx, y: my }).catch(() => null);
            if (v == null) return;
            if (tl.tab === 'editor') { tl.colors = [v, ...tl.colors.filter(x => x !== v)]; }
            else if (!tl.colors.includes(v)) tl.colors.push(v);
            tlRenderSide();
            tlRequestView();
            return;
        }
        if (tl.tab !== 'cut') return;
        if (tl.lassoOn) { tl.lassoPts.push([mx, my]); tlDraw(); return; }
        const inPoly = (P, x, y) => { let ins = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) ins = !ins; } return ins; };
        const hit = (tl.mapFields || []).find(f => inPoly(f.poly, mx, my))
            || (tl.groundFields || []).filter(f => mx >= f.bbox[0] && mx < f.bbox[2] && my >= f.bbox[1] && my < f.bbox[3]).sort((a, b) => a.px - b.px)[0];
        if (!hit) return;
        if (tl.selected.has(hit.key)) tl.selected.delete(hit.key); else tl.selected.add(hit.key);
        tlRenderSide();
        tlDraw();
    });
    c.addEventListener('dblclick', () => {
        if (!tl.lassoOn || tl.lassoPts.length < 3) return;
        tl.lasso.push(tl.lassoPts.slice(0, -1).length >= 3 ? tl.lassoPts.slice(0, -1) : tl.lassoPts);
        tl.lassoPts = [];
        tlRenderSide();
        tlDraw();
    });
    document.addEventListener('keydown', e => {
        if (view.hidden) return;
        if (e.key === 'Escape') {
            if (tl.lassoPts.length) { tl.lassoPts = []; tlDraw(); e.stopPropagation(); }
            else if (tl.lassoOn) { tl.lassoOn = false; tlRenderSide(); }
        } else if (e.key === 'Enter' && tl.lassoOn && tl.lassoPts.length >= 3) {
            tl.lasso.push(tl.lassoPts); tl.lassoPts = []; tlRenderSide(); tlDraw();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && tl.tab === 'editor' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
            e.preventDefault(); tlEditorUndo();
        }
        if (e.key === 'Control') tlUpdateCursor(true);
    });
    document.addEventListener('keyup', e => { if (e.key === 'Control' && !view.hidden) tlUpdateCursor(); });
})();
