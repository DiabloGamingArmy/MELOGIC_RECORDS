// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-page-foundation-p01
// mct-origami-v34.5.0-ui-rebrand
// mct-origami-v25.1.0-arp-advanced-page
#include "OrigamiHeader.h"
#include <BinaryData.h>
#include "NativeChoiceMenu.h"
namespace mct::origami::ui {
MasterOutputControl::MasterOutputControl(bool expanded) : expanded_(expanded) {
    knob_.setName("MASTER OUTPUT");
    knob_.setTooltip("Final Master Output gain (dB). Host automation only; no internal modulation.");
    knob_.setSliderStyle(juce::Slider::RotaryVerticalDrag);
    knob_.setScrollWheelEnabled(false);
    knob_.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    knob_.setRotaryParameters(juce::MathConstants<float>::pi*1.2f,juce::MathConstants<float>::pi*2.8f,true);
    knob_.setNormalisableRange(juce::NormalisableRange<double>{FinalOutputGain::floorDb,FinalOutputGain::maxDb,
        [](double,double,double p){return double(FinalOutputGain::db(float(p)));},
        [](double,double,double d){return double(FinalOutputGain::position(float(d)));}});
    knob_.textFromValueFunction=[](double d){return FinalOutputGain::text(FinalOutputGain::position(float(d)));};
    knob_.valueFromTextFunction=[](const juce::String& t){return double(FinalOutputGain::db(FinalOutputGain::fromText(t)));};
    knob_.getProperties().set("mct.origami.knobDefault",0.0);
    knob_.setValue(0,juce::dontSendNotification);
    addAndMakeVisible(knob_);
}
void MasterOutputControl::sync(float normalized,FinalOutputMeters meters) {
    if(!knob_.isMouseButtonDown())knob_.setValue(FinalOutputGain::db(normalized),juce::dontSendNotification);
    meters_=meters;repaint();
}
void MasterOutputControl::resized() {
    if(expanded_) {knob_.setBounds(22,getHeight()/2-50,88,88);return;}
    const float scale=float(getWidth())/112.f;
    knob_.setBounds(juce::roundToInt(14.f*scale),13,juce::roundToInt(36.f*scale),36);
}
void MasterOutputControl::paint(juce::Graphics& g) {
    if(expanded_) {
        text(g,FinalOutputGain::text(FinalOutputGain::position(float(knob_.getValue()))),{8,getHeight()/2+42,116,26},17.f,Palette::text(),juce::Justification::centred);
        text(g,"FINAL OUTPUT",{8,getHeight()/2+70,116,18},Type::label,Palette::muted(),juce::Justification::centred);
        const float top=24.f,height=float(getHeight()-62),start=float(juce::jmax(166,getWidth()-132));
        const auto position=[](float v){return v>0 ? std::clamp((20.f*std::log10(v)+60.f)/66.f,0.f,1.f) : 0.f;};
        for(int db:{6,0,-12,-24,-36,-48,-60}) {
            const int y=juce::roundToInt(top+height*(1.f-float(db+60)/66.f));
            text(g,(db>0?"+":"")+juce::String(db),{int(start)-40,y-6,30,13},Type::secondary,Palette::muted(),juce::Justification::centredRight);
            g.setColour(Palette::borderSoft());g.drawHorizontalLine(y,start-4,start+65);
        }
        for(unsigned c=0;c<2;++c) {
            const float x=start+float(c)*44.f,width=18.f;
            text(g,c==0?"L":"R",{int(x)-8,0,34,18},Type::label,Palette::secondary(),juce::Justification::centred);
            const float db=meters_.level[c]>0 ? 20.f*std::log10(meters_.level[c]) : -1000.f;
            for(int n=0;n<33;++n) {
                const float threshold=-60.f+float(n+1)*2.f;
                const auto colour=threshold<=-12 ? juce::Colour(0xff649b72) : threshold<=0 ? juce::Colour(0xffb7a25d) : juce::Colour(0xffb8564e);
                g.setColour(colour.withAlpha(db>=threshold ? .95f : .12f));
                g.fillRect(x,top+height-float(n+1)*height/33.f,width,juce::jmax(1.f,height/33.f-1.f));
            }
            if(meters_.hold[c]>0) {g.setColour(meters_.hold[c]>=1 ? juce::Colour(0xffb8564e) : Palette::secondary());g.fillRect(x,top+height*(1.f-position(meters_.hold[c])),width,1.5f);}
            const auto peak=meters_.hold[c]>0 ? juce::String(20.f*std::log10(meters_.hold[c]),1) : juce::String::fromUTF8("-\xe2\x88\x9e");
            text(g,peak,{int(x)-16,getHeight()-28,50,18},Type::control,meters_.hold[c]>=1 ? juce::Colour(0xffb8564e) : Palette::secondary(),juce::Justification::centred);
        }
        text(g,"PEAK dBFS",{int(start)-10,getHeight()-11,88,11},Type::secondary,Palette::muted(),juce::Justification::centred);
        return;
    }

    const float scale=float(getWidth())/112.f;
    const int labelWidth=juce::roundToInt(66.f*scale);
    text(g,"MASTER",{0,0,labelWidth,12},10.5f,Palette::secondary(),juce::Justification::centred);
    text(g,FinalOutputGain::text(FinalOutputGain::position(float(knob_.getValue()))),{0,49,labelWidth,14},11.f,Palette::text(),juce::Justification::centred);
    for(unsigned c=0;c<2;++c) {
        const float x=(77.f+17.f*float(c))*scale,width=7.f*scale,top=14.f,height=44.f;
        text(g,c==0?"L":"R",{int(x-3),0,int(width+6),12},10.f,Palette::muted(),juce::Justification::centred);
        const auto level=[](float v){return v>0.f ? std::clamp((20.f*std::log10(v)+60.f)/60.f,0.f,1.f) : 0.f;};
        const float lit=level(meters_.level[c]);
        for(int segment=0;segment<15;++segment) {
            const float threshold=float(segment+1)/15.f;
            const auto colour=segment<10 ? juce::Colour(0xff649b72) : segment<13 ? juce::Colour(0xffb7a25d) : juce::Colour(0xffb8564e);
            g.setColour(colour.withAlpha(lit>=threshold ? .95f : .12f));
            g.fillRect(x,top+height-(segment+1)*height/15.f,width,height/15.f-1.f);
        }
        if(meters_.hold[c]>0.f) {
            g.setColour(meters_.hold[c]>=1.f ? juce::Colour(0xffb8564e) : Palette::secondary());
            g.fillRect(x,top+height*(1.f-level(meters_.hold[c])),width,1.f);
        }
    }
}
OrigamiHeader::OrigamiHeader() {
    // V34.5: one authoritative, precomposed MCT Origami header asset.
    // BinaryData keeps AU/VST3/Standalone independent of runtime disk paths.
    logo_=juce::ImageCache::getFromMemory(BinaryData::oragami_header_png,
                                         BinaryData::oragami_header_pngSize);
    wordmark_={};
    addAndMakeVisible(panic_);
    addAndMakeVisible(master_);
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
    for(int i=0;i<5;++i) {auto& button=modes_[static_cast<std::size_t>(i)];button.setButtonText(labels[i]);button.setToggleState(i==0,juce::dontSendNotification);button.setEnabled(i==0 || i==2 || i==3 || i==4);button.setTooltip(i==0?"Synthesizer":i==2?"Effect routing":i==3?"Modulation routing":i==4?"Master, performance, engine and settings":"Not implemented");addAndMakeVisible(button);
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
    const float compact=std::clamp(float(getWidth())/1440.f,2.f/3.f,1.f);
    const juce::Rectangle<int> brandBounds{juce::roundToInt(10*compact),4,juce::roundToInt(286*compact),64};
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
    // Left-to-right functional flow. The unused remainder flexes before the
    // permanent output group; design-canvas scaling preserves these ratios.
    const float compact=std::clamp(float(getWidth())/1440.f,2.f/3.f,1.f);
    const auto size=[compact](float width){return juce::roundToInt(width*compact);};
    auto area=getLocalBounds().withTrimmedLeft(size(324));
    settings_.setBounds(area.removeFromRight(size(34)).reduced(2,16));
    area.removeFromRight(size(8));
    master_.setBounds(area.removeFromRight(size(112)).reduced(0,4));
    auto presetGroup=area.removeFromLeft(size(414)).reduced(0,16);
    previous_.setBounds(presetGroup.removeFromLeft(size(27)));
    next_.setBounds(presetGroup.removeFromRight(size(27)));
    preset_.setBounds(presetGroup.reduced(3,0));
    preset_.getProperties().set("mct.topFont",16.f*compact);
    area.removeFromLeft(size(12));
    for(auto& mode:modes_) {
        mode.setBounds(area.removeFromLeft(size(70)).reduced(1,16));
        mode.getProperties().set("mct.topFont",15.f*compact);
    }
    area.removeFromLeft(size(12));
    undo_.setBounds(area.removeFromLeft(size(34)).reduced(1,16));
    redo_.setBounds(area.removeFromLeft(size(34)).reduced(1,16));
    panic_.setBounds(size(10),4,size(286),64);
}
}
