// Field log and season summary: what really happened on the fields, as opposed
// to what the plan says. The save only holds each field's state of the moment,
// so every sync compares fields.xml with the state remembered from the last one
// and files the differences as dated events (field_log.json in the farm folder):
//   { savePath, day, daysPerPeriod, year, since, summaryDue,
//     fields: { id: { f, s, g, sp, st, l, m } },
//     events: [{ y, m, d, day, id, type, crop, ha }] }
// Only what the game saved counts, never the link mod's live copy: a game closed
// without saving never happened. An event is dated by the save that first shows
// it, and a field's state is one sample, so a half-finished job reads as done or
// not done. Loaded after fields-table.js.

const FIELD_LOG_FILE = 'field_log.json';
const FIELD_LOG_GROUND = { PLOWED: 'plow', CULTIVATED: 'cultivate', STUBBLE_TILLAGE: 'stubble', SEEDBED: 'seedbed', ROLLED_SEEDBED: 'roll', ROLLER_LINES: 'roll' };
const FIELD_LOG_ICONS = {
    sow: 'fa-seedling', harvest: 'fa-wheat-awn', mow: 'fa-scissors', withered: 'fa-skull', cleared: 'fa-trash-can',
    plow: 'fa-grip-lines', cultivate: 'fa-grip-lines', stubble: 'fa-grip-lines', seedbed: 'fa-grip-lines', roll: 'fa-grip-lines',
    fertilize: 'fa-droplet', manure: 'fa-droplet', lime: 'fa-mountain', mulch: 'fa-leaf'
};
const FIELD_LOG_PREVIEW = 8;

function fieldLogPath(farm) {
    return farm && farm.folderName ? path.join(appDataDir, farm.folderName, FIELD_LOG_FILE) : null;
}

// Read again only when the file changes: the Today panel asks on every render.
let fieldLogCache = { file: null, stamp: null, log: null };
function loadFieldLog(farm) {
    const file = fieldLogPath(farm);
    if (!file || !fs.existsSync(file)) return null;
    try {
        const s = fs.statSync(file), stamp = s.mtimeMs + ':' + s.size;
        if (fieldLogCache.file === file && fieldLogCache.stamp === stamp) return fieldLogCache.log;
        const log = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (!log || !Array.isArray(log.events)) throw new Error('not a field log');
        fieldLogCache = { file, stamp, log };
        return log;
    } catch (e) {
        // Keep what can't be read instead of writing over it on the next sync.
        console.error('Could not read the field log', e);
        try { fs.renameSync(file, file.replace(/\.json$/, '.broken.json')); } catch (err) { /* stays where it is */ }
        return null;
    }
}

function saveFieldLog(farm, log) {
    const file = fieldLogPath(farm);
    if (!file) return;
    try {
        fs.writeFileSync(file + '.tmp', JSON.stringify(log), 'utf-8');
        fs.renameSync(file + '.tmp', file);
        fieldLogCache = { file: null, stamp: null, log: null };
    } catch (e) {
        console.error('Could not write the field log', e);
    }
}

// Where a crop state stands, from the crop's foliage states (agronomy):
// 'empty', 'growing', 'ready', 'dead', 'cut', or 'unknown' without its fruit file.
function fieldLogStage(fruit, state) {
    if (!saveFruitToCropKey(fruit) || !(state > 0)) return 'empty';
    const a = CROP_AGRONOMY[cropOrderKey(saveFruitToCropKey(fruit))];
    if (!a || !Array.isArray(a.readyStates)) return 'unknown';
    if ((a.cutStates || []).includes(state) || (a.rolledCutStates || []).includes(state)) return 'cut';
    if ((a.witheredStates || []).includes(state)) return 'dead';
    return a.readyStates.includes(state) ? 'ready' : 'growing';
}

