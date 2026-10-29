// Map scaling tool (skalowanie mapy) — doubles the resolution of a map mod's
// layers (density maps, info layers, their PNGs, the height map). The map's
// size and objects stay; only the pixels per metre double. Nothing in the mods
// folder is touched: the originals are copied to <data>/maps/<map>/backup/<stamp>/
// and the scaled files go to <data>/maps/<map>/scaled/<stamp>/ — the player
// copies them into the mod. A classic <script> after tramlines.js; the heavy
// work runs in map-scale-worker.js (own process).

const { overrideDir: msOverrideDir, modAssistantFolders: msModAssistantFolders } = require('./mod-locator');

const MS_GROUPS = ['dem', 'gdm', 'grle', 'png'];
const MS_BIG = 16384;     // past this a layer is unusually large for the game

const ms = {
    maps: [],
    key: '',                 // "<dir>|<name>" of the picked map
    info: null,              // worker inspect() result
    sel: new Set(),          // picked file rels
    running: null,           // { i, n, name, frac }
    result: null,            // worker run() result
    error: ''
};

// ---------- worker ----------
let msWorker = null, msCallId = 0;
const msPending = {};

function msStartWorker() {
    if (msWorker) return msWorker;
    const { fork } = require('child_process');
    msWorker = fork(path.join(__dirname, 'map-scale-worker.js'), [], {
        execPath: process.execPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        serialization: 'advanced',
        stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });
    msWorker.on('message', m => {
        if (m.progress) { ms.running = m.progress; msRenderProgress(); return; }
        const p = msPending[m.id];
        if (p) { delete msPending[m.id]; p(m); }
    });
    msWorker.on('exit', () => {
        msWorker = null;
        Object.keys(msPending).forEach(k => { msPending[k]({ ok: false, error: 'MS_WORKER_EXIT' }); delete msPending[k]; });
    });
    return msWorker;
}

function msCall(op, args) {
    const w = msStartWorker();
    return new Promise((resolve, reject) => {
        const id = ++msCallId;
        msPending[id] = m => (m.ok ? resolve(m.result) : reject(Object.assign(new Error(m.error), { code: m.error, extra: m.extra || {} })));
        w.send({ id, op, args });
    });
}

function msErrorText(e) {
    const key = 'msErr_' + (e.code || 'MS_ERROR');
    const txt = TRANSLATIONS.en[key] ? t(key) : t('msErr_MS_ERROR');
    const x = e.extra || {};
    return txt.replace('{name}', x.name || '').replace('{need}', x.need || '').replace('{msg}', x.msg || e.message || '');
}

// ---------- data ----------
function msModsDirs() {
    const gameDir = tlGameDir();
    const dirs = [msOverrideDir(gameDir), path.join(gameDir, 'mods'), ...msModAssistantFolders()].filter(Boolean);
    const seen = new Set();
    return dirs.filter(d => {
        const k = path.resolve(d).toLowerCase();
        if (seen.has(k) || !fs.existsSync(d)) return false;
        seen.add(k);
        return true;
    });
}

function msCurrentMap() {
    return ms.maps.find(m => m.dir + '|' + m.name === ms.key) || null;
}

function msOutRoot(map) {
    return path.join(appDataDir, 'maps', tlSafeName(map.title || map.name));
}

function msFmtMb(bytes) {
    return (bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0) + ' MB';
}

function msGroupOf(f) {
    return f.dem ? 'dem' : f.kind;
}

// ---------- view ----------
async function msOpen() {
    const view = document.getElementById('mapscale-view');
    if (!view) return;
    if (dashboardView) dashboardView.style.display = 'none';
    view.hidden = false;
    ms.result = null; ms.error = '';
    if (!ms.maps.length) {
        msRender(t('msSearching'));
        try { ms.maps = await msCall('listMaps', { dirs: msModsDirs() }); }
        catch (e) { console.error(e); ms.error = msErrorText(e); }
    }
    if (!msCurrentMap() && ms.maps.length) ms.key = ms.maps[0].dir + '|' + ms.maps[0].name;
    await msInspect();
}

function msClose() {
    if (ms.running) return;
    const view = document.getElementById('mapscale-view');
    if (view) view.hidden = true;
    if (dashboardView) dashboardView.style.display = 'flex';
    if (msWorker) { msWorker.kill(); msWorker = null; }
    ms.maps = [];
}

async function msInspect() {
    const map = msCurrentMap();
    ms.info = null; ms.sel.clear(); ms.result = null;
    if (!map) { msRender(); return; }
    msRender(t('msReading'));
    try {
        ms.info = await msCall('inspect', { dir: map.dir, name: map.name });
        // Everything but the height map starts ticked: a finer terrain mesh is a bigger step.
        ms.info.files.forEach(f => { if (!f.reason && !f.dem) ms.sel.add(f.rel); });
        ms.error = '';
    } catch (e) { console.error(e); ms.error = msErrorText(e); }
    msRender();
}

