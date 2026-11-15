#!/usr/bin/env bash
# Installs the pinned Emscripten SDK into .tools/emsdk (gitignored).
# The version comes from .emscripten-version so local setup and CI agree.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/.emscripten-version")"
EMSDK_DIR="${EMSDK_DIR:-$ROOT/.tools/emsdk}"

if [ ! -d "$EMSDK_DIR/.git" ]; then
  mkdir -p "$(dirname "$EMSDK_DIR")"
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
else
  git -C "$EMSDK_DIR" pull --ff-only --depth 1 || true
fi

"$EMSDK_DIR/emsdk" install "$VERSION"
"$EMSDK_DIR/emsdk" activate "$VERSION"

# shellcheck disable=SC1091
EMSDK_QUIET=1 source "$EMSDK_DIR/emsdk_env.sh"
emcc --version | head -1
echo "Emscripten $VERSION is ready in $EMSDK_DIR"
