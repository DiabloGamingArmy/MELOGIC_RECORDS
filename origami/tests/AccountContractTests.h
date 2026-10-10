#pragma once
void accountWireContractAudit(const juce::String& base) {
    using namespace melogic::account;
    auto configStream=makeAuthPostStream(base+"/fixture","{}");configStream->withExtraHeaders("Content-Type: application/json\r\n");
    check(configStream->connect(nullptr),"contract fixture connects");const auto config=juce::JSON::parse(configStream->readEntireStreamAsString());
    class ContractStore final : public Store {
        std::unique_ptr<Store> memory_=makeMemoryStore();bool fail_;
    public:
        explicit ContractStore(bool fail):fail_(fail){}
        bool tryLock() override{return memory_->tryLock();}
        void unlock() noexcept override{memory_->unlock();}
        juce::String generation() override{return memory_->generation();}
        std::optional<Session> load(bool interactive=false) override{return memory_->load(interactive);}
        void save(const Session& session,bool interactive) override{if(fail_)throw Failure{Failure::Storage,"keychain_save",0};memory_->save(session,interactive);}
        void erase() override{memory_->erase();}
    };
    auto service=std::make_shared<Service>(std::make_unique<ContractStore>(bool(config["failStorage"])),makeFirebaseBackendForTesting(base));
    ui::ActivationPanel panel(service);panel.setSize(960,600);juce::TextEditor* entry=nullptr;juce::Button* activate=nullptr;
    walk(panel,[&](auto& c){if(c.getName()=="Origami license key")entry=dynamic_cast<juce::TextEditor*>(&c);if(c.getName()=="Activate license key")activate=dynamic_cast<juce::Button*>(&c);});check(entry && activate,"contract uses real activation controls");
    const auto wait=[&](auto predicate){const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(45);while(!predicate() && std::chrono::steady_clock::now()<end){
#if defined(__APPLE__)
        CFRunLoopRunInMode(kCFRunLoopDefaultMode,.01,false);
#else
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
#endif
    }check(predicate(),"contract native state reaches expected checkpoint");};
    wait([&]{return service->snapshot().state==State::SignedOut;});panel.sync(false);
    entry->setText("  "+config["key"].toString()+"\n");wait([&]{return activate->isEnabled();});activate->onClick();activate->onClick();
    const auto expected=config["expect"].toString();
    if(expected=="authorized") {
        wait([&]{panel.sync(false);return service->authorizationFlag()->load();});panel.sync(false);
        check(service->snapshot().state==State::SignedIn && entry->getText().isEmpty(),"actual wire login, lookup, session publication, pending redemption and cleanup complete");
        service->restoreAccess();wait([&]{return service->snapshot().state==State::SignedIn && service->authorizationFlag()->load();});
    } else {
        wait([&]{panel.sync(false);return service->snapshot().state==State::Error || (service->snapshot().state==State::SignedOut && entry->getText().isEmpty()) || service->snapshot().authorization.state==AuthorizationState::Error;});
        check(!service->authorizationFlag()->load(),"wire failure never authorizes");
        if(expected.isNotEmpty() && expected!="cancelled")check((service->snapshot().message+service->snapshot().authorization.message).containsIgnoreCase(expected),"wire error has safe category-specific explanation");
    }
    std::cout<<"PASS native/backend wire contract\n";
}
