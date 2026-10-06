// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-v40.3.1-sequence-expression
// mct-origami-v40.2.0-sequence-transport
// mct-origami-v39.2.1-sequence-ui-monitor
// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-modulation-completion-v24
// mct-origami-v34.0.0-random-lfo
// mct-origami-v34.1.0-mod-scroll-clip-mseg-audio
// mct-origami-v34.2.1-performance-reinforcement
// mct-origami-v34.3.0-lfo-interaction-mod-properties
#pragma once
#include "core/OscillatorModule.h"
#include "core/dsp/Filter.h"
#include "core/dsp/Envelope.h"
#include <array>
#include <type_traits>
#include <atomic>
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>
namespace mct::origami {

// mct-origami-nodes-n01: None (0) is an unselected Matrix source/destination.
// A route with either end None is incomplete and inert (never compiled).
enum class ModSource : std::uint32_t {
    None=0,
    Env1=1, Env2=2, Env3=3,
    Lfo1=101, Lfo2=102, Lfo3=103, Lfo4=104,
    Macro1=201, Macro2=202, Macro3=203, Macro4=204,
    ModWheel=301, Velocity=302, Keytrack=303, Aftertouch=304,
    PitchBend=305, NoteGate=306,
    Random=401, Function=501,
    Chaos=601, Drift=602, Sequencer=603
};
// mct-origami-synth-dynamic-macros: dynamic macros with STABLE ids 1..maxMacros.
// A macro's source is ModSource(200 + id): ids 1..4 are exactly the original
// Macro1..Macro4 (every existing route and preset keeps its meaning), ids
// 5..16 continue the same range (205..216; 301 is the next used value).
// The id is the identity and the storage index: removing a macro never
// renumbers another one, so no route can ever move to a different macro.
inline constexpr std::size_t maxMacros=16;
inline constexpr std::uint16_t defaultMacroMask=0x000Fu; // Init: MACRO 1..4
constexpr ModSource macroSource(std::size_t id) noexcept { return static_cast<ModSource>(200u+static_cast<std::uint32_t>(id)); }
constexpr std::size_t macroIdOf(ModSource s) noexcept {
    const auto v=static_cast<std::uint32_t>(s);
    return v>200u && v<=200u+maxMacros ? std::size_t(v-200u) : 0u;
}
constexpr bool isMacroSource(ModSource s) noexcept { return macroIdOf(s)!=0; }
enum class ModDestination : std::uint32_t {
    None=0,
    Cutoff=1, Resonance=2, MasterGain=3, MainTuning=4, Transpose=5,
    PortaTime=6, EnvelopeScaling=7, LfoScaling=8, Swing=9,
    WtPosition=101, Octave=102, Semitone=103, Fine=104, Detune=105, Pan=106, Level=107,
    Process1Amount=108, Process2Amount=109, Route1Amount=110, Route2Amount=111,
    // Stable-ID dynamic destinations. 108..111 remain readable legacy values.
    ProcessAmount=112, RouteAmount=113,
    // FX graph parameter. ModAddress.oscillator carries the FxNodeId and
    // ModAddress.itemId packs (BusId << 16) | FxParameterId. Bus 0 (P03
    // routes) means MAIN. Never a display label.
    FxParameter=201,
    // mct-origami-nested-modulation-manual-qa: modulation of modulation.
    // ModAddress.oscillator is 0; ModAddress.itemId is the LFO number (1..4),
    // the macro's stable id (1..16) or the target route's stable id. A route
    // depth is identified by that id, never by its array index.
    LfoRate=301,      // the canonical LFO rate (Hz; BEATS / SECONDS / HZ are views)
    MacroValue=302,   // the macro's EFFECTIVE value (its stored base never moves)
    RouteDepth=303    // the depth (amount) of another route
};
constexpr bool isNestedDestination(ModDestination d) noexcept {
    return d==ModDestination::LfoRate || d==ModDestination::MacroValue || d==ModDestination::RouteDepth;
}
enum class LfoShape : std::uint32_t { Sine=1, Triangle=2, Saw=3, Square=4 };
// Preserve serialized values: legacy NoteRetrigger (2) is now named Loop.
enum class LfoMode : std::uint32_t { Free=1, Loop=2, Envelope=3 };

struct LfoPoint { float x=0.0f,y=0.0f,curve=0.0f; };
// mct-origami-lfo-function-processing: FUNC processing is part of the one
// canonical LFO. Every field's default is its neutral value; with all of
// them neutral the LFO is the accepted pre-FUNC LFO, bit for bit.
struct LfoSettings {
    LfoShape shape=LfoShape::Sine;
    LfoMode mode=LfoMode::Free;
    float rateHz=1.0f;
    std::array<LfoPoint,16> points{};
    std::uint32_t pointCount=0;
    bool pingPong=false;        // read position reflects at the ends (0->1->0 per cycle)
    float smooth=0.0f;          // 0..1  output slew (one-pole, period-relative)
    float attackSeconds=0.0f;   // 0..10 modulation-depth fade-in after DELAY
    float delaySeconds=0.0f;    // 0..10 neutral hold before the LFO starts
    float phase=0.0f;           // 0..1  read-phase offset in cycles (1 = 360 deg)
    float skew=0.0f;            // -1..1 monotonic time-axis warp (0 = identity)
    float quantize=0.0f;        // 0..1  amplitude levels: 0 = continuous, 1 = 2 levels
    float entropy=0.0f;         // 0..1  organic, evolving timing/trajectory drift
    float fracture=0.0f;        // 0..1  deterministic structural fragmentation
    // mct-origami-stereo-modulation: RIGHT reads the same processed LFO at a
    // phase offset of stereo * 180 deg (LEFT is the reference). 0 = mono.
    float stereo=0.0f;          // 0..1
    static constexpr float maxTimeSeconds=10.0f;
};
// True when every FUNC processor and PING-PONG is neutral (legacy path).
// STEREO is deliberately not part of this test: it never changes LEFT, so the
// LEFT/reference channel takes exactly the same path with or without it.
inline bool lfoFunctionsNeutral(const LfoSettings& s) noexcept {
    return !s.pingPong && s.smooth==0.0f && s.attackSeconds==0.0f && s.delaySeconds==0.0f && s.phase==0.0f &&
           s.skew==0.0f && s.quantize==0.0f && s.entropy==0.0f && s.fracture==0.0f;
}
struct RandomSettings {
    float rateHz=2.0f;
    // 0 = classic hard sample-and-hold, 1 = fully continuous glide to the
    // next random target during the transition portion of each cycle.
    float smoothing=0.0f;
    // Fraction of each cycle held flat before the optional glide begins.
    float hold=0.72f;
    // Initial silence after generator reset, useful for delayed random motion.
    float delaySeconds=0.0f;
};
struct FunctionSettings { float rateHz=1.0f; float curve=0.0f; };
enum class ChaosAxis : std::uint32_t { X=1, Y=2, Z=3 };
enum class ChaosMethod : std::uint32_t { Lorenz=1, Rossler=2, Thomas=3 };
struct ChaosSettings {
    float rateHz=8.0f;
    float chaos=0.32f;
    float flow=0.286f;
    float damping=0.211f;
    float warp=0.0f;
    float smoothing=0.08f;
    ChaosAxis axis=ChaosAxis::X;
    ChaosMethod method=ChaosMethod::Lorenz;
};
struct DriftSettings { float rateHz=0.35f; };
enum class SequenceDirection : std::uint32_t { Forward=1, Reverse=2, PingPong=3 };
struct SequencerSettings {
    float rateHz=4.0f;
    std::array<float,8> steps{{-1.0f,-0.25f,0.65f,0.15f,1.0f,-0.55f,0.35f,0.0f}};
    std::uint32_t activeSteps=8;
    SequenceDirection direction=SequenceDirection::Forward;
    bool loop=true;
    std::array<float,8> probability{{1,1,1,1,1,1,1,1}};
    std::array<std::uint32_t,8> ratchets{{1,1,1,1,1,1,1,1}};
    float humanize=0.0f;
};
struct PerformanceSourcePoint { float x=0.0f,y=0.0f,curve=0.0f; };
struct PerformanceSourceCurve {
    std::array<PerformanceSourcePoint,16> points{{
        {0.0f,0.0f,0.0f},{0.5f,0.5f,0.0f},{1.0f,1.0f,0.0f}
    }};
    std::uint32_t pointCount=3;
};
float performanceSourceCurveValue(const PerformanceSourceCurve&,float input) noexcept;

struct ModAddress {
    ModDestination parameter=ModDestination::Cutoff;
    OscillatorModuleId oscillator=0;
    // Stable child identity for ProcessAmount / RouteAmount. Zero for all
    // scalar and legacy destinations.
    std::uint32_t itemId=0;
    bool operator==(const ModAddress& o) const noexcept {
        return parameter==o.parameter && oscillator==o.oscillator && itemId==o.itemId;
    }
};
inline bool isFxDestination(ModDestination d) noexcept { return d==ModDestination::FxParameter; }
// mct-origami-nested-modulation-manual-qa: nested destination addresses.
inline ModAddress lfoRateAddress(std::size_t lfoIndex) noexcept { return {ModDestination::LfoRate,0,static_cast<std::uint32_t>(lfoIndex+1)}; } // index 0..3
inline ModAddress macroValueAddress(std::size_t macroId) noexcept { return {ModDestination::MacroValue,0,static_cast<std::uint32_t>(macroId)}; }
inline ModAddress routeDepthAddress(std::uint32_t routeId) noexcept { return {ModDestination::RouteDepth,0,routeId}; }
// The canonical LFO rate range and its knob / modulation mapping: equal ratios
// per equal travel (0.01 Hz .. 40 Hz, ~12 octaves; 1 Hz sits at 55.5 %).
inline constexpr float lfoRateMinimumHz=0.01f,lfoRateMaximumHz=40.0f;
float lfoRateToNormalized(float hz) noexcept;
float lfoRateFromNormalized(float normalized) noexcept;
// mct-origami-unified-routing-core-fx-p04: FX node IDs are unique per bus
// graph, so the bus is part of the destination identity.
inline ModAddress fxParameterAddress(std::uint32_t bus,std::uint32_t node,std::uint32_t parameter) noexcept {
    return {ModDestination::FxParameter,node,(bus<<16)|(parameter&0xffffu)};
}
inline ModAddress fxParameterAddress(std::uint32_t node,std::uint32_t parameter) noexcept {
    return fxParameterAddress(mainBusId,node,parameter);
}
inline std::uint32_t fxAddressBus(const ModAddress& a) noexcept {
    const auto bus=a.itemId>>16;
    return bus==0 ? mainBusId : bus;
}
inline std::uint16_t fxAddressParameter(const ModAddress& a) noexcept {
    return static_cast<std::uint16_t>(a.itemId&0xffffu);
}
// ---- CONTROL operators (mct-origami-nodes-n04-control-processing) ----------
// Optional processing between modulation sources and a route's destination.
// A PROCESSED route is still one canonical ModRoute whose source is an
// operator output (operatorSource(id)); direct routes are untouched.
enum class ControlOpType : std::uint8_t {
    None=0,
    Add=1, Subtract=2, Multiply=3, Min=4, Max=5,                 // MATH (inputs A, B)
    ScaleOffset=10, Remap=11, Curve=12, Abs=13, Invert=14, Clamp=15, // SHAPING (input IN)
    Constant=20, Smooth=21, Quantize=22,                         // UTILITY
    // N05 EVENT / GATE family.
    Clock=40, NoteOn=41, NoteOff=42, NoteGate=43, Retrigger=44, Transport=45, // event/gate sources
    Threshold=50, Edge=51, Pulse=52,                             // conversion
    Compare=60, And=61, Or=62, Xor=63, Not=64, Switch=65,        // logic
    SampleHold=70, TrackHold=71, RandomTrigger=72, Toggle=73, Counter=74, // stateful
    EnvelopeTrigger=80,                                          // target: retrigger ENV 2 / ENV 3
    // N06 sequencing / generative (multi-output capable).
    ClockDivider=90, EventDelay=91, Probability=92, ChanceSplit=93, EventMerge=94,
    Euclidean=95, Pattern=96, RandomWalk=97,
    Sequencer=100                                                // the canonical Origami sequencer (singleton view)
};
// What a port carries. CONTROL: continuous value. GATE: exactly 0 or 1, with
// transitions. EVENT: non-zero only at the sample where it occurs (at most one
// per port per sample; coincident events merge). None: no output (a target).
enum class ControlSignal : std::uint8_t { None=0, Control=1, Gate=2, Event=3 };
enum class ControlRange : std::uint8_t { Unipolar=1, Bipolar=2 }; // nominal 0..1 / -1..1
enum class ControlCurveMode : std::uint8_t { Linear=0, Exponential=1, Logarithmic=2, SCurve=3 };
struct ControlInput {
    enum class Kind : std::uint8_t { None=0, Source=1, Operator=2 };
    Kind kind=Kind::None;
    ModSource source=ModSource::None; // Kind::Source (never an operator source)
    std::uint32_t op=0;               // Kind::Operator: operator id
    std::uint8_t port=0;              // Kind::Operator: the upstream OUTPUT port (N06; N05 = 0)
    bool operator==(const ControlInput& o) const noexcept { return kind==o.kind && source==o.source && op==o.op && port==o.port; }
};
// N06: a node exposes up to this many typed outputs.
inline constexpr std::size_t maxControlOutputs=4;
inline constexpr std::size_t controlOpParameterCount=6;
struct ControlOperator {
    std::uint32_t id=0; // 0 = free storage slot (slots never move while in use)
    ControlOpType type=ControlOpType::None;
    std::array<float,controlOpParameterCount> params{};
    std::array<ControlInput,3> inputs{}; // one connection per input, by construction (3rd: N05)
    bool operator==(const ControlOperator& o) const noexcept { return id==o.id && type==o.type && params==o.params && inputs==o.inputs; }
    bool operator!=(const ControlOperator& o) const noexcept { return !(*this==o); }
};
// Stable source identity of an operator's output.
// N06: the output PORT lives in bits 20..21, so port 0 is exactly the N04/N05
// encoding (existing routes migrate unchanged). Operator ids stay < 2^20.
inline constexpr std::uint32_t controlOperatorSourceBase=0x10000u;
inline constexpr std::uint32_t controlOperatorIdMask=0xfffffu;
inline ModSource operatorSource(std::uint32_t id,std::uint8_t port=0) noexcept {
    return static_cast<ModSource>(controlOperatorSourceBase+(id&controlOperatorIdMask)+(std::uint32_t(port&3u)<<20));
}
inline bool isOperatorSource(ModSource s) noexcept { return static_cast<std::uint32_t>(s)>controlOperatorSourceBase; }
inline std::uint32_t operatorIdOf(ModSource s) noexcept {
    return isOperatorSource(s) ? (static_cast<std::uint32_t>(s)-controlOperatorSourceBase)&controlOperatorIdMask : 0u;
}
inline std::uint8_t operatorPortOf(ModSource s) noexcept {
    return isOperatorSource(s) ? std::uint8_t(((static_cast<std::uint32_t>(s)-controlOperatorSourceBase)>>20)&3u) : 0u;
}

// Static description of each operator type (inputs, parameters, defaults,
// bounds). The one schema shared by validation, DSP, UI and the codec.
struct ControlOpParameterInfo { const char* label; float minimum,maximum,defaultValue; bool integer; };
struct ControlOpInfo {
    ControlOpType type;
    const char* label;
    const char* category; // "Math" / "Shaping" / "Utility" / N05: "Sources" / "Conversion" / "Logic" / "Stateful" / "Targets"
    std::uint8_t inputs;  // 0..3
    std::uint8_t parameterCount;
    std::array<ControlOpParameterInfo,controlOpParameterCount> parameters;
    // Typed ports (N05). Defaults describe the N04 CONTROL operators.
    std::array<ControlSignal,3> inputSignals{{ControlSignal::Control,ControlSignal::Control,ControlSignal::Control}};
    ControlSignal output=ControlSignal::Control;
    std::array<const char*,3> inputNames{{nullptr,nullptr,nullptr}}; // null: "IN" / "A" / "B"
    bool voiceOnly=false; // evaluated inside each voice (note events, envelope targets)
    bool family=false;    // true: EVENT / LOGIC catalog family
    // N06 multi-output: port 0 is `output`; ports 1.. are listed here.
    std::uint8_t outputCount=1;
    std::array<ControlSignal,maxControlOutputs-1> extraOutputs{};
    std::array<const char*,maxControlOutputs> outputNames{{nullptr,nullptr,nullptr,nullptr}}; // null: "OUT"
    bool globalOnly=false; // N06: never per-voice (the canonical sequencer)
};
ControlSignal controlOutputSignalOf(const ControlOpInfo&,std::size_t port) noexcept;
// N07: the one display name of a signal type ("CONTROL" / "GATE" / "EVENT" / "NONE").
constexpr const char* controlSignalName(ControlSignal s) noexcept {
    return s==ControlSignal::Gate ? "GATE" : s==ControlSignal::Event ? "EVENT" : s==ControlSignal::None ? "NONE" : "CONTROL";
}
const char* controlOutputName(const ControlOpInfo&,std::size_t port) noexcept;
const ControlOpInfo* controlOpInfo(ControlOpType) noexcept;
const std::array<ControlOpType,15>& controlOpCatalog() noexcept; // N04 CONTROL operators (+ None)
const std::array<ControlOpType,21>& controlEventOpCatalog() noexcept; // N05 EVENT / LOGIC nodes
const std::array<ControlOpType,9>& controlSequencingOpCatalog() noexcept; // N06 SEQUENCING / GENERATIVE nodes
class SequencerGenerator;
struct SequencerSettings;
const char* controlInputName(const ControlOpInfo&,std::size_t input) noexcept;
// N05 timing / note context of one sample (global part set by the engine,
// voice part set by each voice).
struct ControlEventContext {
    double beats=0.0;          // quarter-note position at this sample
    double beatsPerSample=0.0; // tempo / 60 / sample rate
    double sampleRate=48000.0;
    bool transportStart=false,transportStop=false;
    bool noteOn=false,noteOff=false,retrigger=false,gate=false; // this voice
    // N07: per-voice RNG stream salt (0 = global evaluation: unchanged
    // sequences). Derived from the voice slot and that slot's note lifecycle.
    std::uint32_t voiceSeed=0;
    // N07 diagnostics: incremented when an EVENT DELAY drops an event (queue
    // full). Points at an audio-thread counter; never read during evaluation.
    std::uint32_t* eventOverflow=nullptr;
    // N06: the canonical sequencer runtime and settings (global evaluation only).
    SequencerGenerator* sequencer=nullptr;
    const SequencerSettings* sequencerSettings=nullptr;
};
// Values prepared at compile time (never computed per sample).
struct ControlOpPrepared {
    float rise=1.0f,fall=1.0f;     // SMOOTH
    std::int32_t pulseSamples=1;   // PULSE
    double clockStep=0.0;          // CLOCK free-running phase per sample
    double divisionBeats=1.0;      // CLOCK tempo division in quarter notes
    double switchStep=1.0;         // SWITCH crossfade per sample
    std::int32_t delaySamples=1;   // EVENT DELAY (milliseconds mode)
};
ControlOpPrepared prepareControlOp(const ControlOperator&,double sampleRate) noexcept;
// CLOCK divisions (quarter notes): 1/1 1/2 1/4 1/8 1/16 1/32 1/4T 1/8T 1/16T 1/4D 1/8D 1/16D.
inline constexpr std::size_t clockDivisionCount=12;
double clockDivisionBeats(int index) noexcept;
const char* clockDivisionLabel(int index) noexcept;
ControlOperator makeControlOperator(ControlOpType,std::uint32_t id) noexcept;
// Pure evaluation of one operator (shared by the realtime evaluator and tests).
// `state` is the operator's persistent state (SMOOTH); `smoothing` its
// prepared rise/fall coefficients. Unconnected inputs: ADD/SUB 0, MULTIPLY 1,
// MIN/MAX pass the other input.
// Per-instance runtime state (global: one; per-voice: one per voice). Reset
// rules are documented in NODES_ARCHITECTURE.md section 15.
struct ControlOpRuntime {
    float value=0.0f; std::uint32_t id=0;
    double phase=0.0;          // CLOCK free phase / SWITCH mix
    std::uint32_t rng=0;       // RANDOM
    std::int32_t counter=0;    // COUNTER position / PULSE remaining samples
    static constexpr std::size_t delayCapacity=8;
    // N07: per-type state that is never used together shares storage (one
    // operator id = one type for its whole life; a new id starts fresh).
    union {
        std::int64_t index=0;  // CLOCK tempo cell
        std::array<std::int32_t,delayCapacity> pending; // N06 EVENT DELAY: samples remaining, oldest first
    };
    bool initialized=false;
    bool gate=false;           // THRESHOLD / TOGGLE state
    bool previous=false;       // EDGE previous gate
    bool forward=true;         // N06 COUNTER ping-pong direction
    std::uint8_t pendingCount=0;
};
// N07 memory gate: per-operator runtime state is held per voice for every
// operator slot (32 x 16 voices); growing it is a deliberate decision.
static_assert(sizeof(ControlOpRuntime)<=64,"ControlOpRuntime grew: per-voice state is 32 slots x every voice");
struct ControlOpInputs {
    std::array<float,3> value{};
    std::array<bool,3> connected{};
    std::array<ControlRange,3> range{{ControlRange::Unipolar,ControlRange::Unipolar,ControlRange::Unipolar}};
};
float evaluateControlOp(const ControlOperator&,const ControlOpInputs&,ControlOpRuntime&,
                        const ControlOpPrepared&,const ControlEventContext&) noexcept;
// N06: every output port (outputs[0] is also the return value above).
void evaluateControlOpOutputs(const ControlOperator&,const ControlOpInputs&,ControlOpRuntime&,
                              const ControlOpPrepared&,const ControlEventContext&,
                              std::array<float,maxControlOutputs>& outputs) noexcept;
// N06 EUCLIDEAN: true when step `index` of an E(pulses, steps) rhythm, rotated, is a hit.
bool euclideanHit(int steps,int pulses,int rotation,int index) noexcept;
float evaluateControlOp(const ControlOperator&,float a,bool aConnected,ControlRange aRange,
                        float b,bool bConnected,ControlRange bRange,
                        ControlOpRuntime& state,float riseCoefficient,float fallCoefficient) noexcept;
ControlRange controlOpOutputRange(const ControlOperator&,ControlRange a,bool aConnected,ControlRange b,bool bConnected) noexcept;
// N06: the range of one output port (port 0 == controlOpOutputRange).
ControlRange controlOpOutputRangeAt(const ControlOperator&,std::size_t port,ControlRange a,bool aConnected,ControlRange b,bool bConnected) noexcept;
float controlSmoothingCoefficient(float seconds,double sampleRate) noexcept;

// New routes start ON / UNIPOLAR / no source / no destination / 0%.
struct ModRoute {
    std::uint32_t id=0;
    bool enabled=true;
    ModSource source=ModSource::None;
    ModAddress destination{ModDestination::None,0,0};
    float amount=0;
    // False is the modern default. Signed generators are mapped from [-1,+1]
    // into [0,1] before depth is applied. True restores centre-crossing motion.
    bool bipolar=false;
};
struct ModulationState {
    static constexpr std::size_t capacity=32;
    static constexpr std::size_t maxControlOperators=32;
    LfoSettings lfo1{},lfo2{},lfo3{},lfo4{};
    std::array<float,3> env1Curves{};
    dsp::EnvelopeSettings env2{},env3{};
    RandomSettings random{};
    FunctionSettings function{};
    ChaosSettings chaos{};
    DriftSettings drift{};
    SequencerSettings sequencer{};
    PerformanceSourceCurve velocityCurve{},noteCurve{};
    std::uint32_t performanceSourceActiveMask=0u; // bit0 Velocity, bit1 Note
    // Values by macro id - 1 (stable identity; holes when removed).
    std::array<float,maxMacros> macros{};
    std::uint16_t macroMask=defaultMacroMask; // bit id-1: macro exists
    // mct-origami-nested-modulation-manual-qa: custom macro names by stable
    // id (NUL-terminated; empty = the default "MACRO n"). Printable ASCII.
    static constexpr std::size_t macroNameCapacity=24;
    std::array<std::array<char,macroNameCapacity>,maxMacros> macroNames{};
    std::array<ModRoute,capacity> routes{};
    std::uint32_t nextRouteId=1;
    // N04 CONTROL operators (holes allowed: a slot keeps its index while used).
    std::array<ControlOperator,maxControlOperators> operators{};
    std::uint32_t nextOperatorId=1;

