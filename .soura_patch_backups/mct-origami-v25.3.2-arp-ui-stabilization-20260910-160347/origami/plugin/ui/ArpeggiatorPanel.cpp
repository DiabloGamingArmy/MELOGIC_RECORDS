// mct-origami-v25.3.1-arp-layout-refinement
// mct-origami-v25.3.0-arp-performance-expansion
#include "ArpeggiatorPanel.h"

namespace mct::origami::ui {

namespace {
constexpr const char* directionLabels[]={"UP","DOWN","UP / DOWN","ORDER","RANDOM","INSIDE","OUTSIDE"};
constexpr const char* rateLabels[]={"1/4","1/8","1/16","1/32","1/8T","1/16T","1/8."};

void configureSegment(juce::TextButton& button) {
    button.setClickingTogglesState(false);
    button.setMouseCursor(juce::MouseCursor::PointingHandCursor);
}
void configureKnob(juce::Slider& slider,const juce::String& suffix,double min,double max,double interval,double reset) {
    slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    slider.setTextBoxStyle(juce::Slider::TextBoxBelow,false,62,16);
    slider.setRange(min,max,interval);
    slider.setRotaryParameters(juce::MathConstants<float>::pi*1.25f,
                               juce::MathConstants<float>::pi*2.75f,true);
    slider.setScrollWheelEnabled(false);
    slider.setDoubleClickReturnValue(true,reset);
    slider.setTextValueSuffix(suffix);
}
}

ArpeggiatorPanel::ArpeggiatorPanel(Setter setter,Getter getter,RuntimeGetter runtimeGetter,LatchClearer latchClearer)
    : setter_(std::move(setter)),
      getter_(std::move(getter)),
      runtimeGetter_(std::move(runtimeGetter)),
      latchClearer_(std::move(latchClearer)) {
    setName("Arpeggiator / Clock");
    setTooltip("Advanced arpeggiator, timing, variation and transport-clock controls.");
    configure();
    syncFromModel();
}

void ArpeggiatorPanel::configure() {
    for(auto* c:{static_cast<juce::Component*>(&enable_),
                 static_cast<juce::Component*>(&latch_),
                 static_cast<juce::Component*>(&retrigger_),
                 static_cast<juce::Component*>(&clearLatch_),
                 static_cast<juce::Component*>(&tempo_),
                 static_cast<juce::Component*>(&gate_),
                 static_cast<juce::Component*>(&swing_),
                 static_cast<juce::Component*>(&probability_),
                 static_cast<juce::Component*>(&velocity_),
                 static_cast<juce::Component*>(&transpose_)})
        addAndMakeVisible(*c);

    enable_.setButtonText("ARP");
    enable_.setClickingTogglesState(true);
    latch_.setButtonText("LATCH");
    latch_.setClickingTogglesState(true);
    retrigger_.setButtonText("RESTART");
    retrigger_.setClickingTogglesState(true);
    clearLatch_.setButtonText("CLEAR LATCH");

    for(auto& b:clockButtons_) {configureSegment(b);addAndMakeVisible(b);}
    clockButtons_[0].setButtonText("DAW");
    clockButtons_[1].setButtonText("INTERNAL");
    clockButtons_[0].onClick=[this]{setClockSource(true);};
    clockButtons_[1].onClick=[this]{setClockSource(false);};

    for(std::size_t i=0;i<directionButtons_.size();++i) {
        auto& b=directionButtons_[i];
        configureSegment(b);
        b.setButtonText(directionLabels[i]);
        addAndMakeVisible(b);
        b.onClick=[this,i]{setDirection(static_cast<int>(i));};
    }
    for(std::size_t i=0;i<rateButtons_.size();++i) {
        auto& b=rateButtons_[i];
        configureSegment(b);
        b.setButtonText(rateLabels[i]);
        addAndMakeVisible(b);
        b.onClick=[this,i]{setRate(static_cast<int>(i));};
    }
    for(std::size_t i=0;i<octaveButtons_.size();++i) {
        auto& b=octaveButtons_[i];
        configureSegment(b);
        b.setButtonText(juce::String(static_cast<int>(i)+1));
        addAndMakeVisible(b);
        b.onClick=[this,i]{setOctaves(static_cast<int>(i)+1);};
    }

    configureKnob(tempo_," BPM",20.0,400.0,0.1,120.0);
    configureKnob(gate_,"%",5.0,100.0,1.0,72.0);
    configureKnob(swing_,"%",0.0,75.0,1.0,0.0);
    configureKnob(probability_,"%",1.0,100.0,1.0,100.0);
    configureKnob(velocity_,"%",25.0,150.0,1.0,100.0);
    configureKnob(transpose_," st",-24.0,24.0,1.0,0.0);

    enable_.onClick=[this]{commit();};
    latch_.onClick=[this]{commit();};
    retrigger_.onClick=[this]{commit();};
    clearLatch_.onClick=[this]{if(latchClearer_) latchClearer_(); repaint();};
    tempo_.onValueChange=[this]{commit();};
    gate_.onValueChange=[this]{commit();};
    swing_.onValueChange=[this]{commit();};
    probability_.onValueChange=[this]{commit();};
    velocity_.onValueChange=[this]{commit();};
    transpose_.onValueChange=[this]{commit();};
}

void ArpeggiatorPanel::setDirection(int index) {
    if(syncing_ || !setter_) return;
    auto s=getter_?getter_():mct::origami::ArpeggiatorState{};
    s.direction=static_cast<mct::origami::ArpeggiatorState::Direction>(juce::jlimit(0,6,index));
    setter_(s);syncFromModel();
}
void ArpeggiatorPanel::setRate(int index) {
    if(syncing_ || !setter_) return;
    auto s=getter_?getter_():mct::origami::ArpeggiatorState{};
    s.rateIndex=juce::jlimit(0,6,index);setter_(s);syncFromModel();
}
void ArpeggiatorPanel::setOctaves(int octaves) {
    if(syncing_ || !setter_) return;
    auto s=getter_?getter_():mct::origami::ArpeggiatorState{};
    s.octaveSpan=juce::jlimit(1,4,octaves);setter_(s);syncFromModel();
}
void ArpeggiatorPanel::setClockSource(bool daw) {
    if(syncing_ || !setter_) return;
    auto s=getter_?getter_():mct::origami::ArpeggiatorState{};
    s.syncToDaw=daw;setter_(s);syncFromModel();
}

void ArpeggiatorPanel::commit() {
    if(syncing_ || !setter_) return;
    auto state=getter_?getter_():mct::origami::ArpeggiatorState{};
    state.enabled=enable_.getToggleState();
    state.latch=latch_.getToggleState();
    state.retriggerOnNote=retrigger_.getToggleState();
    state.internalTempo=tempo_.getValue();
    state.gate=static_cast<float>(gate_.getValue()/100.0);
    state.swing=static_cast<float>(swing_.getValue()/100.0);
    state.probability=static_cast<float>(probability_.getValue()/100.0);
    state.velocityScale=static_cast<float>(velocity_.getValue()/100.0);
    state.transposeSemitones=juce::roundToInt(transpose_.getValue());
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
    retrigger_.setToggleState(state.retriggerOnNote,juce::dontSendNotification);
    tempo_.setValue(state.internalTempo,juce::dontSendNotification);
    gate_.setValue(state.gate*100.0,juce::dontSendNotification);
    swing_.setValue(state.swing*100.0,juce::dontSendNotification);
    probability_.setValue(state.probability*100.0,juce::dontSendNotification);
    velocity_.setValue(state.velocityScale*100.0,juce::dontSendNotification);
    transpose_.setValue(state.transposeSemitones,juce::dontSendNotification);
    tempo_.setEnabled(!state.syncToDaw);

    for(std::size_t i=0;i<clockButtons_.size();++i)
        clockButtons_[i].setToggleState((i==0)==state.syncToDaw,juce::dontSendNotification);
    for(std::size_t i=0;i<directionButtons_.size();++i)
        directionButtons_[i].setToggleState(static_cast<int>(i)==static_cast<int>(state.direction),juce::dontSendNotification);
    for(std::size_t i=0;i<rateButtons_.size();++i)
        rateButtons_[i].setToggleState(static_cast<int>(i)==state.rateIndex,juce::dontSendNotification);
    for(std::size_t i=0;i<octaveButtons_.size();++i)
        octaveButtons_[i].setToggleState(static_cast<int>(i)+1==state.octaveSpan,juce::dontSendNotification);
    repaint();
}

juce::String ArpeggiatorPanel::noteName(int midi) const {
    static constexpr const char* names[]={"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"};
    if(midi<0 || midi>127) return {};
    return juce::String(names[midi%12])+juce::String(midi/12-1);
}
bool ArpeggiatorPanel::held(const mct::origami::ArpeggiatorRuntimeSnapshot& snapshot,int midi) const noexcept {
    if(midi<0 || midi>127) return false;
    if(midi<64) return (snapshot.heldLow & (std::uint64_t{1}<<midi))!=0;
    return (snapshot.heldHigh & (std::uint64_t{1}<<(midi-64)))!=0;
}

void ArpeggiatorPanel::resized() {
    auto area=getLocalBounds().reduced(18);
    area.removeFromTop(58);

    auto master=area.removeFromTop(66).reduced(12,8);
    enable_.setBounds(master.removeFromLeft(70).reduced(2,5));
    latch_.setBounds(master.removeFromLeft(76).reduced(2,5));
    retrigger_.setBounds(master.removeFromLeft(86).reduced(2,5));
    clearLatch_.setBounds(master.removeFromLeft(100).reduced(2,5));
    master.removeFromLeft(16);
    auto clock=master.removeFromLeft(200);
    const int clockW=clock.getWidth()/2;
    clockButtons_[0].setBounds(clock.removeFromLeft(clockW).reduced(1,5));
    clockButtons_[1].setBounds(clock.reduced(1,5));
    master.removeFromLeft(14);
    tempo_.setBounds(master.removeFromLeft(82).reduced(8,0));

    area.removeFromTop(12);
    area.removeFromTop(102);
    area.removeFromTop(12);

    auto lower=area;
    auto pattern=lower.removeFromLeft((lower.getWidth()*3)/5);
    lower.removeFromLeft(12);
    auto variation=lower;

    auto pp=pattern.reduced(16,38);
    auto directionRow=pp.removeFromTop(32);
    const int dirW=directionRow.getWidth()/static_cast<int>(directionButtons_.size());
    for(std::size_t i=0;i<directionButtons_.size();++i) {
        auto cell=(i+1==directionButtons_.size())?directionRow:directionRow.removeFromLeft(dirW);
        directionButtons_[i].setBounds(cell.reduced(1,2));
    }

    pp.removeFromTop(24);
    auto rateRow=pp.removeFromTop(32);
    const int rateW=rateRow.getWidth()/static_cast<int>(rateButtons_.size());
    for(std::size_t i=0;i<rateButtons_.size();++i) {
        auto cell=(i+1==rateButtons_.size())?rateRow:rateRow.removeFromLeft(rateW);
        rateButtons_[i].setBounds(cell.reduced(1,2));
    }

    pp.removeFromTop(24);
    auto lowerPattern=pp.removeFromTop(86);
    auto oct=lowerPattern.removeFromLeft(275);
    const int octW=oct.getWidth()/static_cast<int>(octaveButtons_.size());
    for(std::size_t i=0;i<octaveButtons_.size();++i) {
        auto cell=(i+1==octaveButtons_.size())?oct:oct.removeFromLeft(octW);
        octaveButtons_[i].setBounds(cell.removeFromTop(32).reduced(1,2));
    }
    lowerPattern.removeFromLeft(24);
    transpose_.setBounds(lowerPattern.removeFromLeft(82).reduced(8,0));

    auto vv=variation.reduced(16,38);
    constexpr int rowH=88;
    auto row1=vv.removeFromTop(rowH);
    const int half1=row1.getWidth()/2;
    gate_.setBounds(row1.removeFromLeft(half1).reduced(42,0));
    swing_.setBounds(row1.reduced(42,0));

    vv.removeFromTop(18);
    auto row2=vv.removeFromTop(rowH);
    const int half2=row2.getWidth()/2;
    probability_.setBounds(row2.removeFromLeft(half2).reduced(42,0));
    velocity_.setBounds(row2.reduced(42,0));
}

void ArpeggiatorPanel::paint(juce::Graphics& g) {
    auto shell=getLocalBounds().toFloat().reduced(.5f);
    g.setColour(Palette::panel());g.fillRoundedRectangle(shell,3.0f);
    g.setColour(Palette::borderSoft());g.drawRoundedRectangle(shell,3.0f,1.0f);

    auto area=getLocalBounds().reduced(18);
    auto heading=area.removeFromTop(58);
    text(g,"ARPEGGIATOR",heading.removeFromTop(28),17.0f,Palette::text());
    text(g,"Rhythmic note sequencing, performance variation and shared master clock",
         heading.removeFromTop(18),9.0f,Palette::muted());

    auto master=area.removeFromTop(66);
    well(g,master);
    auto labels=master.reduced(12,7).removeFromTop(12);
    text(g,"PERFORMANCE",labels.removeFromLeft(350),7.0f,Palette::muted());
    text(g,"CLOCK",labels.removeFromLeft(250),7.0f,Palette::muted(),juce::Justification::centred);
    text(g,"TEMPO",labels,7.0f,Palette::muted(),juce::Justification::centredLeft);

    area.removeFromTop(12);
    auto monitor=area.removeFromTop(102);
    well(g,monitor);
    auto inner=monitor.reduced(16,10);
    auto mh=inner.removeFromTop(20);
    text(g,"LIVE SEQUENCE",mh.removeFromLeft(180),9.5f,Palette::secondary());

    const auto state=getter_?getter_():mct::origami::ArpeggiatorState{};
    const auto runtime=runtimeGetter_?runtimeGetter_():mct::origami::ArpeggiatorRuntimeSnapshot{};
    const juce::String clockText=state.syncToDaw ? "HOST SYNC" : ("INTERNAL  "+juce::String(state.internalTempo,1)+" BPM");
    text(g,clockText,mh,7.5f,Palette::muted(),juce::Justification::centredRight);

    std::array<int,32> preview{};
    int count=0;
    for(int note=0;note<128 && count<12;++note) {
        if(!held(runtime,note)) continue;
        for(int octave=0;octave<state.octaveSpan && count<static_cast<int>(preview.size());++octave)
            preview[static_cast<std::size_t>(count++)]=juce::jlimit(0,127,note+octave*12+state.transposeSemitones);
    }

    auto lane=inner.reduced(8,10);
    const float cy=lane.getCentreY();
    g.setColour(Palette::borderStrong().withAlpha(.55f));
    g.drawHorizontalLine(static_cast<int>(cy),float(lane.getX()),float(lane.getRight()));
    if(count==0) {
        text(g,"HOLD NOTES TO PREVIEW THE ARP SEQUENCE",lane,8.2f,Palette::muted(),juce::Justification::centred);
    } else {
        const float step=float(lane.getWidth())/float(juce::jmax(1,count));
        for(int i=0;i<count;++i) {
            const int note=preview[static_cast<std::size_t>(i)];
            const float x=float(lane.getX())+step*(float(i)+0.5f);
            const bool active=note==runtime.activeNote;
            const float radius=active?6.0f:4.0f;
            g.setColour(active?Palette::text():Palette::muted());
            g.fillEllipse(x-radius,cy-radius,radius*2.0f,radius*2.0f);
            text(g,noteName(note),{static_cast<int>(x-step*.45f),static_cast<int>(cy+10),static_cast<int>(step*.9f),14},
                 active?8.2f:7.2f,active?Palette::text():Palette::muted(),juce::Justification::centred);
        }
    }

    area.removeFromTop(12);
    auto lower=area;
    auto pattern=lower.removeFromLeft((lower.getWidth()*3)/5);
    lower.removeFromLeft(12);
    auto variation=lower;
    well(g,pattern);well(g,variation);

    auto pp=pattern.reduced(16,10);
    text(g,"PATTERN",pp.removeFromTop(20),10.0f,Palette::secondary());
    pp.removeFromTop(8);
    text(g,"DIRECTION",pp.removeFromTop(13),7.2f,Palette::muted());
    pp.removeFromTop(35);
    text(g,"RATE / DIVISION",pp.removeFromTop(13),7.2f,Palette::muted());
    pp.removeFromTop(35);
    auto lowerLabels=pp.removeFromTop(16);
    text(g,"OCTAVE SPAN",lowerLabels.removeFromLeft(300),7.2f,Palette::muted());
    text(g,"TRANSPOSE",lowerLabels,7.2f,Palette::muted());

    auto vpaint=variation.reduced(16,10);
    text(g,"FEEL / VARIATION",vpaint.removeFromTop(20),10.0f,Palette::secondary());

    auto upperBand=vpaint.removeFromTop(104);
    auto upperLabels=upperBand.removeFromBottom(16);
    const int upperHalf=upperLabels.getWidth()/2;
    text(g,"GATE",upperLabels.removeFromLeft(upperHalf),7.8f,Palette::muted(),juce::Justification::centred);
    text(g,"SWING",upperLabels,7.8f,Palette::muted(),juce::Justification::centred);

    vpaint.removeFromTop(2);
    auto lowerBand=vpaint.removeFromTop(104);
    auto variationLabels=lowerBand.removeFromBottom(16);
    const int lowerHalf=variationLabels.getWidth()/2;
    text(g,"CHANCE",variationLabels.removeFromLeft(lowerHalf),7.8f,Palette::muted(),juce::Justification::centred);
    text(g,"VELOCITY",variationLabels,7.8f,Palette::muted(),juce::Justification::centred);
}

} // namespace mct::origami::ui
