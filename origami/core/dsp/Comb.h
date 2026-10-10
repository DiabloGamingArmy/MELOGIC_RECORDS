#pragma once
#include <algorithm>
#include <cmath>
#include <complex>
#include <cstddef>

namespace mct::origami::dsp {
inline constexpr float combMinimumFrequency=20,combMaximumFrequency=2000,combDefaultDamping=.2f;
inline float combFeedback(float resonance) noexcept {return -.97f+1.94f*std::clamp(resonance,0.f,1.f);}
inline float combDamping(double rate,float damping=combDefaultDamping) noexcept {
    const float hz=18000.f*std::pow(1000.f/18000.f,std::clamp(damping,0.f,1.f));
    return 1.f-std::exp(-6.28318530717958647692f*std::clamp(hz,1.f,float(rate)*.45f)/float(rate));
}
struct CombCoefficients {float period=24,feedback=0,normalize=1,damping=1;};
inline CombCoefficients combDesign(double rate,float frequency,float feedback,float damping=combDefaultDamping) noexcept {
    feedback=std::clamp(feedback,-.97f,.97f);
    return {float(rate)/std::clamp(frequency,combMinimumFrequency,combMaximumFrequency),feedback,std::sqrt(1.f-std::abs(feedback)),combDamping(rate,damping)};
}
// A non-owning bounded ring. Reset invalidates every old sample in O(1).
// Preparation owns memory; audio only reads/writes its exclusive view.
class CombDelay {
public:
    void bind(float* data,std::size_t count) noexcept {data_=data;size_=count;reset();}
    void reset() noexcept {write_=filled_=0;energy_=0;}
    bool bound() const noexcept {return data_ && size_>=4;}
    float read(float delay) const noexcept {
        if(!bound()) return 0;
        delay=std::clamp(delay,1.f,float(size_-3));const auto whole=std::size_t(delay);const float frac=delay-float(whole);
        const auto a=write_>=whole?write_-whole:write_+size_-whole,b=a?a-1:size_-1;
        const float x=a<filled_?data_[a]:0,y=b<filled_?data_[b]:0;return x+(y-x)*frac;
    }
    void push(float x) noexcept {
        if(!bound()) return;
        if(filled_==size_) energy_-=std::abs(double(data_[write_]));
        data_[write_]=x;energy_+=std::abs(double(x));energy_=std::max(0.,energy_);
        if(++write_==size_) write_=0;filled_=std::min(filled_+1,size_);
    }
    bool quiet() const noexcept {return energy_<1e-7;}
private:
    float* data_=nullptr;std::size_t size_=0,write_=0,filled_=0;double energy_=0;
};
// Extracted from canonical FxEffects.cpp CombFx: fractional feedback delay,
// one-pole loop damping, original soft limiter and wet normalization.
struct CombState {
    CombDelay delay;float lowpass=0;
    void reset() noexcept {delay.reset();lowpass=0;}
    void bind(float* data,std::size_t count) noexcept {delay.bind(data,count);lowpass=0;}
    float next(float input,const CombCoefficients& c) noexcept {
        const float x=std::isfinite(input)?std::clamp(input,-64.f,64.f):0.f;
        if(!std::isfinite(lowpass)) reset();
        lowpass+=c.damping*(delay.read(c.period)-lowpass);
        const float sum=x+c.feedback*lowpass,a=std::abs(sum);
        const float wet=a<=1?sum:std::copysign(1.f+std::tanh(a-1.f),sum);
        delay.push(wet);return wet*c.normalize;
    }
    bool quiet() const noexcept {return std::abs(lowpass)<1e-9f && delay.quiet();}
};
inline std::complex<double> combTransfer(const CombCoefficients& c,double hz,double rate) noexcept {
    const auto z=std::polar(1.,-6.28318530717958647692*hz/rate);const auto whole=int(c.period);const double fraction=c.period-whole;
    const auto delay=std::polar(1.,-6.28318530717958647692*hz/rate*whole)*((1-fraction)+fraction*z);
    const auto loop=delay*double(c.damping)/(1.-(1.-double(c.damping))*z);
    return double(c.normalize)/(1.-double(c.feedback)*loop);
}
inline double combMagnitude(const CombCoefficients& c,double hz,double rate,double mix=1) noexcept {return std::abs((1-mix)+mix*combTransfer(c,hz,rate));}
}
