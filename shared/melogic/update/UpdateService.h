#pragma once
#include "ReleaseManifest.h"
#include <melogic/account/AccountService.h>
namespace melogic::update {
class Transport {public: virtual ~Transport()=default;virtual juce::var check(const juce::var&)=0;virtual void shutdown() noexcept=0;};
class Service final {
public:
 Service(Identity,std::unique_ptr<Transport>,std::function<juce::String()> context = []{return juce::String{};});
 ~Service();
 void check(bool manual=false);
 void shutdown();
 Snapshot snapshot() const;
 static std::shared_ptr<Service> shared();
private:
 void run();
 Identity identity_;std::unique_ptr<Transport> transport_;std::function<juce::String()> context_;
 mutable std::mutex mutex_;std::mutex joinMutex_;std::condition_variable wake_;Snapshot snapshot_;
 bool stop_=false,pending_=false;juce::String contextKey_;std::thread worker_;
};
}
