#pragma once
// Runs against the actual JUCE controls and real shared-service worker, using only synthetic IO.
void activationSurfaceAudit() {
    using namespace melogic::account;
    struct Fixture final : Backend {
        std::atomic<int> begins{0},redemptions{0};
        std::atomic<bool> waiting{true},denied{false},offline{false},licensed{false},exactKey{true};
        Request begin(juce::int64 now) override {
            ++begins;if(offline)throw Failure{Failure::Network};const auto id=juce::String::repeatedString("a",64);
            return {id,juce::String::repeatedString("b",64),"https://melogicrecords.studio/auth/desktop?request="+id,now+300000};
        }
        Session session(juce::int64 now) {Session s;s.identity={"activation-fixture","Fixture","activation@example.invalid",{}};s.refreshToken="synthetic-session-not-valid";s.generation="fixture";s.verified=true;s.validatedAt=now;s.refreshAfter=now+3000000;return s;}
        Poll poll(const Request& r,juce::int64 now) override {if(offline)throw Failure{Failure::Network};return {waiting?Poll::Pending:denied?Poll::Cancelled:Poll::Approved,r.id,session(now)};}
        Session refresh(const Session&,juce::int64 now) override {return session(now);}
        Authorization authorization(Session&,juce::int64 now) override {return licensed?Authorization{AuthorizationState::Authorized,"beta","Activated",now+900000}:Authorization{AuthorizationState::Unauthorized,{},"Account signed in; Origami is not licensed.",0};}
        Authorization redeem(Session& s,const juce::String& key,juce::int64 now) override {
            ++redemptions;
            if(key=="invalid")throw Failure{Failure::InvalidKey};
            if(key=="expired")throw Failure{Failure::ExpiredKey};
            if(key=="exhausted")throw Failure{Failure::UsedKey};
            if(key=="revoked")throw Failure{Failure::KeyUnavailable};
            if(key=="network")throw Failure{Failure::Network};
            exactKey=key=="synthetic-activation-not-an-issued-key";
            licensed=true;return authorization(s,now);
        }
    };
    const auto pump=[] {
#if defined(__APPLE__)
        CFRunLoopRunInMode(kCFRunLoopDefaultMode,0.005,true);
#else
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
#endif
    };
    const auto wait=[&](const auto& predicate) {const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(7);while(!predicate() && std::chrono::steady_clock::now()<end)pump();check(predicate(),"activation worker reaches expected state");};
    const auto makeService=[](Fixture*& backend){auto fake=std::make_unique<Fixture>();backend=fake.get();return std::make_shared<Service>(makeMemoryStore(),std::move(fake));};
    const auto controls=[](ui::ActivationPanel& panel){
        std::array<juce::Component*,4> found{};walk(panel,[&](auto& c){if(c.getName()=="Origami license key")found[0]=&c;if(c.getName()=="Activate license key")found[1]=&c;if(c.getName()=="Activation sign in")found[2]=&c;if(c.getName()=="Activation status")found[3]=&c;});return found;
    };
    const auto noLogout=[](ui::ActivationPanel& panel){bool absent=true;walk(panel,[&](auto& c){if(c.getName()=="Activation cancel or logout")absent=false;});return absent;};
    const auto capture=[](ui::ActivationPanel& panel,const juce::String& name){if(const char* folder=std::getenv("ORIGAMI_ACTIVATION_REPORT")){juce::File file(juce::String(folder)+"/"+name+".png");file.getParentDirectory().createDirectory();juce::FileOutputStream out(file);out.setPosition(0);out.truncate();check(juce::PNGImageFormat{}.writeImageToStream(panel.createComponentSnapshot(panel.getLocalBounds()),out),"activation fixture screenshot saved");}};
    Fixture* backend=nullptr;auto service=makeService(backend);wait([&]{return service->snapshot().state==State::SignedOut;});
    ui::ActivationPanel panel(service);panel.setSize(1440,900);panel.sync(false);auto c=controls(panel);
    auto& entry=*dynamic_cast<juce::TextEditor*>(c[0]);auto& activate=*dynamic_cast<juce::Button*>(c[1]);auto& signIn=*dynamic_cast<juce::Button*>(c[2]);auto& status=*dynamic_cast<juce::Label*>(c[3]);
    check(noLogout(panel) && signIn.isVisible() && status.getText().isEmpty(),"signed-out surface has Sign In, no Logout component and no redundant status prose");
    check(!activate.isEnabled(),"empty key disabled");
    unsigned notifications=0;const auto changed=entry.onTextChange;entry.onTextChange=[&]{changed();++notifications;};
    const auto edit=[&](const juce::String& text){const auto before=notifications;entry.setText(text);wait([&]{return notifications>before;});};
    edit("   ");check(!activate.isEnabled(),"whitespace disabled by text notification alone");
    edit("x");check(activate.isEnabled(),"one character enables immediately without account timer sync");
    entry.selectAll();entry.insertTextAtCaret({});wait([&]{return !activate.isEnabled();});check(!activate.isEnabled(),"select all and delete disables via editor notification");
    edit("  synthetic-activation-not-an-issued-key  ");check(activate.isEnabled(),"paste-like text insertion enables while signed out");
    capture(panel,"signed-out-key-entry");
    const auto image=panel.createComponentSnapshot(panel.getLocalBounds());
    const auto unchangedBranding=[&]{const auto actual=panel.createComponentSnapshot(panel.getLocalBounds());const auto box=panel.getLocalBounds().withSizeKeepingCentre(500,430);bool same=true;for(int y=box.getY();y<box.getY()+110;++y)for(int x=box.getX();x<box.getRight();++x)if(actual.getPixelAt(x,y)!=image.getPixelAt(x,y))same=false;return same;};
    activate.onClick();activate.onClick();entry.onReturnKey();panel.sync(false);
    check(!activate.isEnabled() && !entry.isEnabled() && backend->redemptions==0,"pending auth blocks repeated clicks and Return before account adoption");
    wait([&]{return backend->begins==1;});check(service->snapshot().authorization.state!=AuthorizationState::Authorized,"pending identity cannot authorize");
    backend->waiting=false;
    wait([&]{panel.sync(false);return service->authorizationFlag()->load();});panel.sync(false);
    check(backend->redemptions==1 && backend->exactKey && entry.getText().isEmpty() && !activate.isEnabled(),"login resumes one redemption, authorizes, clears plaintext and disables cleared action");
    check(status.getText().isEmpty(),"success leaves no stale status");
    // Authenticated identity without entitlement remains gated; all failures use safe service classifications.
    backend->licensed=false;service->restoreAccess();wait([&]{return service->snapshot().state==State::SignedIn && service->snapshot().authorization.state==AuthorizationState::Unauthorized;});panel.sync(false);
    check(!service->authorizationFlag()->load(),"authenticated but unlicensed stays unauthorized");
    check(unchangedBranding(),"authentication and Logout insertion do not shift branding");capture(panel,"signed-in-unlicensed");
    for(const auto& item:std::array<std::pair<const char*,const char*>,5>{{{"invalid","Invalid license key"},{"expired","expired"},{"exhausted","already been redeemed"},{"revoked","unavailable"},{"network","Check your connection"}}}) {
        edit(item.first);check(activate.isEnabled(),"unlicensed signed-in identity can retry redemption");const auto before=backend->redemptions.load();
        entry.onReturnKey();activate.onClick();
        wait([&]{return service->snapshot().authorization.state==AuthorizationState::Error;});panel.sync(false);
        check(backend->redemptions==before+1 && status.getText().contains(item.second) && !service->authorizationFlag()->load(),"safe failure classification and duplicate prevention");
        check(!status.getText().contains("Firebase") && !status.getText().contains("synthetic"),"activation error does not expose backend or secret material");
    }
    check(unchangedBranding(),"error presentation does not shift branding");capture(panel,"network-error");
    edit("synthetic-activation-not-an-issued-key");entry.onReturnKey();wait([&]{return service->authorizationFlag()->load();});panel.sync(false);check(entry.getText().isEmpty(),"network failure is recoverable");
    // Exact old wordmark/tagline pixels, not an approximation of layout arithmetic.
    for(int width:{960,1440,1920}) {
        panel.setSize(width,int(width/1.6));panel.sync(false);
        const auto reference=juce::ImageFileFormat::loadFrom(juce::File(__FILE__).getParentDirectory().getParentDirectory().getChildFile("docs/qa/licensing-l011/activation-"+juce::String(width)+".png"));
        check(reference.isValid(),"baseline activation screenshot available");const auto actual=panel.createComponentSnapshot(panel.getLocalBounds());
        const auto box=panel.getLocalBounds().withSizeKeepingCentre(juce::jmin(500,width-40),430);bool same=true;
        for(int y=box.getY();y<box.getY()+110;++y)for(int x=box.getX();x<box.getRight();++x)if(actual.getPixelAt(x,y)!=reference.getPixelAt(x,y))same=false;
        check(same,"wordmark and tagline pixel-identical to committed baseline at all target sizes");capture(panel,"branding-"+juce::String(width));
    }
    service->logout();wait([&]{return service->snapshot().state==State::SignedOut;});panel.sync(false);check(noLogout(panel),"logout control removed again after sign-out");panel.setSize(1440,900);capture(panel,"signed-out-clean");
    // Cancellation, failed sign-in, and editor destruction never resume a key.
    for(int mode=0;mode<5;++mode) {
        Fixture* fake=nullptr;auto account=makeService(fake);wait([&]{return account->snapshot().state==State::SignedOut;});
        auto surface=std::make_unique<ui::ActivationPanel>(account);surface->setSize(1440,900);auto controlsFor=controls(*surface);auto* input=dynamic_cast<juce::TextEditor*>(controlsFor[0]);auto* action=dynamic_cast<juce::Button*>(controlsFor[1]);
        input->setText("synthetic-activation-not-an-issued-key");wait([&]{return action->isEnabled();});if(mode==2)fake->offline=true;if(mode==4){fake->licensed=true;fake->waiting=false;}action->onClick();
        wait([&]{return fake->begins==1;});
        if(mode==0){surface->sync(false);walk(*surface,[&](auto& comp){if(comp.getName()=="Activation cancel or logout")dynamic_cast<juce::Button*>(&comp)->onClick();});wait([&]{return account->snapshot().state==State::SignedOut;});}
        if(mode==1){fake->denied=true;fake->waiting=false;wait([&]{surface->sync(false);return account->snapshot().state==State::SignedOut;});}
        if(mode==2)wait([&]{return account->snapshot().state==State::Error;});
        if(mode==3){surface.reset();fake->waiting=false;wait([&]{return account->snapshot().state==State::SignedIn;});}
        if(mode==4)wait([&]{surface->sync(false);return account->authorizationFlag()->load();});
        if(surface){surface->sync(false);check(input->getText().isEmpty(),"cancelled/failed auth clears transient key");}
        check(fake->redemptions==0 && (mode==4 || !account->authorizationFlag()->load()),"cancelled, failed, or destroyed initiating editor cannot redeem");
    }
    std::cout<<"PASS L01.2 activation controls and continuation audit\n";
}
