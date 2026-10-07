# NODES visual feedback pass

## Baseline and scope

Baseline: `153bed2c2db0f7e2874fa59a9971520c95d47223`, branch
`mct-origami-manual-qa-ui-wavetable-fixes` (PR #316), after the content
browser (#315), nested modulation (#314), stereo/performance work, and
NODES N01–N07. The remote was fetched and the open PR stack inspected before
branching. Main is not the development baseline.

Branch: `mct-origami-nodes-visual-feedback`.
Safety tag: `safety/origami-nodes-visual-feedback-20261006`.
Stacked PR targets the baseline branch; do not merge.

No changes to core, PluginProcessor, audio callback, parameter descriptors,
DSP, state serialization, routing validation, modulation evaluation, smoothing,
or compiled audio execution. No new audio telemetry publication.

## Audit and implementation

`FxPage` owns the audio canvas, CONTROL canvas, selected-module inspector,
parameter list, Matrix sidebar, shared macros and 30 Hz page timer.
`FxNodeComponent` owns normalized quick sliders; `ControlNodeComponent` owns
typed sockets, primary operator fields and sequence/event displays.

FX controls already carried bus-qualified canonical destination properties,
but their plain sliders did not paint modulation. The SYNTH macro/LFO controls
already shared `paintKnobModulationOverlay`; oscillator cards have an older
inline equivalent. FX quick knobs and inspector knobs now use that existing
shared painter, and linear parameter rows use the same red range/current dot.
NODES' shared macro panel also uses the painter and published effective macro
values. No SYNTH visual behavior was changed.

One aggregate interval sums each enabled route's minimum/maximum contribution
using the canonical polarity helper. Opposing depths no longer erase each
other. Selected-source presence brightens this one arc. Individual routes stay
in Matrix. A route with modulated depth gets a conservative possible-depth
envelope. This envelope is not a prediction of correlated source motion.

Current FX positions use a private message-thread `CompiledModulation` instance:
compile on model synchronization, then call its existing `fxFrame` on published
source slots. No oscillator/operator is advanced. This includes nested depth
and operator sources without a second implementation of their evaluation.
The dot is a sampled control position, not sample-exact post-smoothing DSP
telemetry: immediate UI weights may lead the audio route's short smoothing
transition, and source snapshots have their existing cadence.

Full graph detail starts at 60%. From 45% to 60%, response previews and tiny
labels disappear but knobs/arcs/dots remain. Below 45%, knobs disappear.
Zoom changes immediately update visibility, fixing the prior need for another
model edit. Existing CONTROL semantic zoom is retained.

Audio and CONTROL node outlines/ports brighten on hover. An individually
hovered audio socket gains a ring. Existing audio port hit radius remains at
least 12 screen pixels (14 graph units); CONTROL ports retain their nearest-port
hit testing. Existing valid-target highlighting and routing checks are reused;
unavailable audio inputs dim during a wire drag. Selection already had a clear
red outline and remains unchanged. Bypassed effects dim the body/knobs/preview
and explicitly say BYPASSED. Double-click resets use the existing descriptor
default. Wheel navigation, drag sensitivity, fine adjustment and bindings stay
unchanged. Existing editor modulation-drop handling remains in charge.

## Preview inventory: before → after

| Processor | Baseline | This pass |
|---|---|---|
| EQ | Enabled-band response using canonical SVF design/magnitude | Retained, cached in node; identified as parameter model |
| Filter | Canonical SVF response, analytic comb branch | Retained, cached; cutoff/type/Q follow authored settings |
| Compressor | Knee/ratio transfer; three curves for multiband | Retained, cached; no claimed measured GR |
| Drive/distortion | Illustrative tanh drive/bias curve | Retained, cached and explicitly a parameter model |
| Spatial | Parameter-derived voice width/amount layout | Retained, cached; not a vectorscope |
| Gain | Configured gain bar/inversion label | Retained, cached; not a measured output meter |
| Stereo utility | Width/balance diagram | Retained, cached |
| Delay | Time/feedback taps with alternating ping-pong lanes | Retained, cached |
| Reverb | Predelay/RT60 energy-decay model | Retained, cached |
| Phaser | Stage/centre-frequency notch model | Retained, cached; no invented LFO phase |
| Flanger/Comb | Parameter-derived comb response | Retained, cached; no invented LFO phase |
| Chorus | Parameter-derived phase traces | Retained, cached; no free-running decorative animation |
| Diffuse/Limiter | Diffusion/ceiling models | Retained, cached |
| CONTROL | Real event counters, gate state, sequencer current step; parameter/source identity | Retained, hover enhanced |
| Routing | Split/merge topology and typed endpoints | Retained, hover enhanced |
| MAIN IN / OUT | Existing actual L/R peaks and UI decay | Retained |

Previews are clipped and reserve a label strip. Lazy node caches regenerate
only when effect parameters or bypass change, never just because a modulation
dot moves. They are authored-parameter models, not effective-modulation response
curves. Existing EQ/filter reference response uses 48 kHz; this pass does not
claim a new sample-rate-aware measurement.

## Telemetry, refresh and budget

Existing runtime snapshot contains source slots, operator event counters,
sequencer step, effective macros, and oscillator waveform/phase data. Existing
MAIN IN/OUT peak publication is available. It does **not** contain effect-input
or effect-output audio, compressor gain reduction, effect LFO phase, or stereo
cross-products. The existing wavetable FFT is an offline editor/compiler tool,
not a reusable bus audio analyzer. No FFT engine or analysis worker was added.

The page samples at 30 Hz. Graph knobs request repaint at 15 Hz; selected
inspector controls and modulated shared macros at 30 Hz. Offscreen audio nodes
are rejected before repaint traversal. Hidden page stops its timer; hidden
ancestors/minimized windows make the callback and explicit refresh return
before telemetry reads. Existing control-monitor and meter architecture remains;
this change does not eliminate every pre-existing sidebar/background timer.

Memory additions: one 74,488-byte UI modulation plan, one runtime snapshot,
one FX frame, plus at most 39,936 bytes per lazily painted 192×52 node preview
(excluding object/image allocator overhead). Sixty cached previews would be
2,396,160 bytes; unpainted offscreen nodes have no preview image. There is no
per-node FFT, worker, history buffer, or audio-thread allocation.

## Deliberate deferrals

Live EQ/filter spectra, mirrored distortion spectral energy, compressor measured
input/output/GR, Spatial vectorscope/correlation and per-effect utility meters
are deferred: correct inputs are not exposed, and using MAIN OUT for each node
would falsely attribute the same signal to different processors. Adding and
measuring a bounded tap/worker architecture is separate work, not hidden in this
UI pass. Likewise, audio-cable energy and routing activity are deferred because
there are no endpoint peaks. Existing CONTROL event/gate/sequence feedback is
retained; no additional full-canvas cable animation is introduced.

## Manual QA

1. Route an LFO to a NODES FX knob; play a held note. Check red range and moving
   dot; base knob must stay still. Check the inspector's knob and linear row.
2. Add an opposing second source and modulate route depth. Check one readable
   aggregate range; inspect individual routes in Matrix.
3. Modulate a shared macro; compare its NODES and SYNTH effective positions.
4. Open EQ, Filter, Compressor, Drive, Spatial and Gain. Confirm their different
   parameter models respond to edits. Sweep cutoff, ratio and drive. These are
   not live spectra, a vectorscope or measured gain reduction.
5. Check Delay time/feedback/ping-pong, Reverb decay, and stereo width models.
6. Zoom through 100%, 50%, 30% and back. Previews/controls simplify immediately.
7. Hover nodes and sockets, drag cables to valid/invalid targets, move/select
   nodes, bypass effects and double-click a knob to reset.
8. Play hard-panned content and check actual MAIN IN/OUT L/R meters.
9. Hide NODES, hide/minimize the editor and reopen; check refresh resumes without
   elevated ongoing rich-visualization work while hidden.
10. Spatial scope, distortion spectrum and measured compressor-GR reaction are
    explicitly deferred, so they are not acceptance claims for this build.

## Validation results

### Structural / DSP-scope audit

Final branch audit against baseline `153bed2c2db0f7e2874fa59a9971520c95d47223`
confirms that this pass changes only NODES UI/telemetry presentation, its plugin
regression coverage, and this QA record. It does not modify `core/`,
`PluginProcessor`, effect processors, parameter descriptors, state codecs,
routing compilation, modulation evaluation, smoothing, or the audio callback.
The UI evaluator consumes the already-published runtime snapshot on the message
thread; authored slider values are never written from effective modulation.

The plugin regression includes an audio-transparency twin-render: one processor
is observed through the live NODES/Matrix visualization paths while an
identically configured processor is not observed. Their rendered float buffers
must compare bit-for-bit equal. This is the acceptance guard for the
"visualization must not change audio" requirement.

### Regression gates

The final development build completed and deployed Standalone, AU and VST3.
The full gates passed:

- plugin/UI: **1,606,314 checks**
- core: **233,613 checks**
- FX graph/DSP/bus: **628 checks**
- FX stress gate: 32-node x16-voice / empty x16-voice CPU ratio **3.91971**
- `git diff --check`: clean before the handoff commit

The NODES visual regression covers: modulation arc appearance, moving effective
dot, unchanged authored knob value, opposing-route aggregate range, disabled
route exclusion, nested route-depth evaluation, node hover, enlarged port hit
target, compatible-target emphasis, semantic zoom at 100/50/30%, bypass
presentation, hidden-page telemetry suppression, and the audio-transparency
comparison described above.

### Performance / rendering audit

The diagnostic harness is deliberately opt-in through
`ORIGAMI_NODES_VISUAL_REPORT`; normal regression runs do not pay for repeated
software snapshots or write QA images. It measures hidden refresh cost,
5/20/60-node graphs at 100% and 30% zoom, active modulation refresh, cached
preview memory, and a selected-EQ frame. These are software-renderer diagnostics,
not GPU/compositor frame-time claims.

During the implementation run, warmed default-zoom software rendering was
approximately **1.3 ms for 5 nodes** and **2.3 ms for 20 nodes**. Treat those as
diagnostic measurements rather than release thresholds: machine load, software
snapshotting, font rasterization and cache warmth affect them. The regression
instead enforces the architectural budget directly: hidden pages return before
telemetry reads, offscreen nodes are excluded from repaint traversal, previews
are lazy/cached, modulation refresh does not invalidate preview images, and
there is no per-node FFT/worker/history allocation.

### Final disposition

Accepted as a **UI-only NODES visual-feedback pass**, pending the manual visual
QA above in the actual plugin host. The intentionally deferred live per-effect
analyzers remain out of scope until Origami has truthful, bounded per-node
telemetry. Do not substitute MAIN OUT for node-local measurements.

Handoff implementation commit: `e33aa9dd69f2f4ca077aa6d5011247b9f16d3ef5`.
Final validation/documentation is committed on the same
`mct-origami-nodes-visual-feedback` branch. The stacked PR targets
`mct-origami-manual-qa-ui-wavetable-fixes`; it must not be retargeted to
`main` while the dependency stack is still open.
