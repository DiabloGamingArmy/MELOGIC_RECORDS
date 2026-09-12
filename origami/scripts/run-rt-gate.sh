#!/bin/zsh
set -euo pipefail

ROOT="/Users/ginobarnes/Documents/Development/MELOGIC_RECORDS"
BUILD="$ROOT/origami/build-tests"
DEFAULT_JUCE="/Users/ginobarnes/Downloads/JUCE"
JUCE="${JUCE_DIR:-$DEFAULT_JUCE}"

if [[ ! -d "$JUCE" ]]; then
  echo "ERROR: JUCE directory does not exist: $JUCE" >&2
  echo "Set JUCE_DIR to a valid JUCE source checkout and rerun." >&2
  exit 2
fi
if [[ ! -f "$JUCE/CMakeLists.txt" || ! -d "$JUCE/modules" ]]; then
  echo "ERROR: JUCE_DIR is not a JUCE source checkout: $JUCE" >&2
  exit 2
fi

echo "===== MCT ORIGAMI REALTIME GATE ====="
echo "JUCE: $JUCE"
echo "Build: $BUILD"
rm -rf "$BUILD"

cmake -S "$ROOT/origami" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DORIGAMI_BUILD_PLUGIN=ON \
  -DORIGAMI_BUILD_TESTS=ON \
  -DJUCE_DIR="$JUCE"

cmake --build "$BUILD" --target origami_plugin_rt_gate --parallel
echo "===== MCT ORIGAMI REALTIME GATE PASSED ====="
