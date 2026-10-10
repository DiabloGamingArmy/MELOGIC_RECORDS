# Actual deployed application inspection

Inspected `/Applications/MCT Origami.app` through native app UI automation after the normal rebuild-dev deployment and successful auval. This is separate from offscreen component snapshots.

Fresh-launch accessibility model:
- Exactly one WAVETABLE mode group and one enabled PWR oscillator; screen count `1 MODULES`.
- BASIC SHAPES; WT slider `0.3333333` (authored float `1.f/3.f`).
- OCT/SEM/FIN `0/0/0`.
- UNISON `0`, DETUNE `0.0`, BLEND `0.500`, PAN `0.000`, LEVEL `1.000`.
- ENV1 `0.0100000 / 0.5000000 / 1.0000000 / 0.0000000`; AUTO amplitude ownership shown.
- Screenshot: oscillator saw ramp and `NO PROCESSING OR ROUTING`, empty Synth Filter bank (`NO SYNTH FILTERS`), and one oscillator card.

Interaction:
1. Opened NODES: neutral MAIN IN → MAIN OUT graph.
2. Used `+ ADD MODULE`, searched Compressor and inserted it.
3. Actual card and selected inspector showed enlarged model regions with compact lower knobs and low labels/values, compact headers and unchanged footprints.
4. Changed graph THRESH slider `.700 → .750`; selected inspector and full parameter panel updated to `.750`; screen showed −15 dB. This confirms deployed control/model synchronization.
5. Used header `... → INIT PRESET`. Compressor controls disappeared, Undo became disabled and the neutral graph returned.
6. Returned to SYNTH. Accessibility model again showed exactly one WAVETABLE/BASIC SHAPES oscillator with WT1/3, pitch0/0/0, unison0, detune0, blend.5, pan0, level1; ENV1.01/.5/1/0 and no filter entries.

No preset was saved during this inspection. Application left on canonical Init.
