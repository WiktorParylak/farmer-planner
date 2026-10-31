// Developer test farm, built from scratch (not copied from a real savegame).
// Turned on in the app settings when the app runs from the repo (npm start).
// It is meant to show every state the planner has in one place:
//   fields   — sow now / overdue / planted / empty row, a field shared by two
//              crops with hectares left unassigned, a catch crop, grassland
//              with cuts, two leases (return / buy), a field with an empty work
//              list, every lime state (limed this season with an undo history,
//              limed earlier, low pH, never limed, a crop that takes no lime),
//              a no-till field the game wants ploughed (ploughing required);
//   animals  — five barns: cows (lactating, pregnant, heifers, calves), pigs
//              short of grain, an empty chicken coop, sheep and goats with low
//              health, horses; troughs with and without a capacity entered;
//   feed     — stock in every source, bales, two mixer wagons (one without a
//              capacity);
//   history  — two archived seasons and 32 in-game months for the charts;
//   notes    — this month, several months, checklist, no checklist;
//   weather  — rain later today;
//   market   — price curves for its crops and inputs, three great demands;
//   rotation — three cycles, a field on its cycle, one off it, grassland in
//              its last season, an empty field the cycle fills in.
// No savegame path, so nothing is ever synced over it.

const DEV_FARM_ID = '1000000000001';

// period -> month, same order as FS_PERIOD_TO_MONTH in renderer.js
const DEV_MONTHS = ["MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER", "JANUARY", "FEBRUARY"];

const DEV_YEAR = 3;
const DEV_MONTH_INDEX = 7;   // OCTOBER
const DEV_SEASON = 3;

function devField(number, area, crop, sowingMonth, state, tillage, extra) {
    return {
        number, area: area.toFixed(2), crop, sowingMonth,
        rolling: false, catchCrop: "", catchSowingMonth: "",
        state, tillage,
        limeAppliedSeason: null, limePh: null,
        cuts: [], manure: false, fertilizer: false,
        ...extra
    };
}

function devCluster(subType, numAnimals, age, health, extra) {
    return {
        subType, numAnimals, age, health,
        reproduction: 0, isInseminated: false, monthsSinceLastBirth: 0, hadABirth: false,
        ...extra
    };
}

