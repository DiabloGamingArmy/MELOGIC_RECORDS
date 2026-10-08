# PEAK response audit and final layout correction

Baseline: `5ea776e515576eb7708ab1c37199ea4e7807f913`. Same local branch and 662 × 355 Synth Filters container. One local commit; no push.

## 1. Root cause and complete parameter trace

The reported PEAK / 370 Hz / Resonance 0.547 / Gain 0 dB flat response is mathematically correct unity, not dropped Resonance or stale telemetry. The UI interaction was misleading: every type previously used vertical graph drag to edit Resonance, even PEAK, whose center magnitude is controlled by Gain.

The inspected path is:

1. `FilterPanel::editValues` commits all six authored values.
2. `Engine::process` copies authored values into `ModulationFrame::synthFilters`; `CompiledModulation::read/write` applies identity-addressed effective Resonance/Frequency/Drive/Mix/Keytrack routes.
3. `Voice::nextModules` takes that effective frame. `SynthFilterRuntime::smooth` smooths all six values per voice; keytracking modifies the effective frequency.
4. The coefficient cache keys include Frequency, Resonance, and Gain. The table maps normalized Resonance to Q = 0.5 + 3.5 × Resonance.
5. `dsp::filterDesign(Bell)` uses k = 1/(Q × A), m0 = 1, m1 = k × (A² − 1), m2 = 0, where A corresponds to Gain. At Gain 0, A = 1 and m1 = 0, so the recurrence output is exactly the input regardless of Q.
6. The observed voice publishes its actual smoothed values and filter identity; the engine forwards them in `runtimeVisualizationSnapshot`.
7. `FilterPanel::responseValues` selects matching effective telemetry, falling back to authored values when no matching voice exists. Both graph and handle use those values and the same coefficient/transfer provider.

No link in this chain discards Resonance. Nodes FilterFx uses the same SVF bell semantics with an explicit Q control. No canonical PEAK gain-drag handle exists in the Nodes response preview to reuse.

## 2. Parameter semantics and shared-type audit

For PEAK, Frequency is bell center, Resonance maps to Q/bandwidth, and Gain is boost/cut in dB. Drive is nonlinear pre-filter saturation; Mix blends dry and wet in the complex transfer; Keytrack shifts effective Frequency by note, referenced to MIDI 60. Gain remains an authored control, not a new modulation destination.

| Shared type | Frequency | Resonance/Q | Gain |
| --- | --- | --- | --- |
| LOW PASS | cutoff | transition resonance | hidden |
| HIGH PASS | cutoff | transition resonance | hidden |
| BAND PASS | center | bandwidth; center is unity | hidden |
| NOTCH | rejection center | notch width; center is a null | hidden |
| PEAK | bell center | bell bandwidth | boost/cut; zero Gain is unity |
| ALL PASS | phase transition | phase shape; full-wet magnitude is unity | hidden |
| LOW SHELF | shelf transition | transition shape | low-frequency boost/cut |
| HIGH SHELF | shelf transition | transition shape | high-frequency boost/cut |
| COMB | separate delay-filter semantics | unavailable in Synth | unavailable |

Drive, Mix, and Keytrack apply to all eight supported Synth types. Their runtime behavior is preserved. Q remains applicable to ALL PASS despite flat full-wet magnitude, because it changes phase. No applicable control is disabled simply because a particular Gain/Mix makes its magnitude effect disappear. Gain visibility already follows the shared type catalog. Tooltips explain PEAK zero-Gain unity, ALL PASS phase behavior, and the graph's linear-response scope for nonlinear Drive. The graph does not pretend to represent Drive's amplitude-dependent harmonic distortion.

## 3. DSP versus analytical response

Added independent sinusoidal measurement through actual `SynthFilterRuntime::process` and the Nodes `SvfState::process` recurrence. Matrix: centers 370 Hz, 1 kHz, and 8 kHz; Gain −12, −6, 0, +6, +12 dB; Resonance 0, .25, .50, .547, .75, 1; probes at 0.5×, 1×, 1.5×, and 2× center. All **360 Synth/Nodes probe pairs** pass the 0.02 dB comparison tolerance. Worst Synth error: **0.00000110186 dB**. Zero-Gain unity, center boost/cut, and narrowing with increasing Q have explicit assertions.

Existing all-type, four-sample-rate response tests also pass: 6,656 independent Synth probes; worst meaningful error 0.0057791 dB. Added real-engine assertions verify authored and modulated per-voice Q/Gain telemetry for every supported type. UI assertions verify effective Frequency/Q/Gain update the response stroke and handle without overwriting authored values.

