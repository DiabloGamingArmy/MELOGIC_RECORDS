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
#include "OscillatorModule.h"
#include "modulation/Modulation.h"
#include <cstdint>
#include <array>
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
class Voice {
public:
    void prepare(double sampleRate) noexcept;
    void reset() noexcept;
    void start(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept;
    void retarget(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3,float glideSeconds,bool retriggerEnvelope) noexcept;
    void release(const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept;
    struct Samples {double left=0,right=0,mono=0;};
    Samples nextModules(const dsp::Wavetable&,const ModulationFrame&,float sustain,
                        const CompiledModulation&,const ModulationState&,
                        float pitchBendSemitones,float pitchBendNormalized,
                        float modWheel,float aftertouch) noexcept;
    VoiceInfo info() const noexcept;
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
        // Patch 08/19: route IDs are compiled to direct oscillator-slot indices.
        // -1 means no valid source. This removes O(module-count) ID searches
        // from every route evaluation on every rendered sample.
        int route1SourceIndex=-1;
        int route2SourceIndex=-1;
        OscillatorModuleId compiledRoute1SourceId=0;
        OscillatorModuleId compiledRoute2SourceId=0;
        bool routesValid=false;
        bool valid=false;
        void invalidate() noexcept {
            valid=false;routesValid=false;id=0;
            route1SourceIndex=-1;route2SourceIndex=-1;
            compiledRoute1SourceId=0;compiledRoute2SourceId=0;
        }
        void update(const OscillatorModuleState& m) noexcept {
            const float o=std::isfinite(m.octave)?m.octave:0.0f;
            const float s=std::isfinite(m.semitone)?m.semitone:0.0f;
            const float f=std::isfinite(m.fineCents)?m.fineCents:0.0f;
            const float d=std::isfinite(m.detuneCents)?std::clamp(m.detuneCents,0.0f,100.0f):0.0f;
            const float p=std::isfinite(m.pan)?std::clamp(m.pan,-1.0f,1.0f):0.0f;
            const float l=std::isfinite(m.level)?std::clamp(m.level,0.0f,1.0f):0.0f;
            const float b=std::isfinite(m.blend)?std::clamp(m.blend,0.0f,1.0f):0.0f;
            const unsigned u=std::clamp(m.unison,1u,maxUnisonVoices);
            const bool pitchChanged=!valid||id!=m.id||octave!=o||semitone!=s||fineCents!=f;
            const bool detuneChanged=!valid||id!=m.id||unison!=u||detuneCents!=d;
            const bool panChanged=!valid||id!=m.id||pan!=p;
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

        void compileRoutes(const OscillatorModuleState& module,
                           const std::array<OscillatorModuleId,maxOscillatorModules>& moduleIds) noexcept {
            if(routesValid &&
               compiledRoute1SourceId==module.route1SourceId &&
               compiledRoute2SourceId==module.route2SourceId) return;

            auto resolve=[&](OscillatorModuleId sourceId) noexcept {
                if(sourceId==0) return -1;
                for(std::size_t i=0;i<moduleIds.size();++i)
                    if(moduleIds[i]==sourceId) return static_cast<int>(i);
                return -1;
            };
            route1SourceIndex=resolve(module.route1SourceId);
            route2SourceIndex=resolve(module.route2SourceId);
            compiledRoute1SourceId=module.route1SourceId;
            compiledRoute2SourceId=module.route2SourceId;
            routesValid=true;
        }
    };
    std::array<ModuleOscillators, maxOscillatorModules> moduleOscillators_{};
    std::array<dsp::WavetableOscillator,maxOscillatorModules> moduleBlendCenters_{};
    std::array<OscillatorModuleId,maxOscillatorModules> moduleIds_{};
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
};
}
