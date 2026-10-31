// Live data from the FS25_FarmerPlannerLink mod (link-mod/). While the game
// runs, the mod writes the game's own fields.xml / farmland.xml (in two
// alternating slots) and live.xml to
//   <FarmingSimulator2025>/modSettings/FS25_FarmerPlannerLink/savegame<N>/
// every ~5 s. Fresh files take the place of the save's fields.xml and
// farmland.xml in readSaveFields, so field work, weeds and the "What to do
// today" list follow the game without waiting for a save. Without the mod, or
// when the game is closed, everything reads the save as before.
// Loaded after renderer.js: renderer.js only calls these at runtime.

const LIVE_LINK_MOD = 'FS25_FarmerPlannerLink';
const LIVE_LINK_FORMAT = 1;
const LIVE_LINK_TICK_MS = 3000;
const LIVE_LINK_FRESH_MS = 30000;      // older live.xml = the game is closed or paused

let liveLinkTimer = null;
let liveLinkFarmId = null;
let liveLinkSeen = null;               // "<mtime>:<counter>" already applied
let liveLinkCache = { key: null, data: null };
let liveLinkEverFresh = false;         // the mod wrote for this farm since it was opened

// modSettings/FS25_FarmerPlannerLink/savegame<N> of the farm's save, or null.
function liveLinkDir(farm) {
    if (!farm || !farm.saveGamePath) return null;
    const saveDir = path.dirname(farm.saveGamePath);
    return path.join(path.dirname(saveDir), 'modSettings', LIVE_LINK_MOD, path.basename(saveDir));
}

// live.xml of the farm, parsed: { mtime, ageMs, fresh, counter, slot,
// fieldsPath, farmlandPath, time, weather, prices, harvestScale, stones,
// productions }, or null when the mod never wrote for this save. Parsed again
// only when the file changes.
function readLiveLink(farm) {
    const dir = liveLinkDir(farm);
    if (!dir) return null;
    const file = path.join(dir, 'live.xml');
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    const key = file + ':' + st.mtimeMs + ':' + st.size;
    if (liveLinkCache.key !== key) liveLinkCache = { key, data: parseLiveLink(dir, file, st.mtimeMs) };
    const data = liveLinkCache.data;
    if (!data) return null;
    const ageMs = Date.now() - data.mtime;
    return Object.assign({}, data, { ageMs, fresh: ageMs >= -5000 && ageMs < LIVE_LINK_FRESH_MS });
}

