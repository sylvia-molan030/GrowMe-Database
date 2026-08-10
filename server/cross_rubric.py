"""交叉魔方：0629 起 FX 用户人群 × ZT 主题出单率热力图。"""
from __future__ import annotations

from typing import Any

from parser import AUDIENCE_DIRECTIONS, canonical_audience, canonical_direction, primary_theme, uses_new_schema


def _direction_label(direction: str) -> str | None:
    raw = (direction or "").strip()
    if not raw or raw == "未知":
        return None
    mapped = canonical_audience(canonical_direction(raw))
    return mapped if mapped in AUDIENCE_DIRECTIONS else None


def cross_rubric_heatmap_from_materials(
    materials: list[dict[str, Any]],
    *,
    subscription_mode: bool = False,
) -> dict[str, Any] | None:
    """仅统计 0629 新命名规则素材（first_seen ≥ 2026-06-29）。"""
    items = []
    for m in materials:
        if not uses_new_schema(first_seen=m.get("first_seen")):
            continue
        y = _direction_label(m.get("direction") or "")
        x = primary_theme(m.get("theme") or "")
        if y and x != "未知":
            items.append({**m, "_fx": y, "_zt": x})
    if not items:
        return None

    audience_order = {name: i for i, name in enumerate(AUDIENCE_DIRECTIONS)}
    y_vals = sorted({m["_fx"] for m in items}, key=lambda v: audience_order.get(v, 99))
    x_vals = sorted({m["_zt"] for m in items})

    cells: list[dict[str, Any]] = []
    for y in y_vals:
        for x in x_vals:
            subset = [m for m in items if m["_fx"] == y and m["_zt"] == x]
            if not subset:
                continue
            if subscription_mode:
                ordered = sum(1 for m in subset if m.get("subscriptions", 0) >= 1)
            else:
                ordered = sum(1 for m in subset if m.get("purchases", 0) >= 1)
            rate = round(ordered / len(subset) * 100, 2)
            cells.append(
                {
                    "y": y,
                    "x": x,
                    "rate": rate,
                    "ordered": ordered,
                    "total": len(subset),
                    "label": f"{rate}%",
                    "fraction": f"{ordered}/{len(subset)}",
                }
            )

    if not cells:
        return None

    return {
        "y_axis": "direction",
        "x_axis": "theme",
        "y_label": "方向 (FX-)",
        "x_label": "主题 (ZT-)",
        "y_values": y_vals,
        "x_values": x_vals,
        "cells": cells,
        "metric_mode": "subscription" if subscription_mode else "purchase",
    }
