// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-page-foundation-p01
// mct-origami-v34.5.0-ui-rebrand
// mct-origami-v25.1.0-arp-advanced-page
#include "OrigamiHeader.h"
#include <BinaryData.h>
#include "NativeChoiceMenu.h"
namespace mct::origami::ui {
OrigamiHeader::OrigamiHeader() {
    // V34.5: one authoritative, precomposed MCT Origami header asset.
    // BinaryData keeps AU/VST3/Standalone independent of runtime disk paths.
    logo_=juce::ImageCache::getFromMemory(BinaryData::oragami_header_png,
                                         BinaryData::oragami_header_pngSize);
    wordmark_={};
    addAndMakeVisible(panic_);
    panic_.onClick=[this] { if(onPanicRequested) onPanicRequested(); panic_.confirm(); };
    for(auto* button:{&previous_,&next_,&preset_,&browse_,&save_,&settings_}) addAndMakeVisible(button);
    // mct-origami-content-browser: the preset controls are live.
    preset_.setName("PRESET NAME"); previous_.setName("PRESET PREVIOUS"); next_.setName("PRESET NEXT"); save_.setName("PRESET SAVE"); browse_.setName("PRESET BROWSE");
    preset_.setTooltip("Browse presets"); browse_.setTooltip("Browse presets");
    previous_.setTooltip("Previous preset"); next_.setTooltip("Next preset");
    save_.setTooltip("Save the current sound as a user preset");
    preset_.onClick=[this]{ if(onPresetBrowserRequested) onPresetBrowserRequested(); };
    browse_.onClick=[this]{ if(onPresetBrowserRequested) onPresetBrowserRequested(); };
    previous_.onClick=[this]{ if(onPresetStep) onPresetStep(-1); };
    next_.onClick=[this]{ if(onPresetStep) onPresetStep(1); };
    save_.onClick=[this]{ if(onSaveRequested) onSaveRequested(); };
    // The "..." utility menu: global tools reachable from every page.
    settings_.setEnabled(true);
    settings_.setName("Origami utility menu");
    settings_.onClick=[this] {
        auto safe=juce::Component::SafePointer<OrigamiHeader>(this);
        showNativeChoiceMenu(settings_,"UTILITIES",utilityMenuItems(),0,[safe](int choice) {
            if(safe!=nullptr) safe->chooseUtility(choice);
        });
    };
    const juce::StringArray labels{"SYNTH","MIXER","NODES","MATRIX","GLOBAL"};
    for(int i=0;i<5;++i) {auto& button=modes_[static_cast<std::size_t>(i)];button.setButtonText(labels[i]);button.setToggleState(i==0,juce::dontSendNotification);button.setEnabled(i==0 || i==2 || i==3 || i==4);button.setTooltip(i==0?"Synthesizer":i==2?"Effect routing":i==3?"Modulation routing":i==4?"Global visualization settings":"Not implemented");addAndMakeVisible(button);
        button.onClick=[this,i] {for(std::size_t j=0;j<modes_.size();++j) modes_[j].setToggleState(j==static_cast<std::size_t>(i),juce::dontSendNotification);if(onModeSelected) onModeSelected(i);};}
}
std::vector<NativeChoiceItem> OrigamiHeader::utilityMenuItems() const {
    NativeChoiceItem capture{captureKeyboardItem,"CAPTURE KEYBOARD INPUT",true,{},preferences_->captureKeyboardInput()};
    capture.tooltip="Off: keys go to the host (e.g. Logic Musical Typing). On: Origami shortcuts (NODES A, Tab, F, Delete, Cmd+Z...).";
    return {{initPresetItem,"INIT PRESET",true,{},false,"Return to the factory INIT sound",{}},{globalFxItem,"Global FX...",true,"FX"},capture};
}
void OrigamiHeader::chooseUtility(int item) {
    if(item==globalFxItem && onGlobalFxRequested) onGlobalFxRequested();
    if(item==initPresetItem && onInitRequested) onInitRequested();
    if(item==captureKeyboardItem) preferences_->setCaptureKeyboardInput(!preferences_->captureKeyboardInput());
}
void OrigamiHeader::setPresetName(const juce::String& name) {
    const auto label=name.isNotEmpty() ? name : juce::String("UNTITLED");
    if(preset_.getButtonText()!=label) preset_.setButtonText(label);
}
void OrigamiHeader::selectSynth() {
    for(std::size_t i=0;i<modes_.size();++i)
        modes_[i].setToggleState(i==0,juce::dontSendNotification);
}
void OrigamiHeader::selectMode(int mode) {
    if(mode<0 || mode>=static_cast<int>(modes_.size()) || !modes_[static_cast<std::size_t>(mode)].isEnabled()) return;
    for(std::size_t j=0;j<modes_.size();++j) modes_[j].setToggleState(j==static_cast<std::size_t>(mode),juce::dontSendNotification);
    if(onModeSelected) onModeSelected(mode);
}
int OrigamiHeader::modeAt(juce::Point<int> p) const noexcept {
    for(std::size_t i=0;i<modes_.size();++i) if(modes_[i].getBounds().contains(p)) return static_cast<int>(i);
    return -1;
}
bool OrigamiHeader::modeEnabled(int mode) const noexcept {
    return mode>=0 && mode<static_cast<int>(modes_.size()) && modes_[static_cast<std::size_t>(mode)].isEnabled();
}
void OrigamiHeader::paint(juce::Graphics& g) {
    // Supplied artwork is 800x182. Display the complete composition without
    // cropping or stretching inside the existing 72px header.
    const juce::Rectangle<int> brandBounds{10,4,286,64};
    if(logo_.isValid()) {
        g.setImageResamplingQuality(juce::Graphics::highResamplingQuality);
        g.drawImageWithin(logo_,brandBounds.getX(),brandBounds.getY(),
                          brandBounds.getWidth(),brandBounds.getHeight(),
                          (juce::RectanglePlacement::xLeft | juce::RectanglePlacement::yMid) |
                          juce::RectanglePlacement::onlyReduceInSize);
    }

    g.setColour(Palette::borderSoft());
    g.drawHorizontalLine(getHeight()-1,0.f,float(getWidth()));
}
void OrigamiHeader::resized() {
    auto area=getLocalBounds().withTrimmedLeft(324).reduced(0,10);
    auto utilities=area.removeFromRight(juce::jmin(236,area.getWidth()/3));
    settings_.setBounds(utilities.removeFromRight(34).reduced(2,6));
    panic_.setBounds(utilities.removeFromRight(64).reduced(2,6));
    save_.setBounds(utilities.removeFromRight(55).reduced(2,6));browse_.setBounds(utilities.reduced(2,6));
    area.removeFromRight(10);auto modes=area.removeFromRight(300);for(auto& mode:modes_)mode.setBounds(modes.removeFromLeft(60).reduced(1,6));
    area.removeFromRight(14);previous_.setBounds(area.removeFromLeft(27).reduced(0,6));next_.setBounds(area.removeFromRight(27).reduced(0,6));preset_.setBounds(area.reduced(3,6));
}
}
