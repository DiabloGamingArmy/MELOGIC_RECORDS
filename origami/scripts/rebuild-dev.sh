#!/bin/zsh
set -euo pipefail

ROOT="/Users/ginobarnes/Documents/Development/MELOGIC_RECORDS"
BUILD="$ROOT/origami/build-multihost"
JUCE="/Users/ginobarnes/Downloads/JUCE"
APP_BUILD="$BUILD/OrigamiPlugin_artefacts/Release/Standalone/MCT Origami.app"
APP_INSTALL="/Applications/MCT Origami.app"
AU_BUILD="$BUILD/OrigamiPlugin_artefacts/Release/AU/MCT Origami.component"
VST3_BUILD="$BUILD/OrigamiPlugin_artefacts/Release/VST3/MCT Origami.vst3"

cd "$ROOT"

cmake -S origami -B "$BUILD"   -DCMAKE_BUILD_TYPE=Release   -DORIGAMI_BUILD_TESTS=OFF   -DORIGAMI_BUILD_VST3=ON   -DJUCE_DIR="$JUCE"

cmake --build "$BUILD" --parallel

test -d "$APP_BUILD"
test -d "$AU_BUILD"
test -d "$VST3_BUILD"

mkdir -p "$HOME/Library/Audio/Plug-Ins/Components" "$HOME/Library/Audio/Plug-Ins/VST3"

killall "MCT Origami" 2>/dev/null || true
rm -rf "$APP_INSTALL"
cp -R "$APP_BUILD" "$APP_INSTALL"

rm -rf "$HOME/Library/Audio/Plug-Ins/Components/MCT Origami.component"
cp -R "$AU_BUILD" "$HOME/Library/Audio/Plug-Ins/Components/MCT Origami.component"

rm -rf "$HOME/Library/Audio/Plug-Ins/VST3/MCT Origami.vst3"
cp -R "$VST3_BUILD" "$HOME/Library/Audio/Plug-Ins/VST3/MCT Origami.vst3"

killall -9 AudioComponentRegistrar 2>/dev/null || true

echo "===== MCT ORIGAMI DEV BUILD DEPLOYED ====="
echo "Standalone: $APP_INSTALL"
echo "AU: $HOME/Library/Audio/Plug-Ins/Components/MCT Origami.component"
echo "VST3: $HOME/Library/Audio/Plug-Ins/VST3/MCT Origami.vst3"

open "$APP_INSTALL"
