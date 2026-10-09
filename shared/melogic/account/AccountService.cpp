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
    switch(kind) {
        case Failure::Storage:s.message="Your session could not be saved or read securely. Retry account access.";break;
        case Failure::Network:s.message="Melogic could not be reached. Check your connection and retry.";break;
        case Failure::ServiceUnavailable:s.message="Melogic desktop sign-in is unavailable. Contact Melogic support.";break;
        case Failure::InvalidSession:s.message="Your session expired or was revoked. Sign in again.";break;
        default:s.message="The authentication response could not be verified. Start a new sign-in.";break;
    }
    s.authorization={AuthorizationState::Error,{},s.message,0};
}
}
std::mutex& Service::sharingMutex(){static std::mutex mutex;return mutex;}
std::shared_ptr<Service>& Service::sharedSlot(){static std::shared_ptr<Service> value;return value;}
Coordinator::Coordinator(Store& store,Backend& backend):store_(store),backend_(backend){}
bool Coordinator::step(Command command,juce::int64 now,const std::function<bool()>& stale,const juce::String& key) {
    try {
        if(command==Command::Restore)retryAfter_=0;
        if(command==Command::Cancel){request_.reset();browserURL.clear();retryAfter_=0;}
        Lock lock(store_);if(!lock.held)return false;
        if(command==Command::Logout){request_.reset();browserURL.clear();store_.erase();restored_=false;snapshot={State::SignedOut,{},"Not signed in",{}};snapshot.authorization={AuthorizationState::Unauthorized,{},"Activate Origami to continue.",0};authorizedGeneration_.clear();transient_.reset();return true;}
        if(command==Command::SignIn){
            retryAfter_=0;
            snapshot.authorization={AuthorizationState::Authenticating,{},"Starting browser sign-in...",0};
            startingGeneration_=store_.generation();request_=backend_.begin(now);
            if(stale()){request_.reset();return true;}
            const auto& r=*request_;
            if(r.id.length()!=64 || r.verifier.length()<43 || r.expiresAt<=now || r.expiresAt>now+300000
               || r.browserURL!="https://melogicrecords.studio/auth/desktop?request="+r.id)throw Failure{Failure::Protocol};
            browserURL=r.browserURL;snapshot.state=State::AwaitingBrowser;snapshot.verificationCode=r.id.substring(0,8).toUpperCase();
            snapshot.message="Complete sign-in in your browser. Match code "+snapshot.verificationCode;snapshot.authorization.message=snapshot.message;return true;
        }
        if(request_){
            if(now>=request_->expiresAt || startingGeneration_!=store_.generation()){
                request_.reset();browserURL.clear();snapshot.verificationCode.clear();snapshot.message="Login expired or shared session changed. Start again.";snapshot.state=State::Error;snapshot.authorization={AuthorizationState::Error,{},snapshot.message,0};return true;
            }
            const auto result=backend_.poll(*request_,now);if(stale())return true;
            if(result.requestId!=request_->id)throw Failure{Failure::Protocol};
            if(result.status==Poll::Pending)return true;
            request_.reset();browserURL.clear();snapshot.verificationCode.clear();
            if(result.status==Poll::Cancelled){snapshot={State::SignedOut,{},"Login cancelled",{}};snapshot.authorization={AuthorizationState::Unauthorized,{},snapshot.message,0};return true;}
            auto s=result.session;if(!valid(s) || !s.verified)throw Failure{Failure::Protocol};
            s.generation=juce::Uuid().toString();store_.save(s,true);restored_=true;retryAfter_=0;snapshot={State::SignedIn,s.identity,"Signed in to Melogic",{}};checkAuthorization(s,now,true,{},stale);return true;
        }
        auto s=store_.load(command==Command::Restore);
        if(command==Command::Restore)authorizationRetry_=0;
        snapshot.storageError=false;
        if(!s || s->generation!=store_.generation() || !valid(*s)){restored_=false;snapshot={State::SignedOut,{},"Not signed in",{}};snapshot.authorization={AuthorizationState::Unauthorized,{},"Activate Origami to continue.",0};authorizedGeneration_.clear();transient_.reset();return true;}
        if(s->generation!=authorizedGeneration_) {snapshot.authorization={AuthorizationState::Restoring,{},"Checking Origami entitlement...",0};authorizationRetry_=0;transient_.reset();}
        if(transient_ && transient_->generation==s->generation && transient_->refreshToken==s->refreshToken){s->accessToken=transient_->accessToken;s->accessExpiresAt=transient_->accessExpiresAt;}
        snapshot.identity=s->identity;
        snapshot.state=s->verified ? State::SignedIn : State::OfflineCached;
        snapshot.message=s->verified ? "Signed in to Melogic" : "Offline — cached identity; session not currently verified";
        const bool restoreRefresh=!restored_ && s->verified && now-s->validatedAt>30000;
        restored_=true;
        if((now<s->refreshAfter && !restoreRefresh) || now<retryAfter_) {
            if(s->verified)checkAuthorization(*s,now,(command==Command::Redeem || command==Command::Restore || command==Command::Cancel),key,stale);
            else snapshot.authorization={AuthorizationState::Unauthorized,{},"Offline cached identity cannot verify an Origami license. Reconnect and retry.",0};
            return true;
        }
        snapshot.state=State::Refreshing;
        try {
            auto fresh=backend_.refresh(*s,now);if(stale())return true;
            if(!valid(fresh) || !fresh.verified || fresh.identity.uid!=s->identity.uid)throw Failure{Failure::InvalidSession};
            fresh.generation=s->generation;store_.save(fresh,false);snapshot.state=State::SignedIn;snapshot.identity=fresh.identity;snapshot.message="Signed in to Melogic";checkAuthorization(fresh,now,(command==Command::Redeem || command==Command::Restore || command==Command::Cancel),key,stale);
        } catch(const Failure& f){
            if(stale())return true;
            if(f.kind==Failure::InvalidSession){store_.erase();snapshot={State::SignedOut,{},"Session expired or revoked. Sign in again.",{}};snapshot.authorization={AuthorizationState::Unauthorized,{},snapshot.message,0};}
            else if(f.kind==Failure::Network){s->verified=false;s->refreshAfter=now+60000;store_.save(*s,false);snapshot={State::OfflineCached,s->identity,"Offline — cached identity; session not currently verified",{}};snapshot.authorization={AuthorizationState::Unauthorized,{},snapshot.message,0};}
            else throw;
        }
    } catch(const Failure& f){request_.reset();browserURL.clear();snapshot.verificationCode.clear();error(snapshot,f.kind);retryAfter_=now+60000;}
    catch(...){request_.reset();browserURL.clear();snapshot.verificationCode.clear();error(snapshot,Failure::Protocol);retryAfter_=now+60000;}
    return true;
}
void Coordinator::checkAuthorization(Session& session,juce::int64 now,bool force,const juce::String& key,const std::function<bool()>& stale) {
    if(!force && (now<authorizationRetry_ || (snapshot.authorization.state==AuthorizationState::Authorized && now<snapshot.authorization.validUntil-60000)))return;
    try {
        const auto result=key.isEmpty()?backend_.authorization(session,now):backend_.redeem(session,key,now);
        if(stale())return;
        if(result.state==AuthorizationState::Authorized && (result.edition!="beta" || result.validUntil<=now || result.validUntil>now+900000))throw Failure{Failure::Protocol};
        snapshot.authorization=result;if(!key.isEmpty() && result.state==AuthorizationState::Authorized)session.generation=juce::Uuid().toString();authorizedGeneration_=session.generation;transient_=session;
        // Token rotation during the authenticated entitlement request persists securely.
        store_.save(session,false);
        authorizationRetry_=now+(result.state==AuthorizationState::Authorized?0:60000);
    } catch(const Failure& f) {
        if(stale())return;
        const char* message="Unable to check Origami access. Retry activation.";
        switch(f.kind){
            case Failure::Network:message="Unable to reach Melogic. Check your connection and retry.";break;
            case Failure::ServiceUnavailable:message="Melogic activation service is unavailable. Contact support.";break;
            case Failure::InvalidKey:message="Invalid license key.";break;
            case Failure::UsedKey:message="This license key has already been redeemed.";break;
            case Failure::WrongProduct:message="This license is not valid for Origami beta.";break;
            case Failure::ExpiredKey:message="This license key has expired.";break;
            case Failure::KeyUnavailable:message="This license key or account entitlement is unavailable.";break;
            case Failure::InvalidSession:message="Sign in again before activating Origami.";break;
            case Failure::Storage:message="Your session could not be saved securely. Retry account access.";snapshot.storageError=true;break;
            default:break;
        }
        snapshot.authorization={AuthorizationState::Error,{},message,0};authorizationRetry_=now+60000;authorizedGeneration_=session.generation;
    }
}
Service::Service(std::unique_ptr<Store> store,std::unique_ptr<Backend> backend)
    :store_(std::move(store)),backend_(std::move(backend)),worker_([this]{run();}){}
