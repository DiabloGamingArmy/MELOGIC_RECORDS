// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-graph-dsp-bus-routing-p02
// Origami FX effect registry and realtime DSP implementations.
//
// Every processor follows the FxProcessor contract: prepare() is the only
// place memory is allocated; reset()/process() are allocation- and lock-free,
// bounded, and produce finite output for any finite or non-finite input.
// Continuous controls are smoothed; discrete modes (ping-pong) switch at
// block boundaries.
#include "core/fx/FxGraph.h"
#include "core/fx/FxFilter.h"
#include "core/fx/SpectralTune.h"
#include "core/dsp/Comb.h"
#include <algorithm>
#include <cmath>
#include <vector>

namespace mct::origami::fx {
namespace {
constexpr float twoPi=6.28318530717958647692f;
constexpr float ln2=0.69314718055994530942f;

// ------------------------------------------------------------------ helpers

float dbToGain(float db) noexcept { return std::pow(10.0f,db*0.05f); }
float sane(float x) noexcept { return std::isfinite(x) ? std::clamp(x,-64.0f,64.0f) : 0.0f; }
// Smooth, bounded saturation used to keep recirculating paths finite.
float softLimit(float x) noexcept {
    const float a=std::abs(x);
    return a<=1.0f ? x : std::copysign(1.0f+std::tanh(a-1.0f),x);
}
float onePoleCoefficient(double sampleRate,float hz) noexcept {
    return 1.0f-std::exp(-twoPi*std::clamp(hz,1.0f,float(sampleRate)*0.45f)/float(sampleRate));
}

struct Smoothed {
    float value=0.0f,target=0.0f,coef=0.0f;
    void setTime(double sampleRate,double seconds) noexcept { coef=float(std::exp(-1.0/(seconds*sampleRate))); }
    void snap(float v) noexcept { value=target=v; }
    float next() noexcept {
        value=target+(value-target)*coef;
        if(std::abs(value-target)<1.0e-7f) value=target;
        return value;
    }
};

class DelayLine {
public:
    void prepare(std::size_t samples) {
        std::size_t size=1;
        while(size<samples+4) size<<=1;
        data_.assign(size,0.0f);
        mask_=size-1;
        write_=0;
    }
    void reset() noexcept { std::fill(data_.begin(),data_.end(),0.0f); write_=0; }
    void push(float x) noexcept { data_[write_]=x; write_=(write_+1)&mask_; }
    // delay >= 1: 1 returns the most recently pushed sample.
    float read(float delay) const noexcept {
        delay=std::clamp(delay,1.0f,float(mask_-2));
        const auto whole=static_cast<std::size_t>(delay);
        const float frac=delay-float(whole);
        const float a=data_[(write_-whole)&mask_];
        const float b=data_[(write_-whole-1)&mask_];
        return a+(b-a)*frac;
    }
    std::size_t capacity() const noexcept { return mask_; }
private:
    std::vector<float> data_;
    std::size_t mask_=0,write_=0;
};

// Schroeder allpass with (smoothed) fractional length.
struct Allpass {
    DelayLine line;
    Smoothed length;
    float process(float x,float g) noexcept {
        const float d=line.read(length.next());
        const float w=x+g*d;
        line.push(w);
        return d-g*w;
    }
};

// Parameter IDs are persistent. P01 IDs for Drive/Delay/Reverb are retained.
using P=FxParameterPage;
using C=FxParameterCurve;
constexpr FxParameterDescriptor driveParameters[]{
    {1,"drive","DRIVE",0.333f,P::Main,true,0.0f,36.0f,C::Linear,"dB"},
    {2,"tone","TONE",0.677f,P::Main,true,600.0f,18000.0f,C::Exponential,"Hz"},
    {3,"mix","MIX",1.0f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {4,"bias","BIAS",0.5f,P::Advanced,false,-0.5f,0.5f,C::Linear,""},
};
constexpr FxParameterDescriptor delayParameters[]{
    {1,"time","TIME",0.7707f,P::Main,true,1.0f,2000.0f,C::Exponential,"ms"},
    {2,"feedback","FB",0.368f,P::Main,true,0.0f,0.95f,C::Linear,"%"},
    {3,"mix","MIX",0.30f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {4,"damp","DAMP",0.30f,P::Main,false,0.0f,1.0f,C::Linear,"%"},
    {5,"spread","SPREAD",0.25f,P::Main,false,0.0f,1.0f,C::Linear,"%"},
    {6,"pingpong","PING PONG",0.0f,P::Main,false,0.0f,1.0f,C::Choice,"",2},
};
constexpr FxParameterDescriptor reverbParameters[]{
    {1,"size","SIZE",0.60f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {2,"decay","DECAY",0.548f,P::Main,true,0.2f,20.0f,C::Exponential,"s"},
    {3,"mix","MIX",0.25f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {4,"damp","DAMP",0.40f,P::Main,false,0.0f,1.0f,C::Linear,"%"},
    {5,"predelay","PRE-DELAY",0.05f,P::Advanced,false,0.0f,200.0f,C::Linear,"ms"},
    {6,"width","WIDTH",1.0f,P::Main,false,0.0f,1.0f,C::Linear,"%"},
};
constexpr FxParameterDescriptor chorusParameters[]{
    {1,"rate","RATE",0.602f,P::Main,true,0.05f,5.0f,C::Exponential,"Hz"},
    {2,"depth","DEPTH",0.5f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {3,"mix","MIX",0.5f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {4,"delay","DELAY",0.286f,P::Main,false,4.0f,25.0f,C::Linear,"ms"},
    {5,"spread","SPREAD",0.5f,P::Main,false,0.0f,1.0f,C::Linear,"%"},
};
constexpr FxParameterDescriptor combParameters[]{
    {1,"frequency","FREQ",0.521f,P::Main,true,20.0f,2000.0f,C::Exponential,"Hz"},
    {2,"feedback","FB",0.938f,P::Main,true,-0.97f,0.97f,C::Linear,"%"},
    {3,"mix","MIX",0.5f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {4,"damp","DAMP",0.2f,P::Main,false,0.0f,1.0f,C::Linear,"%"},
};
constexpr FxParameterDescriptor diffuseParameters[]{
    {1,"amount","AMOUNT",0.6f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {2,"size","SIZE",0.5f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {3,"mix","MIX",0.5f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
};
constexpr FxParameterDescriptor limiterParameters[]{
    {1,"gain","GAIN",0.0f,P::Main,true,0.0f,24.0f,C::Linear,"dB"},
    {2,"ceiling","CEILING",0.9875f,P::Main,true,-24.0f,0.0f,C::Linear,"dB"},
    {3,"release","RELEASE",0.602f,P::Main,true,5.0f,500.0f,C::Exponential,"ms"},
};


// P04 tables. Ids are persistent; descriptor order is the latched order.

// FILTER keeps COMB's ids 1-4 (freq, feedback, mix, damp) for migration.
constexpr FxParameterDescriptor filterParameters[]{
    {1,"frequency","FREQ",0.566f,P::Main,true,20.0f,20000.0f,C::Exponential,"Hz"},
    {6,"resonance","RES",0.109f,P::Main,true,0.5f,12.0f,C::Exponential,"",0,nullptr,5,0xFFu},
    {3,"mix","MIX",1.0f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {5,"type","TYPE",0.0f,P::Main,false,0.0f,float(dsp::filterTypeLabels.size()-1),C::Choice,"",int(dsp::filterTypeLabels.size()),dsp::filterTypeLabels.data()},
    {7,"gain","GAIN",0.5f,P::Main,false,-24.0f,24.0f,C::Linear,"dB",0,nullptr,5,0xD0u},
    {8,"drive","DRIVE",0.0f,P::Advanced,false,0.0f,24.0f,C::Linear,"dB",0,nullptr,5,0xFFu},
    {2,"feedback","FB",0.938f,P::Main,true,-0.97f,0.97f,C::Linear,"%",0,nullptr,5,0x100u},
    {4,"damp","DAMP",0.2f,P::Main,false,0.0f,1.0f,C::Linear,"%",0,nullptr,5,0x100u},
};
constexpr const char* compressorModes[]{"SINGLE","MULTIBAND"};
constexpr const char* detectModes[]{"PEAK","RMS"};
constexpr std::uint32_t singleBand=0x1u,multiBand=0x2u;
#define ORIGAMI_COMP_BAND(base,name,label) \
    {FxParameterId(base),name "threshold",label " THR",0.7f,P::Main,true,-60.0f,0.0f,C::Linear,"dB",0,nullptr,1,multiBand}, \
    {FxParameterId(base+1),name "ratio",label " RATIO",0.463f,P::Main,false,1.0f,20.0f,C::Exponential,":1",0,nullptr,1,multiBand}, \
    {FxParameterId(base+2),name "attack",label " ATK",0.606f,P::Main,false,0.1f,200.0f,C::Exponential,"ms",0,nullptr,1,multiBand}, \
    {FxParameterId(base+3),name "release",label " REL",0.530f,P::Main,false,5.0f,2000.0f,C::Exponential,"ms",0,nullptr,1,multiBand}, \
    {FxParameterId(base+4),name "gain",label " GAIN",0.5f,P::Main,false,-24.0f,24.0f,C::Linear,"dB",0,nullptr,1,multiBand}
constexpr FxParameterDescriptor compressorParameters[]{
    {1,"mode","MODE",0.0f,P::Main,false,0.0f,1.0f,C::Choice,"",2,compressorModes},
    {2,"threshold","THRESH",0.7f,P::Main,true,-60.0f,0.0f,C::Linear,"dB",0,nullptr,1,singleBand},
    {3,"ratio","RATIO",0.463f,P::Main,true,1.0f,20.0f,C::Exponential,":1",0,nullptr,1,singleBand},
    {4,"attack","ATTACK",0.606f,P::Main,false,0.1f,200.0f,C::Exponential,"ms",0,nullptr,1,singleBand},
    {5,"release","RELEASE",0.530f,P::Main,false,5.0f,2000.0f,C::Exponential,"ms",0,nullptr,1,singleBand},
    {7,"makeup","MAKEUP",0.0f,P::Main,false,0.0f,24.0f,C::Linear,"dB",0,nullptr,1,singleBand},
    {8,"mix","MIX",1.0f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {6,"knee","KNEE",0.25f,P::Advanced,false,0.0f,24.0f,C::Linear,"dB"},
    {9,"detect","DETECT",1.0f,P::Advanced,false,0.0f,1.0f,C::Choice,"",2,detectModes},
    {10,"xoverlow","X-OVER LO",0.5f,P::Main,false,40.0f,1000.0f,C::Exponential,"Hz",0,nullptr,1,multiBand},
    {11,"xoverhigh","X-OVER HI",0.442f,P::Main,false,1000.0f,12000.0f,C::Exponential,"Hz",0,nullptr,1,multiBand},
    ORIGAMI_COMP_BAND(12,"low","LOW"),
    ORIGAMI_COMP_BAND(17,"mid","MID"),
    ORIGAMI_COMP_BAND(22,"high","HIGH"),
};
#undef ORIGAMI_COMP_BAND
constexpr const char* eqTypes[]{"LOW CUT","LOW SHELF","BELL","NOTCH","HIGH SHELF","HIGH CUT"};
constexpr const char* onOff[]{"OFF","ON"};
// 8 bands with stable ids 100 + band*10 + {1 on, 2 type, 3 freq, 4 gain, 5 q}.
#define ORIGAMI_EQ_BAND(b,label,on,type,freq,quick) \
    {FxParameterId(100+b*10+1),"band" #b "on","B" label " ON",on,P::Main,false,0.0f,1.0f,C::Choice,"",2,onOff}, \
    {FxParameterId(100+b*10+2),"band" #b "type","B" label " TYPE",type,P::Main,false,0.0f,5.0f,C::Choice,"",6,eqTypes}, \
    {FxParameterId(100+b*10+3),"band" #b "freq","B" label " FREQ",freq,P::Main,quick,20.0f,20000.0f,C::Exponential,"Hz"}, \
    {FxParameterId(100+b*10+4),"band" #b "gain","B" label " GAIN",0.5f,P::Main,quick,-24.0f,24.0f,C::Linear,"dB"}, \
    {FxParameterId(100+b*10+5),"band" #b "q","B" label " Q",0.232f,P::Main,quick,0.3f,12.0f,C::Exponential,""}
constexpr FxParameterDescriptor equalizerParameters[]{
    ORIGAMI_EQ_BAND(0,"1",1.0f,0.2f,0.233f,false),
    ORIGAMI_EQ_BAND(1,"2",1.0f,0.4f,0.434f,false),
    ORIGAMI_EQ_BAND(2,"3",1.0f,0.4f,0.667f,true),
    ORIGAMI_EQ_BAND(3,"4",1.0f,0.8f,0.867f,false),
    ORIGAMI_EQ_BAND(4,"5",0.0f,0.4f,0.566f,false),
    ORIGAMI_EQ_BAND(5,"6",0.0f,0.4f,0.566f,false),
    ORIGAMI_EQ_BAND(6,"7",0.0f,0.4f,0.566f,false),
    ORIGAMI_EQ_BAND(7,"8",0.0f,0.4f,0.566f,false),
};
#undef ORIGAMI_EQ_BAND
constexpr FxParameterDescriptor flangerParameters[]{
    {1,"rate","RATE",0.436f,P::Main,true,0.02f,10.0f,C::Exponential,"Hz"},
    {2,"depth","DEPTH",0.7f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {3,"feedback","FB",0.763f,P::Main,true,-0.95f,0.95f,C::Linear,"%"},
    {4,"delay","DELAY",0.5f,P::Main,false,0.1f,10.0f,C::Exponential,"ms"},
    {5,"mix","MIX",0.5f,P::Main,false,0.0f,1.0f,C::Linear,"%"},
    {6,"spread","SPREAD",0.5f,P::Advanced,false,0.0f,1.0f,C::Linear,"%"},
};
constexpr const char* phaserStages[]{"2","4","6","8","10","12"};
constexpr FxParameterDescriptor phaserParameters[]{
    {1,"rate","RATE",0.482f,P::Main,true,0.02f,10.0f,C::Exponential,"Hz"},
    {2,"depth","DEPTH",0.7f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {3,"feedback","FB",0.722f,P::Main,false,-0.9f,0.9f,C::Linear,"%"},
    {4,"center","CENTER",0.4745f,P::Main,false,100.0f,8000.0f,C::Exponential,"Hz"},
    {5,"stages","STAGES",0.2f,P::Main,false,0.0f,5.0f,C::Choice,"",6,phaserStages},
    {6,"mix","MIX",0.5f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {7,"spread","SPREAD",0.5f,P::Advanced,false,0.0f,1.0f,C::Linear,"%"},
};
constexpr const char* spatialVoices[]{"2","3","4"};
constexpr FxParameterDescriptor spatialParameters[]{
    {1,"amount","AMOUNT",0.5f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {2,"width","WIDTH",0.6f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {3,"mix","MIX",0.5f,P::Main,true,0.0f,1.0f,C::Linear,"%"},
    {4,"voices","VOICES",1.0f,P::Main,false,0.0f,2.0f,C::Choice,"",3,spatialVoices},
    {5,"detune","DETUNE",0.3f,P::Main,false,0.0f,1.0f,C::Linear,"%"},
    {6,"depth","DEPTH",0.5f,P::Main,false,0.0f,1.0f,C::Linear,"%"},
};
constexpr const char* polarityModes[]{"NORMAL","INVERT"};
constexpr FxParameterDescriptor gainParameters[]{
    {1,"gain","GAIN",0.6667f,P::Main,true,-48.0f,24.0f,C::Linear,"dB"},
    {2,"polarity","POLARITY",0.0f,P::Main,false,0.0f,1.0f,C::Choice,"",2,polarityModes},
};
constexpr FxParameterDescriptor stereoUtilityParameters[]{
    {1,"width","WIDTH",0.5f,P::Main,true,0.0f,2.0f,C::Linear,"%"},
    {2,"balance","BALANCE",0.5f,P::Main,true,-1.0f,1.0f,C::Linear,""},
    {3,"mono","MONO",0.0f,P::Main,false,0.0f,1.0f,C::Choice,"",2,onOff},
};

// Resolved statically: no registry or type lookup on the audio thread.
template<std::size_t N>
float param(const FxParameterDescriptor (&table)[N],std::size_t index,const float* normalized) noexcept {
    return fxParameterValue(table[index],normalized[index]);
}

// ------------------------------------------------------------------ DRIVE
// First-order antiderivative anti-aliased (ADAA) tanh saturation. ADAA gives
// most of the alias suppression of 2x oversampling at a fraction of the cost.
class DriveFx final : public FxProcessor {
public:
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        for(auto* s:{&gain_,&mix_,&bias_,&tone_}) s->setTime(sampleRate,0.02);
        dcR_=1.0f-twoPi*12.0f/float(sampleRate);
        reset();
        primed_=false;
    }
    void reset() noexcept override {
        for(int c=0;c<2;++c) { prev_[c]=0.0f; lp_[c]=0.0f; dcX_[c]=0.0f; dcY_[c]=0.0f; dry_[c]=0.0f; }
    }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        gain_.target=dbToGain(param(driveParameters,0,p));
        tone_.target=onePoleCoefficient(sampleRate_,param(driveParameters,1,p));
        mix_.target=param(driveParameters,2,p);
        bias_.target=param(driveParameters,3,p);
        if(!primed_) { for(auto* s:{&gain_,&mix_,&bias_,&tone_}) s->snap(s->target); primed_=true; }
        float* channels[2]{left,right};
        for(int i=0;i<samples;++i) {
            const float g=gain_.next(),m=mix_.next(),b=bias_.next(),a=tone_.next();
            const float makeup=1.0f/std::sqrt(g);
            for(int c=0;c<2;++c) {
                const float x=sane(channels[c][i]);
                const float u=g*x+b;
                const float y=adaa(u,prev_[c]);
                prev_[c]=u;
                const float blocked=y-dcX_[c]+dcR_*dcY_[c];
                dcX_[c]=y; dcY_[c]=blocked;
                lp_[c]+=a*(blocked-lp_[c]);
                // ADAA delays the wet path by half a sample; match the dry path.
                const float dry=0.5f*(x+dry_[c]);
                dry_[c]=x;
                channels[c][i]=dry+m*(lp_[c]*makeup-dry);
            }
        }
    }
private:
    static float logCosh(float x) noexcept { const float a=std::abs(x); return a+std::log1p(std::exp(-2.0f*a))-ln2; }
    static float adaa(float x,float previous) noexcept {
        const float d=x-previous;
        if(std::abs(d)<1.0e-4f) return std::tanh(0.5f*(x+previous));
        return (logCosh(x)-logCosh(previous))/d;
    }
    double sampleRate_=48000.0;
    Smoothed gain_,mix_,bias_,tone_;
    float dcR_=0.999f;
    float prev_[2]{},lp_[2]{},dcX_[2]{},dcY_[2]{},dry_[2]{};
    bool primed_=false;
};

// ------------------------------------------------------------------ DELAY
class DelayFx final : public FxProcessor {
public:
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        for(auto& line:lines_) line.prepare(static_cast<std::size_t>(sampleRate*2.7));
        for(auto* s:{&timeL_,&timeR_}) s->setTime(sampleRate,0.12);
        for(auto* s:{&feedback_,&mix_,&damp_}) s->setTime(sampleRate,0.02);
        reset();
        primed_=false;
    }
    void reset() noexcept override {
        for(auto& line:lines_) line.reset();
        lp_[0]=lp_[1]=0.0f;
    }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        const float maxDelay=float(lines_[0].capacity())-8.0f;
        const float time=param(delayParameters,0,p)*float(sampleRate_)*0.001f;
        const float spread=param(delayParameters,4,p);
        timeL_.target=std::clamp(time,1.0f,maxDelay);
        timeR_.target=std::clamp(time*(1.0f+0.3f*spread),1.0f,maxDelay);
        feedback_.target=param(delayParameters,1,p);
        mix_.target=param(delayParameters,2,p);
        // DAMP 0 = bright (18 kHz), 1 = dark (1 kHz) feedback filter.
        damp_.target=onePoleCoefficient(sampleRate_,18000.0f*std::pow(1000.0f/18000.0f,param(delayParameters,3,p)));
        const bool pingPong=param(delayParameters,5,p)>=0.5f;
        if(!primed_) { for(auto* s:{&timeL_,&timeR_,&feedback_,&mix_,&damp_}) s->snap(s->target); primed_=true; }
        for(int i=0;i<samples;++i) {
            const float xl=sane(left[i]),xr=sane(right[i]);
            const float yl=lines_[0].read(timeL_.next()),yr=lines_[1].read(timeR_.next());
            const float a=damp_.next();
            lp_[0]+=a*(yl-lp_[0]);
            lp_[1]+=a*(yr-lp_[1]);
            const float f=feedback_.next();
            if(pingPong) {
                lines_[0].push(softLimit(0.5f*(xl+xr)+f*lp_[1]));
                lines_[1].push(softLimit(f*lp_[0]));
            } else {
                lines_[0].push(softLimit(xl+f*lp_[0]));
                lines_[1].push(softLimit(xr+f*lp_[1]));
            }
            const float m=mix_.next();
            left[i]=xl+m*(yl-xl);
            right[i]=xr+m*(yr-xr);
        }
    }
private:
    double sampleRate_=48000.0;
    DelayLine lines_[2];
    Smoothed timeL_,timeR_,feedback_,mix_,damp_;
    float lp_[2]{};
    bool primed_=false;
};

// ------------------------------------------------------------------ REVERB
// 8-line feedback delay network with Householder mixing, per-line damping,
// input allpass diffusion and pre-delay. Orthogonal feedback with |g|<1 and
// unity-bounded damping filters keeps the network unconditionally stable.
class ReverbFx final : public FxProcessor {
public:
    static constexpr int lines=8;
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        const float ms=float(sampleRate)*0.001f;
        for(int i=0;i<lines;++i) {
            lines_[i].prepare(static_cast<std::size_t>(baseMs[i]*maxScale*ms)+16);
            length_[i].setTime(sampleRate,0.25);
        }
        predelay_.prepare(static_cast<std::size_t>(0.21*sampleRate));
        for(int i=0;i<4;++i) {
            diffusers_[i].line.prepare(static_cast<std::size_t>(diffuseMs[i]*ms)+8);
            diffusers_[i].length.snap(diffuseMs[i]*ms);
        }
        for(auto* s:{&mix_,&width_,&damp_,&pre_}) s->setTime(sampleRate,0.03);
        reset();
        primed_=false;
    }
    void reset() noexcept override {
        for(auto& l:lines_) l.reset();
        for(auto& d:diffusers_) d.line.reset();
        predelay_.reset();
        std::fill(std::begin(lp_),std::end(lp_),0.0f);
    }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        const float ms=float(sampleRate_)*0.001f;
        const float scale=minScale+(maxScale-minScale)*param(reverbParameters,0,p);
        const float rt60=param(reverbParameters,1,p);
        mix_.target=param(reverbParameters,2,p);
        damp_.target=onePoleCoefficient(sampleRate_,18000.0f*std::pow(1500.0f/18000.0f,param(reverbParameters,3,p)));
        pre_.target=std::max(1.0f,param(reverbParameters,4,p)*ms);
        width_.target=param(reverbParameters,5,p);
        for(int i=0;i<lines;++i) length_[i].target=baseMs[i]*scale*ms;
        if(!primed_) {
            for(auto* s:{&mix_,&width_,&damp_,&pre_}) s->snap(s->target);
            for(auto& l:length_) l.snap(l.target);
            primed_=true;
        }
        // Per-line decay gains from RT60 and the current (smoothed) lengths.
        float gains[lines];
        for(int i=0;i<lines;++i) gains[i]=std::pow(10.0f,-3.0f*length_[i].value/(float(sampleRate_)*rt60));
        for(int n=0;n<samples;++n) {
            const float xl=sane(left[n]),xr=sane(right[n]);
            predelay_.push(0.5f*(xl+xr));
            float s=predelay_.read(pre_.next());
            for(auto& d:diffusers_) s=d.process(s,0.62f);
            float o[lines];
            float sum=0.0f;
            for(int i=0;i<lines;++i) { o[i]=lines_[i].read(length_[i].next()); sum+=o[i]; }
            const float householder=sum*(2.0f/float(lines));
            const float a=damp_.next();
            float wl=0.0f,wr=0.0f;
            for(int i=0;i<lines;++i) {
                const float v=o[i]-householder;
                lp_[i]+=a*(v-lp_[i]);
                lines_[i].push(softLimit(s*inputSign[i]*0.35f+gains[i]*lp_[i]));
                wl+=o[i]*leftSign[i];
                wr+=o[i]*rightSign[i];
            }
            wl*=0.35f; wr*=0.35f;
            const float w=width_.next();
            const float mid=0.5f*(wl+wr),side=0.5f*(wl-wr)*w;
            wl=mid+side; wr=mid-side;
            const float m=mix_.next();
            left[n]=xl+m*(wl-xl);
            right[n]=xr+m*(wr-xr);
        }
    }
private:
    static constexpr float minScale=0.35f,maxScale=1.6f;
    static constexpr float baseMs[lines]{29.7f,37.1f,41.1f,43.7f,53.3f,59.9f,67.7f,73.1f};
    static constexpr float diffuseMs[4]{4.77f,3.59f,12.73f,9.30f};
    static constexpr float inputSign[lines]{1,-1,1,-1,1,-1,1,-1};
    static constexpr float leftSign[lines]{1,1,-1,1,-1,1,1,-1};
    static constexpr float rightSign[lines]{1,-1,1,1,1,-1,-1,1};
    double sampleRate_=48000.0;
    DelayLine lines_[lines];
    Smoothed length_[lines];
    DelayLine predelay_;
    Allpass diffusers_[4];
    Smoothed mix_,width_,damp_,pre_;
    float lp_[lines]{};
    bool primed_=false;
};

// ------------------------------------------------------------------ CHORUS
class ChorusFx final : public FxProcessor {
public:
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        for(auto& l:lines_) l.prepare(static_cast<std::size_t>(0.05*sampleRate));
        for(auto* s:{&base_,&depth_,&mix_,&offset_}) s->setTime(sampleRate,0.05);
        reset();
        primed_=false;
    }
    void reset() noexcept override { for(auto& l:lines_) l.reset(); phase_=0.0f; }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        const float ms=float(sampleRate_)*0.001f;
        const float increment=param(chorusParameters,0,p)/float(sampleRate_);
        base_.target=param(chorusParameters,3,p)*ms;
        depth_.target=std::min(param(chorusParameters,1,p)*5.0f*ms,base_.target-ms);
        mix_.target=param(chorusParameters,2,p);
        offset_.target=param(chorusParameters,4,p)*0.5f;
        if(!primed_) { for(auto* s:{&base_,&depth_,&mix_,&offset_}) s->snap(s->target); primed_=true; }
        for(int i=0;i<samples;++i) {
            const float xl=sane(left[i]),xr=sane(right[i]);
            const float b=base_.next(),d=depth_.next(),o=offset_.next(),m=mix_.next();
            lines_[0].push(xl); lines_[1].push(xr);
            const float yl=lines_[0].read(b+d*std::sin(twoPi*phase_));
            const float yr=lines_[1].read(b+d*std::sin(twoPi*(phase_+o)));
            phase_+=increment;
            if(phase_>=1.0f) phase_-=1.0f;
            left[i]=xl+m*(yl-xl);
            right[i]=xr+m*(yr-xr);
        }
    }
private:
    double sampleRate_=48000.0;
    DelayLine lines_[2];
    Smoothed base_,depth_,mix_,offset_;
    float phase_=0.0f;
    bool primed_=false;
};

// ------------------------------------------------------------------ COMB
// Tuned feedback comb. Wet output is scaled by sqrt(1-|fb|) so high feedback
// rings without a proportional gain explosion; the loop is soft-limited.
class CombFx final : public FxProcessor {
public:
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        std::size_t size=1;while(size<std::size_t(sampleRate/15.0)+4) size<<=1;
        for(int c=0;c<2;++c) {storage_[c].assign(size,0);state_[c].bind(storage_[c].data(),size);}
        period_.setTime(sampleRate,0.05);
        for(auto* s:{&feedback_,&mix_,&damp_}) s->setTime(sampleRate,0.02);
        reset();
        primed_=false;
    }
    void reset() noexcept override {for(auto& state:state_) state.reset();}
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        period_.target=float(sampleRate_)/param(combParameters,0,p);
        feedback_.target=param(combParameters,1,p);
        mix_.target=param(combParameters,2,p);
        damp_.target=onePoleCoefficient(sampleRate_,18000.0f*std::pow(1000.0f/18000.0f,param(combParameters,3,p)));
        if(!primed_) { for(auto* s:{&period_,&feedback_,&mix_,&damp_}) s->snap(s->target); primed_=true; }
        float* channels[2]{left,right};
        for(int i=0;i<samples;++i) {
            const float d=period_.next(),f=feedback_.next(),m=mix_.next(),a=damp_.next();
            const dsp::CombCoefficients coefficients{d,f,std::sqrt(1.f-std::abs(f)),a};
            for(int c=0;c<2;++c) {const float x=sane(channels[c][i]);channels[c][i]=x+m*(state_[c].next(x,coefficients)-x);}
        }
    }
private:
    double sampleRate_=48000.0;
    std::vector<float> storage_[2];dsp::CombState state_[2];
    Smoothed period_,feedback_,mix_,damp_;
    bool primed_=false;
};

// ------------------------------------------------------------------ DIFFUSE
class DiffuseFx final : public FxProcessor {
public:
    static constexpr int stages=6;
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        const float ms=float(sampleRate)*0.001f;
        for(int c=0;c<2;++c) for(int s=0;s<stages;++s) {
            auto& ap=allpass_[c][s];
            ap.line.prepare(static_cast<std::size_t>(stageMs[c][s]*maxScale*ms)+8);
            ap.length.setTime(sampleRate,0.08);
        }
        for(auto* s:{&amount_,&mix_}) s->setTime(sampleRate,0.03);
        reset();
        primed_=false;
    }
    void reset() noexcept override { for(auto& c:allpass_) for(auto& ap:c) ap.line.reset(); }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        const float ms=float(sampleRate_)*0.001f;
        const float scale=minScale+(maxScale-minScale)*param(diffuseParameters,1,p);
        amount_.target=param(diffuseParameters,0,p)*0.75f;
        mix_.target=param(diffuseParameters,2,p);
        for(int c=0;c<2;++c) for(int s=0;s<stages;++s) allpass_[c][s].length.target=stageMs[c][s]*scale*ms;
        if(!primed_) {
            for(auto* s:{&amount_,&mix_}) s->snap(s->target);
            for(auto& c:allpass_) for(auto& ap:c) ap.length.snap(ap.length.target);
            primed_=true;
        }
        float* channels[2]{left,right};
        for(int i=0;i<samples;++i) {
            const float g=amount_.next(),m=mix_.next();
            for(int c=0;c<2;++c) {
                const float x=sane(channels[c][i]);
                float y=x;
                for(auto& ap:allpass_[c]) y=ap.process(y,g);
                channels[c][i]=x+m*(y-x);
            }
        }
    }
private:
    static constexpr float minScale=0.3f,maxScale=2.0f;
    static constexpr float stageMs[2][stages]{{1.31f,2.17f,3.73f,5.27f,7.93f,11.31f},{1.69f,2.39f,3.11f,5.87f,7.07f,12.71f}};
    double sampleRate_=48000.0;
    Allpass allpass_[2][stages];
    Smoothed amount_,mix_;
    bool primed_=false;
};

// ------------------------------------------------------------------ LIMITER
// Zero-latency sample-peak limiter: instantaneous attack guarantees the
// output never exceeds the ceiling, so no lookahead/PDC is required.
class LimiterFx final : public FxProcessor {
public:
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        for(auto* s:{&gain_,&ceiling_}) s->setTime(sampleRate,0.02);
        reset();
        primed_=false;
    }
    void reset() noexcept override { envelope_=1.0f; }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        gain_.target=dbToGain(param(limiterParameters,0,p));
        ceiling_.target=dbToGain(param(limiterParameters,1,p));
        const float release=float(std::exp(-1.0/(double(param(limiterParameters,2,p))*0.001*sampleRate_)));
        if(!primed_) { for(auto* s:{&gain_,&ceiling_}) s->snap(s->target); primed_=true; }
        for(int i=0;i<samples;++i) {
            const float g=gain_.next(),c=ceiling_.next();
            const float l=sane(left[i])*g,r=sane(right[i])*g;
            const float peak=std::max(std::abs(l),std::abs(r));
            const float target=peak>c ? c/peak : 1.0f;
            envelope_=target<envelope_ ? target : target+(envelope_-target)*release;
            left[i]=l*envelope_;
            right[i]=r*envelope_;
        }
    }
private:
    double sampleRate_=48000.0;
    Smoothed gain_,ceiling_;
    float envelope_=1.0f;
    bool primed_=false;
};


template<std::size_t N> int choice(const FxParameterDescriptor (&table)[N],std::size_t index,const float* normalized) noexcept {
    return fxChoiceIndex(table[index],normalized[index]);
}

// ------------------------------------------------------------------ FILTER
// Multi-mode TPT state-variable filter (shared primitive with EQ/PHASER and
// the UI response curves). COMB mode reuses the tuned feedback comb DSP.
class FilterFx final : public FxProcessor {
public:
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        comb_.prepare(sampleRate);
        for(auto* s:{&frequency_,&q_,&gain_,&mix_,&drive_}) s->setTime(sampleRate,0.02);
        reset();
        primed_=false;
    }
    void reset() noexcept override { for(auto& st:state_) st.reset(); comb_.reset(); }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        const int type=choice(filterParameters,3,p);
        if(type!=lastType_) { reset(); lastType_=type; }
        if(type==8) {
            // COMB's own parameter space: frequency 20-2000 Hz, then fb/mix/damp.
            const float hz=std::clamp(param(filterParameters,0,p),20.0f,2000.0f);
            const float combParams[4]{std::log(hz/20.0f)/std::log(100.0f),p[6],p[2],p[7]};
            comb_.process(left,right,samples,combParams);
            return;
        }
        frequency_.target=std::log(param(filterParameters,0,p));
        q_.target=param(filterParameters,1,p);
        mix_.target=param(filterParameters,2,p);
        gain_.target=param(filterParameters,4,p);
        drive_.target=dbToGain(param(filterParameters,5,p));
        if(!primed_) { for(auto* s:{&frequency_,&q_,&gain_,&mix_,&drive_}) s->snap(s->target); primed_=true; }
        const auto shape=static_cast<SvfShape>(std::clamp(type,0,7));
        for(int i=0;i<samples;++i) {
            const float f=frequency_.next(),q=q_.next(),g=gain_.next(),m=mix_.next(),d=drive_.next();
            if((i&15)==0) coefficients_=svfDesign(shape,std::exp(f),q,g,sampleRate_);
            const float makeup=1.0f/std::sqrt(d);
            float* channels[2]{left,right};
            for(int c=0;c<2;++c) {
                const float x=sane(channels[c][i]);
                const float in=d>1.006f ? std::tanh(d*x)*makeup : x;
                const float y=state_[c].process(in,coefficients_);
                channels[c][i]=x+m*(y-x);
            }
        }
    }
private:
    double sampleRate_=48000.0;
    CombFx comb_;
    SvfState state_[2];
    SvfCoefficients coefficients_{};
    Smoothed frequency_,q_,gain_,mix_,drive_;
    int lastType_=-1;
    bool primed_=false;
};

// ------------------------------------------------------------------ COMPRESSOR
// Feed-forward, stereo-linked, soft-knee gain computer in the dB domain with
// attack/release smoothing of the gain reduction. MULTIBAND splits into three
// bands with Linkwitz-Riley 4th-order crossovers (the low band is all-pass
// compensated at the upper crossover so the unity-gain sum is magnitude-flat)
// and compresses each band independently. Only the active mode is processed.
class CompressorFx final : public FxProcessor {
public:
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        rmsCoef_=float(std::exp(-1.0/(0.01*sampleRate)));
        for(auto* s:{&makeup_,&mix_}) s->setTime(sampleRate,0.02);
        reset();
        primed_=false;
    }
    void reset() noexcept override {
        for(auto& d:detectors_) d={};
        for(auto& c:crossover_) c={};
    }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        const int mode=choice(compressorParameters,0,p);
        if(mode!=lastMode_) { reset(); lastMode_=mode; }
        const bool rms=choice(compressorParameters,8,p)==1;
        const float knee=param(compressorParameters,7,p);
        mix_.target=param(compressorParameters,6,p);
        makeup_.target=mode==0 ? param(compressorParameters,5,p) : 0.0f;
        if(!primed_) { mix_.snap(mix_.target); makeup_.snap(makeup_.target); primed_=true; }
        if(mode==0) {
            const Band band{param(compressorParameters,1,p),param(compressorParameters,2,p),
                            coef(param(compressorParameters,3,p)),coef(param(compressorParameters,4,p)),0.0f};
            for(int i=0;i<samples;++i) {
                const float xl=sane(left[i]),xr=sane(right[i]);
                const float gain=dbToGain(compute(detectors_[0],xl,xr,band,knee,rms)+makeup_.next());
                const float m=mix_.next();
                left[i]=xl+m*(xl*gain-xl);
                right[i]=xr+m*(xr*gain-xr);
            }
            return;
        }
        const float lowHz=param(compressorParameters,9,p);
        const float highHz=std::max(param(compressorParameters,10,p),lowHz*1.5f);
        const auto lp1=svfDesign(SvfShape::LowPass,lowHz,0.70710678,0.0,sampleRate_);
        const auto hp1=svfDesign(SvfShape::HighPass,lowHz,0.70710678,0.0,sampleRate_);
        const auto lp2=svfDesign(SvfShape::LowPass,highHz,0.70710678,0.0,sampleRate_);
        const auto hp2=svfDesign(SvfShape::HighPass,highHz,0.70710678,0.0,sampleRate_);
        Band bands[3];
        for(int b=0;b<3;++b) {
            const std::size_t base=11+std::size_t(b)*5;
            bands[b]={param(compressorParameters,base,p),param(compressorParameters,base+1,p),
                      coef(param(compressorParameters,base+2,p)),coef(param(compressorParameters,base+3,p)),
                      param(compressorParameters,base+4,p)};
        }
        for(int i=0;i<samples;++i) {
            const float x[2]{sane(left[i]),sane(right[i])};
            float split[3][2];
            for(int c=0;c<2;++c) {
                auto& x4=crossover_[c];
                const float low=x4.lowLp.process(x[c],lp1);
                // LR4 all-pass at the upper crossover keeps the low band in phase.
                split[0][c]=x4.apLp.process(low,lp2)+x4.apHp.process(low,hp2);
                const float rest=x4.restHp.process(x[c],hp1);
                split[1][c]=x4.midLp.process(rest,lp2);
                split[2][c]=x4.highHp.process(rest,hp2);
            }
            float outL=0.0f,outR=0.0f;
            for(int b=0;b<3;++b) {
                const float g=dbToGain(compute(detectors_[b],split[b][0],split[b][1],bands[b],knee,rms)+bands[b].gainDb);
                outL+=split[b][0]*g;
                outR+=split[b][1]*g;
            }
            const float m=mix_.next();
            left[i]=x[0]+m*(outL-x[0]);
            right[i]=x[1]+m*(outR-x[1]);
        }
    }
private:
    struct Band { float threshold,ratio,attack,release,gainDb; };
    struct Detector { float meanSquare=0.0f,reduction=0.0f; };
    struct Lr4 {
        SvfState a,b;
        float process(float x,const SvfCoefficients& c) noexcept { return b.process(a.process(x,c),c); }
    };
    struct Crossover { Lr4 lowLp,apLp,apHp,restHp,midLp,highHp; };
    float coef(float ms) const noexcept { return float(std::exp(-1.0/(std::max(0.05,double(ms))*0.001*sampleRate_))); }
    static float gainComputer(float levelDb,float threshold,float ratio,float knee) noexcept {
        const float over=levelDb-threshold;
        const float slope=1.0f/std::max(1.0f,ratio)-1.0f;
        if(knee>0.0f && 2.0f*std::abs(over)<=knee) return slope*(over+knee*0.5f)*(over+knee*0.5f)/(2.0f*knee);
        return over>0.0f ? slope*over : 0.0f;
    }
    float compute(Detector& d,float l,float r,const Band& band,float knee,bool rms) noexcept {
        float level;
        if(rms) {
            d.meanSquare=0.5f*(l*l+r*r)+(d.meanSquare-0.5f*(l*l+r*r))*rmsCoef_;
            level=std::sqrt(std::max(d.meanSquare,0.0f));
        } else {
            level=std::max(std::abs(l),std::abs(r));
        }
        const float target=gainComputer(20.0f*std::log10(std::max(level,1.0e-9f)),band.threshold,band.ratio,knee);
        const float c=target<d.reduction ? band.attack : band.release;
        d.reduction=target+(d.reduction-target)*c;
        if(!std::isfinite(d.reduction)) d.reduction=0.0f;
        return d.reduction;
    }
    double sampleRate_=48000.0;
    float rmsCoef_=0.999f;
    Detector detectors_[3]{};
    Crossover crossover_[2]{};
    Smoothed makeup_,mix_;
    int lastMode_=-1;
    bool primed_=false;
};

// ------------------------------------------------------------------ EQUALIZER
// Up to 8 stable bands of TPT SVF sections; disabled bands cost nothing and a
// band at 0 dB is an exact identity, so the default EQ is neutral.
class EqualizerFx final : public FxProcessor {
public:
    static constexpr int bands=8;
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        for(auto& b:band_) for(auto* s:{&b.frequency,&b.gain,&b.q}) s->setTime(sampleRate,0.03);
        reset();
        primed_=false;
    }
    void reset() noexcept override { for(auto& b:band_) { b.state[0].reset(); b.state[1].reset(); } }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        static constexpr SvfShape shapes[6]{SvfShape::HighPass,SvfShape::LowShelf,SvfShape::Bell,SvfShape::Notch,SvfShape::HighShelf,SvfShape::LowPass};
        for(int b=0;b<bands;++b) {
            auto& band=band_[b];
            const std::size_t base=std::size_t(b)*5;
            const bool on=choice(equalizerParameters,base,p)==1;
            const int type=choice(equalizerParameters,base+1,p);
            if(on!=band.on || type!=band.type) { band.state[0].reset(); band.state[1].reset(); }
            band.on=on;
            band.type=type;
            band.shape=shapes[std::clamp(type,0,5)];
            band.frequency.target=std::log(param(equalizerParameters,base+2,p));
            band.gain.target=param(equalizerParameters,base+3,p);
            band.q.target=param(equalizerParameters,base+4,p);
            if(!primed_) for(auto* s:{&band.frequency,&band.gain,&band.q}) s->snap(s->target);
        }
        primed_=true;
        for(int i=0;i<samples;++i) {
            float l=sane(left[i]),r=sane(right[i]);
            for(auto& band:band_) {
                const float f=band.frequency.next(),g=band.gain.next(),q=band.q.next();
                if(!band.on) continue;
                if((i&31)==0) band.coefficients=svfDesign(band.shape,std::exp(f),q,g,sampleRate_);
                l=band.state[0].process(l,band.coefficients);
                r=band.state[1].process(r,band.coefficients);
            }
            left[i]=l;
            right[i]=r;
        }
    }
private:
    struct Band {
        bool on=false;
        int type=-1;
        SvfShape shape=SvfShape::Bell;
        Smoothed frequency,gain,q;
        SvfCoefficients coefficients{};
        SvfState state[2];
    };
    double sampleRate_=48000.0;
    Band band_[bands];
    bool primed_=false;
};

// ------------------------------------------------------------------ FLANGER
// Short modulated delay (0.1-10 ms) with bipolar, soft-limited feedback and a
// stereo LFO phase offset. Delay time is smoothed and read fractionally.
class FlangerFx final : public FxProcessor {
public:
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        for(auto& l:lines_) l.prepare(static_cast<std::size_t>(0.025*sampleRate));
        for(auto* s:{&delay_,&depth_,&feedback_,&mix_,&spread_}) s->setTime(sampleRate,0.03);
        reset();
        primed_=false;
    }
    void reset() noexcept override { for(auto& l:lines_) l.reset(); phase_=0.0f; feedbackState_[0]=feedbackState_[1]=0.0f; }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        const float increment=param(flangerParameters,0,p)/float(sampleRate_);
        depth_.target=param(flangerParameters,1,p);
        feedback_.target=param(flangerParameters,2,p);
        delay_.target=param(flangerParameters,3,p)*float(sampleRate_)*0.001f;
        mix_.target=param(flangerParameters,4,p);
        spread_.target=param(flangerParameters,5,p)*0.5f;
        if(!primed_) { for(auto* s:{&delay_,&depth_,&feedback_,&mix_,&spread_}) s->snap(s->target); primed_=true; }
        float* channels[2]{left,right};
        for(int i=0;i<samples;++i) {
            const float base=delay_.next(),depth=depth_.next(),fb=feedback_.next(),m=mix_.next(),offset=spread_.next();
            for(int c=0;c<2;++c) {
                const float x=sane(channels[c][i]);
                const float lfo=std::sin(twoPi*(phase_+(c==1 ? offset : 0.0f)));
                const float d=std::max(1.0f,base*(1.0f+0.95f*depth*lfo));
                const float y=lines_[c].read(d);
                lines_[c].push(softLimit(x+fb*y));
                channels[c][i]=x+m*(y-x);
            }
            phase_+=increment;
            if(phase_>=1.0f) phase_-=1.0f;
        }
    }
private:
    double sampleRate_=48000.0;
    DelayLine lines_[2];
    Smoothed delay_,depth_,feedback_,mix_,spread_;
    float phase_=0.0f,feedbackState_[2]{};
    bool primed_=false;
};

// ------------------------------------------------------------------ PHASER
// 2-12 first-order all-pass stages swept by an LFO around a centre frequency,
// with feedback and a dry/phased sum that forms the moving notches.
class PhaserFx final : public FxProcessor {
public:
    static constexpr int maxStages=12;
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        for(auto* s:{&depth_,&feedback_,&center_,&mix_,&spread_}) s->setTime(sampleRate,0.03);
        reset();
        primed_=false;
    }
    void reset() noexcept override {
        for(auto& c:state_) c.fill(0.0f);
        last_[0]=last_[1]=0.0f;
        phase_=0.0f;
    }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        const float increment=param(phaserParameters,0,p)/float(sampleRate_);
        depth_.target=param(phaserParameters,1,p);
        feedback_.target=param(phaserParameters,2,p);
        center_.target=std::log(param(phaserParameters,3,p));
        const int stages=2*(choice(phaserParameters,4,p)+1);
        mix_.target=param(phaserParameters,5,p);
        spread_.target=param(phaserParameters,6,p)*0.5f;
        if(!primed_) { for(auto* s:{&depth_,&feedback_,&center_,&mix_,&spread_}) s->snap(s->target); primed_=true; }
        float* channels[2]{left,right};
        float coefficient[2]{0.0f,0.0f};
        for(int i=0;i<samples;++i) {
            const float depth=depth_.next(),fb=feedback_.next(),center=center_.next(),m=mix_.next(),offset=spread_.next();
            if((i&7)==0)
                for(int c=0;c<2;++c) {
                    const float lfo=std::sin(twoPi*(phase_+(c==1 ? offset : 0.0f)));
                    const float hz=std::clamp(std::exp(center+depth*2.5f*ln2*lfo),20.0f,float(sampleRate_)*0.45f);
                    const float t=std::tan(twoPi*0.5f*hz/float(sampleRate_));
                    coefficient[c]=(t-1.0f)/(t+1.0f);
                }
            for(int c=0;c<2;++c) {
                const float x=sane(channels[c][i]);
                float y=x+fb*last_[c];
                for(int s=0;s<stages;++s) {
                    const float out=coefficient[c]*y+state_[c][std::size_t(s)];
                    state_[c][std::size_t(s)]=y-coefficient[c]*out;
                    y=out;
                }
                last_[c]=softLimit(y);
                const float wet=0.5f*(x+y);
                channels[c][i]=x+m*(wet-x);
            }
            phase_+=increment;
            if(phase_>=1.0f) phase_-=1.0f;
        }
    }
private:
    double sampleRate_=48000.0;
    std::array<float,maxStages> state_[2]{};
    float last_[2]{},phase_=0.0f;
    Smoothed depth_,feedback_,center_,mix_,spread_;
    bool primed_=false;
};

