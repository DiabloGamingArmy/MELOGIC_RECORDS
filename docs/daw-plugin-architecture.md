# DAW Plugin Architecture

Melogic Studio uses a track inspector/channel-strip model for built-in web instruments and future plugin-like tools.

## Signal Flow

```text
MIDI input
-> MIDI FX
-> Instrument
-> Audio FX
-> Track output
-> Master output
```

The current implementation stores this order on each track:

- `midiEffects[]`: placeholder pre-instrument insert slots
- `instrument`: one selected instrument slot, currently `melogic-wavetable`
- `audioEffects[]`: placeholder post-instrument insert slots

MIDI FX and Audio FX are insert-state scaffolds in this phase. They do not process audio or MIDI yet.

## Track Inspector

The left inspector opens when a track is selected. It shows track identity, existing track controls, MIDI Effects, Instrument, and Audio FX. The Melogic Wavetable is assigned from the Instrument section and opened from that slot’s Edit button.

The DAW should avoid random global test buttons for instruments. Instruments belong to tracks.

## Plugin Windows

`DawWindowManager` owns floating window state, z-index layering, drag/resize/minimize/close, and detached pop-out lifecycle. Closing a plugin window disposes the corresponding instrument instance. Reopening from the track inspector recenters the window if needed.

Detached pop-outs are control surfaces. The main DAW tab owns the Web Audio graph and receives parameter/note messages through the plugin bridge.

## Built-In Web VST Folder

Built-in plugin metadata lives under `src/daw`:

- `pluginHost/pluginRegistry.js`
- `pluginHost/pluginWindowManager.js`
- `pluginHost/pluginBridge.js`
- `instruments/melogicWavetable/manifest.js`
- `midiEffects/catalog.js`
- `audioEffects/catalog.js`

Existing synth implementation files remain in `src/studio` for compatibility and are re-exported from the DAW folders until a deeper move is worth the churn.

## Future Extension Notes

Marketplace or third-party plugin support should keep the same ownership model:

- Firestore stores metadata/manifests only.
- Audio binaries and presets live in Storage.
- User entitlement controls asset/plugin access.
- Main DAW tab owns audio processing.
- Pop-outs and detached views remain remote control surfaces.
