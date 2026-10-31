// =============================================================
// FEED PLANNER (Farm Hub → "Feed planner") and the feed model behind the
// Animals view: rations, feed mixers, mixer wagon, stock and yearly demand.
// =============================================================
// A classic <script> loaded before renderer.js (see index.html): only
// constants, state and function declarations at the top level, so it runs
// before the rest of the app exists. Everything here shares the page's global
// scope with renderer.js — fs, path, t(), getCurrentFarm()… are resolved when
// a function runs, never at load time.

// =============================================================
// Farm Hub → "Feed planner": the herd's yearly feed need (split by the ration
// chosen per species) against the yield of the fields set aside for feed.
// =============================================================

// Feed categories every ration is expressed in. Each one maps to the crops
// that can supply it (see FEED_CROP_USES) — GRASS/HAY/SILAGE all come out of
// the same grassland pool (grass windrow dries to hay or ferments to silage
// litre for litre), so the balance table merges them into one "roughage" row.
const FEED_CATEGORIES = ['GRASS', 'HAY', 'SILAGE', 'STRAW', 'MINERAL', 'PIG_BASE', 'GRAIN', 'PROTEIN', 'EARTH', 'OAT'];
const FEED_ROUGHAGE = ['GRASS', 'HAY', 'SILAGE'];
const FEED_ANIMAL_TYPES = ['COW', 'PIG', 'SHEEP', 'HORSE', 'CHICKEN'];

// FS25 sdk/xmlDoku/character/animalFood.xml — food groups per animal type.
// efficiency = the group's productionWeight (x100); PIG/HORSE eat every group
// in parallel, so their fixed mix uses the eatWeight shares (horse weights
// sum to 1.05 in the game file and are normalized here). A map with its own
// animalFood.xml replaces these per farm — see applyMapAnimalFood.
const BASE_ANIMAL_FOOD_GROUPS = {
    COW: {
        forage: { tmr: true, efficiency: 100 },
        hay: { efficiency: 80, ingredients: [{ category: 'HAY', pct: 100 }] },
        silage: { efficiency: 80, ingredients: [{ category: 'SILAGE', pct: 100 }] },
        grass: { efficiency: 40, ingredients: [{ category: 'GRASS', pct: 100 }] }
    },
    SHEEP: {
        grass: { efficiency: 100, ingredients: [{ category: 'GRASS', pct: 100 }] },
        hay: { efficiency: 100, ingredients: [{ category: 'HAY', pct: 100 }] }
    },
    PIG: {
        mix: { efficiency: 100, ingredients: [
            { category: 'PIG_BASE', pct: 50 }, { category: 'GRAIN', pct: 25 },
            { category: 'PROTEIN', pct: 20 }, { category: 'EARTH', pct: 5 }] }
    },
    HORSE: {
        mix: { efficiency: 100, ingredients: [
            { category: 'OAT', pct: 25 / 1.05 }, { category: 'HAY', pct: 75 / 1.05 },
            { category: 'EARTH', pct: 5 / 1.05 }] }
    },
    CHICKEN: {
        grain: { efficiency: 100, ingredients: [{ category: 'GRAIN', pct: 100 }] }
    }
};
// Same file, <recipes><recipe fillType="FORAGE">: allowed share per TMR ingredient.
const BASE_TMR_LIMITS = { HAY: [20, 75], SILAGE: [20, 75], STRAW: [0, 30], MINERAL: [0, 7] };
const TMR_DEFAULT = { HAY: 40, SILAGE: 40, STRAW: 15, MINERAL: 5 };

// What the open farm's barns follow: the base game's, or its map's.
let ANIMAL_FOOD_GROUPS = JSON.parse(JSON.stringify(BASE_ANIMAL_FOOD_GROUPS));
let TMR_LIMITS = { ...BASE_TMR_LIMITS };
let MIXER_TMR_CATEGORIES = Object.keys(TMR_LIMITS);
// Which file they came from (null = base game), for the settings mod list.
let animalFoodSource = null;

// Feed categories a food group's fillTypes count as, in order, no repeats.
function foodGroupCategories(fillTypes) {
    return [...new Set(String(fillTypes || '').split(/\s+/).map(ft => FEED_FILLTYPE_CATEGORY[ft.toUpperCase()]).filter(Boolean))];
}

// Applies a map's animalFood.xml (map-crops.js readMapAnimalFood) on top of
// the base game's groups — or resets to them when mapFood is null.
// SERIAL animals: each base ration whose ingredients the map still feeds
// takes the map group's productionWeight (Krajów: hay 60 % instead of 80 %);
// rations the map doesn't feed are dropped, groups the base game doesn't
// have become rations of their own. PARALLEL animals: one mix from the map's
// eatWeights. The FORAGE recipe gives the TMR limits.
function applyMapAnimalFood(mapFood) {
    ANIMAL_FOOD_GROUPS = JSON.parse(JSON.stringify(BASE_ANIMAL_FOOD_GROUPS));
    TMR_LIMITS = { ...BASE_TMR_LIMITS };
    animalFoodSource = null;
    const xml = mapFood && mapFood.xml;
    if (xml) {
        try {
            const attrOf = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"')); return m ? m[1] : null; };
            for (const am of xml.matchAll(/<animal\b([^>]*)>([\s\S]*?)<\/animal>/g)) {
                const type = (attrOf(am[1], 'animalType') || '').toUpperCase();
                if (!FEED_ANIMAL_TYPES.includes(type)) continue;
                const parallel = /parallel/i.test(attrOf(am[1], 'consumptionType') || '');
                const groups = [...am[2].matchAll(/<foodGroup\b[^>]*>/g)].map(m => ({
                    id: ((attrOf(m[0], 'title') || '').match(/fillTypeGroup_(\w+)/) || [])[1] || '',
                    fillTypes: attrOf(m[0], 'fillTypes') || '',
                    production: parseFloat(attrOf(m[0], 'productionWeight')),
                    eat: parseFloat(attrOf(m[0], 'eatWeight'))
                })).filter(g => !isNaN(g.production));
                if (!groups.length) continue;
                if (parallel) {
                    const eatSum = groups.reduce((sum, g) => sum + (g.eat > 0 ? g.eat : 0), 0) || 1;
                    const ingredients = [];
                    groups.forEach(g => {
                        const cat = foodGroupCategories(g.fillTypes)[0];
                        if (cat && g.eat > 0) ingredients.push({ category: cat, pct: g.eat / eatSum * 100 });
                    });
                    if (ingredients.length) ANIMAL_FOOD_GROUPS[type] = { mix: { efficiency: 100, ingredients } };
                    continue;
                }
                const base = BASE_ANIMAL_FOOD_GROUPS[type] || {};
                const next = {};
                groups.forEach(g => {
                    const eff = Math.round(g.production * 100);
                    if (/\bFORAGE\b/i.test(g.fillTypes)) { next.forage = { tmr: true, efficiency: eff }; return; }
                    const cats = foodGroupCategories(g.fillTypes);
                    let matched = false;
                    Object.keys(base).forEach(id => {
                        const r = base[id];
                        if (r.tmr || next[id] || !r.ingredients.every(i => cats.includes(i.category))) return;
                        next[id] = { ...r, efficiency: eff };
                        matched = true;
                    });
                    if (!matched && cats.length && g.id && !next[g.id]) {
                        next[g.id] = { efficiency: eff, ingredients: [{ category: cats[0], pct: 100 }] };
                    }
                });
                if (Object.keys(next).length) ANIMAL_FOOD_GROUPS[type] = next;
            }
            const recipe = (xml.match(/<recipe\b[^>]*fillType="FORAGE"[^>]*>([\s\S]*?)<\/recipe>/i) || [])[1];
            if (recipe) {
                const limits = {};
                for (const m of recipe.matchAll(/<ingredient\b[^>]*>/g)) {
                    const cat = foodGroupCategories(attrOf(m[0], 'fillTypes'))[0];
                    const min = parseFloat(attrOf(m[0], 'minPercentage'));
                    const max = parseFloat(attrOf(m[0], 'maxPercentage'));
                    if (cat && !isNaN(min) && !isNaN(max)) limits[cat] = [min, max];
                }
                if (Object.keys(limits).length) TMR_LIMITS = limits;
            }
            animalFoodSource = mapFood.modName || null;
        } catch (e) {
            console.warn('Map animalFood.xml unreadable, using the base game', e);
            ANIMAL_FOOD_GROUPS = JSON.parse(JSON.stringify(BASE_ANIMAL_FOOD_GROUPS));
            TMR_LIMITS = { ...BASE_TMR_LIMITS };
        }
    }
    MIXER_TMR_CATEGORIES = Object.keys(TMR_LIMITS);
}

// Which feed category a crop can go to, per "use" option in the field table.
// 'sale' is always offered on top of these. Grassland crops are cut several
// times a year, so their yield is multiplied by plan.grassCuts.
const FEED_GRASSLAND_CROPS = ['Grass', 'Meadow', 'Alfalfa', 'Clover'];
// Crops cut several times a season — the fields table shows "Cuts" (Pokosy)
// for them instead of the sown badge. Teff / field grass come from mod maps.
const CUT_CROPS = [...FEED_GRASSLAND_CROPS, 'Teffgrass', 'Fieldgrass'];
function isCutCrop(crop) {
    return CUT_CROPS.some(c => cropOrderKey(c) === cropOrderKey(crop || ''));
}
// What a cut is for -> feed category (sale = none).
const CUT_USES = ['grass', 'hay', 'silage', 'sale'];
const CUT_USE_CATEGORY = { grass: 'GRASS', hay: 'HAY', silage: 'SILAGE' };
// Chopped whole for silage at their own harvest yield (the maize chaff-yield
// setting doesn't apply to them).
const FEED_SILAGE_OWN_YIELD = ['Greenrye'];
const FEED_CROP_USES = {
    Grass: { feed: 'ROUGHAGE' }, Meadow: { feed: 'ROUGHAGE' }, Alfalfa: { feed: 'ROUGHAGE' }, Clover: { feed: 'ROUGHAGE' },
    Maize: { silage: 'SILAGE', grain: 'PIG_BASE' }, Silagemaize: { silage: 'SILAGE' }, Sorghum: { silage: 'SILAGE', grain: 'PIG_BASE' },
    Greenrye: { silage: 'SILAGE' },
    Wheat: { feed: 'GRAIN' }, Barley: { feed: 'GRAIN' }, Oat: { feed: 'OAT' },
    Soybean: { feed: 'PROTEIN' }, Canola: { feed: 'PROTEIN' }, Sunflower: { feed: 'PROTEIN' },
    Potato: { feed: 'EARTH' }, Sugarbeet: { feed: 'EARTH' }, Beetroot: { feed: 'EARTH' }, Carrot: { feed: 'EARTH' }, Parsnip: { feed: 'EARTH' }
};
// Straw windrow left behind by the combine, l/ha — the crop's straw <windrow>
// litersPerSqm × 10000 (map crop files, else base game). null = no straw.
function cropStrawRate(crop) {
    return cropAgronomy(crop, 'straw');
}
// Reference crop used to turn a shortfall in litres into "about X ha missing".
const FEED_REFERENCE_CROP = { PIG_BASE: 'Maize', GRAIN: 'Wheat', PROTEIN: 'Soybean', EARTH: 'Potato', OAT: 'Oat', STRAW: 'Wheat' };
// animals.xml food/straw curves are litres per in-game *month* — the game
// spreads them over however many days a month has (environment.timeAdjustment),
// so the base game eats the same per month at 1 or 28 days/month. Animal mods
// change that: AnimalFoodCalculator can scale by days/month and/or a
// multiplier, EnhancedAnimalSystem raises food for cows/sheep after calving
// (see animal-mods.js). farm.daysPerPeriod = the save's days/month (synced).
const FEED_PERIODS_PER_YEAR = 12;
function feedDaysPerPeriod(farm) {
    const d = parseInt(farm && farm.daysPerPeriod);
    return d > 0 ? d : 1;
}
function afcActive(farm) {
    return !!(ANIMAL_MODS && ANIMAL_MODS.afc && !disabledModsOf(farm).has('afc'));
}
function easActive(farm) {
    return !!(ANIMAL_MODS && ANIMAL_MODS.eas && !disabledModsOf(farm).has('eas'));
}
// AFCConsumptionScaling:getScaleFactor — food, water and straw.
function feedConsumptionScale(farm) {
    if (!afcActive(farm)) return 1;
    const afc = ANIMAL_MODS.afc;
    if (!afc.enabled) return 1;
    return (afc.autoScaleByDays ? feedDaysPerPeriod(farm) : 1) * afc.customMultiplier;
}
function clusterFoodFactor(farm, type, cluster) {
    return easActive(farm) ? easFoodFactor(ANIMAL_MODS.eas, type, cluster) : 1;
}
// EAS lactation milk factor, or null when EAS isn't in play for this species.
function clusterLactationMilk(farm, type, cluster) {
    return easActive(farm) ? easMilkFactor(ANIMAL_MODS.eas, type, cluster) : null;
}
// Milk output multiplier for a fill type (1 for eggs, wool, manure...).
function clusterMilkFactor(farm, type, cluster, fillType) {
    if (!/MILK/i.test(fillType || '')) return 1;
    const f = clusterLactationMilk(farm, type, cluster);
    return f === null ? 1 : f;
}
// One line under the monthly need: what scales it, so the number is explainable.
function feedScaleNote(farm) {
    const d = feedDaysPerPeriod(farm);
    let note = afcActive(farm)
        ? t('feedScaleAfc').replace('{x}', feedConsumptionScale(farm).toLocaleString(undefined, { maximumFractionDigits: 2 })).replace('{d}', d)
        : t('feedScaleBase').replace('{d}', d);
    if (easActive(farm)) note += ' · ' + t('feedScaleEas');
    return note;
}

// Map/mod animals.xml files name breeds freely (BULL_HOLSTEIN, HEN_LEGHORN,
// ROOSTER_...), so the parent <animal type="..."> recorded at import wins;
// the prefix table only covers data imported before that was stored.
const ANIMAL_TYPE_PREFIXES = [
    ['COW', 'COW'], ['BULL', 'COW'], ['CALF', 'COW'], ['BUFFALO', 'COW'],
    ['PIG', 'PIG'], ['SOW', 'PIG'], ['BOAR', 'PIG'],
    ['SHEEP', 'SHEEP'], ['GOAT', 'SHEEP'], ['RAM', 'SHEEP'], ['LAMB', 'SHEEP'],
    ['HORSE', 'HORSE'], ['PONY', 'HORSE'],
    ['CHICKEN', 'CHICKEN'], ['HEN', 'CHICKEN'], ['ROOSTER', 'CHICKEN']
];
function animalTypeOf(subType) {
    const def = ANIMAL_NEEDS_DATA[subType];
    if (def && FEED_ANIMAL_TYPES.includes(def.animalType)) return def.animalType;
    const s = String(subType || '').toUpperCase();
    const hit = ANIMAL_TYPE_PREFIXES.find(([prefix]) => s.startsWith(prefix));
    return hit ? hit[1] : null;
}

function defaultRationFor(type) {
    return Object.keys(ANIMAL_FOOD_GROUPS[type] || {})[0] || '';
}

function getFeedPlan(farm) {
    const saved = (farm && farm.feedPlan && typeof farm.feedPlan === 'object') ? farm.feedPlan : {};
    return {
        rations: { ...(saved.rations || {}) },
        // Ration per barn and species: { [barnId]: { [type]: rationId } }.
        // A barn without its own choice uses the species' ration above.
        barnRations: JSON.parse(JSON.stringify(saved.barnRations || {})),
        customFeeds: Array.isArray(saved.customFeeds) ? saved.customFeeds : [],
        // The farm's TMR shares (tmrShares — the old fixed `tmr` key is
        // ignored), kept only while they fit the map's recipe.
        tmr: validTmrShares(saved.tmrShares) || defaultTmrShares(),
        fieldUse: { ...(saved.fieldUse || {}) },
        strawFields: { ...(saved.strawFields || {}) },
        grassCuts: parseFloat(saved.grassCuts) > 0 ? parseFloat(saved.grassCuts) : 3,
        chaffYield: parseFloat(saved.chaffYield) > 0 ? parseFloat(saved.chaffYield) : Math.round((cropAgronomy('Maize', 'yield') || 9200) * 4),
        strawYield: parseFloat(saved.strawYield) > 0 ? parseFloat(saved.strawYield) : null,
        mixer: normalizeMixerPlan(saved.mixer)
    };
}

// The game's default TMR shares, limited to the ingredients the map's recipe has.
function defaultTmrShares() {
    const shares = {};
    MIXER_TMR_CATEGORIES.forEach(c => {
        const [min, max] = TMR_LIMITS[c];
        shares[c] = Math.min(max, Math.max(min, TMR_DEFAULT[c] || 0));
    });
    return shares;
}

