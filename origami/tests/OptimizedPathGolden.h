// mct-origami-dsp-performance-stereo-chain: golden renders of every path the
// performance pass changed (pitch moving every sample, routed modulation and
// its weight glide, OSC CHAIN phase processes, spectral chain, stereo LFOs,
// FUNC LFOs). Engine API only, so the identical code renders on the
// pre-optimization commit, where the expected hashes were captured.
// Bit-exact float hashes: valid for this toolchain / flags; a deliberate DSP
// change re-baselines them (ORIGAMI_PRINT_GOLDEN=1 prints the current ones).
#pragma once
#include "core/Engine.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <thread>
#include <vector>

namespace mct::origami::golden {

struct Render { std::uint64_t hash=0; bool finite=true; };

inline void fnv(std::uint64_t& h,float v) {
    std::uint32_t bits; std::memcpy(&bits,&v,sizeof bits);
    for(int i=0;i<4;++i) { h^=(bits>>(i*8))&0xffu; h*=1099511628211ull; }
}

constexpr int scenarioCount=6;
inline const char* scenarioName(int s) {
    static const char* names[scenarioCount]{"vibrato + pitch wheel, unison 8","routes + FUNC LFOs + amount glide",
        "OSC CHAIN phase processes, modulated","spectral chain (RAND AMP) + stereo LFO","stereo LFO -> LEVEL / CUTOFF","glide + pitch bend, mono legato"};
    return s>=0 && s<scenarioCount ? names[s] : "?";
}

// Total length and the sample where a mid-render edit lands: multiples of
// every tested block size (32, 256, 1000), so each block size applies the
// edit at the same sample.
constexpr std::size_t editAt=32000,total=48000;

inline ModRoute route(std::uint32_t id,ModSource source,ModDestination d,OscillatorModuleId osc,float amount,std::uint32_t item=0) {
    ModRoute r; r.id=id; r.enabled=true; r.source=source; r.destination={d,osc,item}; r.amount=amount; r.bipolar=true; return r;
}

// Returns whether `edited` differs (applied at editAt).
inline bool setup(OrigamiEngine& e,int scenario,ModulationState& mod,ModulationState& edited) {
    mod=e.instrumentState().modulation;
    bool edit=false;
    auto osc1=e.oscillatorModuleState(1);
    switch(scenario) {
        case 0: {
            e.setParameter(ParameterId::OscUnison,8.0f); e.setParameter(ParameterId::OscDetune,18.0f);
            mod.lfo1.mode=LfoMode::Free; mod.lfo1.rateHz=5.5f;
            mod.routes[0]=route(1,ModSource::Lfo1,ModDestination::Fine,1,0.08f);
            mod.nextRouteId=2; edited=mod;
            break;
        }
        case 1: {
            for(std::size_t i=0;i<4;++i) {
                auto& l=lfoSettings(mod,i); l.mode=i%2 ? LfoMode::Loop : LfoMode::Free; l.rateHz=1.5f+float(i);
                l.smooth=.2f; l.skew=.3f; l.entropy=.4f; l.fracture=.3f; l.quantize=.2f; l.pingPong=true; l.phase=.1f;
            }
            const ModDestination dest[]{ModDestination::Level,ModDestination::WtPosition,ModDestination::Pan,ModDestination::Fine,
                                        ModDestination::Detune,ModDestination::Semitone,ModDestination::Cutoff,ModDestination::Resonance};
            const ModSource src[]{ModSource::Lfo1,ModSource::Lfo2,ModSource::Lfo3,ModSource::Lfo4,ModSource::Env2,ModSource::Env3,ModSource::Random,ModSource::Macro1};
            for(std::uint32_t r=0;r<8;++r) {
                const bool global=dest[r]==ModDestination::Cutoff || dest[r]==ModDestination::Resonance;
                mod.routes[r]=route(r+1,src[r],dest[r],global ? 0u : 1u,0.15f+0.02f*float(r));
            }
            mod.nextRouteId=9; edited=mod;
            edited.routes[1].amount=-0.3f; edited.routes[3].amount=0.05f; // glides from editAt on
            edit=true;
            break;
        }
        case 2: case 3: {
            osc1.processCount=0; osc1.nextProcessId=1;
            const auto add=[&](dsp::OscProcessType t,float a) { osc1.processes[osc1.processCount++]={osc1.nextProcessId++,t,a,0x5150u+osc1.nextProcessId,true}; };
            if(scenario==2) { add(dsp::OscProcessType::BendPlus,.35f); add(dsp::OscProcessType::SineWarp,.4f); add(dsp::OscProcessType::Fold,.3f); }
            else add(dsp::OscProcessType::RandAmp,.5f);
            e.setOscillatorModuleState(1,osc1);
            mod.lfo1.mode=LfoMode::Loop; mod.lfo1.rateHz=3.0f; mod.lfo1.stereo=scenario==3 ? 1.0f : 0.0f;
            const auto first=e.oscillatorModuleState(1).processes[0].id;
            mod.routes[0]=route(1,ModSource::Lfo1,ModDestination::ProcessAmount,1,0.4f,first);
            mod.nextRouteId=2; edited=mod;
            break;
        }
        case 4: {
            mod.lfo1.mode=LfoMode::Free; mod.lfo1.rateHz=2.0f; mod.lfo1.stereo=0.75f;
            mod.lfo2.mode=LfoMode::Loop; mod.lfo2.rateHz=3.0f; mod.lfo2.stereo=0.5f;
            mod.routes[0]=route(1,ModSource::Lfo1,ModDestination::Level,1,0.5f);
            mod.routes[1]=route(2,ModSource::Lfo2,ModDestination::Cutoff,0,0.4f);
            mod.nextRouteId=3; edited=mod;
            edited.lfo1.stereo=0.0f; edited.lfo2.stereo=0.0f; // STEREO -> 0 at editAt
            edit=true;
            break;
        }
        case 5: {
            PerformanceState perf=e.performanceState(); perf.voiceMode=VoiceMode::Mono; perf.legato=true; perf.glideSeconds=0.08f;
            e.setPerformanceState(perf);
            e.setParameter(ParameterId::OscUnison,3.0f);
            edited=mod;
            break;
        }
        default: edited=mod; break;
    }
    e.setModulationState(mod);
    return edit;
}

inline Render render(int scenario,std::size_t block) {
    auto owner=std::make_unique<OrigamiEngine>(); auto& e=*owner;
    Render out;
    if(!e.prepare(48000.0,1024,2)) { out.finite=false; return out; }
    ModulationState mod,edited; const bool edit=setup(e,scenario,mod,edited);
    std::vector<float> l(block),r(block);
    float* io[2]{l.data(),r.data()};
    // Pitch wheel / legato notes on a fixed 2000-sample grid: a block is
    // split at a grid point, so every block size applies them at the same
    // sample (the engine itself must then be block-size independent).
    constexpr std::size_t grid=2000;
    const auto play=[&](std::size_t from,std::size_t to,std::uint64_t* hash) {
        for(std::size_t s=from;s<to;) {
            if(s%grid==0) {
                if(scenario==0 || scenario==5) e.pitchWheel(0,8192+int(3000.0*std::sin(double(s)*0.0007)));
                if(scenario==5 && s%(2*grid)==0) e.noteOn((s/(2*grid))%2 ? 55 : 48,.8f);
            }
            const auto n=std::min({block,to-s,grid-s%grid});
            e.process(io,2,n);
            if(hash) for(std::size_t i=0;i<n;++i) { fnv(*hash,l[i]); fnv(*hash,r[i]); out.finite=out.finite && std::isfinite(l[i]) && std::isfinite(r[i]); }
            s+=n;
        }
    };
    const auto notes=[&] { if(scenario!=5) for(int n:{40,47,52,59,64}) e.noteOn(n,.75f); };
    if(scenario==3) {
        // Warm the spectral cache (the worker builds frames asynchronously),
        // then restart with the same tables: every read is then a cache hit.
        notes();
        for(int pass=0;pass<200;++pass) {
            const auto before=dsp::spectralMisses(dsp::spectralCompilerStats());
            play(0,total,nullptr);
            if(dsp::spectralMisses(dsp::spectralCompilerStats())==before) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
        e.reset();
        e.setModulationState(mod);
    }
    std::uint64_t hash=1469598103934665603ull;
    notes();
    play(0,editAt,&hash);
    if(edit) e.setModulationState(edited);
    play(editAt,total,&hash);
    out.hash=hash;
    return out;
}

}
