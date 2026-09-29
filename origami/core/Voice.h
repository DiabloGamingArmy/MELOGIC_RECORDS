// mct-origami-audio-reengineer-p11-full-wrapper-rt-guard
// mct-origami-audio-reengineer-p08-compiled-route-indices
// mct-origami-audio-reengineer-p07-prepared-oscillator-modules
// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-modulation-completion-v24.0.1
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-v33.1.2-osc-blend-engine
#pragma once
#include "dsp/Wavetable.h"
#include "dsp/Envelope.h"
#include "dsp/Filter.h"
#include "OscillatorRenderPlan.h"
#include "modulation/Modulation.h"
#include <cstdint>
#include <array>
#include <functional>
#include <cmath>
#include <algorithm>
namespace mct::origami {
struct NoteAddress { int note = 60; std::uint8_t channel = 0; std::uint32_t noteId = 0; };
struct EnvelopeRuntimeInfo {
    dsp::Envelope::Stage stage=dsp::Envelope::Stage::Idle;
    float progress=0.0f;
    float value=0.0f;
};
struct VoiceInfo {
    NoteAddress address{};
    std::uint64_t order=0;
    bool active=false,releasing=false;
    float envelope=0.0f;
    std::array<EnvelopeRuntimeInfo,3> envelopes{};
};
struct EnvelopeTraceSnapshot {
    bool active=false;
    std::uint64_t order=0;
    std::array<EnvelopeRuntimeInfo,3> envelopes{};
};
struct PerformanceInputSnapshot {
    std::uint64_t heldLow=0,heldHigh=0;
    std::array<std::uint8_t,128> velocity{};
};
struct VoiceHotPathProfile {
    std::uint64_t samples=0;
    std::uint64_t moduleIterations=0;
    std::uint64_t oscillatorCalls=0;
    std::uint64_t envelopeNs=0;
    std::uint64_t modulationNs=0;
    std::uint64_t prepareNs=0;
    std::uint64_t preRouteNs=0;
    std::uint64_t oscillatorNs=0;
    std::uint64_t postRouteNs=0;
    std::uint64_t filterNs=0;
    std::uint64_t accumulateNs=0;
};
struct VoiceVisualizationSnapshot {
    std::array<float,13> sources{};
    std::array<float,4> lfoPhases{};
    std::array<float,16> moduleSamples{};
    std::array<float,16> modulePhases{};
    std::array<OscillatorModuleState,16> modules{};
};
class Voice {
public:
    void prepare(double sampleRate) noexcept;
    void reset() noexcept;
    void start(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept;
    void retarget(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3,float glideSeconds,bool retriggerEnvelope) noexcept;
    void release(const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept;
    struct Samples {double left=0,right=0,mono=0;};
    Samples nextModules(const std::array<const dsp::Wavetable*,16>&,const ModulationFrame&,float sustain,
                        const CompiledModulation&,const ModulationState&,
                        float pitchBendSemitones,float pitchBendNormalized,
                        float modWheel,float aftertouch,const OscillatorRenderPlan&,const OscillatorProcessPlans&,bool observe=true) noexcept;
    VoiceInfo info() const noexcept;
    bool active() const noexcept { return active_; }
    std::uint64_t order() const noexcept { return order_; }
    std::uint8_t channel() const noexcept { return address_.channel; }
    const VoiceVisualizationSnapshot& visualizationSnapshot() const noexcept { return visualization_; }
    const VoiceHotPathProfile& hotPathProfile() const noexcept { return hotPathProfile_; }
    void clearHotPathProfile() noexcept { hotPathProfile_={}; }
private:
    // mct-origami-unison-detune-v19.2
    static constexpr unsigned maxOscillatorModules = 16;
    static constexpr unsigned maxUnisonVoices = 16;
    using ModuleOscillators = std::array<dsp::WavetableOscillator, maxUnisonVoices>;
    // Patch 07/19: fixed-size prepared oscillator representation.
    struct PreparedOscillatorModule {
        OscillatorModuleId id=0;
        float octave=0,semitone=0,fineCents=0,detuneCents=0,pan=0,level=0,blend=0;
        unsigned unison=0;
        double pitchScale=1.0;
        float panLeft=0.70710678f,panRight=0.70710678f;
        std::array<double,maxUnisonVoices> detuneRatios{};
        bool valid=false;
        void invalidate() noexcept { valid=false;id=0; }
        void update(const OscillatorModuleState& m) noexcept {
            const float o=std::isfinite(m.octave)?m.octave:0.0f;
            const float s=std::isfinite(m.semitone)?m.semitone:0.0f;
            const float f=std::isfinite(m.fineCents)?m.fineCents:0.0f;
            const float d=std::isfinite(m.detuneCents)?std::clamp(m.detuneCents,0.0f,100.0f):0.0f;
            const float p=std::isfinite(m.pan)?std::clamp(m.pan,-1.0f,1.0f):0.0f;
            const float l=std::isfinite(m.level)?std::clamp(m.level,0.0f,1.0f):0.0f;
            const float b=std::isfinite(m.blend)?std::clamp(m.blend,0.0f,1.0f):0.0f;
            const unsigned u=std::clamp(m.unison,1u,maxUnisonVoices);
            // Patch 11/19 FIX1: these sanitized cache inputs are finite and
            // canonicalized before comparison. Exact value comparison is the
            // intended dirty-state rule; spell it through std::equal_to so the
            // project remains C++17-compatible without -Wfloat-equal noise.
            const auto changed=[](float lhs,float rhs) noexcept {
                return !std::equal_to<float>{}(lhs,rhs);
            };
            const bool pitchChanged=!valid||id!=m.id||changed(octave,o)||changed(semitone,s)||changed(fineCents,f);
            const bool detuneChanged=!valid||id!=m.id||unison!=u||changed(detuneCents,d);
            const bool panChanged=!valid||id!=m.id||changed(pan,p);
            if(pitchChanged) pitchScale=std::exp2((double(o)*12.0+double(s)+double(f)/100.0)/12.0);
            if(detuneChanged) {
                detuneRatios.fill(1.0);
                if(u>1u) for(unsigned i=0;i<u;++i) {
                    const double unit=(2.0*double(i)/double(u-1u))-1.0;
                    detuneRatios[i]=std::exp2((unit*double(d))/1200.0);
                }
            }
            if(panChanged) {
                const double angle=(double(p)+1.0)*0.78539816339744830962;
                panLeft=float(std::cos(angle));panRight=float(std::sin(angle));
            }
            id=m.id;octave=o;semitone=s;fineCents=f;detuneCents=d;pan=p;
            level=l;blend=b;unison=u;valid=true;
        }

    };

    std::array<ModuleOscillators, maxOscillatorModules> moduleOscillators_{};
    std::array<dsp::WavetableOscillator,maxOscillatorModules> moduleBlendCenters_{};
    std::array<OscillatorModuleId,maxOscillatorModules> moduleIds_{};
    std::uint64_t topologyGeneration_=0;
    std::array<PreparedOscillatorModule,maxOscillatorModules> preparedModules_{};

    // One-sample-delayed oscillator taps used for cross-osc routing.
    // The delay guarantees deterministic routing with no oscillator-order
    // dependency and prevents algebraic feedback loops.
    std::array<float,maxOscillatorModules> previousOscillatorSamples_{};

    dsp::Envelope envelope_,env2_,env3_;
    std::array<Lfo,4> noteLfos_{};
    std::array<dsp::LowPassFilter,maxOscillatorModules> moduleFilters_{};
    NoteAddress address_ {};
    std::uint64_t order_ = 0;
    double sampleRate_ = 48000, frequency_ = 440, targetFrequency_ = 440, glideRatio_ = 1;
    std::size_t glideRemaining_ = 0;
    float velocity_ = 0;
    bool active_ = false, releasing_ = false;
    // Reuse storage; default construction of this large editable-state snapshot
    // must not run for every voice/sample when no voice modulation is present.
    ModulationFrame localFrame_{};
    dsp::OscProcessPlan processScratch_{};
    VoiceVisualizationSnapshot visualization_{};
    VoiceHotPathProfile hotPathProfile_{};
};
}