function devFields() {
    return [
        // Sow now; limed this season over an older liming, so "Undo liming" brings season 1 back.
        devField("1", 5.2, "Wheat", "OCTOBER", "To Plant", "plowed", {
            rotation: { id: "rot_dev_norfolk", step: 0, stepSeason: 1 },
            limeAppliedSeason: DEV_SEASON, limePh: 1, limePrev: { season: 1, ph: 0.62 },
            work: [{ step: "harvest", done: true }, { step: "plow", done: true }, { step: "lime", done: true },
                { step: "sow", done: false }, { step: "fertilize", done: false }]
        }),
        // Sowing month already passed; never limed; weeds marked, but not sown yet,
        // so "What to do today" doesn't list them. Off its rotation: the cycle wants wheat after canola.
        devField("2", 3.4, "Barley", "SEPTEMBER", "To Plant", null, { weeds: "needed", rotation: { id: "rot_dev_canola", step: 1, stepSeason: 1 } }),
        // Two farmlands in one field; planted, rolled, fertilized.
        devField("3-4", 7.8, "Canola", "AUGUST", "Planted", "noTill", {
            limeAppliedSeason: 2, limePh: 0.85, fertilizer: true, rolling: true, rollingDone: true,
            rotation: { id: "rot_dev_canola", step: 0, stepSeason: 1 }
        }),
        // One field of 5 ha shared by two crops, 0.5 ha left unassigned; the first has a catch crop.
        devField("5", 2.0, "Soybean", "APRIL", "To Plant", "noTill", {
            limeAppliedSeason: 2, limePh: 0.9, catchCrop: "Oilseedradish", catchSowingMonth: "SEPTEMBER"
        }),
        devField("5", 2.5, "Maize", "APRIL", "To Plant", "plowed", { limeAppliedSeason: 2, limePh: 0.9, manure: true }),
        // Grassland: two cuts taken, the third still to do.
        devField("6", 4.0, "Grass", "MARCH", "Planted", null, {
            limeAppliedSeason: DEV_SEASON, limePh: 1, fertilizer: true,
            rotation: { id: "rot_dev_dairy", step: 1, stepSeason: 3 },
            cuts: [
                { month: "MAY", use: "silage", harvested: true, fertilized: true, limed: false, rolled: true },
                { month: "JULY", use: "hay", harvested: true, fertilized: false, limed: false, rolled: false },
                { month: "SEPTEMBER", use: "hay", harvested: false, fertilized: false, limed: false, rolled: false }
            ]
        }),
        // Leases: one ends and goes back, one is bought at the end.
        devField("7", 1.2, "Potato", "APRIL", "To Plant", "plowed", {
            limeAppliedSeason: 1, limePh: 0.7, lease: { since: 1, seasons: 3, then: "return" }
        }),
        devField("8", 2.9, "Sugarbeet", "APRIL", "To Plant", "plowed", {
            lease: { since: DEV_SEASON, seasons: 5, then: "buy" }
        }),
        // A crop that takes no lime.
        devField("9", 0.6, "Rice", "MAY", "To Plant", null, {}),
        // Big field with the work list cleared on purpose ("No work").
        devField("10-11-12", 12.4, "Maize", "APRIL", "To Plant", "plowed", {
            limeAppliedSeason: 2, limePh: 0.95, manure: true, work: []
        }),
        // Low pH from an old liming.
        devField("13", 0.85, "Sunflower", "APRIL", "To Plant", "noTill", { limeAppliedSeason: 1, limePh: 0.55, plowRequired: true }),
        // Sown, weeds to spray ("What to do today" lists it).
        devField("14", 3.1, "Oat", "MARCH", "Planted", "noTill", { limeAppliedSeason: 2, limePh: 0.8, fertilizer: true, weeds: "needed" }),
        // A field bought but not planned yet; its rotation fills in wheat when the planner opens (October).
        devField("15", 1.75, "", "", "To Plant", null, { rotation: { id: "rot_dev_norfolk", step: 0, stepSeason: 1 } }),
        // Nothing planned and no cycle: giving it one fills in the step's crop.
        devField("16", 0.9, "", "", "To Plant", null, {})
    ];
}

function devAnimalBuildings() {
    return [
        {
            id: "dev-cowbarn", name: "data/placeables/cowBarnBig/cowBarnBig.xml",
            clusters: [
                devCluster("COW_HOLSTEIN", 24, 40, 95, { reproduction: 60, isInseminated: true, hadABirth: true, monthsSinceLastBirth: 5 }),
                devCluster("COW_HOLSTEIN", 10, 16, 100),
                devCluster("COW_HOLSTEIN", 6, 2, 100)
            ],
            food: [{ fillType: "SILAGE", level: 70000 }, { fillType: "GRASS_WINDROW", level: 40000 }],
            production: [{ fillType: "MILK", level: 9200 }, { fillType: "LIQUIDMANURE", level: 30000 }, { fillType: "MANURE", level: 12000 }]
        },
        {
            id: "dev-pigbarn", name: "data/placeables/pigBarnBig/pigBarnBig.xml",
            clusters: [
                devCluster("PIG_LANDRACE", 40, 18, 90, { reproduction: 35, isInseminated: true }),
                devCluster("PIG_LANDRACE", 25, 4, 100)
            ],
            food: [{ fillType: "MAIZE", level: 1200 }, { fillType: "WHEAT", level: 900 }, { fillType: "SOYBEAN", level: 300 }],
            production: [{ fillType: "LIQUIDMANURE", level: 18000 }]
        },
        {
            id: "dev-chickencoop", name: "data/placeables/chickenCoop/chickenCoop.xml",
            clusters: [devCluster("CHICKEN", 120, 10, 100), devCluster("CHICKEN_ROOSTER", 5, 12, 100)],
            food: [],
            production: [{ fillType: "EGG", level: 500 }]
        },
        {
            id: "dev-sheeppasture", name: "data/placeables/sheepPasture/sheepPasture.xml",
            clusters: [devCluster("SHEEP_LANDRACE", 30, 24, 64), devCluster("GOAT", 8, 20, 70)],
            food: [{ fillType: "GRASS_WINDROW", level: 15000 }],
            production: [{ fillType: "WOOL", level: 1200 }, { fillType: "GOATMILK", level: 300 }]
        },
        {
            id: "dev-horsestable", name: "data/placeables/horseStable/horseStable.xml",
            clusters: [devCluster("HORSE_BAY", 3, 36, 100), devCluster("HORSE_BLACK", 1, 60, 85)],
            food: [{ fillType: "OAT", level: 2000 }, { fillType: "DRYGRASS_WINDROW", level: 3000 }],
            production: []
        }
    ];
}

