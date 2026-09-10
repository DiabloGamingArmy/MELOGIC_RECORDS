#include "Wavetable.h"
#include <algorithm>
#include <cmath>
namespace mct::origami::dsp {
constexpr double pi = 3.14159265358979323846;
bool Wavetable::valid() const noexcept {
    if (tableLength < 2 || tableLength > 65536 || frames.empty() || frames.size() > 256 || frames[0].bands.empty()) return false;
    const auto& reference = frames[0].bands;
    if (reference.size() > 16) return false;
    for (const auto& frame : frames) {
        if (frame.bands.size() != reference.size()) return false;
        unsigned previous = 0;
        for (std::size_t b = 0; b < frame.bands.size(); ++b) {
            const auto& band = frame.bands[b];
            if (band.samples.size() != tableLength || band.maximumHarmonic <= previous || band.maximumHarmonic != reference[b].maximumHarmonic || band.maximumHarmonic > tableLength / 2) return false;
            for (float value : band.samples) if (!std::isfinite(value) || std::abs(value) > 4) return false;
            previous = band.maximumHarmonic;
        }
    }
    return reference.front().maximumHarmonic == 1;
}
Wavetable Wavetable::builtIns() {
    Wavetable table;
    table.name = "Basic waveforms: sine, saw, square, triangle";
    table.tableLength = 2048;
    table.frames.resize(4);
    for (std::size_t frame = 0; frame < 4; ++frame) {
        for (unsigned harmonics = 1; harmonics <= 512; harmonics *= 2) {
            WavetableBand band; band.maximumHarmonic = harmonics;
            band.samples.resize(table.tableLength);
            for (std::size_t i = 0; i < table.tableLength; ++i) {
                const double phase = 2 * pi * static_cast<double>(i) / static_cast<double>(table.tableLength);
                double value = 0;
                for (unsigned h = 1; h <= (frame == 0 ? 1 : harmonics); ++h) {
                    double amplitude = 0;
                    if (frame == 0) amplitude = 1;
                    if (frame == 1) amplitude = -2 / (pi * h);
                    if (frame == 2 && h % 2) amplitude = 4 / (pi * h);
                    if (frame == 3 && h % 2) amplitude = 8 * ((h % 4 == 1) ? 1 : -1) / (pi * pi * h * h);
                    value += amplitude * std::sin(phase * h);
                }
                band.samples[i] = static_cast<float>(value);
            }
            table.frames[frame].bands.push_back(std::move(band));
        }
    }
    return table;
}
void WavetableOscillator::reset(double phase) noexcept { phase_ = std::isfinite(phase) ? phase - std::floor(phase) : 0; }
float WavetableOscillator::next(const Wavetable& table, double frequency, double sampleRate, float position) noexcept {
    if (table.frames.empty() || sampleRate <= 0 || !std::isfinite(frequency) || !std::isfinite(position)) return 0;
    // Caller installs validated banks. Bound phase every sample, never accumulate time.
    const double increment = std::clamp(frequency / sampleRate, 0.0, .499);
    const double available = frequency > 0 ? sampleRate * .45 / frequency : 1;
    const auto& bands = table.frames[0].bands;
    std::size_t bandIndex = 0;
    while (bandIndex + 1 < bands.size() && bands[bandIndex + 1].maximumHarmonic <= available) ++bandIndex;
    const float framePosition = std::clamp(position, 0.f, 1.f) * static_cast<float>(table.frames.size() - 1);
    const auto first = static_cast<std::size_t>(framePosition);
    const auto second = std::min(first + 1, table.frames.size() - 1);
    const double tablePosition = phase_ * static_cast<double>(table.tableLength);
    const auto index = static_cast<std::size_t>(tablePosition);
    const auto nextIndex = (index + 1) % table.tableLength;
    const float fraction = static_cast<float>(tablePosition - static_cast<double>(index));
    auto read = [&](std::size_t frame) { const auto& samples = table.frames[frame].bands[bandIndex].samples; return samples[index] + fraction * (samples[nextIndex] - samples[index]); };
    const float a = read(first), b = read(second);
    const float output = a + (framePosition - static_cast<float>(first)) * (b - a);
    phase_ += increment; if (phase_ >= 1) phase_ -= 1;
    return frequency >= sampleRate * .5 ? 0 : output;
}
double midiFrequency(int note) noexcept { return 440.0 * std::exp2((std::clamp(note, 0, 127) - 69) / 12.0); }
}
