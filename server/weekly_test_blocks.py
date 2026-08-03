"""按周拆分三类测试素材板块：新素材、老素材、图片。"""
from __future__ import annotations

from typing import Any

from data_loader import store
from parser import is_pic_material
from weekly_report import (
    _aggregate_materials,
    _channel_kpi,
    _overlay_lifecycle_metrics,
    _account_materials_index,
)


# 展示顺序：新素材 → 老素材 → 图片
BLOCK_LABELS = ("新素材", "老素材", "图片")
BLOCK_ORDER = {label: i for i, label in enumerate(BLOCK_LABELS)}


def _classify_material(m: dict[str, Any], week_label: str) -> str:
    if is_pic_material(m.get("material_id") or "", week_label):
        return "图片"
    if (m.get("designer") or "").strip().lower() == "cty":
        return "老素材"
    return "新素材"


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


def _build_block(
    materials: list[dict[str, Any]],
    label: str,
    week_label: str,
) -> dict[str, Any] | None:
    if not materials:
        return None
    kpi = _channel_kpi(materials)
    ordered = [m for m in materials if m.get("purchases", 0) >= 1]
    ordered.sort(key=lambda m: (-m.get("purchases", 0), -m.get("roas", 0), -m.get("spend", 0)))

    notes = {
        "老素材": f"{week_label} 老素材（设计师 cty），出单指标来自账户全量。",
        "新素材": f"{week_label} 新素材（非 cty），出单指标来自账户全量。",
        "图片": f"{week_label} 图片素材（FX-pic；0720周前含 ZT-pic），出单指标来自账户全量。",
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
        "metric_source": "account_lifecycle",
    }


def get_weekly_test_blocks(
    week_label: str,
    *,
    lifecycle: bool = True,
) -> list[dict[str, Any]]:
    """从周度文件取本周素材，按 cty / pic 规则拆分三块并覆盖账户成效。"""
    records = [
        r
        for r in store.records
        if r.get("data_scope") in ("weekly", "new_direction") and r.get("week_label") == week_label
    ]
    if not records:
        return []

    materials = _aggregate_materials(records)
    if lifecycle:
        materials = _overlay_lifecycle_metrics(materials, _account_materials_index())

    grouped: dict[str, list[dict[str, Any]]] = {label: [] for label in BLOCK_LABELS}
    for m in materials:
        grouped[_classify_material(m, week_label)].append(m)

    blocks: list[dict[str, Any]] = []
    for label in BLOCK_LABELS:
        block = _build_block(grouped[label], label, week_label)
        if block:
            blocks.append(block)
    return blocks
