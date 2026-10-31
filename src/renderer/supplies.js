// =============================================================
// SUPPLIES (Farm Hub → "Supplies" / Zaopatrzenie): seed, fertilizer and lime
// per field, the per-field fertilization plan and the supply-rate model
// behind them (seed / N / lime rates, soil mixes, overrides in Settings).
// =============================================================
// A classic <script> loaded before renderer.js (see index.html), like
// feed.js: only constants, state, function declarations and listeners that
// act on click at the top level. fs, path, t(), getCurrentFarm(),
// NITROGEN_BY_SOIL (read from data/ in renderer.js)… are resolved when a
// function runs, never at load time.

// Zaopatrzenie: exactly two tables, both read farm.fields[] directly (no
// savegame source toggle) — Seeds, and a Fertilizer table merging what used
// to be three separate tables (mineral / natural-from-plan / organic
// equivalence) into one row per field, driven by that field's own
// fertilization plan. Fields without a saved plan get a "fill in the plan"
// call-to-action instead of a guessed number. The "Adjust rates" drawer lives
// in Farm Settings now (see renderSettingsSupplyAdjust) — not rendered here.
function renderSuppliesPanel(titleEl, bodyEl, modalEl) {
    titleEl.textContent = t('suppliesTitle');

    const farm = getAllFarms().find(f => f.id === currentFarmId);
    if (!farm) { bodyEl.innerHTML = `<p class="hub-panel-note">${t('suppliesNoCrops')}</p>`; return; }

    const rates = getSupplyRates();
    const season = farm.currentSeason || 1;
    const seed = buildSuppliesSeedRows(farm, rates);
    const fert = buildSuppliesFertRows(farm, rates);

    const fmtL = n => `${Math.round(n).toLocaleString(FIN_LOCALE())} l`;
    const fmtKg = n => `${Math.round(n).toLocaleString(FIN_LOCALE())} kg`;
    const num = n => Math.round(n).toLocaleString(FIN_LOCALE());

    const plannedArea = (farm.fields || []).reduce((s, f) => {
        const area = parseFloat(f.area) || 0;
        return (f.crop && area > 0) ? s + area : s;
    }, 0);

    let html = `<p class="supply-intro">${t('suppliesIntro').replace('{n}', season)}</p>
        <p class="details-category"><span>${t('suppliesPlannedArea')}</span><span class="details-category-value">${plannedArea.toFixed(2)} ha</span></p>
        <p class="details-category"><span>${t('suppliesFieldsToSow')}</span><span class="details-category-value">${seed.rows.length}</span></p>`;

    if (!seed.rows.length && !fert.rows.length) {
        bodyEl.innerHTML = html + `<p class="hub-panel-note">${t('suppliesNoCrops')}</p>`;
        return;
    }

    // --- Seeds --- one row per field still to sow.
    html += `<div class="hub-panel-subtitle">${t('suppliesSeeds')}</div>`;
    if (seed.rows.length) {
        html += `<table class="data-table supply-table"><thead><tr>
            <th>${t('suppliesColField')}</th><th>${t('suppliesColCrop')}</th><th>${t('suppliesColArea')}</th>
            <th>${t('suppliesColRate')}</th><th>${t('suppliesColNeed')}</th></tr></thead><tbody>`;
        seed.rows.forEach(r => {
            const flag = r.known ? '' : ` <span class="supply-flag" title="${t('suppliesUnknownRate').replace('{v}', r.rate)}">?</span>`;
            html += `<tr><td>${r.number}</td><td>${translateCropName(r.crop)}${flag}${catchTag(r)}</td>
                <td>${r.area.toFixed(2)} ha</td>
                <td>${num(r.rate)} ${t('suppliesSeedRateUnit')}</td>
                <td>${fmtL(r.buffered)}</td></tr>`;
        });
        html += `</tbody><tfoot><tr class="supply-total-row">
            <td colspan="4">${t('suppliesTotal')}</td><td>${fmtL(seed.total)}${marketCostHtml(farm, MARKET_INPUT_FILLTYPES.seed, seed.total)}</td></tr></tfoot></table>`;
    } else {
        html += `<p class="hub-panel-note">${t('suppliesAllSown')}</p>`;
    }

    // --- Fertilizer --- one row per field due for fertilizing, sourced from
    // that field's own "Nawożenie" plan: target / existing / natural / mineral
    // N all in one row, natural N also shown as manure/slurry/digestate
    // volume. A field with no saved plan gets a CTA instead of a guess.
    html += `<div class="hub-panel-subtitle">${t('suppliesFertilizer')}</div>`;
    if (fert.rows.length) {
        const orgCell = (r) => r.orgRate > 0
            ? `${num(r.orgRate)} ${t('suppliesNRateUnit')}<span class="supply-sub">${fmtKg(r.orgAbs)} N</span>
               <span class="supply-sub">${t('suppliesOrgManure')} ${fmtL(r.orgVolAbs.manure)}</span>
               <span class="supply-sub">${t('suppliesOrgSlurry')} ${fmtL(r.orgVolAbs.slurry)}</span>
               <span class="supply-sub">${t('suppliesOrgDigestate')} ${fmtL(r.orgVolAbs.digestate)}</span>`
            : '–';
        html += `<table class="data-table supply-table"><thead><tr>
            <th>${t('suppliesColField')}</th><th>${t('suppliesColCrop')}</th><th>${t('suppliesColSoil')}</th><th>${t('suppliesColArea')}</th>
            <th>${t('suppliesColTargetN')}</th><th>${t('suppliesColExistingN')}</th><th>${t('suppliesColOrgN')}</th><th>${t('suppliesColMineralN')}</th>
            </tr></thead><tbody>`;
        fert.rows.forEach(r => {
            if (!r.hasPlan) {
                html += `<tr><td>${r.number}</td><td>${translateCropName(r.crop)}</td><td colspan="2">${r.area.toFixed(2)} ha</td>
                    <td colspan="4" class="supply-fillplan-cell">
                        <button type="button" class="supply-fillplan-btn" title="${t('suppliesFillPlanHint')}"
                            ${fertPlanOpenAttrs(r.planKey, r.soilKey, r.displayNumber, r.crop, r.area)}>
                            ${t('suppliesFillPlanCta')}
                        </button>
                    </td></tr>`;
                return;
            }
            html += `<tr><td>${r.number}</td><td>${translateCropName(r.crop)}</td>
                <td class="supply-soil-cell">${soilMixLabel(r.soilMix)}</td>
                <td>${r.area.toFixed(2)} ha</td>
                <td>${num(r.targetRate)} ${t('suppliesNRateUnit')}<span class="supply-sub">${fmtKg(r.targetAbs)}</span></td>
                <td>${r.existingRate > 0 ? `${num(r.existingRate)} ${t('suppliesNRateUnit')}<span class="supply-sub">${fmtKg(r.existingAbs)}</span>` : '–'}</td>
                <td>${orgCell(r)}</td>
                <td>${fmtL(r.mineralLAbs)}<span class="supply-sub">${fmtKg(r.mineralAbs)} N</span></td></tr>`;
        });
        html += `</tbody><tfoot><tr class="supply-total-row">
            <td colspan="4">${t('suppliesTotal')}</td>
            <td>${fmtKg(fert.totals.targetAbs)} N</td>
            <td>${fmtKg(fert.totals.existingAbs)} N</td>
            <td>${fmtKg(fert.totals.orgAbs)} N<span class="supply-sub">${t('suppliesOrgManure')} ${fmtL(fert.totals.orgVolAbs.manure)}</span><span class="supply-sub">${t('suppliesOrgSlurry')} ${fmtL(fert.totals.orgVolAbs.slurry)}</span><span class="supply-sub">${t('suppliesOrgDigestate')} ${fmtL(fert.totals.orgVolAbs.digestate)}</span></td>
            <td>${fmtL(fert.totals.mineralLAbs)}<span class="supply-sub">${fmtKg(fert.totals.mineralAbs)} N</span>${marketCostHtml(farm, MARKET_INPUT_FILLTYPES.fertilizer, fert.totals.mineralLAbs)}</td>
            </tr></tfoot></table>`;
        if (fert.missingPlanCount > 0) {
            html += `<p class="hub-panel-note">${t('suppliesNoPlanNote').replace('{n}', fert.missingPlanCount)}</p>`;
        }
        const density = supplyRate(rates, 'nDensity');
        html += `<p class="hub-panel-note">${t('suppliesNDensityNote').replace('{d}', density)}</p>`;
        html += `<p class="hub-panel-note">${t('suppliesSoilHint')}</p>`;
    } else {
        html += `<p class="hub-panel-note">${t('suppliesNoFert')}</p>`;
    }

    // --- Lime --- fields below their soil's optimum pH. With Precision
    // Farming in the save: the litres to bring every part of the field up
    // (pH map); otherwise the app's own estimate for fields it marks as
    // needing lime (one application per soil type, limeRateForSoil).
    const lime = buildSuppliesLimeRows(farm, rates);
    html += `<div class="hub-panel-subtitle">${t('suppliesLime')}</div>`;
    if (lime.rows.length) {
        html += `<table class="data-table supply-table"><thead><tr>
            <th>${t('suppliesColField')}</th><th>${t('suppliesColArea')}</th><th>${t('suppliesLimePh')}</th><th>${t('suppliesLimeBuy')}</th>
            </tr></thead><tbody>`;
        lime.rows.forEach(r => {
            html += `<tr><td>${escapeHtml(r.number)}</td><td>${r.area.toFixed(2)} ha</td>
                <td>${r.fromGame ? `${r.ph.toFixed(2)} → ${r.optimal.toFixed(2)}` : t('suppliesLimeEstimate')}</td>
                <td>${fmtL(r.buffered)}</td></tr>`;
        });
        html += `</tbody><tfoot><tr class="supply-total-row"><td colspan="3">${t('suppliesTotal')}</td><td>${fmtL(lime.total)}${marketCostHtml(farm, MARKET_INPUT_FILLTYPES.lime, lime.total)}</td></tr></tfoot></table>`;
    } else {
        html += `<p class="hub-panel-note">${t('suppliesLimeNone')}</p>`;
    }

    html += `<p class="hub-panel-note">${t('suppliesBufferNote').replace('{p}', rates.bufferPct)}</p>`;
    if (getFarmMarket(farm)) html += `<p class="hub-panel-note">${t('suppliesCostNote')}</p>`;

    bodyEl.innerHTML = html;
}

