// mct-origami-pitch-mod-real-v23.3
// mct-origami-keyboard-compact-bottom-v23.1.2
// mct-origami-keyboard-density-reserve-v23.1.1
// mct-origami-playable-keyboard-audio-v23.1
#pragma once
#include "OrigamiStyle.h"
namespace mct::origami::ui {
class PerformanceKeyboard final : public juce::Component, public juce::SettableTooltipClient {
public:
    using WheelSetter=std::function<void(float)>;
    using RangeSetter=std::function<bool(float)>;
    using RangeGetter=std::function<float()>;
    PerformanceKeyboard(juce::MidiKeyboardState& state,WheelSetter pitch,WheelSetter mod,RangeSetter rangeSetter,RangeGetter rangeGetter)
        : keyboardState_(state),pitchSetter_(std::move(pitch)),modSetter_(std::move(mod)),rangeSetter_(std::move(rangeSetter)),rangeGetter_(std::move(rangeGetter)) {
        setName("Performance keyboard");
        setTooltip("Click or drag across keys to play MCT Origami.");
        setMouseCursor(juce::MouseCursor::PointingHandCursor);
        addAndMakeVisible(bendRange_);bendRange_.setName("Pitch bend range");bendRange_.setScrollWheelEnabled(false);
        for(int value:{2,3,5,7,12,24,48}) bendRange_.addItem("±"+juce::String(value)+" st",value);
        const int current=juce::roundToInt(rangeGetter_?rangeGetter_():2.0f);bendRange_.setSelectedId(current,juce::dontSendNotification);
        bendRange_.onChange=[this]{if(rangeSetter_) rangeSetter_(static_cast<float>(bendRange_.getSelectedId()));};
    }
    ~PerformanceKeyboard() override;

    void paint(juce::Graphics&) override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
    void mouseExit(const juce::MouseEvent&) override;
    void resized() override;

private:
    juce::Rectangle<int> keyArea() const noexcept;
    int noteAt(juce::Point<float>) const noexcept;
    void setMouseNote(int note);
    juce::Rectangle<int> pitchWheelArea() const noexcept;
    juce::Rectangle<int> modWheelArea() const noexcept;
    void updateWheel(juce::Point<float>);

    juce::MidiKeyboardState& keyboardState_;
    WheelSetter pitchSetter_,modSetter_;RangeSetter rangeSetter_;RangeGetter rangeGetter_;
    juce::ComboBox bendRange_;
    int mouseNote_=-1;int activeWheel_=0;float pitchValue_=0.0f,modValue_=0.0f;
    static constexpr int firstMidiNote=48;
    // V23.1.1: four-octave bed for thinner workstation-style keys.
    // V23.1.2: five-octave visual density; compact workstation-style keys.
    static constexpr int whiteKeyCount=35;
};
}
