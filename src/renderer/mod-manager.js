// Mod manager (menedżer modów) — mod libraries the way FSG Mod Assistant keeps
// its collections: one folder of mods each, and the game pointed at one of them
// through gameSettings.xml <modsDirectoryOverride>. Lists a library's mods with
// their icons, finds what's wrong with them, compares a library with a save,
// checks ModHub for newer versions, copies, moves, adds and deletes mods.
// A classic <script> after map-scale.js; the logic is in mod-library-core.js.

const mmCore = require('./mod-library-core');
const { decodeDds: mmDecodeDds } = require('./dds');
const { setLibraryDirs: mmSetLibraryDirs, clearModsDirCache: mmClearModsDirCache } = require('./mod-locator');

const MM_ICON_PX = 96;

const mm = {
    libs: [],                // mod-libraries.json
    sel: 'default',          // picked library id, 'default' = <game>/mods
    scan: null,              // { dir, mods, missing }
    scanning: null,          // { i, n }
    tab: 'mods',             // 'mods' | 'compare' | 'problems'
    search: '',
    sort: 'name',            // 'name' | 'size' | 'date'
    filter: 'all',           // 'all' | 'problems' | 'updates'
    picked: new Set(),       // file names in the picked library
    saveDir: '',             // savegame for the comparison
    hub: null,               // ModHub list (mod-library-core loadModHub)
    hubBusy: false,
    busy: null,              // { text, frac, cancel } while files are copied or a download is awaited
    cancelled: false,        // Cancel pressed while waiting for a download
    error: '',
    iconRun: 0
};
const mmIcons = new Map();   // icon cache name -> data URL, '' = none

function mmDataPath(...parts) {
    return path.join(appDataDir, ...parts);
}

function mmLoadLibraries() {
    mm.libs = mmCore.readLibraries(appDataDir);
    mmSetLibraryDirs(mm.libs.map(l => l.dir));
}

function mmSaveLibraries() {
    mmCore.writeLibraries(appDataDir, mm.libs);
    mmSetLibraryDirs(mm.libs.map(l => l.dir));
}

// The game's own folder first, then the libraries in the order they were added.
function mmAllLibs() {
    return [{ id: 'default', name: t('mmDefaultFolder'), dir: path.join(tlGameDir(), 'mods'), isDefault: true }, ...mm.libs];
}

function mmCurrentLib() {
    return mmAllLibs().find(l => l.id === mm.sel) || mmAllLibs()[0];
}

// Which library the game loads now: the override folder, or its own mods folder.
function mmActiveLib() {
    const ov = mmCore.readOverride(tlGameDir());
    if (!ov || !ov.active || !ov.directory) return { id: 'default', other: '' };
    const lib = mm.libs.find(l => mmCore.sameDir(l.dir, ov.directory));
    return lib ? { id: lib.id, other: '' } : { id: null, other: ov.directory };
}

function mmCountMods(dir) {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() || /\.zip$/i.test(e.name)).length; }
    catch { return null; }
}

function mmFmtMb(bytes) {
    return (bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0) + ' MB';
}

function mmTitle(mod) {
    const tt = mod.title || {};
    return tt[currentLang] || tt.en || tt.de || Object.values(tt)[0] || mod.name;
}

function mmListSaves() {
    const dir = tlGameDir();
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.map(n => ({ n, m: n.match(/^savegame(\d+)$/) }))
        .filter(x => x.m && fs.existsSync(path.join(dir, x.n, 'careerSavegame.xml')))
        .map(x => {
            let title = '';
            try { title = (fs.readFileSync(path.join(dir, x.n, 'careerSavegame.xml'), 'utf-8').match(/<savegameName>([^<]*)</) || [])[1] || ''; } catch { /* unreadable */ }
            return { dir: path.join(dir, x.n), name: x.n, num: +x.m[1], title };
        })
        .sort((a, b) => a.num - b.num);
}

function mmErrorText(e) {
    const key = 'mmErr_' + (e && e.code);
    const txt = TRANSLATIONS.en[key] ? t(key) : t('mmErr_MM_ERROR');
    const x = (e && e.extra) || {};
    return txt.replace('{name}', x.name || '').replace('{msg}', (e && e.message) || '');
}

// ---------- open / close ----------
async function mmOpen() {
    const view = document.getElementById('modmanager-view');
    if (!view) return;
    if (dashboardView) dashboardView.style.display = 'none';
    view.hidden = false;
    mm.error = '';
    mmLoadLibraries();
    if (!mmAllLibs().some(l => l.id === mm.sel)) mm.sel = 'default';
    await mmRescan();
}

function mmClose() {
    if (mm.busy) return;
    const view = document.getElementById('modmanager-view');
    if (view) view.hidden = true;
    if (dashboardView) dashboardView.style.display = 'flex';
    mm.iconRun++;
}

async function mmRescan() {
    const lib = mmCurrentLib();
    mm.scan = null;
    mm.picked.clear();
    mm.scanning = { i: 0, n: 0 };
    mmRender();
    const scan = await mmCore.scanLibrary(lib.dir, (i, n) => { mm.scanning = { i, n }; mmRenderStatus(); });
    // Another library may have been picked while this one was read.
    if (mmCurrentLib().id !== lib.id) return;
    mm.scan = { dir: lib.dir, ...scan };
    mm.scanning = null;
    mmClearModsDirCache();
    mmRender();
}

async function mmPick(id) {
    if (mm.busy || id === mm.sel) return;
    mm.sel = id;
    mm.error = '';
    await mmRescan();
}

