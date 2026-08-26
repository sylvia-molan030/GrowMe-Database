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


def _resolve_scope_target(scope: str, spec: str) -> str:
    """把 scope 内的相对 import 解析成相对站点根的路径（供 importmap 地址用）。"""
    base = scope[2:] if scope.startswith("./") else scope
    joined = str(Path(base) / spec)
    parts: list[str] = []
    for part in Path(joined).parts:
        if part == "..":
            if parts:
                parts.pop()
        elif part not in (".", ""):
            parts.append(part)
    return "./" + "/".join(parts)


def _register_scope_spec(scopes: dict[str, dict[str, str]], scope: str, spec: str, version: int) -> None:
    target = _resolve_scope_target(scope, spec)
    scopes.setdefault(scope, {})[spec] = f"{target}?v={version}"


def _collect_importmap_scopes(version: int) -> dict[str, dict[str, str]]:
    """为 ES module 子依赖生成 importmap scopes，避免仅 app.js 带版本时子模块仍走浏览器旧缓存。

    地址必须相对文档根解析（如 ./assets/js/pages/foo.js?v=N），不能写成 ./pages/foo.js?v=N。
    """
    scopes: dict[str, dict[str, str]] = {}
    for path in sorted(JS_DIR.rglob("*.js")):
        rel_dir = path.parent.relative_to(JS_DIR)
        scope = "./assets/js/" if rel_dir == Path(".") else f"./assets/js/{rel_dir.as_posix()}/"
        text = path.read_text(encoding="utf-8")
        for match in IMPORT_RE.finditer(text):
            _register_scope_spec(scopes, scope, match.group(1), version)
        for match in DYNAMIC_IMPORT_RE.finditer(text):
            _register_scope_spec(scopes, scope, match.group(1), version)
    return scopes


def bump_frontend_cache() -> int:
    html = INDEX_HTML.read_text(encoding="utf-8")
    build_match = re.search(r'data-build="(\d+)"', html)
    version = int(build_match.group(1)) + 1 if build_match else 1

    scopes = _collect_importmap_scopes(version)
    importmap_json = json.dumps({"scopes": scopes}, ensure_ascii=False, indent=2)
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
            "weekly_labels": get_weekly_labels(),
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
