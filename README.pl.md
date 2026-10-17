<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="Assets/Logo.svg">
    <img src="docs/logo-light.svg" alt="Farmer Planner" width="360">
  </picture>
</p>

<h3 align="center">Wiesz, czego każde pole potrzebuje w tym miesiącu.</h3>

<p align="center">
  Darmowy planer sezonów do <b>Farming Simulator 25 (FS25)</b>. Czyta Twój zapis gry i trzyma pola, uprawy,<br>
  nawozy, zwierzęta i paszę w jednym planie, odświeżanym przy każdym zapisie gry.
</p>

<p align="center">
  <a href="https://github.com/WiktorParylak/farmer-planner/releases"><img alt="Pobierz na Windows" src="https://img.shields.io/badge/Pobierz-Windows-C97A2B?style=for-the-badge&logo=windows&logoColor=white"></a>
  <a href="https://farmerplanner.pl/pl/"><img alt="Strona: farmerplanner.pl" src="https://img.shields.io/badge/Strona-farmerplanner.pl-3F6B44?style=for-the-badge"></a>
  <a href="https://github.com/WiktorParylak/farmer-planner/releases"><img alt="Najnowsza wersja" src="https://img.shields.io/github/v/release/WiktorParylak/farmer-planner?include_prereleases&style=for-the-badge&label=wersja&color=16261D"></a>
</p>

<p align="center">
  <a href="README.md">English</a> | <b>Polski</b>
</p>

![Plan sezonu: tabela pól z uprawą, miesiącem siewu, stanem i planem nawożenia](docs/screenshot-plan.png)

## Jeden plan na całe gospodarstwo

**Plan sezonu**
- Każde pole z powierzchnią, uprawą, miesiącem siewu, stanem, orką lub bezorką, typem gleby i planem nawożenia.
- Międzyplony na tym samym polu, przed albo po głównej uprawie.
- Historia sezonów: wrócisz do poprzednich i porównasz.
- Ostrzeżenia o płodozmianie i podsumowanie hektarów każdej uprawy.

**Zsynchronizowany z grą**
- Saldo, kredyty, czas gry, maszyny i zwierzęta prosto z zapisu gry.
- Odświeża się sam przy każdym zapisie gry, także automatycznym.
- Uprawy i kalendarz siewu czytane z moda mapy.
- Gleby pól z Precision Farming, prosto z zapisu.

**Narzędzia**
- Finanse miesiąc po miesiącu i sezon po sezonie.
- Zaopatrzenie: ile nasion i nawozu kupić na sezon.
- Przewidywane plony.
- Notatki przypięte do miesięcy, z tagami i listą do odhaczania.

## Zwierzęta i pasza policzone

Kafelek dla każdego budynku: stado według rasy i wieku, na ile dni starczy paszy, dzienne zapotrzebowanie, produkcja i ciąże. Planer pasz powie, czego brakuje i ile hektarów obsiać, a kalkulator wozu paszowego sprawdzi mieszankę z przepisem TMR z gry.

Działa z AnimalFoodCalculator i EnhancedAnimalSystem i pokazuje obrazki ras z Twoich modów.

![Panel zwierząt: kafelek dla każdego budynku ze stadem, poziomem paszy i produkcją](docs/screenshot-animals.png)

## Pierwsze kroki

