// The plan as a timeline: one row per field, the game's year (March to February)
// across, a bar from the sowing month to the harvest month. It only shows the
// plan: the table stays the place to edit it, so edit mode and the tutorial
// always use the table. A click on a bar opens the field, like its number does.

let fieldsViewMode = null;     // 'table' | 'timeline', remembered in settings

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
}

function timelineMonthPos(month) {
    return FS_PERIOD_TO_MONTH.indexOf(String(month || '').toUpperCase());
}

// Months a crop takes on the axis: [{ from, to, cont }], `to` exclusive. A crop
// harvested the next year runs off the right edge and comes back on the left.
// A carried crop was sown in the season before: only its way to the harvest is left.
function timelineSpans(crop, sowingMonth, carried) {
    const from = timelineMonthPos(sowingMonth);
    if (from < 0) return null;
    const harvest = String((CROP_CALENDAR[crop] || {})[String(sowingMonth).toUpperCase()] || '').toUpperCase();
    const to = timelineMonthPos(harvest);
    if (to < 0) return { harvest: '', spans: [{ from, to: from + 1 }] };
    if (to >= from) return { harvest, spans: [{ from, to: to + 1, end: true }] };
    const tail = { from: 0, to: to + 1, end: true, cont: 'left', nextYear: !carried };
    return { harvest, nextYear: true, spans: carried ? [tail] : [{ from, to: 12, cont: 'right' }, tail] };
}

function timelineBarHtml(span, cls, label, title, idx, clickable, lane) {
    const left = span.from / 12 * 100;
    const width = (span.to - span.from) / 12 * 100;
    const classes = ['timeline-bar', cls, `timeline-bar--lane${lane}`];
    if (span.end) classes.push('has-harvest');
    if (span.cont) classes.push(`cont-${span.cont}`);
    if (span.nextYear) classes.push('is-next-year');
    const style = `left:${left}%;width:${width}%`;
    const inner = `<span class="timeline-bar-label">${escapeHtml(label)}</span>`;
    return clickable
        ? `<button type="button" class="${classes.join(' ')} field-open" data-idx="${idx}" style="${style}" title="${escapeHtml(title)}">${inner}</button>`
        : `<span class="${classes.join(' ')}" style="${style}" title="${escapeHtml(title)}">${inner}</span>`;
}

function timelineCropBars(info, cls, crop, title, idx, clickable, lane) {
    return info.spans.map(s => timelineBarHtml(s, cls, crop, title, idx, clickable, lane)).join('');
}

// Month names come in capitals; a sentence wants "October".
function timelineMonthName(month) {
    const name = translateMonth(month);
    return name.charAt(0) + name.slice(1).toLowerCase();
}

function timelineCropTitle(name, sowingMonth, info) {
    const sown = t('timelineSown').replace('{month}', timelineMonthName(sowingMonth));
    if (!info.harvest) return `${name}: ${sown} · ${t('timelineNoHarvest')}`;
    const key = info.nextYear ? 'timelineHarvestNextYear' : 'timelineHarvest';
    return `${name}: ${sown} · ${t(key).replace('{month}', timelineMonthName(info.harvest))}`;
}

function timelineMainClass(field, currentMonth, isPastSeason) {
    if (field.state === 'Planted') return 'is-sown';
    if (isPastSeason) return 'is-planned';
    const sow = String(field.sowingMonth || '').toUpperCase();
    if (sow && sow === currentMonth) return 'is-now';
    if (isSowingOverdue(field, currentMonth)) return 'is-overdue';
    return 'is-planned';
}

// Grassland stays on the field: a band from its sowing with a mark for each cut.
function timelineCutsHtml(field, name, idx, clickable) {
    const from = Math.max(timelineMonthPos(field.sowingMonth), 0);
    const band = timelineBarHtml({ from, to: 12 }, 'is-grass', name, name, idx, clickable, 0);
    const marks = (field.cuts || []).map((cut, i) => {
        const pos = timelineMonthPos(cut.month);
        if (pos < 0) return '';
        const title = t('timelineCut').replace('{n}', i + 1).replace('{month}', timelineMonthName(cut.month))
            + ' · ' + t('cutUse_' + cut.use) + (cut.harvested ? ' · ' + t('timelineCutDone') : '');
        return `<span class="timeline-cut${cut.harvested ? ' is-done' : ''}" style="left:${(pos + 0.5) / 12 * 100}%" title="${escapeHtml(title)}"></span>`;
    }).join('');
    return band + marks;
}

