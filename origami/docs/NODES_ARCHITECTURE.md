# NODES architecture

Status: **N07**. Read this before adding anything graph-, routing- or
modulation-shaped to Origami.

- **§0 is the authoritative description of the current system.**
- §1–§10 hold the locked principles.
- §11–§16 keep each phase's reasoning (N01–N06) as history.

Sections are marked **LOCKED** (decided; change only by revising this
document) or **OPEN** (undecided; do not silently pick an answer in code).

---

## 0. Current architecture (authoritative, N07)

### 0.1 Canonical state and ownership

| State | Owner | Notes |
|---|---|---|
| Modulation relationships | `ModulationState::routes` | One `ModRoute` per (source, destination). The Matrix, SYNTH rings and NODES links are views of it. |
| Processing nodes | `ModulationState::operators` | 32 fixed slots; slot indices are stable. The type, parameters and inputs (each with its source port) are canonical. |
| Sequence | `ModulationState::sequencer` (`SequencerSettings`) | Edited from SYNTH and from the NODES inspector; there is no copy. |
| Node positions | `ControlLayout` (`MCVL`, processor-owned, `NCL1` trailer) | View metadata, never DSP. |
| Zoom / pan / sidebar tab | `FxViewState` (processor-owned) | View only. Selection is never persisted. |

- **Direct route:** a canonical source drives a parameter.
- **Processed route:** its source is an operator OUTPUT, `operatorSource(id, port)`.
  The port sits in bits 20–21; port 0 equals the N04/N05 encoding.
- **Operator input:** stores `{kind, source | op, port}`.
- **A connection's identity includes the output port.** Every authoring path
  (NODES, SYNTH drag-and-drop, Matrix) mutates this one state through the same
  bindings.

### 0.2 Signals and domains

**Signals** are typed per port and typing is strict (validation, authoring,
compile):

- **CONTROL:** continuous value.
- **GATE:** exactly 0 / 1.
- **EVENT:** non-zero only at its sample.

**Domains:**

- An operator is **VOICE** when it is a voice-only node (NOTE ON, NOTE OFF,
  GATE, RETRIGGER, ENV TRIGGER) or anything upstream is VOICE. Otherwise it is
  **GLOBAL**.
- GLOBAL → VOICE is a broadcast. VOICE → GLOBAL is rejected; such a route is
  inert if it arises elsewhere.
- The SEQUENCER is GLOBAL-only.

### 0.3 Compiler and plan lifecycle

`CompiledModulation::compile` runs on the audio thread, at a block start,
when the engine consumes a new state from its lock-free mailbox. It uses fixed
arrays and never allocates. It classifies the change against what the current
plan was built from (`PlanKey`, compared field by field, never hashed):

| Change | Result | Counter |
|---|---|---|
| Nothing the plan reads: macros, LFO rate / shape, sequence steps, oscillator parameters | **skipped**; the plan is untouched | `compileSkips` |
| Only operator parameters, with no output-range change | **in-place parameter update**; runtime state kept | `parameterUpdates` |
| Routes, amounts, operators, connections, LFO free / voice mode, module topology, sample rate | **full compile** (route weights still crossfade) | `compiles` |

- **Range changes** force a full compile, because polarity flows into
  downstream inputs and route transforms. Examples: REMAP turning bipolar, or
  CLAMP / CONSTANT / RANDOM / RANDOM WALK bounds crossing 0. ENV TRIGGER targets
  also force a full compile.
- **Transactional:** `setModulationState` validates before publishing. An
  invalid graph is rejected on the calling thread, and the previous plan keeps
  running. Compilation itself cannot fail; it is never visible half-built,
  because the audio thread builds it between blocks.
- **Layout never reaches the engine.** Moving, aligning or auto-laying-out
  nodes, panning, zooming and selecting change no model state. Undoing a
  layout-only step republishes nothing. (Tested: 100 moves plus pan, zoom,
  selection, auto layout and a layout undo leave the compile counters and the
  state revision unchanged.)

### 0.4 Runtime plan

The plan is prepared at compile time, so the sample loop executes decisions
instead of re-deriving them:

- **Execution order:** per-domain topological orders (`globalOrder_`,
  `voiceOrder_`). Neither loop tests every operator's domain.
- **Prepared kernels:**
  - **Which operators:** stateless single-output CONTROL operators and SMOOTH
    (ADD, SUB, MUL, MIN, MAX, SCALE / OFFSET, INVERT, ABS, CLAMP, CONSTANT,
    SMOOTH).
  - **What compile resolves:** connection cases (a one-input ADD is a pass),
    the INVERT range and the CLAMP bounds.
  - **Equivalence:** a test proves the kernels equal the general evaluator bit
    for bit, NaN inputs included.
  - **Everything else** runs through `evaluateControlOpOutputs`.
- **Input resolution:** an input is resolved to a slot index at compile time.
  A per-voice operator reads GLOBAL operator outputs straight from the global
  frame (a per-input bit), so a voice never copies the operator table.
- **Outputs:** operator outputs live at `slot*4+port`. Routes use compact
  routed slots, so groups stay 26 + 32 wide.
