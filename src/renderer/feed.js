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
// sum to 1.05 in the game file and are normalized here).
const ANIMAL_FOOD_GROUPS = {
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
const TMR_LIMITS = { HAY: [20, 75], SILAGE: [20, 75], STRAW: [0, 30], MINERAL: [0, 7] };
const TMR_DEFAULT = { HAY: 40, SILAGE: 40, STRAW: 15, MINERAL: 5 };

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
// Calendar days in an in-game year — for "how many days does this last".
function feedDaysPerYear(farm) {
    return FEED_PERIODS_PER_YEAR * feedDaysPerPeriod(farm);
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
// Multiplier from a monthly curve value to a year's worth.
function feedYearFactor(farm) {
    return FEED_PERIODS_PER_YEAR * feedConsumptionScale(farm);
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
        // Fixed to the game's default recipe — it's no longer editable, so an
        // older saved recipe is ignored.
        tmr: { ...TMR_DEFAULT },
        fieldUse: { ...(saved.fieldUse || {}) },
        strawFields: { ...(saved.strawFields || {}) },
        grassCuts: parseFloat(saved.grassCuts) > 0 ? parseFloat(saved.grassCuts) : 3,
        chaffYield: parseFloat(saved.chaffYield) > 0 ? parseFloat(saved.chaffYield) : Math.round((cropAgronomy('Maize', 'yield') || 9200) * 4),
        strawYield: parseFloat(saved.strawYield) > 0 ? parseFloat(saved.strawYield) : null,
        mixer: normalizeMixerPlan(saved.mixer)
    };
}

// Mixer wagon ("paszowóz") settings kept in the feed plan: the chosen wagon,
// wagons and bale types the player added by hand, capacities typed in for
// wagons whose file we couldn't read, and the current load.
function normalizeMixerPlan(m) {
    m = (m && typeof m === 'object') ? m : {};
    return {
        selected: m.selected || null,
        custom: Array.isArray(m.custom) ? m.custom : [],
        capacity: { ...(m.capacity || {}) },
        customBales: Array.isArray(m.customBales) ? m.customBales : [],
        load: Array.isArray(m.load) ? m.load : []
    };
}

function saveFeedPlan(plan) {
    const farm = getCurrentFarm();
    if (!farm) return;
    farm.feedPlan = plan;
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
    return builtIn + mixers + (custom ? `<optgroup label="${t('feedCustomGroup')}">${custom}</optgroup>` : '');
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
        : ANIMAL_FOOD_GROUPS[type].mix.ingredients;
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
    const yearFactor = feedYearFactor(farm);
    ((farm && farm.animalBuildings) || []).forEach(b => (b.clusters || []).forEach(c => {
        const type = animalTypeOf(c.subType);
        if (!type || !ANIMAL_NEEDS_DATA[c.subType]) { unknownSubTypes++; return; }
        const s = bySpecies[type] || (bySpecies[type] = { head: 0, food: 0, straw: 0 });
        const food = clusterDailyFood(farm, type, c) * yearFactor;
        s.head += c.numAnimals;
        s.food += food;
        s.straw += clusterDailyNeed(c, 'straw') * yearFactor;
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
            const perCut = area * (getCropYieldRate(crop) || 0) * fieldYieldFactor(getFieldSoilMix(fertPlanSoilKey(f, i), rates));
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
        const factor = fieldYieldFactor(getFieldSoilMix(fertPlanSoilKey(f, i), rates));

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

// Feed mixers the player owns: placeables (farmId 1) with a productionPoint
// whose recipes output a feed (FEED_PRODUCT_FILLTYPES) — e.g. FoodMixerSilo,
// SmallFoodMixer, Lizard Mixed Food. Recipes, throughput and capacity come
// from the placeable's own XML in its mod; which recipes are switched on and
// what's in storage from placeables.xml. Base-game placeables live in the
// game's archives and can't be read, so only mod mixers are found.
// Production rates: cyclesPerMonth, or legacy cyclesPerHour x 24 (the game
// converts it the same way), so output per in-game month.
// Text read from a mod's XML (shop names) goes into the UI's HTML — drop
// markup characters so a mod can't inject HTML (the renderer has Node access).
function plainModText(s) {
    return String(s || '').replace(/[<>"'`]/g, '');
}

function readFeedMixersFromSave(saveFolder, modsDirs) {
    const p = path.join(saveFolder, 'placeables.xml');
    if (!fs.existsSync(p)) return [];
    const doc = new DOMParser().parseFromString(fs.readFileSync(p, 'utf-8'), 'text/xml');
    if (doc.querySelector('parsererror')) return [];
    const up = s => String(s || '').toUpperCase();
    const defCache = {};
    const l10nCache = {};
    const mixers = [];
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
        if (!def) return;
        const recipes = [...def.querySelectorAll('productionPoint productions > production')].map(pr => {
            const perMonth = parseFloat(pr.getAttribute('cyclesPerMonth')) || (parseFloat(pr.getAttribute('cyclesPerHour')) || 0) * 24;
            const items = sel => [...pr.querySelectorAll(sel)].map(i => ({ fillType: up(i.getAttribute('fillType')), amount: parseFloat(i.getAttribute('amount')) || 0 }));
            return { id: pr.getAttribute('id') || '', inputs: items('inputs > input'), outputs: items('outputs > output'), cyclesPerMonth: perMonth };
        });
        const feedRecipes = recipes.filter(r => r.outputs.some(o => FEED_PRODUCT_FILLTYPES.includes(o.fillType)));
        if (!feedRecipes.length) return;

        const enabled = {};
        saved.querySelectorAll(':scope > production').forEach(pr => { enabled[pr.getAttribute('id')] = pr.getAttribute('isEnabled') === 'true'; });
        feedRecipes.forEach(r => { r.enabled = enabled[r.id] !== undefined ? enabled[r.id] : false; });

        const stock = {};
        saved.querySelectorAll(':scope > storage > node[fillType]').forEach(n => {
            const lvl = parseFloat(n.getAttribute('fillLevel'));
            if (lvl > 0) stock[up(n.getAttribute('fillType'))] = (stock[up(n.getAttribute('fillType'))] || 0) + lvl;
        });
        const capacity = {};
        const storageDef = def.querySelector('productionPoint > storage');
        if (storageDef) {
            const all = parseFloat(storageDef.getAttribute('capacity')) || null;
            storageDef.querySelectorAll(':scope > capacity[fillType]').forEach(c => { capacity[up(c.getAttribute('fillType'))] = parseFloat(c.getAttribute('capacity')) || all; });
            capacity._default = all;
        }

        const nameEl = def.querySelector('storeData > name');
        const rawName = plainModText(nameEl ? (nameEl.querySelector('en') || nameEl).textContent.trim() : '');
        const products = [...new Set(feedRecipes.flatMap(r => r.outputs.map(o => o.fillType)).filter(ft => FEED_PRODUCT_FILLTYPES.includes(ft)))];

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
        feedRecipes.forEach(r => [...r.inputs, ...r.outputs].forEach(({ fillType }) => {
            // Else drop trailing "_PART"s: DRYTEFFGRASS_WINDROW -> dryTeffGrass,
            // CEREALPROTEICO_TRITURADO -> cerealProteico.
            let name = fillType, t2 = null;
            while (!(t2 = titleOf('fillType_' + name)) && name.includes('_')) name = name.replace(/_[^_]*$/, '');
            if (t2) fillTypeTitles[fillType] = t2;
        }));
        const l10nName = rawName.startsWith('$l10n_') ? titleOf(rawName.slice(6)) : null;
        mixers.push({
            id: pl.getAttribute('uniqueId') || filename,
            name: rawName && !rawName.startsWith('$') ? rawName
                : (l10nName && (l10nName.en || Object.values(l10nName)[0])) || filename.replace(/\\/g, '/').split('/').pop().replace(/\.xml$/i, ''),
            nameTitles: l10nName || null,
            fillTypeTitles,
            mod: pl.getAttribute('modName') || '',
            products,
            recipes: feedRecipes,
            stock,
            capacity
        });
    });
    return mixers;
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
// bedding), plus head count per species.
function buildBarnFeedNeed(building, plan, farm) {
    const yearFactor = feedYearFactor(farm);
    const byCategory = {};
    const heads = {};
    let food = 0, bedding = 0;
    (building.clusters || []).forEach(c => {
        const type = animalTypeOf(c.subType);
        if (!type) return;
        heads[type] = (heads[type] || 0) + c.numAnimals;
        if (!ANIMAL_NEEDS_DATA[c.subType]) return;
        const ration = resolveRation(type, plan, building.id);
        const f = clusterDailyFood(farm, type, c) * yearFactor;
        const b = clusterDailyNeed(c, 'straw') * yearFactor;
        food += f;
        bedding += b;
        if (ration) splitByRecipe(f, ration, byCategory);
        byCategory.STRAW = (byCategory.STRAW || 0) + b;
    });
    return { byCategory, heads, food, bedding };
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
        status = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${t('feedMissing')} ${num(-diff)} l ${ha}`;
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
                html += `<button type="button" class="feed-ration-tile ${current === id ? 'feed-ration-tile--active' : ''}" data-type="${type}" data-ration="${id}">
                    <span class="feed-ration-name"><i class="fa-solid fa-flask" aria-hidden="true"></i> ${escapeHtml(f.name)}</span><span class="feed-ration-eff">${f.efficiency}%</span></button>`;
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

        // --- 2b. Mixer wagon, for barns fed TMR (the only thing a mixer makes) ---
        const barnUsesTmr = Object.keys(barnNeed.heads).some(type => { const r = resolveRation(type, plan, barn.id); return r && r.tmr; });
        if (barnUsesTmr) html += renderMixerSection(farm, plan, barnNeed, num);

        // --- 3. Ingredient tiles ---
        const cats = FEED_CATEGORIES.filter(c => c !== 'STRAW' && barnNeed.byCategory[c] > 0);
        if (barnNeed.byCategory.STRAW > 0) cats.push('STRAW');
        html += `<div class="hub-panel-subtitle">${t('feedIngredients')}</div>`;
        if (barnNeed.food > 0 || barnNeed.bedding > 0) {
            html += `<div class="feed-need-summary">
                <div class="feed-need-item"><span class="feed-need-label">${t('feedYearNeedFood')}</span><span class="feed-need-value">${num(barnNeed.food)} l</span></div>
                ${barnNeed.bedding > 0 ? `<div class="feed-need-item"><span class="feed-need-label">${t('feedStrawBedding')}</span><span class="feed-need-value">${num(barnNeed.bedding)} l</span></div>` : ''}
                <div class="feed-need-item"><span class="feed-need-label">${t('feedYearNeedMonth')}</span><span class="feed-need-value">${num(barnNeed.food / FEED_PERIODS_PER_YEAR)} l</span><span class="feed-need-label">${feedScaleNote(farm)}</span></div>
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
        html += `<table class="supply-table feed-table"><thead><tr>
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
// Load the wagon from bales (whole or halves) and loose products and check
// the result against the TMR recipe the game's mixer needs.
const MIXER_TMR_CATEGORIES = Object.keys(TMR_LIMITS);
// Which inline form is open: null | 'wagon' | 'bale'.
let mixerFormOpen = null;

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
    // A loaded bale type the farm has run out of (key "round125|DRYCLOVER_WINDROW|4500")
    // stays pickable with 0 on the farm — otherwise its row showed the first
    // bale in the list and counted 0 l.
    const known = new Set([...onFarm, ...own].map(b => b.key));
    const gone = [];
    plan.mixer.load.forEach(item => {
        if (item.kind !== 'bale' || known.has(item.baleKey) || String(item.baleKey).startsWith('custom:')) return;
        const [size, fillType, litres] = String(item.baleKey).split('|');
        const category = FEED_FILLTYPE_CATEGORY[fillType];
        if (!category || !(parseFloat(litres) > 0)) return;
        known.add(item.baleKey);
        gone.push({ key: item.baleKey, label: baleSizeLabel(size), fillType, category, litres: parseFloat(litres), count: 0 });
    });
    return [...onFarm, ...own, ...gone];
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
    plan.mixer.load.forEach(item => {
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

// Fills the wagon to the TMR recipe. Ingredients you have bales of go in as
// bales rounded to the nearest half (never more than the farm has); the
// rest (e.g. mineral feed) goes in loose. If rounding overfills the wagon,
// half bales come off wherever the load overshoots its target the most.
// Optional ingredients (0 % allowed, e.g. mineral feed) the farm has none of
// are left out and the rest of the recipe fills their share.
function mixerAutoLoad(plan, wagon, baleTypes, farm) {
    const stock = mixerStockByCategory(farm);
    const used = MIXER_TMR_CATEGORIES.filter(c => TMR_LIMITS[c][0] > 0 || stock[c] > 0 || baleTypes.some(b => b.category === c && b.count !== 0));
    const share = c => used.includes(c) ? (parseFloat(plan.tmr[c]) || 0) : 0;
    const recipeSum = MIXER_TMR_CATEGORIES.reduce((s, c) => s + share(c), 0) || 100;
    const target = {};
    const baleLoads = [];   // { category, item, litres }
    const load = [];
    MIXER_TMR_CATEGORIES.forEach(c => {
        target[c] = wagon.capacity * share(c) / recipeSum;
        if (target[c] <= 0) return;
        let left = target[c];
        const bales = baleTypes.filter(b => b.category === c && b.litres > 0)
            .sort((a, b) => (b.count || 0) - (a.count || 0) || b.litres - a.litres);
        for (const b of bales) {
            let n = Math.round(left / b.litres * 2) / 2;
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
        candidates[0].item.count -= 0.5;
    }
    return load.filter(i => i.kind === 'bulk' || i.count > 0);
}

// Litres on the farm per feed category (silos, bales, pallets from the save).
function mixerStockByCategory(farm) {
    const out = {};
    Object.entries((farm && farm.feedStock) || {}).forEach(([fillType, where]) => {
        const cat = FEED_FILLTYPE_CATEGORY[fillType];
        if (!cat) return;
        out[cat] = (out[cat] || 0) + Object.values(where || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    });
    return out;
}

function renderMixerSection(farm, plan, barnNeed, num) {
    const wagons = mixerWagons(farm, plan);
    const wagon = selectedMixerWagon(farm, plan);
    plan.mixer.selected = wagon ? wagon.id : null;
    const baleTypes = mixerBaleTypes(farm, plan);

    let html = `<div class="hub-panel-subtitle">${t('mixerTitle')}</div><div class="mixer">`;

    // --- Wagon picker ---
    html += `<div class="mixer-wagons">`;
    wagons.forEach(w => {
        html += `<div class="mixer-wagon-tile ${w.id === plan.mixer.selected ? 'mixer-wagon-tile--active' : ''}" role="button" tabindex="0" data-id="${escapeHtml(w.id)}">
            <span class="mixer-wagon-icon" aria-hidden="true"><i class="fa-solid fa-truck-ramp-box" aria-hidden="true"></i></span>
            <span class="mixer-wagon-text">
                <span class="mixer-wagon-name">${escapeHtml(w.name)}</span>
                <span class="mixer-wagon-meta">${w.capacity ? num(w.capacity) + ' l' : t('mixerNoCapacity')} · ${t(w.source === 'save' ? 'mixerFromSave' : 'mixerOwn')}</span>
            </span>
            ${w.source === 'custom' ? `<button type="button" class="note-card-action note-card-action--danger mixer-wagon-delete" data-id="${escapeHtml(w.id)}" title="${t('delete')}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>` : ''}
        </div>`;
    });
    html += `<button type="button" class="mixer-add-btn mixer-new-wagon"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${t('mixerNewWagon')}</button></div>`;

    if (mixerFormOpen === 'wagon') {
        html += `<div class="mixer-form">
            <label>${t('mixerWagonName')}<input type="text" class="feed-input mixer-f-name" placeholder="${t('mixerWagonNamePh')}"></label>
            <label>${t('mixerCapacity')}<span class="feed-pct"><input type="number" class="feed-input mixer-f-cap" min="100" step="100" placeholder="10000"><span class="supply-unit">l</span></span></label>
            <button type="button" class="supply-fillplan-btn mixer-f-save-wagon"><i class="fa-solid fa-check" aria-hidden="true"></i> ${t('notesSave')}</button>
            <button type="button" class="supply-reset-btn mixer-f-cancel">${t('notesCancel')}</button>
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
        if (!plan.mixer.load.length) html += `<p class="barn-empty">${t('mixerLoadEmpty')}</p>`;
        plan.mixer.load.forEach((item, idx) => {
            if (item.kind === 'bale') {
                const b = baleTypes.find(x => x.key === item.baleKey);
                const litres = b ? b.litres * (parseFloat(item.count) || 0) : 0;
                const tooMany = b && b.count !== null && item.count > b.count;
                html += `<div class="mixer-row">
                    <span class="mixer-row-icon" aria-hidden="true"><i class="fa-solid fa-circle-dot" aria-hidden="true"></i></span>
                    <select class="feed-input mixer-bale-select" data-idx="${idx}">
                        ${b ? '' : '<option value="" selected disabled>—</option>'}
                        ${baleTypes.map(x => `<option value="${escapeHtml(x.key)}" ${x.key === item.baleKey ? 'selected' : ''}>${escapeHtml(baleTypeLabel(x))}${x.count !== null ? ` (${t('mixerOnFarm').replace('{n}', x.count)})` : ''}</option>`).join('')}
                    </select>
                    <span class="mixer-qty">
                        <button type="button" class="mixer-step" data-idx="${idx}" data-step="-0.5" aria-label="-½">−</button>
                        <input type="number" class="feed-input mixer-count" data-idx="${idx}" min="0" step="0.5" value="${item.count}">
                        <button type="button" class="mixer-step" data-idx="${idx}" data-step="0.5" aria-label="+½">+</button>
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
            ${plan.mixer.load.length ? `<button type="button" class="supply-reset-btn mixer-clear">${t('mixerClear')}</button>` : ''}
        </div>`;
        if (!baleTypes.length) html += `<p class="barn-empty">${t('mixerNoBales')}</p>`;
        if (mixerFormOpen === 'bale') {
            html += `<div class="mixer-form">
                <label>${t('mixerBaleName')}<input type="text" class="feed-input mixer-f-bname" placeholder="${t('mixerBaleNamePh')}"></label>
                <label>${t('mixerBaleContent')}<select class="feed-input mixer-f-bcat">${MIXER_TMR_CATEGORIES.map(c => `<option value="${c}">${feedCategoryLabel(c)}</option>`).join('')}</select></label>
                <label>${t('mixerBaleLitres')}<span class="feed-pct"><input type="number" class="feed-input mixer-f-blitres" min="1" step="50" placeholder="4000"><span class="supply-unit">l</span></span></label>
                <button type="button" class="supply-fillplan-btn mixer-f-save-bale"><i class="fa-solid fa-check" aria-hidden="true"></i> ${t('notesSave')}</button>
                <button type="button" class="supply-reset-btn mixer-f-cancel">${t('notesCancel')}</button>
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
            const recipeSum = MIXER_TMR_CATEGORIES.reduce((s, c) => s + (parseFloat(plan.tmr[c]) || 0), 0) || 100;
            const problems = [];
            // Shares rounded to 0.1 % so the shown figures add up to exactly 100.
            const shownPct = sharesTo100(Object.fromEntries(Object.entries(totals.byCategory).map(([c, l]) => [c, l / totals.total * 100])));
            html += `<div class="mixer-mix">`;
            MIXER_TMR_CATEGORIES.forEach(c => {
                const litres = totals.byCategory[c] || 0;
                const pct = litres / totals.total * 100;
                const [min, max] = TMR_LIMITS[c];
                const target = (parseFloat(plan.tmr[c]) || 0) / recipeSum * 100;
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

            const daily = barnNeed.food / feedDaysPerYear(farm);
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
        if (e.target.closest('.mixer-wagon-delete')) return;
        update(plan => { plan.mixer.selected = el.dataset.id; });
    });
    on('.mixer-wagon-tile', 'keydown', (el, e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        update(plan => { plan.mixer.selected = el.dataset.id; });
    });
    on('.mixer-wagon-delete', 'click', (el, e) => {
        e.stopPropagation();
        update(plan => { plan.mixer.custom = plan.mixer.custom.filter(w => w.id !== el.dataset.id); });
    });
    on('.mixer-new-wagon', 'click', () => { mixerFormOpen = 'wagon'; rerenderFeedPlan(); });
    on('.mixer-new-bale', 'click', () => { mixerFormOpen = 'bale'; rerenderFeedPlan(); });
    on('.mixer-f-cancel', 'click', () => { mixerFormOpen = null; rerenderFeedPlan(); });
    on('.mixer-f-save-wagon', 'click', () => {
        const name = (root.querySelector('.mixer-f-name').value || '').trim();
        const cap = parseFloat(root.querySelector('.mixer-f-cap').value);
        if (!name || !(cap > 0)) return;
        mixerFormOpen = null;
        update(plan => {
            const id = 'custom:' + Date.now().toString(36);
            plan.mixer.custom.push({ id, name, capacity: cap });
            plan.mixer.selected = id;
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
            plan.mixer.load.push({ kind: 'bale', baleKey: 'custom:' + id, count: 1 });
        });
    });
    on('.mixer-own-bale-del', 'click', (el) => update(plan => {
        plan.mixer.customBales = plan.mixer.customBales.filter(b => b.id !== el.dataset.id);
        plan.mixer.load = plan.mixer.load.filter(i => i.baleKey !== 'custom:' + el.dataset.id);
    }));
    on('.mixer-cap-input', 'change', (el) => {
        const cap = parseFloat(el.value);
        if (cap > 0) update(plan => { plan.mixer.capacity[el.dataset.id] = cap; });
    });

    on('.mixer-add-bale', 'click', () => update(plan => {
        const types = mixerBaleTypes(getCurrentFarm(), plan);
        if (types.length) plan.mixer.load.push({ kind: 'bale', baleKey: types[0].key, count: 1 });
    }));
    on('.mixer-add-bulk', 'click', () => update(plan => { plan.mixer.load.push({ kind: 'bulk', category: 'MINERAL', litres: 500 }); }));
    on('.mixer-remove', 'click', (el) => update(plan => { plan.mixer.load.splice(idx(el), 1); }));
    on('.mixer-clear', 'click', () => update(plan => { plan.mixer.load = []; }));
    on('.mixer-bale-select', 'change', (el) => update(plan => { plan.mixer.load[idx(el)].baleKey = el.value; }));
    on('.mixer-bulk-cat', 'change', (el) => update(plan => { plan.mixer.load[idx(el)].category = el.value; }));
    on('.mixer-bulk-litres', 'change', (el) => update(plan => { plan.mixer.load[idx(el)].litres = Math.max(0, parseFloat(el.value) || 0); }));
    // Bales go in whole or in halves.
    on('.mixer-count', 'change', (el) => update(plan => { plan.mixer.load[idx(el)].count = Math.max(0, Math.round((parseFloat(el.value) || 0) * 2) / 2); }));
    on('.mixer-step', 'click', (el) => update(plan => {
        const item = plan.mixer.load[idx(el)];
        item.count = Math.max(0, Math.round(((parseFloat(item.count) || 0) + parseFloat(el.dataset.step)) * 2) / 2);
    }));
    on('.mixer-auto', 'click', () => update(plan => {
        const farm = getCurrentFarm();
        const wagon = selectedMixerWagon(farm, plan);
        if (wagon && wagon.capacity) plan.mixer.load = mixerAutoLoad(plan, wagon, mixerBaleTypes(farm, plan), farm);
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
            <button type="button" class="supply-fillplan-btn feed-ed-save"><i class="fa-solid fa-check" aria-hidden="true"></i> ${t('notesSave')}</button>
            <button type="button" class="supply-reset-btn feed-ed-cancel">${t('notesCancel')}</button>
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
    bodyEl.querySelectorAll('.feed-ration-tile[data-ration]').forEach(el => el.addEventListener('click', () =>
        update(p => { setBarnRation(p, feedSelectedBuilding, el.dataset.type, el.dataset.ration); })));
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

