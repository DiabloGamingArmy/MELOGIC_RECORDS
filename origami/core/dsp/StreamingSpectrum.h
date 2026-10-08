#pragma once
#include <array>
#include <complex>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace mct::origami::dsp {
// Prepared off-thread. The zero-length path owns no delay storage.
class StereoLatencyDelay {
public:
    void prepare(int samples) { length_=samples>0 ? samples : 0; data_.assign(std::size_t(length_)*2,0.0f); position_=0; }
    void reset() noexcept;
    void tick(float& left,float& right) noexcept;
    void process(float* left,float* right,int samples) noexcept;
    int latency() const noexcept { return length_; }
    std::size_t bytes() const noexcept { return data_.size()*sizeof(float); }
private:
    std::vector<float> data_;
    int length_=0,position_=0;
};

class PreparedComplexFft {
public:
    PreparedComplexFft()=default;
    PreparedComplexFft(const PreparedComplexFft&)=delete;
    PreparedComplexFft& operator=(const PreparedComplexFft&)=delete;
    ~PreparedComplexFft();
    void prepare(int size);
    void transform(std::complex<float>* data,bool inverse) const noexcept;
    std::size_t bytes() const noexcept;
private:
#ifdef __APPLE__
    void* nativePlan_=nullptr;
    mutable std::vector<float> nativeReal_,nativeImaginary_;
    unsigned nativeOrder_=0;
#endif
    std::vector<int> reversal_;
    std::vector<std::complex<float>> roots_;
};

// Arbitrary live stereo audio. Periodic Hann analysis/synthesis, 75% overlap,
// normalized by the sum of squared windows. Fixed N-sample causal latency.
// Frame callback edits the full complex FFT in-place; it must restore Hermitian
// symmetry. No allocation, FFT planning, locks or unbounded scheduling in tick.
class StreamingSpectrum {
public:
    using FrameCallback=void(*)(void*,std::complex<float>*,std::complex<float>*) noexcept;
    void prepare(double sampleRate,unsigned phaseSeed=0);
    void reset() noexcept;
    void tick(float left,float right,float& outLeft,float& outRight,FrameCallback,void*) noexcept;
    int size() const noexcept { return size_; }
    int hop() const noexcept { return hop_; }
    int latency() const noexcept { return size_; }
    std::int64_t frameStartSamples() const noexcept { return sampleCount_-size_; }
    std::size_t bytes() const noexcept;
private:
    void frame(FrameCallback,void*) noexcept;
    PreparedComplexFft fft_;
    int size_=0,hop_=0,inputPosition_=0,outputPosition_=0,untilFrame_=0,initialHop_=0;
    std::int64_t sampleCount_=0;
    float normalization_=1.0f;
    std::vector<float> window_,input_,ola_;
    std::vector<std::complex<float>> spectrum_;
};
}
