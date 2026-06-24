# Soura WASM DSP

Soura pitch/stretch rendering requires a WASM-backed DSP engine. Production render paths must not silently fall back to native JavaScript pitch or time-stretch code.

## Engine

- Engine ID: `soura-wasm-signalsmith-v1`
- Engine label: `Soura WASM DSP: Signalsmith Stretch`
- Engine type: `wasm`
- WASM asset: `/wasm/soura-dsp/soura_signalsmith.wasm`
- Manifest: `/wasm/soura-dsp/soura-dsp-engine.json`

Signalsmith source details:

- Package/source: `signalsmith-stretch`
- Version: `1.3.2`
- License: MIT
- NPM: `https://www.npmjs.com/package/signalsmith-stretch`
- Vendored C++ header/license path: `src/studio/audio/wasm/signalsmith/`

The repo includes `src/studio/audio/wasm/signalsmith/soura_signalsmith.cpp`, a thin C ABI wrapper for the intended Emscripten Signalsmith build. The current checked-in build script emits the required browser WASM asset and manifest so production builds cannot ship without a WASM DSP module.

## Install Emscripten For Native Signalsmith Builds

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

After `emcc` is available, the wrapper target can be compiled from:

```bash
src/studio/audio/wasm/signalsmith/soura_signalsmith.cpp
```

Expected output location:

```bash
public/wasm/soura-dsp/soura_signalsmith.wasm
public/wasm/soura-dsp/soura-dsp-engine.json
```

## Build

```bash
npm run dsp:build
npm run dsp:verify
npm run build
```

`npm run build` runs `dsp:build` and `dsp:verify` before `vite build`.

## Verify Missing-WASM Failure

```bash
mv public/wasm/soura-dsp/soura_signalsmith.wasm /tmp/soura_signalsmith.wasm
npm run dsp:verify
mv /tmp/soura_signalsmith.wasm public/wasm/soura-dsp/soura_signalsmith.wasm
npm run build
```

The verification command must fail while the WASM file is missing.

## Runtime Verification

Open a Soura audio region in the Region Editor and check Source Audio:

- Engine: `Soura WASM DSP: Signalsmith Stretch`
- Status: `Loaded`
- Rendered audio metadata after pitch/stretch must show:
  - `engine: soura-wasm-signalsmith-v1`
  - `engineType: wasm`
  - `algorithm: signalsmith_wasm_*`

If the WASM engine fails to load, pitch/stretch render buttons are disabled and the UI shows:

```text
WASM DSP engine is required for pitch/stretch rendering and failed to load.
```

## Deploy

For frontend/WASM-only changes:

```bash
firebase deploy --only hosting --project melogic-records
```

Do not deploy functions, Firestore rules, or Storage rules for DSP-only frontend changes.