function devTotals(buildings) {
    const breakdown = {}, production = {};
    let animals = 0;
    buildings.forEach(b => {
        b.clusters.forEach(c => {
            breakdown[c.subType] = (breakdown[c.subType] || 0) + c.numAnimals;
            animals += c.numAnimals;
        });
        b.production.forEach(p => { production[p.fillType] = (production[p.fillType] || 0) + p.level; });
    });
    return { animals, breakdown, production };
}

function devArchivedSeasons() {
    const archived = (season, fields, balance, loan, animals, avgHealth) => ({
        season, dateArchived: new Date(Date.UTC(2026, season, 1)).toISOString(),
        fields, balance, loan, animals, avgHealth
    });
    return [
        archived(1, [
            devField("1", 5.2, "Canola", "AUGUST", "Planted", "plowed", { limeAppliedSeason: 1, limePh: 1, harvestMonth: "JUNE", fertilizer: true }),
            devField("2", 3.4, "Wheat", "OCTOBER", "Planted", "plowed", { harvestMonth: "JULY" }),
            devField("3-4", 7.8, "Maize", "APRIL", "Planted", "plowed", { harvestMonth: "OCTOBER", manure: true }),
            devField("5", 4.5, "Barley", "SEPTEMBER", "Planted", "noTill", { harvestMonth: "JUNE" }),
            devField("6", 4.0, "Grass", "MARCH", "Planted", null, { limeAppliedSeason: 1, limePh: 1 })
        ], 95000, 200000, 62, 88),
        archived(2, [
            devField("1", 5.2, "Barley", "SEPTEMBER", "Planted", "noTill", { harvestMonth: "JUNE" }),
            devField("2", 3.4, "Canola", "AUGUST", "Planted", "plowed", { harvestMonth: "JUNE", fertilizer: true }),
            devField("3-4", 7.8, "Wheat", "OCTOBER", "Planted", "plowed", { limeAppliedSeason: 2, limePh: 1, harvestMonth: "JULY" }),
            devField("5", 4.5, "Soybean", "APRIL", "Planted", "noTill", { limeAppliedSeason: 2, limePh: 1, harvestMonth: "SEPTEMBER" }),
            devField("6", 4.0, "Grass", "MARCH", "Planted", null, {}),
            devField("7", 1.2, "Sugarbeet", "APRIL", "Planted", "plowed", { harvestMonth: "OCTOBER" }),
            devField("10-11-12", 12.4, "Sunflower", "APRIL", "Planted", "plowed", { limeAppliedSeason: 2, limePh: 1, harvestMonth: "OCTOBER" }),
            devField("14", 3.1, "Wheat", "SEPTEMBER", "Planted", "plowed", { limeAppliedSeason: 2, limePh: 1, harvestMonth: "JULY" })
        ], 214000, 160000, 210, 91)
    ];
}

