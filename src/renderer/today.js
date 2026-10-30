// "Today" panel under the season plan: what the farm needs this in-game month,
// gathered from what the plan already knows — sowing and harvest months from
// the crop calendar, late sowing, weeds and rolling still to do, the next step
// of each field's own work list, barns running out of feed and this month's
// notes. Each field opens its field view. Loaded after fields-table.js.

const TODAY_FEED_LOW_DAYS = 3;   // same "low" as the Animals tab gauge

// Settings come back as strings.
function todayPanelOpen() {
    return String(getSetting('todayPanelOpen')) !== 'false';
}

// Order in which a field's tasks claim it: each field shows once, in its most
// urgent group, and names its other tasks after the crop.
const TODAY_PRIORITY = ['late', 'sow', 'harvest', 'weeds', 'roll', 'work'];

// { key, fields: [{ idx, field, extra }] } groups for the current season.
function todayFieldGroups(farm) {
    const month = getFarmCurrentMonth(farm);
    const fields = farm.fields || [];
    const groups = { sow: [], late: [], harvest: [], weeds: [], roll: [], work: [] };
    if (!month) return groups;
    fields.forEach((field, idx) => {
        if (!field.crop) return;
        const tasks = {};
        const planted = field.state === 'Planted';
        const sow = (field.sowingMonth || '').toUpperCase();
        const cal = CROP_CALENDAR[field.crop] || {};
        const cut = isCutCrop(field.crop) || isPerennialCrop(field.crop);
        if (!planted && sow === month) tasks.sow = t('work_sow');
        else if (isSowingOverdue(field, month)) tasks.late = t('work_sow');
        if (planted && !cut && sow && cal[sow] === month) tasks.harvest = t('work_harvest');
        // Weeds on an unsown field belong to what grows there now, not the planned crop.
        if (planted && field.weeds === 'needed') tasks.weeds = t('work_weeds');
        if (planted && field.rolling && !field.rollingDone) tasks.roll = t('work_roll');
        // Your own work list: its next step, unless a group above already covers it.
        if (fieldWork(field) && !cut) {
            const { next } = nextWorkStep(field, idx, farm);
            if (next && !['sow', 'weeds', 'roll', 'harvest'].includes(next.step)) tasks.work = t('work_' + next.step);
        }
        const keys = TODAY_PRIORITY.filter(k => tasks[k]);
        if (!keys.length) return;
        const others = keys.slice(1).map(k => tasks[k]);
        if (keys[0] === 'work') others.unshift(tasks.work);
        groups[keys[0]].push({ idx, field, extra: others.join(', ') });
    });
    return groups;
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

function todayFieldChipHtml(item, farm) {
    const f = item.field;
    const num = (f.number || '').toString().trim();
    const name = fieldNameOf(farm, num);
    const area = parseFloat(f.area) || 0;
    const parts = [t('todayField').replace('{n}', num) + (name ? ' · ' + name : ''), translateCropName(f.crop)];
    if (item.extra) parts.push(item.extra);
    const text = escapeHtml(parts.join(' · '));
    return `<button type="button" class="today-chip today-field" data-idx="${item.idx}" title="${text}">
        <span class="today-chip-main">${text}</span>
        ${area ? `<span class="today-chip-ha">${area.toFixed(2)} ha</span>` : ''}
    </button>`;
}

const TODAY_GROUPS = [
    { key: 'sow', icon: 'fa-seedling' },
    { key: 'late', icon: 'fa-triangle-exclamation', warn: true },
    { key: 'harvest', icon: 'fa-wheat-awn' },
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
    if (!farm || !current || isEditMode || !month) { el.hidden = true; return; }
    el.hidden = false;

    const groups = todayFieldGroups(farm);
    const barns = todayLowFeedBarns(farm);
    const notes = loadNotes(farm).filter(n => (n.months || []).includes(month)).length;
    const count = TODAY_GROUPS.reduce((s, g) => s + groups[g.key].length, 0) + barns.length + (notes ? 1 : 0);
    const open = todayPanelOpen();

    let body = '';
    TODAY_GROUPS.forEach(g => {
        const items = groups[g.key];
        if (!items.length) return;
        const ha = items.reduce((s, i) => s + (parseFloat(i.field.area) || 0), 0);
        body += `<div class="today-group${g.warn ? ' is-warn' : ''}">
            <h3 class="today-group-title"><i class="fa-solid ${g.icon}" aria-hidden="true"></i> ${t('today_' + g.key)}
                <span class="today-group-sum">${ha ? ha.toFixed(2) + ' ha' : ''}</span></h3>
            <div class="today-chips">${items.map(i => todayFieldChipHtml(i, farm)).join('')}</div>
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
    el.addEventListener('click', e => {
        if (e.target.closest('.today-toggle')) {
            setSetting('todayPanelOpen', todayPanelOpen() ? 'false' : 'true');
            renderTodayPanel();
            return;
        }
        const field = e.target.closest('.today-field');
        if (field) { openFieldModal(parseInt(field.dataset.idx, 10)); return; }
        const view = e.target.closest('.today-view');
        if (view) showPlannerView(view.dataset.view);
    });
})();
