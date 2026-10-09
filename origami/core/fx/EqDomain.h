#pragma once
#include "FxGraph.h"
#include <algorithm>
#include <array>
#include <cmath>
namespace mct::origami::fx::eq {
// EQ is a tonal equalizer: cuts/shelves are monotonic; Bell provides explicit
// resonant boost with a known dB peak. Notch can remain arbitrarily narrow.
// For these shapes |H_band| <= max(1,10^(gain/20)); limiting the sum of
// positive gains to 24 dB therefore bounds the entire static cascade to 24 dB.
// This constrains parameters, never samples. No output attenuation/limiter.
inline const float monotonicQNormalized=float(std::log((1/std::sqrt(2.))/.3)/std::log(40.));
inline float maximumQ(int type) noexcept {return type==2 || type==3 ? 1.f : monotonicQNormalized;}
inline void project(float* p,int edited=-1) noexcept {
    for(int b=0;b<8;++b){for(int k=0;k<5;++k){auto& v=p[b*5+k];if(!std::isfinite(v))v=k==3?.5f:0.f;v=std::clamp(v,0.f,1.f);}const int type=int(std::lround(p[b*5+1]*5));p[b*5+4]=std::min(p[b*5+4],maximumQ(type));}
    // Reserve boost even for disabled/non-gain bands: enable/type changes must
    // not resurrect an over-budget stored setting. Live edits keep other bands
    // unchanged; bulk restore/raw modulation uses proportional projection.
    double sum=0;for(int b=0;b<8;++b)sum+=std::max(0.,double(p[b*5+3])-.5);
    if(sum<=.5000001)return;
    if(edited>=0 && edited<40 && edited%5==3){const double other=sum-std::max(0.,double(p[edited])-.5);p[edited]=std::min(p[edited],float(.5+std::max(0.,.5-other)));}
    else {const double scale=.4999999/sum;for(int b=0;b<8;++b)if(p[b*5+3]>.5f)p[b*5+3]=float(.5+(p[b*5+3]-.5)*scale);}
}
inline void normalizeState(FxNode& node,FxParameterId edited=0) noexcept {
    const auto* d=findFxEffect(FxEffectType::Equalizer);std::array<float,40> p{};int index=-1;
    for(std::size_t i=0;i<40;++i){p[i]=node.parameter(d->parameters[i].id).value_or(d->parameters[i].defaultValue);if(d->parameters[i].id==edited)index=int(i);}
    project(p.data(),index);
    for(auto& v:node.parameters)for(std::size_t i=0;i<40;++i)if(v.id==d->parameters[i].id){v.value=p[i];break;}
}
}
