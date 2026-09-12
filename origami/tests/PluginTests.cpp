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
void playabilityAudit() {
    OrigamiAudioProcessor host;
    host.prepareToPlay(48000,128);
    disableExtraOscillators(host);
    auto hostAudio=renderNote(host);
    check(magnitude(hostAudio)>1.0e-5f,"host MIDI note produces audible stereo output");

    OrigamiAudioProcessor ui;
    ui.prepareToPlay(48000,128);
    disableExtraOscillators(ui);
    ui.uiKeyboardState().noteOn(1,60,.8f);
    juce::AudioBuffer<float> uiAudio(2,1024);uiAudio.clear();
    juce::MidiBuffer emptyMidi;
    ui.processBlock(uiAudio,emptyMidi);
    check(magnitude(uiAudio)>1.0e-5f,"on-screen keyboard note produces audio");
    ui.uiKeyboardState().noteOff(1,60,0.0f);

    OrigamiAudioProcessor power;
    power.prepareToPlay(48000,128);
    disableExtraOscillators(power);
    check(power.setUiOscillatorEnabled(1,false),"OSC1 power can be disabled");
    auto silent=renderNote(power);
    check(magnitude(silent)<1.0e-7f,"all disabled oscillators produce silence");

    OrigamiAudioProcessor levelZero;
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

    OrigamiAudioProcessor levelAudible;
    levelAudible.prepareToPlay(48000,128);disableExtraOscillators(levelAudible);
    check(levelAudible.setUiParameter(ParameterId::OscLevel,.8f),"OSC1 audible level accepted");
    check(magnitude(renderNote(levelAudible))>1.0e-5f,"OSC level restores sound");

    OrigamiAudioProcessor wtA,wtB;
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

    OrigamiAudioProcessor pitchA,pitchB;
    pitchA.prepareToPlay(48000,128);pitchB.prepareToPlay(48000,128);
    disableExtraOscillators(pitchA);disableExtraOscillators(pitchB);
    check(pitchA.setUiParameter(ParameterId::OscOctave,0.0f) && pitchB.setUiParameter(ParameterId::OscOctave,1.0f),"octave states accepted");
    const auto pa=renderNote(pitchA),pb=renderNote(pitchB);
    bool pitchDifferent=false;
    for(int i=0;i<pa.getNumSamples() && !pitchDifferent;++i)
        pitchDifferent=std::abs(pa.getSample(0,i)-pb.getSample(0,i))>1.0e-5f;
    check(pitchDifferent,"oscillator octave changes rendered audio");

    OrigamiAudioProcessor uniA,uniB;
    uniA.prepareToPlay(48000,128);uniB.prepareToPlay(48000,128);
    disableExtraOscillators(uniA);disableExtraOscillators(uniB);
    check(uniA.setUiParameter(ParameterId::OscUnison,1.0f)
          && uniB.setUiParameter(ParameterId::OscUnison,4.0f)
          && uniB.setUiParameter(ParameterId::OscDetune,30.0f),"unison states accepted");
    const auto ua=renderNote(uniA),ub=renderNote(uniB);
    check(std::abs(energy(ua)-energy(ub))>1.0e-6,"unison/detune changes rendered output");

    OrigamiAudioProcessor pan;
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

    OrigamiAudioProcessor filterLow,filterHigh;
    filterLow.prepareToPlay(48000,128);filterHigh.prepareToPlay(48000,128);
    disableExtraOscillators(filterLow);disableExtraOscillators(filterHigh);
    check(filterLow.setUiParameter(ParameterId::Cutoff,100.0f),"low cutoff accepted");
    check(filterHigh.setUiParameter(ParameterId::Cutoff,20000.0f),"high cutoff accepted");
    const auto low=renderNote(filterLow,100,1.0f,4096),high=renderNote(filterHigh,100,1.0f,4096);
    check(energy(low)<energy(high),"filter cutoff affects audible output");

    OrigamiAudioProcessor fastAttack,slowAttack;
    fastAttack.prepareToPlay(48000,128);slowAttack.prepareToPlay(48000,128);
    disableExtraOscillators(fastAttack);disableExtraOscillators(slowAttack);
    check(fastAttack.setUiParameter(ParameterId::Attack,0.001f),"fast attack accepted");
    check(slowAttack.setUiParameter(ParameterId::Attack,0.5f),"slow attack accepted");
    const auto fast=renderNote(fastAttack,60,1.0f,1024),slow=renderNote(slowAttack,60,1.0f,1024);
    check(energy(slow)<energy(fast),"ENV attack changes note onset");
    releaseNote(fastAttack,60,256,128);
    juce::AudioBuffer<float> tail(2,128);tail.clear();juce::MidiBuffer none;fastAttack.processBlock(tail,none);
    check(magnitude(tail)<1.0e-6f,"note release eventually reaches silence");

    OrigamiAudioProcessor one,two;
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
    OrigamiAudioProcessor p;
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
    OrigamiAudioProcessor stress;
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
    stress.uiKeyboardState().noteOn(1,72,0.8f);
    stressAudio.clear(); stress.processBlock(stressAudio,stressMidi[1]);
    stress.uiKeyboardState().noteOff(1,72,0.0f);
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

void run() {
    pluginRealtimeAllocationGate();
    // V24.0.3: the comprehensive processor/keyboard audio audit existed since
    // V23.2 but was never invoked by run(), so plugin builds could regress to
    // silence while the test executable still passed.
    playabilityAudit();

    OrigamiAudioProcessor p;check(p.getUiInstrumentState().oscillators[3].id==4,"processor owns initial four modules");
    auto editor=std::unique_ptr<juce::AudioProcessorEditor>(p.createEditor());
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
    p.removeUiOscillator(2);p.setUiOscillatorEnabled(1,false);p.setUiOscillatorEnabled(3,false);
    auto m=p.getUiOscillatorState(4);m.wtPosition=.375f;m.pan=-.75f;m.level=.25f;p.setUiOscillatorState(4,m);
    juce::MemoryBlock bytes;p.getStateInformation(bytes);
    OrigamiAudioProcessor restored;restored.setStateInformation(bytes.getData(),static_cast<int>(bytes.getSize()));
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
}
}
int main(){juce::ScopedJuceInitialiser_GUI gui;try{run();std::cout<<"PASS: "<<checks<<" plugin/UI checks\n";return 0;}
catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
