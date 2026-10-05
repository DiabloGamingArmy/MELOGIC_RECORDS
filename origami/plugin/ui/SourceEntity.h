// mct-origami-unified-routing-core-fx-p04
#pragma once
#include "OrigamiStyle.h"
#include <cmath>
#include <vector>

// One visual vocabulary for every source entity (modulators, filters, buses)
// on every page: the six-dot drag grip, the per-route modulation magnitude
// ring, and the row itself. Synth, FX and future Mixer all paint through here.
namespace mct::origami::ui {

// Six-dot grip: "this can be dragged".
inline void paintDragGrip(juce::Graphics& g,juce::Rectangle<float> area,juce::Colour colour=Palette::muted().withAlpha(.65f)) {
    g.setColour(colour);
    const float x0=area.getCentreX()-3.0f,y0=area.getCentreY()-5.0f;
    for(int row=0;row<3;++row)
        for(int column=0;column<2;++column)
            g.fillEllipse(x0+float(column)*4.5f,y0+float(row)*4.5f,2.2f,2.2f);
}

// Route magnitude ring: 0% at 12 o'clock, clockwise magnitude arc in the
// signal colour (darker for negative amounts), white endpoint dot.
inline void paintModulationMagnitudeRing(juce::Graphics& g,juce::Rectangle<float> circle,float amount) {
    amount=juce::jlimit(-1.0f,1.0f,amount);
    const float magnitude=std::abs(amount);
    const auto c=circle.getCentre();
    const float radius=circle.getWidth()*0.5f-1.75f;
    g.setColour(Palette::background().withAlpha(0.96f));
    g.fillEllipse(circle);
    g.setColour(Palette::borderStrong().withAlpha(0.72f));
    g.drawEllipse(circle.reduced(1.15f),1.25f);
    g.setColour(Palette::text().withAlpha(0.56f));
    g.drawLine(c.x,c.y-radius,c.x,c.y-radius+3.1f,1.15f);
    if(magnitude>0.001f) {
        constexpr int segments=48;
        const int used=juce::jmax(1,juce::roundToInt(magnitude*segments));
        juce::Path arc;
        for(int step=0;step<=used;++step) {
            const float t=magnitude*(float(step)/float(used));
            const float angle=-juce::MathConstants<float>::halfPi+juce::MathConstants<float>::twoPi*t;
            const juce::Point<float> p{c.x+std::cos(angle)*radius,c.y+std::sin(angle)*radius};
            if(step==0) arc.startNewSubPath(p); else arc.lineTo(p);
        }
        auto colour=signalSourceColour();
        if(amount<0.0f) colour=colour.darker(0.34f);
        g.setColour(colour.withAlpha(0.98f));
        g.strokePath(arc,juce::PathStrokeType(2.75f,juce::PathStrokeType::curved,juce::PathStrokeType::rounded));
        const float end=-juce::MathConstants<float>::halfPi+juce::MathConstants<float>::twoPi*magnitude;
        g.setColour(Palette::text().withAlpha(0.95f));
        g.fillEllipse(juce::Rectangle<float>(3.2f,3.2f).withCentre({c.x+std::cos(end)*radius,c.y+std::sin(end)*radius}));
    } else {
        g.setColour(Palette::text().withAlpha(0.84f));
        g.fillEllipse(juce::Rectangle<float>(3.0f,3.0f).withCentre({c.x,c.y-radius}));
    }
}

struct SourceEntityStyle {
    juce::String label,badge,detail;
    bool draggable=false,enabled=true,selected=false,active=false,hovered=false;
    std::vector<float> magnitudes; // route amounts shown as rings (max 3)
};

inline constexpr float sourceEntityRingSize=20.0f;
inline constexpr float sourceEntityGripWidth=14.0f;

// Ring bounds for magnitude i of a row (shared by painting and hit testing).
inline juce::Rectangle<float> sourceEntityRing(juce::Rectangle<int> row,std::size_t index,bool active) {
    const float right=float(row.getRight())-(active ? 22.0f : 8.0f);
    return juce::Rectangle<float>(sourceEntityRingSize,sourceEntityRingSize)
        .withCentre({right-sourceEntityRingSize*0.5f-float(index)*(sourceEntityRingSize+4.0f),float(row.getCentreY())});
}

inline void paintSourceEntityRow(juce::Graphics& g,juce::Rectangle<int> r,const SourceEntityStyle& s) {
    const auto fill=!s.enabled ? Palette::inset() : s.hovered ? Palette::raised().brighter(.08f) : Palette::raised();
    g.setColour(fill);
    g.fillRect(r);
    g.setColour(s.selected || s.active ? signalShade(.75f,.9f) : s.enabled ? Palette::border() : Palette::borderSoft());
    g.drawRect(r);
    auto inner=r.reduced(10,0);
    if(s.draggable && s.enabled) {
        paintDragGrip(g,inner.removeFromLeft(int(sourceEntityGripWidth)).toFloat());
        inner.removeFromLeft(4);
    }
    if(s.active) {
        g.setColour(signalSourceColour());
        g.fillEllipse(juce::Rectangle<float>(6.0f,6.0f).withCentre({float(r.getRight()-12),float(r.getCentreY())}));
    }
    const std::size_t rings=std::min<std::size_t>(s.magnitudes.size(),3);
    for(std::size_t i=0;i<rings;++i) paintModulationMagnitudeRing(g,sourceEntityRing(r,i,s.active),s.magnitudes[i]);
    const int reserved=int(rings)*int(sourceEntityRingSize+4.0f)+(s.active ? 14 : 0);
    const auto colour=s.enabled ? Palette::text() : Palette::muted().withAlpha(.65f);
    if(s.detail.isNotEmpty()) {
        text(g,s.label,inner.withHeight(r.getHeight()/2+2).withY(r.getY()+3),Type::label,colour);
        text(g,s.detail,inner.withTrimmedTop(r.getHeight()/2+1).withTrimmedRight(reserved),Type::secondary,Palette::muted());
    } else {
        text(g,s.label,inner,Type::label,colour);
    }
    if(s.badge.isNotEmpty())
        text(g,s.badge,inner.withTrimmedRight(reserved+2),Type::secondary,Palette::muted(),juce::Justification::centredRight);
}

}