    // V32 runtime collection state. Existing DSP storage remains bounded at
    // 3 ENV / 4 LFO / 1 Filter while collection semantics come online.
    std::uint32_t envActiveMask=0x7u;
    std::uint32_t lfoActiveMask=0xFu;
    // bit0 Function, bit1 Random, bit2 Chaos, bit3 Drift, bit4 Sequencer.
    // ENV1 is the only source that cannot be removed.
    std::uint32_t generatorActiveMask=0x1Fu;
    bool filterEnabled=true;
};

// Block-rate FX destination output. FX run after the voice sum, so they are
// global destinations: global sources use their latest value and per-voice
// sources (ENV, velocity, keytrack...) follow the most recently played voice.
// Offsets are normalized fractions of the parameter span, exactly like every
// other Origami route; the FX renderer adds them to the canonical value.
inline constexpr std::size_t maxFxModulationSlots=ModulationState::capacity;
struct FxModulationOutput {
    std::uint64_t generation=0; // changes whenever the slot -> address map changes
    std::size_t count=0;
    std::array<std::uint32_t,maxFxModulationSlots> bus{};
    std::array<std::uint32_t,maxFxModulationSlots> node{};
    std::array<std::uint16_t,maxFxModulationSlots> parameter{};
    std::array<float,maxFxModulationSlots> offset{};
};

// ---- Route identity (mct-origami-nodes-n01) --------------------------------
// A route is complete when both ends are selected. Complete routes are unique
// per (source, destination address): validModulation() rejects duplicates.
inline bool routeComplete(const ModRoute& r) noexcept {
    return r.source!=ModSource::None && r.destination.parameter!=ModDestination::None;
}
// True when `candidate` (complete) would repeat the pair of another live route.
bool routeDuplicates(const ModulationState&,const ModRoute& candidate) noexcept;
// mct-origami-nested-modulation-manual-qa: the modulation dependency graph
// (LFOs, macros, NODES operators and routes; an edge for every source a route
// or operator reads and every nested target a route writes) has a cycle.
// validModulation() rejects such a state: no feedback, no undefined order.
bool modulationGraphHasCycle(const ModulationState&) noexcept;
// Whether adding `candidate` (complete) to the state would close a cycle.
bool routeClosesCycle(const ModulationState&,const ModRoute& candidate) noexcept;
// Removes route `routeId` and, transitively, every route that modulates its
// depth (a depth route never outlives its target). Returns the number removed.
std::size_t removeRouteCascade(ModulationState&,std::uint32_t routeId) noexcept;
// Removes every route whose source or nested destination is a macro that no
// longer exists (macro deletion), then cascades depth routes.
std::size_t pruneRoutesOfRemovedMacros(ModulationState&) noexcept;
// Every nested reference that no longer resolves (a depth route whose target
// route is gone, a macro that was removed): pruned, cascading. Any view's
// deletion stays valid through this one canonical repair.
std::size_t pruneDanglingNestedRoutes(ModulationState&) noexcept;
// Deterministic repair of legacy/corrupt duplicate pairs (load path only):
// duplicates merge into the earliest route of the pair. Its amount becomes the
// clamped sum of the enabled duplicates (the compiler always summed them), it
// stays enabled if any was, and its polarity is that of the last enabled one
// (the compiler's last-writer rule). Later duplicates are removed; ids are kept.
// Returns the number of routes removed.
std::size_t mergeDuplicateRoutes(ModulationState&) noexcept;

// ---- Operator graph helpers (N04) --------------------------------------------
const ControlOperator* findControlOperator(const ModulationState&,std::uint32_t id) noexcept;
std::size_t controlOperatorSlot(const ModulationState&,std::uint32_t id) noexcept; // maxControlOperators if absent
// True when `id` (transitively) feeds operator `target`; used for cycle checks.
bool controlOperatorReaches(const ModulationState&,std::uint32_t from,std::uint32_t target) noexcept;
// Canonical sources at the roots of a route's processing chain (a direct
// route's root is its own source). Bounded: at most 2^depth, capped.
std::size_t routeRootSources(const ModulationState&,const ModRoute&,std::array<ModSource,16>& out) noexcept;
// Raw range of a canonical source (signed generators are bipolar) or of an
// operator output (propagated through the operator chain).
ControlRange sourceRange(ModSource,const ModulationState&) noexcept;
// Destinations consumed once globally (not per voice).
bool destinationIsGlobal(ModDestination) noexcept;
// Index of a source (or operator output) in ModulationSourceSlots.
std::size_t modulationSourceSlot(ModSource,const ModulationState&) noexcept;
// True when a source / operator output is evaluated per voice.
bool sourceIsVoice(ModSource,const ModulationState&) noexcept;

// ---- Route monitor (mct-origami-nodes-n01) --------------------------------
// Raw values of the modulation evaluator's source slots, as published by the
// engine's visualization snapshot: [0, globalSourceCount) global sources, then
// the newest voice's per-voice sources, then (N04) every operator output by
// storage slot (global value, or the newest voice's for per-voice operators).
inline constexpr std::size_t operatorOutputSlotCount=ModulationState::maxControlOperators*maxControlOutputs;
// Global (25: 13 original + macros 5..16) + voice (13) source slots, then operator outputs.
inline constexpr std::size_t modulationSourceSlotCount=25+13+operatorOutputSlotCount;
inline constexpr std::size_t operatorOutputIndex(std::size_t slot,std::size_t port) noexcept { return slot*maxControlOutputs+port; }
using ModulationSourceSlots=std::array<float,modulationSourceSlotCount>;
// Normalized control contribution of ONE route: source -> polarity -> amount,
// before destination mapping/clamping. Uses the evaluator's own source-slot
// mapping and polarity transform. 0 for a disabled or incomplete route.
float routeContribution(const ModRoute&,const ModulationState&,const ModulationSourceSlots&) noexcept;

const LfoSettings& lfoSettings(const ModulationState&,std::size_t index) noexcept;
LfoSettings& lfoSettings(ModulationState&,std::size_t index) noexcept;

bool isGlobalDestination(ModDestination) noexcept;
bool validModulation(const ModulationState&,const std::array<OscillatorModuleState,16>&) noexcept;
bool knownModSource(ModSource) noexcept; // a canonical (non-operator) source
// A macro source whose macro exists (Init: MACRO 1..4).
inline bool macroActive(const ModulationState& m,std::size_t id) noexcept { return id>=1 && id<=maxMacros && ((m.macroMask>>(id-1))&1u)!=0; }
// The existing macros' sources, in stable-id order (every view lists these).
inline std::vector<ModSource> activeMacroSources(const ModulationState& m) {
    std::vector<ModSource> out;
    for(std::size_t id=1;id<=maxMacros;++id) if(macroActive(m,id)) out.push_back(macroSource(id));
    return out;
}
float modulationToNormalized(ModDestination,float) noexcept;
float modulationFromNormalized(ModDestination,float) noexcept;

// The canonical LFO runtime: one per execution context (the four global
// FREE LFOs in the engine, four per voice for RETRIGGER / ENVELOPE). All of
// its state is fixed-size; next() never allocates, locks or branches on UI.
class Lfo {
public:
    // Restart the lifecycle (note on / retrigger / engine reset). The entropy
    // stream is kept: callers set it per lifecycle with setStream().
    void reset() noexcept { phase_=0; cycles_=0; samples_=0; smoothed_=smoothedRight_=0; smoothReady_=smoothReadyRight_=false; read_=0; }
    // Deterministic ENTROPY stream (global: per LFO index; voice: per voice
    // lifecycle, the same seed family NODES uses for per-voice randomness).
    // FRACTURE structure: per LFO index, identical for every voice.
    void setStreams(std::uint32_t entropy,std::uint32_t structure) noexcept;
    std::uint32_t stream() const noexcept { return stream_; }
    float next(const LfoSettings&,double sampleRate) noexcept;
    // mct-origami-nested-modulation-manual-qa: with an effective rate (LFO
    // RATE modulated). next(s, sr) == next(s, sr, s.rateHz), bit for bit.
    float next(const LfoSettings&,double sampleRate,float rateHz) noexcept;
    float nextStereo(const LfoSettings&,double sampleRate,float rateHz,float& right) noexcept;
    // LEFT (returned, bit-identical to next()) and RIGHT (out). RIGHT shares
    // the lifecycle (DELAY / ATTACK), the ENTROPY trajectory and the FRACTURE
    // structure; it only reads at +stereo * 0.5 cycle. stereo == 0: right = left.
    float nextStereo(const LfoSettings&,double sampleRate,float& right) noexcept;
    static float shape(LfoShape,double phase) noexcept;
    static float mseg(const LfoSettings&,double phase) noexcept;
    double phase() const noexcept { return phase_; }
    // Where on the base curve the LFO is reading (after PHASE, ENTROPY, SKEW,
    // PING-PONG, FRACTURE): what the editor's tracer follows.
    double readPosition() const noexcept { return read_; }

