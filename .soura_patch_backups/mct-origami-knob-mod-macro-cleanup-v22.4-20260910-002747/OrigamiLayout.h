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
        // mct-origami-two-row-synth-layout-v10
        EditorLayout result;
        auto area=bounds.reduced(8);

        result.header=area.removeFromTop(72);
        area.removeFromTop(6);

        result.performance=area.removeFromBottom(94);
        area.removeFromBottom(6);

        const int usable=area.getHeight()-6;

        result.oscillators=area.removeFromTop(juce::roundToInt(usable*.52f));
        area.removeFromTop(6);

        auto lower=area;
        result.filter=lower.removeFromRight(juce::roundToInt(lower.getWidth()*.31f));
        lower.removeFromRight(6);

        result.modulation=lower;
        const int macroWidth=juce::roundToInt(result.modulation.getWidth()*.18f);
        auto modArea=result.modulation;
        result.macros=modArea.removeFromRight(macroWidth);
        modArea.removeFromRight(6);
        result.modulation=modArea;

        result.mixer={};
        result.fxPre={};
        result.fxPost={};

        return result;
    }
};
}
