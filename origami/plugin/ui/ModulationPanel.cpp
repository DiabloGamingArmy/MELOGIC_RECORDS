#include "ModulationPanel.h"
namespace mct::origami::ui {
namespace {
constexpr std::array<ParameterId,4> envelopeIds{ParameterId::Attack,ParameterId::Decay,ParameterId::Sustain,ParameterId::Release};
void rotary(juce::Component& parent,juce::Slider& slider,juce::Label& label,const juce::String& name) {
    parent.addAndMakeVisible(slider);parent.addAndMakeVisible(label);slider.setName(name);
    slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    slider.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    slider.setRotaryParameters(juce::MathConstants<float>::pi*1.2f,juce::MathConstants<float>::pi*2.8f,true);
    slider.setMouseDragSensitivity(220);label.setText(name,juce::dontSendNotification);
    label.setJustificationType(juce::Justification::centred);label.setFont(juce::FontOptions(8.0f));
    label.setColour(juce::Label::textColourId,Palette::muted());
}
void place(juce::Rectangle<int> cell,juce::Slider& slider,juce::Label& label) {
    label.setBounds(cell.removeFromBottom(17));slider.setBounds(cell.withSizeKeepingCentre(40,38));
}
}
ModulationPanel::ModulationPanel(ParameterSetter setter,ParameterGetter getter,ModulationBindings bindings)
    :Panel("MODULATION"),setter_(std::move(setter)),getter_(std::move(getter)),bindings_(std::move(bindings)) {
    const juce::StringArray names{"ENV 1","ENV 2","ENV 3","LFO 1","LFO 2","LFO 3","LFO 4","FUNCTIONS","RANDOM"};
    for(int i=0;i<9;++i) {
        auto& tab=tabs_[static_cast<std::size_t>(i)];addAndMakeVisible(tab);tab.setButtonText(names[i]);
        tab.setEnabled(i==0 || i==3);tab.setToggleState(i==0,juce::dontSendNotification);
        tab.setTooltip(i==0?"Per-voice amplitude envelope and modulation source":i==3?"LFO 1 settings shown at right":"Not implemented");
        tab.onClick=[this,i]{for(std::size_t j=0;j<tabs_.size();++j) tabs_[j].setToggleState(j==static_cast<std::size_t>(i),juce::dontSendNotification);repaint();};
    }
    const juce::StringArray namesEnv{"ATTACK","DECAY","SUSTAIN","RELEASE"};
    for(std::size_t i=0;i<4;++i) {
        rotary(*this,envSliders_[i],envLabels_[i],namesEnv[static_cast<int>(i)]);
        const auto& p=*findParameter(envelopeIds[i]);envSliders_[i].setRange(p.minimum,p.maximum,0);
        if(i!=2) envSliders_[i].setSkewFactorFromMidPoint(i==3?.35:.15);
        envSliders_[i].onValueChange=[this,i]{if(setter_) setter_(envelopeIds[i],static_cast<float>(envSliders_[i].getValue()));repaint();};
    }
    rotary(*this,rate_,rateLabel_,"RATE / Hz");rate_.setRange(.01,40,0);rate_.setSkewFactorFromMidPoint(2);
    rate_.setTextBoxStyle(juce::Slider::TextBoxRight,false,50,18);
    shape_.setName("LFO 1 waveform");mode_.setName("LFO 1 mode");
    shape_.addItem("Sine",1);shape_.addItem("Triangle",2);shape_.addItem("Saw",3);shape_.addItem("Square",4);
    mode_.addItem("Free running",1);mode_.addItem("Note retrigger",2);
    for(auto* box:{&shape_,&mode_}) {addAndMakeVisible(box);box->setScrollWheelEnabled(false);}
    auto update=[this] {
        if(!bindings_.lfo) return;
        LfoSettings settings{static_cast<LfoShape>(shape_.getSelectedId()),static_cast<LfoMode>(mode_.getSelectedId()),static_cast<float>(rate_.getValue())};
        bindings_.lfo(settings);lfo_=settings;repaint();
    };
    shape_.onChange=update;mode_.onChange=update;rate_.onValueChange=update;
    syncFromModel();
}
void ModulationPanel::syncFromModel() {
    if(getter_) for(std::size_t i=0;i<4;++i) if(!envSliders_[i].isMouseButtonDown())
        envSliders_[i].setValue(getter_(envelopeIds[i]),juce::dontSendNotification);
    if(bindings_.snapshot) lfo_=bindings_.snapshot().modulation.lfo1;
    shape_.setSelectedId(static_cast<int>(lfo_.shape),juce::dontSendNotification);
    mode_.setSelectedId(static_cast<int>(lfo_.mode),juce::dontSendNotification);
    if(!rate_.isMouseButtonDown() && !rate_.hasKeyboardFocus(true)) rate_.setValue(lfo_.rateHz,juce::dontSendNotification);
    repaint();
}
void ModulationPanel::resized() {
    auto bar=getLocalBounds().withTrimmedLeft(120).withTrimmedRight(10).removeFromTop(29).reduced(0,4);
    const int width=bar.getWidth()/9;for(auto& tab:tabs_) tab.setBounds(bar.removeFromLeft(width).reduced(1,0));
    auto body=contentBounds();auto env=body.removeFromLeft((body.getWidth()-8)/2);body.removeFromLeft(8);
    auto controls=env.removeFromBottom(58);const int cell=controls.getWidth()/4;
    for(std::size_t i=0;i<4;++i) place(controls.removeFromLeft(cell),envSliders_[i],envLabels_[i]);
    auto lfoControls=body.removeFromBottom(58);auto rate=lfoControls.removeFromLeft(115);
    rateLabel_.setBounds(rate.removeFromBottom(17));rate_.setBounds(rate);
    shape_.setBounds(lfoControls.removeFromTop(24).reduced(5,1));mode_.setBounds(lfoControls.removeFromTop(24).reduced(5,1));
}
void ModulationPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    auto env=body.removeFromLeft((body.getWidth()-8)/2);body.removeFromLeft(8);auto lfo=body;
    for(auto* area:{&env,&lfo}) {area->removeFromBottom(64);auto caption=area->removeFromTop(17);
        text(g,area==&env?"ENV 1 / PER VOICE":"LFO 1 / CONFIGURED SHAPE",caption,9,Palette::muted());well(g,*area);}
    auto er=env.reduced(10).toFloat();
    const double attack=envSliders_[0].getValue(),decay=envSliders_[1].getValue(),sustain=envSliders_[2].getValue(),release=envSliders_[3].getValue();
    const double hold=.25,total=attack+decay+hold+release;
    juce::Path ep;ep.startNewSubPath(er.getX(),er.getBottom());
    auto point=[&](double t,double v){ep.lineTo(er.getX()+static_cast<float>(t/total)*er.getWidth(),er.getBottom()-static_cast<float>(v)*er.getHeight());};
    point(attack,1);point(attack+decay,sustain);point(attack+decay+hold,sustain);point(total,0);
    g.setColour(Palette::accent());g.strokePath(ep,juce::PathStrokeType(1.5f));
    auto lr=lfo.reduced(10).toFloat();juce::Path lp;
    for(int i=0;i<256;++i) {const float x=static_cast<float>(i)/255;
        const float y=lr.getCentreY()-Lfo::shape(lfo_.shape,x*2)*lr.getHeight()*.45f;
        if(i==0) lp.startNewSubPath(lr.getX(),y);else lp.lineTo(lr.getX()+x*lr.getWidth(),y);}
    g.strokePath(lp,juce::PathStrokeType(1.5f));
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