function parseLiveLink(dir, file, mtime) {
    try {
        const text = fs.readFileSync(file, 'utf-8');
        // The game may be part-way through writing it: wait for the next one.
        if (!text.includes('</farmerPlannerLink>')) return null;
        const doc = new DOMParser().parseFromString(text, 'text/xml');
        if (doc.querySelector('parsererror')) return null;
        const root = doc.documentElement;
        if ((parseInt(root.getAttribute('format'), 10) || 0) !== LIVE_LINK_FORMAT) return null;
        const num = (el, name) => { const v = el ? parseFloat(el.getAttribute(name)) : NaN; return isFinite(v) ? v : null; };
        const slot = root.getAttribute('slot') === 'b' ? 'b' : 'a';

        const time = root.querySelector(':scope > time');
        const weatherEl = root.querySelector(':scope > weather');
        const weather = weatherEl ? {
            temperature: num(weatherEl, 'temperature'),
            isRaining: weatherEl.getAttribute('isRaining') === 'true',
            groundWetness: num(weatherEl, 'groundWetness')
        } : null;

        const prices = {};
        root.querySelectorAll(':scope > prices > fillType').forEach(el => {
            const v = num(el, 'pricePerLiter');
            if (v !== null) prices[String(el.getAttribute('name') || '').toUpperCase()] = v;
        });

        const harvestScale = {};
        root.querySelectorAll(':scope > harvestScale > fruit').forEach(el => {
            const row = {};
            ['full', 'spray0', 'spray05', 'plow0', 'lime0', 'weed0', 'stubble0', 'roller0'].forEach(k => { row[k] = num(el, k); });
            if (row.full) harvestScale[String(el.getAttribute('name') || '').toUpperCase()] = row;
        });

        let stones = null;
        const stonesEl = root.querySelector(':scope > stones');
        if (stonesEl) {
            stones = {};
            stonesEl.querySelectorAll(':scope > field').forEach(el => { stones[el.getAttribute('id')] = num(el, 'share') || 0; });
        }

        const productions = [...root.querySelectorAll(':scope > productions > production')].map(el => ({
            filename: el.getAttribute('filename') || '',
            name: el.getAttribute('name') || '',
            uniqueId: el.getAttribute('uniqueId') || '',
            recipes: [...el.querySelectorAll(':scope > recipe')].map(r => ({
                id: r.getAttribute('id') || '',
                cyclesPerMonth: num(r, 'cyclesPerMonth') || 0,
                enabled: r.getAttribute('enabled') === 'true',
                inputs: [...r.querySelectorAll(':scope > input')].map(i => ({ fillType: String(i.getAttribute('fillType') || '').toUpperCase(), amount: num(i, 'amount') || 0 })),
                outputs: [...r.querySelectorAll(':scope > output')].map(o => ({ fillType: String(o.getAttribute('fillType') || '').toUpperCase(), amount: num(o, 'amount') || 0 }))
            })).filter(r => r.inputs.length || r.outputs.length)
        })).filter(p => p.filename && p.recipes.length);

        return {
            mtime,
            counter: parseInt(root.getAttribute('counter'), 10) || 0,
            farmId: root.getAttribute('farmId') || '',
            modVersion: root.getAttribute('modVersion') || '',
            slot,
            fieldsPath: path.join(dir, `fields_${slot}.xml`),
            farmlandPath: path.join(dir, `farmland_${slot}.xml`),
            time: time ? { dayTime: num(time, 'dayTime'), monotonicDay: num(time, 'monotonicDay'), period: num(time, 'period'), dayInPeriod: num(time, 'dayInPeriod') } : null,
            weather,
            prices,
            harvestScale,
            stones,
            productions
        };
    } catch (e) {
        console.error('readLiveLink failed', e);
        return null;
    }
}

// What readSaveFields reads instead of the save while the game runs:
// { fieldsPath, farmlandPath, stones } when live.xml is fresh and both slot
// files are complete, else null.
function liveLinkSource(farm) {
    if (!autoSyncSetting(farm)) return null;
    const live = readLiveLink(farm);
    if (!live || !live.fresh) return null;
    try {
        const tail = (p, close) => fs.readFileSync(p, 'utf-8').trimEnd().endsWith(close);
        if (!tail(live.fieldsPath, '</fields>') || !tail(live.farmlandPath, '</farmlands>')) return null;
    } catch (e) {
        return null;
    }
    return { fieldsPath: live.fieldsPath, farmlandPath: live.farmlandPath, stones: live.stones };
}

// The game's price per 1000 l when buying a fill type (seeds, fertilizer,
// lime), with the economy difficulty applied — what the mod last reported, or null.
function liveInputPrice(farm, fillType) {
    const v = farm && farm.liveInputPrices ? farm.liveInputPrices[fillType] : null;
    return typeof v === 'number' && v > 0 ? v * 1000 : null;
}

// Fill types the app prices as inputs; the rest of the mod's list is not kept.
const LIVE_LINK_INPUT_FILLTYPES = ['SEEDS', 'FERTILIZER', 'LIQUIDFERTILIZER', 'LIME', 'HERBICIDE', 'MANURE', 'LIQUIDMANURE', 'DIGESTATE', 'DIESEL', 'DEF', 'SILAGE_ADDITIVE', 'MINERAL_FEED', 'ROADSALT'];

function stopLiveLink() {
    if (liveLinkTimer) { clearInterval(liveLinkTimer); liveLinkTimer = null; }
    liveLinkFarmId = null;
    liveLinkSeen = null;
    liveLinkEverFresh = false;
    renderLiveLinkBadge(null);
}

