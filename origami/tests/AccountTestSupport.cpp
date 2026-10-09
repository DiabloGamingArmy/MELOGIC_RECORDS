// This translation unit is linked only into explicit test/benchmark targets.
#include <melogic/account/AccountService.h>
namespace melogic::account {
namespace {
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
}
std::unique_ptr<Store> makeMemoryStore(){return std::make_unique<MemoryStore>();}
void Service::useInMemoryForTesting(std::unique_ptr<Backend> backend){std::lock_guard<std::mutex> lock(sharingMutex());sharedSlot()=std::make_shared<Service>(makeMemoryStore(),backend ? std::move(backend) : std::make_unique<UnavailableBackend>());}
}