// Lime to buy this season, per planner field (buffer included).
function buildSuppliesLimeRows(farm, rates) {
    const buffer = 1 + (parseFloat(rates.bufferPct) || 0) / 100;
    const rows = [];
    const seen = new Set();
    (farm.fields || []).forEach((f, i) => {
        const key = (f.number || '').toString().trim();
        if (!key || seen.has(key)) return;   // split field: one row for the whole field
        seen.add(key);
        const pf = pfFieldData(key);
        const area = parseFloat((farm.fieldSizes || {})[key]) || (farm.fields || []).filter(x => (x.number || '').toString().trim() === key).reduce((s, x) => s + (parseFloat(x.area) || 0), 0);
        if (pf && pf.ph) {
            if (pf.ph.limeL < 1) return;
            rows.push({ number: key, area, fromGame: true, ph: pf.ph.avg, optimal: pf.ph.optimal, buffered: pf.ph.limeL * buffer });
            return;
        }
        const { status } = getLimeStatus(f, i, farm.currentSeason || 1, rates);
        if (status === 'active' || !(area > 0)) return;
        const litres = fieldLimeRate(getFieldSoilMix(fertPlanSoilKey(f, i), rates)) * area;
        rows.push({ number: key, area, fromGame: false, buffered: litres * buffer });
    });
    return { rows, total: rows.reduce((s, r) => s + r.buffered, 0) };
}

// Per-field fertilization plan — opened from the "Plan" button in each row of
// the season table (one button per row, so a split field with two crops gets a
// separate plan per crop). Reuses the hub-panel modal.
//   N target      = fieldNRate() — crop × the field's soil mix, from nitrogen-by-soil.json
//   Natural (org) = what the person types this field's manure/slurry covers, kg N/ha
//   Mineral       = the rest of the target, as kg N and as litres of product (via nDensity)
// The natural figure is saved to rates.fertPlan, keyed "<fieldNumber>::<crop>"
// (soil mix is still looked up by the plain field number, shared across the split).
function fertPlanSoilKey(field, i) {
    return (field.number || '').toString().trim() || ('idx-' + i);
}
function fertPlanKey(field, i) {
    return fertPlanSoilKey(field, i) + '::' + (field.crop || '');
}

// Locates the exact farm.fields[] row a plan key refers to (same identity
// fertPlanKey used to build the key from), so the manure/fertilizer checkmarks
// in the plan modal can read and write the real field object.
function findFertPlanField(farm, planKey) {
    const fields = (farm && farm.fields) || [];
    for (let i = 0; i < fields.length; i++) {
        if (fertPlanKey(fields[i], i) === planKey) return { field: fields[i], index: i };
    }
    return null;
}

