"""Read an approved KITCHEN workbook and print a proposed master JSON update.

Usage: python prepare-kitchen-master.py workbook.xlsx src/data/costing_master.json
The caller reviews/applies the output; this script does not overwrite files.
"""
import datetime
import json
import math
import re
import sys
from pathlib import Path

import openpyxl


def text(value):
    return str(value).strip() if value is not None else ""


def number(value):
    if value is None or value == "":
        return None
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("Non-finite master value")
    return int(value) if value.is_integer() else value


def identity(item):
    return tuple(text(item.get(key)).casefold() for key in
                 ("group", "subgroup", "type", "brand")) + (item.get("thicknessMm"),)


book_path, master_path = map(Path, sys.argv[1:3])
book = openpyxl.load_workbook(book_path, read_only=True, data_only=True)
sheet = book[next(name for name in book.sheetnames if name.strip().upper() == "KITCHEN")]
rows = iter(sheet.values)
headers = [text(cell) for cell in next(rows)]
required = {"Item name", "Material Description", "Group", "Subgroup", "Rate Basis", "Price", "Sq.FT. Price"}
if not required.issubset(headers):
    raise ValueError(f"Missing KITCHEN headers: {required - set(headers)}")
master = json.loads(master_path.read_text())
available = {item["id"]: item for item in master["items"] if item["id"].startswith("KITCHEN-")}
next_id = 1 + max(int(item_id.split("-")[1]) for item_id in available if re.fullmatch(r"KITCHEN-\d+", item_id))
updates, added, rate_changes = {}, [], []
for values in rows:
    row = dict(zip(headers, values))
    if not text(row.get("Material Description")):
        continue
    item = {target: text(row.get(source)) for target, source in {
        "elevation": "Elevation", "materialDescription": "Material Description",
        "itemName": "Item name", "remark": "Remark", "unit": "Unit",
        "group": "Group", "subgroup": "Subgroup", "type": "Type", "brand": "Brand",
        "rateBasis": "Rate Basis",
    }.items()}
    item.update({target: number(row.get(source)) for target, source in {
        "sNo": "SN", "sqft": "SQFT", "price": "Price", "sqftPrice": "Sq.FT. Price",
        "thicknessMm": "Thickness (mm)",
    }.items()})
    # Keep the application's existing category keys for these sheet headings.
    if item["group"] == "Glass Shutter Profile":
        item.update(group="Profile", subgroup="Glass Shutter Profile", type=item["subgroup"])
    elif item["group"] == "Glass":
        item["group"] = "Glass Type"
    item["rateBasis"] = item["rateBasis"].upper()
    if item["rateBasis"] not in {"SQFT", "MTR", "KG", "SET", "PCS"}:
        raise ValueError(f"Unknown rate basis: {item}")
    item["currentRate"] = item["sqftPrice"] if item["rateBasis"] == "SQFT" else item["price"]
    if item["currentRate"] is None or item["currentRate"] < 0:
        raise ValueError(f"Missing or invalid rate: {item}")
    candidates = [old for old in available.values() if identity(old) == identity(item)]
    exact = [old for old in candidates if old["materialDescription"] == item["materialDescription"]]
    old = (exact or candidates or [None])[0]
    if old:
        item["id"] = old["id"]
        del available[old["id"]]
        aliases = list(dict.fromkeys([*old.get("legacyDescriptions", []), old["materialDescription"], old.get("itemName", "")]))
        aliases = [alias for alias in aliases if alias and alias not in (item["materialDescription"], item["itemName"])]
        if aliases:
            item["legacyDescriptions"] = aliases
        if old["currentRate"] != item["currentRate"]:
            rate_changes.append({"id": item["id"], "old": old["currentRate"], "new": item["currentRate"]})
        updates[item["id"]] = {**old, **item}
    else:
        item["id"] = f"KITCHEN-{next_id:03d}"
        next_id += 1
        added.append(item)
supplemental_ids = {"KITCHEN-SINK-PROFILE", "KITCHEN-EDGEBAND-ADHESIVE", "KITCHEN-LAMINATE-ADHESIVE"}
unexpected = [item_id for item_id in available if not item_id.startswith("KITCHEN-GLASS-") and item_id not in supplemental_ids]
if unexpected:
    raise ValueError(f"Existing Kitchen items absent from the sheet: {unexpected}")
master["items"] = [updates.get(item["id"], item) for item in master["items"]] + added
master["source"] = f"{book_path.name} / KITCHEN; existing supplemental glass and Hardware retained"
master["generatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
print(json.dumps({"master": master, "summary": {
    "matched": len(updates), "named": sum(bool(item["itemName"]) for item in [*updates.values(), *added]),
    "added": [{"id": item["id"], "name": item["itemName"]} for item in added],
    "rateChanges": rate_changes, "retainedSupplemental": list(available),
}}, ensure_ascii=False))
