"""回滚素材：历史回滚成效 + 最新周可回滚推荐。"""
from __future__ import annotations

from typing import Any

from data_loader import store, week_sort_key
from weekly_report import _aggregate_materials, _week_records, sorted_week_labels

ROLLBACK_SPEND_MAX = 50.0


def _material_row(m: dict[str, Any], rank: int, tag: str = "") -> dict[str, Any]:
    return {
        "rank": rank,
        "material_id": m["material_id"],
        "direction": m.get("direction"),
        "theme": m.get("theme"),
        "designer": m.get("designer"),
        "first_seen": m.get("first_seen"),
        "purchases": int(m.get("purchases", 0)),
        "subscriptions": int(m.get("subscriptions", 0)),
        "spend": round(m.get("spend", 0), 2),
        "roas": round(m.get("roas", 0), 2),
        "ctr": round(m.get("ctr", 0), 2),
        "scaling_status": m.get("scaling_status"),
        "tag": tag,
    }


def _aggregate_rollback_records() -> list[dict[str, Any]]:
    records = [r for r in store.records if r.get("data_scope") == "rollback"]
    return _aggregate_materials(records)


def _rollback_period_label() -> str:
    labels = sorted(
        {r.get("week_label", "") for r in store.records if r.get("data_scope") == "rollback" and r.get("week_label")}
    )
    return labels[0] if labels else "回滚素材"


def get_rollback_report() -> dict[str, Any]:
    historical_raw = _aggregate_rollback_records()
    historical = [
        m for m in historical_raw if m.get("purchases", 0) >= 1
    ]
    historical.sort(key=lambda m: (m.get("purchases", 0), m.get("subscriptions", 0)), reverse=True)

    weeks = sorted_week_labels()
    recommend_week = weeks[-1] if weeks else None
    recommended: list[dict[str, Any]] = []
    if recommend_week:
        weekly = _aggregate_materials(_week_records(recommend_week))
        recommended = [
            m for m in weekly
            if m.get("purchases", 0) >= 1 and m.get("spend", 0) < ROLLBACK_SPEND_MAX
        ]
        recommended.sort(key=lambda m: (m.get("purchases", 0), -m.get("spend", 0)), reverse=True)

    return {
        "period_label": _rollback_period_label(),
        "historical": [_material_row(m, i + 1, "已回滚") for i, m in enumerate(historical)],
        "recommend_week": recommend_week,
        "recommended": [_material_row(m, i + 1, "可回滚") for i, m in enumerate(recommended)],
        "criteria": {
            "historical": "有购物",
            "recommended": f"消耗 < ${int(ROLLBACK_SPEND_MAX)} 且有购物",
        },
    }
