// "Today" panel under the season plan: what the farm needs this in-game month,
// gathered from what the plan already knows — sowing and harvest months from
// the crop calendar, late sowing, weeds and rolling still to do, the next step
// of each field's own work list, barns running out of feed and this month's
// notes. Each field opens its field view. Loaded after fields-table.js.

const TODAY_FEED_LOW_DAYS = 3;   // same "low" as the Animals tab gauge

// Settings come back as strings.
// The column next to the plan: What to do today and, folded until asked for, the
// crops on the farm. With no What to do today to show (a past season, editing)
// the crop list has the column to itself. The tutorial needs it all in view.
function syncPlanSidePanels(todayShown, count) {
    const side = document.querySelector('.planner-crops');
    const handle = document.getElementById('plan-side-toggle');
    const cropsBtn = document.getElementById('crops-toggle');
    const legend = document.getElementById('treatments-legend');
    if (!side || !handle || !cropsBtn) return;
    const forced = tut.active;
    const open = forced || String(getSetting('planSideOpen')) !== 'false';
    side.hidden = !open;
    handle.hidden = forced;
    handle.setAttribute('aria-expanded', open ? 'true' : 'false');
    handle.querySelector('.fa-solid').className = 'fa-solid ' + (open ? 'fa-chevron-right' : 'fa-chevron-left');
    const badge = handle.querySelector('.plan-side-count');
    badge.hidden = open || !count;
    badge.textContent = count;
    const cropsOpen = forced || !todayShown || String(getSetting('cropsPanelOpen')) === 'true';
    side.classList.toggle('is-crops-open', cropsOpen);
    cropsBtn.disabled = forced || !todayShown;
    cropsBtn.setAttribute('aria-expanded', cropsOpen ? 'true' : 'false');
    cropsBtn.querySelector('.fa-solid').className = 'fa-solid ' + (cropsOpen ? 'fa-chevron-down' : 'fa-chevron-right');
    if (legend) legend.hidden = isEditMode || getFieldsViewMode() !== 'table';
}

function todayPanelOpen() {
    return String(getSetting('todayPanelOpen')) !== 'false';
}

// Order in which a field's tasks claim it: each field shows once, in its most
// urgent group, and names its other tasks after the crop.
const TODAY_PRIORITY = ['late', 'sow', 'harvest', 'mow', 'finish', 'weeds', 'roll', 'work'];

// The save's fields by id, read again only when fields.xml changes (the panel
// renders with every season view). Null without a readable save.
let todaySaveCache = { key: null, byId: null };
function todaySaveFieldsById(farm) {
    let key = null;
    try { key = farm.saveGamePath + ':' + fs.statSync(path.join(path.dirname(farm.saveGamePath), 'fields.xml')).mtimeMs; }
    catch (e) { return null; }
    if (todaySaveCache.key !== key) {
        const save = readSaveFields(farm, { saved: true });
        const byId = save.ok ? {} : null;
        if (byId) save.fields.forEach(f => { byId[f.id] = f; });
        todaySaveCache = { key, byId };
    }
    return todaySaveCache.byId;
}

// The same with the link mod's live fields on top, for what is only shown: nothing
// stored may follow it, as a game closed without saving never happened.
let todayLiveCache = { key: null, byId: null };
function todayLiveFieldsById(farm) {
    const live = typeof liveLinkSource === 'function' ? liveLinkSource(farm) : null;
    if (!live) return todaySaveFieldsById(farm);
    const key = farm.saveGamePath + ':' + live.session + ':' + live.rev;
    if (todayLiveCache.key !== key) {
        const save = readSaveFields(farm);
        const byId = save.ok ? {} : null;
        if (byId) save.fields.forEach(f => { byId[f.id] = f; });
        todayLiveCache = { key, byId };
    }
    return todayLiveCache.byId;
}

// The row's game fields the mod has a cut share for, or null: [{ share, ha }].
function todayCutShares(field, byId) {
    if (!byId) return null;
    const games = gameFieldIds(field).map(id => byId[id]).filter(g => g && g.cutShare != null);
    return games.length ? games.map(g => ({ share: g.cutShare, ha: g.areaHa || 1 })) : null;
}