function startLiveLink(farmId) {
    stopLiveLink();
    const farm = getAllFarms().find(f => f.id === farmId);
    if (!farm || !farm.saveGamePath || !autoSyncSetting(farm)) return;
    liveLinkFarmId = farmId;
    liveLinkTimer = setInterval(runLiveLinkTick, LIVE_LINK_TICK_MS);
    runLiveLinkTick();
}

function runLiveLinkTick() {
    if (liveLinkFarmId == null || currentFarmId !== liveLinkFarmId) { stopLiveLink(); return; }
    const farm = getAllFarms().find(f => f.id === liveLinkFarmId);
    if (!farm) { stopLiveLink(); return; }
    const live = readLiveLink(farm);
    if (live && live.fresh) liveLinkEverFresh = true;
    renderLiveLinkBadge(live);
    if (!live || !live.fresh) return;
    const seen = live.mtime + ':' + live.counter;
    if (seen === liveLinkSeen) return;
    // Same as auto-sync: never under an open edit; try again on the next tick.
    if (isEditMode) return;
    liveLinkSeen = seen;
    applyLiveLinkToFarm(farm, live);
}

// Takes what the mod wrote into the farm. Durable values (yield factors,
// input prices, production recipes) are stored with the farm, so they keep
// working when the game is closed; field work comes through readSaveFields.
function applyLiveLinkToFarm(farm, live) {
    let changed = false;
    let refreshSave = false;
    const keep = (key, value) => {
        if (value === null || value === undefined) return false;
        if (JSON.stringify(farm[key]) === JSON.stringify(value)) return false;
        farm[key] = value;
        changed = true;
        return true;
    };
    if (Object.keys(live.harvestScale).length) keep('harvestScale', live.harvestScale);
    const inputs = {};
    LIVE_LINK_INPUT_FILLTYPES.forEach(ft => { if (live.prices[ft]) inputs[ft] = Math.round(live.prices[ft] * 10000) / 10000; });
    if (Object.keys(inputs).length) keep('liveInputPrices', inputs);
    if (live.stones) keep('stonesEnabled', true);
    if (live.productions.length) {
        const book = Object.assign({}, farm.productionRecipes || {});
        live.productions.forEach(p => {
            book[p.filename] = { name: p.name, recipes: p.recipes.map(r => ({ id: r.id, cyclesPerMonth: r.cyclesPerMonth, inputs: r.inputs, outputs: r.outputs })) };
        });
        // New recipes show up in the productions read from placeables.xml.
        if (keep('productionRecipes', book)) refreshSave = true;
    }

    const workChanged = syncWorkFromSave(farm);
    const weedsChanged = syncWeedsFromSave(farm);
    if (workChanged || weedsChanged) changed = true;

    if (refreshSave) applyGameSaveToFarm(farm);
    if (!changed) return;
    saveFarmData(farm, { touch: false });
    renderSeasonView();
    if (workChanged || weedsChanged) showAutoSyncToast(t('liveSyncedToast'));
}

// Header badge: "Live" while the mod writes, "From the save" once it stopped.
// Hidden for farms that never got live data in this session.
function renderLiveLinkBadge(live) {
    const el = document.getElementById('live-link-badge');
    if (!el) return;
    if (!live || (!live.fresh && !liveLinkEverFresh)) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('is-live', !!live.fresh);
    el.innerHTML = live.fresh
        ? `<span class="live-link-dot" aria-hidden="true"></span>${escapeHtml(t('liveBadgeLive'))}`
        : `<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> ${escapeHtml(t('liveBadgeSave'))}`;
    el.title = live.fresh ? t('liveBadgeLiveHint') : t('liveBadgeSaveHint');
}

// The mod zip shipped with the app (resources/), or built from link-mod/ when
// started with `npm start`. null if neither works.
function liveLinkModZip() {
    const shipped = path.join(process.resourcesPath || '', LIVE_LINK_MOD + '.zip');
    if (process.resourcesPath && fs.existsSync(shipped)) return shipped;
    try {
        return require(path.join(__dirname, '..', '..', 'tools', 'build-link-mod.js')).buildLinkMod();
    } catch (e) {
        console.error('build-link-mod failed', e);
        return null;
    }
}

