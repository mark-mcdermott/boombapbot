#!/usr/bin/env bash
# Builds the engine for one machine for iOS with the repository's own CMake,
# for a phone and for the simulator, and puts the two together as an
# XCFramework that a Swift package can link, with the C ABI's header and a
# module map so Swift can import it.
#
#   scripts/build-engine-ios.sh <machine> <output.xcframework>
#
# Needs Xcode. Intermediate builds go in build/ios.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <machine> <output.xcframework>" >&2
  exit 2
fi
MACHINE="$1"
OUTPUT="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACHINE_DIR="$ROOT/packages/machine-$MACHINE"
LIBRARY="libboombapbot_engine_$MACHINE.a"
# The phone app's lowest iOS, in apps/mobile/ios/App/App.xcodeproj.
DEPLOYMENT_TARGET=15.0

if [ ! -f "$MACHINE_DIR/engine/CMakeLists.txt" ]; then
  echo "There is no machine called $MACHINE: $MACHINE_DIR/engine/CMakeLists.txt is missing." >&2
  exit 1
fi

build() {
  local sdk="$1" architectures="$2" dir="$ROOT/build/ios/$1"
  # A library only: an iOS executable needs signing, so CMake checks the compiler with a library too.
  cmake -S "$ROOT/engine" -B "$dir" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_SYSTEM_NAME=iOS \
    -DCMAKE_OSX_SYSROOT="$sdk" \
    -DCMAKE_OSX_ARCHITECTURES="$architectures" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$DEPLOYMENT_TARGET" \
    -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
    -DSNARE_BUILD_TESTS=OFF \
    -DSNARE_BUILD_TOOLS=OFF \
    -DBOOMBAPBOT_MACHINE_DIRS="$MACHINE_DIR" >/dev/null
  cmake --build "$dir" --target "boombapbot_engine_$MACHINE"
  echo "$dir/machines/machine-$MACHINE/$LIBRARY"
}

PHONE="$(build iphoneos arm64 | tail -1)"
SIMULATOR="$(build iphonesimulator "arm64;x86_64" | tail -1)"

HEADERS="$ROOT/build/ios/headers"
rm -rf "$HEADERS"
mkdir -p "$HEADERS/boombapbot"
cp "$ROOT/engine/include/boombapbot/engine.h" "$HEADERS/boombapbot/"
cat > "$HEADERS/module.modulemap" <<'MODULE'
module BoombapbotEngine {
  header "boombapbot/engine.h"
  export *
}
MODULE

rm -rf "$OUTPUT"
xcodebuild -create-xcframework \
  -library "$PHONE" -headers "$HEADERS" \
  -library "$SIMULATOR" -headers "$HEADERS" \
  -output "$OUTPUT" >/dev/null
echo "Built $OUTPUT for $MACHINE"