// The harvest with how far it got, once it's under way (link mod only).
function todayHarvestText(field, byId) {
    const shares = todayCutShares(field, byId);
    if (!shares) return t('work_harvest');
    const ha = shares.reduce((s, x) => s + x.ha, 0);
    const done = shares.reduce((s, x) => s + x.share * x.ha, 0) / ha;
    return done > 0 ? t('today_harvestPartly').replace('{pct}', Math.round(done * 100)) : t('work_harvest');
}

// Grass the mod sees cut all over, before the game has saved it (link mod only).
function todayMownLive(field, byId) {
    const shares = todayCutShares(field, byId);
    return !!shares && shares.length === gameFieldIds(field).length && shares.every(x => x.share >= LIVE_HARVEST_DONE);
}

// A field ticked "sown" by hand (or carried on by its rotation) may still grow
// something else in the game. With the save at hand, harvest only when the
// game fields of the row grow the planned crop, until the last of them is
// harvested; rows the save doesn't know (not owned, no save) keep what the plan says.
function todayGrowsPlannedCrop(field, byId) {
    if (!byId) return true;
    const ids = gameFieldIds(field);
    const games = ids.map(id => byId[id]).filter(Boolean);
    if (!games.length || games.length !== ids.length) return true;
    return games.every(g => g.sown && cropOrderKey(saveFruitToCropKey(g.fruitType)) === cropOrderKey(field.crop))
        && games.some(g => saveFieldGrowsCrop(g, field.crop));
}

// { key, fields: [{ idx, field, extra }] } groups for the current season.
function todayFieldGroups(farm) {
    const month = getFarmCurrentMonth(farm);
    const fields = farm.fields || [];
    const groups = { sow: [], late: [], harvest: [], mow: [], finish: [], weeds: [], roll: [], work: [] };
    if (!month) return groups;
    const saveById = todayLiveFieldsById(farm);
    const ctx = seasonHarvestContext(farm, true);
    fields.forEach((field, idx) => {
        if (!field.crop) return;
        const tasks = {};
        const planted = field.state === 'Planted';
        const sow = (field.sowingMonth || '').toUpperCase();
        const cal = CROP_CALENDAR[field.crop] || {};
        const cut = isCutCrop(field.crop) || isPerennialCrop(field.crop);
        if (!planted && sow === month) tasks.sow = t('work_sow');
        else if (isSowingOverdue(field, month)) tasks.late = t('work_sow');
        if (planted && !cut && sow && cal[sow] && fieldInHarvestWindow(field, month) && todayGrowsPlannedCrop(field, saveById)) tasks.harvest = todayHarvestText(field, saveById);
        if (isCutCrop(field.crop) && fieldCutDue(field, month) && !todayMownLive(field, saveById)) tasks.mow = t('cutDueNow');
        if (planted && !cut && fieldHarvestState(field, ctx.month, ctx.saveById, ctx.yearPassed) === 'harvested') tasks.finish = t('today_finish');
        // Weeds on an unsown field belong to what grows there now, not the planned crop.
        if (planted && field.weeds === 'needed') tasks.weeds = t('work_weeds');
        if (planted && field.rolling && !field.rollingDone) tasks.roll = t('work_roll');
        // The job the table's badge shows, when it's for now (fieldJobDue), unless
        // a group above already covers it or the crop is off the field.
        if (!cut && !tasks.finish) {
            const { next } = nextWorkStep(field, idx, farm);
            const ownGroup = next && (next.step === 'sow' || (next.step === 'harvest' && next.part !== 'catch'));
            if (next && !ownGroup && !tasks[next.step] && fieldJobDue(field, next.step, month, next.part)) tasks.work = workStepLabel(field, next);
        }
        const keys = TODAY_PRIORITY.filter(k => tasks[k]);
        if (!keys.length) return;
        const others = keys.slice(1).map(k => tasks[k]);
        if (keys[0] === 'work') others.unshift(tasks.work);
        groups[keys[0]].push({ idx, field, extra: others.join(', ') });
    });
    return groups;
}

