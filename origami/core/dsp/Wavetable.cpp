// mct-origami-v26.3.1-bend-bipolar-global-knob-shortcuts
// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-v26.2.0-native-process-library
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

const char* oscProcessName(OscProcessType type) noexcept {
    switch(type) {
        case OscProcessType::Off:return "Off"; case OscProcessType::BendPlus:return "Bend +";
        case OscProcessType::BendMinus:return "Bend -"; case OscProcessType::BendBoth:return "Bend +/-";
        case OscProcessType::Sync:return "Sync 8x"; case OscProcessType::Mirror:return "Mirror";
        case OscProcessType::Asym:return "Asym"; case OscProcessType::SCurve:return "S-Curve";
        case OscProcessType::Pinch:return "Pinch"; case OscProcessType::Expand:return "Expand";
        case OscProcessType::CenterPull:return "Center Pull"; case OscProcessType::EdgePull:return "Edge Pull";
        case OscProcessType::Sync2:return "Sync 2x"; case OscProcessType::Sync3:return "Sync 3x";
        case OscProcessType::Sync4:return "Sync 4x"; case OscProcessType::Sync16:return "Sync 16x";
        case OscProcessType::Fold:return "Phase Fold"; case OscProcessType::SoftFold:return "Soft Fold";
        case OscProcessType::ReflectLeft:return "Reflect Left"; case OscProcessType::ReflectRight:return "Reflect Right";
        case OscProcessType::AlternateReflect:return "Alt Reflect"; case OscProcessType::PhaseShift:return "Phase Shift";
        case OscProcessType::SineWarp:return "Sine Warp"; case OscProcessType::Ripple:return "Ripple";
        case OscProcessType::Twist:return "Twist"; case OscProcessType::ZigZag:return "Zig-Zag";
        case OscProcessType::Staircase:return "Staircase"; case OscProcessType::Reverse:return "Reverse Blend";
        case OscProcessType::Quantize4:return "Quantize 4"; case OscProcessType::Quantize8:return "Quantize 8";
        case OscProcessType::Quantize16:return "Quantize 16"; case OscProcessType::Scramble2:return "Scramble 2";
        case OscProcessType::Scramble4:return "Scramble 4"; case OscProcessType::Chaos:return "Chaos";
        case OscProcessType::Window:return "Window"; case OscProcessType::PulseWarp:return "Pulse Warp";
        case OscProcessType::Shred:return "Shred"; case OscProcessType::Count:break;
    }
    return "Off";
}

const char* oscProcessCategory(OscProcessType type) noexcept {
    switch(type) {
        case OscProcessType::BendPlus: case OscProcessType::BendMinus: case OscProcessType::BendBoth:
        case OscProcessType::SCurve: case OscProcessType::Pinch: case OscProcessType::Expand:
        case OscProcessType::CenterPull: case OscProcessType::EdgePull: return "Curve / Warp";

        case OscProcessType::Sync: case OscProcessType::Sync2: case OscProcessType::Sync3:
        case OscProcessType::Sync4: case OscProcessType::Sync16: return "Sync / Repeat";

        case OscProcessType::Mirror: case OscProcessType::Fold: case OscProcessType::SoftFold:
        case OscProcessType::ReflectLeft: case OscProcessType::ReflectRight:
        case OscProcessType::AlternateReflect: return "Fold / Reflect";

        case OscProcessType::Asym: case OscProcessType::PhaseShift: case OscProcessType::SineWarp:
        case OscProcessType::Ripple: case OscProcessType::Twist: case OscProcessType::ZigZag:
        case OscProcessType::Staircase: case OscProcessType::Reverse: return "Phase / Motion";

        case OscProcessType::Quantize4: case OscProcessType::Quantize8: case OscProcessType::Quantize16:
        case OscProcessType::Scramble2: case OscProcessType::Scramble4: case OscProcessType::Chaos:
        case OscProcessType::Window: case OscProcessType::PulseWarp: case OscProcessType::Shred:
            return "Digital / Experimental";

        case OscProcessType::Off: case OscProcessType::Count: return "";
    }
    return "";
}