function computeFieldFertPlan(planKey, soilKey, cropKey, area, rates) {
    const density = supplyRate(rates, 'nDensity');
    const buffer = 1 + (parseFloat(rates.bufferPct) || 0) / 100;
    const soilMix = getFieldSoilMix(soilKey, rates);
    const targetRate = fieldNRate(cropKey, soilMix, rates);
    const saved = rates.fertPlan && rates.fertPlan[planKey];
    const num = (v) => (saved && saved[v] > 0 && !isNaN(saved[v])) ? parseFloat(saved[v]) : 0;
    // N already in/on the field: what you typed, else PF's nitrogen map.
    const pfN = pfFieldData(soilKey);
    const existingFromGame = !(saved && saved.existingN > 0) && !!(pfN && pfN.nitrogen);
    const existingRate = existingFromGame ? Math.round(pfN.nitrogen.avg) : num('existingN');
    const orgRate = num('orgN');             // natural fertilizer this plan adds
    const mineralRate = Math.max(0, targetRate - existingRate - orgRate);

    // How many litres of manure / slurry / digestate the entered natural-N dose
    // is equivalent to, at this farm's N content per litre (Supplies rates).
    const mN = supplyRate(rates, 'manureN');
    const sN = supplyRate(rates, 'slurryN');
    const dN = supplyRate(rates, 'digestateN');
    const orgVol = { manure: orgRate / mN, slurry: orgRate / sN, digestate: orgRate / dN };

    return {
        density, buffer, soilMix, targetRate, existingRate, existingFromGame, orgRate, mineralRate, orgVol,
        mineralLitres: mineralRate / density,
        area, covered: (existingRate + orgRate) >= targetRate - 0.5
    };
}

// Data attributes for a button that opens a field's fertilization plan
// (handled by the one listener below — no data inside inline onclick).
function fertPlanOpenAttrs(planKey, soilKey, displayNumber, crop, area) {
    return `data-fertplan-open data-plan-key="${escapeHtml(planKey)}" data-soil-key="${escapeHtml(soilKey)}" data-number="${escapeHtml(displayNumber)}" data-crop="${escapeHtml(crop || '')}" data-area="${Number(area) || 0}"`;
}
document.addEventListener('click', e => {
    const btn = e.target.closest('[data-fertplan-open]');
    if (!btn) return;
    const d = btn.dataset;
    window.openFieldFertPlan(d.planKey, d.soilKey, d.number, d.crop, parseFloat(d.area) || 0);
});

window.openFieldFertPlan = function (planKey, soilKey, displayNumber, cropKey, area) {
    const titleEl = document.getElementById('fertplan-modal-title');
    const bodyEl = document.getElementById('fertplan-modal-body');
    if (!titleEl || !bodyEl || !hubPanelModal) return;

    renderFieldFertPlan(titleEl, bodyEl, planKey, soilKey, displayNumber, cropKey, parseFloat(area) || 0);

    openModal(hubPanelModal);
};

// Saves one figure of a field's plan (existingN / orgN, kg N/ha); empty or 0 clears it.
// Used by the plan window and the field view.
function setFertPlanValue(planKey, key, raw) {
    const r = getSupplyRates();
    if (!r.fertPlan) r.fertPlan = {};
    const entry = { ...(r.fertPlan[planKey] || {}) };
    const v = String(raw == null ? '' : raw).trim();
    const n = parseFloat(v);
    if (v === '' || isNaN(n) || n <= 0) delete entry[key];
    else entry[key] = n;
    if (Object.keys(entry).length === 0) delete r.fertPlan[planKey];
    else r.fertPlan[planKey] = entry;
    saveSupplyRates(r);
}

