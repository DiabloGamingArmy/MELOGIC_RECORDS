// mct-origami-nested-modulation-manual-qa
#include "UserPreferences.h"
#include <atomic>

namespace mct::origami::ui {
namespace {
std::atomic<bool> volatileStorage{false};
constexpr const char* captureKeyboardKey="captureKeyboardInput";
juce::PropertiesFile::Options storageOptions() {
    juce::PropertiesFile::Options options;
    options.applicationName="Preferences";
    options.folderName="MCT Origami";
    options.filenameSuffix=".settings";
    options.osxLibrarySubFolder="Application Support";
    options.storageFormat=juce::PropertiesFile::storeAsXML;
    return options;
}
}

UserPreferences::UserPreferences() {
    if(volatileStorage.load()) return;
    file_=std::make_unique<juce::PropertiesFile>(storageOptions());
    captureKeyboardInput_=file_->getBoolValue(captureKeyboardKey,false);
}

UserPreferences::UserPreferences(const juce::File& storage) {
    file_=std::make_unique<juce::PropertiesFile>(storage,storageOptions());
    captureKeyboardInput_=file_->getBoolValue(captureKeyboardKey,false);
}

UserPreferences::~UserPreferences() {
    if(file_!=nullptr) file_->saveIfNeeded();
}

void UserPreferences::setCaptureKeyboardInput(bool capture) {
    if(capture==captureKeyboardInput_) return;
    captureKeyboardInput_=capture;
    if(file_!=nullptr) { file_->setValue(captureKeyboardKey,capture); file_->saveIfNeeded(); }
    sendChangeMessage();
}

void UserPreferences::useVolatileStorageForTesting() noexcept { volatileStorage.store(true); }

bool captureKeyboardInput() {
    // Every open editor holds the shared instance, so this never reloads
    // the file while Origami is on screen.
    const juce::SharedResourcePointer<UserPreferences> preferences;
    return preferences->captureKeyboardInput();
}

}