function msFileRowHtml(f) {
    const off = !!f.reason || !!ms.running;
    const size = f.w ? `${f.w} → ${f.w2} px` : '';
    const note = f.reason ? t('msReason_' + f.reason) : (Math.max(f.w2, f.h2) > MS_BIG ? t('msBigNote') : '');
    return `<label class="ms-file${f.reason ? ' is-off' : ''}">
        <input type="checkbox" class="fp-check" data-rel="${escapeHtml(f.rel)}"${ms.sel.has(f.rel) ? ' checked' : ''}${off ? ' disabled' : ''}>
        <span class="ms-file-name" title="${escapeHtml(f.out)}">${escapeHtml(f.out)}</span>
        <span class="ms-file-size">${size}</span>
        <span class="ms-file-mb">${msFmtMb(f.bytes)}</span>
        ${note ? `<span class="ms-file-note">${escapeHtml(note)}</span>` : ''}
    </label>`;
}

function msListHtml() {
    const files = ms.info ? ms.info.files : [];
    if (!files.length) return `<p class="settings-hint">${escapeHtml(t('msNoFiles'))}</p>`;
    return MS_GROUPS.map(g => {
        const items = files.filter(f => msGroupOf(f) === g);
        if (!items.length) return '';
        const on = items.filter(f => !f.reason);
        const all = on.length && on.every(f => ms.sel.has(f.rel));
        return `<section class="ms-group">
            <h3 class="ms-group-title">
                <label class="tl-check"><input type="checkbox" class="fp-check" data-group="${g}"${all ? ' checked' : ''}${!on.length || ms.running ? ' disabled' : ''}> ${escapeHtml(t('msGroup_' + g))}</label>
                <span class="ms-group-count">${items.filter(f => ms.sel.has(f.rel)).length} / ${items.length}</span>
            </h3>
            ${items.map(msFileRowHtml).join('')}
        </section>`;
    }).join('');
}

function msSideHtml(busy) {
    const map = msCurrentMap();
    const info = ms.info;
    let html = `<p class="settings-hint">${escapeHtml(t('msHint'))}</p>`;
    if (!ms.maps.length) {
        html += `<p class="settings-hint">${escapeHtml(busy ? '' : t('msNoMaps'))}</p>`;
        return html;
    }
    html += `<label class="ms-field"><span>${escapeHtml(t('msMap'))}</span>
        <select id="ms-map"${ms.running ? ' disabled' : ''}>${ms.maps.map(m => `<option value="${escapeHtml(m.dir + '|' + m.name)}"${m.dir + '|' + m.name === ms.key ? ' selected' : ''}>${escapeHtml(m.title)} (${escapeHtml(m.name)}${m.zip ? '.zip' : ''})</option>`).join('')}</select></label>`;
    if (info && info.sizeM) {
        html += `<p class="ms-mapinfo">${escapeHtml(t('msMapInfo').replace(/\{size\}/g, info.sizeM).replace('{dem}', info.demW).replace('{upp}', info.upp))}</p>`;
    }
    if (info) {
        const picked = info.files.filter(f => ms.sel.has(f.rel));
        const bytes = picked.reduce((s, f) => s + f.bytes, 0);
        const dem = picked.find(f => f.dem);
        html += `<div class="tl-row">
            <button type="button" class="tl-link" data-ms="all"${ms.running ? ' disabled' : ''}>${escapeHtml(t('msSelectAll'))}</button>
            <button type="button" class="tl-link" data-ms="none"${ms.running ? ' disabled' : ''}>${escapeHtml(t('msSelectNone'))}</button>
        </div>`;
        if (dem) html += `<p class="settings-hint ms-warn">${escapeHtml(t('msDemNote').replace('{i3d}', info.i3dRel).replace('{from}', info.upp).replace('{to}', info.upp / 2))}</p>`;
        html += `<p class="ms-total">${escapeHtml(t('msTotal').replace('{n}', picked.length).replace('{mb}', msFmtMb(bytes)))}</p>`;
        html += ms.running
            ? `<button type="button" class="settings-btn" data-ms="cancel">${escapeHtml(t('msCancel'))}</button>`
            : `<button type="button" class="edit-season-btn ms-start" data-ms="start"${picked.length ? '' : ' disabled'}>${escapeHtml(t('msStart').replace('{n}', picked.length))}</button>`;
        html += `<p class="settings-hint">${escapeHtml(t('msOutHint').replace('{dir}', msOutRoot(map)))}</p>`;
    }
    return html;
}

