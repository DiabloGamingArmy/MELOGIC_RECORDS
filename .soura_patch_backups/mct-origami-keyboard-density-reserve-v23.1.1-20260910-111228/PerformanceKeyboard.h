// mct-origami-playable-keyboard-audio-v23.1
#pragma once
#include "OrigamiStyle.h"
namespace mct::origami::ui {
class PerformanceKeyboard final : public juce::Component, public juce::SettableTooltipClient {
public:
    explicit PerformanceKeyboard(juce::MidiKeyboardState& state)
        : keyboardState_(state) {
        setName("Performance keyboard");
        setTooltip("Click or drag across keys to play MCT Origami.");
        setMouseCursor(juce::MouseCursor::PointingHandCursor);
    }
    ~PerformanceKeyboard() override;

    void paint(juce::Graphics&) override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
    void mouseExit(const juce::MouseEvent&) override;

private:
    juce::Rectangle<int> keyArea() const noexcept;
    int noteAt(juce::Point<float>) const noexcept;
    void setMouseNote(int note);

    juce::MidiKeyboardState& keyboardState_;
    int mouseNote_=-1;
    static constexpr int firstMidiNote=48;
    static constexpr int whiteKeyCount=21;
};
}
