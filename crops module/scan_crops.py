import os
import json
import xml.etree.ElementTree as ET
import tkinter as tk
from tkinter import filedialog

# --- KONFIGURACJA: Tłumaczenie okresów z gry na miesiące ---
PERIOD_MAP = [
    ("EARLY_SPRING", "MARCH"), ("MID_SPRING", "APRIL"), ("LATE_SPRING", "MAY"),
    ("EARLY_SUMMER", "JUNE"), ("MID_SUMMER", "JULY"), ("LATE_SUMMER", "AUGUST"),
    ("EARLY_AUTUMN", "SEPTEMBER"), ("MID_AUTUMN", "OCTOBER"), ("LATE_AUTUMN", "NOVEMBER"),
    ("EARLY_WINTER", "DECEMBER"), ("MID_WINTER", "JANUARY"), ("LATE_WINTER", "FEBRUARY")
]

def select_input_folder():
    """Otwiera okno wyboru folderu i zwraca ścieżkę."""
    print("[SYSTEM] Wybierz folder z plikami XML...")
    folder_path = filedialog.askdirectory(title="Wybierz folder XML (np. foliage)")
    return folder_path

def save_output_file(data):
    """Otwiera okno ZAPISZ JAKO, aby uniknąć błędu uprawnień."""
    print("[SYSTEM] Wybierz miejsce zapisu pliku...")
    file_path = filedialog.asksaveasfilename(
        defaultextension=".json",
        filetypes=[("Pliki JSON", "*.json"), ("Wszystkie pliki", "*.*")],
        initialfile="kalendarz_upraw.json",
        title="Gdzie zapisać wynik?"
    )
    return file_path

def get_harvest_state_name(root):
    for state in root.findall(".//foliageState"):
        if state.get("isHarvestReady") == "true":
            return state.get("name")
    return "harvestReady"

def parse_growth_transitions(root):
    transitions = {}
    growth = root.find(".//growth/seasonal")
    if growth is None: return None
    for period in growth.findall("period"):
        period_name = period.get("name")
        transitions[period_name] = {}
        for update in period.findall("update"):
            start = update.get("startState")
            end = update.get("endState")
            transitions[period_name][start] = end
    return transitions

def simulate_growth(start_month_idx, transitions, harvest_state_name):
    current_state = "invisible"
    start_period_name = PERIOD_MAP[start_month_idx][0]
    
    if start_period_name in transitions and "invisible" in transitions[start_period_name]:
        current_state = transitions[start_period_name]["invisible"]

    for i in range(1, 20):
        next_month_idx = (start_month_idx + i) % 12
        period_name, month_name = PERIOD_MAP[next_month_idx]
        
        if current_state == harvest_state_name: return month_name
            
        if period_name in transitions and current_state in transitions[period_name]:
            current_state = transitions[period_name][current_state]
            if current_state == harvest_state_name: return month_name
    return None

def main():
    # Inicjalizacja Tkinter (ukrywamy główne okno)
    root = tk.Tk()
    root.withdraw()

    # 1. Wybór folderu wejściowego
    folder_path = select_input_folder()
    
    if not folder_path:
        print("[ANULOWANO] Nie wybrano folderu.")
        root.destroy()
        return

    print(f"[SYSTEM] Analiza plików w: {folder_path}...\n")
    final_data = {}

    for filename in os.listdir(folder_path):
        if filename.endswith(".xml"):
            try:
                tree = ET.parse(os.path.join(folder_path, filename))
                root = tree.getroot()
                
                fruit_type = root.find(".//fruitType")
                if fruit_type is None: continue 
                
                crop_name = fruit_type.get("name").capitalize()
                harvest_state = get_harvest_state_name(root)
                transitions = parse_growth_transitions(root)
                
                if not transitions: continue

                crop_calendar = {}
                growth_node = root.find(".//growth/seasonal")
                
                for idx, (period_name, month_name) in enumerate(PERIOD_MAP):
                    period_node = growth_node.find(f"./period[@name='{period_name}']")
                    if period_node is not None and period_node.get("plantingAllowed") == "true":
                        harvest_month = simulate_growth(idx, transitions, harvest_state)
                        if harvest_month:
                            crop_calendar[month_name] = harvest_month

                if crop_calendar:
                    final_data[crop_name] = crop_calendar
                    print(f"[OK] Przetworzono: {crop_name}")

            except Exception:
                pass # Ignorujemy błędy pojedynczych plików

    # 2. Wybór miejsca zapisu (Rozwiązanie problemu Permission Denied)
    if final_data:
        save_path = save_output_file(final_data)
        
        if save_path:
            try:
                with open(save_path, "w", encoding="utf-8") as f:
                    json.dump(final_data, f, indent=4, ensure_ascii=False)
                print(f"\n[SUKCES] Plik zapisany tutaj:\n{save_path}")
            except Exception as e:
                print(f"\n[BLAD] Nie udalo sie zapisac: {e}")
        else:
            print("\n[ANULOWANO] Nie wybrano miejsca zapisu.")
    else:
        print("\n[INFO] Nie znaleziono żadnych danych o uprawach.")

    root.destroy()
    input("\nNaciśnij ENTER, aby zamknąć...")

if __name__ == "__main__":
    main()