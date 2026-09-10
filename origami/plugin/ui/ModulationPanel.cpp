// mct-origami-v26.4.2-curve-cropped-signal-fills
// mct-origami-v26.4.1-flat-signal-fills
// mct-origami-v26.4.0-global-signal-colour-system
// mct-origami-modulation-completion-v24
#include "ModulationPanel.h"
#include <cmath>
namespace mct::origami::ui {
namespace {
constexpr std::array<ParameterId,4> envelopeIds{ParameterId::Attack,ParameterId::Decay,ParameterId::Sustain,ParameterId::Release};
void rotary(juce::Component& parent,juce::Slider& slider,juce::Label& label,const juce::String& name) {
    parent.addAndMakeVisible(slider);parent.addAndMakeVisible(label);slider.setName(name);
    slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    slider.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    slider.setRotaryParameters(juce::MathConstants<float>::pi*1.2f,juce::MathConstants<float>::pi*2.8f,true);
    slider.setMouseDragSensitivity(220);slider.setScrollWheelEnabled(false);
    label.setText(name,juce::dontSendNotification);label.setJustificationType(juce::Justification::centred);
    label.setFont(juce::FontOptions(8.0f));label.setColour(juce::Label::textColourId,Palette::muted());
}
void place(juce::Rectangle<int> cell,juce::Slider& slider,juce::Label& label) {
    label.setBounds(cell.removeFromBottom(17));slider.setBounds(cell.withSizeKeepingCentre(40,38));
}
dsp::EnvelopeSettings readEnvelope(const std::array<juce::Slider,4>& s) {
    return {static_cast<float>(s[0].getValue()),static_cast<float>(s[1].getValue()),
            static_cast<float>(s[2].getValue()),static_cast<float>(s[3].getValue())};
}
}

ModulationPanel::ModulationPanel(ParameterSetter setter,ParameterGetter getter,ModulationBindings bindings)
    :Panel("MODULATION"),setter_(std::move(setter)),getter_(std::move(getter)),bindings_(std::move(bindings)) {
    const juce::StringArray names{"ENV 1","ENV 2","ENV 3","LFO 1","LFO 2","LFO 3","LFO 4","FUNCTIONS","RANDOM"};
    for(int i=0;i<9;++i) {
        auto& tab=tabs_[static_cast<std::size_t>(i)];addAndMakeVisible(tab);tab.setButtonText(names[i]);
        tab.setClickingTogglesState(true);tab.setToggleState(i==0,juce::dontSendNotification);
        tab.setTooltip("Select "+names[i]+" modulation source");
        tab.onClick=[this,i]{
            selected_=i;
            for(std::size_t j=0;j<tabs_.size();++j) tabs_[j].setToggleState(j==static_cast<std::size_t>(i),juce::dontSendNotification);
            syncFromModel();updateVisibleControls();resized();repaint();
        };
    }
    const juce::StringArray namesEnv{"ATTACK","DECAY","SUSTAIN","RELEASE"};
    for(std::size_t i=0;i<4;++i) {
        rotary(*this,envSliders_[i],envLabels_[i],namesEnv[static_cast<int>(i)]);
        const auto& p=*findParameter(envelopeIds[i]);envSliders_[i].setRange(p.minimum,p.maximum,0);
        if(i!=2) envSliders_[i].setSkewFactorFromMidPoint(i==3?.35:.15);
        envSliders_[i].onValueChange=[this]{commitEnvelope();repaint();};
    }
    rotary(*this,rate_,rateLabel_,"RATE / Hz");rate_.setRange(.01,40,0);rate_.setSkewFactorFromMidPoint(2);
    rate_.setTextBoxStyle(juce::Slider::TextBoxRight,false,50,18);
    rotary(*this,curve_,curveLabel_,"CURVE");curve_.setRange(-1,1,.001);curve_.setTextBoxStyle(juce::Slider::TextBoxRight,false,50,18);
    shape_.setName("LFO waveform");mode_.setName("LFO mode");
    shape_.addItem("Sine",1);shape_.addItem("Triangle",2);shape_.addItem("Saw",3);shape_.addItem("Square",4);
    mode_.addItem("Free running",1);mode_.addItem("Note retrigger",2);
    for(auto* box:{&shape_,&mode_}) {addAndMakeVisible(box);box->setScrollWheelEnabled(false);}
    auto update=[this]{commitGenerator();repaint();};
    shape_.onChange=update;mode_.onChange=update;rate_.onValueChange=update;curve_.onValueChange=update;
    syncFromModel();updateVisibleControls();
}
void ModulationPanel::commitEnvelope() {
    if(selected_==0) {
        if(setter_) for(std::size_t i=0;i<4;++i) setter_(envelopeIds[i],static_cast<float>(envSliders_[i].getValue()));
        return;
    }
    if(selected_!=1 && selected_!=2) return;
    if(!bindings_.snapshot || !bindings_.modulation) return;
    auto mod=bindings_.snapshot().modulation;
    (selected_==1?mod.env2:mod.env3)=readEnvelope(envSliders_);
    if(bindings_.modulation(mod)) cached_=mod;
}
void ModulationPanel::commitGenerator() {
    if(!bindings_.snapshot || !bindings_.modulation) return;
    auto mod=bindings_.snapshot().modulation;
    if(selected_>=3 && selected_<=6) {
        auto& lfo=lfoSettings(mod,static_cast<std::size_t>(selected_-3));
        lfo.shape=static_cast<LfoShape>(shape_.getSelectedId());
        lfo.mode=static_cast<LfoMode>(mode_.getSelectedId());
        lfo.rateHz=static_cast<float>(rate_.getValue());
    } else if(selected_==7) {
        mod.function.rateHz=static_cast<float>(rate_.getValue());
        mod.function.curve=static_cast<float>(curve_.getValue());
    } else if(selected_==8) {
        mod.random.rateHz=static_cast<float>(rate_.getValue());
    } else return;
    if(bindings_.modulation(mod)) cached_=mod;
}
void ModulationPanel::updateVisibleControls() {
    const bool env=selected_<=2;
    const bool lfo=selected_>=3 && selected_<=6;
    const bool function=selected_==7;
    const bool random=selected_==8;
    for(auto& s:envSliders_) s.setVisible(env);
    for(auto& l:envLabels_) l.setVisible(env);
    rate_.setVisible(lfo||function||random);rateLabel_.setVisible(lfo||function||random);
    shape_.setVisible(lfo);mode_.setVisible(lfo);
    curve_.setVisible(function);curveLabel_.setVisible(function);
}
void ModulationPanel::syncFromModel() {
    if(bindings_.snapshot) cached_=bindings_.snapshot().modulation;
    if(selected_==0) {
        if(getter_) for(std::size_t i=0;i<4;++i) if(!envSliders_[i].isMouseButtonDown())
            envSliders_[i].setValue(getter_(envelopeIds[i]),juce::dontSendNotification);
    } else if(selected_==1 || selected_==2) {
        const auto& e=selected_==1?cached_.env2:cached_.env3;
        const std::array<float,4> values{e.attack,e.decay,e.sustain,e.release};
        for(std::size_t i=0;i<4;++i) if(!envSliders_[i].isMouseButtonDown())
            envSliders_[i].setValue(values[i],juce::dontSendNotification);
    } else if(selected_>=3 && selected_<=6) {
        const auto& lfo=lfoSettings(cached_,static_cast<std::size_t>(selected_-3));
        shape_.setSelectedId(static_cast<int>(lfo.shape),juce::dontSendNotification);
        mode_.setSelectedId(static_cast<int>(lfo.mode),juce::dontSendNotification);
        if(!rate_.isMouseButtonDown()) rate_.setValue(lfo.rateHz,juce::dontSendNotification);
    } else if(selected_==7) {
        if(!rate_.isMouseButtonDown()) rate_.setValue(cached_.function.rateHz,juce::dontSendNotification);
        if(!curve_.isMouseButtonDown()) curve_.setValue(cached_.function.curve,juce::dontSendNotification);
    } else if(selected_==8) {
        if(!rate_.isMouseButtonDown()) rate_.setValue(cached_.random.rateHz,juce::dontSendNotification);
    }
    updateVisibleControls();repaint();
}
void ModulationPanel::resized() {
    auto bar=getLocalBounds().withTrimmedLeft(120).withTrimmedRight(10).removeFromTop(29).reduced(0,4);
    const int width=bar.getWidth()/9;for(auto& tab:tabs_) tab.setBounds(bar.removeFromLeft(width).reduced(1,0));
    auto body=contentBounds();auto controls=body.removeFromBottom(62);
    if(selected_<=2) {
        const int cell=controls.getWidth()/4;
        for(std::size_t i=0;i<4;++i) place(controls.removeFromLeft(cell),envSliders_[i],envLabels_[i]);
    } else {
        auto left=controls.removeFromLeft(120);rateLabel_.setBounds(left.removeFromBottom(17));rate_.setBounds(left);
        if(selected_>=3 && selected_<=6) {
            shape_.setBounds(controls.removeFromTop(24).reduced(5,1));
            mode_.setBounds(controls.removeFromTop(24).reduced(5,1));
        } else if(selected_==7) {
            auto cell=controls.removeFromLeft(120);curveLabel_.setBounds(cell.removeFromBottom(17));curve_.setBounds(cell);
        }
    }
}
void ModulationPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    body.removeFromBottom(66);auto caption=body.removeFromTop(17);
    juce::String title;
    if(selected_<=2) title="ENV "+juce::String(selected_+1)+(selected_==0?" / AMP + SOURCE":" / MOD SOURCE");
    else if(selected_>=3 && selected_<=6) title="LFO "+juce::String(selected_-2)+" / "+(lfoSettings(cached_,static_cast<std::size_t>(selected_-3)).mode==LfoMode::Free?"FREE":"PER NOTE");
    else if(selected_==7) title="FUNCTION / CURVED BIPOLAR";
    else title="RANDOM / SAMPLE + HOLD";
    text(g,title,caption,9,Palette::muted());
    well(g,body);

