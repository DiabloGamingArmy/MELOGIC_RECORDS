# NODES architecture

Status: **N04**. Read this before adding anything graph-, routing- or
modulation-shaped to Origami. Sections are marked **LOCKED** (decided; change
only by revising this document) or **OPEN** (undecided; do not silently pick an
answer in code). §11 (N01), §12 (N02), §13 (N03) and §14 (N04) list exactly what exists today;
everything else here is direction, not implementation.

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

Since N02 these names exist in code (`nodes::NodeSignalType`, §12), and
every port declares one. Every *shipping* port is still AUDIO. CONTROL lives
in `ModulationState`. There are no CONTROL or EVENT ports or nodes yet, and no
DATA type. Analysis results are expected to become CONTROL unless a reason
for a fourth domain appears.

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
retire ring. Since N02, `FxGraph::validate()` includes explicit port, type
and execution-domain stages (§12). They always pass for shipping graphs,
because everything is AUDIO and GLOBAL, but they are enforced. They become
discriminating when other domains arrive.

## 6. Cross-domain adapters — LOCKED (principle), not implemented

Each of these is an explicit node; none is implicit:

- **AUDIO → CONTROL:** Envelope Follower, Peak, RMS, Pitch, spectral analysis
- **CONTROL → EVENT:** Threshold, Rising edge, Falling edge, Clock
- **EVENT → CONTROL:** Note → frequency, Velocity, Keytrack

## 7. Parameter nodes — LOCKED (principle), implemented for SOURCE → PARAMETER in N03 (§13)

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

## 12. N02: typed graph foundation (what exists now)

### 12.1 N01 render discrepancy (resolved, not a bug)

N01 noted that a processor with "UI history" rendered differently from a
fresh processor loaded with its saved state. The cause was route edits, not
the UI:

- Each `setUiRoute` made while running reaches the engine through the
  modulation mailbox. It is compiled with `immediate=false`, so its weight
  glides in under the 5 ms modulation smoothing.
- `setStateInformation` restores through `OrigamiEngine::reset()`, which
  compiles with `immediate=true`: settled at once.

Both instances save byte-identical state. Their audio differs only during the
glide (the first block) and is bit-identical afterwards. Measured:

| Comparison | Result |
|---|---|
| editor open vs. closed | identical |
| UI telemetry and Matrix monitor reads vs. none | identical |
| save → load → save | byte-identical |
| FX graph edits vs. restored state | identical |
| the same live edit on both instances | identical |
| live-edited source after reloading its own state | identical |

The N01 comparison was therefore invalid: it compared a processor with a glide
in progress against a settled one. `deterministicRenderAudit`
(`tests/PluginTests.cpp`) now pins all of this down. UI observation never
alters audio, and the glide is confined to the first block.

### 12.2 Types

`core/nodes/NodeTypes.h` is JUCE-free and header-only:

- **`NodeSignalType { Audio=1, Control=2, Event=3 }`** answers *what travels
  through a port*. `FxSignalDomain` is now an alias of it, with the same
  values. DATA/ANALYSIS is deliberately absent.
- **`NodeExecutionDomain { Global=1, Voice=2, Event=3 }`** answers *how and
  where a node runs*. It is distinct from signal type.
- **Ownership is a third concept.** "This graph belongs to bus 7" is carried
  by `FxWorkspace` (one graph per bus) and by `FxNode::bus` on source nodes.
  Bus is *not* an execution domain.
- **`PortDirection { Input=1, Output=2 }`**.
- **`PortDescriptor`**: `{ direction, type, index, name }`. `index` is the
  stable local index within its direction, and `name` is a static socket
  label.
- **`checkPortPair(a, b)`** returns `None`, `SameDirection` or `TypeMismatch`.
  It accepts either order and never converts types implicitly.

### 12.3 Port model (model-owned, derived, not serialized)

`fxPortCount`, `fxPort(node, direction, index)` and `fxNodePorts(node)` derive
a node's ports from its kind and branch count. The UI does not have a second
port schema: sockets, drag compatibility and the inspector's port line all
read the model.

| Node | Inputs | Outputs |
|---|---|---|
| Source (bus) | – | Audio Out |
| Effect (every catalog effect) | Audio In | Audio Out |
| Split (2–8) | Audio In | A, B, C… |
| Merge (2–8) | A, B, C… | Audio Out |
| Output | Audio In | – |
| Send / Return (reserved, not constructible) | Audio In / Return In | Through, Send / Audio Out |