    // Pure FUNC transforms (shared with the editor's processed overlay).
    static double skewPhase(double c,float skew) noexcept;
    static double pingPongPhase(double c) noexcept { return 1.0-std::abs(1.0-2.0*c); }
    static double fracturePhase(double r,float amount,std::uint32_t seed) noexcept;
    static double entropyOffset(double cycles,float amount,std::uint32_t seed) noexcept;
    static float entropyDepth(double cycles,float amount,std::uint32_t seed) noexcept;
    static int quantizeLevels(float amount) noexcept;
    static float quantizeValue(float y,float amount) noexcept;
    static float attackGain(double secondsSinceOnset,float attackSeconds) noexcept;
    static std::uint32_t fractureSeed(std::size_t lfoIndex) noexcept;
    static std::uint32_t globalStream(std::size_t lfoIndex) noexcept;
    static std::uint32_t voiceStream(std::uint32_t voiceSeed,std::size_t lfoIndex) noexcept;
private:
    // WithRight=false is the pre-stereo code (no right-channel work at all).
    template<bool WithRight> float legacyNext(const LfoSettings&,double sampleRate,float rateHz,float* right) noexcept;
    template<bool WithRight> float processedNext(const LfoSettings&,double sampleRate,float rateHz,float* right) noexcept;
    double phase_=0;          // accumulator, [0,1) (ENVELOPE clamps at 1)
    double cycles_=0;         // unwrapped accumulator: the ENTROPY clock
    std::uint64_t samples_=0; // samples since the lifecycle start (DELAY / ATTACK)
    double read_=0;
    float smoothed_=0,smoothedRight_=0;
    float smoothAlpha_=1,smoothKey_=-1,smoothRate_=-1,smoothSampleRate_=-1;
    std::uint32_t stream_=0,structure_=0;
    // Hot-path caches (pure functions of the inputs; never change output).
    struct NoiseKnots { std::int64_t index=INT64_MIN; float a=0,b=0; };
    std::array<NoiseKnots,3> knots_{};       // ENTROPY layers: timing, drift, depth
    float anchorFast_=0,anchorSlow_=0;       // layer values at cycle 0
    float quantizeKey_=-1; int quantizeLevels_=0;
    const struct FractureTable* fractureTable_=nullptr; // shared, built at static init
    float noise(std::size_t layer,double x,std::uint32_t seed) noexcept;
    bool smoothReady_=false,smoothReadyRight_=false;
};
static_assert(sizeof(Lfo)<=160,"Lfo runtime grew: 4 per voice x every voice");

class RandomGenerator {
public:
    void reset() noexcept {
        phase_=0;delayElapsed_=0;state_=0x6d2b79f5u;
        current_=next_=value_=0;initialized_=false;
    }
    float next(const RandomSettings&,double sampleRate) noexcept;
    double phase() const noexcept { return phase_; }
private:
    float randomValue() noexcept;
    double phase_=0;
    double delayElapsed_=0;
    std::uint32_t state_=0x6d2b79f5u;
    float current_=0,next_=0,value_=0;
    bool initialized_=false;
};

class FunctionGenerator {
public:
    void reset() noexcept {phase_=0;}
    float next(const FunctionSettings&,double sampleRate) noexcept;
    static float shape(float curve,double phase) noexcept;
    double phase() const noexcept { return phase_; }
private: double phase_=0;
};

class ChaosGenerator {
public:
    void reset() noexcept {x_=0.11f;y_=0.0f;z_=0.0f;value_=0.0f;method_=ChaosMethod::Lorenz;}
    float next(const ChaosSettings&,double sampleRate) noexcept;
    float xNormalized() const noexcept;
    float yNormalized() const noexcept;
    float zNormalized() const noexcept;
private:
    void resetForMethod(ChaosMethod) noexcept;
    void integrate(const ChaosSettings&,float dt) noexcept;
    float x_=0.11f,y_=0.0f,z_=0.0f,value_=0.0f;
    ChaosMethod method_=ChaosMethod::Lorenz;
};

class DriftGenerator {
public:
    void reset() noexcept {phase_=0;state_=0x9e3779b9u;target_=0;value_=0;}
    float next(const DriftSettings&,double sampleRate) noexcept;
    double phase() const noexcept { return phase_; }
private:
    double phase_=0;
    std::uint32_t state_=0x9e3779b9u;
    float target_=0,value_=0;
};

// The ONE Origami sequencer runtime. It owns the clock phase, the step index
// and the held output; SequencerSettings (instrument state) owns the steps.
class SequencerGenerator {
public:
    void reset() noexcept {phase_=0;step_=0;forward_=true;finished_=false;held_=0.0f;substep_=0;rng_=0x8f7011eeu;stepScale_=1.0;begun_=false;}
    // INTERNAL clock (the legacy path): advances its own phase at rateHz.
    float next(const SequencerSettings&,double sampleRate) noexcept;
    // N06 EXTERNAL clock: the phase never advances; NODES events drive steps.
    float hold(const SequencerSettings&) noexcept;    // current step's value (begins it if needed)
    void advance(const SequencerSettings&) noexcept;  // one step, honouring direction / loop
    void restart(const SequencerSettings&) noexcept;  // back to the start step (begins at the next hold/next)
    float held() const noexcept { return held_; }
    std::uint32_t stepEvents() const noexcept { return stepEvents_; } // monotonic: one per step (or ratchet repeat) begun
    std::size_t currentStep() const noexcept { return step_; } // UI monitor inspection only
    double phase() const noexcept { return phase_; }
private:
    void beginStep(const SequencerSettings&) noexcept;
    void stepForward(const SequencerSettings&,std::size_t count) noexcept;
    float random01() noexcept;
    std::size_t normalize(const SequencerSettings&) noexcept;
    bool begun_=false;
    std::uint32_t stepEvents_=0;
    double phase_=0;
    std::size_t step_=0;
    bool forward_=true;
    bool finished_=false;
    float held_=0.0f;
    std::uint32_t substep_=0;
    std::uint32_t rng_=0x8f7011eeu;
    double stepScale_=1.0;
};

template<class T> class LatestStateMailbox {
    // mct-origami-dsp-performance-stereo-chain: consume() copies on the audio
    // thread, so a payload must never own heap storage (a vector / string copy
    // allocates there; the replaced value would be freed there).
    static_assert(std::is_trivially_copyable_v<T>,"LatestStateMailbox payloads cross to the audio thread by copy: no heap-owning types");
public:
    void publish(const T& state) noexcept {
        slots_[back_]=state;
        back_=middle_.exchange(back_|dirty,std::memory_order_acq_rel)&mask;
    }
    bool consume(T& state) noexcept {
        if(!(middle_.load(std::memory_order_acquire)&dirty)) return false;
        front_=middle_.exchange(front_,std::memory_order_acq_rel)&mask;
        state=slots_[front_];return true;
    }
private:
    static constexpr unsigned dirty=4,mask=3;
    std::array<T,3> slots_{};
    unsigned front_=0,back_=2;
    std::atomic<unsigned> middle_{1};
};

// ---- mct-origami-stereo-modulation ----------------------------------------
// Every existing modulation value is the LEFT / reference channel and keeps
// its exact scalar path. Stereo is a SPARSE right channel layered on top:
// only stereo LFOs produce a right value, only stereo-capable destinations
// keep one, and nothing is computed while no stereo LFO reaches one of them.
//
// Destination capability (audited against the DSP that owns each value):
//  A Stereo            LEVEL (per-oscillator gain before pan), CUTOFF and
//                      RESONANCE (per-oscillator filter, independent L/R state)
//                      mct-origami-dsp-performance-stereo-chain: the oscillator
//                      READ side too: WT POSITION and every OSC CHAIN process /
//                      route amount. The oscillator's only state is its phase,
//                      so RIGHT is a second read at the same phase (frame,
//                      phase warp, spectral table, PM / PSK offset, post-route
//                      shaping). mct-origami-nested-modulation-manual-qa: FM
//                      route amounts too (a different RIGHT frequency runs
//                      RIGHT on its own phase), and a module whose RIGHT
//                      differs feeds every cross-oscillator route channel by
//                      channel (RIGHT taps): PD, FM, PSK, RM, AM, XF, WF,
//                      XOR and RECT consume the source's RIGHT on RIGHT.
//  B RequiresStereoDsp OCTAVE / SEMITONE / FINE (one oscillator phase per
//                      module), FX parameters (one value per effect node),
//                      MASTER GAIN (per voice, or after FX at block rate
//                      depending on FX ORDER)
//  C Scalar            PAN, DETUNE, TUNING, TRANSPOSE, PORTA, SWING
//  D Ambiguous         ENV / LFO SCALING (they scale the sources themselves)
// B, C and D read the LEFT / reference value: turning STEREO never changes them.
enum class StereoCapability : std::uint8_t { Stereo=0, RequiresStereoDsp=1, Scalar=2, Ambiguous=3 };
// Stereo destinations consumed by the oscillator READ (not the filter / gain).
constexpr bool stereoOscillatorRead(ModDestination d) noexcept {
    switch(d) {
        case ModDestination::WtPosition:
        case ModDestination::Process1Amount: case ModDestination::Process2Amount: case ModDestination::ProcessAmount:
        case ModDestination::Route1Amount: case ModDestination::Route2Amount: case ModDestination::RouteAmount: return true;
        default: return false;
    }
}
constexpr StereoCapability stereoCapability(ModDestination d) noexcept {
    switch(d) {
        case ModDestination::Level: case ModDestination::Cutoff: case ModDestination::Resonance:
        case ModDestination::WtPosition:
        case ModDestination::Process1Amount: case ModDestination::Process2Amount: case ModDestination::ProcessAmount:
        case ModDestination::Route1Amount: case ModDestination::Route2Amount: case ModDestination::RouteAmount:
            return StereoCapability::Stereo;
        case ModDestination::Octave: case ModDestination::Semitone: case ModDestination::Fine:
        case ModDestination::FxParameter: case ModDestination::MasterGain: return StereoCapability::RequiresStereoDsp;
        case ModDestination::EnvelopeScaling: case ModDestination::LfoScaling: return StereoCapability::Ambiguous;
        // mct-origami-nested-modulation-manual-qa: an LFO's rate is its phase
        // state, a macro is one value, a route depth one weight: LEFT only.
        case ModDestination::LfoRate: case ModDestination::MacroValue: case ModDestination::RouteDepth:
            return StereoCapability::RequiresStereoDsp;
        default: return StereoCapability::Scalar;
    }
}
// RIGHT values of the four LFOs this sample (bit i of mask: LFO i is stereo,
// so its right value may differ; otherwise right == left by definition).
struct StereoSourceValues {
    std::array<float,4> lfo{};
    std::uint8_t mask=0;
};
// The right channel carried by a ModulationFrame. Valid entries are flagged;
// everything else means "same as LEFT".
struct StereoModulationFrame {
    StereoSourceValues globalLfo{};                         // FREE (global) LFO pairs
    std::array<float,ModulationState::capacity> delta{};   // per group: normalized RIGHT - LEFT
    std::array<float,ModulationState::maxControlOperators> operatorRight{}; // port 0, by operator slot
    std::uint32_t operatorMask=0;                           // bit slot: operatorRight valid
    std::array<float,16> level{};                           // per module
    std::uint16_t levelMask=0;                              // bit module: level[m] is RIGHT's level
    bool cutoffSplit=false,resonanceSplit=false;
    float cutoff=8000.0f,resonance=.1f;
    dsp::LowPassCoefficients filter{};                      // RIGHT's filter (valid when split)
    // Every stereo group's RIGHT value by group index (bit i of rightMask: valid).
    // The oscillator-read destinations are consumed from here.
    std::array<float,ModulationState::capacity> right{};
    std::uint32_t rightMask=0;
    bool active=false;                                      // any right value / delta this sample
    bool filterSplit() const noexcept { return cutoffSplit || resonanceSplit; }
};

struct ModulationFrame {
    std::array<OscillatorModuleState,16> modules{};
    ControlEventContext events{}; // N05: timing (global) + note state (per voice)
    // N04: operator outputs by storage slot (global operators evaluated in the
    // global frame; per-voice operators overwrite theirs inside each voice).
    // N06: one value per (operator slot, output port): index slot*4 + port.
    std::array<float,ModulationState::maxControlOperators*maxControlOutputs> operatorOutputs{};
    std::array<float,25> globalSources{}; // copied for per-voice operators (only when operators exist)
    float cutoff=8000,resonance=.1f,master=.2f,mainTuning=0.0f,transpose=0.0f;
    float portaTime=0.0f,envelopeScaling=1.0f,lfoScaling=1.0f,swing=0.0f;
    dsp::LowPassCoefficients filter{};
    bool filterEnabled=true;
    // False when FX ORDER = PRE MASTER: the renderer applies master gain after the FX graph.
    bool applyMaster=true;
    std::array<float,ModulationState::capacity> normalized{};
    // mct-origami-nested-modulation-manual-qa: effective depth of each route
    // (by route index) whose depth is modulated, and its normalized global
    // part (a voice adds its own terms to that).
    std::array<float,ModulationState::capacity> routeDepth{},routeDepthNormalized{};
    StereoModulationFrame stereo{};
    // N07: copy everything a voice reads or writes, but only the ACTIVE
    // oscillator modules: the 16 module slots are 8 KB of this 8.9 KB frame,
    // and a voice renders only the plan's active modules. Inactive slots keep
    // whatever they held (never rendered). Keep this list in sync with the
    // fields above (the static_assert below trips when the frame changes).
    // Operator outputs are NOT copied: per-voice operators read GLOBAL operator
    // outputs from the global frame and write their own here.
    void copyForVoice(const ModulationFrame& g,const std::array<std::uint8_t,16>& active,std::size_t activeCount,std::uint16_t moduleMask=0xffffu,bool withStereo=false,bool withDepths=false) noexcept {
        if(withStereo) { // only when the plan carries stereo terms
            if(g.stereo.active) stereo=g.stereo;
            else { stereo.active=false; stereo.globalLfo.mask=0; stereo.operatorMask=0; stereo.levelMask=0; stereo.rightMask=0; stereo.cutoffSplit=stereo.resonanceSplit=false; }
        }
        for(std::size_t i=0;i<activeCount && i<active.size();++i)
            if((moduleMask>>active[i])&1u) modules[active[i]]=g.modules[active[i]];
        events=g.events; globalSources=g.globalSources;
        cutoff=g.cutoff; resonance=g.resonance; master=g.master; mainTuning=g.mainTuning; transpose=g.transpose;
        portaTime=g.portaTime; envelopeScaling=g.envelopeScaling; lfoScaling=g.lfoScaling; swing=g.swing;
        filter=g.filter; filterEnabled=g.filterEnabled; applyMaster=g.applyMaster; normalized=g.normalized;
        if(withDepths) copyDepths(g); // only with nested modulation (out of line: keeps the voice loop small)
    }
    __attribute__((noinline)) void copyDepths(const ModulationFrame& g) noexcept { routeDepth=g.routeDepth; routeDepthNormalized=g.routeDepthNormalized; }
};

// Fields copied by ModulationFrame::copyForVoice: the size is pinned so any
// field change trips here and forces copyForVoice to be updated with it.
static_assert(sizeof(ModulationFrame)==8928+2*sizeof(float)*ModulationState::capacity+sizeof(StereoModulationFrame),"ModulationFrame changed: update copyForVoice");

class CompiledModulation {
public:
    // Global slots: 0..12 as always (macros 1..4 at 4..7), 13..24 macros 5..16.
    // Voice slots follow (globalSourceCount + 0..12), then operator outputs.
    static constexpr std::size_t globalSourceCount=13+(maxMacros-4);
    static constexpr std::size_t macroSlot(std::size_t id) noexcept { return id<=4 ? 3+id : 13+(id-5); } // id 1..16
    static constexpr std::size_t voiceSourceCount=13;
    static constexpr std::size_t sourceSlotCount=globalSourceCount+voiceSourceCount;
    static constexpr std::size_t operatorSlotCount=ModulationState::maxControlOperators;
    static constexpr std::size_t totalSlotCount=sourceSlotCount+operatorSlotCount;
    using OperatorState=std::array<ControlOpRuntime,operatorSlotCount>;
    void prepare(double sampleRate) noexcept;
    // N04 operators. Global operators run once per sample before globalFrame;
    // per-voice operators run per voice before voiceFrame, with that voice's
    // own state. Both are no-ops (never called) when no operator is compiled.
    bool hasOperators() const noexcept { return opCount_!=0; }
    bool hasGlobalOperators() const noexcept { return globalOpCount_!=0; }
    bool hasVoiceOperators() const noexcept { return voiceOpCount_!=0; }
    void evaluateGlobalOperators(ModulationFrame&,const std::array<float,globalSourceCount>&) noexcept;
    // `global` (optional): the global frame. Inputs from GLOBAL operators are
    // read there, so a voice's frame never needs a copy of every operator output.
    void evaluateVoiceOperators(ModulationFrame&,const std::array<float,voiceSourceCount>&,OperatorState&,
                                std::array<std::uint32_t,operatorSlotCount>* eventCounts=nullptr,
                                const ModulationFrame* global=nullptr,
                                const StereoSourceValues* voiceStereo=nullptr) const noexcept;
    // mct-origami-stereo-modulation: whether any stereo-capable destination is
    // reached by an LFO (directly or through component-wise NODES operators).
    // False: no right channel is ever computed, copied or read (mono plan).
    bool hasStereoPlan() const noexcept { return stereoPlan_; }
    // Oscillator-read stereo groups (WT POSITION, OSC CHAIN amounts) by module
    // and in total, plus what each group addresses: prepared at compile time
    // so the voice never searches for them.
    std::uint32_t moduleReadStereoGroups(std::size_t module) const noexcept { return module<16 ? moduleReadGroups_[module] : 0u; }
    std::uint32_t readStereoGroups() const noexcept { return readGroupsAll_; }
    struct ReadTarget { ModDestination parameter=ModDestination::None; std::uint8_t item=0; };
    const ReadTarget& readTarget(std::size_t group) const noexcept { return readTargets_[group]; }
    // N05: ENV 2 / ENV 3 retrigger requests produced this sample (bit 1 / 2).
    std::uint8_t envelopeTriggers(const ModulationFrame&) const noexcept;
    bool hasEnvelopeTriggers() const noexcept { return envelopeTriggerCount_!=0; }
    bool needsEventContext() const noexcept { return eventOps_; }
    // N06: a SEQUENCER node drives the canonical sequencer from the plan (the
    // engine then skips its legacy source-pass advance: never double clocked).
    bool hasSequencerNode() const noexcept { return sequencerNode_; }
    const std::array<std::uint32_t,operatorSlotCount>& globalEventCounts() const noexcept { return globalEventCounts_; }
    void resetOperatorState() noexcept { globalOpState_={}; }
    // N07 compile lifecycle. compile() classifies what changed since the plan
    // it last built:
    //  - nothing the plan reads (macros, LFO rates/shapes, sequence steps,
    //    oscillator parameters...)            -> skipped (plan untouched)
    //  - only operator PARAMETERS, with no output range change
    //                                          -> parameters updated in place
    //  - routes, operators, connections, LFO free/voice modes, module topology,
    //    sample rate                            -> full compile
    // Monotonic counters (audio thread writes; diagnostics read via the engine).
    struct CompileCounters { std::uint32_t compiles=0,parameterUpdates=0,skipped=0; };
    const CompileCounters& compileCounters() const noexcept { return counters_; }
    void compile(const ModulationState&,const std::array<OscillatorModuleState,16>&,bool immediate=false) noexcept;
    void advance(float smoothing) noexcept;
    void globalFrame(ModulationFrame&,const std::array<float,globalSourceCount>&,double sampleRate) const noexcept;
    void voiceFrame(ModulationFrame&,const std::array<float,voiceSourceCount>&,double sampleRate,
                    const StereoSourceValues* voiceStereo=nullptr,const ModulationFrame* global=nullptr) const noexcept;
    bool hasVoiceRoutes() const noexcept {return voiceCount_!=0 || voiceDepthCount_!=0;}
    bool hasFxRoutes() const noexcept {return fxCount_!=0;}
    bool hasFxVoiceRoutes() const noexcept {return fxVoice_;}
    std::uint64_t generation() const noexcept {return generation_;}
    void fxFrame(FxModulationOutput&,const std::array<float,globalSourceCount>&,
                 const std::array<float,voiceSourceCount>* newestVoice,
                 const std::array<float,operatorOutputSlotCount>* globalOperators=nullptr) const noexcept;
    bool hasVoiceProcessRoutes(std::size_t module) const noexcept {return voiceProcessModules_[module];}
    // N07: oscillator module slots written per voice (voice routes into them).
    // A voice copies and reads its own copy only of these; every other module
    // is read from the global frame.
    std::uint16_t voiceModuleMask() const noexcept {return voiceModuleMask_;}
    bool usesGlobalSource(std::size_t index) const noexcept {
        return index<globalSourceCount && globalSourceUsed_[index];
    }
    // N07: whether any route or operator reads voice source `index`.
    bool usesVoiceSource(std::size_t index) const noexcept {
        return index<voiceSourceCount && voiceSourceUsed_[index];
    }
    // N07: bumped by the engine whenever a new ModulationState is consumed,
    // compiled or not (per-voice caches of state-derived values key on it).
    std::uint64_t stateRevision() const noexcept { return stateRevision_; }
    void markStateRevision() noexcept { ++stateRevision_; }
    std::size_t groupCount() const noexcept {return count_;}