    // ENV/LFO use a flat derived red, but it is geometrically clipped by
    // the modulation curve. The bottom edge is the visual source/baseline.
    // Function/Random remain neutral until their own visual language is defined.
    auto r=body.reduced(10).toFloat();juce::Path p;
    if(selected_<=2) {
        const auto e=readEnvelope(envSliders_);const double hold=.25,total=e.attack+e.decay+hold+e.release;
        p.startNewSubPath(r.getX(),r.getBottom());
        auto point=[&](double t,double v){p.lineTo(r.getX()+static_cast<float>(t/total)*r.getWidth(),r.getBottom()-static_cast<float>(v)*r.getHeight());};
        point(e.attack,1);point(e.attack+e.decay,e.sustain);point(e.attack+e.decay+hold,e.sustain);point(total,0);
    } else if(selected_>=3 && selected_<=6) {
        const auto& l=lfoSettings(cached_,static_cast<std::size_t>(selected_-3));
        for(int i=0;i<256;++i) {const float x=float(i)/255.f;const float y=r.getCentreY()-Lfo::shape(l.shape,x*2)*r.getHeight()*.45f;
            if(i==0)p.startNewSubPath(r.getX(),y);else p.lineTo(r.getX()+x*r.getWidth(),y);}
    } else if(selected_==7) {
        for(int i=0;i<256;++i) {const float x=float(i)/255.f;const float y=r.getCentreY()-FunctionGenerator::shape(cached_.function.curve,x*2)*r.getHeight()*.45f;
            if(i==0)p.startNewSubPath(r.getX(),y);else p.lineTo(r.getX()+x*r.getWidth(),y);}
    } else {
        std::uint32_t seed=0x6d2b79f5u;float last=0;
        for(int i=0;i<16;++i) {seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;const float next=float((seed>>8)&0x00ffffffu)/16777215.f*2.f-1.f;
            const float x0=r.getX()+r.getWidth()*float(i)/16.f,x1=r.getX()+r.getWidth()*float(i+1)/16.f;
            const float y=r.getCentreY()-last*r.getHeight()*.45f,y2=r.getCentreY()-next*r.getHeight()*.45f;
            if(i==0)p.startNewSubPath(x0,y);p.lineTo(x1,y);p.lineTo(x1,y2);last=next;}
    }
    if(selected_<=6 && !p.isEmpty()) {
        juce::Path fill=p;

        // Close the curve against the bottom edge of the graph. This produces
        // one uniform red region UNDER the actual ENV/LFO line rather than
        // tinting the entire viewport.
        fill.lineTo(r.getRight(),r.getBottom());
        fill.lineTo(r.getX(),r.getBottom());
        fill.closeSubPath();

        g.setColour(signalSurfaceColour(0.30f,0.12f));
        g.fillPath(fill);
    }

