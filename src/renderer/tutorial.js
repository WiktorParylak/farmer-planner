// Interactive tutorial. Loaded as a plain <script> after renderer.js, so it shares
// renderer.js's globals (t, getAllFarms, openPlanner…) and renderer.js reaches
// tut / startTutorial / removeDemoFarm only from code that runs after page load.

// =============================================================
// SECTION 10B: TUTORIAL (interactive chapters)
// =============================================================
// Spotlight tour over the real UI, split into chapters picked from a menu.
// Steps are one of:
//   info  — read and press Next (the highlighted element can't be clicked)
//   click — the user has to click the highlighted element; advances by itself
//   input — the user has to type / choose something; Next unlocks when valid
// "Show me" performs the action for them. Everything runs against a practice
// farm flagged isTutorialDemo (created by the user in chapter A, or silently
// when a later chapter is started on its own), seeded with example data so
// every feature has something to show. It's removed when the tutorial closes,
// or on the next startup if the app was closed mid-tour.
const CONFIG_KEY_TUTORIAL_CHAPTERS = 'farmer_planner_tutorial_chapters';

const tutorialOverlay = document.getElementById('tutorial-overlay');
const tutorialSpotlight = tutorialOverlay ? tutorialOverlay.querySelector('.tutorial-spotlight') : null;
const tutorialBubble = tutorialOverlay ? tutorialOverlay.querySelector('.tutorial-bubble') : null;
const tutorialStepView = tutorialOverlay ? tutorialOverlay.querySelector('.tutorial-step-view') : null;
const tutorialMenuView = tutorialOverlay ? tutorialOverlay.querySelector('.tutorial-menu-view') : null;
const tutorialStepCount = tutorialOverlay ? tutorialOverlay.querySelector('.tutorial-step-count') : null;
const tutorialTitle = tutorialStepView ? tutorialStepView.querySelector('.tutorial-title') : null;
const tutorialText = tutorialStepView ? tutorialStepView.querySelector('.tutorial-text') : null;
const tutorialHint = tutorialOverlay ? tutorialOverlay.querySelector('.tutorial-hint') : null;
const tutorialChapterList = tutorialOverlay ? tutorialOverlay.querySelector('.tutorial-chapter-list') : null;
const tutorialBlockers = tutorialOverlay ? {
    top: tutorialOverlay.querySelector('.tutorial-blocker--top'),
    bottom: tutorialOverlay.querySelector('.tutorial-blocker--bottom'),
    left: tutorialOverlay.querySelector('.tutorial-blocker--left'),
    right: tutorialOverlay.querySelector('.tutorial-blocker--right'),
    hole: tutorialOverlay.querySelector('.tutorial-hole-blocker')
} : null;
const tutorialMenuBtn = document.getElementById('tutorial-menu-btn');
const tutorialShowMeBtn = document.getElementById('tutorial-showme-btn');
const tutorialPrevBtn = document.getElementById('tutorial-prev-btn');
const tutorialNextBtn = document.getElementById('tutorial-next-btn');
const tutorialRunAllBtn = document.getElementById('tutorial-run-all-btn');
const tutorialCloseBtn = document.getElementById('tutorial-close-btn');

const tut = {
    active: false,
    mode: null,          // 'menu' | 'step'
    chapterIdx: -1,
    stepIdx: -1,
    runAll: false,
    demoId: null,
    advancing: false,
    timer: null,
    // per-chapter scratch values (farm ids before creation, row counts, ...)
    farmSnapshot: [],
    rowsBefore: 0,
    newFieldNumber: ''
};

// ---------- small DOM helpers ----------
const tq = (sel) => document.querySelector(sel);
const tqa = (sel) => Array.from(document.querySelectorAll(sel));

function tutIsShown(el) {
    if (typeof el === 'string') el = tq(el);
    if (!el) return false;
    if (el.getClientRects().length === 0) return false;
    return getComputedStyle(el).visibility !== 'hidden';
}

function tutModalOpen(id) {
    const el = document.getElementById(id);
    return !!el && getComputedStyle(el).display !== 'none';
}

function tutPlannerShown() {
    return !!plannerView && plannerView.style.display !== 'none';
}

