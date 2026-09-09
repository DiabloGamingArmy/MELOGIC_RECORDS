#include "Envelope.h"
#include <algorithm>
#include <cmath>
namespace mct::origami::dsp {
void Envelope::prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; reset(); }
void Envelope::reset() noexcept { stage_ = Stage::Idle; value_ = target_ = 0; preciseValue_ = increment_ = 0; remaining_ = 0; }
void Envelope::segment(Stage stage, float target, float seconds) noexcept {
    stage_ = stage; target_ = target;
    remaining_ = static_cast<std::uint64_t>(std::max(1.0, std::round(seconds * sampleRate_)));
    preciseValue_ = value_; increment_ = (target_ - preciseValue_) / static_cast<double>(remaining_);
}
void Envelope::noteOn(const EnvelopeSettings& settings) noexcept { settings_ = settings; segment(Stage::Attack, 1, settings.attack); }
void Envelope::noteOff(const EnvelopeSettings& settings) noexcept {
    if (stage_ != Stage::Idle && stage_ != Stage::Release) segment(Stage::Release, 0, settings.release);
}
float Envelope::next(float sustain) noexcept {
    if (stage_ == Stage::Idle) return 0;
    if (stage_ == Stage::Sustain) { value_ = sustain; return value_; }
    if (stage_ == Stage::Decay) { target_ = sustain; increment_ = (target_ - preciseValue_) / static_cast<double>(remaining_); }
    preciseValue_ += increment_; value_ = static_cast<float>(preciseValue_);
    if (--remaining_ == 0) {
        value_ = target_;
        if (stage_ == Stage::Attack) segment(Stage::Decay, sustain, settings_.decay);
        else if (stage_ == Stage::Decay) stage_ = Stage::Sustain;
        else reset();
    }
    return value_;
}
}
