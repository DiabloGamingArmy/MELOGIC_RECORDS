# Synth filter visual correction #2

Baseline: `1396d2f4a443c45e2bd20d24d721a89453d6ac5e`. Branch: `mct-origami-nodes-visual-feedback-p03`. No push.

## 1. Why the previous correction still looked wrong

The previous pass restored row chrome and source-rail metrics, but retained the old editor composition: a separate caption above detached OUT/power buttons, routing below the graph, an oversized graph allocation, and knobs packed against the lower boundary. A sparse rail still ended in individual buttons without a visibly integrated footer band. Matching source-card pixels alone did not establish the requested navigator/editor hierarchy.

Before editing, the actual Modulation panel was traced through SourceRailLayout, SOURCE painting, SourceEntityButton/ModulationSourceRow, viewport/content stacking, source history painting, rail spacing and footer controls. The Modulation editor and source architecture remain the reference, not a newly redesigned target.

## 2. Exact structural changes

The persistent rail retains Modulation's 116-pixel width, 18-pixel SOURCE header, 36-pixel row stride, two-pixel row gap, three-pixel top gap, six-dot grip, selection outline and vertical wheel/trackpad viewport. Its empty list area is contained by the continuous inset rail perimeter. A raised footer band and thin separator now enclose the existing minus/plus controls inside that perimeter, terminating the collection visibly rather than leaving floating buttons.

Selected-filter composition uses one set of EditorRegions for painting and component bounds:

1. A compact 28-pixel header groups LOW-PASS / PER VOICE, the actual OUT control and power.
2. A 26-pixel routing/status row places canonical IN immediately below OUT, with a thin separator.
3. The coefficient-derived response follows a six-pixel gap, with eight-pixel plot padding and the unchanged theme-driven bottom accent edge.
4. An eight-pixel gap separates the response from a deliberate 96-pixel parameter region. It has a thin top separator and 12-pixel inner vertical padding, preserving knob/value/label sizes.
5. Twelve pixels remain below the parameter region, above the panel boundary and keyboard.

At the normal 662×355 filter bay, the graph is 143 pixels high rather than dominating the editor. Selection changes and resize automatically reveal the selected row fully in the list viewport, including FILTER 8. Ordinary model polling preserves deliberate user scrolling. The SOURCE header and footer remain fixed.

## 3. Shared / reused UI primitives

Retained SourceEntityButton, sourceRailLayout, paintSourceRailHeader, sourceListTopGap/sourceRowGap and the existing OrigamiLookAndFeel row treatment. Added paintSourceRail beside those primitives to compose the sparse rail surface and footer using existing Palette tokens. Filter editor regions are UI geometry only. Existing Panel, well, typography, border tokens, parameter controls and `signalSourceColour()` remain in use. The actual Modulation panel implementation was not changed in this pass.

## 4. Files changed

- `plugin/ui/SignalPanels.h/.cpp`: editor-region geometry, composed header/status/graph/parameter areas, selected-row visibility.
- `plugin/ui/SourceEntity.h`: source-rail surface/footer composition.
- `tests/PluginTests.cpp`: actual 1/3/8-filter and Modulation-reference renders plus geometry/visibility checks.
- This report and four visual artifacts.

Paths are relative to `origami/`.

## 5. DSP / routing / state confirmation

**No DSP, core routing, processor, modulation compiler, topology or codec files changed.** Voice runtime, SynthFilterCollection, preparation, stable ID allocation, insertion/deletion semantics, schema 36, legacy migration, OSC/bus/FX/Nodes DSP, modulation and telemetry are untouched. Response mathematics is unchanged. Drag payload remains `MCT_SYNTH_FILTER:<id>`; Filter→OSC, OSC→Filter and Filter→Filter AFTER still call the existing canonical authoring commands. Add/Remove and capacity behavior are retained.

The render fixtures author real oscillator/filter connections using existing commands, so their IN/OUT labels are canonical rather than fabricated screenshot text.

## 6. UI test results

Affected Plugin/UI target built successfully. Focused Plugin/UI run: **1,607,390 checks passed**. `git diff --check` passed.

Existing tests still cover shared row pixel parity, selection, actual selected-control editing, eight-filter capacity, default/blue theme edge pixels, canonical drag/drop helpers, splice deletion, state roundtrip and Init. New checks cover ordered editor regions, response proportion, bottom breathing room, parameter containment, footer/list separation, selected-row visibility at 1/3/8 filters scrolling to the eighth row, and preservation of deliberate user scrolling across model polls.

## 7. Full validation

The final `./scripts/rebuild-dev.sh` completed successfully. Standalone, AU and VST3 were rebuilt and deployed; all required script regression gates passed:

- Plugin/UI: **1,607,390 checks**.
- Core: **553,597 checks**.
- FX graph/DSP/bus: **648 checks**.
- Content library: **98 checks**.
- Installed AU `aumu Orig Mctg`: **AU VALIDATION SUCCEEDED.**
- **MCT ORIGAMI DEV BUILD DEPLOYED + VALIDATED.**
- Final `git diff --check`: passed.

The source diff was verified to contain only the three UI source/header files and PluginTests before running the normal full rebuild. Documentation/images were added afterward. No DSP/routing/state-schema source changes.

## 8. One-filter offscreen render

Rendered the actual FilterPanel at 662×355 alongside the actual 778×355 ModulationPanel, on the canonical 1440×900 Synth canvas. Both read as SOURCE navigator plus selected editor. FILTER 1 is selected, its six-dot grip and outline match Modulation, and empty list space ends in the visibly owned footer band. The unified header shows OUT: MAIN / ON with IN: OSC 1 directly beneath. Response and parameter areas have deliberate separation; all value boxes/labels fit. The accent bottom edge remains visible.

[One filter beside Modulation](synth-filter-ui2-comparison-1.png)

## 9. Three-filter offscreen render

Three equal-height source cards stack with the same gaps as Modulation. FILTER 3 is selected, IN: OSC 1 is directly under the header, and OUT: FILTER 1 truthfully shows the inserted serial destination. Rail/footer ownership and editor proportions stay constant rather than resizing to the item count.

[Three filters beside Modulation](synth-filter-ui2-comparison-3.png)

## 10. Eight-filter offscreen render

The list scrolls to keep selected FILTER 8 fully visible; FILTER 1 is above the current viewport. No card intersects the fixed header or footer. Add is disabled at capacity. IN: OSC 1 / OUT: FILTER 3 reflects the existing serial insertion command. Parameter controls remain clear of the keyboard in the actual full Synth rendering. The graph and five controls retain the same geometry as the one- and three-filter views.

[Eight filters beside Modulation](synth-filter-ui2-comparison-8.png) · [Whole Synth canvas](synth-filter-ui2-synth.png)

All four images were inspected after rendering, including the actual full canvas for keyboard separation. Offscreen rendering and component-callback tests are completed; live manual mouse/DAW interaction was not performed. Existing Synth functional limitations remain unchanged.

## 11. Commit

One visual-correction commit on the current branch; exact SHA reported in delivery. No push and no further feature work.