// ------------------------------------------------------------------ SPATIAL
// Origami's thickening / dimension processor, built in mid/side so it stays
// mono-compatible by construction:
//   ENSEMBLE: 2-4 short detuned micro-voices (slowly modulated delay taps of
//             the mid signal). Their panned difference carries the thickness
//             in the SIDE; a bounded 25% of their average joins the MID.
//   DIMENSION: all-pass decorrelated copy of the mid added to the SIDE only.
// Mono sum = mid + 0.25*mix*amount*ensemble. Voice taps can comb against the
// dry mid, but the bounded share keeps mono amplitude >= 75% of the source at
// every frequency: never a catastrophic cancellation.
class SpatialFx final : public FxProcessor {
public:
    static constexpr int voices=4;
    void prepare(double sampleRate) override {
        sampleRate_=sampleRate;
        midLine_.prepare(static_cast<std::size_t>(0.04*sampleRate));
        const float ms=float(sampleRate)*0.001f;
        for(int i=0;i<2;++i) {
            diffusers_[i].line.prepare(static_cast<std::size_t>(14.0f*ms)+8);
            diffusers_[i].length.setTime(sampleRate,0.1);
        }
        for(auto* s:{&amount_,&width_,&mix_,&detune_,&depth_}) s->setTime(sampleRate,0.03);
        reset();
        primed_=false;
    }
    void reset() noexcept override {
        midLine_.reset();
        for(auto& d:diffusers_) d.line.reset();
        phases_={0.0f,0.27f,0.53f,0.79f};
    }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        const float ms=float(sampleRate_)*0.001f;
        amount_.target=param(spatialParameters,0,p);
        width_.target=param(spatialParameters,1,p);
        mix_.target=param(spatialParameters,2,p);
        const int count=choice(spatialParameters,3,p)+2;
        detune_.target=param(spatialParameters,4,p);
        depth_.target=param(spatialParameters,5,p);
        const float sizeScale=0.4f+1.2f*depth_.target;
        diffusers_[0].length.target=4.3f*sizeScale*ms;
        diffusers_[1].length.target=6.7f*sizeScale*ms;
        if(!primed_) {
            for(auto* s:{&amount_,&width_,&mix_,&detune_,&depth_}) s->snap(s->target);
            for(auto& d:diffusers_) d.length.snap(d.length.target);
            primed_=true;
        }
        for(int i=0;i<samples;++i) {
            const float xl=sane(left[i]),xr=sane(right[i]);
            const float a=amount_.next(),w=width_.next(),m=mix_.next(),det=detune_.next(),dep=depth_.next();
            const float mid=0.5f*(xl+xr),side=0.5f*(xl-xr);
            midLine_.push(mid);
            float ensembleMid=0.0f,ensembleSide=0.0f;
            for(int v=0;v<count;++v) {
                const float delay=(baseMs[v]+det*2.5f*std::sin(twoPi*phases_[std::size_t(v)]))*ms;
                const float tap=midLine_.read(delay);
                ensembleMid+=tap;
                ensembleSide+=tap*pans[v];
                phases_[std::size_t(v)]+=rates[v]/float(sampleRate_);
                if(phases_[std::size_t(v)]>=1.0f) phases_[std::size_t(v)]-=1.0f;
            }
            ensembleMid/=float(count);
            ensembleSide/=float(count);
            const float decorrelated=diffusers_[1].process(diffusers_[0].process(mid,0.55f),0.55f);
            const float outMid=mid+0.25f*a*ensembleMid;
            const float outSide=side+w*(a*(ensembleSide+0.5f*ensembleMid)+0.6f*dep*decorrelated);
            left[i]=xl+m*((outMid+outSide)-xl);
            right[i]=xr+m*((outMid-outSide)-xr);
        }
    }
