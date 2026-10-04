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
#include "core/preset/StateCodec.h"
#include "tests/NodesScenarios.h"
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <atomic>
#include <cstdlib>
#include <new>
#include <array>
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

    juce::Slider* macro=nullptr;
    walk(*page,[&](auto& c){if(auto* s=dynamic_cast<juce::Slider*>(&c)) if(s->getName()=="FX Macro 1") macro=s;});
    check(macro!=nullptr,"FX macro section present");
    macro->setValue(0.7,juce::sendNotificationSync);
    check(std::abs(p.getUiInstrumentState().modulation.macros[0]-0.7f)<1.0e-4f,"FX macros drive the canonical synth macros");

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
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Buses)) {
        mainBus|=r.label=="MAIN" && r.active && !r.onSecondaryClick; // selected, not deletable
        addBus|=r.label=="+ ADD BUS" && bool(r.onClick);
    }
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Sources)) mainInput|=r.label=="MAIN IN" && r.active;
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Filters))
        filterTruth|=r.label=="FILTER 1" && r.detail.contains("before buses") && r.dragDescription=="MCT_SYNTH_FILTER:1";
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
          && page->macrosPanel().getX()>=page->moduleParametersPanel().getRight(),"MODULE PARAMETERS + MACROS sit beside the sidebar");
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
    slots[13]=0.8f; // ENV 1 (newest voice) raw value
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
    const auto make=[]{ auto q=std::make_unique<OrigamiAudioProcessor>(); q->prepareToPlay(48000.0,256); disableExtraOscillators(*q); return q; };
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
        std::vector<ui::ModulationMatrix*> matrices;
        walk(*editor,[&](auto& c){if(auto* m=dynamic_cast<ui::ModulationMatrix*>(&c)) matrices.push_back(m);});
        const auto observed=render(*a,48,[&]{
            editor->refreshModulationViews();
            for(auto* m:matrices) m->sampleMonitors();
            (void)a->getUiRuntimeVisualizationSnapshot(); (void)a->getUiEnvelopeTraceSnapshot();
        });
        const auto plain=render(*b,48);
        check(!matrices.empty() && observed==plain,"UI observation (editor, telemetry, Matrix monitors) leaves audio bit-identical");
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


void run() {
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
    oscillatorVisualSchedulerAudit();
    oscillatorOffscreenSchedulingAudit();
    oscillatorInteractionDeferralAudit();
    oscillatorRevisionSemanticsAudit();
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
int main(){juce::ScopedJuceInitialiser_GUI gui;try{run();std::cout<<"PASS: "<<checks<<" plugin/UI checks\n";return 0;}
catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
