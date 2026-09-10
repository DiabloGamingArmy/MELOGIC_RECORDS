// mct-origami-pitch-mod-real-v23.3
#pragma once
#include "core/OscillatorModule.h"
#include "core/dsp/Filter.h"
#include <array>
#include <atomic>
namespace mct::origami {
// Persisted identities: explicit values, independent of UI ordering/ParameterId.
enum class ModSource : std::uint32_t { Env1=1, Lfo1=101, Macro1=201, Macro2=202, Macro3=203, Macro4=204, ModWheel=301 };
enum class ModDestination : std::uint32_t {
    Cutoff=1, Resonance=2, MasterGain=3,
    WtPosition=101, Octave=102, Semitone=103, Fine=104, Detune=105, Pan=106, Level=107
};
enum class LfoShape : std::uint32_t { Sine=1, Triangle=2, Saw=3, Square=4 };
enum class LfoMode : std::uint32_t { Free=1, NoteRetrigger=2 };
struct LfoSettings { LfoShape shape=LfoShape::Sine; LfoMode mode=LfoMode::Free; float rateHz=1; };
struct ModAddress {
    ModDestination parameter=ModDestination::Cutoff;
    OscillatorModuleId oscillator=0; // zero only for global destinations
    bool operator==(const ModAddress& o) const noexcept {return parameter==o.parameter && oscillator==o.oscillator;}
};
struct ModRoute {
    std::uint32_t id=0;
    bool enabled=true;
    ModSource source=ModSource::Lfo1;
    ModAddress destination{};
    float amount=0; // signed fraction of destination's normalized range
};
struct ModulationState {
    static constexpr std::size_t capacity=32;
    LfoSettings lfo1{};
    std::array<float,4> macros{};
    std::array<ModRoute,capacity> routes{}; // ordered nonzero IDs followed by empty entries
    std::uint32_t nextRouteId=1;
};
bool isGlobalDestination(ModDestination) noexcept;
bool validModulation(const ModulationState&,const std::array<OscillatorModuleState,16>&) noexcept;
float modulationToNormalized(ModDestination,float) noexcept;
float modulationFromNormalized(ModDestination,float) noexcept;
class Lfo {
public:
    void reset() noexcept {phase_=0;}
    float next(const LfoSettings&,double sampleRate) noexcept;
    static float shape(LfoShape,double phase) noexcept;
private: double phase_=0;
};
// Single serialized producer, single audio consumer. Ownership exchange, not a
// seqlock: plain payloads are never concurrently read/written; no retry loops.
template<class T> class LatestStateMailbox {
public:
    void publish(const T& state) noexcept {
        slots_[back_]=state;
        back_=middle_.exchange(back_|dirty,std::memory_order_acq_rel)&mask;
    }
    bool consume(T& state) noexcept {
        if(!(middle_.load(std::memory_order_acquire)&dirty)) return false;
        front_=middle_.exchange(front_,std::memory_order_acq_rel)&mask;
        state=slots_[front_];return true;
    }
private:
    static constexpr unsigned dirty=4,mask=3;
    std::array<T,3> slots_{};
    unsigned front_=0,back_=2;
    std::atomic<unsigned> middle_{1};
};
struct ModulationFrame {
    std::array<OscillatorModuleState,16> modules{};
    float cutoff=8000,resonance=.1f,master=.2f;
    dsp::LowPassCoefficients filter{};
    // Unclamped base + global sum. Voice sources add before the only clamp.
    std::array<float,ModulationState::capacity> normalized{};
};
class CompiledModulation {
public:
    void compile(const ModulationState&,const std::array<OscillatorModuleState,16>&,bool immediate=false) noexcept;
    void advance(float smoothing) noexcept;
    void globalFrame(ModulationFrame&,const std::array<float,5>& sources,double sampleRate) const noexcept;
    void voiceFrame(ModulationFrame&,float envelope,float lfo,float modWheel,double sampleRate) const noexcept;
    bool hasVoiceRoutes() const noexcept {return voiceCount_!=0;}
    std::size_t groupCount() const noexcept {return count_;}
private:
    struct Group {
        ModAddress address{};std::size_t slot=0;
        // LFO global, macros 1-4, ENV1, LFO per-note.
        std::array<float,8> weight{},target{};
    };
    static float read(const ModulationFrame&,const Group&) noexcept;
    static void write(ModulationFrame&,const Group&,float normalized) noexcept;
    std::array<Group,ModulationState::capacity> groups_{};
    std::array<std::size_t,ModulationState::capacity> voiceGroups_{};
    std::size_t count_=0,voiceCount_=0;
    bool voiceFilter_=false;
};
}
