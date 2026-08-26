"""周维度上新复盘：按 week_label × channel 聚合 KPI、对照与洞察。"""
from __future__ import annotations

from collections import defaultdict
import re
from typing import Any

from data_loader import (
    store,
    week_sort_key,
    WEEKLY_DATA_SCOPES,
    WEEKLY_KPI_SCOPES,
    cohort_week_label_from_first_seen,
)
from cross_rubric import cross_rubric_heatmap_from_materials
from parser import AUDIENCE_DIRECTIONS, canonical_audience, canonical_direction, canonical_theme, primary_theme


_NEW_SCHEMA_WEEK_KEY = week_sort_key("0629周")
SUBSCRIPTION_METRIC_CUTOFF_WEEK = "0803周"
_SUBSCRIPTION_CUTOFF_KEY = week_sort_key(SUBSCRIPTION_METRIC_CUTOFF_WEEK)


def _is_new_schema_week(week_label: str) -> bool:
    return week_sort_key(week_label) >= _NEW_SCHEMA_WEEK_KEY


def uses_subscription_metrics(week_label: str) -> bool:
    """0803 周起周维度以订阅率为核心，不看购物出单率。"""
    return week_sort_key(week_label) >= _SUBSCRIPTION_CUTOFF_KEY


def sorted_week_labels() -> list[str]:
    """周度 Tab 列表来自周度/新方向文件；KPI 除快照周外按全量生命周期。"""
    labels = {
        r.get("week_label", "")
        for r in store.records
        if r.get("data_scope") in ("weekly", "new_direction") and r.get("week_label")
    }
    labels.discard("")
    return sorted(labels, key=week_sort_key)


def _prev_week_label(week: str) -> str | None:
    labels = sorted_week_labels()
    if week not in labels:
        return None
    idx = labels.index(week)
    return labels[idx - 1] if idx > 0 else None


def _norm_material_id(material_id: str) -> str:
    return (material_id or "").strip().lower()


def _week_records(
    week_label: str,
    channel: str | None = None,
    *,
    kpi: bool = False,
) -> list[dict[str, Any]]:
    scopes = WEEKLY_KPI_SCOPES if kpi else WEEKLY_DATA_SCOPES
    rows = [
        r
        for r in store.records
        if r.get("data_scope") in scopes and r.get("week_label") == week_label
    ]
    if channel:
        rows = [r for r in rows if r.get("channel") == channel]
    return rows


def _account_records_for_week(week_label: str) -> list[dict[str, Any]]:
    """账户全量中，素材名前缀日期归入该自然周的记录（全量生命周期成效）。"""
    rows: list[dict[str, Any]] = []
    for r in store.records:
        if r.get("data_scope") != "account":
            continue
        lab = cohort_week_label_from_first_seen(r.get("first_seen"))
        if lab != week_label:
            continue
        rows.append({**r, "week_label": lab})
    return rows


def _account_materials_index() -> dict[str, dict[str, Any]]:
    """账户全量按素材名聚合，供历史周覆盖出单/消耗等生命周期指标。"""
    rows = [r for r in store.records if r.get("data_scope") == "account"]
    return {_norm_material_id(m["material_id"]): m for m in _aggregate_materials(rows)}


