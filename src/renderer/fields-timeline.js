// The plan as a timeline: one row per field, the game's years (March to February)
// across, a bar from the sowing month to the harvest month, this season's plan
// and then what the field's rotation brings, catch crops too. It only shows the
// plan: the table stays the place to edit it, so edit mode and the tutorial
// always use the table. A click on a bar opens the field, like its number does.

let fieldsViewMode = null;     // 'table' | 'timeline', remembered in settings
const TIMELINE_DEFAULT_AHEAD = 2, TIMELINE_MAX_AHEAD = 4;   // seasons shown after this one

function getFieldsViewMode() {
    if (fieldsViewMode === null) {
        fieldsViewMode = String(getSetting('fieldsView')) === 'timeline' ? 'timeline' : 'table';
    }
    return fieldsViewMode;
}

function timelineIsShown() {
    if (isEditMode) return false;
    if (typeof tut !== 'undefined' && tut.active) return false;
    return getFieldsViewMode() === 'timeline';
}

// Shows the view in use and the switch's state; the switch steps aside while editing.
function updateFieldsViewUi() {
    const shown = timelineIsShown();
    const tableWrap = document.getElementById('fields-table-wrap');
    const timeline = document.getElementById('fields-timeline');
    if (tableWrap) tableWrap.hidden = shown;
    if (timeline) timeline.hidden = !shown;
    const sw = document.getElementById('fields-view-switch');
    if (sw) {
        sw.hidden = isEditMode;
        sw.querySelectorAll('button').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.view === getFieldsViewMode()));
        });
    }
    // Seasons ahead: only on the timeline of the current season.
    const aheadSw = document.getElementById('timeline-ahead-switch');
    if (aheadSw) {
        const farm = getAllFarms().find(f => f.id === currentFarmId);
        aheadSw.hidden = !shown || viewedSeason < ((farm && farm.currentSeason) || 1);
        const ahead = timelineAheadYears();
        aheadSw.querySelectorAll('button').forEach(b => {
            b.setAttribute('aria-pressed', String(parseInt(b.dataset.ahead, 10) === ahead));
        });
    }
}

function timelineMonthPos(month) {
    return FS_PERIOD_TO_MONTH.indexOf(String(month || '').toUpperCase());
}

// Months are counted from March of the viewed year (0), and run on over the
// following years: 14 = May of the year after. A bar is { from, to } with `to`
// exclusive, either end may lie off the axis.

// The first time this calendar month comes round, at `after` or later.
function timelineNextMonth(pos, after) {
    return after + ((pos - after % 12 + 12) % 12);
}

// A crop sown at month `from`: where it ends, from the crop calendar.
function timelineCropBar(crop, sowingMonth, from) {
    const sow = String(sowingMonth || '').toUpperCase();
    const harvest = String((CROP_CALENDAR[crop] || {})[sow] || '').toUpperCase();
    const h = timelineMonthPos(harvest);
    if (h < 0) return { crop, sowingMonth: sow, from, to: from + 1, harvest: '', harvestAt: null };
    const at = from + ((h - ((from % 12) + 12) % 12 + 12) % 12);
    return { crop, sowingMonth: sow, from, to: at + 1, harvest, harvestAt: at };
}

// Where this season's main crop starts. A crop sown earlier may lie before the
// axis, and one not sown yet whose month has gone by this year comes next year.
function timelineStart(field, sowPos, nowPos, currentMonth) {
    const harvest = timelineMonthPos((CROP_CALENDAR[field.crop] || {})[String(field.sowingMonth || '').toUpperCase()]);
    if (field.carriedFrom) return harvest >= 0 && harvest < sowPos ? sowPos - 12 : sowPos;
    if (nowPos < 0) return sowPos;
    if (field.state === 'Planted') return sowPos > nowPos ? sowPos - 12 : sowPos;
    if (sowPos < nowPos && !isSowingOverdue(field, currentMonth)) return sowPos + 12;
    return sowPos;
}

// A catch crop goes in once the main crop is off the field.
function timelineCatchBar(main, catchCrop, catchMonth, after) {
    const pos = timelineMonthPos(catchMonth);
    if (!catchCrop || pos < 0) return null;
    return { ...timelineCropBar(catchCrop, catchMonth, timelineNextMonth(pos, Math.max(after, 0))), lane: 1 };
}