function renderFieldFertPlan(titleEl, bodyEl, planKey, soilKey, displayNumber, cropKey, area) {
    const rates = getSupplyRates();
    const d = computeFieldFertPlan(planKey, soilKey, cropKey, area, rates);
    const num = n => Math.round(n).toLocaleString(FIN_LOCALE());
    const kgN = t('suppliesNRateUnit');
    const match = findFertPlanField(getCurrentFarm(), planKey);
    const fieldRow = match ? match.field : null;

    titleEl.textContent = `${t('fertPlanTitle')} — ${t('suppliesColField')} ${displayNumber} · ${translateCropName(cropKey)}`;

    const existingVal = d.existingRate > 0 && !d.existingFromGame ? d.existingRate : '';
    const existingPlaceholder = d.existingFromGame ? d.existingRate : 0;
    const orgVal = d.orgRate > 0 ? d.orgRate : '';
    const status = d.covered
        ? `<span class="fertplan-status is-covered">${t('fertPlanCovered')}</span>`
        : `<span class="fertplan-status">${t('fertPlanMineralAdd').replace('{n}', num(d.mineralRate))}</span>`;

    bodyEl.innerHTML = `
        <p class="supply-intro">${t('fertPlanIntro')}</p>
        <p class="details-category"><span>${t('suppliesColSoil')}</span><span class="details-category-value">${soilMixLabel(d.soilMix)}</span></p>
        <p class="details-category"><span>${t('suppliesColArea')}</span><span class="details-category-value">${d.area.toFixed(2)} ha</span></p>
        <p class="details-category"><span>${t('fertPlanColTarget')}</span><span class="details-category-value">${num(d.targetRate)} ${kgN} · ${num(d.targetRate * d.area)} kg</span></p>
        <label class="fertplan-field">
            <span>${t('fertPlanColExisting')}</span>
            <span class="fertplan-input-wrap"><input type="number" min="0" step="5" class="fertplan-existing-input" value="${existingVal}" placeholder="${existingPlaceholder}"><span class="supply-unit">${kgN}</span></span>
            ${d.existingFromGame ? `<small class="fertplan-from-game">${t('fertPlanExistingFromGame')}</small>` : ''}
        </label>
        <label class="fertplan-field">
            <span>${t('fertPlanColOrg')}</span>
            <span class="fertplan-input-wrap"><input type="number" min="0" step="5" class="fertplan-org-input" value="${orgVal}" placeholder="0"><span class="supply-unit">${kgN}</span></span>
        </label>
        ${d.orgRate > 0 ? `<div class="fertplan-org-vol">
            <span class="fertplan-org-vol-hint">${t('fertPlanOrgVolHint')}</span>
            <span><span class="fertplan-org-vol-label">${t('suppliesOrgManure')}</span> ${num(d.orgVol.manure)} l/ha <span class="supply-sub">${num(d.orgVol.manure * d.area)} l</span></span>
            <span><span class="fertplan-org-vol-label">${t('suppliesOrgSlurry')}</span> ${num(d.orgVol.slurry)} l/ha <span class="supply-sub">${num(d.orgVol.slurry * d.area)} l</span></span>
            <span><span class="fertplan-org-vol-label">${t('suppliesOrgDigestate')}</span> ${num(d.orgVol.digestate)} l/ha <span class="supply-sub">${num(d.orgVol.digestate * d.area)} l</span></span>
        </div>` : ''}
        <p class="details-category"><span>${t('fertPlanColMineralN')}</span><span class="details-category-value">${num(d.mineralRate)} ${kgN} · ${num(d.mineralRate * d.area)} kg</span></p>
        <p class="details-category"><span>${t('fertPlanColMineralL')}</span><span class="details-category-value">${num(d.mineralLitres)} ${t('suppliesSeedRateUnit')} · ${num(d.mineralLitres * d.area * d.buffer)} l</span></p>
        <p class="details-category"><span>${t('fertPlanColStatus')}</span><span class="details-category-value">${status}</span></p>
        <p class="hub-panel-note">${t('fertPlanNote')}</p>
        <p class="hub-panel-note">${t('suppliesNDensityNote').replace('{d}', d.density)} · ${t('suppliesBufferNote').replace('{p}', rates.bufferPct)}</p>
        <div class="hub-panel-subtitle">${t('fertPlanTreatmentsTitle')}</div>
        <label class="fertplan-field fertplan-checkbox-field">
            <span>${t('fertPlanManureApplied')}</span>
            <input type="checkbox" class="fertplan-manure-check" ${fieldRow && fieldRow.manure ? 'checked' : ''}>
        </label>
        <label class="fertplan-field fertplan-checkbox-field">
            <span>${t('fertPlanFertilizerApplied')}</span>
            <input type="checkbox" class="fertplan-fertilizer-check" ${fieldRow && fieldRow.fertilizer ? 'checked' : ''}>
        </label>
        <p class="hub-panel-note">${t('fertPlanTreatmentsNote')}</p>
    `;

    const wireField = (selector, key) => {
        const el = bodyEl.querySelector(selector);
        if (!el) return;
        el.addEventListener('change', () => {
            setFertPlanValue(planKey, key, el.value);
            renderFieldFertPlan(titleEl, bodyEl, planKey, soilKey, displayNumber, cropKey, area);
        });
    };
    wireField('.fertplan-existing-input', 'existingN');
    wireField('.fertplan-org-input', 'orgN');

    // Manure/fertilizer are plain "applied this season" flags on the field
    // itself (used by the Supplies shopping list), not part of rates.fertPlan.
    const wireCheck = (selector, prop) => {
        const el = bodyEl.querySelector(selector);
        if (!el) return;
        el.addEventListener('change', () => {
            const farm = getCurrentFarm();
            const m = findFertPlanField(farm, planKey);
            if (!m) return;
            m.field[prop] = el.checked;
            saveFarmData(farm);
            // Refresh the table underneath so the N chip's empty /
            // rust / green state is already right when this modal closes.
            if (typeof renderSeasonView === 'function') renderSeasonView();
        });
    };
    wireCheck('.fertplan-manure-check', 'manure');
    wireCheck('.fertplan-fertilizer-check', 'fertilizer');
}

// Farm Settings → "Adjust rates" (relocated from the Zaopatrzenie hub panel).
// Follows the Settings modal's own batch-save convention: inputs here have no
// individual change listeners — saveSettingsBtn's handler reads their live
// values once, on SAVE & IMPORT. The one exception is the reset button, which
// has no natural "save & close" step of its own and so acts immediately.
// mode (PF/Basic) / basicFertRate / limeRate were dropped entirely (not just
// relocated) — their only consumers (the old lime table and the basic-mode
// fertilizer estimate) were removed from Zaopatrzenie, so they no longer
// drive anything visible.
function renderSettingsSupplyAdjust(rates, cropList) {
    let cropRows = '';
    cropList.forEach(c => {
        // Inputs hold only real overrides; the built-in default is the
        // placeholder, so saving the drawer never freezes defaults into
        // rates.crops (which would bypass the per-soil seed/N numbers).
        const o = rates.crops[c] || {};
        const seedDefault = defaultSeedRate(c) || SUPPLY_SEED_FALLBACK;
        const nDefault = SUPPLY_N_RATES[c] !== undefined ? SUPPLY_N_RATES[c] : SUPPLY_N_FALLBACK;
        const seed = (o.seed !== undefined && o.seed !== '') ? o.seed : '';
        const n = (o.n !== undefined && o.n !== '') ? o.n : '';
        cropRows += `<tr>
            <td>${translateCropName(c)}</td>
            <td><span class="supply-rate-cell"><input type="number" min="0" step="1" class="supply-rate-input" data-supply-crop="${c}" data-supply-field="seed" value="${seed}" placeholder="${seedDefault}"><span class="supply-unit">${t('suppliesSeedRateUnit')}</span></span></td>
            <td><span class="supply-rate-cell"><input type="number" min="0" step="1" class="supply-rate-input" data-supply-crop="${c}" data-supply-field="n" value="${n}" placeholder="${nDefault}"><span class="supply-unit">${t('suppliesNRateUnit')}</span></span></td>
        </tr>`;
    });

    return `
    <details class="supply-adjust">
        <summary>${t('suppliesAdjust')}</summary>
        <div class="supply-adjust-body">
            <label class="supply-opt"><input type="checkbox" id="supply-assume-fert" ${rates.assumeAllFertilized ? 'checked' : ''}><span>${t('suppliesAssumeAllFert')}</span></label>
            <div class="supply-opt-grid">
                <label>${t('suppliesBuffer')}<input type="number" min="0" step="1" id="supply-buffer" value="${rates.bufferPct}"></label>
                <label>${t('suppliesNDensity')}<input type="number" min="0.01" step="0.01" id="supply-n-density" value="${rates.nDensity}"></label>
                <label>${t('suppliesManureN')}<input type="number" min="0.0001" step="0.0005" id="supply-manure-n" value="${rates.manureN}"></label>
                <label>${t('suppliesSlurryN')}<input type="number" min="0.0001" step="0.0005" id="supply-slurry-n" value="${rates.slurryN}"></label>
                <label>${t('suppliesDigestateN')}<input type="number" min="0.0001" step="0.0005" id="supply-digestate-n" value="${rates.digestateN}"></label>
            </div>
            ${cropRows ? `<div class="hub-panel-subtitle">${t('suppliesPerCropRates')}</div>
            <table class="data-table supply-table supply-rate-table"><thead><tr>
                <th></th><th>${t('suppliesSeeds')}</th><th>${t('suppliesFertilizer')}</th>
            </tr></thead><tbody>${cropRows}</tbody></table>` : ''}
            <button type="button" id="supply-reset-rates" class="supply-reset-btn">${t('suppliesResetRates')}</button>
            <p class="hub-panel-note">${t('suppliesEstimateNote')}</p>
        </div>
    </details>`;
}

