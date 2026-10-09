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
    for(auto* button:std::array<juce::Button*,6>{&previous_,&next_,&preset_,&undo_,&redo_,&settings_}) addAndMakeVisible(button);
    // mct-origami-content-browser: the preset controls are live.
    preset_.setName("PRESET NAME"); previous_.setName("PRESET PREVIOUS"); next_.setName("PRESET NEXT");
    preset_.setTooltip("Browse presets");
    previous_.setTooltip("Previous preset"); next_.setTooltip("Next preset");
    previous_.setGlyphFraction(.25f);next_.setGlyphFraction(.25f);
    undo_.setGlyphFraction(.44f);redo_.setGlyphFraction(.44f);
    undo_.setTooltip("Undo (Cmd+Z)");redo_.setTooltip("Redo (Cmd+Shift+Z)");
    undo_.onClick=[this]{chooseUtility(undoItem);refreshHistoryState();};
    redo_.onClick=[this]{chooseUtility(redoItem);refreshHistoryState();};
    undo_.setEnabled(false);redo_.setEnabled(false);
    preset_.onClick=[this]{ if(onPresetBrowserRequested) onPresetBrowserRequested(); };
    previous_.onClick=[this]{ if(onPresetStep) onPresetStep(-1); };
    next_.onClick=[this]{ if(onPresetStep) onPresetStep(1); };
    // The consolidated application menu: global tools reachable from every page.
    settings_.setEnabled(true);
    settings_.setName("Origami menu");
    settings_.setTooltip("Undo, redo, presets and utilities");
    settings_.onClick=[this] {
        auto safe=juce::Component::SafePointer<OrigamiHeader>(this);
        showNativeChoiceMenu(settings_,"ORIGAMI",utilityMenuItems(),0,[safe](int choice) {
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
    return {{undoItem,"Undo",canUndo && canUndo(),{},false,"Undo the last document edit",{}},
        {redoItem,"Redo",canRedo && canRedo(),{},false,"Redo the last document edit",{}},
        {0,{},false,{}},{browseItem,"Browse Presets",bool(onPresetBrowserRequested),{}},{saveItem,"Save Preset",bool(onSaveRequested),{}},
        {initPresetItem,"INIT PRESET",true,{},false,"Return to the factory INIT sound",{}},
        {0,{},false,{}},{globalFxItem,"Global FX...",true,{}},capture};
}
void OrigamiHeader::chooseUtility(int item) {
    if(item==undoItem && canUndo && canUndo() && onUndo)onUndo();
    if(item==redoItem && canRedo && canRedo() && onRedo)onRedo();
    if(item==browseItem && onPresetBrowserRequested)onPresetBrowserRequested();
    if(item==saveItem && onSaveRequested)onSaveRequested();
    if(item==globalFxItem && onGlobalFxRequested) onGlobalFxRequested();
    if(item==initPresetItem && onInitRequested) onInitRequested();
    if(item==captureKeyboardItem) preferences_->setCaptureKeyboardInput(!preferences_->captureKeyboardInput());
}
void OrigamiHeader::refreshHistoryState() {undo_.setEnabled(canUndo && canUndo());redo_.setEnabled(canRedo && canRedo());}
void OrigamiHeader::setPresetName(const juce::String& name) {
    const auto label=name.isNotEmpty() ? name : juce::String("UNTITLED");
    if(preset_.getButtonText()!=label) preset_.setButtonText(label);
}
void OrigamiHeader::assignmentDragStarted() {panic_.beginDrag();}
void OrigamiHeader::assignmentDragEnded() {panic_.endDrag();}
void OrigamiHeader::reconcileAssignmentDragFocus() {panic_.reconcileDragFocus();}
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
    // The editor scales a 1440px design canvas; the same proportional groups
    // also keep a directly resized header valid at its supported minimum width.
    const float scale=juce::jmin(1.f,float(getWidth())/960.f);
    const int brand=juce::roundToInt(324.f*scale),cell=juce::roundToInt(34.f*scale);
    auto area=getLocalBounds().withTrimmedLeft(brand).reduced(0,10);
    settings_.setBounds(area.removeFromRight(cell).reduced(2,6));
    area.removeFromRight(6);
    redo_.setBounds(area.removeFromRight(cell).reduced(1,6));
    undo_.setBounds(area.removeFromRight(cell).reduced(1,6));
    area.removeFromRight(10);
    auto navigation=area.removeFromRight(juce::roundToInt(300.f*scale));
    for(auto& mode:modes_)mode.setBounds(navigation.removeFromLeft(juce::roundToInt(60.f*scale)).reduced(1,6));
    area.removeFromRight(14);
    // Cap the selector instead of absorbing all recovered space. The remainder
    // is intentional breathing room between preset and page navigation.
    auto presetGroup=area.removeFromLeft(juce::jmin(area.getWidth(),360));
    previous_.setBounds(presetGroup.removeFromLeft(27).reduced(0,6));
    next_.setBounds(presetGroup.removeFromRight(27).reduced(0,6));
    preset_.setBounds(presetGroup.reduced(3,6));
    panic_.setBounds(10,4,286,64);
}
}
