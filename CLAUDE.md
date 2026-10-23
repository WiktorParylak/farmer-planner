# Farmer Planner — CLAUDE.md

Planer sezonów do **Farming Simulator 25** (pola, uprawy, nawożenie, zwierzęta, pasza), zsynchronizowany z savegame'em.
Aplikacja desktopowa **Electron** (Windows), czysty HTML/CSS/JS, bez frameworka, bez bundlera, bez testów.
Autor: Wiktor Parylak. Repo: https://github.com/WiktorParylak/farmer-planner

Rozmawiamy po polsku. Kod, komentarze, commity, CHANGELOG i README (EN) — po angielsku.

## Praca na dwóch komputerach

Repo na GitHubie jest jedynym źródłem prawdy między komputerami. Pamięć Claude'a
(`~/.claude/projects/.../memory`) i katalog `.claude/` są **lokalne** — nie synchronizują się.
Wszystko, co ma być wiadome na obu maszynach, trzymaj w tym pliku.
Wyjątek: `.claude/settings.json` jest w repo — są w nim pluginy Claude Code (`enabledPlugins` +
`extraKnownMarketplaces`), więc na drugim komputerze Claude Code sam zaproponuje ich instalację.

**Na początku sesji** (zanim cokolwiek zmienisz):
```bash
git fetch --all --prune
git status                      # czy nie ma niezacommitowanych zmian
git branch -a                   # która gałąź dev/vX.Y.Z jest najnowsza
git switch dev/vX.Y.Z           # najnowsza gałąź wersji (pierwszy raz: git switch -c dev/vX.Y.Z --track origin/dev/vX.Y.Z)
git pull
npm install                     # jeśli package-lock.json się zmienił
```

**Na koniec sesji** (gdy użytkownik mówi, że kończy / przesiada się):
```bash
git add -A
git commit -m "..."
git push -u origin dev/vX.Y.Z   # tylko gałąź robocza — to synchronizacja, nie release
```

