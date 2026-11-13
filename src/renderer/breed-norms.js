// Breed norms (Normy rasy): a view of its own in the planner sidebar. A classic
// <script> loaded after feed.js and before renderer.js (see index.html): only
// definitions here, everything runs when the view is opened.
//
// Read-only: what one breed eats and gives per in-game month at a given age,
// and for a herd you type in — the same curves and scales the planner uses
// (ANIMAL_NEEDS_DATA, AnimalFoodCalculator's consumption scale for food,
// water and straw, the barn's ration for milk, eggs and wool). EAS lactation
// isn't in it: it depends on when each animal calved.
let breedNormsState = { subType: null, count: 1, age: 24 };

// Breeds with curves, those in the farm's barns first.
// inBarns: subType -> { heads, ageSum, barnId } (barnId = the first barn holding them).
function breedNormsBreeds(farm) {
    const inBarns = new Map();
    ((farm && farm.animalBuildings) || []).forEach(b => (b.clusters || []).forEach(c => {
        const e = inBarns.get(c.subType) || { heads: 0, ageSum: 0, barnId: b.id };
        e.heads += c.numAnimals;
        e.ageSum += c.age * c.numAnimals;
        inBarns.set(c.subType, e);
    }));
    const all = Object.keys(ANIMAL_NEEDS_DATA).filter(st => {
        const d = ANIMAL_NEEDS_DATA[st];
        return d && ((d.food && d.food.length) || (d.production && Object.keys(d.production).length));
    });
    const byName = (a, b) => String(formatAnimalName(a)).localeCompare(String(formatAnimalName(b)));
    return { inBarns, own: all.filter(st => inBarns.has(st)).sort(byName), rest: all.filter(st => !inBarns.has(st)).sort(byName) };
}

function breedNormsDefaults(farm, subType) {
    const e = breedNormsBreeds(farm).inBarns.get(subType);
    return { subType, count: e ? e.heads : 1, age: e && e.heads ? Math.round(e.ageSum / e.heads) : 24 };
}

// Per head and in-game month: { rows: [{ key, label, perHead, out }], ration, scale }.
function breedNormsRows(farm, subType, age, barnId) {
    const def = ANIMAL_NEEDS_DATA[subType] || {};
    const scale = feedConsumptionScale(farm);
    const rows = [];
    ['food', 'water', 'straw'].forEach(k => {
        if (def[k] && def[k].length) rows.push({ key: k, label: t('breedNorm_' + k), perHead: interpolateNeedCurve(def[k], age) * scale, out: false });
    });
    const type = animalTypeOf(subType);
    const ration = type && barnId != null ? resolveRation(type, getFeedPlan(farm), barnId) : null;
    const eff = ration ? ration.efficiency / 100 : 1;
    Object.keys(def.production || {}).forEach(ft => {
        const v = interpolateNeedCurve(def.production[ft], age) * (FEED_UNSCALED_OUTPUT.includes(ft) ? 1 : eff);
        rows.push({ key: ft, label: formatFillType(ft), perHead: v, out: true });
    });
    return { rows, ration, scale };
}

// The age range the chart shows: a little past the end of the breed's curves
// (they stay flat from there), at least a year, and the age typed in.
function breedNormsMaxAge(subType, age) {
    const def = ANIMAL_NEEDS_DATA[subType] || {};
    const keys = [def.food, ...Object.values(def.production || {})].flatMap(c => (c || []).map(p => p.ageMonth));
    if (!keys.length) return 0;
    return Math.max(12, Math.ceil(Math.max(...keys) * 1.25 / 6) * 6, Math.ceil(age));
}

