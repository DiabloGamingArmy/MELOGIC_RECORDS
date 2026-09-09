#include "PerformanceKeyboard.h"
namespace mct::origami::ui {
void PerformanceKeyboard::paint(juce::Graphics& g) {
    auto area=getLocalBounds().reduced(3,1);
    auto brand=area.removeFromRight(104);text(g,"MCT ORIGAMI",brand.removeFromTop(35),11,Palette::text(),juce::Justification::centred);text(g,"UI PREVIEW",brand.removeFromTop(19),9,Palette::muted(),juce::Justification::centred);text(g,"MIDI VIA HOST",brand,8,Palette::muted(),juce::Justification::centred);
    auto wheels=area.removeFromLeft(122);
    for(const auto& label:juce::StringArray{"PITCH","MOD"}) {
        auto wheel=wheels.removeFromLeft(56).reduced(8,5);auto caption=wheel.removeFromBottom(18);well(g,wheel);auto track=wheel.reduced(9,5);
        g.setColour(Palette::border());g.fillRoundedRectangle(track.toFloat(),3);
        g.setColour(Palette::muted());for(int i=-2;i<=2;++i)g.drawHorizontalLine(track.getCentreY()+i*3,float(track.getX()+2),float(track.getRight()-2));
        text(g,label,caption,9,Palette::muted(),juce::Justification::centred);
    }
    well(g,area);auto keys=area.reduced(6,6);constexpr int whites=28;const float width=float(keys.getWidth())/whites;
    for(int i=0;i<whites;++i) {
        juce::Rectangle<float> key(float(keys.getX())+float(i)*width,float(keys.getY()),width-1,float(keys.getHeight()));
        g.setColour(juce::Colour(0xffcdd5d9));g.fillRoundedRectangle(key,2);g.setColour(juce::Colour(0xff8b969e));g.drawRoundedRectangle(key,.8f,.7f);
        if(i%7==0)text(g,"C"+juce::String(3+i/7),key.toNearestInt().removeFromBottom(16),8,juce::Colour(0xff596770),juce::Justification::centred);
    }
    for(int i=0;i<whites-1;++i) if(i%7!=2 && i%7!=6) {
        const auto key=juce::Rectangle<float>(float(keys.getX())+(float(i)+1)*width-width*.31f,float(keys.getY()),width*.62f,float(keys.getHeight())*.62f);
        g.setColour(juce::Colour(0xff0c1115));g.fillRoundedRectangle(key,2);g.setColour(Palette::border());g.drawRoundedRectangle(key.reduced(.5f),2,1);
    }
}
}
