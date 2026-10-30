// =============================================================
// SEASON PLAN TABLE: the fields table and its chips, sorting, search, the
// field window, cuts, the work planner, Edit mode (rows, split fields, area
// auto-fill), field backups and loading fields from the game.
// =============================================================
// A classic <script> loaded right after renderer.js (see index.html): its
// top-level code wires listeners to the DOM elements renderer.js looks up
// (fieldsBody, editSeasonBtn…), so it must come after it. renderer.js must not
// call anything from here while it loads — only later (DOMContentLoaded, clicks).


// Groups rows sharing the same field number so split fields
// (two crops on one physical field) can be flagged in the UI.
function getFieldNumberTotals(fields) {
    const totals = {};
    (fields || []).forEach(f => {
        const key = (f.number || '').toString().trim();
        if (!key) return;
        const area = parseFloat(f.area || 0);
        if (!totals[key]) totals[key] = { count: 0, area: 0 };
        totals[key].count += 1;
        totals[key].area += area;
    });
    return totals;
}

// Lime now tracks a real per-field pH value (field.limePh, via resolveLimePh
// above) instead of just diffing season numbers. `i` must be the field's real
// index in farm.fields (not a position in a sorted copy) since it's used to
// look up the field's soil mix — see call sites for how each resolves it.
// Returns { ph, status } — ph in [0,1] or null (never limed); status is only
// for the tooltip/accessibility ('off'|'active'|'warning', 0.75 threshold
// mirrors the old "warns from the 3rd season" cutoff at the old 0.125/harvest
// rate).
function getLimeStatus(field, i, seasonNum, rates) {
    // Current season with Precision Farming in the save: the game's own pH.
    const farm = getCurrentFarm();
    if (farm && seasonNum === (farm.currentSeason || 1)) {
        const pf = pfFieldData((field.number || '').toString().trim());
        if (pf && pf.ph) return pfLimeStatus(pf.ph);
    }
    const soilMix = getFieldSoilMix(fertPlanSoilKey(field, i), rates);
    const ph = resolveLimePh(field, seasonNum, soilMix);
    if (ph == null) return { ph: null, status: 'off' };
    return { ph, status: ph > 0.75 ? 'active' : 'warning' };
}

// Lime a field this season. The liming it replaces is kept in limePrev, so a
// mistaken click can be taken back without losing the older history.
function applyLiming(field, season) {
    if (field.limeAppliedSeason !== season) {
        field.limePrev = { season: field.limeAppliedSeason ?? null, ph: field.limePh ?? null };
    }
    field.limeAppliedSeason = season;
    field.limePh = LIME_PH_IDEAL;
}

// Take back this season's liming (back to the one before it), or clear it.
function undoLiming(field, season) {
    const prev = field.limeAppliedSeason === season ? field.limePrev : null;
    field.limeAppliedSeason = prev ? prev.season : null;
    field.limePh = prev ? prev.ph : null;
    delete field.limePrev;
}

// Fill color for the lime chip, interpolated across 3 stops as pH drops from
// ideal (field green) through amber to --color-rust (the
// old "warning" color). Returns null when never limed (chip stays empty).
const LIME_COLOR_STOPS = [
    [0, [166, 69, 43]],     // 0.0 -> --color-rust (#A6452B)
    [0.5, [201, 122, 43]],  // 0.5 -> --color-accent (#C97A2B)
    [1, [63, 107, 68]]      // 1.0 -> --color-primary (#3F6B44), freshly limed
];
function limeChipColor(ph) {
    if (ph == null) return null;
    for (let i = 0; i < LIME_COLOR_STOPS.length - 1; i++) {
        const [p0, c0] = LIME_COLOR_STOPS[i];
        const [p1, c1] = LIME_COLOR_STOPS[i + 1];
        if (ph >= p0 && ph <= p1) {
            const frac = (ph - p0) / (p1 - p0);
            const rgb = c0.map((v, idx) => Math.round(v + (c1[idx] - v) * frac));
            return `rgb(${rgb.join(',')})`;
        }
    }
    return `rgb(${LIME_COLOR_STOPS[LIME_COLOR_STOPS.length - 1][1].join(',')})`;
}

// Tooltip text for a lime chip: exact % and application season when known,
// plus a short "needs attention" suffix once it's dropped into warning range.
function buildLimeTitle(ph, status, appliedSeason) {
    if (ph == null) return t('limeTitle');
    const pct = Math.round(ph * 100);
    let title = t('limeTitleActive').replace('{pct}', pct).replace('{season}', appliedSeason);
    if (status === 'warning') title += `, ${t('limeTitleWarning')}`;
    return title;
}

// What a well-limed field's chip means, for the info box and tooltip. The
// "lime again in about n seasons" figure is the app's own model — the same
// per-harvest pH drop for the field's soil that New season applies — so it's
// labelled as an estimate. Crops with consumesLime="false" in the game don't
// lower pH at harvest or cutting, so they get no number at all.
function limeDueText(field, idx, farm, ph) {
    if (field.crop && cropKeepsLime(field.crop)) return t('limeInfoKeeps').replace('{crop}', translateCropName(field.crop));
    const drop = fieldLimePhDrop(getFieldSoilMix(fertPlanSoilKey(field, idx), getSupplyRates()));
    if (ph == null || !(drop > 0)) return '';
    const n = Math.max(1, Math.ceil((ph - 0.75) / drop - 1e-9));
    return t('limeInfoDue').replace('{n}', n).replace('{season}', ((farm && farm.currentSeason) || 1) + n);
}

function limeInfoText(field, idx, farm) {
    const { ph, pf } = getLimeStatus(field, idx, (farm && farm.currentSeason) || 1, getSupplyRates());
    const parts = [t('limeInfoPh').replace('{pct}', ph != null ? Math.round(ph * 100) : 0)];
    if (pf) parts.push(t('limeTitlePf').replace('{ph}', pf.avg.toFixed(2)).replace('{opt}', pf.optimal.toFixed(2)) + '.');
    parts.push(limeDueText(field, idx, farm, ph));
    if (pf && pf.limeL >= 1) parts.push(t('limeTitlePfNeed').replace('{l}', Math.round(pf.limeL).toLocaleString(FIN_LOCALE())) + '.');
    return parts.filter(Boolean).join(' ');
}

// Cycles the lime chip: off -> active (fresh application) -> dismissed (off)
// from either active or warning. Manure/fertilizer keep the simpler generic
// toggle since they don't carry this multi-season state.
window.toggleLimeChip = function (btn) {
    if (btn.classList.contains('is-active') || btn.classList.contains('is-warning')) {
        btn.classList.remove('is-active', 'is-warning');
        // Clear the tracked application season so that turning this back on
        // later is treated as a fresh application, not a resumed old one.
        delete btn.dataset.limeSeason;
        delete btn.dataset.limePh;
        // Visual state lives in the inline --lime-* vars — clear them too, or
        // the chip looks unchanged.
        btn.style.removeProperty('--lime-color');
        btn.style.removeProperty('--lime-pct');
        btn.classList.remove('lime-strong');
        btn.title = t('limeEditTitle');
    } else {
        btn.classList.add('is-active');
        btn.classList.remove('is-warning');
        // Fresh application = ideal pH: show the chip full right away.
        btn.style.setProperty('--lime-color', limeChipColor(LIME_PH_IDEAL));
        btn.style.setProperty('--lime-pct', '100%');
        btn.classList.add('lime-strong');
        btn.title = `${t('limeEditTitle')} (100% pH)`;
    }
};

// Reads which crops were on each field number in the season right before the
// one being viewed (a split field has several), so we can flag "same crop as
// last season". FS25 has no crop-rotation bonus, so a repeat is the only
// thing worth flagging. Returns {} if there's no previous season or its
// archive can't be read — the warning simply doesn't show then.
function getPreviousSeasonCropMap(farm, seasonNum) {
    const map = {};
    if (!farm || !farm.folderName || seasonNum <= 1) return map;

    const archivePath = path.join(appDataDir, farm.folderName, 'seasons', `season_${seasonNum - 1}.json`);
    if (!fs.existsSync(archivePath)) return map;

    try {
        const archiveData = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
        (archiveData.fields || []).forEach(f => {
            const key = (f.number || '').toString().trim();
            if (key && f.crop) (map[key] = map[key] || []).push(f.crop);
        });
    } catch (err) {
        // Unreadable/corrupt archive — just skip the warning, don't crash the table.
    }
    return map;
}

// Fields table order, shared by the read-only table and the edit cards.
// Default is by field number (numeric-aware: 2 < 10, "12-13" after "12");
// the column headers switch it (again = reverse, third click = back to default).
let fieldsSort = { key: 'number', dir: 1 };
try {
    const saved = JSON.parse(getSetting('fieldsSort') || 'null');
    if (saved && ['number', 'ha', 'crop', 'sow', 'state'].includes(saved.key)) fieldsSort = saved;
} catch (e) { /* storage unavailable — keep the default */ }

function compareFieldNumbers(a, b) {
    const na = String(a.number || '').trim(), nb = String(b.number || '').trim();
    if (!na !== !nb) return na ? -1 : 1;   // unnumbered rows last
    return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
}

function sortFieldsForDisplay(fields, currentFarmMonth) {
    const curIdx = ALL_MONTHS.indexOf(currentFarmMonth);
    // Months counted from the current in-game month, so "next up" sorts first.
    const monthRank = f => {
        const i = ALL_MONTHS.indexOf((f.sowingMonth || '').toUpperCase());
        return i < 0 ? 99 : (curIdx < 0 ? i : (i - curIdx + 12) % 12);
    };
    const stateRank = f => {
        if (f.state === 'Planted') return 2;
        return (f.sowingMonth && f.sowingMonth.toUpperCase() === currentFarmMonth) ? 0 : 1;
    };
    const { key, dir } = fieldsSort;
    return [...fields].sort((a, b) => {
        let d = 0;
        if (key === 'ha') d = (parseFloat(a.area) || 0) - (parseFloat(b.area) || 0);
        else if (key === 'crop') {
            if (!a.crop !== !b.crop) return a.crop ? -1 : 1;
            d = compareCropsGameOrder(a.crop || '', b.crop || '');
        }
        else if (key === 'sow') d = monthRank(a) - monthRank(b);
        else if (key === 'state') d = stateRank(a) - stateRank(b);
        else d = compareFieldNumbers(a, b);
        return d * dir || compareFieldNumbers(a, b);
    });
}

function updateFieldsSortHeaders() {
    document.querySelectorAll('#fields-table thead [data-sort]').forEach(th => {
        const active = fieldsSort.key === th.dataset.sort;
        th.setAttribute('aria-sort', active ? (fieldsSort.dir > 0 ? 'ascending' : 'descending') : 'none');
    });
}

document.querySelectorAll('#fields-table thead [data-sort]').forEach(th => {
    th.addEventListener('click', () => {
        if (isEditMode) return;   // don't reshuffle cards mid-edit
        const key = th.dataset.sort;
        const firstDir = key === 'ha' ? -1 : 1;
        if (fieldsSort.key !== key) fieldsSort = { key, dir: firstDir };
        else if (fieldsSort.dir === firstDir) fieldsSort = { key, dir: -firstDir };
        else fieldsSort = { key: 'number', dir: 1 };
        try { setSetting('fieldsSort', JSON.stringify(fieldsSort)); } catch (e) { /* ignore */ }
        renderSeasonView();
    });
});

function catchCropCaption(field) {
    if (!field.catchCrop) return '';
    const month = field.catchSowingMonth ? ` · ${translateMonth(field.catchSowingMonth)}` : '';
    return `<span class="ha-caption catch-crop-caption">+ ${t('catchCropShort')}: ${translateCropName(field.catchCrop)}${month}</span>`;
}

// --- Cuts (Pokosy) for grassland fields ---------------------------------------
// A timeline: sowing month -> cut 1 -> cut 2 -> … -> "add cut". Each cut has a
// month, a use (grass / hay / silage / sale) and done-checks (harvested,
// fertilized, limed, rolled). Saved on every change to field.cuts; the feed
// planner counts each cut into its use's category.
let cutsFieldIdx = null;

function cutsMonthOptions(selected) {
    let html = `<option value="">${t('selectMonth')}</option>`;
    ALL_MONTHS.forEach(m => { html += `<option value="${m}" ${selected === m ? 'selected' : ''}>${translateMonth(m)}</option>`; });
    return html;
}

function renderCutsModal() {
    const farm = getCurrentFarm();
    const field = farm && (farm.fields || [])[cutsFieldIdx];
    const body = document.getElementById('cuts-body');
    if (!field || !body) return;
    const label = [(field.number || '').toString().trim(), translateCropName(field.crop)].filter(Boolean).join(' · ');
    document.getElementById('cuts-title').textContent = t('cutsTitle').replace('{field}', label);
    const area = parseFloat(field.area) || 0;
    const perCut = area * (getCropYieldRate(field.crop) || 0) * fieldYieldFactor(getFieldSoilMix(fertPlanSoilKey(field, cutsFieldIdx), getSupplyRates()));
    const ageN = grasslandSeasonCount(field, loadSeasonHistory(farm, farm.currentSeason || 1), farm.currentSeason || 1);
    document.getElementById('cuts-intro').textContent = (perCut > 0
        ? t('cutsIntro').replace('{l}', Math.round(perCut).toLocaleString(FIN_LOCALE()))
        : t('cutsIntroNoYield')) + ' ' + t('cutsGrassAge').replace('{n}', ageN).replace('{max}', grasslandSeasonLimit(farm));

    const cuts = Array.isArray(field.cuts) ? field.cuts : [];
    const checks = [['harvested', 'cutHarvested'], ['fertilized', 'cutFertilized'], ['limed', 'cutLimed'], ['rolled', 'cutRolled']]
        .filter(([key]) => key !== 'rolled' || cropNeedsRolling(field.crop));
    let html = '';
    cuts.forEach((c, i) => {
        html += `${i ? '<span class="cuts-link" aria-hidden="true"></span>' : ''}
        <div class="cuts-node${c.harvested ? ' is-done' : ''}">
            <span class="cuts-node-label">${t('cutsCutN').replace('{n}', i + 1)}</span>
            <button type="button" class="cuts-remove" data-cut="${i}" title="${t('cutsRemove')}" aria-label="${t('cutsRemove')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            <select class="feed-input cuts-month" data-cut="${i}">${cutsMonthOptions(c.month)}</select>
            <select class="feed-input cuts-use" data-cut="${i}">${CUT_USES.map(u => `<option value="${u}" ${c.use === u ? 'selected' : ''}>${t('cutUse_' + u)}</option>`).join('')}</select>
            <div class="cuts-checks">${checks.map(([k, lbl]) => `<label><input type="checkbox" class="cuts-check" data-cut="${i}" data-key="${k}" ${c[k] ? 'checked' : ''}> ${t(lbl)}</label>`).join('')}</div>
        </div>`;
    });
    html += `${cuts.length ? '<span class="cuts-link" aria-hidden="true"></span>' : ''}
        <button type="button" class="cuts-add"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${t('cutsAdd')}</button>`;
    body.innerHTML = html;
    const add = body.querySelector('.cuts-add');
    if (add) add.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateCutsField(fn) {
    const allFarms = getAllFarms();
    const farm = allFarms.find(f => f.id === currentFarmId);
    const field = farm && (farm.fields || [])[cutsFieldIdx];
    if (!field) return;
    if (!Array.isArray(field.cuts)) field.cuts = [];
    fn(field);
    saveFarmData(farm);
    renderCutsModal();
}

window.openCutsModal = function (idx) {
    cutsFieldIdx = idx;
    renderCutsModal();
    openModal(document.getElementById('cuts-modal'));
};

(function wireCutsModal() {
    const modal = document.getElementById('cuts-modal');
    const body = document.getElementById('cuts-body');
    if (!modal || !body) return;
    const close = () => { closeModal(modal); cutsFieldIdx = null; renderSeasonView(); };
    document.getElementById('cuts-close').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.style.display === 'flex') close(); });
    body.addEventListener('change', e => {
        const el = e.target;
        const i = el.dataset.cut;
        if (el.classList.contains('cuts-month')) {
            updateCutsField(f => { f.cuts[+i].month = el.value; });
        } else if (el.classList.contains('cuts-use')) {
            updateCutsField(f => { f.cuts[+i].use = el.value; });
        } else if (el.classList.contains('cuts-check')) {
            updateCutsField(f => {
                f.cuts[+i][el.dataset.key] = el.checked;
                // Linked to the field: limed = fresh liming (pH 100%), rolled = rolling chip on.
                if (el.dataset.key === 'limed' && el.checked) applyLiming(f, (getCurrentFarm() || {}).currentSeason || 1);
                if (el.dataset.key === 'rolled') { f.rolling = f.cuts.some(c => c.rolled); f.rollingDone = f.rolling; }
            });
        }
    });
    body.addEventListener('click', e => {
        if (e.target.closest('.cuts-add')) {
            updateCutsField(f => {
                const last = f.cuts[f.cuts.length - 1];
                const from = last ? last.month : (f.sowingMonth || '').toUpperCase();
                const idx = ALL_MONTHS.indexOf(from);
                const month = idx >= 0 ? ALL_MONTHS[(idx + 1) % 12] : '';
                f.cuts.push({ month, use: last ? last.use : 'hay', harvested: false, fertilized: false, limed: false, rolled: false });
                // Grass you cut is in the ground — no seed needed for it any more.
                f.state = 'Planted';
            });
        }
        const rm = e.target.closest('.cuts-remove');
        if (rm) updateCutsField(f => { f.cuts.splice(+rm.dataset.cut, 1); });
    });
})();

