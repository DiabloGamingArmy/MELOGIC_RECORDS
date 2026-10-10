// EQ headroom investigation: direct production processors, before output guards.
#include "tests/EqReference.h"
#include "core/fx/FxFilter.h"
#include "core/fx/EqDomain.h"
#include <iostream>
#include <iomanip>
#include <vector>
#include <stdexcept>
#include <complex>
#include <cstdlib>
using namespace mct::origami;
namespace {
std::uint64_t inspectedSamples=0;unsigned checks=0;void check(bool ok,const char* what){++checks;if(!ok)throw std::runtime_error(what);}
using Params=std::array<float,fx::maxFxParameters>;
constexpr int sizes[]{1,2,3,8,16,17,32,63,64,127,128,256,257,512,1024,2048};
struct Random {unsigned seed=0xb010cafe;unsigned next(unsigned n){seed=seed*1664525u+1013904223u;return n?(seed>>8)%n:0;}float unit(){return float(next(65536))/65535.f;}};
struct Meter {double peak=0,power=0,sum=0;std::uint64_t n=0;void add(float x){++inspectedSamples;if(!std::isfinite(x))throw std::runtime_error("nonfinite EQ output");peak=std::max(peak,std::abs(double(x)));power+=double(x)*x;sum+=x;++n;}double rms()const{return n?std::sqrt(power/n):0;}};
void finiteBlock(const float* l,const float* r,int n){bool finite=true;for(int i=0;i<n;++i)finite&=std::isfinite(l[i]) && std::isfinite(r[i]);check(finite,"every rendered stereo sample finite");}
Params defaults(const fx::FxEffectDescriptor& d){Params p{};for(std::size_t i=0;i<d.parameterCount;++i)p[i]=d.parameters[i].defaultValue;return p;}
void reproduce(){
 Random random;for(double sr:{44100.,48000.})for(const auto& d:fx::fxEffectCatalog())if(d.processesAudio){
  auto p=defaults(d);std::vector<Params> settings{p};for(int k=0;k<4;++k){auto v=p;for(std::size_t i=0;i<d.parameterCount;++i)v[i]=k==0?0:k==1?1:k==2?float(i%2):random.unit();settings.push_back(v);}for(std::size_t i=0;i<d.parameterCount;++i)for(int c=0;c<d.parameters[i].choices;++c){auto v=p;v[i]=fx::fxChoiceNormalized(d.parameters[i],c);settings.push_back(v);}
  if(d.type!=fx::FxEffectType::Equalizer || sr!=48000)continue;
  std::array<std::unique_ptr<fx::FxProcessor>,8> stages;for(auto& x:stages){x=d.create();x->prepare(sr);x->reset();}
  std::array<Meter,9> meters;std::array<float,2048> l{},r{},input{};std::array<double,2048> rl{},rr{};test::EqReference ref(sr),legalRef(sr,true);std::array<double,2048> legalL{},legalR{};std::array<test::EqReference::Band,8> legacyPeakState{};double legacyPeak=0;int legacySample=0;std::uint64_t offset=0;double peak=0;int setting=0;
  for(const auto& values:settings){for(int n:sizes){for(int i=0;i<n;++i)input[i]=offset%4==0?0:offset%4==1?float(std::sin(double(offset+i)*.03))*.25f:offset%4==2?8.f*float(std::sin(double(offset+i)*.27)):0;
   std::array<Meter,9> block;for(int i=0;i<n;++i){meters[0].add(input[i]);block[0].add(input[i]);r[i]=-input[i]*.5f;}const auto oldPeak=legacyPeak;ref.process(d,values.data(),input.data(),r.data(),rl.data(),rr.data(),n,&legacyPeakState,&legacyPeak,&legacySample);
   auto legal=values;fx::eq::project(legal.data());legalRef.process(d,legal.data(),input.data(),r.data(),legalL.data(),legalR.data(),n);
   if(legacyPeak>oldPeak && legacyPeak>5e7){std::cout<<"LEGACY peak="<<legacyPeak<<" offset="<<offset<<" sample="<<legacySample<<" block="<<n<<'\n';for(int b=0;b<8;++b){const auto& c=legacyPeakState[b];const auto g=c.a2/c.a1,k=(1/c.a1-1-g*g)/g;std::cout<<" legacy band="<<b+1<<" coefficientHz="<<std::atan(g)*sr/3.141592653589793<<" coefficientQ="<<1/k<<'\n';}}

   std::array<double,8> atPeak{};double blockPeak=0;int peakSample=0;
   for(int b=0;b<8;++b){auto v=values;for(int k=b+1;k<8;++k)v[k*5]=0;for(int i=0;i<n;++i){l[i]=input[i];r[i]=-input[i]*.5f;}stages[b]->process(l.data(),r.data(),n,v.data());for(int i=0;i<n;++i){meters[b+1].add(l[i]);block[b+1].add(l[i]);if(b==7 && std::abs(double(l[i]))>blockPeak){blockPeak=std::abs(double(l[i]));peakSample=i;}}if(b==7){double error=0,expected=0;for(int i=0;i<n;++i){error=std::max(error,std::abs(double(l[i])-legalL[i]));expected=std::max(expected,std::abs(legalL[i]));}check(error<=expected*.005+1e-5,"corrected B01 independent reference");}atPeak[b]=block[b+1].peak;}
   if(blockPeak>peak || (setting==2 && offset==10602)){peak=std::max(peak,blockPeak);std::cout<<"CURRENT BLOCK peak="<<blockPeak<<'\n';std::cout<<"NEW PEAK setting="<<setting<<" offset="<<offset<<" block="<<n<<" sample="<<peakSample<<" inputMode="<<offset%4<<" peak="<<peak<<" rms="<<block[8].rms()<<"\n";for(int b=0;b<8;++b)std::cout<<" band="<<b+1<<" type="<<fx::fxChoiceIndex(d.parameters[b*5+1],values[b*5+1])<<" frequency="<<fx::fxParameterValue(d.parameters[b*5+2],values[b*5+2])<<" gain="<<fx::fxParameterValue(d.parameters[b*5+3],values[b*5+3])<<" Q="<<fx::fxParameterValue(d.parameters[b*5+4],values[b*5+4])<<" stageBlockPeak="<<atPeak[b]<<" stageRMS="<<block[b+1].rms()<<" legacySmoothedEndF="<<std::exp(ref.bands[b].f)<<" legacySmoothedEndQ="<<ref.bands[b].q<<'\n';}
   offset+=n;
  }++setting;}
  check(std::abs(legacyPeak-52983876)<100,"frozen legacy oracle reproduces original B01");check(peak<=8*std::pow(10.,24./20),"corrected B01 within full static EQ gain envelope");std::cout<<"LEGACY FINAL peak="<<legacyPeak<<" CORRECTED peak="<<peak<<'\n';
  for(int i=0;i<9;++i)std::cout<<"FIXTURE stage="<<i<<" peak="<<meters[i].peak<<" rms="<<meters[i].rms()<<'\n';
 }
}
std::complex<double> transfer(int type,double f,double q,double db,double probe,double sr){
 const double A=std::pow(10.,db/40),k0=1/q;double g=std::tan(3.141592653589793*f/sr),k=k0,m0=0,m1=0,m2=1;
 switch(type){case 0:m0=1;m1=-k;m2=-1;break;case 1:g/=std::sqrt(A);m0=1;m1=k*(A-1);m2=A*A-1;break;case 2:k/=A;m0=1;m1=k*(A*A-1);m2=0;break;case 3:m0=1;m1=-k;m2=0;break;case 4:g*=std::sqrt(A);m0=A*A;m1=k*(1-A)*A;m2=1-A*A;break;default:break;}
 const std::complex<double> z(0,std::tan(3.141592653589793*probe/sr)/g);return m0+(m1*z+m2)/(z*z+k*z+1.);
}
double analyticalPeak(int type,double f,double q,double db,double sr,double& hz){double maximum=0;const auto visit=[&](double at){if(at<0 || at>=sr*.5)return;const double mag=std::abs(transfer(type,f,q,db,at,sr));if(mag>maximum){maximum=mag;hz=at;}};visit(0);visit(sr*.499999);visit(f);for(int i=0;i<2048;++i)visit(10*std::pow(sr*.049, double(i)/2047));for(int i=-400;i<=400;++i)visit(f*std::pow(2.,double(i)/4000));return maximum;}
void characterize(){
 const auto& d=*fx::findFxEffect(fx::FxEffectType::Equalizer);const double sr=48000;std::array<float,2048> l{},r{};
 std::cout<<"SINGLE type,freq,gain,Q,analyticalPeak,peakHz,measured,relativeError\n";
 for(int type=0;type<6;++type)for(double freq:{100.,1000.,15000.})for(double gain:{-24.,0.,6.,24.})for(double q:{.3,.7071067811865476,4.,12.}){
  auto p=defaults(d);for(int b=0;b<8;++b)p[b*5]=b==0?1:0;p[1]=float(type)/5;p[2]=float(std::log(freq/20)/std::log(1000.));p[3]=float((gain+24)/48);p[4]=float(std::log(q/.3)/std::log(40.));
  fx::eq::project(p.data());const double mappedQ=fx::fxParameterValue(d.parameters[4],p[4]);auto proc=d.create();proc->prepare(sr);double hz=0;const double expectedPeak=analyticalPeak(type,freq,mappedQ,gain,sr,hz);hz=std::min(hz,sr*.49);const double expected=std::abs(transfer(type,freq,mappedQ,gain,hz,sr));const int frames=int(sr*std::max(.5,40*mappedQ*std::max(1.,std::pow(10.,gain/40))/(3.141592653589793*std::min(freq,std::max(10.,hz)))));double ss=0,cc=0,sc=0,xs=0,xc=0,mean=0,count=0;
  for(int at=0;at<frames;){const int n=std::min(2048,frames-at);for(int i=0;i<n;++i)l[i]=r[i]=hz==0?.125f:float(.125*std::sin(6.283185307179586*hz*(at+i)/sr));proc->process(l.data(),r.data(),n,p.data());finiteBlock(l.data(),r.data(),n);for(int i=0;i<n;++i)if(at+i>frames/2){const double phase=6.283185307179586*hz*(at+i)/sr,s=std::sin(phase),c=std::cos(phase);ss+=s*s;cc+=c*c;sc+=s*c;xs+=s*l[i];xc+=c*l[i];mean+=l[i];++count;}at+=n;}
  const double det=ss*cc-sc*sc,aa=hz==0?0:(xs*cc-xc*sc)/det,bb=hz==0?0:(xc*ss-xs*sc)/det,actual=hz==0?std::abs(mean/count)/.125:std::hypot(aa,bb)/.125,error=std::abs(actual-expected)/std::max(1.,expected);
  check(error<.002,"single-band measured transfer agrees with independent analytic response (0.2%)");check(expectedPeak<=std::max(1.,std::pow(10.,gain/20))*(1+1e-6),"single-band legal shape has no excess resonance");std::cout<<type<<','<<freq<<','<<gain<<','<<mappedQ<<','<<expectedPeak<<','<<hz<<','<<actual<<','<<error<<'\n';
 }
 std::cout<<"CASCADE type,count,Q,analyticalPeak,peakHz\n";
 
}

void verifyDomain(const Params& p){double boost=0;for(int b=0;b<8;++b){boost+=std::max(0.,double(p[b*5+3])*48-24);const int t=int(std::lround(p[b*5+1]*5));check(p[b*5+4]<=((t==2||t==3)?1.f:fx::eq::monotonicQNormalized),"shape Q bound");}check(boost<=24.00001,"sum of stored positive gains <=24 dB");}
Params configuration(int family,int count=8){const auto& d=*fx::findFxEffect(fx::FxEffectType::Equalizer);auto p=defaults(d);for(int b=0;b<8;++b){p[b*5]=b<count?1:0;p[b*5+1]=float(family==4?5:family==5?(b%2?4:1):2)/5;p[b*5+2]=float(std::log((family==2?1000*std::pow(2.,b/24.):family==3?60*std::pow(2.,b):1000)/20)/std::log(1000.));p[b*5+3]=b<count?1:.5f;p[b*5+4]=family==0?fx::eq::monotonicQNormalized:1;}return p;}
void domainAndState(){const auto& d=*fx::findFxEffect(fx::FxEffectType::Equalizer);Random rng;
 for(int k=0;k<10000;++k){Params p{};for(int i=0;i<40;++i)p[i]=rng.unit();fx::eq::project(p.data());verifyDomain(p);auto again=p;fx::eq::project(again.data());check(p==again,"domain projection idempotent");}
 auto g=fx::makeDefaultFxGraph();const auto id=g.insertEffectBeforeOutput(fx::FxEffectType::Equalizer);check(id!=0,"EQ graph fixture");check(g.setParameter(id,104,1)==fx::FxEditResult::Ok,"first boost");check(g.setParameter(id,114,1)==fx::FxEditResult::Ok,"second boost");check(g.findNode(id)->parameter(104)==1 && g.findNode(id)->parameter(114).value()<=.500001f,"edit clamps only edited band to remaining boost budget");
 check(g.setParameter(id,104,.75f)==fx::FxEditResult::Ok && g.setParameter(id,114,.75f)==fx::FxEditResult::Ok,"two twelve-dB boosts");const auto atLimit=fx::encodeFxGraph(g);g.setParameter(id,114,1);check(fx::encodeFxGraph(g)==atLimit,"above-budget edit at existing limit is an exact no-op");
 // Construct an old-schema graph directly, deliberately bypassing the new
 // editing invariant. Values are structurally valid legacy normalized floats.
 auto* old=const_cast<fx::FxNode*>(g.findNode(id));for(auto& v:old->parameters)v.value=1;
 const auto bytes=fx::encodeFxGraph(g);fx::FxGraph restored;check(fx::decodeFxGraph(bytes.data(),bytes.size(),restored),"old EQ state restores");Params p{};for(int i=0;i<40;++i)p[i]=restored.findNode(id)->parameter(d.parameters[i].id).value();verifyDomain(p);
 for(int pass=0;pass<100;++pass){auto saved=fx::encodeFxGraph(restored);fx::FxGraph next;check(fx::decodeFxGraph(saved.data(),saved.size(),next),"state decode");check(fx::encodeFxGraph(next)==saved,"safe state round trip exact");restored=std::move(next);}
 // A normal document is unchanged, including normalized dB and Q mappings.
 auto normal=fx::makeDefaultFxGraph();normal.insertEffectBeforeOutput(fx::FxEffectType::Equalizer);auto normalBytes=fx::encodeFxGraph(normal);check(fx::decodeFxGraph(normalBytes.data(),normalBytes.size(),restored) && fx::encodeFxGraph(restored)==normalBytes,"ordinary presets retain exact serialized values");
 std::cout<<"PASS domain/state\n";
}
void cascades(){const auto& d=*fx::findFxEffect(fx::FxEffectType::Equalizer);const double sr=48000;std::array<float,2048> l{},r{};
 std::cout<<"CASCADE family,count,targetBoost,expectedPeak,peakHz,measuredPeak\n";
 for(int family=0;family<6;++family)for(int count=1;count<=8;++count){auto p=configuration(family,count);fx::eq::project(p.data());verifyDomain(p);double hz=0,peak=0,tau=0;const auto response=[&](double at){double mag=1;for(int b=0;b<count;++b){const auto base=b*5;mag*=std::abs(transfer(int(std::lround(p[base+1]*5)),fx::fxParameterValue(d.parameters[base+2],p[base+2]),fx::fxParameterValue(d.parameters[base+4],p[base+4]),fx::fxParameterValue(d.parameters[base+3],p[base+3]),at,sr));}if(mag>peak){peak=mag;hz=at;}};
  response(0);response(sr*.49);for(int i=0;i<4096;++i)response(20*std::pow(1000.,double(i)/4095));for(int b=0;b<count;++b){const double f=fx::fxParameterValue(d.parameters[b*5+2],p[b*5+2]),q=fx::fxParameterValue(d.parameters[b*5+4],p[b*5+4]),gain=fx::fxParameterValue(d.parameters[b*5+3],p[b*5+3]);response(f);tau+=q*std::max(1.,std::pow(10.,gain/40))/(3.141592653589793*f);}
  check(peak<=std::pow(10.,24./20)*(1+1e-5),"analytic cascade bounded by +24 dB");auto proc=d.create();proc->prepare(sr);const int frames=int(sr*std::max(.5,20*tau));double ss=0,cc=0,sc=0,xs=0,xc=0,mean=0,used=0;
  for(int at=0;at<frames;){int n=std::min(2048,frames-at);for(int i=0;i<n;++i)l[i]=r[i]=hz==0?.125f:float(.125*std::sin(6.283185307179586*hz*(at+i)/sr));proc->process(l.data(),r.data(),n,p.data());finiteBlock(l.data(),r.data(),n);for(int i=0;i<n;++i)if(at+i>frames/2){const double phase=6.283185307179586*hz*(at+i)/sr,s=std::sin(phase),c=std::cos(phase);ss+=s*s;cc+=c*c;sc+=s*c;xs+=s*l[i];xc+=c*l[i];mean+=l[i];++used;}at+=n;}
  const double det=ss*cc-sc*sc,aa=hz==0?0:(xs*cc-xc*sc)/det,bb=hz==0?0:(xc*ss-xs*sc)/det,actual=hz==0?std::abs(mean/used)/.125:std::hypot(aa,bb)/.125;check(std::abs(actual-peak)<=.005*peak+1e-5,"measured cascade matches analytic transfer");std::cout<<family<<','<<count<<",24,"<<peak<<','<<hz<<','<<actual<<'\n';
 }
}
void musical(){const auto& d=*fx::findFxEffect(fx::FxEffectType::Equalizer);for(int fixture=0;fixture<7;++fixture){auto p=defaults(d);for(int b=0;b<8;++b)p[b*5]=0;
 const auto band=[&](int b,int type,double f,double gain,double q){p[b*5]=1;p[b*5+1]=float(type)/5;p[b*5+2]=float(std::log(f/20)/std::log(1000.));p[b*5+3]=float((gain+24)/48);p[b*5+4]=float(std::log(q/.3)/std::log(40.));};
 switch(fixture){case 0:band(0,2,1000,2,.7);break;case 1:band(0,1,100,6,.7);break;case 2:band(0,2,3500,4,1);break;case 3:band(0,2,1000,-18,12);break;case 4:band(0,4,7000,3,.5);break;case 5:band(0,1,100,4,.7);band(1,2,1000,-3,1);band(2,2,3500,3,1);band(3,4,7000,2,.5);break;case 6:band(0,2,1000,12,12);break;}
 auto projected=p;fx::eq::project(projected.data());check(projected==p,"ordinary musical parameters unchanged");auto proc=d.create();proc->prepare(48000);test::EqReference legacy(48000);std::array<float,257> l{},r{};std::array<double,257> a{},b{};double maximumError=0;
 for(int block=0;block<256;++block){for(int i=0;i<257;++i)l[i]=r[i]=float(.2*std::sin((block*257+i)*.13)+.1*std::sin((block*257+i)*.013));legacy.process(d,p.data(),l.data(),r.data(),a.data(),b.data(),257);proc->process(l.data(),r.data(),257,p.data());finiteBlock(l.data(),r.data(),257);double expected=0,error=0;for(int i=0;i<257;++i){expected=std::max(expected,std::abs(a[i]));error=std::max(error,std::abs(a[i]-l[i]));}check(error<=expected*.005+1e-5,"musical waveform matches legacy transfer");maximumError=std::max(maximumError,error);}
 std::cout<<"MUSICAL fixture="<<fixture<<" max error="<<maximumError<<'\n';
 }
}
void automation(){const auto& d=*fx::findFxEffect(fx::FxEffectType::Equalizer);for(double sr:{44100.,48000.,96000.,192000.})for(int mode=0;mode<4;++mode)for(int family=0;family<6;++family){auto proc=d.create();proc->prepare(sr);test::EqReference reference(sr,true);auto goal=configuration(family);std::array<float,2048> l{},r{};std::array<double,2048> a{},b{};Meter meter;std::uint64_t offset=0;
 for(int block=0;block<256;++block){const int n=sizes[block%16];auto raw=goal;if(mode==1){const float t=float(block)/255;for(int j=0;j<8;++j){raw[j*5+2]*=t;raw[j*5+3]=.5f+(raw[j*5+3]-.5f)*t;raw[j*5+4]*=t;}}else if(mode==2){for(int j=0;j<40;++j)raw[j]=block%4==0?0:block%4==1?float(j%2):block%4==2?float((block+j)%17)/16:1;}else if(mode==3 && block<128)raw=defaults(d);
 auto legal=raw;fx::eq::project(legal.data());verifyDomain(legal);for(int i=0;i<n;++i)l[i]=r[i]=float(.5*std::sin(double(offset+i)*.27));const bool bypass=mode==2 && block%7==0;if(!bypass){reference.process(d,legal.data(),l.data(),r.data(),a.data(),b.data(),n);proc->process(l.data(),r.data(),n,raw.data());double error=0,expected=0;for(int i=0;i<n;++i){error=std::max(error,std::abs(a[i]-l[i]));expected=std::max(expected,std::abs(a[i]));}check(error<=expected*.005+1e-5,"automated EQ independent double-state recurrence");}for(int i=0;i<n;++i){meter.add(l[i]);meter.add(r[i]);}offset+=n;
 }
 std::cout<<"AUTOMATION rate="<<sr<<" mode="<<mode<<" family="<<family<<" peak="<<meter.peak<<" rms="<<meter.rms()<<'\n';
 }
}
void downstream(){const auto& eqd=*fx::findFxEffect(fx::FxEffectType::Equalizer);for(const auto& d:fx::fxEffectCatalog())if(d.processesAudio){auto eq=eqd.create();eq->prepare(48000);auto target=d.create();target->prepare(48000);auto ep=configuration(1),p=defaults(d);std::array<float,2048> l{},r{};Meter meter;
 for(int pass=0;pass<13;++pass){const double amplitude=std::array<double,7>{2,4,16,100,1000,1000000,4}[pass%7];for(int block=0;block<8;++block){for(int i=0;i<2048;++i)l[i]=r[i]=float(amplitude*std::sin(6.283185307179586*1000*(block*2048+i)/48000));if(pass<7)eq->process(l.data(),r.data(),2048,ep.data());target->process(l.data(),r.data(),2048,p.data());for(int i=0;i<2048;++i){meter.add(l[i]);meter.add(r[i]);}}
 }
 double tail=0,dc=0;for(int block=0;block<int(48000*90/2048)+1;++block){l.fill(0);r.fill(0);eq->process(l.data(),r.data(),2048,ep.data());target->process(l.data(),r.data(),2048,p.data());for(int i=0;i<2048;++i){meter.add(l[i]);meter.add(r[i]);if(block>int(48000*89/2048)){tail=std::max({tail,std::abs(double(l[i])),std::abs(double(r[i]))});dc+=l[i];}}}check(tail<1e-5,"EQ/downstream chain settles without residual DC or recurrence");std::cout<<"DOWNSTREAM "<<d.key<<" peak="<<meter.peak<<" tail="<<tail<<" final DC sum="<<dc<<'\n';
 }
}
void transitions(){const auto& d=*fx::findFxEffect(fx::FxEffectType::Equalizer);for(int mode=0;mode<4;++mode){auto proc=d.create();proc->prepare(48000);test::EqReference old(48000),safe(48000,true);Meter legacy,current,legacySettled,currentSettled;std::array<float,257> l{},r{};std::array<double,257> a{},b{},c{},e{};const int frames=mode==1?48000*8:48000;
 for(int at=0;at<frames;at+=257){const int n=std::min(257,frames-at);auto raw=configuration(4);for(int k=0;k<8;++k){raw[k*5+2]=mode==0?1:mode==1?float(at)/frames:mode==2?float((at/257)%2):at<4800?0:1;raw[k*5+4]=1;}
 auto legal=raw;fx::eq::project(legal.data());for(int i=0;i<n;++i)l[i]=r[i]=float(8*std::sin((at+i)*.27));old.process(d,raw.data(),l.data(),r.data(),a.data(),b.data(),n);safe.process(d,legal.data(),l.data(),r.data(),c.data(),e.data(),n);proc->process(l.data(),r.data(),n,raw.data());double error=0,expected=0;for(int i=0;i<n;++i){legacy.add(float(a[i]));current.add(l[i]);if(at+i>frames*3/4){legacySettled.add(float(a[i]));currentSettled.add(l[i]);}expected=std::max(expected,std::abs(c[i]));error=std::max(error,std::abs(c[i]-l[i]));}check(error<=expected*.005+1e-5,"transition waveform matches constrained reference");}
 std::cout<<"TRANSITION mode="<<mode<<" legacy peak="<<legacy.peak<<" rms="<<legacy.rms()<<" corrected peak="<<current.peak<<" rms="<<current.rms()<<" legacy final-quarter RMS="<<legacySettled.rms()<<" corrected final-quarter RMS="<<currentSettled.rms()<<'\n';
 }
}

}
int main(int argc,char** argv){try{std::cout<<std::setprecision(12);const std::string section=argc>1?argv[1]:"all";bool found=false;const auto run=[&](const char* name,auto f){if(section=="all" || section==name){found=true;f();}};run("reproduce",reproduce);run("characterize",characterize);run("domain",domainAndState);run("cascade",cascades);run("musical",musical);run("automation",automation);run("transitions",transitions);run("downstream",downstream);check(found,"known EQ test section");std::cout<<"PASS EQ checks="<<checks<<" inspectedSamples="<<inspectedSamples<<'\n';return 0;}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
