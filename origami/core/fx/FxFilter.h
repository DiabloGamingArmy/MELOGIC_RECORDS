// mct-origami-unified-routing-core-fx-p04
#pragma once
#include <cmath>
#include <complex>
#include <cstdint>

// One state-variable filter primitive (Simper/Cytomic TPT SVF) shared by the
// FILTER, EQUALIZER, PHASER and multiband COMPRESSOR DSP and by the UI's
// analytic response curves, so drawn responses are the real responses.
//
// Output = m0*v0 + m1*bandpass + m2*lowpass. In the analog prototype with
// s = j*tan(pi f/fs)/g that is H(s) = m0 + (m1*s + m2)/(s^2 + k s + 1).
namespace mct::origami::fx {

enum class SvfShape : std::uint8_t {
    LowPass=0, HighPass=1, BandPass=2, Notch=3, Bell=4, AllPass=5, LowShelf=6, HighShelf=7
};

struct SvfCoefficients {
    double g=0.1,k=1.4142135623730951,m0=0.0,m1=0.0,m2=1.0;
    float a1=0.0f,a2=0.0f,a3=0.0f;
};

inline SvfCoefficients svfDesign(SvfShape shape,double frequency,double q,double gainDb,double sampleRate) noexcept {
    constexpr double pi=3.14159265358979323846;
    const double fc=std::fmin(std::fmax(frequency,10.0),sampleRate*0.49);
    q=std::fmin(std::fmax(q,0.1),40.0);
    const double A=std::pow(10.0,gainDb/40.0);
    SvfCoefficients c;
    c.g=std::tan(pi*fc/sampleRate);
    c.k=1.0/q;
    switch(shape) {
    case SvfShape::LowPass: c.m0=0; c.m1=0; c.m2=1; break;
    case SvfShape::HighPass: c.m0=1; c.m1=-c.k; c.m2=-1; break;
    case SvfShape::BandPass: c.m0=0; c.m1=c.k; c.m2=0; break; // unity peak gain
    case SvfShape::Notch: c.m0=1; c.m1=-c.k; c.m2=0; break;
    case SvfShape::AllPass: c.m0=1; c.m1=-2.0*c.k; c.m2=0; break;
    case SvfShape::Bell: c.k=1.0/(q*A); c.m0=1; c.m1=c.k*(A*A-1.0); c.m2=0; break;
    case SvfShape::LowShelf: c.g/=std::sqrt(A); c.m0=1; c.m1=c.k*(A-1.0); c.m2=A*A-1.0; break;
    case SvfShape::HighShelf: c.g*=std::sqrt(A); c.m0=A*A; c.m1=c.k*(1.0-A)*A; c.m2=1.0-A*A; break;
    }
    const double a1=1.0/(1.0+c.g*(c.g+c.k));
    c.a1=float(a1);
    c.a2=float(c.g*a1);
    c.a3=float(c.g*c.g*a1);
    return c;
}

inline double svfMagnitude(const SvfCoefficients& c,double frequency,double sampleRate) noexcept {
    constexpr double pi=3.14159265358979323846;
    const double f=std::fmin(std::fmax(frequency,1.0),sampleRate*0.4999);
    const double omega=std::tan(pi*f/sampleRate)/c.g;
    const std::complex<double> s(0.0,omega);
    const auto h=c.m0+(c.m1*s+c.m2)/(s*s+c.k*s+1.0);
    return std::abs(h);
}

struct SvfState {
    float ic1=0.0f,ic2=0.0f;
    void reset() noexcept { ic1=ic2=0.0f; }
    float process(float v0,const SvfCoefficients& c) noexcept {
        const float v3=v0-ic2;
        const float v1=c.a1*ic1+c.a2*v3;
        const float v2=ic2+c.a2*ic1+c.a3*v3;
        ic1=2.0f*v1-ic1;
        ic2=2.0f*v2-ic2;
        if(!std::isfinite(ic1) || !std::isfinite(ic2)) { ic1=ic2=0.0f; return 0.0f; }
        return float(c.m0)*v0+float(c.m1)*v1+float(c.m2)*v2;
    }
};

}
