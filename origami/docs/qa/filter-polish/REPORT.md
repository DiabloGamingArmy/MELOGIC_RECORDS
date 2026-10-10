# Synth Filter visual hierarchy and precision polish

Baseline e4b82f5d048bb6c2331ef876815eb8fc8c249036. Branch mct-origami-nodes-visual-feedback-p03. Local-only commit; no push.

## 1. Visual audit

[AUDIT.md](AUDIT.md) records the pre-edit measurements and primitive review. No new screenshot was attached to the text request; the available baseline was the previous committed actual editor/whole-Synth renders. At the canonical 662×355 FilterPanel, the graph was 520×165 with a 504×149 plot; header was 520×32 with its own outline. Type/Out/Power each had separate large visual boxes. The 520 px parameter row distributed controls over its full width, with 55 px slider stacks and strong value outlines. Frequency labels sat inside fill, only the top dB bound was labeled, and the handle encoded resonance as vertical position instead of meeting response. Shared source header and selected header had different centers. The existing knob painter had an active arc but no inactive arc track.

## 2. Layout system

FilterPanel::EditorMetrics now names insets, gaps, control dimensions, axis gutters, parameter stacks, bank width and fill treatment. The common inner editor remains x130..650 at normal panel size. Selector strip is (130,34,520,24), centered at y46 with SOURCE. Graph is (130,66,520,131). Parameters are (130,209,520,130), ending at y339 with 12 px bottom margin. Header, graph and parameter section share horizontal bounds.

The plot is (174,72,468,103). A 36 px left level gutter and 16 px bottom frequency strip reserve text space outside fill. Normal parameter bank is 437 px wide (84.04%), centered at x172, y222, height104. Five cells are 87 px wide; six cells are 72 px. At compact standalone panel fixtures, minimum cell width takes precedence over 84% grouping. Actual plugin resizing scales the existing canonical design canvas (960×600 minimum to1920×1200 maximum), preserving control layout.

## 3. Header changes

TYPE is subdued beside the unchanged104 px native type selector. OUT is a separate label beside a100 px destination selector; its displayed value/chevron and tooltip come from existing routing state. Existing native routing menus and commands are retained. Power uses Origami's existing ToggleButton style,42×24, with ON/OFF text and synchronized state. All controls retain keyboard focus and24 px hit height. The extra structural header rectangle is removed; interactive outlines remain.

## 4. Graph changes

Graph height165→131 px (20.6% reduction); plotting height149→103 px (30.9%), including recovered space for axes. The mathematical range stays +18..−60 dB, or +36..−60 for gain-bearing modes. The frequency domain, coefficients, sample-rate clamp and complex response provider are untouched.

Fill uses the same theme-derived signalSurfaceColour primitive with exposure.32/alpha.16, down from.46/.22. Fill remains closed from the exact response path. White1.3 px stroke stays primary; no accent floor line is introduced. Major100/1k/10k ticks align to their log grid lines in a dedicated strip. Left-gutter labels show the actual upper bound,0 dB,−24 and−60; zero receives the stronger neutral reference. No labels overlap the response fill.

The7 px handle sits at the actual calculated response magnitude at effective cutoff (8 px on hover/drag). The exact cutoff sample is included in the stroke, which matters at a narrow notch between ordinary samples. This changes sampling/presentation, not transfer math. Horizontal movement edits canonical frequency. Vertical movement is anchored to the gesture's starting resonance; grabbing the curve does not jump values. Effective telemetry drives the handle as well as stroke. Hover uses a pointer cursor and restrained theme accent. Bypass/partial Mix continue using the validated complex response.

## 5. Parameter bank

Five controls form one centered84% bank; Gain-bearing types retain six controls. Every stack shares slider y222/height84, editable value height18,4 px value-to-label spacing and label y310/height16. Value fields are66 px wide normally and narrow only when cells require it. Their outline uses the neutral border token. Knobs use the existing reusable.88 visual-scale facility and a neutral inactive track added as an opt-in to the shared painter. Other controls keep their previous default paint. Active arcs and pointers still represent actual parameter positions; zero controls remain visibly present.

## 6. Source rail

Width116 px is retained. Reducing it would diverge from the canonical Modulation rail. SOURCE remains18 px high; the24 px selector strip is centered on the same y46 baseline, intentionally extending3 px above/below the smaller source title. Shared rows, grips, selected accent,36 px row pitch, scrolling and fixed−/+ footer are unchanged. The shared31 px title shelf is retained for cross-panel consistency.1/3/8-filter renders confirm intentional list capacity, readable rows and selected-filter visibility; no decorative filler was added.

## 7. Borders and hierarchy

Removed the structural header perimeter while retaining outlines for actual selectors, power, selection, source containment and graph. Value borders are subdued. Dedicated axes and spacing now communicate graph/parameter separation; the response stroke is the primary graph object. Shared source chrome remains intact.

## 8. Files changed

- plugin/ui/SignalPanels.h/.cpp: named geometry, compact selectors/toggle, plot/axis layout, attached handle and anchored gesture presentation.
- plugin/ui/OrigamiStyle.h/.cpp: opt-in neutral inactive track in the existing shared knob painter; all other callers retain defaults.
- tests/PluginTests.cpp: structural, canonical interaction, telemetry and expanded offscreen fixtures; previous layout expectations use the new plot region.
- docs/qa/filter-polish/: audit, report,29 actual renders, contact sheets, per-render inspection and validation evidence.

