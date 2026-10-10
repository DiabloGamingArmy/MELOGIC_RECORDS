#pragma once
void activationWelcomeAudit(){
    using namespace melogic::account;
    struct Fixture final : Backend {
        bool licensed=false;int redemptions=0;
        Request begin(juce::int64 now) override{return {juce::String::repeatedString("e",64),juce::String::repeatedString("f",64),"https://melogicrecords.studio/auth/desktop?request="+juce::String::repeatedString("e",64),now+300000};}
        Session session(juce::int64 now){Session s;s.identity.uid="welcome-fixture";s.refreshToken="synthetic-not-valid";s.verified=true;s.validatedAt=now;s.refreshAfter=now+3000000;return s;}
        Poll poll(const Request& r,juce::int64 now) override{return {Poll::Approved,r.id,session(now)};}
        Session refresh(const Session&,juce::int64 now) override{return session(now);}
        Authorization authorization(Session&,juce::int64 now) override{return {licensed?AuthorizationState::Authorized:AuthorizationState::Unauthorized,licensed?"beta":"",{},licensed?now+900000:0};}
        Authorization redeem(Session& s,const juce::String& key,juce::int64 now) override{check(key=="synthetic-welcome-input-not-issued","original pending input reaches trusted redemption only");++redemptions;licensed=true;return authorization(s,now);}
    };
    auto fake=std::make_unique<Fixture>();auto* backend=fake.get();Service::useInMemoryForTesting(std::move(fake));auto service=Service::shared();
    const auto pump=[] {
#if defined(__APPLE__)
        CFRunLoopRunInMode(kCFRunLoopDefaultMode,.005,true);
#else
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
#endif
    };
    const auto wait=[&](auto predicate){const auto until=std::chrono::steady_clock::now()+std::chrono::seconds(7);while(!predicate() && std::chrono::steady_clock::now()<until)pump();check(predicate(),"welcome fixture reaches checkpoint");};
    wait([&]{return service->snapshot().state==State::SignedOut;});
    OrigamiAudioProcessor processor;processor.prepareToPlay(48000,128);processor.setUiParameter(ParameterId::Cutoff,.61f);processor.clearUiHistory();
    const auto state=[&]{juce::MemoryBlock b;processor.getStateInformation(b);return b;};const auto before=state();
    auto editor=std::make_unique<OrigamiAudioProcessorEditor>(processor);
    OrigamiAudioProcessor second;auto other=std::make_unique<OrigamiAudioProcessorEditor>(second);
    juce::DocumentWindow window("Origami activation handoff audit",juce::Colours::black,0);window.setContentNonOwned(editor.get(),true);window.setTopLeftPosition(100,100);
    const auto savedPointer=juce::Desktop::getMousePosition();
    auto* input=static_cast<juce::TextEditor*>(nullptr);juce::Button* activate=nullptr;ui::WelcomeOverlay* welcome=nullptr;juce::Component* workspace=nullptr;ui::OrigamiHeader* header=nullptr;juce::Button* panic=nullptr;
    walk(*editor,[&](auto& c){if(c.getName()=="Origami license key")input=dynamic_cast<juce::TextEditor*>(&c);if(c.getName()=="Activate license key")activate=dynamic_cast<juce::Button*>(&c);if(c.getName()=="Origami activation welcome")welcome=dynamic_cast<ui::WelcomeOverlay*>(&c);if(c.getName()=="Origami authorized workspace")workspace=&c;if(auto* h=dynamic_cast<ui::OrigamiHeader*>(&c))header=h;if(c.getName()=="Emergency DSP reset")panic=dynamic_cast<juce::Button*>(&c);});
    check(input && activate && welcome && workspace && header && panic,"actual editor owns gate, workspace, welcome and hover control");
    const auto capture=[&](const char* name){if(const char* folder=std::getenv("ORIGAMI_WELCOME_REPORT")){juce::File file(juce::String(folder)+"/"+name+".png");file.getParentDirectory().createDirectory();juce::FileOutputStream out(file);out.setPosition(0);out.truncate();check(juce::PNGImageFormat{}.writeImageToStream(editor->createComponentSnapshot(editor->getLocalBounds()),out),"actual editor screenshot");}};
    juce::Desktop::getInstance().getMainMouseSource().setScreenPosition(editor->localPointToGlobal(juce::Point<int>(900,600)).toFloat());
    capture("native-activation");input->setText("synthetic-welcome-input-not-issued");input->onTextChange();activate->onClick();
    check(!welcome->isVisible() && !processor.isAuthorized(),"authentication initiation cannot welcome or authorize");
    wait([&]{editor->refreshAuthorizationState();return welcome->isVisible();});
    window.setVisible(true);
    check(processor.isAuthorized() && service->authorizationFlag()->load() && backend->redemptions==1,"welcome follows legitimate worker authorization and exactly one redemption");
    check(!service->claimActivationWelcome(),"shared service cannot claim the same welcome twice");
    check(input->getText().isEmpty() && !workspace->isEnabled(),"first authorized frame clears plaintext and blocks underlying UI");
    for(int y=20;y<editor->getHeight();y+=79)for(int x=20;x<editor->getWidth();x+=101){auto* target=editor->getComponentAt(x,y);check(target==welcome || welcome->isParentOf(target),"welcome captures all editor hits");}
    check(editor->keyPressed(juce::KeyPress('Z',juce::ModifierKeys::commandModifier,0),workspace),"welcome consumes mutation shortcut");
    check(!editor->isInterestedInFileDrag({"fixture.wav"}),"welcome blocks file drops");editor->filesDropped({"fixture.wav"},100,100);editor->performDocumentHistory(false);
    check(state()==before && processor.uiHistorySize()==0,"welcome and blocked events never alter patch/history");
    juce::AudioBuffer<float> audio(2,128);juce::MidiBuffer midi;audio.clear();midi.addEvent(juce::MidiMessage::noteOn(1,60,.8f),0);double peak=0;
    for(int n=0;n<20;++n){audio.clear();pluginAllocations=0;pluginFrees=0;pluginGuardAllocations=true;processor.processBlock(audio,midi);pluginGuardAllocations=false;midi.clear();peak=std::max(peak,double(magnitude(audio)));check(!pluginAllocations && !pluginFrees,"welcome audio authorization path allocates nothing");}check(peak>0,"welcome leaves legitimately authorized audio running");capture("authorized-welcome");
    other->refreshAuthorizationState();walk(*other,[&](auto& c){if(c.getName()=="Origami activation welcome")check(!c.isVisible(),"simultaneous second editor does not welcome");});
    juce::Button* next=nullptr;walk(*welcome,[&](auto& c){if(c.getName()=="Welcome Continue")next=dynamic_cast<juce::Button*>(&c);});check(next!=nullptr,"welcome exposes Continue");next->onClick();
    check(!welcome->isVisible() && workspace->isEnabled() && processor.isAuthorized() && state()==before,"Continue dismisses UI only, without patch reset or authorization change");
    check(!header->panicVisibleAtCurrentPointer(),"first frame after Continue with pointer outside has no Panic");capture("synth-after-continue");
    service->restoreAccess();wait([&]{editor->refreshAuthorizationState();return processor.isAuthorized();});
    check(!welcome->isVisible(),"authorization restoration does not repeat acknowledged welcome");
    // Reproduce stale focus during an actual closed -> open gate transition,
    // with no click or post-transition mouse move allowed.
    for(bool inside:{false,true}){
        service->logout();wait([&]{editor->refreshAuthorizationState();return !processor.isAuthorized() && service->snapshot().state==State::SignedOut;});
        const auto point=inside?panic->localPointToGlobal(panic->getLocalBounds().getCentre()):editor->localPointToGlobal(juce::Point<int>(900,600));
        juce::Desktop::getInstance().getMainMouseSource().setScreenPosition(point.toFloat());
        static_cast<juce::Component*>(panic)->focusGained(juce::Component::focusChangedByTabKey);
        service->signIn();const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(6);
        while(!processor.isAuthorized() && std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(5));
        check(processor.isAuthorized(),"hover fixture authorizes without UI dispatch");editor->refreshAuthorizationState();
        check(!welcome->isVisible() && header->panicVisibleAtCurrentPointer()==inside,"first authorized frame reconciles stale focus to genuine pointer without click or movement");capture(inside?"panic-inside":"panic-outside");
    }
    juce::Desktop::getInstance().getMainMouseSource().setScreenPosition(editor->localPointToGlobal(juce::Point<int>(900,600)).toFloat());check(!header->panicVisibleAtCurrentPointer(),"subsequent hover exit hides Panic");
    static_cast<juce::Component*>(panic)->focusGained(juce::Component::focusChangedDirectly);check(!header->panicVisibleForPointer(false),"automatic first-button focus is not keyboard navigation");
    static_cast<juce::Component*>(panic)->focusGained(juce::Component::focusChangedByTabKey);check(header->panicVisibleForPointer(false),"intentional Tab focus retains accessible Panic");header->reconcileAccessFocus();
    window.setVisible(false);window.clearContentComponent();editor.reset();editor=std::make_unique<OrigamiAudioProcessorEditor>(processor);editor->refreshAuthorizationState();
    processor.setStateInformation(before.getData(),int(before.getSize()));editor->refreshAuthorizationState();walk(*editor,[&](auto& c){if(c.getName()=="Origami activation welcome")check(!c.isVisible(),"editor reopen and project restore never welcome");});
    service->logout();wait([&]{editor->refreshAuthorizationState();return !processor.isAuthorized();});check(!service->authorizationFlag()->load(),"authorization loss closes existing gate");
    juce::Desktop::getInstance().getMainMouseSource().setScreenPosition(savedPointer.toFloat());
    std::cout<<"PASS L01.4 welcome, first-frame hover, UI/audio/state isolation\n";
}