// State column: grassland gets a "Cuts" button (done / planned) that opens
// the cuts timeline; everything else the sown / not sown badge (a toggle in
// the current season).
// Grassland age is shown under the crop name (grassAgeCaption), not here, so
// the state column stays narrow.
function stateCellHtml(field, idx, isPastSeason, stateDisplay) {
    if (isCutCrop(field.crop)) {
        const cuts = Array.isArray(field.cuts) ? field.cuts : [];
        const done = cuts.filter(c => c.harvested).length;
        const text = cuts.length ? t('cutsBadge').replace('{done}', done).replace('{n}', cuts.length) : t('cutsBadgeEmpty');
        const cls = `badge badge--cuts${cuts.length && done === cuts.length ? ' is-complete' : ''}`;
        const title = t('cutsOpenHint');
        return isPastSeason
            ? `<span class="${cls}" title="${title}"><i class="fa-solid fa-scissors" aria-hidden="true"></i> ${text}</span>`
            : `<button type="button" class="cuts-open" data-idx="${idx}" title="${title}"><span class="${cls}"><i class="fa-solid fa-scissors" aria-hidden="true"></i> ${text}</span></button>`;
    }
    return isPastSeason ? stateDisplay : `<button type="button" class="state-toggle" data-idx="${idx}" title="${t('stateToggleHint')}">${stateDisplay}</button>`;
}

// --- Field view ("Pole") -----------------------------------------------------
// Everything about one field in one place: soil mix (editable), pH and lime,
// nitrogen and the fertilization plan, feed use, cuts, work, and what grew
// there in past seasons. Opened from the field number in the table.
let fieldModalIdx = null;

// FS25_MoistureSystem: today's moisture for the main and catch crop, and the
// yield factor when one is harvested this month (see fieldMoistureInfo).
function fieldMoistureLineHtml(field, farm) {
    return [[field.crop, field.sowingMonth], [field.catchCrop, field.catchSowingMonth]].map(([crop, sow]) => {
        const m = crop ? fieldMoistureInfo(field, crop, sow, farm) : null;
        return m ? `<p class="settings-hint field-view-moisture">${t('yieldForecastColMoisture')} · ${escapeHtml(translateCropName(crop))}: ${moistureCellHtml(m.moisture, m.def, m.factor, m.now)}</p>` : '';
    }).join('');
}

function renderFieldModal() {
    const farm = getCurrentFarm();
    const field = farm && (farm.fields || [])[fieldModalIdx];
    const body = document.getElementById('field-modal-body');
    if (!field || !body) return;
    const idx = fieldModalIdx;
    const rates = getSupplyRates();
    const num = (field.number || '').toString().trim();
    const soilKey = fertPlanSoilKey(field, idx);
    const planKey = fertPlanKey(field, idx);
    const area = parseFloat(field.area) || 0;
    const season = farm.currentSeason || 1;
    const fmt = (v, d = 0) => Number(v).toLocaleString(FIN_LOCALE(), { maximumFractionDigits: d });

    const name = fieldNameOf(farm, num);
    document.getElementById('field-modal-title').textContent = t('fieldViewTitle').replace('{field}', num || '–')
        + (name ? ' · ' + name : '')
        + (field.crop ? ' · ' + translateCropName(field.crop) : '');
    const summary = [
        `${area.toFixed(2)} ha${field.areaSource === 'game' ? ' (' + t('fieldViewFromGame') + ')' : ''}`,
        field.catchCrop ? t('catchCropShort') + ': ' + translateCropName(field.catchCrop) : '',
        field.sowingMonth ? t('thSowingMth') + ': ' + translateMonth(field.sowingMonth) : '',
        field.state === 'Planted' ? t('planted') : t('toPlant'),
        field.tillage === 'plowed' ? t('tillagePlowed') : (field.tillage === 'noTill' ? t('tillageNoTill') : ''),
        field.lease ? t('leaseLabel') : ''
    ].filter(Boolean).join(' · ');
    document.getElementById('field-modal-summary').textContent = summary;

    let html = '';
    const section = (title, inner) => `<section class="settings-group field-view-section"><h4>${title}</h4>${inner}</section>`;

    // Crop, catch crop and sowing months — editable here, so changing a crop
    // doesn't need the whole table in Edit mode.
    const sel = (cls, label, options, hint) => `<label class="settings-field"><span${hint ? ` title="${escapeHtml(hint)}"` : ''}>${label}</span><select class="${cls}">${options}</select></label>`;
    html += section(t('fieldViewCrop'), `<div class="field-view-crop-grid">
        ${num ? `<label class="settings-field field-view-name-field"><span>${t('fieldName')}</span><input type="text" class="field-view-name" maxlength="40" value="${escapeHtml(name)}" placeholder="${escapeHtml(t('fieldNamePlaceholder'))}" title="${escapeHtml(t('fieldNameHint'))}"></label>` : ''}
        ${sel('field-view-crop', t('thCrop'), cropOptionsHtml(field.crop, t('selectPlaceholder')))}
        ${sel('field-view-sow', t('thSowingMth'), field.crop ? generateMonthOptionsHtml(field.crop, field.sowingMonth) : `<option value="">${t('selectCropFirst')}</option>`)}
        ${sel('field-view-catch', t('thCatchCrop'), cropOptionsHtml(field.catchCrop, t('catchCropNone'), true), t('catchCropHint'))}
        ${field.catchCrop ? sel('field-view-catch-sow', t('thCatchSowingMth'), generateMonthOptionsHtml(field.catchCrop, field.catchSowingMonth)) : ''}
    </div><p class="settings-hint">${t('fieldViewCropHint')}</p>${fieldMoistureLineHtml(field, farm)}`);

    // Crop rotation: cycle, this season's step, the next seasons.
    html += section(t('rotTitle'), rotationFieldViewHtml(farm, field));

    // Soil (editable — same data as the Field soil type view).
    const mix = (rates.fieldSoil && rates.fieldSoil[soilKey]) || {};
    html += section(t('fieldViewSoil'), `<div class="field-soil-grid">${soilTypeList().map(s => `<label class="settings-field">
            <span>${escapeHtml(soilLabel(s.id))}</span>
            <input type="number" min="0" max="100" step="1" class="field-view-soil" data-soil="${s.id}" value="${mix[s.id] != null ? mix[s.id] : ''}" placeholder="0">
        </label>`).join('')}</div>${soilMixBarHtml(soilKey)}<p class="settings-hint">${t('fieldViewSoilHint')}</p>`);

    // pH and lime.
    const lime = getLimeStatus(field, idx, season, rates);
    let limeText;
    if (lime.pf) {
        limeText = t('limeTitlePf').replace('{ph}', lime.pf.avg.toFixed(2)).replace('{opt}', lime.pf.optimal.toFixed(2))
            + (lime.pf.limeL >= 1 ? ' · ' + t('limeTitlePfNeed').replace('{l}', fmt(lime.pf.limeL)) : '');
    } else if (lime.ph != null) {
        limeText = buildLimeTitle(lime.ph, lime.status, field.limeAppliedSeason);
    } else {
        limeText = t('fieldViewNoLime');
    }
    html += section(t('fieldViewLime'), `<p>${escapeHtml(limeText)}</p>`);

    // Notes pinned to this field (added and edited in Notes).
    if (num) {
        const fieldNotes = loadNotes(farm).filter(n => noteHasField(n, num));
        html += section(t('fieldViewNotes'), fieldNotes.length
            ? `<ul class="field-view-notes">${fieldNotes.map(n => `<li><strong>${escapeHtml(n.title)}</strong>${(n.months || []).length ? ` <span class="settings-hint">${n.months.map(translateMonth).join(', ')}</span>` : ''}</li>`).join('')}</ul>`
            : `<p class="settings-hint">${t('fieldViewNotesNone')}</p>`);
    }

    // Nitrogen: a simple fertilization plan (the full one stays in Supplies).
    if (field.crop && area > 0) {
        const d = computeFieldFertPlan(planKey, soilKey, field.crop, area, rates);
        const kgN = t('suppliesNRateUnit');
        const status = d.covered
            ? `<span class="fertplan-status is-covered">${t('fertPlanCovered')}</span>`
            : `${fmt(d.mineralRate)} ${kgN} · ${fmt(d.mineralLitres * area * d.buffer)} l`;
        html += section(t('fieldViewFert'), `
            <p class="details-category field-view-fert-target"><span>${t('fertPlanColTarget')}</span><span class="details-category-value">${fmt(d.targetRate)} ${kgN}</span></p>
            <label class="fertplan-field">
                <span>${t('fertPlanColExisting')}</span>
                <span class="fertplan-input-wrap"><input type="number" min="0" step="5" class="field-view-fert" data-key="existingN" value="${d.existingRate > 0 && !d.existingFromGame ? d.existingRate : ''}" placeholder="${d.existingFromGame ? d.existingRate : 0}"><span class="supply-unit">${kgN}</span></span>
                ${d.existingFromGame ? `<small class="fertplan-from-game">${t('fertPlanExistingFromGame')}</small>` : ''}
            </label>
            <label class="fertplan-field">
                <span>${t('fertPlanColOrg')}</span>
                <span class="fertplan-input-wrap"><input type="number" min="0" step="5" class="field-view-fert" data-key="orgN" value="${d.orgRate > 0 ? d.orgRate : ''}" placeholder="0"><span class="supply-unit">${kgN}</span></span>
            </label>
            <p class="details-category field-view-fert-result"><span>${t('fertPlanColMineralN')}</span><span class="details-category-value">${status}</span></p>
            <label class="fertplan-field fertplan-checkbox-field">
                <span>${t('fertPlanManureApplied')}</span>
                <input type="checkbox" class="field-view-fert-done" data-prop="manure" ${field.manure ? 'checked' : ''}>
            </label>
            <label class="fertplan-field fertplan-checkbox-field">
                <span>${t('fertPlanFertilizerApplied')}</span>
                <input type="checkbox" class="field-view-fert-done" data-prop="fertilizer" ${field.fertilizer ? 'checked' : ''}>
            </label>`);
    }

    // Feed use (same choices as the Feed planner).
    const plan = getFeedPlan(farm);
    const feedRows = buildFeedSupply(farm, plan, rates).rows.filter(r => r.key === planKey || r.key === planKey + ':catch');
    if (feedRows.length) {
        html += section(t('fieldViewFeed'), feedRows.map(r => {
            const label = translateCropName(r.crop) + (r.isCatch ? ' (' + t('catchCropShort') + ')' : '');
            if (r.use === 'cuts') return `<p>${escapeHtml(label)}: ${t('feedUseCuts').replace('{n}', r.cuts)}</p>`;
            const opts = ['sale', ...r.uses].map(u => `<option value="${u}" ${r.use === u ? 'selected' : ''}>${t('feedUse_' + u)}</option>`).join('');
            return `<label class="settings-field"><span>${escapeHtml(label)}</span><select class="field-view-use" data-key="${escapeHtml(r.key)}">${opts}</select></label>`;
        }).join(''));
    }

    // Cuts / work / treatments.
    const work = [];
    if (isCutCrop(field.crop)) {
        const cuts = Array.isArray(field.cuts) ? field.cuts : [];
        work.push(`<p>${cuts.length ? t('cutsBadge').replace('{done}', cuts.filter(c => c.harvested).length).replace('{n}', cuts.length) : t('cutsBadgeEmpty')}</p>
            <button type="button" class="settings-btn field-view-cuts">${t('cutsOpenHint')}</button>`);
    } else if (field.crop) {
        const { next, done, total } = nextWorkStep(field, idx, farm);
        work.push(`<p>${next ? t('fieldViewNextJob').replace('{job}', t('work_' + next.step)) + (done ? ` (${done}/${total})` : '') : t(total ? 'workAllDone' : 'workEmpty')}</p>
            <button type="button" class="settings-btn field-view-work">${t('workOpenHint')}</button>`);
    }
    const state = (v, map) => t(map[v] || map['']);
    const rollingLine = cropNeedsRolling(field.crop) ? ' · ' + t(field.rolling ? (field.rollingDone ? 'rollingDone' : 'rollingPlanned') : 'rollingOff') : '';
    work.push(`<p class="settings-hint">${state(field.weeds || '', WEEDS_TITLES)}${rollingLine}</p>`);
    html += section(t('fieldViewWork'), work.join(''));

    // History of this field number.
    const history = loadSeasonHistory(farm, season);
    const past = Object.keys(history).map(Number).sort((a, b) => b - a).map(s => {
        const crops = (history[s] || []).filter(f => (f.number || '').toString().trim() === num && f.crop).map(f => translateCropName(f.crop));
        return crops.length ? `<li>${t('season')} ${s}: ${escapeHtml(crops.join(', '))}</li>` : '';
    }).filter(Boolean);
    html += section(t('fieldViewHistory'), past.length ? `<ul class="field-view-history">${past.join('')}</ul>` : `<p class="settings-hint">${t('fieldViewNoHistory')}</p>`);

    body.innerHTML = html;
}

window.openFieldModal = function (idx) {
    markFieldViewKnown();
    fieldModalIdx = idx;
    renderFieldModal();
    const modal = document.getElementById('field-modal');
    if (modal) {
        openModal(modal);
        const content = modal.querySelector('.modal-content');
        if (content) content.scrollTop = 0;
    }
};

