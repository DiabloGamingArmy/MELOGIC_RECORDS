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
    void selectSynth();
    // Programmatic page switch (cross-page modulation drag); notifies onModeSelected.
    void selectMode(int mode);
    // Navigation tab bounds in header coordinates; -1 when none is under the point.
    int modeAt(juce::Point<int>) const noexcept;
    bool modeEnabled(int mode) const noexcept;
    // mct-origami-nested-modulation-manual-qa: the "..." utility menu's items
    // and their action (also used by tests). CAPTURE KEYBOARD INPUT is a
    // per-user preference shared by every instance, never patch state.
    enum UtilityItem { globalFxItem=1, captureKeyboardItem=2 };
    std::vector<NativeChoiceItem> utilityMenuItems() const;
    void chooseUtility(int item);
    void paint(juce::Graphics&) override;
    void resized() override;
private:
    juce::TextButton previous_{"<"},next_{">"},preset_{"Init"},browse_{"BROWSE"},save_{"SAVE"},settings_{"..."};
    std::array<juce::TextButton,5> modes_;
    juce::Image logo_;
    juce::Image wordmark_;
    juce::SharedResourcePointer<UserPreferences> preferences_;
};
}
