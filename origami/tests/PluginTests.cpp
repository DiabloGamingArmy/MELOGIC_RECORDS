#include "plugin/PluginProcessor.h"
#include "plugin/PluginEditor.h"
#include "core/preset/StateCodec.h"
#include <iostream>
#include <stdexcept>
using namespace mct::origami;
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
void run() {
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
    check(sliders==32,"all eight live controls on all four oscillators audited");
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
    std::vector<juce::Component*> visible;
    for(auto* c:first->getChildren()) if(c->isVisible()) {visible.push_back(c);c->setVisible(false);}
    const auto parent=first->createComponentSnapshot(first->getLocalBounds());
    for(auto bounds:liveBounds) {
        bool clean=true;
        for(int y=bounds.getY();y<bounds.getBottom();++y) for(int x=bounds.getX();x<bounds.getRight();++x)
            clean=clean && parent.getPixelAt(x,y)==ui::Palette::panel();
        check(clean,"no static dial beneath any live rotary");
    }
    for(auto* c:visible) c->setVisible(true);
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
