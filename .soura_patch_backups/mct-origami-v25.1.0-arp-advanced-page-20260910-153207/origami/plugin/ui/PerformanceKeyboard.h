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
#include "../PluginProcessor.h"
namespace mct::origami::ui {
class PerformanceKeyboard final : public juce::Component, public juce::SettableTooltipClient {
public:
    using WheelSetter=std::function<void(float)>;
    using RangeSetter=std::function<bool(float)>;
    using RangeGetter=std::function<float()>;
    using PerformanceSetter=std::function<bool(const mct::origami::PerformanceState&)>;
    using PerformanceGetter=std::function<mct::origami::PerformanceState()>;
    using ArpSetter=std::function<bool(const OrigamiArpeggiatorState&)>;
    using ArpGetter=std::function<OrigamiArpeggiatorState()>;
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
        for(auto* c:{static_cast<juce::Component*>(&arpEnable_),static_cast<juce::Component*>(&arpSync_),static_cast<juce::Component*>(&arpRate_),static_cast<juce::Component*>(&arpDirection_),static_cast<juce::Component*>(&arpOctaves_),static_cast<juce::Component*>(&arpGate_),static_cast<juce::Component*>(&arpSwing_),static_cast<juce::Component*>(&arpLatch_),static_cast<juce::Component*>(&arpTempo_)}) addAndMakeVisible(*c);
        arpEnable_.setButtonText("ARP");arpEnable_.setClickingTogglesState(true);arpLatch_.setButtonText("LATCH");arpLatch_.setClickingTogglesState(true);
        arpSync_.addItem("DAW",1);arpSync_.addItem("INT",2);arpSync_.setScrollWheelEnabled(false);
        for(const auto& item:std::initializer_list<std::pair<const char*,int>>{{"1/4",1},{"1/8",2},{"1/16",3},{"1/32",4},{"1/8T",5},{"1/16T",6},{"1/8.",7}}) arpRate_.addItem(item.first,item.second);
        for(const auto& item:std::initializer_list<std::pair<const char*,int>>{{"UP",1},{"DOWN",2},{"UP/DN",3},{"ORDER",4},{"RND",5}}) arpDirection_.addItem(item.first,item.second);
        arpRate_.setScrollWheelEnabled(false);arpDirection_.setScrollWheelEnabled(false);
        for(int i=1;i<=4;++i) arpOctaves_.addItem(juce::String(i)+" OCT",i);arpOctaves_.setScrollWheelEnabled(false);
        auto bar=[](juce::Slider& s){s.setSliderStyle(juce::Slider::LinearBar);s.setTextBoxStyle(juce::Slider::TextBoxLeft,false,38,14);s.setScrollWheelEnabled(false);};
        bar(arpGate_);arpGate_.setRange(5.0,100.0,1.0);arpGate_.setTextValueSuffix("%");
        bar(arpSwing_);arpSwing_.setRange(0.0,75.0,1.0);arpSwing_.setTextValueSuffix("%");
        bar(arpTempo_);arpTempo_.setRange(20.0,400.0,0.1);arpTempo_.setTextValueSuffix(" BPM");
        const auto a=arpGetter_?arpGetter_():OrigamiArpeggiatorState{};
        arpEnable_.setToggleState(a.enabled,juce::dontSendNotification);arpLatch_.setToggleState(a.latch,juce::dontSendNotification);
        arpSync_.setSelectedId(a.syncToDaw?1:2,juce::dontSendNotification);arpRate_.setSelectedId(a.rateIndex+1,juce::dontSendNotification);
        arpDirection_.setSelectedId(static_cast<int>(a.direction)+1,juce::dontSendNotification);arpOctaves_.setSelectedId(a.octaveSpan,juce::dontSendNotification);
        arpGate_.setValue(a.gate*100.0,juce::dontSendNotification);arpSwing_.setValue(a.swing*100.0,juce::dontSendNotification);arpTempo_.setValue(a.internalTempo,juce::dontSendNotification);
        auto commitArp=[this]{if(!arpSetter_)return;auto s=arpGetter_?arpGetter_():OrigamiArpeggiatorState{};s.enabled=arpEnable_.getToggleState();s.latch=arpLatch_.getToggleState();s.syncToDaw=arpSync_.getSelectedId()!=2;s.rateIndex=juce::jmax(0,arpRate_.getSelectedId()-1);s.direction=static_cast<OrigamiArpeggiatorState::Direction>(juce::jlimit(0,4,arpDirection_.getSelectedId()-1));s.octaveSpan=juce::jlimit(1,4,arpOctaves_.getSelectedId());s.gate=static_cast<float>(arpGate_.getValue()/100.0);s.swing=static_cast<float>(arpSwing_.getValue()/100.0);s.internalTempo=arpTempo_.getValue();arpTempo_.setEnabled(!s.syncToDaw);arpSetter_(s);};
        arpEnable_.onClick=commitArp;arpLatch_.onClick=commitArp;arpSync_.onChange=commitArp;arpRate_.onChange=commitArp;arpDirection_.onChange=commitArp;arpOctaves_.onChange=commitArp;arpGate_.onValueChange=commitArp;arpSwing_.onValueChange=commitArp;arpTempo_.onValueChange=commitArp;
        arpTempo_.setEnabled(!a.syncToDaw);
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
    PerformanceSetter performanceSetter_;PerformanceGetter performanceGetter_;
    ArpSetter arpSetter_;ArpGetter arpGetter_;
    juce::Slider bendRange_,glide_,arpGate_,arpSwing_,arpTempo_;
    juce::ComboBox voiceMode_,priority_,arpSync_,arpRate_,arpDirection_,arpOctaves_;
    juce::ToggleButton legato_,arpEnable_,arpLatch_;
    int mouseNote_=-1;int activeWheel_=0;float pitchValue_=0.0f,modValue_=0.0f;
    static constexpr int firstMidiNote=48;
    // V23.1.1: four-octave bed for thinner workstation-style keys.
    // V23.1.2: five-octave visual density; compact workstation-style keys.
    static constexpr int whiteKeyCount=35;
};
}
