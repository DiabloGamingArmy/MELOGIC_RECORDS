# NODES architecture

Status: **N01**. Read this before adding anything graph-, routing- or
modulation-shaped to Origami. Sections are marked **LOCKED** (decided; change
only by revising this document) or **OPEN** (undecided; do not silently pick an
answer in code). §11 lists exactly what exists today; everything else here is
direction, not implementation.

---

## 1. Product definition — LOCKED

NODES is Origami's graph environment for **generating, transforming, routing,
combining, analyzing and controlling** audio, control (modulation) and musical
events.

- The current per-bus FX graph is the starting point, not the boundary.
- The normal SYNTH workflow stays complete on its own: OSC, FILTER, ENV, LFO,
  drag-to-modulate and bus routing make a full patch without opening NODES.
- NODES is the advanced, programmable layer on top of that workflow. It never
  becomes a prerequisite for ordinary patching.

## 2. MATRIX vs NODES — LOCKED

| | MATRIX | NODES |
|---|---|---|
| Question | **What is modulating what?** | **How does the machine work?** |
| Shape | Quick, tabular, one row per route | Deep, programmable graph |
| Scope | Source → destination relationships | Generation, processing, routing, adapters, events |

- MATRIX must never become a miniature node editor: no math, no chains, no
  per-route processing graphs. Its row contract is in §8.
- MATRIX, NODES and SYNTH drag-and-drop are **different views of one logical
  modulation system**. They must keep editing compatible, canonical modulation
  relationships. There must not be a second modulation engine (§7).

**Migration boundary (today).** All three views already share one store:
`ModulationState::routes` (`core/modulation/Modulation.h`). The NODES graph does
not yet *display* modulation as wires. Doing that later means rendering
existing `ModRoute`s as edges. It does not mean storing graph-owned
modulation (§7, §9).

## 3. Signal domains — LOCKED (names and rule), OPEN (DATA semantics)

| Domain | Carries | Examples |
|---|---|---|
| AUDIO | sample streams | oscillator streams, filters, distortion, EQ, buses |
| CONTROL | continuous modulation values | LFOs, envelopes, macros, random, parameter modulation, math |
| EVENT | discrete musical events | notes, gates, triggers, arpeggiators, sequencers |
| DATA / ANALYSIS *(future, OPEN)* | derived measurements | pitch, FFT band values, spectral centroid |

Rules:

- Every port has exactly one domain, and connections are typed.
- A connection between two different domains is legal only through an explicit
  adapter node (§6). There are no implicit conversions.

Today only AUDIO exists as graph ports. CONTROL lives in `ModulationState`.
EVENT and DATA do not exist.

## 4. Execution domains — LOCKED

| Execution domain | Lifetime | Examples |
|---|---|---|
| VOICE (polyphonic) | One instance per voice. It starts and stops with a note. | normal oscillator, per-voice envelope, possibly per-voice processors |
| GLOBAL | One instance, always running | bus FX, master/Global FX, future free-running generators, global modulation |
| EVENT | Runs on event arrival and the event clock | future arpeggiator, chord/note stack, note filters, sequencer |

**Why an oscillator cannot simply become a free-running generator.**

- An Origami oscillator is a VOICE object. Its phase, pitch, envelope and
  per-voice modulation exist only while a note is held.
- It is instantiated N times (polyphony) inside `Voice`. It is stolen and reset
  on retrigger. It is summed into the bus sends per voice.
- A free-running source has none of that. It has exactly one instance, runs
  with no note, and needs its own start/reset, sync and transport policy.

Treating one as the other breaks voice stealing, CPU accounting and state
semantics. Future free-running sources are therefore **separate GLOBAL
generator objects with an explicit lifecycle**, not oscillators with a flag.

Crossing from VOICE to GLOBAL is a reduction, for example a sum or the newest
voice. Today the voice sum feeds the buses, and FX modulation uses the
newest-voice policy (`CompiledModulation::fxFrame`). Crossing from GLOBAL to
VOICE is a broadcast. The exact rules for user-built crossings are OPEN (§10).

## 5. Graph compilation — LOCKED

```
EDITABLE USER GRAPH            (message thread, undoable document)
        ↓
VALIDATION                     (ids, ports, references)
        ↓
TYPE CHECKING                  (signal domain per connection, §3)
        ↓
EXECUTION-DOMAIN VALIDATION    (voice/global/event placement and crossings, §4)
        ↓
TOPOLOGICAL ANALYSIS           (order, cycles, reachability)
        ↓
COMPILED / IMMUTABLE RENDER PLAN
        ↓
REALTIME EXECUTION             (audio thread)
```

- The visible graph is **not** assumed to be the realtime representation.
- The realtime contract is preserved:
  - no allocation, blocking locks, I/O or logging on the audio thread;
  - bounded buffers, sized at prepare;
  - routing resolved before execution (no ID searches while rendering);
  - plans built off the audio thread and swapped in lock-free, with retired
    plans freed off the audio thread.

Today's FX path already follows this shape: `FxGraphDocument` →
`FxGraphCompiler` → `PreparedFxPlan` → `FxRenderer`, with an atomic swap and a
retire ring. The type-checking and execution-domain stages are trivial today,
because everything is AUDIO and GLOBAL. They become real stages when other
domains arrive.

