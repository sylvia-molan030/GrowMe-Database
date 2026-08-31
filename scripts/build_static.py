#!/usr/bin/env python3
"""扫描 data_inputs 并导出 GitHub Pages 静态数据包。"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"
sys.path.insert(0, str(SERVER))

import analytics  # noqa: E402
from data_loader import get_recent_weekly_labels, get_recent_new_material_window, get_weekly_labels, store, week_sort_key  # noqa: E402
from audience_test_report import AUDIENCE_TESTS, get_audience_test_for_week  # noqa: E402
from new_direction_report import get_new_direction_report  # noqa: E402
from material_history import update_and_export  # noqa: E402
from parser import AUDIENCE_DIRECTIONS, NEW_SCHEMA_CUTOFF_WEEK, canonical_direction, canonical_theme, designer_labels, primary_theme  # noqa: E402
from weekly_report import build_all_reports  # noqa: E402

OUTPUT_DIR = ROOT / "docs" / "data"
JS_DIR = ROOT / "docs" / "assets" / "js"
INDEX_HTML = ROOT / "docs" / "index.html"
IMPORT_RE = re.compile(r"""from\s+['"](\.\.?/[^'"?]+)(?:\?v=\d+)?['"]""")
DYNAMIC_IMPORT_RE = re.compile(r"""import\s*\(\s*['"](\.\.?/[^'"?]+)(?:\?v=\d+)?['"]\s*\)""")


def _resolve_import_target(path: Path, spec: str) -> str | None:
    """按导入文件自身位置解析相对 import，得到站点根相对路径（/assets/js/...）。"""
    resolved = (path.parent / spec).resolve()
    try:
        rel = resolved.relative_to(JS_DIR.resolve())
    except ValueError:
        return None
    return "/assets/js/" + rel.as_posix()


def _collect_importmap_entries(version: int) -> dict[str, str]:
    """为所有相对 import 的 ES module 生成顶层 imports importmap，子模块也能带版本号加载。

    注意：importmap 的 key 按文档 base URL 解析，而 import specifier 按导入模块自身 URL 解析；
    两边只有解析成同一绝对 URL 才会命中映射。因此 key 必须是完整路径（/assets/js/xxx.js），
    不能写 specifier 原样（如 ../api.js），否则映射永远不生效、缓存穿透失效。
    """
    entries: dict[str, str] = {}
    for path in sorted(JS_DIR.rglob("*.js")):
        text = path.read_text(encoding="utf-8")
        specs = [m.group(1) for m in IMPORT_RE.finditer(text)]
        specs += [m.group(1) for m in DYNAMIC_IMPORT_RE.finditer(text)]
        for spec in specs:
            target = _resolve_import_target(path, spec)
            if target:
                entries[target] = f"{target}?v={version}"
    return entries


def bump_frontend_cache() -> int:
    html = INDEX_HTML.read_text(encoding="utf-8")
    build_match = re.search(r'data-build="(\d+)"', html)
    version = int(build_match.group(1)) + 1 if build_match else 1

    entries = _collect_importmap_entries(version)
    importmap_json = json.dumps({"imports": entries}, ensure_ascii=False, indent=2)
    importmap_block = f"  <script type=\"importmap\">\n{importmap_json}\n  </script>\n"

    html = re.sub(r'data-build="\d+"', f'data-build="{version}"', html)
    if 'data-static=' not in html:
        html = html.replace("<html ", '<html data-static="true" ', 1)
    html = re.sub(
        r'href="\./assets/css/style\.css(?:\?v=\d+)?"',
        f'href="./assets/css/style.css?v={version}"',
        html,
    )
    html = re.sub(
        r'<script type="module" src="\./assets/js/app\.js(?:\?v=\d+)?"></script>',
        f'<script type="module" src="./assets/js/app.js?v={version}"></script>',
        html,
    )
    if 'type="importmap"' in html:
        html = re.sub(r'  <script type="importmap">.*?</script>\n', importmap_block, html, flags=re.DOTALL)
    else:
        html = html.replace("  <script type=\"module\"", importmap_block + "  <script type=\"module\"")

    INDEX_HTML.write_text(html, encoding="utf-8")
    print(f"✓ 前端缓存版本已更新: v{version}（importmap + CSS/JS）")
    return version


ALL_FILTERS = {
    "date_start": "2020-01-01",
    "date_end": "2030-12-31",
    "direction": "全部",
    "theme": "全部",
    "optimization": "全部",
    "stylization": "全部",
    "pain_point": "全部",
    "exercise_type": "全部",
    "channel": "全部",
}


def _material_row(m: dict, rank: int) -> dict:
    return {
        "rank": rank,
        "material_id": m["material_id"],
        "standard_id": m.get("standard_id"),
        "first_seen": m.get("first_seen"),
        "designer": m.get("designer"),
        "designer_variant": m.get("designer_variant"),
        "serial_code": m.get("serial_code"),
        "direction": canonical_direction(m.get("direction") or "未知"),
        "theme": canonical_theme(m.get("theme") or "未知"),
        "optimization": m.get("optimization") or "",
        "stylization": m.get("stylization"),
        "pain_point": m.get("pain_point"),
        "exercise_type": m.get("exercise_type"),
        "channel": m.get("channel") or "WW",
        "purchases": int(m["purchases"]),
        "subscriptions": int(m.get("subscriptions", 0)),
        "installs": int(m.get("installs", 0)),
        "cpi": m.get("cpi"),
        "subscription_rate": m.get("subscription_rate"),
        "roas": round(m["roas"], 2),
        "ctr": round(m["ctr"], 2),
        "spend": round(m["spend"], 2),
        "scaling_status": m.get("scaling_status"),
        "hook_rate": round(m.get("hook_rate") or 0, 2),
        "retention_rate": round(m.get("retention_rate") or 0, 2),
        "week_label": m.get("week_label"),
    }


def _export_materials(mode: str, scope: str | None = None, weekly_only: bool = False) -> list[dict]:
    records = analytics.filter_records(ALL_FILTERS, mode=mode, scope=scope, weekly_only=weekly_only)
    materials = analytics._aggregate_by_material(records)
    materials.sort(key=lambda m: m.get("purchases", 0), reverse=True)
    return [_material_row(m, i + 1) for i, m in enumerate(materials)]


def _export_weekly_reports() -> dict:
    reports = build_all_reports()
    return {"weeks": sorted(reports.keys(), key=week_sort_key), "reports": reports}


def build_week_date_map(labels: list[str], data_end: str | None) -> dict[str, str]:
    """周标签 → 该自然周周一 ISO 日期（供前端日期选择器）。"""
    from datetime import datetime, timedelta

    if not labels:
        return {}
    end = datetime.strptime((data_end or "2026-08-26")[:10], "%Y-%m-%d")
    result: dict[str, str] = {}
    prev_date: datetime | None = None
    for label in sorted(labels, key=week_sort_key):
        m = re.search(r"(\d{2})(\d{2})", label or "")
        if not m:
            continue
        month, day = int(m.group(1)), int(m.group(2))
        year = end.year
        if prev_date is None and month * 100 + day > end.month * 100 + end.day + 30:
            year -= 1
        try:
            d = datetime(year, month, day)
        except ValueError:
            continue
        if prev_date and d < prev_date - timedelta(days=3):
            year = prev_date.year + (1 if month < prev_date.month else 0)
            try:
                d = datetime(year, month, day)
            except ValueError:
                d = datetime(prev_date.year + 1, month, day)
        result[label] = d.strftime("%Y-%m-%d")
        prev_date = d
    return result


def build() -> dict:
    store.scan()

    account_materials = _export_materials("account")
    weekly_materials = _export_materials("new")
    account_records = analytics.filter_records(ALL_FILTERS, mode="account")
    account_mats_raw = analytics._aggregate_by_material(account_records)
    update_and_export(account_mats_raw)
    weekly_reports = _export_weekly_reports()
    audience_tests = {
        week: block
        for week in AUDIENCE_TESTS
        if (block := get_audience_test_for_week(week))
    }

    ds, de = analytics.default_date_range("account")
    wds, wde = analytics.default_date_range("weekly")
    data_min, data_max = analytics.get_data_date_range("account")
    weekly_min, weekly_max = analytics.get_data_date_range("weekly")
    weekly_labels = get_weekly_labels()

    snapshot = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "site_url": "https://sylvia-molan030.github.io/GrowMe-Database/",
        "meta": {
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
            "weekly_labels": weekly_labels,
            "week_date_map": build_week_date_map(weekly_labels, data_max),
            "recent_weekly_labels": get_recent_weekly_labels(),
            "recent_weekly_window": 2,
            "schema_cutoff_week": NEW_SCHEMA_CUTOFF_WEEK,
            "audience_directions": list(AUDIENCE_DIRECTIONS),
            "designer_labels": designer_labels(),
            "filter_options": analytics.get_filter_options("account"),
            "weekly_filter_options": analytics.get_filter_options("weekly"),
            "channel_labels": {"T1": "T1（美国等）", "WW": "WW（全球）"},
            "catalog": {
                "total_materials": len(account_materials),
                "weekly_materials": len(weekly_materials),
            },
            "static": True,
        },
        "materials_account": account_materials,
        "materials_weekly": weekly_materials,
        "weekly_reports": weekly_reports["reports"],
        "audience_tests": audience_tests,
        "new_direction": get_new_direction_report(),
    }
    return snapshot, weekly_reports


def main() -> None:
    bump_frontend_cache()
    snapshot, weekly_reports = build()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUTPUT_DIR / "snapshot.json"
    weekly_out = OUTPUT_DIR / "weekly-reports.json"
    out.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    weekly_out.write_text(json.dumps(weekly_reports, ensure_ascii=False, indent=2), encoding="utf-8")
    trends_out = OUTPUT_DIR / "material-daily-trends.json"
    print(f"✓ 静态数据已导出: {out}")
    if trends_out.exists():
        print(f"✓ 素材日趋势已导出: {trends_out}")
    print(f"✓ 周度报告已导出: {weekly_out}")
    print(f"  账户素材: {len(snapshot['materials_account'])} 条")
    print(f"  上新素材成效: {len(snapshot['materials_weekly'])} 条（全量·按素材日期近 {snapshot['meta']['recent_weekly_window']} 周：{' · '.join(snapshot['meta']['recent_weekly_labels'])}）")
    window = get_recent_new_material_window()
    if window[1] and window[2]:
        print(f"  上新日期窗: {window[1]} → {window[2]}")
    print(f"  周度 Tab: {' · '.join(snapshot['meta']['weekly_labels'])}")


if __name__ == "__main__":
    main()