private:
    static constexpr float baseMs[voices]{7.1f,11.3f,15.7f,19.9f};
    static constexpr float rates[voices]{0.31f,0.47f,0.59f,0.73f};
    static constexpr float pans[voices]{-0.9f,0.9f,-0.45f,0.45f};
    double sampleRate_=48000.0;
    DelayLine midLine_;
    Allpass diffusers_[2];
    std::array<float,voices> phases_{};
    Smoothed amount_,width_,mix_,detune_,depth_;
    bool primed_=false;
};

// ------------------------------------------------------------------ UTILITIES
class GainFx final : public FxProcessor {
public:
    void prepare(double sampleRate) override { gain_.setTime(sampleRate,0.02); primed_=false; }
    void reset() noexcept override {}
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        // Signed gain is smoothed, so a polarity flip glides through zero.
        gain_.target=dbToGain(param(gainParameters,0,p))*(choice(gainParameters,1,p)==1 ? -1.0f : 1.0f);
        if(!primed_) { gain_.snap(gain_.target); primed_=true; }
        for(int i=0;i<samples;++i) { const float g=gain_.next(); left[i]=sane(left[i])*g; right[i]=sane(right[i])*g; }
    }
private:
    Smoothed gain_;
    bool primed_=false;
};

class StereoUtilityFx final : public FxProcessor {
public:
    void prepare(double sampleRate) override { for(auto* s:{&width_,&balance_}) s->setTime(sampleRate,0.02); primed_=false; }
    void reset() noexcept override {}
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        const bool mono=choice(stereoUtilityParameters,2,p)==1;
        width_.target=mono ? 0.0f : param(stereoUtilityParameters,0,p);
        balance_.target=param(stereoUtilityParameters,1,p);
        if(!primed_) { width_.snap(width_.target); balance_.snap(balance_.target); primed_=true; }
        for(int i=0;i<samples;++i) {
            const float w=width_.next(),b=balance_.next();
            const float l=sane(left[i]),r=sane(right[i]);
            const float mid=0.5f*(l+r),side=0.5f*(l-r)*w;
            left[i]=(mid+side)*std::min(1.0f,1.0f-b);
            right[i]=(mid-side)*std::min(1.0f,1.0f+b);
        }
    }
