# Synth Filter all-type audit, response fill, and shared Comb

Baseline: `4cafa0f1542feea744aed4a8342f1a62119e0b4c`. Branch: `mct-origami-nodes-visual-feedback-p03`. The [pre-implementation audit](AUDIT.md) records the taxonomy, canonical algorithm, storage cost, and adaptation plan before implementation.

## 1. Canonical types

`core/dsp/FilterTypes.h` is the single source: LOW PASS (0), HIGH PASS (1), BAND PASS (2), NOTCH (3), PEAK/BELL (4), ALL PASS (5), LOW SHELF (6), HIGH SHELF (7), COMB (8). Both Nodes descriptor labels and Synth choices derive from this table. All nine are now Synth-supported.

## 2. Capabilities and controls

Every type has implemented DSP and a truthful small-signal magnitude response. All retain Synth's common nonlinear input Drive, coherent dry/wet Mix, and per-note Keytrack. Drive/saturation are amplitude-dependent and intentionally excluded from a linear transfer plot; the tooltip explains that scope. Keytrack changes actual effective Frequency, clamped to the type's range.

| Type | Frequency meaning | Resonance meaning | Gain | Graph drag X / Y |
| --- | --- | --- | --- | --- |
| LOW PASS | cutoff | Q / transition resonance | disabled | Frequency / Q |
| HIGH PASS | cutoff | Q / transition resonance | disabled | Frequency / Q |
| BAND PASS | center | bandwidth Q, unity wet center | disabled | Frequency / Q (width) |
| NOTCH | null center | notch bandwidth Q | disabled | Frequency / Q (width) |
| PEAK | bell center | bell bandwidth Q | boost/cut | Frequency / Gain |
| ALL PASS | phase transition | phase Q | disabled | Frequency / no vertical edit |
| LOW SHELF | shelf transition | transition shape Q | boost/cut | Frequency / Gain |
| HIGH SHELF | shelf transition | transition shape Q | boost/cut | Frequency / Gain |
| COMB | feedback period, 20–2000 Hz | bipolar feedback −0.97…+0.97 | disabled | Frequency / feedback |

Gain stays in a stable sixth slot, disabled/dimmed when inapplicable. Type changes preserve bank bounds. Normalized Synth Resonance maps to Q = 0.5 + 3.5 × Resonance for SVFs; Nodes uses its existing explicit Q range. These are control ranges for the same SVF algorithms, not divergent filter definitions. Comb maps Resonance to feedback = −0.97 + 1.94 × Resonance, so 0.5 gives zero feedback. Its fixed damping is the canonical default 0.2, since Synth has no damping field or destination. No Comb-only modulation destination was added. Existing Gain remains authored, not a new modulation destination.

## 3. Visual result by type

Inspected nine contact sheets with nine cases each (81 actual offscreen renders). Cases span low/mid/high Frequency, Resonance 0/0.5/1, Mix 0/0.5/1, and applicable Gain −12/0/+12 dB; combinations are representative rather than a screenshot Cartesian product.

| Type | Result / inspected artifact |
| --- | --- |
| LOW PASS | Correct passband, resonance and attenuation; [sheet](type-0.png) |
| HIGH PASS | Correct low attenuation and high passband; [sheet](type-1.png) |
| BAND PASS | Correct centered pass region and Q width; [sheet](type-2.png) |
| NOTCH | Correct centered null and width; [sheet](type-3.png) |
| PEAK | Correct boost/cut and zero-Gain unity; [sheet](type-4.png) |
| ALL PASS | Full-wet unity; half Mix correctly shows coherent phase cancellation; [sheet](type-5.png) |
| LOW SHELF | Correct low-frequency gain offset and unity highs; [sheet](type-6.png) |
| HIGH SHELF | Correct unity lows and high-frequency gain offset; [sheet](type-7.png) |
| COMB | Correct recurring damped teeth, sign-dependent peak positions, zero-feedback/dry unity; [sheet](type-8.png) |