// What happened on one game field between two remembered states, in the order
// it must have happened: [{ type, crop }].
function fieldLogChanges(p, n) {
    const out = [];
    const oldCrop = saveFruitToCropKey(p.f), newCrop = saveFruitToCropKey(n.f);
    const pStage = fieldLogStage(p.f, p.s), nStage = fieldLogStage(n.f, n.s);
    const same = oldCrop === newCrop;
    const a = oldCrop ? CROP_AGRONOMY[cropOrderKey(oldCrop)] : null;
    const regrowState = same && a ? a.regrowState : undefined;
    const harvestType = () => (isCutCrop(oldCrop) ? 'mow' : 'harvest');
    const standing = s => s === 'growing' || s === 'ready';

    let resown = false;
    if (same && oldCrop) {
        if (standing(pStage) && nStage === 'cut') {
            out.push({ type: harvestType(), crop: oldCrop });
        } else if (standing(pStage) && nStage === 'dead') {
            out.push({ type: 'withered', crop: oldCrop });
        } else if (regrowState !== undefined) {
            // Cut and already regrowing. Winter only knocks a crop back one state,
            // never down to where regrowth starts.
            if (standing(pStage) && p.s > regrowState && n.s === regrowState) out.push({ type: harvestType(), crop: oldCrop });
        } else if ((pStage === 'cut' || pStage === 'dead') && standing(nStage)) {
            resown = true;
        } else if (standing(pStage) && standing(nStage) && n.s < p.s && n.s <= 2) {
            // Same crop again, back at the start: the old one went first.
            out.push({ type: pStage === 'ready' ? 'harvest' : 'cleared', crop: oldCrop });
            resown = true;
        }
    } else if (oldCrop) {
        // The crop is gone. Ripe means harvested; a crop that wasn't ripe was
        // worked under; a dead one is already in the log.
        if (pStage === 'ready') out.push({ type: harvestType(), crop: oldCrop });
        else if (pStage === 'growing') out.push({ type: 'cleared', crop: oldCrop });
    }

    if (p.g !== n.g && FIELD_LOG_GROUND[n.g]) out.push({ type: FIELD_LOG_GROUND[n.g], crop: null });
    if (n.m > 0 && p.m === 0) out.push({ type: 'mulch', crop: null });
    if (n.l > p.l) out.push({ type: 'lime', crop: null });
    if (n.sp > p.sp) out.push({ type: SAVE_SPRAY_NATURAL.includes(n.st) ? 'manure' : 'fertilize', crop: null });

    const newlySown = newCrop && (!same || resown) && (nStage === 'growing' || nStage === 'ready' || nStage === 'unknown');
    if (newlySown) out.push({ type: 'sow', crop: newCrop });
    return out;
}

// Planner area of a game field, for saves without Precision Farming: only when
// the row is that one field (a merged row doesn't say how its area splits).
function fieldLogArea(farm, g) {
    if (g.areaHa != null) return Math.round(g.areaHa * 100) / 100;
    const row = (farm.fields || []).find(f => { const ids = gameFieldIds(f); return ids.length === 1 && ids[0] === g.id; });
    const area = row ? parseFloat(row.area) : NaN;
    return area > 0 ? area : null;
}

// Called on every read of the save. Returns true when the log gained something
// the planner should show.
function recordFieldLog(farm, gameData) {
    try {
        const day = parseInt(gameData.gameDay, 10), year = parseInt(gameData.gameYear, 10);
        if (!(day > 0) || !(year > 0) || !gameData.month) return false;
        const save = readSaveFields(farm, { saved: true });
        if (!save.ok) return false;

        const fields = {};
        save.fields.forEach(g => {
            fields[g.id] = { f: g.fruitType, s: g.growthState, g: g.groundType, sp: g.sprayLevel, st: g.sprayType, l: g.limeLevel, m: g.stubbleShredLevel };
        });
        const dpp = parseInt(gameData.daysPerPeriod, 10) || 1;
        const stamp = { y: year, m: gameData.month, d: dpp > 1 ? parseInt(gameData.dayInPeriod, 10) || null : null };
        const old = loadFieldLog(farm);
        if (!old) {
            saveFieldLog(farm, { savePath: farm.saveGamePath, day, daysPerPeriod: dpp, year, since: stamp, fields, events: [] });
            return false;
        }

        const log = old;
        // Another save behind the farm, or another day length: the states can't be
        // compared, so start again from here and keep the log.
        const comparable = log.savePath === farm.saveGamePath && log.daysPerPeriod === dpp;
        let added = 0, due = false, rolledBack = false;
        if (comparable && day < log.day) {
            // An older save was put back: what the log says happened after it didn't.
            const kept = log.events.filter(e => e.day <= day);
            if (kept.length !== log.events.length) {
                try { fs.copyFileSync(fieldLogPath(farm), fieldLogPath(farm).replace(/\.json$/, '.before-rollback.json')); } catch (e) { /* log still goes on */ }
                log.events = kept;
            }
            rolledBack = true;
        } else if (comparable) {
            save.fields.forEach(g => {
                const before = log.fields && log.fields[g.id];
                if (!before) return;    // just bought: nothing to compare yet
                const changes = fieldLogChanges(before, fields[g.id]);
                if (!changes.length) return;
                const ha = fieldLogArea(farm, g);
                changes.forEach(c => {
                    log.events.push({ ...stamp, day, id: g.id, type: c.type, crop: c.crop, ha });
                    added++;
                });
            });
            if (year > log.year && log.events.some(e => e.y === log.year)) {
                log.summaryDue = log.year;
                due = true;
            }
        }
        const moved = added || rolledBack || !comparable || day !== log.day || year !== log.year
            || JSON.stringify(log.fields) !== JSON.stringify(fields);
        if (!moved) return false;
        saveFieldLog(farm, { ...log, savePath: farm.saveGamePath, day, daysPerPeriod: dpp, year, fields });
        return added > 0 || due || rolledBack;
    } catch (e) {
        console.error('recordFieldLog failed', e);
        return false;
    }
}