// Saved TMR shares when every ingredient of the recipe is there, within its
// limits, and they add up to 100 % — else null.
function validTmrShares(shares) {
    if (!shares || typeof shares !== 'object') return null;
    const out = {};
    for (const c of MIXER_TMR_CATEGORIES) {
        const v = parseFloat(shares[c]);
        const [min, max] = TMR_LIMITS[c];
        if (isNaN(v) || v < min - 0.05 || v > max + 0.05) return null;
        out[c] = v;
    }
    const sum = Object.values(out).reduce((s, v) => s + v, 0);
    return Math.abs(sum - 100) <= 0.05 ? out : null;
}

// A ration a mixer wagon can make: the built-in TMR, or an own feed made only
// of the recipe's ingredients within its limits (e.g. TMR without mineral feed).
function rationIsTmr(ration) {
    if (!ration) return false;
    if (ration.tmr) return true;
    if (!ration.custom || !ration.ingredients.length) return false;
    const sum = ration.ingredients.reduce((s, i) => s + (parseFloat(i.pct) || 0), 0) || 100;
    const pct = {};
    ration.ingredients.forEach(i => { pct[i.category] = (pct[i.category] || 0) + (parseFloat(i.pct) || 0) / sum * 100; });
    if (Object.keys(pct).some(c => !TMR_LIMITS[c])) return false;
    return MIXER_TMR_CATEGORIES.every(c => {
        const [min, max] = TMR_LIMITS[c];
        const v = pct[c] || 0;
        return v >= min - 0.05 && v <= max + 0.05;
    });
}

// A ration's shares per TMR ingredient, adding up to 100.
function rationTmrShares(ration) {
    const sum = ration.ingredients.reduce((s, i) => s + (parseFloat(i.pct) || 0), 0) || 100;
    const shares = {};
    MIXER_TMR_CATEGORIES.forEach(c => { shares[c] = 0; });
    ration.ingredients.forEach(i => { if (i.category in shares) shares[i.category] += (parseFloat(i.pct) || 0) / sum * 100; });
    return shares;
}

// Mixer wagon ("paszowóz") settings kept in the feed plan: the chosen wagon,
// wagons and bale types the player added by hand, capacities typed in for
// wagons whose file we couldn't read, and each wagon's own load. The single
// load of older versions belongs to the wagon that was chosen then ('' when
// none was — it moves to the first wagon shown, see mixerLoad).
function normalizeMixerPlan(m) {
    m = (m && typeof m === 'object') ? m : {};
    const loads = {};
    Object.keys(m.loads || {}).forEach(id => { if (Array.isArray(m.loads[id])) loads[id] = m.loads[id]; });
    if (!m.loads && Array.isArray(m.load) && m.load.length) loads[m.selected || ''] = m.load;
    return {
        selected: m.selected || null,
        custom: Array.isArray(m.custom) ? m.custom : [],
        capacity: { ...(m.capacity || {}) },
        customBales: Array.isArray(m.customBales) ? m.customBales : [],
        loads,
        sort: ['name', 'capacity'].includes(m.sort) ? m.sort : 'default'
    };
}

// The chosen wagon's load (created empty on first use).
function mixerLoad(plan) {
    const wagon = selectedMixerWagon(getCurrentFarm(), plan);
    const id = wagon ? wagon.id : '';
    if (!plan.mixer.loads[id] && plan.mixer.loads['']) {
        plan.mixer.loads[id] = plan.mixer.loads[''];
        delete plan.mixer.loads[''];
    }
    return plan.mixer.loads[id] || (plan.mixer.loads[id] = []);
}

function setMixerLoad(plan, list) {
    const wagon = selectedMixerWagon(getCurrentFarm(), plan);
    plan.mixer.loads[wagon ? wagon.id : ''] = list;
}

// Bales go in by the quarter.
function quarterBales(n) {
    return Math.max(0, Math.round((parseFloat(n) || 0) * 4) / 4);
}

function saveFeedPlan(plan) {
    const farm = getCurrentFarm();
    if (!farm) return;
    const { tmr, ...rest } = plan;
    farm.feedPlan = { ...rest, tmrShares: tmr };
    saveFarmData(farm);
}

// The recipe ({ingredients, efficiency}) a species is fed with — in one barn
// when barnId is given (its own choice, else the species' ration). Unknown or
// deleted custom feeds fall back to the species' first built-in ration.
function resolveRation(type, plan, barnId) {
    const groups = ANIMAL_FOOD_GROUPS[type] || {};
    const own = barnId != null && plan.barnRations && plan.barnRations[barnId] ? plan.barnRations[barnId][type] : null;
    let id = own || plan.rations[type] || defaultRationFor(type);
    if (id.startsWith('mixer:')) {
        const mixer = feedMixersFor(getCurrentFarm(), type).find(m => 'mixer:' + m.id === id);
        if (mixer) return mixerRation(mixer, type);
        id = defaultRationFor(type);
    }
    if (id.startsWith('custom:')) {
        const feed = plan.customFeeds.find(f => 'custom:' + f.id === id && f.animalType === type);
        if (feed) return { id, name: feed.name, efficiency: feed.efficiency, ingredients: feed.ingredients, custom: true };
        id = defaultRationFor(type);
    }
    const g = groups[id] || groups[defaultRationFor(type)];
    if (!g) return null;
    const ingredients = g.tmr
        ? Object.keys(plan.tmr).map(category => ({ category, pct: parseFloat(plan.tmr[category]) || 0 }))
        : g.ingredients;
    return { id, name: t('feedRation_' + id), efficiency: g.efficiency, ingredients, tmr: !!g.tmr };
}

// <option>s for a species' ration picker: built-in rations, feed mixers that
// make this species' feed, then its custom feeds in their own group. Shared by
// the feed planner and the Animals panel so both always offer (and save) the
// same choice.
function feedRationOptionsHtml(type, plan, selectedId) {
    const builtIn = Object.keys(ANIMAL_FOOD_GROUPS[type] || {}).map(id =>
        `<option value="${id}" ${selectedId === id ? 'selected' : ''}>${t('feedRation_' + id)} (${ANIMAL_FOOD_GROUPS[type][id].efficiency}%)</option>`).join('');
    const mixers = feedMixersFor(getCurrentFarm(), type).map(m =>
        `<option value="mixer:${escapeHtml(m.id)}" ${selectedId === 'mixer:' + m.id ? 'selected' : ''}>${escapeHtml(t('feedRationMixer'))} · ${escapeHtml(mixerDisplayName(getCurrentFarm(), m))} (100%)</option>`).join('');
    const custom = plan.customFeeds.filter(f => f.animalType === type).map(f =>
        `<option value="custom:${f.id}" ${selectedId === 'custom:' + f.id ? 'selected' : ''}>${escapeHtml(f.name)} (${f.efficiency}%)</option>`).join('');
    return builtIn + mixers + (custom ? `<optgroup label="${t('feedCustomGroup')}">${custom}</optgroup>` : '')
        + `<option value="__new">+ ${escapeHtml(t('feedCustomNew'))}…</option>`;
}

// "+ New feed…" in a ration picker outside the feed planner: open the planner
// on that barn with the new-feed editor for the species.
function startNewCustomFeed(type, barnId) {
    showPlannerView('feedplan');   // a fresh open resets the planner's state…
    if (barnId != null) feedSelectedBuilding = barnId;   // …so set it afterwards
    feedEditorDraft = { id: null, animalType: type || 'COW', name: '', efficiency: 100, ingredients: [{ category: 'HAY', pct: 100 }] };
    rerenderFeedPlan();
    const editor = document.querySelector('#hub-view .feed-editor');
    if (editor) editor.scrollIntoView({ block: 'center' });
}

// Name the player gave a feed mixer (per farm), else the one from its mod.
function mixerDisplayName(farm, mixer) {
    const custom = farm && farm.feedMixerNames && farm.feedMixerNames[mixer.id];
    if (custom) return custom;
    const titles = mixer.nameTitles;
    return (titles && titles[currentLang]) || mixer.name;
}

// Feed mixers whose product is the complete feed of this species (pig food
// for pigs) — they can be picked as that species' ration.
const FEED_MIXER_RATION_PRODUCT = { PIG: 'PIGFOOD' };
function feedMixersFor(farm, type) {
    const product = FEED_MIXER_RATION_PRODUCT[type];
    if (!product) return [];
    return ((farm && farm.feedMixers) || []).filter(m => m.products.includes(product));
}

// The recipe a mixer ration follows: the first switched-on recipe making the
// product, else the mixer's first one for it.
function mixerRecipeFor(mixer, product) {
    const makes = mixer.recipes.filter(r => r.outputs.some(o => o.fillType === product));
    return makes.find(r => r.enabled) || makes[0] || null;
}

// A mixer as a ration: the animals eat its product, so their need turns into
// the recipe's crops — litres of each ingredient per litre of product (e.g.
// maize + barley + soy 1:1:1 -> 3 l make 3 l, a third each; 2+2+2 -> 4 l
// needs 1.5 l of crops per litre). `absolute` = pct already per 100 l of feed.
function mixerRation(mixer, type) {
    const product = FEED_MIXER_RATION_PRODUCT[type];
    const recipe = mixerRecipeFor(mixer, product);
    const out = recipe ? recipe.outputs.filter(o => o.fillType === product).reduce((s, o) => s + o.amount, 0) : 0;
    const byCat = {};
    if (recipe && out > 0) {
        // Only ingredients that are a feed category count — water, oils and a
        // map's intermediate products (crushed cereal…) aren't grown on fields.
        recipe.inputs.forEach(i => {
            const c = FEED_FILLTYPE_CATEGORY[i.fillType];
            if (!c) return;
            byCat[c] = (byCat[c] || 0) + i.amount / out * 100;
        });
    }
    const ingredients = Object.keys(byCat).length
        ? Object.entries(byCat).map(([category, pct]) => ({ category, pct }))
        : ((ANIMAL_FOOD_GROUPS[type] || {}).mix || { ingredients: [] }).ingredients;
    return {
        id: 'mixer:' + mixer.id, name: t('feedRationMixer') + ' · ' + mixerDisplayName(getCurrentFarm(), mixer), efficiency: 100,
        ingredients, absolute: !!Object.keys(byCat).length,
        mixer: { id: mixer.id, name: mixerDisplayName(getCurrentFarm(), mixer), product, recipeEnabled: !!(recipe && recipe.enabled), recipe }
    };
}

// Stock litres per category with ready-mixed pig food split the way the
// pigs' chosen mixer recipe uses it (else the game's pig mixture).
// Feed already in the barns' troughs counts as stock too (source "barn").
function feedStockCategoriesFor(farm, plan) {
    const stock = {};
    Object.entries((farm && farm.feedStock) || {}).forEach(([ft, sources]) => { stock[ft] = { ...sources }; });
    Object.entries(feedBarnStock(farm)).forEach(([ft, litres]) => {
        stock[ft] = { ...(stock[ft] || {}), barn: litres };
    });
    return feedStockByCategory(stock, feedStockSplitOverride(plan));
}

// Litres per feed category lying in the barns' troughs (part of the stock above).
function feedBarnStockCategoriesFor(farm, plan) {
    const stock = {};
    Object.entries(feedBarnStock(farm)).forEach(([ft, litres]) => { stock[ft] = { barn: litres }; });
    return feedStockByCategory(stock, feedStockSplitOverride(plan));
}

function feedStockSplitOverride(plan) {
    const ration = resolveRation('PIG', plan);
    const override = {};
    if (ration && ration.mixer && ration.absolute) {
        override.PIGFOOD = Object.fromEntries(ration.ingredients.map(i => [i.category, i.pct / 100]));
    }
    return override;
}

// fillType -> litres in every barn's trough (<husbandryFood> in the save).
function feedBarnStock(farm) {
    const out = {};
    ((farm && farm.animalBuildings) || []).forEach(b => (b.food || []).forEach(f => {
        if (!isFeedFillType(f.fillType) || !(f.level > 0)) return;
        out[f.fillType] = (out[f.fillType] || 0) + f.level;
    }));
    return out;
}

// Picks a barn's ration for one species (the other barns keep theirs).
function setBarnRation(plan, barnId, type, rationId) {
    if (!plan.barnRations) plan.barnRations = {};
    plan.barnRations[barnId] = { ...(plan.barnRations[barnId] || {}), [type]: rationId };
}

// Drops a ration id everywhere it's chosen (a deleted custom feed). type:
// only for that species.
function forgetRation(plan, rationId, type) {
    Object.keys(plan.rations).forEach(tp => { if ((!type || tp === type) && plan.rations[tp] === rationId) delete plan.rations[tp]; });
    Object.values(plan.barnRations || {}).forEach(byType => Object.keys(byType).forEach(tp => {
        if ((!type || tp === type) && byType[tp] === rationId) delete byType[tp];
    }));
}

// A cluster's daily food in litres — the one formula behind the Animals view
// and the feed planner (EAS lactation factor included).
function clusterDailyFood(farm, type, c) {
    return clusterDailyNeed(c, 'food') * clusterFoodFactor(farm, type, c);
}

// A cluster's daily water / straw (or base food) in litres: per head × heads.
function clusterDailyNeed(c, needType) {
    return getDailyAnimalNeed(c.subType, c.age, needType) * c.numAnimals;
}

// The cluster month by month over the coming in-game year (m = 0 is today),
// the way AnimalFoodCalculator projects it (afcGetProjectedClusterState):
// one month older each month; an inseminated animal old enough to breed
// gains 100 / durationMonth and calves at 100 % (months since birth back to
// 0), otherwise months since birth + 1. Deaths, sales and the calves
// themselves aren't projected.
function projectedClusterMonths(c) {
    const def = getReproductionDef(c.subType);
    const minAge = def && def.supported !== false ? (parseFloat(def.minAgeMonth) || 0) : null;
    const delta = def && parseFloat(def.durationMonth) > 0 ? 100 / parseFloat(def.durationMonth) : 0;
    const canBreed = age => minAge !== null && age >= minAge;
    const s = {
        age: parseFloat(c.age) || 0,
        monthsSinceLastBirth: parseInt(c.monthsSinceLastBirth, 10) || 0,
        reproduction: parseFloat(c.reproduction) || 0,
        hadABirth: !!c.hadABirth,
        isInseminated: !!c.isInseminated
    };
    const months = [];
    for (let m = 0; m < FEED_PERIODS_PER_YEAR; m++) {
        if (m > 0) {
            s.age++;
            let calved = false;
            if (canBreed(s.age) && s.isInseminated && delta > 0) {
                s.reproduction += delta;
                if (s.reproduction >= 100) {
                    s.reproduction = 0;
                    s.monthsSinceLastBirth = 0;
                    s.hadABirth = true;
                    s.isInseminated = false;
                    calved = true;
                }
            }
            if (!calved) s.monthsSinceLastBirth++;
        }
        // EAS's food factor only counts once the animal may breed (AFC: canReproduce).
        months.push({ ...s, hadABirth: s.hadABirth && (minAge === null || canBreed(s.age)) });
    }
    return months;
}

// A cluster's litres over the coming in-game year (before AFC's scale),
// summed over its projected months — so calves growing up and cows calving
// count, as in AnimalFoodCalculator's yearly figure. Food includes the EAS
// lactation factor of each month.
function clusterYearNeed(farm, type, c, needType) {
    return projectedClusterMonths(c).reduce((sum, s) => {
        const perHead = getDailyAnimalNeed(c.subType, s.age, needType);
        return sum + perHead * (needType === 'food' ? clusterFoodFactor(farm, type, s) : 1);
    }, 0) * c.numAnimals;
}

// Output fillTypes that don't depend on how well the animals are fed.
const FEED_UNSCALED_OUTPUT = ['MANURE', 'LIQUIDMANURE'];

function splitByRecipe(litres, recipe, into) {
    const total = recipe.absolute ? 100 : (recipe.ingredients.reduce((s, i) => s + (parseFloat(i.pct) || 0), 0) || 100);
    recipe.ingredients.forEach(i => {
        into[i.category] = (into[i.category] || 0) + litres * (parseFloat(i.pct) || 0) / total;
    });
}

// Yearly litres per feed category + per species (head count, food, straw).
function buildFeedDemand(farm, plan) {
    const byCategory = {};
    const bySpecies = {};
    let unknownSubTypes = 0;
    const scale = feedConsumptionScale(farm);
    ((farm && farm.animalBuildings) || []).forEach(b => (b.clusters || []).forEach(c => {
        const type = animalTypeOf(c.subType);
        if (!type || !ANIMAL_NEEDS_DATA[c.subType]) { unknownSubTypes++; return; }
        const s = bySpecies[type] || (bySpecies[type] = { head: 0, food: 0, straw: 0 });
        const food = clusterYearNeed(farm, type, c, 'food') * scale;
        s.head += c.numAnimals;
        s.food += food;
        s.straw += clusterYearNeed(farm, type, c, 'straw') * scale;
        // Each barn's own ration splits its food into ingredients.
        const ration = resolveRation(type, plan, b.id);
        if (ration) splitByRecipe(food, ration, byCategory);
    }));
    Object.keys(bySpecies).forEach(type => {
        const s = bySpecies[type];
        s.ration = resolveRation(type, plan);
        byCategory.STRAW = (byCategory.STRAW || 0) + s.straw;   // bedding, whatever the ration
    });
    return { byCategory, bySpecies, unknownSubTypes };
}

