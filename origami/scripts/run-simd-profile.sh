#!/usr/bin/env bash
# mct-origami-audio-reengineer-p18-simd-profiling
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="${ORIGAMI_SIMD_PROFILE_BUILD_ROOT:-$ROOT/build-simd-profile}"
JOBS="${ORIGAMI_BUILD_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"

echo "===== MCT ORIGAMI SIMD / VECTORIZATION PROFILE ====="
echo "Source: $ROOT"
echo "Build root: $BUILD_ROOT"
echo

build_and_run() {
  local name="$1"
  shift
  local dir="$BUILD_ROOT/$name"
  rm -rf "$dir"
  cmake -S "$ROOT" -B "$dir"     -DCMAKE_BUILD_TYPE=Release     -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON     -DORIGAMI_BUILD_TESTS=OFF     -DORIGAMI_BUILD_PLUGIN=OFF     -DORIGAMI_BUILD_DSP_PROFILE=ON     "$@"
  cmake --build "$dir" --config Release --target origami_dsp_profile -j "$JOBS"
  echo
  echo "----- $name -----"
  "$dir/origami_dsp_profile" | tee "$dir/results.txt"
  echo
}

build_and_run baseline
build_and_run no_autovec -DORIGAMI_DISABLE_AUTOVECTORIZATION=ON

REPORT_DIR="$BUILD_ROOT/vector_reports"
rm -rf "$REPORT_DIR"
cmake -S "$ROOT" -B "$REPORT_DIR"   -DCMAKE_BUILD_TYPE=Release   -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON   -DORIGAMI_BUILD_TESTS=OFF   -DORIGAMI_BUILD_PLUGIN=OFF   -DORIGAMI_BUILD_DSP_PROFILE=ON   -DORIGAMI_VECTOR_REPORTS=ON

echo "===== COMPILER VECTORIZATION DIAGNOSTICS ====="
set +e
cmake --build "$REPORT_DIR" --config Release --target origami_dsp_profile -j "$JOBS"   2>&1 | tee "$REPORT_DIR/vectorization-report.txt"
status=${PIPESTATUS[0]}
set -e
if [[ $status -ne 0 ]]; then
  exit "$status"
fi

echo
echo "Profile complete."
echo "Baseline:      $BUILD_ROOT/baseline/results.txt"
echo "No autovec:    $BUILD_ROOT/no_autovec/results.txt"
echo "Compiler map:  $REPORT_DIR/vectorization-report.txt"
