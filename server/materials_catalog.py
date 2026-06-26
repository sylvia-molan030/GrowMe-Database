"""整理并导出全量素材目录。"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

import pandas as pd

from data_loader import store

from parser import canonical_direction

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data_outputs"
CATALOG_FILE = OUTPUT_DIR / "materials_catalog.csv"

CATALOG_COLUMNS = [
    "material_id",
    "standard_id",
    "first_seen",
    "internal_name",
    "language",
    "size",
    "direction",
    "theme",
    "optimization",
    "stylization",
    "pain_point",
    "exercise_type",
    "r_version",
    "c_version",
    "m_version",
    "designer",
    "designer_variant",
    "serial_code",
    "parse_status",
    "channels",
    "source_files",
    "total_purchases",
    "total_spend",
    "total_impressions",
    "avg_ctr",
    "avg_roas",
    "has_order",
]


def build_catalog() -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}

    for record in store.records:
        mid = record["material_id"]
        if mid not in grouped:
            grouped[mid] = {
                "material_id": mid,
                "standard_id": record.get("standard_id", mid),
                "first_seen": record.get("first_seen"),
                "internal_name": record.get("internal_name"),
                "language": record.get("language"),
                "size": record.get("size"),
                "direction": record.get("direction"),
                "theme": record.get("theme"),
                "optimization": record.get("optimization"),
                "stylization": record.get("stylization"),
                "pain_point": record.get("pain_point"),
                "exercise_type": record.get("exercise_type"),
                "r_version": record.get("r_version"),
                "c_version": record.get("c_version"),
                "m_version": record.get("m_version"),
                "designer": record.get("designer"),
                "designer_variant": record.get("designer_variant"),
                "serial_code": record.get("serial_code"),
                "parse_status": record.get("parse_status"),
                "channels": set(),
                "source_files": set(),
                "total_purchases": 0.0,
                "total_spend": 0.0,
                "total_impressions": 0.0,
                "ctr_values": [],
                "roas_values": [],
            }

        item = grouped[mid]
        item["channels"].add(record.get("channel", ""))
        item["source_files"].add(record.get("source_file", ""))
        item["total_purchases"] += record.get("purchases", 0)
        item["total_spend"] += record.get("spend", 0)
        item["total_impressions"] += record.get("impressions", 0)
        if record.get("ctr"):
            item["ctr_values"].append(record["ctr"])
        if record.get("roas"):
            item["roas_values"].append(record["roas"])

    rows: list[dict[str, Any]] = []
    for item in grouped.values():
        ctr_vals = item.pop("ctr_values")
        roas_vals = item.pop("roas_values")
        rows.append(
            {
                **{k: item[k] for k in item if k not in {"channels", "source_files"}},
                "channels": ",".join(sorted(c for c in item["channels"] if c)),
                "source_files": ",".join(sorted(f for f in item["source_files"] if f)),
                "avg_ctr": round(sum(ctr_vals) / len(ctr_vals), 2) if ctr_vals else 0,
                "avg_roas": round(sum(roas_vals) / len(roas_vals), 2) if roas_vals else 0,
                "has_order": item["total_purchases"] >= 1,
            }
        )

    rows.sort(key=lambda r: (r.get("first_seen") or "", r["material_id"]))
    return rows


def export_catalog() -> dict[str, Any]:
    rows = build_catalog()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=CATALOG_COLUMNS)
    df.to_csv(CATALOG_FILE, index=False, encoding="utf-8-sig")

    complete = sum(1 for r in rows if r.get("parse_status") == "complete")
    partial = sum(1 for r in rows if r.get("parse_status") == "partial")
    return {
        "total_materials": len(rows),
        "complete": complete,
        "partial": partial,
        "output_file": str(CATALOG_FILE),
    }


def get_catalog_summary() -> dict[str, Any]:
    rows = build_catalog()
    by_direction: dict[str, int] = defaultdict(int)
    by_designer: dict[str, int] = defaultdict(int)
    for row in rows:
        by_direction[canonical_direction(row.get("direction") or "未知")] += 1
        by_designer[row.get("designer", "未知")] += 1

    return {
        "total_materials": len(rows),
        "by_direction": dict(sorted(by_direction.items(), key=lambda x: -x[1])),
        "by_designer": dict(sorted(by_designer.items(), key=lambda x: -x[1])[:20]),
        "catalog_file": str(CATALOG_FILE),
    }