(function wireFieldModal() {
    const modal = document.getElementById('field-modal');
    const body = document.getElementById('field-modal-body');
    if (!modal || !body) return;
    const close = () => { closeModal(modal); fieldModalIdx = null; renderSeasonView(); };
    document.getElementById('field-modal-close').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.style.display === 'flex') close(); });
    body.addEventListener('change', e => {
        const el = e.target;
        const farm = getCurrentFarm();
        const field = farm && (farm.fields || [])[fieldModalIdx];
        if (!field) return;
        if (handleRotationFieldViewChange(el, farm, field)) {
            saveFarmData(farm);
            rerenderKeepingFocus(renderFieldModal, modal.querySelector('.modal-content'));
        } else if (el.classList.contains('field-view-name')) {
            setFieldName(farm, field.number, el.value);
            saveFarmData(farm);
            rerenderKeepingFocus(renderFieldModal, modal.querySelector('.modal-content'));
        } else if (el.matches('.field-view-crop, .field-view-sow, .field-view-catch, .field-view-catch-sow')) {
            const before = JSON.parse(JSON.stringify(farm.fields));
            if (el.classList.contains('field-view-crop')) {
                field.crop = el.value;
                field.sowingMonth = '';
            } else if (el.classList.contains('field-view-sow')) {
                field.sowingMonth = el.value;
            } else if (el.classList.contains('field-view-catch')) {
                field.catchCrop = el.value;
                field.catchSowingMonth = '';
            } else {
                field.catchSowingMonth = el.value;
            }
            // Fertilization plan, feed use and straw are keyed by number + crop.
            migrateFieldKeys(farm, before, farm.fields);
            saveFarmData(farm);
            rerenderKeepingFocus(renderFieldModal, modal.querySelector('.modal-content'));
        } else if (el.classList.contains('field-view-soil')) {
            const r = getSupplyRates();
            const k = fertPlanSoilKey(field, fieldModalIdx);
            if (!r.fieldSoil) r.fieldSoil = {};
            if (!r.fieldSoil[k]) r.fieldSoil[k] = {};
            const n = parseFloat(el.value);
            if (el.value === '' || isNaN(n) || n <= 0) delete r.fieldSoil[k][el.dataset.soil];
            else r.fieldSoil[k][el.dataset.soil] = n;
            if (Object.keys(r.fieldSoil[k]).length === 0) delete r.fieldSoil[k];
            saveSupplyRates(r);
            rerenderKeepingFocus(renderFieldModal, modal.querySelector('.modal-content'));
        } else if (el.classList.contains('field-view-fert')) {
            setFertPlanValue(fertPlanKey(field, fieldModalIdx), el.dataset.key, el.value);
            rerenderKeepingFocus(renderFieldModal, modal.querySelector('.modal-content'));
        } else if (el.classList.contains('field-view-fert-done')) {
            field[el.dataset.prop] = el.checked;
            saveFarmData(farm);
            rerenderKeepingFocus(renderFieldModal, modal.querySelector('.modal-content'));
        } else if (el.classList.contains('field-view-use')) {
            const plan = getFeedPlan(farm);
            plan.fieldUse[el.dataset.key] = el.value;
            saveFeedPlan(plan);
            renderFieldModal();
        }
    });
    body.addEventListener('click', e => {
        const farm = getCurrentFarm();
        const idx = fieldModalIdx;
        const field = farm && (farm.fields || [])[idx];
        if (!field) return;
        if (handleRotationFieldViewClick(e.target, farm, field)) {
            saveFarmData(farm);
            rerenderKeepingFocus(renderFieldModal, modal.querySelector('.modal-content'));
            return;
        }
        if (e.target.closest('.field-view-cuts')) {
            close();
            openCutsModal(idx);
        } else if (e.target.closest('.field-view-work')) {
            close();
            openWorkModal(idx);
        }
    });
})();

// --- Field work queue ("Prace") ----------------------------------------------
// field.work = [{ step, done }] in the order you do them — catch crop and main
// crop in one list (e.g. green rye: fertilize, mow, bale, wrap; then beet:
// cultivate, sow, fertilize, weeds). The button next to the state shows the
// next step. Without a list of your own it suggests one from the sowing month:
// before it -> cultivate / lime, in it -> cultivate / sow / roll, after -> fertilize / weeds.
// Lime only while the pH needs it (the game's pH with Precision Farming) and
// the crop uses lime up; no weeds step on a ploughed field.
const WORK_STEPS = ['merge', 'fertilize', 'manure', 'lime', 'mow', 'bale', 'harvestWrap', 'harvest', 'cultivate', 'plow', 'sow', 'roll', 'weeds'];

// A row joining several game fields ("10-11") has to be worked as one first:
// the strip between them cultivated or ploughed over. Once ticked off it's
// remembered per field number (farm.mergedFields), so it isn't suggested again.
function needsMerging(field, farm) {
    const parts = String(field.number || '').split(/[^0-9]+/).filter(Boolean);
    const key = String(field.number || '').trim();
    return parts.length > 1 && !(farm && farm.mergedFields && farm.mergedFields[key]);
}

// A catch crop comes before the main crop (green rye before beet) when it's
// sown before the main crop's harvest, counting from the main sowing month;
// sown at or after that harvest (a rotation's catch crop) it comes after.
// Without a calendar or months to compare, before — as it always was.
function catchCropComesFirst(field) {
    const sow = (field.sowingMonth || '').toUpperCase();
    const catchSow = (field.catchSowingMonth || '').toUpperCase();
    const harvest = String((CROP_CALENDAR[field.crop] || {})[sow] || '').toUpperCase();
    const from = ALL_MONTHS.indexOf(sow);
    if (from < 0 || ALL_MONTHS.indexOf(catchSow) < 0 || ALL_MONTHS.indexOf(harvest) < 0) return true;
    const offset = m => (ALL_MONTHS.indexOf(m) - from + 12) % 12;
    if (!offset(harvest)) return true;
    return offset(catchSow) < offset(harvest);
}

// idx: the field's index in farm.fields (for its soil mix, see getLimeStatus).
function suggestedWork(field, idx, farm) {
    const steps = [];
    const catchSteps = ['fertilize', 'mow', 'bale', 'harvestWrap'];
    const catchFirst = field.catchCrop && catchCropComesFirst(field);
    if (catchFirst) steps.push(...catchSteps);
    const sow = ALL_MONTHS.indexOf((field.sowingMonth || '').toUpperCase());
    const cur = ALL_MONTHS.indexOf(((farm && farm.month) || '').toUpperCase());
    // Months until the sowing month (0 = this month), wrapping round the year.
    const until = sow >= 0 && cur >= 0 ? (sow - cur + 12) % 12 : 0;
    const sown = field.state === 'Planted';
    const plowed = field.tillage === 'plowed';
    if (!sown) {
        if (needsMerging(field, farm)) steps.push('merge');
        steps.push(plowed ? 'plow' : 'cultivate');
        if (until > 0 && !cropKeepsLime(field.crop)
            && getLimeStatus(field, idx, (farm && farm.currentSeason) || 1, getSupplyRates()).status !== 'active') steps.push('lime');
        steps.push('sow');
        if (field.rolling && cropNeedsRolling(field.crop)) steps.push('roll');
    }
    steps.push('fertilize');
    if (!plowed) steps.push('weeds');
    if (field.catchCrop && !catchFirst) steps.push(...catchSteps);
    return steps.map(step => ({ step, done: false }));
}

// The field's own list, or null when it never had one (then the month-based
// suggestion shows). A list you emptied stays empty (field.workCleared) — an
// empty field.work without the flag is how older versions cleared it.
function fieldWork(field) {
    if (!Array.isArray(field.work)) return null;
    return field.work.length || field.workCleared ? field.work : null;
}

// Next step for the table button: your list, else the month-based suggestion.
// The field's state is the one truth for sowing: a Sow step is done exactly
// when the field is sown (the state badge and the checklist can't disagree).
function withSowFromState(field, list) {
    return list.map(w => w.step === 'sow' ? { ...w, done: field.state === 'Planted' } : w);
}

// Writes the state into the field's own list (after the state changed elsewhere).
function syncSowStep(field) {
    const own = fieldWork(field);
    if (own) field.work = withSowFromState(field, own);
}

function nextWorkStep(field, idx, farm) {
    const list = withSowFromState(field, fieldWork(field) || suggestedWork(field, idx, farm));
    const next = list.find(w => !w.done);
    return { next, done: list.filter(w => w.done).length, total: list.length, own: !!fieldWork(field) };
}

function workCellHtml(field, idx, isPastSeason, farm) {
    if (isPastSeason || !field.crop || isCutCrop(field.crop)) return '';
    const { next, done, total, own } = nextWorkStep(field, idx, farm);
    const label = next ? t('work_' + next.step) : t(total ? 'workAllDone' : 'workEmpty');
    const count = own && done ? ` <span class="work-count">${done}/${total}</span>` : '';
    return `<button type="button" class="work-open${next ? '' : ' is-complete'}" data-idx="${idx}" title="${t(own ? 'workOpenHint' : 'workSuggestedHint')}">→ ${escapeHtml(label)}${count}</button>`;
}

let workFieldIdx = null;

function renderWorkModal() {
    const farm = getCurrentFarm();
    const field = farm && (farm.fields || [])[workFieldIdx];
    if (!field) return;
    const label = [(field.number || '').toString().trim(), translateCropName(field.crop), field.catchCrop ? '+ ' + translateCropName(field.catchCrop) : ''].filter(Boolean).join(' · ');
    document.getElementById('work-title').textContent = t('workTitle').replace('{field}', label);
    const own = fieldWork(field);
    document.getElementById('work-intro').textContent = t(own ? 'workIntro' : 'workIntroSuggested');
    const list = withSowFromState(field, own || suggestedWork(field, workFieldIdx, farm));
    const listEl = document.getElementById('work-list');
    listEl.innerHTML = list.length ? '' : `<li class="work-item work-item--empty">${escapeHtml(t('workListEmpty'))}</li>`;
    listEl.innerHTML += list.map((w, i) => `<li class="work-item${w.done ? ' is-done' : ''}">
        <label><input type="checkbox" class="work-check" data-i="${i}" ${w.done ? 'checked' : ''}> ${escapeHtml(t('work_' + w.step))}</label>
        <span class="work-item-btns">
            <button type="button" class="work-move" data-i="${i}" data-dir="-1" ${i ? '' : 'disabled'} aria-label="${t('workUp')}"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
            <button type="button" class="work-move" data-i="${i}" data-dir="1" ${i < list.length - 1 ? '' : 'disabled'} aria-label="${t('workDown')}"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>
            <button type="button" class="work-remove" data-i="${i}" aria-label="${t('workRemove')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </span></li>`).join('');
    document.getElementById('work-add-select').innerHTML = WORK_STEPS.filter(s => s !== 'roll' || cropNeedsRolling(field.crop)).map(s => `<option value="${s}">${t('work_' + s)}</option>`).join('');
}

// Any change turns the shown list (suggested or own) into the field's own list.
// One field's list, without saving (the work modal and the bulk bar save after).
function changeFieldWork(farm, field, idx, fn) {
    field.work = withSowFromState(field, fieldWork(field) || suggestedWork(field, idx, farm));
    fn(field.work, field, farm);
    syncSowStep(field);
    // Emptied on purpose: keep it empty instead of suggesting again.
    if (field.work.length) delete field.workCleared;
    else field.workCleared = true;
}

// Ticks a step on or off, with what that step means for the field itself.
function setWorkStepDone(work, i, done, field, farm) {
    work[i].done = done;
    // Sowing done = the field is sown.
    if (work[i].step === 'sow') field.state = done ? 'Planted' : 'To Plant';
    if (work[i].step === 'weeds' && done) {
        field.weeds = 'done';
        markWeedsManual(farm, field);
    }
    if (work[i].step === 'roll') { if (done) field.rolling = true; field.rollingDone = done; }
    if (work[i].step === 'merge') {
        const key = String(field.number || '').trim();
        farm.mergedFields = { ...(farm.mergedFields || {}) };
        if (done) farm.mergedFields[key] = true;
        else delete farm.mergedFields[key];
    }
}

function updateWorkField(fn) {
    const allFarms = getAllFarms();
    const farm = allFarms.find(f => f.id === currentFarmId);
    const field = farm && (farm.fields || [])[workFieldIdx];
    if (!field) return;
    changeFieldWork(farm, field, workFieldIdx, fn);
    saveFarmData(farm);
    renderWorkModal();
}

window.openWorkModal = function (idx) {
    workFieldIdx = idx;
    renderWorkModal();
    openModal(document.getElementById('work-modal'));
};

(function wireWorkModal() {
    const modal = document.getElementById('work-modal');
    const listEl = document.getElementById('work-list');
    if (!modal || !listEl) return;
    const close = () => { closeModal(modal); workFieldIdx = null; renderSeasonView(); };
    document.getElementById('work-close').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.style.display === 'flex') close(); });
    listEl.addEventListener('change', e => {
        if (!e.target.classList.contains('work-check')) return;
        const i = +e.target.dataset.i;
        updateWorkField((work, field, farm) => setWorkStepDone(work, i, e.target.checked, field, farm));
    });
    listEl.addEventListener('click', e => {
        const mv = e.target.closest('.work-move');
        if (mv) {
            const i = +mv.dataset.i, j = i + (+mv.dataset.dir);
            updateWorkField(work => { [work[i], work[j]] = [work[j], work[i]]; });
            return;
        }
        const rm = e.target.closest('.work-remove');
        if (rm) updateWorkField(work => { work.splice(+rm.dataset.i, 1); });
    });
    document.getElementById('work-add-btn').addEventListener('click', () => {
        const step = document.getElementById('work-add-select').value;
        if (step) updateWorkField(work => { work.push({ step, done: false }); });
    });
    document.getElementById('work-suggest-btn').addEventListener('click', () => {
        updateWorkField((work, field, farm) => { work.splice(0, work.length, ...suggestedWork(field, workFieldIdx, farm)); });
    });
})();

// --- Several fields at once (Edit mode) ------------------------------------
// A checkbox on every card and a bar that only fills the selected cards'
// inputs, so Save / Cancel / backups work as for typing. Shift+click on a card
// selects it, Ctrl+click deselects it. The selection is UI-only.
function bulkBarEl() { return document.getElementById('bulk-bar'); }

// The table outside Edit has no selection: just keep the bar hidden.
function renderBulkBar() {
    const bar = bulkBarEl();
    if (!bar) return;
    bar.hidden = true;
    bar.innerHTML = '';
}

function setCardSelected(row, on) {
    const box = row && row.querySelector('.edit-bulk-check');
    if (!box || row.classList.contains('is-bulk-selected') === on) { if (box) box.checked = on; return; }
    box.checked = on;
    row.classList.toggle('is-bulk-selected', on);
    // Replays the pop / release animation on every change.
    row.classList.remove('is-bulk-anim-on', 'is-bulk-anim-off');
    void row.offsetWidth;
    row.classList.add(on ? 'is-bulk-anim-on' : 'is-bulk-anim-off');
}

// What a selected card passes on to the other selected ones. Number, area
// and name stay per field.
const MIRRORED_INPUTS = ['field-crop', 'field-sow', 'field-catch-crop', 'field-catch-sow',
    'field-state', 'field-lease', 'field-lease-seasons', 'field-lease-then'];

function selectedEditRows(except) {
    return fieldsBody ? [...fieldsBody.querySelectorAll('tr.field-edit-tr.is-bulk-selected')].filter(r => r !== except) : [];
}

function flashMirrored(row) {
    row.classList.remove('is-bulk-mirror');
    void row.offsetWidth;
    row.classList.add('is-bulk-mirror');
}

// A select only takes a value it offers (a month another crop can't be sown in stays as it was).
function setSelectValue(sel, value) {
    if ([...sel.options].some(o => o.value === value)) sel.value = value;
}

function mirrorToSelected(el) {
    const src = el.closest('tr.field-edit-tr');
    if (!isEditMode || !src || !src.classList.contains('is-bulk-selected')) return;
    const cls = MIRRORED_INPUTS.find(c => el.classList.contains(c));
    if (!cls) return;
    selectedEditRows(src).forEach(row => {
        const target = row.querySelector('.' + cls);
        if (!target) return;
        if (cls === 'field-crop' || cls === 'field-catch-crop') {
            target.value = el.value;
            const month = cls === 'field-crop' ? '.field-sow' : '.field-catch-sow';
            row.querySelector(month).innerHTML = generateMonthOptionsHtml(el.value, src.querySelector(month).value || null);
        } else if (el.type === 'checkbox') {
            target.checked = el.checked;
        } else if (target.tagName === 'SELECT') {
            setSelectValue(target, el.value);
        } else {
            target.value = el.value;
        }
        syncCardOptionalCells(row, true);
        flashMirrored(row);
    });
}