// One row per in-game month from year 1 MARCH to now. Money and the herd grow
// with a little wobble so the trend charts have something to show.
function devMonthlyHistory() {
    const rows = [];
    const last = (DEV_YEAR - 1) * 12 + DEV_MONTH_INDEX;
    for (let period = 0; period <= last; period++) {
        const k = period / last;
        const wobble = Math.sin(period * 1.7);
        const season = Math.min(DEV_SEASON, Math.floor(period / 12) + 1);
        const cows = Math.round(20 + 20 * k);
        rows.push({
            period,
            month: DEV_MONTHS[period % 12],
            gameYear: Math.floor(period / 12) + 1,
            gameDay: period * 3 + 1,
            appSeason: season,
            recordedAt: new Date(Date.UTC(2026, 0, 1 + period)).toISOString(),
            balance: Math.round(60000 + 252450 * k + 18000 * wobble),
            loan: Math.round(200000 - 80000 * k),
            equipment: 8 + Math.round(15 * k),
            animals: Math.round(40 + 213 * k),
            avgHealth: Math.round(86 + 6 * k + 3 * wobble),
            production: { MILK: Math.round(4000 + 5200 * k), EGG: Math.round(100 + 400 * k), LIQUIDMANURE: Math.round(10000 + 38000 * k) },
            productionEst: {
                MILK: Math.round(cows * 2000 * (0.9 + 0.1 * wobble)),
                EGG: Math.round(3600 * k),
                WOOL: Math.round(900 * k),
                GOATMILK: period > 12 ? Math.round(1200 * k) : 0
            },
            // Income and costs of the last ten months only, as when the farm
            // started collecting them with 0.11.0 (three days per month).
            financeDays: period > last - 10 ? devFinanceDays(period, k) : undefined
        });
    }
    return rows;
}

// The days of one month as farms.xml <finances> files them: costs negative,
// harvest money in summer and autumn, a tractor bought and an old one sold.
function devFinanceDays(period, k) {
    const m = period % 12;                       // 0 = March
    const harvest = [0, 0, 0.3, 1, 1.2, 0.6, 0.8, 0.2, 0, 0, 0, 0][m];
    const sowing = [1, 0.8, 0.2, 0, 0.4, 0.9, 0.3, 0, 0, 0, 0, 0.5][m];
    const out = {};
    for (let d = 0; d < 3; d++) {
        const day = period * 3 + 1 + d;
        const cats = {
            harvestIncome: Math.round(38000 * harvest * (1 + 0.3 * Math.sin(day))),
            soldMilk: Math.round((2600 + 3400 * k) * (1 + 0.1 * Math.cos(day))),
            soldProducts: Math.round(1800 + 900 * Math.sin(day * 0.7)),
            missionIncome: d === 1 ? Math.round(4200 + 1500 * Math.sin(period)) : 0,
            purchaseSeeds: -Math.round(9000 * sowing),
            purchaseFertilizer: -Math.round(5200 * sowing + 600),
            purchaseFuel: -Math.round(1400 + 1800 * harvest),
            vehicleRunningCost: -Math.round(900 + 700 * k),
            propertyMaintenance: -Math.round(350 + 250 * k),
            wagePayment: -Math.round(600 + 2400 * harvest),
            loanInterest: -Math.round(180 - 60 * k),
            productionCosts: -260
        };
        if (m === 1 && d === 0) cats.newVehiclesCost = -185000;
        if (m === 5 && d === 2) cats.soldVehicles = 42000;
        Object.keys(cats).forEach(c => { if (!cats[c]) delete cats[c]; });
        out[day] = cats;
    }
    return out;
}

// Prices for "Yields and prices" (shape of readSaveMarket in market.js): a
// seasonal curve per crop and input, high after harvest, and three great
// demands — one running, one for a crop of the farm, one for something else.
function devMarket() {
    const base = { WHEAT: 330, BARLEY: 300, CANOLA: 640, MAIZE: 290, SOYBEAN: 720, POTATO: 260, SUGARBEET: 180,
        SUNFLOWER: 600, OAT: 380, GRASS: 45, RICE: 1100, OILSEEDRADISH: 250, SEEDS: 900, FERTILIZER: 1600, LIME: 230 };
    // Harvest month of each curve (period index from March): the price is lowest there.
    const low = { WHEAT: 4, BARLEY: 3, CANOLA: 4, MAIZE: 7, SOYBEAN: 6, POTATO: 6, SUGARBEET: 7, SUNFLOWER: 6, OAT: 4, RICE: 6 };
    const prices = {};
    Object.keys(base).forEach(ft => {
        const swing = ft in low ? 0.18 : 0.04;
        prices[ft] = DEV_MONTHS.map((m, i) => Math.round(base[ft] * (1 + swing * -Math.cos((i - (low[ft] || 0)) / 12 * 2 * Math.PI))));
    });
    return {
        prices,
        demands: [
            { fillType: "CANOLA", multiplier: 1.3, startDay: 23, startHour: 6, hours: 12, running: true, station: "Grain elevator" },
            { fillType: "WHEAT", multiplier: 1.2, startDay: 24, startHour: 18, hours: 18, running: false, station: "Mill" },
            { fillType: "STRAW_PELLETS", multiplier: 1.3, startDay: 26, startHour: 8, hours: 12, running: false, station: "Bale shop" }
        ]
    };
}

