// mct-origami-v25.1.0-arp-advanced-page
#pragma once
#include "OrigamiStyle.h"
#include "../../core/ArpeggiatorState.h"

namespace mct::origami::ui {

class ArpeggiatorPanel final : public juce::Component, public juce::SettableTooltipClient {
public:
    using Setter=std::function<bool(const mct::origami::ArpeggiatorState&)>;
    using Getter=std::function<mct::origami::ArpeggiatorState()>;

    ArpeggiatorPanel(Setter,Getter);
    void syncFromModel();
    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void commit();
    void configure();

    Setter setter_;
    Getter getter_;
    bool syncing_=false;

    juce::ToggleButton enable_,latch_;
    juce::ComboBox clockSource_,rate_,direction_,octaves_;
    juce::Slider tempo_,gate_,swing_;
};

} // namespace mct::origami::ui
