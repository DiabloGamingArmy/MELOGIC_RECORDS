#!/usr/bin/env bash
# mct-origami-deep-audit-p04-native-ci
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${ORIGAMI_RT_GATE_BUILD:-$ROOT/build-tests}"

resolve_juce() {
  if [[ -n "${JUCE_DIR:-}" && -f "${JUCE_DIR}/CMakeLists.txt" && -d "${JUCE_DIR}/modules" ]]; then
    printf '%s\n' "$JUCE_DIR"
    return 0
  fi
  local candidate
  for candidate in     "$HOME/Downloads/JUCE"     "$HOME/JUCE"     "$HOME/Documents/JUCE"     "$HOME/Developer/JUCE"     "$HOME/Development/JUCE"     "/Applications/JUCE"; do
    if [[ -f "$candidate/CMakeLists.txt" && -d "$candidate/modules" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

JUCE="$(resolve_juce || true)"
if [[ -z "$JUCE" ]]; then
  echo "ERROR: no JUCE source checkout was found." >&2
  echo "Set JUCE_DIR to a JUCE checkout containing CMakeLists.txt and modules/." >&2
  exit 2
fi

echo "===== MCT ORIGAMI REALTIME GATE ====="
echo "Source: $ROOT"
echo "JUCE:   $JUCE"
echo "Build:  $BUILD"
rm -rf "$BUILD"

cmake -S "$ROOT" -B "$BUILD"   -DCMAKE_BUILD_TYPE=Release   -DORIGAMI_BUILD_PLUGIN=ON   -DORIGAMI_BUILD_TESTS=ON   -DJUCE_DIR="$JUCE"

cmake --build "$BUILD" --target origami_plugin_rt_gate --parallel
python3 "$ROOT/scripts/verify-native-ci-contract.py"

echo "===== MCT ORIGAMI REALTIME GATE PASSED ====="