// Food (and the main product) over the breed's age range, with a marker at
// `age` and the age axis under it. A click or a drag on it picks the age.
const BREED_CURVE_W = 640, BREED_CURVE_H = 220, BREED_CURVE_P = 6;
function breedNormsCurveHtml(subType, age) {
    const def = ANIMAL_NEEDS_DATA[subType] || {};
    const main = Object.keys(def.production || {}).find(ft => !FEED_UNSCALED_OUTPUT.includes(ft));
    const lines = [{ label: t('breedNorm_food'), curve: def.food, cls: 'breed-curve-food' }];
    if (main) lines.push({ label: formatFillType(main), curve: def.production[main], cls: 'breed-curve-out' });
    const maxAge = breedNormsMaxAge(subType, age);
    if (!maxAge) return '';
    const W = BREED_CURVE_W, H = BREED_CURVE_H, P = BREED_CURVE_P;
    const x = a => P + (Math.max(0, Math.min(a, maxAge)) / maxAge) * (W - 2 * P);
    let svg = '';
    // A line every 6 or 12 months, so the age can be read off the chart.
    const step = maxAge > 72 ? 12 : 6;
    for (let a = step; a < maxAge; a += step) svg += `<line class="breed-curve-grid" x1="${x(a).toFixed(1)}" x2="${x(a).toFixed(1)}" y1="0" y2="${H}"/>`;
    lines.forEach(l => {
        if (!l.curve || !l.curve.length) return;
        const top = Math.max(...l.curve.map(p => p.value)) || 1;
        const y = v => H - P - (v / top) * (H - 2 * P);
        const pts = [];
        for (let i = 0; i <= 120; i++) {
            const a = maxAge * i / 120;
            pts.push(`${x(a).toFixed(1)},${y(interpolateNeedCurve(l.curve, a)).toFixed(1)}`);
        }
        svg += `<polyline class="${l.cls}" points="${pts.join(' ')}"/>`;
    });
    svg += `<line class="breed-curve-marker" x1="${x(age).toFixed(1)}" x2="${x(age).toFixed(1)}" y1="0" y2="${H}"/>`;
    const ticks = [];
    for (let a = 0; a <= maxAge; a += step) ticks.push(`<span style="left:${(x(a) / W * 100).toFixed(2)}%">${a}</span>`);
    const legend = lines.filter(l => l.curve && l.curve.length)
        .map(l => `<span class="breed-curve-key ${l.cls}">${escapeHtml(l.label)}</span>`).join('');
    return `<figure class="breed-curve-wrap">
        <svg class="breed-curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-max-age="${maxAge}" role="slider"
            aria-label="${escapeHtml(t('breedNormsAge'))}" aria-valuemin="0" aria-valuemax="${Math.round(maxAge)}" aria-valuenow="${age}">${svg}</svg>
        <div class="breed-curve-ticks" aria-hidden="true">${ticks.join('')}</div>
        <figcaption>${legend}<span class="breed-curve-axis">${t('breedNormsAxis').replace('{max}', Math.round(maxAge))} · ${t('breedNormsChartHint')}</span></figcaption>
    </figure>`;
}

// The age under a point of the chart (clientX), in whole months.
function breedNormsAgeAt(svg, clientX) {
    const r = svg.getBoundingClientRect();
    const maxAge = parseFloat(svg.dataset.maxAge) || 0;
    if (!r.width || !maxAge) return null;
    const vx = (clientX - r.left) / r.width * BREED_CURVE_W;
    return Math.round(Math.max(0, Math.min(1, (vx - BREED_CURVE_P) / (BREED_CURVE_W - 2 * BREED_CURVE_P))) * maxAge);
}

function breedNormsResultHtml(farm) {
    const st = breedNormsState;
    if (!ANIMAL_NEEDS_DATA[st.subType]) return '';
    const barn = breedNormsBreeds(farm).inBarns.get(st.subType);
    const { rows, ration, scale } = breedNormsRows(farm, st.subType, st.age, barn ? barn.barnId : null);
    if (!rows.length) return `<p class="hub-panel-note">${t('breedNormsNoCurves')}</p>`;
    const days = feedDaysPerPeriod(farm);
    const num = v => v.toLocaleString(FIN_LOCALE(), { maximumFractionDigits: v !== 0 && Math.abs(v) < 10 ? 2 : 0 });
    const body = group => rows.filter(r => r.out === group).map(r => `<tr>
            <td>${escapeHtml(r.label)}</td>
            <td>${num(r.perHead)} l</td>
            <td>${num(r.perHead * st.count)} l<span class="breed-norms-day">${num(r.perHead * st.count / days)} l ${t('breedNormsPerDay')}</span></td>
        </tr>`).join('');
    const head = (label, group) => rows.some(r => r.out === group)
        ? `<tr class="breed-norms-group"><th colspan="3">${label}</th></tr>${body(group)}` : '';
    const notes = [t('breedNormsNote').replace('{days}', days)];
    if (scale !== 1) notes.push(t('breedNormsAfc').replace('{x}', scale.toLocaleString(FIN_LOCALE(), { maximumFractionDigits: 2 })));
    notes.push(ration
        ? t('breedNormsRation').replace('{ration}', ration.name || t('feedRation_' + ration.id)).replace('{pct}', ration.efficiency)
        : t('breedNormsFullRation'));
    const pic = animalPictureUrl(st.subType, st.age);
    return `<div class="breed-norms-body">
        <div class="breed-norms-chart">${breedNormsCurveHtml(st.subType, st.age)}</div>
        <div class="breed-norms-figures">
            ${pic ? `<span class="animal-pic breed-norms-pic"><img src="${escapeHtml(pic)}" alt="" draggable="false"></span>` : ''}
            <table class="data-table supply-table breed-norms-table"><thead><tr>
                <th></th><th>${t('breedNormsPerHead')}</th><th>${t('breedNormsHerd').replace('{n}', st.count.toLocaleString(FIN_LOCALE()))}</th>
            </tr></thead><tbody>
                ${head(t('breedNormsNeeds'), false)}
                ${head(t('breedNormsGives'), true)}
            </tbody></table>
        </div>
    </div>
    <ul class="breed-norms-notes">${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`;
}

