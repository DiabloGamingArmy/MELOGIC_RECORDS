#include "core/dsp/StreamingSpectrum.h"
#include <algorithm>
#include <cmath>
#ifdef __APPLE__
#include <Accelerate/Accelerate.h>
#endif

namespace mct::origami::dsp {
namespace { constexpr double pi=3.14159265358979323846; }
void StereoLatencyDelay::reset() noexcept { std::fill(data_.begin(),data_.end(),0.0f); position_=0; }
void StereoLatencyDelay::tick(float& l,float& r) noexcept {
    if(length_==0) return;
    const float oldL=data_[position_],oldR=data_[length_+position_];
    data_[position_]=l; data_[length_+position_]=r; l=oldL; r=oldR;
    if(++position_==length_) position_=0;
}
void StereoLatencyDelay::process(float* l,float* r,int n) noexcept { for(int i=0;i<n;++i) tick(l[i],r[i]); }
PreparedComplexFft::~PreparedComplexFft() {
#ifdef __APPLE__
    if(nativePlan_) vDSP_destroy_fftsetup(static_cast<FFTSetup>(nativePlan_));
#endif
}
void PreparedComplexFft::prepare(int n) {
#ifdef __APPLE__
    if(nativePlan_) vDSP_destroy_fftsetup(static_cast<FFTSetup>(nativePlan_));
    nativeOrder_=0; for(int size=n;size>1;size>>=1) ++nativeOrder_;
    nativePlan_=vDSP_create_fftsetup(nativeOrder_,kFFTRadix2);
    nativeReal_.resize(n); nativeImaginary_.resize(n);
    if(nativePlan_){DSPSplitComplex warm{nativeReal_.data(),nativeImaginary_.data()};vDSP_fft_zip(static_cast<FFTSetup>(nativePlan_),&warm,1,nativeOrder_,FFT_FORWARD);vDSP_fft_zip(static_cast<FFTSetup>(nativePlan_),&warm,1,nativeOrder_,FFT_INVERSE);}
#endif
    reversal_.resize(n); roots_.resize(n/2);
    for(int i=0;i<n;++i) { unsigned x=unsigned(i),r=0; for(int width=n;width>1;width>>=1) { r=(r<<1)|(x&1); x>>=1; } reversal_[i]=int(r); }
    for(int i=0;i<n/2;++i) roots_[i]={float(std::cos(-2*pi*i/n)),float(std::sin(-2*pi*i/n))};
}
void PreparedComplexFft::transform(std::complex<float>* a,bool inverse) const noexcept {
    const int n=int(reversal_.size());
#ifdef __APPLE__
    if(nativePlan_) {
        DSPSplitComplex split{nativeReal_.data(),nativeImaginary_.data()};
        vDSP_ctoz(reinterpret_cast<const DSPComplex*>(a),2,&split,1,n);
        vDSP_fft_zip(static_cast<FFTSetup>(nativePlan_),&split,1,nativeOrder_,inverse ? FFT_INVERSE : FFT_FORWARD);
        if(inverse) { const float scale=1.0f/n; vDSP_vsmul(split.realp,1,&scale,split.realp,1,n); vDSP_vsmul(split.imagp,1,&scale,split.imagp,1,n); }
        vDSP_ztoc(&split,1,reinterpret_cast<DSPComplex*>(a),2,n); return;
    }
#endif
    for(int i=0;i<n;++i) if(i<reversal_[i]) std::swap(a[i],a[reversal_[i]]);
    for(int width=2;width<=n;width*=2) {
        const int half=width/2,stride=n/width;
        for(int base=0;base<n;base+=width) for(int k=0;k<half;++k) {
            const auto w=inverse ? std::conj(roots_[k*stride]) : roots_[k*stride];
            const auto odd=a[base+k+half]*w,even=a[base+k];
            a[base+k]=even+odd; a[base+k+half]=even-odd;
        }
    }
    if(inverse) for(int i=0;i<n;++i) a[i]*=1.0f/float(n);
}
std::size_t PreparedComplexFft::bytes() const noexcept { std::size_t bytes=reversal_.size()*sizeof(int)+roots_.size()*sizeof(std::complex<float>);
#ifdef __APPLE__
    bytes+=(nativeReal_.size()+nativeImaginary_.size())*sizeof(float);
#endif
    return bytes; }
void StreamingSpectrum::prepare(double rate,unsigned seed) {
    size_=rate>128000.0 ? 8192 : rate>64000.0 ? 4096 : 2048;
    hop_=size_/4; initialHop_=1+int(seed%unsigned(hop_)); fft_.prepare(size_); window_.resize(size_);
    for(int i=0;i<size_;++i) window_[i]=float(0.5-0.5*std::cos(2*pi*i/size_));
    double sum=0; for(int i=0;i<size_;i+=hop_) sum+=double(window_[i])*window_[i];
    normalization_=float(1.0/sum);
    input_.resize(2*size_); ola_.resize(4*size_); spectrum_.resize(2*size_); reset();
}
void StreamingSpectrum::reset() noexcept {
    std::fill(input_.begin(),input_.end(),0.0f); std::fill(ola_.begin(),ola_.end(),0.0f);
    std::fill(spectrum_.begin(),spectrum_.end(),std::complex<float>{});
    inputPosition_=outputPosition_=0; sampleCount_=0; untilFrame_=initialHop_;
}
void StreamingSpectrum::tick(float l,float r,float& ol,float& or_,FrameCallback callback,void* context) noexcept {
    ++sampleCount_;
    input_[inputPosition_]=std::isfinite(l) ? l : 0.0f;
    input_[size_+inputPosition_]=std::isfinite(r) ? r : 0.0f;
    if(++inputPosition_==size_) inputPosition_=0;
    // Frame ending at t is ready now. Hann w[0]=0, so its first
    // nonzero synthesis sample i=1 can be read in this same tick.
    if(--untilFrame_==0) { frame(callback,context); untilFrame_=hop_; }
    ol=ola_[outputPosition_]; or_=ola_[2*size_+outputPosition_];
    ola_[outputPosition_]=ola_[2*size_+outputPosition_]=0.0f;
    if(++outputPosition_==2*size_) outputPosition_=0;
}
void StreamingSpectrum::frame(FrameCallback callback,void* context) noexcept {
    for(int c=0;c<2;++c) {
        auto* x=spectrum_.data()+c*size_;
        for(int i=0;i<size_;++i) x[i]={input_[c*size_+((inputPosition_+i)&(size_-1))]*window_[i],0.0f};
        fft_.transform(x,false);
    }
    callback(context,spectrum_.data(),spectrum_.data()+size_);
    for(int c=0;c<2;++c) {
        auto* x=spectrum_.data()+c*size_; fft_.transform(x,true);
        // Frame starts at s=t-N+1; sample i is emitted at s+i+N-2.
        // i=0 writes only zero into the already-consumed ring slot.
        for(int i=0;i<size_;++i) ola_[c*2*size_+((outputPosition_+i-1)&(2*size_-1))]+=x[i].real()*window_[i]*normalization_;
    }
}
std::size_t StreamingSpectrum::bytes() const noexcept { return fft_.bytes()+(window_.size()+input_.size()+ola_.size())*sizeof(float)+spectrum_.size()*sizeof(std::complex<float>); }
}
