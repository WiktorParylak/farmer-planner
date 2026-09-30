<p align="center">
  <img src="Assets/Logo.png" alt="Farmer Planner" width="360">
</p>

<p align="center">
  Planer sezonu dla <b>Farming Simulator 25</b> — pola, uprawy, nawożenie, zwierzęta i pasze w jednym miejscu,<br>
  zsynchronizowane z Twoim zapisem gry.
</p>

<p align="center">
  <a href="README.md">English</a> | <b>Polski</b>
</p>

---

![Widok planu](docs/screenshot-plan.png)

## Funkcje

**Plan sezonu**
- Tabela pól: numer pola (kilka pól można połączyć w jeden wiersz, np. `69-70-71`), hektary, uprawa, miesiąc siewu, stan (do posadzenia / sadzić teraz / posadzone), orka lub bezorka, typ gleby i plan nawożenia dla każdego pola. Kliknięcie nagłówka kolumny sortuje tabelę.
- Międzyplony (zielone żyto, poplon…) na tym samym polu, przed lub po uprawie głównej.
- Sezony z historią — możesz wrócić do poprzednich sezonów i je porównać.
- Podsumowanie upraw: łączne hektary każdej zasianej uprawy, liczone z pól, w kolejności upraw z gry (lub według nazwy / areału); międzyplony osobno.
- Opcjonalnie areał całej działki (farmland) obok areału pola.
- Ostrzeżenia o płodozmianie.

**Synchronizacja z grą**
- Import salda, kredytu, czasu gry, sprzętu i zwierząt z `careerSavegame.xml` — łącznie z kredytami z modów Enhanced Loan System i Bank And Credit.
- Automatyczna synchronizacja w trakcie gry — planer odświeża się przy każdym zapisie gry (ręcznym lub autozapisie).
- Uprawy mapy, ich kolejność i kalendarz siewu odczytywane automatycznie z moda mapy, której używa zapis gry — bez importu folderu (folder mapy można nadal wskazać dla map, których aplikacja nie odczyta).
- Wykrywanie modów zwierząt zmieniających zużycie paszy: **AnimalFoodCalculator** (tryb, mnożnik, dni w miesiącu, krzywe referencyjne) i **EnhancedAnimalSystem** (współczynnik paszy w laktacji).
- Typy gleby pól z Precision Farming, odczytywane bezpośrednio z zapisu gry.

**Narzędzia (pasek po lewej)**
- **Finanse** — saldo i kredyt miesiąc po miesiącu i sezon po sezonie.
- **Zwierzęta** — kafelek dla każdego budynku, zdjęcia ras z Twoich modów, stado według rasy i wieku, poziom paszy i na ile dni wystarczy, dzienne zapotrzebowanie, produkcja i reprodukcja (postęp ciąży, miesiące do porodu, zwierzęta niezapłodnione lub za młode). Budynkom można zmieniać nazwy.
- **Zaopatrzenie** — ile nasion i nawozów kupić na sezon.
- **Typ gleby pól** — gleby pól używane przez plany nawożenia.
- **Notatki** — przypięte do miesięcy, z tagami i listą zadań.
- **Przewidywane plony**.
- **Planer pasz** — co masz, czego brakuje i ile hektarów obsiać, żeby wykarmić stado, oraz kalkulator **paszowozu**: załaduj go belami z farmy i sprawdź mieszankę z recepturą TMR z gry.

**Inne**
- Język polski i angielski.
- Interaktywny samouczek (ustawienia aplikacji → „Otwórz samouczek”).
- Kopie zapasowe farm (eksport / import).
- Discord Rich Presence — pokazuje aktualną farmę na Twoim profilu (można wyłączyć).

![Zwierzęta](docs/screenshot-animals.png)

## Instalacja

Pobierz instalator dla Windows z zakładki [Releases](https://github.com/WiktorParylak/farmer-planner/releases) i uruchom go — nic więcej nie trzeba instalować.

### Uruchomienie ze źródeł (tylko dla programistów)

Potrzebne tylko, jeśli chcesz zmieniać kod albo samodzielnie zbudować instalator. Wymaga [Node.js](https://nodejs.org/) w wersji 20 lub nowszej.

```bash
git clone https://github.com/WiktorParylak/farmer-planner.git
cd farmer-planner
npm install
npm start
```

Zbudowanie instalatora (do folderu `dist/`):

```bash
npm run build
```

## Pierwsze kroki

1. Kliknij **DODAJ FARMĘ +** i wpisz nazwę farmy i mapy.
2. Otwórz farmę i kliknij **Ustawienia** na pasku po lewej.
3. Wskaż swój zapis gry, np.
   `Dokumenty\My Games\FarmingSimulator2025\savegame1\careerSavegame.xml`
   i włącz automatyczną synchronizację.
4. (Opcjonalnie) wybierz folder definicji zwierząt, jeśli Twoja mapa lub mody dodają własne rasy. Uprawy mapy wczytują się automatycznie z zapisu gry; folder mapy wskaż tylko, gdy się nie wczytały (mapa podstawowa, brak moda).
5. Kliknij **ZAPISZ I IMPORTUJ**.

Mody są wyszukiwane w folderze `mods` obok zapisu gry, w folderze ustawionym w `gameSettings.xml` gry oraz w kolekcjach FSG Mod Assistanta. Stamtąd automatycznie wczytywane są też zdjęcia ras. Zwierzęta z podstawowej gry (spakowane w archiwach gry) są pokazywane jako ikony.

## Gdzie są Twoje dane

Farmy są zapisywane w `Dokumenty\Farmer Planner`, więc łatwo je znaleźć, skopiować lub zsynchronizować. Aplikacja tylko **czyta** pliki gry i nigdy ich nie zmienia.

## Struktura projektu

```
src/
  main/        Główny proces Electrona (okno, dialogi, Discord Rich Presence)
  renderer/    Interfejs: index.html, renderer.js, style.css, odczyt zapisu gry i modów
data/          Dołączone dane z podstawowej gry (domyślne uprawy, zwierzęta, azot wg gleby)
Assets/        Logo i ikona aplikacji
tools/         Skrypty deweloperskie generujące pliki w data/ z plików gry
docs/          Zrzuty ekranu i notatki
```

## Zbudowane z

[Electron](https://www.electronjs.org/), czysty HTML/CSS/JavaScript, [Font Awesome](https://fontawesome.com/).

## Lista zmian

Zobacz [CHANGELOG.md](CHANGELOG.md) (po angielsku) lub zakładkę [Releases](https://github.com/WiktorParylak/farmer-planner/releases).

## Autor

Wiktor Parylak