- **Prepared constants:** CUTOFF's log spans are computed per group at compile
  (previously two logs per sample).
- **Frames:**
  - A voice copies only the oscillator modules a per-voice route writes
    (`voiceModuleMask`). Every other module is read from the global frame.
  - The full frame is copied only on the 1 kHz observation tick.
  - The engine refreshes only the active module slots after a block's first
    sample.
- **Velocity and note curves:** constant per note, so they are cached per
  voice and recomputed only when the note, velocity or state revision changes
  (and only when used or observed).

**Same-sample order:**

```
sample N: sources -> global operators (topological) -> per-voice operators (topological)
          -> destination frames (global, then per voice) -> targets (ENV TRIGGER: N+1)
```

Every port of a node is computed in one evaluation, so consumers of VALUE and
WRAP see one consistent state at N.

**Reference table: one rule for every stateful node.**

| Step (within one node, one sample) | Order |
|---|---|
| RESET | 1: applied first (counter 0, toggle off, reseed, scheduler kept) |
| ADVANCE / TRIGGER / CLOCK | 2: acts on the post-reset state |
| VALUE read (inputs) | the same-sample values of upstream nodes (topological) |
| OUTPUT write | every port at once, after 1–2 |
| WRAP / STEP EVENT | the same sample as the value change |

- COUNTER: RESET + ADVANCE gives position 1.
- SEQUENCER (EXTERNAL): RESET arms it; the same-sample ADVANCE plays the start
  step.

### 0.5 Randomness (who owns which stream)

| Generator | Stream |
|---|---|
| RANDOM source | `RandomGenerator` (engine, one) |
| CHAOS / DRIFT | their own engine generators |
| SEQUENCER probability / humanize | `SequencerGenerator::rng_` (LCG) |
| PROBABILITY, CHANCE SPLIT, RANDOM, RANDOM WALK | One xorshift32 **per node instance**, seeded from `hash(SEED, operator id)` at first evaluation and on RESET. Advanced once per incoming event, never per sample. |

No two systems share state. Evaluation order or block size can never change
another node's sequence (tested bit-identical at blocks 32–1024).

**Per-voice streams (N07):**

- A per-voice node's seed also mixes the voice slot and that slot's **note
  lifecycle** count (`ControlEventContext::voiceSeed`).
- Simultaneous voices therefore draw distinct sequences, and repeated renders
  are identical.
- A stolen or retriggered voice starts a new stream; it never continues the
  previous note's.
- An engine reset restarts the lifecycle counts, so renders repeat.
- GLOBAL nodes keep their N06 sequences exactly (salt 0).

### 0.6 Smoothing (audit)

| Path | Smoothing |
|---|---|
| Route amount / topology changes | Group weights crossfade across recompiles (`advance`). Kept by the parameter-update and skip paths. |
| Direct and processed routes | No per-sample smoothing of values (unchanged). |
| SMOOTH node | Its own rise / fall coefficients (the only intentional value slew). |
| SWITCH | GLIDE > 0 crossfades; GLIDE 0 is deliberately instant. |
| SEQUENCER outputs | Stepped by design (use SMOOTH to slew). |
| FX destinations | Smoothed by the FX renderer's parameter path (unchanged). |

There is no double smoothing: route-weight crossfades apply only to amount
changes, never to signal values.

### 0.7 UI synchronization (revision model)

- **Model revision:** the processor bumps `uiModelRevision` on every UI-state
  write (19 write sites).
- **Graph revision:** each bus document has its own revision.
- **Layout:** the page's own; changes refresh directly.
- **Telemetry:** the published engine snapshot, polled at 30 Hz by the page
  timer only while the page is visible.
- **`FxPage::syncFromModel`** (editor timer while NODES is shown) rebuilds
  the sidebar and CONTROL view only when the model or graph revision changed.
  The page's own edits refresh directly.
