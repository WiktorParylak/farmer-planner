// =============================================================
// SECTION 1: IMPORTS AND CONFIGURATION
// =============================================================
const fs = require('fs');
const path = require('path');
const { webUtils, ipcRenderer } = require('electron');
const { readFieldSoilFromSave, readFarmlandAreas } = require('./savegame-soil');
const animalImages = require('./animal-images');
const modFiles = require('./mod-files');
const { readMapCrops, readModL10n, readPfSeedRates, readMapAnimalFood } = require('./map-crops');
const { readAnimalMods, easFoodFactor, easMilkFactor } = require('./animal-mods');
const { readMoistureSystem, moistureYieldFactor } = require('./moisture-mod');
const { DEV_FARM_ID, buildDevFarm } = require('./dev-farm');
const { TRANSLATIONS, MONTH_TRANSLATIONS, CROP_NAME_TRANSLATIONS, ANIMAL_SPECIES_TRANSLATIONS, PRODUCTION_FILLTYPE_TRANSLATIONS } = require('./translations');
const diagnostics = require('./diagnostics');

// Running from the repo (npm start) rather than from the installed app.
const IS_DEV_BUILD = !__dirname.includes('app.asar');
const { pathToFileURL } = require('url');

// Bundled game data (default crops/animals, nitrogen by soil) lives in /data.
// __dirname here is the folder of index.html (src/renderer).
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// Resolved by the main process — Documents\Farmer Planner, with a one-time
// migration from the old %APPDATA%\FarmerPlanner location handled there. Falls
// back to the legacy path if the IPC ever fails so the app still starts.
const appDataDir = ipcRenderer.sendSync('get-data-dir') || path.join(
    process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share"),
    'FarmerPlanner'
);

if (!fs.existsSync(appDataDir)) {
    try { fs.mkdirSync(appDataDir, { recursive: true }); }
    catch (err) { console.error("Could not create the data folder", err); }
}

// App settings (settings.json in the data folder, see settings.js).
const appSettings = require('./settings').createSettings(appDataDir, localStorage);
function getSetting(key) { return appSettings.get(key); }
function setSetting(key, value) { appSettings.set(key, value); }

// =============================================================
// SECTION 1A: LANGUAGE / TRANSLATIONS
// =============================================================
const CONFIG_KEY_LANG = 'farmer_planner_language';
const CONFIG_KEY_AUTO_SYNC = 'farmer_planner_auto_sync';
const CONFIG_KEY_DISCORD_RPC = 'farmer_planner_discord_rpc';
const CONFIG_KEY_TUTORIAL_DONE = 'farmer_planner_tutorial_done';

// Languages the app is translated into (TRANSLATIONS keys); anything else -> en.
const APP_LANGUAGES = ['en', 'pl', 'de'];
let currentLang = APP_LANGUAGES.includes(getSetting(CONFIG_KEY_LANG)) ? getSetting(CONFIG_KEY_LANG) : 'en';

function translateMonth(monthEn) {
    if (!monthEn) return monthEn;
    const key = monthEn.toUpperCase();
    const dict = MONTH_TRANSLATIONS[currentLang];
    return (dict && dict[key]) ? dict[key] : monthEn;
}

// Crop names come from formatCropName(), which title-cases whatever spacing
// a mod/map's fruitType attribute happens to use ("SILAGE_MAIZE" ->
// "Silage Maize", but another file's "silageMaize" -> "Silagemaize") — so an
// exact-string dictionary lookup misses names that only differ by spacing.
// Normalizing away spaces/case before comparing (both here and once, up
// front, for the dictionary itself) makes the match spacing/casing-tolerant
// without having to hand-list every spacing variant of every crop name.
function normalizeCropNameKey(name) {
    return name.toLowerCase().replace(/[\s_-]+/g, '');
}

const CROP_NAME_TRANSLATIONS_NORMALIZED = {};
Object.keys(CROP_NAME_TRANSLATIONS).forEach(lang => {
    const normalized = {};
    Object.keys(CROP_NAME_TRANSLATIONS[lang]).forEach(name => {
        normalized[normalizeCropNameKey(name)] = CROP_NAME_TRANSLATIONS[lang][name];
    });
    CROP_NAME_TRANSLATIONS_NORMALIZED[lang] = normalized;
});

// Crop titles from the open farm's map mod translations ({ CROPKEY: { en, pl } },
// filled in loadFarmConfigs) — maps name crops in their own language
// ("Centeno"), their l10n says what it is ("Rye").
let MAP_CROP_TITLES = {};

// Crop names end up in HTML all over the app and can come from a farm file
// (an imported backup, crops_config.json), so markup characters are dropped.
function translateCropName(name) {
    if (!name) return name;
    return String(translateCropNameRaw(name)).replace(/[<>"'`]/g, '');
}

function translateCropNameRaw(name) {
    const mapTitles = MAP_CROP_TITLES[String(name).replace(/[_\s]+/g, '').toUpperCase()];
    if (mapTitles && mapTitles[currentLang]) return mapTitles[currentLang];
    // No title in this language: use the map's English one through our dictionary.
    const base = (mapTitles && mapTitles.en) || name;
    if (currentLang === 'en') return base;
    const dict = CROP_NAME_TRANSLATIONS_NORMALIZED[currentLang];
    const translated = dict && (dict[normalizeCropNameKey(base)] || dict[normalizeCropNameKey(name)]);
    return translated || base;
}

function formatAnimalName(subType) {
    if (!subType) return subType;
    const parts = subType.split('_').filter(Boolean);
    const speciesKey = parts[0];
    const dict = ANIMAL_SPECIES_TRANSLATIONS[currentLang];
    const speciesWord = (dict && dict[speciesKey])
        ? dict[speciesKey]
        : (speciesKey.charAt(0) + speciesKey.slice(1).toLowerCase());
    const rest = parts.slice(1).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    return rest ? `${speciesWord} ${rest}` : speciesWord;
}

// Building names only exist in the save as a mod file path (e.g.
// ".../SFarm_chickenBarn.xml") — this is a best-effort cosmetic cleanup,
// not a reliable translation, since every map names these differently.
function formatBuildingName(filename) {
    if (!filename) return t('hubAnimals');
    let base = filename.split(/[\\/]/).pop().replace(/\.xml$/i, '');
    base = base.replace(/^[A-Za-z0-9]+_/, '');
    base = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    base = base.replace(/_/g, ' ');
    base = base.replace(/(barn|coop|stable|shed|house|pasture|pen)/i, ' $1');
    base = base.replace(/\s+/g, ' ').trim();
    return base ? base.replace(/\b\w/g, c => c.toUpperCase()) : t('hubAnimals');
}

function formatFillType(fillType) {
    if (!fillType) return fillType;
    const dict = PRODUCTION_FILLTYPE_TRANSLATIONS[currentLang];
    if (dict && dict[fillType]) return dict[fillType];
    return fillType.charAt(0) + fillType.slice(1).toLowerCase();
}

function t(key) {
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    if (dict[key] !== undefined) return dict[key];
    return TRANSLATIONS.en[key] !== undefined ? TRANSLATIONS.en[key] : key;
}

function applyLanguage(lang) {
    currentLang = APP_LANGUAGES.includes(lang) ? lang : 'en';
    setSetting(CONFIG_KEY_LANG, currentLang);
    document.documentElement.setAttribute('lang', currentLang);

    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });

    const farmListEl = document.querySelector('.farm-list');
    if (farmListEl) farmListEl.setAttribute('data-empty-text', t('noFarmsYet'));

    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('is-selected', btn.getAttribute('data-lang') === currentLang);
    });

    // Re-render whatever's currently on screen so dynamically generated
    // strings (badges, statuses, hints) pick up the new language too.
    renderFarmList(getAllFarms());
    if (typeof currentFarmId !== 'undefined' && currentFarmId && plannerView && plannerView.style.display !== 'none') {
        renderSeasonView();
    }
    updateDiscordPresence();
}

// =============================================================
// SECTION 1C: DISCORD RICH PRESENCE
// =============================================================
// Purely cosmetic: tells Discord what the user is up to
// (e.g. "Managing 12 fields" / "Farm: Solek"). The heavy lifting — talking to
// the Discord client — lives in the main process (discord-presence.js); here we
// just describe the current app state and push it over IPC.
const DISCORD_SESSION_START = Date.now();
let _lastDiscordPayload = null;

function isDiscordRpcEnabled() {
    // Opt-in: off until the user says yes (asked once at start, see askDiscordOnce).
    return getSetting(CONFIG_KEY_DISCORD_RPC) === '1';
}

// Asks once whether to show the farm on Discord — the profile status is
// public, so it is never switched on without a yes.
async function askDiscordOnce() {
    if (getSetting(CONFIG_KEY_DISCORD_RPC) !== null) return;
    const yes = await showConfirm({
        title: t('discordAskTitle'),
        body: t('discordAskText'),
        confirmText: t('discordAskYes'),
        icon: 'fa-display'
    });
    setSetting(CONFIG_KEY_DISCORD_RPC, yes === true ? '1' : '0');
    const toggle = document.getElementById('discord-rpc-toggle');
    if (toggle) toggle.checked = yes === true;
    updateDiscordPresence();
}

// Polish needs three plural forms (1 / 2-4 / 5+); English and German just two.
function discordPlural(n, oneKey, fewKey, manyKey) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (n === 1) return t(oneKey);
    if (currentLang === 'pl') {
        if (last >= 2 && last <= 4 && (abs < 10 || abs >= 20)) return t(fewKey);
        return t(manyKey);
    }
    return t(manyKey);
}

// Plain placeholder swap — a function replacer so a farm name containing "$"
// isn't treated as a regex substitution pattern.
function fillTemplate(str, vars) {
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function updateDiscordPresence() {
    if (typeof ipcRenderer === 'undefined') return;

    if (!isDiscordRpcEnabled()) {
        if (_lastDiscordPayload !== null) {
            _lastDiscordPayload = null;
            ipcRenderer.send('discord-presence:clear');
        }
        return;
    }

    const inPlanner = plannerView && plannerView.style.display !== 'none' && currentFarmId;
    let details;
    let state;

    if (inPlanner) {
        const farm = getAllFarms().find(f => f.id === currentFarmId);
        const fieldCount = farm && Array.isArray(farm.fields) ? farm.fields.length : 0;
        details = fillTemplate(t('discordManagingFields'), {
            n: fieldCount,
            fields: discordPlural(fieldCount, 'discordFieldOne', 'discordFieldFew', 'discordFieldMany'),
        });
        state = fillTemplate(t('discordOnFarm'), { name: farm ? farm.name : '' });
    } else {
        const farmCount = getAllFarms().length;
        details = t('discordBrowsing');
        state = fillTemplate(t('discordFarmCount'), {
            n: farmCount,
            farms: discordPlural(farmCount, 'discordFarmOne', 'discordFarmFew', 'discordFarmMany'),
        });
    }

    const payload = {
        details,
        state,
        startTimestamp: DISCORD_SESSION_START,
        largeImageKey: 'logo',
        largeImageText: 'Farmer Planner',
    };

    const sig = JSON.stringify(payload);
    if (sig === _lastDiscordPayload) return; // nothing changed — don't spam the pipe
    _lastDiscordPayload = sig;
    ipcRenderer.send('discord-presence:set', payload);
}

// =============================================================
// SECTION 1B: CUSTOM TITLEBAR (frameless window controls)
// =============================================================
const titlebarMinBtn = document.getElementById('titlebar-min');
const titlebarMaxBtn = document.getElementById('titlebar-max');
const titlebarCloseBtn = document.getElementById('titlebar-close');

if (titlebarMinBtn) titlebarMinBtn.addEventListener('click', () => ipcRenderer.send('window-minimize'));
if (titlebarMaxBtn) titlebarMaxBtn.addEventListener('click', () => ipcRenderer.send('window-maximize-toggle'));
if (titlebarCloseBtn) titlebarCloseBtn.addEventListener('click', () => ipcRenderer.send('window-close'));

// Double-clicking the drag area should also toggle maximize, like a normal titlebar.
const titlebarDragArea = document.querySelector('.titlebar-drag');
if (titlebarDragArea) titlebarDragArea.addEventListener('dblclick', () => ipcRenderer.send('window-maximize-toggle'));

ipcRenderer.on('window-maximized-change', (event, isMaximized) => {
    if (!titlebarMaxBtn) return;
    titlebarMaxBtn.innerHTML = isMaximized ? '<i class="fa-solid fa-window-restore" aria-hidden="true"></i>' : '<i class="fa-solid fa-window-maximize" aria-hidden="true"></i>';
    titlebarMaxBtn.dataset.i18nTitle = isMaximized ? 'titlebarRestore' : 'titlebarMaximize';
    titlebarMaxBtn.title = t(titlebarMaxBtn.dataset.i18nTitle);
});

// =============================================================
// SECTION 2: UI DOM ELEMENTS
// =============================================================
const dashboardView = document.getElementById('dashboard-view');
const plannerView = document.getElementById('planner-view');

const addFarmModal = document.getElementById('farm-modal');
const addFarmBtn = document.querySelector('.add-farm-btn');
const importBackupBtn = document.getElementById('import-backup-btn');
const confirmAddBtn = document.getElementById('confirm-btn');
const cancelAddBtn = document.getElementById('cancel-btn');
const newFarmInput = document.getElementById('new-farm-name');
const newFarmMapInput = document.getElementById('new-farm-map');

const resetSeasonsBtn = document.getElementById('reset-seasons-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');

// --- App-level settings (language, for now) ---
const appSettingsBtn = document.getElementById('app-settings-btn');
const appSettingsModal = document.getElementById('app-settings-modal');
const closeAppSettingsBtn = document.getElementById('close-app-settings-btn');
const langButtons = document.querySelectorAll('.lang-btn');
const discordRpcToggle = document.getElementById('discord-rpc-toggle');

if (appSettingsBtn && appSettingsModal) {
    appSettingsBtn.addEventListener('click', () => {
        if (discordRpcToggle) discordRpcToggle.checked = isDiscordRpcEnabled();
        const updToggle = document.getElementById('update-check-toggle');
        if (updToggle) updToggle.checked = isUpdateCheckEnabled();
        const versionLabel = document.getElementById('app-version-label');
        if (versionLabel) versionLabel.textContent = t('updateCurrentVersion').replace('{v}', APP_VERSION);
        const devSetting = document.getElementById('dev-farm-setting');
        if (devSetting) devSetting.hidden = !IS_DEV_BUILD;
        const devToggle = document.getElementById('dev-farm-toggle');
        if (devToggle) devToggle.checked = devFarmExists();
        openModal(appSettingsModal);
    });
}
if (closeAppSettingsBtn && appSettingsModal) {
    closeAppSettingsBtn.addEventListener('click', () => closeModal(appSettingsModal));
}
langButtons.forEach(btn => {
    btn.addEventListener('click', () => applyLanguage(btn.getAttribute('data-lang')));
});
const replayTutorialBtn = document.getElementById('replay-tutorial-btn');
if (replayTutorialBtn) {
    replayTutorialBtn.addEventListener('click', () => {
        if (appSettingsModal) appSettingsModal.style.display = 'none';
        startTutorial();
    });
}
if (discordRpcToggle) {
    discordRpcToggle.addEventListener('change', () => {
        setSetting(CONFIG_KEY_DISCORD_RPC, discordRpcToggle.checked ? '1' : '0');
        updateDiscordPresence();
    });
}

// --- Developer test farm (only offered when running from the repo) ---
function devFarmDir() {
    return path.join(appDataDir, DEV_FARM_ID);
}

function devFarmExists() {
    return fs.existsSync(path.join(devFarmDir(), 'data.json'));
}

function createDevFarm() {
    const { farm, seasons, monthly, notes } = buildDevFarm({ pl: currentLang === 'pl' });
    const dir = devFarmDir();
    try {
        fs.mkdirSync(path.join(dir, 'seasons'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
        seasons.forEach(s => fs.writeFileSync(path.join(dir, 'seasons', `season_${s.season}.json`), JSON.stringify(s, null, 2), 'utf-8'));
    } catch (err) {
        console.error('Could not create the dev farm', err);
        return;
    }
    saveFarmData(farm, { touch: false });
    saveMonthlyHistory(farm, monthly);
    saveNotes(farm, notes);
}

function removeDevFarm() {
    try { fs.rmSync(devFarmDir(), { recursive: true, force: true }); }
    catch (err) { console.error('Could not remove the dev farm', err); }
}

const devFarmToggle = document.getElementById('dev-farm-toggle');
if (devFarmToggle) {
    devFarmToggle.addEventListener('change', () => {
        if (devFarmToggle.checked) createDevFarm();
        else removeDevFarm();
        renderFarmList(getAllFarms());
    });
}
const devFarmRebuildBtn = document.getElementById('dev-farm-rebuild-btn');
if (devFarmRebuildBtn) {
    devFarmRebuildBtn.addEventListener('click', () => {
        removeDevFarm();
        createDevFarm();
        if (devFarmToggle) devFarmToggle.checked = true;
        renderFarmList(getAllFarms());
    });
}

// --- Planner sidebar: switches between the field plan and the tool views
// (Finance / Animals / Supplies / ...), which render into #hub-view in place
// of the planner content. #hub-panel-modal is only the per-field fert plan.
const plannerContentEl = document.querySelector('#planner-view .planner-content');
const hubView = document.getElementById('hub-view');
const hubPanelModal = document.getElementById('hub-panel-modal');
const closeHubPanelBtn = document.getElementById('close-hub-panel-btn');
let currentPlannerView = 'plan';

function setActiveSidebarItem(view) {
    currentPlannerView = view;
    document.querySelectorAll('#planner-sidebar .sidebar-item[data-view]').forEach(el => {
        el.classList.toggle('is-active', el.dataset.view === view);
    });
}

// Dialogs: style.display stays the open / closed state the rest of the app
// checks. openModal shows one (its fade-in is CSS: .modal's animation);
// closeModal plays the fade-out and hides it when that ends (at once with
// reduced motion), then runs `after`.
function openModal(el) {
    if (!el) return;
    if (el._closeTimer) { clearTimeout(el._closeTimer); el._closeTimer = null; }
    el.classList.remove('is-closing');
    el.style.display = 'flex';
}

function closeModal(el, after) {
    if (!el) return;
    if (el.style.display === 'none' || el.classList.contains('is-closing')) {
        if (after && el.style.display === 'none') after();
        return;
    }
    const finish = () => {
        if (el._closeTimer) { clearTimeout(el._closeTimer); el._closeTimer = null; }
        if (!el.classList.contains('is-closing')) return;   // reopened meanwhile
        el.classList.remove('is-closing');
        el.style.display = 'none';
        if (after) after();
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.style.display = 'none';
        if (after) after();
        return;
    }
    el.classList.add('is-closing');
    el.addEventListener('animationend', function onEnd(e) {
        if (e.target !== el) return;
        el.removeEventListener('animationend', onEnd);
        finish();
    });
    el._closeTimer = setTimeout(finish, 400);   // in case animationend never comes
}

// Replays the view-in motion on a view that just came up.
function playViewEnter(el) {
    if (!el) return;
    el.classList.remove('view-enter');
    void el.offsetWidth;
    el.classList.add('view-enter');
}

window.showPlannerView = function (view) {
    if (!view || view === 'plan') {
        if (currentPlannerView !== 'plan') playViewEnter(plannerContentEl);
        setActiveSidebarItem('plan');
        if (hubView) hubView.hidden = true;
        if (plannerContentEl) plannerContentEl.style.display = '';
        // Hub panels can change what the table shows (soil import, feed use…)
        // — redraw it, unless the edit table is open.
        if (currentFarmId != null && !isEditMode) renderSeasonView();
        return;
    }
    if (view === 'animals') animalSelectedBuilding = null;   // sidebar always opens the barn overview
    const changed = view !== currentPlannerView;
    openHubPanel(view);
    if (hubView) hubView.scrollTop = 0;
    if (changed) playViewEnter(hubView);
};

document.querySelectorAll('#planner-sidebar .sidebar-item[data-view]').forEach(el => {
    el.addEventListener('click', () => showPlannerView(el.dataset.view));
});

// Back, like in a browser: Alt+← or the mouse's back button. Closes the open
// window (as Escape does), else goes up one level: a barn -> the barn
// overview, any other panel -> the plan.
function navigateBack() {
    if (tut.active) return;
    const openModal = [...document.querySelectorAll('.modal')].some(m => getComputedStyle(m).display !== 'none');
    if (openModal) {
        (document.activeElement || document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        return;
    }
    const planner = document.getElementById('planner-view');
    if (!planner || getComputedStyle(planner).display === 'none') return;
    if (currentPlannerView === 'animals' && animalSelectedBuilding) showPlannerView('animals');
    else if (currentPlannerView !== 'plan') showPlannerView('plan');
}
document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navigateBack(); }
});
document.addEventListener('mouseup', e => {
    if (e.button === 3) { e.preventDefault(); navigateBack(); }
});

if (closeHubPanelBtn && hubPanelModal) {
    closeHubPanelBtn.addEventListener('click', () => {
        closeModal(hubPanelModal);
        // Supplies lists "fill in the plan" per field — refresh it after editing one.
        if (currentPlannerView === 'supplies') openHubPanel('supplies');
    });
}

// Every archived season of the farm (seasons/season_N.json) as
// { season, data }, oldest first. An unreadable archive is skipped rather than
// failing the whole panel.
function readSeasonArchives(farm) {
    const out = [];
    if (!farm || !farm.folderName) return out;
    const seasonsDir = path.join(appDataDir, farm.folderName, 'seasons');
    if (!fs.existsSync(seasonsDir)) return out;
    fs.readdirSync(seasonsDir).forEach(fileName => {
        const match = fileName.match(/^season_(\d+)\.json$/);
        if (!match) return;
        try {
            out.push({ season: parseInt(match[1]), data: JSON.parse(fs.readFileSync(path.join(seasonsDir, fileName), 'utf-8')) });
        } catch (err) { /* skip */ }
    });
    return out.sort((x, y) => x.season - y.season);
}

// Balance/loan per archived season (archives made before this feature don't
// have them and are skipped) plus the live current season, giving a
// season-by-season trend rather than one static number.
function getSeasonBalanceHistory(farm) {
    if (!farm || !farm.folderName) return [];
    const history = readSeasonArchives(farm)
        .filter(a => a.data.balance !== undefined)
        .map(a => ({ season: a.season, balance: parseMoney(a.data.balance), loan: parseMoney(a.data.loan) }));
    history.push({ season: farm.currentSeason || 1, balance: parseMoney(farm.balance), loan: parseMoney(farm.loan) });
    history.sort((x, y) => x.season - y.season);
    return history;
}

// Same for the herd: head count and average health per archived season
// (when the archive has them) plus the live current season.
function getAnimalHistoryTrend(farm) {
    if (!farm || !farm.folderName) return [];
    const history = readSeasonArchives(farm)
        .filter(a => a.data.animals !== undefined)
        .map(a => ({ season: a.season, animals: a.data.animals || 0, avgHealth: a.data.avgHealth ?? null }));
    history.push({
        season: farm.currentSeason || 1,
        animals: farm.animals || 0,
        avgHealth: avgHealthFromBuildings(farm.animalBuildings)
    });
    history.sort((x, y) => x.season - y.season);
    return history;
}

// =============================================================
// SECTION 4A: MONTHLY HISTORY LOG
// =============================================================
// One row per in-game month (the game's own period counter — see readGameSave),
// so finance / herd / production curves plot month-by-month instead of a single
// dot per manual "season". Appended by applyGameSaveToFarm whenever the live
// savegame is read (planner open + the real-time auto-sync loop).

function monthlyHistoryPath(farm) {
    if (!farm || !farm.folderName) return null;
    return path.join(appDataDir, farm.folderName, 'monthly.json');
}

function loadMonthlyHistory(farm) {
    const p = monthlyHistoryPath(farm);
    if (!p || !fs.existsSync(p)) return [];
    try {
        const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return Array.isArray(arr) ? arr : [];
    } catch (err) {
        return []; // corrupt log — start fresh rather than break every chart
    }
}

function saveMonthlyHistory(farm, rows) {
    const p = monthlyHistoryPath(farm);
    if (!p) return;
    try { fs.writeFileSync(p, JSON.stringify(rows, null, 2), 'utf-8'); }
    catch (err) { console.error('Could not write monthly history:', err); }
}

// Average health of the animals in these barns, weighted by head count
// (null without animals). The one place this is computed.
function avgHealthFromBuildings(buildings) {
    let weightedSum = 0, count = 0;
    (buildings || []).forEach(b => (b.clusters || []).forEach(c => {
        weightedSum += (c.health || 0) * c.numAnimals;
        count += c.numAnimals;
    }));
    return count > 0 ? weightedSum / count : null;
}

// The comparable slice of a row — used to decide whether an in-place update of
// the current month's row is worth a disk write.
function monthlyRowFingerprint(row) {
    return JSON.stringify({
        b: Math.round(row.balance || 0),
        l: Math.round(row.loan || 0),
        e: row.equipment ?? null,
        a: row.animals ?? null,
        h: row.avgHealth == null ? null : Math.round(row.avgHealth),
        p: row.production || {}
    });
}

// Builds the row for the current in-game month from freshly-read save data
// (gameData) merged onto `farm`.
function buildMonthlyRow(farm, gameData) {
    return {
        // monthlyPeriodOffset: set when a new career continues an existing
        // history (see recordMonthlySnapshot), so its months follow on.
        period: gameData.gamePeriod + (parseInt(farm.monthlyPeriodOffset, 10) || 0),
        month: FS_PERIOD_TO_MONTH[gameData.gamePeriod % 12],
        gameYear: gameData.gameYear,
        gameDay: gameData.gameDay,
        appSeason: farm.currentSeason || 1,
        recordedAt: new Date().toISOString(),
        balance: parseMoney(farm.balance),
        loan: parseMoney(farm.loan),
        equipment: (farm.equipment ?? null),
        animals: (farm.animals ?? 0),
        avgHealth: avgHealthFromBuildings(gameData.animalBuildings || farm.animalBuildings),
        // fillType -> litres currently in storage/tank (a stock level, not
        // throughput — the delta between months is charted as an output proxy).
        production: gameData.animalProduction || farm.animalProduction || {},
        // fillType -> litres made this month, estimated from the herd's
        // production curves (null when the curves aren't loaded).
        productionEst: estimateMonthlyOutput(farm, gameData.animalBuildings || farm.animalBuildings)
    };
}

// A jump back of at least this many in-game months (or a different savegame
// file) means a new career rather than an older save of the same one.
const NEW_CAREER_PERIOD_DROP = 12;
let monthlyHistoryPrompting = false;

// Append a new month, or refresh the current month's row in place as values
// move during that month. Never rewrites older rows. A save that jumped
// backwards a little (older save loaded) is ignored; a new career asks whether
// to continue the history or start a new one.
function recordMonthlySnapshot(farm, gameData) {
    if (!farm || !farm.folderName) return;
    if (!gameData || gameData.gamePeriod === null || gameData.gamePeriod === undefined) return;

    const rows = loadMonthlyHistory(farm);
    const last = rows[rows.length - 1];
    const row = buildMonthlyRow(farm, gameData);

    if (last && row.period < last.period) {
        const otherSave = !!farm.monthlySavePath && farm.monthlySavePath !== farm.saveGamePath;
        if (otherSave || last.period - row.period >= NEW_CAREER_PERIOD_DROP) askAboutMonthlyHistory(farm, gameData, last);
        return;   // older save of the same career: leave history untouched
    }
    if (farm.monthlySavePath !== farm.saveGamePath) {
        farm.monthlySavePath = farm.saveGamePath;
        saveFarmData(farm, { touch: false });
    }

    if (!last || row.period > last.period) {
        rows.push(row);
        saveMonthlyHistory(farm, rows);
    } else if (row.period === last.period) {
        if (monthlyRowFingerprint(row) !== monthlyRowFingerprint(last)) {
            // keep the original recordedAt so it still marks when the month began
            row.recordedAt = last.recordedAt;
            row.updatedAt = new Date().toISOString();
            rows[rows.length - 1] = row;
            saveMonthlyHistory(farm, rows);
        }
    }
}

// New career (or another savegame) behind a farm with a monthly history:
// either its months continue the charts, or the old history is set aside
// (monthly_<date>.json next to it) and the charts start over.
async function askAboutMonthlyHistory(farm, gameData, last) {
    if (monthlyHistoryPrompting) return;
    monthlyHistoryPrompting = true;
    try {
        const startNew = await showDialog({
            title: t('historyNewCareerTitle'),
            body: t('historyNewCareerBody'),
            confirmText: t('historyStartNew'),
            cancelText: t('historyContinue'),
            icon: 'fa-chart-line'
        });
        const fresh = getAllFarms().find(f => f.id === farm.id);
        if (!fresh) return;
        if (startNew) {
            const p = monthlyHistoryPath(fresh);
            const stamp = new Date().toISOString().slice(0, 10);
            try { if (p && fs.existsSync(p)) fs.renameSync(p, p.replace(/\.json$/, `_until_${stamp}.json`)); }
            catch (err) { console.error('Could not set the monthly history aside:', err); }
            fresh.monthlyPeriodOffset = 0;
        } else {
            // The new career's current month becomes the month after the last one logged.
            fresh.monthlyPeriodOffset = last.period + 1 - gameData.gamePeriod;
        }
        fresh.monthlySavePath = fresh.saveGamePath;
        saveFarmData(fresh, { touch: false });
        recordMonthlySnapshot(fresh, gameData);
        if (currentFarmId === fresh.id && currentPlannerView && currentPlannerView !== 'plan') openHubPanel(currentPlannerView);
    } finally {
        monthlyHistoryPrompting = false;
    }
}

// Short, localized month label for a monthly row ("Aug", "Sty", ...).
function monthlyRowLabel(row) {
    const full = translateMonth(row.month || FS_PERIOD_TO_MONTH[(row.period || 0) % 12]);
    return full.slice(0, 3);
}

// Returns the monthly rows plus a derived `milkOut`/per-fillType delta series:
// the month-over-month increase in stored litres, a rough proxy for how much
// was produced that month (drops to 0 rather than negative when the player
// sold/emptied storage).
function getMonthlyHistory(farm) {
    const rows = loadMonthlyHistory(farm);
    for (let i = 0; i < rows.length; i++) {
        const prev = i > 0 ? (rows[i - 1].production || {}) : {};
        const cur = rows[i].production || {};
        const delta = {};
        let total = 0;
        Object.keys(cur).forEach(ft => {
            const d = Math.max(0, (cur[ft] || 0) - (prev[ft] || 0));
            if (d > 0) { delta[ft] = d; total += d; }
        });
        rows[i].productionDelta = delta;
        rows[i].productionDeltaTotal = total;
        // Milk/eggs/wool only — manure and slurry would swamp the line.
        const est = rows[i].productionEst;
        rows[i].productionEstTotal = est
            ? Object.entries(est).filter(([ft]) => !FEED_UNSCALED_OUTPUT.includes(ft)).reduce((a, [, v]) => a + v, 0)
            : null;
    }
    return rows;
}

// Adds a "-" separator to a field-number input so the person can keep
// typing the next number without reaching for the dash key themselves —
// the field is already free text ("69-70-71" works fine on its own), this
// is purely a convenience nudge for combining several physical fields into
// one planner row.
window.appendFieldNumber = function (btn) {
    const input = btn.previousElementSibling;
    if (!input || !input.classList || !input.classList.contains('field-number')) return;
    const trimmed = input.value.trim();
    if (trimmed && !trimmed.endsWith('-')) input.value = trimmed + '-';
    input.focus();
};

window.updateBuildingCapacity = function (input) {
    const buildingId = input.dataset.building;
    const fillType = input.dataset.filltype;
    const farm = getAllFarms().find(f => f.id === currentFarmId);
    if (!farm || !buildingId || !fillType) return;

    if (!farm.animalBuildingCapacities) farm.animalBuildingCapacities = {};
    if (!farm.animalBuildingCapacities[buildingId]) farm.animalBuildingCapacities[buildingId] = {};

    const value = parseDecimal(input.value);
    if (!isNaN(value) && value > 0) {
        farm.animalBuildingCapacities[buildingId][fillType] = value;
    } else {
        delete farm.animalBuildingCapacities[buildingId][fillType];
    }

    saveFarmData(farm);
    rerenderKeepingFocus(() => openHubPanel('animals'));
};

// --- Animals panel: barn tiles, one-barn detail and custom barn names ---
// Barn opened from the tile grid (building id), null = the overview. Kept
// across re-renders (capacity/ration edits), reset when the sidebar opens
// the Animals view.
let animalSelectedBuilding = null;

// Custom name the player gave a barn (saved per farm, keyed like the
// capacities), falling back to the cleaned-up file name from the save.
function buildingDisplayName(farm, building) {
    const custom = farm && farm.animalBuildingNames && farm.animalBuildingNames[building.id];
    return custom || formatBuildingName(building.name);
}

function barnNameHtml(farm, building, cls) {
    return `<span class="barn-name-wrap">
        <span class="${cls} barn-name">${escapeHtml(buildingDisplayName(farm, building))}</span>
        <button type="button" class="barn-rename-btn" data-building="${escapeHtml(String(building.id))}" title="${t('barnRename')}" aria-label="${t('barnRename')}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
    </span>`;
}

// --- Breed pictures (see animal-images.js) ---
// Pictures are looked up in the mods folder next to the farm's savegame and
// cached as PNGs; anything missing (base-game breeds, no save path) falls
// back to a species icon. Loading runs just after a render and re-renders
// the Animals view once when new pictures are ready.
const ANIMAL_PICTURE_DIR = path.join(appDataDir, 'animal-pictures');
const animalPictures = { modsDir: null, index: null, timer: null, failed: new Set(), lookupFarmId: undefined, lookupDir: null };

// The farm's mods folder, looked up once per opened farm: finding it reads the
// farm and the game's settings, and a barn view asks once per animal (#13).
function animalPicturesModsDir() {
    if (animalPictures.lookupFarmId !== currentFarmId) {
        const farm = getCurrentFarm();
        animalPictures.lookupDir = animalImages.findModsDir(farm && farm.saveGamePath);
        animalPictures.lookupFarmId = currentFarmId;
    }
    return animalPictures.lookupDir;
}

function animalPictureUrl(subType, age) {
    const modsDir = animalPicturesModsDir();
    if (!modsDir) return null;
    if (animalPictures.modsDir !== modsDir) { animalPictures.modsDir = modsDir; animalPictures.index = null; }
    if (!animalPictures.index) { queueAnimalPictures(); return null; }
    const visual = animalImages.pickVisual(animalPictures.index, subType, age);
    if (!visual) return null;
    const file = animalImages.cacheFileFor(ANIMAL_PICTURE_DIR, visual);
    if (fs.existsSync(file)) return pathToFileURL(file).href;
    if (!animalPictures.failed.has(file)) queueAnimalPictures();
    return null;
}

function queueAnimalPictures() {
    if (animalPictures.timer) return;
    animalPictures.timer = setTimeout(() => {
        animalPictures.timer = null;
        const farm = getCurrentFarm();
        if (!farm || !animalPictures.modsDir) return;
        let changed = false;
        if (!animalPictures.index) {
            try { animalPictures.index = animalImages.loadIndex(animalPictures.modsDir, ANIMAL_PICTURE_DIR); }
            catch (e) { console.warn('Could not index animal pictures', e); animalPictures.index = {}; }
            changed = true;
        }
        (farm.animalBuildings || []).forEach(b => (b.clusters || []).forEach(c => {
            const visual = animalImages.pickVisual(animalPictures.index, c.subType, c.age);
            if (!visual) return;
            const file = animalImages.cacheFileFor(ANIMAL_PICTURE_DIR, visual);
            if (fs.existsSync(file) || animalPictures.failed.has(file)) return;
            try {
                if (animalImages.ensurePicture(ANIMAL_PICTURE_DIR, visual)) changed = true;
                else animalPictures.failed.add(file);
            } catch (e) {
                console.warn('Could not decode animal picture', visual.image, e);
                animalPictures.failed.add(file);
            }
        }));
        if (changed && currentPlannerView === 'animals') rerenderAnimalsKeepScroll();
    }, 30);
}

function animalPictureHtml(cluster, cls) {
    const type = cluster ? animalTypeOf(cluster.subType) : null;
    const url = cluster ? animalPictureUrl(cluster.subType, cluster.age) : null;
    if (url) return `<span class="animal-pic ${cls}"><img src="${escapeHtml(url)}" alt="" draggable="false"></span>`;
    return `<span class="animal-pic animal-pic--icon ${cls}" aria-hidden="true"><i class="fa-solid ${FEED_ANIMAL_ICONS[type] || 'fa-paw'}" aria-hidden="true"></i></span>`;
}

// --- Reproduction ---
// Settings (min. age, pregnancy length, min. health) come from an imported
// animals.xml or, failing that, the animal definitions found in the mods.
function getReproductionDef(subType) {
    const key = String(subType || '').toUpperCase();
    const own = ANIMAL_NEEDS_DATA[key] && ANIMAL_NEEDS_DATA[key].reproduction;
    if (own) return own;
    const fromMods = animalPictures.index && animalPictures.index.reproduction && animalPictures.index.reproduction[key];
    return fromMods || null;
}

// What a group of animals is doing reproduction-wise, from the savegame
// state + the breed's settings. The game raises `reproduction` by
// 100 / durationMonth each month and gives birth at 100 %.
function reproductionStatus(c) {
    const def = getReproductionDef(c.subType);
    const isMale = def ? def.supported === false : /^(BULL|ROOSTER|BOAR|RAM|BUCK|STALLION)_/i.test(c.subType);
    if (isMale) return { kind: 'male' };
    if (c.reproduction === undefined && !def) return null;   // old save data, nothing known
    const progress = c.reproduction || 0;
    if (progress > 0) {
        const monthsLeft = def && def.durationMonth ? Math.max(0, Math.ceil(def.durationMonth * (1 - progress / 100))) : null;
        return { kind: 'pregnant', progress, monthsLeft };
    }
    if (def && def.minAgeMonth && c.age < def.minAgeMonth) return { kind: 'young', months: def.minAgeMonth - c.age, minAge: def.minAgeMonth };
    if (def && def.minHealthFactor && c.health < def.minHealthFactor * 100) return { kind: 'lowHealth', minHealth: Math.round(def.minHealthFactor * 100) };
    if (c.isInseminated === false) return { kind: 'waiting' };
    return { kind: 'ready' };
}

function reproDueText(monthsLeft) {
    if (monthsLeft === null || monthsLeft === undefined) return '';
    return monthsLeft <= 0 ? t('reproDueNow') : t('reproDue').replace('{m}', monthsLeft);
}

function reproStatusHtml(c, st, milkFactor = null) {
    if (!st) return '';
    const icons = { pregnant: 'fa-baby-carriage', young: 'fa-hourglass-half', lowHealth: 'fa-heart-crack', waiting: 'fa-circle-pause', ready: 'fa-circle-check', male: 'fa-mars' };
    let label;
    if (st.kind === 'pregnant') label = `${t('reproProgress')} ${Math.round(st.progress)}%${st.monthsLeft !== null ? ' · ' + reproDueText(st.monthsLeft) : ''}`;
    else if (st.kind === 'young') label = t('reproYoung').replace('{m}', st.minAge);
    else if (st.kind === 'lowHealth') label = t('reproLowHealth').replace('{h}', st.minHealth);
    else label = t('repro_' + st.kind);
    let html = `<div class="herd-repro herd-repro--${st.kind}"><i class="fa-solid ${icons[st.kind]}" aria-hidden="true"></i><span>${label}</span></div>`;
    if (st.kind === 'pregnant') html += `<div class="herd-repro-bar"><div class="pen-bar-track"><div class="pen-bar-fill repro-bar-fill" style="width:${Math.max(3, Math.min(100, st.progress))}%"></div></div></div>`;
    if (c.hadABirth && c.monthsSinceLastBirth !== undefined) {
        // EAS lactation: what this month after calving does to the milk.
        let lact = '';
        if (milkFactor !== null && st.kind !== 'male') {
            lact = milkFactor > 0
                ? ' · ' + t('lactationMilk').replace('{x}', milkFactor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                : ' · ' + t('lactationDry');
        }
        html += `<div class="herd-repro-last">${t('reproLastBirth').replace('{m}', c.monthsSinceLastBirth)}${lact}</div>`;
    }
    return html;
}

// Barn-level summary: how many females are pregnant and when the next birth is.
function barnReproSummary(building) {
    let pregnant = 0, females = 0, ready = 0, waiting = 0, young = 0, nextBirth = null, known = false;
    (building.clusters || []).forEach(c => {
        const st = reproductionStatus(c);
        if (!st || st.kind === 'male') return;
        known = true;
        females += c.numAnimals;
        if (st.kind === 'pregnant') {
            pregnant += c.numAnimals;
            if (st.monthsLeft !== null && (nextBirth === null || st.monthsLeft < nextBirth)) nextBirth = st.monthsLeft;
        } else if (st.kind === 'ready') ready += c.numAnimals;
        else if (st.kind === 'waiting') waiting += c.numAnimals;
        else if (st.kind === 'young') young += c.numAnimals;
    });
    return known ? { pregnant, females, ready, waiting, young, nextBirth } : null;
}

// Icons (and colour tone) for the fill types shown in the barn detail.
function fillIcon(fillType) {
    const ft = String(fillType || '').toUpperCase();
    if (ft === 'FOOD') return 'fa-bowl-food';
    if (ft === 'WATER') return 'fa-droplet';
    if (ft === 'STRAW') return 'fa-wheat-awn';
    if (ft === 'LIQUIDMANURE' || ft === 'DIGESTATE') return 'fa-water';
    if (ft === 'MANURE') return 'fa-poop';
    if (ft.includes('MILK')) return 'fa-bottle-droplet';
    if (ft.includes('EGG')) return 'fa-egg';
    if (ft.includes('WOOL')) return 'fa-socks';
    if (ft.includes('HONEY')) return 'fa-jar';
    return 'fa-box';
}

function fillIconTone(fillType) {
    const ft = String(fillType || '').toUpperCase();
    if (ft === 'WATER') return 'water';
    if (ft === 'STRAW' || ft === 'FOOD') return 'feed';
    if (ft === 'MANURE' || ft === 'LIQUIDMANURE' || ft === 'DIGESTATE') return 'manure';
    return 'product';
}

function rerenderAnimalsKeepScroll() {
    const scroll = hubView ? hubView.scrollTop : 0;
    openHubPanel('animals');
    if (hubView) hubView.scrollTop = scroll;
}

function openAnimalBuilding(id) {
    animalSelectedBuilding = id;
    openHubPanel('animals');
    if (hubView) hubView.scrollTop = 0;
}

function startBarnRename(btn) {
    const wrap = btn.closest('.barn-name-wrap');
    const nameEl = wrap && wrap.querySelector('.barn-name');
    if (!wrap || !nameEl) return;
    const buildingId = btn.dataset.building;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'barn-name-input';
    input.value = nameEl.textContent;
    input.setAttribute('aria-label', t('barnRename'));
    wrap.replaceChildren(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
        if (done) return;
        done = true;
        const farm = getAllFarms().find(f => f.id === currentFarmId);
        const building = farm && (farm.animalBuildings || []).find(b => String(b.id) === buildingId);
        if (save && farm && building) {
            const value = input.value.trim();
            if (!farm.animalBuildingNames) farm.animalBuildingNames = {};
            // Empty (or the default name) restores the name from the save.
            if (value && value !== formatBuildingName(building.name)) farm.animalBuildingNames[building.id] = value;
            else delete farm.animalBuildingNames[building.id];
            saveFarmData(farm);
        }
        rerenderAnimalsKeepScroll();
    };
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
}

function wireBarnPanel(bodyEl) {
    bodyEl.querySelectorAll('.barn-rename-btn').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        startBarnRename(btn);
    }));
    bodyEl.querySelectorAll('.barn-tile').forEach(tile => {
        const buildingId = tile.dataset.building;
        const building = ((getCurrentFarm() || {}).animalBuildings || []).find(b => String(b.id) === buildingId);
        if (!building) return;
        tile.addEventListener('click', () => openAnimalBuilding(building.id));
        tile.addEventListener('keydown', e => {
            if (e.target !== tile || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            openAnimalBuilding(building.id);
        });
    });
    const back = bodyEl.querySelector('.barn-back-btn');
    if (back) back.addEventListener('click', () => {
        animalSelectedBuilding = null;
        openHubPanel('animals');
        if (hubView) hubView.scrollTop = 0;
    });
}

