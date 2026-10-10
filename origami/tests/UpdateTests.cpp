#include <melogic/update/UpdateService.h>
#include <iostream>
#include <atomic>
#include <stdexcept>
using namespace melogic::update;
unsigned checks=0;
void require(bool v){++checks;if(!v)throw std::runtime_error("Update assertion failed");}
Identity identity(){return {"origami","0.1.0-beta.1","beta","abc","macos","arm64",100};}
juce::var response(int build=101){auto now=juce::Time::currentTimeMillis();auto v=juce::JSON::parse(R"({"schemaVersion":1,"status":"update_available","release":{"releaseId":"b101","version":"0.1.0-beta.2","channel":"beta","buildNumber":101,"minimumOS":"12.0","releaseNotes":"Notes"}})");v.getDynamicObject()->setProperty("checkedAt",juce::Time(now).toISO8601(true));v.getDynamicObject()->setProperty("expiresAt",juce::Time(now+3600000).toISO8601(true));v["release"].getDynamicObject()->setProperty("buildNumber",build);return v;}
struct Control {std::atomic<int> calls{0};std::atomic<bool> entered{false},release{false},cancelled{false};bool fail=false;int build=101;};
class Fake final:public Transport {std::shared_ptr<Control> c;public:explicit Fake(std::shared_ptr<Control> v):c(v){}juce::var check(const juce::var&)override{++c->calls;c->entered=true;while(!c->release && !c->cancelled)std::this_thread::sleep_for(std::chrono::milliseconds(1));if(c->fail || c->cancelled)throw std::runtime_error("network/timeout/auth");return response(c->build);}void shutdown()noexcept override{c->cancelled=true;}};
void wait(const std::function<bool()>& f){for(int n=0;n<2000 && !f();++n)std::this_thread::sleep_for(std::chrono::milliseconds(1));require(f());}
void wireTests(){
 using namespace melogic::account;
 for(int mode=0;mode<8;++mode){
  juce::StreamingSocket listener;require(listener.createListener(0,"127.0.0.1"));
  const auto port=listener.getBoundPort();std::atomic<bool> wireOK{false};
  std::thread server([&]{JUCE_AUTORELEASEPOOL {std::unique_ptr<juce::StreamingSocket> client(listener.waitForNextConnection());if(!client)return;char bytes[4096]{};juce::String request;for(int n=0;n<20;++n){if(client->waitUntilReady(true,1000)<=0)break;const auto size=client->read(bytes,4095,false);if(size<=0)break;request+=juce::String::fromUTF8(bytes,size);if(request.contains("installedVersion"))break;}
   const bool pathOK=request.contains("/functions/checkOrigamiUpdate"),authOK=request.containsIgnoreCase("Authorization: Bearer fixture-only"),bodyOK=request.contains("installedVersion");
   wireOK=pathOK && authOK && bodyOK;
   if(!wireOK)std::cerr<<"HTTP framing: path="<<pathOK<<" auth="<<authOK<<" body="<<bodyOK<<"\n";
   if(mode==6)std::this_thread::sleep_for(std::chrono::seconds(31));
   if(mode==7)std::this_thread::sleep_for(std::chrono::seconds(1));
   juce::String body=mode==0?"{\"result\":"+juce::JSON::toString(response())+"}":mode==1?"{bad":mode==2?juce::String::repeatedString("x",65537):mode==3?"[]":mode==5?R"({"error":{"status":"UNAUTHENTICATED"}})":"{}";
   const auto code=mode==4?503:mode==5?401:200;
   const auto text="HTTP/1.1 "+juce::String(code)+" Test\r\nContent-Type: application/json\r\nContent-Length: "+juce::String(body.getNumBytesAsUTF8())+"\r\nConnection: close\r\n\r\n"+body;
   client->write(text.toRawUTF8(),int(text.getNumBytesAsUTF8()));
  }});
  auto backend=makeFirebaseBackendForTesting("http://127.0.0.1:"+juce::String(port));bool failed=false,kindOK=true;
  std::thread canceller;if(mode==7)canceller=std::thread([&]{for(int n=0;n<5000 && !wireOK;++n)std::this_thread::sleep_for(std::chrono::milliseconds(1));backend->shutdown();});
  try{auto v=backend->checkUpdates(requestBody(identity()),"fixture-only");decode(v,identity(),juce::Time::currentTimeMillis());}catch(const Failure& f){failed=true;const auto expected=mode==4?Failure::ServerUnavailable:mode==5?Failure::InvalidSession:mode==6?Failure::Timeout:mode==7?Failure::Cancelled:Failure::Protocol;kindOK=f.kind==expected;}catch(...){failed=true;}
  if(canceller.joinable())canceller.join();server.join();if(!wireOK || !kindOK || failed!=(mode!=0))throw std::runtime_error("HTTP fixture mode "+std::to_string(mode)+" wire="+std::to_string(wireOK.load())+" rejected="+std::to_string(failed));backend->shutdown();
 }
}
int main(){try{
 wireTests();
 require(validVersion("0.1.0-beta.1"));require(!validVersion("0.1.0-01"));require(!validVersion("01.1.0"));
 const auto now=juce::Time::currentTimeMillis();require(decode(response(),identity(),now).state==State::UpdateAvailable);require(decode(response(100),identity(),now).state==State::UpToDate);require(decode(response(99),identity(),now).state==State::UpToDate);
 for(const auto& key:{"version","minimumOS","channel"}){auto v=response();v["release"].getDynamicObject()->setProperty(key,"bad");bool rejected=false;try{decode(v,identity(),now);}catch(...){rejected=true;}require(rejected);}
 for(const auto& raw:{"{}","[]","{bad",R"({"schemaVersion":2})"}){bool rejected=false;try{decode(juce::JSON::parse(raw),identity(),now);}catch(...){rejected=true;}require(rejected);}
 auto c=std::make_shared<Control>();{Service s(identity(),std::make_unique<Fake>(c));require(s.snapshot().state==State::Idle);s.check();wait([&]{return c->entered.load();});require(s.snapshot().state==State::Checking);for(int i=0;i<20;++i)s.check();require(c->calls==1);c->release=true;wait([&]{return s.snapshot().state==State::UpdateAvailable;});s.check();require(c->calls==1);s.shutdown();s.check();require(c->calls==1);}
 for(int i=0;i<4;++i){auto f=std::make_shared<Control>();f->fail=true;f->release=true;Service s(identity(),std::make_unique<Fake>(f));s.check();wait([&]{return s.snapshot().state==State::CheckFailed;});require(s.snapshot().candidate.releaseId.isEmpty());s.check();require(f->calls==1);require(!s.snapshot().manual);s.check(true);require(f->calls==1 && s.snapshot().manual);}
 auto equal=std::make_shared<Control>();equal->build=100;equal->release=true;{Service s(identity(),std::make_unique<Fake>(equal));s.check();wait([&]{return s.snapshot().state==State::UpToDate;});require(s.snapshot().candidate.releaseId.isEmpty());}
 auto active=std::make_shared<Control>();{Service s(identity(),std::make_unique<Fake>(active));s.check();wait([&]{return active->entered.load();});s.shutdown();require(active->cancelled);}
 auto context=std::make_shared<juce::String>("account-a");auto race=std::make_shared<Control>();
 {Service s(identity(),std::make_unique<Fake>(race),[context]{return *context;});s.check();wait([&]{return race->entered.load();});
  // Change context only before releasing the fixture request, so no concurrent string mutation occurs.
  *context="account-b";race->release=true;wait([&]{return s.snapshot().state==State::Idle;});require(s.snapshot().candidate.releaseId.isEmpty());s.shutdown();}
 auto dev=identity();dev.channel="development";dev.buildNumber=0;auto d=std::make_shared<Control>();{Service s(dev,std::make_unique<Fake>(d));s.check();require(d->calls==0);}
 std::cout<<"PASS "<<checks<<" update manifest, HTTP, lifecycle, coalescing and cancellation checks\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
