# Changelog

All notable changes to Farmer Planner. Installers for every version are on the [Releases](https://github.com/WiktorParylak/farmer-planner/releases) page.

## 0.9.12 — unreleased

**New**
- **Field names**: give a field your own name (*Behind the barn*) in the field window. It belongs to the field number, so it stays in every season and on every crop row of that field, follows the number when you change it in Edit, and is shown under the number in the plan and in *Field soil type*.
- **Search in the season plan**: a search box next to the season title filters the fields by number, name or crop (main or catch crop, in the app's language), ignoring case and Polish/German letters (*laka* finds *Łąka*). It shows *2 of 13*, the planted-area total still counts every field, and **Ctrl+F** jumps to it; Esc clears it. Hidden while editing the season.
- **Combined fields add up their hectares**: in Edit, typing or extending a field number (`10-11-12`, or a new row's number) fills in its area as the sum of those fields — from the farm's saved field sizes and rows, otherwise from the save's real field areas (Precision Farming) — with *Sum of fields 10 + 11 + 12* under it. An area you typed yourself and rows shared by several crops are left alone; a field with no known area shows *Area of field 11 unknown — type it in* instead of a guess.
- **Notes pinned to fields**: a note can be tied to one or more fields (*Fields (optional)* in the note editor). The list shows them as chips (*Field 1 · Behind the barn*) — click one, or use the new *All fields* filter, to see only that field's notes — and the field window has a *Notes* section with the notes for that field.
- **Diagnostic file for bug reports**: *Settings → Help → Save diagnostic file* writes one `.json` with the app, Electron and Windows versions, the app's settings, the chosen farm's data (as in a backup), the savegame's small XML files (career, farms, fields, farmlands, Precision Farming, buildings, leases) and the app's recent warnings and errors — enough to reproduce a problem without asking for the whole save. Your Windows user folder is written as `%USERPROFILE%`; nothing is sent, you attach the file yourself. *Report on GitHub* and *Contact form* open the issue page and the website's contact form.

**Fixed**
- **Weeds marked as done came back as *to spray***: weeds set by hand (the chip or the work planner) were overwritten with the save's state every time the farm was opened or synced, so a field still showing live weeds in the save — the game hadn't saved since spraying, or its per-field value lagged behind — went back to *to spray*. Your choice now stays until the game saves a different weed state for that field (sprayed, or regrown), and is cleared with the season.
- **Notes didn't know the current month without a savegame**: *This month* and the highlighted notes now follow the month in the header, also on farms that aren't synced with the game.

**Changed**
- **Note checklists start over every year**: notes repeat every in-game year, so a ticked checklist item now counts as done only in the year it was ticked — next year the list is clear again. Items ticked before this version count as done in the current year.
- **Deleting a farm without a delete mode**: the *Delete farm* button and its mode are gone — every farm on the list has its own bin next to *Export*. The dialog names the farm, says what goes with it and has *Export a backup first*, which saves the backup and asks again (*Backup saved: …*). The tutorial step follows.
- **Manual import folded away**: in farm *Settings → Advanced*, the crops and animal-definition folders are now under a folded *Advanced: manual import* (open only when the farm already uses one) — the map's crops and the animals are read from the save without them. The animals hint no longer sends you to the game's install folder: the base game's `animals.xml` is packed in the game's archives and isn't needed.
- **App settings in a file**: language, Discord, update check, tutorial progress and the table sorting are now kept in `Documents\Farmer Planner\settings.json`, next to the farms, instead of the app's browser storage — so they're in your backups and come along when you copy the folder to another computer. They're moved over automatically on the first start.
- **One dialog for questions and messages**: deleting a note, a custom feed or a farm, backup export/import results, import summaries and errors now use the app's own dialog (title, icon, red button for deleting) instead of the plain Windows boxes. The farm delete dialog names the farm. Two older dialog windows were merged into it.
- **Update window opens farmerplanner.pl**: *Open the download page* now goes to the new version on the website's Versions page (in the app's language), with what changed and the installer, instead of the GitHub release.
- **README** follows the layout and texts of the new website, [farmerplanner.pl](https://farmerplanner.pl).
- **Code**: all texts (interface, tutorial, month / crop / animal / product names) moved from `renderer.js` into `src/renderer/translations.js`, and the tutorial into `src/renderer/tutorial.js`.
- **Code**: one function each for the animals' average health (it was computed in five places), for reading the archived seasons (balance and herd trends) and for an animal group's daily water/straw — no change in what the panels show.

## 0.9.11 — 2026-10-16

**New**
- **Test farm for development**: when the app runs from the source code (`npm start`), *Settings* has a *Developer* switch that adds a test farm built by the app itself — fields, animals, feed, history and notes covering every state the planner can show — and *Rebuild test farm* to start it over. Turning the switch off deletes it. The installed app doesn't show the switch. It replaces the old test farm kept in the repo (a copy of a real savegame) and its `tools/dev-farm.js` script.

**Fixed**
- **Undo a liming**: a field limed this season whose pH still reads low (with Precision Farming, the game's pH only changes after the next sync) asked only *Lime again?*. The dialog now also has *Undo liming*, which puts back the liming from before this season (or none). *Remove liming…* on a well-limed field does the same, so older liming history isn't lost.
- **Feed planner ignored feed in the barns**: grain (and any other feed) already lying in the barns' troughs now counts as stock, so with empty silos the planner no longer says *missing* while the Animals panel shows the barn full. The tile says how much of the stock is in the barns (*storage 12 000 (in barns: 3 000 l)*), and the Animals panel's "stock lasts N days" counts it too.
- **Decimal numbers**: areas, field sizes, trough capacities and feed amounts accept `1,5`, `1 234,5`, `1.234,5` and `1,234.5`; something that isn't a number (e.g. `1,234,5`) is no longer read as a wrong value.
- **Farm names with special characters**: a farm or map name containing `<`, `&` or quotes no longer breaks the farm list, and *Fertilizer* buttons work for crops and field numbers with quotes in them.
- **Typing soil shares or a trough capacity**: Tab or a click to the next box no longer loses focus when the panel redraws — the cursor stays where you moved it and the panel keeps its scroll position (*Field soil type*, the field window, a barn's trough capacity).
- **“Last edited” dates on the farm list**: shown in the app's language and format (e.g. *3.10.2026, 22:18*) instead of the raw saved timestamp.
- **Header before a farm loads**: no more “Solek / 1000$ / JANUARY” flashing at start; an unknown month shows `–` instead of *August*.

**Changed**
- **Change a crop without Edit**: the field window (click a field number) now has the crop, sowing month, catch crop and its sowing month at the top, saved straight away — together with the clickable state, lime, rolling and tillage chips, Edit is only needed for field numbers, areas, leases and adding or removing fields. The fertilization plan, feed use and straw follow the new crop as they do in Edit.
- **Discord Rich Presence is opt-in**: it shows your farm publicly, so the app now asks once at start (also if you've never changed the setting) and stays off until you say yes. *Settings* still switches it either way.
- **“Low feed” in days, not litres**: when the animals' needs are known, a barn is flagged as low on feed with less than 3 days left (the same red as the days figure), whether it's 2 chickens or 200 cows. Without an entered trough capacity the bar shows days of feed (full = 2 weeks) instead of comparing with your fullest barn; with a capacity it's still a real percentage.
- **“Produced per month” chart**: milk, eggs and wool are now estimated from the herd each month (breed, age, ration, lactation — the same as *Estimated daily output*) instead of the rise in the tank, which sank whenever you sold mid-month. Months recorded before this version don't have the estimate, so the old chart stays until two new months are synced.
- **More consistent look**:
  - Section headings (*Buildings*, *Barn*, *Feed*, *Mixer wagon*, the Supplies tables) all use the same small label style; card and page titles keep the display font.
  - Litres are always a lowercase *l* (`40 083 l`, `4182 l/day`), and every number uses the app language's separators — no more `13,040` next to `26 565 €`.
  - Drop-downs in panels and dialogs look like the text boxes next to them instead of plain white system boxes.
  - Dialog buttons: *Cancel* first and the main action last everywhere (also in *Settings*), sentence case (*Cancel*, *Save & import*, *Delete*), never wrapped onto two lines; a dialog with three buttons is wider so they fit on one row.
  - Sidebar: *Settings* and *Exit* are written like the menu items above them; *+ Add note* matches the other panel buttons; note edit/delete buttons are round like the rest of the icon buttons.
  - Barn tiles: health and the feed figures use the normal text font instead of the typewriter one; soil % boxes are wide enough for *100*.
  - Buttons: one shared style in three sizes (page actions, panel buttons, small buttons in tables) with the same font, border and hover everywhere — filled green for the main action, outline for the rest, amber for *Fill from plan* / *This month*, dashed for *add another*, rust for resets and deletes.
  - The app settings gear sits in the top-right corner of the *My Farms* card instead of floating in the corner of the window.
  - Text sizes come from one scale instead of 23 slightly different pixel sizes (e.g. 10.5, 12.5, 17 px).
- **Overdue sowing follows the sowing year**: the year is cut at the end of June, so *Overdue* means the crop's sowing window has passed in this July–June year. In July a field planned for April sowing shows *To plant* (next spring), not *Overdue*; a canola field not sown by October stays *Overdue* until June instead of only for three months.
- **Discord not running**: with Discord Rich Presence on, the app looks for Discord less and less often (every 5 s up to once a minute) and writes *no Discord client found* to the log once instead of every 5 seconds. It still connects as soon as Discord starts.
- **No farms yet**: the empty farm list has an *Add your first farm* button.

## 0.9.10 — 2026-10-16

**Fixed**
- **Soil bars after loading soils from the game**: going back to the plan from a panel (e.g. *Field soil type*) redraws the fields table, so the soil mix bars show the imported soils straight away instead of after reopening the farm.
- **Work list stays empty**: removing every step from a field's work list keeps it empty (*No work* in the table) instead of bringing the month-based suggestion back. A suggestion now shows only for a field that never had a list of its own, or when you click *Suggest by month*; a new season starts with the suggestion again.
- **No lime in the suggested work when the pH is fine**: *Suggest by month* adds *Lime* only when the field's pH needs it (below 75 %, or never limed) — using the game's own pH when Precision Farming is in the save — and never for crops that don't use lime up (grassland, oilseed radish, rice).

**Changed**
- **Lime chip “L”/“W”**: the letter is black (with a light outline), so it's readable at any fill and in the dark theme. A field limed this season gets a clear ring around the chip and says so on hover.
- **Clicking a well-limed field's lime chip** no longer asks to remove the liming. It shows what the chip means: the pH, the game's pH and optimum with Precision Farming, and an estimate of when lime will be needed again (*in about 2 seasons*), worked out from the usual pH drop for the field's soil and labelled as an estimate. Grass, meadows and other crops that don't use lime up say so instead of a number. Removing a liming made by mistake is a separate *Remove liming…* button with its own confirmation.
- **No weeds step on a ploughed field**: the suggested work list leaves out *Weeds* when the field is ploughed.
- **Grassland age under the crop name**: *⟳ season 3* now sits on its own line under the crop, next to the rotation icon, instead of inside the cuts badge — the State column stays narrow and the fields table no longer scrolls sideways because of it.
- **Feed planner totals**: in your own feed, shares that are off 100 % only by rounding (e.g. 33 + 33 + 33) are evened out to 100 % on save — once, on the largest ingredient — instead of being rejected; the total line says so. The mixer wagon's shares add up to exactly 100 % with a *Total* row, and mineral feed (and straw) are marked *optional* — a TMR mix without them is valid.
- **Sowing and the work list always agree**: the *Sow* step is ticked exactly when the field is sown. Switching the state badge (*To plant* ↔ *Planted*), ticking or unticking *Sow* in the work list, or *Fields from game* finding the crop growing all change both — click again to take a mistake back.

## 0.9.9 — 2026-10-12

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
- **Soil mix bar** under the field area: the shares of the field's soil types (when its soil is known) in Precision Farming's colours — loamy sand faded yellow, sandy loam faded green, loam grey, silty clay navy — with the percentages on hover.
- **New season reminder**: when a year has gone by in the game since the current season started, the app offers to start a new season (once per in-game year).
- **Undo new season**: right after a new season, Settings (danger zone) has *Undo new season N* — it brings back the fields and fertilization plans from before and removes the archive it wrote.
- **Restore an earlier fields table**: Settings (danger zone) lists the saved versions of the fields table (before editing / after saving, with date and field count) and puts the chosen one back; the current one is backed up first.
- **Fields from game** button next to *Edit*: adds the fields you own in the savegame that aren't in the table yet (number and area), fills in empty areas from the game (Precision Farming's field area, summed for joined numbers like *12-13*) and marks a field sown when its planned crop is what's growing there. An area you typed yourself stays and overrides the game's; split fields keep theirs. The planned crop is never changed. The table is backed up first.
- **Work list per field** (*Prace*): a button next to the state shows the field's next job. Without a list of your own it suggests one from the sowing month — before sowing: cultivate (or plow) and lime, then sow and roll, after sowing: fertilizer and weeds; with a catch crop its jobs come first (fertilize, mow, bale, collect & wrap). Click it to tick jobs off, move them, add or remove — the list then becomes the field's own. Ticking *Sow* marks the field sown. Cleared with a new season.
- **Leased fields**: in Edit season a field can be marked *leased*, for how many seasons and what then (buy out / give back). Leased fields get their own amber stripe on the side (next to the blue one of split fields) and a *Lease 2/5* counter, red with the next step once the term is reached.
- **Field Leasing** (FS25_FieldLeasing): plots leased in the game are marked on their fields automatically — *Lease · 7 mo.* with the monthly fee and whether the mod's minimum term is over (then it can be given back). A lease that ends in the game is cleared; leases you set yourself stay. Listed in the mods list with its own switch.
- **Real soil pH and nitrogen from Precision Farming**: with PF in the save the lime chip shows each field's actual pH (from the save's pH map) against the optimum for its soil, with the lime needed on hover; the fertilization plan takes *N already in the soil* from PF's nitrogen map (type a number to override it), so fields get a mineral-N figure without filling anything in.
- **Lime on the Supplies list**: a new *Lime* section lists every field below its soil's optimum pH with the litres to buy — exact from PF's pH map, or the app's estimate without it.
- **New farm from a savegame**: *Add farm* lists the game's savegames (name, map, money, date); picking one fills in the map and the farm opens right away, already linked to it. *No savegame* keeps planning by hand.
- **Field view**: click a field number in the table to see everything about that field in one window — soil mix (editable), pH and lime needed, nitrogen with a shortcut to its fertilization plan, feed use for the crop and catch crop, cuts or the work list, weeds and rolling, and what grew on it in past seasons.

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
- **Rolling has three states like weeds**: the chip switches nothing → to roll (red) → rolled (green) → nothing. The *I want to roll* checkbox is gone from Edit season — the chip is the only switch. A cut marked *rolled* or the *Roll* job ticked in the work list marks it done. Cleared with a new season.
- **Farm settings tidied up**: grouped into cards — *Savegame*, *Planner* (grassland limit and currency side by side), *Mods*, *Adjust rates* and the danger zone — left-aligned with short hints under each option. The rarely needed map and animal folders are folded away under *Advanced*; Save / Cancel stay visible at the bottom.
- Farm data is no longer read and parsed from disk on every lookup (dozens of times per screen refresh): each farm's file is cached while it's unchanged on disk and refreshed on save.
- **Rations per barn**: the ration picked for a barn (in Animals or the Feed planner) now applies to that barn only — two cow barns can be fed differently. Barns without their own choice keep using the species' ration from before.
- **Seed rates, yields and straw come from the farm's map**: read from the map's own crop files (and the base game's for crops the map doesn't redefine) instead of built-in tables tuned to the Solek map — on another map the predicted yields, feed planner and seed list use that map's numbers. The base game's values ship in `data/default-agronomy.json`.
- **Farm settings in tabs**: *Savegame*, *Planner*, *Mods*, *Rates* and *Advanced* (map/animal folders and the danger zone) instead of one long page. The savegame path is checked as you type — *Found: name · map · money*, or why it won't work (a wrong path used to be ignored silently); a savegame folder works as well as its careerSavegame.xml.
- **Precision Farming seed rates come from PF and the map**: the variable seed rates (low / standard / high per crop and which one PF's automatic mode picks on each soil) are read from Precision Farming itself and the map's own seed-rate table instead of a built-in copy tuned to Solek.

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
- The Animals view and the Feed planner count the daily feed need the same way (the Animals view left out EnhancedAnimalSystem's lactation factor).
- **Changing a field's number or crop no longer orphans its data**: every field now has a stable id (added automatically to existing farms), and when Edit season renumbers a field or changes its crop, its soil mix, field size, fertilization plan, feed use and straw setting move to the new number / crop.

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
