// mct-origami-keyboard-compact-bottom-v23.1.2
// mct-origami-keyboard-density-reserve-v23.1.1
// mct-origami-playable-keyboard-audio-v23.1
#include "PerformanceKeyboard.h"
namespace mct::origami::ui {
namespace {
constexpr int leftReserve=250;
constexpr int rightReserve=340;
constexpr int wheelsWidth=104;
constexpr int whiteOffsets[7]={0,2,4,5,7,9,11};
}

PerformanceKeyboard::~PerformanceKeyboard() {
    if(mouseNote_>=0) keyboardState_.noteOff(1,mouseNote_,0.0f);
}

juce::Rectangle<int> PerformanceKeyboard::keyArea() const noexcept {
    auto area=getLocalBounds().reduced(3,1);
    const int right=juce::jmin(rightReserve,juce::jmax(0,area.getWidth()/3));
    area.removeFromRight(right);

    // V23.1.1: reserve a dedicated left performance-control bay.
    const int left=juce::jmin(leftReserve,juce::jmax(wheelsWidth,area.getWidth()/6));
    area.removeFromLeft(left);
    area.removeFromTop(2);
    area.removeFromBottom(1);
    return area.reduced(2,0);
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

void PerformanceKeyboard::mouseDown(const juce::MouseEvent& e) { setMouseNote(noteAt(e.position)); }
void PerformanceKeyboard::mouseDrag(const juce::MouseEvent& e) { setMouseNote(noteAt(e.position)); }
void PerformanceKeyboard::mouseUp(const juce::MouseEvent&) { setMouseNote(-1); }
void PerformanceKeyboard::mouseExit(const juce::MouseEvent& e) {
    if(!e.mods.isAnyMouseButtonDown()) setMouseNote(-1);
}

void PerformanceKeyboard::paint(juce::Graphics& g) {
    auto area=getLocalBounds().reduced(3,1);

    const int right=juce::jmin(rightReserve,juce::jmax(0,area.getWidth()/3));
    auto future=area.removeFromRight(right);
    text(g,"MCT ORIGAMI",future.removeFromTop(22),10,Palette::text(),juce::Justification::centred);
    text(g,"PERFORMANCE",future.removeFromTop(16),8,Palette::muted(),juce::Justification::centred);

    // V23.1.1: Pitch/Mod remain at far left. Remaining left bay intentionally
    // stays empty for future triggers, arp, glide, bend and performance controls.
    const int left=juce::jmin(leftReserve,juce::jmax(wheelsWidth,area.getWidth()/6));
    auto leftControls=area.removeFromLeft(left);
    auto wheels=leftControls.removeFromLeft(wheelsWidth);
    for(const auto& label:juce::StringArray{"PITCH","MOD"}) {
        auto wheel=wheels.removeFromLeft(48).reduced(7,3);
        auto caption=wheel.removeFromBottom(14);
        well(g,wheel);
        auto track=wheel.reduced(8,4);
        g.setColour(Palette::border());g.fillRoundedRectangle(track.toFloat(),3);
        g.setColour(Palette::muted());
        for(int i=-2;i<=2;++i)
            g.drawHorizontalLine(track.getCentreY()+i*3,float(track.getX()+2),float(track.getRight()-2));
        text(g,label,caption,8,Palette::muted(),juce::Justification::centred);
    }

    auto keys=area;
    keys.removeFromTop(2);
    keys.removeFromBottom(1);
    keys=keys.reduced(2,0);
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