double processOscillatorPhase(double phase,OscProcessType type,float rawAmount) noexcept {
    const auto wrap01=[](double x) noexcept { x-=std::floor(x); return std::clamp(x,0.0,std::nextafter(1.0,0.0)); };
    const auto mix=[](double a,double b,double t) noexcept { return a+(b-a)*t; };
    const auto triangle=[](double x) noexcept { x-=std::floor(x/2.0)*2.0; return 1.0-std::abs(x-1.0); };
    const auto quantize=[](double x,int steps) noexcept { return std::floor(x*steps)/static_cast<double>(steps); };

    const double p=std::clamp(phase,0.0,std::nextafter(1.0,0.0));
    const double amount=std::clamp(static_cast<double>(rawAmount),
                                   static_cast<double>(oscProcessAmountMinimum(type)),1.0);
    if(std::abs(amount)<=std::numeric_limits<double>::epsilon() || type==OscProcessType::Off)
        return p;

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
            // True bipolar bend. Positive values pinch phase toward the outer
            // edges; negative values expand it toward the centre. The mapping
            // is monotonic on both halves and exactly neutral at 0.
            const double magnitude=std::abs(amount);
            const double exponent=amount>=0.0
                ? 1.0+magnitude*4.0
                : 1.0/(1.0+magnitude*4.0);
            const double shaped=p<0.5
                ? 0.5*std::pow(p*2.0,exponent)
                : 1.0-0.5*std::pow((1.0-p)*2.0,exponent);
            return std::clamp(shaped,0.0,std::nextafter(1.0,0.0));
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
            // Bipolar: negative moves the split left; positive moves it right.
            const double midpoint=0.5+amount*0.38;
            if(p<midpoint) return 0.5*(p/midpoint);
            return 0.5+0.5*((p-midpoint)/(1.0-midpoint));
        }
        case OscProcessType::SCurve: {
            const double s=p*p*(3.0-2.0*p);
            return std::clamp(mix(p,s,amount),0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Pinch: {
            const double x=p*2.0-1.0;
            const double y=std::copysign(std::pow(std::abs(x),1.0+amount*5.0),x);
            return std::clamp(y*0.5+0.5,0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Expand: {
            const double x=p*2.0-1.0;
            const double y=std::copysign(std::pow(std::abs(x),1.0/(1.0+amount*4.0)),x);
            return std::clamp(y*0.5+0.5,0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::CenterPull:
            return std::clamp(0.5+(p-0.5)*(1.0-amount*0.88),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::EdgePull: {
            const double k=1.0-amount*0.88;
            return std::clamp(p<0.5 ? p*k : 1.0-(1.0-p)*k,0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Sync2:return wrap01(p*(1.0+amount));
        case OscProcessType::Sync3:return wrap01(p*(1.0+amount*2.0));
        case OscProcessType::Sync4:return wrap01(p*(1.0+amount*3.0));
        case OscProcessType::Sync16:return wrap01(p*(1.0+amount*15.0));
        case OscProcessType::Fold:return std::clamp(triangle(p*(1.0+amount*5.0)),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::SoftFold: {
            const double f=triangle(p*(1.0+amount*4.0));
            return std::clamp(0.5-0.5*std::cos(f*pi),0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::ReflectLeft:
            return std::clamp(mix(p,p<0.5?p:1.0-p,amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::ReflectRight:
            return std::clamp(mix(p,p<0.5?1.0-p:p,amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::AlternateReflect: {
            const int s=std::min(3,static_cast<int>(p*4.0)); const double local=p*4.0-s;
            const double target=(s+(s%2?1.0-local:local))/4.0;
            return std::clamp(mix(p,target,amount),0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::PhaseShift:
            // +/- 180 degrees; 0 is the physical top/center of the amount knob.
            return wrap01(p+amount*0.5);
        case OscProcessType::SineWarp:
            return wrap01(p+std::sin(2.0*pi*p)*amount*0.16);
        case OscProcessType::Ripple:
            return wrap01(p+std::sin(4.0*pi*p)*amount*0.10);
        case OscProcessType::Twist:
            return wrap01(p+(std::sin(2.0*pi*p)*0.10+std::sin(6.0*pi*p)*0.055)*amount);
        case OscProcessType::ZigZag:return std::clamp(mix(p,triangle(p*3.0),amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Staircase: {
            const int steps=2+static_cast<int>(std::round(amount*14.0));
            return std::clamp(mix(p,quantize(p,steps),amount),0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Reverse:return std::clamp(mix(p,1.0-p,amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Quantize4:return std::clamp(mix(p,quantize(p,4),amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Quantize8:return std::clamp(mix(p,quantize(p,8),amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Quantize16:return std::clamp(mix(p,quantize(p,16),amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Scramble2:return wrap01(mix(p,wrap01(p+0.5),amount));
        case OscProcessType::Scramble4: {
            static constexpr int perm[4]={2,0,3,1};
            const int s=std::min(3,static_cast<int>(p*4.0)); const double local=p*4.0-s;
            return std::clamp(mix(p,(perm[s]+local)/4.0,amount),0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Chaos:return std::clamp(mix(p,4.0*p*(1.0-p),amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Window: {
            // Positive expands outward; negative compresses inward.
            const double scale=amount>=0.0
                ? 1.0+amount*5.0
                : 1.0/(1.0+std::abs(amount)*5.0);
            return wrap01(0.5+(p-0.5)*scale);
        }
        case OscProcessType::PulseWarp: {
            // Bipolar pulse-width style skew around the neutral midpoint.
            const double midpoint=0.5+std::sin(amount*pi*0.5)*0.42;
            return p<midpoint ? 0.5*(p/midpoint) : 0.5+0.5*((p-midpoint)/(1.0-midpoint));
        }
        case OscProcessType::Shred:
            return wrap01(p+std::sin(16.0*pi*p)*amount*0.095);
        case OscProcessType::Off:
        case OscProcessType::Count:
        default:return p;
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
