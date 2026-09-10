#include "ParameterRegistry.h"
#include <algorithm>
#include <cmath>
namespace mct::origami {
const std::array<ParameterDescriptor, parameterCount>& parameterRegistry() noexcept {
    static constexpr std::array<ParameterDescriptor, parameterCount> registry {{
        {ParameterId::Waveform,"osc.1.waveform","OSC 1 Waveform","",1,0,3,ParameterScale::Choice,.005f},
        {ParameterId::OscLevel,"osc.1.level","OSC 1 Level","linear",.7f,0,1,ParameterScale::Linear,.01f},
        {ParameterId::OscPan,"osc.1.pan","OSC 1 Pan","",0,-1,1,ParameterScale::Linear,.01f},
        {ParameterId::Cutoff,"filter.1.cutoff","Filter 1 Cutoff","Hz",8000,20,20000,ParameterScale::Logarithmic,.01f},
        {ParameterId::Resonance,"filter.1.resonance","Filter 1 Resonance","",.1f,0,1,ParameterScale::Linear,.01f},
        {ParameterId::Attack,"env.1.attack","ENV 1 Attack","s",.01f,.001f,10,ParameterScale::Logarithmic,0},
        {ParameterId::Decay,"env.1.decay","ENV 1 Decay","s",.15f,.001f,10,ParameterScale::Logarithmic,0},
        {ParameterId::Sustain,"env.1.sustain","ENV 1 Sustain","linear",.7f,0,1,ParameterScale::Linear,.01f},
        {ParameterId::Release,"env.1.release","ENV 1 Release","s",.25f,.001f,20,ParameterScale::Logarithmic,0},
        {ParameterId::MasterGain,"master.gain","Master Gain","linear",.2f,0,1,ParameterScale::Linear,.01f}
    }};
    return registry;
}
const ParameterDescriptor* findParameter(ParameterId id) noexcept {
    const auto index = static_cast<std::size_t>(id);
    return index < parameterCount ? &parameterRegistry()[index] : nullptr;
}
const ParameterDescriptor* findParameter(std::string_view key) noexcept {
    for (const auto& parameter : parameterRegistry()) if (parameter.key == key) return &parameter;
    return nullptr;
}
bool sanitizeParameter(ParameterId id, float input, float& output) noexcept {
    const auto* parameter = findParameter(id);
    if (!parameter || !std::isfinite(input)) return false;
    output = std::clamp(input, parameter->minimum, parameter->maximum);
    if (parameter->scale == ParameterScale::Choice) output = std::round(output);
    return true;
}
float toNormalized(ParameterId id, float physical) noexcept {
    float value = 0;
    if (!sanitizeParameter(id, physical, value)) return 0;
    const auto& p = *findParameter(id);
    return p.scale == ParameterScale::Logarithmic ? std::log(value / p.minimum) / std::log(p.maximum / p.minimum) : (value-p.minimum)/(p.maximum-p.minimum);
}
float fromNormalized(ParameterId id, float normalized) noexcept {
    const auto* p = findParameter(id);
    if (!p || !std::isfinite(normalized)) return 0;
    const auto n = std::clamp(normalized, 0.f, 1.f);
    float value = p->scale == ParameterScale::Logarithmic ? p->minimum * std::pow(p->maximum/p->minimum, n) : p->minimum+n*(p->maximum-p->minimum);
    sanitizeParameter(id, value, value);
    return value;
}
ParameterValues defaultParameters() noexcept {
    ParameterValues values {};
    for (const auto& p : parameterRegistry()) values[static_cast<std::size_t>(p.id)] = p.defaultValue;
    return values;
}
}
