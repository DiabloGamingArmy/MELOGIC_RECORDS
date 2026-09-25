// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v27.1.0-expanded-cross-osc-routing
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-v26.0.0-osc-process-foundation
// mct-origami-v33.1.2-osc-blend-engine
#pragma once
#include <array>
#include <algorithm>
#include <limits>
#include <atomic>
#include <cstddef>
#include <cstdint>

#include "dsp/WavetableBank.h"
#include <cmath>
namespace mct::origami {

using OscillatorModuleId = std::uint32_t;

enum class OscRouteType : std::uint32_t {
    // V27.0 serialized IDs — never renumber.
    Off=0,
    PhaseMod=1,
    FrequencyMod=2,
    RingMod=3,
    AmpMod=4,

    // V27.1 additions.
    Crossfade=5,
    WaveFold=6,
    LogicXor=7,
    PhaseSkew=8,
    RectifyMod=9,
    Count=10
};

constexpr bool validOscRouteType(OscRouteType type) noexcept {
    return static_cast<std::uint32_t>(type)<static_cast<std::uint32_t>(OscRouteType::Count);
}

inline constexpr std::array<OscRouteType,9> oscRouteTypes{{
    OscRouteType::PhaseMod,
    OscRouteType::FrequencyMod,
    OscRouteType::RingMod,
    OscRouteType::AmpMod,
    OscRouteType::Crossfade,
    OscRouteType::WaveFold,
    OscRouteType::LogicXor,
    OscRouteType::PhaseSkew,
    OscRouteType::RectifyMod
}};

inline const char* oscRouteShortName(OscRouteType type) noexcept {
    switch(type) {
        case OscRouteType::Off: return "OFF";
        case OscRouteType::PhaseMod: return "PD";
        case OscRouteType::FrequencyMod: return "FM";
        case OscRouteType::RingMod: return "RM";
        case OscRouteType::AmpMod: return "AM";
        case OscRouteType::Crossfade: return "XF";
        case OscRouteType::WaveFold: return "WF";
        case OscRouteType::LogicXor: return "XOR";
        case OscRouteType::PhaseSkew: return "PSK";
        case OscRouteType::RectifyMod: return "RECT";
        case OscRouteType::Count: break;
    }
    return "OFF";
}

inline const char* oscRouteName(OscRouteType type) noexcept {
    switch(type) {
        case OscRouteType::Off: return "Off";
        case OscRouteType::PhaseMod: return "PD - Phase Distort";
        case OscRouteType::FrequencyMod: return "FM - Frequency Modulate";
        case OscRouteType::RingMod: return "RM - Ring Modulate";
        case OscRouteType::AmpMod: return "AM - Amp Modulate";
        case OscRouteType::Crossfade: return "XF - Osc Crossfade";
        case OscRouteType::WaveFold: return "WF - Source Wavefold";
        case OscRouteType::LogicXor: return "XOR - Logic Mod";
        case OscRouteType::PhaseSkew: return "PSK - Phase Skew";
        case OscRouteType::RectifyMod: return "RECT - Rectify Mod";
        case OscRouteType::Count: break;
    }
    return "Off";
}

using OscProcessSlotId = std::uint32_t;
using OscRouteSlotId = std::uint32_t;
inline constexpr std::size_t maxOscProcesses = 8;
inline constexpr std::size_t maxOscRoutes = 8;

struct OscProcessSlot {
    OscProcessSlotId id = 0;
    dsp::OscProcessType type = dsp::OscProcessType::Off;
    float amount = 0.0f;
    std::uint32_t seed = 0;
};

struct OscRouteSlot {
    OscRouteSlotId id = 0;
    OscillatorModuleId sourceId = 0;
    OscRouteType type = OscRouteType::Off;
    float amount = 0.0f;
};

struct OscillatorModuleState {
    OscillatorModuleId id = 0;
    bool enabled = false;
    dsp::WavetableId tableId = dsp::BuiltinWavetableId::BasicShapes;
    float wtPosition = 0.0f;
    float waveform = 0.0f;
    float octave = 0.0f;
    float semitone = 0.0f;
    float fineCents = 0.0f;
    unsigned unison = 1;
    float detuneCents = 12.0f;
    float blend = 0.35f;
    float pan = 0.0f;
    float level = 0.7f;
    dsp::OscProcessType process1 = dsp::OscProcessType::BendPlus;
    float process1Amount = 0.0f;
    std::uint32_t process1Seed = 0x13579bdfu;
    dsp::OscProcessType process2 = dsp::OscProcessType::Off;
    float process2Amount = 0.0f;
    std::uint32_t process2Seed = 0x2468ace1u;

