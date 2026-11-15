// AFC editor: a developer tool (only when IS_DEV_BUILD, i.e. `npm start`)
// that edits what each breed eats and gives in AnimalFoodCalculator's
// xmls/animals.xml, inside FS25_AnimalFoodCalculator.zip in the mods folder.
// A classic <script> after mod-manager.js; the logic is in afc-editor-core.js.
// Opened from Settings → Developer. Every saved curve is also kept in
// Documents\Farmer Planner\afc-editor\changes.json, to put back on a new
// version of the mod.
const afcCore = require('./afc-editor-core');

const afcEd = {
    zip: null,          // path of the mod zip
    version: '',
    xml: null,          // animals.xml as in the zip
    breeds: [],         // afcParseAnimals(xml)
    sel: null,          // subType shown
    filter: '',
    edits: {},          // curveId -> keys, only curves changed and not saved
    busy: false,
    message: null,      // { text, error }
    // Herd comparison: which farm's prices, AFC scale and barns; one breed or
    // the farm's whole herd; the breed's head count and age.
    farmId: null,
    farmCtx: null,      // afcEdFarmContext() of farmId
    scope: 'breed',
    period: 'year',     // the comparison per 'month' or per 'year'
    eas: true,          // count EnhancedAnimalSystem's lactation when the farm has it
    count: 10,
    age: 24,
    open: new Set(),    // curve ids whose point table is open
    closedGroups: new Set()
};

function afcEdDataPath(...parts) {
    return path.join(appDataDir, ...parts);
}
const AFC_ED_BACKUPS = () => afcEdDataPath('backups', 'afc-mod');
const AFC_ED_CHANGES = () => afcEdDataPath('afc-editor', 'changes.json');

function afcEdReadChanges() {
    try {
        const c = JSON.parse(fs.readFileSync(AFC_ED_CHANGES(), 'utf-8'));
        return c && typeof c.curves === 'object' ? c : { curves: {} };
    } catch { return { curves: {} }; }
}

function afcEdWriteChanges(changes) {
    fs.mkdirSync(path.dirname(AFC_ED_CHANGES()), { recursive: true });
    fs.writeFileSync(AFC_ED_CHANGES(), JSON.stringify(changes, null, 2), 'utf-8');
}

// The mod zip: the one picked before, else the game's mods folder (or the
// folder gameSettings.xml points the game at).
function afcEdFindZip() {
    const saved = getSetting('afcEditorZip');
    if (saved && fs.existsSync(saved)) return saved;
    const gameDir = tlGameDir();
    const dirs = [path.join(gameDir, 'mods')];
    const ov = mmCore.readOverride(gameDir);
    if (ov && ov.active && ov.directory) dirs.unshift(ov.directory);
    for (const d of dirs) {
        const zip = path.join(d, afcCore.AFC_EDITOR_MOD + '.zip');
        if (fs.existsSync(zip)) return zip;
    }
    return null;
}

function afcEdLoad(zip) {
    afcEd.zip = zip;
    afcEd.xml = null;
    afcEd.breeds = [];
    afcEd.edits = {};
    if (!zip) return;
    try {
        const r = afcCore.afcReadZip(zip);
        afcEd.xml = r.xml;
        afcEd.version = r.version;
        afcEd.breeds = afcCore.afcParseAnimals(r.xml);
    } catch (e) {
        afcEd.message = { text: t('afcEdReadError').replace('{msg}', e.message), error: true };
    }
    if (!afcEd.breeds.some(b => b.subType === afcEd.sel)) afcEd.sel = afcEd.breeds.length ? afcEd.breeds[0].subType : null;
}

function afcEdOpen() {
    if (!IS_DEV_BUILD) return;
    const view = document.getElementById('afced-view');
    if (!view) return;
    if (dashboardView) dashboardView.style.display = 'none';
    view.hidden = false;
    afcEd.message = null;
    afcEdLoad(afcEdFindZip());
    afcEdPickFarm(getSetting('afcEditorFarm'));
    afcEdHerdDefaults();
    afcEdRender();
}

// ---------- the farm to compare with ----------
function afcEdFarms() {
    return getAllFarms().filter(f => f.saveGamePath || f.devMarket);
}

// Prices (year average per 1000 l), AFC's scale and curve source, feed plan and barns of a farm.
function afcEdFarmContext(farm) {
    if (!farm) return null;
    const market = getFarmMarket(farm);
    const prices = {};
    Object.keys((market && market.prices) || {}).forEach(ft => {
        const vals = market.prices[ft].filter(v => v != null);
        if (vals.length) prices[ft] = vals.reduce((s, v) => s + v, 0) / vals.length;
    });
    let mods = null;
    try { mods = farm.saveGamePath ? readAnimalMods(farm.saveGamePath, disabledModsOf(farm)) : null; }
    catch (e) { console.warn('AFC editor: animal mods of the farm unreadable', e); }
    const afc = mods && mods.afc;
    return { farm, prices, hasPrices: Object.keys(prices).length > 0, afc, eas: (mods && mods.eas) || null, scale: afc ? afc.scale : 1, plan: getFeedPlan(farm) };
}

