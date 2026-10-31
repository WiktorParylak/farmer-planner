// Crop generator — the third tab of the Crop rotation view.
// It proposes a crop for every field the player may still change, from what
// the farm needs over a year: the animals' feed (the feed planner's need,
// stock and rations — buildFeedDemand / feedStockCategoriesFor), the inputs of
// the productions and biogas plants read from the save (readProductionsFromSave)
// and straw for bedding. Fields left over follow their crop rotation, else the
// crop with the best margin (market.js). Yields come from fieldExpectedYield,
// rotation warnings from rotationSequenceWarnings — nothing is counted twice.
// Applying writes the crops (this season) or field.nextCrop (next season,
// put on the fields by advanceRotationsForNewSeason), keeps a fields backup and
// an undo record, and sets the feed planner's use of each field it planned.
// Loaded after rotation.js.

const GEN_GROUPS = ['animals', 'production', 'biogas'];
const GEN_GROUP_ICONS = { animals: 'fa-cow', production: 'fa-industry', biogas: 'fa-fire' };
// Inputs that never come off a field (bought or made by the game itself).
const GEN_IGNORED_INPUTS = ['WATER', 'SEEDS', 'FERTILIZER', 'LIQUIDFERTILIZER', 'HERBICIDE', 'LIME', 'DIESEL', 'DEF',
    'ELECTRICCHARGE', 'METHANE', 'ROADSALT', 'BOARDS', 'WOOD', 'WOODCHIPS'];
// Made by the animals on the farm — no land needed for them.
const GEN_FARM_INPUTS = ['MANURE', 'LIQUIDMANURE', 'DIGESTATE'];
const GEN_PROFILES = {
    balanced: { priority: ['animals', 'production', 'biogas'], limitPct: 40, keepCycles: true, avoidRed: true },
    animals: { priority: ['animals', 'biogas', 'production'], limitPct: 60, keepCycles: false, avoidRed: true },
    production: { priority: ['production', 'biogas', 'animals'], limitPct: 60, keepCycles: false, avoidRed: true },
    sale: { priority: ['animals', 'production', 'biogas'], limitPct: 15, keepCycles: false, avoidRed: true },
    rotation: { priority: ['animals', 'production', 'biogas'], limitPct: 30, keepCycles: true, avoidRed: true }
};
const GEN_PROFILE_ICONS = { balanced: 'fa-scale-balanced', animals: 'fa-cow', production: 'fa-industry', sale: 'fa-coins', rotation: 'fa-arrows-spin' };

// View state (not saved): filters and the rows opened to "why".
let genProposalFilter = 'all';
let genNeedFilter = 'all';
let genOpenRows = new Set();
let genLastPlan = null;

function getGeneratorSettings(farm) {
    const s = farm.cropGenerator || (farm.cropGenerator = {});
    if (!GEN_PROFILES[s.profile] && s.profile !== 'custom') s.profile = 'balanced';
    const base = GEN_PROFILES[s.profile] || GEN_PROFILES.balanced;
    if (!Array.isArray(s.priority) || s.priority.length !== GEN_GROUPS.length) s.priority = base.priority.slice();
    if (!(s.limitPct >= 0 && s.limitPct <= 100)) s.limitPct = base.limitPct;
    if (!(s.reservePct >= 0 && s.reservePct <= 50)) s.reservePct = 10;
    if (typeof s.keepCycles !== 'boolean') s.keepCycles = base.keepCycles;
    if (typeof s.avoidRed !== 'boolean') s.avoidRed = base.avoidRed;
    if (!Array.isArray(s.excluded)) s.excluded = [];
    if (!s.locks || typeof s.locks !== 'object') s.locks = {};
    if (!s.manual || typeof s.manual !== 'object') s.manual = {};
    return s;
}

// A field's key for locks and manual choices: its number, and which of the
// rows with that number it is (a field shared by two crops has two rows).
function genFieldKey(farm, idx) {
    const f = farm.fields[idx];
    const num = (f.number || '').toString().trim();
    let n = 0;
    for (let i = 0; i < idx; i++) if ((farm.fields[i].number || '').toString().trim() === num) n++;
    return num + '#' + n;
}

function genCropFillType(market, crop) {
    if (market) return marketCropFillType(market, crop);
    if (!crop || MARKET_UNSOLD_CROPS.includes(crop)) return null;
    return MARKET_CROP_FILLTYPE[crop] || String(crop).replace(/[_\s]+/g, '').toUpperCase();
}

function genResourceLabel(res) {
    const [kind, id] = res.split(':');
    return kind === 'feed' ? feedCategoryLabel(id) : feedFillTypeName(id);
}

function genResourceIcon(res) {
    const [kind, id] = res.split(':');
    return kind === 'feed' ? (FEED_CATEGORY_ICONS[id] || 'fa-wheat-awn') : 'fa-wheat-awn';
}

// Crops that can be sown as a main crop and have a yield and a calendar.
function genCropPool(settings) {
    return AVAILABLE_CROPS.filter(c => CROP_CALENDAR[c] && getCropYieldRate(c) !== null
        && !(isCatchCropChoice(c) && !isPerennialCrop(c)) && !MARKET_UNSOLD_CROPS.includes(c)
        && !settings.excluded.includes(c));
}

// Which feed-planner use of a crop gives feed category `cat` (null = none).
function genUseFor(crop, cat) {
    const uses = FEED_CROP_USES[crop];
    if (!uses) return null;
    return Object.keys(uses).find(u => uses[u] === cat || (uses[u] === 'ROUGHAGE' && FEED_ROUGHAGE.includes(cat))) || null;
}

// Litres per hectare of `res` from `crop` before the field's soil (null = it doesn't give it).
function genRateFor(crop, res, plan) {
    const [kind, id] = res.split(':');
    if (kind === 'ft') return genCropFillType(null, crop) === id || cropOrderKey(crop) === cropOrderKey(id) ? getCropYieldRate(crop) : null;
    if (id === 'STRAW') return cropStrawRate(crop) !== null ? (plan.strawYield || cropStrawRate(crop)) : null;
    const use = genUseFor(crop, id);
    if (!use) return null;
    const rate = getCropYieldRate(crop) || 0;
    if (FEED_CROP_USES[crop][use] === 'ROUGHAGE') return rate * plan.grassCuts;
    if (use === 'silage') return FEED_SILAGE_OWN_YIELD.includes(crop) ? rate : plan.chaffYield;
    return rate;
}

// The month to sow `crop` from now to the end of the sowing year (July..June,
// like isSowingOverdue), or null when its window has passed.
function genSowThisSeason(crop, month) {
    const cal = CROP_CALENDAR[crop];
    const cur = ALL_MONTHS.indexOf(String(month || '').toUpperCase());
    if (!cal) return null;
    if (cur < 0) return rotationDefaultSowMonth(crop) || null;
    for (let k = (cur - SOWING_YEAR_START + 12) % 12; k < 12; k++) {
        const m = ALL_MONTHS[(SOWING_YEAR_START + k) % 12];
        if (cal[m]) return m;
    }
    return null;
}

