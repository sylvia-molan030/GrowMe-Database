"""周维度上新复盘：按 week_label × channel 聚合 KPI、对照与洞察。"""
from __future__ import annotations

from collections import defaultdict
import re
from typing import Any

from data_loader import store, week_sort_key, WEEKLY_DATA_SCOPES
from cross_rubric import cross_rubric_heatmap_from_materials
from parser import AUDIENCE_DIRECTIONS, canonical_audience, canonical_direction, canonical_theme, primary_theme


_NEW_SCHEMA_WEEK_KEY = week_sort_key("0629周")


def _is_new_schema_week(week_label: str) -> bool:
    return week_sort_key(week_label) >= _NEW_SCHEMA_WEEK_KEY


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
            grouped[mid]["views_3s_sum"] = 0.0
            grouped[mid]["video_completions_sum"] = 0.0
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
        hook = r.get("hook_rate", 0) or 0
        if hook > 0:
            g["hook_values"].append(hook)
            g["hook_weights"].append(weight)
            g["views_3s_sum"] += weight * hook / 100
        g["video_completions_sum"] += r.get("video_completions", 0) or 0

    result: list[dict[str, Any]] = []
    for g in grouped.values():
        ctr_vals = g.pop("ctr_values", [])
        roas_vals = g.pop("roas_values", [])
        hook_vals = g.pop("hook_values", [])
        hook_w = g.pop("hook_weights", [])
        views_3s = g.pop("views_3s_sum", 0) or 0
        comps = g.pop("video_completions_sum", 0) or 0
        g["ctr"] = sum(ctr_vals) / len(ctr_vals) if ctr_vals else 0
        g["roas"] = sum(roas_vals) / len(roas_vals) if roas_vals else 0
        g["hook_rate"] = _weighted_avg(hook_vals, hook_w)
        g["retention_rate"] = round(comps / views_3s * 100, 2) if views_3s > 0 else 0
        g["direction"] = canonical_direction(g.get("direction") or "未知")
        g["theme"] = canonical_theme(g.get("theme") or "未知")
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
        "ordered_materials": len(ordered),
        "conversions": int(purchases),
        "subscriptions": int(subscriptions),
        "order_rate": round(len(ordered) / total * 100, 2) if total else 0,
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
        "cpi": ("CPI", "$"),
        "cpm": ("CPM", "$"),
        "subscriptions": ("订阅数", ""),
        "purchases": ("总出单量", ""),
        "roas": ("平均 ROAS", ""),
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
    from parser import canonical_direction

    by_dir: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in materials:
        by_dir[canonical_direction(m.get("direction") or "未知")].append(m)

    rows = []
    for direction, items in sorted(by_dir.items(), key=lambda x: -sum(i["purchases"] for i in x[1])):
        spend = sum(i["spend"] for i in items)
        impressions = sum(i["impressions"] for i in items)
        installs = sum(i["installs"] for i in items)
        purchases = sum(i["purchases"] for i in items)
        subscriptions = sum(i.get("subscriptions", 0) for i in items)
        ordered = sum(1 for i in items if i["purchases"] >= 1)
        ctr_vals = [i["ctr"] for i in items if i["ctr"] > 0]
        roas_vals = [(i["roas"], i["spend"]) for i in items if i["roas"] > 0 and i["spend"] > 0]
        hook_vals = [(i["hook_rate"], i["impressions"] or 1) for i in items if i.get("hook_rate")]
        ret_vals = [(i["retention_rate"], i["impressions"] or 1) for i in items if i.get("retention_rate")]

        total = len(items)
        rows.append(
            {
                "direction": direction,
                "total_materials": total,
                "ordered_materials": ordered,
                "ordered_ratio": f"{ordered}/{total}",
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
    ordered_materials = combined_kpi["ordered_materials"]

    if prev_week and prev_combined:
        rate_delta = order_rate - prev_combined["order_rate"]
        ord_delta = ordered_materials - prev_combined["ordered_materials"]
        arrow = f"↑{rate_delta:.1f}" if rate_delta > 0 else f"↓{abs(rate_delta):.1f}" if rate_delta < 0 else "持平"
        ord_arrow = f"↑{ord_delta}" if ord_delta > 0 else f"↓{abs(ord_delta)}" if ord_delta < 0 else "持平"
        insights.append(
            f"【素材测出率】{week} 上新 {total} 条，出单率 {order_rate}%（较 {prev_week} {arrow}pp），"
            f"出单素材 {ordered_materials} 条（较上周 {ord_arrow}）。"
            f"上周出单率 {prev_combined['order_rate']}%，出单素材 {prev_combined['ordered_materials']} 条。"
        )
    else:
        insights.append(
            f"【素材测出率】{week} 上新 {total} 条，出单率 {order_rate}%，出单素材 {ordered_materials} 条。"
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
            f"出单素材 {top['ordered_ratio']}，ROAS {top['roas']}；"
            f"共 {top['total_materials']} 条素材参与本周 WW 测试。"
        )

    return insights


def _material_breakdown(week: str, new_dirs: list[dict[str, Any]]) -> dict[str, Any] | None:
    """拆分常规周素材 vs 图片/数字人新方向，便于 KPI 展示口径。"""
    if not new_dirs:
        return None
    weekly_recs = [
        r for r in store.records
        if r.get("data_scope") == "weekly" and r.get("week_label") == week
    ]
    weekly_count = len(_aggregate_materials(weekly_recs))
    image = digital_human = other = 0
    for block in new_dirs:
        n = block["summary"]["total_materials"]
        label = block.get("label") or ""
        if label == "图片":
            image = n
        elif label == "数字人":
            digital_human = n
        else:
            other += n
    return {
        "weekly": weekly_count,
        "image": image,
        "digital_human": digital_human,
        "other_new_direction": other,
    }


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
            "ordered_materials",
            "conversions",
            "subscriptions",
        ):
            wow[key] = _wow_delta(combined_kpi.get(key), prev_combined.get(key))
        wow["avg_roas"] = _wow_delta(combined_kpi.get("roas"), prev_combined.get("roas"))

    report = {
        "week": week,
        "prev_week": prev,
        "weeks": labels,
        "kpi": {
            "total_materials": combined_kpi["total_materials"],
            "order_rate": combined_kpi["order_rate"],
            "ge2_rate": combined_kpi["ge2_rate"],
            "ge5_rate": combined_kpi["ge5_rate"],
            "spend": combined_kpi["spend"],
            "ordered_materials": combined_kpi["ordered_materials"],
            "conversions": combined_kpi["conversions"],
            "subscriptions": combined_kpi["subscriptions"],
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
    if _is_new_schema_week(week):
        heatmap = cross_rubric_heatmap_from_materials(all_materials)
        if heatmap:
            report["cross_rubric_heatmap"] = heatmap
    new_dirs: list[dict[str, Any]] = []
    try:
        from new_direction_report import get_new_direction_blocks_for_week
        new_dirs = get_new_direction_blocks_for_week(week)
    except ImportError:
        pass
    if new_dirs:
        report["new_direction_tests"] = new_dirs
        report["new_direction_test"] = new_dirs[0]
        breakdown = _material_breakdown(week, new_dirs)
        if breakdown:
            report["kpi"]["breakdown"] = breakdown
        for block in reversed(new_dirs):
            report["insights"].insert(
                0,
                f"【新方向测试·{block['label']}】{block['note']} "
                f"共 {block['summary']['total_materials']} 条，消耗 ${block['summary']['spend']}，"
                f"购物 {block['summary']['purchases']} / 订阅 {block['summary']['subscriptions']}。",
            )
    return {"weeks": labels, "report": report}


def build_all_reports() -> dict[str, Any]:
    labels = sorted_week_labels()
    return {label: get_weekly_report(label)["report"] for label in labels}
