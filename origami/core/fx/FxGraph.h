// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-fx-page-foundation-p01
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

// Canonical, non-realtime FX graph model.
//
// Ownership and threading:
//   EDITABLE FxGraph (message thread, value type, no UI pointers)
//       | FxGraphCompiler (core/fx/FxRenderer.h) after each mutation
//       v
//   PreparedFxPlan (immutable topology + prepared effect instances)
//       | lock-free pointer publication at a host-block boundary
//       v
//   FxRenderer (realtime)
//
// The audio thread never traverses an FxGraph. Nothing in this header is
// JUCE-aware; UI components refer to nodes only by stable FxNodeId.
namespace mct::origami::fx {

// Persistent identities. Never renumber or reuse enum values: they are written
// by the FX graph codec and are referenced by presets and (later) modulation.
using FxNodeId=std::uint32_t;
using FxConnectionId=std::uint32_t;
using FxParameterId=std::uint16_t;
using FxBusId=std::uint32_t; // same identity space as mct::origami::BusId
inline constexpr FxNodeId invalidFxNodeId=0;
inline constexpr FxBusId fxMainBusId=1;

enum class FxNodeKind : std::uint8_t {
    Source=1,  // a named bus (or future external input) entering the FX graph
    Effect=2,  // one processor with parameters
    Split=3,   // one input, N branch outputs (routing only, not an effect)
    Merge=4,   // N branch inputs, one output (routing only, not an effect)
    Send=5,    // reserved: not constructible until send/return DSP exists
    Return=6,  // reserved: not constructible until send/return DSP exists
    Output=7   // MASTER OUT: terminal node, no downstream port
};

// AUDIO sources carry sample streams. CONTROL sources (envelopes, LFOs, MIDI)
// are modulation signals and must never be routed as audio; they will reach
// FX parameters through Origami's single modulation system instead.
enum class FxSignalDomain : std::uint8_t { Audio=1, Control=2 };

// Value 1 was P01's "synth sum"; it is now the named-bus source kind, whose
// concrete bus is FxNode::bus. Other values are concept-level source kinds.
enum class FxSourceType : std::uint8_t {
    Bus=1, ExternalInput=8, EnvelopeBus=5, LfoBus=6, MidiBus=7
};

struct FxSourceDescriptor {
    FxSourceType type;
    const char* key;
    const char* label;
    FxSignalDomain domain;
    bool available; // produces audio in the current engine
};
const std::array<FxSourceDescriptor,5>& fxSourceCatalog() noexcept;
const FxSourceDescriptor* findFxSource(FxSourceType) noexcept;

enum class FxEffectType : std::uint16_t {
    None=0, Drive=1, Delay=2, Reverb=3, Chorus=4, Comb=5, Diffuse=6, Limiter=7
};

// Routing workflows. All of them edit the SAME canonical graph; they are not
// independent routing engines.
enum class FxRoutingMode : std::uint8_t { Serial=1, Parallel=2, Split=3, Send=4, Custom=5 };

enum class FxParameterPage : std::uint8_t { Main=1, Advanced=2 };
enum class FxParameterCurve : std::uint8_t { Linear=1, Exponential=2, Choice=3 };
enum class FxCategory : std::uint8_t { Drive=1, Time=2, Space=3, Modulation=4, Filter=5, Dynamics=6 };
enum class FxVisual : std::uint8_t { Transfer=1, Taps=2, Decay=3, Lfo=4, Comb=5, Diffusion=6, Dynamics=7 };

// Canonical values are normalized [0,1] and keyed by stable parameter ID.
// minimum/maximum/curve/unit define the ONE physical mapping shared by DSP,
// inspector text and (later) host automation. Labels are display-only.
struct FxParameterDescriptor {
    FxParameterId id;
    const char* key;
    const char* label;
    float defaultValue; // normalized
    FxParameterPage page;
    bool quick;         // shown on the compact graph node
    float minimum,maximum;
    FxParameterCurve curve;
    const char* unit;
    int choices=0;      // Choice curve: number of discrete states
};
float fxParameterValue(const FxParameterDescriptor&,float normalized) noexcept;
std::string fxParameterText(const FxParameterDescriptor&,float normalized);

inline constexpr std::size_t maxFxParameters=8;

// Realtime DSP contract. prepare() allocates and runs off the audio thread;
// reset() and process() are allocation-free and lock-free. params are the
// canonical normalized values in descriptor order (resolved at compile time).
class FxProcessor {
public:
    virtual ~FxProcessor()=default;
    virtual void prepare(double sampleRate)=0;
    virtual void reset() noexcept=0;
    virtual void process(float* left,float* right,int samples,const float* params) noexcept=0;
};

struct FxEffectDescriptor {
    FxEffectType type;
    const char* key;
    const char* label;
    FxCategory category;
    FxVisual visual;
    bool processesAudio;
    const FxParameterDescriptor* parameters;
    std::size_t parameterCount;
    std::unique_ptr<FxProcessor>(*create)();
    int latencySamples;
};
// The effect registry (core/fx/FxEffects.cpp). Every entry with
// processesAudio==true has a verified DSP implementation.
const std::vector<FxEffectDescriptor>& fxEffectCatalog() noexcept;
const FxEffectDescriptor* findFxEffect(FxEffectType) noexcept;

// Canvas units are device-independent graph coordinates (one unit equals one
// design pixel at 100% editor zoom). They are not tied to a window size.
struct FxPoint { float x=0.0f,y=0.0f; };

struct FxParameterValue { FxParameterId id=0; float value=0.0f; };

struct FxPortTopology { std::uint8_t inputs=0,outputs=0; };

struct FxNode {
    FxNodeId id=invalidFxNodeId;
    FxNodeKind kind=FxNodeKind::Effect;
    FxEffectType effect=FxEffectType::None;
    FxSourceType source=FxSourceType::Bus;
    FxBusId bus=0; // Source nodes only
    std::string name;
    bool enabled=true;
    FxPoint position{};
    FxPortTopology ports{};
    std::vector<FxParameterValue> parameters;