// --- What the farm needs -----------------------------------------------------
// One row per resource: { res, need (l/year with the reserve), stock,
// consumers [{ group, name, litres }], group (the first in the priority),
// state hints: buyOnly / fromFarm }.
function buildFarmDemand(farm, settings) {
    const plan = getFeedPlan(farm);
    const reserve = 1 + settings.reservePct / 100;
    const rows = {};
    const add = (res, group, name, litres, stock) => {
        if (!(litres > 0)) return;
        const r = rows[res] || (rows[res] = { res, need: 0, stock: 0, consumers: [] });
        r.need += litres * reserve;
        if (stock) r.stock = Math.max(r.stock, stock);
        const c = r.consumers.find(x => x.group === group && x.name === name);
        if (c) c.litres += litres; else r.consumers.push({ group, name, litres });
    };

    // Animals: the feed planner's yearly need per category and the stock it counts.
    const demand = buildFeedDemand(farm, plan);
    const stock = feedStockCategoriesFor(farm, plan);
    const barns = ((farm.animalBuildings || []).filter(b => (b.clusters || []).some(c => animalTypeOf(c.subType))));
    barns.forEach(b => {
        const need = buildBarnFeedNeed(b, plan, farm);
        Object.entries(need.byCategory).forEach(([c, l]) => add('feed:' + c, 'animals', buildingDisplayName(farm, b), l, stock[c] || 0));
    });
    if (demand.byCategory.MINERAL > 0 && rows['feed:MINERAL']) rows['feed:MINERAL'].buyOnly = true;

    // Productions and biogas plants with a recipe switched on (feed mixers are
    // already inside the rations above).
    const productions = (farm.productions || []).filter(p => p.kind !== 'mixer');
    const market = getFarmMarket(farm);
    const isCrop = ft => AVAILABLE_CROPS.some(c => genCropFillType(market, c) === ft);
    const producers = {};
    productions.forEach(p => p.recipes.filter(r => r.enabled).forEach(r => r.outputs.forEach(o => {
        (producers[o.fillType] = producers[o.fillType] || []).push({ p, r, amount: o.amount });
    })));
    const addInput = (p, ft, litres, via) => {
        const group = p.kind === 'biogas' ? 'biogas' : 'production';
        const name = via ? `${p.name} (${via})` : p.name;
        if (GEN_IGNORED_INPUTS.includes(ft)) return;
        const cat = FEED_FILLTYPE_CATEGORY[ft];
        if (GEN_FARM_INPUTS.includes(ft)) { add('farm:' + ft, group, name, litres, 0); rows['farm:' + ft].fromFarm = true; return; }
        if (cat && FEED_ROUGHAGE.includes(cat) && !isCrop(ft)) { add('feed:' + cat, group, name, litres, 0); return; }
        if (isCrop(ft)) { add('ft:' + ft, group, name, litres, (p.stock && p.stock[ft]) || 0); return; }
        add('ft:' + ft, group, name, litres, (p.stock && p.stock[ft]) || 0);
        rows['ft:' + ft].buyOnly = true;
    };
    productions.forEach(p => p.recipes.filter(r => r.enabled).forEach(r => r.inputs.forEach(i => {
        const litres = i.amount * r.cyclesPerMonth * FEED_PERIODS_PER_YEAR;
        // An input another production of the farm makes (flour from the mill):
        // what that one needs for it, one step back.
        const made = !isCrop(i.fillType) && (producers[i.fillType] || []).find(x => x.p !== p);
        if (made) {
            const cycles = litres / (made.amount || 1);
            made.r.inputs.forEach(j => addInput(p, j.fillType, j.amount * cycles, made.p.name));
            return;
        }
        addInput(p, i.fillType, litres);
    })));

    return Object.values(rows).map(r => {
        r.group = settings.priority.find(g => r.consumers.some(c => c.group === g)) || r.consumers[0].group;
        return r;
    });
}