// Newest first (the log is filed in date order).
function fieldLogEventsOf(farm, ids) {
    const log = loadFieldLog(farm);
    if (!log) return [];
    const wanted = new Set(ids);
    return log.events.filter(e => wanted.has(e.id)).reverse();
}

function fieldLogDateText(e) {
    // Month names come in capitals for the header; Polish writes them in lower case.
    const lower = translateMonth(e.m).toLowerCase();
    const month = currentLang === 'pl' ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    return t('fieldLogDate').replace('{y}', e.y).replace('{m}', month) + (e.d ? ' ' + e.d : '');
}

function fieldLogEventHtml(e, showField) {
    const what = t('fieldLog_' + e.type) + (e.crop ? ': ' + translateCropName(e.crop) : '');
    const where = showField ? `<span class="field-log-where">${escapeHtml(t('todayField').replace('{n}', e.id))}</span>` : '';
    return `<li class="field-log-item field-log-item--${e.type}">
        <i class="fa-solid ${FIELD_LOG_ICONS[e.type] || 'fa-circle'}" aria-hidden="true"></i>
        <span class="field-log-date">${escapeHtml(fieldLogDateText(e))}</span>
        ${where}<span class="field-log-what">${escapeHtml(what)}</span>
    </li>`;
}

// The field view's log. ids: the game fields behind the row.
function fieldLogSectionHtml(farm, ids) {
    const events = fieldLogEventsOf(farm, ids);
    if (!events.length) return `<p class="settings-hint">${t(farm.saveGamePath ? 'fieldLogEmpty' : 'fieldLogNoSave')}</p>`;
    const many = ids.length > 1;
    const list = list => list.map(e => fieldLogEventHtml(e, many)).join('');
    const rest = events.slice(FIELD_LOG_PREVIEW);
    return `<ul class="field-log">${list(events.slice(0, FIELD_LOG_PREVIEW))}</ul>`
        + (rest.length ? `<details class="field-log-more"><summary>${escapeHtml(t('fieldLogShowAll').replace('{n}', events.length))}</summary><ul class="field-log">${list(rest)}</ul></details>` : '');
}

// Per crop, what the log shows for a game year.
function seasonSummaryRows(events) {
    const rows = {};
    const row = crop => rows[crop] || (rows[crop] = { crop, sown: 0, harvested: 0, mown: 0, cuts: 0, lost: 0 });
    let noArea = 0;
    events.forEach(e => {
        if (!e.crop) return;
        const r = row(e.crop), ha = e.ha || 0;
        if (e.ha == null) noArea++;
        if (e.type === 'sow') r.sown += ha;
        else if (e.type === 'harvest') r.harvested += ha;
        else if (e.type === 'mow') { r.mown += ha; r.cuts++; }
        else if (e.type === 'withered' || e.type === 'cleared') r.lost += ha;
    });
    const list = Object.values(rows).sort((a, b) => compareCropsGameOrder(a.crop, b.crop));
    return { list, noArea };
}

function fieldLogSummaryDue(farm) {
    const log = loadFieldLog(farm);
    return log && log.summaryDue ? log.summaryDue : null;
}

