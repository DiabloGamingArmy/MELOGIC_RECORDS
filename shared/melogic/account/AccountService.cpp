#include "AccountService.h"

namespace melogic::account {
namespace {
struct Lock {
    Store& store; bool held;
    explicit Lock(Store& s):store(s),held(s.tryLock()){}
    ~Lock(){if(held)store.unlock();}
};
bool valid(const Session& s) {return s.identity.uid.isNotEmpty() && s.identity.uid.length()<=128 && s.refreshToken.isNotEmpty() && s.refreshToken.length()<16384;}
void error(Snapshot& s,Failure::Kind kind) {
    s.state=State::Error;
    s.storageError=kind==Failure::Storage;
    s.message=kind==Failure::Storage ? "Keychain or shared-session access failed. Try signing in again." : "Sign-in could not be completed. Try again.";
}
class MemoryStore final : public Store {
    std::mutex mutex_; juce::String generation_="initial"; std::optional<Session> session_;
public:
    bool tryLock() override{return mutex_.try_lock();}
    void unlock() noexcept override{mutex_.unlock();}
    juce::String generation() override{return generation_;}
    std::optional<Session> load(bool=false) override{return session_;}
    void save(const Session& s,bool) override{session_=s;generation_=s.generation;}
    void erase() override{session_.reset();generation_=juce::Uuid().toString();}
};
class UnavailableBackend final : public Backend {
public:
    Request begin(juce::int64) override{throw Failure{Failure::Network};}
    Poll poll(const Request&,juce::int64) override{throw Failure{Failure::Network};}
    Session refresh(const Session&,juce::int64) override{throw Failure{Failure::Network};}
};
std::mutex sharedMutex;
std::shared_ptr<Service>& sharedSlot(){static std::shared_ptr<Service> value;return value;}
}
std::unique_ptr<Store> makeMemoryStore(){return std::make_unique<MemoryStore>();}
Coordinator::Coordinator(Store& store,Backend& backend):store_(store),backend_(backend){}
bool Coordinator::step(Command command,juce::int64 now,const std::function<bool()>& stale) {
    try {
        if(command==Command::Restore)retryAfter_=0;
        if(command==Command::Cancel){request_.reset();browserURL.clear();retryAfter_=0;}
        Lock lock(store_);if(!lock.held)return false;
        if(command==Command::Logout){request_.reset();browserURL.clear();store_.erase();restored_=false;snapshot={State::SignedOut,{},"Not signed in",{}};return true;}
        if(command==Command::SignIn){
            retryAfter_=0;
            startingGeneration_=store_.generation();request_=backend_.begin(now);
            if(stale()){request_.reset();return true;}
            const auto& r=*request_;
            if(r.id.length()!=64 || r.verifier.length()<43 || r.expiresAt<=now || r.expiresAt>now+300000
               || r.browserURL!="https://melogicrecords.studio/auth/desktop?request="+r.id)throw Failure{Failure::Protocol};
            browserURL=r.browserURL;snapshot.state=State::AwaitingBrowser;snapshot.verificationCode=r.id.substring(0,8).toUpperCase();
            snapshot.message="Complete sign-in in your browser. Match code "+snapshot.verificationCode;return true;
        }
        if(request_){
            if(now>=request_->expiresAt || startingGeneration_!=store_.generation()){
                request_.reset();browserURL.clear();snapshot.verificationCode.clear();snapshot.message="Login expired or shared session changed. Start again.";snapshot.state=State::Error;return true;
            }
            const auto result=backend_.poll(*request_,now);if(stale())return true;
            if(result.requestId!=request_->id)throw Failure{Failure::Protocol};
            if(result.status==Poll::Pending)return true;
            request_.reset();browserURL.clear();snapshot.verificationCode.clear();
            if(result.status==Poll::Cancelled){snapshot={State::SignedOut,{},"Login cancelled",{}};return true;}
            auto s=result.session;if(!valid(s) || !s.verified)throw Failure{Failure::Protocol};
            s.generation=juce::Uuid().toString();store_.save(s,true);restored_=true;retryAfter_=0;snapshot={State::SignedIn,s.identity,"Signed in to Melogic",{}};return true;
        }
        auto s=store_.load(command==Command::Restore);
        snapshot.storageError=false;
        if(!s || s->generation!=store_.generation() || !valid(*s)){restored_=false;snapshot={State::SignedOut,{},"Not signed in",{}};return true;}
        snapshot.identity=s->identity;
        snapshot.state=s->verified ? State::SignedIn : State::OfflineCached;
        snapshot.message=s->verified ? "Signed in to Melogic" : "Offline — cached identity; session not currently verified";
        const bool restoreRefresh=!restored_ && s->verified && now-s->validatedAt>30000;
        restored_=true;
        if((now<s->refreshAfter && !restoreRefresh) || now<retryAfter_)return true;
        snapshot.state=State::Refreshing;
        try {
            auto fresh=backend_.refresh(*s,now);if(stale())return true;
            if(!valid(fresh) || !fresh.verified || fresh.identity.uid!=s->identity.uid)throw Failure{Failure::InvalidSession};
            fresh.generation=s->generation;store_.save(fresh,false);snapshot={State::SignedIn,fresh.identity,"Signed in to Melogic",{}};
        } catch(const Failure& f){
            if(stale())return true;
            if(f.kind==Failure::InvalidSession){store_.erase();snapshot={State::SignedOut,{},"Session expired or revoked. Sign in again.",{}};}
            else if(f.kind==Failure::Network){s->verified=false;s->refreshAfter=now+60000;store_.save(*s,false);snapshot={State::OfflineCached,s->identity,"Offline — cached identity; session not currently verified",{}};}
            else throw;
        }
    } catch(const Failure& f){request_.reset();browserURL.clear();snapshot.verificationCode.clear();error(snapshot,f.kind);retryAfter_=now+60000;}
    catch(...){request_.reset();browserURL.clear();snapshot.verificationCode.clear();error(snapshot,Failure::Protocol);retryAfter_=now+60000;}
    return true;
}
Service::Service(std::unique_ptr<Store> store,std::unique_ptr<Backend> backend)
    :store_(std::move(store)),backend_(std::move(backend)),worker_([this]{run();}){}
Service::~Service(){{std::lock_guard<std::mutex> lock(mutex_);stop_=true;++epoch_;}backend_->cancel();wake_.notify_one();worker_.join();}
Snapshot Service::snapshot() const {std::lock_guard<std::mutex> lock(mutex_);return snapshot_;}
juce::String Service::takeBrowserURL(){std::lock_guard<std::mutex> lock(mutex_);auto url=browserURL_;browserURL_.clear();return url;}
void Service::submit(Command c){{std::lock_guard<std::mutex> lock(mutex_);command_=c;++epoch_;browserURL_.clear();if(c==Command::Logout)snapshot_.state=State::SigningOut;}backend_->cancel();wake_.notify_one();}
void Service::restoreAccess(){submit(Command::Restore);}
void Service::signIn(){submit(Command::SignIn);}void Service::cancel(){submit(Command::Cancel);}void Service::logout(){submit(Command::Logout);}
void Service::run(){
    Coordinator controller(*store_,*backend_);
    for(;;){
        Command cmd;unsigned epoch;
        {std::unique_lock<std::mutex> lock(mutex_);if(stop_)return;cmd=command_;epoch=epoch_;}
        const auto stale=[this,epoch]{std::lock_guard<std::mutex> lock(mutex_);return stop_ || epoch_!=epoch;};
        const bool handled=controller.step(cmd,juce::Time::currentTimeMillis(),stale);
        {std::unique_lock<std::mutex> lock(mutex_);if(stop_)return;
         if(epoch_==epoch){snapshot_=controller.snapshot;if(controller.browserURL.isNotEmpty()){browserURL_=controller.browserURL;controller.browserURL.clear();}if(handled)command_=Command::None;}
         wake_.wait_for(lock,std::chrono::seconds(2),[&]{return stop_ || epoch_!=epoch;});}
    }
}
std::shared_ptr<Service> Service::shared(){std::lock_guard<std::mutex> lock(sharedMutex);auto& value=sharedSlot();if(!value)value=std::make_shared<Service>(makePlatformStore(),makeFirebaseBackend());return value;}
void Service::useInMemoryForTesting(std::unique_ptr<Backend> backend){std::lock_guard<std::mutex> lock(sharedMutex);sharedSlot()=std::make_shared<Service>(makeMemoryStore(),backend ? std::move(backend) : std::make_unique<UnavailableBackend>());}
}
