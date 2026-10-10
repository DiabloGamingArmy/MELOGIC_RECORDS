#include "UpdateService.h"

namespace melogic::update {
namespace {
class AccountTransport final : public Transport {
public:
    explicit AccountTransport(std::shared_ptr<account::Service> account) : account_(std::move(account)) {}
    juce::var check(const juce::var& body) override { return account_->checkUpdates(body, request_); }
    juce::var requestDownload(const juce::var& body) override { return account_->releaseDownload(body, request_); }
    void cancel() noexcept override { request_.cancel(); }
    void shutdown() noexcept override { request_.shutdown(); }
private:
    std::shared_ptr<account::Service> account_;
    account::AuthenticatedUpdateRequest request_;
};
}
Service::Service(Identity identity, std::unique_ptr<Transport> transport, std::function<juce::String()> context, StreamFactory streams)
    : identity_(std::move(identity)), transport_(std::move(transport)), context_(std::move(context)), downloader_(std::move(streams)) {
    if (!transport_ || !context_) throw std::invalid_argument("Update service requires transport and context");
    worker_ = std::thread([this] { run(); });
}
Service::~Service() { shutdown(); }
void Service::shutdown() {
    std::lock_guard<std::mutex> join(joinMutex_);
    { std::lock_guard<std::mutex> lock(mutex_); stop_ = true; pending_ = false; }
    downloader_.cancel();
    transport_->shutdown();
    wake_.notify_all();
    // No state/transport lock is held across join. The worker never takes joinMutex_.
    if (worker_.joinable()) worker_.join();
    downloader_.clear();
}
Snapshot Service::snapshot() const {
    const auto context = context_();
    std::lock_guard<std::mutex> lock(mutex_);
    return !stop_ && contextKey_ == context ? snapshot_ : Snapshot{};
}
void Service::check(bool manual) {
    const auto context = context_();
    std::lock_guard<std::mutex> lock(mutex_);
    if (stop_ || pending_ || snapshot_.state == State::Checking || snapshot_.state == State::RequestingDownload
        || snapshot_.state == State::Downloading || snapshot_.state == State::Verifying) return;
    if(contextKey_ == context && (snapshot_.state == State::VerifiedDownload || snapshot_.state == State::DownloadFailed || snapshot_.state == State::VerificationFailed) && !manual)return;
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
    downloadJob_ = false;
    pending_ = true;
    wake_.notify_one();
}
void Service::download() {
    const auto context=context_();
    std::lock_guard<std::mutex> lock(mutex_);
    if(stop_ || pending_ || context!=contextKey_ || snapshot_.candidate.artifactId.isEmpty()
       || (snapshot_.state!=State::UpdateAvailable && snapshot_.state!=State::DownloadFailed && snapshot_.state!=State::VerificationFailed))return;
    ++operation_;snapshot_.state=State::RequestingDownload;snapshot_.message="Requesting update download...";
    snapshot_.receivedBytes=0;snapshot_.totalBytes=0;snapshot_.stagedFile=juce::File{};snapshot_.manual=true;
    downloadJob_=true;pending_=true;wake_.notify_one();
}
void Service::cancelDownload() {
    {std::lock_guard<std::mutex> lock(mutex_);
     if(stop_ || (snapshot_.state!=State::RequestingDownload && snapshot_.state!=State::Downloading && snapshot_.state!=State::Verifying))return;
     ++operation_;pending_=false;snapshot_.state=State::UpdateAvailable;snapshot_.message="Download cancelled. Installed version unchanged.";}
    downloader_.cancel();transport_->cancel();
}
void Service::run() {
    JUCE_AUTORELEASEPOOL {
        juce::Thread::setCurrentThreadName("Melogic Updates");
        for (;;) {
            juce::String context;bool manual,download;unsigned operation;Candidate candidate;
            {
                std::unique_lock<std::mutex> lock(mutex_);
                wake_.wait(lock, [this] { return stop_ || pending_; });
                if (stop_) return;
                pending_ = false;context = contextKey_;manual = snapshot_.manual;
                download=downloadJob_;operation=operation_;candidate=snapshot_.candidate;
            }
            Snapshot next;
            const auto current=[&]{const auto key=context_();std::lock_guard<std::mutex> lock(mutex_);return !stop_ && operation==operation_ && context==key;};
            {
                JUCE_AUTORELEASEPOOL {
                    if(download){
                        next.candidate=candidate;
                        try {
                            if(!current())throw DownloadFailure(false);
                            auto* body=new juce::DynamicObject;body->setProperty("releaseId",candidate.releaseId);body->setProperty("artifactId",candidate.artifactId);
                            const auto spec=decodeDownload(transport_->requestDownload(body),candidate,juce::Time::currentTimeMillis());
                            next.totalBytes=spec.size;
                            next.stagedFile=downloader_.transfer(spec,current,[&](State state,juce::int64 received){
                                const auto key=context_();std::lock_guard<std::mutex> lock(mutex_);
                                if(!stop_ && operation==operation_ && context==key){snapshot_.state=state;snapshot_.totalBytes=spec.size;snapshot_.receivedBytes=received;
                                    snapshot_.message=state==State::Verifying?"Verifying update...":"Downloading / "+juce::String(100*received/spec.size)+"% / "+juce::String(double(received)/1048576,1)+" / "+juce::String(double(spec.size)/1048576,1)+" MB";}
                            });
                            next.receivedBytes=spec.size;next.state=State::VerifiedDownload;
                            next.message="UPDATE DOWNLOADED / size and SHA-256 verified. Installation support is not enabled in this development build.";
                        }catch(const DownloadFailure& failure){next.state=failure.verification?State::VerificationFailed:State::DownloadFailed;
                            next.message=failure.verification?"Update verification failed. Invalid file removed.":"Unable to download update. Try again later.";
                        }catch(...){next.state=State::DownloadFailed;next.message="Unable to request update download. Try again later.";}
                        if(!current())downloader_.clear();
                    }else{
                        try { next = decode(transport_->check(requestBody(identity_)), identity_, juce::Time::currentTimeMillis()); }
                        catch (...) { next = { State::CheckFailed, {}, "Unable to check updates. Try again later.", juce::Time::currentTimeMillis() + 15 * 60000 }; }
                    }
                }
            } // Synchronous stream/native owners drain before the next condition-variable wait.
            next.manual = manual;
            const auto currentContext = context_();
            bool discard;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                if (stop_) return; // shutdown joins before clearing the staging owner
                discard = operation!=operation_ || context!=currentContext;
                if(operation==operation_)snapshot_ = discard ? Snapshot{} : next;
            }
            // Also cover cancellation/context changes in the final publication window.
            if(download && discard)downloader_.clear();
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
