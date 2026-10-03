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
#include "dsp/FastMath.h"
#include "dsp/OscillatorControlCache.h"
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
struct VoiceVisualizationSnapshot {
    std::array<float,13> sources{};
    std::array<float,4> lfoPhases{};
    std::array<float,16> moduleSamples{};
    std::array<float,operatorOutputSlotCount> operators{}; // N04/N06 operator outputs, slot*4+port (this voice)
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
    // mct-origami-fx-modulation-graph-ux-p03: latest per-voice sources, kept
    // only while FX destinations use voice sources (newest-voice policy).
    const std::array<float,CompiledModulation::voiceSourceCount>& lastSources() const noexcept { return lastSources_; }
    const std::array<std::uint32_t,CompiledModulation::operatorSlotCount>& operatorEventCounts() const noexcept { return operatorEventCounts_; }
    // mct-origami-unified-routing-core-fx-p04: user-bus outputs of the last
    // sample (L/R per user bus slot 1..7). Valid only while the plan's
    // auxActive is set; zeroed every sample in that case.
    using AuxSamples=std::array<float,2*(maxRenderBuses-1)>;
    const AuxSamples& aux() const noexcept { return aux_; }
private:
    AuxSamples aux_{};
    std::array<float,CompiledModulation::voiceSourceCount> lastSources_{};
    CompiledModulation::OperatorState operatorState_{}; // N04: this voice's operator state (SMOOTH)
    // N05: note events raised by start / retarget / release, consumed at this
    // voice's next sample (the exact MIDI sample: hosts split at event offsets).
    bool pendingNoteOn_=false,pendingNoteOff_=false,pendingRetrigger_=false;
    std::array<std::uint32_t,CompiledModulation::operatorSlotCount> operatorEventCounts_{}; // monitoring only
    // mct-origami-unison-detune-v19.2
    static constexpr unsigned maxOscillatorModules = 16;
    static constexpr unsigned maxUnisonVoices = 16;
    using ModuleOscillators = std::array<dsp::WavetableOscillator, maxUnisonVoices>;
    // Realtime oscillator cache: only genuinely derived state is retained.
    // Continuous level/blend values are consumed directly from the modulation
    // frame; exact-input pitch/pan caches retain only derived math results.
    struct OscillatorRuntimeState {
        OscillatorModuleId id=0;
        float detuneCents=0.0f;
        unsigned unison=0;
        std::array<double,maxUnisonVoices> detuneRatios{};
        dsp::OscillatorControlCache controls;

        void invalidate() noexcept {
            id=0;detuneCents=0.0f;unison=0;
            detuneRatios.fill(1.0);
            controls.invalidate();
        }

        void prepareDetune(OscillatorModuleId moduleId,unsigned count,float cents) noexcept {
            const unsigned sanitizedCount=std::clamp(count,1u,maxUnisonVoices);
            const float sanitizedCents=std::isfinite(cents)
                ? std::clamp(cents,0.0f,100.0f) : 0.0f;
            if(id==moduleId && unison==sanitizedCount &&
               std::equal_to<float>{}(detuneCents,sanitizedCents)) return;

            id=moduleId;unison=sanitizedCount;detuneCents=sanitizedCents;
            detuneRatios.fill(1.0);
            if(unison>1u) for(unsigned i=0;i<unison;++i) {
                const double unit=(2.0*static_cast<double>(i)/static_cast<double>(unison-1u))-1.0;
                detuneRatios[i]=dsp::fastExp2Audio(
                    (unit*static_cast<double>(detuneCents))/1200.0);
            }
        }
    };

    std::array<ModuleOscillators, maxOscillatorModules> moduleOscillators_{};
    std::array<dsp::WavetableOscillator,maxOscillatorModules> moduleBlendCenters_{};
    std::array<OscillatorModuleId,maxOscillatorModules> moduleIds_{};
    std::uint64_t topologyGeneration_=0;
    std::array<OscillatorRuntimeState,maxOscillatorModules> oscillatorRuntime_{};

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
};
}
