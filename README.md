<p align="center">
  <img src="Assets/Logo.png" alt="Farmer Planner" width="360">
</p>

<p align="center">
  A season planner for <b>Farming Simulator 25</b> — fields, crops, fertilization, animals and feed in one place,<br>
  kept in sync with your savegame.
</p>

<p align="center">
  <a href="#polski">Wersja polska poniżej</a>
</p>

---

![Plan view](docs/screenshot-plan.png)

## Features

**Season plan**
- Field table: field number (several fields can be combined into one row, e.g. `69-70-71`), hectares, crop, sowing month, state (to plant / plant now / planted), plowed or no-till, soil type and a per-field fertilization plan.
- Seasons with history — step back to previous seasons and compare.
- List of every crop being farmed with total hectares.
- Crop rotation warnings.

**Game sync**
- Imports balance, loan, playtime, equipment and animals from `careerSavegame.xml`.
- Auto-sync while you play — the planner refreshes every time the game saves (manual save or autosave).
- Crop calendar read from the map's files (`fruitTypes` / `uprawaX.xml`) — works with modded maps too.
- Field soil types from Precision Farming, read straight from the savegame.

**Tools (left sidebar)**
- **Finance** — balance and loan month by month and season by season.
- **Animals** — one tile per building, breed pictures taken from your mods, herd by breed and age, feed level and how many days it lasts, daily needs, output, and reproduction (pregnancy progress, months to birth, animals not inseminated or too young). Buildings can be renamed.
- **Supplies** — how much seed and fertilizer to buy for the season.
- **Field soil type** — field soils used by the fertilization plans.
- **Notes** — pinned to months, with tags and a checklist.
- **Predicted yields**.
- **Feed planner** — what you have, what's missing and how many hectares to sow to feed your herd.

**Other**
- English and Polish.
- Interactive tutorial (app settings → "Open tutorial").
- Farm backups (export / import).
- Discord Rich Presence — shows your current farm on your profile (can be turned off).

![Animals](docs/screenshot-animals.png)

## Installation

Windows installers are published on the [Releases](https://github.com/WiktorParylak/farmer-planner/releases) page. You can also run the app from source.

### Running from source

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/WiktorParylak/farmer-planner.git
cd farmer-planner
npm install
npm start
```

Build the installer (into `dist/`):

```bash
npm run build
```

## Getting started

1. Click **ADD FARM +** and enter the farm and map name.
2. Open the farm and click **Settings** in the left sidebar.
3. Point it to your savegame, e.g.
   `Documents\My Games\FarmingSimulator2025\savegame1\careerSavegame.xml`
   and turn on auto-sync.
4. (Optional) pick the map folder to load its crop calendar, and the animal definitions folder if your map or mods add their own breeds.
5. Click **SAVE & IMPORT**.

Breed pictures are loaded automatically from the `mods` folder next to your savegame. Base-game animals (packed inside the game's archives) are shown as icons.

## Where your data lives

Farms are stored in `Documents\Farmer Planner`, so they're easy to find, copy or sync. The app only **reads** game files and never modifies them.

## Project structure

```
src/
  main/        Electron main process (window, dialogs, Discord Rich Presence)
  renderer/    UI: index.html, renderer.js, style.css, savegame & mod readers
data/          Bundled base-game data (default crops, animals, nitrogen by soil)
Assets/        Logo and app icon
tools/         Dev scripts that regenerate the files in data/ from game files
docs/          Screenshots and notes
```

## Built with

[Electron](https://www.electronjs.org/), plain HTML/CSS/JavaScript, [Font Awesome](https://fontawesome.com/).

## Author

Wiktor Parylak

---

## Polski

**Farmer Planner** to planer sezonu dla **Farming Simulator 25**: pola, uprawy, plany nawożenia, zwierzęta i pasze w jednym miejscu, zsynchronizowane z Twoim zapisem gry.

- Tabela pól z uprawą, miesiącem siewu, stanem, orką lub bezorką, typem gleby i planem nawożenia dla każdego pola; sezony z historią i ostrzeżenia o płodozmianie.
- Odczyt salda, kredytu, czasu gry, sprzętu i zwierząt z `careerSavegame.xml` oraz automatyczna synchronizacja w trakcie gry.
- Kalendarz upraw z plików mapy (działa z mapami z modami) i typy gleby z Precision Farming.
- Narzędzia na pasku bocznym: Finanse, Zwierzęta (kafelki budynków, zdjęcia ras z modów, stado według rasy i wieku, dni paszy, dzienne zapotrzebowanie, produkcja i reprodukcja), Zaopatrzenie, Typ gleby pól, Notatki, Przewidywane plony i Planer pasz.
- Język polski i angielski, interaktywny samouczek, kopie zapasowe farm, opcjonalny Discord Rich Presence.

**Instalacja:** instalator dla Windows w zakładce [Releases](https://github.com/WiktorParylak/farmer-planner/releases) albo uruchomienie ze źródeł (Node.js 20+): `npm install`, potem `npm start` (`npm run build` buduje instalator).

**Pierwsze kroki:** **DODAJ FARMĘ +** → otwórz farmę → **Ustawienia** na pasku po lewej → wskaż `careerSavegame.xml` i włącz automatyczną synchronizację → **ZAPISZ I IMPORTUJ**.

Dane farm są zapisywane w `Dokumenty\Farmer Planner`. Aplikacja tylko czyta pliki gry i nigdy ich nie zmienia.