function devNotes(pl) {
    const now = new Date().toISOString();
    const note = (id, title, body, months, tags, checklist, fields) => ({
        id: 'note_dev_' + id, title, body, months, tags, checklist, fields: fields || [], createdAt: now, updatedAt: now
    });
    return [
        // Pinned to field 1; one tick from this year, one from last year (shows as not done).
        note('sow', pl ? "Siew pszenicy na polu 1" : "Sow wheat on field 1",
            pl ? "Wapno już jest. Najpierw siew, potem nawóz." : "Lime is done. Sow first, then fertilize.",
            ["OCTOBER"], [pl ? "pola" : "fields"],
            [{ text: pl ? "Kupić nasiona" : "Buy seed", done: true, doneYear: DEV_YEAR },
                { text: pl ? "Zasiać" : "Sow", done: true, doneYear: DEV_YEAR - 1 }],
            ["1"]),
        note('pigs', pl ? "Zboże dla świń" : "Grain for the pigs",
            pl ? "W chlewni zostało na kilka dni." : "The pig barn has a few days left.",
            ["SEPTEMBER", "OCTOBER", "NOVEMBER"], [pl ? "zwierzęta" : "animals"], []),
        note('lease', pl ? "Dzierżawa pola 7 się kończy" : "Field 7 lease ends",
            pl ? "Zdecydować: zdać czy przedłużyć." : "Decide: hand it back or extend.",
            ["FEBRUARY"], [pl ? "dzierżawa" : "lease"],
            [{ text: pl ? "Sprawdzić plony" : "Check the yields", done: false }],
            ["7"])
    ];
}