All ports are AUDIO. No sidechain or control ports were invented. A
compressor has one Audio In until a real sidechain exists.
`fxExecutionDomain(node)` returns GLOBAL for every node: an FX graph
processes its bus's summed audio once, never per voice.

### 12.4 Connection validation

There is one rule set: `FxGraph::checkConnection(FxPortEndpoint a,
FxPortEndpoint b)`. Endpoints are direction-qualified and may be given in
either order. The function returns `FxConnectionCheck { result, from, to }`,
with `from`/`to` normalized to output → input. `canConnect`, `connect` and
the UI use it. The checks run in this order:

1. Both nodes exist, else `UnknownNode`.
2. The directions differ, else `SameDirection`.
3. Both port descriptors exist, else `InvalidPort`.
4. The nodes are different, else `SelfConnection`.
5. A source carries audio, else `ControlSourceNotRoutable`.
6. The signal types are equal, else `TypeMismatch`.
7. The execution domains are equal, else `ExecutionDomainMismatch`.
8. The edge is not an exact duplicate, else `DuplicateConnection`.
9. The input is free (`InputOccupied`) and the output is free
   (`OutputOccupied`).
10. Connection capacity remains, else `CapacityExceeded`.
11. The edge closes no cycle, else `WouldCreateCycle`.

`validate()` applies the same port, type, domain and duplicate rules to every
stored connection. Decoding and compiling therefore reject malformed topology
even when it did not come from `connect()`.

### 12.5 Compilation pipeline (current)

```
FxGraph (document) → validate(): structure → ports → types → execution domain
  → duplicates / one wire per port → topology (Kahn, no cycles)
  → FxGraphCompiler: reachability (source → output) → deterministic order
  → PreparedFxPlan → atomic publish → FxRenderer
```

The audio thread never sees descriptors, enums or strings.

### 12.6 Cycle and duplicate policy

- **Cycles.** Zero-delay cycles are rejected by `connect`/`checkConnection`
  (`WouldCreateCycle`, deterministic) and by `validate` (Kahn). Decode and
  compile therefore reject them too, and nothing cyclic reaches a plan.
  Future audio feedback needs an explicit feedback node with a defined
  minimum delay, compiled as a delayed edge. *A → B → A* without that node
  stays illegal. Feedback itself is OPEN (§10).
- **Duplicates.** An edge's identity is its (output port, input port) pair,
  and an exact duplicate is rejected. One wire per port also applies, so
  fan-out goes through Split and summing through Merge. *A → B* plus *A → C*
  through a Split, or *A → Merge.A* plus *B → Merge.B*, are distinct edges and
  legal.

### 12.7 Serialization

**No format changed.** Port types, names and execution domains are derived
from the stable node kind and effect type, so nothing new is stored. Graph
codec v3 (and v2), `MFXW` v1 (`FXW1` trailer), legacy `FXG2` and instrument
codec v27 are untouched. Tests confirm P04 and legacy loading.

### 12.8 Realtime boundary

N02 adds no audio-thread work. Type metadata exists at edit and compile time
only. Golden fingerprints, captured on the N01 code before any N02 change,
prove that the compiled plans and rendered audio of five representative
graphs and a multi-bus environment with Global FX are bit-identical
(`goldenFingerprintTests`, `tests/FxGraphTests.cpp`).

### 12.9 PreparedFxPlan today, and what a general RenderPlan will need

What `PreparedFxPlan` contains today:

| Content | Today |
|---|---|
| Topological execution order | yes: `steps[0..stepCount)`, deterministic Kahn order, only nodes on a source → output path |
| Buffer assignments | yes: step *s* writes stereo chunk buffer *s*; inputs are earlier buffer indices; pool = `maxNodes + 3` chunks, allocated at prepare |
| Resolved processors | yes: `FxNodeInstance*` (prepared `FxProcessor`, instance survives recompiles with the same id and type) |
| Connection fan-out | implicit: consumers read the same producer buffer; Split copies its input once |
| Merge information | yes: input list plus `inputGain = 1/N` |
| Scratch buffers | renderer-owned dry/wet chunk buffers |
| Parameter references | instance atomics (`targets`, `enabled`), audio-thread `latched`, modulation offsets via a slot → (instance, index) map the renderer resolves only when the modulation generation changes |

What a generalized RenderPlan will need (not implemented):