if (fieldsBody) fieldsBody.addEventListener('input', e => {
    if (e.target.matches('input.field-lease-seasons')) mirrorToSelected(e.target);
});

if (fieldsBody) fieldsBody.addEventListener('change', e => {
    const box = e.target.closest('.edit-bulk-check');
    if (!box) { mirrorToSelected(e.target); return; }
    const row = box.closest('tr');
    const on = box.checked;
    row.classList.toggle('is-bulk-selected', !on);   // let setCardSelected see a change
    setCardSelected(row, on);
    updateEditBulkCount();
});

// Shift+click selects, Ctrl+click deselects — on the checkbox or anywhere on
// the card that isn't a field to type in or a button.
if (fieldsBody) fieldsBody.addEventListener('click', e => {
    if (!isEditMode || !(e.shiftKey || e.ctrlKey || e.metaKey)) return;
    const row = e.target.closest('tr.field-edit-tr');
    if (!row) return;
    const onBox = !!e.target.closest('.field-card-select');
    if (!onBox && e.target.closest('input, select, textarea, button, a, .tillage-switch-option')) return;
    if (onBox && e.target.tagName !== 'INPUT') e.preventDefault();   // the label would toggle again
    const want = !!e.shiftKey && !(e.ctrlKey || e.metaKey);
    row.classList.toggle('is-bulk-selected', !want);
    setCardSelected(row, want);
    updateEditBulkCount();
}, true);

// Shift+click would also select the text between two clicks.
if (fieldsBody) fieldsBody.addEventListener('mousedown', e => {
    if (isEditMode && e.shiftKey && e.target.closest('tr.field-edit-tr')
        && !e.target.closest('input, select, textarea')) e.preventDefault();
});

(function wireBulkBar() {
    const bar = bulkBarEl();
    if (!bar) return;
    bar.addEventListener('change', e => {
        if (e.target.id === 'edit-bulk-all') {
            fieldsBody.querySelectorAll('tr.field-edit-tr').forEach(row => setCardSelected(row, e.target.checked));
            updateEditBulkCount();
        } else if (e.target.id === 'eb-crop') {
            bar.querySelector('#eb-sow').innerHTML = generateMonthOptionsHtml(e.target.value, null);
        } else if (e.target.id === 'eb-catch') {
            bar.querySelector('#eb-catch-sow').innerHTML = generateMonthOptionsHtml(e.target.value, null);
        }
    });
    bar.addEventListener('click', e => {
        const btn = e.target.closest('[data-ebulk]');
        if (btn) applyEditBulk(btn.dataset.ebulk, bar);
    });
})();

// Edit mode: the bar is rebuilt with the cards; ticking cards only updates its count.
function renderEditBulkBar() {
    const bar = bulkBarEl();
    if (!bar) return;
    bar.hidden = false;
    bar.innerHTML = `<label class="bulk-select-all"><input type="checkbox" id="edit-bulk-all" class="fp-check"> ${t('bulkSelectAll')}</label>
        <span class="bulk-count"></span>
        <span class="bulk-hint">${t('bulkKeysHint')}</span>
        <span class="bulk-controls">
            <span class="bulk-group">
                <select id="eb-crop" aria-label="${t('thCrop')}">${cropOptionsHtml('', t('thCrop'))}</select>
                <select id="eb-sow" aria-label="${t('thSowingMth')}"><option value="">${t('selectCropFirst')}</option></select>
                <button type="button" class="btn btn--sm btn--secondary" data-ebulk="crop">${t('bulkSetCrop')}</button>
            </span>
            <span class="bulk-group">
                <select id="eb-catch" aria-label="${t('thCatchCrop')}">${cropOptionsHtml('', t('catchCropNone'), true)}</select>
                <select id="eb-catch-sow" aria-label="${t('thCatchSowingMth')}">${generateMonthOptionsHtml('', null)}</select>
                <button type="button" class="btn btn--sm btn--secondary" data-ebulk="catch">${t('bulkSetCatch')}</button>
            </span>
            <span class="bulk-group">
                <button type="button" class="btn btn--sm btn--secondary" data-ebulk="sown">${t('planted')}</button>
                <button type="button" class="btn btn--sm btn--secondary" data-ebulk="unsown">${t('toPlant')}</button>
            </span>
            <span class="bulk-group">
                <button type="button" class="btn btn--sm btn--secondary" data-ebulk="plowed">${t('tillagePlowed')}</button>
                <button type="button" class="btn btn--sm btn--secondary" data-ebulk="noTill">${t('tillageNoTill')}</button>
                <button type="button" class="btn btn--sm" data-ebulk="noTillage" title="${t('bulkNoTillageHint')}">–</button>
            </span>
            <button type="button" class="btn btn--sm btn--danger" data-ebulk="delete">${t('bulkDelete')}</button>
        </span>`;
    updateEditBulkCount();
}

function editBulkRows() {
    return fieldsBody ? [...fieldsBody.querySelectorAll('.edit-bulk-check:checked')].map(b => b.closest('tr')) : [];
}

function updateEditBulkCount() {
    const bar = bulkBarEl();
    if (!bar || !fieldsBody) return;
    const total = fieldsBody.querySelectorAll('.edit-bulk-check').length;
    const n = editBulkRows().length;
    const count = bar.querySelector('.bulk-count');
    if (count) count.textContent = n ? t('bulkSelected').replace('{n}', n) : t('bulkPickCards');
    const controls = bar.querySelector('.bulk-controls');
    if (controls) controls.hidden = !n;
    const all = bar.querySelector('#edit-bulk-all');
    if (all) { all.checked = total > 0 && n === total; all.indeterminate = n > 0 && n < total; }
}

// Writes into the selected cards' inputs as if typed there.
function applyEditBulk(action, bar) {
    const rows = editBulkRows();
    if (!rows.length) return;
    if (action === 'delete') {
        rows.forEach(r => r.remove());
        updateSplitHints();
        updateEditBulkCount();
        return;
    }
    rows.forEach(row => {
        if (action === 'crop') {
            const crop = bar.querySelector('#eb-crop').value;
            if (!crop) return;
            row.querySelector('.field-crop').value = crop;
            row.querySelector('.field-sow').innerHTML = generateMonthOptionsHtml(crop, bar.querySelector('#eb-sow').value || null);
        } else if (action === 'catch') {
            const crop = bar.querySelector('#eb-catch').value;
            row.querySelector('.field-catch-crop').value = crop;
            row.querySelector('.field-catch-sow').innerHTML = generateMonthOptionsHtml(crop, bar.querySelector('#eb-catch-sow').value || null);
            syncCardOptionalCells(row, true);
        } else if (action === 'sown' || action === 'unsown') {
            row.querySelector('.field-state').checked = action === 'sown';
        } else {
            row.querySelectorAll('.tillage-switch-option').forEach(chip => chip.classList.remove('is-active'));
            const chip = action === 'plowed' ? '.tillage-switch-option--plowed' : (action === 'noTill' ? '.tillage-switch-option--notill' : null);
            if (chip) row.querySelector(chip).classList.add('is-active');
        }
    });
}

// Main table quick edits, current season only (past seasons render plain
// badges/chips): the state badge toggles sown / not sown and the rolling chip
// cycles rolling (none / to roll / rolled) straight away; the lime chip asks first in a small
// dialog — lime a field, lime it again when it's running low, or take a
// mistaken liming back.
if (fieldsBody) fieldsBody.addEventListener('click', async e => {
    const cutsBtn = e.target.closest('.cuts-open');
    if (cutsBtn && !isEditMode) { openCutsModal(parseInt(cutsBtn.dataset.idx, 10)); return; }
    if (e.target.closest('.field-open-callout-close')) { markFieldViewKnown(); return; }
    const fieldBtn = e.target.closest('.field-open');
    if (fieldBtn && !isEditMode) { openFieldModal(parseInt(fieldBtn.dataset.idx, 10)); return; }
    const fertBtn = e.target.closest('.fert-open');
    if (fertBtn && !isEditMode) {
        openFieldModal(parseInt(fertBtn.dataset.idx, 10));
        const target = document.querySelector('#field-modal-body .field-view-fert-target');
        if (target) target.closest('section').scrollIntoView({ block: 'start' });
        return;
    }
    const workBtn = e.target.closest('.work-open');
    if (workBtn && !isEditMode) { openWorkModal(parseInt(workBtn.dataset.idx, 10)); return; }
    const btn = e.target.closest('.state-toggle, .rolling-toggle, .lime-toggle, .weeds-toggle, .tillage-toggle');
    if (!btn || isEditMode) return;
    const allFarms = getAllFarms();
    const farm = allFarms.find(f => f.id === currentFarmId);
    const idx = parseInt(btn.dataset.idx, 10);
    const field = farm && (farm.fields || [])[idx];
    if (!field) return;

    if (btn.classList.contains('state-toggle')) {
        field.state = field.state !== 'Planted' ? 'Planted' : 'To Plant';
        syncSowStep(field);
    } else if (btn.classList.contains('rolling-toggle')) {
        // none -> to roll -> rolled -> none
        if (!field.rolling) { field.rolling = true; field.rollingDone = false; }
        else if (!field.rollingDone) field.rollingDone = true;
        else { field.rolling = false; field.rollingDone = false; }
    } else if (btn.classList.contains('weeds-toggle')) {
        // none -> to do -> sprayed -> weeded mechanically -> none
        field.weeds = field.weeds === 'needed' ? 'done' : (field.weeds === 'done' ? 'hoed' : (field.weeds === 'hoed' ? null : 'needed'));
        markWeedsManual(farm, field);
    } else if (btn.classList.contains('tillage-toggle')) {
        field.tillage = field.tillage === 'plowed' ? 'noTill' : (field.tillage === 'noTill' ? null : 'plowed');
    } else {
        const label = [(field.number || '').toString().trim(), field.crop ? translateCropName(field.crop) : ''].filter(Boolean).join(' · ') || '–';
        const { ph, status } = getLimeStatus(field, idx, farm.currentSeason || 1, getSupplyRates());
        const pct = ph != null ? Math.round(ph * 100) : 0;
        const remove = status === 'active';
        if (remove) {
            // pH is fine: the chip is a gauge — show what it means and when
            // lime is due again. Taking a liming back is a separate, deliberate step.
            const canRemove = field.limeAppliedSeason != null || field.limePh != null;
            const choice = await showDialog({
                title: t('limeConfirmTitle').replace('{field}', label),
                body: limeInfoText(field, idx, farm),
                confirmText: t('limeInfoOk'),
                icon: 'fa-flask',
                extraText: canRemove ? t('limeInfoRemove') : ''
            });
            if (choice !== 'extra') return;
            const sure = await showConfirm({
                title: t('limeConfirmTitle').replace('{field}', label),
                body: t('limeConfirmOff').replace('{pct}', pct),
                confirmText: t('limeConfirmOffBtn'),
                icon: 'fa-rotate-left',
                danger: true
            });
            if (sure !== true) return;
        } else {
            // Limed in the app this season but the pH still reads low (e.g. the
            // game's pH before the next sync): offer to take it back.
            const limedNow = field.limeAppliedSeason === (farm.currentSeason || 1);
            const ok = await showConfirm({
                title: t('limeConfirmTitle').replace('{field}', label),
                body: t(limedNow ? 'limeConfirmAgainLimedNow' : (status === 'off' ? 'limeConfirmOn' : 'limeConfirmAgain')).replace('{pct}', pct),
                confirmText: t('limeConfirmOnBtn'),
                icon: 'fa-flask',
                extraText: limedNow ? t('limeUndo') : ''
            });
            if (ok === 'extra') {
                undoLiming(field, farm.currentSeason || 1);
                saveFarmData(farm);
                renderSeasonView();
                return;
            }
            if (ok !== true) return;
        }
        if (remove) undoLiming(field, farm.currentSeason || 1);
        else applyLiming(field, farm.currentSeason || 1);
    }
    saveFarmData(farm);
    renderSeasonView();
});

// Fields of every archived season before `seasonNum` -> { [season]: fields }.
function loadSeasonHistory(farm, seasonNum) {
    const out = {};
    for (let s = 1; s < seasonNum; s++) out[s] = loadSeasonFields(farm, s);
    return out;
}

// Seasons in a row the same grassland crop has been on this field number,
// counting the viewed one (1 = sown this season).
function grasslandSeasonCount(field, history, seasonNum) {
    const key = (field.number || '').toString().trim();
    let n = 1;
    for (let s = seasonNum - 1; s >= 1; s--) {
        const prev = (history[s] || []).some(f => (f.number || '').toString().trim() === key && cropOrderKey(f.crop) === cropOrderKey(field.crop));
        if (!prev) break;
        n++;
    }
    return n;
}

// Farm setting: after how many seasons grassland should be ploughed up (default 4).
const GRASSLAND_SEASONS_DEFAULT = 4;
function grasslandSeasonLimit(farm) {
    const v = parseInt(farm && farm.grasslandMaxSeasons, 10);
    return v > 0 ? v : GRASSLAND_SEASONS_DEFAULT;
}

// "⟳ season 3" on its own line under the crop name (the repeat badge moves
// down with it, so a monoculture never widens the row).
function grassAgeCaption(age, rotationBadge) {
    return `<span class="ha-caption grass-age-caption" title="${escapeHtml(age.title)}">${rotationBadge.trim()} <span class="grass-age${age.over ? ' is-over' : ''}">${t('grassAge').replace('{n}', age.n)}</span></span>`;
}

function grasslandAge(field, history, seasonNum, limit) {
    if (!isPerennialCrop(field.crop)) return null;
    const n = grasslandSeasonCount(field, history, seasonNum);
    const over = n >= limit;
    return { n, over, title: t(over ? 'grassAgeOverHint' : 'grassAgeHint').replace('{n}', n).replace('{max}', limit) };
}

// Sowing window = the run of months in the crop calendar that holds the
// planned month. Overdue: not sown and the window already ended in this
// sowing year, which runs July..June — so in July an April sowing is next
// spring's, not a missed one.
const SOWING_YEAR_START = ALL_MONTHS.indexOf('JULY');
function isSowingOverdue(field, currentMonth) {
    if (!field.crop || field.state === 'Planted' || !currentMonth) return false;
    const cal = CROP_CALENDAR[field.crop];
    const sow = (field.sowingMonth || '').toUpperCase();
    if (!cal || !sow || !cal[sow]) return false;
    const idx = m => ALL_MONTHS.indexOf(m);
    const inWindow = m => !!cal[ALL_MONTHS[(m + 12) % 12]];
    const cur = idx(currentMonth);
    if (cur < 0 || inWindow(cur)) return false;
    let end = idx(sow);
    for (let i = 0; i < 11 && inWindow(end + 1); i++) end++;
    const posInYear = m => (m - SOWING_YEAR_START + 24) % 12;
    return posInYear(end) < posInYear(cur);
}

// Small stacked bar of the field's soil types (only when its soil is known).
// Like Precision Farming's soil map: loamy sand faded yellow, sandy loam faded
// green, loam grey, silty clay navy.
const SOIL_BAR_COLORS = { loamySand: '#d8c98a', sandyLoam: '#9fb58a', loam: '#9a9a96', siltyClay: '#2f3f63' };
function soilMixBarHtml(key) {
    const rates = getSupplyRates();
    if (!key || !rates.fieldSoil || !rates.fieldSoil[key]) return '';
    const mix = getFieldSoilMix(key, rates);
    const total = Object.values(mix).reduce((s, v) => s + v, 0);
    if (!total) return '';
    const parts = Object.entries(mix).map(([id, v]) => `<span style="flex:${v}; background:${SOIL_BAR_COLORS[id] || '#999'}"></span>`).join('');
    return `<span class="soil-mix-bar" title="${escapeHtml(soilMixLabel(mix))}">${parts}</span>`;
}

