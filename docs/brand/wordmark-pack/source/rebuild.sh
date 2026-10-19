#!/usr/bin/env sh
set -eu
TOKKL_PACK_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
export TOKKL_PACK_DIR
python3 "$TOKKL_PACK_DIR/source/tools/trace_wordmark.py" \
  "$TOKKL_PACK_DIR/source/tokkl-wordmark-clock-master.png" \
  "$TOKKL_PACK_DIR/svg/tokkl-wordmark-detailed.svg" \
  --colors 96 --blur .65 --tolerance .4 --min-area 3
python3 "$TOKKL_PACK_DIR/source/tools/build_clean.py"
python3 "$TOKKL_PACK_DIR/source/tools/add_detail_underlay.py"
python3 "$TOKKL_PACK_DIR/source/tools/export_pdfs.py"
node "$TOKKL_PACK_DIR/source/tools/export_pngs.js"
python3 "$TOKKL_PACK_DIR/source/tools/build_preview.py"