- **`FxPage::modelChanged`** (change notifications): while NODES is hidden it
  updates only the sidebar modulator cards (they are the SYNTH rail's rows)
  and marks the CONTROL view stale. There is no graph derivation, node update,
  cable geometry or paint. The page catches up once when shown.

| Measured (32-node graph, Release) | N06 behaviour | N07 |
|---|---|---|
| Editor timer tick, model unchanged | full rebuild ≈ 117 µs | revision check ≈ 0.004 µs |
| Model change while NODES is hidden | full rebuild ≈ 117 µs | sidebar only ≈ 16 µs |
| Model change while visible | rebuild ≈ 117 µs | rebuild ≈ 117 µs (needed) |

Cable geometry is computed when topology changes or a node moves, never per
paint. Telemetry repaints only the node (activity) or its preview region
(sequencer step). Rendering is identical with NODES visible or hidden (tested).

### 0.8 Telemetry and QoS

All monitoring uses the one bounded publication path: the engine's
`RuntimeVisualizationSnapshot` (operator outputs per port, event counters,
sequencer step), copied at the existing 1 kHz observation tick through the
lock-free mailbox.

- Under QoS suppression the observation work itself is skipped (no copies),
  not just the publication. `suppressedBlocks` counts it.
- DSP never reads telemetry.
- Per-operator event counters are monotonic integers (UI activity only).

### 0.9 Authoring UX (N07)

**Layout:**

- **Default placement** is a layered, deterministic layout: sources | operators
  by chain depth | parameters, left to right. Columns are ordered by neighbour
  barycenter sweeps (fewer crossings) with stable tie-breaks, and nodes are
  stacked by their drawn height. Pinned positions are respected and stepped
  around.
- **AUTO LAYOUT** (toolbar, Cmd/Ctrl+Shift+L) applies the same layout to every
  node as one undo step. It is never automatic and never changes DSP.

**Zoom:**

- **Semantic zoom:**
  - **≥ 60%:** full node.
  - **45–60%:** no secondary text, previews, inline controls or port labels.
  - **< 45%:** identity and sockets only, with titles drawn at
    ≥ 9 px on screen.
- **Floor:** 30%, so a 13-column graph fits readably.
- **Hit targets:** keep their graph size, at least 9 screen px. Overlaps
  resolve to the nearest socket.

**Selection:**

- **Multi-selection:** Shift-click toggles; a left-drag on empty canvas draws a
  marquee (Shift adds). Panning moves to Option/Alt-drag, middle-drag and the
  trackpad.
- **Group move:** one undo step.
- **Delete selection:** removes user nodes. Linked canonical sources /
  parameters stay.
- **Align left / centre / right / top and distribute horizontally / vertically:**
  one undo step each.

**Adding and editing:**

- **Searchable palette** (Origami-native): + ADD MODULE, A or Tab at the
  cursor, and cable drops.
  - Search covers name, category and aliases ("prob", "s&h", "seq", "walk",
    "eucl").
  - Arrows and Return choose; Escape dismisses.
  - Disabled entries show their reason.
- **Clipboard:** Cmd/Ctrl+C / V copies user nodes and the connections between
  them. Ids are regenerated; external connections and canonical nodes are
  never copied; a second sequencer is refused with a message.
- **Duplicate:** Cmd/Ctrl+D places the copy below the original, without
  overlap, and selects it.

**Feedback and diagnostics:**

- **Refused connections** show a transient Origami-native message, for example
  "CONTROL output cannot feed an EVENT input", "Input already connected" or
  "Per-voice output cannot drive a global parameter or node".
- **Developer inspector:** Cmd/Ctrl+Shift+D (hidden by default). It shows ids,
  type, slot, state slot, domain, input / output ports with signals and
  monitor values, route encodings, the model revision, the engine's plan
  counters, UI counters and the validator.

**Unchanged:** the right-click menus stay native (simple lists that work).
The PATTERN editor uses two rows of 16 cells (≥ 15 × 20 px) on a wider node
for LENGTH > 16.

### 0.10 Validation, recovery, debugging

- **`nodes::validateControlGraph`** is the one reasoned rule set
  (`validModulation` is its realtime-safe boolean twin). It reports:
  - duplicate ids, unknown types, ids beyond the counter, bad parameters;
  - connections on missing inputs, dangling inputs, invalid ports, type
    mismatches, unknown sources, cycles;
  - per-voice inputs into GLOBAL-only nodes, extra sequencers;
  - routes from missing operators, invalid ports, EVENT / GATE outputs or
    unknown sources.
- **`nodes::repairControlGraph`** removes or disconnects exactly the invalid
  parts, in slot order. A valid graph is untouched.
- **`decodeInstrumentState`** repairs a malformed NODES graph instead of
  executing or wholly rejecting it; `DecodeReport::graphRepairs` reports the
  count. Structural corruption (counts, kinds, truncation) is still rejected.
  3,000 deterministic mutations of a 32-node save produced no crash, and every
  accepted state was valid.
- **Engine diagnostics** (`OrigamiEngine::nodesDiagnostics`, relaxed atomics):
  `compiles`, `parameterUpdates`, `compileSkips`, `stateRevision`,
  `eventDelayOverflows` and `suppressedBlocks`.
- **UI diagnostics** (`FxPage::uiDiagnostics`): model syncs, skipped syncs,
  hidden syncs, CONTROL rebuilds, canvas paints and rejected connections.

### 0.11 Limits and memory (gated in tests)

- **Limits:** 32 operators, 32 routes, 4 outputs per node, 3 inputs, an
  8-event EVENT DELAY queue, 8 sequencer steps.
- **Compile-time memory gates:**
  - `sizeof(ControlOpRuntime) ≤ 64`;
  - per-voice operator state ≤ 2 KB;
  - `Voice` ≤ 124 KB;
  - engine ≤ 2,200 KB.

| `sizeof` (arm64) | N06 | N07 |
|---|---|---|
| `OrigamiEngine` | 2,126,096 | 2,124,992 |
| `Voice` | 121,992 | 121,544 |
| per-voice operator state | 2,560 | 2,048 |
| `ControlOpRuntime` | 80 | 64 |
| `CompiledModulation` | 62,112 | 68,144 (+6 KB `PlanKey` for change classification) |

- **Per-operator state:** CLOCK's cell index and EVENT DELAY's queue share
  storage (a union), because one operator id has one type for life.
- **The engine's 2 MB:** 16 voices × ~119 KB of oscillator state (16 modules ×
  16 unison oscillators). NODES state is under 2.5 KB per voice.