// Tillage: a real switch in the current season (click again to clear).
// Tillage: one chip — click cycles nothing -> plowed -> no-till.
function tillageCellHtml(field, idx, isPastSeason) {
    const value = field.tillage === 'plowed' || field.tillage === 'noTill' ? field.tillage : '';
    const label = value === 'plowed' ? t('tillagePlowed') : (value === 'noTill' ? t('tillageNoTill') : '–');
    const cls = `tillage-chip${value ? ' tillage-chip--' + value : ''}`;
    return isPastSeason
        ? `<span class="${cls}">${label}</span>`
        : `<button type="button" class="${cls} tillage-toggle" data-idx="${idx}" title="${t('tillageClickHint')}">${label}</button>`;
}

// Rolling: nothing / to roll (field.rolling) / rolled (field.rollingDone) —
// same three states and colours as weeds. Cycles on click in the current season.
// No chip for a crop that isn't rolled (FS25_CropDependentRolling, see cropNeedsRolling).
function rollingChipHtml(field, idx, isPastSeason) {
    if (!cropNeedsRolling(field.crop)) return '';
    const state = field.rolling ? (field.rollingDone ? 'done' : 'needed') : '';
    const title = t(state === 'needed' ? 'rollingPlanned' : (state === 'done' ? 'rollingDone' : 'rollingOff'));
    const cls = `treatment-chip treatment-chip--rolling${state ? ' is-' + state : ''}`;
    const icon = '<i class="fa-solid fa-grip-lines" aria-hidden="true"></i>';
    if (isPastSeason) return state ? `<span class="${cls}" title="${title}">${icon}</span>` : '';
    return `<button type="button" class="${cls} table-chip-toggle rolling-toggle" data-idx="${idx}" title="${title} · ${t('rollingClickHint')}">${icon}</button>`;
}

// Weeds: nothing / to spray / sprayed / weeded mechanically (hoe, weeder).
// Cycles on click in the current season; the savegame sync sets "to spray"
// when the game has live weeds on the field. Grassland gets no weeds in the
// game, so no chip; a field being ploughed this season shows it greyed out
// (ploughing buries the weeds) unless it's already done.
const WEEDS_STATES = ['needed', 'done', 'hoed'];
const WEEDS_TITLES = { needed: 'weedsNeeded', done: 'weedsDone', hoed: 'weedsHoed', '': 'weedsNone' };
function weedsChipHtml(field, idx, isPastSeason) {
    if (isPerennialCrop(field.crop) || isCutCrop(field.crop)) return '';
    const state = WEEDS_STATES.includes(field.weeds) ? field.weeds : '';
    const skip = field.tillage === 'plowed' && state !== 'done' && state !== 'hoed';
    const title = t(skip ? 'weedsPlowed' : WEEDS_TITLES[state]);
    const cls = `treatment-chip treatment-chip--weeds${state ? ' is-' + state : ''}${skip ? ' is-skip' : ''}`;
    const icon = `<i class="fa-solid ${state === 'hoed' ? 'fa-broom' : 'fa-spray-can-sparkles'}" aria-hidden="true"></i>`;
    if (isPastSeason) return state ? `<span class="${cls}" title="${title}">${icon}</span>` : '';
    return `<button type="button" class="${cls} table-chip-toggle weeds-toggle" data-idx="${idx}" title="${title} · ${t('weedsClickHint')}">${icon}</button>`;
}

// Fertilization: the "applied" ticks of the field's nitrogen plan — nothing /
// natural only (rust outline) / mineral, with or without natural (green).
// Click opens the field view at its nitrogen section.
function fertChipHtml(field, idx, isPastSeason) {
    if (!field.crop) return '';
    const state = field.fertilizer ? 'mineral' : (field.manure ? 'natural' : '');
    const title = t(field.fertilizer && field.manure ? 'fertChipBoth' : (state === 'mineral' ? 'fertChipMineral' : (state === 'natural' ? 'fertChipNatural' : 'fertChipNone')));
    const cls = `treatment-chip treatment-chip--fert${state ? ' is-' + state : ''}`;
    if (isPastSeason) return state ? `<span class="${cls}" title="${title}">N</span>` : '';
    return `<button type="button" class="${cls} table-chip-toggle fert-open" data-idx="${idx}" title="${title} · ${t('fertChipClickHint')}">N</button>`;
}

// ---------- field names and search ----------
// A name belongs to the physical field (keyed by its number, like
// farm.fieldSizes), so it carries over to every season and to every crop row
// sharing that number.
function fieldNameOf(farm, number) {
    const key = (number || '').toString().trim();
    return (key && farm && farm.fieldNames && farm.fieldNames[key]) || '';
}

function setFieldName(farm, number, name) {
    const key = (number || '').toString().trim();
    if (!key || !farm) return;
    const value = (name || '').trim().slice(0, 40);
    if (!farm.fieldNames) farm.fieldNames = {};
    if (value) farm.fieldNames[key] = value;
    else delete farm.fieldNames[key];
}

// Lower case without diacritics ("Łąka" -> "laka", "Weizen" stays), so a
// search doesn't depend on typing Polish or German letters.
function searchFold(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/ß/g, 'ss');
}

function fieldSearchQuery() {
    const input = document.getElementById('fields-search');
    return input && !isEditMode ? searchFold(input.value.trim()) : '';
}

// Every word of the query has to appear in the field's number, name, crop
// (main or catch, in the app's language or as stored) or crop rotation.
function fieldMatchesSearch(field, farm) {
    const query = fieldSearchQuery();
    if (!query) return true;
    const haystack = searchFold([
        field.number, fieldNameOf(farm, field.number),
        field.crop, field.crop && translateCropName(field.crop),
        field.catchCrop, field.catchCrop && translateCropName(field.catchCrop),
        (fieldRotationInfo(farm, field) || { rot: {} }).rot.name
    ].filter(Boolean).join(' '));
    return query.split(/\s+/).every(word => haystack.includes(word));
}

(function wireFieldSearch() {
    const input = document.getElementById('fields-search');
    if (!input) return;
    input.addEventListener('input', () => renderSeasonView());
    input.addEventListener('keydown', e => {
        if (e.key === 'Escape' && input.value) {
            e.stopPropagation();
            input.value = '';
            renderSeasonView();
        }
    });
    // Ctrl+F in the season plan jumps to the search (not with a dialog open or in Edit).
    document.addEventListener('keydown', e => {
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return;
        const planOpen = plannerView && plannerView.style.display !== 'none';
        const dialogOpen = Array.from(document.querySelectorAll('.modal')).some(m => m.style.display === 'flex');
        if (!planOpen || dialogOpen || isEditMode) return;
        e.preventDefault();
        input.focus();
        input.select();
    });
})();

function clearFieldSearch() {
    const input = document.getElementById('fields-search');
    if (input) input.value = '';
}

// Settings come back as strings.
function fieldViewKnown() {
    return String(getSetting('fieldViewOpened')) === 'true';
}

function fieldOpenCalloutHtml() {
    return `<span class="field-open-callout" role="note">${escapeHtml(t('fieldOpenCallout'))}<button type="button" class="field-open-callout-close" aria-label="${escapeHtml(t('close'))}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>`;
}

function markFieldViewKnown() {
    if (fieldViewKnown()) return;
    setSetting('fieldViewOpened', 'true');
    document.querySelectorAll('.field-open-callout').forEach(el => el.remove());
    document.querySelectorAll('.field-open.has-callout').forEach(el => el.classList.remove('has-callout'));
}

function renderFieldsTable(fields) {
    updateFieldsSortHeaders();
    if (!fieldsBody) return;
    if (fieldsTable) fieldsTable.classList.remove('is-edit-cards');

    const farm = getAllFarms().find(f => f.id === currentFarmId);
    const currentFarmMonth = farm && farm.month ? farm.month.toUpperCase() : "";
    const fieldSizes = (farm && farm.fieldSizes) ? farm.fieldSizes : {};
    const prevCropMap = getPreviousSeasonCropMap(farm, viewedSeason);
    const isPastSeason = viewedSeason < ((farm && farm.currentSeason) || 1);

    let htmlString = "";
    let shownCount = 0;    // rows left by the search
    let totalArea = 0;     // rows with a crop planned
    let sownArea = 0;      // ...of which already sown
    const seasonHistory = loadSeasonHistory(farm, viewedSeason);
    const grassLimit = grasslandSeasonLimit(farm);
    // Few players find the field view: the first row points at it until it's opened once.
    const showOpenCallout = !isPastSeason && !fieldViewKnown() && !(typeof tut !== 'undefined' && tut.active);
    let openCalloutShown = false;

    if (fields && fields.length > 0) {
        const numberTotals = getFieldNumberTotals(fields);
        const sortedFields = sortFieldsForDisplay(fields, currentFarmMonth);

        sortedFields.forEach(field => {
            const area = parseFloat(field.area || 0);
            if (field.crop) totalArea += area;
            if (field.crop && field.state === 'Planted') sownArea += area;
            // The search only hides rows; the totals below still cover every field.
            if (!fieldMatchesSearch(field, farm)) return;
            shownCount++;

            const key = (field.number || '').toString().trim();
            const fieldName = fieldNameOf(farm, key);
            const group = numberTotals[key];
            const isSplit = group && group.count > 1;

            const isRotationRepeat = !!(field.crop && prevCropMap[key] && prevCropMap[key].some(c => cropOrderKey(c) === cropOrderKey(field.crop)));
            const rotationBadge = isRotationRepeat
                ? ` <span class="badge badge--rotation-warn" title="${t('rotationWarning')}"><i class="fa-solid fa-rotate" aria-hidden="true"></i></span>`
                : '';
            const grassAge = grasslandAge(field, seasonHistory, viewedSeason, grassLimit);

            let areaCell = `${area.toFixed(2)} ha`;
            if (isSplit) {
                // Prefer the physical field size the user entered; fall back to
                // the sum of what's actually been allocated to crops so far.
                const savedSize = fieldSizes[key];
                const displayTotal = (savedSize !== undefined && savedSize !== null) ? parseFloat(savedSize) : group.area;
                const unassigned = displayTotal - group.area;

                let extra = `${t('of')} ${displayTotal.toFixed(2)} ${t('totalHa')}`;
                if (Math.abs(unassigned) > 0.005) {
                    extra += unassigned > 0
                        ? ` · <span class="ha-caption--warn">${unassigned.toFixed(2)} ${t('haNotAssigned')}</span>`
                        : ` · <span class="ha-caption--warn">${t('overBy')} ${Math.abs(unassigned).toFixed(2)} ha</span>`;
                }
                areaCell = `${area.toFixed(2)} ha<span class="ha-caption">${extra}</span>`;
            }
            const plotHa = farmlandAreaForKey(key);
            if (plotHa !== null) areaCell += `<span class="ha-caption ha-caption--farmland">${t('farmlandPlot')}: ${plotHa.toFixed(2)} ha</span>`;
            areaCell += soilMixBarHtml(key);

            let stateDisplay;

            if (field.state === 'Planted') {
                stateDisplay = `<span class="badge badge--planted">${t('planted')}</span>`;
            } else {
                const sowMonth = field.sowingMonth ? field.sowingMonth.toUpperCase() : "";
                if (sowMonth === currentFarmMonth && sowMonth !== "") {
                    stateDisplay = `<span class="badge badge--plant-now">${t('plantNow')}</span>`;
                } else if (!isPastSeason && isSowingOverdue(field, currentFarmMonth)) {
                    stateDisplay = `<span class="badge badge--overdue" title="${t('overdueHint')}">${t('overdue')}</span>`;
                } else {
                    stateDisplay = `<span class="badge badge--to-plant">${t('toPlant')}</span>`;
                }
            }

            // Real index in the (unsorted) fields array — needed for
            // fertPlanSoilKey/fertPlanKey below AND for the lime pH lookup,
            // which must key soil mix the same way buildSuppliesFertRows does.
            const origIdx = fields.indexOf(field);
            const { ph: limePh, status: limeStatus, pf: limePf } = getLimeStatus(field, origIdx, viewedSeason, getSupplyRates());
            const limeColor = limeChipColor(limePh);
            const limeTitle = limePf
                ? t('limeTitlePf').replace('{ph}', limePf.avg.toFixed(2)).replace('{opt}', limePf.optimal.toFixed(2))
                    + (limePf.limeL >= 1 ? ' · ' + t('limeTitlePfNeed').replace('{l}', Math.round(limePf.limeL).toLocaleString(FIN_LOCALE())) : '')
                : buildLimeTitle(limePh, limeStatus, field.limeAppliedSeason);
            const limedNow = !isPastSeason && field.limeAppliedSeason != null && field.limeAppliedSeason === ((farm && farm.currentSeason) || 1);
            let limeHint = limeTitle + (limedNow ? ` · ${t('limedThisSeason')}` : '');
            if (!isPastSeason && limeStatus === 'active') {
                const due = limeDueText(field, origIdx, farm, limePh);
                if (due) limeHint += `\n${due}`;
            }

            const numberParts = String(field.number || '').split('-').map(n => n.trim()).filter(Boolean);
            const numberChipsHtml = numberParts.length
                ? numberParts.map(n => `<span class="field-number-chip">${n}</span>`).join('<span class="field-number-sep">–</span>')
                : `<span class="field-number-chip">${field.number || '–'}</span>`;
            const numberCellTitle = numberParts.length > 1 ? ` title="${field.number}"` : '';

            const calloutHere = showOpenCallout && !openCalloutShown;
            if (calloutHere) openCalloutShown = true;
            htmlString += `
                <tr class="${isSplit ? 'field-split-row' : ''}${field.lease ? ' field-lease-row' : ''}">
                    <td class="field-number-cell"${numberCellTitle}>${isPastSeason
                        ? `<span class="field-number-chips">${numberChipsHtml}</span>${fieldName ? `<span class="field-name">${escapeHtml(fieldName)}</span>` : ''}`
                        : `<button type="button" class="field-open${calloutHere ? ' has-callout' : ''}" data-idx="${origIdx}" title="${t('fieldViewOpenHint')}"><span class="field-number-chips">${numberChipsHtml}<i class="fa-solid fa-up-right-from-square field-open-icon" aria-hidden="true"></i></span>${fieldName ? `<span class="field-name">${escapeHtml(fieldName)}</span>` : ''}</button>${calloutHere ? fieldOpenCalloutHtml() : ''}`}${leaseBadgeHtml(field, viewedSeason)}</td>
                    <td>${areaCell}</td>
                    <td class="crop-cell">${field.crop ? translateCropName(field.crop) : '-'}${grassAge ? '' : rotationBadge}${grassAge ? grassAgeCaption(grassAge, rotationBadge) : ''}${catchCropCaption(field)}${isPastSeason ? '' : rotationCaptionHtml(farm, field, seasonHistory)}</td>
                    <td>${field.sowingMonth ? translateMonth(field.sowingMonth) : '-'}</td>
                    <td>${stateCellHtml(field, origIdx, isPastSeason, stateDisplay)}${workCellHtml(field, origIdx, isPastSeason, farm)}</td>
                    <td>${tillageCellHtml(field, origIdx, isPastSeason)}</td>
                    <td class="treatments-cell">
                        ${(() => {
                            // Current season: chips are buttons (lime asks first, rolling toggles).
                            const tag = isPastSeason ? 'span' : 'button';
                            const btnAttrs = isPastSeason ? '' : ` type="button" data-idx="${origIdx}"`;
                            const limeHtml = `<${tag}${btnAttrs} class="treatment-chip treatment-chip--lime${isPastSeason ? '' : ' table-chip-toggle lime-toggle'}${limedNow ? ' is-limed-now' : ''}"${limeColor ? ` style="--lime-color:${limeColor}; --lime-pct:${Math.round(limePh * 100)}%;"` : ''} title="${escapeHtml(limeHint)}${isPastSeason ? '' : ' · ' + t('limeClickHint')}">
                                <span class="lime-fill"></span>
                                <span class="lime-letter" data-letter="${t('limeLetter')}">${t('limeLetter')}</span>
                            </${tag}>`;
                            const rollingHtml = rollingChipHtml(field, origIdx, isPastSeason);
                            return limeHtml + fertChipHtml(field, origIdx, isPastSeason) + rollingHtml + weedsChipHtml(field, origIdx, isPastSeason);
                        })()}
                    </td>
                </tr>
            `;
        });
    }
    const searching = !!fieldSearchQuery() && fields && fields.length > 0;
    if (searching && !shownCount) {
        htmlString = `<tr class="fields-search-empty"><td colspan="7">${escapeHtml(t('fieldsSearchNone'))}</td></tr>`;
    }
    fieldsBody.innerHTML = htmlString;
    renderBulkBar();
    const countEl = document.getElementById('fields-search-count');
    if (countEl) {
        countEl.hidden = !searching;
        if (searching) countEl.textContent = t('fieldsSearchCount').replace('{n}', shownCount).replace('{total}', fields.length);
    }

    if (totalSumEl) totalSumEl.innerText = totalArea.toFixed(2) + " ha";
    const sownSumEl = document.getElementById('sown-ha-sum');
    if (sownSumEl) sownSumEl.textContent = t('sownAreaSum').replace('{ha}', sownArea.toFixed(2));
    const farmlandSumEl = document.getElementById('farmland-ha-sum');
    if (farmlandSumEl) {
        const owned = (FARMLAND_INFO && FARMLAND_INFO.ok) ? FARMLAND_INFO.owned.filter(id => FARMLAND_INFO.areas[id] !== undefined) : [];
        farmlandSumEl.hidden = !owned.length;
        if (owned.length) {
            const plotsHa = owned.reduce((s, id) => s + FARMLAND_INFO.areas[id], 0);
            farmlandSumEl.textContent = t('farmlandTotal').replace('{ha}', plotsHa.toFixed(2)).replace('{n}', owned.length);
        }
    }
}