function renderSeasonSummaryPanel(titleEl, bodyEl, year) {
    titleEl.textContent = t('seasonSummaryTitle');
    const farm = getCurrentFarm();
    const log = farm ? loadFieldLog(farm) : null;
    const events = log ? log.events : [];
    if (!events.length) {
        bodyEl.innerHTML = `<p class="hub-panel-note">${t(farm && farm.saveGamePath ? 'seasonSummaryEmpty' : 'fieldLogNoSave')}</p>`;
        return;
    }
    const years = [...new Set(events.map(e => e.y))].sort((a, b) => a - b);
    const latest = years[years.length - 1];
    let shown = parseInt(year, 10) || log.summaryDue || latest;
    if (!years.includes(shown)) shown = latest;
    // Looking at the finished year answers the reminder.
    if (log.summaryDue === shown) {
        const { summaryDue, ...rest } = log;
        saveFieldLog(farm, rest);
        if (typeof renderTodayPanel === 'function') renderTodayPanel();
    }

    const at = years.indexOf(shown);
    const arrow = (dir, target) => target !== undefined
        ? `<button type="button" class="yield-season-arrow" data-year="${target}" aria-label="${escapeHtml(t('seasonSummaryYear').replace('{n}', target))}"><i class="fa-solid fa-chevron-${dir < 0 ? 'left' : 'right'}" aria-hidden="true"></i></button>`
        : `<span class="yield-season-arrow is-disabled" aria-hidden="true"><i class="fa-solid fa-chevron-${dir < 0 ? 'left' : 'right'}"></i></span>`;
    const inYear = events.filter(e => e.y === shown);
    const { list, noArea } = seasonSummaryRows(inYear);
    const ha = v => (v > 0 ? `${v.toFixed(2)} ha` : '–');
    const showMown = list.some(r => r.cuts), showLost = list.some(r => r.lost > 0);
    const total = key => list.reduce((s, r) => s + r[key], 0);

    let html = `<div class="yield-season-nav">${arrow(-1, years[at - 1])}<span class="yield-season-label">${escapeHtml(t('seasonSummaryYear').replace('{n}', shown))}</span>${arrow(1, years[at + 1])}</div>`;
    html += `<p class="supply-intro">${t('seasonSummaryIntro')}</p>`;
    if (list.length) {
        html += `<table class="data-table supply-table season-summary-table"><thead><tr>
            <th>${t('yieldForecastColCrop')}</th><th>${t('seasonSummaryColSown')}</th><th>${t('seasonSummaryColHarvested')}</th>
            ${showMown ? `<th>${t('seasonSummaryColMown')}</th>` : ''}${showLost ? `<th>${t('seasonSummaryColLost')}</th>` : ''}
            </tr></thead><tbody>`;
        list.forEach(r => {
            html += `<tr><td>${escapeHtml(translateCropName(r.crop))}</td><td>${ha(r.sown)}</td><td>${ha(r.harvested)}</td>
                ${showMown ? `<td>${ha(r.mown)}${r.cuts ? ` <span class="season-summary-cuts">(${escapeHtml(t('seasonSummaryCuts').replace('{n}', r.cuts))})</span>` : ''}</td>` : ''}
                ${showLost ? `<td>${ha(r.lost)}</td>` : ''}</tr>`;
        });
        html += `</tbody><tfoot><tr class="supply-total-row"><td>${t('suppliesTotal')}</td><td>${ha(total('sown'))}</td><td>${ha(total('harvested'))}</td>
            ${showMown ? `<td>${ha(total('mown'))}</td>` : ''}${showLost ? `<td>${ha(total('lost'))}</td>` : ''}</tr></tfoot></table>`;
    } else {
        html += `<p class="hub-panel-note">${t('seasonSummaryNoCrops')}</p>`;
    }
    if (noArea) html += `<p class="hub-panel-note">${escapeHtml(t('seasonSummaryNoArea').replace('{n}', noArea))}</p>`;
    if (log.since) html += `<p class="hub-panel-note">${escapeHtml(t('seasonSummarySince').replace('{date}', fieldLogDateText(log.since)))}</p>`;
    html += `<details class="field-log-more season-summary-log"><summary>${escapeHtml(t('seasonSummaryLog').replace('{n}', inYear.length))}</summary>
        <ul class="field-log">${inYear.slice().reverse().map(e => fieldLogEventHtml(e, true)).join('')}</ul></details>`;
    bodyEl.innerHTML = html;
    bodyEl.querySelectorAll('.yield-season-arrow[data-year]').forEach(btn => {
        btn.addEventListener('click', () => renderSeasonSummaryPanel(titleEl, bodyEl, parseInt(btn.dataset.year, 10)));
    });
}
