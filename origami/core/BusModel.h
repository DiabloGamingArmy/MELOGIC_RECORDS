// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-graph-dsp-bus-routing-p02
#pragma once
#include "OscillatorModule.h"
#include <array>
#include <cstdint>
#include <string>

// Canonical named-bus model.
//
//   OSCILLATOR -> OSC CHAIN -> voice filter -> level -> BUS (by stable BusId)
//                                                         -> Mixer (future)
//                                                         -> FX graph source
//                                                         -> MASTER OUT
//
// The future Mixer page is a UI over THIS model (add/remove/rename buses,
// gain/pan/mute/solo). P02 stores identity, name and active state only.
// The engine currently renders BUS 1; other buses are model-only.
namespace mct::origami {

// The engine renders at most this many buses (MAIN + 7 user buses).
inline constexpr std::size_t maxRenderBuses=8;

struct Bus {
    static constexpr std::size_t maxNameBytes=23;
    BusId id=0;
    std::array<char,maxNameBytes+1> name{};
    bool active=true;
    std::string label() const { return std::string(name.data()); }
};

struct BusState {
    static constexpr std::size_t capacity=16;
    std::array<Bus,capacity> buses{};
    std::uint8_t count=1;
    BusId nextId=2;
    // MAIN (stable id 1) is the permanent default bus. User buses are named
    // "BUS n" with the lowest free n; names are display only, never identity.
    BusState() noexcept {
        buses[0].id=mainBusId;
        setBusName(buses[0],"MAIN");
    }
    static void setBusName(Bus& bus,const char* text) noexcept {
        bus.name.fill('\0');
        for(std::size_t i=0;i<Bus::maxNameBytes && text[i]!='\0';++i) bus.name[i]=text[i];
    }
    const Bus* find(BusId id) const noexcept {
        for(std::size_t i=0;i<count && i<capacity;++i) if(buses[i].id==id) return &buses[i];
        return nullptr;
    }
};

bool validBusState(const BusState&) noexcept;
// Returns the new bus ID, or 0 when the render capacity is reached.
BusId addBus(BusState&);
// Removing a user bus only edits the list; use removeBus(InstrumentState&)
// so oscillator sends are pruned at the same time.

enum class BusRouteResult : std::uint8_t { Ok, UnknownBus, Duplicate, Capacity, LastRoute, InvalidIndex, InvalidLevel };
// Oscillator route editing. All operations validate against the bus list and
// leave the oscillator unchanged on failure.
BusRouteResult addOscBusRoute(OscillatorModuleState&,const BusState&,BusId,float level=1.0f) noexcept;
// The last remaining route cannot be removed: an oscillator always has a
// destination. Silence is expressed with a zero send level, not a dangling route.
BusRouteResult removeOscBusRoute(OscillatorModuleState&,std::size_t index) noexcept;
BusRouteResult setOscBusRoute(OscillatorModuleState&,const BusState&,std::size_t index,BusId,float level) noexcept;
bool validOscBusRoutes(const OscillatorModuleState&,const BusState&) noexcept;
}
