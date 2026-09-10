// mct-origami-v25.2.0-arp-ux-visual-architecture
#pragma once
#include "OrigamiStyle.h"
#include "../../core/ArpeggiatorState.h"

namespace mct::origami::ui {

class ArpeggiatorPanel final : public juce::Component, public juce::SettableTooltipClient {
public:
    using Setter=std::function<bool(const mct::origami::ArpeggiatorState&)>;
    using Getter=std::function<mct::origami::ArpeggiatorState()>;
    using RuntimeGetter=std::function<mct::origami::ArpeggiatorRuntimeSnapshot()>;

    ArpeggiatorPanel(Setter,Getter,RuntimeGetter);
    void syncFromModel();
    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void commit();
    void configure();
    void setDirection(int);
    void setRate(int);
    void setOctaves(int);
    void setClockSource(bool daw);
    juce::String noteName(int midi) const;
    bool held(const mct::origami::ArpeggiatorRuntimeSnapshot&,int midi) const noexcept;

    Setter setter_;
    Getter getter_;
    RuntimeGetter runtimeGetter_;
    bool syncing_=false;

    juce::ToggleButton enable_,latch_;
    std::array<juce::TextButton,2> clockButtons_;
    std::array<juce::TextButton,5> directionButtons_;
    std::array<juce::TextButton,7> rateButtons_;
    std::array<juce::TextButton,4> octaveButtons_;
    juce::Slider tempo_,gate_,swing_;
};

} // namespace mct::origami::ui
