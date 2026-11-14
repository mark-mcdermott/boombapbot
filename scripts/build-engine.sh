#!/usr/bin/env bash
# Builds the native engine, its tests and the boombapbot-render tool, then runs
# CTest. Output: build/native
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cmake -S "$ROOT/engine" -B "$ROOT/build/native" -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build "$ROOT/build/native"
ctest --test-dir "$ROOT/build/native" --output-on-failure