// =============================================================
// FINANCE VIEW — KPI tiles, monthly balance chart (crosshair tooltip),
// season-end bars, table view. Colors: balance #3B7542 / loan #C97A2B,
// validated with the dataviz palette checker against --color-surface-soft
// (the brand #3F6B44 is too gray for a chart mark). Loan is also dashed, so
// the two series never rely on color alone.
// =============================================================
const FIN_LOCALE = () => ({ pl: 'pl-PL', de: 'de-DE' }[currentLang] || 'en-US');
function finMoney(v) {
    const n = Math.round(v).toLocaleString(FIN_LOCALE());
    return CURRENCY === '€' ? `${n} €` : `${CURRENCY}${n}`;
}

// Money amounts: farm.balance is a number now, but farms, archives and the
// demo data from older versions hold text like "1234 €" — accept both.
function parseMoney(v) {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? 0 : n;
}

// Number typed by the player: "1,5", "1.5", "1 234,5", "1.234,5", "1,234.5".
// When both "," and "." appear the last one is the decimal point; a single
// kind appearing more than once is a thousands separator. Anything else that
// isn't a plain number (e.g. "1,234,5") gives NaN instead of a wrong value.
function parseDecimal(v) {
    let s = String(v ?? '').replace(/[\s  ]/g, '');
    if (!s) return NaN;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    let dec = '', group = '';
    if (comma >= 0 && dot >= 0) { dec = comma > dot ? ',' : '.'; group = dec === ',' ? '.' : ','; }
    else if (comma >= 0) { if (s.split(',').length > 2) group = ','; else dec = ','; }
    else if (dot >= 0) { if (s.split('.').length > 2) group = '.'; else dec = '.'; }
    let [int, frac] = dec ? s.split(dec) : [s, undefined];
    if (group) {
        if (!new RegExp(`^[-+]?\\d{1,3}(\\${group}\\d{3})+$`).test(int)) return NaN;
        int = int.split(group).join('');
    }
    const plain = frac !== undefined ? `${int}.${frac}` : int;
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(plain) ? parseFloat(plain) : NaN;
}

// Currency symbol of the open farm: chosen in Settings, or the game's own
// setting (gameSettings.xml <units><money>: 1 euro, 2 dollar, 3 pound).
// Only the symbol changes — amounts in the save are the same.
const GAME_MONEY_UNITS = { '1': '€', '2': '$', '3': '£' };
let CURRENCY = '€';

function readGameCurrency(saveGamePath) {
    try {
        const gameDir = path.dirname(path.dirname(saveGamePath));
        const gs = fs.readFileSync(path.join(gameDir, 'gameSettings.xml'), 'utf-8');
        const m = gs.match(/<units>[\s\S]*?<money>\s*(\d+)\s*<\/money>/);
        return m ? (GAME_MONEY_UNITS[m[1]] || null) : null;
    } catch (e) {
        return null;
    }
}

function currencyOf(farm) {
    if (farm && farm.currency && farm.currency !== 'auto') return farm.currency;
    return (farm && farm.saveGamePath && readGameCurrency(farm.saveGamePath)) || '€';
}

