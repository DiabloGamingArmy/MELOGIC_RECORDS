// mct-origami-deep-audit-p06-fast-audio-math
#pragma once
#include <algorithm>
#include <cmath>

namespace mct::origami::dsp {

inline double fastExp2Audio(double x) noexcept {
    if(!std::isfinite(x)) return 1.0;
    x=std::clamp(x,-126.0,126.0);
    const int whole=static_cast<int>(std::floor(x));
    const double f=x-static_cast<double>(whole);
    constexpr double ln2=0.69314718055994530942;
    const double y=f*ln2;
    // 8th-order exp Taylor on y in [0, ln(2)); max relative error is tiny
    // compared with oscillator/filter interpolation error.
    const double p=1.0+y*(1.0+y*(0.5+y*(1.0/6.0+y*(1.0/24.0+
        y*(1.0/120.0+y*(1.0/720.0+y*(1.0/5040.0+y*(1.0/40320.0))))))));
    return std::ldexp(p,whole);
}

inline double fastLog2Positive(double x) noexcept {
    if(!(x>0.0) || !std::isfinite(x)) return -126.0;
    int exponent=0;
    double mantissa=std::frexp(x,&exponent); // [0.5,1)
    mantissa*=2.0;
    --exponent;
    // atanh-series log around 1. z is bounded to [0,1/3).
    const double z=(mantissa-1.0)/(mantissa+1.0);
    const double z2=z*z;
    double term=z;
    double sum=term;
    term*=z2;sum+=term/3.0;
    term*=z2;sum+=term/5.0;
    term*=z2;sum+=term/7.0;
    term*=z2;sum+=term/9.0;
    term*=z2;sum+=term/11.0;
    term*=z2;sum+=term/13.0;
    constexpr double invLn2=1.4426950408889634074;
    return static_cast<double>(exponent)+2.0*sum*invLn2;
}

inline double fastPow01(double x,double exponent) noexcept {
    if(!std::isfinite(x) || !std::isfinite(exponent)) return 0.0;
    x=std::clamp(x,0.0,1.0);
    if(x<=0.0) return exponent>0.0 ? 0.0 : 1.0;
    if(x>=1.0) return 1.0;
    return fastExp2Audio(fastLog2Positive(x)*exponent);
}

inline double fastSinCycle(double phase) noexcept {
    if(!std::isfinite(phase)) return 0.0;
    phase-=std::floor(phase);
    constexpr double pi=3.14159265358979323846;
    constexpr double twoPi=6.28318530717958647692;
    constexpr double halfPi=1.57079632679489661923;
    double x=phase*twoPi;
    if(x>pi) x-=twoPi;
    if(x>halfPi) x=pi-x;
    else if(x<-halfPi) x=-pi-x;
    const double x2=x*x;
    return x*(1.0+x2*(-1.0/6.0+x2*(1.0/120.0+
        x2*(-1.0/5040.0+x2*(1.0/362880.0+x2*(-1.0/39916800.0))))));
}

inline float fastOneMinusExpNeg(double x) noexcept {
    if(!std::isfinite(x) || x<=0.0) return 0.0f;
    // Audio smoothing callers stay far below .1; clamp protects misuse.
    x=std::min(x,0.25);
    const double x2=x*x;
    const double v=x-x2*0.5+x2*x/6.0-x2*x2/24.0+x2*x2*x/120.0;
    return static_cast<float>(std::clamp(v,0.0,1.0));
}

inline float triangleFold(float x) noexcept {
    if(!std::isfinite(x)) return 0.0f;
    // Exact normalized equivalent of (2/pi)*asin(sin((pi/2)*x)).
    double r=static_cast<double>(x);
    r-=4.0*std::floor((r+2.0)/4.0); // [-2,2)
    if(r>1.0) r=2.0-r;
    else if(r<-1.0) r=-2.0-r;
    return static_cast<float>(r);
}

} // namespace mct::origami::dsp
