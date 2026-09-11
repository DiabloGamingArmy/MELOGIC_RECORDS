// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v29.2.0-randsparse-reseed-routefix
// mct-origami-v29.1.0-rand-amp-variants-ui-polish
// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-v26.4.0-global-signal-colour-system
// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-modulation-completion-v24.0.1
// mct-origami-performance-audio-ui-repair-v23.4.4
// mct-origami-osc-interaction-rotary-cleanup-v22.5
// mct-origami-knob-mod-macro-cleanup-v22.4
#include "OrigamiStyle.h"
#include "NativeChoiceMenu.h"
namespace mct::origami::ui {

void NativeComboBox::addNativeItem(const juce::String& group,const juce::String& label,int id) {
    addItem(label,id);
    nativeGroups_.push_back({id,group});
}

void NativeComboBox::mouseDown(const juce::MouseEvent&) {
    std::vector<NativeChoiceItem> items;
    items.reserve(static_cast<std::size_t>(getNumItems()));
    for(int i=0;i<getNumItems();++i) {
        const int id=getItemId(i);
        juce::String group;
        for(const auto& entry:nativeGroups_)
            if(entry.first==id) {group=entry.second;break;}
        items.push_back({id,getItemText(i),true,group});
    }
    showNativeChoiceMenu(*this,getName().isNotEmpty()?getName():juce::String("Select"),
                         items,getSelectedId(),
        [safe=juce::Component::SafePointer<NativeComboBox>(this)](int id) {
            if(safe!=nullptr && id>0) safe->setSelectedId(id,juce::sendNotificationSync);
        });
}

OrigamiLookAndFeel::OrigamiLookAndFeel() {
    setColour(juce::TextButton::buttonColourId,Palette::inset());setColour(juce::TextButton::textColourOffId,Palette::text());
    setColour(juce::ScrollBar::thumbColourId,Palette::muted());setColour(juce::ScrollBar::backgroundColourId,Palette::inset());
}
void OrigamiLookAndFeel::drawButtonBackground(juce::Graphics& g,juce::Button& button,const juce::Colour&,bool over,bool down) {
    const auto bounds=button.getLocalBounds().toFloat().reduced(.5f);
    const bool active=button.getToggleState();
    const bool oscillatorPower=button.getName().startsWithIgnoreCase("Power OSC");
    auto fill=active?Palette::raised():Palette::inset();
    if(over) fill=fill.brighter(.08f);
    if(down) fill=fill.brighter(.13f);
    g.setColour(fill);g.fillRoundedRectangle(bounds,4.5f);
    g.setColour(active && oscillatorPower ? signalSourceColour()
                                          : (active?Palette::borderStrong():Palette::borderSoft()));
    g.drawRoundedRectangle(bounds,4.5f,active && oscillatorPower ? 1.35f : 1.0f);
    if(active) {
        g.setColour(oscillatorPower ? signalSourceColour() : Palette::accent().withAlpha(.95f));
        g.fillRoundedRectangle(bounds.getX()+9.0f,bounds.getBottom()-2.2f,
                               bounds.getWidth()-18.0f,1.55f,0.7f);
    }
}
void OrigamiLookAndFeel::drawButtonText(juce::Graphics& g,juce::TextButton& button,bool,bool) {
    auto bounds=button.getLocalBounds().reduced(3);

    // Custom dice icon for seeded spectral re-randomization. Drawing it
    // geometrically avoids Unicode/font fallback issues.
    if(button.getName()=="OSC PROCESS RESEED") {
        const auto colour=button.isEnabled()?Palette::text():Palette::muted();
        auto die=button.getLocalBounds().toFloat()
                    .withSizeKeepingCentre(11.0f,11.0f);

        g.setColour(colour.withAlpha(button.isEnabled()?0.92f:0.48f));
        g.drawRoundedRectangle(die,2.0f,1.1f);

        const float pip=1.65f;
        const auto drawPip=[&](float x,float y) {
            g.fillEllipse(juce::Rectangle<float>(pip,pip).withCentre({x,y}));
        };

        drawPip(die.getX()+3.0f,die.getY()+3.0f);
        drawPip(die.getCentreX(),die.getCentreY());
        drawPip(die.getRight()-3.0f,die.getBottom()-3.0f);
        return;
    }

    // OSC PROCESS uses overlaid left/right navigation end-caps. Keep the
    // selector itself full-width for maximum label space, but reserve exactly
    // the arrow footprints so text can never disappear underneath them.
    if(button.getName()=="OSC PROCESS SELECTOR")
        bounds=button.getLocalBounds().withTrimmedLeft(21).withTrimmedRight(21).reduced(2,3);

    text(g,button.getButtonText(),bounds,11,
         button.isEnabled()?Palette::text():Palette::muted(),
         juce::Justification::centred);
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
    if(slider.getName()=="ENV GRID BPM") return;
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
    const bool active=button.getToggleState();
    const bool oscillatorPower=button.getName().startsWithIgnoreCase("Power OSC");

    auto fill=active?Palette::raised():Palette::inset();
    if(over) fill=fill.brighter(.07f);
    if(down) fill=fill.brighter(.10f);

    g.setColour(fill);
    g.fillRoundedRectangle(b,3.0f);

    // Oscillator power is the primary signal-source activity indicator.
    // Keep every other toggle monochrome, but drive this outline from the
    // shared full-bright global signal colour.
    const auto outline=active
        ? (oscillatorPower ? signalSourceColour() : Palette::borderStrong())
        : Palette::borderSoft();

    g.setColour(outline);
    g.drawRoundedRectangle(b,3.0f,oscillatorPower && active ? 1.25f : 1.0f);

    if(active) {
        // Existing bottom "pill" indicator becomes full-bright source red for
        // oscillator power; non-power toggles retain the monochrome contract.
        g.setColour(oscillatorPower ? signalSourceColour() : Palette::accent());
        g.fillRoundedRectangle(b.getX()+5.0f,b.getBottom()-2.1f,
                               b.getWidth()-10.0f,1.35f,0.65f);
    }

    text(g,button.getButtonText(),button.getLocalBounds().reduced(3),8.0f,
         active?Palette::text():Palette::muted(),juce::Justification::centred);
}

void OrigamiLookAndFeel::drawScrollbar(juce::Graphics& g,juce::ScrollBar&,int x,int y,int width,int height,bool vertical,int start,int size,bool over,bool) {
    g.setColour(Palette::background().withAlpha(.72f));g.fillRect(x,y,width,height);
    g.setColour(over?Palette::accent().withAlpha(.85f):Palette::borderStrong().withAlpha(.72f));
    if(vertical)g.fillRoundedRectangle(float(x+3),float(start),float(width-6),float(size),3);
    else g.fillRoundedRectangle(float(start),float(y+3),float(size),float(height-6),3);
}
}
