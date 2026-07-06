"""网页上传：识别账户全量 / 周度 / 回滚文件并写入 data_inputs。"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from data_loader import DATA_DIR

ALLOWED_SUFFIX = {".csv", ".xlsx", ".xls"}
ACCOUNT_NAME_RE = re.compile(r"account_all|account_|Pingme_GrowMe|GrowMe.*IOS", re.IGNORECASE)
WEEK_RE = re.compile(r"周|week", re.IGNORECASE)
ROLLBACK_RE = re.compile(r"回滚|rollback", re.IGNORECASE)
NEW_DIRECTION_RE = re.compile(r"数字人|新方向|图片素材|图片数据", re.IGNORECASE)
T1_RE = re.compile(r"T1", re.IGNORECASE)

KIND_LABELS = {
    "account": "账户全量（更新账户内 4 个栏目）",
    "weekly": "周度上新（更新周维度 + 上新成效 + 可回滚推荐）",
    "rollback": "历史回滚素材",
    "new_direction": "新方向测试（数字人 / 图片素材等）",
}


def _safe_name(filename: str) -> str:
    name = Path(filename).name
    if not name or name.startswith(".") or ".." in name:
        raise ValueError(f"非法文件名: {filename}")
    if Path(name).suffix.lower() not in ALLOWED_SUFFIX:
        raise ValueError(f"仅支持 CSV / Excel: {name}")
    return name


def classify_upload(filename: str) -> str:
    name = _safe_name(filename)
    if ROLLBACK_RE.search(name):
        return "rollback"
    if NEW_DIRECTION_RE.search(name):
        return "new_direction"
    if name.startswith("account_") or "account_all" in name.lower() or ACCOUNT_NAME_RE.search(name):
        return "account"
    if WEEK_RE.search(name):
        if T1_RE.search(name):
            raise ValueError(f"周度上新不测 T1: {name}")
        return "weekly"
    raise ValueError(
        f"无法识别文件类型: {name}\n"
        "请使用账户全量 CSV、*周WW的数据.csv、*回滚素材.csv 或 *数字人.csv"
    )


def target_filename(filename: str, kind: str) -> str:
    if kind == "account":
        return "account_all_WW.csv"
    return _safe_name(filename)


def save_upload(filename: str, content: bytes) -> dict[str, Any]:
    kind = classify_upload(filename)
    target = target_filename(filename, kind)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    dest = DATA_DIR / target
    dest.write_bytes(content)
    return {
        "original_name": _safe_name(filename),
        "saved_as": target,
        "kind": kind,
        "label": KIND_LABELS.get(kind, kind),
    }