function tutSetValue(el, value) {
    if (!el) return;
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

function tutPickOption(select, preferred) {
    if (!select) return;
    const values = Array.from(select.options).map(o => o.value).filter(Boolean);
    const value = (preferred && values.includes(preferred)) ? preferred : values[0];
    if (value) tutSetValue(select, value);
}

function tutDemoItem() {
    if (!tut.demoId) return null;
    return tqa('.farm-list .farm-item').find(el => el.dataset.farmId === String(tut.demoId)) || null;
}

// Read-only fields table row by its displayed field number ("1", "5–6").
function tutFieldRow(number) {
    return tqa('#fields-body tr').find(tr => {
        const cell = tr.querySelector('.field-number-cell');
        return cell && cell.textContent.replace(/\s/g, '') === number;
    }) || null;
}

function tutLastEditCard() {
    const rows = tqa('#fields-body tr.field-edit-tr');
    return rows[rows.length - 1] || null;
}

function tutInCard(sel) {
    return () => { const card = tutLastEditCard(); return card ? card.querySelector(sel) : null; };
}

// Animal panel: opens the n-th barn from the tile grid (only re-rendering
// when a different barn is showing, so typed input survives) and returns
// its card.
function tutPen(n) {
    const farm = getCurrentFarm();
    const building = farm && (farm.animalBuildings || [])[n];
    if (!building) return null;
    if (animalSelectedBuilding !== building.id || !tq('#hub-panel-body .pen-card')) openAnimalBuilding(building.id);
    return tq('#hub-panel-body .pen-card');
}

// Animal panel: back to the tile overview (head count, tiles, history).
function tutAnimalsOverview() {
    if (animalSelectedBuilding !== null || !tq('#hub-panel-body .barn-tile-grid')) {
        animalSelectedBuilding = null;
        openHubPanel('animals');
    }
}

function tutPenPart(n, sel) {
    const card = tutPen(n);
    return card ? card.querySelector(sel) : null;
}

// Feed planner: keeps the demo cow barn (the one fed TMR, so the mixer
// wagon shows) selected and returns the matching part of the panel.
function tutFeed(sel) {
    if (!tutViewActive('feedplan')) return null;
    if (feedSelectedBuilding !== 'demo-cowbarn' && getCurrentFarm() && (getCurrentFarm().animalBuildings || []).some(b => b.id === 'demo-cowbarn')) {
        feedSelectedBuilding = 'demo-cowbarn';
        rerenderFeedPlan();
    }
    return tq('#hub-panel-body ' + sel);
}

function tutNumValue(el) {
    return el ? (parseDecimal(el.value) || 0) : 0;
}

// ---------- demo farm ----------
function seedDemoFarm(farm) {
    // Demo texts in the app language: tr(english, polish, german).
    const tr = (en, pl, de) => ({ pl, de }[currentLang] || en);
    const lime = (ph, season) => ({ limePh: ph, limeAppliedSeason: season });
    const field = (number, area, crop, sowingMonth, state, tillage, extra) => ({
        number, area, crop, sowingMonth, state, tillage,
        limeAppliedSeason: null, limePh: null, manure: false, fertilizer: false,
        ...extra
    });

    Object.assign(farm, {
        isTutorialDemo: true,
        balance: 185400,
        loan: "60 000",
        playTime: "42h 15m",
        equipment: 14,
        // Three barns covering every animal-panel state: a healthy cow barn
        // with a capacity set, a chicken coop almost out of feed and with no
        // capacity yet (the tutorial asks the user to enter it), and a sheep
        // pasture with a half-empty trough and lower health. Most cows are
        // pregnant; the heifers aren't inseminated yet (reproduction panel).
        animals: 108,
        animalBreakdown: { COW_HOLSTEIN: 30, CHICKEN: 60, SHEEP_LANDRACE: 18 },
        animalProduction: { MILK: 6400, LIQUIDMANURE: 12000, EGG: 340, WOOL: 800 },
        animalBuildings: [
            {
                id: 'demo-cowbarn', name: 'data/placeables/cowBarnBig/cowBarnBig.xml',
                clusters: [
                    { subType: 'COW_HOLSTEIN', numAnimals: 24, age: 30, health: 96, reproduction: 55, hadABirth: true, monthsSinceLastBirth: 7 },
                    { subType: 'COW_HOLSTEIN', numAnimals: 6, age: 20, health: 88, reproduction: 0, isInseminated: false }
                ],
                food: [{ fillType: 'GRASS_WINDROW', level: 50000 }, { fillType: 'SILAGE', level: 30000 }],
                production: [{ fillType: 'MILK', level: 6400 }, { fillType: 'LIQUIDMANURE', level: 12000 }]
            },
            {
                id: 'demo-chickencoop', name: 'data/placeables/chickenCoop/chickenCoop.xml',
                clusters: [{ subType: 'CHICKEN', numAnimals: 60, age: 12, health: 100 }],
                food: [{ fillType: 'WHEAT', level: 60 }],
                production: [{ fillType: 'EGG', level: 340 }]
            },
            {
                id: 'demo-sheeppasture', name: 'data/placeables/sheepPasture/sheepPasture.xml',
                clusters: [{ subType: 'SHEEP_LANDRACE', numAnimals: 18, age: 20, health: 72 }],
                food: [{ fillType: 'GRASS_WINDROW', level: 5400 }],
                production: [{ fillType: 'WOOL', level: 800 }]
            }
        ],
        animalBuildingCapacities: {
            'demo-cowbarn': { [ANIMAL_FEED_CAPACITY_KEY]: 120000 },
            'demo-sheeppasture': { [ANIMAL_FEED_CAPACITY_KEY]: 20000 }
        },
        // Feed on the farm, bales grouped by type and one mixer wagon whose
        // capacity couldn't be read (the tutorial asks the user to enter it).
        feedStock: {
            DRYGRASS_WINDROW: { bale: 40000 },
            SILAGE: { bunker: 180000, bale: 48000 },
            STRAW: { bale: 24000 },
            MINERAL_FEED: { pallet: 2000 },
            WHEAT: { silo: 30000 }
        },
        feedBales: [
            { key: 'round150|SILAGE|4000', size: 'round150', fillType: 'SILAGE', litres: 4000, count: 12 },
            { key: 'round150|DRYGRASS_WINDROW|4000', size: 'round150', fillType: 'DRYGRASS_WINDROW', litres: 4000, count: 10 },
            { key: 'square240|STRAW|4000', size: 'square240', fillType: 'STRAW', litres: 4000, count: 6 }
        ],
        mixerWagons: [
            { id: 'save:demo-mixer', name: 'Siloking TruckLine Premium 2.0', capacity: null, source: 'save' }
        ],
        month: "SEPTEMBER",
        currentSeason: 2,
        yearNumber: 2,
        fieldSizes: { "4": 5 },
        fields: [
            field("1", 4.2, "Wheat", "SEPTEMBER", "To Plant", "plowed", lime(0.9, 2)),
            field("2", 2.6, "Canola", "AUGUST", "Planted", "noTill", { ...lime(0.45, 1), fertilizer: true }),
            field("3", 3.1, "Wheat", "OCTOBER", "To Plant", "plowed", lime(0.7, 1)),
            field("4", 2.0, "Soybean", "APRIL", "To Plant", "noTill", { ...lime(1.0, 2), catchCrop: "Oilseedradish", catchSowingMonth: "SEPTEMBER" }),
            field("4", 2.5, "Maize", "APRIL", "To Plant", "plowed", lime(1.0, 2)),
            field("5-6", 6.8, "Canola", "AUGUST", "Planted", "plowed", { ...lime(0.2, 1), manure: true }),
            field("8", 3.0, "Grass", "MARCH", "Planted", "noTill", { ...lime(0.8, 1), cuts: [{ month: 'MAY', use: 'silage', harvested: true, fertilized: true }, { month: 'JULY', use: 'hay', harvested: true }] })
        ],
        supplyRates: {
            defaultOverridesCleaned: true,
            fieldSoil: {
                "2": { loam: 70, siltyClay: 30 },
                "3": { sandyLoam: 100 },
                "5-6": { loamySand: 50, sandyLoam: 50 }
            },
            fertPlan: { "2::Canola": { existingN: 30, orgN: 40 } }
        }
    });
    saveFarmData(farm);

    const dir = farmDir(farm);
    try {
        const seasonsDir = path.join(dir, 'seasons');
        if (!fs.existsSync(seasonsDir)) fs.mkdirSync(seasonsDir, { recursive: true });
        const archive = {
            season: 1,
            dateArchived: new Date().toISOString(),
            fields: [
                field("1", 4.2, "Canola", "AUGUST", "Planted", "plowed"),
                field("2", 2.6, "Barley", "SEPTEMBER", "Planted", "plowed"),
                field("3", 3.1, "Wheat", "SEPTEMBER", "Planted", "noTill"),
                field("4", 4.5, "Maize", "APRIL", "Planted", "plowed"),
                field("5-6", 6.8, "Wheat", "OCTOBER", "Planted", "plowed")
            ],
            balance: 142000,
            loan: 90000,
            animals: 84,
            avgHealth: 90
        };
        fs.writeFileSync(path.join(seasonsDir, 'season_1.json'), JSON.stringify(archive, null, 2), 'utf-8');
    } catch (err) {
        console.error('Tutorial: could not write demo season archive', err);
    }

    // Five in-game months (MAY..SEPTEMBER) so the finance and animal charts
    // have a trend. Milk is a stock level; the chart plots month-to-month growth.
    const history = [
        [2, 1, 128000, 100000, 84, 90, 1200], [3, 1, 141500, 95000, 90, 92, 2600],
        [4, 1, 139000, 90000, 96, 89, 3900], [5, 2, 162300, 75000, 102, 91, 5100],
        [6, 2, 185400, 60000, 108, 93, 6400]
    ].map(([period, season, balance, loan, animals, avgHealth, milk]) => ({
        period,
        month: FS_PERIOD_TO_MONTH[period % 12],
        gameYear: 1,
        gameDay: period * 3 + 1,
        appSeason: season,
        recordedAt: new Date().toISOString(),
        balance, loan,
        equipment: 14,
        animals,
        avgHealth,
        production: { MILK: milk }
    }));
    saveMonthlyHistory(farm, history);

    const now = new Date().toISOString();
    saveNotes(farm, [{
        id: generateNoteId(),
        title: tr("Lime before sowing wheat", "Wapnowanie przed siewem pszenicy", "Kalken vor der Weizensaat"),
        body: tr("Field 5-6 has low pH — lime it after the canola harvest.", "Pole 5-6 ma niskie pH — wapnować po zbiorze rzepaku.", "Feld 5-6 hat einen niedrigen pH-Wert — nach der Rapsernte kalken."),
        months: ["SEPTEMBER", "OCTOBER"],
        tags: [tr("lime", "wapno", "Kalk")],
        checklist: [
            { text: tr("Buy 20,000 l of lime", "Kupić 20 000 l wapna", "20.000 l Kalk kaufen"), done: true },
            { text: tr("Spread it on field 5-6", "Rozsiać na polu 5-6", "Auf Feld 5-6 ausbringen"), done: false }
        ],
        createdAt: now,
        updatedAt: now
    }]);
}

function createDemoFarm() {
    const id = Date.now().toString();
    try {
        fs.mkdirSync(path.join(appDataDir, id));
    } catch (err) {
        console.error('Tutorial: could not create demo farm folder', err);
        return null;
    }
    const farm = {
        id,
        name: t('tutorialDemoFarmName'),
        mapName: "",
        folderName: id,
        lastEdited: new Date().toISOString(),
        fields: []
    };
    seedDemoFarm(farm);
    return id;
}

function adoptAsDemoFarm(id) {
    const farm = getAllFarms().find(f => f.id === id);
    if (!farm) return;
    seedDemoFarm(farm);
    tut.demoId = id;
    renderFarmList(getAllFarms());
}

function ensureDemoFarm() {
    const existing = getAllFarms().find(f => f.isTutorialDemo);
    tut.demoId = existing ? existing.id : createDemoFarm();
    return tut.demoId;
}

// Removes every demo farm — not just the one from this run — so a crash or
// window close mid-tour never leaves one behind for good.
function removeDemoFarm() {
    getAllFarms().filter(f => f.isTutorialDemo).forEach(f => {
        try { fs.rmSync(farmDir(f), { recursive: true, force: true }); }
        catch (err) { console.error('Tutorial: could not remove demo farm', err); }
    });
    tut.demoId = null;
}

// ---------- app state helpers ----------
function tutCloseModals() {
    document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; });
}

