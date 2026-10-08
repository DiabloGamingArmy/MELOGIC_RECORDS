#pragma once
#include <algorithm>
#include <cmath>
#include <complex>
namespace mct::origami::dsp {
// Canonical TPT/SVF response, parametrized by the actual kernel coefficients.
inline std::complex<double> svfTransfer(double g,double k,double m0,double m1,double m2,double hz,double rate) noexcept {
    if(g<=0 || rate<=0) return {};const std::complex<double> s{0,std::tan(3.14159265358979323846*std::clamp(hz,1.0,rate*.4999)/rate)/g};
    return m0+(m1*s+m2)/(s*s+k*s+1.0);
}
struct FilterResponseAxis {
    double rate=48000,topDb=18;static constexpr double minimum=20,bottomDb=-60;
    double maximum() const noexcept {return std::min(20000.0,rate*.499);}
    double frequency(double x) const noexcept {return minimum*std::pow(maximum()/minimum,std::clamp(x,0.0,1.0));}
    double x(double hz) const noexcept {return std::clamp(std::log(std::max(hz,minimum)/minimum)/std::log(maximum()/minimum),0.0,1.0);}
    double y(double magnitude) const noexcept {return std::clamp((topDb-20*std::log10(std::max(magnitude,1e-6)))/(topDb-bottomDb),0.0,1.0);}
};
}
