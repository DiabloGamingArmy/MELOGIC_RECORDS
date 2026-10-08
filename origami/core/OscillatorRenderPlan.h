// mct-origami-unified-routing-core-fx-p04
#pragma once
#include "OscillatorModule.h"
#include "BusModel.h"
#include "SynthFilter.h"

namespace mct::origami {
using OscillatorProcessPlans=std::array<dsp::OscProcessPlan,16>;
// Render slot -> stable BusId. Slot 0 is always MAIN. Published to the audio
// thread as a fixed-size value; never resolved by display name.
struct BusSlotMap {
    std::array<BusId,maxRenderBuses> ids{{mainBusId}};
    std::size_t count=1;
    bool operator==(const BusSlotMap& o) const noexcept { return count==o.count && ids==o.ids; }
    bool operator!=(const BusSlotMap& o) const noexcept { return !(*this==o); }
};
// Compiled at a host-block boundary and shared by all voices. Only amounts
// change at audio rate; IDs, enabled flags, types and ordering are topology.
struct OscillatorRenderPlan {
    SynthFilterPlan synthFilters{};
    std::uint32_t routeRamp=0;
    void adoptSynthFilters(const SynthFilterPlan& plan,bool snap=false,std::uint32_t samples=240) noexcept {
        const auto oldFilters=synthFilters.filterIds;const auto oldBuses=synthFilters.busIds;
        synthFilters=plan;++generation;bool changed=false;
        for(std::size_t m=0;m<modules.size();++m) if(ids[m] && ids[m]==plan.oscillatorIds[m]) {
            auto& module=modules[m];module.auxSends=false;
            for(std::size_t f=0;f<8;++f) {if(oldFilters[f]!=plan.filterIds[f]) module.filterSend[f]=0;
                changed|=module.filterSend[f]!=plan.filterSends[m][f];if(snap) module.filterSend[f]=plan.filterSends[m][f];}
            for(std::size_t b=0;b<8;++b) {if(oldBuses[b]!=plan.busIds[b]) module.busSend[b]=0;
                changed|=module.busSend[b]!=plan.directSends[m][b];if(snap) module.busSend[b]=plan.directSends[m][b];
                if(b) module.auxSends|=module.busSend[b]!=0 || plan.directSends[m][b]!=0;}
            module.mainBusSend=module.busSend[0];
        }
        routeRamp=snap?0:changed?samples:routeRamp;
        auxActive=false;for(std::size_t a=0;a<activeCount;++a) auxActive|=modules[active[a]].auxSends;
        for(std::size_t f=0;f<plan.count;++f) for(std::size_t b=1;b<plan.busCount;++b) auxActive|=plan.stages[f].sends[b]!=0;
    }
    void advanceRoutes() noexcept {
        if(!routeRamp) return;const float alpha=1.0f/float(routeRamp--);
        for(std::size_t a=0;a<activeCount;++a) {const auto m=active[a];auto& module=modules[m];
            for(std::size_t b=0;b<8;++b) module.busSend[b]+=(synthFilters.directSends[m][b]-module.busSend[b])*alpha;
            for(std::size_t f=0;f<8;++f) module.filterSend[f]+=(synthFilters.filterSends[m][f]-module.filterSend[f])*alpha;
            module.mainBusSend=module.busSend[0];
        }
    }
    struct Route {
        int source=-1;
        std::uint8_t amountSlot=0;
        OscRouteType type=OscRouteType::Off;
    };
    struct Module {
        std::array<std::uint8_t,maxOscProcesses> processes{};
        std::array<Route,maxOscRoutes> preRoutes{},postRoutes{};
        std::uint8_t processCount=0,preCount=0,postCount=0;
        bool dynamicProcesses=false,dynamicRoutes=false;
        bool simple=true; // no phase/spectral process or cross-oscillator route
        // Post-filter sends per render slot (slot 0 = MAIN).
        float mainBusSend=1.0f;
        std::array<float,maxRenderBuses> busSend{};
        std::array<float,8> filterSend{};
        bool auxSends=false;
        dsp::OscProcessPlan processTemplate{};
    };
    std::array<Module,16> modules{};
    std::array<OscillatorModuleId,16> ids{};
    std::array<std::uint8_t,16> active{};
    std::size_t activeCount=0;
    std::uint64_t generation=0;
    std::size_t busCount=1;
    bool auxActive=false; // any oscillator sends to a user bus