// <version> of a modDesc.xml text.
function liveLinkDescVersion(bytes) {
    const m = bytes ? bytes.toString('utf8').match(/<version>([^<]+)<\/version>/) : null;
    return m ? m[1].trim() : '';
}

function liveLinkCompareVersions(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
}

// { state: 'live' | 'idle' | 'inactive' | 'old' | 'missing' | 'nosave',
//   installed, bundled, modsDir, zip, live }
function liveLinkStatus(farm) {
    if (!farm || !farm.saveGamePath) return { state: 'nosave' };
    const dirs = modFiles.findModsDirs(farm.saveGamePath);
    const installed = liveLinkDescVersion(modFiles.readModFile(dirs, `$moddir$${LIVE_LINK_MOD}/modDesc.xml`));
    const zip = liveLinkModZip();
    let bundled = '';
    try {
        const entries = zip ? modFiles.readZipDirectory(zip) : null;
        const entry = entries && entries.get('moddesc.xml');
        bundled = entry ? liveLinkDescVersion(modFiles.readZipEntry(zip, entry)) : '';
    } catch (e) { /* the version check is optional */ }
    const live = readLiveLink(farm);
    let state;
    if (live && live.fresh) state = 'live';
    else if (!installed) state = 'missing';
    else if (bundled && liveLinkCompareVersions(installed, bundled) < 0) state = 'old';
    else if (!activeModsInSave(farm.saveGamePath).has(LIVE_LINK_MOD)) state = 'inactive';
    else state = 'idle';
    return { state, installed, bundled, modsDir: dirs[0] || null, zip, live };
}

// Farm settings → Savegame: what the mod is doing and how to install it.
function renderLiveLinkSettings(farm) {
    const box = document.getElementById('live-link-info');
    if (!box) return;
    const s = liveLinkStatus(farm);
    if (s.state === 'nosave') { box.hidden = true; return; }
    box.hidden = false;
    const icon = { live: 'fa-circle-check', idle: 'fa-circle-pause', inactive: 'fa-circle-exclamation', old: 'fa-circle-up', missing: 'fa-circle-info' }[s.state];
    let detail = t('liveState_' + s.state).replace('{version}', s.installed || '').replace('{bundled}', s.bundled || '');
    if (s.state === 'idle' && s.live) detail += ' ' + t('liveLastData').replace('{time}', new Date(s.live.mtime).toLocaleString(currentLang));
    box.innerHTML = `
        <span>${escapeHtml(t('liveSettingsTitle'))}</span>
        <p class="live-link-state is-${s.state}"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${escapeHtml(detail)}</p>
        <small class="settings-hint">${escapeHtml(t('liveSettingsHint'))}</small>
        <div class="live-link-actions">
            ${s.zip ? `<button type="button" class="settings-btn" data-live-act="zip"><i class="fa-solid fa-file-zipper" aria-hidden="true"></i> ${escapeHtml(t('liveShowModFile'))}</button>` : ''}
            ${s.modsDir ? `<button type="button" class="settings-btn" data-live-act="mods"><i class="fa-solid fa-folder-open" aria-hidden="true"></i> ${escapeHtml(t('liveOpenModsFolder'))}</button>` : ''}
            <button type="button" class="settings-btn" data-live-act="refresh"><i class="fa-solid fa-rotate" aria-hidden="true"></i> ${escapeHtml(t('liveCheckAgain'))}</button>
        </div>`;
    box.onclick = (e) => {
        const btn = e.target.closest('[data-live-act]');
        if (!btn) return;
        const act = btn.dataset.liveAct;
        const { shell } = require('electron');
        if (act === 'zip' && s.zip) shell.showItemInFolder(s.zip);
        else if (act === 'mods' && s.modsDir) shell.openPath(s.modsDir);
        else if (act === 'refresh') renderLiveLinkSettings(getAllFarms().find(f => f.id === farm.id) || farm);
    };
}