- **Per-domain storage.**
  - AUDIO: chunk buffers, as today.
  - CONTROL: value slots at a defined control rate, with smoothing ownership.
  - EVENT: bounded, preallocated, time-stamped event queues per edge.
- **Execution partitions.**
  - A GLOBAL plan, run once per block, as today.
  - A VOICE plan template, instanced per voice with per-voice state.
  - An EVENT stage that runs before both and feeds them.
- **Explicit crossings:**
  - VOICE → GLOBAL reductions (sum, as the voice sum is today, or newest);
  - GLOBAL → VOICE broadcasts;
  - adapter steps for audio ↔ control ↔ event.
- **Parameter bindings.** CONTROL edges into parameters must resolve to the
  same canonical `ModRoute`/`ModAddress` bindings as today's
  `FxModulationOutput`, never a second modulation path (§7).
- **Delayed edges** for future feedback nodes, with preallocated delay lines.
- **Step kinds per domain**, with all of the above resolved at compile time.

### 12.10 Current limitations: what remains audio-only

- Every port is AUDIO and every node is GLOBAL.
- Modulation of FX parameters still flows only through `ModulationState` →
  `CompiledModulation::fxFrame` → `FxModulationOutput`. It is not graph
  edges.
- The plan has no control or event storage, no voice partition and no
  delayed edges.
- The UI shows audio sockets only and offers no typed sockets or
  control/event options.
- `Send`/`Return` are still reserved and not constructible.

### 12.11 WHAT N02 DOES NOT MEAN

- **The Control and Event enum values are not features.** Having
  `NodeSignalType::Control/Event` and `NodeExecutionDomain::Voice/Event` does
  **not** mean Origami has a Control graph, an Event graph, voice nodes or
  event nodes. They are vocabulary and validation foundation only. Tests
  exercise them only through synthetic descriptors.
- No generators, arpeggiators, chord/note-stack, sequencers, math/control
  nodes, parameter nodes, adapters, spectral nodes, feedback or modulation
  cables were added.
- No DSP, audio routing, modulation, Matrix or state behaviour changed.
- The `Fx*` class names were kept on purpose (§11).

## 13. N03: CONTROL layer — SOURCE → PARAMETER (what exists now)

### 13.1 One relationship, three views

```
SYNTH drag (LFO 1 → knob) ─┐
MATRIX row (LFO 1, CUTOFF) ─┼──▶ ModulationState::routes  (one ModRoute: id, source,
NODES  [LFO 1] ──◆ [PARAMETER] ┘    destination, amount, bipolar, enabled)
                                          │
                                          └─derive─▶ ControlGraph (view) ─▶ NODES canvas
```

A CONTROL link **is** a canonical `ModRoute`. Nothing else stores its source,
destination, amount, polarity or enabled state. There is no graph route
type, no copy and no sync layer.

- **Creating a link in NODES** (`FxPage::connectControl`) uses the same
  bindings as SYNTH drag-and-drop:
  1. `addRoute` creates a route with the N01 defaults (ON / UNIPOLAR / 0%).
  2. `route` then sets its source and destination.
  3. If the pair already exists (from any view), NODES selects the existing
     route instead of creating another.
- **Editing.** ENABLED, POLARITY and AMOUNT in the link inspector write that
  same route through `route`. The Matrix row and the SYNTH ring show the
  identical values.
- **Deleting.** Deleting a link calls `removeRoute`. Removing a route in the
  Matrix or SYNTH removes the link, because the canvas is re-derived on every
  model refresh. The editor's coalesced route notification (added in the modulation-row pass) already
  refreshes all views.
- **Origin is not tracked.** The Matrix shows a NODES-created route as an
  ordinary numbered row, with a working monitor.

### 13.2 Nodes and ports

- **Source nodes** (`ControlNodeKind::Source`) are views of the instrument's
  own LFO 1–4, ENV 1–3, MACRO 1–4 and RANDOM. No second LFO, envelope or
  random engine exists. Each has one port, **Control Out** (CONTROL).
  Only active sources are offered. Function, Chaos, Drift, Sequencer and the
  performance inputs are not nodes yet. Their routes still work in SYNTH and
  the Matrix but are not drawn.
- **Parameter nodes** (`ControlNodeKind::Parameter`) reference an existing
  `ModAddress` and own no value. Each has one port, **Control In** (CONTROL).
  Destinations come from the shared `modulationDestinationCatalog`, the same
  list the Matrix uses: SYNTH / GLOBAL, FILTER, OSC n, plus this
  instrument's NODES effect parameters.
