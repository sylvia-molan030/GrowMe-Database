#!/usr/bin/env bash
# 把本地 data_inputs 数据同步到 GitHub 线上网站
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ 扫描 data_inputs 并生成 docs/data/snapshot.json ..."
python3 scripts/build_static.py

echo ""
echo "→ 准备提交 ..."
git add data_inputs/ docs/ scripts/
git status --short

if git diff --cached --quiet; then
  echo "没有可提交的变更。"
  exit 0
fi

git commit -m "更新 GrowMe 数据与线上快照"
git push origin main
echo ""
echo "推送后约 1 分钟刷新：https://sylvia-molan030.github.io/GrowMe-Database/"
