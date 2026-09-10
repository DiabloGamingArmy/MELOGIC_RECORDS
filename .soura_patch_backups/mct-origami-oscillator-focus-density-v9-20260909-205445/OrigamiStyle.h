#pragma once
#include <JuceHeader.h>
#include <array>
#include <cmath>
namespace mct::origami::ui {
// mct-origami-visual-foundation-v1
// mct-origami-monochrome-oscillator-v4
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
    g.setColour(Palette::inset()); g.fillRoundedRectangle(box,4.5f);
    g.setColour(Palette::borderSoft()); g.drawRoundedRectangle(box,4.5f,1.0f);
}
// mct-origami-control-surface-v2.1
inline void dial(juce::Graphics& g, juce::Rectangle<int> bounds, const juce::String& label, float position = .4f) {
    auto labelBounds=bounds.removeFromBottom(18);
    const float diameter=float(juce::jlimit(20,36,juce::jmin(bounds.getWidth()-8,bounds.getHeight()-4)));
    auto circle=juce::Rectangle<float>(diameter,diameter).withCentre(bounds.toFloat().getCentre());
    constexpr float start=-2.35f, sweep=4.70f;
    const float end=start+sweep*juce::jlimit(0.0f,1.0f,position);

    juce::Path track;
    track.addCentredArc(circle.getCentreX(),circle.getCentreY(),diameter*.50f,diameter*.50f,0,start,start+sweep,true);
    g.setColour(Palette::borderSoft().brighter(.18f));
    g.strokePath(track,juce::PathStrokeType(2.2f));

    juce::Path active;
    active.addCentredArc(circle.getCentreX(),circle.getCentreY(),diameter*.50f,diameter*.50f,0,start,end,true);
    g.setColour(Palette::accent().withAlpha(.92f));
    g.strokePath(active,juce::PathStrokeType(2.2f));

    g.setColour(Palette::raised());g.fillEllipse(circle);
    g.setColour(Palette::borderStrong());g.drawEllipse(circle,1.0f);
    auto inner=circle.reduced(diameter*.15f);
    g.setColour(Palette::background().withAlpha(.42f));g.fillEllipse(inner);
    g.setColour(Palette::borderSoft().brighter(.08f));g.drawEllipse(inner,.8f);

    const auto centre=circle.getCentre();
    g.setColour(Palette::text().withAlpha(.92f));
    g.drawLine(centre.x+std::sin(end)*diameter*.10f,centre.y-std::cos(end)*diameter*.10f,
               centre.x+std::sin(end)*diameter*.34f,centre.y-std::cos(end)*diameter*.34f,1.7f);

    g.setColour(Palette::borderStrong());
    g.fillEllipse(juce::Rectangle<float>(2.8f,2.8f).withCentre(centre));
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
    void drawScrollbar(juce::Graphics&,juce::ScrollBar&,int,int,int,int,bool,int,int,bool,bool) override;
};
class Panel : public juce::Component, public juce::SettableTooltipClient {
public:
    explicit Panel(juce::String title): title_(std::move(title)) { setName(title_);setTooltip("Layout preview - controls are not connected to instrument parameters."); }
    void paint(juce::Graphics& g) override {
        auto shell=getLocalBounds().toFloat().reduced(.5f);
        g.setColour(Palette::panel());g.fillRoundedRectangle(shell,6.0f);
        g.setColour(Palette::borderSoft());g.drawRoundedRectangle(shell,6.0f,1.0f);
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
