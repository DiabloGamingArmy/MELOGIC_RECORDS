// mct-origami-v25.2.0-arp-ux-visual-architecture
// mct-origami-v25.1.0-arp-advanced-page
// mct-origami-v25.0.0-arp-internal-clock
// mct-origami-performance-ui-refinement-v23.4.5
// mct-origami-performance-audio-ui-repair-v23.4.4
// mct-origami-v23.4.3-performance-state-include-repair
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-relative-drag-linear-controls-v23.3.4
// mct-origami-bend-range-number-only-v23.3.3
// mct-origami-performance-strip-relayout-v23.3.2
// mct-origami-pitch-mod-ui-refine-v23.3.1
// mct-origami-pitch-mod-real-v23.3
// mct-origami-keyboard-compact-bottom-v23.1.2
// mct-origami-keyboard-density-reserve-v23.1.1
// mct-origami-playable-keyboard-audio-v23.1
#pragma once
#include "OrigamiStyle.h"
#include "../../core/InstrumentState.h"
#include "../../core/ArpeggiatorState.h"
namespace mct::origami::ui {
class PerformanceKeyboard final : public juce::Component, public juce::SettableTooltipClient {
public:
    using WheelSetter=std::function<void(float)>;
    using RangeSetter=std::function<bool(float)>;
    using RangeGetter=std::function<float()>;
    using PerformanceSetter=std::function<bool(const mct::origami::PerformanceState&)>;
    using PerformanceGetter=std::function<mct::origami::PerformanceState()>;
    using ArpSetter=std::function<bool(const mct::origami::ArpeggiatorState&)>;
    using ArpGetter=std::function<mct::origami::ArpeggiatorState()>;
    PerformanceKeyboard(juce::MidiKeyboardState& state,WheelSetter pitch,WheelSetter mod,RangeSetter rangeSetter,RangeGetter rangeGetter,PerformanceSetter performanceSetter,PerformanceGetter performanceGetter,ArpSetter arpSetter,ArpGetter arpGetter)
        : keyboardState_(state),pitchSetter_(std::move(pitch)),modSetter_(std::move(mod)),rangeSetter_(std::move(rangeSetter)),rangeGetter_(std::move(rangeGetter)),performanceSetter_(std::move(performanceSetter)),performanceGetter_(std::move(performanceGetter)),arpSetter_(std::move(arpSetter)),arpGetter_(std::move(arpGetter)) {
        setName("Performance keyboard");
        setTooltip("Click or drag across keys to play MCT Origami.");
        setMouseCursor(juce::MouseCursor::PointingHandCursor);
        addAndMakeVisible(bendRange_);
        bendRange_.setName("Pitch bend range");
        bendRange_.setSliderStyle(juce::Slider::LinearBarVertical);
        bendRange_.setTextBoxStyle(juce::Slider::TextBoxBelow,false,62,18);
        bendRange_.setRange(1.0,48.0,1.0);
        // V23.3.4: relative drag. Clicking does not teleport the value.
        bendRange_.setSliderSnapsToMousePosition(false);
        bendRange_.setScrollWheelEnabled(false);
        bendRange_.setDoubleClickReturnValue(true,2.0);
        bendRange_.setTooltip("Bend Range — click/drag vertically or type a semitone value");
        bendRange_.textFromValueFunction=[](double value) {
            return juce::String(juce::roundToInt(value));
        };
        bendRange_.valueFromTextFunction=[](const juce::String& value) {
            return value.retainCharacters("0123456789.-").getDoubleValue();
        };
        bendRange_.setValue(rangeGetter_?rangeGetter_():2.0f,juce::dontSendNotification);
        bendRange_.onValueChange=[this]{
            if(rangeSetter_) rangeSetter_(static_cast<float>(bendRange_.getValue()));
        };
        addAndMakeVisible(voiceMode_);addAndMakeVisible(priority_);addAndMakeVisible(legato_);addAndMakeVisible(glide_);
        voiceMode_.addItem("POLY",1);voiceMode_.addItem("MONO",2);voiceMode_.setScrollWheelEnabled(false);voiceMode_.setTooltip("Voice mode");
        priority_.addItem("LAST",1);priority_.addItem("HIGH",2);priority_.addItem("LOW",3);priority_.setScrollWheelEnabled(false);priority_.setTooltip("Mono note priority");
        legato_.setButtonText("LEGATO");legato_.setClickingTogglesState(true);legato_.setTooltip("Legato envelope behavior");
        // V23.4.5: native Origami rotary glide control.
        glide_.setName("Glide");
        glide_.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        glide_.setTextBoxStyle(juce::Slider::TextBoxBelow,false,48,14);
        glide_.setRange(0.0,5.0,0.001);
        glide_.setRotaryParameters(juce::MathConstants<float>::pi*1.25f,
                                   juce::MathConstants<float>::pi*2.75f,true);
        glide_.setScrollWheelEnabled(false);
        glide_.setDoubleClickReturnValue(true,0.0);
        glide_.setTooltip("Glide time — drag vertically; double-click for off");
        glide_.textFromValueFunction=[](double v){return v<0.001?"OFF":juce::String(v,3);};
        const auto initialPerformance=performanceGetter_?performanceGetter_():mct::origami::PerformanceState{};
        voiceMode_.setSelectedId(initialPerformance.voiceMode==mct::origami::VoiceMode::Mono?2:1,juce::dontSendNotification);
        priority_.setSelectedId(initialPerformance.notePriority==mct::origami::NotePriority::High?2:initialPerformance.notePriority==mct::origami::NotePriority::Low?3:1,juce::dontSendNotification);
        legato_.setToggleState(initialPerformance.legato,juce::dontSendNotification);glide_.setValue(initialPerformance.glideSeconds,juce::dontSendNotification);
        auto commit=[this]{
            if(!performanceSetter_) return;
            auto performance=performanceGetter_?performanceGetter_():mct::origami::PerformanceState{};
            performance.voiceMode=voiceMode_.getSelectedId()==2?mct::origami::VoiceMode::Mono:mct::origami::VoiceMode::Poly;
            performance.notePriority=priority_.getSelectedId()==2?mct::origami::NotePriority::High:priority_.getSelectedId()==3?mct::origami::NotePriority::Low:mct::origami::NotePriority::Last;
            performance.legato=legato_.getToggleState();performance.glideSeconds=static_cast<float>(glide_.getValue());performanceSetter_(performance);
        };
        voiceMode_.onChange=commit;priority_.onChange=commit;legato_.onClick=commit;glide_.onValueChange=commit;
        addAndMakeVisible(arpEnable_);
        addAndMakeVisible(arpSettings_);
        addAndMakeVisible(arpClockSummary_);
        arpEnable_.setButtonText("ARP");
        arpEnable_.setClickingTogglesState(true);
        arpEnable_.setTooltip("Enable arpeggiator");
        arpSettings_.setButtonText("SETTINGS");
        arpSettings_.setTooltip("Open advanced arpeggiator and clock settings");
        arpSettings_.setConnectedEdges(juce::Button::ConnectedOnLeft);
        arpClockSummary_.setJustificationType(juce::Justification::centred);
        arpClockSummary_.setColour(juce::Label::textColourId,Palette::muted());
        arpClockSummary_.setFont(juce::FontOptions(7.0f));
        syncArpFromModel();
        arpEnable_.onClick=[this]{
            if(!arpSetter_) return;
            auto arpState=arpGetter_?arpGetter_():mct::origami::ArpeggiatorState{};
            arpState.enabled=arpEnable_.getToggleState();
            arpSetter_(arpState);
            syncArpFromModel();
        };
        arpSettings_.onClick=[this]{if(onArpSettingsRequested) onArpSettingsRequested();};
    }
    ~PerformanceKeyboard() override;

    std::function<void()> onArpSettingsRequested;
    void syncArpFromModel();
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
    PerformanceSetter performanceSetter_;PerformanceGetter performanceGetter_;
    ArpSetter arpSetter_;ArpGetter arpGetter_;
    juce::Slider bendRange_,glide_;
    juce::ComboBox voiceMode_,priority_;
    juce::ToggleButton legato_,arpEnable_;
    juce::TextButton arpSettings_;
    juce::Label arpClockSummary_;
    int mouseNote_=-1;int activeWheel_=0;float pitchValue_=0.0f,modValue_=0.0f;
    static constexpr int firstMidiNote=48;
    // V23.1.1: four-octave bed for thinner workstation-style keys.
    // V23.1.2: five-octave visual density; compact workstation-style keys.
    static constexpr int whiteKeyCount=35;
};
}
