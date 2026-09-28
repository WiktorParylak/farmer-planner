"""
Scan a FS25 map's foliage folder and pull the agronomy numbers the
Farmer Planner cares about: seed rate, base yield, lime requirement and the
fertiliser start level. Nitrogen kg/ha is NOT in these files (Precision
Farming derives it from yield potential), so it is left for the app's
nitrogen-by-soil.json.

Usage:
    python tools/scan-solek-agronomy.py "C:/path/to/FS25_Solek/map/foliage" [out.json]

Defaults to the Solek copy on the Desktop and writes SOLEK_agronomy.json
next to this script.
"""
import os
import sys
import json
import xml.etree.ElementTree as ET

DEFAULT_IN = os.path.expanduser("~/Desktop/FS25_Solek/map/foliage")
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "SOLEK_agronomy.json")

PERIOD_TO_MONTH = {
    "EARLY_SPRING": "MARCH", "MID_SPRING": "APRIL", "LATE_SPRING": "MAY",
    "EARLY_SUMMER": "JUNE", "MID_SUMMER": "JULY", "LATE_SUMMER": "AUGUST",
    "EARLY_AUTUMN": "SEPTEMBER", "MID_AUTUMN": "OCTOBER", "LATE_AUTUMN": "NOVEMBER",
    "EARLY_WINTER": "DECEMBER", "MID_WINTER": "JANUARY", "LATE_WINTER": "FEBRUARY",
}

# foliage name -> the crop key the app uses (crops.json / field.crop).
NAME_FIX = {
    "sugarBeet": "Sugarbeet", "greenRye": "Greenrye", "silageMaize": "Silagemaize",
    "oilseedRadish": "Oilseedradish", "beetRoot": "Beetroot", "greenBean": "Greenbean",
    "meadow": "Meadow",
}


def crop_key(raw):
    if raw in NAME_FIX:
        return NAME_FIX[raw]
    return raw[:1].upper() + raw[1:].lower()


def fnum(el, attr):
    if el is None:
        return None
    v = el.get(attr)
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def scan_file(path):
    root = ET.parse(path).getroot()
    ft = root.find(".//fruitType")
    if ft is None:
        return None

    seeding = ft.find("seeding")
    harvest = ft.find("harvest")
    windrow = ft.find("windrow")
    growth0 = ft.find("growth")
    soil = ft.find("soil")

    seed_lsqm = fnum(seeding, "litersPerSqm")
    if seed_lsqm is None:
        seed_lsqm = fnum(seeding, "seedUsagePerSqm")
    harvest_lsqm = fnum(harvest, "litersPerSqm")

    planting_months = []
    seasonal = root.find(".//growth/seasonal")
    if seasonal is not None:
        for period in seasonal.findall("period"):
            if period.get("plantingAllowed") == "true":
                m = PERIOD_TO_MONTH.get(period.get("name"))
                if m:
                    planting_months.append(m)

    requires_lime = (growth0 is not None and growth0.get("growthRequiresLime") == "true") \
        or (soil is not None and soil.get("consumesLime") == "true")

    return {
        "key": crop_key(ft.get("name")),
        "rawName": ft.get("name"),
        "isAvailable": (seeding is not None and seeding.get("isAvailable") == "true"),
        "shownOnMap": ft.get("shownOnMap") == "true",
        "seedLitersPerSqm": seed_lsqm,
        "seedLitersPerHa": round(seed_lsqm * 10000, 1) if seed_lsqm is not None else None,
        "harvestLitersPerSqm": harvest_lsqm,
        "harvestLitersPerHa": round(harvest_lsqm * 10000) if harvest_lsqm is not None else None,
        "windrowLitersPerSqm": fnum(windrow, "litersPerSqm"),
        "needsRolling": (seeding is not None and seeding.get("needsRolling") == "true"),
        "requiresLime": bool(requires_lime),
        "startSprayLevel": int(fnum(soil, "startSprayLevel") or 0),
        "plantingMonths": planting_months,
    }


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_IN
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT

    if not os.path.isdir(folder):
        print(f"[ERR] not a folder: {folder}")
        sys.exit(1)

    result = {}
    for name in sorted(os.listdir(folder)):
        sub = os.path.join(folder, name)
        if not os.path.isdir(sub):
            continue
        xml = os.path.join(sub, name + ".xml")
        if not os.path.isfile(xml):
            cands = [f for f in os.listdir(sub) if f.endswith(".xml")]
            if not cands:
                continue
            xml = os.path.join(sub, cands[0])
        try:
            row = scan_file(xml)
        except Exception as e:
            print(f"[skip] {name}: {e}")
            continue
        if row:
            result[row["key"]] = row
            print(f"[ok] {row['key']:<14} seed {row['seedLitersPerHa']} l/ha  "
                  f"yield {row['harvestLitersPerHa']} l/ha  lime={row['requiresLime']}  "
                  f"spray0={row['startSprayLevel']}")

    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"\n[done] {len(result)} crops -> {out}")


if __name__ == "__main__":
    main()
