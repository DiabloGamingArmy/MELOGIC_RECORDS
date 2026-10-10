#include "AccountService.h"
#include <MelogicFirebaseConfig.h>
#if JUCE_MAC
#include <Security/Security.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#endif

namespace melogic::account {
#if JUCE_MAC
namespace {
template<class T> struct CF {
    T value;explicit CF(T v):value(v){}~CF(){if(value)CFRelease(value);}
    CF(const CF&)=delete;CF& operator=(const CF&)=delete;
};
CFMutableDictionaryRef query(bool interactive, const juce::String& service, SecKeychainRef keychain) {
    auto q=CFDictionaryCreateMutable(nullptr,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(q,kSecClass,kSecClassGenericPassword);
    CF name(CFStringCreateWithCString(nullptr,service.toRawUTF8(),kCFStringEncodingUTF8));
    CFDictionarySetValue(q,kSecAttrService,name.value);
    if(keychain){const void* item=keychain;CF list(CFArrayCreate(nullptr,&item,1,&kCFTypeArrayCallBacks));CFDictionarySetValue(q,kSecMatchSearchList,list.value);}
    CFDictionarySetValue(q,kSecAttrAccount,CFSTR("shared-session-v1"));
    CFDictionarySetValue(q,kSecAttrSynchronizable,kCFBooleanFalse);
    CFDictionarySetValue(q,kSecUseAuthenticationUI,interactive?kSecUseAuthenticationUIAllow:kSecUseAuthenticationUIFail);
    return q;
}
juce::var encode(const Session& s) {
    auto* d=new juce::DynamicObject;
    d->setProperty("schema",1);d->setProperty("uid",s.identity.uid);d->setProperty("displayName",s.identity.displayName);
    d->setProperty("email",s.identity.email);d->setProperty("photoURL",s.identity.photoURL);
    d->setProperty("refreshToken",s.refreshToken);d->setProperty("generation",s.generation);
    d->setProperty("refreshAfter",s.refreshAfter);d->setProperty("verified",s.verified);d->setProperty("validatedAt",s.validatedAt);
    return juce::var(d);
}
class KeychainStore final : public Store {
    juce::File directory_=juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile("Library/Application Support/Melogic/Account");
    juce::String service_="studio.melogic.account.firebase." MELOGIC_FIREBASE_PROJECT;
    SecKeychainRef keychain_=nullptr;
    int descriptor_=-1;
    void generation(const juce::String& value) {
        if(!directory_.getChildFile("generation-v1").replaceWithText(value))throw Failure{Failure::Storage};
        ::chmod(directory_.getChildFile("generation-v1").getFullPathName().toRawUTF8(),0600);
    }
public:
    KeychainStore()=default;
    KeychainStore(juce::File directory,juce::String service,SecKeychainRef keychain):directory_(std::move(directory)),service_(std::move(service)),keychain_(keychain){if(keychain_)CFRetain(keychain_);}
    ~KeychainStore() override{if(keychain_)CFRelease(keychain_);if(descriptor_>=0){::flock(descriptor_,LOCK_UN);::close(descriptor_);}}
    bool tryLock() override {
        if(descriptor_<0){
            if(directory_.createDirectory().failed())throw Failure{Failure::Storage};
            ::chmod(directory_.getFullPathName().toRawUTF8(),0700);
            descriptor_=::open(directory_.getChildFile("session-v1.lock").getFullPathName().toRawUTF8(),O_CREAT|O_RDWR|O_NOFOLLOW,0600);
            if(descriptor_<0)throw Failure{Failure::Storage};
        }
        if(::flock(descriptor_,LOCK_EX|LOCK_NB)!=0){if(errno==EWOULDBLOCK)return false;throw Failure{Failure::Storage};}
        return true;
    }
    void unlock() noexcept override{::flock(descriptor_,LOCK_UN);}
    juce::String generation() override {
        const auto f=directory_.getChildFile("generation-v1");
        if(!f.existsAsFile())generation(juce::Uuid().toString());
        if(f.getSize()>128)throw Failure{Failure::Storage};
        auto value=f.loadFileAsString();if(value.isEmpty() || value.length()>128)throw Failure{Failure::Storage};return value;
    }
    std::optional<Session> load(bool interactive=false) override {
        CF q(query(interactive,service_,keychain_));CFDictionarySetValue(q.value,kSecReturnData,kCFBooleanTrue);
        CFTypeRef result=nullptr;const auto status=SecItemCopyMatching(q.value,&result);CF data(result);
        if(status==errSecItemNotFound)return {};
        if(status!=errSecSuccess || !data.value || CFGetTypeID(data.value)!=CFDataGetTypeID())throw Failure{Failure::Storage};
        auto bytes=static_cast<CFDataRef>(data.value);if(CFDataGetLength(bytes)>65536)throw Failure{Failure::Storage};
        auto d=juce::JSON::parse(juce::String::fromUTF8(reinterpret_cast<const char*>(CFDataGetBytePtr(bytes)),int(CFDataGetLength(bytes))));
        if(!d.isObject() || int(d["schema"])!=1)throw Failure{Failure::Storage};
        for(const char* field:{"uid","displayName","email","photoURL","refreshToken","generation"})
            if(!d[field].isString())throw Failure{Failure::Storage};
        if(!d["verified"].isBool() || !(d["refreshAfter"].isInt() || d["refreshAfter"].isInt64())
           || !(d["validatedAt"].isInt() || d["validatedAt"].isInt64()))throw Failure{Failure::Storage};
        if(d["generation"].toString().isEmpty() || d["generation"].toString().length()>128)throw Failure{Failure::Storage};
        Session s;s.identity={d["uid"].toString(),d["displayName"].toString(),d["email"].toString(),d["photoURL"].toString()};
        s.refreshToken=d["refreshToken"].toString();s.generation=d["generation"].toString();s.refreshAfter=juce::int64(d["refreshAfter"]);s.verified=bool(d["verified"]);s.validatedAt=juce::int64(d["validatedAt"]);
        if(s.identity.displayName.length()>256 || s.identity.email.length()>320 || s.identity.photoURL.length()>2048
           || s.refreshAfter>juce::Time::currentTimeMillis()+3600000 || s.validatedAt>juce::Time::currentTimeMillis()+60000)throw Failure{Failure::Storage};
        return s;
    }
    void save(const Session& s,bool interactive) override {
        const auto json=juce::JSON::toString(encode(s),true);
        CF data(CFDataCreate(nullptr,reinterpret_cast<const UInt8*>(json.toRawUTF8()),CFIndex(json.getNumBytesAsUTF8())));
        CF q(query(interactive,service_,keychain_));CF attrs(CFDictionaryCreateMutable(nullptr,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks));
        CFDictionarySetValue(attrs.value,kSecValueData,data.value);
        auto status=SecItemUpdate(q.value,attrs.value);
        if(status==errSecItemNotFound){
            if(keychain_){CFDictionaryRemoveValue(q.value,kSecMatchSearchList);CFDictionarySetValue(q.value,kSecUseKeychain,keychain_);}
            CFDictionarySetValue(q.value,kSecValueData,data.value);
            CFDictionarySetValue(q.value,kSecAttrAccessible,kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);
            status=SecItemAdd(q.value,nullptr);
        }
        if(status!=errSecSuccess)throw Failure{Failure::Storage};
        // A new account generation is visible only after secure persistence.
        if(generation()!=s.generation)generation(s.generation);
    }
    void erase() override {
        // Tombstone first: pending sign-ins cannot resurrect this session even
        // if Keychain deletion requires approval or fails. Report that failure.
        generation(juce::Uuid().toString());CF q(query(true,service_,keychain_));const auto status=SecItemDelete(q.value);
        if(status!=errSecSuccess && status!=errSecItemNotFound)throw Failure{Failure::Storage};
    }
};
}
std::unique_ptr<Store> makePlatformStore(){return std::make_unique<KeychainStore>();}
std::unique_ptr<Store> makeIsolatedPlatformStore(const juce::File& directory,const juce::String& service,void* keychain){
    if(!keychain || !service.startsWith("test.melogic."))throw Failure{Failure::Storage};
    return std::make_unique<KeychainStore>(directory,service,static_cast<SecKeychainRef>(keychain));
}
#else
namespace { class UnsupportedStore final : public Store {
public:
    bool tryLock() override{throw Failure{Failure::Storage};}void unlock() noexcept override{}
    juce::String generation() override{throw Failure{Failure::Storage};}
    std::optional<Session> load(bool interactive=false) override{throw Failure{Failure::Storage};}
    void save(const Session&,bool) override{throw Failure{Failure::Storage};}void erase() override{throw Failure{Failure::Storage};}
}; }
std::unique_ptr<Store> makePlatformStore(){return std::make_unique<UnsupportedStore>();}
#endif
}
