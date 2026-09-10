#pragma once
#include <array>
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
    float level = 0.8f;
};
class OscillatorModuleBank {
public:
    static constexpr std::size_t capacity = 16;
    OscillatorModuleBank() noexcept { slots_[0].id=1; slots_[0].enabled=true; nextId_=2; }
    std::size_t count() const noexcept { std::size_t n=0; for(const auto& s:slots_) if(s.enabled) ++n; return n; }
    const std::array<OscillatorModuleState,capacity>& slots() const noexcept { return slots_; }
    std::array<OscillatorModuleState,capacity>& slots() noexcept { return slots_; }
    OscillatorModuleId add() noexcept {
        for(auto& slot:slots_) {
            if(slot.enabled) continue;
            slot={}; slot.id=nextId_++; slot.enabled=true; slot.level=.8f; slot.unison=1; slot.detuneCents=12.f; return slot.id;
        }
        return 0;
    }
    bool remove(OscillatorModuleId id) noexcept {
        if(count()<=1) return false;
        for(auto& slot:slots_) if(slot.enabled && slot.id==id) { slot.enabled=false; return true; }
        return false;
    }
    OscillatorModuleState* find(OscillatorModuleId id) noexcept { for(auto& s:slots_) if(s.enabled&&s.id==id) return &s; return nullptr; }
    const OscillatorModuleState* find(OscillatorModuleId id) const noexcept { for(const auto& s:slots_) if(s.enabled&&s.id==id) return &s; return nullptr; }
private:
    std::array<OscillatorModuleState,capacity> slots_{};
    OscillatorModuleId nextId_=1;
};
}