function catchTag(row) {
    return row && row.isCatch ? ` <span class="supply-sub">${t('catchCropShort')}</span>` : '';
}

function defaultFieldUse(crop) {
    return FEED_GRASSLAND_CROPS.includes(crop) ? 'feed' : 'sale';
}

// One row per field whose crop can feed animals, with its chosen use and the
// litres it adds to each category.
function buildFeedSupply(farm, plan, rates) {
    const rows = [];
    const byCategory = {};
    // A catch crop (green rye for silage…) is its own row with its own use.
    const entries = [];
    ((farm && farm.fields) || []).forEach((f, i) => {
        entries.push({ f, i, crop: f.crop || '', isCatch: false });
        if (f.catchCrop) entries.push({ f, i, crop: f.catchCrop, isCatch: true });
    });
    entries.forEach(({ f, i, crop, isCatch }) => {
        const area = parseFloat(f.area) || 0;
        const uses = FEED_CROP_USES[crop];
        if (!uses || area <= 0) return;

        const key = fertPlanKey(f, i) + (isCatch ? ':catch' : '');

        // Grassland with its cuts planned (Pokosy): each cut goes to its own
        // use — fresh grass, hay or silage — instead of the global cuts/year.
        const cuts = !isCatch && Array.isArray(f.cuts) ? f.cuts : [];
        if (cuts.length && uses.feed === 'ROUGHAGE') {
            const perCut = fieldExpectedYield(f, i, crop, rates, farm).litres;
            let litres = 0;
            cuts.forEach(c => {
                const cat = CUT_USE_CATEGORY[c.use];
                if (!cat) return;
                byCategory[cat] = (byCategory[cat] || 0) + perCut;
                litres += perCut;
            });
            rows.push({ key, number: (f.number || '').toString().trim() || ('#' + (i + 1)), crop, isCatch, area, use: 'cuts', uses: [], cuts: cuts.length, litres, strawPossible: false, straw: 0 });
            return;
        }

        // A catch crop grown for forage (green rye) defaults to silage.
        let use = plan.fieldUse[key] || (isCatch && uses.silage ? 'silage' : defaultFieldUse(crop));
        if (use !== 'sale' && !uses[use]) use = Object.keys(uses)[0];
        const factor = fieldExpectedYield(f, i, crop, rates, farm, 0).factor;

        let litres = 0;
        const category = use === 'sale' ? null : uses[use];
        if (category) {
            let rate;
            if (category === 'ROUGHAGE') rate = (getCropYieldRate(crop) || 0) * plan.grassCuts;
            else if (use === 'silage') rate = FEED_SILAGE_OWN_YIELD.includes(crop) ? (getCropYieldRate(crop) || 0) : plan.chaffYield;
            else rate = getCropYieldRate(crop) || 0;
            litres = area * rate * factor;
            byCategory[category] = (byCategory[category] || 0) + litres;
        }

        const strawRate = plan.strawYield || cropStrawRate(crop);
        const strawPossible = cropStrawRate(crop) !== null;
        const straw = strawPossible && plan.strawFields[key] ? area * strawRate * factor : 0;
        if (straw > 0) byCategory.STRAW = (byCategory.STRAW || 0) + straw;

        rows.push({ key, number: (f.number || '').toString().trim() || ('#' + (i + 1)), crop, isCatch, area, use, uses: Object.keys(uses), litres, strawPossible, straw });
    });
    return { rows, byCategory };
}

// Area-weighted soil yield factor across the farm, for the "≈ X ha" hint.
function farmAverageYieldFactor(farm, rates) {
    let area = 0, weighted = 0;
    ((farm && farm.fields) || []).forEach((f, i) => {
        const a = parseFloat(f.area) || 0;
        if (a <= 0) return;
        area += a;
        weighted += a * fieldYieldFactor(getFieldSoilMix(fertPlanSoilKey(f, i), rates));
    });
    return area > 0 ? weighted / area : fieldYieldFactor({});
}

// Savegame fillType -> feed category, for what's already in storage. Fresh
// windrow (grass/alfalfa/clover) counts as GRASS unless it sits in a wrapped
// bale, where it ferments into silage (see readFeedStockFromSave).
const FEED_FILLTYPE_CATEGORY = {
    GRASS_WINDROW: 'GRASS', ALFALFA_WINDROW: 'GRASS', CLOVER_WINDROW: 'GRASS',
    DRYGRASS_WINDROW: 'HAY', DRYALFALFA_WINDROW: 'HAY', DRYCLOVER_WINDROW: 'HAY',
    SILAGE: 'SILAGE', CHAFF: 'SILAGE', STRAW: 'STRAW', MINERAL_FEED: 'MINERAL',
    MAIZE: 'PIG_BASE', SORGHUM: 'PIG_BASE', WHEAT: 'GRAIN', BARLEY: 'GRAIN',
    SOYBEAN: 'PROTEIN', CANOLA: 'PROTEIN', SUNFLOWER: 'PROTEIN',
    POTATO: 'EARTH', SUGARBEET: 'EARTH', CARROT: 'EARTH', PARSNIP: 'EARTH', BEETROOT: 'EARTH',
    OAT: 'OAT',
    // Mod-map crops, grouped as the maps' animalFood.xml does (e.g. Solek).
    RYE: 'GRAIN', TRITICALE: 'GRAIN', MILLET: 'PIG_BASE', BUCKWHEAT: 'PROTEIN'
};
const FEED_STOCK_SOURCES = ['silo', 'bunker', 'bale', 'pallet', 'mixer', 'barn'];

// Ready-mixed feeds count toward the categories they're made of — pig food is
// the game's PIGFOOD mixture (animalFood.xml <mixture animalType="PIG">: base
// 50 / grain 25 / protein 20 / earth 5), FORAGE is a finished TMR (default
// recipe). Shares are fractions of the litres.
const FEED_MIXTURE_SPLIT = {
    PIGFOOD: { PIG_BASE: 0.5, GRAIN: 0.25, PROTEIN: 0.2, EARTH: 0.05 },
    FORAGE: Object.fromEntries(Object.entries(TMR_DEFAULT).map(([c, pct]) => [c, pct / 100]))
};
// A production whose recipes make any of these is a feed mixer.
const FEED_PRODUCT_FILLTYPES = ['PIGFOOD', 'FORAGE', 'MINERAL_FEED'];
// Which animals a mixer product is for (to flag the mixers a barn can use).
const FEED_PRODUCT_ANIMALS = { PIGFOOD: ['PIG'], FORAGE: ['COW', 'SHEEP'], MINERAL_FEED: ['COW', 'SHEEP'] };

function isFeedFillType(fillType) {
    return !!(FEED_FILLTYPE_CATEGORY[fillType] || FEED_MIXTURE_SPLIT[fillType]);
}

