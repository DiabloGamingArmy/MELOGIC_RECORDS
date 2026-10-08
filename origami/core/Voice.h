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
    std::array<SynthFilterValues,maxSynthFilters> synthFilters{};
    std::array<SynthFilterId,maxSynthFilters> synthFilterIds{};
    std::array<float,CompiledModulation::voiceSourceCount> sources{};
    std::array<float,maxSourceInstances> instancePhases{};
    std::array<EnvelopeRuntimeInfo,maxSourceInstances> instanceEnvelopes{};
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
    void start(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3,std::uint8_t graphOwnedEnvelopes=0) noexcept;
    void retarget(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3,float glideSeconds,bool retriggerEnvelope,std::uint8_t graphOwnedEnvelopes=0) noexcept;
    void release(const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept;
    struct Samples {double left=0,right=0,mono=0;};
    Samples nextModules(const std::array<const dsp::Wavetable*,16>&,const ModulationFrame&,float sustain,
                        const CompiledModulation&,const ModulationState&,
                        float pitchBendSemitones,float pitchBendNormalized,
                        float modWheel,float aftertouch,const OscillatorRenderPlan&,const OscillatorProcessPlans&,bool observe=true) noexcept;
private:
    template<bool Stereo,bool Synth>
    Samples render(const std::array<const dsp::Wavetable*,16>&,const ModulationFrame&,float sustain,
                   const CompiledModulation&,const ModulationState&,float pitchBendSemitones,float pitchBendNormalized,
                   float modWheel,float aftertouch,const OscillatorRenderPlan&,const OscillatorProcessPlans&,bool observe) noexcept;
public:
    VoiceInfo info() const noexcept;
    void setSlot(std::uint32_t slot) noexcept { slot_=slot; }
    void restartLifecycles() noexcept { lifecycle_=0; } // engine reset: renders repeat
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
    std::array<SynthFilterRuntime,maxSynthFilters> synthFilterRuntime_{};
    float filterSmoothing_=1;
    dsp::EnvelopeSettings ampSettings_{};   // ENV 1 settings of the current note (graph triggers reuse them)
    bool oneShotRelease_=false;             // a graph trigger after release: release when it reaches sustain
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

    struct InstanceRuntime {
        std::uint32_t id=0; dsp::Envelope envelope{}; Lfo lfo{};
    };
    std::array<InstanceRuntime,maxSourceInstances> instanceRuntime_{};
    std::array<std::uint8_t,maxSourceInstances> instanceSlots_{};
    std::size_t instanceCount_=0;
    std::uint64_t instanceRevision_=~std::uint64_t{0};
    bool instanceRetrigger_=false;
    dsp::Envelope envelope_,env2_,env3_;
    std::array<Lfo,4> noteLfos_{};
    std::array<dsp::LowPassFilter,maxOscillatorModules> moduleFilters_{};
    NoteAddress address_ {};
    std::uint64_t order_ = 0;
    double sampleRate_ = 48000, frequency_ = 440, targetFrequency_ = 440, glideRatio_ = 1;
    std::size_t glideRemaining_ = 0;
    float velocity_ = 0;
    // N07 per-voice RNG: slot index (engine-assigned) and the number of note
    // lifecycles started on this slot since the engine reset. A stolen or
    // retriggered voice starts a NEW stream; identical renders repeat exactly.
    std::uint32_t slot_=0,lifecycle_=0;
    void seedLfos() noexcept;
    std::uint32_t voiceSeed() const noexcept { return (slot_+1u)*0x27d4eb2fu ^ (lifecycle_*0x165667b1u+0x5bd1e995u); }
    // N07: velocity / note curve values are constant for a note: cached and
    // recomputed only when the note, velocity or modulation state changes.
    struct CurveCache { float input=-1.0f,value=0.0f; std::uint64_t revision=~std::uint64_t{0}; };
    CurveCache velocityCurve_{},noteCurve_{};
    bool active_ = false, releasing_ = false;
    // Reuse storage; default construction of this large editable-state snapshot
    // must not run for every voice/sample when no voice modulation is present.
    alignas(64) ModulationFrame localFrame_{}; // aligned: its module copies run every sample
    dsp::OscProcessPlan processScratch_{};
    VoiceVisualizationSnapshot visualization_{};
    // mct-origami-stereo-modulation: RIGHT's filter state, cold data kept at the end of the voice (the mono hot
    // members keep their layout); used only while a
    // module's CUTOFF / RESONANCE differ between channels (bit m live).
    std::array<dsp::LowPassFilter,maxOscillatorModules> moduleFiltersRight_{};
    std::uint16_t rightFilterLive_=0;
    // mct-origami-dsp-performance-stereo-chain: RIGHT's spectral read hints per
    // module (a stereo OSC CHAIN reads a second spectral table key). Cold.
    std::array<std::array<dsp::SpectralReadHint,4>,maxOscillatorModules> rightSpectralHints_{};
    // Wave 1: each oscillator's two random-spectral morph hints (the upper
    // prepared key), kept here, cold, so the hot oscillator state keeps its
    // stride. Bound to the oscillators in bindMorphHints() (prepare / reset).
    std::array<std::array<std::array<dsp::SpectralReadHint,2>,maxUnisonVoices>,maxOscillatorModules> morphHints_{};
    std::array<std::array<dsp::SpectralReadHint,2>,maxOscillatorModules> blendMorphHints_{};
    void bindMorphHints() noexcept;
    // mct-origami-nested-modulation-manual-qa: RIGHT cross-oscillator taps.
    // previousOscillatorSamples_ is LEFT; bit m of rightTapMask_ says module
    // m's RIGHT tap differs (then previousOscillatorSamplesRight_[m] holds
    // it), so a downstream PM / FM / PSK / RM / AM / XF / WF / XOR / RECT
    // consumes the source channel by channel. Bit m of rightPhaseModules_:
    // module m's oscillators run a separate RIGHT phase (stereo FM; kept
    // for the rest of the note, so RIGHT never jumps back). Cold.
    std::array<float,maxOscillatorModules> previousOscillatorSamplesRight_{};
    std::uint16_t rightTapMask_=0,rightPhaseModules_=0;
    template<bool Stereo> void runVoiceProgram(const CompiledModulation&,const ModulationState&,const ModulationFrame& global,
        ModulationFrame& local,std::array<float,CompiledModulation::voiceSourceCount>& voiceSources,
        StereoSourceValues& voiceStereo,float sourceLfoScale,bool observe) noexcept;
    float rightTap(std::size_t source) const noexcept {
        return ((rightTapMask_>>source)&1u) ? previousOscillatorSamplesRight_[source] : previousOscillatorSamples_[source];
    }
};
}
