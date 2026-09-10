#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>
namespace mct::origami {
// Values and strings are persistent API identifiers. Never renumber or reuse them.
enum class ParameterId : std::uint16_t {
    Waveform = 0, OscLevel = 1, OscPan = 2, Cutoff = 3, Resonance = 4,
    Attack = 5, Decay = 6, Sustain = 7, Release = 8, MasterGain = 9
};
constexpr std::size_t parameterCount = 10;
enum class ParameterScale { Linear, Logarithmic, Choice };
struct ParameterDescriptor {
    ParameterId id;
    std::string_view key, name, unit;
    float defaultValue, minimum, maximum;
    ParameterScale scale;
    float smoothingSeconds;
};
const std::array<ParameterDescriptor, parameterCount>& parameterRegistry() noexcept;
const ParameterDescriptor* findParameter(std::string_view key) noexcept;
const ParameterDescriptor* findParameter(ParameterId id) noexcept;
bool sanitizeParameter(ParameterId id, float input, float& output) noexcept;
float toNormalized(ParameterId id, float physical) noexcept;
float fromNormalized(ParameterId id, float normalized) noexcept;
using ParameterValues = std::array<float, parameterCount>;
ParameterValues defaultParameters() noexcept;
}