// Productions the player owns: placeables (farmId 1) with a productionPoint —
// mills, bakeries, biogas plants, feed mixers (FoodMixerSilo, SmallFoodMixer,
// Lizard Mixed Food…). Recipes, throughput and capacity come from the
// placeable's own XML in its mod; which recipes are switched on and what's in
// storage from placeables.xml. Base-game placeables live in the game's
// archives and can't be read, so only mod and map productions are found.
// kind: 'mixer' (makes a feed, FEED_PRODUCT_FILLTYPES), 'biogas' or 'production'.
// Production rates: cyclesPerMonth, or legacy cyclesPerHour x 24 (the game
// converts it the same way), so output per in-game month.
// Text read from a mod's XML (shop names) goes into the UI's HTML — drop
// markup characters so a mod can't inject HTML (the renderer has Node access).
function plainModText(s) {
    return String(s || '').replace(/[<>"'`]/g, '');
}

function readProductionsFromSave(saveFolder, modsDirs) {
    const p = path.join(saveFolder, 'placeables.xml');
    if (!fs.existsSync(p)) return [];
    const doc = new DOMParser().parseFromString(fs.readFileSync(p, 'utf-8'), 'text/xml');
    if (doc.querySelector('parsererror')) return [];
    const up = s => String(s || '').toUpperCase();
    const defCache = {};
    const l10nCache = {};
    const productions = [];
    doc.querySelectorAll(`placeable[farmId="${SAVE_FARM_ID}"]`).forEach(pl => {
        const saved = pl.querySelector(':scope > productionPoint');
        if (!saved) return;
        const filename = pl.getAttribute('filename') || '';
        if (!(filename in defCache)) {
            const bytes = modFiles.readModFile(modsDirs, filename);
            const x = bytes ? new DOMParser().parseFromString(bytes.toString('utf8'), 'text/xml') : null;
            defCache[filename] = x && !x.querySelector('parsererror') ? x : null;
        }
        const def = defCache[filename];
        // Base game productions live in the game's packed data; the link mod
        // reports their recipes (SAVE_RECIPE_BOOK, live-link.js).
        const known = SAVE_RECIPE_BOOK[filename] || null;
        if (!def && !known) return;
        const recipes = def ? [...def.querySelectorAll('productionPoint productions > production')].map(pr => {
            const perMonth = parseFloat(pr.getAttribute('cyclesPerMonth')) || (parseFloat(pr.getAttribute('cyclesPerHour')) || 0) * 24;
            const items = sel => [...pr.querySelectorAll(sel)].map(i => ({ fillType: up(i.getAttribute('fillType')), amount: parseFloat(i.getAttribute('amount')) || 0 }));
            return { id: pr.getAttribute('id') || '', inputs: items('inputs > input'), outputs: items('outputs > output'), cyclesPerMonth: perMonth };
        }) : known.recipes.map(r => Object.assign({}, r, { inputs: r.inputs.slice(), outputs: r.outputs.slice() }));
        if (!recipes.length) return;

        const enabled = {};
        saved.querySelectorAll(':scope > production').forEach(pr => { enabled[pr.getAttribute('id')] = pr.getAttribute('isEnabled') === 'true'; });
        recipes.forEach(r => { r.enabled = enabled[r.id] !== undefined ? enabled[r.id] : false; });

        const stock = {};
        saved.querySelectorAll(':scope > storage > node[fillType]').forEach(n => {
            const lvl = parseFloat(n.getAttribute('fillLevel'));
            if (lvl > 0) stock[up(n.getAttribute('fillType'))] = (stock[up(n.getAttribute('fillType'))] || 0) + lvl;
        });
        const capacity = {};
        const storageDef = def ? def.querySelector('productionPoint > storage') : null;
        if (storageDef) {
            const all = parseFloat(storageDef.getAttribute('capacity')) || null;
            storageDef.querySelectorAll(':scope > capacity[fillType]').forEach(c => { capacity[up(c.getAttribute('fillType'))] = parseFloat(c.getAttribute('capacity')) || all; });
            capacity._default = all;
        }

        const nameEl = def ? def.querySelector('storeData > name') : null;
        const rawName = plainModText(nameEl ? (nameEl.querySelector('en') || nameEl).textContent.trim() : (known && known.name) || '');
        const products = [...new Set(recipes.flatMap(r => r.outputs.map(o => o.fillType)))];

        // The mod's own translations: its name ("$l10n_shopItem_…") and its
        // fill types ("HARINAPIENSOS" -> "Feed Flour").
        const modName = pl.getAttribute('modName') || '';
        if (modName && !(modName in l10nCache)) l10nCache[modName] = readMixerModL10n(modsDirs, modName);
        const l10n = l10nCache[modName] || {};
        // Keys compared without underscores ("CEREAL_TRITURADO" ~ fillType_cerealTriturado).
        const norm = k => String(k).toLowerCase().replace(/_/g, '');
        const index = {};
        Object.entries(l10n).forEach(([k, v]) => { index[norm(k)] = v; });
        const titleOf = key => index[norm(key)] || null;
        const fillTypeTitles = {};
        recipes.forEach(r => [...r.inputs, ...r.outputs].forEach(({ fillType }) => {
            // Else drop trailing "_PART"s: DRYTEFFGRASS_WINDROW -> dryTeffGrass,
            // CEREALPROTEICO_TRITURADO -> cerealProteico.
            let name = fillType, t2 = null;
            while (!(t2 = titleOf('fillType_' + name)) && name.includes('_')) name = name.replace(/_[^_]*$/, '');
            if (t2) fillTypeTitles[fillType] = t2;
        }));
        const l10nName = rawName.startsWith('$l10n_') ? titleOf(rawName.slice(6)) : null;
        productions.push({
            id: pl.getAttribute('uniqueId') || filename,
            kind: productionKind(products),
            name: rawName && !rawName.startsWith('$') ? rawName
                : (l10nName && (l10nName.en || Object.values(l10nName)[0])) || filename.replace(/\\/g, '/').split('/').pop().replace(/\.xml$/i, ''),
            nameTitles: l10nName || null,
            fillTypeTitles,
            mod: pl.getAttribute('modName') || '',
            products,
            recipes,
            stock,
            capacity
        });
    });
    return productions;
}

// Biogas plants turn silage and manure into methane / digestate.
const PRODUCTION_BIOGAS_OUTPUTS = ['METHANE', 'DIGESTATE', 'ELECTRICCHARGE'];
function productionKind(products) {
    if (products.some(ft => FEED_PRODUCT_FILLTYPES.includes(ft))) return 'mixer';
    if (products.some(ft => PRODUCTION_BIOGAS_OUTPUTS.includes(ft))) return 'biogas';
    return 'production';
}

// The feed mixers among the productions, with only their feed recipes.
function feedMixersFromProductions(productions) {
    return (productions || []).map(p => {
        const recipes = p.recipes.filter(r => r.outputs.some(o => FEED_PRODUCT_FILLTYPES.includes(o.fillType)));
        if (!recipes.length) return null;
        const { kind, ...mixer } = p;
        return { ...mixer, recipes, products: p.products.filter(ft => FEED_PRODUCT_FILLTYPES.includes(ft)) };
    }).filter(Boolean);
}

// Translations of the mod a mixer comes from (see map-crops.js readModL10n).
function readMixerModL10n(modsDirs, modName) {
    try {
        const read = rel => { const b = modFiles.readModFile(modsDirs, `$moddir$${modName}/${rel}`); return b ? b.toString('utf-8') : null; };
        const modDesc = read('modDesc.xml');
        return modDesc ? readModL10n(read, modDesc, ['en', 'pl', 'de']) : {};
    } catch (e) {
        console.warn('Could not read translations of', modName, e);
        return {};
    }
}

// Most a mixer can make of `product` per in-game month with its switched-on
// recipes (all recipes when none is on — the game then produces nothing, but
// it's the mixer's potential).
function feedMixerMonthlyOutput(mixer, product) {
    const on = mixer.recipes.filter(r => r.enabled);
    const use = on.length ? on : mixer.recipes;
    return use.reduce((s, r) => s + r.outputs.filter(o => o.fillType === product).reduce((a, o) => a + o.amount * r.cyclesPerMonth, 0), 0);
}

// Feed already on the farm (farmId 1) at the last save, in litres per
// fillType and source:
//   silo   - placeables.xml <node fillType fillLevel> inside a silo, silo
//            extension or an animal building's own storage (e.g. barn straw)
//   bunker - placeables.xml <bunkerSilo fillLevel> (chaff/grass -> silage)
//   bale   - items.xml loose bales + placeables.xml <objectStorage> bales
//   pallet - vehicles.xml pallets / big bags (<pallet> + <fillUnit><unit>)
// Only fillTypes an animal can eat are kept.
function readFeedStockFromSave(saveFolder) {
    const stock = {};
    const add = (fillType, source, litres) => {
        if (!isFeedFillType(fillType) || !(litres > 0)) return;
        const e = stock[fillType] || (stock[fillType] = {});
        e[source] = (e[source] || 0) + litres;
    };
    const parse = (name) => {
        const p = path.join(saveFolder, name);
        if (!fs.existsSync(p)) return null;
        const doc = new DOMParser().parseFromString(fs.readFileSync(p, 'utf-8'), 'text/xml');
        return doc.querySelector('parsererror') ? null : doc;
    };
    const baleFillType = (el) => {
        const ft = el.getAttribute('fillType');
        const wrapped = (parseFloat(el.getAttribute('wrappingState')) || 0) >= 1;
        return wrapped && FEED_FILLTYPE_CATEGORY[ft] === 'GRASS' ? 'SILAGE' : ft;
    };

    const placeables = parse('placeables.xml');
    if (placeables) {
        placeables.querySelectorAll(`placeable[farmId="${SAVE_FARM_ID}"]`).forEach(pl => {
            pl.querySelectorAll('node[fillType]').forEach(node => {
                if (!node.closest('silo, siloExtension, husbandry')) return;
                add(node.getAttribute('fillType'), 'silo', parseFloat(node.getAttribute('fillLevel')));
            });
            pl.querySelectorAll('bunkerSilo').forEach(b => add('SILAGE', 'bunker', parseFloat(b.getAttribute('fillLevel'))));
            pl.querySelectorAll('objectStorage > object[className="Bale"]').forEach(b =>
                add(baleFillType(b), 'bale', parseFloat(b.getAttribute('fillLevel'))));
        });
    }
    const items = parse('items.xml');
    if (items) {
        items.querySelectorAll(`item[className="Bale"][farmId="${SAVE_FARM_ID}"]`).forEach(b =>
            add(baleFillType(b), 'bale', parseFloat(b.getAttribute('fillLevel'))));
    }
    const vehicles = parse('vehicles.xml');
    if (vehicles) {
        vehicles.querySelectorAll(`vehicle[farmId="${SAVE_FARM_ID}"]`).forEach(v => {
            if (!v.querySelector(':scope > pallet')) return;
            v.querySelectorAll(':scope > fillUnit > unit[fillType]').forEach(u =>
                add(u.getAttribute('fillType'), 'pallet', parseFloat(u.getAttribute('fillLevel'))));
        });
    }
    return stock;
}

// Bales on the farm, grouped into "types" (size + fillType + litres) with a
// count — the building blocks for loading the mixer wagon. Wrapped grass
// counts as silage, same as in the stock above.
function readFeedBalesFromSave(saveFolder) {
    const groups = {};
    const add = (el) => {
        const raw = el.getAttribute('fillType');
        const wrapped = (parseFloat(el.getAttribute('wrappingState')) || 0) >= 1;
        const fillType = wrapped && FEED_FILLTYPE_CATEGORY[raw] === 'GRASS' ? 'SILAGE' : raw;
        const litres = Math.round(parseFloat(el.getAttribute('fillLevel')) || 0);
        if (!FEED_FILLTYPE_CATEGORY[fillType] || litres <= 0) return;
        const file = (el.getAttribute('filename') || '').replace(/\\/g, '/').split('/').pop().replace(/\.xml$/i, '');
        const m = file.match(/(round|square)bale(\d+)/i);
        const size = m ? `${m[1].toLowerCase()}${m[2]}` : (file || 'bale');
        const key = `${size}|${fillType}|${litres}`;
        const g = groups[key] || (groups[key] = { key, size, fillType, litres, count: 0 });
        g.count++;
    };
    const parse = (name) => {
        const p = path.join(saveFolder, name);
        if (!fs.existsSync(p)) return null;
        const doc = new DOMParser().parseFromString(fs.readFileSync(p, 'utf-8'), 'text/xml');
        return doc.querySelector('parsererror') ? null : doc;
    };
    const items = parse('items.xml');
    if (items) items.querySelectorAll(`item[className="Bale"][farmId="${SAVE_FARM_ID}"]`).forEach(add);
    const placeables = parse('placeables.xml');
    if (placeables) {
        placeables.querySelectorAll(`placeable[farmId="${SAVE_FARM_ID}"] objectStorage > object[className="Bale"]`).forEach(add);
    }
    return Object.values(groups).sort((a, b) => b.count - a.count);
}

// Mixer wagons the player owns (vehicles.xml entries with a <mixerWagon>),
// with name and capacity looked up in the vehicle's own XML when it comes
// from a mod. Base-game wagons live in the game's archives, so their
// capacity stays unknown until the player types it in.
function readMixerWagonsFromSave(saveFolder, modsDirs) {
    const p = path.join(saveFolder, 'vehicles.xml');
    if (!fs.existsSync(p)) return [];
    const doc = new DOMParser().parseFromString(fs.readFileSync(p, 'utf-8'), 'text/xml');
    if (doc.querySelector('parsererror')) return [];
    const wagons = [];
    doc.querySelectorAll(`vehicle[farmId="${SAVE_FARM_ID}"]`).forEach(v => {
        if (!v.querySelector(':scope > mixerWagon')) return;
        const filename = v.getAttribute('filename') || '';
        const wagon = {
            id: 'save:' + (v.getAttribute('uniqueId') || filename),
            name: filename.replace(/\\/g, '/').split('/').pop().replace(/\.xml$/i, ''),
            capacity: null,
            source: 'save'
        };
        const bytes = modFiles.readModFile(modsDirs, filename);
        if (bytes) {
            const vx = new DOMParser().parseFromString(bytes.toString('utf8'), 'text/xml');
            if (!vx.querySelector('parsererror')) {
                const name = vx.querySelector('storeData > name');
                const nameText = plainModText(name ? name.textContent.trim() : '');
                if (nameText && !nameText.startsWith('$')) wagon.name = nameText;
                const mw = vx.querySelector('mixerWagon');
                const idx = Math.max(1, parseInt(mw && mw.getAttribute('fillUnitIndex')) || 1);
                // Capacity can depend on the bought configuration (e.g. 12 000 vs 14 000 l).
                const configs = vx.querySelectorAll('fillUnitConfigurations > fillUnitConfiguration');
                const cfgEl = v.querySelector(':scope > configuration[name="fillUnit"]');
                const cfgIdx = Math.max(1, parseInt(cfgEl && cfgEl.getAttribute('id')) || 1);
                const scope = configs.length ? (configs[cfgIdx - 1] || configs[0]) : vx;
                const unit = scope.querySelectorAll('fillUnits > fillUnit')[idx - 1];
                const cap = unit ? parseFloat(unit.getAttribute('capacity')) : NaN;
                if (cap > 0) wagon.capacity = cap;
            }
        }
        wagons.push(wagon);
    });
    return wagons;
}

// Stock litres per feed category (sum over every source).
function feedStockByCategory(stock, splitOverride = {}) {
    const byCategory = {};
    Object.entries(stock || {}).forEach(([ft, sources]) => {
        const litres = Object.values(sources).reduce((a, v) => a + v, 0);
        const split = splitOverride[ft] || FEED_MIXTURE_SPLIT[ft] || (FEED_FILLTYPE_CATEGORY[ft] ? { [FEED_FILLTYPE_CATEGORY[ft]]: 1 } : null);
        if (!split) return;
        Object.entries(split).forEach(([c, share]) => { byCategory[c] = (byCategory[c] || 0) + litres * share; });
    });
    return byCategory;
}

// One row per feed category: yearly need vs stock + planned harvest.
// Grass, hay and silage each keep their own need and stock; the grassland
// harvest (s.ROUGHAGE) can become any of the three, so it's handed out to
// cover their shortfalls first and any surplus split by need. Maize chaff
// (s.SILAGE) only ever counts as silage.
function buildFeedBalance(demand, supply, plan, avgFactor, stockByCategory = {}, barnByCategory = {}) {
    const d = demand.byCategory, s = supply.byCategory, st = stockByCategory;
    const barn = c => barnByCategory[c] || 0;
    const rows = [];
    const grassPerHa = (getCropYieldRate('Grass') || 0) * plan.grassCuts * avgFactor;
    // s.GRASS / s.HAY / s.SILAGE = harvest already assigned to that category
    // (maize chaff, grass cuts planned per field); s.ROUGHAGE is handed out below.
    const direct = c => s[c] || 0;
    const own = c => (st[c] || 0) + direct(c);
    const deficit = {};
    FEED_ROUGHAGE.forEach(c => { deficit[c] = Math.max(0, (d[c] || 0) - own(c)); });
    const totalDeficit = FEED_ROUGHAGE.reduce((sum, c) => sum + deficit[c], 0);
    const totalNeed = FEED_ROUGHAGE.reduce((sum, c) => sum + (d[c] || 0), 0);
    const pool = s.ROUGHAGE || 0;
    const covered = Math.min(pool, totalDeficit);
    const surplus = pool - covered;
    FEED_ROUGHAGE.forEach(c => {
        let meadow = totalDeficit > 0 ? covered * deficit[c] / totalDeficit : 0;
        meadow += totalNeed > 0 ? surplus * (d[c] || 0) / totalNeed : (c === 'HAY' ? surplus : 0);
        const need = d[c] || 0, stock = st[c] || 0;
        const have = meadow + direct(c);
        if (need <= 0 && have <= 0 && stock <= 0) return;
        rows.push({ id: c, need, have, stock, barn: barn(c), perHa: grassPerHa });
    });
    FEED_CATEGORIES.filter(c => !FEED_ROUGHAGE.includes(c)).forEach(c => {
        const need = d[c] || 0, have = s[c] || 0, stock = st[c] || 0;
        if (need <= 0 && have <= 0 && stock <= 0) return;
        const ref = FEED_REFERENCE_CROP[c];
        const perHa = c === 'STRAW'
            ? (plan.strawYield || cropStrawRate('Wheat') || 0) * avgFactor
            : (ref ? (getCropYieldRate(ref) || 0) * avgFactor : 0);
        rows.push({ id: c, need, have, stock, barn: barn(c), perHa, buyOnly: c === 'MINERAL' });
    });
    return rows;
}

// --- Panel ---------------------------------------------------------------
// Draft of the custom-feed editor while it's open (null = closed). Kept outside
// the render so typing doesn't re-render (and lose focus); only add/remove
// ingredient and save/cancel re-render.
let feedEditorDraft = null;

let feedPlanRerendering = false;

function rerenderFeedPlan() {
    const modalEl = hubView;
    const scroll = modalEl ? modalEl.scrollTop : 0;
    feedPlanRerendering = true;
    openHubPanel('feedplan');
    feedPlanRerendering = false;
    if (modalEl) modalEl.scrollTop = scroll;
}

function feedCategoryLabel(c) { return t('feedCat_' + c); }

const FEED_CATEGORY_ICONS = {
    GRASS: 'fa-seedling', HAY: 'fa-wheat-awn', SILAGE: 'fa-warehouse', STRAW: 'fa-wheat-awn',
    MINERAL: 'fa-cubes', PIG_BASE: 'fa-wheat-awn', GRAIN: 'fa-wheat-awn', PROTEIN: 'fa-seedling',
    EARTH: 'fa-carrot', OAT: 'fa-wheat-awn'
};
const FEED_ANIMAL_ICONS = { COW: 'fa-cow', PIG: 'fa-piggy-bank', SHEEP: 'fa-paw', HORSE: 'fa-horse', CHICKEN: 'fa-egg' };

// Selected barn (building id) and whether "Settings" is expanded — kept
// across re-renders, reset when the panel is opened fresh from the hub menu.
let feedSelectedBuilding = null;
let feedSettingsOpen = false;

function feedBalanceFor(category, balanceRows) {
    return balanceRows.find(r => r.id === category) || null;
}

// Yearly litres per feed category eaten in one building (ration split + straw
// bedding), plus head count per species. foodNow: this month's food, with
// today's ages (the yearly figures age the herd month by month).
function buildBarnFeedNeed(building, plan, farm) {
    const scale = feedConsumptionScale(farm);
    const byCategory = {};
    const heads = {};
    let food = 0, bedding = 0, foodNow = 0;
    (building.clusters || []).forEach(c => {
        const type = animalTypeOf(c.subType);
        if (!type) return;
        heads[type] = (heads[type] || 0) + c.numAnimals;
        if (!ANIMAL_NEEDS_DATA[c.subType]) return;
        const ration = resolveRation(type, plan, building.id);
        const f = clusterYearNeed(farm, type, c, 'food') * scale;
        const b = clusterYearNeed(farm, type, c, 'straw') * scale;
        food += f;
        foodNow += clusterDailyFood(farm, type, c) * scale;
        bedding += b;
        if (ration) splitByRecipe(f, ration, byCategory);
        byCategory.STRAW = (byCategory.STRAW || 0) + b;
    });
    return { byCategory, heads, food, bedding, foodNow };
}

function feedIsShort(row) {
    return row && !row.buyOnly && row.stock + row.have < row.need;
}

// The status, bar and "you have" line compare the WHOLE farm's need with the
// farm's stock + harvest (stock is shared by every barn); only the "this barn"
// line is per barn. When other barns eat the same feed, say so on the tile.
function renderFeedIngredientTile(categories, barnLitres, row, num) {
    const need = row ? row.need : 0;
    const farmWide = need > barnLitres * 1.001 + 1;
    const allBarns = farmWide ? ` <span class="feed-ing-scope">(${t('feedAllBarnsShort')})</span>` : '';
    const have = row ? row.stock + (row.buyOnly ? 0 : row.have) : 0;
    const diff = have - need;
    const pct = need > 0 ? Math.max(0, Math.min(100, have / need * 100)) : 100;
    let state, status;
    if (row && row.buyOnly && diff < 0) {
        state = 'buy';
        status = `<i class="fa-solid fa-cart-shopping" aria-hidden="true"></i> ${t('feedBuy')}`;
    } else if (diff >= 0) {
        state = 'ok';
        status = `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${t('feedEnough')}${diff > 0 ? ` <span class="feed-ing-extra">+${num(diff)} l</span>` : ''}`;
    } else {
        state = 'short';
        const ha = row.perHa > 0 ? `<span class="feed-ing-extra">≈ ${(-diff / row.perHa).toFixed(1)} ha</span>` : '';
        status = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${t('feedMissing')} ${num(-diff)} l ${ha}`
            + ` <button type="button" class="gen-link-btn feed-to-generator">${t('genFeedLink')}</button>`;
    }
    status += allBarns;
    const haveParts = [];
    if (row && row.stock > 0) haveParts.push(`${t('feedStockShort')} ${num(row.stock)}${row.barn > 0 ? ` (${t('feedInBarns')}: ${num(row.barn)} l)` : ''}`);
    if (row && !row.buyOnly && row.have > 0) haveParts.push(`${t('feedHarvestShort')} ${num(row.have)}`);
    return `<div class="feed-ing-tile feed-ing-tile--${state}">
        <div class="feed-ing-head">
            <span class="feed-ing-icon"><i class="fa-solid ${FEED_CATEGORY_ICONS[categories[0]] || 'fa-wheat-awn'}" aria-hidden="true"></i></span>
            <span class="feed-ing-name">${categories.map(feedCategoryLabel).join(' + ')}</span>
        </div>
        <div class="feed-ing-barn">${t('feedThisBarn')}: <strong>${num(barnLitres)} l</strong>${t('feedPerYearShort')}</div>
        ${farmWide ? `<div class="feed-ing-barn feed-ing-barn--all">${t('feedAllBarns')}: <strong>${num(need)} l</strong>${t('feedPerYearShort')}</div>` : ''}
        <div class="feed-ing-status">${status}</div>
        <div class="feed-ing-bar"><div class="feed-ing-bar-fill" style="width:${pct}%"></div></div>
        <div class="feed-ing-have">${t('feedYouHave')}${farmWide ? ` (${t('feedAllBarnsShort')})` : ''}: ${haveParts.length ? haveParts.join(' + ') : '0'} ${t('feedOfNeeded').replace('{n}', num(need))}</div>
    </div>`;
}

// Fill type as the player knows it: mixer products by name, crops through
// the crop dictionary.
// Base-game fill types that show up in mixer recipes.
const FEED_FILLTYPE_NAMES = {
    en: {
        DRYGRASS_WINDROW: 'Hay', DRYALFALFA_WINDROW: 'Alfalfa hay', DRYCLOVER_WINDROW: 'Clover hay',
        GRASS_WINDROW: 'Grass', ALFALFA_WINDROW: 'Alfalfa', CLOVER_WINDROW: 'Clover',
        SILAGE: 'Silage', STRAW: 'Straw', WATER: 'Water', CHAFF: 'Chaff'
    },
    pl: {
        DRYGRASS_WINDROW: 'Siano', DRYALFALFA_WINDROW: 'Siano z lucerny', DRYCLOVER_WINDROW: 'Siano z koniczyny',
        GRASS_WINDROW: 'Trawa', ALFALFA_WINDROW: 'Lucerna', CLOVER_WINDROW: 'Koniczyna',
        SILAGE: 'Kiszonka', STRAW: 'Słoma', WATER: 'Woda', CHAFF: 'Sieczka'
    },
    de: {
        DRYGRASS_WINDROW: 'Heu', DRYALFALFA_WINDROW: 'Luzerneheu', DRYCLOVER_WINDROW: 'Kleeheu',
        GRASS_WINDROW: 'Gras', ALFALFA_WINDROW: 'Luzerne', CLOVER_WINDROW: 'Klee',
        SILAGE: 'Silage', STRAW: 'Stroh', WATER: 'Wasser', CHAFF: 'Häckselgut'
    }
};

// A fill type by name: mixer products, base-game types, the mixer mod's own
// translations (in the app language, else its English title through the
// dictionary), then crops.
function feedFillTypeName(ft, mixer) {
    if (FEED_PRODUCT_FILLTYPES.includes(ft)) return t('feedProduct_' + ft);
    const base = (FEED_FILLTYPE_NAMES[currentLang] || FEED_FILLTYPE_NAMES.en)[ft];
    if (base) return base;
    const titles = mixer && mixer.fillTypeTitles && mixer.fillTypeTitles[ft];
    if (titles && titles[currentLang]) return titles[currentLang];
    if (titles && titles.en) return translateCropName(titles.en);
    const crop = translateCropName(formatCropName(ft));
    return crop || formatFillType(ft);
}

// Some mods make a mixer practically instant (e.g. 1000 cycles/h x 1000 l):
// then the real limit is how fast ingredients arrive, not the recipe rate.
function mixerRateText(perMonth, capacity, num) {
    const unlimited = perMonth > Math.max(capacity || 0, 1000) * 30;
    return unlimited ? t('feedMixerUnlimited') : t('feedMixerPerMonth').replace('{l}', num(perMonth));
}

// One tile per feed mixer the farm owns. Mixers whose product the selected
// barn's animals eat come first and are highlighted.
function renderFeedMixersSection(farm, barnAnimalTypes, num) {
    const mixers = (farm && farm.feedMixers) || [];
    if (!mixers.length) return '';
    const forBarn = m => m.products.some(p => (FEED_PRODUCT_ANIMALS[p] || []).some(a => barnAnimalTypes.includes(a)));
    const sorted = [...mixers].sort((a, b) => forBarn(b) - forBarn(a));
    let html = `<div class="hub-panel-subtitle">${t('feedMixersTitle')}</div><div class="feed-mixer-grid">`;
    sorted.forEach(m => {
        const relevant = forBarn(m);
        const on = m.recipes.filter(r => r.enabled);
        const products = m.products.map(p => {
            const inStock = m.stock[p] || 0;
            const cap = m.capacity[p] || m.capacity._default;
            return `<div class="feed-mixer-product">
                <span class="feed-mixer-product-name">${escapeHtml(feedFillTypeName(p))}</span>
                <span class="feed-mixer-product-stock">${num(inStock)} l${cap ? ` / ${num(cap)} l` : ''}</span>
                <span class="feed-mixer-product-rate">${mixerRateText(feedMixerMonthlyOutput(m, p), cap, num)}</span>
            </div>`;
        }).join('');
        const recipeLine = r => `<li class="${r.enabled ? 'is-on' : ''}"><i class="fa-solid ${r.enabled ? 'fa-circle-check' : 'fa-circle'}" aria-hidden="true"></i>
            ${r.inputs.map(i => escapeHtml(feedFillTypeName(i.fillType, m))).join(' + ')} → ${r.outputs.map(o => escapeHtml(feedFillTypeName(o.fillType, m))).join(', ')}</li>`;
        const inputs = [...new Set(m.recipes.flatMap(r => r.inputs.map(i => i.fillType)))];
        const inputStock = inputs.filter(ft => m.stock[ft] > 0).map(ft => `${escapeHtml(feedFillTypeName(ft, m))} ${num(m.stock[ft])} l`).join(' · ');
        html += `<div class="feed-mixer-tile ${relevant ? 'feed-mixer-tile--relevant' : ''}">
            <div class="feed-mixer-head"><i class="fa-solid fa-blender" aria-hidden="true"></i>
                <span class="feed-mixer-name-wrap"><span class="feed-mixer-name">${escapeHtml(mixerDisplayName(farm, m))}</span>
                <button type="button" class="barn-rename-btn feed-mixer-rename-btn" data-mixer="${escapeHtml(m.id)}" title="${t('feedMixerRename')}" aria-label="${t('feedMixerRename')}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button></span>
                ${relevant ? `<span class="feed-mixer-badge">${t('feedMixerForBarn')}</span>` : ''}</div>
            ${products}
            ${on.length ? '' : `<p class="feed-mixer-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${t('feedMixerNoneOn')}</p>`}
            <details class="feed-mixer-recipes"><summary>${t('feedMixerRecipes').replace('{on}', on.length).replace('{n}', m.recipes.length)}</summary>
                <ul>${m.recipes.map(recipeLine).join('')}</ul></details>
            <p class="feed-mixer-inputs">${inputStock ? `${t('feedMixerInputs')}: ${inputStock}` : t('feedMixerInputsEmpty')}</p>
        </div>`;
    });
    const pigRation = resolveRation('PIG', getFeedPlan(farm));
    html += `</div><p class="hub-panel-note">${t(pigRation && pigRation.mixer ? 'feedMixersNoteRecipe' : 'feedMixersNote')}</p>`;
    return html;
}

function renderFeedPlanPanel(titleEl, bodyEl, modalEl) {
    titleEl.textContent = t('feedPlanTitle');
    if (!feedPlanRerendering) {   // fresh open from the hub menu
        feedEditorDraft = null;
        feedSelectedBuilding = null;
        feedSettingsOpen = false;
        mixerFormOpen = null;
        mixerEditWagonId = null;
    }

    const farm = getCurrentFarm();
    const rates = getSupplyRates();
    const plan = getFeedPlan(farm);
    const demand = buildFeedDemand(farm, plan);
    const supply = buildFeedSupply(farm, plan, rates);
    const stock = (farm && farm.feedStock) || null;
    const balance = buildFeedBalance(demand, supply, plan, farmAverageYieldFactor(farm, rates), feedStockCategoriesFor(farm, plan), feedBarnStockCategoriesFor(farm, plan));
    const num = n => Math.round(n).toLocaleString(FIN_LOCALE());
    const buildings = ((farm && farm.animalBuildings) || []).filter(b => (b.clusters || []).some(c => animalTypeOf(c.subType)));

    let html = `<div class="feed-plan"><p class="supply-intro">${t('feedIntroShort')}</p>`;

    if (!buildings.length) {
        html += `<p class="hub-panel-note">${t('hubNoAnimalsYet')}</p>`;
    } else {
        if (!buildings.some(b => b.id === feedSelectedBuilding)) feedSelectedBuilding = buildings[0].id;
        const barnNeeds = {};
        buildings.forEach(b => { barnNeeds[b.id] = buildBarnFeedNeed(b, plan, farm); });

        // --- 1. Barns ---
        html += `<div class="hub-panel-subtitle">${t('feedPickBarn')}</div><div class="feed-barn-grid">`;
        buildings.forEach(b => {
            const need = barnNeeds[b.id];
            const short = Object.keys(need.byCategory).some(c => need.byCategory[c] > 0 && feedIsShort(feedBalanceFor(c, balance)));
            const animals = Object.keys(need.heads).map(type =>
                `<span class="feed-barn-animal"><i class="fa-solid ${FEED_ANIMAL_ICONS[type]}" aria-hidden="true"></i> ${t('feedAnimal_' + type)} × ${num(need.heads[type])}</span>`).join('');
            html += `<button type="button" class="feed-barn-tile ${b.id === feedSelectedBuilding ? 'feed-barn-tile--active' : ''}" data-building="${escapeHtml(String(b.id))}">
                <span class="feed-barn-title">${escapeHtml(buildingDisplayName(farm, b))}<span class="feed-barn-dot ${short ? 'feed-barn-dot--short' : ''}" title="${short ? t('feedMissing') : t('feedEnough')}"></span></span>
                ${animals}
                ${need.food > 0 ? `<span class="feed-barn-need">${num(need.food)} l ${t('feedFoodPerYear')}</span>` : ''}
            </button>`;
        });
        html += `</div>`;

        const barn = buildings.find(b => b.id === feedSelectedBuilding);
        const barnNeed = barnNeeds[barn.id];

        // --- 2. Feed per species in this barn ---
        Object.keys(barnNeed.heads).forEach(type => {
            const ration = resolveRation(type, plan, barn.id);
            const current = ration ? ration.id : '';
            html += `<div class="hub-panel-subtitle">${t('feedPickRation')}${Object.keys(barnNeed.heads).length > 1 ? ' · ' + t('feedAnimal_' + type) : ''}</div><div class="feed-ration-row">`;
            Object.keys(ANIMAL_FOOD_GROUPS[type] || {}).forEach(id => {
                html += `<button type="button" class="feed-ration-tile ${current === id ? 'feed-ration-tile--active' : ''}" data-type="${type}" data-ration="${id}">
                    <span class="feed-ration-name">${t('feedRation_' + id)}</span><span class="feed-ration-eff">${ANIMAL_FOOD_GROUPS[type][id].efficiency}%</span></button>`;
            });
            feedMixersFor(farm, type).forEach(m => {
                const id = 'mixer:' + m.id;
                html += `<button type="button" class="feed-ration-tile ${current === id ? 'feed-ration-tile--active' : ''}" data-type="${type}" data-ration="${escapeHtml(id)}">
                    <span class="feed-ration-name"><i class="fa-solid fa-blender" aria-hidden="true"></i> ${t('feedRationMixer')} · ${escapeHtml(mixerDisplayName(farm, m))}</span><span class="feed-ration-eff">100%</span></button>`;
            });
            plan.customFeeds.filter(f => f.animalType === type).forEach(f => {
                const id = 'custom:' + f.id;
                // Your own feed: edit and delete right on its tile.
                html += `<div class="feed-ration-tile feed-ration-tile--custom ${current === id ? 'feed-ration-tile--active' : ''}" role="button" tabindex="0" data-type="${type}" data-ration="${id}">
                    <span class="feed-ration-name"><i class="fa-solid fa-flask" aria-hidden="true"></i> ${escapeHtml(f.name)}</span><span class="feed-ration-eff">${f.efficiency}%</span>
                    <button type="button" class="feed-ration-tool feed-custom-edit" data-id="${f.id}" title="${t('notesEdit')}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                    <button type="button" class="feed-ration-tool feed-ration-tool--danger feed-custom-delete" data-id="${f.id}" title="${t('notesDelete')}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button></div>`;
            });
            html += `<button type="button" class="feed-ration-tile feed-ration-tile--new feed-custom-new" data-type="${type}"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${t('feedCustomNew')}</button></div>`;
            // Mixer ration: say which recipe the crop needs below follow.
            if (ration && ration.mixer) {
                const r = ration.mixer.recipe;
                const inputs = r ? r.inputs.map(i => feedFillTypeName(i.fillType, (farm.feedMixers || []).find(x => x.id === ration.mixer.id))).join(' + ') : '–';
                html += `<p class="hub-panel-note feed-mixer-ration-note">${t(ration.mixer.recipeEnabled ? 'feedRationMixerNote' : 'feedRationMixerNoteOff').replace('{recipe}', escapeHtml(inputs)).replace('{name}', escapeHtml(ration.mixer.name))}</p>`;
            }

        });

        if (feedEditorDraft && !feedEditorDraft.id) html += renderFeedEditor(feedEditorDraft);

        // --- 2b. Mixer wagon, for barns fed TMR (the only thing a mixer makes):
        // the built-in TMR with the farm's shares, or an own TMR-like feed ---
        const tmrRation = Object.keys(barnNeed.heads).map(type => resolveRation(type, plan, barn.id)).find(rationIsTmr);
        if (tmrRation && tmrRation.tmr) html += renderTmrSharesEditor(plan);
        if (tmrRation) html += renderMixerSection(farm, plan, barnNeed, num, rationTmrShares(tmrRation));

        // --- 3. Ingredient tiles ---
        const cats = FEED_CATEGORIES.filter(c => c !== 'STRAW' && barnNeed.byCategory[c] > 0);
        if (barnNeed.byCategory.STRAW > 0) cats.push('STRAW');
        html += `<div class="hub-panel-subtitle">${t('feedIngredients')}</div>`;
        if (barnNeed.food > 0 || barnNeed.bedding > 0) {
            html += `<div class="feed-need-summary">
                <div class="feed-need-item"><span class="feed-need-label">${t('feedYearNeedFood')}</span><span class="feed-need-value">${num(barnNeed.food)} l</span></div>
                ${barnNeed.bedding > 0 ? `<div class="feed-need-item"><span class="feed-need-label">${t('feedStrawBedding')}</span><span class="feed-need-value">${num(barnNeed.bedding)} l</span></div>` : ''}
                <div class="feed-need-item"><span class="feed-need-label">${t('feedYearNeedMonth')}</span><span class="feed-need-value">${num(barnNeed.foodNow)} l</span><span class="feed-need-label">${feedScaleNote(farm)}</span></div>
            </div>`;
        }
        if (!cats.length) {
            html += `<p class="hub-panel-note">${t('feedUnknownAnimals').replace('{n}', (barn.clusters || []).length)}</p>`;
        } else {
            html += `<div class="feed-ing-grid">`;
            cats.forEach(c => { html += renderFeedIngredientTile([c], barnNeed.byCategory[c], feedBalanceFor(c, balance), num); });
            html += `</div>`;
        }
        if (farm && !farm.saveGamePath) html += `<p class="hub-panel-note">${t('feedStockNoSave')}</p>`;
        else if (!stock) html += `<p class="hub-panel-note">${t('feedStockNotRead')}</p>`;

        // --- 3b. Feed mixers (productions making pig food / TMR / mineral feed) ---
        html += renderFeedMixersSection(farm, Object.keys(barnNeed.heads), num);
    }

    // --- 4. Settings (collapsed): feed fields, parameters, custom feeds ---
    html += `<details class="feed-settings" ${feedSettingsOpen ? 'open' : ''}>
        <summary><i class="fa-solid fa-sliders" aria-hidden="true"></i> ${t('feedSettings')}</summary>`;

    html += `<div class="hub-panel-subtitle">${t('feedPlanFields')}</div>`;
    if (!supply.rows.length) {
        html += `<p class="hub-panel-note">${t('feedNoFields')}</p>`;
    } else {
        html += `<table class="data-table supply-table feed-table"><thead><tr>
            <th>${t('suppliesColField')}</th><th>${t('suppliesColCrop')}</th><th>${t('suppliesColArea')}</th>
            <th>${t('feedColUse')}</th><th>${t('feedColStraw')}</th><th>${t('feedColYield')}</th></tr></thead><tbody>`;
        supply.rows.forEach(r => {
            const opts = ['sale', ...r.uses].map(u => `<option value="${u}" ${r.use === u ? 'selected' : ''}>${t('feedUse_' + u)}</option>`).join('');
            html += `<tr><td>${escapeHtml(r.number)}</td><td>${translateCropName(r.crop)}${catchTag(r)}</td><td>${r.area.toFixed(2)} ha</td>
                <td>${r.use === 'cuts' ? `<span class="feed-use-cuts">${t('feedUseCuts').replace('{n}', r.cuts)}</span>` : `<select class="feed-input feed-use-select" data-key="${escapeHtml(r.key)}">${opts}</select>`}</td>
                <td>${r.strawPossible ? `<input type="checkbox" class="feed-straw-check" data-key="${escapeHtml(r.key)}" ${plan.strawFields[r.key] ? 'checked' : ''}>` : '–'}</td>
                <td>${r.litres > 0 ? num(r.litres) + ' l' : '–'}${r.straw > 0 ? `<span class="supply-sub">${feedCategoryLabel('STRAW')}: ${num(r.straw)} l</span>` : ''}</td></tr>`;
        });
        html += `</tbody></table>`;
    }

    html += `<div class="hub-panel-subtitle">${t('feedPlanParams')}</div>
        <div class="supply-opt-grid feed-params">
            <label>${t('feedGrassCuts')}<input type="number" class="feed-input feed-param" data-param="grassCuts" min="1" max="8" step="1" value="${plan.grassCuts}"></label>
            <label>${t('feedChaffYield')}<input type="number" class="feed-input feed-param" data-param="chaffYield" min="0" step="100" value="${plan.chaffYield}"></label>
            <label>${t('feedStrawYield')}<input type="number" class="feed-input feed-param" data-param="strawYield" min="0" step="100" value="${plan.strawYield || ''}" placeholder="${t('feedStrawYieldAuto')}"></label>
        </div>`;

    // Editing an existing feed (or no barns to hang a new one on) happens here.
    const editorHere = feedEditorDraft && (feedEditorDraft.id || !buildings.length);
    if (plan.customFeeds.length || editorHere) html += `<div class="hub-panel-subtitle">${t('feedCustomTitle')}</div>`;
    if (plan.customFeeds.length) {
        html += `<div class="feed-custom-list">`;
        plan.customFeeds.forEach(f => {
            const parts = f.ingredients.map(i => `${feedCategoryLabel(i.category)} ${i.pct}%`).join(' · ');
            html += `<div class="feed-custom-card">
                <div class="feed-custom-head">
                    <span class="feed-custom-name"><i class="fa-solid fa-flask" aria-hidden="true"></i> ${escapeHtml(f.name)}</span>
                    <span class="feed-custom-meta">${t('feedAnimal_' + f.animalType)} · ${f.efficiency}%</span>
                    <button type="button" class="note-card-action feed-custom-edit" data-id="${f.id}" title="${t('notesEdit')}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                    <button type="button" class="note-card-action note-card-action--danger feed-custom-delete" data-id="${f.id}" title="${t('notesDelete')}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
                </div>
                <div class="supply-sub">${parts}</div>
            </div>`;
        });
        html += `</div>`;
    }
    if (editorHere) html += renderFeedEditor(feedEditorDraft);

    if (demand.unknownSubTypes > 0) html += `<p class="hub-panel-note">${t('feedUnknownAnimals').replace('{n}', demand.unknownSubTypes)}</p>`;
    html += `<p class="hub-panel-note">${t('feedStockNote')}</p><p class="hub-panel-note">${t('feedPlanNote')}</p></details></div>`;

    bodyEl.innerHTML = html;
    wireFeedPlanPanel(bodyEl);
    wireMixerSection(bodyEl);
}

// --- Mixer wagon (paszowóz) ------------------------------------------------
// Load the wagon from bales (by the quarter) and loose products and check
// the result against the TMR recipe the game's mixer needs.
// Which inline form is open: null | 'wagon' | 'bale'; the wagon being edited
// in the 'wagon' form (null = a new one).
let mixerFormOpen = null;
let mixerEditWagonId = null;

function mixerWagons(farm, plan) {
    const fromSave = ((farm && farm.mixerWagons) || []).map(w => ({
        ...w, capacity: parseFloat(plan.mixer.capacity[w.id]) > 0 ? parseFloat(plan.mixer.capacity[w.id]) : w.capacity
    }));
    return [...fromSave, ...plan.mixer.custom.map(w => ({ ...w, source: 'custom' }))];
}

// The chosen wagon, or the first one when nothing (valid) is chosen yet.
function selectedMixerWagon(farm, plan) {
    const wagons = mixerWagons(farm, plan);
    return wagons.find(w => w.id === plan.mixer.selected) || wagons[0] || null;
}

// Bale types to pick from: what's on the farm (from the save) + the player's own.
function mixerBaleTypes(farm, plan) {
    const onFarm = ((farm && farm.feedBales) || []).map(b => ({
        key: b.key, label: baleSizeLabel(b.size), fillType: b.fillType,
        category: FEED_FILLTYPE_CATEGORY[b.fillType], litres: b.litres, count: b.count
    }));
    const own = plan.mixer.customBales.map(b => ({
        key: 'custom:' + b.id, label: b.name, fillType: null,
        category: b.category, litres: parseFloat(b.litres) || 0, count: null, custom: true
    }));
    // The game's own bale sizes (data/objects/bales/*), to compare with what
    // the farm has: litres per bale for hay, silage and straw.
    const std = [];
    Object.entries(MIXER_STANDARD_BALES).forEach(([size, byType]) => {
        Object.entries(byType).forEach(([fillType, litres]) => {
            const key = size + '|' + fillType + '|' + litres;
            if (onFarm.some(b => b.key === key)) return;
            std.push({ key, label: baleSizeLabel(size), fillType, category: FEED_FILLTYPE_CATEGORY[fillType], litres, count: null, std: true });
        });
    });
    // A loaded bale type the farm has run out of (key "round125|DRYCLOVER_WINDROW|4500")
    // stays pickable with 0 on the farm — otherwise its row showed the first
    // bale in the list and counted 0 l.
    const known = new Set([...onFarm, ...own, ...std].map(b => b.key));
    const gone = [];
    Object.values(plan.mixer.loads).flat().forEach(item => {
        if (item.kind !== 'bale' || known.has(item.baleKey) || String(item.baleKey).startsWith('custom:')) return;
        const [size, fillType, litres] = String(item.baleKey).split('|');
        const category = FEED_FILLTYPE_CATEGORY[fillType];
        if (!category || !(parseFloat(litres) > 0)) return;
        known.add(item.baleKey);
        gone.push({ key: item.baleKey, label: baleSizeLabel(size), fillType, category, litres: parseFloat(litres), count: 0 });
    });
    return [...onFarm, ...gone, ...own, ...std];
}

// FS25 base game bales (data/objects/bales/roundbales|squarebales/*.xml,
// <fillType capacity>): litres of hay, silage and straw per bale.
const MIXER_STANDARD_BALES = {
    round125: { DRYGRASS_WINDROW: 4500, SILAGE: 3500, STRAW: 5000 },
    round150: { DRYGRASS_WINDROW: 6500, SILAGE: 5500, STRAW: 7500 },
    round180: { DRYGRASS_WINDROW: 9000, SILAGE: 7500, STRAW: 11000 },
    square180: { DRYGRASS_WINDROW: 6000, SILAGE: 5000, STRAW: 7000 },
    square220: { DRYGRASS_WINDROW: 7250, SILAGE: 6000, STRAW: 8250 },
    square240: { DRYGRASS_WINDROW: 8000, SILAGE: 6500, STRAW: 9000 }
};

// <option>s grouped: on the farm / your own / the game's standard sizes.
function mixerBaleOptionsHtml(baleTypes, selectedKey) {
    const opt = x => `<option value="${escapeHtml(x.key)}" ${x.key === selectedKey ? 'selected' : ''}>${escapeHtml(baleTypeLabel(x))}${x.count !== null ? ` (${t('mixerOnFarm').replace('{n}', x.count)})` : ''}</option>`;
    const groups = [
        ['mixerGroupFarm', baleTypes.filter(x => !x.custom && !x.std)],
        ['mixerGroupOwn', baleTypes.filter(x => x.custom)],
        ['mixerGroupStd', baleTypes.filter(x => x.std)]
    ];
    return groups.filter(([, list]) => list.length)
        .map(([label, list]) => `<optgroup label="${escapeHtml(t(label))}">${list.map(opt).join('')}</optgroup>`).join('');
}

function baleSizeLabel(size) {
    const m = String(size || '').match(/^(round|square)(\d+)$/);
    if (!m) return t('mixerBale');
    return t(m[1] === 'round' ? 'mixerBaleRound' : 'mixerBaleSquare').replace('{s}', m[2]);
}

// "Hay (clover)" etc. — the feed it counts as, plus the crop when the
// savegame fillType says more than that (clover / alfalfa windrow).
function baleContentLabel(b) {
    let what = feedCategoryLabel(b.category);
    const ft = String(b.fillType || '').toUpperCase();
    if (ft.includes('CLOVER')) what += ' (' + t('mixerClover') + ')';
    else if (ft.includes('ALFALFA')) what += ' (' + t('mixerAlfalfa') + ')';
    return what;
}

function baleTypeLabel(b) {
    const what = baleContentLabel(b);
    return `${b.label} · ${what} · ${Math.round(b.litres).toLocaleString(FIN_LOCALE())} l`;
}

// Litres per feed category in the current load.
function mixerLoadTotals(plan, baleTypes) {
    const byCategory = {};
    let total = 0;
    mixerLoad(plan).forEach(item => {
        let cat = null, litres = 0;
        if (item.kind === 'bale') {
            const b = baleTypes.find(x => x.key === item.baleKey);
            if (b) { cat = b.category; litres = b.litres * (parseFloat(item.count) || 0); }
        } else {
            cat = item.category;
            litres = parseFloat(item.litres) || 0;
        }
        if (!cat || litres <= 0) return;
        byCategory[cat] = (byCategory[cat] || 0) + litres;
        total += litres;
    });
    return { byCategory, total };
}

// Fills the wagon to the barn's TMR shares. Ingredients you have bales of go
// in as bales rounded to the nearest quarter (never more than the farm has);
// the rest (e.g. mineral feed) goes in loose. If rounding overfills the
// wagon, quarter bales come off wherever the load overshoots its target the most.
function mixerAutoLoad(shares, wagon, baleTypes) {
    baleTypes = baleTypes.filter(b => !b.std);
    const recipeSum = MIXER_TMR_CATEGORIES.reduce((s, c) => s + (parseFloat(shares[c]) || 0), 0) || 100;
    const target = {};
    const baleLoads = [];   // { category, item, litres }
    const load = [];
    MIXER_TMR_CATEGORIES.forEach(c => {
        target[c] = wagon.capacity * (parseFloat(shares[c]) || 0) / recipeSum;
        if (target[c] <= 0) return;
        let left = target[c];
        const bales = baleTypes.filter(b => b.category === c && b.litres > 0)
            .sort((a, b) => (b.count || 0) - (a.count || 0) || b.litres - a.litres);
        for (const b of bales) {
            let n = quarterBales(left / b.litres);
            if (b.count !== null) n = Math.min(n, b.count);
            if (n <= 0) continue;
            const item = { kind: 'bale', baleKey: b.key, count: n };
            load.push(item);
            baleLoads.push({ category: c, item, litres: b.litres });
            left -= n * b.litres;
            if (left <= 0) break;
        }
        // Loose only when there are no (or not enough) bales of it.
        if (left >= 50 && (!bales.length || bales.every(b => b.count !== null && load.some(i => i.baleKey === b.key && i.count >= b.count)))) {
            load.push({ kind: 'bulk', category: c, litres: Math.round(left / 50) * 50 });
        }
    });

    const litresOf = c => load.reduce((s, i) => {
        if (i.kind === 'bulk') return s + (i.category === c ? i.litres : 0);
        const bl = baleLoads.find(x => x.item === i);
        return s + (bl && bl.category === c ? i.count * bl.litres : 0);
    }, 0);
    const total = () => MIXER_TMR_CATEGORIES.reduce((s, c) => s + litresOf(c), 0);
    let guard = 50;
    while (total() > wagon.capacity && guard-- > 0) {
        const candidates = baleLoads.filter(x => x.item.count > 0);
        if (!candidates.length) break;
        candidates.sort((a, b) => (litresOf(b.category) - target[b.category]) - (litresOf(a.category) - target[a.category]));
        candidates[0].item.count = quarterBales(candidates[0].item.count - 0.25);
    }
    return load.filter(i => i.kind === 'bulk' || i.count > 0);
}

// The farm's TMR shares, each within the map's recipe limits (mineral feed
// and straw may be 0 %). Saved as soon as they add up to 100 %.
function renderTmrSharesEditor(plan) {
    const sum = MIXER_TMR_CATEGORIES.reduce((s, c) => s + (parseFloat(plan.tmr[c]) || 0), 0);
    let html = `<div class="tmr-shares"><div class="tmr-shares-head">
        <span class="mixer-col-title">${t('tmrSharesTitle')}</span>
        <button type="button" class="supply-reset-btn tmr-shares-reset">${t('tmrSharesReset')}</button></div>
        <div class="tmr-shares-row">`;
    MIXER_TMR_CATEGORIES.forEach(c => {
        const [min, max] = TMR_LIMITS[c];
        html += `<label class="tmr-share"><span class="tmr-share-name">${feedCategoryLabel(c)}</span>
            <span class="feed-pct"><input type="number" class="feed-input tmr-share-input" data-cat="${c}" min="${min}" max="${max}" step="1" value="${Math.round((parseFloat(plan.tmr[c]) || 0) * 10) / 10}"><span class="supply-unit">%</span></span>
            <span class="tmr-share-range">${t('mixerRange').replace('{a}', min).replace('{b}', max)}</span></label>`;
    });
    html += `</div><p class="tmr-shares-sum${Math.abs(sum - 100) > 0.05 ? ' is-off' : ''}">${t('feedCustomSum').replace('{s}', Math.round(sum * 10) / 10)}</p>
        <p class="tmr-shares-error feed-warn"></p></div>`;
    return html;
}

// shares: the barn's TMR shares (the built-in TMR or an own TMR-like feed).
function renderMixerSection(farm, plan, barnNeed, num, shares) {
    const wagons = mixerWagons(farm, plan);
    const wagon = selectedMixerWagon(farm, plan);
    plan.mixer.selected = wagon ? wagon.id : null;
    const baleTypes = mixerBaleTypes(farm, plan);
    const load = mixerLoad(plan);
    const editing = mixerEditWagonId ? wagons.find(w => w.id === mixerEditWagonId) : null;
    const sortBy = plan.mixer.sort;
    const shown = sortBy === 'default' ? wagons : [...wagons].sort((a, b) => sortBy === 'name'
        ? String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' })
        : (b.capacity || 0) - (a.capacity || 0));

    let html = `<div class="hub-panel-subtitle">${t('mixerTitle')}</div><div class="mixer" data-shares="${escapeHtml(JSON.stringify(shares))}">`;

    // --- Wagon picker ---
    if (wagons.length > 1) {
        html += `<label class="mixer-sort">${t('mixerSort')}
            <select class="feed-input mixer-sort-select">
                ${['default', 'name', 'capacity'].map(k => `<option value="${k}" ${k === sortBy ? 'selected' : ''}>${t('mixerSort_' + k)}</option>`).join('')}
            </select></label>`;
    }
    html += `<div class="mixer-wagons">`;
    shown.forEach(w => {
        html += `<div class="mixer-wagon-tile ${w.id === plan.mixer.selected ? 'mixer-wagon-tile--active' : ''}" role="button" tabindex="0" data-id="${escapeHtml(w.id)}">
            <span class="mixer-wagon-icon" aria-hidden="true"><i class="fa-solid fa-truck-ramp-box" aria-hidden="true"></i></span>
            <span class="mixer-wagon-text">
                <span class="mixer-wagon-name">${escapeHtml(w.name)}</span>
                <span class="mixer-wagon-meta">${w.capacity ? num(w.capacity) + ' l' : t('mixerNoCapacity')} · ${t(w.source === 'save' ? 'mixerFromSave' : 'mixerOwn')}</span>
            </span>
            <span class="mixer-wagon-actions">
                <button type="button" class="note-card-action mixer-wagon-edit" data-id="${escapeHtml(w.id)}" title="${t('mixerEditWagon')}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                ${w.source === 'custom' ? `<button type="button" class="note-card-action note-card-action--danger mixer-wagon-delete" data-id="${escapeHtml(w.id)}" title="${t('delete')}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>` : ''}
            </span>
        </div>`;
    });
    html += `<button type="button" class="mixer-add-btn mixer-new-wagon"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${t('mixerNewWagon')}</button></div>`;

    if (mixerFormOpen === 'wagon') {
        // New wagon, or editing one: an own wagon's name and capacity; a wagon
        // from the save keeps the game's name, only its capacity can change.
        const fromSave = editing && editing.source !== 'custom';
        html += `<div class="mixer-form">
            <label>${t('mixerWagonName')}<input type="text" class="feed-input mixer-f-name" placeholder="${t('mixerWagonNamePh')}" value="${editing ? escapeHtml(editing.name) : ''}" ${fromSave ? `disabled title="${t('mixerNameFromSave')}"` : ''}></label>
            <label>${t('mixerCapacity')}<span class="feed-pct"><input type="number" class="feed-input mixer-f-cap" min="100" step="100" placeholder="10000" value="${editing && editing.capacity ? editing.capacity : ''}"><span class="supply-unit">l</span></span></label>
            <button type="button" class="btn btn--primary btn--sm mixer-f-save-wagon"><i class="fa-solid fa-check" aria-hidden="true"></i> ${t('feedSave')}</button>
            <button type="button" class="btn btn--secondary btn--sm mixer-f-cancel">${t('notesCancel')}</button>
        </div>`;
    }
    if (!wagons.length && mixerFormOpen !== 'wagon') html += `<p class="hub-panel-note">${t('mixerNoWagons')}</p>`;

    if (wagon) {
        if (!wagon.capacity) {
            html += `<label class="mixer-cap-missing">${t('mixerEnterCapacity')}
                <span class="feed-pct"><input type="number" class="feed-input mixer-cap-input" data-id="${escapeHtml(wagon.id)}" min="100" step="100" placeholder="10000"><span class="supply-unit">l</span></span></label>`;
        }

        const totals = mixerLoadTotals(plan, baleTypes);
        html += `<div class="mixer-body">`;

        // --- Load list ---
        html += `<div class="mixer-load"><div class="mixer-col-title">${t('mixerLoad')}</div>`;
        if (!load.length) html += `<p class="barn-empty">${t('mixerLoadEmpty')}</p>`;
        else html += `<div class="mixer-row mixer-row--head" aria-hidden="true"><span></span><span>${t('mixerColMaterial')}</span><span>${t('mixerColQty')}</span><span>${t('mixerColLitres')}</span><span></span></div>`;
        load.forEach((item, idx) => {
            if (item.kind === 'bale') {
                const b = baleTypes.find(x => x.key === item.baleKey);
                const litres = b ? b.litres * (parseFloat(item.count) || 0) : 0;
                const tooMany = b && b.count !== null && item.count > b.count;
                html += `<div class="mixer-row">
                    <span class="mixer-row-icon" aria-hidden="true"><i class="fa-solid fa-circle-dot" aria-hidden="true"></i></span>
                    <select class="feed-input mixer-bale-select" data-idx="${idx}">
                        ${b ? '' : '<option value="" selected disabled>—</option>'}
                        ${mixerBaleOptionsHtml(baleTypes, item.baleKey)}
                    </select>
                    <span class="mixer-qty">
                        <button type="button" class="mixer-step" data-idx="${idx}" data-step="-0.25" aria-label="-¼">−</button>
                        <input type="number" class="feed-input mixer-count" data-idx="${idx}" min="0" step="0.25" value="${item.count}">
                        <button type="button" class="mixer-step" data-idx="${idx}" data-step="0.25" aria-label="+¼">+</button>
                        <span class="supply-unit">${t('mixerPcs')}</span>
                    </span>
                    <span class="mixer-row-litres ${tooMany ? 'feed-warn' : ''}" ${tooMany ? `title="${t('mixerTooManyBales').replace('{n}', b.count)}"` : ''}>${num(litres)} l</span>
                    <button type="button" class="note-edit-checklist-remove mixer-remove" data-idx="${idx}" title="${t('delete')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                </div>`;
            } else {
                html += `<div class="mixer-row">
                    <span class="mixer-row-icon mixer-row-icon--bulk" aria-hidden="true"><i class="fa-solid fa-mound" aria-hidden="true"></i></span>
                    <select class="feed-input mixer-bulk-cat" data-idx="${idx}">
                        ${MIXER_TMR_CATEGORIES.map(c => `<option value="${c}" ${c === item.category ? 'selected' : ''}>${feedCategoryLabel(c)} (${t('mixerLoose')})</option>`).join('')}
                    </select>
                    <span class="mixer-qty">
                        <input type="number" class="feed-input mixer-bulk-litres" data-idx="${idx}" min="0" step="50" value="${Math.round(parseFloat(item.litres) || 0)}">
                        <span class="supply-unit">l</span>
                    </span>
                    <span class="mixer-row-litres">${num(parseFloat(item.litres) || 0)} l</span>
                    <button type="button" class="note-edit-checklist-remove mixer-remove" data-idx="${idx}" title="${t('delete')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                </div>`;
            }
        });
        html += `<div class="mixer-actions">
            <button type="button" class="mixer-add-btn mixer-add-bale" ${baleTypes.length ? '' : 'disabled'}><i class="fa-solid fa-plus" aria-hidden="true"></i> ${t('mixerAddBale')}</button>
            <button type="button" class="mixer-add-btn mixer-add-bulk"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${t('mixerAddBulk')}</button>
            <button type="button" class="mixer-add-btn mixer-new-bale"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${t('mixerNewBale')}</button>
            <button type="button" class="supply-fillplan-btn mixer-auto" ${wagon.capacity ? '' : 'disabled'}><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ${t('mixerAuto')}</button>
            ${load.length ? `<button type="button" class="supply-reset-btn mixer-clear">${t('mixerClear')}</button>` : ''}
        </div>`;
        if (!baleTypes.length) html += `<p class="barn-empty">${t('mixerNoBales')}</p>`;
        if (mixerFormOpen === 'bale') {
            html += `<div class="mixer-form">
                <label>${t('mixerBaleName')}<input type="text" class="feed-input mixer-f-bname" placeholder="${t('mixerBaleNamePh')}"></label>
                <label>${t('mixerBaleContent')}<select class="feed-input mixer-f-bcat">${MIXER_TMR_CATEGORIES.map(c => `<option value="${c}">${feedCategoryLabel(c)}</option>`).join('')}</select></label>
                <label>${t('mixerBaleLitres')}<span class="feed-pct"><input type="number" class="feed-input mixer-f-blitres" min="1" step="50" placeholder="4000"><span class="supply-unit">l</span></span></label>
                <button type="button" class="btn btn--primary btn--sm mixer-f-save-bale"><i class="fa-solid fa-check" aria-hidden="true"></i> ${t('feedSave')}</button>
                <button type="button" class="btn btn--secondary btn--sm mixer-f-cancel">${t('notesCancel')}</button>
            </div>`;
        }
        if (plan.mixer.customBales.length) {
            html += `<div class="mixer-own-bales">${plan.mixer.customBales.map(b => `<span class="mixer-own-bale">${escapeHtml(b.name)} · ${feedCategoryLabel(b.category)} · ${num(parseFloat(b.litres) || 0)} l
                <button type="button" class="mixer-own-bale-del" data-id="${escapeHtml(b.id)}" title="${t('delete')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>`).join('')}</div>`;
        }
        html += `</div>`;   // .mixer-load

        // --- Summary: fill level, mix vs recipe, days it lasts ---
        html += `<div class="mixer-summary"><div class="mixer-col-title">${t('mixerResult')}</div>`;
        const cap = wagon.capacity || 0;
        const fillPct = cap ? totals.total / cap * 100 : 0;
        const over = cap && totals.total > cap;
        html += `<div class="feed-headline">
                <div class="feed-amount">
                    <span class="feed-amount-value">${num(totals.total)} l</span>
                    <span class="feed-amount-types">${cap ? t('mixerOfCapacity').replace('{c}', num(cap)) : t('mixerNoCapacity')}</span>
                </div>
                ${cap ? `<div class="feed-days ${over ? 'feed-days--critical' : (fillPct < 70 ? 'feed-days--warning' : 'feed-days--ok')}"><span class="feed-days-value">${Math.round(fillPct)}%</span><span class="feed-days-label">${t('mixerFill')}</span></div>` : ''}
            </div>`;
        if (cap) html += `<div class="feed-gauge"><div class="pen-bar-track"><div class="pen-bar-fill ${over ? 'pen-bar-fill--low' : 'pen-bar-fill--ok'}" style="width:${Math.max(2, Math.min(100, fillPct))}%"></div></div></div>`;
        if (over) html += `<p class="barn-empty feed-warn">${t('mixerOver').replace('{l}', num(totals.total - cap))}</p>`;

        if (totals.total > 0) {
            const recipeSum = MIXER_TMR_CATEGORIES.reduce((s, c) => s + (parseFloat(shares[c]) || 0), 0) || 100;
            const problems = [];
            // Shares rounded to 0.1 % so the shown figures add up to exactly 100.
            const shownPct = sharesTo100(Object.fromEntries(Object.entries(totals.byCategory).map(([c, l]) => [c, l / totals.total * 100])));
            html += `<div class="mixer-mix">`;
            MIXER_TMR_CATEGORIES.forEach(c => {
                const litres = totals.byCategory[c] || 0;
                const pct = litres / totals.total * 100;
                const [min, max] = TMR_LIMITS[c];
                const target = (parseFloat(shares[c]) || 0) / recipeSum * 100;
                const ok = pct >= min - 0.05 && pct <= max + 0.05;
                if (!ok) problems.push(feedCategoryLabel(c));
                // Ingredients the recipe allows at 0 % (mineral feed, straw) are optional.
                const optional = min === 0 ? ` <span class="mixer-mix-optional">${t('mixerOptional')}</span>` : '';
                html += `<div class="mixer-mix-row ${ok ? '' : 'mixer-mix-row--bad'}">
                    <span class="mixer-mix-name">${feedCategoryLabel(c)}${optional}</span>
                    <span class="mixer-mix-track" title="${t('mixerRange').replace('{a}', min).replace('{b}', max)}">
                        <span class="mixer-mix-range" style="left:${min}%;width:${max - min}%"></span>
                        <span class="mixer-mix-fill" style="width:${Math.min(100, pct)}%"></span>
                        <span class="mixer-mix-target" style="left:${Math.min(100, target)}%" title="${t('mixerTarget')}: ${Math.round(target)}%"></span>
                    </span>
                    <span class="mixer-mix-pct">${(shownPct[c] || 0).toFixed(1)}%</span>
                    <span class="mixer-mix-l">${num(litres)} l</span>
                </div>`;
            });
            html += `<div class="mixer-mix-row mixer-mix-row--sum">
                    <span class="mixer-mix-name">${t('mixerSum')}</span><span></span>
                    <span class="mixer-mix-pct">${Object.values(shownPct).reduce((s, v) => s + v, 0).toFixed(1)}%</span>
                    <span class="mixer-mix-l">${num(totals.total)} l</span>
                </div>`;
            html += `</div>`;
            const foreign = Object.keys(totals.byCategory).filter(c => !MIXER_TMR_CATEGORIES.includes(c));
            if (foreign.length) problems.push(...foreign.map(c => feedCategoryLabel(c) + ' ✕'));
            html += problems.length
                ? `<div class="mixer-status mixer-status--bad"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${t('mixerInvalid').replace('{list}', problems.join(', '))}</div>`
                : `<div class="mixer-status mixer-status--ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${t('mixerValid')}</div>`;

            const daily = barnNeed.foodNow / feedDaysPerPeriod(farm);
            if (daily > 0) html += `<p class="mixer-days">${t('mixerLasts').replace('{d}', (totals.total / daily).toFixed(1)).replace('{l}', num(daily))}</p>`;
        }
        html += `</div></div>`;   // .mixer-summary, .mixer-body
    }
    html += `</div>`;   // .mixer
    return html;
}

function wireMixerSection(bodyEl) {
    const root = bodyEl.querySelector('.mixer');
    if (!root) return;
    const update = (fn) => { const plan = getFeedPlan(getCurrentFarm()); fn(plan); saveFeedPlan(plan); rerenderFeedPlan(); };
    const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener(ev, e => fn(el, e)));
    const idx = el => parseInt(el.dataset.idx);

    on('.mixer-wagon-tile', 'click', (el, e) => {
        if (e.target.closest('.mixer-wagon-actions')) return;
        update(plan => { plan.mixer.selected = el.dataset.id; });
    });
    on('.mixer-wagon-tile', 'keydown', (el, e) => {
        if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        update(plan => selectMixerWagon(plan, el.dataset.id));
    });
    on('.mixer-wagon-delete', 'click', (el, e) => {
        e.stopPropagation();
        if (mixerEditWagonId === el.dataset.id) { mixerFormOpen = null; mixerEditWagonId = null; }
        update(plan => {
            plan.mixer.custom = plan.mixer.custom.filter(w => w.id !== el.dataset.id);
            delete plan.mixer.loads[el.dataset.id];
        });
    });
    on('.mixer-wagon-edit', 'click', (el, e) => {
        e.stopPropagation();
        mixerFormOpen = 'wagon';
        mixerEditWagonId = el.dataset.id;
        rerenderFeedPlan();
    });
    on('.mixer-new-wagon', 'click', () => { mixerFormOpen = 'wagon'; mixerEditWagonId = null; rerenderFeedPlan(); });
    on('.mixer-new-bale', 'click', () => { mixerFormOpen = 'bale'; rerenderFeedPlan(); });
    on('.mixer-f-cancel', 'click', () => { mixerFormOpen = null; mixerEditWagonId = null; rerenderFeedPlan(); });
    on('.mixer-f-save-wagon', 'click', () => {
        const nameEl = root.querySelector('.mixer-f-name');
        const name = (nameEl.value || '').trim();
        const cap = parseFloat(root.querySelector('.mixer-f-cap').value);
        const editId = mixerEditWagonId;
        if ((!name && !nameEl.disabled) || !(cap > 0)) return;
        mixerFormOpen = null;
        mixerEditWagonId = null;
        update(plan => {
            if (!editId) {
                const id = 'custom:' + Date.now().toString(36);
                plan.mixer.custom.push({ id, name, capacity: cap });
                plan.mixer.selected = id;
                return;
            }
            const own = plan.mixer.custom.find(w => w.id === editId);
            if (own) { own.name = name; own.capacity = cap; }
            else plan.mixer.capacity[editId] = cap;   // wagon from the save
        });
    });
    on('.mixer-f-save-bale', 'click', () => {
        const name = (root.querySelector('.mixer-f-bname').value || '').trim();
        const category = root.querySelector('.mixer-f-bcat').value;
        const litres = parseFloat(root.querySelector('.mixer-f-blitres').value);
        if (!name || !(litres > 0)) return;
        mixerFormOpen = null;
        update(plan => {
            const id = Date.now().toString(36);
            plan.mixer.customBales.push({ id, name, category, litres });
            mixerLoad(plan).push({ kind: 'bale', baleKey: 'custom:' + id, count: 1 });
        });
    });
    on('.mixer-own-bale-del', 'click', (el) => update(plan => {
        plan.mixer.customBales = plan.mixer.customBales.filter(b => b.id !== el.dataset.id);
        Object.keys(plan.mixer.loads).forEach(id => {
            plan.mixer.loads[id] = plan.mixer.loads[id].filter(i => i.baleKey !== 'custom:' + el.dataset.id);
        });
    }));
    on('.mixer-cap-input', 'change', (el) => {
        const cap = parseFloat(el.value);
        if (cap > 0) update(plan => { plan.mixer.capacity[el.dataset.id] = cap; });
    });

    on('.mixer-add-bale', 'click', () => update(plan => {
        const types = mixerBaleTypes(getCurrentFarm(), plan);
        if (types.length) mixerLoad(plan).push({ kind: 'bale', baleKey: types[0].key, count: 1 });
    }));
    on('.mixer-add-bulk', 'click', () => update(plan => { mixerLoad(plan).push({ kind: 'bulk', category: 'MINERAL', litres: 500 }); }));
    on('.mixer-remove', 'click', (el) => update(plan => { mixerLoad(plan).splice(idx(el), 1); }));
    on('.mixer-clear', 'click', () => update(plan => { setMixerLoad(plan, []); }));
    on('.mixer-bale-select', 'change', (el) => update(plan => { mixerLoad(plan)[idx(el)].baleKey = el.value; }));
    on('.mixer-bulk-cat', 'change', (el) => update(plan => { mixerLoad(plan)[idx(el)].category = el.value; }));
    on('.mixer-bulk-litres', 'change', (el) => update(plan => { mixerLoad(plan)[idx(el)].litres = Math.max(0, parseFloat(el.value) || 0); }));
    on('.mixer-count', 'change', (el) => update(plan => { mixerLoad(plan)[idx(el)].count = quarterBales(el.value); }));
    on('.mixer-step', 'click', (el) => update(plan => {
        const item = mixerLoad(plan)[idx(el)];
        item.count = quarterBales((parseFloat(item.count) || 0) + parseFloat(el.dataset.step));
    }));
    on('.mixer-auto', 'click', () => update(plan => {
        const farm = getCurrentFarm();
        const wagon = selectedMixerWagon(farm, plan);
        let shares = null;
        try { shares = JSON.parse(root.dataset.shares || 'null'); } catch { shares = null; }
        if (wagon && wagon.capacity) setMixerLoad(plan, mixerAutoLoad(shares || plan.tmr, wagon, mixerBaleTypes(farm, plan)));
    }));
}