// The crops of one field along the axis, in order: this season's from the plan,
// the next from its rotation (or the crop generator), each sown once the one
// before is off the field. Catch crops run until the next crop goes in.
function timelinePlanBars(farm, field, months, nowPos, currentMonth, isPastSeason) {
    const bars = [];
    let cursor = Math.max(nowPos, 0);
    let last = null;
    if (field.crop && timelineMonthPos(field.sowingMonth) >= 0) {
        const start = timelineStart(field, timelineMonthPos(field.sowingMonth), nowPos, currentMonth);
        if (isCutCrop(field.crop)) {
            const hasNext = !isPastSeason && (fieldRotationInfo(farm, field) || field.nextCrop);
            last = { crop: field.crop, sowingMonth: field.sowingMonth, from: start, to: hasNext ? (Math.floor(start / 12) + 1) * 12 : months, harvest: '', harvestAt: null, grass: true };
            bars.push(last);
            cursor = Math.max(cursor, last.to);
        } else {
            last = timelineCropBar(field.crop, field.sowingMonth, start);
            bars.push(last);
            const off = last.harvestAt !== null ? last.harvestAt : last.to;
            cursor = Math.max(cursor, off);
            const catchBar = timelineCatchBar(last, field.catchCrop, field.catchSowingMonth, off);
            if (catchBar) bars.push(catchBar);
        }
    } else if (field.crop && isCutCrop(field.crop)) {
        return bars;
    }
    if (isPastSeason) return bars;

    const ahead = rotationTimeline(farm, field, {}, 0, 2 * Math.ceil(months / 12) + 2).filter(e => e.projected);
    for (const e of ahead) {
        if (cursor >= months) break;
        const crop = e.crops[0];
        if (!crop) continue;
        const source = { season: e.season, generated: !!e.generated };
        // Grassland that stays on simply goes on for another year.
        if (last && isPerennialCrop(crop) && cropOrderKey(last.crop) === cropOrderKey(crop)) {
            last.to += 12;
            cursor = Math.max(cursor, last.to);
            continue;
        }
        const month = e.generated ? (field.nextCrop.sowingMonth || rotationDefaultSowMonth(crop)) : rotationSowMonth(e.slot);
        const pos = timelineMonthPos(month);
        if (pos < 0) continue;
        const from = timelineNextMonth(pos, cursor);
        const bar = isCutCrop(crop)
            ? { crop, sowingMonth: month, from, to: from + 12, harvest: '', harvestAt: null, grass: true }
            : timelineCropBar(crop, month, from);
        bar.source = source;
        // Sown in the month the crop before comes off: half a month each.
        const start = last && last.harvestAt === from ? from + 0.5 : from;
        if (last && last.harvestAt === from) last.to = start;
        bar.from = start;
        bars.forEach(b => { if (b.lane === 1 && b.to > start) b.to = start; });
        bars.push(bar);
        last = bar;
        const off = bar.harvestAt !== null ? bar.harvestAt : bar.to;
        cursor = off;
        if (e.catchCrop && !bar.grass) {
            const catchBar = timelineCatchBar(bar, e.catchCrop, rotationCatchSowMonth(crop, month, e.catchCrop), off);
            if (catchBar) { catchBar.source = source; bars.push(catchBar); }
        }
    }
    return bars.filter(b => b.to > b.from && b.from < months);
}

function timelineBarHtml(bar, cls, label, title, idx, clickable, months) {
    const from = Math.max(bar.from, 0), to = Math.min(bar.to, months);
    if (to <= from) return '';
    const classes = ['timeline-bar', cls, `timeline-bar--lane${bar.lane || 0}`];
    if (bar.harvestAt !== null && bar.harvestAt !== undefined && bar.harvestAt < months) classes.push('has-harvest');
    if (bar.from < 0) classes.push('cont-left');
    if (bar.to > months) classes.push('cont-right');
    if (bar.source) classes.push('is-projected');
    const style = `left:${from / months * 100}%;width:${(to - from) / months * 100}%`;
    const inner = `<span class="timeline-bar-label">${escapeHtml(label)}</span>`;
    return clickable
        ? `<button type="button" class="${classes.join(' ')} field-open" data-idx="${idx}" style="${style}" title="${escapeHtml(title)}">${inner}</button>`
        : `<span class="${classes.join(' ')}" style="${style}" title="${escapeHtml(title)}">${inner}</span>`;
}

// Month names come in capitals; a sentence wants "October".
function timelineMonthName(month) {
    const name = translateMonth(month);
    return name.charAt(0) + name.slice(1).toLowerCase();
}

function timelineCropTitle(bar) {
    const name = translateCropName(bar.crop);
    const sown = t('timelineSown').replace('{month}', timelineMonthName(bar.sowingMonth));
    if (bar.grass) return `${name}: ${sown}`;
    if (!bar.harvest) return `${name}: ${sown} · ${t('timelineNoHarvest')}`;
    const crossesYear = Math.floor(bar.harvestAt / 12) > Math.floor(bar.from / 12);
    return `${name}: ${sown} · ${t(crossesYear ? 'timelineHarvestNextYear' : 'timelineHarvest').replace('{month}', timelineMonthName(bar.harvest))}`;
}