// ---------- rendering ----------
function mmSideHtml() {
    const active = mmActiveLib();
    const rows = mmAllLibs().map(l => {
        const n = mmCountMods(l.dir);
        const isActive = active.id === l.id;
        return `<button type="button" class="mm-lib${l.id === mm.sel ? ' is-picked' : ''}" data-mm="pick" data-id="${escapeHtml(l.id)}" aria-pressed="${l.id === mm.sel}">
            <span class="mm-lib-name"><i class="fa-solid ${l.isDefault ? 'fa-gamepad' : 'fa-folder'}" aria-hidden="true"></i> ${escapeHtml(l.name)}</span>
            ${isActive ? `<span class="mm-badge is-active">${escapeHtml(t('mmActive'))}</span>` : ''}
            <span class="mm-lib-meta">${n == null ? escapeHtml(t('mmFolderGone')) : escapeHtml(t('mmModsCount').replace('{n}', n))}</span>
        </button>`;
    }).join('');
    const other = active.other
        ? `<p class="settings-hint ms-warn">${escapeHtml(t('mmOtherActive').replace('{dir}', active.other))}</p>
           <button type="button" class="tl-link" data-mm="add-other">${escapeHtml(t('mmAddOther'))}</button>`
        : '';
    const hub = mm.hub
        ? `<p class="settings-hint">${escapeHtml(t('mmHubChecked').replace('{time}', new Date(mm.hub.fetchedAt).toLocaleString(currentLang)))}</p>`
        : '';
    return `<h2 class="mm-side-title">${escapeHtml(t('mmLibraries'))}</h2>
        <div class="mm-libs">${rows}</div>
        ${other}
        <div class="tl-row">
            <button type="button" class="settings-btn" data-mm="new"><i class="fa-solid fa-folder-plus" aria-hidden="true"></i> ${escapeHtml(t('mmNewLibrary'))}</button>
            <button type="button" class="settings-btn" data-mm="import-fsg"><i class="fa-solid fa-file-import" aria-hidden="true"></i> ${escapeHtml(t('mmImportFsg'))}</button>
        </div>
        <div class="tl-row">
            <button type="button" class="settings-btn" data-mm="hub"${mm.hubBusy ? ' disabled' : ''}><i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i> ${escapeHtml(t(mm.hubBusy ? 'mmHubChecking' : 'mmCheckUpdates'))}</button>
        </div>
        ${hub}
        <p class="settings-hint">${escapeHtml(t('mmSideHint'))}</p>`;
}

function mmHeadHtml(lib) {
    const isActive = mmActiveLib().id === lib.id;
    const off = mm.busy ? ' disabled' : '';
    return `<div class="mm-head">
        <div class="mm-head-title">
            <h2 class="tl-view-title">${escapeHtml(lib.name)}</h2>
            <p class="tl-view-desc mm-dir" title="${escapeHtml(lib.dir)}">${escapeHtml(lib.dir)}</p>
            ${lib.notes ? `<p class="tl-view-desc mm-notes">${escapeHtml(lib.notes)}</p>` : ''}
        </div>
        <div class="tl-row mm-head-actions">
            ${isActive
                ? `<span class="mm-badge is-active"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${escapeHtml(t('mmActiveNow'))}</span>`
                : `<button type="button" class="settings-btn" data-mm="activate"${off}><i class="fa-solid fa-power-off" aria-hidden="true"></i> ${escapeHtml(t('mmActivate'))}</button>`}
            <button type="button" class="edit-season-btn" data-mm="play"${off}><i class="fa-solid fa-play" aria-hidden="true"></i> ${escapeHtml(t('mmPlay'))}</button>
            <button type="button" class="settings-btn" data-mm="add"${off}><i class="fa-solid fa-plus" aria-hidden="true"></i> ${escapeHtml(t('mmAddMods'))}</button>
            <button type="button" class="settings-btn" data-mm="open-folder"><i class="fa-solid fa-folder-open" aria-hidden="true"></i> ${escapeHtml(t('mmOpenFolder'))}</button>
            ${lib.isDefault ? '' : `<button type="button" class="settings-btn" data-mm="edit"${off}><i class="fa-solid fa-pen" aria-hidden="true"></i> ${escapeHtml(t('mmEditLibrary'))}</button>
            <button type="button" class="settings-btn" data-mm="remove"${off}><i class="fa-solid fa-trash-can" aria-hidden="true"></i> ${escapeHtml(t('mmRemoveLibrary'))}</button>`}
        </div>
    </div>`;
}

function mmTabsHtml() {
    const problems = mm.scan ? mm.scan.mods.filter(m => m.problems.length).length : 0;
    const tab = (id, icon, label) => `<button type="button" class="view-tab${mm.tab === id ? ' is-active' : ''}" role="tab" aria-selected="${mm.tab === id}" data-mm="tab" data-tab="${id}"><i class="fa-solid ${icon}" aria-hidden="true"></i> <span>${escapeHtml(label)}</span></button>`;
    return `<div class="view-tabs mm-tabs" role="tablist">
        ${tab('mods', 'fa-puzzle-piece', t('mmTabMods'))}
        ${tab('compare', 'fa-code-compare', t('mmTabCompare'))}
        ${tab('problems', 'fa-triangle-exclamation', t('mmTabProblems').replace('{n}', problems))}
    </div>`;
}

function mmVisibleMods() {
    if (!mm.scan) return [];
    const q = mm.search.trim().toLowerCase();
    let mods = mm.scan.mods.filter(m => !q || m.name.toLowerCase().includes(q) || mmTitle(m).toLowerCase().includes(q) || (m.author || '').toLowerCase().includes(q));
    if (mm.filter === 'problems') mods = mods.filter(m => m.problems.length);
    if (mm.filter === 'updates') mods = mods.filter(m => { const h = mmCore.modHubInfo(m, mm.hub); return h && h.newer; });
    const by = {
        name: (a, b) => mmTitle(a).localeCompare(mmTitle(b), currentLang, { sensitivity: 'base' }),
        size: (a, b) => b.size - a.size,
        date: (a, b) => b.mtime - a.mtime
    }[mm.sort];
    return mods.sort(by);
}

function mmBadgesHtml(mod) {
    const badges = mod.problems.map(p => `<span class="mm-badge is-problem" title="${escapeHtml(t('mmProbHint_' + p))}">${escapeHtml(t('mmProb_' + p))}</span>`);
    const h = mmCore.modHubInfo(mod, mm.hub);
    if (h && h.newer) {
        badges.push(`<button type="button" class="mm-badge is-update" data-mm="hub-open" data-url="${escapeHtml(h.url)}" title="${escapeHtml(t('mmOpenModHub'))}">${escapeHtml(t('mmUpdateAvailable').replace('{v}', h.latest))}</button>`);
        badges.push(`<button type="button" class="mm-badge is-update-btn" data-mm="update" data-file="${escapeHtml(mod.file)}"${mm.busy ? ' disabled' : ''}><i class="fa-solid fa-download" aria-hidden="true"></i> ${escapeHtml(t('mmUpdate'))}</button>`);
    }
    else if (h) badges.push(`<button type="button" class="mm-badge is-hub" data-mm="hub-open" data-url="${escapeHtml(h.url)}" title="${escapeHtml(t('mmOpenModHub'))}">ModHub</button>`);
    if (mod.multiplayer) badges.push(`<span class="mm-badge" title="${escapeHtml(t('mmMultiplayer'))}"><i class="fa-solid fa-users" aria-hidden="true"></i></span>`);
    return badges.join('');
}

