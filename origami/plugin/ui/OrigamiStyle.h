// mct-origami-v26.4.0-global-signal-colour-system
// mct-origami-performance-audio-ui-repair-v23.4.4
// mct-origami-knob-mod-macro-cleanup-v22.4
#pragma once
#include <JuceHeader.h>
#include <array>
#include <cmath>
namespace mct::origami::ui {
// mct-origami-visual-foundation-v1
// mct-origami-monochrome-oscillator-v4
// Single global source colour for signal/activity visuals.
//
// This is intentionally the BRIGHTEST source value. Individual graph surfaces
// derive darker/exposure-reduced shades from this rather than hard-coding
// separate reds throughout the UI.
//
// Change this one variable to recolour the complete signal-visual system.
inline juce::Colour gSignalSourceColour = juce::Colour(0xffff0000);

inline juce::Colour signalSourceColour() noexcept {
    return gSignalSourceColour;
}

inline juce::Colour signalShade(float exposure=0.32f,float alpha=1.0f) noexcept {
    return gSignalSourceColour
        .withMultipliedBrightness(juce::jlimit(0.0f,1.0f,exposure))
        .withAlpha(juce::jlimit(0.0f,1.0f,alpha));
}

inline juce::ColourGradient signalGlowGradient(juce::Rectangle<float> bounds,
                                                float alpha=0.18f,
                                                float exposure=0.38f) {
    // The visual "source" is the bottom-centre point. The source colour itself
    // remains full-bright red globally; only its rendered exposure is reduced.
    const auto source=juce::Point<float>(bounds.getCentreX(),bounds.getBottom());
    const auto fade=juce::Point<float>(bounds.getCentreX(),
                                       bounds.getY()+bounds.getHeight()*0.08f);

    juce::ColourGradient gradient(signalShade(exposure,alpha),
                                  source.x,source.y,
                                  signalShade(exposure,0.0f),
                                  fade.x,fade.y,
                                  true);
    gradient.addColour(0.42,signalShade(exposure*0.82f,alpha*0.55f));
    gradient.addColour(0.72,signalShade(exposure*0.60f,alpha*0.18f));
    return gradient;
}

inline void paintSignalGlow(juce::Graphics& g,
                            juce::Rectangle<float> bounds,
                            float alpha=0.18f,
                            float exposure=0.38f,
                            float cornerRadius=2.0f) {
    if(bounds.isEmpty()) return;
    g.setGradientFill(signalGlowGradient(bounds,alpha,exposure));
    g.fillRoundedRectangle(bounds,cornerRadius);
}

struct Palette {
    static juce::Colour background()   { return juce::Colour(0xff090909); }
    static juce::Colour panel()        { return juce::Colour(0xff111111); }
    static juce::Colour raised()       { return juce::Colour(0xff181818); }
    static juce::Colour inset()        { return juce::Colour(0xff070707); }
    static juce::Colour border()       { return juce::Colour(0xff303030); }
    static juce::Colour borderSoft()   { return juce::Colour(0xff232323); }
    static juce::Colour borderStrong() { return juce::Colour(0xff494949); }
    static juce::Colour text()         { return juce::Colour(0xffeeeeee); }
    static juce::Colour secondary()    { return juce::Colour(0xffbdbdbd); }
    static juce::Colour muted()        { return juce::Colour(0xff858585); }
    static juce::Colour accent()       { return juce::Colour(0xffd6d6d6); }
};
inline void text(juce::Graphics& g, const juce::String& value, juce::Rectangle<int> bounds, float size = 11, juce::Colour colour = Palette::text(), juce::Justification alignment = juce::Justification::centredLeft) {
    g.setColour(colour); g.setFont(juce::FontOptions(size)); g.drawText(value, bounds, alignment, true);
}
inline void well(juce::Graphics& g, juce::Rectangle<int> bounds) {
    auto box=bounds.toFloat().reduced(.5f);
    g.setColour(Palette::inset()); g.fillRoundedRectangle(box,2.5f);
    g.setColour(Palette::borderSoft()); g.drawRoundedRectangle(box,2.5f,1.0f);
}
// Shared visual contract: one magnitude arc outside the body, one pointer.
inline void paintKnob(juce::Graphics& g,juce::Rectangle<float> circle,float position,float start,float end) {
    const float diameter=circle.getWidth();
    const auto c=circle.getCentre();
    const float angle=start+juce::jlimit(0.0f,1.0f,position)*(end-start);
    g.setColour(Palette::raised());g.fillEllipse(circle);
    const auto inner=circle.reduced(diameter*.15f);
    g.setColour(Palette::background().withAlpha(.45f));g.fillEllipse(inner);
    g.setColour(Palette::borderSoft().brighter(.08f));g.drawEllipse(inner,.8f);
    juce::Path active;
    active.addCentredArc(c.x,c.y,diameter*.54f,diameter*.54f,0,start,angle,true);
    g.setColour(Palette::accent().withAlpha(.90f));g.strokePath(active,juce::PathStrokeType(2.1f));
    g.setColour(Palette::text().withAlpha(.94f));
    g.drawLine(c.x+std::sin(angle)*diameter*.10f,c.y-std::cos(angle)*diameter*.10f,
               c.x+std::sin(angle)*diameter*.34f,c.y-std::cos(angle)*diameter*.34f,1.7f);
    g.setColour(Palette::borderStrong());g.fillEllipse(juce::Rectangle<float>(2.8f,2.8f).withCentre(c));
}
// mct-origami-control-surface-v2.1
inline void dial(juce::Graphics& g, juce::Rectangle<int> bounds, const juce::String& label, float position = .4f) {
    auto labelBounds=bounds.removeFromBottom(18);
    const float diameter=float(juce::jlimit(20,36,juce::jmin(bounds.getWidth()-8,bounds.getHeight()-4)));
    auto circle=juce::Rectangle<float>(diameter,diameter).withCentre(bounds.toFloat().getCentre());
    constexpr float start=-2.35f, sweep=4.70f;

    paintKnob(g,circle,position,start,start+sweep);
    text(g,label,labelBounds,8.7f,Palette::muted(),juce::Justification::centred);
}
inline void dials(juce::Graphics& g, juce::Rectangle<int> bounds, const juce::StringArray& labels) {
    const int width = bounds.getWidth()/juce::jmax(1,labels.size());
    for(int i=0;i<labels.size();++i) dial(g,bounds.removeFromLeft(width),labels[i],.25f+float(i%4)*.14f);
}
inline void graph(juce::Graphics& g, juce::Rectangle<int> bounds, bool envelope = false) {
    well(g,bounds);
    auto inner=bounds.reduced(10);

    g.setColour(Palette::borderSoft().withAlpha(.72f));
    for(int i=1;i<5;++i) {
        const int x=inner.getX()+inner.getWidth()*i/5;
        g.drawVerticalLine(x,float(inner.getY()),float(inner.getBottom()));
    }

    g.setColour(Palette::borderStrong().withAlpha(.34f));
    g.drawHorizontalLine(inner.getCentreY(),float(inner.getX()),float(inner.getRight()));

    juce::Path path;
    if(envelope) {
        path.startNewSubPath(float(inner.getX()),float(inner.getBottom()-3));
        path.lineTo(float(inner.getX())+inner.getWidth()*.12f,float(inner.getY()+3));
        path.quadraticTo(float(inner.getX())+inner.getWidth()*.22f,float(inner.getCentreY()),
                         float(inner.getX())+inner.getWidth()*.40f,float(inner.getCentreY()));
        path.lineTo(float(inner.getX())+inner.getWidth()*.65f,float(inner.getCentreY()+4));
        path.lineTo(float(inner.getRight()),float(inner.getBottom()-3));
    } else {
        for(int i=0;i<=96;++i) {
            const float x=float(i)/96.f;
            const float y=.5f-.28f*std::sin(x*juce::MathConstants<float>::twoPi*2.f);
            const float px=float(inner.getX())+x*inner.getWidth();
            const float py=float(inner.getY())+y*inner.getHeight();
            if(i==0)path.startNewSubPath(px,py);else path.lineTo(px,py);
        }
    }

    g.setColour(Palette::accent().withAlpha(.92f));
    g.strokePath(path,juce::PathStrokeType(1.45f));
}
class OrigamiLookAndFeel final : public juce::LookAndFeel_V4 {
public:
    OrigamiLookAndFeel();
    void drawButtonBackground(juce::Graphics&,juce::Button&,const juce::Colour&,bool,bool) override;
    void drawButtonText(juce::Graphics&,juce::TextButton&,bool,bool) override;
    // mct-origami-native-knob-waveform-v16
    void drawRotarySlider(juce::Graphics&,int,int,int,int,float,float,float,juce::Slider&) override;
    void drawLinearSlider(juce::Graphics&,int,int,int,int,float,float,float,const juce::Slider::SliderStyle,juce::Slider&) override;
    void drawComboBox(juce::Graphics&,int,int,bool,int,int,int,int,juce::ComboBox&) override;
    void positionComboBoxText(juce::ComboBox&,juce::Label&) override;
    void drawToggleButton(juce::Graphics&,juce::ToggleButton&,bool,bool) override;
    void drawScrollbar(juce::Graphics&,juce::ScrollBar&,int,int,int,int,bool,int,int,bool,bool) override;
};
class Panel : public juce::Component, public juce::SettableTooltipClient {
public:
    explicit Panel(juce::String title): title_(std::move(title)) { setName(title_);setTooltip("Layout preview - controls are not connected to instrument parameters."); }
    void paint(juce::Graphics& g) override {
        auto shell=getLocalBounds().toFloat().reduced(.5f);
        g.setColour(Palette::panel());g.fillRoundedRectangle(shell,3.0f);
        g.setColour(Palette::borderSoft());g.drawRoundedRectangle(shell,3.0f,1.0f);
        g.setColour(Palette::borderSoft().withAlpha(.82f));g.drawHorizontalLine(30,10.0f,float(getWidth()-10));
        text(g,title_,{12,5,getWidth()-24,22},11,Palette::secondary());
        paintContent(g,contentBounds());
    }
    juce::Rectangle<int> contentBounds() const { return getLocalBounds().reduced(10).withTrimmedTop(24); }
protected:
    virtual void paintContent(juce::Graphics&,juce::Rectangle<int>) {}
    juce::String title_;
};
}
