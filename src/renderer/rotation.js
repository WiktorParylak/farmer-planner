// Crop rotation (płodozmian). A classic <script> loaded after fields-table.js
// (see index.html): it shares the renderer's globals (t, CROP_CALENDAR,
// AVAILABLE_CROPS, getCurrentFarm, saveFarmData, ...).
//
// Data, per farm (each map has its own crop list):
//   farm.rotations = [{ id, name, color, steps: [{ crop, catchCrop, sowingMonth, seasons }] }]
//     crop ''        = fallow; seasons > 1 = the crop stays (grass, alfalfa);
//     sowingMonth '' = the first month of the crop's sowing window.
//   field.rotation = { id, step, stepSeason, filled }
//     where the field is in its cycle this season; filled = the season the
//     planner last filled (or was told not to fill) its crop from the cycle.
//   farm.rotationAutoFill = 'auto' | 'ask' | 'off'
//
// A cycle is walked in "slots": one per season, so a 3-season grass step is
// three slots. A field's position is a slot index.

const ROTATION_COLORS = ['#c97a2b', '#5b8c3a', '#3f6fa8', '#a8553a', '#7a5aa8', '#2f8f8a', '#b0983a', '#8a4f6f'];

// Colours of the crops in the rotation grid (other crops get one from their name).
const ROTATION_CROP_COLORS = {
    WHEAT: '#d9b44a', BARLEY: '#e3c76f', OAT: '#c8b27c', CANOLA: '#e2d530', MAIZE: '#f0a02c',
    SUNFLOWER: '#f5c400', SOYBEAN: '#9bb35a', POTATO: '#b08a5a', SUGARBEET: '#c25b7a', SUGARCANE: '#7fae5a',
    COTTON: '#d8d2c4', SORGHUM: '#b0603f', RICE: '#c9d48f', RICELONGGRAIN: '#bcc98a', GRASS: '#55a05a',
    MEADOW: '#6fb06f', ALFALFA: '#7a9e4a', CLOVER: '#4f8f6a', OILSEEDRADISH: '#9a7fc0', GREENRYE: '#6f9a3a',
    PEA: '#8fc06a', GREENBEAN: '#5f9f4f', SPINACH: '#3f7f3f', CARROT: '#e07a30', PARSNIP: '#d9c89c',
    BEETROOT: '#8a2f4a', POPLAR: '#8a7a5a', GRAPE: '#6a3f7a', OLIVE: '#7a8a3f', RYE: '#b89a5a', TRITICALE: '#c4a25e'
};
function rotationCropColor(crop) {
    const key = cropOrderKey(crop);
    if (!key) return 'transparent';
    if (ROTATION_CROP_COLORS[key]) return ROTATION_CROP_COLORS[key];
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h}, 45%, 55%)`;
}

// Rules for the warnings (FS25 itself has no rotation bonus — these are the
// usual farming rules of thumb).
const ROTATION_CEREALS = ['Wheat', 'Barley', 'Oat', 'Rye', 'Triticale', 'Spelt', 'Sorghum'];
// Crops that need a break (soil-borne disease and pests): at most every n-th
// season. Canola (clubroot, blackleg) and sugar beet (nematodes, Rhizoctonia)
// 1 in 3; potato (nematodes, scab), sunflower (Sclerotinia) and peas (foot rot)
// 1 in 4 — the usual advice is 3-4 and 4-6 years.
const ROTATION_BREAK_CROPS = { Canola: 3, Sugarbeet: 3, Potato: 4, Sunflower: 4, Pea: 4 };
const cropIn = (list, crop) => !!crop && list.some(c => cropOrderKey(c) === cropOrderKey(crop));

// Templates to start from: copied into the farm, then editable. Crops the
// map doesn't have are left out (a template with fewer than 2 steps isn't offered).
// Built on the game's calendars: an autumn crop (wheat, barley Sep-Oct, canola
// Aug-Sep) follows a crop harvested by then; a spring crop (beet, potato,
// maize, peas, sunflower) after a cereal gets oilseed radish over the winter
// gap, which also feeds the next crop when it's worked in. Every template
// passes the warnings below (no crop twice, at most two cereals in a row,
// break crops within their gap). sowingMonth only where the default (the
// window's first month) comes too early: a cereal after a September harvest
// goes in in October, grass after the barley harvest in August. A map whose
// calendar doesn't allow it falls back to the default (rotationSowMonth).
const ROTATION_TEMPLATES = [
    // Norfolk four-course: cereal, root crop, cereal, legume (clover -> peas).
    { key: 'norfolk', steps: [{ crop: 'Wheat', catchCrop: 'Oilseedradish' }, { crop: 'Sugarbeet' }, { crop: 'Barley', sowingMonth: 'OCTOBER', catchCrop: 'Oilseedradish' }, { crop: 'Pea' }] },
    // Canola after barley (harvested in time for an August sowing), wheat after canola.
    { key: 'cerealsCanola', steps: [{ crop: 'Canola' }, { crop: 'Wheat' }, { crop: 'Barley' }] },
    // Peas leave nitrogen for the wheat after them; canola every fifth season.
    { key: 'pea', steps: [{ crop: 'Pea' }, { crop: 'Wheat' }, { crop: 'Canola' }, { crop: 'Wheat' }, { crop: 'Barley', catchCrop: 'Oilseedradish' }] },
    // Silage maize twice (not in a row), grass sown after the barley harvest.
    { key: 'dairy', steps: [{ crop: 'Maize' }, { crop: 'Wheat', sowingMonth: 'OCTOBER', catchCrop: 'Oilseedradish' }, { crop: 'Maize' }, { crop: 'Barley', sowingMonth: 'OCTOBER' }, { crop: 'Grass', sowingMonth: 'AUGUST', seasons: 3 }] },
    { key: 'roots', steps: [{ crop: 'Potato' }, { crop: 'Wheat', catchCrop: 'Oilseedradish' }, { crop: 'Sugarbeet' }, { crop: 'Barley', sowingMonth: 'OCTOBER', catchCrop: 'Oilseedradish' }] },
    { key: 'catchCrops', steps: [{ crop: 'Wheat', catchCrop: 'Oilseedradish' }, { crop: 'Maize' }, { crop: 'Barley', sowingMonth: 'OCTOBER', catchCrop: 'Oilseedradish' }, { crop: 'Soybean' }] },
    // Warm, dry maps: sunflower one season in four, wheat straight after its September harvest.
    { key: 'sunflower', steps: [{ crop: 'Sunflower' }, { crop: 'Wheat', sowingMonth: 'OCTOBER', catchCrop: 'Oilseedradish' }, { crop: 'Maize' }, { crop: 'Barley', sowingMonth: 'OCTOBER', catchCrop: 'Oilseedradish' }] },
    // Southern maps: cotton with maize and soybeans in between.
    { key: 'cotton', steps: [{ crop: 'Cotton' }, { crop: 'Maize' }, { crop: 'Soybean' }] }
];

// The map's own spelling of a crop, or '' when the map doesn't have it.
function rotationMapCrop(crop) {
    return AVAILABLE_CROPS.find(c => cropOrderKey(c) === cropOrderKey(crop)) || '';
}

function rotationTemplateSteps(tpl) {
    return tpl.steps.map(s => ({
        crop: rotationMapCrop(s.crop),
        catchCrop: s.catchCrop ? rotationMapCrop(s.catchCrop) : '',
        sowingMonth: s.sowingMonth || '',
        seasons: s.seasons || (isPerennialCrop(s.crop) ? grasslandSeasonLimit(getCurrentFarm()) : 1)
    })).filter(s => s.crop);
}

// A cycle's colour, only as #rrggbb (it ends up in a style attribute).
function rotationColor(rot) {
    return /^#[0-9a-f]{6}$/i.test(rot && rot.color || '') ? rot.color : ROTATION_COLORS[0];
}

function newRotationId() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getRotations(farm) {
    if (!farm) return [];
    if (!Array.isArray(farm.rotations)) farm.rotations = [];
    return farm.rotations;
}

function rotationById(farm, id) {
    return id ? getRotations(farm).find(r => r.id === id) || null : null;
}

function rotationFillMode(farm) {
    const v = farm && farm.rotationAutoFill;
    return ['auto', 'ask', 'off'].includes(v) ? v : 'auto';
}

// ---------- slots and positions ----------
function rotationSlots(rot) {
    const slots = [];
    (rot && rot.steps || []).forEach((step, i) => {
        const n = Math.max(1, parseInt(step.seasons, 10) || 1);
        for (let s = 1; s <= n; s++) slots.push({ step: i, stepSeason: s, seasons: n, crop: step.crop || '', catchCrop: step.catchCrop || '', sowingMonth: step.sowingMonth || '' });
    });
    return slots;
}

function rotationSlotIndex(rot, pos) {
    const slots = rotationSlots(rot);
    if (!slots.length || !pos) return 0;
    const i = slots.findIndex(s => s.step === pos.step && s.stepSeason === (pos.stepSeason || 1));
    if (i >= 0) return i;
    const first = slots.findIndex(s => s.step === pos.step);
    return first >= 0 ? first : 0;
}

function rotationSlotAt(rot, index) {
    const slots = rotationSlots(rot);
    if (!slots.length) return null;
    return slots[((index % slots.length) + slots.length) % slots.length];
}

// The field's cycle and where it is in it, or null if it has none (or the cycle is gone/empty).
function fieldRotationInfo(farm, field) {
    const rot = field && field.rotation ? rotationById(farm, field.rotation.id) : null;
    if (!rot || !rot.steps || !rot.steps.length) return null;
    const index = rotationSlotIndex(rot, field.rotation);
    return { rot, index, slot: rotationSlotAt(rot, index), length: rotationSlots(rot).length };
}

function setFieldRotationSlot(field, rot, index, extra) {
    const slot = rotationSlotAt(rot, index);
    field.rotation = { id: rot.id, step: slot.step, stepSeason: slot.stepSeason, ...(extra || {}) };
}

// First month of the crop's first sowing window in the sowing year (July..June,
// like isSowingOverdue), so winter wheat sows in autumn, not in its spring window.
function rotationDefaultSowMonth(crop) {
    const cal = crop && CROP_CALENDAR[crop];
    if (!cal) return '';
    const inCal = i => !!cal[ALL_MONTHS[(i + 12) % 12]];
    for (let k = 0; k < 12; k++) {
        const i = (SOWING_YEAR_START + k) % 12;
        if (inCal(i) && !inCal(i - 1)) return ALL_MONTHS[i];
    }
    return ALL_MONTHS.find(m => cal[m]) || '';
}

function rotationSowMonth(slot) {
    const cal = slot.crop && CROP_CALENDAR[slot.crop];
    if (slot.sowingMonth && (!cal || cal[slot.sowingMonth])) return slot.sowingMonth;
    return rotationDefaultSowMonth(slot.crop);
}

// Puts the slot's crop on the field. Grassland that simply carries on keeps
// its crop and stays sown.
function applyRotationSlot(field, slot) {
    const crop = slot.crop || '';
    const carriesOn = crop && isPerennialCrop(crop) && cropOrderKey(field.crop) === cropOrderKey(crop);
    if (!carriesOn) {
        if (cropOrderKey(field.crop) !== cropOrderKey(crop)) field.tillage = null;
        field.crop = crop;
        field.sowingMonth = crop ? rotationSowMonth(slot) : '';
        field.state = 'To Plant';
    } else {
        field.state = 'Planted';
    }
    field.catchCrop = slot.catchCrop || '';
    field.catchSowingMonth = field.catchCrop ? rotationCatchSowMonth(field.crop, field.sowingMonth, field.catchCrop) : '';
}

// A catch crop goes in after the main crop's harvest: the first month after it
// that the catch crop's calendar allows.
function rotationCatchSowMonth(crop, sowMonth, catchCrop) {
    const cal = CROP_CALENDAR[catchCrop];
    const harvest = crop && CROP_CALENDAR[crop] && CROP_CALENDAR[crop][sowMonth];
    const from = ALL_MONTHS.indexOf(harvest);
    if (!cal || from < 0) return rotationDefaultSowMonth(catchCrop);
    for (let k = 1; k <= 12; k++) {
        const m = ALL_MONTHS[(from + k) % 12];
        if (cal[m]) return m;
    }
    return '';
}

// ---------- history, projection, detection ----------
function fieldPastCrops(history, number) {
    const key = (number || '').toString().trim();
    const out = {};
    Object.keys(history || {}).forEach(s => {
        out[s] = (history[s] || []).filter(f => (f.number || '').toString().trim() === key).map(f => f.crop || '').filter(Boolean);
    });
    return out;
}

// Proposes the slot the field is in this season: the one that best explains
// its current crop and the last seasons (recent seasons weigh more).
function detectRotationSlot(rot, field, history, season) {
    const slots = rotationSlots(rot);
    if (!slots.length) return 0;
    const past = fieldPastCrops(history, field.number);
    let best = 0, bestScore = -Infinity;
    slots.forEach((_, p) => {
        let score = 0;
        for (let k = 0; k <= 5; k++) {
            const expected = rotationSlotAt(rot, p - k).crop;
            let actual = null;
            if (k === 0) actual = field.crop ? [field.crop] : null;
            else if (past[season - k] && (past[season - k].length || (history[season - k] || []).length)) actual = past[season - k];
            if (!actual) continue;
            const hit = expected ? actual.some(c => cropOrderKey(c) === cropOrderKey(expected)) : !actual.length;
            score += (hit ? 1 : -1) / (k + 1);
        }
        if (score > bestScore) { bestScore = score; best = p; }
    });
    return best;
}

// Seasons around the current one for a field: up to `back` archived seasons,
// this one, and `ahead` projected from the cycle. [{ season, crops, catchCrop, projected, current, slot }]
function rotationTimeline(farm, field, history, back, ahead) {
    const season = farm.currentSeason || 1;
    const past = fieldPastCrops(history, field.number);
    const info = fieldRotationInfo(farm, field);
    const out = [];
    for (let s = Math.max(1, season - back); s < season; s++) {
        const rows = (history[s] || []).filter(f => (f.number || '').toString().trim() === (field.number || '').toString().trim());
        out.push({ season: s, crops: past[s] || [], catchCrop: rows.map(f => f.catchCrop).filter(Boolean)[0] || '', projected: false });
    }
    out.push({ season, crops: field.crop ? [field.crop] : [], catchCrop: field.catchCrop || '', projected: false, current: true, slot: info ? info.slot : null });
    const next = field.nextCrop;
    if (info) {
        for (let k = 1; k <= ahead; k++) {
            const slot = rotationSlotAt(info.rot, info.index + k);
            if (k === 1 && next) out.push({ season: season + 1, crops: next.crop ? [next.crop] : [], catchCrop: '', projected: true, generated: true });
            else out.push({ season: season + k, crops: slot.crop ? [slot.crop] : [], catchCrop: slot.catchCrop, projected: true, slot });
        }
    } else if (next && ahead > 0) {
        out.push({ season: season + 1, crops: next.crop ? [next.crop] : [], catchCrop: '', projected: true, generated: true });
    }
    return out;
}

// Warnings for a sequence of seasons (see ROTATION_* above). Only runs that
// reach this season or later count — the past can't be changed any more.
// fromIdx = index of the current season in seq (0 for a cycle on its own).
function rotationSequenceWarnings(seq, fromIdx, grassLimit) {
    const warn = [];
    const has = (i, pred) => (seq[i] && seq[i].crops || []).some(pred);
    const label = i => seq[i].label || (t('season') + ' ' + seq[i].season);
    for (let i = 0; i + 1 < seq.length; i++) {
        if (i + 1 < fromIdx) continue;
        const repeat = seq[i].crops.find(c => !isPerennialCrop(c) && seq[i + 1].crops.some(d => cropOrderKey(d) === cropOrderKey(c)));
        if (repeat) warn.push({ level: 'yellow', text: t('rotWarnRepeat').replace('{crop}', translateCropName(repeat)).replace('{a}', label(i)).replace('{b}', label(i + 1)) });
    }
    for (let i = 0; i + 2 < seq.length; i++) {
        if (i + 2 < fromIdx) continue;
        if ([0, 1, 2].every(k => has(i + k, c => cropIn(ROTATION_CEREALS, c)))) {
            warn.push({ level: 'red', text: t('rotWarnCereals').replace('{a}', label(i)).replace('{b}', label(i + 2)) });
            break;
        }
    }
    Object.keys(ROTATION_BREAK_CROPS).forEach(bc => {
        const minGap = ROTATION_BREAK_CROPS[bc];
        const at = seq.map((e, i) => (e.crops.some(c => cropOrderKey(c) === cropOrderKey(bc)) ? i : -1)).filter(i => i >= 0);
        for (let j = 1; j < at.length; j++) {
            if (at[j] < fromIdx) continue;
            const gap = at[j] - at[j - 1];
            if (gap > 1 && gap < minGap) {
                warn.push({ level: 'red', text: t('rotWarnBreak').replace('{crop}', translateCropName(bc)).replace('{n}', minGap).replace('{a}', label(at[j - 1])).replace('{b}', label(at[j])) });
                break;
            }
        }
    });
    let run = 0, runCrop = '';
    for (let i = 0; i < seq.length; i++) {
        const g = seq[i].crops.find(c => isPerennialCrop(c));
        run = g && cropOrderKey(g) === cropOrderKey(runCrop) ? run + 1 : (g ? 1 : 0);
        runCrop = g || '';
        if (g && run > grassLimit && i >= fromIdx) {
            warn.push({ level: 'yellow', text: t('rotWarnGrass').replace('{crop}', translateCropName(g)).replace('{n}', run).replace('{max}', grassLimit) });
            break;
        }
    }
    return warn;
}

// The field's score: { level: green/yellow/red/'' , warnings, offCycle, info }.
function fieldRotationScore(farm, field, history) {
    const info = fieldRotationInfo(farm, field);
    const seq = rotationTimeline(farm, field, history, 3, 3);
    const cur = seq.findIndex(e => e.current);
    const warnings = rotationSequenceWarnings(seq, cur, grasslandSeasonLimit(farm));
    const offCycle = !!(info && field.crop && cropOrderKey(field.crop) !== cropOrderKey(info.slot.crop));
    if (offCycle) warnings.unshift({ level: 'yellow', text: t('rotWarnOffCycle').replace('{crop}', translateCropName(field.crop)).replace('{want}', info.slot.crop ? translateCropName(info.slot.crop) : t('rotFallow')) });
    const known = info || seq.some(e => e.crops.length && !e.current) || field.crop;
    const level = warnings.some(w => w.level === 'red') ? 'red' : (warnings.length ? 'yellow' : (known ? 'green' : ''));
    return { level, warnings, offCycle, info };
}

// Warnings of a cycle on its own, walked twice round (so the step after the
// last one is the first again).
function rotationCycleWarnings(rot, grassLimit) {
    const slots = rotationSlots(rot);
    if (slots.length < 2) return [];
    const seq = [...slots, ...slots].map((s, i) => ({ season: i, crops: s.crop ? [s.crop] : [], label: t('rotStepN').replace('{n}', s.step + 1) }));
    const seen = new Set();
    return rotationSequenceWarnings(seq, 0, grassLimit).filter(w => !seen.has(w.text) && seen.add(w.text));
}

// ---------- new season and new month ----------
// Called by runNewSeason after the fields were cleared. Moves every field with
// a cycle one season on; fills its crop when `fill`. Returns the filled fields.
function advanceRotationsForNewSeason(farm, newSeason, fill) {
    const filled = [];
    (farm.fields || []).forEach(field => {
        const info = fieldRotationInfo(farm, field);
        // A carried-over crop moves on after its harvest (settleCarriedFields).
        if (field.carriedFrom) return;
        // Planned by the crop generator for this season: it wins over the cycle.
        if (field.nextCrop) {
            applyRotationSlot(field, { crop: field.nextCrop.crop || '', catchCrop: '', sowingMonth: field.nextCrop.sowingMonth || '' });
            delete field.nextCrop;
            if (info) setFieldRotationSlot(field, info.rot, info.index + 1, { filled: newSeason });
            filled.push(field);
            return;
        }
        if (!info) return;
        setFieldRotationSlot(field, info.rot, info.index + 1, { filled: newSeason });
        if (!fill) return;
        applyRotationSlot(field, rotationSlotAt(info.rot, info.index + 1));
        filled.push(field);
    });
    return filled;
}

function rotationFieldCount(farm) {
    return (farm.fields || []).filter(f => fieldRotationInfo(farm, f)).length;
}

function rotationFilledList(fields) {
    return fields.map(f => `${f.number}: ${f.crop ? translateCropName(f.crop) : t('rotFallow')}`).join(', ');
}

// The month to sow the slot's crop in when it's filled mid-season: its own
// month if that's this month or next, else whichever of the two the crop's
// calendar allows ('' = neither, not yet).
function rotationSowMonthSoon(slot, monthName) {
    const cur = ALL_MONTHS.indexOf((monthName || '').toUpperCase());
    const cal = slot.crop && CROP_CALENDAR[slot.crop];
    if (cur < 0 || !cal) return '';
    const soon = [ALL_MONTHS[cur], ALL_MONTHS[(cur + 1) % 12]];
    const own = rotationSowMonth(slot);
    if (soon.includes(own)) return own;
    return soon.find(m => cal[m]) || '';
}

// After the in-game month moved on: an empty field whose cycle step can be
// sown this month or next gets that crop (once per season — clearing it again
// by hand sticks). Asks first in 'ask' mode.
function rotationMonthCandidates(farm) {
    const season = farm.currentSeason || 1;
    return (farm.fields || []).filter(field => {
        if (field.crop || (field.rotation && field.rotation.filled === season)) return false;
        const info = fieldRotationInfo(farm, field);
        return info && info.slot.crop && rotationSowMonthSoon(info.slot, farm.month);
    });
}

let rotationMonthTimer = null;
function maybeFillFromRotation(farm, tries = 0) {
    if (!farm || rotationFillMode(farm) === 'off' || !farm.month) return;
    clearTimeout(rotationMonthTimer);
    rotationMonthTimer = setTimeout(async () => {
        const live = getCurrentFarm();
        if (!live || live.id !== farm.id) return;
        // Another dialog (e.g. the new-season question) or Edit first.
        const dialog = document.getElementById('app-dialog');
        if (isEditMode || (dialog && dialog.style.display === 'flex')) {
            if (tries < 20) maybeFillFromRotation(live, tries + 1);
            return;
        }
        const season = live.currentSeason || 1;
        const key = season + ':' + live.month;
        if (live.rotationFillKey === key) return;
        live.rotationFillKey = key;
        const fields = rotationMonthCandidates(live);
        if (!fields.length) { saveFarmData(live, { touch: false }); return; }
        let fill = true;
        if (rotationFillMode(live) === 'ask') {
            const preview = fields.map(f => `${f.number}: ${translateCropName(fieldRotationInfo(live, f).slot.crop)}`).join(', ');
            fill = (await showConfirm({ title: t('rotMonthFillTitle'), body: t('rotMonthFillAsk').replace('{list}', preview), confirmText: t('rotMonthFillConfirm'), icon: 'fa-arrows-spin' })) === true;
        }
        fields.forEach(f => {
            const info = fieldRotationInfo(live, f);
            if (fill) {
                applyRotationSlot(f, info.slot);
                f.sowingMonth = rotationSowMonthSoon(info.slot, live.month) || f.sowingMonth;
            }
            f.rotation.filled = season;
        });
        saveFarmData(live);
        if (fill) {
            if (!isEditMode) renderSeasonView();
            showAutoSyncToast(t('rotMonthFilled').replace('{list}', rotationFilledList(fields)), 6000);
        }
    }, 900);
}

// ---------- table and field view ----------
// "Norfolk 2/4 → Barley" under the crop, with the score dot.
function rotationCaptionHtml(farm, field, history) {
    const score = fieldRotationScore(farm, field, history);
    if (!score.info) return '';
    const { rot, slot, index } = score.info;
    const next = rotationSlotAt(rot, index + 1);
    const pos = `${slot.step + 1}/${rot.steps.length}` + (slot.seasons > 1 ? ` (${slot.stepSeason}/${slot.seasons})` : '');
    const title = [t('rotCaptionHint').replace('{name}', rot.name), ...score.warnings.map(w => '• ' + w.text)].join('\n');
    return `<span class="ha-caption rotation-caption" title="${escapeHtml(title)}"><span class="rotation-dot is-${score.level || 'none'}"></span>${escapeHtml(rot.name)} ${pos} → ${next.crop ? escapeHtml(translateCropName(next.crop)) : t('rotFallow')}</span>`;
}

function rotationSelectHtml(farm, selectedId, cls, attrs = '') {
    const rots = getRotations(farm);
    return `<select class="${cls}"${attrs}><option value="">${t('rotNone')}</option>${rots.map(r => `<option value="${escapeHtml(r.id)}" ${r.id === selectedId ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}</select>`;
}

function rotationStepOptionsHtml(rot, selectedIndex) {
    if (!rot) return `<option value="">–</option>`;
    return rotationSlots(rot).map((s, i) => {
        const text = `${s.step + 1}. ${s.crop ? translateCropName(s.crop) : t('rotFallow')}` + (s.seasons > 1 ? ` (${s.stepSeason}/${s.seasons})` : '');
        return `<option value="${i}" ${i === selectedIndex ? 'selected' : ''}>${escapeHtml(text)}</option>`;
    }).join('');
}

// Edit card: cycle + this season's step (proposed from the history when a cycle is picked).
function rotationEditCellsHtml(farm, field) {
    const info = fieldRotationInfo(farm, field);
    return `<div class="fc-cell">
            <span class="fc-label">${t('rotFieldCycle')}</span>
            ${rotationSelectHtml(farm, info ? info.rot.id : '', 'edit-input field-rotation')}
        </div>
        <div class="fc-cell">
            <span class="fc-label">${t('rotFieldStep')}</span>
            <select class="edit-input field-rotation-step">${rotationStepOptionsHtml(info && info.rot, info ? info.index : 0)}</select>
        </div>`;
}

document.addEventListener('change', e => {
    const sel = e.target;
    if (!sel.classList || !sel.classList.contains('field-rotation')) return;
    const row = sel.closest('tr');
    const farm = getCurrentFarm();
    const rot = rotationById(farm, sel.value);
    const stepSel = row && row.querySelector('.field-rotation-step');
    if (!stepSel) return;
    const crop = row.querySelector('.field-crop');
    const number = row.querySelector('.field-number');
    // A crop this card filled in from a cycle doesn't count as the field's own.
    const own = crop && crop.value && crop.value !== row.dataset.rotationCrop ? crop.value : '';
    const probe = { number: number ? number.value : '', crop: own };
    const idx = rot ? detectRotationSlot(rot, probe, loadSeasonHistory(farm, farm.currentSeason || 1), farm.currentSeason || 1) : 0;
    stepSel.innerHTML = rotationStepOptionsHtml(rot, idx);
    fillEditCardFromRotation(row, rot);
});

document.addEventListener('change', e => {
    const sel = e.target;
    if (!sel.classList || !sel.classList.contains('field-rotation-step')) return;
    const row = sel.closest('tr');
    const cycle = row && row.querySelector('.field-rotation');
    if (cycle) fillEditCardFromRotation(row, rotationById(getCurrentFarm(), cycle.value));
});

// Edit card: an empty crop (or one this card filled in before) takes the
// chosen step's crop, sowing month and catch crop, so they show before saving.
function fillEditCardFromRotation(row, rot) {
    const crop = row.querySelector('.field-crop');
    const sow = row.querySelector('.field-sow');
    const stepSel = row.querySelector('.field-rotation-step');
    if (!crop || !sow || !stepSel) return;
    if (crop.value && crop.value !== row.dataset.rotationCrop) return;
    const slot = rot ? rotationSlotAt(rot, parseInt(stepSel.value, 10) || 0) : null;
    if (!slot || !slot.crop || !crop.querySelector(`option[value="${CSS.escape(slot.crop)}"]`)) {
        // Cycle removed or a fallow step: take back what this card filled in.
        if (row.dataset.rotationCrop) {
            crop.value = '';
            onCropChange(crop);
            delete row.dataset.rotationCrop;
        }
        return;
    }
    crop.value = slot.crop;
    onCropChange(crop);
    const farm = getCurrentFarm();
    sow.value = rotationSowMonthSoon(slot, farm && farm.month) || rotationSowMonth(slot);
    row.dataset.rotationCrop = slot.crop;
    const catchSel = row.querySelector('.field-catch-crop');
    const catchSow = row.querySelector('.field-catch-sow');
    if (catchSel && !catchSel.value && slot.catchCrop && catchSel.querySelector(`option[value="${CSS.escape(slot.catchCrop)}"]`)) {
        catchSel.value = slot.catchCrop;
        onCatchCropChange(catchSel);
        if (catchSow) catchSow.value = rotationCatchSowMonth(slot.crop, sow.value, slot.catchCrop);
    }
}

// Reads the cycle back from an edit card (keeps `filled` when nothing changed).
function readRotationInputs(row, farm, previous) {
    const sel = row.querySelector('.field-rotation');
    if (!sel) return previous || null;
    const rot = rotationById(farm, sel.value);
    if (!rot) return null;
    const stepSel = row.querySelector('.field-rotation-step');
    const slot = rotationSlotAt(rot, parseInt(stepSel && stepSel.value, 10) || 0);
    const pos = { id: rot.id, step: slot.step, stepSeason: slot.stepSeason };
    if (previous && previous.id === pos.id && previous.step === pos.step && previous.stepSeason === pos.stepSeason && previous.filled != null) pos.filled = previous.filled;
    return pos;
}

// Field view section: cycle, step, Detect step, the next seasons and warnings.
function rotationFieldViewHtml(farm, field) {
    const history = loadSeasonHistory(farm, farm.currentSeason || 1);
    const score = fieldRotationScore(farm, field, history);
    const info = score.info;
    let html = `<div class="field-view-crop-grid">
        <label class="settings-field"><span>${t('rotFieldCycle')}</span>${rotationSelectHtml(farm, info ? info.rot.id : '', 'field-view-rotation')}</label>
        ${info ? `<label class="settings-field"><span>${t('rotFieldStep')}</span><select class="field-view-rotation-step">${rotationStepOptionsHtml(info.rot, info.index)}</select></label>` : ''}
    </div>`;
    if (info) {
        const seq = rotationTimeline(farm, field, history, 2, 4);
        html += `<div class="rotation-strip">${seq.map(e => rotationCellHtml(e)).join('')}</div>`;
        html += `<div class="rotation-field-actions"><button type="button" class="settings-btn field-view-rotation-detect">${t('rotDetect')}</button>${score.offCycle ? `<button type="button" class="settings-btn field-view-rotation-realign">${t('rotRealign')}</button>` : ''}</div>`;
    } else if (!getRotations(farm).length) {
        html += `<p class="settings-hint">${t('rotNoCyclesHint')}</p>`;
    }
    if (score.warnings.length) html += `<ul class="rotation-warnings">${score.warnings.map(w => `<li class="is-${w.level}">${escapeHtml(w.text)}</li>`).join('')}</ul>`;
    return html;
}

// A cycle picked for a field starts at the step its history suggests.
function setFieldCycle(farm, field, rotId) {
    const rot = rotationById(farm, rotId);
    if (!rot) { delete field.rotation; return; }
    setFieldRotationSlot(field, rot, detectRotationSlot(rot, field, loadSeasonHistory(farm, farm.currentSeason || 1), farm.currentSeason || 1));
    fillEmptyFieldFromRotation(farm, field);
}

function setFieldCycleStep(farm, field, index) {
    const info = fieldRotationInfo(farm, field);
    if (!info) return;
    setFieldRotationSlot(field, info.rot, parseInt(index, 10) || 0);
    fillEmptyFieldFromRotation(farm, field);
}

// A field with nothing planned this season takes its step's crop as soon as
// it gets a cycle (or another step). A planned crop is never replaced, and a
// fallow step fills nothing. Marked filled, so the month fill leaves it alone;
// the plan's keys (number + crop) move along, as when the crop is picked by hand.
function fillEmptyFieldFromRotation(farm, field) {
    const info = field.crop ? null : fieldRotationInfo(farm, field);
    if (!info || !info.slot.crop) return false;
    const before = JSON.parse(JSON.stringify(farm.fields));
    applyRotationSlot(field, info.slot);
    // Mid-season, like the month fill: this month or next when the crop allows it.
    field.sowingMonth = rotationSowMonthSoon(info.slot, farm.month) || field.sowingMonth;
    field.rotation.filled = farm.currentSeason || 1;
    migrateFieldKeys(farm, before, farm.fields);
    showAutoSyncToast(t('rotFieldFilled').replace('{crop}', translateCropName(field.crop)), 4000);
    return true;
}

// Changes from the field view section (wired in fields-table.js).
function handleRotationFieldViewChange(el, farm, field) {
    if (el.classList.contains('field-view-rotation')) { setFieldCycle(farm, field, el.value); return true; }
    if (el.classList.contains('field-view-rotation-step')) { setFieldCycleStep(farm, field, el.value); return true; }
    return false;
}

function handleRotationFieldViewClick(target, farm, field) {
    const info = fieldRotationInfo(farm, field);
    if (!info) return false;
    if (target.closest('.field-view-rotation-detect')) {
        setFieldRotationSlot(field, info.rot, detectRotationSlot(info.rot, field, loadSeasonHistory(farm, farm.currentSeason || 1), farm.currentSeason || 1));
        return true;
    }
    if (target.closest('.field-view-rotation-realign')) {
        setFieldRotationSlot(field, info.rot, rotationRealignIndex(info, field));
        return true;
    }
    return false;
}

// Realign: the nearest slot from here on whose crop is the one on the field.
function rotationRealignIndex(info, field) {
    for (let k = 0; k < info.length; k++) {
        if (cropOrderKey(rotationSlotAt(info.rot, info.index + k).crop) === cropOrderKey(field.crop)) return info.index + k;
    }
    return info.index;
}

// ---------- rotation window ----------
let rotationTab = 'plan';
let rotationSelectedId = null;
// Cycles ticked in the list for a bulk colour change or delete.
const rotationChecked = new Set();

function rotationCellHtml(e) {
    const crop = e.crops[0] || '';
    const text = e.crops.length ? e.crops.map(translateCropName).join(' / ') : (e.projected ? t('rotFallow') : '–');
    const cls = ['rotation-cell', e.projected ? 'is-projected' : '', e.generated ? 'is-generated' : '', e.current ? 'is-current' : '', crop ? '' : 'is-empty'].filter(Boolean).join(' ');
    const tip = `${t('season')} ${e.season}${e.generated ? ' · ' + t('rotByGenerator') : (e.projected ? ' · ' + t('rotProjected') : '')}${e.catchCrop ? ' · ' + t('catchCropShort') + ': ' + translateCropName(e.catchCrop) : ''}`;
    return `<span class="${cls}" style="--crop-color:${rotationCropColor(crop)}" title="${escapeHtml(tip)}">${e.generated ? '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ' : ''}${escapeHtml(text)}${e.catchCrop ? '<span class="rotation-catch" aria-hidden="true"></span>' : ''}</span>`;
}

// The Crop rotation view in the planner sidebar (rendered by openHubPanel).
function openRotationView(tab) {
    if (tab) rotationTab = tab;
    showPlannerView('rotation');
}

function renderRotationPanel(titleEl, bodyEl) {
    titleEl.textContent = t('rotTitle');
    const farm = getCurrentFarm();
    if (!farm) { bodyEl.innerHTML = ''; return; }
    const tabs = [['plan', 'fa-table-cells', 'rotTabPlan'], ['cycles', 'fa-arrows-spin', 'rotTabCycles'], ['generator', 'fa-wand-magic-sparkles', 'rotTabGenerator']].map(([k, icon, key]) =>
        `<button type="button" class="view-tab rotation-tab${k === rotationTab ? ' is-active' : ''}" role="tab" aria-selected="${k === rotationTab}" data-rtab="${k}"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${t(key)}</button>`).join('');
    bodyEl.innerHTML = `<div class="rotation-panel">
        <div class="view-tabs rotation-tabs" role="tablist">${tabs}</div>
        <div class="rotation-body">${rotationTab === 'cycles' ? rotationCyclesHtml(farm) : (rotationTab === 'generator' ? cropGeneratorHtml(farm) : rotationPlanHtml(farm))}</div>
    </div>`;
}

// Re-renders the view where it is (scroll kept).
function renderRotationModal() {
    if (currentPlannerView !== 'rotation') return;
    const scroll = hubView ? hubView.scrollTop : 0;
    openHubPanel('rotation');
    if (hubView) hubView.scrollTop = scroll;
}

// Grid: rows = fields, columns = past seasons, this one and the next ones.
const ROTATION_BACK = 3, ROTATION_AHEAD = 4;
function rotationPlanHtml(farm) {
    const season = farm.currentSeason || 1;
    const history = loadSeasonHistory(farm, season);
    const fields = sortFieldsForDisplay((farm.fields || []).filter(f => (f.number || '').toString().trim()), '');
    if (!fields.length) return `<p class="settings-hint">${t('rotNoFields')}</p>`;
    const first = Math.max(1, season - ROTATION_BACK);
    const cols = [];
    for (let s = first; s <= season + ROTATION_AHEAD; s++) cols.push(s);
    const nextArea = {};
    const rows = fields.map(field => {
        const idx = farm.fields.indexOf(field);
        const score = fieldRotationScore(farm, field, history);
        const seq = rotationTimeline(farm, field, history, season - first, ROTATION_AHEAD);
        const bySeason = {};
        seq.forEach(e => { bySeason[e.season] = e; });
        if (field.nextCrop || score.info) {
            const next = field.nextCrop ? field.nextCrop.crop || '' : rotationSlotAt(score.info.rot, score.info.index + 1).crop || '';
            nextArea[next] = (nextArea[next] || 0) + (parseFloat(field.area) || 0);
        }
        const tip = score.warnings.map(w => '• ' + w.text).join('\n') || t(score.level ? 'rotScoreOk' : 'rotScoreNone');
        const name = fieldNameOf(farm, field.number);
        const colCls = s => s === season ? 'is-current-col' : (s < season ? 'is-past-col' : '');
        return `<tr>
            <th scope="row" class="rotation-field-cell"><div class="rotation-field"><span class="rotation-dot is-${score.level || 'none'}" title="${escapeHtml(tip)}"></span><span class="field-number-chip">${escapeHtml(String(field.number))}</span>
                <span class="rotation-field-meta">${name ? `<span class="rotation-field-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>` : ''}<span class="rotation-field-ha">${(parseFloat(field.area) || 0).toFixed(2)} ha</span></span></div></th>
            <td class="rotation-assign"><div class="rotation-assign-inner">${rotationSelectHtml(farm, score.info ? score.info.rot.id : '', 'rotation-plan-cycle' + (score.info ? '' : ' is-none'), ` data-idx="${idx}" aria-label="${escapeHtml(t('rotFieldCycle'))}"`)}
                ${score.info ? `<span class="rotation-assign-step"><select class="rotation-plan-step" data-idx="${idx}" aria-label="${escapeHtml(t('rotFieldStep'))}">${rotationStepOptionsHtml(score.info.rot, score.info.index)}</select>${score.offCycle ? `<button type="button" class="rotation-plan-realign" data-idx="${idx}" title="${escapeHtml(t('rotRealignHint'))}"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i></button>` : ''}</span>` : ''}</div></td>
            ${cols.map(s => `<td class="${colCls(s)}">${bySeason[s] ? rotationCellHtml(bySeason[s]) : '<span class="rotation-cell is-empty">–</span>'}</td>`).join('')}
        </tr>`;
    }).join('');
    const areaList = Object.entries(nextArea).sort((a, b) => b[1] - a[1])
        .map(([c, ha]) => `<span class="rotation-area-chip" style="--crop-color:${rotationCropColor(c)}">${c ? escapeHtml(translateCropName(c)) : t('rotFallow')} · ${ha.toFixed(2)} ha</span>`).join('');
    const mode = rotationFillMode(farm);
    return `<div class="rotation-toolbar">
            <label class="settings-field rotation-mode"><span>${t('rotAutoFill')}</span>
                <select id="rotation-fill-mode">${['auto', 'ask', 'off'].map(m => `<option value="${m}" ${m === mode ? 'selected' : ''}>${t('rotAutoFill_' + m)}</option>`).join('')}</select></label>
            <span class="settings-hint">${t('rotAutoFillHint')}</span>
        </div>
        ${getRotations(farm).length ? '' : `<p class="settings-hint">${t('rotNoCyclesHint')}</p>`}
        <div class="rotation-grid-wrap"><table class="rotation-grid">
            <thead><tr><th class="rotation-field-cell">${t('thFieldNo')}</th><th class="rotation-assign">${t('rotFieldCycle')}</th>${cols.map(s => `<th class="${s === season ? 'is-current is-current-col' : (s > season ? 'is-projected' : 'is-past-col')}">${t('season')} ${s}${s === season ? ` <small>(${t('rotNow')})</small>` : ''}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
        <div class="rotation-legend">
            <span><span class="rotation-legend-cell is-current"></span>${t('rotLegendCurrent')}</span>
            <span><span class="rotation-legend-cell is-projected"></span>${t('rotLegendProjected')}</span>
            <span><span class="rotation-legend-catch"></span>${t('rotLegendCatch')}</span>
            <span><span class="rotation-dot is-green"></span><span class="rotation-dot is-yellow"></span><span class="rotation-dot is-red"></span>${t('rotLegendScore')}</span>
        </div>
        ${areaList ? `<div class="rotation-next-area"><strong>${t('rotNextArea').replace('{n}', season + 1)}</strong> ${areaList}</div>` : ''}`;
}

function rotationCyclesHtml(farm) {
    const rots = getRotations(farm);
    if (rotationSelectedId && !rots.some(r => r.id === rotationSelectedId)) rotationSelectedId = null;
    if (!rotationSelectedId && rots.length) rotationSelectedId = rots[0].id;
    const used = id => (farm.fields || []).filter(f => f.rotation && f.rotation.id === id).length;
    const templates = ROTATION_TEMPLATES.filter(tpl => rotationTemplateSteps(tpl).length >= 2);
    const others = getAllFarms().filter(f => f.id !== farm.id && Array.isArray(f.rotations) && f.rotations.length);
    Array.from(rotationChecked).forEach(id => { if (!rots.some(r => r.id === id)) rotationChecked.delete(id); });
    const list = rots.map(r => `<div class="rotation-cycle-row${rotationChecked.has(r.id) ? ' is-checked' : ''}">
        <input type="checkbox" class="rotation-cycle-check" data-id="${escapeHtml(r.id)}" ${rotationChecked.has(r.id) ? 'checked' : ''} aria-label="${escapeHtml(t('rotSelectCycle').replace('{name}', r.name))}">
        <button type="button" class="rotation-cycle-item${r.id === rotationSelectedId ? ' is-active' : ''}" data-id="${escapeHtml(r.id)}">
            <span class="rotation-swatch" style="background:${rotationColor(r)}"></span>
            <span class="rotation-cycle-name">${escapeHtml(r.name)}</span>
            <span class="rotation-cycle-meta">${escapeHtml(r.steps.map(s => s.crop ? translateCropName(s.crop) : t('rotFallow')).join(' → '))}</span>
            <span class="rotation-cycle-count" title="${escapeHtml(t('rotFieldsUsing'))}">${used(r.id)}</span>
        </button>
    </div>`).join('');
    const checkedRots = rots.filter(r => rotationChecked.has(r.id));
    const firstColor = checkedRots.length ? rotationColor(checkedRots[0]) : ROTATION_COLORS[0];
    const bulk = rots.length > 1 || checkedRots.length ? `<div class="rotation-bulk${checkedRots.length ? ' is-active' : ''}">
            <label class="rotation-bulk-all"><input type="checkbox" class="rotation-check-all" ${checkedRots.length === rots.length ? 'checked' : ''}> ${checkedRots.length ? t('rotSelectedCount').replace('{n}', checkedRots.length) : t('rotSelectAll')}</label>
            ${checkedRots.length ? `<div class="rotation-bulk-tools">
                <span class="rotation-bulk-colors">${ROTATION_COLORS.map(c => `<button type="button" class="rotation-bulk-color" data-color="${c}" style="background:${c}" title="${escapeHtml(t('rotColorSelected'))}" aria-label="${escapeHtml(t('rotColorSelected'))} ${c}"></button>`).join('')}
                <input type="color" class="rotation-bulk-custom" value="${firstColor}" title="${escapeHtml(t('rotColorSelected'))}"></span>
                <button type="button" class="settings-btn reset-btn rotation-bulk-delete">${t('rotDeleteSelected')}</button>
                <button type="button" class="settings-btn rotation-bulk-clear">${t('rotClearSelection')}</button>
            </div>` : ''}
        </div>` : '';
    const rot = rotationById(farm, rotationSelectedId);
    let editor = `<p class="settings-hint">${t('rotNoCyclesHint')}</p>`;
    if (rot) {
        const warnings = rotationCycleWarnings(rot, grasslandSeasonLimit(farm));
        editor = `<div class="rotation-editor-head">
                <input type="text" class="rotation-name" maxlength="40" value="${escapeHtml(rot.name)}" placeholder="${escapeHtml(t('rotName'))}">
                <input type="color" class="rotation-color" value="${rotationColor(rot)}" title="${escapeHtml(t('rotColor'))}">
                <button type="button" class="settings-btn rotation-duplicate">${t('rotDuplicate')}</button>
                <button type="button" class="settings-btn reset-btn rotation-delete">${t('delete')}</button>
            </div>
            <table class="rotation-steps">
                <thead><tr><th>#</th><th>${t('thCrop')}</th><th>${t('thCatchCrop')}</th><th>${t('thSowingMth')}</th><th>${t('rotSeasons')}</th><th></th></tr></thead>
                <tbody>${rot.steps.map((s, i) => `<tr data-step="${i}">
                    <td class="rotation-step-n">${i + 1}</td>
                    <td><select class="rotation-step-crop">${cropOptionsHtml(s.crop, t('rotFallow'))}</select></td>
                    <td><select class="rotation-step-catch">${cropOptionsHtml(s.catchCrop, t('catchCropNone'), true)}</select></td>
                    <td><select class="rotation-step-sow">${rotationStepMonthOptions(s)}</select></td>
                    <td><input type="number" min="1" max="30" step="1" class="rotation-step-seasons" value="${Math.max(1, parseInt(s.seasons, 10) || 1)}"></td>
                    <td class="rotation-step-tools">
                        <button type="button" class="feed-ration-tool rotation-step-up" title="${escapeHtml(t('rotMoveUp'))}" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
                        <button type="button" class="feed-ration-tool rotation-step-down" title="${escapeHtml(t('rotMoveDown'))}" ${i === rot.steps.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>
                        <button type="button" class="feed-ration-tool feed-ration-tool--danger rotation-step-remove" title="${escapeHtml(t('delete'))}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                    </td>
                </tr>`).join('')}</tbody>
            </table>
            <button type="button" class="settings-btn rotation-step-add">+ ${t('rotAddStep')}</button>
            ${warnings.length ? `<ul class="rotation-warnings">${warnings.map(w => `<li class="is-${w.level}">${escapeHtml(w.text)}</li>`).join('')}</ul>` : (rot.steps.length > 1 ? `<p class="rotation-ok"><span class="rotation-dot is-green"></span>${t('rotCycleOk')}</p>` : '')}`;
    }
    return `<div class="rotation-cycles">
        <div class="rotation-cycle-list">
            ${bulk}
            ${list || `<p class="settings-hint">${t('rotNoCycles')}</p>`}
            <button type="button" class="settings-btn rotation-new">+ ${t('rotNew')}</button>
            <select class="rotation-template"><option value="">${t('rotFromTemplate')}</option>${templates.map(tpl => `<option value="${tpl.key}">${escapeHtml(t('rotTpl_' + tpl.key))}</option>`).join('')}</select>
            ${others.length ? `<select class="rotation-copy-farm"><option value="">${t('rotCopyFrom')}</option>${others.map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)} (${f.rotations.length})</option>`).join('')}</select>` : ''}
        </div>
        <div class="rotation-cycle-editor">${editor}</div>
    </div>`;
}

function rotationStepMonthOptions(step) {
    const cal = step.crop && CROP_CALENDAR[step.crop];
    const auto = rotationDefaultSowMonth(step.crop);
    let html = `<option value="">${t('rotSowAuto')}${auto ? ' (' + translateMonth(auto) + ')' : ''}</option>`;
    if (cal) ALL_MONTHS.filter(m => cal[m]).forEach(m => { html += `<option value="${m}" ${step.sowingMonth === m ? 'selected' : ''}>${translateMonth(m)}</option>`; });
    return html;
}

function saveRotations(farm) {
    saveFarmData(farm);
    renderRotationModal();
}

function addRotation(farm, rot) {
    const rots = getRotations(farm);
    rot.id = newRotationId();
    if (!rot.color) rot.color = ROTATION_COLORS[rots.length % ROTATION_COLORS.length];
    rots.push(rot);
    rotationSelectedId = rot.id;
    rotationTab = 'cycles';
    saveRotations(farm);
}

(function wireRotationView() {
    const body = document.getElementById('hub-panel-body');
    if (!body) return;
    body.addEventListener('click', e => {
        const tab = e.target.closest('.rotation-tab');
        if (tab) { rotationTab = tab.dataset.rtab; renderRotationModal(); }
    });

    const selectedRot = farm => rotationById(farm, rotationSelectedId);
    const stepOf = el => { const tr = el.closest('tr[data-step]'); return tr ? +tr.dataset.step : -1; };

    body.addEventListener('change', async e => {
        const el = e.target;
        const farm = getCurrentFarm();
        if (!farm || !el.closest('.rotation-panel')) return;
        if (el.id === 'rotation-fill-mode') { farm.rotationAutoFill = el.value; saveFarmData(farm); return; }
        if (el.classList.contains('rotation-cycle-check')) {
            if (el.checked) rotationChecked.add(el.dataset.id); else rotationChecked.delete(el.dataset.id);
            renderRotationModal();
            return;
        }
        if (el.classList.contains('rotation-check-all')) {
            rotationChecked.clear();
            if (el.checked) getRotations(farm).forEach(r => rotationChecked.add(r.id));
            renderRotationModal();
            return;
        }
        if (el.classList.contains('rotation-bulk-custom')) {
            if (/^#[0-9a-f]{6}$/i.test(el.value)) getRotations(farm).forEach(r => { if (rotationChecked.has(r.id)) r.color = el.value; });
            saveRotations(farm);
            return;
        }
        if (el.classList.contains('rotation-plan-cycle') || el.classList.contains('rotation-plan-step')) {
            const field = farm.fields[+el.dataset.idx];
            if (!field) return;
            if (el.classList.contains('rotation-plan-cycle')) setFieldCycle(farm, field, el.value);
            else setFieldCycleStep(farm, field, el.value);
            saveRotations(farm);
            return;
        }
        if (el.classList.contains('rotation-template') && el.value) {
            const tpl = ROTATION_TEMPLATES.find(x => x.key === el.value);
            if (tpl) addRotation(farm, { name: t('rotTpl_' + tpl.key).split(/ \(| — /)[0], steps: rotationTemplateSteps(tpl) });
            return;
        }
        if (el.classList.contains('rotation-copy-farm') && el.value) {
            const src = getAllFarms().find(f => f.id === el.value);
            const copies = (src && src.rotations || []).map(r => ({ ...JSON.parse(JSON.stringify(r)), id: newRotationId() }));
            getRotations(farm).push(...copies);
            if (copies.length) rotationSelectedId = copies[0].id;
            saveRotations(farm);
            return;
        }
        const rot = selectedRot(farm);
        if (!rot) return;
        if (el.classList.contains('rotation-name')) rot.name = el.value.trim().slice(0, 40) || rot.name;
        else if (el.classList.contains('rotation-color')) rot.color = /^#[0-9a-f]{6}$/i.test(el.value) ? el.value : rot.color;
        else {
            const step = rot.steps[stepOf(el)];
            if (!step) return;
            if (el.classList.contains('rotation-step-crop')) {
                step.crop = el.value;
                step.sowingMonth = '';
                if (isPerennialCrop(step.crop) && (parseInt(step.seasons, 10) || 1) < 2) step.seasons = grasslandSeasonLimit(farm);
                if (!isPerennialCrop(step.crop)) step.seasons = 1;
            } else if (el.classList.contains('rotation-step-catch')) step.catchCrop = el.value;
            else if (el.classList.contains('rotation-step-sow')) step.sowingMonth = el.value;
            else if (el.classList.contains('rotation-step-seasons')) step.seasons = Math.min(30, Math.max(1, parseInt(el.value, 10) || 1));
        }
        saveRotations(farm);
    });

    body.addEventListener('click', async e => {
        const farm = getCurrentFarm();
        if (!farm || !e.target.closest('.rotation-panel')) return;
        const item = e.target.closest('.rotation-cycle-item');
        if (item) {
            // Ctrl/Shift-click ticks the cycle instead of opening it.
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
                if (rotationChecked.has(item.dataset.id)) rotationChecked.delete(item.dataset.id); else rotationChecked.add(item.dataset.id);
            } else rotationSelectedId = item.dataset.id;
            renderRotationModal();
            return;
        }
        const bulkColor = e.target.closest('.rotation-bulk-color');
        if (bulkColor) {
            getRotations(farm).forEach(r => { if (rotationChecked.has(r.id)) r.color = bulkColor.dataset.color; });
            saveRotations(farm);
            return;
        }
        if (e.target.closest('.rotation-bulk-clear')) { rotationChecked.clear(); renderRotationModal(); return; }
        if (e.target.closest('.rotation-bulk-delete')) {
            const doomed = getRotations(farm).filter(r => rotationChecked.has(r.id));
            if (!doomed.length) return;
            const ids = new Set(doomed.map(r => r.id));
            const users = (farm.fields || []).filter(f => f.rotation && ids.has(f.rotation.id));
            const ok = await showConfirm({
                title: t('rotDeleteManyTitle').replace('{n}', doomed.length),
                body: doomed.map(r => r.name).join(', ') + '. ' + (users.length ? t('rotDeleteManyUsed').replace('{n}', users.length) : t('rotDeleteManyBody')),
                confirmText: t('delete'), danger: true
            });
            if (ok !== true) return;
            users.forEach(f => { delete f.rotation; });
            farm.rotations = getRotations(farm).filter(r => !ids.has(r.id));
            if (ids.has(rotationSelectedId)) rotationSelectedId = null;
            rotationChecked.clear();
            saveRotations(farm);
            return;
        }
        if (e.target.closest('.rotation-new')) {
            addRotation(farm, { name: t('rotNewName').replace('{n}', getRotations(farm).length + 1), steps: [{ crop: '', catchCrop: '', sowingMonth: '', seasons: 1 }] });
            const name = body.querySelector('.rotation-name');
            if (name) { name.focus(); name.select(); }
            return;
        }
        const realign = e.target.closest('.rotation-plan-realign');
        if (realign) {
            const field = farm.fields[+realign.dataset.idx];
            const info = field && fieldRotationInfo(farm, field);
            if (info) { setFieldRotationSlot(field, info.rot, rotationRealignIndex(info, field)); saveRotations(farm); }
            return;
        }
        const rot = selectedRot(farm);
        if (!rot) return;
        if (e.target.closest('.rotation-duplicate')) {
            addRotation(farm, { ...JSON.parse(JSON.stringify(rot)), name: rot.name + ' ' + t('rotCopySuffix'), color: null });
            return;
        }
        if (e.target.closest('.rotation-delete')) {
            const users = (farm.fields || []).filter(f => f.rotation && f.rotation.id === rot.id);
            const ok = await showConfirm({
                title: t('rotDeleteTitle').replace('{name}', rot.name),
                body: users.length ? t('rotDeleteUsed').replace('{n}', users.length) : t('rotDeleteBody'),
                confirmText: t('delete'), danger: true
            });
            if (ok !== true) return;
            users.forEach(f => { delete f.rotation; });
            farm.rotations = getRotations(farm).filter(r => r.id !== rot.id);
            rotationSelectedId = null;
            saveRotations(farm);
            return;
        }
        if (e.target.closest('.rotation-step-add')) {
            rot.steps.push({ crop: '', catchCrop: '', sowingMonth: '', seasons: 1 });
            saveRotations(farm);
            return;
        }
        const i = stepOf(e.target);
        if (i < 0) return;
        // Fields stay on the same step (crop) when steps move: old index -> new.
        const remap = fn => (farm.fields || []).forEach(f => {
            if (!f.rotation || f.rotation.id !== rot.id) return;
            const to = fn(f.rotation.step);
            if (to < 0 || to >= rot.steps.length) { f.rotation.step = 0; f.rotation.stepSeason = 1; }
            else f.rotation.step = to;
        });
        const swap = j => {
            [rot.steps[i], rot.steps[j]] = [rot.steps[j], rot.steps[i]];
            remap(s => (s === i ? j : (s === j ? i : s)));
        };
        if (e.target.closest('.rotation-step-up') && i > 0) swap(i - 1);
        else if (e.target.closest('.rotation-step-down') && i < rot.steps.length - 1) swap(i + 1);
        else if (e.target.closest('.rotation-step-remove')) {
            if (rot.steps.length <= 1) return;
            rot.steps.splice(i, 1);
            // A field on the removed step starts the cycle over.
            remap(s => (s === i ? -1 : (s > i ? s - 1 : s)));
        } else return;
        saveRotations(farm);
    });
})();