**Sequencer step count (audit):** 8 steps are enforced by the
`SequencerSettings` arrays (steps, probability, ratchets), the codec (fixed
8-entry fields since v20), the SYNTH editor and the DSP clamp. Expanding needs
a codec version and editor redesign, so it is deferred to a dedicated phase.

### 0.12 Performance (tools/nodes_bench.cpp, Release, arm64)

One held note with modules 2–4 off, except the ×16 rows. "Render" is µs per
512-sample block; "eval" is ns per sample for the global plan alone.

| Scenario | Render N06 | Render N07 | Eval N06 | Eval N07 |
|---|---|---|---|---|
| A empty | 67.7 | 31.7 | 4.2 | 4.0 |
| B 1 direct route | 70.4 | 33.8 | 13.2 | 13.3 |
| C 8 direct routes | 97.1 | 62.1 | 51.6 | 54.7 |
| D 16 direct routes | 101.8 | 67.7 | 68.6 | 62.4 |
| E 32 direct routes | 162.7 | 93.6 | 74.6 | 76.2 |
| F 8 control operators | 126.5 | 86.6 | 101.4 | 78.4 |
| G 24 mixed control | 255.9 | 130.9 | 341.1 | 165.3 |
| H event-heavy | 123.2 | 85.3 | 111.4 | 108.4 |
| I sequencing / generative | 106.6 | 73.5 | 87.0 | 87.0 |
| J 32-node mixed | 253.4 | 160.8 | 203.1 | 181.4 |
| K per-voice, 16 voices | 2072.9 | 1125.0 | — | — |
| K0 empty, 16 voices | 310.7 | 239.2 | — | — |
| J 32-node, 16 voices | 1837.6 | 875.0 | — | — |

- **Full compile:** 0.7–1.8 µs, unchanged. **Republishing an unchanged state:**
  ≈ 0.18 µs (classified and skipped).
- **Regression gate (FX tests):** the 32-node graph at 16 voices must cost
  < 12× the same engine without NODES. It measures ≈ 3.6×.

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

## 15. N05: EVENT / GATE / CLOCK, logic and stateful control (what exists now)

### 15.1 Signal families

| Family | Meaning | Socket | Cable |
|---|---|---|---|
| AUDIO | sample streams (bus graphs) | circle | thick red |
| CONTROL | continuous modulation value | diamond | thin solid white |
| EVENT | an instantaneous occurrence at one sample | small square | thin short dashes |
| GATE | a held state, exactly 0 or 1, with transitions | bar | thin long dashes |

- `NodeSignalType` gains `Gate`, and `ControlSignal` (Control / Gate / Event /
  None) types every operator port. EVENT and GATE share the square-socket
  family but never connect to each other.
- **Typing is strict, in both the model (`validModulation`) and authoring
  (`checkControlEdge`).** CONTROL→CONTROL, GATE→GATE and EVENT→EVENT only.
  Canonical sources are CONTROL, and only a CONTROL output can drive a
  parameter (a route).
- **Conversion happens only through explicit nodes:**
  - CONTROL→GATE: THRESHOLD, COMPARE
  - GATE→EVENT: EDGE
  - EVENT→GATE: PULSE, TOGGLE
  - EVENT/GATE→CONTROL: SAMPLE & HOLD, TRACK & HOLD, RANDOM, COUNTER, SWITCH
  - No float is ever treated as a trigger by a threshold check.

### 15.2 Representation and sample accuracy

- Events are typed values inside the existing per-sample operator plan:
  - an EVENT output is non-zero **only at the sample where it occurs**;
  - a GATE output is exactly 0 or 1.
- The engine already evaluates modulation every sample, and the host adapter
  renders up to each MIDI event's exact sample offset before applying it. So
  an event keeps its sample offset with no queue and no allocation:
  - a NOTE ON at sample 47 of a block fires at that voice's sample 47;
  - a CLOCK tick fires at the exact sample its grid cell starts.
- **Capacity:** one event per port per sample. Coincident events on the same
  port at the same sample merge into one occurrence. This is the
  deterministic overflow rule, and nothing ever queues, allocates or drops
  out of order. Events per block are bounded by block size × operators (32).
  Each operator has at most 3 inputs and one output; any fan-out is resolved
  at compile time.

### 15.3 Event sources

| Node | Domain | Semantics |
|---|---|---|
| CLOCK | GLOBAL | **TEMPO**: a tick each time the beat-position grid cell (DIVISION 1/1…1/32, T, D) changes, offset by PHASE. **FREE**: RATE Hz. |
| TRANSPORT | GLOBAL | START or STOP; fires at the first sample of the block where the host reports the change |
| NOTE ON | VOICE | each note start on the voice (fresh, stolen or legato) |
| NOTE OFF | VOICE | the voice's release |
| GATE | VOICE | open while the note is held |
| RETRIGGER | VOICE | a new note on a voice that is still sounding (mono/legato), never a fresh voice |

Performance values (velocity, note, keytrack, mod wheel, pitch bend,
aftertouch) remain CONTROL sources (N04), never events.

