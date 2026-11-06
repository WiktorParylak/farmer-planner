# Do zrobienia

## Do naprawy

- [x] **Pasek boczny przy 1280 px:** ikona „Notatki” jest przesunięta w lewo względem pozostałych, bo obok niej stoi licznik.
- [x] **Dymek płodozmianu:** komunikat „Poza płodozmianem…” przez kilka sekund zasłania miesiąc w nagłówku.
- [x] **Cofanie:** przez 900 ms po otwarciu farmy automatyczny zapis płodozmianu (`maybeFillFromRotation`) może skasować historię cofania. W praktyce niegroźne, bo tak szybko nikt nic nie zmieni.

## Do sprawdzenia ręcznie (testy tego nie obejmują)

- [x] Synchronizacja z prawdziwym zapisem gry (na kopii zapisu).
- [x] Mod Link.
- [x] Ścieżki technologiczne.
- [x] Skalowanie mapy.
- [x] Wygląd ekranów: obejrzeć zdjęcia z `npm run test:screens` (`test-output/screens/index.html`). Automat szuka tylko konkretnych usterek, a z 88 zdjęć obejrzanych jest dopiero kilka.
