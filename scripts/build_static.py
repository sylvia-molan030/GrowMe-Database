#!/usr/bin/env python3
"""扫描 data_inputs 并导出 GitHub Pages 静态数据包。"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"
sys.path.insert(0, str(SERVER))

import analytics  # noqa: E402
from data_loader import get_weekly_labels, store, week_sort_key  # noqa: E402
from new_direction_report import get_new_direction_report  # noqa: E402
from rollback_report import get_rollback_report  # noqa: E402
from weekly_report import build_all_reports  # noqa: E402

OUTPUT_DIR = ROOT / "docs" / "data"
ALL_FILTERS = {
    "date_start": "2020-01-01",
    "date_end": "2030-12-31",
    "direction": "全部",
    "theme": "全部",
    "optimization": "全部",
    "stylization": "全部",
    "pain_point": "全部",
    "exercise_type": "全部",
    "channel": "全部",
}


def _material_row(m: dict, rank: int) -> dict:
    return {
        "rank": rank,
        "material_id": m["material_id"],
        "standard_id": m.get("standard_id"),
        "first_seen": m.get("first_seen"),
        "designer": m.get("designer"),
        "designer_variant": m.get("designer_variant"),
        "serial_code": m.get("serial_code"),
        "direction": m.get("direction"),
        "theme": m.get("theme"),
        "optimization": m.get("optimization") or "",
        "stylization": m.get("stylization"),
        "pain_point": m.get("pain_point"),
        "exercise_type": m.get("exercise_type"),
        "channel": m.get("channel") or "WW",
        "purchases": int(m["purchases"]),
        "roas": round(m["roas"], 2),
        "ctr": round(m["ctr"], 2),
        "spend": round(m["spend"], 2),
        "scaling_status": m.get("scaling_status"),
        "hook_rate": round(m.get("hook_rate") or 0, 2),
        "retention_rate": round(m.get("retention_rate") or 0, 2),
        "week_label": m.get("week_label"),
    }


def _export_materials(mode: str, scope: str | None = None, weekly_only: bool = False) -> list[dict]:
    records = analytics.filter_records(ALL_FILTERS, mode=mode, scope=scope, weekly_only=weekly_only)
    materials = analytics._aggregate_by_material(records)
    materials.sort(key=lambda m: m.get("purchases", 0), reverse=True)
    return [_material_row(m, i + 1) for i, m in enumerate(materials)]


def _export_weekly_reports() -> dict:
    reports = build_all_reports()
    return {"weeks": sorted(reports.keys(), key=week_sort_key), "reports": reports}


def build() -> dict:
    store.scan()

    account_materials = _export_materials("account")
    weekly_materials = _export_materials("new")
    weekly_reports = _export_weekly_reports()

    ds, de = analytics.default_date_range("account")
    wds, wde = analytics.default_date_range("weekly")
    data_min, data_max = analytics.get_data_date_range("account")
    weekly_min, weekly_max = analytics.get_data_date_range("weekly")

    snapshot = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "site_url": "https://sylvia-molan030.github.io/GrowMe-Database/",
        "meta": {
            "files_loaded": store.files_loaded,
            "records": len(store.records),
            "scanned_at": store.last_scan_at,
            "default_date_start": ds,
            "default_date_end": de,
            "data_date_start": data_min,
            "data_date_end": data_max,
            "weekly_date_start": weekly_min,
            "weekly_date_end": weekly_max,
            "weekly_default_date_start": wds,
            "weekly_default_date_end": wde,
            "weekly_labels": get_weekly_labels(),
            "designer_labels": ["gy", "wxx", "fj", "jql", "095KB", "pingme", "jpl", "其他"],
            "filter_options": analytics.get_filter_options("account"),
            "weekly_filter_options": analytics.get_filter_options("weekly"),
            "channel_labels": {"T1": "T1（美国等）", "WW": "WW（全球）"},
            "catalog": {
                "total_materials": len(account_materials),
                "weekly_materials": len(weekly_materials),
            },
            "static": True,
        },
        "materials_account": account_materials,
        "materials_weekly": weekly_materials,
        "weekly_reports": weekly_reports["reports"],
        "rollback": get_rollback_report(),
        "new_direction": get_new_direction_report(),
    }
    return snapshot, weekly_reports


def main() -> None:
    snapshot, weekly_reports = build()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUTPUT_DIR / "snapshot.json"
    weekly_out = OUTPUT_DIR / "weekly-reports.json"
    out.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    weekly_out.write_text(json.dumps(weekly_reports, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ 静态数据已导出: {out}")
    print(f"✓ 周度报告已导出: {weekly_out}")
    print(f"  账户素材: {len(snapshot['materials_account'])} 条")
    print(f"  周度上新素材: {len(snapshot['materials_weekly'])} 条（全部已导入周）")
    print(f"  周度 Tab: {' · '.join(snapshot['meta']['weekly_labels'])}")


if __name__ == "__main__":
    main()