    std::optional<float> parameter(FxParameterId) const noexcept;
    bool isRouting() const noexcept { return kind==FxNodeKind::Split || kind==FxNodeKind::Merge; }
};

struct FxPortRef {
    FxNodeId node=invalidFxNodeId;
    std::uint8_t port=0;
    bool operator==(const FxPortRef& o) const noexcept { return node==o.node && port==o.port; }
    bool operator!=(const FxPortRef& o) const noexcept { return !(*this==o); }
};

struct FxConnection {
    FxConnectionId id=0;
    FxPortRef from; // output port
    FxPortRef to;   // input port
    // Visual routing points in canvas units. Layout only: they never change
    // graph semantics or DSP. Multiple points are supported by the model.
    std::vector<FxPoint> layout;
};

// Environment-wide controls applied around the complete graph:
// input gain -> graph -> dry/wet -> stereo width -> output gain.
struct FxGlobalSettings {
    float inputGainDb=0.0f;
    float dryWet=1.0f;
    float width=1.0f;
    float outputGainDb=0.0f;
};

enum class FxEditResult : std::uint8_t {
    Ok, UnknownNode, InvalidPort, SelfConnection, DuplicateConnection,
    InputOccupied, OutputOccupied, WouldCreateCycle, ControlSourceNotRoutable,
    ProtectedNode, InvalidValue, CapacityExceeded, Unsupported, UnknownConnection
};
const char* toString(FxEditResult) noexcept;

FxPortTopology fxPortTopology(FxNodeKind,std::uint8_t branches=2) noexcept;

class FxGraph {
public:
    static constexpr std::size_t maxNodes=128;
    static constexpr std::size_t maxConnections=256;
    static constexpr std::size_t maxLayoutPoints=8;
    static constexpr std::uint8_t minBranches=2,maxBranches=8;

    // Construction. Each returns invalidFxNodeId when the request is invalid.
    FxNodeId addBusSource(FxBusId,FxPoint);
    FxNodeId addEffect(FxEffectType,FxPoint);
    FxNodeId addSplit(FxPoint,std::uint8_t outputs=2);
    FxNodeId addMerge(FxPoint,std::uint8_t inputs=2);
    FxNodeId addOutput(FxPoint);

    // Removes the node and every connection touching it. Source and Output
    // terminals are protected: the graph always runs a bus -> MASTER OUT.
    FxEditResult removeNode(FxNodeId);
    // Removes an effect; if it sat in a single chain (A -> X -> B), A is
    // reconnected to B so deleting an effect never silently mutes the chain.
    FxEditResult removeNodeBridging(FxNodeId);
    // Removes every Effect/Split/Merge node and reconnects the first source
    // to MASTER OUT (the neutral graph).
    void clearProcessing();

    FxEditResult connect(FxPortRef from,FxPortRef to,FxConnectionId* created=nullptr);
    FxEditResult canConnect(FxPortRef from,FxPortRef to) const noexcept;
    bool disconnect(FxConnectionId) noexcept;
    std::size_t disconnectPort(FxNodeId,bool input,std::uint8_t port) noexcept;

    // A -> B becomes A -> NEW -> B. Atomic: on any failure the graph is
    // returned unchanged (A -> B preserved) and invalidFxNodeId is returned.
    FxNodeId insertEffectOnConnection(FxConnectionId,FxEffectType,FxPoint);

    FxEditResult addLayoutPoint(FxConnectionId,std::size_t index,FxPoint);
    FxEditResult moveLayoutPoint(FxConnectionId,std::size_t index,FxPoint);
    FxEditResult removeLayoutPoint(FxConnectionId,std::size_t index);

