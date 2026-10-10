# Synth Filter UI proportion correction

Baseline: `8151f91b7def445f04a9b018a9c40859ace16d3a`. Layout-only follow-up at the same 662 × 355 FilterPanel dimensions, within the 1440 × 900 plugin editor. Bounds below use panel-local logical pixels as `(x, y, width, height)`; close-up screenshots are rendered at 2×.

## 1. Cause

The previous pass reserved 130 px for the footer and 104 px for each knob/value/label assembly. Its 84 px slider height produced roughly 53 px knob bodies, while an 84% bank width crowded the controls toward the center. That allocation reduced the response region to 131 px. The existing LFO FUNC implementation and actual render were inspected: its shallow footer and compact canonical knobs leave the waveform dominant. This correction applies that proportion principle without changing LFO code.

## 2. Graph bounds

| Region | Before | After |
| --- | --- | --- |
| Response including axes | (130, 66, 520, 131) | (130, 66, 520, 181) |
| Inner response plot | (174, 72, 468, 103) | (174, 72, 468, 153) |
| Header | (130, 34, 520, 24) | unchanged |

All 50 px recovered from the footer go to the graph, a 38% height increase. Graph/footer height allocation is approximately 69%/31%, excluding their gap. Total panel size stays unchanged.

## 3. Knob diameter

Canonical knob body diameter changes from approximately 52.8 px to 32 px. All five controls share the same diameter; the optional Gain control does too. The existing Origami painter is retained. Slider height changes from 84 to 54 px; textbox height and painter inset determine the remaining rotary area. Knob scale becomes 1.0 in this smaller area.

## 4. Parameter-strip bounds

The footer changes from `(130, 209, 520, 130)` to `(130, 259, 520, 80)`. Its bottom remains at y=339 with the existing 12 px panel-bottom margin. The five-control bank changes from `(172, 222, 437, 104)` to `(155, 263, 470, 72)`. Four-pixel internal top/bottom padding and a two-pixel value-to-label gap replace the larger spacing. Value fields change from 66 × 18 to 64 × 16; label height and font remain unchanged. Labels finish at y=335.

## 5. Horizontal spacing

The five-control cell pitch increases from 87 to 94 px. New centers are x=202, 296, 390, 484, and 578, with symmetric 25 px bank margins. The bank uses about 90% of editor width. Rounding to complete equal-width cells eliminates leftover asymmetric space. Six-control types use a 468 px bank with 78 px pitch.

## 6. Files changed

- `plugin/ui/SignalPanels.h`: compact footer/stack/value metrics and wider bank fraction.
- `plugin/ui/SignalPanels.cpp`: canonical knob scale and equal-cell bank rounding.
- `tests/PluginTests.cpp`: update existing geometry assertions and capture the actual LFO FUNC reference.
- `docs/qa/filter-proportion/`: this report, screenshots, comparison, and validation logs.

Production and test source diff: 12 insertions, 8 deletions across three files.

## 7. Protected behavior

Diff inspection confirms no changes to DSP, response math, routing topology, modulation semantics, state/schema, filter types, or Panic. Header, source rail, dark accent fill, white response curve, logarithmic axis, dB references, and attached cutoff handle retain their implementations. Parameter callbacks, ranges, editable-value parsing, menus, assignment and drag/drop paths are untouched. Core, PluginEditor, OrigamiHeader, and ModulationPanel files have no diff.

## 8. Validation

- Focused Plugin/UI suite: **PASS, 1,609,149 checks**; existing interaction, filter editing, menus, routing/drag/drop, type/state, and Panic coverage retained.
- `git diff --check`: passed.
- Normal `./origami/scripts/rebuild-dev.sh`: passed, deployed Standalone/AU/VST3 and reported **AU VALIDATION SUCCEEDED**.
- Rebuild suites: 1,609,149 Plugin/UI, 1,355,116 core, 648 FX graph/DSP/bus, and 98 content-library checks passed.
- No DSP performance benchmarks were rerun.

See [focused log](focused-ui.txt) and [rebuild/deployment log](rebuild-dev.txt).

## 9. Offscreen visual inspection

Inspected [before/after and LFO comparison](comparison.png), [final 8 kHz view](after-8000.png), [actual LFO FUNC reference](lfo-reference.png), [whole plugin](whole-synth.png), [eight-filter rail](eight-filters.png), and [six-control shelf](shelf.png). The enlarged response is the primary workspace; compact controls sit low with even distribution. Values including “8.00 kHz” and labels remain readable, with bottom breathing room and no wasted tall parameter area. The source rail, header, axes, subtle fill, and response-attached handle remain intact. This evidence is offscreen rendering, not a claim of new manual host interaction testing.

## 10. Commit

The exact resulting local commit SHA is returned in the completion message. No push is authorized or performed. This pass ends with this commit.
