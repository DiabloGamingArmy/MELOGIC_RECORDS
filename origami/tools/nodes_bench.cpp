// mct-origami-nodes-n07-consolidation
// Deterministic NODES benchmark: engine render cost, control-plan evaluation
// cost and compile cost for the N07 scenarios. Release builds only give
// meaningful numbers. Usage: origami_nodes_bench [--quick]
#include "core/Engine.h"
#include "tests/NodesScenarios.h"
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

using namespace mct::origami;
namespace sc=mct::origami::scenarios;

namespace {
using Clock=std::chrono::steady_clock;

double median(std::vector<double> v) { std::sort(v.begin(),v.end()); return v[v.size()/2]; }

struct Scenario { const char* name; ModulationState state; int voices; };

// Microseconds per 512-sample block (median of runs).
double renderCost(const Scenario& s,int runs,int blocks) {
    std::vector<double> results;
    for(int run=0;run<runs;++run) {
        auto engine=std::make_unique<OrigamiEngine>();
        engine->prepare(48000.0,512,2);
        for(OscillatorModuleId id=2;id<=4;++id) engine->setOscillatorModuleEnabled(id,false);
        if(!engine->setModulationState(s.state)) { std::fprintf(stderr,"invalid scenario %s\n",s.name); return -1.0; }
        for(int v=0;v<s.voices;++v) engine->noteOn(48+v*3,0.9f);
        std::vector<float> l(512),r(512); float* out[2]{l.data(),r.data()};
        for(int b=0;b<20;++b) engine->process(out,2,512); // warm-up (plan compiled, voices running)
        const auto t0=Clock::now();
        for(int b=0;b<blocks;++b) engine->process(out,2,512);
        const auto t1=Clock::now();
        results.push_back(std::chrono::duration<double,std::micro>(t1-t0).count()/double(blocks));
    }
    return median(results);
}

// Nanoseconds per sample for global operator evaluation + global frame.
double evaluatorCost(const ModulationState& m,int runs,int samples) {
    std::array<OscillatorModuleState,16> modules{};
    for(std::size_t i=0;i<4;++i) modules[i].id=OscillatorModuleId(i+1);
    std::vector<double> results;
    for(int run=0;run<runs;++run) {
        auto compiled=std::make_unique<CompiledModulation>();
        auto frame=std::make_unique<ModulationFrame>();
        compiled->prepare(48000.0);
        compiled->compile(m,modules,true);
        SequencerGenerator sequencer; sequencer.reset(); SequencerSettings settings;
        std::array<float,CompiledModulation::globalSourceCount> sources{};
        double beats=0.0;
        const auto t0=Clock::now();
        for(int n=0;n<samples;++n) {
            sources[0]=float((n%480)/240.0-1.0); sources[1]=float((n%1000)/1000.0);
            frame->events.beats=beats; frame->events.beatsPerSample=120.0/60.0/48000.0; frame->events.sampleRate=48000.0;
            frame->events.sequencer=&sequencer; frame->events.sequencerSettings=&settings;
            if(compiled->hasOperators()) compiled->evaluateGlobalOperators(*frame,sources);
            frame->cutoff=1000.0f; frame->resonance=0.1f;
            compiled->globalFrame(*frame,sources,48000.0);
            beats+=frame->events.beatsPerSample;
        }
        const auto t1=Clock::now();
        results.push_back(std::chrono::duration<double,std::nano>(t1-t0).count()/double(samples));
    }
    return median(results);
}

// Microseconds per compile(): a full build (immediate), or a republish of an
// unchanged state (N07: classified and skipped).
double compileCost(const ModulationState& m,int runs,int compiles,bool full) {
    std::array<OscillatorModuleState,16> modules{};
    for(std::size_t i=0;i<4;++i) modules[i].id=OscillatorModuleId(i+1);
    std::vector<double> results;
    auto compiled=std::make_unique<CompiledModulation>();
    compiled->prepare(48000.0);
    for(int run=0;run<runs;++run) {
        const auto t0=Clock::now();
        for(int i=0;i<compiles;++i) compiled->compile(m,modules,full);
        const auto t1=Clock::now();
        results.push_back(std::chrono::duration<double,std::micro>(t1-t0).count()/double(compiles));
    }
    return median(results);
}
}

int main(int argc,char** argv) {
    const bool quick=argc>1 && std::strcmp(argv[1],"--quick")==0;
    const int runs=quick ? 3 : 7,blocks=quick ? 100 : 400,samples=quick ? 48000 : 240000,compiles=quick ? 200 : 1000;
    std::vector<Scenario> scenarios{
        {"A empty",ModulationState{},1},
        {"B 1 direct route",sc::directRoutes(1),1},
        {"C 8 direct routes",sc::directRoutes(8),1},
        {"D 16 direct routes",sc::directRoutes(16),1},
        {"E 32 direct routes",sc::directRoutes(32),1},
        {"F 8 control operators",sc::controlChain(8),1},
        {"G 24 mixed control",sc::mixedControl(),1},
        {"H event-heavy",sc::eventHeavy(),1},
        {"I sequencing/generative",sc::sequencing(),1},
        {"J 32-node mixed",sc::maximal(),1},
        {"K per-voice x16 voices",sc::perVoice(),16},
        {"K0 empty x16 voices",ModulationState{},16},
        {"J 32-node x16 voices",sc::maximal(),16},
    };
    std::printf("%-26s %14s %14s %14s %14s\n","scenario","render us/blk","eval ns/smp","compile us","republish us");
    for(const auto& s:scenarios) {
        const double render=renderCost(s,runs,blocks);
        const double eval=evaluatorCost(s.state,runs,samples);
        const double compile=compileCost(s.state,runs,compiles,true);
        const double republish=compileCost(s.state,runs,compiles,false);
        std::printf("%-26s %14.2f %14.2f %14.3f %14.3f\n",s.name,render,eval,compile,republish);
    }
    std::printf("sizeof: engine=%zu voice=%zu compiled=%zu frame=%zu modstate=%zu opstate=%zu runtime=%zu snapshot=%zu\n",
                sizeof(OrigamiEngine),sizeof(Voice),sizeof(CompiledModulation),sizeof(ModulationFrame),sizeof(ModulationState),
                sizeof(CompiledModulation::OperatorState),sizeof(ControlOpRuntime),sizeof(RuntimeVisualizationSnapshot));
    return 0;
}
