#!/usr/bin/env bash
# 本地构建静态数据并推送到 GitHub，触发 Pages 自动部署
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VENV="$ROOT/.venv"
if [ ! -d "$VENV" ]; then
  if [ -d "$ROOT/../.venv" ]; then VENV="$ROOT/../.venv"; else python3 -m venv "$VENV"; fi
fi
source "$VENV/bin/activate"
pip install -q pandas openpyxl

python scripts/build_static.py

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "请先初始化 git: git init && git remote add origin <你的仓库>"
  exit 1
fi

git add data_inputs/ docs/data/snapshot.json docs/ server/ scripts/
git status
echo ""
echo "确认后执行: git commit -m '更新 GrowMe 数据' && git push"
echo "推送后请到 GitHub → Settings → Pages → main 分支 /docs 文件夹"
echo "部署地址: https://sylvia-molan030.github.io/GrowMe-Database/"
