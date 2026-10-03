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
            if(b->getButtonText()=="FX") fxButton=b;
            if(b->getButtonText()=="MATRIX") matrixButton=b;
            if(b->getButtonText()=="SYNTH") synthButton=b;
        }
        if(auto* candidate=dynamic_cast<ui::FxPage*>(&c)) page=candidate;
    });
    check(fxButton && matrixButton && synthButton && page,"FX navigation and page exist");
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
            if(b->getButtonText()=="FX") fxTab=b;
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
          && unsigned(int(props["mct.mod.oscillator"]))==delay && int(props["mct.mod.itemId"])==2,
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
    bool splitRow=false,sendPending=false,bus1=false,filterTruth=false;
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Routes)) {
        splitRow|=r.label=="SPLIT" && r.dragDescription=="MCT_FX_MODULE:1001";
        sendPending|=r.label=="SEND" && !r.enabled;
    }
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Sources)) bus1|=r.label=="BUS 1" && r.active;
    for(const auto& r:page->sidebar().rows(ui::FxSidebar::Tab::Filters)) filterTruth|=r.label=="FILTER 1" && r.detail.contains("before BUS 1");
    check(splitRow && sendPending && bus1 && filterTruth,"SOURCES / FILTERS / ROUTES rows are truthful");

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
    check(p.getUiFxDocument().graph().globals().order==FxOrder::PreMaster,"FX ORDER edits the canonical globals");
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
        q.getUiFxDocument().edit([&](FxGraph& g){FxGlobalSettings s=g.globals();s.order=order;g.setGlobals(s);return true;});
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

void run() {
    fxPageAudit();
    fxGraphUxAudit();
    fxAudioPathAudit();
    fxWorkspaceP03Audit();
    fxModulationAudioAudit();
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
