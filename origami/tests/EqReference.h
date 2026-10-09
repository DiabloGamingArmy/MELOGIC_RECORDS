#pragma once
#include "core/fx/FxGraph.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
namespace mct::origami::test {
struct EqReference {
    struct Band {float f=0,g=0,q=0;int type=-1;bool on=false;double state[2][2]{};double a1=0,a2=0,a3=0,m0=0,m1=0,m2=0;};
    std::array<Band,8> bands{};bool primed=false;double rate=48000;float alpha=0;
    bool monotonic=false;
    explicit EqReference(double sr,bool safe=false):monotonic(safe),rate(sr),alpha(float(std::exp(-1/(sr*.03)))){}
    void process(const fx::FxEffectDescriptor& d,const float* params,const float* inL,const float* inR,double* outL,double* outR,int n,std::array<Band,8>* peakState=nullptr,double* maximum=nullptr,int* index=nullptr){
        for(std::size_t i=0;i<8;++i){auto& b=bands[i];const auto base=i*5;const bool on=fx::fxChoiceIndex(d.parameters[base],params[base])==1;const int type=fx::fxChoiceIndex(d.parameters[base+1],params[base+1]);if(on!=b.on || type!=b.type)std::memset(b.state,0,sizeof(b.state));b.on=on;b.type=type;
            if(monotonic && type!=2 && type!=3)b.q=std::min(b.q,float(1/std::sqrt(2.)));
            if(!primed){b.f=std::log(fx::fxParameterValue(d.parameters[base+2],params[base+2]));b.g=fx::fxParameterValue(d.parameters[base+3],params[base+3]);b.q=fx::fxParameterValue(d.parameters[base+4],params[base+4]);}}
        primed=true;const auto smooth=[&](float& v,float t){v=t+(v-t)*alpha;if(std::abs(v-t)<1e-7f)v=t;};
        for(int sample=0;sample<n;++sample){double x[2]{inL[sample],inR[sample]};
            for(std::size_t i=0;i<8;++i){auto& b=bands[i];const auto base=i*5;smooth(b.f,std::log(fx::fxParameterValue(d.parameters[base+2],params[base+2])));smooth(b.g,fx::fxParameterValue(d.parameters[base+3],params[base+3]));smooth(b.q,fx::fxParameterValue(d.parameters[base+4],params[base+4]));if(!b.on)continue;
                if((sample&31)==0){const double f=std::clamp(double(std::exp(b.f)),10.,rate*.49),A=std::pow(10.,double(b.g)/40),q=std::clamp(double(b.q),.1,40.);double g=std::tan(3.14159265358979323846*f/rate),k=1/q;b.m0=0;b.m1=0;b.m2=1;
                    switch(b.type){case 0:b.m0=1;b.m1=-k;b.m2=-1;break;case 1:g/=std::sqrt(A);b.m0=1;b.m1=k*(A-1);b.m2=A*A-1;break;case 2:k/=A;b.m0=1;b.m1=k*(A*A-1);b.m2=0;break;case 3:b.m0=1;b.m1=-k;b.m2=0;break;case 4:g*=std::sqrt(A);b.m0=A*A;b.m1=k*(1-A)*A;b.m2=1-A*A;break;default:break;}
                    b.a1=1/(1+g*(g+k));b.a2=g*b.a1;b.a3=g*g*b.a1;}
                for(int c=0;c<2;++c){const double v3=x[c]-b.state[c][1],v1=b.a1*b.state[c][0]+b.a2*v3,v2=b.state[c][1]+b.a2*b.state[c][0]+b.a3*v3;b.state[c][0]=2*v1-b.state[c][0];b.state[c][1]=2*v2-b.state[c][1];x[c]=b.m0*x[c]+b.m1*v1+b.m2*v2;}}
            outL[sample]=x[0];outR[sample]=x[1];
            if(peakState && maximum && std::abs(x[0])>*maximum){*maximum=std::abs(x[0]);*peakState=bands;if(index)*index=sample;}}
    }
};
}
