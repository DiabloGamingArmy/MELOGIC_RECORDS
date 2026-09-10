// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-modulation-completion-v24.0.1
// mct-origami-performance-audio-ui-repair-v23.4.4
// mct-origami-osc-interaction-rotary-cleanup-v22.5
// mct-origami-knob-mod-macro-cleanup-v22.4
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

// mct-origami-native-knob-waveform-v16
void OrigamiLookAndFeel::drawRotarySlider(juce::Graphics& g,int x,int y,int width,int height,
                                          float sliderPos,float rotaryStartAngle,float rotaryEndAngle,
                                          juce::Slider& slider) {
    auto bounds=juce::Rectangle<float>(float(x),float(y),float(width),float(height)).reduced(3.0f);
    const float diameter=juce::jmin(bounds.getWidth(),bounds.getHeight());
    auto circle=juce::Rectangle<float>(diameter,diameter).withCentre(bounds.getCentre());

    if(slider.getName()=="OSC PROCESS BIPOLAR") {
        // Bipolar process amounts use the physical top of the knob as 0.
        // The magnitude arc grows away from that neutral point in either direction.
        const auto c=circle.getCentre();
        const float angle=rotaryStartAngle+juce::jlimit(0.0f,1.0f,sliderPos)
                                             *(rotaryEndAngle-rotaryStartAngle);
        const float neutral=(rotaryStartAngle+rotaryEndAngle)*0.5f;

        g.setColour(Palette::raised());
        g.fillEllipse(circle);
        const auto inner=circle.reduced(diameter*.15f);
        g.setColour(Palette::background().withAlpha(.45f));
        g.fillEllipse(inner);
        g.setColour(Palette::borderSoft().brighter(.08f));
        g.drawEllipse(inner,.8f);

        juce::Path active;
        if(angle<neutral)
            active.addCentredArc(c.x,c.y,diameter*.54f,diameter*.54f,0,angle,neutral,true);
        else
            active.addCentredArc(c.x,c.y,diameter*.54f,diameter*.54f,0,neutral,angle,true);
        g.setColour(Palette::accent().withAlpha(.90f));
        g.strokePath(active,juce::PathStrokeType(2.1f));

        // Neutral tick: exact 0 reference at 12 o'clock.
        g.setColour(Palette::secondary().withAlpha(.72f));
        g.drawLine(c.x,c.y-diameter*.47f,c.x,c.y-diameter*.39f,1.2f);

        g.setColour(Palette::text().withAlpha(.94f));
        g.drawLine(c.x+std::sin(angle)*diameter*.10f,c.y-std::cos(angle)*diameter*.10f,
                   c.x+std::sin(angle)*diameter*.34f,c.y-std::cos(angle)*diameter*.34f,1.7f);
        g.setColour(Palette::borderStrong());
        g.fillEllipse(juce::Rectangle<float>(2.8f,2.8f).withCentre(c));
        return;
    }

    paintKnob(g,circle,sliderPos,rotaryStartAngle,rotaryEndAngle);
}

void OrigamiLookAndFeel::drawLinearSlider(juce::Graphics& g,int x,int y,int width,int height,
    float sliderPos,float minSliderPos,float maxSliderPos,const juce::Slider::SliderStyle style,juce::Slider& slider) {
    auto b=juce::Rectangle<float>(float(x),float(y),float(width),float(height)).reduced(.5f);
    g.setColour(Palette::inset());g.fillRoundedRectangle(b,2.5f);
    g.setColour(Palette::borderSoft());g.drawRoundedRectangle(b,2.5f,1.0f);
    if(slider.getName().startsWith("OSC TUNING")) return;
    if(style==juce::Slider::LinearBarVertical || style==juce::Slider::LinearVertical) {
        const float lo=juce::jmin(minSliderPos,maxSliderPos),hi=juce::jmax(minSliderPos,maxSliderPos);
        const float p=juce::jlimit(lo,hi,sliderPos);
        g.setColour(Palette::borderStrong().withAlpha(.55f));
        g.drawVerticalLine(juce::roundToInt(b.getCentreX()),b.getY()+4.0f,b.getBottom()-4.0f);
        g.setColour(Palette::accent().withAlpha(.86f));
        g.fillRoundedRectangle(b.getX()+3.0f,p-1.0f,b.getWidth()-6.0f,2.0f,1.0f);
    } else {
        g.setColour(Palette::accent().withAlpha(.86f));
        g.fillRoundedRectangle(sliderPos-1.0f,b.getY()+3.0f,2.0f,b.getHeight()-6.0f,1.0f);
    }
}
void OrigamiLookAndFeel::drawComboBox(juce::Graphics& g,int width,int height,bool,int,int,int,int,juce::ComboBox&) {
    auto b=juce::Rectangle<float>(0,0,float(width),float(height)).reduced(.5f);
    g.setColour(Palette::inset());g.fillRoundedRectangle(b,3.0f);
    g.setColour(Palette::borderSoft());g.drawRoundedRectangle(b,3.0f,1.0f);
    juce::Path chevron;const float cx=float(width)-10.0f,cy=float(height)*.5f;
    chevron.startNewSubPath(cx-3.0f,cy-1.5f);chevron.lineTo(cx,cy+1.5f);chevron.lineTo(cx+3.0f,cy-1.5f);
    g.setColour(Palette::secondary());g.strokePath(chevron,juce::PathStrokeType(1.15f));
}
void OrigamiLookAndFeel::positionComboBoxText(juce::ComboBox& box,juce::Label& label) {
    label.setBounds(7,1,juce::jmax(0,box.getWidth()-22),juce::jmax(0,box.getHeight()-2));
    label.setFont(juce::FontOptions(8.0f));label.setJustificationType(juce::Justification::centredLeft);
    label.setColour(juce::Label::textColourId,Palette::text());
}
void OrigamiLookAndFeel::drawToggleButton(juce::Graphics& g,juce::ToggleButton& button,bool over,bool down) {
    auto b=button.getLocalBounds().toFloat().reduced(.5f);
    auto fill=button.getToggleState()?Palette::raised():Palette::inset();
    if(over) fill=fill.brighter(.07f);if(down) fill=fill.brighter(.10f);
    g.setColour(fill);g.fillRoundedRectangle(b,3.0f);
    g.setColour(button.getToggleState()?Palette::borderStrong():Palette::borderSoft());g.drawRoundedRectangle(b,3.0f,1.0f);
    if(button.getToggleState()) {g.setColour(Palette::accent());g.fillRect(b.getX()+5,b.getBottom()-2,b.getWidth()-10,1.2f);}
    text(g,button.getButtonText(),button.getLocalBounds().reduced(3),8.0f,
         button.getToggleState()?Palette::text():Palette::muted(),juce::Justification::centred);
}

void OrigamiLookAndFeel::drawScrollbar(juce::Graphics& g,juce::ScrollBar&,int x,int y,int width,int height,bool vertical,int start,int size,bool over,bool) {
    g.setColour(Palette::background().withAlpha(.72f));g.fillRect(x,y,width,height);
    g.setColour(over?Palette::accent().withAlpha(.85f):Palette::borderStrong().withAlpha(.72f));
    if(vertical)g.fillRoundedRectangle(float(x+3),float(start),float(width-6),float(size),3);
    else g.fillRoundedRectangle(float(start),float(y+3),float(size),float(height-6),3);
}
}
