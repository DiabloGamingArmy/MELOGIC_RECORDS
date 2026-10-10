#pragma once
#include "ArtifactDownload.h"
#include <melogic/account/AccountService.h>
namespace melogic::update {
class Transport {public: virtual ~Transport()=default;virtual juce::var check(const juce::var&)=0;virtual juce::var requestDownload(const juce::var&){throw DownloadFailure(false);}virtual void cancel() noexcept {}virtual void shutdown() noexcept=0;};
class Service final {
public:
 Service(Identity,std::unique_ptr<Transport>,std::function<juce::String()> context = []{return juce::String{};}, StreamFactory = nativeArtifactStreams());
 ~Service();
 void check(bool manual=false);
 void download(); // explicit user action only
 void cancelDownload();
 void shutdown();
 Snapshot snapshot() const;
 static std::shared_ptr<Service> shared();
private:
 void run();
 Identity identity_;std::unique_ptr<Transport> transport_;std::function<juce::String()> context_;
 mutable std::mutex mutex_;std::mutex joinMutex_;std::condition_variable wake_;Snapshot snapshot_;
 ArtifactDownload downloader_;
 bool downloadJob_=false;unsigned operation_=0;
 bool stop_=false,pending_=false;juce::String contextKey_;std::thread worker_;
};
}
