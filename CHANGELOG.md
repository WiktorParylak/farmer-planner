# Changelog

All notable changes to Farmer Planner. Installers for every version are on the [Releases](https://github.com/WiktorParylak/farmer-planner/releases) page.

## 0.9.0.5 — 2026-09-28

**New**
- **Mixer wagon** in the Feed planner: mixer wagons and bales are read from the savegame (capacity from the wagon's mod file, or typed in once), the wagon is loaded from whole or half bales plus loose products, **Fill to recipe** loads it automatically, and the mix is checked against the game's allowed TMR ranges — with how many days the load feeds the barn.
- Animal definitions are re-read from the imported `animals.xml` file(s) every time a farm is opened, so changes to them show up without importing again.

**Changed**
- The TMR recipe is no longer editable — the game's default (40% hay, 40% silage, 15% straw, 5% mineral feed) is always used.
- Tutorial updated for the new UI: a new *Feed planner & mixer wagon* chapter, reproduction and ration steps in *Animals*, and the soil import in *Farm tools*.

**Fixed**
- Settings → Adjust rates: the per-crop rates table no longer splits each crop over two rows.
