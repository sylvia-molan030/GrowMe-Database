"""扫描 data_inputs 目录，统一解析 CSV / Excel 广告数据。"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pandas as pd

from parser import parse_material, canonical_direction, canonical_theme, primary_theme, uses_new_schema

DATA_DIR = Path(__file__).resolve().parent.parent / "data_inputs"
# 账户全量：全球+T1 按素材名合并；周度上新：仅 WW，不测 T1
WW_ONLY = False
WEEKLY_WW_ONLY = True

# 中英文列名映射
COLUMN_ALIASES: dict[str, list[str]] = {
    "ad_name": ["广告名称", "Ad name", "ad name"],
    "impressions": ["展示次数", "Impressions", "impressions"],
    "spend": ["已花费金额 (USD)", "Amount spent (USD)", "amount spent (usd)"],
    "ctr": ["点击率（全部）", "CTR (all)", "ctr (all)"],
    "purchases": ["购物次数", "Purchases", "purchases"],
    "roas": ["广告花费回报 (ROAS) - 购物", "Purchase ROAS (return on ad spend)", "purchase roas"],
    "installs": ["应用安装量", "App installs", "app installs"],
    "subscriptions": ["订阅次数", "Subscriptions", "subscriptions"],
    "cpm": ["CPM (cost per 1,000 impressions) (USD)", "cpm (cost per 1,000 impressions) (usd)"],
    "hook_rate": ["单次展示的播放视频达 3 秒率"],
    "video_completions": ["视频播放进度达 100% 的次数"],
    "report_start": ["报告开始日期", "Reporting starts"],
    "report_end": ["报告结束日期", "Reporting ends"],
    "account": ["广告组名称", "Ad set name", "Campaign name"],
}

# xlsx 导出中的自定义指标：钩子率 / 留存率（小数）
CUSTOM_HOOK_COL = "custom_derived_metrics:334261784830934"
CUSTOM_RETENTION_COL = "custom_derived_metrics:468178872764785"

WEEK_FILE_RE = re.compile(r"周|week", re.IGNORECASE)
ROLLBACK_FILE_RE = re.compile(r"回滚|rollback", re.IGNORECASE)
NEW_DIRECTION_FILE_RE = re.compile(r"数字人|新方向|图片素材|图片数据", re.IGNORECASE)
# 周度 KPI / 上新素材：常规周度文件 + 新方向测试（如数字人）
WEEKLY_DATA_SCOPES = frozenset({"weekly", "new_direction"})

# 非我方素材，导入时永久跳过（账户全量更新亦不会带回）
EXCLUDED_MATERIAL_IDS = frozenset({
    "251231_AAA_AEO-Purchase_ios_pic_Growme_WW_周跑图组333_joy",
})


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    lower_map = {str(c).strip().lower(): c for c in df.columns}
    rename: dict[str, str] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            key = alias.lower()
            if key in lower_map:
                rename[lower_map[key]] = canonical
                break
    return df.rename(columns=rename)


def _safe_num(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").fillna(0)


CHANNEL_LABELS = {
    "T1": "T1（美国等）",
    "WW": "WW（全球）",
}


def _detect_channel(filename: str, account: str = "") -> str:
    """T1 = 美国等国家；WW = 全球。账户全量文件按广告组名称判断。"""
    account_upper = account.upper()
    if "_WW_" in account_upper or "GROWME_WW" in account_upper:
        return "WW"
    if "_T1_" in account_upper or "GROWME_T1" in account_upper:
        return "T1"
    name = filename.upper()
    if "WW" in name or "WW的数据" in filename or name.startswith("ACCOUNT_"):
        return "WW"
    if "T1" in name or "T1的数据" in filename:
        return "T1"
    return "ALL"


def _detect_data_scope(filename: str) -> str:
    """account = 账户内全量；weekly = 周度上新；rollback = 回滚素材成效。"""
    if filename.startswith("account_") or "account_all" in filename.lower():
        return "account"
    if ROLLBACK_FILE_RE.search(filename):
        return "rollback"
    if NEW_DIRECTION_FILE_RE.search(filename):
        return "new_direction"
    return "weekly"


def _should_load_row(filename: str, account: str, data_scope: str) -> bool:
    channel = _detect_channel(filename, account)
    if data_scope in ("weekly", "new_direction") and WEEKLY_WW_ONLY:
        return channel == "WW"
    if WW_ONLY:
        return channel == "WW"
    return True


def _iter_input_files() -> list[Path]:
    if not DATA_DIR.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    paths = sorted(
        p for p in DATA_DIR.iterdir() if p.suffix.lower() in {".csv", ".xlsx", ".xls"}
    )
    result: list[Path] = []
    for p in paths:
        is_account = p.name.startswith("account_") or "account_all" in p.name.lower()
        is_weekly = (
            bool(WEEK_FILE_RE.search(p.name))
            and not ROLLBACK_FILE_RE.search(p.name)
            and not NEW_DIRECTION_FILE_RE.search(p.name)
        )
        is_rollback = bool(ROLLBACK_FILE_RE.search(p.name))
        is_new_direction = bool(NEW_DIRECTION_FILE_RE.search(p.name))
        if is_weekly and WEEKLY_WW_ONLY and _detect_channel(p.name) == "T1":
            continue
        if WW_ONLY and _detect_channel(p.name) == "T1" and is_account:
            continue
        if is_account or is_weekly or is_rollback or is_new_direction:
            result.append(p)
    return result


def _detect_rollback_label(filename: str) -> str:
    m = re.search(r"([\d\-]+周)", filename)
    if m:
        return m.group(1)
    return "回滚素材"


def _first_seen_to_week_label(first_seen: str | None, weekly_labels: list[str]) -> str:
    """按素材名日期归入最近一周度 Tab。"""
    if not first_seen or len(first_seen) < 10 or not weekly_labels:
        return "未知周"
    key = int(first_seen[5:7]) * 100 + int(first_seen[8:10])
    matched = weekly_labels[0]
    for lab in weekly_labels:
        if week_sort_key(lab) <= key:
            matched = lab
    return matched


def _detect_rollback_week(first_seen: str | None, account: str, weekly_labels: list[str]) -> str:
    """从广告组 back 批次或 first_seen 推断回滚所属周。"""
    m = re.search(r"(\d{4})(\d{4})?back", account or "", re.I)
    if m and m.group(2) is None:
        batch = m.group(1)
        week = f"{batch}周"
        if len(batch) == 4 and week in weekly_labels:
            return week
    return _first_seen_to_week_label(first_seen, weekly_labels)


def _detect_week_label(filename: str) -> str:
    m = re.search(r"(\d{4})周", filename)
    if m:
        return m.group(1) + "周"
    m = re.search(r"(\d{4})week", filename, re.I)
    if m:
        return m.group(1) + "周"
    return Path(filename).stem


def week_sort_key(label: str) -> int:
    m = re.search(r"(\d{4})", label or "")
    if not m:
        return 0
    mmdd = int(m.group(1))
    month, day = divmod(mmdd, 100)
    return month * 100 + day


def get_weekly_labels() -> list[str]:
    labels = {r.get("week_label", "") for r in store.records if r.get("data_scope") == "weekly" and r.get("week_label")}
    return sorted(labels, key=week_sort_key)


# 上新素材成效：仅统计最近 N 个已导入周度 Tab（周维度更新页仍展示全部历史周）
RECENT_WEEKLY_WINDOW = 2


def get_recent_weekly_labels(n: int = RECENT_WEEKLY_WINDOW) -> list[str]:
    labels = get_weekly_labels()
    if n <= 0 or len(labels) <= n:
        return labels
    return labels[-n:]


class DataStore:
    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []
        self.files_loaded: list[str] = []
        self.last_scan_at: str | None = None

    def scan(self) -> dict[str, Any]:
        self.records = []
        self.files_loaded = []
        for path in _iter_input_files():
            try:
                if path.suffix.lower() == ".csv":
                    df = pd.read_csv(path)
                else:
                    df = pd.read_excel(path, sheet_name=0)
                self._ingest_df(df, path.name)
                self.files_loaded.append(path.name)
            except Exception as exc:  # noqa: BLE001
                print(f"[GrowMe] 跳过文件 {path.name}: {exc}")

        from datetime import datetime
        from materials_catalog import export_catalog

        self.last_scan_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        catalog = export_catalog()
        return {
            "files": self.files_loaded,
            "records": len(self.records),
            "scanned_at": self.last_scan_at,
            "catalog": catalog,
            "weekly_labels": get_weekly_labels(),
        }

    def _ingest_df(self, df: pd.DataFrame, filename: str) -> None:
        df = _normalize_columns(df)
        if "ad_name" not in df.columns:
            return

        data_scope = _detect_data_scope(filename)
        if data_scope == "rollback":
            week_label = _detect_rollback_label(filename)
        else:
            week_label = _detect_week_label(filename)

        for _, row in df.iterrows():
            ad_name = str(row.get("ad_name", "")).strip()
            if not ad_name or ad_name == "nan":
                continue
            if ad_name in EXCLUDED_MATERIAL_IDS:
                continue

            account = str(row.get("account", "") or "")
            if not _should_load_row(filename, account, data_scope):
                continue

            parsed = parse_material(ad_name, week_label=week_label)
            channel = _detect_channel(filename, account)

            if data_scope == "rollback":
                week_label = _detect_rollback_week(parsed.first_seen, account, get_weekly_labels())

            purchases = float(_safe_num(pd.Series([row.get("purchases", 0)])).iloc[0])
            spend = float(_safe_num(pd.Series([row.get("spend", 0)])).iloc[0])
            impressions = float(_safe_num(pd.Series([row.get("impressions", 0)])).iloc[0])
            ctr = float(_safe_num(pd.Series([row.get("ctr", 0)])).iloc[0])
            roas = float(_safe_num(pd.Series([row.get("roas", 0)])).iloc[0])
            installs = float(_safe_num(pd.Series([row.get("installs", 0)])).iloc[0])
            subscriptions = float(_safe_num(pd.Series([row.get("subscriptions", 0)])).iloc[0])
            hook_rate = _parse_rate(row.get("hook_rate"))
            video_completions = _parse_count(row.get("video_completions"))
            retention_rate = _parse_retention(video_completions, impressions, hook_rate)
            if hook_rate is None and CUSTOM_HOOK_COL in df.columns:
                hook_rate = _parse_rate(row.get(CUSTOM_HOOK_COL))
                retention_rate = _parse_retention(video_completions, impressions, hook_rate)
            if retention_rate is None and CUSTOM_RETENTION_COL in df.columns:
                retention_rate = _parse_rate(row.get(CUSTOM_RETENTION_COL))

            self.records.append(
                {
                    "material_id": parsed.material_id,
                    "standard_id": parsed.standard_id,
                    "first_seen": parsed.first_seen,
                    "internal_name": parsed.internal_name,
                    "language": parsed.language,
                    "size": parsed.size,
                    "direction": canonical_direction(parsed.direction),
                    "theme": primary_theme(parsed.theme) if uses_new_schema(week_label, parsed.first_seen) else canonical_theme(parsed.theme),
                    "optimization": parsed.optimization,
                    "stylization": parsed.stylization,
                    "pain_point": parsed.pain_point,
                    "exercise_type": parsed.exercise_type,
                    "r_version": parsed.r_version,
                    "c_version": parsed.c_version,
                    "m_version": parsed.m_version,
                    "designer": parsed.designer,
                    "designer_variant": parsed.designer_variant,
                    "serial_code": parsed.serial_code,
                    "parse_status": parsed.parse_status,
                    "purchases": purchases,
                    "spend": spend,
                    "impressions": impressions,
                    "ctr": ctr,
                    "roas": roas,
                    "installs": installs,
                    "subscriptions": subscriptions,
                    "hook_rate": hook_rate or 0.0,
                    "retention_rate": retention_rate or 0.0,
                    "video_completions": video_completions or 0.0,
                    "channel": channel,
                    "data_scope": data_scope,
                    "week_label": week_label,
                    "source_file": filename,
                    "has_order": purchases >= 1,
                    "scaling_status": _scaling_status(spend, purchases),
                }
            )


def _parse_rate(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num <= 0:
        return None
    return round(num * 100, 4) if num <= 1 else round(num, 4)


def _parse_count(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if num > 0 else None


def _parse_retention(
    completions: float | None,
    impressions: float,
    hook_rate: float | None,
) -> float | None:
    """持续播放率 = 完播次数 / 达 3 秒播放次数 × 100%"""
    if not completions or not hook_rate or hook_rate <= 0 or impressions <= 0:
        return None
    views_3s = impressions * hook_rate / 100
    if views_3s <= 0:
        return None
    return round(completions / views_3s * 100, 4)


def _scaling_status(spend: float, purchases: float) -> str:
    if purchases >= 5 and spend >= 50:
        return "增长期"
    if purchases < 1 and spend >= 30:
        return "炮灰"
    return "衰退期"


store = DataStore()
