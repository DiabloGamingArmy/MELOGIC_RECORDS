#include "core/fx/SpectralTune.h"
#include <algorithm>
#include <cmath>
#include <limits>

namespace mct::origami::fx {
namespace {
constexpr float pi=3.14159265358979323846f,twoPi=2*pi;
const char* const roots[]{"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"};
const char* const scales[]{"CHROMATIC","MAJOR","MINOR","DORIAN","PHRYGIAN","LYDIAN","MIXOLYDIAN","PENTATONIC MAJOR","PENTATONIC MINOR","WHOLE TONE","CUSTOM"};
const char* const shifts[]{"SEMITONES","HZ"};
using P=FxParameterPage; using C=FxParameterCurve;
const FxParameterDescriptor descriptors[]{
    {1,"snap","SNAP",0.75f,P::Main,true,0,1,C::Linear,"%"},
    {2,"shift","SHIFT",0.5f,P::Main,true,-24,24,C::Linear,"st"},
    {3,"range","RANGE",1,P::Advanced,false,0,12,C::Linear,"st"},
    {4,"smooth","SMOOTH",0.08f,P::Main,true,0,500,C::Linear,"ms"},
    {5,"response","RESPONSE",0.30103f,P::Advanced,false,5,500,C::Exponential,"ms"},
    {6,"formant","FORMANT",0,P::Advanced,false,0,1,C::Linear,"%"},
    {7,"fxLow","FX LOW",0,P::Advanced,false,20,20000,C::Exponential,"Hz"},
    {8,"fxHigh","FX HIGH",1,P::Advanced,false,20,20000,C::Exponential,"Hz"},
    {9,"stereo","STEREO",0,P::Advanced,false,0,1,C::Linear,"%"},
    {10,"mix","MIX",1,P::Main,true,0,1,C::Linear,"%"},
    {11,"root","ROOT",0,P::Advanced,false,0,11,C::Choice,"",12,roots},
    {12,"scale","SCALE",0,P::Advanced,false,0,10,C::Choice,"",11,scales},
    {13,"pitchMask","NOTES",1,P::Advanced,false,0,4095,C::Choice,"mask",4096},
    {14,"shiftMode","SHIFT MODE",0,P::Advanced,false,0,1,C::Choice,"",2,shifts}
};
float wrap(float x) noexcept { return std::remainder(x,twoPi); }
float taper(float hz,float low,float high) noexcept {
    if(hz<=low || hz>=high || high<=low) return 0;
    const float edge=std::min(0.12f*hz,std::max(1.0f,(high-low)*0.1f));
    float t=std::clamp(std::min((hz-low)/edge,(high-hz)/edge),0.0f,1.0f);
    return t*t*(3-2*t);
}
float authored(const FxNode& n,int index) noexcept { return n.parameter(descriptors[index].id).value_or(descriptors[index].defaultValue); }
void put(FxNode& n,int index,float value) noexcept { for(auto& p:n.parameters) if(p.id==descriptors[index].id) { p.value=value; return; } }
}
namespace spectral {
const FxParameterDescriptor* parameters() noexcept { return descriptors; }
std::unique_ptr<FxProcessor> create() { return std::make_unique<SpectralTune>(); }
std::uint16_t scaleMask(int root,int scale) noexcept {
    // Absolute pitch classes. Rotate preset intervals; CUSTOM is authored separately.
    constexpr unsigned masks[]{4095,0xAB5,0x5AD,0x6AD,0x5AB,0xAD5,0x6B5,0x295,0x4A9,0x555};
    root=std::clamp(root,0,11); scale=std::clamp(scale,0,9);
    const auto mask=masks[scale]; return std::uint16_t(((mask<<root)|(mask>>(12-root)))&4095);
}
float nearestMidi(float midi,std::uint16_t mask,float minimum,float maximum) noexcept {
    if(!std::isfinite(midi) || !(mask&4095)) return midi;
    const int base=int(std::floor(std::clamp(midi,-200.0f,200.0f)));
    float best=float(base),distance=std::numeric_limits<float>::max();
    for(int step=-12;step<=12;++step) {
        const int note=base+step,pc=((note%12)+12)%12;
        if(!(mask&(1u<<pc)) || note<minimum || note>maximum) continue;
        const float d=std::abs(midi-float(note));
        if(d<distance) { best=float(note); distance=d; } // ties choose lower note
    }
    return distance<std::numeric_limits<float>::max() ? best : midi;
}
void normalizeState(FxNode& n,FxParameterId edited) noexcept {
    for(int i=0;i<int(parameterCount);++i) {
        float v=authored(n,i); if(!std::isfinite(v)) v=descriptors[i].defaultValue;
        v=std::clamp(v,0.0f,1.0f);
        if(descriptors[i].curve==C::Choice) v=fxChoiceNormalized(descriptors[i],fxChoiceIndex(descriptors[i],v));
        put(n,i,v);
    }
    int root=fxChoiceIndex(descriptors[10],authored(n,10)),scale=fxChoiceIndex(descriptors[11],authored(n,11));
    if((edited==Root || edited==Scale) && scale!=customScale) put(n,12,float(scaleMask(root,scale))/4095.0f);
    const unsigned mask=unsigned(fxChoiceIndex(descriptors[12],authored(n,12)));
    if(scale!=customScale && mask!=scaleMask(root,scale)) put(n,11,1.0f);
    // Ordered processing bounds; editing one boundary moves the other if crossed.
    if(authored(n,6)>authored(n,7)) { if(edited==High) put(n,6,authored(n,7)); else put(n,7,authored(n,6)); }
}
}
void SpectralTune::prepare(double rate) {
    rate_=std::isfinite(rate) && rate>1.0 ? rate : 48000.0;
    stream_.prepare(rate_,phaseSeed_); dry_.prepare(stream_.latency());
    const int bins=stream_.size()/2+1;
    for(auto* v:{&magnitude_,&peakMarker_,&frequency_,&offset_,&rotation_,&envelope_,&oldRotation_,&mappingBlend_,&oldBlend_,&targetMidi_,&oldTargetMidi_}) v->resize(2*bins);
    for(auto* v:{&peaks_,&region_,&contributors_,&lastPeak_,&previousRegion_,&heldNote_,&oldHeldNote_}) v->resize(2*bins);
    output_.resize(2*stream_.size()); previousInput_.resize(2*bins); phasor_.resize(2*bins); lastContribution_.resize(2*bins); evidence_.resize(2*bins); collisionPower_.resize(2*bins);
    mixCoefficient_=float(std::exp(-1.0/(0.01*rate_))); reset();
}
void SpectralTune::reset() noexcept {
    stream_.reset(); dry_.reset();
    for(auto* v:{&magnitude_,&peakMarker_,&frequency_,&offset_,&rotation_,&envelope_,&oldRotation_,&mappingBlend_,&oldBlend_,&targetMidi_,&oldTargetMidi_}) std::fill(v->begin(),v->end(),0.0f);
    for(auto* v:{&peaks_,&region_,&contributors_,&lastPeak_,&previousRegion_,&heldNote_,&oldHeldNote_}) std::fill(v->begin(),v->end(),0);
    const int bins=stream_.size()/2+1;for(int c=0;c<2;++c)for(int k=0;k<bins;++k)frequency_[c*bins+k]=float(k*rate_/stream_.size());
    std::fill(output_.begin(),output_.end(),std::complex<float>{}); std::fill(previousInput_.begin(),previousInput_.end(),std::complex<float>{});
    std::fill(phasor_.begin(),phasor_.end(),std::complex<float>{});std::fill(lastContribution_.begin(),lastContribution_.end(),std::complex<float>{});
    std::fill(evidence_.begin(),evidence_.end(),0);std::fill(collisionPower_.begin(),collisionPower_.end(),0);primed_=false;
    std::fill(heldNote_.begin(),heldNote_.end(),-999);std::fill(oldHeldNote_.begin(),oldHeldNote_.end(),-999);
    spectrumGuard_.fetch_add(1,std::memory_order_acq_rel);
    for(auto& a:inputTelemetry_) a.store(0,std::memory_order_relaxed);
    for(auto& a:outputTelemetry_) a.store(0,std::memory_order_relaxed);
    sequence_.store(0,std::memory_order_relaxed); spectrumGuard_.fetch_add(1,std::memory_order_release);
}
void SpectralTune::process(float* l,float* r,int samples,const float* p) noexcept {
    for(int i=0;i<int(controls_.size());++i) targets_[i]=fxParameterValue(descriptors[i],p ? p[i] : descriptors[i].defaultValue);
    if(targets_[6]>targets_[7]) std::swap(targets_[6],targets_[7]);
    if(!primed_) controls_=targets_;
    mixTarget_=targets_[9]; if(!primed_) mix_=mixTarget_;
    for(int i=0;i<samples;++i) {
        float dl=std::isfinite(l[i]) ? std::clamp(l[i],-64.0f,64.0f) : 0,dr=std::isfinite(r[i]) ? std::clamp(r[i],-64.0f,64.0f) : 0,wl=0,wr=0;
        stream_.tick(dl,dr,wl,wr,frameCallback,this); dry_.tick(dl,dr);
        mix_=mixTarget_+(mix_-mixTarget_)*mixCoefficient_;
        l[i]=dl+mix_*(wl-dl); r[i]=dr+mix_*(wr-dr);
        if(!std::isfinite(l[i])) l[i]=0; if(!std::isfinite(r[i])) r[i]=0;
    }
}
void SpectralTune::frameCallback(void* self,std::complex<float>* l,std::complex<float>* r) noexcept { static_cast<SpectralTune*>(self)->frame(l,r); }
void SpectralTune::frame(std::complex<float>* l,std::complex<float>* r) noexcept {
    const int n=stream_.size(),bins=n/2+1,hop=stream_.hop();
    const float hzPerBin=float(rate_/n),hopSeconds=float(hop/rate_);
    const float parameterSmoothing=std::exp(-hopSeconds/0.01f);
    for(std::size_t i=0;i<controls_.size();++i) controls_[i]=descriptors[i].curve==C::Choice ? targets_[i] : targets_[i]+(controls_[i]-targets_[i])*parameterSmoothing;
    const float response=std::exp(-hopSeconds/(controls_[4]*0.001f));
    const float motion=controls_[3]>0 ? std::exp(-hopSeconds/(controls_[3]*0.001f)) : 0;
    const float low=controls_[6],high=std::min(controls_[7],float(rate_)*0.49f);
    const unsigned mask=unsigned(controls_[12])&4095;
    const float shiftRatio=std::exp2(controls_[1]/12.0f);
    std::copy(rotation_.begin(),rotation_.end(),oldRotation_.begin());
    std::copy(mappingBlend_.begin(),mappingBlend_.end(),oldBlend_.begin());
    std::copy(targetMidi_.begin(),targetMidi_.end(),oldTargetMidi_.begin());
    std::copy(heldNote_.begin(),heldNote_.end(),oldHeldNote_.begin());
    std::complex<float>* spectra[]{l,r};
    for(int c=0;c<2;++c) for(int k=0;k<bins;++k) magnitude_[c*bins+k]=std::abs(spectra[c][k]);
    for(int k=0;k<bins;++k) {
        const float linked=std::sqrt(magnitude_[k]*magnitude_[k]+magnitude_[bins+k]*magnitude_[bins+k]);
        for(int c=0;c<2;++c) evidence_[c*bins+k]=(1-controls_[8])*linked+controls_[8]*magnitude_[c*bins+k];
    }
    float evidenceFloor[2]{};
    for(int c=0;c<2;++c) evidenceFloor[c]=std::max(1.0e-7f,*std::max_element(evidence_.begin()+c*bins,evidence_.begin()+(c+1)*bins)*1.0e-4f);
    int peakCounts[2]{};
    std::fill(peakMarker_.begin(),peakMarker_.end(),0.0f); // bounded peak markers, no per-bin atan
    for(int c=0;c<2;++c) for(int k=1;k<bins-1;++k) {
        const auto* evidence=evidence_.data()+c*bins;
        if(evidence[k]>evidenceFloor[c] && evidence[k]>=evidence[k-1] && evidence[k]>evidence[k+1]) {
            peaks_[c*bins+peakCounts[c]++]=k; peakMarker_[k]=1;
        }
    }
    for(int k=1;k<bins-1;++k) if(peakMarker_[k]>0) for(int c=0;c<2;++c) {
        const int at=c*bins+k;
        const auto x=spectra[c][k],old=previousInput_[at];
        const float expected=twoPi*float(k*hop)/float(n);
        const float residual=wrap(std::arg(x*std::conj(old))-expected);
        const float estimate=(float(k)+residual*float(n)/(twoPi*hop))*hzPerBin;
        frequency_[at]=primed_ && std::abs(old)>1.0e-7f ? response*frequency_[at]+(1-response)*std::clamp(estimate,0.0f,float(rate_)*0.5f) : k*hzPerBin;
    }
    // Linked detection uses energy, not L+R: anti-correlated audio remains visible.
    // Stereo=1 detects independently; intermediate values blend the peak evidence.
    for(int c=0;c<2;++c) {
        const auto* x=spectra[c]; auto* y=output_.data()+c*n;
        std::fill_n(y,n,std::complex<float>{});
        const int count=peakCounts[c];
        if(count==0) {
            std::copy_n(x,n,y);
            for(int k=0;k<bins;++k){const int at=c*bins+k;region_[at]=k;offset_[at]=rotation_[at]=mappingBlend_[at]=0;targetMidi_[at]=0;heldNote_[at]=-999;}
            continue;
        }
        int current=0;
        for(int k=0;k<bins;++k) {
            while(current+1<count && 2*k>peaks_[c*bins+current]+peaks_[c*bins+current+1]) ++current;
            region_[c*bins+k]=peaks_[c*bins+current];
            contributors_[c*bins+k]=0; lastPeak_[c*bins+k]=-1; collisionPower_[c*bins+k]=0; lastContribution_[c*bins+k]={};
        }
        // Broad spectral envelope: two bounded one-pole passes (~1/6 octave).
        float env=0;
        for(int k=0;k<bins;++k) { const float a=1.0f/std::max(2.0f,float(k)*0.12f); env+=a*(magnitude_[c*bins+k]-env); envelope_[c*bins+k]=env; }
        env=envelope_[c*bins+bins-1];
        for(int k=bins-1;k>=0;--k) { const float a=1.0f/std::max(2.0f,float(k)*0.12f); env+=a*(envelope_[c*bins+k]-env); envelope_[c*bins+k]=env; }
        for(int j=0;j<count;++j) {
            const int peak=peaks_[c*bins+j],at=c*bins+peak;
            const float a=magnitude_[peak],b=magnitude_[bins+peak],total=a*a+b*b;
            const float linked=total>1.0e-14f ? (frequency_[peak]*a*a+frequency_[bins+peak]*b*b)/total : peak*hzPerBin;
            const float source=(1-controls_[8])*linked+controls_[8]*frequency_[at];
            const int oldPeak=primed_ ? std::clamp(previousRegion_[at],0,bins-1) : peak;
            float target=source,desiredMidi=0;
            bool targetInMidi=false;
            int selected=-999;
            const bool eligible=source>=hzPerBin*0.5f && taper(source,low,high)>0;
            if(eligible) {
                const float shifted=controls_[13]>0.5f ? source+controls_[1] : source*shiftRatio;
                if(shifted>0) {
                    target=shifted;desiredMidi=69+12*std::log2(shifted/440.0f);targetInMidi=true;
                    // Never fold a beyond-Nyquist shift back onto an audible note.
                    // Its mapped lobe is discarded by the bounded scatter below.
                    if(shifted<float(rate_)*0.49f && mask && controls_[0]>0) {
                        const float midi=desiredMidi;
                        float nearest=spectral::nearestMidi(midi,std::uint16_t(mask),69+12*std::log2(hzPerBin*0.5f/440),69+12*std::log2(float(rate_)*0.49f/440));
                        const int held=oldHeldNote_[c*bins+oldPeak],pc=((held%12)+12)%12;
                        // 0.12 st bounded hysteresis stabilizes boundary chatter.
                        // A new mask/range or a real note movement releases it.
                        if(primed_ && held!=-999 && (mask&(1u<<pc)) && std::abs(held-midi)<=controls_[2]
                           && std::abs(held-midi)<=std::abs(nearest-midi)+0.12f) nearest=float(held);
                        if(std::abs(nearest-midi)<=controls_[2]) {
                            selected=int(nearest); desiredMidi+=controls_[0]*(nearest-midi);
                        }
                    }
                }
            }
            heldNote_[at]=selected;
            if(!targetInMidi)desiredMidi=69+12*std::log2(std::max(target,1.e-5f)/440.0f);
            const bool moving=eligible && ((controls_[0]>0 && mask) || std::abs(controls_[1])>1.e-5f);
            // Smooth the absolute musical target, not a linear bin displacement.
            // A stationary lattice note stays defined when its source moves.
            const float smoothedMidi=primed_ && moving && oldTargetMidi_[c*bins+oldPeak]!=0
                ? motion*oldTargetMidi_[c*bins+oldPeak]+(1-motion)*desiredMidi : desiredMidi;
            targetMidi_[at]=smoothedMidi;
            if(moving) target=440*std::exp2((smoothedMidi-69)/12.0f);
            float shift=std::clamp((target-source)/hzPerBin,-float(n),float(n));
            const float delta=shift;
            const bool neutralIntent=(targets_[0]==0 || unsigned(targets_[12])==0) && std::abs(targets_[1])<1.e-5f;
            const float blendTarget=std::abs(delta)>=1.e-5f && !neutralIntent ? 1.0f : 0.0f;
            float blend=primed_ ? parameterSmoothing*oldBlend_[c*bins+oldPeak]+(1-parameterSmoothing)*blendTarget : blendTarget;
            if(blendTarget==0 && blend<1.e-5f)blend=0;
            mappingBlend_[at]=blend;
            if(blend==0)shift=0;
            offset_[at]=shift;
            rotation_[at]=wrap(primed_ ? (blend==0 ? 0 : oldRotation_[c*bins+oldPeak])+twoPi*shift*float(hop)/float(n) : twoPi*shift*float(stream_.frameStartSamples())/float(n));
            phasor_[at]=std::polar(1.0f,rotation_[at]+pi*shift);
        }
        const auto accumulate=[&](int d,int peak,std::complex<float> value) {
            if(std::norm(value)<1.e-20f) return;
            const int at=c*bins+d;
            if(lastPeak_[at]==peak) {
                const auto old=lastContribution_[at],combined=old+value;
                collisionPower_[at]+=std::norm(combined)-std::norm(old);lastContribution_[at]=combined;
            } else {lastPeak_[at]=peak;++contributors_[at];lastContribution_[at]=value;collisionPower_[at]+=std::norm(value);}
            y[d]+=value;
        };
        for(int k=0;k<bins;++k) {
            const int peak=region_[c*bins+k],at=c*bins+peak;
            // DC/Nyquist and bins outside the selected interval stay untouched.
            const bool affected=k>0 && k<bins-1 && taper(k*hzPerBin,low,high)>0;
            const float shift=affected ? offset_[at] : 0,blend=affected ? mappingBlend_[at]*taper(k*hzPerBin,low,high) : 0;
            if(blend==0) {accumulate(k,peak,x[k]);continue;}
            if(std::abs(shift)<1.0e-5f) {accumulate(k,peak,x[k]*((1-blend)+blend*phasor_[at]));continue;}
            accumulate(k,peak,x[k]*(1-blend));
            const float destination=k+shift;
            if(destination<0 || destination>bins) continue; // bounded anti-alias rejection
            const int base=int(std::floor(destination)); const float frac=destination-base;
            // Centered FFT interpolation preserves the phase across the window's lobe.
            const auto rotate=phasor_[at];
            auto value=x[k]*rotate*blend;
            const float sourceEnv=envelope_[c*bins+k],destEnv=envelope_[c*bins+std::clamp(base,0,bins-1)];
            const float correction=sourceEnv>1.0e-6f ? std::clamp(destEnv/sourceEnv,0.25f,4.0f) : 1;
            value*=1+controls_[5]*(correction-1);
            // Four-point Lagrange interpolation in the centered spectrum.
            // Integer shifts remain exact; fractional shifts have a flatter
            // passband than two-tap linear scatter, without hidden gain/EQ.
            const float weights[]{-frac*(1-frac)*(2-frac)/6,
                (1+frac)*(1-frac)*(2-frac)/2,
                (1+frac)*frac*(2-frac)/2,-(1+frac)*frac*(1-frac)/6};
            for(int tap=0;tap<4;++tap) {
                const int d=base+tap-1; if(d<1 || d>bins-2) continue;
                float weight=weights[tap];
                if((k-d)&1) weight=-weight;
                accumulate(d,peak,value*weight);
            }
        }
        for(int k=1;k<bins-1;++k) {
            // Eligibility is a source property: retain untouched source bins
            // and also valid mapped arrivals outside the selected interval.
            if(contributors_[c*bins+k]>1) { const float power=std::norm(y[k]),budget=std::max(0.0f,collisionPower_[c*bins+k]); if(power>budget && power>1.e-20f)y[k]*=std::sqrt(budget/power); }
            y[n-k]=std::conj(y[k]);
        }
        y[0]={y[0].real(),0}; y[n/2]={y[n/2].real(),0};
    }
    std::copy(region_.begin(),region_.end(),previousRegion_.begin());
    for(int c=0;c<2;++c) std::copy_n(spectra[c],bins,previousInput_.data()+c*bins);
    if(telemetryEnabled_) publishSpectrum(l,r,output_.data(),output_.data()+n);
    std::copy_n(output_.data(),n,l); std::copy_n(output_.data()+n,n,r); primed_=true;
}
void SpectralTune::publishSpectrum(const std::complex<float>* l,const std::complex<float>* r,const std::complex<float>* ol,const std::complex<float>* or_) noexcept {
    const int n=stream_.size(),bins=n/2+1;
    spectrumGuard_.fetch_add(1,std::memory_order_acq_rel);
    for(std::size_t i=0;i<FxSpectrumSnapshot::bins;++i) {
        const float lower=20*std::pow(std::min(20000.0f,float(rate_)*0.49f)/20,float(i)/FxSpectrumSnapshot::bins);
        const float upper=20*std::pow(std::min(20000.0f,float(rate_)*0.49f)/20,float(i+1)/FxSpectrumSnapshot::bins);
        int a=std::clamp(int(lower*n/rate_),1,bins-1),b=std::clamp(int(upper*n/rate_)+1,a+1,bins);
        float input=0,output=0;
        for(int k=a;k<b;++k) { input=std::max(input,std::hypot(std::abs(l[k]),std::abs(r[k]))); output=std::max(output,std::hypot(std::abs(ol[k]),std::abs(or_[k]))); }
        inputTelemetry_[i].store(input*2.82842712474619f/n,std::memory_order_relaxed); outputTelemetry_[i].store(output*2.82842712474619f/n,std::memory_order_relaxed);
    }
    telemetryLow_.store(controls_[6],std::memory_order_relaxed); telemetryHigh_.store(controls_[7],std::memory_order_relaxed);
    telemetryMask_.store(unsigned(controls_[12])&4095,std::memory_order_relaxed);
    sequence_.fetch_add(1,std::memory_order_relaxed); spectrumGuard_.fetch_add(1,std::memory_order_release);
}
bool SpectralTune::spectrumSnapshot(FxSpectrumSnapshot& out) const noexcept {
    for(int attempt=0;attempt<4;++attempt) {
        const auto guard=spectrumGuard_.load(std::memory_order_acquire); if(guard&1u) continue;
        for(std::size_t i=0;i<out.bins;++i) { out.input[i]=inputTelemetry_[i].load(std::memory_order_relaxed); out.output[i]=outputTelemetry_[i].load(std::memory_order_relaxed); }
        out.low=telemetryLow_.load(std::memory_order_relaxed); out.high=telemetryHigh_.load(std::memory_order_relaxed); out.mask=std::uint16_t(telemetryMask_.load(std::memory_order_relaxed));
        out.sampleRate=float(rate_); out.sequence=sequence_.load(std::memory_order_relaxed);
        std::atomic_thread_fence(std::memory_order_acquire); if(spectrumGuard_.load(std::memory_order_relaxed)==guard) return out.sequence!=0;
    }
    return false;
}
std::size_t SpectralTune::storageBytes() const noexcept {
    std::size_t bytes=sizeof(*this)+stream_.bytes()+dry_.bytes()+(output_.size()+previousInput_.size()+phasor_.size()+lastContribution_.size())*sizeof(std::complex<float>)+(evidence_.size()+collisionPower_.size())*sizeof(float);
    for(const auto* v:{&magnitude_,&peakMarker_,&frequency_,&offset_,&rotation_,&envelope_,&oldRotation_,&mappingBlend_,&oldBlend_,&targetMidi_,&oldTargetMidi_}) bytes+=v->size()*sizeof(float);
    for(const auto* v:{&peaks_,&region_,&contributors_,&lastPeak_,&previousRegion_,&heldNote_,&oldHeldNote_}) bytes+=v->size()*sizeof(int);
    return bytes;
}
}