function renderFeedEditor(d) {
    const sumState = feedSumState(d.ingredients);
    let html = `<div class="feed-editor">
        <div class="feed-editor-row">
            <label>${t('feedCustomName')}<input type="text" class="feed-input feed-ed-name" value="${escapeHtml(d.name)}" placeholder="${t('feedCustomNamePh')}"></label>
            <label>${t('feedColSpecies')}<select class="feed-input feed-ed-type">${FEED_ANIMAL_TYPES.map(type => `<option value="${type}" ${d.animalType === type ? 'selected' : ''}>${t('feedAnimal_' + type)}</option>`).join('')}</select></label>
            <label>${t('feedColEfficiency')}<span class="feed-pct"><input type="number" class="feed-input feed-ed-eff" min="1" max="100" step="1" value="${d.efficiency}"><span class="supply-unit">%</span></span></label>
        </div>
        <div class="feed-editor-sub">${t('feedCustomIngredients')}</div>`;
    d.ingredients.forEach((ing, idx) => {
        html += `<div class="feed-ing-row">
            <select class="feed-input feed-ed-cat" data-idx="${idx}">${FEED_CATEGORIES.map(c => `<option value="${c}" ${ing.category === c ? 'selected' : ''}>${feedCategoryLabel(c)}</option>`).join('')}</select>
            <span class="feed-pct"><input type="number" class="feed-input feed-ed-pct" data-idx="${idx}" min="0" max="100" step="1" value="${ing.pct}"><span class="supply-unit">%</span></span>
            <button type="button" class="note-edit-checklist-remove feed-ed-remove" data-idx="${idx}" title="${t('delete')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>`;
    });
    html += `<button type="button" class="feed-ed-add"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${t('feedCustomAddIng')}</button>
        <p class="feed-ed-sum ${sumState.warn ? 'feed-warn' : ''}">${sumState.text}</p>
        <p class="feed-ed-error feed-warn"></p>
        <div class="feed-editor-actions">
            <button type="button" class="btn btn--primary btn--sm feed-ed-save"><i class="fa-solid fa-check" aria-hidden="true"></i> ${t('feedSave')}</button>
            <button type="button" class="btn btn--secondary btn--sm feed-ed-cancel">${t('notesCancel')}</button>
        </div>
    </div>`;
    return html;
}

