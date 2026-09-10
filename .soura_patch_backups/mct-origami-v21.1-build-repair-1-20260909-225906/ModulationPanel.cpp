#include "ModulationPanel.h"
namespace mct::origami::ui {
ModulationPanel::ModulationPanel(ParameterSetter setter,ParameterGetter getter)
    :Panel("MODULATION"),setter_(std::move(setter)),getter_(std::move(getter)) {
    const juce::StringArray labels{"ENV 1","ENV 2","ENV 3","LFO 1","LFO 2","LFO 3","LFO 4","FUNCTIONS","RANDOM"};
    for(int i=0;i<9;++i) {
        auto& tab=tabs_[static_cast<std::size_t>(i)];
        tab.setButtonText(labels[i]);
        tab.setTooltip("Select modulation source");
        addAndMakeVisible(tab);
        tab.setToggleState(i==0,juce::dontSendNotification);
        tab.onClick=[this,i]{
            selected_=i;
            for(int index=0;index<9;++index)
                tabs_[static_cast<std::size_t>(index)].setToggleState(index==i,juce::dontSendNotification);
            const bool env1=(selected_==0);
            for(auto& s:envSliders_) s.setVisible(env1);
            for(auto& l:envLabels_) l.setVisible(env1);
            repaint();
        };
    }

    const std::array<mct::origami::ParameterId,4> ids{
        mct::origami::ParameterId::Attack,
        mct::origami::ParameterId::Decay,
        mct::origami::ParameterId::Sustain,
        mct::origami::ParameterId::Release
    };
    const juce::StringArray envNames{"ATTACK","DECAY","SUSTAIN","RELEASE"};

    for(int i=0;i<4;++i) {
        auto& slider=envSliders_[static_cast<std::size_t>(i)];
        auto& label=envLabels_[static_cast<std::size_t>(i)];
        addAndMakeVisible(slider);
        addAndMakeVisible(label);
        slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        slider.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
        slider.setRotaryParameters(juce::MathConstants<float>::pi*1.20f,
                                   juce::MathConstants<float>::pi*2.80f,true);
        slider.setMouseDragSensitivity(220);
        label.setJustificationType(juce::Justification::centred);
        label.setColour(juce::Label::textColourId,Palette::muted());
        label.setFont(juce::FontOptions(8.0f));
        label.setText(envNames[i],juce::dontSendNotification);
    }

    envSliders_[0].setRange(.001,10.0,.001);
    envSliders_[0].setSkewFactorFromMidPoint(.15);
    envSliders_[1].setRange(.001,10.0,.001);
    envSliders_[1].setSkewFactorFromMidPoint(.25);
    envSliders_[2].setRange(0.0,1.0,.001);
    envSliders_[3].setRange(.001,20.0,.001);
    envSliders_[3].setSkewFactorFromMidPoint(.35);

    if(getter_) {
        for(int i=0;i<4;++i)
            envSliders_[static_cast<std::size_t>(i)].setValue(
                getter_(ids[static_cast<std::size_t>(i)]),juce::dontSendNotification);
    }

    for(int i=0;i<4;++i) {
        envSliders_[static_cast<std::size_t>(i)].onValueChange=[this,i,ids]{
            if(setter_)
                setter_(ids[static_cast<std::size_t>(i)],
                        float(envSliders_[static_cast<std::size_t>(i)].getValue()));
            repaint();
        };
    }
}
void ModulationPanel::resized() {
    auto bar=getLocalBounds().withTrimmedLeft(120).withTrimmedRight(10).removeFromTop(29).reduced(0,4);
    const int width=bar.getWidth()/9;
    for(auto& tab:tabs_)
        tab.setBounds(bar.removeFromLeft(width).reduced(1,0));

    auto body=contentBounds();
    const int available=body.getWidth()-16;
    auto main=body.removeFromLeft(juce::roundToInt(available*.36));
    auto controls=main.removeFromBottom(juce::jmin(58,main.getHeight()/3+8));
    const int w=controls.getWidth()/4;

    for(int i=0;i<4;++i) {
        auto cell=controls.withX(controls.getX()+i*w).withWidth(w);
        auto lab=cell.removeFromBottom(17);
        envSliders_[static_cast<std::size_t>(i)].setBounds(cell.reduced(5,0));
        envLabels_[static_cast<std::size_t>(i)].setBounds(lab);
    }
}
void ModulationPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    // mct-origami-v19.3-visual-cleanup
    // SYNTH shows modulation sources. Routing belongs on MATRIX.
    const int gap=8;
    const int columnWidth=(body.getWidth()-gap)/2;
    auto main=body.removeFromLeft(columnWidth);
    body.removeFromLeft(gap);
    auto lfo=body;

    auto controls=main.removeFromBottom(juce::jmin(58,main.getHeight()/3+8));
    main.removeFromBottom(6);
    auto graphCaption=main.removeFromTop(17);
    text(g,tabs_[static_cast<std::size_t>(selected_)].getButtonText()+" / DISPLAY",
         graphCaption,9,Palette::muted());
    graph(g,main,selected_<3);
    dials(g,controls,selected_<3
        ? juce::StringArray{"ATTACK","DECAY","SUSTAIN","RELEASE"}
        : juce::StringArray{"RATE","SHAPE","PHASE","SMOOTH"});

    auto lfoControls=lfo.removeFromBottom(juce::jmin(58,lfo.getHeight()/3+8));
    auto lfoOptions=lfo.removeFromBottom(25);
    lfo.removeFromBottom(5);
    auto lfoCaption=lfo.removeFromTop(17);
    text(g,"LFO / DISPLAY",lfoCaption,9,Palette::muted());
    graph(g,lfo);
    text(g,"Sine      BPM      1/4      Off",lfoOptions,10,Palette::muted(),
         juce::Justification::centred);
}
void MacroPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    const int width=body.getWidth()/2,height=body.getHeight()/2;
    for(int i=0;i<4;++i) {auto cell=juce::Rectangle<int>(body.getX()+(i%2)*width,body.getY()+(i/2)*height,width,height).reduced(5);dial(g,cell,"MACRO "+juce::String(i+1),.1f);}
}
}
