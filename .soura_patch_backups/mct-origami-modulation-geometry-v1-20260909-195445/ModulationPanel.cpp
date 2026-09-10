#include "ModulationPanel.h"
namespace mct::origami::ui {
ModulationPanel::ModulationPanel():Panel("MODULATION") {
    const juce::StringArray labels{"ENV 1","ENV 2","ENV 3","LFO 1","LFO 2","LFO 3","LFO 4","FUNCTIONS","RANDOM"};
    for(int i=0;i<9;++i) {
        auto& tab=tabs_[static_cast<std::size_t>(i)];tab.setButtonText(labels[i]);tab.setTooltip("Select a modulation layout preview; modulation DSP is not connected.");addAndMakeVisible(tab);
        tab.setToggleState(i==0,juce::dontSendNotification);
        tab.onClick=[this,i]{selected_=i;for(int index=0;index<9;++index)tabs_[static_cast<std::size_t>(index)].setToggleState(index==i,juce::dontSendNotification);repaint();};
    }
}
void ModulationPanel::resized() {
    auto bar=getLocalBounds().withTrimmedLeft(120).withTrimmedRight(10).removeFromTop(29).reduced(0,4);
    const int width=bar.getWidth()/9;for(auto& tab:tabs_)tab.setBounds(bar.removeFromLeft(width).reduced(1,0));
}
void ModulationPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    const int available=body.getWidth()-16;
    auto main=body.removeFromLeft(juce::roundToInt(available*.36));body.removeFromLeft(8);
    auto lfo=body.removeFromLeft(juce::roundToInt(available*.32));body.removeFromLeft(8);auto routing=body;
    auto controls=main.removeFromBottom(juce::jmin(58,main.getHeight()/3+8));main.removeFromBottom(6);
    auto graphCaption=main.removeFromTop(17);text(g,tabs_[static_cast<std::size_t>(selected_)].getButtonText()+" / DISPLAY",graphCaption,9,Palette::muted());
    graph(g,main,selected_<3);
    dials(g,controls,selected_<3?juce::StringArray{"ATTACK","DECAY","SUSTAIN","RELEASE"}:juce::StringArray{"RATE","SHAPE","PHASE","SMOOTH"});
    auto lfoControls=lfo.removeFromBottom(juce::jmin(58,lfo.getHeight()/3+8));auto lfoOptions=lfo.removeFromBottom(25);lfo.removeFromBottom(5);
    auto lfoCaption=lfo.removeFromTop(17);text(g,"LFO / DISPLAY",lfoCaption,9,Palette::muted());graph(g,lfo);
    text(g,"Sine      BPM      1/4      Off",lfoOptions,10,Palette::muted(),juce::Justification::centred);
    dials(g,lfoControls,{"RATE","SHAPE","PHASE","SMOOTH"});
    auto routingHeader=routing.removeFromTop(24);well(g,routingHeader);
    text(g,"SOURCE     AMOUNT     DESTINATION",routingHeader.reduced(7,0),9,Palette::muted());
    const int rowHeight=juce::jmin(32,routing.getHeight()/5);
    for(int i=0;i<5;++i) {
        auto row=routing.removeFromTop(rowHeight).reduced(0,1);g.setColour(Palette::border().withAlpha(.55f));g.drawHorizontalLine(row.getBottom(),float(row.getX()),float(row.getRight()));
        text(g,"—",row.removeFromLeft(row.getWidth()/4).reduced(8,0),11,Palette::muted());
        auto amount=row.removeFromLeft(row.getWidth()/3).reduced(7,0);g.setColour(Palette::border());g.fillRect(amount.getX(),amount.getCentreY(),amount.getWidth(),2);
        text(g,"Unassigned",row.reduced(8,0),10,Palette::muted());
    }
}
void MacroPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    const int width=body.getWidth()/2,height=body.getHeight()/2;
    for(int i=0;i<4;++i) {auto cell=juce::Rectangle<int>(body.getX()+(i%2)*width,body.getY()+(i/2)*height,width,height).reduced(5);dial(g,cell,"MACRO "+juce::String(i+1),.1f);}
}
}
