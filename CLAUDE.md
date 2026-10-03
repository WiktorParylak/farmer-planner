# Farmer Planner — CLAUDE.md

Planer sezonów do **Farming Simulator 25** (pola, uprawy, nawożenie, zwierzęta, pasza), zsynchronizowany z savegame'em.
Aplikacja desktopowa **Electron** (Windows), czysty HTML/CSS/JS, bez frameworka, bez bundlera, bez testów.
Autor: Wiktor Parylak. Repo: https://github.com/WiktorParylak/farmer-planner

Rozmawiamy po polsku. Kod, komentarze, commity, CHANGELOG i README (EN) — po angielsku.

## Praca na dwóch komputerach

Repo na GitHubie jest jedynym źródłem prawdy między komputerami. Pamięć Claude'a
(`~/.claude/projects/.../memory`) i katalog `.claude/` są **lokalne** — nie synchronizują się.
Wszystko, co ma być wiadome na obu maszynach, trzymaj w tym pliku.

**Na początku sesji** (zanim cokolwiek zmienisz):
```bash
git fetch --all --prune
git status                      # czy nie ma niezacommitowanych zmian
git branch -a                   # która gałąź vX.Y.Z jest najnowsza
git checkout vX.Y.Z             # najnowsza gałąź wersji
git pull
npm install                     # jeśli package-lock.json się zmienił
```

**Na koniec sesji** (gdy użytkownik mówi, że kończy / przesiada się):
```bash
git add -A
git commit -m "..."
git push -u origin vX.Y.Z       # tylko gałąź robocza — to synchronizacja, nie release
```
Niezacommitowana praca zostaje na jednym komputerze — przypomnij o tym, jeśli sesja kończy się z brudnym drzewem.

Pierwszy raz na nowym komputerze:
```bash
git clone https://github.com/WiktorParylak/farmer-planner.git
cd farmer-planner
npm install
npm start
```
Wymaga Node.js 20+ i Gita. Tożsamość gita: `Wiktor Parylak <parylakw@gmail.com>`.

## Komendy

| Komenda | Co robi |
|---|---|
| `npm start` | uruchamia aplikację (`electron .`) |
| `npm run build` | buduje instalator NSIS do `dist/` (`Farmer Planner Setup X.Y.Z.exe`) |
| `node tools/generate-default-crops.js "<FS25>\data\foliage"` | regeneruje `data/default-crops.json` |
| `node tools/generate-default-animals.js "<FS25>\sdk\xmlDoku\character\animals.xml"` | regeneruje `data/default-animals.json` |
| `node tools/dev-farm.js install` | wgrywa farmę testową z `dev-farm/` do `Documents\Farmer Planner` |
| `node tools/dev-farm.js save` | zapisuje farmę testową z aplikacji z powrotem do `dev-farm/` (potem commit) |
| `gh release list` | lista wydań |

Nie ma testów ani lintera — weryfikacja to `npm start` i przeklikanie zmienionej funkcji.

## Gałęzie i wydania

- Każda wersja ma swoją gałąź `vX.Y.Z`, odgałęzioną od **poprzedniej gałęzi wersji** (v0.9.8 z v0.9.7), nie od `main`.
- `main` dostaje wersję przez merge PR (`Merge pull request #N from .../vX.Y.Z`) po wydaniu. Przed planowaniem sprawdź, czy `main` nie jest w tyle — czytaj kod z najnowszej gałęzi `vX.Y.Z`.
- Na głównym komputerze praca bywa w worktree `.claude/worktrees/v0.9.6` (ma checkout najnowszej gałęzi wersji, nazwa katalogu jest historyczna). Na drugim komputerze tego worktree nie ma — wystarczy zwykły checkout gałęzi.
- Wydania: GitHub Releases jako **Pre-release**, tag `vX.Y.Z`, tytuł `Farmer Planner X.Y.Z`, załącznik = instalator z `dist/`. Instalatory i zipy **nie trafiają do repo** (`dist/` jest w `.gitignore`).

### Zasady (od użytkownika)

- **Commituj lokalnie. Nie pushuj, nie twórz PR, tagów ani release'ów, dopóki użytkownik wyraźnie nie powie.** Wyjątek: push gałęzi roboczej na koniec sesji, kiedy użytkownik prosi o synchronizację między komputerami.
- **Planowanie wersji jest przyrostowe**: użytkownik podaje zmiany jedną po drugiej. Dopisz każdą do planu i zapytaj krótko „co dalej?" zwykłym tekstem. Nie zamykaj planu (ExitPlanMode) ani nie pytaj o zakres menu wyboru, dopóki nie powie, że to wszystko.

### Wydanie wersji (krok po kroku)
1. `package.json` + `package-lock.json` → nowy `version` (to jedyne miejsce z numerem wersji).
2. `CHANGELOG.md` — nowa sekcja `## X.Y.Z — RRRR-MM-DD` z **New / Changed / Fixed**, w stylu poprzednich wpisów.
3. Teksty tutoriala (EN i PL), jeśli zmieniły się widoki.
4. Commit `Version X.Y.Z: ...` na gałęzi `vX.Y.Z`.
5. Dopiero na polecenie: push, `npm run build`, `gh release create vX.Y.Z --prerelease ...`, PR do `main`.