For every sheet, fill reaches the floor beneath the actual curve, the white stroke remains open, axes remain readable, and the quiet major grid stays subordinate. At very low Comb Frequency, high-frequency teeth become denser than screen pixels and form a dense band; the curve is still evaluated analytically, not a decorative texture or fabricated waveform.

## 4. DSP audit and defects

No existing SVF or canonical Comb DSP defect was found. PEAK zero-Gain unity and ALL PASS full-wet unity remain mathematically correct. Nodes Comb's soft-limited feedback, damping, fractional interpolation, normalization, frequency clamp, and reset behavior were traced before extraction. Existing FX legacy Comb → Filter type 8 migration remains unchanged and its tests pass.

The new Synth execution uses the extracted kernel. A 20,000-sample independent golden recurrence matches the original Nodes recurrence exactly. All-type existing measured-response coverage remains; new Comb measurement covers 432 probes over four rates, three delay frequencies, minimum/zero/maximum feedback, and Mix 0/0.5/1. Worst Comb magnitude discrepancy is **0.0000158216 dB**, below the 0.03 dB tolerance. SVF worst meaningful discrepancy remains **0.0057791 dB** over 6,656 probes. The PEAK-specific 360 Synth/Nodes probe-pair audit also remains passing.

## 5. Graph defects and corrections

The previous pass's gain-type fill ended at 0 dB, which conflicted with the newly explicit Origami visual convention. That special case was removed. Shelf vertical drag previously edited Q rather than Gain; shared type-aware handle policy fixes it. ALL PASS vertical magnitude dragging is now inactive rather than implying a magnitude effect.

Nodes' existing Comb preview used an idealized integer-period formula that omitted fractional interpolation, damping, and coherent Mix. It now uses the same analytical Comb provider as Synth. Synth Comb uses 8192 logarithmic samples plus bounded half-period landmarks and nearby samples, at most 14,189 points plus the inserted response handle. SVF sampling remains 256 points. Computation and any vector allocation stay on the UI thread; no audio FFT or audio response sampling is introduced.

## 6. Fill before / after

Before: gain types filled from curve to 0 dB; other types filled to plot bottom.
After: every type copies the open curve into a separate fill path, adds the two graph-bottom corners, and closes only that fill path. The white response path is stroked independently and never closed. Dark accent exposure/alpha, background, white curve, axis labels, and neutral 35%-alpha frequency grid are preserved. No saturated baseline is added.

## 7. Reused Comb implementation

Canonical origin: private `CombFx` in `core/fx/FxEffects.cpp`, already dispatched by Nodes `FilterFx` type 8. Its recurrence is now `dsp::CombState` in `core/dsp/Comb.h`. Both Nodes CombFx and SynthFilterRuntime call this kernel. FX retains its existing parameter smoothing and delay capacity; Synth retains its existing per-voice smoothing and common input-drive stage. No parallel Comb algorithm was introduced.

## 8. Per-voice architecture

`SynthCombPool` owns lazy banks per used physical Synth filter slot. A bank serves 16 independent stereo views. Memory is allocated and its pages touched on the serialized writer before type or full-state publication. Atomic raw-pointer publication is compile-time required to be lock-free. Banks do not move or free while audio runs; they remain as a bounded high-water allocation until stopped preparation or destruction.

Voices hold non-owning state only. On first Comb adoption they bind their own slice; type/identity changes reset integrators and Comb history. Reset invalidates old ring entries in O(1), with no large memory clear on Panic or steal. Release allows genuine tails; an energy/low-pass quiet check permits eventual voice retirement. Retrigger clears Comb tails, while ordinary legato retains the existing lifecycle policy. Bypass clears histories after the existing Mix fade.

Full processor restores apply at an audio boundary, so the writer prepares their banks before publishing the restore mailbox. Stopped sample-rate preparation also prepares queued UI-state Comb banks. The callback only checks readiness and binds prepared memory; it never allocates or frees storage.

## 9. Response mathematics

For z = exp(jω), D = sampleRate/Frequency = N + δ, fractional delay is L(z) = (1−δ)z^−N + δz^−(N+1). Loop damping is P(z) = a / [1−(1−a)z^−1], using the actual canonical one-pole coefficient. With feedback f and normalization s = sqrt(1−|f|):

