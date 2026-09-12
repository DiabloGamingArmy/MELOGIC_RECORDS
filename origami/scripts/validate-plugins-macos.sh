#!/usr/bin/env bash
# mct-origami-deep-audit-p04-native-ci
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: macOS plugin validation requires Darwin (auval)." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${ORIGAMI_PLUGIN_VALIDATION_BUILD:-$ROOT/build-plugin-validation}"
PLUGINVAL_VERSION="${PLUGINVAL_VERSION:-v1.0.4}"
PLUGINVAL_STRICTNESS="${PLUGINVAL_STRICTNESS:-5}"

if [[ -z "${JUCE_DIR:-}" || ! -f "${JUCE_DIR}/CMakeLists.txt" || ! -d "${JUCE_DIR}/modules" ]]; then
  echo "ERROR: JUCE_DIR must point to a JUCE source checkout." >&2
  exit 2
fi

rm -rf "$BUILD"

cmake -S "$ROOT" -B "$BUILD"   -DCMAKE_BUILD_TYPE=Release   -DORIGAMI_BUILD_PLUGIN=ON   -DORIGAMI_BUILD_TESTS=OFF   -DJUCE_DIR="$JUCE_DIR"

cmake --build "$BUILD" --config Release --parallel

ARTEFACTS="$BUILD/OrigamiPlugin_artefacts/Release"
VST3="$ARTEFACTS/VST3/MCT Origami.vst3"
AU="$ARTEFACTS/AU/MCT Origami.component"
APP="$ARTEFACTS/Standalone/MCT Origami.app"

for artifact in "$VST3" "$AU" "$APP"; do
  [[ -e "$artifact" ]] || { echo "ERROR: missing artifact: $artifact" >&2; exit 3; }
done

APP_BIN="$(find "$APP/Contents/MacOS" -maxdepth 1 -type f -perm -111 -print -quit)"
[[ -n "$APP_BIN" ]] || { echo "ERROR: no standalone executable found." >&2; exit 4; }
file "$APP_BIN"
otool -L "$APP_BIN" >/dev/null

AU_INSTALL="$HOME/Library/Audio/Plug-Ins/Components"
mkdir -p "$AU_INSTALL"
rm -rf "$AU_INSTALL/MCT Origami.component"
cp -R "$AU" "$AU_INSTALL/MCT Origami.component"
killall -9 AudioComponentRegistrar 2>/dev/null || true
sleep 2
auval -v aumu Orig Mctg

if [[ -n "${PLUGINVAL_BIN:-}" ]]; then
  VALIDATOR="$PLUGINVAL_BIN"
else
  TEMP="$(mktemp -d)"
  trap 'rm -rf "$TEMP"' EXIT
  ARCHIVE="$TEMP/pluginval_macOS.zip"
  URL="https://github.com/Tracktion/pluginval/releases/download/${PLUGINVAL_VERSION}/pluginval_macOS.zip"
  curl --fail --location --retry 3 "$URL" -o "$ARCHIVE"
  ditto -x -k "$ARCHIVE" "$TEMP/pluginval"
  VALIDATOR="$(find "$TEMP/pluginval" -type f \( -path '*/pluginval.app/Contents/MacOS/pluginval' -o -name pluginval \) -print -quit)"
  [[ -n "$VALIDATOR" ]] || { echo "ERROR: pluginval executable not found." >&2; exit 5; }
  chmod +x "$VALIDATOR"
fi

"$VALIDATOR" --strictness-level "$PLUGINVAL_STRICTNESS" --verbose --validate "$VST3"

echo "===== MCT ORIGAMI PLUGIN VALIDATION PASSED ====="
