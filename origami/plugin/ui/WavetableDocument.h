#pragma once
#include <JuceHeader.h>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace mct::origami::ui {
inline constexpr std::size_t kWavetableFrameSize=2048;
inline constexpr std::size_t kMaxWavetableFrames=256;

struct WavetableFrame {
    std::uint64_t id=0;
    std::array<float,kWavetableFrameSize> samples{};
};

class WavetableDocument {
public:
    juce::String id;
    juce::String name;
    std::vector<WavetableFrame> frames;
    std::size_t selectedFrame=0;

    bool duplicateFrameAfter(std::size_t index) {
        if(index>=frames.size() || frames.size()>=kMaxWavetableFrames) return false;
        auto frame=frames[index];
        frame.id=nextFrameId();
        frames.insert(frames.begin()+static_cast<std::ptrdiff_t>(index+1),std::move(frame));
        selectedFrame=index+1;
        return true;
    }

    bool valid() const noexcept {
        return !frames.empty() && frames.size()<=kMaxWavetableFrames && selectedFrame<frames.size();
    }

    static std::uint64_t nextFrameId() noexcept {
        static std::atomic<std::uint64_t> nextId{1};
        return nextId.fetch_add(1,std::memory_order_relaxed);
    }

    static WavetableDocument basicShapes() {
        WavetableDocument document;
        document.id="factory.basic-shapes";
        document.name="BASIC SHAPES";
        document.frames.reserve(4);

        auto makeFrame=[](auto generator) {
            WavetableFrame frame;
            frame.id=nextFrameId();
            for(std::size_t i=0;i<frame.samples.size();++i) {
                const float phase=static_cast<float>(i)/static_cast<float>(frame.samples.size());
                frame.samples[i]=juce::jlimit(-1.0f,1.0f,generator(phase));
            }
            return frame;
        };

        document.frames.push_back(makeFrame([](float phase) {
            return std::sin(phase*juce::MathConstants<float>::twoPi);
        }));
        document.frames.push_back(makeFrame([](float phase) {
            return 2.0f*phase-1.0f;
        }));
        document.frames.push_back(makeFrame([](float phase) {
            return phase<0.5f ? 1.0f : -1.0f;
        }));
        document.frames.push_back(makeFrame([](float phase) {
            return phase<0.5f ? (-1.0f+4.0f*phase) : (3.0f-4.0f*phase);
        }));
        return document;
    }
};
}
