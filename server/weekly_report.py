"""周维度上新复盘：按 week_label × channel 聚合 KPI、对照与洞察。"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from data_loader import store, week_sort_key, WEEKLY_DATA_SCOPES

EFFECTIVE_SPEND_MIN = 200  # 有效素材：消耗 > $200 且有购物


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
        if r.get("data_scope") in WEEKLY_DATA_SCOPES and r.get("week_label") == week_label
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
        g["effective"] = g["spend"] > EFFECTIVE_SPEND_MIN and g["purchases"] >= 1
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
        "spend": kpi["spend"],
        "empty_spend": kpi["empty_spend"],
        "effective_rate": kpi["effective_rate"],
        "cpi": kpi["cpi"],
        "cpm": kpi["cpm"],
        "subscriptions": kpi["subscriptions"],
        "purchases": kpi["conversions"],
        "roas": kpi["roas"],
    }


def _comparison_table(current: dict[str, Any], previous: dict[str, Any] | None) -> list[dict[str, Any]]:
    labels = {
        "spend": ("总消耗", "$"),
        "empty_spend": ("空消耗", "$"),
        "effective_rate": ("有效率", "%"),
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

        total = len(items)
        rows.append(
            {
                "direction": direction,
                "total_materials": total,
                "effective_materials": effective,
                "effective_ratio": f"{effective}/{total}",
                "ctr": round(sum(ctr_vals) / len(ctr_vals), 2) if ctr_vals else 0,
                "cpi": round(spend / installs, 2) if installs > 0 else None,
                "roas": round(sum(r * s for r, s in roas_vals) / sum(s for _, s in roas_vals), 2) if roas_vals else 0,
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


def _short_id(material_id: str, limit: int = 52) -> str:
    mid = material_id or ""
    return mid if len(mid) <= limit else f"{mid[:limit]}…"


def _material_blurb(m: dict[str, Any]) -> str:
    parts = [f"购物 {int(m.get('purchases', 0))}"]
    subs = int(m.get("subscriptions", 0))
    if subs:
        parts.append(f"订阅 {subs}")
    if m.get("roas"):
        parts.append(f"ROAS {round(m['roas'], 2)}")
    if m.get("ctr"):
        parts.append(f"CTR {round(m['ctr'], 2)}%")
    if m.get("spend"):
        parts.append(f"花费 ${round(m['spend'], 0)}")
    return " · ".join(parts)


def _generate_insights(
    week: str,
    prev_week: str | None,
    materials: list[dict[str, Any]],
    combined_kpi: dict[str, Any],
    prev_combined: dict[str, Any] | None,
    directions: list[dict[str, Any]],
) -> list[str]:
    insights: list[str] = []
    total = combined_kpi["total_materials"]
    order_rate = combined_kpi["order_rate"]
    effective_rate = combined_kpi["effective_rate"]

    if prev_week and prev_combined:
        rate_delta = order_rate - prev_combined["order_rate"]
        eff_delta = effective_rate - prev_combined["effective_rate"]
        arrow = f"↑{rate_delta:.1f}" if rate_delta > 0 else f"↓{abs(rate_delta):.1f}" if rate_delta < 0 else "持平"
        eff_arrow = f"↑{eff_delta:.1f}" if eff_delta > 0 else f"↓{abs(eff_delta):.1f}" if eff_delta < 0 else "持平"
        insights.append(
            f"【素材测出率】{week} 上新 {total} 条，出单率 {order_rate}%（较 {prev_week} {arrow}pp），"
            f"有效率 {effective_rate}%（较上周 {eff_arrow}pp）。"
            f"上周出单率 {prev_combined['order_rate']}%，有效率 {prev_combined['effective_rate']}%。"
        )
    else:
        insights.append(
            f"【素材测出率】{week} 上新 {total} 条，出单率 {order_rate}%，有效率 {effective_rate}%。"
        )

    ordered = [m for m in materials if m.get("purchases", 0) >= 1]
    if ordered:
        best = max(ordered, key=lambda m: (m.get("purchases", 0), m.get("subscriptions", 0), m.get("roas", 0)))
        insights.append(
            f"【本周最强素材】{_short_id(best['material_id'])}（{best.get('direction', '-')} / {best.get('designer', '-')}）："
            f"{_material_blurb(best)}。"
        )
    else:
        insights.append("【本周最强素材】本周暂无出单素材，建议优先排查钩子与定向。")

    signal_pool = [m for m in materials if m.get("purchases", 0) >= 1 and m.get("subscriptions", 0) >= 1]
    if signal_pool:
        signal = max(signal_pool, key=lambda m: (m.get("purchases", 0) + m.get("subscriptions", 0), m.get("roas", 0)))
        insights.append(
            f"【高转化信号素材】{_short_id(signal['material_id'])}（购物+订阅双达标）："
            f"{_material_blurb(signal)}，具备放量验证价值。"
        )
    elif ordered:
        alt = max(ordered, key=lambda m: (m.get("roas", 0), m.get("purchases", 0)))
        insights.append(
            f"【高转化信号素材】暂无购物+订阅双达标；ROAS 最高出单素材为 {_short_id(alt['material_id'])}："
            f"{_material_blurb(alt)}。"
        )
    else:
        insights.append("【高转化信号素材】本周暂无出单，建议从钩子与落地页组合继续迭代。")

    hook_pool = [m for m in materials if m.get("hook_rate", 0) > 0 and m.get("spend", 0) > 0]
    if hook_pool:
        hook_best = max(hook_pool, key=lambda m: (m.get("hook_rate", 0), m.get("impressions", 0)))
        insights.append(
            f"【钩子最优素材】{_short_id(hook_best['material_id'])}："
            f"3秒播放率 {round(hook_best['hook_rate'], 2)}%，{_material_blurb(hook_best)}。"
        )
    else:
        insights.append("【钩子最优素材】本周缺少钩子率数据，建议补充含视频播放指标的导出。")

    ret_pool = [m for m in materials if m.get("retention_rate", 0) > 0 and m.get("spend", 0) > 0]
    if ret_pool:
        ret_best = max(ret_pool, key=lambda m: (m.get("retention_rate", 0), m.get("impressions", 0)))
        insights.append(
            f"【留存率最高素材】{_short_id(ret_best['material_id'])}："
            f"完播留存率 {round(ret_best['retention_rate'], 2)}%，{_material_blurb(ret_best)}。"
        )
    else:
        insights.append("【留存率最高素材】本周缺少完播/留存数据，暂无法评选。")

    if directions:
        top = max(directions, key=lambda d: d["purchases"])
        insights.append(
            f"【方向表现】「{top['direction']}」购物 {top['purchases']} 单领先，"
            f"有效素材 {top['effective_ratio']}，ROAS {top['roas']}；"
            f"共 {top['total_materials']} 条素材参与本周 WW 测试。"
        )

    return insights


def get_weekly_report(week_label: str | None = None) -> dict[str, Any]:
    labels = sorted_week_labels()
    if not labels:
        return {"weeks": [], "report": None}

    week = week_label or labels[-1]
    if week not in labels:
        week = labels[-1]

    prev = _prev_week_label(week)

    all_materials = _aggregate_materials(_week_records(week))
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

    report = {
        "week": week,
        "prev_week": prev,
        "weeks": labels,
        "effective_rule": f"消耗 > ${EFFECTIVE_SPEND_MIN} 且有购物",
        "kpi": {
            "total_materials": combined_kpi["total_materials"],
            "order_rate": combined_kpi["order_rate"],
            "ge2_rate": combined_kpi["ge2_rate"],
            "ge5_rate": combined_kpi["ge5_rate"],
            "spend": combined_kpi["spend"],
            "effective_materials": combined_kpi["effective_materials"],
            "conversions": combined_kpi["conversions"],
            "subscriptions": combined_kpi["subscriptions"],
            "effective_rate": combined_kpi["effective_rate"],
            "avg_roas": combined_kpi["roas"],
            "wow": wow,
        },
        "core_comparison": _comparison_table(current_metrics, prev_metrics),
        "good_materials": good,
        "direction_table": directions,
        "survival_trend": _survival_trend(all_materials),
        "insights": _generate_insights(
            week, prev, all_materials, combined_kpi, prev_combined, directions
        ),
    }
    new_dir = None
    try:
        from new_direction_report import get_new_direction_for_week
        new_dir = get_new_direction_for_week(week)
    except ImportError:
        pass
    if new_dir:
        report["new_direction_test"] = new_dir
        report["insights"].insert(
            0,
            f"【新方向测试·{new_dir['label']}】{new_dir['note']} "
            f"共 {new_dir['summary']['total_materials']} 条，消耗 ${new_dir['summary']['spend']}，"
            f"购物 {new_dir['summary']['purchases']} / 订阅 {new_dir['summary']['subscriptions']}。",
        )
    return {"weeks": labels, "report": report}


def build_all_reports() -> dict[str, Any]:
    labels = sorted_week_labels()
    return {label: get_weekly_report(label)["report"] for label in labels}
