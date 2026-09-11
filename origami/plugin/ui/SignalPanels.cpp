// mct-origami-v30.0.0-dynamic-source-layout-scaffold
// mct-origami-v26.4.3-match-signal-fill-exposure
// mct-origami-v26.4.2-curve-cropped-signal-fills
// mct-origami-v26.4.1-flat-signal-fills
// mct-origami-v26.4.0-global-signal-colour-system
#include "SignalPanels.h"
namespace mct::origami::ui {
void MixerPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    const juce::StringArray channels{"OSC 1","OSC 2","OSC 3","OSC 4","SUB","NOISE"};
    const int width=body.getWidth()/6;
    for(int i=0;i<6;++i) {
        auto strip=body.removeFromLeft(width).reduced(3,1);auto muteSolo=strip.removeFromBottom(19);auto caption=strip.removeFromBottom(21);
        auto track=strip.withSizeKeepingCentre(10,juce::jmax(12,strip.getHeight()-5));
        auto trackFloat=track.toFloat();
        g.setColour(Palette::inset());g.fillRoundedRectangle(trackFloat,5.0f);
        g.setColour(Palette::borderSoft());g.drawRoundedRectangle(trackFloat.reduced(.5f),5.0f,1.0f);

        const float height=static_cast<float>(track.getHeight());
        const int position=track.getY()+juce::roundToInt(height*(.31f+float(i%4)*.075f));
        auto cap=juce::Rectangle<float>(18.0f,5.0f).withCentre({float(track.getCentreX()),float(position)});
        g.setColour(Palette::raised());g.fillRoundedRectangle(cap,2.0f);
        g.setColour(Palette::borderStrong());g.drawRoundedRectangle(cap.reduced(.5f),2.0f,1.0f);
        g.setColour(Palette::accent().withAlpha(.88f));g.fillRect(cap.reduced(3.0f,2.0f));

        text(g,channels[i],caption,8.7f,Palette::muted(),juce::Justification::centred);
        well(g,muteSolo.reduced(1,0));
        text(g,"M   S",muteSolo,8.5f,Palette::secondary(),juce::Justification::centred);
    }
}
// mct-origami-core-controls-v18.2
FilterPanel::FilterPanel(ParameterSetter setter,ParameterGetter getter)
    : Panel("FILTER"),setter_(std::move(setter)),getter_(std::move(getter)) {
    for(auto* slider:{&cutoff_,&resonance_}) {
        addAndMakeVisible(slider);
        slider->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        slider->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
        slider->setRotaryParameters(juce::MathConstants<float>::pi*1.20f,
                                    juce::MathConstants<float>::pi*2.80f,true);
        slider->setMouseDragSensitivity(220);
    }

    cutoff_.setRange(20.0,20000.0,1.0);
    cutoff_.setSkewFactorFromMidPoint(1000.0);
    resonance_.setRange(0.0,1.0,0.001);

    if(getter_) {
        cutoff_.setValue(getter_(mct::origami::ParameterId::Cutoff),juce::dontSendNotification);
        resonance_.setValue(getter_(mct::origami::ParameterId::Resonance),juce::dontSendNotification);
    }

    cutoff_.onValueChange=[this]{
        if(setter_) setter_(mct::origami::ParameterId::Cutoff,float(cutoff_.getValue()));
        repaint();
    };
    resonance_.onValueChange=[this]{
        if(setter_) setter_(mct::origami::ParameterId::Resonance,float(resonance_.getValue()));
        repaint();
    };

    for(auto* label:{&cutoffLabel_,&resonanceLabel_}) {
        addAndMakeVisible(label);
        label->setJustificationType(juce::Justification::centred);
        label->setColour(juce::Label::textColourId,Palette::muted());
        label->setFont(juce::FontOptions(8.0f));
    }
    cutoffLabel_.setText("CUTOFF",juce::dontSendNotification);
    resonanceLabel_.setText("RESONANCE",juce::dontSendNotification);

    // V30 dynamic-filter UI scaffold. Filter 1 remains the exact same existing
    // engine filter; +/- are collection affordances only in this layout pass.
    for(auto* button:{&filter1_,&filterAdd_,&filterRemove_}) addAndMakeVisible(*button);
    filter1_.setClickingTogglesState(true);
    filter1_.setToggleState(true,juce::dontSendNotification);
    filter1_.setTooltip("Current engine Filter 1");
    filterAdd_.setTooltip("Dynamic filter allocation — reserved for the next engine pass");
    filterRemove_.setTooltip("Dynamic filter removal — reserved for the next engine pass");
}