**Clock architecture:**

- The processor samples the host playhead once per callback (BPM, PPQ, playing)
  and passes it to `OrigamiEngine::setHostTransport`. When there is no host
  BPM, the tempo falls back to Origami's internal tempo.
- The engine keeps a beat position that advances by `bpm/60/sampleRate` per
  sample. While the host is playing with a valid PPQ, it resyncs to the host
  every block (no drift; block-size independent, tested). Otherwise it free
  runs.
- No UI or MessageManager timing is involved.

### 15.4 Logic and stateful nodes

| Node | Ports | Behaviour |
|---|---|---|
| THRESHOLD | CONTROL → GATE | opens above THRESHOLD + HYSTERESIS/2, closes below THRESHOLD − HYSTERESIS/2 |
| EDGE | GATE → EVENT | RISING, FALLING or BOTH (the initial previous state is closed) |
| PULSE | EVENT → GATE | opens for LENGTH seconds starting at the event's sample; a new event restarts it |
| COMPARE | CONTROL A, B → GATE | `>` `<` `>=` `<=`, plus `==` / `!=` within TOLERANCE |
| AND / OR / XOR / NOT | GATE → GATE | an unconnected gate is closed |
| SWITCH | CONTROL A, B, GATE SELECT → CONTROL | closed → A, open → B. GLIDE 0 is a deliberate instant switch; GLIDE > 0 crossfades |
| SAMPLE & HOLD | CONTROL VALUE, EVENT TRIG → CONTROL | captures VALUE at the trigger's sample |
| TRACK & HOLD | CONTROL VALUE, GATE → CONTROL | follows VALUE while open, holds while closed |
| RANDOM | EVENT → CONTROL | a new value per trigger in MIN…MAX, from xorshift seeded by SEED and the operator id |
| TOGGLE | EVENT → GATE | flips on each event |
| COUNTER | EVENT → CONTROL | position / (STEPS − 1), WRAP or CLAMP |
| ENV TRIGGER | EVENT → (target) | restarts ENV 2 or ENV 3 in the voice |

Further details:

- **SAMPLE & HOLD** captures VALUE *at the trigger's own sample*; the first
  evaluated sample also captures.
- **RANDOM:** a value exists from the first sample. The same preset always
  recalls the same sequence. No system RNG is used.
- **ENV TRIGGER** retriggers ENV 2 or ENV 3 inside the voice; the effect
  starts at the next sample. ENV 1 (the amp envelope) is not exposed, and
  normal MIDI envelope triggering is unchanged.

### 15.5 Same-sample ordering

```
sample N:  sources (global LFO/macro/... and each voice's ENV/notes)
        -> global operators, topological order
        -> per-voice operators, topological order (read global outputs: broadcast)
        -> destination frames (global, then per voice)
        -> targets (ENV TRIGGER: effective at N+1)
```

Every downstream node sees an event at the sample it occurs:

- CLOCK@N → S&H captures LFO(N) (tested).
- MACRO crosses @N → THRESHOLD opens @N → EDGE fires @N → RANDOM draws @N
  (tested).

### 15.6 Execution domains

These are the N04 rules, unchanged:

- An operator is per-voice if it is a voice-only node (NOTE ON, NOTE OFF,
  GATE, RETRIGGER, ENV TRIGGER) or anything upstream is per-voice.
- GLOBAL events broadcast into per-voice chains, for example CLOCK → a
  per-voice S&H.
- A per-voice result never reaches a GLOBAL parameter: rejected when
  authoring, inert if it arises.
- Voices are never averaged and no voice is ever picked.

### 15.7 Reset semantics

| Condition | Effect |
|---|---|
| prepare / engine reset / preset load (restore → reset) | all global operator state cleared |
| voice start (fresh or **stolen**) and retriggering retargets | that voice's operator state cleared |
| legato retarget without envelope retrigger | voice state kept |
| an operator id newly occupying a slot | starts fresh |

What "cleared" means for each node:

- SMOOTH: starts at its next input.
- S&H and T&H: capture at the next sample.
- TOGGLE: closed.
- COUNTER: 0.
- PULSE: closed.
- RANDOM: reseeded from SEED.
- THRESHOLD and EDGE: re-evaluated from closed.
- CLOCK: re-anchors to the grid.

Transport start does not reset state; a TRANSPORT START → (reset) chain is
the explicit way to do that. Runtime state (held values, toggle states,
counters, pending events) is **never serialized**. Voice stealing is tested:
a reused voice starts with a fresh TOGGLE.

### 15.8 Monitoring

- EVENT operators keep monotonic counters: global in `CompiledModulation`,
  per voice in each `Voice`.
- At the existing observation tick, the engine publishes the counters
  (summed for display only) together with the operator outputs, through the
  existing lock-free mailbox.
- The UI timer flashes a node when its counter changes; the flash decays on
  the timer. GATE outputs fill their socket while open.
- The inspector shows CONTROL values, OPEN/CLOSED, and event counts.
- Execution never depends on monitoring, and QoS suppression only stops
  publishing.

### 15.9 Interoperability, state, realtime