## 6. Cross-domain adapters — LOCKED (principle), not implemented

Each of these is an explicit node; none is implicit:

- **AUDIO → CONTROL:** Envelope Follower, Peak, RMS, Pitch, spectral analysis
- **CONTROL → EVENT:** Threshold, Rising edge, Falling edge, Clock
- **EVENT → CONTROL:** Note → frequency, Velocity, Keytrack

## 7. Parameter nodes — LOCKED (principle), not implemented

- Any automatable Origami parameter must eventually be addressable as a graph
  destination through one generic PARAMETER node. No parameter needs a bespoke
  node type.
- Dragging *LFO → knob* and wiring *LFO NODE → PARAMETER NODE* must produce
  the **same** `ModRoute`: the same source id, destination `ModAddress`,
  amount and polarity.
- The graph edge is a *view* of the route, not a second store.

`ModAddress` (destination, oscillator/node id, item id) is today's
parameter-addressing scheme. FX parameters are addressed by bus, node and
parameter (`fxParameterAddress`). A PARAMETER node would carry a `ModAddress`.

## 8. MATRIX representation — LOCKED (N01 implements it)

Each route row has these columns:

| Column | Meaning |
|---|---|
| NUMBER | Display order (position in `ModulationState::routes`) |
| POWER | `ModRoute::enabled` |
| POLARITY | `ModRoute::bipolar` (UNIPOLAR / BIPOLAR) |
| SOURCE | `ModRoute::source` |
| DESTINATION | `ModRoute::destination` |
| AMOUNT | `ModRoute::amount` (−100…+100 %) |
| MONITOR | Live normalized contribution (see below) |

**New route defaults:** POWER ON, UNIPOLAR, SOURCE none
(`ModSource::None`), DESTINATION none (`ModDestination::None`), AMOUNT 0 %.

- A route missing either end is **incomplete**. It is a valid, saved state,
  but it is inert: `CompiledModulation::compile` skips it.
- Nothing is auto-assigned. The old default of LFO 1 → CUTOFF at 35 % is gone.

**Uniqueness.** At most one route exists per complete *(source, destination
address)* pair. LFO 1 → CUTOFF and LFO 2 → CUTOFF can coexist; two LFO 1 →
CUTOFF routes cannot. The rule is enforced at three levels:

1. **Model.** `validModulation()` rejects any state containing a duplicate
   pair, so `setUiRoute` and `setUiModulationState` fail and nothing is
   committed. `routeDuplicates()` is the shared predicate.
2. **UI.** In a row's destination menu, destinations already routed from the
   row's source are disabled and annotated, for example "Already routed from
   LFO 1". The row's own pair is never shown as taken.
3. **Source change.** If changing a row's source would recreate an existing
   pair, the row's destination is cleared to none rather than duplicated.

There is no Duplicate action.

**Legacy states.** States saved before the uniqueness rule may contain
duplicate pairs. On load, `mergeDuplicateRoutes()` merges them before
validation, deterministically:

- The **earliest** route of each pair is kept, with its id.
- Its amount becomes the clamped sum of the enabled duplicates. The compiler
  always summed duplicates, so playback is unchanged whenever that sum stays
  within ±100 %.
- It stays enabled if any duplicate was enabled.
- Its polarity becomes that of the last enabled duplicate, matching the
  compiler's last-writer rule.
- Later duplicates are removed.

**Monitor semantics.** The monitor shows THE NORMALIZED CONTROL CONTRIBUTION
OF THIS ROUTE:

```
SOURCE (raw slot value) → POLARITY transform → × AMOUNT → [MONITOR] → destination mapping/clamp → PARAMETER
```

- The range is −1…+1. New values enter on the right and history shifts left.
- The polarity transform is the evaluator's own (`routeSourceValue`):
  - signed generators (LFO, Random, Function, Chaos, Drift, Sequencer) map to
    `raw/2 + 1/2` when unipolar and `raw/2` when bipolar;
  - unsigned sources (ENV, macros, velocity…) pass through unchanged.
- Amount 0, an OFF route and an incomplete route all contribute 0. OFF and
  incomplete routes draw an inactive (empty) monitor.
- The monitor is not an oscilloscope and not the destination's final value.

**Observation path (realtime-safe).**

```
engine (audio thread, every ~1 ms of audio at the existing visualization cadence)
  → RuntimeVisualizationSnapshot::routeSources[26]   (raw evaluator source slots;
    global slots + newest voice's slots, voice slots 0 with no voice)
  → existing lock-free visualization mailbox (LatestStateMailbox)
  → UI timer, 30 Hz, only while the Matrix is showing
  → routeContribution(route, state, slots)            (pure function, core)
  → ModulationRouteMonitor: fixed 96-entry ring buffer → paint
```

- The audio thread copies 26 floats per observation tick into an existing
  snapshot. It does not allocate, lock, repaint or log.
- With visualization suppressed (QoS), nothing is copied.
- Tests prove audio is bit-identical with or without monitor reads.

