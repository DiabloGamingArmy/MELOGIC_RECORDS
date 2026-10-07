// mct-origami-v25.1.0-arp-advanced-page
#pragma once
#include "OrigamiStyle.h"
#include "NativeChoiceMenu.h"
#include "UserPreferences.h"
namespace mct::origami::ui {
class OrigamiHeader final : public juce::Component {
public:
    OrigamiHeader();
    std::function<void(int)> onModeSelected;
    // mct-origami-fx-modulation-graph-ux-p03
    std::function<void()> onGlobalFxRequested;
    std::function<void()> onPanicRequested;
    void selectSynth();
    // Programmatic page switch (cross-page modulation drag); notifies onModeSelected.
    void selectMode(int mode);
    // Navigation tab bounds in header coordinates; -1 when none is under the point.
    int modeAt(juce::Point<int>) const noexcept;
    bool modeEnabled(int mode) const noexcept;
    // mct-origami-nested-modulation-manual-qa: the "..." utility menu's items
    // and their action (also used by tests). CAPTURE KEYBOARD INPUT is a
    // per-user preference shared by every instance, never patch state.
    enum UtilityItem { globalFxItem=1, captureKeyboardItem=2, initPresetItem=3 };
    // mct-origami-content-browser: the preset name opens the PRESETS browser;
    // < > step through the browser's current results; SAVE saves with metadata.
    std::function<void()> onPresetBrowserRequested,onSaveRequested,onInitRequested;
    std::function<void(int)> onPresetStep;
    void setPresetName(const juce::String&);
    juce::String presetName() const { return preset_.getButtonText(); }
    std::vector<NativeChoiceItem> utilityMenuItems() const;
    void chooseUtility(int item);
    void paint(juce::Graphics&) override;
    void resized() override;
private:
    // The identity is the emergency surface, revealed on hover or keyboard focus.
    class PanicButton final : public juce::Button,private juce::Timer {
    public:
        PanicButton():juce::Button("Emergency DSP reset") { setTooltip("PANIC: silence every voice and clear effect tails; the patch is kept"); }
        void focusGained(FocusChangeType cause) override { juce::Button::focusGained(cause); keyboardFocus_=cause!=focusChangedByMouseClick; repaint(); }
        void focusLost(FocusChangeType cause) override { juce::Button::focusLost(cause); keyboardFocus_=false; repaint(); }
        void confirm() { confirmed_=true; startTimer(500); repaint(); }
        void paintButton(juce::Graphics& g,bool over,bool down) override {
            if(!over && !down && !keyboardFocus_) return;
            g.setColour(Palette::background().withAlpha(.78f));
            g.fillRect(getLocalBounds());
            auto bounds=getLocalBounds().toFloat().withSizeKeepingCentre(140.f,36.f);
            g.setColour(confirmed_ ? signalShade(.55f,.9f) : down ? signalShade(.7f,.95f) : over ? signalShade(.35f,.9f) : Palette::raised());
            g.fillRect(bounds);
            g.setColour(confirmed_ || over ? signalSourceColour() : Palette::borderSoft());
            g.drawRect(bounds,1.0f);
            g.setColour(Palette::text());
            g.setFont(juce::FontOptions(Type::control));
            g.drawText(confirmed_ ? "DSP RESET" : "STOP / PANIC",bounds,juce::Justification::centred);
        }
    private:
        void timerCallback() override { stopTimer(); confirmed_=false; repaint(); }
        bool confirmed_=false,keyboardFocus_=false;
    } panic_;
    juce::TextButton previous_{"<"},next_{">"},preset_{"Init"},browse_{"BROWSE"},save_{"SAVE"},settings_{"..."};
    std::array<juce::TextButton,5> modes_;
    juce::Image logo_;
    juce::Image wordmark_;
    juce::SharedResourcePointer<UserPreferences> preferences_;
};
}
