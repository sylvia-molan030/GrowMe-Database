#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

VENV="$ROOT/.venv"
if [ ! -d "$VENV" ]; then
  if [ -d "$ROOT/../.venv" ]; then
    VENV="$ROOT/../.venv"
  else
    python3 -m venv "$VENV"
  fi
fi
source "$VENV/bin/activate"
pip install -q -r server/requirements.txt
cd server && python main.py
