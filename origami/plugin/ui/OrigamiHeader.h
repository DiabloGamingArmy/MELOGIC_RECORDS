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
    void assignmentDragStarted();
    void assignmentDragEnded();
    void reconcileAssignmentDragFocus();
    bool panicVisibleForPointer(bool inside) const noexcept {return panic_.reveal(inside);}
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
        void focusGained(FocusChangeType cause) override { juce::Button::focusGained(cause); keyboardFocus_=cause!=focusChangedByMouseClick && !dragFocusSuppressed_; repaint(); }
        void focusLost(FocusChangeType cause) override { if(auto* container=juce::DragAndDropContainer::findParentDragContainerFor(this)) if(container->isDragAndDropActive() && cause==focusChangedDirectly) keyboardBeforeDrag_=keyboardFocus_;juce::Button::focusLost(cause); keyboardFocus_=false; repaint(); }
        bool reveal(bool physicalHover) const noexcept {return physicalHover || keyboardFocus_;}
        void beginDrag() {restoreKeyboardFocus_=keyboardBeforeDrag_ || keyboardFocus_;keyboardBeforeDrag_=false;dragFocusSuppressed_=true;keyboardFocus_=false;++dragGeneration_;repaint();}
        void endDrag() {
            keyboardFocus_=false;repaint();const auto generation=dragGeneration_;
            juce::MessageManager::callAsync([safe=juce::Component::SafePointer<PanicButton>(this),generation] {
                if(safe) safe->reconcileDragFocus(generation);
            });
        }
        void reconcileDragFocus(unsigned generation) {
            if(dragGeneration_!=generation || !dragFocusSuppressed_) return;
            if(!restoreKeyboardFocus_ && hasKeyboardFocus(false)) giveAwayKeyboardFocus();
            dragFocusSuppressed_=false;if(restoreKeyboardFocus_) {grabKeyboardFocus();keyboardFocus_=hasKeyboardFocus(false);}repaint();
        }
        void reconcileDragFocus() {reconcileDragFocus(dragGeneration_);}
        void confirm() { confirmed_=true; startTimer(500); repaint(); }
        void paintButton(juce::Graphics& g,bool over,bool down) override {
            over=isShowing() && getLocalBounds().contains(getLocalPoint(nullptr,juce::Desktop::getMousePosition()));
            if(!reveal(over)) return;
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
        bool confirmed_=false,keyboardFocus_=false,keyboardBeforeDrag_=false,restoreKeyboardFocus_=false,dragFocusSuppressed_=false;
        unsigned dragGeneration_=0;
    } panic_;
    juce::TextButton previous_{"<"},next_{">"},preset_{"Init"},browse_{"BROWSE"},save_{"SAVE"},settings_{"..."};
    std::array<juce::TextButton,5> modes_;
    juce::Image logo_;
    juce::Image wordmark_;
    juce::SharedResourcePointer<UserPreferences> preferences_;
};
}