    // ---- mct-origami-nested-modulation-manual-qa: nested modulation ---------
    // LFO RATE, MACRO and ROUTE DEPTH destinations are evaluated in dependency
    // order, prepared at compile time: a GLOBAL program (FREE LFOs, macros with
    // incoming modulation, global NODES operators, route depths) and a VOICE
    // program (RETRIGGER / ENVELOPE LFOs, per-voice operators, per-voice route
    // depths). Without nested routes neither exists and the engine and voices
    // take their unchanged paths.
    // Voice-scoped sources (ENV, velocity, a RETRIGGER LFO ...) reaching a
    // GLOBAL nested target (a macro, a FREE LFO's rate) follow the most
    // recently played voice, one sample late (the FX-destination policy).
    struct ProgramStep {
        enum class Kind : std::uint8_t { Lfo=0, Macro=1, Operator=2, Depth=3 };
        Kind kind=Kind::Lfo;
        std::uint8_t index=0; // LFO 0..3 / macro id 1..16 / index into the compiled operators / route index
    };
    bool hasNestedPlan() const noexcept { return nestedPlan_; }
    bool hasVoiceNestedPlan() const noexcept { return voiceNestedPlan_; }
    bool needsNewestVoiceSources() const noexcept { return needsNewestVoice_; }
    std::size_t globalProgramSize() const noexcept { return globalProgramCount_; }
    const ProgramStep& globalProgramStep(std::size_t i) const noexcept { return globalProgram_[i]; }
    std::size_t voiceProgramSize() const noexcept { return voiceProgramCount_; }
    const ProgramStep& voiceProgramStep(std::size_t i) const noexcept { return voiceProgram_[i]; }
    // Effective rate of a FREE (global) LFO this sample (baseHz when no route
    // reaches its rate).
    float globalLfoRate(std::size_t lfo,float baseHz,const std::array<float,globalSourceCount>& sources,
                        const ModulationFrame& f,const std::array<float,voiceSourceCount>* newestVoice) const noexcept;
    // Effective value of macro `id` (its base when nothing modulates it).
    float macroValue(std::size_t id,float base,const std::array<float,globalSourceCount>& sources,
                     const ModulationFrame& f,const std::array<float,voiceSourceCount>* newestVoice) const noexcept;
    // Global part of route `route`'s depth into f.routeDepth / routeDepthNormalized.
    void globalRouteDepth(std::size_t route,ModulationFrame& f,const std::array<float,globalSourceCount>& sources,
                          const std::array<float,voiceSourceCount>* newestVoice) const noexcept;
    // Effective rate of a RETRIGGER / ENVELOPE (per-voice) LFO for one voice.
    float voiceLfoRate(std::size_t lfo,float baseHz,const ModulationFrame& global,
                       const std::array<float,voiceSourceCount>& voice,const ModulationFrame& local) const noexcept;
    // This voice's depth of route `route` (global part + this voice's terms).
    void voiceRouteDepth(std::size_t route,ModulationFrame& local,const std::array<float,voiceSourceCount>& voice) const noexcept;
    // One compiled operator (index into the compiled order) - the programs
    // interleave operators with LFOs, macros and depths.
    void evaluateGlobalOperator(std::size_t op,ModulationFrame&,const std::array<float,globalSourceCount>&) noexcept;
    void evaluateVoiceOperator(std::size_t op,ModulationFrame&,const std::array<float,voiceSourceCount>&,OperatorState&,
                               std::array<std::uint32_t,operatorSlotCount>* eventCounts=nullptr,
                               const ModulationFrame* global=nullptr,const StereoSourceValues* voiceStereo=nullptr) const noexcept;
    bool lfoRateModulated(std::size_t lfo) const noexcept { return lfo<4 && lfoRateGroup_[lfo]>=0; }
    bool macroModulated(std::size_t id) const noexcept { return id>=1 && id<=maxMacros && macroGroup_[id-1]>=0; }
private:
    struct Group {
        ModAddress address{};std::size_t slot=0;
        // Resolved once during compile(); never searched by ID on the audio thread.
        std::size_t itemSlot=0;
        // Destination domain captured at compile time. OSC process amounts are
        // process-dependent (unipolar 0..1 or bipolar -1..1), so they cannot
        // safely use the generic ModDestination range table.
        float minimum=0.0f,maximum=1.0f;
        // N07: CUTOFF's log-domain span, prepared once (was two logs per sample).
        float logSpan=1.0f;     // std::log(maximum/minimum)
        double log2Span=1.0;    // std::log2(maximum/minimum)
        std::array<float,totalSlotCount> weight{},target{};
        std::array<bool,totalSlotCount> bipolar{};
        std::array<std::uint8_t,globalSourceCount> globalSlots{};
        std::array<std::uint8_t,voiceSourceCount> voiceSlots{};
        std::uint8_t globalSlotCount=0,voiceSlotCount=0;
        // N04: operator storage slots feeding this group.
        std::array<std::uint8_t,operatorSlotCount> globalOpSlots{},voiceOpSlots{};
        std::uint8_t globalOpSlotCount=0,voiceOpSlotCount=0;
        // mct-origami-nested-modulation-manual-qa: a nested target (LFO RATE,
        // MACRO, ROUTE DEPTH) is evaluated by the programs, never by
        // globalFrame / voiceFrame. depthSlot / depthRoute: slots whose route
        // has a modulated depth (its weight is replaced by that depth).
        bool nested=false;
        bool voiceDepth=false;  // a depth here has per-voice terms
        std::uint8_t depthCount=0;
        std::array<std::uint8_t,8> depthSlot{},depthRoute{};
        // Stereo terms (stereo-capable destinations only): which of this
        // group's sources may carry a different RIGHT value.
        bool stereo=false;
        std::uint8_t stereoGlobalLfos=0,stereoVoiceLfos=0; // bit i: LFO i
        std::uint32_t stereoGlobalOps=0,stereoVoiceOps=0;  // bit: compact routed operator slot
    };
    // One compiled operator, in topological order; inputs resolved to slots.
    struct CompiledOp {
        ControlOperator op{};
        std::uint8_t slot=0;                 // storage slot = output slot
        std::array<std::int16_t,3> input{{-1,-1,-1}}; // <sourceSlotCount: source slot, else sourceSlotCount+operator output index, -1: none
        std::array<ControlRange,3> range{{ControlRange::Unipolar,ControlRange::Unipolar,ControlRange::Unipolar}};
        bool voice=false;
        bool event=false;                    // an output is an EVENT (counted for monitoring)
        std::uint8_t outputCount=1;
        std::uint8_t eventPorts=0;           // N06: bit p set when output port p is an EVENT
        // N07: what the operator means, resolved at compile time. Stateless
        // single-output CONTROL operators (and SMOOTH) run as a prepared
        // kernel: connection, range and parameter decisions are already made,
        // so the sample loop executes instead of re-deriving. Everything else
        // takes the general evaluator (Kernel::General).
        enum class Kernel : std::uint8_t { General,Constant,Pass,Linear,Sum,Difference,Product,Minimum,Maximum,Absolute,ClampRange,SmoothFollow };
        Kernel kernel=Kernel::General;
        std::uint8_t kernelInput=0;          // Pass / Linear: which input
        float k0=0.0f,k1=0.0f;               // Constant: k0. Linear: a*k0+k1. ClampRange: [k0, k1]
        std::uint8_t globalOperatorInputs=0; // bit k: input k reads a GLOBAL operator's output
        ControlOpPrepared prepared{};
        // Stereo: component-wise continuous operators (the stateless shaping /
        // math family and SMOOTH) whose inputs may be stereo. EVENT / GATE and
        // stateful generators stay scalar (they never set a right value).
        bool stereo=false;
    };
    void runOperator(const CompiledOp&,const std::array<float,voiceSourceCount>*,ModulationFrame&,ControlOpRuntime&,
                     const ModulationFrame& globalOperators) const noexcept;
    static bool eventFired(const CompiledOp& c,const std::array<float,operatorOutputSlotCount>& outputs,std::size_t base) noexcept {
        if(c.eventPorts==0) return false;
        for(std::size_t p=0;p<c.outputCount;++p) if(((c.eventPorts>>p)&1u)!=0 && outputs[base+p]!=0.0f) return true;
        return false;
    }
    float operatorRouteValue(std::size_t operatorSlot,float raw,bool bipolar) const noexcept;
    static float operatorInput(std::int16_t input,const std::array<float,voiceSourceCount>*,const ModulationFrame&,const ModulationFrame& operators) noexcept;
    // RIGHT value of an operator input (LEFT when that input carries no right value).
    static float operatorInputRight(std::int16_t input,float left,const StereoSourceValues* voiceStereo,
                                    const ModulationFrame& f,const ModulationFrame& operators) noexcept;
    void runOperatorRight(const CompiledOp&,const std::array<float,voiceSourceCount>*,const StereoSourceValues*,
                          ModulationFrame&,ControlOpRuntime&,const ModulationFrame& globalOperators) const noexcept;
    static void writeRight(ModulationFrame&,const Group&,std::size_t group,float normalized) noexcept;
    float stereoDelta(const Group&,const ModulationFrame&,const std::array<float,globalSourceCount>*,
                      const std::array<float,voiceSourceCount>*,const StereoSourceValues*,bool voice) const noexcept;
    void finishStereo(ModulationFrame&,bool voice) const noexcept;
    bool stereoPlan_=false;
    std::array<std::uint32_t,16> moduleReadGroups_{};
    std::uint32_t readGroupsAll_=0;
    std::array<ReadTarget,ModulationState::capacity> readTargets_{};
    std::array<std::uint8_t,ModulationState::capacity> stereoGroups_{};
    std::size_t stereoGroupCount_=0;
    std::array<CompiledOp,operatorSlotCount> ops_{};
    std::size_t opCount_=0,globalOpCount_=0,voiceOpCount_=0;
    // N07: execution order per domain (indices into ops_), so neither loop
    // tests the domain of every operator every sample.
    std::array<std::uint8_t,operatorSlotCount> globalOrder_{},voiceOrder_{};
    static void resolveKernel(CompiledOp&,const std::array<bool,3>& connected) noexcept;
    std::array<ControlRange,operatorOutputSlotCount> outputRange_{}; // per (slot, port)
    std::array<bool,operatorSlotCount> opVoice_{};
    // Routed operator outputs: the (<= 32) distinct outputs that drive routes
    // get compact group slots [0, routedCount_), mapped to output indices.
    std::array<std::uint8_t,operatorSlotCount> routedOutput_{};
    std::array<ControlRange,operatorSlotCount> routedRange_{};
    std::array<bool,operatorSlotCount> routedVoice_{};
    std::size_t routedCount_=0;
    bool sequencerNode_=false;
    OperatorState globalOpState_{};
    double sampleRate_=48000.0;
    std::array<std::uint32_t,operatorSlotCount> globalEventCounts_{};
    std::array<std::uint8_t,operatorSlotCount> envelopeTriggerSlots_{},envelopeTriggerTargets_{};
    std::size_t envelopeTriggerCount_=0;
    bool eventOps_=false;
    static float read(const ModulationFrame&,const Group&) noexcept;
    static void write(ModulationFrame&,const Group&,float normalized) noexcept;
    // mct-origami-nested-modulation-manual-qa
    float effectiveWeight(const Group&,std::size_t slot,const ModulationFrame&) const noexcept;
    float nestedGlobalTerms(const Group&,const std::array<float,globalSourceCount>&,const ModulationFrame&) const noexcept;
    float nestedNewestVoiceTerms(const Group&,const std::array<float,voiceSourceCount>*,const ModulationFrame&) const noexcept;
    float nestedVoiceTerms(const Group&,const std::array<float,voiceSourceCount>&,const ModulationFrame&) const noexcept;
    // Depth corrections of an audio group: (depth - weight) * source for each
    // depth slot, global sources / voice sources.
    float depthCorrectionGlobal(const Group&,const std::array<float,globalSourceCount>&,const ModulationFrame&) const noexcept;
    float depthCorrectionVoice(const Group&,const std::array<float,voiceSourceCount>&,const ModulationFrame& local,const ModulationFrame& global) const noexcept;
    void buildNestedPlan(const ModulationState&) noexcept;
    bool nestedPlan_=false,voiceNestedPlan_=false,needsNewestVoice_=false;
    template<std::size_t N> static constexpr std::array<std::int8_t,N> noGroups() noexcept { std::array<std::int8_t,N> a{}; for(auto& v:a) v=-1; return a; }
    std::array<std::int8_t,4> lfoRateGroup_=noGroups<4>();
    std::array<std::int8_t,maxMacros> macroGroup_=noGroups<maxMacros>();
    std::array<std::int8_t,ModulationState::capacity> depthGroup_=noGroups<ModulationState::capacity>(),routeGroup_=noGroups<ModulationState::capacity>();
    std::array<std::uint8_t,ModulationState::capacity> routeSlot_{};
    std::array<ProgramStep,4+maxMacros+operatorSlotCount+ModulationState::capacity> globalProgram_{},voiceProgram_{};
    std::size_t globalProgramCount_=0,voiceProgramCount_=0;
    std::array<Group,ModulationState::capacity> groups_{};
    std::array<std::size_t,ModulationState::capacity> voiceGroups_{};
    // mct-origami-nested-modulation-manual-qa: prepared group lists, so the hot
    // loops never test a group's kind: plain global groups (not FX, not
    // nested, no modulated depth) and those with modulated depths; voice
    // groups likewise.
    std::array<std::uint8_t,ModulationState::capacity> globalPlain_{},globalDepth_{},voiceDepthGroups_{};
    std::size_t globalPlainCount_=0,globalDepthCount_=0,voiceDepthCount_=0;
    std::array<bool,globalSourceCount> globalSourceUsed_{};
    std::array<bool,voiceSourceCount> voiceSourceUsed_{};
    std::uint64_t stateRevision_=0;
    std::size_t count_=0,voiceCount_=0;
    std::array<std::size_t,ModulationState::capacity> fxGroups_{};
    std::size_t fxCount_=0;
    bool fxVoice_=false;
    std::uint64_t generation_=0;
    std::array<bool,16> voiceProcessModules_{};
    std::uint16_t voiceModuleMask_=0;
    // What the last plan was built from (compared, never hashed: no collisions).
    struct ModulePlanKey {
        OscillatorModuleId id=0;
        dsp::OscProcessType process1=dsp::OscProcessType::Off,process2=dsp::OscProcessType::Off;
        std::uint8_t processCount=0,routeCount=0;
        std::array<OscProcessSlotId,maxOscProcesses> processIds{};
        std::array<dsp::OscProcessType,maxOscProcesses> processTypes{};
        std::array<OscRouteSlotId,maxOscRoutes> routeIds{};
        bool operator==(const ModulePlanKey&) const noexcept;
    };
    struct PlanKey {
        bool valid=false;
        double sampleRate=0.0;
        std::array<ModRoute,ModulationState::capacity> routes{};
        std::array<ControlOperator,ModulationState::maxControlOperators> operators{};
        std::array<LfoMode,4> lfoModes{};
        // mct-origami-nested-modulation-manual-qa: whether each LFO is a stereo
        // source (STEREO > 0) shapes the stereo plan, so crossing zero is a
        // topology change (a value change above zero is not).
        std::array<bool,4> lfoStereo{};
        bool filterEnabled=true;
        std::array<ModulePlanKey,16> modules{};
    };
    enum class PlanChange : std::uint8_t { None,Parameters,Topology };
    PlanChange classifyChange(const ModulationState&,const std::array<OscillatorModuleState,16>&) const noexcept;
    void storePlanKey(const ModulationState&,const std::array<OscillatorModuleState,16>&) noexcept;
    bool updateParameters(const ModulationState&) noexcept; // false: needs a full compile (nothing changed)
    PlanKey planKey_{};
    CompileCounters counters_{};
    bool voiceFilter_=false;
    bool filterEnabled_=true;
    bool smoothingActive_=false;
    // mct-origami-dsp-performance-stereo-chain: the (group, slot) pairs whose
    // weight differs from its target after compile. advance() glides only
    // these (every other slot is already at its target: a no-op); a list that
    // would overflow falls back to the full scan.
    struct MovingSlot { std::uint8_t group=0,slot=0; };
    static constexpr std::size_t movingCapacity=128;
    std::array<MovingSlot,movingCapacity> moving_{};
    std::size_t movingCount_=0;

    // P06: tan() is prepared into a fixed coefficient basis table off RT.
    dsp::LowPassCoefficientTable filterTable_{};
    mutable double cachedFilterRate_=0.0;
    mutable float cachedFilterCutoff_=-1.0f,cachedFilterResonance_=-1.0f;
    mutable dsp::LowPassCoefficients cachedFilter_{};
    const dsp::LowPassCoefficients& globalFilter(double,float,float) const noexcept;
};
}
