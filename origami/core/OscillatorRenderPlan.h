#pragma once
#include "OscillatorModule.h"

namespace mct::origami {
using OscillatorProcessPlans=std::array<dsp::OscProcessPlan,16>;
// Compiled at a host-block boundary and shared by all voices. Only amounts
// change at audio rate; IDs, enabled flags, types and ordering are topology.
struct OscillatorRenderPlan {
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
        dsp::OscProcessPlan processTemplate{};
    };
    std::array<Module,16> modules{};
    std::array<OscillatorModuleId,16> ids{};
    std::array<std::uint8_t,16> active{};
    std::size_t activeCount=0;
    std::uint64_t generation=0;

    void processPlan(std::size_t m,const OscillatorModuleState& source,dsp::OscProcessPlan& out) const noexcept {
        const auto& plan=modules[m];
        out=plan.processTemplate;
        for(std::size_t p=0;p<plan.processCount;++p) {
            const auto slot=plan.processes[p];
            out.stages[p].amount=plan.dynamicProcesses ? source.processes[slot].amount
                : (slot==0 ? source.process1Amount : source.process2Amount);
        }
    }

    void compile(const std::array<OscillatorModuleState,16>& state) noexcept {
        activeCount=0;
        for(std::size_t m=0;m<state.size();++m) ids[m]=state[m].id;
        for(std::size_t m=0;m<state.size();++m) {
            const auto& source=state[m];auto& plan=modules[m];plan={};
            if(!source.id || !source.enabled) continue;
            active[activeCount++]=static_cast<std::uint8_t>(m);
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
        }
        ++generation;
    }
};
}