function afcEdPickFarm(id) {
    const farms = afcEdFarms();
    const farm = farms.find(f => String(f.id) === String(id)) || null;
    afcEd.farmId = farm ? farm.id : null;
    afcEd.farmCtx = afcEdFarmContext(farm);
    if (!farm && afcEd.scope === 'farm') afcEd.scope = 'breed';
}

// Head count and age of the breed: the farm's herd of it when it has one.
function afcEdHerdDefaults() {
    const farm = afcEd.farmCtx && afcEd.farmCtx.farm;
    let heads = 0, ageSum = 0;
    ((farm && farm.animalBuildings) || []).forEach(b => (b.clusters || []).forEach(c => {
        if (c.subType !== afcEd.sel) return;
        heads += c.numAnimals;
        ageSum += c.age * c.numAnimals;
    }));
    afcEd.count = heads || 10;
    afcEd.age = heads ? Math.round(ageSum / heads) : 24;
}

// The species of a breed: the mod's <animal type>, else the planner's guess.
function afcEdTypeOf(subType) {
    const b = afcEd.breeds.find(x => x.subType === subType);
    return (b && b.type) || animalTypeOf(subType);
}

// The ration a group eats on the farm (default ration of the species without a farm).
// A mixer ration can only be read for the farm open in the planner.
function afcEdRation(subType, barnId) {
    const ctx = afcEd.farmCtx;
    const type = afcEdTypeOf(subType);
    const plan = ctx ? ctx.plan : getFeedPlan(null);
    const r = type ? resolveRation(type, plan, barnId) : null;
    const asked = barnId != null && plan.barnRations && plan.barnRations[barnId] ? plan.barnRations[barnId][type] : plan.rations[type];
    const mixerLost = !!(asked && String(asked).startsWith('mixer:') && (!ctx || ctx.farm.id !== currentFarmId));
    return { ration: r, mixerLost };
}

// EAS lactation factors of a group's next 12 months (null when EAS isn't counted).
// A group typed in has no breeding state of its own: it's taken as inseminated,
// having calved already once it's old enough to breed.
function afcEdEasMonths(c) {
    const eas = afcEd.eas && afcEd.farmCtx && afcEd.farmCtx.eas;
    if (!eas) return null;
    const type = afcEdTypeOf(c.subType);
    const def = getReproductionDef(c.subType);
    const minAge = def ? parseFloat(def.minAgeMonth) || 0 : 0;
    const state = 'hadABirth' in c ? c : { ...c, hadABirth: c.age >= minAge, isInseminated: true, monthsSinceLastBirth: 0, reproduction: 0 };
    return projectedClusterMonths(state).map(m => {
        const milk = easMilkFactor(eas, type, m);
        return { food: easFoodFactor(eas, type, m), milk: milk === null ? 1 : milk };
    });
}

// The groups the comparison counts: the breed typed in, or every group of the farm's barns.
function afcEdHerdGroups() {
    const out = { groups: [], mixerLost: false, barns: [] };
    const push = (id, c, barnId) => {
        const { ration, mixerLost } = afcEdRation(c.subType, barnId);
        if (mixerLost) out.mixerLost = true;
        out.groups.push({
            id, subType: c.subType, numAnimals: c.numAnimals, age: c.age,
            efficiency: ration ? ration.efficiency / 100 : 1,
            ingredients: ration ? ration.ingredients : null, absolute: !!(ration && ration.absolute),
            months: afcEdEasMonths(c)
        });
    };
    if (afcEd.scope === 'farm' && afcEd.farmCtx) {
        const farm = afcEd.farmCtx.farm;
        (farm.animalBuildings || []).forEach(b => {
            out.barns.push({ id: String(b.id), name: buildingDisplayName(farm, b) });
            (b.clusters || []).forEach((c, i) => push(b.id + '#' + i, c, b.id));
        });
    } else if (afcEd.sel) {
        const farm = afcEd.farmCtx && afcEd.farmCtx.farm;
        const barn = ((farm && farm.animalBuildings) || []).find(b => (b.clusters || []).some(c => c.subType === afcEd.sel));
        push('breed', { subType: afcEd.sel, numAnimals: afcEd.count, age: afcEd.age }, barn ? barn.id : null);
    }
    return out;
}

// One comparison: the mod's curves, the editor's, and the base game's.
function afcEdHerdResult() {
    const { groups, mixerLost, barns } = afcEdHerdGroups();
    const byType = new Map(afcEd.breeds.map(b => [b.subType, b]));
    const prices = afcEd.farmCtx ? afcEd.farmCtx.prices : {};
    const scale = afcEd.farmCtx ? afcEd.farmCtx.scale : 1;
    const of = keysOf => st => byType.has(st) ? afcCore.afcBreedCurves(byType.get(st), keysOf) : null;
    return {
        mod: afcCore.afcHerdEconomics(groups, of(c => c.keys), prices, scale),
        now: afcCore.afcHerdEconomics(groups, of(afcEdKeys), prices, scale),
        base: afcCore.afcHerdEconomics(groups, st => DEFAULT_ANIMALS[st] || null, prices, scale),
        mixerLost, barns, groups
    };
}

