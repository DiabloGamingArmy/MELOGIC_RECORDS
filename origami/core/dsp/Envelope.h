// mct-origami-v28.0.0-interactive-envelope-editor
#pragma once
#include <cstdint>
namespace mct::origami::dsp {
struct EnvelopeSettings {
    float attack=.01f, decay=.15f, sustain=.7f, release=.25f;
    float attackCurve=0.0f, decayCurve=0.0f, releaseCurve=0.0f;
};
class Envelope {
public:
    enum class Stage { Idle, Attack, Decay, Sustain, Release };
    void prepare(double sampleRate) noexcept;
    void reset() noexcept;
    void noteOn(const EnvelopeSettings& settings) noexcept;
    void noteOff(const EnvelopeSettings& settings) noexcept;
    float next(float sustain) noexcept;
    Stage stage() const noexcept { return stage_; }
    float value() const noexcept { return value_; }
private:
    void segment(Stage,float,float,float) noexcept;
    static float shape(float,float) noexcept;
    double sampleRate_=48000;
    Stage stage_=Stage::Idle;
    EnvelopeSettings settings_{};
    float value_=0,target_=0,startValue_=0,curve_=0;
    std::uint64_t remaining_=0,totalSamples_=0;
};
}