// Wires only the immediate-action reset button — every other input is read
// on demand by saveSettingsBtn's own click handler (see there), matching how
// the rest of the Settings modal already works.
function wireSettingsSupplyAdjust(container) {
    const resetBtn = container.querySelector('#supply-reset-rates');
    if (resetBtn) resetBtn.addEventListener('click', () => {
        const farm = getCurrentFarm();
        if (farm) { delete farm.supplyRates; saveFarmData(farm); }
        const cropList = [...new Set(((farm && farm.fields) || []).map(f => f.crop).filter(Boolean))].sort();
        container.innerHTML = renderSettingsSupplyAdjust(getSupplyRates(), cropList);
        wireSettingsSupplyAdjust(container);
    });
}

// --- Season supply calculator ("shopping list") -----------------------------
// Everything here is an editable estimate. Units match how Precision Farming
// meters inputs on the field: seed and lime in litres per hectare, fertilizer
// as kilograms of nitrogen (N) per hectare for a full season at high yield.
// The person overrides any value in the Supplies hub panel; overrides live in
// the farm (farm.supplyRates) and are merged over these tables.
const CONFIG_KEY_SUPPLY_RATES = 'farmer_planner_supply_rates';

// Litres of seed per hectare: the farm's map crop files (seeding
// litersPerSqm), else the base game's (data/default-agronomy.json); anything
// unknown falls back to SUPPLY_SEED_FALLBACK. Override per crop in the panel.
// For crops in SUPPLY_SEED_RATES_PF below, Precision Farming replaces the
// foliage rate in-game; per-field numbers come from fieldSeedRate.
function defaultSeedRate(crop) {
    return cropAgronomy(crop, 'seed');
}
const SUPPLY_SEED_FALLBACK = 150;

// The previous built-in seed table (foliage-only rates). The Adjust drawer used
// to save every default as an override, so a farm's supplyRates.crops can hold
// these frozen values — getSupplyRates drops a saved seed equal to them.
const LEGACY_SEED_DEFAULTS = {
    Wheat: 308, Barley: 265, Oat: 340, Rye: 123, Triticale: 164, Greenrye: 300,
    Canola: 150, Sunflower: 143, Soybean: 214, Maize: 53, Silagemaize: 26, Sorghum: 35,
    Millet: 110, Buckwheat: 500, Pea: 250, Beans: 144, Greenbean: 280,
    Potato: 3733, Beetroot: 40, Sugarbeet: 34, Carrot: 10, Parsnip: 10, Spinach: 10, Cotton: 50,
    Grass: 120, Alfalfa: 300, Clover: 300, Oilseedradish: 40
};

// Precision Farming variable seed rate: with PF the sowing machine uses these
// litres/ha instead of the foliage seeding rate. lha = [low, standard, high];
// auto = which of the three PF's automatic mode picks on each soil (the lowest
// rate reaching the best <soilType yields>). For a farm with a savegame they're
// read from PF itself and the map's own seedRateMap (readPfSeedRates, see
// PF_SEED_RATES); this table is only the fallback without a save — the base
// game crops from FS25_precisionFarming PrecisionFarming.xml (usages × 10000).
// Sugarbeet's 302 l/ha "low" is PF's own data (usage 0.03022), kept as the game uses it.
const PF_AUTO_STD = { loamySand: 2, sandyLoam: 1, loam: 0, siltyClay: 2 };
const SUPPLY_SEED_RATES_PF = {
    Wheat: { lha: [185, 308, 431], auto: PF_AUTO_STD },
    Barley: { lha: [192, 265, 337], auto: PF_AUTO_STD },
    Oat: { lha: [247, 340, 432], auto: PF_AUTO_STD },
    Canola: { lha: [33, 49, 66], auto: { loamySand: 1, sandyLoam: 1, loam: 0, siltyClay: 1 } },
    Maize: { lha: [42, 53, 64], auto: PF_AUTO_STD },
    Sunflower: { lha: [119, 143, 167], auto: PF_AUTO_STD },
    Soybean: { lha: [183, 214, 245], auto: PF_AUTO_STD },
    Sugarbeet: { lha: [302, 34, 38], auto: PF_AUTO_STD },
    Sorghum: { lha: [29, 35, 41], auto: PF_AUTO_STD },
    Carrot: { lha: [8.5, 10, 11.5], auto: PF_AUTO_STD },
    Beetroot: { lha: [35, 40, 44], auto: PF_AUTO_STD },
    Parsnip: { lha: [8.5, 10, 11.5], auto: PF_AUTO_STD },
    Pea: { lha: [200, 250, 300], auto: PF_AUTO_STD },
    Greenbean: { lha: [240, 280, 320], auto: PF_AUTO_STD },
    Spinach: { lha: [8.5, 10, 11.5], auto: PF_AUTO_STD },
    Oilseedradish: { lha: [30, 40, 50], auto: { loamySand: 0, sandyLoam: 0, loam: 0, siltyClay: 0 } }
};
// The open farm's PF seed rates (PF + its map), keyed by cropOrderKey; null =
// no savegame or nothing readable -> SUPPLY_SEED_RATES_PF.
let PF_SEED_RATES = null;

function pfSeedRateFor(crop) {
    if (PF_SEED_RATES) return PF_SEED_RATES[cropOrderKey(crop || '')] || null;
    return SUPPLY_SEED_RATES_PF[crop] || null;
}

// Kilograms of nitrogen per hectare for a full season — the flat baseline used
// only for the per-crop "N" box in the Adjust drawer (and if nitrogen-by-soil
// data is missing). These equal the PF targetLevel on Piaszczysty ił (100%-
// yield soil); the per-soil numbers live in nitrogen-by-soil.json. Legumes /
// catch crops that fix or need no N are 0.
const SUPPLY_N_RATES = {
    Wheat: 180, Barley: 140, Oat: 100, Rye: 180, Triticale: 180, Greenrye: 90,
    Canola: 180, Sunflower: 80, Maize: 160, Silagemaize: 160, Sorghum: 120,
    Millet: 180, Buckwheat: 180, Potato: 120, Beetroot: 120, Sugarbeet: 140, Carrot: 90,
    Parsnip: 120, Spinach: 160, Cotton: 100, Grass: 55, Greenbean: 110,
    Pea: 0, Beans: 50, Soybean: 0, Alfalfa: 180, Clover: 180, Oilseedradish: 0
};
const SUPPLY_N_FALLBACK = 150;

