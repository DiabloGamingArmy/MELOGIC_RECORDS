#pragma once
#include <cstdint>
namespace mct::origami::dsp {
struct EnvelopeSettings { float attack=.01f, decay=.15f, sustain=.7f, release=.25f; };
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
    void segment(Stage stage, float target, float seconds) noexcept;
    double sampleRate_ = 48000;
    Stage stage_ = Stage::Idle;
    EnvelopeSettings settings_ {};
    float value_ = 0, target_ = 0;
    double increment_ = 0, preciseValue_ = 0;
    std::uint64_t remaining_ = 0;
};
}
