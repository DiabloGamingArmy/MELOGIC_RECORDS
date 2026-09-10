// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-v26.0.0-osc-process-foundation
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
    float pan = 0.0f;
    float level = 0.7f;
    dsp::OscProcessType process1 = dsp::OscProcessType::BendPlus;
    float process1Amount = 0.0f;
    dsp::OscProcessType process2 = dsp::OscProcessType::Off;
    float process2Amount = 0.0f;
};

class OscillatorModuleBank {
public:
    static constexpr std::size_t capacity = 16;

    OscillatorModuleBank() noexcept {
        OscillatorModuleState s{};
        s.id=1; s.enabled=true;
        sanitize(s);
        writeSlotValues(0,s);
        slots_[0].id.store(1,std::memory_order_relaxed);
        slots_[0].enabled.store(true,std::memory_order_release);
        nextId_.store(2,std::memory_order_relaxed);
    }

    std::size_t count() const noexcept {
        std::size_t n=0;
        for(const auto& slot:slots_)
            if(slot.id.load(std::memory_order_acquire)!=0) ++n;
        return n;
    }

    std::array<OscillatorModuleState,capacity> snapshot() const noexcept {
        std::array<OscillatorModuleState,capacity> out{};
        for(std::size_t i=0;i<capacity;++i) out[i]=readSlot(i);
        // Stable creation order, independent of reused storage slots. OSC1 is first.
        std::sort(out.begin(),out.end(),[](const auto& a,const auto& b) {
            return a.id!=0 && (b.id==0 || a.id<b.id);
        });
        return out;
    }

    OscillatorModuleState state(OscillatorModuleId id) const noexcept {
        if(id==0) return {};
        for(std::size_t i=0;i<capacity;++i) {
            const auto s=readSlot(i);
            if(s.id==id) return s;
        }
        return {};
    }

    OscillatorModuleId add(const OscillatorModuleState& templateState={}) noexcept {
        // Non-realtime writers are serialized by the owner. Publish identity last.
        const auto newId=nextId_.load(std::memory_order_relaxed);
        if(newId==0 || newId==std::numeric_limits<OscillatorModuleId>::max()) return 0;
        for(std::size_t i=0;i<capacity;++i) {
            if(slots_[i].id.load(std::memory_order_acquire)!=0) continue;
            OscillatorModuleState s=templateState;
            s.id=newId; s.enabled=true;
            sanitize(s);
            writeSlotValues(i,s);
            slots_[i].enabled.store(true,std::memory_order_relaxed);
            slots_[i].id.store(newId,std::memory_order_release);
            nextId_.store(newId+1,std::memory_order_relaxed);
            return newId;
        }
        return 0;
    }

    bool remove(OscillatorModuleId id) noexcept {
        if(id==0 || id==1 || count()<=1) return false;
        for(auto& slot:slots_) {
            if(slot.id.load(std::memory_order_acquire)!=id) continue;
            slot.enabled.store(false,std::memory_order_release);
            slot.id.store(0,std::memory_order_release);
            return true;
        }
        return false;
    }

    bool setEnabled(OscillatorModuleId id,bool enabled) noexcept {
        if(id==0) return false;
        for(auto& slot:slots_) {
            if(slot.id.load(std::memory_order_acquire)!=id) continue;
            slot.enabled.store(enabled,std::memory_order_release);
            return true;
        }
        return false;
    }

    bool enabled(OscillatorModuleId id) const noexcept {
        if(id==0) return false;
        for(const auto& slot:slots_)
            if(slot.id.load(std::memory_order_acquire)==id)
                return slot.enabled.load(std::memory_order_acquire);
        return false;
    }

    bool set(OscillatorModuleId id,OscillatorModuleState state) noexcept {
        if(id==0) return false;
        sanitize(state);
        for(std::size_t i=0;i<capacity;++i) {
            if(slots_[i].id.load(std::memory_order_acquire)!=id) continue;
            state.id=id;
            writeSlotValues(i,state);
            return true;
        }
        return false;
    }

    OscillatorModuleId nextId() const noexcept { return nextId_.load(std::memory_order_relaxed); }
    // Exclusive, validated whole-instrument commit only (never in process()).
    void restore(const std::array<OscillatorModuleState,capacity>& states,OscillatorModuleId next) noexcept {
        for(std::size_t i=0;i<capacity;++i) {
            writeSlotValues(i,states[i]);
            slots_[i].enabled.store(states[i].id!=0 && states[i].enabled,std::memory_order_relaxed);
            slots_[i].id.store(states[i].id,std::memory_order_release);
        }
        nextId_.store(next,std::memory_order_relaxed);
    }
private:
    struct AtomicSlot {
        std::atomic<OscillatorModuleId> id{0};
        std::atomic<bool> enabled{false};
        std::atomic<dsp::WavetableId> tableId{dsp::BuiltinWavetableId::BasicShapes};
        std::atomic<float> wtPosition{0.0f};
        std::atomic<float> waveform{0},octave{0},semitone{0},fineCents{0};
        std::atomic<unsigned> unison{1};
        std::atomic<float> detuneCents{12},pan{0},level{0.7f};
        std::atomic<dsp::OscProcessType> process1{dsp::OscProcessType::BendPlus};
        std::atomic<float> process1Amount{0.0f};
        std::atomic<dsp::OscProcessType> process2{dsp::OscProcessType::Off};
        std::atomic<float> process2Amount{0.0f};
    };

