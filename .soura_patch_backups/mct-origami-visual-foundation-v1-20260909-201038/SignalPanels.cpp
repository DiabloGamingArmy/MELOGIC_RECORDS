#include "SignalPanels.h"
namespace mct::origami::ui {
void MixerPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    const juce::StringArray channels{"OSC 1","OSC 2","OSC 3","OSC 4","SUB","NOISE"};
    const int width=body.getWidth()/6;
    for(int i=0;i<6;++i) {
        auto strip=body.removeFromLeft(width).reduced(3,1);auto muteSolo=strip.removeFromBottom(19);auto caption=strip.removeFromBottom(21);
        auto track=strip.withSizeKeepingCentre(8,juce::jmax(12,strip.getHeight()-5));well(g,track);
        const float height=static_cast<float>(track.getHeight());const int position=track.getY()+juce::roundToInt(height*(.31f+float(i%4)*.075f));
        g.setColour(Palette::muted());g.fillRect(track.getCentreX()-8,position,16,3);g.setColour(Palette::accent());g.fillRect(track.getCentreX()-6,position,12,1);
        text(g,channels[i],caption,9,Palette::muted(),juce::Justification::centred);
        well(g,muteSolo.reduced(1,0));text(g,"M   S",muteSolo,9,Palette::muted(),juce::Justification::centred);
    }
}
void FilterPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    text(g,"LOW-PASS",{90,5,100,24},10,Palette::muted());
    text(g,"ROUTING",{getWidth()-106,5,90,24},9,Palette::muted(),juce::Justification::centredRight);
    auto controls=body.removeFromBottom(juce::jmin(57,body.getHeight()/3+10));body.removeFromBottom(7);
    auto routing=body.removeFromRight(82);body.removeFromRight(8);
    well(g,body);auto graphArea=body.reduced(8);
    g.setColour(Palette::border().withAlpha(.7f));for(int i=1;i<5;++i)g.drawVerticalLine(graphArea.getX()+graphArea.getWidth()*i/5,float(graphArea.getY()),float(graphArea.getBottom()));
    juce::Path response;response.startNewSubPath(float(graphArea.getX()),float(graphArea.getCentreY()));
    response.lineTo(float(graphArea.getX())+graphArea.getWidth()*.49f,float(graphArea.getCentreY()));
    response.cubicTo(float(graphArea.getX())+graphArea.getWidth()*.65f,float(graphArea.getY()),float(graphArea.getX())+graphArea.getWidth()*.72f,float(graphArea.getBottom()),float(graphArea.getRight()),float(graphArea.getBottom()-2));
    g.setColour(Palette::accent());g.strokePath(response,juce::PathStrokeType(1.3f));
    const int rowHeight=juce::jmin(24,routing.getHeight()/3);
    for(const auto& label:juce::StringArray{"Serial","Parallel","Split"}) {auto row=routing.removeFromTop(rowHeight).reduced(1,1);well(g,row);text(g,label,row,10,label=="Serial"?Palette::text():Palette::muted(),juce::Justification::centred);}
    dials(g,controls,{"CUTOFF","RESONANCE","DRIVE","KEYTRACK","ENV AMT","MIX"});
}
void FxPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    if(pre_) {
        const int height=body.getHeight()/3;
        for(const auto& label:juce::StringArray{"DIST","COMP","SAT"}) {auto slot=body.removeFromTop(height).reduced(0,3);well(g,slot);text(g,label,slot,10,Palette::muted(),juce::Justification::centred);}
    } else {
        const int width=body.getWidth()/4;
        for(const auto& label:juce::StringArray{"CHORUS","DELAY","REVERB","+"}) {
            auto slot=body.removeFromLeft(width).reduced(2,3);well(g,slot);
            text(g,label=="+"?"+":"—",slot.withTrimmedBottom(slot.getHeight()/3),22,Palette::muted(),juce::Justification::centred);
            if(label!="+")text(g,label,slot.removeFromBottom(33),8,Palette::muted(),juce::Justification::centred);
        }
    }
}
}
