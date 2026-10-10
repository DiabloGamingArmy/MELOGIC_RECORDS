# Pre-edit ownership and measured findings

Baseline c0cec9eda430bc969db3cadab663e8c7aa5cfd7d. Audit completed before source edits.

SynthFilterState has no type field. SynthFilterRuntime owns two double-integrator
LowPassFilter states per voice/filter, 112 bytes total. Its table has 4097 linearly
interpolated prewarped g entries, cutoff 20..min(20000, .45*fs), fs 8k..384k.
Q=.5+3.5*resonance (0..1); a1=1/(1+g*(g+1/Q)). Per-sample recurrence:
v1=a1*(ic1+g*(x-ic2)); v2=ic2+g*v1; ic1=2*v1-ic1; ic2=2*v2-ic2.
Drive precedes filtering (tanh with square-root makeup); Mix combines complex
phase paths; keytracking multiplies cutoff by 2^((note-60)*keytrack/12), then
clamps. Parameter smoothing is per voice; effective values are UI telemetry.

SignalPanels owns a second hardcoded LOW-PASS menu. Paint uses log 20..min(20k,
.45*fs), +12..-60 dB, analytical bilinear transfer, shared points for stroke/fill,
ENV signalSurfaceColour(.46,.22). It separately paints the saturated floor line,
IN topology sentence and implementation commentary. These are actual paint
commands, not DSP effects. The unlabeled axes obscure the expected bilinear
curvature near Nyquist; maximum Q's peak slightly exceeds +12 dB headroom.

Nodes menu originates in FxEffects.cpp filterTypes (IDs 0..8): LOW PASS, HIGH
PASS, BAND PASS, NOTCH, PEAK, ALL PASS, LOW SHELF, HIGH SHELF, COMB. The first
eight use FxFilter.h float TPT SVF (two float states = 8 B/channel), with g=tan,
k=1/Q and output weights. Bell/shelves use +/-24 dB gain. FX Q=.5..12, clamp
frequency to .49*fs; coefficient refresh every sixteen samples, 20 ms smoothing.
All share FREQ/RES/MIX/DRIVE; bell/shelves also GAIN. Comb instead uses FREQ
20..2000, FB +/- .97, MIX, DAMP and two heap-prepared power-of-two delay lines
(max rate/15 samples requested per channel), nonlinear feedback soft limit and
damping. It is not a drop-in small per-voice runtime. It requires a separately
budgeted bounded delay pool and its actual fractional-delay/damping response.
FxPage builds menu entries from descriptor choiceLabels; its SVF preview calls
svfMagnitude, a separately written form of the same bilinear transfer. Fx copies
of Synth currently assume low-pass explicitly. State v37 persists routes, not
Synth type. FX type remains parameter ID 5 with stable choice index.

Independent steady-state sine projection measured the actual pre-edit Synth
LowPassFilter: 896 probes, seven authored cutoffs 20/100/500/1k/5k/10k/20k,
four rates 44.1/48/96/192k, four resonances 0/.1/.6/1, eight probe ratios.
Worst DSP versus analytic error 0.000865176928249 dB. The probe uses integer-period projection at the actual recorded frequency;
near-Nyquist requests are not silently lowered by a minimum cycle count.
No DSP/transfer defect
was demonstrated. Do not replace this correct low-pass or fake its curvature.

PanicButton owns keyboardFocus_, set on every focusGained cause except mouse
click. JUCE DragImageComponent takes direct keyboard focus. Its destructor calls
owner.dragOperationEnded BEFORE Component's base destructor. Removing the
focused drag image calls its parent grabKeyboardFocus; the default first
focusable child is Emergency DSP reset. Direct focus is misclassified as
intentional accessibility focus, hence the gray treatment outside hover. Mouse
click elsewhere gives focusLost and clears it. PluginEditor does not override
drag lifecycle hooks. A pre-edit native focus handoff fixture reproduces this
exact focused-overlay destruction for ENV/LFO/Macro/Filter/cancel/valid-drop:
all six end with Emergency DSP reset owning focus. No Panic DSP defect found.
The attempted computer-use live drag could not run (noWindowsAvailable); this
is a lifecycle fixture reproduction, not claimed live manual gesture QA.