    FxEditResult moveNode(FxNodeId,FxPoint) noexcept;
    FxEditResult setEnabled(FxNodeId,bool) noexcept;
    FxEditResult setParameter(FxNodeId,FxParameterId,float) noexcept;

    // SERIAL workflow: insert an effect immediately before MASTER OUT, splicing
    // it into the existing output connection. Positions shift to make room.
    FxNodeId insertEffectBeforeOutput(FxEffectType);
    // Rebuilds routing as Source -> effects (left-to-right order) -> Output,
    // removing Split/Merge nodes. Only SERIAL is implemented so far.
    bool applyTemplate(FxRoutingMode);

    void setRoutingMode(FxRoutingMode) noexcept;
    FxRoutingMode routingMode() const noexcept { return mode_; }
    void setGlobals(const FxGlobalSettings&) noexcept;
    const FxGlobalSettings& globals() const noexcept { return globals_; }

    const std::vector<FxNode>& nodes() const noexcept { return nodes_; }
    const std::vector<FxConnection>& connections() const noexcept { return connections_; }
    const FxNode* findNode(FxNodeId) const noexcept;
    const FxConnection* findConnection(FxConnectionId) const noexcept;
    const FxConnection* connectionAt(FxPortRef port,bool input) const noexcept;
    FxNodeId sourceNode() const noexcept; // first source
    FxNodeId sourceForBus(FxBusId) const noexcept;
    FxNodeId outputNode() const noexcept;

    // Full structural validation; used by the compiler, after decoding, tests.
    bool validate(std::string* error=nullptr) const;

    bool operator==(const FxGraph&) const noexcept;
    bool operator!=(const FxGraph& o) const noexcept { return !(*this==o); }

private:
    friend bool decodeFxGraph(const void*,std::size_t,FxGraph&) noexcept;
    friend std::vector<std::uint8_t> encodeFxGraph(const FxGraph&);
    FxNode* mutableNode(FxNodeId) noexcept;
    FxConnection* mutableConnection(FxConnectionId) noexcept;
    FxNodeId appendNode(FxNode);
    bool reaches(FxNodeId from,FxNodeId target) const noexcept;

    std::vector<FxNode> nodes_;
    std::vector<FxConnection> connections_;
    FxNodeId nextNodeId_=1;
    FxConnectionId nextConnectionId_=1;
    FxRoutingMode mode_=FxRoutingMode::Serial;
    FxGlobalSettings globals_{};
};

// Feedback policy: the editable graph is a DAG; connect() rejects any edge
// that closes a cycle. Intentional feedback will later be modelled as an
// explicit feedback node with a guaranteed minimum delay, compiled into the
// plan as a delayed edge, never as a raw cycle.

// Versioned, bounded binary codec (version 2: bus sources, layout points).
std::vector<std::uint8_t> encodeFxGraph(const FxGraph&);
bool decodeFxGraph(const void*,std::size_t,FxGraph&) noexcept;

// Production default: BUS 1 -> MASTER OUT. Audibly neutral.
FxGraph makeDefaultFxGraph();
// DEVELOPMENT demo (explicit opt-in via TEMPLATES, never a default):
// BUS 1 -> DRIVE -> SPLIT -> {DELAY, REVERB} -> MERGE -> MASTER OUT.
FxGraph makeDevelopmentFxGraph();

// Message-thread document: canonical graph + snapshot undo/redo + revision.
// UI widgets observe revision(); the processor observes onChanged to compile.
class FxGraphDocument {
public:
    static constexpr std::size_t historyLimit=64;
    explicit FxGraphDocument(FxGraph initial=makeDefaultFxGraph());

    const FxGraph& graph() const noexcept { return graph_; }
    std::uint64_t revision() const noexcept { return revision_; }
    // Invoked after every committed change (edit, gesture step, undo, redo, replace).
    std::function<void()> onChanged;

    // Applies fn to a working copy; commits and records undo only on success
    // and only if the graph actually changed.
    template<typename Fn> bool edit(Fn&& fn) {
        FxGraph working=graph_;
        if(!fn(working) || working==graph_) return false;
        commit(std::move(working));
        return true;
    }

    // Continuous gestures (node drags, knob drags) produce one undo step.
    void beginGesture();
    template<typename Fn> bool gestureEdit(Fn&& fn) {
        FxGraph working=graph_;
        if(!fn(working) || working==graph_) return false;
        graph_=std::move(working);
        ++revision_;
        notify();
        return true;
    }
    void endGesture();

    bool canUndo() const noexcept { return !undo_.empty(); }
    bool canRedo() const noexcept { return !redo_.empty(); }
    bool undo();
    bool redo();
    void replace(FxGraph); // clears history

private:
    void commit(FxGraph);
    void notify() { if(onChanged) onChanged(); }
    FxGraph graph_;
    std::vector<FxGraph> undo_,redo_;
    std::optional<FxGraph> gestureStart_;
    std::uint64_t revision_=1;
};

}
