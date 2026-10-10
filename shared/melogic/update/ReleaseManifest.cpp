#include "ReleaseManifest.h"
#include <OrigamiBuildIdentity.h>
#include <regex>
namespace melogic::update {
Identity installedIdentity(){
#if JUCE_MAC
 const char* platform="macos";
#else
 const char* platform="unsupported";
#endif
#if defined(__aarch64__) || defined(_M_ARM64)
 const char* arch="arm64";
#elif defined(__x86_64__) || defined(_M_X64)
 const char* arch="x86_64";
#else
 const char* arch="unsupported";
#endif
 return {ORIGAMI_PRODUCT_ID,ORIGAMI_PUBLIC_VERSION,ORIGAMI_RELEASE_CHANNEL,ORIGAMI_PUBLIC_REVISION,platform,arch,ORIGAMI_BUILD_NUMBER};
}
bool validVersion(const juce::String& v){
 static const std::regex pattern(R"((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?)");
 return v.length()<=96 && std::regex_match(v.toStdString(),pattern);
}
juce::var requestBody(const Identity& i){auto* d=new juce::DynamicObject;d->setProperty("installedVersion",i.version);d->setProperty("installedBuildNumber",i.buildNumber);d->setProperty("installedChannel",i.channel);d->setProperty("platform",i.platform);d->setProperty("architecture",i.architecture);return d;}
Snapshot decode(const juce::var& v,const Identity& i,juce::int64 now){
 auto fail=[]()->Snapshot{throw std::runtime_error("Invalid update response");};
 if(!v.isObject() || !v["schemaVersion"].isInt() || int(v["schemaVersion"])!=1)return fail();
 if(!v["checkedAt"].isString() || !v["expiresAt"].isString() || !v["status"].isString())return fail();
 const auto checked=v["checkedAt"].toString(),expires=v["expiresAt"].toString();
 const auto start=juce::Time::fromISO8601(checked).toMilliseconds(),end=juce::Time::fromISO8601(expires).toMilliseconds();
 if(checked.length()>32 || expires.length()>32 || start<=0 || start>now+300000 || start<now-300000 || end<=now || end>start+6*3600000)return fail();
 Snapshot s;s.expiresAt=end;
 const auto status=v["status"].toString();
 if(status=="up_to_date" || status=="no_eligible_release"){if(v.hasProperty("release"))return fail();s.state=State::UpToDate;s.message=status=="up_to_date"?"Up to date":"No eligible release";return s;}
 if(status!="update_available")return fail();
 auto r=v["release"];auto n=r["buildNumber"];
 if(!r.isObject() || !r["releaseId"].isString() || !r["version"].isString() || !r["channel"].isString() || !r["releaseNotes"].isString() || !r["minimumOS"].isString() || !(n.isInt() || n.isInt64()) || juce::int64(n)<1 || juce::int64(n)>2147483647)return fail();
 Candidate c{r["releaseId"].toString(),r["version"].toString(),r["channel"].toString(),r["releaseNotes"].toString(),r["minimumOS"].toString(),int(n)};
 if(!std::regex_match(c.releaseId.toStdString(),std::regex("[A-Za-z0-9_-]{1,128}")) || !validVersion(c.version) || c.channel!=i.channel || c.channel!="beta" || c.releaseNotes.getNumBytesAsUTF8()>8192 || !std::regex_match(c.minimumOS.toStdString(),std::regex(R"((0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2}))?)")))return fail();
 if(c.buildNumber<=i.buildNumber){s.state=State::UpToDate;s.message="Up to date";return s;}
 if(r.hasProperty("artifactId")){c.artifactId=r["artifactId"].toString();if(!r["artifactId"].isString() || !std::regex_match(c.artifactId.toStdString(),std::regex("[A-Za-z0-9_-]{1,128}")))return fail();}
 s.state=State::UpdateAvailable;s.candidate=c;s.message="Origami "+c.version+" is available.";return s;
}
}
