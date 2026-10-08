# Canonical Init, audio-card proportions, and nominal level calibration

Baseline: `425e88139d8019e2c7c13744904222e6e41dd4f4` on `mct-origami-nodes-visual-feedback-p03`.
The user explicitly corrected the requested rounded WT value to exact unmixed saw: `1.0f / 3.0f`.

1. **Init owner:** `core/InstrumentState.cpp::canonicalInitState()` is the authored NEW/INIT content boundary. The processor restores this before publishing its UI model, then captures the complete plugin wrapper (instrument, neutral FX workspace, content identity, default layout) into `initState_`. Raw `InstrumentState` is an empty storage/codec snapshot; registry, modulation, envelope and oscillator constructors retain their historical defaults. They are not product preset factories.
2. **Old → new:** startup oscillator count 4 → 1; BASIC SHAPES and WAVETABLE unchanged; WT 1/3 → explicit 1/3; enabled true unchanged; OCT/SEM/FIN 0/0/0 unchanged; Unison 1 → 0; detune 12 → 0 cents; blend .35 → .5; pan 0 unchanged; level .7 → 1. ENV1 .01/.15/.7/.25 → .01/.5/1/0 seconds/linear sustain. Master .2 → .35 linear, exclusively authored Init. Main bus unity, zero oscillator processes, zero cross-oscillator routes and zero explicit Synth Filters remain. ENV2/3 defaults and AUTO/GRAPH ownership remain.
3. **Saw proof:** `Wavetable::builtIns()` generates four frames: sine, saw, square, triangle. Frame 1 has harmonic coefficient −2/(πh). `readAt` maps normalized position to `position*(frames.size()-1)`; float `1.f/3.f * 3.f` resolves to frame 1 exactly, with zero adjacent-frame fraction. No wavetable/interpolation change. The original 0.333 value would have blended about .1% sine, which prompted the user's correction.
4. **Entry paths audited:** processor constructor and Standalone's processor construction now use the factory. Header Init, browser INIT, and explicit reset/reload already converge on `loadUiInitPreset()` and therefore consume that same captured wrapper. A no-patch fresh instance starts there; invalid state restores are rejected transactionally rather than changing current content. Historical binary/JSON loading remains authoritative. The checked-in `presets/init.json` parameter fixture is aligned with the factory's parameters; it is a legacy parameter-only file and is not the runtime full-state Init owner. The normal engine constructor remains a generic engine fixture; tests requesting product Init call the explicit factory.
5. **Determinism:** core asserts all requested fields, stable OSC1/next IDs, exact saw, direct output, no extra oscillator/process/filter/modulation, unchanged ENV2/3, valid state, binary round trip, finite zero-release mapping, actual render, one-sample release, DC and block partition equivalence. Plugin reset test dirties multiple oscillators, embedded custom wavetable, envelope, master, LFO route, Synth Filter/routing and compressor graph; Init clears those and remains exact after audio adoption. Reloading saved dirty content restores its authored state and .13 master. Final processor output independently meets the peak target after reset from custom content.
6. **Actual catalog inventory:** all entries below are `processesAudio=true`, all have truthful parameter/model viewports, and all use `FxNodeComponent` plus the selected-effect inspector. Counts are visible quick controls / total descriptors; conditional descriptors do not all appear simultaneously.

| Audio type | Model | Quick / total | Inspector / special layout | Visual QA |
|---|---|---:|---|---|
| Drive | Transfer | 3 / 4 | up to 4 scalar controls | pass |
| Compressor | Compressor transfer | 3 / 26 | up to 5; SINGLE/MULTI conditional pages retained | pass |
| Limiter | Dynamics transfer | 3 / 3 | 3 | pass |
| Filter | Filter response | 3 / 8 | type-dependent controls; COMB is a Filter mode | pass |
| Equalizer | EQ response | 3 / 40 | up to 5; existing eight-band interactive editor retained | pass |
| Chorus | LFO/delay model | 3 / 5 | 5 | pass |
| Flanger | LFO/delay model | 3 / 6 | 5 | pass |
| Phaser | Notch model | 3 / 7 | 5 | pass |
| Spatial | Parameter-derived stereo positions | 3 / 6 | 5 | pass |
| Delay | Tap model | 3 / 6 | 5 | pass |
| Reverb | Decay model | 3 / 6 | 5 | pass |
| Diffuse | Deterministic diffusion model | 3 / 3 | 3 | pass |
| Gain | Authored gain bar | 1 / 2 | scalar gain; discrete polarity retained | pass |
| Stereo Utility | Width/balance model | 2 / 3 | 2; discrete mono retained | pass |

