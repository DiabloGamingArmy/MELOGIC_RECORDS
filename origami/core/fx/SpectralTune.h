#pragma once
#include "core/fx/FxGraph.h"
#include "core/dsp/StreamingSpectrum.h"
#include <atomic>
#include <complex>
#include <vector>

namespace mct::origami::fx {
namespace spectral {
enum Parameter : FxParameterId { Snap=1,Shift=2,Range=3,Smooth=4,Response=5,Formant=6,Low=7,High=8,Stereo=9,Mix=10,Root=11,Scale=12,Mask=13,ShiftMode=14 };
constexpr int customScale=10;
std::uint16_t scaleMask(int root,int scale) noexcept;
float nearestMidi(float midi,std::uint16_t mask,float minimum=-200,float maximum=200) noexcept;
// Authored state consistency; called on canonical graph edits/decode.
void normalizeState(FxNode&,FxParameterId edited=0) noexcept;
const FxParameterDescriptor* parameters() noexcept;
constexpr std::size_t parameterCount=14;
std::unique_ptr<FxProcessor> create();
}

class SpectralTune final : public FxProcessor {
public:
    void prepare(double sampleRate) override;
    void reset() noexcept override;
    void process(float*,float*,int,const float*) noexcept override;
    void setProcessingPhase(unsigned seed) noexcept override { phaseSeed_=seed; }
    int latencySamples() const noexcept override { return stream_.latency(); }
    bool spectrumSnapshot(FxSpectrumSnapshot&) const noexcept override;
    std::size_t storageBytes() const noexcept;
    void setSpectrumTelemetryEnabled(bool enabled) noexcept override { telemetryEnabled_=enabled; }
private:
    static void frameCallback(void*,std::complex<float>*,std::complex<float>*) noexcept;
    void frame(std::complex<float>*,std::complex<float>*) noexcept;
    void publishSpectrum(const std::complex<float>*,const std::complex<float>*,const std::complex<float>*,const std::complex<float>*) noexcept;
    unsigned phaseSeed_=0;
    double rate_=48000.0;
    dsp::StreamingSpectrum stream_;
    dsp::StereoLatencyDelay dry_;
    std::array<float,spectral::parameterCount> controls_{},targets_{};
    std::vector<float> magnitude_,peakMarker_,frequency_,offset_,rotation_,envelope_;
    std::vector<int> peaks_,region_,contributors_,lastPeak_;
    std::vector<std::complex<float>> output_,previousInput_,phasor_,lastContribution_;
    std::vector<float> evidence_,collisionPower_;
    bool primed_=false,telemetryEnabled_=false;
    std::vector<int> previousRegion_;
    std::vector<float> oldOffset_,oldRotation_,mappingBlend_,oldBlend_;
    float mix_=1.0f,mixTarget_=1.0f,mixCoefficient_=0.0f;
    std::atomic<std::uint64_t> spectrumGuard_{0},sequence_{0};
    std::array<std::atomic<float>,FxSpectrumSnapshot::bins> inputTelemetry_{},outputTelemetry_{};
    std::atomic<float> telemetryLow_{20.0f},telemetryHigh_{20000.0f};
    std::atomic<unsigned> telemetryMask_{4095};
};
}
