// mct-origami-deep-audit-p02-lockfree-ui-midi
// mct-origami-v25.3.2-arp-ui-stabilization
// mct-origami-v25.3.1-arp-layout-refinement
// mct-origami-v25.2.0-arp-ux-visual-architecture
// mct-origami-v25.1.0-arp-advanced-page
// mct-origami-v25.0.0-arp-internal-clock
// mct-origami-performance-ui-refinement-v23.4.5
// mct-origami-performance-audio-ui-repair-v23.4.4
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-performance-strip-relayout-v23.3.2
// mct-origami-pitch-mod-ui-refine-v23.3.1
// mct-origami-pitch-mod-real-v23.3
// mct-origami-keyboard-compact-bottom-v23.1.2
// mct-origami-keyboard-density-reserve-v23.1.1
// mct-origami-playable-keyboard-audio-v23.1
#include "PerformanceKeyboard.h"
namespace mct::origami::ui {
namespace {
// Performance strip v1: explicit zones. The keyboard is the elastic region.
constexpr int leftReserve=86;
constexpr int bendPanelWidth=62;
constexpr int performancePanelWidth=178;
constexpr int clockPanelWidth=142;
constexpr int rightReserve=bendPanelWidth+performancePanelWidth+clockPanelWidth;
constexpr int whiteOffsets[7]={0,2,4,5,7,9,11};
}

PerformanceKeyboard::~PerformanceKeyboard() {
    if(mouseNote_>=0 && noteSetter_) noteSetter_(mouseNote_,false,0.0f);
}

void PerformanceKeyboard::syncArpFromModel() {
    if(!arpGetter_) return;
    const auto state=arpGetter_();
    arpEnable_.setToggleState(state.enabled,juce::dontSendNotification);
    const auto summary=state.syncToDaw
        ? juce::String("DAW SYNC")
        : juce::String("INT  ") + juce::String(state.internalTempo,1) + " BPM";
    arpClockSummary_.setText(summary,juce::dontSendNotification);

    static constexpr const char* directions[]={"UP","DOWN","UP/DN","ORDER","RANDOM","INSIDE","OUTSIDE"};
    static constexpr const char* rates[]={"1/4","1/8","1/16","1/32","1/8T","1/16T","1/8."};
    const auto direction=directions[static_cast<std::size_t>(juce::jlimit(0,6,static_cast<int>(state.direction)))];
    const auto rate=rates[static_cast<std::size_t>(juce::jlimit(0,6,state.rateIndex))];
    arpPatternSummary_.setText(juce::String(direction)+"  ·  "+rate+"  ·  "+juce::String(state.octaveSpan)+" OCT",
                               juce::dontSendNotification);
}

juce::Rectangle<int> PerformanceKeyboard::keyArea() const noexcept {
    auto area=getLocalBounds();
    const int right=juce::jmin(rightReserve,juce::jmax(300,area.getWidth()*27/100));
    area.removeFromRight(right);
    area.removeFromLeft(leftReserve);
    // One canonical full-height key rectangle is shared by painting and hit testing.
    return area;
}

juce::Rectangle<int> PerformanceKeyboard::pitchWheelArea() const noexcept {
    auto left=getLocalBounds().removeFromLeft(leftReserve);
    auto wheel=left.removeFromLeft(leftReserve/2).reduced(5,3);
    wheel.removeFromBottom(10);
    return wheel;
}
juce::Rectangle<int> PerformanceKeyboard::modWheelArea() const noexcept {
    auto left=getLocalBounds().removeFromLeft(leftReserve);
    left.removeFromLeft(leftReserve/2);
    auto wheel=left.reduced(5,3);
    wheel.removeFromBottom(10);
    return wheel;
}
void PerformanceKeyboard::resized() {
    auto area=getLocalBounds();
    const int right=juce::jmin(rightReserve,juce::jmax(300,area.getWidth()*27/100));
    auto rightBay=area.removeFromRight(right);

    const int bendWidth=juce::jmin(bendPanelWidth,juce::jmax(54,rightBay.getWidth()/6));
    auto bend=rightBay.removeFromLeft(bendWidth);
    bend.removeFromTop(13);
    bendRange_.setBounds(bend.reduced(8,2));

    const int perfWidth=juce::jmin(performancePanelWidth,juce::jmax(150,rightBay.getWidth()/2));
    auto perf=rightBay.removeFromLeft(perfWidth).reduced(4,3);
    auto top=perf.removeFromTop(21);
    const int third=top.getWidth()/3;
    voiceMode_.setBounds(top.removeFromLeft(third).reduced(1));
    priority_.setBounds(top.removeFromLeft(third).reduced(1));
    legato_.setBounds(top.reduced(1));

    auto lower=perf;
    auto glideCell=lower.removeFromLeft(58);
    glide_.setBounds(glideCell.reduced(7,0));

    auto clock=rightBay.reduced(4,3);
    auto controls=clock.removeFromTop(21);
    arpEnable_.setBounds(controls.removeFromLeft(58).reduced(1));
    arpSettings_.setBounds(controls.removeFromRight(28).reduced(1));
    arpClockSummary_.setBounds(clock.removeFromTop(12));
    arpPatternSummary_.setBounds(clock.removeFromTop(10));
}
void PerformanceKeyboard::updateWheel(juce::Point<float> p) {
    const auto area=activeWheel_==1?pitchWheelArea():modWheelArea();if(area.getHeight()<=0) return;
    const float normalized=juce::jlimit(0.0f,1.0f,(float(area.getBottom())-p.y)/float(area.getHeight()));
    if(activeWheel_==1) {pitchValue_=normalized*2.0f-1.0f;if(pitchSetter_)pitchSetter_(pitchValue_);}
    else if(activeWheel_==2) {modValue_=normalized;if(modSetter_)modSetter_(modValue_);}
    repaint();
}

int PerformanceKeyboard::noteAt(juce::Point<float> p) const noexcept {
    const auto keys=keyArea();
    if(!keys.toFloat().contains(p) || keys.getWidth()<=0 || keys.getHeight()<=0) return -1;

    const float whiteWidth=float(keys.getWidth())/float(whiteKeyCount);

    for(int i=0;i<whiteKeyCount-1;++i) {
        const int degree=i%7;
        if(degree==2 || degree==6) continue;
        const juce::Rectangle<float> black(
            float(keys.getX())+(float(i)+1.0f)*whiteWidth-whiteWidth*.31f,
            float(keys.getY()),whiteWidth*.62f,float(keys.getHeight())*.62f);
        if(black.contains(p)) {
            const int octave=i/7;
            const int whiteNote=firstMidiNote+octave*12+whiteOffsets[degree];
            return whiteNote+1;
        }
    }

    const int whiteIndex=juce::jlimit(0,whiteKeyCount-1,
        int((p.x-float(keys.getX()))/whiteWidth));
    return firstMidiNote+(whiteIndex/7)*12+whiteOffsets[whiteIndex%7];
}

void PerformanceKeyboard::setMouseNote(int note) {
    if(note==mouseNote_) return;
    if(mouseNote_>=0 && noteSetter_) noteSetter_(mouseNote_,false,0.0f);
    mouseNote_=note;
    if(mouseNote_>=0 && noteSetter_) noteSetter_(mouseNote_,true,0.85f);
    repaint();
}

void PerformanceKeyboard::mouseDown(const juce::MouseEvent& e) {
    if(pitchWheelArea().toFloat().contains(e.position)){activeWheel_=1;updateWheel(e.position);return;}
    if(modWheelArea().toFloat().contains(e.position)){activeWheel_=2;updateWheel(e.position);return;}
    setMouseNote(noteAt(e.position));
}
void PerformanceKeyboard::mouseDrag(const juce::MouseEvent& e) {if(activeWheel_) updateWheel(e.position);else setMouseNote(noteAt(e.position));}
void PerformanceKeyboard::mouseUp(const juce::MouseEvent&) {
    if(activeWheel_==1){pitchValue_=0.0f;if(pitchSetter_)pitchSetter_(0.0f);repaint();}
    activeWheel_=0;setMouseNote(-1);
}
void PerformanceKeyboard::mouseExit(const juce::MouseEvent& e) {
    if(!e.mods.isAnyMouseButtonDown()) setMouseNote(-1);
}

void PerformanceKeyboard::paint(juce::Graphics& g) {
    auto area=getLocalBounds();
    g.fillAll(Palette::background());

    const int right=juce::jmin(rightReserve,juce::jmax(300,area.getWidth()*27/100));
    auto rightBay=area.removeFromRight(right);
    const int bendWidth=juce::jmin(bendPanelWidth,juce::jmax(54,rightBay.getWidth()/6));

    auto bendParent=rightBay.removeFromLeft(bendWidth);
    well(g,bendParent.reduced(1,1));
    text(g,"BEND",bendParent.removeFromTop(13),7.2f,Palette::muted(),juce::Justification::centred);

    const int perfWidth=juce::jmin(performancePanelWidth,juce::jmax(150,rightBay.getWidth()/2));
    auto performanceParent=rightBay.removeFromLeft(perfWidth);
    well(g,performanceParent.reduced(1,1));
    auto perfCaptionArea=performanceParent;
    perfCaptionArea.removeFromTop(21);
    text(g,"GLIDE",perfCaptionArea.removeFromLeft(58).removeFromBottom(9),
         6.8f,Palette::muted(),juce::Justification::centred);

    auto clockParent=rightBay;
    well(g,clockParent.reduced(1,1));
    text(g,"ARP / CLOCK",clockParent.removeFromBottom(11),6.8f,Palette::muted(),juce::Justification::centred);

    auto leftControls=area.removeFromLeft(leftReserve);
    for(const auto& label:juce::StringArray{"PITCH","MOD"}) {
        auto wheel=leftControls.removeFromLeft(leftReserve/2).reduced(2,1);
        auto caption=wheel.removeFromBottom(10);
        well(g,wheel);
        auto track=wheel.reduced(8,3);
        g.setColour(Palette::border());g.fillRoundedRectangle(track.toFloat(),3);
        const float value=label=="PITCH"?pitchValue_:modValue_;
        const float unit=label=="PITCH"?(value+1.0f)*0.5f:value;
        const int y=track.getBottom()-juce::roundToInt(unit*float(track.getHeight()));
        g.setColour(signalSourceColour());
        g.fillRoundedRectangle(juce::Rectangle<float>(float(track.getX()+2),float(y-2),float(track.getWidth()-4),4.0f),1.5f);
        text(g,label,caption,7.0f,Palette::muted(),juce::Justification::centred);
    }

    const auto keys=keyArea();
    const float width=float(keys.getWidth())/float(whiteKeyCount);
    for(int i=0;i<whiteKeyCount;++i) {
        const int note=firstMidiNote+(i/7)*12+whiteOffsets[i%7];
        juce::Rectangle<float> key(float(keys.getX())+float(i)*width,float(keys.getY()),
                                   width,float(keys.getHeight()));
        const bool down=(note==mouseNote_);
        g.setColour(down?signalSurfaceColour(0.42f,0.72f):juce::Colour(0xffcdd5d9));
        g.fillRect(key);
        g.setColour(juce::Colour(0xff77838a));g.drawRect(key,.7f);
        if(i%7==0)
            text(g,"C"+juce::String(3+i/7),key.toNearestInt().removeFromBottom(11),
                 7.0f,juce::Colour(0xff596770),juce::Justification::centred);
    }

    for(int i=0;i<whiteKeyCount-1;++i) {
        const int degree=i%7;
        if(degree==2 || degree==6) continue;
        const int note=firstMidiNote+(i/7)*12+whiteOffsets[degree]+1;
        auto key=juce::Rectangle<float>(
            float(keys.getX())+(float(i)+1)*width-width*.31f,
            float(keys.getY()),width*.62f,float(keys.getHeight())*.62f);
        const bool down=(note==mouseNote_);
        g.setColour(down?signalSurfaceColour(0.55f,0.78f):juce::Colour(0xff0c1115));
        g.fillRect(key);
        g.setColour(Palette::border());g.drawRect(key,.8f);
    }
}
}
