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
    // mct-origami-square-oscillator-preview-v7
    text(g,display_.source.toUpperCase(),{87,5,getWidth()-128,25},8.5f,Palette::muted(),juce::Justification::centred);

    auto working=body;
    working.removeFromTop(3);

    const int controlWidth=juce::jlimit(92,122,working.getWidth()*38/100);
    auto controlBank=working.removeFromRight(controlWidth);
    working.removeFromRight(8);

    const int captionHeight=18;
    const int availableSquare=juce::jmin(working.getWidth(),working.getHeight()-captionHeight);
    const int squareSize=juce::jmax(72,availableSquare);

    auto previewColumn=juce::Rectangle<int>(
        working.getX(),
        working.getCentreY()-(squareSize+captionHeight)/2,
        squareSize,
        squareSize+captionHeight
    );

    auto preview=previewColumn.removeFromTop(squareSize);
    auto caption=previewColumn;

    graph(g,preview);
    text(g,"INIT  /  "+display_.source.toUpperCase(),caption,7.8f,Palette::muted(),juce::Justification::centred);

    controlBank=controlBank.reduced(0,2);
    const juce::StringArray labels{"WT POS","UNISON","DETUNE","BLEND","PAN","LEVEL"};
    const int rowHeight=controlBank.getHeight()/3;
    int labelIndex=0;
    for(int row=0;row<3;++row) {
        auto rowBounds=controlBank.withY(controlBank.getY()+row*rowHeight).withHeight(rowHeight);
        const int cellWidth=rowBounds.getWidth()/2;
        for(int col=0;col<2 && labelIndex<labels.size();++col) {
            auto cell=rowBounds.withX(rowBounds.getX()+col*cellWidth).withWidth(cellWidth);
            dial(g,cell,labels[labelIndex],.25f+float(labelIndex%4)*.14f);
            ++labelIndex;
        }
    }
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
    cardWidth_=juce::jlimit(286,336,(viewport_.getWidth()-84-40)/4);
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
    text(g,juce::String(count())+" MODULES",{140,5,getWidth()-305,24},8.5f,Palette::muted(),juce::Justification::centredRight);
}
}
