#pragma once
#include "ReleaseManifest.h"
#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
namespace melogic::update {
constexpr juce::int64 maxArtifactBytes = 1024LL * 1024 * 1024;
struct DownloadSpec { juce::String releaseId, artifactId, sha256, url; juce::int64 size=0, expires=0; };
DownloadSpec decodeDownload(const juce::var&, const Candidate&, juce::int64 now);
bool allowedArtifactURL(const juce::String&);
// No account credentials enter this interface. Implementations must not follow redirects.
class ArtifactStream {
public:
 virtual ~ArtifactStream()=default;
 virtual bool connect()=0;
 virtual int status()=0;
 virtual juce::int64 length()=0;
 virtual int read(void*,int)=0;
 virtual void cancel() noexcept=0;
};
using StreamFactory=std::function<std::shared_ptr<ArtifactStream>(const juce::String&)>;
StreamFactory nativeArtifactStreams();
class DownloadFailure : public std::runtime_error {
public: explicit DownloadFailure(bool verification):std::runtime_error("Update download failed"), verification(verification) {} bool verification;
};
// Runs on the update worker. cancel() is safe from another thread; no detached owner.
class ArtifactDownload final {
public:
 explicit ArtifactDownload(StreamFactory = nativeArtifactStreams());
 ~ArtifactDownload();
 void cancel() noexcept;
 void clear(); // worker only (or after join)
 juce::File transfer(const DownloadSpec&, const std::function<bool()>& current,
                     const std::function<void(State,juce::int64)>& progress);
private:
 StreamFactory factory_;std::mutex mutex_;std::shared_ptr<ArtifactStream> stream_;
 std::atomic<bool> cancelled_{false};juce::File directory_;
};
}