// --- The plan ------------------------------------------------------------------
// { mode, needs, proposals, freeHa, limitHa, usedHa, problems }
function buildCropGeneratorPlan(farm) {
    const settings = getGeneratorSettings(farm);
    const mode = settings.mode === 'next' || settings.mode === 'this' ? settings.mode : genDefaultMode(farm);
    const rates = getSupplyRates();
    const plan = getFeedPlan(farm);
    const market = getFarmMarket(farm);
    const season = farm.currentSeason || 1;
    const history = loadSeasonHistory(farm, season);
    const grassLimit = grasslandSeasonLimit(farm);
    const carry = new Set(seasonCarryIndexes(farm));
    const pool = genCropPool(settings);
    const needs = buildFarmDemand(farm, settings);
    const needByRes = {};
    needs.forEach(n => { n.fixed = 0; n.planned = 0; needByRes[n.res] = n; });

    // Every numbered field with an area, and what the generator may do with it.
    const fields = [];
    (farm.fields || []).forEach((f, idx) => {
        const area = parseFloat(f.area) || 0;
        if (area <= 0 || !(f.number || '').toString().trim()) return;
        const key = genFieldKey(farm, idx);
        const info = fieldRotationInfo(farm, f);
        let status = 'free', keepCrop = null;
        // What is planned already: this season's crop, or next season's plan / cycle step.
        const current = mode === 'next' ? (f.nextCrop ? f.nextCrop.crop : genCycleCrop(info, mode)) || null : f.crop || null;
        if (mode === 'this' && (f.state === 'Planted' || f.carriedFrom)) { status = 'growing'; keepCrop = f.crop; }
        else if (mode === 'next' && carry.has(idx)) { status = 'growing'; keepCrop = f.crop; }
        else if (mode === 'next' && isPerennialCrop(f.crop) && grasslandSeasonCount(f, history, season) < grassLimit) { status = 'perennial'; keepCrop = f.crop; }
        else if (settings.manual[key] !== undefined) { status = 'manual'; keepCrop = settings.manual[key]; }
        else if (settings.locks[key]) { status = 'locked'; keepCrop = mode === 'next' ? genCycleCrop(info, mode) ?? current : current; }
        else if (settings.keepCycles && info) { status = 'cycle'; keepCrop = mode === 'this' ? current || genCycleCrop(info, mode) : genCycleCrop(info, mode); }
        fields.push({ f, idx, key, area, info, status, keepCrop: keepCrop || '', current: current || '' });
    });
    const freeHa = fields.filter(x => x.status === 'free').reduce((s, x) => s + x.area, 0);
    const limitHa = freeHa * settings.limitPct / 100;

    // What the fields that stay as they are give (their use from the feed planner).
    const contribute = (x, crop) => {
        if (!crop) return;
        const clone = { ...x.f, crop, catchCrop: crop === x.f.crop ? x.f.catchCrop : '', cuts: crop === x.f.crop ? x.f.cuts : [] };
        const supply = buildFeedSupply({ ...farm, fields: [clone] }, plan, rates);
        Object.entries(supply.byCategory).forEach(([c, l]) => {
            if (c === 'ROUGHAGE') {
                const r = FEED_ROUGHAGE.map(k => needByRes['feed:' + k]).filter(Boolean).sort((a, b) => (b.need - b.stock - b.fixed) - (a.need - a.stock - a.fixed))[0];
                if (r) r.fixed += l;
            } else if (needByRes['feed:' + c]) needByRes['feed:' + c].fixed += l;
        });
        const sale = supply.rows.find(r => !r.isCatch && r.use === 'sale') || (!FEED_CROP_USES[crop] ? {} : null);
        const ft = genCropFillType(market, crop);
        if (sale && ft && needByRes['ft:' + ft]) needByRes['ft:' + ft].fixed += fieldExpectedYield(clone, x.idx, crop, rates, farm).litres;
    };
    fields.filter(x => x.status !== 'free').forEach(x => contribute(x, x.keepCrop));
    const remaining = n => n.need - n.stock - n.fixed - n.planned;

    // Memoised per field: yield per need, rotation warnings, sowing month.
    const memo = {}, timelines = {};
    const cell = (x, crop) => {
        const k = x.idx + '|' + crop;
        if (memo[k]) return memo[k];
        const base = timelines[x.idx] || (timelines[x.idx] = rotationTimeline(farm, x.f, history, 3, 0));
        const seq = base.map(e => ({ ...e, crops: e.crops.slice() }));
        let from = seq.findIndex(e => e.current);
        if (mode === 'this') seq[from].crops = [crop];
        else { seq.push({ season: season + 1, crops: [crop] }); from += 1; }
        const warnings = rotationSequenceWarnings(seq, from, grassLimit);
        const sow = mode === 'this'
            ? (cropOrderKey(crop) === cropOrderKey(x.f.crop) && x.f.sowingMonth && genSowThisSeason(crop, farm.month) ? x.f.sowingMonth : genSowThisSeason(crop, farm.month))
            : rotationDefaultSowMonth(crop) || null;
        return (memo[k] = { warnings, red: warnings.some(w => w.level === 'red'), sow, perHa: {} });
    };
    const perHa = (x, crop, res) => {
        const c = cell(x, crop);
        if (!(res in c.perHa)) {
            const rate = genRateFor(crop, res, plan);
            c.perHa[res] = rate === null ? null : fieldExpectedYield(x.f, x.idx, crop, rates, null, rate).perHa;
        }
        return c.perHa[res];
    };
    const usable = (x, crop) => {
        const c = cell(x, crop);
        return !!c.sow && !(settings.avoidRed && c.red);
    };

    // Greedy: the needs in the priority order, each takes the best whole field.
    const assigned = {};
    let usedHa = 0;
    const order = needs.filter(n => !n.buyOnly && !n.fromFarm)
        .sort((a, b) => settings.priority.indexOf(a.group) - settings.priority.indexOf(b.group) || remaining(b) - remaining(a));
    order.forEach(n => {
        const candidates = pool.filter(c => genRateFor(c, n.res, plan) !== null);
        n.candidates = candidates;
        for (let guard = 0; guard < 400 && remaining(n) > 0; guard++) {
            let best = null, hitLimit = false;
            fields.forEach(x => {
                if (x.status !== 'free' || assigned[x.idx]) return;
                if (usedHa + x.area > limitHa + 1e-6) { hitLimit = true; return; }
                candidates.forEach(crop => {
                    if (!usable(x, crop)) return;
                    const ph = perHa(x, crop, n.res);
                    if (!(ph > 0)) return;
                    const litres = ph * x.area, left = remaining(n);
                    const cover = Math.min(litres, left) / left;
                    const waste = Math.max(0, litres - left) / litres;
                    const c = cell(x, crop);
                    const score = 100 * cover - 40 * waste - 15 * c.warnings.length
                        + (cropOrderKey(crop) === cropOrderKey(x.current) ? 8 : 0);
                    if (!best || score > best.score) best = { x, crop, litres, score };
                });
            });
            if (!best) { n.blocked = hitLimit ? 'limit' : 'fields'; break; }
            assigned[best.x.idx] = { crop: best.crop, res: n.res, litres: best.litres, reason: 'need' };
            usedHa += best.x.area;
            n.planned += best.litres;
            // A cereal also leaves straw for bedding.
            const straw = needByRes['feed:STRAW'];
            if (straw && n !== straw && remaining(straw) > 0 && cropStrawRate(best.crop) !== null) {
                const s = perHa(best.x, best.crop, 'feed:STRAW') * best.x.area;
                straw.planned += s;
                assigned[best.x.idx].straw = s;
            }
        }
        if (!candidates.length) n.blocked = 'nocrop';
    });

    // The rest: their cycle, else what is planned already, else the best margin.
    const marginOf = (x, crop) => {
        const c = cell(x, crop);
        if ('margin' in c) return c.margin;
        const ft = genCropFillType(market, crop);
        const row = market && ft ? market.prices[ft] : null;
        const vals = row ? row.filter(v => v !== null) : [];
        const price = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
        const y = fieldExpectedYield(x.f, x.idx, crop, rates, null).perHa;
        c.margin = price !== null && y !== null ? price * y / 1000 - fieldInputCostPerHa(farm, x.f, x.idx, crop, rates, market, null).total : null;
        return c.margin;
    };
    fields.forEach(x => {
        if (x.status !== 'free' || assigned[x.idx]) return;
        if (x.info) {
            const crop = genCycleCrop(x.info, mode);
            if (crop !== null && (!crop || usable(x, crop))) { assigned[x.idx] = { crop, reason: 'cycle' }; return; }
        }
        if (x.current && pool.includes(x.current) && usable(x, x.current) && !cell(x, x.current).warnings.length) {
            assigned[x.idx] = { crop: x.current, reason: 'keep' };
            return;
        }
        let best = null;
        pool.forEach(crop => {
            if (!usable(x, crop) || isPerennialCrop(crop)) return;
            const m = marginOf(x, crop);
            // A crop without rotation warnings always beats one with them.
            const score = (m === null ? -1e9 : m) - 1e7 * cell(x, crop).warnings.length;
            if (!best || score > best.score) best = { crop, score, margin: m };
        });
        if (best && best.margin !== null) assigned[x.idx] = { crop: best.crop, reason: 'margin', margin: best.margin };
        else assigned[x.idx] = { crop: x.current, reason: 'keep' };
    });

    // Rows of the proposal.
    const proposals = fields.map(x => {
        const a = assigned[x.idx];
        const to = x.status === 'free' ? (a ? a.crop : x.current) : x.keepCrop;
        const c = to ? cell(x, to) : { warnings: [], sow: '' };
        const reason = x.status === 'free' ? (a ? a.reason : 'keep') : x.status;
        const alts = x.status === 'free' || x.status === 'manual'
            ? genAlternatives(x, a, pool, needs, perHa, usable, marginOf, to) : [];
        return {
            idx: x.idx, key: x.key, number: x.f.number, area: x.area, status: x.status, reason,
            from: x.f.crop || '', planned: x.current,
            to: to || '', sow: to ? c.sow || '' : '',
            res: a && a.res, litres: a && a.litres, straw: a && a.straw, margin: a && a.margin !== undefined ? a.margin : (to ? marginOf(x, to) : null),
            perHa: a && a.res ? perHa(x, to, a.res) : null,
            warnings: to ? c.warnings : [],
            changed: (x.status === 'free' || x.status === 'manual') && cropOrderKey(to || '') !== cropOrderKey(x.current || ''),
            alts
        };
    });

    // What to tell the player.
    const problems = [];
    needs.forEach(n => {
        const left = remaining(n);
        if (n.buyOnly || n.fromFarm || left <= 1) return;
        if (n.blocked === 'nocrop') {
            const crop = AVAILABLE_CROPS.find(c => settings.excluded.includes(c) && genRateFor(c, n.res, plan) !== null);
            problems.push({ kind: 'nocrop', res: n.res, crop });
        } else if (n.blocked === 'limit' && settings.limitPct < 100) {
            problems.push({ kind: 'limit', res: n.res, litres: left, to: Math.min(100, settings.limitPct + 20) });
        } else problems.push({ kind: 'fields', res: n.res, litres: left });
    });
    proposals.filter(p => p.changed && p.warnings.length).forEach(p => problems.push({ kind: 'warn', idx: p.idx, number: p.number, text: p.warnings[0].text }));

    return { mode, settings, needs, proposals, freeHa, limitHa, usedHa, problems, remaining };
}

