#include "OscillatorRack.h"
namespace mct::origami::ui {
OscillatorCard::OscillatorCard(OscillatorDisplay display,std::function<void(unsigned)> remove)
    : Panel("OSC "+juce::String(display.ordinal)),display_(std::move(display)) {
    addAndMakeVisible(remove_);
    remove_.setTooltip("Remove this layout module (does not change audio)");
    remove_.onClick=[id=display_.id,removeCallback=std::move(remove)] {removeCallback(id);};
    refreshVisibleNumber();
}

void OscillatorCard::refreshVisibleNumber() {
    title_="OSC "+juce::String(display_.ordinal);
    setName(title_);
    remove_.setName("Remove "+title_);
    repaint();
}

void OscillatorCard::setOrdinal(unsigned ordinal) {
    if(display_.ordinal==ordinal) return;
    display_.ordinal=ordinal;
    refreshVisibleNumber();
}
void OscillatorCard::resized() {remove_.setBounds(getWidth()-31,6,24,21);}
void OscillatorCard::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    // mct-origami-oscillator-identity-tuning-v13
    // Dense by design: this is a wavetable synth. Preserve the established
    // source -> process -> tuning -> performance-control hierarchy.

    text(g,display_.source.toUpperCase(),{87,5,getWidth()-128,25},8.2f,Palette::muted(),juce::Justification::centred);

    auto working=body;
    working.removeFromTop(2);

    const int controlsHeight=56;
    auto controls=working.removeFromBottom(controlsHeight);
    working.removeFromBottom(4);

    const int tuningHeight=30;
    auto tuning=working.removeFromBottom(tuningHeight);
    working.removeFromBottom(4);

    auto upper=working;

    // Right: oscillator-local processing.
    const int processWidth=juce::jlimit(104,132,upper.getWidth()*34/100);
    auto process=upper.removeFromRight(processWidth);
    upper.removeFromRight(7);

    // Left: authoritative 1:1 wavetable viewport + compact browser strip.
    const int browserHeight=22;
    auto browser=upper.removeFromBottom(browserHeight);
    upper.removeFromBottom(4);

    const int squareSize=juce::jmax(96,juce::jmin(upper.getWidth(),upper.getHeight()));
    auto preview=juce::Rectangle<int>(squareSize,squareSize);
    preview.setPosition(upper.getX(),upper.getCentreY()-squareSize/2);

    well(g,preview);
    auto inner=preview.reduced(10);

    g.setColour(Palette::borderSoft().withAlpha(.72f));
    for(int i=1;i<4;++i) {
        const int x=inner.getX()+inner.getWidth()*i/4;
        g.drawVerticalLine(x,float(inner.getY()),float(inner.getBottom()));
    }
    g.setColour(Palette::borderStrong().withAlpha(.34f));
    g.drawHorizontalLine(inner.getCentreY(),float(inner.getX()),float(inner.getRight()));

    // Exactly one oscillator cycle for the current placeholder waveform.
    juce::Path wave;
    for(int i=0;i<=96;++i) {
        const float t=float(i)/96.0f;
        const float y=.5f-.30f*std::sin(t*juce::MathConstants<float>::twoPi);
        const float px=float(inner.getX())+t*inner.getWidth();
        const float py=float(inner.getY())+y*inner.getHeight();
        if(i==0) wave.startNewSubPath(px,py); else wave.lineTo(px,py);
    }
    g.setColour(Palette::accent().withAlpha(.94f));
    g.strokePath(wave,juce::PathStrokeType(1.55f));

    // Wavetable/browser identity strip. Visual scaffold only for now.
    auto browserBox=browser.withX(preview.getX()).withWidth(preview.getWidth());
    well(g,browserBox);
    text(g,"<",browserBox.removeFromLeft(18),8.5f,Palette::muted(),juce::Justification::centred);
    text(g,">",browserBox.removeFromRight(18),8.5f,Palette::muted(),juce::Justification::centred);
    text(g,"BASIC SHAPES",browserBox,8.2f,Palette::secondary(),juce::Justification::centred);

    // OSC PROCESS stays dense and local to the source.
    auto processBox=process.reduced(1,0);
    well(g,processBox);
    auto processInner=processBox.reduced(8);
    auto processTitle=processInner.removeFromTop(18);
    text(g,"OSC PROCESS",processTitle,8.5f,Palette::secondary(),juce::Justification::centredLeft);

