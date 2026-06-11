"""周维度上新复盘：按 week_label × channel 聚合 KPI、对照与洞察。"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from data_loader import store, week_sort_key


def sorted_week_labels() -> list[str]:
    labels = {
        r.get("week_label", "")
        for r in store.records
        if r.get("data_scope") == "weekly" and r.get("week_label")
    }
    return sorted(labels, key=week_sort_key)


def _prev_week_label(week: str) -> str | None:
    labels = sorted_week_labels()
    if week not in labels:
        return None
    idx = labels.index(week)
    return labels[idx - 1] if idx > 0 else None


def _week_records(week_label: str, channel: str | None = None) -> list[dict[str, Any]]:
    rows = [
        r
        for r in store.records
        if r.get("data_scope") == "weekly" and r.get("week_label") == week_label
    ]
    if channel:
        rows = [r for r in rows if r.get("channel") == channel]
    return rows


def _aggregate_materials(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
            grouped[mid]["hook_values"] = []
            grouped[mid]["retention_values"] = []
            grouped[mid]["hook_weights"] = []
            grouped[mid]["retention_weights"] = []
        g = grouped[mid]
        g["purchases"] += r.get("purchases", 0)
        g["subscriptions"] += r.get("subscriptions", 0)
        g["spend"] += r.get("spend", 0)
        g["impressions"] += r.get("impressions", 0)
        g["installs"] += r.get("installs", 0)
        if r.get("ctr"):
            g["ctr_values"].append(r["ctr"])
        if r.get("roas"):
            g["roas_values"].append(r["roas"])
        weight = r.get("impressions", 0) or 1.0
        if r.get("hook_rate"):
            g["hook_values"].append(r["hook_rate"])
            g["hook_weights"].append(weight)
        if r.get("retention_rate"):
            g["retention_values"].append(r["retention_rate"])
            g["retention_weights"].append(weight)

    result: list[dict[str, Any]] = []
    for g in grouped.values():
        ctr_vals = g.pop("ctr_values", [])
        roas_vals = g.pop("roas_values", [])
        hook_vals = g.pop("hook_values", [])
        hook_w = g.pop("hook_weights", [])
        ret_vals = g.pop("retention_values", [])
        ret_w = g.pop("retention_weights", [])
        g["ctr"] = sum(ctr_vals) / len(ctr_vals) if ctr_vals else 0
        g["roas"] = sum(roas_vals) / len(roas_vals) if roas_vals else 0
        g["hook_rate"] = _weighted_avg(hook_vals, hook_w)
        g["retention_rate"] = _weighted_avg(ret_vals, ret_w)
        g["effective"] = g["purchases"] >= 1 or g["subscriptions"] >= 1
        g["has_order"] = g["purchases"] >= 1
        result.append(g)
    return result


def _weighted_avg(values: list[float], weights: list[float]) -> float:
    if not values:
        return 0.0
    if not weights or sum(weights) == 0:
        return sum(values) / len(values)
    total_w = sum(weights)
    return sum(v * w for v, w in zip(values, weights)) / total_w


def _channel_kpi(materials: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(materials)
    effective = [m for m in materials if m.get("effective")]
    ordered = [m for m in materials if m["purchases"] >= 1]
    ge2 = [m for m in materials if m["purchases"] >= 2]
    ge5 = [m for m in materials if m["purchases"] >= 5]
    spend = sum(m["spend"] for m in materials)
    purchases = sum(m["purchases"] for m in materials)
    subscriptions = sum(m.get("subscriptions", 0) for m in materials)
    impressions = sum(m["impressions"] for m in materials)
    installs = sum(m["installs"] for m in materials)
    empty_spend = sum(m["spend"] for m in materials if m["purchases"] < 1 and m.get("subscriptions", 0) < 1)
    roas_vals = [(m["roas"], m["spend"]) for m in materials if m["roas"] > 0 and m["spend"] > 0]
    roas = sum(r * s for r, s in roas_vals) / sum(s for _, s in roas_vals) if roas_vals else 0

    return {
        "spend": round(spend, 2),
        "effective_materials": len(effective),
        "conversions": int(purchases),
        "subscriptions": int(subscriptions),
        "order_rate": round(len(ordered) / total * 100, 2) if total else 0,
        "effective_rate": round(len(effective) / total * 100, 2) if total else 0,
        "ge2_rate": round(len(ge2) / total * 100, 2) if total else 0,
        "ge5_rate": round(len(ge5) / total * 100, 2) if total else 0,
        "empty_spend": round(empty_spend, 2),
        "cpi": round(spend / installs, 2) if installs > 0 else None,
        "cpm": round(spend / impressions * 1000, 2) if impressions > 0 else None,
        "roas": round(roas, 2),
        "total_materials": total,
    }


def _wow_delta(current: float | int | None, previous: float | int | None) -> dict[str, Any] | None:
    if current is None or previous is None:
        return None
    cur = float(current)
    prev = float(previous)
    delta = round(cur - prev, 2)
    if prev == 0:
        pct = None
    else:
        pct = round((cur - prev) / abs(prev) * 100, 1)
    return {"delta": delta, "pct": pct, "direction": "up" if delta > 0 else "down" if delta < 0 else "flat"}


def _core_metrics(materials: list[dict[str, Any]]) -> dict[str, Any]:
    kpi = _channel_kpi(materials)
    return {
        "effective_rate": kpi["effective_rate"],
        "empty_spend": kpi["empty_spend"],
        "cpi": kpi["cpi"],
        "cpm": kpi["cpm"],
        "subscriptions": kpi["subscriptions"],
        "purchases": kpi["conversions"],
        "roas": kpi["roas"],
    }


def _comparison_table(current: dict[str, Any], previous: dict[str, Any] | None) -> list[dict[str, Any]]:
    labels = {
        "effective_rate": ("有效率", "%"),
        "empty_spend": ("空消耗", "$"),
        "cpi": ("CPI", "$"),
        "cpm": ("CPM", "$"),
        "subscriptions": ("订阅数", ""),
        "purchases": ("购物数", ""),
        "roas": ("ROAS", ""),
    }
    rows = []
    for key, (label, unit) in labels.items():
        cur = current.get(key)
        prev = previous.get(key) if previous else None
        row: dict[str, Any] = {
            "key": key,
            "label": label,
            "unit": unit,
            "current": cur,
            "previous": prev,
            "wow": _wow_delta(cur, prev),
        }
        rows.append(row)
    return rows


def _direction_table(materials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_dir: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in materials:
        by_dir[m.get("direction") or "未知"].append(m)

    rows = []
    for direction, items in sorted(by_dir.items(), key=lambda x: -sum(i["purchases"] for i in x[1])):
        spend = sum(i["spend"] for i in items)
        impressions = sum(i["impressions"] for i in items)
        installs = sum(i["installs"] for i in items)
        purchases = sum(i["purchases"] for i in items)
        subscriptions = sum(i.get("subscriptions", 0) for i in items)
        effective = sum(1 for i in items if i.get("effective"))
        ctr_vals = [i["ctr"] for i in items if i["ctr"] > 0]
        roas_vals = [(i["roas"], i["spend"]) for i in items if i["roas"] > 0 and i["spend"] > 0]
        hook_vals = [(i["hook_rate"], i["impressions"] or 1) for i in items if i.get("hook_rate")]
        ret_vals = [(i["retention_rate"], i["impressions"] or 1) for i in items if i.get("retention_rate")]

        rows.append(
            {
                "direction": direction,
                "ctr": round(sum(ctr_vals) / len(ctr_vals), 2) if ctr_vals else 0,
                "cpi": round(spend / installs, 2) if installs > 0 else None,
                "roas": round(sum(r * s for r, s in roas_vals) / sum(s for _, s in roas_vals), 2) if roas_vals else 0,
                "effective_materials": effective,
                "subscriptions": int(subscriptions),
                "purchases": int(purchases),
                "hook_rate": round(_weighted_avg([v for v, _ in hook_vals], [w for _, w in hook_vals]), 2),
                "retention_rate": round(_weighted_avg([v for v, _ in ret_vals], [w for _, w in ret_vals]), 2),
                "spend": round(spend, 2),
                "cpm": round(spend / impressions * 1000, 2) if impressions > 0 else None,
            }
        )
    return rows


def _survival_trend(materials: list[dict[str, Any]]) -> dict[str, Any]:
    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in materials:
        day = m.get("first_seen")
        if day:
            by_day[day].append(m)
    dates = sorted(by_day)
    return {
        "dates": dates,
        "counts": [len(by_day[d]) for d in dates],
        "survived_counts": [sum(1 for i in by_day[d] if i["purchases"] >= 1) for d in dates],
    }


def _good_materials(materials: list[dict[str, Any]], limit: int = 12) -> list[dict[str, Any]]:
    items = [m for m in materials if m["purchases"] >= 1 and m.get("subscriptions", 0) >= 1]
    items.sort(key=lambda m: (m["purchases"], m.get("subscriptions", 0)), reverse=True)
    return [
        {
            "material_id": m["material_id"],
            "direction": m.get("direction"),
            "theme": m.get("theme"),
            "designer": m.get("designer"),
            "purchases": int(m["purchases"]),
            "subscriptions": int(m.get("subscriptions", 0)),
            "roas": round(m["roas"], 2),
            "ctr": round(m["ctr"], 2),
            "spend": round(m["spend"], 2),
        }
        for m in items[:limit]
    ]


def _generate_insights(
    week: str,
    prev_week: str | None,
    combined_kpi: dict[str, Any],
    prev_combined: dict[str, Any] | None,
    ww: dict[str, Any],
    t1: dict[str, Any],
    directions: list[dict[str, Any]],
    good_count: int,
) -> list[str]:
    insights: list[str] = []

    if prev_week and prev_combined:
        rate_delta = combined_kpi["order_rate"] - prev_combined["order_rate"]
        if rate_delta > 0:
            insights.append(
                f"{week} 素材出单率 {combined_kpi['order_rate']}%（较 {prev_week} ↑{rate_delta:.1f}pp），"
                f"共 {combined_kpi['total_materials']} 条上新素材。"
            )
        elif rate_delta < 0:
            insights.append(
                f"{week} 素材出单率 {combined_kpi['order_rate']}%（较 {prev_week} ↓{abs(rate_delta):.1f}pp），"
                f"需关注低效方向与空消耗。"
            )
        else:
            insights.append(f"{week} 共上新 {combined_kpi['total_materials']} 条素材，出单率与 {prev_week} 持平。")

        empty_delta = combined_kpi["empty_spend"] - prev_combined["empty_spend"]
        if empty_delta > 50:
            insights.append(
                f"空消耗较上周增加 ${empty_delta:.0f}（本周 ${combined_kpi['empty_spend']:.0f}），"
                f"建议复盘 0 转化素材。"
            )
        elif empty_delta < -20:
            insights.append(f"空消耗较上周减少 ${abs(empty_delta):.0f}，投放效率有所改善。")
    else:
        insights.append(f"{week} 共上新 {combined_kpi['total_materials']} 条素材，出单率 {combined_kpi['order_rate']}%。")

    if directions:
        top = max(directions, key=lambda d: d["purchases"])
        insights.append(
            f"方向「{top['direction']}」表现最佳：购物 {top['purchases']} 单、"
            f"有效素材 {top['effective_materials']} 条、ROAS {top['roas']}。"
        )

    if ww["total_materials"] and t1["total_materials"]:
        insights.append(
            f"渠道对比：WW 消耗 ${ww['spend']:.0f} / 出单率 {ww['order_rate']}%；"
            f"T1 消耗 ${t1['spend']:.0f} / 出单率 {t1['order_rate']}%。"
        )
    elif good_count:
        insights.append(f"本周有 {good_count} 条「购物+订阅」双转化好素材，可作为下轮放量参考。")
    else:
        insights.append("本周暂无购物且订阅双达标素材，建议优先优化钩子与落地页。")

    return insights[:3]


def get_weekly_report(week_label: str | None = None) -> dict[str, Any]:
    labels = sorted_week_labels()
    if not labels:
        return {"weeks": [], "report": None}

    week = week_label or labels[-1]
    if week not in labels:
        week = labels[-1]

    prev = _prev_week_label(week)

    all_materials = _aggregate_materials(_week_records(week))
    ww_materials = _aggregate_materials(_week_records(week, "WW"))
    t1_materials = _aggregate_materials(_week_records(week, "T1"))

    ww_kpi = _channel_kpi(ww_materials)
    t1_kpi = _channel_kpi(t1_materials)
    combined_kpi = _channel_kpi(all_materials)

    prev_combined = None
    prev_metrics = None
    if prev:
        prev_all = _aggregate_materials(_week_records(prev))
        prev_combined = _channel_kpi(prev_all)
        prev_metrics = _core_metrics(prev_all)

    current_metrics = _core_metrics(all_materials)
    directions = _direction_table(all_materials)
    good = _good_materials(all_materials)

    wow: dict[str, Any] = {}
    if prev_combined:
        for key in (
            "total_materials",
            "order_rate",
            "ge2_rate",
            "ge5_rate",
            "spend",
            "effective_materials",
            "conversions",
            "subscriptions",
        ):
            wow[key] = _wow_delta(combined_kpi.get(key), prev_combined.get(key))
        prev_ww = _channel_kpi(_aggregate_materials(_week_records(prev, "WW")))
        prev_t1 = _channel_kpi(_aggregate_materials(_week_records(prev, "T1")))
        wow["ww_spend"] = _wow_delta(ww_kpi["spend"], prev_ww["spend"])
        wow["ww_order_rate"] = _wow_delta(ww_kpi["order_rate"], prev_ww["order_rate"])
        wow["t1_spend"] = _wow_delta(t1_kpi["spend"], prev_t1["spend"])
        wow["t1_order_rate"] = _wow_delta(t1_kpi["order_rate"], prev_t1["order_rate"])

    report = {
        "week": week,
        "prev_week": prev,
        "weeks": labels,
        "kpi": {
            "total_materials": combined_kpi["total_materials"],
            "order_rate": combined_kpi["order_rate"],
            "ge2_rate": combined_kpi["ge2_rate"],
            "ge5_rate": combined_kpi["ge5_rate"],
            "ww": ww_kpi,
            "t1": t1_kpi,
            "wow": wow,
        },
        "core_comparison": _comparison_table(current_metrics, prev_metrics),
        "good_materials": good,
        "direction_table": directions,
        "survival_trend": _survival_trend(all_materials),
        "insights": _generate_insights(
            week, prev, combined_kpi, prev_combined, ww_kpi, t1_kpi, directions, len(good)
        ),
    }
    return {"weeks": labels, "report": report}


def build_all_reports() -> dict[str, Any]:
    labels = sorted_week_labels()
    return {label: get_weekly_report(label)["report"] for label in labels}
