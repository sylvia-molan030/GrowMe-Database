"""按周拆分三类测试素材板块：新方向、老方向、图片。"""
from __future__ import annotations

import re
from typing import Any

from data_loader import store
from weekly_report import _aggregate_materials, _channel_kpi

# 展示顺序：新方向 → 老方向 → 图片（仅有数据的板块会输出）
BLOCK_LABELS = ("新方向", "老方向", "图片")
BLOCK_ORDER = {label: i for i, label in enumerate(BLOCK_LABELS)}


def _classify_new_direction_source(source_file: str) -> str:
    name = source_file or ""
    if "数字人" in name or "新创意" in name or "新形式" in name:
        return "新方向"
    if "图片" in name or re.search(r"pic", name, re.I):
        return "图片"
    if "新方向" in name:
        return "图片"
    return "新方向"


def _material_row(m: dict[str, Any], rank: int) -> dict[str, Any]:
    hook = m.get("hook_rate") or 0
    retention = m.get("retention_rate") or 0
    return {
        "rank": rank,
        "material_id": m["material_id"],
        "direction": m.get("direction"),
        "theme": m.get("theme"),
        "designer": m.get("designer"),
        "spend": round(m.get("spend", 0), 2),
        "purchases": int(m.get("purchases", 0)),
        "subscriptions": int(m.get("subscriptions", 0)),
        "roas": round(m.get("roas", 0), 2),
        "ctr": round(m.get("ctr", 0), 2),
        "hook_rate": round(hook, 2) if hook else None,
        "retention_rate": round(retention, 2) if retention else None,
    }


def _build_block(records: list[dict[str, Any]], label: str, week_label: str) -> dict[str, Any] | None:
    materials = _aggregate_materials(records)
    # 有量：至少有一条测试素材
    if not materials:
        return None
    kpi = _channel_kpi(materials)
    ordered = [m for m in materials if m.get("purchases", 0) >= 1]
    ordered.sort(key=lambda m: (-m.get("purchases", 0), -m.get("spend", 0)))

    notes = {
        "老方向": f"{week_label} 老方向（常规上新）素材，已计入周度 KPI。",
        "新方向": f"{week_label} 新方向（新形式/数字人等）测试素材，已计入周度 KPI。",
        "图片": f"{week_label} 图片素材方向测试，已计入周度 KPI。",
    }

    return {
        "label": label,
        "week_label": week_label,
        "summary": {
            "total_materials": kpi["total_materials"],
            "ordered_materials": kpi["ordered_materials"],
            "conversions": kpi["conversions"],
            "order_rate": kpi["order_rate"],
            "spend": kpi["spend"],
            "subscriptions": kpi["subscriptions"],
        },
        "materials": [_material_row(m, i + 1) for i, m in enumerate(ordered)],
        "note": notes.get(label, ""),
    }


def get_weekly_test_blocks(week_label: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []

    weekly_recs = [
        r
        for r in store.records
        if r.get("data_scope") == "weekly" and r.get("week_label") == week_label
    ]
    if weekly_recs:
        block = _build_block(weekly_recs, "老方向", week_label)
        if block:
            blocks.append(block)

    grouped: dict[str, list[dict[str, Any]]] = {}
    for r in store.records:
        if r.get("data_scope") != "new_direction" or r.get("week_label") != week_label:
            continue
        key = _classify_new_direction_source(r.get("source_file", ""))
        grouped.setdefault(key, []).append(r)

    for label in ("新方向", "图片"):
        if grouped.get(label):
            block = _build_block(grouped[label], label, week_label)
            if block:
                blocks.append(block)

    return sorted(blocks, key=lambda b: BLOCK_ORDER.get(b["label"], 9))
