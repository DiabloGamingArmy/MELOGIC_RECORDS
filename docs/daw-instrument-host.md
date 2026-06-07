# DAW Instrument Host

The DAW instrument system is split into two layers:

- `DawWindowManager` owns plugin window UI state, floating window behavior, detach/pop-out lifecycle, and message bridging.
- `InstrumentRegistry` owns Web Audio instrument instances in the main DAW tab.

## Audio Ownership

The main DAW tab owns the `AudioContext` and instrument audio graph. Detached pop-out windows are remote control surfaces only. They send parameter and note messages back to the opener through `postMessage`, with `BroadcastChannel` available as a same-origin fallback.

This avoids duplicate audio engines, duplicate voices, and inconsistent transport ownership. Closing a pop-out returns the in-tab plugin window from detached state but does not dispose the instrument. Closing the instrument window disposes the associated audio instance.

## Current Prototype

`melogic-wavetable` currently maps to `BasicSynthInstrument`, a temporary Web Audio prototype with:

- one oscillator per active note
- sine, sawtooth, square, and triangle oscillator types
- output gain
- simple ADSR envelope
- click-reducing gain ramps
- `noteOn`, `noteOff`, `setParam`, and `dispose`

This is not the final wavetable engine. Future instruments can register new factories in `InstrumentRegistry`.
