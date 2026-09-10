// mct-origami-keyboard-compact-bottom-v23.1.2
// mct-origami-playable-keyboard-audio-v23.1
// mct-origami-knob-mod-macro-cleanup-v22.4
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

        // V23.1: thinner performance keyboard; reclaimed vertical space
        // returns to the main synth workspace.
        // V23.1.2: compact performance strip; keyboard is utility, not focus.
        result.performance=area.removeFromBottom(58);
        area.removeFromBottom(6);

        const int usable=area.getHeight()-6;

        result.oscillators=area.removeFromTop(juce::roundToInt(usable*.52f));
        area.removeFromTop(6);

        auto lower=area;
        // V22.4: Macros is the terminal panel on the lower row.
        // Keep the existing approximate widths, but order the row:
        // MODULATION | FILTER | MACROS.
        const int macroWidth=juce::roundToInt(lower.getWidth()*.12f);
        result.macros=lower.removeFromRight(macroWidth);
        lower.removeFromRight(6);

        result.filter=lower.removeFromRight(juce::roundToInt(bounds.getWidth()*.31f));
        lower.removeFromRight(6);

        result.modulation=lower;

        result.mixer={};
        result.fxPre={};
        result.fxPost={};

        return result;
    }
};
}