function mmModRowHtml(mod) {
    const desc = (mod.description[currentLang] || mod.description.en || '').replace(/\s+/g, ' ').slice(0, 300);
    const icon = mmIcons.get(mmCore.iconCacheName(mod));
    return `<div class="mm-mod${mm.picked.has(mod.file) ? ' is-picked' : ''}" data-file="${escapeHtml(mod.file)}"${desc ? ` title="${escapeHtml(desc)}"` : ''}>
        <input type="checkbox" class="fp-check" data-pick="${escapeHtml(mod.file)}"${mm.picked.has(mod.file) ? ' checked' : ''} aria-label="${escapeHtml(mmTitle(mod))}">
        <span class="mm-icon" data-icon="${escapeHtml(mod.file)}">${icon ? `<img src="${icon}" alt="">` : '<i class="fa-solid fa-puzzle-piece" aria-hidden="true"></i>'}</span>
        <span class="mm-mod-main">
            <span class="mm-mod-title">${escapeHtml(mmTitle(mod))}</span>
            <span class="mm-mod-file">${escapeHtml(mod.file)}${mod.author ? ' · ' + escapeHtml(mod.author) : ''}</span>
            <span class="mm-mod-badges">${mmBadgesHtml(mod)}</span>
        </span>
        <span class="mm-mod-ver">${escapeHtml(mod.version || '–')}</span>
        <span class="mm-mod-size">${mmFmtMb(mod.size)}</span>
    </div>`;
}

function mmPickBarHtml() {
    const n = mm.picked.size;
    const targets = mmAllLibs().filter(l => l.id !== mm.sel);
    const off = !n || mm.busy ? ' disabled' : '';
    const updates = mmUpdatable().length;
    return `<div class="tl-row mm-pickbar">
        ${updates ? `<button type="button" class="edit-season-btn mm-update-all" data-mm="update-all"${mm.busy ? ' disabled' : ''}><i class="fa-solid fa-download" aria-hidden="true"></i> ${escapeHtml(t('mmUpdateAll').replace('{n}', updates))}</button>` : ''}
        <label class="tl-check"><input type="checkbox" class="fp-check" data-mm-all${n && n === mmVisibleMods().length ? ' checked' : ''}> ${escapeHtml(t('mmSelected').replace('{n}', n))}</label>
        ${targets.length ? `<select id="mm-target" aria-label="${escapeHtml(t('mmTarget'))}">${targets.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('')}</select>
        <button type="button" class="settings-btn" data-mm="copy"${off}><i class="fa-solid fa-copy" aria-hidden="true"></i> ${escapeHtml(t('mmCopyTo'))}</button>
        <button type="button" class="settings-btn" data-mm="move"${off}><i class="fa-solid fa-right-left" aria-hidden="true"></i> ${escapeHtml(t('mmMoveTo'))}</button>` : ''}
        <button type="button" class="settings-btn" data-mm="delete"${off}><i class="fa-solid fa-trash-can" aria-hidden="true"></i> ${escapeHtml(t('mmDelete'))}</button>
    </div>`;
}

function mmModsHtml() {
    const tools = `<div class="tl-row mm-tools">
        <input type="text" id="mm-search" placeholder="${escapeHtml(t('mmSearch'))}" value="${escapeHtml(mm.search)}" aria-label="${escapeHtml(t('mmSearch'))}">
        <select id="mm-sort" aria-label="${escapeHtml(t('mmSort'))}">
            ${['name', 'size', 'date'].map(s => `<option value="${s}"${mm.sort === s ? ' selected' : ''}>${escapeHtml(t('mmSort_' + s))}</option>`).join('')}
        </select>
        <select id="mm-filter" aria-label="${escapeHtml(t('mmFilter'))}">
            ${['all', 'problems', 'updates'].map(s => `<option value="${s}"${mm.filter === s ? ' selected' : ''}>${escapeHtml(t('mmFilter_' + s))}</option>`).join('')}
        </select>
    </div>`;
    if (!mm.scan) return tools;
    if (mm.scan.missing) return tools + `<p class="settings-hint ms-error">${escapeHtml(t('mmFolderMissing').replace('{dir}', mm.scan.dir))}</p>`;
    if (!mm.scan.mods.length) return tools + `<p class="settings-hint mm-empty">${escapeHtml(t('mmEmpty'))}</p>`;
    const mods = mmVisibleMods();
    const total = mm.scan.mods.reduce((s, m) => s + m.size, 0);
    return tools + mmPickBarHtml()
        + `<p class="ms-total">${escapeHtml(t('mmTotal').replace('{n}', mm.scan.mods.length).replace('{mb}', mmFmtMb(total)))}</p>`
        + `<div class="mm-mods">${mods.length ? mods.map(mmModRowHtml).join('') : `<p class="settings-hint">${escapeHtml(t('mmNothingFound'))}</p>`}</div>`;
}

function mmProblemsHtml() {
    if (!mm.scan) return '';
    const mods = mm.scan.mods.filter(m => m.problems.length);
    if (!mods.length) return `<p class="settings-hint mm-empty"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${escapeHtml(t('mmNoProblems'))}</p>`;
    return `<div class="mm-mods">${mods.map(m => `<div class="mm-problem">
        <span class="mm-mod-main">
            <span class="mm-mod-title">${escapeHtml(m.file)}</span>
            ${m.problems.map(p => `<span class="mm-problem-line"><span class="mm-badge is-problem">${escapeHtml(t('mmProb_' + p))}</span> ${escapeHtml(t('mmProbHint_' + p))}${p === 'duplicate' && m.duplicateOf ? ' ' + escapeHtml(m.duplicateOf.join(', ')) : ''}</span>`).join('')}
        </span>
        <span class="tl-row">
            ${m.suggestedName ? `<button type="button" class="settings-btn" data-mm="rename" data-file="${escapeHtml(m.file)}"${mm.busy ? ' disabled' : ''}>${escapeHtml(t('mmRenameTo').replace('{name}', m.suggestedName + (m.isZip ? '.zip' : '')))}</button>` : ''}
            <button type="button" class="settings-btn" data-mm="delete-one" data-file="${escapeHtml(m.file)}"${mm.busy ? ' disabled' : ''}><i class="fa-solid fa-trash-can" aria-hidden="true"></i> ${escapeHtml(t('mmDelete'))}</button>
        </span>
    </div>`).join('')}</div>`;
}