function useCurrency(farm) {
    CURRENCY = currencyOf(farm);
}
function finCompact(v) {
    return new Intl.NumberFormat(FIN_LOCALE(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}
function finSigned(v) {
    return (v > 0 ? '+' : v < 0 ? '−' : '') + finMoney(Math.abs(v));
}
// "Nice" axis ticks (1/2/5 × 10^n) covering [min, max].
function finTicks(min, max, count = 4) {
    const span = Math.max(1, max - min);
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
    return ticks;
}

function finDeltaHtml(delta, label) {
    if (delta == null || !isFinite(delta)) return '';
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const icon = { up: 'fa-arrow-trend-up', down: 'fa-arrow-trend-down', flat: 'fa-minus' }[dir];
    return `<span class="fin-delta fin-delta--${dir}"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${finSigned(delta)}</span>
        <span class="fin-delta-label">${label}</span>`;
}

// KPI row: balance (hero), loan, change this season, play time.
function renderFinanceKpis(farm, monthly, history) {
    const balance = parseMoney(farm && farm.balance);
    const loan = parseMoney(farm && farm.loan);
    const prevMonth = monthly.length > 1 ? monthly[monthly.length - 2] : null;
    const season = (farm && farm.currentSeason) || 1;
    // Season start: the last archived season's end balance, else this season's first month.
    const prevSeason = history.filter(h => h.season < season).slice(-1)[0];
    const firstThisSeason = monthly.find(r => r.appSeason === season);
    const seasonStart = prevSeason ? prevSeason.balance : (firstThisSeason ? firstThisSeason.balance : null);
    const bc = farm && farm.bankCredit;
    const loanSub = bc && bc.count
        ? t('bankCreditValue').replace('{n}', bc.count).replace('{m}', finMoney(bc.monthly))
        : (loan > 0 ? '' : t('finNoLoan'));
    return `<div class="fin-kpis">
        <div class="fin-kpi fin-kpi--hero">
            <span class="fin-kpi-label">${t('detailBalance')}</span>
            <span class="fin-kpi-value">${finMoney(balance)}</span>
            <span class="fin-kpi-sub">${prevMonth ? finDeltaHtml(balance - prevMonth.balance, t('finVsPrevMonth')) : t('finNoHistory')}</span>
        </div>
        <div class="fin-kpi">
            <span class="fin-kpi-label">${t('detailCredit')}</span>
            <span class="fin-kpi-value">${finMoney(loan)}</span>
            <span class="fin-kpi-sub">${escapeHtml(loanSub)}</span>
        </div>
        <div class="fin-kpi">
            <span class="fin-kpi-label">${t('finSeasonChange').replace('{n}', season)}</span>
            <span class="fin-kpi-value">${seasonStart != null ? finSigned(balance - seasonStart) : '–'}</span>
            <span class="fin-kpi-sub">${seasonStart != null ? t('finFromStart').replace('{v}', finMoney(seasonStart)) : t('finNoHistory')}</span>
        </div>
        <div class="fin-kpi">
            <span class="fin-kpi-label">${t('detailFarmAge')}</span>
            <span class="fin-kpi-value">${escapeHtml((farm && farm.playTime) || '0h 0m')}</span>
        </div>
    </div>`;
}

// --- Shared trend chart (Finance, Animals) ------------------------------------
// Monthly rows as lines: the first series gets an area wash, recessive
// gridlines at nice ticks, month labels + year marks under the axis, the last
// value labelled at the end, and a crosshair tooltip (wireTrendChart).
// series: [{ key, label, cls: 'balance'|'loan'|..., dashed }]
// opts: { format(v) -> axis/end label, formatFull(v) -> tooltip value,
//         domain: [min, max] fixed, ariaLabel }
function buildTrendChart(rows, width, series, opts = {}) {
    const W = Math.max(520, Math.round(width)), H = 260;
    const padL = 64, padR = 96, padT = 16, padB = 44;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const format = opts.format || finCompact;
    const valid = v => v !== null && v !== undefined && isFinite(v);
    const vals = [];
    series.forEach(s => rows.forEach(r => { if (valid(r[s.key])) vals.push(r[s.key]); }));
    const ticks = opts.domain
        ? finTicks(opts.domain[0], opts.domain[1])
        : finTicks(Math.min(0, ...vals), Math.max(...vals, 1));
    const minV = ticks[0], maxV = ticks[ticks.length - 1];
    const x = i => padL + (rows.length === 1 ? plotW / 2 : i * plotW / (rows.length - 1));
    const y = v => padT + plotH - (Math.min(maxV, Math.max(minV, v)) - minV) / (maxV - minV) * plotH;
    const pathOf = key => {
        let d = '', pen = false;
        rows.forEach((r, i) => {
            if (!valid(r[key])) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)} `;
            pen = true;
        });
        return d.trim();
    };

    let s = `<svg class="fin-chart-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeHtml(opts.ariaLabel || '')}">`;
    ticks.forEach(v => {
        s += `<line class="fin-grid" x1="${padL}" x2="${padL + plotW}" y1="${y(v)}" y2="${y(v)}"/>`;
        s += `<text class="fin-axis" x="${padL - 10}" y="${y(v) + 4}" text-anchor="end">${escapeHtml(format(v))}</text>`;
    });
    const every = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(plotW / 56))));
    rows.forEach((r, i) => {
        if (i % every === 0 || i === rows.length - 1) s += `<text class="fin-axis" x="${x(i)}" y="${padT + plotH + 18}" text-anchor="middle">${escapeHtml(monthlyRowLabel(r))}</text>`;
        if (i === 0 || r.period % 12 === 0) s += `<text class="fin-axis fin-axis--year" x="${x(i)}" y="${padT + plotH + 36}" text-anchor="middle">${t('finYear').replace('{y}', r.gameYear)}</text>`;
    });
    // Area under the first series (only where it has values).
    const first = series[0];
    const firstIdx = rows.map((r, i) => valid(r[first.key]) ? i : -1).filter(i => i >= 0);
    if (firstIdx.length > 1) {
        const base = y(Math.max(minV, 0));
        s += `<path class="fin-area trend-area--${first.cls}" d="${pathOf(first.key)} L${x(firstIdx[firstIdx.length - 1])},${base} L${x(firstIdx[0])},${base} Z"/>`;
    }
    series.slice().reverse().forEach(se => { s += `<path class="fin-line trend-line--${se.cls}${se.dashed ? ' is-dashed' : ''}" d="${pathOf(se.key)}"/>`; });
    series.forEach((se, k) => {
        const li = rows.map((r, i) => valid(r[se.key]) ? i : -1).filter(i => i >= 0).pop();
        if (li === undefined) return;
        const v = rows[li][se.key];
        s += `<circle class="fin-dot trend-dot--${se.cls}" cx="${x(li)}" cy="${y(v)}" r="4.5"/>`;
        s += `<text class="fin-endlabel${k ? ' fin-endlabel--muted' : ''}" x="${x(li) + 10}" y="${y(v) + 4}">${escapeHtml(format(v, true))}</text>`;
    });
    s += `<line class="fin-crosshair" x1="0" x2="0" y1="${padT}" y2="${padT + plotH}" visibility="hidden"/>`;
    series.forEach((se, k) => { s += `<circle class="fin-hover-dot trend-dot--${se.cls}" data-series="${k}" r="5" visibility="hidden"/>`; });
    s += `<rect class="fin-hit" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent"/>`;
    s += `</svg>`;
    return { svg: s, geom: { rows, x, y, series, formatFull: opts.formatFull || (v => String(v)), deltaFull: opts.deltaFull } };
}

function wireTrendChart(card, geom) {
    if (!card || !geom) return;
    const svg = card.querySelector('svg'), hit = svg && svg.querySelector('.fin-hit');
    const tip = card.querySelector('.fin-tooltip');
    if (!hit || !tip) return;
    const cross = svg.querySelector('.fin-crosshair');
    const dots = [...svg.querySelectorAll('.fin-hover-dot')];
    const { rows, x, y, series, formatFull, deltaFull } = geom;
    const valid = v => v !== null && v !== undefined && isFinite(v);
    const show = (i) => {
        const r = rows[i], cx = x(i);
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
        dots.forEach((d, k) => {
            const v = r[series[k].key];
            if (!valid(v)) { d.setAttribute('visibility', 'hidden'); return; }
            d.setAttribute('cx', cx); d.setAttribute('cy', y(v)); d.setAttribute('visibility', 'visible');
        });
        tip.replaceChildren();
        const head = document.createElement('div'); head.className = 'fin-tip-head';
        head.textContent = `${translateMonth(r.month)} · ${t('finYear').replace('{y}', r.gameYear)}`;
        tip.appendChild(head);
        series.forEach(se => {
            const v = r[se.key];
            const row = document.createElement('div'); row.className = 'fin-tip-row';
            const key = document.createElement('span'); key.className = `fin-tip-key trend-key--${se.cls}${se.dashed ? ' is-dashed' : ''}`;
            const val = document.createElement('strong'); val.textContent = valid(v) ? formatFull(v) : '–';
            const l = document.createElement('span'); l.className = 'fin-tip-label'; l.textContent = se.label;
            row.append(key, val, l); tip.appendChild(row);
        });
        const prev = rows[i - 1], k0 = series[0].key;
        if (deltaFull && prev && valid(prev[k0]) && valid(r[k0])) {
            const d = document.createElement('div'); d.className = 'fin-tip-delta';
            d.textContent = `${deltaFull(r[k0] - prev[k0])} ${t('finVsPrevMonth')}`;
            tip.appendChild(d);
        }
        tip.hidden = false;
        const box = svg.getBoundingClientRect(), cb = card.getBoundingClientRect();
        const px = box.left - cb.left + cx * (box.width / svg.viewBox.baseVal.width);
        tip.style.left = Math.min(cb.width - tip.offsetWidth - 8, Math.max(8, px + 14)) + 'px';
        tip.style.top = '8px';
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); tip.hidden = true; };
    hit.addEventListener('pointermove', e => {
        const box = svg.getBoundingClientRect();
        const sx = (e.clientX - box.left) * (svg.viewBox.baseVal.width / box.width);
        let best = 0, bd = Infinity;
        rows.forEach((_, i) => { const d = Math.abs(x(i) - sx); if (d < bd) { bd = d; best = i; } });
        show(best);
    });
    hit.addEventListener('pointerleave', hide);
}

// A titled card holding one trend chart; `build(width)` returns buildTrendChart().
// Charts are registered so they can be redrawn at their card's real width.
let trendCharts = [];
function trendCardHtml(id, title, legendHtml, noteHtml, build, width) {
    const chart = build(width);
    trendCharts.push({ id, build, drawnAt: width });
    return `<section class="fin-card fin-chart trend-card" data-trend="${id}">
        <div class="fin-card-head"><h4>${title}</h4>${legendHtml || ''}</div>
        ${chart.svg}
        <div class="fin-tooltip" hidden></div>
        ${noteHtml || ''}
    </section>`;
}

// After a view's HTML is in the page: wire every trend chart and redraw it
// at its card's real width (the view may still be hidden while rendering)
// and on window resize, so charts fill their card with unscaled text.
let trendResizeObserver = null;
function activateTrendCharts(root) {
    if (trendResizeObserver) trendResizeObserver.disconnect();
    const redraw = (entry, card) => {
        const inner = card.clientWidth - 36;
        if (inner <= 0 || Math.abs(inner - entry.drawnAt) <= 4) return false;
        entry.drawnAt = inner;
        const chart = entry.build(inner);
        card.querySelector('svg').outerHTML = chart.svg;
        wireTrendChart(card, chart.geom);
        return true;
    };
    trendCharts.forEach(entry => {
        const card = root.querySelector(`[data-trend="${entry.id}"]`);
        if (!card) return;
        if (!redraw(entry, card)) wireTrendChart(card, entry.build(entry.drawnAt).geom);
    });
    if (typeof ResizeObserver === 'undefined') return;
    trendResizeObserver = new ResizeObserver(entries => entries.forEach(en => {
        const card = en.target;
        const entry = trendCharts.find(c => c.id === card.dataset.trend);
        if (entry) redraw(entry, card);
    }));
    root.querySelectorAll('[data-trend]').forEach(card => trendResizeObserver.observe(card));
}

function trendLegendHtml(items) {
    return `<div class="chart-legend fin-legend">${items.map(it => `<span class="fin-legend-item"><span class="fin-legend-line trend-key--${it.cls}${it.dashed ? ' is-dashed' : ''}"></span>${it.label}</span>`).join('')}</div>`;
}

// Per-season values as columns (≤24px, 4px rounded top, value above).
function buildSeasonBars(history, key, width, format, ariaLabel) {
    const W = Math.max(360, Math.min(Math.round(width), 120 + history.length * 90)), H = 220;
    const padL = 64, padR = 16, padT = 26, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const vals = history.map(h => h[key] || 0);
    const ticks = finTicks(Math.min(0, ...vals), Math.max(...vals, 1), 3);
    const minV = ticks[0], maxV = ticks[ticks.length - 1];
    const y = v => padT + plotH - (v - minV) / (maxV - minV) * plotH;
    const band = plotW / history.length, bw = Math.min(24, band * 0.5);
    let s = `<svg class="fin-chart-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeHtml(ariaLabel || '')}">`;
    ticks.forEach(v => {
        s += `<line class="fin-grid" x1="${padL}" x2="${padL + plotW}" y1="${y(v)}" y2="${y(v)}"/>`;
        s += `<text class="fin-axis" x="${padL - 10}" y="${y(v) + 4}" text-anchor="end">${escapeHtml(format(v))}</text>`;
    });
    history.forEach((h, i) => {
        const val = h[key] || 0;
        const cx = padL + band * i + band / 2;
        const top = y(Math.max(val, 0)), base = y(Math.max(minV, 0)), bot = y(Math.min(val, 0));
        const barTop = val >= 0 ? top : base, barH = Math.max(1, (val >= 0 ? base - top : bot - base));
        const r = Math.min(4, barH / 2);
        const x0 = cx - bw / 2, x1 = cx + bw / 2;
        const d = val >= 0
            ? `M${x0},${barTop + barH} V${barTop + r} Q${x0},${barTop} ${x0 + r},${barTop} H${x1 - r} Q${x1},${barTop} ${x1},${barTop + r} V${barTop + barH} Z`
            : `M${x0},${barTop} V${barTop + barH - r} Q${x0},${barTop + barH} ${x0 + r},${barTop + barH} H${x1 - r} Q${x1},${barTop + barH} ${x1},${barTop + barH - r} V${barTop} Z`;
        const current = i === history.length - 1;
        s += `<g class="fin-bar-g" tabindex="0"><title>${escapeHtml(t('season') + ' ' + h.season + ': ' + format(val, true))}</title>
            <rect x="${cx - band / 2}" y="${padT}" width="${band}" height="${plotH}" fill="transparent"/>
            <path class="fin-bar${current ? ' fin-bar--current' : ''}" d="${d}"/>
            <text class="fin-barlabel" x="${cx}" y="${(val >= 0 ? barTop : barTop + barH) - 8}" text-anchor="middle">${escapeHtml(format(val, true))}</text>
            <text class="fin-axis" x="${cx}" y="${padT + plotH + 20}" text-anchor="middle">S${h.season}${current ? ' · ' + t('finNow') : ''}</text></g>`;
    });
    s += `</svg>`;
    return s;
}

function renderFinancePanel(bodyEl, farm) {
    const history = getSeasonBalanceHistory(farm);
    const monthly = getMonthlyHistory(farm);
    const width = Math.max(520, (bodyEl.clientWidth || 900) - 48);
    trendCharts = [];
    let html = renderFinanceKpis(farm, monthly, history);

    if (monthly.length > 1) {
        const hasLoan = monthly.some(r => r.loan > 0);
        const series = [{ key: 'balance', label: t('detailBalance'), cls: 'balance' }];
        if (hasLoan) series.push({ key: 'loan', label: t('detailCredit'), cls: 'loan', dashed: true });
        const opts = { format: (v, end) => finCompact(v) + (end ? ' ' + CURRENCY : ''), formatFull: finMoney, deltaFull: finSigned, ariaLabel: t('finChartMonthly') };
        html += trendCardHtml('fin-balance', t('finChartMonthly'), hasLoan ? trendLegendHtml(series) : '', '',
            w => buildTrendChart(monthly, w, series, opts), width);
    }
    if (history.length > 1) {
        html += `<section class="fin-card fin-chart">
            <div class="fin-card-head"><h4>${t('finChartSeasons')}</h4></div>
            ${buildSeasonBars(history, 'balance', width, (v, end) => finCompact(v) + (end ? ' ' + CURRENCY : ''), t('finChartSeasons'))}
        </section>`;
    }
    if (monthly.length <= 1 && history.length <= 1) html += `<p class="hub-panel-note">${t('hubChartNeedsMoreMonths')}</p>`;

    if (monthly.length) {
        const rowsHtml = monthly.slice().reverse().map((r, idx, arr) => {
            const prev = arr[idx + 1];
            return `<tr><td>${escapeHtml(translateMonth(r.month))}</td><td class="is-text">${r.gameYear}</td><td class="num">${finMoney(r.balance)}</td><td class="num">${finMoney(r.loan || 0)}</td><td class="num">${prev ? finSigned(r.balance - prev.balance) : '–'}</td></tr>`;
        }).join('');
        html += `<details class="fin-card fin-table-wrap"><summary>${t('finShowTable')}</summary>
            <table class="data-table fin-table"><thead><tr><th>${t('finColMonth')}</th><th class="is-text">${t('finColYear')}</th><th class="num">${t('detailBalance')}</th><th class="num">${t('detailCredit')}</th><th class="num">${t('finColChange')}</th></tr></thead>
            <tbody>${rowsHtml}</tbody></table></details>`;
    }
    bodyEl.innerHTML = `<div class="fin-view">${html}</div>`;
    activateTrendCharts(bodyEl);
}

// --- Animals overview: KPI tiles + trend charts ---------------------------
function animalsKpisHtml(farm, buildings, monthly, summaries) {
    const heads = buildings.reduce((s, b) => s + b.clusters.reduce((a, c) => a + c.numAnimals, 0), 0);
    const health = avgHealthFromBuildings(buildings);
    const prev = monthly.length > 1 ? monthly[monthly.length - 2] : null;
    let pregnant = 0, nextBirth = null;
    buildings.forEach(b => {
        const r = barnReproSummary(b);
        if (!r) return;
        pregnant += r.pregnant || 0;
        if (r.nextBirth !== null && r.nextBirth !== undefined) nextBirth = nextBirth === null ? r.nextBirth : Math.min(nextBirth, r.nextBirth);
    });
    const lowBarns = buildings.filter(b => summaries && summaries[b.id] && (summaries[b.id].lowFeed || summaries[b.id].noFeedAtAll));
    const countDelta = prev ? heads - (prev.animals || 0) : null;
    const healthDelta = prev && prev.avgHealth != null && health != null ? health - prev.avgHealth : null;
    const deltaSpan = (d, fmt) => {
        if (d == null || !isFinite(d)) return `<span class="fin-kpi-sub">${t('finNoHistory')}</span>`;
        const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
        const icon = { up: 'fa-arrow-trend-up', down: 'fa-arrow-trend-down', flat: 'fa-minus' }[dir];
        return `<span class="fin-kpi-sub"><span class="fin-delta fin-delta--${dir}"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${fmt(d)}</span><span class="fin-delta-label">${t('finVsPrevMonth')}</span></span>`;
    };
    const signedInt = d => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(Math.round(d)).toLocaleString(FIN_LOCALE());
    return `<div class="fin-kpis">
        <div class="fin-kpi fin-kpi--hero">
            <span class="fin-kpi-label">${t('detailAnimals')}</span>
            <span class="fin-kpi-value">${heads.toLocaleString(FIN_LOCALE())}</span>
            ${deltaSpan(countDelta, signedInt)}
        </div>
        <div class="fin-kpi">
            <span class="fin-kpi-label">${t('avgHealthLabel')}</span>
            <span class="fin-kpi-value">${health != null ? Math.round(health) + '%' : '–'}</span>
            ${deltaSpan(healthDelta, d => signedInt(d) + ' pp')}
        </div>
        <div class="fin-kpi">
            <span class="fin-kpi-label">${t('reproPregnant')}</span>
            <span class="fin-kpi-value">${pregnant.toLocaleString(FIN_LOCALE())}</span>
            <span class="fin-kpi-sub">${pregnant && nextBirth !== null ? escapeHtml(reproDueText(nextBirth)) : ''}</span>
        </div>
        <div class="fin-kpi${lowBarns.length ? ' fin-kpi--alert' : ''}">
            <span class="fin-kpi-label">${t('hubFeedLevel')}</span>
            <span class="fin-kpi-value">${lowBarns.length ? `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${lowBarns.length}` : `<i class="fa-solid fa-circle-check" aria-hidden="true"></i>`}</span>
            <span class="fin-kpi-sub">${lowBarns.length ? escapeHtml(t('animKpiLowFeed').replace('{list}', lowBarns.map(b => buildingDisplayName(farm, b)).join(', '))) : t('animKpiFeedOk')}</span>
        </div>
    </div>`;
}

// Trough gauge: how full the bar is and when it counts as "low feed".
// With the barn's daily need known, the warning is about days of feed left
// (< 3 days, the same cut-off as the red days figure) and, without an entered
// capacity, a full bar means two weeks of feed. A capacity makes the bar a
// real percentage. Only with neither does it fall back to the old litre
// threshold and the fullest barn as 100 %.
const FEED_GAUGE_FULL_DAYS = 14;
function feedGauge(level, cap, daily, maxLevel) {
    const days = daily > 0 ? level / daily : null;
    let pct, title = '';
    if (cap > 0) pct = level / cap * 100;
    else if (days !== null) { pct = days / FEED_GAUGE_FULL_DAYS * 100; title = t('feedGaugeDaysHint').replace('{n}', FEED_GAUGE_FULL_DAYS); }
    else pct = level / (maxLevel || level || 1) * 100;
    let low, mid;
    if (days !== null) { low = days < 3; mid = days < 7; }
    else if (cap > 0) { low = pct < 15; mid = pct < 35; }
    else { low = level < 80; mid = pct < 35; }
    return {
        pct: Math.max(3, Math.min(100, pct)),
        low,
        cls: low ? 'pen-bar-fill--low' : (mid ? 'pen-bar-fill--mid' : 'pen-bar-fill--ok'),
        days,
        title
    };
}

function animalsTrendsHtml(farm, monthly, seasonHistory, width) {
    let html = '';
    const hasHerd = monthly.some(r => (r.animals || 0) > 0);
    // Months recorded since 0.9.11 carry an estimate from the herd's curves;
    // older ones only the tank level, charted as its rise per month.
    const estRows = monthly.filter(r => r.productionEstTotal != null);
    const useEst = estRows.length > 1 && estRows.some(r => r.productionEstTotal > 0);
    const hasProd = useEst || monthly.some(r => (r.productionDeltaTotal || 0) > 0);
    const int = v => Math.round(v).toLocaleString(FIN_LOCALE());
    const signedInt = d => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(Math.round(d)).toLocaleString(FIN_LOCALE());
    if (monthly.length > 1 && hasHerd) {
        html += trendCardHtml('anim-count', t('animChartCount'), '', '',
            w => buildTrendChart(monthly, w, [{ key: 'animals', label: t('detailAnimals'), cls: 'animals' }],
                { format: v => finCompact(v), formatFull: int, deltaFull: signedInt, ariaLabel: t('animChartCount') }), width);
        html += trendCardHtml('anim-health', t('animChartHealth'), '', '',
            w => buildTrendChart(monthly, w, [{ key: 'avgHealth', label: t('avgHealthLabel'), cls: 'health' }],
                { format: v => Math.round(v) + '%', formatFull: v => Math.round(v) + '%', deltaFull: d => signedInt(d) + ' pp', domain: [0, 100], ariaLabel: t('animChartHealth') }), width);
        if (hasProd) {
            html += trendCardHtml('anim-prod', t('hubMilkProduced'), '', `<p class="hub-panel-note">${t(useEst ? 'hubProductionEstNote' : 'hubProductionProxyNote')}</p>`,
                w => buildTrendChart(useEst ? estRows : monthly, w, [{ key: useEst ? 'productionEstTotal' : 'productionDeltaTotal', label: t('hubMilkProduced'), cls: 'production' }],
                    { format: (v, end) => finCompact(v) + (end ? ' l' : ''), formatFull: v => int(v) + ' l', ariaLabel: t('hubMilkProduced') }), width);
        }
    } else if (seasonHistory.length > 1) {
        html += `<section class="fin-card fin-chart"><div class="fin-card-head"><h4>${t('animChartSeasons')}</h4></div>
            ${buildSeasonBars(seasonHistory, 'animals', width, v => finCompact(v), t('animChartSeasons'))}</section>`;
    }
    return html || `<p class="hub-panel-note">${t('hubChartNeedsMoreMonths')}</p>`;
}

window.openHubPanel = function (type) {
    const titleEl = document.getElementById('hub-panel-title');
    const bodyEl = document.getElementById('hub-panel-body');
    // The scrolling view container — panels use it to keep scroll position on re-render.
    const modalEl = hubView;
    if (!titleEl || !bodyEl) return;

    if (type === 'finance') {
        titleEl.textContent = t('hubFinance');
        renderFinancePanel(bodyEl, getAllFarms().find(f => f.id === currentFarmId));
    } else if (type === 'animals') {
        const farm = getAllFarms().find(f => f.id === currentFarmId);
        const buildings = (farm && farm.animalBuildings) || [];
        const capacities = (farm && farm.animalBuildingCapacities) || {};

        titleEl.textContent = t('hubAnimals');

        // Shared by both branches below (a farm can have herd history from
        // past seasons even if every animal has since been sold, so this
        // isn't gated on buildings.length).
        const animalHistory = getAnimalHistoryTrend(farm);
        const monthlyAnim = getMonthlyHistory(farm);

        trendCharts = [];
        const trendWidth = Math.max(520, (bodyEl.clientWidth || 900) - 48);

        if (buildings.length === 0) {
            bodyEl.innerHTML = `<div class="fin-view anim-view">
                <p class="hub-panel-note">${t('hubNoAnimalsYet')}</p>
                ${breedNormsHtml(farm)}
                ${animalsTrendsHtml(farm, monthlyAnim, animalHistory, trendWidth)}
            </div>`;
            activateTrendCharts(bodyEl);
            wireBreedNorms(bodyEl, farm);
        } else {
            // Fallback reference for buildings without a manually-entered
            // capacity: scaled against the fullest total feed load among
            // your buildings instead of a true percentage (the save file
            // never records real storage capacity).
            let maxCombinedFood = 0;
            buildings.forEach(b => {
                const total = b.food.reduce((s, f) => s + f.level, 0);
                maxCombinedFood = Math.max(maxCombinedFood, total);
            });

            const hasAnyNeedsData = Object.keys(ANIMAL_NEEDS_DATA).length > 0;
            let anyMissingCapacity = false;

            // Ration chosen per species (shared with the Feed planner) and the
            // farm-wide daily need per feed category it implies — stock in
            // silos/bales is shared by every building, so "how long it lasts"
            // is stock / what the whole farm eats of it.
            const feedPlan = getFeedPlan(farm);
            const feedStockCat = feedStockCategoriesFor(farm, feedPlan);
            const farmDailyByCat = {};
            buildings.forEach(b => b.clusters.forEach(c => {
                const type = animalTypeOf(c.subType);
                if (!type || !ANIMAL_NEEDS_DATA[c.subType]) return;
                const ration = resolveRation(type, feedPlan, b.id);
                if (ration) splitByRecipe(clusterDailyFood(farm, type, c), ration, farmDailyByCat);
                farmDailyByCat.STRAW = (farmDailyByCat.STRAW || 0) + clusterDailyNeed(c, 'straw');
            }));
            let anyProductionFound = false;

            // One full card per barn (shown when a tile is opened) plus a
            // short summary for its tile in the overview grid.
            const cards = {};
            const summaries = {};

            buildings.forEach(building => {
                const buildingCaps = capacities[building.id] || {};
                let card = '';

                // Daily requirement, summed across every cluster in this
                // building, using each animal's own age to interpolate the
                // right point on its breed's curve (from an imported
                // animals.xml — see Settings).
                const dailyNeed = { food: 0, water: 0, straw: 0 };
                let needsKnownForAll = hasAnyNeedsData;
                // Estimated daily output (milk/eggs/wool/...), summed the
                // same way — only populated for breeds whose imported
                // animals.xml happened to include recognizable production
                // curves (see parseAnimalNeedsXml); empty otherwise.
                const dailyOutput = {};
                const foodByType = {};   // daily food per species in this building
                building.clusters.forEach(c => {
                    if (!ANIMAL_NEEDS_DATA[c.subType]) { needsKnownForAll = false; return; }
                    const animalType = animalTypeOf(c.subType);
                    // EAS lactation: same food factor as the feed planner.
                    const clusterFood = clusterDailyFood(farm, animalType, c);
                    if (animalType) foodByType[animalType] = (foodByType[animalType] || 0) + clusterFood;
                    dailyNeed.food += clusterFood;
                    dailyNeed.water += clusterDailyNeed(c, 'water');
                    dailyNeed.straw += clusterDailyNeed(c, 'straw');

                    addClusterOutput(farm, building, c, feedPlan, dailyOutput);
                });
                if (Object.keys(dailyOutput).length > 0) anyProductionFound = true;

                const combinedFoodLevel = building.food.reduce((s, f) => s + f.level, 0);
                const combinedCap = buildingCaps[ANIMAL_FEED_CAPACITY_KEY];
                const gauge = feedGauge(combinedFoodLevel, combinedCap, needsKnownForAll ? dailyNeed.food : 0, maxCombinedFood);
                const lowFeed = building.food.length > 0 && gauge.low;
                const noFeedAtAll = building.food.length === 0;

                const warn = lowFeed || noFeedAtAll;
                const heads = building.clusters.reduce((s, c) => s + c.numAnimals, 0);
                const avgHealth = avgHealthFromBuildings([building]) ?? 0;
                const num = n => Math.round(n).toLocaleString(FIN_LOCALE());
                const statRow = (fillType, label, value) => `
                    <div class="barn-stat">
                        <span class="barn-stat-icon barn-stat-icon--${fillIconTone(fillType)}" aria-hidden="true"><i class="fa-solid ${fillIcon(fillType)}" aria-hidden="true"></i></span>
                        <span class="barn-stat-label">${label}</span>
                        <span class="barn-stat-value">${value}</span>
                    </div>`;

                card += `<div class="pen-card barn-detail ${warn ? 'barn-detail--warning' : ''}">`;

                // --- Hero: picture of the main breed, name, head count, health ---
                const mainCluster = building.clusters.slice().sort((a, b) => b.numAnimals - a.numAnimals)[0];
                card += `<header class="barn-hero">
                    ${animalPictureHtml(mainCluster, 'barn-hero-pic')}
                    <div class="barn-hero-text">
                        <div class="barn-hero-name">${barnNameHtml(farm, building, 'barn-hero-title')}</div>
                        <div class="barn-hero-meta">
                            <span><strong>${num(heads)}</strong> ${t('barnHeads')}</span>
                            <span>${t('hubHealth')}: <strong>${Math.round(avgHealth)}%</strong></span>
                        </div>
                    </div>
                    ${warn ? `<span class="pen-warning-badge barn-hero-badge"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${t('hubFeedLow')}</span>` : ''}
                </header>`;

                // --- Herd: one card per group (breed + age), with its picture ---
                card += `<section class="barn-section">
                    <h4 class="barn-section-title">${t('barnHerd')}</h4>
                    <div class="herd-grid">`;
                building.clusters.slice().sort((a, b) => b.age - a.age).forEach(c => {
                    const h = Math.round(c.health || 0);
                    const hClass = h < 50 ? 'pen-bar-fill--low' : (h < 80 ? 'pen-bar-fill--mid' : 'pen-bar-fill--ok');
                    card += `<div class="herd-card">
                        ${animalPictureHtml(c, 'herd-pic')}
                        <div class="herd-info">
                            <div class="herd-name">${escapeHtml(formatAnimalName(c.subType))}</div>
                            <div class="herd-count">× ${num(c.numAnimals)}</div>
                            <div class="herd-age">${t('barnAge').replace('{m}', c.age)}</div>
                            <div class="herd-health" title="${t('hubHealth')}: ${h}%">
                                <div class="pen-bar-track"><div class="pen-bar-fill ${hClass}" style="width:${Math.max(2, h)}%"></div></div>
                                <span>${h}%</span>
                            </div>
                            ${reproStatusHtml(c, reproductionStatus(c), clusterLactationMilk(farm, animalTypeOf(c.subType), c))}
                        </div>
                    </div>`;
                });
                card += `</div></section>`;

                card += `<div class="barn-columns">`;

                // --- Feed trough: level, capacity, days left, ration ---
                card += `<section class="barn-panel barn-panel--feed">
                    <h4 class="barn-section-title">${t('hubFeedLevel')}</h4>`;
                if (building.food.length > 0) {
                    // Multiple feed ingredients (e.g. grass windrow + forage)
                    // share one trough, so they're combined into one gauge.
                    const feedTypesLabel = building.food.map(f => formatFillType(f.fillType)).join(' + ');
                    if (!(combinedCap > 0)) anyMissingCapacity = true;
                    const { pct, cls: barClass, title: barTitle } = gauge;
                    const daysLeft = gauge.days;
                    const daysClass = daysLeft === null ? '' : (daysLeft < 3 ? 'feed-days--critical' : (daysLeft < 7 ? 'feed-days--warning' : 'feed-days--ok'));

                    card += `<div class="feed-headline">
                            <div class="feed-amount">
                                <span class="feed-amount-value">${num(combinedFoodLevel)} l</span>
                                <span class="feed-amount-types">${escapeHtml(feedTypesLabel)}</span>
                            </div>
                            ${daysLeft !== null ? `<div class="feed-days ${daysClass}"><span class="feed-days-value">${Math.max(0, Math.floor(daysLeft))}</span><span class="feed-days-label">${t('barnDaysLeft')}</span></div>` : ''}
                        </div>
                        <div class="feed-gauge"${barTitle ? ` title="${escapeHtml(barTitle)}"` : ''}>
                            <div class="pen-bar-track"><div class="pen-bar-fill ${barClass}" style="width:${pct}%"></div></div>
                            ${combinedCap ? `<span class="feed-gauge-pct">${Math.round((combinedFoodLevel / combinedCap) * 100)}%</span>` : ''}
                        </div>
                        <label class="feed-capacity">
                            <span>${t('barnTroughCapacity')}</span>
                            <input type="text" class="feed-capacity-input" value="${combinedCap || ''}" placeholder="?"
                                data-building="${building.id}" data-filltype="${ANIMAL_FEED_CAPACITY_KEY}"
                                onchange="updateBuildingCapacity(this)">
                            <span>l</span>
                        </label>`;
                } else {
                    card += `<p class="barn-empty">${t('hubNoFeedTracked')}</p>`;
                }

                // Chosen ration per species in this building: picker + the
                // daily need split into its ingredients, with how long the
                // farm's stock of each ingredient lasts.
                Object.keys(foodByType).forEach(animalType => {
                    const ration = resolveRation(animalType, feedPlan, building.id);
                    if (!ration) return;
                    const parts = {};
                    splitByRecipe(foodByType[animalType], ration, parts);
                    card += `<div class="barn-subtitle">${t('hubRation')}${Object.keys(foodByType).length > 1 ? ' · ' + t('feedAnimal_' + animalType) : ''}</div>
                        <select class="pen-ration-select barn-ration-select" data-type="${animalType}" data-barn="${escapeHtml(String(building.id))}">${feedRationOptionsHtml(animalType, feedPlan, ration.id)}</select>
                        <div class="ration-list">`;
                    Object.keys(parts).filter(cat => parts[cat] > 0).forEach(cat => {
                        const stockL = feedStockCat[cat] || 0;
                        const days = farmDailyByCat[cat] > 0 ? stockL / farmDailyByCat[cat] : 0;
                        const cls = days < 3 ? 'feed-days--critical' : (days < 7 ? 'feed-days--warning' : 'feed-days--ok');
                        const stockNote = farm.feedStock
                            ? `<span class="ration-stock ${cls}">${stockL > 0 ? t('hubRationStockDays').replace('{d}', Math.floor(days).toLocaleString(FIN_LOCALE())) : t('hubRationNoStock')}</span>`
                            : '';
                        card += `<div class="ration-item">
                            <span class="ration-name">${feedCategoryLabel(cat)}</span>
                            <span class="ration-rate">${num(parts[cat])} l${t('perDayShort')}</span>
                            ${stockNote}
                        </div>`;
                    });
                    card += `</div>`;
                });
                card += `</section>`;

                // --- Daily need ---
                card += `<section class="barn-panel barn-panel--need">
                    <h4 class="barn-section-title">${t('hubDailyNeed')}</h4>`;
                if (needsKnownForAll && (dailyNeed.food > 0 || dailyNeed.water > 0 || dailyNeed.straw > 0)) {
                    card += `<div class="barn-stat-list">`;
                    if (dailyNeed.food > 0) card += statRow('FOOD', formatFillType('FOOD'), `${num(dailyNeed.food)} l${t('perDayShort')}`);
                    if (dailyNeed.water > 0) card += statRow('WATER', formatFillType('WATER'), `${num(dailyNeed.water)} l${t('perDayShort')}`);
                    if (dailyNeed.straw > 0) card += statRow('STRAW', formatFillType('STRAW'), `${num(dailyNeed.straw)} l${t('perDayShort')}`);
                    card += `</div>`;
                } else {
                    card += `<p class="barn-empty">${t('barnNeedsUnknown')}</p>`;
                }
                card += `</section>`;

                // --- Reproduction: pregnant / ready / too young, next birth ---
                const repro = barnReproSummary(building);
                if (repro) {
                    const reproRow = (icon, tone, label, value) => `
                        <div class="barn-stat">
                            <span class="barn-stat-icon barn-stat-icon--${tone}" aria-hidden="true"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
                            <span class="barn-stat-label">${label}</span>
                            <span class="barn-stat-value">${value}</span>
                        </div>`;
                    card += `<section class="barn-panel barn-panel--repro">
                        <h4 class="barn-section-title">${t('barnReproduction')}</h4>`;
                    if (repro.pregnant > 0) {
                        card += `<div class="repro-headline">
                            <div class="feed-amount">
                                <span class="feed-amount-value">${num(repro.pregnant)} / ${num(repro.females)}</span>
                                <span class="feed-amount-types">${t('reproPregnantOf')}</span>
                            </div>
                            ${repro.nextBirth !== null ? `<div class="feed-days repro-due"><span class="feed-days-value">${repro.nextBirth <= 0 ? '0' : '~' + repro.nextBirth}</span><span class="feed-days-label">${t('reproMonthsToBirth')}</span></div>` : ''}
                        </div>`;
                    }
                    card += `<div class="barn-stat-list">`;
                    card += reproRow('fa-baby-carriage', 'repro', t('reproPregnant'), num(repro.pregnant));
                    if (repro.ready) card += reproRow('fa-circle-check', 'product', t('repro_ready'), num(repro.ready));
                    if (repro.waiting) card += reproRow('fa-circle-pause', 'feed', t('repro_waiting'), num(repro.waiting));
                    if (repro.young) card += reproRow('fa-hourglass-half', 'water', t('reproTooYoung'), num(repro.young));
                    card += `</div>`;
                    if (repro.waiting) card += `<p class="barn-empty">${t('reproWaitingHint')}</p>`;
                    card += `</section>`;
                }

                // --- Estimated daily output ---
                if (Object.keys(dailyOutput).length > 0) {
                    card += `<section class="barn-panel barn-panel--output">
                        <h4 class="barn-section-title">${t('hubEstDailyOutput')}</h4>
                        <div class="barn-stat-list">`;
                    Object.keys(dailyOutput).forEach(fillType => {
                        card += statRow(fillType, formatFillType(fillType), `${num(dailyOutput[fillType])} l${t('perDayShort')}`);
                    });
                    card += `</div></section>`;
                }

                // --- Stored in the building right now ---
                if (building.production.length > 0) {
                    card += `<section class="barn-panel barn-panel--stored">
                        <h4 class="barn-section-title">${t('hubStoredProduction')}</h4>
                        <div class="barn-stat-list">`;
                    building.production.forEach(p => {
                        card += statRow(p.fillType, formatFillType(p.fillType), `${num(p.level)} l`);
                    });
                    card += `</div></section>`;
                }

                card += `</div>`; // .barn-columns
                card += `</div>`; // .pen-card
                cards[building.id] = card;
                summaries[building.id] = { lowFeed, noFeedAtAll, combinedFoodLevel, combinedCap,
                    dailyFood: needsKnownForAll ? dailyNeed.food : 0, maxCombinedFood };
            });

            if (!buildings.some(b => b.id === animalSelectedBuilding)) animalSelectedBuilding = null;
            const selected = buildings.find(b => b.id === animalSelectedBuilding);
            let html = '';

            if (selected) {
                // --- One barn, full detail ---
                html += `<div class="barn-detail-bar">
                    <button type="button" class="barn-back-btn"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> ${t('barnAllBuildings')}</button>
                </div>`;
                html += cards[selected.id];

                // How the numbers are worked out — folded away so the card stays readable.
                const notes = [];
                if (anyMissingCapacity) notes.push(t('hubApproxLevelsNote'));
                if (hasAnyNeedsData) notes.push(t(anyProductionFound ? 'hubProductionEstNote' : 'hubNoProductionCurves'));
                notes.push(t('hubRationNote'));
                html += `<details class="barn-notes">
                    <summary><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ${t('barnHowCalculated')}</summary>
                    <ul>${notes.map(n => `<li>${n}</li>`).join('')}</ul>
                </details>`;
            } else {
                // --- Overview: one clickable tile per barn ---
                html += animalsKpisHtml(farm, buildings, monthlyAnim, summaries);
                html += `<h4 class="anim-section-title">${t('animBuildings')}</h4><div class="barn-tile-grid">`;
                buildings.forEach(building => {
                    const sum = summaries[building.id];
                    const warn = sum.lowFeed || sum.noFeedAtAll;

                    // Head count per species, with the same icons as the Feed planner.
                    const heads = {};
                    building.clusters.forEach(c => {
                        const type = animalTypeOf(c.subType) || '';
                        heads[type] = (heads[type] || 0) + c.numAnimals;
                    });
                    const health = avgHealthFromBuildings([building]);
                    const speciesHtml = Object.keys(heads).map(type =>
                        `<span class="barn-tile-species"><i class="fa-solid ${FEED_ANIMAL_ICONS[type] || 'fa-paw'}" aria-hidden="true"></i> ${type ? t('feedAnimal_' + type) : t('hubAnimals')} × ${heads[type].toLocaleString(FIN_LOCALE())}</span>`).join('');

                    let feedHtml;
                    if (sum.noFeedAtAll) {
                        feedHtml = `<span class="barn-tile-feed-note">${t('hubNoFeedTracked')}</span>`;
                    } else {
                        const { pct, cls: barClass, title: barTitle } = feedGauge(sum.combinedFoodLevel, sum.combinedCap, sum.dailyFood, sum.maxCombinedFood);
                        const days = sum.dailyFood > 0 ? Math.max(0, Math.floor(sum.combinedFoodLevel / sum.dailyFood)) : null;
                        const daysClass = days === null ? '' : (days < 3 ? 'pen-days-left--critical' : (days < 7 ? 'pen-days-left--warning' : ''));
                        feedHtml = `<div class="barn-tile-feed"${barTitle ? ` title="${escapeHtml(barTitle)}"` : ''}>
                                <div class="pen-bar-track"><div class="pen-bar-fill ${barClass}" style="width:${pct}%"></div></div>
                                <span class="barn-tile-feed-meta">
                                    <span>${Math.round(sum.combinedFoodLevel).toLocaleString(FIN_LOCALE())} l${sum.combinedCap ? ` / ${Math.round(sum.combinedCap).toLocaleString(FIN_LOCALE())} l` : ''}</span>
                                    ${days !== null ? `<span class="${daysClass}">${days} ${t('hubDaysRemaining')}</span>` : ''}
                                </span>
                            </div>`;
                    }

                    html += `<div class="barn-tile ${warn ? 'barn-tile--warning' : ''}" role="button" tabindex="0" data-building="${escapeHtml(String(building.id))}">
                        <div class="barn-tile-head">
                            ${animalPictureHtml(building.clusters.slice().sort((a, b) => b.numAnimals - a.numAnimals)[0], 'barn-tile-pic')}
                            ${barnNameHtml(farm, building, 'barn-tile-title')}
                        </div>
                        <div class="barn-tile-body">
                            ${speciesHtml}
                            ${health != null ? `<span class="barn-tile-health">${t('hubHealth')}: ${Math.round(health)}%</span>` : ''}
                            ${(() => {
                                const r = barnReproSummary(building);
                                if (!r || !r.pregnant) return '';
                                return `<span class="barn-tile-repro"><i class="fa-solid fa-baby-carriage" aria-hidden="true"></i> ${t('reproPregnant')}: ${r.pregnant.toLocaleString(FIN_LOCALE())}${r.nextBirth !== null ? ' · ' + reproDueText(r.nextBirth) : ''}</span>`;
                            })()}
                        </div>
                        <div class="barn-tile-section-label">${t('hubFeedLevel')}${warn ? `<span class="pen-warning-badge">${t('hubFeedLow')}</span>` : ''}</div>
                        ${feedHtml}
                        <span class="barn-tile-open">${t('barnOpenDetails')} <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></span>
                    </div>`;
                });
                html += `</div>`; // .barn-tile-grid
                html += breedNormsHtml(farm);
                html += animalsTrendsHtml(farm, monthlyAnim, animalHistory, trendWidth);
                html = `<div class="fin-view anim-view">${html}</div>`;
            }

            bodyEl.innerHTML = html;
            wireBarnPanel(bodyEl, farm);
            wireBreedNorms(bodyEl, farm);
            activateTrendCharts(bodyEl);

            bodyEl.querySelectorAll('.pen-ration-select').forEach(el => el.addEventListener('change', () => {
                if (el.value === '__new') { startNewCustomFeed(el.dataset.type, el.dataset.barn); return; }
                const plan = getFeedPlan(getCurrentFarm());
                setBarnRation(plan, el.dataset.barn, el.dataset.type, el.value);
                saveFeedPlan(plan);
                const scroll = modalEl ? modalEl.scrollTop : 0;
                openHubPanel('animals');
                if (modalEl) modalEl.scrollTop = scroll;
            }));
        }
    } else if (type === 'supplies') {
        renderSuppliesPanel(titleEl, bodyEl, modalEl);
    } else if (type === 'fieldsoil') {
        renderFieldSoilPanel(titleEl, bodyEl, modalEl);
    } else if (type === 'notes') {
        renderNotesPanel(titleEl, bodyEl, modalEl);
    } else if (type === 'yieldforecast') {
        renderYieldForecastPanel(titleEl, bodyEl, modalEl);
    } else if (type === 'rotation') {
        renderRotationPanel(titleEl, bodyEl);
    } else if (type === 'feedplan') {
        renderFeedPlanPanel(titleEl, bodyEl, modalEl);
    } else {
        return;
    }

    setActiveSidebarItem(type);
    if (plannerContentEl) plannerContentEl.style.display = 'none';
    if (hubView) hubView.hidden = false;
};

// Supplies, fertilization plan and supply rates: supplies.js (loaded before this file).

// Farm Hub → "Field soil type": one row per field of the current farm, a %
// input per PF soil type. Blanks mean 0; shares need not total 100 —
// fieldNRate() weights by their sum. Saved to rates.fieldSoil, keyed the same
// way computeSeasonSupplies keys fields (number, else idx-<i>), so the
// Supplies panel picks the mix up straight away.
function renderFieldSoilPanel(titleEl, bodyEl, modalEl) {
    titleEl.textContent = t('suppliesSoilPerField');

    const farm = getAllFarms().find(f => f.id === currentFarmId);
    const rates = getSupplyRates();
    const soils = soilTypeList();
    const fields = (farm && farm.fields) || [];

    const seen = new Set();
    const rows = [];
    fields.forEach((f, i) => {
        const number = (f.number || '').toString().trim();
        const key = number || ('idx-' + i);
        if (seen.has(key)) return;
        seen.add(key);
        if (!number && (parseFloat(f.area) || 0) <= 0) return;
        rows.push({ key, number: number || ('#' + (i + 1)) });
    });

    let html = `<p class="supply-intro">${t('suppliesSoilNote').replace('{d}', soilLabel(defaultSoilId()))}</p>`;

    if (!soils.length || !rows.length) {
        bodyEl.innerHTML = html + `<p class="hub-panel-note">${t('fieldSoilEmpty')}</p>`;
        return;
    }

    const hasSave = !!(farm && farm.saveGamePath);
    const pfOn = hasSave && modEnabled('precisionFarming');
    html += `<div class="field-soil-import">
            <button type="button" id="field-soil-import-btn" class="supply-fillplan-btn" ${pfOn ? '' : 'disabled'}>${t('fieldSoilImportBtn')}</button>
            <span class="field-soil-import-hint">${!hasSave ? t('fieldSoilImportNoPath') : (pfOn ? t('fieldSoilImportHint') : t('fieldSoilImportNoPf'))}</span>
        </div>`;
    if (fieldSoilImportMsg) {
        html += `<p class="hub-panel-note field-soil-import-msg">${fieldSoilImportMsg}</p>`;
        fieldSoilImportMsg = '';
    }

    const heads = soils.map(s => `<th>${soilLabel(s)}${typeof s.yieldPct === 'number' ? `<span class="supply-sub">${t('suppliesSoilYield').replace('{p}', s.yieldPct)}</span>` : ''}</th>`).join('');
    let body = '';
    rows.forEach(r => {
        const mix = (rates.fieldSoil && rates.fieldSoil[r.key]) || {};
        const cells = soils.map(s => {
            const v = (mix[s.id] !== undefined && mix[s.id] !== '' && !isNaN(mix[s.id])) ? mix[s.id] : '';
            return `<td><input type="number" min="0" max="100" step="5" class="supply-soil-input" data-soil-field="${r.key}" data-soil-type="${s.id}" value="${v}" placeholder="0"><span class="supply-unit">%</span></td>`;
        }).join('');
        const name = fieldNameOf(farm, r.number);
        body += `<tr><td>${escapeHtml(r.number)}${name ? `<span class="field-name">${escapeHtml(name)}</span>` : ''}</td>${cells}</tr>`;
    });

    html += `<table class="data-table supply-table supply-soil-table"><thead><tr>
            <th>${t('suppliesColField')}</th>${heads}</tr></thead>
            <tbody>${body}</tbody></table>
        <p class="hub-panel-note">${t('suppliesSoilFileNote')}</p>`;

    bodyEl.innerHTML = html;
    wireSoilInputs(bodyEl);

    const importBtn = bodyEl.querySelector('#field-soil-import-btn');
    if (importBtn) importBtn.addEventListener('click', () => {
        fieldSoilImportMsg = importFieldSoilFromGame(farm);
        openHubPanel('fieldsoil');
    });
}

// One-shot status line shown under the import button after the panel re-renders.
let fieldSoilImportMsg = '';

// "Load soils from the game": fills rates.fieldSoil for every field whose
// number(s) exist on the map. A combined field ("168-169", "69-70-71") gets
// the pixel-weighted mix of its parts. Returns the status line (HTML-safe text).
function importFieldSoilFromGame(farm) {
    const res = readFieldSoilFromSave(farm && farm.saveGamePath);
    if (!res.ok) {
        const reasons = t('fieldSoilImportReasons') || {};
        const why = (reasons[res.reason] || res.reason).replace('{mod}', res.modName || '');
        return t('fieldSoilImportFail').replace('{reason}', escapeHtml(why));
    }

    const soilIds = soilTypeList().map(s => s.id);   // PF soilTypeIndex order
    const rates = getSupplyRates();
    if (!rates.fieldSoil) rates.fieldSoil = {};

    // Area per field key as entered in the season table (split rows summed).
    const areaByKey = {};
    (farm.fields || []).forEach((f, i) => {
        const key = fertPlanSoilKey(f, i);
        areaByKey[key] = (areaByKey[key] || 0) + (parseFloat(f.area) || 0);
    });

    let filled = 0;
    const missing = [], areaOff = [];
    Object.keys(areaByKey).forEach(key => {
        const ids = key.split(/[^0-9]+/).filter(Boolean).map(s => String(parseInt(s, 10)));
        if (!ids.length) return;
        const parts = ids.map(id => res.fields[id]);
        if (parts.some(p => !p)) { missing.push(key); return; }

        const counts = [0, 0, 0, 0];
        let ha = 0;
        parts.forEach(p => { p.counts.forEach((c, i) => { counts[i] += c; }); ha += p.ha; });
        const total = counts.reduce((s, c) => s + c, 0);
        if (!total) { missing.push(key); return; }

        const mix = {};
        counts.forEach((c, i) => {
            const pct = Math.round(100 * c / total);
            if (pct > 0 && soilIds[i]) mix[soilIds[i]] = pct;
        });
        rates.fieldSoil[key] = mix;
        filled++;

        const entered = areaByKey[key];
        if (entered > 0 && Math.abs(entered - ha) / ha > 0.1) {
            areaOff.push(`${key} (${entered.toFixed(2)} ≠ ${ha.toFixed(2)} ha)`);
        }
    });
    saveSupplyRates(rates);

    let msg = t('fieldSoilImportDone').replace('{n}', filled).replace('{map}', escapeHtml(res.mapTitle || res.modName || ''));
    if (missing.length) msg += ' ' + t('fieldSoilImportMissing').replace('{list}', escapeHtml(missing.join(', ')));
    if (areaOff.length) msg += ' ' + t('fieldSoilImportArea').replace('{list}', escapeHtml(areaOff.join(', ')));
    return msg;
}

// Farm Hub → "Predicted yields": every crop planned in a season, aggregated
// across fields, with a predicted harvest in litres assuming ideal N, ideal
// pH and no weeds. Opens on the season shown in the planner; the arrows step
// through the archived seasons.
function renderYieldForecastPanel(titleEl, bodyEl, modalEl, season = viewedSeason) {
    titleEl.textContent = t('yieldForecastTitle');

    const farm = getAllFarms().find(f => f.id === currentFarmId);
    if (!farm) { bodyEl.innerHTML = `<p class="hub-panel-note">${t('suppliesNoCrops')}</p>`; return; }

    const currentSeason = parseInt(farm.currentSeason) || 1;
    season = Math.min(Math.max(1, parseInt(season) || currentSeason), currentSeason);
    const isPast = season < currentSeason;

    const rates = getSupplyRates();
    const data = buildYieldForecastRows(loadSeasonFields(farm, season), rates, isPast ? null : farm);
    const showMoisture = !isPast && !!MOISTURE_DATA;
    const num = n => Math.round(n).toLocaleString(FIN_LOCALE());

    const arrow = (dir, enabled) => enabled
        ? `<button type="button" class="yield-season-arrow" data-season="${season + dir}" aria-label="${t('season')} ${season + dir}"><i class="fa-solid fa-chevron-${dir < 0 ? 'left' : 'right'}" aria-hidden="true"></i></button>`
        : `<span class="yield-season-arrow is-disabled" aria-hidden="true"><i class="fa-solid fa-chevron-${dir < 0 ? 'left' : 'right'}"></i></span>`;
    let html = `<div class="yield-season-nav">${arrow(-1, season > 1)}<span class="yield-season-label">${t('season')} ${season}</span>${arrow(1, season < currentSeason)}</div>`;
    html += `<p class="supply-intro">${isPast ? t('yieldForecastPastIntro').replace('{n}', season) : t('yieldForecastIntro')}</p>`;

    const wireArrows = () => bodyEl.querySelectorAll('.yield-season-arrow[data-season]').forEach(btn => {
        btn.addEventListener('click', () => renderYieldForecastPanel(titleEl, bodyEl, modalEl, parseInt(btn.dataset.season)));
    });

    if (!data.rows.length) {
        bodyEl.innerHTML = html + `<p class="hub-panel-note">${t('yieldForecastEmpty')}</p>`;
        wireArrows();
        return;
    }

    html += `<table class="data-table supply-table"><thead><tr>
        <th>${t('yieldForecastColCrop')}</th><th>${t('yieldForecastColArea')}</th>${showMoisture ? `<th>${t('yieldForecastColMoisture')}</th>` : ''}<th>${t('yieldForecastColYield')}</th>
        </tr></thead><tbody>`;
    data.rows.forEach(r => {
        const flag = r.known ? '' : ` <span class="supply-flag" title="${t('yieldForecastUnknownFlag')}">?</span>`;
        const m = r.moisture;
        const moistureCell = !showMoisture ? ''
            : `<td class="moisture-cell">${m ? moistureCellHtml(m.sum / m.area, m.def, m.nowArea ? m.nowFactor / m.nowArea : 1, m.nowArea > 0) : '–'}</td>`;
        html += `<tr><td>${translateCropName(r.crop)}${flag}</td>
            <td>${r.area.toFixed(2)} ha</td>${moistureCell}
            <td>${num(r.litres)} l</td></tr>`;
    });
    html += `</tbody><tfoot><tr class="supply-total-row">
        <td colspan="${showMoisture ? 3 : 2}">${t('suppliesTotal')}</td><td>${num(data.total)} l</td></tr></tfoot></table>`;

    if (data.missingCount > 0) {
        html += `<p class="hub-panel-note">${t('yieldForecastUnknownNote').replace('{n}', data.missingCount)}</p>`;
    }
    html += `<p class="hub-panel-note">${t('yieldForecastNote')}</p>`;
    if (showMoisture) html += `<p class="hub-panel-note">${t('yieldMoistureNote')}</p>`;

    bodyEl.innerHTML = html;
    wireArrows();
}

// Feed planner, feed mixers and the mixer wagon: feed.js (loaded before this file).

// Shared change-handler wiring for the .supply-soil-input % boxes.
function wireSoilInputs(bodyEl) {
    bodyEl.querySelectorAll('.supply-soil-input').forEach(inp => {
        inp.addEventListener('change', () => {
            const r = getSupplyRates();
            if (!r.fieldSoil) r.fieldSoil = {};
            const k = inp.dataset.soilField;
            const soil = inp.dataset.soilType;
            if (!r.fieldSoil[k]) r.fieldSoil[k] = {};
            const v = inp.value.trim();
            const n = parseFloat(v);
            if (v === '' || isNaN(n) || n <= 0) delete r.fieldSoil[k][soil];
            else r.fieldSoil[k][soil] = n;
            if (Object.keys(r.fieldSoil[k]).length === 0) delete r.fieldSoil[k];
            saveSupplyRates(r);
            rerenderKeepingFocus(() => openHubPanel('fieldsoil'));
        });
    });
}

// Re-renders a panel without losing the player's place. A change event fires
// while the edited input still has focus — Tab or a click moves it on only
// afterwards — so the redraw waits for that, then gives the focus and caret
// back to the input the player moved to (found again by its tag, first class
// and data-* attributes) and keeps the panel's scroll position.
function rerenderKeepingFocus(render, scroller = hubView) {
    setTimeout(() => {
        const el = document.activeElement;
        let sel = null, start = null, end = null;
        if (el && el !== document.body && el.matches('input, select, textarea, button')) {
            const data = Array.from(el.attributes).filter(a => a.name.startsWith('data-'))
                .map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
            sel = el.tagName.toLowerCase() + (el.classList[0] ? '.' + CSS.escape(el.classList[0]) : '') + data;
            try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { /* not a text input */ }
        }
        const scroll = scroller ? scroller.scrollTop : 0;
        render();
        if (scroller) scroller.scrollTop = scroll;
        const again = sel && document.querySelector(sel);
        if (!again) return;
        again.focus({ preventScroll: true });
        try { if (start != null) again.setSelectionRange(start, end); } catch (e) { /* not a text input */ }
    }, 0);
}

// Supplies, fertilization plan and supply rates: supplies.js (loaded before this file).

const saveSettingsBtn = document.getElementById('save-settings-btn');
const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
const gameSavePathInput = document.getElementById('game-save-path');
const browseSaveBtn = document.getElementById('browse-save-btn');
const settingsMapNameInput = document.getElementById('settings-map-name');
const autoSyncToggle = document.getElementById('auto-sync-toggle');
const autoSyncToast = document.getElementById('auto-sync-toast');
const cropsFolderInput = document.getElementById('crops-folder-path');
const browseCropsBtn = document.getElementById('browse-crops-btn');
const cropsFolderPicker = document.getElementById('crops-folder-picker');
const cropsLoadedInfo = document.getElementById('crops-loaded-info');
const animalDefsFolderInput = document.getElementById('animal-defs-folder-path');
const browseAnimalDefsBtn = document.getElementById('browse-animal-defs-btn');
const animalDefsFolderPicker = document.getElementById('animal-defs-folder-picker');
const animalDefsLoadedInfo = document.getElementById('animal-defs-loaded-info');

const plannerTitle = document.getElementById('planner-farm-name');
const plannerBalance = document.getElementById('planner-balance');
const plannerMonth = document.getElementById('planner-month');
const plannerYear = document.getElementById('planner-year');
const exitBtn = document.getElementById('exit-btn');

// Year shown next to the month — not the same thing as farm.currentSeason
// (which drives NEW SEASON / field archiving). A synced farm takes it from the
// savegame in applyGameSaveToFarm (the input is read-only then); a farm without
// a save keeps this hand-edited counter.
if (plannerYear) {
    plannerYear.addEventListener('change', () => {
        const farm = getCurrentFarm();
        if (!farm || farm.saveGamePath) return;
        const n = Math.max(1, parseInt(plannerYear.value, 10) || 1);
        plannerYear.value = n;
        farm.yearNumber = n;
        saveFarmData(farm);
    });
}

const editSeasonBtn = document.getElementById('edit-season-btn');
const newSeasonBtn = document.querySelector('.new-season-btn');
const seasonNumberEl = document.querySelector('.season-number');
const fieldsBody = document.getElementById('fields-body');
const fieldsTable = document.getElementById('fields-table');
const totalSumEl = document.getElementById('total-ha-sum');


const cropsBody = document.getElementById('crops-body');

// =============================================================
// SECTION 2B: NOTES (reminders per month, tags, checklist)
// =============================================================
// Notes are per-farm, stored in their own notes.json sibling to data.json/
// monthly.json (farmDir(), see Section 4) — a flat array, loaded whole and
// rewritten whole, same idiom as loadMonthlyHistory/saveMonthlyHistory.
// Rendered inside the existing generic hub-panel-modal (openHubPanel('notes')),
// with a small dedicated modal (#note-edit-modal) for adding/editing one note.

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function notesPath(farm) {
    if (!farm) return null;
    return path.join(farmDir(farm), 'notes.json');
}

function loadNotes(farm) {
    const p = notesPath(farm);
    if (!p || !fs.existsSync(p)) return [];
    let arr;
    try {
        arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (err) {
        return []; // corrupt file — start fresh rather than break the panel
    }
    if (!Array.isArray(arr)) return [];
    // Ticks saved before checklists reset yearly count as made this year.
    const year = farmGameYear(farm);
    let migrated = false;
    arr.forEach(n => (n.checklist || []).forEach(c => {
        if (c.done && c.doneYear == null) { c.doneYear = year; migrated = true; }
    }));
    if (migrated) saveNotes(farm, arr);
    return arr;
}

// Notes repeat every year (they're pinned to months), so a checklist tick only
// counts in the in-game year it was made; next year the list starts over.
function farmGameYear(farm) {
    return parseInt(farm && farm.yearNumber, 10) || 1;
}

function checklistItemDone(item, year) {
    return !!item.done && item.doneYear === year;
}

// A note pinned to "12" also belongs to field "12-13" and the other way round.
function noteHasField(note, number) {
    const ids = s => String(s || '').split(/[^0-9]+/).filter(Boolean).map(x => String(parseInt(x, 10)));
    const wanted = ids(number);
    return (note.fields || []).some(f => f === number || ids(f).some(id => wanted.includes(id)));
}

function noteFieldLabel(farm, number) {
    const name = fieldNameOf(farm, number);
    return t('fieldViewTitle').replace('{field}', number) + (name ? ' · ' + name : '');
}

function saveNotes(farm, notes) {
    const p = notesPath(farm);
    if (!p) return;
    try { fs.writeFileSync(p, JSON.stringify(notes, null, 2), 'utf-8'); }
    catch (err) { console.error('Could not write notes:', err); }
    if (farm.id === currentFarmId) { refreshNotesBadge(farm); renderTodayPanel(); }
}

function generateNoteId() {
    return 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// The in-game month currently shown for this farm — the same one as in the
// header (farm.month, set by hand or by the save), so notes know it even
// without a savegame. The monthly history log (Section 4A) is only a fallback.
function getFarmCurrentMonth(farm) {
    if (farm && farm.month) return String(farm.month).toUpperCase();
    const rows = loadMonthlyHistory(farm);
    const last = rows[rows.length - 1];
    return last ? last.month : null;
}

// Deterministic color per tag string (same tag always gets the same swatch),
// picked from the app's own earthy palette so tags never clash with it.
const NOTE_TAG_PALETTE = ['#3F6B44', '#C97A2B', '#3E7089', '#A6452B', '#6B7B3F', '#7A5C3E'];
function noteTagColor(tag) {
    const s = String(tag);
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return NOTE_TAG_PALETTE[hash % NOTE_TAG_PALETTE.length];
}

function noteAllTags(notes) {
    const set = new Set();
    notes.forEach(n => (n.tags || []).forEach(tg => set.add(tg)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function renderNoteCard(note, currentMonth) {
    const isCurrent = !!(currentMonth && (note.months || []).includes(currentMonth));
    const monthsHtml = (note.months || []).map(m =>
        `<span class="note-month-chip${m === currentMonth ? ' note-month-chip--current' : ''}">${translateMonth(m)}</span>`
    ).join('');
    // Tags filter the list on click (see wireNotesPanel).
    const tagsHtml = (note.tags || []).map(tg =>
        `<button type="button" class="note-tag-chip note-tag-filter" data-tag="${escapeHtml(tg)}" title="${t('notesFilterByTag')}" style="--tag-color:${noteTagColor(tg)}">${escapeHtml(tg)}</button>`
    ).join('');

    const farm = getCurrentFarm();
    const fieldsHtml = (note.fields || []).map(num =>
        `<button type="button" class="note-month-chip note-field-chip note-field-filter" data-field="${escapeHtml(num)}" title="${t('notesFilterByField')}">${escapeHtml(noteFieldLabel(farm, num))}</button>`
    ).join('');

    const year = farmGameYear(farm);
    const checklist = note.checklist || [];
    const doneCount = checklist.filter(c => checklistItemDone(c, year)).length;
    const checklistHtml = checklist.length ? `
        <div class="note-checklist">
            <div class="note-checklist-progress">${doneCount}/${checklist.length}</div>
            ${checklist.map((item, idx) => `
                <label class="note-checklist-item">
                    <input type="checkbox" ${checklistItemDone(item, year) ? 'checked' : ''} onchange="window.toggleNoteChecklistItem('${note.id}', ${idx}, this)">
                    <span class="${checklistItemDone(item, year) ? 'is-done' : ''}">${escapeHtml(item.text)}</span>
                </label>`).join('')}
        </div>` : '';

    // Collapsed: title, months, tags and the checklist count. Click the title
    // row to unfold the text and checklist. Which start open is an app setting
    // (notesOpenMode): this month's notes (default), all, or none.
    const mode = notesOpenMode();
    const startsOpen = mode === 'open' || (mode === 'month' && isCurrent);
    const open = noteOpenIds.has(note.id) || (startsOpen && !noteClosedIds.has(note.id));
    const hasDetails = !!(note.body || checklist.length);
    const summary = checklist.length ? `<span class="note-card-count">${doneCount}/${checklist.length}</span>` : '';
    return `
        <div class="note-card${isCurrent ? ' note-card--current-month' : ''}${open ? ' is-open' : ''}${hasDetails ? ' has-details' : ''}" data-note-id="${escapeHtml(note.id)}">
            <div class="note-card-header">
                <h4 class="note-card-title">${hasDetails ? '<i class="fa-solid fa-chevron-right note-card-caret" aria-hidden="true"></i>' : ''}${escapeHtml(note.title)}${open ? '' : summary}</h4>
                <div class="note-card-actions">
                    <button type="button" class="note-card-action" title="${t('notesEdit')}" data-note-action="edit"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                    <button type="button" class="note-card-action note-card-action--danger" title="${t('notesDelete')}" data-note-action="delete"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
                </div>
            </div>
            ${isCurrent ? `<span class="note-current-badge">${t('notesCurrentMonthBadge')}</span>` : ''}
            ${monthsHtml ? `<div class="note-chip-row">${monthsHtml}</div>` : ''}
            ${fieldsHtml ? `<div class="note-chip-row">${fieldsHtml}</div>` : ''}
            ${tagsHtml ? `<div class="note-chip-row">${tagsHtml}</div>` : ''}
            <div class="note-card-details">
                ${note.body ? `<p class="note-card-body">${escapeHtml(note.body)}</p>` : ''}
                ${checklistHtml}
            </div>
        </div>`;
}

// Notes unfolded / folded by hand in this session (by id), so a re-render of
// the list keeps them as they were.
const noteOpenIds = new Set();
const noteClosedIds = new Set();

const NOTES_OPEN_MODES = ['month', 'open', 'closed'];
function notesOpenMode() {
    const v = getSetting('notesOpenMode');
    return NOTES_OPEN_MODES.includes(v) ? v : 'month';
}

// The Notes item in the sidebar shows how many notes are pinned to the
// current in-game month (a badge that pulses once when it appears).
function refreshNotesBadge(farm) {
    const item = document.querySelector('#planner-sidebar .sidebar-item--notes');
    if (!item) return;
    const month = farm ? getFarmCurrentMonth(farm) : null;
    const n = month ? loadNotes(farm).filter(note => (note.months || []).includes(month)).length : 0;
    let badge = item.querySelector('.sidebar-badge');
    if (!n) { if (badge) badge.remove(); item.classList.remove('has-month-notes'); item.removeAttribute('title'); return; }
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'sidebar-badge';
        item.appendChild(badge);
    }
    badge.textContent = n;
    item.classList.add('has-month-notes');
    item.title = t('notesMonthBadge').replace('{n}', n).replace('{m}', translateMonth(month));
}

function renderNotesListHtml(notes, currentMonth, filterMonth, filterTag, filterField) {
    const filtered = notes.filter(n => {
        if (filterMonth && !(n.months || []).includes(filterMonth)) return false;
        if (filterTag && !(n.tags || []).includes(filterTag)) return false;
        if (filterField && !noteHasField(n, filterField)) return false;
        return true;
    }).sort((a, b) => {
        const aCur = (currentMonth && (a.months || []).includes(currentMonth)) ? 0 : 1;
        const bCur = (currentMonth && (b.months || []).includes(currentMonth)) ? 0 : 1;
        if (aCur !== bCur) return aCur - bCur;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return filtered.map(n => renderNoteCard(n, currentMonth)).join('');
}

function wireNotesPanel(bodyEl, notes, currentMonth) {
    const monthSel = bodyEl.querySelector('#notes-filter-month');
    const tagSel = bodyEl.querySelector('#notes-filter-tag');
    const fieldSel = bodyEl.querySelector('#notes-filter-field');
    const thisMonthBtn = bodyEl.querySelector('#notes-filter-thismonth');
    const listEl = bodyEl.querySelector('#notes-list');
    if (!listEl) return;

    const refresh = () => {
        listEl.innerHTML = renderNotesListHtml(
            notes, currentMonth,
            monthSel ? monthSel.value : '',
            tagSel ? tagSel.value : '',
            fieldSel ? fieldSel.value : ''
        );
    };
    if (monthSel) monthSel.addEventListener('change', refresh);
    if (tagSel) tagSel.addEventListener('change', refresh);
    if (fieldSel) fieldSel.addEventListener('change', refresh);
    listEl.addEventListener('click', e => {
        const tagBtn = e.target.closest('.note-tag-filter');
        if (tagBtn) {
            if (tagSel) { tagSel.value = tagSel.value === tagBtn.dataset.tag ? '' : tagBtn.dataset.tag; refresh(); }
            return;
        }
        const fieldBtn = e.target.closest('.note-field-filter');
        if (fieldBtn) {
            if (fieldSel) { fieldSel.value = fieldSel.value === fieldBtn.dataset.field ? '' : fieldBtn.dataset.field; refresh(); }
            return;
        }
        const actionBtn = e.target.closest('[data-note-action]');
        if (actionBtn) {
            const noteId = actionBtn.closest('.note-card').dataset.noteId;
            if (actionBtn.dataset.noteAction === 'edit') window.openNoteEditModal(noteId);
            else window.deleteNote(noteId);
            return;
        }
        if (e.target.closest('button, input, label')) return;
        const header = e.target.closest('.note-card-header');
        const card = header && header.closest('.note-card.has-details');
        if (!card) return;
        const id = card.dataset.noteId;
        const nowOpen = !card.classList.contains('is-open');
        if (nowOpen) { noteOpenIds.add(id); noteClosedIds.delete(id); }
        else { noteClosedIds.add(id); noteOpenIds.delete(id); }
        refresh();
    });
    if (thisMonthBtn) thisMonthBtn.addEventListener('click', () => {
        if (monthSel) monthSel.value = thisMonthBtn.dataset.month;
        refresh();
    });
}

// Farm Hub → "Notes": one list, filterable by month/tag, cards with an
// inline checklist. Add/Edit opens the separate #note-edit-modal.
function renderNotesPanel(titleEl, bodyEl, modalEl) {
    titleEl.textContent = t('notesTitle');

    const farm = getCurrentFarm();
    if (!farm) { bodyEl.innerHTML = `<p class="hub-panel-note">${t('notesEmpty')}</p>`; return; }

    const notes = loadNotes(farm);
    const currentMonth = getFarmCurrentMonth(farm);
    const allTags = noteAllTags(notes);

    const monthOptionsHtml = `<option value="">${t('notesAllMonths')}</option>` +
        ALL_MONTHS.map(m => `<option value="${m}">${translateMonth(m)}</option>`).join('');
    const tagOptionsHtml = `<option value="">${t('notesAllTags')}</option>` +
        allTags.map(tg => `<option value="${escapeHtml(tg)}">${escapeHtml(tg)}</option>`).join('');
    const noteFields = Array.from(new Set(notes.flatMap(n => n.fields || [])))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const fieldOptionsHtml = `<option value="">${t('notesAllFields')}</option>` +
        noteFields.map(num => `<option value="${escapeHtml(num)}">${escapeHtml(noteFieldLabel(farm, num))}</option>`).join('');

    bodyEl.innerHTML = `
        <div class="notes-toolbar">
            <button type="button" class="notes-add-btn" onclick="window.openNoteEditModal(null)">${t('notesAdd')}</button>
            <select id="notes-filter-month" class="notes-filter-select">${monthOptionsHtml}</select>
            ${allTags.length ? `<select id="notes-filter-tag" class="notes-filter-select">${tagOptionsHtml}</select>` : ''}
            ${noteFields.length ? `<select id="notes-filter-field" class="notes-filter-select">${fieldOptionsHtml}</select>` : ''}
            ${currentMonth ? `<button type="button" id="notes-filter-thismonth" class="notes-filter-thismonth-btn" data-month="${currentMonth}">${t('notesThisMonthFilter')}</button>` : ''}
            <select id="notes-open-mode" class="notes-filter-select" title="${t('notesOpenModeHint')}">
                ${NOTES_OPEN_MODES.map(m => `<option value="${m}" ${m === notesOpenMode() ? 'selected' : ''}>${t('notesOpenMode_' + m)}</option>`).join('')}
            </select>
        </div>
        <div id="notes-list" class="notes-list" data-empty-text="${escapeHtml(t('notesEmpty'))}">${renderNotesListHtml(notes, currentMonth, '', '')}</div>`;

    wireNotesPanel(bodyEl, notes, currentMonth);
    const openMode = document.getElementById('notes-open-mode');
    if (openMode) openMode.addEventListener('change', () => {
        setSetting('notesOpenMode', openMode.value);
        noteOpenIds.clear();
        noteClosedIds.clear();
        showPlannerView('notes');
    });
}

window.deleteNote = async function (noteId) {
    const sure = await showConfirm({ title: t('notesDeleteTitle'), body: t('notesDeleteConfirm'), confirmText: t('delete'), danger: true });
    if (sure !== true) return;
    const farm = getCurrentFarm();
    if (!farm) return;
    saveNotes(farm, loadNotes(farm).filter(n => n.id !== noteId));
    openHubPanel('notes');
};

// Patches the DOM in place (progress count + strikethrough) instead of a full
// panel re-render, so the filter selects and scroll position aren't reset for
// what's otherwise a one-click tick.
window.toggleNoteChecklistItem = function (noteId, itemIndex, checkboxEl) {
    const farm = getCurrentFarm();
    if (!farm) return;
    const notes = loadNotes(farm);
    const note = notes.find(n => n.id === noteId);
    if (!note || !note.checklist || !note.checklist[itemIndex]) return;

    const year = farmGameYear(farm);
    const item = note.checklist[itemIndex];
    item.done = !!(checkboxEl && checkboxEl.checked);
    if (item.done) item.doneYear = year;
    else delete item.doneYear;
    note.updatedAt = new Date().toISOString();
    saveNotes(farm, notes);

    if (checkboxEl) {
        const row = checkboxEl.closest('.note-checklist-item');
        const label = row ? row.querySelector('span') : null;
        if (label) label.classList.toggle('is-done', item.done);
        const card = checkboxEl.closest('.note-card');
        const progress = card ? card.querySelector('.note-checklist-progress') : null;
        if (progress) progress.textContent = `${note.checklist.filter(c => checklistItemDone(c, year)).length}/${note.checklist.length}`;
    }
};

// --- Note add/edit modal ---
// noteEditState holds the tags/checklist being edited (not yet saved) — the
// two dynamic, add/remove-able lists in the form. Title/body/months are read
// straight from their inputs at save time, no intermediate state needed.
let noteEditState = null;

function renderNoteEditTags() {
    const el = document.getElementById('note-edit-tags');
    if (!el || !noteEditState) return;
    el.innerHTML = noteEditState.tags.map((tg, idx) => `
        <span class="note-tag-chip" style="--tag-color:${noteTagColor(tg)}">${escapeHtml(tg)}
            <button type="button" class="note-tag-chip-remove" data-idx="${idx}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </span>`).join('');
    el.querySelectorAll('.note-tag-chip-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            noteEditState.tags.splice(Number(btn.dataset.idx), 1);
            renderNoteEditTags();
        });
    });
}

// Rebuilds noteEditState.checklist from the live inputs first, so an add/remove
// elsewhere in the list never discards text the user already typed in a row.
function syncChecklistStateFromDom() {
    if (!noteEditState) return;
    const rows = document.querySelectorAll('#note-edit-checklist .note-edit-checklist-row');
    noteEditState.checklist = Array.from(rows).map(row => ({
        text: row.querySelector('.note-edit-checklist-text').value,
        done: row.querySelector('.note-edit-checklist-done').checked
    }));
}

function renderNoteEditChecklist() {
    const el = document.getElementById('note-edit-checklist');
    if (!el || !noteEditState) return;
    el.innerHTML = noteEditState.checklist.map((item, idx) => `
        <div class="note-edit-checklist-row" data-idx="${idx}">
            <input type="checkbox" class="note-edit-checklist-done" ${item.done ? 'checked' : ''}>
            <input type="text" class="note-edit-checklist-text" value="${escapeHtml(item.text)}" placeholder="${escapeHtml(t('notesChecklistItemPlaceholder'))}">
            <button type="button" class="note-edit-checklist-remove" data-idx="${idx}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>`).join('');
    el.querySelectorAll('.note-edit-checklist-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            syncChecklistStateFromDom();
            noteEditState.checklist.splice(Number(btn.dataset.idx), 1);
            renderNoteEditChecklist();
        });
    });
}

window.openNoteEditModal = function (noteId) {
    const farm = getCurrentFarm();
    if (!farm) return;
    const existing = noteId ? loadNotes(farm).find(n => n.id === noteId) : null;
    const year = farmGameYear(farm);

    noteEditState = {
        id: existing ? existing.id : null,
        tags: existing ? (existing.tags || []).slice() : [],
        checklist: existing ? (existing.checklist || []).map(c => ({ text: c.text || '', done: checklistItemDone(c, year) })) : []
    };

    // Fields to pin the note to: every number in the current season, plus any
    // the note already has (a field since renumbered or removed stays listed).
    const existingFields = existing ? (existing.fields || []) : [];
    const numbers = Array.from(new Set((farm.fields || []).map(f => (f.number || '').toString().trim()).filter(Boolean).concat(existingFields)))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const fieldsEl = document.getElementById('note-edit-fields');
    if (fieldsEl) {
        fieldsEl.innerHTML = numbers.length
            ? numbers.map(num => `
                <label class="note-edit-month-option">
                    <input type="checkbox" value="${escapeHtml(num)}" ${existingFields.includes(num) ? 'checked' : ''}>
                    <span>${escapeHtml(noteFieldLabel(farm, num))}</span>
                </label>`).join('')
            : `<p class="settings-hint">${t('notesFieldsNone')}</p>`;
    }

    const titleEl = document.getElementById('note-edit-modal-title');
    if (titleEl) titleEl.textContent = existing ? t('notesEditTitle') : t('notesNewTitle');

    const titleInput = document.getElementById('note-edit-title');
    if (titleInput) titleInput.value = existing ? (existing.title || '') : '';
    const bodyInput = document.getElementById('note-edit-body');
    if (bodyInput) bodyInput.value = existing ? (existing.body || '') : '';

    const existingMonths = existing ? (existing.months || []) : [];
    const monthsEl = document.getElementById('note-edit-months');
    if (monthsEl) {
        monthsEl.innerHTML = ALL_MONTHS.map(m => `
            <label class="note-edit-month-option">
                <input type="checkbox" value="${m}" ${existingMonths.includes(m) ? 'checked' : ''}>
                <span>${translateMonth(m)}</span>
            </label>`).join('');
    }

    const tagInput = document.getElementById('note-edit-tag-input');
    if (tagInput) tagInput.value = '';

    renderNoteEditTags();
    renderNoteEditChecklist();

    openModal(document.getElementById('note-edit-modal'));
};

function closeNoteEditModal() {
    closeModal(document.getElementById('note-edit-modal'));
    noteEditState = null;
    openHubPanel('notes');
}

const noteEditTagInput = document.getElementById('note-edit-tag-input');

// Adds whatever is in the tag box (comma-separated allowed) to the note.
function commitNoteTagInput() {
    if (!noteEditTagInput || !noteEditState) return;
    noteEditTagInput.value.split(',').map(v => v.trim()).filter(Boolean).forEach(val => {
        if (!noteEditState.tags.includes(val)) noteEditState.tags.push(val);
    });
    noteEditTagInput.value = '';
    renderNoteEditTags();
}

if (noteEditTagInput) {
    noteEditTagInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ',') return;
        e.preventDefault();
        commitNoteTagInput();
    });
    noteEditTagInput.addEventListener('blur', commitNoteTagInput);
}

