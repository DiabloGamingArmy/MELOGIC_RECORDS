# Oscillator unison repair

## Audit and root cause

UNISON was already connected to `OscUnison` (OSC 1) or the independent oscillator module state (other oscillators). State/preset serialization and centralized gesture history already carried it. It was not an internal modulation destination; DETUNE remains one.

The old renderer had sixteen preallocated wavetable oscillators per module per MIDI voice, but reset every lane to the same phase, averaged them with `1/N`, and collapsed the result to mono before overall PAN. A separate center oscillator was then mixed using BLEND. INIT authored zero unison (rendered as one) and zero detune. Consequently, changing only UNISON on INIT produced identical, correlated, same-pitch mono lanes; even with detune, the center mix and averaging concealed much of the effect. The phase workspace was local UI state with no DSP or persistence.

This was incomplete DSP, not a missing parameter or a disconnected slider. MIDI polyphony and oscillator unison remain separate.

## Implementation

- Integer count 1–16 in registry, every oscillator card, validation and runtime. INIT now stores one; its exact Basic Shapes saw position remains `1.0f/3.0f`.
- Sixteen fixed wavetable lanes per oscillator per MIDI voice. Only active/fading lanes render. Existing BLEND still morphs between its center reference and the detuned ensemble; the pre-existing center reference renders only while its weight is nonzero (it is not an extra detuned unison lane). At full BLEND, sixteen means exactly sixteen oscillator evaluations.
- Positions `2*i/(N-1)-1` span the existing ±DETUNE cents range, with zero for N=1. Mirrored frequency ratios are exact reciprocals; odd counts include a center lane. Tuning symmetry is logarithmic/cents, not arithmetic Hz.
- Relative stereo weights `sqrt(1 - .7*position)` and `sqrt(1 + .7*position)` have symmetric total power. Existing overall PAN follows the ensemble, retaining hard-left/right isolation. Width propagates through stereo oscillator routes, filters, explicit Synth Filters and bus sends.
- Phase-domain OSC CHAIN operations necessarily read each oscillator's own phase/table. Post-generation cross-oscillator shaping, oscillator filters, Synth Filters, bus routing, FX and final Master process the combined ensemble, not sixteen copies of the downstream graph.
- Count edits interpolate output coefficients for 20 ms. Newly enabled lanes begin at zero weight; departing lanes retain phase/frequency while fading, then stop rendering. Detune and BLEND continue through existing modulation/dezipper paths. No resizing or DSP object construction during the callback.

### Phase

The default AUTO mode preserves legacy single-lane zero-phase starts and mono/legato phase continuation, while added unison lanes get independent deterministic phase starts. Explicit RAND also randomizes lane zero. Hash streams depend on voice slot, note lifecycle, stable oscillator ID and lane index. RANDOM RANGE and PER-UNISON now affect rendering. FIXED uses the authored angle; RETRIGGER controls note phase reset. FREE/non-retrigger modes preserve reusable voice-slot phases through release/stealing rather than clearing them on the envelope's idle reset. Inactive slots are parked, not rendered in the background. Engine reset restarts repeatable phase streams.

The phase workspace is now canonical state and centralized history, with schema 39 used only when nondefault phase settings require it. AUTO is shown for the compatibility default; selecting RANDOM/FIXED/FREE chooses an explicit mode.

### Gain

Decorrelated ensembles use `1/sqrt(N)` RMS normalization. For common/fixed phase starts near zero detune, the gain interpolates from coherent-safe `1/N` at zero cents to `1/sqrt(N)` at five cents. BLEND retains its existing linear center/ensemble crossfade. No clipping, limiting or nonlinear gain shaping was added.

Fixed-phase detuned ensembles naturally beat: short measurements can land in a trough. The four-second 16-lane sine test measured approximately 0.039 RMS in each channel versus 0.040 for one lane. Random-phase 1/2/4/8/16-lane measurements stayed approximately 0.036–0.040 RMS at the same level. Representative INIT chord peaks remained below full scale, including 4, 8 and 16 lanes. These are test patches, not a guarantee that arbitrary high-level chords/FX cannot exceed unity.

## Compatibility and safety

- Existing binary states through schema 38 and JSON presets migrate old zero to one. Historical states missing the appended parameter inherit one. Nonzero counts retain their authored count. New state strictly validates 1–16; malformed phase enums/booleans reject transactionally.
- Host project state, preset packets, oscillator copies and centralized Undo/Redo carry count and phase. A stepped drag is one history transaction. No new audio-rate topology modulation destination was introduced.
- Fixed arrays/cached ratios/coefficients only; no audio callback allocations, frees, mutexes or UI work. Count fades process only active/fading lanes. Output and meter architecture is unchanged.
- Approximately 7 KiB additional fixed storage per MIDI voice, primarily mixer coefficients and reusable phase storage. Compile-time memory caps remain bounded.
- WAVETABLE is the only enabled oscillator engine. Basic Shapes, custom wavetable reads, phase processes and spectral OSC CHAIN processes use this path. Disabled Granular/Spectral/Field engine choices remain placeholders; this does not invent DSP for them. Spectral OSC CHAIN processing is distinct from the disabled Spectral engine selector.

## Validation

Focused tests cover symmetric pitch/power distribution, actual spectral lines, integer bounds, repeatability across block sizes, phase controls/FREE continuation, peak/RMS/DC, mono fold-down, overall pan/level, wavetable/phase/spectral chains, live count/detune changes, note stealing, presets and state restore. Allocation guards exercise three oscillators at up to sixteen MIDI voices and sixteen unison lanes, rates 44.1/48/96 kHz and blocks 1/17/128/1024.

The local Release benchmark (48 kHz, blocks of 256, sixteen admitted MIDI voices, three oscillators, full BLEND) measured approximately:

| Unison | Oscillator lanes | Mean callback ms |
|---:|---:|---:|
| 1 | 48 | 0.24 |
| 2 | 96 | 0.33 |
| 4 | 192 | 0.43 |
| 8 | 384 | 0.59 |
| 16 | 768 | 0.91 |

Block deadline: 5.33 ms. These are local core-engine measurements, not an end-to-end DAW/FX guarantee. Scaling is bounded and approximately linear in added lanes.

Four existing single-lane golden renders remain bit-exact (modulation, phase chain, spectral chain and stereo filtering). Only the explicitly unison-bearing vibrato and mono-legato goldens are re-baselined for the intentional DSP repair; determinism and block independence remain asserted.

Final release gates passed:

- 1,643,929 plugin/UI checks, including the new integer-control, history, independent-oscillator and host-state tests.
- 2,594,683 core checks, including the unison DSP/stress audit and existing oscillator/filter/routing/polyphony/realtime regressions.
- 653 FX graph/DSP/bus checks and 98 content library checks.
- Remaining CTest suites: state, wavetable bank, modulation, Spectral Tune and spectral quality — 5/5 passed. All nine registered test targets are covered by these gates.
- AU validation succeeded; Standalone, AU and VST3 rebuilt and deployed.
- `git diff --check` passed.

Logs from this run: `/tmp/origami-unison-deploy.log`, `/tmp/origami-unison-ctest.log`. Final maximum-load core measurement was 0.925 ms/block. Automated signal/spectral checks were performed; no subjective listening claim is made.
