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
    shift%=kWavetableFrameSize;
    if(shift==0)return;
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
inline bool alignPhaseSelection(WavetableDocument& document,const std::vector<unsigned>& selected) {
    if(!document.valid() || selected.empty() || selected.front()>=document.frames.size())return false;
    const auto referenceIndex=selected.front()>0?selected.front()-1:selected.front();
    const auto reference=document.frames[referenceIndex];
    bool changed=false;
    for(const auto index:selected) {
        if(index>=document.frames.size() || index==referenceIndex)continue;
        const auto shift=correlationShift(reference,document.frames[index]);
        if(shift==0)continue;
        circularShift(document.frames[index],shift);
        changed=true;
    }
    return changed;
}
inline void alignZero(WavetableFrame& frame) {
    float peak=0.0f;
    for(const auto sample:frame.samples)peak=std::max(peak,std::abs(sample));
    if(peak<=1.0e-8f)return;
    const auto epsilon=peak*1.0e-6f;
    std::size_t best=0,distance=kWavetableFrameSize;
    for(std::size_t i=0;i<kWavetableFrameSize;++i) {
        const auto previous=frame.samples[(i+kWavetableFrameSize-1)%kWavetableFrameSize];
        if(previous< -epsilon && frame.samples[i]>= -epsilon) {
            const auto d=std::min(i,kWavetableFrameSize-i);
            if(d<distance){distance=d;best=i;}
        }
    }
    if(distance<kWavetableFrameSize && best!=0)circularShift(frame,best);
}
inline void processFrame(WavetableFrame& frame,int operation,
                         std::size_t first=0,std::size_t last=kWavetableFrameSize-1) {
    auto& samples=frame.samples;
    first=std::min(first,samples.size()-1);last=std::min(last,samples.size()-1);
    if(first>last || operation<1 || operation>4)return;
    const auto before=samples;
    if(operation==1) { // normalize
        float peak=0;for(std::size_t i=first;i<=last;++i)peak=std::max(peak,std::abs(samples[i]));
        if(peak<=1.0e-8f)return;
        for(std::size_t i=first;i<=last;++i)samples[i]/=peak;
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
    if(samples!=before)invalidateTimeSpectrum(frame);
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
                spectrumA_[i]=a.samples[i];
                spectrumB_[i]=method_==MorphMethod::Hybrid
                    ? b.samples[(i+shift_)%kWavetableFrameSize]:b.samples[i];
            }
            fft(spectrumA_,false);fft(spectrumB_,false);
            constexpr auto last=kWavetableFrameSize/2;
            for(std::size_t h=1;h<last;++h)
                spectralPeak_=std::max({spectralPeak_,std::abs(spectrumA_[h]),std::abs(spectrumB_[h])});
            spectralEpsilon_=std::max(1.0e-9,spectralPeak_*1.0e-6);
            if(method_==MorphMethod::HarmonicShift) {
                const auto activeThreshold=std::max(1.0e-8,spectralPeak_*1.0e-4);
                // Monotone rank correspondence cannot send many source partials
                // independently to one local peak. Unmatched partials fade in/out.
                for(std::size_t h=1;h<last;++h) {
                    if(std::abs(spectrumA_[h])>activeThreshold)activeA_[activeCountA_++]=h;
                    if(std::abs(spectrumB_[h])>activeThreshold)activeB_[activeCountB_++]=h;
                }
            }
        }
    }
    WavetableFrame generate(float t) const {
        WavetableFrame out;out.id=WavetableDocument::nextFrameId();
        t=std::clamp(t,0.0f,1.0f);
        // Preserve exact authoring endpoints, including their metadata-free samples.
        if(t==0.0f){out.samples=a_.samples;return out;}
        if(t==1.0f){out.samples=b_.samples;return out;}
        if(method_==MorphMethod::Crossfade || method_==MorphMethod::PhaseAligned) {
            for(std::size_t i=0;i<kWavetableFrameSize;++i)
                out.samples[i]=method_==MorphMethod::Crossfade
                    ? a_.samples[i]*(1.0f-t)+b_.samples[i]*t : static_cast<float>(alignedSample(i,t));
            return out;
        }
        std::array<std::complex<double>,kWavetableFrameSize> transformed{};
        constexpr std::size_t last=kWavetableFrameSize/2;
        if(method_==MorphMethod::HarmonicShift) {
            const auto matched=std::min(activeCountA_,activeCountB_);
            for(std::size_t j=0;j<matched;++j) {
                const auto source=activeA_[j],destination=activeB_[j];
                const auto amplitude=std::abs(spectrumA_[source])*(1.0-t)+
                                     std::abs(spectrumB_[destination])*t;
                const auto phase=std::arg(spectrumA_[source]);
                const auto position=static_cast<double>(source)*(1.0-t)+
                                    static_cast<double>(destination)*t;
                deposit(transformed,position,std::polar(amplitude,phase));
            }
            for(std::size_t j=matched;j<activeCountA_;++j) {
                const auto h=activeA_[j];
                transformed[h]+=spectrumA_[h]*(1.0-t);
            }
            for(std::size_t j=matched;j<activeCountB_;++j) {
                const auto h=activeB_[j];
                transformed[h]+=spectrumB_[h]*static_cast<double>(t);
            }
            // Harmonic transport deliberately excludes DC and Nyquist.
        } else {
            transformed[0]={spectrumA_[0].real()*(1.0-t)+spectrumB_[0].real()*t,0.0};
            transformed[last]={spectrumA_[last].real()*(1.0-t)+spectrumB_[last].real()*t,0.0};
            if(method_==MorphMethod::Harmonic)transformed[0]=transformed[last]={0.0,0.0};
            for(std::size_t h=1;h<last;++h) {
                const auto x=spectrumA_[h],y=spectrumB_[h];
                const auto magA=std::abs(x),magB=std::abs(y);
                const auto magnitude=magA*(1.0-t)+magB*t;
                if(magnitude<=spectralEpsilon_)continue;
                double phase=0.0;
                if(magA<=spectralEpsilon_)phase=std::arg(y);
                else if(magB<=spectralEpsilon_)phase=std::arg(x);
                else if(method_==MorphMethod::Harmonic) {
                    // Harmonic synthesis keeps each established partial coherent
                    // with A; unlike Spectral it does not sweep wrapped phase.
                    phase=std::arg(x);
                } else {
                    const auto phaseA=std::arg(x),phaseB=std::arg(y);
                    const auto delta=std::atan2(std::sin(phaseB-phaseA),std::cos(phaseB-phaseA));
                    phase=phaseA+static_cast<double>(t)*delta;
                }
                transformed[h]=std::polar(magnitude,phase);
            }
        }
        for(std::size_t h=1;h<last;++h)
            transformed[kWavetableFrameSize-h]=std::conj(transformed[h]);
        fft(transformed,true);
        const auto hybridWeight=method_==MorphMethod::Hybrid?hybridSpectralWeight(t):0.0;
        const auto hybridOffset=-signedShift()*t;
        for(std::size_t i=0;i<kWavetableFrameSize;++i) {
            const double value=method_==MorphMethod::Hybrid
                ? (1.0-hybridWeight)*alignedSample(i,t)+
                  hybridWeight*sampleCircularSignal(transformed,static_cast<double>(i)+hybridOffset)
                : transformed[i].real();
            out.samples[i]=static_cast<float>(std::clamp(value,-1.0,1.0));
        }
        return out;
    }