- **Socket shapes.** CONTROL sockets are diamonds and AUDIO sockets are
  circles. CONTROL cables are thin white (1.2 px), and AUDIO cables are thick
  red. A selected link is red. A link that is OFF, at 0%, or an unsupported
  crossing is dashed. No new colours were added.
- **Wires.** A CONTROL cable dragged from a source diamond lands only on a
  PARAMETER diamond. An AUDIO port never accepts it (`TypeMismatch`), and
  EVENT does not exist yet.
- **No route-property nodes.** Amount and polarity are properties of the
  link. There is no "amount node".

### 13.3 Execution-domain rules

| Source | Domain |
|---|---|
| LFO in Free mode, MACRO, RANDOM (also Function, Chaos, Drift, Sequencer) | GLOBAL |
| ENV 1–3, LFO in Loop/Envelope mode, velocity, keytrack, mod wheel, aftertouch, pitch bend, note gate | VOICE |

| Destination (where it is consumed) | Domain |
|---|---|
| Oscillator parameters, cutoff, resonance, amp (master), main tuning, transpose, envelope scaling | VOICE |
| Porta time, LFO scaling, swing, NODES (FX) parameters | GLOBAL |

Crossings:

- GLOBAL → GLOBAL and VOICE → VOICE are allowed.
- **GLOBAL → VOICE is a broadcast:** every voice reads the same global value
  at the same sample. This is exactly what the engine already does, and is
  now a locked rule.
- **VOICE → GLOBAL is rejected.** It would need a reduction (average, newest
  voice…) that NODES does not define. `checkControlLink` refuses it, and the
  PARAMETER picker disables those destinations for that source and gives the
  reason.
- SYNTH and the Matrix still allow VOICE → FX routes, where the engine uses
  its newest-voice rule. NODES draws such a route dashed and labels it "not
  modelled by NODES". It does not hide the route or pretend it is supported.

An LFO's domain follows its mode, so switching LFO 1 to Loop turns its
existing links to global parameters into unsupported (dashed) links.

### 13.4 Control evaluation rate (unchanged)

NODES adds no scheduler and no control path:

- Sources and the global modulation frame are evaluated **every sample** by
  `CompiledModulation`.
- Voice sources are evaluated every sample in each voice.
- NODES (FX) parameters are evaluated once per render span through
  `fxFrame`.
- Route weights glide over 5 ms when the route set changes. Macros have their
  own 5 ms smoothing, and FX parameters are smoothed in the renderer.

A link drawn in NODES runs at exactly the resolution it ran at before.
A future general CONTROL graph (math nodes) will need its own decision:
sample-rate control or sub-block control with interpolation. It must never be
a UI-rate or 60 Hz path. That decision is OPEN.

### 13.5 Ownership and state

- **Ownership.** CONTROL relationships are instrument patch state
  (`ModulationState`). They are **not** stored in any bus's `FxGraph` or in
  `FxWorkspace`. The CONTROL layer is drawn over whichever bus graph is
  shown. A NODES (FX) parameter belongs to one bus graph, so its parameter
  node and links appear only over that bus.
- **View metadata.** The only persisted CONTROL data is `ControlLayout`: per
  node identity (`ModSource` or `ModAddress`), x/y, `placed` and
  `positioned`. It is saved in a new versioned host trailer, `NCL1` →
  `MCVL` v1, between the instrument state and the `FXW1` trailer. The
  trailer is written only when the layout is non-empty, so states that never
  touch the CONTROL layer are byte-identical to N02.
- **No duplicate state.** Route data is never serialized twice. Tests prove
  that route edits never change the layout bytes.
- **Compatibility.** Pre-N03 states load with the default layout. Builds
  older than N03 cannot read a state that carries the trailer.
- **Positions.** Unpositioned nodes stack in compact columns below the audio
  graph (sources left, parameters right). Their positions are pinned the
  first time they are shown, so nothing moves when other relationships come
  and go. A dragged node stores its position.
- **Removing nodes.** A node can be removed from the canvas only when it has
  no links. A linked node's relationships must be deleted first, because a
  node never deletes routes implicitly.

### 13.6 Still unsupported

- Math and transform nodes.
- Generators, events, adapters and feedback.
- Source nodes for Function, Chaos, Drift, Sequencer and performance inputs.
- Dragging a cable from a PARAMETER back to a source. Only source → parameter
  drags exist.