// The season to plan by default: this one while fields are still to be sown.
function genDefaultMode(farm) {
    return (farm.fields || []).some(f => f.state !== 'Planted' && !f.carriedFrom && (parseFloat(f.area) || 0) > 0
        && genSowThisSeason(f.crop || 'Wheat', farm.month)) ? 'this' : 'next';
}

// The crop a field's cycle gives it in the planned season ('' = fallow, null = none).
function genCycleCrop(info, mode) {
    if (!info) return null;
    return (mode === 'next' ? rotationSlotAt(info.rot, info.index + 1) : info.slot).crop || '';
}

// Up to three other crops for a field: for its need first, else by margin.
function genAlternatives(x, a, pool, needs, perHa, usable, marginOf, chosen) {
    const out = [];
    const res = a && a.res;
    const seen = new Set([cropOrderKey(chosen || '')]);
    if (res) {
        pool.filter(c => !seen.has(cropOrderKey(c)) && usable(x, c) && perHa(x, c, res) > 0)
            .map(c => ({ crop: c, litres: perHa(x, c, res) * x.area }))
            .sort((p, q) => q.litres - p.litres).slice(0, 3)
            .forEach(o => { seen.add(cropOrderKey(o.crop)); out.push({ crop: o.crop, res, litres: o.litres }); });
    }
    pool.filter(c => !seen.has(cropOrderKey(c)) && usable(x, c) && !isPerennialCrop(c))
        .map(c => ({ crop: c, margin: marginOf(x, c) })).filter(o => o.margin !== null)
        .sort((p, q) => q.margin - p.margin).slice(0, Math.max(0, 3 - out.length))
        .forEach(o => out.push(o));
    return out;
}

