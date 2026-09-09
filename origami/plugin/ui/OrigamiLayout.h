#pragma once
#include <JuceHeader.h>
namespace mct::origami::ui {
struct EditorLayout {
    static constexpr int defaultWidth=1380,defaultHeight=900,minWidth=1080,minHeight=720,gap=8;
    juce::Rectangle<int> header,oscillators,mixer,filter,fxPre,fxPost,modulation,macros,performance;
    static EditorLayout calculate(juce::Rectangle<int> bounds) {
        EditorLayout result;auto area=bounds.reduced(10);
        result.header=area.removeFromTop(72);area.removeFromTop(gap);
        result.performance=area.removeFromBottom(96);area.removeFromBottom(gap);
        const int available=area.getHeight()-2*gap;
        result.oscillators=area.removeFromTop(juce::jmax(200,juce::roundToInt(available*.38)));area.removeFromTop(gap);
        auto shaping=area.removeFromTop(juce::roundToInt(available*.28));area.removeFromTop(gap);
        const int shapingWidth=shaping.getWidth()-3*gap;
        result.mixer=shaping.removeFromLeft(juce::roundToInt(shapingWidth*.24));shaping.removeFromLeft(gap);
        result.filter=shaping.removeFromLeft(juce::roundToInt(shapingWidth*.43));shaping.removeFromLeft(gap);
        result.fxPre=shaping.removeFromLeft(juce::roundToInt(shapingWidth*.10));shaping.removeFromLeft(gap);result.fxPost=shaping;
        result.macros=area.removeFromRight(juce::roundToInt(area.getWidth()*.17));area.removeFromRight(gap);result.modulation=area;
        return result;
    }
};
}