// Where else a mod the save needs can be found.
function mmFindElsewhere(name) {
    const lower = name.toLowerCase();
    return mmAllLibs().filter(l => l.id !== mm.sel).find(l => {
        try { return fs.readdirSync(l.dir).some(f => f.toLowerCase() === lower + '.zip' || f.toLowerCase() === lower); }
        catch { return false; }
    }) || null;
}

function mmCompareHtml() {
    const saves = mmListSaves();
    if (!saves.length) return `<p class="settings-hint">${escapeHtml(t('mmNoSaves').replace('{dir}', tlGameDir()))}</p>`;
    if (!saves.some(s => s.dir === mm.saveDir)) mm.saveDir = saves[0].dir;
    const pick = `<label class="ms-field mm-save-pick"><span>${escapeHtml(t('mmSaveLabel'))}</span>
        <select id="mm-save">${saves.map(s => `<option value="${escapeHtml(s.dir)}"${s.dir === mm.saveDir ? ' selected' : ''}>${escapeHtml(s.name)}${s.title ? ' · ' + escapeHtml(s.title) : ''}</option>`).join('')}</select></label>`;
    if (!mm.scan || mm.scan.missing) return pick;
    const saveMods = mmCore.readSaveMods(path.join(mm.saveDir, 'careerSavegame.xml')) || [];
    const r = mmCore.compareWithSave(mm.scan.mods, saveMods);
    const section = (title, items) => `<section class="ms-group"><h3 class="ms-group-title"><span>${escapeHtml(title)}</span><span class="ms-group-count">${items.length}</span></h3>${items.join('')}</section>`;
    const missing = r.missing.map(s => {
        const where = mmFindElsewhere(s.name);
        return `<div class="ms-file mm-cmp">
            <span class="ms-file-name">${escapeHtml(s.title || s.name)} <span class="mm-mod-file">${escapeHtml(s.name)}</span></span>
            <span class="ms-file-size">${escapeHtml(s.version || '')}</span>
            ${where
                ? `<button type="button" class="tl-link" data-mm="fetch" data-name="${escapeHtml(s.name)}" data-from="${escapeHtml(where.id)}"${mm.busy ? ' disabled' : ''}>${escapeHtml(t('mmCopyFrom').replace('{lib}', where.name))}</button>`
                : `<span class="ms-file-note">${escapeHtml(t('mmNotFound'))}</span>`}
        </div>`;
    });
    const diff = r.versionDiff.map(d => `<div class="ms-file mm-cmp">
        <span class="ms-file-name">${escapeHtml(mmTitle(d.mod))} <span class="mm-mod-file">${escapeHtml(d.mod.file)}</span></span>
        <span class="ms-file-size">${escapeHtml(t('mmVersionDiffRow').replace('{a}', d.save.version).replace('{b}', d.mod.version))}</span>
    </div>`);
    const unused = r.unused.map(m => `<div class="ms-file mm-cmp">
        <span class="ms-file-name">${escapeHtml(mmTitle(m))} <span class="mm-mod-file">${escapeHtml(m.file)}</span></span>
        <span class="ms-file-mb">${mmFmtMb(m.size)}</span>
    </div>`);
    return pick
        + `<p class="ms-total">${escapeHtml(t('mmCompareSummary').replace('{used}', r.used).replace('{n}', saveMods.filter(s => !/^pdlc_/i.test(s.name)).length))}</p>`
        + (r.missing.length ? section(t('mmMissing'), missing) : `<p class="settings-hint"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${escapeHtml(t('mmAllPresent'))}</p>`)
        + (r.versionDiff.length ? section(t('mmVersionDiff'), diff) : '')
        + (r.unused.length ? section(t('mmUnused'), unused) : '');
}

function mmRender() {
    const side = document.getElementById('mm-side'), main = document.getElementById('mm-main');
    if (!side || !main) return;
    side.innerHTML = mmSideHtml();
    const lib = mmCurrentLib();
    const body = mm.tab === 'compare' ? mmCompareHtml() : mm.tab === 'problems' ? mmProblemsHtml() : mmModsHtml();
    main.innerHTML = mmHeadHtml(lib) + mmTabsHtml()
        + `<div id="mm-status" class="ms-progress" hidden></div>`
        + (mm.error ? `<p class="settings-hint ms-error" role="alert">${escapeHtml(mm.error)}</p>` : '')
        + `<div class="mm-body">${body}</div>`
        + `<div class="mm-drop" hidden><i class="fa-solid fa-file-zipper" aria-hidden="true"></i> ${escapeHtml(t('mmDropHint').replace('{name}', lib.name))}</div>`;
    mmRenderStatus();
    if (mm.tab === 'mods') mmLoadIcons();
}

function mmRenderStatus() {
    const el = document.getElementById('mm-status');
    if (!el) return;
    if (mm.busy) {
        el.hidden = false;
        el.innerHTML = `<span>${escapeHtml(mm.busy.text)}</span>`
            + (mm.busy.frac == null ? '' : `<span class="ms-bar"><span style="width:${Math.round(mm.busy.frac * 100)}%"></span></span>`)
            + (mm.busy.cancel ? `<button type="button" class="settings-btn" data-mm="cancel-wait">${escapeHtml(t('cancel'))}</button>` : '');
    } else if (mm.scanning) {
        el.hidden = false;
        el.textContent = mm.scanning.n ? t('mmScanning').replace('{i}', mm.scanning.i).replace('{n}', mm.scanning.n) : t('mmReading');
    } else {
        el.hidden = true;
        el.textContent = '';
    }
}