    // Two serial cross-oscillator routing slots.
    // sourceId==0 means no source / route disabled.
    OscillatorModuleId route1SourceId = 0;
    OscRouteType route1Type = OscRouteType::Off;
    float route1Amount = 0.0f;
    OscillatorModuleId route2SourceId = 0;
    OscRouteType route2Type = OscRouteType::Off;
    float route2Amount = 0.0f;

    // Dynamic collection foundation. The legacy two-slot fields remain
    // authoritative until the DSP/UI migration patches switch consumers over.
    // This lets old presets and the current engine remain bit-for-bit compatible
    // while subsequent patches adopt stable-ID collections incrementally.
    std::array<OscProcessSlot,maxOscProcesses> processes{};
    std::uint8_t processCount = 0;
    OscProcessSlotId nextProcessId = 1;
    std::array<OscRouteSlot,maxOscRoutes> routes{};
    std::uint8_t routeCount = 0;
    OscRouteSlotId nextRouteId = 1;
};

// mct-origami-deep-audit-p05-coherent-osc-generations
class OscillatorModuleBank {
public:
    static constexpr std::size_t capacity = 16;

    OscillatorModuleBank() noexcept {
        OscillatorModuleState s{};
        s.id=1; s.enabled=true;
        sanitize(s);
        model_.states[0]=s;
        model_.nextId=2;
        publish();
    }

    std::size_t count() const noexcept {
        std::size_t n=0;
        for(const auto& s:model_.states) if(s.id!=0) ++n;
        return n;
    }

    std::array<OscillatorModuleState,capacity> snapshot() const noexcept {
        auto out=model_.states;
        sortStates(out);
        return out;
    }

    bool consumeSnapshot(std::array<OscillatorModuleState,capacity>& out,
                         std::uint64_t& generation) noexcept {
        if(!(middle_.load(std::memory_order_acquire)&dirty)) return false;
        front_=middle_.exchange(front_,std::memory_order_acq_rel)&mask;
        out=published_[front_].states;
        generation=published_[front_].generation;
        return true;
    }

    OscillatorModuleState state(OscillatorModuleId id) const noexcept {
        if(id==0) return {};
        for(const auto& s:model_.states) if(s.id==id) return s;
        return {};
    }

    OscillatorModuleId add(const OscillatorModuleState& templateState={}) noexcept {
        const auto newId=model_.nextId;
        if(newId==0 || newId==std::numeric_limits<OscillatorModuleId>::max()) return 0;
        for(auto& slot:model_.states) {
            if(slot.id!=0) continue;
            auto s=templateState;
            s.id=newId; s.enabled=true;
            sanitize(s);
            slot=s;
            model_.nextId=newId+1;
            publish();
            return newId;
        }
        return 0;
    }

    bool remove(OscillatorModuleId id) noexcept {
        if(id==0 || id==1 || count()<=1) return false;
        for(auto& slot:model_.states) {
            if(slot.id!=id) continue;
            slot={};
            publish();
            return true;
        }
        return false;
    }

    bool setEnabled(OscillatorModuleId id,bool enabled) noexcept {
        if(id==0) return false;
        for(auto& slot:model_.states) {
            if(slot.id!=id) continue;
            slot.enabled=enabled;
            publish();
            return true;
        }
        return false;
    }

    bool enabled(OscillatorModuleId id) const noexcept {
        if(id==0) return false;
        for(const auto& slot:model_.states) if(slot.id==id) return slot.enabled;
        return false;
    }

    bool set(OscillatorModuleId id,OscillatorModuleState state) noexcept {
        if(id==0) return false;
        sanitize(state);
        for(auto& slot:model_.states) {
            if(slot.id!=id) continue;
            state.id=id;
            slot=state;
            publish();
            return true;
        }
        return false;
    }

    OscillatorModuleId nextId() const noexcept { return model_.nextId; }

    void restore(const std::array<OscillatorModuleState,capacity>& states,
                 OscillatorModuleId next) noexcept {
        model_.states=states;
        for(auto& state:model_.states) {
            if(state.id==0) { state={}; continue; }
            sanitize(state);
        }
        model_.nextId=next;
        publish();
    }

private:
    struct BankState {
        std::array<OscillatorModuleState,capacity> states{};
        OscillatorModuleId nextId=1;
        std::uint64_t generation=0;
    };

    static void sortStates(std::array<OscillatorModuleState,capacity>& states) noexcept {
        std::sort(states.begin(),states.end(),[](const auto& a,const auto& b) {
            return a.id!=0 && (b.id==0 || a.id<b.id);
        });
    }