Audio source/output endpoints have meters but no parameter footer and retain their geometry. Split/Merge have branch ports and no meaningful model viewport; unchanged. Send/Return are unimplemented, not catalog effects. GLOBAL FX has no visualization and is unchanged. Event/control/source/parameter utility cards are excluded. Synth Filter and oscillator cards retain the preceding pass's geometry.

7. **Shared policy:** `AudioCardLayout::forBody` allocates the bottom text rows first, then a compact knob row, and grants every remaining pixel above it to the preview. `forBounds` adapts graph-card margins/header to that policy. `knob` distributes cells evenly, preserving order. Existing renderers use viewport-relative inner rectangles/path coordinates; no response algorithms, fake meters or decorative animations added.
8. **Shared versus exceptions:** `plugin/ui/FxPage.h/.cpp` changes both graph-card and selected-effect inspector placement, preview caching dimensions and telemetry repaint bounds. No per-effect layout constants. Existing EQ interactive multi-row editor, conditional parameter pages and viewportless/global cards remain specialized and unchanged. `OscillatorRack` and `ModulationPanel` changes solely expose requested zero unison and zero ENV1 release; other envelope editor minima remain .001.
9. **Viewport bounds (x,y,w,h):** every 216×180 graph effect: (12,40,192,52) → (12,40,192,72), +38.5% height. At the audited 380×218 selected inspector: (12,44,356,60) → (12,44,356,92), +53.3%. Geometry scales from actual bounds; cached image dimensions now follow those bounds too.
10. **Knob centers:** graph effects Y128 → Y135, keeping 46×46 hit targets (40px drawn diameter). Selected inspector Y145 → Y160 at 380×218, retaining 48×48 targets where cells fit. Narrow five-control inspector cells may modestly reduce diameter to fit; no added rows.
11. **Low text:** graph labels unchanged (12,158,192,22). Inspector labels/value rows unchanged at Y184..198 / Y198..212 for 380×218. Knob/value/label gaps compacted by consuming space above the text.
12. **Offscreen audit:** all 14 cards rendered at .75×, 1×, 1.5× and 2×; all 14 selected inspectors at 2×. Inspected both contact sheets. Header, viewport, labels, values, margins and controls are legible/contained, with no overlap. Real knob centers resolve to sliders and edits update canonical FX parameters. Shared synthetic counts 1/2/3/4/5 pass nonoverlap at 216×180 and 280×220. Init editor checks at 1100×760 and 1440×900. The text attachments did not contain the referenced Compressor image; the actual baseline code geometry was used instead.
13. **Outer dimensions:** `FxNodeComponent::sizeFor` and header controls are untouched; effect cards remain 216×180, sources 176×98, output 164×226, and routing sizes remain branch-dependent. Inspector outer allocation untouched.
14. **DSP/architecture:** no changes to Engine.cpp, Voice.cpp, Wavetable.cpp, Envelope.cpp, filter DSP, FX DSP, routing compiler, modulation compiler or lifecycle. No schema bump, global gain boost, RT telemetry/FFT, limiter, compressor, AGC or active-voice normalization added. Model acceptance expands Unison to 0 (existing renderer clamps lanes to at least 1) and ENV1 Release to 0 (existing Envelope uses a minimum one-sample segment). Zero-inclusive release parameter normalization uses log1p/expm1 with a 1ms offset, finite exact endpoints and physical-value round-trip tests; positive saved durations remain unchanged. ENV2/3 validation and editor minima are preserved.
15. **Automated results:** full `ctest --test-dir origami/build-multihost --output-on-failure -V`: 7/7 pass, 64.31 seconds. State 2779; engine 1,916,735; wavetable-bank foundation pass; modulation 3938; FX 648; plugin/UI 1,634,956; content 98. `git diff --check` passes. Logs included.
16. **Deployment/AU/manual:** normal `./scripts/rebuild-dev.sh` completed successfully, including all regression gates and literal **AU VALIDATION SUCCEEDED**. Deployed Standalone/AU/VST3 paths are in `rebuild-dev.txt`. Actual deployed app UI automation verified the complete Init fields and empty Synth Filter bank, then added a Compressor and inspected its enlarged card/inspector. Changing the graph threshold from .700 to .750 updated both inspector and parameter panel to .750 (−15 dB). Header `INIT PRESET` removed the temporary Compressor; returning to SYNTH showed exactly the same requested Init values. App left on canonical Init. Offscreen checks are distinct from actual app UI automation.
17. **Goldens:** no hash or golden file changed. Existing multi-oscillator/optimized-path UI audits now explicitly construct their historical four-oscillator authored fixture through `makeLegacyProcessorFixture`; product NEW/INIT is independently tested using the real unmodified processor constructor. Registry constructor defaults remain unchanged except newly supported zero bounds. Default waveform mapping is already frame 1; no waveform golden needs updating.
18. **Commit:** one coherent local commit; exact SHA returned in the final chat report. No push and no subsequent pass.