- **Matrix:** a parameter driven through an event graph is still one
  processed row (`NODES: SAMPLE & HOLD (LFO 1)`). Event graphs are never
  flattened into fake rows. **SYNTH:** rings and arcs work as in N04.
- **Save format:** instrument codec **v29** stores the third operator input.
  It is written only when an N05 node or a third input exists. Otherwise N04
  states stay v28 and operator-free states stay v27. v28 and v27 load
  unchanged.
- **Realtime:** fixed arrays only, with no allocation, locks, strings or UI
  access (allocation guard tested with clocks, counters, note events and
  T&H). Patches without N05 nodes run no N05 code beyond advancing one double
  per sample. The N02 golden fingerprints and all engine tests are unchanged.

Engine tests now allocate their ~2 MB engines on the heap. The added
per-voice state pushed the test runner's inlined stack frame past 8 MB; the
production engine always lived on the heap inside the processor.

### 15.10 Deferred

- **Sequencer ADVANCE/RESET:** the existing sequencer is a free-running global
  generator evaluated before the operators. Driving it from events needs a
  redesign of its clocking, so it moves to N06 rather than becoming a second
  sequencer.
- **COUNTER's ON WRAP event output:** it would need multi-output nodes.
- **Musically synced PULSE length:** milliseconds only for now.
- **Event cable activity animation:** node flashes only.
- **TOGGLE RESET input.**
- **Audio → control analysis:** a later phase.

## 16. N06: sequencing, generative modulation and multi-output nodes (what exists now)

### 16.1 The existing sequencer (audit)

Before N06 Origami had exactly one sequencer:

- **`SequencerSettings`** (instrument state, codec fields since v20): 8 step
  values (−1…1), `activeSteps`, direction (FORWARD / REVERSE / PING-PONG),
  loop, per-step probability, per-step ratchets (1–4), humanize, `rateHz`.
