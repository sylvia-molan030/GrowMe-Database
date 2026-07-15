#!/usr/bin/env bash
# 账户全量数据：更新「账户内」栏目，并按素材日期刷新「上新素材成效（近2周）」
#
# 更新范围：
#   ✓ 素材黄金交叉复盘（账户内 + 上新）
#   ✓ 智能排行榜（账户内 + 上新）
#   ✓ 设计师绩效看板（账户内 + 上新）
#   ✓ 核心资产晋级库（账户内 + 上新）
#   ✗ 周维度更新页（须单独给周度文件，用 update_weekly.sh）
#
# 用法：
#   ./scripts/update_account.sh ~/Downloads/account_export.csv
#   ./scripts/update_account.sh --push ~/Downloads/Pingme_GrowMe_*.csv
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT/data_inputs"
TARGET="$DATA_DIR/account_all_WW.csv"
VENV="$ROOT/.venv"
PUSH=false
SRC=""

for arg in "$@"; do
  if [ "$arg" = "--push" ]; then
    PUSH=true
  elif [ -z "$SRC" ]; then
    SRC="$arg"
  fi
done

if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r "$ROOT/server/requirements.txt" 2>/dev/null || true
fi
source "$VENV/bin/activate"

if [ -n "$SRC" ]; then
  if [ ! -f "$SRC" ]; then
    echo "✗ 文件不存在: $SRC"
    exit 1
  fi
  echo "→ 复制账户全量 → data_inputs/account_all_WW.csv"
  cp "$SRC" "$TARGET"
  echo "  ✓ $(basename "$SRC")"
fi

if [ ! -f "$TARGET" ]; then
  echo "✗ 缺少 $TARGET，请传入全量导出 CSV"
  exit 1
fi

echo ""
echo "→ 重建静态数据（仅账户内栏目数据会变，周维度沿用 data_inputs 既有周度文件）…"
python3 "$ROOT/scripts/build_static.py"

echo ""
python3 - <<'PY'
import sys
sys.path.insert(0, "server")
from data_loader import store, get_weekly_labels
import analytics

store.scan()
f = {
    "date_start": "2020-01-01", "date_end": "2030-12-31",
    "direction": "全部", "theme": "全部", "optimization": "全部",
    "stylization": "全部", "pain_point": "全部", "exercise_type": "全部", "channel": "全部",
}
account_mats = analytics._aggregate_by_material(analytics.filter_records(f, mode="account"))
labels = get_weekly_labels()
print("── 更新结果 ──")
print(f"  账户内素材：{len(account_mats)} 条")
print(f"  周度 Tab（未改动文件）：{' · '.join(labels) or '—'}")
print("")
print("  已更新：黄金交叉 / 排行榜 / 设计师 / 资产库（账户内 + 上新·全量近2周）")
print("  未更新：周维度更新页（请用 ./scripts/update_weekly.sh 导入周度文件）")
PY

if [ "$PUSH" = true ]; then
  echo ""
  echo "→ 推送到 GitHub Pages …"
  cd "$ROOT"
  git add data_inputs/account_all_WW.csv docs/data/ data_outputs/ 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "没有可提交的变更。"
  else
    git commit -m "更新账户全量数据：$(date +%Y-%m-%d)"
    git push origin main
    echo "✓ 已推送"
  fi
fi

echo ""
echo "本地预览: cd $ROOT && ./start.sh → http://localhost:8000/"
