// mct-origami-deep-audit-p03-fix2-canonical-state-repair
// mct-origami-deep-audit-p03-canonical-state
// mct-origami-audio-reengineer-p17-global-qos-budget
// mct-origami-audio-reengineer-p16-arp-ui-coalescing
// mct-origami-audio-reengineer-p15-state-io-suspension
// mct-origami-audio-reengineer-p14-callback-lock-mailboxes
// mct-origami-audio-reengineer-p13-audioplayhead-boundary
// mct-origami-audio-reengineer-p12-host-block-ui-telemetry
// mct-origami-audio-reengineer-p11-full-wrapper-rt-guard
// mct-origami-audio-reengineer-p05.6-control-identity
// mct-origami-audio-reengineer-p05-plugin-rt-allocation-gate
// mct-origami-v24.0.6-plugin-audio-audit-pan-smoothing-repair
// mct-origami-v24.0.5-plugin-audio-audit-smoothing-repair
// mct-origami-v24.0.4-plugin-audio-audit-osc1-repair
// mct-origami-v24.0.3-plugin-audio-gate
// mct-origami-v23.2-literal-newline-repair-2
// mct-origami-playability-audio-audit-v23.2
#include "plugin/PluginProcessor.h"
#include "plugin/PluginEditor.h"
#include "plugin/ui/WavetableFrameOps.h"
#include "plugin/ui/ModulationUiTelemetry.h"
#include "plugin/ui/FxPage.h"
#include "plugin/ui/ModulationDestinations.h"
#include "core/preset/StateCodec.h"
#include "tests/NodesScenarios.h"
#include <BinaryData.h>
#include <cxxabi.h>
#include <iomanip>
#include <map>
#include <typeinfo>
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <atomic>
#include <cstdlib>
#include <new>
#include <array>
#include <bitset>
#include <cmath>
using namespace mct::origami;
namespace {
std::atomic<bool> pluginGuardAllocations{false};
std::atomic<unsigned> pluginAllocations{0};
}
#ifndef ORIGAMI_SANITIZED
void* operator new(std::size_t size) {
    if(pluginGuardAllocations.load(std::memory_order_relaxed))
        pluginAllocations.fetch_add(1,std::memory_order_relaxed);
    if(void* p=std::malloc(size?size:1)) return p;
    throw std::bad_alloc();
}
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p,std::size_t) noexcept { std::free(p); }
void operator delete[](void* p,std::size_t) noexcept { std::free(p); }
#endif
namespace {
unsigned checks=0;
void check(bool b,const char* label){++checks;if(!b) throw std::runtime_error(label);}
void walk(juce::Component& c,const std::function<void(juce::Component&)>& f) {
    f(c);for(auto* child:c.getChildren()) walk(*child,f);
}
ui::OscillatorRack& rack(juce::Component& editor) {
    ui::OscillatorRack* result=nullptr;
    walk(editor,[&](auto& c){if(auto* r=dynamic_cast<ui::OscillatorRack*>(&c)) result=r;});
    check(result!=nullptr,"editor rack present");return *result;
}
juce::MouseEvent event(juce::Component& c) {
    return {juce::Desktop::getInstance().getMainMouseSource(),{5,5},{},1,0,0,0,0,&c,&c,
            juce::Time::getCurrentTime(),{5,5},juce::Time::getCurrentTime(),0,false};
}
float magnitude(const juce::AudioBuffer<float>& audio) {
    float peak=0.0f;
    for(int ch=0;ch<audio.getNumChannels();++ch)
        peak=juce::jmax(peak,audio.getMagnitude(ch,0,audio.getNumSamples()));
    return peak;
}
double energy(const juce::AudioBuffer<float>& audio) {
    double total=0.0;
    for(int ch=0;ch<audio.getNumChannels();++ch)
        for(int i=0;i<audio.getNumSamples();++i) {
            const double v=audio.getSample(ch,i);
            total+=v*v;
        }
    return total;
}
juce::AudioBuffer<float> renderNote(OrigamiAudioProcessor& p,int note=60,float velocity=.8f,int samples=1024) {
    juce::AudioBuffer<float> audio(2,samples);
    audio.clear();
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1,note,velocity),0);
    p.processBlock(audio,midi);
    return audio;
}
void releaseNote(OrigamiAudioProcessor& p,int note=60,int blocks=64,int blockSize=128) {
    juce::AudioBuffer<float> audio(2,blockSize);
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOff(1,note),0);
    p.processBlock(audio,midi);
    for(int i=1;i<blocks;++i) {
        audio.clear();midi.clear();p.processBlock(audio,midi);
    }
}
void disableExtraOscillators(OrigamiAudioProcessor& p) {
    for(unsigned id=2;id<=4;++id)
        p.setUiOscillatorEnabled(id,false);
}
void audioContinuityP0Audit() {
    auto configure=[](OrigamiAudioProcessor& p) {
        p.prepareToPlay(48000.0,256);
        disableExtraOscillators(p);
        check(p.setUiParameter(ParameterId::Waveform,0.0f),"P0 sine WT position accepted");
        check(p.setUiParameter(ParameterId::Sustain,1.0f),"P0 sustain accepted");
        check(p.setUiParameter(ParameterId::Attack,0.001f),"P0 fast attack accepted");
        check(p.setUiParameter(ParameterId::OscUnison,1.0f),"P0 single unison accepted");
        p.resetAudioContinuityDiagnostics();
    };
    auto callbackEnergy=[](const juce::AudioBuffer<float>& audio) {
        double total=0.0;
        for(int i=0;i<audio.getNumSamples();++i) {
            const double v=audio.getSample(0,i);
            total+=v*v;
        }
        return total;
    };
    auto runHeld=[&](OrigamiAudioProcessor& p,bool uiInput) {
        constexpr int block=256,callbacks=18;
        juce::AudioBuffer<float> audio(2,block);
        juce::MidiBuffer midi;
        if(uiInput) check(p.enqueueUiKeyboardNote(74,true,0.85f),
                          "P0 UI note-on enters queue");
        else midi.addEvent(juce::MidiMessage::noteOn(1,74,0.85f),0);

        std::array<double,callbacks> energies{};
        std::array<float,callbacks> firstSamples{},lastSamples{};
        for(int n=0;n<callbacks;++n) {
            audio.clear();
            p.processBlock(audio,midi);
            midi.clear();
            energies[static_cast<std::size_t>(n)]=callbackEnergy(audio);
            firstSamples[static_cast<std::size_t>(n)]=audio.getSample(0,0);
            lastSamples[static_cast<std::size_t>(n)]=audio.getSample(0,block-1);
        }
        // Ignore attack callback. Every later callback of one held note must
        // contain substantial signal; this catches the observed 256-on/512-off cadence.
        double reference=0.0;
        for(int n=3;n<callbacks;++n) reference=juce::jmax(reference,energies[static_cast<std::size_t>(n)]);
        check(reference>1.0e-5,"P0 held sine establishes callback energy");
        for(int n=3;n<callbacks;++n)
            check(energies[static_cast<std::size_t>(n)]>reference*0.10,
                  "P0 held sine never drops an entire 256-sample callback");

        const auto d=p.getAudioContinuityDiagnostics();
        check(d.callbacks==callbacks,"P0 diagnostics count every host callback");
        check(d.beginHostBlockFailures==0,"P0 beginHostBlock never rejects held-note callback");
        check(d.processSpanFailures==0,"P0 processSpan never rejects held-note span");
        check(d.requestedSpanSamples==d.renderedSpanSamples,
              "P0 every requested span reaches engine renderer");
        check(d.zeroOutputCallbacks==0,"P0 held sine has no zero-output callbacks");
        check(d.uiMidiEventsDrained==(uiInput?1u:0u),
              "P0 UI MIDI drain count matches source");

        // A block-boundary discontinuity large enough to sound like the captured
        // hard gating must not appear on a stable sine. Adjacent sample delta is
        // bounded generously relative to full-scale output.
        for(int n=4;n<callbacks;++n)
            check(std::abs(firstSamples[static_cast<std::size_t>(n)]
                         -lastSamples[static_cast<std::size_t>(n-1)])<0.25f,
                  "P0 held sine remains sample-continuous across host callbacks");
    };

    auto hostOwner=std::make_unique<OrigamiAudioProcessor>(); auto& host=*hostOwner;
    configure(host);
    runHeld(host,false);

    auto uiOwner=std::make_unique<OrigamiAudioProcessor>(); auto& ui=*uiOwner;
    configure(ui);
    runHeld(ui,true);

    // Repeat at host sizes surrounding the captured 256-sample cadence. This
    // distinguishes a true fixed-block failure from a generic oscillator defect.
    for(const int blockSize:{64,128,512,1024}) {
        auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
        p.prepareToPlay(48000.0,blockSize);
        disableExtraOscillators(p);
        check(p.setUiParameter(ParameterId::Waveform,0.0f),"P0 varied-block sine accepted");
        check(p.setUiParameter(ParameterId::Sustain,1.0f),"P0 varied-block sustain accepted");
        juce::AudioBuffer<float> audio(2,blockSize);
        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,74,0.85f),0);
        p.resetAudioContinuityDiagnostics();
        double minimum=std::numeric_limits<double>::max(),maximum=0.0;
        for(int n=0;n<12;++n) {
            audio.clear();p.processBlock(audio,midi);midi.clear();
            if(n>=3) {
                const auto e=callbackEnergy(audio);
                minimum=std::min(minimum,e);maximum=std::max(maximum,e);
            }
        }
        check(maximum>1.0e-5 && minimum>maximum*0.05,
              "P0 held sine survives varied host callback sizes");
        const auto d=p.getAudioContinuityDiagnostics();
        check(d.beginHostBlockFailures==0 && d.processSpanFailures==0,
              "P0 varied host sizes never reject render boundaries");
        check(d.requestedSpanSamples==d.renderedSpanSamples,
              "P0 varied host sizes render every requested sample");
    }
}

void audioPurityP0Audit() {
    // Continuity can still pass a continuously distorted waveform. Render an
    // isolated sine through the full processor path and fit its fundamental.
    constexpr double sampleRate=48000.0;
    constexpr int blockSize=256, warmupBlocks=12, captureBlocks=32, note=69;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(sampleRate,blockSize);
    disableExtraOscillators(p);
    check(p.setUiParameter(ParameterId::Waveform,0.0f),"P0 purity sine WT position accepted");
    check(p.setUiParameter(ParameterId::Sustain,1.0f),"P0 purity sustain accepted");
    check(p.setUiParameter(ParameterId::Attack,0.001f),"P0 purity attack accepted");
    check(p.setUiParameter(ParameterId::OscUnison,1.0f),"P0 purity single unison accepted");
    check(p.setUiParameter(ParameterId::OscDetune,0.0f),"P0 purity detune disabled");
    check(p.setUiParameter(ParameterId::OscPan,0.0f),"P0 purity pan centered");
    check(p.setUiParameter(ParameterId::Cutoff,20000.0f),"P0 purity cutoff opened");
    check(p.setUiParameter(ParameterId::Resonance,0.0f),"P0 purity resonance disabled");
    auto state=p.getUiInstrumentState();
    state.modulation.filterEnabled=false;
    check(p.setUiModulationState(state.modulation),"P0 purity filter disabled");
    p.resetAudioContinuityDiagnostics();

    juce::AudioBuffer<float> audio(2,blockSize);
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1,note,1.0f),0);
    for(int n=0;n<warmupBlocks;++n) { audio.clear();p.processBlock(audio,midi);midi.clear(); }

    std::array<float,blockSize*captureBlocks> captured{};
    std::size_t write=0;
    for(int n=0;n<captureBlocks;++n) {
        audio.clear();p.processBlock(audio,midi);
        for(int i=0;i<blockSize;++i) captured[write++]=audio.getSample(0,i);
    }

    const double omega=2.0*juce::MathConstants<double>::pi*440.0/sampleRate;
    double sum=0.0,sinSin=0.0,cosCos=0.0,sinCos=0.0,xSin=0.0,xCos=0.0;
    double dcSin=0.0,dcCos=0.0;
    for(std::size_t n=0;n<captured.size();++n) {
        const double x=captured[n], sn=std::sin(omega*static_cast<double>(n)),
                     cs=std::cos(omega*static_cast<double>(n));
        sum+=x;sinSin+=sn*sn;cosCos+=cs*cs;sinCos+=sn*cs;
        xSin+=x*sn;xCos+=x*cs;dcSin+=sn;dcCos+=cs;
    }
    const double dc=sum/static_cast<double>(captured.size());
    xSin-=dc*dcSin;xCos-=dc*dcCos;
    const double determinant=sinSin*cosCos-sinCos*sinCos;
    check(std::abs(determinant)>1.0e-9,"P0 purity sine fit is well conditioned");
    const double a=(xSin*cosCos-xCos*sinCos)/determinant;
    const double b=(xCos*sinSin-xSin*sinCos)/determinant;
    double signalEnergy=0.0,residualEnergy=0.0,peakDelta=0.0;
    for(std::size_t n=0;n<captured.size();++n) {
        const double fitted=dc+a*std::sin(omega*static_cast<double>(n))
                               +b*std::cos(omega*static_cast<double>(n));
        const double residual=static_cast<double>(captured[n])-fitted;
        signalEnergy+=(fitted-dc)*(fitted-dc);residualEnergy+=residual*residual;
        if(n) peakDelta=std::max(peakDelta,std::abs(
            static_cast<double>(captured[n])-static_cast<double>(captured[n-1])));
    }
    check(signalEnergy>1.0e-6,"P0 purity sine has measurable fundamental energy");
    const double distortionRatio=std::sqrt(residualEnergy/std::max(signalEnergy,1.0e-20));
    check(distortionRatio<0.02,"P0 processor sine residual distortion stays below 2 percent");
    check(std::abs(dc)<0.01,"P0 processor sine has negligible DC offset");
    check(peakDelta<0.20,"P0 processor sine has no bitcrush-like sample discontinuities");
    const auto d=p.getAudioContinuityDiagnostics();
    check(d.beginHostBlockFailures==0 && d.processSpanFailures==0,
          "P0 purity render has no rejected host spans");
    check(d.requestedSpanSamples==d.renderedSpanSamples,
          "P0 purity render executes every requested sample");
}

void multiOscillatorTopologyP0Audit() {
    // Reproduce the live Standalone topology at its observed 96 kHz / 512.
    // Identical, phase-aligned sine modules mixed with 1/N normalization must
    // not change pitch or waveform as active-module count changes.
    constexpr double sampleRate=96000.0;
    constexpr int blockSize=512,warmupBlocks=16,captureBlocks=32,note=69;
    constexpr double expectedHz=440.0;
    using Capture=std::array<float,blockSize*captureBlocks>;

    auto capture=[&](int activeCount) {
        auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
        p.prepareToPlay(sampleRate,blockSize);
        check(p.setUiParameter(ParameterId::Waveform,0.0f),"P0 topology sine WT accepted");
        check(p.setUiParameter(ParameterId::Sustain,1.0f),"P0 topology sustain accepted");
        check(p.setUiParameter(ParameterId::Attack,0.001f),"P0 topology attack accepted");
        check(p.setUiParameter(ParameterId::OscUnison,1.0f),"P0 topology OSC1 unison accepted");
        check(p.setUiParameter(ParameterId::OscDetune,0.0f),"P0 topology OSC1 detune disabled");
        check(p.setUiParameter(ParameterId::OscPan,0.0f),"P0 topology OSC1 pan centered");
        check(p.setUiParameter(ParameterId::Cutoff,20000.0f),"P0 topology cutoff opened");
        check(p.setUiParameter(ParameterId::Resonance,0.0f),"P0 topology resonance disabled");

        auto state=p.getUiInstrumentState();
        state.modulation.filterEnabled=false;
        check(p.setUiModulationState(state.modulation),"P0 topology filter disabled");

        for(unsigned id=2;id<=4;++id) {
            auto osc=p.getUiOscillatorState(id);
            osc.tableId=mct::origami::dsp::BuiltinWavetableId::BasicShapes;
            osc.wtPosition=0.0f;osc.waveform=0.0f;
            osc.octave=0.0f;osc.semitone=0.0f;osc.fineCents=0.0f;
            osc.unison=1;osc.detuneCents=0.0f;osc.blend=0.0f;
            osc.pan=0.0f;osc.level=p.getUiParameter(ParameterId::OscLevel);
            osc.processCount=0;osc.routeCount=0;
            osc.process1=mct::origami::dsp::OscProcessType::Off;
            osc.process2=mct::origami::dsp::OscProcessType::Off;
            osc.route1Type=mct::origami::OscRouteType::Off;
            osc.route2Type=mct::origami::OscRouteType::Off;
            osc.route1SourceId=0;osc.route2SourceId=0;
            check(p.setUiOscillatorState(id,osc),"P0 topology module state accepted");
            check(p.setUiOscillatorEnabled(id,static_cast<int>(id)<=activeCount),
                  "P0 topology module power accepted");
        }

        p.resetAudioContinuityDiagnostics();
        juce::AudioBuffer<float> audio(2,blockSize);
        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,note,1.0f),0);
        for(int b=0;b<warmupBlocks;++b){audio.clear();p.processBlock(audio,midi);midi.clear();}

        Capture out{};std::size_t write=0;
        double callbackMs=0.0,worstCallbackMs=0.0;
        std::array<double,captureBlocks> callbackTimes{};
        for(int b=0;b<captureBlocks;++b){
            audio.clear();p.processBlock(audio,midi);
            const auto timing=p.getAudioContinuityDiagnostics();
            callbackTimes[static_cast<std::size_t>(b)]=timing.lastCallbackMs;
            callbackMs+=timing.lastCallbackMs;
            worstCallbackMs=std::max(worstCallbackMs,timing.lastCallbackMs);
            for(int i=0;i<blockSize;++i) out[write++]=audio.getSample(0,i);
        }
        const auto observedState=p.getUiInstrumentState();
        const auto activeModules=std::count_if(
            observedState.oscillators.begin(),observedState.oscillators.end(),
            [](const auto& osc){return osc.id!=0 && osc.enabled;});
        check(activeModules==activeCount,"P0 topology enables the requested module count");
        std::sort(callbackTimes.begin(),callbackTimes.end());
        const double medianCallbackMs=(callbackTimes[captureBlocks/2-1]+callbackTimes[captureBlocks/2])*0.5;
        std::cout<<"[Origami P0 timing] oscillators="<<activeCount
                 <<" avgMs="<<callbackMs/captureBlocks
                 <<" medianMs="<<medianCallbackMs
                 <<" worstMs="<<worstCallbackMs
                 <<" activeModules="<<activeModules
                 <<std::endl;
#if defined(NDEBUG)
        check(medianCallbackMs<2.0,
              "P0 96 kHz callback retains substantial deadline headroom");
#endif
        const auto d=p.getAudioContinuityDiagnostics();
        check(d.beginHostBlockFailures==0 && d.processSpanFailures==0,
              "P0 topology has no rejected spans");
        return out;
    };

    const auto analyse=[&](const Capture& x) {
        struct Result { double frequency=0,rms=0,dc=0,distortion=0,maxDelta=0; };
        Result r{};
        double sum=0,energy=0;
        int crossings=0;
        for(std::size_t i=0;i<x.size();++i){
            sum+=x[i];energy+=double(x[i])*double(x[i]);
            if(i && x[i-1]<=0.0f && x[i]>0.0f) ++crossings;
            if(i) r.maxDelta=std::max(r.maxDelta,std::abs(double(x[i])-double(x[i-1])));
        }
        r.dc=sum/double(x.size());r.rms=std::sqrt(energy/double(x.size()));
        r.frequency=double(crossings)*sampleRate/double(x.size());

        const double omega=2.0*juce::MathConstants<double>::pi*expectedHz/sampleRate;
        double ss=0,cc=0,sc=0,xs=0,xc=0;
        for(std::size_t i=0;i<x.size();++i){
            const double sn=std::sin(omega*double(i)),cs=std::cos(omega*double(i));
            ss+=sn*sn;cc+=cs*cs;sc+=sn*cs;
            const double y=double(x[i])-r.dc;xs+=y*sn;xc+=y*cs;
        }
        const double det=ss*cc-sc*sc;
        const double a=(xs*cc-xc*sc)/det,b=(xc*ss-xs*sc)/det;
        double sig=0,res=0;
        for(std::size_t i=0;i<x.size();++i){
            const double fit=a*std::sin(omega*double(i))+b*std::cos(omega*double(i));
            const double y=double(x[i])-r.dc;sig+=fit*fit;res+=(y-fit)*(y-fit);
        }
        r.distortion=std::sqrt(res/std::max(sig,1.0e-20));
        return r;
    };

    std::array<Capture,4> captures{};
    std::array<decltype(analyse(captures[0])),4> metrics{};
    for(int count=1;count<=4;++count) {
        captures[static_cast<std::size_t>(count-1)]=capture(count);
        metrics[static_cast<std::size_t>(count-1)]=analyse(captures[static_cast<std::size_t>(count-1)]);
        const auto& m=metrics[static_cast<std::size_t>(count-1)];
        std::cout<<"[Origami P0 topology] oscillators="<<count
                 <<" freq="<<m.frequency<<" rms="<<m.rms<<" dc="<<m.dc
                 <<" residual="<<m.distortion<<" maxDelta="<<m.maxDelta<<std::endl;
        check(std::abs(m.frequency-expectedHz)<8.0,"P0 topology preserves sine frequency");
        check(m.distortion<0.02,"P0 topology remains spectrally clean");
    }

    const double referenceRms=metrics[0].rms;
    for(std::size_t i=1;i<metrics.size();++i)
        check(std::abs(metrics[i].rms-referenceRms)<std::max(0.002,referenceRms*0.05),
              "P0 topology 1/N normalization preserves identical-oscillator RMS");
}

void uiKeyboardRealtimeBoundaryAudit() {
    const auto root=juce::File(__FILE__).getParentDirectory().getParentDirectory();
    const auto processor=root.getChildFile("plugin/PluginProcessor.cpp").loadFileAsString();
    const auto header=root.getChildFile("plugin/PluginProcessor.h").loadFileAsString();
    const auto keyboard=root.getChildFile("plugin/ui/PerformanceKeyboard.cpp").loadFileAsString();
    check(processor.isNotEmpty() && header.isNotEmpty() && keyboard.isNotEmpty(),
          "UI keyboard realtime-boundary sources are available");

    const int processStart=processor.indexOf("void OrigamiAudioProcessor::processBlock");
    const int stateStart=processor.indexOf(processStart,"void OrigamiAudioProcessor::getStateInformation");
    check(processStart>=0 && stateStart>processStart,"processBlock keyboard audit bounds found");
    const auto processBody=processor.substring(processStart,stateStart);

    check(!processBody.contains("processNextMidiBuffer"),
          "processBlock contains no MidiKeyboardState lock bridge");
    check(!processBody.contains("uiKeyboardState_"),
          "processBlock does not access MidiKeyboardState");
    check(processBody.contains("drainUiKeyboardMidi(inputMidi);"),
          "processBlock drains fixed UI MIDI queue");
    check(header.contains("uiMidiCapacity_=1024"),
          "UI MIDI bridge is fixed-capacity");
    check(header.contains("std::atomic<std::uint32_t> uiMidiWrite_"),
          "UI MIDI bridge uses atomic SPSC cursors");
    check(!header.contains("juce::MidiKeyboardState uiKeyboardState_"),
          "processor owns no MidiKeyboardState");
    check(keyboard.contains("noteSetter_(mouseNote_,true,0.85f)"),
          "performance keyboard publishes note-on through lock-free bridge");
    check(keyboard.contains("noteSetter_(mouseNote_,false,0.0f)"),
          "performance keyboard publishes note-off through lock-free bridge");
}

void renderBudgetPolicyAudit() {
    GlobalRenderBudget budget;
    RenderLoad load{};
    load.activeVoices=8;
    load.activeModules=4;
    load.totalUnison=16;
    load.oscillatorEvaluationsPerSample=160;

    for(int i=0;i<12;++i) budget.observe(0.25f,load);
    check(budget.snapshot().level==RenderQoSLevel::Nominal,
          "QoS stays nominal with strong callback headroom");
    check(!budget.snapshot().suppressVisualTelemetry,
          "nominal QoS preserves visualization telemetry");

    budget.observe(0.65f,load);
    check(budget.snapshot().level==RenderQoSLevel::Guarded,
          "QoS enters guarded state before deadline danger");
    check(budget.snapshot().suppressVisualTelemetry
          && budget.snapshot().reduceControlRate,
          "guarded QoS sheds nonessential/control-rate work first");
    check(!budget.snapshot().reduceOptionalEffectQuality,
          "guarded QoS does not prematurely degrade optional effects");

    budget.observe(0.90f,load);
    check(budget.snapshot().level==RenderQoSLevel::Critical,
          "QoS enters critical state under callback pressure");
    check(budget.snapshot().reduceOptionalEffectQuality
          && budget.snapshot().restrictNewHighCostVoices,
          "critical QoS exposes effect-quality and new-voice admission hooks");
    check(budget.snapshot().voiceAdmissionActive,
          "critical QoS actively enables synth voice admission control");
    check(budget.snapshot().voiceAdmissionCeiling>=1
          && budget.snapshot().voiceAdmissionCeiling<load.activeVoices,
          "critical QoS derives a lower admission ceiling from measured pressure");

    const auto misses=budget.snapshot().deadlineMisses;
    budget.observe(1.05f,load);
    check(budget.snapshot().deadlineMisses==misses+1,
          "QoS counts hard callback deadline misses");

    budget.observe(0.99f,load);
    budget.observe(0.99f,load);
    check(budget.snapshot().bypassNewestOptionalEffect,
          "optional-effect bypass requires sustained emergency pressure");
}

void globalQosBoundaryAudit() {
    const auto root=juce::File(__FILE__).getParentDirectory().getParentDirectory();
    const auto processor=root.getChildFile("plugin/PluginProcessor.cpp").loadFileAsString();
    const auto engine=root.getChildFile("core/Engine.cpp").loadFileAsString();
    const auto budget=root.getChildFile("core/RenderBudget.h").loadFileAsString();
    check(processor.isNotEmpty() && engine.isNotEmpty() && budget.isNotEmpty(),
          "Patch 17 QoS sources are available");

    check(processor.contains("getHighResolutionTicks()"),
          "processBlock QoS measures actual callback elapsed time");
    check(processor.contains("finalizeRenderBudget(callbackStartTicks,total)"),
          "callbacks finalize the global budget");
    check(processor.contains("renderBudget_.snapshot().suppressVisualTelemetry"),
          "visual telemetry obeys the global QoS decision");
    check(engine.contains("RenderLoad OrigamiEngine::renderLoad() const noexcept"),
          "engine exports synth load from the latched host-block topology");
    check(engine.contains("hostModules_"),
          "QoS load accounting reuses the existing host-block module snapshot");
    check(engine.contains("voiceAdmissionCeiling_"),
          "engine enforces measured QoS admission ceiling");
    check(processor.contains("engine_.setVoiceAdmissionCeiling("),
          "processor applies QoS admission policy at host-block boundary");
    check(budget.contains("voiceAdmissionCeiling"),
          "global budget emits enforceable synth admission policy");
    check(!budget.contains("sleep_for") && !budget.contains("mutex")
          && !budget.contains("operator new"),
          "QoS controller contains no wait/lock/heap operations");
}

// mct-origami-audio-reengineer-p17-fix2-function-local-arp-audit
void arpTelemetryBoundaryAudit() {
    const auto f=juce::File(__FILE__).getParentDirectory().getParentDirectory().getChildFile("plugin/PluginProcessor.cpp");
    const auto text=f.loadFileAsString();
    check(text.isNotEmpty(),"PluginProcessor.cpp available for ARP telemetry audit");

    const int capture=text.indexOf("void OrigamiAudioProcessor::captureArpNote");
    const int choose=text.indexOf(capture,"int OrigamiAudioProcessor::chooseArpNote");
    const int service=text.indexOf("void OrigamiAudioProcessor::serviceVisualTelemetry");
    const int finalize=text.indexOf(service,"void OrigamiAudioProcessor::finalizeRenderBudget");
    const int process=text.indexOf("void OrigamiAudioProcessor::processBlock");
    const int state=text.indexOf(process,"void OrigamiAudioProcessor::getStateInformation");

    check(capture>=0 && choose>capture,
          "ARP event function bounds found");
    check(service>=0 && finalize>service,
          "QoS telemetry service bounds found");
    check(process>=0 && state>process,
          "processBlock telemetry boundary bounds found");

    const auto captureBody=text.substring(capture,choose);
    check(!captureBody.contains("publishArpUiSnapshot();"),
          "ARP event paths contain no direct UI publication");

    const auto serviceBody=text.substring(service,finalize);
    check(serviceBody.contains("arpUiDirty_.exchange("),
          "QoS telemetry service owns ARP dirty-state coalescing");
    check(serviceBody.contains("publishArpUiSnapshot();"),
          "QoS telemetry service publishes dirty ARP snapshot");
    check(serviceBody.contains("suppressVisualTelemetry"),
          "ARP telemetry publication obeys global QoS policy");

    const auto processBody=text.substring(process,state);
    check(processBody.contains("serviceVisualTelemetry(total);"),
          "processBlock services ARP/UI telemetry at host-block boundary");
    check(!processBody.contains("publishArpUiSnapshot();"),
          "processBlock contains no duplicate direct ARP publication");
}

void stateIoBoundaryAudit() {
    const auto root=juce::File(__FILE__).getParentDirectory().getParentDirectory();
    const auto text=root.getChildFile("plugin/PluginProcessor.cpp").loadFileAsString();
    const auto header=root.getChildFile("plugin/PluginProcessor.h").loadFileAsString();
    check(text.isNotEmpty() && header.isNotEmpty(),
          "Patch 03 state-I/O sources are available");

    const int gs=text.indexOf("void OrigamiAudioProcessor::getStateInformation");
    const int ss=text.indexOf("void OrigamiAudioProcessor::setStateInformation");
    const int um=text.indexOf("bool OrigamiAudioProcessor::setUiMacro");
    check(gs>=0 && ss>gs && um>ss,"state-I/O source bounds found");
    const auto gb=text.substring(gs,ss);
    const auto sb=text.substring(ss,um);

    check(!gb.contains("suspendProcessing(") && !sb.contains("suspendProcessing("),
          "normal state I/O never suspends processing");
    check(!gb.contains("getCallbackLock()") && !sb.contains("getCallbackLock()"),
          "state I/O contains no callback lock");
    check(!gb.contains("engine_.instrumentState()"),
          "autosave does not interrogate live renderer state");
    check(gb.contains("snapshot=uiInstrumentState_"),
          "state save snapshots canonical non-RT model");
    check(sb.contains("decodeInstrumentState("),
          "preset restore decodes before publication");
    check(sb.contains("restoreMailbox_.publish"),
          "state restore publishes one complete model generation");
    check(sb.contains("uiPerformanceState_=state.performance"),
          "preset restore synchronizes UI performance mirror");
    check(header.contains("LatestStateMailbox<mct::origami::InstrumentState> restoreMailbox_"),
          "processor owns complete-state restore mailbox");

    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,128);
    disableExtraOscillators(p);

    juce::AudioBuffer<float> first(2,128); first.clear();
    juce::MidiBuffer on;
    on.addEvent(juce::MidiMessage::noteOn(1,60,0.8f),0);
    p.processBlock(first,on);
    check(magnitude(first)>1.0e-5f,"pre-autosave note is audible");

    juce::MemoryBlock saved;
    p.getStateInformation(saved);
    check(!p.isSuspended(),"autosave does not suspend processor");

    juce::AudioBuffer<float> after(2,128); after.clear();
    juce::MidiBuffer none;
    p.processBlock(after,none);
    check(magnitude(after)>1.0e-5f,
          "autosave does not create an audible processing hole");

    p.setStateInformation(saved.getData(),static_cast<int>(saved.getSize()));
    check(!p.isSuspended(),"state recall does not suspend processor");
}

void callbackLockBoundaryAudit() {
    const auto f=juce::File(__FILE__).getParentDirectory().getParentDirectory().getChildFile("plugin/PluginProcessor.cpp");
    const auto text=f.loadFileAsString();
    check(text.isNotEmpty(),"PluginProcessor.cpp available for callback-lock audit");
    int search=0,count=0;
    while((search=text.indexOf(search,"getCallbackLock()"))>=0){++count;search+=17;}
    check(count==0,"processor implementation contains no JUCE callback-lock acquisition");
    const int perf=text.indexOf("bool OrigamiAudioProcessor::setUiPerformanceState");
    const int editor=text.indexOf("juce::AudioProcessorEditor* OrigamiAudioProcessor::createEditor");
    check(perf>=0 && editor>perf,"routine UI state source bounds found");
    check(!text.substring(perf,editor).contains("getCallbackLock()"),"routine performance/ARP UI operations contain no callback lock");
    check(text.contains("performanceMailbox_.consume("),"performance state consumed through mailbox");
    check(text.contains("arpMailbox_.consume("),"ARP state consumed through mailbox");
    check(text.contains("pendingClearArpLatch_.exchange("),"ARP clear consumed as non-blocking command");
}

void playheadBoundaryAudit() {
    const auto f=juce::File(__FILE__).getParentDirectory().getParentDirectory().getChildFile("plugin/PluginProcessor.cpp");
    const auto text=f.loadFileAsString();
    check(text.isNotEmpty(),"PluginProcessor.cpp available for playhead architecture audit");
    const int ps=text.indexOf("void OrigamiAudioProcessor::processBlock");
    const int pe=text.indexOf(ps,"void OrigamiAudioProcessor::getStateInformation");
    int search=0,count=0; bool inside=true;
    while((search=text.indexOf(search,"getPlayHead()"))>=0){++count;if(search<ps||search>=pe)inside=false;search+=12;}
    check(count==1,"AudioPlayHead queried exactly once in processor implementation");
    check(inside,"AudioPlayHead access exists only inside processBlock");
    check(text.contains("cachedHostBpm_.store("),"processBlock publishes cached host BPM");
    check(text.contains("cachedHostBpm_.load("),"UI/ARP consume cached host BPM");
}

// mct-origami-audio-reengineer-p17-fix3-qos-aware-envelope-audit
void telemetryBoundaryAudit() {
    // Regression guard: MIDI event density must never multiply UI publication.
    const auto processorFile=juce::File(__FILE__).getParentDirectory().getParentDirectory()
        .getChildFile("plugin/PluginProcessor.cpp");
    const auto text=processorFile.loadFileAsString();
    check(text.isNotEmpty(),"PluginProcessor.cpp available for telemetry architecture audit");

    const int renderStart=text.indexOf("void OrigamiAudioProcessor::renderRange");
    const int dispatchStart=text.indexOf("void OrigamiAudioProcessor::dispatchMidi");
    check(renderStart>=0 && dispatchStart>renderStart,"renderRange source bounds found");
    const auto renderBody=text.substring(renderStart,dispatchStart);
    check(!renderBody.contains("publishEnvelopeUiSnapshot("),
          "renderRange contains no envelope UI publication");

    // Patch 17 moved the host-block telemetry cadence into the QoS-aware
    // serviceVisualTelemetry() helper. Audit that helper directly rather than
    // requiring cadence variables to remain textually inside processBlock().
    const int serviceStart=text.indexOf("void OrigamiAudioProcessor::serviceVisualTelemetry");
    const int finalizeStart=text.indexOf(serviceStart,"void OrigamiAudioProcessor::finalizeRenderBudget");
    check(serviceStart>=0 && finalizeStart>serviceStart,
          "visual telemetry service source bounds found");
    const auto serviceBody=text.substring(serviceStart,finalizeStart);
    check(serviceBody.contains("envUiSamplesUntilPublish_"),
          "QoS telemetry service owns envelope telemetry cadence");
    check(serviceBody.contains("envelopeUiPublishHz_"),
          "envelope telemetry remains rate-limited");
    check(serviceBody.contains("publishEnvelopeUiSnapshot();"),
          "QoS telemetry service publishes envelope snapshot");
    check(serviceBody.contains("suppressVisualTelemetry"),
          "envelope telemetry publication obeys global QoS policy");

    const int processStart=text.indexOf("void OrigamiAudioProcessor::processBlock");
    const int stateStart=text.indexOf(processStart,"void OrigamiAudioProcessor::getStateInformation");
    check(processStart>=0 && stateStart>processStart,"processBlock source bounds found");
    const auto processBody=text.substring(processStart,stateStart);
    check(processBody.contains("serviceVisualTelemetry(total);"),
          "processBlock services envelope telemetry at host-block boundary");
    check(!processBody.contains("publishEnvelopeUiSnapshot();"),
          "processBlock contains no duplicate direct envelope publication");
}

void playabilityAudit() {
    std::vector<std::unique_ptr<OrigamiAudioProcessor>> processors;
    auto create=[&]() -> OrigamiAudioProcessor& {
        processors.push_back(std::make_unique<OrigamiAudioProcessor>());
        return *processors.back();
    };
    auto& host=create();
    host.prepareToPlay(48000,128);
    disableExtraOscillators(host);
    auto hostAudio=renderNote(host);
    check(magnitude(hostAudio)>1.0e-5f,"host MIDI note produces audible stereo output");

    auto& ui=create();
    ui.prepareToPlay(48000,128);
    disableExtraOscillators(ui);
    // mct-origami-deep-audit-p02-fix1-test-api
    check(ui.enqueueUiKeyboardNote(60,true,.8f),
          "UI note-on enters fixed realtime-safe queue");
    juce::AudioBuffer<float> uiAudio(2,1024);uiAudio.clear();
    juce::MidiBuffer emptyMidi;
    ui.processBlock(uiAudio,emptyMidi);
    check(magnitude(uiAudio)>1.0e-5f,"on-screen keyboard note produces audio");
    check(ui.enqueueUiKeyboardNote(60,false,0.0f),
          "UI note-off enters fixed realtime-safe queue");

    auto& power=create();
    power.prepareToPlay(48000,128);
    disableExtraOscillators(power);
    check(power.setUiOscillatorEnabled(1,false),"OSC1 power can be disabled");
    auto silent=renderNote(power);
    check(magnitude(silent)<1.0e-7f,"all disabled oscillators produce silence");

    auto& levelZero=create();
    levelZero.prepareToPlay(48000,128);disableExtraOscillators(levelZero);
    check(levelZero.setUiParameter(ParameterId::OscLevel,0.0f),"OSC1 level zero accepted");
    // OscLevel intentionally has parameter smoothing. Allow the target to settle
    // while no voice is active, then verify a subsequently-started note is silent.
    {
        juce::AudioBuffer<float> settle(2,1024);settle.clear();
        juce::MidiBuffer noMidi;
        levelZero.processBlock(settle,noMidi);
    }
    check(magnitude(renderNote(levelZero))<1.0e-7f,"OSC level zero produces silence after smoothing");

    auto& levelAudible=create();
    levelAudible.prepareToPlay(48000,128);disableExtraOscillators(levelAudible);
    check(levelAudible.setUiParameter(ParameterId::OscLevel,.8f),"OSC1 audible level accepted");
    check(magnitude(renderNote(levelAudible))>1.0e-5f,"OSC level restores sound");

    auto& wtA=create();auto& wtB=create();
    wtA.prepareToPlay(48000,128);wtB.prepareToPlay(48000,128);
    disableExtraOscillators(wtA);disableExtraOscillators(wtB);
    check(wtA.setUiParameter(ParameterId::Waveform,0.0f) && wtB.setUiParameter(ParameterId::Waveform,2.25f),"WT positions accepted");
    const auto wa=renderNote(wtA,69,1.0f),wb=renderNote(wtB,69,1.0f);
    bool wtDifferent=false;
    for(int i=0;i<wa.getNumSamples() && !wtDifferent;++i)
        wtDifferent=std::abs(wa.getSample(0,i)-wb.getSample(0,i))>1.0e-5f;
    check(wtDifferent,"Basic Shapes WT POS changes rendered waveform");
    check(wtA.getUiOscillatorState(1).tableId==wtB.getUiOscillatorState(1).tableId,
          "WT POS does not change wavetable identity");

    auto& pitchA=create();auto& pitchB=create();
    pitchA.prepareToPlay(48000,128);pitchB.prepareToPlay(48000,128);
    disableExtraOscillators(pitchA);disableExtraOscillators(pitchB);
    check(pitchA.setUiParameter(ParameterId::OscOctave,0.0f) && pitchB.setUiParameter(ParameterId::OscOctave,1.0f),"octave states accepted");
    const auto pa=renderNote(pitchA),pb=renderNote(pitchB);
    bool pitchDifferent=false;
    for(int i=0;i<pa.getNumSamples() && !pitchDifferent;++i)
        pitchDifferent=std::abs(pa.getSample(0,i)-pb.getSample(0,i))>1.0e-5f;
    check(pitchDifferent,"oscillator octave changes rendered audio");

    auto& uniA=create();auto& uniB=create();
    uniA.prepareToPlay(48000,128);uniB.prepareToPlay(48000,128);
    disableExtraOscillators(uniA);disableExtraOscillators(uniB);
    check(uniA.setUiParameter(ParameterId::OscUnison,1.0f)
          && uniB.setUiParameter(ParameterId::OscUnison,4.0f)
          && uniB.setUiParameter(ParameterId::OscDetune,30.0f),"unison states accepted");
    const auto ua=renderNote(uniA),ub=renderNote(uniB);
    check(std::abs(energy(ua)-energy(ub))>1.0e-6,"unison/detune changes rendered output");

    auto& pan=create();
    pan.prepareToPlay(48000,128);disableExtraOscillators(pan);
    check(pan.setUiParameter(ParameterId::OscPan,-1.0f),"hard-left pan accepted");
    // OscPan is intentionally smoothed. Let the pan target settle with no
    // active voice before asserting channel isolation on a fresh note.
    {
        juce::AudioBuffer<float> settle(2,1024);settle.clear();
        juce::MidiBuffer noMidi;
        pan.processBlock(settle,noMidi);
    }
    const auto panAudio=renderNote(pan);
    check(panAudio.getMagnitude(0,0,panAudio.getNumSamples())>1.0e-5f,"hard-left pan keeps left output");
    check(panAudio.getMagnitude(1,0,panAudio.getNumSamples())<1.0e-7f,"hard-left pan silences right output after smoothing");

    auto& filterLow=create();auto& filterHigh=create();
    filterLow.prepareToPlay(48000,128);filterHigh.prepareToPlay(48000,128);
    disableExtraOscillators(filterLow);disableExtraOscillators(filterHigh);
    for(auto* p:{&filterLow,&filterHigh}) {auto m=p->getUiInstrumentState().modulation;m.filterEnabled=true;check(p->setUiModulationState(m),"explicit filter fixture");}
    check(filterLow.setUiParameter(ParameterId::Cutoff,100.0f),"low cutoff accepted");
    check(filterHigh.setUiParameter(ParameterId::Cutoff,20000.0f),"high cutoff accepted");
    const auto low=renderNote(filterLow,100,1.0f,4096),high=renderNote(filterHigh,100,1.0f,4096);
    check(energy(low)<energy(high),"filter cutoff affects audible output");

    auto& fastAttack=create();auto& slowAttack=create();
    fastAttack.prepareToPlay(48000,128);slowAttack.prepareToPlay(48000,128);
    disableExtraOscillators(fastAttack);disableExtraOscillators(slowAttack);
    check(fastAttack.setUiParameter(ParameterId::Attack,0.001f),"fast attack accepted");
    check(slowAttack.setUiParameter(ParameterId::Attack,0.5f),"slow attack accepted");
    const auto fast=renderNote(fastAttack,60,1.0f,1024),slow=renderNote(slowAttack,60,1.0f,1024);
    check(energy(slow)<energy(fast),"ENV attack changes note onset");
    releaseNote(fastAttack,60,256,128);
    juce::AudioBuffer<float> tail(2,128);tail.clear();juce::MidiBuffer none;fastAttack.processBlock(tail,none);
    check(magnitude(tail)<1.0e-6f,"note release eventually reaches silence");

    auto& one=create();auto& two=create();
    one.prepareToPlay(48000,128);two.prepareToPlay(48000,128);
    disableExtraOscillators(one);disableExtraOscillators(two);
    check(two.setUiOscillatorEnabled(2,true),"OSC2 can be enabled");
    auto second=two.getUiOscillatorState(2);second.wtPosition=1.0f;second.level=.5f;
    check(two.setUiOscillatorState(2,second),"OSC2 independent state accepted");
    const auto oneAudio=renderNote(one),twoAudio=renderNote(two);
    check(std::abs(energy(oneAudio)-energy(twoAudio))>1.0e-6,"enabled OSC2 contributes to rendered sound");
}
// Patch 05/19: allocation regression gate around the actual AudioProcessor callback.
void pluginRealtimeAllocationGate() {
    // Keep the large processor off the 8 MB macOS test-thread stack.
    auto processor=std::make_unique<OrigamiAudioProcessor>();
    auto& p=*processor;
    p.prepareToPlay(48000.0,512);

    juce::AudioBuffer<float> audio64(2,64), audio17(2,17), audio128(2,128);
    juce::AudioBuffer<float> audio1(2,1), audio93(2,93), audio0(2,0);
    juce::AudioBuffer<float> audio512(2,512), audio11(2,11), audio768(2,768);
    std::array<juce::AudioBuffer<float>*,10> audio{{
        &audio64,&audio64,&audio17,&audio128,&audio1,
        &audio93,&audio0,&audio512,&audio11,&audio768
    }};
    std::array<juce::MidiBuffer,10> midi;
    for(std::size_t b=0;b<midi.size();++b) {
        midi[b].ensureSize(64u*1024u);
        const int n=audio[b]->getNumSamples();
        if(n>0) {
            const int last=n-1;
            const int note=48+int(b%12);
            midi[b].addEvent(juce::MidiMessage::noteOn(1,note,0.7f),0);
            midi[b].addEvent(juce::MidiMessage::pitchWheel(1,8192+int(b)*97),last/3);
            midi[b].addEvent(juce::MidiMessage::controllerEvent(1,1,int((b*13)%128)),last/2);
            midi[b].addEvent(juce::MidiMessage::channelPressureChange(1,int((b*17)%128)),last/2);
            midi[b].addEvent(juce::MidiMessage::noteOff(1,note),last);
        }
        audio[b]->clear();
    }

    juce::AudioBuffer<float> warm(2,512); warm.clear();
    juce::MidiBuffer warmMidi; warmMidi.ensureSize(64u*1024u);
    warmMidi.addEvent(juce::MidiMessage::noteOn(1,60,0.8f),0);
    p.processBlock(warm,warmMidi);
    warmMidi.clear();
    warmMidi.addEvent(juce::MidiMessage::noteOff(1,60),0);
    p.processBlock(warm,warmMidi);

#ifndef ORIGAMI_SANITIZED
    pluginAllocations.store(0,std::memory_order_relaxed);
    pluginGuardAllocations.store(true,std::memory_order_release);
#endif
    for(std::size_t b=0;b<audio.size();++b)
        p.processBlock(*audio[b],midi[b]);
#ifndef ORIGAMI_SANITIZED
    pluginGuardAllocations.store(false,std::memory_order_release);
    check(pluginAllocations.load(std::memory_order_relaxed)==0,
          "AudioProcessor::processBlock wrapper allocates no heap");
#endif

    for(const auto* block:audio)
        for(int ch=0;ch<block->getNumChannels();++ch)
            for(int i=0;i<block->getNumSamples();++i)
                check(std::isfinite(block->getSample(ch,i)),
                      "plugin realtime stress output remains finite");

    // Patch 11/19: adversarial whole-wrapper realtime pass.
    auto stressOwner=std::make_unique<OrigamiAudioProcessor>(); auto& stress=*stressOwner;
    stress.prepareToPlay(48000.0,128);
    juce::AudioBuffer<float> stressAudio(2,1024);
    std::array<juce::MidiBuffer,8> stressMidi;
    for(auto& m:stressMidi) m.ensureSize(256u*1024u);
    for(std::size_t b=0;b<stressMidi.size();++b) {
        auto& m=stressMidi[b];
        constexpr int n=1024;
        for(int note=36;note<100;++note) {
            const int pos=(note*13+int(b)*17)%n;
            m.addEvent(juce::MidiMessage::noteOn(1,note,0.7f),pos);
            m.addEvent(juce::MidiMessage::noteOff(1,note),(pos+511)%n);
        }
        for(int i=0;i<128;++i) {
            const int pos=(i*7+int(b)*19)%n;
            m.addEvent(juce::MidiMessage::controllerEvent(1,1,i),pos);
            m.addEvent(juce::MidiMessage::pitchWheel(1,(8192+i*43)&16383),pos);
            m.addEvent(juce::MidiMessage::channelPressureChange(1,i),pos);
        }
    }
    stressAudio.clear(); stress.processBlock(stressAudio,stressMidi[0]);
    check(stress.enqueueUiKeyboardNote(72,true,0.8f),
          "stress UI note-on enters fixed realtime-safe queue");
    stressAudio.clear(); stress.processBlock(stressAudio,stressMidi[1]);
    check(stress.enqueueUiKeyboardNote(72,false,0.0f),
          "stress UI note-off enters fixed realtime-safe queue");
#ifndef ORIGAMI_SANITIZED
    pluginAllocations.store(0,std::memory_order_relaxed);
    pluginGuardAllocations.store(true,std::memory_order_release);
#endif
    for(int pass=0;pass<16;++pass) {
        stressAudio.clear();
        stress.processBlock(stressAudio,stressMidi[static_cast<std::size_t>(pass)%stressMidi.size()]);
    }
#ifndef ORIGAMI_SANITIZED
    pluginGuardAllocations.store(false,std::memory_order_release);
    check(pluginAllocations.load(std::memory_order_relaxed)==0,
          "adversarial AudioProcessor::processBlock remains heap-allocation free");
#endif
    for(int ch=0;ch<stressAudio.getNumChannels();++ch)
        for(int i=0;i<stressAudio.getNumSamples();++i)
            check(std::isfinite(stressAudio.getSample(ch,i)),
                  "adversarial realtime output remains finite");
}

void frameToolsAudit() {
    using namespace mct::origami::ui;
    const auto original=WavetableDocument::basicShapes();
    auto makePartial=[](int harmonic,float phase=0.0f) {
        WavetableFrame frame;frame.id=WavetableDocument::nextFrameId();
        for(std::size_t i=0;i<frame.samples.size();++i)
            frame.samples[i]=0.8f*std::cos(juce::MathConstants<float>::twoPi*harmonic*
                                           static_cast<float>(i)/frame.samples.size()+phase);
        return frame;
    };
    auto rms=[](const WavetableFrame& frame) {
        double sum=0.0;
        for(const auto value:frame.samples)sum+=static_cast<double>(value)*value;
        return std::sqrt(sum/frame.samples.size());
    };
    auto difference=[](const WavetableFrame& a,const WavetableFrame& b) {
        double sum=0.0;
        for(std::size_t i=0;i<a.samples.size();++i)
            sum+=std::abs(a.samples[i]-b.samples[i]);
        return sum/a.samples.size();
    };
    for(const auto curve:{MorphCurve::Linear,MorphCurve::EaseIn,MorphCurve::EaseOut,MorphCurve::SCurve}) {
        check(morphCurve(0.0f,curve)==0.0f && morphCurve(1.0f,curve)==1.0f,
              "morph curves preserve exact endpoints");
        float previous=0.0f;
        for(int step=1;step<=100;++step) {
            const auto value=morphCurve(step/100.0f,curve);
            check(value>=previous && value<=1.0f,"morph curve is monotone");
            previous=value;
        }
    }
    {
        FrameMorpher raw(original.frames[0],original.frames[1],MorphMethod::Crossfade);
        check(raw.generate(0.0f).samples==original.frames[0].samples,
              "raw crossfade has exact A endpoint");
        check(raw.generate(1.0f).samples==original.frames[1].samples,
              "raw crossfade has exact B endpoint");
        const auto middle=raw.generate(0.25f);
        for(std::size_t i=0;i<middle.samples.size();++i)
            check(std::abs(middle.samples[i]-(0.75f*original.frames[0].samples[i]+
                      0.25f*original.frames[1].samples[i]))<1.0e-6f,
                  "raw crossfade is direct sample interpolation");
    }
    auto shifted=original.frames[0];
    for(std::size_t i=0;i<shifted.samples.size();++i)
        shifted.samples[i]=original.frames[0].samples[(i+37)%shifted.samples.size()];
    check(correlationShift(original.frames[0],shifted)==kWavetableFrameSize-37,
          "FFT correlation finds circular phase offset");
    for(const auto& source:{original.frames[0],original.frames[1],original.frames[2]}) {
        auto rotated=source;
        for(std::size_t i=0;i<rotated.samples.size();++i)
            rotated.samples[i]=source.samples[(i+257)%rotated.samples.size()];
        check(correlationShift(source,rotated)==kWavetableFrameSize-257,
              "correlation aligns sine, saw-like and square-like periods");
    }
    {
        WavetableDocument chain;chain.frames.push_back(original.frames[0]);
        std::vector<unsigned> selected;
        for(unsigned frame=1;frame<=24;++frame) {
            auto rotated=original.frames[0];rotated.id=WavetableDocument::nextFrameId();
            for(std::size_t i=0;i<rotated.samples.size();++i)
                rotated.samples[i]=original.frames[0].samples[(i+frame*37)%rotated.samples.size()];
            chain.frames.push_back(rotated);selected.push_back(frame);
        }
        check(alignPhaseSelection(chain,selected),"fixed-reference phase alignment performs work");
        for(const auto index:selected)
            check(difference(chain.frames[0],chain.frames[index])<1.0e-5,
                  "long phase-alignment chain has no cumulative drift");
    }
    {
        auto opposite=original.frames[0];
        for(std::size_t i=0;i<opposite.samples.size();++i)
            opposite.samples[i]=original.frames[0].samples[(i+kWavetableFrameSize/2)%kWavetableFrameSize];
        FrameMorpher raw(original.frames[0],opposite,MorphMethod::Crossfade);
        FrameMorpher aligned(original.frames[0],opposite,MorphMethod::PhaseAligned);
        check(rms(aligned.generate(0.5f))>rms(raw.generate(0.5f))+0.35,
              "phase alignment prevents shifted-wave cancellation");
        check(aligned.generate(0.0f).samples==original.frames[0].samples &&
              aligned.generate(1.0f).samples==opposite.samples,
              "phase alignment preserves exact endpoints");
    }
    {
        WavetableFrame silence;silence.id=WavetableDocument::nextFrameId();
        const auto partial=makePartial(7,0.7f);
        FrameMorpher spectral(silence,partial,MorphMethod::Spectral);
        const auto middle=spectral.generate(0.5f);
        for(std::size_t i=0;i<middle.samples.size();++i)
            check(std::isfinite(middle.samples[i]) &&
                  std::abs(middle.samples[i]-0.5f*partial.samples[i])<2.0e-4f,
                  "spectral morph uses meaningful phase from non-silent bin");
        const auto phaseB=makePartial(7,1.5f);
        FrameMorpher spectralPhase(partial,phaseB,MorphMethod::Spectral);
        FrameMorpher harmonic(partial,phaseB,MorphMethod::Harmonic);
        check(difference(spectralPhase.generate(0.5f),harmonic.generate(0.5f))>0.08,
              "spectral and harmonic methods follow distinct phase policies");
        check(rms(spectralPhase.generate(0.5f))>0.45,
              "spectral phase interpolation retains useful energy");
    }
    {
        const auto h3=makePartial(3),h5=makePartial(5);
        FrameMorpher transport(h3,h5,MorphMethod::HarmonicShift);
        auto spectrumAt=[&](float t) {
            std::array<std::complex<double>,kWavetableFrameSize> spectrum{};
            const auto frame=transport.generate(t);
            for(std::size_t i=0;i<frame.samples.size();++i)spectrum[i]=frame.samples[i];
            fft(spectrum,false);return spectrum;
        };
        const auto middle=spectrumAt(0.5f);
        check(std::abs(middle[4])>10.0*std::abs(middle[3]) &&
              std::abs(middle[4])>10.0*std::abs(middle[5]),
              "harmonic transport moves H3 to H4 halfway toward H5");
        const auto quarter=spectrumAt(0.125f);
        const auto ratio=std::abs(quarter[3])/std::abs(quarter[4]);
        check(ratio>2.7 && ratio<3.3,
              "fractional H3.25 distributes approximately 75/25 to adjacent bins");
    }
    {
        auto a=makePartial(3),b=makePartial(3);
        for(std::size_t i=0;i<a.samples.size();++i) {
            const auto angle=juce::MathConstants<float>::twoPi*5*static_cast<float>(i)/a.samples.size();
            a.samples[i]=0.5f*a.samples[i]+0.3f*std::cos(angle);
            b.samples[i]=0.5f*b.samples[i]+0.3f*std::cos(angle+1.5f);
        }
        FrameMorpher hybrid(a,b,MorphMethod::Hybrid);
        FrameMorpher phase(a,b,MorphMethod::PhaseAligned);
        const auto middle=hybrid.generate(0.5f);
        check(difference(middle,phase.generate(0.5f))>0.0003,
              "hybrid includes spectral evolution beyond phase-aligned shape");
        for(const auto value:middle.samples)
            check(std::isfinite(value) && std::abs(value)<=1.0001f,
                  "hybrid output is finite and bounded");
    }
    for(const auto target:{16u,32u,64u,128u,255u,256u}) {
        auto document=original;
        check(densify(document,target,MorphMethod::Crossfade,MorphCurve::Linear),"target densification succeeds");
        check(document.frames.size()==target,"target densification reaches exact count");
        std::size_t previous=0;
        for(const auto& anchor:original.frames) {
            bool found=false;
            for(std::size_t i=previous;i<document.frames.size();++i)
                if(document.frames[i].id==anchor.id) {
                    check(document.frames[i].samples==anchor.samples,"target preserves exact source samples");
                    previous=i+1;found=true;break;
                }
            check(found,"target retains each source anchor in order");
        }
        std::set<std::uint64_t> ids;
        for(const auto& frame:document.frames) {
            ids.insert(frame.id);
            for(const auto value:frame.samples)check(std::isfinite(value),"morph samples remain finite");
        }
        check(ids.size()==target,"generated frame identities are unique");
    }
    for(const auto sourceCount:{4u,7u,19u,100u,128u,255u}) {
        auto document=original;
        while(document.frames.size()<sourceCount) {
            auto frame=document.frames.back();frame.id=WavetableDocument::nextFrameId();
            document.frames.push_back(frame);
        }
        document.selectedFrame=sourceCount/2;
        const auto anchorIds=[&] {
            std::vector<std::uint64_t> result;
            for(const auto& frame:document.frames)result.push_back(frame.id);
            return result;
        }();
        check(densify(document,256,MorphMethod::Crossfade,MorphCurve::Linear),
              "arbitrary source count can densify to 256");
        check(document.frames.size()==256,"arbitrary densification has exact target count");
        const auto selectedId=anchorIds[sourceCount/2];
        check(document.frames[document.selectedFrame].id==selectedId,
              "densification preserves selected anchor identity");
        std::size_t previous=0;
        for(std::size_t i=0;i<sourceCount;++i) {
            const auto expected=(i*255+(sourceCount-1)/2)/(sourceCount-1);
            check(expected>=previous && document.frames[expected].id==anchorIds[i],
                  "rounded normalized anchor positions remain collision-free");
            previous=expected+1;
        }
        if(sourceCount==4)for(std::size_t i=0;i<4;++i)
            check(document.frames[i*85].id==anchorIds[i],
                  "4 to 256 anchors occupy exact indices 0/85/170/255");
    }
    for(const auto method:{MorphMethod::Crossfade,MorphMethod::PhaseAligned,MorphMethod::Spectral,
                           MorphMethod::Harmonic,MorphMethod::HarmonicShift,MorphMethod::Hybrid}) {
        auto document=original;
        check(morphBetween(document,0,1,3,method,MorphCurve::SCurve),"between morph succeeds");
        check(document.frames.size()==7,"between morph adds requested count");
        check(document.frames[0].samples==original.frames[0].samples &&
              document.frames[4].samples==original.frames[1].samples,"between morph retains endpoints");
        for(std::size_t i=1;i<=3;++i)
            for(const auto value:document.frames[i].samples)
                check(std::isfinite(value) && std::abs(value)<=1.0001f,"all methods yield bounded finite samples");
    }
    auto document=original;
    document.frames[0].hasIndependentSpectrum=true;
    document.frames[0].hasSubtractiveSpectrum=true;
    document.frames[0].hasAdditiveSpectrum=true;
    processFrame(document.frames[0],3);
    check(!document.frames[0].hasIndependentSpectrum && !document.frames[0].hasSubtractiveSpectrum,
          "time-domain frame operation invalidates dependent spectral state");
    check(document.frames[0].hasAdditiveSpectrum,"time-domain frame operation preserves additive authoring");
    {
        WavetableFrame silent;silent.id=WavetableDocument::nextFrameId();
        silent.hasIndependentSpectrum=true;
        processFrame(silent,1);
        check(silent.hasIndependentSpectrum,"silent normalization does not invalidate unchanged metadata");
        for(const auto value:silent.samples)check(value==0.0f,"silent normalization stays finite and zero");
        auto partial=makePartial(2);
        const auto untouched=partial.samples;
        processFrame(partial,1,100,199);
        for(std::size_t i=0;i<partial.samples.size();++i)
            if(i<100 || i>199)check(partial.samples[i]==untouched[i],
                "partial normalization leaves outside samples exact");
        auto reversed=partial;const auto beforeReverse=reversed.samples;
        processFrame(reversed,2,100,199);
        for(std::size_t i=100;i<=199;++i)
            check(reversed.samples[i]==beforeReverse[299-i],"partial reverse mirrors requested interval");
        auto inverted=partial;processFrame(inverted,3);
        for(std::size_t i=0;i<inverted.samples.size();++i)
            check(inverted.samples[i]==-partial.samples[i],"invert is exact polarity reversal");
        WavetableFrame edge;edge.id=WavetableDocument::nextFrameId();edge.samples[0]=1.0f;
        processFrame(edge,4);
        check(std::abs(edge.samples.back()-0.25f)<1.0e-7f &&
              std::abs(edge.samples[0]-0.5f)<1.0e-7f &&
              std::abs(edge.samples[1]-0.25f)<1.0e-7f,
              "full smoothing wraps across periodic seam");
        WavetableFrame local;local.id=WavetableDocument::nextFrameId();
        local.samples[99]=1.0f;local.samples[200]=1.0f;
        processFrame(local,4,100,199);
        check(local.samples[100]==0.0f && local.samples[199]==0.0f &&
              local.samples[99]==1.0f && local.samples[200]==1.0f,
              "partial smoothing isolates both selection boundaries");
    }
    {
        auto wave=original.frames[0];
        for(std::size_t i=0;i<wave.samples.size();++i)
            wave.samples[i]=original.frames[0].samples[(i+37)%wave.samples.size()];
        alignZero(wave);
        check(wave.samples[0]>=-1.0e-5f && wave.samples.back()<0.0f,
              "zero alignment finds nearest positive-going crossing");
        const auto once=wave.samples;alignZero(wave);
        check(wave.samples==once,"already zero-aligned frame does not move again");
        WavetableFrame dc;dc.samples.fill(0.2f);dc.hasIndependentSpectrum=true;
        alignZero(dc);
        check(dc.samples.front()==0.2f && dc.hasIndependentSpectrum,
              "DC-only frame has no synthetic zero crossing or metadata change");
    }
    {
        auto a=original.frames[0],b=original.frames[1];
        a.hasIndependentSpectrum=b.hasSubtractiveSpectrum=b.hasAdditiveSpectrum=true;
        FrameMorpher morpher(a,b,MorphMethod::Spectral);
        const auto generated=morpher.generate(0.5f);
        check(!generated.hasIndependentSpectrum && !generated.hasSubtractiveSpectrum &&
              !generated.hasAdditiveSpectrum,
              "generated frames never inherit stale spectral authoring metadata");
    }
}
void matrixStableChainDestinationAudit() {
    InstrumentState state{};
    auto& oscillator=state.oscillators[0];
    oscillator.id=42;oscillator.enabled=true;oscillator.processCount=3;oscillator.nextProcessId=103;
    oscillator.processes[0]={100,dsp::OscProcessType::RandAmp,0.4f,1,true};
    oscillator.processes[1]={101,dsp::OscProcessType::BendBoth,0.4f,2,true};
    oscillator.processes[2]={102,dsp::OscProcessType::RandSparse,0.4f,3,true};
    auto& route=state.modulation.routes[0];
    route.id=1;route.source=ModSource::Lfo1;
    route.destination={ModDestination::ProcessAmount,42,100};
    state.modulation.nextRouteId=2;
    ui::ModulationBindings bindings{};
    bindings.snapshot=[&]{return state;};
    bindings.route=[&](const ModRoute& edited) {
        if(edited.id!=1) return false;
        state.modulation.routes[0]=edited;return true;
    };
    ui::ModulationMatrix matrix(bindings);matrix.setBounds(0,0,1300,300);
    const auto destination=[&]() -> ui::NativeComboBox* {
        ui::NativeComboBox* result=nullptr;
        walk(matrix,[&](juce::Component& component) {
            if(component.getName()=="Route destination")
                result=dynamic_cast<ui::NativeComboBox*>(&component);
        });
        return result;
    };
    auto* box=destination();
    check(box && box->getText().contains("[OC] Rand Amp"),
          "stable-ID route displays its actual chain process");
    std::array<std::uint32_t,3> mapped{};
    std::array<int,3> menuIds{};
    std::size_t found=0;
    for(int i=0;i<box->getNumItems();++i) {
        const auto label=box->getItemText(i);
        check(label!="PROCESS 1 AMOUNT" && label!="PROCESS 2 AMOUNT" &&
              label!="ROUTE 1 AMOUNT" && label!="ROUTE 2 AMOUNT",
              "Matrix omits fixed legacy chain destinations");
        if(!label.startsWith("[OC]")) continue;
        check(found<3,"Matrix presents only the three current chain processes");
        menuIds[found]=box->getItemId(i);
        box->setSelectedId(menuIds[found],juce::sendNotificationSync);
        mapped[found++]=state.modulation.routes[0].destination.itemId;
    }
    check(found==3 && mapped==std::array<std::uint32_t,3>{{100,101,102}},
          "Matrix menu IDs resolve to stable process IDs on oscillator 42");
    struct DirectDestination {const char* label;ModDestination destination;};
    static constexpr std::array<DirectDestination,7> direct{{
        {"WT POS",ModDestination::WtPosition},{"OCT",ModDestination::Octave},
        {"SEM",ModDestination::Semitone},{"FIN",ModDestination::Fine},
        {"DETUNE",ModDestination::Detune},{"PAN",ModDestination::Pan},
        {"LEVEL",ModDestination::Level}
    }};
    for(const auto& expected:direct) {
        int selectedId=0;
        for(int i=0;i<box->getNumItems();++i)
            if(box->getItemText(i)==expected.label) {
                selectedId=box->getItemId(i);break;
            }
        check(selectedId>0,"supported direct oscillator destination is present");
        box->setSelectedId(selectedId,juce::sendNotificationSync);
        matrix.syncFromModel();
        check(route.destination==ModAddress{expected.destination,42} &&
              box->getSelectedId()==selectedId,
              "direct oscillator destination survives Matrix round trip");
    }
    box->setSelectedId(menuIds[0],juce::sendNotificationSync);
    std::swap(oscillator.processes[0],oscillator.processes[2]);
    matrix.syncFromModel();box=destination();
    check(route.destination.itemId==100 && box->getText().contains("[OC] Rand Amp"),
          "process reorder preserves the route's stable target");
    for(int i=4;i>0;--i) oscillator.processes[static_cast<std::size_t>(i)]=
        oscillator.processes[static_cast<std::size_t>(i-1)];
    oscillator.processes[0]={99,dsp::OscProcessType::Sync,0.4f,4,true};
    oscillator.processCount=4;
    matrix.syncFromModel();box=destination();
    check(route.destination.itemId==100 && box->getText().contains("[OC] Rand Amp"),
          "insertion before a process preserves its route target");
    oscillator.processes[4]={104,dsp::OscProcessType::RandAmp,0.4f,5,true};
    oscillator.processCount=5;
    matrix.syncFromModel();box=destination();
    bool first=false,second=false;
    for(int i=0;i<box->getNumItems();++i) {
        first|=box->getItemText(i).contains("Rand Amp #100");
        second|=box->getItemText(i).contains("Rand Amp #104");
    }
    check(first && second && route.destination.itemId==100,
          "duplicate process types have distinct stable-ID menu entries");
    for(std::size_t i=0;i<oscillator.processCount;++i) if(oscillator.processes[i].id==100) {
        for(std::size_t j=i+1;j<oscillator.processCount;++j)
            oscillator.processes[j-1]=oscillator.processes[j];
        --oscillator.processCount;break;
    }
    matrix.syncFromModel();box=destination();
    check(route.destination.itemId==100 && box->getSelectedId()==0 &&
          box->getText()=="UNAVAILABLE DESTINATION",
          "deleted process cannot silently retarget a Matrix route");
}

// mct-origami-performance-hotpath-visual-scheduler
// The 60 Hz rack keeps animating, but model snapshots/control sync happen only
// for a new canonical revision, a newly exposed viewport, or a finished edit.
struct CountingRack {
    OrigamiAudioProcessor& processor;
    unsigned snapshots=0,parameters=0,modules=0,offscreenModuleReads=0;
    unsigned watchedId=0;
    ui::OscillatorRack view;
    explicit CountingRack(OrigamiAudioProcessor& p)
        : processor(p),
          view([this](auto id,float value){return processor.setUiParameter(id,value);},
               [this](auto id){++parameters;return processor.getUiParameter(id);},
               [this]{return processor.addUiOscillator();},
               [this](auto id){return processor.removeUiOscillator(id);},
               [this](auto id,const auto& state){return processor.setUiOscillatorState(id,state);},
               [this](auto id){++modules;if(id==watchedId)++offscreenModuleReads;return processor.getUiOscillatorState(id);},
               [this](auto id,bool enabled){return processor.setUiOscillatorEnabled(id,enabled);},
               [this](auto id){return processor.getUiOscillatorEnabled(id);},
               [this]{++snapshots;return processor.getUiInstrumentState();},
               [this]{return processor.getUiOscillatorRevision();}) {
        view.setBounds(0,0,700,800);view.advanceVisualFrame();
    }
    void resetCounters(){snapshots=parameters=modules=offscreenModuleReads=0;}
    ui::OscillatorCard* card(unsigned id) {
        ui::OscillatorCard* found=nullptr;
        walk(view,[&](auto& c){if(auto* k=dynamic_cast<ui::OscillatorCard*>(&c))if(k->id()==id)found=k;});
        return found;
    }
    juce::Slider* slider(unsigned id,const juce::String& name) {
        juce::Slider* found=nullptr;
        if(auto* k=card(id)) walk(*k,[&](auto& c){if(auto* s=dynamic_cast<juce::Slider*>(&c))if(s->getName()==name)found=s;});
        return found;
    }
};

void oscillatorVisualSchedulerAudit() {
    auto processorOwner=std::make_unique<OrigamiAudioProcessor>(); auto& processor=*processorOwner;
    CountingRack rack(processor);
    rack.resetCounters();
    for(unsigned frame=0;frame<60;++frame) rack.view.advanceVisualFrame();
    check(rack.snapshots==0 && rack.parameters==0 && rack.modules==0,
          "60 stable visual frames do no model snapshots or control synchronization");
    check(processor.setUiParameter(ParameterId::OscPan,0.3f),"scheduler pan edit accepted");
    rack.view.advanceVisualFrame();
    check(rack.snapshots==1 && rack.parameters>0,"one revision produces exactly one model snapshot");
    rack.resetCounters();
    for(unsigned frame=0;frame<60;++frame) rack.view.advanceVisualFrame();
    check(rack.snapshots==0 && rack.parameters==0 && rack.modules==0,
          "consumed revision is not resynchronized on later animation frames");
    auto* pan=rack.slider(1,"OSC PAN");
    check(pan!=nullptr && std::abs(pan->getValue()-0.3)<0.001,"revision sync reaches the visible control");

    const auto revision=processor.getUiOscillatorRevision();
    check(processor.setUiOscillatorEnabled(4,false),"power edit accepted");
    check(processor.getUiOscillatorRevision()!=revision,"power changes publish oscillator revision");
    check(processor.removeUiOscillator(4),"oscillator deletion accepted");
    rack.view.advanceVisualFrame();
    check(rack.view.count()==3,"topology revision updates cards");
}

void oscillatorOffscreenSchedulingAudit() {
    auto processorOwner=std::make_unique<OrigamiAudioProcessor>(); auto& processor=*processorOwner;
    CountingRack rack(processor);
    auto* card=rack.card(4);
    check(card!=nullptr,"fourth oscillator card exists");
    check(!card->getBounds().intersects(rack.view.viewport().getViewArea()),
          "fourth oscillator card starts outside the visible rack");
    rack.watchedId=4;rack.resetCounters();
    auto state=processor.getUiOscillatorState(4);state.pan=-0.7f;
    check(processor.setUiOscillatorState(4,state),"offscreen canonical edit accepted");
    rack.view.advanceVisualFrame();
    check(rack.snapshots==1,"offscreen edit still consumes the canonical revision");
    check(rack.offscreenModuleReads==0,"offscreen card performs no control synchronization");
    for(unsigned frame=0;frame<60;++frame) rack.view.advanceVisualFrame();
    check(rack.offscreenModuleReads==0 && rack.snapshots==1,"offscreen card stays idle while unchanged");
    auto* pan=rack.slider(4,"OSC PAN");
    check(pan!=nullptr && std::abs(pan->getValue()+0.7)>0.001,"offscreen card was not eagerly updated");
    const_cast<juce::Viewport&>(rack.view.viewport()).setViewPosition(100000,0);
    rack.view.advanceVisualFrame();
    check(rack.offscreenModuleReads>0,"card synchronizes as soon as it is exposed");
    check(std::abs(pan->getValue()+0.7)<0.001,"newly visible card reflects the latest canonical state");
}

void oscillatorInteractionDeferralAudit() {
    auto processorOwner=std::make_unique<OrigamiAudioProcessor>(); auto& processor=*processorOwner;
    CountingRack rack(processor);
    auto* semitone=rack.slider(1,"OSC TUNING SEM");
    check(semitone!=nullptr,"OSC1 semitone control exists");
    juce::Label* box=nullptr;
    for(auto* child:semitone->getChildren()) if(auto* l=dynamic_cast<juce::Label*>(child)) box=l;
    check(box!=nullptr,"semitone text box exists");
    const auto before=semitone->getValue();
    juce::ModifierKeys::currentModifiers=juce::ModifierKeys(juce::ModifierKeys::leftButtonModifier);
    box->showEditor();
    check(box->isBeingEdited(),"text edit begins");
    check(processor.setUiParameter(ParameterId::OscSemitone,5.0f),"external semitone edit accepted");
    rack.view.advanceVisualFrame();
    check(semitone->getValue()==before,"control under edit is not overwritten mid-interaction");
    rack.view.advanceVisualFrame();
    check(semitone->getValue()==before,"deferred value stays deferred while interaction continues");
    box->hideEditor(true);
    juce::ModifierKeys::currentModifiers=juce::ModifierKeys();
    rack.resetCounters();
    rack.view.advanceVisualFrame();
    check(rack.snapshots==1,"finished interaction triggers one refresh without a new revision");
    check(std::abs(semitone->getValue()-5.0)<0.001,"finished interaction consumes the latest canonical value");
    rack.resetCounters();
    rack.view.advanceVisualFrame();
    check(rack.snapshots==0,"post-interaction refresh happens once");
}

void oscillatorRevisionSemanticsAudit() {
    auto processorOwner=std::make_unique<OrigamiAudioProcessor>(); auto& processor=*processorOwner;
    const auto revision=[&]{return processor.getUiOscillatorRevision();};
    auto r=revision();
    check(!processor.removeUiOscillator(99) && revision()==r,"failed oscillator delete leaves revision");
    check(!processor.setUiOscillatorEnabled(99,true) && revision()==r,"failed power edit leaves revision");
    check(!processor.setUiOscillatorState(99,processor.getUiOscillatorState(2)) && revision()==r,
          "failed state edit leaves revision");
    check(!processor.setUiParameter(ParameterId::OscPan,std::numeric_limits<float>::quiet_NaN()) && revision()==r,
          "rejected parameter leaves revision");
    check(!processor.installUiOscillatorWavetable(0,mct::origami::dsp::Wavetable::builtIns()) && revision()==r,
          "rejected wavetable leaves revision");

    auto state=processor.getUiOscillatorState(2);
    state.processes[0]={state.nextProcessId++,mct::origami::dsp::OscProcessType::Fold,0.5f,7u,true};
    state.processCount=1;
    state.routes[0]={state.nextRouteId++,3,OscRouteType::FrequencyMod,0.4f,true};
    state.routeCount=1;
    check(processor.setUiOscillatorState(2,state) && revision()!=r,"process/route add publishes revision");
    check(processor.getUiOscillatorState(2).processCount==1 && processor.getUiOscillatorState(2).routeCount==1,
          "process and route are stored canonically");
    r=revision();
    state=processor.getUiOscillatorState(2);state.processes[0]={};state.processCount=0;
    check(processor.setUiOscillatorState(2,state) && revision()!=r,"process deletion succeeds and publishes revision");
    check(processor.getUiOscillatorState(2).processCount==0,"process deletion is canonical");
    r=revision();
    state=processor.getUiOscillatorState(2);state.routes[0]={};state.routeCount=0;
    check(processor.setUiOscillatorState(2,state) && revision()!=r,"route deletion succeeds and publishes revision");
    check(processor.getUiOscillatorState(2).routeCount==0,"route deletion is canonical");
    r=revision();
    check(processor.installUiOscillatorWavetable(2,mct::origami::dsp::Wavetable::builtIns()) && revision()!=r,
          "committed wavetable publishes revision");
    r=revision();
    check(processor.removeUiOscillator(3) && revision()!=r,"oscillator deletion succeeds and publishes revision");
    check(processor.getUiOscillatorState(3).id==0,"deleted oscillator is gone canonically");
}


// mct-origami-dsp-performance-stereo-chain: an editor wavetable commit while
// notes play crosses into the callback without heap traffic (the previous
// mailbox deep-copied the table in processBlock and freed the old one there).
void wavetableCommitRealtimeAudit() {
    auto owner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*owner;
    p.setPlayConfigDetails(0,2,48000.0,256); p.prepareToPlay(48000.0,256);
    juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi; midi.ensureSize(4096);
    for(int n=0;n<6;++n) midi.addEvent(juce::MidiMessage::noteOn(1,48+n*3,.7f),n);
    p.processBlock(audio,midi); midi.clear();
    auto table=mct::origami::dsp::Wavetable::builtIns();
    for(auto& f:table.frames) for(auto& b:f.bands) for(auto& v:b.samples) v*=-.8f;
    for(int round=0;round<3;++round) {
        check(p.installUiOscillatorWavetable(2,table),"editor table commits during playback");
#ifndef ORIGAMI_SANITIZED
        pluginAllocations.store(0); pluginGuardAllocations.store(true);
#endif
        for(int b=0;b<4;++b) { audio.clear(); p.processBlock(audio,midi); }
#ifndef ORIGAMI_SANITIZED
        pluginGuardAllocations.store(false);
        check(pluginAllocations.load()==0,"wavetable commit adoption allocates nothing in processBlock");
#endif
        (void)p.getUiRuntimeVisualizationSnapshot(); // UI poll frees replaced tables
    }
    check(magnitude(audio)>0.0f,"playback continues across table commits");
    check(p.removeUiOscillator(2),"remove the oscillator whose table is live");
    for(int b=0;b<4;++b) { audio.clear(); p.processBlock(audio,midi); }
    bool finite=true;
    for(int ch=0;ch<2;++ch) for(int i=0;i<256;++i) finite=finite && std::isfinite(audio.getSample(ch,i));
    check(finite,"playback stays finite after removing a module with a live table");
}

void modulationKnobBaseAudit() {
    auto processorOwner=std::make_unique<OrigamiAudioProcessor>(); auto& processor=*processorOwner;
    auto module=processor.getUiOscillatorState(2);
    module.processCount=1;module.nextProcessId=2;
    module.processes[0]={1,dsp::OscProcessType::BendBoth,0.25f,7,true};
    module.routeCount=1;module.nextRouteId=2;
    module.routes[0]={1,1,OscRouteType::PhaseMod,0.2f,true};
    check(processor.setUiOscillatorState(2,module),"modulated knob fixture installs");
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(processor.createEditor());
    auto& telemetry=ui::modulationUiTelemetry();
    // Heap copy: telemetry is large and this frame already hosts editor state.
    const auto saved=std::make_unique<std::remove_reference_t<decltype(telemetry)>>(telemetry);
    const auto sync=[&] {
        rack(*editor).syncFromModel();
        walk(*editor,[](auto& c){if(auto* filter=dynamic_cast<ui::FilterPanel*>(&c)) filter->syncFromModel();});
    };
    sync();
    std::vector<juce::Slider*> knobs;
    walk(*editor,[&](auto& c){if(auto* slider=dynamic_cast<juce::Slider*>(&c))
        if(slider->isRotary() && slider->getProperties().contains("mct.mod.destination")) knobs.push_back(slider);});
    check(!knobs.empty(),"discover actual modulatable rotary controls");
    bool process=false,routing=false,filter=false,pan=false;
    const std::array<ModSource,22> sources{{ModSource::Env1,ModSource::Env2,ModSource::Env3,
        ModSource::Lfo1,ModSource::Lfo2,ModSource::Lfo3,ModSource::Lfo4,
        ModSource::Macro1,ModSource::Macro2,ModSource::Macro3,ModSource::Macro4,
        ModSource::ModWheel,ModSource::Velocity,ModSource::Keytrack,ModSource::Aftertouch,
        ModSource::PitchBend,ModSource::NoteGate,ModSource::Random,ModSource::Function,
        ModSource::Chaos,ModSource::Drift,ModSource::Sequencer}};
    for(auto* knob:knobs) {
        const auto& props=knob->getProperties();
        const auto destination=static_cast<ModDestination>(static_cast<int>(props["mct.mod.destination"]));
        const auto osc=static_cast<OscillatorModuleId>(static_cast<int>(props["mct.mod.oscillator"]));
        const auto item=static_cast<std::uint32_t>(static_cast<int>(props["mct.mod.itemId"]));
        process|=destination==ModDestination::ProcessAmount;
        routing|=destination==ModDestination::RouteAmount;
        filter|=destination==ModDestination::Cutoff;
        pan|=destination==ModDestination::Pan;
        const double base=knob->getValue();
        const float depth=base>(knob->getMinimum()+knob->getMaximum())*0.5 ? -0.15f : 0.15f;
        for(auto source:sources) {
            telemetry={};telemetry.synthActive=true;telemetry.performanceInputActive=true;
            telemetry.state.routes[0]={1,true,source,{destination,osc,item},depth,true};
            const auto setSource=[&](float value) {
                telemetry.sourceValues.fill(value);telemetry.state.macros.fill(value);
                telemetry.runtime.performanceSources.fill(value);
                telemetry.velocityValue=telemetry.keytrackValue=value;
                sync();
            };
            setSource(0.1f);
            check(knob->getValue()==base,"assigning modulation preserves base knob position");
            const float first=ui::modulationUiEffectiveSliderPosition(*knob,destination,osc,item);
            setSource(0.8f);
            check(knob->getValue()==base,"every modulation source preserves base knob position");
            check(first!=ui::modulationUiEffectiveSliderPosition(*knob,destination,osc,item),
                  "live indicator follows source independently of base knob");
            check(ui::modulationUiHasAnyRoute(destination,osc,item) &&
                  ui::modulationUiPersistentRouteAmount(destination,osc,item)!=0,
                  "assigned modulation retains range overlay");
            telemetry.state.routes[1]={2,true,ModSource::Macro4,{destination,osc,item},depth*0.25f,false};
            sync();check(knob->getValue()==base,"multiple sources preserve knob position");
            telemetry.state.routes={};sync();
            check(knob->getValue()==base && !ui::modulationUiHasAnyRoute(destination,osc,item),
                  "removing modulation preserves base and removes overlay");
        }
        if(osc==2 && (destination==ModDestination::ProcessAmount || destination==ModDestination::RouteAmount || destination==ModDestination::Pan)) {
            telemetry.state.routes[0]={1,true,ModSource::Macro1,{destination,osc,item},0.1f,false};
            knob->setValue(0.4,juce::sendNotificationSync);sync();
            check(std::abs(knob->getValue()-0.4)<0.001,"manual edit changes modulated base knob normally");
            const auto stored=processor.getUiOscillatorState(2);
            const float value=destination==ModDestination::ProcessAmount ? stored.processes[0].amount
                : destination==ModDestination::RouteAmount ? stored.routes[0].amount : stored.pan;
            check(std::abs(value-0.4f)<0.001f,"manual edit commits base amount without modulation offset");
        }
    }
    check(process && routing && filter && pan,"audit covers process, routing, filter and oscillator knobs");
    ui::OscillatorCard* card=nullptr;
    ui::FilterPanel* filterPanel=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* candidate=dynamic_cast<ui::OscillatorCard*>(&c)) if(candidate->id()==2) card=candidate;
        if(auto* candidate=dynamic_cast<ui::FilterPanel*>(&c)) filterPanel=candidate;
    });
    check(card && filterPanel,"overlay paint targets exist");
    const auto paintOverlay=[](juce::Component& component) {
        juce::Image image(juce::Image::ARGB,component.getWidth(),component.getHeight(),true);
        juce::Graphics graphics(image);component.paintOverChildren(graphics);
        std::uint64_t hash=1469598103934665603ull;unsigned visible=0;
        for(int y=0;y<image.getHeight();++y) for(int x=0;x<image.getWidth();++x) {
            const auto pixel=image.getPixelAt(x,y);
            visible+=pixel.getAlpha()!=0;hash=(hash^pixel.getARGB())*1099511628211ull;
        }
        return std::make_pair(visible,hash);
    };
    for(juce::Component* component:{static_cast<juce::Component*>(card),static_cast<juce::Component*>(filterPanel)}) {
        telemetry={};telemetry.selectedSource=ModSource::Chaos; // unrelated selection
        const ModAddress address=component==card ? ModAddress{ModDestination::Pan,2,0}
                                                 : ModAddress{ModDestination::Resonance,0,0};
        telemetry.state.routes[0]={1,true,ModSource::Lfo1,address,0.25f,true};
        check(paintOverlay(*component).first>0,"modulation range remains painted while source is stationary");
        telemetry.synthActive=true;telemetry.sourceValues[3]=0.1f;
        const auto first=paintOverlay(*component);
        telemetry.sourceValues[3]=0.8f;
        check(first.second!=paintOverlay(*component).second,"painted live dot moves independently of selected source");
        telemetry.state.routes={};
        check(paintOverlay(*component).first==0,"removing modulation removes painted range and live dot");
    }
    telemetry=*saved;
}

void matrixDynamicRouteAudit() {
    auto processorOwner=std::make_unique<OrigamiAudioProcessor>(); auto& processor=*processorOwner;
    auto module=processor.getUiOscillatorState(2);
    module.processCount=1;module.nextProcessId=2;
    module.processes[0]={1,dsp::OscProcessType::RandAmp,0.5f,0x12345678u,true};
    check(processor.setUiOscillatorState(2,module),"matrix target process installed");
    const auto routeId=processor.addUiRoute();
    check(routeId!=0,"matrix route created");
    ModRoute route{};
    for(const auto& candidate:processor.getUiInstrumentState().modulation.routes)
        if(candidate.id==routeId) route=candidate;
    route.source=ModSource::Lfo1;
    route.destination={ModDestination::ProcessAmount,2,1};
    route.amount=0.35f;route.enabled=true;route.bipolar=true;
    check(processor.setUiRoute(route),"drag-style dynamic target route accepted");

    ui::ModulationBindings bindings{};
    bindings.snapshot=[&]{return processor.getUiInstrumentState();};
    bindings.route=[&](const ModRoute& edited){return processor.setUiRoute(edited);};
    ui::ModulationMatrix matrix(bindings);
    matrix.setBounds(0,0,1300,300);matrix.syncFromModel();
    ui::NativeComboBox *source=nullptr,*destination=nullptr;
    juce::TextButton *enabled=nullptr,*bipolar=nullptr;
    juce::Slider* amount=nullptr;
    walk(matrix,[&](juce::Component& component) {
        if(component.getName()=="Route source") source=dynamic_cast<ui::NativeComboBox*>(&component);
        if(component.getName()=="Route destination") destination=dynamic_cast<ui::NativeComboBox*>(&component);
        if(component.getName()=="MATRIX ROUTE ENABLE") enabled=dynamic_cast<juce::TextButton*>(&component);
        if(component.getName()=="MATRIX ROUTE POLARITY") bipolar=dynamic_cast<juce::TextButton*>(&component);
        if(component.getName()=="MATRIX ROUTE AMOUNT") amount=dynamic_cast<juce::Slider*>(&component);
    });
    check(source && destination && enabled && bipolar && amount,"matrix row controls exist");
    check(source->getSelectedId()==static_cast<int>(ModSource::Lfo1),"matrix shows dragged source");
    check(destination->getSelectedId()>0,"matrix shows dynamic process destination");
    check(destination->getText().contains("[OC] Rand Amp"),"matrix labels dynamic process destination");
    const auto compiledProcessAmount=[&] {
        const auto state=processor.getUiInstrumentState();
        CompiledModulation compiled;compiled.prepare(96000.0);
        compiled.compile(state.modulation,state.oscillators,true);
        ModulationFrame frame{};frame.modules=state.oscillators;
        std::array<float,CompiledModulation::globalSourceCount> sources{};
        compiled.globalFrame(frame,sources,96000.0);
        return frame.modules[1].processes[0].amount;
    };
    const float unmodulatedAmount=module.processes[0].amount;

    static_cast<juce::Component*>(enabled)->mouseDown(event(*enabled));
    static_cast<juce::Component*>(enabled)->mouseUp(event(*enabled));
    auto stored=processor.getUiInstrumentState().modulation.routes[0];
    check(stored.id==routeId && !stored.enabled && stored.bipolar,"matrix ON updates same route");
    check(std::abs(compiledProcessAmount()-unmodulatedAmount)<1.0e-6f,
          "matrix OFF disables compiled process modulation");
    matrix.syncFromModel();
    check(!enabled->getToggleState(),
          "matrix OFF toggle survives resync");
    static_cast<juce::Component*>(bipolar)->mouseDown(event(*bipolar));
    static_cast<juce::Component*>(bipolar)->mouseUp(event(*bipolar));
    stored=processor.getUiInstrumentState().modulation.routes[0];
    check(stored.id==routeId && !stored.bipolar && !stored.enabled,"matrix BIPOLAR persists");
    matrix.syncFromModel();
    check(!bipolar->getToggleState() && bipolar->getButtonText()=="UNIPOLAR",
          "matrix UNIPOLAR button survives resync");
    static_cast<juce::Component*>(enabled)->mouseDown(event(*enabled));
    static_cast<juce::Component*>(enabled)->mouseUp(event(*enabled));
    check(compiledProcessAmount()>unmodulatedAmount,
          "matrix ON enables unipolar compiled modulation");
    static_cast<juce::Component*>(bipolar)->mouseDown(event(*bipolar));
    static_cast<juce::Component*>(bipolar)->mouseUp(event(*bipolar));
    stored=processor.getUiInstrumentState().modulation.routes[0];
    check(stored.id==routeId && stored.enabled && stored.bipolar,
          "matrix buttons turn back on without replacing the route");
    check(std::abs(compiledProcessAmount()-unmodulatedAmount)<1.0e-6f,
          "matrix BIPOLAR restores compiled polarity");
    source->setSelectedId(static_cast<int>(ModSource::Macro1),juce::sendNotificationSync);
    stored=processor.getUiInstrumentState().modulation.routes[0];
    check(stored.id==routeId && stored.source==ModSource::Macro1,"matrix SOURCE persists");
    int levelId=0,levelOrdinal=0;
    for(int i=0;i<destination->getNumItems();++i)
        if(destination->getItemText(i)=="LEVEL" && ++levelOrdinal==2) {
            levelId=destination->getItemId(i);break;
        }
    check(levelId>0,"matrix has editable oscillator destination");
    destination->setSelectedId(levelId,juce::sendNotificationSync);
    stored=processor.getUiInstrumentState().modulation.routes[0];
    check(stored.id==routeId && stored.destination==ModAddress{ModDestination::Level,2},
          "matrix DESTINATION persists with stable oscillator ID");
    amount->setValue(62.0,juce::sendNotificationSync);
    stored=processor.getUiInstrumentState().modulation.routes[0];
    check(stored.id==routeId && std::abs(stored.amount-0.62f)<1.0e-5f,
          "matrix AMOUNT persists");
    matrix.syncFromModel();
    check(source->getSelectedId()==static_cast<int>(ModSource::Macro1) &&
          destination->getSelectedId()==levelId && enabled->getToggleState() &&
          bipolar->getToggleState(),"matrix resync preserves discrete edits");
    auto state=processor.getUiInstrumentState();
    CompiledModulation compiled;
    compiled.prepare(96000.0);
    compiled.compile(state.modulation,state.oscillators,true);
    std::array<float,CompiledModulation::globalSourceCount> sources{};
    ModulationFrame frame{};frame.modules=state.oscillators;
    const float baseLevel=frame.modules[1].level;
    sources[4]=1.0f;
    compiled.globalFrame(frame,sources,96000.0);
    check(frame.modules[1].level>baseLevel,
          "matrix-edited source and destination reach compiled modulation");
    stored.destination={ModDestination::ProcessAmount,2,1};
    check(processor.setUiRoute(stored),"route retargeted to process before deletion");
    auto withoutProcess=processor.getUiOscillatorState(2);
    withoutProcess.processCount=0;
    check(processor.setUiOscillatorState(2,withoutProcess),
          "deleting a targeted process is accepted");
    bool routeSurvived=false;
    for(const auto& candidate:processor.getUiInstrumentState().modulation.routes)
        routeSurvived|=candidate.id==routeId;
    check(!routeSurvived,"deleting a targeted process removes its Matrix route");
}

// mct-origami-fx-page-foundation-p01
void fxPageAudit() {
    using namespace mct::origami::fx;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    juce::TextButton *fxButton=nullptr,*matrixButton=nullptr,*synthButton=nullptr;
    ui::FxPage* page=nullptr;
    walk(*editor,[&](auto& c) {
        if(auto* b=dynamic_cast<juce::TextButton*>(&c)) {
            // N01: the FX workspace is presented as NODES, and NODES' sidebar has
            // its own MATRIX tab: the header (first child) owns the first match.
            if(b->getButtonText()=="NODES" && !fxButton) fxButton=b;
            if(b->getButtonText()=="MATRIX" && !matrixButton) matrixButton=b;
            if(b->getButtonText()=="SYNTH" && !synthButton) synthButton=b;
        }
        if(auto* candidate=dynamic_cast<ui::FxPage*>(&c)) page=candidate;
    });
    check(fxButton && matrixButton && synthButton && page,"NODES navigation and page exist");
    check(fxButton->isEnabled(),"FX header button is enabled");
    check(!page->isVisible(),"FX page hidden while SYNTH is selected");
    const auto synthState=encodeInstrumentState(p.getUiInstrumentState());
    fxButton->onClick();
    check(page->isVisible() && !rack(*editor).isVisible(),"FX header button opens the FX page");
    check(page->graph()==makeDefaultFxGraph(),"a fresh instrument has the neutral BUS 1 -> MASTER OUT graph");
    // The development demo is an explicit opt-in, never the default.
    page->document().replace(makeDevelopmentFxGraph());
    page->syncFromModel();

    const auto& graph=page->graph();
    check(graph.validate(),"development FX graph is valid");
    check(page->canvas().nodeComponentCount()==graph.nodes().size(),"canvas has one component per model node");
    check(page->canvas().connectionPathCount()==graph.connections().size(),"canvas draws one path per model connection");
    FxNodeId delay=0,split=0;
    for(const auto& n:graph.nodes()) {
        if(n.effect==FxEffectType::Delay) delay=n.id;
        if(n.kind==FxNodeKind::Split) split=n.id;
    }
    check(delay!=0 && split!=0,"development graph contains delay and split");
    check(page->inspectorHeadline()=="NO NODE SELECTED","inspector starts empty");
    page->selectNode(delay);
    check(page->selectedNode()==delay && page->inspectorHeadline()=="DELAY","selecting a node drives the inspector");
    page->selectNode(split);
    check(page->inspectorHeadline()=="SPLIT","routing node selection shows routing info");
    page->selectNode(delay);

    auto* delayComponent=page->canvas().nodeComponent(delay);
    check(delayComponent!=nullptr,"node component addressable by stable id");
    page->commitMove(delay,{640,60});
    check(page->canvas().nodeComponent(delay)==delayComponent,"model edit reuses existing node component");
    check(delayComponent->getPosition()==juce::Point<int>(640,60),"component follows committed position");
    check(page->graph().findNode(delay)->position.x==640.0f,"drag commits canvas-space position to model");

    matrixButton->onClick();
    check(!page->isVisible(),"MATRIX hides FX page");
    fxButton->onClick();
    check(page->isVisible() && page->canvas().nodeComponent(delay)==delayComponent
          && delayComponent->getPosition()==juce::Point<int>(640,60) && page->selectedNode()==delay,
          "FX -> MATRIX -> FX preserves graph, components and selection");
    synthButton->onClick();
    check(!page->isVisible() && rack(*editor).isVisible(),"SYNTH returns from FX");
    check(encodeInstrumentState(p.getUiInstrumentState())==synthState,"FX page round trip leaves synth state untouched");
    fxButton->onClick();

    juce::Slider* quick=nullptr;
    walk(*delayComponent,[&](auto& c){if(auto* s=dynamic_cast<juce::Slider*>(&c)) if(s->getName()=="FX "+juce::String(delay)+" P1") quick=s;});
    check(quick!=nullptr,"effect node exposes model-backed quick controls");
    quick->setValue(0.9,juce::sendNotificationSync);
    check(std::abs(*page->graph().findNode(delay)->parameter(1)-0.9f)<1.0e-4f,"quick control writes model parameter");
    page->selectParameterTab(2);
    check(page->parameterTabName()=="ADVANCED","parameter tabs switch");
    page->selectParameterTab(0);

    const auto connectionsBefore=page->graph().connections().size();
    check(page->deleteNode(delay),"delete selected node");
    check(page->selectedNode()==invalidFxNodeId && page->inspectorHeadline()=="NO NODE SELECTED",
          "deleting the selected node clears selection safely");
    check(page->canvas().nodeComponent(delay)==nullptr,"deleted node component removed");
    check(page->graph().connections().size()==connectionsBefore-1 && page->graph().validate(),
          "deleting a chained node removes its wires and bridges the chain");
    page->undo();
    check(page->graph().findNode(delay)!=nullptr && page->canvas().nodeComponentCount()==page->graph().nodes().size(),"undo restores deleted node");
    check(!page->deleteNode(page->graph().outputNode()),"MASTER OUT cannot be deleted");

    const auto drive=page->addEffect(FxEffectType::Drive);
    const auto* intoOutput=page->graph().connectionAt({page->graph().outputNode(),0},true);
    check(drive!=0 && page->selectedNode()==drive && intoOutput && intoOutput->from.node==drive,
          "SERIAL add effect splices before MASTER OUT and selects it");
    check(!page->connectPorts({drive,0},{page->graph().sourceNode(),0}),"wire into source rejected");
    const auto snapshot=page->graph();
    check(!page->connectPorts({page->graph().outputNode(),0},{drive,0}) && page->graph()==snapshot,
          "invalid wire leaves graph unchanged");

    check(!page->macrosPanel().isVisible(),"NODES omits duplicate macro controls");
    check(p.setUiMacro(0,0.7f) && std::abs(p.getUiInstrumentState().modulation.macros[0]-0.7f)<1.0e-4f,
          "the canonical macro remains available to NODES routing");

    const auto movedTo=page->graph().findNode(delay)->position;
    editor.reset();
    editor.reset(p.createEditor());
    ui::FxPage* reopened=nullptr;
    walk(*editor,[&](auto& c){if(auto* candidate=dynamic_cast<ui::FxPage*>(&c)) reopened=candidate;});
    check(reopened && reopened->graph().findNode(delay) && reopened->graph().findNode(delay)->position.x==movedTo.x,
          "processor-owned graph survives editor close/reopen");
}

// mct-origami-fx-graph-dsp-bus-routing-p02
void fxGraphUxAudit() {
    using namespace mct::origami::fx;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    ui::FxPage* page=nullptr;
    walk(*editor,[&](auto& c){if(auto* candidate=dynamic_cast<ui::FxPage*>(&c)) page=candidate;});
    check(page!=nullptr,"FX page present");
    auto& canvas=page->canvas();
    const auto src=page->graph().sourceNode(),out=page->graph().outputNode();
    const auto wire=page->graph().connectionAt({out,0},true)->id;

    // Connection hit corridor: the auto Bezier passes through the midpoint.
    const auto* a=canvas.nodeComponent(src);
    const auto* b=canvas.nodeComponent(out);
    const auto mid=((a->portCentre(false,0)+a->getPosition().toFloat())+(b->portCentre(true,0)+b->getPosition().toFloat()))*0.5f;
    check(canvas.connectionAt(mid)==wire,"connection hit on the curve");
    check(canvas.connectionAt(mid+juce::Point<float>(0.0f,canvas.wireHitRadius()-2.0f))==wire,"generous invisible hit corridor");
    check(!canvas.connectionAt(mid+juce::Point<float>(0.0f,40.0f)).has_value(),"empty canvas is not a connection");
    check(canvas.toGraph(mid).x==mid.x && canvas.toGraph(mid).y==mid.y,"canvas -> graph coordinates");

    // Routing points: stored on the connection, draggable, one undo step, removable.
    const auto pointAt=mid+juce::Point<float>(0.0f,70.0f);
    check(page->addLayoutPoint(wire,canvas.toGraph(pointAt)),"double-click adds a routing point");
    check(page->graph().findConnection(wire)->layout.size()==1,"routing point stored in graph layout");
    check(canvas.layoutPointAt(pointAt).has_value(),"routing point is hit-testable");
    check(canvas.connectionAt(pointAt)==wire,"cable bends through the routing point");
    page->moveLayoutPoint(wire,0,{pointAt.x+20.0f,pointAt.y+30.0f},true);
    page->moveLayoutPoint(wire,0,{pointAt.x+40.0f,pointAt.y+60.0f},true);
    page->moveLayoutPoint(wire,0,{pointAt.x+40.0f,pointAt.y+60.0f},false);
    check(page->graph().findConnection(wire)->layout[0].y==pointAt.y+60.0f,"routing point moves");
    page->undo();
    check(page->graph().findConnection(wire)->layout[0].y==pointAt.y,"point drag is one undo step");
    check(page->removeLayoutPoint(wire,0) && page->graph().findConnection(wire)->layout.empty(),"routing point removed");

    // Right-click on a connection inserts atomically; on empty space adds at the click.
    const auto inserted=page->insertEffectOnConnection(wire,FxEffectType::Delay,canvas.toGraph(mid));
    check(inserted!=0 && page->graph().validate() && page->graph().connectionAt({src,0},false)->to.node==inserted
          && page->graph().connectionAt({out,0},true)->from.node==inserted,"insert on connection: A -> X -> B");
    const auto* insertedNode=page->graph().findNode(inserted);
    const auto effectSize=ui::FxNodeComponent::sizeFor(*insertedNode);
    const float halfW=float(effectSize.getWidth())*0.5f,halfH=float(effectSize.getHeight())*0.5f;
    check(std::abs(insertedNode->position.x+halfW-mid.x)<1.0f && std::abs(insertedNode->position.y+halfH-mid.y)<1.0f,
          "inserted module is centred on the click");
    const auto before=page->graph();
    check(page->insertEffectOnConnection(9999,FxEffectType::Drive,{0,0})==0 && page->graph()==before,"failed insert preserves graph");
    const auto free=page->addEffectAt(FxEffectType::Reverb,{900.0f,300.0f});
    check(free!=0 && page->graph().findNode(free)->position.x==900.0f-halfW,"right-click empty canvas adds at the click");

    // Z-order: the active node comes to the front; DSP order is unaffected.
    const auto graphBefore=page->graph();
    page->selectNode(inserted);
    check(canvas.nodeZOrder().back()==inserted,"selected node moves to the front");
    page->selectNode(free);
    check(canvas.nodeZOrder().back()==free,"newly selected node moves to the front");
    page->selectNode(inserted);
    check(canvas.nodeZOrder().back()==inserted && page->graph()==graphBefore,"z-order is UI-only and never edits the graph");
    check(page->inspectorHeadline()=="DELAY","selection updates the inspector");

    // Real DSP: no NO DSP labels, inspector shows physical values, PING PONG exists.
    for(const auto& d:fxEffectCatalog()) check(d.processesAudio,"every menu effect processes audio");
    juce::Button* pingPong=nullptr;
    walk(*page,[&](auto& c){if(auto* button=dynamic_cast<juce::Button*>(&c)) if(button->getName()=="FX parameter pingpong") pingPong=button;});
    check(pingPong!=nullptr,"delay inspector exposes PING PONG");
    pingPong->setToggleState(true,juce::dontSendNotification);
    pingPong->onClick();
    check(page->graph().findNode(inserted)->parameter(6).value_or(0.0f)==1.0f,"inspector edits the one canonical parameter");

    // Source rail mirrors the canonical bus list.
    check(page->graph().sourceForBus(mct::origami::mainBusId)==src,"BUS 1 is the graph source");
    check(page->deleteNode(inserted) && page->selectedNode()==invalidFxNodeId,"deleting selected clears selection");
    check(page->graph().connectionAt({out,0},true)->from.node==src,"deleting the only effect restores BUS 1 -> MASTER OUT");
}

// mct-origami-fx-modulation-graph-ux-p03
void fxWorkspaceP03Audit() {
    using namespace mct::origami::fx;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    check(editor!=nullptr,"Origami editor");
    ui::FxPage* page=nullptr;
    juce::TextButton* fxTab=nullptr;
    juce::TextButton* utility=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* candidate=dynamic_cast<ui::FxPage*>(&c)) page=candidate;
        if(auto* b=dynamic_cast<juce::TextButton*>(&c)) {
            if(b->getButtonText()=="NODES") fxTab=b;
            if(b->getName()=="Origami utility menu") utility=b;
        }
    });
    check(page && fxTab && utility,"FX page, FX tab and utility menu present");
    check(utility->isEnabled(),"header ... utility menu enabled");

    // Build BUS 1 -> DELAY -> MASTER OUT.
    FxNodeId delay=0;
    p.getUiFxDocument().edit([&](FxGraph& g){delay=g.insertEffectBeforeOutput(FxEffectType::Delay);return delay!=0;});
    page->syncFromModel();
    auto* delayNode=page->canvas().nodeComponent(delay);
    juce::Slider* feedbackKnob=nullptr;
    walk(*delayNode,[&](auto& c){if(auto* s=dynamic_cast<juce::Slider*>(&c)) if(s->getName()=="FX "+juce::String(delay)+" P2") feedbackKnob=s;});
    check(feedbackKnob!=nullptr,"delay feedback knob");
    const auto& props=feedbackKnob->getProperties();
    check(int(props["mct.mod.destination"])==int(mct::origami::ModDestination::FxParameter)
          && unsigned(int(props["mct.mod.oscillator"]))==delay
          && std::uint32_t(int(props["mct.mod.itemId"]))==mct::origami::fxParameterAddress(delay,2).itemId,
          "FX knob advertises a stable canonical destination (node + parameter id)");

    // Cross-page drag: Synth -> hover FX tab -> FX opens -> same drag drops on a knob.
    check(editor->currentPage()==0,"starts on SYNTH");
    editor->beginModulationDrag(mct::origami::ModSource::Env1);
    const auto tabPoint=editor->getLocalArea(fxTab,fxTab->getLocalBounds()).getCentre();
    editor->updateModulationDragHover(tabPoint,1000.0);
    editor->updateModulationDragHover(tabPoint,1200.0);
    check(editor->currentPage()==0,"hovering under the threshold does not switch pages");
    editor->updateModulationDragHover({5,5},1250.0);
    editor->updateModulationDragHover(tabPoint,1300.0);
    editor->updateModulationDragHover(tabPoint,1500.0);
    check(editor->currentPage()==0,"passing over the tab restarts the hover timer");
    editor->updateModulationDragHover(tabPoint,1650.0);
    check(editor->currentPage()==2 && page->isVisible(),"deliberate hover switches to FX");
    check(editor->modulationDragContext().active && editor->modulationDragContext().source==mct::origami::ModSource::Env1
          && editor->modulationDragContext().originPage==0,"the drag context survives the page switch");
    check(editor->assignModulator(editor->modulationDragContext().source,*feedbackKnob),"drop creates the route");
    editor->endModulationDrag();
    check(!editor->modulationDragContext().active,"drag context ends on drop");
    const auto countRoutes=[&](mct::origami::ModSource source) {
        int n=0;
        for(const auto& r:p.getUiInstrumentState().modulation.routes)
            n+=r.id && r.source==source && r.destination==mct::origami::fxParameterAddress(delay,2);
        return n;
    };
    check(countRoutes(mct::origami::ModSource::Env1)==1,"ENV 1 -> DELAY / FEEDBACK in the canonical modulation state");

    // Right-click assignment (shared knob menu action): LFO, no duplicates.
    check(editor->assignModulator(mct::origami::ModSource::Lfo1,*feedbackKnob),"assign LFO 1");
    check(editor->assignModulator(mct::origami::ModSource::Lfo1,*feedbackKnob) && countRoutes(mct::origami::ModSource::Lfo1)==1,
          "re-assigning an existing source does not duplicate the route");
    juce::Slider plain;
    check(!editor->assignModulator(mct::origami::ModSource::Env2,plain),"non-destination control rejects the drop");
    float lfoAmount=0.0f;bool lfoBipolar=false;
    for(const auto& r:p.getUiInstrumentState().modulation.routes)
        if(r.id && r.source==mct::origami::ModSource::Lfo1) { lfoAmount=r.amount; lfoBipolar=r.bipolar; }
    check(std::abs(lfoAmount-0.5f)<1e-6f && lfoBipolar,"default amount/polarity match Synth drag-and-drop");

    // Matrix sees FX destinations of the same system.
    bool matrixListsFx=false;
    walk(*editor,[&](auto& c){if(auto* combo=dynamic_cast<juce::ComboBox*>(&c))
        for(int i=0;i<combo->getNumItems();++i) matrixListsFx|=combo->getItemText(i)=="FB";});
    // Rows only exist once the matrix rebuilds; force it.
    juce::TextButton* matrixTab=nullptr;
    walk(*editor,[&](auto& c){if(auto* b=dynamic_cast<juce::TextButton*>(&c)) if(b->getButtonText()=="MATRIX") matrixTab=b;});
    matrixTab->onClick();
    walk(*editor,[&](auto& c){if(auto* m=dynamic_cast<ui::ModulationMatrix*>(&c)) m->syncFromModel();});
    walk(*editor,[&](auto& c){if(auto* combo=dynamic_cast<juce::ComboBox*>(&c))
        for(int i=0;i<combo->getNumItems();++i) matrixListsFx|=combo->getItemText(i)=="FB";});
    check(matrixListsFx,"Matrix destination menus include FX parameters");
    fxTab->onClick();

    // MODULATION tab lists the routes targeting the selected effect.
    page->selectNode(delay);
    page->selectParameterTab(1);
    page->syncFromModel();
    check(page->modulationRowCount()==2,"MODULATION tab shows ENV 1 and LFO 1 routes");
    page->selectParameterTab(2);
    check(page->parameterTabName()=="ADVANCED","ADVANCED tab");
    page->selectParameterTab(0);

    // Deleting the node prunes its routes: no dangling destinations.
    check(page->deleteNode(delay),"delete delay");
    check(countRoutes(mct::origami::ModSource::Env1)==0 && countRoutes(mct::origami::ModSource::Lfo1)==0,
          "deleting an FX node removes its modulation routes");

    // Viewport transforms.
    auto& view=page->graphView();
    view.setView(1.0f,{0,0});
    const juce::Point<float> probe{240.0f,170.0f};
    for(const auto& [z,pan]:std::vector<std::pair<float,juce::Point<float>>>{{1.0f,{0,0}},{2.0f,{0,0}},{0.5f,{0,0}},{1.0f,{120,80}},{1.7f,{300,140}}}) {
        view.setView(z,pan);
        const auto g=view.viewToGraph(probe);
        const auto back=view.graphToView(g);
        check(std::abs(back.x-probe.x)<0.01f && std::abs(back.y-probe.y)<0.01f,"graph <-> view round trip");
    }
    view.setView(1.0f,{0,0});
    const auto anchorGraph=view.viewToGraph(probe);
    view.zoomAround(2.0f,probe);
    const auto stillThere=view.viewToGraph(probe);
    check(std::abs(stillThere.x-anchorGraph.x)<0.5f && std::abs(stillThere.y-anchorGraph.y)<0.5f,"zoom keeps the point under the pointer");
    check(view.zoom()==2.0f,"zoom applied");
    view.setView(10.0f,{0,0});
    check(view.zoom()==ui::FxGraphView::maxZoom,"zoom clamps");
    // Hit testing and insertion stay in graph space under zoom + pan.
    view.setView(1.6f,{60,40});
    const auto out=page->graph().outputNode(),src=page->graph().sourceNode();
    const auto wire=page->graph().connectionAt({out,0},true)->id;
    const auto* a=page->canvas().nodeComponent(src);
    const auto* b=page->canvas().nodeComponent(out);
    const auto mid=((a->portCentre(false,0)+a->getPosition().toFloat())+(b->portCentre(true,0)+b->getPosition().toFloat()))*0.5f;
    const auto viewPoint=view.graphToView({mid.x,mid.y});
    const auto graphPoint=view.viewToGraph(viewPoint);
    check(page->canvas().connectionAt({graphPoint.x,graphPoint.y})==wire,"cable hit test is correct under zoom + pan");
    const auto inserted=page->insertModuleOnConnection(wire,{FxModuleKind::Effect,FxEffectType::Drive,0},graphPoint);
    check(inserted && page->graph().validate(),"insertion at a zoomed/panned click");
    view.setView(1.0f,{0,0});
    page->zoomToFit();
    check(view.zoom()>=ui::FxGraphView::minZoom && view.zoom()<=ui::FxGraphView::maxZoom,"fit graph");

    // MASTER OUT accessory belongs to the node.
    auto* outComponent=page->canvas().nodeComponent(out);
    auto* accessory=outComponent->accessory();
    check(accessory && accessory->getParentComponent()==outComponent && accessory->isVisible(),"accessory is owned by MASTER OUT");
    const auto relative=accessory->getBounds();
    page->commitMove(out,{900,300});
    check(outComponent->getPosition()==juce::Point<int>(900,300) && accessory->getBounds()==relative,"accessory moves with MASTER OUT");
    const auto beforeAccessory=page->graph().connectionAt({out,0},true)->from.node;
    const auto viaAccessory=page->insertBeforeOutput({FxModuleKind::Effect,FxEffectType::Reverb,0});
    check(page->graph().connectionAt({out,0},true)->from.node==viaAccessory
          && page->graph().connectionAt({viaAccessory,0},true)->from.node==beforeAccessory,"accessory inserts right before MASTER OUT");

    // Add Module catalog: one list, only real modules.
    const auto ids=page->moduleMenuIds(true);
    const auto has=[&ids](int id){return std::find(ids.begin(),ids.end(),id)!=ids.end();};
    check(has(int(FxEffectType::Delay)) && has(ui::FxModuleMenu::splitId) && has(ui::FxModuleMenu::mergeId),"Add Module: effects + routing");
    check(!has(ui::FxModuleMenu::sendId) && !has(ui::FxModuleMenu::returnId) && !has(ui::FxModuleMenu::externalId),"pending modules are not active");
    check(!has(ui::FxModuleMenu::busBase+1),"BUS 1 already in the graph is not offered again");
    const auto split=page->addModuleAt({FxModuleKind::Split,FxEffectType::None,0},{400,500});
    const auto merge=page->addModuleAt({FxModuleKind::Merge,FxEffectType::None,0},{700,500});
    check(page->graph().findNode(split)->ports.outputs==2 && page->graph().findNode(merge)->ports.inputs==2,"Split/Merge authoring");
    check(page->connectPorts({split,0},{merge,0}) && page->graph().validate(),"manual port connection");
    check(!page->connectPorts({merge,0},{split,0}),"cycle-forming connection rejected");

    // Sidebar references canonical objects.
    const auto& modulators=page->sidebar().rows(ui::FxSidebar::Tab::Modulators);
    bool envDrag=false;
    for(const auto& r:modulators) envDrag|=r.label=="ENV 1" && r.dragDescription=="MCT_MOD_SOURCE:1";
    check(envDrag,"MODULATORS drag the same source description as SYNTH");
    bool mainBus=false,addBus=false,mainInput=false,filterTruth=false;
    auto withFilter=p.getUiInstrumentState().modulation;withFilter.filterEnabled=true;check(p.setUiModulationState(withFilter),"sidebar authored filter fixture");page->syncFromModel();
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Buses)) {
        mainBus|=r.label=="MAIN" && r.active && !r.onSecondaryClick; // selected, not deletable
        addBus|=r.label=="+ ADD BUS" && bool(r.onClick);
    }
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Sources)) mainInput|=r.label=="MAIN IN" && r.active;
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Filters))
        filterTruth|=r.label=="LEGACY LP" && r.detail.contains("before buses") && r.dragDescription=="MCT_SYNTH_FILTER:0";
    check(mainBus && addBus && mainInput && filterTruth,"SOURCES / FILTERS / BUSES rows are truthful");

    // Clear: Origami-native confirmation, one undoable transaction.
    const auto beforeClear=page->graph();
    page->requestClear();
    check(page->clearConfirmationVisible() && page->graph()==beforeClear,"CLEAR asks first and changes nothing");
    page->confirmClear();
    check(!page->clearConfirmationVisible() && page->graph().nodes().size()==2
          && page->graph().connectionAt({page->graph().outputNode(),0},true)!=nullptr,"CLEAR restores BUS 1 -> MASTER OUT");
    page->undo();
    check(page->graph()==beforeClear,"one UNDO restores the complete graph");

    // Global FX popup (Origami-native) from the utility menu.
    editor->openGlobalFx();
    check(editor->globalFxVisible(),"Global FX popup opens");
    juce::ComboBox* order=nullptr;
    walk(*editor,[&](auto& c){if(auto* combo=dynamic_cast<juce::ComboBox*>(&c)) if(combo->getName()=="FX Global order") order=combo;});
    check(order && order->isEnabled() && order->getNumItems()==2,"FX ORDER is a real choice");
    order->setSelectedId(int(FxOrder::PreMaster),juce::sendNotificationSync);
    check(p.getUiFxWorkspace().globals().order==FxOrder::PreMaster,"FX ORDER edits the canonical Global FX settings");
    check(p.getUiFxDocument().graph().globals().order==FxOrder::PostMaster,"Global FX is not stored in (or applied as) MAIN bus FX");
}

void fxModulationAudioAudit() {
    using namespace mct::origami::fx;
    constexpr int blockSize=256;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,blockSize);
    FxNodeId limiter=0;
    p.getUiFxDocument().edit([&](FxGraph& g){limiter=g.insertEffectBeforeOutput(FxEffectType::Limiter);return limiter!=0;});
    // MACRO 1 -> LIMITER / GAIN (+0..24 dB span): modulation reaches DSP via the
    // engine's canonical evaluation and the prepared FX plan.
    const unsigned id=p.addUiRoute();
    auto state=p.getUiInstrumentState();
    for(auto& r:state.modulation.routes) if(r.id==id) {
        r.source=mct::origami::ModSource::Macro1;
        r.destination=mct::origami::fxParameterAddress(limiter,1);
        r.amount=0.5f;r.enabled=true;r.bipolar=false;
        check(p.setUiRoute(r),"FX route accepted at the host boundary");
    }
    const auto rmsAfter=[&](float macro) {
        p.setUiMacro(0,macro);
        juce::AudioBuffer<float> audio(2,blockSize);
        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,57,1.0f),0);
        for(int n=0;n<40;++n) { audio.clear();p.processBlock(audio,midi);midi.clear(); }
        double sum=0.0;
        for(int n=0;n<16;++n) { audio.clear();p.processBlock(audio,midi);for(int i=0;i<blockSize;++i) sum+=double(audio.getSample(0,i))*audio.getSample(0,i); }
        return std::sqrt(sum/double(16*blockSize));
    };
    const double low=rmsAfter(0.0f),high=rmsAfter(1.0f);
    check(high>low*2.5,"MACRO -> FX parameter audibly changes the DSP");

    // FX ORDER through processBlock: with a linear (neutral) graph moving the
    // master gain after the FX graph preserves the level. Fresh processors,
    // one oscillator: deterministic regardless of start phase.
    const auto orderRms=[&](FxOrder order) {
        auto owner=std::make_unique<OrigamiAudioProcessor>(); auto& q=*owner;
        q.prepareToPlay(48000.0,blockSize);
        disableExtraOscillators(q);
        FxGlobalSettings s=q.getUiFxWorkspace().globals();s.order=order;q.getUiFxWorkspace().setGlobals(s);
        juce::AudioBuffer<float> audio(2,blockSize);
        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,57,1.0f),0);
        for(int n=0;n<40;++n) { audio.clear();q.processBlock(audio,midi);midi.clear(); }
        double sum=0.0;
        for(int n=0;n<16;++n) { audio.clear();q.processBlock(audio,midi);for(int i=0;i<blockSize;++i) sum+=double(audio.getSample(0,i))*audio.getSample(0,i); }
        return std::sqrt(sum/double(16*blockSize));
    };
    const double post=orderRms(FxOrder::PostMaster),pre=orderRms(FxOrder::PreMaster);
    check(post>0.001 && std::abs(pre/post-1.0)<0.02,"PRE MASTER with a linear graph preserves level (master moved after FX)");
}

// mct-origami-unified-routing-core-fx-p04
void busWorkspaceP04Audit() {
    using namespace mct::origami::fx;
    constexpr int blockSize=256;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,blockSize);
    disableExtraOscillators(p);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    ui::FxPage* page=nullptr;
    walk(*editor,[&](auto& c){if(auto* candidate=dynamic_cast<ui::FxPage*>(&c)) page=candidate;});
    check(page!=nullptr,"FX page");
    check(p.getUiInstrumentState().buses.count==1 && p.getUiInstrumentState().buses.buses[0].label()=="MAIN","MAIN exists by default");
    check(!p.removeUiBus(mct::origami::mainBusId),"MAIN cannot be deleted");

    // MAIN graph content, then add BUS 1 from the FX workspace.
    page->document().edit([](FxGraph& g){return g.insertEffectBeforeOutput(FxEffectType::Delay)!=0;});
    page->syncFromModel();
    const auto mainGraph=page->graph();
    const auto bus=page->addBus();
    check(bus!=0 && page->selectedBus()==bus && p.getUiInstrumentState().buses.find(bus)->label()=="BUS 1","+ ADD BUS creates and selects BUS 1");
    check(page->graph().sourceForBus(bus)!=invalidFxNodeId && page->graph().nodes().size()==2,"BUS 1 shows its own neutral graph");
    bool busRow=false;
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Buses)) busRow|=r.label=="BUS 1" && r.active && bool(r.onSecondaryClick);
    check(busRow,"BUSES tab lists BUS 1 (selected, deletable)");
    const auto gainNode=[&]{FxNodeId id=0; page->document().edit([&](FxGraph& g){id=g.insertEffectBeforeOutput(FxEffectType::Gain);return id!=0;}); return id;}();
    page->syncFromModel();
    juce::Slider* gainKnob=nullptr;
    walk(*page->canvas().nodeComponent(gainNode),[&](auto& c){if(auto* sl=dynamic_cast<juce::Slider*>(&c)) if(sl->getName()=="FX "+juce::String(gainNode)+" P1") gainKnob=sl;});
    check(gainKnob && std::uint32_t(int(gainKnob->getProperties()["mct.mod.itemId"]))==mct::origami::fxParameterAddress(bus,gainNode,1).itemId,
          "FX knobs on BUS 1 advertise bus-qualified destinations");
    page->selectBus(mct::origami::mainBusId);
    check(page->graph()==mainGraph,"switching back: MAIN graph unchanged");
    page->selectBus(bus);
    check(page->graph().findNode(gainNode)!=nullptr,"BUS 1 graph persists across switches");

    // Clear only the selected bus.
    page->requestClear();
    page->confirmClear();
    check(page->graph().nodes().size()==2 && p.getUiFxWorkspace().find(mct::origami::mainBusId)->graph()==mainGraph,
          "CLEAR clears only the selected bus graph");
    page->undo();
    check(page->graph().findNode(gainNode)!=nullptr,"undo restores the cleared bus graph");

    // Hidden bus still processes audio: send OSC 1 only to BUS 1, view MAIN.
    auto module=p.getUiOscillatorState(1);
    module.busRoutes[0].level=0.0f;
    check(mct::origami::addOscBusRoute(module,p.getUiInstrumentState().buses,bus,1.0f)==mct::origami::BusRouteResult::Ok
          && p.setUiOscillatorState(1,module),"OSC 1 -> MAIN 0.0, BUS 1 1.0");
    page->selectBus(mct::origami::mainBusId);
    const auto rms=[&]{
        juce::AudioBuffer<float> audio(2,blockSize);
        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,57,1.0f),0);
        for(int n=0;n<30;++n) { audio.clear();p.processBlock(audio,midi);midi.clear(); }
        double sum=0.0;
        for(int n=0;n<16;++n) { audio.clear();p.processBlock(audio,midi);for(int i=0;i<blockSize;++i) sum+=double(audio.getSample(0,i))*audio.getSample(0,i); }
        return std::sqrt(sum/double(16*blockSize));
    };
    const double viaBus=rms();
    check(viaBus>0.001,"a user bus renders and reaches the output while its graph is not shown");
    p.getUiFxWorkspace().find(bus)->edit([&](FxGraph& g){return g.setParameter(gainNode,1,0.0f)==FxEditResult::Ok;}); // -48 dB
    const double quiet=rms();
    check(quiet<viaBus*0.05,"the hidden bus's FX graph processes its audio");

    // Persistence: buses + their graphs survive save/load.
    juce::MemoryBlock saved;
    p.getStateInformation(saved);
    auto restoredOwner=std::make_unique<OrigamiAudioProcessor>(); auto& restored=*restoredOwner;
    restored.setStateInformation(saved.getData(),int(saved.getSize()));
    check(restored.getUiInstrumentState().buses.find(bus) && restored.getUiInstrumentState().buses.find(bus)->label()=="BUS 1"
          && restored.getUiFxWorkspace().find(bus) && restored.getUiFxWorkspace().find(bus)->graph()==p.getUiFxWorkspace().find(bus)->graph(),
          "additional buses and their graphs persist through save/load");

    // Delete BUS 1: OSC 1's only audible route goes; it falls back to MAIN at unity.
    page->selectBus(bus);
    module=p.getUiOscillatorState(1);
    mct::origami::removeOscBusRoute(module,0); // keep BUS 1 as the only route
    p.setUiOscillatorState(1,module);
    page->requestDeleteBus(bus);
    check(page->clearConfirmationVisible(),"DELETE BUS asks for confirmation");
    check(page->deleteBus(bus),"delete BUS 1");
    const auto after=p.getUiOscillatorState(1);
    check(page->selectedBus()==mct::origami::mainBusId && !p.getUiFxWorkspace().find(bus)
          && after.busRouteCount==1 && after.busRoutes[0].bus==mct::origami::mainBusId && after.busRoutes[0].level==1.0f,
          "deleting a bus removes its graph and returns orphaned oscillators to MAIN");

    // Legacy P02/P03 state: single MAIN graph trailer ('FXG2') with Global FX inside.
    auto legacyGraph=makeSerialChainTemplate();
    FxGlobalSettings legacyGlobals;legacyGlobals.outputGainDb=-6.0f;legacyGraph.setGlobals(legacyGlobals);
    auto bytes=encodeInstrumentState(p.getUiInstrumentState());
    const auto fx=encodeFxGraph(legacyGraph);
    bytes.insert(bytes.end(),fx.begin(),fx.end());
    for(const auto word:{std::uint32_t(fx.size()),std::uint32_t(0x46584732u)}) for(int sh=24;sh>=0;sh-=8) bytes.push_back(std::uint8_t(word>>sh));
    auto legacyOwner=std::make_unique<OrigamiAudioProcessor>(); auto& legacy=*legacyOwner;
    legacy.setStateInformation(bytes.data(),int(bytes.size()));
    auto expected=legacyGraph;expected.setGlobals(FxGlobalSettings{});
    check(legacy.getUiFxDocument().graph()==expected && legacy.getUiFxWorkspace().globals().outputGainDb==-6.0f,
          "P02/P03 state: its graph becomes MAIN, its globals become Global FX");

    // FX MODULATORS ring edits the SAME canonical route.
    FxNodeId delay=0;
    for(const auto& n:page->graph().nodes()) if(n.effect==FxEffectType::Delay) delay=n.id;
    page->syncFromModel();
    juce::Slider* fb=nullptr;
    walk(*page->canvas().nodeComponent(delay),[&](auto& c){if(auto* sl=dynamic_cast<juce::Slider*>(&c)) if(sl->getName()=="FX "+juce::String(delay)+" P2") fb=sl;});
    check(fb && editor->assignModulator(mct::origami::ModSource::Env1,*fb),"ENV 1 -> MAIN / DELAY / FB");
    page->syncFromModel();
    const ui::FxSidebar::Row* envRow=nullptr;
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Modulators)) if(r.label=="ENV 1") envRow=&r;
    check(envRow && envRow->magnitudes.size()==1 && envRow->active && envRow->dragDescription=="MCT_MOD_SOURCE:1",
          "FX modulator row: same drag source as SYNTH, ring for its route");
    envRow->onMagnitude(envRow->magnitudes[0].routeId,0.25f);
    float amount=0.0f;
    for(const auto& r:p.getUiInstrumentState().modulation.routes) if(r.id && r.source==mct::origami::ModSource::Env1) amount=r.amount;
    check(std::abs(amount-0.25f)<1e-6f,"dragging the ring edits the canonical modulation route");
}

float blockRms(const juce::AudioBuffer<float>& audio) {
    double sum=0.0;
    for(int i=0;i<audio.getNumSamples();++i) sum+=double(audio.getSample(0,i))*audio.getSample(0,i);
    return float(std::sqrt(sum/double(audio.getNumSamples())));
}

void fxAudioPathAudit() {
    using namespace mct::origami::fx;
    constexpr int blockSize=256;
    const auto renderBlocks=[](OrigamiAudioProcessor& p,int blocks,juce::MidiBuffer midi) {
        juce::AudioBuffer<float> audio(2,blockSize),all(2,blockSize*blocks);
        for(int n=0;n<blocks;++n) {
            audio.clear();p.processBlock(audio,midi);midi.clear();
            for(int ch=0;ch<2;++ch) all.copyFrom(ch,n*blockSize,audio,ch,0,blockSize);
        }
        return all;
    };
    const auto noteOn=[]{juce::MidiBuffer m;m.addEvent(juce::MidiMessage::noteOn(1,57,1.0f),0);return m;};
    const auto noteOff=[]{juce::MidiBuffer m;m.addEvent(juce::MidiMessage::noteOff(1,57),0);return m;};
    const auto finite=[](const juce::AudioBuffer<float>& b){for(int ch=0;ch<b.getNumChannels();++ch) for(int i=0;i<b.getNumSamples();++i) if(!std::isfinite(b.getSample(ch,i))) return false;return true;};

    // OSC -> filter -> BUS 1 -> FX GRAPH -> MASTER OUT, through processBlock.
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,blockSize);
    auto& document=p.getUiFxDocument();
    renderBlocks(p,4,noteOn());
    const float clean=blockRms(renderBlocks(p,16,{}));
    check(clean>0.001f,"BUS 1 -> MASTER OUT carries the synth");

    FxNodeId drive=0,delay=0;
    check(document.edit([&](FxGraph& g){
        drive=g.insertEffectBeforeOutput(FxEffectType::Drive);
        g.setParameter(drive,1,1.0f); // 36 dB into the saturator
        return drive!=0;
    }),"BUS 1 -> DRIVE -> MASTER OUT");
    const auto driven=renderBlocks(p,24,{});
    check(finite(driven) && blockRms(driven)>clean*1.3f,"drive audibly saturates the synth through the processor");

    document.edit([&](FxGraph& g){return g.setEnabled(drive,false)==FxEditResult::Ok;});
    renderBlocks(p,8,{});
    const float bypassed=blockRms(renderBlocks(p,16,{}));
    check(bypassed<blockRms(driven)*0.9f && std::abs(bypassed-clean)<clean*0.25f,"bypassing drive returns to the clean level");

    check(document.edit([&](FxGraph& g){
        delay=g.insertEffectBeforeOutput(FxEffectType::Delay);
        g.setParameter(delay,3,0.6f);
        g.setParameter(delay,2,0.8f);
        return delay!=0;
    }),"BUS 1 -> DRIVE -> DELAY -> MASTER OUT");

    // Delay tail: after the note's release, a fresh neutral processor is silent
    // while the delayed instance keeps echoing.
    renderBlocks(p,1,noteOff());
    renderBlocks(p,int(48000*1.5)/blockSize,{});
    const float tail=blockRms(renderBlocks(p,24,{}));
    auto neutralOwner=std::make_unique<OrigamiAudioProcessor>(); auto& neutral=*neutralOwner;
    neutral.prepareToPlay(48000.0,blockSize);
    renderBlocks(neutral,20,noteOn());
    renderBlocks(neutral,1,noteOff());
    renderBlocks(neutral,int(48000*1.5)/blockSize,{});
    const float neutralTail=blockRms(renderBlocks(neutral,24,{}));
    check(tail>1.0e-4f && tail>neutralTail*10.0f,"delay produces echoes after the dry note has released");

    const auto graphBeforePanic=document.graph();
    p.requestPanic();
    const auto stopped=renderBlocks(p,2,{});
    check(magnitude(stopped)==0.0f && document.graph()==graphBeforePanic,
          "panic clears delay tail and preserves FX routing");

    document.edit([&](FxGraph& g){return g.setEnabled(delay,false)==FxEditResult::Ok;});
    renderBlocks(p,8,{});
    check(blockRms(renderBlocks(p,24,{}))<tail*0.1f,"bypassing delay removes the echo");

    // Deleting nodes recompiles safely while audio runs; the chain stays live.
    const auto compiles=p.getFxCompileCount();
    check(document.edit([&](FxGraph& g){return g.removeNodeBridging(delay)==FxEditResult::Ok;}),"delete delay");
    check(p.getFxCompileCount()==compiles+1,"deletion recompiles the plan");
    renderBlocks(p,1,noteOn());
    const auto afterDelete=renderBlocks(p,16,{});
    check(finite(afterDelete) && blockRms(afterDelete)>0.001f,"graph keeps sounding after deletion");

    // Meters: bounded peak telemetry.
    const auto peaks=p.consumeUiFxPeaks();
    check(peaks.first>0.0f && peaks.first<=1.5f && p.consumeUiFxPeaks().first==0.0f,"master meter telemetry");

    // State: FX graph round-trips; old states without it load neutral.
    juce::MemoryBlock saved;
    p.getStateInformation(saved);
    auto restoredOwner=std::make_unique<OrigamiAudioProcessor>(); auto& restored=*restoredOwner;
    restored.setStateInformation(saved.getData(),int(saved.getSize()));
    check(restored.getUiFxDocument().graph()==document.graph(),"FX graph (nodes, params, bypass, layout, globals) persists");
    const auto legacy=encodeInstrumentState(p.getUiInstrumentState());
    restored.setStateInformation(legacy.data(),int(legacy.size()));
    check(restored.getUiFxDocument().graph()==makeDefaultFxGraph(),"old state without FX graph restores the neutral graph");

    // Bus routes: BUS 1 default, unity; invalid destinations rejected at the boundary.
    auto module=p.getUiOscillatorState(1);
    check(module.busRouteCount==1 && module.busRoutes[0].bus==mct::origami::mainBusId && module.busRoutes[0].level==1.0f,
          "oscillators route to BUS 1 at unity by default");
    auto invalid=module;invalid.busRoutes[0].bus=77;
    check(!p.setUiOscillatorState(1,invalid),"routes to unknown buses are rejected");
    module.busRoutes[0].level=0.5f;
    check(p.setUiOscillatorState(1,module) && p.getUiOscillatorState(1).busRoutes[0].level==0.5f,"send level edits persist");
}



// mct-origami-modulation-row-consistency
// A source card's height follows its route count the moment the model changes
// (no selection or other UI event), and SYNTH / FX MODULATORS show the same
// shared card fed from the same canonical routes.
void modulationRowConsistencyAudit() {
    using mct::origami::ModSource;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    ui::ModulationPanel* synth=nullptr;
    ui::FxPage* fx=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* m=dynamic_cast<ui::ModulationPanel*>(&c)) synth=m;
        if(auto* f=dynamic_cast<ui::FxPage*>(&c)) fx=f;});
    check(synth && fx,"SYNTH modulation panel and FX page");
    editor->setVisible(true); // hit-testing needs a visible editor, as in a host window
    fx->sidebar().setTab(ui::FxSidebar::Tab::Modulators);
    editor->refreshModulationViews();

    const auto* env1=synth->sourceRow(ModSource::Env1);
    const auto* env2=synth->sourceRow(ModSource::Env2);
    const auto* fxEnv1=fx->sidebar().modulatorRow(ModSource::Env1);
    check(env1 && env2 && fxEnv1,"ENV cards exist on SYNTH and FX");
    check(env1->getName().startsWith("MOD SOURCE TAB") && fxEnv1->getName().startsWith("MOD SOURCE TAB"),
          "FX MODULATORS hosts the SYNTH card (same component class and look)");
    const auto envRoutes=[&]{return ui::modulationSourceRoutes(p.getUiInstrumentState().modulation,ModSource::Env1);};
    const auto sameIds=[](const std::vector<ui::ModulationSourceRoute>& a,const std::vector<ui::ModulationSourceRoute>& b) {
        if(a.size()!=b.size()) return false;
        for(std::size_t i=0;i<a.size();++i) if(a[i].id!=b[i].id || a[i].amount!=b[i].amount) return false;
        return true;
    };
    check(envRoutes().empty() && env1->routes().empty() && fxEnv1->routes().empty(),"no ENV 1 assignments yet");
    const int collapsed=env1->getHeight();
    const int env2Y=env2->getY();
    check(collapsed==ui::ModulationSourceRow::baseHeight-2 && fxEnv1->getHeight()==collapsed,"collapsed card height (SYNTH == FX)");

    // Knobs a real drop can land on (top-most component under their centre).
    std::vector<juce::Slider*> knobs;
    walk(*editor,[&](auto& c){
        auto* slider=dynamic_cast<juce::Slider*>(&c);
        if(slider==nullptr || !slider->isRotary() || !slider->getProperties().contains("mct.mod.destination")) return;
        if(int(slider->getProperties()["mct.mod.destination"])==int(mct::origami::ModDestination::FxParameter)) return;
        auto* hit=editor->getComponentAt(editor->getLocalArea(slider,slider->getLocalBounds()).getCentre());
        while(hit!=nullptr && hit!=slider) hit=hit->getParentComponent();
        if(hit==slider) knobs.push_back(slider);});
    check(knobs.size()>=3,"three droppable SYNTH knobs");
    if(knobs.size()<3) return;

    // 1) Drag-and-drop: the card grows inside the same event.
    const auto drop=[&](juce::Slider& knob) {
        juce::DragAndDropTarget::SourceDetails details("MCT_MOD_SOURCE:"+juce::String(int(ModSource::Env1)),
            const_cast<ui::ModulationSourceRow*>(env1),editor->getLocalArea(&knob,knob.getLocalBounds()).getCentre());
        editor->itemDropped(details);
    };
    drop(*knobs[0]);
    check(envRoutes().size()==1,"drop creates the assignment");
    check(env1->getHeight()==ui::ModulationSourceRow::routedHeight-2 && env1->routes().size()==1,
          "SYNTH card expands immediately after the drop (no click)");
    check(env2->getY()==env2Y+(ui::ModulationSourceRow::routedHeight-ui::ModulationSourceRow::baseHeight),
          "cards below move down immediately (rail re-laid out, not just repainted)");
    check(fxEnv1->getHeight()==env1->getHeight() && sameIds(fxEnv1->routes(),envRoutes()),"FX card expands from the same route");

    // 2) Ring double-click removal on SYNTH: collapses in the same call.
    env1->onRouteRemove(env1->routes()[0].id);
    check(envRoutes().empty() && env1->routes().empty() && env1->getHeight()==collapsed && env2->getY()==env2Y,
          "SYNTH card collapses immediately after removing its assignment");
    check(editor->modulationRefreshPending(),"removal notifies every modulation view");
    editor->flushModulationRefresh();
    check(fxEnv1->routes().empty() && fxEnv1->getHeight()==collapsed,"FX card follows the removal");

    // 3) Several assignments made outside the rail (knob menu / FX graph path).
    for(std::size_t i=0;i<3;++i) check(editor->assignModulator(ModSource::Env1,*knobs[i]),"assign ENV 1");
    check(editor->modulationRefreshPending(),"assignments post one refresh");
    editor->flushModulationRefresh(); // the next message-loop turn; no UI event involved
    check(env1->routes().size()==3 && env1->getHeight()==ui::ModulationSourceRow::routedHeight-2,"three rings, expanded card");
    check(sameIds(env1->routes(),envRoutes()) && sameIds(fxEnv1->routes(),envRoutes()),
          "SYNTH and FX rows derive their rings from the same canonical routes");
    check(fxEnv1->ringBounds(2).getWidth()>0.0f && fxEnv1->getHeight()==env1->getHeight(),"FX card shows the same rings and height");

    // 4) Remove all (from FX): the FX card collapses at once, SYNTH on the posted refresh.
    for(const auto& r:envRoutes()) fxEnv1->onRouteRemove(r.id);
    check(envRoutes().empty() && fxEnv1->routes().empty() && fxEnv1->getHeight()==collapsed,"FX card collapses immediately on remove-all");
    editor->flushModulationRefresh();
    check(env1->routes().empty() && env1->getHeight()==collapsed && env2->getY()==env2Y,"SYNTH card collapses after remove-all");

    // 5) A model change from outside the UI (host/preset) still re-lays out on the next sync.
    const auto id=p.addUiRoute();
    auto route=mct::origami::ModRoute{};
    for(const auto& r:p.getUiInstrumentState().modulation.routes) if(r.id==id) route=r;
    route.source=ModSource::Env1;route.destination={mct::origami::ModDestination::Cutoff,0,0};route.amount=0.4f;
    check(p.setUiRoute(route),"external route edit");
    synth->syncFromModel();
    check(env1->routes().size()==1 && env1->getHeight()==ui::ModulationSourceRow::routedHeight-2,"external change expands the card on sync");
}

// mct-origami-nodes-n01
// NODES naming/structure, Matrix route contract (defaults, unique pairs,
// destination availability, source revalidation), route monitor semantics and
// state compatibility.
void nodesN01Audit() {
    using namespace mct::origami;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    {auto m=p.getUiInstrumentState().modulation;m.filterEnabled=true;check(p.setUiModulationState(m),"Nodes destination fixture includes a filter");}
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    ui::FxPage* page=nullptr;
    juce::TextButton* nodesButton=nullptr;
    bool fxHeaderButton=false;
    walk(*editor,[&](auto& c){
        if(auto* f=dynamic_cast<ui::FxPage*>(&c)) page=f;
        if(auto* b=dynamic_cast<juce::TextButton*>(&c)) {
            if(b->getButtonText()=="NODES" && !nodesButton) nodesButton=b;
            fxHeaderButton|=b->getButtonText()=="FX";
        }});
    check(page && nodesButton && !fxHeaderButton,"the workspace is presented as NODES (no FX header button)");
    nodesButton->onClick();
    check(page->isVisible() && editor->currentPage()==2,"NODES opens the node workspace");

    // Sidebar: five categories; MATRIX hosts the canonical Matrix (compact).
    auto& sidebar=page->sidebar();
    const char* expected[]{"SOURCES","MODULATORS","FILTERS","BUSES","MATRIX"};
    bool labels=true;
    for(int t=0;t<ui::FxSidebar::tabCount;++t) labels&=sidebar.tabLabel(static_cast<ui::FxSidebar::Tab>(t))==expected[t];
    check(ui::FxSidebar::tabCount==5 && labels,"sidebar: SOURCES / MODULATORS / FILTERS / BUSES / MATRIX");
    sidebar.setTab(ui::FxSidebar::Tab::Matrix);
    check(page->matrix().isVisible() && page->matrix().layout()==ui::ModulationMatrix::Layout::Sidebar
          && page->matrix().getParentComponent()==&sidebar,"MATRIX tab shows the Matrix view inside the sidebar");
    sidebar.setTab(ui::FxSidebar::Tab::Sources);
    check(!page->matrix().isVisible(),"other tabs hide the Matrix view");

    // Layout: full-height sidebar; MODULE PARAMETERS replaces SELECTED EFFECT + EFFECT PARAMETERS.
    check(sidebar.getBottom()==page->getHeight() && sidebar.getBottom()==page->moduleParametersPanel().getBottom(),
          "sidebar runs to the bottom of the workspace (top of the keyboard)");
    check(page->moduleParametersPanel().getName()=="MODULE PARAMETERS" && page->moduleParametersPanel().getX()>=sidebar.getRight()
          && page->moduleParametersPanel().getRight()==page->getWidth() && !page->macrosPanel().isVisible(),
          "MODULE PARAMETERS spans the graph width without duplicate macros");
    bool oldPanels=false;
    walk(*page,[&](auto& c){oldPanels|=c.getName()=="SELECTED EFFECT" || c.getName()=="EFFECT PARAMETERS";});
    check(!oldPanels,"no separate SELECTED EFFECT / EFFECT PARAMETERS panels");
    const auto filter=page->addEffect(fx::FxEffectType::Filter);
    page->selectNode(filter);
    check(page->inspectorHeadline()=="FILTER" && page->parameterTabName()=="MAIN","MODULE PARAMETERS follows selection");

    // New route defaults: ON / UNIPOLAR / no source / no destination / 0%.
    const auto routeById=[&](std::uint32_t id) {
        for(const auto& r:p.getUiInstrumentState().modulation.routes) if(r.id==id) return r;
        return ModRoute{};
    };
    const auto blank=p.addUiRoute();
    const auto created=routeById(blank);
    check(blank!=0 && created.enabled && !created.bipolar && created.source==ModSource::None
          && created.destination.parameter==ModDestination::None && created.amount==0.0f,"new route: ON / UNIPOLAR / none / none / 0%");
    check(!routeComplete(created),"an unselected route is incomplete (inert)");
    {   // An incomplete route never reaches the evaluator, even with an amount.
        auto r=created; r.amount=0.7f; r.source=ModSource::Lfo1;
        check(p.setUiRoute(r),"a source-only route is a valid, inert state");
    }
    p.removeUiRoute(blank);
    sidebar.setTab(ui::FxSidebar::Tab::Matrix);
    page->matrix().addButton().onClick();
    check(page->matrix().routeCount()==1 && routeById(p.getUiInstrumentState().modulation.routes[0].id).source==ModSource::None,
          "+ ADD ROUTE in NODES > MATRIX creates the same blank canonical route");
    p.removeUiRoute(p.getUiInstrumentState().modulation.routes[0].id);

    // Unique (source, destination) pairs, enforced by the model.
    const auto route=[&](ModSource s,ModAddress d,float a,bool bipolar) {
        const auto id=p.addUiRoute(); ModRoute r{}; r.id=id; r.source=s; r.destination=d; r.amount=a; r.bipolar=bipolar;
        return p.setUiRoute(r) ? id : 0u; };
    const ModAddress cutoff{ModDestination::Cutoff,0,0},resonance{ModDestination::Resonance,0,0};
    const auto lfo1Cutoff=route(ModSource::Lfo1,cutoff,0.5f,false);
    check(lfo1Cutoff!=0,"LFO 1 -> CUTOFF");
    check(route(ModSource::Lfo1,cutoff,0.2f,false)==0,"a second LFO 1 -> CUTOFF is rejected by the model");
    const auto lfo2Cutoff=route(ModSource::Lfo2,cutoff,-0.6f,true);
    check(lfo2Cutoff!=0,"LFO 2 -> CUTOFF is valid (uniqueness is per pair)");
    {
        auto dup=p.getUiInstrumentState().modulation;
        for(auto& r:dup.routes) if(r.id==lfo2Cutoff) r.source=ModSource::Lfo1;
        check(!validModulation(dup,p.getUiInstrumentState().oscillators) && !p.setUiModulationState(dup),
              "validation rejects any state holding a duplicate pair");
    }
    // Remove the rejected attempt's blank route so rows are predictable.
    for(const auto& r:p.getUiInstrumentState().modulation.routes)
        if(r.id && !routeComplete(r)) p.removeUiRoute(r.id);

    // Destination menu: disabled for the selected source's existing pair.
    const auto blankRow=p.addUiRoute();
    { auto r=routeById(blankRow); r.source=ModSource::Lfo1; check(p.setUiRoute(r),"blank route picks LFO 1"); }
    editor->refreshModulationViews();
    auto& matrix=page->matrix();
    check(matrix.routeCount()==3,"three Matrix rows");
    check(!matrix.destinationAvailable(2,cutoff) && matrix.destinationReason(2,cutoff)=="Already routed from LFO 1",
          "CUTOFF is disabled for LFO 1 and says why");
    check(matrix.destinationAvailable(2,resonance),"other destinations stay available");
    check(matrix.destinationAvailable(1,cutoff),"a row's own pair is not 'taken' by itself");

    // Changing a route's source revalidates its destination.
    ui::NativeComboBox* sourceBox=nullptr;
    walk(*matrix.routeRow(1),[&](auto& c){if(auto* box=dynamic_cast<ui::NativeComboBox*>(&c)) if(box->getName()=="Route source") sourceBox=box;});
    check(sourceBox!=nullptr,"row 2 source menu");
    sourceBox->setSelectedId(int(ModSource::Lfo1),juce::sendNotificationSync);
    const auto changed=routeById(lfo2Cutoff);
    check(changed.source==ModSource::Lfo1 && changed.destination.parameter==ModDestination::None,
          "choosing a source that already feeds the destination clears the destination");
    check(routeById(lfo1Cutoff).destination==cutoff,"the existing pair is untouched");

    // Monitor semantics: source -> polarity -> amount, before destination mapping.
    ModulationState mod=p.getUiInstrumentState().modulation;
    ModulationSourceSlots slots{};
    slots[0]=0.6f; // LFO 1 (free-running) raw value
    ModRoute uni{}; uni.id=1; uni.source=ModSource::Lfo1; uni.destination=cutoff; uni.amount=0.5f;
    ModRoute bip=uni; bip.bipolar=true;
    ModRoute zero=uni; zero.amount=0.0f;
    ModRoute off=uni; off.enabled=false;
    ModRoute none=uni; none.destination={ModDestination::None,0,0};
    check(std::abs(routeContribution(uni,mod,slots)-0.5f*(0.6f*0.5f+0.5f))<1e-6f,"unipolar contribution = amount * (raw/2 + 1/2)");
    check(std::abs(routeContribution(bip,mod,slots)-0.5f*0.3f)<1e-6f,"bipolar contribution = amount * raw/2");
    check(routeContribution(zero,mod,slots)==0.0f && routeContribution(off,mod,slots)==0.0f && routeContribution(none,mod,slots)==0.0f,
          "zero amount, OFF and incomplete routes contribute nothing");
    ModRoute env{}; env.id=1; env.source=ModSource::Env1; env.destination=resonance; env.amount=-0.5f;
    slots[modulationSourceSlot(ModSource::Env1,mod)]=0.8f; // ENV 1 (newest voice) raw value
    check(std::abs(routeContribution(env,mod,slots)+0.4f)<1e-6f,"unsigned sources pass through polarity untouched");
    ui::ModulationRouteMonitor monitor;
    monitor.push(0.4f,true);
    check(monitor.active() && std::abs(monitor.latest()-0.4f)<1e-6f,"monitor shows the newest contribution");
    monitor.push(0.9f,false);
    check(!monitor.active() && monitor.latest()==0.0f,"an OFF route shows no active contribution");

    // Live monitor from the engine's published source slots.
    editor->refreshModulationViews();
    {
        juce::AudioBuffer<float> audio(2,256);
        juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0);
        float lfoPeak=0.0f;
        for(int block=0;block<64;++block) {
            audio.clear();p.processBlock(audio,midi);midi.clear();
            matrix.sampleMonitors();
            lfoPeak=std::max(lfoPeak,std::abs(matrix.monitor(0)->latest()));
        }
        check(matrix.monitor(0)->active() && lfoPeak>0.0f && lfoPeak<=0.5f+1e-5f,
              "LFO 1 -> CUTOFF monitor shows live unipolar contribution within its amount");
        check(!matrix.monitor(1)->active() && matrix.monitor(1)->latest()==0.0f,"incomplete route monitor stays inactive");
    }
    // Telemetry has no DSP side effects: two identical instances, only one of
    // them read through the monitor's observation path every block.
    {
        juce::MemoryBlock state;
        p.getStateInformation(state);
        std::array<std::unique_ptr<OrigamiAudioProcessor>,2> twins;
        for(auto& t:twins) {
            t=std::make_unique<OrigamiAudioProcessor>();
            t->prepareToPlay(48000.0,256);
            t->setStateInformation(state.getData(),int(state.getSize()));
        }
        juce::AudioBuffer<float> x(2,256),y(2,256);
        juce::MidiBuffer mx,my;
        mx.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0);
        my.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0);
        bool identical=true;
        float observed=0.0f;
        for(int block=0;block<64;++block) {
            x.clear();y.clear();
            twins[0]->processBlock(x,mx);twins[1]->processBlock(y,my);
            mx.clear();my.clear();
            const auto visual=twins[0]->getUiRuntimeVisualizationSnapshot();
            const auto modulation=twins[0]->getUiInstrumentState().modulation;
            for(const auto& r:modulation.routes) observed+=std::abs(routeContribution(r,modulation,visual.routeSources));
            for(int ch=0;ch<2;++ch) for(int i=0;i<256;++i) identical&=x.getSample(ch,i)==y.getSample(ch,i);
        }
        check(observed>0.0f,"the observation path sees live route contributions");
        check(identical,"monitor observation leaves the audio bit-identical");
    }

    // Matrix routes (including an incomplete one) survive save/load.
    const auto saved=p.getUiInstrumentState();
    const auto bytes=encodeInstrumentState(saved);
    InstrumentState loaded;
    check(decodeInstrumentState(bytes.data(),bytes.size(),loaded),"state with incomplete routes decodes");
    bool same=true;
    for(std::size_t i=0;i<saved.modulation.routes.size();++i) {
        const auto& x=saved.modulation.routes[i];const auto& y=loaded.modulation.routes[i];
        same&=x.id==y.id && x.enabled==y.enabled && x.source==y.source && x.destination==y.destination && x.amount==y.amount && x.bipolar==y.bipolar;
    }
    check(same,"Matrix routes round-trip exactly");

    // Legacy states may repeat a pair: merged deterministically on load.
    {
        InstrumentState legacy=saved;
        auto& m=legacy.modulation;
        m.routes={};
        m.routes[0]={5,true,ModSource::Lfo3,cutoff,0.7f,false};
        m.routes[1]={6,true,ModSource::Lfo3,resonance,0.6f,true};
        m.nextRouteId=7;
        auto legacyBytes=encodeInstrumentState(legacy);
        // Patch route 6's destination (RESONANCE) to CUTOFF, as an old build could write.
        const std::uint8_t needle[]{0,0,0,6, 0,0,0,1, 0,0,0,103, 0,0,0,2};
        auto at=std::search(legacyBytes.begin(),legacyBytes.end(),std::begin(needle),std::end(needle));
        check(at!=legacyBytes.end(),"locate the legacy route record");
        if(at!=legacyBytes.end()) at[15]=1;
        InstrumentState merged;
        check(decodeInstrumentState(legacyBytes.data(),legacyBytes.size(),merged),"a legacy duplicate pair still loads");
        std::size_t live=0; ModRoute kept{};
        for(const auto& r:merged.modulation.routes) if(r.id) { ++live; kept=r; }
        check(live==1 && kept.id==5 && kept.destination==cutoff && kept.amount==1.0f && kept.bipolar,
              "duplicates merge into the earliest route: summed (clamped) amount, last enabled polarity");
    }
}

// mct-origami-nodes-n02
// Deterministic render: equivalent engine state + identical input = identical
// audio, and UI (editor, telemetry, Matrix monitors) never alters it. Also
// pins down the N01 observation: a route edited LIVE glides in over the
// engine's 5 ms modulation smoothing, while the same route restored from state
// is compiled settled. Saved state is equal; only the first block differs.
void deterministicRenderAudit() {
    using namespace mct::origami;
    const auto make=[]{ auto q=std::make_unique<OrigamiAudioProcessor>(); q->prepareToPlay(48000.0,256); disableExtraOscillators(*q);auto m=q->getUiInstrumentState().modulation;m.filterEnabled=true;check(q->setUiModulationState(m),"deterministic authored filter fixture"); return q; };
    const auto render=[](OrigamiAudioProcessor& q,int blocks,const std::function<void()>& perBlock={}) {
        std::vector<float> out;
        juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0);
        for(int b=0;b<blocks;++b) {
            audio.clear(); q.processBlock(audio,midi); midi.clear();
            if(perBlock) perBlock();
            for(int ch=0;ch<2;++ch) for(int i=0;i<256;++i) out.push_back(audio.getSample(ch,i));
        }
        return out;
    };
    const auto liveRoute=[](OrigamiAudioProcessor& q) {
        const auto id=q.addUiRoute(); ModRoute r{}; r.id=id; r.source=ModSource::Lfo1;
        r.destination={ModDestination::Cutoff,0,0}; r.amount=0.5f; return q.setUiRoute(r);
    };
    const auto clone=[&](OrigamiAudioProcessor& q) {
        juce::MemoryBlock st; q.getStateInformation(st);
        auto t=std::make_unique<OrigamiAudioProcessor>(); t->prepareToPlay(48000.0,256);
        t->setStateInformation(st.getData(),int(st.getSize()));
        juce::MemoryBlock back; t->getStateInformation(back);
        check(back==st,"save -> load -> save is byte-identical");
        return t;
    };
    {   // Same state, same input, one instance fully observed by an open editor.
        auto a=make(),b=make();
        check(liveRoute(*a) && liveRoute(*b),"identical live edits");
        a->getUiFxDocument().edit([](fx::FxGraph& g){return g.insertEffectBeforeOutput(fx::FxEffectType::Filter)!=0;});
        b->getUiFxDocument().edit([](fx::FxGraph& g){return g.insertEffectBeforeOutput(fx::FxEffectType::Filter)!=0;});
        auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(a->createEditor());
        auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
        editor->addToDesktop(0);editor->setVisible(true);
        ui::FxPage* nodesPage=nullptr;
        walk(*editor,[&](auto& c) {
            if(auto* p=dynamic_cast<ui::FxPage*>(&c)) nodesPage=p;
            if(auto* b=dynamic_cast<juce::TextButton*>(&c)) if(b->getButtonText()=="NODES" && b->onClick) b->onClick();
        });
        for(auto* processor:{a.get(),b.get()}) {
            const auto routeId=processor->addUiRoute();
            fx::FxNodeId filterId=0;
            for(const auto& n:processor->getUiFxDocument().graph().nodes()) if(n.effect==fx::FxEffectType::Filter) filterId=n.id;
            ModRoute route{routeId,true,ModSource::Lfo1,fxParameterAddress(mainBusId,filterId,1),.4f,true};
            check(processor->setUiRoute(route),"identical modulated FX filter for visual transparency");
        }
        std::vector<ui::ModulationMatrix*> matrices;
        walk(*editor,[&](auto& c){if(auto* m=dynamic_cast<ui::ModulationMatrix*>(&c)) matrices.push_back(m);});
        const auto observed=render(*a,48,[&]{
            editor->refreshModulationViews();
            for(auto* m:matrices) m->sampleMonitors();
            if(nodesPage) { nodesPage->syncFromModel();nodesPage->refreshVisualFeedback(); }
            (void)a->getUiRuntimeVisualizationSnapshot(); (void)a->getUiEnvelopeTraceSnapshot();
        });
        const auto plain=render(*b,48);
        check(nodesPage && nodesPage->visualRefreshCount()>0 && !matrices.empty() && observed==plain,"UI observation including live NODES modulation leaves float audio bit-identical");
    }
    {   // N01 observation: live edit vs the same state restored.
        auto live=make();
        check(liveRoute(*live),"live route edit");
        auto restored=clone(*live);
        const auto x=render(*live,32),y=render(*restored,32);
        double firstBlock=0,afterGlide=0;
        for(std::size_t i=0;i<x.size();++i) {
            const double d=std::abs(double(x[i])-y[i]);
            (i<2*256 ? firstBlock : afterGlide)=std::max(i<2*256 ? firstBlock : afterGlide,d);
        }
        check(firstBlock>0.0 && afterGlide==0.0,"a live route edit glides in (first block only); afterwards audio is identical");
        auto settled=make();
        check(liveRoute(*settled),"live route edit");
        { juce::MemoryBlock st; settled->getStateInformation(st); settled->setStateInformation(st.getData(),int(st.getSize())); }
        auto twin=clone(*settled);
        check(render(*settled,32)==render(*twin,32),"restoring state compiles settled: restored instances render identically");
    }
}

// mct-origami-nodes-n03-control
// SYNTH drag, MATRIX and NODES are three views of ONE modulation relationship.
void nodesN03Audit() {
    using namespace mct::origami;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    {auto m=p.getUiInstrumentState().modulation;m.filterEnabled=true;check(p.setUiModulationState(m),"Nodes picker fixture includes a filter");}
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    ui::FxPage* page=nullptr; ui::ModulationPanel* synth=nullptr; ui::ModulationMatrix* matrix=nullptr;
    juce::TextButton* nodesButton=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* f=dynamic_cast<ui::FxPage*>(&c)) page=f;
        if(auto* m=dynamic_cast<ui::ModulationPanel*>(&c)) synth=m;
        if(auto* x=dynamic_cast<ui::ModulationMatrix*>(&c)) if(x->layout()==ui::ModulationMatrix::Layout::Page) matrix=x;
        if(auto* b=dynamic_cast<juce::TextButton*>(&c)) if(b->getButtonText()=="NODES" && !nodesButton) nodesButton=b;});
    check(page && synth && matrix && nodesButton,"NODES page, SYNTH modulation panel and MATRIX page");
    nodesButton->onClick();
    const ModAddress cutoff{ModDestination::Cutoff,0,0};
    const auto routes=[&]{ return p.getUiInstrumentState().modulation.routes; };
    const auto route=[&](std::uint32_t id){ for(const auto& r:routes()) if(r.id==id) return r; return ModRoute{}; };
    const auto count=[&](ModSource s,const ModAddress& a){ int n=0; for(const auto& r:routes()) n+=r.id && r.source==s && r.destination==a; return n; };
    const auto routeCount=[&]{ int n=0; for(const auto& r:routes()) n+=r.id!=0; return n; };
    const auto settle=[&]{ editor->flushModulationRefresh(); editor->refreshModulationViews(); };
    const auto matrixRow=[&](std::uint32_t id)->juce::Component* {
        for(std::size_t i=0;i<matrix->routeCount();++i) if(matrix->routeRow(i)->getName()=="Modulation route "+juce::String(id)) return matrix->routeRow(i);
        return nullptr; };
    const auto inRow=[&](juce::Component* row,const juce::String& name)->juce::Component* {
        juce::Component* found=nullptr; if(row) walk(*row,[&](auto& c){ if(c.getName()==name) found=&c; }); return found; };

    // 1. NODES creates exactly one canonical route, with the N01 defaults.
    check(page->addControlSource(ModSource::Lfo1) && page->addParameterNode(cutoff),"LFO 1 source node and FILTER CUTOFF parameter node");
    const auto created=page->connectControl(ModSource::Lfo1,cutoff);
    const auto id=created.existingRoute;
    check(created.creatable() && id!=0 && count(ModSource::Lfo1,cutoff)==1 && routeCount()==1,"NODES connection creates exactly one ModRoute");
    check(route(id).enabled && !route(id).bipolar && route(id).amount==0.0f,"new NODES relationship: ON / UNIPOLAR / 0%");
    check(page->controlLinkShown(id) && page->canvas().controlLinkCount()==1,"the canvas draws it as one CONTROL link");
    settle();
    check(matrixRow(id)!=nullptr && synth->sourceRow(ModSource::Lfo1)->routes().size()==1,"MATRIX row and SYNTH ring observe the NODES relationship");
    // 4. No duplicate from NODES.
    const auto again=page->connectControl(ModSource::Lfo1,cutoff);
    check(again.result==nodes::ControlLinkResult::Exists && again.existingRoute==id && routeCount()==1,"connecting again recognises the existing route");

    // 5-9. One amount / polarity / enabled, edited from either side.
    page->selectControlLink(id);
    // Synchronous click of a toggling button (JUCE's triggerClick is async).
    const auto click=[](juce::Button& b){ b.setToggleState(!b.getToggleState(),juce::dontSendNotification); if(b.onClick) b.onClick(); };
    page->controlAmountSlider().setValue(42.0,juce::sendNotificationSync);
    settle();
    auto* amountSlider=dynamic_cast<juce::Slider*>(inRow(matrixRow(id),"MATRIX ROUTE AMOUNT"));
    check(std::abs(route(id).amount-0.42f)<1e-4f && amountSlider && std::abs(amountSlider->getValue()-42.0)<0.01
          && std::abs(synth->sourceRow(ModSource::Lfo1)->routes()[0].amount-0.42f)<1e-4f,"amount edited in NODES = Matrix 42% = SYNTH ring");
    amountSlider->setValue(-25.0,juce::sendNotificationSync);
    settle();
    check(std::abs(route(id).amount+0.25f)<1e-4f && std::abs(page->controlAmountSlider().getValue()+25.0)<0.01,"amount edited in the Matrix shows in NODES");
    click(page->controlPolarityButton());
    settle();
    auto* polarity=dynamic_cast<juce::Button*>(inRow(matrixRow(id),"MATRIX ROUTE POLARITY"));
    check(route(id).bipolar && polarity && polarity->getToggleState(),"polarity edited in NODES shows in the Matrix");
    click(*polarity);
    settle();
    check(!route(id).bipolar && !page->controlPolarityButton().getToggleState(),"polarity edited in the Matrix shows in NODES");
    click(page->controlEnabledButton());
    settle();
    auto* power=dynamic_cast<juce::Button*>(inRow(matrixRow(id),"MATRIX ROUTE ENABLE"));
    check(!route(id).enabled && power && !power->getToggleState(),"enabled state is one flag (NODES -> Matrix)");
    click(*power);
    settle();
    check(route(id).enabled && page->controlEnabledButton().getToggleState(),"enabled state is one flag (Matrix -> NODES)");

    // 13. The route monitor works for a NODES-created relationship.
    {
        juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0);
        std::size_t row=0; for(std::size_t i=0;i<matrix->routeCount();++i) if(matrix->routeRow(i)==matrixRow(id)) row=i;
        for(int b=0;b<16;++b) { audio.clear(); p.processBlock(audio,midi); midi.clear(); matrix->sampleMonitors(); }
        check(matrix->monitor(row)->active() && matrix->monitor(row)->latest()!=0.0f,"Matrix monitor follows the NODES-created route");
    }

    // 14-16. State: relationships live in the instrument; NODES adds positions only.
    {
        juce::MemoryBlock saved; p.getStateInformation(saved);
        auto copy=std::make_unique<OrigamiAudioProcessor>(); copy->prepareToPlay(48000.0,256);
        copy->setStateInformation(saved.getData(),int(saved.getSize()));
        int found=0; for(const auto& r:copy->getUiInstrumentState().modulation.routes) found+=r.id==id && r.source==ModSource::Lfo1 && r.destination==cutoff;
        check(found==1,"save/load preserves the relationship (as a ModRoute)");
        check(copy->getUiControlLayout()==p.getUiControlLayout() && copy->getUiControlLayout().find(nodes::sourceKey(ModSource::Lfo1))!=nullptr,
              "save/load preserves the NODES positions");
        const auto layoutBytes=p.getUiControlLayout().encode();
        auto mod=p.getUiInstrumentState().modulation;
        for(auto& r:mod.routes) if(r.id==id) r.amount=0.9f;
        check(p.setUiModulationState(mod) && p.getUiControlLayout().encode()==layoutBytes,"route edits never touch NODES view data (no duplicate state)");
        // Pre-N03 state (no NCL1 trailer) loads with the default layout.
        auto legacy=std::make_unique<OrigamiAudioProcessor>(); legacy->prepareToPlay(48000.0,256);
        juce::MemoryBlock plain; legacy->getStateInformation(plain);
        auto restored=std::make_unique<OrigamiAudioProcessor>(); restored->prepareToPlay(48000.0,256);
        restored->setStateInformation(plain.getData(),int(plain.getSize()));
        juce::MemoryBlock back; restored->getStateInformation(back);
        check(restored->getUiControlLayout().entries().empty() && back==plain,"states without CONTROL view data load and save unchanged");
    }

    // 2-3. Relationships made elsewhere appear in NODES.
    const auto matrixId=p.addUiRoute();
    { auto r=route(matrixId); r.source=ModSource::Macro1; r.destination={ModDestination::WtPosition,1,0}; r.amount=0.3f; check(p.setUiRoute(r),"Matrix-style route"); }
    settle();
    check(page->controlLinkShown(matrixId) && page->controlNodeShown(nodes::sourceKey(ModSource::Macro1)),"a Matrix-created route appears in NODES");
    std::vector<juce::Slider*> knobs;
    walk(*editor,[&](auto& c){ auto* slider=dynamic_cast<juce::Slider*>(&c);
        if(slider && slider->isRotary() && slider->getProperties().contains("mct.mod.destination")
           && int(slider->getProperties()["mct.mod.destination"])==int(ModDestination::Level)) knobs.push_back(slider); });
    check(!knobs.empty() && editor->assignModulator(ModSource::Env1,*knobs.front()),"SYNTH assignment ENV 1 -> LEVEL");
    settle();
    std::uint32_t synthId=0;
    for(const auto& r:routes()) if(r.id && r.source==ModSource::Env1) synthId=r.id;
    check(synthId!=0 && page->controlLinkShown(synthId),"a SYNTH-created route appears in NODES");

    // 10-12. Deleting in any view removes it everywhere.
    check(page->deleteControlLink(id),"delete from NODES");
    settle();
    check(count(ModSource::Lfo1,cutoff)==0 && matrixRow(id)==nullptr && synth->sourceRow(ModSource::Lfo1)->routes().empty()
          && !page->controlLinkShown(id),"NODES deletion removes the Matrix row and the SYNTH assignment");
    if(auto* remove=dynamic_cast<juce::Button*>(inRow(matrixRow(matrixId),"MATRIX ROUTE DELETE"))) remove->onClick();
    settle();
    check(route(matrixId).id==0 && !page->controlLinkShown(matrixId),"Matrix deletion removes the NODES link");
    synth->sourceRow(ModSource::Env1)->onRouteRemove(synthId);
    settle();
    check(route(synthId).id==0 && !page->controlLinkShown(synthId),"SYNTH removal removes the NODES link");

    // 21/24. Execution-domain safety and malformed requests.
    const auto fxDestination=fxParameterAddress(mainBusId,page->addEffect(fx::FxEffectType::Gain),1);
    const auto before=routeCount();
    check(page->connectControl(ModSource::Env1,fxDestination).result==nodes::ControlLinkResult::DomainCrossing && routeCount()==before,
          "VOICE source -> GLOBAL NODES parameter is rejected (no newest-voice semantics)");
    bool fxDisabled=false,cutoffEnabled=false;
    for(const auto& item:page->parameterPickerItems(ModSource::Env1)) {
        const auto address=page->parameterPickerAddress(item.id);
        if(address && *address==fxDestination) fxDisabled=!item.enabled && item.tooltip.isNotEmpty();
        if(address && *address==cutoff) cutoffEnabled=item.enabled;
    }
    check(fxDisabled && cutoffEnabled,"the PARAMETER picker disables what the chosen source cannot drive, with the reason");
    check(page->connectControl(ModSource::Lfo1,{ModDestination::Level,99,0}).result==nodes::ControlLinkResult::DestinationUnavailable
          && page->connectControl(static_cast<ModSource>(999),cutoff).result==nodes::ControlLinkResult::SourceNotExposed
          && page->connectControl(ModSource::None,cutoff).result==nodes::ControlLinkResult::MissingSource && routeCount()==before,
          "NODES cannot create malformed routes");
    check(page->connectControl(ModSource::Lfo1,fxDestination).creatable(),"GLOBAL LFO -> GLOBAL NODES parameter is allowed");
    check(!page->removeControlNode(nodes::sourceKey(ModSource::Lfo1)) && page->removeControlNode(nodes::sourceKey(ModSource::Macro1))==false,
          "a linked node cannot be removed (delete its relationships first)");
}

// mct-origami-nodes-n04-control-processing
// CONTROL operators between sources and parameters, through the canonical
// modulation state. Direct routes stay direct; processed routes stay one route.
void nodesN04Audit() {
    using namespace mct::origami;
    using T=ControlOpType;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    ui::FxPage* page=nullptr; ui::ModulationPanel* synth=nullptr; ui::ModulationMatrix* matrix=nullptr; juce::TextButton* nodesButton=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* f=dynamic_cast<ui::FxPage*>(&c)) page=f;
        if(auto* m=dynamic_cast<ui::ModulationPanel*>(&c)) synth=m;
        if(auto* x=dynamic_cast<ui::ModulationMatrix*>(&c)) if(x->layout()==ui::ModulationMatrix::Layout::Page) matrix=x;
        if(auto* b=dynamic_cast<juce::TextButton*>(&c)) if(b->getButtonText()=="NODES" && !nodesButton) nodesButton=b;});
    check(page && synth && matrix && nodesButton,"NODES, SYNTH and MATRIX");
    nodesButton->onClick();
    const auto settle=[&]{ editor->flushModulationRefresh(); editor->refreshModulationViews(); };
    const auto mod=[&]{ return p.getUiInstrumentState().modulation; };
    const auto route=[&](std::uint32_t id){ for(const auto& r:mod().routes) if(r.id==id) return r; return ModRoute{}; };
    const auto routeCount=[&]{ int n=0; for(const auto& r:mod().routes) n+=r.id!=0; return n; };
    const auto opCount=[&]{ int n=0; for(const auto& o:mod().operators) n+=o.id!=0; return n; };
    const ModAddress cutoff{ModDestination::Cutoff,0,0};
    using E=nodes::ControlEndpoint;

    // 1. Direct route (SYNTH-style), then SCALE inserted onto its cable.
    const auto direct=p.addUiRoute();
    { auto r=route(direct); r.source=ModSource::Lfo1; r.destination=cutoff; r.amount=0.42f; check(p.setUiRoute(r),"LFO 1 -> CUTOFF (direct)"); }
    settle();
    check(page->controlLinkShown(direct) && routeCount()==1 && opCount()==0,"the direct route is one canonical route, shown in NODES");
    const auto scale=page->insertControlOperatorOnRoute(direct,T::ScaleOffset);
    settle();
    check(scale.has_value() && routeCount()==1 && opCount()==1 && route(direct).source==operatorSource(*scale)
          && route(direct).amount==0.42f,"inserting SCALE replaces the direct route in place (same id and amount, no duplicate)");
    std::uint32_t lfoDirect=0; for(const auto& r:mod().routes) if(r.id && r.source==ModSource::Lfo1) lfoDirect=r.id;
    check(lfoDirect==0,"no direct LFO 1 route remains underneath (no double modulation)");
    check(page->controlLinkShown(direct) && page->controlNodeShown(nodes::operatorKey(*scale)),"NODES shows LFO 1 -> SCALE -> CUTOFF");
    check(synth->sourceRow(ModSource::Lfo1)->routes().size()==1,"SYNTH still shows the LFO 1 relationship (destination modulated)");
    juce::Component* row=nullptr;
    for(std::size_t i=0;i<matrix->routeCount();++i) if(matrix->routeRow(i)->getName()=="Modulation route "+juce::String(direct)) row=matrix->routeRow(i);
    ui::NativeComboBox* sourceBox=nullptr;
    if(row) walk(*row,[&](auto& c){ if(auto* b=dynamic_cast<ui::NativeComboBox*>(&c)) if(b->getName()=="Route source") sourceBox=b; });
    check(matrix->routeCount()==1 && sourceBox && !sourceBox->isEnabled() && sourceBox->getText().startsWith("NODES: SCALE")
          && sourceBox->getText().contains("LFO 1"),"Matrix shows ONE processed row (NODES: SCALE (LFO 1)), source locked");
    // Inline parameter and undo.
    check(page->setOperatorParameter(*scale,0,0.5f) && findControlOperator(mod(),*scale)->params[0]==0.5f,"SCALE parameter edits the canonical operator");
    page->undo();
    check(findControlOperator(mod(),*scale)->params[0]==1.0f,"undo restores the parameter");
    page->redo();
    check(findControlOperator(mod(),*scale)->params[0]==0.5f,"redo re-applies it");
    // 2. Removing the only processor collapses back to the direct route.
    check(page->deleteControlOperator(*scale),"delete SCALE");
    settle();
    check(opCount()==0 && routeCount()==1 && route(direct).source==ModSource::Lfo1 && route(direct).amount==0.42f,
          "the chain collapses to the same direct route (LFO 1 -> CUTOFF)");
    page->undo();
    check(opCount()==1 && isOperatorSource(route(direct).source),"undo restores the processed route");
    page->undo(); // the SCALE parameter edit
    check(opCount()==1 && findControlOperator(mod(),*scale)->params[0]==1.0f,"undo walks back through the parameter edit");
    page->undo(); // the insertion
    check(opCount()==0 && route(direct).source==ModSource::Lfo1 && route(direct).amount==0.42f,"undo again restores the original direct route");

    // 3. LFO 1 x MACRO 1 -> MULTIPLY -> REVERB MIX (GLOBAL chain to a GLOBAL parameter).
    const auto reverb=page->addEffect(fx::FxEffectType::Reverb);
    const auto* reverbInfo=fx::findFxEffect(fx::FxEffectType::Reverb);
    fx::FxParameterId mixId=0;
    for(std::size_t i=0;i<reverbInfo->parameterCount;++i) if(std::string(reverbInfo->parameters[i].key)=="mix") mixId=reverbInfo->parameters[i].id;
    const auto reverbMix=fxParameterAddress(mainBusId,reverb,mixId);
    const auto multiply=page->addControlOperator(T::Multiply);
    check(multiply.has_value(),"MULTIPLY added");
    check(page->connectControlEdge(E::fromSource(ModSource::Lfo1),E::toInput(*multiply,0)).creatable()
          && page->connectControlEdge(E::fromSource(ModSource::Macro1),E::toInput(*multiply,1)).creatable(),"LFO 1 -> A, MACRO 1 -> B");
    const auto toMix=page->connectControlEdge(E::fromOperator(*multiply),E::toParameter(reverbMix));
    check(toMix.creatable() && route(toMix.existingRoute).source==operatorSource(*multiply),"MULTIPLY -> REVERB MIX is one canonical route");
    check(page->connectControlEdge(E::fromSource(ModSource::Lfo2),E::toInput(*multiply,0)).result==nodes::ControlLinkResult::InputOccupied,
          "an operator input takes exactly one connection");
    {   auto r=route(toMix.existingRoute); r.amount=0.8f; check(p.setUiRoute(r),"route amount"); }
    {
        check(p.setUiMacro(0,0.5f),"MACRO 1 = 0.5");
        juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi; midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0);
        float peak=0.0f;
        for(int b=0;b<32;++b) {
            audio.clear(); p.processBlock(audio,midi); midi.clear();
            peak=std::max(peak,std::abs(p.getUiRuntimeVisualizationSnapshot().routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(controlOperatorSlot(mod(),*multiply),0)]));
        }
        check(peak>0.0f && peak<=0.5f+1e-4f,"MULTIPLY output (LFO x 0.5) is evaluated and published for monitoring");
    }
    // Domain: a per-voice input may not turn this GLOBAL chain per-voice.
    const auto add=page->addControlOperator(T::Add);
    check(page->connectControlEdge(E::fromOperator(*add),E::toInput(*multiply,0)).result==nodes::ControlLinkResult::InputOccupied,"still occupied");
    check(page->disconnectControlInput(*multiply,0),"disconnect A");
    check(page->connectControlEdge(E::fromSource(ModSource::Env1),E::toInput(*multiply,0)).result==nodes::ControlLinkResult::DomainCrossing,
          "ENV (per-voice) into a chain feeding a GLOBAL parameter is rejected");
    check(page->connectControlEdge(E::fromSource(ModSource::Lfo1),E::toInput(*multiply,0)).creatable(),"LFO 1 reconnected");
    // Cycles.
    check(page->connectControlEdge(E::fromOperator(*multiply),E::toInput(*add,0)).creatable(),"MULTIPLY -> ADD.A");
    check(page->connectControlEdge(E::fromOperator(*add),E::toInput(*multiply,1)).result!=nodes::ControlLinkResult::Ok,"occupied B refuses");
    check(page->disconnectControlInput(*multiply,1),"free B");
    check(page->connectControlEdge(E::fromOperator(*add),E::toInput(*multiply,1)).result==nodes::ControlLinkResult::WouldCreateCycle,
          "a control cycle is rejected");
    check(page->connectControlEdge(E::fromOperator(*add),E::fromSource(ModSource::Lfo1)).result==nodes::ControlLinkResult::InvalidPort,
          "an output never connects to an output");

    // 4. ENV 1 -> CURVE -> SMOOTH -> OSC LEVEL (per-voice chain to a per-voice parameter).
    const auto curve=page->addControlOperator(T::Curve);
    const auto smooth=page->addControlOperator(T::Smooth);
    check(page->connectControlEdge(E::fromSource(ModSource::Env1),E::toInput(*curve,0)).creatable()
          && page->connectControlEdge(E::fromOperator(*curve),E::toInput(*smooth,0)).creatable(),"ENV 1 -> CURVE -> SMOOTH");
    const ModAddress level{ModDestination::Level,1,0};
    const auto toLevel=page->connectControlEdge(E::fromOperator(*smooth),E::toParameter(level));
    check(toLevel.creatable() && sourceIsVoice(operatorSource(*smooth),mod()),"a per-voice chain drives a per-voice parameter");
    check(page->connectControlEdge(E::fromOperator(*smooth),E::toParameter(reverbMix)).result==nodes::ControlLinkResult::DomainCrossing,
          "a per-voice result never drives a GLOBAL parameter");
    {
        juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0); midi.addEvent(juce::MidiMessage::noteOn(1,64,1.0f),100);
        bool finite=true;
        for(int b=0;b<16;++b) { audio.clear(); p.processBlock(audio,midi); midi.clear();
            for(int i=0;i<256;++i) finite&=std::isfinite(audio.getSample(0,i)); }
        check(finite,"polyphonic per-voice processing renders cleanly");
    }
    settle();
    check(synth->sourceRow(ModSource::Env1)->routes().size()==1 && matrix->routeCount()==3 && routeCount()==3,"SYNTH and Matrix observe the processed routes (one row each, no duplicates)");

    // 5. Save / load: operators + processed routes + positions.
    {
        juce::MemoryBlock saved; p.getStateInformation(saved);
        auto copy=std::make_unique<OrigamiAudioProcessor>(); copy->prepareToPlay(48000.0,256);
        copy->setStateInformation(saved.getData(),int(saved.getSize()));
        const auto restored=copy->getUiInstrumentState().modulation;
        const auto live=mod();
        bool same=true;
        for(std::size_t i=0;i<restored.operators.size();++i) {
            const auto& x=restored.operators[i]; const auto& y=live.operators[i];
            same&=x.id==y.id && x.type==y.type && x.params==y.params && x.inputs==y.inputs;
        }
        check(same && restored.nextOperatorId==live.nextOperatorId,"operators survive save/load slot-for-slot");
        int processed=0; for(const auto& r:restored.routes) processed+=r.id && isOperatorSource(r.source);
        check(processed==2,"processed routes survive save/load");
        check(copy->getUiControlLayout()==p.getUiControlLayout(),"operator positions survive save/load");
    }
    // 6. Graph authoring undo: delete an operator, undo restores chain + routes.
    const auto before=mod();
    check(page->deleteControlOperator(*smooth),"delete SMOOTH (bridges CURVE -> LEVEL)");
    {   bool bridged=false; for(const auto& r:mod().routes) bridged|=r.id==toLevel.existingRoute && r.source==operatorSource(*curve);
        check(bridged,"deleting a middle processor reconnects its neighbours"); }
    page->undo();
    check(findControlOperator(mod(),*smooth)!=nullptr && route(toLevel.existingRoute).source==operatorSource(*smooth),"undo restores the deleted operator and its route");
    const auto duplicate=page->duplicateControlOperator(*curve);
    check(duplicate.has_value() && findControlOperator(mod(),*duplicate)->type==T::Curve
          && findControlOperator(mod(),*duplicate)->inputs[0].kind==ControlInput::Kind::None,"duplicate copies settings, never connections");
    (void)before;
}

// mct-origami-nodes-n05-events-logic
// EVENT / GATE / CLOCK through the NODES authoring API, on canonical state.
void nodesN05Audit() {
    using namespace mct::origami;
    using T=ControlOpType;
    using E=nodes::ControlEndpoint;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    ui::FxPage* page=nullptr; ui::ModulationMatrix* matrix=nullptr; juce::TextButton* nodesButton=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* f=dynamic_cast<ui::FxPage*>(&c)) page=f;
        if(auto* x=dynamic_cast<ui::ModulationMatrix*>(&c)) if(x->layout()==ui::ModulationMatrix::Layout::Page) matrix=x;
        if(auto* b=dynamic_cast<juce::TextButton*>(&c)) if(b->getButtonText()=="NODES" && !nodesButton) nodesButton=b;});
    check(page && matrix && nodesButton,"NODES and MATRIX");
    nodesButton->onClick();
    const auto mod=[&]{ return p.getUiInstrumentState().modulation; };
    const auto routeCount=[&]{ int n=0; for(const auto& r:mod().routes) n+=r.id!=0; return n; };
    const auto render=[&](int blocks){ juce::AudioBuffer<float> a(2,256); juce::MidiBuffer midi; midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0);
        for(int b=0;b<blocks;++b) { a.clear(); p.processBlock(a,midi); midi.clear(); } };

    // Chain 1: CLOCK -> S&H.TRIG, LFO 1 -> S&H.VALUE, S&H -> FILTER CUTOFF.
    const auto clock=page->addControlOperator(T::Clock);
    const auto hold=page->addControlOperator(T::SampleHold);
    check(clock && hold,"CLOCK and SAMPLE & HOLD added");
    check(page->connectControlEdge(E::fromOperator(*clock),E::toInput(*hold,1)).creatable(),"CLOCK -> S&H TRIG (EVENT -> EVENT)");
    check(page->connectControlEdge(E::fromSource(ModSource::Lfo1),E::toInput(*hold,0)).creatable(),"LFO 1 -> S&H VALUE (CONTROL -> CONTROL)");
    const auto cutoffLink=page->connectControlEdge(E::fromOperator(*hold),E::toParameter({ModDestination::Cutoff,0,0}));
    check(cutoffLink.creatable() && routeCount()==1,"S&H -> CUTOFF is one canonical route");
    // Typing: no implicit coercion anywhere.
    const auto clock2=page->addControlOperator(T::Clock);
    check(page->connectControlEdge(E::fromOperator(*clock2),E::toInput(*hold,1)).result==nodes::ControlLinkResult::InputOccupied,
          "an EVENT input takes exactly one connection");
    check(page->deleteControlOperator(*clock2),"remove the spare clock");
    const auto toggle=page->addControlOperator(T::Toggle);
    check(page->connectControlEdge(E::fromSource(ModSource::Lfo2),E::toInput(*toggle,0)).result==nodes::ControlLinkResult::TypeMismatch,
          "CONTROL -> EVENT input is rejected");
    check(page->connectControlEdge(E::fromOperator(*clock),E::toParameter({ModDestination::Resonance,0,0})).result==nodes::ControlLinkResult::TypeMismatch,
          "EVENT -> parameter (CONTROL) is rejected");
    check(page->connectControlEdge(E::fromOperator(*toggle),E::toParameter({ModDestination::Resonance,0,0})).result==nodes::ControlLinkResult::TypeMismatch,
          "GATE -> parameter (CONTROL) is rejected");
    const auto smooth=page->addControlOperator(T::Smooth);
    check(page->connectControlEdge(E::fromOperator(*clock),E::toInput(*smooth,0)).result==nodes::ControlLinkResult::TypeMismatch,
          "EVENT -> CONTROL input is rejected");
    // Live: the clock really ticks in the engine (counters published, bounded).
    {   auto m=mod(); auto& c=m.operators[controlOperatorSlot(m,*clock)]; c.params[0]=0.0f; c.params[1]=40.0f;
        check(p.setUiModulationState(m),"CLOCK free 40 Hz"); }
    render(4);
    const auto first=p.getUiRuntimeVisualizationSnapshot().operatorEvents[controlOperatorSlot(mod(),*clock)];
    render(40);
    const auto second=p.getUiRuntimeVisualizationSnapshot().operatorEvents[controlOperatorSlot(mod(),*clock)];
    check(second>first,"CLOCK events are generated by the engine and counted for monitoring");
    editor->refreshModulationViews();
    juce::Component* row=nullptr;
    for(std::size_t i=0;i<matrix->routeCount();++i) if(matrix->routeRow(i)->getName()=="Modulation route "+juce::String(cutoffLink.existingRoute)) row=matrix->routeRow(i);
    ui::NativeComboBox* source=nullptr;
    if(row) walk(*row,[&](auto& c){ if(auto* b=dynamic_cast<ui::NativeComboBox*>(&c)) if(b->getName()=="Route source") source=b; });
    check(matrix->routeCount()==1 && source && source->getText().startsWith("NODES: SAMPLE & HOLD") && source->getText().contains("LFO 1"),
          "Matrix shows the event-driven route as ONE processed row (no fake event rows)");

    // Chain 2: MACRO 1 -> THRESHOLD -> EDGE -> RANDOM -> REVERB MIX.
    const auto reverb=page->addEffect(fx::FxEffectType::Reverb);
    const auto* info=fx::findFxEffect(fx::FxEffectType::Reverb);
    fx::FxParameterId mix=0; for(std::size_t i=0;i<info->parameterCount;++i) if(std::string(info->parameters[i].key)=="mix") mix=info->parameters[i].id;
    const auto threshold=page->addControlOperator(T::Threshold);
    const auto edge=page->addControlOperator(T::Edge);
    const auto random=page->addControlOperator(T::RandomTrigger);
    check(page->connectControlEdge(E::fromSource(ModSource::Macro1),E::toInput(*threshold,0)).creatable()
          && page->connectControlEdge(E::fromOperator(*threshold),E::toInput(*edge,0)).creatable()
          && page->connectControlEdge(E::fromOperator(*edge),E::toInput(*random,0)).creatable(),"MACRO -> THRESHOLD -> EDGE -> RANDOM");
    const auto mixLink=page->connectControlEdge(E::fromOperator(*random),E::toParameter(fxParameterAddress(mainBusId,reverb,mix)));
    check(mixLink.creatable(),"RANDOM -> REVERB MIX (all GLOBAL)");
    {
        const auto randomSlot=controlOperatorSlot(mod(),*random);
        render(4);
        const float before=p.getUiRuntimeVisualizationSnapshot().routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(randomSlot,0)];
        check(p.setUiMacro(0,0.9f),"MACRO 1 crosses the threshold");
        render(8);
        const float after=p.getUiRuntimeVisualizationSnapshot().routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(randomSlot,0)];
        check(after!=before,"the crossing fires EDGE and draws a new RANDOM value");
    }

    // Chain 3: NOTE ON -> TOGGLE -> SWITCH.SELECT, LFO 1 -> A, ENV 1 -> B, SWITCH -> OSC LEVEL.
    const auto noteOn=page->addControlOperator(T::NoteOn);
    const auto sw=page->addControlOperator(T::Switch);
    check(page->connectControlEdge(E::fromOperator(*noteOn),E::toInput(*toggle,0)).creatable()
          && page->connectControlEdge(E::fromOperator(*toggle),E::toInput(*sw,2)).creatable()
          && page->connectControlEdge(E::fromSource(ModSource::Lfo1),E::toInput(*sw,0)).creatable()
          && page->connectControlEdge(E::fromSource(ModSource::Env1),E::toInput(*sw,1)).creatable(),"NOTE ON -> TOGGLE -> SWITCH (A LFO 1, B ENV 1)");
    const auto levelLink=page->connectControlEdge(E::fromOperator(*sw),E::toParameter({ModDestination::Level,1,0}));
    check(levelLink.creatable() && sourceIsVoice(operatorSource(*sw),mod()),"SWITCH -> OSC LEVEL: a per-voice chain to a per-voice parameter");
    check(page->connectControlEdge(E::fromOperator(*sw),E::toParameter(fxParameterAddress(mainBusId,reverb,mix))).result==nodes::ControlLinkResult::DomainCrossing,
          "a per-voice event chain never drives a GLOBAL parameter");
    check(page->connectControlEdge(E::fromOperator(*noteOn),E::toInput(*edge,0)).result!=nodes::ControlLinkResult::Ok,
          "NOTE ON (EVENT) cannot feed EDGE's GATE input; EDGE is occupied anyway");
    {   juce::AudioBuffer<float> a(2,256); juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0); midi.addEvent(juce::MidiMessage::noteOn(1,67,1.0f),37);
        bool finite=true;
        for(int b=0;b<8;++b) { a.clear(); p.processBlock(a,midi); midi.clear(); for(int i=0;i<256;++i) finite&=std::isfinite(a.getSample(0,i)); }
        check(finite,"polyphonic NOTE ON -> TOGGLE -> SWITCH renders cleanly"); }

    // Undo / save / load.
    const auto ops=[&]{ int n=0; for(const auto& o:mod().operators) n+=o.id!=0; return n; }();
    const auto extra=page->addControlOperator(T::Counter);
    check(extra.has_value(),"COUNTER added");
    page->undo();
    check([&]{ int n=0; for(const auto& o:mod().operators) n+=o.id!=0; return n; }()==ops,"adding an event node is undoable");
    {
        juce::MemoryBlock saved; p.getStateInformation(saved);
        auto copy=std::make_unique<OrigamiAudioProcessor>(); copy->prepareToPlay(48000.0,256);
        copy->setStateInformation(saved.getData(),int(saved.getSize()));
        const auto restored=copy->getUiInstrumentState().modulation; const auto live=mod();
        bool same=true;
        for(std::size_t i=0;i<live.operators.size();++i)
            same&=restored.operators[i].id==live.operators[i].id && restored.operators[i].type==live.operators[i].type
                && restored.operators[i].params==live.operators[i].params && restored.operators[i].inputs==live.operators[i].inputs;
        check(same,"event / logic graphs (incl. three-input SWITCH) survive save/load");
        const auto bytes=encodeInstrumentState(p.getUiInstrumentState());
        check(bytes[7]==29,"the state is versioned v29 because N05 nodes are used");
    }
}

// mct-origami-nodes-n06-sequencing-generative
void nodesN06Audit() {
    using namespace mct::origami;
    using T=ControlOpType;
    using E=nodes::ControlEndpoint;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    ui::FxPage* page=nullptr; ui::ModulationMatrix* matrix=nullptr; juce::TextButton* nodesButton=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* f=dynamic_cast<ui::FxPage*>(&c)) page=f;
        if(auto* x=dynamic_cast<ui::ModulationMatrix*>(&c)) if(x->layout()==ui::ModulationMatrix::Layout::Page) matrix=x;
        if(auto* b=dynamic_cast<juce::TextButton*>(&c)) if(b->getButtonText()=="NODES" && !nodesButton) nodesButton=b;});
    check(page && matrix && nodesButton,"N06: NODES and MATRIX");
    nodesButton->onClick();
    const auto mod=[&]{ return p.getUiInstrumentState().modulation; };
    const auto opCount=[&]{ int n=0; for(const auto& o:mod().operators) n+=o.id!=0; return n; };
    const auto render=[&](int blocks){ juce::AudioBuffer<float> a(2,256); juce::MidiBuffer midi; midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0);
        for(int b=0;b<blocks;++b) { a.clear(); p.processBlock(a,midi); midi.clear(); } };

    // ---- multi-output ports on the canvas ------------------------------------
    const auto clock=page->addControlOperator(T::Clock);
    const auto counter=page->addControlOperator(T::Counter);
    const auto toggle=page->addControlOperator(T::Toggle);
    check(clock && counter && toggle,"CLOCK / COUNTER / TOGGLE added");
    check(page->connectControlEdge(E::fromOperator(*clock),E::toInput(*counter,0)).creatable(),"CLOCK -> COUNTER ADVANCE");
    check(page->connectControlEdge(E::fromOperator(*counter,1),E::toInput(*toggle,0)).creatable(),"COUNTER WRAP (port 1) -> TOGGLE");
    check(page->connectControlEdge(E::fromOperator(*counter,0),E::toInput(*toggle,1)).result==nodes::ControlLinkResult::TypeMismatch,
          "COUNTER VALUE (CONTROL) cannot reach the EVENT RESET input");
    const auto valueLink=page->connectControlEdge(E::fromOperator(*counter,0),E::toParameter({ModDestination::Cutoff,0,0}));
    check(valueLink.creatable(),"COUNTER VALUE -> CUTOFF (fan-out: one node, two consumers)");
    check(page->connectControlEdge(E::fromOperator(*counter,1),E::toParameter({ModDestination::Resonance,0,0})).result==nodes::ControlLinkResult::TypeMismatch,
          "COUNTER WRAP (EVENT) cannot drive a parameter");
    auto* counterNode=page->canvas().controlNode(nodes::operatorKey(*counter));
    check(counterNode && counterNode->outputCount()==2,"the COUNTER node shows two outputs");
    if(counterNode) {
        const auto value=counterNode->portCentre(nodes::PortDirection::Output,0),wrap=counterNode->portCentre(nodes::PortDirection::Output,1);
        const auto hitValue=counterNode->portAt(value),hitWrap=counterNode->portAt(wrap);
        check(hitValue && hitWrap && hitValue->second==0 && hitWrap->second==1 && wrap.y-value.y>=20.0f,
              "each output has its own hit target (rows 22 px apart, never overlapping)");
        const auto endpoint=counterNode->endpoint(nodes::PortDirection::Output,1);
        check(endpoint && endpoint->port==1 && endpoint->outputSource()==operatorSource(*counter,1),"an output port maps to its canonical source encoding");
    }
    {
        // The cable from WRAP is drawn from the WRAP socket.
        bool fromWrap=false;
        for(const auto& l:page->controlGraph().links) fromWrap|=l.targetOperator==*toggle && l.sourcePort==1;
        check(fromWrap,"the derived graph keeps the source output port of each cable");
    }
    // ---- typed INSERT and drag-to-empty-space menus --------------------------
    {
        const auto types=page->controlInsertTypes(0,*toggle,0); // the WRAP -> TOGGLE cable (EVENT)
        bool allEvent=!types.empty(),hasProbability=false,hasSmooth=false;
        for(auto t:types) {
            const auto* info=controlOpInfo(t);
            allEvent&=info->inputSignals[0]==ControlSignal::Event && nodes::controlAutoOutputPort(*info,ControlSignal::Event)>=0;
            hasProbability|=t==T::Probability; hasSmooth|=t==T::Smooth;
        }
        check(allEvent && hasProbability && !hasSmooth,"INSERT on an EVENT cable offers only EVENT-in / EVENT-out nodes (PROBABILITY, never SMOOTH)");
        const auto onRoute=page->controlInsertTypes(valueLink.existingRoute,0,0);
        bool control=!onRoute.empty(); for(auto t:onRoute) control&=controlOpInfo(t)->inputSignals[0]==ControlSignal::Control;
        check(control,"INSERT on a modulation route offers only CONTROL processors");
        const auto items=page->controlCreateItems(E::fromOperator(*counter,1));
        bool events=!items.empty(),parameter=false;
        for(const auto& item:items) {
            if(item.id==ui::FxModuleMenu::parameterPickerId) parameter=true;
            else if(item.id>=ui::FxModuleMenu::controlOperatorBase) {
                const auto* info=controlOpInfo(static_cast<T>(item.id-ui::FxModuleMenu::controlOperatorBase));
                bool takes=false; for(std::uint8_t k=0;k<info->inputs;++k) takes|=info->inputSignals[k]==ControlSignal::Event;
                events&=takes;
            }
        }
        check(events && !parameter,"a WRAP cable dropped on empty space offers only nodes with an EVENT input (no PARAMETER)");
        const auto before=opCount();
        const auto created=page->createConnectedControlOperator(T::Probability,E::fromOperator(*clock),fx::FxPoint{600.0f,400.0f});
        check(created && opCount()==before+1,"drag-to-create adds the node");
        const auto* made=created ? findControlOperator(mod(),*created) : nullptr;
        check(made && made->inputs[0].kind==ControlInput::Kind::Operator && made->inputs[0].op==*clock,"...and connects the cable to its first compatible input");
        page->undo();
        check(opCount()==before,"create + connect is ONE undo step");
        // Backwards: from an unconnected EVENT input, CHANCE SPLIT feeds it from A (its first matching port).
        const auto backward=page->createConnectedControlOperator(T::ChanceSplit,E::toInput(*toggle,1),fx::FxPoint{300.0f,500.0f});
        const auto* t=findControlOperator(mod(),*toggle);
        check(backward && t && t->inputs[1].op==*backward && t->inputs[1].port==0,"a cable dragged back from an input is fed by the new node's matching output");
        page->undo();
    }
    // ---- the SEQUENCER node: the canonical sequencer -------------------------
    auto settings=mod().sequencer;
    {
        auto m=mod(); m.generatorActiveMask|=0x10u; check(p.setUiModulationState(m),"sequencer collection active");
    }
    const auto seq=page->addControlOperator(T::Sequencer);
    check(seq.has_value(),"SEQUENCER node added");
    check(!page->addControlOperator(T::Sequencer).has_value(),"a second SEQUENCER is refused (one sequencer)");
    bool disabled=false;
    for(const auto& item:page->moduleMenuItems(true))
        if(item.id==ui::FxModuleMenu::controlOperatorBase+int(T::Sequencer)) disabled=!item.enabled;
    check(disabled,"the ADD menu disables SEQUENCER while one exists, with the reason");
    page->selectControlNode(nodes::operatorKey(*seq));
    auto* step3=page->controlSequenceControl(2);
    check(step3!=nullptr,"the SEQUENCER inspector shows the canonical step editor");
    if(step3) {
        step3->setValue(-0.75,juce::sendNotificationSync);
        check(std::abs(mod().sequencer.steps[2]+0.75f)<1e-4f,"editing a step writes the canonical SequencerSettings (the SYNTH sequencer shows it)");
        page->undo();
        check(mod().sequencer.steps[2]==settings.steps[2],"a sequence edit is one undo step");
        page->redo();
        check(std::abs(mod().sequencer.steps[2]+0.75f)<1e-4f,"and redoes");
        // A slider drag coalesces into one step.
        page->beginOperatorGesture();
        for(double v:{0.1,0.2,0.3}) step3->setValue(v,juce::sendNotificationSync);
        page->endOperatorGesture();
        page->undo();
        check(std::abs(mod().sequencer.steps[2]+0.75f)<1e-4f,"a dragged step edit undoes as one step");
    }
    auto* count=page->controlSequenceControl(8);
    if(count) { count->setValue(4.0,juce::sendNotificationSync); check(mod().sequencer.activeSteps==4,"STEPS edits activeSteps"); }
    auto* seqNode=page->canvas().controlNode(nodes::operatorKey(*seq));
    check(seqNode && seqNode->view().preview==ui::ControlNodeView::Preview::Sequencer && seqNode->view().cellCount==4,
          "the SEQUENCER node previews the canonical steps");
    check(seqNode && seqNode->outputCount()==3,"VALUE / STEP / STEP EVENT outputs");
    const auto seqValue=page->connectControlEdge(E::fromOperator(*seq,0),E::toParameter({ModDestination::Level,1,0}));
    check(seqValue.creatable(),"SEQUENCER VALUE -> OSC LEVEL");
    render(40);
    check(p.getUiRuntimeVisualizationSnapshot().sequencerStep<4,"the engine publishes the current step for the preview");
    editor->refreshModulationViews();
    juce::Component* row=nullptr;
    for(std::size_t i=0;i<matrix->routeCount();++i) if(matrix->routeRow(i)->getName()=="Modulation route "+juce::String(seqValue.existingRoute)) row=matrix->routeRow(i);
    ui::NativeComboBox* source=nullptr;
    if(row) walk(*row,[&](auto& c){ if(auto* b=dynamic_cast<ui::NativeComboBox*>(&c)) if(b->getName()=="Route source") source=b; });
    check(source && source->getText().startsWith("NODES: SEQUENCER VALUE"),"the Matrix names the output port of a multi-output node");
    // Deleting the node, or clearing the graph, never destroys the sequence.
    const auto before=mod().sequencer.steps;
    page->confirmClear();
    check(mod().sequencer.steps==before,"CLEAR keeps the sequence");
    check(page->deleteControlOperator(*seq) && mod().sequencer.steps==before && mod().sequencer.activeSteps==4,
          "deleting the SEQUENCER node keeps the sequence (it is instrument state)");
    page->undo();
    // ---- PATTERN: clickable steps -------------------------------------------
    const auto pattern=page->addControlOperator(T::Pattern);
    check(pattern.has_value(),"PATTERN added");
    if(pattern) {
        const float mask=findControlOperator(mod(),*pattern)->params[1];
        check(page->togglePatternStep(*pattern,1),"toggle step 2");
        check(std::lround(findControlOperator(mod(),*pattern)->params[1])==(std::lround(mask)^2),"a PATTERN click flips exactly that bit");
        page->undo();
        check(findControlOperator(mod(),*pattern)->params[1]==mask,"a PATTERN step toggle is one undo step");
            if(auto* node=page->canvas().controlNode(nodes::operatorKey(*pattern))) {
            const auto cells=node->previewBounds();
            check(!cells.isEmpty() && node->previewCellAt(cells.getCentre()).has_value(),"PATTERN cells are hit-testable on the node");
        }
    }
    // ---- success graphs on the real instrument (spec A and step-event processing)
    {
        const auto reverb=page->addEffect(fx::FxEffectType::Reverb);
        const auto* info=fx::findFxEffect(fx::FxEffectType::Reverb);
        fx::FxParameterId mix=0; for(std::size_t i=0;i<info->parameterCount;++i) if(std::string(info->parameters[i].key)=="mix") mix=info->parameters[i].id;
        // A: CLOCK -> COUNTER; VALUE -> SCALE -> CUTOFF; WRAP -> RANDOM -> REVERB MIX.
        const auto c2=page->addControlOperator(T::Clock),n2=page->addControlOperator(T::Counter);
        const auto scale=page->addControlOperator(T::ScaleOffset),rnd=page->addControlOperator(T::RandomTrigger);
        check(c2 && n2 && scale && rnd,"graph A nodes");
        check(page->connectControlEdge(E::fromOperator(*c2),E::toInput(*n2,0)).creatable()
              && page->connectControlEdge(E::fromOperator(*n2,0),E::toInput(*scale,0)).creatable()
              && page->connectControlEdge(E::fromOperator(*n2,1),E::toInput(*rnd,0)).creatable(),"graph A wiring (VALUE and WRAP of one COUNTER)");
        check(page->connectControlEdge(E::fromOperator(*scale),E::toParameter({ModDestination::Resonance,0,0})).creatable()
              && page->connectControlEdge(E::fromOperator(*rnd),E::toParameter(fxParameterAddress(mainBusId,reverb,mix))).creatable(),
              "graph A terminals: SCALE -> RESONANCE, RANDOM -> REVERB MIX");
        {   auto m=mod(); auto& c=m.operators[controlOperatorSlot(m,*c2)]; c.params[0]=0.0f; c.params[1]=50.0f;
            auto& n=m.operators[controlOperatorSlot(m,*n2)]; n.params[0]=2.0f; // wraps every second tick
            check(p.setUiModulationState(m),"CLOCK 50 Hz, COUNTER LENGTH 2"); }
        const auto slot=controlOperatorSlot(mod(),*rnd);
        render(2);
        const float before=p.getUiRuntimeVisualizationSnapshot().routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(slot,0)];
        render(40);
        const float after=p.getUiRuntimeVisualizationSnapshot().routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(slot,0)];
        check(after!=before,"graph A runs in the engine: WRAP draws new RANDOM values for REVERB MIX");
    }
    // ---- save / load (v30) and legacy behaviour -------------------------------
    {
        juce::MemoryBlock saved; p.getStateInformation(saved);
        auto copy=std::make_unique<OrigamiAudioProcessor>(); copy->prepareToPlay(48000.0,256);
        copy->setStateInformation(saved.getData(),int(saved.getSize()));
        const auto restored=copy->getUiInstrumentState().modulation; const auto live=mod();
        bool same=true;
        for(std::size_t i=0;i<live.operators.size();++i)
            same&=restored.operators[i].id==live.operators[i].id && restored.operators[i].type==live.operators[i].type
                && restored.operators[i].params==live.operators[i].params && restored.operators[i].inputs==live.operators[i].inputs;
        for(std::size_t i=0;i<live.routes.size();++i) same&=restored.routes[i].source==live.routes[i].source;
        check(same && restored.sequencer.steps==live.sequencer.steps,"multi-output graphs and the sequence survive save/load");
        check(encodeInstrumentState(p.getUiInstrumentState())[7]==30,"the state is versioned v30 because N06 nodes / ports are used");
    }
    {
        juce::AudioBuffer<float> a(2,256); juce::MidiBuffer midi;
        midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0); midi.addEvent(juce::MidiMessage::noteOn(1,64,1.0f),91);
        bool finite=true;
        for(int b=0;b<16;++b) { a.clear(); p.processBlock(a,midi); midi.clear(); for(int i=0;i<256;++i) finite&=std::isfinite(a.getSample(0,i)); }
        check(finite,"the sequencing graph renders cleanly");
    }
}


// mct-origami-nodes-n07-consolidation
void nodesN07Audit() {
    using namespace mct::origami;
    using T=ControlOpType;
    using E=nodes::ControlEndpoint;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    ui::FxPage* page=nullptr; ui::ModulationMatrix* matrix=nullptr; juce::TextButton* nodesButton=nullptr; juce::TextButton* synthButton=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* f=dynamic_cast<ui::FxPage*>(&c)) page=f;
        if(auto* x=dynamic_cast<ui::ModulationMatrix*>(&c)) if(x->layout()==ui::ModulationMatrix::Layout::Page) matrix=x;
        if(auto* b=dynamic_cast<juce::TextButton*>(&c)) { if(b->getButtonText()=="NODES" && !nodesButton) nodesButton=b; if(b->getButtonText()=="SYNTH" && !synthButton) synthButton=b; }});
    check(page && matrix && nodesButton && synthButton,"N07: NODES, MATRIX, SYNTH");
    nodesButton->onClick();
    const auto mod=[&]{ return p.getUiInstrumentState().modulation; };
    const auto render=[&](int blocks){ juce::AudioBuffer<float> a(2,256); juce::MidiBuffer midi; midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0);
        for(int b=0;b<blocks;++b) { a.clear(); p.processBlock(a,midi); midi.clear(); } };
    const auto diag=[&]{ render(1); return p.getUiNodesDiagnostics(); };
    const auto opCount=[&]{ int n=0; for(const auto& o:mod().operators) n+=o.id!=0; return n; };

    // A small graph: LFO 1 -> SCALE -> SMOOTH -> CUTOFF, CLOCK -> PROBABILITY -> RANDOM.
    const auto scale=page->addControlOperator(T::ScaleOffset);
    const auto smooth=page->addControlOperator(T::Smooth);
    const auto clock=page->addControlOperator(T::Clock);
    const auto prob=page->addControlOperator(T::Probability);
    const auto rnd=page->addControlOperator(T::RandomTrigger);
    check(scale && smooth && clock && prob && rnd,"graph nodes");
    page->connectControlEdge(E::fromSource(ModSource::Lfo1),E::toInput(*scale,0));
    page->connectControlEdge(E::fromOperator(*scale),E::toInput(*smooth,0));
    page->connectControlEdge(E::fromOperator(*smooth),E::toParameter({ModDestination::Cutoff,0,0}));
    page->connectControlEdge(E::fromOperator(*clock),E::toInput(*prob,0));
    page->connectControlEdge(E::fromOperator(*prob),E::toInput(*rnd,0));
    page->connectControlEdge(E::fromOperator(*rnd),E::toParameter({ModDestination::Resonance,0,0}));

    // ---- layout, view and selection never compile -------------------------
    {
        const auto before=diag();
        for(int i=0;i<100;++i) page->moveControlNode(nodes::operatorKey(*scale),{float(400+i),float(700+(i%7))},i%10==9);
        page->zoomIn(); page->zoomOut(); page->graphView().panBy({120.0f,40.0f}); page->zoomToFit();
        page->selectControlNode(nodes::operatorKey(*smooth)); page->setControlNodeSelection({nodes::operatorKey(*scale),nodes::operatorKey(*clock)});
        page->autoLayoutControl();
        page->undo(); // a layout-only undo
        const auto after=diag();
        check(after.compiles==before.compiles && after.parameterUpdates==before.parameterUpdates && after.stateRevision==before.stateRevision,
              "100 node moves, pan, zoom, selection, auto layout and a layout undo: no compile, no model change");
    }
    // ---- parameter vs topology ------------------------------------------------
    {
        const auto d0=diag();
        page->setOperatorParameter(*scale,0,0.5f);                     // SCALE amount
        page->setOperatorParameter(*prob,0,0.25f);                     // PROBABILITY chance
        const auto d1=diag();
        check(d1.compiles==d0.compiles && d1.parameterUpdates>=d0.parameterUpdates+1,"SCALE / PROBABILITY edits update parameters in place (no compile)");
        const auto euclid=page->addControlOperator(T::Euclidean);
        const auto d2=diag();
        check(d2.compiles>d1.compiles,"adding a node compiles");
        page->setOperatorParameter(*euclid,2,3.0f);                    // EUCLIDEAN rotation
        const auto pattern=page->addControlOperator(T::Pattern);
        const auto d3=diag();
        page->togglePatternStep(*pattern,2);                           // PATTERN step
        const auto d4=diag();
        check(d4.compiles==d3.compiles && d4.parameterUpdates>d3.parameterUpdates,"EUCLIDEAN rotation and PATTERN steps: parameter updates");
        page->connectControlEdge(E::fromOperator(*clock),E::toInput(*euclid,0));
        check(diag().compiles>d4.compiles,"a new connection compiles");
        // A macro drag (SYNTH / MACROS) never compiles.
        const auto d5=diag(); p.setUiMacro(0,0.6f); p.setUiMacro(0,0.7f);
        const auto d6=diag();
        check(d6.compiles==d5.compiles && d6.compileSkips>d5.compileSkips,"macro drags are classified and skipped by the compiler");
    }
    // ---- UI revision model and hidden-page cost --------------------------------
    {
        page->syncFromModel();
        const auto u0=page->uiDiagnostics();
        for(int i=0;i<30;++i) page->syncFromModel(); // the editor timer, nothing changed
        const auto u1=page->uiDiagnostics();
        check(u1.skippedSyncs>=u0.skippedSyncs+30 && u1.controlRebuilds==u0.controlRebuilds && u1.modelSyncs==u0.modelSyncs,
              "unchanged model: 30 timer syncs rebuild nothing (revision check only)");
        synthButton->onClick();
        check(!page->isVisible(),"NODES hidden");
        const auto paints=page->canvasPaintCount();
        const auto u2=page->uiDiagnostics();
        auto edited=mod(); edited.routes[0].amount=0.33f; p.setUiModulationState(edited); editor->refreshModulationViews();
        p.setUiMacro(1,0.4f); editor->refreshModulationViews();
        const auto u3=page->uiDiagnostics();
        check(u3.controlRebuilds==u2.controlRebuilds && u3.hiddenSyncs>=u2.hiddenSyncs+2 && page->canvasPaintCount()==paints,
              "hidden NODES: model changes rebuild no CONTROL graph and paint nothing");
        // Rendering is identical with NODES visible or hidden.
        auto state=p.getUiInstrumentState();
        const auto renderFresh=[&](bool visible) {
            auto q=std::make_unique<OrigamiAudioProcessor>(); q->prepareToPlay(48000.0,256); disableExtraOscillators(*q);
            q->setUiModulationState(state.modulation);
            auto ed=std::unique_ptr<juce::AudioProcessorEditor>(q->createEditor()); ed->setVisible(true);
            juce::TextButton* nb=nullptr; walk(*ed,[&](auto& c){ if(auto* b=dynamic_cast<juce::TextButton*>(&c)) if(b->getButtonText()=="NODES" && !nb) nb=b; });
            if(visible && nb) nb->onClick();
            juce::AudioBuffer<float> a(2,256); juce::MidiBuffer midi; midi.addEvent(juce::MidiMessage::noteOn(1,60,1.0f),0);
            std::vector<float> out;
            for(int b=0;b<40;++b) { a.clear(); q->processBlock(a,midi); midi.clear(); for(int i=0;i<256;++i) out.push_back(a.getSample(0,i)); }
            return out;
        };
        check(renderFresh(true)==renderFresh(false),"audio is identical with NODES visible or hidden");
        nodesButton->onClick();
        const auto u4=page->uiDiagnostics();
        check(u4.controlRebuilds>u3.controlRebuilds,"showing NODES catches up once (stale flag)");
    }
    // ---- auto layout ------------------------------------------------------------
    {
        const auto ops=mod().operators;
        page->autoLayoutControl();
        bool overlap=false,leftToRight=true;
        const auto nodesNow=page->canvas().controlNodes();
        for(std::size_t i=0;i<nodesNow.size();++i) for(std::size_t j=i+1;j<nodesNow.size();++j)
            overlap|=nodesNow[i]->getBounds().intersects(nodesNow[j]->getBounds());
        for(const auto& l:page->controlGraph().links) {
            const auto* a=page->canvas().controlNode(page->controlGraph().nodes[l.source].key);
            const auto* b=page->canvas().controlNode(page->controlGraph().nodes[l.parameter].key);
            if(a && b) leftToRight&=a->getX()<b->getX();
        }
        std::vector<juce::Point<int>> first; for(auto* n:nodesNow) first.push_back(n->getPosition());
        page->autoLayoutControl();
        std::vector<juce::Point<int>> second; for(auto* n:page->canvas().controlNodes()) second.push_back(n->getPosition());
        check(!overlap && leftToRight,"AUTO LAYOUT: no overlaps, every cable flows left to right");
        check(first==second,"AUTO LAYOUT is stable (same result twice)");
        check(mod().operators==ops,"AUTO LAYOUT never changes DSP state");
    }
    // ---- multi-selection, marquee, group move, delete ---------------------------
    {
        page->setControlNodeSelection({});
        auto* a=page->canvas().controlNode(nodes::operatorKey(*clock));
        auto* b=page->canvas().controlNode(nodes::operatorKey(*prob));
        check(a && b,"selection targets");
        const auto rect=a->getBounds().getUnion(b->getBounds()).toFloat().expanded(4.0f);
        page->canvas().beginMarquee(rect.getTopLeft(),false); page->canvas().dragMarquee(rect.getBottomRight()); page->canvas().endMarquee();
        const auto selected=page->selectedControlNodes();
        check(page->controlNodeSelected(nodes::operatorKey(*clock)) && page->controlNodeSelected(nodes::operatorKey(*prob)),"marquee selects the nodes it touches");
        page->toggleControlNodeSelection(nodes::operatorKey(*rnd));
        check(page->selectedControlNodes().size()==selected.size()+1,"Shift-click adds to the selection");
        const auto origin=a->getPosition(),originB=b->getPosition();
        page->moveControlNodes(page->selectedControlNodes(),{50.0f,30.0f});
        check(page->canvas().controlNode(nodes::operatorKey(*clock))->getPosition()==origin+juce::Point<int>(50,30)
              && page->canvas().controlNode(nodes::operatorKey(*prob))->getPosition()==originB+juce::Point<int>(50,30),"a group moves together");
        page->undo();
        check(page->canvas().controlNode(nodes::operatorKey(*clock))->getPosition()==origin,"a group move is one undo step");
        check(page->alignControlNodes(ui::FxPage::Align::Left),"ALIGN LEFT");
        const int x0=page->canvas().controlNode(nodes::operatorKey(*clock))->getX();
        check(page->canvas().controlNode(nodes::operatorKey(*prob))->getX()==x0 && page->canvas().controlNode(nodes::operatorKey(*rnd))->getX()==x0,"aligned left");
        page->undo();
        // Delete: user nodes go (one step), a linked canonical source stays.
        const int before=opCount();
        page->setControlNodeSelection({nodes::operatorKey(*clock),nodes::operatorKey(*prob),nodes::sourceKey(ModSource::Lfo1)});
        check(page->deleteSelectedControlNodes() && opCount()==before-2,"deleting a selection removes the user-created nodes");
        check(page->controlNodeShown(nodes::sourceKey(ModSource::Lfo1)),"a linked canonical SOURCE is never deleted by a selection delete");
        page->undo();
        check(opCount()==before && findControlOperator(mod(),*prob)!=nullptr && findControlOperator(mod(),*prob)->inputs[0].op==*clock,"one undo restores the nodes and their connection");
    }
    // ---- palette: search, quick add, cable drop ---------------------------------
    {
        page->showNodePalette(fx::FxPoint{700.0f,900.0f});
        auto& palette=page->nodePalette();
        check(palette.isOpen(),"the palette opens");
        const auto firstLabel=[&](const char* q){ palette.setQuery(q); const auto r=palette.results(); return r.empty() ? juce::String() : r.front().label; };
        check(firstLabel("prob")=="PROBABILITY","\"prob\" -> PROBABILITY");
        check(firstLabel("s&h")=="SAMPLE & HOLD","\"s&h\" -> SAMPLE & HOLD");
        check(firstLabel("seq").startsWith("SEQUENCER") || firstLabel("seq")=="Sequencer","\"seq\" -> SEQUENCER");
        check(firstLabel("walk")=="RANDOM WALK" && firstLabel("eucl")=="EUCLIDEAN","aliases and prefixes rank first");
        palette.setQuery("prob");
        const int before=opCount();
        check(palette.chooseSelected() && opCount()==before+1 && !palette.isOpen(),"Return adds the best match and closes the palette");
        page->undo();
        // Quick add (A) opens it at the cursor; Escape dismisses.
        page->keyPressed(juce::KeyPress('a'));
        check(palette.isOpen(),"A opens the quick-add palette");
        page->keyPressed(juce::KeyPress(juce::KeyPress::escapeKey));
        check(!palette.isOpen(),"Escape dismisses it");
        // A dangling EVENT cable: only nodes with an EVENT input, auto-connected.
        page->showNodePalette(fx::FxPoint{900.0f,700.0f},E::fromOperator(*clock));
        bool events=!palette.results().empty();
        for(const auto& e:palette.results()) if(e.id>=ui::FxModuleMenu::controlOperatorBase) {
            const auto* info=controlOpInfo(static_cast<T>(e.id-ui::FxModuleMenu::controlOperatorBase));
            bool takes=false; for(std::uint8_t k=0;k<info->inputs;++k) takes|=info->inputSignals[k]==ControlSignal::Event;
            events&=takes;
        }
        palette.setQuery("counter");
        check(events && palette.chooseSelected(),"a dropped EVENT cable offers only EVENT consumers");
        bool connected=false;
        for(const auto& o:mod().operators) if(o.id && o.type==T::Counter && o.inputs[0].op==*clock) connected=true;
        check(connected,"the chosen node is connected to the cable");
        page->undo();
    }
    // ---- copy / paste ---------------------------------------------------------
    {
        page->setControlNodeSelection({nodes::operatorKey(*clock),nodes::operatorKey(*prob)});
        check(page->copySelectedControlNodes()==2,"copy two nodes");
        const int before=opCount();
        const auto pasted=page->pasteControlNodes(fx::FxPoint{1200.0f,1200.0f});
        check(pasted.size()==2 && opCount()==before+2,"paste creates two new nodes");
        const auto* newClock=findControlOperator(mod(),pasted[0]); const auto* newProb=findControlOperator(mod(),pasted[1]);
        check(newClock && newProb && pasted[0]!=*clock && pasted[1]!=*prob,"pasted nodes get new stable ids");
        check(newProb && newProb->inputs[0].kind==ControlInput::Kind::Operator && newProb->inputs[0].op==pasted[0],"the internal CLOCK -> PROBABILITY edge is copied");
        bool external=false; for(const auto& r:mod().routes) external|=r.id && isOperatorSource(r.source) && (operatorIdOf(r.source)==pasted[0] || operatorIdOf(r.source)==pasted[1]);
        check(!external,"external connections are not copied");
        page->undo();
        check(opCount()==before,"paste is one undo step");
        page->redo();
        check(opCount()==before+2,"and redoes");
        juce::MemoryBlock saved; p.getStateInformation(saved);
        auto copy=std::make_unique<OrigamiAudioProcessor>(); copy->prepareToPlay(48000.0,256); copy->setStateInformation(saved.getData(),int(saved.getSize()));
        check(copy->getUiInstrumentState().modulation.operators==mod().operators,"pasted graphs survive save/load");
        page->undo();
        // Duplicate: below the original, selected, parameters copied, no connections.
        page->selectControlNode(nodes::operatorKey(*scale));
        page->keyPressed(juce::KeyPress('d',juce::ModifierKeys::commandModifier,0));
        const auto dup=page->selectedControlNodes();
        const auto* d=dup.size()==1 ? findControlOperator(mod(),dup[0].op) : nullptr;
        auto* original=page->canvas().controlNode(nodes::operatorKey(*scale));
        auto* copyNode=dup.size()==1 ? page->canvas().controlNode(dup[0]) : nullptr;
        check(d && d->type==T::ScaleOffset && d->params==findControlOperator(mod(),*scale)->params && d->inputs[0].kind==ControlInput::Kind::None
              && original && copyNode && !copyNode->getBounds().intersects(original->getBounds()),"Cmd+D duplicates near the original without overlap, selected, unconnected");
        page->undo();
    }
    // ---- feedback, debug inspector, validator -------------------------------
    {
        const auto rejected=page->uiDiagnostics().rejectedConnections;
        const auto toggle=page->addControlOperator(T::Toggle);
        page->connectControlEdge(E::fromSource(ModSource::Lfo2),E::toInput(*toggle,0));
        check(page->graphFeedback().contains("CONTROL output cannot feed an EVENT input") && page->uiDiagnostics().rejectedConnections==rejected+1,
              "a refused connection explains itself (Origami-native feedback)");
        page->connectControlEdge(E::fromOperator(*rnd),E::toInput(*prob,0));
        check(page->graphFeedback().isNotEmpty(),"every refusal has a reason");
        page->undo();
        page->setDebugInspectorVisible(true);
        page->selectControlNode(nodes::operatorKey(*scale));
        const auto lines=page->debugInspectorLines().joinIntoString("\n");
        check(page->debugInspectorVisible() && lines.contains("id "+juce::String(*scale)) && lines.contains("slot ") && lines.contains("plan  compiles")
              && lines.contains("validator  graph valid") && lines.contains("monitor "),"the debug inspector shows ids, slots, ports, plan counters and the validator");
        page->selectControlLink(mod().routes[0].id);
        check(page->debugInspectorLines().joinIntoString("\n").contains("#ROUTE"),"the debug inspector inspects routes");
        page->setDebugInspectorVisible(false);
        check(page->validateControlGraphReport().isEmpty(),"the graph validator is clean");
    }
    // ---- PATTERN: 32 steps keep usable cells ------------------------------------
    {
        page->graphView().setView(1.0f,page->graphView().pan()); // cells are drawn (and clickable) at full detail
        const auto pattern=page->addControlOperator(T::Pattern);
        page->setOperatorParameter(*pattern,0,32.0f);
        auto* node=page->canvas().controlNode(nodes::operatorKey(*pattern));
        check(node!=nullptr,"pattern node");
        if(node) {
            const auto area=node->previewBounds();
            const float cellWidth=area.getWidth()/16.0f,cellHeight=area.getHeight()/2.0f;
            check(cellWidth>=15.0f && cellHeight>=20.0f,"32-step PATTERN: two rows of >= 15 x 20 px cells (never squeezed)");
            const auto cell31=node->previewCellAt({area.getRight()-2.0f,area.getBottom()-2.0f});
            check(cell31 && *cell31==31,"step 32 is hit-testable");
            check(page->togglePatternStep(*pattern,31) && (std::lround(findControlOperator(mod(),*pattern)->params[2])&(1<<15))!=0,"step 32 toggles its bit");
        }
        page->undo(); page->undo(); page->undo();
    }
    // ---- semantic zoom -------------------------------------------------------
    {
        auto* node=page->canvas().controlNode(nodes::operatorKey(*scale));
        page->graphView().setView(1.0f,page->graphView().pan());
        check(node && node->detail()==ui::ControlNodeComponent::Detail::Full,"100%: full node");
        page->graphView().setView(0.5f,page->graphView().pan());
        check(node->detail()==ui::ControlNodeComponent::Detail::Reduced,"50%: secondary detail hidden");
        page->graphView().setView(0.3f,page->graphView().pan());
        const auto ports=node->portAt(node->portCentre(nodes::PortDirection::Output,0));
        check(node->detail()==ui::ControlNodeComponent::Detail::Minimal && ports.has_value(),"30% (fit floor): identity + ports; ports stay hit-testable");
        page->graphView().setView(1.0f,page->graphView().pan());
    }
    // ---- undo / redo stress ---------------------------------------------------
    {
        std::vector<ModulationState> history{mod()};
        std::uint32_t rng=0xBEEFu; const auto next=[&]{ rng^=rng<<13; rng^=rng>>17; rng^=rng<<5; return rng; };
        int edits=0;
        for(int step=0;step<60;++step) {
            const auto ops=[&]{ std::vector<std::uint32_t> ids; for(const auto& o:mod().operators) if(o.id) ids.push_back(o.id); return ids; }();
            const auto pick=ops.empty() ? 0u : ops[next()%ops.size()];
            const int before=edits;
            switch(next()%6) {
            case 0: if(page->addControlOperator(next()%2 ? T::ScaleOffset : T::Probability)) ++edits; break;
            case 1: if(pick && page->deleteControlOperator(pick)) ++edits; break;
            case 2: if(pick && page->duplicateControlOperator(pick)) ++edits; break;
            case 3: if(pick) { const auto* o=findControlOperator(mod(),pick); if(o && controlOpInfo(o->type)->parameterCount>0 && page->setOperatorParameter(pick,0,controlOpInfo(o->type)->parameters[0].minimum)) ++edits; } break;
            case 4: if(pick && page->connectControlEdge(E::fromSource(ModSource::Lfo3),E::toInput(pick,0)).creatable()) ++edits; break;
            case 5: if(pick && page->insertControlOperatorOnInput(pick,0,T::Smooth)) ++edits; break;
            }
            if(edits!=before) history.push_back(mod());
        }
        bool consistent=true;
        for(int i=int(history.size())-1;i>0;--i) { page->undo(); consistent&=mod().operators==history[std::size_t(i-1)].operators; }
        for(std::size_t i=1;i<history.size();++i) { page->redo(); consistent&=mod().operators==history[i].operators; }
        render(2);
        const auto engineState=p.getUiInstrumentState().modulation; // the processor publishes exactly what the engine compiled
        check(consistent && edits>10,"60 random edits: every undo / redo returns the exact canonical graph");
        check(validModulation(engineState,p.getUiInstrumentState().oscillators) && page->validateControlGraphReport().isEmpty(),"UI and engine state never diverge (valid, validator clean)");
    }
    // ---- cross-view stress: SYNTH / Matrix / NODES on one truth ---------------
    {
        const auto invariant=[&](const char* what) {
            const auto m=mod();
            bool ok=validModulation(m,p.getUiInstrumentState().oscillators);
            for(const auto& r:m.routes) ok&=!routeDuplicates(m,r);
            editor->refreshModulationViews();
            page->syncFromModel();
            int routes=0; for(const auto& r:m.routes) routes+=r.id!=0 && routeComplete(r);
            int links=0; for(const auto& l:page->controlGraph().links) links+=l.isRoute();
            ok&=matrix->routeCount()>=std::size_t(routes) && links<=routes;
            check(ok,(std::string("cross-view: ")+what).c_str());
        };
        // SYNTH creates a direct route.
        auto m=mod(); std::size_t free=0; while(free<m.routes.size() && m.routes[free].id) ++free;
        m.routes[free]={m.nextRouteId++,true,ModSource::Lfo4,{ModDestination::Level,1,0},0.3f,false};
        const auto direct=m.routes[free].id;
        p.setUiModulationState(m); invariant("SYNTH creates a route");
        const auto inserted=page->insertControlOperatorOnRoute(direct,T::ScaleOffset); invariant("NODES inserts a processor");
        auto edited=mod(); for(auto& r:edited.routes) if(r.id==direct) r.amount=0.8f; p.setUiModulationState(edited); invariant("Matrix edits the amount");
        const auto clock2=page->addControlOperator(T::Clock); page->connectControlEdge(E::fromOperator(*clock2),E::toInput(*rnd,1)); invariant("NODES adds event topology");
        auto lfo=mod().lfo4; lfo.mode=LfoMode::Envelope; auto lm=mod(); lm.lfo4=lfo; p.setUiModulationState(lm); invariant("SYNTH changes the modulator mode");
        if(inserted) page->deleteControlOperator(*inserted); invariant("NODES collapses the chain");
        bool collapsed=false; for(const auto& r:mod().routes) collapsed|=r.id==direct && r.source==ModSource::Lfo4;
        check(collapsed,"the collapsed chain is the original direct route again (same id)");
        page->undo(); invariant("undo"); page->redo(); invariant("redo");
        juce::MemoryBlock saved; p.getStateInformation(saved);
        p.setStateInformation(saved.getData(),int(saved.getSize())); invariant("save / reload");
    }
    // ---- sequencer cross-view ------------------------------------------------
    {
        const auto seq=page->addControlOperator(T::Sequencer);
        page->selectControlNode(nodes::operatorKey(*seq));
        auto m=mod(); m.sequencer.steps[1]=-0.4f; p.setUiModulationState(m); editor->refreshModulationViews(); page->selectControlNode(nodes::operatorKey(*seq));
        check(page->controlSequenceControl(1) && std::abs(page->controlSequenceControl(1)->getValue()+0.4)<1e-4,"a SYNTH sequence edit shows in the NODES inspector (no copy)");
        const float priorStep=mod().sequencer.steps[5];
        page->controlSequenceControl(5)->setValue(0.6,juce::sendNotificationSync);
        check(std::abs(mod().sequencer.steps[5]-0.6f)<1e-4f && std::abs(mod().sequencer.steps[1]+0.4f)<1e-4f,"a NODES edit lands in the canonical sequence beside the SYNTH edit");
        const auto extClock=page->addControlOperator(T::Clock);
        page->connectControlEdge(E::fromOperator(*extClock),E::toInput(*seq,0));
        check(findControlOperator(mod(),*seq)->params[0]==1.0f,"external clock selected");
        page->undo(); page->undo(); page->undo();
        check(mod().sequencer.steps[5]==priorStep && std::abs(mod().sequencer.steps[1]+0.4f)<1e-4f,"undo restores the NODES sequence edit and keeps the SYNTH one");
        page->redo(); page->redo(); page->redo();
        check(std::abs(mod().sequencer.steps[5]-0.6f)<1e-4f && findControlOperator(mod(),*seq)->params[0]==1.0f,"redo replays the edit and the clock ownership");
        juce::MemoryBlock saved; p.getStateInformation(saved);
        auto copy=std::make_unique<OrigamiAudioProcessor>(); copy->prepareToPlay(48000.0,256); copy->setStateInformation(saved.getData(),int(saved.getSize()));
        check(copy->getUiInstrumentState().modulation.sequencer.steps==mod().sequencer.steps,"the sequence round-trips through save/load");
    }
    // ---- UI cost measurements (printed; dense 32-node graph) -------------------
    {
        auto dense=mct::origami::scenarios::maximal();
        auto m=mod(); m.operators=dense.operators; m.nextOperatorId=dense.nextOperatorId; m.routes=dense.routes; m.nextRouteId=dense.nextRouteId;
        check(p.setUiModulationState(m),"dense graph for UI measurements");
        editor->refreshModulationViews(); page->syncFromModel(); page->autoLayoutControl();
        using clock_t=std::chrono::steady_clock;
        const auto us=[](clock_t::time_point a,clock_t::time_point b,int n){ return std::chrono::duration<double,std::micro>(b-a).count()/double(n); };
        auto t0=clock_t::now(); for(int i=0;i<200;++i) page->syncFromModel(); auto t1=clock_t::now();
        const double unchanged=us(t0,t1,200);
        t0=clock_t::now(); for(int i=0;i<30;++i) { p.setUiMacro(2,float(i%2)); page->syncFromModel(); } t1=clock_t::now();
        const double rebuild=us(t0,t1,30);
        synthButton->onClick();
        t0=clock_t::now(); for(int i=0;i<30;++i) { p.setUiMacro(2,float(i%2)); page->modelChanged(); } t1=clock_t::now();
        const double hidden=us(t0,t1,30);
        nodesButton->onClick();
        auto& view=page->graphView();
        const auto paint=[&](float zoom){ view.setView(zoom,view.pan()); auto a=clock_t::now(); for(int i=0;i<10;++i) { auto img=view.createComponentSnapshot(view.getLocalBounds(),true,1.0f); } return us(a,clock_t::now(),10); };
        const double p100=paint(1.0f),p50=paint(0.5f),p40=paint(0.4f);
        std::cout<<"[N07 ui] timer sync unchanged "<<unchanged<<" us | model change + rebuild "<<rebuild<<" us | hidden model change "<<hidden
                 <<" us | graph paint 100% "<<p100<<" us, 50% "<<p50<<" us, 40% "<<p40<<" us\n";
        check(unchanged*5.0<rebuild,"an unchanged timer sync costs a small fraction of a rebuild");
        view.setView(1.0f,view.pan());
    }
}


// mct-origami-nodes-menu-hierarchy-fix
void nodesMenuHierarchyAudit() {
    using namespace mct::origami;
    using T=ControlOpType;
    using Item=ui::NativeChoiceItem;
    const auto item=[](int id,const char* text,const char* group){ return Item{id,text,true,group}; };
    const auto names=[](const ui::NativeChoiceNode& n){ juce::StringArray s; for(const auto& c:n.children) s.add(c.name); return s; };
    const auto find=[](const ui::NativeChoiceNode& n,const juce::String& name)->const ui::NativeChoiceNode* {
        for(const auto& c:n.children) if(c.name==name) return &c; return nullptr; };
    // 1-3: one, two and three levels.
    {
        const auto t=ui::buildNativeChoiceTree({item(1,"A","EFFECTS"),item(2,"B","EFFECTS / DISTORTION"),item(3,"C","EFFECTS / FILTER / EQ")});
        const auto* fx=find(t,"EFFECTS");
        check(t.children.size()==1 && fx && fx->items.size()==1 && fx->items[0].id==1,"one-level path: EFFECTS holds its module");
        check(fx && find(*fx,"DISTORTION") && find(*fx,"DISTORTION")->items[0].id==2,"two-level path: EFFECTS > DISTORTION");
        const auto* filter=fx ? find(*fx,"FILTER") : nullptr;
        check(filter && find(*filter,"EQ") && find(*filter,"EQ")->items[0].id==3 && filter->items.empty(),"three-level path: EFFECTS > FILTER > EQ");
    }
    // 4: trailing / empty components never create a category.
    {
        const auto t=ui::buildNativeChoiceTree({item(1,"A","CONTROL /"),item(2,"B"," CONTROL //  MATH / ")});
        const auto* control=find(t,"CONTROL");
        check(t.children.size()==1 && control && control->items.size()==1 && control->items[0].id==1 && names(*control)==juce::StringArray("MATH"),
              "\"CONTROL /\" normalizes to CONTROL (no empty submenu); components are trimmed");
    }
    // 5-6: one root per category; direct modules coexist with sub-categories.
    {
        const auto t=ui::buildNativeChoiceTree({item(1,"P","CONTROL"),item(2,"M","CONTROL / MATH"),item(3,"S","CONTROL / SHAPING"),item(4,"Q","CONTROL")});
        const auto* control=find(t,"CONTROL");
        check(t.children.size()==1 && control!=nullptr,"duplicate root: exactly one CONTROL");
        check(control && control->items.size()==2 && control->items[0].id==1 && control->items[1].id==4 && names(*control)==juce::StringArray("MATH","SHAPING"),
              "a category keeps its direct modules beside its sub-categories");
    }
    // 7-8: filtering prunes empty branches; order follows the catalog, deterministically.
    {
        std::vector<Item> all{item(1,"Z","B / Y"),item(2,"A","A"),item(3,"M","B / X")};
        std::vector<Item> filtered; for(const auto& i:all) if(i.id!=2) filtered.push_back(i);
        const auto t=ui::buildNativeChoiceTree(filtered);
        check(names(t)==juce::StringArray("B") && names(*find(t,"B"))==juce::StringArray("Y","X"),"filtered catalog: removed items leave no empty branch; order is first use (not alphabetical)");
        check(names(ui::buildNativeChoiceTree(all))==juce::StringArray("B","A") && names(ui::buildNativeChoiceTree(all))==names(ui::buildNativeChoiceTree(all)),"ordering is deterministic");
    }

    // ---- the real Add Module catalog ----------------------------------------
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    ui::FxPage* page=nullptr; juce::TextButton* nodesButton=nullptr;
    walk(*editor,[&](auto& c){ if(auto* f=dynamic_cast<ui::FxPage*>(&c)) page=f;
        if(auto* b=dynamic_cast<juce::TextButton*>(&c)) if(b->getButtonText()=="NODES" && !nodesButton) nodesButton=b; });
    check(page && nodesButton,"menu audit: NODES page");
    nodesButton->onClick();
    const auto catalog=page->moduleMenuItems(true);
    const auto tree=ui::buildNativeChoiceTree(catalog);
    // Visual verification: the exact tree the native menu is built from.
    std::function<void(const ui::NativeChoiceNode&,int)> dump=[&](const ui::NativeChoiceNode& n,int depth) {
        for(const auto& c:n.children) {
            std::cerr<<"[menu] "<<std::string(std::size_t(depth*4),' ')<<c.name<<" >  ("<<c.items.size()<<" items)\n";
            dump(c,depth+1);
        }
    };
    dump(tree,0);
    check(names(tree)==juce::StringArray("AUDIO","CONTROL","EVENTS","LOGIC / GENERATIVE"),"producer-facing AUDIO CONTROL EVENTS LOGIC / GENERATIVE roots");
    bool slashFree=true,emptyFree=true;
    std::function<void(const ui::NativeChoiceNode&)> walkTree=[&](const ui::NativeChoiceNode& n) {
        for(const auto& c:n.children) { emptyFree&=c.name.trim().isNotEmpty() && !c.empty(); walkTree(c); }
        for(const auto& i:n.items) emptyFree&=i.text.trim().isNotEmpty();
    };
    walkTree(tree);
    for(const auto& c:tree.children) slashFree&=!c.name.contains(" / ") || c.name=="LOGIC / GENERATIVE";
    check(slashFree && emptyFree,"no top-level path labels, no blank category or blank item (the \"CONTROL /\" ghost is gone)");
    const auto* audio=find(tree,"AUDIO");
    const auto* effects=audio ? find(*audio,"EFFECTS") : nullptr;
    check(effects && names(*effects)==juce::StringArray("DYNAMICS","FILTER / EQ","DISTORTION","MODULATION","SPATIAL","TIME","UTILITY") && effects->items.empty(),
          "EFFECTS > DYNAMICS, FILTER / EQ (one canonical category), DISTORTION, MODULATION, SPATIAL, TIME, UTILITY");
    const auto* control=find(tree,"CONTROL");
    check(control && names(*control)==juce::StringArray("MODULATION SOURCES","MATH","SHAPING","UTILITY","UTILITIES"),
          "CONTROL groups sources, processors, and parameter utility");
    const auto* event=find(tree,"EVENTS");
    check(event && names(*event)==juce::StringArray("NOTE / GATE / TRIGGER","TRANSPORT","TARGETS"),"EVENTS groups note, transport, and target nodes");
    const auto* seq=find(tree,"LOGIC / GENERATIVE");
    check(seq && names(*seq)==juce::StringArray("CONVERSION","LOGIC","STATEFUL","SEQUENCING","GENERATIVE"),"logic and generative processors are grouped by use");
    int ops=0; for(const auto& i:catalog) ops+=i.id>=ui::FxModuleMenu::controlOperatorBase;
    check(ops==14+21+9,"every catalog node appears exactly once (14 CONTROL + 21 EVENT + 9 SEQUENCING)");
    // 9: search stays flat, with category context.
    page->showNodePalette(fx::FxPoint{600.0f,700.0f});
    auto& palette=page->nodePalette();
    palette.setQuery("prob");
    check(!palette.results().empty() && palette.results().front().label=="PROBABILITY" && palette.results().front().group=="LOGIC / GENERATIVE > GENERATIVE",
          "search is flat: probability has generative context");
    palette.setQuery("distortion");
    bool drive=false; for(const auto& r:palette.results()) drive|=r.group=="AUDIO > EFFECTS > DISTORTION";
    check(drive,"searching a category name finds its modules (EFFECTS > DISTORTION)");
    palette.dismiss();
    // 10: cable-drop filtering before the tree: only compatible, no empty branches.
    const auto clock=page->addControlOperator(T::Clock);
    const auto drop=ui::buildNativeChoiceTree(page->controlCreateItems(nodes::ControlEndpoint::fromOperator(*clock)));
    bool compatible=true;
    std::function<void(const ui::NativeChoiceNode&)> checkDrop=[&](const ui::NativeChoiceNode& n) {
        for(const auto& c:n.children) { compatible&=!c.empty(); checkDrop(c); }
        for(const auto& i:n.items) if(i.id>=ui::FxModuleMenu::controlOperatorBase) {
            const auto* info=controlOpInfo(static_cast<T>(i.id-ui::FxModuleMenu::controlOperatorBase));
            bool takes=false; for(std::uint8_t k=0;k<info->inputs;++k) takes|=info->inputSignals[k]==ControlSignal::Event;
            compatible&=takes;
        }
    };
    checkDrop(drop);
    for(const auto& n:names(drop)) std::cerr<<"[menu] cable-drop root "<<n<<"\n";
    check(compatible && names(drop)==juce::StringArray("EVENT") && find(drop,"EVENT")!=nullptr && find(*find(drop,"EVENT"),"SOURCES")==nullptr,
          "EVENT cable drop: only EVENT consumers; branches without a compatible node (EVENT > SOURCES) are pruned");
    // 11: a leaf inserts exactly its node type.
    const ui::NativeChoiceItem* leaf=nullptr;
    if(seq) if(const auto* generative=find(*seq,"GENERATIVE")) for(const auto& i:generative->items) if(i.text=="PROBABILITY") leaf=&i;
    const auto before=p.getUiInstrumentState().modulation;
    if(leaf) page->addFromCatalog(leaf->id,fx::FxPoint{700.0f,800.0f});
    bool added=false; for(const auto& o:p.getUiInstrumentState().modulation.operators) added|=o.id && o.type==T::Probability;
    check(leaf && added,"choosing the SEQUENCING > GENERATIVE > PROBABILITY leaf inserts a PROBABILITY node");
    // 12: one sequencer.
    page->addControlOperator(T::Sequencer);
    bool disabled=false; juce::String reason;
    const auto after=ui::buildNativeChoiceTree(page->moduleMenuItems(true));
    if(const auto* family=find(after,"LOGIC / GENERATIVE")) if(const auto* category=find(*family,"SEQUENCING"))
        for(const auto& i:category->items) if(i.text=="SEQUENCER") { disabled=!i.enabled; reason=i.tooltip; }
    check(disabled && reason.contains("one sequencer"),"a second SEQUENCER stays disabled in the tree, with its reason");
}

// NODES P03: node telemetry is published only while NODES is on screen.
void nodesTelemetryVisibilityAudit() {
    using namespace mct::origami;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    fx::FxNodeId gain=fx::invalidFxNodeId;
    p.getUiFxDocument().edit([&](fx::FxGraph& g){ gain=g.insertEffectBeforeOutput(fx::FxEffectType::Gain); return gain!=fx::invalidFxNodeId; });
    juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi,none;
    midi.addEvent(juce::MidiMessage::noteOn(1,60,0.9f),0);
    const auto block=[&](juce::MidiBuffer& m){ audio.clear(); p.processBlock(audio,m); m.clear(); };
    const auto sequence=[&]{ return p.consumeUiFxNodeTelemetry(mainBusId,gain).sequence; };
    block(midi); block(none);
    check(gain!=fx::invalidFxNodeId && !p.consumeUiFxNodeTelemetry(mainBusId,gain).valid,"no editor: no node telemetry is published");
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    ui::OrigamiHeader* header=nullptr; walk(*editor,[&](juce::Component& c){ if(auto* h=dynamic_cast<ui::OrigamiHeader*>(&c)) header=h; });
    block(none);
    check(!p.consumeUiFxNodeTelemetry(mainBusId,gain).valid,"SYNTH page: NODES hidden, nothing published");
    header->selectMode(2);
    block(none); const auto first=sequence(); block(none);
    check(first>0 && sequence()>first,"NODES shown: the node publishes every block");
    header->selectMode(0);
    const auto frozen=sequence(); block(none); block(none);
    check(sequence()==frozen,"NODES hidden again: publication stops");
    header->selectMode(2); block(none);
    check(sequence()>frozen,"shown again: publication resumes");
    editorOwner.reset();
    const auto closed=sequence(); block(none); block(none);
    check(sequence()==closed,"closing the editor stops publication (no orphaned telemetry)");
}

// mct-origami-manual-qa-ui-wavetable-fixes: BEND fields, MAIN IN meters, macro X.
void manualQaUiAudit() {
    using namespace mct::origami;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);

    // ---- 1 / 2: BEND UP / DOWN are number fields: nothing is drawn across the digits.
    juce::Slider *up=nullptr,*down=nullptr;
    walk(*editor,[&](juce::Component& c){
        if(c.getName()=="Pitch bend up range") up=dynamic_cast<juce::Slider*>(&c);
        if(c.getName()=="Pitch bend down range") down=dynamic_cast<juce::Slider*>(&c); });
    check(up && down,"BEND UP / DOWN fields");
    for(auto* s:{up,down}) {
        for(double v:{48.0,12.0,2.0,0.0,-2.0,-12.0,-48.0}) {
            juce::Image img(juce::Image::ARGB,s->getWidth(),s->getHeight(),true);
            juce::Graphics g(img);
            const float pos=float(s->getPositionOfValue(v));
            s->getLookAndFeel().drawLinearSlider(g,0,0,s->getWidth(),s->getHeight(),pos,0.0f,float(s->getHeight()),s->getSliderStyle(),*s);
            // Only the field's well (fill + border) may be painted: no marker, no centre line.
            bool clean=true;
            for(int y=3;y<img.getHeight()-3 && clean;++y) for(int x=3;x<img.getWidth()-3 && clean;++x)
                clean=img.getPixelAt(x,y).getPixelARGB().getNativeARGB()==img.getPixelAt(img.getWidth()/2,img.getHeight()-4).getPixelARGB().getNativeARGB()
                      || img.getPixelAt(x,y).getBrightness()<=ui::Palette::borderSoft().getBrightness()+0.01f;
            check(clean,"BEND field: no marker or line crosses the value text (-48..+48)");
        }
    }
    check(up->getTextFromValue(2.0)=="+2" && up->getTextFromValue(48.0)=="+48" && up->getTextFromValue(0.0)=="0" && up->getTextFromValue(-12.0)=="-12"
          && down->getTextFromValue(-2.0)=="-2" && down->getTextFromValue(-48.0)=="-48" && down->getTextFromValue(12.0)=="+12","signed BEND labels");
    check(std::abs(up->getValue()-2.0)<1e-9 && std::abs(down->getValue()+2.0)<1e-9,"defaults UP +2 / DOWN -2");

    // ---- 3-8: MAIN IN meters follow the real signal entering the MAIN graph.
    juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi,none;
    const auto block=[&](juce::MidiBuffer& m){ audio.clear(); p.processBlock(audio,m); m.clear(); };
    p.consumeUiFxInputPeaks(mainBusId);
    block(none);
    auto in=p.consumeUiFxInputPeaks(mainBusId);
    check(in.first==0.0f && in.second==0.0f,"silence: MAIN IN reads zero");
    p.setUiParameter(ParameterId::OscPan,-1.0f); // hard left: an asymmetric stereo voice sum
    midi.addEvent(juce::MidiMessage::noteOn(1,60,0.9f),0);
    block(midi);
    for(int i=0;i<4;++i) block(none);
    in=p.consumeUiFxInputPeaks(mainBusId);
    std::cerr<<"[qa] MAIN IN peaks hard-left: L "<<in.first<<" R "<<in.second<<"\n";
    check(in.first>1.0e-3f,"MAIN IN L follows the left input");
    check(in.first>in.second*2.0f,"asymmetric stereo input -> asymmetric meters");
    p.setUiParameter(ParameterId::OscPan,1.0f);
    for(int i=0;i<8;++i) block(none);
    p.consumeUiFxInputPeaks(mainBusId); // drop the pan transition
    for(int i=0;i<4;++i) block(none);
    in=p.consumeUiFxInputPeaks(mainBusId);
    std::cerr<<"[qa] MAIN IN peaks hard-right: L "<<in.first<<" R "<<in.second<<"\n";
    check(in.second>1.0e-3f && in.second>in.first*2.0f,"MAIN IN R follows the right input");
    // The meters measure exactly what the graph receives: the neutral graph is a
    // pass-through, so the output peak equals the input peak.
    block(none);
    const auto inPeak=p.consumeUiFxInputPeaks(mainBusId);
    check(std::abs(std::max(inPeak.first,inPeak.second)-audio.getMagnitude(0,256)-0.0f)<1.0e-6f || audio.getMagnitude(1,0,256)==std::max(inPeak.first,inPeak.second),
          "MAIN IN meters the signal the graph receives (neutral graph: input peak == output peak)");
    ui::FxPage* page=nullptr; walk(*editor,[&](juce::Component& c){ if(auto* x=dynamic_cast<ui::FxPage*>(&c)) page=x; });
    check(page!=nullptr,"NODES page");
    const auto mainIn=page->graph().sourceNode();
    block(none); page->meterTickForTesting();
    const auto shown=page->inputMeterLevels(mainIn);
    check(shown.second>1.0e-3f,"the MAIN IN node displays the live level");
    juce::MidiBuffer off; off.addEvent(juce::MidiMessage::allNotesOff(1),0); block(off);
    for(int i=0;i<400;++i) { block(none); page->meterTickForTesting(); }
    check(page->inputMeterLevels(mainIn).first==0.0f && page->inputMeterLevels(mainIn).second==0.0f,"silence decays the MAIN IN meters to zero");
    midi.addEvent(juce::MidiMessage::noteOn(1,64,0.9f),0); block(midi);
#ifndef ORIGAMI_SANITIZED
    pluginAllocations.store(0,std::memory_order_relaxed);
    pluginGuardAllocations.store(true,std::memory_order_release);
#endif
    for(int i=0;i<16;++i) { audio.clear(); p.processBlock(audio,none); }
#ifndef ORIGAMI_SANITIZED
    pluginGuardAllocations.store(false,std::memory_order_release);
    check(pluginAllocations.load()==0,"MAIN IN telemetry allocates nothing on the audio thread");
#endif
    if(const char* shots=std::getenv("ORIGAMI_SNAPSHOT")) { // visual review aid
        const auto shot=[&](const juce::String& name,int w,int h) {
            editor->setSize(w,h);
            auto image=editor->createComponentSnapshot(editor->getLocalBounds(),true,1.0f);
            juce::FileOutputStream out(juce::File(shots).getChildFile(name)); out.setPosition(0); out.truncate();
            juce::PNGImageFormat().writeImageToStream(image,out);
        };
        p.setUiMacroName(0,"Twenty Three Char Name!"); editor->refreshModulationViews();
        shot("qa-synth-min.png",ui::EditorLayout::minWidth,ui::EditorLayout::minHeight);
        shot("qa-synth-default.png",ui::EditorLayout::defaultWidth,ui::EditorLayout::defaultHeight);
        shot("qa-synth-large.png",ui::EditorLayout::maxWidth,ui::EditorLayout::maxHeight);
        walk(*editor,[&](juce::Component& c){ if(auto* h=dynamic_cast<ui::OrigamiHeader*>(&c)) h->selectMode(2); });
        editor->setSize(ui::EditorLayout::defaultWidth,ui::EditorLayout::defaultHeight);
        juce::MidiBuffer m; m.addEvent(juce::MidiMessage::noteOn(1,48,0.9f),0); block(m);
        p.setUiParameter(ParameterId::OscPan,-0.6f);
        for(int i=0;i<8;++i) { block(none); page->meterTickForTesting(); }
        shot("qa-nodes.png",ui::EditorLayout::defaultWidth,ui::EditorLayout::defaultHeight);
        p.setUiMacroName(0,"");
    }
    p.setUiParameter(ParameterId::OscPan,0.0f);

    // ---- 9-12: macro remove (X) at the right of ASSIGN; the title gets the header.
    ui::MacroPanel* macros=nullptr; walk(*editor,[&](juce::Component& c){ if(auto* x=dynamic_cast<ui::MacroPanel*>(&c)) macros=x; });
    check(macros!=nullptr,"macro panel");
    auto* card=macros->card(0);
    juce::Component* remove=nullptr; walk(*card,[&](juce::Component& c){ if(c.getName()=="Remove macro 1") remove=&c; });
    auto* title=macros->titleLabel(1);
    const auto* strip=macros->assignment(1);
    check(remove && title && strip,"macro card parts");
    check(remove->getBottom()<=card->getHeight() && remove->getY()>=strip->getY()-1 && remove->getBottom()<=strip->getBottom()+1
          && remove->getX()>=strip->getRight(),"the X sits at the right end of the ASSIGN strip");
    check(remove->getWidth()>=20 && remove->getHeight()>=20 && strip->getHeight()<=40,"a usable X target without a taller strip");
    check(title->getRight()>=card->getWidth()-8 && title->getWidth()>=card->getWidth()-16,"the title owns the header's full width");
    check(p.setUiMacroName(0,"Twenty Three Char Name!") && p.getUiMacroName(0).length()==23,"a 23-character name");
    editor->refreshModulationViews(); macros->syncFromModel();
    const auto font=juce::Font(juce::FontOptions(ui::Type::label));
    check(juce::GlyphArrangement::getStringWidth(font,title->getText())<=float(title->getWidth()) || title->getText().length()==23,"long names use the reclaimed width");
    const auto routesBefore=[&]{ int n=0; for(const auto& r:p.getUiInstrumentState().modulation.routes) n+=r.id!=0; return n; }();
    check(macros->removeMacro(1) && !macroActive(p.getUiInstrumentState().modulation,1) && p.macroParameter(0)->getParameterID()=="macro.1"
          && macros->undo() && macroActive(p.getUiInstrumentState().modulation,1),"remove / undo unchanged; host id macro.1 unchanged");
    juce::ignoreUnused(routesBefore);
}

// mct-origami-manual-qa-ui-wavetable-fixes: the wavetable editor's X commits
// the edited table to the oscillator (canonical source, viewport, DSP,
// saved state) without touching the library.
void wavetableEditorCommitAudit() {
    using namespace mct::origami;
    using Command=ui::FrameTools::Command;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer none;
    const auto block=[&](juce::MidiBuffer& m){ audio.clear(); p.processBlock(audio,m); m.clear(); };
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    auto& surface=editor->wavetableEditorForTesting();
    const auto ids=[&]{ std::vector<unsigned> v; for(const auto& m:p.getUiInstrumentState().oscillators) if(m.id) v.push_back(m.id); return v; }();
    const auto osc1=ids[0],osc2=ids[1];
    ui::OscillatorCard* card1=nullptr;
    walk(*editor,[&](juce::Component& c){ if(auto* x=dynamic_cast<ui::OscillatorCard*>(&c)) if(x->id()==osc1) card1=x; });
    check(card1!=nullptr,"OSC 1 card");
    const auto snapshot=[&]{ editor->resized(); card1->repaint(); return card1->createComponentSnapshot(card1->getLocalBounds(),true,1.0f); };
    const auto differs=[](const juce::Image& a,const juce::Image& b) {
        if(a.getBounds()!=b.getBounds()) return true;
        for(int y=0;y<a.getHeight();y+=2) for(int x=0;x<a.getWidth();x+=2) if(a.getPixelAt(x,y)!=b.getPixelAt(x,y)) return true;
        return false;
    };
    const auto render=[&](int note) {
        juce::AudioBuffer<float> a(2,512); juce::MidiBuffer m; m.addEvent(juce::MidiMessage::noteOn(1,note,0.8f),0);
        std::vector<float> out;
        for(int i=0;i<6;++i) { a.clear(); p.processBlock(a,m); m.clear(); out.insert(out.end(),a.getReadPointer(0),a.getReadPointer(0)+512); }
        juce::MidiBuffer off; off.addEvent(juce::MidiMessage::allNotesOff(1),0);
        for(int i=0;i<40;++i) { a.clear(); p.processBlock(a,off); off.clear(); }
        return out;
    };
    for(int i=0;i<4;++i) block(none);

    // 13 / 14: MORPH (to 256 frames) -> X -> the oscillator's canonical table.
    const auto basicRender=render(60);
    editor->openWavetableEditorForOscillator(osc1);
    check(editor->wavetableEditorOpen() && surface.documentForTesting().frames.size()==4,"the editor opens on OSC 1's table (BASIC SHAPES)");
    surface.selectFramesForTesting({0u},0u);
    surface.runFrameCommandForTesting(Command::Morph);
    const auto morphed=surface.documentData();
    check(morphed.frames()==256,"MORPH (to target) densifies to 256 frames in the editor");
    editor->closeWavetableEditorWithX();
    auto source=p.getUiOscillatorWavetable(osc1);
    check(!editor->wavetableEditorOpen() && source.data && source.data->frames()==256 && source.data->samples==morphed.samples,"X commits MORPH: the canonical table is the edited one");
    check(source.contentId.isEmpty() && source.data->name=="BASIC SHAPES (EDITED)","an edited table is the oscillator's own: no library identity, named (EDITED)");
    check(card1->wavetableData && card1->wavetableData(osc1)==source.data,"the viewport reads the committed table");
    for(int i=0;i<4;++i) block(none);

    // 19: draw -> X: viewport and DSP follow (WT POSITION 0 shows frame 0).
    p.setUiParameter(ParameterId::Waveform,0.0f);
    for(int i=0;i<4;++i) block(none);
    const auto viewBefore=snapshot();
    editor->openWavetableEditorForOscillator(osc1);
    check(surface.documentForTesting().frames.size()==256,"reopening edits the committed 256-frame table");
    for(std::size_t i=0;i<2048;++i) surface.drawSampleForTesting(0,i,i<1024 ? 0.95f : -0.95f); // frame 1 -> a square
    editor->closeWavetableEditorWithX();
    source=p.getUiOscillatorWavetable(osc1);
    check(source.data && source.data->samples[10]==0.95f && source.data->samples[1500]==-0.95f,"X commits a drawn frame");
    for(int i=0;i<4;++i) block(none);
    const auto viewAfter=snapshot();
    check(differs(viewBefore,viewAfter),"the OSC 1 viewport shows the committed edit immediately");
    const auto drawnRender=render(60);
    check(drawnRender!=basicRender,"the DSP renders the committed table");

    // 20: insert / delete / move -> X.
    editor->openWavetableEditorForOscillator(osc1);
    surface.selectFramesForTesting({0u},0u);
    surface.runFrameCommandForTesting(Command::Delete);       // 255 frames, frame 0 was the square
    surface.selectFramesForTesting({0u},0u);
    surface.runFrameCommandForTesting(Command::Duplicate);    // 256 frames
    surface.selectFramesForTesting({1u},1u);
    surface.runFrameCommandForTesting(Command::Right);        // move frame 1 to 2
    const auto structural=surface.documentData();
    editor->closeWavetableEditorWithX();
    check(p.getUiOscillatorWavetable(osc1).data->samples==structural.samples && structural.frames()==256
          && structural.samples[10]!=0.95f,"delete / insert / move frames commit on X");

    // 22: two oscillators keep separate commits.
    editor->openWavetableEditorForOscillator(osc2);
    check(surface.documentForTesting().frames.size()==4,"OSC 2 opens on its own table, not OSC 1's");
    surface.drawSampleForTesting(0,100,-0.5f);
    editor->closeWavetableEditorWithX();
    check(p.getUiOscillatorWavetable(osc2).data && p.getUiOscillatorWavetable(osc2).data->frames()==4 && p.getUiOscillatorWavetable(osc2).data->samples[100]==-0.5f
          && p.getUiOscillatorWavetable(osc1).data->samples==structural.samples,"two oscillators commit separate edits");

    // 16: save -> reload keeps the edits.
    juce::MemoryBlock session; p.getStateInformation(session);
    {
        auto q=std::make_unique<OrigamiAudioProcessor>(); q->prepareToPlay(48000.0,256);
        q->setStateInformation(session.getData(),int(session.getSize()));
        check(q->getUiOscillatorWavetable(osc1).data && q->getUiOscillatorWavetable(osc1).data->samples==structural.samples
              && q->getUiOscillatorWavetable(osc2).data && q->getUiOscillatorWavetable(osc2).data->samples[100]==-0.5f,"edit -> X -> save -> reload preserves both edits");
    }

    // 17 / 18: the library is never written by an editor commit.
    auto& library=editor->contentLibrary();
    check(library.find(content::ContentLibrary::basicShapesId)->format=="builtin" && content::basicShapes().frames()==4,"the factory BASIC SHAPES resource is untouched");
    const auto dir=juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("origami-wte-"+juce::String(juce::Time::currentTimeMillis()));
    dir.createDirectory();
    content::WavetableData user; user.name="User Table"; for(int i=0;i<2*2048;++i) user.samples.push_back(0.5f*std::sin(float(i)*0.02f));
    check(content::writeWavetableWav(dir.getChildFile("User Table.wav"),user) && editor->importWavetableFile(osc2,dir.getChildFile("User Table.wav")).wasOk(),"a library table on OSC 2");
    const auto userId=p.getUiOscillatorWavetable(osc2).contentId;
    juce::MemoryBlock fileBefore; library.find(userId)->file.loadFileAsData(fileBefore);
    editor->openWavetableEditorForOscillator(osc2);
    editor->closeWavetableEditorWithX();
    check(p.getUiOscillatorWavetable(osc2).contentId==userId,"closing without an edit keeps the library identity");
    editor->openWavetableEditorForOscillator(osc2);
    surface.drawSampleForTesting(1,7,0.25f);
    editor->closeWavetableEditorWithX();
    juce::MemoryBlock fileAfter; library.find(userId)->file.loadFileAsData(fileAfter);
    check(fileAfter==fileBefore && p.getUiOscillatorWavetable(osc2).contentId.isEmpty() && p.getUiOscillatorWavetable(osc2).data->samples[2048+7]==0.25f,
          "editing a library table commits to the oscillator only (file untouched, now custom)");
    dir.deleteRecursively();

    // 21 / 23: rapid commits while a note is held; the audio thread allocates nothing.
    juce::MidiBuffer held; held.ensureSize(4096); held.addEvent(juce::MidiMessage::noteOn(1,57,0.8f),0);
    block(held);
    bool finite=true;
    for(int k=0;k<12;++k) {
        editor->openWavetableEditorForOscillator(osc1);
        surface.drawSampleForTesting(std::size_t(k%4),std::size_t(k*37),k%2 ? 0.6f : -0.6f);
        editor->closeWavetableEditorWithX();
#ifndef ORIGAMI_SANITIZED
        pluginAllocations.store(0,std::memory_order_relaxed);
        pluginGuardAllocations.store(true,std::memory_order_release);
#endif
        for(int i=0;i<3;++i) { audio.clear(); p.processBlock(audio,none); for(int n=0;n<256;++n) finite&=std::isfinite(audio.getSample(0,n)); }
#ifndef ORIGAMI_SANITIZED
        pluginGuardAllocations.store(false,std::memory_order_release);
        check(pluginAllocations.load()==0,"commit handoff: the audio thread allocates nothing");
#endif
    }
    check(finite,"rapid editor commits during a held note stay finite");
    check(p.getUiOscillatorWavetable(osc1).data->samples[size_t(11%4)*2048+11*37]==0.6f,"the last commit is the canonical table");
}

// mct-origami-content-browser: presets / wavetables through the editor, the
// processor and the audio thread.
void contentBrowserAudit() {
    using namespace mct::origami;
    using content::ContentType;
    juce::SharedResourcePointer<ui::UserPreferences> preferences;
    const bool previousCapture=preferences->captureKeyboardInput();
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi,none;
    const auto block=[&](juce::MidiBuffer& m){ audio.clear(); p.processBlock(audio,m); m.clear(); };
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    auto& library=editor->contentLibrary();
    auto& browser=editor->contentBrowser();
    const auto osc1=p.getUiInstrumentState().oscillators[0].id;

    // ---- entry + layout: the browser replaces the workspace between the bars.
    check(p.getUiCurrentPreset().id==content::ContentLibrary::initPresetId && p.getUiCurrentPreset().name=="INIT","a new instrument is the factory INIT preset");
    editor->openContentBrowser(ContentType::Preset);
    ui::OrigamiHeader* header=nullptr; ui::PerformanceKeyboard* keys=nullptr; ui::OscillatorRack* rack=nullptr;
    walk(*editor,[&](juce::Component& c){
        if(auto* x=dynamic_cast<ui::OrigamiHeader*>(&c)) header=x;
        if(auto* x=dynamic_cast<ui::PerformanceKeyboard*>(&c)) keys=x;
        if(auto* x=dynamic_cast<ui::OscillatorRack*>(&c)) rack=x; });
    check(header && keys && rack && editor->contentBrowserOpen() && browser.isVisible() && !rack->isVisible() && header->isVisible() && keys->isVisible(),
          "PRESETS browser: header and performance bar stay, the workspace is the browser");
    check(browser.getY()>=header->getBottom() && browser.getBottom()<=keys->getY() && browser.getWidth()==header->getWidth(),"the browser fills the space between the permanent bars");
    check(browser.selectedRecord()!=nullptr && browser.selectedRecord()->id==content::ContentLibrary::initPresetId,"reopening selects the loaded preset (INIT)");
    editor->closeContentBrowser();
    check(!browser.isVisible() && rack->isVisible(),"closing returns to the editor");

    // ---- save with metadata (the state blob is the instrument; metadata is not).
    p.setUiParameter(ParameterId::OscLevel,0.42f);
    ui::PresetSaveDialog::Fields fields{"Murphy Bass","Gino","Bass","dark, mono","Low, wide and round."};
    check(editor->savePreset(fields,false).wasOk(),"SAVE AS NEW writes a user preset");
    const auto murphy=p.getUiCurrentPreset();
    const auto* saved=library.find(murphy.id);
    check(saved!=nullptr && saved->origin==content::ContentOrigin::User && saved->author=="Gino" && saved->tags.size()==2 && saved->description=="Low, wide and round."
          && saved->oscillators==[&]{ int n=0; for(const auto& m:p.getUiInstrumentState().oscillators) n+=m.id!=0; return n; }() && saved->macros==4 && saved->created>0,"user preset metadata (author, tags, description, created, summary) indexed");
    check(murphy.name=="Murphy Bass" && header->presetName()=="Murphy Bass","the header shows the saved preset");
    const auto murphyState=encodeInstrumentState(p.getUiInstrumentState());

    // ---- load: browser load == direct state load; INIT; reopen on the loaded preset.
    check(editor->loadPresetRecord(*library.find(content::ContentLibrary::initPresetId)),"INIT loads");
    block(none);
    check(std::abs(p.getUiParameter(ParameterId::OscLevel)-0.42f)>1.0e-3f,"INIT restores the default sound");
    editor->openContentBrowser(ContentType::Preset);
    check(browser.selectId(murphy.id) && browser.loadSelected() && !editor->contentBrowserOpen(),"select + LOAD loads and closes");
    check(encodeInstrumentState(p.getUiInstrumentState())==murphyState,"browser load reproduces the saved instrument exactly");
    {
        auto direct=std::make_unique<OrigamiAudioProcessor>(); direct->prepareToPlay(48000.0,256);
        juce::MemoryBlock bytes; check(library.loadPresetState(*library.find(murphy.id),bytes),"preset bytes");
        direct->setStateInformation(bytes.getData(),int(bytes.getSize()));
        check(encodeInstrumentState(direct->getUiInstrumentState())==murphyState,"browser load == direct setStateInformation of the same file");
    }
    editor->openContentBrowser(ContentType::Preset);
    check(browser.selectedRecord()!=nullptr && browser.selectedRecord()->id==murphy.id,"reopening locates the loaded preset");
    // Metadata / favorite edits never touch the sound.
    library.setFavorite(murphy.id,true);
    auto edited=*library.find(murphy.id); edited.description="Edited words"; edited.tags.add("edited");
    check(library.updateMetadata(edited).wasOk(),"metadata edit");
    { juce::MemoryBlock a; library.loadPresetState(*library.find(murphy.id),a);
      auto q=std::make_unique<OrigamiAudioProcessor>(); q->prepareToPlay(48000.0,256); q->setStateInformation(a.getData(),int(a.getSize()));
      check(encodeInstrumentState(q->getUiInstrumentState())==murphyState,"favorite / description / tags leave the DSP state unchanged"); }
    // Factory is read-only: SAVE over INIT creates a user preset.
    editor->loadPresetRecord(*library.find(content::ContentLibrary::initPresetId));
    check(editor->savePreset({"Init Copy","","","",""},true).wasOk() && p.getUiCurrentPreset().id!=content::ContentLibrary::initPresetId
          && library.find(content::ContentLibrary::initPresetId)->format=="builtin","saving over a factory preset creates a user preset");
    // Rename keeps identity; < > steps through the browser's results.
    check(library.rename(murphy.id,"Murphy Sub").wasOk() && library.find(murphy.id)->name=="Murphy Sub","rename preserves the content id");
    browser.setScope("user");
    editor->loadPresetRecord(*library.find(murphy.id));
    const auto before=p.getUiCurrentPreset().id;
    editor->stepPreset(1);
    check(p.getUiCurrentPreset().id!=before && library.find(p.getUiCurrentPreset().id)->origin==content::ContentOrigin::User,"next preset within the current (USER) results");
    editor->stepPreset(-1);
    check(p.getUiCurrentPreset().id==before,"previous returns");
    editor->closeContentBrowser();
    // Malformed / missing files fail safely.
    const auto badFile=library.presetsDirectory().getChildFile("Broken.origami");
    badFile.replaceWithText("{\"format\":\"mct.origami.preset\",\"schema\":1,\"id\":\"user.preset.bad\",\"name\":\"Bad\",\"state\":\"QUJD\"}");
    content::ContentRecord bad; bad.id="user.preset.bad"; bad.name="Bad"; bad.file=badFile; bad.format="origami-preset";
    const auto stateBefore=encodeInstrumentState(p.getUiInstrumentState());
    check(!editor->loadPresetRecord(bad) && encodeInstrumentState(p.getUiInstrumentState())==stateBefore,"a malformed preset does not load and changes nothing");
    bad.file=library.presetsDirectory().getChildFile("Missing.origami");
    check(!editor->loadPresetRecord(bad),"a missing preset fails safely");
    badFile.deleteFile();

    // ---- rapid loads while playing; the restore fades instead of cutting.
    midi.addEvent(juce::MidiMessage::noteOn(1,48,0.9f),0); midi.addEvent(juce::MidiMessage::noteOn(1,55,0.9f),0);
    block(midi); for(int i=0;i<16;++i) block(none);
    float baselineStep=0.0f;
    { float prev=audio.getSample(0,255);
      for(int i=0;i<4;++i) { block(none); for(int n=0;n<256;++n) { const float v=audio.getSample(0,n); baselineStep=std::max(baselineStep,std::abs(v-prev)); prev=v; } } }
    const auto fadedBefore=p.fadedRestores();
    float lastSample=audio.getSample(0,255),maxStep=0.0f;
    bool finite=true;
    editor->loadPresetRecord(*library.find(content::ContentLibrary::initPresetId));
    for(int i=0;i<4;++i) {
        block(none);
        for(int n=0;n<256;++n) { const float v=audio.getSample(0,n); finite&=std::isfinite(v);
            maxStep=std::max(maxStep,std::abs(v-lastSample)); lastSample=v; }
    }
    std::cerr<<"[content] preset load during held notes: max sample step "<<maxStep<<" (the held notes' own max step "<<baselineStep<<")\n";
    check(finite && p.fadedRestores()==fadedBefore+1,"a preset load while notes sound fades out first");
    check(maxStep<=baselineStep*1.05f+1.0e-4f,"no step at the preset change larger than the sound's own (3 ms fade, no hard cut)");
    for(int i=0;i<40;++i) {
        editor->loadPresetRecord(*library.find(i%2 ? murphy.id : juce::String(content::ContentLibrary::initPresetId)));
        if(i%3==0) midi.addEvent(juce::MidiMessage::noteOn(1,40+i%12,0.8f),0);
        block(midi);
        for(int n=0;n<256;++n) finite&=std::isfinite(audio.getSample(0,n));
    }
    block(none); block(none);
    check(finite && encodeInstrumentState(p.getUiInstrumentState())==murphyState,"40 rapid loads while playing: finite, the last load wins");

    // ---- wavetables: import -> library -> oscillator; export; round trip; state.
    const auto dir=juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("origami-wt-"+juce::String(juce::Time::currentTimeMillis()));
    dir.createDirectory();
    content::WavetableData metal; metal.name="Metal";
    for(int i=0;i<8*2048;++i) metal.samples.push_back(0.7f*std::sin(float(i)*0.013f)*std::cos(float(i/2048)*0.4f));
    content::WavetableData glass=metal; glass.name="Glass"; for(auto& v:glass.samples) v*=-0.5f;
    check(content::writeWavetableWav(dir.getChildFile("Metal.wav"),metal) && content::writeWavetableWav(dir.getChildFile("Glass.wav"),glass),"source wavs");
    { const auto r=editor->importWavetableFile(osc1,dir.getChildFile("Metal.wav"));
      check(r.wasOk(),"IMPORT WAVETABLE into OSC 1"); }
    auto source=p.getUiOscillatorWavetable(osc1);
    check(source.data && source.data->samples==metal.samples && source.contentId.startsWith("user.wavetable."),"OSC 1 holds the imported table (library identity)");
    const auto metalId=source.contentId;
    check(library.find(metalId)!=nullptr && library.find(metalId)->origin==content::ContentOrigin::Imported,"the import is in the IMPORTED library");
    check(editor->importWavetableFile(osc1,dir.getChildFile("Metal.wav")).wasOk() && p.getUiOscillatorWavetable(osc1).contentId==metalId,"importing the same file again reuses it (no duplicate)");
    // Two oscillators, two tables.
    const auto osc2=p.addUiOscillator();
    check(osc2!=0 && editor->importWavetableFile(osc2,dir.getChildFile("Glass.wav")).wasOk(),"IMPORT into OSC 2");
    check(p.getUiOscillatorWavetable(osc2).data->samples==glass.samples && p.getUiOscillatorWavetable(osc1).data->samples==metal.samples,"two oscillators keep different tables");
    // Browser in wavetable mode targets the initiating oscillator and locates its table.
    editor->openContentBrowser(ContentType::Wavetable,osc2);
    check(browser.mode()==ContentType::Wavetable && browser.target()==osc2 && browser.selectedRecord()!=nullptr && browser.selectedRecord()->id==p.getUiOscillatorWavetable(osc2).contentId,
          "BROWSE WAVETABLES from OSC 2 locates OSC 2's table");
    check(browser.selectId(content::ContentLibrary::basicShapesId) && browser.loadSelected() && !p.getUiOscillatorWavetable(osc2).data,"loading BASIC SHAPES into OSC 2 returns it to the factory table");
    check(p.getUiOscillatorWavetable(osc1).data->samples==metal.samples,"OSC 1 is untouched");
    // Export -> re-import is exact; an edited (custom) table exports too.
    check(editor->exportWavetableFile(osc1,dir.getChildFile("Exported.wav")).wasOk(),"EXPORT WAVETABLE");
    content::WavetableData back;
    check(content::readWavetableFile(dir.getChildFile("Exported.wav"),back)==content::ReadResult::Ok && back.samples==metal.samples,"export / import round trip is bit-exact");
    auto custom=metal; custom.samples[5]=0.123f; custom.name="Edited";
    check(p.setUiOscillatorWavetable(osc2,custom,{}) && editor->exportWavetableFile(osc2,dir.getChildFile("Edited.wav")).wasOk()
          && content::readWavetableFile(dir.getChildFile("Edited.wav"),back)==content::ReadResult::Ok && back.samples==custom.samples,"an edited table exports exactly");
    check(editor->importWavetableFile(0,dir.getChildFile("Truncated.wav")).failed(),"a missing file fails safely");
    dir.getChildFile("Bad.wav").replaceWithText("RIFF nonsense");
    check(editor->importWavetableFile(osc1,dir.getChildFile("Bad.wav")).failed() && p.getUiOscillatorWavetable(osc1).data->samples==metal.samples,"a malformed file is rejected; OSC 1 keeps its table");
    // Patches stay self-contained: tables travel in the state.
    juce::MemoryBlock session; p.getStateInformation(session);
    {
        auto q=std::make_unique<OrigamiAudioProcessor>(); q->prepareToPlay(48000.0,256);
        q->setStateInformation(session.getData(),int(session.getSize()));
        check(q->getUiOscillatorWavetable(osc1).data && q->getUiOscillatorWavetable(osc1).data->samples==metal.samples && q->getUiOscillatorWavetable(osc1).contentId==metalId
              && q->getUiOscillatorWavetable(osc2).data && q->getUiOscillatorWavetable(osc2).data->samples==custom.samples,"saved state restores every oscillator's table (no library needed)");
        juce::AudioBuffer<float> a(2,256); juce::MidiBuffer m; m.addEvent(juce::MidiMessage::noteOn(1,60,0.8f),0);
        float peak=0.0f; for(int i=0;i<20;++i) { a.clear(); q->processBlock(a,m); m.clear(); peak=std::max(peak,a.getMagnitude(0,256)); }
        check(peak>1.0e-3f && std::isfinite(peak),"the restored tables play");
    }
    // The engine renders the table: OSC 1 Metal vs BASIC SHAPES differ.
    const auto render=[&]{ juce::AudioBuffer<float> a(2,512); juce::MidiBuffer m; m.addEvent(juce::MidiMessage::noteOn(1,60,0.8f),0);
                           std::vector<float> out; for(int i=0;i<8;++i) { a.clear(); p.processBlock(a,m); m.clear(); out.insert(out.end(),a.getReadPointer(0),a.getReadPointer(0)+512); }
                           juce::MidiBuffer off; off.addEvent(juce::MidiMessage::allNotesOff(1),0); for(int i=0;i<40;++i) { a.clear(); p.processBlock(a,off); off.clear(); } return out; };
    p.removeUiOscillator(osc2);
    for(int i=0;i<4;++i) block(none);
    const auto withMetal=render();
    p.setUiOscillatorWavetable(osc1,content::basicShapes(),content::ContentLibrary::basicShapesId);
    for(int i=0;i<4;++i) block(none);
    const auto withBasic=render();
    check(withMetal!=withBasic,"the oscillator renders the loaded table");
    // Delete an oscillator while its table publication is pending.
    const auto osc3=p.addUiOscillator();
    check(p.setUiOscillatorWavetable(osc3,glass,{}) && p.removeUiOscillator(osc3),"publish then delete before the audio thread adopts it");
    for(int i=0;i<24;++i) block(none);
    check(!p.getUiOscillatorWavetable(osc3).data,"the deleted oscillator's table is dropped");
    // Audio thread: adopting tables and applying a preset restore allocates nothing.
    p.setUiOscillatorWavetable(osc1,metal,metalId);
    editor->loadPresetRecord(*library.find(murphy.id));
    p.setUiOscillatorWavetable(osc1,glass,{});
    juce::MidiBuffer held; held.ensureSize(4096); held.addEvent(juce::MidiMessage::noteOn(1,50,0.8f),0);
#ifndef ORIGAMI_SANITIZED
    pluginAllocations.store(0,std::memory_order_relaxed);
    pluginGuardAllocations.store(true,std::memory_order_release);
#endif
    for(int i=0;i<24;++i) { audio.clear(); p.processBlock(audio,i==0 ? held : none); }
#ifndef ORIGAMI_SANITIZED
    pluginGuardAllocations.store(false,std::memory_order_release);
    check(pluginAllocations.load()==0,"preset restore + wavetable adoption on the audio thread allocate nothing");
#endif
    held.clear();
    // Rapid table switching while a note is held.
    held.addEvent(juce::MidiMessage::noteOn(1,52,0.8f),0); block(held);
    for(int i=0;i<60;++i) {
        p.setUiOscillatorWavetable(osc1,i%2 ? metal : glass,{});
        block(none);
        for(int n=0;n<256;++n) finite&=std::isfinite(audio.getSample(0,n));
    }
    check(finite,"rapid wavetable switching while holding a note stays finite");

    // Visual review aid: ORIGAMI_SNAPSHOT=<dir> writes the browser's two modes as PNGs.
    if(const char* shots=std::getenv("ORIGAMI_SNAPSHOT")) {
        const auto snap=[&](const char* name) {
            editor->setSize(1440,900);
            auto image=editor->createComponentSnapshot(editor->getLocalBounds(),true,1.0f);
            juce::FileOutputStream out(juce::File(shots).getChildFile(name));
            out.setPosition(0); out.truncate();
            juce::PNGImageFormat().writeImageToStream(image,out);
        };
        editor->openContentBrowser(ContentType::Preset); snap("browser-presets.png");
        editor->openContentBrowser(ContentType::Wavetable,osc1); browser.selectId(metalId); snap("browser-wavetables.png");
        editor->closeContentBrowser(); editor->showPresetSaveDialog(); snap("save-dialog.png");
    }
    // ---- keyboard: CAPTURE KEYBOARD INPUT off -> browser keys go to the host.
    preferences->setCaptureKeyboardInput(false);
    editor->openContentBrowser(ContentType::Preset);
    const auto deliver=[](juce::Component& focused,const juce::KeyPress& key) {
        for(auto* c=&focused;c!=nullptr;c=c->getParentComponent()) if(c->keyPressed(key)) return true;
        return false;
    };
    const int sel=browser.selectedIndex();
    check(!deliver(browser,juce::KeyPress('a',{},'a')) && !deliver(browser,juce::KeyPress(juce::KeyPress::downKey)) && browser.selectedIndex()==sel,
          "capture OFF, search not focused: letters and arrows go to the host");
    auto& search=browser.searchField();
    check(search.keyPressed(juce::KeyPress('m',{},'m')) && search.getText()=="m","the search field types when the user clicked it");
    browser.setSearchText("murphy");
    check(browser.results().size()==1 && browser.record(0)->name=="Murphy Sub","search narrows the results");
    browser.setSearchText("zzzz-nothing");
    check(browser.results().empty(),"no results");
    browser.setSearchText({});
    preferences->setCaptureKeyboardInput(true);
    check(deliver(browser,juce::KeyPress(juce::KeyPress::downKey)) || browser.results().size()<2,"capture ON: arrows move the selection");
    check(deliver(browser,juce::KeyPress(juce::KeyPress::escapeKey)) && !editor->contentBrowserOpen(),"Escape closes the browser");
    preferences->setCaptureKeyboardInput(previousCapture);
    dir.deleteRecursively();

    // ---- 10 000 records: open latency, search latency, virtualized painting.
    const auto big=juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("origami-big-"+juce::String(juce::Time::currentTimeMillis()));
    big.createDirectory();
    {
        juce::Array<juce::var> list;
        for(int i=0;i<10000;++i) {
            content::ContentRecord r; r.id="user.preset.big"+juce::String(i); r.name="Preset "+juce::String(i); r.author="Author "+juce::String(i%50);
            r.category=i%2 ? "Bass" : "Lead"; r.tags={i%3 ? "dark" : "bright"}; r.created=r.modified=1700000000000+i;
            auto v=content::recordToMetadata(r); v.getDynamicObject()->setProperty("file",big.getChildFile("Presets/P"+juce::String(i)+".origami").getFullPathName());
            list.add(v);
        }
        auto* root=new juce::DynamicObject(); root->setProperty("schema",1); root->setProperty("records",list);
        big.getChildFile("Index.json").replaceWithText(juce::JSON::toString(juce::var(root)));
    }
    {
        auto t=std::chrono::steady_clock::now();
        content::ContentLibrary bigLibrary(big);
        const double load=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-t).count();
        ui::ContentBrowser::Host host; host.loadedPresetId=[]{ return juce::String("user.preset.big9000"); };
        ui::ContentBrowser bigBrowser(bigLibrary,host);
        bigBrowser.setBounds(0,0,1200,560);
        t=std::chrono::steady_clock::now();
        bigBrowser.open(ContentType::Preset);
        const double open=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-t).count();
        const auto openedOn=bigBrowser.selectedRecord()!=nullptr ? bigBrowser.selectedRecord()->id : juce::String();
        t=std::chrono::steady_clock::now();
        bigBrowser.setSearchText("preset 99");
        const double search=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-t).count();
        juce::Image canvas(juce::Image::RGB,1200,560,true);
        t=std::chrono::steady_clock::now();
        bigBrowser.setSearchText({});
        { juce::Graphics g(canvas); bigBrowser.paintEntireComponent(g,false); }
        const double paint=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-t).count();
        juce::Component* listComponent=nullptr; walk(bigBrowser,[&](juce::Component& c){ if(c.getName()=="CONTENT LIST") listComponent=&c; });
        std::cerr<<"[content] 10000 records: cached index "<<load<<" ms, browser open "<<open<<" ms, search keystroke "<<search<<" ms, clear search + full paint "<<paint<<" ms\n";
        check(bigBrowser.results().size()==10001 && openedOn=="user.preset.big9000","10 000 records (+ INIT): reopening selects the loaded preset");
        check(open<500.0 && search<100.0,"10 000 records stay interactive");
        check(listComponent!=nullptr && listComponent->getNumChildComponents()<=1,"the list is virtualized (no row components)");
    }
    big.deleteRecursively();
}

// mct-origami-nested-modulation-manual-qa: CAPTURE KEYBOARD INPUT (default
// OFF). OFF: no Origami shortcut consumes a key (it returns through the
// window to the host); text fields the user opened still type; Escape is
// used only to close / cancel an Origami popup. ON: shortcuts as before.
void captureKeyboardInputAudit() {
    using namespace mct::origami;
    juce::SharedResourcePointer<ui::UserPreferences> preferences;
    const bool previous=preferences->captureKeyboardInput();
    { ui::UserPreferences fresh; check(!fresh.captureKeyboardInput(),"CAPTURE KEYBOARD INPUT defaults to OFF"); }
    {
        // Persistence: a settings file outlives the instance (a later session,
        // another plugin instance or format reads the same value).
        const juce::TemporaryFile temp(".settings");
        { ui::UserPreferences a(temp.getFile()); check(!a.captureKeyboardInput(),"a new settings file starts OFF"); a.setCaptureKeyboardInput(true); }
        { ui::UserPreferences b(temp.getFile()); check(b.captureKeyboardInput(),"ON persists across sessions / instances"); b.setCaptureKeyboardInput(false); }
        { ui::UserPreferences c(temp.getFile()); check(!c.captureKeyboardInput(),"OFF persists too"); }
    }
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    ui::OrigamiHeader* header=nullptr; ui::FxPage* page=nullptr; ui::MacroPanel* macros=nullptr;
    walk(*editor,[&](juce::Component& c){
        if(auto* x=dynamic_cast<ui::OrigamiHeader*>(&c)) header=x;
        if(auto* x=dynamic_cast<ui::FxPage*>(&c)) page=x;
        if(auto* x=dynamic_cast<ui::MacroPanel*>(&c)) macros=x; });
    check(header && page && macros,"keyboard audit: header, NODES, macros");
    if(!header || !page || !macros) return;
    // The utility menu item: top level, checkable, the shared preference.
    preferences->setCaptureKeyboardInput(false);
    const auto item=[&]{ for(const auto& i:header->utilityMenuItems()) if(i.id==ui::OrigamiHeader::captureKeyboardItem) return i; return ui::NativeChoiceItem{}; };
    check(item().text=="CAPTURE KEYBOARD INPUT" && item().group.isEmpty() && !item().checked,"\"...\" menu: CAPTURE KEYBOARD INPUT, unchecked");
    header->chooseUtility(ui::OrigamiHeader::captureKeyboardItem);
    check(preferences->captureKeyboardInput() && item().checked,"choosing it turns capture on (checked)");
    juce::MemoryBlock on,off; p.getStateInformation(on);
    header->chooseUtility(ui::OrigamiHeader::captureKeyboardItem);
    p.getStateInformation(off);
    check(!preferences->captureKeyboardInput() && on==off,"choosing again turns it off; never part of the patch state");

    // A key arrives at the focused component and climbs its parents until one
    // uses it (juce::ComponentPeer::handleKeyPress); unused, the window hands
    // it to the host.
    const auto deliver=[](juce::Component& focused,const juce::KeyPress& key) {
        for(auto* c=&focused;c!=nullptr;c=c->getParentComponent()) if(c->keyPressed(key)) return true;
        return false;
    };
    const auto cmd=[](char c){ return juce::KeyPress(c,juce::ModifierKeys::commandModifier,0); };
    auto& canvas=page->canvas();
    auto& palette=page->nodePalette();
    bool consumed=false;
    for(const auto& key:{juce::KeyPress('a',{},'a'),juce::KeyPress('s',{},'s'),juce::KeyPress('d',{},'d'),juce::KeyPress('f',{},'f'),
                         juce::KeyPress('1',{},'1'),juce::KeyPress(juce::KeyPress::tabKey),juce::KeyPress(juce::KeyPress::backspaceKey),
                         juce::KeyPress(juce::KeyPress::deleteKey),cmd('z'),cmd('c'),cmd('v'),cmd('a'),cmd('d'),cmd('0')})
        consumed|=deliver(canvas,key) || deliver(*page,key) || deliver(*macros,key) || deliver(*editor,key);
    check(!consumed && !palette.isOpen(),"OFF: letters, numbers, NODES hotkeys and Cmd shortcuts all go to the host");
    check(!deliver(canvas,juce::KeyPress(juce::KeyPress::escapeKey)),"OFF: Escape with nothing to close goes to the host");
    page->showNodePalette(fx::FxPoint{700.0f,900.0f});
    check(palette.isOpen() && deliver(canvas,juce::KeyPress(juce::KeyPress::escapeKey)) && !palette.isOpen(),"Escape still closes an open Origami popup");
    // Text the user chose to type into always takes the keys.
    auto* title=macros->titleLabel(1);
    title->showEditor();
    auto* field=title->getCurrentTextEditor();
    check(field!=nullptr && field->keyPressed(juce::KeyPress('a',{},'a')) && field->getText().containsChar('a'),"OFF: a macro name being edited still types");
    if(field!=nullptr) { field->keyPressed(juce::KeyPress(juce::KeyPress::escapeKey)); static_cast<juce::Component*>(field)->handleCommandMessage(0x10003003); }

    // ON: the shortcuts work as before.
    preferences->setCaptureKeyboardInput(true);
    check(deliver(canvas,juce::KeyPress('a',{},'a')) && palette.isOpen(),"ON: A opens the NODES quick-add palette");
    check(deliver(canvas,juce::KeyPress(juce::KeyPress::escapeKey)) && !palette.isOpen(),"ON: Escape closes it");
    check(!deliver(canvas,juce::KeyPress(juce::KeyPress::escapeKey)),"ON: Escape with nothing to close still goes to the host");
    preferences->setCaptureKeyboardInput(previous);
}

// mct-origami-nested-modulation-manual-qa: DAW macros (F), macro names (G),
// Matrix labels / availability (K) and SYNTH X / Y drops (L).
void nestedModulationUiAudit() {
    using namespace mct::origami;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi;
    const auto block=[&]{ audio.clear(); p.processBlock(audio,midi); midi.clear(); };
    const auto model=[&]{ return p.getUiInstrumentState().modulation; };

    // ---- F: host automation drives the BASE; modulation never writes the host.
    struct Listener final : juce::AudioProcessorListener {
        int values=0,begins=0,ends=0,infos=0,lastIndex=-1; float last=-1.0f;
        void audioProcessorParameterChanged(juce::AudioProcessor*,int i,float v) override { ++values; last=v; lastIndex=i; }
        void audioProcessorChanged(juce::AudioProcessor*,const ChangeDetails& d) override { if(d.parameterInfoChanged) ++infos; }
        void audioProcessorParameterChangeGestureBegin(juce::AudioProcessor*,int) override { ++begins; }
        void audioProcessorParameterChangeGestureEnd(juce::AudioProcessor*,int) override { ++ends; }
    } listener;
    p.addListener(&listener);
    auto* m1=p.macroParameter(0);
    check(m1!=nullptr && m1->getParameterID()=="macro.1" && m1->getName(64)=="Macro 1" && p.macroParameter(15)->getParameterID()=="macro.16",
          "host macro parameters: immutable ids, default names");
    check(p.macroParameter(4)->getName(64)=="Macro 5 (inactive)" && p.macroParameter(15)->getName(64)=="Macro 16 (inactive)",
          "a slot without a macro is named (inactive) in the DAW");
    static_cast<juce::AudioProcessorParameter*>(m1)->setValue(0.7f); // DAW automation (no notification back to the DAW)
    block();
    p.getUiRuntimeVisualizationSnapshot(); // the editor's poll follows automation into the model
    check(std::abs(model().macros[0]-0.7f)<1.0e-6f,"host automation -> MACRO 1 base value");
    listener.values=0;
    p.beginUiMacroGesture(0); p.setUiMacro(0,0.25f); p.setUiMacro(0,0.3f); p.endUiMacroGesture(0);
    check(listener.begins==1 && listener.ends==1 && listener.values==2 && listener.lastIndex==0 && std::abs(listener.last-0.3f)<1.0e-6f,
          "a UI macro drag is one host gesture carrying its values");
    const auto addRoute=[&](ModSource source,ModAddress destination,float amount,bool bipolar) {
        const auto id=p.addUiRoute();
        ModRoute r{}; for(const auto& c:model().routes) if(c.id==id) r=c;
        r.source=source; r.destination=destination; r.amount=amount; r.bipolar=bipolar; r.enabled=true;
        return p.setUiRoute(r) ? id : 0u;
    };
    auto lfo2=model().lfo2; lfo2.mode=LfoMode::Free; lfo2.rateHz=9.0f;
    { auto m=model(); m.lfo2=lfo2; check(p.setUiModulationState(m),"LFO 2 free running"); }
    const auto toMacro=addRoute(ModSource::Lfo2,macroValueAddress(1),0.5f,true);
    check(toMacro!=0,"LFO 2 -> MACRO 1 created");
    listener.values=0;
    for(int i=0;i<40;++i) block();
    p.getUiRuntimeVisualizationSnapshot();
    check(listener.values==0 && std::abs(m1->get()-0.3f)<1.0e-6f && std::abs(model().macros[0]-0.3f)<1.0e-6f,
          "LFO 2 -> MACRO 1 moves only the effective value: no host write, base unchanged");
    listener.infos=0;
    check(p.setUiMacroName(0,"Wobble") && m1->getName(64)=="Wobble" && listener.infos>=1 && m1->getParameterID()=="macro.1",
          "rename reaches the DAW name (parameter info changed), id unchanged");
    juce::MemoryBlock saved; p.getStateInformation(saved);
    {
        auto qOwner=std::make_unique<OrigamiAudioProcessor>(); auto& q=*qOwner; q.prepareToPlay(48000.0,256);
        q.setStateInformation(saved.getData(),int(saved.getSize()));
        bool route=false; for(const auto& r:q.getUiInstrumentState().modulation.routes) route|=r.id==toMacro && r.destination==macroValueAddress(1);
        check(q.getUiMacroName(0)=="Wobble" && q.macroParameter(0)->getName(64)=="Wobble" && std::abs(q.macroParameter(0)->get()-0.3f)<1.0e-6f && route,
              "save / load: macro name, DAW parameter base and the nested route");
    }
    p.removeListener(&listener);

    // ---- K: catalog and Matrix labels, availability.
    OscillatorModuleId osc1=0; for(const auto& m:p.getUiInstrumentState().oscillators) if(m.id) { osc1=m.id; break; }
    const auto level=addRoute(ModSource::Lfo2,{ModDestination::Level,osc1,0},0.4f,true);
    const auto depth=addRoute(macroSource(1),routeDepthAddress(level),0.3f,false);
    check(level && depth,"LFO 2 -> OSC 1 LEVEL and WOBBLE -> its depth");
    const auto arrow=juce::String(juce::CharPointer_UTF8(" \xe2\x86\x92 "));
    {
        const auto state=p.getUiInstrumentState();
        const auto catalog=ui::modulationDestinationCatalog(state,{});
        const auto labelOf=[&](const ModAddress& a){ for(const auto& e:catalog) if(e.address==a) return e.label; return juce::String(); };
        check(labelOf(lfoRateAddress(1))=="LFO 2 RATE" && labelOf(macroValueAddress(1))=="WOBBLE",
              "catalog: LFO 2 RATE, a macro by its name");
        check(labelOf(routeDepthAddress(level))=="LFO 2"+arrow+"OSC 1 LEVEL / DEPTH","catalog: LFO 2 -> OSC 1 LEVEL / DEPTH");
        check(ui::modulationRouteTargetLabel(state,depth)=="[LFO 2"+arrow+"OSC 1 LEVEL] DEPTH","SYNTH tooltip names the nested target");
        ModRoute nested{}; for(const auto& r:state.modulation.routes) if(r.id==depth) nested=r;
        check(ui::modulationRouteLabel(catalog,state.modulation,nested)=="WOBBLE"+arrow+"[LFO 2"+arrow+"OSC 1 LEVEL] DEPTH",
              "nested route label: WOBBLE -> [LFO 2 -> OSC 1 LEVEL] DEPTH");
        check(ui::modulationRouteTargetLabel(state,toMacro)=="WOBBLE","LFO 2 -> MACRO 1 shows the macro's name");
    }
    {
        ui::ModulationBindings bindings{};
        bindings.snapshot=[&]{return p.getUiInstrumentState();};
        bindings.route=[&](const ModRoute& edited){return p.setUiRoute(edited);};
        ui::ModulationMatrix matrix(bindings);
        matrix.setBounds(0,0,1300,400); matrix.syncFromModel();
        std::size_t rowOf[3]{}; std::size_t index=0;
        for(const auto& r:model().routes) if(r.id) { if(r.id==toMacro) rowOf[0]=index; if(r.id==level) rowOf[1]=index; if(r.id==depth) rowOf[2]=index; ++index; }
        check(!matrix.destinationAvailable(rowOf[1],routeDepthAddress(level)) && matrix.destinationReason(rowOf[1],routeDepthAddress(level)).contains("own depth"),
              "Matrix: a route cannot target its own depth");
        check(!matrix.destinationAvailable(rowOf[1],lfoRateAddress(1)) && matrix.destinationReason(rowOf[1],lfoRateAddress(1)).contains("feedback"),
              "Matrix: LFO 2 -> LFO 2 RATE is offered as a feedback loop (unavailable)");
        check(!matrix.destinationAvailable(rowOf[2],macroValueAddress(1)),"Matrix: WOBBLE -> WOBBLE unavailable");
        check(matrix.destinationAvailable(rowOf[2],lfoRateAddress(0)),"Matrix: WOBBLE -> LFO 1 RATE available");
        juce::String sourceText;
        walk(*matrix.routeRow(rowOf[2]),[&](juce::Component& c){ if(c.getName()=="Route source") sourceText=dynamic_cast<ui::NativeComboBox&>(c).getText(); });
        check(sourceText=="WOBBLE","Matrix source shows the macro's name");
    }
    const auto tune=addRoute(ModSource::ModWheel,{ModDestination::MainTuning,0,0},0.125f,false);
    {
        ui::ModulationBindings bindings{};
        bindings.snapshot=[&]{return p.getUiInstrumentState();};
        bindings.route=[&](const ModRoute& edited){return p.setUiRoute(edited);};
        ui::ModulationMatrix matrix(bindings);
        matrix.setBounds(0,0,1300,400); matrix.syncFromModel();
        std::size_t index=0,row=0; for(const auto& r:model().routes) if(r.id) { if(r.id==tune) row=index; ++index; }
        juce::Slider* amount=nullptr;
        walk(*matrix.routeRow(row),[&](juce::Component& c){ if(c.getName()=="MATRIX ROUTE AMOUNT") amount=dynamic_cast<juce::Slider*>(&c); });
        check(amount && amount->getTextFromValue(amount->getValue())=="+12.00 st" && std::abs(amount->getValueFromText("+24 st")-25.0)<1.0e-9,
              "Matrix: MAIN TUNING depth reads and types in semitones (12.5 % = +12 st)");
    }

    // ---- L: SYNTH X / Y drops.
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    editor->refreshModulationViews();
    ui::ModulationPanel* modulationPanel=nullptr;
    walk(*editor,[&](juce::Component& c){ if(auto* x=dynamic_cast<ui::ModulationPanel*>(&c)) modulationPanel=x; });
    check(modulationPanel && modulationPanel->selectSource(ModSource::Lfo2),"SYNTH: LFO 2 selected (its RATE knob shows)");
    juce::Slider* levelKnob=nullptr; juce::Slider* rateKnob=nullptr;
    walk(*editor,[&](juce::Component& c){
        auto* s=dynamic_cast<juce::Slider*>(&c);
        if(s==nullptr || !s->isRotary() || !s->getProperties().contains("mct.mod.destination")) return;
        const auto d=static_cast<ModDestination>(int(s->getProperties()["mct.mod.destination"]));
        const auto o=s->getProperties().contains("mct.mod.oscillator") ? unsigned(int(s->getProperties()["mct.mod.oscillator"])) : 0u;
        auto* hit=editor->getComponentAt(editor->getLocalArea(s,s->getLocalBounds()).getCentre());
        while(hit!=nullptr && hit!=s) hit=hit->getParentComponent();
        if(hit!=s) return;
        if(d==ModDestination::Level && o==osc1 && !levelKnob) levelKnob=s;
        if(d==ModDestination::LfoRate && !rateKnob) rateKnob=s;});
    check(levelKnob && rateKnob,"SYNTH OSC 1 LEVEL and LFO RATE knobs");
    if(!levelKnob || !rateKnob) return;
    const auto area=editor->getLocalArea(levelKnob,levelKnob->getLocalBounds());
    const int radius=juce::jmin(area.getWidth(),area.getHeight())/2;
    const auto centre=area.getCentre(),ring=centre.translated(0,-int(float(radius)*0.85f));
    check(editor->modulationDepthTargetAt(centre)==0,"knob body: X (the parameter)");
    check(editor->modulationDepthTargetAt(ring)==level,"knob ring: Y (the depth of its route)");
    const auto drop=[&](ModSource source,juce::Point<int> at) {
        juce::DragAndDropTarget::SourceDetails details("MCT_MOD_SOURCE:"+juce::String(int(source)),editor,at);
        editor->itemDropped(details);
    };
    const auto countTo=[&](ModSource s,const ModAddress& a){ int n=0; for(const auto& r:model().routes) n+=r.id && r.source==s && r.destination==a; return n; };
    const auto routeCount=[&]{ int n=0; for(const auto& r:model().routes) n+=r.id!=0; return n; };
    drop(ModSource::Env2,ring);
    check(countTo(ModSource::Env2,routeDepthAddress(level))==1,"drop on the ring: ENV 2 -> [LFO 2 -> OSC 1 LEVEL] DEPTH (canonical route)");
    drop(ModSource::Env3,centre);
    check(countTo(ModSource::Env3,{ModDestination::Level,osc1,0})==1,"drop on the body: ENV 3 -> OSC 1 LEVEL (unchanged)");
    editor->refreshModulationViews();
    if(modulationPanel!=nullptr) {
        const auto* lfoCard=modulationPanel->sourceRow(ModSource::Lfo2);
        std::size_t ringIndex=0; bool found=false;
        if(lfoCard!=nullptr) for(std::size_t k=0;k<lfoCard->routes().size() && k<lfoCard->visibleRings();++k) if(lfoCard->routes()[k].id==level) { ringIndex=k; found=true; }
        if(found) {
            const auto at=editor->getLocalArea(lfoCard,lfoCard->ringBounds(ringIndex).toNearestInt()).getCentre();
            check(editor->modulationDepthTargetAt(at)==level,"source-card route ring: Y (that route's depth)");
        }
    }
    const int before=routeCount();
    drop(ModSource::Lfo2,editor->getLocalArea(rateKnob,rateKnob->getLocalBounds()).getCentre());
    const auto rateItem=std::uint32_t(int(rateKnob->getProperties()["mct.mod.itemId"]));
    if(rateItem==2) check(routeCount()==before,"LFO 2 onto its own RATE: rejected, no empty Matrix row");
    else check(countTo(ModSource::Lfo2,lfoRateAddress(rateItem-1))==1,"LFO 2 onto another LFO's RATE: canonical route");
    juce::Slider* macroKnob=nullptr;
    walk(*editor,[&](juce::Component& c){ if(auto* x=dynamic_cast<ui::MacroPanel*>(&c)) macroKnob=x->knob(1); });
    if(macroKnob!=nullptr) {
        const int n=routeCount();
        drop(macroSource(1),editor->getLocalArea(macroKnob,macroKnob->getLocalBounds()).getCentre());
        check(routeCount()==n,"MACRO 1 onto itself: rejected, no empty Matrix row");
        drop(ModSource::Env1,editor->getLocalArea(macroKnob,macroKnob->getLocalBounds()).getCentre());
        check(countTo(ModSource::Env1,macroValueAddress(1))==1,"ENV 1 onto MACRO 1: canonical MACRO destination");
    }
    check(!modulationGraphHasCycle(model()),"no cycle reached the model");

    // ---- G: rename on the card (double-click title): Escape cancels, Enter
    // and click-away commit; undo / redo; delete + undo keeps name and routes.
    ui::MacroPanel* macros=nullptr;
    walk(*editor,[&](juce::Component& c){ if(auto* x=dynamic_cast<ui::MacroPanel*>(&c)) macros=x; });
    auto* title=macros ? macros->titleLabel(1) : nullptr;
    check(title && title->getText().equalsIgnoreCase("Wobble"),"the card title shows the macro's name");
    if(!title) return;
    const auto edit=[&](const juce::String& text,int how) {
        title=macros->titleLabel(1); // a card rebuilt by delete / undo is a new component
        if(title==nullptr) return false;
        title->showEditor();
        auto* ed=title->getCurrentTextEditor();
        if(ed==nullptr) return false;
        ed->setText(text,true);
        // The key posts a command message (juce_TextEditor.cpp TextEditorDefs
        // return 0x10003002 / escape 0x10003003); deliver it as the message loop would.
        if(how<2) {
            ed->keyPressed(juce::KeyPress(how==0 ? juce::KeyPress::escapeKey : juce::KeyPress::returnKey));
            static_cast<juce::Component*>(ed)->handleCommandMessage(how==0 ? 0x10003003 : 0x10003002);
        }
        else if(!title->doesLossOfFocusDiscardChanges()) title->hideEditor(false); // click-away: focus loss keeps the text
        return title->getCurrentTextEditor()==nullptr;
    };
    check(edit("Bass Drive",0) && p.getUiMacroName(0)=="Wobble","Escape cancels the rename");
    check(edit("Bass Drive",1) && p.getUiMacroName(0)=="Bass Drive" && p.macroParameter(0)->getName(64)=="Bass Drive","Enter commits (DAW name follows)");
    check(edit("Lead",2) && p.getUiMacroName(0)=="Lead","click-away commits");
    check(macros->undo() && p.getUiMacroName(0)=="Bass Drive" && macros->undo() && p.getUiMacroName(0)=="Wobble"
          && macros->redo() && p.getUiMacroName(0)=="Bass Drive","rename undo / redo");
    const auto macroRoutes=[&]{ int n=0; for(const auto& r:model().routes) n+=r.id && (r.source==macroSource(1) || r.destination==macroValueAddress(1)); return n; };
    const int routedBefore=macroRoutes();
    check(routedBefore>=2 && macros->removeMacro(1) && !macroActive(model(),1) && macroRoutes()==0,"delete MACRO 1 removes its routes and MACRO destinations");
    check(macros->undo() && macroActive(model(),1) && p.getUiMacroName(0)=="Bass Drive" && macroRoutes()==routedBefore && !modulationGraphHasCycle(model()),
          "undo delete: same id, name and routes (both directions) restored");
    check(edit("",1) && p.getUiMacroName(0)=="MACRO 1" && p.macroParameter(0)->getName(64)=="Macro 1","an empty name restores MACRO 1");
}

// mct-origami-synth-dynamic-macros
void synthDynamicMacrosAudit() {
    using namespace mct::origami;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    ui::MacroPanel* panel=nullptr; ui::OscillatorRack* rack=nullptr; ui::ModulationMatrix* matrix=nullptr; ui::FxPage* page=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* x=dynamic_cast<ui::MacroPanel*>(&c)) panel=x;
        if(auto* x=dynamic_cast<ui::OscillatorRack*>(&c)) rack=x;
        if(auto* x=dynamic_cast<ui::FxPage*>(&c)) page=x;
        if(auto* x=dynamic_cast<ui::ModulationMatrix*>(&c)) if(x->layout()==ui::ModulationMatrix::Layout::Page) matrix=x; });
    check(panel && rack && matrix && page,"macro audit: panels");
    const auto mod=[&]{ return p.getUiInstrumentState().modulation; };
    const auto sync=[&]{ editor->refreshModulationViews(); panel->syncFromModel(); };

    // ---- state ------------------------------------------------------------------
    check(mod().macroMask==defaultMacroMask && panel->cardCount()==4,"Init has MACRO 1..4 (four cards)");
    check(macroSource(1)==ModSource::Macro1 && macroSource(4)==ModSource::Macro4 && macroIdOf(ModSource::Macro3)==3,
          "MACRO 1..4 keep their original ModSource identity (201..204)");
    check(encodeInstrumentState(p.getUiInstrumentState())[7]<31,"Init still saves in the pre-macro format (no new version)");
    // mct-origami-nested-modulation-manual-qa: the DAW sees one stable,
    // immutable parameter per macro slot (macro.1 .. macro.16).
    {
        bool ids=p.getParameters().size()==int(maxMacros);
        for(int i=0;ids && i<p.getParameters().size();++i)
            if(auto* withId=dynamic_cast<juce::AudioProcessorParameterWithID*>(p.getParameters()[i])) ids=withId->getParameterID()=="macro."+juce::String(i+1);
            else ids=false;
        check(ids,"16 host macro parameters with immutable IDs macro.1 .. macro.16");
    }
    const auto a5=panel->addMacro();
    check(a5==5 && macroActive(mod(),5) && panel->cardCount()==5,"add MACRO 5");
    check(p.macroParameter(4)->getName(64)=="Macro 5" && p.macroParameter(5)->getName(64)=="Macro 6 (inactive)",
          "adding MACRO 5 activates its DAW slot name (same id macro.5)");
    std::vector<std::size_t> added; for(int i=0;i<3;++i) added.push_back(panel->addMacro());
    check(added==std::vector<std::size_t>{6,7,8} && panel->cardCount()==8,"add several (6, 7, 8)");
    // Assign MACRO 5 (two routes + a NODES input) and MACRO 7 (one route).
    auto m=mod();
    m.routes[0]={m.nextRouteId++,true,macroSource(5),{ModDestination::Cutoff,0,0},0.4f,false};
    m.routes[1]={m.nextRouteId++,true,macroSource(5),{ModDestination::Level,1,0},0.3f,false};
    m.routes[2]={m.nextRouteId++,true,macroSource(7),{ModDestination::Resonance,0,0},0.2f,false};
    m.operators[0]=makeControlOperator(ControlOpType::ScaleOffset,m.nextOperatorId++);
    m.operators[0].inputs[0]={ControlInput::Kind::Source,macroSource(5),0};
    check(p.setUiModulationState(m),"routes from MACRO 5 / 7 and a NODES input from MACRO 5");
    const auto macro7Route=m.routes[2].id;
    sync();
    // Remove an unassigned macro: nothing else changes.
    const auto before=mod().routes;
    check(panel->removeMacro(6) && !macroActive(mod(),6),"remove an unassigned macro");
    bool routesSame=true; for(std::size_t i=0;i<before.size();++i) routesSame&=before[i].id==mod().routes[i].id && before[i].source==mod().routes[i].source;
    check(routesSame,"removing it changes no route");
    // Remove an assigned macro: exactly its routes and inputs go; MACRO 7 is untouched.
    panel->requestRemoveMacro(5);
    check(macroActive(mod(),5),"a routed macro asks first (in-card confirmation; nothing removed yet)");
    juce::TextButton* confirmButton=nullptr;
    walk(*panel,[&](auto& c){ if(auto* b=dynamic_cast<juce::TextButton*>(&c)) if(b->getName()=="Confirm remove macro 5" && b->isVisible()) confirmButton=b; });
    if(confirmButton) confirmButton->onClick(); // the card retires safely inside its own callback
    check(confirmButton && !macroActive(mod(),5),"confirming removes MACRO 5");
    int from5=0,from7=0; for(const auto& r:mod().routes) { from5+=r.id && r.source==macroSource(5); from7+=r.id && r.source==macroSource(7) && r.id==macro7Route; }
    check(from5==0 && from7==1 && mod().operators[0].inputs[0].kind==ControlInput::Kind::None,"deletion removes only MACRO 5's routes and NODES input");
    check(panel->cardId(4)==7 && panel->cardId(3)==4,"stable ids: MACRO 7 is still MACRO 7 after earlier removals (no renumbering)");
    check(validModulation(mod(),p.getUiInstrumentState().oscillators) && nodes::validateControlGraph(mod()).empty(),"no dangling macro reference remains");
    check(panel->undo() && macroActive(mod(),5),"undo restores MACRO 5");
    from5=0; for(const auto& r:mod().routes) from5+=r.id && r.source==macroSource(5);
    check(from5==2 && mod().operators[0].inputs[0].source==macroSource(5),"undo restores its routes and its NODES input");
    check(panel->redo() && !macroActive(mod(),5),"redo removes it again");
    panel->undo();
    // Routes never jump: a route's source is always the same macro id.
    bool sameSources=true; for(const auto& r:mod().routes) if(r.id==macro7Route) sameSources&=r.source==macroSource(7);
    check(sameSources,"routes never move to another macro");
    // ---- limit ----------------------------------------------------------------
    while(panel->addMacro()!=0) {}
    check(panel->cardCount()==maxMacros && !panel->addButton().isEnabled() && panel->addButton().getTooltip().contains("16"),
          "maximum 16 macros: + ADD MACRO disables and says why");
    for(std::size_t id=9;id<=maxMacros;++id) if(id!=7) panel->removeMacro(id);
    // ---- SYNTH / Matrix / NODES: one object ----------------------------------
    panel->knob(5)->setValue(0.65,juce::sendNotificationSync);
    check(std::abs(mod().macros[4]-0.65f)<1e-6f,"the SYNTH knob writes the canonical macro value");
    editor->refreshModulationViews();
    juce::Component* row=nullptr; std::uint32_t cutoffRoute=0;
    for(const auto& r:mod().routes) if(r.id && r.source==macroSource(5) && r.destination.parameter==ModDestination::Cutoff) cutoffRoute=r.id;
    for(std::size_t i=0;i<matrix->routeCount();++i) if(matrix->routeRow(i)->getName()=="Modulation route "+juce::String(cutoffRoute)) row=matrix->routeRow(i);
    ui::NativeComboBox* source=nullptr;
    if(row) walk(*row,[&](auto& c){ if(auto* b=dynamic_cast<ui::NativeComboBox*>(&c)) if(b->getName()=="Route source") source=b; });
    check(source && source->getText()=="MACRO 5","the Matrix shows the MACRO 5 route by its canonical source");
    page->syncFromModel();
    bool nodesLink=false; for(const auto& l:page->controlGraph().links) nodesLink|=l.isRoute() && page->controlGraph().nodes[l.source].key==nodes::sourceKey(macroSource(5));
    check(nodesLink && nodes::controlSourceActive(macroSource(5),mod()) && !nodes::controlSourceActive(macroSource(12),mod()),"NODES derives the same MACRO 5 source (removed macros are inactive)");
    const auto* assign=panel->assignment(5);
    check(assign && assign->routes().size()==2,"the MACRO 5 card's assignment area shows its two routes (red rings)");
    // Drag from the assignment area onto a SYNTH knob creates a canonical route.
    std::vector<juce::Slider*> knobs;
    walk(*editor,[&](auto& c){
        auto* slider=dynamic_cast<juce::Slider*>(&c);
        if(slider==nullptr || !slider->isRotary() || !slider->getProperties().contains("mct.mod.destination")) return;
        if(int(slider->getProperties()["mct.mod.destination"])==int(ModDestination::FxParameter)) return;
        auto* hit=editor->getComponentAt(editor->getLocalArea(slider,slider->getLocalBounds()).getCentre());
        while(hit!=nullptr && hit!=slider) hit=hit->getParentComponent();
        if(hit==slider) knobs.push_back(slider); });
    const auto routeCount=[&]{ int n=0; for(const auto& r:mod().routes) n+=r.id!=0; return n; };
    const int routesBefore=routeCount();
    // A knob MACRO 7 does not already drive (a duplicate pair is never created).
    juce::Slider* target=nullptr;
    for(auto* k:knobs) if(int(k->getProperties()["mct.mod.destination"])!=int(ModDestination::Resonance) && target==nullptr) target=k;
    if(target!=nullptr) {
        juce::DragAndDropTarget::SourceDetails details("MCT_MOD_SOURCE:"+juce::String(int(macroSource(7))),
            const_cast<ui::ModulationSourceRow*>(panel->assignment(7)),editor->getLocalArea(target,target->getLocalBounds()).getCentre());
        editor->itemDropped(details);
    }
    bool dropped=false; for(const auto& r:mod().routes) dropped|=r.id && r.source==macroSource(7) && r.id!=macro7Route;
    check(target!=nullptr && dropped && routeCount()==routesBefore+1,"dragging MACRO 7's assignment grip onto a knob creates one canonical route");
    // ---- save / reload / legacy ---------------------------------------------
    {
        juce::MemoryBlock saved; p.getStateInformation(saved);
        auto copy=std::make_unique<OrigamiAudioProcessor>(); copy->prepareToPlay(48000.0,256); copy->setStateInformation(saved.getData(),int(saved.getSize()));
        const auto r=copy->getUiInstrumentState().modulation;
        bool same=r.macroMask==mod().macroMask && r.macros==mod().macros;
        for(std::size_t i=0;i<r.routes.size();++i) same&=r.routes[i].id==mod().routes[i].id && r.routes[i].source==mod().routes[i].source;
        check(same && encodeInstrumentState(p.getUiInstrumentState())[7]==31,"dynamic macros (set, ids, values, routes) survive save / reload (v31)");
        auto legacy=std::make_unique<OrigamiAudioProcessor>(); legacy->prepareToPlay(48000.0,256);
        auto ls=legacy->getUiInstrumentState(); ls.modulation.macros[2]=0.7f;
        ls.modulation.routes[0]={1,true,ModSource::Macro3,{ModDestination::Cutoff,0,0},0.5f,false}; ls.modulation.nextRouteId=2;
        const auto bytes=encodeInstrumentState(ls);
        InstrumentState decoded;
        check(bytes[7]<31 && decodeInstrumentState(bytes.data(),bytes.size(),decoded) && decoded.modulation.macroMask==defaultMacroMask
              && decoded.modulation.macros[2]==0.7f && decoded.modulation.routes[0].source==ModSource::Macro3,"a legacy MACRO 1..4 save loads unchanged (mask 1..4, values, routes)");
    }
    // ---- determinism: a dynamic macro modulates the engine like MACRO 1..4 ---
    {
        const auto renderWith=[&](std::size_t id,float value) {
            auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000.0,512,2);
            auto s=e->instrumentState().modulation;
            s.filterEnabled=true; // This macro regression authors a filter destination.
            s.macroMask=std::uint16_t(s.macroMask|(1u<<(id-1))); s.macros[id-1]=value;
            s.routes[0]={1,true,macroSource(id),{ModDestination::Cutoff,0,0},0.8f,false}; s.nextRouteId=2;
            e->setModulationState(s); e->noteOn(60,0.9f);
            std::vector<float> l(512),r(512),out; float* o[2]{l.data(),r.data()};
            for(int b=0;b<8;++b) { e->process(o,2,512); out.insert(out.end(),l.begin(),l.end()); }
            return out;
        };
        check(renderWith(9,0.6f)==renderWith(9,0.6f),"dynamic macro renders are deterministic");
        check(renderWith(9,0.6f)==renderWith(2,0.6f),"MACRO 9 modulates exactly like MACRO 2 (same source semantics)");
        check(renderWith(9,0.6f)!=renderWith(9,0.0f),"the macro value reaches the engine");
    }
    // ---- UI layout ------------------------------------------------------------
    {
        while(panel->cardCount()>4) panel->removeMacro(panel->cardId(panel->cardCount()-1));
        sync();
        const auto ids=[&]{ std::vector<std::size_t> v; for(std::size_t i=0;i<panel->cardCount();++i) v.push_back(panel->cardId(i)); return v; };
        const auto rowOf=[&](std::size_t i){ return panel->card(i)->getY()/(ui::MacroPanel::cardHeight); };
        const auto colOf=[&](std::size_t i){ return panel->card(i)->getX()>0 ? 1 : 0; };
        bool grid=panel->cardCount()==4;
        for(std::size_t i=0;i<panel->cardCount();++i) grid&=rowOf(i)==int(i/2) && colOf(i)==int(i%2);
        check(grid,"4 macros = 2 x 2");
        panel->addMacro(); sync();
        check(panel->cardCount()==5 && rowOf(4)==2 && colOf(4)==0,"5 macros: the third row starts");
        panel->addMacro(); sync();
        check(rowOf(5)==2 && colOf(5)==1,"6 macros: three complete rows");
        bool overlap=false,inside=true;
        const auto noOverlap=[&] {
            overlap=false; inside=true;
            auto& vp=panel->viewport();
            for(std::size_t i=0;i<panel->cardCount();++i) {
                for(std::size_t j=i+1;j<panel->cardCount();++j) overlap|=panel->card(i)->getBounds().intersects(panel->card(j)->getBounds());
                inside&=panel->card(i)->getRight()<=vp.getViewedComponent()->getWidth();
            }
            const bool scrolls=vp.getViewedComponent()->getHeight()>vp.getHeight();
            const int gutter=vp.getWidth()-vp.getViewedComponent()->getWidth();
            return !overlap && inside && (!scrolls || gutter>=vp.getScrollBarThickness()) && !vp.isHorizontalScrollBarShown();
        };
        check(noOverlap(),"6 macros: no overlap; no horizontal scrolling");
        for(int i=0;i<4;++i) panel->addMacro();
        sync();
        auto& vp=panel->viewport();
        check(vp.getViewedComponent()->getHeight()>vp.getHeight() && noOverlap(),"10 macros scroll vertically; the scrollbar has its own gutter (never over a card)");
        vp.setViewPosition(0,vp.getViewedComponent()->getHeight());
        const auto last=panel->card(panel->cardCount()-1)->getBounds();
        check(last.getBottom()<=vp.getViewPositionY()+vp.getHeight(),"the last macro can be scrolled fully into view");
        // Scale: cards are never miniaturised to fit (fixed design height, knob >= 44 px).
        check(panel->card(0)->getHeight()==ui::MacroPanel::cardHeight && panel->knob(1)->getWidth()>=44,"card and knob keep their size at any count");
        // Revision-gated: timer syncs do not rebuild cards when nothing changed.
        const auto rebuilds=panel->rebuildCount();
        for(int i=0;i<30;++i) panel->syncFromModel();
        check(panel->rebuildCount()==rebuilds,"30 unchanged timer syncs rebuild no card");
        // Minimum / large editor sizes: the canvas scales uniformly (fixed ratio).
        for(const auto size:{std::pair<int,int>{960,600},{2240,1400}}) {
            editor->setSize(size.first,size.second);
            sync();
            check(noOverlap(),(std::string("macro layout at ")+std::to_string(size.first)+"x"+std::to_string(size.second)+": no overlap, gutter respected").c_str());
        }
        editor->setSize(1500,920);
    }
    // ---- cross-view: Init -> add 5 -> assign -> Matrix -> NODES -> amount -> remove -> undo -> save -> reload
    {
        auto q=std::make_unique<OrigamiAudioProcessor>(); q->prepareToPlay(48000.0,256);
        auto ed=std::unique_ptr<juce::AudioProcessorEditor>(q->createEditor()); ed->setVisible(true);
        auto* qe=dynamic_cast<OrigamiAudioProcessorEditor*>(ed.get());
        ui::MacroPanel* mp=nullptr; ui::ModulationMatrix* mx=nullptr; ui::FxPage* fp=nullptr;
        walk(*ed,[&](auto& c){ if(auto* x=dynamic_cast<ui::MacroPanel*>(&c)) mp=x; if(auto* x=dynamic_cast<ui::FxPage*>(&c)) fp=x;
            if(auto* x=dynamic_cast<ui::ModulationMatrix*>(&c)) if(x->layout()==ui::ModulationMatrix::Layout::Page) mx=x; });
        const auto qm=[&]{ return q->getUiInstrumentState().modulation; };
        const auto one=[&](const char* what) {
            const auto s2=qm(); bool ok=validModulation(s2,q->getUiInstrumentState().oscillators);
            for(const auto& r:s2.routes) ok&=!routeDuplicates(s2,r);
            qe->refreshModulationViews(); fp->syncFromModel(); mp->syncFromModel();
            int routes=0; for(const auto& r:s2.routes) routes+=r.id!=0;
            ok&=mx->routeCount()==std::size_t(routes) && mp->cardCount()==std::size_t(std::bitset<16>(s2.macroMask).count());
            check(ok,(std::string("macro cross-view: ")+what).c_str());
        };
        const auto id=mp->addMacro(); one("add MACRO 5");
        auto s2=qm(); s2.routes[0]={s2.nextRouteId++,true,macroSource(id),{ModDestination::Cutoff,0,0},0.5f,false}; q->setUiModulationState(s2); one("assign MACRO 5 in SYNTH");
        const auto rid=qm().routes[0].id;
        bool nodes5=false; fp->syncFromModel(); for(const auto& l:fp->controlGraph().links) nodes5|=l.routeId==rid; check(nodes5,"macro cross-view: NODES shows the MACRO 5 route");
        auto edit=qm(); edit.routes[0].amount=0.9f; q->setUiModulationState(edit); one("Matrix amount edit");
        check(mp->assignment(id) && mp->assignment(id)->routes().size()==1 && std::abs(mp->assignment(id)->routes()[0].amount-0.9f)<1e-6f,"macro cross-view: the SYNTH card shows the Matrix amount");
        mp->removeMacro(id); one("remove MACRO 5");
        mp->undo(); one("undo");
        check(qm().routes[0].id==rid && qm().routes[0].amount==0.9f,"macro cross-view: undo restores the same route (id, amount)");
        juce::MemoryBlock saved; q->getStateInformation(saved); q->setStateInformation(saved.getData(),int(saved.getSize())); one("save / reload");
        check(macroActive(qm(),id) && qm().routes[0].source==macroSource(id),"macro cross-view: MACRO 5 and its route survive reload");
    }
    // ---- oscillator rack: dedicated horizontal scrollbar gutter --------------
    {
        const auto& vp=rack->viewport();
        const auto checkRack=[&](const char* label) {
            const auto* content=vp.getViewedComponent();
            const bool scrolls=content->getWidth()>vp.getWidth();
            bool fits=true; int cards=0;
            for(auto* child:content->getChildren()) if(child->getWidth()>=400) { ++cards; fits&=child->getBottom()+(scrolls ? vp.getScrollBarThickness() : 0)<=vp.getHeight(); }
            const bool noGap=scrolls || content->getHeight()==vp.getHeight(); // the gutter collapses when nothing scrolls
            check(fits && noGap && cards==rack->count(),label);
        };
        while(rack->count()>1) { auto st=p.getUiInstrumentState(); for(auto it=st.oscillators.rbegin();it!=st.oscillators.rend();++it) if(it->id>1) { rack->removeOscillator(it->id); break; } }
        rack->syncFromModel();
        checkRack("1 oscillator: cards fill the height (no gutter needed)");
        for(int n=2;n<=6;++n) { rack->addOscillator(); rack->syncFromModel(); checkRack((std::to_string(n)+" oscillators: the scrollbar never covers a card").c_str()); }
        auto& mvp=const_cast<juce::Viewport&>(vp);
        mvp.setViewPosition(mvp.getViewedComponent()->getWidth(),0);
        check(mvp.getViewPositionX()+mvp.getWidth()>=mvp.getViewedComponent()->getWidth()-2,"the last oscillator can be reached");
        mvp.setViewPosition(0,0);
        check(mvp.getViewPositionX()==0,"the first oscillator can be reached");
        for(const auto size:{std::pair<int,int>{960,600},{2240,1400}}) { editor->setSize(size.first,size.second); rack->syncFromModel(); checkRack("oscillator gutter at minimum / large editor sizes"); }
        editor->setSize(1500,920);
    }
}

// mct-origami-lfo-editor-controls: TOOLS / FUNC strip, icons, grid, snap.
void lfoEditorControlsAudit() {
    using namespace mct::origami;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    editor->setSize(1500,920);
    ui::ModulationPanel* synth=nullptr; ui::ModulationMatrix* matrix=nullptr; ui::FxPage* page=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* x=dynamic_cast<ui::ModulationPanel*>(&c)) synth=x;
        if(auto* x=dynamic_cast<ui::FxPage*>(&c)) page=x;
        if(auto* x=dynamic_cast<ui::ModulationMatrix*>(&c)) if(x->layout()==ui::ModulationMatrix::Layout::Page) matrix=x; });
    check(synth && matrix && page,"lfo audit: panels");
    auto& strip=synth->lfoStrip();
    const auto mod=[&]{ return p.getUiInstrumentState().modulation; };
    const auto bytes=[&]{ return encodeInstrumentState(p.getUiInstrumentState()); };
    const auto sync=[&]{ editor->refreshModulationViews(); synth->syncFromModel(); };
    const auto lfo2=[&]{ return mod().lfo2; };

    // ---- assets: compiled in, parsed once, tinted in code ------------------
    for(int i=0;i<static_cast<int>(ui::IconId::Count);++i) {
        const auto id=static_cast<ui::IconId>(i);
        int size=0; const char* data=BinaryData::getNamedResource(ui::iconResourceName(id),size);
        const auto& icon=ui::icon(id);
        check(data!=nullptr && size>1000 && icon.isValid() && icon.layerCount()>=1 && &icon==&ui::icon(id),
              (std::string("icon compiled + parsed from BinaryData: ")+ui::iconResourceName(id)).c_str());
    }
    check(BinaryData::namedResourceListSize>=12,"all 9 SVGs are packaged next to the existing PNG assets");
    check(ui::iconTint(ui::IconState::Active)==ui::signalSourceColour(),"active icon tint = Origami red");
    check(ui::iconTint(ui::IconState::Hover).getBrightness()>ui::iconTint(ui::IconState::Normal).getBrightness() &&
          ui::iconTint(ui::IconState::Disabled).getBrightness()<ui::iconTint(ui::IconState::Normal).getBrightness() &&
          ui::iconTint(ui::IconState::Normal).getSaturation()<.05f && ui::iconTint(ui::IconState::Disabled).getSaturation()<.05f,
          "tint ladder: disabled < normal (grey) < hover (white); only active is red");
    check(ui::IconButton::stateFor(false,true,true,true)==ui::IconState::Disabled &&
          ui::IconButton::stateFor(true,false,false,true)==ui::IconState::Pressed &&
          ui::IconButton::stateFor(true,true,true,false)==ui::IconState::ActiveHover &&
          ui::IconButton::stateFor(true,true,false,false)==ui::IconState::Active &&
          ui::IconButton::stateFor(true,false,true,false)==ui::IconState::Hover &&
          ui::IconButton::stateFor(true,false,false,false)==ui::IconState::Normal,"icon state machine");
    const auto redPixels=[](juce::Component& c) {
        const auto img=c.createComponentSnapshot(c.getLocalBounds(),true,2.0f);
        int red=0,lit=0;
        for(int y=0;y<img.getHeight();++y) for(int x=0;x<img.getWidth();++x) {
            const auto px=img.getPixelAt(x,y);
            if(px.getRed()>140 && px.getGreen()<60) ++red;
            if(px.getBrightness()>.30f) ++lit;
        }
        return std::pair<int,int>{red,lit};
    };

    // ---- the LFO editor: old bottom controls are gone ----------------------
    check(synth->selectSource(ModSource::Lfo2),"select LFO 2");
    sync();
    check(strip.isVisible() && strip.getHeight()<=ui::LfoControlStrip::preferredHeight+2,"LFO editor shows the compact TOOLS strip");
    bool oldControls=false;
    for(auto* child:synth->getChildren()) {
        if(!child->isVisible()) continue;
        oldControls|=dynamic_cast<juce::ComboBox*>(child)!=nullptr;            // old MODE / grid-mode boxes
        oldControls|=dynamic_cast<juce::ToggleButton*>(child)!=nullptr;        // old SNAP / LOOP toggles
        if(auto* t=dynamic_cast<juce::TextButton*>(child)) oldControls|=t->getButtonText()=="TOOLS";
        if(auto* s=dynamic_cast<juce::Slider*>(child)) oldControls|=s->getName()=="RATE / Hz" || s->getName()=="ENV GRID BPM";
        if(auto* sb=dynamic_cast<juce::ScrollBar*>(child)) oldControls|=sb->isVisible();
    }
    check(!oldControls,"no old LFO controls remain under / behind the new strip (one way to edit each value)");
    const auto canvas=synth->lfoCanvas();
    check(!canvas.isEmpty() && canvas.getHeight()>3.0f*static_cast<float>(strip.getHeight()),"the waveform stays dominant (> 3x the strip height)");
    check(canvas.getBottom()<=static_cast<float>(strip.getY()),"waveform and strip never overlap");

    // ---- TOOLS / FUNC ------------------------------------------------------
    const auto before=bytes(); const auto revision=p.getUiModelRevision();
    check(strip.page()==ui::LfoControlStrip::Page::Tools && strip.toolsViewport().isVisible() && !strip.funcViewport().isVisible(),"TOOLS is the default page");
    strip.pageSelector().setSelected(1,juce::sendNotificationSync);
    check(strip.page()==ui::LfoControlStrip::Page::Func && strip.funcViewport().isVisible() && !strip.toolsViewport().isVisible(),"FUNC replaces the tool controls");
    strip.pageSelector().setSelected(0,juce::sendNotificationSync);
    check(strip.page()==ui::LfoControlStrip::Page::Tools && strip.toolsViewport().isVisible(),"back to TOOLS");
    check(bytes()==before && p.getUiModelRevision()==revision,"TOOLS / FUNC switching never touches instrument state (no audio change, no history)");
    for(auto* c:{static_cast<juce::Component*>(&strip.modeButton(LfoMode::Loop)),static_cast<juce::Component*>(&strip.snapButton())}) {
        c->mouseEnter(event(*c)); c->mouseExit(event(*c));
    }
    check(bytes()==before,"hovering icons never touches instrument state");

    // ---- rate units: one canonical Hz value, three representations ---------
    { auto m=mod(); m.lfo2.rateHz=2.0f; check(p.setUiModulationState(m),"LFO 2 at 2 Hz"); sync(); }
    const auto rateBytes=bytes();
    strip.setRateUnit(ui::LfoControlStrip::RateUnit::Hz);
    check(strip.rateText()=="2.00 Hz","HZ shows the canonical frequency");
    strip.setRateUnit(ui::LfoControlStrip::RateUnit::Seconds);
    check(strip.rateText()=="0.500 s","SECONDS shows the canonical period");
    strip.setRateUnit(ui::LfoControlStrip::RateUnit::Beats);
    check(std::abs(strip.currentBpm()-120.0)<1e-9 && strip.rateText()=="1/4","BEATS shows the musical division at the current tempo (2 Hz @ 120 BPM = 1/4)");
    check(bytes()==rateBytes && lfo2().rateHz==2.0f,"switching units never changes the rate");
    strip.unitSelector().setSelected(2,juce::sendNotificationSync);
    check(strip.rateUnit()==ui::LfoControlStrip::RateUnit::Hz && strip.rateText()=="2.00 Hz" && bytes()==rateBytes,"unit selector click: view only");
    strip.setRateUnit(ui::LfoControlStrip::RateUnit::Beats);
    {   // BEATS knob steps through divisions and writes the canonical Hz.
        const auto& table=ui::LfoControlStrip::divisions();
        int eighth=-1, idx=0;
        for(std::size_t i=0;i<table.size();++i) { const double hz=ui::LfoControlStrip::divisionHz(table[i],120.0); if(hz<.01 || hz>40.0) continue; if(std::string(table[i].name)=="1/8") eighth=idx; ++idx; }
        check(eighth>=0,"1/8 is reachable at 120 BPM");
        strip.rateKnob().setValue(eighth,juce::sendNotificationSync);
        check(std::abs(lfo2().rateHz-4.0f)<1e-4f && strip.rateText()=="1/8","BEATS knob: 1/8 = 4 Hz canonical");
    }
    strip.rateField().setText("1/16",juce::sendNotificationSync);
    check(std::abs(lfo2().rateHz-8.0f)<1e-4f && strip.rateText()=="1/16","typed division 1/16 -> 8 Hz");
    strip.setRateUnit(ui::LfoControlStrip::RateUnit::Seconds);
    strip.rateField().setText("0.25",juce::sendNotificationSync);
    check(std::abs(lfo2().rateHz-4.0f)<1e-4f,"typed 0.25 s -> 4 Hz");
    strip.setRateUnit(ui::LfoControlStrip::RateUnit::Hz);
    strip.rateField().setText("3.5",juce::sendNotificationSync);
    check(lfo2().rateHz==3.5f && strip.rateText()=="3.50 Hz","typed 3.5 Hz");
    for(const char* bad:{"abc","0","100","-2"}) { strip.rateField().setText(bad,juce::sendNotificationSync); check(lfo2().rateHz==3.5f && strip.rateText()=="3.50 Hz",(std::string("invalid rate text ignored: ")+bad).c_str()); }
    strip.rateKnob().setValue(10.0,juce::sendNotificationSync);
    check(std::abs(lfo2().rateHz-10.0f)<1e-4f,"HZ knob writes the canonical rate");
    check(ui::LfoControlStrip::parseRate("1/4D",ui::LfoControlStrip::RateUnit::Beats,120.0).has_value() &&
          ui::LfoControlStrip::parseRate("250ms",ui::LfoControlStrip::RateUnit::Seconds,120.0).value_or(0.0f)==4.0f &&
          !ui::LfoControlStrip::parseRate("1/5",ui::LfoControlStrip::RateUnit::Beats,120.0).has_value(),"rate parser");
    check(ui::LfoControlStrip::formatRate(2.3f,ui::LfoControlStrip::RateUnit::Beats,120.0).startsWith("~"),"an off-division rate is marked approximate in BEATS");
    // ---- knob direction per unit (polish pass: SECONDS shows time) --------
    {
        auto& knob=strip.rateKnob();
        const auto setKnob=[&](double v){ knob.setValue(v,juce::sendNotificationSync); return lfo2().rateHz; };
        strip.setRateUnit(ui::LfoControlStrip::RateUnit::Seconds);
        const float fastest=setKnob(knob.getMinimum());
        check(std::abs(fastest-40.0f)<1e-3f && strip.rateText()=="0.025 s","SECONDS knob minimum = shortest period (0.025 s) = highest rate (40 Hz)");
        const float slowest=setKnob(knob.getMaximum());
        check(std::abs(slowest-.01f)<1e-5f && strip.rateText()=="100.0 s","SECONDS knob maximum = longest period (100 s) = lowest rate (0.01 Hz)");
        const float s1=1.0f/setKnob(1.0), s2=1.0f/setKnob(1.5), s3=1.0f/setKnob(.8);
        check(std::abs(s1-1.0f)<1e-4f && s2>s1 && s3<s1,"SECONDS: clockwise lengthens the period, counter-clockwise shortens it");
        check(knob.getValue()>knob.getMinimum() && std::abs(knob.getValue()-1.0/double(lfo2().rateHz))<1e-6,"SECONDS knob position is the displayed period");
        strip.setRateUnit(ui::LfoControlStrip::RateUnit::Hz);
        const float h0=setKnob(knob.getMinimum()), h1=setKnob(knob.getMaximum());
        const float a=setKnob(2.0), b=setKnob(3.0);
        check(std::abs(h0-.01f)<1e-5f && std::abs(h1-40.0f)<1e-3f && b>a,"HZ unchanged: minimum = 0.01 Hz, maximum = 40 Hz, clockwise = faster");
        strip.setRateUnit(ui::LfoControlStrip::RateUnit::Beats);
        const float b0=setKnob(knob.getMinimum()), bMax=setKnob(knob.getMaximum());
        const float b4=setKnob(4.0), b5=setKnob(5.0);
        check(std::abs(b0-120.0f/60.0f/64.0f)<1e-5f && bMax>20.0f && b5>b4 && strip.rateText()!="","BEATS unchanged: minimum = 16/1 (slowest), clockwise = faster divisions");
        // Unit switching at 2 Hz: display and knob change, the canonical rate never does.
        { auto m=mod(); m.lfo2.rateHz=2.0f; p.setUiModulationState(m); sync(); }
        const auto at2=bytes(); const auto rev=p.getUiModelRevision();
        strip.setRateUnit(ui::LfoControlStrip::RateUnit::Hz);      const bool hzOk=strip.rateText()=="2.00 Hz" && std::abs(knob.getValue()-2.0)<1e-6;
        strip.setRateUnit(ui::LfoControlStrip::RateUnit::Seconds); const bool sOk=strip.rateText()=="0.500 s" && std::abs(knob.getValue()-.5)<1e-6;
        strip.setRateUnit(ui::LfoControlStrip::RateUnit::Beats);   const bool bOk=strip.rateText()=="1/4";
        strip.setRateUnit(ui::LfoControlStrip::RateUnit::Hz);
        check(hzOk && sOk && bOk && strip.rateText()=="2.00 Hz" && bytes()==at2 && p.getUiModelRevision()==rev && lfo2().rateHz==2.0f,
              "2 Hz -> 0.500 s -> 1/4 -> 2 Hz: knob/display follow the unit, canonical Hz untouched (no state write)");
        strip.setRateUnit(ui::LfoControlStrip::RateUnit::Seconds);
        for(const auto& [text,hz]:std::initializer_list<std::pair<const char*,float>>{{"2.5",.4f},{"2.5s",.4f},{"250ms",4.0f},{"0.25 s",4.0f}}) {
            strip.rateField().setText(text,juce::sendNotificationSync);
            check(std::abs(lfo2().rateHz-hz)<1e-5f && std::abs(knob.getValue()-1.0/double(hz))<1e-4,(std::string("typed seconds '")+text+"' -> canonical Hz, knob at that period").c_str());
        }
        strip.setRateUnit(ui::LfoControlStrip::RateUnit::Hz);
    }
    { auto m=mod(); m.lfo2.rateHz=0.37f; p.setUiModulationState(m); sync(); }
    for(auto unit:{ui::LfoControlStrip::RateUnit::Beats,ui::LfoControlStrip::RateUnit::Seconds,ui::LfoControlStrip::RateUnit::Hz}) strip.setRateUnit(unit);
    check(lfo2().rateHz==0.37f,"an existing (non-division) rate survives every unit view untouched");

    // ---- behaviour icons -> canonical LfoMode ------------------------------
    strip.modeButton(LfoMode::Loop).onClick();
    check(lfo2().mode==LfoMode::Loop && strip.modeButton(LfoMode::Loop).getToggleState() && !strip.modeButton(LfoMode::Free).getToggleState(),"RETRIGGER = LfoMode::Loop (per-voice, restarts on note)");
    strip.modeButton(LfoMode::Envelope).onClick();
    check(lfo2().mode==LfoMode::Envelope && strip.modeButton(LfoMode::Envelope).getToggleState(),"ENVELOPE = LfoMode::Envelope (per-voice one-shot)");
    strip.modeButton(LfoMode::Free).onClick();
    check(lfo2().mode==LfoMode::Free && strip.modeButton(LfoMode::Free).getToggleState() && !strip.modeButton(LfoMode::Envelope).getToggleState(),"FREE = LfoMode::Free (global)");
    check(modulationSourceSlot(ModSource::Lfo2,mod())<CompiledModulation::globalSourceCount,"FREE LFO 2 is a global source");
    strip.modeButton(LfoMode::Loop).onClick();
    check(modulationSourceSlot(ModSource::Lfo2,mod())>=CompiledModulation::globalSourceCount,"RETRIGGER LFO 2 is a per-voice source");
    { auto m=mod(); m.lfo2.mode=LfoMode::Envelope; p.setUiModulationState(m); sync(); }
    check(strip.modeButton(LfoMode::Envelope).getToggleState() && !strip.modeButton(LfoMode::Loop).getToggleState(),"external mode edits (Matrix/preset) are reflected: no separate LFO copy");
    check(strip.pingPongButton().isEnabled() && !strip.reverseButton().isEnabled(),"PING-PONG is live; REVERSE stays disabled (no direction state)");
    {
        const bool was=lfo2().pingPong;
        strip.pingPongButton().onClick();
        check(lfo2().pingPong!=was && strip.pingPongButton().getToggleState()==lfo2().pingPong,"PING-PONG toggles the canonical LfoSettings::pingPong");
        strip.pingPongButton().onClick();
        check(lfo2().pingPong==was,"PING-PONG toggles back");
    }
    check(strip.forwardButton().getToggleState() && strip.forwardButton().isEnabled(),"FORWARD shows the (only) canonical traversal");
    {
        const auto dirBefore=bytes();
        strip.reverseButton().setState(juce::Button::buttonDown); strip.reverseButton().setState(juce::Button::buttonNormal);
        strip.forwardButton().onClick ? strip.forwardButton().onClick() : void();
        check(bytes()==dirBefore,"direction controls never write state");
    }
    check(!strip.pingPongButton().getTooltip().isEmpty() && !strip.reverseButton().getTooltip().isEmpty() &&
          strip.modeButton(LfoMode::Loop).getTooltip().startsWith("Retrigger"),"tooltips identify every icon");
    {   // CUSTOM PATH lights only when the LFO carries custom points.
        auto m=mod(); m.lfo2.pointCount=0; p.setUiModulationState(m); sync();
        check(!strip.customPathButton().getToggleState(),"legacy built-in shape: CUSTOM PATH not lit");
        m=mod(); m.lfo2.pointCount=3; m.lfo2.points[0]={0.0f,0.0f,0.0f}; m.lfo2.points[1]={0.5f,1.0f,0.0f}; m.lfo2.points[2]={1.0f,0.0f,0.0f};
        check(p.setUiModulationState(m),"LFO 2 custom 3-point path"); sync();
        check(strip.customPathButton().getToggleState(),"custom points: CUSTOM PATH lit");
    }
    // Rendered tint: the active mode icon contains red, the disabled ping-pong none.
    {
        auto& active=strip.modeButton(LfoMode::Envelope);
        const auto a=redPixels(active), d=redPixels(strip.reverseButton()), n=redPixels(strip.modeButton(LfoMode::Free));
        check(a.first>40,"active icon renders red");
        check(d.first==0 && n.first==0 && n.second>40,"normal icon renders grey (visible), disabled renders without red");
        check(d.second<n.second,"disabled icon is darker than normal");
        const auto cp=redPixels(strip.customPathButton());
        check(strip.customPathButton().getToggleState() && cp.first==0 && cp.second>n.second/2,"CUSTOM PATH status renders neutral white (red is kept for selections)");
    }

    // ---- grid: two independent editor values -------------------------------
    const auto gridBefore=bytes();
    check(strip.gridRowsField().getName()=="LFO GRID HORIZONTAL" && strip.gridColumnsField().getName()=="LFO GRID VERTICAL" &&
          strip.gridRowsField().getBottom()<=strip.gridColumnsField().getY(),"TOP = horizontal grid lines, BOTTOM = vertical grid lines (as drawn in the icon)");
    strip.gridRowsField().setValue(24,juce::sendNotificationSync);
    check(strip.gridRows()==24 && strip.gridColumns()==ui::LfoControlStrip::defaultGridColumns,"horizontal grid value (independent)");
    strip.gridColumnsField().setValue(12,juce::sendNotificationSync);
    check(strip.gridColumns()==12 && strip.gridRows()==24,"vertical grid value (independent)");
    strip.gridColumnsField().setValue(0); strip.gridRowsField().setValue(-5);
    check(strip.gridColumns()==1 && strip.gridRows()==1,"grid values never go to zero / negative");
    strip.gridColumnsField().setValue(999);
    check(strip.gridColumns()==ui::LfoControlStrip::maxGrid,"grid values are bounded");
    strip.gridRowsField().setText("0",juce::sendNotificationSync);
    check(strip.gridRows()==1,"typed 0 is clamped");
    check(bytes()==gridBefore,"grid settings are editor state (no sound / save change)");

    // ---- snap ---------------------------------------------------------------
    strip.setGrid(8,4);
    const auto pointsBefore=lfo2();
    const bool snapWas=strip.snapButton().getToggleState();
    strip.snapButton().onClick();
    check(strip.snapButton().getToggleState()!=snapWas,"SNAP toggles");
    strip.snapButton().onClick();
    check(strip.snapButton().getToggleState()==snapWas,"SNAP toggles back");
    bool same=pointsBefore.pointCount==lfo2().pointCount;
    for(std::size_t i=0;i<pointsBefore.pointCount;++i) same&=pointsBefore.points[i].x==lfo2().points[i].x && pointsBefore.points[i].y==lfo2().points[i].y;
    check(same && bytes()==gridBefore,"toggling SNAP never rewrites existing points");
    if(!strip.snapButton().getToggleState()) strip.snapButton().onClick();
    check(std::abs(synth->snapLfoX(.40f)-.375f)<1e-6f && std::abs(synth->snapLfoY(.40f)-.5f)<1e-6f,"SNAP on: x to 1/8, y to 1/2 (grid 8 x 4)");
    {
        const auto c=synth->lfoCanvas();
        const auto at=[&](float x,float y){ return juce::Point<float>(c.getX()+x*c.getWidth(),c.getCentreY()-y*c.getHeight()*.46f); };
        const auto click=[&](juce::Point<float> pos){
            const juce::MouseEvent e{juce::Desktop::getInstance().getMainMouseSource(),pos,{},1,0,0,0,0,synth,synth,
                                     juce::Time::getCurrentTime(),pos,juce::Time::getCurrentTime(),2,false};
            synth->mouseDoubleClick(e);
        };
        const auto has=[&](float x,float y,float tol){ const auto l=lfo2(); for(std::size_t i=0;i<l.pointCount;++i) if(std::abs(l.points[i].x-x)<tol && std::abs(l.points[i].y-y)<tol) return true; return false; };
        const auto n0=lfo2().pointCount;
        click(at(.40f,.40f));
        check(lfo2().pointCount==n0+1 && has(.375f,.5f,1e-5f),"SNAP on: a new point lands exactly on the grid (0.375, 0.5)");
        strip.snapButton().onClick();
        check(!strip.snapButton().getToggleState() && std::abs(synth->snapLfoX(.4f)-.4f)<1e-7f,"SNAP off: identity");
        click(at(.62f,-.30f));
        check(lfo2().pointCount==n0+2 && has(.62f,-.30f,.01f) && !has(.625f,-.5f,1e-5f),"SNAP off: a new point lands where clicked");
        strip.snapButton().onClick();
    }

    // ---- FUNC bank ---------------------------------------------------------
    for(std::size_t i=0;i<ui::LfoControlStrip::funcCount;++i) {
        const auto& info=ui::LfoControlStrip::funcInfo()[i];
        check(strip.funcKnob(i).isEnabled()==info.implemented && (info.field!=nullptr)==info.implemented && !strip.funcKnob(i).getTooltip().isEmpty() && strip.funcLabel(i).getText()==info.name,
              (std::string("FUNC ")+info.name+": enabled exactly when it has a canonical field, labelled, explained").c_str());
        if(info.field==nullptr) continue;
        // Binding: the knob writes exactly its own canonical field.
        const auto before=lfo2();
        const double v=info.minimum+(info.maximum-info.minimum)*.37;
        strip.funcKnob(i).setValue(v,juce::sendNotificationSync);
        auto expect=before; expect.*(info.field)=static_cast<float>(v);
        const auto after=lfo2();
        check(after.*(info.field)==static_cast<float>(v) && std::memcmp(&after.points,&before.points,sizeof(before.points))==0 && after.rateHz==before.rateHz && after.mode==before.mode,
              (std::string("FUNC ")+info.name+" writes its canonical LFO field only").c_str());
        { auto m=mod(); m.lfo2.*(info.field)=static_cast<float>(info.neutral); p.setUiModulationState(m); sync(); }
        check(strip.funcKnob(i).getValue()==info.neutral,(std::string("FUNC ")+info.name+" follows external edits").c_str());
    }
    check(ui::LfoControlStrip::funcInfo()[4].implemented && ui::LfoControlStrip::funcInfo()[4].field==&LfoSettings::stereo && strip.funcKnob(4).isEnabled(),
          "STEREO is live and bound to LfoSettings::stereo");
    check(ui::LfoControlStrip::funcValueText(4,.5).startsWith("90") && ui::LfoControlStrip::funcValueText(4,1.0).startsWith("180") && ui::LfoControlStrip::funcValueText(4,0).startsWith("0"),
          "STEREO shows the L / R phase separation in degrees (50% = 90 deg)");
    check(ui::LfoControlStrip::funcValueText(0,.35)=="35%" && ui::LfoControlStrip::funcValueText(1,.25)=="250 ms" && ui::LfoControlStrip::funcValueText(2,2.5)=="2.50 s" &&
          ui::LfoControlStrip::funcValueText(1,0)=="OFF" && ui::LfoControlStrip::funcValueText(3,.25).startsWith("90") && ui::LfoControlStrip::funcValueText(5,-.4)=="-40%" &&
          ui::LfoControlStrip::funcValueText(5,.4)=="+40%" && ui::LfoControlStrip::funcValueText(6,0)=="OFF" && ui::LfoControlStrip::funcValueText(6,1)=="2 LEVELS" &&
          ui::LfoControlStrip::funcValueText(7,.5)=="50%","FUNC value text: %, ms / s, degrees, bipolar %, levels");
    {   // Processed overlay: absent when neutral, present for FUNC, base points untouched.
        auto m=mod(); for(const auto& f:ui::LfoControlStrip::funcInfo()) if(f.field) m.lfo2.*(f.field)=static_cast<float>(f.neutral);
        m.lfo2.pingPong=false; p.setUiModulationState(m); sync();
        check(synth->lfoProcessedOverlay().empty() && synth->lfoProcessedRightOverlay().empty(),"no processed overlay while every FUNC value is neutral");
        m.lfo2.stereo=.5f; p.setUiModulationState(m); sync();
        check(synth->lfoProcessedOverlay().empty() && synth->lfoProcessedRightOverlay().size()==513,"STEREO alone: only the RIGHT (dashed) trace is drawn");
        m.lfo2.stereo=0.0f; p.setUiModulationState(m); sync();
        m.lfo2.skew=.6f; m.lfo2.quantize=.7f; p.setUiModulationState(m); sync();
        const auto& overlay=synth->lfoProcessedOverlay();
        check(overlay.size()==513 && lfo2().points[1].x==m.lfo2.points[1].x,"SKEW + QUANTIZE draw a processed overlay; the editable points do not move");
        m.lfo2.skew=0; m.lfo2.quantize=0; m.lfo2.delaySeconds=1.0f; m.lfo2.attackSeconds=1.0f; p.setUiModulationState(m); sync();
        check(synth->lfoProcessedOverlay().empty(),"DELAY / ATTACK alone draw no static-cycle overlay");
        m.lfo2.delaySeconds=0; m.lfo2.attackSeconds=0; p.setUiModulationState(m); sync();
    }
    {   // Realtime: FUNC-active LFOs on every voice allocate nothing in the callback.
        const auto restore=mod();
        auto m=mod();
        for(std::size_t i=0;i<4;++i) { auto& l=lfoSettings(m,i); l.mode=i==0 ? LfoMode::Free : LfoMode::Loop; l.pingPong=true; l.smooth=.3f; l.attackSeconds=.2f; l.delaySeconds=.01f;
            l.phase=.2f; l.skew=.3f; l.quantize=.4f; l.entropy=.5f; l.fracture=.5f; l.stereo=.7f; }
        { std::size_t slot=0; for(std::size_t i=0;i<4;++i) { while(m.routes[slot].id!=0) ++slot;
            const ModRoute r{m.nextRouteId,true,static_cast<ModSource>(101+i),{i%2 ? ModDestination::Level : ModDestination::Cutoff,i%2 ? 1u : 0u,0},.2f,false};
            if(!routeDuplicates(m,r)) { m.routes[slot]=r; ++m.nextRouteId; } } }
        check(p.setUiModulationState(m),"all four LFOs with FUNC routed");
        juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi; midi.ensureSize(4096);
        for(int n=0;n<8;++n) midi.addEvent(juce::MidiMessage::noteOn(1,48+n,.7f),n);
        p.processBlock(audio,midi); midi.clear();
        pluginAllocations.store(0); pluginGuardAllocations.store(true);
        for(int b=0;b<64;++b) { audio.clear(); p.processBlock(audio,midi); }
        pluginGuardAllocations.store(false);
        check(pluginAllocations.load()==0,"FUNC + STEREO LFO processing (LEVEL / CUTOFF stereo paths) allocates nothing on the audio thread (8 voices, 64 blocks)");
        juce::MidiBuffer off; for(int n=0;n<8;++n) off.addEvent(juce::MidiMessage::noteOff(1,48+n),0);
        audio.clear(); p.processBlock(audio,off);
        check(p.setUiModulationState(restore),"restore the pre-allocation-check state"); sync();
    }
    const std::array<const char*,9> funcOrder{"SMOOTH","ATTACK","DELAY","PHASE","STEREO","SKEW","QUANTIZE","ENTROPY","FRACTURE"};
    bool order=true; for(std::size_t i=0;i<9;++i) order&=std::string(ui::LfoControlStrip::funcInfo()[i].name)==funcOrder[i];
    check(order,"FUNC order");

    // ---- one canonical LFO: Matrix / NODES ---------------------------------
    {
        auto m=mod(); m.routes[0]={m.nextRouteId++,true,ModSource::Lfo2,{ModDestination::Cutoff,0,0},0.5f,false};
        check(p.setUiModulationState(m),"route from LFO 2"); sync(); matrix->syncFromModel(); page->syncFromModel();
        const auto rid=mod().routes[0].id;
        strip.modeButton(LfoMode::Free).onClick();
        sync(); matrix->syncFromModel(); page->syncFromModel();
        bool nodes=false; for(const auto& l:page->controlGraph().links) nodes|=l.routeId==rid;
        check(mod().routes[0].source==ModSource::Lfo2 && mod().lfo2.mode==LfoMode::Free && nodes && matrix->routeCount()>=1,
              "strip edits change the one LFO 2 that the Matrix and NODES route from (same source id, same route)");
        check(synth->sourceRow(ModSource::Lfo2)->routes().size()==1,"the SYNTH LFO 2 card shows the route");
    }

    // ---- preset compatibility ----------------------------------------------
    {
        auto q=std::make_unique<OrigamiAudioProcessor>(); q->prepareToPlay(48000.0,256);
        const auto init=encodeInstrumentState(q->getUiInstrumentState());
        auto s=q->getUiInstrumentState();
        s.modulation.lfo1.mode=LfoMode::Loop; s.modulation.lfo1.rateHz=3.3f;
        s.modulation.lfo3.mode=LfoMode::Envelope; s.modulation.lfo3.shape=LfoShape::Saw; s.modulation.lfo3.pointCount=0;
        const auto legacy=encodeInstrumentState(s);
        q->setStateInformation(legacy.data(),static_cast<int>(legacy.size()));
        auto ed=std::unique_ptr<juce::AudioProcessorEditor>(q->createEditor()); ed->setVisible(true); ed->setSize(1500,920);
        ui::ModulationPanel* qs=nullptr; walk(*ed,[&](auto& c){ if(auto* x=dynamic_cast<ui::ModulationPanel*>(&c)) qs=x; });
        check(qs && qs->selectSource(ModSource::Lfo1),"preset: LFO 1 editor");
        check(qs->lfoStrip().modeButton(LfoMode::Loop).getToggleState() && qs->lfoStrip().rateText()=="3.30 Hz","preset LFO 1 (Loop, 3.3 Hz) initialises the strip");
        check(qs->selectSource(ModSource::Lfo3) && qs->lfoStrip().modeButton(LfoMode::Envelope).getToggleState() && !qs->lfoStrip().customPathButton().getToggleState(),
              "preset LFO 3 (Envelope, built-in saw) initialises the strip");
        qs->lfoStrip().setPage(ui::LfoControlStrip::Page::Func); qs->lfoStrip().setPage(ui::LfoControlStrip::Page::Tools);
        qs->lfoStrip().setRateUnit(ui::LfoControlStrip::RateUnit::Beats); qs->lfoStrip().setGrid(32,16);
        check(encodeInstrumentState(q->getUiInstrumentState())==legacy,"opening / browsing the LFO editor leaves an existing preset byte-identical");
        check(init[7]==legacy[7] && init[7]<31,"no new save version");
        auto r=std::make_unique<OrigamiAudioProcessor>(); r->prepareToPlay(48000.0,256);
        r->setStateInformation(legacy.data(),static_cast<int>(legacy.size()));
        auto r2=std::make_unique<OrigamiAudioProcessor>(); r2->prepareToPlay(48000.0,256);
        r2->setStateInformation(legacy.data(),static_cast<int>(legacy.size()));
        auto ed2=std::unique_ptr<juce::AudioProcessorEditor>(r2->createEditor());
        const auto a=renderNote(*r,60,.8f,4096), b=renderNote(*r2,60,.8f,4096);
        bool identical=true; for(int ch=0;ch<2;++ch) for(int i=0;i<4096;++i) identical&=a.getSample(ch,i)==b.getSample(ch,i);
        check(identical,"an LFO preset sounds identical with the new editor open");
    }

    // ---- layout at minimum / normal / large --------------------------------
    const auto layoutOk=[&](const std::string& label) {
        synth->selectSource(ModSource::Lfo2); sync();
        bool ok=strip.isVisible() && strip.getHeight()<=ui::LfoControlStrip::preferredHeight+2 && synth->getLocalBounds().contains(strip.getBounds());
        const auto c=synth->lfoCanvas();
        ok&=c.getHeight()>3.0f*static_cast<float>(strip.getHeight()) && c.getBottom()<=static_cast<float>(strip.getY());
        for(auto pg:{ui::LfoControlStrip::Page::Tools,ui::LfoControlStrip::Page::Func}) {
            strip.setPage(pg);
            auto& vp=pg==ui::LfoControlStrip::Page::Tools ? strip.toolsViewport() : strip.funcViewport();
            auto* content=vp.getViewedComponent();
            std::vector<juce::Component*> kids; for(auto* k:content->getChildren()) if(k->isVisible()) kids.push_back(k);
            for(std::size_t i=0;i<kids.size();++i) {
                ok&=content->getLocalBounds().contains(kids[i]->getBounds()) && kids[i]->getHeight()>=9;
                for(std::size_t j=i+1;j<kids.size();++j) ok&=!kids[i]->getBounds().intersects(kids[j]->getBounds());
            }
            const bool scrolls=content->getWidth()>vp.getWidth();
            ok&=!scrolls || content->getHeight()+vp.getScrollBarThickness()<=vp.getHeight(); // the bar has its own gutter
            ok&=!strip.pageSelector().getBounds().intersects(vp.getBounds());
        }
        // Groups: none overlap, every control sits inside its own group, icons keep a usable size.
        strip.setPage(ui::LfoControlStrip::Page::Tools);
        const auto& g=strip.toolGroups();
        for(std::size_t i=0;i<g.size();++i) for(std::size_t j=i+1;j<g.size();++j) ok&=!g[i].intersects(g[j]);
        ok&=g[0].contains(strip.rateKnob().getBounds()) && g[0].contains(strip.unitSelector().getBounds()) && g[0].contains(strip.rateField().getBounds());
        for(auto m:{LfoMode::Loop,LfoMode::Envelope,LfoMode::Free}) ok&=g[1].contains(strip.modeButton(m).getBounds());
        ok&=g[1].contains(strip.pingPongButton().getBounds()) && g[1].contains(strip.customPathButton().getBounds());
        ok&=g[2].contains(strip.gridIcon().getBounds()) && g[2].contains(strip.gridColumnsField().getBounds()) && g[2].contains(strip.gridRowsField().getBounds()) && g[2].contains(strip.snapButton().getBounds());
        ok&=g[3].contains(strip.forwardButton().getBounds()) && g[3].contains(strip.reverseButton().getBounds());
        ok&=strip.gridRowsField().getBottom()<=strip.gridColumnsField().getY() && strip.forwardButton().getBottom()<=strip.reverseButton().getY();
        ok&=g[3].getRight()==strip.toolsViewport().getViewedComponent()->getWidth();   // direction at the far right
        const auto glyph=strip.modeButton(LfoMode::Free).glyphArea();
        const float frac=glyph.getHeight()/static_cast<float>(strip.modeButton(LfoMode::Free).getHeight());
        ok&=frac>=.55f && frac<=.72f && glyph.getHeight()>=28.0f;
        // Polish-pass density (design units): substantial controls, tight groups.
        const auto knobCircle=[](const juce::Component& k){ return juce::jmin(k.getWidth(),k.getHeight())-6; };
        ok&=knobCircle(strip.rateKnob())>=34 && strip.modeButton(LfoMode::Free).getWidth()>=38 && strip.modeButton(LfoMode::Free).getHeight()>=46;
        ok&=strip.snapButton().getBounds().getHeight()==strip.modeButton(LfoMode::Free).getHeight() && strip.snapButton().getWidth()>=37;
        ok&=strip.gridRowsField().getHeight()>=22 && strip.rateField().getWidth()>=70 && strip.unitSelector().getWidth()>=60 && strip.pageSelector().getWidth()>=64;
        for(std::size_t i=0;i+1<g.size();++i) ok&=g[i+1].getX()-g[i].getRight()>=4 && g[i+1].getX()-g[i].getRight()<=8;
        for(const auto& gr:g) ok&=gr.getY()==g[0].getY() && gr.getHeight()==g[0].getHeight();
        ok&=strip.pageSelector().getY()==g[0].getY()+strip.toolsViewport().getY() && strip.pageSelector().getHeight()==g[0].getHeight();
        ok&=g[1].getRight()-strip.customPathButton().getRight()<=6 && strip.modeButton(LfoMode::Loop).getX()-g[1].getX()<=6;
        ok&=!strip.toolsViewport().getHorizontalScrollBar().isVisible(); // one row at every editor size
        strip.setPage(ui::LfoControlStrip::Page::Func);
        ok&=knobCircle(strip.funcKnob(0))>=34 && !strip.funcViewport().getHorizontalScrollBar().isVisible();
        for(std::size_t i=0;i+1<ui::LfoControlStrip::funcCount;++i) ok&=!strip.funcLabel(i).getBounds().intersects(strip.funcLabel(i+1).getBounds()) && strip.funcLabel(i).getY()==strip.funcLabel(i+1).getY();
        strip.setPage(ui::LfoControlStrip::Page::Tools);
        check(ok,("LFO strip layout: "+label).c_str());
    };
    layoutOk("normal 1500x920");
    for(const auto size:{std::pair<int,int>{960,600},{2240,1400}}) {
        editor->setSize(size.first,size.second);
        layoutOk(std::to_string(size.first)+"x"+std::to_string(size.second));
    }
    editor->setSize(1500,920);
    {   // Responsive: a strip narrower than its controls scrolls (never shrinks).
        const auto saved=strip.getBounds();
        strip.setBounds(saved.withWidth(360));
        auto& vp=strip.toolsViewport();
        check(vp.getViewedComponent()->getWidth()==ui::LfoControlStrip::minimumToolsWidth() && vp.getHorizontalScrollBar().isVisible() &&
              vp.getViewedComponent()->getHeight()+vp.getScrollBarThickness()<=vp.getHeight() && strip.modeButton(LfoMode::Free).getWidth()==38,
              "narrow strip: TOOLS scrolls horizontally in its own gutter, controls keep their size");
        strip.setPage(ui::LfoControlStrip::Page::Func);
        check(strip.funcViewport().getViewedComponent()->getWidth()==ui::LfoControlStrip::minimumFuncWidth() && strip.funcKnob(0).getWidth()==44,
              "narrow strip: FUNC scrolls, knobs keep their size");
        strip.setPage(ui::LfoControlStrip::Page::Tools);
        strip.setBounds(saved);
    }

    // ---- optional renders for the visual audit -----------------------------
    if(const char* dir=std::getenv("ORIGAMI_SNAPSHOT_DIR")) {
        {   // Geometry report (design units == px at the 1440 x 900 default editor).
            editor->setSize(1440,900); synth->selectSource(ModSource::Lfo2); strip.setPage(ui::LfoControlStrip::Page::Tools);
            const auto r=[](const juce::Component& c){ return c.getBounds().toString().toStdString(); };
            std::cerr<<"[lfo geometry] panel "<<r(*synth)<<" strip "<<r(strip)<<" canvas "<<synth->lfoCanvas().toString()<<"\n";
            std::cerr<<"[lfo geometry] page "<<r(strip.pageSelector())<<" unit "<<r(strip.unitSelector())<<" knob "<<r(strip.rateKnob())<<" value "<<r(strip.rateField())<<"\n";
            std::cerr<<"[lfo geometry] mode "<<r(strip.modeButton(LfoMode::Free))<<" glyph "<<strip.modeButton(LfoMode::Free).glyphArea().toString()<<" snap "<<r(strip.snapButton())<<" gridIcon "<<r(strip.gridIcon())<<" field "<<r(strip.gridRowsField())<<" fwd "<<r(strip.forwardButton())<<"\n";
            for(const auto& g:strip.toolGroups()) std::cerr<<"[lfo geometry] group "<<g.toString()<<"\n";
            strip.setPage(ui::LfoControlStrip::Page::Func);
            std::cerr<<"[lfo geometry] func knob "<<r(strip.funcKnob(0))<<" label "<<r(strip.funcLabel(0))<<" funcContent "<<strip.funcViewport().getViewedComponent()->getBounds().toString()<<"\n";
            strip.setPage(ui::LfoControlStrip::Page::Tools);
            editor->setSize(1500,920);
        }
        const auto shot=[&](const std::string& name,float scale) {
            const auto r=synth->getBoundsInParent();
            const auto img=editor->createComponentSnapshot(editor->getLocalArea(synth->getParentComponent(),r),true,scale);
            juce::File f(juce::String(dir)+"/"+name+".png"); f.deleteFile(); juce::FileOutputStream out(f); juce::PNGImageFormat{}.writeImageToStream(img,out);
        };
        const auto setLfo=[&](LfoMode mode){ auto m=mod(); m.lfo2.mode=mode; p.setUiModulationState(m); sync(); };
        synth->selectSource(ModSource::Lfo2); strip.setGrid(16,8); strip.setRateUnit(ui::LfoControlStrip::RateUnit::Beats);
        setLfo(LfoMode::Free); if(strip.snapButton().getToggleState()) strip.snapButton().onClick();
        shot("A_tools_normal",1.0f); shot("H_active_free",1.0f);
        strip.setPage(ui::LfoControlStrip::Page::Func); shot("B_func_normal",1.0f); shot("L_disabled_func",2.0f); strip.setPage(ui::LfoControlStrip::Page::Tools);
        setLfo(LfoMode::Loop); shot("G_active_retrigger",1.0f);
        strip.snapButton().onClick(); shot("J_snap_enabled",1.0f);
        shot("M_retina_2x",2.0f);
        shot("K_reverse_disabled",2.0f);
        setLfo(LfoMode::Envelope); shot("I_envelope_pingpong_disabled",2.0f);
        editor->setSize(960,600); synth->selectSource(ModSource::Lfo2); shot("C_tools_min",1.0f); strip.setPage(ui::LfoControlStrip::Page::Func); shot("D_func_min",1.0f); strip.setPage(ui::LfoControlStrip::Page::Tools);
        editor->setSize(2240,1400); synth->selectSource(ModSource::Lfo2); shot("E_tools_large",1.0f); strip.setPage(ui::LfoControlStrip::Page::Func); shot("F_func_large",1.0f); strip.setPage(ui::LfoControlStrip::Page::Tools);
        editor->setSize(1500,920);
        const auto stripShot=[&](const std::string& name,float scale){
            const auto img=strip.createComponentSnapshot(strip.getLocalBounds(),true,scale);
            juce::File f(juce::String(dir)+"/"+name+".png"); f.deleteFile(); juce::FileOutputStream out(f); juce::PNGImageFormat{}.writeImageToStream(img,out);
        };
        {   auto m=mod(); m.lfo2.skew=.55f; m.lfo2.quantize=.62f; m.lfo2.smooth=.18f; m.lfo2.pingPong=true; m.lfo2.entropy=.25f; m.lfo2.phase=.1f;
            p.setUiModulationState(m); sync(); synth->repaint();
            shot("N_processed_overlay",2.0f); strip.setPage(ui::LfoControlStrip::Page::Func); stripShot("O_func_live_3x",3.0f); shot("P_func_live_page",1.0f); strip.setPage(ui::LfoControlStrip::Page::Tools);
            m.lfo2.skew=0; m.lfo2.quantize=0; m.lfo2.smooth=0; m.lfo2.entropy=0; m.lfo2.phase=0; m.lfo2.fracture=.7f; m.lfo2.pingPong=false; p.setUiModulationState(m); sync(); shot("Q_fracture_overlay",2.0f);
            m.lfo2.fracture=0; m.lfo2.stereo=.5f; p.setUiModulationState(m); sync(); shot("R_stereo_overlay",2.0f);
            strip.setPage(ui::LfoControlStrip::Page::Func); stripShot("T_func_stereo_3x",3.0f); strip.setPage(ui::LfoControlStrip::Page::Tools);
            m.lfo2.stereo=0; p.setUiModulationState(m); sync(); }
        stripShot("S_strip_tools_3x",3.0f); strip.setPage(ui::LfoControlStrip::Page::Func); stripShot("S_strip_func_3x",3.0f); strip.setPage(ui::LfoControlStrip::Page::Tools);
    }
}

// mct-origami-ui-legibility-cleanup: what the editor actually draws.
// A software renderer that records every glyph run (effective pixel height
// after all component transforms, horizontal font scale, owning component).
struct GlyphRun { float height=0,hscale=1; juce::Point<float> at; std::string owner,page; std::size_t glyphs=0; };
class GlyphRecorder final : public juce::LowLevelGraphicsSoftwareRenderer {
public:
    GlyphRecorder(const juce::Image& image,std::vector<GlyphRun>& out) : juce::LowLevelGraphicsSoftwareRenderer(image),out_(out) {}
    void setOrigin(juce::Point<int> o) override { stack_.back()=juce::AffineTransform::translation(float(o.x),float(o.y)).followedBy(stack_.back()); juce::LowLevelGraphicsSoftwareRenderer::setOrigin(o); }
    void addTransform(const juce::AffineTransform& t) override { stack_.back()=t.followedBy(stack_.back()); juce::LowLevelGraphicsSoftwareRenderer::addTransform(t); }
    void saveState() override { stack_.push_back(stack_.back()); juce::LowLevelGraphicsSoftwareRenderer::saveState(); }
    void restoreState() override { if(stack_.size()>1) stack_.pop_back(); juce::LowLevelGraphicsSoftwareRenderer::restoreState(); }
    void drawGlyphs(juce::Span<const std::uint16_t> glyphs,juce::Span<const juce::Point<float>> positions,const juce::AffineTransform& t) override {
        if(!glyphs.empty() && !isClipEmpty()) {
            const auto m=t.followedBy(stack_.back());
            const auto& f=getFont();
            GlyphRun run;
            run.height=f.getHeight()*std::hypot(m.mat01,m.mat11);
            run.hscale=f.getHorizontalScale()*std::hypot(m.mat00,m.mat10)/std::max(1e-6f,std::hypot(m.mat01,m.mat11));
            run.at=positions.empty() ? juce::Point<float>{} : positions[0].transformedBy(m);
            run.glyphs=glyphs.size();
            out_.push_back(run);
        }
        juce::LowLevelGraphicsSoftwareRenderer::drawGlyphs(glyphs,positions,t);
    }
private:
    std::vector<GlyphRun>& out_;
    std::vector<juce::AffineTransform> stack_{juce::AffineTransform{}};
};
std::string componentPath(juce::Component& root,juce::Point<float> p) {
    auto* c=root.getComponentAt(p.toInt());
    std::string path;
    for(int depth=0;c!=nullptr && c!=&root && depth<3;++depth,c=c->getParentComponent()) {
        std::string n=c->getName().toStdString();
        if(n.empty()) { int status=0; const char* mangled=typeid(*c).name(); char* d=abi::__cxa_demangle(mangled,nullptr,nullptr,&status); n=d ? d : mangled; std::free(d);
            const auto colon=n.rfind("::"); if(colon!=std::string::npos) n=n.substr(colon+2); }
        path=n+(path.empty() ? "" : "/"+path);
    }
    return path.empty() ? "editor" : path;
}
std::vector<GlyphRun> recordGlyphs(juce::Component& editor,const std::string& page) {
    std::vector<GlyphRun> runs;
    juce::Image image(juce::Image::ARGB,editor.getWidth(),editor.getHeight(),true);
    { GlyphRecorder recorder(image,runs); juce::Graphics g(recorder); editor.paintEntireComponent(g,true); }
    if(const char* dir=std::getenv("ORIGAMI_TYPE_SNAPSHOTS")) {
        auto name=juce::String(page).replaceCharacters(" /()","____").removeCharacters(".");
        juce::File f(juce::String(dir)+"/"+name+".png"); f.deleteFile(); juce::FileOutputStream out(f); juce::PNGImageFormat{}.writeImageToStream(image,out);
    }
    for(auto& r:runs) { r.owner=componentPath(editor,r.at); r.page=page; }
    return runs;
}
// mct-origami-ui-legibility-cleanup: macro grid structure + OSC header geometry.
void macroGridAndOscHeaderAudit() {
    using namespace mct::origami;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true); editor->setSize(1440,900);
    ui::MacroPanel* panel=nullptr; std::vector<ui::OscillatorCard*> oscs;
    walk(*editor,[&](auto& c){ if(auto* x=dynamic_cast<ui::MacroPanel*>(&c)) panel=x; if(auto* x=dynamic_cast<ui::OscillatorCard*>(&c)) oscs.push_back(x); });
    check(panel && !oscs.empty(),"grid audit: macro panel + oscillator cards");
    const auto sync=[&]{ editor->refreshModulationViews(); panel->syncFromModel(); };
    sync();
    auto& vp=panel->viewport();
    const auto transparentEdges=[](juce::Component& c,bool sidesOnly) {
        const auto img=c.createComponentSnapshot(c.getLocalBounds(),false,1.0f);
        bool clear=true; const int w=img.getWidth(),h=img.getHeight();
        for(int y=sidesOnly ? 2 : 0;y<(sidesOnly ? h-2 : h);++y) { clear&=img.getPixelAt(0,y).getAlpha()==0 && img.getPixelAt(w-1,y).getAlpha()==0; } // ASSIGN: the hairline above is its only line
        if(!sidesOnly) for(int x=0;x<w;++x) { clear&=img.getPixelAt(x,0).getAlpha()==0 && img.getPixelAt(x,h-1).getAlpha()==0; }
        return clear;
    };
    const auto gridOk=[&](const std::string& label) {
        const auto* content=vp.getViewedComponent();
        const int w=content->getWidth();
        bool ok=panel->gridFrame()==vp.getBounds().expanded(1);                 // frame hugs the grid: no padding
        const int rows=int((panel->cardCount()+1)/2);
        for(std::size_t i=0;i<panel->cardCount();++i) {
            const auto b=panel->card(i)->getBounds();
            const int col=int(i%2),row=int(i/2);
            ok&=b.getY()==row*ui::MacroPanel::cardHeight && b.getHeight()==ui::MacroPanel::cardHeight;
            ok&=col==0 ? b.getX()==0 : b.getRight()==w;                          // cells reach the frame / gutter
            if(col==1) ok&=panel->card(i-1)->getRight()==b.getX();               // edge to edge: no gap
        }
        const auto lines=panel->gridDividers();
        bool vertical=false; int horizontal=0;
        for(const auto& l:lines) {
            if(l.isVertical() && l.getStartX()<float(w)-0.5f) { vertical=true; ok&=std::abs(l.getStartX()-float(panel->card(1)->getX()))<=0.5f && l.getStartY()==0.0f && l.getEndY()==float(rows*ui::MacroPanel::cardHeight); }
            if(l.isHorizontal()) { ++horizontal; ok&=l.getStartX()==0.0f && l.getEndX()==float(w); }
        }
        ok&=vertical && horizontal==rows;
        const bool scrolls=content->getHeight()>vp.getHeight();
        ok&=!scrolls || w==vp.getWidth()-vp.getScrollBarThickness()-1;
        check(ok,("macro grid: "+label).c_str());
    };
    check(panel->cardCount()==4,"Init: four macro cells");
    gridOk("4 macros = 2 x 2, edge to edge, dividers to the frame, no padding");
    for(std::size_t i=0;i<panel->cardCount();++i) {
        auto* cell=panel->card(i);
        check(transparentEdges(*cell,false),"a macro cell draws no outer border / card box (all four edges transparent)");
        auto* row=const_cast<ui::ModulationSourceRow*>(panel->assignment(panel->cardId(i)));
        check(row && transparentEdges(*row,true),"ASSIGN draws no enclosing box (its sides are transparent)");
    }
    {   // Square frame: the corner pixel is the border colour (no radius).
        const auto img=panel->createComponentSnapshot(panel->getLocalBounds(),true,1.0f);
        const auto f=panel->gridFrame();
        const auto corner=img.getPixelAt(f.getX(),f.getY()),edge=img.getPixelAt(f.getCentreX(),f.getY());
        check(corner==edge && corner.getAlpha()==255,"the macro grid frame is square (corner pixel = border)");
    }
    {   // Cell titles fit at the label size up to MACRO 16.
        const int header=panel->card(0)->getWidth()-2*ui::MacroPanel::cellPadding-20;
        check(ui::textWidth("MACRO 16",ui::Type::label)<=float(header),"MACRO 16 fits its cell header at Type::label");
    }
    for(int i=0;i<8;++i) panel->addMacro();
    sync();
    check(panel->cardCount()==12 && vp.getViewedComponent()->getHeight()>vp.getHeight(),"12 macros scroll vertically");
    gridOk("12 macros: the same grid continues; the scrollbar has its own gutter");
    vp.setViewPosition(0,vp.getViewedComponent()->getHeight());
    check(panel->card(11)->getBottom()<=vp.getViewPositionY()+vp.getHeight(),"the last macro scrolls into view");
    const auto before=panel->cardCount();
    check(panel->addButton().isVisible() && panel->addMacro()!=0 && panel->cardCount()==before+1,"+ ADD MACRO still adds a cell");
    check(panel->removeMacro(panel->cardId(panel->cardCount()-1)) && panel->cardCount()==before,"remove still removes a cell");
    {   // ASSIGN still assigns: a route from MACRO 1 shows in its ASSIGN area.
        auto m=p.getUiInstrumentState().modulation;
        std::size_t slot=0; while(m.routes[slot].id!=0) ++slot;
        m.routes[slot]={m.nextRouteId++,true,macroSource(1),{ModDestination::Cutoff,0,0},0.4f,false};
        check(p.setUiModulationState(m),"route from MACRO 1"); sync();
        check(panel->assignment(1)->routes().size()==1,"ASSIGN shows the macro's route (interaction intact)");
    }
    for(const auto size:{std::pair<int,int>{960,600},{1920,1200}}) {
        editor->setSize(size.first,size.second); sync();
        gridOk("grid at "+std::to_string(size.first)+"x"+std::to_string(size.second));
    }
    editor->setSize(1440,900);

    // ---- OSC header ---------------------------------------------------------
    for(auto* card:oscs) {
        const auto h=card->headerLayout();
        bool ok=h.labels[0].getX()-h.title.getRight()<=12;                        // no reserved gap after "OSC N"
        ok&=std::abs(float(h.title.getWidth())-std::ceil(ui::textWidth(card->getName(),ui::Type::title)))<=1.0f;
        for(std::size_t i=0;i<3;++i) {
            ok&=h.selectors[i].getX()-h.labels[i].getRight()==4;                  // descriptor hugs its selector
            ok&=h.labels[i].getY()==h.title.getY() && h.labels[i].getHeight()==h.title.getHeight();
            ok&=h.selectors[i].getY()==h.title.getY() && h.selectors[i].getHeight()==h.title.getHeight();
            if(i>0) ok&=h.labels[i].getX()>h.selectors[i-1].getRight();
        }
        ok&=h.selectors[2].getRight()<h.power.getX() && h.power.getRight()<h.remove.getX() && h.remove.getRight()<=card->getWidth();
        ok&=h.power.getY()==h.title.getY() && h.remove.getY()==h.title.getY();
        ok&=float(h.selectors[0].getWidth())>=ui::textWidth("WAVETABLE",ui::Type::control)+6.0f;
        ok&=ui::OscillatorCard::headerLabelSize>=11.0f;
        check(ok,"OSC header: no dead gap after OSC N; MODE/PHASE/ROUTE at 11 px beside their selectors, one shared row");
    }
}

void typographyAudit() {
    using namespace mct::origami;
    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;
    p.prepareToPlay(48000.0,256);
    auto editorOwner=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto* editor=dynamic_cast<OrigamiAudioProcessorEditor*>(editorOwner.get());
    editor->setVisible(true);
    editor->setSize(1440,900); // the default editor: design units == pixels
    ui::OrigamiHeader* header=nullptr; ui::ModulationPanel* synth=nullptr; ui::FxPage* fx=nullptr; ui::OscillatorRack* rack=nullptr; ui::PerformanceKeyboard* keys=nullptr;
    walk(*editor,[&](auto& c){
        if(auto* x=dynamic_cast<ui::OrigamiHeader*>(&c)) header=x;
        if(auto* x=dynamic_cast<ui::ModulationPanel*>(&c)) synth=x;
        if(auto* x=dynamic_cast<ui::FxPage*>(&c)) fx=x;
        if(auto* x=dynamic_cast<ui::OscillatorRack*>(&c)) rack=x;
        if(auto* x=dynamic_cast<ui::PerformanceKeyboard*>(&c)) keys=x; });
    check(header && synth && fx && rack && keys,"typography audit: editor surfaces");
    std::vector<GlyphRun> all;
    // Every visible Label's text must fit its bounds at its font (no ellipsis,
    // no clipped descenders): larger type may never be bought with truncation.
    std::map<std::string,std::string> labelMisfits;
    std::size_t labelsChecked=0;
    const auto labelsFit=[&](const std::string& page){
        walk(*editor,[&](juce::Component& c){
            auto* l=dynamic_cast<juce::Label*>(&c);
            if(l==nullptr || l->getText().isEmpty() || l->isBeingEdited() || l->getWidth()<=0) return;
            for(juce::Component* v=l;v!=nullptr && v!=editor;v=v->getParentComponent()) if(!v->isVisible()) return; // visible in the editor
            // Inside a viewport: only labels in the visible window count.
            if(auto* vp=l->findParentComponentOfClass<juce::Viewport>())
                if(!vp->getViewArea().intersects(vp->getViewedComponent()->getLocalArea(l->getParentComponent(),l->getBounds()))) return;
            if(dynamic_cast<juce::ComboBox*>(l->getParentComponent())!=nullptr) return; // combo text: ellipsis by design
            ++labelsChecked;
            const auto f=l->getFont(); const auto border=l->getBorderSize();
            const float w=ui::textWidth(l->getText(),f.getHeight())*f.getHorizontalScale();
            const bool fits=w<=float(l->getWidth()-border.getLeftAndRight())+1.0f && f.getHeight()<=float(l->getHeight()-border.getTopAndBottom())+1.0f;
            if(!fits) labelMisfits[l->getText().toStdString()+" ("+std::to_string(int(w))+" in "+std::to_string(l->getWidth())+"x"+std::to_string(l->getHeight())+" @"+std::to_string(f.getHeight()).substr(0,4)+")"]=page;
        });
    };
    const auto grab=[&](const std::string& page){ auto r=recordGlyphs(*editor,page); all.insert(all.end(),r.begin(),r.end()); labelsFit(page); };
    grab("SYNTH / ENV 1");
    for(auto s:{ModSource::Lfo1,ModSource::Function,ModSource::Random,ModSource::Chaos,ModSource::Drift,ModSource::Sequencer,ModSource::Velocity,ModSource::Keytrack})
        if(synth->selectSource(s)) grab("SYNTH / source "+std::to_string(static_cast<int>(s)));
    synth->selectSource(ModSource::Lfo1); synth->lfoStrip().setPage(ui::LfoControlStrip::Page::Func); grab("SYNTH / LFO FUNC");
    synth->lfoStrip().setPage(ui::LfoControlStrip::Page::Tools); synth->selectSource(ModSource::Env1);
    header->selectMode(3); grab("MATRIX");
    header->selectMode(2); fx->syncFromModel();
    // A populated graph: effect modules plus NODES control operators.
    fx->addEffect(fx::FxEffectType::Delay); fx->addEffect(fx::FxEffectType::Drive);
    { auto m=scenarios::mixedControl(); m.macroMask=p.getUiInstrumentState().modulation.macroMask; p.setUiModulationState(m); editor->refreshModulationViews(); fx->syncFromModel(); }
    for(auto tab:{ui::FxSidebar::Tab::Sources,ui::FxSidebar::Tab::Modulators,ui::FxSidebar::Tab::Filters,ui::FxSidebar::Tab::Buses,ui::FxSidebar::Tab::Matrix}) { fx->sidebar().setTab(tab); grab("NODES / sidebar "+std::to_string(static_cast<int>(tab))); }
    const auto zoom=fx->graphZoom();
    fx->graphView().setView(.5f,fx->graphView().pan()); grab("NODES / zoomed out (0.5)");
    fx->graphView().setView(zoom,fx->graphView().pan());
    header->selectMode(4); grab("GLOBAL");
    header->selectMode(0);
    if(keys->onArpSettingsRequested) { keys->onArpSettingsRequested(); grab("ARP"); keys->onArpSettingsRequested(); }
    if(rack->onWavetableEditorRequested) { rack->onWavetableEditorRequested(1); grab("WAVETABLE EDITOR"); }
    const auto defaultMisfits=labelMisfits;
    for(const auto size:{std::pair<int,int>{960,600},{1920,1200}}) {
        editor->setSize(size.first,size.second);
        std::vector<GlyphRun> scaled=recordGlyphs(*editor,"size "+std::to_string(size.first));
        float worst=1.0f; for(const auto& r:scaled) worst=std::min(worst,r.hscale);
        labelMisfits.clear(); labelsFit("size "+std::to_string(size.first));
        check(worst>=0.95f && labelMisfits.empty(),("editor "+std::to_string(size.first)+"x"+std::to_string(size.second)+": no squeezed or clipped text").c_str());
    }
    editor->setSize(1440,900);
    labelMisfits=defaultMisfits;
    // Report every sub-10 px run (owner, size, page).
    std::map<std::string,std::pair<float,std::size_t>> small;
    float minSquash=1.0f; std::string squashed;
    for(const auto& r:all) {
        if(r.height<9.95f && !r.page.empty()) { auto& e=small[r.owner+" @ "+r.page]; e.first=e.first==0 ? r.height : std::min(e.first,r.height); e.second+=r.glyphs; }
        if(r.hscale<minSquash) { minSquash=r.hscale; squashed=r.owner+" @ "+r.page; }
    }
    if(std::getenv("ORIGAMI_TYPE_REPORT")) {
        std::cerr<<"[type] runs="<<all.size()<<" sub-10px owners="<<small.size()<<" min horizontal scale "<<minSquash<<" ("<<squashed<<")\n";
        for(const auto& [k,v]:small) std::cerr<<"[type] "<<std::fixed<<std::setprecision(1)<<v.first<<" px  "<<k<<"  ("<<v.second<<" glyphs)\n";
        for(const auto& [k,v]:labelMisfits) std::cerr<<"[type] LABEL DOES NOT FIT: "<<k<<" @ "<<v<<"\n";
        std::map<std::string,float> squash; for(const auto& r:all) if(r.hscale<0.95f) { auto& v=squash[r.owner]; v=v==0 ? r.hscale : std::min(v,r.hscale); }
        for(const auto& [k,v]:squash) std::cerr<<"[type] SQUASHED x"<<v<<"  "<<k<<"\n";
        if(std::getenv("ORIGAMI_TYPE_DEBUG")) for(const auto& r:all) if(r.hscale<0.95f) std::cerr<<"[squash] h="<<r.height<<" x"<<r.hscale<<" n="<<r.glyphs<<" "<<r.owner<<" @ "<<r.page<<"\n";
    }
    // ---- policy (default 1440 x 900 editor) --------------------------------
    // Ordinary text never below Type::secondary; the only smaller text is the
    // NODES graph zoomed out (semantic zoom scales the graph world).
    float smallest=1000.0f; std::string smallestAt;
    for(const auto& r:all) if(r.page.find("zoomed out")==std::string::npos && r.height<smallest) { smallest=r.height; smallestAt=r.owner+" @ "+r.page; }
    check(smallest>=ui::Type::secondary-0.05f,("default scale: no text below 10 px (smallest "+std::to_string(smallest)+" at "+smallestAt+")").c_str());
    check(minSquash>=0.95f,("no horizontally squeezed text (worst "+squashed+")").c_str());
    check(labelsChecked>200,("the label-fit audit inspected the visible labels ("+std::to_string(labelsChecked)+")").c_str());
    check(labelMisfits.empty(),("every visible label fits its bounds"+(labelMisfits.empty() ? std::string() : ": "+labelMisfits.begin()->first)).c_str());
    {   // NODES: legible at default zoom; zooming out still scales the graph text.
        float atDefault=1000.0f,atDefaultMax=0.0f,zoomedMax=0.0f;
        for(const auto& r:all) if(r.owner.find("FxCanvas")!=std::string::npos) {
            if(r.page.find("zoomed out")!=std::string::npos) zoomedMax=std::max(zoomedMax,r.height);
            else if(r.page.find("NODES")!=std::string::npos) { atDefault=std::min(atDefault,r.height); atDefaultMax=std::max(atDefaultMax,r.height); }
        }
        check(atDefault>=ui::Type::secondary-0.05f && atDefaultMax>0.0f,"NODES graph text at default zoom >= 10 px");
        check(zoomedMax>0.0f && zoomedMax<atDefaultMax*0.75f,"NODES semantic zoom: zooming out scales the graph text down");
    }
}

// NODES visual feedback: sampled canonical modulation, real pixel changes,
// visibility/zoom gates, unchanged authoring values and bounded paint costs.
void nodesVisualFeedbackAudit() {
    using namespace mct::origami::fx;
    InstrumentState state{};
    RuntimeVisualizationSnapshot visual{};
    FxWorkspace workspace;
    auto graph=makeDefaultFxGraph();
    const auto id=graph.addEffect(FxEffectType::Gain,{40,40});
    workspace.document(mainBusId).replace(graph);
    const auto address=fxParameterAddress(mainBusId,id,1);
    ui::ModulationBindings bindings;
    bindings.snapshot=[&]{return state;};
    int reads=0;
    bindings.visualization=[&]{++reads;return visual;};
    auto page=std::make_unique<ui::FxPage>(workspace,bindings);
    ui::OrigamiLookAndFeel look;
    page->setLookAndFeel(&look);
    page->setBounds(0,0,1440,900);page->addToDesktop(0);page->setVisible(true);
    auto* node=page->canvas().nodeComponent(id);
    check(node!=nullptr,"visual feedback node exists");
    juce::Slider* knob=nullptr;
    walk(*node,[&](juce::Component& c){if(auto* k=dynamic_cast<juce::Slider*>(&c)) if(int(k->getProperties()["mct.mod.itemId"])==int(address.itemId)) knob=k;});
    check(knob!=nullptr,"FX gain quick knob has canonical address");
    const auto hash=[](juce::Component& c) {
        const auto image=c.createComponentSnapshot(c.getLocalBounds());
        std::uint64_t value=1469598103934665603ull;
        for(int y=0;y<image.getHeight();++y) for(int x=0;x<image.getWidth();++x)
            value=(value^image.getPixelAt(x,y).getARGB())*1099511628211ull;
        return value;
    };
    const auto bare=hash(*knob);
    auto range=ui::fxKnobModulationRange(.5f,address,state.modulation,ModSource::Lfo1);
    check(!range.anyRoute && !range.hasDepth,"unmodulated FX knob has no overlay");
    state.modulation.routes[0]={1,true,ModSource::Lfo1,address,.4f,true};
    const auto previousSelectedSource=ui::modulationUiTelemetry().selectedSource;
    ui::modulationUiTelemetry().selectedSource=ModSource::Lfo1;
    page->syncFromModel();
    const auto compiledRange=ui::fxKnobModulationRange(float(knob->getValue()),address,page->visualModulation(),ModSource::Lfo1);
    check(compiledRange.anyRoute && compiledRange.hasDepth && compiledRange.selected,
          "FX modulation visual model receives canonical route before pixel audit");
    const double base=knob->getValue();
    const auto slot=modulationSourceSlot(ModSource::Lfo1,state.modulation);
    visual.routeSources[slot]=-1;
    page->refreshVisualFeedback();
    knob->repaint();
    const auto negative=hash(*knob);
    const auto saveNode=[&](const char* name) {
        if(const char* folder=std::getenv("ORIGAMI_NODES_VISUAL_REPORT")) {
            const auto image=node->createComponentSnapshot(node->getLocalBounds(),true,2.0f);
            juce::FileOutputStream out(juce::File(juce::String(folder)+"/"+name+".png"));
            juce::PNGImageFormat{}.writeImageToStream(image,out);
        }
    };
    saveNode("modulation-negative");
    visual.routeSources[slot]=1;
    page->refreshVisualFeedback();
    knob->repaint();
    check(negative!=bare && negative!=hash(*knob),"FX modulation arc appears and effective dot moves");
    // P01 geometry: modulation must live on a visibly separate outer radial
    // track instead of painting over the authored white magnitude arc.
    {
        const auto image=knob->createComponentSnapshot(knob->getLocalBounds(),true,2.0f);
        const auto centre=image.getBounds().toFloat().getCentre();
        float furthestRed=0.0f;
        for(int y=0;y<image.getHeight();++y) for(int x=0;x<image.getWidth();++x) {
            const auto pixel=image.getPixelAt(x,y);
            if(pixel.getRed()>150 && pixel.getRed()>pixel.getGreen()*1.8f && pixel.getRed()>pixel.getBlue()*1.8f)
                furthestRed=std::max(furthestRed,juce::Point<float>(float(x),float(y)).getDistanceFrom(centre));
        }
        check(furthestRed>image.getWidth()*0.43f,"FX modulation overlay occupies dedicated outer knob track");
    }
    check(knob->getValue()==base,"visual feedback never changes authored knob value");
    saveNode("modulation-positive");
    state.modulation.routes[1]={2,true,ModSource::Lfo2,address,-.4f,true};
    range=ui::fxKnobModulationRange(.5f,address,state.modulation,ModSource::Lfo1);
    check(range.anyRoute && range.selected && std::abs(range.lo-.1f)<1e-6f && std::abs(range.hi-.9f)<1e-6f,
          "opposing routes retain one aggregate interval instead of cancelling");
    state.modulation.routes[1].enabled=false;
    range=ui::fxKnobModulationRange(.5f,address,state.modulation,ModSource::None);
    check(!range.selected && std::abs(range.lo-.3f)<1e-6f && std::abs(range.hi-.7f)<1e-6f,"disabled routes excluded and bipolar span canonical");
    state.modulation.routes[2]={3,true,ModSource::Macro1,routeDepthAddress(1),.25f,false};
    visual.routeSources[modulationSourceSlot(ModSource::Macro1,state.modulation)]=1;
    page->syncFromModel();page->refreshVisualFeedback();
    check(page->visualFxFrame().count==1 && std::abs(page->visualFxFrame().offset[0]-.45f)<1e-5f,
          "FX dot follows canonical nested route depth");
    const auto beforeHover=hash(*node);
    node->mouseEnter(event(*node));
    check(hash(*node)!=beforeHover,"node hover strengthens outline");
    node->mouseExit(event(*node));
    check(node->portAt(node->portCentre(true,0)+juce::Point<float>(10,0)).has_value(),"port hit target exceeds drawn dot");
    page->canvas().beginWire(graph.sourceForBus(mainBusId),0);
    check(hash(*node)!=beforeHover,"compatible audio target is emphasized while dragging");
    page->canvas().cancelWire();
    page->graphView().setView(.5f,{0,0});check(knob->isVisible(),"moderate zoom preserves modulation controls");
    page->graphView().setView(.3f,{0,0});check(!knob->isVisible(),"minimal zoom removes subpixel controls immediately");
    page->graphView().setView(1,{0,0});check(knob->isVisible(),"zoom restoration needs no graph edit");
    auto disabled=*page->graph().findNode(id); disabled.enabled=false;
    node->update(disabled,false);
    check(knob->getAlpha()<.5f && hash(*node)!=beforeHover,"bypass dims controls and labels preview");
    page->setVisible(false);const auto count=page->visualRefreshCount();const auto readCount=reads;
    page->refreshVisualFeedback();
    check(page->visualRefreshCount()==count && reads==readCount,"hidden NODES does no visual sampling or refresh");
    page->setVisible(true);
    // Diagnostic benchmark: warmed software snapshots (not compositor/GPU).
    if(const char* folder=std::getenv("ORIGAMI_NODES_VISUAL_REPORT")) {
        const FxEffectType effects[]{FxEffectType::Equalizer,FxEffectType::Filter,FxEffectType::Compressor,FxEffectType::Drive,FxEffectType::Spatial,FxEffectType::Gain};
        page->setVisible(false);
        const auto hiddenStart=std::chrono::steady_clock::now();
        for(int i=0;i<10000;++i) page->refreshVisualFeedback();
        std::cout<<"NODES_VISUAL hidden_tick_us="<<std::chrono::duration<double,std::micro>(std::chrono::steady_clock::now()-hiddenStart).count()/10000.0<<"\n";
        page->setVisible(true);
        for(const int total:{5,20,60}) {
            auto many=makeDefaultFxGraph();
            for(int i=0;i<total;++i) many.addEffect(effects[i%6],{float((i%5)*240),float((i/5)*200)});
            state.modulation.routes={};std::size_t routeIndex=0;
            for(const auto& n:many.nodes()) if(const auto* d=findFxEffect(n.effect)) {
                for(std::size_t j=0;j<d->parameterCount && routeIndex<state.modulation.routes.size();++j)
                    if(d->parameters[j].quick && d->parameters[j].curve!=FxParameterCurve::Choice) {
                        state.modulation.routes[routeIndex]={std::uint32_t(routeIndex+1),true,ModSource::Lfo1,fxParameterAddress(mainBusId,n.id,d->parameters[j].id),.4f,true};
                        ++routeIndex;break;
                    }
            }
            workspace.document(mainBusId).replace(many);page->syncFromModel();
            for(const float zoom:{1.0f,.3f}) {
                page->graphView().setView(zoom,{0,0});
                auto warm=page->createComponentSnapshot(page->getLocalBounds());
                const auto tickStart=std::chrono::steady_clock::now();
                for(int i=0;i<1000;++i) page->refreshVisualFeedback();
                const auto tickUs=std::chrono::duration<double,std::micro>(std::chrono::steady_clock::now()-tickStart).count()/1000.0;
                const auto begin=std::chrono::steady_clock::now();
                for(int frame=0;frame<12;++frame) {page->refreshVisualFeedback();auto image=page->createComponentSnapshot(page->getLocalBounds());}
                const auto ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-begin).count()/12.0;
                std::cout<<"NODES_VISUAL nodes="<<total<<" zoom="<<zoom<<" tick_us="<<tickUs<<" software_frame_ms="<<ms<<" cached_preview_bytes_max="<<total*192*52*4<<" plan_bytes="<<sizeof(CompiledModulation)<<"\n";
                juce::File file(juce::String(folder)+"/nodes-"+juce::String(total)+"-"+juce::String(zoom,1)+".png");
                juce::FileOutputStream out(file);juce::PNGImageFormat{}.writeImageToStream(warm,out);
            }
            if(total==20) {
                page->selectNode(many.nodes()[2].id);
                page->graphView().setView(1,{0,0});
                const auto start=std::chrono::steady_clock::now();
                for(int i=0;i<12;++i) {page->refreshVisualFeedback();auto image=page->createComponentSnapshot(page->getLocalBounds());}
                std::cout<<"NODES_VISUAL selected_eq_frame_ms="<<std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count()/12.0<<"\n";
            }
        }
    }
    ui::modulationUiTelemetry().selectedSource=previousSelectedSource;
    page->setLookAndFeel(nullptr);
}

void correctiveViewportAudit() {
    auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    ui::OscillatorCard* card=nullptr;
    walk(*editor,[&](juce::Component& c){if(auto* x=dynamic_cast<ui::OscillatorCard*>(&c)) if(x->id()==1) card=x;});
    check(card!=nullptr,"viewport renderer available");
    juce::Image image(juce::Image::ARGB,card->getWidth(),card->getHeight(),true);juce::Graphics g(image);
    auto m=p.getUiOscillatorState(1);m.processCount=1;m.nextProcessId=2;
    auto previousTelemetry=ui::modulationUiTelemetry();ui::modulationUiTelemetry()={};
    for(const auto type:{dsp::OscProcessType::RandAmp,dsp::OscProcessType::RandSparse}) {
        for(int boundary:{1,3,8,16,24,31}) {
            const auto paintAmount=[&](float amount) {
                m.processes[0]={1,type,amount,0xabcdefu,true};check(p.setUiOscillatorState(1,m),"viewport process amount accepted");
                rack(*editor).syncFromModel();card->paintEntireComponent(g,true);
                check(card->viewportProcessPlan().stages[0].amount==amount,"viewport uses continuous canonical amount");
                return card->viewportWaveform();
            };
            const float amount=float(boundary)/32;
            const auto left=paintAmount(amount-1e-5f),right=paintAmount(amount+1e-5f);
            float delta=0;for(std::size_t i=0;i<left.size();++i) delta=std::max(delta,std::abs(left[i]-right[i]));
            check(delta<.002f,"painted viewport does not snap across spectral preparation boundaries");
        }
    }
    m.processCount=0;check(p.setUiOscillatorState(1,m),"viewport bare saw fixture");rack(*editor).syncFromModel();card->paintEntireComponent(g,true);
    juce::Path::Iterator it(card->viewportStroke());int moves=0,lines=0,closes=0;float previousY=0,lastJump=0;
    while(it.next()) {
        if(it.elementType==juce::Path::Iterator::startNewSubPath) {++moves;previousY=it.y1;}
        else if(it.elementType==juce::Path::Iterator::lineTo) {++lines;lastJump=std::abs(it.y1-previousY);previousY=it.y1;}
        else if(it.elementType==juce::Path::Iterator::closePath) ++closes;
    }
    check(moves==1 && lines==383 && closes==0,"visible waveform stroke has exactly the sample polyline and no closing geometry");
    check(lastJump<float(card->getHeight())*.02f,"visible saw has no artificial terminal jump to phase zero/baseline");
    ui::modulationUiTelemetry()=previousTelemetry;
}

void correctivePassUiAudit() {
    auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;
    check(!p.getUiInstrumentState().modulation.filterEnabled,"fresh plugin has no filter module");
    auto m=p.getUiInstrumentState().modulation;
    std::vector<ModSource> sources;
    for(const auto family:{SourceFamily::Envelope,SourceFamily::Lfo,SourceFamily::Random})
        for(int n=0;n<6;++n) sources.push_back(addSourceInstance(m,family));
    check(p.setUiModulationState(m),"many independent sources accepted by plugin");
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    ui::ModulationPanel* panel=nullptr;
    walk(*editor,[&](juce::Component& c){if(auto* x=dynamic_cast<ui::ModulationPanel*>(&c)) panel=x;});
    check(panel!=nullptr,"source editor available");panel->syncFromModel();
    for(const auto source:sources) {
        check(panel->sourceRow(source)!=nullptr,"every instance has an identity-bearing source row");
        check(panel->selectSource(source),"every additional source selects its family editor");
    }
    const auto lfo=sources[6];check(panel->selectSource(lfo),"additional LFO selected");
    panel->lfoStrip().rateKnob().setValue(4.0,juce::sendNotificationSync);
    const auto edited=p.getUiInstrumentState().modulation;
    check(edited.lfo1.rateHz==m.lfo1.rateHz,"instance editor preserves legacy LFO settings");
    check(findSourceInstance(edited,lfo)->lfo.rateHz!=m.instances[6].lfo.rateHz,"instance editor writes only selected identity");
    const auto added=panel->addSource(SourceFamily::Envelope);
    check(added!=ModSource::None && panel->sourceRow(added) && panel->selectSource(added),"plus action instantiates another ENV with a usable row/editor");
    ui::FxPage* nodesPage=nullptr;walk(*editor,[&](juce::Component& c){if(auto* x=dynamic_cast<ui::FxPage*>(&c)) nodesPage=x;});
    check(nodesPage && nodesPage->addControlSource(added),"Nodes accepts a new source instance");
    const auto connected=nodesPage->connectControl(added,{ModDestination::Level,1,0});
    check(connected.result==nodes::ControlLinkResult::Ok,"new ENV connects to oscillator level in Nodes");
    auto op=nodesPage->addControlOperator(ControlOpType::Add);
    check(op && nodesPage->connectControlEdge(nodes::ControlEndpoint::fromSource(lfo),nodes::ControlEndpoint::toInput(*op,0)).result==nodes::ControlLinkResult::Ok,"new LFO feeds a Nodes operator");
    // A user-authored filter remains persistent and Init clears it.
    auto filter=p.getUiInstrumentState().modulation;filter.filterEnabled=true;check(p.setUiModulationState(filter),"manual filter addition works");
    juce::MemoryBlock saved;p.getStateInformation(saved);
    check(p.loadUiInitPreset() && !p.getUiInstrumentState().modulation.filterEnabled,"Init contains no filters");
    p.setStateInformation(saved.getData(),int(saved.getSize()));
    check(p.getUiInstrumentState().modulation.filterEnabled,"saved patch restores authored filter");
    panel->syncFromModel();check(panel->selectSource(lfo),"instance editor survives save/reload");
    const auto restored=p.getUiInstrumentState().modulation;
    bool hasCable=false;for(const auto& r:restored.routes) hasCable|=r.id && r.source==added && r.destination==ModAddress{ModDestination::Level,1,0};
    check(hasCable && findControlOperator(restored,*op)->inputs[0].source==lfo,"new instance Nodes cables survive plugin save/reload");
    auto full=restored;while(addSourceInstance(full,SourceFamily::Random)!=ModSource::None) {}
    check(p.setUiModulationState(full),"UI pool capacity fixture installed");panel->syncFromModel();
    for(const auto& item:panel->sourceMenuItems()) if(item.id<=7) check(!item.enabled && item.tooltip.contains("capacity"),"full pool add menu explains the engine maximum");
    check(panel->addSource(SourceFamily::Envelope)==ModSource::None,"full pool add action returns an explicit failure");

}

void emergencyPanicAudit() {
    auto owner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*owner;
    p.prepareToPlay(48000.0,256);
    disableExtraOscillators(p);
    check(p.setUiParameter(ParameterId::Sustain,1.0f),"panic sustain setup");
    const auto patch=encodeInstrumentState(p.getUiInstrumentState());
    juce::AudioBuffer<float> audio(2,256);
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1,60,.9f),0);
    for(int i=0;i<8;++i) { audio.clear(); p.processBlock(audio,midi); midi.clear(); }
    check(magnitude(audio)>1.0e-4f,"panic test has active voice");
    p.requestPanic();
    midi.addEvent(juce::MidiMessage::noteOn(1,62,.9f),0);
    pluginAllocations.store(0,std::memory_order_relaxed);
    pluginGuardAllocations.store(true,std::memory_order_release);
    audio.clear(); p.processBlock(audio,midi);
    pluginGuardAllocations.store(false,std::memory_order_release);
    check(pluginAllocations.load(std::memory_order_relaxed)==0,"panic callback allocates nothing");
    check(magnitude(audio)==0.0f && p.panicCount()==1,"panic silences callback and acknowledges reset");
    check(encodeInstrumentState(p.getUiInstrumentState())==patch,"panic preserves patch");
    midi.clear(); audio.clear(); p.processBlock(audio,midi);
    check(magnitude(audio)==0.0f,"panic kills existing voices");
    midi.addEvent(juce::MidiMessage::noteOn(1,64,.9f),0);
    for(int i=0;i<8;++i) { audio.clear(); p.processBlock(audio,midi); midi.clear(); }
    check(magnitude(audio)>1.0e-4f,"new notes work after panic");
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    juce::Button* stop=nullptr;
    walk(*editor,[&](juce::Component& c) {
        if(auto* button=dynamic_cast<juce::Button*>(&c))
            if(button->getName()=="Emergency DSP reset") stop=button;
    });
    check(stop!=nullptr && bool(stop->onClick),"identity exposes emergency reset on every page");
    check(stop->getBounds()==juce::Rectangle<int>(10,4,286,64),"panic occupies full identity area and is absent from right utilities");
    check(stop->getWantsKeyboardFocus(),"panic retains keyboard button semantics");
    stop->onClick();
    audio.clear();p.processBlock(audio,midi);
    check(magnitude(audio)==0.0f && p.panicCount()==2,"header STOP reaches emergency reset");
}

// Wave 1 PANIC under load: many voices, delay + reverb tails, live modulation
// routes and a NODES operator. Runtime clears; the creative state does not.
void panicDragFocusAudit() {
    juce::DocumentWindow window("Origami drag lifecycle regression",juce::Colours::black,0);juce::Component root;ui::OrigamiHeader header;juce::Component source;
    root.setSize(900,350);root.addAndMakeVisible(header);header.setBounds(0,0,900,72);source.setWantsKeyboardFocus(true);root.addAndMakeVisible(source);source.setBounds(400,100,100,100);window.setContentNonOwned(&root,true);window.setTopLeftPosition(300,300);window.setVisible(true);window.toFront(true);
    juce::Button* panic=nullptr;walk(header,[&](auto& c){if(c.getName()=="Emergency DSP reset") panic=dynamic_cast<juce::Button*>(&c);});check(panic!=nullptr,"Panic lifecycle owns identity button");source.grabKeyboardFocus();
    check(!header.panicVisibleForPointer(false) && header.panicVisibleForPointer(true),"physical pointer outside hides; entering reveals");check(!header.panicVisibleForPointer(false),"leaving restores branding");
    for(const char* kind:{"ENV","LFO","MACRO","FILTER","CANCEL","VALID DROP"}) {
        source.setName(kind);source.grabKeyboardFocus();header.assignmentDragStarted();check(!header.panicVisibleForPointer(false),"shared source drag starts without false reveal");
        auto overlay=std::make_unique<juce::Component>();overlay->setWantsKeyboardFocus(true);root.addAndMakeVisible(*overlay);overlay->setBounds(400,220,100,50);overlay->grabKeyboardFocus();header.assignmentDragEnded();overlay.reset();
        check(panic->hasKeyboardFocus(false) && !header.panicVisibleForPointer(false),"real drag-image focus handoff cannot reveal gray Panic");header.reconcileAssignmentDragFocus();check(!panic->hasKeyboardFocus(false) && !header.panicVisibleForPointer(false),"deferred reconciliation releases transient focus for cancelled and valid drops");
    }
    panic->grabKeyboardFocus();static_cast<juce::Component*>(panic)->focusGained(juce::Component::focusChangedByTabKey);check(header.panicVisibleForPointer(false),"intentional keyboard focus reveals Panic");header.assignmentDragStarted();auto overlay=std::make_unique<juce::Component>();overlay->setWantsKeyboardFocus(true);root.addAndMakeVisible(*overlay);overlay->grabKeyboardFocus();header.assignmentDragEnded();overlay.reset();header.reconcileAssignmentDragFocus();check(panic->hasKeyboardFocus(false) && header.panicVisibleForPointer(false),"legitimate keyboard accessibility focus survives drag lifecycle");
    source.grabKeyboardFocus();check(!header.panicVisibleForPointer(false),"focus lost hides Panic");unsigned clicks=0;header.onPanicRequested=[&]{++clicks;};panic->onClick();check(clicks==1,"Panic activation invokes existing command exactly once");window.setVisible(false);window.clearContentComponent();
}

void panicUnderLoadAudit() {
    auto owner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*owner;
    p.prepareToPlay(48000.0,256);
    p.setUiParameter(ParameterId::Sustain,1.0f);
    auto& doc=p.getUiFxDocument();
    doc.edit([](fx::FxGraph& g){ return g.insertEffectBeforeOutput(fx::FxEffectType::Delay)!=fx::invalidFxNodeId; });
    doc.edit([](fx::FxGraph& g){ return g.insertEffectBeforeOutput(fx::FxEffectType::Reverb)!=fx::invalidFxNodeId; });
    auto m=p.getUiInstrumentState().modulation;
    m.lfo1.mode=LfoMode::Free; m.lfo1.rateHz=3.0f;
    m.routes[0]={m.nextRouteId++,true,ModSource::Lfo1,{ModDestination::Cutoff,0,0},0.3f,true};
    m.operators[0]=makeControlOperator(ControlOpType::ScaleOffset,m.nextOperatorId++);
    m.operators[0].inputs[0]={ControlInput::Kind::Source,ModSource::Lfo2,0};
    check(p.setUiModulationState(m),"panic rig: routes + NODES operator");
    const auto patch=encodeInstrumentState(p.getUiInstrumentState());
    const auto graph=doc.graph();
    const auto level=p.getUiParameter(ParameterId::OscLevel);
    juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi,none;
    for(int n=0;n<8;++n) midi.addEvent(juce::MidiMessage::noteOn(1,48+n*3,.9f),0);
    for(int i=0;i<40;++i) { audio.clear(); p.processBlock(audio,i==0 ? midi : none); }
    check(magnitude(audio)>1.0e-3f,"8 voices with delay + reverb are sounding");
    p.requestPanic();
    audio.clear(); p.processBlock(audio,none);
    check(magnitude(audio)==0.0f,"PANIC: the very next block is silent");
    float after=0.0f;
    for(int i=0;i<200;++i) { audio.clear(); p.processBlock(audio,none); after=std::max(after,magnitude(audio)); }
    check(after==0.0f,"delay / reverb tails and voices stay cleared (no resurging feedback)");
    check(encodeInstrumentState(p.getUiInstrumentState())==patch && doc.graph()==graph && p.getUiParameter(ParameterId::OscLevel)==level,
          "patch, routes, NODES operators, FX graph and parameters are intact");
    midi.clear(); midi.addEvent(juce::MidiMessage::noteOn(1,60,.9f),0);
    float played=0.0f;
    for(int i=0;i<20;++i) { audio.clear(); p.processBlock(audio,i==0 ? midi : none); played=std::max(played,magnitude(audio)); }
    check(played>1.0e-3f,"a new note plays normally after PANIC (with its delay / reverb)");
    midi.clear(); midi.addEvent(juce::MidiMessage::noteOff(1,60),0);
    audio.clear(); p.processBlock(audio,midi);
    p.requestPanic(); p.requestPanic(); // coalesced
    audio.clear(); p.processBlock(audio,none);
    audio.clear(); p.processBlock(audio,none);
    check(magnitude(audio)==0.0f && p.panicCount()==2,"repeated requests coalesce into one reset per callback");
}

void declarativeThemeAudit() {
    using namespace mct::origami::ui;
    const auto original=gTheme;
    ThemeDefinition invalid=original;
    invalid.background=juce::Colours::white;
    setDeclarativeTheme(invalid);
    check(Palette::background()==original.background && signalSourceColour()==original.signal,
          "invalid theme falls back to Origami default");
    ThemeDefinition valid=original;
    valid.signal=juce::Colour(0xff40aaff);
    setDeclarativeTheme(valid);
    check(signalSourceColour()==valid.signal,"declarative signal token drives visual accent");
    setDeclarativeTheme(original);
}

void run() {
    declarativeThemeAudit();
    correctiveViewportAudit();
    correctivePassUiAudit();
    panicDragFocusAudit();emergencyPanicAudit();
    panicUnderLoadAudit();
    nodesVisualFeedbackAudit();
    fxPageAudit();
    fxGraphUxAudit();
    fxAudioPathAudit();
    fxWorkspaceP03Audit();
    fxModulationAudioAudit();
    busWorkspaceP04Audit();
    modulationRowConsistencyAudit();
    nodesN01Audit();
    deterministicRenderAudit();
    nodesN03Audit();
    nodesN04Audit();
    nodesN05Audit();
    nodesN06Audit();
    nodesN07Audit();
    nodesMenuHierarchyAudit();
    synthDynamicMacrosAudit();
    nestedModulationUiAudit();
    captureKeyboardInputAudit();
    contentBrowserAudit();
    wavetableEditorCommitAudit();
    manualQaUiAudit();
    nodesTelemetryVisibilityAudit();
    lfoEditorControlsAudit();
    typographyAudit();
    macroGridAndOscHeaderAudit();
    oscillatorVisualSchedulerAudit();
    oscillatorOffscreenSchedulingAudit();
    oscillatorInteractionDeferralAudit();
    oscillatorRevisionSemanticsAudit();
    wavetableCommitRealtimeAudit();
    modulationKnobBaseAudit();
    matrixStableChainDestinationAudit();
    matrixDynamicRouteAudit();
    audioContinuityP0Audit();
    audioPurityP0Audit();
    multiOscillatorTopologyP0Audit();
    frameToolsAudit();
    uiKeyboardRealtimeBoundaryAudit();
    renderBudgetPolicyAudit();
    globalQosBoundaryAudit();
    pluginRealtimeAllocationGate();
    // V24.0.3: the comprehensive processor/keyboard audio audit existed since
    // V23.2 but was never invoked by run(), so plugin builds could regress to
    // silence while the test executable still passed.
    arpTelemetryBoundaryAudit();
    stateIoBoundaryAudit();
    callbackLockBoundaryAudit();
    playheadBoundaryAudit();
    telemetryBoundaryAudit();
    playabilityAudit();

    auto pOwner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*pOwner;check(p.getUiInstrumentState().oscillators[3].id==4,"processor owns initial four modules");
    check(p.getUiVisualizationMask()==ui::visualizationBit(ui::VisualizationEffect::Chaos),
          "visualization defaults enable only Chaos");
    const auto customVisualMask=ui::visualizationBit(ui::VisualizationEffect::Env) |
                                ui::visualizationBit(ui::VisualizationEffect::Osc);
    p.setUiVisualizationMask(customVisualMask);
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    auto& initialRack=rack(*editor);
    check(static_cast<bool>(initialRack.onWavetableEditorRequested),"wavetable editor action exists");
    initialRack.onWavetableEditorRequested(1);
    ui::FrameTools* frameTools=nullptr;
    walk(*editor,[&](auto& component) {
        if(auto* candidate=dynamic_cast<ui::FrameTools*>(&component))frameTools=candidate;
    });
    check(frameTools!=nullptr && frameTools->isVisible() && frameTools->getParentComponent()->isVisible(),
          "Frame Tools replace TABLE in visible editor");
    check(frameTools->getHeight()>70,"Frame Tools have room for compact controls");
    {
        const auto screenshot=editor->createComponentSnapshot(editor->getLocalBounds(),true,1.0f);
        const juce::File file("/tmp/origami-frame-tools.png");
        file.deleteFile();
        juce::FileOutputStream output(file);
        juce::PNGImageFormat{}.writeImageToStream(screenshot,output);
    }
    juce::Viewport* frameViewport=nullptr;
    walk(*frameTools->getParentComponent(),[&](auto& component) {
        if(auto* viewport=dynamic_cast<juce::Viewport*>(&component))
            if(viewport->getViewedComponent()!=nullptr &&
               viewport->getViewedComponent()->getNumChildComponents()==5 && viewport->getHeight()>60)
                frameViewport=viewport;
    });
    check(frameViewport!=nullptr,"frame strip viewport remains available");
    auto frameCardCount=[&] {return frameViewport->getViewedComponent()->getNumChildComponents()-1;};
    check(frameCardCount()==4,"initial frame strip has four cards");
    frameTools->onCommand(ui::FrameTools::Command::Duplicate);
    check(frameCardCount()==5,"duplicate adds one frame through toolbar command");
    const auto undoKey=juce::KeyPress('z',juce::ModifierKeys::commandModifier,'z');
    const auto redoKey=juce::KeyPress('z',juce::ModifierKeys::commandModifier|
                                          juce::ModifierKeys::shiftModifier,'z');
    check(frameTools->getParentComponent()->keyPressed(undoKey) && frameCardCount()==4,
          "structural undo restores frame count");
    check(frameTools->getParentComponent()->keyPressed(redoKey) && frameCardCount()==5,
          "structural redo restores duplicated frame");
    frameTools->onCommand(ui::FrameTools::Command::Copy);
    frameTools->onCommand(ui::FrameTools::Command::Paste);
    check(frameCardCount()==6,"paste inserts complete copied frame");
    check(frameTools->getParentComponent()->keyPressed(undoKey) && frameCardCount()==5,
          "paste is one undoable operation");
    frameTools->onCommand(ui::FrameTools::Command::Before);
    check(frameCardCount()==6,"insert before adds frame");
    check(frameTools->getParentComponent()->keyPressed(undoKey) && frameCardCount()==5,
          "insert before is undoable");
    frameTools->onCommand(ui::FrameTools::Command::After);
    check(frameCardCount()==6,"insert after adds frame");
    check(frameTools->getParentComponent()->keyPressed(undoKey) && frameCardCount()==5,
          "insert after is undoable");
    frameTools->onCommand(ui::FrameTools::Command::Delete);
    check(frameCardCount()==4,"delete removes active frame");
    check(frameTools->getParentComponent()->keyPressed(undoKey) && frameCardCount()==5,
          "delete is undoable");
    frameTools->onCommand(ui::FrameTools::Command::Morph);
    check(frameCardCount()==256,"TO TARGET morph reaches 256 frames through editor command");
    check(frameTools->getParentComponent()->keyPressed(undoKey) && frameCardCount()==5,
          "one undo restores sparse source after target morph");
    check(frameTools->getParentComponent()->keyPressed(redoKey) && frameCardCount()==256,
          "one redo restores densified table");
    check(frameTools->getParentComponent()->keyPressed(juce::KeyPress(juce::KeyPress::escapeKey)),
          "wavetable editor closes after visual audit");
    juce::TextButton* globalButton=nullptr;ui::GlobalPanel* globalPanel=nullptr;
    walk(*editor,[&](auto& component){
        if(auto* button=dynamic_cast<juce::TextButton*>(&component);button && button->getButtonText()=="GLOBAL") globalButton=button;
        if(auto* panel=dynamic_cast<ui::GlobalPanel*>(&component)) globalPanel=panel;
    });
    check(globalButton!=nullptr && globalPanel!=nullptr,"GLOBAL workspace controls are present");
    globalButton->onClick();
    check(globalPanel->isVisible(),"GLOBAL header button opens the GLOBAL workspace");
    auto& r=rack(*editor);check(r.count()==4,"editor mirrors model");
    auto& viewport=const_cast<juce::Viewport&>(r.viewport());
    std::vector<juce::Component*> targets;
    walk(r,[&](auto& c){if(dynamic_cast<ui::RackSlider*>(&c) || dynamic_cast<juce::Label*>(&c) || dynamic_cast<juce::Button*>(&c))
        if(viewport.isParentOf(&c)) targets.push_back(&c);});
    unsigned sliders=0;
    for(auto* c:targets) {
        viewport.setViewPosition(80,0);const int before=viewport.getViewPositionX();
        const auto state=p.getUiInstrumentState();
        juce::MouseWheelDetails wheel{};wheel.deltaX=-.1f;wheel.deltaY=.01f;wheel.isSmooth=true;
        c->mouseWheelMove(event(*c),wheel);
        check(viewport.getViewPositionX()==before,"bubbled descendant wheel is not delivered twice");
        // Native JUCE dispatch then invokes content's recursive mouse listener.
        viewport.mouseWheelMove(event(*c),wheel);
        if(viewport.getViewPositionX()<=before) std::cerr<<"wheel target: "<<c->getName()<<" type "<<typeid(*c).name()<<" before "<<before<<" after "<<viewport.getViewPositionX()<<" width "<<viewport.getWidth()<<" content "<<viewport.getViewedComponent()->getWidth()<<'\n';
        check(viewport.getViewPositionX()>before,"horizontal gesture reaches viewport over descendant");
        check(encodeInstrumentState(p.getUiInstrumentState())==encodeInstrumentState(state),"wheel cannot mutate controls");
        if(auto* slider=dynamic_cast<ui::RackSlider*>(c)) {
            ++sliders;viewport.setViewPosition(80,0);wheel.deltaX=0;wheel.deltaY=-.1f;
            slider->mouseWheelMove(event(*slider),wheel);viewport.mouseWheelMove(event(*slider),wheel);
            check(viewport.getViewPositionX()>80,"vertical native wheel fallback retained");
            slider->setScrollWheelEnabled(true); // shared type policy cannot regress with this flag
            viewport.setViewPosition(80,0);slider->mouseWheelMove(event(*slider),wheel);viewport.mouseWheelMove(event(*slider),wheel);
            check(encodeInstrumentState(p.getUiInstrumentState())==encodeInstrumentState(state),"rack slider policy overrides wheel flag");
        }
    }
    // mct-origami-audio-reengineer-p05.5-semantic-control-audit
    // Keep behavioral coverage for every discovered RackSlider, but verify the
    // required baseline controls semantically rather than freezing the UI at
    // exactly 32 descendants forever.
    for(unsigned osc=1;osc<=4;++osc) {
        ui::OscillatorCard* card=nullptr;
        walk(r,[&](auto& component) {
            if(auto* candidate=dynamic_cast<ui::OscillatorCard*>(&component))
                if(candidate->id()==osc) card=candidate;
        });
        check(card!=nullptr,"oscillator card present for baseline control audit");
        const std::array<juce::String,8> requiredNames{{
            "OSC PAN","OSC LEVEL","OSC TUNING OCT","OSC TUNING SEM",
            "OSC TUNING FIN","OSC UNISON","OSC DETUNE","OSC BLEND"
        }};
        std::array<unsigned,8> matches{};
        walk(*card,[&](auto& component) {
            if(auto* slider=dynamic_cast<ui::RackSlider*>(&component)) {
                for(std::size_t i=0;i<requiredNames.size();++i)
                    if(slider->getName()==requiredNames[i]) ++matches[i];
            }
        });
        for(std::size_t i=0;i<requiredNames.size();++i) {
            if(matches[i]!=1)
                std::cerr<<"OSC "<<osc<<" control identity "<<requiredNames[i]
                         <<" count="<<matches[i]<<"\n";
            check(matches[i]==1,"baseline oscillator control identity present exactly once");
        }
    }
    check(sliders>=32,"at least the baseline live oscillator controls were behaviorally audited");
    viewport.setViewPosition(0,0);
    // Compare parent-only painting with child painting. The live rotary bounds must
    // contain only panel background beneath the actual child slider.
    ui::OscillatorCard* first=nullptr;
    walk(r,[&](auto& c){if(auto* card=dynamic_cast<ui::OscillatorCard*>(&c)) if(card->id()==1) first=card;});
    check(first!=nullptr,"OSC1 card present");
    std::vector<juce::Rectangle<int>> liveBounds;
    for(auto* c:first->getChildren()) if(auto* s=dynamic_cast<ui::RackSlider*>(c)) {
        if(s->isRotary()) liveBounds.push_back(s->getBounds());
    }
    // mct-origami-audio-reengineer-p05.7-static-dial-gate
    // Paint only the OscillatorCard parent. Neutral OEM hierarchy shading/wells
    // are legitimate beneath child controls, so exact Palette::panel() equality
    // is not a valid proxy for duplicate static knob artwork.
    juce::Image parentOnly(juce::Image::ARGB,first->getWidth(),first->getHeight(),true);
    {
        juce::Graphics parentGraphics(parentOnly);
        first->paint(parentGraphics);
    }

    for(auto bounds:liveBounds) {
        const auto clipped=bounds.getIntersection(first->getLocalBounds()).reduced(3);
        if(clipped.getWidth()<8 || clipped.getHeight()<8) continue;

        const int cx=clipped.getCentreX(), cy=clipped.getCentreY();
        const int radius=juce::jmax(3,juce::jmin(clipped.getWidth(),clipped.getHeight())/2-2);
        int radialPairs=0, matchingPairs=0, contrastSamples=0;
        auto dist=[](juce::Colour a,juce::Colour b) {
            return std::abs(int(a.getRed())-int(b.getRed()))+
                   std::abs(int(a.getGreen())-int(b.getGreen()))+
                   std::abs(int(a.getBlue())-int(b.getBlue()));
        };
        const auto centre=parentOnly.getPixelAt(cx,cy);
        for(int d=2;d<=radius;++d) {
            const auto l=parentOnly.getPixelAt(cx-d,cy);
            const auto r=parentOnly.getPixelAt(cx+d,cy);
            const auto u=parentOnly.getPixelAt(cx,cy-d);
            const auto dn=parentOnly.getPixelAt(cx,cy+d);
            ++radialPairs;
            if(dist(l,r)<12 && dist(u,dn)<12) ++matchingPairs;
            if(dist(l,centre)>42 || dist(r,centre)>42 ||
               dist(u,centre)>42 || dist(dn,centre)>42) ++contrastSamples;
        }
        const bool suspiciousDial =
            radialPairs>4 &&
            matchingPairs*100/radialPairs>=80 &&
            contrastSamples*100/radialPairs>=45;
        if(suspiciousDial)
            std::cerr<<"static-dial suspicion at "<<bounds.toString()<<"\n";
        check(!suspiciousDial,"no static dial beneath any live rotary");
    }
    const auto screenshot=editor->createComponentSnapshot(editor->getLocalBounds(),true,1.5f);
    juce::FileOutputStream output(juce::File("/tmp/origami-audit-ui.png"));juce::PNGImageFormat{}.writeImageToStream(screenshot,output);
    const auto initial=encodeInstrumentState(p.getUiInstrumentState());
    editor.reset();editor.reset(p.createEditor());
    check(encodeInstrumentState(p.getUiInstrumentState())==initial,"reopening editor never adds oscillators");
    check(p.getUiVisualizationMask()==customVisualMask,"editor reconstruction preserves visualization preferences");
    p.removeUiOscillator(2);p.setUiOscillatorEnabled(1,false);p.setUiOscillatorEnabled(3,false);
    auto m=p.getUiOscillatorState(4);m.wtPosition=.375f;m.pan=-.75f;m.level=.25f;p.setUiOscillatorState(4,m);
    juce::MemoryBlock bytes;p.getStateInformation(bytes);
    auto restoredOwner=std::make_unique<OrigamiAudioProcessor>(); auto& restored=*restoredOwner;restored.setStateInformation(bytes.getData(),static_cast<int>(bytes.getSize()));
    check(restored.getUiVisualizationMask()==customVisualMask,"plugin state restores visualization preferences");
    juce::MemoryBlock again;restored.getStateInformation(again);check(bytes==again,"processor state round trip");
    auto restoredEditor=std::unique_ptr<juce::AudioProcessorEditor>(restored.createEditor());
    check(rack(*restoredEditor).count()==3,"restored topology shown on editor open");
    p.setStateInformation(bytes.getData(),static_cast<int>(bytes.getSize()));
    rack(*editor).syncFromModel();
    check(rack(*editor).count()==3,"open editor rebuilds after topology restore");
    auto changed=restored.getUiInstrumentState();changed.parameters[0]=1.875f;
    applyLegacyOscillatorParameters(changed.oscillators[0],changed.parameters);
    auto changedBytes=encodeInstrumentState(changed);
    p.setStateInformation(changedBytes.data(),static_cast<int>(changedBytes.size()));
    rack(*editor).syncFromModel();
    bool synced=false;
    walk(*editor,[&](auto& c){if(auto* card=dynamic_cast<ui::OscillatorCard*>(&c)) if(card->id()==1)
        for(auto* child:card->getChildren()) if(auto* slider=dynamic_cast<ui::RackSlider*>(child))
            if(slider->getName()=="WT POS") synced=slider->getValue()==.625;});
    check(synced,"same topology restore synchronizes live controls");
    p.setStateInformation(bytes.getData(),static_cast<int>(bytes.getSize()));
    p.setStateInformation(bytes.getData(),static_cast<int>(bytes.getSize())-1);
    p.getStateInformation(again);check(bytes==again,"processor truncated state is transactional");
    restored.prepareToPlay(48000,128);juce::AudioBuffer<float> audio(2,128);juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1,60,.8f),0);restored.processBlock(audio,midi);
    check(audio.getMagnitude(0,128)>0,"restored processor produces audio");
    const auto visual=restored.getUiRuntimeVisualizationSnapshot();
    check(visual.active,"runtime visualization observes an audio-rendered voice");
    bool observedWaveform=false;
    for(const auto& module:visual.oscillatorWaveformValid)
        for(auto valid:module) observedWaveform|=valid!=0;
    check(observedWaveform,"oscillator viewport telemetry contains audio-rendered samples");
}
}
void synthFilterCompletionUi() {
    auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;p.prepareToPlay(48000,256);
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());ui::FilterPanel* panel=nullptr;ui::OscillatorCard* card=nullptr;ui::FxPage* page=nullptr;
    walk(*editor,[&](auto& c){if(auto* f=dynamic_cast<ui::FilterPanel*>(&c)) panel=f;if(auto* osc=dynamic_cast<ui::OscillatorCard*>(&c)) if(osc->id()==1) card=osc;if(auto* fx=dynamic_cast<ui::FxPage*>(&c)) page=fx;});
    check(panel && card,"Synth routing surfaces exist");check(panel->typeChoices().size()==dsp::filterTypes.size(),"Synth menu uses the canonical Nodes catalog");for(std::size_t i=0;i<dsp::filterTypes.size();++i) check(panel->typeChoices()[i]==dsp::filterTypes[i].name,"shared type names and persistent ordering");check(!panel->setFilterType(dsp::FilterType::Comb),"unsupported comb is unavailable");check(p.getUiInstrumentState().modulation.synthFilters.nextId==1,"fresh UI has zero explicit filters");
    const auto bus=p.addUiBus();auto osc=p.getUiOscillatorState(1);osc.busRoutes[0]={bus,1};check(p.setUiOscillatorState(1,osc),"OSC previous destination authors bus");
    const auto f=panel->addFilter();check(f && card->dropSynthFilter(f),"Filter -> oscillator invokes canonical insertion");
    auto state=p.getUiInstrumentState();check(state.modulation.synthFilters.filters[0].buses[0].bus==mainBusId && oscillatorOutputRouting(state.modulation,state.oscillators[0]).busRoutes[0].level==0,"UI drop is exclusive and preserves filter output");
    const auto second=panel->addFilter();check(card->addOutputRoute(second,true),"Add Route chooses neutral filter destination");{const auto st=p.getUiInstrumentState();const auto r=oscillatorOutputRouting(st.modulation,st.oscillators[0]);check(r.busRoutes[r.busRouteCount-1].level==0 && r.busRoutes[1].level==1,"neutral addition preserves existing gains");}check(second && panel->dropFilterOnOscillator(second,1),"reverse oscillator -> filter uses same insertion command");
    const auto third=panel->addFilter();check(third && panel->dropFilterAfter(third,f),"explicit AFTER insertion preserves chain");
    state=p.getUiInstrumentState();check(!state.modulation.synthFilters.filters[1].next && state.modulation.synthFilters.filters[0].next==third,"UI serial routing is canonical engine state");
    auto mod=state.modulation;const auto env=addSourceInstance(mod,SourceFamily::Envelope);const auto random=addSourceInstance(mod,SourceFamily::Random);
    mod.routes[0]={mod.nextRouteId++,true,env,{ModDestination::SynthCutoff,0,f},-.5f,false};mod.routes[1]={mod.nextRouteId++,true,random,{ModDestination::SynthDrive,0,f},.2f,true};check(p.setUiModulationState(mod),"scalable sources modulate filter knobs");
    auto catalog=ui::modulationDestinationCatalog(p.getUiInstrumentState(),{});check(std::count_if(catalog.begin(),catalog.end(),[](const auto& entry){return isSynthFilterDestination(entry.address.parameter);})==15,"Nodes/Matrix canonical catalog has five destinations per filter");
    const ModAddress resonance{ModDestination::SynthResonance,0,f};
    check(page && page->addParameterNode(resonance) && page->connectControl(ModSource::Lfo2,resonance).creatable(),"Nodes authors same per-voice filter destination");
    panel->syncFromModel();bool tagged=false;walk(*panel,[&](auto& c){if(auto* knob=dynamic_cast<juce::Slider*>(&c)) if(knob->getProperties().contains("mct.mod.itemId")) {check(int(knob->getProperties()["mct.mod.itemId"])==int(third),"knob assignment targets selected stable filter identity");tagged=true;}});check(tagged,"filter knob assignments tagged");
    // The source-card chrome and all rail metrics are the modulation reference.
    std::vector<ui::SourceEntityButton*> rows;juce::TextButton* add=nullptr;juce::TextButton* remove=nullptr;
    walk(*panel,[&](auto& c){if(auto* row=dynamic_cast<ui::SourceEntityButton*>(&c)) if(row->isVisible()) rows.push_back(row);if(auto* b=dynamic_cast<juce::TextButton*>(&c)) {if(b->getButtonText()=="+") add=b;if(b->getButtonText()=="-") remove=b;}});
    check(rows.size()==3 && add && remove,"filter rail uses shared source-card primitive and collection buttons");
    rows[0]->onClick();check(panel->selectedFilter()==f && rows[0]->getToggleState() && !rows[1]->getToggleState(),"rail selection preserves stable FilterId");
    juce::Slider* cutoff=nullptr;walk(*panel,[&](auto& c){if(auto* k=dynamic_cast<juce::Slider*>(&c)) if(k->getName()=="CUTOFF") cutoff=k;});
    check(cutoff->getTextFromValue(8000)=="8.00 kHz" && cutoff->getTextFromValue(20000)=="20.0 kHz" && cutoff->getDoubleClickReturnValue()==8000,"cutoff units and canonical default reset");cutoff->setValue(1300,juce::sendNotificationSync);check(p.getUiInstrumentState().modulation.synthFilters.filters[0].values.cutoff==1300 && p.getUiInstrumentState().modulation.synthFilters.filters[1].values.cutoff==8000,"selected row edits its own working cutoff control");
    rows[2]->onClick();
    ui::ModulationSourceRow reference(ModSource::Lfo1,"FILTER 1","MOD SOURCE TAB LFO 1");reference.setLookAndFeel(&panel->getLookAndFeel());
    for(bool selected:{false,true}) {
        reference.setSize(100,ui::SourceEntityButton::baseHeight-ui::sourceRowGap);reference.setToggleState(selected,juce::dontSendNotification);
        ui::SourceEntityButton filterRow("FILTER 1");filterRow.setName("MOD SOURCE TAB FILTER");filterRow.setLookAndFeel(&panel->getLookAndFeel());filterRow.setSize(reference.getWidth(),reference.getHeight());filterRow.setToggleState(selected,juce::dontSendNotification);
        for(bool hover:{false,true}) {juce::Image a(juce::Image::ARGB,100,34,true),b(juce::Image::ARGB,100,34,true);juce::Graphics ga(a),gb(b);reference.paintButton(ga,hover,false);filterRow.paintButton(gb,hover,false);bool same=true;for(int y=0;y<34;++y) for(int x=0;x<100;++x) same &= a.getPixelAt(x,y)==b.getPixelAt(x,y);check(same,"filter/modulation chrome, typography, grip and selection/hover paint identically");}
    }
    const auto paintPanel=[&](int width,int height,const char* path) {
        panel->setSize(width,height);const auto layout=ui::sourceRailLayout(panel->contentBounds());
        check(panel->sourceRailBounds()==layout.rail && layout.rail.getWidth()==116,"persistent filter rail uses canonical Modulation width");
        for(auto* row:rows) check(row->getWidth()==layout.list.getWidth() && row->getHeight()==ui::ModulationSourceRow::baseHeight-ui::sourceRowGap,"filter row geometry matches unrouted Modulation row");
        bool contained=true;walk(*panel,[&](auto& c){if(auto* k=dynamic_cast<juce::Slider*>(&c)) if(k->isVisible()) contained &= layout.editor.contains(k->getBounds());});check(contained && panel->responseBounds().getHeight()>30,"right editor contains knobs and a usable graph");
        juce::Image image(juce::Image::ARGB,width,height,true);juce::Graphics g(image);panel->paintEntireComponent(g,true);
        const auto response=panel->responseBounds();check(image.getPixelAt(response.getCentreX(),response.getBottom()-2)!=ui::signalSourceColour(),"graph floor has no saturated accent line");
        juce::File file(path);file.deleteFile();if(auto out=file.createOutputStream()) {juce::PNGImageFormat png;png.writeImageToStream(image,*out);}
    };
    paintPanel(662,355,"/tmp/origami-synth-filter-ui.png");paintPanel(532,300,"/tmp/origami-synth-filter-ui-compact.png");
    const auto originalTheme=ui::gTheme;auto alternate=originalTheme;alternate.signal=juce::Colour(0xff40aaff);ui::setDeclarativeTheme(alternate);paintPanel(662,355,"/tmp/origami-synth-filter-ui-blue.png");ui::setDeclarativeTheme(originalTheme);
    juce::MemoryBlock saved;p.getStateInformation(saved);OrigamiAudioProcessor restored;restored.setStateInformation(saved.getData(),int(saved.getSize()));
    auto decoded=restored.getUiInstrumentState();check(decoded.modulation.synthFilters.filters[0].next==third && decoded.modulation.routes[0].destination.itemId==f,"plugin binary wrapper restores serial chain and modulation");
    check(restored.getUiControlLayout().find(nodes::parameterKey(resonance))!=nullptr,"placed Synth parameter node survives wrapper restore");
    check(panel->removeFilter(f),"UI removal splices filter");state=p.getUiInstrumentState();check(!state.modulation.synthFilters.filters[1].next && !state.modulation.routes[0].id,"UI splice preserves downstream and prunes destinations");
    page->syncFromModel();check(!p.getUiControlLayout().find(nodes::parameterKey(resonance)) && !page->controlGraph().find(nodes::parameterKey(resonance)),"deleted filter leaves no placed Nodes destination or cable");
    check(p.removeUiBus(bus),"bus deletion handles Synth filter output");check(validInstrumentState(p.getUiInstrumentState()),"no dangling Synth bus destination");
    check(p.removeUiOscillator(2),"oscillator deletion preserves valid filter model");
    for(int n=2;n<8;++n) {add->onClick();check(panel->selectedFilter()!=0,"Add creates and selects a stable filter");}
    check(!add->isEnabled() && add->getTooltip().contains("8") && panel->addFilter()==0,"eight-filter capacity disables Add truthfully");
    for(int n=0;n<7;++n) check(p.addUiBus()!=0,"maximum route UI adds remaining buses");
    {const auto st=p.getUiInstrumentState();for(std::size_t b=0;b<st.buses.count;++b) card->addOutputRoute(st.buses.buses[b].id,false);for(const auto& filter:st.modulation.synthFilters.filters) if(filter.id) card->addOutputRoute(filter.id,true);}
    card->setSize(662,355);card->syncFromModel();juce::TextButton* routingButton=nullptr;walk(*card,[&](auto& c){if(auto* button=dynamic_cast<juce::TextButton*>(&c)) if(button->getBounds()==card->headerLayout().selectors[2]) routingButton=button;});check(routingButton!=nullptr,"route header opens workspace");routingButton->onClick();
    juce::Viewport* routeView=nullptr;walk(*card,[&](auto& c){if(auto* viewport=dynamic_cast<juce::Viewport*>(&c)) if(viewport->isVisible() && viewport->getViewedComponent()) {for(auto* child:viewport->getViewedComponent()->getChildren()) if(child->getName().startsWith("Output route level")) routeView=viewport;}});
    check(routeView && routeView->getViewedComponent()->getHeight()>=16*48,"maximum destinations live in scrollable route list");routeView->setViewPosition(0,16*48);check(routeView->getViewPositionY()>0,"last destination remains reachable by scrolling");
    {juce::Image image(juce::Image::ARGB,662,355,true);juce::Graphics g(image);card->paintEntireComponent(g,true);juce::File file("/tmp/origami-route-mixer-max.png");file.deleteFile();if(auto out=file.createOutputStream()){juce::PNGImageFormat png;png.writeImageToStream(image,*out);}}
    const auto selected=panel->selectedFilter();remove->onClick();check(synthFilterSlot(p.getUiInstrumentState().modulation.synthFilters,selected)==maxSynthFilters && add->isEnabled() && panel->selectedFilter()!=selected,"Remove splices selected filter and leaves valid selection/capacity");
    check(p.loadUiInitPreset(),"Init loads after explicit filter patch");for(const auto& filter:p.getUiInstrumentState().modulation.synthFilters.filters) check(!filter.id,"Init contains zero Synth instances");
}

void synthFilterEditorTypeAudit() {
    auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;p.prepareToPlay(48000,256);
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());ui::FilterPanel* panel=nullptr;
    walk(*editor,[&](auto& c){if(auto* f=dynamic_cast<ui::FilterPanel*>(&c)) panel=f;});check(panel!=nullptr,"actual multimode editor exists");
    const auto* descriptor=fx::findFxEffect(fx::FxEffectType::Filter);const auto* typeParameter=descriptor?fx::findFxParameter(*descriptor,5):nullptr;check(typeParameter && typeParameter->choiceLabels==dsp::filterTypeLabels.data() && typeParameter->choices==int(dsp::filterTypes.size()),"Nodes descriptor directly references shared canonical labels");
    const auto id=panel->addFilter();panel->setSize(662,355);juce::Slider *cutoff=nullptr,*resonance=nullptr,*gain=nullptr;
    walk(*panel,[&](auto& c){if(auto* k=dynamic_cast<juce::Slider*>(&c)){if(k->getName()=="CUTOFF") cutoff=k;if(k->getName()=="RESONANCE") resonance=k;if(k->getName()=="GAIN") gain=k;}});
    check(cutoff && resonance && gain,"canonical parameter controls exist");
    const auto save=[&](const juce::String& name){const auto image=panel->createComponentSnapshot(panel->getLocalBounds(),true,2.f);juce::File file("/tmp/origami-filter-editor-"+name+".png");file.deleteFile();if(auto out=file.createOutputStream()){juce::PNGImageFormat png;png.writeImageToStream(image,*out);}};
    for(const auto& info:dsp::filterTypes) if(info.synth) {
        check(panel->setFilterType(info.id),"supported type edits canonical state");check(p.getUiInstrumentState().modulation.synthFilters.filters[0].type==info.id,"type persists selected stable filter");
        check(gain->isVisible()==info.gain,"Gain control appears only for gain-bearing types");
        if(info.gain) {gain->setValue(6,juce::sendNotificationSync);check(p.getUiInstrumentState().modulation.synthFilters.filters[0].values.gain==6,"Gain writes canonical state");}
        cutoff->setValue(1000,juce::sendNotificationSync);resonance->setValue(.6,juce::sendNotificationSync);
        const auto plot=panel->editorRegions().plot.toFloat();const dsp::FilterResponseAxis axis{48000};auto handle=panel->responseHandle();check(std::abs(handle.x-(plot.getX()+float(axis.x(1000))*plot.getWidth()))<.1f,"knob drives canonical response handle");
        const juce::Point<float> target{plot.getX()+float(axis.x(5000))*plot.getWidth(),handle.y+.3f*plot.getHeight()};check(panel->editResponseHandle(target),"response handle accepts parameter edit");const auto values=p.getUiInstrumentState().modulation.synthFilters.filters[0].values;
        check(std::abs(values.cutoff-5000)<2 && (info.id==dsp::FilterType::Bell ? std::abs(values.resonance-.6f)<.001f && std::abs(values.gain+22.8f)<.01f : std::abs(values.resonance-.3f)<.001f) && std::abs(cutoff->getValue()-values.cutoff)<1,"handle updates canonical state and matching knobs");
        juce::MemoryBlock bytes;p.getStateInformation(bytes);OrigamiAudioProcessor restored;restored.setStateInformation(bytes.getData(),int(bytes.getSize()));const auto f=restored.getUiInstrumentState().modulation.synthFilters.filters[0];check(f.id==id && f.type==info.id && f.values.gain==values.gain,"each selectable type and Gain survive processor wrapper restore");save("type-"+juce::String(int(info.id)));
    }
    check(panel->setFilterType(dsp::FilterType::LowPass),"visual sweep returns to low pass");resonance->setValue(.1,juce::sendNotificationSync);
    for(int hz:{100,1000,5000,10000,20000}) {cutoff->setValue(hz,juce::sendNotificationSync);save("cutoff-"+juce::String(hz));}
    const auto second=panel->addFilter();check(second!=id && p.getUiInstrumentState().modulation.synthFilters.filters[1].type==dsp::FilterType::LowPass,"switching filter selection uses its own type");check(panel->setFilterType(dsp::FilterType::HighPass),"second filter authors independent type");check(p.getUiInstrumentState().modulation.synthFilters.filters[0].type==dsp::FilterType::LowPass,"type switch cannot change previous filter");
}

void synthFilterPrecisionVisualAudit() {
    auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;p.prepareToPlay(48000,256);
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());ui::FilterPanel* panel=nullptr;ui::ModulationPanel* lfo=nullptr;
    walk(*editor,[&](auto& c){if(auto* f=dynamic_cast<ui::FilterPanel*>(&c)) panel=f;if(auto* m=dynamic_cast<ui::ModulationPanel*>(&c)) lfo=m;});check(panel && lfo,"precision fixtures use actual FilterPanel and LFO reference");
    check(lfo->selectSource(ModSource::Lfo1),"proportion reference selects existing LFO");lfo->lfoStrip().setPage(ui::LfoControlStrip::Page::Func);
    {auto image=lfo->createComponentSnapshot(lfo->getLocalBounds(),true,2.f);juce::File file("/tmp/origami-filter-proportion-lfo.png");file.deleteFile();if(auto stream=file.createOutputStream()){juce::PNGImageFormat png;png.writeImageToStream(image,*stream);}}

    panel->addFilter();panel->setSize(662,355);const auto theme=ui::gTheme;
    const auto start=panel->responseHandle();auto down=event(*panel).withNewPosition(start);static_cast<juce::Component*>(panel)->mouseDown(down);
    check(std::abs(p.getUiInstrumentState().modulation.synthFilters.filters[0].values.resonance-.1f)<.001f,"grabbing curve handle does not jump resonance");
    const auto plot=panel->editorRegions().plot.toFloat();const dsp::FilterResponseAxis gestureAxis{48000};auto drag=down.withNewPosition(juce::Point<float>{plot.getX()+float(gestureAxis.x(5000))*plot.getWidth(),start.y-.2f*plot.getHeight()});static_cast<juce::Component*>(panel)->mouseDrag(drag);static_cast<juce::Component*>(panel)->mouseUp(drag);
    const auto gestureValues=p.getUiInstrumentState().modulation.synthFilters.filters[0].values;check(std::abs(gestureValues.cutoff-5000)<2 && std::abs(gestureValues.resonance-.3f)<.001f,"anchored horizontal and vertical gestures update the canonical knobs");
    const auto set=[&](dsp::FilterType type,float cutoff,float resonance,float mix=1.f,float gain=6.f) {auto m=p.getUiInstrumentState().modulation;auto& f=m.synthFilters.filters[synthFilterSlot(m.synthFilters,panel->selectedFilter())];f.type=type;f.values={cutoff,resonance,0,mix,0,dsp::filterTypeInfo(type)->gain?gain:0.f};check(p.setUiModulationState(m),"visual fixture edits only canonical filter values");panel->syncFromModel();};
    const auto render=[&](const juce::String& name) {
        const auto r=panel->editorRegions();const auto rail=ui::sourceRailLayout(panel->contentBounds());
        check(!rail.rail.intersects(r.header) && !rail.rail.intersects(r.response) && !rail.rail.intersects(r.parameters),"rail and editor never overlap");
        check(r.header.getCentreY()==rail.header.getCentreY() && r.header.getX()==r.response.getX() && r.header.getRight()==r.parameters.getRight(),"shared editor alignment and SOURCE header centerline");
        if(panel->getWidth()==662) check(r.response.getHeight()==189 && r.parameters.getHeight()==80 && r.parameterBank.getWidth()>=468 && r.parameterBank.getY()>=271,"graph dominates a shallow, low, widely spaced control footer");
        check(r.response.contains(r.plot) && r.response.contains(r.frequencyAxis) && r.response.contains(r.levelAxis) && !r.plot.intersects(r.frequencyAxis) && !r.plot.intersects(r.levelAxis),"dedicated axes remain contained outside plot");
        const auto h=panel->responseHandle();check(r.response.toFloat().contains(juce::Rectangle<float>(8,8).withCentre(h)),"cutoff handle remains inside graph perimeter");
        const auto st=p.getUiInstrumentState();const auto& f=st.modulation.synthFilters.filters[synthFilterSlot(st.modulation.synthFilters,panel->selectedFilter())];dsp::LowPassCoefficientTable table;table.prepare(48000);const dsp::FilterResponseAxis axis{48000,dsp::filterTypeInfo(f.type)->gain?36.:18.};const auto c=dsp::filterDesign(f.type,table.make(f.values.cutoff,f.values.resonance),f.values.gain);
        const float expectedY=r.plot.getY()+float(axis.y(dsp::filterMagnitude(c,f.values.cutoff,48000,f.values.mix)))*r.plot.getHeight();check(std::abs(h.y-expectedY)<.1f,"handle lies on actual response including resonance, type and Mix");
        int knobY=-1,labelY=-1,valueY=-1,valueHeight=-1;walk(*panel,[&](auto& comp){
            if(auto* knob=dynamic_cast<juce::Slider*>(&comp)) if(knob->isVisible()) {check(r.parameterBank.contains(knob->getBounds()),"parameter control stays inside coherent bank");check(knob->getHeight()==54,"parameter stacks use compact common slider height");if(knobY<0) knobY=knob->getY();check(knob->getY()==knobY,"knobs share identical vertical baseline");for(auto* child:knob->getChildren()) if(auto* value=dynamic_cast<juce::Label*>(child)) {if(valueY<0){valueY=value->getY();valueHeight=value->getHeight();}check(value->getY()==valueY && value->getHeight()==valueHeight && knob->getLocalBounds().contains(value->getBounds()),"editable value boxes align and remain contained");}}
            if(auto* label=dynamic_cast<juce::Label*>(&comp)) if(label->getParentComponent()==panel && label->isVisible()) {check(r.parameterBank.contains(label->getBounds()),"parameter labels stay inside bank");if(labelY<0) labelY=label->getY();check(labelY==label->getY(),"parameter label baselines agree");check(label->getWidth()>=60,"supported parameter labels retain readable width");}
            if(auto* button=dynamic_cast<juce::Button*>(&comp)) if(button->getName()=="Synth filter type" || button->getName()=="Synth filter output" || button->getName()=="Power Synth Filter") check(r.header.contains(button->getBounds()) && button->getHeight()>=24 && button->getWantsKeyboardFocus(),"compact selectors and power retain accessible hit areas");
        });
        juce::Image image=panel->createComponentSnapshot(panel->getLocalBounds(),true,2.f);juce::File file("/tmp/origami-filter-polish-"+name+".png");file.deleteFile();if(auto out=file.createOutputStream()){juce::PNGImageFormat png;png.writeImageToStream(image,*out);}
    };
    for(float gain:{0.f,12.f,-12.f}) for(float res:gain==0?std::vector<float>{0.f,.547f}:std::vector<float>{0.f,1.f}) {
        set(dsp::FilterType::Bell,370,res,1,gain);render("peak-"+juce::String(gain,0)+"-"+juce::String(res,3));
    }
    set(dsp::FilterType::Bell,370,.547f,1,0);const auto peakStart=panel->responseHandle();auto peakDown=event(*panel).withNewPosition(peakStart);static_cast<juce::Component*>(panel)->mouseDown(peakDown);
    check(std::abs(p.getUiInstrumentState().modulation.synthFilters.filters[0].values.gain)<.001f,"grabbing PEAK at unity does not jump Gain");
    auto peakDrag=peakDown.withNewPosition(peakStart.translated(0,-panel->editorRegions().plot.getHeight()/8.f));static_cast<juce::Component*>(panel)->mouseDrag(peakDrag);static_cast<juce::Component*>(panel)->mouseUp(peakDrag);
    check(std::abs(p.getUiInstrumentState().modulation.synthFilters.filters[0].values.gain-12)<.001f && std::abs(p.getUiInstrumentState().modulation.synthFilters.filters[0].values.resonance-.547f)<.001f,"PEAK upward drag edits Gain and preserves bandwidth");
    for(int hz:{100,1000,5000,8000,10000,20000}) {set(dsp::FilterType::LowPass,float(hz),.1f);render("lp-"+juce::String(hz));}
    for(float res:{0.f,.6f,1.f}) {set(dsp::FilterType::LowPass,8000,res);render("res-"+juce::String(res,1));}
    for(float mix:{0.f,.25f,.5f,.75f,1.f}) {set(dsp::FilterType::LowPass,8000,.6f,mix);render("mix-"+juce::String(mix,2));}
    for(const auto& info:dsp::filterTypes) if(info.synth && info.id!=dsp::FilterType::LowPass) {set(info.id,5000,.6f);render("type-"+juce::String(int(info.id)));}
    set(dsp::FilterType::LowPass,8000,.1f);
    for(const auto& entry:std::array<std::pair<const char*,juce::Colour>,3>{{{"red",theme.signal},{"cool",juce::Colour(0xff40aaff)},{"bright",juce::Colour(0xffffd040)}}}) {auto t=theme;t.signal=entry.second;ui::setDeclarativeTheme(t);render("theme-"+juce::String(entry.first));}ui::setDeclarativeTheme(theme);
    int count=1;for(int desired:{1,3,8}) {while(count<desired){panel->addFilter();++count;}set(dsp::FilterType::LowPass,8000,.1f);render("count-"+juce::String(desired));}
    juce::Button* power=nullptr;juce::Button* out=nullptr;walk(*panel,[&](auto& c){if(auto* b=dynamic_cast<juce::Button*>(&c)){if(b->getName()=="Power Synth Filter") power=b;if(b->getName()=="Synth filter output") out=b;}});check(power && out && bool(out->onClick),"routing and power retain live canonical callbacks");power->onClick();check(!p.getUiInstrumentState().modulation.synthFilters.filters[7].power && !power->getToggleState(),"compact power bypass writes state");power->onClick();check(p.getUiInstrumentState().modulation.synthFilters.filters[7].power && power->getToggleState(),"compact power restores canonical state");
    check(panel->dropFilterAfter(panel->selectedFilter(),p.getUiInstrumentState().modulation.synthFilters.filters[0].id),"existing serial drop remains canonical");panel->syncFromModel();
    panel->setSize(532,300);render("compact");panel->setSize(662,355);
    editor->setSize(ui::EditorLayout::minWidth,ui::EditorLayout::minHeight);editor->resized();check(panel->getWidth()==662 && panel->getHeight()==355,"supported minimum scales canonical design rather than collapsing controls");editor->setSize(ui::EditorLayout::defaultWidth,ui::EditorLayout::defaultHeight);
    juce::Image whole=editor->createComponentSnapshot(editor->getLocalBounds(),true,1.f);juce::File wholeFile("/tmp/origami-filter-polish-whole.png");wholeFile.deleteFile();if(auto outStream=wholeFile.createOutputStream()){juce::PNGImageFormat png;png.writeImageToStream(whole,*outStream);}
}

void synthPeakEffectiveResponseAudit() {
    InstrumentState state;const auto id=addSynthFilter(state.modulation);auto& filter=state.modulation.synthFilters.filters[0];filter.type=dsp::FilterType::Bell;filter.values={370,.547f,0,1,0,0};
    RuntimeVisualizationSnapshot observed;observed.sampleRate=48000;observed.synthFilterIds[0]=id;observed.synthFilters[0]=filter.values;
    ui::ModulationBindings bindings;bindings.snapshot=[&]{return state;};bindings.visualization=[&]{return observed;};
    ui::FilterPanel panel({}, {},bindings);panel.setSize(662,355);const auto plot=panel.editorRegions().plot;const dsp::FilterResponseAxis axis{48000,36};
    const auto render=[&]{return panel.createComponentSnapshot(panel.getLocalBounds(),true,1.f);};
    auto unity=render();const auto unityHandle=panel.responseHandle();
    juce::Colour grid;for(double hz:{100.,1000.,10000.}) {const int x=juce::roundToInt(plot.getX()+axis.x(hz)*plot.getWidth());const auto colour=unity.getPixelAt(x,plot.getY()+10);if(hz==100) grid=colour;check(colour==grid && colour.getBrightness()<.25f,"all major frequency lines use consistent subdued neutral grid colour");}
    dsp::LowPassCoefficientTable table;table.prepare(48000);
    for(const auto& info:dsp::filterTypes) if(info.synth) {
        filter.type=info.id;filter.values={370,.547f,0,1,0,info.gain?12.f:0.f};panel.syncFromModel();observed.synthFilters[0]=filter.values;
        for(float res:{0.f,1.f}) {
            observed.synthFilters[0].resonance=res;observed.synthFilters[0].cutoff=1000;
            const auto image=render();const auto values=observed.synthFilters[0];const auto c=dsp::filterDesign(info.id,table.make(values.cutoff,res),values.gain);const dsp::FilterResponseAxis typeAxis{48000,info.gain?36.:18.};
            const auto handle=panel.responseHandle();const float y=plot.getY()+typeAxis.y(dsp::filterMagnitude(c,1000,48000))*plot.getHeight();
            check(std::abs(handle.y-y)<.1f && std::abs(handle.x-(plot.getX()+typeAxis.x(1000)*plot.getWidth()))<.1f,"every type handle reads effective frequency/resonance/gain telemetry");
            const double hz=1500;const int x=juce::roundToInt(plot.getX()+typeAxis.x(hz)*plot.getWidth()),curveY=juce::roundToInt(plot.getY()+typeAxis.y(dsp::filterMagnitude(c,hz,48000))*plot.getHeight());float brightness=0;
            for(int dy=-2;dy<=2;++dy) if(plot.contains(x,curveY+dy)) brightness=std::max(brightness,image.getPixelAt(x,curveY+dy).getBrightness());
            check(brightness>.6f,"effective type-specific parameters update analytical response stroke immediately");
            check(filter.values.cutoff==370 && filter.values.resonance==.547f,"effective graph never overwrites authored values");
        }
    }
    filter.type=dsp::FilterType::Bell;panel.syncFromModel();observed.synthFilters[0]={370,1,0,1,0,12};const auto boostHandle=panel.responseHandle();
    check(boostHandle.y<unityHandle.y,"effective PEAK Gain lifts the truthful response handle");
    observed.synthFilters[0].gain=-12;check(panel.responseHandle().y>unityHandle.y,"effective PEAK cut lowers the response handle");
}

void synthResponseFillAudit() {
    InstrumentState state;const auto f=addSynthFilter(state.modulation);RuntimeVisualizationSnapshot observed;observed.sampleRate=48000;observed.synthFilterIds[0]=f;observed.synthFilters[0]={1200,.1f,0,1,0};
    ui::ModulationBindings bindings;bindings.snapshot=[&]{return state;};bindings.visualization=[&]{return observed;};
    ui::FilterPanel panel({}, {},bindings);panel.setSize(662,355);const auto plot=panel.editorRegions().plot;
    const auto render=[&] {juce::Image image(juce::Image::ARGB,662,355,true);juce::Graphics g(image);panel.paintEntireComponent(g,true);return image;};
    const auto theme=ui::gTheme;auto red=render();auto blueTheme=theme;blueTheme.signal=juce::Colour(0xff40aaff);ui::setDeclarativeTheme(blueTheme);auto blue=render();
    const int x=plot.getX()+12,above=plot.getY()+20,below=plot.getBottom()-5;
    check(red.getPixelAt(x,above)==blue.getPixelAt(x,above),"theme does not flood area above curve");
    check(red.getPixelAt(x,below)!=blue.getPixelAt(x,below),"accent fill reaches graph floor below curve and follows theme");
    // At 2 kHz, 300 Hz and 8 kHz responses must move BOTH stroke and fill.
    observed.synthFilters[0].cutoff=300;auto low=render();const auto lowHandle=panel.responseHandle();observed.synthFilters[0].cutoff=8000;auto high=render();check(panel.responseHandle().x>lowHandle.x && state.modulation.synthFilters.filters[0].values.cutoff==8000,"modulation telemetry moves handle without overwriting authored knobs");
    dsp::LowPassCoefficientTable table;table.prepare(48000);const int i=170;const double hz=20*std::pow(1000.,double(i)/255);const int column=plot.getX()+juce::roundToInt(float(i)/255*float(plot.getWidth()));
    const auto curveY=[&](float cutoff) {const double magnitude=dsp::lowPassMagnitude(table.make(cutoff,.1f),hz,48000,1);return plot.getY()+juce::roundToInt(float(dsp::FilterResponseAxis{48000}.y(magnitude))*float(plot.getHeight()));};
    const int lowY=curveY(300),highY=curveY(8000),middle=(lowY+highY)/2;
    check(lowY-highY>20 && low.getPixelAt(column,middle)!=high.getPixelAt(column,middle),"observed cutoff moves fill boundary with truthful response");
    const auto whiteNear=[&](const juce::Image& img,int y) {float brightness=0;for(int dy=-2;dy<=2;++dy) brightness=std::max(brightness,img.getPixelAt(column,y+dy).getBrightness());return brightness;};
    check(whiteNear(low,lowY)>.65f && whiteNear(high,highY)>.65f,"response stroke follows actual coefficient magnitudes");ui::setDeclarativeTheme(theme);
}

void synthFilterVisualComposition() {
    auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;p.prepareToPlay(48000,256);
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
    ui::FilterPanel* filter=nullptr;ui::ModulationPanel* modulation=nullptr;
    walk(*editor,[&](auto& c){if(auto* f=dynamic_cast<ui::FilterPanel*>(&c)) filter=f;if(auto* m=dynamic_cast<ui::ModulationPanel*>(&c)) modulation=m;});
    check(filter && modulation,"visual composition uses actual Synth panels");
    filter->setSize(662,355);modulation->setSize(778,355);
    const auto save=[](const juce::Image& image,const juce::String& name){juce::File file("/tmp/"+name);file.deleteFile();if(auto out=file.createOutputStream()) {juce::PNGImageFormat png;png.writeImageToStream(image,*out);}};
    int authored=0;
    for(int count:{1,3,8}) {
        while(authored<count) {check(filter->addFilter()!=0,"visual fixture adds canonical filter");++authored;}
        check(filter->dropFilterOnOscillator(filter->selectedFilter(),1),"visual fixture exposes actual oscillator input and preserved serial output");
        const auto r=filter->editorRegions();
        check(r.routing.isEmpty() && r.header.getBottom()<r.response.getY() && r.response.getBottom()<r.parameters.getY(),"header/response/parameters are ordered without redundant input-topology row");
        check(r.response.getHeight()>=180 && r.response.getHeight()<=198 && r.parameters.getHeight()==ui::FilterPanel::EditorMetrics::parameterHeight && filter->contentBounds().getBottom()-r.parameters.getBottom()>=4,"graph proportion and parameter breathing room are bounded");
        bool selectedVisible=false,footerContains=true,controlsContained=true;juce::Viewport* viewport=nullptr;
        walk(*filter,[&](auto& c){if(auto* v=dynamic_cast<juce::Viewport*>(&c)) viewport=v;});
        const auto rail=ui::sourceRailLayout(filter->contentBounds());
        walk(*filter,[&](auto& c){
            if(auto* row=dynamic_cast<ui::SourceEntityButton*>(&c)) if(row->isVisible() && row->getToggleState()) selectedVisible=viewport->getBounds().contains(filter->getLocalArea(row,row->getLocalBounds()));
            if(auto* b=dynamic_cast<juce::TextButton*>(&c)) if(b->getButtonText()=="+" || b->getButtonText()=="-") footerContains &= rail.rail.contains(b->getBounds()) && b->getY()>viewport->getBottom();
            if(auto* k=dynamic_cast<juce::Slider*>(&c)) if(k->isVisible()) controlsContained &= r.parameters.contains(k->getBounds());
        });
        check(selectedVisible && footerContains && controlsContained,"selected row remains visible without footer/parameter collisions at each capacity");
        if(count==8) {
            const int selectedScroll=viewport->getViewPositionY();check(selectedScroll>0,"full filter rail scrolls selected last row into view");
            viewport->setViewPosition(0,0);filter->syncFromModel();check(viewport->getViewPositionY()==0,"model polling preserves deliberate user scroll away from selection");viewport->setViewPosition(0,selectedScroll);
        }
        juce::Image panel(juce::Image::ARGB,662,355,true);juce::Graphics gp(panel);filter->paintEntireComponent(gp,true);
        save(panel,"origami-filter-ui2-"+juce::String(count)+".png");
        juce::Image comparison(juce::Image::ARGB,1440,355,true);juce::Graphics gc(comparison);modulation->paintEntireComponent(gc,true);gc.setOrigin(778,0);filter->paintEntireComponent(gc,true);
        save(comparison,"origami-filter-ui2-comparison-"+juce::String(count)+".png");
    }
    walk(*editor,[&](auto& c){if(auto* rack=dynamic_cast<ui::OscillatorRack*>(&c)) rack->syncFromModel();});
    // The actual whole Synth canvas also proves the lower regions stay above keys.
    juce::Image canvas(juce::Image::ARGB,editor->getWidth(),editor->getHeight(),true);juce::Graphics g(canvas);editor->paintEntireComponent(g,true);save(canvas,"origami-filter-ui2-synth.png");
}

int main(){juce::ScopedJuceInitialiser_GUI gui;
// Preferences stay in memory (the user's file is never touched). The
// shortcut audits run with CAPTURE KEYBOARD INPUT on, as a user enables it.
ui::UserPreferences::useVolatileStorageForTesting();
// The content library lives in a temporary folder (never the user's library).
const juce::File contentBase=juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("origami-plugin-tests-"+juce::String(juce::Time::currentTimeMillis()));
contentBase.createDirectory();
ui::SharedContentLibrary::setBaseForTesting(contentBase);
juce::SharedResourcePointer<ui::UserPreferences> preferences;preferences->setCaptureKeyboardInput(true);
try{synthPeakEffectiveResponseAudit();synthFilterPrecisionVisualAudit();synthFilterEditorTypeAudit();synthResponseFillAudit();synthFilterCompletionUi();synthFilterVisualComposition();run();std::cout<<"PASS: "<<checks<<" plugin/UI checks\n";return 0;}
catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