function timelineMainClass(field, currentMonth, isPastSeason) {
    if (field.state === 'Planted') return 'is-sown';
    if (isPastSeason) return 'is-planned';
    const sow = String(field.sowingMonth || '').toUpperCase();
    if (sow && sow === currentMonth) return 'is-now';
    if (isSowingOverdue(field, currentMonth)) return 'is-overdue';
    return 'is-planned';
}

// Grassland's marks for the cuts planned this season.
function timelineCutsHtml(field, months) {
    return (field.cuts || []).map((cut, i) => {
        const pos = timelineMonthPos(cut.month);
        if (pos < 0) return '';
        const title = t('timelineCut').replace('{n}', i + 1).replace('{month}', timelineMonthName(cut.month))
            + ' · ' + t('cutUse_' + cut.use) + (cut.harvested ? ' · ' + t('timelineCutDone') : '');
        return `<span class="timeline-cut${cut.harvested ? ' is-done' : ''}" style="left:${(pos + 0.5) / months * 100}%" title="${escapeHtml(title)}"></span>`;
    }).join('');
}

function timelineTrackHtml(bars, field, idx, currentMonth, isPastSeason, months) {
    const clickable = !isPastSeason;
    let html = '';
    bars.forEach(bar => {
        const name = translateCropName(bar.crop);
        const planned = !bar.source && !bar.lane && !bar.grass;
        const cls = bar.lane === 1 ? 'is-catch' : (bar.grass ? 'is-grass' : (planned ? timelineMainClass(field, currentMonth, isPastSeason) : 'is-planned'));
        let title = timelineCropTitle(bar);
        if (bar.lane === 1) title = t('catchCropShort') + ' · ' + title;
        if (bar.source) title = `${t('season')} ${bar.source.season} · ${t(bar.source.generated ? 'rotByGenerator' : 'rotProjected')} · ${title}`;
        html += timelineBarHtml(bar, cls, name, title, idx, clickable, months);
    });
    if (field.crop && isCutCrop(field.crop)) html += timelineCutsHtml(field, months);
    return html;
}

function timelineAheadYears() {
    const n = parseInt(getSetting('timelineAhead'), 10);
    return n >= 1 && n <= TIMELINE_MAX_AHEAD ? n : TIMELINE_DEFAULT_AHEAD;
}