function generateMonthOptionsHtml(cropName, selectedMonth) {
    const validMonths = (cropName && CROP_CALENDAR[cropName]) ? Object.keys(CROP_CALENDAR[cropName]).sort((a, b) => ALL_MONTHS.indexOf(a) - ALL_MONTHS.indexOf(b)) : [];
    if (validMonths.length === 0) return `<option value="">${t('selectCropFirst')}</option>`;

    let html = `<option value="">${t('selectMonth')}</option>`;
    validMonths.forEach(m => {
        html += `<option value="${m}" ${selectedMonth === m ? 'selected' : ''}>${translateMonth(m)}</option>`;
    });
    return html;
}

// Every crop the farm's map offers, in the game's own menu order — plus the
// currently selected one, so a field keeps a crop the map no longer lists.
// Crops that make sense as a catch crop (międzyplon) before the main crop.
const CATCH_CROPS = ['Greenrye', 'Oilseedradish', 'Grass'];
function isCatchCropChoice(crop) {
    return CATCH_CROPS.some(c => cropOrderKey(c) === cropOrderKey(crop || ''));
}

// onlyCatch: list just the catch crops (a saved choice outside it stays listed).
function cropOptionsHtml(selected, emptyLabel, onlyCatch = false) {
    const crops = AVAILABLE_CROPS.filter(c => !onlyCatch || isCatchCropChoice(c));
    if (selected && !crops.includes(selected)) crops.push(selected);
    let html = `<option value="">${emptyLabel}</option>`;
    crops.forEach(c => {
        html += `<option value="${escapeHtml(c)}" ${selected === c ? 'selected' : ''}>${escapeHtml(translateCropName(c))}</option>`;
    });
    return html;
}

// Builds one editable field as a self-contained "tile" — a <tr> holding a
// single full-width <td> with a card inside. Keeping it inside a <tr> means all
// the existing save / split-hint logic (which walks `#fields-body tr` and
// `row.querySelector('.field-*')`) keeps working unchanged.
// Field data the edit card has no inputs for — carried through edit mode as is.
// Rolling is set with the chip in the table, so it rides along here too; id
// is the field's stable identity (see ensureFieldIds).
const FIELD_EXTRA_KEYS = ['id', 'weeds', 'weedsManual', 'work', 'workCleared', 'lease', 'areaSource', 'rolling', 'rollingDone', 'limePrev', 'rotation'];