- Typed CONTROL ports on audio effect nodes. NODES parameters are separate
  PARAMETER nodes, not sockets on the effect.
- VOICE → GLOBAL semantics.
- Showing incomplete Matrix routes (missing an end) in NODES.

## 14. N04: CONTROL processing operators (what exists now)

N04 adds optional processing between sources and parameters. The one rule
from N03 still holds: **NODES does not own another modulation system.**
Section 13.6's "no math nodes" and "no Function/Chaos/… sources" limitations
are lifted by this section.

### 14.1 Direct routes vs processed routes

```
DIRECT     LFO 1 ───────────────────────────▶ CUTOFF      ModRoute{source=LFO1}
PROCESSED  LFO 1 ──▶ [SCALE] ──▶ [SMOOTH] ───▶ CUTOFF      ModRoute{source=operatorSource(SMOOTH)}
                      operators: ModulationState::operators (SCALE.IN ← LFO1, SMOOTH.IN ← SCALE)
```

- **A direct route is unchanged.** It stays one `ModRoute`, and no direct route
  is ever converted implicitly.
- **A processed route is still one `ModRoute`:** same id, Matrix number,
  amount, polarity and enabled flag. Its source is an operator output,
  `operatorSource(id)` (`0x10000 + id`).
- **Operators are instrument patch state.** They live in
  `ModulationState::operators`: 32 fixed slots, each `{id, type, 6 params,
  inputs A/B}`. An input refers to a canonical source or another operator.
  Each input holds at most one connection by construction, so cardinality
  cannot be violated. A slot keeps its index while in use (holes are
  allowed), so per-operator state and route weights stay attached across
  edits.
- **No double modulation.**
  - Inserting a node on a direct route's cable rewrites that route's source.
    The direct route is replaced in place and never remains underneath.
  - Deleting the last processor collapses the chain back to the same direct
    route.
  - A route whose collapse would duplicate an existing pair is removed
    instead of duplicated.

### 14.2 Node library

| Category | Nodes | Inputs |
|---|---|---|
| Math | ADD, SUBTRACT (A − B), MULTIPLY, MIN, MAX | A, B |
| Shaping | SCALE / OFFSET, REMAP (in/out ranges + clamp), CURVE (linear/exp/log/S + amount), ABS, INVERT, CLAMP | IN |
| Utility | CONSTANT, SMOOTH (rise/fall seconds), QUANTIZE (steps) | none / IN |

Unconnected inputs are deterministic:

- ADD and SUBTRACT treat an unconnected input as 0.
- MULTIPLY treats it as 1.
- MIN and MAX pass the other input through.

**SAMPLE & HOLD is deferred.** A trigger needs EVENT semantics, which do not
exist yet, and it is not faked.

### 14.3 Ranges

Every value has a declared range: UNIPOLAR (nominal 0…1) or BIPOLAR (−1…1).

**Input ranges:**

- Signed generators (LFOs, Random, Function, Chaos, Drift, Sequencer) are
  BIPOLAR.
- Envelopes, macros and performance inputs are UNIPOLAR.

**Output ranges:**

- Math nodes are BIPOLAR if any connected input is.
- ABS is always UNIPOLAR.
- REMAP, CLAMP and CONSTANT are BIPOLAR if their bounds or value go below 0.
- The remaining unary nodes keep their input's range.

**Range-aware nodes:**

- INVERT: unipolar `1 − x`, bipolar `−x`.
- QUANTIZE: levels span the nominal range, so bipolar keeps −1 and +1.
- CURVE: shapes [0,1] for unipolar input; for bipolar input it shapes `|x|`
  odd-symmetrically.

**At the destination:** a processed route applies the same polarity transform
a signed generator gets when its operator output is BIPOLAR (`raw/2 + 1/2`
when unipolar, `raw/2` when bipolar). Inserting SCALE ×1 into LFO → CUTOFF
is therefore bit-identical (tested).

### 14.4 Execution domains (validated before compilation)

- **Propagation:** an operator is VOICE if any input is VOICE, otherwise
  GLOBAL. GLOBAL + VOICE gives VOICE. A GLOBAL input to a VOICE operator is
  a broadcast.
- **Authoring (`checkControlEdge`)** rejects:
  - a VOICE result into a GLOBAL parameter;
  - any edge that would turn an existing chain feeding a GLOBAL parameter
    per-voice.