// --- The tab ---------------------------------------------------------------------
function cropGeneratorHtml(farm) {
    const plan = genLastPlan = buildCropGeneratorPlan(farm);
    const s = plan.settings;
    const num = n => Math.round(n).toLocaleString(FIN_LOCALE());
    const ha = v => v.toFixed(2) + ' ha';
    if (!plan.proposals.length) return `<p class="settings-hint">${t('genNoFields')}</p>`;

    const stateOf = n => {
        if (n.buyOnly) return 'buy';
        if (n.fromFarm) return 'farm';
        if (plan.remaining(n) <= 1) return 'ok';
        return n.blocked === 'nocrop' ? 'none' : 'short';
    };
    const needs = plan.needs.map(n => ({ n, state: stateOf(n) }));
    const count = st => needs.filter(x => st.includes(x.state)).length;

    // Mode switch and KPIs.
    const modeBtn = m => `<button type="button" class="view-tab gen-mode${plan.mode === m ? ' is-active' : ''}" data-gen-mode="${m}" aria-pressed="${plan.mode === m}">${t('genMode_' + m).replace('{n}', (farm.currentSeason || 1) + (m === 'next' ? 1 : 0))}</button>`;
    let html = `<div class="cropgen">
        <div class="gen-head">
            <p class="supply-intro">${t('genIntro')}</p>
            <div class="view-tabs gen-modes" role="group" aria-label="${escapeHtml(t('genModeLabel'))}">${modeBtn('this')}${modeBtn('next')}</div>
        </div>`;
    if (!plan.needs.length) {
        html += `<p class="hub-panel-note">${t('genEmpty')}</p>`;
    } else {
        const kpi = (filter, label, value, cls) => `<button type="button" class="fin-kpi gen-kpi${cls ? ' ' + cls : ''}${genNeedFilter === filter ? ' is-active' : ''}" data-gen-needs="${filter}" aria-pressed="${genNeedFilter === filter}">
            <span class="fin-kpi-label">${label}</span><span class="fin-kpi-value">${value}</span></button>`;
        const short = count(['short', 'none']);
        html += `<div class="fin-kpis gen-kpis">
            ${kpi('all', t('genKpiNeeds'), needs.length)}
            ${kpi('ok', t('genKpiCovered'), count(['ok', 'farm']))}
            ${kpi('short', t('genKpiShort'), short, short ? 'fin-kpi--alert' : '')}
            ${kpi('buy', t('genKpiBuy'), count(['buy']))}
        </div>`;
    }

    // Area for the needs.
    const pct = plan.limitHa > 0 ? Math.min(100, plan.usedHa / plan.limitHa * 100) : 0;
    html += `<div class="gen-limit">
        <span class="gen-limit-label">${t('genLimit')}</span>
        <div class="pen-bar-track" role="progressbar" aria-label="${escapeHtml(t('genLimit'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="pen-bar-fill ${pct >= 99.5 ? 'pen-bar-fill--mid' : 'pen-bar-fill--ok'}" style="width:${Math.max(2, pct)}%"></div></div>
        <span class="gen-limit-value">${t('genLimitValue').replace('{used}', plan.usedHa.toFixed(1)).replace('{limit}', plan.limitHa.toFixed(1)).replace('{pct}', s.limitPct).replace('{free}', plan.freeHa.toFixed(1))}</span>
    </div>`;

    // Needs, by group.
    if (plan.needs.length) {
        html += `<div class="hub-panel-subtitle">${t('genNeedsTitle')}</div><div class="gen-needs">`;
        s.priority.forEach(g => {
            const list = needs.filter(x => x.n.group === g && (genNeedFilter === 'all'
                || (genNeedFilter === 'ok' && ['ok', 'farm'].includes(x.state))
                || (genNeedFilter === 'short' && ['short', 'none'].includes(x.state))
                || (genNeedFilter === 'buy' && x.state === 'buy')));
            if (!list.length) return;
            const open = list.filter(x => !['ok', 'farm'].includes(x.state) || genNeedFilter !== 'all');
            const done = list.filter(x => !open.includes(x));
            html += `<section class="gen-group"><h5 class="gen-group-title"><i class="fa-solid ${GEN_GROUP_ICONS[g]}" aria-hidden="true"></i> ${t('genGroup_' + g)}</h5>
                ${open.map(x => genNeedRowHtml(plan, x.n, x.state, num)).join('')}
                ${done.length ? `<details class="gen-covered" data-gen-details="covered:${g}"><summary>${t('genCoveredMore').replace('{n}', done.length)}</summary>${done.map(x => genNeedRowHtml(plan, x.n, x.state, num)).join('')}</details>` : ''}
            </section>`;
        });
        html += '</div>';
    }

    // Problems.
    if (plan.problems.length) {
        html += `<details class="gen-problems" data-gen-details="problems"${plan.problems.some(p => p.kind !== 'warn') ? ' open' : ''}><summary><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${t('genProblems').replace('{n}', plan.problems.length)}</summary><ul>`
            + plan.problems.map(p => {
                const res = p.res ? escapeHtml(genResourceLabel(p.res)) : '';
                if (p.kind === 'limit') return `<li>${t('genProbLimit').replace('{res}', res).replace('{l}', num(p.litres)).replace('{pct}', s.limitPct)} <button type="button" class="settings-btn gen-fix" data-gen-limit="${p.to}">${t('genProbRaise').replace('{pct}', p.to)}</button></li>`;
                if (p.kind === 'nocrop') return `<li>${t('genProbNoCrop').replace('{res}', res)}${p.crop ? ` <button type="button" class="settings-btn gen-fix" data-gen-allow="${escapeHtml(p.crop)}">${t('genProbAddCrop').replace('{crop}', escapeHtml(translateCropName(p.crop)))}</button>` : ''}</li>`;
                if (p.kind === 'fields') return `<li>${t('genProbFields').replace('{res}', res).replace('{l}', num(p.litres))}</li>`;
                return `<li>${t('genProbWarn').replace('{n}', escapeHtml(String(p.number))).replace('{text}', escapeHtml(p.text))} <button type="button" class="settings-btn gen-fix" data-gen-open="${p.idx}">${t('genProbOpen')}</button></li>`;
            }).join('') + '</ul></details>';
    }

    // Proposal table.
    const rows = plan.proposals;
    const changed = rows.filter(p => p.changed);
    const warned = rows.filter(p => p.changed && p.warnings.length);
    const filt = (k, label, n) => `<button type="button" class="view-tab gen-filter${genProposalFilter === k ? ' is-active' : ''}" data-gen-filter="${k}" aria-pressed="${genProposalFilter === k}">${label} <span class="gen-count">${n}</span></button>`;
    const shown = genProposalFilter === 'changed' ? changed : (genProposalFilter === 'warn' ? warned : rows);
    html += `<div class="gen-proposal-head"><div class="hub-panel-subtitle">${t('genProposalTitle').replace('{n}', (farm.currentSeason || 1) + (plan.mode === 'next' ? 1 : 0))}</div>
        <div class="view-tabs gen-filters">${filt('all', t('genFilterAll'), rows.length)}${filt('changed', t('genFilterChanged'), changed.length)}${filt('warn', t('genFilterWarn'), warned.length)}</div></div>
        <div class="gen-table-wrap"><table class="gen-table">
        <thead><tr><th>${t('genColField')}</th><th class="num">${t('genColArea')}</th><th>${t('genColNow')}</th><th aria-hidden="true"></th><th>${t('genColProposal')}</th><th>${t('genColFor')}</th><th>${t('genColSow')}</th><th class="gen-col-lock">${t('genColLock')}</th><th aria-label="${escapeHtml(t('genWhyTitle'))}"></th></tr></thead>
        <tbody>${shown.length ? shown.map(p => genProposalRowHtml(farm, plan, p, num)).join('') : `<tr><td colspan="9" class="gen-empty">${t('genNoneInFilter')}</td></tr>`}</tbody>
    </table></div>`;

    // Footer: what applying does.
    const changedHa = changed.reduce((a, p) => a + p.area, 0);
    const stillShort = plan.needs.filter(n => !n.buyOnly && !n.fromFarm && plan.remaining(n) > 1);
    const undo = farm.cropGenerator && farm.cropGenerator.undo;
    html += `<div class="gen-footer">
        <span class="gen-footer-text"><strong>${t('genFooter').replace('{n}', changed.length).replace('{ha}', changedHa.toFixed(2))}</strong>
            ${stillShort.length ? `<span class="gen-footer-short">${t('genFooterShort').replace('{res}', stillShort.slice(0, 3).map(n => escapeHtml(genResourceLabel(n.res))).join(', ') + (stillShort.length > 3 ? '…' : ''))}</span>` : ''}</span>
        ${undo ? `<button type="button" class="settings-btn gen-undo"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> ${t('genUndo')}</button>` : ''}
        <button type="button" class="settings-btn save-btn gen-apply" ${changed.length ? '' : 'disabled'}>${t('genApply')}</button>
    </div>`;

    html += genSettingsHtml(farm, plan);
    return html + '</div>';
}

function genNeedRowHtml(plan, n, state, num) {
    const have = n.stock + n.fixed + n.planned;
    const pct = n.need > 0 ? Math.min(100, have / n.need * 100) : 100;
    const cls = state === 'ok' || state === 'farm' ? 'pen-bar-fill--ok' : (pct >= 60 ? 'pen-bar-fill--mid' : 'pen-bar-fill--low');
    const left = plan.remaining(n);
    const perHa = n.candidates && n.candidates.length ? Math.max(...n.candidates.map(c => (genRateFor(c, n.res, getFeedPlan(getCurrentFarm())) || 0))) : 0;
    const badge = `<span class="gen-badge gen-badge--${state}">${t('genState_' + state)}</span>`;
    const consumers = n.consumers.map(c => escapeHtml(c.name)).join(' · ');
    const shortText = state === 'short' || state === 'none'
        ? `${t('genShortBy').replace('{l}', num(left))}${perHa > 0 ? ` <span class="supply-sub">≈ ${(left / perHa).toFixed(1)} ha</span>` : ''}`
        : (state === 'buy' ? t('genBuyHint') : (state === 'farm' ? t('genFarmHint') : `+${num(-left)} l`));
    const chips = (n.candidates || []).map(c => {
        const used = plan.proposals.some(p => p.res === n.res && cropOrderKey(p.to) === cropOrderKey(c));
        return `<span class="rotation-area-chip gen-chip${used ? '' : ' is-unused'}" style="--crop-color:${rotationCropColor(c)}">${escapeHtml(translateCropName(c))}</span>`;
    }).join('');
    return `<details class="gen-need gen-need--${state}" data-gen-details="need:${escapeHtml(n.res)}">
        <summary>
            <span class="gen-need-icon"><i class="fa-solid ${genResourceIcon(n.res)}" aria-hidden="true"></i></span>
            <span class="gen-need-name">${escapeHtml(genResourceLabel(n.res))}<span class="gen-need-for">${consumers}</span></span>
            <span class="pen-bar-track gen-need-bar" role="progressbar" aria-label="${escapeHtml(genResourceLabel(n.res))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span class="pen-bar-fill ${cls}" style="width:${Math.max(2, pct)}%"></span></span>
            <span class="gen-need-pct">${Math.round(pct)}%</span>
            <span class="gen-need-short">${shortText}</span>
            ${badge}
        </summary>
        <div class="gen-need-body">
            <dl class="gen-need-figures">
                <div><dt>${t('genNeed')}</dt><dd>${num(n.need)} l</dd></div>
                <div><dt>${t('genStock')}</dt><dd>${num(n.stock)} l</dd></div>
                <div><dt>${t('genFixed')}</dt><dd>${num(n.fixed)} l</dd></div>
                <div><dt>${t('genPlanned')}</dt><dd>${num(n.planned)} l</dd></div>
            </dl>
            ${chips ? `<div class="gen-need-path"><span class="supply-sub">${t('genPath').replace('{res}', escapeHtml(genResourceLabel(n.res)))}</span> ${chips}</div>` : ''}
            <p class="supply-sub">${t('genReserveNote').replace('{n}', plan.settings.reservePct)}</p>
        </div>
    </details>`;
}

