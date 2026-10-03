// mct-origami-nodes-n03-control
#pragma once
#include "core/InstrumentState.h"
#include "core/nodes/NodeTypes.h"
#include <cstdint>
#include <optional>
#include <vector>

// The NODES CONTROL layer: SOURCE -> PARAMETER.
//
// One modulation relationship, several views. A CONTROL link IS a canonical
// ModRoute (ModulationState::routes); this module never stores source,
// destination, amount, polarity or enabled state of its own:
//
//     ModulationState::routes ──derive──▶ ControlGraph (nodes + links)   [view]
//     ControlLayout (positions, placed nodes)                           [view metadata]
//
// Creation/edits/deletion go through the same bindings SYNTH drag-and-drop and
// the Matrix use (add/set/remove route), so every view observes one state.
//
// Ownership: CONTROL relationships are instrument-wide patch state, not part of
// any bus's audio graph. The layer is drawn over whichever bus graph is shown.
namespace mct::origami::nodes {

// ---- Execution domains of canonical sources / destinations ----------------
// GLOBAL source: one value per sample for the whole instrument (free LFO,
// macros, random...). VOICE source: one value per voice (envelopes, voice
// LFO modes, performance inputs).
NodeExecutionDomain sourceDomain(ModSource,const ModulationState&) noexcept;
// Where the destination is CONSUMED: per voice (oscillator parameters,
// filter, pitch, master...) or once globally (glide, LFO scaling, swing, FX
// graph parameters).
NodeExecutionDomain destinationDomain(const ModAddress&) noexcept;
// GLOBAL -> GLOBAL, VOICE -> VOICE and GLOBAL -> VOICE (broadcast: every voice
// reads the same global value at the same sample, as the engine does) are
// supported. VOICE -> GLOBAL needs a reduction NODES does not define: rejected.
bool domainCrossingSupported(NodeExecutionDomain source,NodeExecutionDomain destination) noexcept;

// N03 exposes a deliberately small set of source nodes.
bool controlSourceExposed(ModSource) noexcept;
// Active in the instrument (collections can remove sources).
bool controlSourceActive(ModSource,const ModulationState&) noexcept;

// ---- Nodes / ports ---------------------------------------------------------
enum class ControlNodeKind : std::uint8_t { Source=1, Parameter=2, Operator=3 };
struct ControlNodeKey {
    ControlNodeKind kind=ControlNodeKind::Source;
    ModSource source=ModSource::None;                 // Source nodes
    ModAddress destination{ModDestination::None,0,0}; // Parameter nodes
    std::uint32_t op=0;                               // Operator nodes (N04)
    bool operator==(const ControlNodeKey& o) const noexcept {
        if(kind!=o.kind) return false;
        return kind==ControlNodeKind::Source ? source==o.source
             : kind==ControlNodeKind::Parameter ? destination==o.destination : op==o.op;
    }
    bool operator!=(const ControlNodeKey& o) const noexcept { return !(*this==o); }
};
inline ControlNodeKey sourceKey(ModSource s) noexcept { return {ControlNodeKind::Source,s,{ModDestination::None,0,0},0}; }
inline ControlNodeKey parameterKey(const ModAddress& a) noexcept { return {ControlNodeKind::Parameter,ModSource::None,a,0}; }
inline ControlNodeKey operatorKey(std::uint32_t id) noexcept { return {ControlNodeKind::Operator,ModSource::None,{ModDestination::None,0,0},id}; }
// Source nodes: one CONTROL output. Parameter nodes: one CONTROL input.
PortDescriptor controlPort(ControlNodeKind) noexcept;

// ---- Link validation (the one rule set for NODES-created relationships) ---
enum class ControlLinkResult : std::uint8_t {
    Ok,                  // a new route may be created
    Exists,              // the relationship already exists: reuse existingRoute
    MissingSource,       // ModSource::None / unknown
    SourceNotExposed,    // not a N03 source node
    SourceInactive,      // removed from the instrument's collections
    MissingDestination,  // ModDestination::None
    DestinationUnavailable, // not a valid destination in this instrument
    DomainCrossing,      // VOICE source -> GLOBAL destination
    CapacityExceeded,    // ModulationState is full
    // N04 operator edges
    MissingOperator,     // an endpoint operator does not exist
    InvalidPort,         // no such operator input / wrong direction
    InputOccupied,       // operator inputs take exactly one connection
    WouldCreateCycle,    // control graphs are acyclic
    TypeMismatch         // N05: CONTROL / GATE / EVENT never connect to each other
};
// N05: the signal an output endpoint carries, and the signal an input expects.
ControlSignal controlOutputSignal(const ModulationState&,const struct ControlEndpoint&) noexcept;
ControlSignal controlInputSignal(const ModulationState&,const struct ControlEndpoint&) noexcept;
NodeSignalType nodeSignal(ControlSignal) noexcept;
const char* toString(ControlLinkResult) noexcept;
struct ControlLinkCheck {
    ControlLinkResult result=ControlLinkResult::MissingSource;
    std::uint32_t existingRoute=0;
    bool creatable() const noexcept { return result==ControlLinkResult::Ok; }
};
ControlLinkCheck checkControlLink(const InstrumentState&,ModSource,const ModAddress&) noexcept;

// ---- N04: CONTROL processing edges (the one rule set for NODES authoring) --
// From: a canonical source output or an operator output. To: an operator input
// or a PARAMETER. Validates direction, CONTROL typing, cardinality, cycles and
// execution domains: an edge that would turn any existing chain feeding a
// GLOBAL destination into a per-voice result is rejected, as is a per-voice
// result into a GLOBAL parameter.
struct ControlEndpoint {
    enum class Kind : std::uint8_t { Source, OperatorOutput, OperatorInput, Parameter };
    Kind kind=Kind::Source;
    ModSource source=ModSource::None;
    std::uint32_t op=0;
    std::uint8_t input=0;
    std::uint8_t port=0;   // N06: OperatorOutput port (stable index; 0 = the primary output)
    ModAddress destination{ModDestination::None,0,0};
    static ControlEndpoint fromSource(ModSource s) { ControlEndpoint e; e.kind=Kind::Source; e.source=s; return e; }
    static ControlEndpoint fromOperator(std::uint32_t id,std::uint8_t port=0) { ControlEndpoint e; e.kind=Kind::OperatorOutput; e.op=id; e.port=port; return e; }
    static ControlEndpoint toInput(std::uint32_t id,std::uint8_t input) { ControlEndpoint e; e.kind=Kind::OperatorInput; e.op=id; e.input=input; return e; }
    static ControlEndpoint toParameter(const ModAddress& a) { ControlEndpoint e; e.kind=Kind::Parameter; e.destination=a; return e; }
    bool isOutput() const noexcept { return kind==Kind::Source || kind==Kind::OperatorOutput; }
    ModSource outputSource() const noexcept { return kind==Kind::Source ? source : operatorSource(op,port); }
};
ControlLinkCheck checkControlEdge(const InstrumentState&,const ControlEndpoint& from,const ControlEndpoint& to) noexcept;

// Atomic edits returning the complete next ModulationState (the caller
// commits it in one transaction). Each returns false and leaves `out`
// untouched when the edit is invalid.
bool addControlOperator(const ModulationState&,ControlOpType,ModulationState& out,std::uint32_t& id) noexcept;
// N06: false when a second SEQUENCER node would be created (there is one sequencer).
bool controlOperatorCreatable(const ModulationState&,ControlOpType) noexcept;
// Operator inputs only (PARAMETER edges are canonical routes: see the page).
bool connectControlInput(const InstrumentState&,const ControlEndpoint& from,std::uint32_t op,std::uint8_t input,ModulationState& out) noexcept;
bool disconnectControlInput(const ModulationState&,std::uint32_t op,std::uint8_t input,ModulationState& out) noexcept;
// A -> B becomes A -> NEW -> B. `route` selects a route link (direct or
// processed); otherwise the operator-input edge (op, input). The existing
// route keeps its id, amount, polarity and enabled state; its source becomes
// the new operator (so the direct route is replaced, never left underneath).
bool insertControlOperatorOnRoute(const InstrumentState&,std::uint32_t route,ControlOpType,ModulationState& out,std::uint32_t& id) noexcept;
bool insertControlOperatorOnInput(const InstrumentState&,std::uint32_t op,std::uint8_t input,ControlOpType,ModulationState& out,std::uint32_t& id) noexcept;
// N06: the output port an inserted / auto-connected node feeds downstream with:
// the primary output when its signal matches, else the ONLY matching port;
// -1 when none matches or the choice would be ambiguous.
int controlAutoOutputPort(const ControlOpInfo&,ControlSignal wanted) noexcept;
// Deletes an operator. A unary operator with a connected input is bridged:
// consumers and terminal routes reconnect to its input (a chain of one
// collapses back to a direct route); a route that would duplicate an existing
// pair is removed instead. Otherwise consumers are disconnected and terminal
// routes removed.
bool deleteControlOperator(const ModulationState&,std::uint32_t op,ModulationState& out) noexcept;

// ---- View metadata (the only persisted CONTROL-layer data) ----------------
struct ControlLayoutEntry {
    ControlNodeKey key;
    float x=0.0f,y=0.0f;
    bool placed=false;     // explicitly added/kept on the canvas even without links
    bool positioned=false; // x/y are meaningful (else the default column is used)
};
class ControlLayout {
public:
    static constexpr std::size_t maxEntries=256;
    const std::vector<ControlLayoutEntry>& entries() const noexcept { return entries_; }
    const ControlLayoutEntry* find(const ControlNodeKey&) const noexcept;
    void setPosition(const ControlNodeKey&,float x,float y);
    void setPlaced(const ControlNodeKey&,bool placed);
    bool remove(const ControlNodeKey&);
    void clear() { entries_.clear(); }
    bool operator==(const ControlLayout& o) const noexcept;
    // Versioned codec ("MCVL" v1): keys + positions + placed flag only.
    std::vector<std::uint8_t> encode() const;
    bool decode(const void*,std::size_t); // all-or-nothing
private:
    ControlLayoutEntry& entry(const ControlNodeKey&);
    std::vector<ControlLayoutEntry> entries_;
};

// ---- Derived graph ---------------------------------------------------------
struct ControlGraphNode {
    ControlNodeKey key;
    NodeExecutionDomain domain=NodeExecutionDomain::Global;
    float x=0.0f,y=0.0f;
    bool placed=false;
};
struct ControlGraphLink {
    std::uint32_t routeId=0;     // route links: the canonical relationship (all properties live there)
    std::size_t source=0,parameter=0; // indices into nodes (from, to)
    bool supported=true;         // false: a crossing created elsewhere (SYNTH/Matrix)
    // N04 operator-input edges (routeId == 0): the target operator input.
    std::uint32_t targetOperator=0;
    std::uint8_t targetInput=0;
    std::uint8_t sourcePort=0;   // N06: output port of the source node (operators; 0 otherwise)
    bool isRoute() const noexcept { return routeId!=0; }
};
struct ControlGraph {
    std::vector<ControlGraphNode> nodes;
    std::vector<ControlGraphLink> links;
    std::optional<std::size_t> find(const ControlNodeKey&) const noexcept;
};
// Every complete route whose source is an exposed source becomes a link;
// placed layout entries add unlinked nodes. Positions: layout entry, else a
// deterministic default (stable across refreshes).
ControlGraph deriveControlGraph(const ModulationState&,const ControlLayout&);

}
