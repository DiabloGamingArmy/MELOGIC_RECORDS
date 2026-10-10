#pragma once
#include <juce_core/juce_core.h>
namespace melogic::update {
struct Identity { juce::String productId,version,channel,sourceRevision,platform,architecture; int buildNumber=0; };
Identity installedIdentity();
bool validVersion(const juce::String&);
struct Candidate { juce::String releaseId,version,channel,releaseNotes,minimumOS; int buildNumber=0; juce::String artifactId; };
enum class State { Idle, Checking, UpToDate, UpdateAvailable, CheckFailed, RequestingDownload, Downloading, Verifying, VerifiedDownload, VerificationFailed, DownloadFailed };
struct Snapshot { State state=State::Idle; Candidate candidate; juce::String message; juce::int64 expiresAt=0; bool manual=false; juce::int64 receivedBytes=0, totalBytes=0; juce::File stagedFile; };
juce::var requestBody(const Identity&);
Snapshot decode(const juce::var&,const Identity&,juce::int64 now);
}
