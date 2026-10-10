#include "ArtifactDownload.h"
#include <juce_cryptography/juce_cryptography.h>
#include <regex>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <cerrno>
#include <condition_variable>
#include <thread>
namespace melogic::update {
namespace {
bool id(const juce::String& s){return std::regex_match(s.toStdString(),std::regex("[A-Za-z0-9_-]{1,128}"));}
class WebStream final:public ArtifactStream {
 juce::WebInputStream stream_;
public:
 explicit WebStream(const juce::String& url):stream_(juce::URL(url),false){stream_.withConnectionTimeout(30000).withNumRedirectsToFollow(0).withExtraHeaders("Accept-Encoding: identity\r\n");}
 bool connect()override{return stream_.connect(nullptr);}
 int status()override{return stream_.getStatusCode();}
 juce::int64 length()override{return stream_.getTotalLength();}
 int read(void* p,int n)override{return stream_.read(p,n);}
 void cancel()noexcept override{stream_.cancel();}
};
// Bounded stall/total/context watchdog owns and joins its thread before stream teardown.
class Monitor final {
 std::mutex mutex_;std::condition_variable wake_;bool stop_=false;std::thread worker_;
public:
 Monitor(std::shared_ptr<ArtifactStream> stream,std::function<bool()> current,std::atomic<double>& activity) {
  worker_=std::thread([this,stream=std::move(stream),current=std::move(current),&activity]{JUCE_AUTORELEASEPOOL {
   for(;;){std::unique_lock<std::mutex> lock(mutex_);if(wake_.wait_for(lock,std::chrono::milliseconds(100),[this]{return stop_;}))return;
    lock.unlock();if(!current() || juce::Time::getMillisecondCounterHiRes()-activity.load()>30000){stream->cancel();return;}}
  }});
 }
 ~Monitor(){{std::lock_guard<std::mutex> lock(mutex_);stop_=true;}wake_.notify_one();worker_.join();}
};
struct FD {int value=-1;explicit FD(int v):value(v){}~FD(){if(value>=0)::close(value);} FD(const FD&)=delete;};
class HashInput final:public juce::InputStream {
 int fd_;juce::int64 size_,position_=0;std::function<bool()> current_;
public:
 bool good=true;
 HashInput(int fd,juce::int64 size,std::function<bool()> current):fd_(fd),size_(size),current_(std::move(current)){}
 juce::int64 getTotalLength()override{return size_;}bool isExhausted()override{return !good || position_>=size_;}
 juce::int64 getPosition()override{return position_;}bool setPosition(juce::int64 p)override{if(p<0 || p>size_ || ::lseek(fd_,p,SEEK_SET)!=p)return false;position_=p;return true;}
 int read(void* p,int n)override{if(!current_()){good=false;return 0;}if(position_>=size_ || n<=0)return 0;const auto got=::read(fd_,p,size_t(juce::jmin<juce::int64>(n,size_-position_)));if(got<=0){good=false;return 0;}position_+=got;return int(got);}
};
void removeOwned(const juce::File& dir){
 FD root(::open(dir.getFullPathName().toRawUTF8(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW));
 struct stat st{};
 if(root.value<0 || fstat(root.value,&st)!=0 || st.st_uid!=getuid() || (st.st_mode&0777)!=0700)return;
 // Never recurse or follow symlinks, and never consume a remote/server-provided filename.
 ::unlinkat(root.value,"artifact.pkg.part",0);::unlinkat(root.value,"artifact.pkg",0);
 ::rmdir(dir.getFullPathName().toRawUTF8());
}
}
bool allowedArtifactURL(const juce::String& text){
 if(text.length()>8192 || text.containsAnyOf("\r\n\\") || !text.startsWith("https://storage.googleapis.com/"))return false;
 const juce::URL u(text);
 return u.getScheme()=="https" && u.getDomain()=="storage.googleapis.com" && u.getPort()==0
     && u.getSubPath().startsWith("melogic-records.firebasestorage.app/software-releases/origami/")
     && !text.containsChar('#') && !text.containsChar('@');
}
DownloadSpec decodeDownload(const juce::var& v,const Candidate& c,juce::int64 now){
 auto fail=[]()->DownloadSpec{throw DownloadFailure(false);};
 auto a=v["artifact"];auto size=a["sizeBytes"];
 if(!v.isObject() || v.getDynamicObject()->getProperties().size()!=3 || !v["schemaVersion"].isInt() || int(v["schemaVersion"])!=1 || !v["releaseId"].isString() || v["releaseId"].toString()!=c.releaseId || !a.isObject() || a.getDynamicObject()->getProperties().size()!=5
    || !a["artifactId"].isString() || a["artifactId"].toString()!=c.artifactId || !id(c.artifactId) || !(size.isInt() || size.isInt64())
    || juce::int64(size)<=0 || juce::int64(size)>maxArtifactBytes || !a["sha256"].isString() || !a["downloadUrl"].isString() || !a["expiresAt"].isString())return fail();
 DownloadSpec s{c.releaseId,c.artifactId,a["sha256"].toString(),a["downloadUrl"].toString(),juce::int64(size),juce::Time::fromISO8601(a["expiresAt"].toString()).toMilliseconds()};
 if(!std::regex_match(s.sha256.toStdString(),std::regex("[0-9a-f]{64}")) || !allowedArtifactURL(s.url) || a["expiresAt"].toString().length()>32 || s.expires<=now || s.expires>now+10*60000)return fail();
 return s;
}
StreamFactory nativeArtifactStreams(){return [](const juce::String& u){return std::make_shared<WebStream>(u);};}
ArtifactDownload::ArtifactDownload(StreamFactory f):factory_(std::move(f)){}
ArtifactDownload::~ArtifactDownload(){cancel();clear();}
void ArtifactDownload::cancel()noexcept{cancelled_=true;std::lock_guard<std::mutex> lock(mutex_);if(stream_)stream_->cancel();}
void ArtifactDownload::clear(){if(directory_!=juce::File{})removeOwned(directory_);directory_=juce::File{};}
juce::File ArtifactDownload::transfer(const DownloadSpec& s,const std::function<bool()>& context,const std::function<void(State,juce::int64)>& progress){
 clear();cancelled_=false;
 const auto start=juce::Time::getMillisecondCounterHiRes();
 const auto current=[&]{return !cancelled_ && context() && juce::Time::currentTimeMillis()<s.expires && juce::Time::getMillisecondCounterHiRes()-start<10*60000;};
 try {
  if(!allowedArtifactURL(s.url) || s.size<=0 || s.size>maxArtifactBytes || !current())throw DownloadFailure(false);
  const auto temp=juce::File::getSpecialLocation(juce::File::tempDirectory);
  // Stale cleanup is deliberately narrow: old, owned, mode-0700 directories and two fixed filenames.
  for(const auto& d:temp.findChildFiles(juce::File::findDirectories,false,"Melogic-Origami-update-*"))
   if(d.getLastModificationTime()<juce::Time::getCurrentTime()-juce::RelativeTime::days(1))removeOwned(d);
  auto pattern=(temp.getChildFile("Melogic-Origami-update-XXXXXX").getFullPathName()).toStdString();
  if(!::mkdtemp(pattern.data()))throw DownloadFailure(false);directory_=juce::File(juce::String(pattern));
  FD root(::open(pattern.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW));if(root.value<0)throw DownloadFailure(false);
  struct statvfs space{};if(fstatvfs(root.value,&space)!=0 || static_cast<long double>(space.f_bavail)*space.f_frsize<s.size+16*1024*1024)throw DownloadFailure(false);
  FD out(::openat(root.value,"artifact.pkg.part",O_CREAT|O_EXCL|O_RDWR|O_NOFOLLOW,0600));if(out.value<0)throw DownloadFailure(false);
  auto stream=factory_(s.url);if(!stream)throw DownloadFailure(false);
  {std::lock_guard<std::mutex> lock(mutex_);stream_=stream;if(cancelled_)stream->cancel();}
  std::atomic<double> activity{juce::Time::getMillisecondCounterHiRes()};Monitor monitor(stream,current,activity);
  if(!current() || !stream->connect() || stream->status()!=200)throw DownloadFailure(false);
  const auto length=stream->length();if(length>=0 && length!=s.size)throw DownloadFailure(true);
  progress(State::Downloading,0);juce::int64 received=0;char bytes[64*1024];
  while(current()){
   const auto got=stream->read(bytes,sizeof(bytes));if(got<0)throw DownloadFailure(false);if(got==0)break;
   activity=juce::Time::getMillisecondCounterHiRes();received+=got;if(received>s.size)throw DownloadFailure(true);
   int written=0;while(written<got){const auto n=::write(out.value,bytes+written,size_t(got-written));if(n<0 && errno==EINTR)continue;if(n<=0)throw DownloadFailure(false);written+=int(n);}
   progress(State::Downloading,received);
  }
  if(!current())throw DownloadFailure(false);
  if(received!=s.size)throw DownloadFailure(true);
  progress(State::Verifying,received);
  if(::fsync(out.value)!=0 || ::lseek(out.value,0,SEEK_SET)!=0)throw DownloadFailure(false);
  HashInput input(out.value,s.size,current);juce::BufferedInputStream buffered(input,64*1024);const auto hash=juce::SHA256(buffered).toHexString();
  if(!input.good || input.getPosition()!=s.size || hash!=s.sha256)throw DownloadFailure(true);
  if(!current())throw DownloadFailure(false);
  // Atomic no-overwrite publication inside this private directory; unlink the partial only after linking.
  if(::linkat(root.value,"artifact.pkg.part",root.value,"artifact.pkg",0)!=0)throw DownloadFailure(false);
  if(::unlinkat(root.value,"artifact.pkg.part",0)!=0)throw DownloadFailure(false);
  {std::lock_guard<std::mutex> lock(mutex_);stream_.reset();}
  return directory_.getChildFile("artifact.pkg");
 }catch(...){ {std::lock_guard<std::mutex> lock(mutex_);stream_.reset();}clear();throw; }
}
}
