#include <JuceHeader.h>
#include <juce_audio_plugin_client/Standalone/juce_StandaloneFilterWindow.h>
#include "PluginProcessor.h"

// mct-origami-native-window-chrome-v2
// StandaloneFilterWindow lives in the plugin-client Standalone header;
// JuceHeader alone does not declare it in a custom standalone app.

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
        // Standalone policy: always boot the synth itself from canonical Init.
        // JUCE's audio-device settings remain persistent; only the saved plugin
        // state blob is discarded before StandaloneFilterWindow can restore it.
        if(auto* settings=properties_.getUserSettings()) {
            settings->removeValue("filterState");
            settings->removeValue("pluginState");
            settings->removeValue("state");
            settings->saveIfNeeded();
        }

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

        // P0 diagnostic only: report the exact processor boundary that the
        // JUCE standalone/device bridge is driving. No DSP or device settings
        // are changed here.
        diagnosticTimer_.startTimer(2000);
    }

    void timerCallback()
    {
        if(window_==nullptr) return;
        auto* processor=dynamic_cast<OrigamiAudioProcessor*>(window_->getAudioProcessor());
        if(processor==nullptr) return;
        const auto d=processor->getAudioContinuityDiagnostics();
        std::cout << "[Origami P0 runtime] sr=" << d.preparedSampleRate
                  << " preparedBlock=" << d.preparedBlockSize
                  << " callback=" << d.lastCallbackSamples
                  << " range=" << d.minCallbackSamples << ".." << d.maxCallbackSamples
                  << " channels=" << d.lastOutputChannels
                  << " callbacks=" << d.callbacks
                  << " spanFail=" << d.processSpanFailures
                  << " beginFail=" << d.beginHostBlockFailures
                  << " zero=" << d.zeroOutputCallbacks
                  << " peak=" << d.outputPeak
                  << " maxDelta=" << d.maxAdjacentDelta
                  << " nonFinite=" << d.nonFiniteOutputSamples
                  << " deadlineMiss=" << processor->getUiRenderBudgetSnapshot().deadlineMisses
                  << std::endl;
    }

    void shutdown() override
    {
        diagnosticTimer_.stopTimer();
        window_.reset();
        // StandaloneFilterWindow may save the processor state while tearing
        // down. Remove only that state again so the next launch is Init while
        // device/sample-rate/buffer preferences remain remembered.
        if(auto* settings=properties_.getUserSettings()) {
            settings->removeValue("filterState");
            settings->removeValue("pluginState");
            settings->removeValue("state");
            settings->saveIfNeeded();
        }
        properties_.saveIfNeeded();
    }

    void systemRequestedQuit() override
    {
        quit();
    }

private:
    class DiagnosticTimer final : public juce::Timer {
    public:
        explicit DiagnosticTimer(OrigamiStandaloneApplication& owner):owner_(owner) {}
        void timerCallback() override { owner_.timerCallback(); }
    private:
        OrigamiStandaloneApplication& owner_;
    } diagnosticTimer_{*this};
    juce::ApplicationProperties properties_;
    std::unique_ptr<juce::StandaloneFilterWindow> window_;
};
}

START_JUCE_APPLICATION(OrigamiStandaloneApplication)