// ---------- icons ----------
function mmIconDataUrl(mod) {
    const buf = mmCore.readModIcon(mod);
    if (!buf) return '';
    if (buf.slice(0, 4).toString('latin1') === '\x89PNG') return 'data:image/png;base64,' + buf.toString('base64');
    const img = mmDecodeDds(buf);
    if (!img) return '';
    const src = document.createElement('canvas');
    src.width = img.width; src.height = img.height;
    src.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    const out = document.createElement('canvas');
    out.width = MM_ICON_PX; out.height = MM_ICON_PX;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, MM_ICON_PX, MM_ICON_PX);
    return out.toDataURL('image/png');
}

// Icons appear one after another; decoded ones are kept as small PNGs in
// <data>/cache/mod-icons so the next visit is quick.
async function mmLoadIcons() {
    const run = ++mm.iconRun;
    const dir = mmDataPath('cache', 'mod-icons');
    const slots = [...document.querySelectorAll('#mm-main .mm-icon[data-icon]')];
    const mods = new Map(((mm.scan && mm.scan.mods) || []).map(m => [m.file, m]));
    for (let i = 0; i < slots.length; i++) {
        if (run !== mm.iconRun) return;
        const mod = mods.get(slots[i].dataset.icon);
        if (!mod) continue;
        const key = mmCore.iconCacheName(mod);
        let url = mmIcons.get(key);
        if (url === undefined) {
            const file = path.join(dir, key);
            try { url = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); }
            catch {
                try { url = mmIconDataUrl(mod); } catch (e) { url = ''; }
                if (url) {
                    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); }
                    catch { /* the cache is only a speed-up */ }
                }
            }
            mmIcons.set(key, url);
            if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
        }
        if (url && slots[i].isConnected) slots[i].innerHTML = `<img src="${url}" alt="">`;
    }
}

// ---------- libraries ----------
function mmLibraryForm(lib) {
    return `<div class="mm-form">
        <label class="settings-field"><span>${escapeHtml(t('mmLibName'))}</span><input type="text" id="mm-f-name" maxlength="60" value="${escapeHtml(lib ? lib.name : '')}"></label>
        ${lib ? '' : `<label class="settings-field"><span>${escapeHtml(t('mmLibFolder'))}</span>
            <span class="mm-form-row"><input type="text" id="mm-f-dir" value=""><button type="button" class="settings-btn" id="mm-f-browse">${escapeHtml(t('mmChooseFolder'))}</button></span></label>
        <p class="settings-hint">${escapeHtml(t('mmLibFolderHint').replace('{dir}', mmDataPath('mod-libraries')))}</p>`}
        <label class="settings-field"><span>${escapeHtml(t('mmLibNotes'))}</span><textarea id="mm-f-notes" rows="3">${escapeHtml(lib ? lib.notes || '' : '')}</textarea></label>
    </div>`;
}

async function mmLibraryDialog(lib) {
    const pending = showDialog({
        title: t(lib ? 'mmEditLibrary' : 'mmNewLibrary'),
        bodyHtml: mmLibraryForm(lib),
        confirmText: t(lib ? 'mmSave' : 'mmCreate'),
        cancelText: t('cancel'),
        icon: 'fa-folder-plus'
    });
    const browse = document.getElementById('mm-f-browse');
    if (browse) browse.addEventListener('click', async () => {
        const res = await ipcRenderer.invoke('show-open-dialog', { properties: ['openDirectory', 'createDirectory'] });
        if (res && !res.canceled && res.filePaths[0]) {
            document.getElementById('mm-f-dir').value = res.filePaths[0];
            const name = document.getElementById('mm-f-name');
            if (!name.value.trim()) name.value = path.basename(res.filePaths[0]);
        }
    });
    setTimeout(() => { const n = document.getElementById('mm-f-name'); if (n) n.focus(); }, 50);
    if (await pending !== true) return null;
    return {
        name: document.getElementById('mm-f-name').value.trim(),
        dir: lib ? lib.dir : document.getElementById('mm-f-dir').value.trim(),
        notes: document.getElementById('mm-f-notes').value.trim()
    };
}

async function mmNewLibrary() {
    const v = await mmLibraryDialog(null);
    if (!v) return;
    const name = v.name || (v.dir ? path.basename(v.dir) : '');
    if (!name) { await showNotice(t('mmNewLibrary'), t('mmNeedName'), true); return; }
    const dir = v.dir || mmDataPath('mod-libraries', tlSafeName(name));
    if (mmAllLibs().some(l => mmCore.sameDir(l.dir, dir))) { await showNotice(t('mmNewLibrary'), t('mmAlreadyListed'), true); return; }
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (e) { await showNotice(t('mmNewLibrary'), mmErrorText(e), true); return; }
    const lib = { id: mmCore.newLibraryId(), name, dir, notes: v.notes };
    mm.libs.push(lib);
    mmSaveLibraries();
    mm.sel = lib.id;
    await mmRescan();
}

async function mmEditLibrary() {
    const lib = mmCurrentLib();
    if (lib.isDefault) return;
    const v = await mmLibraryDialog(lib);
    if (!v) return;
    lib.name = v.name || lib.name;
    lib.notes = v.notes;
    mmSaveLibraries();
    mmRender();
}

async function mmRemoveLibrary() {
    const lib = mmCurrentLib();
    if (lib.isDefault) return;
    const isActive = mmActiveLib().id === lib.id;
    const answer = await showConfirm({
        title: t('mmRemoveLibrary'),
        body: t('mmRemoveLibraryBody').replace('{name}', lib.name).replace('{dir}', lib.dir) + (isActive ? '\n\n' + t('mmRemoveActive') : ''),
        confirmText: t('mmRemoveLibrary'),
        extraText: t('mmRemoveWithFiles'),
        danger: true
    });
    if (!answer) return;
    if (answer === 'extra') {
        if (isActive && await tlGameRunning()) { await showNotice(t('mmTitle'), t('mmGameRunning'), true); return; }
        try { await require('electron').shell.trashItem(lib.dir); }
        catch (e) { await showNotice(t('mmRemoveLibrary'), mmErrorText(e), true); return; }
    }
    mm.libs = mm.libs.filter(l => l.id !== lib.id);
    mmSaveLibraries();
    mm.sel = 'default';
    await mmRescan();
}

