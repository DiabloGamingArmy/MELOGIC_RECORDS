// mct-origami-fx-page-foundation-p01
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

// Canonical, non-realtime FX graph model.
//
// Ownership and threading:
//   EDITABLE FxGraph (message thread, value type, no UI pointers)
//       | compileFxRenderPlan() after each mutation
//       v
//   IMMUTABLE FxRenderPlan (future: published to audio via LatestStateMailbox)
//       v
//   REALTIME FX RENDERER (not implemented in Patch 1)
//
// The audio thread must never traverse an FxGraph. Nothing in this header is
// JUCE-aware; UI components refer to nodes only by stable FxNodeId.
namespace mct::origami::fx {

// Persistent identities. Never renumber or reuse enum values: they are written
// by the FX graph codec and will be referenced by presets and modulation.
using FxNodeId=std::uint32_t;
using FxConnectionId=std::uint32_t;
using FxParameterId=std::uint16_t;
inline constexpr FxNodeId invalidFxNodeId=0;

enum class FxNodeKind : std::uint8_t {
    Source=1,  // where a signal enters the FX environment
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

enum class FxSourceType : std::uint8_t {
    SynthSum=1, OscillatorBus=2, FilterBus=3, NoiseBus=4,
    EnvelopeBus=5, LfoBus=6, MidiBus=7, ExternalInput=8
};

enum class FxEffectType : std::uint16_t { None=0, Drive=1, Delay=2, Reverb=3 };

// Routing workflows. All of them edit the SAME canonical graph; they are not
// independent routing engines.
enum class FxRoutingMode : std::uint8_t { Serial=1, Parallel=2, Split=3, Send=4, Custom=5 };

enum class FxParameterPage : std::uint8_t { Main=1, Advanced=2 };

struct FxSourceDescriptor {
    FxSourceType type;
    const char* key;
    const char* label;
    FxSignalDomain domain;
    bool available; // produces audio in the current engine
};
const std::array<FxSourceDescriptor,8>& fxSourceCatalog() noexcept;
const FxSourceDescriptor* findFxSource(FxSourceType) noexcept;

// Parameter values are stored normalized [0,1] by stable parameter ID. The
// physical mapping (ms, dB, ...) belongs to the future DSP implementation, so
// the model does not pre-commit to units it cannot yet honour.
struct FxParameterDescriptor {
    FxParameterId id;
    const char* key;
    const char* label;
    float defaultValue;
    FxParameterPage page;
    bool quick; // shown on the compact graph node
};

struct FxEffectDescriptor {
    FxEffectType type;
    const char* key;
    const char* label;
    bool processesAudio; // false for every Patch 1 development entry
    const FxParameterDescriptor* parameters;
    std::size_t parameterCount;
};
// DEVELOPMENT catalog: graph/UI objects only. None of these process audio yet.
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
    FxSourceType source=FxSourceType::SynthSum;
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
};

// Environment-wide controls. Stored in physical units so their meaning is
// fixed now; Patch 1 does NOT apply them to audio.
struct FxGlobalSettings {
    float inputGainDb=0.0f;
    float dryWet=1.0f;
    float width=1.0f;
    float outputGainDb=0.0f;
};

enum class FxEditResult : std::uint8_t {
    Ok, UnknownNode, InvalidPort, SelfConnection, DuplicateConnection,
    InputOccupied, OutputOccupied, WouldCreateCycle, ControlSourceNotRoutable,
    ProtectedNode, InvalidValue, CapacityExceeded, Unsupported
};
const char* toString(FxEditResult) noexcept;

FxPortTopology fxPortTopology(FxNodeKind,std::uint8_t branches=2) noexcept;

class FxGraph {
public:
    static constexpr std::size_t maxNodes=128;
    static constexpr std::size_t maxConnections=256;
    static constexpr std::uint8_t minBranches=2,maxBranches=8;

    // Construction. Each returns invalidFxNodeId when the request is invalid.
    FxNodeId addSource(FxSourceType,FxPoint);
    FxNodeId addEffect(FxEffectType,FxPoint);
    FxNodeId addSplit(FxPoint,std::uint8_t outputs=2);
    FxNodeId addMerge(FxPoint,std::uint8_t inputs=2);
    FxNodeId addOutput(FxPoint);

    // Removes the node and every connection touching it. Source and Output
    // terminals are protected: the graph always runs synth -> MASTER OUT.
    FxEditResult removeNode(FxNodeId);
    // Removes every Effect/Split/Merge node, keeping the Source and Output.
    void clearProcessing();

