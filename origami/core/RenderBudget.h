// mct-origami-audio-reengineer-p17-global-qos-budget
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace mct::origami {

enum class RenderQoSLevel : std::uint8_t {
    Nominal = 0,
    Guarded = 1,
    Critical = 2
};

struct RenderLoad {
    std::uint32_t activeVoices = 0;
    std::uint32_t activeModules = 0;
    std::uint32_t totalUnison = 0;
    std::uint32_t oscillatorEvaluationsPerSample = 0;
    float effectDeadlineFraction = 0.0f;
};

struct RenderBudgetSnapshot {
    RenderLoad load {};
    RenderQoSLevel level = RenderQoSLevel::Nominal;

    float callbackDeadlineFraction = 0.0f;
    float smoothedDeadlineFraction = 0.0f;
    float peakDeadlineFraction = 0.0f;
    float headroomFraction = 1.0f;

    std::uint64_t deadlineMisses = 0;

    bool suppressVisualTelemetry = false;
    bool reduceControlRate = false;
    bool reduceOptionalEffectQuality = false;
    bool restrictNewHighCostVoices = false;
    bool bypassNewestOptionalEffect = false;
};

class GlobalRenderBudget {
public:
    void reset() noexcept {
        snapshot_ = {};
        level_ = RenderQoSLevel::Nominal;
        overloadStreak_ = 0;
    }

    const RenderBudgetSnapshot& snapshot() const noexcept { return snapshot_; }

    const RenderBudgetSnapshot& observe(float callbackDeadlineFraction,
                                        RenderLoad load) noexcept {
        float instant = std::isfinite(callbackDeadlineFraction)
            ? std::clamp(callbackDeadlineFraction, 0.0f, 8.0f)
            : 1.0f;

        const float previous = snapshot_.smoothedDeadlineFraction;
        const float alpha = instant > previous ? 0.25f : 0.04f;
        const float smoothed = previous + (instant - previous) * alpha;
        const float peak = std::max(instant, snapshot_.peakDeadlineFraction * 0.985f);

        if (instant >= 1.0f)
            ++snapshot_.deadlineMisses;

        if (instant >= 0.95f) {
            if (overloadStreak_ < 255u) ++overloadStreak_;
        } else if (overloadStreak_ > 0u) {
            --overloadStreak_;
        }

        if (instant >= 0.80f || smoothed >= 0.65f) {
            level_ = RenderQoSLevel::Critical;
        } else if (level_ == RenderQoSLevel::Critical) {
            if (instant < 0.70f && smoothed < 0.55f && peak < 0.75f)
                level_ = RenderQoSLevel::Guarded;
        } else if (instant >= 0.60f || smoothed >= 0.50f) {
            level_ = RenderQoSLevel::Guarded;
        } else if (level_ == RenderQoSLevel::Guarded) {
            if (instant < 0.50f && smoothed < 0.40f && peak < 0.60f)
                level_ = RenderQoSLevel::Nominal;
        }

        snapshot_.load = load;
        snapshot_.level = level_;
        snapshot_.callbackDeadlineFraction = instant;
        snapshot_.smoothedDeadlineFraction = smoothed;
        snapshot_.peakDeadlineFraction = peak;
        snapshot_.headroomFraction = std::clamp(1.0f - smoothed, 0.0f, 1.0f);

        snapshot_.suppressVisualTelemetry = level_ != RenderQoSLevel::Nominal;
        snapshot_.reduceControlRate = level_ != RenderQoSLevel::Nominal;
        snapshot_.reduceOptionalEffectQuality = level_ == RenderQoSLevel::Critical;
        snapshot_.restrictNewHighCostVoices = level_ == RenderQoSLevel::Critical;
        snapshot_.bypassNewestOptionalEffect =
            level_ == RenderQoSLevel::Critical && overloadStreak_ >= 3u;

        return snapshot_;
    }

private:
    RenderBudgetSnapshot snapshot_ {};
    RenderQoSLevel level_ = RenderQoSLevel::Nominal;
    std::uint8_t overloadStreak_ = 0;
};

} // namespace mct::origami
