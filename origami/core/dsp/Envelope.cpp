// mct-origami-v28.0.0-interactive-envelope-editor
#include "Envelope.h"
#include <algorithm>
#include <cmath>
namespace mct::origami::dsp {
void Envelope::prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; reset(); }
void Envelope::reset() noexcept {
    stage_=Stage::Idle;value_=target_=startValue_=curve_=0;remaining_=totalSamples_=0;
}
float Envelope::shape(float t,float c) noexcept {
    t=std::clamp(t,0.0f,1.0f);c=std::clamp(c,-1.0f,1.0f);
    if(std::abs(c)<1.0e-6f) return t;
    if(c>0) return std::pow(t,1.0f+c*4.0f);
    return 1.0f-std::pow(1.0f-t,1.0f+(-c)*4.0f);
}
void Envelope::segment(Stage stage,float target,float seconds,float curve) noexcept {
    stage_=stage;target_=target;startValue_=value_;curve_=std::clamp(curve,-1.0f,1.0f);
    totalSamples_=remaining_=static_cast<std::uint64_t>(std::max(1.0,std::round(seconds*sampleRate_)));
}
void Envelope::noteOn(const EnvelopeSettings& settings) noexcept {
    settings_=settings;segment(Stage::Attack,1.0f,settings.attack,settings.attackCurve);
}
void Envelope::noteOff(const EnvelopeSettings& settings) noexcept {
    settings_=settings;
    if(stage_!=Stage::Idle && stage_!=Stage::Release)
        segment(Stage::Release,0.0f,settings.release,settings.releaseCurve);
}
float Envelope::next(float sustain) noexcept {
    if(stage_==Stage::Idle) return 0.0f;
    if(stage_==Stage::Sustain) {value_=sustain;return value_;}
    if(stage_==Stage::Decay) target_=sustain;
    const auto elapsed=totalSamples_-remaining_+1;
    const float t=static_cast<float>(elapsed)/static_cast<float>(std::max<std::uint64_t>(1,totalSamples_));
    const float s=shape(t,curve_);
    value_=startValue_+(target_-startValue_)*s;
    if(remaining_>0) --remaining_;
    if(remaining_==0) {
        value_=target_;
        if(stage_==Stage::Attack) segment(Stage::Decay,sustain,settings_.decay,settings_.decayCurve);
        else if(stage_==Stage::Decay) stage_=Stage::Sustain;
        else reset();
    }
    return value_;
}
}