## Architektura

```
src/main/main.js               proces główny: okno, dialogi (IPC show-save/open-dialog), migracja danych
src/main/discord-presence.js   Discord Rich Presence
src/renderer/index.html        cały UI (jedna strona)
src/renderer/renderer.js       ~11k linii — prawie cała logika aplikacji
src/renderer/style.css         style
src/renderer/savegame-soil.js  gleby pól z Precision Farming (parsowanie GRLE)
src/renderer/map-crops.js      uprawy i kalendarz z moda mapy
src/renderer/mod-locator.js    szukanie folderów modów (gameSettings.xml, FSG Mod Assistant)
src/renderer/mod-files.js      czytanie plików z modów (folder/zip)
src/renderer/animal-mods.js    AnimalFoodCalculator, EnhancedAnimalSystem
src/renderer/animal-images.js  obrazki ras z modów
data/                          dane bazowej gry dołączone do aplikacji
tools/                         skrypty deweloperskie (nie są używane w runtime)
docs/                          screenshoty, propozycje-funkcji.txt
```

- `nodeIntegration: true`, `contextIsolation: false` — renderer używa bezpośrednio `require('fs')` itd.
- Dane farm: `Documents\Farmer Planner` (migracja ze starego `%APPDATA%\FarmerPlanner`). Stan okna: `userData/window-state.json`.
- Aplikacja tylko **czyta** pliki gry, nigdy ich nie modyfikuje.
- Tłumaczenia: `TRANSLATIONS` (`en` / `pl`) na początku `renderer.js`, funkcja `t(key)`, atrybuty `data-i18n` w HTML. Każdy nowy tekst w UI — klucz w **obu** językach. Są też `MONTH_/CROP_NAME_/ANIMAL_SPECIES_/PRODUCTION_FILLTYPE_TRANSLATIONS`.
- Skrypty w `tools/` powielają parsery z `renderer.js` (regex zamiast DOMParser) — zmiana schematu parsowania w jednym miejscu wymaga zmiany w drugim.

## Dane gry (komputer główny)

Ścieżki dotyczą głównego komputera; na drugim mogą być inne albo gry może nie być wcale.

- Katalog gry: `C:\Users\paryl\Documents\My Games\FarmingSimulator2025`. Farma Solek = `savegame2`, mod mapy rozpakowany w `mods/FS25_Solek` (config `map/mapUS.xml`).
- Dawki wysiewu PF: `mapUS.xml <precisionFarming><seedRateMap>` nadpisuje część upraw, reszta w `mods/FS25_precisionFarming.zip/PrecisionFarming.xml`.
- Udział gleb na polu **nie jest zapisany** — PF liczy go z `savegame2/precisionFarming_soilMap.grle` (1024², 2 m/px, `value & 3` = gleba 0..3 → loamySand, sandyLoam, loam, siltyClay; bit 4 = pobrana próbka) × `mods/FS25_Solek/map/data/infoLayer_farmlands.grle` (4096², wartość = id działki).
- Wielokąty pól: `map/mapUS.i3d` → TransformGroup `fields` → `fieldNN` → `polygonPoints`. Świat x,z ∈ [-1024, 1024], piksel = (w + 1024) × res / 2048.
- Zużycie nasion/nawozu per działka: `savegame2/precisionFarming.xml <farmlandStatistics>`.
- Format GRLE: nagłówek 21 B, szerokość = u16LE@6 × 256, wysokość = u16LE@10 × 256; RLE: bajt v, jeśli następny == v → run, licznik = suma bajtów 0xFF + bajt końcowy, emituj count+1 dodatkowych kopii.
- `mods/FS25_sowingMachineRollerReady.zip` został spatchowany 2026-09-27 (wał nie potraja zużycia nasion); oryginał w `Documents\Farming - misc\mod_backups`.

Farma testowa `DEV - farma testowa` (kopia Solka, id `1791058275537`) jest w repo w `dev-farm/` — na nowym komputerze `node tools/dev-farm.js install`, po zmianach w aplikacji `save` + commit. Testuj na niej, nie na prawdziwych farmach. Savegame'u (~136 MB) nie ma w repo.

Testowanie bez gry na drugim komputerze: skopiuj folder farmy z `Documents\Farmer Planner` (lub zrób eksport kopii zapasowej farmy w aplikacji) i, jeśli potrzebny jest sync, sam folder savegame'u.

## Konwencje

- Styl kodu: dopasuj się do otoczenia w `renderer.js` (4 spacje, `function`, bez klas/modułów ES, DOM przez `document.getElementById`).
- Commity: krótki tytuł po angielsku w trybie rozkazującym („Show the in-game day next to the month in the header").
- Nie commituj binariów (instalatorów, zipów, PDF-ów z materiałami do KingMods) — należą do GitHub Releases albo poza repo.
