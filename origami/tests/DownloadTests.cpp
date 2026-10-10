#include <melogic/update/UpdateService.h>
#include <juce_cryptography/juce_cryptography.h>
#include <atomic>
#include <iostream>
#include <sys/stat.h>
#include <unistd.h>
using namespace melogic::update;
namespace {
std::atomic<int> checks{0};
void require(bool value,const char* message){++checks;if(!value)throw std::runtime_error(message);}
void wait(const std::function<bool()>& f){for(int n=0;n<5000 && !f();++n)std::this_thread::sleep_for(std::chrono::milliseconds(1));require(f(),"fixture deadline");}
const juce::String url="https://storage.googleapis.com/melogic-records.firebasestorage.app/software-releases/origami/b101/macos/arm64/installer.pkg?generation=123&X-Goog-Signature=fixture";
const std::string bytes(256*1024,'q');
Identity identity(){return {"origami","0.1.0-beta.1","beta","fixture","macos","arm64",100};}
Candidate candidate(){return {"b101","0.1.1-beta.1","beta","Notes","12.0",101,"installer"};}
juce::var available(){auto v=juce::JSON::parse(R"({"schemaVersion":1,"status":"update_available","release":{"releaseId":"b101","artifactId":"installer","version":"0.1.1-beta.1","channel":"beta","buildNumber":101,"minimumOS":"12.0","releaseNotes":"Notes"}})");const auto now=juce::Time::currentTimeMillis();v.getDynamicObject()->setProperty("checkedAt",juce::Time(now).toISO8601(true));v.getDynamicObject()->setProperty("expiresAt",juce::Time(now+3600000).toISO8601(true));return v;}
juce::var descriptor(){auto v=juce::JSON::parse(R"({"schemaVersion":1,"releaseId":"b101","artifact":{"artifactId":"installer"}})");auto* a=v["artifact"].getDynamicObject();a->setProperty("sizeBytes",int(bytes.size()));a->setProperty("sha256",juce::SHA256(bytes.data(),bytes.size()).toHexString());a->setProperty("downloadUrl",url);a->setProperty("expiresAt",juce::Time(juce::Time::currentTimeMillis()+590000).toISO8601(true));return v;}
struct Fixture {
 std::atomic<int> requests{0},checks{0},streams{0},reads{0},progress{0};std::atomic<bool> entered{false},hold{false},cancelled{false},stallRead{false};
 int status=200;juce::int64 length=juce::int64(bytes.size());std::string body=bytes;juce::var response=descriptor();bool requestFail=false;
};
class Stream final:public ArtifactStream {
 std::shared_ptr<Fixture> f_;size_t position_=0;
public:
 explicit Stream(std::shared_ptr<Fixture> f):f_(std::move(f)){++f_->streams;}
 bool connect()override{f_->entered=true;while(f_->hold && !f_->cancelled)std::this_thread::sleep_for(std::chrono::milliseconds(1));return !f_->cancelled;}
 int status()override{return f_->status;}juce::int64 length()override{return f_->length;}
 int read(void* p,int n)override{++f_->reads;while(f_->stallRead && !f_->cancelled)std::this_thread::sleep_for(std::chrono::milliseconds(1));if(f_->cancelled)return -1;const auto count=juce::jmin(size_t(n),f_->body.size()-position_);std::memcpy(p,f_->body.data()+position_,count);position_+=count;return int(count);}
 void cancel()noexcept override{f_->cancelled=true;}
};
StreamFactory streams(std::shared_ptr<Fixture> f){return [f](const juce::String& u){require(u==url,"exact signed URL forwarded without auth data");return std::make_shared<Stream>(f);};}
class TransportFixture final:public Transport {
 std::shared_ptr<Fixture> f_;
public:
 explicit TransportFixture(std::shared_ptr<Fixture> f):f_(std::move(f)){}
 juce::var check(const juce::var&)override{++f_->checks;return available();}
 juce::var requestDownload(const juce::var& v)override{++f_->requests;require(v.getDynamicObject()->getProperties().size()==2,"minimal authenticated request");require(v["artifactId"].toString()=="installer","artifact id request");if(f_->requestFail)throw std::runtime_error("fixture");return f_->response;}
 void shutdown()noexcept override{f_->cancelled=true;}
};
void malformed(){
 const auto now=juce::Time::currentTimeMillis();require(decodeDownload(descriptor(),candidate(),now).size==juce::int64(bytes.size()),"valid response");
 for(const auto& scheme:{"http://storage.googleapis.com/x","file:///tmp/x","https://evil.test/x","https://storage.googleapis.com.evil/x","https://storage.googleapis.com@evil.test/x","https://storage.googleapis.com:443/x","https://storage.googleapis.com/other-bucket/software-releases/x"})require(!allowedArtifactURL(scheme),"scheme/host policy");
 for(int mode=0;mode<10;++mode){auto v=descriptor();auto* a=v["artifact"].getDynamicObject();switch(mode){case 0:v.getDynamicObject()->setProperty("schemaVersion",2);break;case 1:v.getDynamicObject()->setProperty("releaseId","other");break;case 2:a->setProperty("artifactId","../installer");break;case 3:a->setProperty("sizeBytes",0);break;case 4:a->setProperty("sizeBytes",juce::int64(maxArtifactBytes+1));break;case 5:a->setProperty("sha256","bad");break;case 6:a->setProperty("downloadUrl","http://127.0.0.1/artifact");break;case 7:a->setProperty("expiresAt",juce::Time(now-1).toISO8601(true));break;case 8:a->setProperty("expiresAt",juce::Time(now+700000).toISO8601(true));break;case 9:a->setProperty("sizeBytes","123");break;}
  bool rejected=false;try{decodeDownload(v,candidate(),now);}catch(...){rejected=true;}require(rejected,"malformed response rejected");
 }
}
void transfers(){
 for(int mode=0;mode<8;++mode){auto f=std::make_shared<Fixture>();if(mode==1)f->status=503;if(mode==2)f->status=302;if(mode==3)f->body.pop_back();if(mode==4)f->body.push_back('x');if(mode==5)f->length+=1;if(mode==6)f->body[10]='r';if(mode==7)f->length=-1;
  ArtifactDownload d(streams(f));auto spec=decodeDownload(descriptor(),candidate(),juce::Time::currentTimeMillis());juce::File result;bool rejected=false;int progress=0;
  try{result=d.transfer(spec,[]{return true;},[&](State s,juce::int64 received){++progress;require(received<=spec.size,"bounded progress");require(s==State::Downloading || s==State::Verifying,"progress state");});}catch(const DownloadFailure&){rejected=true;}
  if(rejected!=(mode!=0 && mode!=7))throw std::runtime_error("transfer mode "+std::to_string(mode)+" rejected="+std::to_string(rejected));require(true,"transfer expected outcome");
  if(!rejected){require(progress>2,"progress observed");require(result.existsAsFile(),"verified file exists");require(result.getFileName()=="artifact.pkg","fixed filename");require(!result.getSiblingFile("artifact.pkg.part").exists(),"partial renamed after verify");require(juce::SHA256(result).toHexString()==spec.sha256,"staged bytes hash");struct stat st{};require(lstat(result.getParentDirectory().getFullPathName().toRawUTF8(),&st)==0 && (st.st_mode&0777)==0700,"private directory");d.clear();require(!result.exists(),"owned staged cleanup");}
 }
 // A stalled response body is interrupted by the owned watchdog, independently of connect timeout.
 {auto f=std::make_shared<Fixture>();f->stallRead=true;ArtifactDownload d(streams(f));bool rejected=false;
  try{d.transfer(decodeDownload(descriptor(),candidate(),juce::Time::currentTimeMillis()),[]{return true;},[](State,juce::int64){});}catch(const DownloadFailure& failure){rejected=!failure.verification;}
  require(rejected && f->cancelled,"30 second stalled body watchdog");}
 // Blocked network + explicit cancel/destruction and context changes are independently exercised.
 for(int mode=0;mode<3;++mode){auto f=std::make_shared<Fixture>();f->hold=true;ArtifactDownload d(streams(f));std::atomic<bool> context{true},failed{false};std::thread worker([&]{JUCE_AUTORELEASEPOOL {try{d.transfer(decodeDownload(descriptor(),candidate(),juce::Time::currentTimeMillis()),[&]{return context.load();},[](State,juce::int64){});}catch(...){failed=true;}}});wait([&]{return f->entered.load();});if(mode<2)d.cancel();else context=false;worker.join();require(failed && f->cancelled,"cancel/context releases blocked stream");}
}
void stagingTests(){
 const auto temp=juce::File::getSpecialLocation(juce::File::tempDirectory);
 auto outside=temp.getNonexistentChildFile("u03-staging-fixture","",true);require(outside.createDirectory().wasOk(),"isolated staging fixture");
 const auto sentinel=outside.getChildFile("unrelated.txt");require(sentinel.replaceWithText("keep"),"sentinel fixture");
 auto old=temp.getNonexistentChildFile("Melogic-Origami-update-fixture","",true);require(old.createDirectory().wasOk(),"stale fixture");::chmod(old.getFullPathName().toRawUTF8(),0700);
 require(::symlink(sentinel.getFullPathName().toRawUTF8(),old.getChildFile("artifact.pkg.part").getFullPathName().toRawUTF8())==0,"partial symlink fixture");
 require(old.getChildFile("unrelated.txt").replaceWithText("preserve"),"unrelated staging file");
 require(old.setLastModificationTime(juce::Time::getCurrentTime()-juce::RelativeTime::days(2)),"age fixture");
 const auto link=temp.getNonexistentChildFile("Melogic-Origami-update-link","",true);
 require(::symlink(outside.getFullPathName().toRawUTF8(),link.getFullPathName().toRawUTF8())==0,"directory symlink fixture");
 auto f=std::make_shared<Fixture>();ArtifactDownload d(streams(f));const auto file=d.transfer(decodeDownload(descriptor(),candidate(),juce::Time::currentTimeMillis()),[]{return true;},[](State,juce::int64){});
 require(file.existsAsFile(),"safe transfer with stale fixtures");require(sentinel.loadFileAsString()=="keep","stale cleanup never follows symlink");
 require(old.getChildFile("unrelated.txt").loadFileAsString()=="preserve","stale cleanup never removes unrelated files");
 require(!old.getChildFile("artifact.pkg.part").isSymbolicLink(),"stale partial safely unlinked");
 ::unlink(link.getFullPathName().toRawUTF8());require(old.deleteRecursively(),"fixture cleanup");require(outside.deleteRecursively(),"sentinel cleanup");
}
void wireTests(){
 for(int mode=0;mode<5;++mode){
  juce::StreamingSocket listener;require(listener.createListener(0,"127.0.0.1"),"wire listener");const auto port=listener.getBoundPort();std::atomic<bool> received{false},safe{false};
  std::thread server([&]{JUCE_AUTORELEASEPOOL {
   std::unique_ptr<juce::StreamingSocket> client(listener.waitForNextConnection());if(!client)return;
   char buffer[4096]{};juce::String request;
   for(int n=0;n<10;++n){if(client->waitUntilReady(true,1000)<=0)break;const int got=client->read(buffer,4095,false);if(got<=0)break;request+=juce::String::fromUTF8(buffer,got);if(request.contains("\r\n\r\n"))break;}
   safe=request.startsWith("GET /artifact?") && !request.containsIgnoreCase("Authorization:") && !request.containsIgnoreCase("fixture-access-token") && !request.containsIgnoreCase("Cookie:");received=true;
   if(mode==3)std::this_thread::sleep_for(std::chrono::milliseconds(300));
   if(mode==4)std::this_thread::sleep_for(std::chrono::seconds(31));
   const auto code=mode==1?503:mode==2?302:200;
   const juce::String reply="HTTP/1.1 "+juce::String(code)+" Fixture\r\nContent-Length: 3\r\nLocation: http://127.0.0.1:"+juce::String(port)+"/redirected\r\nConnection: close\r\n\r\nabc";
   client->write(reply.toRawUTF8(),int(reply.getNumBytesAsUTF8()));
   if(mode==2 && listener.waitUntilReady(true,100)>0)safe=false;
  }});
  // Exercise the real no-header/no-redirect transport directly on loopback. transfer() itself always enforces HTTPS host policy.
  auto stream=nativeArtifactStreams()("http://127.0.0.1:"+juce::String(port)+"/artifact?fixture=1");std::thread canceller;
  if(mode==3)canceller=std::thread([&]{while(!received)std::this_thread::sleep_for(std::chrono::milliseconds(1));stream->cancel();});
  const bool connected=stream->connect();int status=connected?stream->status():0;char body[4]{};const auto count=connected && status==200?stream->read(body,3):0;
  if(canceller.joinable())canceller.join();server.join();require(safe,"GET has no Firebase auth or cookies; redirect not followed");
  if(mode==0)require(connected && count==3 && std::string(body)=="abc","real HTTP bytes");
  if(mode==1 || mode==2)require(status==(mode==1?503:302),"HTTP errors and redirects surfaced");
  if(mode==3 || mode==4)require(!connected || count!=3,"cancel/timeout interrupts native transport");
 }
}
void serviceTests(){
 auto f=std::make_shared<Fixture>();{Service s(identity(),std::make_unique<TransportFixture>(f),[]{return juce::String("a");},streams(f));s.check();wait([&]{return s.snapshot().state==State::UpdateAvailable;});require(f->requests==0 && f->streams==0,"automatic checks never download");s.download();wait([&]{return s.snapshot().state==State::VerifiedDownload;});auto staged=s.snapshot().stagedFile;require(staged.existsAsFile(),"verified snapshot only after finish");s.check();require(f->requests==1,"polling keeps verified state");s.shutdown();require(!staged.exists(),"shutdown clears owned staging");}
 for(int mode=0;mode<4;++mode){auto f=std::make_shared<Fixture>();f->hold=true;std::atomic<int> context{1};auto s=std::make_unique<Service>(identity(),std::make_unique<TransportFixture>(f),[&]{return juce::String(context.load());},streams(f));s->check();wait([&]{return s->snapshot().state==State::UpdateAvailable;});s->download();wait([&]{return f->entered.load();});for(int i=0;i<20;++i)s->download();require(f->requests==1,"instances/coalescing single active request");require(s->snapshot().stagedFile==juce::File{},"partial not exposed");if(mode==0){s->cancelDownload();require(s->snapshot().state==State::UpdateAvailable,"cancel optional");s->shutdown();}else if(mode==1)s->shutdown();else if(mode==2)s.reset();else{context=2;wait([&]{return f->cancelled.load();});require(s->snapshot().state==State::Idle,"stale account never sees verified result");s->shutdown();}require(f->cancelled,"teardown cancellation");}
 for(int mode=0;mode<3;++mode){auto f=std::make_shared<Fixture>();if(mode==0)f->requestFail=true;if(mode==1)f->body[0]='x';if(mode==2)f->status=503;Service s(identity(),std::make_unique<TransportFixture>(f),[]{return juce::String{};},streams(f));s.check();wait([&]{return s.snapshot().state==State::UpdateAvailable;});s.download();wait([&]{auto state=s.snapshot().state;return state==State::DownloadFailed || state==State::VerificationFailed;});require(s.snapshot().stagedFile==juce::File{},"failure exposes no file");require(s.snapshot().candidate.releaseId=="b101","manual retry candidate retained");}
}
}
int main(){try{malformed();transfers();stagingTests();wireTests();serviceTests();std::cout<<"PASS "<<checks.load()<<" artifact download, size/hash, state, cancellation and lifecycle checks\n";return 0;}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