function renderFieldsTimeline(fields) {
    updateFieldsViewUi();
    const box = document.getElementById('fields-timeline');
    if (!box || !timelineIsShown()) return;

    const farm = getAllFarms().find(f => f.id === currentFarmId);
    const currentMonth = farm && farm.month ? farm.month.toUpperCase() : '';
    const isPastSeason = viewedSeason < ((farm && farm.currentSeason) || 1);
    const nowPos = isPastSeason ? -1 : timelineMonthPos(currentMonth);
    const list = fields || [];
    // A past season gets its own year and the next, where its winter crops end.
    const ahead = isPastSeason ? 1 : timelineAheadYears();
    const years = ahead + 1, months = years * 12;
    const nowBand = nowPos < 0 ? '' : `<span class="timeline-now" style="left:${nowPos / months * 100}%;width:${100 / months}%"></span>`;

    const firstYear = parseInt(farm && farm.yearNumber, 10) || 1;
    const yearLabel = y => (isPastSeason ? (y ? '' : `${t('season')} ${viewedSeason}`) : t('timelineYear').replace('{n}', firstYear + y));
    let yearHead = '', head = '';
    for (let y = 0; y < years; y++) {
        yearHead += `<th scope="colgroup" colspan="12" class="timeline-year">${escapeHtml(yearLabel(y))}</th>`;
        head += FS_PERIOD_TO_MONTH.map((m, i) => `<th scope="col" class="timeline-month${i === 0 && y ? ' is-year-start' : ''}${y === 0 && i === nowPos ? ' is-now' : ''}" title="${escapeHtml(timelineMonthName(m))}">${escapeHtml(translateMonth(m).slice(0, 3))}</th>`).join('');
    }

    const rows = sortFieldsForDisplay(list, currentMonth)
        .filter(field => fieldMatchesSearch(field, farm))
        .map(field => {
            const idx = list.indexOf(field);
            const parts = String(field.number || '').split('-').map(n => n.trim()).filter(Boolean);
            const chips = (parts.length ? parts : ['–']).map(n => `<span class="field-number-chip">${escapeHtml(n)}</span>`).join('<span class="field-number-sep">–</span>');
            const fieldName = fieldNameOf(farm, (field.number || '').toString().trim());
            const label = `<span class="field-number-chips">${chips}</span>${fieldName ? `<span class="field-name">${escapeHtml(fieldName)}</span>` : ''}`;
            const bars = timelinePlanBars(farm, field, months, nowPos, currentMonth, isPastSeason);
            const hasCatch = bars.some(b => b.lane === 1);
            return `<tr>
                <th scope="row" class="timeline-field">${isPastSeason ? label : `<button type="button" class="field-open timeline-field-open" data-idx="${idx}" title="${escapeHtml(t('fieldViewOpen'))}">${label}</button>`}
                    <span class="ha-caption">${(parseFloat(field.area) || 0).toFixed(2)} ha</span></th>
                <td colspan="${months}" class="timeline-track${hasCatch ? ' has-catch' : ''}">${nowBand}${timelineTrackHtml(bars, field, idx, currentMonth, isPastSeason, months)}</td>
            </tr>`;
        }).join('');

    const searching = !!fieldSearchQuery() && list.length > 0;
    const body = rows || (searching ? `<tr class="fields-search-empty"><td colspan="${months + 1}">${escapeHtml(t('fieldsSearchNone'))}</td></tr>` : '');
    const swatch = (cls, key) => `<span class="timeline-legend-item"><span class="timeline-swatch ${cls}"></span>${escapeHtml(t(key))}</span>`;
    const scroller = box.querySelector('.timeline-scroll');
    const scrollLeft = scroller ? scroller.scrollLeft : 0;
    box.innerHTML = `<div class="timeline-scroll">
        <table class="timeline-table" style="--timeline-months:${months};--timeline-years:${years};min-width:${132 + months * 44}px">
            <thead><tr><th scope="col" rowspan="2" class="timeline-field">${escapeHtml(t('thFieldNo'))}</th>${yearHead}</tr><tr>${head}</tr></thead>
            <tbody>${body}</tbody>
        </table>
        </div>
        <div class="timeline-legend">
            ${swatch('is-planned', 'timelineLegendPlanned')}${swatch('is-now', 'plantNow')}${swatch('is-overdue', 'overdue')}${swatch('is-sown', 'planted')}${swatch('is-catch', 'timelineLegendCatch')}${swatch('is-grass', 'timelineLegendGrass')}
            <span class="timeline-legend-item"><span class="timeline-cut is-done timeline-cut--legend"></span>${escapeHtml(t('timelineLegendCut'))}</span>
            <span class="timeline-legend-item"><span class="timeline-swatch is-harvest"></span>${escapeHtml(t('timelineLegendHarvest'))}</span>
            ${isPastSeason ? '' : swatch('is-planned is-projected', 'rotProjected')}
        </div>`;
    box.querySelector('.timeline-scroll').scrollLeft = scrollLeft;
}

const fieldsTimelineEl = document.getElementById('fields-timeline');
if (fieldsTimelineEl) fieldsTimelineEl.addEventListener('click', e => {
    const btn = e.target.closest('.field-open');
    if (btn && !isEditMode) openFieldModal(parseInt(btn.dataset.idx, 10));
});

// Switching what the fields area shows slides the old view out and the new one
// in. Only on these clicks: a sync redrawing the plan stays still. `back` turns
// the direction round. The name goes on the two views for the switch alone, since
// it would make each of them a stacking context the rest of the time.
let fieldsViewSwitches = 0;
function switchFieldsView(update, back) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduced) { update(); return; }
    const root = document.documentElement;
    root.classList.add('is-fields-switching');
    root.dataset.viewDir = back ? 'back' : 'forward';
    fieldsViewSwitches++;
    const transition = document.startViewTransition(update);
    transition.ready.catch(() => { /* cut short by the next click */ });
    transition.finished.catch(() => {}).then(() => {
        fieldsViewSwitches--;
        if (!fieldsViewSwitches) root.classList.remove('is-fields-switching');
    });
}

const timelineAheadSwitchEl = document.getElementById('timeline-ahead-switch');
if (timelineAheadSwitchEl) timelineAheadSwitchEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-ahead]');
    if (!btn) return;
    const ahead = parseInt(btn.dataset.ahead, 10);
    if (ahead === timelineAheadYears()) return;
    switchFieldsView(() => {
        try { setSetting('timelineAhead', btn.dataset.ahead); } catch (err) { /* ignore */ }
        renderSeasonView();
    }, ahead < timelineAheadYears());
});

const fieldsViewSwitchEl = document.getElementById('fields-view-switch');
if (fieldsViewSwitchEl) fieldsViewSwitchEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (!btn || btn.dataset.view === getFieldsViewMode()) return;
    switchFieldsView(() => {
        fieldsViewMode = btn.dataset.view;
        try { setSetting('fieldsView', fieldsViewMode); } catch (err) { /* ignore */ }
        renderSeasonView();
    }, btn.dataset.view === 'table');
});