    static void sanitize(OscillatorModuleState& s) noexcept {
        if(s.tableId==0) s.tableId=dsp::BuiltinWavetableId::BasicShapes;
        if(!std::isfinite(s.wtPosition)) s.wtPosition=0.0f;
        s.wtPosition=std::clamp(s.wtPosition,0.0f,1.0f);
        s.waveform=s.wtPosition*3.0f;
        s.octave=std::clamp(s.octave,-4.0f,4.0f);
        s.semitone=std::clamp(s.semitone,-12.0f,12.0f);
        s.fineCents=std::clamp(s.fineCents,-100.0f,100.0f);
        s.unison=std::clamp(s.unison,1u,16u);
        s.detuneCents=std::clamp(s.detuneCents,0.0f,100.0f);
        if(!std::isfinite(s.blend)) s.blend=0.35f;
        s.blend=std::clamp(s.blend,0.0f,1.0f);
        s.pan=std::clamp(s.pan,-1.0f,1.0f);
        s.level=std::clamp(s.level,0.0f,1.0f);
        if(!dsp::validOscProcessType(s.process1)) s.process1=dsp::OscProcessType::Off;
        if(!dsp::validOscProcessType(s.process2)) s.process2=dsp::OscProcessType::Off;
        if(!std::isfinite(s.process1Amount)) s.process1Amount=0.0f;
        if(!std::isfinite(s.process2Amount)) s.process2Amount=0.0f;
        s.process1Amount=std::clamp(s.process1Amount,dsp::oscProcessAmountMinimum(s.process1),1.0f);
        s.process2Amount=std::clamp(s.process2Amount,dsp::oscProcessAmountMinimum(s.process2),1.0f);
        if(!validOscRouteType(s.route1Type)) s.route1Type=OscRouteType::Off;
        if(!validOscRouteType(s.route2Type)) s.route2Type=OscRouteType::Off;
        if(!std::isfinite(s.route1Amount)) s.route1Amount=0.0f;
        if(!std::isfinite(s.route2Amount)) s.route2Amount=0.0f;
        s.route1Amount=std::clamp(s.route1Amount,-1.0f,1.0f);
        s.route2Amount=std::clamp(s.route2Amount,-1.0f,1.0f);
        if(s.route1Type==OscRouteType::Off) s.route1SourceId=0;
        if(s.route2Type==OscRouteType::Off) s.route2SourceId=0;

        // Keep collection storage bounded and internally valid. During the
        // migration the legacy slots are mirrored into an empty collection so
        // every existing oscillator immediately has stable process/route IDs.
        if(s.processCount>maxOscProcesses) s.processCount=maxOscProcesses;
        if(s.routeCount>maxOscRoutes) s.routeCount=maxOscRoutes;
        if(s.processCount==0) {
            if(s.process1!=dsp::OscProcessType::Off)
                s.processes[s.processCount++]={s.nextProcessId++,s.process1,s.process1Amount,s.process1Seed};
            if(s.process2!=dsp::OscProcessType::Off && s.processCount<maxOscProcesses)
                s.processes[s.processCount++]={s.nextProcessId++,s.process2,s.process2Amount,s.process2Seed};
        }
        for(std::size_t i=0;i<s.processCount;++i) {
            auto& p=s.processes[i];
            if(p.id==0) p.id=s.nextProcessId++;
            if(!dsp::validOscProcessType(p.type)) p.type=dsp::OscProcessType::Off;
            if(!std::isfinite(p.amount)) p.amount=0.0f;
            p.amount=std::clamp(p.amount,dsp::oscProcessAmountMinimum(p.type),1.0f);
            s.nextProcessId=std::max(s.nextProcessId,p.id+1);
        }
        if(s.routeCount==0) {
            if(s.route1Type!=OscRouteType::Off)
                s.routes[s.routeCount++]={s.nextRouteId++,s.route1SourceId,s.route1Type,s.route1Amount};
            if(s.route2Type!=OscRouteType::Off && s.routeCount<maxOscRoutes)
                s.routes[s.routeCount++]={s.nextRouteId++,s.route2SourceId,s.route2Type,s.route2Amount};
        }
        for(std::size_t i=0;i<s.routeCount;++i) {
            auto& r=s.routes[i];
            if(r.id==0) r.id=s.nextRouteId++;
            if(!validOscRouteType(r.type)) r.type=OscRouteType::Off;
            if(!std::isfinite(r.amount)) r.amount=0.0f;
            r.amount=std::clamp(r.amount,-1.0f,1.0f);
            if(r.type==OscRouteType::Off) r.sourceId=0;
            s.nextRouteId=std::max(s.nextRouteId,r.id+1);
        }
    }

    void publish() noexcept {
        auto generation=model_;
        sortStates(generation.states);
        generation.generation=++generationCounter_;
        published_[back_]=generation;
        back_=middle_.exchange(back_|dirty,std::memory_order_acq_rel)&mask;
    }

    static constexpr unsigned dirty=4,mask=3;
    BankState model_{};
    std::array<BankState,3> published_{};
    unsigned front_=0,back_=2;
    std::atomic<unsigned> middle_{1};
    std::uint64_t generationCounter_=0;
};


}
