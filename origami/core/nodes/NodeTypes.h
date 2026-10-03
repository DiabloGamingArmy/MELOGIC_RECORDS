// mct-origami-nodes-n02
#pragma once
#include <cstdint>

// Graph vocabulary shared by every NODES graph (docs/NODES_ARCHITECTURE.md).
// Edit/compile-time only: the audio thread never inspects these values; plans
// are resolved before they are published.
//
// Two independent questions:
//   SIGNAL TYPE       what travels through a port      (per port)
//   EXECUTION DOMAIN  how/where a node runs            (per node)
// Graph OWNERSHIP (e.g. "this graph belongs to bus 7") is a third, separate
// concept carried by the owner (FxWorkspace), never an execution domain.
//
// Control and Event are vocabulary only: no shipping node has such a port yet.
namespace mct::origami::nodes {

// Values are stable (FxSignalDomain shares them; never renumber).
enum class NodeSignalType : std::uint8_t { Audio=1, Control=2, Event=3 };

enum class NodeExecutionDomain : std::uint8_t {
    Global=1, // one instance, always running (bus/master processing, future generators)
    Voice=2,  // one instance per voice, lives with a note (future voice nodes)
    Event=3   // runs on event arrival / event clock (future arpeggiator, sequencer)
};

enum class PortDirection : std::uint8_t { Input=1, Output=2 };

// Model-owned description of one port. Derived from the node definition, never
// serialized; `name` is a static string (no ownership).
struct PortDescriptor {
    PortDirection direction=PortDirection::Input;
    NodeSignalType type=NodeSignalType::Audio;
    std::uint8_t index=0;      // stable local index within its direction
    const char* name="";       // human-readable socket label
};

// Why two ports cannot be joined by a wire, judged on their descriptors alone.
enum class PortPairError : std::uint8_t { None, SameDirection, TypeMismatch };

// Direction-agnostic: either endpoint may be the output.
constexpr PortPairError checkPortPair(const PortDescriptor& a,const PortDescriptor& b) noexcept {
    if(a.direction==b.direction) return PortPairError::SameDirection;
    if(a.type!=b.type) return PortPairError::TypeMismatch; // no implicit conversion, ever
    return PortPairError::None;
}

constexpr const char* toString(NodeSignalType t) noexcept {
    return t==NodeSignalType::Audio ? "AUDIO" : t==NodeSignalType::Control ? "CONTROL" : "EVENT";
}
constexpr const char* toString(NodeExecutionDomain d) noexcept {
    return d==NodeExecutionDomain::Global ? "GLOBAL" : d==NodeExecutionDomain::Voice ? "VOICE" : "EVENT";
}

}