private:
    Smoothed width_,balance_;
    bool primed_=false;
};

// ------------------------------------------------------------------ registry
template<typename T> std::unique_ptr<FxProcessor> make() { return std::make_unique<T>(); }

}

const std::vector<FxEffectDescriptor>& fxEffectCatalog() noexcept {
    static const std::vector<FxEffectDescriptor> catalog{
        {FxEffectType::Drive,"drive","DRIVE",FxCategory::Distortion,FxVisual::Transfer,true,driveParameters,std::size(driveParameters),&make<DriveFx>,0},
        {FxEffectType::Compressor,"compressor","COMPRESSOR",FxCategory::Dynamics,FxVisual::Compressor,true,compressorParameters,std::size(compressorParameters),&make<CompressorFx>,0},
        {FxEffectType::Limiter,"limiter","LIMITER",FxCategory::Dynamics,FxVisual::Dynamics,true,limiterParameters,std::size(limiterParameters),&make<LimiterFx>,0},
        {FxEffectType::Filter,"filter","FILTER",FxCategory::FilterEq,FxVisual::FilterResponse,true,filterParameters,std::size(filterParameters),&make<FilterFx>,0},
        {FxEffectType::Equalizer,"equalizer","EQUALIZER",FxCategory::FilterEq,FxVisual::EqResponse,true,equalizerParameters,std::size(equalizerParameters),&make<EqualizerFx>,0},
        {FxEffectType::Chorus,"chorus","CHORUS",FxCategory::Modulation,FxVisual::Lfo,true,chorusParameters,std::size(chorusParameters),&make<ChorusFx>,0},
        {FxEffectType::Flanger,"flanger","FLANGER",FxCategory::Modulation,FxVisual::Lfo,true,flangerParameters,std::size(flangerParameters),&make<FlangerFx>,0},
        {FxEffectType::Phaser,"phaser","PHASER",FxCategory::Modulation,FxVisual::Phaser,true,phaserParameters,std::size(phaserParameters),&make<PhaserFx>,0},
        {FxEffectType::Spatial,"spatial","SPATIAL",FxCategory::Spatial,FxVisual::Spatial,true,spatialParameters,std::size(spatialParameters),&make<SpatialFx>,0},
        {FxEffectType::Delay,"delay","DELAY",FxCategory::Time,FxVisual::Taps,true,delayParameters,std::size(delayParameters),&make<DelayFx>,0},
        {FxEffectType::Reverb,"reverb","REVERB",FxCategory::Time,FxVisual::Decay,true,reverbParameters,std::size(reverbParameters),&make<ReverbFx>,0},
        {FxEffectType::Diffuse,"diffuse","DIFFUSE",FxCategory::Time,FxVisual::Diffusion,true,diffuseParameters,std::size(diffuseParameters),&make<DiffuseFx>,0},
        {FxEffectType::Gain,"gain","GAIN",FxCategory::Utility,FxVisual::Utility,true,gainParameters,std::size(gainParameters),&make<GainFx>,0},
        {FxEffectType::StereoUtility,"stereo","STEREO UTILITY",FxCategory::Utility,FxVisual::Utility,true,stereoUtilityParameters,std::size(stereoUtilityParameters),&make<StereoUtilityFx>,0},
        {FxEffectType::SpectralTune,"spectralTune","SPECTRAL TUNE",FxCategory::Spectral,FxVisual::Spectrum,true,spectral::parameters(),spectral::parameterCount,&spectral::create,2046},
    };
    return catalog;
}

const FxEffectDescriptor* findFxEffect(FxEffectType type) noexcept {
    for(const auto& d:fxEffectCatalog()) if(d.type==type) return &d;
    return nullptr;
}
}
