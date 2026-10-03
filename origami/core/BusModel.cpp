// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-graph-dsp-bus-routing-p02
#include "core/BusModel.h"
#include <cmath>
#include <cstring>

namespace mct::origami {

bool validBusState(const BusState& s) noexcept {
    if(s.count<1 || s.count>BusState::capacity || s.buses[0].id!=mainBusId) return false;
    for(std::size_t i=0;i<s.count;++i) {
        const auto& b=s.buses[i];
        if(b.id==0 || b.id>=s.nextId || b.name.back()!='\0') return false;
        for(std::size_t j=0;j<i;++j) if(s.buses[j].id==b.id) return false;
    }
    for(std::size_t i=s.count;i<BusState::capacity;++i) if(s.buses[i].id!=0) return false;
    return true;
}

BusId addBus(BusState& s) {
    if(s.count>=maxRenderBuses || s.count>=BusState::capacity) return 0;
    // Lowest free user number: predictable, and existing buses are never
    // renamed (BusIds stay stable; numbering is cosmetic).
    int number=1;
    for(bool taken=true;taken;) {
        taken=false;
        const auto candidate="BUS "+std::to_string(number);
        for(std::size_t i=0;i<s.count;++i) taken|=candidate==s.buses[i].name.data();
        if(taken) ++number;
    }
    auto& bus=s.buses[s.count++];
    bus={};
    bus.id=s.nextId++;
    const auto name="BUS "+std::to_string(number);
    BusState::setBusName(bus,name.c_str());
    return bus.id;
}

BusRouteResult addOscBusRoute(OscillatorModuleState& m,const BusState& buses,BusId bus,float level) noexcept {
    if(buses.find(bus)==nullptr) return BusRouteResult::UnknownBus;
    if(!std::isfinite(level)) return BusRouteResult::InvalidLevel;
    for(std::size_t i=0;i<m.busRouteCount;++i) if(m.busRoutes[i].bus==bus) return BusRouteResult::Duplicate;
    if(m.busRouteCount>=maxOscBusRoutes) return BusRouteResult::Capacity;
    m.busRoutes[m.busRouteCount++]={bus,std::clamp(level,0.0f,1.0f)};
    return BusRouteResult::Ok;
}

BusRouteResult removeOscBusRoute(OscillatorModuleState& m,std::size_t index) noexcept {
    if(index>=m.busRouteCount) return BusRouteResult::InvalidIndex;
    if(m.busRouteCount<=1) return BusRouteResult::LastRoute;
    for(std::size_t i=index;i+1<m.busRouteCount;++i) m.busRoutes[i]=m.busRoutes[i+1];
    m.busRoutes[--m.busRouteCount]={};
    return BusRouteResult::Ok;
}

BusRouteResult setOscBusRoute(OscillatorModuleState& m,const BusState& buses,std::size_t index,BusId bus,float level) noexcept {
    if(index>=m.busRouteCount) return BusRouteResult::InvalidIndex;
    if(buses.find(bus)==nullptr) return BusRouteResult::UnknownBus;
    if(!std::isfinite(level)) return BusRouteResult::InvalidLevel;
    for(std::size_t i=0;i<m.busRouteCount;++i)
        if(i!=index && m.busRoutes[i].bus==bus) return BusRouteResult::Duplicate;
    m.busRoutes[index]={bus,std::clamp(level,0.0f,1.0f)};
    return BusRouteResult::Ok;
}

bool validOscBusRoutes(const OscillatorModuleState& m,const BusState& buses) noexcept {
    if(m.busRouteCount<1 || m.busRouteCount>maxOscBusRoutes) return false;
    for(std::size_t i=0;i<m.busRouteCount;++i) {
        const auto& r=m.busRoutes[i];
        if(buses.find(r.bus)==nullptr || !std::isfinite(r.level) || r.level<0.0f || r.level>1.0f) return false;
        for(std::size_t j=0;j<i;++j) if(m.busRoutes[j].bus==r.bus) return false;
    }
    return true;
}
}
