#pragma once
#include <JuceHeader.h>
namespace mct::origami::ui {
struct EditorLayout {
    // mct-origami-fixed-ratio-zoom-v1
    // 16:10 is the canonical Origami design canvas: wide enough for the horizontal
    // oscillator workflow without sacrificing vertical room for modulation and keys.
    static constexpr int defaultWidth=1440,defaultHeight=900,minWidth=960,minHeight=600,maxWidth=1920,maxHeight=1200,gap=8;
    static constexpr double aspectRatio=16.0/10.0;
    juce::Rectangle<int> header,oscillators,mixer,filter,fxPre,fxPost,modulation,macros,performance;
    static EditorLayout calculate(juce::Rectangle<int> bounds) {
        // mct-origami-density-breathing-room-v8
        EditorLayout result;
        auto area=bounds.reduced(12);

        result.header=area.removeFromTop(76);
        area.removeFromTop(10);

        result.performance=area.removeFromBottom(100);
        area.removeFromBottom(10);

        const int available=area.getHeight()-20;

        result.oscillators=area.removeFromTop(
            juce::jmax(220,juce::roundToInt(available*.41f)));
        area.removeFromTop(10);

        auto shaping=area.removeFromTop(
            juce::jmax(170,juce::roundToInt(available*.27f)));
        area.removeFromTop(10);

        const int shapingWidth=shaping.getWidth()-30;
        result.mixer=shaping.removeFromLeft(juce::roundToInt(shapingWidth*.23f));
        shaping.removeFromLeft(10);
        result.filter=shaping.removeFromLeft(juce::roundToInt(shapingWidth*.44f));
        shaping.removeFromLeft(10);
        result.fxPre=shaping.removeFromLeft(juce::roundToInt(shapingWidth*.10f));
        shaping.removeFromLeft(10);
        result.fxPost=shaping;

        result.macros=area.removeFromRight(juce::roundToInt(area.getWidth()*.17f));
        area.removeFromRight(10);
        result.modulation=area;

        return result;
    }
};
}