const noteEditAddItemBtn = document.getElementById('note-edit-add-item-btn');
if (noteEditAddItemBtn) {
    noteEditAddItemBtn.addEventListener('click', () => {
        if (!noteEditState) return;
        syncChecklistStateFromDom();
        noteEditState.checklist.push({ text: '', done: false });
        renderNoteEditChecklist();
        const inputs = document.querySelectorAll('#note-edit-checklist .note-edit-checklist-text');
        if (inputs.length) inputs[inputs.length - 1].focus();
    });
}

const noteEditCancelBtn = document.getElementById('note-edit-cancel-btn');
if (noteEditCancelBtn) noteEditCancelBtn.addEventListener('click', closeNoteEditModal);

const noteEditSaveBtn = document.getElementById('note-edit-save-btn');
if (noteEditSaveBtn) {
    noteEditSaveBtn.addEventListener('click', () => {
        const farm = getCurrentFarm();
        if (!farm || !noteEditState) return;

        const titleInput = document.getElementById('note-edit-title');
        const title = (titleInput ? titleInput.value : '').trim();
        if (!title) { showNotice(t('notesTitleLabel'), t('notesNoTitle'), true); return; }

        const bodyInput = document.getElementById('note-edit-body');
        const body = (bodyInput ? bodyInput.value : '').trim();

        const months = Array.from(document.querySelectorAll('#note-edit-months input[type="checkbox"]:checked')).map(cb => cb.value);
        const fields = Array.from(document.querySelectorAll('#note-edit-fields input[type="checkbox"]:checked')).map(cb => cb.value);

        // A tag typed but not confirmed with Enter is still meant to be saved.
        commitNoteTagInput();

        syncChecklistStateFromDom();
        const year = farmGameYear(farm);
        const checklist = noteEditState.checklist
            .map(c => ({ text: (c.text || '').trim(), done: !!c.done, ...(c.done ? { doneYear: year } : {}) }))
            .filter(c => c.text);

        const notes = loadNotes(farm);
        const now = new Date().toISOString();

        if (noteEditState.id) {
            const note = notes.find(n => n.id === noteEditState.id);
            if (note) {
                note.title = title;
                note.body = body;
                note.months = months;
                note.fields = fields;
                note.tags = noteEditState.tags.slice();
                note.checklist = checklist;
                note.updatedAt = now;
            }
        } else {
            notes.push({
                id: generateNoteId(),
                title, body, months, fields,
                tags: noteEditState.tags.slice(),
                checklist,
                createdAt: now,
                updatedAt: now
            });
        }

        saveNotes(farm, notes);
        closeNoteEditModal();
    });
}

// =============================================================
// SECTION 3: GLOBAL VARIABLES
// =============================================================
let currentFarmId = null;
let isEditMode = false;
let viewedSeason = 1;

// Active farm's map data (a different FS25 map per farm). Populated by
// loadFarmConfigs() on openPlanner, emptied by clearFarmConfigs() on exit.
let CROP_CALENDAR = {};
let AVAILABLE_CROPS = [];
// The game's crop menu order: the map's own fruitTypes list when the map mod
// ships one (read by map-crops.js), else the base game's.
let CROP_ORDER = [];
// Last readMapCrops() result for the open farm (shown in Settings).
let mapCropsInfo = null;
// Animal mods active in the open farm's savegame (readAnimalMods), or null.
let ANIMAL_MODS = null;
// Land plot areas for the open farm (Settings toggle) — see readFarmlandAreas.
let FARMLAND_INFO = null;

// data/maps/maps_fruitTypes.xml order (base FS25), crop keys as formatCropName
// produces them — the crops every map has unless it replaces the base list.
// (Meadow is added per map, e.g. by the base US map's own list.)
const BASE_CROP_ORDER = [
    "Wheat", "Barley", "Canola", "Oat", "Maize", "Sunflower", "Soybean", "Potato",
    "Rice", "Ricelonggrain", "Sugarbeet", "Sugarcane", "Cotton", "Sorghum", "Grape",
    "Olive", "Poplar", "Beetroot", "Carrot", "Parsnip", "Greenbean", "Pea", "Spinach",
    "Grass", "Oilseedradish"
];

function cropOrderKey(name) {
    return String(name || '').replace(/[_\s]+/g, '').toUpperCase();
}

function compareCropsGameOrder(a, b) {
    const keys = CROP_ORDER.map(cropOrderKey);
    const ia = keys.indexOf(cropOrderKey(a)), ib = keys.indexOf(cropOrderKey(b));
    if (ia !== ib) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || 0;
    return String(a).localeCompare(String(b));
}

// Base-game FS25 crop calendar (sow month -> harvest month), generated from
// the vanilla data/foliage/*.xml growth definitions — see
// tools/generate-default-crops.js. Loaded once so every farm has
// the standard crops available even before/without importing a map's own
// XML folder, since not every map ships XML overrides for crops it doesn't
// customize. A farm's own crops_config.json (imported map data) is merged
// on top of this in loadFarmConfigs(), overriding per-crop where present.
// Seed rate, harvest yield and straw per crop in l/ha (litersPerSqm × 10000)
// from a fruitType XML: <seeding>, <harvest> and a straw <windrow>. Same
// attributes as tools/generate-default-agronomy.js.
function cropAgronomyFromDoc(doc) {
    const perHa = el => {
        const v = el ? parseFloat(el.getAttribute('litersPerSqm')) : NaN;
        return v > 0 ? Math.round(v * 10000) : null;
    };
    const out = {};
    const seed = perHa(doc.querySelector('seeding'));
    const yld = perHa(doc.querySelector('harvest'));
    const windrow = doc.querySelector('windrow');
    const straw = windrow && /straw/i.test(windrow.getAttribute('fillType') || '') ? perHa(windrow) : null;
    if (seed) out.seed = seed;
    if (yld) out.yield = yld;
    if (straw) out.straw = straw;
    const seeding = doc.querySelector('seeding');
    const rolling = seeding ? seeding.getAttribute('needsRolling') : null;
    if (rolling === 'true' || rolling === 'false') out.needsRolling = rolling === 'true';
    return Object.keys(out).length ? out : null;
}

// Base game agronomy (data/default-agronomy.json, from the game's own crop
// files) with the open farm's map crops on top — see loadFarmConfigs.
let DEFAULT_AGRONOMY = {};
try {
    DEFAULT_AGRONOMY = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'default-agronomy.json'), 'utf-8')) || {};
} catch (e) {
    console.error('Could not load default-agronomy.json', e);
}
let CROP_AGRONOMY = {};   // cropOrderKey -> { seed, yield, straw }

function buildCropAgronomy(mapCrops) {
    const out = {};
    Object.keys(DEFAULT_AGRONOMY).forEach(k => { out[cropOrderKey(k)] = { ...DEFAULT_AGRONOMY[k] }; });
    (mapCrops || []).forEach(c => {
        if (c.agronomy) out[cropOrderKey(c.name)] = { ...(out[cropOrderKey(c.name)] || {}), ...c.agronomy };
    });
    return out;
}

function cropAgronomy(crop, key) {
    const a = CROP_AGRONOMY[cropOrderKey(crop || '')];
    return a && a[key] > 0 ? a[key] : null;
}

// FS25_CropDependentRolling: only crops whose fruit type has
// <seeding needsRolling="true"> get rolled (the map's crop files, else the
// base game's), with the player's changes from <savegame>/cropDependentRolling.xml
// on top (only crops that differ from that default). A crop the files don't
// mention, or the mod not in the save, keeps rolling as in the base game.
let ROLLING_OVERRIDES = {};   // cropOrderKey -> needsRolling

function readRollingOverrides(saveGamePath) {
    const out = {};
    try {
        const file = path.join(path.dirname(saveGamePath), 'cropDependentRolling.xml');
        if (!fs.existsSync(file)) return out;
        const xml = fs.readFileSync(file, 'utf-8');
        const version = parseInt((xml.match(/<cropDependentRolling\b[^>]*\bformatVersion="(\d+)"/) || [])[1], 10) || 0;
        if (version > 1) return out;   // a newer format than the mod's 1 — the mod ignores it too
        for (const m of xml.matchAll(/<fruit\b[^>]*>/g)) {
            const name = (m[0].match(/\sname="([^"]+)"/) || [])[1];
            const value = (m[0].match(/\sneedsRolling="(true|false)"/) || [])[1];
            if (name && value) out[cropOrderKey(name)] = value === 'true';
        }
    } catch (e) {
        console.error('Could not read cropDependentRolling.xml', e);
    }
    return out;
}

// Whether the crop needs rolling by the mod's rules (whether the mod is on or not).
function cropRollingRule(crop) {
    const k = cropOrderKey(crop || '');
    if (k in ROLLING_OVERRIDES) return ROLLING_OVERRIDES[k];
    const a = CROP_AGRONOMY[k];
    return !(a && a.needsRolling === false);
}

// Whether the planner offers rolling for the crop (chip, work step, field window).
function cropNeedsRolling(crop) {
    return !crop || !modEnabled('cropRolling') || cropRollingRule(crop);
}

let DEFAULT_CROPS = {};
try {
    DEFAULT_CROPS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'default-crops.json'), 'utf-8')) || {};
} catch (e) {
    console.error('Could not load default-crops.json — base crops will be unavailable until a map is imported', e);
}

// Base-game FS25 animal needs/production (food/water/straw + milk/egg/wool
// curves by age), generated from the game's own animals.xml data — see
// tools/generate-default-animals.js. Loaded once so every breed's
// daily needs/production are known even before/without importing a map's
// own animal-defs XML folder. A farm's own animal_needs_config.json
// (imported map data) is merged on top of this in loadFarmConfigs(),
// overriding per-subType where present.
let DEFAULT_ANIMALS = {};
try {
    DEFAULT_ANIMALS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'default-animals.json'), 'utf-8')) || {};
} catch (e) {
    console.error('Could not load default-animals.json — base animal needs will be unavailable until a map is imported', e);
}
// Legacy — kept only so an old app-wide config can still be migrated; the
// crop calendar / animal-needs paths and source labels are per-farm now
// (farm.cropsSourceLabel / farm.animalDefsSourceLabel in data.json).

// Supplies, fertilization plan and supply rates: supplies.js (loaded before this file).

// --- Nitrogen by soil type (Precision Farming) ------------------------------
// The real per-crop N figure depends on the field's soil. nitrogen-by-soil.json
// (shipped next to the app, user-editable) holds a kg N/ha value for every
// crop x soil-type pair plus a fallback row for crops it doesn't list. If the
// file is missing or malformed we fall back to this built-in table so the
// panel still works.
// Soil types + yieldPct come from FS25 Precision Farming (PrecisionFarming.xml
// <soilTypes> yieldPotential). The N numbers in nitrogen-by-soil.json are that
// mod's <fruitRequirements> targetLevel; this built-in copy is only the safety
// net if the JSON file is unreadable.
const NITROGEN_BY_SOIL_FALLBACK = {
    soilTypes: [
        { id: 'loamySand', pl: 'Piasek ilasty', en: 'Loamy Sand', de: 'Lehmiger Sand', yieldPct: 80 },
        { id: 'sandyLoam', pl: 'Piaszczysty ił', en: 'Sandy Loam', de: 'Sandiger Lehm', yieldPct: 100 },
        { id: 'loam', pl: 'Ił', en: 'Loam', de: 'Lehm', yieldPct: 125 },
        { id: 'siltyClay', pl: 'Ił pylasty', en: 'Silty Clay', de: 'Schluffiger Ton', yieldPct: 90 }
    ],
    fallback: { loamySand: 100, sandyLoam: 120, loam: 150, siltyClay: 130 },
    crops: {}
};

let NITROGEN_BY_SOIL = NITROGEN_BY_SOIL_FALLBACK;
try {
    const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'nitrogen-by-soil.json'), 'utf-8'));
    NITROGEN_BY_SOIL = {
        soilTypes: (parsed.soilTypes && parsed.soilTypes.length) ? parsed.soilTypes : NITROGEN_BY_SOIL_FALLBACK.soilTypes,
        fallback: parsed.fallback || NITROGEN_BY_SOIL_FALLBACK.fallback,
        crops: parsed.crops || {}
    };
} catch (e) {
    console.error('Could not load nitrogen-by-soil.json — using built-in fallback', e);
}

// Supplies, fertilization plan and supply rates: supplies.js (loaded before this file).

// "Przewidywane plony" (Predicted yields) panel data: every field with a crop
// assigned in the given season — planted or still just planned ("To Plant"), any
// sowing month — aggregated per crop across all matching fields. Predicted
// litres assumes ideal N, ideal pH and no weeds (i.e. just the crop's
// full-potential yield scaled by the field's soil-mix yield potential — see
// fieldYieldFactor above) since those are the only levers this app models;
// a crop with no known yield rate taints its whole aggregated row rather
// than silently under-counting one field.
// farm (current season only): with FS25_MoistureSystem, fields harvested this
// month get the yield factor of today's field moisture (see fieldMoistureInfo).
function buildYieldForecastRows(fields, rates, farm = null) {
    fields = fields || [];
    const byCrop = new Map();
    fields.forEach((f, i) => {
        const area = parseFloat(f.area) || 0;
        if (area <= 0) return;
        const soilMix = getFieldSoilMix(fertPlanSoilKey(f, i), rates);
        // Main crop and catch crop are two harvests off the same hectares.
        [f.crop, f.catchCrop].filter(Boolean).forEach(crop => {
            const rate = getCropYieldRate(crop);
            const known = rate !== null;
            const moist = farm ? fieldMoistureInfo(f, crop, crop === f.crop ? f.sowingMonth : f.catchSowingMonth, farm) : null;
            const litres = known ? area * rate * fieldYieldFactor(soilMix) * (moist && moist.now ? moist.factor : 1) : 0;

            const entry = byCrop.get(crop) || { crop, area: 0, litres: 0, known: true, moisture: null };
            entry.area += area;
            entry.litres += litres;
            if (moist) {
                // Area-weighted: moisture of all its fields, factor of those harvested now.
                const m = entry.moisture || (entry.moisture = { def: moist.def, area: 0, sum: 0, nowArea: 0, nowFactor: 0 });
                m.area += area;
                m.sum += area * moist.moisture;
                if (moist.now) { m.nowArea += area; m.nowFactor += area * moist.factor; }
            }
            if (!known) entry.known = false;
            byCrop.set(crop, entry);
        });
    });
    const rows = [...byCrop.values()].sort((a, b) => b.litres - a.litres);
    return {
        rows,
        total: rows.reduce((s, r) => s + r.litres, 0),
        missingCount: rows.filter(r => !r.known).length
    };
}

// FS25_MoistureSystem (moisture-mod.js): today's moisture from the save,
// read with the farm's configs and again on every sync.
let MOISTURE_DATA = null;

function loadMoistureData(farm) {
    const known = MOISTURE_DATA && MOISTURE_DATA.crops;
    MOISTURE_DATA = farm && farm.saveGamePath && modEnabled('moisture') ? readMoistureSystem(farm.saveGamePath, known) : null;
}

// Moisture of a field (0..1): the farm-wide value plus the irrigation boost of
// its farmland — a combined row (10-11) averages its fields. The mod's ±2 pp
// for terrain height is left out (it needs the map's terrain).
function fieldMoisture(field) {
    if (!MOISTURE_DATA) return null;
    const ids = String((field && field.number) || '').match(/\d+/g) || [];
    const boost = ids.length ? ids.reduce((s, id) => s + (MOISTURE_DATA.boosts[id] || 0), 0) / ids.length : 0;
    return Math.min(1, MOISTURE_DATA.moisture + boost);
}

function formatMoisturePct(m) {
    return (m * 100).toLocaleString(FIN_LOCALE(), { maximumFractionDigits: 1 }) + ' %';
}

// "24 % · too wet" with the crop's ideal window under it (yield forecast, field window).
function moistureCellHtml(moisture, def, factor, now) {
    const state = moisture < def.idealMin ? 'dry' : (moisture > def.idealMax ? 'wet' : 'ideal');
    const ideal = t('moistureIdeal').replace('{min}', Math.round(def.idealMin * 100)).replace('{max}', Math.round(def.idealMax * 100));
    const effect = now && factor < 0.9995
        ? `<span class="moisture-effect">${t('moistureThisMonth').replace('{x}', factor.toLocaleString(FIN_LOCALE(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</span>` : '';
    return `<span class="moisture-state is-${state}">${formatMoisturePct(moisture)} · ${t('moisture_' + state)}</span><span class="moisture-ideal">${ideal}</span>${effect}`;
}

// -> null when the mod isn't in play or doesn't track the crop, else
//    { moisture, def, factor, state: 'dry' | 'ideal' | 'wet', now }
// now = harvested in the farm's month (the crop calendar of its sowing month):
// only then does today's moisture decide the yield.
function fieldMoistureInfo(field, crop, sowingMonth, farm) {
    const def = MOISTURE_DATA && crop ? MOISTURE_DATA.crops[cropOrderKey(crop)] : null;
    if (!def) return null;
    const moisture = fieldMoisture(field);
    const cal = CROP_CALENDAR[crop];
    const month = String((farm && farm.month) || '').toUpperCase();
    const now = !!(cal && month && cal[String(sowingMonth || '').toUpperCase()] === month);
    const state = moisture < def.idealMin ? 'dry' : (moisture > def.idealMax ? 'wet' : 'ideal');
    return { moisture, def, factor: moistureYieldFactor(def, moisture), state, now };
}

// Maps a savegame fruit token ("WHEAT", "SUGARBEET", "OILSEEDRADISH") to the
// crop key the rest of the app uses. FALLOW / UNKNOWN mean "nothing planned".
function saveFruitToCropKey(raw) {
    if (!raw || raw === 'FALLOW' || raw === 'UNKNOWN') return null;
    const collapsed = raw.replace(/[_\s]+/g, '').toUpperCase();
    const hit = AVAILABLE_CROPS.find(c => c.replace(/[_\s]+/g, '').toUpperCase() === collapsed);
    return hit || formatCropName(raw);
}

