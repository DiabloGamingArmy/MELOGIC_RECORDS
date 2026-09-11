// mct-origami-v30.1.1-filter-width-rebalance
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v30.0.0-dynamic-source-layout-scaffold
// mct-origami-pitch-mod-ui-refine-v23.3.1
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
        // V23.3.1: taller performance strip for usable Pitch/Mod travel.
        // Keyboard remains compact via its internal top reserve.
        result.performance=area.removeFromBottom(76);
        area.removeFromBottom(6);

        const int usable=area.getHeight()-6;

        // V30: MACROS becomes the fixed top-left utility bay. OSCILLATORS uses
        // the remaining horizontal space, giving the top row a modular rack
        // hierarchy instead of dedicating the lower-right column to macros.
        auto upper=area.removeFromTop(juce::roundToInt(usable*.52f));
        const int macroWidth=juce::jlimit(150,190,juce::roundToInt(bounds.getWidth()*.12f));
        result.macros=upper.removeFromLeft(macroWidth);
        upper.removeFromLeft(6);
        result.oscillators=upper;

        area.removeFromTop(6);

        // Lower row is now two independently-scaffolded collections:
        // MODULATION SOURCES | editor    and    FILTERS | editor.
        // The rails themselves live inside those panels.
        auto lower=area;
        // V30.1.1: rebalance the lower workspace toward FILTER. The modulation
        // editor remains the larger single panel, but FILTER now has enough
        // horizontal room for its graph/routing controls to breathe.
        result.filter=lower.removeFromRight(juce::roundToInt(bounds.getWidth()*.46f));
        lower.removeFromRight(6);
        result.modulation=lower;

        result.mixer={};
        result.fxPre={};
        result.fxPost={};

        return result;
    }
};
}
