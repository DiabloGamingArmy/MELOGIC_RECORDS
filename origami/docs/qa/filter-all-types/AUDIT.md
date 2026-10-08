# Pre-implementation audit

Baseline: 4cafa0f1542feea744aed4a8342f1a62119e0b4c.
Source: core/dsp/FilterTypes.h, core/dsp/Filter.h, core/fx/FxFilter.h, core/fx/FxEffects.cpp.

| Type | DSP present | Synth before | Frequency | Resonance | Gain | Handle plan |
| --- | --- | --- | --- | --- | --- | --- |
| LOW PASS | yes | yes | cutoff | Q | no | frequency / Q |
| HIGH PASS | yes | yes | cutoff | Q | no | frequency / Q |
| BAND PASS | yes | yes | center | bandwidth Q | no | frequency / Q (width) |
| NOTCH | yes | yes | null center | bandwidth Q | no | frequency / Q (width) |
| PEAK | yes | yes | center | bandwidth Q | boost/cut | frequency / Gain |
| ALL PASS | yes | yes | phase transition | phase Q | no | frequency only; use Q knob for phase |
| LOW SHELF | yes | yes | transition | shape Q | boost/cut | frequency / Gain |
| HIGH SHELF | yes | yes | transition | shape Q | boost/cut | frequency / Gain |
| COMB | yes | no | period = sample rate / frequency, canonical 20–2000 Hz | bipolar feedback −.97…+.97 | no | frequency / normalized feedback |

All Synth stages retain existing Drive, coherent linear Mix, and per-note Keytrack. Nodes Comb itself does not expose Drive; Synth's existing common input-drive stage is preserved. Synth has no damping destination/field, so Comb uses the existing canonical default damping .2. Nonlinear saturation/Drive has no amplitude-independent transfer: the graph is the small-signal linear transfer and says so.

Canonical Comb is private CombFx in FxEffects.cpp, reused by FilterFx type 8. It interpolates fractional delay line reads, low-pass damps feedback, recirculates a soft-limited input+feedback signal, and normalizes wet output by sqrt(1−abs(feedback)). Period smooths at 50 ms, other FX controls at 20 ms. Synth retains existing per-voice smoothing. Existing FX legacy Comb migration selects Filter type 8 and renormalizes frequency; preserve it.

Existing FX delay storage rounds sampleRate/15+4 to powers of two. At 48 kHz: two 4096-float lines = 32768 bytes/stage, or 4194304 bytes for 128 stages before runtime metadata. Embedding this in Voice is rejected. Plan: shared non-owning fractional-delay kernel, writer-allocated bank per used Synth slot, 16 independent stereo views; exact capacity ceil(sampleRate/20)+4. At 48 kHz: 2404×2×16×4 = 307712 bytes/slot, full 8 slots = 2461696 bytes. At maximum supported 384 kHz: 19664896 bytes full capacity. Allocate first use before publication, retain until stopped prepare/destruction, never allocate/free during type switches or Panic. O(1) logical reset invalidates prior ring contents without clearing all storage.

Existing response sampling is 256 log-frequency points, insufficient for low-frequency Comb high-frequency teeth. Plan bounded UI sampling, with dense sampling and explicit periodic tooth landmarks; no audio FFT or audio-side response computation.

Existing fill closes to 0 dB for gain types; restore one policy closing the separate fill to plot bottom. White stroke remains open. Major grid neutral 35% alpha remains unchanged. Gain remains in one stable disabled slot for inapplicable types.

State already uses schema 38 for non-LP canonical type IDs. Schema 36 has no type field, so it cannot encode Comb; no schema bump is needed. Accept enum 8 under existing v38 validation and keep older migrations unchanged.