async function mmImportFsg() {
    const appData = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
    const found = mmCore.readFsgCollections(appData).filter(c => c.game === 25);
    const before = mm.libs.length;
    const added = mmCore.addLibraries(mm.libs, found.filter(c => !mmCore.sameDir(c.dir, path.join(tlGameDir(), 'mods'))));
    if (added) mmSaveLibraries();
    await showNotice(t('mmImportFsg'), added
        ? t('mmImportFsgDone').replace('{n}', added)
        : t(found.length ? 'mmImportFsgNone' : 'mmImportFsgMissing'));
    if (mm.libs.length !== before) mmRender();
}

async function mmAddOtherAsLibrary() {
    const other = mmActiveLib().other;
    if (!other) return;
    mmCore.addLibraries(mm.libs, [{ dir: other }]);
    mmSaveLibraries();
    mmRender();
}

// ---------- activate / play ----------
async function mmActivate(lib, quiet) {
    const gameDir = tlGameDir();
    if (!fs.existsSync(path.join(gameDir, 'gameSettings.xml'))) {
        await showNotice(t('mmTitle'), t('mmNoGameSettings').replace('{dir}', gameDir), true);
        return false;
    }
    if (await tlGameRunning()) { await showNotice(t('mmTitle'), t('mmGameRunning'), true); return false; }
    if (!fs.existsSync(lib.dir)) { await showNotice(t('mmTitle'), t('mmFolderMissing').replace('{dir}', lib.dir), true); return false; }
    let backup;
    try {
        backup = mmCore.setOverride(gameDir, lib.isDefault ? null : lib.dir.replace(/\\/g, '/'), mmDataPath('backups', 'gameSettings'));
    } catch (e) {
        console.error(e);
        await showNotice(t('mmTitle'), mmErrorText(e), true);
        return false;
    }
    mmClearModsDirCache();
    mmRender();
    if (!quiet) await showNotice(t('mmActivate'), t('mmActivated').replace('{name}', lib.name).replace('{file}', backup));
    return true;
}

async function mmPlay() {
    const lib = mmCurrentLib();
    if (mmActiveLib().id !== lib.id && !(await mmActivate(lib, true))) return;
    if (await tlGameRunning()) { await showNotice(t('mmTitle'), t('mmGameRunning'), true); return; }
    require('electron').shell.openExternal(mmCore.FS25_STEAM_URL);
}

// ---------- files ----------
async function mmTrash(p) {
    await require('electron').shell.trashItem(p);
}

// The picked library is the one the running game reads from: hands off.
async function mmLockedByGame(lib) {
    if (mmActiveLib().id !== lib.id) return false;
    if (!(await tlGameRunning())) return false;
    await showNotice(t('mmTitle'), t('mmGameRunningFiles'), true);
    return true;
}

function mmModLabel(mod) {
    return `${mmTitle(mod)} ${mod.version ? mod.version : t('mmNoVersion')}`;
}

// Copy or move `mods` into `target`. A name already there asks first.
async function mmTransfer(mods, target, move) {
    const from = mmCurrentLib();
    if (await mmLockedByGame(from) || await mmLockedByGame(target)) return;
    if (!fs.existsSync(target.dir)) { await showNotice(t('mmTitle'), t('mmFolderMissing').replace('{dir}', target.dir), true); return; }
    let done = 0, skipped = 0, overwriteAll = false;
    const errors = [];
    for (let i = 0; i < mods.length; i++) {
        const mod = mods[i];
        const dest = path.join(target.dir, mod.file);
        if (fs.existsSync(dest) && !overwriteAll) {
            const there = mmCore.readModEntry(target.dir, mod.file);
            const answer = await showConfirm({
                title: t('mmConflictTitle'),
                body: t('mmConflict').replace('{name}', mod.file).replace('{lib}', target.name)
                    .replace('{a}', mmModLabel(mod)).replace('{b}', there ? mmModLabel(there) : '–'),
                confirmText: t('mmOverwrite'),
                cancelText: t('mmSkip'),
                extraText: mods.length - i > 1 ? t('mmOverwriteAll') : null,
                icon: 'fa-clone'
            });
            if (!answer) { skipped++; continue; }
            if (answer === 'extra') overwriteAll = true;
        }
        mm.busy = { text: t(move ? 'mmMoving' : 'mmCopying').replace('{name}', mod.file).replace('{i}', i + 1).replace('{n}', mods.length), frac: i / mods.length };
        mmRenderStatus();
        try {
            const progress = (a, b) => { mm.busy.frac = (i + (b ? a / b : 1)) / mods.length; mmRenderStatus(); };
            // The copy being replaced goes to the Recycle Bin, not away for good.
            if (fs.existsSync(dest)) await mmTrash(dest);
            if (move) {
                await mmCore.moveMod(mod.path, target.dir, mod.file, mmTrash, progress);
            } else {
                await mmCore.copyMod(mod.path, target.dir, mod.file, progress);
            }
            done++;
        } catch (e) {
            console.error(e);
            errors.push(mod.file + ': ' + mmErrorText(e));
        }
    }
    mm.busy = null;
    await mmRescan();
    await showNotice(t(move ? 'mmMoveTo' : 'mmCopyTo'), t('mmTransferDone').replace('{n}', done).replace('{lib}', target.name)
        + (skipped ? '\n' + t('mmSkipped').replace('{n}', skipped) : '')
        + (errors.length ? '\n\n' + errors.join('\n') : ''), !!errors.length);
}

async function mmDelete(mods) {
    if (!mods.length || await mmLockedByGame(mmCurrentLib())) return;
    const ok = await showConfirm({
        title: t('mmDelete'),
        body: t('mmDeleteBody').replace('{n}', mods.length) + '\n' + mods.slice(0, 8).map(m => m.file).join('\n') + (mods.length > 8 ? '\n…' : ''),
        confirmText: t('mmDelete'),
        danger: true
    });
    if (!ok) return;
    const errors = [];
    for (const mod of mods) {
        try { await mmTrash(mod.path); }
        catch (e) { errors.push(mod.file + ': ' + mmErrorText(e)); }
    }
    await mmRescan();
    if (errors.length) await showNotice(t('mmDelete'), errors.join('\n'), true);
}

