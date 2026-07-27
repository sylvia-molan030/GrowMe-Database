#!/usr/bin/env python3
"""从账户全量 CSV 按规则重生周度文件。

分类：素材名含 pic → 图片；设计师 cty → 老素材；其余 → 新素材。
输出：{MMDD}周老素材.csv / {MMDD}周新创意素材.csv / {MMDD}周图片素材.csv
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

from data_loader import DATA_DIR, _detect_channel, _normalize_columns, week_sort_key  # noqa: E402
from parser import parse_material  # noqa: E402
from data_loader import cohort_week_label_from_first_seen  # noqa: E402

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


def _classify(ad_name: str, designer: str) -> str:
    mid = (ad_name or "").lower()
    if "pic" in mid:
        return "pic"
    if (designer or "").lower() == "cty":
        return "old"
    return "new"


def _weeks_to_regenerate() -> list[str]:
    labels: set[str] = set()
    for path in DATA_DIR.iterdir():
        if path.suffix.lower() not in {".csv", ".xlsx", ".xls"}:
            continue
        if path.name.startswith("account_") or ROLLBACK_FILE_RE.search(path.name):
            continue
        m = WEEK_FILE_RE.search(path.name)
        if m:
            labels.add(m.group(1) + "周")
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

    target_weeks = weeks or _weeks_to_regenerate()
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
        key = _classify(parsed.material_id, parsed.designer)
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

    print(f"已重生 {len(target_weeks)} 个周度 Tab（cty→老素材 · pic→图片 · 其余→新素材）")


if __name__ == "__main__":
    csv_arg = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    regenerate(csv_arg)