    auto modeRow=processInner.removeFromTop(24);
    well(g,modeRow);
    text(g,"BEND +",modeRow.reduced(7,0),8.5f,Palette::text(),juce::Justification::centredLeft);
    text(g,"v",modeRow.reduced(7,0),8.5f,Palette::muted(),juce::Justification::centredRight);

    processInner.removeFromTop(6);
    const int dialRowHeight=processInner.getHeight()/2;
    auto topRow=processInner.removeFromTop(dialRowHeight);
    auto bottomRow=processInner;

    dial(g,topRow.removeFromLeft(topRow.getWidth()/2),"PHASE",.42f);
    dial(g,topRow,"WARP",.58f);
    dial(g,bottomRow.removeFromLeft(bottomRow.getWidth()/2),"ASYM",.35f);
    dial(g,bottomRow,"MIX",.72f);

    // Conventional oscillator pitch identity: OCT / SEM / FIN.
    const juce::StringArray tuneLabels{"OCT","SEM","FIN"};
    const juce::StringArray tuneValues{"0","0","0"};
    const int tuneCellWidth=tuning.getWidth()/3;
    for(int i=0;i<3;++i) {
        auto cell=tuning.withX(tuning.getX()+i*tuneCellWidth).withWidth(tuneCellWidth).reduced(3,0);
        well(g,cell);
        auto labelArea=cell.removeFromTop(11);
        text(g,tuneLabels[i],labelArea,7.6f,Palette::muted(),juce::Justification::centred);
        text(g,tuneValues[i],cell,9.0f,Palette::text(),juce::Justification::centred);
    }

    // Core oscillator controls remain compact and subordinate to the source view.
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
    left_.onClick=[this]{viewport_.setViewPosition(juce::jmax(0,viewport_.getViewPositionX()-cardWidth_-8),0);};
    right_.onClick=[this]{viewport_.setViewPosition(viewport_.getViewPositionX()+cardWidth_+8,0);};
    for(int i=0;i<4;++i) addOscillator();
}
OscillatorRack::~OscillatorRack() {viewport_.setViewedComponent(nullptr,false);}
void OscillatorRack::addOscillator() {
    juce::Component::SafePointer<OscillatorRack> safe(this);
    auto card=std::make_unique<OscillatorCard>(OscillatorDisplay{nextId_++,static_cast<unsigned>(cards_.size()+1),"Wavetable"},[safe](unsigned id){
        // Defer deletion beyond the originating button callback.
        juce::MessageManager::callAsync([safe,id]{if(safe!=nullptr)safe->removeOscillator(id);});
    });
    content_.addAndMakeVisible(*card);cards_.push_back(std::move(card));layoutCards();repaint();
    if(viewport_.getWidth()>0) viewport_.setViewPosition(juce::jmax(0,content_.getWidth()-viewport_.getMaximumVisibleWidth()),0);
}
void OscillatorRack::removeOscillator(unsigned id) {
    const auto previousCount=cards_.size();
    cards_.erase(std::remove_if(cards_.begin(),cards_.end(),[id](const auto& card){return card->id()==id;}),cards_.end());

    if(cards_.size()!=previousCount)
        renumberOscillators();

    layoutCards();
    repaint();
}

void OscillatorRack::renumberOscillators() {
    for(std::size_t index=0;index<cards_.size();++index)
        cards_[index]->setOrdinal(static_cast<unsigned>(index+1));
}
void OscillatorRack::layoutCards() {
    const auto previousX=viewport_.getViewPositionX();
    cardWidth_=336;
    const int height=juce::jmax(0,viewport_.getHeight()-12);
    int x=0;for(auto& card:cards_) {card->setBounds(x,0,cardWidth_,height);x+=cardWidth_+8;}
    addTile_.setBounds(x,0,74,height);content_.setSize(juce::jmax(viewport_.getWidth(),x+74),height);
    viewport_.setViewPosition(juce::jmin(previousX,juce::jmax(0,content_.getWidth()-viewport_.getMaximumVisibleWidth())),0);
}
void OscillatorRack::resized() {
    add_.setBounds(getWidth()-155,5,143,23);
    auto body=contentBounds();left_.setBounds(body.removeFromLeft(25).reduced(0,8));body.removeFromLeft(7);
    right_.setBounds(body.removeFromRight(25).reduced(0,8));body.removeFromRight(7);viewport_.setBounds(body);layoutCards();
}
void OscillatorRack::paintContent(juce::Graphics& g,juce::Rectangle<int>) {
    text(g,juce::String(count())+" MODULES",{140,5,getWidth()-305,24},8.5f,Palette::muted(),juce::Justification::centredRight);
}
}
