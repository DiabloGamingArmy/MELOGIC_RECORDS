// mct-origami-performance-strip-relayout-v23.3.2
// mct-origami-pitch-mod-ui-refine-v23.3.1
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
        addAndMakeVisible(bendRange_);
        bendRange_.setName("Pitch bend range");
        bendRange_.setSliderStyle(juce::Slider::LinearBarVertical);
        bendRange_.setTextBoxStyle(juce::Slider::TextBoxBelow,false,62,18);
        bendRange_.setRange(1.0,48.0,1.0);
        bendRange_.setScrollWheelEnabled(false);
        bendRange_.setDoubleClickReturnValue(true,2.0);
        bendRange_.setTooltip("Bend Range — click/drag vertically or type a semitone value");
        bendRange_.textFromValueFunction=[](double value) {
            return "±"+juce::String(juce::roundToInt(value))+" st";
        };
        bendRange_.valueFromTextFunction=[](const juce::String& value) {
            return value.retainCharacters("0123456789.-").getDoubleValue();
        };
        bendRange_.setValue(rangeGetter_?rangeGetter_():2.0f,juce::dontSendNotification);
        bendRange_.onValueChange=[this]{
            if(rangeSetter_) rangeSetter_(static_cast<float>(bendRange_.getValue()));
        };
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
    juce::Slider bendRange_;
    int mouseNote_=-1;int activeWheel_=0;float pitchValue_=0.0f,modValue_=0.0f;
    static constexpr int firstMidiNote=48;
    // V23.1.1: four-octave bed for thinner workstation-style keys.
    // V23.1.2: five-octave visual density; compact workstation-style keys.
    static constexpr int whiteKeyCount=35;
};
}