`H_wet(z) = s / [1 − f L(z) P(z)]`

`H_total(z) = (1 − Mix) + Mix H_wet(z)`

The graph plots |H_total| in dB. This is the small-signal response below the feedback soft limiter, matching measured low-amplitude DSP. Synth and Nodes use the same provider. Wet/dry phase is preserved; responses are not simply multiplied by Mix.

## 10. Files changed

- Shared DSP/type: `core/dsp/Comb.h`, `core/dsp/Filter.h`, `core/dsp/FilterTypes.h`, `core/fx/FxEffects.cpp`.
- Synth storage/lifecycle: `core/SynthFilter.h`, `core/Voice.h/.cpp`, `core/Engine.h/.cpp`.
- Restore preparation: `plugin/PluginProcessor.cpp`.
- UI/response: `plugin/ui/SignalPanels.h/.cpp`, `plugin/ui/FxPage.cpp` (canonical Comb preview only).
- Tests/measurement: `tests/EngineTests.cpp`, `tests/FilterResponseTests.h`, `tests/FxGraphTests.cpp`, `tests/PluginTests.cpp`, `tests/StateTests.cpp`, `tests/PerfBench.cpp`.
- Evidence: `docs/qa/filter-all-types/`.

Routing functions, topology representation, capacities, stable IDs, source pools, modulation destinations/compiler, state codec, oscillator DSP, themes, browser, and unrelated FX algorithms have no changes.

## 11. Persistence

Comb type 8 and non-default Frequency/Resonance/Drive/Mix/Keytrack, stable Filter ID, routing, and modulation restore through the real processor wrapper. Restore-before-prepare at a new sample rate is tested. Existing schema **38** already stores the canonical type enum; **no schema bump or format change**. Schema 36 lacks the type field and remains supported through existing migrations. Validation now accepts Comb through the same shared supported-type catalog and still rejects unknown enum values.

## 12. RT safety

Allocation/free guards pass for all 128 stereo Comb stages during rendering, 32 note starts/steals, release, Panic, and rapid adoption of all canonical types. Actual processor callback guards also cover queued Comb restore, first notes, and Panic at a different rate. Zero new audio-thread allocations/frees, locks, filesystem operations, FFTs, or queues. Rings, stages, voice count, and reset work are bounded. Stereo independence, keytracking telemetry, modulated Resonance telemetry, finite-input/state recovery, natural tail drain, reset silence, incompatible type reset, and state lifecycle have explicit tests.

## 13. Memory budget

Exact measured fixed object sizes:

| Object | Before bytes | After bytes | Delta |
| --- | ---: | ---: | ---: |
| Voice | 135168 | 136064 | +896 |
| Engine | 2556480 | 2571008 | +14528 |
| OrigamiAudioProcessor | 2837568 | 2852096 | +14528 |
| SynthFilterRuntime | 160 | 272 | +112 |

CombState is 48 bytes per channel; pool metadata is 152 bytes. No maximum delay buffer is embedded in Voice. Exact ring capacity is ceil(rate/20)+4 samples/channel.

| Rate | Stereo data per stage | Lazy slot bank (16 voices) | Worst 16 × 8 ring bytes |
| --- | ---: | ---: | ---: |
| 48 kHz | 19232 | 307712 | 2461696 (~2.35 MiB) |
| 192 kHz | 76832 | 1229312 | 9834496 (~9.38 MiB) |
| 384 kHz (supported maximum) | 153632 | 2458112 | 19664896 (~18.75 MiB) |

A prepared Comb stage has 272 bytes of runtime metadata plus its stereo ring share; at 48 kHz that is 19504 bytes. Zero-Comb fresh patches allocate zero delay-bank bytes. Once used, banks intentionally remain until stopped reprepare; Panic does not free them. Processor fixed size plus full 48 kHz ring data is 5313792 bytes, excluding existing unrelated tables, FX heaps, UI assets, and allocator overhead. Blind reuse of the canonical FX's two power-of-two buffers would have used 4194304 data bytes for 128 stages at 48 kHz, versus 2461696 here. See [before](memory-before.txt) and [after](memory-after.txt) measurements.