// Same teardown as the planner's exit button.
function tutGoToDashboard() {
    if (tutPlannerShown() && currentFarmId) {
        stopAutoSync();
        clearFarmConfigs();
        currentFarmId = null;
    }
    if (plannerView) plannerView.style.display = 'none';
    if (dashboardView) dashboardView.style.display = 'flex';
    renderFarmList(getAllFarms());
    updateDiscordPresence();
}

// Fresh planner of the demo farm — openPlanner also resets both edit modes
// and jumps back to the current season.
function tutOpenDemoPlanner() {
    tutCloseModals();
    ensureDemoFarm();
    if (tut.demoId) window.openPlanner(tut.demoId);
}

function tutOpenHubPanel(type) {
    tutOpenDemoPlanner();
    if (type) showPlannerView(type);
}

// ---------- step builders ----------
function tutInfo(id, target, extra) { return { id, type: 'info', target, ...extra }; }
function tutClick(id, target, check, extra) { return { id, type: 'click', target, check, ...extra }; }
function tutInput(id, target, check, autoValue, extra) {
    return {
        id, type: 'input', target, check,
        auto: (el) => {
            if (el && el.tagName === 'SELECT') tutPickOption(el, autoValue);
            else tutSetValue(el, typeof autoValue === 'function' ? autoValue() : autoValue);
        },
        ...extra
    };
}

const tutViewActive = (view) => currentPlannerView === view;
const hubOpen = (id, type) => tutClick(id, `#planner-sidebar .sidebar-item[data-view="${type}"]`, () => tutViewActive(type));