void FilterPanel::syncFromModel() {
    if(!getter_) return;
    if(!cutoff_.isMouseButtonDown()) cutoff_.setValue(getter_(ParameterId::Cutoff),juce::dontSendNotification);
    if(!resonance_.isMouseButtonDown()) resonance_.setValue(getter_(ParameterId::Resonance),juce::dontSendNotification);
    repaint();
}
void FilterPanel::resized() {
    auto body=contentBounds();

    constexpr int railWidth=78;
    filterRail_=body.removeFromLeft(railWidth);
    body.removeFromLeft(6);

    auto rail=filterRail_.reduced(4,5);
    auto collectionControls=rail.removeFromBottom(24);
    filterRemove_.setBounds(collectionControls.removeFromLeft(
        (collectionControls.getWidth()-3)/2));
    collectionControls.removeFromLeft(3);
    filterAdd_.setBounds(collectionControls);
    rail.removeFromBottom(5);
    filter1_.setBounds(rail.removeFromTop(25).reduced(0,1));

    auto controls=body.removeFromBottom(juce::jmin(57,body.getHeight()/3+10));
    const int w=controls.getWidth()/6;
    auto place=[&](int idx,juce::Slider& slider,juce::Label& label){
        auto cell=controls.withX(controls.getX()+idx*w).withWidth(w);
        auto lab=cell.removeFromBottom(17);
        slider.setBounds(cell.reduced(5,0));
        label.setBounds(lab);
    };
    place(0,cutoff_,cutoffLabel_);
    place(1,resonance_,resonanceLabel_);
}

void FilterPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    constexpr int railWidth=78;
    auto rail=body.removeFromLeft(railWidth);
    body.removeFromLeft(6);

    well(g,rail);
    text(g,"FILTERS",rail.removeFromTop(18).reduced(5,0),8.0f,Palette::muted());

    text(g,"LOW-PASS",{body.getX()+4,5,100,24},10,Palette::muted());
    text(g,"ROUTING",{body.getRight()-96,5,90,24},9,Palette::muted(),juce::Justification::centredRight);

    auto controls=body.removeFromBottom(juce::jmin(57,body.getHeight()/3+10));
    body.removeFromBottom(7);
    auto routing=body.removeFromRight(82);
    body.removeFromRight(8);

    well(g,body);

    auto graphArea=body.reduced(8);
    g.setColour(Palette::border().withAlpha(.7f));
    for(int i=1;i<5;++i)
        g.drawVerticalLine(graphArea.getX()+graphArea.getWidth()*i/5,float(graphArea.getY()),float(graphArea.getBottom()));

    juce::Path response;
    response.startNewSubPath(float(graphArea.getX()),float(graphArea.getCentreY()));
    response.lineTo(float(graphArea.getX())+graphArea.getWidth()*.49f,float(graphArea.getCentreY()));
    response.cubicTo(float(graphArea.getX())+graphArea.getWidth()*.65f,float(graphArea.getY()),
                     float(graphArea.getX())+graphArea.getWidth()*.72f,float(graphArea.getBottom()),
                     float(graphArea.getRight()),float(graphArea.getBottom()-2));
    // Fill ONLY the response area down to the graph's bottom/source edge.
    // No gradient and no whole-viewport tint.
    {
        juce::Path fill=response;
        fill.lineTo(float(graphArea.getRight()),float(graphArea.getBottom()));
        fill.lineTo(float(graphArea.getX()),float(graphArea.getBottom()));
        fill.closeSubPath();

        g.setColour(signalSurfaceColour(0.46f,0.22f));
        g.fillPath(fill);
    }

    g.setColour(Palette::accent());
    g.strokePath(response,juce::PathStrokeType(1.3f));

    const int rowHeight=juce::jmin(24,routing.getHeight()/3);
    for(const auto& label:juce::StringArray{"Serial","Parallel","Split"}) {
        auto row=routing.removeFromTop(rowHeight).reduced(1,1);
        well(g,row);
        text(g,label,row,10,label=="Serial"?Palette::text():Palette::muted(),juce::Justification::centred);
    }

    auto remaining=controls;
    remaining.removeFromLeft((controls.getWidth()/6)*2);
    dials(g,remaining,{"DRIVE","KEYTRACK","ENV AMT","MIX"});
}
void FxPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    if(pre_) {
        const int height=body.getHeight()/3;
        for(const auto& label:juce::StringArray{"DIST","COMP","SAT"}) {auto slot=body.removeFromTop(height).reduced(0,3);well(g,slot);text(g,label,slot,10,Palette::muted(),juce::Justification::centred);}
    } else {
        const int width=body.getWidth()/4;
        for(const auto& label:juce::StringArray{"CHORUS","DELAY","REVERB","+"}) {
            auto slot=body.removeFromLeft(width).reduced(2,3);well(g,slot);
            if(label=="+") {
                text(g,"+",slot.withTrimmedBottom(slot.getHeight()/3),22,Palette::muted(),juce::Justification::centred);
            } else {
                auto mark=slot.withTrimmedBottom(slot.getHeight()/3).toFloat();
                g.setColour(Palette::borderStrong());
                g.drawHorizontalLine(juce::roundToInt(mark.getCentreY()),mark.getCentreX()-8.0f,mark.getCentreX()+8.0f);
            }
            if(label!="+")text(g,label,slot.removeFromBottom(33),8,Palette::muted(),juce::Justification::centred);
        }
    }
}
}
