// mct-origami-v26.1.0-live-wavetable-process-view
// mct-origami-v26.0.0-osc-process-foundation
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

double processOscillatorPhase(double phase,OscProcessType type,float rawAmount) noexcept {
    const double p=std::clamp(phase,0.0,std::nextafter(1.0,0.0));
    const double amount=std::clamp(static_cast<double>(rawAmount),0.0,1.0);
    if(amount<=0.0 || type==OscProcessType::Off) return p;

    switch(type) {
        case OscProcessType::BendPlus: {
            const double shaped=std::pow(p,1.0+amount*4.0);
            return p+(shaped-p)*amount;
        }
        case OscProcessType::BendMinus: {
            const double shaped=1.0-std::pow(1.0-p,1.0+amount*4.0);
            return p+(shaped-p)*amount;
        }
        case OscProcessType::BendBoth: {
            const double exponent=1.0+amount*4.0;
            const double shaped=p<0.5
                ? 0.5*std::pow(p*2.0,exponent)
                : 1.0-0.5*std::pow((1.0-p)*2.0,exponent);
            return p+(shaped-p)*amount;
        }
        case OscProcessType::Sync: {
            const double cycles=1.0+amount*7.0;
            const double synced=p*cycles;
            return synced-std::floor(synced);
        }
        case OscProcessType::Mirror: {
            const double mirrored=1.0-std::abs(p*2.0-1.0);
            return std::clamp(p+(mirrored-p)*amount,0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Asym: {
            const double midpoint=0.5-amount*0.38;
            if(p<midpoint) return 0.5*(p/midpoint);
            return 0.5+0.5*((p-midpoint)/(1.0-midpoint));
        }
        case OscProcessType::Off:
        default:
            return p;
    }
}

float WavetableOscillator::next(const Wavetable& table,double frequency,double sampleRate,float position,
                                OscProcessType process1,float amount1,
                                OscProcessType process2,float amount2) noexcept {
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
    double readPhase=processOscillatorPhase(phase_,process1,amount1);
    readPhase=processOscillatorPhase(readPhase,process2,amount2);
    const double tablePosition = readPhase * static_cast<double>(table.tableLength);
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
