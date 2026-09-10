#include "OrigamiStyle.h"
namespace mct::origami::ui {
OrigamiLookAndFeel::OrigamiLookAndFeel() {
    setColour(juce::TextButton::buttonColourId,Palette::inset());setColour(juce::TextButton::textColourOffId,Palette::text());
    setColour(juce::ScrollBar::thumbColourId,Palette::muted());setColour(juce::ScrollBar::backgroundColourId,Palette::inset());
}
void OrigamiLookAndFeel::drawButtonBackground(juce::Graphics& g,juce::Button& button,const juce::Colour&,bool over,bool down) {
    const auto bounds=button.getLocalBounds().toFloat().reduced(.5f);
    g.setColour(button.getToggleState()?juce::Colour(0xff24333d):Palette::inset().brighter(over?.15f:0.f));
    g.fillRoundedRectangle(bounds,4);g.setColour(down?Palette::accent():Palette::border());g.drawRoundedRectangle(bounds,4,1);
    if(button.getToggleState()) {g.setColour(Palette::accent());g.fillRect(bounds.getX()+8,bounds.getBottom()-2,bounds.getWidth()-16,1.f);}
}
void OrigamiLookAndFeel::drawButtonText(juce::Graphics& g,juce::TextButton& button,bool,bool) {
    text(g,button.getButtonText(),button.getLocalBounds().reduced(3),11,button.isEnabled()?Palette::text():Palette::muted(),juce::Justification::centred);
}
void OrigamiLookAndFeel::drawScrollbar(juce::Graphics& g,juce::ScrollBar&,int x,int y,int width,int height,bool vertical,int start,int size,bool over,bool) {
    g.setColour(Palette::inset());g.fillRect(x,y,width,height);
    g.setColour(over?Palette::accent():Palette::border().brighter(.4f));
    if(vertical)g.fillRoundedRectangle(float(x+3),float(start),float(width-6),float(size),3);
    else g.fillRoundedRectangle(float(start),float(y+3),float(size),float(height-6),3);
}
}