// Reads the player's owned fields straight from the savegame folder:
//   farmland.xml            -> which farmlandIds belong to farm 1
//   precisionFarming.xml    -> real field area (m², from the <tillage> block)
//   fields.xml             -> planned crop + current spray/lime level per field
// Returns { ok, fields:[...], hasArea }; fails quietly (ok:false) when the
// save folder or its files are missing. weedState feeds syncWeedsFromSave.
function readSaveFields(farm) {
    if (!farm || !farm.saveGamePath) return { ok: false, reason: 'nopath' };
    const dir = path.dirname(farm.saveGamePath);
    const fieldsPath = path.join(dir, 'fields.xml');
    const farmlandPath = path.join(dir, 'farmland.xml');
    if (!fs.existsSync(fieldsPath) || !fs.existsSync(farmlandPath)) return { ok: false, reason: 'nofiles' };

    try {
        const flText = fs.readFileSync(farmlandPath, 'utf-8');
        const owned = new Set();
        for (const m of flText.matchAll(/<farmland\s+id="(\d+)"\s+farmId="(\d+)"/g)) {
            if (m[2] === gameFarmIdOf(farm)) owned.add(m[1]);
        }

        const areaById = {};
        const pfPath = path.join(dir, 'precisionFarming.xml');
        if (fs.existsSync(pfPath)) {
            const pfText = fs.readFileSync(pfPath, 'utf-8');
            const till = (pfText.match(/<tillage>[\s\S]*?<\/tillage>/) || [''])[0];
            for (const m of till.matchAll(/farmlandId="(\d+)"[^>]*?totalFieldArea="([\d.]+)"/g)) {
                areaById[m[1]] = parseFloat(m[2]) / 10000;   // m² -> ha
            }
        }

        const fxText = fs.readFileSync(fieldsPath, 'utf-8');
        const attrOf = (tag, name) => { const mm = tag.match(new RegExp(name + '="([^"]*)"')); return mm ? mm[1] : ''; };
        const out = [];
        for (const m of fxText.matchAll(/<field\s+id="(\d+)"[^>]*\/>/g)) {
            const id = m[1];
            if (!owned.has(id)) continue;
            const tag = m[0];
            const fruitType = attrOf(tag, 'fruitType');
            const growthState = parseInt(attrOf(tag, 'growthState')) || 0;
            out.push({
                id,
                areaHa: areaById[id] != null ? areaById[id] : null,
                plannedFruit: attrOf(tag, 'plannedFruit'),
                fruitType,
                growthState,
                sown: fruitType !== 'UNKNOWN' && fruitType !== '' && fruitType !== 'FALLOW' && growthState > 0,
                sprayLevel: parseInt(attrOf(tag, 'sprayLevel')) || 0,
                limeLevel: parseInt(attrOf(tag, 'limeLevel')) || 0,
                weedState: parseInt(attrOf(tag, 'weedState')) || 0
            });
        }
        return { ok: true, fields: out, hasArea: Object.keys(areaById).length > 0 };
    } catch (e) {
        console.error('readSaveFields failed', e);
        return { ok: false, reason: 'parse' };
    }
}

let ANIMAL_NEEDS_DATA = {};

const ALL_MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

// The 12 in-game growth periods, in order, and the real-world month each one
// corresponds to. Used both to read the current in-game month from
// environment.xml and to simulate crop growth from fruitType XML files.
const FS_PERIODS = ["EARLY_SPRING", "MID_SPRING", "LATE_SPRING", "EARLY_SUMMER", "MID_SUMMER", "LATE_SUMMER", "EARLY_AUTUMN", "MID_AUTUMN", "LATE_AUTUMN", "EARLY_WINTER", "MID_WINTER", "LATE_WINTER"];
const FS_PERIOD_TO_MONTH = ["MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER", "JANUARY", "FEBRUARY"];

// =============================================================
// SECTION 4: FILE SYSTEM & DATA HELPERS
// =============================================================
// Folders used to be named after a sanitized version of the farm's display
// name. That breaks silently for names with Polish diacritics (ą, ć, ę, ł,
// ń, ó, ś, ź, ż) — Windows can end up with a byte-level Unicode
// normalization mismatch between what's stored in data.json and what's
// actually on disk, so fs.existsSync/fs.rmSync stop reliably matching the
// real folder even though it "looks" identical everywhere you check it.
// Folders are now always named after the farm's own id (a plain numeric
// timestamp string — always ASCII, always stable). The display name in the
// UI is completely free-form and never touches the filesystem.
function migrateFarmFolderToId(oldFolderName, farmData) {
    if (!farmData.id || farmData.folderName === farmData.id) return farmData;

    const oldPath = path.join(appDataDir, oldFolderName);
    const newPath = path.join(appDataDir, farmData.id);

    if (fs.existsSync(newPath)) {
        // Extremely unlikely id collision — don't risk data loss, just keep going on the old folder.
        console.error('Folder migration skipped: target already exists for', farmData.id);
        return farmData;
    }

    try {
        fs.renameSync(oldPath, newPath);
        farmData.folderName = farmData.id;
        fs.writeFileSync(path.join(newPath, 'data.json'), JSON.stringify(farmData, null, 2), 'utf-8');
        console.log('Migrated farm folder "' + oldFolderName + '" -> "' + farmData.id + '"');
    } catch (err) {
        console.error('Folder migration failed for', oldFolderName, err);
        // Keep the old folderName so the rest of the app still finds the farm.
    }

    return farmData;
}

// Parsed data.json per farm file, reused while the file's mtime and size
// stay the same — getAllFarms() runs dozens of times per render. Callers
// still get their own copy (they change it and save it, or drop it).
const FARM_FILE_CACHE = new Map();   // jsonPath -> { mtimeMs, size, data }

function readFarmFile(jsonPath) {
    const st = fs.statSync(jsonPath);
    const hit = FARM_FILE_CACHE.get(jsonPath);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return structuredClone(hit.data);
    const content = fs.readFileSync(jsonPath, 'utf-8');
    if (content.trim() === '') return null;
    const data = JSON.parse(content);
    FARM_FILE_CACHE.set(jsonPath, { mtimeMs: st.mtimeMs, size: st.size, data: structuredClone(data) });
    return data;
}

function getAllFarms() {
    const farms = [];
    if (!fs.existsSync(appDataDir)) return farms;

    const folders = fs.readdirSync(appDataDir);
    folders.forEach(folder => {
        try {
            const folderPath = path.join(appDataDir, folder);
            if (fs.statSync(folderPath).isDirectory()) {
                const jsonPath = path.join(folderPath, 'data.json');
                if (fs.existsSync(jsonPath)) {
                    let data = readFarmFile(jsonPath);
                    if (data) {
                        if (data.id && data.folderName !== data.id) {
                            data = migrateFarmFolderToId(folder, data);
                        }
                        farms.push(data);
                    }
                }
            }
        } catch (e) {
            console.error(`Could not read the farm file in ${folder} — it is damaged.`);
        }
    });
    return farms;
}

// touch: false for writes that aren't the user's own edits (savegame sync,
// migrations), so "Last edited" on the farm list stays meaningful.
function saveFarmData(farmData, { touch = true } = {}) {
    if (!farmData.folderName) return;
    const filePath = path.join(appDataDir, farmData.folderName, 'data.json');

    if (touch) farmData.lastEdited = new Date().toISOString();

    try {
        fs.writeFileSync(filePath, JSON.stringify(farmData, null, 2), 'utf-8');
        // Keep the cache in step so the next read doesn't parse the file again.
        const st = fs.statSync(filePath);
        FARM_FILE_CACHE.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, data: structuredClone(farmData) });
    }
    catch (err) { console.error('saveFarmData failed', err); showNotice(t('noticeErrorTitle'), t('saveDataError'), true); }
}

// Absolute path to a farm's own data folder (named after its id).
function farmDir(farm) {
    return path.join(appDataDir, farm.folderName || farm.id);
}

// lastEdited is ISO now; farms saved by older versions hold a string already
// formatted in whatever locale the system had then — show those as they are.
function formatLastEdited(value) {
    if (!value) return '–';
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
    const d = new Date(value);
    return isNaN(d) ? value : d.toLocaleString(FIN_LOCALE(), { dateStyle: 'short', timeStyle: 'short' });
}

function getCurrentFarm() {
    return getAllFarms().find(f => f.id === currentFarmId) || null;
}

// Crop calendar + animal-needs are per-farm now: each farm can be a different
// FS25 map, so its map data lives in the farm's own folder. loadFarmConfigs
// runs when a farm is opened; clearFarmConfigs when you return to the dashboard.
function loadFarmConfigs(farm) {
    // Base FS25 crops are always available; a farm's own imported map data
    // (if any) is merged on top below, per-crop, so it extends/overrides the
    // defaults instead of replacing the whole list.
    CROP_CALENDAR = JSON.parse(JSON.stringify(DEFAULT_CROPS));
    CROP_AGRONOMY = buildCropAgronomy(null);
    PF_SEED_RATES = null;
    if (farm && farm.saveGamePath) {
        const pfRates = readPfSeedRates(farm.saveGamePath, formatCropName);
        if (pfRates.ok) {
            // Built-in base rates first (PF may ship inside the game, out of
            // reach), then what PF and the map say.
            PF_SEED_RATES = {};
            Object.keys(SUPPLY_SEED_RATES_PF).forEach(k => { PF_SEED_RATES[cropOrderKey(k)] = SUPPLY_SEED_RATES_PF[k]; });
            Object.keys(pfRates.rates).forEach(k => { PF_SEED_RATES[cropOrderKey(k)] = pfRates.rates[k]; });
        }
    }
    CROP_ORDER = [...BASE_CROP_ORDER];
    mapCropsInfo = null;
    MAP_CROP_TITLES = {};
    ANIMAL_MODS = null;
    ROLLING_OVERRIDES = farm && farm.saveGamePath ? readRollingOverrides(farm.saveGamePath) : {};
    // Food groups and the TMR recipe: the map's animalFood.xml, else the base game's.
    applyMapAnimalFood(farm && farm.saveGamePath ? readMapAnimalFood(farm.saveGamePath) : null);
    // Same pattern as crops: base FS25 animal needs/production are always
    // available; a farm's own imported animal-defs data is merged on top
    // below, per subType.
    ANIMAL_NEEDS_DATA = JSON.parse(JSON.stringify(DEFAULT_ANIMALS));
    if (!farm) { AVAILABLE_CROPS = sortedAvailableCrops(null); return; }
    if (ensureFieldIds(farm)) saveFarmData(farm, { touch: false });

    // The map mod's own crop list (if the savegame points at a mod map):
    // decides which crops exist on this farm and their menu order.
    let mapCropNames = null;
    if (farm.saveGamePath) {
        const res = readMapCrops(farm.saveGamePath, parseCropGrowthXml, formatCropName);
        mapCropsInfo = res;
        if (res.ok) {
            // Base crops first (a re-declared base crop keeps its slot), then
            // the map's new ones in its own order — the game's menu order.
            const mapNames = res.crops.map(c => c.name);
            const baseKeys = BASE_CROP_ORDER.map(cropOrderKey);
            mapCropNames = res.replacesBase
                ? mapNames
                : [...BASE_CROP_ORDER, ...mapNames.filter(n => !baseKeys.includes(cropOrderKey(n)))];
            CROP_ORDER = [...mapCropNames];
            CROP_AGRONOMY = buildCropAgronomy(res.crops);
            res.crops.forEach(c => {
                if (c.calendar) CROP_CALENDAR[c.name] = { ...(CROP_CALENDAR[c.name] || {}), ...c.calendar };
                if (c.titles) MAP_CROP_TITLES[cropOrderKey(c.name)] = c.titles;
            });
        }
    }

    const dir = farmDir(farm);
    const cropsPath = path.join(dir, 'crops_config.json');
    const animalsPath = path.join(dir, 'animal_needs_config.json');

    // One-time migration: installs from before per-farm map data had a single
    // app-wide config. Adopt it for any farm that has none of its own yet.
    try {
        const legacyCrops = path.join(appDataDir, 'crops_config.json');
        if (!fs.existsSync(cropsPath) && fs.existsSync(legacyCrops)) fs.copyFileSync(legacyCrops, cropsPath);
        const legacyAnimals = path.join(appDataDir, 'animal_needs_config.json');
        if (!fs.existsSync(animalsPath) && fs.existsSync(legacyAnimals)) fs.copyFileSync(legacyAnimals, animalsPath);
    } catch (e) { console.error('Per-farm config migration failed', e); }

    refreshAnimalDefsFromSource(farm, animalsPath);

    try {
        if (fs.existsSync(cropsPath)) {
            const imported = JSON.parse(fs.readFileSync(cropsPath, 'utf-8')) || {};
            Object.keys(imported).forEach(cropName => {
                CROP_CALENDAR[cropName] = { ...(CROP_CALENDAR[cropName] || {}), ...imported[cropName] };
                // A manually imported crop is on the map even if the mod's
                // list couldn't be read or doesn't name it.
                if (mapCropNames && !mapCropNames.some(n => cropOrderKey(n) === cropOrderKey(cropName))) mapCropNames.push(cropName);
            });
        }
    } catch (e) { console.error('Bad crops_config.json for farm', farm.id, e); }
    AVAILABLE_CROPS = sortedAvailableCrops(mapCropNames);

    try {
        if (fs.existsSync(animalsPath)) {
            const importedAnimals = JSON.parse(fs.readFileSync(animalsPath, 'utf-8')) || {};
            Object.keys(importedAnimals).forEach(subType => {
                ANIMAL_NEEDS_DATA[subType] = { ...(ANIMAL_NEEDS_DATA[subType] || {}), ...importedAnimals[subType] };
            });
        }
    } catch (e) { console.error('Bad animal_needs_config.json for farm', farm.id, e); }

    // AnimalFoodCalculator's reference source decides whose food/water/straw
    // curves the barns actually follow.
    useSaveFarm(farm);
    MOISTURE_DATA = null;
    loadMoistureData(farm);
    ANIMAL_MODS = farm.saveGamePath ? readAnimalMods(farm.saveGamePath, disabledModsOf(farm)) : null;
    // Animal Package in the save: its breeds (chickens, Holstein…) and curves
    // are what the game runs, whatever was imported before.
    if (ANIMAL_MODS && ANIMAL_MODS.animalPackageXml.length) {
        ANIMAL_MODS.animalPackageXml.forEach(xml => {
            const parsed = parseAnimalNeedsXml(xml);
            if (parsed) Object.keys(parsed).forEach(st => { ANIMAL_NEEDS_DATA[st] = { ...(ANIMAL_NEEDS_DATA[st] || {}), ...parsed[st] }; });
        });
    }
    if (afcActive(farm)) {
        const INPUTS = ['food', 'water', 'straw'];
        const applyInputs = (subType, src) => {
            if (!ANIMAL_NEEDS_DATA[subType] && !src) return;
            const next = { ...(ANIMAL_NEEDS_DATA[subType] || {}) };
            INPUTS.forEach(k => { if (src && src[k] && src[k].length) next[k] = src[k]; });
            ANIMAL_NEEDS_DATA[subType] = next;
        };
        const afc = ANIMAL_MODS.afc;
        if (afc.referenceSource === 'basegame') {
            Object.keys(DEFAULT_ANIMALS).forEach(st => applyInputs(st, DEFAULT_ANIMALS[st]));
        }
        afc.referenceXml.forEach(xml => {
            const parsed = parseAnimalNeedsXml(xml);
            if (parsed) Object.keys(parsed).forEach(st => applyInputs(st, parsed[st]));
        });
    }
}

// Crop keys the planner offers: the map's list when known (only those with a
// sowing calendar — a crop you can't sow isn't plannable), else every crop in
// the calendar. Always in game order.
function sortedAvailableCrops(mapCropNames) {
    const calendarKey = new Map(Object.keys(CROP_CALENDAR).map(k => [cropOrderKey(k), k]));
    let names;
    if (mapCropNames) {
        names = mapCropNames.map(n => calendarKey.get(cropOrderKey(n))).filter(Boolean);
    } else {
        names = Object.keys(CROP_CALENDAR);
    }
    return [...new Set(names)].sort(compareCropsGameOrder);
}

function clearFarmConfigs() {
    CROP_CALENDAR = {};
    AVAILABLE_CROPS = [];
    CROP_ORDER = [];
    mapCropsInfo = null;
    MAP_CROP_TITLES = {};
    ANIMAL_MODS = null;
    ANIMAL_NEEDS_DATA = {};
    ROLLING_OVERRIDES = {};
    MOISTURE_DATA = null;
    applyMapAnimalFood(null);
}

// XML files under a folder whose name mentions animals — the fallback for
// farms imported before the source files were remembered. Depth-limited so
// pointing it at a whole game install stays quick.
function findAnimalXmlFiles(dir, depth = 0, out = []) {
    if (depth > 6) return out;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    entries.forEach(e => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) findAnimalXmlFiles(full, depth + 1, out);
        else if (/animal.*\.xml$/i.test(e.name)) out.push(full);
    });
    return out;
}

// Re-reads the animals.xml file(s) this farm's animal definitions were
// imported from, so edits to them (a map/mod update, own tweaks) show up
// on the next start without importing again. Missing files are skipped and
// the last imported copy in animal_needs_config.json stays in use.
function refreshAnimalDefsFromSource(farm, animalsPath) {
    let files = Array.isArray(farm.animalDefsFiles) ? farm.animalDefsFiles : null;
    try {
        if (!files) {
            const label = farm.animalDefsSourceLabel || '';
            if (!label || !fs.existsSync(label) || !fs.statSync(label).isDirectory()) return;
            files = findAnimalXmlFiles(label).filter(f => {
                try { return !!parseAnimalNeedsXml(fs.readFileSync(f, 'utf-8')); } catch { return false; }
            });
            if (!files.length) return;
            // Remember them without touching lastEdited (not a user edit).
            farm.animalDefsFiles = files;
            fs.writeFileSync(path.join(farmDir(farm), 'data.json'), JSON.stringify(farm, null, 2), 'utf-8');
        }

        const fresh = {};
        files.forEach(f => {
            if (!fs.existsSync(f)) return;
            try {
                const parsed = parseAnimalNeedsXml(fs.readFileSync(f, 'utf-8'));
                if (parsed) Object.assign(fresh, parsed);
            } catch (e) { console.warn('Animal definitions: could not re-read', f, e); }
        });
        if (!Object.keys(fresh).length) return;

        let existing = {};
        if (fs.existsSync(animalsPath)) {
            try { existing = JSON.parse(fs.readFileSync(animalsPath, 'utf-8')) || {}; } catch { existing = {}; }
        }
        const merged = { ...existing, ...fresh };
        if (JSON.stringify(merged) !== JSON.stringify(existing)) {
            fs.writeFileSync(animalsPath, JSON.stringify(merged, null, 2), 'utf-8');
            console.log('Animal definitions refreshed from', files.length, 'file(s)');
        }
    } catch (e) {
        console.error('Could not refresh animal definitions for farm', farm.id, e);
    }
}