## 9. State migration — LOCKED (principle)

- The future NODES state format will be **versioned**. It must migrate today's
  `FxWorkspace` exactly: the `FXW1` host trailer holding `MFXW` v1 (all bus
  graphs plus Global FX), the legacy `FXG2` single-graph trailer, and graph
  codec v2/v3.
- Current presets must never break silently. A migration either reproduces
  the old behaviour or fails loudly. Loading must never be partial.
- Modulation stays in instrument state (codec v27). NODES must not fork it
  (§7).

N01 did not change any format version. Incomplete routes use value 0 in the
existing source/destination words; builds older than N01 reject such states,
since 0 used to be invalid. Duplicate repair is a load-time normalization, not
a format change.

## 10. OPEN questions

Do not resolve these implicitly in code. Each needs a design note first.

- DATA / ANALYSIS domain: value type (scalar, vector, spectrum), rate, and how
  it reaches CONTROL.
- Feedback and cycles: whether they are allowed, and the semantics of an
  implicit one-block or one-sample delay. Today `connect()` rejects cycles.
- Graph grouping and subgraphs (node groups): identity, parameters exposed
  upward, and serialization.
- Control-rate scheduling: per-sample, per-span or per-block CONTROL, and
  smoothing ownership.
- Per-voice ↔ global crossing: the reduction operators available to users
  (sum, newest, oldest, max, average), and broadcast rules.
- Free-running generator synchronization: phase reset, tempo sync and
  retrigger policy.
- Host transport interaction: start/stop/loop, song position, and offline
  render determinism.
- How NODES draws modulation routes as edges, including whether incomplete
  Matrix routes appear.
- Whether NODES has one graph per bus (today) or one graph containing bus
  nodes.
- Macro placement: the permanent MACROS panel in NODES (§11).

## 11. What N01 actually changed

**User-facing:**

- The header tab FX is now **NODES**. The toolbar title is **NODE GRAPH**.
  The routing hint in OSC routing reads "NODES > BUSES". FX destination
  groups are labelled "NODES / bus / node". The CLEAR confirmation reads
  "CLEAR <BUS> GRAPH?".
- Global FX and effect names are deliberately unchanged: they really are
  effects.
- The NODES sidebar has five categories: SOURCES / MODULATORS / FILTERS /
  BUSES / **MATRIX**. It runs the full height down to the keyboard. Its width
  grew from 236 to 268 px for the five tabs and the compact Matrix.
- SELECTED EFFECT and EFFECT PARAMETERS are merged into **MODULE
  PARAMETERS**: identity, preview and quick controls on the left, the
  MAIN/MODULATION/ADVANCED parameter tabs (including the EQ band editor) on
  the right. MACROS stays as a narrow panel to its right (see TODO).
- Matrix: new route defaults; unique pairs; disabled and annotated duplicate
  destinations; the Duplicate button is removed and replaced by the live route
  MONITOR. NODES > MATRIX is the **same** `ModulationMatrix` class, in its
  compact `Layout::Sidebar`. It is not a second Matrix.

**Core:**

- `ModSource::None` and `ModDestination::None` (0); `ModRoute` defaults.
- `routeComplete`, `routeDuplicates`, `mergeDuplicateRoutes` and
  `routeContribution`.
- Validation accepts incomplete routes and rejects duplicate pairs. The
  compiler skips incomplete routes. The codec repairs legacy duplicates.
- `RuntimeVisualizationSnapshot::routeSources` is filled at the existing
  observation cadence.

**Still old "FX" internals.** These are intentionally not renamed: `FxGraph`,
`FxGraphDocument`, `FxWorkspace`, `FxEnvironment`, `FxRenderer`, `FxPage`,
`FxSidebar`, `FxEffectType`, `ModDestination::FxParameter`, the `FXW1`/`MFXW`
formats, and `fx::FxViewState`. They name what the current graph is (an
audio-effects graph per bus). Renaming them is pure churn until the graph
gains non-effect domains.

**Compatibility boundary.** `FxGraph` holds AUDIO-only ports with no domain
tag. The first real NODES pass adds a port domain and the compiler
type-check/execution-domain stages (§5). It also extends the graph codec with
a version bump and migration. Everything above that boundary (UI naming,
sidebar, inspector, Matrix contract) is already NODES-shaped.

**Not implemented (deliberately):**

- free-running generators and the oscillator generator;
- all cross-domain adapters;
- arpeggiator, chord/note stack and sequencer nodes;
- node groups, math nodes and PARAMETER nodes;
- spectral analysis;
- feedback;
- general event and control graphs.

**Follow-up TODOs:**

- MACROS still has a permanent panel in NODES. Macros are already drag
  sources in NODES > MODULATORS. Folding their four knobs into that tab (or
  into MODULE PARAMETERS when a macro is selected) needs an interaction design.
  It was left intact rather than removing functionality.
- Matrix rows rebuild their destination lists whenever destinations change.
  With very large FX graphs a cached destination catalogue would be cheaper.
- FX destination hover labels still show raw node/parameter numbers
  ("NODES / NODE 4 / P2"). Resolving names needs workspace access in the
  shared label function.
