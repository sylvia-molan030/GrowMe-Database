"""GrowMe BI 后端 API。"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import analytics
from data_loader import store
from materials_catalog import build_catalog, export_catalog, get_catalog_summary
from rollback_report import get_rollback_report
from weekly_report import get_weekly_report

APP_DIR = Path(__file__).resolve().parent
WEB_DIR = APP_DIR.parent / "docs"

app = FastAPI(title="GrowMe BI", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _filters(
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    direction: str = "全部",
    theme: str = "全部",
    optimization: str = "全部",
    stylization: str = "全部",
    pain_point: str = "全部",
    exercise_type: str = "全部",
    channel: str = "全部",
) -> dict[str, str]:
    if not date_start or not date_end:
        date_start, date_end = analytics.default_date_range()
    return {
        "date_start": date_start or "",
        "date_end": date_end or "",
        "direction": direction,
        "theme": theme,
        "optimization": optimization,
        "stylization": stylization,
        "pain_point": pain_point,
        "exercise_type": exercise_type,
        "channel": channel,
    }


@app.on_event("startup")
def startup() -> None:
    store.scan()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "product": "GrowMe"}


@app.post("/api/rescan")
def rescan() -> dict[str, Any]:
    return store.scan()


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    from data_loader import get_weekly_labels

    ds, de = analytics.default_date_range("account")
    wds, wde = analytics.default_date_range("weekly")
    data_min, data_max = analytics.get_data_date_range("account")
    weekly_min, weekly_max = analytics.get_data_date_range("weekly")
    catalog = get_catalog_summary()
    return {
        "files_loaded": store.files_loaded,
        "records": len(store.records),
        "scanned_at": store.last_scan_at,
        "default_date_start": ds,
        "default_date_end": de,
        "data_date_start": data_min,
        "data_date_end": data_max,
        "weekly_date_start": weekly_min,
        "weekly_date_end": weekly_max,
        "weekly_default_date_start": wds,
        "weekly_default_date_end": wde,
        "weekly_labels": get_weekly_labels(),
        "designer_labels": ["gy", "wxx", "fj", "jql", "095KB", "pingme", "jpl", "其他"],
        "filter_options": analytics.get_filter_options("account"),
        "weekly_filter_options": analytics.get_filter_options("weekly"),
        "channel_labels": {"T1": "T1（美国等）", "WW": "WW（全球）"},
        "catalog": catalog,
    }


@app.get("/api/summary")
def summary(
    mode: str = Query("account"),
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    direction: str = "全部",
    theme: str = "全部",
    optimization: str = "全部",
    stylization: str = "全部",
    pain_point: str = "全部",
    exercise_type: str = "全部",
    channel: str = "全部",
) -> dict[str, Any]:
    f = _filters(date_start, date_end, direction, theme, optimization, stylization, pain_point, exercise_type, channel)
    return analytics.get_summary(f, mode=mode)


@app.get("/api/survival-trend")
def survival_trend(
    mode: str = Query("account"),
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    direction: str = "全部",
    theme: str = "全部",
    optimization: str = "全部",
    stylization: str = "全部",
    pain_point: str = "全部",
    exercise_type: str = "全部",
    channel: str = "全部",
) -> dict[str, Any]:
    f = _filters(date_start, date_end, direction, theme, optimization, stylization, pain_point, exercise_type, channel)
    return analytics.get_survival_trend(f, mode=mode)


@app.get("/api/heatmap")
def heatmap(
    y_axis: str = "direction",
    x_axis: str = "theme",
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    direction: str = "全部",
    theme: str = "全部",
    optimization: str = "全部",
    stylization: str = "全部",
    pain_point: str = "全部",
    exercise_type: str = "全部",
    channel: str = "全部",
) -> dict[str, Any]:
    f = _filters(date_start, date_end, direction, theme, optimization, stylization, pain_point, exercise_type, channel)
    return analytics.get_heatmap(f, y_axis=y_axis, x_axis=x_axis)


@app.get("/api/materials")
def materials(
    y_axis: Optional[str] = None,
    y_value: Optional[str] = None,
    x_axis: Optional[str] = None,
    x_value: Optional[str] = None,
    keyword: str = "",
    min_orders: int = 0,
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "purchases",
    sort_dir: str = "desc",
    mode: str = Query("account"),
    scope: Optional[str] = None,
    weekly_only: bool = False,
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    direction: str = "全部",
    theme: str = "全部",
    optimization: str = "全部",
    stylization: str = "全部",
    pain_point: str = "全部",
    exercise_type: str = "全部",
    channel: str = "全部",
) -> dict[str, Any]:
    f = _filters(date_start, date_end, direction, theme, optimization, stylization, pain_point, exercise_type, channel)
    return analytics.get_materials(
        f,
        y_axis=y_axis,
        y_value=y_value,
        x_axis=x_axis,
        x_value=x_value,
        keyword=keyword,
        min_orders=min_orders,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_dir=sort_dir,
        mode=mode,
        scope=scope,
        weekly_only=weekly_only,
    )


@app.get("/api/catalog")
def catalog() -> dict[str, Any]:
    return {"rows": build_catalog(), "summary": get_catalog_summary()}


@app.post("/api/catalog/export")
def catalog_export() -> dict[str, Any]:
    return export_catalog()


@app.get("/api/rollback")
def rollback() -> dict[str, Any]:
    return get_rollback_report()


@app.get("/api/weekly-report")
def weekly_report(week: Optional[str] = None) -> dict[str, Any]:
    return get_weekly_report(week)


@app.get("/api/designers")
def designers(
    mode: str = Query("account"),
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    direction: str = "全部",
    theme: str = "全部",
    optimization: str = "全部",
    stylization: str = "全部",
    pain_point: str = "全部",
    exercise_type: str = "全部",
    channel: str = "全部",
) -> dict[str, Any]:
    f = _filters(date_start, date_end, direction, theme, optimization, stylization, pain_point, exercise_type, channel)
    return {"rows": analytics.get_designer_stats(f, mode=mode)}


if WEB_DIR.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIR / "assets"), name="assets")
    data_dir = WEB_DIR / "data"
    if data_dir.exists():
        app.mount("/data", StaticFiles(directory=data_dir), name="data")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