See [measurement CSV](peak-response.csv), [focused core log](focused-core.txt), and [focused UI log](focused-ui.txt).

## 4. Handle semantics

PEAK: horizontal drag edits center Frequency; vertical drag edits Gain, preserving Q. Full-wet handle position is at the bell center and Gain. At partial Mix it stays on the actual mixed response rather than falsely drawing the raw Gain position. Dragging is anchored to the initial authored value, preventing a jump when grabbing the dot. Existing other-type Frequency/Resonance behavior is preserved.

## 5. Grid and fill

Previously the first major frequency line used borderSoft at 50% alpha, but label painting changed the Graphics colour; 1k and 10k inherited the brighter muted label colour. Each of 100 / 1k / 10k now explicitly uses neutral theme borderSoft at **35% alpha** before drawing. Labels retain their existing positions and colours. A pixel assertion verifies equal, subdued treatment across all three lines.

Gain-bearing responses now fill subtly between their curve and 0 dB, supporting both boost and cut. Zero-Gain PEAK does not flood the region below its unity line. Non-gain types retain the existing graph-floor fill. Response math, white stroke, dark accent colour/alpha, axes, and truthful handle placement remain unchanged.

## 6. Layout

All bounds are panel-local logical pixels `(x, y, width, height)`.

| Region | Before | After |
| --- | --- | --- |
| Whole container | (0, 0, 662, 355) | unchanged |
| Graph including axes | (130, 66, 520, 181) | (130, 66, 520, 189) |
| Inner plot | (174, 72, 468, 153) | (174, 72, 468, 161) |
| Footer | (130, 259, 520, 80) | (130, 267, 520, 80) |
| Five-control bank | (155, 263, 470, 72) | (155, 271, 470, 72) |
| Six-control bank | (156, 263, 468, 72) | (156, 271, 468, 72) |

Knobs, values, and labels translate down together by 8 px. Knob bodies stay approximately 32 px; value fields stay 64 × 16; labels and internal gaps stay unchanged. Labels end at y=343, leaving 12 px to the outer panel bottom. Header and source rail are unchanged. Recovered space enlarges the graph without changing the 12 px graph/footer gap.

## 7. Files and final diff audit

Production: `plugin/ui/SignalPanels.cpp`, `plugin/ui/SignalPanels.h`.
Tests: `tests/FilterResponseTests.h`, `tests/EngineTests.cpp`, `tests/PluginTests.cpp`.
Evidence: `docs/qa/filter-peak/`.

| Audit question | Answer |
| --- | --- |
| Actual PEAK DSP changed? | NO |
| Filter coefficient generation changed? | NO |
| Response mathematics changed? | NO |
| Graph interaction semantics changed? | YES: PEAK vertical drag edits Gain |
| Routing changed? | NO |
| State/schema changed? | NO |
| Modulation architecture changed? | NO |
| Source rail changed? | NO |

Panic, type catalog, audio runtime, and Nodes implementation remain unchanged. Fill closure and grid/layout rendering changed only in the Synth UI.

## 8. Tests

Focused Plugin/UI: **1,609,517 checks passed**. Focused core: **1,355,726 checks passed**. Existing LOW PASS, all-type, routing, state, interaction, and Panic regressions remain covered. `git diff --check` passed. No separate DSP performance benchmark was needed because no runtime code changed.

## 9. Final rebuild / AU validation

The required normal `./origami/scripts/rebuild-dev.sh` completed successfully (exit 0), rebuilt/deployed Standalone, AU, and VST3, and explicitly reported **AU VALIDATION SUCCEEDED**. Gates passed: 1,609,517 Plugin/UI checks; 1,355,726 core checks; 648 FX checks; 98 content-library checks. See the [full rebuild and validation log](rebuild-dev.txt).

## 10. Visual QA

Inspected every case A–H in [case contact sheet](cases.png): PEAK 370 Hz with zero Gain at Resonance 0/.547; +12 dB at Q minimum/maximum; −12 dB at Q minimum/maximum; LOW PASS 8 kHz at Resonance minimum/maximum. Unity is flat; nonzero bells visibly narrow as Q increases; handle locations and boost/cut fill are truthful. Inspected [before/after layout](layout-comparison.png) and [whole plugin](whole-synth.png). The quieter consistent grid no longer competes with the curve. The full bank sits lower, retaining readable values/labels and deliberate bottom space. This is offscreen visual inspection and automated gesture testing, not a claim of new manual host interaction testing.

## 11. Commit

The exact resulting local commit SHA is returned in the completion message. No push is performed. This correction ends with that commit.
