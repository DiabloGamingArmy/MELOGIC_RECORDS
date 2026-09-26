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

enum class Chain { Phase, Random, Mixed, Clean };

struct Scenario {
    const char* name;
    unsigned voices;
    unsigned modules;
    unsigned unison;
    unsigned blocks;
    unsigned spectralStages=0;
    Chain chain=Chain::Phase;
    bool bypassAllButFirst=false;
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

    // OSC1's legacy controls are authoritative; set them explicitly so the
    // advertised unison count applies to every oscillator, including OSC1.
    engine.setParameter(mct::origami::ParameterId::OscUnison,static_cast<float>(s.unison));
    engine.setParameter(mct::origami::ParameterId::OscDetune,18.0f);
    for(unsigned m=0;m<s.modules;++m) {
        OscillatorModuleState state=engine.oscillatorModuleState(ids[m]);
        state.enabled=true;
        state.unison=s.unison;
        state.detuneCents=18.0f;
        state.blend=0.5f;
        state.process1=s.chain==Chain::Clean ? mct::origami::dsp::OscProcessType::Off
                                          : mct::origami::dsp::OscProcessType::BendPlus;
        state.process1Amount=0.17f;
        state.process2=mct::origami::dsp::OscProcessType::Off;
        if(s.spectralStages) {
            state.processCount=static_cast<std::uint8_t>(s.spectralStages);
            state.nextProcessId=s.spectralStages+1;
            using Type=mct::origami::dsp::OscProcessType;
            const std::array<Type,4> mixed{{Type::BendPlus,Type::RandAmp,Type::PhaseShift,Type::RandSparse}};
            for(unsigned p=0;p<s.spectralStages;++p) {
                const auto type=s.chain==Chain::Mixed ? mixed[p%4] : (p%2 ? Type::RandSparse : Type::RandAmp);
                state.processes[p]={p+1,type,0.35f+0.05f*static_cast<float>(p),0x12345678u+p,
                                    !s.bypassAllButFirst || p==0};
            }
            if(s.chain==Chain::Mixed && m>0) {
                state.routeCount=2;state.nextRouteId=3;
                state.routes[0]={1,ids[0],mct::origami::OscRouteType::PhaseMod,0.1f,true};
                state.routes[1]={2,ids[0],mct::origami::OscRouteType::RingMod,0.1f,true};
            }
        }
        if(!engine.setOscillatorModuleState(ids[m],state))
            return -1.0;
    }

    engine.reset();
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
    const std::array<Scenario,19> scenarios{{
        {"1v_1osc_1u_clean",1,1,1,1000,0,Chain::Clean},
        {"1v_1osc_1u_rand1",1,1,1,1000,1,Chain::Random},
        {"1v_1osc_1u_rand2",1,1,1,1000,2,Chain::Random},
        {"1v_1osc_1u_rand4",1,1,1,1000,4,Chain::Random},
        {"1v_1osc_1u_rand8",1,1,1,1000,8,Chain::Random},
        {"8v_4osc_4u_clean",8,4,4,500,0,Chain::Clean},
        {"8v_4osc_4u_rand1",8,4,4,500,1,Chain::Random},
        {"8v_4osc_4u_rand2",8,4,4,500,2,Chain::Random},
        {"8v_4osc_4u_rand4",8,4,4,500,4,Chain::Random},
        {"8v_4osc_4u_rand8",8,4,4,500,8,Chain::Random},
        {"8v_4osc_4u_mixed4_routes",8,4,4,500,4,Chain::Mixed},
        {"8v_4osc_4u_rand8_bypass7",8,4,4,500,8,Chain::Random,true},
        {"16v_4osc_8u_clean",16,4,8,250,0,Chain::Clean},
        {"16v_4osc_8u_rand1",16,4,8,250,1,Chain::Random},
        {"16v_4osc_8u_rand2",16,4,8,250,2,Chain::Random},
        {"16v_4osc_8u_rand4",16,4,8,250,4,Chain::Random},
        {"16v_4osc_8u_rand8",16,4,8,250,8,Chain::Random},
        {"16v_4osc_8u_mixed8_routes",16,4,8,250,8,Chain::Mixed},
        {"16v_4osc_16u_phase",16,4,16,250,0,Chain::Phase}
    }};

    std::cout << "MCT Origami realtime DSP scaling profile\n";
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