// Turns a raw fruitType "name" attribute (e.g. "SUGAR_BEET", "canola")
// into a readable display name ("Sugar Beet", "Canola").
// Crop names come from mod XML and the savegame and end up in the UI's HTML;
// they're game identifiers, so anything but letters, digits, "_", "-" and
// spaces is dropped (no markup can get through).
function formatCropName(rawName) {
    return String(rawName || '')
        .replace(/[^\p{L}\p{N}_\s-]/gu, '')
        .toLowerCase()
        .split(/[_\s]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

// Parses a single fruitType/foliageType XML (one crop's growth definition)
// and derives a sowing-month -> harvest-month calendar by simulating the
// game's own growth-state machine, one period (~one month) at a time.
// Returns null if the file isn't a recognizable crop growth definition —
// map folders are full of unrelated XML files, so this must fail quietly.
function parseCropGrowthXml(xmlText) {
    let doc;
    try {
        doc = new DOMParser().parseFromString(xmlText, "text/xml");
    } catch (err) {
        return null;
    }
    if (!doc || doc.querySelector('parsererror')) return null;

    const fruitTypeEl = doc.querySelector('fruitType');
    const seasonalEl = doc.querySelector('growth > seasonal');
    if (!fruitTypeEl || !seasonalEl) return null;

    const rawName = fruitTypeEl.getAttribute('name');
    if (!rawName) return null;

    // Find whichever foliage state(s) represent "ready to harvest". Usually
    // that's the attribute-flagged one, but some crops (e.g. potato) flag a
    // player-action state instead (like "cutHaulm" for haulm topping) that
    // the automatic seasonal growth chain never reaches on its own. So we
    // also always treat a state literally named "harvestReady" as a harvest
    // signal — that naming convention is consistent across FS crop content,
    // and covers exactly the cases the attribute alone misses.
    const harvestStateNames = new Set();
    doc.querySelectorAll('foliageState[isHarvestReady="true"]').forEach(el => {
        const n = el.getAttribute('name');
        if (n) harvestStateNames.add(n);
    });
    if (doc.querySelector('foliageState[name="harvestReady"]')) harvestStateNames.add('harvestReady');
    if (harvestStateNames.size === 0) return null;

    // Index the file's <period> elements onto our canonical 12-slot year,
    // regardless of what order they appear in the file.
    const periodData = FS_PERIODS.map(() => ({ plantingAllowed: false, updates: [] }));
    let hasInvisibleRule = false;
    seasonalEl.querySelectorAll(':scope > period').forEach(periodEl => {
        const idx = FS_PERIODS.indexOf(periodEl.getAttribute('name'));
        if (idx === -1) return;
        periodData[idx].plantingAllowed = periodEl.getAttribute('plantingAllowed') === 'true';
        periodEl.querySelectorAll(':scope > update').forEach(u => {
            const from = u.getAttribute('startState');
            const to = u.getAttribute('endState');
            if (from && to) {
                periodData[idx].updates.push({ from, to });
                if (from === 'invisible') hasInvisibleRule = true;
            }
        });
    });

    // Most crops sow into an "invisible" state (freshly tilled, nothing
    // visible yet). A few (e.g. rice, which never leaves standing water
    // bare) have no "invisible" state anywhere in their growth chain — for
    // those, fall back to whatever <seasonal initialState="..."> the file
    // itself declares as where a freshly planted crop starts.
    const sowStartState = hasInvisibleRule ? 'invisible' : (seasonalEl.getAttribute('initialState') || 'invisible');

    const calendar = {};

    for (let sowIdx = 0; sowIdx < 12; sowIdx++) {
        if (!periodData[sowIdx].plantingAllowed) continue;

        let state = sowStartState;
        let harvestIdx = null;

        // Walk forward period by period (wrapping across the year boundary,
        // up to 2 full years as a safety cap). Within each period, keep
        // chaining every matching growth rule until none apply (or harvest
        // is reached) before moving to the next period — a period's
        // <update> list is often a full multi-step chain meant to resolve
        // within that same ~month (e.g. grass: invisible -> greenSmall ->
        // greenMiddle -> harvestReady all inside one period), not one step
        // per period.
        outer:
        for (let step = 0; step < 24; step++) {
            const idx = (sowIdx + step) % 12;

            for (let inner = 0; inner < 20; inner++) {
                const rule = periodData[idx].updates.find(u => u.from === state);
                if (!rule) break;
                state = rule.to;
                if (harvestStateNames.has(state)) {
                    harvestIdx = idx;
                    break outer;
                }
            }

            if (harvestStateNames.has(state)) {
                harvestIdx = idx;
                break;
            }
        }

        if (harvestIdx !== null) {
            calendar[FS_PERIOD_TO_MONTH[sowIdx]] = FS_PERIOD_TO_MONTH[harvestIdx];
        }
    }

    if (Object.keys(calendar).length === 0) return null;
    return { name: formatCropName(rawName), calendar, agronomy: cropAgronomyFromDoc(doc) };
}

// Takes a FileList (from a <input webkitdirectory> folder picker, which the
// browser already expands recursively through every subfolder) and builds
// a combined crop calendar out of whichever files turn out to be crop
// growth definitions.
// Parses a game/mod animals.xml (the species/breed definition file — food,
// water, and straw needs per age in months, and production curves). This is
// the DEFINITION file, not the save's actual herd — same relationship as
// fruitType XML is to a planted field.
function parseAnimalNeedsXml(xmlText) {
    let doc;
    try { doc = new DOMParser().parseFromString(xmlText, "text/xml"); }
    catch (err) { return null; }
    if (!doc || doc.querySelector('parsererror')) return null;

    // animals.xml has <animals><animal type>…; Animal Package's per-species
    // files have a single <animal type> (or another wrapper) as the root.
    const subTypeEls = doc.querySelectorAll('animal > subType');
    if (subTypeEls.length === 0) return null;

    // Value attribute name isn't consistent across every crop/animal XML
    // dialect seen in the wild — "value" covers the input (food/water/straw)
    // curves, but output curves (milk/eggs/wool) sometimes use a
    // type-specific name instead, so every plausible one is tried in order.
    const readCurve = (parentEl, tagName, valueAttrs = ['value']) => {
        const el = parentEl.querySelector(':scope > ' + tagName);
        if (!el) return [];
        return Array.from(el.querySelectorAll('key')).map(k => {
            let value = NaN;
            for (const attr of valueAttrs) {
                const raw = k.getAttribute(attr);
                if (raw !== null) { value = parseFloat(raw); break; }
            }
            return { ageMonth: parseFloat(k.getAttribute('ageMonth')), value };
        }).filter(k => !isNaN(k.ageMonth) && !isNaN(k.value)).sort((a, b) => a.ageMonth - b.ageMonth);
    };

    const OUTPUT_VALUE_ATTRS = ['value', 'literPerDay', 'numPerDay', 'literPerHour', 'kgPerDay'];
    // Fallback tag name -> canonical fillType key, used only for wrapper
    // tags that carry no fillType/type attribute of their own (e.g. plain
    // "<manure>"). Matches formatFillType's PRODUCTION_FILLTYPE_TRANSLATIONS.
    const OUTPUT_TAGS = { milk: 'MILK', wool: 'WOOL', egg: 'EGG', manure: 'MANURE', liquidmanure: 'LIQUIDMANURE' };

    const readKeysOf = (el) => Array.from(el.querySelectorAll('key')).map(k => {
        let value = NaN;
        for (const attr of OUTPUT_VALUE_ATTRS) {
            const raw = k.getAttribute(attr);
            if (raw !== null) { value = parseFloat(raw); break; }
        }
        return { ageMonth: parseFloat(k.getAttribute('ageMonth')), value };
    }).filter(k => !isNaN(k.ageMonth) && !isNaN(k.value)).sort((a, b) => a.ageMonth - b.ageMonth);

    // Best-effort: production curves aren't as consistently structured
    // across game/mod animals.xml files as the input needs are. The real
    // game data itself uses more than one shape for the *same* kind of
    // output — cow milk is "<milk fillType="MILK">", but sheep wool is
    // "<pallets fillType="WOOL">" and goat milk "<pallets fillType="GOATMILK">"
    // (wrapper tag name isn't the commodity at all there), while water
    // buffalo uses "<milk fillType="BUFFALOMILK">" (right tag, different
    // fillType than the tag name would suggest). So every <output> child is
    // read generically: an explicit fillType/type attribute wins whenever
    // present; only a bare tag with neither (e.g. "<manure>") falls back to
    // the hardcoded tag-name guess.
    const readProductionCurves = (subTypeEl) => {
        const outputEl = subTypeEl.querySelector(':scope > output');
        if (!outputEl) return {};
        const production = {};

        Array.from(outputEl.children).forEach(el => {
            const tagName = el.tagName.toLowerCase();
            const fillType = el.getAttribute('fillType') || el.getAttribute('type') || OUTPUT_TAGS[tagName] || tagName.toUpperCase();
            if (!fillType || production[fillType]) return;
            const curve = readKeysOf(el);
            if (curve.length) production[fillType] = curve;
        });

        return production;
    };

    const needs = {};
    subTypeEls.forEach(subTypeEl => {
        const subType = subTypeEl.getAttribute('subType');
        const inputEl = subTypeEl.querySelector(':scope > input');
        if (!subType || !inputEl) return;

        const food = readCurve(inputEl, 'food');
        const water = readCurve(inputEl, 'water');
        const straw = readCurve(inputEl, 'straw');
        if (!food.length && !water.length && !straw.length) return;

        const entry = { food, water, straw };
        const animalType = subTypeEl.parentElement && subTypeEl.parentElement.getAttribute('type');
        if (animalType) entry.animalType = animalType.toUpperCase();
        const production = readProductionCurves(subTypeEl);
        if (Object.keys(production).length > 0) entry.production = production;
        const reproEl = subTypeEl.querySelector(':scope > reproduction');
        if (reproEl) entry.reproduction = animalImages.parseReproduction(reproEl.outerHTML);
        needs[subType] = entry;
    });

    return Object.keys(needs).length > 0 ? needs : null;
}

// Straight-line interpolation between the nearest two age keypoints — the
// curves skip some months (0,1,2,3,4,5,6,8,10,12,15,18...), so an exact
// animal age often falls between two known points.
function interpolateNeedCurve(curve, ageMonth) {
    if (!curve || curve.length === 0) return 0;
    if (ageMonth <= curve[0].ageMonth) return curve[0].value;
    if (ageMonth >= curve[curve.length - 1].ageMonth) return curve[curve.length - 1].value;
    for (let i = 0; i < curve.length - 1; i++) {
        const a = curve[i], b = curve[i + 1];
        if (ageMonth >= a.ageMonth && ageMonth <= b.ageMonth) {
            const frac = (b.ageMonth === a.ageMonth) ? 0 : (ageMonth - a.ageMonth) / (b.ageMonth - a.ageMonth);
            return a.value + frac * (b.value - a.value);
        }
    }
    return curve[curve.length - 1].value;
}

// Sentinel key used to store one combined feed-trough capacity per building
// (multiple feed ingredient types share one physical trough/capacity).
const ANIMAL_FEED_CAPACITY_KEY = '__ALL_FEED__';

function getDailyAnimalNeed(subType, ageMonth, needType) {
    const def = ANIMAL_NEEDS_DATA[subType];
    if (!def || !def[needType]) return 0;
    return interpolateNeedCurve(def[needType], ageMonth);
}

// Adds one cluster's output (milk/eggs/wool/manure..., litres per in-game
// month from the breed's curves) into `into` (fillType -> litres).
function addClusterOutput(farm, building, c, feedPlan, into) {
    const def = ANIMAL_NEEDS_DATA[c.subType];
    if (!def || !def.production) return;
    const animalType = animalTypeOf(c.subType);
    const ration = animalType ? resolveRation(animalType, feedPlan, building.id) : null;
    // The ration's productionWeight scales milk/eggs/wool the way
    // the game does; manure/slurry don't depend on the feed.
    const outputFactor = ration ? ration.efficiency / 100 : 1;
    Object.keys(def.production).forEach(fillType => {
        const rate = getDailyAnimalProduction(c.subType, c.age, fillType);
        const factor = (FEED_UNSCALED_OUTPUT.includes(fillType) ? 1 : outputFactor)
            * clusterMilkFactor(farm, animalType, c, fillType);
        if (rate > 0) into[fillType] = (into[fillType] || 0) + rate * c.numAnimals * factor;
    });
}

// The whole herd's estimated output for one in-game month, or null when the
// breeds' curves aren't loaded (they're per farm — only the open farm's are).
function estimateMonthlyOutput(farm, buildings) {
    if (!farm || farm.id !== currentFarmId || !Object.keys(ANIMAL_NEEDS_DATA).length) return null;
    const feedPlan = getFeedPlan(farm);
    const out = {};
    (buildings || []).forEach(b => (b.clusters || []).forEach(c => addClusterOutput(farm, b, c, feedPlan, out)));
    return out;
}

function getDailyAnimalProduction(subType, ageMonth, fillType) {
    const def = ANIMAL_NEEDS_DATA[subType];
    if (!def || !def.production || !def.production[fillType]) return 0;
    return interpolateNeedCurve(def.production[fillType], ageMonth);
}

function buildCropsCalendarFromFiles(fileList) {
    const combined = {};
    const animalNeeds = {};
    let xmlCount = 0;
    let cropsFound = 0;
    let animalDefsFound = 0;
    const animalFiles = [];
    // Files that *should* have been readable XML but errored out (bad path
    // resolution, read/permission failure) — distinct from the majority of
    // XML files in a map folder that just aren't crop/animal definitions at
    // all (vehicles, placeables, etc.), which is normal and not logged.
    const readErrors = [];

    Array.from(fileList).forEach(file => {
        if (!/\.xml$/i.test(file.name)) return;
        xmlCount++;

        let absPath = null;
        try { absPath = file.path || (webUtils ? webUtils.getPathForFile(file) : null); }
        catch (err) { absPath = null; }
        if (!absPath) {
            readErrors.push({ name: file.name, reason: 'could not resolve file path' });
            return;
        }

        try {
            const text = fs.readFileSync(absPath, 'utf-8');

            const parsedCrop = parseCropGrowthXml(text);
            if (parsedCrop) {
                combined[parsedCrop.name] = { ...(combined[parsedCrop.name] || {}), ...parsedCrop.calendar };
                cropsFound++;
                return;
            }

            const parsedAnimals = parseAnimalNeedsXml(text);
            if (parsedAnimals) {
                Object.assign(animalNeeds, parsedAnimals);
                animalDefsFound++;
                animalFiles.push(absPath);
            }
        } catch (err) {
            readErrors.push({ name: file.name, reason: err.message || String(err) });
            console.warn(`Crops/animal import: could not read "${file.name}" —`, err);
        }
    });

    return { combined, animalNeeds, xmlCount, cropsFound, animalDefsFound, animalFiles, readErrors };
}

// The player's farm inside the savegame. Single player is always farmId 1;
// in a multiplayer save the farm is picked in Settings (farm.gameFarmId).
// The save readers below filter by SAVE_FARM_ID — set it with useSaveFarm()
// before reading.
let SAVE_FARM_ID = '1';

// Mods whose data the app reads. "Active" = listed in the savegame's
// careerSavegame.xml (or, for ELS, its file is in the save); each can be
// switched off per farm (farm.disabledMods) to fall back to base-game rules.
const SUPPORTED_MODS = [
    { id: 'precisionFarming', name: 'Precision Farming', modNames: ['FS25_precisionFarming'] },
    { id: 'afc', name: 'AnimalFoodCalculator', modNames: ['FS25_AnimalFoodCalculator'] },
    { id: 'eas', name: 'EnhancedAnimalSystem', modNames: ['FS25_EnhancedAnimalSystem'] },
    { id: 'animalPackage', name: 'Animal Package (vanilla edition)', modNames: ['FS25_AnimalPackage_vanillaEdition'] },
    { id: 'bankCredit', name: 'Bank And Credit', modNames: ['FS25_BankCredit'] },
    { id: 'hirePurchasing', name: 'Hire Purchasing', modNames: ['FS25_HirePurchasing'] },
    { id: 'fieldLeasing', name: 'Field Leasing', modNames: ['FS25_FieldLeasing'] },
    { id: 'cropRolling', name: 'Crop Dependent Rolling', modNames: ['FS25_CropDependentRolling'] },
    { id: 'moisture', name: 'Moisture System', modNames: ['FS25_MoistureSystem'] },
    { id: 'els', name: 'Enhanced Loan System', modNames: [], modPattern: /EnhancedLoan/i, saveFile: 'els_loans.xml' }
];
let SAVE_ACTIVE_MODS = new Set();      // modName list of the farm's savegame
let SAVE_DISABLED_MODS = new Set();    // app mod ids switched off for the farm
let SAVE_LINKED = false;

function activeModsInSave(saveGamePath) {
    try {
        const career = fs.readFileSync(saveGamePath, 'utf-8');
        return new Set([...career.matchAll(/<mod\b[^>]*\bmodName="([^"]+)"/g)].map(m => m[1]));
    } catch (e) {
        return new Set();
    }
}

// farm.ignoreAfc / ignoreEas are the switches from before this list existed.
function disabledModsOf(farm) {
    const set = new Set((farm && Array.isArray(farm.disabledMods)) ? farm.disabledMods : []);
    if (farm && farm.ignoreAfc) set.add('afc');
    if (farm && farm.ignoreEas) set.add('eas');
    return set;
}

function modActiveInSave(def, saveGamePath = null) {
    if (def.modNames.some(n => SAVE_ACTIVE_MODS.has(n))) return true;
    if (def.modPattern && [...SAVE_ACTIVE_MODS].some(n => def.modPattern.test(n))) return true;
    const dir = saveGamePath ? path.dirname(saveGamePath) : null;
    return !!(def.saveFile && dir && fs.existsSync(path.join(dir, def.saveFile)));
}

// Whether the app uses a mod's data for the open farm. Without a savegame
// nothing can be detected — Precision Farming's seed rates stay on then
// (the app's default before mods were detected).
function modEnabled(id) {
    if (SAVE_DISABLED_MODS.has(id)) return false;
    if (!SAVE_LINKED) return id === 'precisionFarming';
    const def = SUPPORTED_MODS.find(d => d.id === id);
    return !!(def && modActiveInSave(def, SAVE_LINKED));
}

function gameFarmIdOf(farm) {
    return String((farm && farm.gameFarmId) || '1');
}

function useSaveFarm(farm) {
    SAVE_FARM_ID = gameFarmIdOf(farm);
    SAVE_LINKED = (farm && farm.saveGamePath) || false;
    SAVE_ACTIVE_MODS = SAVE_LINKED ? activeModsInSave(farm.saveGamePath) : new Set();
    SAVE_DISABLED_MODS = disabledModsOf(farm);
}

// Farms in a savegame's farms.xml: [{ id, name, money }]. [] if unreadable.
function listSaveFarms(pathToFile) {
    try {
        const xml = fs.readFileSync(path.join(path.dirname(pathToFile), 'farms.xml'), 'utf-8');
        const out = [];
        for (const m of xml.matchAll(/<farm\s[^>]*>/g)) {
            const attr = name => (m[0].match(new RegExp('\\s' + name + '="([^"]*)"')) || [])[1];
            const id = attr('farmId');
            if (!id || id === '0') continue;   // 0 = spectator / nobody
            out.push({ id, name: attr('name') || '', money: parseFloat(attr('money')) });
        }
        return out;
    } catch (e) {
        return [];
    }
}

// Fills in farm.gameFarmId the first time a save is read: the only farm in
// the save, else farm 1 if it exists, else the first one. Returns true if set.
function resolveGameFarmId(farm) {
    if (!farm || !farm.saveGamePath || farm.gameFarmId) return false;
    const farms = listSaveFarms(farm.saveGamePath);
    if (!farms.length) return false;
    const pick = farms.length === 1 ? farms[0] : (farms.find(f => f.id === '1') || farms[0]);
    farm.gameFarmId = pick.id;
    return true;
}

function readGameSave(pathToFile) {
    const result = { balance: null, month: null, loan: null, equipment: null, animals: null, animalBreakdown: null, animalProduction: null, animalBuildings: null, feedStock: null, feedBales: null, mixerWagons: null, daysPerPeriod: null, playTime: null, gameDay: null, dayInPeriod: null, gamePeriod: null, gameYear: null };
    if (!pathToFile || !fs.existsSync(pathToFile)) return result;

    const saveFolder = path.dirname(pathToFile);

    const findValueInRawText = (text, tagName) => {
        const regex = new RegExp(`<${tagName}[^>]*>([^<]*)<\/${tagName}>`, 'i');
        const match = text.match(regex);
        return match ? match[1].trim() : null;
    };

    try {
        const careerText = fs.readFileSync(pathToFile, 'utf-8');
        let envText = "";
        const envPath = path.join(saveFolder, 'environment.xml');
        if (fs.existsSync(envPath)) {
            envText = fs.readFileSync(envPath, 'utf-8');
        }

        // careerSavegame's <money> is farm 1's; any other farm reads its own
        // money from farms.xml.
        let moneyVal = SAVE_FARM_ID === '1' ? findValueInRawText(careerText, 'money') : null;
        if (moneyVal === null) {
            const own = listSaveFarms(pathToFile).find(f => f.id === SAVE_FARM_ID);
            if (own && !isNaN(own.money)) moneyVal = own.money;
        }
        if (moneyVal !== null && moneyVal !== '' && !isNaN(parseInt(moneyVal))) result.balance = parseInt(moneyVal);

        // Enhanced Loan System (mod) keeps its own list of separate loans
        // instead of the base game's single "loan" value — sum whatever's
        // still outstanding (skip anything already paid off), per farm.
        let loanVal = null;
        const elsLoansPath = path.join(saveFolder, 'els_loans.xml');
        if (fs.existsSync(elsLoansPath) && !SAVE_DISABLED_MODS.has('els')) {
            try {
                const elsXml = fs.readFileSync(elsLoansPath, 'utf-8');
                const elsDoc = new DOMParser().parseFromString(elsXml, "text/xml");
                const farmLoansEl = elsDoc.querySelector(`farmId[farmId="${SAVE_FARM_ID}"]`) || (SAVE_FARM_ID === '1' ? elsDoc.querySelector('farmId') : null);
                if (farmLoansEl) {
                    let total = 0;
                    let foundAny = false;
                    farmLoansEl.querySelectorAll('loan').forEach(loanEl => {
                        if (loanEl.getAttribute('paidOff') === 'true') return;
                        const restAmount = parseFloat(loanEl.getAttribute('restAmount'));
                        if (!isNaN(restAmount)) {
                            total += restAmount;
                            foundAny = true;
                        }
                    });
                    if (foundAny) loanVal = total;
                }
            } catch (err) {
                // Not a recognizable els_loans.xml — fall through to vanilla sources below.
            }
        }

        if (loanVal === null) {
            const farmsPath = path.join(saveFolder, 'farms.xml');
            if (fs.existsSync(farmsPath)) {
                const farmsXml = fs.readFileSync(farmsPath, 'utf-8');
                const farmsDoc = new DOMParser().parseFromString(farmsXml, "text/xml");
                const farmEl = farmsDoc.querySelector(`farm[farmId="${SAVE_FARM_ID}"]`) || (SAVE_FARM_ID === '1' ? farmsDoc.querySelector('farm') : null);
                if (farmEl) loanVal = farmEl.getAttribute('loan');
            }
            if (!loanVal) loanVal = findValueInRawText(careerText, 'loan');
        }

        // Bank And Credit (FS25_BankCredit) replaces the base-game loan with
        // its own contracts in bankCredit.xml (it pays off and zeroes the
        // vanilla loan on load) — add whatever is still outstanding for the
        // farm. Only while the mod is active, so a stale file doesn't count.
        const bankCreditPath = path.join(saveFolder, 'bankCredit.xml');
        if (/<mod\b[^>]*modName="FS25_BankCredit"/.test(careerText) && !SAVE_DISABLED_MODS.has('bankCredit') && fs.existsSync(bankCreditPath)) {
            try {
                const bcDoc = new DOMParser().parseFromString(fs.readFileSync(bankCreditPath, 'utf-8'), "text/xml");
                let bcTotal = 0, bcMonthly = 0, bcCount = 0;
                bcDoc.querySelectorAll('bankcredit > loan').forEach(loanEl => {
                    if (loanEl.getAttribute('farmId') !== SAVE_FARM_ID || loanEl.getAttribute('paidOff') === 'true') return;
                    const rest = parseFloat(loanEl.getAttribute('restAmount'));
                    if (isNaN(rest) || rest <= 0) return;
                    bcTotal += rest;
                    bcMonthly += parseFloat(loanEl.getAttribute('monthlyPayment')) || 0;
                    bcCount++;
                });
                loanVal = (parseFloat(loanVal) || 0) + bcTotal;
                result.bankCredit = { count: bcCount, total: Math.round(bcTotal), monthly: Math.round(bcMonthly) };
            } catch (err) {
                console.warn('Could not read bankCredit.xml', err);
            }
        }
        // Hire Purchasing (FS25_HirePurchasing) finances vehicles: each deal in
        // leaseDeals.xml is paid monthly (annuity at a rate set by the deposit
        // share, LeaseDeal:getInterestRate / getMonthlyPayment) plus a final
        // fee. What's still owed (LeaseDeal:getRemainingCost) counts as a loan.
        const leaseDealsPath = path.join(saveFolder, 'leaseDeals.xml');
        if (/<mod\b[^>]*modName="FS25_HirePurchasing"/.test(careerText) && !SAVE_DISABLED_MODS.has('hirePurchasing') && fs.existsSync(leaseDealsPath)) {
            try {
                const hpXml = fs.readFileSync(leaseDealsPath, 'utf-8');
                let hpTotal = 0, hpMonthly = 0, hpCount = 0;
                for (const m of hpXml.matchAll(/<deal\s[^>]*>/g)) {
                    const num = name => parseFloat((m[0].match(new RegExp('\\s' + name + '="([^"]*)"')) || [])[1]);
                    if (String(num('farmId')) !== SAVE_FARM_ID) continue;
                    const cost = num('baseCost'), deposit = num('deposit') || 0, months = num('durationMonths');
                    const finalFee = num('finalFee') || 0, paid = num('monthsPaid') || 0;
                    if (!(cost > 0) || !(months > 0)) continue;
                    const share = deposit / cost;
                    const rate = share <= 0.051 ? 0.05 : share <= 0.11 ? 0.04 : share <= 0.21 ? 0.035 : share <= 0.31 ? 0.0295 : 0.025;
                    const r = rate / 12, g = Math.pow(1 + r, months);
                    const monthly = (cost - deposit - finalFee / g) * (r * g) / (g - 1);
                    const left = Math.max(0, months - paid);
                    const remaining = monthly * left + finalFee;
                    if (remaining <= 0) continue;
                    hpTotal += remaining;
                    if (left > 0) hpMonthly += monthly;
                    hpCount++;
                }
                if (hpCount) {
                    loanVal = (parseFloat(loanVal) || 0) + hpTotal;
                    const prev = result.bankCredit || { count: 0, total: 0, monthly: 0 };
                    // bankCredit holds every mod loan summed (Finance tile: count · monthly).
                    result.bankCredit = { count: prev.count + hpCount, total: prev.total + Math.round(hpTotal), monthly: prev.monthly + Math.round(hpMonthly) };
                }
            } catch (err) {
                console.warn('Could not read leaseDeals.xml', err);
            }
        }
        if (loanVal !== null && loanVal !== undefined && loanVal !== "") result.loan = Math.round(parseFloat(loanVal));

        const currentDayStr = findValueInRawText(envText, 'currentDay');
        const daysPerPeriodStr = findValueInRawText(envText, 'daysPerPeriod') || findValueInRawText(careerText, 'plannedDaysPerPeriod') || "1";
        if (parseInt(daysPerPeriodStr) > 0) result.daysPerPeriod = parseInt(daysPerPeriodStr);

        if (currentDayStr) {
            const currentDay = parseInt(currentDayStr);
            const daysPerPeriod = parseInt(daysPerPeriodStr) || 1;
            const fsMonths = FS_PERIOD_TO_MONTH;
            // The game's own period counter runs 0,1,2,... forever (one per
            // in-game month) and never resets on the app's manual "seasons",
            // so it's the natural gap-free x-axis for the monthly history.
            const gamePeriod = Math.floor((currentDay - 1) / daysPerPeriod);
            result.gameDay = currentDay;
            result.dayInPeriod = ((currentDay - 1) % daysPerPeriod) + 1;
            result.gamePeriod = gamePeriod;
            result.gameYear = Math.floor(gamePeriod / 12) + 1;
            result.month = fsMonths[gamePeriod % 12];
        } else {
            let rawMonth = findValueInRawText(envText, 'currentMonth') || findValueInRawText(careerText, 'currentMonth');
            if (rawMonth) {
                const fsMonths = FS_PERIOD_TO_MONTH;
                const val = parseInt(rawMonth);
                const monthIndex = (val - 1 + 12) % 12;
                result.month = fsMonths[monthIndex];
            }
        }

        const vehiclesPath = path.join(saveFolder, 'vehicles.xml');
        if (fs.existsSync(vehiclesPath)) {
            const vehiclesXml = fs.readFileSync(vehiclesPath, 'utf-8');
            const vehiclesDoc = new DOMParser().parseFromString(vehiclesXml, "text/xml");
            const playerVehicles = vehiclesDoc.querySelectorAll(`vehicle[farmId="${SAVE_FARM_ID}"]`);
            result.equipment = playerVehicles.length;
        }

        const placeablesPath = path.join(saveFolder, 'placeables.xml');
        if (fs.existsSync(placeablesPath)) {
            const placeablesXml = fs.readFileSync(placeablesPath, 'utf-8');
            const placeablesDoc = new DOMParser().parseFromString(placeablesXml, "text/xml");
            let totalAnimals = 0;
            const bySpecies = {};
            const production = {};
            const buildings = [];
            const playerPlaceables = placeablesDoc.querySelectorAll(`placeable[farmId="${SAVE_FARM_ID}"]`);

            playerPlaceables.forEach(placeable => {
                const clustersEl = placeable.querySelector('husbandryAnimals');
                if (!clustersEl) return; // not an animal building at all — skip entirely

                const building = {
                    id: placeable.getAttribute('uniqueId') || placeable.getAttribute('filename') || String(buildings.length),
                    name: placeable.getAttribute('filename') || '',
                    clusters: [], food: [], production: []
                };
                let buildingHasAnimals = false;

                placeable.querySelectorAll('animal').forEach(animal => {
                    const num = parseInt(animal.getAttribute('numAnimals') || 0);
                    const subType = animal.getAttribute('subType');
                    const age = parseInt(animal.getAttribute('age') || 0);
                    const health = parseFloat(animal.getAttribute('health') || 0);
                    if (!subType || num <= 0) return;

                    totalAnimals += num;
                    bySpecies[subType] = (bySpecies[subType] || 0) + num;
                    const cluster = { subType, numAnimals: num, age, health };
                    // Reproduction state: progress % of the current pregnancy,
                    // whether the group is inseminated, months since the last birth.
                    if (animal.hasAttribute('reproduction')) cluster.reproduction = parseFloat(animal.getAttribute('reproduction')) || 0;
                    if (animal.hasAttribute('isInseminated')) cluster.isInseminated = animal.getAttribute('isInseminated') === 'true';
                    if (animal.hasAttribute('monthsSinceLastBirth')) cluster.monthsSinceLastBirth = parseInt(animal.getAttribute('monthsSinceLastBirth')) || 0;
                    if (animal.hasAttribute('hadABirth')) cluster.hadABirth = animal.getAttribute('hadABirth') === 'true';
                    building.clusters.push(cluster);
                    buildingHasAnimals = true;
                });

                if (!buildingHasAnimals) return;

                // What's currently in the feed trough — this is what runs out
                // and needs restocking, so it's the thing worth a warning bar.
                placeable.querySelectorAll('husbandryFood > fillLevel').forEach(el => {
                    const fillType = el.getAttribute('fillType');
                    const level = parseFloat(el.getAttribute('fillLevel')) || 0;
                    if (fillType) building.food.push({ fillType, level });
                });

                // Currently-stored/pending production (milk in the tank, eggs
                // waiting for pickup, etc.).
                placeable.querySelectorAll('husbandry > storage > node').forEach(node => {
                    const fillType = node.getAttribute('fillType');
                    const level = parseFloat(node.getAttribute('fillLevel')) || 0;
                    if (fillType && level > 0) {
                        building.production.push({ fillType, level });
                        production[fillType] = (production[fillType] || 0) + level;
                    }
                });
                placeable.querySelectorAll('husbandryPallets > pendingLiters').forEach(el => {
                    const fillType = el.getAttribute('fillType');
                    const liters = parseFloat(el.getAttribute('liters')) || 0;
                    if (fillType && liters > 0) {
                        building.production.push({ fillType, level: liters });
                        production[fillType] = (production[fillType] || 0) + liters;
                    }
                });

                buildings.push(building);
            });

            result.animals = totalAnimals;
            result.animalBreakdown = bySpecies;
            result.animalProduction = production;
            result.animalBuildings = buildings;
        }

        try { result.feedStock = readFeedStockFromSave(saveFolder); }
        catch (e) { console.error('Could not read feed stock from savegame', e); }
        try { result.feedBales = readFeedBalesFromSave(saveFolder); }
        catch (e) { console.error('Could not read bales from savegame', e); }
        try { result.mixerWagons = readMixerWagonsFromSave(saveFolder, modFiles.findModsDirs(pathToFile)); }
        catch (e) { console.error('Could not read mixer wagons from savegame', e); }
        try {
            result.feedMixers = readFeedMixersFromSave(saveFolder, modFiles.findModsDirs(pathToFile));
            // What sits in a mixer (finished feed and the crops waiting to be
            // mixed) is feed on the farm too.
            if (result.feedStock) {
                result.feedMixers.forEach(m => Object.entries(m.stock).forEach(([ft, litres]) => {
                    if (!isFeedFillType(ft)) return;
                    const e = result.feedStock[ft] || (result.feedStock[ft] = {});
                    e.mixer = (e.mixer || 0) + litres;
                }));
            }
        }
        catch (e) { console.error('Could not read feed mixers from savegame', e); }

        const playTimeVal = findValueInRawText(careerText, 'playTime');
        if (playTimeVal) {
            const minutes = parseFloat(playTimeVal);
            if (!isNaN(minutes)) {
                const hours = Math.floor(minutes / 60);
                const mins = Math.floor(minutes % 60);
                result.playTime = `${hours}h ${mins}m`;
            }
        }

    } catch (err) { console.error("Error reading savegame:", err); }
    return result;
}

// =============================================================
// SECTION 5: PLANNER VIEW LOGIC
// =============================================================
window.openPlanner = function (id) {
    let farm = getAllFarms().find(f => f.id === id);
    if (farm) {
        currentFarmId = farm.id;
        animalPictures.lookupFarmId = undefined;   // save path may have changed
        clearFieldSearch();

        loadFarmConfigs(farm);
        // Work on a fresh read, so the sync below never writes an older copy
        // of the farm over something saved while opening it.
        farm = getCurrentFarm() || farm;

        if (farm.saveGamePath) applyGameSaveToFarm(farm);
        refreshFarmlandInfo(farm);

        if (plannerTitle) plannerTitle.innerText = farm.mapName ? `${farm.name} · ${farm.mapName}` : farm.name;
        refreshPlannerHeader(farm);

        if (seasonNumberEl) seasonNumberEl.innerText = `${t('season')} ${farm.currentSeason || 1}`;

        setEditModeUi(false);

        viewedSeason = farm.currentSeason || 1;
        showPlannerView('plan');   // renders the season table
        maybeSuggestNewSeason(getCurrentFarm());
        maybeFillFromRotation(getCurrentFarm());

        if (dashboardView) dashboardView.style.display = 'none';
        if (plannerView) plannerView.style.display = 'flex';

        startAutoSync(farm.id);
        updateDiscordPresence();
    }
};

// Weeds from the save (fields.xml weedState = the weed foliage state:
// 0 none, 1-6 growing / alive, 7-9 dead after herbicide or weeding — see
// data/foliage/weed/weed.xml). A planner field (its number may join several
// game fields, "12-13") gets "to spray" while any of them has live weeds and
// "done" once they're all dead. Fields without weeds keep what you set.
// A state you set by hand (chip or work planner) wins until the game saves a
// different weedState for that field: the save may still show live weeds
// because the game hasn't saved since spraying, or because its per-field
// value lags behind. Returns true if any field changed.
function syncWeedsFromSave(farm) {
    const save = readSaveFields(farm);
    if (!save.ok) return false;
    const byId = weedStatesById(save);
    let changed = false;
    (farm.fields || []).forEach(field => {
        const ids = gameFieldIds(field);
        if (field.weedsManual !== undefined) {
            if (field.weedsManual === weedStatesKey(ids, byId)) return;
            delete field.weedsManual;
            changed = true;
        }
        const states = ids.map(id => byId[id]).filter(s => s > 0);
        if (!states.length) return;
        const next = states.some(s => s <= 6) ? 'needed' : 'done';
        // Dead weeds after hoeing are still "weeded mechanically".
        if (next === 'done' && field.weeds === 'hoed') return;
        if (field.weeds !== next) { field.weeds = next; changed = true; }
    });
    return changed;
}

// "12-13" -> ["12", "13"]
function gameFieldIds(field) {
    return String(field.number || '').split(/[^0-9]+/).filter(Boolean).map(s => String(parseInt(s, 10)));
}

function weedStatesById(save) {
    const byId = {};
    save.fields.forEach(f => { byId[f.id] = f.weedState; });
    return byId;
}

// The save's weedState of each game field behind a planner field, e.g. "3,0".
function weedStatesKey(ids, byId) {
    return ids.map(id => byId[id] || 0).join(',');
}

// Called after the weeds state is changed by hand: remembers what the save
// said at that moment, so syncWeedsFromSave leaves the choice alone until the
// game saves something new for this field.
function markWeedsManual(farm, field) {
    const save = readSaveFields(farm);
    if (!save.ok) return;
    field.weedsManual = weedStatesKey(gameFieldIds(field), weedStatesById(save));
}

// Reads the live savegame and merges any changed values into `farm`, persisting
// to disk when something actually moved. Returns true if a field changed.
// Shared by openPlanner (one-shot on open) and the real-time auto-sync loop.
function applyGameSaveToFarm(farm) {
    if (!farm || !farm.saveGamePath) return false;
    let changed = resolveGameFarmId(farm);
    useSaveFarm(farm);
    loadMoistureData(farm);
    const gameData = readGameSave(farm.saveGamePath);

    if (gameData.balance !== null && gameData.balance !== farm.balance) { farm.balance = gameData.balance; changed = true; }
    if (gameData.gameYear !== null && gameData.gameYear !== farm.yearNumber) {
        // The game's own year (from currentDay). It turns over in March, with
        // the game's first period — same as the Finances charts.
        farm.yearNumber = gameData.gameYear;
        changed = true;
    }
    if (gameData.month && gameData.month !== farm.month) {
        // Older saves without currentDay: no year from the game, so count a
        // December -> January rollover instead.
        if (gameData.gameYear === null && farm.month === 'DECEMBER' && gameData.month === 'JANUARY') {
            farm.yearNumber = (parseInt(farm.yearNumber, 10) || 1) + 1;
            changed = true;
        }
        farm.month = gameData.month;
        changed = true;
    }
    if (gameData.loan !== null && gameData.loan !== farm.loan) { farm.loan = gameData.loan; changed = true; }
    const bankCredit = gameData.bankCredit || null;
    if (JSON.stringify(bankCredit) !== JSON.stringify(farm.bankCredit || null)) { farm.bankCredit = bankCredit; changed = true; }
    if (gameData.equipment !== null && gameData.equipment !== farm.equipment) { farm.equipment = gameData.equipment; changed = true; }
    if (gameData.animals !== null && gameData.animals !== farm.animals) { farm.animals = gameData.animals; changed = true; }
    // Structured values: only count them as changed when their content moved,
    // otherwise every open/auto-sync tick would rewrite data.json and re-render.
    const setIfMoved = (key) => {
        if (gameData[key] === null || gameData[key] === undefined) return;
        if (JSON.stringify(gameData[key]) === JSON.stringify(farm[key])) return;
        farm[key] = gameData[key];
        changed = true;
    };
    ['animalBreakdown', 'animalProduction', 'animalBuildings', 'feedStock', 'feedBales', 'mixerWagons'].forEach(setIfMoved);
    if (gameData.feedMixers !== undefined && JSON.stringify(gameData.feedMixers) !== JSON.stringify(farm.feedMixers || [])) { farm.feedMixers = gameData.feedMixers; changed = true; }
    if (gameData.daysPerPeriod !== null && gameData.daysPerPeriod !== farm.daysPerPeriod) { farm.daysPerPeriod = gameData.daysPerPeriod; changed = true; }
    if (gameData.dayInPeriod !== null && gameData.dayInPeriod !== farm.dayInPeriod) { farm.dayInPeriod = gameData.dayInPeriod; changed = true; }
    if (gameData.playTime !== null && gameData.playTime !== farm.playTime) { farm.playTime = gameData.playTime; changed = true; }

    if (syncWeedsFromSave(farm)) changed = true;
    if (syncLeasesFromSave(farm)) changed = true;

    if (changed) saveFarmData(farm, { touch: false });

    // Log/refresh this in-game month's data point for the trend charts. Safe to
    // call every read — it only writes when the month rolls over or a value in
    // the current month actually moved.
    recordMonthlySnapshot(farm, gameData);

    return changed;
}

// Pushes the farm's current header/sidebar figures into the planner DOM.
// Kept separate from openPlanner so the auto-sync loop can refresh the numbers
// without resetting edit mode or the viewed season.
function refreshPlannerHeader(farm) {
    if (!farm) return;
    useCurrency(farm);
    if (plannerBalance) plannerBalance.innerText = finMoney(parseMoney(farm.balance));
    if (plannerMonth) {
        // Day of the in-game month next to its name ("MARCH 2") — only when a
        // month has more than one day, otherwise it'd always read "1".
        const showDay = parseInt(farm.daysPerPeriod) > 1 && parseInt(farm.dayInPeriod) > 0;
        plannerMonth.innerText = farm.month ? translateMonth(farm.month) + (showDay ? ` ${farm.dayInPeriod}` : '') : '–';
    }
    if (plannerYear) {
        plannerYear.value = parseInt(farm.yearNumber, 10) || 1;
        // Synced farms take the year from the save; only a farm without one
        // keeps the hand-edited counter.
        const fromGame = !!farm.saveGamePath;
        plannerYear.readOnly = fromGame;
        plannerYear.title = fromGame ? t('yearFromGameHint') : t('yearManualHint');
    }
    refreshNotesBadge(farm);

}

// =============================================================
// SECTION 4B: REAL-TIME SAVEGAME AUTO-SYNC
// =============================================================
// Farming Simulator only flushes the savegame to disk on manual save / autosave,
// so "real time" here means: watch the save folder and re-import automatically
// the moment the game writes a new (auto)save, without the user reopening the farm.
const AUTO_SYNC_INTERVAL_MS = 10000;
const AUTO_SYNC_FILES = [
    'careerSavegame.xml', 'environment.xml', 'farms.xml',
    'vehicles.xml', 'placeables.xml', 'items.xml', 'els_loans.xml', 'bankCredit.xml', 'leaseDeals.xml', 'fieldLeasingAgreements.xml'
];

let autoSyncTimer = null;
let autoSyncFarmId = null;
let autoSyncSavePath = null;    // cached so the tick doesn't re-read every farm
let autoSyncSeenSig = null;     // signature we've already imported
let autoSyncPendingSig = null;  // changed-but-not-yet-stable signature
let autoSyncToastTimer = null;

// Per farm (farm.autoSync), on by default. Farms from before this was per
// farm follow the old app-wide switch only if it was explicitly turned off.
function autoSyncSetting(farm) {
    if (farm && typeof farm.autoSync === 'boolean') return farm.autoSync;
    return getSetting(CONFIG_KEY_AUTO_SYNC) !== '0';
}

// A cheap fingerprint of the save folder: mtime + size of each relevant file.
// Changes whenever the game rewrites any of them; lets us skip re-parsing when
// nothing moved.
function computeSaveSignature(saveFilePath) {
    if (!saveFilePath) return null;
    const dir = path.dirname(saveFilePath);
    const parts = [];
    for (const name of AUTO_SYNC_FILES) {
        try {
            const st = fs.statSync(path.join(dir, name));
            parts.push(`${name}:${st.mtimeMs}:${st.size}`);
        } catch {
            parts.push(`${name}:-`);
        }
    }
    return parts.join('|');
}

function stopAutoSync() {
    if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
    autoSyncFarmId = null;
    autoSyncSavePath = null;
    autoSyncSeenSig = null;
    autoSyncPendingSig = null;
}

function startAutoSync(farmId) {
    stopAutoSync();
    const farm = getAllFarms().find(f => f.id === farmId);
    if (!farm || !autoSyncSetting(farm) || !farm.saveGamePath || !fs.existsSync(farm.saveGamePath)) return;

    autoSyncFarmId = farmId;
    autoSyncSavePath = farm.saveGamePath;
    autoSyncSeenSig = computeSaveSignature(farm.saveGamePath); // current state = already imported
    autoSyncTimer = setInterval(runAutoSyncTick, AUTO_SYNC_INTERVAL_MS);
}

function runAutoSyncTick() {
    // Bail if the user navigated away or switched farms.
    if (autoSyncFarmId == null || currentFarmId !== autoSyncFarmId) { stopAutoSync(); return; }

    // Cheap disk check first — only touch farm storage once the save actually moved.
    const sig = computeSaveSignature(autoSyncSavePath);
    if (!sig || sig === autoSyncSeenSig) return;

    // The game may still be part-way through writing several files. Wait until the
    // signature holds steady for one interval before we actually parse anything.
    if (sig !== autoSyncPendingSig) { autoSyncPendingSig = sig; return; }

    // Don't yank the user out of an active edit — leave the signature pending and
    // try again on the next tick once they're done.
    if (isEditMode) return;

    const farm = getAllFarms().find(f => f.id === autoSyncFarmId);
    if (!farm || !farm.saveGamePath) { stopAutoSync(); return; }

    autoSyncSeenSig = sig;
    autoSyncPendingSig = null;

    const changed = applyGameSaveToFarm(farm);
    if (changed) {
        refreshFarmlandInfo(farm);   // bought/sold land shows up in farmland.xml
        refreshPlannerHeader(farm);
        renderSeasonView();
        showAutoSyncToast();
        maybeSuggestNewSeason(getCurrentFarm());
        maybeFillFromRotation(getCurrentFarm());
    }
}

// text / ms: another message in the same toast (e.g. crops filled from the rotation).
function showAutoSyncToast(text, ms = 2500) {
    if (!autoSyncToast) return;
    autoSyncToast.textContent = text || t('autoSyncedToast');
    autoSyncToast.hidden = false;
    // force reflow so the transition runs even on rapid re-triggers
    void autoSyncToast.offsetWidth;
    autoSyncToast.classList.add('is-visible');
    clearTimeout(autoSyncToastTimer);
    autoSyncToastTimer = setTimeout(() => {
        autoSyncToast.classList.remove('is-visible');
        setTimeout(() => { autoSyncToast.hidden = true; }, 300);
    }, ms);
}

if (exitBtn) exitBtn.addEventListener('click', async () => { if (!(await discardEditsIfConfirmed())) return; stopAutoSync(); clearFarmConfigs(); plannerView.style.display = 'none'; dashboardView.style.display = 'flex'; currentFarmId = null; renderFarmList(getAllFarms()); updateDiscordPresence(); });

// Fields of one season: the archive (seasons/season_N.json) for a past
// season, the live farm.fields for the current one. [] if the archive is
// missing or unreadable.
function loadSeasonFields(farm, seasonNum) {
    if (!farm) return [];
    if (seasonNum >= (farm.currentSeason || 1)) return farm.fields || [];
    const archivePath = path.join(appDataDir, farm.folderName, 'seasons', `season_${seasonNum}.json`);
    if (!fs.existsSync(archivePath)) return [];
    try {
        return JSON.parse(fs.readFileSync(archivePath, 'utf-8')).fields || [];
    } catch (e) {
        console.error(e);
        return [];
    }
}

window.renderSeasonView = function () {
    const farm = getAllFarms().find(f => f.id === currentFarmId);
    if (!farm) return;

    const currentActiveSeason = farm.currentSeason || 1;
    const isPastSeason = viewedSeason < currentActiveSeason;
    const fieldsToDisplay = loadSeasonFields(farm, viewedSeason);

    renderFieldsTable(fieldsToDisplay);
    updateCropsSummary(fieldsToDisplay);

    if (seasonNumberEl) {
        // Disabled while editing (the edit table belongs to the current season).
        const lock = isEditMode ? ` disabled title="${t('seasonNavLocked')}"` : '';
        const leftArrow = `<button type="button" id="prev-season-btn" class="season-nav-btn" aria-label="${t('seasonPrev')}"${viewedSeason > 1 ? lock : ' disabled'}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>`;

        const rightArrow = `<button type="button" id="next-season-btn" class="season-nav-btn" aria-label="${t('seasonNext')}"${viewedSeason < currentActiveSeason ? lock : ' disabled'}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`;

        seasonNumberEl.innerHTML = `${leftArrow} ${t('season')} ${viewedSeason} ${rightArrow}`;

        const prevBtn = document.getElementById('prev-season-btn');
        const nextBtn = document.getElementById('next-season-btn');

        if (prevBtn) prevBtn.addEventListener('click', () => {
            if (isEditMode) return;
            viewedSeason--;
            renderSeasonView();
        });

        if (nextBtn) nextBtn.addEventListener('click', () => {
            if (isEditMode) return;
            viewedSeason++;
            renderSeasonView();
        });
    }

    const displayStyle = isPastSeason ? 'none' : 'inline-block';
    if (editSeasonBtn) editSeasonBtn.style.display = displayStyle;
    if (loadFieldsBtn) loadFieldsBtn.hidden = isPastSeason || isEditMode || !farm.saveGamePath;
    if (newSeasonBtn) newSeasonBtn.style.display = isEditMode ? 'none' : displayStyle;

    renderTodayPanel();

    // Field count may have changed (crop edits, new season) — refresh Discord.
    updateDiscordPresence();
};

// =============================================================
// SECTION 6: MAIN TABLE (ONE BUTTON LOGIC)
// =============================================================
// Season plan table, field window, work planner and Edit mode: fields-table.js (loaded after this file).

// =============================================================
// SECTION 7: CROPS SUMMARY SIDEBAR
// =============================================================
// Read-only: every crop planted on a field this season with its total area,
// plus catch crops (green rye, oilseed radish…) in their own section — they
// share hectares with the main crop, so adding them to one total would count
// the same land twice. Sorted in the game's own crop order by default; the
// column headers switch to name / area (click again to reverse, a third time
// to go back to game order).
let cropsSort = { key: 'game', dir: 1 };
try {
    const saved = JSON.parse(getSetting('cropsSort') || 'null');
    if (saved && ['game', 'name', 'ha'].includes(saved.key)) cropsSort = saved;
} catch (e) { /* storage unavailable — keep the default */ }

function saveCropsSort() {
    try { setSetting('cropsSort', JSON.stringify(cropsSort)); } catch (e) { /* ignore */ }
}

function sumCropArea(fields, cropKey) {
    const byCrop = new Map();
    fields.forEach(f => {
        const crop = f[cropKey];
        if (!crop) return;
        byCrop.set(crop, (byCrop.get(crop) || 0) + (parseFloat(f.area) || 0));
    });
    return [...byCrop.entries()].map(([name, totalHa]) => ({ name, totalHa }));
}

function sortCropRows(rows) {
    const { key, dir } = cropsSort;
    return rows.sort((a, b) => {
        let d = 0;
        if (key === 'ha') d = a.totalHa - b.totalHa;
        else if (key === 'name') d = translateCropName(a.name).localeCompare(translateCropName(b.name));
        else d = compareCropsGameOrder(a.name, b.name);
        return d * dir || compareCropsGameOrder(a.name, b.name);
    });
}

function cropSummaryRowsHtml(rows) {
    return sortCropRows(rows).map(crop => `
            <tr>
                <td>${translateCropName(crop.name)}</td>
                <td class="ha-value">${crop.totalHa.toFixed(2)} ha</td>
            </tr>`).join('');
}

function updateCropsSortHeaders() {
    document.querySelectorAll('#crops-table [data-sort]').forEach(th => {
        const active = cropsSort.key === th.dataset.sort;
        th.classList.toggle('is-sorted', active);
        th.setAttribute('aria-sort', active ? (cropsSort.dir > 0 ? 'ascending' : 'descending') : 'none');
    });
    const hint = document.getElementById('crops-sort-hint');
    if (hint) hint.textContent = cropsSort.key === 'game' ? t('cropsSortGame') : '';
}

function updateCropsSummary(fields) {
    if (!cropsBody) return;
    fields = fields || [];

    const mainRows = sumCropArea(fields, 'crop');
    const catchRows = sumCropArea(fields, 'catchCrop');

    updateCropsSortHeaders();

    if (mainRows.length === 0 && catchRows.length === 0) {
        cropsBody.innerHTML = `<tr><td colspan="2" class="empty-row-message">${t('noPlannedCrops')}</td></tr>`;
        return;
    }

    let html = cropSummaryRowsHtml(mainRows);
    if (catchRows.length) {
        const catchTotal = catchRows.reduce((s, r) => s + r.totalHa, 0);
        html += `<tr class="crops-section-row"><td>${t('catchCropsTitle')}</td><td class="ha-value">${catchTotal.toFixed(2)} ha</td></tr>`;
        html += cropSummaryRowsHtml(catchRows);
    }
    cropsBody.innerHTML = html;
}

document.querySelectorAll('#crops-table [data-sort]').forEach(th => {
    th.addEventListener('click', () => {
        const key = th.dataset.sort;
        // ha starts biggest-first; name A→Z; the third click returns to game order.
        const firstDir = key === 'ha' ? -1 : 1;
        if (cropsSort.key !== key) cropsSort = { key, dir: firstDir };
        else if (cropsSort.dir === firstDir) cropsSort = { key, dir: -firstDir };
        else cropsSort = { key: 'game', dir: 1 };
        saveCropsSort();
        renderSeasonView();
    });
});

// =============================================================
// SECTION 8: NEW SEASON LOGIC
// =============================================================
// The app's one dialog (#app-dialog) for every confirm and message.
// Resolves true on the main button, 'extra' on the optional third button
// (left, e.g. "Undo liming"), false on Cancel, a click on the backdrop or
// Escape. Without cancelText it's a one-button notice.
function showDialog({ title, body, confirmText, cancelText = null, extraText = null, danger = false, icon = 'fa-seedling' }) {
    const modal = document.getElementById('app-dialog');
    if (!modal) return Promise.resolve(window.confirm(body));
    const content = modal.querySelector('.app-dialog-content');
    const iconEl = document.getElementById('app-dialog-icon');
    const confirmBtn = document.getElementById('app-dialog-confirm');
    const cancelBtn = document.getElementById('app-dialog-cancel');
    const extraBtn = document.getElementById('app-dialog-extra');

    document.getElementById('app-dialog-title').textContent = title;
    document.getElementById('app-dialog-body').textContent = body || '';
    iconEl.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    iconEl.classList.toggle('is-danger', danger);
    content.classList.toggle('is-danger', danger);
    content.classList.toggle('has-extra', !!extraText);
    confirmBtn.textContent = confirmText || t('seasonModalOk');
    confirmBtn.classList.toggle('danger-btn', danger);
    cancelBtn.textContent = cancelText || '';
    cancelBtn.style.display = cancelText ? '' : 'none';
    extraBtn.textContent = extraText || '';
    extraBtn.hidden = !extraText;

    return new Promise(resolve => {
        const finish = result => {
            closeModal(modal);
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            extraBtn.removeEventListener('click', onExtra);
            modal.removeEventListener('mousedown', onBackdrop);
            document.removeEventListener('keydown', onKey, true);
            resolve(result);
        };
        const onConfirm = () => finish(true);
        const onCancel = () => finish(false);
        const onExtra = () => finish('extra');
        const onBackdrop = e => { if (e.target === modal) finish(false); };
        const onKey = e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        };
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        extraBtn.addEventListener('click', onExtra);
        modal.addEventListener('mousedown', onBackdrop);
        document.addEventListener('keydown', onKey, true);
        openModal(modal);
        confirmBtn.focus();
    });
}

// Yes/no question -> Promise<boolean | 'extra'>. danger = red button (deleting).
function showConfirm({ title, body, confirmText, cancelText, extraText = null, danger = false, icon }) {
    return showDialog({
        title, body, extraText, danger,
        confirmText: confirmText || t('confirm'),
        cancelText: cancelText || t('cancel'),
        icon: icon || (danger ? 'fa-trash-can' : 'fa-circle-question')
    });
}

// One-button message; isError = red, with a warning icon.
function showNotice(title, body, isError = false) {
    return showDialog({
        title, body,
        confirmText: t('seasonModalOk'),
        danger: isError,
        icon: isError ? 'fa-triangle-exclamation' : 'fa-circle-check'
    });
}

// Crops that keep growing for years once sown — "New Season" carries them
// over (still planted) instead of clearing the field.
const PERENNIAL_CROPS = FEED_GRASSLAND_CROPS;
function isPerennialCrop(crop) {
    return PERENNIAL_CROPS.some(c => cropOrderKey(c) === cropOrderKey(crop || ''));
}
// Crops whose fruit XML has <soil consumesLime="false">: harvesting them
// doesn't lower pH. Base game (data/foliage/*/*.xml): grass, every meadow,
// oilseed radish and both rices; cut crops (grassland, teff, field grass)
// per the maps' fruit XML.
const NO_LIME_CROPS = ['Oilseedradish', 'Rice', 'Ricelonggrain'];
function cropKeepsLime(crop) {
    return isCutCrop(crop) || NO_LIME_CROPS.some(c => cropOrderKey(c) === cropOrderKey(crop || ''));
}

if (newSeasonBtn) newSeasonBtn.addEventListener('click', () => runNewSeason());

// New season: archive the current one, clear the fields for the next. Keeps
// what's needed to take it back (seasons/undo_new_season.json, see
// undoLastNewSeason). intro: optional text shown above the usual confirmation
// (the in-game year reminder).
async function runNewSeason({ intro = '' } = {}) {
    {
        if (!currentFarmId) return;
        if (!(await discardEditsIfConfirmed())) return;

        const startFarm = getAllFarms().find(f => f.id === currentFarmId);
        if (!startFarm) return;
        const seasonNow = parseInt(startFarm.currentSeason) || 1;
        const fill = s => s.replace(/\{c\}/g, seasonNow).replace(/\{n\}/g, seasonNow + 1);
        // Fields with a crop rotation get their next crop (asked here in 'ask' mode).
        const rotationMode = rotationFillMode(startFarm);
        const rotationCount = rotationMode === 'off' ? 0 : rotationFieldCount(startFarm);
        const rotationText = rotationCount ? '\n\n' + t('rotNewSeasonInfo').replace('{n}', rotationCount) : '';
        const confirmNew = await showDialog({
            title: fill(t('newSeasonTitle')),
            body: (intro ? intro + '\n\n' : '') + fill(t('newSeasonBody')) + rotationText,
            confirmText: fill(t('newSeasonConfirm')),
            cancelText: t('cancel'),
            extraText: rotationCount && rotationMode === 'ask' ? t('rotNewSeasonSkip') : null,
            icon: 'fa-seedling'
        });
        if (!confirmNew) return;
        const fillFromRotation = rotationCount > 0 && confirmNew === true;

        const allFarms = getAllFarms();
        const farmIndex = allFarms.findIndex(f => f.id === currentFarmId);
        if (farmIndex === -1) return;

        const farm = allFarms[farmIndex];
        const currentSeasonNum = parseInt(farm.currentSeason) || 1;

        try {
            const seasonsDirPath = path.join(appDataDir, farm.folderName, 'seasons');
            if (!fs.existsSync(seasonsDirPath)) fs.mkdirSync(seasonsDirPath, { recursive: true });

            const archivePath = path.join(seasonsDirPath, `season_${currentSeasonNum}.json`);
            // An archive for this season number already exists (e.g. left over
            // after an undo or a manual copy) — keep it under another name
            // instead of overwriting it.
            if (fs.existsSync(archivePath)) {
                fs.renameSync(archivePath, archivePath.replace(/\.json$/, `_replaced_${Date.now()}.json`));
            }
            // Everything needed to take this new season back.
            const undoData = {
                season: currentSeasonNum,
                fields: JSON.parse(JSON.stringify(farm.fields || [])),
                fertPlan: JSON.parse(JSON.stringify((farm.supplyRates && farm.supplyRates.fertPlan) || {})),
                seasonStartedGameYear: farm.seasonStartedGameYear ?? null,
                createdAt: new Date().toISOString()
            };
            const archivedAvgHealth = avgHealthFromBuildings(farm.animalBuildings);

            const archiveData = {
                season: currentSeasonNum,
                dateArchived: new Date().toISOString(),
                fields: JSON.parse(JSON.stringify(farm.fields)),
                balance: farm.balance,
                loan: farm.loan || 0,
                animals: farm.animals || 0,
                avgHealth: archivedAvgHealth,
                fertPlan: JSON.parse(JSON.stringify((farm.supplyRates && farm.supplyRates.fertPlan) || {}))
            };
            fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2), 'utf-8');

            const supplyRatesForLime = getSupplyRates();
            farm.fields.forEach((field, i) => {
                // Read before the crop is cleared.
                const keepsLime = cropKeepsLime(field.crop);
                if (isPerennialCrop(field.crop)) {
                    // Grassland stays sown for years: keep the crop, sowing
                    // month and tillage; only this season's work is cleared.
                    field.state = "Planted";
                } else {
                    field.crop = "";
                    field.sowingMonth = "";
                    field.state = "To Plant";
                    field.tillage = null;
                }
                field.catchCrop = "";
                field.catchSowingMonth = "";
                field.rolling = false;
                field.rollingDone = false;
                field.cuts = [];
                // limeAppliedSeason is intentionally left untouched — it's
                // display-only metadata now (see limePh below for the actual
                // decaying value).
                // One harvest = one "New Season" click: decay this field's pH
                // by one step (soil-mix-weighted). resolveLimePh backfills a
                // field that predates this model instead of resetting it.
                const soilMix = getFieldSoilMix(fertPlanSoilKey(field, i), supplyRatesForLime);
                const resolvedPh = resolveLimePh(field, currentSeasonNum, soilMix);
                // consumesLime="false" crops (grassland, oilseed radish, rice)
                // don't lower pH when harvested; everything else does.
                const limeDrop = keepsLime ? 0 : fieldLimePhDrop(soilMix);
                field.limePh = (resolvedPh == null) ? null : Math.max(0, resolvedPh - limeDrop);
                field.manure = false;
                field.fertilizer = false;
                field.weeds = null;
                delete field.weedsManual;
                delete field.work;
                delete field.workCleared;
                // Undo only covers the season the liming was made in.
                delete field.limePrev;
            });
            // Fertilization plans ("N already in the soil", natural N) belong to
            // the season just archived — a new crop on the same field starts clean.
            if (farm.supplyRates) farm.supplyRates.fertPlan = {};

            const rotationFilled = advanceRotationsForNewSeason(farm, currentSeasonNum + 1, fillFromRotation);
            farm.currentSeason = currentSeasonNum + 1;
            farm.seasonStartedGameYear = parseInt(farm.yearNumber, 10) || null;
            saveFarmData(farm);
            fs.writeFileSync(path.join(seasonsDirPath, 'undo_new_season.json'), JSON.stringify(undoData, null, 2), 'utf-8');
            refreshUndoSeasonButton(farm);

            setEditModeUi(false);
            viewedSeason = farm.currentSeason;
            renderSeasonView();

            const done = s => s.replace(/\{c\}/g, currentSeasonNum).replace(/\{n\}/g, farm.currentSeason);
            await showNotice(done(t('newSeasonDoneTitle')), done(t('newSeasonDone'))
                + (rotationFilled.length ? '\n\n' + t('rotNewSeasonDone').replace('{list}', rotationFilledList(rotationFilled)) : ''));
        } catch (err) {
            console.error(err);
            await showNotice(t('seasonModalErrorTitle'), t('newSeasonError'), true);
        }
    }
}

