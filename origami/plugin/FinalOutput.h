#pragma once
#include <JuceHeader.h>
#include <array>
#include <atomic>
#include <cmath>

namespace mct::origami {
// Separate from ParameterRegistry/ModDestination: this is the host-facing final
// safety trim. Keep the legacy, modulatable synth Master Gain compatible.
struct FinalOutputGain {
    static constexpr float floorDb=-72.f, maxDb=6.f, unity=5.f/6.f;
    static float db(float position) noexcept {
        const float p=std::isfinite(position) ? std::clamp(position,0.f,1.f) : unity;
        if(p==unity)return 0.f;
        return p<=.5f ? floorDb+120.f*p : -12.f+36.f*(p-.5f);
    }
    static float position(float decibels) noexcept {
        if(!std::isfinite(decibels))return decibels<0 ? 0.f : unity;
        const float d=std::clamp(decibels,floorDb,maxDb);
        return d<=-12.f ? (d-floorDb)/120.f : .5f+(d+12.f)/36.f;
    }
    static float linear(float p) noexcept {return p<=0.f ? 0.f : std::pow(10.f,db(p)/20.f);}
    static juce::String text(float p) {
        if(p<=0.f)return juce::String::fromUTF8("-\xe2\x88\x9e dB");
        float d=db(p);if(std::abs(d)<.05f)d=0.f;
        return (d>0 ? "+" : "")+juce::String(d,1)+" dB";
    }
    static float fromText(juce::String t) {
        t=t.trim().toLowerCase();
        if(t.contains("inf") || t.contains(juce::String::fromUTF8("\xe2\x88\x9e")))return 0.f;
        return position(t.getFloatValue());
    }
};
struct FinalOutputMeters {std::array<float,2> level{},hold{};};
class FinalOutputStage {
public:
    void prepare(double sampleRate,float target) noexcept {
        rate_=sampleRate>1 ? sampleRate : 48000.;
        gain_.reset(rate_,.02);gain_.setCurrentAndTargetValue(FinalOutputGain::linear(target));
        resetMeters();
    }
    void resetMeters() noexcept {
        levels_={};holds_={};holdSamples_={};
        for(unsigned c=0;c<2;++c){level_[c].store(0);hold_[c].store(0);}
    }
    // Audio-owner only. No allocation, mutexes, history, or UI callbacks.
    void process(float* left,float* right,int count,float target) noexcept {
        gain_.setTargetValue(FinalOutputGain::linear(target));
        std::array<float,2> peaks{};
        for(int i=0;i<count;++i) {
            const float g=gain_.getNextValue();left[i]*=g;right[i]*=g;
            peaks[0]=std::max(peaks[0],std::isfinite(left[i]) ? std::abs(left[i]) : 0.f);
            peaks[1]=std::max(peaks[1],std::isfinite(right[i]) ? std::abs(right[i]) : 0.f);
        }
        const float release=std::pow(10.f,float(-24.*count/rate_/20.));
        const float holdRelease=std::pow(10.f,float(-12.*count/rate_/20.));
        for(unsigned c=0;c<2;++c) {
            levels_[c]=std::max(peaks[c],levels_[c]*release);
            if(peaks[c]>=holds_[c]){holds_[c]=peaks[c];holdSamples_[c]=int(rate_*.5);}
            else if(holdSamples_[c]>0)holdSamples_[c]=std::max(0,holdSamples_[c]-count);
            else holds_[c]=std::max(peaks[c],holds_[c]*holdRelease);
            level_[c].store(levels_[c],std::memory_order_relaxed);hold_[c].store(holds_[c],std::memory_order_relaxed);
        }
    }
    FinalOutputMeters meters() const noexcept {
        FinalOutputMeters m;for(unsigned c=0;c<2;++c){m.level[c]=level_[c].load(std::memory_order_relaxed);m.hold[c]=hold_[c].load(std::memory_order_relaxed);}return m;
    }
private:
    static_assert(std::atomic<float>::is_always_lock_free);
    double rate_=48000.;
    juce::SmoothedValue<float,juce::ValueSmoothingTypes::Linear> gain_;
    std::array<float,2> levels_{},holds_{};
    std::array<int,2> holdSamples_{};
    std::array<std::atomic<float>,2> level_{},hold_{};
};
}