    g.setColour(Palette::accent());
    g.strokePath(p,juce::PathStrokeType(1.5f));
}

MacroPanel::MacroPanel(ModulationBindings bindings):Panel("MACROS"),bindings_(std::move(bindings)) {
    for(std::size_t i=0;i<4;++i) {
        rotary(*this,sliders_[i],labels_[i],"MACRO "+juce::String(static_cast<int>(i+1)));
        sliders_[i].setRange(0,1,0);sliders_[i].setTooltip("Assignable source: add destinations on MATRIX");
        sliders_[i].onValueChange=[this,i]{if(bindings_.macro) bindings_.macro(static_cast<unsigned>(i),static_cast<float>(sliders_[i].getValue()));};
    }
    syncFromModel();
}
void MacroPanel::syncFromModel() {
    if(!bindings_.snapshot) return;const auto values=bindings_.snapshot().modulation.macros;
    for(std::size_t i=0;i<4;++i) if(!sliders_[i].isMouseButtonDown()) sliders_[i].setValue(values[i],juce::dontSendNotification);
}
void MacroPanel::resized() {
    const auto body=contentBounds();const int width=body.getWidth()/2,height=body.getHeight()/2;
    for(std::size_t i=0;i<4;++i) place({body.getX()+static_cast<int>(i%2)*width,body.getY()+static_cast<int>(i/2)*height,width,height},sliders_[i],labels_[i]);
}
}