const TUTORIAL_CHAPTERS = [
    {
        id: 'a',
        prepare() {
            tutCloseModals();
            tutGoToDashboard();
            removeDemoFarm();
            renderFarmList(getAllFarms());
            tut.farmSnapshot = getAllFarms().map(f => f.id);
        },
        steps: [
            tutInfo('a1', null),
            tutClick('a2', '.add-farm-btn', () => tutModalOpen('farm-modal')),
            tutInput('a3', '#new-farm-name', () => { const el = tq('#new-farm-name'); return !!el && el.value.trim().length >= 2; },
                () => t('tutorialDemoFarmName')),
            tutInput('a4', '#new-farm-map', () => true, 'Riverbend Springs'),
            tutClick('a5', '#confirm-btn', () => {
                if (tut.demoId) return true;
                const created = getAllFarms().find(f => !tut.farmSnapshot.includes(f.id));
                if (created) { adoptAsDemoFarm(created.id); return true; }
                return false;
            }, {
                auto: (el) => {
                    const name = tq('#new-farm-name');
                    if (name && name.value.trim().length < 2) tutSetValue(name, t('tutorialDemoFarmName'));
                    if (el) el.click();
                }
            }),
            tutInfo('a6', tutDemoItem),
            tutInfo('a7', () => { const item = tutDemoItem(); return item ? item.querySelector('.export-btn-circle') : null; }),
            tutInfo('a8', '#import-backup-btn'),
            tutInfo('a13', '#tramlines-btn'),
            tutInfo('a14', '#mapscale-btn'),
            tutInfo('a9', () => { const item = tutDemoItem(); return item ? item.querySelector('.delete-btn-circle') : null; }),
            tutClick('a12', () => { const item = tutDemoItem(); return item ? item.querySelector('.select-btn') : null; },
                () => tutPlannerShown() && currentFarmId === tut.demoId)
        ]
    },
    {
        id: 'b',
        prepare: tutOpenDemoPlanner,
        steps: [
            tutInfo('b1', '#planner-farm-name'),
            tutInfo('b2', ['#planner-balance', '#planner-month']),
            tutInput('b3', '#planner-year', () => { const el = tq('#planner-year'); return !!el && parseInt(el.value, 10) === 3; }, '3'),
            tutInfo('b4', '.season-number'),
            tutClick('b5', '#prev-season-btn', () => viewedSeason === 1),
            tutInfo('b6', '#fields-table'),
            tutClick('b7', '#next-season-btn', () => { const f = getCurrentFarm(); return !!f && viewedSeason === (f.currentSeason || 1); }),
            tutInfo('b8', '.new-season-btn'),
            tutInfo('b9', '#settings-btn')
        ]
    },
    {
        id: 'c',
        prepare: tutOpenDemoPlanner,
        steps: [
            tutInfo('c1', '#fields-table'),
            tutInfo('c14', () => tq('#fields-body .field-open')),
            tutInfo('c2', '#fields-body .badge--plant-now'),
            tutInfo('c3', () => [tq('#fields-body .badge--planted'), tq('#fields-body .badge--to-plant')]),
            tutInfo('c11', () => tq('#fields-body .cuts-open')),
            tutInfo('c4', () => { const b = tq('#fields-body .badge--rotation-warn'); return b ? b.closest('tr') : null; }),
            tutInfo('c5', () => tqa('#fields-body tr.field-split-row')),
            tutInfo('c6', () => { const s = tq('#fields-body .field-number-sep'); return s ? s.closest('tr') : null; }),
            tutInfo('c12', () => tq('#fields-body .work-open')),
            tutInfo('c7', () => [tq('#fields-body .tillage-chip'), tq('#fields-body .rolling-toggle')]),
            tutInfo('c8', () => tqa('#fields-body .treatment-chip--lime')),
            tutInfo('c13', () => tqa('#fields-body .weeds-toggle')),
            tutInfo('c9', () => tqa('#fields-body .fertplan-open-btn')),
            tutInfo('c10', ['#total-ha-sum', '#sown-ha-sum']),
            tutInfo('c15', '.sidebar-item--rotation')
        ]
    },
    {
        id: 'd',
        prepare: tutOpenDemoPlanner,
        steps: [
            tutClick('d1', '#edit-season-btn', () => isEditMode === true),
            tutInfo('d2', '#fields-body .field-card'),
            tutInfo('d13', () => [tq('#bulk-bar'), tq('#fields-body .field-card-select')].filter(Boolean)),
            tutClick('d3', '#fields-body .add-row-trigger', () => tqa('#fields-body tr.field-edit-tr').length > tut.rowsBefore, {
                enter: () => { tut.rowsBefore = tqa('#fields-body tr.field-edit-tr').length; }
            }),
            tutInput('d4', tutInCard('input.field-number'), () => { const el = tutInCard('input.field-number')(); return !!el && el.value.trim() !== ''; }, '7'),
            tutInput('d5', tutInCard('input.field-area'), () => tutNumValue(tutInCard('input.field-area')()) > 0, '3.5'),
            tutInput('d6', tutInCard('select.field-crop'), () => { const el = tutInCard('select.field-crop')(); return !!el && el.value !== ''; }, 'Wheat'),
            tutInput('d7', tutInCard('select.field-sow'), () => { const el = tutInCard('select.field-sow')(); return !!el && el.value !== ''; }, 'SEPTEMBER'),
            tutClick('d8', tutInCard('.tillage-switch-option--plowed'), () => { const el = tutInCard('.tillage-switch-option--plowed')(); return !!el && el.classList.contains('is-active'); }),
            tutClick('d9', tutInCard('.treatment-chip--lime'), () => { const el = tutInCard('.treatment-chip--lime')(); return !!el && (el.classList.contains('is-active') || el.classList.contains('is-warning')); }),
            tutClick('d10', tutInCard('input.field-state'), () => { const el = tutInCard('input.field-state')(); return !!el && el.checked; }),
            tutClick('d11', '#edit-season-btn', () => isEditMode === false, {
                enter: () => { const el = tutInCard('input.field-number')(); tut.newFieldNumber = el ? el.value.trim() : ''; }
            }),
            tutInfo('d12', () => tutFieldRow(tut.newFieldNumber) || tq('#fields-table'))
        ]
    },
    {
        id: 'e',
        prepare: tutOpenDemoPlanner,
        steps: [
            tutClick('e1', () => { const row = tutFieldRow('1'); return row ? row.querySelector('.fertplan-open-btn') : null; },
                () => tutModalOpen('hub-panel-modal')),
            tutInfo('e2', () => tqa('#fertplan-modal-body .details-category').slice(0, 3)),
            tutInput('e3', '#fertplan-modal-body .fertplan-existing-input', () => tutNumValue(tq('#fertplan-modal-body .fertplan-existing-input')) > 0, '40'),
            tutInput('e4', '#fertplan-modal-body .fertplan-org-input', () => tutNumValue(tq('#fertplan-modal-body .fertplan-org-input')) > 0, '30'),
            tutInfo('e5', () => tqa('#fertplan-modal-body .details-category').slice(3).concat(tqa('#fertplan-modal-body .fertplan-status'))),
            tutClick('e6', '#fertplan-modal-body .fertplan-fertilizer-check', () => { const el = tq('#fertplan-modal-body .fertplan-fertilizer-check'); return !!el && el.checked; }),
            tutClick('e7', '#close-hub-panel-btn', () => !tutModalOpen('hub-panel-modal')),
            tutInfo('e8', () => { const row = tutFieldRow('1'); return row ? row.querySelector('.fertplan-open-btn') : null; })
        ]
    },
    {
        id: 'f',
        prepare: tutOpenDemoPlanner,
        steps: [
            tutInfo('f1', '#crops-table'),
            tutClick('f2', '#crops-table th[data-sort="ha"]', () => cropsSort.key === 'ha', {
                enter: () => { cropsSort = { key: 'game', dir: 1 }; saveCropsSort(); renderSeasonView(); }
            }),
            tutClick('f3', '#crops-table th[data-sort="name"]', () => cropsSort.key === 'name'),
            tutInfo('f4', () => tq('#crops-body .crops-section-row') || tq('#crops-table'))
        ]
    },
    {
        id: 'g',
        prepare: tutOpenDemoPlanner,
        steps: [
            // Pinned open for the step instead of the usual 2.5 s flash.
            tutInfo('g2', '#auto-sync-toast', {
                enter: () => {
                    const toast = document.getElementById('auto-sync-toast');
                    if (!toast) return;
                    toast.textContent = t('autoSyncedToast');
                    toast.hidden = false;
                    toast.classList.add('is-visible');
                },
                leave: () => {
                    const toast = document.getElementById('auto-sync-toast');
                    if (!toast) return;
                    toast.classList.remove('is-visible');
                    toast.hidden = true;
                }
            })
        ]
    },
    {
        id: 'h',
        prepare: tutOpenDemoPlanner,
        steps: [
            tutInfo('h1', '#planner-sidebar'),
            hubOpen('h3', 'finance'),
            tutInfo('h4', () => { const parts = tqa('#hub-panel-body .fin-kpis, #hub-panel-body .fin-card.trend-card, #hub-panel-body .fin-chart'); return parts.length ? parts : tq('#hub-panel-body'); }),
            hubOpen('h6', 'fieldsoil'),
            tutInput('h7', '#hub-panel-body .supply-soil-input[data-soil-field="1"]', () => {
                const el = tq('#hub-panel-body .supply-soil-input[data-soil-field="1"]');
                const saved = getSupplyRates().fieldSoil['1'];
                return tutNumValue(el) > 0 || !!saved;
            }, '60'),
            tutInfo('h8', '#hub-panel-body .field-soil-import'),
            hubOpen('h9', 'supplies'),
            tutInfo('h10', () => tqa('#hub-panel-body table.supply-table')[0] || null),
            tutInfo('h11', () => tqa('#hub-panel-body table.supply-table')[1] || null),
            hubOpen('h13', 'notes'),
            tutInfo('h14', '#hub-panel-body .note-card'),
            tutClick('h15', '#hub-panel-body .notes-add-btn', () => tutModalOpen('note-edit-modal')),
            tutInput('h16', '#note-edit-title', () => { const el = tq('#note-edit-title'); return !!el && el.value.trim() !== ''; },
                () => ({ pl: 'Kupić wapno', de: 'Kalk kaufen' }[currentLang] || 'Buy lime')),
            tutInfo('h17', '#note-edit-months'),
            tutClick('h18', '#note-edit-save-btn', () => !tutModalOpen('note-edit-modal') && tutViewActive('notes')),
            hubOpen('h20', 'yieldforecast'),
            tutInfo('h21', () => tq('#hub-panel-body table.supply-table') || tq('#hub-panel-body')),
            hubOpen('h24', 'plan')
        ]
    },
    {
        // Animals — the demo farm has three barns (see seedDemoFarm): cows
        // [0], chickens low on feed with no capacity yet [1], sheep [2].
        id: 'k',
        prepare: tutOpenDemoPlanner,
        steps: [
            hubOpen('k1', 'animals'),
            tutInfo('k3', () => { tutAnimalsOverview(); return tqa('#hub-panel-body .fin-kpis, #hub-panel-body .barn-tile-grid'); }),
            tutInfo('k4', () => tutPen(0)),
            tutInfo('k5', () => tutPenPart(0, '.herd-grid')),
            tutInfo('k19', () => { const card = tutPen(0); return card ? Array.from(card.querySelectorAll('.herd-repro, .herd-repro-bar, .herd-repro-last')) : null; }),
            tutInfo('k6', () => tutPenPart(0, '.feed-gauge')),
            tutInfo('k7', () => tutPenPart(0, '.feed-capacity')),
            tutInfo('k8', () => tutPenPart(0, '.feed-days')),
            tutInfo('k20', () => { const card = tutPen(0); return card ? Array.from(card.querySelectorAll('.barn-ration-select, .ration-list')) : null; }),
            tutInfo('k9', () => tutPen(1)),
            tutInput('k10', () => tutPenPart(1, '.feed-capacity-input'), () => {
                const f = getCurrentFarm();
                const saved = f && f.animalBuildingCapacities && f.animalBuildingCapacities['demo-chickencoop'];
                return tutNumValue(tutPenPart(1, '.feed-capacity-input')) > 0 || !!(saved && saved[ANIMAL_FEED_CAPACITY_KEY]);
            }, '1000'),
            tutInfo('k11', () => tutPenPart(1, '.feed-gauge')),
            tutInfo('k12', () => [tutPenPart(2, '.herd-card'), tutPenPart(2, '.feed-gauge'), tutPenPart(2, '.feed-days')].filter(Boolean)),
            tutInfo('k13', () => tutPenPart(0, '.barn-panel--need')),
            tutInfo('k21', () => tutPenPart(0, '.barn-panel--repro')),
            tutInfo('k14', () => tutPenPart(0, '.barn-panel--stored')),
            tutInfo('k15', () => tutPenPart(0, '.barn-panel--output')),
            tutInfo('k16', () => { tutAnimalsOverview(); const charts = tqa('#hub-panel-body .trend-card, #hub-panel-body .fin-chart'); return charts.length ? charts.slice(0, 3) : null; }),
            // Folded by default: opened for the step, folded again after.
            tutInfo('k22', () => {
                tutAnimalsOverview();
                const box = tq('#hub-panel-body .breed-norms');
                if (box && !box.open) { box.open = true; breedNormsOpen = true; }
                return box;
            }, {
                leave: () => {
                    const box = tq('#hub-panel-body .breed-norms');
                    if (box) box.open = false;
                    breedNormsOpen = false;
                }
            }),
            tutInfo('k17', null),
            hubOpen('k18', 'plan')
        ]
    },
    {
        // Feed planner + mixer wagon, on the demo cow barn (TMR). Starts from
        // an empty wagon with no capacity so both can be done by hand.
        id: 'm',
        prepare() {
            tutOpenDemoPlanner();
            const farm = getCurrentFarm();
            if (!farm) return;
            const plan = getFeedPlan(farm);
            plan.rations.COW = 'forage';
            plan.mixer.loads = {};
            plan.mixer.capacity = {};
            plan.mixer.selected = null;
            saveFeedPlan(plan);
        },
        steps: [
            hubOpen('m1', 'feedplan'),
            tutInfo('m2', () => tutFeed('.feed-barn-grid')),
            tutInfo('m3', () => tutFeed('.feed-ration-row')),
            tutInfo('m5', () => tutFeed('.mixer-wagons')),
            tutInput('m6', () => tutFeed('.mixer-cap-input'), () => {
                const plan = getFeedPlan(getCurrentFarm());
                return tutNumValue(tutFeed('.mixer-cap-input')) > 0 || parseFloat(plan.mixer.capacity['save:demo-mixer']) > 0;
            }, '20000'),
            tutClick('m7', () => tutFeed('.mixer-auto'), () => getFeedPlan(getCurrentFarm()).mixer.load.length > 0),
            tutInfo('m8', () => tutFeed('.mixer-load')),
            tutInfo('m9', () => tutFeed('.mixer-summary')),
            tutInfo('m10', () => { if (!tutFeed('.feed-ing-grid')) return null; return tqa('#hub-panel-body .feed-need-summary, #hub-panel-body .feed-ing-grid'); }),
            tutClick('m11', () => tutFeed('.feed-settings > summary'), () => { const d = tq('#hub-panel-body .feed-settings'); return !!d && d.open; }),
            tutInfo('m12', () => tutFeed('.feed-settings')),
            hubOpen('m13', 'plan')
        ]
    },
    {
        id: 'i',
        prepare: tutOpenDemoPlanner,
        steps: [
            tutClick('i1', '#settings-btn', () => tutModalOpen('settings-modal')),
            tutInput('i2', '#settings-map-name', () => { const el = tq('#settings-map-name'); return !!el && el.value.trim() !== ''; }, 'Hutan Pantai'),
            tutInfo('i3', ['#game-save-path', '#browse-save-btn', '#mods-dir-info']),
            tutInfo('i4', () => ['#auto-sync-toggle', '#farmland-area-toggle'].map(s => { const el = tq(s); return el ? (el.closest('label') || el) : null; }).filter(Boolean)),
            tutInfo('i5', '#animal-mods-info', { enter: () => showSettingsTab('mods') }),
            tutInfo('i10', ['#grassland-limit-input', '#currency-select'], { enter: () => showSettingsTab('planner') }),
            tutInfo('i6', '#settings-supply-adjust', { enter: () => showSettingsTab('rates') }),
            tutInfo('i7', '#settings-supply-adjust details'),
            tutInfo('i11', ['#settings-advanced', '#settings-modal .settings-danger-zone'], { enter: () => showSettingsTab('advanced') }),
            tutClick('i8', '#save-settings-btn', () => !tutModalOpen('settings-modal')),
            tutInfo('i9', '#planner-farm-name')
        ]
    },
    {
        id: 'j',
        prepare() {
            tutCloseModals();
            if (!tutPlannerShown()) tutOpenDemoPlanner();
        },
        steps: [
            tutClick('j1', '#exit-btn', () => !tutPlannerShown()),
            tutClick('j2', '#app-settings-btn', () => tutModalOpen('app-settings-modal')),
            tutInfo('j3', '#app-settings-modal .language-options'),
            tutInfo('j4', () => { const el = tq('#discord-rpc-toggle'); return el ? (el.closest('label') || el) : null; }),
            tutInfo('j8', () => { const el = tq('#update-check-toggle'); return [el ? (el.closest('label') || el) : null, tq('#check-updates-btn')].filter(Boolean); }),
            tutInfo('j5', '#replay-tutorial-btn'),
            tutClick('j6', '#close-app-settings-btn', () => !tutModalOpen('app-settings-modal')),
            tutInfo('j7', null)
        ]
    }
];