async function afcEdClose() {
    if (afcEd.busy) return;
    const n = afcEdChangedIds().length;
    if (n && !(await showConfirm({ title: t('afcEdTitle'), body: t('afcEdLeaveUnsaved').replace('{n}', n), danger: true }))) return;
    afcEd.edits = {};
    document.getElementById('afced-view').hidden = true;
    if (dashboardView) dashboardView.style.display = 'flex';
}

function afcEdCurve(id) {
    for (const b of afcEd.breeds) for (const c of b.curves) if (c.id === id) return c;
    return null;
}

// The curve as it is now in the editor (edited or as in the file).
function afcEdKeys(curve) {
    return afcEd.edits[curve.id] || curve.keys;
}

function afcEdChangedIds() {
    return Object.keys(afcEd.edits).filter(id => {
        const c = afcEdCurve(id);
        return c && !afcCore.afcSameKeys(afcCore.afcCleanKeys(afcEd.edits[id]), c.keys);
    });
}

function afcEdSetKeys(curve, keys) {
    afcEd.edits[curve.id] = keys;
    if (afcCore.afcSameKeys(afcCore.afcCleanKeys(keys), curve.keys) && keys.length === curve.keys.length) delete afcEd.edits[curve.id];
}

// The base game's curve for the same breed and fill type, to compare with.
function afcEdFillType(curve) {
    return afcCore.afcCurveFillType(curve);
}
function afcEdBaseKeys(subType, curve) {
    const d = DEFAULT_ANIMALS[subType];
    if (!d) return null;
    if (curve.group === 'input') return d[curve.tag] || null;
    return (d.production || {})[afcEdFillType(curve)] || null;
}
function afcEdCurveLabel(curve) {
    if (curve.group === 'input' && afcCore.AFC_EDITOR_INPUTS.includes(curve.tag)) return t('breedNorm_' + curve.tag);
    return formatFillType(afcEdFillType(curve));
}

// ---------- render ----------
function afcEdRender() {
    afcEdRenderSide();
    afcEdRenderMain();
}