private:
    static double wrapPosition(double position) noexcept {
        constexpr auto size=static_cast<double>(kWavetableFrameSize);
        if(position<0.0)position+=size;
        else if(position>=size)position-=size;
        return position;
    }
    static double sampleCircular(const WavetableFrame& frame,double position) noexcept {
        position=wrapPosition(position);
        const auto first=static_cast<std::size_t>(position);
        const auto next=(first+1)%kWavetableFrameSize;
        const auto fraction=position-static_cast<double>(first);
        return frame.samples[first]*(1.0-fraction)+frame.samples[next]*fraction;
    }
    static double sampleCircularSignal(const std::array<std::complex<double>,kWavetableFrameSize>& signal,
                                       double position) noexcept {
        position=wrapPosition(position);
        const auto first=static_cast<std::size_t>(position);
        const auto fraction=position-static_cast<double>(first);
        return signal[first].real()*(1.0-fraction)+
               signal[(first+1)%kWavetableFrameSize].real()*fraction;
    }
    double signedShift() const noexcept {
        return shift_<=kWavetableFrameSize/2
            ? static_cast<double>(shift_)
            : static_cast<double>(shift_)-static_cast<double>(kWavetableFrameSize);
    }
    double alignedSample(std::size_t i,float t) const noexcept {
        const auto offset=signedShift();
        const auto a=sampleCircular(a_,static_cast<double>(i)-offset*t);
        const auto b=sampleCircular(b_,static_cast<double>(i)+offset*(1.0-t));
        return a*(1.0-t)+b*t;
    }
    static double hybridSpectralWeight(float t) noexcept {
        // Spectral evolution is strongest where the two shapes are most mixed;
        // sin² gives zero value and zero slope at both exact anchor boundaries.
        const auto s=std::sin(juce::MathConstants<double>::pi*t);
        return 0.35*s*s;
    }
    static void deposit(std::array<std::complex<double>,kWavetableFrameSize>& bins,
                        double position,std::complex<double> value) noexcept {
        constexpr auto last=kWavetableFrameSize/2;
        const auto low=std::clamp<std::size_t>(static_cast<std::size_t>(std::floor(position)),1,last-1);
        const auto high=std::min(last-1,low+1);
        const auto fraction=std::clamp(position-static_cast<double>(low),0.0,1.0);
        bins[low]+=value*(1.0-fraction);
        if(high!=low)bins[high]+=value*fraction;
    }
    const WavetableFrame& a_;const WavetableFrame& b_;
    MorphMethod method_;std::size_t shift_=0;
    std::array<std::complex<double>,kWavetableFrameSize> spectrumA_{},spectrumB_{};
    std::array<std::size_t,kWavetableFrameSize/2-1> activeA_{},activeB_{};
    std::size_t activeCountA_=0,activeCountB_=0;
    double spectralPeak_=0.0,spectralEpsilon_=1.0e-9;
};
inline bool densify(WavetableDocument& document,std::size_t target,MorphMethod method,MorphCurve curve) {
    const auto source=document.frames.size();
    if(!document.valid() || source<2 || target<source || target>kMaxWavetableFrames) return false;
    if(target==source) return true;
    const auto anchors=document.frames; // immutable originals for the entire operation
    std::vector<WavetableFrame> output;output.reserve(target);
    std::vector<std::size_t> positions(source);
    // Rounded normalized positions preserve exact originals. Since target>=source,
    // consecutive numerators differ by at least the divisor, so indices cannot collide.
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
    if(!document.valid() || first>=last || last-first!=1 || last>=document.frames.size() || count<1 ||
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