function genCropCell(crop, sub) {
    if (!crop) return `<span class="gen-crop is-empty">${t('rotFallow')}</span>`;
    return `<span class="gen-crop" style="--crop-color:${rotationCropColor(crop)}">${escapeHtml(translateCropName(crop))}${sub ? `<span class="supply-sub">${sub}</span>` : ''}</span>`;
}

function genProposalRowHtml(farm, plan, p, num) {
    const open = genOpenRows.has(p.key);
    const fixed = !['free', 'manual', 'locked'].includes(p.status);
    const cls = ['gen-row', p.changed ? 'is-changed' : '', p.changed && p.warnings.length ? 'is-warn' : '', fixed ? 'is-fixed' : ''].filter(Boolean).join(' ');
    let forText;
    if (p.reason === 'need') forText = `${escapeHtml(genResourceLabel(p.res))} <span class="supply-sub">${t('genGroup_' + (plan.needs.find(n => n.res === p.res) || {}).group)}</span>`;
    else forText = t('genFor_' + p.reason);
    const sow = p.sow ? translateMonth(p.sow) : (p.to ? '–' : '');
    const name = fieldNameOf(farm, p.number);
    const lockable = p.status === 'free' || p.status === 'locked' || p.status === 'manual';
    const lock = lockable
        ? `<input type="checkbox" class="gen-lock fp-check" data-gen-key="${escapeHtml(p.key)}" ${p.status !== 'free' ? 'checked' : ''} aria-label="${escapeHtml(t('genLockHint').replace('{n}', p.number))}" title="${escapeHtml(t('genLockHint').replace('{n}', p.number))}">`
        : `<i class="fa-solid fa-lock gen-lock-icon" aria-hidden="true" title="${escapeHtml(t('genFor_' + p.status))}"></i>`;
    let html = `<tr class="${cls}">
        <td><span class="field-number-chip">${escapeHtml(String(p.number))}</span>${name ? ` <span class="gen-field-name">${escapeHtml(name)}</span>` : ''}</td>
        <td class="num">${p.area.toFixed(2)}</td>
        <td>${genCropCell(p.from)}</td>
        <td class="gen-arrow" aria-hidden="true">${p.changed ? '<i class="fa-solid fa-arrow-right"></i>' : ''}</td>
        <td>${genCropCell(p.to)}${p.changed && p.warnings.length ? ` <i class="fa-solid fa-triangle-exclamation gen-warn-icon" title="${escapeHtml(p.warnings.map(w => w.text).join('\n'))}"></i>` : ''}</td>
        <td class="gen-for">${forText}</td>
        <td>${sow}</td>
        <td class="gen-col-lock">${lock}</td>
        <td><button type="button" class="feed-ration-tool gen-why-btn" data-gen-why="${escapeHtml(p.key)}" aria-expanded="${open}" title="${escapeHtml(t('genWhyTitle'))}"><i class="fa-solid fa-chevron-${open ? 'up' : 'down'}" aria-hidden="true"></i></button></td>
    </tr>`;
    if (open) html += `<tr class="gen-why-row"><td colspan="9">${genWhyHtml(plan, p, num)}</td></tr>`;
    return html;
}

function genWhyHtml(plan, p, num) {
    const items = [];
    const n = p.res ? plan.needs.find(x => x.res === p.res) : null;
    if (p.reason === 'need' && n) {
        items.push(t('genWhyNeed').replace('{l}', num(p.litres)).replace('{res}', escapeHtml(genResourceLabel(p.res))).replace('{who}', escapeHtml(n.consumers.map(c => c.name).join(', '))));
        if (p.perHa) items.push(t('genWhyYield').replace('{l}', num(p.perHa)));
        if (p.straw) items.push(t('genWhyStraw').replace('{l}', num(p.straw)));
    } else if (p.reason === 'cycle') items.push(t('genWhyCycle'));
    else if (p.reason === 'margin') items.push(t('genWhyMargin'));
    else if (p.reason === 'keep') items.push(t('genWhyKeep'));
    else items.push(t('genWhy_' + p.status));
    if (p.margin !== null && p.margin !== undefined && p.to) items.push(t('genWhyMarginValue').replace('{m}', finMoney(Math.round(p.margin))));
    if (p.sow) items.push(t('genWhySow').replace('{m}', translateMonth(p.sow)));
    items.push(p.warnings.length ? p.warnings.map(w => `<span class="gen-why-warn is-${w.level}">${escapeHtml(w.text)}</span>`).join(' ') : t('genWhyRotationOk'));
    const alts = p.alts.length ? `<div class="gen-alts"><span class="supply-sub">${t('genAlts')}</span>
        ${p.alts.map(a => `<button type="button" class="rotation-area-chip gen-alt" style="--crop-color:${rotationCropColor(a.crop)}" data-gen-pick="${escapeHtml(a.crop)}" data-gen-key="${escapeHtml(p.key)}">${escapeHtml(translateCropName(a.crop))}
            <span class="supply-sub">${a.litres ? num(a.litres) + ' l' : (a.margin !== null && a.margin !== undefined ? finMoney(Math.round(a.margin)) + '/ha' : '')}</span></button>`).join('')}
        ${p.status === 'manual' ? `<button type="button" class="settings-btn gen-alt-reset" data-gen-key="${escapeHtml(p.key)}">${t('genManualReset')}</button>` : ''}</div>` : '';
    return `<div class="gen-why"><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>${alts}</div>`;
}

