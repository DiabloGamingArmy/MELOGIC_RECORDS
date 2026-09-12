#!/usr/bin/env bash
# mct-origami-deep-audit-p04-native-ci
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${ORIGAMI_SANITIZER_BUILD:-$ROOT/build-sanitizers}"

if [[ -z "${JUCE_DIR:-}" || ! -f "${JUCE_DIR}/CMakeLists.txt" || ! -d "${JUCE_DIR}/modules" ]]; then
  echo "ERROR: JUCE_DIR must point to a JUCE source checkout for sanitizer builds." >&2
  exit 2
fi

echo "===== MCT ORIGAMI ASAN + UBSAN GATE ====="
rm -rf "$BUILD"

cmake -S "$ROOT" -B "$BUILD"   -DCMAKE_BUILD_TYPE=Debug   -DORIGAMI_BUILD_PLUGIN=ON   -DORIGAMI_BUILD_TESTS=ON   -DORIGAMI_SANITIZE=ON   -DJUCE_DIR="$JUCE_DIR"

cmake --build "$BUILD" --parallel

export ASAN_OPTIONS="${ASAN_OPTIONS:-halt_on_error=1:abort_on_error=1}"
export UBSAN_OPTIONS="${UBSAN_OPTIONS:-halt_on_error=1:print_stacktrace=1}"

ctest --test-dir "$BUILD" --output-on-failure --timeout 180
echo "===== MCT ORIGAMI ASAN + UBSAN GATE PASSED ====="