function msResultHtml() {
    const r = ms.result, map = msCurrentMap();
    if (!r) return '';
    const modPath = map ? path.join(map.dir, map.name + (map.zip ? '.zip' : '')) : '';
    return `<section class="ms-done" role="status">
        <h3 class="ms-group-title"><span><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${escapeHtml(t('msDone').replace('{n}', r.files.length))}</span></h3>
        <p class="settings-hint">${escapeHtml(t(map && map.zip ? 'msDoneZip' : 'msDoneHint').replace('{mod}', modPath))}</p>
        ${r.i3d ? `<p class="settings-hint ms-warn">${escapeHtml(t('msDoneI3d').replace('{i3d}', r.i3d.rel).replace('{from}', r.i3d.from).replace('{to}', r.i3d.to))}</p>` : ''}
        <p class="settings-hint ms-warn">${escapeHtml(t('msNewSave'))}</p>
        <div class="tl-row">
            <button type="button" class="settings-btn" data-ms="open-scaled"><i class="fa-solid fa-folder-open" aria-hidden="true"></i> ${escapeHtml(t('msOpenScaled'))}</button>
            <button type="button" class="settings-btn" data-ms="open-backup"><i class="fa-solid fa-box-archive" aria-hidden="true"></i> ${escapeHtml(t('msOpenBackup'))}</button>
        </div>
        <ul class="ms-done-list">${r.files.map(f => `<li><span>${escapeHtml(f.out)}</span><span class="ms-file-size">${f.w} px · ${msFmtMb(f.bytes)}</span></li>`).join('')}</ul>
    </section>`;
}

function msRender(busy) {
    const side = document.getElementById('ms-side'), list = document.getElementById('ms-list');
    if (!side || !list) return;
    side.innerHTML = msSideHtml(busy) + `<div id="ms-progress" class="ms-progress"${ms.running || busy ? '' : ' hidden'}></div>`
        + (ms.error ? `<p class="settings-hint ms-error" role="alert">${escapeHtml(ms.error)}</p>` : '');
    list.innerHTML = msResultHtml() + (busy && !ms.info ? '' : msListHtml());
    msRenderProgress(busy);
}

function msRenderProgress(busy) {
    const el = document.getElementById('ms-progress');
    if (!el) return;
    const r = ms.running;
    if (!r) { el.hidden = !busy; el.textContent = busy || ''; return; }
    el.hidden = false;
    const pct = Math.round(((r.i + (r.frac || 0)) / r.n) * 100);
    el.innerHTML = `<span>${escapeHtml(t('msRunning').replace('{name}', r.name).replace('{i}', r.i + 1).replace('{n}', r.n))}</span>
        <span class="ms-bar"><span style="width:${pct}%"></span></span>`;
}

async function msStart() {
    const map = msCurrentMap();
    if (!map || !ms.info || ms.running) return;
    const files = ms.info.files.filter(f => ms.sel.has(f.rel)).map(f => f.rel);
    if (!files.length) return;
    ms.running = { i: 0, n: files.length, name: '', frac: 0 };
    ms.result = null; ms.error = '';
    msRender();
    try {
        ms.result = await msCall('run', { dir: map.dir, name: map.name, files, outRoot: msOutRoot(map) });
    } catch (e) {
        console.error(e);
        ms.error = msErrorText(e);
    } finally {
        ms.running = null;
        msRender();
    }
}

(function wireMapScale() {
    const view = document.getElementById('mapscale-view');
    if (!view) return;
    const openBtn = document.getElementById('mapscale-btn');
    if (openBtn) openBtn.addEventListener('click', msOpen);
    document.getElementById('ms-back').addEventListener('click', msClose);
    view.addEventListener('change', e => {
        const el = e.target;
        if (el.id === 'ms-map') { ms.key = el.value; msInspect(); return; }
        if (!ms.info || ms.running) return;
        if (el.dataset.group) {
            ms.info.files.filter(f => msGroupOf(f) === el.dataset.group && !f.reason).forEach(f => { if (el.checked) ms.sel.add(f.rel); else ms.sel.delete(f.rel); });
            msRender();
        } else if (el.dataset.rel) {
            if (el.checked) ms.sel.add(el.dataset.rel); else ms.sel.delete(el.dataset.rel);
            msRender();
        }
    });
    view.addEventListener('click', e => {
        const b = e.target.closest('[data-ms]');
        if (!b) return;
        const act = b.dataset.ms;
        if (act === 'start') msStart();
        else if (act === 'cancel') msCall('cancel', {}).catch(() => {});
        else if ((act === 'all' || act === 'none') && ms.info && !ms.running) {
            ms.sel.clear();
            if (act === 'all') ms.info.files.forEach(f => { if (!f.reason) ms.sel.add(f.rel); });
            msRender();
        } else if (act === 'open-scaled' && ms.result) require('electron').shell.openPath(ms.result.scaledDir);
        else if (act === 'open-backup' && ms.result) require('electron').shell.openPath(ms.result.backupDir);
    });
})();