function genSettingsHtml(farm, plan) {
    const s = plan.settings;
    const tiles = Object.keys(GEN_PROFILES).map(k => `<button type="button" class="feed-ration-tile gen-profile${s.profile === k ? ' feed-ration-tile--active' : ''}" data-gen-profile="${k}" aria-pressed="${s.profile === k}">
            <span class="gen-profile-name"><i class="fa-solid ${GEN_PROFILE_ICONS[k]}" aria-hidden="true"></i> ${t('genProfile_' + k)}</span>
            <span class="supply-sub">${t('genProfileHint_' + k)}</span></button>`).join('');
    const prio = s.priority.map((g, i) => `<li class="gen-prio-item"><i class="fa-solid ${GEN_GROUP_ICONS[g]}" aria-hidden="true"></i> ${t('genGroup_' + g)}
            <span class="gen-prio-tools">
                <button type="button" class="feed-ration-tool" data-gen-prio="${i}" data-dir="-1" title="${escapeHtml(t('rotMoveUp'))}" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
                <button type="button" class="feed-ration-tool" data-gen-prio="${i}" data-dir="1" title="${escapeHtml(t('rotMoveDown'))}" ${i === s.priority.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>
            </span></li>`).join('');
    const crops = AVAILABLE_CROPS.filter(c => CROP_CALENDAR[c] && getCropYieldRate(c) !== null && !(isCatchCropChoice(c) && !isPerennialCrop(c)) && !MARKET_UNSOLD_CROPS.includes(c));
    const chips = crops.map(c => {
        const on = !s.excluded.includes(c);
        return `<button type="button" class="rotation-area-chip gen-crop-toggle${on ? '' : ' is-unused'}" style="--crop-color:${rotationCropColor(c)}" data-gen-crop="${escapeHtml(c)}" aria-pressed="${on}">${on ? '<i class="fa-solid fa-check" aria-hidden="true"></i> ' : ''}${escapeHtml(translateCropName(c))}</button>`;
    }).join('');
    return `<details class="feed-settings gen-settings" data-gen-details="settings"${genSettingsOpen ? ' open' : ''}>
        <summary><i class="fa-solid fa-sliders" aria-hidden="true"></i> ${t('genSettings')}</summary>
        <div class="gen-settings-body">
            <div class="settings-field"><span>${t('genProfile')}</span><div class="gen-profiles">${tiles}</div></div>
            <div class="gen-settings-cols">
                <div class="settings-field"><span>${t('genPriority')}</span><ol class="gen-prio">${prio}</ol></div>
                <div class="settings-field">
                    <label for="gen-limit-range">${t('genLimitLabel')}</label>
                    <div class="gen-range"><input type="range" id="gen-limit-range" min="0" max="100" step="5" value="${s.limitPct}">
                        <input type="number" id="gen-limit-num" class="gen-num" min="0" max="100" step="1" value="${s.limitPct}" aria-label="${escapeHtml(t('genLimitLabel'))}"> %</div>
                    <span class="settings-hint">${t('genLimitHint')}</span>
                    <label for="gen-reserve">${t('genReserve')}</label>
                    <div class="gen-range"><input type="number" id="gen-reserve" class="gen-num" min="0" max="50" step="5" value="${s.reservePct}"> %</div>
                    <label class="gen-check"><input type="checkbox" class="fp-check" id="gen-keep-cycles" ${s.keepCycles ? 'checked' : ''}> ${t('genKeepCycles')}</label>
                    <label class="gen-check"><input type="checkbox" class="fp-check" id="gen-avoid-red" ${s.avoidRed ? 'checked' : ''}> ${t('genAvoidRed')}</label>
                </div>
            </div>
            <div class="settings-field"><span>${t('genCrops')}</span><div class="gen-crop-chips">${chips}</div></div>
        </div>
    </details>`;
}

// --- Applying and undoing ---------------------------------------------------------
const GEN_UNDO_PROPS = ['crop', 'sowingMonth', 'state', 'catchCrop', 'catchSowingMonth', 'tillage', 'nextCrop'];

function genPreviewHtml(farm, plan, changed) {
    const before = {}, after = {};
    plan.proposals.forEach(p => {
        if (p.status !== 'free' && p.status !== 'manual') return;
        before[p.from || ''] = (before[p.from || ''] || 0) + p.area;
        after[p.to || ''] = (after[p.to || ''] || 0) + p.area;
    });
    const crops = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => (after[b] || 0) - (after[a] || 0));
    const max = Math.max(1, ...crops.map(c => Math.max(before[c] || 0, after[c] || 0)));
    const bar = (v, c) => `<span class="gen-pv-bar" style="width:${Math.round((v || 0) / max * 110)}px;--crop-color:${rotationCropColor(c)}"></span>`;
    const list = changed.map(p => `<li><span class="field-number-chip">${escapeHtml(String(p.number))}</span> ${genCropCell(p.from)} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i> ${genCropCell(p.to)}${p.sow ? ` <span class="supply-sub">${translateMonth(p.sow)}</span>` : ''}</li>`).join('');
    return `<p>${t(plan.mode === 'next' ? 'genPreviewNext' : 'genPreviewThis').replace('{n}', (farm.currentSeason || 1) + 1)}</p>
        <ul class="gen-pv-list">${list}</ul>
        <table class="gen-pv-table"><thead><tr><th></th><th>${t('genPreviewBefore')}</th><th>${t('genPreviewAfter')}</th></tr></thead><tbody>
        ${crops.map(c => `<tr><td>${c ? escapeHtml(translateCropName(c)) : t('rotFallow')}</td>
            <td><span class="gen-pv-cell">${bar(before[c], c)}<span>${(before[c] || 0).toFixed(1)} ha</span></span></td>
            <td><span class="gen-pv-cell">${bar(after[c], c)}<span>${(after[c] || 0).toFixed(1)} ha</span></span></td></tr>`).join('')}
        </tbody></table>`;
}

// saveFeedPlan's shape, on this farm object (saved with it).
function genStoreFeedPlan(farm, plan) {
    const { tmr, ...rest } = plan;
    farm.feedPlan = { ...rest, tmrShares: tmr };
}

async function applyCropGenerator(farm) {
    const plan = buildCropGeneratorPlan(farm);
    const changed = plan.proposals.filter(p => p.changed);
    if (!changed.length) return;
    const ok = await showDialog({
        title: t('genPreviewTitle').replace('{n}', changed.length),
        bodyHtml: genPreviewHtml(farm, plan, changed),
        confirmText: t('genConfirm'), cancelText: t('cancel'), icon: 'fa-wand-magic-sparkles'
    });
    if (ok !== true) return;

    writeFieldsBackup(farm, JSON.parse(JSON.stringify(farm.fields || [])), 'generator');
    const feedPlan = getFeedPlan(farm);
    const undo = { at: new Date().toISOString(), mode: plan.mode, fields: [],
        fieldUse: JSON.parse(JSON.stringify(feedPlan.fieldUse || {})), strawFields: JSON.parse(JSON.stringify(feedPlan.strawFields || {})) };
    changed.forEach(p => {
        const field = farm.fields[p.idx];
        const before = {};
        GEN_UNDO_PROPS.forEach(k => { before[k] = field[k] === undefined ? null : JSON.parse(JSON.stringify(field[k])); });
        undo.fields.push({ idx: p.idx, number: field.number, before });
        if (plan.mode === 'this') {
            applyRotationSlot(field, { crop: p.to, catchCrop: '', sowingMonth: p.sow });
            if (p.sow) field.sowingMonth = p.sow;
        } else {
            field.nextCrop = { crop: p.to, sowingMonth: p.sow || '', reason: p.res || p.reason };
        }
        // The feed planner uses the field for what it was planned for.
        const key = fertPlanSoilKey(field, p.idx) + '::' + p.to;
        if (p.res && p.res.startsWith('feed:')) {
            const cat = p.res.slice(5);
            if (cat === 'STRAW') feedPlan.strawFields[key] = true;
            else {
                const use = genUseFor(p.to, cat);
                if (use) feedPlan.fieldUse[key] = use;
            }
        } else if (p.res) feedPlan.fieldUse[key] = 'sale';
        if (p.straw) feedPlan.strawFields[key] = true;
    });
    farm.cropGenerator.undo = undo;
    farm.cropGenerator.manual = {};
    genStoreFeedPlan(farm, feedPlan);
    saveFarmData(farm);
    renderSeasonView();
    renderRotationModal();
    showAutoSyncToast(t('genAppliedToast').replace('{n}', changed.length), 3000);
}

