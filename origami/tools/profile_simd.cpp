// mct-origami-audio-reengineer-p18-simd-profiling
#include "core/Engine.h"
#include "core/dsp/Wavetable.h"

#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>

namespace {
using Clock = std::chrono::steady_clock;
using mct::origami::OrigamiEngine;
using mct::origami::OscillatorModuleId;
using mct::origami::OscillatorModuleState;

constexpr double sampleRate = 48000.0;
constexpr std::size_t blockSize = 128;

struct Scenario {
    const char* name;
    unsigned voices;
    unsigned modules;
    unsigned unison;
    unsigned blocks;
};

double runSynth(const Scenario& s) {
    OrigamiEngine engine;
    if(!engine.prepare(sampleRate, blockSize, 2))
        return -1.0;

    std::array<OscillatorModuleId,16> ids{};
    ids[0]=1;
    for(unsigned m=1;m<s.modules;++m) {
        ids[m]=engine.addOscillatorModule();
        if(ids[m]==0) return -1.0;
    }

    for(unsigned m=0;m<s.modules;++m) {
        OscillatorModuleState state=engine.oscillatorModuleState(ids[m]);
        state.enabled=true;
        state.unison=s.unison;
        state.detuneCents=18.0f;
        state.blend=0.5f;
        state.process1=mct::origami::dsp::OscProcessType::BendPlus;
        state.process1Amount=0.17f;
        state.process2=mct::origami::dsp::OscProcessType::Off;
        if(!engine.setOscillatorModuleState(ids[m],state))
            return -1.0;
    }

    for(unsigned v=0;v<s.voices;++v)
        if(!engine.noteOn(48+static_cast<int>(v),0.8f,0,0))
            return -1.0;

    std::array<float,blockSize> left{},right{};
    float* channels[2]{left.data(),right.data()};

    for(unsigned i=0;i<64;++i)
        engine.process(channels,2,blockSize);

    const auto begin=Clock::now();
    for(unsigned i=0;i<s.blocks;++i)
        engine.process(channels,2,blockSize);
    const auto end=Clock::now();

    volatile float sink=left[blockSize-1]+right[blockSize-1];
    (void)sink;

    const std::chrono::duration<double> elapsed=end-begin;
    const double renderedSeconds=
        static_cast<double>(s.blocks*blockSize)/sampleRate;
    return elapsed.count()/renderedSeconds;
}

double runSpectral(unsigned iterations) {
    std::array<float,2048> input{},output{};
    for(std::size_t i=0;i<input.size();++i)
        input[i]=static_cast<float>(
            0.62*std::sin(2.0*3.14159265358979323846*static_cast<double>(i)/2048.0)
            +0.25*std::sin(6.0*3.14159265358979323846*static_cast<double>(i)/2048.0));

    mct::origami::dsp::renderProcessedFrame2048(
        input.data(),output.data(),
        mct::origami::dsp::OscProcessType::FormantPeaks,0.75f,0x12345678u,
        mct::origami::dsp::OscProcessType::HarmonicTilt,0.55f,0x87654321u);

    const auto begin=Clock::now();
    for(unsigned i=0;i<iterations;++i) {
        mct::origami::dsp::renderProcessedFrame2048(
            input.data(),output.data(),
            mct::origami::dsp::OscProcessType::FormantPeaks,0.75f,0x12345678u+i,
            mct::origami::dsp::OscProcessType::HarmonicTilt,0.55f,0x87654321u);
    }
    const auto end=Clock::now();

    volatile float sink=output[17];
    (void)sink;
    const std::chrono::duration<double,std::micro> elapsed=end-begin;
    return elapsed.count()/static_cast<double>(iterations);
}
}

int main() {
    const std::array<Scenario,4> scenarios{{
        {"1voice_1module_1unison",1,1,1,5000},
        {"8voice_4module_4unison",8,4,4,1200},
        {"16voice_4module_8unison",16,4,8,500},
        {"16voice_4module_16unison",16,4,16,250}
    }};

    std::cout << "MCT Origami Patch 18 SIMD/vectorization profile\n";
    std::cout << "sample_rate=" << sampleRate << " block_size=" << blockSize << "\n";
    std::cout << "scenario,realtime_fraction,headroom_percent\n";
    std::cout << std::fixed << std::setprecision(6);

    for(const auto& s:scenarios) {
        const double ratio=runSynth(s);
        if(ratio<0.0) {
            std::cerr << "profile setup failed: " << s.name << "\n";
            return 2;
        }
        std::cout << s.name << "," << ratio << ","
                  << (1.0-ratio)*100.0 << "\n";
    }

    std::cout << "spectral_transform_us,"
              << runSpectral(24) << "\n";
    return 0;
}
