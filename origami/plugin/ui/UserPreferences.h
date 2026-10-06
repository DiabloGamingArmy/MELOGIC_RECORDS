// mct-origami-nested-modulation-manual-qa
#pragma once
#include <JuceHeader.h>

// Per-user plugin preferences: never part of a patch, shared by every
// instance and format (Standalone, AU, VST3) of this user. Stored in
// ~/Library/Application Support/MCT Origami/Preferences.settings, a separate
// file from the Standalone's audio-device settings. Message thread only.
namespace mct::origami::ui {

class UserPreferences final : public juce::ChangeBroadcaster {
public:
    UserPreferences();
    // A specific settings file (tests: a temporary file, never the user's).
    explicit UserPreferences(const juce::File& storage);
    ~UserPreferences() override;

    // CAPTURE KEYBOARD INPUT (default OFF). OFF: Origami handles no keyboard
    // shortcuts, so the keys reach the host (Logic's Musical Typing, DAW
    // shortcuts). A text field the user clicked still takes typing, and
    // Escape still closes an open Origami popup or editor. ON: Origami's
    // shortcuts work (NODES A / Tab / F / Delete / Cmd+Z ...).
    bool captureKeyboardInput() const noexcept { return captureKeyboardInput_; }
    void setCaptureKeyboardInput(bool);

    // Tests: keep preferences in memory; the user's file is never touched.
    static void useVolatileStorageForTesting() noexcept;

private:
    std::unique_ptr<juce::PropertiesFile> file_;
    bool captureKeyboardInput_=false;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(UserPreferences)
};

// The shared preference, read wherever a key arrives.
bool captureKeyboardInput();

}
