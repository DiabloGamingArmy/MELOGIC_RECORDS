// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-modulation-completion-v24
#pragma once
#include "core/OscillatorModule.h"
#include "core/dsp/Filter.h"
#include "core/dsp/Envelope.h"
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
namespace mct::origami {

enum class ModSource : std::uint32_t {
    Env1=1, Env2=2, Env3=3,
    Lfo1=101, Lfo2=102, Lfo3=103, Lfo4=104,
    Macro1=201, Macro2=202, Macro3=203, Macro4=204,
    ModWheel=301, Velocity=302, Keytrack=303, Aftertouch=304,
    PitchBend=305, NoteGate=306,
    Random=401, Function=501
};
enum class ModDestination : std::uint32_t {
    Cutoff=1, Resonance=2, MasterGain=3,
    WtPosition=101, Octave=102, Semitone=103, Fine=104, Detune=105, Pan=106, Level=107,
    Process1Amount=108, Process2Amount=109, Route1Amount=110, Route2Amount=111
};
enum class LfoShape : std::uint32_t { Sine=1, Triangle=2, Saw=3, Square=4 };
enum class LfoMode : std::uint32_t { Free=1, NoteRetrigger=2 };

struct LfoSettings { LfoShape shape=LfoShape::Sine; LfoMode mode=LfoMode::Free; float rateHz=1; };
struct RandomSettings { float rateHz=2.0f; };
struct FunctionSettings { float rateHz=1.0f; float curve=0.0f; };

struct ModAddress {
    ModDestination parameter=ModDestination::Cutoff;
    OscillatorModuleId oscillator=0;
    bool operator==(const ModAddress& o) const noexcept {return parameter==o.parameter && oscillator==o.oscillator;}
};
struct ModRoute {
    std::uint32_t id=0;
    bool enabled=true;
    ModSource source=ModSource::Lfo1;
    ModAddress destination{};
    float amount=0;
};
struct ModulationState {
    static constexpr std::size_t capacity=32;
    LfoSettings lfo1{},lfo2{},lfo3{},lfo4{};
    std::array<float,3> env1Curves{};
    dsp::EnvelopeSettings env2{},env3{};
    RandomSettings random{};
    FunctionSettings function{};
    std::array<float,4> macros{};
    std::array<ModRoute,capacity> routes{};
    std::uint32_t nextRouteId=1;

    // V32 runtime collection state. Existing DSP storage remains bounded at
    // 3 ENV / 4 LFO / 1 Filter while collection semantics come online.
    std::uint32_t envActiveMask=0x7u;
    std::uint32_t lfoActiveMask=0xFu;
    bool filterEnabled=true;
};

const LfoSettings& lfoSettings(const ModulationState&,std::size_t index) noexcept;
LfoSettings& lfoSettings(ModulationState&,std::size_t index) noexcept;

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

class RandomGenerator {
public:
    void reset() noexcept {phase_=0;state_=0x6d2b79f5u;value_=0;}
    float next(const RandomSettings&,double sampleRate) noexcept;
private:
    double phase_=0;
    std::uint32_t state_=0x6d2b79f5u;
    float value_=0;
};

class FunctionGenerator {
public:
    void reset() noexcept {phase_=0;}
    float next(const FunctionSettings&,double sampleRate) noexcept;
    static float shape(float curve,double phase) noexcept;
private: double phase_=0;
};

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
    bool filterEnabled=true;
    std::array<float,ModulationState::capacity> normalized{};
};

class CompiledModulation {
public:
    static constexpr std::size_t globalSourceCount=10;
    static constexpr std::size_t voiceSourceCount=13;
    static constexpr std::size_t sourceSlotCount=globalSourceCount+voiceSourceCount;
    void compile(const ModulationState&,const std::array<OscillatorModuleState,16>&,bool immediate=false) noexcept;
    void advance(float smoothing) noexcept;
    void globalFrame(ModulationFrame&,const std::array<float,globalSourceCount>&,double sampleRate) const noexcept;
    void voiceFrame(ModulationFrame&,const std::array<float,voiceSourceCount>&,double sampleRate) const noexcept;
    bool hasVoiceRoutes() const noexcept {return voiceCount_!=0;}
    std::size_t groupCount() const noexcept {return count_;}
private:
    struct Group {
        ModAddress address{};std::size_t slot=0;
        std::array<float,sourceSlotCount> weight{},target{};
    };
    static float read(const ModulationFrame&,const Group&) noexcept;
    static void write(ModulationFrame&,const Group&,float normalized) noexcept;
    std::array<Group,ModulationState::capacity> groups_{};
    std::array<std::size_t,ModulationState::capacity> voiceGroups_{};
    std::size_t count_=0,voiceCount_=0;
    bool voiceFilter_=false;
    bool filterEnabled_=true;
};
}