// Litres of harvest per hectare at 100%-yield-potential soil, full season —
// used by the Predicted yields panel and the feed planner. From the farm's
// map crop files (harvest litersPerSqm), else the base game's. No fallback
// constant for an unknown crop — callers show "unknown" instead of a guess.
function getCropYieldRate(crop) {
    return cropAgronomy(crop, 'yield');
}

function soilTypeList() { return NITROGEN_BY_SOIL.soilTypes || []; }

function soilLabel(s) {
    if (!s) return '';
    if (typeof s === 'string') s = soilTypeList().find(x => x.id === s) || { id: s, pl: s, en: s };
    return s[currentLang] || s.en || s.pl || s.id;
}

// The soil a field is assumed to be on when the user hasn't set a mix — the
// one closest to 100% yield potential (the neutral reference), else 'loam',
// else the middle of the list.
function defaultSoilId() {
    const list = soilTypeList();
    if (!list.length) return 'loam';
    const withYield = list.filter(s => typeof s.yieldPct === 'number');
    if (withYield.length) {
        return withYield.reduce((best, s) => Math.abs(s.yieldPct - 100) < Math.abs(best.yieldPct - 100) ? s : best).id;
    }
    return (list.find(s => s.id === 'loam') || list[Math.min(2, list.length - 1)]).id;
}

// kg N/ha for one crop on one soil type: a per-crop user override (flat across
// every soil) wins, then the data file's crop row, then the file's fallback
// row, then the global fallback number.
function getCropNRateForSoil(crop, soilId, rates) {
    const o = rates.crops && rates.crops[crop];
    if (o && o.n !== undefined && o.n !== '' && !isNaN(o.n)) return parseFloat(o.n);
    const row = NITROGEN_BY_SOIL.crops[crop];
    if (row && row[soilId] !== undefined && !isNaN(row[soilId])) return parseFloat(row[soilId]);
    const fb = NITROGEN_BY_SOIL.fallback;
    if (fb && fb[soilId] !== undefined && !isNaN(fb[soilId])) return parseFloat(fb[soilId]);
    return SUPPLY_N_FALLBACK;
}

// A field's soil mix as { soilId: percent }. Blank / unknown -> 100% default.
function getFieldSoilMix(key, rates) {
    const raw = rates.fieldSoil && rates.fieldSoil[key];
    if (raw && typeof raw === 'object') {
        const cleaned = {};
        let total = 0;
        Object.keys(raw).forEach(k => {
            const v = parseFloat(raw[k]);
            if (v > 0 && soilTypeList().some(s => s.id === k)) { cleaned[k] = v; total += v; }
        });
        if (total > 0) return cleaned;
    }
    return { [defaultSoilId()]: 100 };
}

// Share-weighted average kg N/ha across the field's soil mix.
function fieldNRate(crop, soilMix, rates) {
    const entries = Object.entries(soilMix).filter(([, p]) => p > 0);
    if (!entries.length) return getCropNRateForSoil(crop, defaultSoilId(), rates);
    const total = entries.reduce((s, [, p]) => s + p, 0);
    return entries.reduce((s, [id, p]) => s + (p / total) * getCropNRateForSoil(crop, id, rates), 0);
}

// Litres of seed per hectare for one field: a saved per-crop override wins;
// a crop with a PF seed-rate map gets the soil-mix-weighted rate PF's
// automatic mode would sow; anything else the flat per-crop table (or null).
function fieldSeedRate(crop, soilMix, rates) {
    const o = rates.crops[crop];
    if (o && o.seed !== undefined && o.seed !== '' && !isNaN(o.seed)) return parseFloat(o.seed);
    const pf = modEnabled('precisionFarming') ? pfSeedRateFor(crop) : null;
    if (!pf) return getCropSeedRate(crop, rates);
    const rateOn = id => pf.lha[pf.auto[id] !== undefined ? pf.auto[id] : 1];
    const entries = Object.entries(soilMix).filter(([, p]) => p > 0);
    if (!entries.length) return rateOn(defaultSoilId());
    const total = entries.reduce((s, [, p]) => s + p, 0);
    return entries.reduce((s, [id, p]) => s + (p / total) * rateOn(id), 0);
}

// Share-weighted average yield potential (0..~1.25) across the field's soil
// mix — the same NITROGEN_BY_SOIL.soilTypes[].yieldPct FS25 Precision Farming
// exposes as <soilTypes><yieldPotential>, used here for the first time as an
// actual yield multiplier (elsewhere it's only a display label). A crop's
// full-potential litres/ha times this factor = the yield ceiling for this
// field's soil, i.e. exactly "ideal N, ideal pH, no weeds".
function fieldYieldFactor(soilMix) {
    const entries = Object.entries(soilMix).filter(([, p]) => p > 0);
    const list = soilTypeList();
    const pctOf = id => {
        const s = list.find(x => x.id === id);
        return (s && typeof s.yieldPct === 'number') ? s.yieldPct / 100 : 1;
    };
    if (!entries.length) return pctOf(defaultSoilId());
    const total = entries.reduce((s, [, p]) => s + p, 0);
    return entries.reduce((s, [id, p]) => s + (p / total) * pctOf(id), 0);
}

// The one expected yield of a field's crop, shared by Yields and prices, the
// feed planner, the cuts window and the margins: the crop's litres/ha at full
// potential × the soil mix's yield potential × today's field moisture when the
// crop is harvested this month (FS25_MoistureSystem; needs farm). `base` is
// null for a crop with no known yield — callers show "unknown", litres stay 0.
// `rate` replaces the crop's own litres/ha (chaff for silage, grass × cuts).
function fieldExpectedYield(field, idx, crop, rates, farm, rate) {
    const area = parseFloat(field && field.area) || 0;
    const base = rate !== undefined ? rate : getCropYieldRate(crop);
    const soil = fieldYieldFactor(getFieldSoilMix(fertPlanSoilKey(field, idx), rates));
    const sowing = crop === field.crop ? field.sowingMonth : field.catchSowingMonth;
    const moist = farm && typeof fieldMoistureInfo === 'function' ? fieldMoistureInfo(field, crop, sowing, farm) : null;
    const factor = soil * (moist && moist.now ? moist.factor : 1);
    const perHa = base === null || base === undefined ? null : base * factor;
    return { base, soil, moist, factor, perHa, litres: perHa === null ? 0 : area * perHa };
}