// --- Stable field ids --------------------------------------------------------
// Soil, field size and name, fertilization plan, feed use and straw are stored under
// the field's number ("12") or number + crop ("12::Wheat"). Every field row
// also has a stable id, so when Edit season changes a number or a crop that
// data is moved to the new key instead of being left behind.
function newFieldId() {
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Gives every field of the farm an id. Returns true if any was added.
function ensureFieldIds(farm) {
    let added = false;
    (farm && farm.fields || []).forEach(f => { if (!f.id) { f.id = newFieldId(); added = true; } });
    return added;
}

// Moves per-field data from old keys to new ones for fields (matched by id)
// whose number or crop changed in an edit. A key still used by another field
// is copied, not moved; an existing value under the new key wins.
function migrateFieldKeys(farm, oldFields, newFields) {
    const byId = {};
    (oldFields || []).forEach(f => { if (f.id) byId[f.id] = f; });
    const num = f => (f.number || '').toString().trim();
    const planKey = f => num(f) + '::' + (f.crop || '');
    const stillUsed = (key, kind) => newFields.some(f => (kind === 'num' ? num(f) : planKey(f)) === key);
    const move = (store, from, to, kind) => {
        if (!store || from === to || store[from] === undefined) return;
        if (store[to] === undefined) store[to] = JSON.parse(JSON.stringify(store[from]));
        if (!stillUsed(from, kind)) delete store[from];
    };
    const rates = farm.supplyRates || null;
    const plan = farm.feedPlan || null;
    newFields.forEach(f => {
        const old = f.id && byId[f.id];
        if (!old) return;
        if (num(old) && num(old) !== num(f)) {
            if (rates) move(rates.fieldSoil, num(old), num(f), 'num');
            move(farm.fieldSizes, num(old), num(f), 'num');
            move(farm.fieldNames, num(old), num(f), 'num');
        }
        if (num(old) && planKey(old) !== planKey(f)) {
            if (rates) move(rates.fertPlan, planKey(old), planKey(f), 'plan');
            if (plan) {
                [['', ''], [':catch', ':catch']].forEach(([a, b]) => {
                    move(plan.fieldUse, planKey(old) + a, planKey(f) + b, 'plan');
                    move(plan.strawFields, planKey(old) + a, planKey(f) + b, 'plan');
                });
            }
        }
    });
}
function fieldExtras(field) {
    const out = {};
    FIELD_EXTRA_KEYS.forEach(k => { if (field && field[k] !== undefined) out[k] = field[k]; });
    return out;
}

function buildFieldEditCard(field, opts) {
    opts = opts || {};
    field = field || {};
    const farm = opts.farm || null;
    const isNew = !!opts.isNew;
    const isSplit = !!opts.isSplit;

    const cropOptions = cropOptionsHtml(field.crop, t('selectPlaceholder'));
    const catchCropOptions = cropOptionsHtml(field.catchCrop, t('catchCropNone'), true);

    const monthOptions = isNew
        ? `<option value="">${t('selectCropFirst')}</option>`
        : generateMonthOptionsHtml(field.crop, field.sowingMonth);
    const catchMonthOptions = generateMonthOptionsHtml(field.catchCrop, field.catchSowingMonth);

    const isChecked = field.state === 'Planted' ? 'checked' : '';
    const lease = field.lease || null;
    const key = (field.number || '').toString().trim();
    const savedSize = (farm && farm.fieldSizes && key && farm.fieldSizes[key] !== undefined) ? farm.fieldSizes[key] : '';
    // opts.origIdx = this field's real index in farm.fields (not a position in
    // a sorted render copy) — needed so the soil-mix lookup behind the pH
    // model keys the same way it does everywhere else (buildSuppliesFertRows,
    // the read-only fields table, etc).
    const limePhForCard = isNew ? null : resolveLimePh(field, (farm && farm.currentSeason) || 1, getFieldSoilMix(fertPlanSoilKey(field, opts.origIdx), getSupplyRates()));
    const limeStatusForCard = isNew ? 'off' : (limePhForCard == null ? 'off' : (limePhForCard > 0.75 ? 'active' : 'warning'));
    // is-active/is-warning are kept purely as state markers for
    // toggleLimeChip() and the edit-save handler (they read these classes to
    // know on/off + active-vs-warning) — the visual color now comes from the
    // inline .lime-fill style below, not from CSS on these classes.
    const limeCls = limeStatusForCard === 'active' ? 'is-active' : (limeStatusForCard === 'warning' ? 'is-warning' : '');
    const limeColorForCard = limeChipColor(limePhForCard);
    const limeSeason = (field.limeAppliedSeason !== undefined && field.limeAppliedSeason !== null) ? field.limeAppliedSeason : '';
    // Catch crop, rotation and lease fold away; what's already set opens them and shows in the summary.
    const rotInfo = isNew ? null : fieldRotationInfo(farm, field);
    const moreSet = [
        field.catchCrop ? `${t('thCatchCrop')}: ${translateCropName(field.catchCrop)}` : '',
        rotInfo ? `${t('rotFieldCycle')}: ${rotInfo.rot.name} (${rotInfo.slot.step + 1}/${rotInfo.rot.steps.length})` : '',
        lease ? t('leaseLabel') + (lease.seasons ? ` (${lease.seasons})` : '') : ''
    ].filter(Boolean);

    return `
        <tr class="field-edit-tr${isSplit ? ' field-split-row' : ''}${field.lease ? ' field-lease-row' : ''}" data-extra="${escapeHtml(JSON.stringify(fieldExtras(field)))}" data-manure="${field.manure ? '1' : '0'}" data-fertilizer="${field.fertilizer ? '1' : '0'}" data-cuts="${escapeHtml(JSON.stringify(Array.isArray(field.cuts) ? field.cuts : []))}">
            <td colspan="7">
                <div class="field-card">
                    <label class="field-card-select" title="${t('bulkSelectCard')}"><input type="checkbox" class="edit-bulk-check fp-check" aria-label="${t('bulkSelectCard')}"></label>
                    <button type="button" class="delete-row-btn field-card-delete" onclick="deleteFieldRow(this)" title="${t('delete')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                    <div class="field-card-row">
                        <div class="fc-cell fc-cell--num">
                            <span class="fc-label">${t('thFieldNo')}</span>
                            <span class="field-num-group">
                                <input type="text" class="edit-input field-number" value="${field.number || ''}" placeholder="#" title="${t('combineNumbersHint')}">
                                <button type="button" class="field-number-add-btn" onclick="appendFieldNumber(this)" title="${t('combineNumbersHint')}">+</button>
                            </span>
                        </div>
                        <div class="fc-cell fc-cell--area">
                            <span class="fc-label">${t('thFieldHa')}</span>
                            <input type="text" class="edit-input field-area" value="${field.area || ''}" data-orig="${escapeHtml(String(field.area || ''))}" placeholder="0.00">
                        </div>
                        <label class="fc-cell fc-cell--state">
                            <span class="fc-label">${t('thState')}</span>
                            <span class="fc-check"><input type="checkbox" class="edit-input field-state fp-check" ${isChecked}> <span class="fc-check-text">${t('planted')}</span></span>
                        </label>
                    </div>
                    <div class="field-card-row field-card-row--grid">
                        <div class="fc-cell">
                            <span class="fc-label">${t('thCrop')}</span>
                            <select class="edit-input field-crop" onchange="onCropChange(this)">${cropOptions}</select>
                        </div>
                        <div class="fc-cell">
                            <span class="fc-label">${t('thSowingMth')}</span>
                            <select class="edit-input field-sow">${monthOptions}</select>
                        </div>
                        <div class="fc-cell">
                            <span class="fc-label">${t('thTillage')}</span>
                            <div class="tillage-switch">
                                <button type="button" class="tillage-switch-option tillage-switch-option--plowed ${field.tillage === 'plowed' ? 'is-active' : ''}" onclick="toggleTillageChip(this)">${t('tillagePlowed')}</button>
                                <button type="button" class="tillage-switch-option tillage-switch-option--notill ${field.tillage === 'noTill' ? 'is-active' : ''}" onclick="toggleTillageChip(this)">${t('tillageNoTill')}</button>
                            </div>
                        </div>
                        <div class="fc-cell">
                            <span class="fc-label">${t('thSoil')}</span>
                            <div class="treatments-cell">
                                <button type="button" class="treatment-chip treatment-chip--lime ${limeCls}${limePhForCard != null && limePhForCard >= 0.5 ? ' lime-strong' : ''}"${limeColorForCard ? ` style="--lime-color:${limeColorForCard}; --lime-pct:${Math.round(limePhForCard * 100)}%;"` : ''} data-lime-season="${limeSeason}" data-lime-ph="${limePhForCard != null ? limePhForCard : ''}" onclick="toggleLimeChip(this)" title="${t('limeEditTitle')}${limePhForCard != null ? ' (' + Math.round(limePhForCard * 100) + '% pH)' : ''}">
                                    <span class="lime-fill"></span>
                                    <span class="lime-letter" data-letter="${t('limeLetter')}">${t('limeLetter')}</span>
                                </button>
                                <span class="fc-chip-text">${t('work_lime')}</span>
                            </div>
                        </div>
                    </div>
                    <details class="field-card-more"${moreSet.length ? ' open' : ''}>
                        <summary class="field-card-more-summary"><span class="field-card-more-label">${t('fieldCardMore')}</span>${moreSet.length ? `<span class="field-card-more-set">${escapeHtml(moreSet.join(' · '))}</span>` : ''}</summary>
                    <div class="field-card-row field-card-row--grid field-card-row--catch">
                        <div class="fc-cell">
                            <span class="fc-label" title="${t('catchCropHint')}">${t('thCatchCrop')}</span>
                            <select class="edit-input field-catch-crop" onchange="onCatchCropChange(this)">${catchCropOptions}</select>
                        </div>
                        <div class="fc-cell fc-cell--catch-sow"${field.catchCrop ? '' : ' hidden'}>
                            <span class="fc-label">${t('thCatchSowingMth')}</span>
                            <select class="edit-input field-catch-sow">${catchMonthOptions}</select>
                        </div>
                    </div>
                    ${getRotations(farm).length ? `<div class="field-card-row field-card-row--grid field-card-row--rotation">${rotationEditCellsHtml(farm, field)}</div>` : ''}
                    <div class="field-card-row field-card-row--grid field-card-row--lease">
                        <div class="fc-cell">
                            <span class="fc-label">${t('leaseLabel')}</span>
                            <label class="lease-check"><input type="checkbox" class="field-lease fp-check" ${lease ? 'checked' : ''}> ${t('leaseYes')}</label>
                        </div>
                        <div class="fc-cell fc-cell--lease-detail"${lease ? '' : ' hidden'}>
                            <span class="fc-label">${t('leaseSeasons')}</span>
                            <input type="number" min="1" max="50" step="1" class="edit-input field-lease-seasons" value="${lease ? lease.seasons || '' : ''}" placeholder="–">
                        </div>
                        <div class="fc-cell fc-cell--lease-detail"${lease ? '' : ' hidden'}>
                            <span class="fc-label">${t('leaseThen')}</span>
                            <select class="edit-input field-lease-then">
                                <option value="return" ${lease && lease.then === 'return' ? 'selected' : ''}>${t('leaseReturn')}</option>
                                <option value="buy" ${lease && lease.then === 'buy' ? 'selected' : ''}>${t('leaseBuy')}</option>
                            </select>
                        </div>
                    </div>
                    </details>
                    <div class="field-card-foot">
                        <input type="text" class="edit-input field-size-input" value="${savedSize}" placeholder="${t('fieldSizeLabel')}" title="${t('fieldSizeHint')}" style="display:none;">
                        <span class="split-hint"></span>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

function renderEditTableWithDropdowns(fields) {
    if (!fieldsBody) return;
    if (fieldsTable) fieldsTable.classList.add('is-edit-cards');

    const farm = getAllFarms().find(f => f.id === currentFarmId);
    const currentFarmMonth = farm && farm.month ? farm.month.toUpperCase() : "";

    const numberTotals = getFieldNumberTotals(fields);

    const sortedFields = sortFieldsForDisplay(fields, currentFarmMonth);

    let htmlString = "";
    sortedFields.forEach((field) => {
        const key = (field.number || '').toString().trim();
        const isSplit = !!(key && numberTotals[key] && numberTotals[key].count > 1);
        htmlString += buildFieldEditCard(field, { farm, isSplit, origIdx: fields.indexOf(field) });
    });

    htmlString += `
        <tr class="add-field-tr">
            <td colspan="7" class="add-row-trigger" onclick="addNewFieldRow()" title="${t('addRowSplitHint')}">
                ${t('addNewField')}
            </td>
        </tr>
    `;

    fieldsBody.innerHTML = htmlString;
    updateSplitHints();
    renderEditBulkBar();
}

window.onCropChange = function (selectEl) {
    const row = selectEl.closest('tr');
    row.querySelector('.field-sow').innerHTML = generateMonthOptionsHtml(selectEl.value, null);
};

window.onCatchCropChange = function (selectEl) {
    const row = selectEl.closest('tr');
    row.querySelector('.field-catch-sow').innerHTML = generateMonthOptionsHtml(selectEl.value, null);
    syncCardOptionalCells(row);
};

// Edit card: the catch crop's month only with a catch crop, the lease length
// and "then" only on a leased field. `reveal` opens the folded part when a
// value lands there from elsewhere (the bulk bar, a mirrored card).
function syncCardOptionalCells(row, reveal) {
    const catchSel = row.querySelector('.field-catch-crop');
    const lease = row.querySelector('.field-lease');
    const sowCell = row.querySelector('.fc-cell--catch-sow');
    if (sowCell && catchSel) sowCell.hidden = !catchSel.value;
    row.querySelectorAll('.fc-cell--lease-detail').forEach(c => { c.hidden = !(lease && lease.checked); });
    const more = row.querySelector('.field-card-more');
    if (reveal && more && ((catchSel && catchSel.value) || (lease && lease.checked))) more.open = true;
}

if (fieldsBody) fieldsBody.addEventListener('change', e => {
    if (!e.target.classList || !e.target.classList.contains('field-lease')) return;
    const row = e.target.closest('tr');
    if (row) syncCardOptionalCells(row);
});

// Toggles between "Plowed" and "No-till" for a field — mutually exclusive,
// like a radio pair: selecting one clears the other, clicking the already
// active one clears the selection entirely.
window.toggleTillageChip = function (btn) {
    const row = btn.closest('tr');
    const wasActive = btn.classList.contains('is-active');
    row.querySelectorAll('.tillage-switch-option').forEach(chip => chip.classList.remove('is-active'));
    if (!wasActive) btn.classList.add('is-active');
    // Selected cards follow (several fields at once).
    if (isEditMode && row.classList.contains('is-bulk-selected')) {
        const plowed = row.querySelector('.tillage-switch-option--plowed').classList.contains('is-active');
        const noTill = row.querySelector('.tillage-switch-option--notill').classList.contains('is-active');
        selectedEditRows(row).forEach(other => {
            other.querySelector('.tillage-switch-option--plowed').classList.toggle('is-active', plowed);
            other.querySelector('.tillage-switch-option--notill').classList.toggle('is-active', noTill);
            flashMirrored(other);
        });
    }
};

window.deleteFieldRow = function (btn) {
    btn.closest('tr').remove();
    updateSplitHints();
};

// Recomputes, for every row in the edit-mode fields table, how much ha
// is used by other crop(s) sharing the same field number, and — if a
// field size was entered anywhere in that group — how much is left to sow.
function updateSplitHints() {
    if (!fieldsBody) return;

    const rows = Array.from(fieldsBody.querySelectorAll('tr')).filter(r => r.querySelector('.field-number'));
    const groups = {};

    rows.forEach(row => {
        const numInput = row.querySelector('.field-number');
        const key = (numInput.value || '').trim();

        const sizeInput = row.querySelector('.field-size-input');
        const hint = row.querySelector('.split-hint');
        if (sizeInput) sizeInput.style.display = 'none';
        if (hint) hint.textContent = '';
        row.classList.remove('has-split-info');

        if (!key) return;
        const areaInput = row.querySelector('.field-area');
        const area = parseDecimal(areaInput.value || '0') || 0;
        if (!groups[key]) groups[key] = [];
        groups[key].push({ row, area });
    });

    Object.keys(groups).forEach(key => {
        const group = groups[key];
        if (group.length < 2) return;

        const total = group.reduce((sum, r) => sum + r.area, 0);

        // Use the first non-empty "field size" entered anywhere in the group.
        let fieldSize = null;
        group.forEach(({ row }) => {
            row.classList.add('has-split-info');
            const sizeInput = row.querySelector('.field-size-input');
            if (sizeInput) {
                sizeInput.style.display = 'block';
                if (fieldSize === null && sizeInput.value) {
                    const parsed = parseDecimal(sizeInput.value);
                    if (!isNaN(parsed)) fieldSize = parsed;
                }
            }
        });

        // Mirror the field size across every row in the group so it only
        // has to be typed once — but never touch the box the user is
        // actively typing in.
        if (fieldSize !== null) {
            group.forEach(({ row }) => {
                const sizeInput = row.querySelector('.field-size-input');
                if (sizeInput && document.activeElement !== sizeInput && sizeInput.value.trim() === '') {
                    sizeInput.value = fieldSize;
                }
            });
        }

        group.forEach(({ row, area }) => {
            const hint = row.querySelector('.split-hint');
            if (!hint) return;
            const usedElsewhere = total - area;
            let text = `${t('usedByOthersHere')}: ${usedElsewhere.toFixed(2)} ha`;
            if (fieldSize !== null) {
                const remaining = fieldSize - total;
                text += remaining >= 0
                    ? ` · ${remaining.toFixed(2)} ${t('stillFree')}`
                    : ` · ${t('overFieldSizeBy')} ${Math.abs(remaining).toFixed(2)} ha`;
            }
            hint.textContent = text;
        });
    });
}
window.updateSplitHints = updateSplitHints;

if (fieldsBody) {
    fieldsBody.addEventListener('input', (e) => {
        if (!isEditMode) return;
        // Typing an area by hand: no longer ours to fill in.
        if (e.target.classList.contains('field-area')) delete e.target.dataset.auto;
        if (e.target.classList.contains('field-area') ||
            e.target.classList.contains('field-number') ||
            e.target.classList.contains('field-size-input')) {
            updateSplitHints();
        }
    });
    fieldsBody.addEventListener('change', (e) => {
        if (!isEditMode || !e.target.classList.contains('field-number')) return;
        autoFillFieldArea(e.target.closest('tr'));
        updateSplitHints();
    });
}

// Hectares of one game field number from what the farm already knows: its
// saved field size, the saved rows with that number (split rows summed), then
// the save's real field area (Precision Farming). null = unknown.
function knownFieldHa(farm, id, saveAreas) {
    const size = parseFloat((farm.fieldSizes || {})[id]);
    if (!isNaN(size) && size > 0) return size;
    const rowsHa = (farm.fields || []).filter(f => (f.number || '').toString().trim() === id)
        .reduce((s, f) => s + (parseFloat(f.area) || 0), 0);
    if (rowsHa > 0) return rowsHa;
    return saveAreas[id] != null ? saveAreas[id] : null;
}

// After a field number is typed in Edit: fills the row's area with the sum of
// the fields it names ("10-11-12" -> 10 + 11 + 12). Leaves an area typed by
// hand alone, and rows sharing a number (split between crops) too.
function autoFillFieldArea(row) {
    const farm = getCurrentFarm();
    const numInput = row && row.querySelector('.field-number');
    const areaInput = row && row.querySelector('.field-area');
    if (!farm || !numInput || !areaInput) return;
    const cell = areaInput.closest('.fc-cell') || areaInput.parentElement;
    let hint = cell.querySelector('.area-auto-hint');
    if (!hint) {
        hint = document.createElement('span');
        hint.className = 'area-auto-hint';
        cell.appendChild(hint);
    }
    hint.textContent = '';

    const number = numInput.value.trim();
    const ids = number.split(/[^0-9]+/).filter(Boolean).map(s => String(parseInt(s, 10)));
    if (!ids.length) return;
    const shared = Array.from(fieldsBody.querySelectorAll('.field-number'))
        .some(other => other !== numInput && other.value.trim() === number);
    if (shared) return;
    const current = parseDecimal(areaInput.value || '0') || 0;
    const untouched = areaInput.value === (areaInput.dataset.orig || '');
    if (current > 0 && !areaInput.dataset.auto && !untouched) return;
    // A single number on a row that already has its area: nothing to add up.
    if (ids.length === 1 && current > 0 && !areaInput.dataset.auto) return;

    const save = readSaveFields(farm);
    const saveAreas = {};
    if (save.ok) save.fields.forEach(f => { if (f.areaHa != null) saveAreas[f.id] = f.areaHa; });
    const parts = ids.map(id => ({ id, ha: knownFieldHa(farm, id, saveAreas) }));
    const missing = parts.filter(p => p.ha == null).map(p => p.id);
    if (missing.length) {
        hint.textContent = t('areaAutoMissing').replace('{fields}', missing.join(', '));
        return;
    }
    areaInput.value = parts.reduce((s, p) => s + p.ha, 0).toFixed(2);
    areaInput.dataset.auto = '1';
    if (ids.length > 1) hint.textContent = t('areaAutoSum').replace('{fields}', ids.join(' + '));
}

window.addNewFieldRow = function () {
    const farm = getAllFarms().find(f => f.id === currentFarmId);

    const tpl = document.createElement('template');
    tpl.innerHTML = buildFieldEditCard({}, { farm, isNew: true }).trim();
    const newRow = tpl.content.firstElementChild;

    fieldsBody.insertBefore(newRow, fieldsBody.lastElementChild);
    updateSplitHints();
    const numInput = newRow.querySelector('.field-number');
    if (numInput) numInput.focus();
};

// --- Field backups (backups/*.json) ---------------------------------------
// Written on entering and saving Edit season (and before a restore); only the
// newest FIELD_BACKUPS_KEPT stay, so the farm folder and its export don't grow
// forever. Settings -> danger zone can put one of them back.
const FIELD_BACKUPS_KEPT = 20;

function fieldBackupsDir(farm) {
    return path.join(appDataDir, farm.folderName, 'backups');
}

function writeFieldsBackup(farm, fieldsData, prefix) {
    try {
        const dir = fieldBackupsDir(farm);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const now = new Date();
        const stamp = now.toISOString().replace(/[:.]/g, '-');
        const file = path.join(dir, `${prefix}_backup-${stamp}.json`);
        fs.writeFileSync(file, JSON.stringify({ action: prefix, timestamp: now.toISOString(), fields: fieldsData }, null, 2), 'utf-8');
        listFieldBackups(farm).slice(FIELD_BACKUPS_KEPT).forEach(b => {
            try { fs.rmSync(b.file); } catch (e) { /* locked — try again next time */ }
        });
    } catch (err) {
        console.error('Could not write a fields backup:', err);
    }
}

// Newest first: [{ file, action, timestamp, count }]
function listFieldBackups(farm) {
    const dir = farm && farm.folderName ? fieldBackupsDir(farm) : null;
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => {
        const file = path.join(dir, n);
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
            return { file, action: data.action || '', timestamp: data.timestamp || fs.statSync(file).mtime.toISOString(), count: (data.fields || []).length };
        } catch (e) {
            return null;
        }
    }).filter(Boolean).sort((x, y) => y.timestamp.localeCompare(x.timestamp));
}

function renderFieldBackupChoice(farm) {
    const select = document.getElementById('fields-backup-select');
    const row = document.getElementById('fields-backup-row');
    if (!select || !row) return;
    const list = listFieldBackups(farm);
    row.hidden = !list.length;
    select.innerHTML = list.map(b => {
        const when = new Date(b.timestamp).toLocaleString(FIN_LOCALE(), { dateStyle: 'short', timeStyle: 'short' });
        return `<option value="${escapeHtml(b.file)}">${escapeHtml(when)} · ${escapeHtml(t('backupAction_' + b.action) || b.action)} · ${t('backupFields').replace('{n}', b.count)}</option>`;
    }).join('');
}

async function restoreFieldsBackup() {
    const farm = getCurrentFarm();
    const select = document.getElementById('fields-backup-select');
    if (!farm || !select || !select.value) return;
    let data;
    try { data = JSON.parse(fs.readFileSync(select.value, 'utf-8')); } catch (e) { return; }
    const settingsModalEl = document.getElementById('settings-modal');
    if (settingsModalEl) settingsModalEl.style.display = 'none';
    const ok = await showDialog({
        title: t('restoreFieldsTitle'),
        body: t('restoreFieldsBody').replace('{when}', select.options[select.selectedIndex].text),
        confirmText: t('restoreFieldsConfirm'),
        cancelText: t('cancel'),
        danger: true,
        icon: 'fa-clock-rotate-left'
    });
    if (!ok || !(await discardEditsIfConfirmed())) return;
    writeFieldsBackup(farm, farm.fields || [], 'pre-restore');
    farm.fields = Array.isArray(data.fields) ? data.fields : [];
    saveFarmData(farm);
    viewedSeason = farm.currentSeason || 1;
    renderSeasonView();
}

const restoreFieldsBtn = document.getElementById('restore-fields-btn');
if (restoreFieldsBtn) restoreFieldsBtn.addEventListener('click', () => restoreFieldsBackup());

// "Fields from game": fills the fields table from the savegame. Owned fields
// missing from the table are added (number + area); rows whose area is empty
// or came from the game get the game's area (Precision Farming's field area,
// summed for joined numbers like "12-13"); a row whose planned crop is what's
// growing in the game is marked sown. A hand-typed area stays — it overrides.
// The planned crop itself is never touched: planning is the point.
async function loadFieldsFromGame() {
    const allFarms = getAllFarms();
    const farm = allFarms.find(f => f.id === currentFarmId);
    if (!farm || isEditMode) return;
    useSaveFarm(farm);
    const save = readSaveFields(farm);
    if (!save.ok) { await showNotice(t('loadFieldsTitle'), t('loadFieldsNoSave'), true); return; }

    const byId = {};
    save.fields.forEach(f => { byId[f.id] = f; });
    const usePfArea = modEnabled('precisionFarming');
    const partsOf = num => String(num || '').split(/[^0-9]+/).filter(Boolean).map(s => String(parseInt(s, 10)));
    const counts = {};
    (farm.fields || []).forEach(f => { const k = String(f.number || '').trim(); counts[k] = (counts[k] || 0) + 1; });

    const covered = new Set();
    let added = 0, areas = 0, sown = 0, keptManual = 0;
    writeFieldsBackup(farm, farm.fields || [], 'pre-import');
    (farm.fields || []).forEach(field => {
        const ids = partsOf(field.number);
        ids.forEach(id => covered.add(id));
        const games = ids.map(id => byId[id]).filter(Boolean);
        if (!games.length || games.length !== ids.length) return;
        // Area: whole (not split) rows only — the game knows the plot, not your split.
        const key = String(field.number || '').trim();
        const gameHa = usePfArea && games.every(g => g.areaHa != null) ? games.reduce((s, g) => s + g.areaHa, 0) : null;
        if (gameHa != null && counts[key] === 1) {
            const cur = parseFloat(field.area) || 0;
            if (!cur || field.areaSource === 'game') {
                if (Math.abs(cur - gameHa) > 0.005 || field.areaSource !== 'game') { field.area = gameHa.toFixed(2); field.areaSource = 'game'; areas++; }
            } else if (Math.abs(cur - gameHa) > 0.005) {
                keptManual++;
            }
        }
        // Sown: the planned crop is what's growing there in the game.
        if (field.crop && field.state !== 'Planted' && games.every(g => g.sown && cropOrderKey(saveFruitToCropKey(g.fruitType)) === cropOrderKey(field.crop))) {
            field.state = 'Planted';
            syncSowStep(field);
            sown++;
        }
    });
    save.fields.forEach(g => {
        if (covered.has(String(g.id))) return;
        farm.fields = farm.fields || [];
        farm.fields.push({
            number: String(g.id),
            area: usePfArea && g.areaHa != null ? g.areaHa.toFixed(2) : '0',
            areaSource: usePfArea && g.areaHa != null ? 'game' : undefined,
            crop: '', sowingMonth: '', state: 'To Plant', tillage: null,
            catchCrop: '', catchSowingMonth: '', rolling: false, cuts: [], manure: false, fertilizer: false,
            id: newFieldId()
        });
        added++;
    });
    syncWeedsFromSave(farm);
    saveFarmData(farm);
    renderSeasonView();
    const msg = t('loadFieldsDone').replace('{a}', added).replace('{h}', areas).replace('{s}', sown)
        + (keptManual ? ' ' + t('loadFieldsKeptManual').replace('{n}', keptManual) : '');
    await showNotice(t('loadFieldsTitle'), msg);
}

const loadFieldsBtn = document.getElementById('load-fields-btn');
if (loadFieldsBtn) loadFieldsBtn.addEventListener('click', () => loadFieldsFromGame());

// Lease (dzierżawa) from an edit card: { since, seasons, then } or null.
// "since" is the season it was first marked leased — kept across edits.
function readLeaseInputs(row, farm) {
    const on = row.querySelector('.field-lease');
    if (!on || !on.checked) return null;
    let prev = null;
    try { prev = JSON.parse(row.dataset.extra || '{}').lease || null; } catch (e) { /* none */ }
    const seasons = parseInt(row.querySelector('.field-lease-seasons').value, 10);
    const out = {
        since: prev && prev.since ? prev.since : (farm.currentSeason || 1),
        seasons: seasons > 0 ? seasons : null,
        then: row.querySelector('.field-lease-then').value === 'buy' ? 'buy' : 'return'
    };
    // A lease read from Field Leasing keeps the game's numbers (next sync refreshes them).
    if (prev && prev.source === 'game') ['source', 'months', 'minMonths', 'monthlyFee'].forEach(k => { out[k] = prev[k]; });
    return out;
}

// Field Leasing (FS25_FieldLeasing): <savegame>/fieldLeasingAgreements.xml
//   <fieldLeasingAgreements priceMultiplier="%" minDuration="months">
//     <fieldLeaseAgreement farmlandId farmId price duration="months so far"/>
// Monthly fee = price × priceMultiplier / 100 / 12 (FieldLeasingManager:
// getPriceMultiplier); the lease can't be ended before minDuration months.
// -> { minMonths, byFarmland: { id: { months, monthlyFee } } } for SAVE_FARM_ID.
function parseFieldLeasing(xml) {
    const root = (xml.match(/<fieldLeasingAgreements\b[^>]*>/) || [''])[0];
    const num = (tag, name) => parseFloat((tag.match(new RegExp('\\s' + name + '="([^"]*)"')) || [])[1]);
    const mult = num(root, 'priceMultiplier');
    const out = { minMonths: num(root, 'minDuration') || 12, byFarmland: {} };
    for (const m of xml.matchAll(/<fieldLeaseAgreement\s[^>]*>/g)) {
        if (String(num(m[0], 'farmId')) !== SAVE_FARM_ID) continue;
        const id = String(num(m[0], 'farmlandId'));
        out.byFarmland[id] = {
            months: num(m[0], 'duration') || 0,
            monthlyFee: (num(m[0], 'price') || 0) * ((isNaN(mult) ? 1 : mult) / 100) / 12
        };
    }
    return out;
}

// Marks planner fields whose plots are leased in the game (any of the plots
// of a joined number like "12-13"); a lease that came from the game and ended
// there is cleared. Leases you typed in yourself stay. Returns true if changed.
function syncLeasesFromSave(farm) {
    if (!farm.saveGamePath || !modEnabled('fieldLeasing')) return false;
    let leasing;
    try {
        leasing = parseFieldLeasing(fs.readFileSync(path.join(path.dirname(farm.saveGamePath), 'fieldLeasingAgreements.xml'), 'utf-8'));
    } catch (e) {
        return false;
    }
    let changed = false;
    (farm.fields || []).forEach(field => {
        const ids = String(field.number || '').split(/[^0-9]+/).filter(Boolean).map(s => String(parseInt(s, 10)));
        const leased = ids.map(id => leasing.byFarmland[id]).filter(Boolean);
        const prev = field.lease || null;
        let next = prev;
        if (leased.length) {
            next = {
                since: prev && prev.since ? prev.since : (farm.currentSeason || 1),
                seasons: prev ? prev.seasons || null : null,
                then: prev ? prev.then || 'return' : 'return',
                source: 'game',
                months: Math.max(...leased.map(l => l.months)),
                minMonths: leasing.minMonths,
                monthlyFee: Math.round(leased.reduce((s, l) => s + l.monthlyFee, 0))
            };
        } else if (prev && prev.source === 'game') {
            next = null;
        }
        if (JSON.stringify(next) !== JSON.stringify(prev)) { field.lease = next; changed = true; }
    });
    return changed;
}

// Table badge: "Lease 2/5" — season of the lease out of its length; red with
// what to do (buy / give back) once the term is reached.
function leaseBadgeHtml(field, seasonNum) {
    const lease = field.lease;
    if (!lease) return '';
    if (lease.source === 'game') {
        const months = parseInt(lease.months, 10) || 0;
        const min = parseInt(lease.minMonths, 10) || 0;
        const left = Math.max(0, min - months);
        const fee = finMoney(parseFloat(lease.monthlyFee) || 0);
        const title = t('leaseGameHint').replace('{fee}', fee) + ' ' + (left ? t('leaseGameMinLeft').replace('{n}', left) : t('leaseGameCanEnd'));
        return `<span class="lease-caption${left ? '' : ' is-free'}" title="${escapeHtml(title)}">${t('leaseGameBadge').replace('{n}', months).replace('{s}', Math.floor(months / 12) + 1)}</span>`;
    }
    const n = Math.max(1, seasonNum - (lease.since || seasonNum) + 1);
    const over = lease.seasons && n >= lease.seasons;
    const text = lease.seasons ? t('leaseBadge').replace('{n}', n).replace('{m}', lease.seasons) : t('leaseBadgeOpen').replace('{n}', n);
    const title = over ? t(lease.then === 'buy' ? 'leaseEndBuy' : 'leaseEndReturn') : t('leaseBadgeHint').replace('{s}', lease.since || seasonNum);
    return `<span class="lease-caption${over ? ' is-over' : ''}" title="${title}">${text}</span>`;
}

// Reads the edit-mode table back into field objects. Rows that have data but
// no field number come back in missingNumber (their number inputs) instead of
// being silently dropped.
function collectEditedFields(farm) {
    const fields = [];
    const fieldSizes = { ...(farm.fieldSizes || {}) };
    const missingNumber = [];

    fieldsBody.querySelectorAll('tr').forEach(row => {
        const numInput = row.querySelector('.field-number');
        if (!numInput) return;
        if (!numInput.value.trim()) {
            // A row with something filled in but no field number would be
            // dropped on save — report it instead of losing it silently.
            const cropSel = row.querySelector('.field-crop');
            const areaInput = row.querySelector('.field-area');
            if ((cropSel && cropSel.value) || (areaInput && areaInput.value.trim())) missingNumber.push(numInput);
            return;
        }
        let rawArea = row.querySelector('.field-area').value || "0";
        const parsedArea = parseDecimal(rawArea);
        rawArea = isNaN(parsedArea) ? '0' : String(parsedArea);
        // An area typed by hand overrides the one from the game.
        const areaInput = row.querySelector('.field-area');
        const areaEdited = areaInput && areaInput.dataset.orig !== undefined && areaInput.value !== areaInput.dataset.orig;

        const checkbox = row.querySelector('.field-state');
        const stateValue = (checkbox && checkbox.checked) ? "Planted" : "To Plant";

        const limeChip = row.querySelector('.treatment-chip--lime');
        const plowedChip = row.querySelector('.tillage-switch-option--plowed');
        const noTillChip = row.querySelector('.tillage-switch-option--notill');

        let tillage = null;
        if (plowedChip && plowedChip.classList.contains('is-active')) tillage = 'plowed';
        else if (noTillChip && noTillChip.classList.contains('is-active')) tillage = 'noTill';

        // If the lime chip is on (active or still showing the red
        // warning), keep whichever season/pH it was originally
        // applied at — don't reset the clock just because the
        // season got saved. Only a fresh off->on click resets both
        // to "now, ideal pH".
        let limeAppliedSeason = null;
        let limePh = null;
        if (limeChip && (limeChip.classList.contains('is-active') || limeChip.classList.contains('is-warning'))) {
            const original = limeChip.dataset.limeSeason ? parseInt(limeChip.dataset.limeSeason) : null;
            const isFresh = original === null || isNaN(original);
            limeAppliedSeason = isFresh ? (farm.currentSeason || 1) : original;
            // dataset.limePh was stamped from resolveLimePh() at render time, so
            // it's already correct even for a field that predates this pH model.
            const originalPh = limeChip.dataset.limePh !== '' ? parseFloat(limeChip.dataset.limePh) : null;
            limePh = isFresh ? LIME_PH_IDEAL : (originalPh !== null && !isNaN(originalPh) ? originalPh : LIME_PH_IDEAL);
        }

        const catchCropSelect = row.querySelector('.field-catch-crop');
        const catchCrop = catchCropSelect ? catchCropSelect.value : '';

        fields.push({
            number: numInput.value,
            area: rawArea,
            crop: row.querySelector('.field-crop').value,
            sowingMonth: row.querySelector('.field-sow').value,
            catchCrop: catchCrop,
            catchSowingMonth: catchCrop ? row.querySelector('.field-catch-sow').value : '',
            state: stateValue,
            tillage: tillage,
            limeAppliedSeason: limeAppliedSeason,
            limePh: limePh,
            // Manure/fertilizer toggles moved to the per-field fertilization
            // plan; the edit card no longer shows them, so just carry
            // through whatever was already on the field when edit mode
            // opened (stamped onto the row as data attributes).
            cuts: (() => { try { return JSON.parse(row.dataset.cuts || '[]'); } catch { return []; } })(),
            manure: row.dataset.manure === '1',
            fertilizer: row.dataset.fertilizer === '1',
            ...(() => { try { return JSON.parse(row.dataset.extra || '{}'); } catch { return {}; } })(),
            ...(areaEdited ? { areaSource: 'manual' } : {}),
            lease: readLeaseInputs(row, farm)
        });
        const added = fields[fields.length - 1];
        if (!added.id) added.id = newFieldId();
        const rotation = readRotationInputs(row, farm, added.rotation);
        if (rotation) added.rotation = rotation;
        else delete added.rotation;

        const sizeInput = row.querySelector('.field-size-input');
        if (sizeInput && sizeInput.value) {
            const parsedSize = parseDecimal(sizeInput.value);
            if (!isNaN(parsedSize)) fieldSizes[numInput.value.trim()] = parsedSize;
        }
    });
    return { fields, fieldSizes, missingNumber };
}

// JSON of the edit table as it was right after entering edit mode — Cancel and
// leaving the planner only ask for confirmation when the table differs from it.
let editSnapshot = null;

function editTableSnapshot(farm) {
    const { fields, fieldSizes } = collectEditedFields(farm);
    return JSON.stringify({ fields, fieldSizes });
}

function setEditModeUi(on) {
    isEditMode = on;
    if (editSeasonBtn) {
        const label = editSeasonBtn.querySelector('.edit-main-label');
        const icon = editSeasonBtn.querySelector('i');
        if (label) {
            label.dataset.i18n = on ? 'saveChanges' : 'edit';
            label.textContent = t(label.dataset.i18n);
        }
        if (icon) icon.className = 'fa-solid ' + (on ? 'fa-check' : 'fa-pen');
        editSeasonBtn.classList.toggle('is-saving', on);
    }
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.hidden = !on;
    const loadBtn = document.getElementById('load-fields-btn');
    if (loadBtn && on) loadBtn.hidden = true;
    // Starting a new season mid-edit would throw the edits away.
    if (newSeasonBtn) newSeasonBtn.style.display = on ? 'none' : '';
    // Edit lists every field, so the search steps aside until it's done.
    const searchWrap = document.getElementById('fields-search-wrap');
    if (searchWrap) searchWrap.hidden = on;
    if (!on) editSnapshot = null;
    // The Today panel stays out of the way while editing.
    if (typeof renderTodayPanel === 'function') renderTodayPanel();
    document.querySelectorAll('.season-nav-btn').forEach(b => {
        const reachable = b.id === 'prev-season-btn' ? viewedSeason > 1 : viewedSeason < ((getCurrentFarm() || {}).currentSeason || 1);
        b.disabled = on || !reachable;
        b.title = on ? t('seasonNavLocked') : '';
    });
}

// Leaves edit mode without saving. Asks first when something was changed.
// Resolves false if the user chose to keep editing.
async function discardEditsIfConfirmed() {
    if (!isEditMode) return true;
    const farm = getCurrentFarm();
    const dirty = farm && editSnapshot !== null && editTableSnapshot(farm) !== editSnapshot;
    if (dirty) {
        const ok = await showDialog({
            title: t('discardEditsTitle'),
            body: t('discardEditsBody'),
            confirmText: t('discardEditsConfirm'),
            cancelText: t('discardEditsKeep'),
            danger: true,
            icon: 'fa-triangle-exclamation'
        });
        if (!ok) return false;
    }
    setEditModeUi(false);
    renderSeasonView();
    return true;
}

if (editSeasonBtn) {
    editSeasonBtn.addEventListener('click', () => {
        if (!currentFarmId) return;

        const allFarms = getAllFarms();
        const idx = allFarms.findIndex(f => f.id === currentFarmId);
        if (idx === -1) return;
        const farm = allFarms[idx];

        const createBackup = (fieldsData, prefix) => writeFieldsBackup(farm, fieldsData, prefix);

        if (isEditMode) {
            // Leaving edit mode: save.

            const { fields: newFields, fieldSizes: newFieldSizes, missingNumber } = collectEditedFields(allFarms[idx]);
            fieldsBody.querySelectorAll('.field-number.is-invalid').forEach(el => el.classList.remove('is-invalid'));
            if (missingNumber.length) {
                missingNumber.forEach(el => el.classList.add('is-invalid'));
                missingNumber[0].focus();
                showNotice(t('missingFieldNumberTitle'), t('missingFieldNumberBody'), true);
                return;
            }

            // 1. Store the edited fields on the farm.
            migrateFieldKeys(allFarms[idx], allFarms[idx].fields || [], newFields);
            allFarms[idx].fields = newFields;
            allFarms[idx].fieldSizes = newFieldSizes;
            saveFarmData(allFarms[idx]);

            // 2. Back up the fields as they are after the edit.
            createBackup(newFields, "post-edit");

            setEditModeUi(false);
            renderSeasonView();

        } else {
            // Entering edit mode.

            // Back up the fields as they are now, so a botched edit can be undone
            // from the copy made just before it.
            createBackup(farm.fields || [], "pre-edit");

            renderEditTableWithDropdowns(farm.fields || []);
            setEditModeUi(true);
            editSnapshot = editTableSnapshot(farm);
        }
    });
}

const cancelEditBtn = document.getElementById('cancel-edit-btn');
if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => { discardEditsIfConfirmed(); });
if (fieldsBody) fieldsBody.addEventListener('input', e => {
    if (e.target.classList && e.target.classList.contains('field-number')) e.target.classList.remove('is-invalid');
});
