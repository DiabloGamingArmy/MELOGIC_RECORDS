#pragma once
#include <cstdint>

namespace mct::origami::ui {
enum class VisualizationEffect : std::uint32_t {
    Env=0, Lfo, Random, Function, Chaos, Drift, Sequencer, Osc
};
constexpr std::uint32_t visualizationBit(VisualizationEffect effect) noexcept {
    return 1u<<static_cast<std::uint32_t>(effect);
}
constexpr std::uint32_t defaultVisualizationMask=visualizationBit(VisualizationEffect::Chaos);
constexpr std::uint32_t validVisualizationMask=(1u<<8u)-1u;
}
