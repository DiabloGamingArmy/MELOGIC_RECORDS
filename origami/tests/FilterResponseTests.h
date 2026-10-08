#pragma once
#include "core/dsp/Filter.h"
#include "core/SynthFilter.h"
#include "core/fx/FxFilter.h"
#include <fstream>
#include <iostream>
#include <vector>
#include <limits>
#include <iomanip>
// Sine projection measures the recurrence independently of the transfer provider.
namespace filter_response_audit {
struct Probe {double hz,magnitude;};
template<class Process> Probe sine(double rate,double requested,double cutoff,Process process,int probeCycles=16) {
    const int count=std::max(256,int(std::ceil(rate/requested))*probeCycles);const int cycles=std::max(1,int(std::lround(requested*count/rate)));const double hz=rate*cycles/count,w=2*3.14159265358979323846*hz/rate;
    const int settle=int(std::ceil(std::max({rate*.1,rate/hz*16,rate/std::min(cutoff,rate*.45)*80})));std::complex<double> output{},input{};
    for(int i=0;i<settle+count;++i) {const float x=float(.01*std::sin(w*i)),y=process(x);if(i>=settle){const std::complex<double> basis{std::cos(w*i),-std::sin(w*i)};output+=double(y)*basis;input+=double(x)*basis;}}
    return {hz,std::abs(output/input)};
}
template<class Check> void run(Check check) {
    using namespace mct::origami;std::ofstream csv("/tmp/origami-filter-types-response.csv");csv<<"type,rate,cutoff,resonance,gain,mix,probe,measured_db,analytic_db,error_db\n";double worst=0,worstAbsolute=0;unsigned probes=0;
    const auto measure=[&](dsp::FilterType type,double rate,float cutoff,float res,float gain,float mix) {
        dsp::LowPassCoefficientTable table;table.prepare(rate);const auto base=table.make(cutoff,res);const auto c=dsp::filterDesign(type,base,gain);
        for(double requested:{double(cutoff)*.25,double(cutoff),double(cutoff)*2,rate*.47}) {
            dsp::LowPassFilter filter;const auto p=sine(rate,std::min(requested,rate*.47),cutoff,[&](float x){const float wet=type==dsp::FilterType::LowPass?filter.next(x,base):filter.next(x,c);return x+mix*(wet-x);});
            const double analytic=dsp::filterMagnitude(c,p.hz,rate,mix),error=std::abs(20*std::log10(std::max(p.magnitude,1e-12))-20*std::log10(std::max(analytic,1e-12)));worstAbsolute=std::max(worstAbsolute,std::abs(p.magnitude-analytic));if(analytic>1e-5) worst=std::max(worst,error);++probes;
            csv<<dsp::filterTypeInfo(type)->name<<','<<std::setprecision(10)<<rate<<','<<cutoff<<','<<res<<','<<gain<<','<<mix<<','<<p.hz<<','<<20*std::log10(std::max(p.magnitude,1e-12))<<','<<20*std::log10(std::max(analytic,1e-12))<<','<<error<<'\n';
            check(std::isfinite(p.magnitude) && (analytic>1e-5?error<.02:std::abs(p.magnitude-analytic)<2e-7),"independent Synth DSP versus shared analytical transfer");
        }
    };
    // Manual PEAK case and center/bandwidth regressions, independently measured
    // through the Synth runtime and the canonical Nodes SVF recurrence.
    std::ofstream peakCsv("/tmp/origami-peak-response.csv");peakCsv<<"center,gain,resonance,probe,measured_db,analytic_db,nodes_db,error_db\n";
    double peakWorst=0;
    for(float center:{370.f,1000.f,8000.f}) for(float gain:{-12.f,-6.f,0.f,6.f,12.f}) for(float res:{0.f,.25f,.5f,.547f,.75f,1.f}) {
        dsp::LowPassCoefficientTable table;table.prepare(48000);const auto base=table.make(center,res);
        const auto c=dsp::filterDesign(dsp::FilterType::Bell,base,gain);const auto nodes=fx::svfDesign(dsp::FilterType::Bell,center,.5+3.5*res,gain,48000);
        check(std::abs(20*std::log10(dsp::filterMagnitude(c,center,48000))-gain)<.01,"PEAK center equals boost/cut Gain, not Resonance");
        for(double ratio:{.5,1.,1.5,2.}) {
            SynthFilterRuntime runtime;runtime.adopt(1,dsp::FilterType::Bell);runtime.typedCoefficients=c;
            const auto measured=sine(48000,center*ratio,center,[&](float x){return runtime.process(x,base,0,1,false);},64);
            fx::SvfState state;const auto measuredNodes=sine(48000,center*ratio,center,[&](float x){return state.process(x,nodes);},64);
            const double analytic=dsp::filterMagnitude(c,measured.hz,48000),error=std::abs(20*std::log10(measured.magnitude/analytic));peakWorst=std::max(peakWorst,error);
            check(error<.02 && std::abs(20*std::log10(measuredNodes.magnitude/analytic))<.02,"PEAK actual Synth/Nodes DSP agrees with displayed analytical response");
            if(gain==0) check(std::abs(measured.magnitude-1)<1e-6 && std::abs(analytic-1)<1e-12,"PEAK zero Gain is unity for every Q");
            peakCsv<<center<<','<<gain<<','<<res<<','<<measured.hz<<','<<20*std::log10(measured.magnitude)<<','<<20*std::log10(analytic)<<','<<20*std::log10(measuredNodes.magnitude)<<','<<error<<'\n';
        }
        if(gain!=0) {
            const auto wide=dsp::filterDesign(dsp::FilterType::Bell,table.make(center,0),gain),narrow=dsp::filterDesign(dsp::FilterType::Bell,table.make(center,1),gain);
            check(std::abs(20*std::log10(dsp::filterMagnitude(wide,center*1.5,48000)))>std::abs(20*std::log10(dsp::filterMagnitude(narrow,center*1.5,48000)))+.5,"PEAK increasing Q narrows nonzero-Gain bell");
        }
    }
    std::cout<<"[PEAK response] 360 Synth/Nodes probe pairs; worst Synth error "<<peakWorst<<" dB\n";
    for(const auto& info:dsp::filterTypes) if(info.synth) for(double rate:{44100.,48000.,96000.,192000.}) {
        for(float cutoff:{20.f,100.f,500.f,1000.f,5000.f,10000.f,20000.f}) for(float res:{0.f,.1f,.6f,1.f}) for(float gain:info.gain?std::vector<float>{-24,0,24}:std::vector<float>{0}) measure(info.id,rate,cutoff,res,gain,1);
        for(float mix:{0.f,.35f,1.f}) measure(info.id,rate,1000,.1f,info.gain?6.f:0.f,mix);
        for(float cutoff:{20.f,20000.f}) for(float res:{0.f,1.f}) for(float gain:info.gain?std::vector<float>{-24,24}:std::vector<float>{0}) {
            dsp::LowPassCoefficientTable table;table.prepare(rate);const auto c=dsp::filterDesign(info.id,table.make(cutoff,res),gain);dsp::LowPassFilter state;
            for(int n=0;n<4096;++n) {const float y=state.next(n==0?1.f:0.f,c);check(std::isfinite(y) && std::abs(y)<512,"multimode extreme impulse finite and stable");}
            state.reset();for(int n=0;n<64;++n) check(state.next(0,c)==0,"multimode reset silence exact");check(state.next(std::numeric_limits<float>::quiet_NaN(),c)==0 && state.next(0,c)==0,"multimode nonfinite recovery");
        }
        // Nodes retains its float integrators: ideal nulls have a measured
        // rounding floor below -80 dB at 20 Hz / 192 kHz (absolute tolerance 1e-4).
        // Away from nulls use the same 0.02 dB tolerance as the double kernel.
        for(float cutoff:{20.f,1000.f,20000.f}) for(double ratio:{.25,1.,2.}) {
            const auto c=fx::svfDesign(info.id,cutoff,.85,info.gain?6:0,rate);fx::SvfState state;const auto p=sine(rate,std::min(double(cutoff)*ratio,rate*.47),cutoff,[&](float x){return state.process(x,c);});const double expected=fx::svfMagnitude(c,p.hz,rate);if(expected>1e-5 && std::abs(20*std::log10(p.magnitude/expected))>=.02) std::cout<<"FX discrepancy "<<info.name<<" fs="<<rate<<" cutoff="<<cutoff<<" hz="<<p.hz<<" measured="<<p.magnitude<<" analytic="<<expected<<" db="<<20*std::log10(p.magnitude/expected)<<std::endl;check(expected>1e-5?std::abs(20*std::log10(p.magnitude/expected))<.02:std::abs(p.magnitude-expected)<1e-4,"Nodes SVF shares correct transfer provider for its own coefficients");
        }
    }
    std::ofstream sweep("/tmp/origami-filter-cutoff-sweep.csv");sweep<<"rate,authored,effective_transition,graph_x,endpoint_db\n";
    for(double rate:{44100.,48000.,96000.,192000.}) {dsp::LowPassCoefficientTable table;table.prepare(rate);const dsp::FilterResponseAxis axis{rate};double previous=0,previousX=-1;
        for(float cutoff:{20.f,50.f,100.f,200.f,500.f,1000.f,2000.f,5000.f,10000.f,15000.f,20000.f}) {
            const auto c=table.make(cutoff,.1f);const double effective=std::atan(c.g)*rate/3.14159265358979323846,x=axis.x(effective);check(effective>previous && x>previousX,"cutoff transition moves monotonically right with no foldback");previous=effective;previousX=x;
            for(double ratio:{.98,1.02}) {dsp::LowPassFilter state;const auto p=sine(rate,std::min(effective*ratio,rate*.49),effective,[&](float in){return state.next(in,c);},128);if(!(ratio<1?p.magnitude>.85:p.magnitude<.85)) std::cout<<"Sweep discrepancy fs="<<rate<<" cutoff="<<cutoff<<" effective="<<effective<<" ratio="<<ratio<<" hz="<<p.hz<<" mag="<<p.magnitude<<std::endl;check(ratio<1?p.magnitude>.85:p.magnitude<.85,"measured descending Q threshold straddles effective transition");}
            double last=0;for(int n=0;n<256;++n) {const double hz=axis.frequency(double(n)/255);check(hz>last && std::abs(axis.x(hz)-double(n)/255)<1e-12,"log frequency mapping is invertible and cannot fold");last=hz;check(std::isfinite(axis.y(dsp::lowPassMagnitude(c,hz,rate))),"response graph coordinates finite");}
            sweep<<rate<<','<<cutoff<<','<<effective<<','<<x<<','<<20*std::log10(std::max(dsp::lowPassMagnitude(c,axis.maximum(),rate),1e-12))<<'\n';
        }
    }
    std::cout<<"[filter response] "<<probes<<" independent Synth probes; worst meaningful dB error "<<std::setprecision(12)<<worst<<"; worst absolute magnitude error "<<worstAbsolute<<'\n';
}
}