async function undoCropGenerator(farm) {
    const undo = farm.cropGenerator && farm.cropGenerator.undo;
    if (!undo) return;
    const ok = await showConfirm({
        title: t('genUndoTitle'),
        body: t('genUndoBody').replace('{n}', undo.fields.length).replace('{date}', new Date(undo.at).toLocaleString(FIN_LOCALE())),
        confirmText: t('genUndo')
    });
    if (ok !== true) return;
    undo.fields.forEach(u => {
        const field = farm.fields[u.idx];
        if (!field || String(field.number) !== String(u.number)) return;
        GEN_UNDO_PROPS.forEach(k => {
            if (u.before[k] === null) delete field[k];
            else field[k] = u.before[k];
        });
    });
    const feedPlan = getFeedPlan(farm);
    feedPlan.fieldUse = undo.fieldUse || {};
    feedPlan.strawFields = undo.strawFields || {};
    genStoreFeedPlan(farm, feedPlan);
    delete farm.cropGenerator.undo;
    saveFarmData(farm);
    renderSeasonView();
    renderRotationModal();
    showAutoSyncToast(t('genUndoneToast'), 2500);
}

// --- Events -------------------------------------------------------------------------
// Opened or closed by hand, the tab's <details> (needs, covered, problems,
// settings) stay that way when a change redraws it.
let genSettingsOpen = false;
function genRerender() {
    rerenderKeepingFocus(() => {
        const state = {};
        document.querySelectorAll('.cropgen details[data-gen-details]').forEach(d => { state[d.dataset.genDetails] = d.open; });
        renderRotationModal();
        document.querySelectorAll('.cropgen details[data-gen-details]').forEach(d => {
            const k = d.dataset.genDetails;
            if (k in state) d.open = state[k];
        });
    });
}

(function wireCropGenerator() {
    const body = document.getElementById('hub-panel-body');
    if (!body) return;
    const settingsOf = () => { const farm = getCurrentFarm(); return farm ? { farm, s: getGeneratorSettings(farm) } : null; };
    const save = (farm, custom) => {
        const s = farm.cropGenerator;
        if (custom) s.profile = 'custom';
        saveFarmData(farm);
        genRerender();
    };

    body.addEventListener('click', e => {
        // "Plan it in the generator" on a feed planner tile that is short.
        if (e.target.closest('.feed-to-generator')) { genNeedFilter = 'short'; openRotationView('generator'); return; }
        if (!e.target.closest('.cropgen')) return;
        const ctx = settingsOf();
        if (!ctx) return;
        const { farm, s } = ctx;
        const el = e.target.closest('button');
        if (!el || el.disabled) return;
        if (el.dataset.genMode) { s.mode = el.dataset.genMode; genOpenRows = new Set(); return save(farm); }
        if (el.dataset.genNeeds) { genNeedFilter = el.dataset.genNeeds; return genRerender(); }
        if (el.dataset.genFilter) { genProposalFilter = el.dataset.genFilter; return genRerender(); }
        if (el.dataset.genWhy) {
            const k = el.dataset.genWhy;
            if (genOpenRows.has(k)) genOpenRows.delete(k); else genOpenRows.add(k);
            return genRerender();
        }
        if (el.dataset.genPick) { s.manual[el.dataset.genKey] = el.dataset.genPick; delete s.locks[el.dataset.genKey]; return save(farm); }
        if (el.classList.contains('gen-alt-reset')) { delete s.manual[el.dataset.genKey]; return save(farm); }
        if (el.dataset.genLimit) { s.limitPct = parseInt(el.dataset.genLimit, 10); return save(farm, true); }
        if (el.dataset.genAllow) { s.excluded = s.excluded.filter(c => c !== el.dataset.genAllow); return save(farm); }
        if (el.dataset.genOpen) { openFieldModal(+el.dataset.genOpen); return; }
        if (el.dataset.genProfile) {
            const p = GEN_PROFILES[el.dataset.genProfile];
            Object.assign(s, { profile: el.dataset.genProfile, priority: p.priority.slice(), limitPct: p.limitPct, keepCycles: p.keepCycles, avoidRed: p.avoidRed });
            return save(farm);
        }
        if (el.dataset.genPrio !== undefined) {
            const i = +el.dataset.genPrio, j = i + (+el.dataset.dir);
            if (j < 0 || j >= s.priority.length) return;
            [s.priority[i], s.priority[j]] = [s.priority[j], s.priority[i]];
            return save(farm, true);
        }
        if (el.dataset.genCrop) {
            const c = el.dataset.genCrop;
            s.excluded = s.excluded.includes(c) ? s.excluded.filter(x => x !== c) : [...s.excluded, c];
            return save(farm);
        }
        if (el.classList.contains('gen-apply')) { applyCropGenerator(farm); return; }
        if (el.classList.contains('gen-undo')) { undoCropGenerator(farm); return; }
    });

    body.addEventListener('change', e => {
        if (!e.target.closest('.cropgen')) return;
        const ctx = settingsOf();
        if (!ctx) return;
        const { farm, s } = ctx;
        const el = e.target;
        if (el.classList.contains('gen-lock')) {
            const k = el.dataset.genKey;
            if (el.checked) s.locks[k] = true;
            else { delete s.locks[k]; delete s.manual[k]; }
            return save(farm);
        }
        if (el.id === 'gen-limit-range' || el.id === 'gen-limit-num') {
            s.limitPct = Math.max(0, Math.min(100, parseInt(el.value, 10) || 0));
            return save(farm, true);
        }
        if (el.id === 'gen-reserve') { s.reservePct = Math.max(0, Math.min(50, parseInt(el.value, 10) || 0)); return save(farm); }
        if (el.id === 'gen-keep-cycles') { s.keepCycles = el.checked; return save(farm, true); }
        if (el.id === 'gen-avoid-red') { s.avoidRed = el.checked; return save(farm, true); }
    });

    // The range moves the number live; the plan follows on release (change).
    body.addEventListener('input', e => {
        if (e.target.id !== 'gen-limit-range') return;
        const n = document.getElementById('gen-limit-num');
        if (n) n.value = e.target.value;
    });

    body.addEventListener('toggle', e => {
        if (!e.target.classList || !e.target.classList.contains('gen-settings')) return;
        genSettingsOpen = e.target.open;
    }, true);
})();