    static void sanitize(OscillatorModuleState& s) noexcept {
        if(s.tableId==0) s.tableId=dsp::BuiltinWavetableId::BasicShapes;
        if(!std::isfinite(s.wtPosition)) s.wtPosition=0.0f;
        if(s.wtPosition<0) s.wtPosition=0;
        if(s.wtPosition>1) s.wtPosition=1;
        s.waveform=s.wtPosition*3.0f; // compatibility alias, never a second source of truth
        if(s.octave<-4) s.octave=-4;
        if(s.octave>4) s.octave=4;
        if(s.semitone<-12) s.semitone=-12;
        if(s.semitone>12) s.semitone=12;
        if(s.fineCents<-100) s.fineCents=-100;
        if(s.fineCents>100) s.fineCents=100;
        if(s.unison<1) s.unison=1;
        if(s.unison>16) s.unison=16;
        if(s.detuneCents<0) s.detuneCents=0;
        if(s.detuneCents>100) s.detuneCents=100;
        if(s.pan<-1) s.pan=-1;
        if(s.pan>1) s.pan=1;
        if(s.level<0) s.level=0;
        if(s.level>1) s.level=1;
        if(!dsp::validOscProcessType(s.process1)) s.process1=dsp::OscProcessType::Off;
        if(!dsp::validOscProcessType(s.process2)) s.process2=dsp::OscProcessType::Off;
        if(!std::isfinite(s.process1Amount)) s.process1Amount=0.0f;
        if(!std::isfinite(s.process2Amount)) s.process2Amount=0.0f;
        s.process1Amount=std::clamp(s.process1Amount,dsp::oscProcessAmountMinimum(s.process1),1.0f);
        s.process2Amount=std::clamp(s.process2Amount,dsp::oscProcessAmountMinimum(s.process2),1.0f);
    }

    OscillatorModuleState readSlot(std::size_t i) const noexcept {
        const auto& a=slots_[i];
        OscillatorModuleState s{};
        s.id=a.id.load(std::memory_order_acquire);
        if(s.id==0) return s;
        s.tableId=a.tableId.load(std::memory_order_relaxed);
        s.wtPosition=a.wtPosition.load(std::memory_order_relaxed);
        s.waveform=a.waveform.load(std::memory_order_relaxed);
        s.octave=a.octave.load(std::memory_order_relaxed);
        s.semitone=a.semitone.load(std::memory_order_relaxed);
        s.fineCents=a.fineCents.load(std::memory_order_relaxed);
        s.unison=a.unison.load(std::memory_order_relaxed);
        s.detuneCents=a.detuneCents.load(std::memory_order_relaxed);
        s.pan=a.pan.load(std::memory_order_relaxed);
        s.level=a.level.load(std::memory_order_relaxed);
        s.process1=a.process1.load(std::memory_order_relaxed);
        s.process1Amount=a.process1Amount.load(std::memory_order_relaxed);
        s.process2=a.process2.load(std::memory_order_relaxed);
        s.process2Amount=a.process2Amount.load(std::memory_order_relaxed);
        s.enabled=a.enabled.load(std::memory_order_acquire);
        return s;
    }

    void writeSlotValues(std::size_t i,const OscillatorModuleState& s) noexcept {
        auto& a=slots_[i];
        a.tableId.store(s.tableId,std::memory_order_relaxed);
        a.wtPosition.store(s.wtPosition,std::memory_order_relaxed);
        a.waveform.store(s.waveform,std::memory_order_relaxed);
        a.octave.store(s.octave,std::memory_order_relaxed);
        a.semitone.store(s.semitone,std::memory_order_relaxed);
        a.fineCents.store(s.fineCents,std::memory_order_relaxed);
        a.unison.store(s.unison,std::memory_order_relaxed);
        a.detuneCents.store(s.detuneCents,std::memory_order_relaxed);
        a.pan.store(s.pan,std::memory_order_relaxed);
        a.level.store(s.level,std::memory_order_relaxed);
        a.process1.store(s.process1,std::memory_order_relaxed);
        a.process1Amount.store(s.process1Amount,std::memory_order_relaxed);
        a.process2.store(s.process2,std::memory_order_relaxed);
        a.process2Amount.store(s.process2Amount,std::memory_order_relaxed);
    }

    std::array<AtomicSlot,capacity> slots_{};
    std::atomic<OscillatorModuleId> nextId_{1};
};

static_assert(std::atomic<float>::is_always_lock_free,
              "Origami oscillator module state requires lock-free float atomics");

}
