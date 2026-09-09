# MCT Origami V0.1

MCT Origami is Melogic Creative Technologies' independent instrument core.
`origami_core` is a C++17 static library, namespaced `mct::origami`, with no
Soura, browser, JUCE, VST3, operating-system, or third-party DSP dependencies.
`origami_patch` adds the non-realtime JSON codec. CMake builds both independently.

## Boundary and signal path

Host MIDI → fixed voice allocation → wavetable oscillator → velocity × ADSR →
per-voice low-pass → voice sum → OSC level → master gain → mono/stereo pan.

`OrigamiEngine` owns 16 voices, parameter targets, and its wavetable bank. Hosts
provide planar float buffers; `process` overwrites them. Mono ignores pan;
stereo uses equal-power pan. Velocity is linear amplitude, clamped to [0,1];
zero-velocity note-on is note-off. A4 is MIDI 69 at 440 Hz. Channels are 0–15;
notes are 0–127. Optional nonzero note IDs distinguish overlapping equal pitches;
without IDs, note-off releases the oldest matching held note. Voice allocation
prefers free slots, then the quietest releasing voice, then the oldest held voice.
Ties use the lowest slot. Each stolen voice has a fixed three-ms crossfade tail.
A second steal of the same slot replaces that tail; there is no unbounded tail pool.

ADSR uses linear segments, measured in seconds at the prepared sample rate.
Attack/decay durations latch at note-on, release at note-off; sustain can change
smoothly. Releasing during attack/decay starts from the current level. After
release, a voice drains its filter state before becoming free. Reset is immediate
silence, intended for transport resets/panic; allNotesOff follows normal release.

The topology-preserving state-variable low-pass maps resonance [0,1] to Q [0.5,4].
Cutoff is constrained below 0.45 × sample rate. Tiny integrator states flush to
zero portably. Master gain is bounded [0,1]. There is no automatic normalization
or hidden limiter: dense/resonant patches can exceed ±1 and hosts must retain
float headroom or manage clipping at their output/encoding boundary.

## Wavetable storage

A bank owns frames, each with equally sized, ascending harmonic-limit bands.
Built-ins are sine/saw/square/triangle, generated outside processing into 2048-point
cycles with harmonic limits 1,2,…,512. Fourier partials are truncated per band.
Playback selects the richest band whose harmonics fit below 0.45 × sample rate,
then linearly interpolates samples and adjacent frames. Phase stays in [0,1) in
double precision. Fundamentals above Nyquist are silent. This reduces aliasing;
it is not an oversampled oscillator or a claim of zero interpolation images.

`installWavetable` validates and takes ownership off the audio thread. Arbitrary
frames/bands can be supplied without changing the oscillator. Importers are
responsible for truthful harmonic metadata. V0.1 exposes only four waveform
choices (0 sine, 1 saw, 2 square, 3 triangle); the oscillator already accepts a
continuous normalized position for future table import/morph controls. No editor,
unison, FM, or warp modes are implemented. Waveform changes crossfade over 5 ms.

## Realtime and threading contract

- Construct, prepare, install banks, parse/serialize JSON, and apply patch state
  outside rendering with exclusive access. Preparation generates tables once.
- MIDI, reset, voice inspection, and process belong to one audio/render thread.
  Host adapters must marshal events; they must not call MIDI from a UI thread.
- `setParameter` is the cross-thread exception: bounded validation plus a lock-free
  atomic float store (enforced at compile time). No mutex or queue allocation.
  Targets latch at the next process call; smoothed parameters ramp over 5–10 ms.
- Hosts deliver sample-offset events by splitting a buffer at event boundaries,
  applying events in host order, then processing the next span. Thus hosts own
  transport/timestamps and future pitch-bend, expression, MPE, and CC translation.
- `parameterState` reads atomic targets; concurrent multiple writes are not a
  transactional snapshot. Apply/capture complete presets while writes are paused.
  `applyPatchState` validates all entries before committing and resets DSP state.
- No process/MIDI/reset heap allocation, vector resize, locking, filesystem,
  logging, JSON parsing, or UI work. Rendering uses prepared banks and fixed arrays.
- Any positive block size works, even above the preparation hint: no block-sized
  internal scratch buffer exists. Zero samples is a no-op. Output pointers must
  be non-null, distinct, and sized by the host. Unsupported channel counts fail;
  valid mono/stereo buffers are cleared when unprepared or channel-mismatched.
- Prepare accepts 8–384 kHz and mono/stereo. Bank generation can throw allocation
  errors; hosts handle these before audio starts. Realtime entry points are noexcept.

## Parameters and patches

`ParameterRegistry` is the persistent ID authority: explicit numeric enum values
0–9 and matching dotted string IDs, names, units, defaults, ranges, mapping, and
smoothing times. Never renumber/reuse an ID or derive it from a UI label. Live
values are physical units (seconds, Hz, linear gains), with bounded linear/log
normalization helpers. Invalid IDs and NaN/Inf fail safely; finite live values
clamp, choice values round. New parameters must append stable IDs in a future
schema revision, with migration in the non-realtime codec.

`presets/init.json` is the canonical version-1 patch. Its format is `mct-origami`,
with `version`, UTF-8 `name`, and a `parameters` object keyed by registry strings.
The strict, bounded codec accepts fields in any order, handles JSON escapes and
Unicode, and rejects missing/unknown/duplicate fields, unsupported versions,
invalid numbers, and out-of-range or fractional choice values. Failed parsing
leaves the destination unchanged. Files are limited to 64 KiB and names to 256
UTF-8 bytes. Float serialization round-trips. No host, cloud, or filesystem IDs
are part of state; the caller owns file I/O.

## Extensions

Source DSP lives below Voice; additional sampler/noise/granular sources can later
supply the same per-voice signal path. A future layer/drum-pad container can own
multiple source/voice groups. Modulation can feed bounded parameter values and
per-voice controls; FX can follow the voice sum. Those systems are not placeholder
classes in this release. Hosts will adapt this library, never become its DSP
source of truth: future WASM/C ABI, Soura native, and VST3/JUCE adapters remain
separate targets. Origami does not join Soura's Signalsmith asset-extraction build.

## Build and verify

From the repository root, with CMake 3.20+ and a C++17 compiler:

```sh
cmake -S origami -B origami/build -DCMAKE_BUILD_TYPE=Release
cmake --build origami/build --parallel
ctest --test-dir origami/build --output-on-failure
origami/build/origami_render origami/build/origami-c4.wav
```

The renderer writes a three-second 48 kHz stereo PCM16 C4 saw note (two seconds
held, one second release space), using Init parameters. It is a non-realtime tool;
its generated WAV/build files are ignored. On multi-configuration generators,
use `--config Release` / `-C Release` and the `Release/` executable directory.

Tests cover rendered C4/A4 pitch, sample rates, irregular blocks, ADSR durations,
polyphony/stealing, note identity, reset, parameter safety, strict patch round-trip,
finite resonant filtering, long phase stability, alias suppression, and heap
allocation instrumentation around processing and MIDI. An optional debug build
with `-DORIGAMI_SANITIZE=ON` enables ASan/UBSan on Clang/GCC. Existing Soura
`npm run build` remains a separate regression check, not an Origami compiler.