// --- Lime by soil type (Precision Farming) --------------------------------
// FS25 PrecisionFarming.xml <pHMap>: soil pH decays a FIXED amount per harvest
// per soil type (it does NOT depend on the crop), and <limeUsage
// usagePerState="730"/> means 730 l/ha raises pH by one 0.125 step. A lime
// application in this app is meant to last ~3 seasons (getLimeStatus warns from
// the 3rd), so each field's application is sized to 3 harvests of decay:
//   loamySand / sandyLoam : -0.125 pH/harvest -> 3 x 730  = 2190 l/ha
//   loam / siltyClay      : -0.250 pH/harvest -> 3 x 1460 = 4380 l/ha
// Used for the Supplies lime list when the save has no Precision Farming pH map.
const LIME_L_PER_PH_STATE = 730;     // l/ha to raise pH by one 0.125 step
const LIME_CYCLE_HARVESTS = 3;       // an application is sized to last this many seasons
const LIME_PH_DROP_PER_HARVEST = { loamySand: 0.125, sandyLoam: 0.125, loam: 0.250, siltyClay: 0.250 };
const LIME_PH_DROP_FALLBACK = 0.1875;   // PF "regular reference" average, for unknown soils

// Litres of lime per hectare for one application on a single soil type.
function limeRateForSoil(soilId) {
    const drop = LIME_PH_DROP_PER_HARVEST[soilId] !== undefined ? LIME_PH_DROP_PER_HARVEST[soilId] : LIME_PH_DROP_FALLBACK;
    return (drop / 0.125) * LIME_L_PER_PH_STATE * LIME_CYCLE_HARVESTS;
}

// Share-weighted average l/ha of lime across the field's soil mix.
function fieldLimeRate(soilMix) {
    const entries = Object.entries(soilMix).filter(([, p]) => p > 0);
    if (!entries.length) return limeRateForSoil(defaultSoilId());
    const total = entries.reduce((s, [, p]) => s + p, 0);
    return entries.reduce((s, [id, p]) => s + (p / total) * limeRateForSoil(id), 0);
}

// --- Lime pH tracking (real per-field value, not just a season-diff guess) --
// 1.0 = "ideal", just limed. Placeholder decay rate reuses
// LIME_PH_DROP_PER_HARVEST above — swap for real Precision Farming numbers
// once they're extracted from the game's packed data files.
const LIME_PH_IDEAL = 1.0;

// Share-weighted average pH drop per harvest across the field's soil mix.
function fieldLimePhDrop(soilMix) {
    const entries = Object.entries(soilMix).filter(([, p]) => p > 0);
    if (!entries.length) return LIME_PH_DROP_FALLBACK;
    const total = entries.reduce((s, [, p]) => s + p, 0);
    return entries.reduce((s, [id, p]) => {
        const drop = LIME_PH_DROP_PER_HARVEST[id] !== undefined ? LIME_PH_DROP_PER_HARVEST[id] : LIME_PH_DROP_FALLBACK;
        return s + (p / total) * drop;
    }, 0);
}

// Fields saved before this model existed have limeAppliedSeason but no
// limePh. Backfill it from the old season-diff formula instead of resetting
// to ideal — used everywhere a field's live pH is read or about to be
// written, so a never-yet-saved/decayed field still shows/decays correctly.
function resolveLimePh(field, seasonNum, soilMix) {
    if (field.limePh != null) return field.limePh;
    if (field.limeAppliedSeason == null) return null;
    const diff = Math.max(0, seasonNum - field.limeAppliedSeason);
    return Math.max(0, LIME_PH_IDEAL - fieldLimePhDrop(soilMix) * diff);
}

// "Gliniasta 60% · Piaszczysta 40%" (single type -> just its name).
function soilMixLabel(mix) {
    const entries = Object.entries(mix).filter(([, p]) => p > 0);
    if (!entries.length) return soilLabel(defaultSoilId());
    if (entries.length === 1) return soilLabel(entries[0][0]);
    const total = entries.reduce((s, [, p]) => s + p, 0);
    return entries
        .sort((a, b) => b[1] - a[1])
        .map(([id, p]) => `${soilLabel(id)} ${Math.round(p / total * 100)}%`)
        .join(' · ');
}

const SUPPLY_GLOBAL_DEFAULTS = {
    bufferPct: 5,            // reserve added on top of every total
    nDensity: 0.22,          // kg of N per litre of the fertilizer you buy (PF)
    assumeAllFertilized: true,
    // kg of nitrogen per litre of organic fertilizer — tuned to this farm's
    // actual products (solid manure 5 kg N/t, slurry 4 kg N/m³, digestate
    // 5.5 kg N/m³; FS25 Precision Farming's own <fertilizerUsage> defaults are
    // 7 / 4 / 5.5). Used to turn a field's N need into a manure / slurry /
    // digestate volume.
    manureN: 0.005,
    slurryN: 0.004,
    digestateN: 0.0055
};

// A positive number from the farm's rates, or the built-in default when the
// setting is blank / zero — the one fallback every calculation shares.
function supplyRate(rates, key) {
    const v = parseFloat(rates && rates[key]);
    return v > 0 ? v : SUPPLY_GLOBAL_DEFAULTS[key];
}

// Supply-rate overrides (per-crop seed/N, per-field soil mixes, the global
// knobs) are per-farm — stored on the farm's data.json so they ride along with
// backups and never bleed between farms on different maps.
function getSupplyRates() {
    const farm = getCurrentFarm();
    let saved = (farm && farm.supplyRates && typeof farm.supplyRates === 'object') ? farm.supplyRates : null;

    // One-time migration from the old app-wide localStorage blob.
    if (!saved && farm) {
        try {
            const legacy = JSON.parse(localStorage.getItem(CONFIG_KEY_SUPPLY_RATES));
            if (legacy && typeof legacy === 'object') {
                saved = legacy;
                farm.supplyRates = legacy;
                saveFarmData(farm, { touch: false });
            }
        } catch { /* no legacy blob to adopt */ }
    }
    saved = saved || {};

    // One-time cleanup: older builds saved every drawer default as an override.
    // A seed equal to the old built-in table or an N equal to SUPPLY_N_RATES is
    // such a frozen default — drop it so PF seed rates / per-soil N apply.
    if (farm && saved.crops && !saved.defaultOverridesCleaned) {
        Object.keys(saved.crops).forEach(c => {
            const o = saved.crops[c];
            if (!o || typeof o !== 'object') return;
            if (o.seed !== undefined && parseFloat(o.seed) === LEGACY_SEED_DEFAULTS[c]) delete o.seed;
            if (o.n !== undefined && parseFloat(o.n) === SUPPLY_N_RATES[c]) delete o.n;
            if (Object.keys(o).length === 0) delete saved.crops[c];
        });
        saved.defaultOverridesCleaned = true;
        farm.supplyRates = saved;
        saveFarmData(farm, { touch: false });
    }
    return {
        ...SUPPLY_GLOBAL_DEFAULTS, ...saved,
        crops: (saved && saved.crops) ? saved.crops : {},
        fieldSoil: (saved && saved.fieldSoil) ? saved.fieldSoil : {},
        fertPlan: (saved && saved.fertPlan) ? saved.fertPlan : {}
    };
}

