// =============================================================
// SECTION 1: IMPORTS AND CONFIGURATION
// =============================================================
const fs = require('fs');
const path = require('path');
const { webUtils, ipcRenderer } = require('electron');
const { readFieldSoilFromSave, readFarmlandAreas } = require('./savegame-soil');
const animalImages = require('./animal-images');
const modFiles = require('./mod-files');
const { readMapCrops } = require('./map-crops');
const { readAnimalMods, easFoodFactor } = require('./animal-mods');
const { pathToFileURL } = require('url');

// Bundled game data (default crops/animals, nitrogen by soil) lives in /data.
// __dirname here is the folder of index.html (src/renderer).
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// Resolved by the main process — Documents\Farmer Planner, with a one-time
// migration from the old %APPDATA%\FarmerPlanner location handled there. Falls
// back to the legacy path if the IPC ever fails so the app still starts.
const appDataDir = ipcRenderer.sendSync('get-data-dir') || path.join(
    process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share"),
    'FarmerPlanner'
);

if (!fs.existsSync(appDataDir)) {
    try { fs.mkdirSync(appDataDir, { recursive: true }); }
    catch (err) { console.error("Błąd tworzenia folderu!", err); }
}

// =============================================================
// SECTION 1A: LANGUAGE / TRANSLATIONS
// =============================================================
const CONFIG_KEY_LANG = 'farmer_planner_language';
const CONFIG_KEY_AUTO_SYNC = 'farmer_planner_auto_sync';
const CONFIG_KEY_DISCORD_RPC = 'farmer_planner_discord_rpc';
const CONFIG_KEY_TUTORIAL_DONE = 'farmer_planner_tutorial_done';

const TRANSLATIONS = {
    en: {
        appSettings: "Settings",
        myFarms: "My Farms",
        addFarm: "ADD FARM +",
        deleteFarm: "DELETE FARM",
        importBackup: "IMPORT BACKUP",
        exportBackup: "Export backup",
        exportSuccess: "Backup exported successfully.",
        exportError: "Could not save the backup file.",
        importErrorRead: "Could not read that file — make sure it's a valid backup .json.",
        importErrorFormat: "That file doesn't look like a Farmer Planner backup.",
        importSuccess: "Backup imported as a new farm.",
        deleteErrorNotFound: "Couldn't delete — that farm wasn't found (try reopening the app).",
        deleteErrorNoFolder: "Couldn't delete — this farm's data is missing its folder reference.",
        deleteErrorMissingOnDisk: "Couldn't delete — the farm's folder no longer exists on disk.",
        deleteErrorLocked: "Couldn't delete — the folder is locked by the system or open in another program.",
        cancelDelete: "CANCEL DELETE",
        noFarmsYet: "No farms yet. Add your first one below to start tracking a season.",
        lastEdited: "Last edited",
        balance: "BALANCE",
        month: "MONTH",
        yearLabel: "YEAR",
        newSeason: "NEW SEASON",
        editSeason: "EDIT SEASON",
        edit: "EDIT",
        saveChanges: "SAVE CHANGES",
        season: "Season",
        thFieldNo: "Field No.",
        thFieldHa: "Field Ha",
        thCrop: "Crop",
        thSowingMth: "Sowing Mth",
        thState: "State",
        thTillage: "Tillage",
        tillagePlowed: "Plowed",
        tillageNoTill: "No-till",
        thSoil: "Soil",
        thHa: "Ha",
        totalPlantedArea: "Total planted area",
        farmDetails: "Farm Details",
        detailBalance: "Balance",
        detailCredit: "Credit",
        bankCreditLabel: "Bank And Credit (mod)",
        bankCreditValue: "{n} active loan(s) · {m} € / month",
        bankCreditNone: "no active loans",
        detailHaAmount: "Ha amount",
        detailFarmAge: "Playtime",
        detailFields: "Fields",
        detailCrops: "Crops",
        detailEquipment: "Equipment",
        detailAnimals: "Animals",
        cropsListTitle: "List of all crops that are being farmed",
        resetSeasons: "RESET SEASONS",
        settings: "SETTINGS",
        exit: "EXIT",
        settingsTitle: "Settings",
        gameSavePathLabel: "Game Save Path (careerSavegame.xml):",
        gameSavePathPlaceholder: "Path to careerSavegame.xml",
        cropsFolderLabel: "Crops folder (map's uprawaX.xml / fruitType files):",
        cropsFolderHint: "Usually not needed — when the farm is linked to a savegame, the map mod's crops (and their order in the game menu) are read automatically. Pick a folder only for a map the app can't read (base-game map, missing mod) or to override a crop's calendar; subfolders are scanned automatically.",
        noFolderSelected: "No folder selected",
        autoSyncLabel: "Auto-sync with the savegame while playing",
        autoSyncHint: "The game only writes the save on manual save / autosave, so the planner refreshes at each (auto)save — not continuously. Lower the autosave interval in-game for fresher data.",
        autoSyncedToast: "Synced from savegame",
        saveAndImport: "SAVE & IMPORT",
        cancel: "CANCEL",
        appSettingsTitle: "Settings",
        languageLabel: "Language",
        close: "Close",
        addNewFarmTitle: "Add new farm",
        farmNamePlaceholder: "Farm name (e.g. Riverbend)",
        farmNameLabel: "Farm name:",
        farmMapLabel: "Map for this farm:",
        farmMapPlaceholder: "e.g. Solek, Zielonka, Riverbend",
        add: "Add",
        areYouSure: "Are you sure?",
        deleteFarmConfirm: "Do you really want to delete this farm? This action cannot be undone.",
        delete: "DELETE",
        planted: "Planted",
        plantNow: "Plant now",
        toPlant: "To plant",
        split: "Split",
        rotationWarning: "Same crop as last season on this field — consider rotating to keep the soil healthy",
        haNotAssigned: "ha not yet assigned",
        overBy: "over by",
        limeTitle: "Lime",
        limeTitleActive: "Lime — {pct}% pH, applied season {season}",
        limeTitleWarning: "needs attention",
        limeEditTitle: "Lime — click to toggle",
        manureTitle: "Manure / slurry",
        fertilizerTitle: "Synthetic fertilizer",
        limeLetter: "L",
        manureLetter: "M",
        fertilizerLetter: "F",
        navPlan: "Plan",
        barnAllBuildings: "All buildings",
        barnOpenDetails: "Details",
        barnRename: "Rename",
        barnHeads: "animals",
        barnHerd: "Herd",
        barnAge: "{m} months old",
        barnDaysLeft: "days of feed",
        barnTroughCapacity: "Trough capacity",
        barnHowCalculated: "Where do these numbers come from?",
        barnReproduction: "Reproduction",
        reproProgress: "Pregnancy",
        reproPregnant: "Pregnant",
        reproPregnantOf: "females pregnant",
        reproMonthsToBirth: "months to birth",
        reproDue: "birth in ~{m} mo.",
        reproDueNow: "birth this month",
        reproYoung: "Too young to breed — from {m} mo.",
        reproTooYoung: "Too young",
        reproLowHealth: "Health too low to breed (min. {h}%)",
        repro_waiting: "Not inseminated",
        repro_ready: "Ready to breed",
        repro_male: "Male",
        reproLastBirth: "Last birth {m} mo. ago",
        reproWaitingHint: "Old and healthy enough, but the game hasn't marked them inseminated — check there's a male of the same breed in this building.",
        barnNeedsUnknown: "No food/water/straw data for some breeds in this building. If they come from a mod, import its animal definitions in Farm settings.",
        hubFinance: "Finance",
        hubAnimals: "Animals",
        hubEquipment: "Equipment",
        hubComingSoon: "Fuller tracking for this is coming in a future update.",
        hubChartNeedsMoreSeasons: "Finish at least one more season to see a trend chart here.",
        hubChartNeedsMoreMonths: "Play through at least one more in-game month (with auto-sync on, or by reopening the farm) to see a trend chart here.",
        hubMonthlyTrend: "Monthly trend",
        hubSeasonTrend: "Per season",
        hubMilkProduced: "Produced per month (est.)",
        hubProductionProxyNote: "Estimated from the month-over-month rise in stored litres — a rough proxy, since the save only records current storage, not true output.",
        hubStoredProduction: "Currently stored",
        hubNoAnimalsYet: "No animal data yet — open Settings, point to your careerSavegame.xml and import.",
        hubFeedLow: "Feed low!",
        hubHealth: "Health",
        hubFeedLevel: "Feed level",
        hubNoFeedTracked: "No feed data tracked for this building.",
        hubApproxLevelsNote: "Feed bars are relative to your fullest building of that feed type — the save doesn't record real storage capacity, so treat these as \"which pen is running low\", not an exact percentage.",
        hubDailyRateNote: "Daily milk/egg output isn't shown yet — that needs each breed's production curve (from the game's animals.xml), which isn't wired up as an import yet. Ask if you'd like that added next.",
        hubNoProductionCurves: "Your animal definitions don't include recognizable production curves (milk/egg/wool), so estimated daily output can't be shown for these breeds yet.",
        hubProductionEstNote: "Estimated from each breed's production curve — real output can vary with the animal's condition and the game's own randomness.",
        hubEstDailyOutput: "Estimated daily output",
        avgHealthLabel: "Avg. health",
        perDayShort: "/day",
        animalBreedsLoaded: "Animal breeds loaded",
        noAnimalDefsYet: "No animal definitions loaded yet.",
        animalDefsFolderLabel: "Animal definitions folder (game's animals.xml):",
        animalDefsFolderHint: "Optional — the base FS25 animals already work out of the box, no import needed. This is only for a map/mod that adds its own animal breeds; it's usually in the base game's install folder, not your map folder — separate from Crops above since they're often in completely different places.",
        hubDailyNeed: "Daily requirement",
        hubRation: "Ration",
        hubRationStockDays: "in storage for {d} days",
        hubRationNoStock: "none in storage",
        hubRationNote: "Ration is shared with the Feed planner. Its efficiency scales the estimated milk, eggs and wool (manure and slurry don't change); storage days use the whole farm's need for that ingredient.",
        hubDaysRemaining: "days left at current stock",
        capacityLabel: "capacity",
        combineNumbersHint: "Combine several field numbers into one row, e.g. 69-70-71",
        fieldSizeLabel: "Field size (ha)",
        addNewField: "+ ADD NEW FIELD",
        usedByOthersHere: "Used by other crop(s) here",
        stillFree: "ha still free",
        overFieldSizeBy: "over field size by",
        currentlyLoaded: "Currently loaded",
        noPlannedCrops: "No crops planned yet. Assign crops to fields in EDIT SEASON — this list fills in by itself.",
        cropsSortGame: "Game order · click a header to sort",
        catchCropsTitle: "Catch crops",
        catchCropNone: "-- None --",
        thCatchCrop: "Catch crop",
        thCatchSowingMth: "Catch crop sowing",
        catchCropHint: "A crop grown on the same field before or after the main crop (green rye, oilseed radish…). Listed separately in the crops summary so its area isn't counted twice.",
        catchCropShort: "catch crop",
        cropsFromMapMod: "Crop list and order read automatically from map mod {mod}.",
        cropsLoaded: "crop(s).",
        noCropsLoadedYet: "No crops loaded yet.",
        readyToScan: "Ready to scan",
        clickSaveImport: "file(s) — click SAVE & IMPORT.",
        selectCropFirst: "-- Select Crop First --",
        selectMonth: "-- Select Month --",
        selectPlaceholder: "-- Select --",
        of: "of",
        totalHa: "ha total",
        discordSettingLabel: "Discord Rich Presence",
        discordSettingHint: "Show your current farm and field count on your Discord profile.",
        discordBrowsing: "Browsing farms",
        discordManagingFields: "Managing {n} {fields}",
        discordFieldOne: "field",
        discordFieldFew: "fields",
        discordFieldMany: "fields",
        discordOnFarm: "Farm: {name}",
        discordFarmCount: "{n} {farms} tracked",
        discordFarmOne: "farm",
        discordFarmFew: "farms",
        discordFarmMany: "farms",

        hubSupplies: "Supplies",
        hubFieldSoil: "Field soil type",
        fieldSoilEmpty: "This farm has no fields with a number or area yet. Add fields in EDIT SEASON, then set their soil here.",
        fieldSoilImportBtn: "Load soils from the game",
        fieldSoilImportHint: "Reads the soil map from your savegame and the field outlines from the map (without field margins) — the same % Precision Farming shows in-game. Overwrites the values below for every field found.",
        fieldSoilImportNoPath: "Set the path to careerSavegame.xml in Settings first.",
        fieldSoilImportDone: "Loaded soils for {n} fields from map \"{map}\".",
        fieldSoilImportMissing: "Not found on the map (left unchanged): {list}.",
        fieldSoilImportArea: "Area differs from the map outline: {list}.",
        fieldSoilImportFail: "Couldn't read soils from the game ({reason}).",
        fieldSoilImportReasons: { nosave: "savegame file not found", nomapid: "no map in careerSavegame.xml", nomod: "map mod {mod} not found in any mods folder (default, gameSettings override or Mod Assistant collections)", nomap: "map file not found in {mod}", nofields: "map has no field outlines / farmland layer", nosoil: "no soil map (is Precision Farming enabled?)", parse: "file read error" },
        suppliesSoilHint: "Set each field's soil type in the sidebar → Field soil type.",
        suppliesTitle: "Season supplies",
        suppliesIntro: "How much to buy for Season {n} so you don't run short mid-season — one row per field, with the crop taken from that field in the season table. Seed is in litres; fertilizer is shown in litres and kilograms of nitrogen (Precision Farming's model), sourced from each field's own fertilization plan.",
        suppliesNoCrops: "No crops planned for this season yet. Assign crops to fields in EDIT SEASON, then come back here.",
        suppliesPlannedArea: "Planned crop area",
        suppliesFieldsToSow: "Fields still to sow",
        suppliesSeeds: "Seeds",
        suppliesFertilizer: "Fertilizer",
        suppliesColField: "Field",
        suppliesColCrop: "Crop",
        suppliesColArea: "Area",
        suppliesColRate: "Rate",
        suppliesColNeed: "Buy",
        suppliesColSoil: "Soil",
        suppliesColTargetN: "Target N",
        suppliesColExistingN: "Existing N",
        suppliesColOrgN: "Natural N",
        suppliesColMineralN: "Mineral",
        suppliesFillPlanCta: "Fill in plan",
        suppliesFillPlanHint: "No fertilization plan yet for this field — open it to enter existing/natural nitrogen.",
        suppliesNoPlanNote: "{n} field(s) still need a fertilization plan — not included in the totals above.",
        suppliesTotal: "Total",
        suppliesBufferNote: "Every total includes a {p}% reserve on top of the exact requirement.",
        suppliesSeedRateUnit: "l/ha",
        suppliesNRateUnit: "kg N/ha",
        suppliesNDensityNote: "at {d} kg N / l",
        suppliesAllSown: "Every planned field is already sown — no seed to buy.",
        suppliesNoFert: "No fields are marked for fertilizer. Enable “assume every crop gets fertilized” in Settings, or set the F chip on fields.",
        suppliesUnknownRate: "no built-in rate — using {v} l/ha",
        suppliesAdjust: "Adjust rates",
        suppliesBuffer: "Reserve buffer (%)",
        suppliesNDensity: "Fertilizer N content (kg N / l)",
        suppliesAssumeAllFert: "Assume every crop gets fertilized",
        suppliesPerCropRates: "Per-crop rates",
        suppliesResetRates: "Reset to defaults",
        suppliesEstimateNote: "Defaults are estimates for a full season at high yield. Tune them to your map, mods and Precision Farming's on-field readout.",
        suppliesSoilPerField: "Field soil type (Precision Farming)",
        suppliesSoilYield: "{p}% yield",
        suppliesSoilNote: "Enter each field's soil-type share in % — the ratio is what counts, the values need not sum to 100. Fields left blank use {d}. The fertilizer N rate is a share-weighted average across the field's soils, each scaled by its yield potential.",
        suppliesSoilFileNote: "Per-crop, per-soil nitrogen rates come from nitrogen-by-soil.json next to the app — edit that file to match your map.",
        suppliesOrgManure: "Manure",
        suppliesOrgSlurry: "Slurry",
        suppliesOrgDigestate: "Digestate",
        suppliesManureN: "Manure N (kg N/l)",
        suppliesSlurryN: "Slurry N (kg N/l)",
        suppliesDigestateN: "Digestate N (kg N/l)",
        thFertPlan: "Plan",
        fertPlanBtn: "Fertilizer",
        fertPlanTitle: "Fertilization plan",
        fertPlanIntro: "The nitrogen target for this field's crop and soil, minus what's already in the soil and what your natural fertilizer covers, leaves the mineral fertilizer to apply.",
        fertPlanColTarget: "Nitrogen requirement",
        fertPlanColExisting: "Nitrogen already in the soil",
        fertPlanColOrg: "Nitrogen from natural fertilizer",
        fertPlanColMineralN: "Nitrogen still needed (mineral)",
        fertPlanColMineralL: "Mineral fertilizer dose",
        fertPlanColStatus: "Nitrogen balance",
        fertPlanCovered: "Requirement covered",
        fertPlanMineralAdd: "+{n} kg N/ha still needed",
        fertPlanOrgVolHint: "That's the same nitrogen as:",
        fertPlanNote: "Start with how much nitrogen is already on the field (a soil-test reading, leftover from the previous crop, or fertilizer already spread) — that's subtracted from the requirement first. Then enter the natural-fertilizer contribution as kg N/ha (your estimate of what manure / slurry / digestate delivers) — the app shows how many litres of each that dose equals, using the N-per-litre rates from Supplies → Adjust rates. Mineral fertilizer auto-fills whatever's still short of the requirement; its litres come from the fertilizer N content, its total includes the buffer. Set the field's soil mix in \"Field soil type\".",
        fertPlanTreatmentsTitle: "Treatments",
        fertPlanManureApplied: "Manure / slurry applied",
        fertPlanFertilizerApplied: "Synthetic fertilizer applied",
        fertPlanTreatmentsNote: "These checkmarks feed the Supplies shopping list — they don't change the nitrogen numbers above.",

        hubNotes: "Notes",
        notesTitle: "Notes",

        hubYieldForecast: "Predicted yields",
        yieldForecastTitle: "Predicted yields",
        yieldForecastIntro: "Predicted harvest for every crop planned this season — planted or still just \"To Plant\" — assuming ideal nitrogen, ideal soil pH and no weeds: the ceiling your fields' soil allows, one row per crop across every matching field.",
        yieldForecastColCrop: "Crop",
        yieldForecastColArea: "Area",
        yieldForecastColYield: "Predicted yield",
        yieldForecastEmpty: "No crops assigned to any field yet.",
        yieldForecastUnknownFlag: "No yield data for this crop — total is missing this field's contribution.",
        yieldForecastUnknownNote: "{n} crop(s) have no known yield rate — their totals are underestimated.",
        yieldForecastNote: "An upper bound, not a forecast: real yield is lower whenever nitrogen, pH or weeds aren't perfect.",
        notesAdd: "+ ADD NOTE",
        notesEmpty: "No notes yet. Add one to get reminded when the month comes around.",
        notesTitleLabel: "Title",
        notesTitlePlaceholder: "e.g. Fertilize field 3",
        notesBodyLabel: "Details (optional)",
        notesBodyPlaceholder: "Any extra detail...",
        notesMonthsLabel: "Months",
        notesTagsLabel: "Tags",
        notesTagsPlaceholder: "Type a tag and press Enter",
        notesChecklistLabel: "Checklist",
        notesAddChecklistItem: "+ Add item",
        notesChecklistItemPlaceholder: "Checklist item",
        notesSave: "SAVE NOTE",
        notesCancel: "CANCEL",
        notesEditTitle: "Edit note",
        notesNewTitle: "New note",
        notesDeleteConfirm: "Delete this note? This action cannot be undone.",
        notesThisMonthFilter: "This month",
        notesAllMonths: "All months",
        notesAllTags: "All tags",
        notesEdit: "Edit",
        notesDelete: "Delete",
        notesNoTitle: "Please enter a title for the note.",
        notesCurrentMonthBadge: "This month",
        hubFeedPlan: "Feed planner",
        feedPlanTitle: "Feed planner",
        feedPlanStock: "Feed in storage",
        feedColStock: "In storage",
        feedColFillType: "Fill type",
        feedSrc_silo: "Silos",
        feedSrc_bunker: "Bunker silos",
        feedSrc_bale: "Bales",
        feedSrc_pallet: "Pallets",
        feedSrc_mixer: "Feed mixers",
        feedProduct_PIGFOOD: "Pig food",
        feedProduct_FORAGE: "TMR (forage)",
        feedProduct_MINERAL_FEED: "Mineral feed",
        feedMixersTitle: "Feed mixers",
        feedMixerPerMonth: "up to {l} l / month",
        feedMixerForBarn: "for this barn",
        feedMixerNoneOn: "No recipe is switched on — the mixer isn't producing.",
        feedMixerRecipes: "Recipes: {on} of {n} on",
        feedMixerInputs: "Waiting to be mixed",
        feedMixerInputsEmpty: "No ingredients in the mixer.",
        feedMixersNote: "Feed and ingredients in the mixers count toward your stock above — pig food split like the game's mixture (base 50%, grain 25%, protein 20%, root crops 5%).",
        feedStockNoSave: "Set the path to careerSavegame.xml in Farm settings to read what's already in your silos and bales.",
        feedStockNotRead: "Stock not read yet — it appears after the next sync with the game save.",
        feedStockEmpty: "No feed found in silos, bunker silos, bales or pallets in the last game save.",
        feedStockNote: "From the last game save. All grain and oilseeds in your silos count as feed — including what you plan to sell. Wrapped grass bales count as silage; a bunker silo counts as silage whatever its fermentation stage.",
        feedPlanIntro: "Yearly feed need of your herd, split by the ration you choose for each species, against the harvest of the fields you set aside for feed. Litres throughout; the field yield is the soil-adjusted ceiling from \"Predicted yields\".",
        feedPlanRations: "Rations",
        feedPlanFields: "Feed fields",
        feedPlanBalance: "Yearly balance",
        feedPlanParams: "Parameters",
        feedColSpecies: "Species",
        feedColHead: "Head",
        feedColRation: "Ration",
        feedColEfficiency: "Efficiency",
        feedColYearNeed: "Feed / year",
        feedColUse: "Use",
        feedColStraw: "Bale straw",
        feedColYield: "Yield / year",
        feedColCategory: "Feed",
        feedColNeed: "Need / year",
        feedColHave: "From fields",
        feedColBalance: "Balance",
        feedStrawBedding: "Straw bedding",
        feedAnimal_COW: "Cows",
        feedAnimal_PIG: "Pigs",
        feedAnimal_SHEEP: "Sheep & goats",
        feedAnimal_HORSE: "Horses",
        feedAnimal_CHICKEN: "Chickens",
        feedRation_forage: "TMR (forage)",
        feedRation_hay: "Hay",
        feedRation_silage: "Silage",
        feedRation_grass: "Grass",
        feedRation_mix: "Standard mix",
        feedRation_grain: "Grain",
        feedCat_GRASS: "Grass",
        feedCat_HAY: "Hay",
        feedCat_SILAGE: "Silage",
        feedCat_STRAW: "Straw",
        feedCat_MINERAL: "Mineral feed",
        feedCat_PIG_BASE: "Maize / sorghum",
        feedCat_GRAIN: "Grain (wheat, barley)",
        feedCat_PROTEIN: "Protein (soy, canola, sunflower)",
        feedCat_EARTH: "Root crops",
        feedCat_OAT: "Oat",
        feedCat_ROUGHAGE: "Roughage (grass, hay, silage)",
        feedUse_sale: "Sale",
        feedUse_feed: "Feed",
        feedUse_silage: "Silage (chaff)",
        feedUse_grain: "Grain for feed",
        mixerTitle: "Mixer wagon",
        mixerClover: "clover",
        mixerAlfalfa: "alfalfa",
        mixerFromSave: "from savegame",
        mixerOwn: "your own",
        mixerNoCapacity: "capacity unknown",
        mixerNewWagon: "New mixer wagon",
        mixerWagonName: "Name",
        mixerWagonNamePh: "e.g. Rino FXL 1000",
        mixerCapacity: "Capacity",
        mixerNoWagons: "No mixer wagon found in the savegame — add your own with its capacity.",
        mixerEnterCapacity: "The game file for this wagon couldn't be read — enter its capacity:",
        mixerLoad: "Load",
        mixerLoadEmpty: "Nothing loaded yet — add bales and loose products, or fill the wagon automatically to the TMR recipe.",
        mixerOnFarm: "{n} on the farm",
        mixerPcs: "pcs",
        mixerTooManyBales: "You only have {n} of these bales on the farm.",
        mixerLoose: "loose",
        mixerAddBale: "Bale",
        mixerAddBulk: "Loose product",
        mixerNewBale: "Own bale type",
        mixerAuto: "Fill to recipe",
        mixerClear: "Clear",
        mixerNoBales: "No bales found in the savegame — add your own bale type with its litres.",
        mixerBaleName: "Bale name",
        mixerBaleNamePh: "e.g. Round 150 silage",
        mixerBaleContent: "Content",
        mixerBaleLitres: "Litres per bale",
        mixerBale: "Bale",
        mixerBaleRound: "Round {s}",
        mixerBaleSquare: "Square {s}",
        mixerResult: "Mix",
        mixerOfCapacity: "of {c} l capacity",
        mixerFill: "full",
        mixerOver: "{l} l over the wagon's capacity.",
        mixerRange: "allowed {a}–{b}%",
        mixerTarget: "your recipe",
        mixerValid: "Mix is within the TMR recipe — the wagon will make TMR.",
        mixerInvalid: "Outside the TMR recipe: {list}",
        mixerLasts: "Lasts about {d} days for this barn ({l} l/day).",
        feedCustomTitle: "Custom feeds",
        feedCustomGroup: "Custom feeds",
        feedCustomNew: "New feed",
        feedCustomName: "Name",
        feedCustomNamePh: "e.g. Winter mix",
        feedCustomIngredients: "Ingredients",
        feedCustomAddIng: "Add ingredient",
        feedCustomSum: "Total: {s}% (must be 100%)",
        feedCustomDeleteConfirm: "Delete this feed? Species using it go back to their default ration.",
        feedErrName: "Enter a name for the feed.",
        feedErrNoIng: "Add at least one ingredient.",
        feedErrDuplicate: "Each ingredient can only appear once.",
        feedErrPct: "Every ingredient needs a share above 0%.",
        feedErrEfficiency: "Efficiency must be between 1 and 100%.",
        feedNoFields: "No field grows a crop animals can eat. Assign grass, maize, grain, protein or root crops in EDIT SEASON.",
        feedBalanceEmpty: "Nothing to compare yet — no animals and no feed fields.",
        feedBuy: "Buy",
        feedMissingHa: "≈ {ha} ha missing",
        feedGrassCuts: "Grass cuts per year",
        feedChaffYield: "Maize chaff yield (l/ha)",
        feedStrawYield: "Straw yield (l/ha)",
        feedStrawYieldAuto: "from map data",
        feedUnknownAnimals: "{n} animal group(s) skipped — no feed data for their breed.",
        feedPlanNote: "Need = the animals' current-age daily feed curve × days per month (from the game save) × 12 months. Grassland harvest can become grass, hay or silage litre for litre, so it is counted where it is missing first. The maize chaff yield is an estimate — correct it after your first chopping. Efficiency shows how well a ration supports production (game productionWeight); it does not change how much the animals eat.",
        feedIntroShort: "Pick a barn, pick its feed — the tiles show what you have for a year (storage + planned harvest) and what's missing.",
        feedPickBarn: "Barn",
        feedPickRation: "Feed",
        feedIngredients: "Ingredients for a year",
        feedYouHave: "You have",
        feedStockShort: "storage",
        feedHarvestShort: "harvest",
        feedOfNeeded: "of {n} l needed",
        feedEnough: "Enough",
        feedMissing: "Missing",
        feedThisBarn: "This barn",
        feedPerYearShort: "/year",
        feedFoodPerYear: "feed / year",
        feedYearNeedFood: "Feed needed per year",
        feedYearNeedMonth: "Per in-game month",
        feedScaleBase: "base game: monthly need doesn't depend on days/month ({d})",
        feedScaleAfc: "AnimalFoodCalculator ×{x} ({d} days/month)",
        feedScaleEas: "EAS: more food after calving",
        animalModsLabel: "Animal mods in this savegame:",
        animalModsNoSave: "Link the savegame above to detect animal mods (AnimalFoodCalculator, EnhancedAnimalSystem).",
        animalModsNone: "No feed-changing animal mods active — base game rules ({d} days/month doesn't change monthly feed).",
        afcModeLine: "mode {mode}: feed ×{x}; curves: {src}",
        afcMode_vanilla: "Basegame (off)",
        afcMode_auto: "Auto (× days/month)",
        afcMode_manual: "Manual (× multiplier)",
        afcMode_hybrid: "Hybrid (× days × multiplier)",
        afcSource_custom: "AFC's own animals.xml",
        afcSource_animalpackage: "Animal Package",
        afcSource_basegame: "base game",
        afcSource_map: "map",
        afcSource_effective: "as loaded in game",
        easLine: "lactation food factor after calving for: {list}",
        farmlandAreaLabel: "Also show whole land plot area (farmland), not just the field",
        farmlandAreaHint: "Counted from the map like the game does (field plus margins); needs the savegame and the map mod.",
        farmlandPlot: "plot",
        farmlandTotal: "· land owned: {ha} ha ({n} plots)",
        modsDirInfo: "Mods folder: {dir}",
        modsDirInfoMore: "(+{n} more searched: gameSettings override / Mod Assistant collections)",
        feedSettings: "Settings — feed fields, parameters, custom feeds"
    },
    pl: {
        appSettings: "Ustawienia",
        myFarms: "Moje Farmy",
        addFarm: "DODAJ FARMĘ +",
        deleteFarm: "USUŃ FARMĘ",
        importBackup: "IMPORTUJ BACKUP",
        exportBackup: "Eksportuj backup",
        exportSuccess: "Backup wyeksportowany pomyślnie.",
        exportError: "Nie udało się zapisać pliku backupu.",
        importErrorRead: "Nie udało się odczytać pliku — upewnij się, że to prawidłowy plik backupu .json.",
        importErrorFormat: "Ten plik nie wygląda na backup Farmer Planner.",
        importSuccess: "Backup zaimportowany jako nowa farma.",
        deleteErrorNotFound: "Nie udało się usunąć — nie znaleziono tej farmy (spróbuj zrestartować aplikację).",
        deleteErrorNoFolder: "Nie udało się usunąć — dane tej farmy nie mają przypisanego folderu.",
        deleteErrorMissingOnDisk: "Nie udało się usunąć — folder farmy już nie istnieje na dysku.",
        deleteErrorLocked: "Nie udało się usunąć — folder jest zablokowany przez system albo otwarty w innym programie.",
        cancelDelete: "ANULUJ USUWANIE",
        noFarmsYet: "Brak farm. Dodaj pierwszą poniżej, żeby zacząć śledzić sezon.",
        lastEdited: "Ostatnia edycja",
        balance: "SALDO",
        month: "MIESIĄC",
        yearLabel: "ROK",
        newSeason: "NOWY SEZON",
        editSeason: "EDYTUJ SEZON",
        edit: "EDYTUJ",
        saveChanges: "ZAPISZ ZMIANY",
        season: "Sezon",
        thFieldNo: "Nr Pola",
        thFieldHa: "Ha Pola",
        thCrop: "Uprawa",
        thSowingMth: "Mies. Siewu",
        thState: "Stan",
        thTillage: "Orka/Bezorka",
        tillagePlowed: "Orka",
        tillageNoTill: "Bezorka",
        thSoil: "Gleba",
        thHa: "Ha",
        totalPlantedArea: "Łączna obsiana powierzchnia",
        farmDetails: "Szczegóły Farmy",
        detailBalance: "Saldo",
        detailCredit: "Kredyt",
        bankCreditLabel: "Bank And Credit (mod)",
        bankCreditValue: "aktywne kredyty: {n} · rata {m} € / mies.",
        bankCreditNone: "brak aktywnych kredytów",
        detailHaAmount: "Ilość ha",
        detailFarmAge: "Czas gry",
        detailFields: "Pola",
        detailCrops: "Uprawy",
        detailEquipment: "Sprzęt",
        detailAnimals: "Zwierzęta",
        cropsListTitle: "Lista wszystkich uprawianych roślin",
        resetSeasons: "RESETUJ SEZONY",
        settings: "USTAWIENIA",
        exit: "WYJŚCIE",
        settingsTitle: "Ustawienia",
        gameSavePathLabel: "Ścieżka zapisu gry (careerSavegame.xml):",
        gameSavePathPlaceholder: "Ścieżka do careerSavegame.xml",
        cropsFolderLabel: "Folder upraw (pliki uprawaX.xml / fruitType mapy):",
        cropsFolderHint: "Zwykle niepotrzebne — gdy farma jest połączona z zapisem gry, uprawy z moda mapy (i ich kolejność z menu gry) wczytują się automatycznie. Wybierz folder tylko dla mapy, której aplikacja nie odczyta (mapa podstawowa, brak moda), albo żeby nadpisać kalendarz uprawy; podfoldery są skanowane automatycznie.",
        noFolderSelected: "Nie wybrano folderu",
        autoSyncLabel: "Automatyczna synchronizacja z zapisem gry podczas grania",
        autoSyncHint: "Gra zapisuje stan na dysk tylko przy ręcznym zapisie / autozapisie, więc planer odświeża się przy każdym (auto)zapisie — nie na bieżąco. Skróć interwał autozapisu w grze, aby dane były świeższe.",
        autoSyncedToast: "Zsynchronizowano z zapisem gry",
        saveAndImport: "ZAPISZ I IMPORTUJ",
        cancel: "ANULUJ",
        appSettingsTitle: "Ustawienia",
        languageLabel: "Język",
        close: "Zamknij",
        addNewFarmTitle: "Dodaj nową farmę",
        farmNamePlaceholder: "Nazwa farmy (np. Solek)",
        farmNameLabel: "Nazwa farmy:",
        farmMapLabel: "Mapa tej farmy:",
        farmMapPlaceholder: "np. Solek, Zielonka, Riverbend",
        add: "Dodaj",
        areYouSure: "Czy na pewno?",
        deleteFarmConfirm: "Czy na pewno chcesz usunąć tę farmę? Tej operacji nie można cofnąć.",
        delete: "USUŃ",
        planted: "Obsiane",
        plantNow: "Siej teraz",
        toPlant: "Do obsiania",
        split: "Podział",
        rotationWarning: "Ta sama uprawa co w zeszłym sezonie na tym polu — rozważ zmianę dla dobra gleby",
        haNotAssigned: "ha jeszcze nieprzypisane",
        overBy: "przekroczono o",
        limeTitle: "Wapno",
        limeTitleActive: "Wapno — {pct}% pH, zaaplikowane w sezonie {season}",
        limeTitleWarning: "wymaga uwagi",
        limeEditTitle: "Wapno — kliknij, żeby przełączyć",
        manureTitle: "Obornik / gnojowica",
        fertilizerTitle: "Nawóz sztuczny",
        limeLetter: "W",
        manureLetter: "O",
        fertilizerLetter: "N",
        navPlan: "Plan",
        barnAllBuildings: "Wszystkie budynki",
        barnOpenDetails: "Szczegóły",
        barnRename: "Zmień nazwę",
        barnHeads: "zwierząt",
        barnHerd: "Stado",
        barnAge: "Wiek: {m} mies.",
        barnDaysLeft: "dni paszy",
        barnTroughCapacity: "Pojemność koryta",
        barnHowCalculated: "Skąd te liczby?",
        barnReproduction: "Reprodukcja",
        reproProgress: "Ciąża",
        reproPregnant: "Ciężarne",
        reproPregnantOf: "samic w ciąży",
        reproMonthsToBirth: "mies. do porodu",
        reproDue: "poród za ~{m} mies.",
        reproDueNow: "poród w tym miesiącu",
        reproYoung: "Za młode do rozrodu — od {m} mies.",
        reproTooYoung: "Za młode",
        reproLowHealth: "Za słabe zdrowie do rozrodu (min. {h}%)",
        repro_waiting: "Niezapłodnione",
        repro_ready: "Gotowe do rozrodu",
        repro_male: "Samiec",
        reproLastBirth: "Ostatni poród {m} mies. temu",
        reproWaitingHint: "Mają odpowiedni wiek i zdrowie, ale gra nie oznaczyła ich jako zapłodnione — sprawdź, czy w budynku jest samiec tej samej rasy.",
        barnNeedsUnknown: "Brak danych o paszy, wodzie i słomie dla części ras w tym budynku. Jeśli pochodzą z moda, zaimportuj jego definicje zwierząt w Ustawieniach farmy.",
        hubFinance: "Finanse",
        hubAnimals: "Zwierzęta",
        hubEquipment: "Sprzęt",
        hubComingSoon: "Pełniejsze śledzenie tego pojawi się w przyszłej aktualizacji.",
        hubChartNeedsMoreSeasons: "Zakończ jeszcze co najmniej jeden sezon, żeby zobaczyć tu wykres trendu.",
        hubChartNeedsMoreMonths: "Rozegraj jeszcze co najmniej jeden miesiąc w grze (z włączoną auto-synchronizacją albo otwierając farmę ponownie), żeby zobaczyć tu wykres trendu.",
        hubMonthlyTrend: "Trend miesięczny",
        hubSeasonTrend: "Wg sezonów",
        hubMilkProduced: "Produkcja na miesiąc (szac.)",
        hubProductionProxyNote: "Szacunek na podstawie miesięcznego przyrostu litrów w magazynie — przybliżenie, bo zapis gry rejestruje tylko bieżący stan magazynu, nie rzeczywistą produkcję.",
        hubStoredProduction: "Aktualnie zmagazynowane",
        hubNoAnimalsYet: "Brak danych o zwierzętach — otwórz Ustawienia, wskaż careerSavegame.xml i zaimportuj.",
        hubFeedLow: "Mało paszy!",
        hubHealth: "Zdrowie",
        hubFeedLevel: "Poziom paszy",
        hubNoFeedTracked: "Brak danych o paszy dla tego budynku.",
        hubApproxLevelsNote: "Paski paszy są względne wobec Twojego najlepiej zaopatrzonego budynku tego samego typu paszy — zapis gry nie przechowuje realnej pojemności magazynu, więc traktuj to jako \"która zagroda ma mniej niż inne\", a nie dokładny procent.",
        hubDailyRateNote: "Dzienna produkcja mleka/jajek nie jest jeszcze pokazana — wymagałoby to krzywej produkcji każdej rasy (z pliku animals.xml gry), czego jeszcze nie podpiąłem jako import. Daj znać, jeśli chcesz, żebym to dodał.",
        hubNoProductionCurves: "Twoje definicje zwierząt nie zawierają rozpoznanych krzywych produkcji (mleko/jajka/wełna), więc szacowana dzienna produkcja nie może być jeszcze pokazana dla tych ras.",
        hubProductionEstNote: "Szacunek na podstawie krzywej produkcji danej rasy — rzeczywista produkcja może się różnić w zależności od kondycji zwierzęcia i losowości gry.",
        hubEstDailyOutput: "Szacowana dzienna produkcja",
        avgHealthLabel: "Śr. zdrowie",
        perDayShort: "/dzień",
        animalBreedsLoaded: "Wczytane rasy zwierząt",
        noAnimalDefsYet: "Nie wczytano jeszcze żadnych definicji zwierząt.",
        animalDefsFolderLabel: "Folder definicji zwierząt (plik animals.xml gry):",
        animalDefsFolderHint: "Opcjonalne — podstawowe zwierzęta z FS25 działają od razu, bez importu. To potrzebne tylko dla mapy/moda z własnymi rasami zwierząt; zwykle jest w folderze instalacyjnym gry, nie w folderze mapy — oddzielone od Upraw powyżej, bo często leżą w zupełnie innych miejscach.",
        hubDailyNeed: "Dzienne zapotrzebowanie",
        hubRation: "Dawka",
        hubRationStockDays: "w magazynie na {d} dni",
        hubRationNoStock: "brak w magazynie",
        hubRationNote: "Dawka jest wspólna z Planerem pasz. Jej efektywność przelicza szacowaną produkcję mleka, jaj i wełny (obornik i gnojowica bez zmian); dni zapasu liczone są względem potrzeb całej farmy na dany składnik.",
        hubDaysRemaining: "dni przy obecnym zapasie",
        capacityLabel: "pojemność",
        combineNumbersHint: "Połącz kilka numerów pól w jednym wierszu, np. 69-70-71",
        fieldSizeLabel: "Wielkość pola (ha)",
        addNewField: "+ DODAJ POLE",
        usedByOthersHere: "Zajęte przez inne uprawy na tym polu",
        stillFree: "ha jeszcze wolne",
        overFieldSizeBy: "przekroczono rozmiar pola o",
        currentlyLoaded: "Aktualnie wczytano",
        noPlannedCrops: "Brak zaplanowanych upraw. Przypisz uprawy do pól w EDYTUJ SEZON — ta lista uzupełni się sama.",
        cropsSortGame: "Kolejność z gry · kliknij nagłówek, żeby sortować",
        catchCropsTitle: "Międzyplony",
        catchCropNone: "-- Brak --",
        thCatchCrop: "Międzyplon",
        thCatchSowingMth: "Siew międzyplonu",
        catchCropHint: "Uprawa na tym samym polu przed lub po uprawie głównej (zielone żyto, poplon…). W podsumowaniu upraw liczona osobno, żeby areał nie liczył się podwójnie.",
        catchCropShort: "międzyplon",
        cropsFromMapMod: "Lista i kolejność upraw odczytane automatycznie z moda mapy {mod}.",
        cropsLoaded: "uprawa(-y).",
        noCropsLoadedYet: "Nie wczytano jeszcze żadnych upraw.",
        readyToScan: "Gotowe do przeskanowania",
        clickSaveImport: "plik(ów) — kliknij ZAPISZ I IMPORTUJ.",
        selectCropFirst: "-- Najpierw wybierz uprawę --",
        selectMonth: "-- Wybierz miesiąc --",
        selectPlaceholder: "-- Wybierz --",
        of: "z",
        totalHa: "ha całości",
        discordSettingLabel: "Discord Rich Presence",
        discordSettingHint: "Pokazuj aktualną farmę i liczbę pól na Twoim profilu Discord.",
        discordBrowsing: "Przegląda farmy",
        discordManagingFields: "Zarządza {n} {fields}",
        discordFieldOne: "polem",
        discordFieldFew: "polami",
        discordFieldMany: "polami",
        discordOnFarm: "Farma: {name}",
        discordFarmCount: "Śledzi {n} {farms}",
        discordFarmOne: "farmę",
        discordFarmFew: "farmy",
        discordFarmMany: "farm",

        hubSupplies: "Zaopatrzenie",
        hubFieldSoil: "Typ gleby pól",
        fieldSoilEmpty: "Ta farma nie ma jeszcze pól z numerem ani powierzchnią. Dodaj pola w EDYTUJ SEZON, potem ustaw tu ich glebę.",
        fieldSoilImportBtn: "Wczytaj gleby z gry",
        fieldSoilImportHint: "Czyta mapę gleb z zapisu gry i obrysy pól z mapy (bez miedz) — te same % co Precision Farming w grze. Nadpisuje wartości poniżej dla każdego znalezionego pola.",
        fieldSoilImportNoPath: "Najpierw ustaw w Ustawieniach ścieżkę do careerSavegame.xml.",
        fieldSoilImportDone: "Wczytano gleby dla {n} pól z mapy „{map}”.",
        fieldSoilImportMissing: "Nie znaleziono na mapie (bez zmian): {list}.",
        fieldSoilImportArea: "Powierzchnia różni się od obrysu na mapie: {list}.",
        fieldSoilImportFail: "Nie udało się wczytać gleb z gry ({reason}).",
        fieldSoilImportReasons: { nosave: "nie znaleziono pliku zapisu", nomapid: "brak mapy w careerSavegame.xml", nomod: "nie znaleziono moda mapy {mod} w żadnym folderze modów (domyślnym, z gameSettings ani w kolekcjach Mod Assistanta)", nomap: "brak pliku mapy w {mod}", nofields: "mapa nie ma obrysów pól / warstwy działek", nosoil: "brak mapy gleb (czy Precision Farming jest włączony?)", parse: "błąd odczytu plików" },
        suppliesSoilHint: "Typ gleby pól ustawisz w pasku bocznym → Typ gleby pól.",
        suppliesTitle: "Zaopatrzenie na sezon",
        suppliesIntro: "Ile kupić na sezon {n}, żeby nie zabrakło w trakcie — jeden wiersz na pole, uprawa pobierana z tego pola w tabeli sezonu. Nasiona w litrach; nawóz podany w litrach i kilogramach azotu (model Precision Farming), pobrany z planu nawożenia każdego pola.",
        suppliesNoCrops: "Brak zaplanowanych upraw w tym sezonie. Przypisz uprawy do pól w EDYTUJ SEZON i wróć tutaj.",
        suppliesPlannedArea: "Zaplanowana powierzchnia upraw",
        suppliesFieldsToSow: "Pola do obsiania",
        suppliesSeeds: "Nasiona",
        suppliesFertilizer: "Nawóz",
        suppliesColField: "Pole",
        suppliesColCrop: "Uprawa",
        suppliesColArea: "Powierzchnia",
        suppliesColRate: "Stawka",
        suppliesColNeed: "Do kupienia",
        suppliesColSoil: "Gleba",
        suppliesColTargetN: "Cel N",
        suppliesColExistingN: "N już w glebie",
        suppliesColOrgN: "N naturalny",
        suppliesColMineralN: "Mineralny",
        suppliesFillPlanCta: "Uzupełnij plan",
        suppliesFillPlanHint: "Brak jeszcze planu nawożenia dla tego pola — otwórz go, żeby wpisać azot już w glebie/naturalny.",
        suppliesNoPlanNote: "{n} pól nadal potrzebuje planu nawożenia — nie ujęte w sumie powyżej.",
        suppliesTotal: "Razem",
        suppliesBufferNote: "Każda suma zawiera {p}% zapasu ponad dokładne zapotrzebowanie.",
        suppliesSeedRateUnit: "l/ha",
        suppliesNRateUnit: "kg N/ha",
        suppliesNDensityNote: "przy {d} kg N / l",
        suppliesAllSown: "Wszystkie zaplanowane pola są już obsiane — nie trzeba kupować nasion.",
        suppliesNoFert: "Żadne pole nie jest oznaczone do nawożenia. Włącz „zakładaj nawożenie każdej uprawy” w Ustawieniach lub ustaw znacznik N na polach.",
        suppliesUnknownRate: "brak wbudowanej stawki — przyjęto {v} l/ha",
        suppliesAdjust: "Dostosuj stawki",
        suppliesBuffer: "Zapas bezpieczeństwa (%)",
        suppliesNDensity: "Zawartość N w nawozie (kg N / l)",
        suppliesAssumeAllFert: "Zakładaj nawożenie każdej uprawy",
        suppliesPerCropRates: "Stawki per uprawa",
        suppliesResetRates: "Przywróć domyślne",
        suppliesEstimateNote: "Domyślne wartości to szacunki dla pełnego sezonu przy wysokim plonie. Dostosuj je do swojej mapy, modów i odczytu Precision Farming na polu.",
        suppliesSoilPerField: "Typ gleby pól (Precision Farming)",
        suppliesSoilYield: "plon {p}%",
        suppliesSoilNote: "Podaj udział % typów gleby dla pola — liczy się proporcja, wartości nie muszą sumować się do 100. Pola bez wpisu przyjmują {d}. Stawka azotu nawozu to średnia ważona udziałem po glebach pola, skalowana potencjałem plonowania każdej gleby.",
        suppliesSoilFileNote: "Stawki azotu per uprawa i typ gleby pochodzą z pliku nitrogen-by-soil.json obok aplikacji — edytuj go, aby dopasować do swojej mapy.",
        suppliesOrgManure: "Obornik",
        suppliesOrgSlurry: "Gnojówka",
        suppliesOrgDigestate: "Poferment",
        suppliesManureN: "Azot obornika (kg N/l)",
        suppliesSlurryN: "Azot gnojówki (kg N/l)",
        suppliesDigestateN: "Azot pofermentu (kg N/l)",
        thFertPlan: "Plan",
        fertPlanBtn: "Nawożenie",
        fertPlanTitle: "Plan nawożenia",
        fertPlanIntro: "Zapotrzebowanie tego pola na azot (uprawa i gleba) minus to, co już jest w glebie, i to, co pokrywa nawóz naturalny, daje dawkę nawozu mineralnego do wysiania.",
        fertPlanColTarget: "Zapotrzebowanie na azot",
        fertPlanColExisting: "Azot już w glebie",
        fertPlanColOrg: "Azot z nawozu naturalnego",
        fertPlanColMineralN: "Azot do uzupełnienia (mineralny)",
        fertPlanColMineralL: "Dawka nawozu mineralnego",
        fertPlanColStatus: "Bilans azotu",
        fertPlanCovered: "Zapotrzebowanie pokryte",
        fertPlanMineralAdd: "brakuje jeszcze {n} kg N/ha",
        fertPlanOrgVolHint: "To tyle samo azotu co:",
        fertPlanNote: "Zacznij od tego, ile azotu jest już na polu (odczyt z analizy gleby, pozostałość po poprzedniej uprawie albo już rozsiany nawóz) — to zostanie odjęte od zapotrzebowania jako pierwsze. Potem podaj wkład nawozu naturalnego w kg N/ha (Twój szacunek tego, ile wnosi obornik / gnojówka / poferment) — aplikacja pokaże, ile to litrów każdego z nich, licząc po stawkach N/l z Zaopatrzenie → Dostosuj stawki. Nawóz mineralny automatycznie dopełnia to, czego wciąż brakuje; jego litry wynikają z zawartości N w nawozie, a suma zawiera zapas. Mix gleby pola ustawisz w „Typ gleby pól”.",
        fertPlanTreatmentsTitle: "Zabiegi",
        fertPlanManureApplied: "Zastosowano obornik / gnojówkę",
        fertPlanFertilizerApplied: "Zastosowano nawóz sztuczny",
        fertPlanTreatmentsNote: "Te znaczniki zasilają listę zakupów w Zaopatrzeniu — nie zmieniają wyliczeń azotu powyżej.",

        hubNotes: "Notatki",
        notesTitle: "Notatki",

        hubYieldForecast: "Przewidywane plony",
        yieldForecastTitle: "Przewidywane plony",
        yieldForecastIntro: "Przewidywany zbiór dla każdej zaplanowanej w tym sezonie uprawy — obsianej lub wciąż tylko \"Do obsiania\" — przy założeniu idealnego azotu, idealnego pH gleby i braku chwastów: górny pułap jaki pozwala gleba Twoich pól, jeden wiersz na uprawę ze wszystkich pasujących pól.",
        yieldForecastColCrop: "Uprawa",
        yieldForecastColArea: "Powierzchnia",
        yieldForecastColYield: "Przewidywany plon",
        yieldForecastEmpty: "Żadne pole nie ma jeszcze przypisanej uprawy.",
        yieldForecastUnknownFlag: "Brak danych o plonie tej uprawy — sumie brakuje wkładu tego pola.",
        yieldForecastUnknownNote: "{n} upraw(y) nie ma znanej stawki plonu — ich sumy są zaniżone.",
        yieldForecastNote: "To górny pułap, nie prognoza: realny plon jest niższy, gdy azot, pH lub chwasty nie są idealne.",
        notesAdd: "+ DODAJ NOTATKĘ",
        notesEmpty: "Brak notatek. Dodaj jedną, żeby dostać przypomnienie, gdy nadejdzie ten miesiąc.",
        notesTitleLabel: "Tytuł",
        notesTitlePlaceholder: "np. Nawieźć pole 3",
        notesBodyLabel: "Szczegóły (opcjonalnie)",
        notesBodyPlaceholder: "Dodatkowe informacje...",
        notesMonthsLabel: "Miesiące",
        notesTagsLabel: "Tagi",
        notesTagsPlaceholder: "Wpisz tag i naciśnij Enter",
        notesChecklistLabel: "Checklista",
        notesAddChecklistItem: "+ Dodaj punkt",
        notesChecklistItemPlaceholder: "Punkt checklisty",
        notesSave: "ZAPISZ NOTATKĘ",
        notesCancel: "ANULUJ",
        notesEditTitle: "Edytuj notatkę",
        notesNewTitle: "Nowa notatka",
        notesDeleteConfirm: "Usunąć tę notatkę? Tej akcji nie można odwrócić.",
        notesThisMonthFilter: "Ten miesiąc",
        notesAllMonths: "Wszystkie miesiące",
        notesAllTags: "Wszystkie tagi",
        notesEdit: "Edytuj",
        notesDelete: "Usuń",
        notesNoTitle: "Podaj tytuł notatki.",
        notesCurrentMonthBadge: "Ten miesiąc",
        hubFeedPlan: "Planer pasz",
        feedPlanTitle: "Planer pasz",
        feedPlanStock: "Pasza w magazynie",
        feedColStock: "W magazynie",
        feedColFillType: "Produkt",
        feedSrc_silo: "Silosy",
        feedSrc_bunker: "Pryzmy",
        feedSrc_bale: "Bele",
        feedSrc_pallet: "Palety",
        feedSrc_mixer: "Mieszalniki pasz",
        feedProduct_PIGFOOD: "Pasza dla świń",
        feedProduct_FORAGE: "TMR (mieszanka paszowa)",
        feedProduct_MINERAL_FEED: "Pasza mineralna",
        feedMixersTitle: "Mieszalniki pasz",
        feedMixerPerMonth: "do {l} l / mies.",
        feedMixerForBarn: "dla tej obory",
        feedMixerNoneOn: "Żadna receptura nie jest włączona — mieszalnik nic nie produkuje.",
        feedMixerRecipes: "Receptury: włączone {on} z {n}",
        feedMixerInputs: "Czeka na zmieszanie",
        feedMixerInputsEmpty: "Brak składników w mieszalniku.",
        feedMixersNote: "Pasza i składniki w mieszalnikach liczą się do zapasów powyżej — pasza dla świń rozdzielona jak mieszanka z gry (baza 50%, zboże 25%, białko 20%, okopowe 5%).",
        feedStockNoSave: "Ustaw ścieżkę do careerSavegame.xml w Ustawieniach farmy, żeby odczytać, co już jest w silosach i belach.",
        feedStockNotRead: "Zapasy nie zostały jeszcze odczytane — pojawią się po następnej synchronizacji z zapisem gry.",
        feedStockEmpty: "W ostatnim zapisie gry nie ma paszy w silosach, pryzmach, belach ani na paletach.",
        feedStockNote: "Stan z ostatniego zapisu gry. Całe zboże i oleiste w silosach liczą się jako pasza — także to, co planujesz sprzedać. Owinięte bele z trawą liczą się jako kiszonka; pryzma liczy się jako kiszonka niezależnie od etapu fermentacji.",
        feedPlanIntro: "Roczne zapotrzebowanie stada na paszę, rozbite według dawki wybranej dla każdego gatunku, zestawione z plonem pól przeznaczonych na paszę. Wszystko w litrach; plon pola to pułap zależny od gleby, tak jak w „Przewidywanych plonach”.",
        feedPlanRations: "Dawki",
        feedPlanFields: "Pola paszowe",
        feedPlanBalance: "Bilans roczny",
        feedPlanParams: "Parametry",
        feedColSpecies: "Gatunek",
        feedColHead: "Sztuk",
        feedColRation: "Dawka",
        feedColEfficiency: "Efektywność",
        feedColYearNeed: "Pasza / rok",
        feedColUse: "Przeznaczenie",
        feedColStraw: "Zbiór słomy",
        feedColYield: "Plon / rok",
        feedColCategory: "Pasza",
        feedColNeed: "Potrzeba / rok",
        feedColHave: "Z pól",
        feedColBalance: "Bilans",
        feedStrawBedding: "Słoma na ściółkę",
        feedAnimal_COW: "Krowy",
        feedAnimal_PIG: "Świnie",
        feedAnimal_SHEEP: "Owce i kozy",
        feedAnimal_HORSE: "Konie",
        feedAnimal_CHICKEN: "Kury",
        feedRation_forage: "TMR (mieszanka paszowa)",
        feedRation_hay: "Siano",
        feedRation_silage: "Kiszonka",
        feedRation_grass: "Trawa",
        feedRation_mix: "Mieszanka standardowa",
        feedRation_grain: "Zboże",
        feedCat_GRASS: "Trawa",
        feedCat_HAY: "Siano",
        feedCat_SILAGE: "Kiszonka",
        feedCat_STRAW: "Słoma",
        feedCat_MINERAL: "Pasza mineralna",
        feedCat_PIG_BASE: "Kukurydza / sorgo",
        feedCat_GRAIN: "Zboże (pszenica, jęczmień)",
        feedCat_PROTEIN: "Białko (soja, rzepak, słonecznik)",
        feedCat_EARTH: "Okopowe",
        feedCat_OAT: "Owies",
        feedCat_ROUGHAGE: "Pasze objętościowe (trawa, siano, kiszonka)",
        feedUse_sale: "Sprzedaż",
        feedUse_feed: "Pasza",
        feedUse_silage: "Kiszonka (sieczka)",
        feedUse_grain: "Ziarno na paszę",
        mixerTitle: "Paszowóz",
        mixerClover: "koniczyna",
        mixerAlfalfa: "lucerna",
        mixerFromSave: "z zapisu gry",
        mixerOwn: "własny",
        mixerNoCapacity: "pojemność nieznana",
        mixerNewWagon: "Nowy paszowóz",
        mixerWagonName: "Nazwa",
        mixerWagonNamePh: "np. Rino FXL 1000",
        mixerCapacity: "Pojemność",
        mixerNoWagons: "W zapisie gry nie ma paszowozu — dodaj własny z jego pojemnością.",
        mixerEnterCapacity: "Nie udało się odczytać pliku tego paszowozu — wpisz jego pojemność:",
        mixerLoad: "Załadunek",
        mixerLoadEmpty: "Nic jeszcze nie załadowano — dodaj bele i produkty sypkie albo dobierz załadunek automatycznie do receptury TMR.",
        mixerOnFarm: "na farmie: {n}",
        mixerPcs: "szt.",
        mixerTooManyBales: "Masz na farmie tylko {n} takich bel.",
        mixerLoose: "luzem",
        mixerAddBale: "Bela",
        mixerAddBulk: "Produkt sypki",
        mixerNewBale: "Własny rodzaj beli",
        mixerAuto: "Dobierz do receptury",
        mixerClear: "Wyczyść",
        mixerNoBales: "W zapisie gry nie ma bel — dodaj własny rodzaj beli z jej litrażem.",
        mixerBaleName: "Nazwa beli",
        mixerBaleNamePh: "np. Okrągła 150 kiszonka",
        mixerBaleContent: "Zawartość",
        mixerBaleLitres: "Litrów w beli",
        mixerBale: "Bela",
        mixerBaleRound: "Okrągła {s}",
        mixerBaleSquare: "Kostka {s}",
        mixerResult: "Mieszanka",
        mixerOfCapacity: "z {c} l pojemności",
        mixerFill: "pełny",
        mixerOver: "{l} l ponad pojemność paszowozu.",
        mixerRange: "dozwolone {a}–{b}%",
        mixerTarget: "Twoja receptura",
        mixerValid: "Mieszanka mieści się w recepturze TMR — paszowóz zrobi TMR.",
        mixerInvalid: "Poza recepturą TMR: {list}",
        mixerLasts: "Starczy na ok. {d} dni dla tej obory ({l} l/dzień).",
        feedCustomTitle: "Własne pasze",
        feedCustomGroup: "Własne pasze",
        feedCustomNew: "Nowa pasza",
        feedCustomName: "Nazwa",
        feedCustomNamePh: "np. Mieszanka zimowa",
        feedCustomIngredients: "Składniki",
        feedCustomAddIng: "Dodaj składnik",
        feedCustomSum: "Suma: {s}% (musi być 100%)",
        feedCustomDeleteConfirm: "Usunąć tę paszę? Gatunki, które jej używają, wrócą do dawki domyślnej.",
        feedErrName: "Podaj nazwę paszy.",
        feedErrNoIng: "Dodaj co najmniej jeden składnik.",
        feedErrDuplicate: "Każdy składnik może wystąpić tylko raz.",
        feedErrPct: "Każdy składnik musi mieć udział większy niż 0%.",
        feedErrEfficiency: "Efektywność musi mieścić się w zakresie 1–100%.",
        feedNoFields: "Żadne pole nie ma uprawy, którą jedzą zwierzęta. Przypisz trawę, kukurydzę, zboże, rośliny białkowe lub okopowe w EDYTUJ SEZON.",
        feedBalanceEmpty: "Na razie nie ma czego porównać — brak zwierząt i pól paszowych.",
        feedBuy: "Do kupienia",
        feedMissingHa: "brakuje ≈ {ha} ha",
        feedGrassCuts: "Pokosy trawy na rok",
        feedChaffYield: "Plon sieczki z kukurydzy (l/ha)",
        feedStrawYield: "Plon słomy (l/ha)",
        feedStrawYieldAuto: "z danych mapy",
        feedUnknownAnimals: "Pominięto {n} grup(y) zwierząt — brak danych o paszy dla tej rasy.",
        feedPlanNote: "Potrzeba = dzienna krzywa paszy dla obecnego wieku zwierząt × dni w miesiącu (z zapisu gry) × 12 miesięcy. Zbiór z łąk może stać się trawą, sianem lub kiszonką litr za litr, więc najpierw liczy się tam, gdzie czegoś brakuje. Plon sieczki z kukurydzy to szacunek — popraw go po pierwszym zbiorze. Efektywność pokazuje, jak dawka wspiera produkcję (productionWeight z gry); nie zmienia ilości zjadanej paszy.",
        feedIntroShort: "Wybierz oborę i paszę — kafelki pokażą, ile masz na rok (magazyn + planowany zbiór) i ile brakuje.",
        feedPickBarn: "Obora",
        feedPickRation: "Pasza",
        feedIngredients: "Składniki na rok",
        feedYouHave: "Masz",
        feedStockShort: "magazyn",
        feedHarvestShort: "zbiór",
        feedOfNeeded: "z {n} l potrzebnych",
        feedEnough: "Wystarczy",
        feedMissing: "Brakuje",
        feedThisBarn: "Ta obora",
        feedPerYearShort: "/rok",
        feedFoodPerYear: "paszy / rok",
        feedYearNeedFood: "Pasza potrzebna na rok",
        feedYearNeedMonth: "Na miesiąc gry",
        feedScaleBase: "gra podstawowa: zapotrzebowanie miesięczne nie zależy od dni w miesiącu ({d})",
        feedScaleAfc: "AnimalFoodCalculator ×{x} ({d} dni w miesiącu)",
        feedScaleEas: "EAS: więcej paszy po porodzie",
        animalModsLabel: "Mody zwierząt w tym zapisie gry:",
        animalModsNoSave: "Podaj wyżej ścieżkę zapisu gry, żeby wykryć mody zwierząt (AnimalFoodCalculator, EnhancedAnimalSystem).",
        animalModsNone: "Brak aktywnych modów zmieniających paszę — zasady gry podstawowej ({d} dni w miesiącu nie zmienia paszy na miesiąc).",
        afcModeLine: "tryb {mode}: pasza ×{x}; krzywe: {src}",
        afcMode_vanilla: "Basegame (wyłączony)",
        afcMode_auto: "Auto (× dni w miesiącu)",
        afcMode_manual: "Manual (× mnożnik)",
        afcMode_hybrid: "Hybrid (× dni × mnożnik)",
        afcSource_custom: "własny animals.xml AFC",
        afcSource_animalpackage: "Animal Package",
        afcSource_basegame: "gra podstawowa",
        afcSource_map: "mapa",
        afcSource_effective: "jak w grze",
        easLine: "współczynnik paszy w laktacji po porodzie dla: {list}",
        farmlandAreaLabel: "Pokazuj też areał całej działki (farmland), nie tylko pola",
        farmlandAreaHint: "Liczone z mapy tak jak w grze (pole plus miedze i obrzeża); wymaga zapisu gry i moda mapy.",
        farmlandPlot: "działka",
        farmlandTotal: "· posiadana ziemia: {ha} ha ({n} działek)",
        modsDirInfo: "Folder modów: {dir}",
        modsDirInfoMore: "(+{n} przeszukiwanych dodatkowo: z gameSettings / kolekcje Mod Assistanta)",
        feedSettings: "Ustawienia — pola paszowe, parametry, własne pasze"
    }
};

// Tutorial texts (Section 10B) — kept in their own block because there are a
// lot of them; merged into TRANSLATIONS so t() finds them like any other key.
// Step keys are tut_<step id>_t (title) / tut_<step id>_x (body).
Object.assign(TRANSLATIONS.en, {
    tutorialSettingLabel: "Tutorial",
    tutorialReplay: "Open tutorial",
    tutorialDemoFarmName: "Demo Farm",
    tutMenuTitle: "Farmer Planner tutorial",
    tutMenuIntro: "Pick a chapter or go through everything. Some steps ask you to click or type something yourself — \"Show me\" will do it for you.",
    tutRunAll: "Start full tutorial",
    tutClose: "Close tutorial",
    tutMenu: "Chapters",
    tutBack: "Back",
    tutNext: "Next",
    tutFinish: "Finish",
    tutShowMe: "Show me",
    tutStepOf: "{chapter} · {current} / {total}",
    tutHintClick: "Click the highlighted element",
    tutHintType: "Type a value, then press Next",
    tutHintSelect: "Choose from the list, then press Next",
    tutHintMissing: "This element isn't visible right now — press \"Show me\" to restore it.",
    tut_ch_a: "Your first farm",
    tut_ch_b: "Header & seasons",
    tut_ch_c: "Fields table",
    tut_ch_d: "Editing a season",
    tut_ch_e: "Fertilization plan",
    tut_ch_f: "Crops sidebar",
    tut_ch_g: "Auto-sync",
    tut_ch_h: "Farm tools",
    tut_ch_k: "Animals",
    tut_ch_m: "Feed planner & mixer wagon",
    tut_ch_i: "Farm settings",
    tut_ch_j: "App settings",

    tut_a1_t: "Welcome!",
    tut_a1_x: "Farmer Planner helps you plan fields, seasons, fertilization, supplies, animals and their feed for Farming Simulator 25. In this chapter you'll create a practice farm yourself.",
    tut_a2_t: "Add a farm",
    tut_a2_x: "Every savegame gets its own farm here. Click \"Add farm\".",
    tut_a3_t: "Farm name",
    tut_a3_x: "Type a name for the practice farm, e.g. \"My farm\" (at least 2 characters).",
    tut_a4_t: "Map name",
    tut_a4_x: "Optionally type the map it's played on, e.g. \"Riverbend Springs\". It's shown next to the farm name. You can leave it empty.",
    tut_a5_t: "Create it",
    tut_a5_x: "Click the confirm button to create the farm.",
    tut_a6_t: "Your practice farm",
    tut_a6_x: "Here it is. We've filled it with example data so you can see every feature. It's a practice farm — it will be removed when you close the tutorial. Each farm shows its name, map and when it was last edited.",
    tut_a7_t: "Export a backup",
    tut_a7_x: "Saves the whole farm (fields, archived seasons, notes, monthly history, crop configs) to one .json file. Use it to move to another PC or keep a safe copy.",
    tut_a8_t: "Import a backup",
    tut_a8_x: "Loads such a file back. Import always creates a new farm — it never overwrites an existing one.",
    tut_a9_t: "Delete mode",
    tut_a9_x: "Click \"Delete farm\" to switch into delete mode.",
    tut_a10_t: "Delete button",
    tut_a10_x: "In delete mode every farm gets a bin instead of the open arrow. Deleting always asks for confirmation — don't click it now.",
    tut_a11_t: "Leave delete mode",
    tut_a11_x: "Click the same button again (\"Cancel delete\") to leave delete mode.",
    tut_a12_t: "Open the planner",
    tut_a12_x: "Click the arrow next to your practice farm to open its planner.",

    tut_b1_t: "Farm name",
    tut_b1_x: "The planner header shows the farm name and its map.",
    tut_b2_t: "Balance & month",
    tut_b2_x: "Balance and current in-game month. Once you link a savegame (farm settings), they are read from the game automatically. \"Plant now\" badges use this month.",
    tut_b3_t: "Year",
    tut_b3_x: "The in-game year is editable and goes up by itself when the game rolls from December to January. Change it to 3.",
    tut_b4_t: "Seasons",
    tut_b4_x: "A season is one planting/harvest cycle — independent of the year. The demo farm is in season 2; season 1 is archived.",
    tut_b5_t: "Previous season",
    tut_b5_x: "Click the ◀ arrow to look at season 1.",
    tut_b6_t: "Archived season",
    tut_b6_x: "Past seasons are read-only: the Edit, New season and Fertilizer buttons are hidden. It's your history — useful for crop rotation.",
    tut_b7_t: "Back to the current season",
    tut_b7_x: "Click ▶ to return to season 2.",
    tut_b8_t: "New season",
    tut_b8_x: "After the harvest: archives the current season, clears crops, sowing months and tillage, lowers lime pH by one step (depending on soil) and keeps field numbers and areas. It asks for confirmation — don't click it now.",
    tut_b9_t: "Reset seasons",
    tut_b9_x: "Deletes the whole season archive and starts counting from season 1 again. Your current fields stay as they are.",

    tut_c1_t: "Fields table",
    tut_c1_x: "One row per field (or part of a field). Rows to sow this month jump to the top, the rest are sorted by field number.",
    tut_c2_t: "Plant now",
    tut_c2_x: "Orange \"Plant now\": the field isn't sown yet and its sowing month is the current in-game month.",
    tut_c3_t: "Planted / To plant",
    tut_c3_x: "Green \"Planted\" — already sown. Grey \"To plant\" — waiting for its month.",
    tut_c4_t: "Rotation warning ⟳",
    tut_c4_x: "The same crop was grown on this field last season. Consider rotating crops — hover the icon for details.",
    tut_c5_t: "Split field",
    tut_c5_x: "Two rows with the same number = one physical field shared by two crops (blue bar). The caption shows the total field size and warns when some hectares aren't assigned yet or you've assigned too many.",
    tut_c6_t: "Combined fields",
    tut_c6_x: "A number like \"5-6\" means several physical fields farmed as one row.",
    tut_c7_t: "Tillage",
    tut_c7_x: "Plowed (amber) or no-till (green) — what you plan to do before sowing.",
    tut_c8_t: "Lime",
    tut_c8_x: "The chip fills up like a gauge: fill = soil pH level. Beige = freshly limed, amber ≈ half, rust = almost none. Below 75% it needs attention. Every new season lowers it, faster on lighter soils. Hover for details.",
    tut_c9_t: "Fertilization button",
    tut_c9_x: "Opens the field's fertilization plan. White = nothing applied yet, brown = natural fertilizer applied, green = mineral fertilizer applied.",
    tut_c10_t: "Total area",
    tut_c10_x: "The sum of hectares in the table.",

    tut_d1_t: "Edit the season",
    tut_d1_x: "Click \"Edit\". A backup is saved automatically before every edit.",
    tut_d2_t: "Field cards",
    tut_d2_x: "Each field is now an editable card. ✕ deletes it, the \"+\" next to the number adds a dash so you can combine field numbers (e.g. 5-6).",
    tut_d3_t: "Add a field",
    tut_d3_x: "Scroll down and click \"+ Add new field\".",
    tut_d4_t: "Field number",
    tut_d4_x: "Type the field number as it is in the game, e.g. 7.",
    tut_d5_t: "Area",
    tut_d5_x: "Type the area in hectares, e.g. 3.5 (a comma works too).",
    tut_d6_t: "Crop",
    tut_d7_t: "Sowing month",
    tut_d7_x: "Choose the sowing month. Only months valid for the chosen crop on this map are offered.",
    tut_d8_t: "Tillage",
    tut_d8_x: "Click \"Plowed\". Clicking the active option again clears it.",
    tut_d9_t: "Lime",
    tut_d9_x: "Click the lime chip to mark fresh liming (pH 100% this season).",
    tut_d10_t: "Planted",
    tut_d10_x: "Tick the checkbox to mark the field as already sown.",
    tut_d11_t: "Save",
    tut_d11_x: "The button now says \"Save changes\" — click it. There's no Cancel: the second click always saves.",
    tut_d12_t: "Done",
    tut_d12_x: "Your new field is in the table, sorted by its number.",

    tut_e1_t: "Open a plan",
    tut_e1_x: "Click \"Fertilizer\" in field 1 (wheat).",
    tut_e2_t: "Nitrogen requirement",
    tut_e2_x: "At the top: the field's soil mix, area and nitrogen target in kg N/ha and in total — calculated for this crop and soil from Precision Farming data.",
    tut_e3_t: "Nitrogen already in the soil",
    tut_e3_x: "Type how much nitrogen is already in the soil (from the PF soil map), e.g. 40.",
    tut_e4_t: "Natural fertilizer",
    tut_e4_x: "Type how much nitrogen you'll give with manure/slurry/digestate, e.g. 30. The app converts it into litres of each.",
    tut_e5_t: "Mineral fertilizer",
    tut_e5_x: "The rest is what mineral fertilizer must cover: kg N/ha and a dose in litres (including the safety buffer). The status says whether the requirement is covered.",
    tut_e6_t: "Mark as applied",
    tut_e6_x: "Tick \"Synthetic fertilizer applied\".",
    tut_e7_t: "Close",
    tut_e7_x: "Close the plan.",
    tut_e8_t: "Button colour",
    tut_e8_x: "Field 1's button is now green — mineral fertilizer applied.",

    tut_f1_t: "Crops",
    tut_f1_x: "Every crop planted this season with its total area — filled in automatically from the fields, nothing to type here. Starts in the game's own crop order.",
    tut_f2_t: "Sort by area",
    tut_f2_x: "Click \"Ha\" to put the biggest crops first. Click again to reverse; a third click goes back to game order.",
    tut_f3_t: "Sort by name",
    tut_f3_x: "Click \"Crop\" to sort alphabetically. The fields table headers sort the same way.",
    tut_f4_t: "Catch crops",
    tut_f4_x: "Catch crops (oilseed radish, green rye…) set in a field's edit card get their own section with a separate total, so the same hectares aren't counted twice.",
    tut_d6_x: "Choose a crop. The list has every crop of this farm's map, in the game's order.",

    tut_g2_t: "Auto-sync",
    tut_g2_x: "With auto-sync enabled, the app checks the savegame every 10 seconds and updates the planner after you save in the game. This badge appears when it does.",

    tut_h1_t: "Sidebar",
    tut_h1_x: "The bar on the left switches between the field plan and the farm's tools: finance, animals, supplies, field soils, notes, yield forecast and feed planner.",
    tut_h3_t: "Finance",
    tut_h3_x: "Click \"Finance\".",
    tut_h4_t: "Charts",
    tut_h4_x: "Balance (solid line) and credit (dashed) month by month, recorded automatically from the savegame, plus a chart per season.",
    tut_h6_t: "Field soils",
    tut_h6_x: "Click the field soil tool.",
    tut_h7_t: "Soil mix",
    tut_h7_x: "Enter the share of each soil type per field (from the PF soil map). Only the ratio matters. Type e.g. 60 in the first box of field 1 and press Tab. Soil affects the nitrogen target, seed rate, lime loss and yield.",
    tut_h8_t: "Soils from the game",
    tut_h8_x: "With a linked savegame this button reads the soil map straight from the game and fills in every field — the same % Precision Farming shows in-game. It overwrites the values in the table.",
    tut_h9_t: "Supplies",
    tut_h9_x: "Click \"Supplies\".",
    tut_h10_t: "Seeds",
    tut_h10_x: "Seed needed for every field that's not sown yet: rate in l/ha and total including the buffer. \"?\" means the rate is unknown.",
    tut_h11_t: "Fertilizer",
    tut_h11_x: "Fertilizer per field from the fertilization plans: target N, what's already covered, and litres of mineral fertilizer to buy. Fields without a plan get a button to fill one in.",
    tut_h13_t: "Notes",
    tut_h13_x: "Click \"Notes\".",
    tut_h14_t: "A note",
    tut_h14_x: "Notes can be pinned to months, tagged and have a checklist. Notes for the current month are highlighted.",
    tut_h15_t: "New note",
    tut_h15_x: "Click the add note button.",
    tut_h16_t: "Title",
    tut_h16_x: "Type a title, e.g. \"Buy lime\".",
    tut_h17_t: "Months",
    tut_h17_x: "Pick the months the note applies to — it will be highlighted when that month comes. Below you can add tags and a checklist.",
    tut_h18_t: "Save the note",
    tut_h18_x: "Click Save.",
    tut_h20_t: "Yield forecast",
    tut_h20_x: "Click the yield forecast tool.",
    tut_h21_t: "Forecast",
    tut_h21_x: "Expected harvest per crop in litres = hectares × crop yield × soil factor, assuming ideal nitrogen, pH and no weeds.",
    tut_h24_t: "Back to the plan",
    tut_h24_x: "Click \"Plan\" to return to the field table. Animals and the feed planner have chapters of their own.",

    tut_k1_t: "Animals",
    tut_k1_x: "Click \"Animals\" in the sidebar.",
    tut_k3_t: "Head count",
    tut_k3_x: "All your animals together, read from the savegame (placeables.xml), and one tile per barn with a picture of its breed, feed level and how many animals are pregnant. Everything here refreshes whenever the game saves — with auto-sync even while you play.",
    tut_k4_t: "Barn details",
    tut_k4_x: "Clicking a tile opens that building's full card: cow barns, chicken coops, pastures, stables. The name comes from the building's file on the map — click the pencil to give it your own.",
    tut_k5_t: "Animals & health",
    tut_k5_x: "Each breed and age group as a separate row: breed × head count and health. Health drops when animals lack food, water or straw, or when the barn isn't cleaned — sick animals produce less and are worth less.",
    tut_k19_t: "Breeding status",
    tut_k19_x: "Every group also shows where it is with breeding: pregnant (with a progress bar), ready to breed, not inseminated or too young, plus how long ago it last gave birth.",
    tut_k6_t: "Feed bar",
    tut_k6_x: "What's in the feed trough right now. Mixed ingredients (e.g. grass + silage) are added together because they share one trough. Green = plenty, amber = below 35%, red = below 15%.",
    tut_k7_t: "Trough capacity",
    tut_k7_x: "The game's save doesn't record how big a trough is, so you enter it once (read it from the barn's info in the game). With a capacity the bar shows a real percentage.",
    tut_k8_t: "Days of feed left",
    tut_k8_x: "Feed in the trough ÷ what the herd eats per day. Amber below 7 days, red below 3 — time to restock.",
    tut_k20_t: "Ration",
    tut_k20_x: "What this barn is fed. Below: its daily need split into ingredients and how many days your stock of each lasts. It's the same choice as in the Feed planner — change it in either place.",
    tut_k9_t: "Low feed warning",
    tut_k9_x: "The chicken coop is almost empty, so the card turns red with \"Feed low!\". It shows when the trough is below 15% of its capacity, below 80 L if you haven't entered a capacity, or when there's no feed at all.",
    tut_k10_t: "Enter the capacity",
    tut_k10_x: "The coop has no capacity yet (\"?\"), so its bar is only compared with your other barns. Type 1000 and press Tab.",
    tut_k11_t: "Real percentage",
    tut_k11_x: "Now the bar is 60 L out of 1000 L — a real 6%, in red. Enter capacities for every barn to get reliable bars and warnings.",
    tut_k12_t: "Low health",
    tut_k12_x: "These sheep are only at 72% health, their trough is below 35% (amber) and the feed lasts less than a week. Check their water, straw and cleaning — and top up the feed.",
    tut_k13_t: "Daily need",
    tut_k13_x: "How much food, water and straw the whole barn uses per day. It's calculated for each animal's age from the game's growth curves — calves eat less than adult cows.",
    tut_k21_t: "Reproduction",
    tut_k21_x: "How many females are pregnant and when the next birth is due. The heifers here aren't inseminated — usually there's no male of the same breed in the building. Birth dates need the breed's pregnancy length from the animal definitions (Farm settings).",
    tut_k14_t: "Stored production",
    tut_k14_x: "What's waiting in the barn right now: milk in the tank, slurry, eggs, wool. Sell or collect it before the storage is full.",
    tut_k15_t: "Estimated output",
    tut_k15_x: "How much the barn should produce per day at its current age mix. Useful for planning milk runs and slurry spreading.",
    tut_k16_t: "Herd history",
    tut_k16_x: "Month by month: head count, average health and milk produced. The app records a point every in-game month from the savegame.",
    tut_k17_t: "Modded maps",
    tut_k17_x: "Food, water and production rates come from the base game. If your map or mods add their own animals, import their definitions in Farm settings → animal definitions folder.",
    tut_k18_t: "Back to the plan",
    tut_k18_x: "Click \"Plan\" to return to the field table.",

    tut_m1_t: "Feed planner",
    tut_m1_x: "Click \"Feed planner\" in the sidebar.",
    tut_m2_t: "Pick a barn",
    tut_m2_x: "One tile per barn with its animals and yearly food need. A red dot means some ingredient won't last the year.",
    tut_m3_t: "Pick the feed",
    tut_m3_x: "Rations from the game with their efficiency — cows only give full production on TMR. \"+\" creates your own feed with its own ingredients.",
    tut_m5_t: "Mixer wagon",
    tut_m5_x: "Mixer wagons you own are read from the savegame. \"New mixer wagon\" adds your own with its capacity.",
    tut_m6_t: "Wagon capacity",
    tut_m6_x: "For base-game wagons the capacity can't be read from the game files. Type it in once, e.g. 20000, and press Tab.",
    tut_m7_t: "Fill to recipe",
    tut_m7_x: "Click \"Fill to recipe\" — the app loads the wagon to your TMR recipe from the bales on your farm.",
    tut_m8_t: "Load",
    tut_m8_x: "Bales go in whole or in halves (− / +); anything without bales (e.g. mineral feed) goes in loose. You can pick a different bale in each row or add your own bale type — the litres turn red when you use more bales than you have.",
    tut_m9_t: "The mix",
    tut_m9_x: "How full the wagon is, and a bar per ingredient: the shaded band is the allowed range, the marker is your recipe. Green = the wagon will make TMR. Below: how many days the load feeds this barn.",
    tut_m10_t: "Ingredients for a year",
    tut_m10_x: "The barn's yearly need per ingredient compared with your storage and the planned harvest. Missing feed is shown in litres and roughly in hectares to sow.",
    tut_m11_t: "Settings",
    tut_m11_x: "Click the settings bar to expand it.",
    tut_m12_t: "Feed fields & parameters",
    tut_m12_x: "Choose which fields grow feed and what they become (sale, feed, silage), where you collect straw, grass cuts per year and yields. Your own feeds are listed here too.",
    tut_m13_t: "Back to the plan",
    tut_m13_x: "Click \"Plan\" to return to the field table.",

    tut_i1_t: "Farm settings",
    tut_i1_x: "Click the farm settings button.",
    tut_i2_t: "Map name",
    tut_i2_x: "Type the map name, e.g. \"Hutan Pantai\".",
    tut_i3_t: "Savegame",
    tut_i3_x: "Point to your savegame folder (e.g. Documents\\My Games\\FarmingSimulator2025\\savegame1) with \"...\". That links balance, month, credit, equipment, animals, feed stock, bales and mixer wagons.",
    tut_i4_t: "Auto-sync",
    tut_i4_x: "Turn on to update the planner automatically every time you save in the game.",
    tut_i5_t: "Map crops & animals",
    tut_i5_x: "For modded maps: choose the map's folder to import its crops (sowing calendar) and animal definitions.",
    tut_i6_t: "Adjust rates",
    tut_i6_x: "Click \"Adjust rates\" to expand it.",
    tut_i7_t: "Rates",
    tut_i7_x: "Buffer %, nitrogen density of the mineral fertilizer, nitrogen content of manure/slurry/digestate, and seed / nitrogen rates per crop. Empty = default.",
    tut_i8_t: "Save",
    tut_i8_x: "Click \"Save & import\".",
    tut_i9_t: "Saved",
    tut_i9_x: "The map name now appears in the header.",

    tut_j1_t: "Back to farms",
    tut_j1_x: "Click the exit button to go back to the farm list.",
    tut_j2_t: "App settings",
    tut_j2_x: "Click the gear icon.",
    tut_j3_t: "Language",
    tut_j3_x: "Switch between Polish and English at any time.",
    tut_j4_t: "Discord",
    tut_j4_x: "Show the farm you're working on in your Discord status.",
    tut_j5_t: "Tutorial",
    tut_j5_x: "Here you can come back to this tutorial and any of its chapters.",
    tut_j6_t: "Close",
    tut_j6_x: "Close the settings.",
    tut_j7_t: "All done!",
    tut_j7_x: "The practice farm will be removed now. Good luck with the harvest!"
});

Object.assign(TRANSLATIONS.pl, {
    tutorialSettingLabel: "Samouczek",
    tutorialReplay: "Otwórz samouczek",
    tutorialDemoFarmName: "Farma demo",
    tutMenuTitle: "Samouczek Farmer Planner",
    tutMenuIntro: "Wybierz rozdział albo przejdź wszystko. W niektórych krokach musisz sam coś kliknąć lub wpisać — „Pokaż mi” zrobi to za Ciebie.",
    tutRunAll: "Przejdź cały samouczek",
    tutClose: "Zamknij samouczek",
    tutMenu: "Rozdziały",
    tutBack: "Wstecz",
    tutNext: "Dalej",
    tutFinish: "Zakończ",
    tutShowMe: "Pokaż mi",
    tutStepOf: "{chapter} · {current} / {total}",
    tutHintClick: "Kliknij podświetlony element",
    tutHintType: "Wpisz wartość, potem kliknij Dalej",
    tutHintSelect: "Wybierz z listy, potem kliknij Dalej",
    tutHintMissing: "Tego elementu teraz nie widać — kliknij „Pokaż mi”, żeby go przywrócić.",
    tut_ch_a: "Pierwsza farma",
    tut_ch_b: "Nagłówek i sezony",
    tut_ch_c: "Tabela pól",
    tut_ch_d: "Edycja sezonu",
    tut_ch_e: "Plan nawożenia",
    tut_ch_f: "Uprawy",
    tut_ch_g: "Automatyczna synchronizacja",
    tut_ch_h: "Narzędzia farmy",
    tut_ch_k: "Zwierzęta",
    tut_ch_m: "Planer pasz i paszowóz",
    tut_ch_i: "Ustawienia farmy",
    tut_ch_j: "Ustawienia aplikacji",

    tut_a1_t: "Witaj!",
    tut_a1_x: "Farmer Planner pomaga planować pola, sezony, nawożenie, zaopatrzenie, zwierzęta i ich paszę w Farming Simulator 25. W tym rozdziale sam utworzysz farmę ćwiczeniową.",
    tut_a2_t: "Dodaj farmę",
    tut_a2_x: "Każdy zapis gry ma tu swoją farmę. Kliknij „Dodaj farmę”.",
    tut_a3_t: "Nazwa farmy",
    tut_a3_x: "Wpisz nazwę farmy ćwiczeniowej, np. „Moja farma” (co najmniej 2 znaki).",
    tut_a4_t: "Nazwa mapy",
    tut_a4_x: "Opcjonalnie wpisz mapę, na której grasz, np. „Riverbend Springs”. Będzie widoczna obok nazwy farmy. Możesz zostawić puste.",
    tut_a5_t: "Utwórz",
    tut_a5_x: "Kliknij przycisk potwierdzenia, żeby utworzyć farmę.",
    tut_a6_t: "Twoja farma ćwiczeniowa",
    tut_a6_x: "Oto ona. Wypełniliśmy ją przykładowymi danymi, żebyś zobaczył wszystkie funkcje. To farma ćwiczeniowa — zostanie usunięta po zamknięciu samouczka. Przy każdej farmie widać nazwę, mapę i datę ostatniej edycji.",
    tut_a7_t: "Eksport kopii",
    tut_a7_x: "Zapisuje całą farmę (pola, archiwum sezonów, notatki, historię miesięczną, konfiguracje upraw) do jednego pliku .json. Przydaje się przy przenosinach na inny komputer lub jako kopia bezpieczeństwa.",
    tut_a8_t: "Import kopii",
    tut_a8_x: "Wczytuje taki plik. Import zawsze tworzy nową farmę — nigdy nie nadpisuje istniejącej.",
    tut_a9_t: "Tryb usuwania",
    tut_a9_x: "Kliknij „Usuń farmę”, żeby włączyć tryb usuwania.",
    tut_a10_t: "Przycisk usuwania",
    tut_a10_x: "W trybie usuwania każda farma ma kosz zamiast strzałki. Usuwanie zawsze pyta o potwierdzenie — nie klikaj go teraz.",
    tut_a11_t: "Wyjdź z trybu usuwania",
    tut_a11_x: "Kliknij ten sam przycisk jeszcze raz („Anuluj usuwanie”), żeby wyjść z trybu usuwania.",
    tut_a12_t: "Otwórz planer",
    tut_a12_x: "Kliknij strzałkę przy farmie ćwiczeniowej, żeby otworzyć jej planer.",

    tut_b1_t: "Nazwa farmy",
    tut_b1_x: "W nagłówku planera widać nazwę farmy i mapę.",
    tut_b2_t: "Saldo i miesiąc",
    tut_b2_x: "Saldo i bieżący miesiąc w grze. Po podpięciu zapisu gry (ustawienia farmy) są odczytywane automatycznie. Oznaczenia „Siej teraz” opierają się na tym miesiącu.",
    tut_b3_t: "Rok",
    tut_b3_x: "Rok w grze można edytować, a przy przejściu z grudnia na styczeń zwiększa się sam. Zmień go na 3.",
    tut_b4_t: "Sezony",
    tut_b4_x: "Sezon to jeden cykl siewu i zbioru — niezależny od roku. Farma demo jest w sezonie 2, a sezon 1 jest w archiwum.",
    tut_b5_t: "Poprzedni sezon",
    tut_b5_x: "Kliknij strzałkę ◀, żeby zobaczyć sezon 1.",
    tut_b6_t: "Sezon archiwalny",
    tut_b6_x: "Poprzednie sezony są tylko do odczytu: nie ma przycisków Edytuj, Nowy sezon ani Nawożenie. To Twoja historia — przydatna przy płodozmianie.",
    tut_b7_t: "Powrót do bieżącego sezonu",
    tut_b7_x: "Kliknij ▶, żeby wrócić do sezonu 2.",
    tut_b8_t: "Nowy sezon",
    tut_b8_x: "Po żniwach: archiwizuje bieżący sezon, czyści uprawy, miesiące siewu i uprawę gleby, obniża pH wapna o jeden krok (zależnie od gleby) i zachowuje numery oraz powierzchnie pól. Pyta o potwierdzenie — nie klikaj teraz.",
    tut_b9_t: "Reset sezonów",
    tut_b9_x: "Usuwa całe archiwum sezonów i liczy od sezonu 1. Bieżące pola zostają bez zmian.",

    tut_c1_t: "Tabela pól",
    tut_c1_x: "Jeden wiersz na pole (lub część pola). Pola do obsiania w tym miesiącu są na górze, reszta według numeru.",
    tut_c2_t: "Siej teraz",
    tut_c2_x: "Pomarańczowe „Siej teraz”: pole nie jest obsiane, a jego miesiąc siewu to bieżący miesiąc w grze.",
    tut_c3_t: "Obsiane / Do obsiania",
    tut_c3_x: "Zielone „Obsiane” — już obsiane. Szare „Do obsiania” — czeka na swój miesiąc.",
    tut_c4_t: "Ostrzeżenie o płodozmianie ⟳",
    tut_c4_x: "Na tym polu w poprzednim sezonie rosła ta sama uprawa. Rozważ zmianę — najedź na ikonę po szczegóły.",
    tut_c5_t: "Pole dzielone",
    tut_c5_x: "Dwa wiersze z tym samym numerem = jedno pole podzielone między dwie uprawy (niebieski pasek). Podpis pokazuje całkowitą wielkość pola i ostrzega, gdy część hektarów nie jest przypisana albo przypisano za dużo.",
    tut_c6_t: "Pola łączone",
    tut_c6_x: "Numer w stylu „5-6” oznacza kilka fizycznych pól uprawianych jako jeden wiersz.",
    tut_c7_t: "Uprawa gleby",
    tut_c7_x: "Orka (bursztynowa) albo uprawa bezorkowa (zielona) — co planujesz zrobić przed siewem.",
    tut_c8_t: "Wapno",
    tut_c8_x: "Chip wypełnia się jak wskaźnik: wypełnienie = poziom pH gleby. Beżowy = świeżo wapnowane, bursztynowy ≈ połowa, rdzawy = prawie nic. Poniżej 75% wymaga uwagi. Każdy nowy sezon go obniża, szybciej na lżejszych glebach. Najedź, żeby zobaczyć szczegóły.",
    tut_c9_t: "Przycisk nawożenia",
    tut_c9_x: "Otwiera plan nawożenia pola. Biały = jeszcze nic nie zastosowano, brązowy = nawóz naturalny, zielony = nawóz mineralny.",
    tut_c10_t: "Suma powierzchni",
    tut_c10_x: "Suma hektarów w tabeli.",

    tut_d1_t: "Edytuj sezon",
    tut_d1_x: "Kliknij „Edytuj”. Przed każdą edycją zapisuje się automatyczna kopia zapasowa.",
    tut_d2_t: "Karty pól",
    tut_d2_x: "Każde pole jest teraz edytowalną kartą. ✕ je usuwa, a „+” przy numerze dodaje myślnik, żeby połączyć numery pól (np. 5-6).",
    tut_d3_t: "Dodaj pole",
    tut_d3_x: "Przewiń w dół i kliknij „+ Dodaj pole”.",
    tut_d4_t: "Numer pola",
    tut_d4_x: "Wpisz numer pola taki jak w grze, np. 7.",
    tut_d5_t: "Powierzchnia",
    tut_d5_x: "Wpisz powierzchnię w hektarach, np. 3,5.",
    tut_d6_t: "Uprawa",
    tut_d7_t: "Miesiąc siewu",
    tut_d7_x: "Wybierz miesiąc siewu. Dostępne są tylko miesiące właściwe dla wybranej uprawy na tej mapie.",
    tut_d8_t: "Uprawa gleby",
    tut_d8_x: "Kliknij „Orka”. Ponowne kliknięcie aktywnej opcji ją czyści.",
    tut_d9_t: "Wapno",
    tut_d9_x: "Kliknij chip wapna, żeby oznaczyć świeże wapnowanie (pH 100% w tym sezonie).",
    tut_d10_t: "Obsiane",
    tut_d10_x: "Zaznacz pole wyboru, żeby oznaczyć pole jako już obsiane.",
    tut_d11_t: "Zapisz",
    tut_d11_x: "Przycisk ma teraz napis „Zapisz zmiany” — kliknij go. Nie ma „Anuluj”: drugie kliknięcie zawsze zapisuje.",
    tut_d12_t: "Gotowe",
    tut_d12_x: "Nowe pole jest w tabeli, posortowane według numeru.",

    tut_e1_t: "Otwórz plan",
    tut_e1_x: "Kliknij „Nawożenie” przy polu 1 (pszenica).",
    tut_e2_t: "Zapotrzebowanie na azot",
    tut_e2_x: "Na górze: mieszanka gleb pola, powierzchnia i docelowa dawka azotu w kg N/ha oraz łącznie — liczona dla tej uprawy i gleby z danych Precision Farming.",
    tut_e3_t: "Azot już w glebie",
    tut_e3_x: "Wpisz, ile azotu jest już w glebie (z mapy gleby PF), np. 40.",
    tut_e4_t: "Nawóz naturalny",
    tut_e4_x: "Wpisz, ile azotu dasz obornikiem/gnojowicą/pofermentem, np. 30. Aplikacja przeliczy to na litry każdego z nich.",
    tut_e5_t: "Nawóz mineralny",
    tut_e5_x: "Reszta to to, co musi pokryć nawóz mineralny: kg N/ha i dawka w litrach (z buforem bezpieczeństwa). Status mówi, czy zapotrzebowanie jest pokryte.",
    tut_e6_t: "Oznacz jako zastosowany",
    tut_e6_x: "Zaznacz „Zastosowano nawóz sztuczny”.",
    tut_e7_t: "Zamknij",
    tut_e7_x: "Zamknij plan.",
    tut_e8_t: "Kolor przycisku",
    tut_e8_x: "Przycisk pola 1 jest teraz zielony — zastosowano nawóz mineralny.",

    tut_f1_t: "Uprawy",
    tut_f1_x: "Każda uprawa zasiana w tym sezonie z łączną powierzchnią — liczona automatycznie z pól, nic tu nie wpisujesz. Domyślnie w kolejności upraw z gry.",
    tut_f2_t: "Sortuj po areale",
    tut_f2_x: "Kliknij „Ha”, żeby największe uprawy były na górze. Drugi klik odwraca kolejność, trzeci wraca do kolejności z gry.",
    tut_f3_t: "Sortuj po nazwie",
    tut_f3_x: "Kliknij „Uprawa”, żeby posortować alfabetycznie. Nagłówki tabeli pól sortują tak samo.",
    tut_f4_t: "Międzyplony",
    tut_f4_x: "Międzyplony (poplon, zielone żyto…) ustawione w karcie pola mają osobną sekcję z własną sumą, żeby te same hektary nie liczyły się dwa razy.",
    tut_d6_x: "Wybierz uprawę. Lista zawiera wszystkie uprawy z mapy tej farmy, w kolejności z gry.",

    tut_g2_t: "Automatyczna synchronizacja",
    tut_g2_x: "Gdy jest włączona, aplikacja co 10 sekund sprawdza zapis gry i aktualizuje planer po zapisaniu gry. Wtedy pojawia się ten znaczek.",

    tut_h1_t: "Pasek boczny",
    tut_h1_x: "Pasek po lewej przełącza między planem pól a narzędziami farmy: finanse, zwierzęta, zaopatrzenie, gleby pól, notatki, prognoza plonów i planer pasz.",
    tut_h3_t: "Finanse",
    tut_h3_x: "Kliknij „Finanse”.",
    tut_h4_t: "Wykresy",
    tut_h4_x: "Saldo (linia ciągła) i kredyt (przerywana) miesiąc po miesiącu, zapisywane automatycznie z zapisu gry, oraz wykres według sezonów.",
    tut_h6_t: "Gleby pól",
    tut_h6_x: "Kliknij narzędzie gleb pól.",
    tut_h7_t: "Mieszanka gleb",
    tut_h7_x: "Wpisz udział każdego typu gleby na polu (z mapy gleby PF). Liczy się tylko proporcja. Wpisz np. 60 w pierwszym polu dla pola 1 i naciśnij Tab. Gleba wpływa na zapotrzebowanie na azot, ilość siewu, spadek pH i plon.",
    tut_h8_t: "Gleby z gry",
    tut_h8_x: "Po podpięciu zapisu gry ten przycisk odczyta mapę gleb prosto z gry i uzupełni każde pole — te same % co Precision Farming w grze. Nadpisuje wartości w tabeli.",
    tut_h9_t: "Zaopatrzenie",
    tut_h9_x: "Kliknij „Zaopatrzenie”.",
    tut_h10_t: "Nasiona",
    tut_h10_x: "Ilość nasion dla każdego nieobsianego pola: dawka w l/ha i łącznie z buforem. „?” oznacza nieznaną dawkę.",
    tut_h11_t: "Nawozy",
    tut_h11_x: "Nawożenie pól według planów nawożenia: docelowy azot, co już pokryto i ile litrów nawozu mineralnego kupić. Pola bez planu mają przycisk do jego uzupełnienia.",
    tut_h13_t: "Notatki",
    tut_h13_x: "Kliknij „Notatki”.",
    tut_h14_t: "Notatka",
    tut_h14_x: "Notatki można przypiąć do miesięcy, otagować i dodać do nich listę kontrolną. Notatki na bieżący miesiąc są wyróżnione.",
    tut_h15_t: "Nowa notatka",
    tut_h15_x: "Kliknij przycisk dodawania notatki.",
    tut_h16_t: "Tytuł",
    tut_h16_x: "Wpisz tytuł, np. „Kupić wapno”.",
    tut_h17_t: "Miesiące",
    tut_h17_x: "Wybierz miesiące, których dotyczy notatka — zostanie wyróżniona, gdy nadejdą. Niżej dodasz tagi i listę kontrolną.",
    tut_h18_t: "Zapisz notatkę",
    tut_h18_x: "Kliknij Zapisz.",
    tut_h20_t: "Prognoza plonów",
    tut_h20_x: "Kliknij narzędzie prognozy plonów.",
    tut_h21_t: "Prognoza",
    tut_h21_x: "Spodziewany zbiór każdej uprawy w litrach = hektary × plon uprawy × współczynnik gleby, przy idealnym azocie, pH i braku chwastów.",
    tut_h24_t: "Powrót do planu",
    tut_h24_x: "Kliknij „Plan”, żeby wrócić do tabeli pól. Zwierzęta i planer pasz mają osobne rozdziały.",

    tut_k1_t: "Zwierzęta",
    tut_k1_x: "Kliknij „Zwierzęta” w pasku bocznym.",
    tut_k3_t: "Liczba zwierząt",
    tut_k3_x: "Wszystkie zwierzęta razem, odczytane z zapisu gry (placeables.xml), i kafelek dla każdego budynku ze zdjęciem rasy, poziomem paszy i liczbą ciężarnych zwierząt. Wszystko odświeża się przy każdym zapisie gry — z automatyczną synchronizacją nawet w trakcie grania.",
    tut_k4_t: "Szczegóły budynku",
    tut_k4_x: "Kliknięcie kafelka otwiera pełną kartę budynku: obory, kurniki, pastwiska, stajnie. Nazwa pochodzi z pliku budynku na mapie — kliknij ołówek, żeby nadać własną.",
    tut_k5_t: "Zwierzęta i zdrowie",
    tut_k5_x: "Każda rasa i grupa wiekowa w osobnym wierszu: rasa × liczba sztuk i zdrowie. Zdrowie spada, gdy brakuje paszy, wody lub słomy albo budynek nie jest sprzątany — chore zwierzęta mniej produkują i są mniej warte.",
    tut_k19_t: "Stan rozrodu",
    tut_k19_x: "Każda grupa pokazuje też, na jakim etapie rozrodu jest: ciężarne (z paskiem postępu), gotowe do rozrodu, niezapłodnione albo za młode, oraz ile miesięcy minęło od ostatniego porodu.",
    tut_k6_t: "Pasek paszy",
    tut_k6_x: "Ile paszy jest teraz w korycie. Składniki mieszanki (np. trawa + kiszonka) są sumowane, bo trafiają do jednego koryta. Zielony = dużo, bursztynowy = poniżej 35%, czerwony = poniżej 15%.",
    tut_k7_t: "Pojemność koryta",
    tut_k7_x: "Zapis gry nie zawiera wielkości koryta, więc wpisujesz ją raz (odczytasz ją w informacjach o budynku w grze). Z podaną pojemnością pasek pokazuje prawdziwy procent.",
    tut_k8_t: "Na ile dni wystarczy paszy",
    tut_k8_x: "Pasza w korycie ÷ ile stado zjada dziennie. Bursztynowy poniżej 7 dni, czerwony poniżej 3 — czas dosypać.",
    tut_k20_t: "Dawka",
    tut_k20_x: "Czym karmisz ten budynek. Niżej: dzienne zapotrzebowanie rozbite na składniki i na ile dni wystarczy Twój zapas każdego z nich. To ten sam wybór co w planerze pasz — zmienisz go w dowolnym miejscu.",
    tut_k9_t: "Ostrzeżenie o paszy",
    tut_k9_x: "Kurnik jest prawie pusty, więc karta robi się czerwona z napisem „Mało paszy!”. Pojawia się, gdy w korycie jest poniżej 15% pojemności, poniżej 80 L przy niepodanej pojemności albo gdy paszy nie ma wcale.",
    tut_k10_t: "Wpisz pojemność",
    tut_k10_x: "Kurnik nie ma jeszcze pojemności („?”), więc jego pasek jest tylko porównywany z innymi budynkami. Wpisz 1000 i naciśnij Tab.",
    tut_k11_t: "Prawdziwy procent",
    tut_k11_x: "Teraz pasek to 60 L z 1000 L — prawdziwe 6%, na czerwono. Wpisz pojemności wszystkich budynków, żeby paski i ostrzeżenia były wiarygodne.",
    tut_k12_t: "Słabe zdrowie",
    tut_k12_x: "Te owce mają tylko 72% zdrowia, koryto jest poniżej 35% (bursztynowy pasek), a paszy starczy na mniej niż tydzień. Sprawdź wodę, słomę i sprzątanie — i dosyp paszy.",
    tut_k13_t: "Dzienne zapotrzebowanie",
    tut_k13_x: "Ile paszy, wody i słomy zużywa cały budynek dziennie. Liczone według wieku każdego zwierzęcia z krzywych wzrostu w grze — cielęta jedzą mniej niż dorosłe krowy.",
    tut_k21_t: "Reprodukcja",
    tut_k21_x: "Ile samic jest ciężarnych i kiedy następny poród. Jałówki są tu niezapłodnione — zwykle w budynku brakuje samca tej samej rasy. Termin porodu wymaga długości ciąży rasy z definicji zwierząt (Ustawienia farmy).",
    tut_k14_t: "Zgromadzona produkcja",
    tut_k14_x: "Co teraz czeka w budynku: mleko w zbiorniku, gnojowica, jajka, wełna. Sprzedaj lub odbierz, zanim magazyn się zapełni.",
    tut_k15_t: "Szacowana produkcja",
    tut_k15_x: "Ile budynek powinien produkować dziennie przy obecnym wieku zwierząt. Przydatne do planowania odbioru mleka i wywozu gnojowicy.",
    tut_k16_t: "Historia stada",
    tut_k16_x: "Miesiąc po miesiącu: liczba zwierząt, średnie zdrowie i wyprodukowane mleko. Aplikacja zapisuje punkt co miesiąc gry z zapisu gry.",
    tut_k17_t: "Mapy z modami",
    tut_k17_x: "Zapotrzebowanie i produkcja pochodzą z podstawowej gry. Jeśli mapa lub mody dodają własne zwierzęta, zaimportuj ich definicje w Ustawieniach farmy → folder definicji zwierząt.",
    tut_k18_t: "Powrót do planu",
    tut_k18_x: "Kliknij „Plan”, żeby wrócić do tabeli pól.",

    tut_m1_t: "Planer pasz",
    tut_m1_x: "Kliknij „Planer pasz” w pasku bocznym.",
    tut_m2_t: "Wybierz oborę",
    tut_m2_x: "Kafelek dla każdego budynku ze zwierzętami i rocznym zapotrzebowaniem na paszę. Czerwona kropka oznacza, że któregoś składnika nie starczy na rok.",
    tut_m3_t: "Wybierz paszę",
    tut_m3_x: "Dawki z gry z ich wydajnością — krowy dają pełną produkcję tylko na TMR. „+” tworzy własną paszę z własnymi składnikami.",
    tut_m5_t: "Paszowóz",
    tut_m5_x: "Paszowozy, które masz, są odczytywane z zapisu gry. „Nowy paszowóz” doda własny z jego pojemnością.",
    tut_m6_t: "Pojemność paszowozu",
    tut_m6_x: "Pojemności paszowozów z podstawowej gry nie da się odczytać z plików gry. Wpisz ją raz, np. 20000, i naciśnij Tab.",
    tut_m7_t: "Dobierz do receptury",
    tut_m7_x: "Kliknij „Dobierz do receptury” — aplikacja załaduje paszowóz według Twojej receptury TMR z bel, które masz na farmie.",
    tut_m8_t: "Załadunek",
    tut_m8_x: "Bele wchodzą w całości albo połówkami (− / +), a to, czego nie ma w belach (np. pasza mineralna), idzie luzem. W każdym wierszu wybierzesz inną belę albo dodasz własny rodzaj beli — litry robią się czerwone, gdy użyjesz więcej bel, niż masz.",
    tut_m9_t: "Mieszanka",
    tut_m9_x: "Jak pełny jest paszowóz i pasek dla każdego składnika: zacieniony pas to dozwolony zakres, znacznik to Twoja receptura. Zielony = paszowóz zrobi TMR. Niżej: na ile dni ten załadunek wykarmi oborę.",
    tut_m10_t: "Składniki na rok",
    tut_m10_x: "Roczne zapotrzebowanie obory na każdy składnik w porównaniu z magazynem i planowanym zbiorem. Brakująca pasza jest podana w litrach i w przybliżeniu w hektarach do obsiania.",
    tut_m11_t: "Ustawienia",
    tut_m11_x: "Kliknij pasek ustawień, żeby go rozwinąć.",
    tut_m12_t: "Pola paszowe i parametry",
    tut_m12_x: "Wybierz, które pola dają paszę i na co idą (sprzedaż, pasza, kiszonka), gdzie zbierasz słomę, ile pokosów trawy w roku i jakie plony. Tu są też Twoje własne pasze.",
    tut_m13_t: "Powrót do planu",
    tut_m13_x: "Kliknij „Plan”, żeby wrócić do tabeli pól.",

    tut_i1_t: "Ustawienia farmy",
    tut_i1_x: "Kliknij przycisk ustawień farmy.",
    tut_i2_t: "Nazwa mapy",
    tut_i2_x: "Wpisz nazwę mapy, np. „Hutan Pantai”.",
    tut_i3_t: "Zapis gry",
    tut_i3_x: "Wskaż folder zapisu gry (np. Dokumenty\\My Games\\FarmingSimulator2025\\savegame1) przyciskiem „...”. Dzięki temu saldo, miesiąc, kredyt, sprzęt, zwierzęta, zapasy paszy, bele i paszowozy są pobierane z gry.",
    tut_i4_t: "Automatyczna synchronizacja",
    tut_i4_x: "Włącz, żeby planer aktualizował się sam po każdym zapisie gry.",
    tut_i5_t: "Uprawy i zwierzęta mapy",
    tut_i5_x: "Dla map z modami: wskaż folder mapy, żeby zaimportować jej uprawy (kalendarz siewu) i definicje zwierząt.",
    tut_i6_t: "Dostosuj stawki",
    tut_i6_x: "Kliknij „Dostosuj stawki”, żeby je rozwinąć.",
    tut_i7_t: "Dawki",
    tut_i7_x: "Bufor %, zawartość azotu w nawozie mineralnym, azot w oborniku/gnojowicy/pofermencie oraz dawki nasion i azotu dla każdej uprawy. Puste = wartość domyślna.",
    tut_i8_t: "Zapisz",
    tut_i8_x: "Kliknij „Zapisz i importuj”.",
    tut_i9_t: "Zapisano",
    tut_i9_x: "Nazwa mapy jest teraz widoczna w nagłówku.",

    tut_j1_t: "Powrót do farm",
    tut_j1_x: "Kliknij przycisk wyjścia, żeby wrócić do listy farm.",
    tut_j2_t: "Ustawienia aplikacji",
    tut_j2_x: "Kliknij ikonę koła zębatego.",
    tut_j3_t: "Język",
    tut_j3_x: "W każdej chwili przełączysz polski i angielski.",
    tut_j4_t: "Discord",
    tut_j4_x: "Pokazuj w statusie Discorda farmę, nad którą pracujesz.",
    tut_j5_t: "Samouczek",
    tut_j5_x: "Tutaj wrócisz do tego samouczka i każdego z jego rozdziałów.",
    tut_j6_t: "Zamknij",
    tut_j6_x: "Zamknij ustawienia.",
    tut_j7_t: "Gotowe!",
    tut_j7_x: "Farma ćwiczeniowa zostanie teraz usunięta. Udanych zbiorów!"
});

let currentLang = localStorage.getItem(CONFIG_KEY_LANG) || 'en';

// Months are stored internally in English everywhere (CROP_CALENDAR keys,
// state comparisons like "is it time to plant this month", saved farm
// data) — only how they're DISPLAYED changes with language. Never store
// the translated form anywhere that gets read back into logic.
const MONTH_TRANSLATIONS = {
    pl: {
        JANUARY: "STYCZEŃ", FEBRUARY: "LUTY", MARCH: "MARZEC", APRIL: "KWIECIEŃ",
        MAY: "MAJ", JUNE: "CZERWIEC", JULY: "LIPIEC", AUGUST: "SIERPIEŃ",
        SEPTEMBER: "WRZESIEŃ", OCTOBER: "PAŹDZIERNIK", NOVEMBER: "LISTOPAD", DECEMBER: "GRUDZIEŃ"
    }
};

function translateMonth(monthEn) {
    if (!monthEn) return monthEn;
    const key = monthEn.toUpperCase();
    const dict = MONTH_TRANSLATIONS[currentLang];
    return (dict && dict[key]) ? dict[key] : monthEn;
}

// Crop names come from whatever mod files the person imported, so we can't
// know every possible crop — this covers the common vanilla/mod ones as a
// display-only translation, and anything not listed just falls back to its
// original (English) name rather than showing blank or breaking anything.
// The underlying field.crop / CROP_CALENDAR keys always stay in the
// original imported form; only the visible label changes.
const CROP_NAME_TRANSLATIONS = {
    pl: {
        "Wheat": "Pszenica", "Barley": "Jęczmień", "Canola": "Rzepak", "Oat": "Owies", "Oats": "Owies", "Beans": "Fasola", "Greenrye": "Żyto na zielonkę",
        "Sunflower": "Słonecznik", "Soybean": "Soja", "Soybeans": "Soja", "Corn": "Kukurydza", "Maize": "Kukurydza", "Beetroot": "Burak czerwony", "Buckwheat": "Gryka",
        "Potato": "Ziemniaki", "Potatoes": "Ziemniaki", "Sugar Beet": "Burak Cukrowy", "Sugarbeet": "Burak Cukrowy", "Clover": "Koniczyna", "Greenbean": "Fasolka zielona",
        "Cotton": "Bawełna", "Grape": "Winogrona", "Grapes": "Winogrona", "Olive": "Oliwki", "Olives": "Oliwki", "Meadow": "Łąka", "Millet": "Proso", "Oilseedradish": "Poplon",
        "Poplar": "Topola", "Rice": "Ryż", "Rye": "Żyto", "Triticale": "Pszenżyto", "Pea": "Groch", "Silagemaize": "Kukurydza na kiszonkę",
        "Green Beans": "Fasola Szparagowa", "Spinach": "Szpinak", "Sugarcane": "Trzcina Cukrowa",
        "Sugar Cane": "Trzcina Cukrowa", "Parsnip": "Pasternak", "Parsnips": "Pasternak", "Carrot": "Marchew",
        "Long Grain Rice": "Ryż Długoziarnisty", "Rice Long Grain": "Ryż długoziarnisty", "Ricelonggrain": "Ryż długoziarnisty",
        "Onion": "Cebula", "Onions": "Cebula", "Sorghum": "Sorgo", "Alfalfa": "Lucerna",
        "Semolina": "Kasza Manna", "Grass": "Trawa", "Hay": "Siano", "Silage": "Kiszonka", "Straw": "Słoma",
        "Chaff": "Sieczka", "Wood Chips": "Zrębki", "Manure": "Obornik", "Slurry": "Gnojowica", "Digestate": "Poferment",
        "Fallow": "Ugór",
        "Spelt": "Orkisz", "Mustard": "Gorczyca", "Flax": "Len", "Vetch": "Wyka", "Vetchrye": "Wyka z żytem",
        "Mustardcover": "Gorczyca na międzyplon", "Fieldgrass": "Trawa polowa"
    }
};

// Crop names come from formatCropName(), which title-cases whatever spacing
// a mod/map's fruitType attribute happens to use ("SILAGE_MAIZE" ->
// "Silage Maize", but another file's "silageMaize" -> "Silagemaize") — so an
// exact-string dictionary lookup misses names that only differ by spacing.
// Normalizing away spaces/case before comparing (both here and once, up
// front, for the dictionary itself) makes the match spacing/casing-tolerant
// without having to hand-list every spacing variant of every crop name.
function normalizeCropNameKey(name) {
    return name.toLowerCase().replace(/[\s_-]+/g, '');
}

const CROP_NAME_TRANSLATIONS_NORMALIZED = {};
Object.keys(CROP_NAME_TRANSLATIONS).forEach(lang => {
    const normalized = {};
    Object.keys(CROP_NAME_TRANSLATIONS[lang]).forEach(name => {
        normalized[normalizeCropNameKey(name)] = CROP_NAME_TRANSLATIONS[lang][name];
    });
    CROP_NAME_TRANSLATIONS_NORMALIZED[lang] = normalized;
});

function translateCropName(name) {
    if (!name || currentLang === 'en') return name;
    const dict = CROP_NAME_TRANSLATIONS_NORMALIZED[currentLang];
    const translated = dict && dict[normalizeCropNameKey(name)];
    return translated || name;
}

// Animal subType strings look like "COW_HOLSTEIN", "ROOSTER_BOHUSDAL",
// "CHICKEN" — translate just the species word (common across mods/maps)
// and title-case whatever breed suffix follows, since breed names vary too
// much between maps to maintain a full dictionary for.
const ANIMAL_SPECIES_TRANSLATIONS = {
    pl: {
        COW: "Krowa", BULL: "Byk", CHICKEN: "Kura", ROOSTER: "Kogut",
        SHEEP: "Owca", PIG: "Świnia", HORSE: "Koń", GOAT: "Koza", TURKEY: "Indyk"
    }
};

function formatAnimalName(subType) {
    if (!subType) return subType;
    const parts = subType.split('_').filter(Boolean);
    const speciesKey = parts[0];
    const dict = ANIMAL_SPECIES_TRANSLATIONS[currentLang];
    const speciesWord = (dict && dict[speciesKey])
        ? dict[speciesKey]
        : (speciesKey.charAt(0) + speciesKey.slice(1).toLowerCase());
    const rest = parts.slice(1).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    return rest ? `${speciesWord} ${rest}` : speciesWord;
}

// Building names only exist in the save as a mod file path (e.g.
// ".../SFarm_chickenBarn.xml") — this is a best-effort cosmetic cleanup,
// not a reliable translation, since every map names these differently.
function formatBuildingName(filename) {
    if (!filename) return t('hubAnimals');
    let base = filename.split(/[\\/]/).pop().replace(/\.xml$/i, '');
    base = base.replace(/^[A-Za-z0-9]+_/, '');
    base = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    base = base.replace(/_/g, ' ');
    base = base.replace(/(barn|coop|stable|shed|house|pasture|pen)/i, ' $1');
    base = base.replace(/\s+/g, ' ').trim();
    return base ? base.replace(/\b\w/g, c => c.toUpperCase()) : t('hubAnimals');
}

// fillType strings from husbandry storage/pending production (MILK, EGG...).
const PRODUCTION_FILLTYPE_TRANSLATIONS = {
    pl: {
        MILK: "Mleko", EGG: "Jajka", WOOL: "Wełna", LIQUIDMANURE: "Gnojowica", MANURE: "Obornik", STRAW: "Słoma",
        FOOD: "Pasza", WATER: "Woda"
    }
};

function formatFillType(fillType) {
    if (!fillType) return fillType;
    const dict = PRODUCTION_FILLTYPE_TRANSLATIONS[currentLang];
    if (dict && dict[fillType]) return dict[fillType];
    return fillType.charAt(0) + fillType.slice(1).toLowerCase();
}

function t(key) {
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    if (dict[key] !== undefined) return dict[key];
    return TRANSLATIONS.en[key] !== undefined ? TRANSLATIONS.en[key] : key;
}

function applyLanguage(lang) {
    currentLang = (lang === 'pl') ? 'pl' : 'en';
    localStorage.setItem(CONFIG_KEY_LANG, currentLang);
    document.documentElement.setAttribute('lang', currentLang);

    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });

    const farmListEl = document.querySelector('.farm-list');
    if (farmListEl) farmListEl.setAttribute('data-empty-text', t('noFarmsYet'));

    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('is-selected', btn.getAttribute('data-lang') === currentLang);
    });

    // Re-render whatever's currently on screen so dynamically generated
    // strings (badges, statuses, hints) pick up the new language too.
    renderFarmList(getAllFarms());
    if (typeof currentFarmId !== 'undefined' && currentFarmId && plannerView && plannerView.style.display !== 'none') {
        renderSeasonView();
    }
    updateDiscordPresence();
}

// =============================================================
// SECTION 1C: DISCORD RICH PRESENCE
// =============================================================
// Purely cosmetic: tells Discord what the user is up to
// (e.g. "Managing 12 fields" / "Farm: Solek"). The heavy lifting — talking to
// the Discord client — lives in the main process (discord-presence.js); here we
// just describe the current app state and push it over IPC.
const DISCORD_SESSION_START = Date.now();
let _lastDiscordPayload = null;

function isDiscordRpcEnabled() {
    // Opt-out: on unless the user explicitly turned it off.
    return localStorage.getItem(CONFIG_KEY_DISCORD_RPC) !== '0';
}

// Polish needs three plural forms (1 / 2-4 / 5+); English just two.
function discordPlural(n, oneKey, fewKey, manyKey) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (n === 1) return t(oneKey);
    if (currentLang === 'pl') {
        if (last >= 2 && last <= 4 && (abs < 10 || abs >= 20)) return t(fewKey);
        return t(manyKey);
    }
    return t(manyKey);
}

// Plain placeholder swap — a function replacer so a farm name containing "$"
// isn't treated as a regex substitution pattern.
function fillTemplate(str, vars) {
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function updateDiscordPresence() {
    if (typeof ipcRenderer === 'undefined') return;

    if (!isDiscordRpcEnabled()) {
        if (_lastDiscordPayload !== null) {
            _lastDiscordPayload = null;
            ipcRenderer.send('discord-presence:clear');
        }
        return;
    }

    const inPlanner = plannerView && plannerView.style.display !== 'none' && currentFarmId;
    let details;
    let state;

    if (inPlanner) {
        const farm = getAllFarms().find(f => f.id === currentFarmId);
        const fieldCount = farm && Array.isArray(farm.fields) ? farm.fields.length : 0;
        details = fillTemplate(t('discordManagingFields'), {
            n: fieldCount,
            fields: discordPlural(fieldCount, 'discordFieldOne', 'discordFieldFew', 'discordFieldMany'),
        });
        state = fillTemplate(t('discordOnFarm'), { name: farm ? farm.name : '' });
    } else {
        const farmCount = getAllFarms().length;
        details = t('discordBrowsing');
        state = fillTemplate(t('discordFarmCount'), {
            n: farmCount,
            farms: discordPlural(farmCount, 'discordFarmOne', 'discordFarmFew', 'discordFarmMany'),
        });
    }

    const payload = {
        details,
        state,
        startTimestamp: DISCORD_SESSION_START,
        largeImageKey: 'logo',
        largeImageText: 'Farmer Planner',
    };

    const sig = JSON.stringify(payload);
    if (sig === _lastDiscordPayload) return; // nothing changed — don't spam the pipe
    _lastDiscordPayload = sig;
    ipcRenderer.send('discord-presence:set', payload);
}

// =============================================================
// SECTION 1B: CUSTOM TITLEBAR (frameless window controls)
// =============================================================
const titlebarMinBtn = document.getElementById('titlebar-min');
const titlebarMaxBtn = document.getElementById('titlebar-max');
const titlebarCloseBtn = document.getElementById('titlebar-close');

if (titlebarMinBtn) titlebarMinBtn.addEventListener('click', () => ipcRenderer.send('window-minimize'));
if (titlebarMaxBtn) titlebarMaxBtn.addEventListener('click', () => ipcRenderer.send('window-maximize-toggle'));
if (titlebarCloseBtn) titlebarCloseBtn.addEventListener('click', () => ipcRenderer.send('window-close'));

// Double-clicking the drag area should also toggle maximize, like a normal titlebar.
const titlebarDragArea = document.querySelector('.titlebar-drag');
if (titlebarDragArea) titlebarDragArea.addEventListener('dblclick', () => ipcRenderer.send('window-maximize-toggle'));

ipcRenderer.on('window-maximized-change', (event, isMaximized) => {
    if (!titlebarMaxBtn) return;
    titlebarMaxBtn.innerHTML = isMaximized ? '<i class="fa-solid fa-window-restore" aria-hidden="true"></i>' : '<i class="fa-solid fa-window-maximize" aria-hidden="true"></i>';
    titlebarMaxBtn.title = isMaximized ? 'Restore' : 'Maximize';
});

// =============================================================
// SECTION 2: UI DOM ELEMENTS
// =============================================================
const dashboardView = document.getElementById('dashboard-view');
const plannerView = document.getElementById('planner-view');

const addFarmModal = document.getElementById('farm-modal');
const addFarmBtn = document.querySelector('.add-farm-btn');
const importBackupBtn = document.getElementById('import-backup-btn');
const confirmAddBtn = document.getElementById('confirm-btn');
const cancelAddBtn = document.getElementById('cancel-btn');
const newFarmInput = document.getElementById('new-farm-name');
const newFarmMapInput = document.getElementById('new-farm-map');

const deleteModal = document.getElementById('confirm-delete-modal');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
const deleteToggle = document.getElementById('delete-mode-toggle');

const resetSeasonsBtn = document.getElementById('reset-seasons-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');

// --- App-level settings (language, for now) ---
const appSettingsBtn = document.getElementById('app-settings-btn');
const appSettingsModal = document.getElementById('app-settings-modal');
const closeAppSettingsBtn = document.getElementById('close-app-settings-btn');
const langButtons = document.querySelectorAll('.lang-btn');
const discordRpcToggle = document.getElementById('discord-rpc-toggle');

if (appSettingsBtn && appSettingsModal) {
    appSettingsBtn.addEventListener('click', () => {
        if (discordRpcToggle) discordRpcToggle.checked = isDiscordRpcEnabled();
        appSettingsModal.style.display = 'flex';
    });
}
if (closeAppSettingsBtn && appSettingsModal) {
    closeAppSettingsBtn.addEventListener('click', () => {
        appSettingsModal.style.display = 'none';
    });
}
langButtons.forEach(btn => {
    btn.addEventListener('click', () => applyLanguage(btn.getAttribute('data-lang')));
});
const replayTutorialBtn = document.getElementById('replay-tutorial-btn');
if (replayTutorialBtn) {
    replayTutorialBtn.addEventListener('click', () => {
        if (appSettingsModal) appSettingsModal.style.display = 'none';
        startTutorial();
    });
}
if (discordRpcToggle) {
    discordRpcToggle.addEventListener('change', () => {
        localStorage.setItem(CONFIG_KEY_DISCORD_RPC, discordRpcToggle.checked ? '1' : '0');
        updateDiscordPresence();
    });
}

// --- Planner sidebar: switches between the field plan and the tool views
// (Finance / Animals / Supplies / ...), which render into #hub-view in place
// of the planner content. #hub-panel-modal is only the per-field fert plan.
const plannerContentEl = document.querySelector('#planner-view .planner-content');
const hubView = document.getElementById('hub-view');
const hubPanelModal = document.getElementById('hub-panel-modal');
const closeHubPanelBtn = document.getElementById('close-hub-panel-btn');
let currentPlannerView = 'plan';

function setActiveSidebarItem(view) {
    currentPlannerView = view;
    document.querySelectorAll('#planner-sidebar .sidebar-item[data-view]').forEach(el => {
        el.classList.toggle('is-active', el.dataset.view === view);
    });
}

window.showPlannerView = function (view) {
    if (!view || view === 'plan') {
        setActiveSidebarItem('plan');
        if (hubView) hubView.hidden = true;
        if (plannerContentEl) plannerContentEl.style.display = '';
        return;
    }
    if (view === 'animals') animalSelectedBuilding = null;   // sidebar always opens the barn overview
    openHubPanel(view);
    if (hubView) hubView.scrollTop = 0;
};

document.querySelectorAll('#planner-sidebar .sidebar-item[data-view]').forEach(el => {
    el.addEventListener('click', () => showPlannerView(el.dataset.view));
});

if (closeHubPanelBtn && hubPanelModal) {
    closeHubPanelBtn.addEventListener('click', () => {
        hubPanelModal.style.display = 'none';
        // Supplies lists "fill in the plan" per field — refresh it after editing one.
        if (currentPlannerView === 'supplies') openHubPanel('supplies');
    });
}

// Reads a value straight off the already-rendered Farm Details card,
// so the hub panels never show a number that could drift out of sync
// with what's on screen there.
// Reads balance/loan from every archived season (older archives made before
// this feature won't have them and are skipped) plus the live current
// season, giving a season-by-season trend rather than one static number.
function getSeasonBalanceHistory(farm) {
    const history = [];
    if (!farm || !farm.folderName) return history;

    const parseMoney = (v) => {
        if (v === undefined || v === null) return 0;
        const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
        return isNaN(n) ? 0 : n;
    };

    const seasonsDir = path.join(appDataDir, farm.folderName, 'seasons');
    if (fs.existsSync(seasonsDir)) {
        fs.readdirSync(seasonsDir).forEach(fileName => {
            const match = fileName.match(/^season_(\d+)\.json$/);
            if (!match) return;
            try {
                const data = JSON.parse(fs.readFileSync(path.join(seasonsDir, fileName), 'utf-8'));
                if (data.balance !== undefined) {
                    history.push({ season: parseInt(match[1]), balance: parseMoney(data.balance), loan: parseMoney(data.loan) });
                }
            } catch (err) { /* skip an unreadable archive rather than fail the whole panel */ }
        });
    }

    history.push({ season: farm.currentSeason || 1, balance: parseMoney(farm.balance), loan: parseMoney(farm.loan) });
    history.sort((a, b) => a.season - b.season);
    return history;
}

// Hand-rolled inline SVG line chart — no charting library, so the app stays
// dependency-free and works fully offline. Draws balance (solid) and, if
// any loan was ever owed, a dashed loan line on the same axes.
function buildBalanceChartSvg(history, opts = {}) {
    if (!history || history.length < 2) return '';

    // Default labelling = season charts ("S1", "S2", ...); monthly charts pass
    // their own labelFn/titleFn and a maxLabels cap so a 24-point year-and-a-half
    // trend doesn't turn the x-axis into mush.
    const labelFn = opts.labelFn || ((h) => `S${h.season}`);
    const titleBalanceFn = opts.titleBalanceFn || ((h) => `${t('season')} ${h.season}: ${Math.round(h.balance).toLocaleString()} €`);
    const titleLoanFn = opts.titleLoanFn || ((h) => `${t('season')} ${h.season} — ${t('detailCredit')}: ${Math.round(h.loan).toLocaleString()} €`);
    const maxLabels = opts.maxLabels || Infinity;
    const labelStep = Math.max(1, Math.ceil(history.length / maxLabels));

    const width = 460, height = 180;
    const padL = 54, padR = 16, padT = 16, padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const hasLoan = history.some(h => h.loan > 0);
    const allValues = history.map(h => h.balance).concat(hasLoan ? history.map(h => h.loan) : [0]);
    let minV = Math.min(0, ...allValues);
    let maxV = Math.max(...allValues, 1);
    if (minV === maxV) maxV = minV + 1;

    const xStep = plotW / (history.length - 1);
    const xScale = (i) => padL + i * xStep;
    const yScale = (v) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;
    const zeroY = yScale(0);

    const balancePts = history.map((h, i) => `${xScale(i)},${yScale(h.balance)}`).join(' ');
    const loanPts = history.map((h, i) => `${xScale(i)},${yScale(h.loan)}`).join(' ');

    let svg = `<svg viewBox="0 0 ${width} ${height}" class="balance-chart-svg" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<line x1="${padL}" y1="${yScale(maxV)}" x2="${padL}" y2="${padT + plotH}" class="chart-axis-line" />`;
    svg += `<line x1="${padL}" y1="${zeroY}" x2="${width - padR}" y2="${zeroY}" class="chart-zero-line" />`;
    svg += `<text x="${padL - 8}" y="${yScale(maxV) + 4}" class="chart-axis-label" text-anchor="end">${Math.round(maxV).toLocaleString()}</text>`;
    svg += `<text x="${padL - 8}" y="${zeroY + 4}" class="chart-axis-label" text-anchor="end">0</text>`;

    if (hasLoan) svg += `<polyline points="${loanPts}" class="chart-line chart-line--loan" />`;
    svg += `<polyline points="${balancePts}" class="chart-line chart-line--balance" />`;

    history.forEach((h, i) => {
        const x = xScale(i);
        svg += `<circle cx="${x}" cy="${yScale(h.balance)}" r="3.5" class="chart-dot chart-dot--balance"><title>${titleBalanceFn(h)}</title></circle>`;
        if (hasLoan) svg += `<circle cx="${x}" cy="${yScale(h.loan)}" r="3.5" class="chart-dot chart-dot--loan"><title>${titleLoanFn(h)}</title></circle>`;
        if (i % labelStep === 0 || i === history.length - 1) {
            svg += `<text x="${x}" y="${height - 8}" class="chart-axis-label" text-anchor="middle">${labelFn(h, i)}</text>`;
        }
    });

    svg += `</svg>`;
    return svg;
}

// Same idea as getSeasonBalanceHistory, but for the animal herd: total head
// count and the (numAnimals-weighted) average health, read from every
// archived season that has them (older archives made before this feature
// won't, and are skipped) plus the live current season.
function getAnimalHistoryTrend(farm) {
    const history = [];
    if (!farm || !farm.folderName) return history;

    const computeAvgHealth = (buildings) => {
        let weightedSum = 0, count = 0;
        (buildings || []).forEach(b => (b.clusters || []).forEach(c => {
            weightedSum += c.health * c.numAnimals;
            count += c.numAnimals;
        }));
        return count > 0 ? weightedSum / count : null;
    };

    const seasonsDir = path.join(appDataDir, farm.folderName, 'seasons');
    if (fs.existsSync(seasonsDir)) {
        fs.readdirSync(seasonsDir).forEach(fileName => {
            const match = fileName.match(/^season_(\d+)\.json$/);
            if (!match) return;
            try {
                const data = JSON.parse(fs.readFileSync(path.join(seasonsDir, fileName), 'utf-8'));
                if (data.animals !== undefined) {
                    history.push({
                        season: parseInt(match[1]),
                        animals: data.animals || 0,
                        avgHealth: (data.avgHealth !== undefined && data.avgHealth !== null) ? data.avgHealth : null
                    });
                }
            } catch (err) { /* skip an unreadable archive rather than fail the whole panel */ }
        });
    }

    history.push({
        season: farm.currentSeason || 1,
        animals: farm.animals || 0,
        avgHealth: computeAvgHealth(farm.animalBuildings)
    });
    history.sort((a, b) => a.season - b.season);
    return history;
}

// Generic single-series version of buildBalanceChartSvg, for trends that
// don't need a second overlaid line (animal count, average health, ...).
// Points whose value is null/undefined (e.g. health before this feature
// existed) are dropped rather than plotted as zero.
function buildSingleLineChartSvg(history, valueKey, opts) {
    const points = (history || []).filter(h => h[valueKey] !== null && h[valueKey] !== undefined);
    if (points.length < 2) return '';

    const width = 460, height = 150;
    const padL = 40, padR = 16, padT = 14, padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const values = points.map(h => h[valueKey]);
    let minV = opts.fixedMin !== undefined ? opts.fixedMin : Math.min(0, ...values);
    let maxV = opts.fixedMax !== undefined ? opts.fixedMax : Math.max(...values, 1);
    if (minV === maxV) maxV = minV + 1;

    const xStep = plotW / (points.length - 1);
    const xScale = (i) => padL + i * xStep;
    const yScale = (v) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;

    const linePts = points.map((h, i) => `${xScale(i)},${yScale(h[valueKey])}`).join(' ');
    const unit = opts.unit || '';
    const labelFn = opts.labelFn || ((h) => `S${h.season}`);
    const titleFn = opts.titleFn || ((h) => `${t('season')} ${h.season}: ${Math.round(h[valueKey]).toLocaleString()}${unit}`);
    const maxLabels = opts.maxLabels || Infinity;
    const labelStep = Math.max(1, Math.ceil(points.length / maxLabels));

    let svg = `<svg viewBox="0 0 ${width} ${height}" class="balance-chart-svg" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" class="chart-axis-line" />`;
    svg += `<text x="${padL - 6}" y="${yScale(maxV) + 4}" class="chart-axis-label" text-anchor="end">${Math.round(maxV).toLocaleString()}${unit}</text>`;
    svg += `<text x="${padL - 6}" y="${yScale(minV) + 4}" class="chart-axis-label" text-anchor="end">${Math.round(minV).toLocaleString()}${unit}</text>`;
    svg += `<polyline points="${linePts}" class="chart-line ${opts.lineClass || ''}" />`;

    points.forEach((h, i) => {
        const x = xScale(i);
        svg += `<circle cx="${x}" cy="${yScale(h[valueKey])}" r="3.5" class="chart-dot ${opts.dotClass || ''}"><title>${titleFn(h)}</title></circle>`;
        if (i % labelStep === 0 || i === points.length - 1) {
            svg += `<text x="${x}" y="${height - 8}" class="chart-axis-label" text-anchor="middle">${labelFn(h, i)}</text>`;
        }
    });

    svg += `</svg>`;
    return svg;
}

// =============================================================
// SECTION 4A: MONTHLY HISTORY LOG
// =============================================================
// One row per in-game month (the game's own period counter — see readGameSave),
// so finance / herd / production curves plot month-by-month instead of a single
// dot per manual "season". Appended by applyGameSaveToFarm whenever the live
// savegame is read (planner open + the real-time auto-sync loop).

function monthlyHistoryPath(farm) {
    if (!farm || !farm.folderName) return null;
    return path.join(appDataDir, farm.folderName, 'monthly.json');
}

function loadMonthlyHistory(farm) {
    const p = monthlyHistoryPath(farm);
    if (!p || !fs.existsSync(p)) return [];
    try {
        const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return Array.isArray(arr) ? arr : [];
    } catch (err) {
        return []; // corrupt log — start fresh rather than break every chart
    }
}

function saveMonthlyHistory(farm, rows) {
    const p = monthlyHistoryPath(farm);
    if (!p) return;
    try { fs.writeFileSync(p, JSON.stringify(rows, null, 2), 'utf-8'); }
    catch (err) { console.error('Could not write monthly history:', err); }
}

function avgHealthFromBuildings(buildings) {
    let weightedSum = 0, count = 0;
    (buildings || []).forEach(b => (b.clusters || []).forEach(c => {
        weightedSum += c.health * c.numAnimals;
        count += c.numAnimals;
    }));
    return count > 0 ? weightedSum / count : null;
}

// The comparable slice of a row — used to decide whether an in-place update of
// the current month's row is worth a disk write.
function monthlyRowFingerprint(row) {
    return JSON.stringify({
        b: Math.round(row.balance || 0),
        l: Math.round(row.loan || 0),
        e: row.equipment ?? null,
        a: row.animals ?? null,
        h: row.avgHealth == null ? null : Math.round(row.avgHealth),
        p: row.production || {}
    });
}

// Builds the row for the current in-game month from freshly-read save data
// (gameData) merged onto `farm`.
function buildMonthlyRow(farm, gameData) {
    const parseMoney = (v) => {
        if (v === undefined || v === null) return 0;
        const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
        return isNaN(n) ? 0 : n;
    };
    return {
        period: gameData.gamePeriod,
        month: FS_PERIOD_TO_MONTH[gameData.gamePeriod % 12],
        gameYear: gameData.gameYear,
        gameDay: gameData.gameDay,
        appSeason: farm.currentSeason || 1,
        recordedAt: new Date().toISOString(),
        balance: parseMoney(farm.balance),
        loan: parseMoney(farm.loan),
        equipment: (farm.equipment ?? null),
        animals: (farm.animals ?? 0),
        avgHealth: avgHealthFromBuildings(gameData.animalBuildings || farm.animalBuildings),
        // fillType -> litres currently in storage/tank (a stock level, not
        // throughput — the delta between months is charted as an output proxy).
        production: gameData.animalProduction || farm.animalProduction || {}
    };
}

// Append a new month, or refresh the current month's row in place as values
// move during that month. Never rewrites older rows and ignores a save that
// jumped backwards in time (older save loaded) so the log can't be corrupted.
function recordMonthlySnapshot(farm, gameData) {
    if (!farm || !farm.folderName) return;
    if (!gameData || gameData.gamePeriod === null || gameData.gamePeriod === undefined) return;

    const rows = loadMonthlyHistory(farm);
    const last = rows[rows.length - 1];
    const row = buildMonthlyRow(farm, gameData);

    if (!last || row.period > last.period) {
        rows.push(row);
        saveMonthlyHistory(farm, rows);
    } else if (row.period === last.period) {
        if (monthlyRowFingerprint(row) !== monthlyRowFingerprint(last)) {
            // keep the original recordedAt so it still marks when the month began
            row.recordedAt = last.recordedAt;
            row.updatedAt = new Date().toISOString();
            rows[rows.length - 1] = row;
            saveMonthlyHistory(farm, rows);
        }
    }
    // row.period < last.period -> older save loaded, leave history untouched
}

// Short, localized month label for a monthly row ("Aug", "Sty", ...).
function monthlyRowLabel(row) {
    const full = translateMonth(row.month || FS_PERIOD_TO_MONTH[(row.period || 0) % 12]);
    return full.slice(0, 3);
}

// Returns the monthly rows plus a derived `milkOut`/per-fillType delta series:
// the month-over-month increase in stored litres, a rough proxy for how much
// was produced that month (drops to 0 rather than negative when the player
// sold/emptied storage).
function getMonthlyHistory(farm) {
    const rows = loadMonthlyHistory(farm);
    for (let i = 0; i < rows.length; i++) {
        const prev = i > 0 ? (rows[i - 1].production || {}) : {};
        const cur = rows[i].production || {};
        const delta = {};
        let total = 0;
        Object.keys(cur).forEach(ft => {
            const d = Math.max(0, (cur[ft] || 0) - (prev[ft] || 0));
            if (d > 0) { delta[ft] = d; total += d; }
        });
        rows[i].productionDelta = delta;
        rows[i].productionDeltaTotal = total;
    }
    return rows;
}

// Adds a "-" separator to a field-number input so the person can keep
// typing the next number without reaching for the dash key themselves —
// the field is already free text ("69-70-71" works fine on its own), this
// is purely a convenience nudge for combining several physical fields into
// one planner row.
window.appendFieldNumber = function (btn) {
    const input = btn.previousElementSibling;
    if (!input || !input.classList || !input.classList.contains('field-number')) return;
    const trimmed = input.value.trim();
    if (trimmed && !trimmed.endsWith('-')) input.value = trimmed + '-';
    input.focus();
};

window.updateBuildingCapacity = function (input) {
    const buildingId = input.dataset.building;
    const fillType = input.dataset.filltype;
    const farm = getAllFarms().find(f => f.id === currentFarmId);
    if (!farm || !buildingId || !fillType) return;

    if (!farm.animalBuildingCapacities) farm.animalBuildingCapacities = {};
    if (!farm.animalBuildingCapacities[buildingId]) farm.animalBuildingCapacities[buildingId] = {};

    const value = parseFloat(input.value.replace(',', '.'));
    if (!isNaN(value) && value > 0) {
        farm.animalBuildingCapacities[buildingId][fillType] = value;
    } else {
        delete farm.animalBuildingCapacities[buildingId][fillType];
    }

    saveFarmData(farm);
    openHubPanel('animals');
};

// --- Animals panel: barn tiles, one-barn detail and custom barn names ---
// Barn opened from the tile grid (building id), null = the overview. Kept
// across re-renders (capacity/ration edits), reset when the sidebar opens
// the Animals view.
let animalSelectedBuilding = null;

// Custom name the player gave a barn (saved per farm, keyed like the
// capacities), falling back to the cleaned-up file name from the save.
function buildingDisplayName(farm, building) {
    const custom = farm && farm.animalBuildingNames && farm.animalBuildingNames[building.id];
    return custom || formatBuildingName(building.name);
}

function barnNameHtml(farm, building, cls) {
    return `<span class="barn-name-wrap">
        <span class="${cls} barn-name">${escapeHtml(buildingDisplayName(farm, building))}</span>
        <button type="button" class="barn-rename-btn" data-building="${escapeHtml(String(building.id))}" title="${t('barnRename')}" aria-label="${t('barnRename')}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
    </span>`;
}

// --- Breed pictures (see animal-images.js) ---
// Pictures are looked up in the mods folder next to the farm's savegame and
// cached as PNGs; anything missing (base-game breeds, no save path) falls
// back to a species icon. Loading runs just after a render and re-renders
// the Animals view once when new pictures are ready.
const ANIMAL_PICTURE_DIR = path.join(appDataDir, 'animal-pictures');
const animalPictures = { modsDir: null, index: null, timer: null, failed: new Set() };

function animalPictureUrl(subType, age) {
    const farm = getCurrentFarm();
    const modsDir = animalImages.findModsDir(farm && farm.saveGamePath);
    if (!modsDir) return null;
    if (animalPictures.modsDir !== modsDir) { animalPictures.modsDir = modsDir; animalPictures.index = null; }
    if (!animalPictures.index) { queueAnimalPictures(); return null; }
    const visual = animalImages.pickVisual(animalPictures.index, subType, age);
    if (!visual) return null;
    const file = animalImages.cacheFileFor(ANIMAL_PICTURE_DIR, visual);
    if (fs.existsSync(file)) return pathToFileURL(file).href;
    if (!animalPictures.failed.has(file)) queueAnimalPictures();
    return null;
}

function queueAnimalPictures() {
    if (animalPictures.timer) return;
    animalPictures.timer = setTimeout(() => {
        animalPictures.timer = null;
        const farm = getCurrentFarm();
        if (!farm || !animalPictures.modsDir) return;
        let changed = false;
        if (!animalPictures.index) {
            try { animalPictures.index = animalImages.loadIndex(animalPictures.modsDir, ANIMAL_PICTURE_DIR); }
            catch (e) { console.warn('Could not index animal pictures', e); animalPictures.index = {}; }
            changed = true;
        }
        (farm.animalBuildings || []).forEach(b => (b.clusters || []).forEach(c => {
            const visual = animalImages.pickVisual(animalPictures.index, c.subType, c.age);
            if (!visual) return;
            const file = animalImages.cacheFileFor(ANIMAL_PICTURE_DIR, visual);
            if (fs.existsSync(file) || animalPictures.failed.has(file)) return;
            try {
                if (animalImages.ensurePicture(ANIMAL_PICTURE_DIR, visual)) changed = true;
                else animalPictures.failed.add(file);
            } catch (e) {
                console.warn('Could not decode animal picture', visual.image, e);
                animalPictures.failed.add(file);
            }
        }));
        if (changed && currentPlannerView === 'animals') rerenderAnimalsKeepScroll();
    }, 30);
}

function animalPictureHtml(cluster, cls) {
    const type = cluster ? animalTypeOf(cluster.subType) : null;
    const url = cluster ? animalPictureUrl(cluster.subType, cluster.age) : null;
    if (url) return `<span class="animal-pic ${cls}"><img src="${escapeHtml(url)}" alt="" draggable="false"></span>`;
    return `<span class="animal-pic animal-pic--icon ${cls}" aria-hidden="true"><i class="fa-solid ${FEED_ANIMAL_ICONS[type] || 'fa-paw'}" aria-hidden="true"></i></span>`;
}

// --- Reproduction ---
// Settings (min. age, pregnancy length, min. health) come from an imported
// animals.xml or, failing that, the animal definitions found in the mods.
function getReproductionDef(subType) {
    const key = String(subType || '').toUpperCase();
    const own = ANIMAL_NEEDS_DATA[key] && ANIMAL_NEEDS_DATA[key].reproduction;
    if (own) return own;
    const fromMods = animalPictures.index && animalPictures.index.reproduction && animalPictures.index.reproduction[key];
    return fromMods || null;
}

// What a group of animals is doing reproduction-wise, from the savegame
// state + the breed's settings. The game raises `reproduction` by
// 100 / durationMonth each month and gives birth at 100 %.
function reproductionStatus(c) {
    const def = getReproductionDef(c.subType);
    const isMale = def ? def.supported === false : /^(BULL|ROOSTER|BOAR|RAM|BUCK|STALLION)_/i.test(c.subType);
    if (isMale) return { kind: 'male' };
    if (c.reproduction === undefined && !def) return null;   // old save data, nothing known
    const progress = c.reproduction || 0;
    if (progress > 0) {
        const monthsLeft = def && def.durationMonth ? Math.max(0, Math.ceil(def.durationMonth * (1 - progress / 100))) : null;
        return { kind: 'pregnant', progress, monthsLeft };
    }
    if (def && def.minAgeMonth && c.age < def.minAgeMonth) return { kind: 'young', months: def.minAgeMonth - c.age, minAge: def.minAgeMonth };
    if (def && def.minHealthFactor && c.health < def.minHealthFactor * 100) return { kind: 'lowHealth', minHealth: Math.round(def.minHealthFactor * 100) };
    if (c.isInseminated === false) return { kind: 'waiting' };
    return { kind: 'ready' };
}

function reproDueText(monthsLeft) {
    if (monthsLeft === null || monthsLeft === undefined) return '';
    return monthsLeft <= 0 ? t('reproDueNow') : t('reproDue').replace('{m}', monthsLeft);
}

function reproStatusHtml(c, st) {
    if (!st) return '';
    const icons = { pregnant: 'fa-baby-carriage', young: 'fa-hourglass-half', lowHealth: 'fa-heart-crack', waiting: 'fa-circle-pause', ready: 'fa-circle-check', male: 'fa-mars' };
    let label;
    if (st.kind === 'pregnant') label = `${t('reproProgress')} ${Math.round(st.progress)}%${st.monthsLeft !== null ? ' · ' + reproDueText(st.monthsLeft) : ''}`;
    else if (st.kind === 'young') label = t('reproYoung').replace('{m}', st.minAge);
    else if (st.kind === 'lowHealth') label = t('reproLowHealth').replace('{h}', st.minHealth);
    else label = t('repro_' + st.kind);
    let html = `<div class="herd-repro herd-repro--${st.kind}"><i class="fa-solid ${icons[st.kind]}" aria-hidden="true"></i><span>${label}</span></div>`;
    if (st.kind === 'pregnant') html += `<div class="herd-repro-bar"><div class="pen-bar-track"><div class="pen-bar-fill repro-bar-fill" style="width:${Math.max(3, Math.min(100, st.progress))}%"></div></div></div>`;
    if (c.hadABirth && c.monthsSinceLastBirth !== undefined) html += `<div class="herd-repro-last">${t('reproLastBirth').replace('{m}', c.monthsSinceLastBirth)}</div>`;
    return html;
}

// Barn-level summary: how many females are pregnant and when the next birth is.
function barnReproSummary(building) {
    let pregnant = 0, females = 0, ready = 0, waiting = 0, young = 0, nextBirth = null, known = false;
    (building.clusters || []).forEach(c => {
        const st = reproductionStatus(c);
        if (!st || st.kind === 'male') return;
        known = true;
        females += c.numAnimals;
        if (st.kind === 'pregnant') {
            pregnant += c.numAnimals;
            if (st.monthsLeft !== null && (nextBirth === null || st.monthsLeft < nextBirth)) nextBirth = st.monthsLeft;
        } else if (st.kind === 'ready') ready += c.numAnimals;
        else if (st.kind === 'waiting') waiting += c.numAnimals;
        else if (st.kind === 'young') young += c.numAnimals;
    });
    return known ? { pregnant, females, ready, waiting, young, nextBirth } : null;
}

// Icons (and colour tone) for the fill types shown in the barn detail.
function fillIcon(fillType) {
    const ft = String(fillType || '').toUpperCase();
    if (ft === 'FOOD') return 'fa-bowl-food';
    if (ft === 'WATER') return 'fa-droplet';
    if (ft === 'STRAW') return 'fa-wheat-awn';
    if (ft === 'LIQUIDMANURE' || ft === 'DIGESTATE') return 'fa-water';
    if (ft === 'MANURE') return 'fa-poop';
    if (ft.includes('MILK')) return 'fa-bottle-droplet';
    if (ft.includes('EGG')) return 'fa-egg';
    if (ft.includes('WOOL')) return 'fa-socks';
    if (ft.includes('HONEY')) return 'fa-jar';
    return 'fa-box';
}

function fillIconTone(fillType) {
    const ft = String(fillType || '').toUpperCase();
    if (ft === 'WATER') return 'water';
    if (ft === 'STRAW' || ft === 'FOOD') return 'feed';
    if (ft === 'MANURE' || ft === 'LIQUIDMANURE' || ft === 'DIGESTATE') return 'manure';
    return 'product';
}

function rerenderAnimalsKeepScroll() {
    const scroll = hubView ? hubView.scrollTop : 0;
    openHubPanel('animals');
    if (hubView) hubView.scrollTop = scroll;
}

function openAnimalBuilding(id) {
    animalSelectedBuilding = id;
    openHubPanel('animals');
    if (hubView) hubView.scrollTop = 0;
}

function startBarnRename(btn) {
    const wrap = btn.closest('.barn-name-wrap');
    const nameEl = wrap && wrap.querySelector('.barn-name');
    if (!wrap || !nameEl) return;
    const buildingId = btn.dataset.building;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'barn-name-input';
    input.value = nameEl.textContent;
    input.setAttribute('aria-label', t('barnRename'));
    wrap.replaceChildren(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
        if (done) return;
        done = true;
        const farm = getAllFarms().find(f => f.id === currentFarmId);
        const building = farm && (farm.animalBuildings || []).find(b => String(b.id) === buildingId);
        if (save && farm && building) {
            const value = input.value.trim();
            if (!farm.animalBuildingNames) farm.animalBuildingNames = {};
            // Empty (or the default name) restores the name from the save.
            if (value && value !== formatBuildingName(building.name)) farm.animalBuildingNames[building.id] = value;
            else delete farm.animalBuildingNames[building.id];
            saveFarmData(farm);
        }
        rerenderAnimalsKeepScroll();
    };
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
}

function wireBarnPanel(bodyEl) {
    bodyEl.querySelectorAll('.barn-rename-btn').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        startBarnRename(btn);
    }));
    bodyEl.querySelectorAll('.barn-tile').forEach(tile => {
        const buildingId = tile.dataset.building;
        const building = ((getCurrentFarm() || {}).animalBuildings || []).find(b => String(b.id) === buildingId);
        if (!building) return;
        tile.addEventListener('click', () => openAnimalBuilding(building.id));
        tile.addEventListener('keydown', e => {
            if (e.target !== tile || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            openAnimalBuilding(building.id);
        });
    });
    const back = bodyEl.querySelector('.barn-back-btn');
    if (back) back.addEventListener('click', () => {
        animalSelectedBuilding = null;
        openHubPanel('animals');
        if (hubView) hubView.scrollTop = 0;
    });
}

// Finance: Bank And Credit (FS25_BankCredit) contracts behind the loan total.
function bankCreditLine(farm) {
    const bc = farm && farm.bankCredit;
    if (!bc) return '';
    const value = bc.count
        ? t('bankCreditValue').replace('{n}', bc.count).replace('{m}', bc.monthly.toLocaleString())
        : t('bankCreditNone');
    return `<p class="details-category"><span>${t('bankCreditLabel')}</span><span class="details-category-value">${value}</span></p>`;
}

function getDetailValue(id) {
    const el = document.getElementById(id);
    return el ? el.textContent : '-';
}

window.openHubPanel = function (type) {
    const titleEl = document.getElementById('hub-panel-title');
    const bodyEl = document.getElementById('hub-panel-body');
    // The scrolling view container — panels use it to keep scroll position on re-render.
    const modalEl = hubView;
    if (!titleEl || !bodyEl) return;

    if (type === 'finance') {
        const farm = getAllFarms().find(f => f.id === currentFarmId);
        const history = getSeasonBalanceHistory(farm);
        const monthly = getMonthlyHistory(farm);
        const hasLoanData = history.some(h => h.loan > 0) || monthly.some(r => r.loan > 0);

        const monthLabelFn = (r) => (r.period % 12 === 0 ? `${monthlyRowLabel(r)} '${r.gameYear}` : monthlyRowLabel(r));
        const monthBalanceTitle = (r) => `${translateMonth(r.month)} · Y${r.gameYear}: ${Math.round(r.balance).toLocaleString()} €`;
        const monthLoanTitle = (r) => `${translateMonth(r.month)} · Y${r.gameYear} — ${t('detailCredit')}: ${Math.round(r.loan).toLocaleString()} €`;

        const monthlyChartHtml = monthly.length > 1 ? `
            <div class="balance-chart-wrapper">
                <div class="chart-caption">${t('hubMonthlyTrend')}</div>
                <div class="chart-legend">
                    <span class="chart-legend-item"><span class="chart-legend-swatch chart-legend-swatch--balance"></span>${t('detailBalance')}</span>
                    ${hasLoanData ? `<span class="chart-legend-item"><span class="chart-legend-swatch chart-legend-swatch--loan"></span>${t('detailCredit')}</span>` : ''}
                </div>
                ${buildBalanceChartSvg(monthly, {
                    labelFn: monthLabelFn, titleBalanceFn: monthBalanceTitle,
                    titleLoanFn: monthLoanTitle, maxLabels: 9
                })}
            </div>` : '';

        const seasonChartHtml = history.length > 1 ? `
            <div class="balance-chart-wrapper">
                ${monthly.length > 1 ? `<div class="chart-caption">${t('hubSeasonTrend')}</div>` : ''}
                <div class="chart-legend">
                    <span class="chart-legend-item"><span class="chart-legend-swatch chart-legend-swatch--balance"></span>${t('detailBalance')}</span>
                    ${hasLoanData ? `<span class="chart-legend-item"><span class="chart-legend-swatch chart-legend-swatch--loan"></span>${t('detailCredit')}</span>` : ''}
                </div>
                ${buildBalanceChartSvg(history)}
            </div>` : '';

        titleEl.textContent = t('hubFinance');
        bodyEl.innerHTML = `
            <p class="details-category"><span>${t('detailBalance')}</span><span class="details-category-value">${getDetailValue('details-balance')}</span></p>
            <p class="details-category"><span>${t('detailCredit')}</span><span class="details-category-value">${getDetailValue('detail-loan')}</span></p>
            ${bankCreditLine(getCurrentFarm())}
            <p class="details-category"><span>${t('detailFarmAge')}</span><span class="details-category-value">${getDetailValue('detail-age')}</span></p>
            ${(monthlyChartHtml || seasonChartHtml)
                ? monthlyChartHtml + seasonChartHtml
                : `<p class="hub-panel-note">${t('hubChartNeedsMoreMonths')}</p>`}
        `;
    } else if (type === 'animals') {
        const farm = getAllFarms().find(f => f.id === currentFarmId);
        const buildings = (farm && farm.animalBuildings) || [];
        const capacities = (farm && farm.animalBuildingCapacities) || {};

        titleEl.textContent = t('hubAnimals');

        // Shared by both branches below (a farm can have herd history from
        // past seasons even if every animal has since been sold, so this
        // isn't gated on buildings.length).
        const animalHistory = getAnimalHistoryTrend(farm);
        const monthlyAnim = getMonthlyHistory(farm);
        const monthLabelFn = (r) => (r.period % 12 === 0 ? `${monthlyRowLabel(r)} '${r.gameYear}` : monthlyRowLabel(r));

        const historySectionHtml = (() => {
            let sectionHtml = '';

            // --- Monthly trends (preferred) ---
            const hasHerd = monthlyAnim.some(r => (r.animals || 0) > 0);
            const hasProd = monthlyAnim.some(r => (r.productionDeltaTotal || 0) > 0);
            if (monthlyAnim.length > 1 && hasHerd) {
                const mCount = buildSingleLineChartSvg(monthlyAnim, 'animals', {
                    lineClass: 'chart-line--animals', dotClass: 'chart-dot--animals', maxLabels: 9,
                    labelFn: monthLabelFn,
                    titleFn: (r) => `${translateMonth(r.month)} · Y${r.gameYear}: ${Math.round(r.animals).toLocaleString()}`
                });
                const mHealth = buildSingleLineChartSvg(monthlyAnim, 'avgHealth', {
                    lineClass: 'chart-line--health', dotClass: 'chart-dot--health', fixedMin: 0, fixedMax: 100, unit: '%', maxLabels: 9,
                    labelFn: monthLabelFn,
                    titleFn: (r) => `${translateMonth(r.month)} · Y${r.gameYear}: ${Math.round(r.avgHealth)}%`
                });
                const mProd = hasProd ? buildSingleLineChartSvg(monthlyAnim, 'productionDeltaTotal', {
                    lineClass: 'chart-line--balance', dotClass: 'chart-dot--balance', unit: ' L', maxLabels: 9,
                    labelFn: monthLabelFn,
                    titleFn: (r) => `${translateMonth(r.month)} · Y${r.gameYear}: ${Math.round(r.productionDeltaTotal).toLocaleString()} L`
                }) : '';

                if (mCount) sectionHtml += `<div class="balance-chart-wrapper"><div class="chart-caption">${t('hubMonthlyTrend')}</div><div class="chart-legend"><span class="chart-legend-item"><span class="chart-legend-swatch chart-legend-swatch--animals"></span>${t('detailAnimals')}</span></div>${mCount}</div>`;
                if (mHealth) sectionHtml += `<div class="balance-chart-wrapper"><div class="chart-legend"><span class="chart-legend-item"><span class="chart-legend-swatch chart-legend-swatch--health"></span>${t('avgHealthLabel')}</span></div>${mHealth}</div>`;
                if (mProd) sectionHtml += `<div class="balance-chart-wrapper"><div class="chart-legend"><span class="chart-legend-item"><span class="chart-legend-swatch chart-legend-swatch--balance"></span>${t('hubMilkProduced')}</span></div>${mProd}<p class="hub-panel-note">${t('hubProductionProxyNote')}</p></div>`;
            }

            // --- Per-season trends (fallback / long-term overview) ---
            const countChart = buildSingleLineChartSvg(animalHistory, 'animals', {
                lineClass: 'chart-line--animals', dotClass: 'chart-dot--animals'
            });
            const healthChart = buildSingleLineChartSvg(animalHistory, 'avgHealth', {
                lineClass: 'chart-line--health', dotClass: 'chart-dot--health', fixedMin: 0, fixedMax: 100, unit: '%'
            });
            if (countChart) {
                sectionHtml += `<div class="balance-chart-wrapper">${sectionHtml ? `<div class="chart-caption">${t('hubSeasonTrend')}</div>` : ''}<div class="chart-legend"><span class="chart-legend-item"><span class="chart-legend-swatch chart-legend-swatch--animals"></span>${t('detailAnimals')}</span></div>${countChart}</div>`;
            }
            if (healthChart) {
                sectionHtml += `<div class="balance-chart-wrapper"><div class="chart-legend"><span class="chart-legend-item"><span class="chart-legend-swatch chart-legend-swatch--health"></span>${t('avgHealthLabel')}</span></div>${healthChart}</div>`;
            }

            return sectionHtml || `<p class="hub-panel-note">${t('hubChartNeedsMoreMonths')}</p>`;
        })();

        if (buildings.length === 0) {
            bodyEl.innerHTML = `
                <p class="details-category"><span>${t('detailAnimals')}</span><span class="details-category-value">${getDetailValue('detail-animals')}</span></p>
                <p class="hub-panel-note">${t('hubNoAnimalsYet')}</p>
                ${historySectionHtml}
            `;
        } else {
            // Fallback reference for buildings without a manually-entered
            // capacity: scaled against the fullest total feed load among
            // your buildings instead of a true percentage (the save file
            // never records real storage capacity).
            let maxCombinedFood = 0;
            buildings.forEach(b => {
                const total = b.food.reduce((s, f) => s + f.level, 0);
                maxCombinedFood = Math.max(maxCombinedFood, total);
            });

            const hasAnyNeedsData = Object.keys(ANIMAL_NEEDS_DATA).length > 0;
            let anyMissingCapacity = false;

            // Ration chosen per species (shared with the Feed planner) and the
            // farm-wide daily need per feed category it implies — stock in
            // silos/bales is shared by every building, so "how long it lasts"
            // is stock / what the whole farm eats of it.
            const feedPlan = getFeedPlan(farm);
            const feedStockCat = feedStockByCategory(farm && farm.feedStock);
            const farmDailyByCat = {};
            buildings.forEach(b => b.clusters.forEach(c => {
                const type = animalTypeOf(c.subType);
                if (!type || !ANIMAL_NEEDS_DATA[c.subType]) return;
                const ration = resolveRation(type, feedPlan);
                if (ration) splitByRecipe(getDailyAnimalNeed(c.subType, c.age, 'food') * c.numAnimals, ration, farmDailyByCat);
                farmDailyByCat.STRAW = (farmDailyByCat.STRAW || 0) + getDailyAnimalNeed(c.subType, c.age, 'straw') * c.numAnimals;
            }));
            let anyProductionFound = false;

            // One full card per barn (shown when a tile is opened) plus a
            // short summary for its tile in the overview grid.
            const cards = {};
            const summaries = {};

            buildings.forEach(building => {
                const buildingCaps = capacities[building.id] || {};
                let card = '';

                // Daily requirement, summed across every cluster in this
                // building, using each animal's own age to interpolate the
                // right point on its breed's curve (from an imported
                // animals.xml — see Settings).
                const dailyNeed = { food: 0, water: 0, straw: 0 };
                let needsKnownForAll = hasAnyNeedsData;
                // Estimated daily output (milk/eggs/wool/...), summed the
                // same way — only populated for breeds whose imported
                // animals.xml happened to include recognizable production
                // curves (see parseAnimalNeedsXml); empty otherwise.
                const dailyOutput = {};
                const foodByType = {};   // daily food per species in this building
                building.clusters.forEach(c => {
                    if (!ANIMAL_NEEDS_DATA[c.subType]) { needsKnownForAll = false; return; }
                    const animalType = animalTypeOf(c.subType);
                    const ration = animalType ? resolveRation(animalType, feedPlan) : null;
                    // The ration's productionWeight scales milk/eggs/wool the way
                    // the game does; manure/slurry don't depend on the feed.
                    const outputFactor = ration ? ration.efficiency / 100 : 1;
                    if (animalType) foodByType[animalType] = (foodByType[animalType] || 0) + getDailyAnimalNeed(c.subType, c.age, 'food') * c.numAnimals;
                    dailyNeed.food += getDailyAnimalNeed(c.subType, c.age, 'food') * c.numAnimals;
                    dailyNeed.water += getDailyAnimalNeed(c.subType, c.age, 'water') * c.numAnimals;
                    dailyNeed.straw += getDailyAnimalNeed(c.subType, c.age, 'straw') * c.numAnimals;

                    const def = ANIMAL_NEEDS_DATA[c.subType];
                    if (def && def.production) {
                        Object.keys(def.production).forEach(fillType => {
                            const rate = getDailyAnimalProduction(c.subType, c.age, fillType);
                            const factor = FEED_UNSCALED_OUTPUT.includes(fillType) ? 1 : outputFactor;
                            if (rate > 0) dailyOutput[fillType] = (dailyOutput[fillType] || 0) + rate * c.numAnimals * factor;
                        });
                    }
                });
                if (Object.keys(dailyOutput).length > 0) anyProductionFound = true;

                const combinedFoodLevel = building.food.reduce((s, f) => s + f.level, 0);
                const combinedCap = buildingCaps[ANIMAL_FEED_CAPACITY_KEY];
                const lowFeed = building.food.length > 0 && (combinedCap
                    ? (combinedFoodLevel / combinedCap) * 100 < 15
                    : combinedFoodLevel < 80);
                const noFeedAtAll = building.food.length === 0;

                const warn = lowFeed || noFeedAtAll;
                const heads = building.clusters.reduce((s, c) => s + c.numAnimals, 0);
                const avgHealth = heads ? building.clusters.reduce((s, c) => s + (c.health || 0) * c.numAnimals, 0) / heads : 0;
                const num = n => Math.round(n).toLocaleString();
                const statRow = (fillType, label, value) => `
                    <div class="barn-stat">
                        <span class="barn-stat-icon barn-stat-icon--${fillIconTone(fillType)}" aria-hidden="true"><i class="fa-solid ${fillIcon(fillType)}" aria-hidden="true"></i></span>
                        <span class="barn-stat-label">${label}</span>
                        <span class="barn-stat-value">${value}</span>
                    </div>`;

                card += `<div class="pen-card barn-detail ${warn ? 'barn-detail--warning' : ''}">`;

                // --- Hero: picture of the main breed, name, head count, health ---
                const mainCluster = building.clusters.slice().sort((a, b) => b.numAnimals - a.numAnimals)[0];
                card += `<header class="barn-hero">
                    ${animalPictureHtml(mainCluster, 'barn-hero-pic')}
                    <div class="barn-hero-text">
                        <div class="barn-hero-name">${barnNameHtml(farm, building, 'barn-hero-title')}</div>
                        <div class="barn-hero-meta">
                            <span><strong>${num(heads)}</strong> ${t('barnHeads')}</span>
                            <span>${t('hubHealth')}: <strong>${Math.round(avgHealth)}%</strong></span>
                        </div>
                    </div>
                    ${warn ? `<span class="pen-warning-badge barn-hero-badge"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${t('hubFeedLow')}</span>` : ''}
                </header>`;

                // --- Herd: one card per group (breed + age), with its picture ---
                card += `<section class="barn-section">
                    <h4 class="barn-section-title">${t('barnHerd')}</h4>
                    <div class="herd-grid">`;
                building.clusters.slice().sort((a, b) => b.age - a.age).forEach(c => {
                    const h = Math.round(c.health || 0);
                    const hClass = h < 50 ? 'pen-bar-fill--low' : (h < 80 ? 'pen-bar-fill--mid' : 'pen-bar-fill--ok');
                    card += `<div class="herd-card">
                        ${animalPictureHtml(c, 'herd-pic')}
                        <div class="herd-info">
                            <div class="herd-name">${escapeHtml(formatAnimalName(c.subType))}</div>
                            <div class="herd-count">× ${num(c.numAnimals)}</div>
                            <div class="herd-age">${t('barnAge').replace('{m}', c.age)}</div>
                            <div class="herd-health" title="${t('hubHealth')}: ${h}%">
                                <div class="pen-bar-track"><div class="pen-bar-fill ${hClass}" style="width:${Math.max(2, h)}%"></div></div>
                                <span>${h}%</span>
                            </div>
                            ${reproStatusHtml(c, reproductionStatus(c))}
                        </div>
                    </div>`;
                });
                card += `</div></section>`;

                card += `<div class="barn-columns">`;

                // --- Feed trough: level, capacity, days left, ration ---
                card += `<section class="barn-panel barn-panel--feed">
                    <h4 class="barn-section-title">${t('hubFeedLevel')}</h4>`;
                if (building.food.length > 0) {
                    // Multiple feed ingredients (e.g. grass windrow + forage)
                    // share one trough, so they're combined into one gauge.
                    const feedTypesLabel = building.food.map(f => formatFillType(f.fillType)).join(' + ');
                    let pct;
                    if (combinedCap && combinedCap > 0) {
                        pct = Math.max(2, Math.min(100, (combinedFoodLevel / combinedCap) * 100));
                    } else {
                        anyMissingCapacity = true;
                        const ref = maxCombinedFood || combinedFoodLevel || 1;
                        pct = Math.max(3, Math.min(100, (combinedFoodLevel / ref) * 100));
                    }
                    const barClass = (combinedCap ? pct < 15 : combinedFoodLevel < 80) ? 'pen-bar-fill--low' : (pct < 35 ? 'pen-bar-fill--mid' : 'pen-bar-fill--ok');
                    const daysLeft = needsKnownForAll && dailyNeed.food > 0 ? combinedFoodLevel / dailyNeed.food : null;
                    const daysClass = daysLeft === null ? '' : (daysLeft < 3 ? 'feed-days--critical' : (daysLeft < 7 ? 'feed-days--warning' : 'feed-days--ok'));

                    card += `<div class="feed-headline">
                            <div class="feed-amount">
                                <span class="feed-amount-value">${num(combinedFoodLevel)} L</span>
                                <span class="feed-amount-types">${escapeHtml(feedTypesLabel)}</span>
                            </div>
                            ${daysLeft !== null ? `<div class="feed-days ${daysClass}"><span class="feed-days-value">${Math.max(0, Math.floor(daysLeft))}</span><span class="feed-days-label">${t('barnDaysLeft')}</span></div>` : ''}
                        </div>
                        <div class="feed-gauge">
                            <div class="pen-bar-track"><div class="pen-bar-fill ${barClass}" style="width:${pct}%"></div></div>
                            ${combinedCap ? `<span class="feed-gauge-pct">${Math.round((combinedFoodLevel / combinedCap) * 100)}%</span>` : ''}
                        </div>
                        <label class="feed-capacity">
                            <span>${t('barnTroughCapacity')}</span>
                            <input type="text" class="feed-capacity-input" value="${combinedCap || ''}" placeholder="?"
                                data-building="${building.id}" data-filltype="${ANIMAL_FEED_CAPACITY_KEY}"
                                onchange="updateBuildingCapacity(this)">
                            <span>L</span>
                        </label>`;
                } else {
                    card += `<p class="barn-empty">${t('hubNoFeedTracked')}</p>`;
                }

                // Chosen ration per species in this building: picker + the
                // daily need split into its ingredients, with how long the
                // farm's stock of each ingredient lasts.
                Object.keys(foodByType).forEach(animalType => {
                    const ration = resolveRation(animalType, feedPlan);
                    if (!ration) return;
                    const parts = {};
                    splitByRecipe(foodByType[animalType], ration, parts);
                    card += `<div class="barn-subtitle">${t('hubRation')}${Object.keys(foodByType).length > 1 ? ' · ' + t('feedAnimal_' + animalType) : ''}</div>
                        <select class="pen-ration-select barn-ration-select" data-type="${animalType}">${feedRationOptionsHtml(animalType, feedPlan, ration.id)}</select>
                        <div class="ration-list">`;
                    Object.keys(parts).filter(cat => parts[cat] > 0).forEach(cat => {
                        const stockL = feedStockCat[cat] || 0;
                        const days = farmDailyByCat[cat] > 0 ? stockL / farmDailyByCat[cat] : 0;
                        const cls = days < 3 ? 'feed-days--critical' : (days < 7 ? 'feed-days--warning' : 'feed-days--ok');
                        const stockNote = farm.feedStock
                            ? `<span class="ration-stock ${cls}">${stockL > 0 ? t('hubRationStockDays').replace('{d}', Math.floor(days).toLocaleString()) : t('hubRationNoStock')}</span>`
                            : '';
                        card += `<div class="ration-item">
                            <span class="ration-name">${feedCategoryLabel(cat)}</span>
                            <span class="ration-rate">${num(parts[cat])} L${t('perDayShort')}</span>
                            ${stockNote}
                        </div>`;
                    });
                    card += `</div>`;
                });
                card += `</section>`;

                // --- Daily need ---
                card += `<section class="barn-panel barn-panel--need">
                    <h4 class="barn-section-title">${t('hubDailyNeed')}</h4>`;
                if (needsKnownForAll && (dailyNeed.food > 0 || dailyNeed.water > 0 || dailyNeed.straw > 0)) {
                    card += `<div class="barn-stat-list">`;
                    if (dailyNeed.food > 0) card += statRow('FOOD', formatFillType('FOOD'), `${num(dailyNeed.food)} L${t('perDayShort')}`);
                    if (dailyNeed.water > 0) card += statRow('WATER', formatFillType('WATER'), `${num(dailyNeed.water)} L${t('perDayShort')}`);
                    if (dailyNeed.straw > 0) card += statRow('STRAW', formatFillType('STRAW'), `${num(dailyNeed.straw)} L${t('perDayShort')}`);
                    card += `</div>`;
                } else {
                    card += `<p class="barn-empty">${t('barnNeedsUnknown')}</p>`;
                }
                card += `</section>`;

                // --- Reproduction: pregnant / ready / too young, next birth ---
                const repro = barnReproSummary(building);
                if (repro) {
                    const reproRow = (icon, tone, label, value) => `
                        <div class="barn-stat">
                            <span class="barn-stat-icon barn-stat-icon--${tone}" aria-hidden="true"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
                            <span class="barn-stat-label">${label}</span>
                            <span class="barn-stat-value">${value}</span>
                        </div>`;
                    card += `<section class="barn-panel barn-panel--repro">
                        <h4 class="barn-section-title">${t('barnReproduction')}</h4>`;
                    if (repro.pregnant > 0) {
                        card += `<div class="repro-headline">
                            <div class="feed-amount">
                                <span class="feed-amount-value">${num(repro.pregnant)} / ${num(repro.females)}</span>
                                <span class="feed-amount-types">${t('reproPregnantOf')}</span>
                            </div>
                            ${repro.nextBirth !== null ? `<div class="feed-days repro-due"><span class="feed-days-value">${repro.nextBirth <= 0 ? '0' : '~' + repro.nextBirth}</span><span class="feed-days-label">${t('reproMonthsToBirth')}</span></div>` : ''}
                        </div>`;
                    }
                    card += `<div class="barn-stat-list">`;
                    card += reproRow('fa-baby-carriage', 'repro', t('reproPregnant'), num(repro.pregnant));
                    if (repro.ready) card += reproRow('fa-circle-check', 'product', t('repro_ready'), num(repro.ready));
                    if (repro.waiting) card += reproRow('fa-circle-pause', 'feed', t('repro_waiting'), num(repro.waiting));
                    if (repro.young) card += reproRow('fa-hourglass-half', 'water', t('reproTooYoung'), num(repro.young));
                    card += `</div>`;
                    if (repro.waiting) card += `<p class="barn-empty">${t('reproWaitingHint')}</p>`;
                    card += `</section>`;
                }

                // --- Estimated daily output ---
                if (Object.keys(dailyOutput).length > 0) {
                    card += `<section class="barn-panel barn-panel--output">
                        <h4 class="barn-section-title">${t('hubEstDailyOutput')}</h4>
                        <div class="barn-stat-list">`;
                    Object.keys(dailyOutput).forEach(fillType => {
                        card += statRow(fillType, formatFillType(fillType), `${num(dailyOutput[fillType])} L${t('perDayShort')}`);
                    });
                    card += `</div></section>`;
                }

                // --- Stored in the building right now ---
                if (building.production.length > 0) {
                    card += `<section class="barn-panel barn-panel--stored">
                        <h4 class="barn-section-title">${t('hubStoredProduction')}</h4>
                        <div class="barn-stat-list">`;
                    building.production.forEach(p => {
                        card += statRow(p.fillType, formatFillType(p.fillType), `${num(p.level)} L`);
                    });
                    card += `</div></section>`;
                }

                card += `</div>`; // .barn-columns
                card += `</div>`; // .pen-card
                cards[building.id] = card;
                summaries[building.id] = { lowFeed, noFeedAtAll, combinedFoodLevel, combinedCap,
                    dailyFood: needsKnownForAll ? dailyNeed.food : 0, maxCombinedFood };
            });

            if (!buildings.some(b => b.id === animalSelectedBuilding)) animalSelectedBuilding = null;
            const selected = buildings.find(b => b.id === animalSelectedBuilding);
            let html = '';

            if (selected) {
                // --- One barn, full detail ---
                html += `<div class="barn-detail-bar">
                    <button type="button" class="barn-back-btn"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> ${t('barnAllBuildings')}</button>
                </div>`;
                html += cards[selected.id];

                // How the numbers are worked out — folded away so the card stays readable.
                const notes = [];
                if (anyMissingCapacity) notes.push(t('hubApproxLevelsNote'));
                if (hasAnyNeedsData) notes.push(t(anyProductionFound ? 'hubProductionEstNote' : 'hubNoProductionCurves'));
                notes.push(t('hubRationNote'));
                html += `<details class="barn-notes">
                    <summary><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ${t('barnHowCalculated')}</summary>
                    <ul>${notes.map(n => `<li>${n}</li>`).join('')}</ul>
                </details>`;
            } else {
                // --- Overview: one clickable tile per barn ---
                html += `<p class="details-category"><span>${t('detailAnimals')}</span><span class="details-category-value">${getDetailValue('detail-animals')}</span></p>`;
                html += `<div class="barn-tile-grid">`;
                buildings.forEach(building => {
                    const sum = summaries[building.id];
                    const warn = sum.lowFeed || sum.noFeedAtAll;

                    // Head count per species, with the same icons as the Feed planner.
                    const heads = {};
                    let healthSum = 0, headTotal = 0;
                    building.clusters.forEach(c => {
                        const type = animalTypeOf(c.subType) || '';
                        heads[type] = (heads[type] || 0) + c.numAnimals;
                        healthSum += (c.health || 0) * c.numAnimals;
                        headTotal += c.numAnimals;
                    });
                    const speciesHtml = Object.keys(heads).map(type =>
                        `<span class="barn-tile-species"><i class="fa-solid ${FEED_ANIMAL_ICONS[type] || 'fa-paw'}" aria-hidden="true"></i> ${type ? t('feedAnimal_' + type) : t('hubAnimals')} × ${heads[type].toLocaleString()}</span>`).join('');

                    let feedHtml;
                    if (sum.noFeedAtAll) {
                        feedHtml = `<span class="barn-tile-feed-note">${t('hubNoFeedTracked')}</span>`;
                    } else {
                        const ref = sum.combinedCap || sum.maxCombinedFood || sum.combinedFoodLevel || 1;
                        const pct = Math.max(3, Math.min(100, (sum.combinedFoodLevel / ref) * 100));
                        const barClass = sum.lowFeed ? 'pen-bar-fill--low' : (pct < 35 ? 'pen-bar-fill--mid' : 'pen-bar-fill--ok');
                        const days = sum.dailyFood > 0 ? Math.max(0, Math.floor(sum.combinedFoodLevel / sum.dailyFood)) : null;
                        const daysClass = days === null ? '' : (days < 3 ? 'pen-days-left--critical' : (days < 7 ? 'pen-days-left--warning' : ''));
                        feedHtml = `<div class="barn-tile-feed">
                                <div class="pen-bar-track"><div class="pen-bar-fill ${barClass}" style="width:${pct}%"></div></div>
                                <span class="barn-tile-feed-meta">
                                    <span>${Math.round(sum.combinedFoodLevel).toLocaleString()} L${sum.combinedCap ? ` / ${Math.round(sum.combinedCap).toLocaleString()} L` : ''}</span>
                                    ${days !== null ? `<span class="${daysClass}">${days} ${t('hubDaysRemaining')}</span>` : ''}
                                </span>
                            </div>`;
                    }

                    html += `<div class="barn-tile ${warn ? 'barn-tile--warning' : ''}" role="button" tabindex="0" data-building="${escapeHtml(String(building.id))}">
                        <div class="barn-tile-head">
                            ${animalPictureHtml(building.clusters.slice().sort((a, b) => b.numAnimals - a.numAnimals)[0], 'barn-tile-pic')}
                            ${barnNameHtml(farm, building, 'barn-tile-title')}
                        </div>
                        <div class="barn-tile-body">
                            ${speciesHtml}
                            ${headTotal ? `<span class="barn-tile-health">${t('hubHealth')}: ${Math.round(healthSum / headTotal)}%</span>` : ''}
                            ${(() => {
                                const r = barnReproSummary(building);
                                if (!r || !r.pregnant) return '';
                                return `<span class="barn-tile-repro"><i class="fa-solid fa-baby-carriage" aria-hidden="true"></i> ${t('reproPregnant')}: ${r.pregnant.toLocaleString()}${r.nextBirth !== null ? ' · ' + reproDueText(r.nextBirth) : ''}</span>`;
                            })()}
                        </div>
                        <div class="barn-tile-section-label">${t('hubFeedLevel')}${warn ? `<span class="pen-warning-badge">${t('hubFeedLow')}</span>` : ''}</div>
                        ${feedHtml}
                        <span class="barn-tile-open">${t('barnOpenDetails')} <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></span>
                    </div>`;
                });
                html += `</div>`; // .barn-tile-grid
                html += historySectionHtml;
            }

            bodyEl.innerHTML = html;
            wireBarnPanel(bodyEl, farm);

            bodyEl.querySelectorAll('.pen-ration-select').forEach(el => el.addEventListener('change', () => {
                const plan = getFeedPlan(getCurrentFarm());
                plan.rations[el.dataset.type] = el.value;
                saveFeedPlan(plan);
                const scroll = modalEl ? modalEl.scrollTop : 0;
                openHubPanel('animals');
                if (modalEl) modalEl.scrollTop = scroll;
            }));
        }
    } else if (type === 'supplies') {
        renderSuppliesPanel(titleEl, bodyEl, modalEl);
    } else if (type === 'fieldsoil') {
        renderFieldSoilPanel(titleEl, bodyEl, modalEl);
    } else if (type === 'notes') {
        renderNotesPanel(titleEl, bodyEl, modalEl);
    } else if (type === 'yieldforecast') {
        renderYieldForecastPanel(titleEl, bodyEl, modalEl);
    } else if (type === 'feedplan') {
        renderFeedPlanPanel(titleEl, bodyEl, modalEl);
    } else {
        return;
    }

    setActiveSidebarItem(type);
    if (plannerContentEl) plannerContentEl.style.display = 'none';
    if (hubView) hubView.hidden = false;
};

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

    const fmtL = n => `${Math.round(n).toLocaleString()} l`;
    const fmtKg = n => `${Math.round(n).toLocaleString()} kg`;
    const num = n => Math.round(n).toLocaleString();

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
        html += `<table class="supply-table"><thead><tr>
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
            <td colspan="4">${t('suppliesTotal')}</td><td>${fmtL(seed.total)}</td></tr></tfoot></table>`;
    } else {
        html += `<p class="hub-panel-note">${t('suppliesAllSown')}</p>`;
    }

    // --- Fertilizer --- one row per field due for fertilizing, sourced from
    // that field's own "Nawożenie" plan: target / existing / natural / mineral
    // N all in one row, natural N also shown as manure/slurry/digestate
    // volume. A field with no saved plan gets a CTA instead of a guess.
    html += `<div class="hub-panel-subtitle">${t('suppliesFertilizer')}</div>`;
    if (fert.rows.length) {
        const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const orgCell = (r) => r.orgRate > 0
            ? `${num(r.orgRate)} ${t('suppliesNRateUnit')}<span class="supply-sub">${fmtKg(r.orgAbs)} N</span>
               <span class="supply-sub">${t('suppliesOrgManure')} ${fmtL(r.orgVolAbs.manure)}</span>
               <span class="supply-sub">${t('suppliesOrgSlurry')} ${fmtL(r.orgVolAbs.slurry)}</span>
               <span class="supply-sub">${t('suppliesOrgDigestate')} ${fmtL(r.orgVolAbs.digestate)}</span>`
            : '–';
        html += `<table class="supply-table"><thead><tr>
            <th>${t('suppliesColField')}</th><th>${t('suppliesColCrop')}</th><th>${t('suppliesColSoil')}</th><th>${t('suppliesColArea')}</th>
            <th>${t('suppliesColTargetN')}</th><th>${t('suppliesColExistingN')}</th><th>${t('suppliesColOrgN')}</th><th>${t('suppliesColMineralN')}</th>
            </tr></thead><tbody>`;
        fert.rows.forEach(r => {
            if (!r.hasPlan) {
                html += `<tr><td>${r.number}</td><td>${translateCropName(r.crop)}</td><td colspan="2">${r.area.toFixed(2)} ha</td>
                    <td colspan="4" class="supply-fillplan-cell">
                        <button type="button" class="supply-fillplan-btn" title="${t('suppliesFillPlanHint')}"
                            onclick="openFieldFertPlan('${esc(r.planKey)}','${esc(r.soilKey)}','${esc(r.displayNumber)}','${esc(r.crop)}',${r.area})">
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
            <td>${fmtL(fert.totals.mineralLAbs)}<span class="supply-sub">${fmtKg(fert.totals.mineralAbs)} N</span></td>
            </tr></tfoot></table>`;
        if (fert.missingPlanCount > 0) {
            html += `<p class="hub-panel-note">${t('suppliesNoPlanNote').replace('{n}', fert.missingPlanCount)}</p>`;
        }
        const density = (parseFloat(rates.nDensity) > 0) ? parseFloat(rates.nDensity) : 0.5;
        html += `<p class="hub-panel-note">${t('suppliesNDensityNote').replace('{d}', density)}</p>`;
        html += `<p class="hub-panel-note">${t('suppliesSoilHint')}</p>`;
    } else {
        html += `<p class="hub-panel-note">${t('suppliesNoFert')}</p>`;
    }

    html += `<p class="hub-panel-note">${t('suppliesBufferNote').replace('{p}', rates.bufferPct)}</p>`;

    bodyEl.innerHTML = html;
}

// Farm Hub → "Field soil type": one row per field of the current farm, a %
// input per PF soil type. Blanks mean 0; shares need not total 100 —
// fieldNRate() weights by their sum. Saved to rates.fieldSoil, keyed the same
// way computeSeasonSupplies keys fields (number, else idx-<i>), so the
// Supplies panel picks the mix up straight away.
function renderFieldSoilPanel(titleEl, bodyEl, modalEl) {
    titleEl.textContent = t('suppliesSoilPerField');

    const farm = getAllFarms().find(f => f.id === currentFarmId);
    const rates = getSupplyRates();
    const soils = soilTypeList();
    const fields = (farm && farm.fields) || [];

    const seen = new Set();
    const rows = [];
    fields.forEach((f, i) => {
        const number = (f.number || '').toString().trim();
        const key = number || ('idx-' + i);
        if (seen.has(key)) return;
        seen.add(key);
        if (!number && (parseFloat(f.area) || 0) <= 0) return;
        rows.push({ key, number: number || ('#' + (i + 1)) });
    });

    let html = `<p class="supply-intro">${t('suppliesSoilNote').replace('{d}', soilLabel(defaultSoilId()))}</p>`;

    if (!soils.length || !rows.length) {
        bodyEl.innerHTML = html + `<p class="hub-panel-note">${t('fieldSoilEmpty')}</p>`;
        return;
    }

    const hasSave = !!(farm && farm.saveGamePath);
    html += `<div class="field-soil-import">
            <button type="button" id="field-soil-import-btn" class="supply-fillplan-btn" ${hasSave ? '' : 'disabled'}>${t('fieldSoilImportBtn')}</button>
            <span class="field-soil-import-hint">${hasSave ? t('fieldSoilImportHint') : t('fieldSoilImportNoPath')}</span>
        </div>`;
    if (fieldSoilImportMsg) {
        html += `<p class="hub-panel-note field-soil-import-msg">${fieldSoilImportMsg}</p>`;
        fieldSoilImportMsg = '';
    }

    const heads = soils.map(s => `<th>${soilLabel(s)}${typeof s.yieldPct === 'number' ? `<span class="supply-sub">${t('suppliesSoilYield').replace('{p}', s.yieldPct)}</span>` : ''}</th>`).join('');
    let body = '';
    rows.forEach(r => {
        const mix = (rates.fieldSoil && rates.fieldSoil[r.key]) || {};
        const cells = soils.map(s => {
            const v = (mix[s.id] !== undefined && mix[s.id] !== '' && !isNaN(mix[s.id])) ? mix[s.id] : '';
            return `<td><input type="number" min="0" max="100" step="5" class="supply-soil-input" data-soil-field="${r.key}" data-soil-type="${s.id}" value="${v}" placeholder="0"><span class="supply-unit">%</span></td>`;
        }).join('');
        body += `<tr><td>${r.number}</td>${cells}</tr>`;
    });

    html += `<table class="supply-table supply-soil-table"><thead><tr>
            <th>${t('suppliesColField')}</th>${heads}</tr></thead>
            <tbody>${body}</tbody></table>
        <p class="hub-panel-note">${t('suppliesSoilFileNote')}</p>`;

    bodyEl.innerHTML = html;
    wireSoilInputs(bodyEl);

    const importBtn = bodyEl.querySelector('#field-soil-import-btn');
    if (importBtn) importBtn.addEventListener('click', () => {
        fieldSoilImportMsg = importFieldSoilFromGame(farm);
        openHubPanel('fieldsoil');
    });
}

// One-shot status line shown under the import button after the panel re-renders.
let fieldSoilImportMsg = '';

// "Load soils from the game": fills rates.fieldSoil for every field whose
// number(s) exist on the map. A combined field ("168-169", "69-70-71") gets
// the pixel-weighted mix of its parts. Returns the status line (HTML-safe text).
function importFieldSoilFromGame(farm) {
    const res = readFieldSoilFromSave(farm && farm.saveGamePath);
    if (!res.ok) {
        const reasons = t('fieldSoilImportReasons') || {};
        const why = (reasons[res.reason] || res.reason).replace('{mod}', res.modName || '');
        return t('fieldSoilImportFail').replace('{reason}', escapeHtml(why));
    }

    const soilIds = soilTypeList().map(s => s.id);   // PF soilTypeIndex order
    const rates = getSupplyRates();
    if (!rates.fieldSoil) rates.fieldSoil = {};

    // Area per field key as entered in the season table (split rows summed).
    const areaByKey = {};
    (farm.fields || []).forEach((f, i) => {
        const key = fertPlanSoilKey(f, i);
        areaByKey[key] = (areaByKey[key] || 0) + (parseFloat(f.area) || 0);
    });

    let filled = 0;
    const missing = [], areaOff = [];
    Object.keys(areaByKey).forEach(key => {
        const ids = key.split(/[^0-9]+/).filter(Boolean).map(s => String(parseInt(s, 10)));
        if (!ids.length) return;
        const parts = ids.map(id => res.fields[id]);
        if (parts.some(p => !p)) { missing.push(key); return; }

        const counts = [0, 0, 0, 0];
        let ha = 0;
        parts.forEach(p => { p.counts.forEach((c, i) => { counts[i] += c; }); ha += p.ha; });
        const total = counts.reduce((s, c) => s + c, 0);
        if (!total) { missing.push(key); return; }

        const mix = {};
        counts.forEach((c, i) => {
            const pct = Math.round(100 * c / total);
            if (pct > 0 && soilIds[i]) mix[soilIds[i]] = pct;
        });
        rates.fieldSoil[key] = mix;
        filled++;

        const entered = areaByKey[key];
        if (entered > 0 && Math.abs(entered - ha) / ha > 0.1) {
            areaOff.push(`${key} (${entered.toFixed(2)} ≠ ${ha.toFixed(2)} ha)`);
        }
    });
    saveSupplyRates(rates);

    let msg = t('fieldSoilImportDone').replace('{n}', filled).replace('{map}', escapeHtml(res.mapTitle || res.modName || ''));
    if (missing.length) msg += ' ' + t('fieldSoilImportMissing').replace('{list}', escapeHtml(missing.join(', ')));
    if (areaOff.length) msg += ' ' + t('fieldSoilImportArea').replace('{list}', escapeHtml(areaOff.join(', ')));
    return msg;
}

// Farm Hub → "Predicted yields": every crop sown this month, aggregated
// across fields, with a predicted harvest in litres assuming ideal N, ideal
// pH and no weeds. Read-only — no wiring needed.
function renderYieldForecastPanel(titleEl, bodyEl, modalEl) {
    titleEl.textContent = t('yieldForecastTitle');

    const farm = getAllFarms().find(f => f.id === currentFarmId);
    if (!farm) { bodyEl.innerHTML = `<p class="hub-panel-note">${t('suppliesNoCrops')}</p>`; return; }

    const rates = getSupplyRates();
    const data = buildYieldForecastRows(farm, rates);
    const num = n => Math.round(n).toLocaleString();

    let html = `<p class="supply-intro">${t('yieldForecastIntro')}</p>`;

    if (!data.rows.length) {
        bodyEl.innerHTML = html + `<p class="hub-panel-note">${t('yieldForecastEmpty')}</p>`;
        return;
    }

    html += `<table class="supply-table"><thead><tr>
        <th>${t('yieldForecastColCrop')}</th><th>${t('yieldForecastColArea')}</th><th>${t('yieldForecastColYield')}</th>
        </tr></thead><tbody>`;
    data.rows.forEach(r => {
        const flag = r.known ? '' : ` <span class="supply-flag" title="${t('yieldForecastUnknownFlag')}">?</span>`;
        html += `<tr><td>${translateCropName(r.crop)}${flag}</td>
            <td>${r.area.toFixed(2)} ha</td>
            <td>${num(r.litres)} l</td></tr>`;
    });
    html += `</tbody><tfoot><tr class="supply-total-row">
        <td colspan="2">${t('suppliesTotal')}</td><td>${num(data.total)} l</td></tr></tfoot></table>`;

    if (data.missingCount > 0) {
        html += `<p class="hub-panel-note">${t('yieldForecastUnknownNote').replace('{n}', data.missingCount)}</p>`;
    }
    html += `<p class="hub-panel-note">${t('yieldForecastNote')}</p>`;

    bodyEl.innerHTML = html;
}

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
// Straw windrow left behind by the combine, l/ha — the map's
// windrowLitersPerSqm x 10000 (tools/SOLEK_agronomy.json).
const FEED_STRAW_L_PER_HA = { Wheat: 38000, Barley: 36800, Oat: 36800, Rye: 46000, Triticale: 36000 };
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
    return !!(ANIMAL_MODS && ANIMAL_MODS.afc && !(farm && farm.ignoreAfc));
}
function easActive(farm) {
    return !!(ANIMAL_MODS && ANIMAL_MODS.eas && !(farm && farm.ignoreEas));
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
        customFeeds: Array.isArray(saved.customFeeds) ? saved.customFeeds : [],
        // Fixed to the game's default recipe — it's no longer editable, so an
        // older saved recipe is ignored.
        tmr: { ...TMR_DEFAULT },
        fieldUse: { ...(saved.fieldUse || {}) },
        strawFields: { ...(saved.strawFields || {}) },
        grassCuts: parseFloat(saved.grassCuts) > 0 ? parseFloat(saved.grassCuts) : 3,
        chaffYield: parseFloat(saved.chaffYield) > 0 ? parseFloat(saved.chaffYield) : Math.round((CROP_YIELD_L_PER_HA.Maize || 9200) * 4),
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

// The recipe ({ingredients, efficiency}) a species is fed with. Unknown or
// deleted custom feeds fall back to the species' first built-in ration.
function resolveRation(type, plan) {
    const groups = ANIMAL_FOOD_GROUPS[type] || {};
    let id = plan.rations[type] || defaultRationFor(type);
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

// <option>s for a species' ration picker: built-in rations, then that
// species' custom feeds in their own group. Shared by the feed planner and
// the Animals panel so both always offer (and save) the same choice.
function feedRationOptionsHtml(type, plan, selectedId) {
    const builtIn = Object.keys(ANIMAL_FOOD_GROUPS[type] || {}).map(id =>
        `<option value="${id}" ${selectedId === id ? 'selected' : ''}>${t('feedRation_' + id)} (${ANIMAL_FOOD_GROUPS[type][id].efficiency}%)</option>`).join('');
    const custom = plan.customFeeds.filter(f => f.animalType === type).map(f =>
        `<option value="custom:${f.id}" ${selectedId === 'custom:' + f.id ? 'selected' : ''}>${escapeHtml(f.name)} (${f.efficiency}%)</option>`).join('');
    return builtIn + (custom ? `<optgroup label="${t('feedCustomGroup')}">${custom}</optgroup>` : '');
}

// Output fillTypes that don't depend on how well the animals are fed.
const FEED_UNSCALED_OUTPUT = ['MANURE', 'LIQUIDMANURE'];

function splitByRecipe(litres, recipe, into) {
    const total = recipe.ingredients.reduce((s, i) => s + (parseFloat(i.pct) || 0), 0) || 100;
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
        s.head += c.numAnimals;
        s.food += getDailyAnimalNeed(c.subType, c.age, 'food') * c.numAnimals * yearFactor * clusterFoodFactor(farm, type, c);
        s.straw += getDailyAnimalNeed(c.subType, c.age, 'straw') * c.numAnimals * yearFactor;
    }));
    Object.keys(bySpecies).forEach(type => {
        const s = bySpecies[type];
        s.ration = resolveRation(type, plan);
        if (s.ration) splitByRecipe(s.food, s.ration, byCategory);
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

        const strawRate = plan.strawYield || FEED_STRAW_L_PER_HA[crop];
        const strawPossible = FEED_STRAW_L_PER_HA[crop] !== undefined;
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
    OAT: 'OAT'
};
const FEED_STOCK_SOURCES = ['silo', 'bunker', 'bale', 'pallet', 'mixer'];

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
function readFeedMixersFromSave(saveFolder, modsDirs) {
    const p = path.join(saveFolder, 'placeables.xml');
    if (!fs.existsSync(p)) return [];
    const doc = new DOMParser().parseFromString(fs.readFileSync(p, 'utf-8'), 'text/xml');
    if (doc.querySelector('parsererror')) return [];
    const up = s => String(s || '').toUpperCase();
    const defCache = {};
    const mixers = [];
    doc.querySelectorAll('placeable[farmId="1"]').forEach(pl => {
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
        const rawName = nameEl ? (nameEl.querySelector('en') || nameEl).textContent.trim() : '';
        const products = [...new Set(feedRecipes.flatMap(r => r.outputs.map(o => o.fillType)).filter(ft => FEED_PRODUCT_FILLTYPES.includes(ft)))];
        mixers.push({
            id: pl.getAttribute('uniqueId') || filename,
            name: rawName && !rawName.startsWith('$') ? rawName : filename.replace(/\\/g, '/').split('/').pop().replace(/\.xml$/i, ''),
            mod: pl.getAttribute('modName') || '',
            products,
            recipes: feedRecipes,
            stock,
            capacity
        });
    });
    return mixers;
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
        placeables.querySelectorAll('placeable[farmId="1"]').forEach(pl => {
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
        items.querySelectorAll('item[className="Bale"][farmId="1"]').forEach(b =>
            add(baleFillType(b), 'bale', parseFloat(b.getAttribute('fillLevel'))));
    }
    const vehicles = parse('vehicles.xml');
    if (vehicles) {
        vehicles.querySelectorAll('vehicle[farmId="1"]').forEach(v => {
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
    if (items) items.querySelectorAll('item[className="Bale"][farmId="1"]').forEach(add);
    const placeables = parse('placeables.xml');
    if (placeables) {
        placeables.querySelectorAll('placeable[farmId="1"] objectStorage > object[className="Bale"]').forEach(add);
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
    doc.querySelectorAll('vehicle[farmId="1"]').forEach(v => {
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
                const nameText = name ? name.textContent.trim() : '';
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
function feedStockByCategory(stock) {
    const byCategory = {};
    Object.entries(stock || {}).forEach(([ft, sources]) => {
        const litres = Object.values(sources).reduce((a, v) => a + v, 0);
        const split = FEED_MIXTURE_SPLIT[ft] || (FEED_FILLTYPE_CATEGORY[ft] ? { [FEED_FILLTYPE_CATEGORY[ft]]: 1 } : null);
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
function buildFeedBalance(demand, supply, plan, avgFactor, stockByCategory = {}) {
    const d = demand.byCategory, s = supply.byCategory, st = stockByCategory;
    const rows = [];
    const grassPerHa = (getCropYieldRate('Grass') || 0) * plan.grassCuts * avgFactor;
    const own = c => (st[c] || 0) + (c === 'SILAGE' ? (s.SILAGE || 0) : 0);
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
        const have = meadow + (c === 'SILAGE' ? (s.SILAGE || 0) : 0);
        if (need <= 0 && have <= 0 && stock <= 0) return;
        rows.push({ id: c, need, have, stock, perHa: grassPerHa });
    });
    FEED_CATEGORIES.filter(c => !FEED_ROUGHAGE.includes(c)).forEach(c => {
        const need = d[c] || 0, have = s[c] || 0, stock = st[c] || 0;
        if (need <= 0 && have <= 0 && stock <= 0) return;
        const ref = FEED_REFERENCE_CROP[c];
        const perHa = c === 'STRAW'
            ? (plan.strawYield || FEED_STRAW_L_PER_HA.Wheat) * avgFactor
            : (ref ? (getCropYieldRate(ref) || 0) * avgFactor : 0);
        rows.push({ id: c, need, have, stock, perHa, buyOnly: c === 'MINERAL' });
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
        const ration = resolveRation(type, plan);
        const f = getDailyAnimalNeed(c.subType, c.age, 'food') * c.numAnimals * yearFactor * clusterFoodFactor(farm, type, c);
        const b = getDailyAnimalNeed(c.subType, c.age, 'straw') * c.numAnimals * yearFactor;
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

function renderFeedIngredientTile(categories, barnLitres, row, num) {
    const need = row ? row.need : 0;
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
    const haveParts = [];
    if (row && row.stock > 0) haveParts.push(`${t('feedStockShort')} ${num(row.stock)}`);
    if (row && !row.buyOnly && row.have > 0) haveParts.push(`${t('feedHarvestShort')} ${num(row.have)}`);
    return `<div class="feed-ing-tile feed-ing-tile--${state}">
        <div class="feed-ing-head">
            <span class="feed-ing-icon"><i class="fa-solid ${FEED_CATEGORY_ICONS[categories[0]] || 'fa-wheat-awn'}" aria-hidden="true"></i></span>
            <span class="feed-ing-name">${categories.map(feedCategoryLabel).join(' + ')}</span>
        </div>
        <div class="feed-ing-barn">${t('feedThisBarn')}: <strong>${num(barnLitres)} l</strong>${t('feedPerYearShort')}</div>
        <div class="feed-ing-status">${status}</div>
        <div class="feed-ing-bar"><div class="feed-ing-bar-fill" style="width:${pct}%"></div></div>
        <div class="feed-ing-have">${t('feedYouHave')}: ${haveParts.length ? haveParts.join(' + ') : '0'} ${t('feedOfNeeded').replace('{n}', num(need))}</div>
    </div>`;
}

// Fill type as the player knows it: mixer products by name, crops through
// the crop dictionary.
function feedFillTypeName(ft) {
    if (FEED_PRODUCT_FILLTYPES.includes(ft)) return t('feedProduct_' + ft);
    const crop = translateCropName(formatCropName(ft));
    return crop || formatFillType(ft);
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
                <span class="feed-mixer-product-rate">${t('feedMixerPerMonth').replace('{l}', num(feedMixerMonthlyOutput(m, p)))}</span>
            </div>`;
        }).join('');
        const recipeLine = r => `<li class="${r.enabled ? 'is-on' : ''}"><i class="fa-solid ${r.enabled ? 'fa-circle-check' : 'fa-circle'}" aria-hidden="true"></i>
            ${r.inputs.map(i => escapeHtml(feedFillTypeName(i.fillType))).join(' + ')} → ${r.outputs.map(o => escapeHtml(feedFillTypeName(o.fillType))).join(', ')}</li>`;
        const inputs = [...new Set(m.recipes.flatMap(r => r.inputs.map(i => i.fillType)))];
        const inputStock = inputs.filter(ft => m.stock[ft] > 0).map(ft => `${escapeHtml(feedFillTypeName(ft))} ${num(m.stock[ft])} l`).join(' · ');
        html += `<div class="feed-mixer-tile ${relevant ? 'feed-mixer-tile--relevant' : ''}">
            <div class="feed-mixer-head"><i class="fa-solid fa-blender" aria-hidden="true"></i>
                <span class="feed-mixer-name">${escapeHtml(m.name)}</span>
                ${relevant ? `<span class="feed-mixer-badge">${t('feedMixerForBarn')}</span>` : ''}</div>
            ${products}
            ${on.length ? '' : `<p class="feed-mixer-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${t('feedMixerNoneOn')}</p>`}
            <details class="feed-mixer-recipes"><summary>${t('feedMixerRecipes').replace('{on}', on.length).replace('{n}', m.recipes.length)}</summary>
                <ul>${m.recipes.map(recipeLine).join('')}</ul></details>
            <p class="feed-mixer-inputs">${inputStock ? `${t('feedMixerInputs')}: ${inputStock}` : t('feedMixerInputsEmpty')}</p>
        </div>`;
    });
    html += `</div><p class="hub-panel-note">${t('feedMixersNote')}</p>`;
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
    const balance = buildFeedBalance(demand, supply, plan, farmAverageYieldFactor(farm, rates), feedStockByCategory(stock));
    const num = n => Math.round(n).toLocaleString();
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
            const ration = resolveRation(type, plan);
            const current = ration ? ration.id : '';
            html += `<div class="hub-panel-subtitle">${t('feedPickRation')}${Object.keys(barnNeed.heads).length > 1 ? ' · ' + t('feedAnimal_' + type) : ''}</div><div class="feed-ration-row">`;
            Object.keys(ANIMAL_FOOD_GROUPS[type] || {}).forEach(id => {
                html += `<button type="button" class="feed-ration-tile ${current === id ? 'feed-ration-tile--active' : ''}" data-type="${type}" data-ration="${id}">
                    <span class="feed-ration-name">${t('feedRation_' + id)}</span><span class="feed-ration-eff">${ANIMAL_FOOD_GROUPS[type][id].efficiency}%</span></button>`;
            });
            plan.customFeeds.filter(f => f.animalType === type).forEach(f => {
                const id = 'custom:' + f.id;
                html += `<button type="button" class="feed-ration-tile ${current === id ? 'feed-ration-tile--active' : ''}" data-type="${type}" data-ration="${id}">
                    <span class="feed-ration-name"><i class="fa-solid fa-flask" aria-hidden="true"></i> ${escapeHtml(f.name)}</span><span class="feed-ration-eff">${f.efficiency}%</span></button>`;
            });
            html += `<button type="button" class="feed-ration-tile feed-ration-tile--new feed-custom-new" data-type="${type}"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${t('feedCustomNew')}</button></div>`;

        });

        if (feedEditorDraft && !feedEditorDraft.id) html += renderFeedEditor(feedEditorDraft);

        // --- 2b. Mixer wagon, for barns fed TMR (the only thing a mixer makes) ---
        const barnUsesTmr = Object.keys(barnNeed.heads).some(type => { const r = resolveRation(type, plan); return r && r.tmr; });
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
                <td><select class="feed-input feed-use-select" data-key="${escapeHtml(r.key)}">${opts}</select></td>
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
    return [...onFarm, ...own];
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
    return `${b.label} · ${what} · ${Math.round(b.litres).toLocaleString()} l`;
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
function mixerAutoLoad(plan, wagon, baleTypes) {
    const recipeSum = MIXER_TMR_CATEGORIES.reduce((s, c) => s + (parseFloat(plan.tmr[c]) || 0), 0) || 100;
    const target = {};
    const baleLoads = [];   // { category, item, litres }
    const load = [];
    MIXER_TMR_CATEGORIES.forEach(c => {
        target[c] = wagon.capacity * (parseFloat(plan.tmr[c]) || 0) / recipeSum;
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
            html += `<div class="mixer-mix">`;
            MIXER_TMR_CATEGORIES.forEach(c => {
                const litres = totals.byCategory[c] || 0;
                const pct = litres / totals.total * 100;
                const [min, max] = TMR_LIMITS[c];
                const target = (parseFloat(plan.tmr[c]) || 0) / recipeSum * 100;
                const ok = pct >= min - 0.05 && pct <= max + 0.05;
                if (!ok) problems.push(feedCategoryLabel(c));
                html += `<div class="mixer-mix-row ${ok ? '' : 'mixer-mix-row--bad'}">
                    <span class="mixer-mix-name">${feedCategoryLabel(c)}</span>
                    <span class="mixer-mix-track" title="${t('mixerRange').replace('{a}', min).replace('{b}', max)}">
                        <span class="mixer-mix-range" style="left:${min}%;width:${max - min}%"></span>
                        <span class="mixer-mix-fill" style="width:${Math.min(100, pct)}%"></span>
                        <span class="mixer-mix-target" style="left:${Math.min(100, target)}%" title="${t('mixerTarget')}: ${Math.round(target)}%"></span>
                    </span>
                    <span class="mixer-mix-pct">${pct.toFixed(1)}%</span>
                    <span class="mixer-mix-l">${num(litres)} l</span>
                </div>`;
            });
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
        if (wagon && wagon.capacity) plan.mixer.load = mixerAutoLoad(plan, wagon, mixerBaleTypes(farm, plan));
    }));
}

function renderFeedEditor(d) {
    const sum = d.ingredients.reduce((s, i) => s + (parseFloat(i.pct) || 0), 0);
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
        <p class="feed-ed-sum ${Math.round(sum) === 100 ? '' : 'feed-warn'}">${t('feedCustomSum').replace('{s}', Math.round(sum))}</p>
        <p class="feed-ed-error feed-warn"></p>
        <div class="feed-editor-actions">
            <button type="button" class="supply-fillplan-btn feed-ed-save"><i class="fa-solid fa-check" aria-hidden="true"></i> ${t('notesSave')}</button>
            <button type="button" class="supply-reset-btn feed-ed-cancel">${t('notesCancel')}</button>
        </div>
    </div>`;
    return html;
}

function validateFeedDraft(d) {
    if (!d.name.trim()) return t('feedErrName');
    if (!d.ingredients.length) return t('feedErrNoIng');
    const cats = d.ingredients.map(i => i.category);
    if (new Set(cats).size !== cats.length) return t('feedErrDuplicate');
    if (d.ingredients.some(i => !(parseFloat(i.pct) > 0))) return t('feedErrPct');
    const sum = d.ingredients.reduce((s, i) => s + (parseFloat(i.pct) || 0), 0);
    if (Math.abs(sum - 100) > 0.01) return t('feedCustomSum').replace('{s}', Math.round(sum));
    const eff = parseFloat(d.efficiency);
    if (!(eff >= 1 && eff <= 100)) return t('feedErrEfficiency');
    return '';
}

function wireFeedPlanPanel(bodyEl) {
    const update = (fn) => { const farm = getCurrentFarm(); const plan = getFeedPlan(farm); fn(plan); saveFeedPlan(plan); rerenderFeedPlan(); };

    bodyEl.querySelectorAll('.feed-barn-tile').forEach(el => el.addEventListener('click', () => {
        feedSelectedBuilding = el.dataset.building;
        rerenderFeedPlan();
    }));
    bodyEl.querySelectorAll('.feed-ration-tile[data-ration]').forEach(el => el.addEventListener('click', () =>
        update(p => { p.rations[el.dataset.type] = el.dataset.ration; })));
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
    bodyEl.querySelectorAll('.feed-custom-delete').forEach(el => el.addEventListener('click', () => {
        if (!confirm(t('feedCustomDeleteConfirm'))) return;
        update(p => {
            p.customFeeds = p.customFeeds.filter(f => f.id !== el.dataset.id);
            Object.keys(p.rations).forEach(type => { if (p.rations[type] === 'custom:' + el.dataset.id) delete p.rations[type]; });
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
        const sum = d.ingredients.reduce((s, i) => s + (parseFloat(i.pct) || 0), 0);
        const el = editor.querySelector('.feed-ed-sum');
        el.textContent = t('feedCustomSum').replace('{s}', Math.round(sum));
        el.classList.toggle('feed-warn', Math.round(sum) !== 100);
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
        const err = validateFeedDraft(d);
        if (err) { editor.querySelector('.feed-ed-error').textContent = err; return; }
        const feed = {
            id: d.id || ('f' + Date.now().toString(36)),
            animalType: d.animalType,
            name: d.name.trim(),
            efficiency: Math.round(parseFloat(d.efficiency)),
            ingredients: d.ingredients.map(i => ({ category: i.category, pct: parseFloat(i.pct) }))
        };
        feedEditorDraft = null;
        update(p => {
            const idx = p.customFeeds.findIndex(f => f.id === feed.id);
            if (idx >= 0) {
                // Species changed: a ration pointing at it for the old species no longer applies.
                const old = p.customFeeds[idx];
                if (old.animalType !== feed.animalType && p.rations[old.animalType] === 'custom:' + feed.id) delete p.rations[old.animalType];
                p.customFeeds[idx] = feed;
            } else {
                p.customFeeds.push(feed);
            }
        });
    });
}

// Shared change-handler wiring for the .supply-soil-input % boxes.
function wireSoilInputs(bodyEl) {
    bodyEl.querySelectorAll('.supply-soil-input').forEach(inp => {
        inp.addEventListener('change', () => {
            const r = getSupplyRates();
            if (!r.fieldSoil) r.fieldSoil = {};
            const k = inp.dataset.soilField;
            const soil = inp.dataset.soilType;
            if (!r.fieldSoil[k]) r.fieldSoil[k] = {};
            const v = inp.value.trim();
            const n = parseFloat(v);
            if (v === '' || isNaN(n) || n <= 0) delete r.fieldSoil[k][soil];
            else r.fieldSoil[k][soil] = n;
            if (Object.keys(r.fieldSoil[k]).length === 0) delete r.fieldSoil[k];
            saveSupplyRates(r);
            openHubPanel('fieldsoil');
        });
    });
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
    const density = (parseFloat(rates.nDensity) > 0) ? parseFloat(rates.nDensity) : 0.5;
    const buffer = 1 + (parseFloat(rates.bufferPct) || 0) / 100;
    const soilMix = getFieldSoilMix(soilKey, rates);
    const targetRate = fieldNRate(cropKey, soilMix, rates);
    const saved = rates.fertPlan && rates.fertPlan[planKey];
    const num = (v) => (saved && saved[v] > 0 && !isNaN(saved[v])) ? parseFloat(saved[v]) : 0;
    const existingRate = num('existingN');   // N already in/on the field before this plan
    const orgRate = num('orgN');             // natural fertilizer this plan adds
    const mineralRate = Math.max(0, targetRate - existingRate - orgRate);

    // How many litres of manure / slurry / digestate the entered natural-N dose
    // is equivalent to, at this farm's N content per litre (Supplies rates).
    const mN = parseFloat(rates.manureN) > 0 ? parseFloat(rates.manureN) : 0.007;
    const sN = parseFloat(rates.slurryN) > 0 ? parseFloat(rates.slurryN) : 0.004;
    const dN = parseFloat(rates.digestateN) > 0 ? parseFloat(rates.digestateN) : 0.0055;
    const orgVol = { manure: orgRate / mN, slurry: orgRate / sN, digestate: orgRate / dN };

    return {
        density, buffer, soilMix, targetRate, existingRate, orgRate, mineralRate, orgVol,
        mineralLitres: mineralRate / density,
        area, covered: (existingRate + orgRate) >= targetRate - 0.5
    };
}

window.openFieldFertPlan = function (planKey, soilKey, displayNumber, cropKey, area) {
    const titleEl = document.getElementById('fertplan-modal-title');
    const bodyEl = document.getElementById('fertplan-modal-body');
    if (!titleEl || !bodyEl || !hubPanelModal) return;

    renderFieldFertPlan(titleEl, bodyEl, planKey, soilKey, displayNumber, cropKey, parseFloat(area) || 0);

    hubPanelModal.style.display = 'flex';
};

function renderFieldFertPlan(titleEl, bodyEl, planKey, soilKey, displayNumber, cropKey, area) {
    const rates = getSupplyRates();
    const d = computeFieldFertPlan(planKey, soilKey, cropKey, area, rates);
    const num = n => Math.round(n).toLocaleString();
    const kgN = t('suppliesNRateUnit');
    const match = findFertPlanField(getCurrentFarm(), planKey);
    const fieldRow = match ? match.field : null;

    titleEl.textContent = `${t('fertPlanTitle')} — ${t('suppliesColField')} ${displayNumber} · ${translateCropName(cropKey)}`;

    const existingVal = d.existingRate > 0 ? d.existingRate : '';
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
            <span class="fertplan-input-wrap"><input type="number" min="0" step="5" class="fertplan-existing-input" value="${existingVal}" placeholder="0"><span class="supply-unit">${kgN}</span></span>
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
            const r = getSupplyRates();
            if (!r.fertPlan) r.fertPlan = {};
            const entry = { ...(r.fertPlan[planKey] || {}) };
            const v = el.value.trim();
            const n = parseFloat(v);
            if (v === '' || isNaN(n) || n <= 0) delete entry[key];
            else entry[key] = n;
            if (Object.keys(entry).length === 0) delete r.fertPlan[planKey];
            else r.fertPlan[planKey] = entry;
            saveSupplyRates(r);
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
            // Refresh the table underneath so the "Nawożenie" button's white /
            // brown / green state is already right when this modal closes.
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
        const seedDefault = SUPPLY_SEED_RATES[c] !== undefined ? SUPPLY_SEED_RATES[c] : SUPPLY_SEED_FALLBACK;
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
            <table class="supply-table supply-rate-table"><thead><tr>
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

const saveSettingsBtn = document.getElementById('save-settings-btn');
const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
const gameSavePathInput = document.getElementById('game-save-path');
const browseSaveBtn = document.getElementById('browse-save-btn');
const settingsMapNameInput = document.getElementById('settings-map-name');
const autoSyncToggle = document.getElementById('auto-sync-toggle');
const autoSyncToast = document.getElementById('auto-sync-toast');
const cropsFolderInput = document.getElementById('crops-folder-path');
const browseCropsBtn = document.getElementById('browse-crops-btn');
const cropsFolderPicker = document.getElementById('crops-folder-picker');
const cropsLoadedInfo = document.getElementById('crops-loaded-info');
const animalDefsFolderInput = document.getElementById('animal-defs-folder-path');
const browseAnimalDefsBtn = document.getElementById('browse-animal-defs-btn');
const animalDefsFolderPicker = document.getElementById('animal-defs-folder-picker');
const animalDefsLoadedInfo = document.getElementById('animal-defs-loaded-info');

const plannerTitle = document.getElementById('planner-farm-name');
const plannerBalance = document.getElementById('planner-balance');
const plannerMonth = document.getElementById('planner-month');
const plannerYear = document.getElementById('planner-year');
const exitBtn = document.getElementById('exit-btn');
const backBtn = document.getElementById('back-btn');

// Independent, user-editable year counter shown next to the month — not the
// same thing as farm.currentSeason (which drives NEW SEASON / field archiving).
// Bumped automatically on a December -> January rollover in applyGameSaveToFarm;
// manual edits here just overwrite the stored value directly.
if (plannerYear) {
    plannerYear.addEventListener('change', () => {
        const farm = getCurrentFarm();
        if (!farm) return;
        const n = Math.max(1, parseInt(plannerYear.value, 10) || 1);
        plannerYear.value = n;
        farm.yearNumber = n;
        saveFarmData(farm);
    });
}

const editSeasonBtn = document.getElementById('edit-season-btn');
const newSeasonBtn = document.querySelector('.new-season-btn');
const seasonNumberEl = document.querySelector('.season-number');
const fieldsBody = document.getElementById('fields-body');
const fieldsTable = document.getElementById('fields-table');
const totalSumEl = document.getElementById('total-ha-sum');

const detailHa = document.getElementById('detail-ha');
const detailFields = document.getElementById('detail-fields');
const detailCrops = document.getElementById('detail-crops');
const detailAge = document.getElementById('detail-age');
const detailEquipment = document.getElementById('detail-equipment');
const detailAnimals = document.getElementById('detail-animals');

const cropsBody = document.getElementById('crops-body');

// =============================================================
// SECTION 2B: NOTES (reminders per month, tags, checklist)
// =============================================================
// Notes are per-farm, stored in their own notes.json sibling to data.json/
// monthly.json (farmDir(), see Section 4) — a flat array, loaded whole and
// rewritten whole, same idiom as loadMonthlyHistory/saveMonthlyHistory.
// Rendered inside the existing generic hub-panel-modal (openHubPanel('notes')),
// with a small dedicated modal (#note-edit-modal) for adding/editing one note.

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function notesPath(farm) {
    if (!farm) return null;
    return path.join(farmDir(farm), 'notes.json');
}

function loadNotes(farm) {
    const p = notesPath(farm);
    if (!p || !fs.existsSync(p)) return [];
    try {
        const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return Array.isArray(arr) ? arr : [];
    } catch (err) {
        return []; // corrupt file — start fresh rather than break the panel
    }
}

function saveNotes(farm, notes) {
    const p = notesPath(farm);
    if (!p) return;
    try { fs.writeFileSync(p, JSON.stringify(notes, null, 2), 'utf-8'); }
    catch (err) { console.error('Could not write notes:', err); }
}

function generateNoteId() {
    return 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// The in-game month currently shown for this farm, taken from its own
// monthly history log (Section 4A) — reused here instead of re-parsing the
// savegame, just to know which notes count as "this month".
function getFarmCurrentMonth(farm) {
    const rows = loadMonthlyHistory(farm);
    const last = rows[rows.length - 1];
    return last ? last.month : null;
}

// Deterministic color per tag string (same tag always gets the same swatch),
// picked from the app's own earthy palette so tags never clash with it.
const NOTE_TAG_PALETTE = ['#3F6B44', '#C97A2B', '#3E7089', '#A6452B', '#6B7B3F', '#7A5C3E'];
function noteTagColor(tag) {
    const s = String(tag);
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return NOTE_TAG_PALETTE[hash % NOTE_TAG_PALETTE.length];
}

function noteAllTags(notes) {
    const set = new Set();
    notes.forEach(n => (n.tags || []).forEach(tg => set.add(tg)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function renderNoteCard(note, currentMonth) {
    const isCurrent = !!(currentMonth && (note.months || []).includes(currentMonth));
    const monthsHtml = (note.months || []).map(m =>
        `<span class="note-month-chip${m === currentMonth ? ' note-month-chip--current' : ''}">${translateMonth(m)}</span>`
    ).join('');
    const tagsHtml = (note.tags || []).map(tg =>
        `<span class="note-tag-chip" style="--tag-color:${noteTagColor(tg)}">${escapeHtml(tg)}</span>`
    ).join('');

    const checklist = note.checklist || [];
    const doneCount = checklist.filter(c => c.done).length;
    const checklistHtml = checklist.length ? `
        <div class="note-checklist">
            <div class="note-checklist-progress">${doneCount}/${checklist.length}</div>
            ${checklist.map((item, idx) => `
                <label class="note-checklist-item">
                    <input type="checkbox" ${item.done ? 'checked' : ''} onchange="window.toggleNoteChecklistItem('${note.id}', ${idx}, this)">
                    <span class="${item.done ? 'is-done' : ''}">${escapeHtml(item.text)}</span>
                </label>`).join('')}
        </div>` : '';

    return `
        <div class="note-card${isCurrent ? ' note-card--current-month' : ''}">
            <div class="note-card-header">
                <h4 class="note-card-title">${escapeHtml(note.title)}</h4>
                <div class="note-card-actions">
                    <button type="button" class="note-card-action" title="${t('notesEdit')}" onclick="window.openNoteEditModal('${note.id}')"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                    <button type="button" class="note-card-action note-card-action--danger" title="${t('notesDelete')}" onclick="window.deleteNote('${note.id}')"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
                </div>
            </div>
            ${isCurrent ? `<span class="note-current-badge">${t('notesCurrentMonthBadge')}</span>` : ''}
            ${monthsHtml ? `<div class="note-chip-row">${monthsHtml}</div>` : ''}
            ${note.body ? `<p class="note-card-body">${escapeHtml(note.body)}</p>` : ''}
            ${tagsHtml ? `<div class="note-chip-row">${tagsHtml}</div>` : ''}
            ${checklistHtml}
        </div>`;
}

function renderNotesListHtml(notes, currentMonth, filterMonth, filterTag) {
    const filtered = notes.filter(n => {
        if (filterMonth && !(n.months || []).includes(filterMonth)) return false;
        if (filterTag && !(n.tags || []).includes(filterTag)) return false;
        return true;
    }).sort((a, b) => {
        const aCur = (currentMonth && (a.months || []).includes(currentMonth)) ? 0 : 1;
        const bCur = (currentMonth && (b.months || []).includes(currentMonth)) ? 0 : 1;
        if (aCur !== bCur) return aCur - bCur;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return filtered.map(n => renderNoteCard(n, currentMonth)).join('');
}

function wireNotesPanel(bodyEl, notes, currentMonth) {
    const monthSel = bodyEl.querySelector('#notes-filter-month');
    const tagSel = bodyEl.querySelector('#notes-filter-tag');
    const thisMonthBtn = bodyEl.querySelector('#notes-filter-thismonth');
    const listEl = bodyEl.querySelector('#notes-list');
    if (!listEl) return;

    const refresh = () => {
        listEl.innerHTML = renderNotesListHtml(
            notes, currentMonth,
            monthSel ? monthSel.value : '',
            tagSel ? tagSel.value : ''
        );
    };
    if (monthSel) monthSel.addEventListener('change', refresh);
    if (tagSel) tagSel.addEventListener('change', refresh);
    if (thisMonthBtn) thisMonthBtn.addEventListener('click', () => {
        if (monthSel) monthSel.value = thisMonthBtn.dataset.month;
        refresh();
    });
}

// Farm Hub → "Notes": one list, filterable by month/tag, cards with an
// inline checklist. Add/Edit opens the separate #note-edit-modal.
function renderNotesPanel(titleEl, bodyEl, modalEl) {
    titleEl.textContent = t('notesTitle');

    const farm = getCurrentFarm();
    if (!farm) { bodyEl.innerHTML = `<p class="hub-panel-note">${t('notesEmpty')}</p>`; return; }

    const notes = loadNotes(farm);
    const currentMonth = getFarmCurrentMonth(farm);
    const allTags = noteAllTags(notes);

    const monthOptionsHtml = `<option value="">${t('notesAllMonths')}</option>` +
        ALL_MONTHS.map(m => `<option value="${m}">${translateMonth(m)}</option>`).join('');
    const tagOptionsHtml = `<option value="">${t('notesAllTags')}</option>` +
        allTags.map(tg => `<option value="${escapeHtml(tg)}">${escapeHtml(tg)}</option>`).join('');

    bodyEl.innerHTML = `
        <div class="notes-toolbar">
            <button type="button" class="notes-add-btn" onclick="window.openNoteEditModal(null)">${t('notesAdd')}</button>
            <select id="notes-filter-month" class="notes-filter-select">${monthOptionsHtml}</select>
            ${allTags.length ? `<select id="notes-filter-tag" class="notes-filter-select">${tagOptionsHtml}</select>` : ''}
            ${currentMonth ? `<button type="button" id="notes-filter-thismonth" class="notes-filter-thismonth-btn" data-month="${currentMonth}">${t('notesThisMonthFilter')}</button>` : ''}
        </div>
        <div id="notes-list" class="notes-list" data-empty-text="${escapeHtml(t('notesEmpty'))}">${renderNotesListHtml(notes, currentMonth, '', '')}</div>`;

    wireNotesPanel(bodyEl, notes, currentMonth);
}

window.deleteNote = function (noteId) {
    if (!confirm(t('notesDeleteConfirm'))) return;
    const farm = getCurrentFarm();
    if (!farm) return;
    saveNotes(farm, loadNotes(farm).filter(n => n.id !== noteId));
    openHubPanel('notes');
};

// Patches the DOM in place (progress count + strikethrough) instead of a full
// panel re-render, so the filter selects and scroll position aren't reset for
// what's otherwise a one-click tick.
window.toggleNoteChecklistItem = function (noteId, itemIndex, checkboxEl) {
    const farm = getCurrentFarm();
    if (!farm) return;
    const notes = loadNotes(farm);
    const note = notes.find(n => n.id === noteId);
    if (!note || !note.checklist || !note.checklist[itemIndex]) return;

    note.checklist[itemIndex].done = !!(checkboxEl && checkboxEl.checked);
    note.updatedAt = new Date().toISOString();
    saveNotes(farm, notes);

    if (checkboxEl) {
        const row = checkboxEl.closest('.note-checklist-item');
        const label = row ? row.querySelector('span') : null;
        if (label) label.classList.toggle('is-done', note.checklist[itemIndex].done);
        const card = checkboxEl.closest('.note-card');
        const progress = card ? card.querySelector('.note-checklist-progress') : null;
        if (progress) progress.textContent = `${note.checklist.filter(c => c.done).length}/${note.checklist.length}`;
    }
};

// --- Note add/edit modal ---
// noteEditState holds the tags/checklist being edited (not yet saved) — the
// two dynamic, add/remove-able lists in the form. Title/body/months are read
// straight from their inputs at save time, no intermediate state needed.
let noteEditState = null;

function renderNoteEditTags() {
    const el = document.getElementById('note-edit-tags');
    if (!el || !noteEditState) return;
    el.innerHTML = noteEditState.tags.map((tg, idx) => `
        <span class="note-tag-chip" style="--tag-color:${noteTagColor(tg)}">${escapeHtml(tg)}
            <button type="button" class="note-tag-chip-remove" data-idx="${idx}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </span>`).join('');
    el.querySelectorAll('.note-tag-chip-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            noteEditState.tags.splice(Number(btn.dataset.idx), 1);
            renderNoteEditTags();
        });
    });
}

// Rebuilds noteEditState.checklist from the live inputs first, so an add/remove
// elsewhere in the list never discards text the user already typed in a row.
function syncChecklistStateFromDom() {
    if (!noteEditState) return;
    const rows = document.querySelectorAll('#note-edit-checklist .note-edit-checklist-row');
    noteEditState.checklist = Array.from(rows).map(row => ({
        text: row.querySelector('.note-edit-checklist-text').value,
        done: row.querySelector('.note-edit-checklist-done').checked
    }));
}

function renderNoteEditChecklist() {
    const el = document.getElementById('note-edit-checklist');
    if (!el || !noteEditState) return;
    el.innerHTML = noteEditState.checklist.map((item, idx) => `
        <div class="note-edit-checklist-row" data-idx="${idx}">
            <input type="checkbox" class="note-edit-checklist-done" ${item.done ? 'checked' : ''}>
            <input type="text" class="note-edit-checklist-text" value="${escapeHtml(item.text)}" placeholder="${escapeHtml(t('notesChecklistItemPlaceholder'))}">
            <button type="button" class="note-edit-checklist-remove" data-idx="${idx}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>`).join('');
    el.querySelectorAll('.note-edit-checklist-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            syncChecklistStateFromDom();
            noteEditState.checklist.splice(Number(btn.dataset.idx), 1);
            renderNoteEditChecklist();
        });
    });
}

window.openNoteEditModal = function (noteId) {
    const farm = getCurrentFarm();
    if (!farm) return;
    const existing = noteId ? loadNotes(farm).find(n => n.id === noteId) : null;

    noteEditState = {
        id: existing ? existing.id : null,
        tags: existing ? (existing.tags || []).slice() : [],
        checklist: existing ? (existing.checklist || []).map(c => ({ text: c.text || '', done: !!c.done })) : []
    };

    const titleEl = document.getElementById('note-edit-modal-title');
    if (titleEl) titleEl.textContent = existing ? t('notesEditTitle') : t('notesNewTitle');

    const titleInput = document.getElementById('note-edit-title');
    if (titleInput) titleInput.value = existing ? (existing.title || '') : '';
    const bodyInput = document.getElementById('note-edit-body');
    if (bodyInput) bodyInput.value = existing ? (existing.body || '') : '';

    const existingMonths = existing ? (existing.months || []) : [];
    const monthsEl = document.getElementById('note-edit-months');
    if (monthsEl) {
        monthsEl.innerHTML = ALL_MONTHS.map(m => `
            <label class="note-edit-month-option">
                <input type="checkbox" value="${m}" ${existingMonths.includes(m) ? 'checked' : ''}>
                <span>${translateMonth(m)}</span>
            </label>`).join('');
    }

    const tagInput = document.getElementById('note-edit-tag-input');
    if (tagInput) tagInput.value = '';

    renderNoteEditTags();
    renderNoteEditChecklist();

    const modal = document.getElementById('note-edit-modal');
    if (modal) modal.style.display = 'flex';
};

function closeNoteEditModal() {
    const modal = document.getElementById('note-edit-modal');
    if (modal) modal.style.display = 'none';
    noteEditState = null;
    openHubPanel('notes');
}

const noteEditTagInput = document.getElementById('note-edit-tag-input');
if (noteEditTagInput) {
    noteEditTagInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const val = noteEditTagInput.value.trim();
        if (val && noteEditState && !noteEditState.tags.includes(val)) {
            noteEditState.tags.push(val);
            renderNoteEditTags();
        }
        noteEditTagInput.value = '';
    });
}

const noteEditAddItemBtn = document.getElementById('note-edit-add-item-btn');
if (noteEditAddItemBtn) {
    noteEditAddItemBtn.addEventListener('click', () => {
        if (!noteEditState) return;
        syncChecklistStateFromDom();
        noteEditState.checklist.push({ text: '', done: false });
        renderNoteEditChecklist();
        const inputs = document.querySelectorAll('#note-edit-checklist .note-edit-checklist-text');
        if (inputs.length) inputs[inputs.length - 1].focus();
    });
}

const noteEditCancelBtn = document.getElementById('note-edit-cancel-btn');
if (noteEditCancelBtn) noteEditCancelBtn.addEventListener('click', closeNoteEditModal);

const noteEditSaveBtn = document.getElementById('note-edit-save-btn');
if (noteEditSaveBtn) {
    noteEditSaveBtn.addEventListener('click', () => {
        const farm = getCurrentFarm();
        if (!farm || !noteEditState) return;

        const titleInput = document.getElementById('note-edit-title');
        const title = (titleInput ? titleInput.value : '').trim();
        if (!title) { alert(t('notesNoTitle')); return; }

        const bodyInput = document.getElementById('note-edit-body');
        const body = (bodyInput ? bodyInput.value : '').trim();

        const months = Array.from(document.querySelectorAll('#note-edit-months input[type="checkbox"]:checked')).map(cb => cb.value);

        syncChecklistStateFromDom();
        const checklist = noteEditState.checklist
            .map(c => ({ text: (c.text || '').trim(), done: !!c.done }))
            .filter(c => c.text);

        const notes = loadNotes(farm);
        const now = new Date().toISOString();

        if (noteEditState.id) {
            const note = notes.find(n => n.id === noteEditState.id);
            if (note) {
                note.title = title;
                note.body = body;
                note.months = months;
                note.tags = noteEditState.tags.slice();
                note.checklist = checklist;
                note.updatedAt = now;
            }
        } else {
            notes.push({
                id: generateNoteId(),
                title, body, months,
                tags: noteEditState.tags.slice(),
                checklist,
                createdAt: now,
                updatedAt: now
            });
        }

        saveNotes(farm, notes);
        closeNoteEditModal();
    });
}

// =============================================================
// SECTION 3: GLOBAL VARIABLES
// =============================================================
let currentFarmId = null;
let farmIdToDelete = null;
let deleteMode = false;
let isEditMode = false;
let viewedSeason = 1;

// Active farm's map data (a different FS25 map per farm). Populated by
// loadFarmConfigs() on openPlanner, emptied by clearFarmConfigs() on exit.
let CROP_CALENDAR = {};
let AVAILABLE_CROPS = [];
// The game's crop menu order: the map's own fruitTypes list when the map mod
// ships one (read by map-crops.js), else the base game's.
let CROP_ORDER = [];
// Last readMapCrops() result for the open farm (shown in Settings).
let mapCropsInfo = null;
// Animal mods active in the open farm's savegame (readAnimalMods), or null.
let ANIMAL_MODS = null;
// Land plot areas for the open farm (Settings toggle) — see readFarmlandAreas.
let FARMLAND_INFO = null;

// data/maps/maps_fruitTypes.xml order (base FS25), crop keys as formatCropName
// produces them — the crops every map has unless it replaces the base list.
// (Meadow is added per map, e.g. by the base US map's own list.)
const BASE_CROP_ORDER = [
    "Wheat", "Barley", "Canola", "Oat", "Maize", "Sunflower", "Soybean", "Potato",
    "Rice", "Ricelonggrain", "Sugarbeet", "Sugarcane", "Cotton", "Sorghum", "Grape",
    "Olive", "Poplar", "Beetroot", "Carrot", "Parsnip", "Greenbean", "Pea", "Spinach",
    "Grass", "Oilseedradish"
];

function cropOrderKey(name) {
    return String(name || '').replace(/[_\s]+/g, '').toUpperCase();
}

function compareCropsGameOrder(a, b) {
    const keys = CROP_ORDER.map(cropOrderKey);
    const ia = keys.indexOf(cropOrderKey(a)), ib = keys.indexOf(cropOrderKey(b));
    if (ia !== ib) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || 0;
    return String(a).localeCompare(String(b));
}

// Base-game FS25 crop calendar (sow month -> harvest month), generated from
// the vanilla data/foliage/*.xml growth definitions — see
// tools/generate-default-crops.js. Loaded once so every farm has
// the standard crops available even before/without importing a map's own
// XML folder, since not every map ships XML overrides for crops it doesn't
// customize. A farm's own crops_config.json (imported map data) is merged
// on top of this in loadFarmConfigs(), overriding per-crop where present.
let DEFAULT_CROPS = {};
try {
    DEFAULT_CROPS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'default-crops.json'), 'utf-8')) || {};
} catch (e) {
    console.error('Could not load default-crops.json — base crops will be unavailable until a map is imported', e);
}

// Base-game FS25 animal needs/production (food/water/straw + milk/egg/wool
// curves by age), generated from the game's own animals.xml data — see
// tools/generate-default-animals.js. Loaded once so every breed's
// daily needs/production are known even before/without importing a map's
// own animal-defs XML folder. A farm's own animal_needs_config.json
// (imported map data) is merged on top of this in loadFarmConfigs(),
// overriding per-subType where present.
let DEFAULT_ANIMALS = {};
try {
    DEFAULT_ANIMALS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'default-animals.json'), 'utf-8')) || {};
} catch (e) {
    console.error('Could not load default-animals.json — base animal needs will be unavailable until a map is imported', e);
}
// Legacy — kept only so an old app-wide config can still be migrated; the
// crop calendar / animal-needs paths and source labels are per-farm now
// (farm.cropsSourceLabel / farm.animalDefsSourceLabel in data.json).

// --- Season supply calculator ("shopping list") -----------------------------
// Everything here is an editable estimate. Units match how Precision Farming
// meters inputs on the field: seed and lime in litres per hectare, fertilizer
// as kilograms of nitrogen (N) per hectare for a full season at high yield.
// The person overrides any value in the Supplies hub panel; overrides live in
// localStorage and are merged over these tables.
const CONFIG_KEY_SUPPLY_RATES = 'farmer_planner_supply_rates';

// Litres of seed per hectare, keyed by the crop keys used in crops.json /
// field.crop. Anything unlisted falls back to SUPPLY_SEED_FALLBACK.
// Values scanned from the FS25 Solek map's foliage XMLs (seeding/@litersPerSqm
// x 10000) — see tools/scan-solek-agronomy.py / tools/SOLEK_agronomy.json.
// A different map may use different rates; override per crop in the panel.
// For crops in SUPPLY_SEED_RATES_PF below, Precision Farming replaces the
// foliage rate in-game, so the value here is PF's "standard" rate — only
// shown as the drawer placeholder; per-field numbers come from fieldSeedRate.
const SUPPLY_SEED_RATES = {
    Wheat: 308, Barley: 265, Oat: 340, Rye: 500, Triticale: 500, Greenrye: 300,
    Canola: 49, Sunflower: 143, Soybean: 214, Maize: 53, Silagemaize: 56, Sorghum: 35,
    Millet: 500, Buckwheat: 500, Pea: 250, Beans: 500, Greenbean: 280,
    Potato: 3733, Beetroot: 40, Sugarbeet: 34, Carrot: 10, Parsnip: 10, Spinach: 10, Cotton: 50,
    Grass: 120, Alfalfa: 500, Clover: 500, Oilseedradish: 40
};
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
// rate reaching the best <soilType yields>). Source: FS25 Solek
// map/mapUS.xml <precisionFarming><seedRateMap> (Rye, Triticale, Alfalfa,
// Clover, Buckwheat, Greenrye, Silagemaize, Beans, Millet), the rest from
// FS25_precisionFarming PrecisionFarming.xml <seedRateMap> (usages x 10000).
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
    Oilseedradish: { lha: [30, 40, 50], auto: { loamySand: 0, sandyLoam: 0, loam: 0, siltyClay: 0 } },
    Rye: { lha: [300, 500, 700], auto: PF_AUTO_STD },
    Triticale: { lha: [300, 500, 700], auto: PF_AUTO_STD },
    Alfalfa: { lha: [300, 500, 700], auto: PF_AUTO_STD },
    Clover: { lha: [300, 500, 700], auto: PF_AUTO_STD },
    Buckwheat: { lha: [300, 500, 700], auto: PF_AUTO_STD },
    Beans: { lha: [300, 500, 700], auto: PF_AUTO_STD },
    Millet: { lha: [300, 500, 700], auto: PF_AUTO_STD },
    Greenrye: { lha: [200, 300, 400], auto: { loamySand: 0, sandyLoam: 1, loam: 1, siltyClay: 2 } },
    Silagemaize: { lha: [45, 56, 67], auto: { loamySand: 0, sandyLoam: 1, loam: 2, siltyClay: 2 } }
};

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
// used by the "Przewidywane plony" (Predicted yields) panel. Same source/
// convention as SUPPLY_SEED_RATES above: scanned from the FS25 Solek map's
// growth definitions (harvestLitersPerHa) — see tools/SOLEK_agronomy.json.
// Deliberately no fallback constant for an unlisted crop (unlike the seed/N
// tables) — there's no sane universal yield guess, so callers should show
// "unknown" rather than a made-up number.
const CROP_YIELD_L_PER_HA = {
    Wheat: 6400, Barley: 6800, Oat: 7000, Rye: 5200, Triticale: 6800, Greenrye: 8900,
    Canola: 4000, Sunflower: 5200, Soybean: 4500, Maize: 9200, Silagemaize: 9200, Sorghum: 8200,
    Millet: 4500, Buckwheat: 3000, Pea: 9600, Beans: 3500, Greenbean: 6975,
    Potato: 41300, Beetroot: 57800, Sugarbeet: 57800, Carrot: 77000, Parsnip: 69500,
    Spinach: 23100, Cotton: 4970, Grass: 43700, Alfalfa: 43700, Clover: 43700, Oilseedradish: 9900
};
function getCropYieldRate(crop) {
    return CROP_YIELD_L_PER_HA[crop] !== undefined ? CROP_YIELD_L_PER_HA[crop] : null;
}

// --- Nitrogen by soil type (Precision Farming) ------------------------------
// The real per-crop N figure depends on the field's soil. nitrogen-by-soil.json
// (shipped next to the app, user-editable) holds a kg N/ha value for every
// crop x soil-type pair plus a fallback row for crops it doesn't list. If the
// file is missing or malformed we fall back to this built-in table so the
// panel still works.
// Soil types + yieldPct come from FS25 Precision Farming (PrecisionFarming.xml
// <soilTypes> yieldPotential). The N numbers in nitrogen-by-soil.json are that
// mod's <fruitRequirements> targetLevel; this built-in copy is only the safety
// net if the JSON file is unreadable.
const NITROGEN_BY_SOIL_FALLBACK = {
    soilTypes: [
        { id: 'loamySand', pl: 'Piasek ilasty', en: 'Loamy Sand', yieldPct: 80 },
        { id: 'sandyLoam', pl: 'Piaszczysty ił', en: 'Sandy Loam', yieldPct: 100 },
        { id: 'loam', pl: 'Ił', en: 'Loam', yieldPct: 125 },
        { id: 'siltyClay', pl: 'Ił pylasty', en: 'Silty Clay', yieldPct: 90 }
    ],
    fallback: { loamySand: 100, sandyLoam: 120, loam: 150, siltyClay: 130 },
    crops: {}
};

let NITROGEN_BY_SOIL = NITROGEN_BY_SOIL_FALLBACK;
try {
    const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'nitrogen-by-soil.json'), 'utf-8'));
    NITROGEN_BY_SOIL = {
        soilTypes: (parsed.soilTypes && parsed.soilTypes.length) ? parsed.soilTypes : NITROGEN_BY_SOIL_FALLBACK.soilTypes,
        fallback: parsed.fallback || NITROGEN_BY_SOIL_FALLBACK.fallback,
        crops: parsed.crops || {}
    };
} catch (e) {
    console.error('Could not load nitrogen-by-soil.json — using built-in fallback', e);
}

function soilTypeList() { return NITROGEN_BY_SOIL.soilTypes || []; }

function soilLabel(s) {
    if (!s) return '';
    if (typeof s === 'string') s = soilTypeList().find(x => x.id === s) || { id: s, pl: s, en: s };
    return (currentLang === 'pl' ? s.pl : s.en) || s.en || s.pl || s.id;
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
    const pf = SUPPLY_SEED_RATES_PF[crop];
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

// --- Lime by soil type (Precision Farming) --------------------------------
// FS25 PrecisionFarming.xml <pHMap>: soil pH decays a FIXED amount per harvest
// per soil type (it does NOT depend on the crop), and <limeUsage
// usagePerState="730"/> means 730 l/ha raises pH by one 0.125 step. A lime
// application in this app is meant to last ~3 seasons (getLimeStatus warns from
// the 3rd), so each field's application is sized to 3 harvests of decay:
//   loamySand / sandyLoam : -0.125 pH/harvest -> 3 x 730  = 2190 l/ha
//   loam / siltyClay      : -0.250 pH/harvest -> 3 x 1460 = 4380 l/ha
// A flat "Lime application" rate in the Adjust panel overrides the whole thing.
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
    mode: 'pf',              // 'pf' = nitrogen in kg N; 'basic' = plain litres/ha
    bufferPct: 5,            // reserve added on top of every total
    limeRate: '',            // flat l/ha of lime per application; blank => per-soil (fieldLimeRate)
    nDensity: 0.22,          // kg of N per litre of the fertilizer you buy (PF)
    basicFertRate: 400,      // litres/ha of generic fertilizer when mode = basic
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
                saveFarmData(farm);
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
        saveFarmData(farm);
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
    return SUPPLY_SEED_RATES[crop] !== undefined ? SUPPLY_SEED_RATES[crop] : null;
}
function getCropNRate(crop, rates) {
    const o = rates.crops[crop];
    if (o && o.n !== undefined && o.n !== '' && !isNaN(o.n)) return parseFloat(o.n);
    return SUPPLY_N_RATES[crop] !== undefined ? SUPPLY_N_RATES[crop] : null;
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
        const eligible = hasCrop && (rates.assumeAllFertilized || f.fertilizer);
        if (!eligible) return;

        const soilKey = fertPlanSoilKey(f, i);
        const planKey = fertPlanKey(f, i);
        const saved = rates.fertPlan && rates.fertPlan[planKey];
        const hasPlan = !!(saved && ((parseFloat(saved.existingN) > 0) || (parseFloat(saved.orgN) > 0)));

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

// "Przewidywane plony" (Predicted yields) panel data: every field with a crop
// assigned this season — planted or still just planned ("To Plant"), any
// sowing month — aggregated per crop across all matching fields. Predicted
// litres assumes ideal N, ideal pH and no weeds (i.e. just the crop's
// full-potential yield scaled by the field's soil-mix yield potential — see
// fieldYieldFactor above) since those are the only levers this app models;
// a crop with no known yield rate taints its whole aggregated row rather
// than silently under-counting one field.
function buildYieldForecastRows(farm, rates) {
    const fields = (farm && farm.fields) || [];
    const byCrop = new Map();
    fields.forEach((f, i) => {
        const area = parseFloat(f.area) || 0;
        if (area <= 0) return;
        const soilMix = getFieldSoilMix(fertPlanSoilKey(f, i), rates);
        // Main crop and catch crop are two harvests off the same hectares.
        [f.crop, f.catchCrop].filter(Boolean).forEach(crop => {
            const rate = getCropYieldRate(crop);
            const known = rate !== null;
            const litres = known ? area * rate * fieldYieldFactor(soilMix) : 0;

            const entry = byCrop.get(crop) || { crop, area: 0, litres: 0, known: true };
            entry.area += area;
            entry.litres += litres;
            if (!known) entry.known = false;
            byCrop.set(crop, entry);
        });
    });
    const rows = [...byCrop.values()].sort((a, b) => b.litres - a.litres);
    return {
        rows,
        total: rows.reduce((s, r) => s + r.litres, 0),
        missingCount: rows.filter(r => !r.known).length
    };
}

// Shared tail for both supply calculators (manual fields + savegame): turns the
// per-field list into seed / fertilizer / lime rows + buffered totals.
// In PF mode each fertilizer row's rate is the soil-mix-weighted kg N/ha for
// that field's crop; in basic mode it's the flat litres/ha rate.
function finalizeSupplies(cropFields, extra, rates) {
    const buffer = 1 + (parseFloat(rates.bufferPct) || 0) / 100;
    const pf = rates.mode === 'pf';
    const basicRate = parseFloat(rates.basicFertRate) || 0;
    const flatLimeRate = parseFloat(rates.limeRate) || 0;   // >0 => flat override on every field

    const seedRows = [];
    const fertRows = [];
    const orgPlanRows = [];
    const limeRows = [];
    let plannedArea = 0;
    let fieldsToSow = 0;
    let limeArea = 0;

    cropFields.forEach(f => {
        if (f.crop && f.area > 0) plannedArea += f.area;

        if (f.sow) {
            fieldsToSow++;
            const rate = fieldSeedRate(f.crop, getFieldSoilMix(f.key, rates), rates);
            const known = rate !== null;
            const r = known ? rate : SUPPLY_SEED_FALLBACK;
            const need = f.area * r;
            seedRows.push({ key: f.key, number: f.number, crop: f.crop, area: f.area, rate: r, known, need, buffered: need * buffer });
        }

        if (f.fertilize) {
            const factor = f.fertFactor != null ? f.fertFactor : 1;
            const soilMix = getFieldSoilMix(f.key, rates);
            // A field's own fertilization plan (existing-N / natural-N already
            // entered) overrides the flat "whole target still unmet" guess with
            // the actual remaining mineral need.
            const rate = f.planMineralRate != null ? f.planMineralRate : (pf ? fieldNRate(f.crop, soilMix, rates) : basicRate);
            const need = f.area * rate * factor;
            fertRows.push({ key: f.key, number: f.number, crop: f.crop, area: f.area, soilMix, rate, factor, need, buffered: need * buffer, planned: !!f.planned });

            if (f.planOrgRate > 0) {
                const orgNeed = f.area * f.planOrgRate * factor;
                orgPlanRows.push({ key: f.key, number: f.number, crop: f.crop, area: f.area, soilMix, rate: f.planOrgRate, need: orgNeed, buffered: orgNeed * buffer });
            }
        }

        if (f.limeDue) {
            limeArea += f.area;
            const soilMix = getFieldSoilMix(f.key, rates);
            const rate = flatLimeRate > 0 ? flatLimeRate : fieldLimeRate(soilMix);   // l/ha
            const need = f.area * rate;
            limeRows.push({ key: f.key, number: f.number, crop: f.crop, area: f.area, soilMix, rate, need, buffered: need * buffer });
        }
    });

    return {
        season: extra.season,
        plannedArea, fieldsToSow,
        source: extra.source || 'manual',
        savedFieldCount: extra.savedFieldCount || 0,
        savedAreaHa: extra.savedAreaHa || 0,
        skippedNoArea: extra.skippedNoArea || 0,
        seedRows, seedTotal: seedRows.reduce((s, r) => s + r.buffered, 0),
        fertRows, fertTotal: fertRows.reduce((s, r) => s + r.buffered, 0),
        orgPlanRows, orgPlanTotal: orgPlanRows.reduce((s, r) => s + r.buffered, 0),
        limeRows, limeArea, limeTotal: limeRows.reduce((s, r) => s + r.buffered, 0),
        limeFields: limeRows.map(r => r.number).filter(Boolean),
        hasAnything: seedRows.length > 0 || fertRows.length > 0 || limeRows.length > 0
    };
}

// Maps a savegame fruit token ("WHEAT", "SUGARBEET", "OILSEEDRADISH") to the
// crop key the rest of the app uses. FALLOW / UNKNOWN mean "nothing planned".
function saveFruitToCropKey(raw) {
    if (!raw || raw === 'FALLOW' || raw === 'UNKNOWN') return null;
    const collapsed = raw.replace(/[_\s]+/g, '').toUpperCase();
    const hit = AVAILABLE_CROPS.find(c => c.replace(/[_\s]+/g, '').toUpperCase() === collapsed);
    return hit || formatCropName(raw);
}

// Reads the player's owned fields straight from the savegame folder:
//   farmland.xml            -> which farmlandIds belong to farm 1
//   precisionFarming.xml    -> real field area (m², from the <tillage> block)
//   fields.xml             -> planned crop + current spray/lime level per field
// Returns { ok, fields:[...], hasArea } — everything the "from savegame"
// branch of the supply calculator needs. Fails quietly (ok:false) so the panel
// can fall back to the manually entered fields.
function readSaveFields(farm) {
    if (!farm || !farm.saveGamePath) return { ok: false, reason: 'nopath' };
    const dir = path.dirname(farm.saveGamePath);
    const fieldsPath = path.join(dir, 'fields.xml');
    const farmlandPath = path.join(dir, 'farmland.xml');
    if (!fs.existsSync(fieldsPath) || !fs.existsSync(farmlandPath)) return { ok: false, reason: 'nofiles' };

    try {
        const flText = fs.readFileSync(farmlandPath, 'utf-8');
        const owned = new Set();
        for (const m of flText.matchAll(/<farmland\s+id="(\d+)"\s+farmId="(\d+)"/g)) {
            if (m[2] === '1') owned.add(m[1]);
        }

        const areaById = {};
        const pfPath = path.join(dir, 'precisionFarming.xml');
        if (fs.existsSync(pfPath)) {
            const pfText = fs.readFileSync(pfPath, 'utf-8');
            const till = (pfText.match(/<tillage>[\s\S]*?<\/tillage>/) || [''])[0];
            for (const m of till.matchAll(/farmlandId="(\d+)"[^>]*?totalFieldArea="([\d.]+)"/g)) {
                areaById[m[1]] = parseFloat(m[2]) / 10000;   // m² -> ha
            }
        }

        const fxText = fs.readFileSync(fieldsPath, 'utf-8');
        const attrOf = (tag, name) => { const mm = tag.match(new RegExp(name + '="([^"]*)"')); return mm ? mm[1] : ''; };
        const out = [];
        for (const m of fxText.matchAll(/<field\s+id="(\d+)"[^>]*\/>/g)) {
            const id = m[1];
            if (!owned.has(id)) continue;
            const tag = m[0];
            const fruitType = attrOf(tag, 'fruitType');
            const growthState = parseInt(attrOf(tag, 'growthState')) || 0;
            out.push({
                id,
                areaHa: areaById[id] != null ? areaById[id] : null,
                plannedFruit: attrOf(tag, 'plannedFruit'),
                fruitType,
                growthState,
                sown: fruitType !== 'UNKNOWN' && fruitType !== '' && fruitType !== 'FALLOW' && growthState > 0,
                sprayLevel: parseInt(attrOf(tag, 'sprayLevel')) || 0,
                limeLevel: parseInt(attrOf(tag, 'limeLevel')) || 0
            });
        }
        return { ok: true, fields: out, hasArea: Object.keys(areaById).length > 0 };
    } catch (e) {
        console.error('readSaveFields failed', e);
        return { ok: false, reason: 'parse' };
    }
}

// Same output shape as computeSeasonSupplies, but sourced from the savegame.
// "Buy" is the REMAINING need: seed only for unsown fields, fertilizer scaled
// by how far each field's sprayLevel still is from full, lime only where the
// field currently has none.
function computeSeasonSuppliesFromSave(farm, rates, save) {
    const SPRAY_MAX = 2;   // fields.xml buckets fertilization into 0..2
    let savedAreaHa = 0, skippedNoArea = 0;

    const cropFields = [];
    save.fields.forEach(f => {
        const crop = saveFruitToCropKey(f.plannedFruit) || saveFruitToCropKey(f.fruitType);
        const limeDue = f.limeLevel < 1;
        if (!crop && !limeDue) return;
        if (f.areaHa == null) { if (crop) skippedNoArea++; return; }

        const area = f.areaHa;
        if (crop) savedAreaHa += area;
        const remFrac = Math.max(0, (SPRAY_MAX - f.sprayLevel) / SPRAY_MAX);

        cropFields.push({
            key: String(f.id),
            number: '#' + f.id,
            crop: crop || '', area,
            sow: !!crop && !f.sown,
            fertilize: !!crop && remFrac > 0,
            fertFactor: remFrac,
            limeDue
        });
    });

    return finalizeSupplies(cropFields, {
        season: (farm && farm.currentSeason) || 1,
        source: 'save',
        savedFieldCount: save.fields.length - skippedNoArea,
        savedAreaHa, skippedNoArea
    }, rates);
}

let ANIMAL_NEEDS_DATA = {};

const ALL_MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

// The 12 in-game growth periods, in order, and the real-world month each one
// corresponds to. Used both to read the current in-game month from
// environment.xml and to simulate crop growth from fruitType XML files.
const FS_PERIODS = ["EARLY_SPRING", "MID_SPRING", "LATE_SPRING", "EARLY_SUMMER", "MID_SUMMER", "LATE_SUMMER", "EARLY_AUTUMN", "MID_AUTUMN", "LATE_AUTUMN", "EARLY_WINTER", "MID_WINTER", "LATE_WINTER"];
const FS_PERIOD_TO_MONTH = ["MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER", "JANUARY", "FEBRUARY"];

// =============================================================
// SECTION 4: FILE SYSTEM & DATA HELPERS
// =============================================================
// Folders used to be named after a sanitized version of the farm's display
// name. That breaks silently for names with Polish diacritics (ą, ć, ę, ł,
// ń, ó, ś, ź, ż) — Windows can end up with a byte-level Unicode
// normalization mismatch between what's stored in data.json and what's
// actually on disk, so fs.existsSync/fs.rmSync stop reliably matching the
// real folder even though it "looks" identical everywhere you check it.
// Folders are now always named after the farm's own id (a plain numeric
// timestamp string — always ASCII, always stable). The display name in the
// UI is completely free-form and never touches the filesystem.
function migrateFarmFolderToId(oldFolderName, farmData) {
    if (!farmData.id || farmData.folderName === farmData.id) return farmData;

    const oldPath = path.join(appDataDir, oldFolderName);
    const newPath = path.join(appDataDir, farmData.id);

    if (fs.existsSync(newPath)) {
        // Extremely unlikely id collision — don't risk data loss, just keep going on the old folder.
        console.error('Folder migration skipped: target already exists for', farmData.id);
        return farmData;
    }

    try {
        fs.renameSync(oldPath, newPath);
        farmData.folderName = farmData.id;
        fs.writeFileSync(path.join(newPath, 'data.json'), JSON.stringify(farmData, null, 2), 'utf-8');
        console.log('Migrated farm folder "' + oldFolderName + '" -> "' + farmData.id + '"');
    } catch (err) {
        console.error('Folder migration failed for', oldFolderName, err);
        // Keep the old folderName so the rest of the app still finds the farm.
    }

    return farmData;
}

function getAllFarms() {
    const farms = [];
    if (!fs.existsSync(appDataDir)) return farms;

    const folders = fs.readdirSync(appDataDir);
    folders.forEach(folder => {
        try {
            const folderPath = path.join(appDataDir, folder);
            if (fs.statSync(folderPath).isDirectory()) {
                const jsonPath = path.join(folderPath, 'data.json');
                if (fs.existsSync(jsonPath)) {
                    const content = fs.readFileSync(jsonPath, 'utf-8');
                    if (content.trim() !== "") {
                        let data = JSON.parse(content);
                        if (data.id && data.folderName !== data.id) {
                            data = migrateFarmFolderToId(folder, data);
                        }
                        farms.push(data);
                    }
                }
            }
        } catch (e) {
            console.error(`Błąd odczytu pliku w folderze: ${folder}. Plik jest uszkodzony.`);
        }
    });
    return farms;
}

function saveFarmData(farmData) {
    if (!farmData.folderName) return;
    const filePath = path.join(appDataDir, farmData.folderName, 'data.json');

    farmData.lastEdited = new Date().toLocaleString();

    try { fs.writeFileSync(filePath, JSON.stringify(farmData, null, 2), 'utf-8'); }
    catch (err) { alert("Error saving data!"); }
}

// Absolute path to a farm's own data folder (named after its id).
function farmDir(farm) {
    return path.join(appDataDir, farm.folderName || farm.id);
}

function getCurrentFarm() {
    return getAllFarms().find(f => f.id === currentFarmId) || null;
}

// Crop calendar + animal-needs are per-farm now: each farm can be a different
// FS25 map, so its map data lives in the farm's own folder. loadFarmConfigs
// runs when a farm is opened; clearFarmConfigs when you return to the dashboard.
function loadFarmConfigs(farm) {
    // Base FS25 crops are always available; a farm's own imported map data
    // (if any) is merged on top below, per-crop, so it extends/overrides the
    // defaults instead of replacing the whole list.
    CROP_CALENDAR = JSON.parse(JSON.stringify(DEFAULT_CROPS));
    CROP_ORDER = [...BASE_CROP_ORDER];
    mapCropsInfo = null;
    ANIMAL_MODS = null;
    // Same pattern as crops: base FS25 animal needs/production are always
    // available; a farm's own imported animal-defs data is merged on top
    // below, per subType.
    ANIMAL_NEEDS_DATA = JSON.parse(JSON.stringify(DEFAULT_ANIMALS));
    if (!farm) { AVAILABLE_CROPS = sortedAvailableCrops(null); return; }

    // The map mod's own crop list (if the savegame points at a mod map):
    // decides which crops exist on this farm and their menu order.
    let mapCropNames = null;
    if (farm.saveGamePath) {
        const res = readMapCrops(farm.saveGamePath, parseCropGrowthXml, formatCropName);
        mapCropsInfo = res;
        if (res.ok) {
            // Base crops first (a re-declared base crop keeps its slot), then
            // the map's new ones in its own order — the game's menu order.
            const mapNames = res.crops.map(c => c.name);
            const baseKeys = BASE_CROP_ORDER.map(cropOrderKey);
            mapCropNames = res.replacesBase
                ? mapNames
                : [...BASE_CROP_ORDER, ...mapNames.filter(n => !baseKeys.includes(cropOrderKey(n)))];
            CROP_ORDER = [...mapCropNames];
            res.crops.forEach(c => {
                if (c.calendar) CROP_CALENDAR[c.name] = { ...(CROP_CALENDAR[c.name] || {}), ...c.calendar };
            });
        }
    }

    const dir = farmDir(farm);
    const cropsPath = path.join(dir, 'crops_config.json');
    const animalsPath = path.join(dir, 'animal_needs_config.json');

    // One-time migration: installs from before per-farm map data had a single
    // app-wide config. Adopt it for any farm that has none of its own yet.
    try {
        const legacyCrops = path.join(appDataDir, 'crops_config.json');
        if (!fs.existsSync(cropsPath) && fs.existsSync(legacyCrops)) fs.copyFileSync(legacyCrops, cropsPath);
        const legacyAnimals = path.join(appDataDir, 'animal_needs_config.json');
        if (!fs.existsSync(animalsPath) && fs.existsSync(legacyAnimals)) fs.copyFileSync(legacyAnimals, animalsPath);
    } catch (e) { console.error('Per-farm config migration failed', e); }

    refreshAnimalDefsFromSource(farm, animalsPath);

    try {
        if (fs.existsSync(cropsPath)) {
            const imported = JSON.parse(fs.readFileSync(cropsPath, 'utf-8')) || {};
            Object.keys(imported).forEach(cropName => {
                CROP_CALENDAR[cropName] = { ...(CROP_CALENDAR[cropName] || {}), ...imported[cropName] };
                // A manually imported crop is on the map even if the mod's
                // list couldn't be read or doesn't name it.
                if (mapCropNames && !mapCropNames.some(n => cropOrderKey(n) === cropOrderKey(cropName))) mapCropNames.push(cropName);
            });
        }
    } catch (e) { console.error('Bad crops_config.json for farm', farm.id, e); }
    AVAILABLE_CROPS = sortedAvailableCrops(mapCropNames);

    try {
        if (fs.existsSync(animalsPath)) {
            const importedAnimals = JSON.parse(fs.readFileSync(animalsPath, 'utf-8')) || {};
            Object.keys(importedAnimals).forEach(subType => {
                ANIMAL_NEEDS_DATA[subType] = { ...(ANIMAL_NEEDS_DATA[subType] || {}), ...importedAnimals[subType] };
            });
        }
    } catch (e) { console.error('Bad animal_needs_config.json for farm', farm.id, e); }

    // AnimalFoodCalculator's reference source decides whose food/water/straw
    // curves the barns actually follow.
    ANIMAL_MODS = farm.saveGamePath ? readAnimalMods(farm.saveGamePath) : null;
    if (afcActive(farm)) {
        const INPUTS = ['food', 'water', 'straw'];
        const applyInputs = (subType, src) => {
            if (!ANIMAL_NEEDS_DATA[subType] && !src) return;
            const next = { ...(ANIMAL_NEEDS_DATA[subType] || {}) };
            INPUTS.forEach(k => { if (src && src[k] && src[k].length) next[k] = src[k]; });
            ANIMAL_NEEDS_DATA[subType] = next;
        };
        const afc = ANIMAL_MODS.afc;
        if (afc.referenceSource === 'basegame') {
            Object.keys(DEFAULT_ANIMALS).forEach(st => applyInputs(st, DEFAULT_ANIMALS[st]));
        }
        afc.referenceXml.forEach(xml => {
            const parsed = parseAnimalNeedsXml(xml);
            if (parsed) Object.keys(parsed).forEach(st => applyInputs(st, parsed[st]));
        });
    }
}

// Crop keys the planner offers: the map's list when known (only those with a
// sowing calendar — a crop you can't sow isn't plannable), else every crop in
// the calendar. Always in game order.
function sortedAvailableCrops(mapCropNames) {
    const calendarKey = new Map(Object.keys(CROP_CALENDAR).map(k => [cropOrderKey(k), k]));
    let names;
    if (mapCropNames) {
        names = mapCropNames.map(n => calendarKey.get(cropOrderKey(n))).filter(Boolean);
    } else {
        names = Object.keys(CROP_CALENDAR);
    }
    return [...new Set(names)].sort(compareCropsGameOrder);
}

function clearFarmConfigs() {
    CROP_CALENDAR = {};
    AVAILABLE_CROPS = [];
    CROP_ORDER = [];
    mapCropsInfo = null;
    ANIMAL_MODS = null;
    ANIMAL_NEEDS_DATA = {};
}

// XML files under a folder whose name mentions animals — the fallback for
// farms imported before the source files were remembered. Depth-limited so
// pointing it at a whole game install stays quick.
function findAnimalXmlFiles(dir, depth = 0, out = []) {
    if (depth > 6) return out;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    entries.forEach(e => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) findAnimalXmlFiles(full, depth + 1, out);
        else if (/animal.*\.xml$/i.test(e.name)) out.push(full);
    });
    return out;
}

// Re-reads the animals.xml file(s) this farm's animal definitions were
// imported from, so edits to them (a map/mod update, own tweaks) show up
// on the next start without importing again. Missing files are skipped and
// the last imported copy in animal_needs_config.json stays in use.
function refreshAnimalDefsFromSource(farm, animalsPath) {
    let files = Array.isArray(farm.animalDefsFiles) ? farm.animalDefsFiles : null;
    try {
        if (!files) {
            const label = farm.animalDefsSourceLabel || '';
            if (!label || !fs.existsSync(label) || !fs.statSync(label).isDirectory()) return;
            files = findAnimalXmlFiles(label).filter(f => {
                try { return !!parseAnimalNeedsXml(fs.readFileSync(f, 'utf-8')); } catch { return false; }
            });
            if (!files.length) return;
            // Remember them without touching lastEdited (not a user edit).
            farm.animalDefsFiles = files;
            fs.writeFileSync(path.join(farmDir(farm), 'data.json'), JSON.stringify(farm, null, 2), 'utf-8');
        }

        const fresh = {};
        files.forEach(f => {
            if (!fs.existsSync(f)) return;
            try {
                const parsed = parseAnimalNeedsXml(fs.readFileSync(f, 'utf-8'));
                if (parsed) Object.assign(fresh, parsed);
            } catch (e) { console.warn('Animal definitions: could not re-read', f, e); }
        });
        if (!Object.keys(fresh).length) return;

        let existing = {};
        if (fs.existsSync(animalsPath)) {
            try { existing = JSON.parse(fs.readFileSync(animalsPath, 'utf-8')) || {}; } catch { existing = {}; }
        }
        const merged = { ...existing, ...fresh };
        if (JSON.stringify(merged) !== JSON.stringify(existing)) {
            fs.writeFileSync(animalsPath, JSON.stringify(merged, null, 2), 'utf-8');
            console.log('Animal definitions refreshed from', files.length, 'file(s)');
        }
    } catch (e) {
        console.error('Could not refresh animal definitions for farm', farm.id, e);
    }
}

// Turns a raw fruitType "name" attribute (e.g. "SUGAR_BEET", "canola")
// into a readable display name ("Sugar Beet", "Canola").
function formatCropName(rawName) {
    return rawName
        .toLowerCase()
        .split(/[_\s]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

// Parses a single fruitType/foliageType XML (one crop's growth definition)
// and derives a sowing-month -> harvest-month calendar by simulating the
// game's own growth-state machine, one period (~one month) at a time.
// Returns null if the file isn't a recognizable crop growth definition —
// map folders are full of unrelated XML files, so this must fail quietly.
function parseCropGrowthXml(xmlText) {
    let doc;
    try {
        doc = new DOMParser().parseFromString(xmlText, "text/xml");
    } catch (err) {
        return null;
    }
    if (!doc || doc.querySelector('parsererror')) return null;

    const fruitTypeEl = doc.querySelector('fruitType');
    const seasonalEl = doc.querySelector('growth > seasonal');
    if (!fruitTypeEl || !seasonalEl) return null;

    const rawName = fruitTypeEl.getAttribute('name');
    if (!rawName) return null;

    // Find whichever foliage state(s) represent "ready to harvest". Usually
    // that's the attribute-flagged one, but some crops (e.g. potato) flag a
    // player-action state instead (like "cutHaulm" for haulm topping) that
    // the automatic seasonal growth chain never reaches on its own. So we
    // also always treat a state literally named "harvestReady" as a harvest
    // signal — that naming convention is consistent across FS crop content,
    // and covers exactly the cases the attribute alone misses.
    const harvestStateNames = new Set();
    doc.querySelectorAll('foliageState[isHarvestReady="true"]').forEach(el => {
        const n = el.getAttribute('name');
        if (n) harvestStateNames.add(n);
    });
    if (doc.querySelector('foliageState[name="harvestReady"]')) harvestStateNames.add('harvestReady');
    if (harvestStateNames.size === 0) return null;

    // Index the file's <period> elements onto our canonical 12-slot year,
    // regardless of what order they appear in the file.
    const periodData = FS_PERIODS.map(() => ({ plantingAllowed: false, updates: [] }));
    let hasInvisibleRule = false;
    seasonalEl.querySelectorAll(':scope > period').forEach(periodEl => {
        const idx = FS_PERIODS.indexOf(periodEl.getAttribute('name'));
        if (idx === -1) return;
        periodData[idx].plantingAllowed = periodEl.getAttribute('plantingAllowed') === 'true';
        periodEl.querySelectorAll(':scope > update').forEach(u => {
            const from = u.getAttribute('startState');
            const to = u.getAttribute('endState');
            if (from && to) {
                periodData[idx].updates.push({ from, to });
                if (from === 'invisible') hasInvisibleRule = true;
            }
        });
    });

    // Most crops sow into an "invisible" state (freshly tilled, nothing
    // visible yet). A few (e.g. rice, which never leaves standing water
    // bare) have no "invisible" state anywhere in their growth chain — for
    // those, fall back to whatever <seasonal initialState="..."> the file
    // itself declares as where a freshly planted crop starts.
    const sowStartState = hasInvisibleRule ? 'invisible' : (seasonalEl.getAttribute('initialState') || 'invisible');

    const calendar = {};

    for (let sowIdx = 0; sowIdx < 12; sowIdx++) {
        if (!periodData[sowIdx].plantingAllowed) continue;

        let state = sowStartState;
        let harvestIdx = null;

        // Walk forward period by period (wrapping across the year boundary,
        // up to 2 full years as a safety cap). Within each period, keep
        // chaining every matching growth rule until none apply (or harvest
        // is reached) before moving to the next period — a period's
        // <update> list is often a full multi-step chain meant to resolve
        // within that same ~month (e.g. grass: invisible -> greenSmall ->
        // greenMiddle -> harvestReady all inside one period), not one step
        // per period.
        outer:
        for (let step = 0; step < 24; step++) {
            const idx = (sowIdx + step) % 12;

            for (let inner = 0; inner < 20; inner++) {
                const rule = periodData[idx].updates.find(u => u.from === state);
                if (!rule) break;
                state = rule.to;
                if (harvestStateNames.has(state)) {
                    harvestIdx = idx;
                    break outer;
                }
            }

            if (harvestStateNames.has(state)) {
                harvestIdx = idx;
                break;
            }
        }

        if (harvestIdx !== null) {
            calendar[FS_PERIOD_TO_MONTH[sowIdx]] = FS_PERIOD_TO_MONTH[harvestIdx];
        }
    }

    if (Object.keys(calendar).length === 0) return null;
    return { name: formatCropName(rawName), calendar };
}

// Takes a FileList (from a <input webkitdirectory> folder picker, which the
// browser already expands recursively through every subfolder) and builds
// a combined crop calendar out of whichever files turn out to be crop
// growth definitions.
// Parses a game/mod animals.xml (the species/breed definition file — food,
// water, and straw needs per age in months, and production curves). This is
// the DEFINITION file, not the save's actual herd — same relationship as
// fruitType XML is to a planted field.
function parseAnimalNeedsXml(xmlText) {
    let doc;
    try { doc = new DOMParser().parseFromString(xmlText, "text/xml"); }
    catch (err) { return null; }
    if (!doc || doc.querySelector('parsererror')) return null;

    const animalsRoot = doc.querySelector('animals');
    if (!animalsRoot) return null;

    const subTypeEls = animalsRoot.querySelectorAll('animal > subType');
    if (subTypeEls.length === 0) return null;

    // Value attribute name isn't consistent across every crop/animal XML
    // dialect seen in the wild — "value" covers the input (food/water/straw)
    // curves, but output curves (milk/eggs/wool) sometimes use a
    // type-specific name instead, so every plausible one is tried in order.
    const readCurve = (parentEl, tagName, valueAttrs = ['value']) => {
        const el = parentEl.querySelector(':scope > ' + tagName);
        if (!el) return [];
        return Array.from(el.querySelectorAll('key')).map(k => {
            let value = NaN;
            for (const attr of valueAttrs) {
                const raw = k.getAttribute(attr);
                if (raw !== null) { value = parseFloat(raw); break; }
            }
            return { ageMonth: parseFloat(k.getAttribute('ageMonth')), value };
        }).filter(k => !isNaN(k.ageMonth) && !isNaN(k.value)).sort((a, b) => a.ageMonth - b.ageMonth);
    };

    const OUTPUT_VALUE_ATTRS = ['value', 'literPerDay', 'numPerDay', 'literPerHour', 'kgPerDay'];
    // Fallback tag name -> canonical fillType key, used only for wrapper
    // tags that carry no fillType/type attribute of their own (e.g. plain
    // "<manure>"). Matches formatFillType's PRODUCTION_FILLTYPE_TRANSLATIONS.
    const OUTPUT_TAGS = { milk: 'MILK', wool: 'WOOL', egg: 'EGG', manure: 'MANURE', liquidmanure: 'LIQUIDMANURE' };

    const readKeysOf = (el) => Array.from(el.querySelectorAll('key')).map(k => {
        let value = NaN;
        for (const attr of OUTPUT_VALUE_ATTRS) {
            const raw = k.getAttribute(attr);
            if (raw !== null) { value = parseFloat(raw); break; }
        }
        return { ageMonth: parseFloat(k.getAttribute('ageMonth')), value };
    }).filter(k => !isNaN(k.ageMonth) && !isNaN(k.value)).sort((a, b) => a.ageMonth - b.ageMonth);

    // Best-effort: production curves aren't as consistently structured
    // across game/mod animals.xml files as the input needs are. The real
    // game data itself uses more than one shape for the *same* kind of
    // output — cow milk is "<milk fillType="MILK">", but sheep wool is
    // "<pallets fillType="WOOL">" and goat milk "<pallets fillType="GOATMILK">"
    // (wrapper tag name isn't the commodity at all there), while water
    // buffalo uses "<milk fillType="BUFFALOMILK">" (right tag, different
    // fillType than the tag name would suggest). So every <output> child is
    // read generically: an explicit fillType/type attribute wins whenever
    // present; only a bare tag with neither (e.g. "<manure>") falls back to
    // the hardcoded tag-name guess.
    const readProductionCurves = (subTypeEl) => {
        const outputEl = subTypeEl.querySelector(':scope > output');
        if (!outputEl) return {};
        const production = {};

        Array.from(outputEl.children).forEach(el => {
            const tagName = el.tagName.toLowerCase();
            const fillType = el.getAttribute('fillType') || el.getAttribute('type') || OUTPUT_TAGS[tagName] || tagName.toUpperCase();
            if (!fillType || production[fillType]) return;
            const curve = readKeysOf(el);
            if (curve.length) production[fillType] = curve;
        });

        return production;
    };

    const needs = {};
    subTypeEls.forEach(subTypeEl => {
        const subType = subTypeEl.getAttribute('subType');
        const inputEl = subTypeEl.querySelector(':scope > input');
        if (!subType || !inputEl) return;

        const food = readCurve(inputEl, 'food');
        const water = readCurve(inputEl, 'water');
        const straw = readCurve(inputEl, 'straw');
        if (!food.length && !water.length && !straw.length) return;

        const entry = { food, water, straw };
        const animalType = subTypeEl.parentElement && subTypeEl.parentElement.getAttribute('type');
        if (animalType) entry.animalType = animalType.toUpperCase();
        const production = readProductionCurves(subTypeEl);
        if (Object.keys(production).length > 0) entry.production = production;
        const reproEl = subTypeEl.querySelector(':scope > reproduction');
        if (reproEl) entry.reproduction = animalImages.parseReproduction(reproEl.outerHTML);
        needs[subType] = entry;
    });

    return Object.keys(needs).length > 0 ? needs : null;
}

// Straight-line interpolation between the nearest two age keypoints — the
// curves skip some months (0,1,2,3,4,5,6,8,10,12,15,18...), so an exact
// animal age often falls between two known points.
function interpolateNeedCurve(curve, ageMonth) {
    if (!curve || curve.length === 0) return 0;
    if (ageMonth <= curve[0].ageMonth) return curve[0].value;
    if (ageMonth >= curve[curve.length - 1].ageMonth) return curve[curve.length - 1].value;
    for (let i = 0; i < curve.length - 1; i++) {
        const a = curve[i], b = curve[i + 1];
        if (ageMonth >= a.ageMonth && ageMonth <= b.ageMonth) {
            const frac = (b.ageMonth === a.ageMonth) ? 0 : (ageMonth - a.ageMonth) / (b.ageMonth - a.ageMonth);
            return a.value + frac * (b.value - a.value);
        }
    }
    return curve[curve.length - 1].value;
}

// Sentinel key used to store one combined feed-trough capacity per building
// (multiple feed ingredient types share one physical trough/capacity).
const ANIMAL_FEED_CAPACITY_KEY = '__ALL_FEED__';

function getDailyAnimalNeed(subType, ageMonth, needType) {
    const def = ANIMAL_NEEDS_DATA[subType];
    if (!def || !def[needType]) return 0;
    return interpolateNeedCurve(def[needType], ageMonth);
}

function getDailyAnimalProduction(subType, ageMonth, fillType) {
    const def = ANIMAL_NEEDS_DATA[subType];
    if (!def || !def.production || !def.production[fillType]) return 0;
    return interpolateNeedCurve(def.production[fillType], ageMonth);
}

function buildCropsCalendarFromFiles(fileList) {
    const combined = {};
    const animalNeeds = {};
    let xmlCount = 0;
    let cropsFound = 0;
    let animalDefsFound = 0;
    const animalFiles = [];
    // Files that *should* have been readable XML but errored out (bad path
    // resolution, read/permission failure) — distinct from the majority of
    // XML files in a map folder that just aren't crop/animal definitions at
    // all (vehicles, placeables, etc.), which is normal and not logged.
    const readErrors = [];

    Array.from(fileList).forEach(file => {
        if (!/\.xml$/i.test(file.name)) return;
        xmlCount++;

        let absPath = null;
        try { absPath = file.path || (webUtils ? webUtils.getPathForFile(file) : null); }
        catch (err) { absPath = null; }
        if (!absPath) {
            readErrors.push({ name: file.name, reason: 'could not resolve file path' });
            return;
        }

        try {
            const text = fs.readFileSync(absPath, 'utf-8');

            const parsedCrop = parseCropGrowthXml(text);
            if (parsedCrop) {
                combined[parsedCrop.name] = { ...(combined[parsedCrop.name] || {}), ...parsedCrop.calendar };
                cropsFound++;
                return;
            }

            const parsedAnimals = parseAnimalNeedsXml(text);
            if (parsedAnimals) {
                Object.assign(animalNeeds, parsedAnimals);
                animalDefsFound++;
                animalFiles.push(absPath);
            }
        } catch (err) {
            readErrors.push({ name: file.name, reason: err.message || String(err) });
            console.warn(`Crops/animal import: could not read "${file.name}" —`, err);
        }
    });

    return { combined, animalNeeds, xmlCount, cropsFound, animalDefsFound, animalFiles, readErrors };
}

function readGameSave(pathToFile) {
    const result = { balance: null, month: null, loan: null, equipment: null, animals: null, animalBreakdown: null, animalProduction: null, animalBuildings: null, feedStock: null, feedBales: null, mixerWagons: null, daysPerPeriod: null, playTime: null, gameDay: null, gamePeriod: null, gameYear: null };
    if (!pathToFile || !fs.existsSync(pathToFile)) return result;

    const saveFolder = path.dirname(pathToFile);

    const findValueInRawText = (text, tagName) => {
        const regex = new RegExp(`<${tagName}[^>]*>([^<]*)<\/${tagName}>`, 'i');
        const match = text.match(regex);
        return match ? match[1].trim() : null;
    };

    try {
        const careerText = fs.readFileSync(pathToFile, 'utf-8');
        let envText = "";
        const envPath = path.join(saveFolder, 'environment.xml');
        if (fs.existsSync(envPath)) {
            envText = fs.readFileSync(envPath, 'utf-8');
        }

        const moneyVal = findValueInRawText(careerText, 'money');
        if (moneyVal) result.balance = parseInt(moneyVal) + " €";

        // Enhanced Loan System (mod) keeps its own list of separate loans
        // instead of the base game's single "loan" value — sum whatever's
        // still outstanding (skip anything already paid off), per farm.
        let loanVal = null;
        const elsLoansPath = path.join(saveFolder, 'els_loans.xml');
        if (fs.existsSync(elsLoansPath)) {
            try {
                const elsXml = fs.readFileSync(elsLoansPath, 'utf-8');
                const elsDoc = new DOMParser().parseFromString(elsXml, "text/xml");
                const farmLoansEl = elsDoc.querySelector('farmId[farmId="1"]') || elsDoc.querySelector('farmId');
                if (farmLoansEl) {
                    let total = 0;
                    let foundAny = false;
                    farmLoansEl.querySelectorAll('loan').forEach(loanEl => {
                        if (loanEl.getAttribute('paidOff') === 'true') return;
                        const restAmount = parseFloat(loanEl.getAttribute('restAmount'));
                        if (!isNaN(restAmount)) {
                            total += restAmount;
                            foundAny = true;
                        }
                    });
                    if (foundAny) loanVal = total;
                }
            } catch (err) {
                // Not a recognizable els_loans.xml — fall through to vanilla sources below.
            }
        }

        if (loanVal === null) {
            const farmsPath = path.join(saveFolder, 'farms.xml');
            if (fs.existsSync(farmsPath)) {
                const farmsXml = fs.readFileSync(farmsPath, 'utf-8');
                const farmsDoc = new DOMParser().parseFromString(farmsXml, "text/xml");
                const farmEl = farmsDoc.querySelector('farm[farmId="1"]') || farmsDoc.querySelector('farm');
                if (farmEl) loanVal = farmEl.getAttribute('loan');
            }
            if (!loanVal) loanVal = findValueInRawText(careerText, 'loan');
        }

        // Bank And Credit (FS25_BankCredit) replaces the base-game loan with
        // its own contracts in bankCredit.xml (it pays off and zeroes the
        // vanilla loan on load) — add whatever is still outstanding for the
        // farm. Only while the mod is active, so a stale file doesn't count.
        const bankCreditPath = path.join(saveFolder, 'bankCredit.xml');
        if (/<mod\b[^>]*modName="FS25_BankCredit"/.test(careerText) && fs.existsSync(bankCreditPath)) {
            try {
                const bcDoc = new DOMParser().parseFromString(fs.readFileSync(bankCreditPath, 'utf-8'), "text/xml");
                let bcTotal = 0, bcMonthly = 0, bcCount = 0;
                bcDoc.querySelectorAll('bankcredit > loan').forEach(loanEl => {
                    if (loanEl.getAttribute('farmId') !== '1' || loanEl.getAttribute('paidOff') === 'true') return;
                    const rest = parseFloat(loanEl.getAttribute('restAmount'));
                    if (isNaN(rest) || rest <= 0) return;
                    bcTotal += rest;
                    bcMonthly += parseFloat(loanEl.getAttribute('monthlyPayment')) || 0;
                    bcCount++;
                });
                loanVal = (parseFloat(loanVal) || 0) + bcTotal;
                result.bankCredit = { count: bcCount, total: Math.round(bcTotal), monthly: Math.round(bcMonthly) };
            } catch (err) {
                console.warn('Could not read bankCredit.xml', err);
            }
        }
        if (loanVal !== null && loanVal !== undefined && loanVal !== "") result.loan = Math.round(parseFloat(loanVal));

        const currentDayStr = findValueInRawText(envText, 'currentDay');
        const daysPerPeriodStr = findValueInRawText(envText, 'daysPerPeriod') || findValueInRawText(careerText, 'plannedDaysPerPeriod') || "1";
        if (parseInt(daysPerPeriodStr) > 0) result.daysPerPeriod = parseInt(daysPerPeriodStr);

        if (currentDayStr) {
            const currentDay = parseInt(currentDayStr);
            const daysPerPeriod = parseInt(daysPerPeriodStr) || 1;
            const fsMonths = FS_PERIOD_TO_MONTH;
            // The game's own period counter runs 0,1,2,... forever (one per
            // in-game month) and never resets on the app's manual "seasons",
            // so it's the natural gap-free x-axis for the monthly history.
            const gamePeriod = Math.floor((currentDay - 1) / daysPerPeriod);
            result.gameDay = currentDay;
            result.gamePeriod = gamePeriod;
            result.gameYear = Math.floor(gamePeriod / 12) + 1;
            result.month = fsMonths[gamePeriod % 12];
        } else {
            let rawMonth = findValueInRawText(envText, 'currentMonth') || findValueInRawText(careerText, 'currentMonth');
            if (rawMonth) {
                const fsMonths = FS_PERIOD_TO_MONTH;
                const val = parseInt(rawMonth);
                const monthIndex = (val - 1 + 12) % 12;
                result.month = fsMonths[monthIndex];
            }
        }

        const vehiclesPath = path.join(saveFolder, 'vehicles.xml');
        if (fs.existsSync(vehiclesPath)) {
            const vehiclesXml = fs.readFileSync(vehiclesPath, 'utf-8');
            const vehiclesDoc = new DOMParser().parseFromString(vehiclesXml, "text/xml");
            const playerVehicles = vehiclesDoc.querySelectorAll('vehicle[farmId="1"]');
            result.equipment = playerVehicles.length;
        }

        const placeablesPath = path.join(saveFolder, 'placeables.xml');
        if (fs.existsSync(placeablesPath)) {
            const placeablesXml = fs.readFileSync(placeablesPath, 'utf-8');
            const placeablesDoc = new DOMParser().parseFromString(placeablesXml, "text/xml");
            let totalAnimals = 0;
            const bySpecies = {};
            const production = {};
            const buildings = [];
            const playerPlaceables = placeablesDoc.querySelectorAll('placeable[farmId="1"]');

            playerPlaceables.forEach(placeable => {
                const clustersEl = placeable.querySelector('husbandryAnimals');
                if (!clustersEl) return; // not an animal building at all — skip entirely

                const building = {
                    id: placeable.getAttribute('uniqueId') || placeable.getAttribute('filename') || String(buildings.length),
                    name: placeable.getAttribute('filename') || '',
                    clusters: [], food: [], production: []
                };
                let buildingHasAnimals = false;

                placeable.querySelectorAll('animal').forEach(animal => {
                    const num = parseInt(animal.getAttribute('numAnimals') || 0);
                    const subType = animal.getAttribute('subType');
                    const age = parseInt(animal.getAttribute('age') || 0);
                    const health = parseFloat(animal.getAttribute('health') || 0);
                    if (!subType || num <= 0) return;

                    totalAnimals += num;
                    bySpecies[subType] = (bySpecies[subType] || 0) + num;
                    const cluster = { subType, numAnimals: num, age, health };
                    // Reproduction state: progress % of the current pregnancy,
                    // whether the group is inseminated, months since the last birth.
                    if (animal.hasAttribute('reproduction')) cluster.reproduction = parseFloat(animal.getAttribute('reproduction')) || 0;
                    if (animal.hasAttribute('isInseminated')) cluster.isInseminated = animal.getAttribute('isInseminated') === 'true';
                    if (animal.hasAttribute('monthsSinceLastBirth')) cluster.monthsSinceLastBirth = parseInt(animal.getAttribute('monthsSinceLastBirth')) || 0;
                    if (animal.hasAttribute('hadABirth')) cluster.hadABirth = animal.getAttribute('hadABirth') === 'true';
                    building.clusters.push(cluster);
                    buildingHasAnimals = true;
                });

                if (!buildingHasAnimals) return;

                // What's currently in the feed trough — this is what runs out
                // and needs restocking, so it's the thing worth a warning bar.
                placeable.querySelectorAll('husbandryFood > fillLevel').forEach(el => {
                    const fillType = el.getAttribute('fillType');
                    const level = parseFloat(el.getAttribute('fillLevel')) || 0;
                    if (fillType) building.food.push({ fillType, level });
                });

                // Currently-stored/pending production (milk in the tank, eggs
                // waiting for pickup, etc.).
                placeable.querySelectorAll('husbandry > storage > node').forEach(node => {
                    const fillType = node.getAttribute('fillType');
                    const level = parseFloat(node.getAttribute('fillLevel')) || 0;
                    if (fillType && level > 0) {
                        building.production.push({ fillType, level });
                        production[fillType] = (production[fillType] || 0) + level;
                    }
                });
                placeable.querySelectorAll('husbandryPallets > pendingLiters').forEach(el => {
                    const fillType = el.getAttribute('fillType');
                    const liters = parseFloat(el.getAttribute('liters')) || 0;
                    if (fillType && liters > 0) {
                        building.production.push({ fillType, level: liters });
                        production[fillType] = (production[fillType] || 0) + liters;
                    }
                });

                buildings.push(building);
            });

            result.animals = totalAnimals;
            result.animalBreakdown = bySpecies;
            result.animalProduction = production;
            result.animalBuildings = buildings;
        }

        try { result.feedStock = readFeedStockFromSave(saveFolder); }
        catch (e) { console.error('Could not read feed stock from savegame', e); }
        try { result.feedBales = readFeedBalesFromSave(saveFolder); }
        catch (e) { console.error('Could not read bales from savegame', e); }
        try { result.mixerWagons = readMixerWagonsFromSave(saveFolder, modFiles.findModsDirs(pathToFile)); }
        catch (e) { console.error('Could not read mixer wagons from savegame', e); }
        try {
            result.feedMixers = readFeedMixersFromSave(saveFolder, modFiles.findModsDirs(pathToFile));
            // What sits in a mixer (finished feed and the crops waiting to be
            // mixed) is feed on the farm too.
            if (result.feedStock) {
                result.feedMixers.forEach(m => Object.entries(m.stock).forEach(([ft, litres]) => {
                    if (!isFeedFillType(ft)) return;
                    const e = result.feedStock[ft] || (result.feedStock[ft] = {});
                    e.mixer = (e.mixer || 0) + litres;
                }));
            }
        }
        catch (e) { console.error('Could not read feed mixers from savegame', e); }

        const playTimeVal = findValueInRawText(careerText, 'playTime');
        if (playTimeVal) {
            const minutes = parseFloat(playTimeVal);
            if (!isNaN(minutes)) {
                const hours = Math.floor(minutes / 60);
                const mins = Math.floor(minutes % 60);
                result.playTime = `${hours}h ${mins}m`;
            }
        }

    } catch (err) { console.error("Error reading savegame:", err); }
    return result;
}

// =============================================================
// SECTION 5: PLANNER VIEW LOGIC
// =============================================================
window.openPlanner = function (id) {
    const farm = getAllFarms().find(f => f.id === id);
    if (farm) {
        currentFarmId = farm.id;

        loadFarmConfigs(farm);

        if (farm.saveGamePath) applyGameSaveToFarm(farm);
        refreshFarmlandInfo(farm);

        if (plannerTitle) plannerTitle.innerText = farm.mapName ? `${farm.name} · ${farm.mapName}` : farm.name;
        refreshPlannerHeader(farm);

        if (seasonNumberEl) seasonNumberEl.innerText = `${t('season')} ${farm.currentSeason || 1}`;

        isEditMode = false;
        if (editSeasonBtn) { editSeasonBtn.innerText = t('edit'); editSeasonBtn.style.backgroundColor = ""; editSeasonBtn.style.color = ""; }

        viewedSeason = farm.currentSeason || 1;
        renderSeasonView();
        showPlannerView('plan');

        if (dashboardView) dashboardView.style.display = 'none';
        if (plannerView) plannerView.style.display = 'flex';

        startAutoSync(farm.id);
        updateDiscordPresence();
    }
};

// Reads the live savegame and merges any changed values into `farm`, persisting
// to disk when something actually moved. Returns true if a field changed.
// Shared by openPlanner (one-shot on open) and the real-time auto-sync loop.
function applyGameSaveToFarm(farm) {
    if (!farm || !farm.saveGamePath) return false;
    const gameData = readGameSave(farm.saveGamePath);
    let changed = false;

    if (gameData.balance && gameData.balance !== farm.balance) { farm.balance = gameData.balance; changed = true; }
    if (gameData.month && gameData.month !== farm.month) {
        // December -> January is a new in-game year — bump the user-facing
        // year counter shown next to the month (independent of farm.currentSeason).
        if (farm.month === 'DECEMBER' && gameData.month === 'JANUARY') {
            farm.yearNumber = (parseInt(farm.yearNumber, 10) || 1) + 1;
            changed = true;
        }
        farm.month = gameData.month;
        changed = true;
    }
    if (gameData.loan !== null && gameData.loan !== farm.loan) { farm.loan = gameData.loan; changed = true; }
    const bankCredit = gameData.bankCredit || null;
    if (JSON.stringify(bankCredit) !== JSON.stringify(farm.bankCredit || null)) { farm.bankCredit = bankCredit; changed = true; }
    if (gameData.equipment !== null && gameData.equipment !== farm.equipment) { farm.equipment = gameData.equipment; changed = true; }
    if (gameData.animals !== null && gameData.animals !== farm.animals) { farm.animals = gameData.animals; changed = true; }
    if (gameData.animalBreakdown !== null) { farm.animalBreakdown = gameData.animalBreakdown; changed = true; }
    if (gameData.animalProduction !== null) { farm.animalProduction = gameData.animalProduction; changed = true; }
    if (gameData.animalBuildings !== null) { farm.animalBuildings = gameData.animalBuildings; changed = true; }
    if (gameData.feedStock !== null) { farm.feedStock = gameData.feedStock; changed = true; }
    if (gameData.feedBales !== null) { farm.feedBales = gameData.feedBales; changed = true; }
    if (gameData.mixerWagons !== null) { farm.mixerWagons = gameData.mixerWagons; changed = true; }
    if (gameData.feedMixers !== undefined && JSON.stringify(gameData.feedMixers) !== JSON.stringify(farm.feedMixers || [])) { farm.feedMixers = gameData.feedMixers; changed = true; }
    if (gameData.daysPerPeriod !== null && gameData.daysPerPeriod !== farm.daysPerPeriod) { farm.daysPerPeriod = gameData.daysPerPeriod; changed = true; }
    if (gameData.playTime !== null && gameData.playTime !== farm.playTime) { farm.playTime = gameData.playTime; changed = true; }

    if (changed) saveFarmData(farm);

    // Log/refresh this in-game month's data point for the trend charts. Safe to
    // call every read — it only writes when the month rolls over or a value in
    // the current month actually moved.
    recordMonthlySnapshot(farm, gameData);

    return changed;
}

// Pushes the farm's current header/sidebar figures into the planner DOM.
// Kept separate from openPlanner so the auto-sync loop can refresh the numbers
// without resetting edit mode or the viewed season.
function refreshPlannerHeader(farm) {
    if (!farm) return;
    if (plannerBalance) plannerBalance.innerText = farm.balance || "0 €";
    if (plannerMonth) plannerMonth.innerText = translateMonth(farm.month || "AUGUST");
    if (plannerYear) plannerYear.value = parseInt(farm.yearNumber, 10) || 1;

    const loanInput = document.getElementById('detail-loan');
    if (loanInput) loanInput.innerText = farm.loan ? `${farm.loan} €` : "0 €";

    const sidebarBalance = document.getElementById('details-balance');
    if (sidebarBalance) sidebarBalance.innerText = farm.balance || "0 €";

    if (detailEquipment) detailEquipment.innerText = farm.equipment !== undefined ? farm.equipment : "-";
    if (detailAnimals) detailAnimals.innerText = farm.animals !== undefined ? farm.animals : "-";
    if (detailAge) detailAge.innerText = farm.playTime !== undefined ? farm.playTime : "0h 0m";
}

// =============================================================
// SECTION 4B: REAL-TIME SAVEGAME AUTO-SYNC
// =============================================================
// Farming Simulator only flushes the savegame to disk on manual save / autosave,
// so "real time" here means: watch the save folder and re-import automatically
// the moment the game writes a new (auto)save, without the user reopening the farm.
const AUTO_SYNC_INTERVAL_MS = 10000;
const AUTO_SYNC_FILES = [
    'careerSavegame.xml', 'environment.xml', 'farms.xml',
    'vehicles.xml', 'placeables.xml', 'items.xml', 'els_loans.xml', 'bankCredit.xml'
];

let autoSyncTimer = null;
let autoSyncFarmId = null;
let autoSyncSavePath = null;    // cached so the tick doesn't re-read every farm
let autoSyncSeenSig = null;     // signature we've already imported
let autoSyncPendingSig = null;  // changed-but-not-yet-stable signature
let autoSyncToastTimer = null;

function isAutoSyncEnabled() {
    return localStorage.getItem(CONFIG_KEY_AUTO_SYNC) === '1';
}

// A cheap fingerprint of the save folder: mtime + size of each relevant file.
// Changes whenever the game rewrites any of them; lets us skip re-parsing when
// nothing moved.
function computeSaveSignature(saveFilePath) {
    if (!saveFilePath) return null;
    const dir = path.dirname(saveFilePath);
    const parts = [];
    for (const name of AUTO_SYNC_FILES) {
        try {
            const st = fs.statSync(path.join(dir, name));
            parts.push(`${name}:${st.mtimeMs}:${st.size}`);
        } catch {
            parts.push(`${name}:-`);
        }
    }
    return parts.join('|');
}

function stopAutoSync() {
    if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
    autoSyncFarmId = null;
    autoSyncSavePath = null;
    autoSyncSeenSig = null;
    autoSyncPendingSig = null;
}

function startAutoSync(farmId) {
    stopAutoSync();
    if (!isAutoSyncEnabled()) return;
    const farm = getAllFarms().find(f => f.id === farmId);
    if (!farm || !farm.saveGamePath || !fs.existsSync(farm.saveGamePath)) return;

    autoSyncFarmId = farmId;
    autoSyncSavePath = farm.saveGamePath;
    autoSyncSeenSig = computeSaveSignature(farm.saveGamePath); // current state = already imported
    autoSyncTimer = setInterval(runAutoSyncTick, AUTO_SYNC_INTERVAL_MS);
}

function runAutoSyncTick() {
    // Bail if the user navigated away or switched farms.
    if (autoSyncFarmId == null || currentFarmId !== autoSyncFarmId) { stopAutoSync(); return; }

    // Cheap disk check first — only touch farm storage once the save actually moved.
    const sig = computeSaveSignature(autoSyncSavePath);
    if (!sig || sig === autoSyncSeenSig) return;

    // The game may still be part-way through writing several files. Wait until the
    // signature holds steady for one interval before we actually parse anything.
    if (sig !== autoSyncPendingSig) { autoSyncPendingSig = sig; return; }

    // Don't yank the user out of an active edit — leave the signature pending and
    // try again on the next tick once they're done.
    if (isEditMode) return;

    const farm = getAllFarms().find(f => f.id === autoSyncFarmId);
    if (!farm || !farm.saveGamePath) { stopAutoSync(); return; }

    autoSyncSeenSig = sig;
    autoSyncPendingSig = null;

    const changed = applyGameSaveToFarm(farm);
    if (changed) {
        refreshFarmlandInfo(farm);   // bought/sold land shows up in farmland.xml
        refreshPlannerHeader(farm);
        renderSeasonView();
        showAutoSyncToast();
    }
}

function showAutoSyncToast() {
    if (!autoSyncToast) return;
    autoSyncToast.textContent = t('autoSyncedToast');
    autoSyncToast.hidden = false;
    // force reflow so the transition runs even on rapid re-triggers
    void autoSyncToast.offsetWidth;
    autoSyncToast.classList.add('is-visible');
    clearTimeout(autoSyncToastTimer);
    autoSyncToastTimer = setTimeout(() => {
        autoSyncToast.classList.remove('is-visible');
        setTimeout(() => { autoSyncToast.hidden = true; }, 300);
    }, 2500);
}

if (exitBtn) exitBtn.addEventListener('click', () => { stopAutoSync(); clearFarmConfigs(); plannerView.style.display = 'none'; dashboardView.style.display = 'flex'; currentFarmId = null; renderFarmList(getAllFarms()); updateDiscordPresence(); });
if (backBtn) backBtn.addEventListener('click', () => { stopAutoSync(); clearFarmConfigs(); plannerView.style.display = 'none'; dashboardView.style.display = 'flex'; currentFarmId = null; renderFarmList(getAllFarms()); updateDiscordPresence(); });

window.renderSeasonView = function () {
    const farm = getAllFarms().find(f => f.id === currentFarmId);
    if (!farm) return;

    const currentActiveSeason = farm.currentSeason || 1;
    let fieldsToDisplay = [];
    let isPastSeason = viewedSeason < currentActiveSeason;

    if (isPastSeason) {
        const archivePath = path.join(appDataDir, farm.folderName, 'seasons', `season_${viewedSeason}.json`);
        if (fs.existsSync(archivePath)) {
            try {
                const archiveData = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
                fieldsToDisplay = archiveData.fields || [];
            } catch (e) { console.error(e); }
        }
    } else {
        fieldsToDisplay = farm.fields || [];
    }

    renderFieldsTable(fieldsToDisplay);
    updateCropsSummary(fieldsToDisplay);

    if (seasonNumberEl) {
        const leftArrow = viewedSeason > 1
            ? `<span id="prev-season-btn" style="cursor:pointer; color: var(--color-primary); padding-right: 15px;"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></span>`
            : `<span style="opacity:0.2; padding-right: 15px;"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></span>`;

        const rightArrow = viewedSeason < currentActiveSeason
            ? `<span id="next-season-btn" style="cursor:pointer; color: var(--color-primary); padding-left: 15px;"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></span>`
            : `<span style="opacity:0.2; padding-left: 15px;"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></span>`;

        seasonNumberEl.innerHTML = `${leftArrow} ${t('season')} ${viewedSeason} ${rightArrow}`;

        const prevBtn = document.getElementById('prev-season-btn');
        const nextBtn = document.getElementById('next-season-btn');

        if (prevBtn) prevBtn.addEventListener('click', () => {
            if (isEditMode) return;
            viewedSeason--;
            renderSeasonView();
        });

        if (nextBtn) nextBtn.addEventListener('click', () => {
            if (isEditMode) return;
            viewedSeason++;
            renderSeasonView();
        });
    }

    const displayStyle = isPastSeason ? 'none' : 'inline-block';
    if (editSeasonBtn) editSeasonBtn.style.display = displayStyle;
    if (newSeasonBtn) newSeasonBtn.style.display = displayStyle;

    // Field count may have changed (crop edits, new season) — refresh Discord.
    updateDiscordPresence();
};

// =============================================================
// SECTION 6: MAIN TABLE (ONE BUTTON LOGIC)
// =============================================================

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
    const soilMix = getFieldSoilMix(fertPlanSoilKey(field, i), rates);
    const ph = resolveLimePh(field, seasonNum, soilMix);
    if (ph == null) return { ph: null, status: 'off' };
    return { ph, status: ph > 0.75 ? 'active' : 'warning' };
}

// Fill color for the lime chip, interpolated across 3 stops as pH drops from
// ideal (beige — the old "active" color) through amber to --color-rust (the
// old "warning" color). Returns null when never limed (chip stays empty).
const LIME_COLOR_STOPS = [
    [0, [166, 69, 43]],     // 0.0 -> --color-rust (#A6452B)
    [0.5, [201, 122, 43]],  // 0.5 -> --color-accent (#C97A2B)
    [1, [216, 207, 166]]    // 1.0 -> old "active" beige (#D8CFA6)
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

// Cycles the lime chip: off -> active (fresh application) -> dismissed (off)
// from either active or warning. Manure/fertilizer keep the simpler generic
// toggle since they don't carry this multi-season state.
window.toggleLimeChip = function (btn) {
    if (btn.classList.contains('is-active') || btn.classList.contains('is-warning')) {
        btn.classList.remove('is-active', 'is-warning');
        // Clear the tracked application season so that turning this back on
        // later is treated as a fresh application, not a resumed old one.
        delete btn.dataset.limeSeason;
    } else {
        btn.classList.add('is-active');
        btn.classList.remove('is-warning');
    }
};

// Reads which crop was on each field in the season right before the one
// being viewed, so we can flag "same crop as last season" (soil depletion
// warning). Returns {} if there's no previous season or its archive can't
// be read — the warning simply doesn't show rather than breaking anything.
function getPreviousSeasonCropMap(farm, seasonNum) {
    const map = {};
    if (!farm || !farm.folderName || seasonNum <= 1) return map;

    const archivePath = path.join(appDataDir, farm.folderName, 'seasons', `season_${seasonNum - 1}.json`);
    if (!fs.existsSync(archivePath)) return map;

    try {
        const archiveData = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
        (archiveData.fields || []).forEach(f => {
            const key = (f.number || '').toString().trim();
            if (key && f.crop) map[key] = f.crop;
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
    const saved = JSON.parse(localStorage.getItem('fieldsSort') || 'null');
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
        try { localStorage.setItem('fieldsSort', JSON.stringify(fieldsSort)); } catch (e) { /* ignore */ }
        renderSeasonView();
    });
});

function catchCropCaption(field) {
    if (!field.catchCrop) return '';
    const month = field.catchSowingMonth ? ` · ${translateMonth(field.catchSowingMonth)}` : '';
    return `<span class="ha-caption catch-crop-caption">+ ${t('catchCropShort')}: ${translateCropName(field.catchCrop)}${month}</span>`;
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
    let totalArea = 0;

    if (fields && fields.length > 0) {
        const numberTotals = getFieldNumberTotals(fields);
        const sortedFields = sortFieldsForDisplay(fields, currentFarmMonth);

        sortedFields.forEach(field => {
            const area = parseFloat(field.area || 0);
            totalArea += area;

            const key = (field.number || '').toString().trim();
            const group = numberTotals[key];
            const isSplit = group && group.count > 1;

            const isRotationRepeat = field.crop && prevCropMap[key] && prevCropMap[key] === field.crop;
            const rotationBadge = isRotationRepeat
                ? ` <span class="badge badge--rotation-warn" title="${t('rotationWarning')}"><i class="fa-solid fa-rotate" aria-hidden="true"></i></span>`
                : '';

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

            let stateDisplay;

            if (field.state === 'Planted') {
                stateDisplay = `<span class="badge badge--planted">${t('planted')}</span>`;
            } else {
                const sowMonth = field.sowingMonth ? field.sowingMonth.toUpperCase() : "";
                if (sowMonth === currentFarmMonth && sowMonth !== "") {
                    stateDisplay = `<span class="badge badge--plant-now">${t('plantNow')}</span>`;
                } else {
                    stateDisplay = `<span class="badge badge--to-plant">${t('toPlant')}</span>`;
                }
            }

            // Real index in the (unsorted) fields array — needed for
            // fertPlanSoilKey/fertPlanKey below AND for the lime pH lookup,
            // which must key soil mix the same way buildSuppliesFertRows does.
            const origIdx = fields.indexOf(field);
            const { ph: limePh, status: limeStatus } = getLimeStatus(field, origIdx, viewedSeason, getSupplyRates());
            const limeColor = limeChipColor(limePh);
            const limeTitle = buildLimeTitle(limePh, limeStatus, field.limeAppliedSeason);

            const numberParts = String(field.number || '').split('-').map(n => n.trim()).filter(Boolean);
            const numberChipsHtml = numberParts.length
                ? numberParts.map(n => `<span class="field-number-chip">${n}</span>`).join('<span class="field-number-sep">–</span>')
                : `<span class="field-number-chip">${field.number || '–'}</span>`;
            const numberCellTitle = numberParts.length > 1 ? ` title="${field.number}"` : '';

            let fertPlanCell = '<td class="fertplan-cell"></td>';
            if (!isPastSeason && field.crop && area > 0) {
                const numStr = (field.number || '').toString().trim();
                const soilK = fertPlanSoilKey(field, origIdx);
                const planK = fertPlanKey(field, origIdx);
                const dispNum = numStr || ('#' + (origIdx + 1));
                const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                // White = nothing marked yet; brown = natural fertilizer applied;
                // green = synthetic applied (wins if both are checked — it's the
                // "topped up to target" state). Flags live on the field itself,
                // set from the plan modal's Zabiegi checkboxes.
                const btnState = field.fertilizer ? ' fertplan-open-btn--synthetic' : (field.manure ? ' fertplan-open-btn--natural' : '');
                fertPlanCell = `<td class="fertplan-cell"><button type="button" class="fertplan-open-btn${btnState}" onclick="openFieldFertPlan('${esc(planK)}','${esc(soilK)}','${esc(dispNum)}','${esc(field.crop)}',${area})">${t('fertPlanBtn')}</button></td>`;
            }

            htmlString += `
                <tr class="${isSplit ? 'field-split-row' : ''}">
                    <td class="field-number-cell"${numberCellTitle}><span class="field-number-chips">${numberChipsHtml}</span></td>
                    <td>${areaCell}</td>
                    <td>${field.crop ? translateCropName(field.crop) : '-'}${rotationBadge}${catchCropCaption(field)}</td>
                    <td>${field.sowingMonth ? translateMonth(field.sowingMonth) : '-'}</td>
                    <td>${stateDisplay}</td>
                    <td>
                        <div class="tillage-switch tillage-switch--readonly">
                            <span class="tillage-switch-option tillage-switch-option--plowed ${field.tillage === 'plowed' ? 'is-active' : ''}">${t('tillagePlowed')}</span>
                            <span class="tillage-switch-option tillage-switch-option--notill ${field.tillage === 'noTill' ? 'is-active' : ''}">${t('tillageNoTill')}</span>
                        </div>
                    </td>
                    <td class="treatments-cell">
                        <span class="treatment-chip treatment-chip--lime"${limeColor ? ` style="--lime-color:${limeColor}; --lime-pct:${Math.round(limePh * 100)}%;"` : ''} title="${limeTitle}">
                            <span class="lime-fill"></span>
                            <span class="lime-letter">${t('limeLetter')}</span>
                        </span>
                    </td>
                    ${fertPlanCell}
                </tr>
            `;
        });
    }
    fieldsBody.innerHTML = htmlString;

    if (totalSumEl) totalSumEl.innerText = totalArea.toFixed(2) + " ha";
    const farmlandSumEl = document.getElementById('farmland-ha-sum');
    if (farmlandSumEl) {
        const owned = (FARMLAND_INFO && FARMLAND_INFO.ok) ? FARMLAND_INFO.owned.filter(id => FARMLAND_INFO.areas[id] !== undefined) : [];
        farmlandSumEl.hidden = !owned.length;
        if (owned.length) {
            const plotsHa = owned.reduce((s, id) => s + FARMLAND_INFO.areas[id], 0);
            farmlandSumEl.textContent = t('farmlandTotal').replace('{ha}', plotsHa.toFixed(2)).replace('{n}', owned.length);
        }
    }
    if (detailHa) detailHa.innerText = totalArea.toFixed(2) + " ha";
    if (detailFields) detailFields.innerText = fields ? fields.length : 0;
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
function cropOptionsHtml(selected, emptyLabel) {
    const crops = [...AVAILABLE_CROPS];
    if (selected && !crops.includes(selected)) crops.push(selected);
    let html = `<option value="">${emptyLabel}</option>`;
    crops.forEach(c => {
        html += `<option value="${escapeHtml(c)}" ${selected === c ? 'selected' : ''}>${translateCropName(c)}</option>`;
    });
    return html;
}

// Builds one editable field as a self-contained "tile" — a <tr> holding a
// single full-width <td> with a card inside. Keeping it inside a <tr> means all
// the existing save / split-hint logic (which walks `#fields-body tr` and
// `row.querySelector('.field-*')`) keeps working unchanged.
function buildFieldEditCard(field, opts) {
    opts = opts || {};
    field = field || {};
    const farm = opts.farm || null;
    const isNew = !!opts.isNew;
    const isSplit = !!opts.isSplit;

    const cropOptions = cropOptionsHtml(field.crop, t('selectPlaceholder'));
    const catchCropOptions = cropOptionsHtml(field.catchCrop, t('catchCropNone'));

    const monthOptions = isNew
        ? `<option value="">${t('selectCropFirst')}</option>`
        : generateMonthOptionsHtml(field.crop, field.sowingMonth);
    const catchMonthOptions = generateMonthOptionsHtml(field.catchCrop, field.catchSowingMonth);

    const isChecked = field.state === 'Planted' ? 'checked' : '';
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

    return `
        <tr class="field-edit-tr${isSplit ? ' field-split-row' : ''}" data-manure="${field.manure ? '1' : '0'}" data-fertilizer="${field.fertilizer ? '1' : '0'}">
            <td colspan="8">
                <div class="field-card">
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
                            <input type="text" class="edit-input field-area" value="${field.area || ''}" placeholder="0.00">
                        </div>
                        <label class="fc-cell fc-cell--state">
                            <span class="fc-label">${t('thState')}</span>
                            <input type="checkbox" class="edit-input field-state" ${isChecked}>
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
                                <button type="button" class="treatment-chip treatment-chip--lime ${limeCls}"${limeColorForCard ? ` style="--lime-color:${limeColorForCard}; --lime-pct:${Math.round(limePhForCard * 100)}%;"` : ''} data-lime-season="${limeSeason}" data-lime-ph="${limePhForCard != null ? limePhForCard : ''}" onclick="toggleLimeChip(this)" title="${t('limeEditTitle')}${limePhForCard != null ? ' (' + Math.round(limePhForCard * 100) + '% pH)' : ''}">
                                    <span class="lime-fill"></span>
                                    <span class="lime-letter">${t('limeLetter')}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="field-card-row field-card-row--grid field-card-row--catch">
                        <div class="fc-cell">
                            <span class="fc-label" title="${t('catchCropHint')}">${t('thCatchCrop')}</span>
                            <select class="edit-input field-catch-crop" onchange="onCatchCropChange(this)">${catchCropOptions}</select>
                        </div>
                        <div class="fc-cell">
                            <span class="fc-label">${t('thCatchSowingMth')}</span>
                            <select class="edit-input field-catch-sow">${catchMonthOptions}</select>
                        </div>
                    </div>
                    <div class="field-card-foot">
                        <input type="text" class="edit-input field-size-input" value="${savedSize}" placeholder="${t('fieldSizeLabel')}" title="Total ha of this physical field — lets the app tell you how much is left to sow" style="display:none;">
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
            <td colspan="8" class="add-row-trigger" onclick="addNewFieldRow()" title="Tip: reuse the same field number on two rows to split one field between two crops">
                ${t('addNewField')}
            </td>
        </tr>
    `;

    fieldsBody.innerHTML = htmlString;
    updateSplitHints();
}

window.onCropChange = function (selectEl) {
    const row = selectEl.closest('tr');
    row.querySelector('.field-sow').innerHTML = generateMonthOptionsHtml(selectEl.value, null);
};

window.onCatchCropChange = function (selectEl) {
    const row = selectEl.closest('tr');
    row.querySelector('.field-catch-sow').innerHTML = generateMonthOptionsHtml(selectEl.value, null);
};

// Toggles between "Plowed" and "No-till" for a field — mutually exclusive,
// like a radio pair: selecting one clears the other, clicking the already
// active one clears the selection entirely.
window.toggleTillageChip = function (btn) {
    const row = btn.closest('tr');
    const wasActive = btn.classList.contains('is-active');
    row.querySelectorAll('.tillage-switch-option').forEach(chip => chip.classList.remove('is-active'));
    if (!wasActive) btn.classList.add('is-active');
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
        const area = parseFloat((areaInput.value || '0').replace(',', '.')) || 0;
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
                    const parsed = parseFloat(sizeInput.value.replace(',', '.'));
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
        if (e.target.classList.contains('field-area') ||
            e.target.classList.contains('field-number') ||
            e.target.classList.contains('field-size-input')) {
            updateSplitHints();
        }
    });
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

if (editSeasonBtn) {
    editSeasonBtn.addEventListener('click', () => {
        if (!currentFarmId) return;

        const allFarms = getAllFarms();
        const idx = allFarms.findIndex(f => f.id === currentFarmId);
        if (idx === -1) return;
        const farm = allFarms[idx];

        // --- FUNKCJA POMOCNICZA DO TWORZENIA BACKUPU ---
        const createBackup = (fieldsData, prefix) => {
            try {
                const farmFolder = farm.folderName;
                const backupsDir = path.join(appDataDir, farmFolder, 'backups');
                if (!fs.existsSync(backupsDir)) {
                    fs.mkdirSync(backupsDir, { recursive: true });
                }

                const now = new Date();
                const h = String(now.getHours()).padStart(2, '0');
                const m = String(now.getMinutes()).padStart(2, '0');
                const s = String(now.getSeconds()).padStart(2, '0');
                const d = String(now.getDate()).padStart(2, '0');
                const mo = String(now.getMonth() + 1).padStart(2, '0');
                const y = now.getFullYear();

                // Nazwa pliku np.: pre-edit_backup-18-30-05_19-02-2026.json
                const backupFileName = `${prefix}_backup-${h}-${m}-${s}_${d}-${mo}-${y}.json`;
                const backupFilePath = path.join(backupsDir, backupFileName);

                const backupData = {
                    action: prefix,
                    timestamp: now.toISOString(),
                    fields: fieldsData
                };

                fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf-8');
                console.log(`Utworzono backup (${prefix}):`, backupFileName);

            } catch (err) {
                console.error("Błąd zapisu kopii zapasowej:", err);
            }
        };
        // ------------------------------------------------

        if (isEditMode) {
            // >>> WYJŚCIE Z EDYCJI (ZAPIS) <<<

            const rows = fieldsBody.querySelectorAll('tr');
            const newFields = [];
            const newFieldSizes = { ...(allFarms[idx].fieldSizes || {}) };

            rows.forEach(row => {
                const numInput = row.querySelector('.field-number');
                if (numInput && numInput.value) {
                    let rawArea = row.querySelector('.field-area').value || "0";
                    rawArea = rawArea.replace(',', '.');

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
                        limeAppliedSeason = isFresh ? (allFarms[idx].currentSeason || 1) : original;
                        // dataset.limePh was stamped from resolveLimePh() at render time, so
                        // it's already correct even for a field that predates this pH model.
                        const originalPh = limeChip.dataset.limePh !== '' ? parseFloat(limeChip.dataset.limePh) : null;
                        limePh = isFresh ? LIME_PH_IDEAL : (originalPh !== null && !isNaN(originalPh) ? originalPh : LIME_PH_IDEAL);
                    }

                    const catchCropSelect = row.querySelector('.field-catch-crop');
                    const catchCrop = catchCropSelect ? catchCropSelect.value : '';

                    newFields.push({
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
                        manure: row.dataset.manure === '1',
                        fertilizer: row.dataset.fertilizer === '1'
                    });

                    const sizeInput = row.querySelector('.field-size-input');
                    if (sizeInput && sizeInput.value) {
                        const parsedSize = parseFloat(sizeInput.value.replace(',', '.'));
                        if (!isNaN(parsedSize)) newFieldSizes[numInput.value.trim()] = parsedSize;
                    }
                }
            });

            // 1. Zapisz nowe dane do farmy
            allFarms[idx].fields = newFields;
            allFarms[idx].fieldSizes = newFieldSizes;
            saveFarmData(allFarms[idx]);

            // 2. ZRÓB BACKUP "POST-EDIT" (stan po zmianach)
            createBackup(newFields, "post-edit");

            renderSeasonView();

            isEditMode = false;
            editSeasonBtn.innerText = t('edit');
            editSeasonBtn.style.backgroundColor = "transparent";
            editSeasonBtn.style.color = "var(--color-black)";

        } else {
            // >>> WEJŚCIE W TRYB EDYCJI <<<

            // 1. ZRÓB BACKUP "PRE-EDIT" (stan obecny, przed zmianami)
            // Dzięki temu jak coś zepsujesz, masz kopię tego co było przed chwilą
            createBackup(farm.fields || [], "pre-edit");

            renderEditTableWithDropdowns(farm.fields || []);
            isEditMode = true;

            editSeasonBtn.innerText = t('saveChanges');
            editSeasonBtn.style.backgroundColor = "var(--color-black)";
            editSeasonBtn.style.color = "var(--color-white)";
        }
    });
}

// =============================================================
// SECTION 7: CROPS SUMMARY SIDEBAR
// =============================================================
// Read-only: every crop planted on a field this season with its total area,
// plus catch crops (green rye, oilseed radish…) in their own section — they
// share hectares with the main crop, so adding them to one total would count
// the same land twice. Sorted in the game's own crop order by default; the
// column headers switch to name / area (click again to reverse, a third time
// to go back to game order).
let cropsSort = { key: 'game', dir: 1 };
try {
    const saved = JSON.parse(localStorage.getItem('cropsSort') || 'null');
    if (saved && ['game', 'name', 'ha'].includes(saved.key)) cropsSort = saved;
} catch (e) { /* storage unavailable — keep the default */ }

function saveCropsSort() {
    try { localStorage.setItem('cropsSort', JSON.stringify(cropsSort)); } catch (e) { /* ignore */ }
}

function sumCropArea(fields, cropKey) {
    const byCrop = new Map();
    fields.forEach(f => {
        const crop = f[cropKey];
        if (!crop) return;
        byCrop.set(crop, (byCrop.get(crop) || 0) + (parseFloat(f.area) || 0));
    });
    return [...byCrop.entries()].map(([name, totalHa]) => ({ name, totalHa }));
}

function sortCropRows(rows) {
    const { key, dir } = cropsSort;
    return rows.sort((a, b) => {
        let d = 0;
        if (key === 'ha') d = a.totalHa - b.totalHa;
        else if (key === 'name') d = translateCropName(a.name).localeCompare(translateCropName(b.name));
        else d = compareCropsGameOrder(a.name, b.name);
        return d * dir || compareCropsGameOrder(a.name, b.name);
    });
}

function cropSummaryRowsHtml(rows) {
    return sortCropRows(rows).map(crop => `
            <tr>
                <td>${translateCropName(crop.name)}</td>
                <td class="ha-value">${crop.totalHa.toFixed(2)} ha</td>
            </tr>`).join('');
}

function updateCropsSortHeaders() {
    document.querySelectorAll('#crops-table [data-sort]').forEach(th => {
        const active = cropsSort.key === th.dataset.sort;
        th.classList.toggle('is-sorted', active);
        th.setAttribute('aria-sort', active ? (cropsSort.dir > 0 ? 'ascending' : 'descending') : 'none');
    });
    const hint = document.getElementById('crops-sort-hint');
    if (hint) hint.textContent = cropsSort.key === 'game' ? t('cropsSortGame') : '';
}

function updateCropsSummary(fields) {
    if (!cropsBody) return;
    fields = fields || [];

    const mainRows = sumCropArea(fields, 'crop');
    const catchRows = sumCropArea(fields, 'catchCrop');

    if (detailCrops) detailCrops.innerText = mainRows.length;
    updateCropsSortHeaders();

    if (mainRows.length === 0 && catchRows.length === 0) {
        cropsBody.innerHTML = `<tr><td colspan="2" class="empty-row-message">${t('noPlannedCrops')}</td></tr>`;
        return;
    }

    let html = cropSummaryRowsHtml(mainRows);
    if (catchRows.length) {
        const catchTotal = catchRows.reduce((s, r) => s + r.totalHa, 0);
        html += `<tr class="crops-section-row"><td>${t('catchCropsTitle')}</td><td class="ha-value">${catchTotal.toFixed(2)} ha</td></tr>`;
        html += cropSummaryRowsHtml(catchRows);
    }
    cropsBody.innerHTML = html;
}

document.querySelectorAll('#crops-table [data-sort]').forEach(th => {
    th.addEventListener('click', () => {
        const key = th.dataset.sort;
        // ha starts biggest-first; name A→Z; the third click returns to game order.
        const firstDir = key === 'ha' ? -1 : 1;
        if (cropsSort.key !== key) cropsSort = { key, dir: firstDir };
        else if (cropsSort.dir === firstDir) cropsSort = { key, dir: -firstDir };
        else cropsSort = { key: 'game', dir: 1 };
        saveCropsSort();
        renderSeasonView();
    });
});

// =============================================================
// SECTION 8: NEW SEASON LOGIC
// =============================================================
if (newSeasonBtn) {
    newSeasonBtn.addEventListener('click', () => {
        if (!currentFarmId) return;

        const confirmNew = confirm("Are you sure you want to start a new season? Current fields will be saved to archive and cleared.");
        if (!confirmNew) return;

        const allFarms = getAllFarms();
        const farmIndex = allFarms.findIndex(f => f.id === currentFarmId);
        if (farmIndex === -1) return;

        const farm = allFarms[farmIndex];
        const currentSeasonNum = parseInt(farm.currentSeason) || 1;

        try {
            const seasonsDirPath = path.join(appDataDir, farm.folderName, 'seasons');
            if (!fs.existsSync(seasonsDirPath)) fs.mkdirSync(seasonsDirPath, { recursive: true });

            const archivePath = path.join(seasonsDirPath, `season_${currentSeasonNum}.json`);
            let archivedAvgHealth = null;
            {
                let weightedSum = 0, headCount = 0;
                (farm.animalBuildings || []).forEach(b => (b.clusters || []).forEach(c => {
                    weightedSum += c.health * c.numAnimals;
                    headCount += c.numAnimals;
                }));
                if (headCount > 0) archivedAvgHealth = weightedSum / headCount;
            }

            const archiveData = {
                season: currentSeasonNum,
                dateArchived: new Date().toISOString(),
                fields: JSON.parse(JSON.stringify(farm.fields)),
                balance: farm.balance,
                loan: farm.loan || 0,
                animals: farm.animals || 0,
                avgHealth: archivedAvgHealth
            };
            fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2), 'utf-8');

            const supplyRatesForLime = getSupplyRates();
            farm.fields.forEach((field, i) => {
                field.crop = "";
                field.sowingMonth = "";
                field.catchCrop = "";
                field.catchSowingMonth = "";
                field.state = "To Plant";
                field.tillage = null;
                // limeAppliedSeason is intentionally left untouched — it's
                // display-only metadata now (see limePh below for the actual
                // decaying value).
                // One harvest = one "New Season" click: decay this field's pH
                // by one step (soil-mix-weighted). resolveLimePh backfills a
                // field that predates this model instead of resetting it.
                const soilMix = getFieldSoilMix(fertPlanSoilKey(field, i), supplyRatesForLime);
                const resolvedPh = resolveLimePh(field, currentSeasonNum, soilMix);
                field.limePh = (resolvedPh == null) ? null : Math.max(0, resolvedPh - fieldLimePhDrop(soilMix));
                field.manure = false;
                field.fertilizer = false;
            });

            farm.currentSeason = currentSeasonNum + 1;
            saveFarmData(farm);

            isEditMode = false;
            if (editSeasonBtn) {
                editSeasonBtn.innerText = t('edit');
                editSeasonBtn.style.backgroundColor = "transparent";
                editSeasonBtn.style.color = "var(--color-black)";
            }

            viewedSeason = farm.currentSeason;
            renderSeasonView();

            alert(currentLang === 'pl'
                ? `Sukces! Sezon ${currentSeasonNum} zarchiwizowany.\nWitaj w Sezonie ${farm.currentSeason}!`
                : `Success! Season ${currentSeasonNum} archived.\nWelcome to Season ${farm.currentSeason}!`);

        } catch (err) {
            console.error(err);
            alert("Error: Could not create a new season.");
        }
    });
}

if (resetSeasonsBtn) {
    resetSeasonsBtn.addEventListener('click', () => {
        if (!currentFarmId) return;

        const confirmReset = confirm("WARNING: Are you sure you want to reset all seasons? This will permanently DELETE all archived season history!");
        if (!confirmReset) return;

        const allFarms = getAllFarms();
        const farmIndex = allFarms.findIndex(f => f.id === currentFarmId);
        if (farmIndex === -1) return;

        const farm = allFarms[farmIndex];

        const seasonsDirPath = path.join(appDataDir, farm.folderName, 'seasons');
        if (fs.existsSync(seasonsDirPath)) {
            try {
                fs.rmSync(seasonsDirPath, { recursive: true, force: true });
            } catch (err) {
                console.error("Błąd podczas usuwania archiwum:", err);
                alert("Error: Could not delete season files.");
                return;
            }
        }

        farm.currentSeason = 1;
        saveFarmData(farm);

        viewedSeason = 1;

        isEditMode = false;
        if (editSeasonBtn) {
            editSeasonBtn.innerText = t('edit');
            editSeasonBtn.style.backgroundColor = "transparent";
            editSeasonBtn.style.color = "var(--color-black)";
        }

        renderSeasonView();

        alert("Success! All seasons have been reset to Season 1.");
    });
}

// =============================================================
// SECTION 9: SETTINGS LOGIC
// =============================================================
let pendingCropFiles = null;
let pendingAnimalDefFiles = null;

// Settings → animal mods found in the savegame, each with an on/off switch
// (on = the feed planner follows what the mod does in game).
function renderAnimalModsInfo(farm) {
    const box = document.getElementById('animal-mods-info');
    if (!box) return;
    if (!farm || !farm.saveGamePath) { box.innerHTML = `<p class="animal-mods-note">${t('animalModsNoSave')}</p>`; return; }
    const mods = ANIMAL_MODS || {};
    let html = '';
    if (mods.afc) {
        const afc = mods.afc;
        const scale = afc.enabled ? (afc.autoScaleByDays ? feedDaysPerPeriod(farm) : 1) * afc.customMultiplier : 1;
        const src = t('afcSource_' + afc.referenceSource) || afc.referenceSource;
        html += `<label class="animal-mod-row"><input type="checkbox" id="animal-mod-afc-toggle" ${farm.ignoreAfc ? '' : 'checked'}>
            <span><strong>AnimalFoodCalculator</strong> — ${t('afcModeLine').replace('{mode}', t('afcMode_' + afc.mode) || afc.mode).replace('{x}', scale.toLocaleString(undefined, { maximumFractionDigits: 2 })).replace('{src}', src)}</span></label>`;
    }
    if (mods.eas) {
        const species = Object.keys(mods.eas.lactation).map(tp => formatAnimalName(tp)).join(', ') || '–';
        html += `<label class="animal-mod-row"><input type="checkbox" id="animal-mod-eas-toggle" ${farm.ignoreEas ? '' : 'checked'}>
            <span><strong>EnhancedAnimalSystem</strong> — ${t('easLine').replace('{list}', escapeHtml(species))}</span></label>`;
    }
    if (!html) html = `<p class="animal-mods-note">${t('animalModsNone').replace('{d}', feedDaysPerPeriod(farm))}</p>`;
    box.innerHTML = html;
}

function refreshFarmlandInfo(farm) {
    FARMLAND_INFO = (farm && farm.showFarmlandArea && farm.saveGamePath) ? readFarmlandAreas(farm.saveGamePath) : null;
}

// Land plot area behind a field key ("12" or combined "12-13"), or null.
function farmlandAreaForKey(key) {
    if (!FARMLAND_INFO || !FARMLAND_INFO.ok || !key) return null;
    const ids = String(key).split(/[^0-9]+/).filter(Boolean).map(s => String(parseInt(s, 10)));
    if (!ids.length || ids.some(id => FARMLAND_INFO.areas[id] === undefined)) return null;
    return ids.reduce((s, id) => s + FARMLAND_INFO.areas[id], 0);
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        const farm = getAllFarms().find(f => f.id === currentFarmId);
        if (gameSavePathInput) gameSavePathInput.value = farm ? (farm.saveGamePath || "") : "";
        if (settingsMapNameInput) settingsMapNameInput.value = farm ? (farm.mapName || "") : "";
        if (autoSyncToggle) autoSyncToggle.checked = isAutoSyncEnabled();
        const flToggle = document.getElementById('farmland-area-toggle');
        if (flToggle) flToggle.checked = !!(farm && farm.showFarmlandArea);
        const modsDirInfo = document.getElementById('mods-dir-info');
        if (modsDirInfo) {
            const dirs = farm && farm.saveGamePath ? modFiles.findModsDirs(farm.saveGamePath) : [];
            modsDirInfo.textContent = dirs.length
                ? t('modsDirInfo').replace('{dir}', dirs[0]) + (dirs.length > 1 ? ' ' + t('modsDirInfoMore').replace('{n}', dirs.length - 1) : '')
                : '';
            modsDirInfo.title = dirs.join('\n');
        }
        renderAnimalModsInfo(farm);
        if (cropsFolderInput) cropsFolderInput.value = farm ? (farm.cropsSourceLabel || "") : "";
        if (animalDefsFolderInput) animalDefsFolderInput.value = farm ? (farm.animalDefsSourceLabel || "") : "";
        if (cropsLoadedInfo) {
            let info = AVAILABLE_CROPS.length > 0
                ? `${t('currentlyLoaded')}: ${AVAILABLE_CROPS.length} ${t('cropsLoaded')}`
                : t('noCropsLoadedYet');
            if (mapCropsInfo && mapCropsInfo.ok) info += ' ' + t('cropsFromMapMod').replace('{mod}', mapCropsInfo.modName);
            cropsLoadedInfo.innerText = info;
        }
        if (animalDefsLoadedInfo) {
            const animalCount = Object.keys(ANIMAL_NEEDS_DATA).length;
            animalDefsLoadedInfo.innerText = animalCount > 0
                ? `${t('animalBreedsLoaded')}: ${animalCount}.`
                : t('noAnimalDefsYet');
        }
        pendingCropFiles = null;
        pendingAnimalDefFiles = null;

        // "Adjust rates" (relocated from Zaopatrzenie) — re-rendered fresh
        // every time Settings opens so the per-crop table matches this farm's
        // current fields.
        const supplyAdjustContainer = document.getElementById('settings-supply-adjust');
        if (supplyAdjustContainer) {
            const rates = getSupplyRates();
            const cropList = [...new Set(((farm && farm.fields) || []).map(f => f.crop).filter(Boolean))].sort();
            supplyAdjustContainer.innerHTML = renderSettingsSupplyAdjust(rates, cropList);
            wireSettingsSupplyAdjust(supplyAdjustContainer);
        }

        if (settingsModal) settingsModal.style.display = 'flex';
    });
}

if (browseSaveBtn && gameSavePathInput) {
    browseSaveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const result = await ipcRenderer.invoke('show-open-dialog', {
            title: t('gameSavePathLabel'),
            properties: ['openFile'],
            filters: [{ name: 'careerSavegame.xml', extensions: ['xml'] }, { name: 'All files', extensions: ['*'] }]
        });
        if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;
        gameSavePathInput.value = result.filePaths[0];
    });
}

if (browseCropsBtn && cropsFolderPicker && cropsFolderInput) {
    browseCropsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        cropsFolderPicker.click();
    });

    cropsFolderPicker.addEventListener('change', (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        pendingCropFiles = files;

        // Best-effort friendly label for the picked root folder — purely
        // cosmetic, falls back to a file count if it can't be derived.
        let rootLabel = `${files.length} file(s) selected`;
        try {
            const first = files[0];
            const absPath = first.path || (webUtils ? webUtils.getPathForFile(first) : "");
            const relPath = first.webkitRelativePath || "";
            if (absPath && relPath) {
                const relNative = relPath.split('/').join(path.sep);
                if (absPath.endsWith(relNative)) {
                    rootLabel = absPath.slice(0, absPath.length - relNative.length).replace(/[\\/]+$/, '');
                }
            }
        } catch (err) { /* keep the file-count fallback */ }

        cropsFolderInput.value = rootLabel;
        if (cropsLoadedInfo) cropsLoadedInfo.innerText = `${t('readyToScan')} ${files.length} ${t('clickSaveImport')}`;
    });
}

if (browseAnimalDefsBtn && animalDefsFolderPicker && animalDefsFolderInput) {
    browseAnimalDefsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        animalDefsFolderPicker.click();
    });

    animalDefsFolderPicker.addEventListener('change', (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        pendingAnimalDefFiles = files;

        let rootLabel = `${files.length} file(s) selected`;
        try {
            const first = files[0];
            const absPath = first.path || (webUtils ? webUtils.getPathForFile(first) : "");
            const relPath = first.webkitRelativePath || "";
            if (absPath && relPath) {
                const relNative = relPath.split('/').join(path.sep);
                if (absPath.endsWith(relNative)) {
                    rootLabel = absPath.slice(0, absPath.length - relNative.length).replace(/[\\/]+$/, '');
                }
            }
        } catch (err) { /* keep the file-count fallback */ }

        animalDefsFolderInput.value = rootLabel;
        if (animalDefsLoadedInfo) animalDefsLoadedInfo.innerText = `${t('readyToScan')} ${files.length} ${t('clickSaveImport')}`;
    });
}

if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
        if ((pendingCropFiles && pendingCropFiles.length > 0) || (pendingAnimalDefFiles && pendingAnimalDefFiles.length > 0)) {
            let combined = {};
            let animalNeeds = {};
            let xmlCount = 0;
            let cropsFound = 0;
            let animalDefsFound = 0;
            let animalFiles = [];
            let readErrors = [];

            if (pendingCropFiles && pendingCropFiles.length > 0) {
                const r = buildCropsCalendarFromFiles(pendingCropFiles);
                combined = { ...combined, ...r.combined };
                animalNeeds = { ...animalNeeds, ...r.animalNeeds };
                xmlCount += r.xmlCount;
                cropsFound += r.cropsFound;
                animalDefsFound += r.animalDefsFound;
                animalFiles = animalFiles.concat(r.animalFiles);
                readErrors = readErrors.concat(r.readErrors);
            }
            if (pendingAnimalDefFiles && pendingAnimalDefFiles.length > 0) {
                const r = buildCropsCalendarFromFiles(pendingAnimalDefFiles);
                combined = { ...combined, ...r.combined };
                animalNeeds = { ...animalNeeds, ...r.animalNeeds };
                xmlCount += r.xmlCount;
                cropsFound += r.cropsFound;
                animalDefsFound += r.animalDefsFound;
                animalFiles = animalFiles.concat(r.animalFiles);
                readErrors = readErrors.concat(r.readErrors);
            }

            const cropCount = Object.keys(combined).length;
            const animalDefCount = Object.keys(animalNeeds).length;
            const summaryParts = [];

            // The Settings modal is only reachable from inside a farm, so a
            // current farm is guaranteed — write the map data into its folder.
            const importFarm = getCurrentFarm();

            if (!importFarm) {
                summaryParts.push(`no farm open — open a farm before importing map data`);
            } else {
                if (cropCount > 0) {
                    const generatedPath = path.join(farmDir(importFarm), 'crops_config.json');
                    try {
                        // Merge onto whatever this farm already has (e.g. from
                        // an earlier scan of a different subfolder) instead of
                        // replacing it outright, so re-importing a partial
                        // folder doesn't erase previously-imported crops that
                        // this scan simply didn't see.
                        let existing = {};
                        if (fs.existsSync(generatedPath)) {
                            try { existing = JSON.parse(fs.readFileSync(generatedPath, 'utf-8')) || {}; }
                            catch (e) { /* corrupt existing file — start fresh from this scan */ }
                        }
                        const merged = { ...existing };
                        Object.keys(combined).forEach(cropName => {
                            merged[cropName] = { ...(merged[cropName] || {}), ...combined[cropName] };
                        });
                        fs.writeFileSync(generatedPath, JSON.stringify(merged, null, 2), 'utf-8');
                        importFarm.cropsSourceLabel = cropsFolderInput ? cropsFolderInput.value : "";
                        summaryParts.push(`${cropCount} crop(s) from ${cropsFound} growth definition(s)`);
                    } catch (err) {
                        summaryParts.push(`could not save crops config (${err.message || err})`);
                        console.error('Could not save crops_config.json', err);
                    }
                }

                if (animalDefCount > 0) {
                    const generatedAnimalPath = path.join(farmDir(importFarm), 'animal_needs_config.json');
                    try {
                        let existing = {};
                        if (fs.existsSync(generatedAnimalPath)) {
                            try { existing = JSON.parse(fs.readFileSync(generatedAnimalPath, 'utf-8')) || {}; }
                            catch (e) { /* corrupt existing file — start fresh from this scan */ }
                        }
                        const merged = { ...existing, ...animalNeeds };
                        fs.writeFileSync(generatedAnimalPath, JSON.stringify(merged, null, 2), 'utf-8');
                        importFarm.animalDefsSourceLabel = animalDefsFolderInput ? animalDefsFolderInput.value : "";
                        // Remembered so they're re-read on every start (see refreshAnimalDefsFromSource).
                        importFarm.animalDefsFiles = [...new Set([...(importFarm.animalDefsFiles || []), ...animalFiles])];
                        summaryParts.push(`${animalDefCount} animal breed(s) with feed/water/straw needs`);
                    } catch (err) {
                        summaryParts.push(`could not save animal needs config (${err.message || err})`);
                        console.error('Could not save animal_needs_config.json', err);
                    }
                }

                saveFarmData(importFarm);
                loadFarmConfigs(importFarm);
                // Reflect the fresh crop list in the planner behind the modal.
                if (currentFarmId && plannerView && plannerView.style.display !== 'none' && !isEditMode) {
                    renderSeasonView();
                }
            }

            if (readErrors.length > 0) {
                summaryParts.push(`${readErrors.length} file(s) could not be read (see console for details)`);
            }

            if (summaryParts.length > 0) {
                alert(`Imported: ${summaryParts.join('; ')} (out of ${xmlCount} XML files scanned).`);
            } else {
                alert(`No recognizable crop or animal definition files found among ${xmlCount} XML file(s) scanned. Make sure you selected the right folder(s).`);
            }
            pendingCropFiles = null;
            pendingAnimalDefFiles = null;
        }

        if (autoSyncToggle) {
            localStorage.setItem(CONFIG_KEY_AUTO_SYNC, autoSyncToggle.checked ? '1' : '0');
        }

        if (settingsMapNameInput) {
            const farm = getCurrentFarm();
            if (farm) {
                const newMap = settingsMapNameInput.value.trim();
                if ((farm.mapName || "") !== newMap) {
                    farm.mapName = newMap;
                    saveFarmData(farm);
                    if (plannerTitle) plannerTitle.innerText = newMap ? `${farm.name} · ${newMap}` : farm.name;
                }
            }
        }

        // Per-farm toggles: whole-farmland area, and whether detected animal
        // mods count in the feed planner.
        {
            const farm = getCurrentFarm();
            if (farm) {
                const flToggle = document.getElementById('farmland-area-toggle');
                const afcToggle = document.getElementById('animal-mod-afc-toggle');
                const easToggle = document.getElementById('animal-mod-eas-toggle');
                const next = {
                    showFarmlandArea: flToggle ? flToggle.checked : !!farm.showFarmlandArea,
                    ignoreAfc: afcToggle ? !afcToggle.checked : !!farm.ignoreAfc,
                    ignoreEas: easToggle ? !easToggle.checked : !!farm.ignoreEas
                };
                if (Object.keys(next).some(k => !!farm[k] !== next[k])) {
                    Object.assign(farm, next);
                    saveFarmData(farm);
                    loadFarmConfigs(farm);
                    refreshFarmlandInfo(farm);
                    if (plannerView && plannerView.style.display !== 'none' && !isEditMode) renderSeasonView();
                }
            }
        }

        if (gameSavePathInput) {
            const pathToFile = gameSavePathInput.value.trim().replace(/"/g, '');
            if (pathToFile && fs.existsSync(pathToFile)) {
                const newData = readGameSave(pathToFile);
                const allFarms = getAllFarms();
                const idx = allFarms.findIndex(f => f.id === currentFarmId);
                if (idx > -1) {
                    allFarms[idx].saveGamePath = pathToFile;
                    if (newData.balance) allFarms[idx].balance = newData.balance;
                    if (newData.month) allFarms[idx].month = newData.month;
                    if (newData.loan !== null) allFarms[idx].loan = newData.loan;
                    saveFarmData(allFarms[idx]);
                    if (currentFarmId === allFarms[idx].id) openPlanner(currentFarmId);
                }
            }
        }

        // Apply the auto-sync choice immediately if a planner is open (start it,
        // restart it against a new path, or stop it — startAutoSync handles all).
        if (currentFarmId != null && plannerView && plannerView.style.display !== 'none') {
            startAutoSync(currentFarmId);
        }

        // "Adjust rates" (relocated from Zaopatrzenie) — batch-saved here like
        // every other field in this modal, in one saveSupplyRates() call.
        const supplyAdjustContainer = document.getElementById('settings-supply-adjust');
        if (supplyAdjustContainer) {
            const rates = getSupplyRates();
            const assumeEl = supplyAdjustContainer.querySelector('#supply-assume-fert');
            if (assumeEl) rates.assumeAllFertilized = assumeEl.checked;
            const num = (id) => { const el = supplyAdjustContainer.querySelector('#' + id); return el ? (parseFloat(el.value) || 0) : undefined; };
            const buffer = num('supply-buffer'); if (buffer !== undefined) rates.bufferPct = buffer;
            const nDensity = num('supply-n-density'); if (nDensity !== undefined) rates.nDensity = nDensity;
            const manureN = num('supply-manure-n'); if (manureN !== undefined) rates.manureN = manureN;
            const slurryN = num('supply-slurry-n'); if (slurryN !== undefined) rates.slurryN = slurryN;
            const digestateN = num('supply-digestate-n'); if (digestateN !== undefined) rates.digestateN = digestateN;
            supplyAdjustContainer.querySelectorAll('.supply-rate-input').forEach(inp => {
                const c = inp.dataset.supplyCrop, field = inp.dataset.supplyField;
                if (!rates.crops[c]) rates.crops[c] = {};
                const v = inp.value.trim();
                if (v === '') delete rates.crops[c][field]; else rates.crops[c][field] = parseFloat(v);
                if (Object.keys(rates.crops[c]).length === 0) delete rates.crops[c];
            });
            saveSupplyRates(rates);
        }

        if (settingsModal) settingsModal.style.display = 'none';
    });
}

if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', () => { if (settingsModal) settingsModal.style.display = 'none'; });

// =============================================================
// SECTION 10: DASHBOARD LOGIC (FARM MANAGEMENT)
// =============================================================
function renderFarmList(farms) {
    const container = document.querySelector('.farm-list');
    if (!container) return;
    container.innerHTML = "";
    farms.forEach(farm => {
        const item = document.createElement('div');
        item.className = 'farm-item';
        const actionButton = deleteMode
            ? `<p class="delete-btn-circle" onclick="prepareDelete('${farm.id}')"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></p>`
            : `<p class="select-btn" onclick="openPlanner('${farm.id}')"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></p>`;

        item.innerHTML = `
            <div class="farm-details">
                <span class="farm-name">${farm.name}${farm.mapName ? ` <span class="farm-map">${farm.mapName}</span>` : ''}</span>
                <span class="farm-dates">${t('lastEdited')}: ${farm.lastEdited}</span>
            </div>
            <div class="farm-item-actions">
                <p class="export-btn-circle" onclick="exportFarmBackup('${farm.id}')" title="${t('exportBackup')}"><i class="fa-solid fa-download" aria-hidden="true"></i></p>
                ${actionButton}
            </div>
        `;
        container.appendChild(item);
    });

    // Keep the "N farms tracked" Discord line in sync with add / delete / import.
    if (typeof updateDiscordPresence === 'function') updateDiscordPresence();
}

// =============================================================
// SECTION 12: BACKUP EXPORT / IMPORT
// =============================================================
// The backup bundle just mirrors the farm's folder: every .json under it
// (data.json, monthly.json, seasons/*, backups/*, crops_config.json, …) is
// walked and stored by its relative path. New file types added later are
// therefore backed up automatically — nothing here needs updating for them.

function collectFarmFolderFiles(rootDir) {
    const out = {};
    const walk = (dir, rel) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch (err) { return; }
        entries.forEach(entry => {
            const abs = path.join(dir, entry.name);
            const relPath = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(abs, relPath);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
                try { out[relPath] = JSON.parse(fs.readFileSync(abs, 'utf-8')); }
                catch (err) { /* skip a corrupt/unreadable file rather than fail the whole export */ }
            }
        });
    };
    walk(rootDir, '');
    return out;
}

function writeFarmFolderFiles(rootDir, files) {
    Object.entries(files || {}).forEach(([relPath, data]) => {
        // Guard against path traversal / absolute paths from a tampered backup.
        const normalized = String(relPath).replace(/\\/g, '/');
        if (!normalized || normalized.startsWith('/') || normalized.split('/').some(seg => seg === '..' || seg === '')) return;
        try {
            const dest = path.join(rootDir, normalized);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) { /* non-fatal — restore the rest of the files */ }
    });
}

window.exportFarmBackup = async function (farmId) {
    const farm = getAllFarms().find(f => f.id === farmId);
    if (!farm || !farm.folderName) return;

    const files = collectFarmFolderFiles(path.join(appDataDir, farm.folderName));
    // Make sure the bundle reflects any unsaved in-memory edits to the farm.
    files['data.json'] = farm;

    const bundle = {
        exportFormat: 'farmer-planner-backup',
        exportVersion: 2,
        exportedAt: new Date().toISOString(),
        farm: farm,
        files: files
    };

    const safeName = (farm.name || 'farm').replace(/[/\\?%*:|"<>]/g, '-');
    const result = await ipcRenderer.invoke('show-save-dialog', {
        title: t('exportBackup'),
        defaultPath: `${safeName}_backup.json`,
        filters: [{ name: 'Farmer Planner Backup', extensions: ['json'] }]
    });

    if (result.canceled || !result.filePath) return;

    try {
        fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), 'utf-8');
        alert(t('exportSuccess'));
    } catch (err) {
        alert(t('exportError'));
    }
};

window.importFarmBackup = async function () {
    const result = await ipcRenderer.invoke('show-open-dialog', {
        title: t('importBackup'),
        properties: ['openFile'],
        filters: [{ name: 'Farmer Planner Backup', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

    let bundle;
    try {
        bundle = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
    } catch (err) {
        alert(t('importErrorRead'));
        return;
    }

    if (!bundle || bundle.exportFormat !== 'farmer-planner-backup' || !bundle.farm) {
        alert(t('importErrorFormat'));
        return;
    }

    // Always create a new farm folder rather than overwriting anything —
    // safer default, and it's also how you'd bring a farm onto a second
    // computer without clobbering whatever's already there. Folder is
    // named after the new id, same reasoning as everywhere else — see
    // migrateFarmFolderToId().
    const newId = Date.now().toString();
    const newFolderPath = path.join(appDataDir, newId);
    fs.mkdirSync(newFolderPath, { recursive: true });

    if (bundle.files && typeof bundle.files === 'object') {
        // v2 backup — restore the whole folder as it was.
        writeFarmFolderFiles(newFolderPath, bundle.files);
    } else {
        // v1 backup — reconstruct from the old named sections.
        const seasonEntries = Object.entries(bundle.seasons || {});
        if (seasonEntries.length > 0) {
            const seasonsDir = path.join(newFolderPath, 'seasons');
            fs.mkdirSync(seasonsDir, { recursive: true });
            seasonEntries.forEach(([seasonNum, seasonData]) => {
                fs.writeFileSync(path.join(seasonsDir, `season_${seasonNum}.json`), JSON.stringify(seasonData, null, 2), 'utf-8');
            });
        }
        if (Array.isArray(bundle.monthly) && bundle.monthly.length > 0) {
            fs.writeFileSync(path.join(newFolderPath, 'monthly.json'), JSON.stringify(bundle.monthly, null, 2), 'utf-8');
        }
        if (bundle.mapConfig && typeof bundle.mapConfig === 'object') {
            Object.entries(bundle.mapConfig).forEach(([fname, data]) => {
                if (!/^(crops_config|animal_needs_config)\.json$/.test(fname)) return;
                try { fs.writeFileSync(path.join(newFolderPath, fname), JSON.stringify(data, null, 2), 'utf-8'); }
                catch (err) { /* non-fatal — farm still restores without its map data */ }
            });
        }
    }

    // Rewrite data.json last so the restored farm gets a fresh id/folderName and
    // can't collide with a farm that's already there.
    const restoredFarm = {
        ...bundle.farm,
        id: newId,
        folderName: newId,
        lastEdited: new Date().toLocaleDateString()
    };
    fs.writeFileSync(path.join(newFolderPath, 'data.json'), JSON.stringify(restoredFarm, null, 2), 'utf-8');

    renderFarmList(getAllFarms());
    alert(t('importSuccess'));
};

if (importBackupBtn) importBackupBtn.addEventListener('click', () => { window.importFarmBackup(); });

if (addFarmBtn) addFarmBtn.addEventListener('click', () => { if (addFarmModal) addFarmModal.style.display = 'flex'; if (newFarmInput) newFarmInput.focus(); });
if (cancelAddBtn) cancelAddBtn.addEventListener('click', () => { if (addFarmModal) addFarmModal.style.display = 'none'; if (newFarmInput) newFarmInput.value = ""; if (newFarmMapInput) newFarmMapInput.value = ""; });

if (confirmAddBtn) {
    confirmAddBtn.addEventListener('click', () => {
        if (!newFarmInput) return;
        const farmName = newFarmInput.value.trim();
        if (farmName) {
            // Folder is named after the id, not the display name — see
            // migrateFarmFolderToId() for why. The id (a timestamp) is
            // already unique, so there's no sanitizing or collision
            // counter needed here at all.
            const newId = Date.now().toString();
            fs.mkdirSync(path.join(appDataDir, newId));

            const newFarm = {
                id: newId,
                name: farmName,
                mapName: newFarmMapInput ? newFarmMapInput.value.trim() : "",
                folderName: newId,
                lastEdited: new Date().toLocaleDateString(),
                balance: "0 €",
                currentSeason: 1,
                yearNumber: 1,
                fields: [],
                fieldSizes: {}
            };
            saveFarmData(newFarm);
            if (addFarmModal) addFarmModal.style.display = 'none';
            newFarmInput.value = "";
            if (newFarmMapInput) newFarmMapInput.value = "";
            renderFarmList(getAllFarms());
        }
    });
}

if (deleteToggle) {
    deleteToggle.addEventListener('click', () => {
        deleteMode = !deleteMode;
        deleteToggle.innerText = deleteMode ? t('cancelDelete') : t('deleteFarm');
        deleteToggle.style.color = deleteMode ? "var(--color-rust)" : "";
        renderFarmList(getAllFarms());
    });
}

window.prepareDelete = function (id) {
    farmIdToDelete = id;

    const modal = document.getElementById('confirm-delete-modal') || document.querySelector('.confirm-delete-modal') || document.getElementById('farm-delete-modal');

    if (modal) {
        modal.style.display = 'flex';
    } else {
        alert("Błąd. Nie znaleziono modalu usunięcia w index.html. Ustaw ID okienka na 'confirm-delete-modal'.");
    }
};

if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', () => {
        if (!farmIdToDelete) return;

        const farms = getAllFarms();
        // String() guards against an old/edited data.json where "id" ended up
        // as a number instead of a string — strict === would silently never
        // match and the farm would just stay in the list with no error.
        const farmToKill = farms.find(f => String(f.id) === String(farmIdToDelete));

        if (!farmToKill) {
            console.error('Delete failed: no farm found with id', farmIdToDelete);
            alert(t('deleteErrorNotFound'));
        } else if (!farmToKill.folderName) {
            console.error('Delete failed: farm has no folderName', farmToKill);
            alert(t('deleteErrorNoFolder'));
        } else {
            const folderPath = path.join(appDataDir, farmToKill.folderName);
            if (!fs.existsSync(folderPath)) {
                console.error('Delete failed: folder does not exist on disk', folderPath);
                alert(t('deleteErrorMissingOnDisk'));
            } else {
                try {
                    fs.rmSync(folderPath, { recursive: true, force: true });
                } catch (err) {
                    console.error('Delete failed:', err);
                    alert(t('deleteErrorLocked'));
                }
            }
        }

        if (deleteModal) deleteModal.style.display = 'none';
        renderFarmList(getAllFarms());
        farmIdToDelete = null;
    });
}

if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', () => { if (deleteModal) deleteModal.style.display = 'none'; farmIdToDelete = null; });

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
    const btn = tq(`.farm-list [onclick*="'${tut.demoId}'"]`);
    return btn ? btn.closest('.farm-item') : null;
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
    return el ? (parseFloat(String(el.value).replace(',', '.')) || 0) : 0;
}

// ---------- demo farm ----------
function seedDemoFarm(farm) {
    const pl = currentLang === 'pl';
    const lime = (ph, season) => ({ limePh: ph, limeAppliedSeason: season });
    const field = (number, area, crop, sowingMonth, state, tillage, extra) => ({
        number, area, crop, sowingMonth, state, tillage,
        limeAppliedSeason: null, limePh: null, manure: false, fertilizer: false,
        ...extra
    });

    Object.assign(farm, {
        isTutorialDemo: true,
        balance: "185 400 €",
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
            field("5-6", 6.8, "Canola", "AUGUST", "Planted", "plowed", { ...lime(0.2, 1), manure: true })
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
            balance: "142 000 €",
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
        title: pl ? "Wapnowanie przed siewem pszenicy" : "Lime before sowing wheat",
        body: pl ? "Pole 5-6 ma niskie pH — wapnować po zbiorze rzepaku." : "Field 5-6 has low pH — lime it after the canola harvest.",
        months: ["SEPTEMBER", "OCTOBER"],
        tags: [pl ? "wapno" : "lime"],
        checklist: [
            { text: pl ? "Kupić 20 000 l wapna" : "Buy 20,000 l of lime", done: true },
            { text: pl ? "Rozsiać na polu 5-6" : "Spread it on field 5-6", done: false }
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
        lastEdited: new Date().toLocaleDateString(),
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
    if (deleteMode && deleteToggle) deleteToggle.click();
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
            tutClick('a9', '#delete-mode-toggle', () => deleteMode === true),
            tutInfo('a10', () => { const item = tutDemoItem(); return item ? item.querySelector('.delete-btn-circle') : null; }),
            tutClick('a11', '#delete-mode-toggle', () => deleteMode === false),
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
            tutInfo('b9', '#reset-seasons-btn')
        ]
    },
    {
        id: 'c',
        prepare: tutOpenDemoPlanner,
        steps: [
            tutInfo('c1', '#fields-table'),
            tutInfo('c2', '#fields-body .badge--plant-now'),
            tutInfo('c3', () => [tq('#fields-body .badge--planted'), tq('#fields-body .badge--to-plant')]),
            tutInfo('c4', () => { const b = tq('#fields-body .badge--rotation-warn'); return b ? b.closest('tr') : null; }),
            tutInfo('c5', () => tqa('#fields-body tr.field-split-row')),
            tutInfo('c6', () => { const s = tq('#fields-body .field-number-sep'); return s ? s.closest('tr') : null; }),
            tutInfo('c7', '#fields-body .tillage-switch--readonly'),
            tutInfo('c8', () => tqa('#fields-body .treatment-chip--lime')),
            tutInfo('c9', () => tqa('#fields-body .fertplan-open-btn')),
            tutInfo('c10', '#total-ha-sum')
        ]
    },
    {
        id: 'd',
        prepare: tutOpenDemoPlanner,
        steps: [
            tutClick('d1', '#edit-season-btn', () => isEditMode === true),
            tutInfo('d2', '#fields-body .field-card'),
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
            tutInfo('h4', () => { const charts = tqa('#hub-panel-body .balance-chart-wrapper'); return charts.length ? charts : tq('#hub-panel-body'); }),
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
                () => (currentLang === 'pl' ? 'Kupić wapno' : 'Buy lime')),
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
            tutInfo('k3', () => { tutAnimalsOverview(); return tqa('#hub-panel-body > .details-category, #hub-panel-body .barn-tile-grid'); }),
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
            tutInfo('k16', () => { tutAnimalsOverview(); const charts = tqa('#hub-panel-body .balance-chart-wrapper'); return charts.length ? charts.slice(0, 3) : null; }),
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
            plan.mixer.load = [];
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
            tutInfo('i3', ['#game-save-path', '#browse-save-btn']),
            tutInfo('i4', () => { const el = tq('#auto-sync-toggle'); return el ? (el.closest('label') || el) : null; }),
            tutInfo('i5', ['#crops-folder-path', '#browse-crops-btn', '#animal-defs-folder-path', '#browse-animal-defs-btn']),
            tutClick('i6', '#settings-supply-adjust summary', () => { const d = tq('#settings-supply-adjust details'); return !!d && d.open; }),
            tutInfo('i7', '#settings-supply-adjust details'),
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
            tutInfo('j5', '#replay-tutorial-btn'),
            tutClick('j6', '#close-app-settings-btn', () => !tutModalOpen('app-settings-modal')),
            tutInfo('j7', null)
        ]
    }
];

// ---------- chapter progress ----------
function tutDoneChapters() {
    try {
        const arr = JSON.parse(localStorage.getItem(CONFIG_KEY_TUTORIAL_CHAPTERS) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

function tutMarkChapterDone(id) {
    const done = tutDoneChapters();
    if (done.includes(id)) return;
    done.push(id);
    try { localStorage.setItem(CONFIG_KEY_TUTORIAL_CHAPTERS, JSON.stringify(done)); } catch { /* per-viewer nicety only */ }
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
    localStorage.setItem(CONFIG_KEY_TUTORIAL_DONE, '1');
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

// =============================================================
// SECTION 11: INITIALIZATION
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Crop calendar / animal-needs are per-farm now — loaded by loadFarmConfigs()
    // when a farm is opened, not here (no farm is active on the dashboard).
    applyLanguage(currentLang);

    // Leftover from a tutorial that was interrupted by closing the app.
    removeDemoFarm();

    renderFarmList(getAllFarms());
    if (dashboardView) dashboardView.style.display = 'flex';
    if (plannerView) plannerView.style.display = 'none';

    updateDiscordPresence();

    if (localStorage.getItem(CONFIG_KEY_TUTORIAL_DONE) !== '1') startTutorial();
});