- **Compilation:** if such a chain arises anyway (for example an LFO switched
  to a per-note mode), the route is left **inert**. It is never reduced over
  voices, and NODES draws it dashed.

### 14.5 Compiler and runtime

```
ModulationState (routes + operators)
   ── CompiledModulation::compile (audio thread at block start, fixed arrays, no allocation)
        operators → topological order (Kahn over 32 slots), inputs → slot indices,
        ranges/domains propagated, SMOOTH coefficients from the sample rate
   ── per sample, global:  evaluateGlobalOperators(frame, sources)  → frame.operatorOutputs
                           globalFrame adds operator-slot route contributions
   ── per sample, voice:   evaluateVoiceOperators(local, voiceSources, voice.operatorState)
                           voiceFrame adds per-voice operator-slot contributions
   ── per span, FX:        fxFrame reads the latest global operator outputs
```

- **Slots:** the evaluator has 26 source slots plus 32 operator slots.
  Operator outputs are routed exactly like sources: weights, 5 ms route
  smoothing, groups.
- **Resolution:** sample-accurate destinations stay sample-accurate through
  any chain. FX parameters are evaluated per span, as before.
- **State:** global operator state lives in `CompiledModulation`. Per-voice
  state (SMOOTH) lives in each `Voice` and resets on each new note, so voices
  never share state. State is keyed by operator id, so a new operator in a
  reused slot starts fresh.
- **Hot loop:** `for op in compiledOps: execute(op)`. There are no graph
  searches, strings, UI objects, locks or allocations. A test with the
  allocation guard confirms this.
- **Cost when unused:** with no operators, `hasOperators()` is false and no
  operator code runs. The N02 golden plan and audio fingerprints are
  unchanged.

### 14.6 Interoperability

- **Matrix:** a processed route is **one** normal row. Its source reads
  `NODES: SCALE / OFFSET (LFO 1)` and is locked with a tooltip pointing to
  NODES, because the chain is edited there. Amount, polarity, destination,
  monitor and deletion still work. The monitor plots the processed
  contribution.
- **SYNTH:** source rows show rings for routes rooted at that source,
  including processed ones (the ring edits the route amount). Knob arcs
  already sum routes by destination, and live arc motion reads the operator
  output.

### 14.7 Authoring and undo

- **Creating nodes:** NODES Add Module (and right-click at the cursor) offers
  CONTROL / SOURCES, CONTROL / MATH, SHAPING, UTILITY, and Parameter….
- **Drag:** from any OUTPUT (source or operator) to any compatible INPUT
  (operator input or PARAMETER). Compatible inputs highlight while
  dragging.
- **Right-click a CONTROL cable:** INSERT NODE splices an operator in
  atomically and places it midway along the cable; Delete / Disconnect is
  also offered.
- **Deleting an operator:** a unary operator with a connected input is
  bridged to its neighbours. Otherwise its consumers are disconnected and its
  routes removed.
- **Duplicate** copies an operator's settings, never its connections.
  SOURCE and PARAMETER nodes are views: they are never duplicated or deleted,
  only removed from the canvas when unlinked.
- **Undo history:** every NODES control edit is a transaction on the page's
  control history. That covers add, delete, move, connect, disconnect,
  insert, parameter edits (one step per drag), direct → processed and
  processed → direct. UNDO/REDO interleave control and audio-graph edits in
  the order they were made. A snapshot restores only routes, operators and
  layout; source settings are untouched.

### 14.8 Monitoring

- Operator outputs are published with the source slots, in the same
  observation tick and lock-free mailbox. Global values come from the engine
  frame, per-voice values from the newest voice.
- The operator inspector shows live input and output values plus an output
  monitor. QoS suppression only stops observation, never evaluation.

### 14.9 Save format

- **Instrument codec v28** appends the operator slots (with holes) and
  `nextOperatorId`. It is written **only when an operator exists**; otherwise
  the state is written as v27, byte-identical to N03.
- **Layout `MCVL` v2** adds operator entries. It is written only when one
  exists; otherwise the layout stays v1.
- N03 and older saves load unchanged as direct-route graphs. Saves containing
  operators require N04 or later.

### 14.10 Deferred

- SAMPLE & HOLD (needs EVENT triggers).
- Voice-reduction operators (VOICE → GLOBAL).
- Control feedback.
- Bidirectional cable drags (from an input).
- A general control-rate scheduler, which is unnecessary while operators run
  inside the canonical per-sample evaluator.
- Operator copy/paste across instruments.