## Gain measurements and math

Controlled scenario: 48kHz, stereo, MIDI 60, velocity 127, exact saw, one enabled oscillator, OSC level 1, unison 0, detune 0, blend .5, centered pan, ENV1 .01/.5/1/0, no filters/FX/modulation, 256-sample host blocks. Measure samples 24064..48127, after attack (sustain value is already 1 throughout decay). Peak is per output channel, RMS over the measured interval.

Actual equation per channel:

`band-limited saw × OSC level(1) × unison(1 lane) × ENV1(1) × MIDI velocity(1) × envelopeScaling(1) × bus send(1) × center-pan(≈0.70710678) × master × enabled-module normalization(1/1)`.

Voice sums are additive, independent of active voice count. With multiple enabled oscillators the existing engine divides their sum by enabled-module count. Unison stacks retain their existing 1/N stack average and center/stack blend; neither mechanism changed. The master is applied once, before FX by default or after FX when that existing authored order is selected. Neutral default FX/global settings are unity passthrough. Final processor measurement matches the core prediction.

| Stage, MIDI 60 | Peak linear | Peak dBFS | RMS linear |
|---|---:|---:|---:|
| Raw band-limited oscillator | 1.16330 | +1.314 | .574552 |
| Post ENV1/velocity/OSC level | 1.16330 | +1.314 | .574552 |
| Stereo post-pan/routing, before master | .822579 | −1.696 | .406273 |
| Previous conservative master .2 | .164516 | −15.676 | .081254 |
| Calibrated Init master .35 / final processor | .287903 | −10.815 | .142194 |

Saw Fourier/band-limiting overshoot above 1 is existing waveform behavior; no normalization or waveform distortion added. The controlled result **does not reproduce the supplied −17.4 dB observation**. Without its original note/velocity/measurement conditions, its exact source cannot be identified honestly. A −17.4 measurement would imply about .820 of the controlled previous amplitude (−1.72 dB). No such additional attenuation is present in this unity/no-FX scenario. Actual correction is `.35/.2 = 1.75`, **+4.861 dB**, not blind +6.7 dB.

Classification: **C — Init calibration**, with the existing conservative master/headroom retained for every historical authored patch. No duplicate gain attenuation or pan-law defect found. Master .35 is explicit authored patch content within the existing 0..1 parameter; OSC level semantics remain untouched. Saved-preset regression proves its .13 authored gain survives reset/reload; the historical fixture/golden suites pass unchanged DSP.

| Held MIDI, velocity127 | Peak dBFS | RMS | Mean/DC |
|---|---:|---:|---:|
| 36 | −10.731 | .142949 | −.000585 |
| 60 | −10.815 | .142194 | −.000159 |
| 84 | −11.148 | .140270 | .0000136 |

All fall within −10.7 ±.5 dB; slight variation is existing pitch-dependent harmonic band selection. Centered channels match exactly, finite output, negligible incomplete-cycle DC, and block partitions 1/7/127/256/511/1024 render identically. Zero release completes through existing one-sample envelope behavior.

Headroom (stereo per-channel peak, MIDI48 alone or chord48/55/60/64, velocity127, detune12 for increased-unison cases):

| Unison | One voice | Four-note chord |
|---:|---:|---:|
| 0 | .289777 | .991154 |
| 4 | .243956 | .917063 |
| 8 | .243541 | .921376 |
| 16 | .242580 | .920371 |

Representative stereo cases remain below full scale. **Headroom is finite:** the existing mono output uses the unity mono sum rather than a centered stereo channel; the same four-note mono chord measures about 1.4017 and needs lower authored master gain. Denser/coherent polyphony can also exceed full scale. No transparent additive synth can guarantee all polyphony is below 1 at this nominal single-note target without reducing volume or adding processing. No limiter or dynamic voice normalization was introduced to conceal this limitation.
