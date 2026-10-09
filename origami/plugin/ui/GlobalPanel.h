#pragma once
#include "OrigamiStyle.h"
#include "VisualizationSettings.h"
#include "OrigamiHeader.h"
#include "../../core/InstrumentState.h"
#include <array>
#include <functional>
#include <melogic/account/AccountService.h>

namespace mct::origami::ui {
struct GlobalEngineInfo {
    double sampleRate=0;
    int blockSize=0,maximumBlockSize=0;
    unsigned activeVoices=0,maximumVoices=0;
    float audioLoad=0;
    bool loadAvailable=false;
};
struct GlobalPanelHost {
    std::function<float()> master;
    std::function<void(float)> setMaster;
    std::function<FinalOutputMeters()> meters;
    std::function<PerformanceState()> performance;
    std::function<bool(const PerformanceState&)> setPerformance;
    std::function<bool(float,float)> setBend;
    std::function<GlobalEngineInfo()> engine;
    std::function<void()> panic;
};
class GlobalPanel final : public Panel {
public:
    using Getter=std::function<std::uint32_t()>;
    using Setter=std::function<void(std::uint32_t)>;
    GlobalPanel(Getter,Setter,GlobalPanelHost={});
    void resized() override;
    void syncFromModel();
    juce::Slider& masterKnob() noexcept {return master_.knob();}
    FinalOutputMeters displayedMeters() const noexcept {return master_.displayedMeters();}
    static juce::String version();
    static juce::String buildIdentity();
    static juce::String architecture();
    void showSettings(bool);
    bool settingsOpen() const noexcept {return settingsOpen_;}
    void chooseVoiceMode(VoiceMode);
    void choosePriority(NotePriority);
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    void updateButton(std::size_t,bool);
    Getter getter_;
    Setter setter_;
    GlobalPanelHost host_;
    MasterOutputControl master_{true};
    std::array<juce::TextButton,8> toggles_;
    juce::TextButton voiceMode_,priority_,settings_{"SETTINGS"},panic_{"PANIC / ALL NOTES OFF"};
    juce::ToggleButton legato_{"LEGATO"},capture_{"CAPTURE KEYBOARD INPUT"};
    juce::Slider glide_,bendUp_,bendDown_;
    juce::Label identity_,rate_,block_,voices_,load_;
    juce::Image wordmark_;
    std::shared_ptr<melogic::account::Service> account_=melogic::account::Service::shared();
    juce::Label accountIdentity_;
    juce::TextButton accountAction_{"SIGN IN TO MELOGIC"},accountSecondary_{"LOG OUT"};
    GlobalEngineInfo engineInfo_{};
    juce::SharedResourcePointer<UserPreferences> preferences_;
    bool syncing_=false,settingsOpen_=false;
};
}
