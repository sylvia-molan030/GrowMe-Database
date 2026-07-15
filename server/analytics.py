"""基于 DataStore 记录做聚合查询。"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from data_loader import (
    get_recent_weekly_labels,
    get_recent_new_material_window,
    cohort_week_label_from_first_seen,
    get_weekly_labels,
    store,
)
from parser import DESIGNER_CANONICAL, canonical_direction, canonical_theme, primary_theme, _normalize_axis_value
from cross_rubric import cross_rubric_heatmap_from_materials


def _resolve_scope(mode: str = "account", scope: str | None = None) -> str:
    if scope in ("account", "weekly"):
        return scope
    return "weekly" if mode == "new" else "account"


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d")
    except ValueError:
        return None


def _in_range(first_seen: str | None, start: str | None, end: str | None) -> bool:
    d = _parse_date(first_seen)
    if d is None:
        return True
    if start:
        s = _parse_date(start)
        if s and d < s:
            return False
    if end:
        e = _parse_date(end)
        if e and d > e:
            return False
    return True


def _match_filters(record: dict[str, Any], filters: dict[str, str]) -> bool:
    for key in ("direction", "theme", "designer"):
        val = filters.get(key, "全部")
        if not val or val == "全部":
            continue
        rec_val = record.get(key)
        if key == "direction":
            if canonical_direction(rec_val or "") != canonical_direction(val):
                return False
        elif key == "theme":
            if primary_theme(rec_val or "") != primary_theme(val):
                return False
        elif rec_val != val:
            return False
    if not _in_range(record.get("first_seen"), filters.get("date_start"), filters.get("date_end")):
        return False
    return True


def _aggregate_by_material(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for r in records:
        mid = r["material_id"]
        if mid not in grouped:
            grouped[mid] = {**r}
            grouped[mid]["purchases"] = 0.0
            grouped[mid]["subscriptions"] = 0.0
            grouped[mid]["spend"] = 0.0
            grouped[mid]["impressions"] = 0.0
            grouped[mid]["installs"] = 0.0
            grouped[mid]["ctr_values"] = []
            grouped[mid]["roas_values"] = []
            grouped[mid]["roas_weights"] = []
            grouped[mid]["hook_weighted_sum"] = 0.0
            grouped[mid]["hook_weight"] = 0.0
            grouped[mid]["views_3s_sum"] = 0.0
            grouped[mid]["video_completions_sum"] = 0.0
        g = grouped[mid]
        g["purchases"] += r.get("purchases", 0)
        g["subscriptions"] += r.get("subscriptions", 0)
        g["spend"] += r.get("spend", 0)
        g["impressions"] += r.get("impressions", 0)
        g["installs"] += r.get("installs", 0)
        imp = r.get("impressions", 0) or 0
        hook = r.get("hook_rate", 0) or 0
        if hook > 0 and imp > 0:
            g["hook_weighted_sum"] += hook * imp
            g["hook_weight"] += imp
            g["views_3s_sum"] += imp * hook / 100
        g["video_completions_sum"] += r.get("video_completions", 0) or 0
        if r.get("ctr"):
            g["ctr_values"].append(r["ctr"])
        if r.get("roas"):
            g["roas_values"].append(r["roas"])
            g["roas_weights"].append(r.get("spend", 0) or 1.0)
        g["has_order"] = g["purchases"] >= 1

    result = []
    for g in grouped.values():
        ctr_vals = g.pop("ctr_values", [])
        roas_vals = g.pop("roas_values", [])
        roas_w = g.pop("roas_weights", [])
        g["ctr"] = sum(ctr_vals) / len(ctr_vals) if ctr_vals else 0
        if roas_vals and sum(roas_w) > 0:
            g["roas"] = sum(r * w for r, w in zip(roas_vals, roas_w)) / sum(roas_w)
        else:
            g["roas"] = sum(roas_vals) / len(roas_vals) if roas_vals else 0
        g["channel"] = "ALL"
        g["hook_rate"] = round(g["hook_weighted_sum"] / g["hook_weight"], 2) if g.get("hook_weight") else 0
        views_3s = g.get("views_3s_sum") or 0
        comps = g.get("video_completions_sum") or 0
        g["retention_rate"] = round(comps / views_3s * 100, 2) if views_3s > 0 else 0
        for k in ("hook_weighted_sum", "hook_weight", "views_3s_sum", "video_completions_sum"):
            g.pop(k, None)
        g["direction"] = canonical_direction(g.get("direction") or "未知")
        g["theme"] = canonical_theme(g.get("theme") or "未知")
        g["scaling_status"] = _scaling_status(g["spend"], g["purchases"])
        result.append(g)
    return result


def _scaling_status(spend: float, purchases: float) -> str:
    if purchases >= 5 and spend >= 50:
        return "增长期"
    if purchases < 1 and spend >= 30:
        return "炮灰"
    return "衰退期"


def filter_records(
    filters: dict[str, str],
    mode: str = "account",
    scope: str | None = None,
    weekly_only: bool = False,
) -> list[dict[str, Any]]:
    target_scope = _resolve_scope(mode, scope)
    if target_scope == "weekly" or weekly_only:
        # 上新素材成效：账户全量成效 + 素材名前缀日期落在最近 2 自然周
        _, start, end = get_recent_new_material_window()
        records: list[dict[str, Any]] = []
        for r in store.records:
            if r.get("data_scope") != "account":
                continue
            fs = r.get("first_seen")
            if not fs or not start or not end:
                continue
            day = str(fs)[:10]
            if day < start or day > end:
                continue
            lab = cohort_week_label_from_first_seen(fs) or r.get("week_label")
            records.append({**r, "week_label": lab})
    else:
        records = [r for r in store.records if r.get("data_scope") == target_scope]
    return [r for r in records if _match_filters(r, filters)]


def get_filter_options(scope: str = "account") -> dict[str, list[str]]:
    if scope == "weekly":
        _, start, end = get_recent_new_material_window()
        records = []
        for r in store.records:
            if r.get("data_scope") != "account" or not r.get("first_seen"):
                continue
            day = str(r["first_seen"])[:10]
            if start and end and start <= day <= end:
                records.append(r)
    else:
        records = [r for r in store.records if r.get("data_scope") == scope]

    directions: set[str] = set()
    themes: set[str] = set()
    designers: set[str] = set()
    for r in records:
        d = r.get("direction")
        if d and d != "未知":
            directions.add(canonical_direction(d))
        t = r.get("theme")
        if t and t != "未知":
            themes.add(primary_theme(t))
        des = r.get("designer")
        if des:
            designers.add(des)

    designer_order = {name: i for i, name in enumerate([*DESIGNER_CANONICAL, "其他"])}
    return {
        "direction": ["全部", *sorted(directions, key=lambda v: v.lower())],
        "theme": ["全部", *sorted(themes, key=lambda v: v.lower())],
        "designer": ["全部", *sorted(designers, key=lambda v: (designer_order.get(v, 99), v))],
    }


def get_summary(filters: dict[str, str], mode: str = "account") -> dict[str, Any]:
    records = filter_records(filters, mode=mode)
    materials = _aggregate_by_material(records)

    total = len(materials)
    ordered = [m for m in materials if m["purchases"] >= 1]
    total_orders = sum(m["purchases"] for m in materials)
    ge2 = [m for m in materials if m["purchases"] >= 2]
    ge5 = [m for m in materials if m["purchases"] >= 5]

    order_rate = (len(ordered) / total * 100) if total else 0
    ge2_rate = (len(ge2) / total * 100) if total else 0
    ge5_rate = (len(ge5) / total * 100) if total else 0

    avg_roas_vals = [m["roas"] for m in materials if m["roas"] > 0]
    avg_ctr_vals = [m["ctr"] for m in materials if m["ctr"] > 0]
    avg_spend_vals = [m["spend"] for m in materials if m["spend"] > 0]

    return {
        "total_materials": total,
        "ordered_materials": len(ordered),
        "total_orders": int(total_orders),
        "order_rate": round(order_rate, 2),
        "ge2_count": len(ge2),
        "ge2_rate": round(ge2_rate, 2),
        "ge5_count": len(ge5),
        "ge5_rate": round(ge5_rate, 2),
        "avg_roas": round(sum(avg_roas_vals) / len(avg_roas_vals), 2) if avg_roas_vals else 0,
        "avg_ctr": round(sum(avg_ctr_vals) / len(avg_ctr_vals), 2) if avg_ctr_vals else 0,
        "avg_spend": round(sum(avg_spend_vals) / len(avg_spend_vals), 2) if avg_spend_vals else 0,
        "total_spend": round(sum(m["spend"] for m in materials), 2),
        "avg_cpa": round(sum(m["spend"] for m in materials) / len(ordered), 2) if ordered else 0,
    }


def get_data_date_range(scope: str = "account") -> tuple[str | None, str | None]:
    """基于素材名前缀日期（first_seen），而非报告文件日期。"""
    if scope == "weekly":
        _, start, end = get_recent_new_material_window()
        if start and end:
            return start, end
        dates = sorted(
            {
                r.get("first_seen")
                for r in store.records
                if r.get("first_seen") and r.get("data_scope") == "account"
            }
        )
    else:
        dates = sorted(
            {
                r.get("first_seen")
                for r in store.records
                if r.get("first_seen") and r.get("data_scope") == scope
            }
        )
    if not dates:
        return None, None
    return dates[0], dates[-1]


def default_date_range(scope: str = "account") -> tuple[str, str]:
    data_min, data_max = get_data_date_range(scope)
    if not data_max:
        today = datetime.now().date()
        start = today - timedelta(days=6)
        return start.isoformat(), today.isoformat()

    end = _parse_date(data_max)
    if not end:
        return data_min or "", data_max or ""

    start = end.date() - timedelta(days=6)
    data_start = _parse_date(data_min)
    if data_start and start < data_start.date():
        start = data_start.date()
    return start.isoformat(), end.date().isoformat()


def get_survival_trend(filters: dict[str, str], mode: str = "account") -> dict[str, Any]:
    """按素材名前缀日期（first_seen）统计每日上新数与成活数，不使用报告起止日期。"""
    records = filter_records(filters, mode=mode)
    materials = _aggregate_by_material(records)

    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in materials:
        day = m.get("first_seen")
        if not day:
            continue
        by_day[day].append(m)

    days = sorted(by_day)
    counts = []
    survived_counts = []
    for d in days:
        items = by_day[d]
        counts.append(len(items))
        survived_counts.append(sum(1 for i in items if i["purchases"] >= 1))

    return {"dates": days, "counts": counts, "survived_counts": survived_counts}


def get_heatmap(
    filters: dict[str, str],
    y_axis: str = "direction",
    x_axis: str = "theme",
) -> dict[str, Any]:
    records = filter_records(filters)
    materials = _aggregate_by_material(records)

    y_vals = sorted({_normalize_axis_value(y_axis, m.get(y_axis)) for m in materials})
    x_vals = sorted({_normalize_axis_value(x_axis, m.get(x_axis)) for m in materials})

    cells: list[dict[str, Any]] = []
    for y in y_vals:
        for x in x_vals:
            subset = [
                m for m in materials
                if _normalize_axis_value(y_axis, m.get(y_axis)) == y
                and _normalize_axis_value(x_axis, m.get(x_axis)) == x
            ]
            if not subset:
                continue
            ordered = sum(1 for m in subset if m["purchases"] >= 1)
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

    return {"y_axis": y_axis, "x_axis": x_axis, "y_values": y_vals, "x_values": x_vals, "cells": cells}


def get_cross_rubric_heatmap(filters: dict[str, str], mode: str = "account") -> dict[str, Any] | None:
    records = filter_records(filters, mode=mode)
    materials = _aggregate_by_material(records)
    return cross_rubric_heatmap_from_materials(materials)


def get_materials(
    filters: dict[str, str],
    y_axis: str | None = None,
    y_value: str | None = None,
    x_axis: str | None = None,
    x_value: str | None = None,
    keyword: str = "",
    min_orders: int = 0,
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "purchases",
    sort_dir: str = "desc",
    mode: str = "account",
    scope: str | None = None,
    weekly_only: bool = False,
) -> dict[str, Any]:
    records = filter_records(filters, mode=mode, scope=scope, weekly_only=weekly_only)
    materials = _aggregate_by_material(records)

    if y_axis and y_value:
        materials = [
            m for m in materials
            if _normalize_axis_value(y_axis, m.get(y_axis)) == _normalize_axis_value(y_axis, y_value)
        ]
    if x_axis and x_value:
        materials = [
            m for m in materials
            if _normalize_axis_value(x_axis, m.get(x_axis)) == _normalize_axis_value(x_axis, x_value)
        ]
    if min_orders > 0:
        materials = [m for m in materials if m["purchases"] >= min_orders]
    if keyword:
        kw = keyword.lower()
        materials = [m for m in materials if kw in m["material_id"].lower()]

    reverse = sort_dir != "asc"

    def _sort_key(m: dict[str, Any]) -> Any:
        val = m.get(sort_by)
        if sort_by in {"purchases", "spend", "roas", "ctr", "impressions"}:
            return float(val or 0)
        if sort_by == "first_seen":
            return val or ""
        return val or ""

    materials.sort(key=_sort_key, reverse=reverse)

    total = len(materials)
    start = (page - 1) * page_size
    page_items = materials[start : start + page_size]

    rows = []
    for idx, m in enumerate(page_items, start=start + 1):
        rows.append(
            {
                "rank": idx,
                "material_id": m["material_id"],
                "standard_id": m.get("standard_id"),
                "first_seen": m.get("first_seen"),
                "designer": m.get("designer"),
                "designer_variant": m.get("designer_variant"),
                "serial_code": m.get("serial_code"),
                "direction": canonical_direction(m.get("direction") or "未知"),
                "theme": canonical_theme(m.get("theme") or "未知"),
                "optimization": m.get("optimization"),
                "purchases": int(m["purchases"]),
                "roas": round(m["roas"], 2),
                "ctr": round(m["ctr"], 2),
                "spend": round(m["spend"], 2),
                "scaling_status": m.get("scaling_status"),
                "hook_rate": round(m.get("hook_rate") or 0, 2),
                "retention_rate": round(m.get("retention_rate") or 0, 2),
            }
        )

    return {"total": total, "page": page, "page_size": page_size, "rows": rows}


def get_designer_stats(filters: dict[str, str], mode: str = "account") -> list[dict[str, Any]]:
    records = filter_records(filters, mode=mode)
    materials = _aggregate_by_material(records)
    by_designer: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in materials:
        by_designer[m.get("designer", "未知")].append(m)

    stats = []
    for designer, items in by_designer.items():
        ordered = [i for i in items if i["purchases"] >= 1]
        stats.append(
            {
                "designer": designer,
                "total_materials": len(items),
                "ordered_materials": len(ordered),
                "total_orders": int(sum(i["purchases"] for i in items)),
                "order_rate": round(len(ordered) / len(items) * 100, 1) if items else 0,
                "avg_roas": round(
                    sum(i["roas"] for i in items if i["roas"] > 0)
                    / max(1, len([i for i in items if i["roas"] > 0])),
                    2,
                ),
                "total_spend": round(sum(i["spend"] for i in items), 2),
            }
        )
    order = {d: i for i, d in enumerate([*DESIGNER_CANONICAL, "其他"])}
    stats.sort(key=lambda s: (order.get(s["designer"], 99), -s["total_orders"]))
    return stats


