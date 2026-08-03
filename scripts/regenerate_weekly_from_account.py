#!/usr/bin/env python3
"""从账户全量 CSV 按规则重生周度文件。

分类：FX-pic → 图片；0720周前 ZT 含 pic 也算；0720周起仅 FX-pic；设计师 cty → 老素材；其余 → 新素材。
输出：{MMDD}周老素材.csv / {MMDD}周新创意素材.csv / {MMDD}周图片素材.csv
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

from data_loader import (  # noqa: E402
    DATA_DIR,
    RECENT_WEEKLY_WINDOW,
    _detect_channel,
    _normalize_columns,
    cohort_week_label_from_first_seen,
    week_sort_key,
)

from parser import is_pic_material, parse_material  # noqa: E402

WEEK_FILE_RE = re.compile(r"(\d{4})(?:周|week)", re.IGNORECASE)
NEW_DIRECTION_FILE_RE = re.compile(
    r"数字人|新创意|新形式|新方向|图片素材|图片数据|老素材|新素材", re.IGNORECASE
)
ROLLBACK_FILE_RE = re.compile(r"回滚|rollback", re.IGNORECASE)

STANDARD_SUFFIX = {
    "old": "老素材.csv",
    "new": "新创意素材.csv",
    "pic": "图片素材.csv",
}


def _classify(ad_name: str, designer: str, week_label: str) -> str:
    if is_pic_material(ad_name, week_label):
        return "pic"
    if (designer or "").lower() == "cty":
        return "old"
    return "new"


def _recent_cohort_weeks(account_csv: Path, n: int = RECENT_WEEKLY_WINDOW) -> list[str]:
    """与上新素材成效一致：账户最新素材日期所在周起回溯 n 个自然周。"""
    from datetime import datetime, timedelta

    df = pd.read_csv(account_csv)
    df = _normalize_columns(df)
    dates: list[str] = []
    for _, row in df.iterrows():
        ad_name = str(row.get("ad_name", "")).strip()
        if not ad_name or ad_name == "nan":
            continue
        if _detect_channel(account_csv.name, str(row.get("account", "") or "")) != "WW":
            continue
        first_seen = parse_material(ad_name).first_seen
        if first_seen:
            dates.append(str(first_seen)[:10])
    if not dates:
        return []

    max_d = datetime.strptime(max(dates), "%Y-%m-%d")
    latest_monday = max_d - timedelta(days=max_d.weekday())
    labels: list[str] = []
    for i in range(max(n - 1, 0), -1, -1):
        mon = latest_monday - timedelta(days=7 * i)
        labels.append(f"{mon.month:02d}{mon.day:02d}周")
    return labels


def _weeks_to_regenerate(account_csv: Path | None = None) -> list[str]:
    labels: set[str] = set()
    for path in DATA_DIR.iterdir():
        if path.suffix.lower() not in {".csv", ".xlsx", ".xls"}:
            continue
        if path.name.startswith("account_") or ROLLBACK_FILE_RE.search(path.name):
            continue
        m = WEEK_FILE_RE.search(path.name)
        if m:
            labels.add(m.group(1) + "周")
    if account_csv and account_csv.exists():
        labels.update(_recent_cohort_weeks(account_csv))
    return sorted(labels, key=week_sort_key)


def _obsolete_week_files(week_label: str) -> list[Path]:
    prefix = week_label.replace("周", "")
    obsolete: list[Path] = []
    for path in DATA_DIR.iterdir():
        if path.suffix.lower() not in {".csv", ".xlsx", ".xls"}:
            continue
        if path.name.startswith("account_") or ROLLBACK_FILE_RE.search(path.name):
            continue
        if not path.name.startswith(prefix):
            continue
        if path.name.endswith(STANDARD_SUFFIX["old"]):
            continue
        if path.name.endswith(STANDARD_SUFFIX["new"]):
            continue
        if path.name.endswith(STANDARD_SUFFIX["pic"]):
            continue
        obsolete.append(path)
    return obsolete


def regenerate(account_csv: Path | None = None, weeks: list[str] | None = None) -> None:
    src = account_csv or (DATA_DIR / "account_all_WW.csv")
    if not src.exists():
        raise SystemExit(f"缺少账户全量: {src}")

    target_weeks = weeks or _weeks_to_regenerate(src)
    if not target_weeks:
        print("没有需要重生的周度 Tab。")
        return

    df = pd.read_csv(src)
    df = _normalize_columns(df)
    if "ad_name" not in df.columns:
        raise SystemExit("账户 CSV 缺少广告名称列")

    buckets: dict[str, dict[str, list]] = {
        w: {"old": [], "new": [], "pic": []} for w in target_weeks
    }

    for _, row in df.iterrows():
        ad_name = str(row.get("ad_name", "")).strip()
        if not ad_name or ad_name == "nan":
            continue
        account = str(row.get("account", "") or "")
        if _detect_channel(src.name, account) != "WW":
            continue
        parsed = parse_material(ad_name)
        week = cohort_week_label_from_first_seen(parsed.first_seen)
        if not week or week not in buckets:
            continue
        key = _classify(parsed.material_id, parsed.designer, week)
        buckets[week][key].append(row)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    header_cols = list(df.columns)
    for week in target_weeks:
        mmdd = week.replace("周", "")
        for key, suffix in STANDARD_SUFFIX.items():
            out = DATA_DIR / f"{mmdd}周{suffix}"
            rows = buckets[week][key]
            if rows:
                pd.DataFrame(rows).to_csv(out, index=False, encoding="utf-8-sig")
                print(f"  ✓ {out.name}: {len(rows)} 行")
            elif out.exists():
                out.unlink()
                print(f"  − 跳过空文件 {out.name}")

        for old in _obsolete_week_files(week):
            old.unlink()
            print(f"  − 移除旧文件 {old.name}")

    print(f"已重生 {len(target_weeks)} 个周度 Tab（cty→老素材 · FX-pic→图片 · 0720+ 不含 ZT-pic · 其余→新素材）")


if __name__ == "__main__":
    csv_arg = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    regenerate(csv_arg)
