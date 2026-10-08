# Synth filter UI regression corrective pass

Baseline: `d4facdcea201da4d408bca6b1fd444d63f13f1fe`. Current branch: `mct-origami-nodes-visual-feedback-p03`. No push.

## 1. Root cause

The F01–F06 panel rewrite retained a left viewport but removed its structural well, fixed SOURCE header, established inner insets and collection-control spacing. Its bespoke 38-pixel stride/35-pixel rows and visible scrollbar also differed from Modulation. The missing chrome made the collection read as loose buttons rather than a persistent source rail.

Filter rows were plain TextButtons using the special FILTER SOURCE TAB centered full-height text path. Modulation rows use a top title chamber and six-dot grip in ModulationSourceRow. Thus the selected outline was related, but typography, grip and proportions diverged.

The new analytic response painter drew a neutral well and response path without the previous source-colored lower response treatment. It provided no explicit theme-colored graph edge. `Palette::accent()` is fixed gray in this repository, so the requested theme-following edge must use the existing `signalSourceColour()` token.

The audit compared current components/layout, ModulationSourceRow, shared SourceEntity/OrigamiLookAndFeel primitives and the pre-F01 SignalPanels implementation at `9513620`, before editing.

## 2. UI architecture

Extracted `SourceEntityButton` in existing SourceEntity.h. It uses the same JUCE TextButton/OrigamiLookAndFeel chrome and six-dot grip as the original ModulationSourceRow. ModulationSourceRow derives from it and retains its modulation-specific route-ring chamber, source payload, hit testing and route editing. Filter rows use that same base with the same MOD SOURCE TAB typography path. No second copy of row painting constants was introduced.

`sourceRailLayout`, `paintSourceRailHeader`, the 36-pixel base stride, two-pixel row gap and three-pixel list top gap are shared by both panels. Modulation retains its existing geometry and appearance. The rail is 116 pixels wide, with 4×5 inner padding, fixed 18-pixel SOURCE header, 24-pixel bottom collection controls, three-pixel control gap and six-pixel separation from the editor. Both use scrollbar-less vertical wheel/trackpad scrolling and full-width row outlines. Selection and hover paint identically for equal labels/states.

The selected filter editor occupies the remaining right area. Its domain caption gets its own 18-pixel band; OUT and power occupy the next 26-pixel row, avoiding caption overlap. The coefficient-derived curve, IN context, five working controls and existing modulation overlays remain. The graph gets a two-pixel bottom edge from `signalSourceColour()`, which follows theme changes. Response calculation is unchanged.

Filter drag listeners still emit `MCT_SYNTH_FILTER:<stable FilterId>`. Both OSC insertion directions and filter-to-filter AFTER authoring still call their existing canonical functions. Add/remove still use the same collection commands, stable IDs, eight-filter capacity and topology splice path.

## 3. Files changed

- `plugin/ui/SourceEntity.h`: shared source-card chrome and source-rail layout/header primitives.
- `plugin/ui/ModulationSourceRow.h/.cpp`: use extracted visual base; retain modulation interaction.
- `plugin/ui/ModulationPanel.cpp`: reuse existing geometry/header through shared helpers.
- `plugin/ui/SignalPanels.h/.cpp`: restore rail/rows, reflow selected editor, theme-following bottom line.
- `tests/PluginTests.cpp`: focused corrective coverage.
- This report and three offscreen render artifacts.

All source paths are relative to `origami/`.

## 4. Tests changed

Expanded the existing Synth filter UI audit to check shared row primitive and collection controls; selected/unselected stable identity; actual selected cutoff edits without changing another filter; pixel-identical Modulation/Filter source chrome for selected/unselected and hover states; shared width/height; knob containment and usable graph at representative and narrower sizes; theme-colored bottom pixels under default and blue themes; Add/select, eight-filter capacity tooltip/disabled state, and selected Remove with valid fallback selection.

Existing tests still exercise both oscillator/filter insertion directions, AFTER insertion, preserved buses, canonical knob targets, Nodes/Matrix identities, binary wrapper roundtrip, deletion splice and Init. The UI tests invoke real component callbacks and authoring helpers; they do not claim live OS mouse dragging.

## 5. Build / test results

Affected Plugin/UI target built successfully. Focused Plugin/UI run: **1,607,367 checks passed**. The normal `./scripts/rebuild-dev.sh` then rebuilt Standalone/AU/VST3, ran its regression gates, installed the development builds and validated the installed Audio Unit `aumu Orig Mctg`.

- Plugin/UI: **1,607,367 checks**.
- Core: **553,597 checks**.
- FX graph/DSP/bus: **648 checks**.
- Content library: **98 checks**.
- State: **2,744 checks**.
- Modulation: **3,938 checks**.
- Wavetable bank: **V22.0 foundation PASS** (no numeric counter emitted).
- **AU VALIDATION SUCCEEDED.**
- **MCT ORIGAMI DEV BUILD DEPLOYED + VALIDATED.**
- `git diff --check`: passed.

Final `ctest --test-dir origami/build-multihost --output-on-failure -V`: **7/7 passed**. Total Test time (real) =  35.54 sec.

Existing compiler warnings remain; no build/test errors.

## 6. Offscreen visual check

The panel was rendered and inspected at **662×355** (the filter bay on the canonical 1440×900 canvas) and **532×300** (narrower layout). Both show a bordered persistent left rail, fixed SOURCE header, six-dot grips, matching source-card typography/selected outline, bottom collection buttons, right editor, OUT/power, IN context and five unclipped controls. The graph retains useful height and its colored bottom edge is visible. A blue-theme render verifies the edge and selected outline follow the signal theme while the response curve retains its existing neutral color.

- [Representative panel](synth-filter-ui-corrected.png)
- [Narrower panel](synth-filter-ui-corrected-compact.png)
- [Blue theme](synth-filter-ui-corrected-blue.png)

## 7. DSP / routing / state confirmation

**No core, DSP, processor, routing, compiler or codec files changed.** No changes to Voice runtime, SynthFilterCollection, preparation, FilterId allocation, insertion/splice semantics, modulation compilation, v36 serialization, legacy migration, bus/Nodes/FX routing, oscillator DSP, source architecture, Panic, Random or events. Existing filter response mathematics is unchanged. Shared changes are exclusively UI chrome/layout primitives and their callers.

## 8. Known limitations

Manual live mouse/DAW QA was not performed. Offscreen rendering, component callbacks, existing routing regressions and host AU validation are separate evidence. Modulation sources with routes retain their taller ring chamber; Filter rows match the unrouted source entity treatment and retain the selected-filter editor's existing modulation overlays. Vertical scrolling uses wheel/trackpad without a visible scrollbar, matching Modulation. Existing Synth limitations from F01–F06 are unchanged.

## 9. Commit

One corrective commit on the current branch; exact SHA reported in delivery. No push or further patch line.