// { key: percent } -> the same rounded to 0.1 %, adding up to exactly 100
// (largest remainder), so a list of shares never reads 99.9 % in total.
function sharesTo100(shares) {
    const keys = Object.keys(shares);
    const tenths = keys.map(k => ({ k, raw: shares[k] * 10, n: Math.floor(shares[k] * 10) }));
    let left = 1000 - tenths.reduce((s, x) => s + x.n, 0);
    tenths.slice().sort((a, b) => (b.raw - b.n) - (a.raw - a.n)).forEach(x => { if (left > 0) { x.n++; left--; } });
    return Object.fromEntries(tenths.map(x => [x.k, x.n / 10]));
}

// Shares off 100 by rounding only (99–101 %, e.g. 33 + 33 + 33) are evened
// out once, on the largest ingredient; anything further off is left for the
// validation to reject. Returns a new list — the input is never changed.
const FEED_SUM_ROUNDING = 1;
function feedIngredientsTo100(ingredients) {
    const list = ingredients.map(i => ({ category: i.category, pct: parseFloat(i.pct) || 0 }));
    const sum = list.reduce((s, i) => s + i.pct, 0);
    const diff = 100 - sum;
    if (list.length && Math.abs(diff) > 0.001 && Math.abs(diff) <= FEED_SUM_ROUNDING) {
        const big = list.reduce((a, b) => (b.pct > a.pct ? b : a));
        big.pct = Math.round((big.pct + diff) * 100) / 100;
    }
    return list;
}

