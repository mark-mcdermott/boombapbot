#!/usr/bin/env bash
# Builds the engine to WebAssembly with the pinned Emscripten.
# Output: build/wasm/boombapbot-engine-<machine>.wasm, one for each machine
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_DIR="${EMSDK_DIR:-$ROOT/.tools/emsdk}"
WANTED="$(tr -d '[:space:]' < "$ROOT/.emscripten-version")"

if ! command -v emcmake >/dev/null 2>&1; then
  if [ ! -f "$EMSDK_DIR/emsdk_env.sh" ]; then
    echo "Emscripten is not installed. Run ./scripts/setup-emsdk.sh first." >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  EMSDK_QUIET=1 source "$EMSDK_DIR/emsdk_env.sh"
fi

FOUND="$(emcc --version | head -1 | sed -E 's/.*\) ([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
if [ "$FOUND" != "$WANTED" ]; then
  echo "Emscripten $FOUND is active but .emscripten-version pins $WANTED." >&2
  echo "Run ./scripts/setup-emsdk.sh to install the pinned version." >&2
  exit 1
fi

emcmake cmake -S "$ROOT/engine" -B "$ROOT/build/wasm" -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build "$ROOT/build/wasm"
ls -l "$ROOT"/build/wasm/boombapbot-engine-*.wasm
