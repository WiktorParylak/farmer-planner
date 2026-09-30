# Changelog

All notable changes to Farmer Planner. Installers for every version are on the [Releases](https://github.com/WiktorParylak/farmer-planner/releases) page.

## 0.9.7 — unreleased

**New**
- **Mods outside the default folder are found**: the app now looks in the folder set in the game's `gameSettings.xml` (*modsDirectoryOverride*) and in every **FSG Mod Assistant** collection, not only in `FarmingSimulator2025\mods`. The folder holding most of the savegame's mods is used first, so a savegame from a collection that isn't active right now still works. This applies to the map's crops, field soils and land plots, animal mods (AnimalFoodCalculator, EnhancedAnimalSystem), mixer wagon capacities and breed pictures.
- Settings shows which mods folder the farm uses (hover to see all searched folders).
- **Feed mixers** in the Feed planner: productions you own whose recipes make feed — pig food, TMR or mineral feed (e.g. Food Mixer Silo, Small Food Mixer, Lizard Mixed Food) — are found automatically. Each shows its product stock and capacity, how much it can make per month with the recipes switched on, the recipes and the ingredients waiting to be mixed; mixers for the selected barn's animals are highlighted, and a warning shows when no recipe is on.
- **Quick edits in the fields table** (current season, no Edit season needed): click the state badge to mark a field sown / not sown, click the rolling chip to switch rolling, click the lime chip to lime the field (or lime again when it runs low, or undo a mistaken liming) — lime asks first in a small dialog.
- **Rolling**: an "I want to roll" checkbox per field in Edit season and a chip next to lime in the table; cleared with a new season like the other treatments.
- Feed mixer recipes and names are translated: base-game ingredients (hay, alfalfa hay, water, silage…) by the app, a mod's own ingredients and the mixer's shop name from that mod's translations (e.g. Castile and León's crushed cereal, feed flour, chopped tubers). Mixers a mod makes practically instant show "no real limit" instead of an absurd monthly rate.
- Feed mixers can be renamed (pencil next to the name, like barns); the name is used everywhere the mixer shows up. Empty name restores the one from the mod.
- **Pigs can be fed from a mixer**: a pig-food mixer appears as a feed choice for pigs (*Mixer feed · name*). Their need then follows the mixer's recipe — the crops it takes (e.g. maize + barley + soy, a third each; the switched-on recipe, else the first) — minus the ready pig food in stock. Also selectable in the Animals panel.
- Rye, triticale, millet and buckwheat count as pig/chicken feed (grain, base, protein) like in the maps' animal food settings.
- Feed in the mixers and ready-mixed pig food / TMR anywhere on the farm (silos, pallets) now count toward feed stock — pig food split like the game's pig mixture (base 50%, grain 25%, protein 20%, root crops 5%).

**Fixed**
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
