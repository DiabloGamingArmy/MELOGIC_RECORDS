#pragma once
#include <JuceHeader.h>
#include <array>
#include <cmath>
namespace mct::origami::ui {
struct Palette {
    static juce::Colour background() { return juce::Colour(0xff090d10); }
    static juce::Colour panel() { return juce::Colour(0xff10171b); }
    static juce::Colour inset() { return juce::Colour(0xff080e12); }
    static juce::Colour border() { return juce::Colour(0xff2b383f); }
    static juce::Colour text() { return juce::Colour(0xffe1e8ec); }
    static juce::Colour muted() { return juce::Colour(0xff86969f); }
    static juce::Colour accent() { return juce::Colour(0xffa2c8db); }
};
inline void text(juce::Graphics& g, const juce::String& value, juce::Rectangle<int> bounds, float size = 11, juce::Colour colour = Palette::text(), juce::Justification alignment = juce::Justification::centredLeft) {
    g.setColour(colour); g.setFont(juce::FontOptions(size)); g.drawText(value, bounds, alignment, true);
}
inline void well(juce::Graphics& g, juce::Rectangle<int> bounds) {
    g.setColour(Palette::inset()); g.fillRoundedRectangle(bounds.toFloat(),4);
    g.setColour(Palette::border()); g.drawRoundedRectangle(bounds.toFloat().reduced(.5f),4,1);
}
inline void dial(juce::Graphics& g, juce::Rectangle<int> bounds, const juce::String& label, float position = .4f) {
    auto labelBounds = bounds.removeFromBottom(17);
    const float diameter = float(juce::jlimit(18,34,juce::jmin(bounds.getWidth()-8,bounds.getHeight()-3)));
    auto circle = juce::Rectangle<float>(diameter,diameter).withCentre(bounds.toFloat().getCentre());
    g.setColour(Palette::inset());g.fillEllipse(circle);
    g.setColour(Palette::border().brighter(.2f));g.drawEllipse(circle,1.5f);
    juce::Path arc;const float start=-2.35f,end=start+4.7f*position;
    arc.addCentredArc(circle.getCentreX(),circle.getCentreY(),diameter*.43f,diameter*.43f,0,start,end,true);
    g.setColour(Palette::accent().withAlpha(.7f));g.strokePath(arc,juce::PathStrokeType(1.4f));
    const auto centre=circle.getCentre();
    g.drawLine(centre.x+std::sin(end)*diameter*.22f,centre.y-std::cos(end)*diameter*.22f,centre.x+std::sin(end)*diameter*.34f,centre.y-std::cos(end)*diameter*.34f,1.5f);
    text(g,label,labelBounds,9,Palette::muted(),juce::Justification::centred);
}
inline void dials(juce::Graphics& g, juce::Rectangle<int> bounds, const juce::StringArray& labels) {
    const int width = bounds.getWidth()/juce::jmax(1,labels.size());
    for(int i=0;i<labels.size();++i) dial(g,bounds.removeFromLeft(width),labels[i],.25f+float(i%4)*.14f);
}
inline void graph(juce::Graphics& g, juce::Rectangle<int> bounds, bool envelope = false) {
    well(g,bounds);auto inner=bounds.reduced(9);
    g.setColour(Palette::border().withAlpha(.45f));
    for(int i=1;i<5;++i) {auto x=float(inner.getX()+inner.getWidth()*i/5);g.drawVerticalLine(int(x),float(inner.getY()),float(inner.getBottom()));}
    g.drawHorizontalLine(inner.getCentreY(),float(inner.getX()),float(inner.getRight()));
    juce::Path path;
    if(envelope) {
        path.startNewSubPath(float(inner.getX()),float(inner.getBottom()-3));
        path.lineTo(float(inner.getX())+inner.getWidth()*.12f,float(inner.getY()+3));
        path.quadraticTo(float(inner.getX())+inner.getWidth()*.22f,float(inner.getCentreY()),float(inner.getX())+inner.getWidth()*.40f,float(inner.getCentreY()));
        path.lineTo(float(inner.getX())+inner.getWidth()*.65f,float(inner.getCentreY()+4));
        path.lineTo(float(inner.getRight()),float(inner.getBottom()-3));
    } else {
        for(int i=0;i<=80;++i) {float x=float(i)/80.f;float y=.5f-.28f*std::sin(x*juce::MathConstants<float>::twoPi*2.f);auto px=float(inner.getX())+x*inner.getWidth(),py=float(inner.getY())+y*inner.getHeight();if(i==0)path.startNewSubPath(px,py);else path.lineTo(px,py);}
    }
    g.setColour(Palette::accent().withAlpha(.7f));g.strokePath(path,juce::PathStrokeType(1.2f));
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
    explicit Panel(juce::String title): title_(std::move(title)) { setName(title_);setTooltip("Layout preview — controls are not connected to instrument parameters."); }
    void paint(juce::Graphics& g) override {
        g.setColour(Palette::panel());g.fillRoundedRectangle(getLocalBounds().toFloat().reduced(.5f),7);
        g.setColour(Palette::border());g.drawRoundedRectangle(getLocalBounds().toFloat().reduced(.5f),7,1);
        g.setColour(juce::Colour(0xff344149).withAlpha(.5f));g.drawHorizontalLine(2,8.f,float(getWidth()-8));
        text(g,title_,{12,3,getWidth()-24,27},12);
        paintContent(g,contentBounds());
    }
    juce::Rectangle<int> contentBounds() const { return getLocalBounds().reduced(10).withTrimmedTop(23); }
protected:
    virtual void paintContent(juce::Graphics&,juce::Rectangle<int>) {}
    juce::String title_;
};
}