    FxEditResult connect(FxPortRef from,FxPortRef to,FxConnectionId* created=nullptr);
    FxEditResult canConnect(FxPortRef from,FxPortRef to) const noexcept;
    bool disconnect(FxConnectionId) noexcept;
    std::size_t disconnectPort(FxNodeId,bool input,std::uint8_t port) noexcept;

    FxEditResult moveNode(FxNodeId,FxPoint) noexcept;
    FxEditResult setEnabled(FxNodeId,bool) noexcept;
    FxEditResult setParameter(FxNodeId,FxParameterId,float) noexcept;

    // SERIAL workflow: insert an effect immediately before MASTER OUT, splicing
    // it into the existing output connection. Positions shift to make room.
    FxNodeId insertEffectBeforeOutput(FxEffectType);
    // Rebuilds routing as Source -> effects (left-to-right order) -> Output,
    // removing Split/Merge nodes. Only SERIAL is implemented in Patch 1.
    bool applyTemplate(FxRoutingMode);

    void setRoutingMode(FxRoutingMode) noexcept;
    FxRoutingMode routingMode() const noexcept { return mode_; }
    void setGlobals(const FxGlobalSettings&) noexcept;
    const FxGlobalSettings& globals() const noexcept { return globals_; }

    const std::vector<FxNode>& nodes() const noexcept { return nodes_; }
    const std::vector<FxConnection>& connections() const noexcept { return connections_; }
    const FxNode* findNode(FxNodeId) const noexcept;
    const FxConnection* connectionAt(FxPortRef port,bool input) const noexcept;
    FxNodeId sourceNode() const noexcept;
    FxNodeId outputNode() const noexcept;

    // Full structural validation; used after decoding and by tests.
    bool validate(std::string* error=nullptr) const;

    bool operator==(const FxGraph&) const noexcept;
    bool operator!=(const FxGraph& o) const noexcept { return !(*this==o); }

private:
    friend bool decodeFxGraph(const void*,std::size_t,FxGraph&) noexcept;
    friend std::vector<std::uint8_t> encodeFxGraph(const FxGraph&);
    FxNode* mutableNode(FxNodeId) noexcept;
    FxNodeId appendNode(FxNode);
    bool reaches(FxNodeId from,FxNodeId target) const noexcept;

    std::vector<FxNode> nodes_;
    std::vector<FxConnection> connections_;
    FxNodeId nextNodeId_=1;
    FxConnectionId nextConnectionId_=1;
    FxRoutingMode mode_=FxRoutingMode::Serial;
    FxGlobalSettings globals_{};
};

// Immutable plan compiled from a validated graph. Nodes are in a topological
// order covering only nodes on a Source -> Output path. A future renderer will
// receive one of these through a lock-free mailbox; it never sees FxGraph.
//
// Feedback policy: the editable graph is a DAG; connect() rejects any edge
// that closes a cycle. Intentional feedback will later be modelled as an
// explicit feedback node with a guaranteed minimum delay, compiled into the
// plan as a delayed edge, never as a raw cycle.
struct FxRenderPlan {
    bool valid=false;
    bool processesAudio=false; // true only once a step has real DSP
    std::vector<FxNodeId> order;
};
FxRenderPlan compileFxRenderPlan(const FxGraph&);

// Versioned, bounded binary codec. Not yet part of the host preset chunk:
// production preset integration is a later, backward-compatible patch.
std::vector<std::uint8_t> encodeFxGraph(const FxGraph&);
bool decodeFxGraph(const void*,std::size_t,FxGraph&) noexcept;

// DEVELOPMENT seed graph for inspecting the routing UI:
// SYNTH -> DRIVE -> SPLIT -> {DELAY, REVERB} -> MERGE -> MASTER OUT.
// Isolated so it can be replaced by the real default (empty serial) state.
FxGraph makeDevelopmentFxGraph();

// Message-thread document: canonical graph + snapshot undo/redo + revision.
// UI widgets observe revision() and rebuild only what changed.
class FxGraphDocument {
public:
    static constexpr std::size_t historyLimit=64;
    explicit FxGraphDocument(FxGraph initial=makeDevelopmentFxGraph());

    const FxGraph& graph() const noexcept { return graph_; }
    std::uint64_t revision() const noexcept { return revision_; }

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
    FxGraph graph_;
    std::vector<FxGraph> undo_,redo_;
    std::optional<FxGraph> gestureStart_;
    std::uint64_t revision_=1;
};

}