def _overlay_lifecycle_metrics(
    materials: list[dict[str, Any]],
    account_by_id: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """用账户全量指标覆盖同名素材的出单/消耗等（保留周度文件上的分类字段）。"""
    index = account_by_id if account_by_id is not None else _account_materials_index()
    out: list[dict[str, Any]] = []
    for m in materials:
        acc = index.get(_norm_material_id(m.get("material_id", "")))
        if not acc:
            out.append(m)
            continue
        merged = {**m}
        for key in (
            "purchases",
            "subscriptions",
            "spend",
            "impressions",
            "installs",
            "roas",
            "ctr",
            "hook_rate",
            "retention_rate",
        ):
            if key in acc:
                merged[key] = acc[key]
        merged["has_order"] = merged.get("purchases", 0) >= 1
        out.append(merged)
    return out


def _report_materials_for_week(week_label: str) -> tuple[list[dict[str, Any]], str]:
    """报告用素材列表：有周度文件则用名单+账户覆盖；否则回退账户生命周期。"""
    weekly_rows = _week_records(week_label, kpi=True)
    if weekly_rows:
        mats = _aggregate_materials(weekly_rows)
        return _overlay_lifecycle_metrics(mats), "weekly_files_lifecycle"

    account_mats = _aggregate_materials(_account_records_for_week(week_label))
    if account_mats:
        return account_mats, "account_lifecycle"

    return [], "empty"


def _kpi_for_week(week_label: str) -> tuple[dict[str, Any], str]:
    """返回 (kpi, source)。周度名单来自周度文件、成效按账户全量刷新。"""
    mats, source = _report_materials_for_week(week_label)
    sub_mode = uses_subscription_metrics(week_label)
    return _channel_kpi(mats, subscription_mode=sub_mode), source


def _aggregate_materials(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按素材名去重聚合（大小写不敏感，同名算一条）。"""
    grouped: dict[str, dict[str, Any]] = {}
    for r in records:
        mid = _norm_material_id(r["material_id"])
        if not mid:
            continue
        if mid not in grouped:
            grouped[mid] = {**r}
            grouped[mid]["material_id"] = r["material_id"]
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


def _channel_kpi(
    materials: list[dict[str, Any]],
    *,
    subscription_mode: bool = False,
) -> dict[str, Any]:
    total = len(materials)
    spend = sum(m["spend"] for m in materials)
    purchases = sum(m["purchases"] for m in materials)
    subscriptions = sum(m.get("subscriptions", 0) for m in materials)
    impressions = sum(m["impressions"] for m in materials)
    installs = sum(m["installs"] for m in materials)
    roas_vals = [(m["roas"], m["spend"]) for m in materials if m["roas"] > 0 and m["spend"] > 0]
    roas = sum(r * s for r, s in roas_vals) / sum(s for _, s in roas_vals) if roas_vals else 0

    if subscription_mode:
        converted = [m for m in materials if m.get("subscriptions", 0) >= 1]
        ge2 = [m for m in materials if m.get("subscriptions", 0) >= 2]
        ge5 = [m for m in materials if m.get("subscriptions", 0) >= 5]
        empty_spend = sum(
            m["spend"] for m in materials if m.get("subscriptions", 0) < 1
        )
        conversions = int(subscriptions)
    else:
        converted = [m for m in materials if m["purchases"] >= 1]
        ge2 = [m for m in materials if m["purchases"] >= 2]
        ge5 = [m for m in materials if m["purchases"] >= 5]
        empty_spend = sum(
            m["spend"] for m in materials if m["purchases"] < 1 and m.get("subscriptions", 0) < 1
        )
        conversions = int(purchases)

    subscription_cost = (
        round(spend / subscriptions, 2) if subscription_mode and subscriptions > 0 else None
    )

    return {
        "spend": round(spend, 2),
        "ordered_materials": len(converted),
        "conversions": conversions,
        "subscriptions": int(subscriptions),
        "purchases": int(purchases),
        "order_rate": round(len(converted) / total * 100, 2) if total else 0,
        "ge2_rate": round(len(ge2) / total * 100, 2) if total else 0,
        "ge5_rate": round(len(ge5) / total * 100, 2) if total else 0,
        "empty_spend": round(empty_spend, 2),
        "cpi": round(spend / installs, 2) if installs > 0 else None,
        "cpm": round(spend / impressions * 1000, 2) if impressions > 0 else None,
        "subscription_cost": subscription_cost,
        "roas": round(roas, 2),
        "total_materials": total,
        "metric_mode": "subscription" if subscription_mode else "purchase",
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


def _core_metrics(materials: list[dict[str, Any]], *, subscription_mode: bool = False) -> dict[str, Any]:
    kpi = _channel_kpi(materials, subscription_mode=subscription_mode)
    return {
        "spend": kpi["spend"],
        "empty_spend": kpi["empty_spend"],
        "cpi": kpi["cpi"],
        "cpm": kpi["cpm"],
        "subscriptions": kpi["subscriptions"],
        "purchases": kpi["conversions"] if subscription_mode else kpi["purchases"],
        "order_rate": kpi["order_rate"],
        "subscription_cost": kpi.get("subscription_cost"),
        "roas": kpi["roas"],
    }


def _comparison_table(
    current: dict[str, Any],
    previous: dict[str, Any] | None,
    *,
    subscription_mode: bool = False,
) -> list[dict[str, Any]]:
    conv_label = "总订阅量" if subscription_mode else "总出单量"
    rate_label = "订阅率" if subscription_mode else "出单率"
    labels = {
        "spend": ("总消耗", "$"),
        "empty_spend": ("空消耗", "$"),
        "cpi": ("CPI", "$"),
        "cpm": ("CPM", "$"),
        "order_rate": (rate_label, "%"),
        "subscriptions": ("订阅数", ""),
        "purchases": (conv_label, ""),
        "subscription_cost": ("订阅成本", "$"),
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


def _direction_table(
    materials: list[dict[str, Any]],
    *,
    subscription_mode: bool = False,
) -> list[dict[str, Any]]:
    from parser import canonical_direction

    by_dir: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in materials:
        by_dir[canonical_direction(m.get("direction") or "未知")].append(m)

    rows = []
    sort_key = (
        (lambda x: -sum(i.get("subscriptions", 0) for i in x[1]))
        if subscription_mode
        else (lambda x: -sum(i["purchases"] for i in x[1]))
    )
    for direction, items in sorted(by_dir.items(), key=sort_key):
        spend = sum(i["spend"] for i in items)
        impressions = sum(i["impressions"] for i in items)
        installs = sum(i["installs"] for i in items)
        purchases = sum(i["purchases"] for i in items)
        subscriptions = sum(i.get("subscriptions", 0) for i in items)
        if subscription_mode:
            ordered = sum(1 for i in items if i.get("subscriptions", 0) >= 1)
        else:
            ordered = sum(1 for i in items if i["purchases"] >= 1)
        ctr_vals = [i["ctr"] for i in items if i["ctr"] > 0]
        roas_vals = [(i["roas"], i["spend"]) for i in items if i["roas"] > 0 and i["spend"] > 0]
        hook_vals = [(i["hook_rate"], i["impressions"] or 1) for i in items if i.get("hook_rate")]
        ret_vals = [(i["retention_rate"], i["impressions"] or 1) for i in items if i.get("retention_rate")]

        total = len(items)
        sub_cost = (
            round(spend / subscriptions, 2) if subscription_mode and subscriptions > 0 else None
        )
        rows.append(
            {
                "direction": direction,
                "total_materials": total,
                "ordered_materials": ordered,
                "ordered_ratio": f"{ordered}/{total}",
                "order_rate": round(ordered / total * 100, 2) if total else 0,
                "subscription_cost": sub_cost,
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


def _survival_trend(
    materials: list[dict[str, Any]],
    *,
    subscription_mode: bool = False,
) -> dict[str, Any]:
    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in materials:
        day = m.get("first_seen")
        if day:
            by_day[day].append(m)
    dates = sorted(by_day)

    def _survived(item: dict[str, Any]) -> bool:
        if subscription_mode:
            return item.get("subscriptions", 0) >= 1
        return item.get("purchases", 0) >= 1

    return {
        "dates": dates,
        "counts": [len(by_day[d]) for d in dates],
        "survived_counts": [sum(1 for i in by_day[d] if _survived(i)) for d in dates],
        "survived_label": "有订阅" if subscription_mode else "有购物",
    }


def _good_materials(
    materials: list[dict[str, Any]],
    limit: int = 12,
    *,
    subscription_mode: bool = False,
) -> list[dict[str, Any]]:
    if subscription_mode:
        items = [m for m in materials if m.get("subscriptions", 0) >= 1]
        items.sort(
            key=lambda m: (m.get("subscriptions", 0), m.get("spend", 0), m.get("roas", 0)),
            reverse=True,
        )
    else:
        items = [m for m in materials if m["purchases"] >= 1 and m.get("subscriptions", 0) >= 1]
        items.sort(
            key=lambda m: (m["purchases"], m.get("roas", 0), m.get("subscriptions", 0)),
            reverse=True,
        )
    return [
        {
            "material_id": m["material_id"],
            "direction": m.get("direction"),
            "theme": m.get("theme"),
            "designer": m.get("designer"),
            "purchases": int(m["purchases"]),
            "subscriptions": int(m.get("subscriptions", 0)),
            "subscription_cost": (
                round(m["spend"] / m.get("subscriptions", 0), 2)
                if subscription_mode and m.get("subscriptions", 0) > 0
                else None
            ),
            "cpi": (
                round(m["spend"] / m.get("installs", 0), 2)
                if m.get("installs", 0) > 0
                else None
            ),
            "subscription_rate": (
                round(m.get("subscriptions", 0) / m.get("installs", 0) * 100, 2)
                if m.get("installs", 0) > 0
                else None
            ),
            "installs": int(m.get("installs", 0)),
            "roas": round(m["roas"], 2),
            "ctr": round(m["ctr"], 2),
            "spend": round(m["spend"], 2),
        }
        for m in items[:limit]
    ]


def _short_id(material_id: str, limit: int = 52) -> str:
    mid = material_id or ""
    return mid if len(mid) <= limit else f"{mid[:limit]}…"


def _material_blurb(m: dict[str, Any], *, subscription_mode: bool = False) -> str:
    if subscription_mode:
        parts = [f"订阅 {int(m.get('subscriptions', 0))}"]
    else:
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
    *,
    subscription_mode: bool = False,
) -> list[str]:
    insights: list[str] = []
    total = combined_kpi["total_materials"]
    rate = combined_kpi["order_rate"]
    converted_materials = combined_kpi["ordered_materials"]
    rate_name = "订阅率" if subscription_mode else "出单率"
    mat_name = "订阅素材" if subscription_mode else "出单素材"
    conv_name = "订阅量" if subscription_mode else "出单"

    if prev_week and prev_combined:
        rate_delta = rate - prev_combined["order_rate"]
        ord_delta = converted_materials - prev_combined["ordered_materials"]
        arrow = f"↑{rate_delta:.1f}" if rate_delta > 0 else f"↓{abs(rate_delta):.1f}" if rate_delta < 0 else "持平"
        ord_arrow = f"↑{ord_delta}" if ord_delta > 0 else f"↓{abs(ord_delta)}" if ord_delta < 0 else "持平"
        insights.append(
            f"【素材{rate_name}】{week} 上新 {total} 条，{rate_name} {rate}%（较 {prev_week} {arrow}pp），"
            f"{mat_name} {converted_materials} 条（较上周 {ord_arrow}）。"
            f"上周{rate_name} {prev_combined['order_rate']}%，{mat_name} {prev_combined['ordered_materials']} 条。"
        )
    else:
        insights.append(
            f"【素材{rate_name}】{week} 上新 {total} 条，{rate_name} {rate}%，{mat_name} {converted_materials} 条。"
        )

    if subscription_mode:
        converted = [m for m in materials if m.get("subscriptions", 0) >= 1]
    else:
        converted = [m for m in materials if m.get("purchases", 0) >= 1]

    if converted:
        if subscription_mode:
            best = max(converted, key=lambda m: (m.get("subscriptions", 0), m.get("roas", 0), m.get("spend", 0)))
        else:
            best = max(converted, key=lambda m: (m.get("purchases", 0), m.get("subscriptions", 0), m.get("roas", 0)))
        insights.append(
            f"【本周最强素材】{_short_id(best['material_id'])}（{best.get('direction', '-')} / {best.get('designer', '-')}）："
            f"{_material_blurb(best, subscription_mode=subscription_mode)}。"
        )
    else:
        empty_hint = "暂无订阅素材" if subscription_mode else "暂无出单素材"
        insights.append(f"【本周最强素材】本周{empty_hint}，建议优先排查钩子与定向。")

    if subscription_mode:
        signal_pool = [m for m in materials if m.get("subscriptions", 0) >= 1]
        if signal_pool:
            signal = max(signal_pool, key=lambda m: (m.get("subscriptions", 0), m.get("roas", 0)))
            insights.append(
                f"【高转化信号素材】{_short_id(signal['material_id'])}（订阅达标）："
                f"{_material_blurb(signal, subscription_mode=True)}，具备放量验证价值。"
            )
        else:
            insights.append("【高转化信号素材】本周暂无订阅，建议从钩子与落地页组合继续迭代。")
    else:
        signal_pool = [m for m in materials if m.get("purchases", 0) >= 1 and m.get("subscriptions", 0) >= 1]
        if signal_pool:
            signal = max(signal_pool, key=lambda m: (m.get("purchases", 0) + m.get("subscriptions", 0), m.get("roas", 0)))
            insights.append(
                f"【高转化信号素材】{_short_id(signal['material_id'])}（购物+订阅双达标）："
                f"{_material_blurb(signal)}，具备放量验证价值。"
            )
        elif converted:
            alt = max(converted, key=lambda m: (m.get("roas", 0), m.get("purchases", 0)))
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
        if subscription_mode:
            top = max(directions, key=lambda d: d["subscriptions"])
            insights.append(
                f"【方向表现】「{top['direction']}」订阅 {top['subscriptions']} 次领先，"
                f"订阅素材 {top['ordered_ratio']}，ROAS {top['roas']}；"
                f"共 {top['total_materials']} 条素材参与本周 WW 测试。"
            )
        else:
            top = max(directions, key=lambda d: d["purchases"])
            insights.append(
                f"【方向表现】「{top['direction']}」购物 {top['purchases']} 单领先，"
                f"出单素材 {top['ordered_ratio']}，ROAS {top['roas']}；"
                f"共 {top['total_materials']} 条素材参与本周 WW 测试。"
            )

    return insights


def _material_breakdown(week: str, test_blocks: list[dict[str, Any]]) -> dict[str, Any] | None:
    """拆分老方向 / 新方向 / 图片，便于 KPI 展示口径。"""
    if not test_blocks:
        return None
    breakdown: dict[str, Any] = {
        "weekly": 0,
        "new_creative": 0,
        "image": 0,
    }
    for block in test_blocks:
        n = block["summary"]["total_materials"]
        label = block.get("label") or ""
        if label in ("老方向", "老形式", "老素材"):
            breakdown["weekly"] = n
        elif label in ("新方向", "新创意", "新素材"):
            breakdown["new_creative"] = n
        elif label == "图片":
            breakdown["image"] = n
    if not any(breakdown.values()):
        return None
    return breakdown


def get_weekly_report(week_label: str | None = None) -> dict[str, Any]:
    labels = sorted_week_labels()
    if not labels:
        return {"weeks": [], "report": None}

    week = week_label or labels[-1]
    if week not in labels:
        week = labels[-1]

    prev = _prev_week_label(week)
    sub_mode = uses_subscription_metrics(week)

    # 当前测试周：周度名单 + 账户覆盖；其余周：账户全量生命周期（方向表/好素材/热力图同步）
    all_materials, materials_source = _report_materials_for_week(week)
    combined_kpi, kpi_source = _kpi_for_week(week)

    prev_combined = None
    prev_metrics = None
    if prev:
        prev_combined, _ = _kpi_for_week(prev)
        prev_materials, _ = _report_materials_for_week(prev)
        prev_metrics = _core_metrics(prev_materials, subscription_mode=uses_subscription_metrics(prev))

    current_metrics = _core_metrics(all_materials, subscription_mode=sub_mode)
    directions = _direction_table(all_materials, subscription_mode=sub_mode)
    good = _good_materials(all_materials, subscription_mode=sub_mode)

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
            "subscription_cost",
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
            "subscription_cost": combined_kpi.get("subscription_cost"),
            "cpi": combined_kpi.get("cpi"),
            "avg_roas": combined_kpi["roas"],
            "wow": wow,
            "kpi_source": kpi_source,
            "materials_source": materials_source,
            "metric_mode": combined_kpi.get("metric_mode", "purchase"),
        },
        "core_comparison": _comparison_table(current_metrics, prev_metrics, subscription_mode=sub_mode),
        "good_materials": good,
        "direction_table": directions,
        "survival_trend": _survival_trend(all_materials, subscription_mode=sub_mode),
        "insights": _generate_insights(
            week, prev, all_materials, combined_kpi, prev_combined, directions,
            subscription_mode=sub_mode,
        ),
    }
    if _is_new_schema_week(week):
        heatmap = cross_rubric_heatmap_from_materials(
            all_materials, subscription_mode=sub_mode
        )
        if heatmap:
            report["cross_rubric_heatmap"] = heatmap
    test_blocks: list[dict[str, Any]] = []
    try:
        from weekly_test_blocks import get_weekly_test_blocks
        # 测试板块名单仍来自周度文件，出单/消耗等一律按账户全量刷新
        test_blocks = get_weekly_test_blocks(week, lifecycle=True)
    except ImportError:
        pass
    if test_blocks:
        report["material_test_blocks"] = test_blocks
        breakdown = _material_breakdown(week, test_blocks)
        if breakdown:
            report["kpi"]["breakdown"] = breakdown
        for block in reversed(test_blocks):
            s = block["summary"]
            if sub_mode:
                report["insights"].insert(
                    0,
                    f"【{block['label']}】测试 {s['total_materials']} 条，"
                    f"订阅 {s['conversions']} 次，订阅率 {s['order_rate']}%。",
                )
            else:
                report["insights"].insert(
                    0,
                    f"【{block['label']}】测试 {s['total_materials']} 条，"
                    f"出单 {s['conversions']} 单，出单率 {s['order_rate']}%。",
                )
    try:
        from audience_test_report import get_audience_test_for_week
        audience_test = get_audience_test_for_week(week)
        if audience_test:
            report["audience_test"] = audience_test
    except ImportError:
        pass
    return {"weeks": labels, "report": report}


def build_all_reports() -> dict[str, Any]:
    labels = sorted_week_labels()
    return {label: get_weekly_report(label)["report"] for label in labels}