## 14. Performance

[Complete 30-scenario table](PERFORMANCE.md), with [raw output](performance.txt): zero Synth filters, one LP, one/four/eight serial Comb stages × 1/8/16 voices × 48/192 kHz, 256 samples. On this Apple M5 Pro (64 GiB), eight Comb × 16 voices measured median/p99 **762.0/793.2 µs** at 48 kHz (**14.29%/14.87%** of deadline); at 192 kHz **775.1/827.4 µs** (**58.13%/62.06%**). These are this machine's measured callback times, not universal host guarantees. No spectral misses, requests, or runtime compiles occurred in measured scenarios.

## 15. Automated tests

Focused gates passed: **1,403,265 core checks**, **1,610,515 Plugin/UI checks**, **2,779 state checks**, **648 FX checks**. Relevant existing modulation, content, wavetable, routing, schema, continuity, and Panic regressions remain included. All seven full CTest suites passed. The final normal development rebuild also passed all four deployment gates and AU validation. `git diff --check` passed.

## 16. Offscreen inspection

All 81 renders were visually inspected through the nine sheets linked in section 3. [Whole plugin](whole-synth.png) preserves the compact lowered footer, 32 px knobs, header, source rail, and 189 px graph; only the requested stable disabled Gain slot replaces five/six-control reflow. No outer container change. The fill follows actual responses to the floor, the stroke stays open, and labels sit outside the plot. This is offscreen inspection and automated interaction/DSP testing; new human host auditioning is left to the checklist below.

## 17. Full validation / rebuild

`ctest --test-dir origami/build-multihost --output-on-failure -V`: **7/7 passed**, covering Core, State, Modulation, FX, Wavetable, Plugin/UI, and Content. See [full CTest log](ctest.txt). The normal `./origami/scripts/rebuild-dev.sh` finished with exit 0, passed all four deployment gates, deployed Standalone/AU/VST3, and explicitly reported **AU VALIDATION SUCCEEDED**. See [full rebuild/deployment log](rebuild-dev.txt).

## 18. Manual QA checklist

1. Select each of the nine filter types; compare defining shapes with the sheets.
2. Move Frequency through low/mid/high values; Comb's active range is 20–2000 Hz.
3. Sweep Resonance: Q changes width/phase for SVFs; Comb feedback crosses zero at 0.5.
4. For PEAK/shelves test Gain −12/0/+12; verify other types show a disabled Gain slot.
5. Test Mix 0/0.5/1; dry is flat, and partial Mix preserves real phase cancellation.
6. Raise Drive and audition saturation; the graph intentionally shows linear transfer only.
7. Enable Keytrack and play notes an octave apart; watch effective Frequency follow.
8. Drag the graph: Frequency/Q for LP/HP/BP/Notch, Frequency/Gain for bell/shelves, Frequency only for ALL PASS, Frequency/feedback for Comb.
9. Assign existing LFO/ENV destinations to Frequency/Resonance/Mix; inspect effective graph movement.
10. Rapidly switch every type with held notes; verify correct applicability, response, and reset behavior.
11. Audition Comb ringing, negative/positive feedback, and silence at Mix 0.
12. Inspect Comb teeth and bottom fill; change Frequency/feedback/Mix and compare response movement.
13. Save a non-default Comb patch with routes/modulation, reload, and confirm exact restoration.
14. Trigger Panic during a ringing Comb; verify immediate silence and clean retrigger.
15. Verify OSC→Filter, Filter→Filter, terminal bus sends, drag/drop, route amounts, and deletion splicing remain intact.

## 19. Final commit / diff audit

Final diff inspection confirms one type source, one shared Comb kernel, truthful analytical response, bottom-to-curve fill, open white stroke, unchanged routing/IDs/source architecture, existing schema 38, and no audio allocation/free or unbounded work. The exact local commit SHA is returned in the completion message. No push is performed; this pass stops after that commit.
