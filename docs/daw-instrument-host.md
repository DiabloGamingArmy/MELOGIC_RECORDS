# DAW Instrument Host

The DAW instrument system is split into two layers:

- `DawWindowManager` owns plugin window UI state, floating window behavior, detach/pop-out lifecycle, and message bridging.
- `InstrumentRegistry` owns Web Audio instrument instances in the main DAW tab.

## Audio Ownership

The main DAW tab owns the `AudioContext` and instrument audio graph. Detached pop-out windows are remote control surfaces only. They send parameter and note messages back to the opener through `postMessage`, with `BroadcastChannel` available as a same-origin fallback.

This avoids duplicate audio engines, duplicate voices, and inconsistent transport ownership. Closing a pop-out returns the in-tab plugin window from detached state but does not dispose the instrument. Closing the instrument window disposes the associated audio instance.

## Current Prototype

`melogic-wavetable` currently maps to `BasicSynthInstrument`, a Web Audio wavetable MVP with:

- generated built-in wavetable metadata and frames
- `PeriodicWave` oscillators
- wavetable position, pitch, level, basic unison, and detune params
- lowpass, highpass, and bandpass filter modes
- output gain
- ADSR envelope
- simple LFO targeting pitch or filter cutoff
- four stored macro controls
- a lightweight modulation matrix model for LFO, macro, and future envelope routes
- a metadata-first wavetable browser backed by local/generated catalog records
- click-reducing gain ramps
- `noteOn`, `noteOff`, `setParam`, and `dispose`

Audio binary assets must live in storage, not Firestore. The future remote metadata shape is represented by `audioAssets/{assetId}` records with fields like `type`, `title`, `creatorUid`, `storagePath`, `frameCount`, `frameSize`, `sampleRate`, `tags`, `visibility`, `license`, `checksum`, and `version`. The current MVP uses generated built-in tables only.

Presets are local JSON objects for now and include Init, Bass Test, Pluck Test, and Pad Test. This is not the final wavetable engine. Future instruments can register new factories in `InstrumentRegistry`.
