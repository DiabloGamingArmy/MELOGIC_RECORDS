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
    // Emergency DSP reset: always visible in the utility strip (an emergency
    // control must be findable); the product logo is never a control.
    class PanicButton final : public juce::Button,private juce::Timer {
    public:
        PanicButton():juce::Button("Emergency DSP reset") { setTooltip("PANIC: silence every voice and clear effect tails; the patch is kept"); }
        void confirm() { confirmed_=true; startTimer(500); repaint(); }
        void paintButton(juce::Graphics& g,bool over,bool down) override {
            auto bounds=getLocalBounds().toFloat().reduced(.5f);
            g.setColour(confirmed_ ? signalShade(.55f,.9f) : down ? signalShade(.7f,.95f) : over ? signalShade(.35f,.9f) : Palette::raised());
            g.fillRect(bounds);
            g.setColour(confirmed_ || over ? signalSourceColour() : Palette::borderSoft());
            g.drawRect(bounds,1.0f);
            g.setColour(Palette::text());
            g.setFont(juce::FontOptions(Type::control));
            g.drawText(confirmed_ ? "RESET" : "PANIC",getLocalBounds(),juce::Justification::centred);
        }
    private:
        void timerCallback() override { stopTimer(); confirmed_=false; repaint(); }
        bool confirmed_=false;
    } panic_;
    juce::TextButton previous_{"<"},next_{">"},preset_{"Init"},browse_{"BROWSE"},save_{"SAVE"},settings_{"..."};
    std::array<juce::TextButton,5> modes_;
    juce::Image logo_;
    juce::Image wordmark_;
    juce::SharedResourcePointer<UserPreferences> preferences_;
};
}