// ---------- chapter progress ----------
function tutDoneChapters() {
    try {
        const arr = JSON.parse(getSetting(CONFIG_KEY_TUTORIAL_CHAPTERS) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

function tutMarkChapterDone(id) {
    const done = tutDoneChapters();
    if (done.includes(id)) return;
    done.push(id);
    try { setSetting(CONFIG_KEY_TUTORIAL_CHAPTERS, JSON.stringify(done)); } catch { /* per-viewer nicety only */ }
}

// ---------- targets & layout ----------
function tutCurrentStep() {
    if (tut.mode !== 'step') return null;
    const chapter = TUTORIAL_CHAPTERS[tut.chapterIdx];
    return chapter ? chapter.steps[tut.stepIdx] : null;
}

// Resolves a step target (selector, element, function, or an array of those)
// to the list of visible elements it covers.
function tutResolveTargets(target) {
    if (!target) return [];
    let value = typeof target === 'function' ? target() : target;
    const list = Array.isArray(value) ? value : [value];
    return list
        .map(v => (typeof v === 'string' ? tq(v) : v))
        .filter(el => el && tutIsShown(el));
}

// The part of an element actually visible — clipped by every scrolling
// ancestor (the fields table and modal bodies scroll on their own).
function tutVisibleRect(el) {
    const r = el.getBoundingClientRect();
    let top = r.top, left = r.left, right = r.right, bottom = r.bottom;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const pr = p.getBoundingClientRect();
        top = Math.max(top, pr.top); left = Math.max(left, pr.left);
        right = Math.min(right, pr.right); bottom = Math.min(bottom, pr.bottom);
    }
    return (right - left > 0 && bottom - top > 0) ? { top, left, right, bottom } : null;
}

function tutUnionRect(elements) {
    let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
    elements.forEach(el => {
        const r = tutVisibleRect(el);
        if (!r) return;
        top = Math.min(top, r.top); left = Math.min(left, r.left);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    });
    if (right - left <= 0 || bottom - top <= 0) return null;
    return { top, left, right, bottom };
}

function tutPlaceBlockers(hole, blockHole) {
    if (!tutorialBlockers) return;
    const set = (el, top, left, width, height) => {
        el.style.top = top + 'px';
        el.style.left = left + 'px';
        el.style.width = Math.max(0, width) + 'px';
        el.style.height = Math.max(0, height) + 'px';
    };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!hole) {
        set(tutorialBlockers.top, 0, 0, vw, vh);
        set(tutorialBlockers.bottom, 0, 0, 0, 0);
        set(tutorialBlockers.left, 0, 0, 0, 0);
        set(tutorialBlockers.right, 0, 0, 0, 0);
        tutorialBlockers.hole.style.display = 'none';
        return;
    }
    set(tutorialBlockers.top, 0, 0, vw, hole.top);
    set(tutorialBlockers.bottom, hole.top + hole.height, 0, vw, vh - hole.top - hole.height);
    set(tutorialBlockers.left, hole.top, 0, hole.left, hole.height);
    set(tutorialBlockers.right, hole.top, hole.left + hole.width, vw - hole.left - hole.width, hole.height);
    set(tutorialBlockers.hole, hole.top, hole.left, hole.width, hole.height);
    tutorialBlockers.hole.style.display = blockHole ? 'block' : 'none';
}

function positionTutorialStep() {
    if (!tut.active || !tutorialSpotlight || !tutorialBubble) return;
    const step = tutCurrentStep();
    const rect = step ? tutUnionRect(tutResolveTargets(step.target)) : null;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;
    const bubbleRect = tutorialBubble.getBoundingClientRect();

    if (tutorialHint && step) {
        const missing = !!step.target && !rect;
        tutorialHint.classList.toggle('is-missing', missing);
        tutorialHint.innerHTML = missing ? escapeTutText(t('tutHintMissing')) : tutHintText(step);
        if (tutorialShowMeBtn) tutorialShowMeBtn.style.display = (step.type !== 'info' || missing) ? '' : 'none';
    }

    if (!rect) {
        tutorialSpotlight.style.top = (vh / 2) + 'px';
        tutorialSpotlight.style.left = (vw / 2) + 'px';
        tutorialSpotlight.style.width = '0px';
        tutorialSpotlight.style.height = '0px';
        tutorialSpotlight.classList.remove('is-action');
        tutorialBubble.style.top = Math.max(margin, (vh - bubbleRect.height) / 2) + 'px';
        tutorialBubble.style.left = Math.max(margin, (vw - bubbleRect.width) / 2) + 'px';
        tutPlaceBlockers(null);
        return;
    }

    const pad = 6;
    const top = Math.max(0, rect.top - pad);
    const left = Math.max(0, rect.left - pad);
    const width = Math.min(vw, rect.right + pad) - left;
    const height = Math.min(vh, rect.bottom + pad) - top;
    tutorialSpotlight.style.top = top + 'px';
    tutorialSpotlight.style.left = left + 'px';
    tutorialSpotlight.style.width = width + 'px';
    tutorialSpotlight.style.height = height + 'px';
    tutorialSpotlight.classList.toggle('is-action', step.type !== 'info');
    tutPlaceBlockers({ top, left, width, height }, step.type === 'info');

    // Prefer below the target, then above, then beside it (large targets
    // like the fields table leave no room vertically).
    let bTop;
    let bLeft = left + width / 2 - bubbleRect.width / 2;
    if (top + height + margin + bubbleRect.height <= vh - margin) {
        bTop = top + height + margin;
    } else if (top - margin - bubbleRect.height >= margin) {
        bTop = top - margin - bubbleRect.height;
    } else {
        bTop = top + height / 2 - bubbleRect.height / 2;
        bLeft = (left + width + margin + bubbleRect.width <= vw - margin)
            ? left + width + margin
            : left - margin - bubbleRect.width;
    }
    bTop = Math.min(Math.max(margin, bTop), vh - bubbleRect.height - margin);
    bLeft = Math.min(Math.max(margin, bLeft), vw - bubbleRect.width - margin);
    tutorialBubble.style.top = bTop + 'px';
    tutorialBubble.style.left = bLeft + 'px';
}

function escapeTutText(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Tutorial copy refers to on-screen icons by symbol (◀ ▶ ⟳ ✕); render those
// as the matching Font Awesome icons so the text matches what the user sees.
const TUT_TEXT_ICONS = { '◀': 'chevron-left', '▶': 'chevron-right', '⟳': 'rotate', '✕': 'xmark' };
function tutRichText(str) {
    return escapeTutText(str).replace(/[◀▶⟳✕]/g, ch => `<i class="fa-solid fa-${TUT_TEXT_ICONS[ch]}" aria-hidden="true"></i>`);
}

function tutHintText(step) {
    if (step.type === 'click') return '<i class="fa-solid fa-hand-pointer" aria-hidden="true"></i> ' + escapeTutText(t('tutHintClick'));
    if (step.type === 'input') {
        const el = tutResolveTargets(step.target)[0];
        return '<i class="fa-solid fa-pen" aria-hidden="true"></i> ' + escapeTutText(t(el && el.tagName === 'SELECT' ? 'tutHintSelect' : 'tutHintType'));
    }
    return '';
}

// ---------- flow ----------
function tutRestartBubbleAnimation() {
    if (!tutorialBubble) return;
    tutorialBubble.classList.remove('is-animating');
    void tutorialBubble.offsetWidth;
    tutorialBubble.classList.add('is-animating');
}

function tutLeaveStep() {
    const step = tutCurrentStep();
    if (step && step.leave) step.leave();
}

function showTutorialStep() {
    const chapter = TUTORIAL_CHAPTERS[tut.chapterIdx];
    const step = tutCurrentStep();
    if (!chapter || !step) return;
    tut.advancing = false;
    if (step.enter) step.enter();

    if (tutorialStepView) tutorialStepView.style.display = '';
    if (tutorialMenuView) tutorialMenuView.style.display = 'none';
    if (tutorialStepCount) tutorialStepCount.innerText = fillTemplate(t('tutStepOf'), {
        chapter: t('tut_ch_' + chapter.id), current: tut.stepIdx + 1, total: chapter.steps.length
    });
    if (tutorialTitle) tutorialTitle.innerHTML = tutRichText(t(`tut_${step.id}_t`));
    if (tutorialText) tutorialText.innerHTML = tutRichText(t(`tut_${step.id}_x`));

    const prev = chapter.steps[tut.stepIdx - 1];
    if (tutorialPrevBtn) tutorialPrevBtn.style.display = (prev && prev.type === 'info' && !prev.enter) ? '' : 'none';
    if (tutorialNextBtn) {
        tutorialNextBtn.style.display = step.type === 'click' ? 'none' : '';
        const isLast = tut.stepIdx === chapter.steps.length - 1;
        tutorialNextBtn.innerText = isLast && (!tut.runAll || tut.chapterIdx === TUTORIAL_CHAPTERS.length - 1) ? t('tutFinish') : t('tutNext');
    }
    tutRestartBubbleAnimation();

    // Multi-element targets (a column, both rows of a split field) scroll to
    // the first one at the top so as many of the rest as possible fit.
    const targets = tutResolveTargets(step.target);
    if (targets[0]) targets[0].scrollIntoView({ block: targets.length > 1 ? 'start' : 'nearest' });
    tutEvaluateStep();
    positionTutorialStep();
}

// Called on every click / input / change and on the 200 ms tick.
function tutEvaluateStep() {
    const step = tutCurrentStep();
    if (!step || tut.advancing) return;
    if (step.type === 'input') {
        if (tutorialNextBtn) tutorialNextBtn.disabled = !step.check();
    } else if (step.type === 'click') {
        if (step.check()) {
            tut.advancing = true;
            setTimeout(() => { if (tutCurrentStep() === step) tutorialNext(); }, 350);
        }
    } else if (tutorialNextBtn) {
        tutorialNextBtn.disabled = false;
    }
}

function tutorialNext() {
    const chapter = TUTORIAL_CHAPTERS[tut.chapterIdx];
    const step = tutCurrentStep();
    if (!chapter || !step) return;
    // Commit a half-typed value (inputs save on change / blur).
    if (document.activeElement && document.activeElement !== document.body && !tutorialBubble.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    if (step.type === 'input' && !step.check()) return;

    tutLeaveStep();
    if (tut.stepIdx < chapter.steps.length - 1) {
        tut.stepIdx++;
        showTutorialStep();
        return;
    }

    tutMarkChapterDone(chapter.id);
    if (tut.runAll && tut.chapterIdx < TUTORIAL_CHAPTERS.length - 1) {
        startTutorialChapter(tut.chapterIdx + 1, true);
    } else if (tut.runAll) {
        endTutorial();
    } else {
        showTutorialMenu();
    }
}

function tutorialPrev() {
    const chapter = TUTORIAL_CHAPTERS[tut.chapterIdx];
    if (!chapter || tut.stepIdx <= 0) return;
    const prev = chapter.steps[tut.stepIdx - 1];
    if (prev.type !== 'info' || prev.enter) return;
    tutLeaveStep();
    tut.stepIdx--;
    showTutorialStep();
}

function tutorialShowMe() {
    const step = tutCurrentStep();
    if (!step) return;
    const el = tutResolveTargets(step.target)[0];
    if (!el) {
        // The element is gone (a modal was closed, the view changed…) — the
        // safest recovery is to replay the chapter from its start.
        startTutorialChapter(tut.chapterIdx, tut.runAll);
        return;
    }
    if (step.auto) step.auto(el);
    else if (step.type === 'click') el.click();
    setTimeout(tutEvaluateStep, 60);
}

function startTutorialChapter(idx, runAll) {
    const chapter = TUTORIAL_CHAPTERS[idx];
    if (!chapter) return;
    tutLeaveStep();
    tut.mode = 'step';
    tut.chapterIdx = idx;
    tut.stepIdx = 0;
    tut.runAll = !!runAll;
    chapter.prepare();
    showTutorialStep();
}

function renderTutorialMenu() {
    if (!tutorialChapterList) return;
    const done = tutDoneChapters();
    tutorialChapterList.innerHTML = '';
    TUTORIAL_CHAPTERS.forEach((chapter, idx) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tutorial-chapter-btn' + (done.includes(chapter.id) ? ' is-done' : '');
        btn.innerHTML = `<span class="tutorial-chapter-name"></span><span class="tutorial-chapter-meta"></span>`;
        btn.querySelector('.tutorial-chapter-name').textContent = t('tut_ch_' + chapter.id);
        btn.querySelector('.tutorial-chapter-meta').innerHTML = done.includes(chapter.id) ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : String(chapter.steps.length);
        btn.addEventListener('click', () => startTutorialChapter(idx, false));
        li.appendChild(btn);
        tutorialChapterList.appendChild(li);
    });
}

function showTutorialMenu() {
    tutLeaveStep();
    tut.mode = 'menu';
    tut.advancing = false;
    tutCloseModals();
    if (tutorialStepView) tutorialStepView.style.display = 'none';
    if (tutorialMenuView) tutorialMenuView.style.display = '';
    renderTutorialMenu();
    tutRestartBubbleAnimation();
    positionTutorialStep();
}

function startTutorial() {
    tutCloseModals();
    tutGoToDashboard();
    tut.active = true;
    if (tutorialOverlay) tutorialOverlay.style.display = 'block';
    clearInterval(tut.timer);
    // Keeps the spotlight glued to its target through fade-ins, re-renders
    // and scrolling, and catches state changes that don't fire DOM events.
    tut.timer = setInterval(() => { positionTutorialStep(); tutEvaluateStep(); }, 200);
    showTutorialMenu();
}

function endTutorial() {
    if (!tut.active) return;
    tutLeaveStep();
    tut.active = false;
    tut.mode = null;
    clearInterval(tut.timer);
    if (tutorialOverlay) tutorialOverlay.style.display = 'none';
    setSetting(CONFIG_KEY_TUTORIAL_DONE, '1');
    tutCloseModals();
    tutGoToDashboard();
    removeDemoFarm();
    renderFarmList(getAllFarms());
}

if (tutorialNextBtn) tutorialNextBtn.addEventListener('click', tutorialNext);
if (tutorialPrevBtn) tutorialPrevBtn.addEventListener('click', tutorialPrev);
if (tutorialShowMeBtn) tutorialShowMeBtn.addEventListener('click', tutorialShowMe);
if (tutorialMenuBtn) tutorialMenuBtn.addEventListener('click', showTutorialMenu);
if (tutorialRunAllBtn) tutorialRunAllBtn.addEventListener('click', () => startTutorialChapter(0, true));
if (tutorialCloseBtn) tutorialCloseBtn.addEventListener('click', endTutorial);
window.addEventListener('resize', positionTutorialStep);

// Capture phase + a short delay so the app's own handlers run before we check.
['click', 'input', 'change'].forEach(type => {
    document.addEventListener(type, () => {
        if (tut.active && tut.mode === 'step') setTimeout(tutEvaluateStep, 60);
    }, true);
});

document.addEventListener('keydown', (e) => {
    if (!tut.active) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (tut.mode === 'menu') endTutorial(); else showTutorialMenu();
        return;
    }
    const step = tutCurrentStep();
    const typing = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (!step || step.type !== 'info' || typing) return;
    if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); tutorialNext(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); tutorialPrev(); }
}, true);