function undoSeasonPath(farm) {
    return path.join(appDataDir, farm.folderName, 'seasons', 'undo_new_season.json');
}

// The undo is only valid right after that new season: same season number.
function readUndoSeason(farm) {
    try {
        const p = farm && farm.folderName ? undoSeasonPath(farm) : null;
        if (!p || !fs.existsSync(p)) return null;
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return data && data.season + 1 === (parseInt(farm.currentSeason, 10) || 1) ? data : null;
    } catch (e) {
        return null;
    }
}

function refreshUndoSeasonButton(farm) {
    const btn = document.getElementById('undo-season-btn');
    if (!btn) return;
    const undo = readUndoSeason(farm);
    btn.hidden = !undo;
    if (undo) btn.textContent = t('undoNewSeason').replace('{n}', undo.season + 1).replace('{c}', undo.season);
}

// Takes the last new season back: fields, fertilization plans and the season
// number as they were; the archive written for it is removed. Work done in the
// new season is lost, so it asks first.
async function undoLastNewSeason() {
    const farm = getCurrentFarm();
    const undo = readUndoSeason(farm);
    if (!farm || !undo) return;
    const settingsModalEl = document.getElementById('settings-modal');
    if (settingsModalEl) settingsModalEl.style.display = 'none';
    const fill = s => s.replace(/{n}/g, undo.season + 1).replace(/{c}/g, undo.season);
    const ok = await showDialog({
        title: fill(t('undoNewSeasonTitle')),
        body: fill(t('undoNewSeasonBody')),
        confirmText: fill(t('undoNewSeasonConfirm')),
        cancelText: t('cancel'),
        danger: true,
        icon: 'fa-rotate-left'
    });
    if (!ok) return;
    if (!(await discardEditsIfConfirmed())) return;
    try {
        farm.fields = undo.fields;
        if (!farm.supplyRates) farm.supplyRates = {};
        farm.supplyRates.fertPlan = undo.fertPlan || {};
        farm.currentSeason = undo.season;
        farm.seasonStartedGameYear = undo.seasonStartedGameYear;
        saveFarmData(farm);
        const archivePath = path.join(appDataDir, farm.folderName, 'seasons', `season_${undo.season}.json`);
        if (fs.existsSync(archivePath)) fs.rmSync(archivePath);
        fs.rmSync(undoSeasonPath(farm));
        refreshUndoSeasonButton(farm);
        viewedSeason = farm.currentSeason;
        if (seasonNumberEl) seasonNumberEl.innerText = `${t('season')} ${farm.currentSeason}`;
        renderSeasonView();
        await showNotice(fill(t('undoNewSeasonDoneTitle')), fill(t('undoNewSeasonDone')));
    } catch (err) {
        console.error('Undo new season failed', err);
        await showNotice(t('seasonModalErrorTitle'), t('newSeasonError'), true);
    }
}

const undoSeasonBtn = document.getElementById('undo-season-btn');
if (undoSeasonBtn) undoSeasonBtn.addEventListener('click', () => undoLastNewSeason());

// A year went by in the game since this season started — offer a new season
// once per in-game year (farm.seasonHintYear). The first sync only notes the
// year the season is in.
function maybeSuggestNewSeason(farm) {
    if (!farm || !farm.saveGamePath || isEditMode) return;
    const year = parseInt(farm.yearNumber, 10);
    if (!(year > 0)) return;
    if (!(parseInt(farm.seasonStartedGameYear, 10) > 0)) {
        farm.seasonStartedGameYear = year;
        saveFarmData(farm, { touch: false });
        return;
    }
    if (year <= farm.seasonStartedGameYear || farm.seasonHintYear === year) return;
    farm.seasonHintYear = year;
    saveFarmData(farm, { touch: false });
    const intro = t('newSeasonYearHint').replace('{y}', year).replace('{s}', farm.seasonStartedGameYear);
    setTimeout(() => runNewSeason({ intro }), 600);
}

if (resetSeasonsBtn) {
    resetSeasonsBtn.addEventListener('click', async () => {
        if (!currentFarmId) return;
        const settingsModalEl = document.getElementById('settings-modal');
        if (settingsModalEl) settingsModalEl.style.display = 'none';
        if (!(await discardEditsIfConfirmed())) return;

        const confirmReset = await showDialog({
            title: t('resetSeasonsTitle'),
            body: t('resetSeasonsBody'),
            confirmText: t('resetSeasonsConfirm'),
            cancelText: t('cancel'),
            danger: true,
            icon: 'fa-trash-can'
        });
        if (!confirmReset) return;

        const allFarms = getAllFarms();
        const farmIndex = allFarms.findIndex(f => f.id === currentFarmId);
        if (farmIndex === -1) return;

        const farm = allFarms[farmIndex];

        const seasonsDirPath = path.join(appDataDir, farm.folderName, 'seasons');
        if (fs.existsSync(seasonsDirPath)) {
            try {
                fs.rmSync(seasonsDirPath, { recursive: true, force: true });
            } catch (err) {
                console.error("Could not delete the season archive:", err);
                await showNotice(t('seasonModalErrorTitle'), t('resetSeasonsError'), true);
                return;
            }
        }

        farm.currentSeason = 1;
        saveFarmData(farm);

        viewedSeason = 1;
        setEditModeUi(false);
        renderSeasonView();

        await showNotice(t('resetSeasonsDoneTitle'), t('resetSeasonsDone'));
    });
}

// =============================================================
// SECTION 9: SETTINGS LOGIC
// =============================================================
let pendingCropFiles = null;
let pendingAnimalDefFiles = null;

// Settings: every mod the app can read, whether it's active in the farm's
// savegame, and a per-farm switch (off = base-game rules for that part).
// AFC / EAS also show what they currently change.
function renderAnimalModsInfo(farm) {
    const box = document.getElementById('animal-mods-info');
    if (!box) return;
    const hasSave = !!(farm && farm.saveGamePath);
    const disabled = disabledModsOf(farm);
    const prevActive = SAVE_ACTIVE_MODS;
    SAVE_ACTIVE_MODS = hasSave ? activeModsInSave(farm.saveGamePath) : new Set();
    const mods = ANIMAL_MODS || {};
    let html = hasSave ? '' : `<p class="animal-mods-note">${t('modsNoSave')}</p>`;
    SUPPORTED_MODS.forEach(def => {
        const inSave = hasSave && modActiveInSave(def, farm.saveGamePath);
        let detail = t('modDesc_' + def.id);
        if (def.id === 'afc' && mods.afc) {
            const afc = mods.afc;
            const scale = afc.enabled ? (afc.autoScaleByDays ? feedDaysPerPeriod(farm) : 1) * afc.customMultiplier : 1;
            const src = t('afcSource_' + afc.referenceSource) || afc.referenceSource;
            detail += ' · ' + t('afcModeLine').replace('{mode}', t('afcMode_' + afc.mode) || afc.mode).replace('{x}', scale.toLocaleString(undefined, { maximumFractionDigits: 2 })).replace('{src}', src);
        }
        if (def.id === 'eas' && mods.eas) {
            const species = Object.keys(mods.eas.lactation).map(tp => formatAnimalName(tp)).join(', ') || '–';
            detail += ' · ' + t('easLine').replace('{list}', species);
        }
        if (def.id === 'cropRolling' && inSave) {
            const noRolling = AVAILABLE_CROPS.filter(c => !cropRollingRule(c)).map(translateCropName).join(', ') || '–';
            detail += ' · ' + t('cropRollingLine').replace('{list}', noRolling);
        }
        if (def.id === 'moisture' && inSave && MOISTURE_DATA && farm.id === currentFarmId) {
            detail += ' · ' + t('moistureModLine').replace('{pct}', formatMoisturePct(MOISTURE_DATA.moisture));
        }
        html += `<label class="animal-mod-row${inSave ? '' : ' is-inactive'}">
            <input type="checkbox" class="supported-mod-toggle" data-mod="${def.id}" ${disabled.has(def.id) ? '' : 'checked'} ${inSave ? '' : 'disabled'}>
            <span><strong>${escapeHtml(def.name)}</strong><span class="mod-status ${inSave ? 'mod-status--on' : 'mod-status--off'}">${t(inSave ? 'modStatusActive' : 'modStatusMissing')}</span> — ${escapeHtml(detail)}</span></label>`;
    });
    SAVE_ACTIVE_MODS = prevActive;
    box.innerHTML = html;
}

// Settings: which farm of a multiplayer save is yours. Hidden for a save
// with a single farm (single player).
// Farm settings tabs (Savegame / Planner / Mods / Rates / Advanced).
function showSettingsTab(name) {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
    modal.querySelectorAll('[data-settings-tab]').forEach(el => el.classList.toggle('is-active-tab', el.dataset.settingsTab === name));
    if (name === 'rates') {
        const d = modal.querySelector('#settings-supply-adjust details');
        if (d) d.open = true;
    }
    const content = modal.querySelector('.modal-content');
    if (content) content.scrollTop = 0;
}
document.querySelectorAll('#settings-modal .settings-tab').forEach(b => b.addEventListener('click', () => showSettingsTab(b.dataset.tab)));

// Live check of the savegame path: what's there, or why it won't work —
// a wrong path used to be ignored without a word on save.
function checkSavePathInput() {
    const input = document.getElementById('game-save-path');
    const out = document.getElementById('save-path-check');
    if (!input || !out) return;
    let p = input.value.trim().replace(/"/g, '');
    if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'careerSavegame.xml');
    out.classList.remove('is-ok', 'is-bad');
    if (!p) { out.textContent = ''; return; }
    if (!fs.existsSync(p)) { out.textContent = t('savePathMissing'); out.classList.add('is-bad'); return; }
    try {
        const xml = fs.readFileSync(p, 'utf-8');
        const tag = name => decodeXmlEntities((xml.match(new RegExp('<' + name + '>([^<]*)</' + name + '>')) || [])[1] || '');
        if (!/<careerSavegame\b/.test(xml)) throw new Error('not a career savegame');
        const money = parseFloat(tag('money'));
        out.textContent = t('savePathFound').replace('{name}', tag('savegameName') || '?').replace('{map}', tag('mapTitle') || '?')
            .replace('{money}', isNaN(money) ? '–' : finMoney(money));
        out.classList.add('is-ok');
    } catch (e) {
        out.textContent = t('savePathNotSave');
        out.classList.add('is-bad');
    }
}
const gameSavePathField = document.getElementById('game-save-path');
if (gameSavePathField) gameSavePathField.addEventListener('input', checkSavePathInput);

function renderGameFarmChoice(farm) {
    const row = document.getElementById('game-farm-row');
    const select = document.getElementById('game-farm-select');
    if (!row || !select) return;
    const farms = farm && farm.saveGamePath ? listSaveFarms(farm.saveGamePath) : [];
    row.hidden = farms.length < 2;
    const current = gameFarmIdOf(farm);
    select.innerHTML = farms.map(f =>
        `<option value="${escapeHtml(f.id)}" ${f.id === current ? 'selected' : ''}>${escapeHtml(f.name || t('gameFarmUnnamed'))} (#${escapeHtml(f.id)})</option>`).join('');
}

function refreshFarmlandInfo(farm) {
    FARMLAND_INFO = (farm && farm.showFarmlandArea && farm.saveGamePath) ? readFarmlandAreas(farm.saveGamePath, gameFarmIdOf(farm)) : null;
    refreshPfFieldData(farm);
}

// Precision Farming's real soil pH and nitrogen per field, from the save's
// pH / nitrogen maps (savegame-soil.js). Read on open and on every sync;
// null without a save, without PF or with PF switched off.
let PF_FIELD_DATA = null;

function refreshPfFieldData(farm) {
    PF_FIELD_DATA = null;
    if (!farm || !farm.saveGamePath) return;
    useSaveFarm(farm);
    if (!modEnabled('precisionFarming')) return;
    const res = readFieldSoilFromSave(farm.saveGamePath);
    if (res.ok && (res.hasPh || res.hasNitrogen)) PF_FIELD_DATA = { farmId: farm.id, fields: res.fields };
}

// A planner field number ("12" or joined "12-13") -> its PF data, area-weighted
// across the game fields: { ph: { avg, optimal, limeL } | null, nitrogen: { avg } | null }.
function pfFieldData(key) {
    if (!PF_FIELD_DATA || PF_FIELD_DATA.farmId !== currentFarmId || !key) return null;
    const parts = String(key).split(/[^0-9]+/).filter(Boolean).map(s => String(parseInt(s, 10)))
        .map(id => PF_FIELD_DATA.fields[id]).filter(Boolean);
    if (!parts.length) return null;
    const weigh = (pick, val) => {
        const list = parts.filter(p => pick(p));
        const ha = list.reduce((s, p) => s + p.ha, 0);
        return ha ? list.reduce((s, p) => s + val(p) * p.ha, 0) / ha : null;
    };
    const phAvg = weigh(p => p.ph, p => p.ph.avg);
    const nAvg = weigh(p => p.nitrogen, p => p.nitrogen.avg);
    return {
        ph: phAvg == null ? null : {
            avg: phAvg,
            optimal: weigh(p => p.ph, p => p.ph.optimal),
            limeL: parts.reduce((s, p) => s + (p.ph ? p.ph.limeL : 0), 0)
        },
        nitrogen: nAvg == null ? null : { avg: nAvg }
    };
}

// The lime gauge from PF's real pH: full at the soil's optimum, 75 % (the
// "needs lime" line) a quarter pH step-group below it, empty 1 pH below.
function pfLimeStatus(pfPh) {
    const deficit = Math.max(0, pfPh.optimal - pfPh.avg);
    const ph = Math.max(0, Math.min(1, 1 - deficit));
    return { ph, status: ph > 0.75 ? 'active' : 'warning', pf: pfPh };
}

// Land plot area behind a field key ("12" or combined "12-13"), or null.
function farmlandAreaForKey(key) {
    if (!FARMLAND_INFO || !FARMLAND_INFO.ok || !key) return null;
    const ids = String(key).split(/[^0-9]+/).filter(Boolean).map(s => String(parseInt(s, 10)));
    if (!ids.length || ids.some(id => FARMLAND_INFO.areas[id] === undefined)) return null;
    return ids.reduce((s, id) => s + FARMLAND_INFO.areas[id], 0);
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        const farm = getAllFarms().find(f => f.id === currentFarmId);
        if (gameSavePathInput) gameSavePathInput.value = farm ? (farm.saveGamePath || "") : "";
        if (settingsMapNameInput) settingsMapNameInput.value = farm ? (farm.mapName || "") : "";
        if (autoSyncToggle) autoSyncToggle.checked = autoSyncSetting(farm);
        const flToggle = document.getElementById('farmland-area-toggle');
        if (flToggle) flToggle.checked = !!(farm && farm.showFarmlandArea);
        const modsDirInfo = document.getElementById('mods-dir-info');
        if (modsDirInfo) {
            const dirs = farm && farm.saveGamePath ? modFiles.findModsDirs(farm.saveGamePath) : [];
            modsDirInfo.textContent = dirs.length
                ? t('modsDirInfo').replace('{dir}', dirs[0]) + (dirs.length > 1 ? ' ' + t('modsDirInfoMore').replace('{n}', dirs.length - 1) : '')
                : '';
            modsDirInfo.title = dirs.join('\n');
        }
        renderAnimalModsInfo(farm);
        renderGameFarmChoice(farm);
        refreshUndoSeasonButton(farm);
        showSettingsTab('save');
        checkSavePathInput();
        renderFieldBackupChoice(farm);
        const grassLimitInput = document.getElementById('grassland-limit-input');
        if (grassLimitInput) grassLimitInput.value = grasslandSeasonLimit(farm);
        const currencySelect = document.getElementById('currency-select');
        if (currencySelect) currencySelect.value = (farm && farm.currency) || 'auto';
        if (cropsFolderInput) cropsFolderInput.value = farm ? (farm.cropsSourceLabel || "") : "";
        if (animalDefsFolderInput) animalDefsFolderInput.value = farm ? (farm.animalDefsSourceLabel || "") : "";
        // Manual import is rarely needed: folded unless this farm already uses it.
        const advanced = document.getElementById('settings-advanced');
        if (advanced) advanced.open = !!(farm && (farm.cropsSourceLabel || farm.animalDefsSourceLabel));
        if (cropsLoadedInfo) {
            let info = AVAILABLE_CROPS.length > 0
                ? `${t('currentlyLoaded')}: ${AVAILABLE_CROPS.length} ${t('cropsLoaded')}`
                : t('noCropsLoadedYet');
            if (mapCropsInfo && mapCropsInfo.ok) info += ' ' + t('cropsFromMapMod').replace('{mod}', mapCropsInfo.modName);
            cropsLoadedInfo.innerText = info;
        }
        if (animalDefsLoadedInfo) {
            const animalCount = Object.keys(ANIMAL_NEEDS_DATA).length;
            animalDefsLoadedInfo.innerText = animalCount > 0
                ? `${t('animalBreedsLoaded')}: ${animalCount}.`
                : t('noAnimalDefsYet');
        }
        pendingCropFiles = null;
        pendingAnimalDefFiles = null;

        // "Adjust rates" (relocated from Zaopatrzenie) — re-rendered fresh
        // every time Settings opens so the per-crop table matches this farm's
        // current fields.
        const supplyAdjustContainer = document.getElementById('settings-supply-adjust');
        if (supplyAdjustContainer) {
            const rates = getSupplyRates();
            const cropList = [...new Set(((farm && farm.fields) || []).map(f => f.crop).filter(Boolean))].sort();
            supplyAdjustContainer.innerHTML = renderSettingsSupplyAdjust(rates, cropList);
            wireSettingsSupplyAdjust(supplyAdjustContainer);
        }

        if (settingsModal) {
            openModal(settingsModal);
            const content = settingsModal.querySelector('.modal-content');
            if (content) content.scrollTop = 0;
        }
    });
}

if (browseSaveBtn && gameSavePathInput) {
    browseSaveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const result = await ipcRenderer.invoke('show-open-dialog', {
            title: t('gameSavePathLabel'),
            properties: ['openFile'],
            filters: [{ name: 'careerSavegame.xml', extensions: ['xml'] }, { name: 'All files', extensions: ['*'] }]
        });
        if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;
        gameSavePathInput.value = result.filePaths[0];
        checkSavePathInput();
    });
}

if (browseCropsBtn && cropsFolderPicker && cropsFolderInput) {
    browseCropsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        cropsFolderPicker.click();
    });

    cropsFolderPicker.addEventListener('change', (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        pendingCropFiles = files;

        // Best-effort friendly label for the picked root folder — purely
        // cosmetic, falls back to a file count if it can't be derived.
        let rootLabel = t('filesSelected').replace('{n}', files.length);
        try {
            const first = files[0];
            const absPath = first.path || (webUtils ? webUtils.getPathForFile(first) : "");
            const relPath = first.webkitRelativePath || "";
            if (absPath && relPath) {
                const relNative = relPath.split('/').join(path.sep);
                if (absPath.endsWith(relNative)) {
                    rootLabel = absPath.slice(0, absPath.length - relNative.length).replace(/[\\/]+$/, '');
                }
            }
        } catch (err) { /* keep the file-count fallback */ }

        cropsFolderInput.value = rootLabel;
        if (cropsLoadedInfo) cropsLoadedInfo.innerText = `${t('readyToScan')} ${files.length} ${t('clickSaveImport')}`;
    });
}

if (browseAnimalDefsBtn && animalDefsFolderPicker && animalDefsFolderInput) {
    browseAnimalDefsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        animalDefsFolderPicker.click();
    });

    animalDefsFolderPicker.addEventListener('change', (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        pendingAnimalDefFiles = files;

        let rootLabel = t('filesSelected').replace('{n}', files.length);
        try {
            const first = files[0];
            const absPath = first.path || (webUtils ? webUtils.getPathForFile(first) : "");
            const relPath = first.webkitRelativePath || "";
            if (absPath && relPath) {
                const relNative = relPath.split('/').join(path.sep);
                if (absPath.endsWith(relNative)) {
                    rootLabel = absPath.slice(0, absPath.length - relNative.length).replace(/[\\/]+$/, '');
                }
            }
        } catch (err) { /* keep the file-count fallback */ }

        animalDefsFolderInput.value = rootLabel;
        if (animalDefsLoadedInfo) animalDefsLoadedInfo.innerText = `${t('readyToScan')} ${files.length} ${t('clickSaveImport')}`;
    });
}

if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
        if ((pendingCropFiles && pendingCropFiles.length > 0) || (pendingAnimalDefFiles && pendingAnimalDefFiles.length > 0)) {
            let combined = {};
            let animalNeeds = {};
            let xmlCount = 0;
            let cropsFound = 0;
            let animalDefsFound = 0;
            let animalFiles = [];
            let readErrors = [];

            if (pendingCropFiles && pendingCropFiles.length > 0) {
                const r = buildCropsCalendarFromFiles(pendingCropFiles);
                combined = { ...combined, ...r.combined };
                animalNeeds = { ...animalNeeds, ...r.animalNeeds };
                xmlCount += r.xmlCount;
                cropsFound += r.cropsFound;
                animalDefsFound += r.animalDefsFound;
                animalFiles = animalFiles.concat(r.animalFiles);
                readErrors = readErrors.concat(r.readErrors);
            }
            if (pendingAnimalDefFiles && pendingAnimalDefFiles.length > 0) {
                const r = buildCropsCalendarFromFiles(pendingAnimalDefFiles);
                combined = { ...combined, ...r.combined };
                animalNeeds = { ...animalNeeds, ...r.animalNeeds };
                xmlCount += r.xmlCount;
                cropsFound += r.cropsFound;
                animalDefsFound += r.animalDefsFound;
                animalFiles = animalFiles.concat(r.animalFiles);
                readErrors = readErrors.concat(r.readErrors);
            }

            const cropCount = Object.keys(combined).length;
            const animalDefCount = Object.keys(animalNeeds).length;
            const summaryParts = [];

            // The Settings modal is only reachable from inside a farm, so a
            // current farm is guaranteed — write the map data into its folder.
            const importFarm = getCurrentFarm();

            if (!importFarm) {
                summaryParts.push(t('importNoFarmOpen'));
            } else {
                if (cropCount > 0) {
                    const generatedPath = path.join(farmDir(importFarm), 'crops_config.json');
                    try {
                        // Merge onto whatever this farm already has (e.g. from
                        // an earlier scan of a different subfolder) instead of
                        // replacing it outright, so re-importing a partial
                        // folder doesn't erase previously-imported crops that
                        // this scan simply didn't see.
                        let existing = {};
                        if (fs.existsSync(generatedPath)) {
                            try { existing = JSON.parse(fs.readFileSync(generatedPath, 'utf-8')) || {}; }
                            catch (e) { /* corrupt existing file — start fresh from this scan */ }
                        }
                        const merged = { ...existing };
                        Object.keys(combined).forEach(cropName => {
                            merged[cropName] = { ...(merged[cropName] || {}), ...combined[cropName] };
                        });
                        fs.writeFileSync(generatedPath, JSON.stringify(merged, null, 2), 'utf-8');
                        importFarm.cropsSourceLabel = cropsFolderInput ? cropsFolderInput.value : "";
                        summaryParts.push(t('importCropsDone').replace('{n}', cropCount).replace('{d}', cropsFound));
                    } catch (err) {
                        summaryParts.push(t('importCropsSaveError').replace('{e}', err.message || err));
                        console.error('Could not save crops_config.json', err);
                    }
                }

                if (animalDefCount > 0) {
                    const generatedAnimalPath = path.join(farmDir(importFarm), 'animal_needs_config.json');
                    try {
                        let existing = {};
                        if (fs.existsSync(generatedAnimalPath)) {
                            try { existing = JSON.parse(fs.readFileSync(generatedAnimalPath, 'utf-8')) || {}; }
                            catch (e) { /* corrupt existing file — start fresh from this scan */ }
                        }
                        const merged = { ...existing, ...animalNeeds };
                        fs.writeFileSync(generatedAnimalPath, JSON.stringify(merged, null, 2), 'utf-8');
                        importFarm.animalDefsSourceLabel = animalDefsFolderInput ? animalDefsFolderInput.value : "";
                        // Remembered so they're re-read on every start (see refreshAnimalDefsFromSource).
                        importFarm.animalDefsFiles = [...new Set([...(importFarm.animalDefsFiles || []), ...animalFiles])];
                        summaryParts.push(t('importAnimalsDone').replace('{n}', animalDefCount));
                    } catch (err) {
                        summaryParts.push(t('importAnimalsSaveError').replace('{e}', err.message || err));
                        console.error('Could not save animal_needs_config.json', err);
                    }
                }

                saveFarmData(importFarm);
                loadFarmConfigs(importFarm);
                // Reflect the fresh crop list in the planner behind the modal.
                if (currentFarmId && plannerView && plannerView.style.display !== 'none' && !isEditMode) {
                    renderSeasonView();
                }
            }

            if (readErrors.length > 0) {
                summaryParts.push(t('importReadErrors').replace('{n}', readErrors.length));
            }

            if (summaryParts.length > 0) {
                showNotice(t('noticeImportTitle'), t('importSummary').replace('{parts}', summaryParts.join('; ')).replace('{n}', xmlCount));
            } else {
                showNotice(t('noticeImportTitle'), t('importNothingFound').replace('{n}', xmlCount), true);
            }
            pendingCropFiles = null;
            pendingAnimalDefFiles = null;
        }

        {
            const grassLimitInput = document.getElementById('grassland-limit-input');
            const farm = getCurrentFarm();
            const v = grassLimitInput ? parseInt(grassLimitInput.value, 10) : NaN;
            if (farm && v > 0 && v !== grasslandSeasonLimit(farm)) {
                farm.grasslandMaxSeasons = v;
                saveFarmData(farm);
                if (!isEditMode) renderSeasonView();
            }
        }

        {
            const currencySelect = document.getElementById('currency-select');
            const farm = getCurrentFarm();
            if (currencySelect && farm && (farm.currency || 'auto') !== currencySelect.value) {
                farm.currency = currencySelect.value;
                saveFarmData(farm);
                refreshPlannerHeader(farm);
            }
        }

        if (autoSyncToggle) {
            const farm = getCurrentFarm();
            if (farm && farm.autoSync !== autoSyncToggle.checked) {
                farm.autoSync = autoSyncToggle.checked;
                saveFarmData(farm);
            }
        }

        if (settingsMapNameInput) {
            const farm = getCurrentFarm();
            if (farm) {
                const newMap = settingsMapNameInput.value.trim();
                if ((farm.mapName || "") !== newMap) {
                    farm.mapName = newMap;
                    saveFarmData(farm);
                    if (plannerTitle) plannerTitle.innerText = newMap ? `${farm.name} · ${newMap}` : farm.name;
                }
            }
        }

        // Per-farm toggles: whole-farmland area, and whether detected animal
        // mods count in the feed planner.
        {
            const farm = getCurrentFarm();
            if (farm) {
                const flToggle = document.getElementById('farmland-area-toggle');
                const showFarmlandArea = flToggle ? flToggle.checked : !!farm.showFarmlandArea;
                // Unchecked mods are off for this farm; a mod not in the save
                // keeps whatever it was set to.
                const off = new Set(disabledModsOf(farm));
                document.querySelectorAll('#animal-mods-info .supported-mod-toggle').forEach(cb => {
                    if (cb.disabled) return;
                    if (cb.checked) off.delete(cb.dataset.mod); else off.add(cb.dataset.mod);
                });
                const disabledMods = SUPPORTED_MODS.map(d => d.id).filter(id => off.has(id));
                const wasOff = SUPPORTED_MODS.map(d => d.id).filter(id => disabledModsOf(farm).has(id));
                const modsChanged = disabledMods.join() !== wasOff.join();
                if (showFarmlandArea !== !!farm.showFarmlandArea || modsChanged) {
                    farm.showFarmlandArea = showFarmlandArea;
                    farm.disabledMods = disabledMods;
                    delete farm.ignoreAfc;
                    delete farm.ignoreEas;
                    saveFarmData(farm);
                    loadFarmConfigs(farm);
                    refreshFarmlandInfo(farm);
                    if (plannerView && plannerView.style.display !== 'none' && !isEditMode) renderSeasonView();
                }
            }
        }

        if (gameSavePathInput) {
            let pathToFile = gameSavePathInput.value.trim().replace(/"/g, '');
            if (pathToFile && fs.existsSync(pathToFile) && fs.statSync(pathToFile).isDirectory()) pathToFile = path.join(pathToFile, 'careerSavegame.xml');
            if (pathToFile && fs.existsSync(pathToFile)) {
                const allFarms = getAllFarms();
                const idx = allFarms.findIndex(f => f.id === currentFarmId);
                if (idx > -1) {
                    const target = allFarms[idx];
                    const gameFarmRow = document.getElementById('game-farm-row');
                    const gameFarmSelect = document.getElementById('game-farm-select');
                    if (target.saveGamePath !== pathToFile) {
                        // Another save: pick its farm again from scratch.
                        delete target.gameFarmId;
                        target.saveGamePath = pathToFile;
                        resolveGameFarmId(target);
                    } else if (gameFarmRow && !gameFarmRow.hidden && gameFarmSelect && gameFarmSelect.value) {
                        target.gameFarmId = gameFarmSelect.value;
                    }
                    useSaveFarm(target);
                    const newData = readGameSave(pathToFile);
                    if (newData.balance !== null) allFarms[idx].balance = newData.balance;
                    if (newData.month) allFarms[idx].month = newData.month;
                    if (newData.loan !== null) allFarms[idx].loan = newData.loan;
                    saveFarmData(allFarms[idx]);
                    if (currentFarmId === allFarms[idx].id) openPlanner(currentFarmId);
                }
            }
        }

        // Apply the auto-sync choice immediately if a planner is open (start it,
        // restart it against a new path, or stop it — startAutoSync handles all).
        if (currentFarmId != null && plannerView && plannerView.style.display !== 'none') {
            startAutoSync(currentFarmId);
        }

        // "Adjust rates" (relocated from Zaopatrzenie) — batch-saved here like
        // every other field in this modal, in one saveSupplyRates() call.
        const supplyAdjustContainer = document.getElementById('settings-supply-adjust');
        if (supplyAdjustContainer) {
            const rates = getSupplyRates();
            const assumeEl = supplyAdjustContainer.querySelector('#supply-assume-fert');
            if (assumeEl) rates.assumeAllFertilized = assumeEl.checked;
            const num = (id) => { const el = supplyAdjustContainer.querySelector('#' + id); return el ? (parseFloat(el.value) || 0) : undefined; };
            const buffer = num('supply-buffer'); if (buffer !== undefined) rates.bufferPct = buffer;
            const nDensity = num('supply-n-density'); if (nDensity !== undefined) rates.nDensity = nDensity;
            const manureN = num('supply-manure-n'); if (manureN !== undefined) rates.manureN = manureN;
            const slurryN = num('supply-slurry-n'); if (slurryN !== undefined) rates.slurryN = slurryN;
            const digestateN = num('supply-digestate-n'); if (digestateN !== undefined) rates.digestateN = digestateN;
            supplyAdjustContainer.querySelectorAll('.supply-rate-input').forEach(inp => {
                const c = inp.dataset.supplyCrop, field = inp.dataset.supplyField;
                if (!rates.crops[c]) rates.crops[c] = {};
                const v = inp.value.trim();
                if (v === '') delete rates.crops[c][field]; else rates.crops[c][field] = parseFloat(v);
                if (Object.keys(rates.crops[c]).length === 0) delete rates.crops[c];
            });
            saveSupplyRates(rates);
        }

        closeModal(settingsModal);
    });
}