function afcEdRenderSide() {
    const side = document.getElementById('afced-side');
    if (!side) return;
    const changed = new Set(afcEdChangedIds().map(id => id.split('|')[0]));
    const nChanged = afcEdChangedIds().length;
    const mine = Object.keys(afcEdReadChanges().curves).length;
    const backups = afcCore.afcBackupList(AFC_ED_BACKUPS());
    const q = afcEd.filter.trim().toLowerCase();
    const byType = {};
    afcEd.breeds.forEach(b => {
        const name = String(formatAnimalName(b.subType));
        if (q && !b.subType.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) return;
        (byType[b.type] = byType[b.type] || []).push({ b, name });
    });
    const dis = afcEd.busy ? 'disabled' : '';
    side.innerHTML = `
        <p class="settings-hint">${escapeHtml(t('afcEdDevOnly'))}</p>
        <div class="afced-zip">
            <strong>${escapeHtml(t('afcEdZip'))}</strong>
            <span class="afced-path">${afcEd.zip ? escapeHtml(afcEd.zip) : escapeHtml(t('afcEdNoZip'))}</span>
            ${afcEd.version ? `<span class="afced-meta">${escapeHtml(t('afcEdVersion').replace('{v}', afcEd.version))}</span>` : ''}
            <button type="button" class="settings-btn" data-act="zip" ${dis}>${escapeHtml(t('afcEdChooseZip'))}</button>
        </div>
        ${afcEd.message ? `<p class="afced-msg ${afcEd.message.error ? 'is-error' : ''}" role="status">${escapeHtml(afcEd.message.text)}</p>` : ''}
        <div class="tl-row">
            <button type="button" class="settings-btn is-active" data-act="save" ${nChanged && !afcEd.busy ? '' : 'disabled'}>${escapeHtml(t('afcEdSave').replace('{n}', nChanged))}</button>
            <button type="button" class="settings-btn" data-act="discard" ${nChanged && !afcEd.busy ? '' : 'disabled'}>${escapeHtml(t('afcEdDiscard'))}</button>
        </div>
        <input type="text" class="afced-filter" placeholder="${escapeHtml(t('afcEdFilter'))}" value="${escapeHtml(afcEd.filter)}">
        <div class="afced-breeds">
            ${Object.keys(byType).map(type => `<div class="afced-type">${escapeHtml(formatAnimalName(type))}</div>` + byType[type].map(({ b, name }) => `
                <button type="button" class="afced-breed ${b.subType === afcEd.sel ? 'is-active' : ''}" data-sub="${escapeHtml(b.subType)}">
                    <span>${escapeHtml(name)}</span><small>${escapeHtml(b.subType)}</small>${changed.has(b.subType) ? '<i class="fa-solid fa-circle afced-dot" aria-hidden="true"></i>' : ''}
                </button>`).join('')).join('')}
        </div>
        <div class="afced-box">
            <strong>${escapeHtml(t('afcEdMyChanges'))}</strong>
            <p class="settings-hint">${escapeHtml(t('afcEdMyChangesHint'))}</p>
            <div class="tl-row">
                <button type="button" class="settings-btn" data-act="mine" ${mine && afcEd.xml && !afcEd.busy ? '' : 'disabled'}>${escapeHtml(t('afcEdApplyMine').replace('{n}', mine))}</button>
                <button type="button" class="settings-btn" data-act="export" ${mine ? '' : 'disabled'}>${escapeHtml(t('afcEdExport'))}</button>
                <button type="button" class="settings-btn" data-act="import" ${afcEd.xml && !afcEd.busy ? '' : 'disabled'}>${escapeHtml(t('afcEdImport'))}</button>
            </div>
        </div>
        <div class="afced-box">
            <strong>${escapeHtml(t('afcEdBackups'))}</strong>
            ${backups.length ? `<div class="tl-row">
                <select class="afced-backup">${backups.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(path.basename(f))}</option>`).join('')}</select>
                <button type="button" class="settings-btn" data-act="restore" ${afcEd.zip && !afcEd.busy ? '' : 'disabled'}>${escapeHtml(t('afcEdRestore'))}</button>
            </div>` : `<p class="settings-hint">${escapeHtml(t('afcEdNoBackups'))}</p>`}
        </div>`;
}

function afcEdNum(v) {
    return afcCore.afcCleanKeys([{ ageMonth: 0, value: v }]).length ? String(Math.round(v * 10000) / 10000) : '';
}

// The curve now (line), as in the mod (dashed) and in the base game (dotted).
function afcEdChartHtml(now, file, base, age) {
    const all = [now, file, base || []].flat();
    if (!all.length) return '';
    const W = 420, H = 120, P = 6;
    const maxA = Math.max(12, ...all.map(k => k.ageMonth)) * 1.1;
    const maxV = Math.max(1e-9, ...all.map(k => k.value)) * 1.1;
    const pts = keys => {
        if (!keys || !keys.length) return '';
        const ext = [...keys, { ageMonth: maxA, value: keys[keys.length - 1].value }];
        return ext.map(k => `${(P + k.ageMonth / maxA * (W - 2 * P)).toFixed(1)},${(H - P - k.value / maxV * (H - 2 * P)).toFixed(1)}`).join(' ');
    };
    return `<svg class="afced-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        ${base ? `<polyline class="afced-line-base" points="${pts(base)}"/>` : ''}
        <polyline class="afced-line-file" points="${pts(file)}"/>
        <polyline class="afced-line-now" points="${pts(now)}"/>
        ${age != null && age <= maxA ? `<line class="afced-age-line" x1="${(P + age / maxA * (W - 2 * P)).toFixed(1)}" x2="${(P + age / maxA * (W - 2 * P)).toFixed(1)}" y1="0" y2="${H}"/>` : ''}
    </svg>`;
}

function afcEdCurveHtml(subType, curve) {
    const keys = afcEdKeys(curve);
    const base = afcEdBaseKeys(subType, curve);
    const fileAt = age => { const k = curve.keys.find(x => x.ageMonth === age); return k ? afcEdNum(k.value) : '–'; };
    const baseAt = age => base && base.length ? afcEdNum(interpolateNeedCurve(base, age)) : '–';
    const edited = !!afcEd.edits[curve.id];
    const id = escapeHtml(curve.id);
    const age = afcEd.age;
    const at = k => k && k.length ? afcEdNum(afcCore.afcCurveAt(k, age)) : '–';
    const summary = t('afcEdPoints').replace('{n}', keys.length).replace('{age}', age).replace('{mod}', at(curve.keys)).replace('{now}', at(keys));
    return `<section class="afced-curve ${edited ? 'is-edited' : ''}" data-curve="${id}">
        <header class="afced-curve-head">
            <h3>${escapeHtml(afcEdCurveLabel(curve))}${curve.fillType ? ` <small>${escapeHtml(curve.tag)} · ${escapeHtml(curve.fillType)}</small>` : ` <small>${escapeHtml(curve.tag)}</small>`}</h3>
            <span class="afced-mult">${escapeHtml(t('afcEdMultiply'))}
                <input type="number" class="afced-mult-x" min="0" step="0.05" value="1" data-k="${id}|mult">
                <button type="button" class="settings-btn" data-act="mult">${escapeHtml(t('afcEdApply'))}</button></span>
            <button type="button" class="settings-btn" data-act="reset" ${edited ? '' : 'disabled'}>${escapeHtml(t('afcEdResetCurve'))}</button>
        </header>
        ${afcEdChartHtml(keys, curve.keys, base, age)}
        <details class="afced-points" data-points="${id}" ${edited || afcEd.open.has(curve.id) ? 'open' : ''}>
        <summary>${escapeHtml(summary)}</summary>
        <table class="data-table afced-table"><thead><tr>
            <th>${escapeHtml(t('afcEdAge'))}</th><th>${escapeHtml(t('afcEdValue'))}</th>
            <th>${escapeHtml(t('afcEdInFile'))}</th><th>${escapeHtml(t('afcEdBase'))}</th><th></th>
        </tr></thead><tbody>
            ${keys.map((k, i) => `<tr>
                <td><input type="number" min="0" step="1" class="afced-in" data-row="${i}" data-field="ageMonth" data-k="${id}|${i}|a" value="${afcEdNum(k.ageMonth)}"></td>
                <td><input type="number" min="0" step="any" class="afced-in" data-row="${i}" data-field="value" data-k="${id}|${i}|v" value="${afcEdNum(k.value)}"></td>
                <td class="afced-ref">${fileAt(k.ageMonth)}</td>
                <td class="afced-ref">${baseAt(k.ageMonth)}</td>
                <td><button type="button" class="afced-del" data-act="del" data-row="${i}" title="${escapeHtml(t('afcEdRemovePoint'))}" aria-label="${escapeHtml(t('afcEdRemovePoint'))}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></td>
            </tr>`).join('')}
        </tbody></table>
        <button type="button" class="settings-btn" data-act="add">${escapeHtml(t('afcEdAddPoint'))}</button>
        </details>
    </section>`;
}

function afcEdRenderMain() {
    const main = document.getElementById('afced-main');
    if (!main) return;
    const focused = document.activeElement && main.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    const breed = afcEd.breeds.find(b => b.subType === afcEd.sel);
    if (!breed) {
        main.innerHTML = `<p class="hub-panel-note">${escapeHtml(afcEd.zip ? t('afcEdNoBreeds') : t('afcEdNoZip'))}</p>`;
        return;
    }
    const group = (g, label) => breed.curves.some(c => c.group === g)
        ? `<details class="afced-group-box" data-group="${g}" ${afcEd.closedGroups.has(g) ? '' : 'open'}>
            <summary class="afced-group">${escapeHtml(t(label))}</summary>
            <div class="afced-grid">${breed.curves.filter(c => c.group === g).map(c => afcEdCurveHtml(breed.subType, c)).join('')}</div>
        </details>` : '';
    main.innerHTML = `<h2 class="afced-title">${escapeHtml(formatAnimalName(breed.subType))} <small>${escapeHtml(breed.subType)}</small></h2>
        ${afcEdHerdHtml()}
        <p class="settings-hint">${escapeHtml(t('afcEdLegend'))}</p>
        ${group('input', 'afcEdIntake')}
        ${group('output', 'afcEdOutput')}`;
    if (focused) {
        const el = [...main.querySelectorAll('[data-k]')].find(e => e.dataset.k === focused);
        if (el) el.focus();
    }
}

// ---------- herd comparison ----------
function afcEdQty(v) {
    return Math.round(v).toLocaleString(FIN_LOCALE()) + ' l';
}

// "+12 %" / "−3 400 l": the change from the mod's value to the edited one.
function afcEdDiffHtml(mod, now, money) {
    const d = now - mod;
    if (Math.abs(d) < 0.5) return '<span class="afced-diff">–</span>';
    const sign = d > 0 ? '+' : '−';
    const abs = money ? finMoney(Math.abs(d)) : afcEdQty(Math.abs(d));
    const pct = Math.abs(mod) >= 0.5 ? ` (${sign}${Math.round(Math.abs(d / mod) * 100)} %)` : '';
    return `<span class="afced-diff ${d > 0 ? 'is-up' : 'is-down'}">${sign}${abs}${pct}</span>`;
}

function afcEdHerdHtml() {
    const ctx = afcEd.farmCtx;
    const farms = afcEdFarms();
    const r = afcEdHerdResult();
    const per = afcEd.period;
    const [mod, now, base] = [r.mod[per], r.now[per], r.base[per]];
    const money = !!(ctx && ctx.hasPrices);
    const noBase = r.base.skipped.length > 0 && afcEd.scope === 'breed';
    const row = (label, get, opts = {}) => {
        const m = get(mod), n = get(now), b = get(base);
        const fmt = v => opts.money ? finMoney(v) : afcEdQty(v);
        return `<tr class="${opts.cls || ''}"><th scope="row">${escapeHtml(label)}</th>
            <td>${fmt(m)}</td><td>${fmt(n)}</td><td>${afcEdDiffHtml(m, n, opts.money)}</td>
            <td class="afced-ref">${noBase ? '–' : fmt(b)}</td></tr>`;
    };
    const outs = [...new Set([mod, now, base].flatMap(x => Object.keys(x.out)))].sort();
    const notes = [];
    const scale = ctx ? ctx.scale : 1;
    notes.push(t('afcEdYearNote').replace('{x}', scale.toLocaleString(FIN_LOCALE(), { maximumFractionDigits: 2 })));
    if (ctx && ctx.afc && ctx.afc.enabled && ctx.afc.referenceSource !== 'custom') {
        notes.push(t('afcEdSourceNote').replace('{src}', t('afcSource_' + ctx.afc.referenceSource) || ctx.afc.referenceSource));
    }
    if (r.mod.skipped.length) notes.push(t('afcEdSkipped').replace('{list}', r.mod.skipped.map(st => formatAnimalName(st)).join(', ')));
    if (money) {
        notes.push(t('afcEdPricesNote'));
        const unpriced = [...new Set([...r.mod.unpriced, ...r.now.unpriced])];
        if (unpriced.length) notes.push(t('afcEdUnpriced').replace('{list}', unpriced.map(ft => ft === 'FOOD' ? t('afcEdUnpricedFeed') : formatFillType(ft)).join(', ')));
    } else notes.push(t('afcEdNoPrices'));
    if (r.mixerLost) notes.push(t('afcEdMixerLost'));
    if (ctx && ctx.eas && afcEd.eas) notes.push(t(afcEd.scope === 'breed' ? 'afcEdEasBreedNote' : 'afcEdEasNote'));

    // Per building: the groups' year totals added up per barn.
    let byBarn = '';
    if (afcEd.scope === 'farm' && r.barns.length) {
        const sum = (res, barnId, k) => res.groups.filter(g => g.id.split('#')[0] === barnId).reduce((s, g) => s + g.year[k], 0);
        byBarn = `<details class="afced-barns" data-group="barns" ${afcEd.closedGroups.has('barns') ? '' : 'open'}>
            <summary>${escapeHtml(t('afcEdByBarn'))}</summary>
            <table class="data-table afced-herd-table"><thead><tr>
                <th>${escapeHtml(t('afcEdBarnCol'))}</th><th>${escapeHtml(t('breedNorm_food'))}</th>
                ${money ? `<th>${escapeHtml(t('afcEdRevenue'))}</th><th>${escapeHtml(t('afcEdProfit'))}</th>` : ''}
            </tr></thead><tbody>
            ${r.barns.map(b => `<tr><th scope="row">${escapeHtml(b.name)}</th>
                <td>${afcEdQty(sum(r.mod, b.id, 'food'))} → ${afcEdQty(sum(r.now, b.id, 'food'))}</td>
                ${money ? `<td>${finMoney(sum(r.mod, b.id, 'revenue'))} → ${finMoney(sum(r.now, b.id, 'revenue'))}</td>
                <td>${finMoney(sum(r.mod, b.id, 'profit'))} → ${finMoney(sum(r.now, b.id, 'profit'))} ${afcEdDiffHtml(sum(r.mod, b.id, 'profit'), sum(r.now, b.id, 'profit'), true)}</td>` : ''}
            </tr>`).join('')}
            </tbody></table></details>`;
    }

    const seg = (act, val, cur, label) => `<button type="button" class="settings-btn ${val === cur ? 'is-active' : ''}" data-herd="${act}" data-val="${val}" aria-pressed="${val === cur}">${escapeHtml(t(label))}</button>`;
    return `<details class="afced-herd" data-group="herd" ${afcEd.closedGroups.has('herd') ? '' : 'open'}>
        <summary class="afced-group">${escapeHtml(t('afcEdHerd'))}</summary>
        <div class="afced-herd-controls">
            <label>${escapeHtml(t('afcEdHerdFarm'))}
                <select class="afced-farm" data-k="herd|farm">
                    <option value="">${escapeHtml(t('afcEdHerdNoFarm'))}</option>
                    ${farms.map(f => `<option value="${escapeHtml(String(f.id))}" ${String(f.id) === String(afcEd.farmId) ? 'selected' : ''}>${escapeHtml(f.name || String(f.id))}</option>`).join('')}
                </select></label>
            <span class="tl-row">${seg('scope', 'breed', afcEd.scope, 'afcEdScopeBreed')}${ctx ? seg('scope', 'farm', afcEd.scope, 'afcEdScopeFarm') : ''}</span>
            ${afcEd.scope === 'breed' ? `
                <label>${escapeHtml(t('afcEdHeads'))} <input type="number" min="0" step="1" class="afced-herd-in" data-field="count" data-k="herd|count" value="${afcEd.count}"></label>
                <label>${escapeHtml(t('afcEdAgeMonths'))} <input type="number" min="0" step="1" class="afced-herd-in" data-field="age" data-k="herd|age" value="${afcEd.age}"></label>` : ''}
            <span class="tl-row">${seg('period', 'month', per, 'afcEdPerMonth')}${seg('period', 'year', per, 'afcEdPerYear')}</span>
            <label class="afced-eas" title="${escapeHtml(ctx && ctx.eas ? '' : t('afcEdEasNone'))}">
                <input type="checkbox" class="afced-eas-in" data-k="herd|eas" ${ctx && ctx.eas ? '' : 'disabled'} ${ctx && ctx.eas && afcEd.eas ? 'checked' : ''}>
                ${escapeHtml(t('afcEdEas'))}${ctx && ctx.eas ? '' : ` <small>(${escapeHtml(t('afcEdEasNone'))})</small>`}</label>
        </div>
        ${r.groups.length ? `<table class="data-table afced-herd-table"><thead><tr>
            <th></th><th>${escapeHtml(t('afcEdColMod'))}</th><th>${escapeHtml(t('afcEdColNow'))}</th>
            <th>${escapeHtml(t('afcEdColDiff'))}</th><th>${escapeHtml(t('afcEdColBase'))}</th>
        </tr></thead><tbody>
            ${row(t('breedNorm_food'), x => x.food)}
            ${row(t('breedNorm_water'), x => x.water)}
            ${row(t('breedNorm_straw'), x => x.straw)}
            ${outs.map((ft, i) => row(formatFillType(ft), x => x.out[ft] || 0, { cls: i === 0 ? 'afced-sep' : '' })).join('')}
            ${money ? row(t('afcEdRevenue'), x => x.revenue, { money: true, cls: 'afced-sep' })
                + row(t('afcEdFeedCost'), x => x.feedCost, { money: true })
                + row(t('afcEdProfit'), x => x.profit, { money: true, cls: 'afced-total' }) : ''}
        </tbody></table>` : `<p class="settings-hint">${escapeHtml(t('afcEdNoHerd'))}</p>`}
        ${byBarn}
        <ul class="afced-notes">${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
    </details>`;
}

// ---------- actions ----------
function afcEdOnMainChange(e) {
    if (e.target.classList.contains('afced-farm')) {
        setSetting('afcEditorFarm', e.target.value || null);
        afcEdPickFarm(e.target.value);
        afcEdHerdDefaults();
        afcEdRenderMain();
        return;
    }
    if (e.target.classList.contains('afced-eas-in')) {
        afcEd.eas = e.target.checked;
        afcEdRenderMain();
        return;
    }
    if (e.target.classList.contains('afced-herd-in')) {
        const v = parseInt(e.target.value, 10);
        if (v >= 0) afcEd[e.target.dataset.field] = v;
        afcEdRenderMain();
        return;
    }
    const input = e.target.closest('.afced-in');
    if (!input) return;
    const curve = afcEdCurve(input.closest('[data-curve]').dataset.curve);
    const keys = afcEdKeys(curve).map(k => ({ ...k }));
    const v = parseFloat(input.value);
    const row = keys[+input.dataset.row];
    if (!row || !(v >= 0)) { afcEdRenderMain(); return; }
    row[input.dataset.field] = v;
    // Ages stay in order; two points at one age become one.
    afcEdSetKeys(curve, input.dataset.field === 'ageMonth' ? afcCore.afcCleanKeys(keys) : keys);
    afcEdRender();
}

function afcEdOnMainClick(e) {
    const herd = e.target.closest('[data-herd]');
    if (herd) {
        afcEd[herd.dataset.herd] = herd.dataset.val;
        afcEdRenderMain();
        return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const curve = afcEdCurve(btn.closest('[data-curve]').dataset.curve);
    const keys = afcEdKeys(curve).map(k => ({ ...k }));
    if (btn.dataset.act === 'del') {
        keys.splice(+btn.dataset.row, 1);
        afcEdSetKeys(curve, keys);
    } else if (btn.dataset.act === 'add') {
        const last = keys[keys.length - 1];
        keys.push({ ageMonth: last ? last.ageMonth + 12 : 0, value: last ? last.value : 0 });
        afcEdSetKeys(curve, keys);
    } else if (btn.dataset.act === 'mult') {
        const x = parseFloat(btn.parentElement.querySelector('.afced-mult-x').value);
        if (!(x >= 0)) return;
        afcEdSetKeys(curve, keys.map(k => ({ ageMonth: k.ageMonth, value: Math.round(k.value * x * 10000) / 10000 })));
    } else if (btn.dataset.act === 'reset') {
        delete afcEd.edits[curve.id];
    } else return;
    afcEdRender();
}

// Which point tables and groups are open survives a new render.
function afcEdOnToggle(e) {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement)) return;
    if (d.dataset.points) {
        if (d.open) afcEd.open.add(d.dataset.points); else afcEd.open.delete(d.dataset.points);
    } else if (d.dataset.group) {
        if (d.open) afcEd.closedGroups.delete(d.dataset.group); else afcEd.closedGroups.add(d.dataset.group);
    }
}

async function afcEdOnSideClick(e) {
    const breedBtn = e.target.closest('.afced-breed');
    if (breedBtn) {
        afcEd.sel = breedBtn.dataset.sub;
        afcEdHerdDefaults();
        afcEdRender();
        document.getElementById('afced-main').scrollTop = 0;
        return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || afcEd.busy) return;
    const act = btn.dataset.act;
    if (act === 'zip') await afcEdChooseZip();
    else if (act === 'save') await afcEdSave();
    else if (act === 'discard') { afcEd.edits = {}; afcEd.message = null; }
    else if (act === 'mine') afcEdApplyChanges(afcEdReadChanges().curves);
    else if (act === 'export') await afcEdExport();
    else if (act === 'import') await afcEdImport();
    else if (act === 'restore') await afcEdRestore(document.querySelector('#afced-side .afced-backup').value);
    afcEdRender();
}

async function afcEdChooseZip() {
    const n = afcEdChangedIds().length;
    if (n && !(await showConfirm({ title: t('afcEdTitle'), body: t('afcEdLeaveUnsaved').replace('{n}', n), danger: true }))) return;
    const res = await ipcRenderer.invoke('show-open-dialog', {
        properties: ['openFile'],
        defaultPath: afcEd.zip || path.join(tlGameDir(), 'mods'),
        filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (!res || res.canceled || !res.filePaths.length) return;
    setSetting('afcEditorZip', res.filePaths[0]);
    afcEd.message = null;
    afcEdLoad(res.filePaths[0]);
}

// Puts saved or imported curves into the editor (not into the zip yet).
function afcEdApplyChanges(curves) {
    let n = 0, skipped = 0;
    Object.keys(curves || {}).forEach(id => {
        const c = afcEdCurve(id);
        if (!c) { skipped++; return; }
        afcEdSetKeys(c, afcCore.afcCleanKeys(curves[id]));
        n++;
    });
    afcEd.message = { text: t('afcEdApplied').replace('{n}', n).replace('{s}', skipped), error: false };
}

// The game holds the mod's zip while it runs.
async function afcEdGameClosed() {
    if (!(await tlGameRunning())) return true;
    await showNotice(t('afcEdTitle'), t('afcEdGameRunning'), true);
    return false;
}

async function afcEdSave() {
    const ids = afcEdChangedIds();
    if (!ids.length || !afcEd.zip) return;
    if (!(await afcEdGameClosed())) return;
    const ok = await showConfirm({
        title: t('afcEdSaveConfirmTitle'),
        body: t('afcEdSaveConfirm').replace('{n}', ids.length).replace('{zip}', afcEd.zip).replace('{dir}', AFC_ED_BACKUPS())
    });
    if (!ok) return;
    const edits = {};
    ids.forEach(id => { edits[id] = afcEd.edits[id]; });
    afcEd.busy = true;
    afcEdRender();
    try {
        const r = afcCore.afcApplyEdits(afcEd.xml, edits);
        const backup = await afcCore.afcSaveZip(afcEd.zip, r.xml, AFC_ED_BACKUPS());
        const changes = afcEdReadChanges();
        r.changed.forEach(id => { changes.curves[id] = afcCore.afcCleanKeys(edits[id]); });
        changes.mod = afcCore.AFC_EDITOR_MOD;
        changes.version = afcEd.version;
        changes.updated = new Date().toISOString();
        afcEdWriteChanges(changes);
        afcEdLoad(afcEd.zip);
        afcEd.message = { text: t('afcEdSaved').replace('{n}', r.changed.length).replace('{file}', path.basename(backup)), error: false };
    } catch (e) {
        console.error('AFC editor: save failed', e);
        afcEd.message = { text: t('afcEdError').replace('{msg}', e.message), error: true };
    } finally {
        afcEd.busy = false;
    }
}

async function afcEdExport() {
    const res = await ipcRenderer.invoke('show-save-dialog', {
        defaultPath: 'afc-editor-changes.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!res || res.canceled || !res.filePath) return;
    fs.writeFileSync(res.filePath, JSON.stringify(afcEdReadChanges(), null, 2), 'utf-8');
}

async function afcEdImport() {
    const res = await ipcRenderer.invoke('show-open-dialog', {
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!res || res.canceled || !res.filePaths.length) return;
    let curves = null;
    try { curves = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8')).curves; } catch { /* below */ }
    if (!curves || typeof curves !== 'object') {
        afcEd.message = { text: t('afcEdImportBad'), error: true };
        return;
    }
    afcEdApplyChanges(curves);
}

async function afcEdRestore(backup) {
    if (!backup || !afcEd.zip) return;
    const n = afcEdChangedIds().length;
    const body = t('afcEdRestoreConfirm').replace('{file}', path.basename(backup)) + (n ? '\n\n' + t('afcEdLeaveUnsaved').replace('{n}', n) : '');
    if (!(await showConfirm({ title: t('afcEdBackups'), body, danger: true }))) return;
    if (!(await afcEdGameClosed())) return;
    try {
        const current = afcCore.afcRestoreZip(afcEd.zip, backup, AFC_ED_BACKUPS());
        afcEdLoad(afcEd.zip);
        afcEd.message = { text: t('afcEdRestored').replace('{file}', current ? path.basename(current) : '–'), error: false };
    } catch (e) {
        console.error('AFC editor: restore failed', e);
        afcEd.message = { text: t('afcEdError').replace('{msg}', e.message), error: true };
    }
}

(function initAfcEditor() {
    const open = document.getElementById('afced-open-btn');
    if (open) {
        open.hidden = !IS_DEV_BUILD;
        open.addEventListener('click', () => {
            closeModal(document.getElementById('app-settings-modal'));
            afcEdOpen();
        });
    }
    const back = document.getElementById('afced-back');
    if (back) back.addEventListener('click', afcEdClose);
    const side = document.getElementById('afced-side');
    if (side) {
        side.addEventListener('click', afcEdOnSideClick);
        side.addEventListener('input', e => {
            if (!e.target.classList.contains('afced-filter')) return;
            afcEd.filter = e.target.value;
            const pos = e.target.selectionStart;
            afcEdRenderSide();
            const f = side.querySelector('.afced-filter');
            f.focus();
            f.setSelectionRange(pos, pos);
        });
    }
    const main = document.getElementById('afced-main');
    if (main) {
        main.addEventListener('change', afcEdOnMainChange);
        main.addEventListener('click', afcEdOnMainClick);
        main.addEventListener('toggle', afcEdOnToggle, true);
    }
})();
