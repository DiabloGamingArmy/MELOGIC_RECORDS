// mct-origami-deep-audit-p07-enforced-qos
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

    // Deep Audit P07: actual synth admission control.
    //
    // The ceiling applies only to NEW polyphonic admissions. Existing sounding
    // voices are never killed merely because QoS entered Critical. If the
    // active count is already at/above this ceiling, a new articulation replaces
    // one existing voice instead of increasing concurrent DSP work.
    bool voiceAdmissionActive = false;
    std::uint32_t voiceAdmissionCeiling = 16;
};

class GlobalRenderBudget {
public:
    static constexpr std::uint32_t maximumSynthVoices = 16;

    void reset() noexcept {
        snapshot_ = {};
        snapshot_.voiceAdmissionCeiling = maximumSynthVoices;
        level_ = RenderQoSLevel::Nominal;
        overloadStreak_ = 0;
    }

    const RenderBudgetSnapshot& snapshot() const noexcept { return snapshot_; }

    const RenderBudgetSnapshot& observe(float callbackDeadlineFraction,
                                        RenderLoad load) noexcept {
        const float instant = std::isfinite(callbackDeadlineFraction)
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

        // Ordered degradation. These flags are policy outputs; P07 makes the
        // voice-admission stage enforceable instead of advisory.
        snapshot_.suppressVisualTelemetry = level_ != RenderQoSLevel::Nominal;
        snapshot_.reduceControlRate = level_ != RenderQoSLevel::Nominal;
        snapshot_.reduceOptionalEffectQuality = level_ == RenderQoSLevel::Critical;
        snapshot_.restrictNewHighCostVoices = level_ == RenderQoSLevel::Critical;
        snapshot_.bypassNewestOptionalEffect =
            level_ == RenderQoSLevel::Critical && overloadStreak_ >= 3u;

        snapshot_.voiceAdmissionActive = false;
        snapshot_.voiceAdmissionCeiling = maximumSynthVoices;

        if (level_ == RenderQoSLevel::Critical && load.activeVoices > 0u) {
            // This is deliberately measurement-derived, not a static "CPU cost
            // point" score. Target approximately 55% callback occupancy before
            // allowing concurrency to grow again. Existing voices keep sounding;
            // only future admissions are constrained.
            constexpr float targetFraction = 0.55f;
            const float pressure = std::max({instant, smoothed, targetFraction});
            const float ratio = std::clamp(targetFraction / pressure, 0.25f, 1.0f);
            const auto proposed = static_cast<std::uint32_t>(
                std::floor(static_cast<float>(load.activeVoices) * ratio));

            snapshot_.voiceAdmissionActive = true;
            snapshot_.voiceAdmissionCeiling = std::clamp(
                std::min(load.activeVoices, std::max(1u, proposed)),
                1u, maximumSynthVoices);
        }

        return snapshot_;
    }

private:
    RenderBudgetSnapshot snapshot_ {};
    RenderQoSLevel level_ = RenderQoSLevel::Nominal;
    std::uint8_t overloadStreak_ = 0;
};

} // namespace mct::origami