Gałęzie robocze mają prefiks `dev/` (`dev/v0.9.8`), a tagi wydań go nie mają (`v0.9.8`), więc nazwy
się nie gryzą. Nigdy nie twórz gałęzi o nazwie `vX.Y.Z` bez `dev/` — koliduje z tagiem wydania
(„src refspec matches more than one”, `git checkout` trafia w tag). Do 2026-10-03 gałęzie nazywały się
`vX.Y.Z`; jeśli na drugim komputerze zostały lokalne `v0.9.7` / `v0.9.8`, po `git fetch --prune`
usuń je (`git branch -D v0.9.7 v0.9.8`) i przełącz się na `dev/v0.9.8`.
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
| `npm start` | uruchamia aplikację (`tools/start.js`): z głównego folderu repo odpala worktree z najnowszą gałęzią `dev/vX.Y.Z` z `.claude/worktrees/`, w innym wypadku `electron .` |
| `npm run build` | electron-builder (NSIS → `dist/payload/`), potem `tools/build-installer.js` → własny instalator `dist/Farmer Planner Setup X.Y.Z.exe` |
| `node tools/build-installer.js --payload <setup.exe> --version X.Y.Z --out <dir>` | owija wydany już instalator NSIS w nowe okno (podmiana instalatora w starym release'ie) |
| `node tools/generate-default-crops.js "<FS25>\data\foliage"` | regeneruje `data/default-crops.json` |
| `node tools/generate-default-agronomy.js "<FS25>\data\foliage"` | regeneruje `data/default-agronomy.json` (dawka wysiewu, plon, słoma z gry podstawowej) |
| `node tools/generate-default-animals.js "<FS25>\sdk\xmlDoku\character\animals.xml"` | regeneruje `data/default-animals.json` |
| `gh release list` | lista wydań |

Nie ma testów ani lintera — weryfikacja to `npm start` i przeklikanie zmienionej funkcji.

## Gałęzie i wydania

- Każda wersja ma swoją gałąź `dev/vX.Y.Z`, odgałęzioną od **poprzedniej gałęzi wersji** (dev/v0.9.9 z dev/v0.9.8), nie od `main`.
- `main` dostaje wersję przez merge PR z gałęzi `dev/vX.Y.Z` po wydaniu (starsze PR-y mają w nazwie `vX.Y.Z`). Przed planowaniem sprawdź, czy `main` nie jest w tyle — czytaj kod z najnowszej gałęzi `dev/vX.Y.Z`.
- Na głównym komputerze praca bywa w worktree `.claude/worktrees/v0.9.6` (ma checkout najnowszej gałęzi wersji, nazwa katalogu jest historyczna). Na drugim komputerze tego worktree nie ma — wystarczy zwykły checkout gałęzi.
- Wydania: GitHub Releases jako **Pre-release**, tag `vX.Y.Z`, tytuł `Farmer Planner X.Y.Z`, załącznik = **tylko** `dist/Farmer Planner Setup X.Y.Z.exe` (własny instalator; nie `dist/payload/`, nie `.blockmap` — strona bierze pierwszy `.exe` z release'u). Instalatory i zipy **nie trafiają do repo** (`dist/` jest w `.gitignore`).

### Zasady (od użytkownika)

- **Commituj lokalnie. Nie pushuj, nie twórz PR, tagów ani release'ów, dopóki użytkownik wyraźnie nie powie.** Wyjątek: push gałęzi roboczej na koniec sesji, kiedy użytkownik prosi o synchronizację między komputerami.
- **Planowanie wersji jest przyrostowe**: użytkownik podaje zmiany jedną po drugiej. Dopisz każdą do planu i zapytaj krótko „co dalej?" zwykłym tekstem. Nie zamykaj planu (ExitPlanMode) ani nie pytaj o zakres menu wyboru, dopóki nie powie, że to wszystko.
- **CHANGELOG na bieżąco**: każdą zrobioną zmianę dopisz do sekcji `## X.Y.Z — unreleased` w `CHANGELOG.md` w tym samym commicie (data wpisywana przy wydaniu).

### Wydanie wersji (krok po kroku)
1. `package.json` + `package-lock.json` → nowy `version` (to jedyne miejsce z numerem wersji).
2. `CHANGELOG.md` — nowa sekcja `## X.Y.Z — RRRR-MM-DD` z **New / Changed / Fixed**, w stylu poprzednich wpisów.
3. Teksty tutoriala (EN i PL), jeśli zmieniły się widoki.
4. Commit `Version X.Y.Z: ...` na gałęzi `dev/vX.Y.Z`.
5. Dopiero na polecenie: push, `npm run build`, `gh release create vX.Y.Z --prerelease ...`, PR do `main`.
6. Po merge'u do `main`: przebuduj stronę (push do `farmer-planner-website` albo ręczne uruchomienie workflow *Deploy*; inaczej dopiero nocny build o 04:30 UTC).
   Okno aktualizacji w aplikacji otwiera `farmerplanner.pl/versions/#vX-Y-Z`, a strona wersji czyta `CHANGELOG.md` z `main` —
   bez tego kroku link trafia na stronę bez nowej wersji.

## Architektura

```
src/main/main.js               proces główny: okno, dialogi (IPC show-save/open-dialog), migracja danych
src/main/discord-presence.js   Discord Rich Presence
src/renderer/index.html        cały UI (jedna strona)
src/renderer/renderer.js       ~5,7k linii — rdzeń: dane farm, sync z zapisem, panele, sezony, ustawienia
src/renderer/feed.js           planer paszy, mieszalniki, paszowóz (classic <script> PRZED renderer.js)
src/renderer/supplies.js       zaopatrzenie, plan nawożenia pola, model stawek (PRZED renderer.js)
src/renderer/fields-table.js   tabela planu, okno pola, planer prac, tryb edycji (PO renderer.js)
src/renderer/style.css         style
src/renderer/savegame-soil.js  gleby pól z Precision Farming (parsowanie GRLE)
src/renderer/map-crops.js      uprawy i kalendarz z moda mapy
src/renderer/mod-locator.js    szukanie folderów modów (gameSettings.xml, FSG Mod Assistant)
src/renderer/mod-files.js      czytanie plików z modów (folder/zip)
src/renderer/animal-mods.js    AnimalFoodCalculator, EnhancedAnimalSystem
src/renderer/animal-images.js  obrazki ras z modów
src/renderer/translations.js   wszystkie teksty (TRANSLATIONS + słowniki nazw), en i pl
src/renderer/translations-de.js teksty niemieckie (te same klucze), dołączane w translations.js
src/renderer/tutorial.js       samouczek (drugi <script> po renderer.js)
src/renderer/settings.js       ustawienia aplikacji (settings.json w folderze danych)
src/renderer/diagnostics.js    plik diagnostyczny do zgłoszeń (Ustawienia → Pomoc)
data/                          dane bazowej gry dołączone do aplikacji
installer/                     własny instalator/deinstalator (Setup.cs + Window.xaml, poza paczką aplikacji)
tools/                         skrypty deweloperskie (nie są używane w runtime)
docs/                          screenshoty, propozycje-funkcji.txt
```

- `nodeIntegration: true`, `contextIsolation: false` — renderer używa bezpośrednio `require('fs')` itd.
- Kolejność skryptów w `index.html`: `feed.js`, `supplies.js`, `renderer.js`, `fields-table.js`, `tutorial.js` — zwykłe `<script>` ze wspólnym globalnym zasięgiem. Pliki przed `renderer.js` mają na górnym poziomie tylko stałe, stan i funkcje (nic nie czyta `fs`/`t()`/DOM-u renderera przy ładowaniu); pliki po nim mogą podpinać listenery do jego elementów. `renderer.js` nie może przy ładowaniu wołać funkcji z plików ładowanych po nim (start aplikacji jest w `DOMContentLoaded`). Nie deklaruj drugi raz `const fs`/`path` w tych plikach — kolizja nazw w globalnym zasięgu.
- Dane farm: `Documents\Farmer Planner` (migracja ze starego `%APPDATA%\FarmerPlanner`). Ustawienia aplikacji (język, Discord, aktualizacje, samouczek, sortowanie): `Documents\Farmer Planner\settings.json` przez `getSetting`/`setSetting` — nie `localStorage`. Stan okna: `userData/window-state.json`.
- Aplikacja tylko **czyta** pliki gry, nigdy ich nie modyfikuje.
- Tłumaczenia: `TRANSLATIONS` (`en` / `pl` / `de`) w `translations.js` + `translations-de.js`, funkcja `t(key)`, atrybuty `data-i18n` w HTML. Każdy nowy tekst w UI — klucz we **wszystkich trzech** językach (`APP_LANGUAGES` w `renderer.js`); brakujący klucz DE spada na EN. Są też `MONTH_/CROP_NAME_/ANIMAL_SPECIES_/PRODUCTION_FILLTYPE_TRANSLATIONS`.
- Skrypty w `tools/` powielają parsery z `renderer.js` (regex zamiast DOMParser) — zmiana schematu parsowania w jednym miejscu wymaga zmiany w drugim.

## Instalator

- `installer/Setup.cs` (C# 5, WPF) + `installer/Window.xaml` (wczytywany w runtime przez `XamlReader`), kompilowane przez
  `csc.exe` z .NET Framework 4.8 w Windows (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319`) — bez SDK i bez nowych zależności.
- Zewnętrzny exe = okno + osadzony instalator NSIS electron-buildera (`oneClick`, per-user), uruchamiany po cichu
  `/S /currentuser /D=<folder>`. NSIS dalej robi pliki, menu Start, wpis w „Aplikacje” i aktualizację na miejscu.
- Ten sam `Setup.cs` z `/define:UNINSTALLER` → `Farmer Planner Uninstall.exe` w folderze aplikacji; instalator po każdej
  instalacji ustawia na niego `UninstallString` w `HKCU\...\Uninstall\38e229cb-...` (`QuietUninstallString` zostaje NSIS-owy,
  wywołanie z `/S` deinstalator przekazuje do `Uninstall Farmer Planner.exe`).
- Folder zawsze `<wybrany>\Farmer Planner`; brak prawa zapisu → restart z UAC (`--elevated`). Argumenty do testów:
  `--lang=en|pl|de`, `--dir=<folder>`. Fonty (Google Fonts, TTF) pobierane raz do `build-cache/` (w `.gitignore`).
- Teksty okna (EN/PL/DE) są w słowniku `Texts` w `Setup.cs`, nie w `translations.js`.

## Dane gry (komputer główny)

Ścieżki dotyczą głównego komputera; na drugim mogą być inne albo gry może nie być wcale.
Na komputerze z OneDrive (Dokumenty przekierowane) katalog gry to `C:\Users\paryl\OneDrive\Dokumenty\My Games\FarmingSimulator2025`,
a instalacja Steam `C:\Program Files (x86)\Steam\steamapps\common\Farming Simulator 25` (`data\foliage`, `sdk\xmlDoku`; reszta danych gry jest w `dataS.gar`).

- Katalog gry: `C:\Users\paryl\Documents\My Games\FarmingSimulator2025`. Farma Solek = `savegame2`, mod mapy rozpakowany w `mods/FS25_Solek` (config `map/mapUS.xml`).
- Dawki wysiewu PF: `mapUS.xml <precisionFarming><seedRateMap>` nadpisuje część upraw, reszta w `mods/FS25_precisionFarming.zip/PrecisionFarming.xml`.
- Udział gleb na polu **nie jest zapisany** — PF liczy go z `savegame2/precisionFarming_soilMap.grle` (1024², 2 m/px, `value & 3` = gleba 0..3 → loamySand, sandyLoam, loam, siltyClay; bit 4 = pobrana próbka) × `mods/FS25_Solek/map/data/infoLayer_farmlands.grle` (4096², wartość = id działki).
- Wielokąty pól: `map/mapUS.i3d` → TransformGroup `fields` → `fieldNN` → `polygonPoints`. Świat x,z ∈ [-1024, 1024], piksel = (w + 1024) × res / 2048.
- Zużycie nasion/nawozu per działka: `savegame2/precisionFarming.xml <farmlandStatistics>`.
- Format GRLE: nagłówek 21 B, szerokość = u16LE@6 × 256, wysokość = u16LE@10 × 256; RLE: bajt v, jeśli następny == v → run, licznik = suma bajtów 0xFF + bajt końcowy, emituj count+1 dodatkowych kopii.
- `mods/FS25_sowingMachineRollerReady.zip` został spatchowany 2026-09-27 (wał nie potraja zużycia nasion); oryginał w `Documents\Farming - misc\mod_backups`.

Farma testowa `DEV – farma testowa` (id `1000000000001`) jest generowana od zera przez `src/renderer/dev-farm.js` — bez savegame'u, nie jest kopią żadnej farmy. Włącza się w ustawieniach aplikacji (zębatka na ekranie startowym → *Deweloper*, widoczne tylko przy `npm start`); *Odtwórz farmę testową* stawia ją od nowa, wyłączenie usuwa. Nowy stan do przetestowania → dopisz go w `dev-farm.js`. Testuj na niej, nie na prawdziwych farmach.
Testowanie bez gry na drugim komputerze: skopiuj folder farmy z `Documents\Farmer Planner` (lub zrób eksport kopii zapasowej farmy w aplikacji) i, jeśli potrzebny jest sync, sam folder savegame'u.

## Strona www

- **https://farmerplanner.pl** — strona produktu w osobnym, **prywatnym** repo `WiktorParylak/farmer-planner-website`, sklonowanym obok tego (`PROJEKTY\farmer-planner-website`). Hosting SEOHOST, deploy przez GitHub Actions (FTPS) przy pushu na `main` tamtego repo. Szczegóły w jego CLAUDE.md.
- Screenshoty na stronie i w README są **angielskie**, robione z farmy testowej (`dev-farm.js`, przemianowanej na „Green Valley Farm”) skryptem `npm run screenshots` w repo strony. Po zmianach w UI odśwież je tam i skopiuj PNG do `docs/` tutaj.
- README (EN i PL) ma ten sam układ i teksty co strona; zmiany funkcji opisuj w obu miejscach. Logo w README: `docs/logo-light.svg` (ciemne, jasny motyw GitHuba) i `Assets/Logo.svg` (białe, ciemny motyw).
- Repo na GitHubie ma ustawione Website = farmerplanner.pl, opis i tematy (fs25, farming-simulator-25…).

## Konwencje

- Styl kodu: dopasuj się do otoczenia w `renderer.js` (4 spacje, `function`, bez klas/modułów ES, DOM przez `document.getElementById`).
- Commity: krótki tytuł po angielsku w trybie rozkazującym („Show the in-game day next to the month in the header").
- Nie commituj binariów (instalatorów, zipów, PDF-ów z materiałami do KingMods) — należą do GitHub Releases albo poza repo.

