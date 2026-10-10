#include "core/fx/SpectralTune.h"
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>
using namespace mct::origami::fx;
namespace {
constexpr double rate = 48000, tau = 6.2831853071795864769;
using Params = std::array<float, spectral::parameterCount>;
Params params() {
    Params p;
    for (std::size_t i = 0; i < p.size(); ++i)
        p[i] = spectral::parameters()[i].defaultValue;
    return p;
}
void value(Params &p, int i, float x) {
    const auto &d = spectral::parameters()[i];
    p[i] = d.curve == FxParameterCurve::Exponential
               ? std::log(x / d.minimum) / std::log(d.maximum / d.minimum)
               : (x - d.minimum) / (d.maximum - d.minimum);
}
std::vector<float> render(const std::vector<float> &x, Params p) {
    SpectralTune f;
    f.prepare(rate);
    auto l = x, r = x;
    l.resize(x.size() + f.latencySamples());
    r.resize(l.size());
    for (int at = 0; at < int(l.size()); at += 128)
        f.process(l.data() + at, r.data() + at, std::min(128, int(l.size()) - at), p.data());
    l.erase(l.begin(), l.begin() + f.latencySamples());
    return l;
}
double amplitude(const std::vector<float> &x, double hz) {
    double re = 0, im = 0;
    const std::size_t start = x.size() - 24000;
    const double cs = std::cos(tau * hz / rate), sn = std::sin(tau * hz / rate);
    double c = 1, s = 0;
    for (std::size_t i = start; i < x.size(); ++i) {
        re += x[i] * c;
        im -= x[i] * s;
        const double next = c * cs - s * sn;
        s = s * cs + c * sn;
        c = next;
    }
    return 2 * std::hypot(re, im) / (x.size() - start);
}
std::vector<float> tone(double hz) {
    std::vector<float> x(5 * 48000);
    for (std::size_t i = 0; i < x.size(); ++i)
        x[i] = float(.15 * std::sin(tau * hz * i / rate));
    return x;
}
void wave(const std::string &path, const std::vector<float> &x) {
    std::ofstream f(path, std::ios::binary);
    const auto u16 = [&](unsigned v) {
        char b[]{char(v), char(v >> 8)};
        f.write(b, 2);
    };
    const auto u32 = [&](unsigned v) {
        char b[]{char(v), char(v >> 8), char(v >> 16), char(v >> 24)};
        f.write(b, 4);
    };
    const unsigned n = 96000;
    f.write("RIFF", 4);
    u32(48 + n * 4);
    f.write("WAVEfmt ", 8);
    u32(16);
    u16(3);
    u16(1);
    u32(48000);
    u32(192000);
    u16(4);
    u16(32);
    f.write("fact", 4);
    u32(4);
    u32(n);
    f.write("data", 4);
    u32(n * 4);
    f.write(reinterpret_cast<const char *>(x.data() + x.size() - n), n * 4);
}
std::vector<float> fixture(int kind) {
    std::vector<float> x(5 * 48000);
    unsigned rng = 42;
    for (std::size_t i = 0; i < x.size(); ++i) {
        const double t = i / rate;
        double v = 0;
        for (int h = 1; h <= 80; ++h) {
            const double hz = kind == 2   ? 119. * h + (h % 3) * 7.
                              : kind == 3 ? 317. * h
                              : kind == 5 ? 83. * h
                              : kind == 6 ? 55. * h
                                          : 233. * h;
            if (hz >= rate * .48)
                break;
            const double amp =
                kind == 2   ? .011
                : kind == 3 ? .075 / std::sqrt(double(h))
                : kind == 5 ? .055 / h * (1 + .65 * std::sin(tau * (.7 + h * .13) * t))
                : kind == 6 ? .06 * (.2 + std::exp(-std::pow((h - (9 + 5 * std::sin(tau * 3 * t))) / 4, 2))) /
                                  std::sqrt(double(h))
                            : .14 / h;
            if (kind == 1 && h % 2 == 0)
                continue;
            v += amp * std::sin(tau * hz * t + .31 * h);
        }
        if (kind == 4) {
            rng = rng * 1664525u + 1013904223u;
            v += .025 * (double(rng) / 4294967296. - .5);
        }
        x[i] = float(v);
    }
    return x;
}
int checks = 0, failures = 0;
void check(bool ok, const char *what) {
    ++checks;
    if (!ok) {
        ++failures;
        std::cerr << "FAIL: " << what << '\n';
    }
}
void convergence(std::ofstream *csv = nullptr) {
    auto x = tone(280);
    for (float snap : {0.f, .25f, .5f, .75f, 1.f})
        for (float smooth : {0.f, .02f, .16f, .5f, 1.f}) {
            auto p = params();
            p[0] = snap;
            p[3] = smooth;
            p[12] = 1.f / 4095;
            auto y = render(x, p);
            const double expected = 280 * std::exp2(snap * std::log2(261.625565 / 280));
            double best = 0, hz = 0;
            for (double f = expected - 1; f <= expected + 1; f += .125) {
                double a = amplitude(y, f);
                if (a > best) {
                    best = a;
                    hz = f;
                }
            }
            check(std::abs(hz - expected) < .26, "settled Snap/Smooth target convergence");
            check(best > .10, "settled tone retains definition");
            if (csv)
                *csv << snap << ',' << smooth * 500 << ',' << expected << ',' << hz << ',' << best << '\n';
        }
}
void motion(std::ofstream *csv = nullptr) {
    std::vector<float> x(5 * 48000);
    double phase = 0;
    for (std::size_t i = 0; i < x.size(); ++i) {
        const double hz = 280 * std::exp2(.35 * std::sin(tau * 5 * i / rate) / 12);
        phase += tau * hz / rate;
        x[i] = float(.15 * std::sin(phase));
    }
    double lowCoherence = 0, lowCarrier = 0;
    for (float smooth : {0.f, .16f, 1.f}) {
        auto p = params();
        p[0] = 1;
        p[3] = smooth;
        p[4] = 0;
        p[12] = 1.f / 4095;
        auto y = render(x, p);
        double power = 0;
        for (std::size_t i = y.size() - 24000; i < y.size(); ++i)
            power += y[i] * y[i];
        power /= 24000;
        const double carrier = amplitude(y, 261.625565), coherence = carrier * carrier / (2 * power);
        std::cout << "motion smooth=" << smooth * 500 << " carrier=" << carrier << " coherence=" << coherence
                  << '\n';
        if (smooth == 0) {
            lowCoherence = coherence;
            lowCarrier = carrier;
        }
        check(coherence > .75 && coherence >= lowCoherence - .01 && carrier >= lowCarrier * .98,
              "high Smooth preserves low-Smooth stationary-lattice definition on moving source");
        if (csv)
            *csv << smooth * 500 << ',' << carrier << ',' << coherence << '\n';
    }
}
void boundaryHysteresis() {
    auto x = tone(280);
    double phase = 0;
    const double midpoint = 261.625565 * std::sqrt(2.);
    for (std::size_t i = 0; i < x.size(); ++i) {
        const double hz = midpoint * std::exp2(.025 * std::sin(tau * 5 * i / rate) / 12);
        phase += tau * hz / rate;
        x[i] = float(.15 * std::sin(phase));
    }
    auto p = params();
    p[0] = 1;
    p[3] = 0;
    p[4] = 0;
    p[12] = 1.f / 4095;
    const auto y = render(x, p);
    const double carrier = std::max(amplitude(y, 261.625565), amplitude(y, 523.25113));
    std::cout << "boundary jitter carrier=" << carrier << '\n';
    check(carrier > .125,
          "bounded hysteresis holds a defined note through tiny nearest-target boundary jitter");
}

void targetRelease() {
    // A genuine note move must release hysteresis and settle even at maximum Smooth.
    auto x = tone(280);
    double phase = 0;
    for (std::size_t i = 0; i < x.size(); ++i) {
        const double hz = i < 48000 ? 280 : 440;
        phase += tau * hz / rate;
        x[i] = float(.15 * std::sin(phase));
    }
    auto p = params();
    p[0] = 1;
    p[3] = 1;
    p[4] = 0;
    p[12] = 1.f / 4095;
    auto y = render(x, p);
    check(amplitude(y, 523.25113) > .12, "maximum Smooth follows a new lattice target after settling");
    check(amplitude(y, 261.625565) < .005, "bounded hysteresis releases a genuine new note");
    p = params();
    p[0] = 1;
    p[3] = 0;
    p[12] = 1.f / 4095;
    y = render(tone(22000), p);
    check(amplitude(y, 22000) > .149, "original source above FX HIGH remains intact");
}

void fixtures(const std::string &folder, int first = 0, int last = 7) {
    std::filesystem::create_directories(folder);
    const char *names[]{"bright-saw",     "pulse",      "dense-stack", "chip",
                        "noisy-harmonic", "color-bass", "bass-growl"};
    for (int kind = first; kind < last; ++kind) {
        auto x = fixture(kind);
        wave(folder + "/" + names[kind] + "-dry.wav", x);
        for (int variant = 0; variant < 10; ++variant) {
            auto p = params();
            p[0] = 1;
            p[3] = 0;
            p[12] = float(spectral::scaleMask(0, 2)) / 4095;
            const char *tag = "snap-full";
            switch (variant) {
            case 0:
                p[0] = 0;
                tag = "neutral";
                break;
            case 1:
                break;
            case 2:
                p[0] = 0;
                value(p, 1, 7);
                tag = "shift+7";
                break;
            case 3:
                p[0] = 0;
                value(p, 1, 12);
                tag = "shift+12";
                break;
            case 4:
                p[0] = 0;
                value(p, 1, 19);
                tag = "shift+19";
                break;
            case 5:
                p[0] = 0;
                value(p, 1, 24);
                tag = "shift+24";
                break;
            case 6:
                p[0] = 0;
                value(p, 1, -12);
                tag = "shift-12";
                break;
            case 7:
                p[3] = 1;
                tag = "smooth-max";
                break;
            case 8:
                p[5] = 1;
                tag = "formant-max";
                break;
            case 9:
                p[0] = 0;
                p[5] = 1;
                value(p, 1, 12);
                tag = "shift+12-formant";
                break;
            }
            wave(folder + "/" + names[kind] + "-" + tag + ".wav", render(x, p));
        }
    }
    std::ofstream csv(folder + "/convergence.csv");
    csv << "snap,smooth_ms,expected_hz,observed_hz,amplitude\n";
    convergence(&csv);
    std::ofstream movement(folder + "/motion.csv");
    movement << "smooth_ms,carrier_amplitude,coherence\n";
    motion(&movement);
}
} // namespace
int main(int argc, char **argv) {
    if (argc == 3 && (std::string(argv[1]) == "--render" || std::string(argv[1]) == "--render-growl")) {
        if (std::string(argv[1]) == "--render-growl")
            fixtures(argv[2], 6, 7);
        else
            fixtures(argv[2]);
        std::cout << "Rendered quality audit fixtures; convergence failures=" << failures << '\n';
        return failures ? 1 : 0;
    }
    convergence();
    motion();
    targetRelease();
    boundaryHysteresis();
    for (double hz : {330., 3000., 7500., 11500.})
        for (float shift : {7.f, 12.f, 19.f, 24.f}) {
            const double target = hz * std::exp2(shift / 12.);
            if (target >= rate * .48)
                continue;
            auto p = params();
            p[0] = 0;
            p[3] = 0;
            value(p, 1, shift);
            const auto y = render(tone(hz), p);
            const double a = amplitude(y, target);
            std::cout << "shift source=" << hz << " shift=" << shift << " target=" << target
                      << " amplitude=" << a << '\n';
            check(a > .14,
                  "in-band upward shift retains carrier within 0.6 dB including destinations above FX HIGH");
        }
    auto p = params();
    p[0] = 0;
    p[3] = 0;
    value(p, 1, 12);
    auto y = render(tone(17000), p);
    check(amplitude(y, 17000) < .01, "above-Nyquist shifted partial is rejected, not retained untuned");
    // Inspect a settled interior interval, before the finite fixture stops.
    double rejectedPower = 0;
    for (std::size_t i = y.size() - 48000; i < y.size() - 24000; ++i)
        rejectedPower += y[i] * y[i];
    std::cout << "Nyquist rejection RMS=" << std::sqrt(rejectedPower / 24000)
              << " original amplitude=" << amplitude(y, 17000) << "\n";
    check(std::sqrt(rejectedPower / 24000) < 1.e-4,
          "beyond-Nyquist shift does not fold into any audible band");
    for (float formant : {0.f, 1.f}) {
        p = params();
        p[0] = 0;
        p[5] = formant;
        value(p, 1, 12);
        auto y = render(tone(7500), p);
        check(amplitude(y, 15000) > .035, "Formant does not silence eligible HF tone");
    }
    std::cout << (failures ? "FAIL: " : "PASS: ") << checks << " quality checks\n";
    return failures ? 1 : 0;
}
