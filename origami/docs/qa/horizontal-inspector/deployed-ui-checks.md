# Final deployed Standalone QA

Final rebuild-dev build, 2026-10-08. Performed through macOS accessibility and running-app screenshots.

- INIT Basic Shapes remains canonical 1/3 (AX 0.3333333).
- Nodes screenshot: upper toolbar absent, graph/sidebar extend to the top, nine graph commands share the existing Module Parameters header, no header overlap.
- Relocated Add Module opens searchable palette; Limiter search displays the expected row. Initial Return/coordinate attempts did not activate it. Explicit window Raise and clicking the search field before Return later allowed insertion.
- Relocated Templates creates the serial Drive/Delay/Reverb graph. Selecting Drive shows compact transfer visual, grouped knobs and inline modulation/advanced sections. Delay also shows horizontal groups.
- Spectral Tune inserted through Add/search/focused Return. Screenshot shows bounded pitch selectors/spectral display and Tuning/Character sections. Its horizontal accessibility scrollbar goes from 0 to clamped 740 and exposes the rightmost Range/Mix and Modulation sections without vertical clipping.
- Limiter inserted through the same focused palette path. Selection shows the beginning of its compact inspector, a tall bounded transfer graph, and tightly grouped Gain/Ceiling/Release controls.
- Relocated Clear opens Cancel/Clear confirmation. Confirming clears the QA graph back to the initial empty topology; no preset was saved.

Physical trackpad/wheel feel, continuous scrolled dragging, complete responsive window manipulation and subjective audio listening were not verified in this running-app session. Synthetic tests and real DSP telemetry captures cover those applicable programmatic interactions; screenshots do not establish subjective audio quality.
