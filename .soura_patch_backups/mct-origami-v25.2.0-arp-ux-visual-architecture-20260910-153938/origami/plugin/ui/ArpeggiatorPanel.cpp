// mct-origami-v25.1.0-arp-advanced-page
#include "ArpeggiatorPanel.h"

namespace mct::origami::ui {

namespace {
void configureBar(juce::Slider& slider,const juce::String& tooltip) {
    slider.setSliderStyle(juce::Slider::LinearBar);
    slider.setTextBoxStyle(juce::Slider::TextBoxLeft,false,74,20);
    slider.setSliderSnapsToMousePosition(false);
    slider.setScrollWheelEnabled(false);
    slider.setTooltip(tooltip);
}
}

ArpeggiatorPanel::ArpeggiatorPanel(Setter setter,Getter getter)
    : setter_(std::move(setter)),getter_(std::move(getter)) {
    setName("Arpeggiator / Clock");
    setTooltip("Advanced arpeggiator and transport-clock controls.");
    configure();
    syncFromModel();
}

void ArpeggiatorPanel::configure() {
    for(auto* component:{static_cast<juce::Component*>(&enable_),static_cast<juce::Component*>(&latch_),
                         static_cast<juce::Component*>(&clockSource_),static_cast<juce::Component*>(&rate_),
                         static_cast<juce::Component*>(&direction_),static_cast<juce::Component*>(&octaves_),
                         static_cast<juce::Component*>(&tempo_),static_cast<juce::Component*>(&gate_),
                         static_cast<juce::Component*>(&swing_)})
        addAndMakeVisible(*component);

    enable_.setButtonText("ARPEGGIATOR");
    enable_.setClickingTogglesState(true);
    latch_.setButtonText("LATCH");
    latch_.setClickingTogglesState(true);

    clockSource_.addItem("DAW / HOST",1);
    clockSource_.addItem("INTERNAL",2);
    clockSource_.setScrollWheelEnabled(false);

    for(const auto& item:std::initializer_list<std::pair<const char*,int>>{
        {"1/4",1},{"1/8",2},{"1/16",3},{"1/32",4},
        {"1/8 TRIPLET",5},{"1/16 TRIPLET",6},{"1/8 DOTTED",7}})
        rate_.addItem(item.first,item.second);
    rate_.setScrollWheelEnabled(false);

    for(const auto& item:std::initializer_list<std::pair<const char*,int>>{
        {"UP",1},{"DOWN",2},{"UP / DOWN",3},{"PLAYED ORDER",4},{"RANDOM",5}})
        direction_.addItem(item.first,item.second);
    direction_.setScrollWheelEnabled(false);

    for(int i=1;i<=4;++i) octaves_.addItem(juce::String(i)+(i==1?" OCTAVE":" OCTAVES"),i);
    octaves_.setScrollWheelEnabled(false);

    configureBar(tempo_,"Internal clock tempo");
    tempo_.setRange(20.0,400.0,0.1);
    tempo_.setTextValueSuffix(" BPM");
    tempo_.setDoubleClickReturnValue(true,120.0);

    configureBar(gate_,"Note length relative to each step");
    gate_.setRange(5.0,100.0,1.0);
    gate_.setTextValueSuffix("%");
    gate_.setDoubleClickReturnValue(true,72.0);

    configureBar(swing_,"Alternating timing displacement");
    swing_.setRange(0.0,75.0,1.0);
    swing_.setTextValueSuffix("%");
    swing_.setDoubleClickReturnValue(true,0.0);

    enable_.onClick=[this]{commit();};
    latch_.onClick=[this]{commit();};
    clockSource_.onChange=[this]{commit();};
    rate_.onChange=[this]{commit();};
    direction_.onChange=[this]{commit();};
    octaves_.onChange=[this]{commit();};
    tempo_.onValueChange=[this]{commit();};
    gate_.onValueChange=[this]{commit();};
    swing_.onValueChange=[this]{commit();};
}

void ArpeggiatorPanel::commit() {
    if(syncing_ || !setter_) return;
    auto state=getter_?getter_():mct::origami::ArpeggiatorState{};
    state.enabled=enable_.getToggleState();
    state.latch=latch_.getToggleState();
    state.syncToDaw=clockSource_.getSelectedId()!=2;
    state.rateIndex=juce::jlimit(0,6,rate_.getSelectedId()-1);
    state.direction=static_cast<mct::origami::ArpeggiatorState::Direction>(
        juce::jlimit(0,4,direction_.getSelectedId()-1));
    state.octaveSpan=juce::jlimit(1,4,octaves_.getSelectedId());
    state.internalTempo=tempo_.getValue();
    state.gate=static_cast<float>(gate_.getValue()/100.0);
    state.swing=static_cast<float>(swing_.getValue()/100.0);
    setter_(state);
    tempo_.setEnabled(!state.syncToDaw);
    repaint();
}

void ArpeggiatorPanel::syncFromModel() {
    if(!getter_) return;
    const auto state=getter_();
    const juce::ScopedValueSetter<bool> guard(syncing_,true);
    enable_.setToggleState(state.enabled,juce::dontSendNotification);
    latch_.setToggleState(state.latch,juce::dontSendNotification);
    clockSource_.setSelectedId(state.syncToDaw?1:2,juce::dontSendNotification);
    rate_.setSelectedId(juce::jlimit(0,6,state.rateIndex)+1,juce::dontSendNotification);
    direction_.setSelectedId(static_cast<int>(state.direction)+1,juce::dontSendNotification);
    octaves_.setSelectedId(juce::jlimit(1,4,state.octaveSpan),juce::dontSendNotification);
    tempo_.setValue(state.internalTempo,juce::dontSendNotification);
    gate_.setValue(state.gate*100.0,juce::dontSendNotification);
    swing_.setValue(state.swing*100.0,juce::dontSendNotification);
    tempo_.setEnabled(!state.syncToDaw);
    repaint();
}

void ArpeggiatorPanel::resized() {
    auto area=getLocalBounds().reduced(18);
    area.removeFromTop(72);

    auto status=area.removeFromTop(54);
    enable_.setBounds(status.removeFromLeft(150).reduced(4,8));
    status.removeFromLeft(12);
    clockSource_.setBounds(status.removeFromLeft(190).reduced(4,8));
    status.removeFromLeft(12);
    tempo_.setBounds(status.removeFromLeft(230).reduced(4,8));

    area.removeFromTop(18);
    auto columns=area;
    auto pattern=columns.removeFromLeft((columns.getWidth()-18)/2);
    columns.removeFromLeft(18);
    auto timing=columns;

    auto p=pattern.reduced(18,50);
    direction_.setBounds(p.removeFromTop(38));
    p.removeFromTop(18);
    rate_.setBounds(p.removeFromTop(38));
    p.removeFromTop(18);
    octaves_.setBounds(p.removeFromTop(38));
    p.removeFromTop(24);
    latch_.setBounds(p.removeFromTop(34).removeFromLeft(130));

    auto t=timing.reduced(18,50);
    gate_.setBounds(t.removeFromTop(42));
    t.removeFromTop(24);
    swing_.setBounds(t.removeFromTop(42));
}

void ArpeggiatorPanel::paint(juce::Graphics& g) {
    auto shell=getLocalBounds().toFloat().reduced(.5f);
    g.setColour(Palette::panel());g.fillRoundedRectangle(shell,3.0f);
    g.setColour(Palette::borderSoft());g.drawRoundedRectangle(shell,3.0f,1.0f);

    auto area=getLocalBounds().reduced(18);
    auto heading=area.removeFromTop(72);
    text(g,"ARPEGGIATOR",heading.removeFromTop(29),18.0f,Palette::text());
    text(g,"Performance sequencing and master rhythmic clock",
         heading.removeFromTop(19),9.0f,Palette::muted());

    auto status=area.removeFromTop(54);
    well(g,status);
    text(g,"CLOCK SOURCE",status.withWidth(190).translated(162,-15),7.4f,Palette::muted());
    text(g,"TEMPO",status.withWidth(230).translated(365,-15),7.4f,Palette::muted());

    area.removeFromTop(18);
    auto columns=area;
    auto pattern=columns.removeFromLeft((columns.getWidth()-18)/2);
    columns.removeFromLeft(18);
    auto timing=columns;
    well(g,pattern);
    well(g,timing);

    text(g,"PATTERN",pattern.reduced(18,12).removeFromTop(22),10.0f,Palette::secondary());
    auto p=pattern.reduced(18,50);
    text(g,"DIRECTION",p.removeFromTop(20),7.5f,Palette::muted());
    p.removeFromTop(36);
    text(g,"RATE / DIVISION",p.removeFromTop(20),7.5f,Palette::muted());
    p.removeFromTop(36);
    text(g,"OCTAVE SPAN",p.removeFromTop(20),7.5f,Palette::muted());

    text(g,"TIMING",timing.reduced(18,12).removeFromTop(22),10.0f,Palette::secondary());
    auto t=timing.reduced(18,50);
    text(g,"GATE",t.removeFromTop(20),7.5f,Palette::muted());
    t.removeFromTop(46);
    text(g,"SWING",t.removeFromTop(20),7.5f,Palette::muted());

    const auto state=getter_?getter_():mct::origami::ArpeggiatorState{};
    auto footer=getLocalBounds().reduced(18).removeFromBottom(24);
    const juce::String summary=state.syncToDaw
        ? "CLOCK: DAW / HOST  •  INTERNAL TEMPO DISABLED WHILE SYNCED"
        : "CLOCK: INTERNAL  •  " + juce::String(state.internalTempo,1) + " BPM";
    text(g,summary,footer,8.0f,Palette::muted(),juce::Justification::centredRight);
}

} // namespace mct::origami::ui
