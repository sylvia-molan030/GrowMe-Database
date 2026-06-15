#!/usr/bin/env bash
# 每周上新：一键更新「周维度更新」+ 各栏目「上新素材成效」+ 线上网站
#
# 用法：
#   ./scripts/update_weekly.sh                          # 仅重建（data_inputs 里已有文件）
#   ./scripts/update_weekly.sh ~/Downloads/0615周*.csv  # 复制新文件后重建
#   ./scripts/update_weekly.sh --push file1.csv file2.csv  # 复制 + 重建 + 推送 GitHub
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT/data_inputs"
VENV="$ROOT/.venv"
PUSH=false
FILES=()

for arg in "$@"; do
  if [ "$arg" = "--push" ]; then
    PUSH=true
  else
    FILES+=("$arg")
  fi
done

if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q pandas openpyxl fastapi uvicorn 2>/dev/null || true
fi
source "$VENV/bin/activate"

if [ ${#FILES[@]} -gt 0 ]; then
  echo "→ 复制周度文件到 data_inputs/ ..."
  mkdir -p "$DATA_DIR"
  for src in "${FILES[@]}"; do
    if [ ! -f "$src" ]; then
      echo "✗ 文件不存在: $src"
      exit 1
    fi
    base="$(basename "$src")"
    if ! echo "$base" | grep -qiE '周|week'; then
      echo "✗ 文件名须含「周」或「week」，例如 0615周WW的数据.csv"
      echo "  当前: $base"
      exit 1
    fi
    if echo "$base" | grep -qiE 'T1'; then
      echo "✗ 周度上新不测 T1，请只导入 WW 文件: $base"
      exit 1
    fi
    cp "$src" "$DATA_DIR/$base"
    echo "  ✓ $base"
  done
fi

echo ""
echo "→ 扫描 data_inputs，更新周维度 + 上新素材成效 ..."
python3 "$ROOT/scripts/build_static.py"

echo ""
python3 - <<'PY'
import sys
sys.path.insert(0, "server")
from data_loader import store, get_weekly_labels
from weekly_report import get_weekly_report
import analytics

store.scan()
labels = get_weekly_labels()
f = {
    "date_start": "2020-01-01", "date_end": "2030-12-31",
    "direction": "全部", "theme": "全部", "optimization": "全部",
    "stylization": "全部", "pain_point": "全部", "exercise_type": "全部", "channel": "全部",
}
weekly_mats = analytics._aggregate_by_material(analytics.filter_records(f, mode="new"))
print("── 更新结果 ──")
print(f"  周度 Tab：{' · '.join(labels)}")
print(f"  上新素材成效（各栏目 mode=上新）：{len(weekly_mats)} 条素材（含全部已导入周）")
if labels:
    latest = labels[-1]
    r = get_weekly_report(latest)["report"]
    if r:
        print(f"  最新周 {latest}：{r['kpi']['total_materials']} 条 · 出单率 {r['kpi']['order_rate']}%")
print("")
print("  已更新：周维度更新 / 黄金交叉·上新 / 排行榜·上新 / 设计师·上新 / 资产库·上新")
PY

if [ "$PUSH" = true ]; then
  echo "→ 推送到 GitHub Pages ..."
  cd "$ROOT"
  git add data_inputs/ docs/data/ docs/assets/ 2>/dev/null || true
  git add docs/ data_inputs/ 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "没有可提交的变更。"
  else
    git commit -m "更新周度数据：$(date +%Y-%m-%d)"
    git push origin main
    echo "✓ 已推送，约 1 分钟后刷新线上"
  fi
fi

echo ""
echo "本地预览: cd $ROOT && ./start.sh → http://localhost:8000/"
echo "线上地址: https://sylvia-molan030.github.io/GrowMe-Database/"
if [ "$PUSH" != true ]; then
  echo ""
  echo "同步线上请执行: ./scripts/update_weekly.sh --push"
fi
