#include <melogic/account/AccountService.h>
#include <iostream>
#if JUCE_MAC
#include <Security/Security.h>
#endif
#include <stdexcept>
using namespace melogic::account;
namespace {
unsigned checks=0;
void check(bool ok,const char* text){++checks;if(!ok)throw std::runtime_error(text);}
class FakeStore final : public Store {
public:
    bool busy=false,failRead=false,failWrite=false,failErase=false;
    juce::String gen="initial";std::optional<Session> session;
    bool tryLock() override{return !busy;}
    void unlock() noexcept override{}
    juce::String generation() override{return gen;}
    std::optional<Session> load(bool=false) override{if(failRead)throw Failure{Failure::Storage};return session;}
    void save(const Session& s,bool) override{if(failWrite)throw Failure{Failure::Storage};session=s;gen=s.generation;}
    void erase() override{gen=juce::Uuid().toString();if(failErase)throw Failure{Failure::Storage};session.reset();}
};
class FakeBackend final : public Backend {
public:
    bool offline=false,invalid=false,mismatch=false,denied=false,waiting=false;
    unsigned refreshes=0,begins=0;
    std::function<void()> duringRefresh;
    Session result(juce::int64 now){Session s;s.identity={"fixture-uid","Fixture Person","fixture@example.invalid",{}};s.refreshToken="fixture-only-not-a-real-token";s.verified=true;s.validatedAt=now;s.refreshAfter=now+3000000;return s;}
    Request begin(juce::int64 now) override{++begins;if(offline)throw Failure{Failure::Network};Request r;r.id=juce::String::repeatedString("a",64);r.verifier=juce::String::repeatedString("b",64);r.expiresAt=now+300000;r.browserURL="https://melogicrecords.studio/auth/desktop?request="+r.id;return r;}
    Poll poll(const Request& r,juce::int64 now) override{if(offline)throw Failure{Failure::Network};Poll p;p.requestId=mismatch?"injected":r.id;p.status=waiting?Poll::Pending:denied?Poll::Cancelled:Poll::Approved;p.session=result(now);return p;}
    Session refresh(const Session&,juce::int64 now) override{++refreshes;if(duringRefresh)duringRefresh();if(offline)throw Failure{Failure::Network};if(invalid)throw Failure{Failure::InvalidSession};return result(now);}
};
void scenarios(){
    check(challengeForVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")=="E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM","native S256 matches RFC 7636 and backend vector");
    constexpr juce::int64 now=1000000;
    FakeStore store;FakeBackend backend;Coordinator standalone(store,backend),au(store,backend),vst3(store,backend);
    standalone.step(Command::None,now);check(standalone.snapshot.state==State::SignedOut,"signed-out startup");
    standalone.step(Command::SignIn,now);check(standalone.snapshot.state==State::AwaitingBrowser && standalone.snapshot.verificationCode=="AAAAAAAA","browser request has verification state");
    standalone.step(Command::None,now+2000);check(store.session && standalone.snapshot.state==State::SignedIn,"successful validated adoption persists session");
    au.step(Command::None,now+3000);vst3.step(Command::None,now+3000);
    check(au.snapshot.identity.uid==standalone.snapshot.identity.uid && vst3.snapshot.identity.uid==au.snapshot.identity.uid,"formats share canonical machine session");
    check(backend.refreshes==0,"recent shared validation prevents duplicate refresh");
    Coordinator restart(store,backend);restart.step(Command::None,now+40000);check(backend.refreshes==1 && restart.snapshot.state==State::SignedIn,"later process restores through Firebase refresh");
    au.step(Command::None,now+41000);check(backend.refreshes==1,"other instance observes refreshed deadline");
    vst3.step(Command::Logout,now+42000);au.step(Command::None,now+43000);standalone.step(Command::None,now+43000);
    check(!store.session && au.snapshot.state==State::SignedOut && standalone.snapshot.identity.uid.isEmpty(),"logout propagates and removes secret material");
    au.step(Command::SignIn,now);standalone.step(Command::Logout,now+1);au.step(Command::None,now+2);check(!store.session && au.snapshot.state==State::Error,"cross-process logout invalidates pending login");
    au.step(Command::SignIn,now);au.step(Command::Cancel,now+1);check(!store.session && au.snapshot.state==State::SignedOut,"local cancellation never adopts identity");
    backend.denied=true;au.step(Command::SignIn,now);au.step(Command::None,now+1);check(au.snapshot.state==State::SignedOut,"browser cancellation");backend.denied=false;
    au.step(Command::SignIn,now);au.step(Command::None,now+300001);check(au.snapshot.state==State::Error && !store.session,"login callback timeout");
    backend.mismatch=true;au.step(Command::SignIn,now);au.step(Command::None,now+1);check(au.snapshot.state==State::Error && !store.session,"callback/request mismatch cannot authenticate");backend.mismatch=false;
    store.failWrite=true;au.step(Command::SignIn,now);au.step(Command::None,now+1);check(au.snapshot.state==State::Error && !store.session,"Keychain write failure never reports signed in");store.failWrite=false;
    store.failRead=true;au.step(Command::None,now);check(au.snapshot.state==State::Error,"Keychain read failure");store.failRead=false;au.step(Command::Restore,now);check(au.snapshot.state==State::SignedOut && !au.snapshot.storageError,"user-initiated Keychain retry recovers without browser login");
    store.session=backend.result(now);store.session->generation=store.gen;store.session->refreshToken.clear();au.step(Command::None,now);check(au.snapshot.state==State::SignedOut,"missing secure token is not authentication");
    store.session=backend.result(now);store.session->generation="stale-generation";au.step(Command::None,now);check(au.snapshot.state==State::SignedOut,"orphaned cache cannot bypass logout tombstone");
    store.session=backend.result(now);store.session->generation=store.gen;store.session->refreshAfter=now;backend.offline=true;Coordinator offline(store,backend);offline.step(Command::None,now+1);
    check(offline.snapshot.state==State::OfflineCached && store.session && !store.session->verified,"network failure retains accurate cached identity");
    const auto attempts=backend.refreshes;vst3.step(Command::None,now+2);check(vst3.snapshot.state==State::OfflineCached && backend.refreshes==attempts,"offline retry shared across instances");
    backend.offline=false;backend.invalid=true;offline.step(Command::None,now+61000);check(offline.snapshot.state==State::SignedOut && !store.session,"expired/revoked Firebase session removed");backend.invalid=false;
    store.busy=true;check(!au.step(Command::Logout,now),"nonblocking cross-process lock retries command");store.busy=false;
    au.step(Command::SignIn,now);au.step(Command::None,now+1,[]{return true;});check(!store.session,"logout/cancel while network pending cannot commit late result");
    au.step(Command::Cancel,now+2);
    store.session=backend.result(now);store.session->generation=store.gen;store.failErase=true;au.step(Command::Logout,now);check(au.snapshot.state==State::Error,"Keychain delete failure is visible");
    vst3.step(Command::None,now+1);check(vst3.snapshot.state==State::SignedOut,"delete failure still invalidates old generation");
}
#if JUCE_MAC
void keychainRoundTrip(){
    const auto folder=juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("melogic-keychain-test-"+juce::Uuid().toString());
    check(folder.createDirectory().wasOk(),"temporary Keychain directory");
    struct Cleanup {juce::File folder;SecKeychainRef keychain=nullptr;~Cleanup(){if(keychain){SecKeychainDelete(keychain);CFRelease(keychain);}folder.deleteRecursively();}} cleanup{folder};
    const auto password=juce::Uuid().toString()+juce::Uuid().toString();
    check(SecKeychainCreate(folder.getChildFile("fixture.keychain").getFullPathName().toRawUTF8(),UInt32(password.getNumBytesAsUTF8()),password.toRawUTF8(),false,nullptr,&cleanup.keychain)==errSecSuccess,"create isolated unlocked Keychain");
    const juce::String service="test.melogic."+juce::Uuid().toString();
    auto first=makeIsolatedPlatformStore(folder.getChildFile("coordination"),service,cleanup.keychain);
    auto second=makeIsolatedPlatformStore(folder.getChildFile("coordination"),service,cleanup.keychain);
    check(first->tryLock() && !second->tryLock(),"real cross-store flock is nonblocking");
    check(!first->load(),"isolated Keychain starts empty");
    FakeBackend backend;auto session=backend.result(juce::Time::currentTimeMillis());session.generation=juce::Uuid().toString();
    first->save(session,true);first->unlock();check(second->tryLock(),"second store acquires released lock");
    auto restored=second->load();check(restored && restored->refreshToken==session.refreshToken && restored->identity.uid==session.identity.uid && second->generation()==session.generation,"actual Keychain round trip and shared generation");
    session.refreshToken="rotated-fixture-token";second->save(session,false);check(second->load()->refreshToken==session.refreshToken,"Keychain update rotates session");
    second->erase();check(!second->load() && second->generation()!=session.generation,"Keychain logout deletes item and publishes tombstone");second->unlock();
    check(first->tryLock(),"reacquire fixture lock");first->save(session,true);
    auto q=CFDictionaryCreateMutable(nullptr,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
    auto name=CFStringCreateWithCString(nullptr,service.toRawUTF8(),kCFStringEncodingUTF8);
    const void* item=cleanup.keychain;auto list=CFArrayCreate(nullptr,&item,1,&kCFTypeArrayCallBacks);
    CFDictionarySetValue(q,kSecClass,kSecClassGenericPassword);CFDictionarySetValue(q,kSecAttrService,name);CFDictionarySetValue(q,kSecMatchSearchList,list);
    auto attrs=CFDictionaryCreateMutable(nullptr,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
    const char malformed[]="{broken-json";auto data=CFDataCreate(nullptr,reinterpret_cast<const UInt8*>(malformed),sizeof(malformed)-1);CFDictionarySetValue(attrs,kSecValueData,data);
    const auto status=SecItemUpdate(q,attrs);CFRelease(data);CFRelease(attrs);CFRelease(list);CFRelease(name);CFRelease(q);
    check(status==errSecSuccess,"install malformed isolated cache fixture");
    bool rejected=false;try{first->load();}catch(const Failure& f){rejected=f.kind==Failure::Storage;}check(rejected,"malformed Keychain JSON fails closed");first->erase();
}
#endif
void cancellationLifetime(){
    struct Pending {std::mutex mutex;std::condition_variable wake;bool entered=false,cancelled=false;};
    class BlockingBackend final : public Backend {
        std::shared_ptr<Pending> pending_;
    public:
        explicit BlockingBackend(std::shared_ptr<Pending> p):pending_(std::move(p)){}
        Request begin(juce::int64) override {std::unique_lock<std::mutex> lock(pending_->mutex);pending_->cancelled=false;pending_->entered=true;pending_->wake.notify_all();pending_->wake.wait(lock,[&]{return pending_->cancelled;});throw Failure{Failure::Network};}
        Poll poll(const Request&,juce::int64) override{throw Failure{Failure::Network};}
        Session refresh(const Session&,juce::int64) override{throw Failure{Failure::Network};}
        void cancel() noexcept override {std::lock_guard<std::mutex> lock(pending_->mutex);pending_->cancelled=true;pending_->wake.notify_all();}
    };
    auto pending=std::make_shared<Pending>();auto service=std::make_unique<Service>(makeMemoryStore(),std::make_unique<BlockingBackend>(pending));service->signIn();
    {std::unique_lock<std::mutex> lock(pending->mutex);check(pending->wake.wait_for(lock,std::chrono::seconds(3),[&]{return pending->entered;}),"worker entered pending transport");}
    const auto start=std::chrono::steady_clock::now();service.reset();check(std::chrono::steady_clock::now()-start<std::chrono::seconds(1),"shutdown interrupts pending transport and joins promptly");
}
void lifetimes(){
    Service::useInMemoryForTesting();auto standalone=Service::shared(),au=Service::shared(),vst3=Service::shared();
    check(standalone==au && au==vst3,"process-level service is shared, not per editor");
    standalone->signIn();standalone.reset();au->cancel();au.reset();check(vst3!=nullptr,"editor destruction does not destroy shared pending service");
    for(int i=0;i<50;++i){auto s=std::make_unique<Service>(makeMemoryStore(),std::make_unique<FakeBackend>());s->signIn();s->cancel();s->logout();}
    check(true,"shutdown joins worker and pending operations safely");
}
}
int main(){try{scenarios();lifetimes();cancellationLifetime();
#if JUCE_MAC
keychainRoundTrip();
#endif
std::cout<<"PASS account "<<checks<<" checks\n";return 0;}catch(const std::exception& e){std::cerr<<"FAIL account: "<<e.what()<<'\n';return 1;}}
