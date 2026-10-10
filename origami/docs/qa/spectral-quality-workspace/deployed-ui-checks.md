# Final deployed Standalone checks

Build: final rebuild-dev deployment, 2026-10-08. Performed through the running macOS app accessibility interface and screenshots; no offscreen tests are counted here.

- INIT Basic Shapes position reports 0.3333333, corresponding to the existing canonical 1/3 default.
- Nodes opens; screenshot confirms one routing selector, compact graph toolbar, and zoom/Fit/Auto Layout inside the Module Parameters header.
- Hamburger native menu lists Undo, Redo, Browse Presets, Save Preset, Init Preset, Global FX, Capture Keyboard Input. No empty selectable separator items appear in the accessibility menu. Initially Undo/Redo are disabled.
- Browse Presets opens the existing browser (search, Sort, Close, Favorite, Load); Close returns to Nodes.
- Serial Chain template creates Drive, Delay, Reverb. Drive selection shows a full-width labeled static shaper and unified vertical inspector.
- Pointer scrolling returned server `noWindowsAvailable`. A refreshed accessibility tree remained available. Setting the inspector scrollbar to 100 then 1000 moves the content and clamps at 242; selecting Delay resets scroll to 0.
- Undo is enabled after template insertion. Invoking it restores the initial graph; the next menu has Undo disabled and Redo enabled.
- Save Preset opens the existing form. Return also triggered its empty-name validation; that message was dismissed, the form fields and Save As New/Cancel were observed, and Cancel closed the form. No preset was written.

The graph was restored to its initial topology. Running-app all-effect drag/modulation/wheel/resize interactions were not exhaustively checked; their offscreen coverage is documented in REPORT.md. Native popup screenshots do not consistently include the separate floating menu surface, so corrected command/separator structure is verified from accessibility plus source, not claimed as a captured visual separator audit.
