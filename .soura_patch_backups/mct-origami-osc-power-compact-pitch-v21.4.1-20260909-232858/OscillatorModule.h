#pragma once
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>

namespace mct::origami {

using OscillatorModuleId = std::uint32_t;

struct OscillatorModuleState {
    OscillatorModuleId id = 0;
    bool enabled = false;
    float waveform = 0.0f;
    float octave = 0.0f;
    float semitone = 0.0f;
    float fineCents = 0.0f;
    unsigned unison = 1;
    float detuneCents = 12.0f;
    float pan = 0.0f;
    float level = 0.7f;
};

class OscillatorModuleBank {
public:
    static constexpr std::size_t capacity = 16;

    OscillatorModuleBank() noexcept {
        writeSlot(0, OscillatorModuleState{1,true,1.0f,0,0,0,1,12.0f,0,0.7f});
        nextId_.store(2,std::memory_order_relaxed);
    }

    std::size_t count() const noexcept {
        std::size_t n=0;
        for(const auto& slot:slots_)
            if(slot.enabled.load(std::memory_order_acquire)) ++n;
        return n;
    }

    std::array<OscillatorModuleState,capacity> snapshot() const noexcept {
        std::array<OscillatorModuleState,capacity> out{};
        for(std::size_t i=0;i<capacity;++i) out[i]=readSlot(i);
        return out;
    }

    OscillatorModuleState state(OscillatorModuleId id) const noexcept {
        for(std::size_t i=0;i<capacity;++i) {
            const auto s=readSlot(i);
            if(s.enabled && s.id==id) return s;
        }
        return {};
    }

    OscillatorModuleId add(const OscillatorModuleState& templateState={}) noexcept {
        for(std::size_t i=0;i<capacity;++i) {
            bool expected=false;
            if(!slots_[i].enabled.compare_exchange_strong(expected,true,std::memory_order_acq_rel))
                continue;
            OscillatorModuleState s=templateState;
            s.id=nextId_.fetch_add(1,std::memory_order_relaxed);
            s.enabled=true;
            sanitize(s);
            writeSlotValues(i,s);
            slots_[i].id.store(s.id,std::memory_order_release);
            return s.id;
        }
        return 0;
    }

    bool remove(OscillatorModuleId id) noexcept {
        if(id==1 || count()<=1) return false;
        for(auto& slot:slots_) {
            if(!slot.enabled.load(std::memory_order_acquire)) continue;
            if(slot.id.load(std::memory_order_acquire)!=id) continue;
            slot.enabled.store(false,std::memory_order_release);
            return true;
        }
        return false;
    }

    bool set(OscillatorModuleId id, OscillatorModuleState state) noexcept {
        sanitize(state);
        for(std::size_t i=0;i<capacity;++i) {
            if(!slots_[i].enabled.load(std::memory_order_acquire)) continue;
            if(slots_[i].id.load(std::memory_order_acquire)!=id) continue;
            state.id=id; state.enabled=true;
            writeSlotValues(i,state);
            return true;
        }
        return false;
    }

private:
    struct AtomicSlot {
        std::atomic<OscillatorModuleId> id{0};
        std::atomic<bool> enabled{false};
        std::atomic<float> waveform{0},octave{0},semitone{0},fineCents{0};
        std::atomic<unsigned> unison{1};
        std::atomic<float> detuneCents{12},pan{0},level{0.7f};
    };

    static void sanitize(OscillatorModuleState& s) noexcept {
        if(s.waveform<0) s.waveform=0; if(s.waveform>3) s.waveform=3;
        if(s.octave<-4) s.octave=-4; if(s.octave>4) s.octave=4;
        if(s.semitone<-12) s.semitone=-12; if(s.semitone>12) s.semitone=12;
        if(s.fineCents<-100) s.fineCents=-100; if(s.fineCents>100) s.fineCents=100;
        if(s.unison<1) s.unison=1; if(s.unison>16) s.unison=16;
        if(s.detuneCents<0) s.detuneCents=0; if(s.detuneCents>100) s.detuneCents=100;
        if(s.pan<-1) s.pan=-1; if(s.pan>1) s.pan=1;
        if(s.level<0) s.level=0; if(s.level>1) s.level=1;
    }

    OscillatorModuleState readSlot(std::size_t i) const noexcept {
        const auto& a=slots_[i];
        OscillatorModuleState s;
        s.enabled=a.enabled.load(std::memory_order_acquire);
        if(!s.enabled) return s;
        s.id=a.id.load(std::memory_order_acquire);
        s.waveform=a.waveform.load(std::memory_order_relaxed);
        s.octave=a.octave.load(std::memory_order_relaxed);
        s.semitone=a.semitone.load(std::memory_order_relaxed);
        s.fineCents=a.fineCents.load(std::memory_order_relaxed);
        s.unison=a.unison.load(std::memory_order_relaxed);
        s.detuneCents=a.detuneCents.load(std::memory_order_relaxed);
        s.pan=a.pan.load(std::memory_order_relaxed);
        s.level=a.level.load(std::memory_order_relaxed);
        return s;
    }

    void writeSlotValues(std::size_t i,const OscillatorModuleState& s) noexcept {
        auto& a=slots_[i];
        a.waveform.store(s.waveform,std::memory_order_relaxed);
        a.octave.store(s.octave,std::memory_order_relaxed);
        a.semitone.store(s.semitone,std::memory_order_relaxed);
        a.fineCents.store(s.fineCents,std::memory_order_relaxed);
        a.unison.store(s.unison,std::memory_order_relaxed);
        a.detuneCents.store(s.detuneCents,std::memory_order_relaxed);
        a.pan.store(s.pan,std::memory_order_relaxed);
        a.level.store(s.level,std::memory_order_relaxed);
    }

    void writeSlot(std::size_t i,OscillatorModuleState s) noexcept {
        sanitize(s); writeSlotValues(i,s);
        slots_[i].id.store(s.id,std::memory_order_relaxed);
        slots_[i].enabled.store(s.enabled,std::memory_order_release);
    }

    std::array<AtomicSlot,capacity> slots_{};
    std::atomic<OscillatorModuleId> nextId_{1};
};

static_assert(std::atomic<float>::is_always_lock_free,
              "Origami oscillator module state requires lock-free float atomics");

}