async function mmRename(file) {
    const mod = mm.scan && mm.scan.mods.find(m => m.file === file);
    if (!mod || !mod.suggestedName || await mmLockedByGame(mmCurrentLib())) return;
    try { mmCore.renameMod(mod, mod.suggestedName); }
    catch (e) { await showNotice(t('mmTitle'), mmErrorText(e), true); return; }
    await mmRescan();
}

// Copies a mod the save needs from the library that has it.
async function mmFetch(name, fromId) {
    const from = mmAllLibs().find(l => l.id === fromId);
    if (!from) return;
    const file = fs.readdirSync(from.dir).find(f => f.toLowerCase() === name.toLowerCase() + '.zip' || f.toLowerCase() === name.toLowerCase());
    if (!file) return;
    const target = mmCurrentLib();
    if (await mmLockedByGame(target)) return;
    mm.busy = { text: t('mmCopying').replace('{name}', file).replace('{i}', 1).replace('{n}', 1), frac: 0 };
    mmRenderStatus();
    try {
        await mmCore.copyMod(path.join(from.dir, file), target.dir, file, (a, b) => { mm.busy.frac = b ? a / b : 1; mmRenderStatus(); });
    } catch (e) {
        console.error(e);
        mm.error = mmErrorText(e);
    }
    mm.busy = null;
    await mmRescan();
}

// Zips from the file dialog or dropped on the view: checked, then copied in.
async function mmInstall(files) {
    const lib = mmCurrentLib();
    if (!files.length || mm.busy || await mmLockedByGame(lib)) return;
    if (!fs.existsSync(lib.dir)) { await showNotice(t('mmTitle'), t('mmFolderMissing').replace('{dir}', lib.dir), true); return; }
    const notes = [];
    let done = 0;
    for (let i = 0; i < files.length; i++) {
        const src = files[i];
        const base = path.basename(src);
        const check = mmCore.checkModZip(src);
        if (!check.ok) { notes.push(t('mmInstallBad').replace('{file}', base).replace('{reason}', t('mmReason_' + check.reason))); continue; }
        const destName = (check.rename || base.replace(/\.zip$/i, '')) + '.zip';
        if (fs.existsSync(path.join(lib.dir, destName))) {
            const there = mmCore.readModEntry(lib.dir, destName);
            const overwrite = await showConfirm({
                title: t('mmConflictTitle'),
                body: t('mmConflict').replace('{name}', destName).replace('{lib}', lib.name)
                    .replace('{a}', mmModLabel(check.mod)).replace('{b}', there ? mmModLabel(there) : '–'),
                confirmText: t('mmOverwrite'),
                cancelText: t('mmSkip'),
                icon: 'fa-clone'
            });
            if (!overwrite) continue;
            try { await mmTrash(path.join(lib.dir, destName)); } catch (e) { notes.push(base + ': ' + mmErrorText(e)); continue; }
        }
        mm.busy = { text: t('mmCopying').replace('{name}', base).replace('{i}', i + 1).replace('{n}', files.length), frac: i / files.length };
        mmRenderStatus();
        try {
            await mmCore.copyMod(src, lib.dir, destName, (a, b) => { mm.busy.frac = (i + (b ? a / b : 1)) / files.length; mmRenderStatus(); });
            done++;
            if (check.rename) notes.push(t('mmInstallRenamed').replace('{file}', base).replace('{name}', destName));
        } catch (e) {
            notes.push(base + ': ' + mmErrorText(e));
        }
    }
    mm.busy = null;
    await mmRescan();
    await showNotice(t('mmAddMods'), t('mmInstallDone').replace('{n}', done).replace('{lib}', lib.name) + (notes.length ? '\n\n' + notes.join('\n') : ''), done === 0 && notes.length > 0);
}