// Opens the view on one breed at one age (e.g. from a barn).
function openBreedNorms(subType, age) {
    const farm = getCurrentFarm();
    if (subType && ANIMAL_NEEDS_DATA[subType]) {
        breedNormsState = breedNormsDefaults(farm, subType);
        if (age != null) breedNormsState.age = Math.max(0, Math.round(age));
    }
    showPlannerView('breednorms');
}

function renderBreedNormsPanel(titleEl, bodyEl) {
    titleEl.textContent = t('breedNormsTitle');
    const farm = getCurrentFarm();
    const { own, rest } = breedNormsBreeds(farm);
    if (!own.length && !rest.length) { bodyEl.innerHTML = `<p class="hub-panel-note">${t('breedNormsNoCurves')}</p>`; return; }
    if (!ANIMAL_NEEDS_DATA[breedNormsState.subType]) breedNormsState = breedNormsDefaults(farm, own[0] || rest[0]);
    const st = breedNormsState;
    const opt = s => `<option value="${escapeHtml(s)}" ${s === st.subType ? 'selected' : ''}>${escapeHtml(formatAnimalName(s))}</option>`;
    const options = (own.length ? `<optgroup label="${escapeHtml(t('breedNormsInBarns'))}">${own.map(opt).join('')}</optgroup>` : '')
        + (rest.length ? `<optgroup label="${escapeHtml(t('breedNormsAllBreeds'))}">${rest.map(opt).join('')}</optgroup>` : '');
    bodyEl.innerHTML = `<div class="breed-norms">
        <p class="supply-intro">${t('breedNormsIntro')}</p>
        <div class="breed-norms-controls">
            <label class="settings-field"><span>${t('breedNormsBreed')}</span><select class="breed-norms-breed">${options}</select></label>
            <label class="settings-field"><span>${t('breedNormsCount')}</span><input type="number" class="breed-norms-count" min="1" max="100000" step="1" value="${st.count}"></label>
            <label class="settings-field"><span>${t('breedNormsAge')}</span><input type="number" class="breed-norms-age" min="0" max="600" step="1" value="${st.age}"></label>
        </div>
        <div class="breed-norms-result">${breedNormsResultHtml(farm)}</div>
    </div>`;
    wireBreedNorms(bodyEl, farm);
}

// Only the result is redrawn while typing or dragging, so the inputs keep focus.
function wireBreedNorms(root, farm) {
    const box = root.querySelector('.breed-norms');
    if (!box) return;
    const result = box.querySelector('.breed-norms-result');
    const ageInput = box.querySelector('.breed-norms-age');
    const redraw = () => { result.innerHTML = breedNormsResultHtml(farm); };
    box.querySelector('.breed-norms-breed').addEventListener('change', e => {
        breedNormsState = breedNormsDefaults(farm, e.target.value);
        box.querySelector('.breed-norms-count').value = breedNormsState.count;
        ageInput.value = breedNormsState.age;
        redraw();
    });
    const watch = (el, min, max, key) => el.addEventListener('input', () => {
        const v = parseInt(el.value, 10);
        if (isNaN(v)) return;
        breedNormsState[key] = Math.min(max, Math.max(min, v));
        redraw();
    });
    watch(box.querySelector('.breed-norms-count'), 1, 100000, 'count');
    watch(ageInput, 0, 600, 'age');
    // The chart is drawn again on every move, so the drag follows the pointer, not the element.
    const setAge = clientX => {
        const svg = result.querySelector('.breed-curve');
        const age = svg ? breedNormsAgeAt(svg, clientX) : null;
        if (age === null || age === breedNormsState.age) return;
        breedNormsState.age = age;
        ageInput.value = age;
        redraw();
    };
    result.addEventListener('pointerdown', e => {
        if (!e.target.closest('.breed-curve')) return;
        e.preventDefault();
        setAge(e.clientX);
        const move = ev => setAge(ev.clientX);
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
}