// "Total: 99% (must be 100%)" + whether it will be evened out on save.
function feedSumState(ingredients) {
    const sum = ingredients.reduce((s, i) => s + (parseFloat(i.pct) || 0), 0);
    const shown = Math.round(sum * 10) / 10;
    const off = Math.abs(sum - 100);
    let text = t('feedCustomSum').replace('{s}', shown);
    if (off > 0.001 && off <= FEED_SUM_ROUNDING) text += ' ' + t('feedCustomSumRound');
    return { text, warn: off > FEED_SUM_ROUNDING };
}

function validateFeedDraft(d) {
    if (!d.name.trim()) return t('feedErrName');
    if (!d.ingredients.length) return t('feedErrNoIng');
    const cats = d.ingredients.map(i => i.category);
    if (new Set(cats).size !== cats.length) return t('feedErrDuplicate');
    if (d.ingredients.some(i => !(parseFloat(i.pct) > 0))) return t('feedErrPct');
    const sum = d.ingredients.reduce((s, i) => s + (parseFloat(i.pct) || 0), 0);
    if (Math.abs(sum - 100) > 0.01) return t('feedCustomSum').replace('{s}', Math.round(sum * 10) / 10);
    const eff = parseFloat(d.efficiency);
    if (!(eff >= 1 && eff <= 100)) return t('feedErrEfficiency');
    return '';
}

