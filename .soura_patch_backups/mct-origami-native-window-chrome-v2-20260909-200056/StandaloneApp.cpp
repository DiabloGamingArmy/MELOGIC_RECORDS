#include <JuceHeader.h>

// MCT Origami standalone wrapper.
//
// Plugin hosts (Logic/VST3 hosts) own their own native windows. This file only
// changes the standalone application's top-level window so macOS supplies the
// normal system title bar and traffic-light controls.

namespace
{
class OrigamiStandaloneApplication final : public juce::JUCEApplication
{
public:
    OrigamiStandaloneApplication()
    {
        juce::PropertiesFile::Options options;
        options.applicationName = "MCT Origami";
        options.filenameSuffix = ".settings";
        options.osxLibrarySubFolder = "Application Support";
        properties_.setStorageParameters(options);
    }

    const juce::String getApplicationName() override { return "MCT Origami"; }
    const juce::String getApplicationVersion() override { return JucePlugin_VersionString; }
    bool moreThanOneInstanceAllowed() override { return true; }
    void anotherInstanceStarted(const juce::String&) override {}

    void initialise(const juce::String&) override
    {
        window_ = std::make_unique<juce::StandaloneFilterWindow>(
            getApplicationName(),
            juce::LookAndFeel::getDefaultLookAndFeel()
                .findColour(juce::ResizableWindow::backgroundColourId),
            properties_.getUserSettings(),
            false);

        // Use native OS window chrome instead of JUCE's custom title bar.
        window_->setUsingNativeTitleBar(true);
        window_->setTitleBarButtonsRequired(
            juce::DocumentWindow::allButtons,
            false);
        window_->setResizable(true, true);
        window_->setVisible(true);
    }

    void shutdown() override
    {
        window_.reset();
        properties_.saveIfNeeded();
    }

    void systemRequestedQuit() override
    {
        quit();
    }

private:
    juce::ApplicationProperties properties_;
    std::unique_ptr<juce::StandaloneFilterWindow> window_;
};
}

START_JUCE_APPLICATION(OrigamiStandaloneApplication)
