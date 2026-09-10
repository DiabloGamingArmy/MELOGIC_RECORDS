#include "OrigamiStyle.h"
namespace mct::origami::ui {
OrigamiLookAndFeel::OrigamiLookAndFeel() {
    setColour(juce::TextButton::buttonColourId,Palette::inset());setColour(juce::TextButton::textColourOffId,Palette::text());
    setColour(juce::ScrollBar::thumbColourId,Palette::muted());setColour(juce::ScrollBar::backgroundColourId,Palette::inset());
}
void OrigamiLookAndFeel::drawButtonBackground(juce::Graphics& g,juce::Button& button,const juce::Colour&,bool over,bool down) {
    const auto bounds=button.getLocalBounds().toFloat().reduced(.5f);
    const bool active=button.getToggleState();
    auto fill=active?Palette::raised():Palette::inset();
    if(over) fill=fill.brighter(.08f);
    if(down) fill=fill.brighter(.13f);
    g.setColour(fill);g.fillRoundedRectangle(bounds,4.5f);
    g.setColour(active?Palette::borderStrong():Palette::borderSoft());g.drawRoundedRectangle(bounds,4.5f,1.0f);
    if(active) {g.setColour(Palette::accent().withAlpha(.95f));g.fillRect(bounds.getX()+9,bounds.getBottom()-2.0f,bounds.getWidth()-18,1.5f);}
}
void OrigamiLookAndFeel::drawButtonText(juce::Graphics& g,juce::TextButton& button,bool,bool) {
    text(g,button.getButtonText(),button.getLocalBounds().reduced(3),11,button.isEnabled()?Palette::text():Palette::muted(),juce::Justification::centred);
}
void OrigamiLookAndFeel::drawScrollbar(juce::Graphics& g,juce::ScrollBar&,int x,int y,int width,int height,bool vertical,int start,int size,bool over,bool) {
    g.setColour(Palette::background().withAlpha(.72f));g.fillRect(x,y,width,height);
    g.setColour(over?Palette::accent().withAlpha(.85f):Palette::borderStrong().withAlpha(.72f));
    if(vertical)g.fillRoundedRectangle(float(x+3),float(start),float(width-6),float(size),3);
    else g.fillRoundedRectangle(float(start),float(y+3),float(size),float(height-6),3);
}
}