// Inline rename of a feed mixer (same flow as renaming a barn): Enter or
// leaving the field saves, Escape cancels, an empty name restores the one
// from the mod.
function startMixerRename(btn) {
    const wrap = btn.closest('.feed-mixer-name-wrap');
    const nameEl = wrap && wrap.querySelector('.feed-mixer-name');
    if (!nameEl) return;
    const mixerId = btn.dataset.mixer;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'feed-input feed-mixer-name-input';
    input.value = nameEl.textContent;
    input.setAttribute('aria-label', t('feedMixerRename'));
    wrap.replaceChildren(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
        if (done) return;
        done = true;
        const farm = getCurrentFarm();
        const mixer = farm && (farm.feedMixers || []).find(m => m.id === mixerId);
        if (save && farm && mixer) {
            const value = input.value.trim();
            if (!farm.feedMixerNames) farm.feedMixerNames = {};
            if (value && value !== mixer.name) farm.feedMixerNames[mixer.id] = value;
            else delete farm.feedMixerNames[mixer.id];
            saveFarmData(farm);
        }
        rerenderFeedPlan();
    };
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
}

function wireFeedPlanPanel(bodyEl) {
    const update = (fn) => { const farm = getCurrentFarm(); const plan = getFeedPlan(farm); fn(plan); saveFeedPlan(plan); rerenderFeedPlan(); };

    bodyEl.querySelectorAll('.feed-mixer-rename-btn').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        startMixerRename(btn);
    }));

    bodyEl.querySelectorAll('.feed-barn-tile').forEach(el => el.addEventListener('click', () => {
        feedSelectedBuilding = el.dataset.building;
        rerenderFeedPlan();
    }));
    bodyEl.querySelectorAll('.feed-ration-tile[data-ration]').forEach(el => {
        const pick = () => update(p => { setBarnRation(p, feedSelectedBuilding, el.dataset.type, el.dataset.ration); });
        el.addEventListener('click', e => { if (!e.target.closest('.feed-ration-tool')) pick(); });
        if (el.tagName !== 'BUTTON') el.addEventListener('keydown', e => {
            if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(); }
        });
    });
    const tmrBox = bodyEl.querySelector('.tmr-shares');
    if (tmrBox) {
        const readShares = () => Object.fromEntries([...tmrBox.querySelectorAll('.tmr-share-input')].map(i => [i.dataset.cat, parseFloat(i.value) || 0]));
        tmrBox.querySelectorAll('.tmr-share-input').forEach(el => el.addEventListener('change', () => {
            const shares = readShares();
            const sum = Object.values(shares).reduce((s, v) => s + v, 0);
            const sumEl = tmrBox.querySelector('.tmr-shares-sum');
            sumEl.textContent = t('feedCustomSum').replace('{s}', Math.round(sum * 10) / 10);
            sumEl.classList.toggle('is-off', Math.abs(sum - 100) > 0.05);
            const out = MIXER_TMR_CATEGORIES.find(c => shares[c] < TMR_LIMITS[c][0] || shares[c] > TMR_LIMITS[c][1]);
            const error = out
                ? t('tmrSharesOutOfRange').replace('{name}', feedCategoryLabel(out)).replace('{a}', TMR_LIMITS[out][0]).replace('{b}', TMR_LIMITS[out][1])
                : (validTmrShares(shares) ? '' : t('tmrSharesNot100'));
            tmrBox.querySelector('.tmr-shares-error').textContent = error;
            if (!error) update(p => { p.tmr = validTmrShares(shares); });
        }));
        tmrBox.querySelector('.tmr-shares-reset').addEventListener('click', () => update(p => { p.tmr = defaultTmrShares(); }));
    }
    const settings = bodyEl.querySelector('.feed-settings');
    if (settings) settings.addEventListener('toggle', () => { feedSettingsOpen = settings.open; });
    bodyEl.querySelectorAll('.feed-use-select').forEach(el => el.addEventListener('change', () =>
        update(p => { p.fieldUse[el.dataset.key] = el.value; })));
    bodyEl.querySelectorAll('.feed-straw-check').forEach(el => el.addEventListener('change', () =>
        update(p => { if (el.checked) p.strawFields[el.dataset.key] = true; else delete p.strawFields[el.dataset.key]; })));
    bodyEl.querySelectorAll('.feed-param').forEach(el => el.addEventListener('change', () =>
        update(p => { const v = parseFloat(el.value); p[el.dataset.param] = v > 0 ? v : null; })));

    bodyEl.querySelectorAll('.feed-custom-edit').forEach(el => el.addEventListener('click', () => {
        const f = getFeedPlan(getCurrentFarm()).customFeeds.find(x => x.id === el.dataset.id);
        if (!f) return;
        feedEditorDraft = JSON.parse(JSON.stringify(f));
        rerenderFeedPlan();
        const editor = document.querySelector('#hub-view .feed-editor');
        if (editor) editor.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }));
    bodyEl.querySelectorAll('.feed-custom-delete').forEach(el => el.addEventListener('click', async () => {
        const sure = await showConfirm({ title: t('feedCustomDeleteTitle'), body: t('feedCustomDeleteConfirm'), confirmText: t('delete'), danger: true });
        if (sure !== true) return;
        update(p => {
            p.customFeeds = p.customFeeds.filter(f => f.id !== el.dataset.id);
            forgetRation(p, 'custom:' + el.dataset.id);
        });
    }));
    bodyEl.querySelectorAll('.feed-custom-new').forEach(el => el.addEventListener('click', () => {
        feedEditorDraft = { id: null, animalType: el.dataset.type || 'COW', name: '', efficiency: 100, ingredients: [{ category: 'HAY', pct: 100 }] };
        rerenderFeedPlan();
    }));

    const editor = bodyEl.querySelector('.feed-editor');
    if (!editor || !feedEditorDraft) return;
    const d = feedEditorDraft;
    const refreshSum = () => {
        const state = feedSumState(d.ingredients);
        const el = editor.querySelector('.feed-ed-sum');
        el.textContent = state.text;
        el.classList.toggle('feed-warn', state.warn);
    };
    editor.querySelector('.feed-ed-name').addEventListener('input', e => { d.name = e.target.value; });
    editor.querySelector('.feed-ed-type').addEventListener('change', e => { d.animalType = e.target.value; });
    editor.querySelector('.feed-ed-eff').addEventListener('input', e => { d.efficiency = parseFloat(e.target.value) || 0; });
    editor.querySelectorAll('.feed-ed-cat').forEach(el => el.addEventListener('change', () => { d.ingredients[el.dataset.idx].category = el.value; }));
    editor.querySelectorAll('.feed-ed-pct').forEach(el => el.addEventListener('input', () => { d.ingredients[el.dataset.idx].pct = parseFloat(el.value) || 0; refreshSum(); }));
    editor.querySelectorAll('.feed-ed-remove').forEach(el => el.addEventListener('click', () => { d.ingredients.splice(el.dataset.idx, 1); rerenderFeedPlan(); }));
    editor.querySelector('.feed-ed-add').addEventListener('click', () => {
        const unused = FEED_CATEGORIES.find(c => !d.ingredients.some(i => i.category === c)) || FEED_CATEGORIES[0];
        d.ingredients.push({ category: unused, pct: 0 });
        rerenderFeedPlan();
    });
    editor.querySelector('.feed-ed-cancel').addEventListener('click', () => { feedEditorDraft = null; rerenderFeedPlan(); });
    editor.querySelector('.feed-ed-save').addEventListener('click', () => {
        // Rounded to 100 on a copy, so the draft (and its inputs) keep what you typed.
        const ingredients = feedIngredientsTo100(d.ingredients);
        const err = validateFeedDraft({ ...d, ingredients });
        if (err) { editor.querySelector('.feed-ed-error').textContent = err; return; }
        const feed = {
            id: d.id || ('f' + Date.now().toString(36)),
            animalType: d.animalType,
            name: d.name.trim(),
            efficiency: Math.round(parseFloat(d.efficiency)),
            ingredients
        };
        feedEditorDraft = null;
        update(p => {
            const idx = p.customFeeds.findIndex(f => f.id === feed.id);
            if (idx >= 0) {
                // Species changed: a ration pointing at it for the old species no longer applies.
                const old = p.customFeeds[idx];
                if (old.animalType !== feed.animalType) forgetRation(p, 'custom:' + feed.id, old.animalType);
                p.customFeeds[idx] = feed;
            } else {
                p.customFeeds.push(feed);
            }
        });
    });
}


// --- Breed norms (Animals view) ----------------------------------------------
// Read-only: what one breed eats and gives per in-game month at a given age,
// and for a herd you type in — the same curves and scales the planner uses
// (ANIMAL_NEEDS_DATA, AnimalFoodCalculator's consumption scale for food,
// water and straw, the barn's ration for milk, eggs and wool). EAS lactation
// isn't in it: it depends on when each animal calved.
let breedNormsState = { subType: null, count: 1, age: 24 };
let breedNormsOpen = false;

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

// Food (and the main product) over the breed's age range, with a marker at `age`.
function breedNormsCurveHtml(subType, age) {
    const def = ANIMAL_NEEDS_DATA[subType] || {};
    const main = Object.keys(def.production || {}).find(ft => !FEED_UNSCALED_OUTPUT.includes(ft));
    const lines = [{ label: t('breedNorm_food'), curve: def.food, cls: 'breed-curve-food' }];
    if (main) lines.push({ label: formatFillType(main), curve: def.production[main], cls: 'breed-curve-out' });
    const keys = lines.flatMap(l => (l.curve || []).map(p => p.ageMonth));
    if (!keys.length) return '';
    const maxAge = Math.max(1, ...keys, age);
    const W = 320, H = 90, P = 4;
    const x = a => P + (Math.max(0, Math.min(a, maxAge)) / maxAge) * (W - 2 * P);
    let svg = '';
    lines.forEach(l => {
        if (!l.curve || !l.curve.length) return;
        const top = Math.max(...l.curve.map(p => p.value)) || 1;
        const y = v => H - P - (v / top) * (H - 2 * P);
        const pts = [];
        for (let i = 0; i <= 60; i++) {
            const a = maxAge * i / 60;
            pts.push(`${x(a).toFixed(1)},${y(interpolateNeedCurve(l.curve, a)).toFixed(1)}`);
        }
        svg += `<polyline class="${l.cls}" points="${pts.join(' ')}"/>`;
    });
    svg += `<line class="breed-curve-marker" x1="${x(age).toFixed(1)}" x2="${x(age).toFixed(1)}" y1="0" y2="${H}"/>`;
    const legend = lines.filter(l => l.curve && l.curve.length)
        .map(l => `<span class="breed-curve-key ${l.cls}">${escapeHtml(l.label)}</span>`).join('');
    return `<figure class="breed-curve-wrap">
        <svg class="breed-curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>
        <figcaption>${legend}<span class="breed-curve-axis">${t('breedNormsAxis').replace('{max}', Math.round(maxAge))}</span></figcaption>
    </figure>`;
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
        <div class="breed-norms-side">
            ${pic ? `<span class="animal-pic breed-norms-pic"><img src="${escapeHtml(pic)}" alt="" draggable="false"></span>` : ''}
            ${breedNormsCurveHtml(st.subType, st.age)}
        </div>
        <table class="data-table supply-table breed-norms-table"><thead><tr>
            <th></th><th>${t('breedNormsPerHead')}</th><th>${t('breedNormsHerd').replace('{n}', st.count.toLocaleString(FIN_LOCALE()))}</th>
        </tr></thead><tbody>
            ${head(t('breedNormsNeeds'), false)}
            ${head(t('breedNormsGives'), true)}
        </tbody></table>
    </div>
    <ul class="breed-norms-notes">${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`;
}

function breedNormsHtml(farm) {
    const { own, rest } = breedNormsBreeds(farm);
    if (!own.length && !rest.length) return '';
    if (!ANIMAL_NEEDS_DATA[breedNormsState.subType]) breedNormsState = breedNormsDefaults(farm, own[0] || rest[0]);
    const st = breedNormsState;
    const opt = s => `<option value="${escapeHtml(s)}" ${s === st.subType ? 'selected' : ''}>${escapeHtml(formatAnimalName(s))}</option>`;
    const options = (own.length ? `<optgroup label="${escapeHtml(t('breedNormsInBarns'))}">${own.map(opt).join('')}</optgroup>` : '')
        + (rest.length ? `<optgroup label="${escapeHtml(t('breedNormsAllBreeds'))}">${rest.map(opt).join('')}</optgroup>` : '');
    return `<details class="breed-norms"${breedNormsOpen ? ' open' : ''}>
        <summary class="anim-section-title">${t('breedNormsTitle')}</summary>
        <p class="supply-intro">${t('breedNormsIntro')}</p>
        <div class="breed-norms-controls">
            <label class="settings-field"><span>${t('breedNormsBreed')}</span><select class="breed-norms-breed">${options}</select></label>
            <label class="settings-field"><span>${t('breedNormsCount')}</span><input type="number" class="breed-norms-count" min="1" max="100000" step="1" value="${st.count}"></label>
            <label class="settings-field"><span>${t('breedNormsAge')}</span><input type="number" class="breed-norms-age" min="0" max="600" step="1" value="${st.age}"></label>
        </div>
        <div class="breed-norms-result">${breedNormsResultHtml(farm)}</div>
    </details>`;
}

// Only the result is redrawn while typing, so the inputs keep focus.
function wireBreedNorms(root, farm) {
    const box = root.querySelector('.breed-norms');
    if (!box) return;
    box.addEventListener('toggle', () => { breedNormsOpen = box.open; });
    const result = box.querySelector('.breed-norms-result');
    const redraw = () => { result.innerHTML = breedNormsResultHtml(farm); };
    box.querySelector('.breed-norms-breed').addEventListener('change', e => {
        breedNormsState = breedNormsDefaults(farm, e.target.value);
        box.querySelector('.breed-norms-count').value = breedNormsState.count;
        box.querySelector('.breed-norms-age').value = breedNormsState.age;
        redraw();
    });
    const watch = (el, min, max, key) => el.addEventListener('input', () => {
        const v = parseInt(el.value, 10);
        if (isNaN(v)) return;
        breedNormsState[key] = Math.min(max, Math.max(min, v));
        redraw();
    });
    watch(box.querySelector('.breed-norms-count'), 1, 100000, 'count');
    watch(box.querySelector('.breed-norms-age'), 0, 600, 'age');
}
