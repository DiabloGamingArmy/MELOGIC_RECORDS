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
constexpr int bendWidth=70;
constexpr int wheelWidth=44;
constexpr int voiceWidth=132;
constexpr int glideWidth=70;
constexpr int arpWidth=142;
constexpr int utilityWidth=34;
constexpr int rightReserve=voiceWidth+glideWidth+arpWidth+utilityWidth;
constexpr int whiteOffsets[7]={0,2,4,5,7,9,11};

struct PerformanceLayout {
    juce::Rectangle<int> bend,pitch,mod,keyboard,voice,glide,arpClock,utility;
};

// The BEND row captions (UP / DOWN at Type::secondary) own this many px.
constexpr int bendLabelWidth=36;
PerformanceLayout layoutFor(juce::Rectangle<int> bounds) {
    PerformanceLayout l;
    auto left=bounds;
    l.bend=left.removeFromLeft(bendWidth);
    l.pitch=left.removeFromLeft(wheelWidth);
    l.mod=left.removeFromLeft(wheelWidth);

    const int right=juce::jmin(rightReserve,juce::jmax(300,left.getWidth()*27/100));
    auto rightBay=left.removeFromRight(right);
    l.keyboard=left;

    const int utility=juce::jmin(utilityWidth,rightBay.getWidth());
    l.utility=rightBay.removeFromRight(utility);
    const int arp=juce::jmin(arpWidth,rightBay.getWidth());
    l.arpClock=rightBay.removeFromRight(arp);
    const int glide=juce::jmin(glideWidth,rightBay.getWidth());
    l.glide=rightBay.removeFromRight(glide);
    l.voice=rightBay;
    return l;
}

void moduleSurface(juce::Graphics& g,juce::Rectangle<int> r,const juce::String& title) {
    r=r.reduced(2,2);
    g.setColour(juce::Colour(0xff151515));
    g.fillRoundedRectangle(r.toFloat(),4.0f);
    text(g,title,r.removeFromTop(13),Type::label,Palette::muted(),juce::Justification::centred);
}
} // namespace

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
    return layoutFor(getLocalBounds()).keyboard;
}

juce::Rectangle<int> PerformanceKeyboard::pitchWheelArea() const noexcept {
    auto r=layoutFor(getLocalBounds()).pitch.reduced(5,3);
    r.removeFromTop(13);r.removeFromBottom(3);return r;
}
juce::Rectangle<int> PerformanceKeyboard::modWheelArea() const noexcept {
    auto r=layoutFor(getLocalBounds()).mod.reduced(5,3);
    r.removeFromTop(13);r.removeFromBottom(3);return r;
}
void PerformanceKeyboard::resized() {
    const auto l=layoutFor(getLocalBounds());

    auto bend=l.bend.reduced(5,3);bend.removeFromTop(13);
    auto up=bend.removeFromTop(bend.getHeight()/2).reduced(0,2);
    auto down=bend.reduced(0,2);
    bendRange_.setBounds(up.withTrimmedLeft(bendLabelWidth));
    bendDownRange_.setBounds(down.withTrimmedLeft(bendLabelWidth));

    auto voice=l.voice.reduced(5,3);voice.removeFromTop(14);
    auto top=voice.removeFromTop(22);
    const int half=top.getWidth()/2;
    voiceMode_.setBounds(top.removeFromLeft(half).reduced(1));
    priority_.setBounds(top.reduced(1));
    legato_.setBounds(voice.removeFromTop(22).reduced(1));

    auto glide=l.glide.reduced(5,3);glide.removeFromTop(14);
    glide_.setBounds(glide.withSizeKeepingCentre(42,42));

    auto arp=l.arpClock.reduced(5,3);arp.removeFromTop(14);
    auto controls=arp.removeFromTop(22);
    arpEnable_.setBounds(controls.removeFromLeft(58).reduced(1));
    arpSettings_.setBounds(l.utility.reduced(6,18));
    arpClockSummary_.setBounds(arp.removeFromTop(13));
    arpPatternSummary_.setBounds(arp.removeFromTop(11));
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
    g.fillAll(Palette::background());
    const auto l=layoutFor(getLocalBounds());

    moduleSurface(g,l.bend,"BEND");
    auto bendRows=l.bend.reduced(5,3);bendRows.removeFromTop(13);
    auto upRow=bendRows.removeFromTop(bendRows.getHeight()/2).reduced(0,2);
    auto downRow=bendRows.reduced(0,2);
    g.setColour(juce::Colour(0xff1b1b1b));
    g.fillRoundedRectangle(upRow.toFloat(),3.5f);
    g.fillRoundedRectangle(downRow.toFloat(),3.5f);
    text(g,"UP",upRow.withTrimmedLeft(4).withWidth(bendLabelWidth-5),Type::secondary,Palette::muted(),juce::Justification::centredLeft);
    text(g,"DOWN",downRow.withTrimmedLeft(4).withWidth(bendLabelWidth-5),Type::secondary,Palette::muted(),juce::Justification::centredLeft);

    moduleSurface(g,l.pitch,"PITCH");
    moduleSurface(g,l.mod,"MOD");
    for(int index=0;index<2;++index) {
        auto track=(index==0?pitchWheelArea():modWheelArea()).reduced(8,3);
        g.setColour(juce::Colour(0xff202020));g.fillRoundedRectangle(track.toFloat(),3.0f);
        const float value=index==0?pitchValue_:modValue_;
        const float unit=index==0?(value+1.0f)*0.5f:value;
        const int y=track.getBottom()-juce::roundToInt(unit*float(track.getHeight()));
        g.setColour(signalSourceColour());
        g.fillRoundedRectangle(juce::Rectangle<float>(float(track.getX()+2),float(y-2),float(track.getWidth()-4),4.0f),1.5f);
    }

    moduleSurface(g,l.voice,"VOICE");
    moduleSurface(g,l.glide,"GLIDE");
    moduleSurface(g,l.arpClock,"ARP / CLOCK");
    moduleSurface(g,l.utility,"");

    const auto keys=l.keyboard;
    const float width=float(keys.getWidth())/float(whiteKeyCount);
    for(int i=0;i<whiteKeyCount;++i) {
        const int note=firstMidiNote+(i/7)*12+whiteOffsets[i%7];
        juce::Rectangle<float> key(float(keys.getX())+float(i)*width,float(keys.getY()),width,float(keys.getHeight()));
        const bool down=(note==mouseNote_);
        g.setColour(down?signalSurfaceColour(0.42f,0.72f):juce::Colour(0xffcdd5d9));g.fillRect(key);
        g.setColour(juce::Colour(0xff77838a));g.drawRect(key,.7f);
        if(i%7==0) text(g,"C"+juce::String(3+i/7),key.toNearestInt().removeFromBottom(14),Type::secondary,juce::Colour(0xff596770),juce::Justification::centred);
    }
    for(int i=0;i<whiteKeyCount-1;++i) {
        const int degree=i%7;if(degree==2||degree==6) continue;
        const int note=firstMidiNote+(i/7)*12+whiteOffsets[degree]+1;
        auto key=juce::Rectangle<float>(float(keys.getX())+(float(i)+1)*width-width*.31f,float(keys.getY()),width*.62f,float(keys.getHeight())*.62f);
        const bool down=(note==mouseNote_);
        g.setColour(down?signalSurfaceColour(0.55f,0.78f):juce::Colour(0xff0c1115));g.fillRect(key);
        g.setColour(Palette::border());g.drawRect(key,.8f);
    }
}
}