async function mmAddDialog() {
    const res = await ipcRenderer.invoke('show-open-dialog', {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (res && !res.canceled) await mmInstall(res.filePaths);
}

// ---------- ModHub ----------
async function mmCheckHub() {
    if (mm.hubBusy) return;
    mm.hubBusy = true;
    mmRender();
    try {
        mm.hub = await mmCore.loadModHub(mmDataPath('cache', 'modhub.json'), !!mm.hub);
        const n = mm.scan ? mm.scan.mods.filter(m => { const h = mmCore.modHubInfo(m, mm.hub); return h && h.newer; }).length : 0;
        mm.hubBusy = false;
        if (n) mm.filter = 'updates';
        mmRender();
        await showNotice(t('mmCheckUpdates'), n ? t('mmHubUpdates').replace('{n}', n) : t('mmHubNoUpdates'));
    } catch (e) {
        console.error(e);
        mm.hubBusy = false;
        mmRender();
        await showNotice(t('mmCheckUpdates'), t('mmHubError').replace('{msg}', e.message || ''), true);
    }
}

// Mods in the picked library with a newer version on ModHub.
function mmUpdatable() {
    if (!mm.scan || !mm.hub) return [];
    return mm.scan.mods.filter(m => { const h = mmCore.modHubInfo(m, mm.hub); return h && h.newer; });
}

const MM_DOWNLOAD_WAIT_MS = 10 * 60000;

// ModHub's files come only through a browser: the player's browser downloads
// the zip, and this waits for it to appear, complete, in the Downloads folder.
async function mmAwaitDownload(mod, since, label) {
    const dir = ipcRenderer.sendSync('get-downloads-dir');
    if (!dir) throw Object.assign(new Error('Downloads'), { code: 'MM_NO_DOWNLOADS' });
    let last = null;
    while (Date.now() - since < MM_DOWNLOAD_WAIT_MS) {
        if (mm.cancelled) return null;
        const found = mmCore.findDownloadedZip(dir, mod.name, since);
        // Same size twice in a row: the browser is done writing it.
        if (found && last && found.path === last.path && found.size === last.size) return found.path;
        last = found;
        mm.busy.text = label + ' ' + t('mmWaitingDownload').replace('{dir}', dir);
        mmRenderStatus();
        await new Promise(r => setTimeout(r, 1000));
    }
    throw Object.assign(new Error('Timeout'), { code: 'MM_DOWNLOAD_TIMEOUT' });
}

// For each mod: the ModHub download opens in the browser, and once the zip
// is in Downloads it takes the old version's place (that one goes to the
// Recycle Bin).
async function mmUpdate(mods) {
    const lib = mmCurrentLib();
    if (!mods.length || mm.busy || await mmLockedByGame(lib)) return;
    if (mods.length > 1) {
        const ok = await showConfirm({
            title: t('mmUpdateAll').replace('{n}', mods.length),
            body: t('mmUpdateAllBody').replace('{n}', mods.length) + '\n\n'
                + mods.slice(0, 10).map(m => `${mmTitle(m)}: ${m.version || '–'} → ${mmCore.modHubInfo(m, mm.hub).latest}`).join('\n')
                + (mods.length > 10 ? '\n…' : ''),
            confirmText: t('mmUpdate'),
            icon: 'fa-download'
        });
        if (!ok) return;
    }
    const done = [], errors = [];
    mm.cancelled = false;
    for (let i = 0; i < mods.length && !mm.cancelled; i++) {
        const mod = mods[i];
        const h = mmCore.modHubInfo(mod, mm.hub);
        if (!h) continue;
        const label = t('mmDownloading').replace('{name}', mmTitle(mod)).replace('{i}', i + 1).replace('{n}', mods.length);
        mm.busy = { text: label, frac: null, cancel: true };
        mmRender();
        try {
            const link = await mmCore.modHubDownloadLink(h.id, mod.name);
            const since = Date.now();
            await require('electron').shell.openExternal(link);
            const zip = await mmAwaitDownload(mod, since, label);
            if (!zip) break;
            mm.busy = { text: t('mmInstalling').replace('{name}', mmTitle(mod)), frac: null };
            mmRenderStatus();
            const r = await mmCore.replaceModWithZip(mod, zip, mmTrash);
            done.push(`${mmTitle(mod)}: ${mod.version || '–'} → ${r.version || h.latest}`);
        } catch (e) {
            console.error(e);
            errors.push(mmTitle(mod) + ': ' + mmErrorText(e));
        }
    }
    mm.busy = null;
    if (!done.length && !errors.length) { mmRender(); return; }
    await mmRescan();
    await showNotice(t('mmUpdate'),
        (done.length ? t('mmUpdateDone').replace('{n}', done.length) + '\n' + done.join('\n') : '')
        + (errors.length ? (done.length ? '\n\n' : '') + errors.join('\n') : ''),
        !done.length);
}

// ---------- wiring ----------
(function wireModManager() {
    const view = document.getElementById('modmanager-view');
    if (!view) return;
    const openBtn = document.getElementById('modmanager-btn');
    if (openBtn) openBtn.addEventListener('click', mmOpen);
    document.getElementById('mm-back').addEventListener('click', mmClose);
    // Library folders count for "where is this save's mod" from the start.
    try { mmLoadLibraries(); } catch (e) { console.error(e); }

    view.addEventListener('click', e => {
        const b = e.target.closest('[data-mm]');
        if (!b || b.disabled) return;
        const act = b.dataset.mm;
        const picked = () => (mm.scan ? mm.scan.mods.filter(m => mm.picked.has(m.file)) : []);
        if (act === 'pick') mmPick(b.dataset.id);
        else if (act === 'tab') { mm.tab = b.dataset.tab; mmRender(); }
        else if (act === 'new') mmNewLibrary();
        else if (act === 'edit') mmEditLibrary();
        else if (act === 'remove') mmRemoveLibrary();
        else if (act === 'import-fsg') mmImportFsg();
        else if (act === 'add-other') mmAddOtherAsLibrary();
        else if (act === 'activate') mmActivate(mmCurrentLib());
        else if (act === 'play') mmPlay();
        else if (act === 'add') mmAddDialog();
        else if (act === 'open-folder') require('electron').shell.openPath(mmCurrentLib().dir);
        else if (act === 'hub') mmCheckHub();
        else if (act === 'hub-open') require('electron').shell.openExternal(b.dataset.url);
        else if (act === 'update') mmUpdate(mm.scan ? mm.scan.mods.filter(m => m.file === b.dataset.file) : []);
        else if (act === 'update-all') mmUpdate(mmUpdatable());
        else if (act === 'cancel-wait') mm.cancelled = true;
        else if (act === 'copy' || act === 'move') {
            const target = mmAllLibs().find(l => l.id === document.getElementById('mm-target').value);
            if (target && picked().length) mmTransfer(picked(), target, act === 'move');
        }
        else if (act === 'delete') mmDelete(picked());
        else if (act === 'delete-one') mmDelete(mm.scan.mods.filter(m => m.file === b.dataset.file));
        else if (act === 'rename') mmRename(b.dataset.file);
        else if (act === 'fetch') mmFetch(b.dataset.name, b.dataset.from);
    });
    view.addEventListener('change', e => {
        const el = e.target;
        if (el.id === 'mm-sort') { mm.sort = el.value; mmRender(); }
        else if (el.id === 'mm-filter') { mm.filter = el.value; mmRender(); }
        else if (el.id === 'mm-save') { mm.saveDir = el.value; mmRender(); }
        else if (el.dataset.pick) {
            if (el.checked) mm.picked.add(el.dataset.pick); else mm.picked.delete(el.dataset.pick);
            mmRender();
        } else if ('mmAll' in el.dataset) {
            mm.picked.clear();
            if (el.checked) mmVisibleMods().forEach(m => mm.picked.add(m.file));
            mmRender();
        }
    });
    view.addEventListener('input', e => {
        if (e.target.id !== 'mm-search') return;
        mm.search = e.target.value;
        const pos = e.target.selectionStart;
        mmRender();
        const input = document.getElementById('mm-search');
        input.focus();
        input.setSelectionRange(pos, pos);
    });

    // Dropping zips from Explorer adds them to the picked library.
    let dragDepth = 0;
    const dropEl = () => view.querySelector('.mm-drop');
    const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    view.addEventListener('dragenter', e => {
        if (!hasFiles(e) || mm.busy) return;
        e.preventDefault();
        dragDepth++;
        const d = dropEl(); if (d) d.hidden = false;
    });
    view.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    view.addEventListener('dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        const d = dropEl(); if (d && !dragDepth) d.hidden = true;
    });
    view.addEventListener('drop', e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth = 0;
        const d = dropEl(); if (d) d.hidden = true;
        const files = [...e.dataTransfer.files].map(f => webUtils.getPathForFile(f)).filter(Boolean);
        mmInstall(files);
    });
})();
