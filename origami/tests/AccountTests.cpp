#include <melogic/account/AccountService.h>
#include <iostream>
#if JUCE_MAC
#include <Security/Security.h>
#endif
#include <stdexcept>
namespace melogic::account {
class UpdateBridgeTestAccess {public:static std::unique_ptr<AuthenticatedUpdateRequest> make(std::unique_ptr<Backend> b){return std::unique_ptr<AuthenticatedUpdateRequest>(new AuthenticatedUpdateRequest(std::move(b)));}};
}
using namespace melogic::account;
#if JUCE_MAC
bool accountAutoreleaseScopeRegression();
#endif
namespace {
unsigned checks=0;
void check(bool ok,const char* text){++checks;if(!ok)throw std::runtime_error(text);}
class FakeStore final : public Store {
public:
    bool busy=false,failRead=false,failWrite=false,failErase=false;
    unsigned loads=0;
    juce::String gen="initial";std::optional<Session> session;
    bool tryLock() override{return !busy;}
    void unlock() noexcept override{}
    juce::String generation() override{return gen;}
    std::optional<Session> load(bool=false) override{++loads;if(failRead)throw Failure{Failure::Storage};return session;}
    void save(const Session& s,bool) override{if(failWrite)throw Failure{Failure::Storage};session=s;gen=s.generation;}
    void erase() override{gen=juce::Uuid().toString();if(failErase)throw Failure{Failure::Storage};session.reset();}
};
class FakeBackend final : public Backend {
public:
    Failure::Kind updateFailure=Failure::Network;
    juce::var releaseDownload(const juce::var& v,const juce::String& token) override {return checkUpdates(v,token);}
    juce::var checkUpdates(const juce::var&,const juce::String& token) override {check(token=="fixture-access-token","bridge passes token only to private transport");throw Failure{updateFailure};}
    bool offline=false,invalid=false,mismatch=false,denied=false,waiting=false;
    unsigned refreshes=0,begins=0,licenseChecks=0,redemptions=0;bool licensed=false;
    std::function<void()> duringRefresh;
    Session result(juce::int64 now){Session s;s.identity={"fixture-uid","Fixture Person","fixture@example.invalid",{}};s.accessToken="fixture-access-token";s.accessExpiresAt=now+3600000;s.refreshToken="fixture-only-not-a-real-token";s.verified=true;s.validatedAt=now;s.refreshAfter=now+3000000;return s;}
    Request begin(juce::int64 now) override{++begins;if(offline)throw Failure{Failure::Network};Request r;r.id=juce::String::repeatedString("a",64);r.verifier=juce::String::repeatedString("b",64);r.expiresAt=now+300000;r.browserURL="https://melogicrecords.studio/auth/desktop?request="+r.id;return r;}
    Poll poll(const Request& r,juce::int64 now) override{if(offline)throw Failure{Failure::Network};Poll p;p.requestId=mismatch?"injected":r.id;p.status=waiting?Poll::Pending:denied?Poll::Cancelled:Poll::Approved;p.session=result(now);return p;}
    Authorization authorization(Session&,juce::int64 now) override {++licenseChecks;if(offline)throw Failure{Failure::Network};return licensed?Authorization{AuthorizationState::Authorized,"beta","Origami activated / Beta",now+900000}:Authorization{AuthorizationState::Unauthorized,{},"Account signed in; Origami is not licensed.",0};}
    Authorization redeem(Session& session,const juce::String& key,juce::int64 now) override {++redemptions;if(key!="fixture-redemption-input-not-an-issued-key")throw Failure{Failure::InvalidKey};licensed=true;return authorization(session,now);}
    Session refresh(const Session&,juce::int64 now) override{++refreshes;if(duringRefresh)duringRefresh();if(offline)throw Failure{Failure::Network};if(invalid)throw Failure{Failure::InvalidSession};return result(now);}
};
void updateBridgeIsolation(){
    auto store=std::make_unique<FakeStore>();auto backend=std::make_unique<FakeBackend>();backend->licensed=true;
    auto session=backend->result(juce::Time::currentTimeMillis());session.generation=store->gen;store->session=session;
    Service service(std::move(store),std::move(backend));
    for(int n=0;n<1000 && !service.authorizationFlag()->load();++n)std::this_thread::sleep_for(std::chrono::milliseconds(1));
    check(service.authorizationFlag()->load(),"isolated account authorized before update failures");
    const auto before=service.snapshot();auto isolatedBackend=std::make_unique<FakeBackend>();auto* isolated=isolatedBackend.get();auto request=UpdateBridgeTestAccess::make(std::move(isolatedBackend));
    for(auto kind:{Failure::Network,Failure::Timeout,Failure::ServerUnavailable,Failure::InvalidSession,Failure::Protocol,Failure::Cancelled}){
        isolated->updateFailure=kind;bool downloadFailed=false;try{service.releaseDownload(juce::var{},*request);}catch(const Failure&){downloadFailed=true;}check(downloadFailed,"download bridge failure stays outside account state");bool failed=false;try{service.checkUpdates(juce::var{},*request);}catch(const Failure&){failed=true;}
        check(failed && service.authorizationFlag()->load() && service.snapshot().state==before.state && service.snapshot().authorization.validUntil==before.authorization.validUntil,"every update failure leaves authorization and account unchanged");
    }
    service.shutdown();bool stopped=false;try{service.checkUpdates(juce::var{},*request);}catch(const Failure&){stopped=true;}check(stopped,"terminal account shutdown denies new update bridge calls");
}
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
    store.failRead=true;au.step(Command::None,now);check(au.snapshot.state==State::Error,"Keychain read failure");
    const auto deniedReads=store.loads;
    for(int i=1;i<=30;++i)au.step(Command::None,now+i*2000);
    check(store.loads==deniedReads,"denied secure-store access never automatically repeats OS prompts");
    store.failRead=false;au.step(Command::Restore,now);check(au.snapshot.state==State::SignedOut && !au.snapshot.storageError,"user-initiated Keychain retry recovers without browser login");
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
void authorizationScenarios(){
    constexpr juce::int64 now=1000000;
    check(boundedServerDeadline(now+300001,now,300000)==now+300000,"network transit does not reject a valid login deadline or extend lifetime");
    check(boundedServerDeadline(now+900025,now,900000)==now+900000,"authorization lease tolerates bounded skew and clamps lifetime");
    for(auto deadline:{now,now+930001}){bool rejected=false;try{boundedServerDeadline(deadline,now,900000);}catch(const Failure&){rejected=true;}check(rejected,"expired/implausible deadline rejected");}
    FakeStore store;FakeBackend backend;Coordinator first(store,backend),second(store,backend),third(store,backend);
    first.step(Command::None,now);check(first.snapshot.authorization.state==AuthorizationState::Unauthorized,"startup is gated");
    first.step(Command::SignIn,now);check(first.snapshot.authorization.state==AuthorizationState::Authenticating,"pending auth is not authorization");first.step(Command::None,now+1);
    check(first.snapshot.state==State::SignedIn && first.snapshot.authorization.state==AuthorizationState::Unauthorized,"Firebase identity alone cannot authorize");
    second.step(Command::None,now+2);third.step(Command::None,now+2);const auto generation=store.gen;
    first.step(Command::Redeem,now+3,[]{return false;},"bad");check(first.snapshot.authorization.state==AuthorizationState::Error && store.gen==generation,"invalid key fails without changing session generation");
    first.step(Command::Redeem,now+4,[]{return false;},"fixture-redemption-input-not-an-issued-key");check(first.snapshot.authorization.state==AuthorizationState::Authorized && store.gen!=generation,"trusted redemption authorizes and propagates new generation");
    second.step(Command::None,now+5);third.step(Command::None,now+5);check(second.snapshot.authorization.state==AuthorizationState::Authorized && third.snapshot.authorization.state==AuthorizationState::Authorized,"three format-facing coordinators adopt shared activation");
    second.step(Command::Logout,now+6);first.step(Command::None,now+7);third.step(Command::None,now+7);check(first.snapshot.authorization.state==AuthorizationState::Unauthorized && third.snapshot.authorization.state==AuthorizationState::Unauthorized && backend.licensed,"logout closes all account gates without revoking permanent ownership");
    first.step(Command::Redeem,now+8,[]{return false;},"fixture-redemption-input-not-an-issued-key");check(first.snapshot.authorization.state==AuthorizationState::Unauthorized && backend.redemptions==2,"signed-out key cannot create an anonymous grant");
    // Real worker publication is distinct from the coordinator's UI snapshot.
    auto fake=std::make_unique<FakeBackend>();fake->licensed=true;auto service=std::make_unique<Service>(makeMemoryStore(),std::move(fake));auto signal=service->authorizationFlag();check(!signal->load(),"shared atomic starts closed");service->signIn();
    const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(6);while(!signal->load() && std::chrono::steady_clock::now()<end)std::this_thread::sleep_for(std::chrono::milliseconds(10));check(signal->load(),"validated worker result publishes realtime authorization");service->logout();check(!signal->load(),"logout closes realtime flag immediately before storage IO");
}
void postTransportRegression(){
    // Exercise JUCE's actual request serialization against a loopback fixture.
    // No Firebase credential, browser callback listener or network dependency.
    juce::StreamingSocket listener;check(listener.createListener(0,"127.0.0.1"),"HTTP fixture listener");
    const auto port=listener.getBoundPort();std::string captured;std::thread server([&]{
        if(listener.waitUntilReady(true,3000)<=0)return;
        std::unique_ptr<juce::StreamingSocket> client(listener.waitForNextConnection());if(!client)return;
        char bytes[2048];while(captured.find("\r\n\r\n")==std::string::npos && client->waitUntilReady(true,3000)>0){int n=client->read(bytes,sizeof(bytes),false);if(n<=0)return;captured.append(bytes,size_t(n));}
        const auto bodyStart=captured.find("\r\n\r\n");const auto lower=juce::String(captured).toLowerCase();const int length=lower.fromFirstOccurrenceOf("content-length:",false,false).getIntValue();
        while(bodyStart!=std::string::npos && captured.size()<bodyStart+4+size_t(length) && client->waitUntilReady(true,3000)>0){int n=client->read(bytes,sizeof(bytes),false);if(n<=0)break;captured.append(bytes,size_t(n));}
        const char response[]="HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}";client->write(response,int(sizeof(response)-1));
    });
    auto ownedStream=makeAuthPostStream("http://127.0.0.1:"+juce::String(port)+"/fixture?key=public-fixture-id","{\"token\":\"invalid-fixture-only\"}");auto& stream=*ownedStream;
    stream.withCustomRequestCommand("POST").withConnectionTimeout(2000).withExtraHeaders("Content-Type: application/json\r\n");const bool connected=stream.connect(nullptr);server.join();
    check(connected && stream.getStatusCode()==200,"native POST connects to deterministic fixture");
    check(captured.find("POST /fixture?key=public-fixture-id ")!=std::string::npos,"Firebase API-key query remains in request URL");
    const auto body=captured.substr(captured.find("\r\n\r\n")+4);check(body=="{\"token\":\"invalid-fixture-only\"}","query does not corrupt the JSON POST body");
}
void slowResponseRegression(){
    // Reproduce the live latency mismatch using the actual macOS JUCE transport.
    for (bool legacy : {true, false}) {
        juce::StreamingSocket listener;
        check(listener.createListener(0,"127.0.0.1"),"slow-response fixture listener");
        std::thread server([&]{
            if(listener.waitUntilReady(true,5000)<=0)return;
            std::unique_ptr<juce::StreamingSocket> client(listener.waitForNextConnection());
            if(!client)return;
            char request[2048];client->read(request,sizeof(request),false);
            std::this_thread::sleep_for(std::chrono::milliseconds(3000));
            const char response[]="HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}";
            client->write(response,int(sizeof(response)-1));
        });
        auto stream=makeAuthPostStream("http://127.0.0.1:"+juce::String(listener.getBoundPort())+"/slow","{}");
        stream->withExtraHeaders("Content-Type: application/json\r\n");
        if(legacy)stream->withConnectionTimeout(2000);
        const bool connected=stream->connect(nullptr);
        const auto response=connected?stream->readEntireStreamAsString():juce::String{};
        server.join();
        check(legacy?!connected:(connected && response=="{}"),"legacy timeout rejects slow response; repaired transport accepts it");
    }
}
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
    const auto start=std::chrono::steady_clock::now();service->shutdown();service->shutdown();service.reset();check(std::chrono::steady_clock::now()-start<std::chrono::seconds(1),"shutdown interrupts pending transport and joins promptly");
}
void shutdownPreservesSession(){
    class SharedStore final : public Store {
        std::shared_ptr<FakeStore> store;
    public:
        explicit SharedStore(std::shared_ptr<FakeStore> s):store(std::move(s)){}
        bool tryLock() override{return store->tryLock();}
        void unlock() noexcept override{store->unlock();}
        juce::String generation() override{return store->generation();}
        std::optional<Session> load(bool interactive=false) override{return store->load(interactive);}
        void save(const Session& s,bool interactive) override{store->save(s,interactive);}
        void erase() override{store->erase();}
    };
    auto disk=std::make_shared<FakeStore>();FakeBackend seed;
    disk->session=seed.result(juce::Time::currentTimeMillis());disk->session->generation=disk->gen;
    for(int i=0;i<2;++i){
        auto backend=std::make_unique<FakeBackend>();backend->licensed=true;
        Service service(std::make_unique<SharedStore>(disk),std::move(backend));
        const auto deadline=juce::Time::getMillisecondCounter()+3000;
        while(!service.authorizationFlag()->load() && juce::Time::getMillisecondCounter()<deadline)juce::Thread::sleep(1);
        check(service.authorizationFlag()->load(),"persisted session restores authorization across runtime lifetimes");
        service.shutdown();
        check(disk->session && disk->session->refreshToken.isNotEmpty() && disk->session->identity.uid=="fixture-uid",
              "normal shutdown keeps stored identity and refresh credentials");
    }
}
void shutdownStress(){
    auto terminalBackend=makeFirebaseBackend();terminalBackend->shutdown();
    bool cancelled=false;
    try{terminalBackend->begin(juce::Time::currentTimeMillis());}
    catch(const Failure& f){cancelled=f.kind==Failure::Cancelled;}
    check(cancelled,"terminal transport shutdown cannot start a new request");
    // No UI observers/callback queue exists: publication is polled under mutex.
    for(int i=0;i<1000;++i){
        auto s=std::make_unique<Service>(makeMemoryStore(),std::make_unique<FakeBackend>());
        if(i%2){s->signIn();s->cancel();s->restoreAccess();}
        std::thread other([&]{s->shutdown();});
        s->shutdown();other.join();s->shutdown();
        const auto before=s->snapshot().state;
        s->signIn();s->redeem("fixture");s->restoreAccess();s->logout();
        check(s->snapshot().state==before && s->takeBrowserURL().isEmpty()
              && !s->authorizationFlag()->load(),"stopped service rejects work and browser publication");
    }
    bool rejected=false;
    try{Service invalid(nullptr,std::make_unique<FakeBackend>());}catch(const std::invalid_argument&){rejected=true;}
    check(rejected,"partial initialization rejects missing store before starting thread");
    class ThrowingStore final : public Store {
    public:
        bool tryLock() override{throw std::runtime_error("fixture initialization failure");}
        void unlock() noexcept override{}
        juce::String generation() override{return {};}
        std::optional<Session> load(bool=false) override{return {};}
        void save(const Session&,bool) override{}
        void erase() override{}
    };
    {Service failed(std::make_unique<ThrowingStore>(),std::make_unique<FakeBackend>());
     juce::Thread::sleep(5);failed.shutdown();failed.shutdown();}
    check(true,"unexpected store exception is contained and shutdown remains safe");
}
void lifetimes(){
    Service::useInMemoryForTesting();auto standalone=Service::shared(),au=Service::shared(),vst3=Service::shared();
    check(standalone==au && au==vst3,"process-level service is shared, not per editor");
    standalone->signIn();standalone.reset();au->cancel();au.reset();check(vst3!=nullptr,"editor destruction does not destroy shared pending service");
    for(int i=0;i<50;++i){auto s=std::make_unique<Service>(makeMemoryStore(),std::make_unique<FakeBackend>());s->signIn();s->cancel();s->logout();}
    check(true,"shutdown joins worker and pending operations safely");
    std::weak_ptr<Service> lifetime=vst3;
    Service::releaseInMemoryForTesting();
    check(!lifetime.expired(),"last live plugin owner keeps shared service alive");
    vst3.reset();
    check(lifetime.expired(),"weak registry does not retain a worker after last plugin owner");
}
}
int main(int argc,char** argv){
#if JUCE_MAC
if(argc==2 && juce::String(argv[1])=="--pool-only")return accountAutoreleaseScopeRegression()?0:1;
#endif
if(argc==2 && juce::String(argv[1])=="--probe-firebase-transport"){
    const auto config=juce::JSON::parse(juce::File::getCurrentWorkingDirectory().getChildFile("config/firebase-client.json"));
    const auto endpoint="https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key="+config["apiKey"].toString();
    const juce::String body="{\"token\":\"invalid-diagnostic-fixture-only\",\"returnSecureToken\":true}";
    for(bool legacy:{true,false}){auto stream=legacy?std::make_unique<juce::WebInputStream>(juce::URL(endpoint).withPOSTData(body),true):makeAuthPostStream(endpoint,body);stream->withCustomRequestCommand("POST").withConnectionTimeout(2000).withExtraHeaders("Content-Type: application/json\r\n");const bool connected=stream->connect(nullptr);const auto response=connected?stream->readEntireStreamAsString():juce::String{};std::cout<<(legacy?"legacy":"repaired")<<" HTTP="<<stream->getStatusCode()<<" reached_invalid_custom_token="<<response.contains("INVALID_CUSTOM_TOKEN")<<" api_identifier_rejected="<<(response.containsIgnoreCase("API key") || response.contains("API_KEY"))<<"\n";}
    return 0;
}if(argc==2 && juce::String(argv[1])=="--probe-login"){try{auto backend=makeFirebaseBackend();backend->begin(juce::Time::currentTimeMillis());std::cout<<"begin_login accepted (request/proof intentionally omitted)\n";return 0;}catch(const Failure& f){std::cout<<"probe stage="<<f.stage<<" HTTP="<<f.httpStatus<<" kind="<<int(f.kind)<<"\n";return 2;}}try{updateBridgeIsolation();scenarios();lifetimes();shutdownStress();shutdownPreservesSession();cancellationLifetime();authorizationScenarios();postTransportRegression();slowResponseRegression();
#if JUCE_MAC
keychainRoundTrip();
check(accountAutoreleaseScopeRegression(),"50 native autorelease units drain on creator worker before shutdown");
#endif
std::cout<<"PASS account "<<checks<<" checks\n";return 0;}catch(const std::exception& e){std::cerr<<"FAIL account: "<<e.what()<<'\n';return 1;}}