Service::~Service(){{std::lock_guard<std::mutex> lock(mutex_);stop_=true;++epoch_;}backend_->cancel();wake_.notify_one();worker_.join();}
Snapshot Service::snapshot() const {std::lock_guard<std::mutex> lock(mutex_);return snapshot_;}
juce::String Service::takeBrowserURL(){std::lock_guard<std::mutex> lock(mutex_);auto url=browserURL_;browserURL_.clear();return url;}
void Service::submit(Command c,const juce::String& key){{std::lock_guard<std::mutex> lock(mutex_);command_=c;key_=key;++epoch_;browserURL_.clear();if(c==Command::Logout || c==Command::SignIn || c==Command::Redeem)authorized_->store(false,std::memory_order_release);if(c==Command::SignIn){snapshot_.state=State::AwaitingBrowser;snapshot_.message="Starting secure browser sign-in...";snapshot_.verificationCode.clear();snapshot_.authorization={AuthorizationState::Authenticating,{},snapshot_.message,0};}if(c==Command::Restore){authorized_->store(false,std::memory_order_release);snapshot_.state=State::Restoring;snapshot_.message="Checking account and Origami access...";snapshot_.authorization={AuthorizationState::Restoring,{},snapshot_.message,0};}if(c==Command::Redeem)snapshot_.authorization={AuthorizationState::RedeemingKey,{},"Checking license...",0};if(c==Command::Logout)snapshot_.state=State::SigningOut;}backend_->cancel();wake_.notify_one();}
void Service::redeem(const juce::String& key){submit(Command::Redeem,key.trim());}
void Service::restoreAccess(){submit(Command::Restore);}
void Service::signIn(){submit(Command::SignIn);}void Service::cancel(){submit(Command::Cancel);}void Service::logout(){submit(Command::Logout);}
void Service::run(){
    Coordinator controller(*store_,*backend_);
    for(;;){
        Command cmd;unsigned epoch;juce::String key;
        {std::unique_lock<std::mutex> lock(mutex_);if(stop_)return;cmd=command_;epoch=epoch_;key=key_;if(snapshot_.authorization.validUntil<=juce::Time::currentTimeMillis())authorized_->store(false,std::memory_order_release);}
        const auto stale=[this,epoch]{std::lock_guard<std::mutex> lock(mutex_);return stop_ || epoch_!=epoch;};
        const bool handled=controller.step(cmd,juce::Time::currentTimeMillis(),stale,key);
        {std::unique_lock<std::mutex> lock(mutex_);if(stop_)return;
         if(epoch_==epoch){snapshot_=controller.snapshot;if(snapshot_.state!=State::AwaitingBrowser)browserURL_.clear();authorized_->store(snapshot_.authorization.state==AuthorizationState::Authorized && snapshot_.authorization.validUntil>juce::Time::currentTimeMillis() && snapshot_.state==State::SignedIn,std::memory_order_release);if(controller.browserURL.isNotEmpty()){browserURL_=controller.browserURL;controller.browserURL.clear();}if(handled){command_=Command::None;key_.clear();}}
         wake_.wait_for(lock,std::chrono::seconds(2),[&]{return stop_ || epoch_!=epoch;});}
    }
}
std::shared_ptr<Service> Service::shared(){std::lock_guard<std::mutex> lock(sharingMutex());auto& value=sharedSlot();if(!value)value=std::make_shared<Service>(makePlatformStore(),makeFirebaseBackend());return value;}

}
