# Changelog

All notable changes to Farmer Planner. Installers for every version are on the [Releases](https://github.com/WiktorParylak/farmer-planner/releases) page.

## 0.9.9 — unreleased

**New**
- **Cancel in Edit season**: a *Cancel* button next to *Save changes* leaves edit mode without saving. With unsaved changes it asks first — so do *Exit*, *New season* and *Reset seasons* while editing. *New season* is hidden during editing.
- **Multiplayer saves**: the app reads your own farm's data (money, loans, land, animals, feed, vehicles) instead of always farm 1. A save with several farms gets a *Your farm in this savegame* choice in Settings; single-player saves need nothing.
- **Currency**: money is shown in the currency set in the game (€, $ or £, from `gameSettings.xml`), or one picked per farm in Settings. The balance is stored as a number; farms saved by older versions are read as before.
- **Language on first start**: the very first time the app opens it asks for the language (Polski / English) before anything else, so the tutorial runs in the chosen language.
- **Mods list in Settings**: every mod the app can read — Precision Farming, AnimalFoodCalculator, EnhancedAnimalSystem, Animal Package (vanilla edition), Bank And Credit, Enhanced Loan System — with whether it is in the farm's savegame and a per-farm on/off switch. Off means base-game rules for that part (e.g. Precision Farming off: flat seed rates, no soil import). Replaces the animal-mods-only list.
- **Hire Purchasing** (FS25_HirePurchasing): vehicles bought on hire purchase count as loans — what is still owed (remaining monthly payments plus the final fee, calculated like the mod does) is added to the credit, and the Finance tile shows the deals and their monthly payment. Listed in the mods list with its own switch.
- **Update notice**: at start-up the app checks GitHub Releases and, when a newer version is out, shows a popup with a button that opens its download page (*Later* closes it until the next start). App settings have *Check now*, the installed version and a switch to turn the start-up check off. Not shown while the tutorial runs.
- **Weeds** (Zabiegi column): a chip per field — nothing / to spray / done, click to switch. Synced from the savegame: live weeds on the field (fields.xml *weedState* 1–6) mark it *to spray*, dead ones (7–9) *done*. Cleared with a new season.
- **Grassland age**: grass, meadow, alfalfa and clover show how many seasons in a row they've been on the field (*season 3*), highlighted once it's time to plough up — after 4 seasons by default, set per farm in Settings. The cuts window shows it too.
- **Overdue**: a field that isn't sown when its crop's sowing window has just ended (up to 3 months ago, from the map's crop calendar) shows a red *Overdue* instead of *To plant*.
- **Soil mix bar** under the field area: the shares of the field's soil types (when its soil is known), with the percentages on hover.
- **New season reminder**: when a year has gone by in the game since the current season started, the app offers to start a new season (once per in-game year).
- **Undo new season**: right after a new season, Settings (danger zone) has *Undo new season N* — it brings back the fields and fertilization plans from before and removes the archive it wrote.
- **Restore an earlier fields table**: Settings (danger zone) lists the saved versions of the fields table (before editing / after saving, with date and field count) and puts the chosen one back; the current one is backed up first.
- **Fields from game** button next to *Edit*: adds the fields you own in the savegame that aren't in the table yet (number and area), fills in empty areas from the game (Precision Farming's field area, summed for joined numbers like *12-13*) and marks a field sown when its planned crop is what's growing there. An area you typed yourself stays and overrides the game's; split fields keep theirs. The planned crop is never changed. The table is backed up first.
- **Work list per field** (*Prace*): a button next to the state shows the field's next job. Without a list of your own it suggests one from the sowing month — before sowing: cultivate (or plow) and lime, then sow and roll, after sowing: fertilizer and weeds; with a catch crop its jobs come first (fertilize, mow, bale, collect & wrap). Click it to tick jobs off, move them, add or remove — the list then becomes the field's own. Ticking *Sow* marks the field sown. Cleared with a new season.
- **Leased fields**: in Edit season a field can be marked *leased*, for how many seasons and what then (buy out / give back). Leased fields get their own amber stripe on the side (next to the blue one of split fields) and a *Lease 2/5* counter, red with the next step once the term is reached.
- **Field Leasing** (FS25_FieldLeasing): plots leased in the game are marked on their fields automatically — *Lease · 7 mo.* with the monthly fee and whether the mod's minimum term is over (then it can be given back). A lease that ends in the game is cleared; leases you set yourself stay. Listed in the mods list with its own switch.

**Changed**
- **Year from the game**: a farm linked to a savegame shows the in-game year in the header (read-only; it turns over in March, like in the game). Only farms without a save keep the hand-edited counter.
- **Fertilizer shopping list**: a field marked *Synthetic fertilizer applied* drops off the list (it used to be the other way round). With *Count every crop field* off, only fields with a fertilization plan are listed.
- **Fertilization plans start over each season**: *New season* stores them in the season archive and clears them, so last year's "N already in the soil" doesn't come back.
- Opening a farm or an auto-sync with nothing new in the save no longer rewrites the farm data or shows the *synced* toast.
- *Last edited* on the farm list changes only when you edit the farm (not on sync) and is shown in your language's date format.
- Buttons on the start screen, the season header and the delete dialog are real buttons (keyboard and screen reader friendly).
- Leftover English-only texts are translated: map data import summary, field tooltips, title bar buttons, save error.
- **Auto-sync is per farm and on by default** for a farm with a savegame (it used to be one app-wide switch, off by default). A farm where you had switched it off stays off.
- **Catch crop list** offers only real catch crops — green rye, oilseed radish and grass — instead of every crop. A catch crop saved before stays selectable.
- **Notes fold and unfold**: a note shows its title, months, tags and checklist progress; click the title to unfold the text and checklist (notes for the current month start unfolded). Line breaks in the text are kept. Clicking a tag shows only notes with that tag.
- The *Soil* column is now *Treatments* (it holds lime, rolling and weeds). Tillage (plowed / no-till) can be clicked straight in the table like the other chips, no Edit season needed.
- The table footer shows the **planned** area (fields with a crop) and how much of it is **sown**, instead of one total of every row.
- The cuts window no longer has a sowing month — only the cuts.
- **Reset seasons** moved from the side menu to the farm Settings, into a *danger zone* at the bottom — it no longer sits right above *Exit*.
- The season arrows are real buttons (keyboard works); while editing they're greyed out with a hint to save or cancel first.
- Field backups are capped at the newest 20 per farm (they used to pile up forever and bloat farm exports).
- **Tutorial refreshed** for 0.9.9: new steps for the work list, weeds, grassland & currency settings, the danger zone and the update check; the table, edit, notes and new-season steps describe overdue sowing, the soil bar, leases, *Fields from game*, Cancel, folding notes and the year reminder.
- **Simpler fields table**: the next job is a small line under the state instead of a second badge, grassland age is part of the cuts badge (*Cuts 1/2 · season 4*), a lease is a small caption under the field number, tillage is one chip that cycles plowed → no-till → none, and the plot area fits on one line — rows are lower and calmer.

**Fixed**
- A row with a crop or area but no field number is highlighted and the save stops, instead of the row silently disappearing.
- Nitrogen density and manure / slurry / digestate N used different fallback values in different places (0.22 vs 0.5, 0.005 vs 0.007); now one set everywhere.
- **Monthly history after a new career**: when the farm's savegame goes back in time by a year or more (or the farm is linked to another save), the app asks whether to continue the Finance / Animals history with it or start a new one (the old one is kept in a file). Before, the charts silently stopped updating.
- Peas (PEA, e.g. on the Krajów map) are called *Zielony groszek* in Polish, not *Groch* — the game's crop is green peas.
- A tag typed in a note but not confirmed with Enter is saved with the note (a comma also adds a tag).
- The *same crop as last season* warning works for split fields (one number, two crops) — before, the second crop hid the first.
- A new season no longer overwrites an existing archive with the same season number — the old file is kept under another name.
- **Security**: names and translations read from mods and the savegame (crop names and titles, feed mixers, mixer wagons) can no longer carry HTML into the app — markup characters are dropped when they're read.
- **Narrow window**: below ~1180 px the planner no longer slides under the header — the table and crop list scroll together from the top, the header wraps, and the fields table scrolls sideways instead of being cut off.

## 0.9.8 — 2026-10-02

**New**
- **Day of the month in the header**: the month in the planner header shows the in-game day next to it (e.g. *March 2*), read from the savegame and refreshed by auto-sync. With one day per month only the month is shown.
- **Predicted yields for past seasons**: the Predicted yields panel opens on the season shown in the planner, and a *‹ Season N ›* switcher steps through archived seasons. They are calculated from the fields as they were when the season was archived.
- **EnhancedAnimalSystem milk**: milk output in the Animals view follows the mod's lactation curve. Milk depends on the months since the last birth (peak ×1.2 in month 2, falling to 0 by month 19). There is no milk before the first birth or from 80 % pregnancy (dry cows). Each herd group shows its current milk factor (*milk ×1.15* or *dry*).

**Changed**
- **New season and Reset seasons use in-app dialogs** instead of the system message boxes, in Polish or English: a confirmation that says what will happen, then a short result message. Reset is shown in red as a destructive action.
- **Grassland stays sown across seasons**: with a new season, fields with grass, meadow, alfalfa or clover keep their crop, sowing month and tillage and stay marked as sown. Only that season's work (cuts, catch crop, rolling, manure, fertilizer) is cleared.
- The Animals view's daily food need per barn now uses EnhancedAnimalSystem's lactation food factor, the same as the Feed planner.
- Tutorial: the *New season* and lime steps mention the grassland that stays sown and the crops that don't lower pH.

**Fixed**
- Oilseed radish and rice no longer lower soil pH with a new season (`consumesLime="false"` in the game's crop files, like grassland).

## 0.9.7 — 2026-09-30

**New**
- **Mods outside the default folder are found**: the app now looks in the folder set in the game's `gameSettings.xml` (*modsDirectoryOverride*) and in every **FSG Mod Assistant** collection, not only in `FarmingSimulator2025\mods`. The folder holding most of the savegame's mods is used first, so a savegame from a collection that isn't active right now still works. This applies to the map's crops, field soils and land plots, animal mods (AnimalFoodCalculator, EnhancedAnimalSystem), mixer wagon capacities and breed pictures.
- Settings shows which mods folder the farm uses (hover to see all searched folders).
- **Feed mixers** in the Feed planner: productions you own whose recipes make feed — pig food, TMR or mineral feed (e.g. Food Mixer Silo, Small Food Mixer, Lizard Mixed Food) — are found automatically. Each shows its product stock and capacity, how much it can make per month with the recipes switched on, the recipes and the ingredients waiting to be mixed; mixers for the selected barn's animals are highlighted, and a warning shows when no recipe is on.
- **Cuts (Pokosy) for grassland**: grass, meadow, alfalfa, clover (and mod grasses like teff) show a *Cuts* button instead of the sown badge. It opens a timeline — sowing month, then each cut with its month, use (grass / hay / silage / sale) and done-checks (harvested, fertilized, limed, rolled), and *Add cut*. The table badge shows done/planned cuts, and the feed planner counts each planned cut into its use instead of the global cuts-per-year.
- **Quick edits in the fields table** (current season, no Edit season needed): click the state badge to mark a field sown / not sown, click the rolling chip to switch rolling, click the lime chip to lime the field (or lime again when it runs low, or undo a mistaken liming) — lime asks first in a small dialog.
- **Rolling**: an "I want to roll" checkbox per field in Edit season and a chip next to lime in the table; cleared with a new season like the other treatments.
- Feed mixer recipes and names are translated: base-game ingredients (hay, alfalfa hay, water, silage…) by the app, a mod's own ingredients and the mixer's shop name from that mod's translations (e.g. Castile and León's crushed cereal, feed flour, chopped tubers). Mixers a mod makes practically instant show "no real limit" instead of an absurd monthly rate.
- Feed mixers can be renamed (pencil next to the name, like barns); the name is used everywhere the mixer shows up. Empty name restores the one from the mod.
- **Pigs can be fed from a mixer**: a pig-food mixer appears as a feed choice for pigs (*Mixer feed · name*). Their need then follows the mixer's recipe — the crops it takes (e.g. maize + barley + soy, a third each; the switched-on recipe, else the first) — minus the ready pig food in stock. Also selectable in the Animals panel.
- Rye, triticale, millet and buckwheat count as pig/chicken feed (grain, base, protein) like in the maps' animal food settings.
- Feed in the mixers and ready-mixed pig food / TMR anywhere on the farm (silos, pallets) now count toward feed stock — pig food split like the game's pig mixture (base 50%, grain 25%, protein 20%, root crops 5%).

**Changed**
- **Animals view redesigned** to match Finance: tiles for head count (change vs last month), average health, pregnant animals (next birth) and feed (which buildings run low), the buildings under their own heading, and full-width charts for animals, average health (0–100% scale) and milk production with gridlines, year marks, end values and a hover readout.
- **Finance view redesigned**: a row of tiles (balance with the change vs last month, loan with mod loans and monthly payment, change this season, play time), a full-width month-by-month balance chart with gridlines, year marks, the current value labelled and a hover readout (month, balance, loan, change), season-end balances as bars, and the numbers as an optional table. Loan is a dashed amber line when there is one.
- **Tutorial refreshed** for the new interface: the Finance and Animals steps point at the new tiles and charts (they highlighted a chart that no longer existed), a new *Cuts* step (the practice farm now has a grass field), and the table steps mention the one-click sown badge, rolling chip and lime dialog. The farm-settings steps cover the found mods folder (Mod Assistant collections), the land plot area option and automatically detected animal mods.

**Fixed**
- Grassland (grass, meadow, alfalfa, clover) no longer loses lime with a new season: these crops have consumesLime="false" in the game and map files, so cutting them doesn't lower pH (cereals, maize and green rye still do). In the cuts plan, ticking *limed* limes the field (pH 100%) and *rolled* switches the field's rolling chip.
- Lime chip in Edit season didn't change when clicked (it only changed after saving); freshly limed is now green instead of pale beige, so a limed field stands out, and the letter stays readable on a filled chip.
- The state checkbox in a field card had no caption — it now says "Sown".
- Breed pictures and mixer wagon capacities ignored a mods folder set in `gameSettings.xml`.
- Feed planner ingredient tiles: when other barns eat the same feed (e.g. straw), the tile now says the shortfall and "you have" are for all barns, and shows the all-barns need next to this barn's.
- Some crop names (spelt, mustard, flax, vetch-rye, mustard cover, field grass) were shown in English in the Polish interface.
- Crops of mod maps that name them in their own language (e.g. *Centeno*, *Lavanda* on Castile and León) now show the map's translated name — in the app's language when the map has it, else its English name through the app's dictionary (Centeno → Rye → Żyto). Polish names added for Castile and León's forage poplar, teff, lavender, mint, thyme & rosemary and orchard fruits.

## 0.9.6 — 2026-09-29

**New**
- **Crops from the map mod, automatically**: when a farm is linked to a savegame, the map's crop list, calendar and in-game menu order are read straight from the map mod (unpacked folder or .zip) — e.g. rye, green rye and triticale on Krajów, clover and alfalfa on Solek. Importing a crops folder is now only a fallback.
- **Catch crops**: each field can have a catch crop (green rye, oilseed radish…) with its own sowing month. It shows under the crop in the fields table, in its own *Catch crops* section of the crops summary (not added to the main total, so hectares aren't counted twice), in Supplies (seed), Predicted yields and the Feed planner (green rye defaults to silage).
- **Animal mods in the Feed planner**: AnimalFoodCalculator (scaling mode, multiplier, days per month and its reference curves — own animals.xml / Animal Package / base game) and EnhancedAnimalSystem (more food for cows/sheep after calving) are read from the savegame and the mods. Settings shows what was found, with a switch per mod.
- **Bank And Credit mod** (FS25_BankCredit): its loans (`bankCredit.xml`) count in the loan total and the finance charts, and Finance shows how many are active and the total monthly payment. Auto-sync picks up changes to it.
- **Whole land plot area** (optional, Settings): the farmland area next to each field's area and the total land owned, counted from the map's farmland layer like the game does.
- Sorting: click the fields table headers (field no., ha, crop in game order, sowing month from the current month, state) or the crops summary headers (crop, ha); a third click returns to the default.

**Changed**
- The crops summary is now read-only — it lists what's planted on the fields. The crop picker in *Edit season* offers every crop of the farm's map instead of a hand-made list, and the *Edit crops* button is gone.
- Feed planner: in the base game an animal's monthly food/straw no longer gets multiplied by days per month (the game keeps monthly consumption the same whatever the day count); only AnimalFoodCalculator's day scaling does that now.
- Compact layout for a maximized Full HD window with Windows display scaling (125–150%): the fields table and the menu fit without scrollbars.
- Tutorial: the *Crops* chapter covers the automatic summary, sorting and catch crops.

**Fixed**
- *Edit* could stay disabled (greyed out, even after a new season) after editing the crop list with no crops saved.
- The map field in *Add new farm* had no label.
- Feed planner parameters (grass cuts, chaff yield, straw yield): inputs no longer misaligned under their labels.

## 0.9.0.5 — 2026-09-28

**New**
- **Mixer wagon** in the Feed planner: mixer wagons and bales are read from the savegame (capacity from the wagon's mod file, or typed in once), the wagon is loaded from whole or half bales plus loose products, **Fill to recipe** loads it automatically, and the mix is checked against the game's allowed TMR ranges — with how many days the load feeds the barn.
- Animal definitions are re-read from the imported `animals.xml` file(s) every time a farm is opened, so changes to them show up without importing again.

**Changed**
- The TMR recipe is no longer editable — the game's default (40% hay, 40% silage, 15% straw, 5% mineral feed) is always used.
- Tutorial updated for the new UI: a new *Feed planner & mixer wagon* chapter, reproduction and ration steps in *Animals*, and the soil import in *Farm tools*.

**Fixed**
- Settings → Adjust rates: the per-crop rates table no longer splits each crop over two rows.