function saveSupplyRates(rates) {
    const farm = getCurrentFarm();
    if (!farm) return;
    farm.supplyRates = rates;
    saveFarmData(farm);
}

// Per-crop rate lookup: a saved override wins, otherwise the built-in table,
// otherwise null so the caller can flag "no rate" and fall back.
function getCropSeedRate(crop, rates) {
    const o = rates.crops[crop];
    if (o && o.seed !== undefined && o.seed !== '' && !isNaN(o.seed)) return parseFloat(o.seed);
    return defaultSeedRate(crop);
}
// --- Zaopatrzenie (Supplies panel) row builders -----------------------------
// Both read farm.fields[] directly — no savegame path, no per-crop
// aggregation. One row per field, matching how the field itself is edited
// in "Edit season" and planned in each field's "Nawożenie" popup.

// Seeds: one row per field still to sow (state !== 'Planted').
function buildSuppliesSeedRows(farm, rates) {
    const buffer = 1 + (parseFloat(rates.bufferPct) || 0) / 100;
    const fields = (farm && farm.fields) || [];
    const rows = [];
    fields.forEach((f, i) => {
        const crop = f.crop || '';
        const area = parseFloat(f.area) || 0;
        const number = (f.number || '').toString().trim() || ('#' + (i + 1));
        if (area <= 0) return;
        const soilMix = getFieldSoilMix(fertPlanSoilKey(f, i), rates);
        const addRow = (c, isCatch) => {
            const rate = fieldSeedRate(c, soilMix, rates);
            const known = rate !== null;
            const r = known ? rate : SUPPLY_SEED_FALLBACK;
            const need = area * r;
            rows.push({ number, crop: c, isCatch, area, rate: r, known, need, buffered: need * buffer });
        };
        if (crop && f.state !== 'Planted') addRow(crop, false);
        // Catch crop: sown separately (before/after the main crop), so its
        // seed is still needed even once the main crop is in the ground.
        if (f.catchCrop) addRow(f.catchCrop, true);
    });
    return { rows, total: rows.reduce((s, r) => s + r.buffered, 0) };
}

// Fertilizer: one row per field eligible for fertilizing this season. A field
// with a saved plan (existingN/orgN entered via its "Nawożenie" popup) gets
// its full Target/Existing/Natural/Mineral breakdown from
// computeFieldFertPlan; a field without one gets hasPlan:false so the panel
// can show a "fill in the plan" call-to-action instead of guessed numbers.
function buildSuppliesFertRows(farm, rates) {
    const buffer = 1 + (parseFloat(rates.bufferPct) || 0) / 100;
    const fields = (farm && farm.fields) || [];
    const rows = [];
    fields.forEach((f, i) => {
        const crop = f.crop || '';
        const area = parseFloat(f.area) || 0;
        const displayNumber = (f.number || '').toString().trim() || ('#' + (i + 1));
        const hasCrop = !!crop && area > 0;
        const soilKey = fertPlanSoilKey(f, i);
        const planKey = fertPlanKey(f, i);
        const saved = rates.fertPlan && rates.fertPlan[planKey];
        const pfN = pfFieldData(soilKey);
        const hasPlan = !!(saved && ((parseFloat(saved.existingN) > 0) || (parseFloat(saved.orgN) > 0))) || !!(pfN && pfN.nitrogen);

        // f.fertilizer = synthetic fertilizer already applied this season, so
        // there's nothing left to buy for it. Otherwise every crop field counts,
        // or — with "assume every crop" off — only fields with a plan filled in.
        const eligible = hasCrop && !f.fertilizer && (rates.assumeAllFertilized || hasPlan);
        if (!eligible) return;

        if (!hasPlan) {
            rows.push({ number: displayNumber, crop, area, hasPlan: false, planKey, soilKey, displayNumber });
            return;
        }

        const d = computeFieldFertPlan(planKey, soilKey, crop, area, rates);
        rows.push({
            number: displayNumber, crop, area, soilMix: d.soilMix, hasPlan: true, planKey, soilKey, displayNumber,
            targetRate: d.targetRate, targetAbs: d.targetRate * area,
            existingRate: d.existingRate, existingAbs: d.existingRate * area,
            orgRate: d.orgRate, orgAbs: d.orgRate * area * buffer,
            orgVol: d.orgVol, orgVolAbs: {
                manure: d.orgVol.manure * area * buffer,
                slurry: d.orgVol.slurry * area * buffer,
                digestate: d.orgVol.digestate * area * buffer
            },
            mineralRate: d.mineralRate, mineralAbs: d.mineralRate * area * buffer,
            mineralLitres: d.mineralLitres, mineralLAbs: d.mineralLitres * area * buffer,
            covered: d.covered
        });
    });

    const planned = rows.filter(r => r.hasPlan);
    const totals = {
        area: planned.reduce((s, r) => s + r.area, 0),
        targetAbs: planned.reduce((s, r) => s + r.targetAbs, 0),
        existingAbs: planned.reduce((s, r) => s + r.existingAbs, 0),
        orgAbs: planned.reduce((s, r) => s + r.orgAbs, 0),
        orgVolAbs: {
            manure: planned.reduce((s, r) => s + r.orgVolAbs.manure, 0),
            slurry: planned.reduce((s, r) => s + r.orgVolAbs.slurry, 0),
            digestate: planned.reduce((s, r) => s + r.orgVolAbs.digestate, 0)
        },
        mineralAbs: planned.reduce((s, r) => s + r.mineralAbs, 0),
        mineralLAbs: planned.reduce((s, r) => s + r.mineralLAbs, 0)
    };
    return { rows, missingPlanCount: rows.length - planned.length, totals };
}
