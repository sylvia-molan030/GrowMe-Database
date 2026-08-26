"""按周拆分测试素材板块：0803 周前 新/老/图片；0803 周起 高价值用户 / 英语。"""
from __future__ import annotations

from typing import Any

from data_loader import WEEKLY_DATA_SCOPES, store, week_sort_key
from parser import is_pic_material
from weekly_report import (
    _aggregate_materials,
    _channel_kpi,
    _overlay_lifecycle_metrics,
    _account_materials_index,
    uses_subscription_metrics,
)

# 0803 周前：新素材 → 老素材 → 图片
BLOCK_LABELS = ("新素材", "老素材", "图片")
BLOCK_ORDER = {label: i for i, label in enumerate(BLOCK_LABELS)}

# 0803 周起：高价值用户 → 英语
SEGMENT_BLOCK_LABELS = ("高价值用户", "英语")
SEGMENT_BLOCK_ORDER = {label: i for i, label in enumerate(SEGMENT_BLOCK_LABELS)}


def _classify_material(m: dict[str, Any], week_label: str) -> str:
    if is_pic_material(m.get("material_id") or "", week_label):
        return "图片"
    if (m.get("designer") or "").strip().lower() == "cty":
        return "老素材"
    return "新素材"


def _material_row(m: dict[str, Any], rank: int, *, subscription_mode: bool = False) -> dict[str, Any]:
    hook = m.get("hook_rate") or 0
    retention = m.get("retention_rate") or 0
    subs = int(m.get("subscriptions", 0))
    spend = round(m.get("spend", 0), 2)
    installs = int(m.get("installs", 0))
    sub_cost = round(spend / subs, 2) if subscription_mode and subs > 0 else None
    cpi = round(spend / installs, 2) if installs > 0 else None
    sub_rate = round(subs / installs * 100, 2) if installs > 0 else None
    return {
        "rank": rank,
        "material_id": m["material_id"],
        "direction": m.get("direction"),
        "theme": m.get("theme"),
        "designer": m.get("designer"),
        "spend": spend,
        "purchases": int(m.get("purchases", 0)),
        "subscriptions": subs,
        "installs": installs,
        "cpi": cpi,
        "subscription_rate": sub_rate,
        "subscription_cost": sub_cost,
        "roas": round(m.get("roas", 0), 2),
        "ctr": round(m.get("ctr", 0), 2),
        "hook_rate": round(hook, 2) if hook else None,
        "retention_rate": round(retention, 2) if retention else None,
    }


def _build_block(
    materials: list[dict[str, Any]],
    label: str,
    week_label: str,
    *,
    subscription_mode: bool = False,
) -> dict[str, Any] | None:
    if not materials:
        return None
    kpi = _channel_kpi(materials, subscription_mode=subscription_mode)

    if subscription_mode:
        ranked = [m for m in materials if m.get("subscriptions", 0) >= 1]
        ranked.sort(
            key=lambda m: (-m.get("subscriptions", 0), -m.get("spend", 0)),
        )
        notes = {
            "高价值用户": f"{week_label} 高价值用户板块，订阅指标来自账户全量。",
            "英语": f"{week_label} 英语板块，订阅指标来自账户全量。",
        }
    else:
        ranked = [m for m in materials if m.get("purchases", 0) >= 1]
        ranked.sort(key=lambda m: (-m.get("purchases", 0), -m.get("roas", 0), -m.get("spend", 0)))
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
            "subscription_cost": kpi.get("subscription_cost"),
            "metric_mode": kpi.get("metric_mode", "purchase"),
        },
        "materials": [
            _material_row(m, i + 1, subscription_mode=subscription_mode)
            for i, m in enumerate(ranked)
        ],
        "note": notes.get(label, ""),
        "metric_source": "account_lifecycle",
    }


def _segment_records(week_label: str, segment_label: str) -> list[dict[str, Any]]:
    return [
        r
        for r in store.records
        if r.get("data_scope") in WEEKLY_DATA_SCOPES
        and r.get("week_label") == week_label
        and r.get("segment_label") == segment_label
    ]


def _legacy_blocks(week_label: str, *, lifecycle: bool) -> list[dict[str, Any]]:
    records = [
        r
        for r in store.records
        if r.get("data_scope") in WEEKLY_DATA_SCOPES
        and r.get("week_label") == week_label
        and not r.get("segment_label")
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
        block = _build_block(grouped[label], label, week_label, subscription_mode=False)
        if block:
            blocks.append(block)
    return blocks


def _segment_blocks(week_label: str, *, lifecycle: bool) -> list[dict[str, Any]]:
    sub_mode = uses_subscription_metrics(week_label)
    blocks: list[dict[str, Any]] = []
    for label in SEGMENT_BLOCK_LABELS:
        records = _segment_records(week_label, label)
        if not records:
            continue
        materials = _aggregate_materials(records)
        if lifecycle:
            materials = _overlay_lifecycle_metrics(materials, _account_materials_index())
        block = _build_block(materials, label, week_label, subscription_mode=sub_mode)
        if block:
            blocks.append(block)
    return blocks


def get_weekly_test_blocks(
    week_label: str,
    *,
    lifecycle: bool = True,
) -> list[dict[str, Any]]:
    """从周度文件取本周素材，按规则拆分板块并覆盖账户成效。"""
    if uses_subscription_metrics(week_label):
        return _segment_blocks(week_label, lifecycle=lifecycle)
    return _legacy_blocks(week_label, lifecycle=lifecycle)
