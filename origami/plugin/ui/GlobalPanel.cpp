#include "GlobalPanel.h"
#include <BinaryData.h>
#include <OrigamiBuildIdentity.h>

namespace mct::origami::ui {
namespace {
constexpr std::array<const char*,8> names{{"ENV","LFO","RANDOM","FUNCTION","CHAOS","DRIFT","SEQUENCER","OSC"}};
struct Regions {juce::Rectangle<int> identity,account,master,voice,engine,activity,tuning,behavior;};
Regions regions(juce::Rectangle<int> body) {
    auto area=body.reduced(28,20);
    if(area.getWidth()>1320) area=area.withSizeKeepingCentre(1320,area.getHeight());
    Regions r;r.identity=area.removeFromTop(96);area.removeFromTop(18);
    r.account={r.identity.getX()+350,r.identity.getY(),juce::jmax(220,r.identity.getWidth()-620),96};
    auto upper=area.removeFromTop(252);const int column=(upper.getWidth()-36)/3;
    r.master=upper.removeFromLeft(column);upper.removeFromLeft(18);r.voice=upper.removeFromLeft(column);upper.removeFromLeft(18);r.engine=upper;
    area.removeFromTop(18);r.activity=area.removeFromTop(100);area.removeFromTop(18);
    auto lower=area.removeFromTop(150);r.tuning=lower.removeFromLeft((lower.getWidth()-18)/2);lower.removeFromLeft(18);r.behavior=lower;
    return r;
}
juce::Rectangle<int> inside(juce::Rectangle<int> r) {return r.reduced(16,12).withTrimmedTop(28);}
bool editing(juce::Slider& s) {
    if(s.isMouseButtonDown()) return true;
    for(auto* c:s.getChildren())if(auto* label=dynamic_cast<juce::Label*>(c))if(label->isBeingEdited())return true;
    return false;
}
void heading(juce::Graphics& g,juce::Rectangle<int> r,const char* title) {
    g.setColour(Palette::borderSoft());g.drawRect(r,1);
    text(g,title,r.reduced(16,10).removeFromTop(20),13.f,Palette::text());
}
void rotary(juce::Slider& s,const char* name,double min,double max,double step) {
    s.setName(name);s.setSliderStyle(juce::Slider::RotaryVerticalDrag);
    s.setTextBoxStyle(juce::Slider::TextBoxBelow,false,84,20);
    s.setRange(min,max,step);s.setScrollWheelEnabled(false);
    s.setRotaryParameters(juce::MathConstants<float>::pi*1.2f,juce::MathConstants<float>::pi*2.8f,true);
}
}
juce::String GlobalPanel::version() {return ORIGAMI_PUBLIC_VERSION;}
juce::String GlobalPanel::architecture() {return melogic::update::installedIdentity().architecture;}
juce::String GlobalPanel::buildIdentity() {return version()+"  /  "+ORIGAMI_PUBLIC_CHANNEL+"\nBuild "+juce::String(ORIGAMI_BUILD_NUMBER)+" / "+ORIGAMI_PUBLIC_REVISION+" / "+architecture();}
GlobalPanel::GlobalPanel(Getter getter,Setter setter,GlobalPanelHost host,std::shared_ptr<melogic::update::Service> updates)
    : Panel("GLOBAL"),getter_(std::move(getter)),setter_(std::move(setter)),host_(std::move(host)),updates_(updates?std::move(updates):melogic::update::Service::shared()) {
    wordmark_=juce::ImageCache::getFromMemory(BinaryData::mct_origami_wordmark_png,BinaryData::mct_origami_wordmark_pngSize);
    for(auto* c:std::array<juce::Component*,14>{{&master_,&voiceMode_,&priority_,&legato_,&glide_,&bendUp_,&bendDown_,&settings_,&panic_,&identity_,&rate_,&block_,&voices_,&load_}})addAndMakeVisible(c);
    addChildComponent(capture_);
    for(auto* c:std::array<juce::Component*,3>{&updateStatus_,&updateAction_,&updateLater_})addAndMakeVisible(c);
    updateStatus_.setName("Origami optional update status");
    updateStatus_.setFont(juce::FontOptions(11.f));updateStatus_.setColour(juce::Label::textColourId,Palette::secondary());
    updateStatus_.setJustificationType(juce::Justification::centredRight);
    updateAction_.setName("Origami optional update check or release notes");updateLater_.setName("Dismiss optional update");
    updateAction_.onClick=[this]{const auto u=updates_->snapshot();if(u.state==melogic::update::State::UpdateAvailable && dismissedRelease_!=u.candidate.releaseId){
        juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::InfoIcon,"Origami "+u.candidate.version,
            u.candidate.releaseNotes+"\n\nMinimum macOS: "+u.candidate.minimumOS+"\nBuild: "+juce::String(u.candidate.buildNumber)+"\nUpdates are optional. Downloading is not available in this version.");
    }else{dismissedRelease_.clear();updates_->check(true);}};
    updateLater_.onClick=[this]{dismissedRelease_=updates_->snapshot().candidate.releaseId;syncFromModel();};
    identity_.setName("Origami build identity");identity_.setText(buildIdentity(),juce::dontSendNotification);
    identity_.setFont(juce::FontOptions(12.f));identity_.setColour(juce::Label::textColourId,Palette::secondary());identity_.setJustificationType(juce::Justification::centredRight);
    for(auto* c:std::array<juce::Component*,3>{&accountIdentity_,&accountAction_,&accountSecondary_})addAndMakeVisible(c);
    accountIdentity_.setName("Melogic account identity");accountIdentity_.setFont(juce::FontOptions(12.f));accountIdentity_.setColour(juce::Label::textColourId,Palette::secondary());
    accountAction_.setName("Melogic account action");accountSecondary_.setName("Melogic account logout or cancel");
    accountAction_.setColour(juce::TextButton::buttonColourId,juce::Colour(0xff281619));
    accountAction_.onClick=[this]{const auto s=account_->snapshot();if(s.state==melogic::account::State::SignedIn || s.state==melogic::account::State::OfflineCached)juce::URL("https://melogicrecords.studio/profile").launchInDefaultBrowser();else if(s.storageError)account_->restoreAccess();else account_->signIn();};
    accountSecondary_.onClick=[this]{if(account_->snapshot().state==melogic::account::State::AwaitingBrowser)account_->cancel();else account_->logout();};
    for(auto* label:{&rate_,&block_,&voices_,&load_}) {
        label->setFont(juce::FontOptions(13.f));label->setColour(juce::Label::textColourId,Palette::text());label->setJustificationType(juce::Justification::centredRight);
    }
    rate_.setName("Engine sample rate");block_.setName("Engine audio block");voices_.setName("Engine active MIDI voices");load_.setName("Engine audio callback load");
    load_.setTooltip("Smoothed audio callback wall time divided by its block deadline; last measured load, not whole-system CPU usage.");
    master_.knob().setName("GLOBAL MASTER OUTPUT");
    master_.knob().onValueChange=[this]{if(!syncing_ && host_.setMaster)host_.setMaster(FinalOutputGain::position(float(master_.knob().getValue())));};
    rotary(glide_,"Global glide",0,5,.001);glide_.setDoubleClickReturnValue(true,0);
    glide_.textFromValueFunction=[](double v){return v<.001 ? juce::String("OFF") : juce::String(v,3)+" s";};
    glide_.valueFromTextFunction=[](const juce::String& s){return s.getDoubleValue();};
    glide_.onValueChange=[this]{if(syncing_ || !host_.performance || !host_.setPerformance)return;auto p=host_.performance();p.glideSeconds=float(glide_.getValue());host_.setPerformance(p);};
    for(auto* slider:{&bendUp_,&bendDown_}) {
        slider->setSliderStyle(juce::Slider::LinearBarVertical);slider->setTextBoxStyle(juce::Slider::TextBoxBelow,false,100,24);
        slider->setRange(-48,48,1);slider->setSliderSnapsToMousePosition(false);slider->setScrollWheelEnabled(false);
        slider->getProperties().set("mct.origami.numberOnly",true);
        slider->textFromValueFunction=[](double v){return (v>0?"+":"")+juce::String(int(v))+" st";};
        slider->valueFromTextFunction=[](const juce::String& s){return s.getDoubleValue();};
    }
    bendUp_.setName("Global pitch bend up");bendDown_.setName("Global pitch bend down");
    bendUp_.setDoubleClickReturnValue(true,2);bendDown_.setDoubleClickReturnValue(true,-2);
    bendUp_.onValueChange=[this]{if(!syncing_ && host_.performance && host_.setBend)host_.setBend(float(bendUp_.getValue()),host_.performance().pitchBendDownSemitones);};
    bendDown_.onValueChange=[this]{if(!syncing_ && host_.performance && host_.setBend)host_.setBend(host_.performance().pitchBendRangeSemitones,float(bendDown_.getValue()));};
    voiceMode_.setName("Global voice mode");priority_.setName("Global mono note priority");legato_.setName("Global legato");
    voiceMode_.onClick=[this]{if(!host_.performance)return;const auto mode=host_.performance().voiceMode;
        showNativeChoiceMenu(voiceMode_,"Voice mode",{{1,"POLY",true,{},mode==VoiceMode::Poly},{2,"MONO",true,{},mode==VoiceMode::Mono}},mode==VoiceMode::Mono?2:1,
            [safe=juce::Component::SafePointer<GlobalPanel>(this)](int id){if(safe && id>=1 && id<=2)safe->chooseVoiceMode(id==2?VoiceMode::Mono:VoiceMode::Poly);});};
    priority_.onClick=[this]{if(!host_.performance)return;const auto priority=host_.performance().notePriority;
        showNativeChoiceMenu(priority_,"Mono note priority",{{1,"LAST",true,{},priority==NotePriority::Last},{2,"HIGH",true,{},priority==NotePriority::High},{3,"LOW",true,{},priority==NotePriority::Low}},int(priority)+1,
            [safe=juce::Component::SafePointer<GlobalPanel>(this)](int id){if(safe && id>=1 && id<=3)safe->choosePriority(NotePriority(id-1));});};
    legato_.onClick=[this]{if(!host_.performance || !host_.setPerformance)return;auto p=host_.performance();p.legato=legato_.getToggleState();host_.setPerformance(p);};
    settings_.setName("Global Settings");settings_.onClick=[this]{showSettings(!settingsOpen_);};
    panic_.setName("Global Panic");panic_.setTooltip("Silence all voices and clear effect tails without changing the patch");panic_.onClick=[this]{if(host_.panic)host_.panic();};
    capture_.setName("Global keyboard capture preference");capture_.onClick=[this]{preferences_->setCaptureKeyboardInput(capture_.getToggleState());};
    for(std::size_t i=0;i<toggles_.size();++i) {
        auto& button=toggles_[i];addAndMakeVisible(button);button.setClickingTogglesState(true);
        button.setName(juce::String(names[i])+" visualization");
        button.onClick=[this,i]{if(syncing_)return;auto mask=getter_?getter_():defaultVisualizationMask;const auto bit=1u<<std::uint32_t(i);
            if(toggles_[i].getToggleState())mask|=bit;else mask&=~bit;if(setter_)setter_(mask);updateButton(i,toggles_[i].getToggleState());};
    }
    syncFromModel();
}
void GlobalPanel::chooseVoiceMode(VoiceMode mode) {if(host_.performance && host_.setPerformance){auto p=host_.performance();p.voiceMode=mode;host_.setPerformance(p);syncFromModel();}}
void GlobalPanel::choosePriority(NotePriority priority) {if(host_.performance && host_.setPerformance){auto p=host_.performance();p.notePriority=priority;host_.setPerformance(p);syncFromModel();}}
void GlobalPanel::updateButton(std::size_t i,bool enabled) {
    toggles_[i].setButtonText(enabled?"ON":"OFF");toggles_[i].setColour(juce::TextButton::buttonOnColourId,signalSourceColour().darker(.72f));
}
void GlobalPanel::syncFromModel() {
    const juce::ScopedValueSetter<bool> guard(syncing_,true);
    const auto mask=getter_?getter_():defaultVisualizationMask;
    for(std::size_t i=0;i<toggles_.size();++i){const bool on=(mask&(1u<<std::uint32_t(i)))!=0;toggles_[i].setToggleState(on,juce::dontSendNotification);updateButton(i,on);}
    if(host_.master)master_.sync(host_.master(),host_.meters?host_.meters():FinalOutputMeters{});
    if(host_.performance) {
        const auto p=host_.performance();voiceMode_.setButtonText(p.voiceMode==VoiceMode::Mono?"MONO":"POLY");
        priority_.setButtonText(p.notePriority==NotePriority::High?"HIGH":p.notePriority==NotePriority::Low?"LOW":"LAST");
        legato_.setToggleState(p.legato,juce::dontSendNotification);
        if(!editing(glide_))glide_.setValue(p.glideSeconds,juce::dontSendNotification);
        if(!editing(bendUp_))bendUp_.setValue(p.pitchBendRangeSemitones,juce::dontSendNotification);
        if(!editing(bendDown_))bendDown_.setValue(p.pitchBendDownSemitones,juce::dontSendNotification);
    }
    if(host_.engine) {
        const auto e=host_.engine();engineInfo_=e;rate_.setText(e.sampleRate>0?juce::String(e.sampleRate/1000,1)+" kHz":"Not prepared",juce::dontSendNotification);
        block_.setText(e.blockSize>0?juce::String(e.blockSize)+" / "+juce::String(e.maximumBlockSize)+" samples":"Not prepared",juce::dontSendNotification);
        voices_.setText(juce::String(e.activeVoices)+" / "+juce::String(e.maximumVoices),juce::dontSendNotification);
        load_.setText(e.loadAvailable?juce::String(e.audioLoad*100,1)+" %":"Not measured",juce::dontSendNotification);
    }
    capture_.setToggleState(preferences_->captureKeyboardInput(),juce::dontSendNotification);
    using melogic::account::State;
    const auto account=account_->snapshot();
    if(account.state==State::SignedIn)updates_->check();
    const auto update=updates_->snapshot();
    const bool available=update.state==melogic::update::State::UpdateAvailable && update.candidate.releaseId!=dismissedRelease_;
    updateStatus_.setText(available?"UPDATE AVAILABLE / "+update.candidate.version:
        update.state==melogic::update::State::Checking?"Checking updates...":
        update.state==melogic::update::State::CheckFailed?(update.manual?update.message:juce::String{}):update.message,juce::dontSendNotification);
    updateAction_.setButtonText(available?"VIEW UPDATE":"CHECK FOR UPDATES");
    updateAction_.setEnabled(update.state!=melogic::update::State::Checking);
    updateLater_.setVisible(available);
    const bool identified=account.state==State::SignedIn || account.state==State::OfflineCached;
    accountIdentity_.setText(identified?(account.identity.displayName.isEmpty()?account.identity.email:account.identity.displayName)+"\n"+(account.state==State::OfflineCached?"Offline / cached identity":account.identity.email)+"\n"+(account.authorization.state==melogic::account::AuthorizationState::Authorized?"Origami / Activated / "+account.authorization.edition:"Origami / not licensed"):account.message,juce::dontSendNotification);
    accountIdentity_.setTooltip(account.message);
    accountAction_.setButtonText(identified?"OPEN ACCOUNT":account.storageError?"RETRY ACCOUNT ACCESS":"SIGN IN TO MELOGIC");
    accountAction_.setEnabled(account.state!=State::AwaitingBrowser && account.state!=State::Restoring && account.state!=State::Refreshing && account.state!=State::SigningOut);
    accountSecondary_.setButtonText(account.state==State::AwaitingBrowser?"CANCEL":"LOG OUT");
    accountSecondary_.setEnabled(identified || account.state==State::AwaitingBrowser || account.state==State::Error);
    if(isShowing() && !settingsOpen_){const auto url=account_->takeBrowserURL();if(url.isNotEmpty() && !juce::URL(url).launchInDefaultBrowser())account_->cancel();}
    repaint();
}
void GlobalPanel::showSettings(bool open) {settingsOpen_=open;settings_.setButtonText(open?"BACK TO GLOBAL":"SETTINGS");resized();syncFromModel();}
void GlobalPanel::resized() {
    const auto r=regions(contentBounds());identity_.setBounds(r.identity.withTrimmedLeft(r.identity.getWidth()-250).withHeight(40));
    const auto updateArea=r.identity.withTrimmedLeft(r.identity.getWidth()-250);
    updateStatus_.setBounds(updateArea.withY(updateArea.getY()+40).withHeight(22));
    updateAction_.setBounds(updateArea.getX(),updateArea.getY()+66,180,24);
    updateLater_.setBounds(updateArea.getX()+188,updateArea.getY()+66,62,24);
    accountIdentity_.setBounds(r.account.reduced(12,0).withY(r.account.getY()+25).withHeight(38));
    auto accountButtons=r.account.reduced(12,0).withY(r.account.getY()+63).withHeight(24);
    accountAction_.setBounds(accountButtons.removeFromLeft(juce::jmin(180,accountButtons.getWidth()-80)));accountButtons.removeFromLeft(8);accountSecondary_.setBounds(accountButtons.removeFromLeft(72));
    for(auto* c:std::array<juce::Component*,10>{{&master_,&voiceMode_,&priority_,&legato_,&glide_,&bendUp_,&bendDown_,&rate_,&block_,&voices_}})c->setVisible(!settingsOpen_);
    load_.setVisible(!settingsOpen_);for(auto& b:toggles_)b.setVisible(!settingsOpen_);capture_.setVisible(settingsOpen_);
    if(settingsOpen_) {
        auto a=r.master.withWidth(r.behavior.getRight()-r.master.getX());capture_.setBounds(a.getX()+16,a.getY()+55,330,28);
        settings_.setBounds(a.getRight()-182,a.getY()+12,166,28);panic_.setBounds(a.getX()+16,a.getY()+170,200,28);return;
    }
    master_.setBounds(inside(r.master));auto v=inside(r.voice);
    const int field=juce::jmin(112,v.getWidth()/2);voiceMode_.setBounds(v.getX()+80,v.getY(),field,27);priority_.setBounds(v.getX()+80,v.getY()+39,field,27);
    legato_.setBounds(v.getX(),v.getY()+88,115,26);glide_.setBounds(v.getRight()-100,v.getY()+80,92,84);
    auto e=inside(r.engine);for(auto* label:{&rate_,&block_,&voices_,&load_}){auto row=e.removeFromTop(34);label->setBounds(row.withTrimmedLeft(128));}
    auto a=inside(r.activity);const int w=a.getWidth()/8;
    for(std::size_t i=0;i<toggles_.size();++i)toggles_[i].setBounds(a.getX()+int(i)*w+juce::jmax(48,w-66),a.getY()+19,58,24);
    auto t=inside(r.tuning);bendUp_.setBounds(t.getX()+85,t.getY()+5,100,30);bendDown_.setBounds(t.getX()+300,t.getY()+5,100,30);
    auto b=inside(r.behavior);settings_.setBounds(b.getX(),b.getY()+8,150,28);panic_.setBounds(b.getX()+168,b.getY()+8,200,28);
}
void GlobalPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    const auto r=regions(body);
    if(wordmark_.isValid())g.drawImageWithin(wordmark_,r.identity.getX(),r.identity.getY(),330,75,juce::RectanglePlacement::xLeft | juce::RectanglePlacement::yMid);
    text(g,"SYNTHESIS, UNFOLDED.",r.identity.withTrimmedTop(80).withWidth(330),Type::label,Palette::muted());
    g.setColour(Palette::borderStrong());g.drawHorizontalLine(r.identity.getBottom()+7,float(r.identity.getX()),float(r.identity.getRight()));
    heading(g,r.account,"ACCOUNT");
    if(settingsOpen_) {
        auto a=r.master.withWidth(r.behavior.getRight()-r.master.getX());
        text(g,"SETTINGS / APPLICATION",a.reduced(16,10).removeFromTop(24),14.f,Palette::text());
        text(g,"Keyboard capture enables Origami shortcuts while the instrument has focus.",a.withTrimmedTop(95).reduced(16,0).withHeight(22),12.f,Palette::secondary());
        text(g,"Off preserves DAW shortcuts. This preference is shared between instances and is not saved in presets.",a.withTrimmedTop(120).reduced(16,0).withHeight(22),11.f,Palette::muted());
        text(g,"Panic clears voices and effect tails; it keeps the current sound settings.",a.withTrimmedTop(205).reduced(16,0).withHeight(22),11.f,Palette::muted());return;
    }
    heading(g,r.master,"MASTER");heading(g,r.voice,"VOICE / PERFORMANCE");heading(g,r.engine,"ENGINE");heading(g,r.activity,"APPEARANCE / ACTIVITY");heading(g,r.tuning,"TUNING / MIDI");heading(g,r.behavior,"GLOBAL BEHAVIOR");
    auto v=inside(r.voice);text(g,"MODE",v.withHeight(27).withWidth(76),Type::label,Palette::muted());text(g,"PRIORITY",v.withY(v.getY()+39).withHeight(27).withWidth(76),Type::label,Palette::muted());
    text(g,"GLIDE",{v.getRight()-100,v.getY()+64,92,18},Type::label,Palette::muted(),juce::Justification::centred);
    text(g,juce::String(engineInfo_.maximumVoices)+" voices. Priority, legato and glide apply in Mono.",r.voice.reduced(16,0).withY(r.voice.getBottom()-27).withHeight(20),Type::secondary,Palette::muted());
    auto e=inside(r.engine);for(const auto* title:{"SAMPLE RATE","BLOCK / MAX","MIDI VOICES","AUDIO LOAD"})text(g,title,e.removeFromTop(34).withWidth(126),Type::label,Palette::muted());
    text(g,"Last measured callback / audio deadline",r.engine.reduced(16,0).withY(r.engine.getBottom()-27).withHeight(20),Type::secondary,Palette::muted());
    auto a=inside(r.activity);const int w=a.getWidth()/8;for(std::size_t i=0;i<names.size();++i)text(g,names[i],{a.getX()+int(i)*w,a.getY()+19,juce::jmax(48,w-72),24},Type::label,Palette::secondary());
    auto t=inside(r.tuning);text(g,"BEND UP",{t.getX(),t.getY()+5,84,30},Type::label,Palette::muted());text(g,"BEND DOWN",{t.getX()+205,t.getY()+5,94,30},Type::label,Palette::muted());
    text(g,"Signed wheel endpoints. Center stays at the original note pitch.",t.withY(t.getY()+52).withHeight(22),Type::secondary,Palette::muted());
    auto b=inside(r.behavior);text(g,"Settings configures Origami. Panic recovers from stuck notes.",b.withY(b.getY()+52).withHeight(22),Type::secondary,Palette::muted());
}
}
