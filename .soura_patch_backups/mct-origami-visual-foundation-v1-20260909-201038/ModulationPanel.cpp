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
    // mct-origami-modulation-geometry-v1
    // ENV and LFO are equal peer workspaces. Keep their graph rectangles aligned;
    // LFO options live in its footer instead of consuming graph height.
    const int available=body.getWidth()-16;
    const int routingWidth=juce::jmax(220,juce::roundToInt(available*.30));
    const int workspaceWidth=juce::jmax(0,(available-routingWidth)/2);

    auto main=body.removeFromLeft(workspaceWidth);body.removeFromLeft(8);
    auto lfo=body.removeFromLeft(workspaceWidth);body.removeFromLeft(8);
    auto routing=body;

    const int captionHeight=17;
    const int footerHeight=juce::jmin(83,juce::jmax(58,main.getHeight()/3+8));

    auto mainFooter=main.removeFromBottom(footerHeight);
    main.removeFromBottom(6);
    auto mainCaption=main.removeFromTop(captionHeight);
    text(g,tabs_[static_cast<std::size_t>(selected_)].getButtonText()+" / DISPLAY",mainCaption,9,Palette::muted());
    graph(g,main,selected_<3);
    dials(g,mainFooter,selected_<3?juce::StringArray{"ATTACK","DECAY","SUSTAIN","RELEASE"}:juce::StringArray{"RATE","SHAPE","PHASE","SMOOTH"});

    auto lfoFooter=lfo.removeFromBottom(footerHeight);
    lfo.removeFromBottom(6);
    auto lfoCaption=lfo.removeFromTop(captionHeight);
    text(g,"LFO / DISPLAY",lfoCaption,9,Palette::muted());
    graph(g,lfo);

    auto lfoOptions=lfoFooter.removeFromTop(25);
    text(g,"Sine      BPM      1/4      Off",lfoOptions,10,Palette::muted(),juce::Justification::centred);
    dials(g,lfoFooter,{"RATE","SHAPE","PHASE","SMOOTH"});
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
