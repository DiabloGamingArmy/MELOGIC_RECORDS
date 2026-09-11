// mct-origami-v30.0.1-env-toolbar-bottom
// mct-origami-v30.0.0-dynamic-source-layout-scaffold
// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v28.1.2-env-underbeam-tail
// mct-origami-v28.1.1-env-tracer-path-lock
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-v28.0.0-compile-repair
// mct-origami-v28.0.0-interactive-envelope-editor
#include "ModulationPanel.h"
#include <algorithm>
#include <cmath>

namespace mct::origami::ui {
namespace {
constexpr std::array<ParameterId,4> envelopeIds{
    ParameterId::Attack,ParameterId::Decay,ParameterId::Sustain,ParameterId::Release
};

void rotary(juce::Component& parent,juce::Slider& slider,juce::Label& label,
            const juce::String& name) {
    parent.addAndMakeVisible(slider); parent.addAndMakeVisible(label);
    slider.setName(name);
    slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    slider.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    slider.setRotaryParameters(juce::MathConstants<float>::pi*1.2f,
                               juce::MathConstants<float>::pi*2.8f,true);
    slider.setMouseDragSensitivity(220);
    slider.setScrollWheelEnabled(false);
    label.setText(name,juce::dontSendNotification);
    label.setJustificationType(juce::Justification::centred);
    label.setFont(juce::FontOptions(8.0f));
    label.setColour(juce::Label::textColourId,Palette::muted());
}

void place(juce::Rectangle<int> cell,juce::Slider& slider,juce::Label& label) {
    label.setBounds(cell.removeFromBottom(17));
    slider.setBounds(cell.withSizeKeepingCentre(40,38));
}

dsp::EnvelopeSettings readEnvelope(const std::array<juce::Slider,4>& s) {
    return {
        static_cast<float>(s[0].getValue()),
        static_cast<float>(s[1].getValue()),
        static_cast<float>(s[2].getValue()),
        static_cast<float>(s[3].getValue())
    };
}
}

ModulationPanel::ModulationPanel(ParameterSetter setter,ParameterGetter getter,
                                 ModulationBindings bindings)
    :Panel("MODULATION"),setter_(std::move(setter)),getter_(std::move(getter)),
     bindings_(std::move(bindings)) {

    const juce::StringArray names{
        "ENV 1","ENV 2","ENV 3","LFO 1","LFO 2","LFO 3","LFO 4","FUNCTIONS","RANDOM"
    };
    for(int i=0;i<9;++i) {
        auto& tab=tabs_[static_cast<std::size_t>(i)];
        addAndMakeVisible(tab);
        tab.setButtonText(names[i]);
        tab.setClickingTogglesState(true);
        tab.setToggleState(i==0,juce::dontSendNotification);
        tab.onClick=[this,i]{
            selected_=i;
            for(std::size_t j=0;j<tabs_.size();++j)
                tabs_[j].setToggleState(j==static_cast<std::size_t>(i),juce::dontSendNotification);
            scrollSeconds_=0.0;
            syncFromModel();
            resized();
            repaint();
        };
    }

    // V30 architecture scaffold. These controls deliberately do not mutate the
    // modulation model yet; this pass separates collection UX from the current
    // fixed engine storage so dynamic source allocation can land cleanly later.
    for(auto* button:{&sourceAdd_,&sourceRemove_}) {
        addAndMakeVisible(*button);
        button->setTooltip("Dynamic ENV/LFO source allocation — reserved for the next engine pass");
    }

    const juce::StringArray envNames{"ATTACK","DECAY","SUSTAIN","RELEASE"};
    for(std::size_t i=0;i<4;++i) {
        rotary(*this,envSliders_[i],envLabels_[i],envNames[static_cast<int>(i)]);
        const auto& p=*findParameter(envelopeIds[i]);
        envSliders_[i].setRange(p.minimum,p.maximum,0);
        if(i!=2) envSliders_[i].setSkewFactorFromMidPoint(i==3?.35:.15);
        envSliders_[i].onValueChange=[this]{commitEnvelope();updateScrollbar();repaint();};
    }

    addAndMakeVisible(snap_);
    snap_.setClickingTogglesState(true);
    snap_.setToggleState(true,juce::dontSendNotification);

    addAndMakeVisible(gridMode_);
    gridMode_.addItem("BPM",1); gridMode_.addItem("SEC",2);
    gridMode_.setSelectedId(1,juce::dontSendNotification);
    gridMode_.onChange=[this]{
        gridModeValue_=gridMode_.getSelectedId()==2?GridMode::Seconds:GridMode::Tempo;
        updateVisibleControls(); updateScrollbar(); repaint();
    };

    addAndMakeVisible(tempo_);
    tempo_.setSliderStyle(juce::Slider::LinearBar);
    tempo_.setTextBoxStyle(juce::Slider::TextBoxLeft,false,52,18);
    tempo_.setRange(40,240,1);
    tempo_.setValue(120,juce::dontSendNotification);
    tempo_.setName("ENV GRID BPM");
    tempo_.onValueChange=[this]{updateScrollbar();repaint();};

    for(auto* b:{&zoomOut_,&zoomIn_}) addAndMakeVisible(*b);
    zoomOut_.onClick=[this]{zoomBy(.78f);};
    zoomIn_.onClick=[this]{zoomBy(1.28f);};

    addAndMakeVisible(envScroll_);
    envScroll_.setAutoHide(false);
    envScroll_.addListener(this);

    rotary(*this,rate_,rateLabel_,"RATE / Hz");
    rate_.setRange(.01,40,0); rate_.setSkewFactorFromMidPoint(2);
    rate_.setTextBoxStyle(juce::Slider::TextBoxRight,false,50,18);

    rotary(*this,curve_,curveLabel_,"CURVE");
    curve_.setRange(-1,1,.001);
    curve_.setTextBoxStyle(juce::Slider::TextBoxRight,false,50,18);

    shape_.addItem("Sine",1);shape_.addItem("Triangle",2);
    shape_.addItem("Saw",3);shape_.addItem("Square",4);
    mode_.addItem("Free running",1);mode_.addItem("Note retrigger",2);
    for(auto* box:{&shape_,&mode_}) {addAndMakeVisible(*box);box->setScrollWheelEnabled(false);}

    auto update=[this]{commitGenerator();repaint();};
    shape_.onChange=update;mode_.onChange=update;
    rate_.onValueChange=update;curve_.onValueChange=update;

    syncFromModel();
    updateVisibleControls();
    startTimerHz(60);
}

ModulationPanel::~ModulationPanel() {
    stopTimer();
    envScroll_.removeListener(this);
}

dsp::EnvelopeSettings ModulationPanel::currentEnvelope() const {
    auto e=readEnvelope(envSliders_);
    const auto c=currentCurves();
    e.attackCurve=c[0];e.decayCurve=c[1];e.releaseCurve=c[2];
    return e;
}

std::array<float,3> ModulationPanel::currentCurves() const {
    if(selected_==0) return cached_.env1Curves;
    if(selected_==1) return {cached_.env2.attackCurve,cached_.env2.decayCurve,cached_.env2.releaseCurve};
    if(selected_==2) return {cached_.env3.attackCurve,cached_.env3.decayCurve,cached_.env3.releaseCurve};
    return {};
}

void ModulationPanel::setCurrentCurves(const std::array<float,3>& c) {
    if(!bindings_.snapshot || !bindings_.modulation) return;
    auto mod=bindings_.snapshot().modulation;
    if(selected_==0) mod.env1Curves=c;
    else if(selected_==1) {
        mod.env2.attackCurve=c[0];mod.env2.decayCurve=c[1];mod.env2.releaseCurve=c[2];
    } else if(selected_==2) {
        mod.env3.attackCurve=c[0];mod.env3.decayCurve=c[1];mod.env3.releaseCurve=c[2];
    } else return;
    if(bindings_.modulation(mod)) cached_=mod;
}

void ModulationPanel::commitEnvelope() {
    if(selected_==0) {
        if(setter_) for(std::size_t i=0;i<4;++i)
            setter_(envelopeIds[i],static_cast<float>(envSliders_[i].getValue()));
        return;
    }
    if(selected_!=1 && selected_!=2) return;
    if(!bindings_.snapshot || !bindings_.modulation) return;
    auto mod=bindings_.snapshot().modulation;
    auto e=currentEnvelope();
    (selected_==1?mod.env2:mod.env3)=e;
    if(bindings_.modulation(mod)) cached_=mod;
}

void ModulationPanel::commitGenerator() {
    if(!bindings_.snapshot || !bindings_.modulation) return;
    auto mod=bindings_.snapshot().modulation;
    if(selected_>=3 && selected_<=6) {
        auto& l=lfoSettings(mod,static_cast<std::size_t>(selected_-3));
        l.shape=static_cast<LfoShape>(shape_.getSelectedId());
        l.mode=static_cast<LfoMode>(mode_.getSelectedId());
        l.rateHz=static_cast<float>(rate_.getValue());
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
    snap_.setVisible(env);gridMode_.setVisible(env);
    zoomOut_.setVisible(env);zoomIn_.setVisible(env);
    tempo_.setVisible(env && gridModeValue_==GridMode::Tempo);
    envScroll_.setVisible(env);

    rate_.setVisible(lfo||function||random);rateLabel_.setVisible(lfo||function||random);
    shape_.setVisible(lfo);mode_.setVisible(lfo);
    curve_.setVisible(function);curveLabel_.setVisible(function);
}

void ModulationPanel::syncFromModel() {
    if(bindings_.snapshot) cached_=bindings_.snapshot().modulation;
    if(selected_==0) {
        if(getter_) for(std::size_t i=0;i<4;++i)
            if(!envSliders_[i].isMouseButtonDown())
                envSliders_[i].setValue(getter_(envelopeIds[i]),juce::dontSendNotification);
    } else if(selected_==1 || selected_==2) {
        const auto& e=selected_==1?cached_.env2:cached_.env3;
        const std::array<float,4> v{e.attack,e.decay,e.sustain,e.release};
        for(std::size_t i=0;i<4;++i)
            if(!envSliders_[i].isMouseButtonDown())
                envSliders_[i].setValue(v[i],juce::dontSendNotification);
    } else if(selected_>=3 && selected_<=6) {
        const auto& l=lfoSettings(cached_,static_cast<std::size_t>(selected_-3));
        shape_.setSelectedId(static_cast<int>(l.shape),juce::dontSendNotification);
        mode_.setSelectedId(static_cast<int>(l.mode),juce::dontSendNotification);
        if(!rate_.isMouseButtonDown()) rate_.setValue(l.rateHz,juce::dontSendNotification);
    } else if(selected_==7) {
        if(!rate_.isMouseButtonDown()) rate_.setValue(cached_.function.rateHz,juce::dontSendNotification);
        if(!curve_.isMouseButtonDown()) curve_.setValue(cached_.function.curve,juce::dontSendNotification);
    } else if(selected_==8) {
        if(!rate_.isMouseButtonDown()) rate_.setValue(cached_.random.rateHz,juce::dontSendNotification);
    }
    updateVisibleControls();updateScrollbar();repaint();
}

double ModulationPanel::gridStepSeconds() const noexcept {
    if(gridModeValue_==GridMode::Seconds) return .25;
    return 60.0/std::max(1.0,tempo_.getValue())/4.0;
}

double ModulationPanel::visualHoldSeconds() const noexcept {
    return visualHoldSeconds_[static_cast<std::size_t>(juce::jlimit(0,2,selected_))];
}

double ModulationPanel::totalEnvelopeSeconds(const dsp::EnvelopeSettings& e) const noexcept {
    return double(e.attack)+double(e.decay)+visualHoldSeconds()+double(e.release);
}

float ModulationPanel::timeToX(double t) const noexcept {
    return envCanvas_.getX()+static_cast<float>((t-scrollSeconds_)*pixelsPerSecond_);
}
double ModulationPanel::xToTime(float x) const noexcept {
    return scrollSeconds_+double(x-envCanvas_.getX())/pixelsPerSecond_;
}
double ModulationPanel::snapped(double t) const noexcept {
    t=std::max(0.0,t);
    if(!snap_.getToggleState()) return t;
    const double step=gridStepSeconds();
    return std::round(t/step)*step;
}

float ModulationPanel::curveShape(float t,float c) const noexcept {
    t=juce::jlimit(0.0f,1.0f,t);c=juce::jlimit(-1.0f,1.0f,c);
    if(std::abs(c)<1.0e-6f) return t;
    if(c>0) return std::pow(t,1.0f+c*4.0f);
    return 1.0f-std::pow(1.0f-t,1.0f+(-c)*4.0f);
}

std::array<juce::Point<float>,4>
ModulationPanel::envelopeNodes(const dsp::EnvelopeSettings& e) const {
    const double t1=e.attack;
    const double t2=t1+e.decay;
    const double t3=t2+visualHoldSeconds();
    const double t4=t3+e.release;
    auto y=[this](float v){return envCanvas_.getBottom()-v*envCanvas_.getHeight();};
    return {{{timeToX(t1),y(1)},{timeToX(t2),y(e.sustain)},
             {timeToX(t3),y(e.sustain)},{timeToX(t4),y(0)}}};
}

std::array<juce::Point<float>,3>
ModulationPanel::curveNodes(const dsp::EnvelopeSettings& e,
                            const std::array<float,3>& c) const {
    const auto n=envelopeNodes(e);
    const juce::Point<float> start{timeToX(0),envCanvas_.getBottom()};
    auto mid=[this](juce::Point<float> a,juce::Point<float> b,float curve){
        const float s=curveShape(.5f,curve);
        return juce::Point<float>{(a.x+b.x)*.5f,a.y+(b.y-a.y)*s};
    };
    return {{mid(start,n[0],c[0]),mid(n[0],n[1],c[1]),mid(n[2],n[3],c[2])}};
}

juce::Path ModulationPanel::envelopePath(const dsp::EnvelopeSettings& e,
                                         const std::array<float,3>& c) const {
    const auto n=envelopeNodes(e);
    const juce::Point<float> start{timeToX(0),envCanvas_.getBottom()};
    juce::Path p;p.startNewSubPath(start);
    auto seg=[this,&p](juce::Point<float> a,juce::Point<float> b,float curve){
        for(int i=1;i<=40;++i) {
            const float t=float(i)/40.0f,s=curveShape(t,curve);
            p.lineTo(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*s);
        }
    };
    seg(start,n[0],c[0]);seg(n[0],n[1],c[1]);p.lineTo(n[2]);seg(n[2],n[3],c[2]);
    return p;
}

ModulationPanel::DragTarget ModulationPanel::hitHandle(juce::Point<float> p) const noexcept {
    const auto e=currentEnvelope();
    const auto c=currentCurves();
    const auto n=envelopeNodes(e); const auto m=curveNodes(e,c);
    if(p.getDistanceFrom(n[0])<10) return DragTarget::Attack;
    if(p.getDistanceFrom(n[1])<10) return DragTarget::Decay;
    if(p.getDistanceFrom(n[2])<10) return DragTarget::Sustain;
    const juce::Point<float> holdMid{(n[1].x+n[2].x)*0.5f,n[1].y};
    if(p.getDistanceFrom(holdMid)<8) return DragTarget::SustainHold;
    if(p.getDistanceFrom(n[3])<10) return DragTarget::Release;
    if(p.getDistanceFrom(m[0])<8) return DragTarget::AttackCurve;
    if(p.getDistanceFrom(m[1])<8) return DragTarget::DecayCurve;
    if(p.getDistanceFrom(m[2])<8) return DragTarget::ReleaseCurve;
    return DragTarget::None;
}

void ModulationPanel::mouseDown(const juce::MouseEvent& e) {
    if(selected_>2 || !envCanvas_.contains(e.position)) return;
    dragTarget_=hitHandle(e.position);
    dragStart_=e.position;dragEnvelope_=currentEnvelope();dragCurves_=currentCurves();
}

void ModulationPanel::mouseDrag(const juce::MouseEvent& e) {
    if(dragTarget_==DragTarget::None || selected_>2) return;
    auto env=dragEnvelope_;auto curves=dragCurves_;
    const double t=snapped(xToTime(e.position.x));
    const float level=juce::jlimit(0.0f,1.0f,
        1.0f-(e.position.y-envCanvas_.getY())/std::max(1.0f,envCanvas_.getHeight()));

    switch(dragTarget_) {
        case DragTarget::Attack:
            env.attack=static_cast<float>(juce::jlimit(.001,10.0,t));break;
        case DragTarget::Decay:
            env.decay=static_cast<float>(juce::jlimit(.001,10.0,t-env.attack));
            env.sustain=level;break;
        case DragTarget::Sustain: {
            env.sustain=level;
            const double start=double(env.attack)+double(env.decay);
            visualHoldSeconds_[static_cast<std::size_t>(selected_)]=
                juce::jlimit(gridStepSeconds(),30.0,snapped(t)-start);
            break;
        }
        case DragTarget::SustainHold: {
            const double start=double(env.attack)+double(env.decay);
            visualHoldSeconds_[static_cast<std::size_t>(selected_)]=
                juce::jlimit(gridStepSeconds(),30.0,snapped(t)-start);
            updateScrollbar();repaint();return;
        }
        case DragTarget::Release:
            env.release=static_cast<float>(juce::jlimit(.001,20.0,
                t-double(env.attack)-double(env.decay)-visualHoldSeconds()));break;
        case DragTarget::AttackCurve:
        case DragTarget::DecayCurve:
        case DragTarget::ReleaseCurve: {
            const int idx=dragTarget_==DragTarget::AttackCurve?0:
                          dragTarget_==DragTarget::DecayCurve?1:2;
            const float dy=(e.position.y-dragStart_.y)/80.0f;
            const float delta=(idx==0)?dy:-dy;
            curves[static_cast<std::size_t>(idx)]=juce::jlimit(-1.0f,1.0f,
                dragCurves_[static_cast<std::size_t>(idx)]+delta);
            setCurrentCurves(curves);repaint();return;
        }
        case DragTarget::None:return;
    }

    envSliders_[0].setValue(env.attack,juce::sendNotificationSync);
    envSliders_[1].setValue(env.decay,juce::sendNotificationSync);
    envSliders_[2].setValue(env.sustain,juce::sendNotificationSync);
    envSliders_[3].setValue(env.release,juce::sendNotificationSync);
    updateScrollbar();repaint();
}

void ModulationPanel::mouseUp(const juce::MouseEvent&) {dragTarget_=DragTarget::None;}

void ModulationPanel::mouseWheelMove(const juce::MouseEvent& e,
                                     const juce::MouseWheelDetails& w) {
    if(selected_<=2 && envCanvas_.contains(e.position)) {
        if(e.mods.isCommandDown() || e.mods.isCtrlDown()) {
            zoomBy(w.deltaY>0?1.12f:.89f,e.position);
        } else {
            const double visible=envCanvas_.getWidth()/pixelsPerSecond_;
            const double delta=std::abs(w.deltaX)>1.0e-6f ? -w.deltaX : -w.deltaY;
            scrollSeconds_=std::max(0.0,scrollSeconds_+delta*visible*.18);
            updateScrollbar();repaint();
        }
        return;
    }
    Panel::mouseWheelMove(e,w);
}

void ModulationPanel::scrollBarMoved(juce::ScrollBar*,double start) {
    scrollSeconds_=start;repaint();
}

juce::Point<float> ModulationPanel::tracerPoint(const EnvelopeRuntimeInfo& r,
                                                 const dsp::EnvelopeSettings& e) const noexcept {
    // The tracer is a visual cursor for the EDITOR PATH. Derive both axes from
    // the same segment equations used by envelopePath(), rather than mixing
    // editor X with the runtime amplitude Y. This guarantees that the head and
    // every tail sample remain exactly on the displayed ENV line.
    //
    // This distinction matters on an early note-off: the DSP release begins
    // from the instantaneous amplitude, while the canonical ADSR editor draws
    // Release from Sustain. Projecting the cursor onto the canonical editor
    // path prevents the visual from floating above/below the line.
    const float p=juce::jlimit(0.0f,1.0f,r.progress);
    double t=0.0;
    float value=0.0f;

    switch(r.stage){
        case dsp::Envelope::Stage::Attack: {
            t=double(e.attack)*p;
            value=curveShape(p,e.attackCurve);
            break;
        }
        case dsp::Envelope::Stage::Decay: {
            t=double(e.attack)+double(e.decay)*p;
            const float shaped=curveShape(p,e.decayCurve);
            value=1.0f+(e.sustain-1.0f)*shaped;
            break;
        }
        case dsp::Envelope::Stage::Sustain:
            t=double(e.attack)+double(e.decay);
            value=e.sustain;
            break;
        case dsp::Envelope::Stage::Release: {
            t=double(e.attack)+double(e.decay)+visualHoldSeconds()+double(e.release)*p;
            const float shaped=curveShape(p,e.releaseCurve);
            value=e.sustain*(1.0f-shaped);
            break;
        }
        case dsp::Envelope::Stage::Idle:
            break;
    }

    const float y=envCanvas_.getBottom()
        -juce::jlimit(0.0f,1.0f,value)*envCanvas_.getHeight();
    return {timeToX(t),y};
}

void ModulationPanel::timerCallback() {
    constexpr float dt=1.0f/60.0f;
    for(auto& s:traceTail_) s.age+=dt;
    while(!traceTail_.empty() && traceTail_.front().age>0.34f) traceTail_.pop_front();

    if(selected_<=2 && bindings_.envelopeTrace && !envCanvas_.isEmpty()){
        trace_=bindings_.envelopeTrace();
        if(trace_.active){
            const auto& r=trace_.envelopes[static_cast<std::size_t>(selected_)];
            if(r.stage!=dsp::Envelope::Stage::Idle){
                if(trace_.order!=lastTraceOrder_){traceTail_.clear();lastTraceOrder_=trace_.order;}
                traceTail_.push_back({tracerPoint(r,currentEnvelope()),0.0f});
                while(traceTail_.size()>28) traceTail_.pop_front();
            }
        }
    }
    if(selected_<=2) repaint();
}

void ModulationPanel::zoomBy(float factor,juce::Point<float> anchor) {
    if(selected_>2) return;
    if(anchor==juce::Point<float>{}) anchor=envCanvas_.getCentre();
    const double anchorTime=xToTime(anchor.x);
    pixelsPerSecond_=juce::jlimit(55.0f,900.0f,pixelsPerSecond_*factor);
    scrollSeconds_=std::max(0.0,anchorTime-(anchor.x-envCanvas_.getX())/pixelsPerSecond_);
    updateScrollbar();repaint();
}

void ModulationPanel::updateScrollbar() {
    if(selected_>2 || envCanvas_.getWidth()<2) return;
    const auto e=currentEnvelope();
    const double visible=envCanvas_.getWidth()/pixelsPerSecond_;
    const double total=std::max(totalEnvelopeSeconds(e)+visible*.2,visible);
    const double maxStart=std::max(0.0,total-visible);
    scrollSeconds_=juce::jlimit(0.0,maxStart,scrollSeconds_);
    envScroll_.setRangeLimits(0,total);
    envScroll_.setCurrentRange(scrollSeconds_,visible,juce::dontSendNotification);
    envScroll_.setSingleStepSize(gridStepSeconds());
}

void ModulationPanel::resized() {
    auto body=contentBounds();

    // Mixed modulation-source collection. ENV + LFO + generator sources share
    // one vertical rail so the editor area always represents ONE selected source.
    constexpr int railWidth=92;
    sourceRail_=body.removeFromLeft(railWidth);
    body.removeFromLeft(6);

    auto rail=sourceRail_.reduced(4,5);
    auto collectionControls=rail.removeFromBottom(24);
    sourceRemove_.setBounds(collectionControls.removeFromLeft(
        (collectionControls.getWidth()-3)/2));
    collectionControls.removeFromLeft(3);
    sourceAdd_.setBounds(collectionControls);

    rail.removeFromBottom(5);
    const int rowHeight=juce::jmax(20,juce::jmin(25,rail.getHeight()/9));
    for(auto& tab:tabs_) {
        tab.setBounds(rail.removeFromTop(rowHeight).reduced(0,1));
    }

    auto controls=body.removeFromBottom(62);
    if(selected_<=2) {
        // V30.0.1: ENV utility controls belong with the parameter controls, not
        // inside the graph viewport. Keep ATTACK/DECAY/SUSTAIN/RELEASE on the
        // left of the bottom strip and dock SNAP / grid / tempo / zoom to their
        // right. This gives the envelope graph its full vertical canvas.
        constexpr int gap=4;
        const bool tempoVisible=gridModeValue_==GridMode::Tempo;
        const int toolbarWidth=
            58 + gap + 70 + gap +
            (tempoVisible ? 86 + gap : 0) +
            28 + 2 + 28;

        auto toolbar=controls.removeFromRight(
            juce::jmin(toolbarWidth+8,juce::jmax(0,controls.getWidth()/2)));
        controls.removeFromRight(6);
        toolbar=toolbar.reduced(4,8);

        const int cell=controls.getWidth()/4;
        for(std::size_t i=0;i<4;++i)
            place(controls.removeFromLeft(cell),envSliders_[i],envLabels_[i]);

        snap_.setBounds(toolbar.removeFromLeft(58));toolbar.removeFromLeft(gap);
        gridMode_.setBounds(toolbar.removeFromLeft(70));toolbar.removeFromLeft(gap);
        if(tempoVisible) {
            tempo_.setBounds(toolbar.removeFromLeft(86));toolbar.removeFromLeft(gap);
        } else {
            tempo_.setBounds({});
        }
        zoomOut_.setBounds(toolbar.removeFromLeft(28));toolbar.removeFromLeft(2);
        zoomIn_.setBounds(toolbar.removeFromLeft(28));

        // Only the caption remains above the graph. Horizontal scrolling stays
        // immediately below the graph, preserving the existing zoom/scroll math.
        body.removeFromTop(17);
        envScroll_.setBounds(body.removeFromBottom(12).reduced(2,0));
        envCanvas_=body.reduced(10,6).toFloat();
        updateScrollbar();
    } else {
        envCanvas_={};
        auto left=controls.removeFromLeft(120);
        rateLabel_.setBounds(left.removeFromBottom(17));rate_.setBounds(left);
        if(selected_>=3 && selected_<=6) {
            shape_.setBounds(controls.removeFromTop(24).reduced(5,1));
            mode_.setBounds(controls.removeFromTop(24).reduced(5,1));
        } else if(selected_==7) {
            auto cell=controls.removeFromLeft(120);
            curveLabel_.setBounds(cell.removeFromBottom(17));curve_.setBounds(cell);
        }
    }
    updateVisibleControls();
}

void ModulationPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    constexpr int railWidth=92;
    auto rail=body.removeFromLeft(railWidth);
    body.removeFromLeft(6);

    // The rail is intentionally structural rather than another tab bar. It is
    // the future dynamic ENV/LFO collection surface.
    well(g,rail);
    text(g,"SOURCES",rail.removeFromTop(18).reduced(5,0),8.0f,Palette::muted());

    body.removeFromBottom(66);auto caption=body.removeFromTop(17);
    juce::String title;
    if(selected_<=2) title="ENV "+juce::String(selected_+1)+(selected_==0?" / AMP + SOURCE":" / MOD SOURCE");
    else if(selected_>=3 && selected_<=6)
        title="LFO "+juce::String(selected_-2)+" / "+
            (lfoSettings(cached_,static_cast<std::size_t>(selected_-3)).mode==LfoMode::Free?"FREE":"PER NOTE");
    else if(selected_==7) title="FUNCTION / CURVED BIPOLAR";
    else title="RANDOM / SAMPLE + HOLD";
    text(g,title,caption,9,Palette::muted());well(g,body);

    if(selected_<=2) {
        if(envCanvas_.isEmpty()) return;
        g.saveState();g.reduceClipRegion(envCanvas_.getSmallestIntegerContainer());

        const double step=gridStepSeconds();
        const double end=scrollSeconds_+envCanvas_.getWidth()/pixelsPerSecond_;
        long long i=static_cast<long long>(std::floor(scrollSeconds_/step));
        for(;i*step<=end+step;++i) {
            const double t=i*step;if(t<0) continue;
            const float x=timeToX(t);const bool major=(i%4)==0;
            g.setColour(Palette::borderSoft().withAlpha(major?.55f:.24f));
            g.drawVerticalLine(juce::roundToInt(x),envCanvas_.getY(),envCanvas_.getBottom());
        }

        const auto env=currentEnvelope();const auto curves=currentCurves();
        auto p=envelopePath(env,curves);const auto nodes=envelopeNodes(env);
        juce::Path fill=p;fill.lineTo(nodes[3].x,envCanvas_.getBottom());
        fill.lineTo(timeToX(0),envCanvas_.getBottom());fill.closeSubPath();
        g.setColour(signalSurfaceColour(.46f,.22f));g.fillPath(fill);
        g.setColour(Palette::accent());g.strokePath(p,juce::PathStrokeType(1.5f));

        for(const auto& pt:nodes) {
            auto c=juce::Rectangle<float>(10,10).withCentre(pt);
            g.setColour(Palette::background());g.fillEllipse(c);
            g.setColour(signalSourceColour());g.drawEllipse(c,1.4f);
        }
        const juce::Point<float> holdMid{(nodes[1].x+nodes[2].x)*0.5f,nodes[1].y};
        {
            auto c=juce::Rectangle<float>(7,7).withCentre(holdMid);
            g.setColour(Palette::background());g.fillEllipse(c);
            g.setColour(signalSourceColour().withAlpha(.72f));g.drawEllipse(c,1.1f);
        }
        for(const auto& pt:curveNodes(env,curves)) {
            auto c=juce::Rectangle<float>(7,7).withCentre(pt);
            g.setColour(Palette::background());g.fillEllipse(c);
            g.setColour(Palette::secondary());g.drawEllipse(c,1.1f);
        }

        if(trace_.active){
            const auto& r=trace_.envelopes[static_cast<std::size_t>(selected_)];
            if(r.stage!=dsp::Envelope::Stage::Idle){
                const auto head=tracerPoint(r,env);
                if(envCanvas_.contains(head)){
                    // Primary timing beam remains a restrained full-height red line.
                    g.setColour(signalSourceColour().withAlpha(.11f));
                    g.drawVerticalLine(juce::roundToInt(head.x),
                                       envCanvas_.getY(),envCanvas_.getBottom());

                    // Secondary "under-beam" tracer: every historical tracer
                    // position also owns a vertical segment from the ENV curve
                    // down to the bottom of the viewport. Older segments fade
                    // and thin out, creating a volumetric tail UNDER the ENV.
                    //
                    // This derives from the same global source red, but at a
                    // deliberately deeper exposure than the main signal colour.
                    if(!traceTail_.empty()){
                        for(std::size_t tailIndex=0;tailIndex<traceTail_.size();++tailIndex){
                            const auto& a=traceTail_[tailIndex];
                            const auto& b=(tailIndex+1<traceTail_.size())
                                ? traceTail_[tailIndex+1] : traceTail_[tailIndex];
                            const float dx=std::abs(b.point.x-a.point.x);
                            const int columns=juce::jlimit(1,32,static_cast<int>(std::ceil(dx/1.6f)));
                            for(int column=0;column<=columns;++column){
                                const float t=static_cast<float>(column)/static_cast<float>(columns);
                                const float age=a.age+(b.age-a.age)*t;
                                const float freshness=juce::jlimit(0.0f,1.0f,1.0f-age/.34f);
                                if(freshness<=0.0f) continue;
                                const float x=a.point.x+(b.point.x-a.point.x)*t;
                                const float rawY=a.point.y+(b.point.y-a.point.y)*t;
                                const float y=juce::jlimit(envCanvas_.getY(),envCanvas_.getBottom(),rawY);
                                g.setColour(signalShade(.34f,.025f+.10f*freshness));
                                g.drawLine(x,y,x,envCanvas_.getBottom(),2.4f+4.6f*freshness);
                                g.setColour(signalShade(.46f,.07f+.30f*freshness));
                                g.drawLine(x,y,x,envCanvas_.getBottom(),1.0f+2.15f*freshness);
                            }
                        }

                        // Give the current underside column a slightly stronger
                        // head so the vertical tail feels physically attached
                        // to the moving white tracer point.
                        g.setColour(signalShade(.34f,.16f));
                        g.drawLine(head.x,head.y,head.x,envCanvas_.getBottom(),7.0f);
                        g.setColour(signalShade(.50f,.48f));
                        g.drawLine(head.x,head.y,head.x,envCanvas_.getBottom(),2.3f);
                    }

                    if(traceTail_.size()>1){
                        for(std::size_t tailIndex=1;tailIndex<traceTail_.size();++tailIndex){
                            const auto& a=traceTail_[tailIndex-1];
                            const auto& b=traceTail_[tailIndex];
                            const float f=juce::jlimit(0.0f,1.0f,1.0f-b.age/.34f);
                            if(f<=0.0f) continue;

                            // White tracer trail stays above the red under-beam
                            // layer, preserving a clear bright playback cursor.
                            g.setColour(juce::Colours::white.withAlpha(.055f+.16f*f));
                            g.drawLine(a.point.x,a.point.y,b.point.x,b.point.y,3.0f+5.0f*f);

                            g.setColour(juce::Colours::white.withAlpha(.20f+.68f*f));
                            g.drawLine(a.point.x,a.point.y,b.point.x,b.point.y,1.35f+3.0f*f);
                        }
                    }

                    // White fuzzy tracer head. Multiple concentric passes keep
                    // the center crisp while producing a visible bloom without
                    // introducing another colour into the signal palette.
                    g.setColour(juce::Colours::white.withAlpha(.035f));
                    g.fillEllipse(juce::Rectangle<float>(34,34).withCentre(head));
                    g.setColour(juce::Colours::white.withAlpha(.075f));
                    g.fillEllipse(juce::Rectangle<float>(23,23).withCentre(head));
                    g.setColour(juce::Colours::white.withAlpha(.16f));
                    g.fillEllipse(juce::Rectangle<float>(14,14).withCentre(head));
                    g.setColour(juce::Colours::white.withAlpha(.42f));
                    g.fillEllipse(juce::Rectangle<float>(8.5f,8.5f).withCentre(head));
                    g.setColour(juce::Colours::white);
                    g.fillEllipse(juce::Rectangle<float>(5.5f,5.5f).withCentre(head));
                }
            }
        }

        g.restoreState();return;
    }

    auto r=body.reduced(10).toFloat();juce::Path p;
    if(selected_>=3 && selected_<=6) {
        const auto& l=lfoSettings(cached_,static_cast<std::size_t>(selected_-3));
        for(int i=0;i<256;++i) {
            const float x=float(i)/255.f,y=r.getCentreY()-Lfo::shape(l.shape,x*2)*r.getHeight()*.45f;
            if(i==0)p.startNewSubPath(r.getX(),y);else p.lineTo(r.getX()+x*r.getWidth(),y);
        }
    } else if(selected_==7) {
        for(int i=0;i<256;++i) {
            const float x=float(i)/255.f,y=r.getCentreY()-FunctionGenerator::shape(cached_.function.curve,x*2)*r.getHeight()*.45f;
            if(i==0)p.startNewSubPath(r.getX(),y);else p.lineTo(r.getX()+x*r.getWidth(),y);
        }
    } else {
        std::uint32_t seed=0x6d2b79f5u;float last=0;
        for(int i=0;i<16;++i) {
            seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;
            const float next=float((seed>>8)&0x00ffffffu)/16777215.f*2.f-1.f;
            const float x0=r.getX()+r.getWidth()*float(i)/16.f,x1=r.getX()+r.getWidth()*float(i+1)/16.f;
            const float y=r.getCentreY()-last*r.getHeight()*.45f,y2=r.getCentreY()-next*r.getHeight()*.45f;
            if(i==0)p.startNewSubPath(x0,y);p.lineTo(x1,y);p.lineTo(x1,y2);last=next;
        }
    }
    if(selected_<=6 && !p.isEmpty()) {
        juce::Path fill=p;fill.lineTo(r.getRight(),r.getBottom());fill.lineTo(r.getX(),r.getBottom());fill.closeSubPath();
        g.setColour(signalSurfaceColour(.46f,.22f));g.fillPath(fill);
    }
    g.setColour(Palette::accent());g.strokePath(p,juce::PathStrokeType(1.5f));
}

MacroPanel::MacroPanel(ModulationBindings bindings):Panel("MACROS"),bindings_(std::move(bindings)) {
    for(std::size_t i=0;i<4;++i) {
        rotary(*this,sliders_[i],labels_[i],"MACRO "+juce::String(static_cast<int>(i+1)));
        sliders_[i].setRange(0,1,0);
        sliders_[i].onValueChange=[this,i]{
            if(bindings_.macro) bindings_.macro(static_cast<unsigned>(i),static_cast<float>(sliders_[i].getValue()));
        };
    }
    syncFromModel();
}
void MacroPanel::syncFromModel() {
    if(!bindings_.snapshot) return;const auto values=bindings_.snapshot().modulation.macros;
    for(std::size_t i=0;i<4;++i) if(!sliders_[i].isMouseButtonDown())
        sliders_[i].setValue(values[i],juce::dontSendNotification);
}
void MacroPanel::resized() {
    const auto body=contentBounds();const int width=body.getWidth()/2,height=body.getHeight()/2;
    for(std::size_t i=0;i<4;++i)
        place({body.getX()+static_cast<int>(i%2)*width,body.getY()+static_cast<int>(i/2)*height,width,height},
              sliders_[i],labels_[i]);
}
}
