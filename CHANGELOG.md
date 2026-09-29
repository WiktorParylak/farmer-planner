# Changelog

All notable changes to Farmer Planner. Installers for every version are on the [Releases](https://github.com/WiktorParylak/farmer-planner/releases) page.

## 0.9.6 — unreleased

**New**
- **Crops from the map mod, automatically**: when a farm is linked to a savegame, the map's crop list, calendar and in-game menu order are read straight from the map mod (unpacked folder or .zip) — e.g. rye, green rye and triticale on Krajów, clover and alfalfa on Solek. Importing a crops folder is now only a fallback.
- **Catch crops**: each field can have a catch crop (green rye, oilseed radish…) with its own sowing month. It shows under the crop in the fields table, in its own *Catch crops* section of the crops summary (not added to the main total, so hectares aren't counted twice), in Supplies (seed), Predicted yields and the Feed planner (green rye defaults to silage).
- **Animal mods in the Feed planner**: AnimalFoodCalculator (scaling mode, multiplier, days per month and its reference curves — own animals.xml / Animal Package / base game) and EnhancedAnimalSystem (more food for cows/sheep after calving) are read from the savegame and the mods. Settings shows what was found, with a switch per mod.
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
