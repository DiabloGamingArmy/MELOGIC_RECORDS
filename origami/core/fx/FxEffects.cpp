// mct-origami-fx-graph-dsp-bus-routing-p02
// Origami FX effect registry and realtime DSP implementations.
//
// Every processor follows the FxProcessor contract: prepare() is the only
// place memory is allocated; reset()/process() are allocation- and lock-free,
// bounded, and produce finite output for any finite or non-finite input.
// Continuous controls are smoothed; discrete modes (ping-pong) switch at
// block boundaries.
#include "core/fx/FxGraph.h"
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
        for(auto& l:lines_) l.prepare(static_cast<std::size_t>(sampleRate/15.0));
        period_.setTime(sampleRate,0.05);
        for(auto* s:{&feedback_,&mix_,&damp_}) s->setTime(sampleRate,0.02);
        reset();
        primed_=false;
    }
    void reset() noexcept override { for(auto& l:lines_) l.reset(); lp_[0]=lp_[1]=0.0f; }
    void process(float* left,float* right,int samples,const float* p) noexcept override {
        period_.target=float(sampleRate_)/param(combParameters,0,p);
        feedback_.target=param(combParameters,1,p);
        mix_.target=param(combParameters,2,p);
        damp_.target=onePoleCoefficient(sampleRate_,18000.0f*std::pow(1000.0f/18000.0f,param(combParameters,3,p)));
        if(!primed_) { for(auto* s:{&period_,&feedback_,&mix_,&damp_}) s->snap(s->target); primed_=true; }
        float* channels[2]{left,right};
        for(int i=0;i<samples;++i) {
            const float d=period_.next(),f=feedback_.next(),m=mix_.next(),a=damp_.next();
            const float normalize=std::sqrt(1.0f-std::abs(f));
            for(int c=0;c<2;++c) {
                const float x=sane(channels[c][i]);
                lp_[c]+=a*(lines_[c].read(d)-lp_[c]);
                const float y=softLimit(x+f*lp_[c]);
                lines_[c].push(y);
                channels[c][i]=x+m*(y*normalize-x);
            }
        }
    }
private:
    double sampleRate_=48000.0;
    DelayLine lines_[2];
    Smoothed period_,feedback_,mix_,damp_;
    float lp_[2]{};
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

// ------------------------------------------------------------------ registry
template<typename T> std::unique_ptr<FxProcessor> make() { return std::make_unique<T>(); }

}

const std::vector<FxEffectDescriptor>& fxEffectCatalog() noexcept {
    static const std::vector<FxEffectDescriptor> catalog{
        {FxEffectType::Drive,"drive","DRIVE",FxCategory::Drive,FxVisual::Transfer,true,driveParameters,std::size(driveParameters),&make<DriveFx>,0},
        {FxEffectType::Delay,"delay","DELAY",FxCategory::Time,FxVisual::Taps,true,delayParameters,std::size(delayParameters),&make<DelayFx>,0},
        {FxEffectType::Reverb,"reverb","REVERB",FxCategory::Space,FxVisual::Decay,true,reverbParameters,std::size(reverbParameters),&make<ReverbFx>,0},
        {FxEffectType::Chorus,"chorus","CHORUS",FxCategory::Modulation,FxVisual::Lfo,true,chorusParameters,std::size(chorusParameters),&make<ChorusFx>,0},
        {FxEffectType::Comb,"comb","COMB",FxCategory::Filter,FxVisual::Comb,true,combParameters,std::size(combParameters),&make<CombFx>,0},
        {FxEffectType::Diffuse,"diffuse","DIFFUSE",FxCategory::Space,FxVisual::Diffusion,true,diffuseParameters,std::size(diffuseParameters),&make<DiffuseFx>,0},
        {FxEffectType::Limiter,"limiter","LIMITER",FxCategory::Dynamics,FxVisual::Dynamics,true,limiterParameters,std::size(limiterParameters),&make<LimiterFx>,0},
    };
    return catalog;
}

const FxEffectDescriptor* findFxEffect(FxEffectType type) noexcept {
    for(const auto& d:fxEffectCatalog()) if(d.type==type) return &d;
    return nullptr;
}
}
