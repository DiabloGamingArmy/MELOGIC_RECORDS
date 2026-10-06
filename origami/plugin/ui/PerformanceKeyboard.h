// mct-origami-deep-audit-p02-lockfree-ui-midi
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v25.3.2-arp-ui-stabilization
// mct-origami-v25.3.1-arp-layout-refinement
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
#include "NativeChoiceMenu.h"
#include "../../core/InstrumentState.h"
#include "../../core/ArpeggiatorState.h"
namespace mct::origami::ui {

class ArpSettingsIconButton final : public juce::Button {
public:
    ArpSettingsIconButton() : juce::Button("ARP settings") {
        setTooltip("Open advanced arpeggiator and clock settings");
        setMouseCursor(juce::MouseCursor::PointingHandCursor);
    }

    void paintButton(juce::Graphics& g,bool hovered,bool down) override {
        auto r=getLocalBounds().toFloat().reduced(0.5f);
        g.setColour((hovered||down)?Palette::borderStrong():Palette::borderSoft());
        g.fillRoundedRectangle(r,2.0f);
        g.setColour(Palette::panel());
        g.fillRoundedRectangle(r.reduced(1.0f),2.0f);

        const auto c=r.getCentre();
        const float radius=juce::jmin(r.getWidth(),r.getHeight())*0.19f;
        const float spokeInner=radius*1.25f;
        const float spokeOuter=radius*1.85f;
        g.setColour((hovered||down)?Palette::text():Palette::secondary());
        g.drawEllipse(c.x-radius,c.y-radius,radius*2.0f,radius*2.0f,1.3f);
        g.fillEllipse(c.x-1.6f,c.y-1.6f,3.2f,3.2f);

        for(int i=0;i<8;++i) {
            const float a=juce::MathConstants<float>::twoPi*(float(i)/8.0f);
            g.drawLine(c.x+std::cos(a)*spokeInner,
                       c.y+std::sin(a)*spokeInner,
                       c.x+std::cos(a)*spokeOuter,
                       c.y+std::sin(a)*spokeOuter,
                       1.3f);
        }
    }
};

class PerformanceKeyboard final : public juce::Component, public juce::SettableTooltipClient {
public:
    using NoteSetter=std::function<bool(int,bool,float)>;
    using WheelSetter=std::function<void(float)>;
    using RangeSetter=std::function<bool(float,float)>;
    using RangeGetter=std::function<std::pair<float,float>()>;
    using PerformanceSetter=std::function<bool(const mct::origami::PerformanceState&)>;
    using PerformanceGetter=std::function<mct::origami::PerformanceState()>;
    using ArpSetter=std::function<bool(const mct::origami::ArpeggiatorState&)>;
    using ArpGetter=std::function<mct::origami::ArpeggiatorState()>;
    PerformanceKeyboard(NoteSetter noteSetter,WheelSetter pitch,WheelSetter mod,RangeSetter rangeSetter,RangeGetter rangeGetter,PerformanceSetter performanceSetter,PerformanceGetter performanceGetter,ArpSetter arpSetter,ArpGetter arpGetter)
        : noteSetter_(std::move(noteSetter)),pitchSetter_(std::move(pitch)),modSetter_(std::move(mod)),rangeSetter_(std::move(rangeSetter)),rangeGetter_(std::move(rangeGetter)),performanceSetter_(std::move(performanceSetter)),performanceGetter_(std::move(performanceGetter)),arpSetter_(std::move(arpSetter)),arpGetter_(std::move(arpGetter)) {
        setName("Performance keyboard");
        setTooltip("Click or drag across keys to play MCT Origami.");
        setMouseCursor(juce::MouseCursor::PointingHandCursor);
        addAndMakeVisible(bendRange_);
        addAndMakeVisible(bendDownRange_);
        bendRange_.setName("Pitch bend up range");
        bendRange_.setSliderStyle(juce::Slider::LinearBarVertical);
        bendRange_.setTextBoxStyle(juce::Slider::TextBoxBelow,false,62,18);
        // mct-origami-nested-modulation-manual-qa: signed wheel ENDPOINTS
        // (semitones at full up / full down; any sign: UP +12 / DOWN +5 raise
        // both ways, UP -12 / DOWN +12 reverse the wheel). Centre is always 0.
        bendRange_.setRange(-48.0,48.0,1.0);
        // V23.3.4: relative drag. Clicking does not teleport the value.
        bendRange_.setSliderSnapsToMousePosition(false);
        bendRange_.setScrollWheelEnabled(false);
        bendRange_.setDoubleClickReturnValue(true,2.0);
        bendRange_.setTooltip("Bend Up: pitch at the wheel's top, in semitones (-48..+48; default +2)");
        bendDownRange_.setName("Pitch bend down range");
        bendDownRange_.setSliderStyle(juce::Slider::LinearBarVertical);
        bendDownRange_.setTextBoxStyle(juce::Slider::TextBoxBelow,false,62,18);
        bendDownRange_.setRange(-48.0,48.0,1.0);
        bendDownRange_.setSliderSnapsToMousePosition(false);
        bendDownRange_.setScrollWheelEnabled(false);
        bendDownRange_.setDoubleClickReturnValue(true,-2.0);
        bendDownRange_.setTooltip("Bend Down: pitch at the wheel's bottom, in semitones (-48..+48; default -2)");
        bendDownRange_.textFromValueFunction=[](double value){ const int v=juce::roundToInt(value); return (v>0 ? "+" : "")+juce::String(v); };
        bendDownRange_.valueFromTextFunction=[](const juce::String& value){return value.retainCharacters("0123456789.-").getDoubleValue();};
        auto styleBend=[](juce::Slider& slider) {
            slider.setColour(juce::Slider::backgroundColourId,juce::Colour(0xff1b1b1b));
            slider.setColour(juce::Slider::trackColourId,juce::Colour(0xff1b1b1b));
            slider.setColour(juce::Slider::thumbColourId,juce::Colours::transparentBlack);
            slider.setColour(juce::Slider::textBoxBackgroundColourId,juce::Colours::transparentBlack);
            slider.setColour(juce::Slider::textBoxOutlineColourId,juce::Colours::transparentBlack);
            slider.setColour(juce::Slider::textBoxTextColourId,Palette::text());
            // mct-origami-manual-qa-ui-wavetable-fixes: a number field (drag /
            // type the value), not a bar: no position marker under the digits.
            slider.getProperties().set("mct.origami.numberOnly",true);
        };
        styleBend(bendRange_);
        styleBend(bendDownRange_);
        bendRange_.textFromValueFunction=[](double value) {
            const int v=juce::roundToInt(value);
            return (v>0 ? "+" : "")+juce::String(v);
        };
        bendRange_.valueFromTextFunction=[](const juce::String& value) {
            return value.retainCharacters("0123456789.-").getDoubleValue();
        };
        const auto bendRanges=rangeGetter_?rangeGetter_():std::pair<float,float>{2.0f,-2.0f};
        bendRange_.setValue(bendRanges.first,juce::dontSendNotification);
        bendDownRange_.setValue(bendRanges.second,juce::dontSendNotification);
        bendRange_.onValueChange=[this]{
            if(rangeSetter_) rangeSetter_(static_cast<float>(bendRange_.getValue()),static_cast<float>(bendDownRange_.getValue()));
        };
        bendDownRange_.onValueChange=[this]{
            if(rangeSetter_) rangeSetter_(static_cast<float>(bendRange_.getValue()),static_cast<float>(bendDownRange_.getValue()));
        };
        addAndMakeVisible(voiceMode_);addAndMakeVisible(priority_);addAndMakeVisible(legato_);addAndMakeVisible(glide_);
        voiceMode_.setName("PERFORMANCE CHOICE BUTTON");voiceMode_.setTooltip("Voice mode");
        priority_.setName("PERFORMANCE CHOICE BUTTON");priority_.setTooltip("Mono note priority");
        legato_.setButtonText("LEGATO");legato_.setClickingTogglesState(true);legato_.setTooltip("Legato envelope behavior");
        // V23.4.5: native Origami rotary glide control.
        glide_.setName("Glide");
        glide_.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        glide_.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
        glide_.setRange(0.0,5.0,0.001);
        glide_.setRotaryParameters(juce::MathConstants<float>::pi*1.25f,
                                   juce::MathConstants<float>::pi*2.75f,true);
        glide_.setScrollWheelEnabled(false);
        glide_.setDoubleClickReturnValue(true,0.0);
        glide_.setTooltip("Glide time — drag vertically; double-click for off");
        glide_.textFromValueFunction=[](double v){return v<0.001?"OFF":juce::String(v,3);};
        const auto initialPerformance=performanceGetter_?performanceGetter_():mct::origami::PerformanceState{};
        voiceModeId_=initialPerformance.voiceMode==mct::origami::VoiceMode::Mono?2:1;
        priorityId_=initialPerformance.notePriority==mct::origami::NotePriority::High?2:initialPerformance.notePriority==mct::origami::NotePriority::Low?3:1;
        voiceMode_.setButtonText(voiceModeId_==2?"MONO":"POLY");
        priority_.setButtonText(priorityId_==2?"HIGH":priorityId_==3?"LOW":"LAST");
        legato_.setToggleState(initialPerformance.legato,juce::dontSendNotification);glide_.setValue(initialPerformance.glideSeconds,juce::dontSendNotification);
        auto commit=[this]{
            if(!performanceSetter_) return;
            auto performance=performanceGetter_?performanceGetter_():mct::origami::PerformanceState{};
            performance.voiceMode=voiceModeId_==2?mct::origami::VoiceMode::Mono:mct::origami::VoiceMode::Poly;
            performance.notePriority=priorityId_==2?mct::origami::NotePriority::High:priorityId_==3?mct::origami::NotePriority::Low:mct::origami::NotePriority::Last;
            performance.legato=legato_.getToggleState();performance.glideSeconds=static_cast<float>(glide_.getValue());performanceSetter_(performance);
        };
        voiceMode_.onClick=[this,commit]{
            const std::vector<NativeChoiceItem> items={{1,"POLY",true,"",voiceModeId_==1},{2,"MONO",true,"",voiceModeId_==2}};
            showNativeChoiceMenu(voiceMode_,"Voice mode",items,voiceModeId_,[this,commit](int id){
                if(id<1||id>2) return; voiceModeId_=id; voiceMode_.setButtonText(id==2?"MONO":"POLY"); commit();
            });
        };
        priority_.onClick=[this,commit]{
            const std::vector<NativeChoiceItem> items={{1,"LAST",true,"",priorityId_==1},{2,"HIGH",true,"",priorityId_==2},{3,"LOW",true,"",priorityId_==3}};
            showNativeChoiceMenu(priority_,"Note priority",items,priorityId_,[this,commit](int id){
                if(id<1||id>3) return; priorityId_=id; priority_.setButtonText(id==2?"HIGH":id==3?"LOW":"LAST"); commit();
            });
        };
        legato_.onClick=commit;glide_.onValueChange=commit;
        addAndMakeVisible(arpEnable_);
        addAndMakeVisible(arpSettings_);
        addAndMakeVisible(arpClockSummary_);
        addAndMakeVisible(arpPatternSummary_);
        arpEnable_.setButtonText("ARP");
        arpEnable_.setClickingTogglesState(true);
        arpEnable_.setTooltip("Enable arpeggiator");
        arpClockSummary_.setJustificationType(juce::Justification::centred);
        arpClockSummary_.setColour(juce::Label::textColourId,Palette::secondary());
        arpClockSummary_.setFont(juce::FontOptions(Type::secondary));
        arpPatternSummary_.setJustificationType(juce::Justification::centred);
        arpPatternSummary_.setColour(juce::Label::textColourId,Palette::muted());
        arpPatternSummary_.setFont(juce::FontOptions(Type::secondary));
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

    NoteSetter noteSetter_;
    WheelSetter pitchSetter_,modSetter_;RangeSetter rangeSetter_;RangeGetter rangeGetter_;
    PerformanceSetter performanceSetter_;PerformanceGetter performanceGetter_;
    ArpSetter arpSetter_;ArpGetter arpGetter_;
    juce::Slider bendRange_,bendDownRange_,glide_;
    juce::TextButton voiceMode_,priority_;
    int voiceModeId_=1,priorityId_=1;
    juce::ToggleButton legato_,arpEnable_;
    ArpSettingsIconButton arpSettings_;
    juce::Label arpClockSummary_,arpPatternSummary_;
    int mouseNote_=-1;int activeWheel_=0;float pitchValue_=0.0f,modValue_=0.0f;
    static constexpr int firstMidiNote=48;
    // V23.1.1: four-octave bed for thinner workstation-style keys.
    // V23.1.2: five-octave visual density; compact workstation-style keys.
    static constexpr int whiteKeyCount=35;
};
}
