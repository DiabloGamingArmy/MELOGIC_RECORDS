#include "OscillatorRack.h"
namespace mct::origami::ui {
OscillatorCard::OscillatorCard(OscillatorDisplay display,std::function<void(unsigned)> remove)
    : Panel("OSC "+juce::String(display.id)),display_(std::move(display)) {
    addAndMakeVisible(remove_);remove_.setTooltip("Remove this layout module (does not change audio)");
    remove_.setName("Remove OSC "+juce::String(display_.id));remove_.onClick=[id=display_.id,remove=std::move(remove)] {remove(id);};
}
void OscillatorCard::resized() {remove_.setBounds(getWidth()-31,6,24,21);}
void OscillatorCard::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    text(g,display_.source,{87,5,getWidth()-128,25},10,Palette::muted(),juce::Justification::centred);
    const int controlsHeight=juce::jmin(57,body.getHeight()/3+7);
    auto controls=body.removeFromBottom(controlsHeight);body.removeFromBottom(6);
    auto caption=body.removeFromBottom(20);graph(g,body);
    text(g,"INIT / "+display_.source.toUpperCase(),caption,9,Palette::muted(),juce::Justification::centred);
    dials(g,controls,{"WT POS","UNISON","DETUNE","BLEND","PAN","LEVEL"});
}
OscillatorRack::OscillatorRack(): Panel("OSCILLATORS") {
    addAndMakeVisible(viewport_);viewport_.setViewedComponent(&content_,false);
    viewport_.setScrollBarsShown(false,true);viewport_.setScrollBarThickness(10);
    viewport_.setScrollOnDragMode(juce::Viewport::ScrollOnDragMode::nonHover);
    for(auto* button:{&add_,&left_,&right_}) addAndMakeVisible(button);
    add_.setTooltip("Add a visual oscillator module. Additional oscillator DSP is not implemented.");addTile_.setTooltip(add_.getTooltip());
    addTile_.setName("Add oscillator module");content_.addAndMakeVisible(addTile_);
    add_.onClick=[this]{addOscillator();};addTile_.onClick=add_.onClick;
    left_.setName("Scroll oscillators left");right_.setName("Scroll oscillators right");
    left_.onClick=[this]{viewport_.setViewPosition(juce::jmax(0,viewport_.getViewPositionX()-cardWidth_-10),0);};
    right_.onClick=[this]{viewport_.setViewPosition(viewport_.getViewPositionX()+cardWidth_+10,0);};
    for(int i=0;i<4;++i) addOscillator();
}
OscillatorRack::~OscillatorRack() {viewport_.setViewedComponent(nullptr,false);}
void OscillatorRack::addOscillator() {
    juce::Component::SafePointer<OscillatorRack> safe(this);
    auto card=std::make_unique<OscillatorCard>(OscillatorDisplay{nextId_++,"Wavetable"},[safe](unsigned id){
        // Defer deletion beyond the originating button callback.
        juce::MessageManager::callAsync([safe,id]{if(safe!=nullptr)safe->removeOscillator(id);});
    });
    content_.addAndMakeVisible(*card);cards_.push_back(std::move(card));layoutCards();repaint();
    if(viewport_.getWidth()>0) viewport_.setViewPosition(juce::jmax(0,content_.getWidth()-viewport_.getMaximumVisibleWidth()),0);
}
void OscillatorRack::removeOscillator(unsigned id) {
    cards_.erase(std::remove_if(cards_.begin(),cards_.end(),[id](const auto& card){return card->id()==id;}),cards_.end());
    layoutCards();repaint();
}
void OscillatorRack::layoutCards() {
    const auto previousX=viewport_.getViewPositionX();
    cardWidth_=juce::jlimit(236,300,(viewport_.getWidth()-84-40)/4);
    const int height=juce::jmax(0,viewport_.getHeight()-12);
    int x=0;for(auto& card:cards_) {card->setBounds(x,0,cardWidth_,height);x+=cardWidth_+10;}
    addTile_.setBounds(x,0,74,height);content_.setSize(juce::jmax(viewport_.getWidth(),x+74),height);
    viewport_.setViewPosition(juce::jmin(previousX,juce::jmax(0,content_.getWidth()-viewport_.getMaximumVisibleWidth())),0);
}
void OscillatorRack::resized() {
    add_.setBounds(getWidth()-155,5,143,23);
    auto body=contentBounds();left_.setBounds(body.removeFromLeft(25).reduced(0,8));body.removeFromLeft(7);
    right_.setBounds(body.removeFromRight(25).reduced(0,8));body.removeFromRight(7);viewport_.setBounds(body);layoutCards();
}
void OscillatorRack::paintContent(juce::Graphics& g,juce::Rectangle<int>) {
    text(g,juce::String(count())+" MODULES / LAYOUT PREVIEW",{140,5,getWidth()-305,24},9,Palette::muted(),juce::Justification::centredRight);
}
}
