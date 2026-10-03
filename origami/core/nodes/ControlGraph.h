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
enum class ControlNodeKind : std::uint8_t { Source=1, Parameter=2 };
struct ControlNodeKey {
    ControlNodeKind kind=ControlNodeKind::Source;
    ModSource source=ModSource::None;                 // Source nodes
    ModAddress destination{ModDestination::None,0,0}; // Parameter nodes
    bool operator==(const ControlNodeKey& o) const noexcept {
        return kind==o.kind && (kind==ControlNodeKind::Source ? source==o.source : destination==o.destination);
    }
    bool operator!=(const ControlNodeKey& o) const noexcept { return !(*this==o); }
};
inline ControlNodeKey sourceKey(ModSource s) noexcept { return {ControlNodeKind::Source,s,{ModDestination::None,0,0}}; }
inline ControlNodeKey parameterKey(const ModAddress& a) noexcept { return {ControlNodeKind::Parameter,ModSource::None,a}; }
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
    CapacityExceeded     // ModulationState is full
};
const char* toString(ControlLinkResult) noexcept;
struct ControlLinkCheck {
    ControlLinkResult result=ControlLinkResult::MissingSource;
    std::uint32_t existingRoute=0;
    bool creatable() const noexcept { return result==ControlLinkResult::Ok; }
};
ControlLinkCheck checkControlLink(const InstrumentState&,ModSource,const ModAddress&) noexcept;

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
    std::uint32_t routeId=0;     // the canonical relationship (all properties live there)
    std::size_t source=0,parameter=0; // indices into nodes
    bool supported=true;         // false: a crossing created elsewhere (SYNTH/Matrix)
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
