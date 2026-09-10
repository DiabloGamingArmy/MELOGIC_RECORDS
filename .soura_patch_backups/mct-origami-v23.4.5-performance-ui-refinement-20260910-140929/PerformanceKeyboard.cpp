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
constexpr int leftReserve=96;
constexpr int bendPanelWidth=58;
constexpr int futureReserve=282;
constexpr int rightReserve=bendPanelWidth+futureReserve;
constexpr int whiteOffsets[7]={0,2,4,5,7,9,11};
}

PerformanceKeyboard::~PerformanceKeyboard() {
    if(mouseNote_>=0) keyboardState_.noteOff(1,mouseNote_,0.0f);
}

juce::Rectangle<int> PerformanceKeyboard::keyArea() const noexcept {
    auto area=getLocalBounds().reduced(3,1);
    area.removeFromRight(juce::jmin(rightReserve,juce::jmax(bendPanelWidth,area.getWidth()/3)));
    area.removeFromLeft(leftReserve);
    // V23.3.2: Pitch | Mod | Keyboard are contiguous.
    return area.reduced(1,0);
}

juce::Rectangle<int> PerformanceKeyboard::pitchWheelArea() const noexcept {
    auto a=getLocalBounds().reduced(3,1);
    auto left=a.removeFromLeft(leftReserve);
    auto wheel=left.removeFromLeft(leftReserve/2).reduced(4,1);
    wheel.removeFromBottom(12);
    return wheel;
}
juce::Rectangle<int> PerformanceKeyboard::modWheelArea() const noexcept {
    auto a=getLocalBounds().reduced(3,1);
    auto left=a.removeFromLeft(leftReserve);
    left.removeFromLeft(leftReserve/2);
    auto wheel=left.reduced(4,1);
    wheel.removeFromBottom(12);
    return wheel;
}
void PerformanceKeyboard::resized() {
    auto a=getLocalBounds().reduced(3,1);
    const int right=juce::jmin(rightReserve,juce::jmax(bendPanelWidth,a.getWidth()/3));
    auto rightBay=a.removeFromRight(right);
    auto bend=rightBay.removeFromLeft(bendPanelWidth).reduced(2,2);
    bend.removeFromTop(15);bendRange_.setBounds(bend.reduced(2,1));
    auto perf=rightBay.removeFromLeft(182).reduced(3,2);
    auto top=perf.removeFromTop(22);
    voiceMode_.setBounds(top.removeFromLeft(58).reduced(1));
    priority_.setBounds(top.removeFromLeft(58).reduced(1));
    legato_.setBounds(top.reduced(1));
    perf.removeFromTop(2);
    auto glideArea=perf.removeFromLeft(72);
    glideArea.removeFromTop(8);
    glide_.setBounds(glideArea.reduced(5,0));
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
    if(mouseNote_>=0) keyboardState_.noteOff(1,mouseNote_,0.0f);
    mouseNote_=note;
    if(mouseNote_>=0) keyboardState_.noteOn(1,mouseNote_,0.85f);
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
    auto area=getLocalBounds().reduced(3,1);

    const int right=juce::jmin(rightReserve,juce::jmax(bendPanelWidth,area.getWidth()/3));
    auto rightBay=area.removeFromRight(right);
    auto bendParent=rightBay.removeFromLeft(bendPanelWidth);
    well(g,bendParent.reduced(1,0));
    text(g,"BEND RANGE",bendParent.removeFromTop(15),7.5f,Palette::muted(),juce::Justification::centred);

    auto performanceParent=rightBay.removeFromLeft(182);
    well(g,performanceParent.reduced(1,0));
    text(g,"VOICE / GLIDE",performanceParent.removeFromBottom(12),7.0f,Palette::muted(),juce::Justification::centred);
    auto future=rightBay;
    auto brand=future.removeFromBottom(30);
    text(g,"MCT ORIGAMI",brand.removeFromTop(17),8.5f,Palette::text(),juce::Justification::centred);
    text(g,"PERFORMANCE",brand,7.0f,Palette::muted(),juce::Justification::centred);

    auto leftControls=area.removeFromLeft(leftReserve);
    for(const auto& label:juce::StringArray{"PITCH","MOD"}) {
        auto wheel=leftControls.removeFromLeft(leftReserve/2).reduced(3,0);
        auto caption=wheel.removeFromBottom(12);
        well(g,wheel);
        auto track=wheel.reduced(7,2);
        g.setColour(Palette::border());g.fillRoundedRectangle(track.toFloat(),3);
        g.setColour(Palette::muted());
        const float value=label=="PITCH"?pitchValue_:modValue_;
        const float unit=label=="PITCH"?(value+1.0f)*0.5f:value;
        const int y=track.getBottom()-juce::roundToInt(unit*float(track.getHeight()));
        g.fillRoundedRectangle(juce::Rectangle<float>(float(track.getX()+2),float(y-2),float(track.getWidth()-4),4.0f),1.5f);
        text(g,label,caption,7.5f,Palette::muted(),juce::Justification::centred);
    }

    auto keys=area;
    keys=keys.reduced(1,0);
    well(g,keys);
    keys=keys.reduced(3,1);
    const float width=float(keys.getWidth())/float(whiteKeyCount);

    for(int i=0;i<whiteKeyCount;++i) {
        const int note=firstMidiNote+(i/7)*12+whiteOffsets[i%7];
        juce::Rectangle<float> key(float(keys.getX())+float(i)*width,float(keys.getY()),
                                   width-1,float(keys.getHeight()));
        const bool down=keyboardState_.isNoteOnForChannels(0xffff,note);
        g.setColour(down?juce::Colour(0xffaeb8be):juce::Colour(0xffcdd5d9));
        g.fillRoundedRectangle(key,1.5f);
        g.setColour(juce::Colour(0xff8b969e));g.drawRoundedRectangle(key,.8f,.7f);
        if(i%7==0)
            text(g,"C"+juce::String(3+i/7),key.toNearestInt().removeFromBottom(13),
                 7.5f,juce::Colour(0xff596770),juce::Justification::centred);
    }

    for(int i=0;i<whiteKeyCount-1;++i) {
        const int degree=i%7;
        if(degree==2 || degree==6) continue;
        const int note=firstMidiNote+(i/7)*12+whiteOffsets[degree]+1;
        auto key=juce::Rectangle<float>(
            float(keys.getX())+(float(i)+1)*width-width*.31f,
            float(keys.getY()),width*.62f,float(keys.getHeight())*.60f);
        const bool down=keyboardState_.isNoteOnForChannels(0xffff,note);
        g.setColour(down?juce::Colour(0xff30373b):juce::Colour(0xff0c1115));
        g.fillRoundedRectangle(key,1.5f);
        g.setColour(Palette::border());g.drawRoundedRectangle(key.reduced(.5f),1.5f,1);
    }
}
}