function timelineTrackHtml(field, idx, currentMonth, isPastSeason) {
    if (!field.crop) return '';
    const clickable = !isPastSeason;
    const name = translateCropName(field.crop);
    if (isCutCrop(field.crop)) return timelineCutsHtml(field, name, idx, clickable);
    let html = '';
    const main = timelineSpans(field.crop, field.sowingMonth, !!field.carriedFrom);
    if (main) {
        const cls = timelineMainClass(field, currentMonth, isPastSeason);
        html += timelineCropBars(main, cls, name, timelineCropTitle(name, field.sowingMonth, main), idx, clickable, 0);
    }
    const catchInfo = field.catchCrop ? timelineSpans(field.catchCrop, field.catchSowingMonth, false) : null;
    if (catchInfo) {
        const catchName = translateCropName(field.catchCrop);
        html += timelineCropBars(catchInfo, 'is-catch', catchName, t('catchCropShort') + ' · ' + timelineCropTitle(catchName, field.catchSowingMonth, catchInfo), idx, clickable, 1);
    }
    return html;
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
    const nowBand = nowPos < 0 ? '' : `<span class="timeline-now" style="left:${nowPos / 12 * 100}%;width:${100 / 12}%"></span>`;

    const head = FS_PERIOD_TO_MONTH.map((m, i) => `<th scope="col" class="timeline-month${i === nowPos ? ' is-now' : ''}" title="${escapeHtml(timelineMonthName(m))}">${escapeHtml(translateMonth(m).slice(0, 3))}</th>`).join('');

    const rows = sortFieldsForDisplay(list, currentMonth)
        .filter(field => fieldMatchesSearch(field, farm))
        .map(field => {
            const idx = list.indexOf(field);
            const parts = String(field.number || '').split('-').map(n => n.trim()).filter(Boolean);
            const chips = (parts.length ? parts : ['–']).map(n => `<span class="field-number-chip">${escapeHtml(n)}</span>`).join('<span class="field-number-sep">–</span>');
            const fieldName = fieldNameOf(farm, (field.number || '').toString().trim());
            const label = `<span class="field-number-chips">${chips}</span>${fieldName ? `<span class="field-name">${escapeHtml(fieldName)}</span>` : ''}`;
            const hasCatch = field.crop && field.catchCrop && timelineMonthPos(field.catchSowingMonth) >= 0 && !isCutCrop(field.crop);
            return `<tr>
                <th scope="row" class="timeline-field">${isPastSeason ? label : `<button type="button" class="field-open timeline-field-open" data-idx="${idx}" title="${escapeHtml(t('fieldViewOpenHint'))}">${label}</button>`}
                    <span class="ha-caption">${(parseFloat(field.area) || 0).toFixed(2)} ha</span></th>
                <td colspan="12" class="timeline-track${hasCatch ? ' has-catch' : ''}">${nowBand}${timelineTrackHtml(field, idx, currentMonth, isPastSeason)}</td>
            </tr>`;
        }).join('');

    const searching = !!fieldSearchQuery() && list.length > 0;
    const body = rows || (searching ? `<tr class="fields-search-empty"><td colspan="13">${escapeHtml(t('fieldsSearchNone'))}</td></tr>` : '');
    const swatch = (cls, key) => `<span class="timeline-legend-item"><span class="timeline-swatch ${cls}"></span>${escapeHtml(t(key))}</span>`;
    box.innerHTML = `<table class="timeline-table">
            <thead><tr><th scope="col" class="timeline-field">${escapeHtml(t('thFieldNo'))}</th>${head}</tr></thead>
            <tbody>${body}</tbody>
        </table>
        <div class="timeline-legend">
            ${swatch('is-planned', 'timelineLegendPlanned')}${swatch('is-now', 'plantNow')}${swatch('is-overdue', 'overdue')}${swatch('is-sown', 'planted')}${swatch('is-catch', 'timelineLegendCatch')}${swatch('is-grass', 'timelineLegendGrass')}
            <span class="timeline-legend-item"><span class="timeline-cut is-done timeline-cut--legend"></span>${escapeHtml(t('timelineLegendCut'))}</span>
            <span class="timeline-legend-item"><span class="timeline-swatch is-harvest"></span>${escapeHtml(t('timelineLegendHarvest'))}</span>
            ${swatch('is-planned is-next-year', 'timelineLegendNextYear')}
        </div>`;
}

const fieldsTimelineEl = document.getElementById('fields-timeline');
if (fieldsTimelineEl) fieldsTimelineEl.addEventListener('click', e => {
    const btn = e.target.closest('.field-open');
    if (btn && !isEditMode) openFieldModal(parseInt(btn.dataset.idx, 10));
});

const fieldsViewSwitchEl = document.getElementById('fields-view-switch');
if (fieldsViewSwitchEl) fieldsViewSwitchEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (!btn || btn.dataset.view === getFieldsViewMode()) return;
    fieldsViewMode = btn.dataset.view;
    try { setSetting('fieldsView', fieldsViewMode); } catch (err) { /* ignore */ }
    renderSeasonView();
});