// The months a crop can be harvested in, counted from its sowing month: the first
// from the crop calendar, the last from its growth rules if it has several.
// Null without a calendar.
function fieldHarvestWindow(field) {
    const sow = (field.sowingMonth || '').toUpperCase();
    const s = ALL_MONTHS.indexOf(sow);
    const h = ALL_MONTHS.indexOf((CROP_CALENDAR[field.crop] || {})[sow] || '');
    if (s < 0 || h < 0) return null;
    const first = (h - s + 12) % 12;
    const u = ALL_MONTHS.indexOf(cropHarvestUntil(field.crop, sow));
    const until = u < 0 ? first : (u - s + 12) % 12;
    return { first, last: until > first ? until : first };
}

function fieldInHarvestWindow(field, month) {
    const w = fieldHarvestWindow(field);
    const m = ALL_MONTHS.indexOf(month || '');
    if (!w || m < 0) return false;
    const since = (m - ALL_MONTHS.indexOf((field.sowingMonth || '').toUpperCase()) + 12) % 12;
    return since >= w.first && since <= w.last;
}

// Where a field's crop of this season stands: 'harvested', 'growing',
// 'unsown' or null (no annual crop to go by — grass and other cut crops, a
// missed sowing). Harvested once its last harvest month has gone by — or, with
// the save at hand, from its first once the game field no longer grows the crop.
function fieldHarvestState(field, month, saveById, yearPassed) {
    if (!field.crop || isCutCrop(field.crop) || isPerennialCrop(field.crop)) return null;
    const sow = (field.sowingMonth || '').toUpperCase();
    const s = ALL_MONTHS.indexOf(sow);
    const w = fieldHarvestWindow(field);
    if (s < 0 || !w) return null;
    if (field.state !== 'Planted') return isSowingOverdue(field, month) ? null : 'unsown';
    const m = ALL_MONTHS.indexOf(month || '');
    if (m < 0) return 'growing';
    const sinceSowing = (m - s + 12) % 12;
    const gone = !todayGrowsPlannedCrop(field, saveById);
    return sinceSowing > w.last || (gone && (sinceSowing >= w.first || yearPassed)) ? 'harvested' : 'growing';
}

// live: may follow the link mod, for what is only shown. A new season files crops
// away, so it goes by the save. yearPassed: the game has reached the July after
// this season's (seasonStartYearOf).
function seasonHarvestContext(farm, live) {
    const month = getFarmCurrentMonth(farm);
    const now = seasonStartYearOf(farm.yearNumber, month), started = parseInt(farm.seasonStartYear, 10);
    return {
        month,
        saveById: farm.saveGamePath ? (live ? todayLiveFieldsById(farm) : todaySaveFieldsById(farm)) : null,
        yearPassed: !!farm.saveGamePath && now > 0 && started > 0 && now > started
    };
}

// When to start a new season: July has come round in the game. It only moves the
// season number on and files what came off the fields. why: the reason to show.
function seasonEndInfo(farm) {
    const ctx = seasonHarvestContext(farm);
    const why = ctx.yearPassed ? t('seasonEndYear') : '';
    return { yearPassed: ctx.yearPassed, ready: !!why, why };
}

// The New season button says when to use it; once it's time it stands out.
function refreshNewSeasonHint(farm, info) {
    if (!newSeasonBtn) return;
    const current = farm && viewedSeason === (farm.currentSeason || 1);
    const ready = !!(current && info && info.ready);
    newSeasonBtn.classList.toggle('is-ready', ready);
    let title = '';
    if (current && info) {
        title = ready ? t('newSeasonBtnReady') : t('newSeasonBtnWait');
    }
    newSeasonBtn.title = title;
}

