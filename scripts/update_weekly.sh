#!/usr/bin/env bash
# 周度上新：仅在你提供周度文件时更新「周维度更新」+ 上新成效 + 回滚素材
#
# 更新范围：
#   ✓ 周维度更新
#   ✓ 回滚素材（最新周「可回滚推荐」自动重算；历史回滚 CSV 可一并导入）
#   ✓ 黄金交叉 / 排行榜 / 设计师 / 资产库 →「上新素材成效」
#   ✗ 账户内栏目（须用 update_account.sh 导入 account_all_WW.csv）
#
# 用法：
#   ./scripts/update_weekly.sh                                    # 仅重建
#   ./scripts/update_weekly.sh ~/Downloads/0615周WW的数据.csv    # 周度 WW
#   ./scripts/update_weekly.sh ~/Downloads/0615周WW.csv ~/Downloads/0608-0615周回滚素材.csv
#   ./scripts/update_weekly.sh --push file1.csv file2.csv
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
    if ! echo "$base" | grep -qiE '周|week|回滚|rollback|老形式|新形式|新创意|图片素材|数字人|高价值用户|英语'; then
      echo "✗ 文件名须含「周」「week」「回滚」「老形式」「新形式」「图片素材」「高价值用户」或「英语」等关键词"
      echo "  当前: $base"
      exit 1
    fi
    if echo "$base" | grep -qiE 'T1'; then
      echo "✗ 周度上新不测 T1，请只导入 WW 文件: $base"
      exit 1
    fi
    # 规范为「MMDD周…」以便 week_label 识别（如 0706老形式素材.csv → 0706周老形式素材.csv）
    dest="$base"
    if echo "$base" | grep -qE '^[0-9]{4}' && ! echo "$base" | grep -qE '^[0-9]{4}周'; then
      dest="$(echo "$base" | sed -E 's/^([0-9]{4})/\1周/')"
    fi
    cp "$src" "$DATA_DIR/$dest"
    if [ "$dest" != "$base" ]; then
      echo "  ✓ $base → $dest"
    else
      echo "  ✓ $dest"
    fi
  done
fi

echo ""
echo "→ 扫描 data_inputs，更新周维度 + 上新成效 + 回滚素材 ..."
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
print(f"  上新素材成效（各栏目 mode=上新）：{len(weekly_mats)} 条素材（最近 2 周）")
if labels:
    latest = labels[-1]
    r = get_weekly_report(latest)["report"]
    if r:
        print(f"  最新周 {latest}：{r['kpi']['total_materials']} 条 · 出单率 {r['kpi']['order_rate']}%")
print("")
print("  已更新：周维度更新 / 黄金交叉·上新 / 排行榜·上新 / 设计师·上新 / 资产库·上新")
print("  未更新：账户内栏目（请用 ./scripts/update_account.sh）")
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
echo "线上（任选）："
echo "  Cloudflare: https://growme-database.pages.dev （推荐，见 上线指南.md）"
echo "  Netlify:    https://growme-database.netlify.app"
echo "  GitHub:     https://sylvia-molan030.github.io/GrowMe-Database/"
if [ "$PUSH" != true ]; then
  echo ""
  echo "同步线上请执行: ./scripts/update_weekly.sh --push"
fi