if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', () => closeModal(settingsModal));

// =============================================================
// SECTION 10: DASHBOARD LOGIC (FARM MANAGEMENT)
// =============================================================
// One listener for every farm row's buttons (open / delete / export).
const farmListClickEl = document.querySelector('.farm-list');
if (farmListClickEl) farmListClickEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-farm-action]');
    const item = btn && btn.closest('.farm-item');
    if (!item) return;
    const id = item.dataset.farmId;
    if (btn.dataset.farmAction === 'open') window.openPlanner(id);
    else if (btn.dataset.farmAction === 'delete') window.prepareDelete(id);
    else if (btn.dataset.farmAction === 'export') window.exportFarmBackup(id);
});

function renderFarmList(farms) {
    const container = document.querySelector('.farm-list');
    if (!container) return;
    container.innerHTML = "";
    if (!farms.length) {
        container.innerHTML = `<div class="farm-list-empty">
            <p>${t('noFarmsYet')}</p>
            <button type="button" class="farm-list-empty-cta"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${t('addFirstFarm')}</button>
        </div>`;
        container.querySelector('.farm-list-empty-cta').addEventListener('click', () => { if (addFarmBtn) addFarmBtn.click(); });
    }
    farms.forEach(farm => {
        const item = document.createElement('div');
        item.className = 'farm-item';
        item.dataset.farmId = farm.id;
        item.innerHTML = `
            <div class="farm-details">
                <span class="farm-name">${escapeHtml(farm.name)}${farm.mapName ? ` <span class="farm-map">${escapeHtml(farm.mapName)}</span>` : ''}</span>
                <span class="farm-dates">${t('lastEdited')}: ${escapeHtml(formatLastEdited(farm.lastEdited))}</span>
            </div>
            <div class="farm-item-actions">
                <button type="button" class="delete-btn-circle" data-farm-action="delete" title="${t('deleteFarmTitle')}" aria-label="${t('deleteFarmTitle')}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
                <button type="button" class="export-btn-circle" data-farm-action="export" title="${t('exportBackup')}" aria-label="${t('exportBackup')}"><i class="fa-solid fa-download" aria-hidden="true"></i></button>
                <button type="button" class="select-btn" data-farm-action="open" title="${t('openFarmTitle')}" aria-label="${t('openFarmTitle')}"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
            </div>
        `;
        container.appendChild(item);
    });

    // Keep the "N farms tracked" Discord line in sync with add / delete / import.
    if (typeof updateDiscordPresence === 'function') updateDiscordPresence();
}

// =============================================================
// SECTION 12: BACKUP EXPORT / IMPORT
// =============================================================
// The backup bundle just mirrors the farm's folder: every .json under it
// (data.json, monthly.json, seasons/*, backups/*, crops_config.json, …) is
// walked and stored by its relative path. New file types added later are
// therefore backed up automatically — nothing here needs updating for them.

function collectFarmFolderFiles(rootDir) {
    const out = {};
    const walk = (dir, rel) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch (err) { return; }
        entries.forEach(entry => {
            const abs = path.join(dir, entry.name);
            const relPath = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(abs, relPath);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
                try { out[relPath] = JSON.parse(fs.readFileSync(abs, 'utf-8')); }
                catch (err) { /* skip a corrupt/unreadable file rather than fail the whole export */ }
            }
        });
    };
    walk(rootDir, '');
    return out;
}

function writeFarmFolderFiles(rootDir, files) {
    Object.entries(files || {}).forEach(([relPath, data]) => {
        // Guard against path traversal / absolute paths from a tampered backup.
        const normalized = String(relPath).replace(/\\/g, '/');
        if (!normalized || normalized.startsWith('/') || normalized.split('/').some(seg => seg === '..' || seg === '')) return;
        try {
            const dest = path.join(rootDir, normalized);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) { /* non-fatal — restore the rest of the files */ }
    });
}

// Returns the saved file's path, or null. quiet: no "exported" notice (the
// delete dialog says it itself).
window.exportFarmBackup = async function (farmId, quiet = false) {
    const farm = getAllFarms().find(f => f.id === farmId);
    if (!farm || !farm.folderName) return null;

    const files = collectFarmFolderFiles(path.join(appDataDir, farm.folderName));
    // Make sure the bundle reflects any unsaved in-memory edits to the farm.
    files['data.json'] = farm;

    const bundle = {
        exportFormat: 'farmer-planner-backup',
        exportVersion: 2,
        exportedAt: new Date().toISOString(),
        farm: farm,
        files: files
    };

    const safeName = (farm.name || 'farm').replace(/[/\\?%*:|"<>]/g, '-');
    const result = await ipcRenderer.invoke('show-save-dialog', {
        title: t('exportBackup'),
        defaultPath: `${safeName}_backup.json`,
        filters: [{ name: 'Farmer Planner Backup', extensions: ['json'] }]
    });

    if (result.canceled || !result.filePath) return null;

    try {
        fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), 'utf-8');
        if (!quiet) showNotice(t('noticeBackupTitle'), t('exportSuccess'));
        return result.filePath;
    } catch (err) {
        await showNotice(t('noticeBackupTitle'), t('exportError'), true);
        return null;
    }
};

// Settings -> Help: diagnostic file for a bug report (see diagnostics.js) and
// links to GitHub issues / the website's contact form.
function appSettingsForDiagnostics() {
    return appSettings.all();
}

function openDiagnosticsModal() {
    const modal = document.getElementById('diagnostics-modal');
    const select = document.getElementById('diagnostics-farm');
    if (!modal || !select) return;
    const farms = getAllFarms().slice().sort((a, b) => String(b.lastEdited || '').localeCompare(String(a.lastEdited || '')));
    const preferred = currentFarmId || (farms[0] && farms[0].id) || '';
    select.innerHTML = `<option value="">${escapeHtml(t('diagNoFarm'))}</option>` +
        farms.map(f => `<option value="${escapeHtml(f.id)}"${f.id === preferred ? ' selected' : ''}>${escapeHtml(f.name || f.id)}</option>`).join('');
    openModal(modal);
}

async function saveDiagnosticsFile() {
    const modal = document.getElementById('diagnostics-modal');
    const select = document.getElementById('diagnostics-farm');
    const farm = select && select.value ? getAllFarms().find(f => f.id === select.value) : null;
    const report = diagnostics.buildDiagnostics({
        appVersion: APP_VERSION,
        lang: currentLang,
        isDevBuild: IS_DEV_BUILD,
        settings: appSettingsForDiagnostics(),
        farm: farm,
        farmFiles: farm && farm.folderName ? collectFarmFolderFiles(path.join(appDataDir, farm.folderName)) : null,
        log: await ipcRenderer.invoke('get-console-log').catch(() => [])
    });
    const date = new Date().toISOString().slice(0, 10);
    const safeName = farm ? '-' + (farm.name || 'farm').replace(/[/\\?%*:|"<>\s]+/g, '-') : '';
    const result = await ipcRenderer.invoke('show-save-dialog', {
        title: t('diagTitle'),
        defaultPath: `farmer-planner-diagnostics${safeName}-${date}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return;
    if (modal) modal.style.display = 'none';
    try {
        fs.writeFileSync(result.filePath, JSON.stringify(report, null, 2), 'utf-8');
        showNotice(t('diagTitle'), t('diagSaved'));
    } catch (err) {
        console.error('Could not save the diagnostic file', err);
        showNotice(t('diagTitle'), t('diagError'), true);
    }
}

(function wireHelpSettings() {
    const diagBtn = document.getElementById('diagnostics-btn');
    if (diagBtn) diagBtn.addEventListener('click', openDiagnosticsModal);
    const cancelBtn = document.getElementById('diagnostics-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal(document.getElementById('diagnostics-modal')));
    const saveBtn = document.getElementById('diagnostics-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveDiagnosticsFile);
    const githubBtn = document.getElementById('report-github-btn');
    if (githubBtn) githubBtn.addEventListener('click', () => ipcRenderer.invoke('open-help-page', 'issues', currentLang));
    const contactBtn = document.getElementById('report-contact-btn');
    if (contactBtn) contactBtn.addEventListener('click', () => ipcRenderer.invoke('open-help-page', 'contact', currentLang));
})();

window.importFarmBackup = async function () {
    const result = await ipcRenderer.invoke('show-open-dialog', {
        title: t('importBackup'),
        properties: ['openFile'],
        filters: [{ name: 'Farmer Planner Backup', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

    let bundle;
    try {
        bundle = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
    } catch (err) {
        showNotice(t('noticeBackupTitle'), t('importErrorRead'), true);
        return;
    }

    if (!bundle || bundle.exportFormat !== 'farmer-planner-backup' || !bundle.farm) {
        showNotice(t('noticeBackupTitle'), t('importErrorFormat'), true);
        return;
    }

    // Always create a new farm folder rather than overwriting anything —
    // safer default, and it's also how you'd bring a farm onto a second
    // computer without clobbering whatever's already there. Folder is
    // named after the new id, same reasoning as everywhere else — see
    // migrateFarmFolderToId().
    const newId = Date.now().toString();
    const newFolderPath = path.join(appDataDir, newId);
    fs.mkdirSync(newFolderPath, { recursive: true });

    if (bundle.files && typeof bundle.files === 'object') {
        // v2 backup — restore the whole folder as it was.
        writeFarmFolderFiles(newFolderPath, bundle.files);
    } else {
        // v1 backup — reconstruct from the old named sections.
        const seasonEntries = Object.entries(bundle.seasons || {});
        if (seasonEntries.length > 0) {
            const seasonsDir = path.join(newFolderPath, 'seasons');
            fs.mkdirSync(seasonsDir, { recursive: true });
            seasonEntries.forEach(([seasonNum, seasonData]) => {
                fs.writeFileSync(path.join(seasonsDir, `season_${seasonNum}.json`), JSON.stringify(seasonData, null, 2), 'utf-8');
            });
        }
        if (Array.isArray(bundle.monthly) && bundle.monthly.length > 0) {
            fs.writeFileSync(path.join(newFolderPath, 'monthly.json'), JSON.stringify(bundle.monthly, null, 2), 'utf-8');
        }
        if (bundle.mapConfig && typeof bundle.mapConfig === 'object') {
            Object.entries(bundle.mapConfig).forEach(([fname, data]) => {
                if (!/^(crops_config|animal_needs_config)\.json$/.test(fname)) return;
                try { fs.writeFileSync(path.join(newFolderPath, fname), JSON.stringify(data, null, 2), 'utf-8'); }
                catch (err) { /* non-fatal — farm still restores without its map data */ }
            });
        }
    }

    // Rewrite data.json last so the restored farm gets a fresh id/folderName and
    // can't collide with a farm that's already there.
    const restoredFarm = {
        ...bundle.farm,
        id: newId,
        folderName: newId,
        lastEdited: new Date().toISOString()
    };
    fs.writeFileSync(path.join(newFolderPath, 'data.json'), JSON.stringify(restoredFarm, null, 2), 'utf-8');

    renderFarmList(getAllFarms());
    showNotice(t('noticeBackupTitle'), t('importSuccess'));
};

if (importBackupBtn) importBackupBtn.addEventListener('click', () => { window.importFarmBackup(); });

// --- New farm: pick one of the game's savegames right away ----------------
// <Documents>\My Games\FarmingSimulator2025\savegameN\careerSavegame.xml,
// listed with the savegame's name, map and money. Picking one fills in the
// map (and the farm name when it's still empty); the new farm opens linked to it.
let newFarmSavePath = '';

function listGameSaves() {
    const gameDir = path.join(path.dirname(appDataDir), 'My Games', 'FarmingSimulator2025');
    let names = [];
    try { names = fs.readdirSync(gameDir).filter(n => /^savegame\d+$/.test(n)); } catch (e) { return []; }
    return names.map(n => {
        const file = path.join(gameDir, n, 'careerSavegame.xml');
        try {
            const xml = fs.readFileSync(file, 'utf-8');
            const tag = name => decodeXmlEntities((xml.match(new RegExp('<' + name + '>([^<]*)</' + name + '>')) || [])[1] || '');
            return { file, slot: parseInt(n.replace('savegame', ''), 10), name: tag('savegameName'), map: tag('mapTitle'), money: parseFloat(tag('money')), date: tag('saveDate') };
        } catch (e) {
            return null;
        }
    }).filter(Boolean).sort((a, b) => a.slot - b.slot);
}

function decodeXmlEntities(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function renderNewFarmSaves() {
    const box = document.getElementById('new-farm-saves');
    if (!box) return;
    const saves = listGameSaves();
    const item = (pathValue, title, sub) => `<button type="button" class="save-choice${pathValue === newFarmSavePath ? ' is-selected' : ''}" data-path="${escapeHtml(pathValue)}">
        <span class="save-choice-title">${escapeHtml(title)}</span>${sub ? `<span class="save-choice-sub">${escapeHtml(sub)}</span>` : ''}</button>`;
    box.innerHTML = item('', t('newFarmNoSave'), t('newFarmNoSaveHint'))
        + saves.map(s => item(s.file, `${s.name || t('newFarmSaveUnnamed')} · ${s.map || '?'}`,
            [`savegame${s.slot}`, isNaN(s.money) ? '' : finMoney(s.money), s.date].filter(Boolean).join(' · '))).join('');
    if (!saves.length) box.insertAdjacentHTML('beforeend', `<p class="settings-hint">${t('newFarmNoSavesFound')}</p>`);
    box.dataset.saves = JSON.stringify(saves.map(s => ({ file: s.file, name: s.name, map: s.map })));
}

const newFarmSavesBox = document.getElementById('new-farm-saves');
if (newFarmSavesBox) newFarmSavesBox.addEventListener('click', e => {
    const btn = e.target.closest('.save-choice');
    if (!btn) return;
    newFarmSavePath = btn.dataset.path;
    let saves = [];
    try { saves = JSON.parse(newFarmSavesBox.dataset.saves || '[]'); } catch (err) { /* none */ }
    const save = saves.find(s => s.file === newFarmSavePath);
    if (save) {
        if (newFarmMapInput && save.map) newFarmMapInput.value = save.map;
        if (newFarmInput && !newFarmInput.value.trim() && save.name) newFarmInput.value = save.name;
    }
    newFarmSavesBox.querySelectorAll('.save-choice').forEach(b => b.classList.toggle('is-selected', b === btn));
});

if (addFarmBtn) addFarmBtn.addEventListener('click', () => {
    newFarmSavePath = '';
    renderNewFarmSaves();
    openModal(addFarmModal);
    if (newFarmInput) newFarmInput.focus();
});
if (cancelAddBtn) cancelAddBtn.addEventListener('click', () => { closeModal(addFarmModal); if (newFarmInput) newFarmInput.value = ""; if (newFarmMapInput) newFarmMapInput.value = ""; });

if (confirmAddBtn) {
    confirmAddBtn.addEventListener('click', () => {
        if (!newFarmInput) return;
        const farmName = newFarmInput.value.trim();
        if (farmName) {
            // Folder is named after the id, not the display name — see
            // migrateFarmFolderToId() for why. The id (a timestamp) is
            // already unique, so there's no sanitizing or collision
            // counter needed here at all.
            const newId = Date.now().toString();
            fs.mkdirSync(path.join(appDataDir, newId));

            const newFarm = {
                id: newId,
                name: farmName,
                mapName: newFarmMapInput ? newFarmMapInput.value.trim() : "",
                folderName: newId,
                lastEdited: new Date().toISOString(),
                balance: 0,
                currentSeason: 1,
                yearNumber: 1,
                fields: [],
                fieldSizes: {}
            };
            if (newFarmSavePath && fs.existsSync(newFarmSavePath)) newFarm.saveGamePath = newFarmSavePath;
            saveFarmData(newFarm);
            closeModal(addFarmModal);
            newFarmInput.value = "";
            if (newFarmMapInput) newFarmMapInput.value = "";
            newFarmSavePath = '';
            renderFarmList(getAllFarms());
            // Straight into the new farm — not during the tutorial, whose
            // next steps happen on the farm list.
            if (!tut.active) openPlanner(newId);
        }
    });
}

window.prepareDelete = async function (id) {
    // String() guards against an old/edited data.json where "id" ended up
    // as a number instead of a string — strict === would silently never
    // match and the farm would just stay in the list with no error.
    const farmToKill = getAllFarms().find(f => String(f.id) === String(id));
    // "Export a backup first" saves the backup and asks again, saying where it went.
    let savedTo = null;
    for (;;) {
        const sure = await showConfirm({
            title: t('deleteFarmAsk').replace('{name}', farmToKill ? (farmToKill.name || '') : ''),
            body: t('deleteFarmConfirm') + (savedTo ? '\n\n' + t('deleteFarmBackupSaved').replace('{file}', path.basename(savedTo)) : ''),
            confirmText: t('delete'),
            extraText: farmToKill && !savedTo ? t('deleteFarmExportFirst') : null,
            danger: true
        });
        if (sure === 'extra') { savedTo = await window.exportFarmBackup(farmToKill.id, true) || savedTo; continue; }
        if (sure !== true) return;
        break;
    }

    let error = null, leftover = null;
    if (!farmToKill) {
        console.error('Delete failed: no farm found with id', id);
        error = 'deleteErrorNotFound';
    } else if (!farmToKill.folderName) {
        console.error('Delete failed: farm has no folderName', farmToKill);
        error = 'deleteErrorNoFolder';
    } else {
        const folderPath = path.join(appDataDir, farmToKill.folderName);
        if (!fs.existsSync(folderPath)) {
            console.error('Delete failed: folder does not exist on disk', folderPath);
            error = 'deleteErrorMissingOnDisk';
        } else {
            // OneDrive (Documents synced) or an antivirus can hold a file for a
            // moment — retry, then try the Recycle Bin, then at least take the
            // farm off the list (data.json) and say what was left behind.
            try {
                fs.rmSync(folderPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            } catch (err) {
                console.error('Delete failed:', err.code, err);
                if (await ipcRenderer.invoke('trash-farm-folder', farmToKill.folderName)) {
                    console.warn('Farm folder moved to the Recycle Bin instead:', folderPath);
                } else {
                    try {
                        const jsonPath = path.join(folderPath, 'data.json');
                        if (fs.existsSync(jsonPath)) fs.rmSync(jsonPath, { maxRetries: 5, retryDelay: 200 });
                        leftover = farmToKill.folderName;
                    } catch (err2) {
                        console.error('Removing data.json failed too:', err2.code, err2);
                        error = 'deleteErrorLocked';
                    }
                }
            }
        }
    }
    renderFarmList(getAllFarms());
    if (error) showNotice(t('noticeErrorTitle'), t(error), true);
    else if (leftover) {
        const open = await showDialog({
            title: t('deleteFarmLeftoverTitle'),
            body: t('deleteFarmLeftover').replace('{path}', path.join(appDataDir, leftover)),
            confirmText: t('seasonModalOk'),
            extraText: t('deleteFarmOpenFolder'),
            icon: 'fa-triangle-exclamation'
        });
        if (open === 'extra') ipcRenderer.invoke('open-farm-folder', leftover);
    }
};

// =============================================================
// UPDATE CHECK
// =============================================================
// Asks GitHub Releases (pre-releases included — every version is published as
// one) whether a newer version exists. The installed app can update itself:
// the main process downloads the release's installer (src/main/updater.js) and
// starts it with --update; from source, or without that file in the release,
// the dialog opens the website's download page instead.
const APP_VERSION = ipcRenderer.sendSync('get-app-version') || '0.0.0';
const RELEASES_API = 'https://api.github.com/repos/WiktorParylak/farmer-planner/releases?per_page=20';
const CONFIG_KEY_UPDATE_CHECK = 'farmer_planner_update_check';
// The version an update was started to (cleared on the next start). The
// dialog itself comes back on every start until the update is installed.
const CONFIG_KEY_UPDATE_ATTEMPT = 'farmer_planner_update_attempt';
const UPDATE_LOG_PATH = path.join(require('os').tmpdir(), 'Farmer Planner update', 'setup.log');

function isUpdateCheckEnabled() {
    return getSetting(CONFIG_KEY_UPDATE_CHECK) !== '0';
}

// "v0.9.10" vs "0.9.9" -> 1 / 0 / -1, number by number.
function compareVersions(a, b) {
    const pa = String(a).replace(/^v/i, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/i, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d > 0 ? 1 : -1;
    }
    return 0;
}

// manual: from the Settings button — then "up to date" and errors are shown
// too; the start-up check stays silent unless there is something new.
async function checkForUpdates({ manual = false } = {}) {
    let newest = null;
    try {
        const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const releases = await res.json();
        (Array.isArray(releases) ? releases : []).forEach(r => {
            if (r.draft || !r.tag_name) return;
            if (!newest || compareVersions(r.tag_name, newest.tag_name) > 0) newest = r;
        });
    } catch (err) {
        console.warn('Update check failed', err);
        if (manual) await showNotice(t('updateErrorTitle'), t('updateError'), true);
        return;
    }

    const latest = newest ? newest.tag_name.replace(/^v/i, '') : null;
    if (!latest || compareVersions(latest, APP_VERSION) <= 0) {
        if (manual) await showNotice(t('updateNoneTitle'), t('updateNone').replace('{v}', APP_VERSION));
        return;
    }

    const asset = releaseInstallerAsset(newest, latest);
    let canInstall = false;
    try { canInstall = !!asset && await ipcRenderer.invoke('update-can-install'); } catch (e) { canInstall = false; }
    if (canInstall) { await runUpdateDialog(latest, asset); return; }

    const fill = s => s.replace('{v}', latest).replace('{c}', APP_VERSION);
    const download = await showDialog({
        title: fill(t('updateAvailableTitle')),
        body: fill(t('updateAvailableBody')),
        confirmText: t('updateDownload'),
        cancelText: t('updateLater'),
        icon: 'fa-circle-arrow-up'
    });
    if (download) ipcRenderer.invoke('open-release-page', latest, currentLang);
}

// The release's own installer, "Farmer Planner Setup X.Y.Z.exe" (GitHub shows
// the spaces in asset names as dots).
function releaseInstallerAsset(release, version) {
    const norm = s => String(s || '').toLowerCase().replace(/[.\s]+/g, ' ');
    const want = norm(`Farmer Planner Setup ${version}.exe`);
    return ((release && release.assets) || []).find(a => norm(a.name) === want && a.browser_download_url) || null;
}

// Update now · What's new · Later -> download with progress (Cancel) -> the
// installer starts and the app quits. A failed download leaves everything as
// it was and points to the website.
function runUpdateDialog(latest, asset) {
    const modal = document.getElementById('update-modal');
    if (!modal) return Promise.resolve();
    const content = modal.querySelector('.app-dialog-content');
    const icon = document.getElementById('update-icon');
    const titleEl = document.getElementById('update-title');
    const bodyEl = document.getElementById('update-body');
    const progressEl = document.getElementById('update-progress');
    const bar = document.getElementById('update-progress-bar');
    const progressText = document.getElementById('update-progress-text');
    const webBtn = document.getElementById('update-web');
    const laterBtn = document.getElementById('update-later');
    const nowBtn = document.getElementById('update-now');
    const fill = s => s.replace('{v}', latest).replace('{c}', APP_VERSION);
    const mb = n => (n / 1048576).toFixed(1);
    let state = 'offer';

    const setState = (next, reason) => {
        state = next;
        const failed = next === 'failed';
        content.classList.toggle('is-danger', failed);
        icon.classList.toggle('is-danger', failed);
        icon.innerHTML = `<i class="fa-solid ${failed ? 'fa-triangle-exclamation' : 'fa-circle-arrow-up'}"></i>`;
        progressEl.hidden = next !== 'downloading' && next !== 'installing';
        webBtn.hidden = next === 'downloading' || next === 'installing';
        laterBtn.hidden = next === 'installing';
        nowBtn.hidden = next !== 'offer';
        titleEl.textContent = fill(t(failed ? 'updateFailedTitle' : 'updateAvailableTitle'));
        webBtn.textContent = t(failed ? 'updateFromWebsite' : 'updateWhatsNew');
        laterBtn.textContent = t(next === 'downloading' ? 'cancel' : failed ? 'close' : 'updateLater');
        nowBtn.textContent = t('updateNow');
        if (next === 'offer') bodyEl.textContent = fill(t('updateAvailableBodyInstall'));
        if (next === 'downloading') {
            bodyEl.textContent = fill(t('updateDownloading'));
            bar.style.width = '0%';
            progressText.textContent = '';
        }
        if (next === 'installing') {
            bodyEl.textContent = fill(t('updateInstalling'));
            bar.style.width = '100%';
        }
        if (failed) {
            const reasons = t('updateFailReasons') || {};
            bodyEl.textContent = fill(t('updateFailed')).replace('{reason}', reasons[reason] || reasons.download || reason);
        }
    };

    const onProgress = (event, p) => {
        if (state !== 'downloading' || !p) return;
        const total = p.total || asset.size || 0;
        bar.style.width = total ? Math.min(100, 100 * p.received / total).toFixed(1) + '%' : '50%';
        progressText.textContent = total
            ? t('updateProgress').replace('{r}', mb(p.received)).replace('{t}', mb(total))
            : mb(p.received) + ' MB';
    };

    return new Promise(resolve => {
        const finish = () => {
            closeModal(modal);
            ipcRenderer.removeListener('update-progress', onProgress);
            webBtn.removeEventListener('click', onWeb);
            laterBtn.removeEventListener('click', onLater);
            nowBtn.removeEventListener('click', onNow);
            modal.removeEventListener('mousedown', onBackdrop);
            document.removeEventListener('keydown', onKey, true);
            resolve();
        };
        const closable = () => state === 'offer' || state === 'failed';
        const onWeb = () => ipcRenderer.invoke('open-release-page', latest, currentLang);
        const onLater = () => {
            if (state === 'downloading') ipcRenderer.invoke('update-cancel');
            else if (closable()) finish();
        };
        const onNow = async () => {
            if (state !== 'offer') return;
            // Unsaved edits would be lost when the app closes for the installer.
            if (isEditMode) { bodyEl.textContent = t('updateFinishEdit'); return; }
            setState('downloading');
            let res;
            try {
                res = await ipcRenderer.invoke('update-download', {
                    version: latest, url: asset.browser_download_url, size: asset.size, digest: asset.digest
                });
            } catch (err) {
                res = { ok: false, reason: 'download', detail: err.message };
            }
            if (!res.ok) {
                if (res.reason === 'cancelled') setState('offer');
                else { console.warn('Update download failed', res); setState('failed', res.reason); }
                return;
            }
            setState('installing');
            setSetting(CONFIG_KEY_UPDATE_ATTEMPT, latest);
            let started;
            try { started = await ipcRenderer.invoke('update-install', latest, currentLang); }
            catch (err) { started = { ok: false, reason: 'start' }; }
            if (!started.ok) {
                setSetting(CONFIG_KEY_UPDATE_ATTEMPT, '');
                console.warn('Update installer did not start', started);
                setState('failed', started.reason);
            }
        };
        const onBackdrop = e => { if (e.target === modal && closable()) finish(); };
        const onKey = e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (closable()) finish(); }
        };
        ipcRenderer.on('update-progress', onProgress);
        webBtn.addEventListener('click', onWeb);
        laterBtn.addEventListener('click', onLater);
        nowBtn.addEventListener('click', onNow);
        modal.addEventListener('mousedown', onBackdrop);
        document.addEventListener('keydown', onKey, true);
        setState('offer');
        openModal(modal);
        nowBtn.focus();
    });
}

// On start after "Update now": still the old version -> the installer didn't
// finish (it puts the previous version back). Say so once, with the log; the
// update is then offered again as on any start.
async function reportUnfinishedUpdate() {
    const attempted = getSetting(CONFIG_KEY_UPDATE_ATTEMPT);
    if (!attempted) return;
    setSetting(CONFIG_KEY_UPDATE_ATTEMPT, '');
    if (compareVersions(APP_VERSION, attempted) >= 0) return;
    await showNotice(t('updateRestoredTitle'), t('updateRestored')
        .replace('{v}', attempted).replace('{c}', APP_VERSION).replace('{log}', UPDATE_LOG_PATH), true);
}

const updateCheckToggle = document.getElementById('update-check-toggle');
if (updateCheckToggle) {
    updateCheckToggle.addEventListener('change', () => {
        setSetting(CONFIG_KEY_UPDATE_CHECK, updateCheckToggle.checked ? '1' : '0');
    });
}
const checkUpdatesBtn = document.getElementById('check-updates-btn');
if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener('click', async () => {
        checkUpdatesBtn.disabled = true;
        try { await checkForUpdates({ manual: true }); }
        finally { checkUpdatesBtn.disabled = false; }
    });
}

// ---------- what's new after an update ----------
// The version the app last ran is kept in settings; after an update the
// CHANGELOG.md sections in between are shown once (in English, as on the
// website's Versions page).
const CONFIG_KEY_LAST_VERSION = 'farmer_planner_last_version';
const CHANGELOG_PATH = path.join(__dirname, '..', '..', 'CHANGELOG.md');

// [{ version, lines }] for every "## X.Y.Z — date" (or "— unreleased") section.
function readChangelogSections() {
    let text = '';
    try { text = fs.readFileSync(CHANGELOG_PATH, 'utf8'); } catch (e) { return []; }
    return text.split(/^## /m).slice(1).map(section => {
        const [heading, ...lines] = section.split(/\r?\n/);
        const m = heading.trim().match(/^(\d+\.\d+\.\d+)\b/);
        return m ? { version: m[1], lines } : null;
    }).filter(Boolean);
}

// The small Markdown subset CHANGELOG.md uses: "**New**" labels, "- " lists
// (one level of nesting), **bold**, *italic*, `code` and [links] (text only —
// a link inside the app window would replace the app).
function changelogInline(src) {
    const codes = [];
    let html = escapeHtml(src).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    html = html
        .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?!\w)/g, '$1<em>$2</em>');
    return html.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[i]}</code>`);
}

function changelogHtml(lines) {
    const out = [];
    let list = null;
    const flushList = () => {
        if (!list) return;
        out.push('<ul>' + list.map(item => `<li>${item.text}${item.children.length ? '<ul>' + item.children.map(c => `<li>${c}</li>`).join('') + '</ul>' : ''}</li>`).join('') + '</ul>');
        list = null;
    };
    lines.forEach(line => {
        if (!line.trim()) { flushList(); return; }
        const item = line.match(/^(\s*)[-*] (.*)$/);
        if (item) {
            if (!list) list = [];
            if (item[1].length >= 2 && list.length) list[list.length - 1].children.push(changelogInline(item[2]));
            else list.push({ text: changelogInline(item[2]), children: [] });
        } else if (list && /^\s+\S/.test(line)) {
            const last = list[list.length - 1];
            if (last.children.length) last.children[last.children.length - 1] += ' ' + changelogInline(line.trim());
            else last.text += ' ' + changelogInline(line.trim());
        } else {
            flushList();
            const label = line.trim().match(/^\*\*([^*]+)\*\*$/);
            out.push(label ? `<h5>${changelogInline(label[1])}</h5>` : `<p>${changelogInline(line.trim())}</p>`);
        }
    });
    flushList();
    return out.join('');
}

// Sections newer than `since` (exclusive) up to the running version; since
// = null -> just the running version.
function showWhatsNew(since) {
    const modal = document.getElementById('whats-new-modal');
    const sections = readChangelogSections().filter(s => compareVersions(s.version, APP_VERSION) <= 0
        && (since ? compareVersions(s.version, since) > 0 : compareVersions(s.version, APP_VERSION) === 0));
    if (!modal || !sections.length) return Promise.resolve(false);

    document.getElementById('whats-new-title').textContent = t('whatsNewTitle').replace('{v}', APP_VERSION);
    const lead = since ? t('whatsNewLead').replace('{old}', since).replace('{v}', APP_VERSION) : '';
    document.getElementById('whats-new-lead').textContent = [lead, currentLang === 'en' ? '' : t('whatsNewEnglish')].filter(Boolean).join(' ');
    document.getElementById('whats-new-lead').style.display = document.getElementById('whats-new-lead').textContent ? '' : 'none';
    const body = document.getElementById('whats-new-body');
    body.innerHTML = sections.map(s => (sections.length > 1 ? `<h4>${escapeHtml(s.version)}</h4>` : '') + changelogHtml(s.lines)).join('');
    body.scrollTop = 0;

    const okBtn = document.getElementById('whats-new-ok');
    const webBtn = document.getElementById('whats-new-web');
    return new Promise(resolve => {
        const finish = () => {
            closeModal(modal);
            okBtn.removeEventListener('click', finish);
            webBtn.removeEventListener('click', onWeb);
            modal.removeEventListener('mousedown', onBackdrop);
            document.removeEventListener('keydown', onKey, true);
            resolve(true);
        };
        const onWeb = () => ipcRenderer.invoke('open-release-page', APP_VERSION, currentLang);
        const onBackdrop = e => { if (e.target === modal) finish(); };
        const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); } };
        okBtn.addEventListener('click', finish);
        webBtn.addEventListener('click', onWeb);
        modal.addEventListener('mousedown', onBackdrop);
        document.addEventListener('keydown', onKey, true);
        openModal(modal);
        okBtn.focus();
    });
}

// On start: show what changed if the app was updated since it last ran.
// A first install (no language chosen yet) only records the version.
async function showWhatsNewAfterUpdate(isFirstStart) {
    const last = getSetting(CONFIG_KEY_LAST_VERSION);
    setSetting(CONFIG_KEY_LAST_VERSION, APP_VERSION);
    if (isFirstStart) return;
    // Settings from before this feature have no version: show this one's changes.
    if (!last) { await showWhatsNew(null); return; }
    if (compareVersions(APP_VERSION, last) > 0) await showWhatsNew(last);
}

const whatsNewBtn = document.getElementById('whats-new-btn');
if (whatsNewBtn) {
    whatsNewBtn.addEventListener('click', async () => {
        if (!(await showWhatsNew(null))) await showNotice(t('whatsNewButton'), t('whatsNewNone').replace('{v}', APP_VERSION));
    });
}

// =============================================================
// SECTION 11: INITIALIZATION
// =============================================================
// First start (no language saved yet): a modal that can only be closed by
// picking a language — before the tutorial, so it runs in that language.
function askFirstLanguage() {
    const modal = document.getElementById('first-lang-modal');
    if (!modal) return Promise.resolve();
    return new Promise(resolve => {
        modal.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.remove('is-selected');   // no language preselected
            btn.addEventListener('click', () => {
                applyLanguage(btn.getAttribute('data-lang'));
                modal.style.display = 'none';
                resolve();
            }, { once: true });
        });
        modal.style.display = 'flex';
        const first = modal.querySelector('.lang-btn');
        if (first) first.focus();
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // Crop calendar / animal-needs are per-farm now — loaded by loadFarmConfigs()
    // when a farm is opened, not here (no farm is active on the dashboard).
    const languageChosen = !!getSetting(CONFIG_KEY_LANG);
    applyLanguage(currentLang);

    // Leftover from a tutorial that was interrupted by closing the app.
    removeDemoFarm();

    renderFarmList(getAllFarms());
    if (dashboardView) dashboardView.style.display = 'flex';
    if (plannerView) plannerView.style.display = 'none';

    updateDiscordPresence();

    if (!languageChosen) {
        await askFirstLanguage();
        renderFarmList(getAllFarms());
    }
    await askDiscordOnce();
    await reportUnfinishedUpdate();
    await showWhatsNewAfterUpdate(!languageChosen);
    if (getSetting(CONFIG_KEY_TUTORIAL_DONE) !== '1') startTutorial();
    else if (isUpdateCheckEnabled()) setTimeout(() => checkForUpdates(), 1500);
});