#include "AccountService.h"
#include "MelogicFirebaseConfig.h"
#include <juce_cryptography/juce_cryptography.h>
#if JUCE_MAC
#include <Security/SecRandom.h>
#endif

namespace melogic::account {
namespace {
juce::var object(std::initializer_list<std::pair<juce::Identifier,juce::var>> values) {
    auto* p=new juce::DynamicObject;for(const auto& v:values)p->setProperty(v.first,v.second);return juce::var(p);
}
juce::String base64url(const juce::MemoryBlock& block) {return juce::Base64::toBase64(block.getData(),block.getSize()).replace("+","-").replace("/","_").trimCharactersAtEnd("=");}
juce::String randomHex() {
    unsigned char bytes[32]{};
#if JUCE_MAC
    if(SecRandomCopyBytes(kSecRandomDefault,sizeof(bytes),bytes)!=errSecSuccess)throw Failure{Failure::Protocol};
#else
    throw Failure{Failure::Protocol}; // no insecure fallback
#endif
    return juce::String::toHexString(bytes,int(sizeof(bytes)),0);
}
class FirebaseBackend final : public Backend {
    std::mutex transportMutex_;
    juce::WebInputStream* active_=nullptr;
    std::atomic<unsigned> cancellation_{0};
    unsigned operation_=0; // worker only
    juce::var post(const juce::String& endpoint,const juce::var& body,bool callable=false,bool refresh=false,const juce::String& bearer={}) {
        const char* stage=endpoint.contains("beginDesktopLogin")?"begin_login":endpoint.contains("pollDesktopLogin")?"poll_login":endpoint.contains("signInWithCustomToken")?"firebase_exchange":endpoint.contains("accounts:lookup")?"firebase_identity":endpoint.contains("securetoken")?"firebase_refresh":endpoint.contains("redeemOrigamiLicense")?"redeem_key":"entitlement";
        if(cancellation_.load()!=operation_)throw Failure{Failure::Network};
        const auto json=refresh ? "grant_type=refresh_token&refresh_token="+juce::URL::addEscapeChars(body["refreshToken"].toString(),true)
                                : juce::JSON::toString(callable?object({{"data",body}}):body,true);
        // Keep Firebase API-key query parameters in the URL, never prefix them
        // onto the JSON/form body. JUCE's true flag moves query parameters.
        auto ownedStream=makeAuthPostStream(endpoint,json);auto& stream=*ownedStream;
        stream.withCustomRequestCommand("POST").withConnectionTimeout(2000).withNumRedirectsToFollow(0)
            .withExtraHeaders((refresh?juce::String("Content-Type: application/x-www-form-urlencoded\r\n"):juce::String("Content-Type: application/json\r\n"))+(bearer.isNotEmpty()?"Authorization: Bearer "+bearer+"\r\n":juce::String{}));
        struct Active {
            FirebaseBackend& owner;
            Active(FirebaseBackend& o,juce::WebInputStream& s):owner(o){std::lock_guard<std::mutex> lock(o.transportMutex_);o.active_=&s;if(o.cancellation_.load()!=o.operation_)s.cancel();}
            ~Active(){std::lock_guard<std::mutex> lock(owner.transportMutex_);owner.active_=nullptr;}
        } active(*this,stream);
        if(!stream.connect(nullptr))throw Failure{Failure::Network,stage,0};
        const auto status=stream.getStatusCode();
#if JUCE_DEBUG
        DBG("Melogic auth stage="+juce::String(stage)+" HTTP="+juce::String(status));
#endif
        if(status==404 && !endpoint.contains("redeemOrigamiLicense"))throw Failure{Failure::ServiceUnavailable,stage,status};
        if(status==0 || status>=500 || (status==429 && !endpoint.contains("redeemOrigamiLicense")))throw Failure{Failure::Network,stage,status};
        // Bound server responses. Tokens/errors are never logged or published.
        juce::MemoryBlock bytes;char block[4096];const auto deadline=juce::Time::getMillisecondCounterHiRes()+4000;
        while(!stream.isExhausted()){const int n=stream.read(block,int(sizeof(block)));if(cancellation_.load()!=operation_ || juce::Time::getMillisecondCounterHiRes()>deadline)throw Failure{Failure::Network};if(n<=0)break;bytes.append(block,size_t(n));if(bytes.getSize()>65536)throw Failure{Failure::Protocol};}
        auto result=juce::JSON::parse(juce::String::fromUTF8(static_cast<const char*>(bytes.getData()),int(bytes.getSize())));
        if(!result.isObject())throw Failure{status==404?Failure::ServiceUnavailable:Failure::Protocol,stage,status};
        if(status<200 || status>=300 || result.hasProperty("error")){
            const auto code=result["error"]["status"].toString();
            if(endpoint.contains("redeemOrigamiLicense")) {
                const auto kind=code=="NOT_FOUND" || code=="INVALID_ARGUMENT"?Failure::InvalidKey:code=="RESOURCE_EXHAUSTED"?Failure::UsedKey:code=="FAILED_PRECONDITION"?Failure::WrongProduct:code=="DEADLINE_EXCEEDED"?Failure::ExpiredKey:code=="PERMISSION_DENIED"?Failure::KeyUnavailable:code=="UNAUTHENTICATED"?Failure::InvalidSession:Failure::Protocol;
                throw Failure{kind,stage,status};
            }
            if((!callable && status>=400 && status<500) || code=="UNAUTHENTICATED")throw Failure{Failure::InvalidSession,stage,status};
            throw Failure{Failure::Protocol,stage,status};
        }
        if(callable){if(!result["result"].isObject())throw Failure{Failure::Protocol};return result["result"];}
        return result;
    }
    juce::String endpoint(const char* method) const {return "https://us-central1-"+juce::String(MELOGIC_FIREBASE_PROJECT)+".cloudfunctions.net/"+method;}
    Session identity(const juce::var& tokens,juce::int64 now,bool refreshed) {
        const auto id=tokens[refreshed?"id_token":"idToken"].toString();
        const auto refresh=tokens[refreshed?"refresh_token":"refreshToken"].toString();
        if(id.isEmpty() || refresh.isEmpty())throw Failure{Failure::Protocol};
        const auto result=post("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+juce::String(MELOGIC_FIREBASE_API_KEY),object({{"idToken",id}}));
        const auto users=result["users"];
        if(!users.isArray() || users.size()!=1 || bool(users[0]["disabled"]))throw Failure{Failure::InvalidSession};
        const auto user=users[0];Session s;
        s.identity={user["localId"].toString(),user["displayName"].toString().substring(0,256),user["email"].toString().substring(0,320),user["photoUrl"].toString().substring(0,2048)};
        if(s.identity.uid.isEmpty() || s.identity.uid.length()>128)throw Failure{Failure::Protocol};
        s.refreshToken=refresh;s.accessToken=id;s.verified=true;s.validatedAt=now;
        const auto seconds=tokens[refreshed?"expires_in":"expiresIn"].toString().getIntValue();
        if(seconds<=60)throw Failure{Failure::InvalidSession};
        s.accessExpiresAt=now+juce::int64(seconds)*1000;
        s.refreshAfter=now+juce::int64(juce::jmin(3000,seconds-60))*1000;return s;
    }
    void ensureAccess(Session& session,juce::int64 now) {
        if(session.accessToken.isNotEmpty() && session.accessExpiresAt>now+60000)return;
        auto fresh=refresh(session,now);
        if(fresh.identity.uid!=session.identity.uid)throw Failure{Failure::InvalidSession,"firebase_refresh",0};
        fresh.generation=session.generation;session=std::move(fresh);
    }
    Authorization decodeAuthorization(const juce::var& result,juce::int64 now) {
        if(!result["authorized"].isBool())throw Failure{Failure::Protocol,"entitlement",0};
        if(!bool(result["authorized"]))return {AuthorizationState::Unauthorized,{},"Account signed in; Origami is not licensed. Enter a license key.",0};
        const auto until=boundedServerDeadline(juce::int64(result["validUntil"]),now,900000);
        if(result["edition"].toString()!="beta" || until<=now || until>now+900000)throw Failure{Failure::Protocol,"entitlement",0};
        return {AuthorizationState::Authorized,"beta","Origami activated / Beta",until};
    }
public:
    Authorization authorization(Session& session,juce::int64 now) override {
        operation_=cancellation_.load();ensureAccess(session,now);
        return decodeAuthorization(post(endpoint("getOrigamiAuthorization"),object({}),true,false,session.accessToken),now);
    }
    Authorization redeem(Session& session,const juce::String& key,juce::int64 now) override {
        operation_=cancellation_.load();const auto value=key.trim();
        if(value.length()<32 || value.length()>256)throw Failure{Failure::InvalidKey,"redeem_key",0};
        ensureAccess(session,now);
        return decodeAuthorization(post(endpoint("redeemOrigamiLicense"),object({{"key",value}}),true,false,session.accessToken),now);
    }
    void cancel() noexcept override {++cancellation_;std::lock_guard<std::mutex> lock(transportMutex_);if(active_)active_->cancel();}
    Request begin(juce::int64 now) override {
        operation_=cancellation_.load();
        Request r;r.id=randomHex();r.verifier=randomHex();
        const auto proof=challengeForVerifier(r.verifier);
        const auto result=post(endpoint("beginDesktopLogin"),object({{"requestId",r.id},{"challenge",proof}}),true);
        if(result["requestId"].toString()!=r.id)throw Failure{Failure::Protocol};
        r.expiresAt=boundedServerDeadline(juce::int64(result["expiresAt"]),now,300000);if(r.expiresAt<=now)throw Failure{Failure::Protocol};
        r.browserURL="https://melogicrecords.studio/auth/desktop?request="+r.id;return r;
    }
    Poll poll(const Request& request,juce::int64 now) override {
        operation_=cancellation_.load();
        const auto result=post(endpoint("pollDesktopLogin"),object({{"requestId",request.id},{"verifier",request.verifier}}),true);
        Poll p;p.requestId=result["requestId"].toString();if(p.requestId!=request.id)throw Failure{Failure::Protocol};
        const auto state=result["status"].toString();
        if(state=="pending")return p;
        if(state=="cancelled"){p.status=Poll::Cancelled;return p;}
        if(state!="approved" || result["customToken"].toString().isEmpty())throw Failure{Failure::Protocol};
        const auto tokens=post("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key="+juce::String(MELOGIC_FIREBASE_API_KEY),object({{"token",result["customToken"]},{"returnSecureToken",true}}));
        p.status=Poll::Approved;p.session=identity(tokens,now,false);return p;
    }
    Session refresh(const Session& old,juce::int64 now) override {
        operation_=cancellation_.load();
        return identity(post("https://securetoken.googleapis.com/v1/token?key="+juce::String(MELOGIC_FIREBASE_API_KEY),object({{"refreshToken",old.refreshToken}}),false,true),now,true);
    }
};
}
std::unique_ptr<juce::WebInputStream> makeAuthPostStream(const juce::String& endpoint,const juce::String& body){return std::make_unique<juce::WebInputStream>(juce::URL(endpoint).withPOSTData(body),false);}
juce::int64 boundedServerDeadline(juce::int64 deadline,juce::int64 now,juce::int64 lifetime) {
    // Server timestamps include network transit and small clock skew. Never
    // extend the local lifetime, and reject implausible/expired responses.
    if(deadline<=now || deadline>now+lifetime+30000)throw Failure{Failure::Protocol,"deadline_validation",0};
    return juce::jmin(deadline,now+lifetime);
}
juce::String challengeForVerifier(const juce::String& verifier){return base64url(juce::SHA256(verifier.toRawUTF8(),size_t(verifier.getNumBytesAsUTF8())).getRawData());}
std::unique_ptr<Backend> makeFirebaseBackend(){return std::make_unique<FirebaseBackend>();}
}