- **`SequencerGenerator`** (the engine's `globalSequencer_`): the clock phase
  at `rateHz` (scaled by ratchets and humanize), the step index and the held
  output. It ran in the engine's global source pass, before the operators,
  only while a route used the SEQ source (slot 12) and the sequencer
  collection was active.
- Reset happened only on engine reset. There is no per-step gate state in the
  engine: the SYNTH editor's step power only mutes values in the UI.

### 16.2 The canonical SEQUENCER node

The SEQUENCER node is a **view of that one sequencer**, never a second engine.

- At most one SEQUENCER exists (validation, `controlOperatorCreatable`, and the
  ADD menu disables it with the reason). It is GLOBAL only: a per-voice input
  is rejected.
- The engine passes its `SequencerGenerator` and the canonical
  `SequencerSettings` to the plan (`ControlEventContext`). When a plan
  contains the node, **the legacy source pass never calls `next()`**. One
  clock owner per sample, so it is never double clocked.
- The node's VALUE is written to the canonical SEQ source for the same
  sample. SEQ routes, the SYNTH rings and other nodes reading SEQ see exactly
  the node's value (a SEQ source read waits for the node in topological order).
- Placing the node marks the sequencer collection active. Its steps are never
  rewritten.
- **Without the node, the legacy path is unchanged.** `next()` keeps its exact
  operation order and is tested step-for-step against a plain generator run,
  and the golden fingerprints are unchanged.

| Port | Signal | Meaning |
|---|---|---|
| ADVANCE (in 0) | EVENT | EXTERNAL mode: one whole step per event |
| RESET (in 1) | EVENT | back to the start step (applied first, see 16.5) |
| VALUE (out 0) | CONTROL, bipolar | the value of the step begun at this sample (probability applied) |
| STEP (out 1) | CONTROL, unipolar | step / (activeSteps − 1) |
| STEP EVENT (out 2) | EVENT | a step (or a ratchet repeat) began at this sample |

There is no GATE output: the engine has no per-step gate state, so none is
invented.

### 16.3 Clock ownership (INTERNAL vs EXTERNAL)

- **CLOCK = INTERNAL** (a new node's default): the sequencer's own clock at
  RATE, with ratchets and humanize exactly as before. ADVANCE is ignored.
- **CLOCK = EXTERNAL:** the phase never advances; each ADVANCE event plays one
  step, honouring direction, loop and per-step probability. Ratchets and
  humanize shape only the internal clock.
- Connecting a cable to ADVANCE selects EXTERNAL in the same edit (one undo
  step), so a clock cable is never silently ignored. The mode remains an
  explicit parameter afterwards.
- With an internal clock, VALUE changes at the sample the new step begins,
  together with STEP EVENT. The legacy SEQ source (no node) still outputs
  the previous step on that boundary sample, as before.

### 16.4 Multi-output nodes and port identity

- `ControlOpInfo` declares `outputCount` (≤ 4), the signal of each extra
  port and the port names. Port 0 is the primary output (`info.output`).
- **A connection's identity includes the source output port:**
  - an operator input stores `ControlInput{kind, source, op, port}`;
  - a route stores the port inside its `ModSource`
    (`operatorSource(id, port)` puts the port in bits 20–21);
  - port 0 is bit-identical to the pre-N06 encoding, so every N03–N05
    connection is a port-0 connection without migration code.
- Typing is checked per port everywhere (validation, authoring, compile):
  COUNTER WRAP (EVENT) can feed TOGGLE but never a parameter.
- **Fan-out:** any output feeds any number of consumers. Nothing consumes an
  event; every consumer sees it at the same sample.
- **Runtime:** `ModulationFrame::operatorOutputs` holds 32 × 4 values,
  indexed `slot*4 + port`. Each evaluation writes every port of its node
  (EVENT ports are 0 between events). Monitor slots follow the same index
  (`modulationSourceSlotCount = 26 + 128`).
- Routes from operators use compact **routed slots**: only the (≤ 32)
  outputs that actually drive parameters get group slots. Groups stay
  26 + 32 wide, and smoothing weights are carried across recompiles by
  output index.

### 16.5 Same-sample order and RESET

**Within one node at sample N, RESET is applied first, then ADVANCE / TRIG:**

| Node | RESET + ADVANCE on the same sample |
|---|---|
| COUNTER | position 0, then advance: position 1 |
| SEQUENCER | restart (armed), then advance: plays the start step |
| CLOCK DIVIDER / EUCLIDEAN / PATTERN | index 0, then this event is step 0 (all divider outputs fire) |
| TOGGLE | off, then flip: on |
| RANDOM / RANDOM WALK | reseed (centre for RANDOM WALK), then one step |

**SEQUENCER reset convention:** after RESET (or an engine reset) an EXTERNAL
sequencer is *armed*:

- it shows the start step's value;
- it does not fire STEP EVENT or roll probability;
- the first ADVANCE then plays the start step itself, so a downbeat clock
  plays step 1.

An INTERNAL sequencer begins the start step at the reset sample.

**COUNTER's position 0 is itself the reset state** (the counter-chip
convention), so its first ADVANCE moves it to 1.

**Multi-output consistency:** every port of a node is computed in one
evaluation. When COUNTER wraps at N, VALUE = 0 and WRAP = 1 are both visible
at N, and every consumer of either port reacts at N (tested).

### 16.6 Node library (N06)

| Node | Ports | Behaviour |
|---|---|---|
| COUNTER (upgraded) | ADVANCE, RESET → VALUE, WRAP | VALUE = position / (LENGTH − 1). **WRAP mode:** WRAP fires on returning to 0. **CLAMP mode:** fires once on reaching the end. **PING-PONG mode:** fires on reaching either end |
| CLOCK DIVIDER | CLOCK, RESET → /2, /4, /8, /16 | the 1st, 3rd, 5th… event for /2 (etc.); the first event fires every output |
| EVENT DELAY | IN → OUT | TIME in ms, or SYNC to a tempo division (resolved per event at the current tempo) |
| PROBABILITY | IN → OUT | each event passes with CHANCE |
| CHANCE SPLIT | IN → A, B | exactly one of A / B per event (A with A CHANCE) |
| EVENT MERGE | A, B, C → OUT | any input event. Coincident events merge into one |
| EUCLIDEAN | CLOCK, RESET → OUT | STEPS 1–32, PULSES 0–STEPS, ROTATION. Hit when `(i·pulses) mod steps < pulses`: the maximally even (Bjorklund) necklace, e.g. E(3,8) `x..x..x.`, E(4,16) four-on-the-floor |
| PATTERN | CLOCK, RESET → OUT | a binary mask of LENGTH ≤ 32 steps (two 16-bit integer parameters). Steps toggle on the node |
| RANDOM WALK | TRIG, RESET → OUT | ± STEP per trigger within MIN…MAX, CLAMP or REFLECT. Starts at the centre |
| SEQUENCER | see 16.2 | the canonical sequencer |

**EVENT DELAY scheduler:**

- It is bounded: 8 pending countdowns per node (fixed array). An event at N
  with delay D fires at N + D, across block boundaries.
- **Overflow:** when 8 events are pending, the *newest* is dropped, so earlier
  events keep exact timing.
- Pending events are runtime state: never serialized, and cleared by every
  reset.

**Reset inputs:** RESET was added to TOGGLE, RANDOM and COUNTER (and exists on
every new stateful node).

**Deliberately not added:**

- **CLOCK MULTIPLIER:** a sample-exact ×N needs the *next* tick's time, which
  an EVENT input can only predict from past intervals. That fails on tempo
  changes and seeks. For tempo-synced ×N, use a second CLOCK at the finer
  division.
- **NOTE QUANTIZER:** a CONTROL value has no defined pitch unit. Pitch routes
  scale per destination (SEMITONE ±12, FINE ±100 ct), so a scale quantizer
  would invent an incompatible convention. Use QUANTIZE (generic steps).
- **Slewed random:** RANDOM → SMOOTH composes it.
- **DRIFT / CHAOS / FUNCTION:** already canonical CONTROL sources, edited on
  SYNTH > MODULATORS and reusable in NODES as sources. No second
  implementation exists.

### 16.7 Generative determinism

- Every random node uses its own xorshift32. The seed is
  `hash(SEED parameter, operator id)`, set at the node's first evaluation and
  at RESET.
- The generator advances **once per input event**, never per sample. The
  n-th event of a given preset always draws the same value, whatever the
  block size (tested 32 / 64 / 128 / 512 / 1024: bit-identical).
- No wall clock or system RNG is used. Per-voice copies start from the same
  seed: deterministic, and isolated per voice (tested).

### 16.8 Transport

- Tempo-synced CLOCKs read the engine beat position, which resyncs to the
  host PPQ at every block start.
- **Precision:** tempo is block-level (the host reports one BPM per block).
  Within a block, the position advances linearly at that tempo.
- **Seek and loop:** a jump that lands in a new grid cell produces exactly one
  tick at the first sample of the block. A jump within the same cell ticks
  nothing. There are no double triggers (tested).
- An EXTERNAL sequencer simply follows its clock. TRANSPORT START → RESET is
  the explicit way to restart it with the song.
- EVENT DELAY SYNC converts its division at the tempo current when the event
  arrives.

### 16.9 Authoring UI

- **Multi-output sockets** sit one per row on the right (22 px pitch), each
  labelled (VALUE / WRAP, A / B, /2…/16). Each hit target is at least 9
  screen px at any zoom; where targets overlap when zoomed out, the nearest
  socket wins.
- **INSERT NODE** on a cable offers only nodes whose first input takes the
  cable's signal *and* that have an unambiguous output for the consumer.
  Node choice uses `controlAutoOutputPort`: the primary output if it matches,
  else the *only* matching port; otherwise the node is not offered.
- **Drag to empty space:**
  - Dropping a cable from an output on empty canvas opens a menu filtered to
    nodes with a compatible input (plus PARAMETER… for CONTROL). The chosen
    node is created at the drop point and connected in **one undo step**.
  - Dragging back from an unconnected input works the same way, offering
    nodes with an unambiguous compatible output (and canonical sources for
    CONTROL inputs).
- **SEQUENCER node:** shows the clock mode, a step preview (activeSteps bars)
  and the current step. The step comes from the engine's published
  visualization snapshot at the existing observation rate.
- **SEQUENCER inspector:** edits the canonical `SequencerSettings` (8 steps,
  STEPS, RATE, DIRECTION, LOOP) next to the node's CLOCK mode. SYNTH >
  SEQUENCER edits the same state; there is no copy.
- **PATTERN** cells toggle on click, one undo step each.
- **Undo:**
  - Slider drags coalesce into one step, including sequence edits.
  - A sequence edit snapshot carries `SequencerSettings`; other NODES undo
    steps never rewind a sequence edited elsewhere.
- **CLEAR** clears the bus graph only. Deleting the SEQUENCER node removes the
  node and its connections; **the sequence is never reset**.
- **Matrix:** a route from a multi-output node names its port
  (`NODES: SEQUENCER VALUE`). Event topology is never shown as rows.

### 16.10 State, memory, realtime

**Save format:** instrument codec **v30**:

- Each operator input gains a port word.
- It is written only when an N06 node, a non-zero port (in an input or a
  route), a RESET connection on TOGGLE / RANDOM / COUNTER, or COUNTER
  PING-PONG is present. Otherwise N05 graphs stay v29, N04 v28, and
  operator-free states v27.
- Older builds reject v30 cleanly instead of misreading it. v27–v29 load
  unchanged.
- The sequence keeps its existing fields.

**Memory** (`sizeof`, arm64):

| Object | N05 | N06 |
|---|---|---|
| `OrigamiEngine` | 2 092 728 | 2 126 096 (+1.6%) |
| `Voice` | 120 184 | 121 992 |
| `CompiledModulation` | 60 368 | 62 112 |
| `ModulationFrame` | 8 464 | 8 864 |
| `ModulationState` | 4 712 | 5 096 |
| per-voice operator state | 1 536 | 2 560 |

The 32-operator limit is unchanged. It keeps per-voice state at 2.5 KB and
the plan bounded. The routed-slot design avoided widening every group to
26 + 128 slots (+55 KB).

**Realtime:**

- Fixed arrays only, with no allocation, locks, strings or UI access
  (allocation guard tested on a graph with CLOCK, EUCLIDEAN, EVENT DELAY,
  SEQUENCER, RANDOM WALK, CHANCE SPLIT and a reset-wired COUNTER).
- Compilation is O(operators²) at worst, on the existing audio-thread
  compile path. Evaluation is one pass over the topological plan.
- Panning, zooming and dragging nodes touch only view metadata, never the
  plan.

### 16.11 Deferred / limitations

- **CLOCK MULTIPLIER** and **NOTE QUANTIZER** (see 16.6).
- **Copy / paste:** single-node DUPLICATE exists; a clipboard is deferred.
- **Cable activity animation:** nodes flash on any EVENT port (port-aware
  counters); cables do not animate.
- **PATTERN editing:** steps toggle on the node; a wider expanded editor for
  32 steps is deferred (cells shrink with LENGTH on the 220 px node).
- **Per-voice random seeds** are identical across voices: deterministic,
  but voices draw the same sequence.
- **SEQUENCER limits:** step count stays 8 (the existing `SequencerSettings`).
  EXTERNAL mode ignores ratchets and humanize.
