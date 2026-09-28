<p align="center">
  <img src="Assets/Logo.png" alt="Farmer Planner" width="360">
</p>

<p align="center">
  Planer sezonu dla <b>Farming Simulator 25</b> — pola, uprawy, nawożenie, zwierzęta i pasze w jednym miejscu,<br>
  zsynchronizowane z Twoim zapisem gry.
</p>

<p align="center">
  <a href="#english">English below</a>
</p>

---

![Widok planu](docs/screenshot-plan.png)

## Co potrafi

**Plan sezonu**
- Tabela pól: numer pola (także kilka pól połączonych w jedno, np. `69-70-71`), hektary, uprawa, miesiąc siewu, stan (do siewu / siej teraz / obsiane), orka lub bezorka, typ gleby i plan nawożenia.
- Sezony z historią — możesz cofać się do poprzednich i porównywać.
- Lista wszystkich uprawianych roślin z sumą hektarów.
- Ostrzeżenia o płodozmianie.

**Synchronizacja z grą**
- Import saldo, kredytu, czasu gry, sprzętu i zwierząt z `careerSavegame.xml`.
- Automatyczna synchronizacja w trakcie gry — planer odświeża się przy każdym zapisie (ręcznym lub autozapisie).
- Kalendarz upraw z plików mapy (`fruitTypes` / `uprawaX.xml`) — działa też z mapami z modami.
- Typ gleby pól z Precision Farming, odczytany prosto z zapisu gry.

**Narzędzia (pasek po lewej)**
- **Finanse** — saldo i kredyt miesiąc po miesiącu oraz sezon po sezonie.
- **Zwierzęta** — kafelek dla każdego budynku, zdjęcia ras prosto z Twoich modów, stado według rasy i wieku, poziom paszy i na ile dni wystarczy, dzienne zapotrzebowanie, produkcja, a także reprodukcja (ciąża, czas do porodu, zwierzęta niezapłodnione lub za młode). Budynkom można nadawać własne nazwy.
- **Zaopatrzenie** — ile nasion i nawozu kupić na sezon.
- **Typ gleby pól** — gleby pól do planów nawożenia.
- **Notatki** — przypięte do miesięcy, z tagami i listą kontrolną.
- **Przewidywane plony**.
- **Planer pasz** — co masz, czego brakuje i ile hektarów trzeba obsiać, żeby wykarmić stado.

**Inne**
- Język polski i angielski.
- Interaktywny samouczek (Ustawienia aplikacji → „Otwórz samouczek”).
- Kopie zapasowe farm (eksport / import).
- Discord Rich Presence — pokazuje aktualną farmę na Twoim profilu (można wyłączyć).

![Zwierzęta](docs/screenshot-animals.png)

## Instalacja

Instalatory dla Windows są publikowane w zakładce [Releases](https://github.com/WiktorParylak/farmer-planner/releases). Możesz też uruchomić aplikację ze źródeł.

### Uruchomienie ze źródeł

Wymagany [Node.js](https://nodejs.org/) (wersja 20 lub nowsza).

```bash
git clone https://github.com/WiktorParylak/farmer-planner.git
cd farmer-planner
npm install
npm start
```

Budowanie instalatora (`dist/`):

```bash
npm run build
```

## Pierwsze kroki

1. Kliknij **DODAJ FARMĘ +** i podaj nazwę farmy oraz mapy.
2. Otwórz farmę i wejdź w **Ustawienia** na pasku po lewej.
3. Wskaż plik zapisu gry, np.
   `Dokumenty\My Games\FarmingSimulator2025\savegame1\careerSavegame.xml`
   i włącz automatyczną synchronizację.
4. (Opcjonalnie) wskaż folder mapy, żeby wczytać jej kalendarz upraw, oraz folder z definicjami zwierząt, jeśli mapa lub mody dodają własne rasy.
5. Kliknij **ZAPISZ I IMPORTUJ**.

Zdjęcia ras zwierząt są wczytywane automatycznie z folderu `mods` obok zapisu gry. Zwierzęta z podstawowej gry (spakowane w archiwach gry) są pokazywane jako ikony.

## Gdzie są dane

Farmy są zapisywane w `Dokumenty\Farmer Planner` — łatwo je znaleźć, skopiować albo zsynchronizować. Aplikacja tylko **czyta** pliki gry, nigdy ich nie zmienia.

## Technologie

[Electron](https://www.electronjs.org/), czysty HTML/CSS/JavaScript, [Font Awesome](https://fontawesome.com/).

## Autor

Wiktor Parylak

---

## English

**Farmer Planner** is a season planner for **Farming Simulator 25**: fields, crops, fertilization plans, animals and feed in one place, kept in sync with your savegame.

- Field table with crop, sowing month, state, tillage, soil type and a per-field fertilization plan; seasons with history.
- Reads balance, loan, playtime, equipment and animals from `careerSavegame.xml`, with auto-sync while you play.
- Crop calendar from the map's files (works with modded maps) and Precision Farming soil types from the save.
- Sidebar tools: Finance charts, Animals (barn tiles, breed pictures from your mods, herd by breed and age, feed days left, daily needs, output and reproduction), Supplies, Field soil, Notes, Predicted yields and a Feed planner.
- Polish and English, interactive tutorial, farm backups, optional Discord Rich Presence.

**Install:** grab the Windows installer from [Releases](https://github.com/WiktorParylak/farmer-planner/releases), or run from source with Node.js 20+: `npm install` then `npm start` (`npm run build` builds the installer).

Farm data is stored in `Documents\Farmer Planner`. The app only reads game files and never modifies them.
