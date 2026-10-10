#pragma once
#include "OrigamiStyle.h"
namespace mct::origami::ui {
// Pure UI handoff. Dimming is painted once per repaint; no snapshots/blur loop,
// entitlement state, patch data or audio-thread interaction.
class WelcomeOverlay final : public juce::Component {
public:
    WelcomeOverlay(){
        setName("Origami activation welcome");setInterceptsMouseClicks(true,true);
        setWantsKeyboardFocus(true);setFocusContainerType(FocusContainerType::keyboardFocusContainer);
        addAndMakeVisible(continue_);continue_.setName("Welcome Continue");
        continue_.onClick=[this]{setVisible(false);if(onContinue)onContinue();};
    }
    std::function<void()> onContinue;
    void present(){setVisible(true);toFront(false);if(isShowing())continue_.grabKeyboardFocus();repaint();}
    bool keyPressed(const juce::KeyPress& key) override {
        if(key==juce::KeyPress::returnKey || key==juce::KeyPress::spaceKey){continue_.onClick();return true;}
        return true;
    }
    void resized() override {continue_.setBounds(panel().withTrimmedTop(151).reduced(32,0).withHeight(30));}
    void paint(juce::Graphics& g) override {
        g.fillAll(juce::Colours::black.withAlpha(.72f));const auto b=panel();
        g.setColour(Palette::panel());g.fillRect(b);g.setColour(Palette::borderSoft());g.drawRect(b);
        g.setColour(Palette::text());g.setFont(juce::FontOptions(Type::title));
        g.drawText("WELCOME TO ORIGAMI",b.withTrimmedTop(29).withHeight(25),juce::Justification::centred);
        g.setFont(juce::FontOptions(Type::control));
        g.drawText("Your copy of Origami has been activated.",b.withTrimmedTop(77).withHeight(24),juce::Justification::centred);
    }
private:
    juce::Rectangle<int> panel() const {return getLocalBounds().withSizeKeepingCentre(juce::jmin(420,getWidth()-32),214);}
    juce::TextButton continue_{"CONTINUE"};
};
}
