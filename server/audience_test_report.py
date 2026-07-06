"""新方向·人群测试：按周配置目标人群文案，从周度数据拉取成效。"""
from __future__ import annotations

from typing import Any

from weekly_report import _aggregate_materials, _week_records

# week_label → 按展示顺序列出（material_id 大小写不敏感匹配）
AUDIENCE_TESTS: dict[str, list[dict[str, str]]] = {
    "0629周": [
        {
            "material_id": "20260701_GrowMe_EN_9x16_FX-SelfGrowth_ZT-lifelessons-old_RS-P1X1R3C3_wxx",
            "target_audience": "年龄焦虑/落后于时代的人",
        },
        {
            "material_id": "20260701_growme_EN_9x16_FX-Students_ZT-SelfImprovement_RS-P1X1R3C3_fj",
            "target_audience": "想多读书却总是读不完一本书的学生",
        },
        {
            "material_id": "20260701_GrowMe_EN_9x16_FX-Students_ZT-lifelessons-3min_RS-P1X1R3C3_wxx",
            "target_audience": "3分钟热度的人",
        },
    ],
}


def _material_lookup(materials: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {m["material_id"].lower(): m for m in materials}


def _row(material: dict[str, Any], target_audience: str) -> dict[str, Any]:
    hook = material.get("hook_rate") or 0
    retention = material.get("retention_rate") or 0
    return {
        "material_id": material["material_id"],
        "target_audience": target_audience,
        "direction": material.get("direction"),
        "theme": material.get("theme"),
        "designer": material.get("designer"),
        "spend": round(material.get("spend", 0), 2),
        "purchases": int(material.get("purchases", 0)),
        "subscriptions": int(material.get("subscriptions", 0)),
        "roas": round(material.get("roas", 0), 2),
        "ctr": round(material.get("ctr", 0), 2),
        "hook_rate": round(hook, 2) if hook else None,
        "retention_rate": round(retention, 2) if retention else None,
    }


def get_audience_test_for_week(week_label: str) -> dict[str, Any] | None:
    entries = AUDIENCE_TESTS.get(week_label)
    if not entries:
        return None

    materials = _aggregate_materials(_week_records(week_label))
    by_id = _material_lookup(materials)

    rows: list[dict[str, Any]] = []
    for entry in entries:
        material = by_id.get(entry["material_id"].lower())
        if not material:
            continue
        rows.append(_row(material, entry["target_audience"]))

    if not rows:
        return None

    return {
        "label": "人群测试",
        "week_label": week_label,
        "materials": rows,
        "note": "针对细分目标人群定向测试，目标人群文案为业务标注。",
    }
