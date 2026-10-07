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

Results and PR/commit references are recorded below after validation.
