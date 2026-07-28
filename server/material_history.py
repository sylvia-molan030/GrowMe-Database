"""素材每日快照：全量更新时记录 cumulative spend/roas，前端展示日消耗增量与 ROAS 曲线。"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from data_loader import store

ROOT = Path(__file__).resolve().parent.parent
HISTORY_PATH = ROOT / "data_outputs" / "material_daily_history.json"
OUTPUT_PATH = ROOT / "docs" / "data" / "material-daily-trends.json"
MAX_POINTS = 90


def _norm(material_id: str) -> str:
    return (material_id or "").strip().lower()


def snapshot_date() -> str:
    dates = [
        str(r.get("report_end", ""))[:10]
        for r in store.records
        if r.get("data_scope") == "account" and r.get("report_end")
    ]
    if dates:
        return max(dates)
    return datetime.now().strftime("%Y-%m-%d")


def _build_trends(mats_hist: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, series in mats_hist.items():
        if not series:
            continue
        ordered = sorted(series, key=lambda p: p["date"])
        dates = [p["date"] for p in ordered]
        roas = [p["roas"] for p in ordered]
        spend_daily: list[float] = []
        for i, point in enumerate(ordered):
            if i == 0:
                spend_daily.append(round(float(point["spend"]), 2))
            else:
                delta = float(point["spend"]) - float(ordered[i - 1]["spend"])
                spend_daily.append(round(max(0.0, delta), 2))
        out[key] = {"dates": dates, "spend_daily": spend_daily, "roas": roas}
    return out


def update_and_export(materials: list[dict[str, Any]]) -> dict[str, Any]:
    """写入当日快照并导出前端趋势 JSON。"""
    snap = snapshot_date()
    history: dict[str, Any] = {"version": 1, "materials": {}}
    if HISTORY_PATH.exists():
        try:
            history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    mats_hist: dict[str, list[dict[str, Any]]] = history.setdefault("materials", {})
    for m in materials:
        key = _norm(m.get("material_id", ""))
        if not key:
            continue
        series = mats_hist.setdefault(key, [])
        point = {
            "date": snap,
            "spend": round(float(m.get("spend") or 0), 2),
            "roas": round(float(m.get("roas") or 0), 2),
        }
        if series and series[-1].get("date") == snap:
            series[-1] = point
        else:
            series.append(point)
        if len(series) > MAX_POINTS:
            mats_hist[key] = series[-MAX_POINTS:]

    history["last_snapshot"] = snap
    history["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")

    payload = {"snapshot_date": snap, "trends": _build_trends(mats_hist)}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload


def get_material_trend(material_id: str) -> dict[str, Any] | None:
    if not OUTPUT_PATH.exists():
        return None
    try:
        data = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return (data.get("trends") or {}).get(_norm(material_id))
