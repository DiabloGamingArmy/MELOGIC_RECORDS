#pragma once
#include <juce_core/juce_core.h>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <optional>
#include <functional>
#include <thread>

namespace melogic::account {
enum class State { SignedOut, Restoring, SignedIn, Refreshing, AwaitingBrowser, OfflineCached, SigningOut, Error };
struct Identity { juce::String uid, displayName, email, photoURL; };
struct Snapshot {
    State state=State::Restoring;
    Identity identity;
    juce::String message="Restoring Melogic session...", verificationCode;
    bool storageError=false;
};
// Internal secrets: never part of the public snapshot, parameter tree or codec.
struct Session { Identity identity; juce::String refreshToken, generation; juce::int64 refreshAfter=0,validatedAt=0; bool verified=false; };
struct Request { juce::String id, verifier, browserURL; juce::int64 expiresAt=0; };
struct Poll { enum Status { Pending, Approved, Cancelled } status=Pending; juce::String requestId; Session session; };
struct Failure { enum Kind { Network, InvalidSession, Storage, Protocol } kind; };
class Backend {
public:
    virtual ~Backend()=default;
    virtual Request begin(juce::int64 now)=0;
    virtual Poll poll(const Request&,juce::int64 now)=0;
    virtual Session refresh(const Session&,juce::int64 now)=0;
    virtual void cancel() noexcept {} // interrupts blocking transport on shutdown/logout
};
class Store {
public:
    virtual ~Store()=default;
    virtual bool tryLock()=0;
    virtual void unlock() noexcept=0;
    virtual juce::String generation()=0;
    virtual std::optional<Session> load(bool interactive=false)=0;
    virtual void save(const Session&,bool interactive)=0;
    virtual void erase()=0;
};
enum class Command { None, SignIn, Cancel, Logout, Restore };
// All calls are worker-only. Tests drive the same coordinator with fake IO/time.
class Coordinator {
public:
    Coordinator(Store&,Backend&);
    bool step(Command,juce::int64 now,const std::function<bool()>& stale=[] {return false;});
    Snapshot snapshot;
    juce::String browserURL;
private:
    Store& store_;
    Backend& backend_;
    std::optional<Request> request_;
    juce::String startingGeneration_;
    juce::int64 retryAfter_=0;
    bool restored_=false;
};
class Service final {
public:
    Service(std::unique_ptr<Store>,std::unique_ptr<Backend>);
    ~Service();
    Snapshot snapshot() const;
    void signIn();
    void restoreAccess();
    void cancel();
    void logout();
    juce::String takeBrowserURL(); // message thread only; consumes once per process
    static std::shared_ptr<Service> shared();
    static void useInMemoryForTesting(std::unique_ptr<Backend> backend = {}); // call before constructing test editors
private:
    void submit(Command);
    void run();
    std::unique_ptr<Store> store_;
    std::unique_ptr<Backend> backend_;
    mutable std::mutex mutex_;
    std::condition_variable wake_;
    Snapshot snapshot_;
    juce::String browserURL_;
    Command command_=Command::None;
    unsigned epoch_=0;
    bool stop_=false;
    std::thread worker_;
};
std::unique_ptr<Store> makePlatformStore();
#if JUCE_MAC
// Isolated test Keychain; never uses the canonical user session item.
std::unique_ptr<Store> makeIsolatedPlatformStore(const juce::File&, const juce::String& service, void* keychain);
#endif
std::unique_ptr<Backend> makeFirebaseBackend();
std::unique_ptr<Store> makeMemoryStore();
juce::String challengeForVerifier(const juce::String&);
}
