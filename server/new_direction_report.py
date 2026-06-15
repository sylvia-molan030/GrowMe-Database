"""新方向测试：独立跟踪数字人等试验性方向素材。"""
from __future__ import annotations

import re
from typing import Any

from data_loader import store, week_sort_key
from weekly_report import _aggregate_materials

NEW_DIRECTION_LABEL = "数字人"


def _new_direction_labels() -> list[str]:
    labels = {
        r.get("week_label", "")
        for r in store.records
        if r.get("data_scope") == "new_direction" and r.get("week_label")
    }
    return sorted(labels, key=week_sort_key)


def _material_row(m: dict[str, Any], rank: int) -> dict[str, Any]:
    return {
        "rank": rank,
        "material_id": m["material_id"],
        "direction": m.get("direction"),
        "theme": m.get("theme"),
        "designer": m.get("designer"),
        "first_seen": m.get("first_seen"),
        "week_label": m.get("week_label"),
        "spend": round(m.get("spend", 0), 2),
        "purchases": int(m.get("purchases", 0)),
        "subscriptions": int(m.get("subscriptions", 0)),
        "roas": round(m.get("roas", 0), 2),
        "ctr": round(m.get("ctr", 0), 2),
        "scaling_status": m.get("scaling_status"),
    }


def get_new_direction_for_week(week_label: str) -> dict[str, Any] | None:
    records = [
        r
        for r in store.records
        if r.get("data_scope") == "new_direction" and r.get("week_label") == week_label
    ]
    if not records:
        return None

    materials = _aggregate_materials(records)
    materials.sort(key=lambda m: (-m.get("purchases", 0), -m.get("spend", 0)))

    total = len(materials)
    spend = sum(m.get("spend", 0) for m in materials)
    purchases = sum(m.get("purchases", 0) for m in materials)
    subscriptions = sum(m.get("subscriptions", 0) for m in materials)
    ordered = sum(1 for m in materials if m.get("purchases", 0) >= 1)
    directions = sorted({m.get("direction") for m in materials if m.get("direction")})

    return {
        "label": NEW_DIRECTION_LABEL,
        "week_label": week_label,
        "direction": directions[0] if directions else "aitalk",
        "summary": {
            "total_materials": total,
            "spend": round(spend, 2),
            "purchases": int(purchases),
            "subscriptions": int(subscriptions),
            "ordered_materials": ordered,
            "order_rate": round(ordered / total * 100, 2) if total else 0,
        },
        "materials": [_material_row(m, i + 1) for i, m in enumerate(materials)],
        "note": f"本周另起 {NEW_DIRECTION_LABEL} 新方向测试（FX-aitalk），与常规周度上新分开统计，不计入上方 KPI。",
    }


def get_new_direction_report() -> dict[str, Any]:
    records = [r for r in store.records if r.get("data_scope") == "new_direction"]
    materials = _aggregate_materials(records)
    materials.sort(key=lambda m: (-m.get("purchases", 0), -m.get("spend", 0)))

    total = len(materials)
    spend = sum(m.get("spend", 0) for m in materials)
    purchases = sum(m.get("purchases", 0) for m in materials)
    subscriptions = sum(m.get("subscriptions", 0) for m in materials)
    ordered = sum(1 for m in materials if m.get("purchases", 0) >= 1)
    directions = sorted({m.get("direction") for m in materials if m.get("direction")})

    weeks = _new_direction_labels()
    week_label = weeks[-1] if weeks else None

    return {
        "label": NEW_DIRECTION_LABEL,
        "week_label": week_label,
        "weeks": weeks,
        "direction": directions[0] if directions else "aitalk",
        "summary": {
            "total_materials": total,
            "spend": round(spend, 2),
            "purchases": int(purchases),
            "subscriptions": int(subscriptions),
            "ordered_materials": ordered,
            "order_rate": round(ordered / total * 100, 2) if total else 0,
        },
        "materials": [_material_row(m, i + 1) for i, m in enumerate(materials)],
        "note": f"{week_label or '本周'} 起单独测试 {NEW_DIRECTION_LABEL} 方向（FX-aitalk），与常规周度上新分开统计。",
    }