1. Pobierz instalator z zakładki [Releases](https://github.com/WiktorParylak/farmer-planner/releases) i uruchom go. Nic więcej nie trzeba instalować.
2. Kliknij **Dodaj farmę** i wpisz nazwę farmy i mapy.
3. Otwórz farmę, wejdź w **Ustawienia** i wskaż plik `careerSavegame.xml` swojego zapisu, np.
   `Dokumenty\My Games\FarmingSimulator2025\savegame1\careerSavegame.xml`.
4. Włącz automatyczną synchronizację i kliknij **Zapisz i importuj**.
5. Planuj pola. Planer nadąża za Tobą, kiedy grasz.

Mody są wyszukiwane w folderze `mods` obok zapisu gry, w folderze ustawionym w `gameSettings.xml` gry oraz w kolekcjach FSG Mod Assistanta. Stamtąd automatycznie wczytywane są też obrazki ras. Zwierzęta z podstawowej gry (spakowane w archiwach gry) są pokazywane jako ikony.

## Pytania

**Czy zmienia mój zapis gry?**
Nie. Farmer Planner tylko czyta pliki gry i nigdy do nich nie zapisuje.

**Jakie mapy i mody obsługuje?**
Każdą mapę: uprawy i kalendarz są czytane z moda mapy, której używa zapis. Rozumie też Precision Farming, AnimalFoodCalculator, EnhancedAnimalSystem, Animal Package (vanilla edition), Bank And Credit i Enhanced Loan System.

**Gdzie są zapisane moje farmy?**
W `Dokumenty\Farmer Planner`, więc łatwo je znaleźć, skopiować albo zarchiwizować. Aplikacja umie też wyeksportować i zaimportować kopię zapasową farmy.

**Czy działa w trybie wieloosobowym?**
Tak. W zapisie z kilkoma farmami wybierasz w Ustawieniach swoją, a planer czyta tylko jej pieniądze, ziemię, zwierzęta i paszę.

<details>
<summary><b>Pełna lista funkcji</b></summary>

**Plan sezonu**
- Tabela pól: numer pola (kilka pól można połączyć w jeden wiersz, np. `69-70-71`), hektary, uprawa, miesiąc siewu, stan (do posadzenia / sadzić teraz / posadzone), orka lub bezorka, typ gleby i plan nawożenia dla każdego pola. Kliknięcie nagłówka kolumny sortuje tabelę.
- Własne nazwy pól (*Za stodołą*), zachowane między sezonami, i wyszukiwarka (**Ctrl+F**), która filtruje pola po numerze, nazwie albo uprawie — przydatna na dużych farmach.
- Połączone pola same sumują hektary: wpisanie `10-11-12` uzupełnia areał ze znanych wielkości pól albo z zapisu gry.
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
- **Notatki** — przypięte do miesięcy i pól, z tagami i listą zadań, która co rok w grze zaczyna się od nowa.
- **Przewidywane plony**.
- **Planer pasz** — co masz, czego brakuje i ile hektarów obsiać, żeby wykarmić stado, oraz kalkulator **paszowozu**: załaduj go belami z farmy i sprawdź mieszankę z recepturą TMR z gry. Wykrywa też mieszalniki pasz (pasza dla świń, TMR, pasza mineralna) z zapasami, recepturami i wydajnością miesięczną.

**Inne**
- Język polski, angielski i niemiecki.
- Interaktywny samouczek (ustawienia aplikacji → „Otwórz samouczek”).
- Kopie zapasowe farm (eksport / import).
- Plik diagnostyczny do zgłoszeń błędów (ustawienia aplikacji → Pomoc) — farma i małe pliki zapisu gry w jednym `.json`, bez nazwy Twojego folderu użytkownika Windows.
- Discord Rich Presence — pokazuje aktualną farmę na Twoim profilu (wyłączone, dopóki nie pozwolisz).

</details>

## Dla programistów

Uruchomienie ze źródeł jest potrzebne tylko, jeśli chcesz zmieniać kod albo samodzielnie zbudować instalator. Wymaga [Node.js](https://nodejs.org/) w wersji 20 lub nowszej.

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

```
src/
  main/        Główny proces Electrona (okno, dialogi, Discord Rich Presence)
  renderer/    Interfejs: index.html, renderer.js (szkielet aplikacji), fields-table.js, feed.js, supplies.js,
               tutorial.js, translations*.js, style.css, odczyt zapisu gry i modów
data/          Dołączone dane z podstawowej gry (domyślne uprawy, zwierzęta, azot wg gleby)
Assets/        Logo i ikona aplikacji
tools/         Skrypty deweloperskie generujące pliki w data/ z plików gry
docs/          Zrzuty ekranu i notatki
```

Zbudowane z [Electrona](https://www.electronjs.org/), czystego HTML/CSS/JavaScriptu i [Font Awesome](https://fontawesome.com/).

## Lista zmian

Zobacz [CHANGELOG.md](CHANGELOG.md) (po angielsku) lub zakładkę [Releases](https://github.com/WiktorParylak/farmer-planner/releases).

---

<p align="center">
  Autor: Wiktor Parylak · <a href="https://farmerplanner.pl/pl/">farmerplanner.pl</a><br>
  <sub>Projekt niezwiązany z GIANTS Software. Farming Simulator jest znakiem towarowym GIANTS Software GmbH.</sub>
</p>
