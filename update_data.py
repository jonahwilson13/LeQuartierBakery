#!/usr/bin/env python3
"""
Adds one week of Toast sales data to this site's data files.

Usage:
    python3 update_data.py --location edgewood --week-start 2026-07-20 --csv "All levels.csv"

Run this from inside the project folder (where the data/ folder lives) after
unzipping a new Toast Product Mix (PMIX) export. It reads the exported
"All levels.csv" file, adds/updates that week's numbers in data/<location>.json,
and leaves everything else untouched.

After running this, commit and push the updated data file:
    git add data/edgewood.json
    git commit -m "Add week of 2026-07-20 for Edgewood"
    git push
"""

import argparse
import csv
import json
import os
import sys

DAY_SET = {"MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"}
DAY_TITLE = {d: d.title() for d in DAY_SET}
CATEGORY_MAP = {
    "bread": "Breads", "breads": "Breads",
    "pastry": "Pastries", "pastries": "Pastries",
    "dessert": "Desserts", "desserts": "Desserts",
}
# Breakfast & Lunch items aren't tagged with a day-of-week menu in Toast, so
# they're captured separately as one weekly total per item, not per day.
# Different locations use different category names for this: Edgewood uses
# "Breakfast"/"Lunch", Meridian uses "Prepared Food", Loveland uses "Deli".
# Dundee has no confirmed equivalent yet.
BL_CATEGORIES = {"breakfast", "lunch", "prepared food", "deli"}


def parse_toast_csv(path):
    week_data = {"Breads": {}, "Pastries": {}, "Desserts": {}, "Breakfast & Lunch": {}}
    matched = 0
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("Type") != "menuItem":
                continue
            item = (row.get("Item, open item") or "").strip()
            if not item:
                continue
            try:
                qty = float(row.get("Qty sold") or 0)
            except ValueError:
                qty = 0.0
            if qty <= 0:
                continue
            cat_raw = (row.get("Sales Category") or "").strip().lower()

            if cat_raw in BL_CATEGORIES:
                week_data["Breakfast & Lunch"][item] = week_data["Breakfast & Lunch"].get(item, 0.0) + qty
                matched += 1
                continue

            menu = (row.get("Menu") or "").strip().upper()
            if menu not in DAY_SET:
                continue
            day = DAY_TITLE[menu]
            bucket = CATEGORY_MAP.get(cat_raw)
            if "bagel" in item.lower():
                bucket = "Pastries"
            if not bucket:
                continue
            week_data[bucket].setdefault(item, {})
            week_data[bucket][item][day] = week_data[bucket][item].get(day, 0.0) + qty
            matched += 1
    return week_data, matched


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--location", required=True, help="edgewood, meridian, dundee, or loveland")
    parser.add_argument("--week-start", required=True, help="Monday's date for this week, e.g. 2026-07-20")
    parser.add_argument("--csv", required=True, help="Path to the 'All levels.csv' file from the Toast export")
    args = parser.parse_args()

    location = args.location.strip().lower()
    valid_locations = {"edgewood", "meridian", "dundee", "loveland"}
    if location not in valid_locations:
        print(f"Error: --location must be one of {sorted(valid_locations)}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.csv):
        print(f"Error: file not found: {args.csv}", file=sys.stderr)
        sys.exit(1)

    week_data, matched = parse_toast_csv(args.csv)
    if matched == 0:
        print("Error: no matching rows found. Make sure this is the 'All levels.csv' file "
              "from a Toast Product Mix export, and not one of the other files in the zip.", file=sys.stderr)
        sys.exit(1)

    data_path = os.path.join("data", f"{location}.json")
    if os.path.exists(data_path):
        with open(data_path) as f:
            weeks = json.load(f)
    else:
        weeks = []

    weeks = [w for w in weeks if w["date"] != args.week_start]
    weeks.append({"date": args.week_start, "data": week_data})
    weeks.sort(key=lambda w: w["date"])

    os.makedirs("data", exist_ok=True)
    with open(data_path, "w") as f:
        json.dump(weeks, f)

    print(f"Added week of {args.week_start} to {data_path} ({matched} rows matched, "
          f"{len(weeks)} total weeks now stored).")
    print("Next steps:")
    print(f"  git add {data_path}")
    print(f'  git commit -m "Add week of {args.week_start} for {location.title()}"')
    print("  git push")


if __name__ == "__main__":
    main()
