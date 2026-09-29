#pragma once
#include "WavetableDocument.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <memory>
#include <limits>
#include <vector>

namespace mct::origami::ui {
enum class MorphMethod { Crossfade=1, PhaseAligned, Spectral, Harmonic, HarmonicShift, Hybrid };
enum class MorphCurve { Linear=1, EaseIn, EaseOut, SCurve };
inline float morphCurve(float t,MorphCurve curve) noexcept {
    t=std::clamp(t,0.0f,1.0f);
    switch(curve) {
        case MorphCurve::Linear: return t;
        case MorphCurve::EaseIn:return t*t;
        case MorphCurve::EaseOut:return 1.0f-(1.0f-t)*(1.0f-t);
        case MorphCurve::SCurve:return t*t*(3.0f-2.0f*t);
        default:return t;
    }
}
inline void invalidateTimeSpectrum(WavetableFrame& frame) noexcept {
    frame.hasIndependentSpectrum=false;
    frame.hasSubtractiveSpectrum=false;
    frame.subtractiveGains.fill(1.0f);
    // Additive authoring is independent of a time-domain transformation.
}
inline void circularShift(WavetableFrame& frame,std::size_t shift) {
    const auto old=frame.samples;
    for(std::size_t i=0;i<kWavetableFrameSize;++i)
        frame.samples[i]=old[(i+shift)%kWavetableFrameSize];
    invalidateTimeSpectrum(frame);
}
inline void fft(std::array<std::complex<double>,kWavetableFrameSize>& data,bool inverse) noexcept;
inline std::size_t correlationShift(const WavetableFrame& a,const WavetableFrame& b) noexcept {
    // Circular cross-correlation via FFT: one bounded calculation per source pair.
    std::array<std::complex<double>,kWavetableFrameSize> left{},right{};
    for(std::size_t i=0;i<kWavetableFrameSize;++i) {left[i]=a.samples[i];right[i]=b.samples[i];}
    fft(left,false);fft(right,false);
    for(std::size_t i=0;i<kWavetableFrameSize;++i)left[i]=std::conj(left[i])*right[i];
    fft(left,true);
    double best=-std::numeric_limits<double>::infinity();std::size_t offset=0;
    for(std::size_t shift=0;shift<kWavetableFrameSize;++shift)
        if(left[shift].real()>best){best=left[shift].real();offset=shift;}
    return offset;
}
inline void alignZero(WavetableFrame& frame) {
    std::size_t best=0,distance=kWavetableFrameSize;
    for(std::size_t i=0;i<kWavetableFrameSize;++i) {
        const auto previous=frame.samples[(i+kWavetableFrameSize-1)%kWavetableFrameSize];
        if(previous<=0.0f && frame.samples[i]>=0.0f) {
            const auto d=std::min(i,kWavetableFrameSize-i);
            if(d<distance){distance=d;best=i;}
        }
    }
    if(distance<kWavetableFrameSize) circularShift(frame,best);
}
inline void processFrame(WavetableFrame& frame,int operation,
                         std::size_t first=0,std::size_t last=kWavetableFrameSize-1) {
    auto& samples=frame.samples;
    first=std::min(first,samples.size()-1);last=std::min(last,samples.size()-1);
    if(first>last)return;
    if(operation==1) { // normalize
        float peak=0;for(std::size_t i=first;i<=last;++i)peak=std::max(peak,std::abs(samples[i]));
        if(peak>1.0e-8f)for(std::size_t i=first;i<=last;++i)samples[i]/=peak;
    } else if(operation==2) std::reverse(samples.begin()+static_cast<std::ptrdiff_t>(first),
                                          samples.begin()+static_cast<std::ptrdiff_t>(last+1));
    else if(operation==3)for(std::size_t i=first;i<=last;++i)samples[i]=-samples[i];
    else if(operation==4) {
        const auto old=samples;
        for(std::size_t i=first;i<=last;++i) {
            const auto previous=first==0&&last==samples.size()-1
                ? (i+samples.size()-1)%samples.size():std::max(first,i==0?0:i-1);
            const auto next=first==0&&last==samples.size()-1
                ? (i+1)%samples.size():std::min(last,i+1);
            samples[i]=0.25f*old[previous]+0.5f*old[i]+0.25f*old[next];
        }
    }
    invalidateTimeSpectrum(frame);
}
inline void fft(std::array<std::complex<double>,kWavetableFrameSize>& data,bool inverse) noexcept {
    constexpr auto count=kWavetableFrameSize;
    for(std::size_t i=1,j=0;i<count;++i) {
        std::size_t bit=count>>1;
        for(;j&bit;bit>>=1) j^=bit;
        j^=bit;
        if(i<j) std::swap(data[i],data[j]);
    }
    for(std::size_t length=2;length<=count;length<<=1) {
        const double angle=(inverse?2.0:-2.0)*juce::MathConstants<double>::pi/static_cast<double>(length);
        const std::complex<double> step{std::cos(angle),std::sin(angle)};
        for(std::size_t base=0;base<count;base+=length) {
            std::complex<double> phase{1,0};
            for(std::size_t i=0;i<length/2;++i) {
                const auto even=data[base+i],odd=data[base+i+length/2]*phase;
                data[base+i]=even+odd;data[base+i+length/2]=even-odd;phase*=step;
            }
        }
    }
    if(inverse) for(auto& value:data)value/=static_cast<double>(count);
}
class FrameMorpher {
public:
    FrameMorpher(const WavetableFrame& a,const WavetableFrame& b,MorphMethod method)
        :a_(a),b_(b),method_(method) {
        if(method_==MorphMethod::PhaseAligned || method_==MorphMethod::Hybrid)
            shift_=correlationShift(a,b);
        if(method_==MorphMethod::Spectral || method_==MorphMethod::Harmonic ||
           method_==MorphMethod::HarmonicShift || method_==MorphMethod::Hybrid) {
            for(std::size_t i=0;i<kWavetableFrameSize;++i) {
                spectrumA_[i]=a.samples[i];spectrumB_[i]=b.samples[i];
            }
            fft(spectrumA_,false);fft(spectrumB_,false);
        }
    }
    WavetableFrame generate(float t) const {
        WavetableFrame out;out.id=WavetableDocument::nextFrameId();
        t=std::clamp(t,0.0f,1.0f);
        auto aligned=[&](std::size_t i) {
            return a_.samples[i]*(1.0f-t)+b_.samples[(i+shift_)%kWavetableFrameSize]*t;
        };
        if(method_==MorphMethod::Crossfade || method_==MorphMethod::PhaseAligned) {
            for(std::size_t i=0;i<kWavetableFrameSize;++i)
                out.samples[i]=method_==MorphMethod::Crossfade
                    ? a_.samples[i]*(1.0f-t)+b_.samples[i]*t : aligned(i);
            return out;
        }
        auto transformed=spectrumA_;
        constexpr std::size_t last=kWavetableFrameSize/2;
        for(std::size_t h=0;h<=last;++h) {
            const auto x=spectrumA_[h],y=spectrumB_[h];
            const double magnitude=std::abs(x)*(1.0-t)+std::abs(y)*t;
            const double phaseA=std::arg(x),phaseB=std::arg(y);
            const double difference=std::atan2(std::sin(phaseB-phaseA),std::cos(phaseB-phaseA));
            const double phase=(method_==MorphMethod::Spectral || method_==MorphMethod::Hybrid)
                ? phaseA+static_cast<double>(t)*difference
                : (std::abs(x)>1.0e-9 ? phaseA : phaseB);
            transformed[h]=std::polar(magnitude,phase);
            if(h>0 && h<last) transformed[kWavetableFrameSize-h]=std::conj(transformed[h]);
        }
        if(method_==MorphMethod::HarmonicShift) {
            // Move each A harmonic toward the strongest nearby B harmonic.
            // Fractional destinations split energy only between adjacent bins.
            std::array<std::complex<double>,kWavetableFrameSize> shifted{};
            shifted[0]=transformed[0];shifted[last]=transformed[last];
            for(std::size_t h=1;h<last;++h) {
                std::size_t target=h;double strength=std::abs(spectrumB_[h]);
                for(std::size_t candidate=h>2?h-2:1;candidate<=std::min(last-1,h+2);++candidate) {
                    const double energy=std::abs(spectrumB_[candidate]);
                    if(energy>strength){strength=energy;target=candidate;}
                }
                const double at=static_cast<double>(h)+(static_cast<double>(target)-h)*t;
                const auto lo=static_cast<std::size_t>(std::floor(at));
                const auto hi=std::min(last-1,lo+1);
                const double fraction=at-static_cast<double>(lo);
                shifted[lo]+=transformed[h]*(1.0-fraction);
                shifted[hi]+=transformed[h]*fraction;
            }
            for(std::size_t h=1;h<last;++h) shifted[kWavetableFrameSize-h]=std::conj(shifted[h]);
            transformed=shifted;
        }
        transformed[0]={transformed[0].real(),0};transformed[last]={transformed[last].real(),0};
        fft(transformed,true);
        for(std::size_t i=0;i<kWavetableFrameSize;++i) {
            const double value=method_==MorphMethod::Hybrid
                ? 0.5*static_cast<double>(aligned(i))+0.5*transformed[i].real()
                : transformed[i].real();
            out.samples[i]=static_cast<float>(std::clamp(value,-1.0,1.0));
        }
        return out;
    }
private:
    const WavetableFrame& a_;const WavetableFrame& b_;
    MorphMethod method_;std::size_t shift_=0;
    std::array<std::complex<double>,kWavetableFrameSize> spectrumA_{},spectrumB_{};
};
inline bool densify(WavetableDocument& document,std::size_t target,MorphMethod method,MorphCurve curve) {
    const auto source=document.frames.size();
    if(source<2 || target<source || target>kMaxWavetableFrames) return false;
    if(target==source) return true;
    const auto anchors=document.frames; // immutable originals for the entire operation
    std::vector<WavetableFrame> output;output.reserve(target);
    std::vector<std::size_t> positions(source);
    for(std::size_t i=0;i<source;++i)
        positions[i]=(i*(target-1)+(source-1)/2)/(source-1);
    for(std::size_t pair=0;pair+1<source;++pair) {
        FrameMorpher morpher(anchors[pair],anchors[pair+1],method);
        if(pair==0) output.push_back(anchors[0]);
        const auto begin=positions[pair],end=positions[pair+1];
        for(std::size_t index=begin+1;index<end;++index) {
            const float t=static_cast<float>(index-begin)/static_cast<float>(end-begin);
            output.push_back(morpher.generate(morphCurve(t,curve)));
        }
        output.push_back(anchors[pair+1]);
    }
    if(output.size()!=target) return false;
    const auto selectedId=anchors[document.selectedFrame].id;
    document.frames=std::move(output);
    for(std::size_t i=0;i<document.frames.size();++i)
        if(document.frames[i].id==selectedId) {document.selectedFrame=i;break;}
    return true;
}
inline bool morphBetween(WavetableDocument& document,std::size_t first,std::size_t last,
                         std::size_t count,MorphMethod method,MorphCurve curve) {
    if(first>=last || last>=document.frames.size() || count<1 ||
       document.frames.size()+count>kMaxWavetableFrames) return false;
    const auto sourceA=document.frames[first],sourceB=document.frames[last];
    FrameMorpher morpher(sourceA,sourceB,method);
    std::vector<WavetableFrame> generated;generated.reserve(count);
    for(std::size_t i=1;i<=count;++i)
        generated.push_back(morpher.generate(morphCurve(static_cast<float>(i)/static_cast<float>(count+1),curve)));
    document.frames.insert(document.frames.begin()+static_cast<std::ptrdiff_t>(first+1),
                           std::make_move_iterator(generated.begin()),std::make_move_iterator(generated.end()));
    document.selectedFrame=first+1;
    return true;
}
}
