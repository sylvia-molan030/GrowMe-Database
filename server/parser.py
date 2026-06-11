"""从广告名称解析素材维度字段。

标准命名规律：
{年月日}_{内部名}_{语言}_{尺寸}_FX-{方向}_ZT-{主题}_LVL1{优化点}_RS-P1X1R3C1M3_{设计师名}

历史素材可能缺少 LVL1 或 M 段，解析器会兼容。
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any


@dataclass
class ParsedMaterial:
    material_id: str
    standard_id: str
    first_seen: str | None
    internal_name: str
    language: str
    size: str
    direction: str
    theme: str
    optimization: str
    stylization: str
    pain_point: str
    exercise_type: str
    r_version: str
    c_version: str
    m_version: str
    designer: str
    designer_variant: str
    serial_code: str
    parse_status: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


DATE_RE = re.compile(r"^(\d{8})")
RS_SEGMENT_RE = re.compile(
    r"_RS-(P\d+X\d+R\d+C\d+(?:M\d+)?)(?:_(.*))?$",
    re.IGNORECASE,
)
RS_DETAIL_RE = re.compile(
    r"^P(\d+)X(\d+)R(\d+)C(\d+)(?:M(\d+))?$",
    re.IGNORECASE,
)
LVL_RE = re.compile(r"_LVL1([^_]+)", re.IGNORECASE)
FX_RE = re.compile(r"_FX-(.+?)(?=_ZT-?|_LVL1|_RS-|$)", re.IGNORECASE)
ZT_RE = re.compile(r"_ZT-?(.+?)(?=_LVL1|_RS-|$)", re.IGNORECASE)
LEGACY_RE = re.compile(
    r"^(\d{8})_([^_]+)_(\d+x\d+)_(.+)_([a-z][a-z0-9]*)_(P\d+X\d+R\d+C\d+(?:M\d+)?)$",
    re.IGNORECASE,
)
SIZE_RE = re.compile(r"^\d+x\d+$", re.IGNORECASE)
LANG_RE = re.compile(r"^[A-Za-z]{2}$")
RMG_RE = re.compile(r"RMG-([A-Z0-9]+)", re.IGNORECASE)

# 设计师：gy / wxx / fj / jql / 095KB / pingme / jpl（jql 独立统计，不归入 fj）
DESIGNER_CANONICAL = ("gy", "wxx", "fj", "jql", "095KB", "pingme", "jpl")


def normalize_designer(raw: str, material_id: str = "") -> str:
    key = (raw or "").strip()
    low = key.lower()
    mid = (material_id or "").lower()

    # jql 优先：素材名含 jql 则单独计入 jql，不算到 fj 或其他设计师
    if low == "jql" or "_jql" in mid:
        return "jql"

    if low in ("gy", "gy.video", "gy.jpg"):
        return "gy"
    if low in ("fj",) or key == "FJ":
        return "fj"
    if low == "wxx":
        return "wxx"
    if low == "jpl":
        return "jpl"
    if low == "pingme" or "pingme" in mid:
        return "pingme"
    if low == "zh" or key == "ZH" or low.startswith("095kb") or "095kb" in low:
        return "095KB"
    if RMG_RE.search(key):
        return "095KB"
    return "其他"


def parse_first_seen(name: str) -> str | None:
    m = DATE_RE.match(name.strip())
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y%m%d").strftime("%Y-%m-%d")
    except ValueError:
        return None


def _parse_header(header: str) -> tuple[str, str, str, str]:
    """解析 FX 之前的头部：日期_内部名_语言_尺寸。"""
    parts = header.split("_")
    if not parts:
        return "", "", "", ""

    internal = ""
    language = ""
    size = ""

    size_idx = next((i for i, p in enumerate(parts) if SIZE_RE.match(p)), None)
    if size_idx is not None and size_idx >= 2:
        size = parts[size_idx]
        language = parts[size_idx - 1]
        internal = "_".join(parts[1:size_idx - 1])
    elif len(parts) >= 4:
        internal = parts[1]
        language = parts[2]
        size = parts[3]

    return internal.strip(), language.strip().upper(), size.strip(), internal


def _parse_designer(tail: str) -> tuple[str, str, str]:
    """解析 RS 段之后的设计师信息。"""
    if not tail:
        return "未知", "", ""

    if RMG_RE.search(tail):
        serial = RMG_RE.search(tail).group(1)  # type: ignore[union-attr]
        designer = "ZH" if "ZH" in tail.upper() else tail.split("_")[0]
        return designer, "", f"RMG-{serial}"

    parts = [p.strip() for p in tail.split("_") if p.strip()]
    if any(p.lower() == "jql" for p in parts):
        return "jql", "", ""

    designer = parts[0]
    variant = "_".join(parts[1:]).strip() if len(parts) > 1 else ""
    return designer or "未知", variant, ""


def _build_standard_id(
    first_seen: str | None,
    internal_name: str,
    language: str,
    size: str,
    direction: str,
    theme: str,
    optimization: str,
    rs_code: str,
    designer: str,
    designer_variant: str,
) -> str:
    date_part = (first_seen or "").replace("-", "") or "00000000"
    internal = internal_name or "GrowMe"
    lang = language or "EN"
    dim = size or "9x16"
    opt = f"_LVL1{optimization}" if optimization else ""
    variant = f"_{designer_variant}" if designer_variant else ""
    return (
        f"{date_part}_{internal}_{lang}_{dim}"
        f"_FX-{direction}_ZT-{theme}{opt}"
        f"_RS-{rs_code}_{designer}{variant}"
    )


def _apply_rs_detail(
    rs_code: str,
) -> tuple[str, str, str, str, str, str]:
    unknown = "未知"
    pain_point = unknown
    exercise_type = unknown
    r_version = unknown
    c_version = unknown
    m_version = ""
    detail = RS_DETAIL_RE.match(rs_code)
    if detail:
        pain_point = f"P{detail.group(1)}"
        exercise_type = f"X{detail.group(2)}"
        r_version = f"R{detail.group(3)}"
        c_version = f"C{detail.group(4)}"
        m_version = f"M{detail.group(5)}" if detail.group(5) else ""
    return pain_point, exercise_type, r_version, c_version, m_version, rs_code


def _parse_legacy(raw: str) -> ParsedMaterial | None:
    m = LEGACY_RE.match(raw)
    if not m:
        return None

    date_raw, internal, size, label, designer, rs_code = m.groups()
    first_seen = parse_first_seen(date_raw)
    rs_code = rs_code.upper()
    pain_point, exercise_type, r_version, c_version, m_version, stylization = _apply_rs_detail(rs_code)

    designer = normalize_designer(designer, raw)

    return ParsedMaterial(
        material_id=raw,
        standard_id=raw,
        first_seen=first_seen,
        internal_name=internal,
        language="EN",
        size=size,
        direction=label,
        theme=label,
        optimization="",
        stylization=stylization,
        pain_point=pain_point,
        exercise_type=exercise_type,
        r_version=r_version,
        c_version=c_version,
        m_version=m_version,
        designer=designer,
        designer_variant="",
        serial_code="",
        parse_status="partial",
    )


def parse_material(name: str) -> ParsedMaterial:
    raw = (name or "").strip()
    legacy = _parse_legacy(raw)
    if legacy:
        return legacy

    unknown = "未知"

    direction = unknown
    theme = unknown
    optimization = ""
    rs_code = unknown
    pain_point = unknown
    exercise_type = unknown
    r_version = unknown
    c_version = unknown
    m_version = unknown
    designer = unknown
    designer_variant = ""
    serial_code = ""
    internal_name = ""
    language = ""
    size = ""
    parse_status = "partial"

    rs_match = RS_SEGMENT_RE.search(raw)
    if rs_match:
        rs_code = rs_match.group(1).upper()
        designer, designer_variant, serial_code = _parse_designer(rs_match.group(2) or "")
        body = raw[: rs_match.start()]
    else:
        body = raw

    zt = ZT_RE.search(body)
    if zt:
        theme = zt.group(1).strip()

    fx = FX_RE.search(body)
    if fx:
        direction = fx.group(1).strip()
        header = body[: fx.start()]
    else:
        header = body

    lvl = LVL_RE.search(body)
    if lvl:
        optimization = lvl.group(1).strip()

    internal_name, language, size, _ = _parse_header(header.lstrip("_"))

    if rs_code != unknown:
        pain_point, exercise_type, r_version, c_version, m_version, rs_code = _apply_rs_detail(rs_code)

    first_seen = parse_first_seen(raw)
    standard_id = _build_standard_id(
        first_seen,
        internal_name,
        language,
        size,
        direction,
        theme,
        optimization,
        rs_code if rs_code != unknown else "",
        designer,
        designer_variant,
    )

    required = [direction, theme, designer, rs_code]
    if all(v != unknown for v in required):
        parse_status = "complete"
    elif any(v != unknown for v in required):
        parse_status = "partial"

    designer = normalize_designer(designer, raw)

    return ParsedMaterial(
        material_id=raw,
        standard_id=standard_id,
        first_seen=first_seen,
        internal_name=internal_name or unknown,
        language=language or unknown,
        size=size or unknown,
        direction=direction,
        theme=theme,
        optimization=optimization,
        stylization=rs_code,
        pain_point=pain_point,
        exercise_type=exercise_type,
        r_version=r_version,
        c_version=c_version,
        m_version=m_version,
        designer=designer,
        designer_variant=designer_variant,
        serial_code=serial_code,
        parse_status=parse_status,
    )