## 9. Protected systems

**DSP: unchanged. Routing core/topology/gains/FilterId: unchanged. StateCodec/schema: unchanged. Modulation compiler: unchanged. Panic UI/runtime: unchanged. Voice/audio runtime: unchanged. Filter type catalog: unchanged.** OUT/power/knob/handle controls continue calling the existing canonical state commands. The only shared style change is the optional knob track. The prior response kernels and mapping semantics were not edited.

## 10. Tests

Focused Plugin/UI: **1,608,978 checks passed**, including all prior type/save-load/source/drop/removal/Panic and plugin continuity regressions. Added synthFilterPrecisionVisualAudit checks source/editor non-overlap, common header centerline, axis containment/separation, handle-on-transfer geometry, equal knob/value/label baselines, label widths, accessible selector hit areas, canonical power changes, serial-drop preservation and supported minimum-size scaling. Explicit mouse-down/drag/up checks verify no resonance jump and correct horizontal/vertical edits. Existing telemetry fixture additionally verifies effective handle movement without overwriting authored controls.

The normal deployment gate re-runs the Plugin/UI/core/FX/content suites. Final deployed counters: core **1,355,116**, Plugin/UI **1,608,978**, FX **648**, content **98**. [Deployment output](rebuild-dev.txt) and [focused UI output](focused-ui.txt) are retained; previous core/state/routing/Panic tests remain enabled without implementation changes.

## 11. Offscreen visual QA

All29 generated actual editor renders were inspected, first individually for primary cases and then in four contact sheets. [VISUAL-QA.csv](VISUAL-QA.csv) explicitly records header density, alignment, graph height, fill, axes, handle relationship, parameter grouping/rhythm, border density, clipping and per-state visual balance for every render.

| Required state | Inspected result |
|---|---|
|100 Hz|Handle attached at100 Hz; descending transfer and subtle fill reach the intentional neutral floor.|
|1 kHz|Handle and1k grid agree; labels remain outside response; transition moves right.|
|8 kHz|Compact header and restrained graph balance with larger grouped controls.|
|20 kHz|Handle remains inside graph perimeter at right endpoint; mathematically correct curvature retained.|
|High resonance|Maximum-resonance peak remains within intended+18 dB range, clear of header and dB gutter.|
|1 filter|Empty list capacity reads intentionally; fixed footer and parameter section remain coherent.|
|3 filters|Shared rows retain clear grip/selection; no rail/editor collisions.|
|8 filters|Selected last row remains visible with fixed footer; earlier rows scroll normally.|

Additional5k/10k, resonance0/.6/1 (plus default.1), Mix0/.25/.5/.75/1, all seven other Synth modes, default/cool/bright accents, compact532×300 and whole1440×900 were inspected. Fill remains secondary even with bright yellow; zero-knob tracks remain clear; notch handle meets the exact transfer minimum; shelves/Peak retain six aligned controls and+36 dB labels. Compact arcs were refined using existing visual scale to avoid touching neighboring controls.

## 12. Full validation

`git diff --check` and the final protected-path diff audit pass. The repository entry point is `./origami/scripts/rebuild-dev.sh`: build all products, run normal regression gates, deploy Standalone/AU/VST3 and validate the installed AU. The dev script completed successfully; final evidence records literal **AU VALIDATION SUCCEEDED**. [Final CTest](ctest.txt): **7/7 suites passed**; [suite details](test-details.txt) retain exact counters (state2,782; modulation3,938; wavetable PASS). No source changes follow final successful validation.

## 13. Known limitations

A new manual-QA screenshot was not attached; prior actual renders and current source were the visual baseline. Offscreen/native event fixtures are not claimed as live mouse/audio manual QA. The compact532 px panel is an additional stress fixture; supported plugin resizing scales the canonical canvas. A partially visible unselected row at the top of a scrolled source list is intentional; the selected row and footer stay visible. Graph values clip at the existing dB bounds. Vertical handle gestures edit resonance as a relative parameter gesture, not as an inverse magnitude calculation. Comb availability and all prior DSP/state limitations are unchanged.

## 14. Manual checklist for deployed Standalone

Not claimed performed:

1. Open Synth.
2. Add Filter.
3. Confirm source rail/editor alignment.
4. Confirm Type selector is compact/readable.
5. Confirm OUT selector is compact/readable.
6. Confirm power is clear but subordinate.
7. Set LP cutoff100 Hz.
8. Inspect graph.
9. Set1 kHz.
10. Inspect graph.
11. Set8 kHz.
12. Inspect graph.
13. Set20 kHz.
14. Inspect graph.
15. Sweep resonance.
16. Confirm handle follows response.
17. Drag horizontally.
18. Confirm Cutoff knob/value follows.
19. Drag vertically.
20. Confirm Resonance follows without an initial jump.
21. Confirm frequency labels remain readable.
22. Confirm0 dB reference is understandable.
23. Confirm fill is subtle.
24. Confirm no bright accent baseline.
25. Confirm controls read as one parameter bank.
26. Add3 filters.
27. Confirm source rail.
28. Fill to8 filters.
29. Confirm rail/selection/footer.
30. Resize within supported dimensions.
31. Confirm no clipping.
32. Test an alternate accent.
33. Confirm graph remains visually balanced.

## 15. Exact commit SHA

The exact local commit SHA is returned in the final delivery message. This report belongs to that commit and cannot embed its own self-referential hash. No push; stop after delivery.
