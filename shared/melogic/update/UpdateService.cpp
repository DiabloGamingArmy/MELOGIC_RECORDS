#include "UpdateService.h"

namespace melogic::update {
namespace {
class AccountTransport final : public Transport {
public:
    explicit AccountTransport(std::shared_ptr<account::Service> account) : account_(std::move(account)) {}
    juce::var check(const juce::var& body) override { return account_->checkUpdates(body, request_); }
    void shutdown() noexcept override { request_.shutdown(); }
private:
    std::shared_ptr<account::Service> account_;
    account::AuthenticatedUpdateRequest request_;
};
}
Service::Service(Identity identity, std::unique_ptr<Transport> transport, std::function<juce::String()> context)
    : identity_(std::move(identity)), transport_(std::move(transport)), context_(std::move(context)) {
    if (!transport_ || !context_) throw std::invalid_argument("Update service requires transport and context");
    worker_ = std::thread([this] { run(); });
}
Service::~Service() { shutdown(); }
void Service::shutdown() {
    std::lock_guard<std::mutex> join(joinMutex_);
    { std::lock_guard<std::mutex> lock(mutex_); stop_ = true; pending_ = false; }
    transport_->shutdown();
    wake_.notify_all();
    // No state/transport lock is held across join. The worker never takes joinMutex_.
    if (worker_.joinable()) worker_.join();
}
Snapshot Service::snapshot() const {
    const auto context = context_();
    std::lock_guard<std::mutex> lock(mutex_);
    return contextKey_ == context ? snapshot_ : Snapshot{};
}
void Service::check(bool manual) {
    const auto context = context_();
    std::lock_guard<std::mutex> lock(mutex_);
    if (stop_ || pending_ || snapshot_.state == State::Checking) return;
    if (identity_.channel != "beta") {
        snapshot_ = { State::UpToDate, {}, identity_.channel == "development"
            ? "DEVELOPMENT / release checks disabled" : "Release channel not supported", 0 };
        contextKey_ = context;
        return;
    }
    const auto now = juce::Time::currentTimeMillis();
    if (contextKey_ == context && now < snapshot_.expiresAt) {
        // Successful checks are cached for the server's bounded expiry (<=6h).
        // Failures back off 15 minutes automatically, or at least 1 minute manually.
        if (!manual || snapshot_.state != State::CheckFailed || now < snapshot_.expiresAt - 14 * 60000) {
            snapshot_.manual = snapshot_.manual || manual;
            return;
        }
    }
    contextKey_ = context;
    snapshot_ = { State::Checking, {}, {}, 0, manual };
    pending_ = true;
    wake_.notify_one();
}
void Service::run() {
    JUCE_AUTORELEASEPOOL {
        juce::Thread::setCurrentThreadName("Melogic Updates");
        for (;;) {
            juce::String context;
            bool manual;
            {
                std::unique_lock<std::mutex> lock(mutex_);
                wake_.wait(lock, [this] { return stop_ || pending_; });
                if (stop_) return;
                pending_ = false;
                context = contextKey_;
                manual = snapshot_.manual;
            }
            Snapshot next;
            {
                JUCE_AUTORELEASEPOOL {
                    try { next = decode(transport_->check(requestBody(identity_)), identity_, juce::Time::currentTimeMillis()); }
                    catch (...) { next = { State::CheckFailed, {}, "Unable to check updates. Try again later.", juce::Time::currentTimeMillis() + 15 * 60000 }; }
                }
            } // Synchronous stream/native owners drain before the next condition-variable wait.
            next.manual = manual;
            const auto currentContext = context_();
            std::lock_guard<std::mutex> lock(mutex_);
            if (stop_) return;
            snapshot_ = context == currentContext ? next : Snapshot{};
        }
    }
}
std::shared_ptr<Service> Service::shared() {
    static std::mutex mutex;
    static std::weak_ptr<Service> slot; // No strong static owner survives native/framework teardown.
    std::lock_guard<std::mutex> lock(mutex);
    auto service = slot.lock();
    if (!service) {
        auto account = account::Service::shared();
        service = std::make_shared<Service>(installedIdentity(), std::make_unique<AccountTransport>(account),
            [account] { return account->updateContext(); });
        slot = service;
    }
    return service;
}
}