    void processPlan(std::size_t m,const OscillatorModuleState& source,dsp::OscProcessPlan& out) const noexcept {
        const auto& plan=modules[m];
        out=plan.processTemplate;
        for(std::size_t p=0;p<plan.processCount;++p) {
            const auto slot=plan.processes[p];
            out.stages[p].amount=plan.dynamicProcesses ? source.processes[slot].amount
                : (slot==0 ? source.process1Amount : source.process2Amount);
        }
    }

    void compile(const std::array<OscillatorModuleState,16>& state,const BusSlotMap& slots=BusSlotMap{}) noexcept {
        activeCount=0;
        busCount=std::clamp<std::size_t>(slots.count,1,maxRenderBuses);
        auxActive=false;
        const auto oldIds=ids;
        for(std::size_t m=0;m<state.size();++m) ids[m]=state[m].id;
        for(std::size_t m=0;m<state.size();++m) {
            const auto& source=state[m];auto& plan=modules[m];const auto oldBus=plan.busSend,oldFilter=plan.filterSend;plan={};
            if(!source.id || !source.enabled) continue;
            active[activeCount++]=static_cast<std::uint8_t>(m);
            for(std::size_t b=0;b<busCount;++b) plan.busSend[b]=oscBusSend(source,slots.ids[b]);
            if(oldIds[m]==source.id) {plan.busSend=oldBus;plan.filterSend=oldFilter;}
            plan.mainBusSend=plan.busSend[0];
            for(std::size_t b=1;b<busCount;++b) plan.auxSends=plan.auxSends || plan.busSend[b]!=0.0f;
            auxActive=auxActive || plan.auxSends;
            plan.dynamicProcesses=source.processCount!=0;
            if(plan.dynamicProcesses) {
                for(std::size_t p=0;p<std::min<std::size_t>(source.processCount,maxOscProcesses);++p)
                    if(source.processes[p].enabled && source.processes[p].type!=dsp::OscProcessType::Off)
                        plan.processes[plan.processCount++]=static_cast<std::uint8_t>(p);
            } else {
                if(source.process1!=dsp::OscProcessType::Off) plan.processes[plan.processCount++]=0;
                if(source.process2!=dsp::OscProcessType::Off) plan.processes[plan.processCount++]=1;
            }
            plan.processTemplate.count=plan.processCount;
            for(std::size_t p=0;p<plan.processCount;++p) {
                const auto slot=plan.processes[p];
                auto& stage=plan.processTemplate.stages[p];
                if(plan.dynamicProcesses) {
                    const auto& process=source.processes[slot];
                    stage={process.type,process.amount,process.seed};
                } else if(slot==0) stage={source.process1,source.process1Amount,source.process1Seed};
                else stage={source.process2,source.process2Amount,source.process2Seed};
            }
            auto addRoute=[&](OscillatorModuleId id,OscRouteType type,std::size_t amountSlot) {
                if(!id || type==OscRouteType::Off) return;
                std::size_t slot=0;while(slot<ids.size() && ids[slot]!=id) ++slot;
                if(slot==ids.size()) return;
                const Route route{static_cast<int>(slot),static_cast<std::uint8_t>(amountSlot),type};
                if(type==OscRouteType::PhaseMod || type==OscRouteType::FrequencyMod || type==OscRouteType::PhaseSkew)
                    plan.preRoutes[plan.preCount++]=route;
                else plan.postRoutes[plan.postCount++]=route;
            };
            plan.dynamicRoutes=source.routeCount!=0;
            if(plan.dynamicRoutes) {
                for(std::size_t r=0;r<std::min<std::size_t>(source.routeCount,maxOscRoutes);++r)
                    if(source.routes[r].enabled) addRoute(source.routes[r].sourceId,source.routes[r].type,r);
            } else {
                addRoute(source.route1SourceId,source.route1Type,0);
                addRoute(source.route2SourceId,source.route2Type,1);
            }
            plan.simple=plan.processCount==0 && plan.preCount==0 && plan.postCount==0;
        }
        ++generation;
    }
};
}