// Barns whose trough lasts under TODAY_FEED_LOW_DAYS days at today's need.
function todayLowFeedBarns(farm) {
    const out = [];
    (farm.animalBuildings || []).forEach(b => {
        if (!(b.clusters || []).length) return;
        let daily = 0;
        b.clusters.forEach(c => {
            const type = animalTypeOf(c.subType);
            if (type && ANIMAL_NEEDS_DATA[c.subType]) daily += clusterDailyFood(farm, type, c);
        });
        if (!(daily > 0)) return;
        const level = (b.food || []).reduce((s, f) => s + (f.level || 0), 0);
        const days = level / daily;
        if (days < TODAY_FEED_LOW_DAYS) out.push({ building: b, days });
    });
    return out;
}

// Barns short of straw or water, or with poor health or productivity.
function todayBarnCare(farm) {
    return (farm.animalBuildings || []).map(building => ({ building, issues: barnCareInfo(building).issues })).filter(x => x.issues.length);
}

function todayBarnIssueText(issue) {
    if (issue.key === 'health' || issue.key === 'productivity') return t('todayBarn_' + issue.key).replace('{n}', Math.round(issue.pct));
    return t('todayBarn_' + issue.key).replace('{n}', Math.max(0, Math.floor(issue.days)));
}

// Wet weather in the save's forecast (farm.forecast, from environment.xml):
// the first rain, snow or hail that is falling now or starts within
// TODAY_WEATHER_HOURS, with back-to-back wet entries joined into one spell.
// { type, inHours (0 = now), hours } or null.
const TODAY_WEATHER_HOURS = 24;
const TODAY_WET_WEATHER = ['RAIN', 'SNOW', 'HAIL', 'THUNDER', 'STORM'];
function todayWetWeather(farm) {
    const list = farm && farm.forecast;
    if (!Array.isArray(list) || !list.length || !farm.gameDay) return null;
    const now = farm.gameDay * 1440 + (farm.dayMinutes || 0);
    const spells = [];
    list.forEach(f => {
        if (!TODAY_WET_WEATHER.some(w => f.type.includes(w))) return;
        const start = f.startDay * 1440 + f.startMin, end = start + f.minutes;
        const last = spells[spells.length - 1];
        if (last && start <= last.end + 1) { last.end = Math.max(last.end, end); return; }
        spells.push({ type: f.type, start, end });
    });
    const spell = spells.find(sp => sp.end > now && sp.start < now + TODAY_WEATHER_HOURS * 60);
    if (!spell) return null;
    return { type: spell.type, inHours: Math.max(0, (spell.start - now) / 60), hours: (spell.end - Math.max(spell.start, now)) / 60 };
}

function todayWeatherIcon(type) {
    if (type.includes('SNOW')) return 'fa-snowflake';
    if (type.includes('HAIL') || type.includes('THUNDER') || type.includes('STORM')) return 'fa-cloud-bolt';
    return 'fa-cloud-rain';
}

function todayFieldChipHtml(item, farm, group) {
    const f = item.field;
    const num = (f.number || '').toString().trim();
    const name = fieldNameOf(farm, num);
    const area = parseFloat(f.area) || 0;
    const parts = [t('todayField').replace('{n}', num) + (name ? ' · ' + name : ''), translateCropName(f.crop)];
    if (item.extra) parts.push(item.extra);
    const text = escapeHtml(parts.join(' · '));
    // A job opens the field on its work list, the rest on its crop.
    const tab = ['work', 'weeds', 'roll'].includes(group) ? 'work' : 'crop';
    return `<button type="button" class="today-chip today-field" data-idx="${item.idx}" data-tab="${tab}" title="${text}">
        <span class="today-chip-main">${text}</span>
        ${area ? `<span class="today-chip-ha">${area.toFixed(2)} ha</span>` : ''}
    </button>`;
}

const TODAY_GROUPS = [
    { key: 'sow', icon: 'fa-seedling' },
    { key: 'late', icon: 'fa-triangle-exclamation', warn: true },
    { key: 'harvest', icon: 'fa-wheat-awn' },
    { key: 'mow', icon: 'fa-scissors' },
    { key: 'finish', icon: 'fa-forward-step' },
    { key: 'weeds', icon: 'fa-spray-can' },
    { key: 'roll', icon: 'fa-grip-lines' },
    { key: 'work', icon: 'fa-list-check' }
];