function buildDevFarm({ pl }) {
    const buildings = devAnimalBuildings();
    const totals = devTotals(buildings);
    const farm = {
        id: DEV_FARM_ID,
        folderName: DEV_FARM_ID,
        isDevFarm: true,
        name: pl ? "DEV – farma testowa" : "DEV – test farm",
        mapName: "",
        lastEdited: new Date().toISOString(),
        balance: 312450,
        loan: 120000,
        bankCredit: { count: 1, total: 120000, monthly: 4200 },
        equipment: 23,
        playTime: "87h 40m",
        month: DEV_MONTHS[DEV_MONTH_INDEX],
        dayInPeriod: 2,
        daysPerPeriod: 3,
        gameDay: 23,
        dayMinutes: 600,
        // Rain from 16:00 for 3 hours (two entries in a row), then sun.
        forecast: [
            { type: "SUN", startDay: 23, startMin: 360, minutes: 600 },
            { type: "RAIN", startDay: 23, startMin: 960, minutes: 120 },
            { type: "RAIN", startDay: 23, startMin: 1080, minutes: 60 },
            { type: "CLOUDY", startDay: 23, startMin: 1140, minutes: 300 }
        ],
        devMarket: devMarket(),
        // Ploughing required, so field 13 (no-till) has to be ploughed first.
        gameRules: { plowingRequired: true, stones: true, weeds: true, lime: true },
        yearNumber: DEV_YEAR,
        currentSeason: DEV_SEASON,
        seasonStartedGameYear: DEV_YEAR,
        fieldSizes: { "5": 5 },
        // Crop rotation: three cycles; fields 1, 2, 3-4, 6 and 15 use them.
        rotations: [
            { id: "rot_dev_norfolk", name: "Norfolk", color: "#c97a2b", steps: [
                { crop: "Wheat", catchCrop: "", sowingMonth: "", seasons: 1 }, { crop: "Sugarbeet", catchCrop: "", sowingMonth: "", seasons: 1 },
                { crop: "Barley", catchCrop: "", sowingMonth: "", seasons: 1 }, { crop: "Canola", catchCrop: "", sowingMonth: "", seasons: 1 }] },
            { id: "rot_dev_canola", name: pl ? "Rzepak + zboża" : "Canola + cereals", color: "#3f6fa8", steps: [
                { crop: "Canola", catchCrop: "", sowingMonth: "", seasons: 1 }, { crop: "Wheat", catchCrop: "", sowingMonth: "", seasons: 1 },
                { crop: "Barley", catchCrop: "Oilseedradish", sowingMonth: "", seasons: 1 }] },
            { id: "rot_dev_dairy", name: pl ? "Pasza" : "Dairy feed", color: "#5b8c3a", steps: [
                { crop: "Maize", catchCrop: "", sowingMonth: "", seasons: 1 }, { crop: "Grass", catchCrop: "", sowingMonth: "", seasons: 3 },
                { crop: "Wheat", catchCrop: "Oilseedradish", sowingMonth: "", seasons: 1 }] }
        ],
        // Field names (shown under the number, found by the search); most fields stay unnamed.
        fieldNames: pl
            ? { "1": "Za stodołą", "3-4": "Duże przy lesie", "6": "Łąka nad rzeką", "10-11-12": "Kukurydza północ" }
            : { "1": "Behind the barn", "3-4": "Big by the woods", "6": "River meadow", "10-11-12": "North maize" },
        fields: devFields(),
        animals: totals.animals,
        animalBreakdown: totals.breakdown,
        animalProduction: totals.production,
        animalBuildings: buildings,
        animalBuildingNames: { "dev-cowbarn": pl ? "Obora" : "Cow barn" },
        animalBuildingCapacities: {
            "dev-cowbarn": { __ALL_FEED__: 120000 },
            "dev-sheeppasture": { __ALL_FEED__: 20000 }
        },
        feedStock: {
            SILAGE: { bunker: 240000, bale: 28000 },
            DRYGRASS_WINDROW: { bale: 36000 },
            STRAW: { bale: 60000 },
            MINERAL_FEED: { pallet: 1500 },
            PIGFOOD: { pallet: 3000 },
            WHEAT: { silo: 42000 },
            MAIZE: { silo: 18000 },
            SOYBEAN: { silo: 6000 },
            OAT: { silo: 4000 },
            FORAGE: { mixer: 8000 }
        },
        feedBales: [
            { key: "round125|SILAGE|3500", size: "round125", fillType: "SILAGE", litres: 3500, count: 8 },
            { key: "round125|DRYGRASS_WINDROW|4500", size: "round125", fillType: "DRYGRASS_WINDROW", litres: 4500, count: 8 },
            { key: "round125|STRAW|5000", size: "round125", fillType: "STRAW", litres: 5000, count: 12 }
        ],
        mixerWagons: [
            { id: "save:dev-mixer1", name: "Siloking TruckLine Premium 2.0", capacity: 24000, source: "save" },
            { id: "save:dev-mixer2", name: "Kuhn Profile 1880", capacity: null, source: "save" }
        ],
        supplyRates: {
            defaultOverridesCleaned: true,
            fieldSoil: {
                "1": { loam: 60, siltyClay: 40 },
                "2": { sandyLoam: 100 },
                "3-4": { loamySand: 30, sandyLoam: 50, loam: 20 },
                "5": { loam: 100 },
                "10-11-12": { loamySand: 70, siltyClay: 30 }
            },
            fertPlan: {
                "1::Wheat": { existingN: 40, orgN: 60 },
                "3-4::Canola": { existingN: 120, orgN: 40 },
                "10-11-12::Maize": { orgN: 90 }
            }
        }
    };
    return {
        farm,
        seasons: devArchivedSeasons(),
        monthly: devMonthlyHistory(),
        notes: devNotes(pl)
    };
}

module.exports = { DEV_FARM_ID, buildDevFarm };
