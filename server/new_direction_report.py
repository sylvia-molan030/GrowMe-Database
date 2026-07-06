"""新方向测试：独立跟踪数字人、图片素材等试验性方向。"""
from __future__ import annotations

from typing import Any

from data_loader import store, week_sort_key
from weekly_report import _aggregate_materials


def _new_direction_labels() -> list[str]:
    labels = {
        r.get("week_label", "")
        for r in store.records
        if r.get("data_scope") == "new_direction" and r.get("week_label")
    }
    return sorted(labels, key=week_sort_key)


def _group_key_from_source(source_file: str) -> str:
    name = source_file or ""
    if "数字人" in name:
        return "数字人"
    if "图片" in name.lower():
        return "图片素材"
    if "新方向" in name:
        return "新方向测试"
    return "新方向测试"


def _display_direction(label: str, materials: list[dict[str, Any]]) -> str:
    if label == "图片素材":
        return "pic"
    if label == "数字人":
        themes = " ".join(m.get("theme") or "" for m in materials).lower()
        if "aitalk" in themes:
            return "aitalk"
    directions = sorted({m.get("direction") for m in materials if m.get("direction")})
    return directions[0] if directions else "unknown"


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


def _build_block(records: list[dict[str, Any]], label: str, week_label: str) -> dict[str, Any]:
    materials = _aggregate_materials(records)
    materials.sort(key=lambda m: (-m.get("purchases", 0), -m.get("spend", 0)))

    total = len(materials)
    spend = sum(m.get("spend", 0) for m in materials)
    purchases = sum(m.get("purchases", 0) for m in materials)
    subscriptions = sum(m.get("subscriptions", 0) for m in materials)
    ordered = sum(1 for m in materials if m.get("purchases", 0) >= 1)
    direction = _display_direction(label, materials)

    note_map = {
        "图片素材": f"{week_label} 图片素材新方向测试（FX-{direction}），已计入上方周度 KPI，此处单独展开明细。",
        "数字人": f"{week_label} 数字人新方向测试（FX-{direction}），已计入上方周度 KPI，此处单独展开明细。",
    }
    note = note_map.get(label, f"{week_label} {label}（FX-{direction}），已计入上方周度 KPI，此处单独展开明细。")

    return {
        "label": label,
        "week_label": week_label,
        "direction": direction,
        "summary": {
            "total_materials": total,
            "spend": round(spend, 2),
            "purchases": int(purchases),
            "subscriptions": int(subscriptions),
            "ordered_materials": ordered,
            "order_rate": round(ordered / total * 100, 2) if total else 0,
        },
        "materials": [_material_row(m, i + 1) for i, m in enumerate(materials)],
        "note": note,
    }


def get_new_direction_blocks_for_week(week_label: str) -> list[dict[str, Any]]:
    records = [
        r
        for r in store.records
        if r.get("data_scope") == "new_direction" and r.get("week_label") == week_label
    ]
    if not records:
        return []

    grouped: dict[str, list[dict[str, Any]]] = {}
    for r in records:
        key = _group_key_from_source(r.get("source_file", ""))
        grouped.setdefault(key, []).append(r)

    order = {"数字人": 0, "图片素材": 1, "新方向测试": 2}
    blocks = []
    for label in sorted(grouped, key=lambda k: order.get(k, 9)):
        blocks.append(_build_block(grouped[label], label, week_label))
    return blocks


def get_new_direction_for_week(week_label: str) -> dict[str, Any] | None:
    blocks = get_new_direction_blocks_for_week(week_label)
    return blocks[0] if blocks else None


def get_new_direction_report() -> dict[str, Any]:
    records = [r for r in store.records if r.get("data_scope") == "new_direction"]
    materials = _aggregate_materials(records)
    materials.sort(key=lambda m: (-m.get("purchases", 0), -m.get("spend", 0)))

    total = len(materials)
    spend = sum(m.get("spend", 0) for m in materials)
    purchases = sum(m.get("purchases", 0) for m in materials)
    subscriptions = sum(m.get("subscriptions", 0) for m in materials)
    ordered = sum(1 for m in materials if m.get("purchases", 0) >= 1)

    weeks = _new_direction_labels()
    week_label = weeks[-1] if weeks else None
    blocks = get_new_direction_blocks_for_week(week_label) if week_label else []
    label = blocks[0]["label"] if blocks else "新方向测试"
    direction = blocks[0]["direction"] if blocks else "unknown"

    return {
        "label": label,
        "week_label": week_label,
        "weeks": weeks,
        "direction": direction,
        "summary": {
            "total_materials": total,
            "spend": round(spend, 2),
            "purchases": int(purchases),
            "subscriptions": int(subscriptions),
            "ordered_materials": ordered,
            "order_rate": round(ordered / total * 100, 2) if total else 0,
        },
        "materials": [_material_row(m, i + 1) for i, m in enumerate(materials)],
        "note": f"{week_label or '本周'} 起测试 {label} 方向（FX-{direction}），已计入对应周度 KPI。",
    }