function renderTodayPanel() {
    const el = document.getElementById('today-panel');
    if (!el) return;
    const farm = getCurrentFarm();
    const current = farm && viewedSeason === (farm.currentSeason || 1);
    const month = farm ? getFarmCurrentMonth(farm) : null;
    const seasonEnd = farm && current ? seasonEndInfo(farm) : null;
    refreshNewSeasonHint(farm, seasonEnd);
    if (!farm || !current || isEditMode || !month) { el.hidden = true; syncPlanSidePanels(false, 0); return; }
    el.hidden = false;

    const groups = todayFieldGroups(farm);
    const barns = todayLowFeedBarns(farm);
    const notes = loadNotes(farm).filter(n => (n.months || []).includes(month)).length;
    const weather = todayWetWeather(farm);
    const summaryYear = fieldLogSummaryDue(farm);
    const barnCare = todayBarnCare(farm);
    const count = TODAY_GROUPS.reduce((s, g) => s + groups[g.key].length, 0) + barns.length + (notes ? 1 : 0)
        + (seasonEnd.ready ? 1 : 0) + (weather ? 1 : 0) + (summaryYear ? 1 : 0) + barnCare.length;
    const open = todayPanelOpen();
    el.classList.toggle('is-open', open);
    syncPlanSidePanels(true, count);

    let body = '';
    if (seasonEnd.ready) {
        const why = seasonEnd.why;
        const next = (parseInt(farm.currentSeason, 10) || 1) + 1;
        body += `<div class="today-group today-group--season">
            <h3 class="today-group-title"><i class="fa-solid fa-forward" aria-hidden="true"></i> ${t('today_newSeason')}</h3>
            <div class="today-chips"><button type="button" class="today-chip today-new-season" title="${escapeHtml(why)}">
                <span class="today-chip-main">${escapeHtml(why)}</span>
                <span class="today-chip-ha">${escapeHtml(t('newSeasonStart').replace('{n}', next))}</span>
            </button></div>
        </div>`;
    }
    if (summaryYear) {
        const text = escapeHtml(t('todaySummaryDue').replace('{n}', summaryYear));
        body += `<div class="today-group">
            <h3 class="today-group-title"><i class="fa-solid fa-clipboard-check" aria-hidden="true"></i> ${t('hubSeasonSummary')}</h3>
            <div class="today-chips"><button type="button" class="today-chip today-view" data-view="seasonsummary" title="${text}">
                <span class="today-chip-main">${text}</span>
            </button></div>
        </div>`;
    }
    if (weather) {
        // A warning when there is field work this month that rain gets in the way of.
        const fieldWork = ['sow', 'late', 'harvest', 'mow', 'weeds'].some(k => groups[k].length);
        const kind = t('todayWeather_' + (weather.type.includes('SNOW') ? 'snow' : weather.type.includes('HAIL') ? 'hail' : 'rain'));
        const hours = h => Math.max(1, Math.round(h));
        const when = weather.inHours < 0.5
            ? t('todayWeatherNow').replace('{w}', kind)
            : t('todayWeatherIn').replace('{w}', kind).replace('{in}', hours(weather.inHours));
        const length = t('todayWeatherFor').replace('{h}', hours(weather.hours));
        const tip = when + ' · ' + length + (fieldWork ? ' · ' + t('todayWeatherWork') : '');
        body += `<div class="today-group${fieldWork ? ' is-warn' : ''}">
            <h3 class="today-group-title"><i class="fa-solid ${todayWeatherIcon(weather.type)}" aria-hidden="true"></i> ${t('today_weather')}</h3>
            <div class="today-chips"><span class="today-chip today-chip--static" title="${escapeHtml(tip)}">
                <span class="today-chip-main">${escapeHtml(when)}</span>
                <span class="today-chip-ha">${escapeHtml(length)}</span>
            </span></div>
        </div>`;
    }
    TODAY_GROUPS.forEach(g => {
        const items = groups[g.key];
        if (!items.length) return;
        const ha = items.reduce((s, i) => s + (parseFloat(i.field.area) || 0), 0);
        body += `<div class="today-group${g.warn ? ' is-warn' : ''}">
            <h3 class="today-group-title"><i class="fa-solid ${g.icon}" aria-hidden="true"></i> ${t('today_' + g.key)}
                <span class="today-group-sum">${ha ? ha.toFixed(2) + ' ha' : ''}</span></h3>
            <div class="today-chips">${items.map(i => todayFieldChipHtml(i, farm, g.key)).join('')}</div>
        </div>`;
    });
    if (barns.length) {
        body += `<div class="today-group is-warn">
            <h3 class="today-group-title"><i class="fa-solid fa-cow" aria-hidden="true"></i> ${t('today_feed')}</h3>
            <div class="today-chips">${barns.map(b => `<button type="button" class="today-chip today-view" data-view="animals" title="${escapeHtml(buildingDisplayName(farm, b.building))}">
                <span class="today-chip-main">${escapeHtml(buildingDisplayName(farm, b.building))}</span>
                <span class="today-chip-ha">${t('todayFeedDays').replace('{n}', Math.max(0, Math.floor(b.days)))}</span>
            </button>`).join('')}</div>
        </div>`;
    }
    if (barnCare.length) {
        body += `<div class="today-group is-warn">
            <h3 class="today-group-title"><i class="fa-solid fa-heart-pulse" aria-hidden="true"></i> ${t('today_barnCare')}</h3>
            <div class="today-chips">${barnCare.map(x => {
                const name = escapeHtml(buildingDisplayName(farm, x.building));
                const text = escapeHtml(x.issues.map(todayBarnIssueText).join(' · '));
                return `<button type="button" class="today-chip today-view" data-view="animals" title="${name}: ${text}">
                    <span class="today-chip-main">${name}</span>
                    <span class="today-chip-ha">${text}</span>
                </button>`;
            }).join('')}</div>
        </div>`;
    }
    if (notes) {
        body += `<div class="today-group">
            <h3 class="today-group-title"><i class="fa-solid fa-note-sticky" aria-hidden="true"></i> ${t('today_notes')}</h3>
            <div class="today-chips"><button type="button" class="today-chip today-view" data-view="notes">
                <span class="today-chip-main">${escapeHtml(t('todayNotes').replace('{n}', notes))}</span>
            </button></div>
        </div>`;
    }

    el.classList.toggle('is-open', open);
    el.innerHTML = `<button type="button" class="today-toggle" aria-expanded="${open}">
            <i class="fa-solid fa-chevron-${open ? 'down' : 'up'}" aria-hidden="true"></i>
            <span class="today-title">${t('todayTitle').replace('{m}', translateMonth(month))}</span>
            <span class="today-count${count ? '' : ' is-zero'}">${count ? t('todayCount').replace('{n}', count) : t('todayNothing')}</span>
        </button>
        ${open ? `<div class="today-body">${body || `<p class="today-empty">${escapeHtml(t('todayEmpty'))}</p>`}</div>` : ''}`;
}

(function wireTodayPanel() {
    const el = document.getElementById('today-panel');
    if (!el) return;
    const toggleSetting = (key, on) => {
        setSetting(key, on ? 'true' : 'false');
        renderTodayPanel();
    };
    document.getElementById('plan-side-toggle').addEventListener('click', () => toggleSetting('planSideOpen', String(getSetting('planSideOpen')) === 'false'));
    document.getElementById('crops-toggle').addEventListener('click', () => toggleSetting('cropsPanelOpen', String(getSetting('cropsPanelOpen')) !== 'true'));
    el.addEventListener('click', e => {
        if (e.target.closest('.today-toggle')) {
            setSetting('todayPanelOpen', todayPanelOpen() ? 'false' : 'true');
            renderTodayPanel();
            return;
        }
        if (e.target.closest('.today-new-season')) { runNewSeason(); return; }
        const field = e.target.closest('.today-field');
        if (field) { openFieldModal(parseInt(field.dataset.idx, 10), field.dataset.tab); return; }
        const view = e.target.closest('.today-view');
        if (view) showPlannerView(view.dataset.view);
    });
})();
