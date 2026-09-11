// mct-origami-v32.2.1-scroll-drag-matrix-hotfix
// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.2.1-mod-ring-retrigger-refine
// mct-origami-v31.2.0-mod-visuals-wavetable-spectral
// mct-origami-v31.1.0-mod-source-visual-matrix-controls
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v30.0.1-env-toolbar-bottom
// mct-origami-v30.0.0-dynamic-source-layout-scaffold
// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v28.1.2-env-underbeam-tail
// mct-origami-v28.1.1-env-tracer-path-lock
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-v28.0.0-compile-repair
// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-v33.1.0-lfo-mseg-editing-tools
// mct-origami-v33.0.2-lfo-mseg-editor-foundation
// mct-origami-v34.0.3-mod-route-gauges
// mct-origami-v34.0.1-random-controls-layout
// mct-origami-v34.0.0-random-lfo
// mct-origami-v34.1.0-mod-scroll-clip-mseg-audio
// mct-origami-v34.2.1-performance-reinforcement
// mct-origami-v34.3.0-lfo-interaction-mod-properties
#include "ModulationPanel.h"
#include "ModulationUiTelemetry.h"
#include "NativeChoiceMenu.h"
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

    addAndMakeVisible(sourceViewport_);
    sourceViewport_.setViewedComponent(&sourceContent_,false);
    sourceViewport_.setScrollBarsShown(true,false);
    sourceViewport_.setScrollBarThickness(6);
    sourceViewport_.setWantsKeyboardFocus(false);

    const juce::StringArray names{
        "ENV 1","ENV 2","ENV 3",
        "LFO 1","LFO 2","LFO 3","LFO 4",
        "FUNCTION","RANDOM","CHAOS","DRIFT","SEQ"
    };
    for(int i=0;i<12;++i) {
        auto& tab=tabs_[static_cast<std::size_t>(i)];
        sourceContent_.addAndMakeVisible(tab);
        tab.setButtonText(names[i]);
        tab.setName("MOD SOURCE TAB "+juce::String(i+1));
        tab.setClickingTogglesState(true);
        tab.setToggleState(i==0,juce::dontSendNotification);
        tab.addMouseListener(this,false);
        tab.onClick=[this,i]{
            if(!sourceTabActive(static_cast<std::size_t>(i))) return;
            selected_=i;
            for(std::size_t j=0;j<tabs_.size();++j)
                tabs_[j].setToggleState(j==static_cast<std::size_t>(i),juce::dontSendNotification);
            scrollSeconds_=0.0;
            sourceRemove_.setEnabled(i!=0);
            syncFromModel();
            resized();
            repaint();
        };
    }

    for(auto* button:{&sourceAdd_,&sourceRemove_}) addAndMakeVisible(*button);
    sourceAdd_.setTooltip("Add a modulation source");
    sourceRemove_.setTooltip("Remove the selected modulation source and its Matrix routes");
    sourceAdd_.onClick=[this]{showAddSourceMenu();};
    sourceRemove_.onClick=[this]{removeSelectedSource();};

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
    gridMode_.setName("ENV GRID MODE");
    gridMode_.addItem("BPM",1);gridMode_.addItem("SEC",2);gridMode_.addItem("DAW",3);
    gridMode_.setSelectedId(1,juce::dontSendNotification);
    gridMode_.onChange=[this]{
        gridModeValue_=gridMode_.getSelectedId()==2?GridMode::Seconds:
                       gridMode_.getSelectedId()==3?GridMode::Daw:GridMode::Tempo;
        updateVisibleControls();resized();updateScrollbar();repaint();
    };
    addAndMakeVisible(division_);
    division_.setName("ENV DAW DIVISION");
    for(const auto& item:std::initializer_list<std::pair<const char*,int>>{{"1/1",1},{"1/2",2},{"1/4",3},{"1/8",4},{"1/16",5},{"1/32",6},{"1/8T",7},{"1/16T",8}})
        division_.addItem(item.first,item.second);
    division_.setSelectedId(3,juce::dontSendNotification);
    division_.onChange=[this]{updateScrollbar();repaint();};

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

    rotary(*this,randomSmooth_,randomSmoothLabel_,"SMOOTH");
    randomSmooth_.setRange(0.0,1.0,.001);
    randomSmooth_.setTextBoxStyle(juce::Slider::TextBoxRight,false,54,18);
    randomSmooth_.setTooltip("0 = hard sample-and-hold; 100% = continuous glide");

    rotary(*this,randomHold_,randomHoldLabel_,"HOLD");
    randomHold_.setRange(0.0,.98,.001);
    randomHold_.setTextBoxStyle(juce::Slider::TextBoxRight,false,54,18);
    randomHold_.setTooltip("Fraction of each random cycle held before smoothing begins");

    rotary(*this,randomDelay_,randomDelayLabel_,"DELAY / s");
    randomDelay_.setRange(0.0,5.0,.001);
    randomDelay_.setSkewFactorFromMidPoint(.35);
    randomDelay_.setTextBoxStyle(juce::Slider::TextBoxRight,false,54,18);
    randomDelay_.setTooltip("Initial delay before Random modulation starts");

    shape_.addItem("MSEG",1);
    // Three explicit playback behaviours. IDs preserve legacy serialization:
    // Free=1, Loop (old NoteRetrigger)=2, Envelope=3.
    mode_.addItem("Loop",2);
    mode_.addItem("Free",1);
    mode_.addItem("Envelope",3);
    for(auto* box:{&shape_,&mode_}) {addAndMakeVisible(*box);box->setScrollWheelEnabled(false);}
    addAndMakeVisible(lfoLoop_);
    addAndMakeVisible(lfoTools_);
    lfoLoop_.setToggleState(true,juce::dontSendNotification);
    lfoLoop_.setVisible(false);
    for(auto& shape:lfoMseg_) resetMsegShape(shape);
    lfoTools_.onClick=[this]{showLfoToolsMenu();};
    auto update=[this]{commitGenerator();repaint();};
    mode_.onChange=update;rate_.onValueChange=update;curve_.onValueChange=update;
    randomSmooth_.onValueChange=update;
    randomHold_.onValueChange=update;
    randomDelay_.onValueChange=update;

    syncFromModel();
    updateVisibleControls();
    // 30 FPS is enough for modulation telemetry while halving message-thread
    // path construction, history bookkeeping and repaint pressure.
    startTimerHz(30);
}

ModulationPanel::~ModulationPanel() {
    stopTimer();
    envScroll_.removeListener(this);
    for(auto& tab:tabs_) tab.removeMouseListener(this);
    sourceViewport_.setViewedComponent(nullptr,false);
}

bool ModulationPanel::sourceTabActive(std::size_t index) const noexcept {
    if(index<=2) return (cached_.envActiveMask&(1u<<index))!=0;
    if(index>=3 && index<=6) return (cached_.lfoActiveMask&(1u<<(index-3)))!=0;
    if(index==7) return (cached_.generatorActiveMask&0x01u)!=0;
    if(index==8) return (cached_.generatorActiveMask&0x02u)!=0;
    if(index==9) return (cached_.generatorActiveMask&0x04u)!=0;
    if(index==10) return (cached_.generatorActiveMask&0x08u)!=0;
    if(index==11) return (cached_.generatorActiveMask&0x10u)!=0;
    return false;
}

void ModulationPanel::showAddSourceMenu() {
    const std::vector<NativeChoiceItem> choices{
        {1,"Envelope",true,""},
        {2,"LFO",true,""},
        {3,"Random",true,""},
        {4,"Chaos",true,""},
        {5,"Drift",true,""},
        {6,"Sequencer",true,""},
        {7,"Function",true,""}
    };
    showNativeChoiceMenu(sourceAdd_,"ADD MOD SOURCE",choices,0,
        [safe=juce::Component::SafePointer<ModulationPanel>(this)](int id) {
            if(safe!=nullptr) safe->allocateSource(id);
        });
}

void ModulationPanel::allocateSource(int sourceType) {
    if(!bindings_.snapshot || !bindings_.modulation) return;
    auto mod=bindings_.snapshot().modulation;
    int slot=-1;

    if(sourceType==1) {
        for(int i=1;i<=2;++i) if((mod.envActiveMask&(1u<<i))==0) {
            mod.envActiveMask|=(1u<<i);slot=i;break;
        }
    } else if(sourceType==2) {
        for(int i=0;i<4;++i) if((mod.lfoActiveMask&(1u<<i))==0) {
            mod.lfoActiveMask|=(1u<<i);slot=3+i;break;
        }
    } else {
        struct GeneratorSlot {int type;int tab;std::uint32_t bit;};
        static constexpr std::array<GeneratorSlot,5> generators{{
            {7,7,0x01u},{3,8,0x02u},{4,9,0x04u},{5,10,0x08u},{6,11,0x10u}
        }};
        for(const auto& g:generators) if(g.type==sourceType && (mod.generatorActiveMask&g.bit)==0) {
            mod.generatorActiveMask|=g.bit;slot=g.tab;break;
        }
    }
    if(slot<0 || !bindings_.modulation(mod)) return;

    cached_=mod;
    selected_=slot;
    for(std::size_t i=0;i<tabs_.size();++i) {
        tabs_[i].setVisible(sourceTabActive(i));
        tabs_[i].setToggleState(i==static_cast<std::size_t>(slot),juce::dontSendNotification);
    }
    sourceRemove_.setEnabled(true);
    updateVisibleControls();
    resized();
    repaint();
}

void ModulationPanel::removeSelectedSource() {
    if(!bindings_.snapshot || !bindings_.modulation) return;
    if(selected_==0 || selected_<0 || selected_>=static_cast<int>(tabs_.size())) return;

    const auto removed=sourceForTab(static_cast<std::size_t>(selected_));
    auto mod=bindings_.snapshot().modulation;

    if(selected_<=2) mod.envActiveMask&=~(1u<<selected_);
    else if(selected_<=6) mod.lfoActiveMask&=~(1u<<(selected_-3));
    else {
        static constexpr std::array<std::uint32_t,5> bits{{0x01u,0x02u,0x04u,0x08u,0x10u}};
        mod.generatorActiveMask&=~bits[static_cast<std::size_t>(selected_-7)];
    }

    // Compact away Matrix edges from the removed source.
    std::array<ModRoute,ModulationState::capacity> compact{};
    std::size_t write=0;
    for(const auto& route:mod.routes)
        if(route.id!=0 && route.source!=removed) compact[write++]=route;
    mod.routes=compact;

    if(!bindings_.modulation(mod)) return;
    cached_=mod;
    selected_=0;
    for(std::size_t i=0;i<tabs_.size();++i) {
        tabs_[i].setVisible(sourceTabActive(i));
        tabs_[i].setToggleState(i==0,juce::dontSendNotification);
    }
    sourceRemove_.setEnabled(false);
    updateVisibleControls();
    resized();
    repaint();
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
        l.shape=LfoShape::Sine;
        l.mode=static_cast<LfoMode>(mode_.getSelectedId());
        l.rateHz=static_cast<float>(rate_.getValue());

        const auto& editor=lfoMseg_[static_cast<std::size_t>(selected_-3)];
        l.pointCount=static_cast<std::uint32_t>(std::min(editor.count,l.points.size()));
        for(std::size_t i=0;i<l.pointCount;++i) {
            l.points[i].x=editor.points[i].x;
            l.points[i].y=editor.points[i].y;
            l.points[i].curve=editor.points[i].curve;
        }
    } else if(selected_==7) {
        mod.function.rateHz=static_cast<float>(rate_.getValue());
        mod.function.curve=static_cast<float>(curve_.getValue());
    } else if(selected_==8) {
        mod.random.rateHz=static_cast<float>(rate_.getValue());
        mod.random.smoothing=static_cast<float>(randomSmooth_.getValue());
        mod.random.hold=static_cast<float>(randomHold_.getValue());
        mod.random.delaySeconds=static_cast<float>(randomDelay_.getValue());
    } else if(selected_==9) {
        mod.chaos.rateHz=static_cast<float>(rate_.getValue());
    } else if(selected_==10) {
        mod.drift.rateHz=static_cast<float>(rate_.getValue());
    } else if(selected_==11) {
        mod.sequencer.rateHz=static_cast<float>(rate_.getValue());
    } else return;
    if(bindings_.modulation(mod)) cached_=mod;
}

void ModulationPanel::updateVisibleControls() {
    const bool env=selected_<=2;
    const bool lfo=selected_>=3 && selected_<=6;
    const bool function=selected_==7;
    const bool random=selected_==8;
    const bool chaos=selected_==9;
    const bool drift=selected_==10;
    const bool sequencer=selected_==11;

    for(auto& s:envSliders_) s.setVisible(env);
    for(auto& l:envLabels_) l.setVisible(env);
    const bool graphEditor=env||lfo;
    snap_.setVisible(graphEditor);gridMode_.setVisible(graphEditor);
    division_.setVisible(graphEditor && gridModeValue_==GridMode::Daw);
    zoomOut_.setVisible(graphEditor);zoomIn_.setVisible(graphEditor);
    tempo_.setVisible(graphEditor && gridModeValue_==GridMode::Tempo);
    envScroll_.setVisible(env);lfoLoop_.setVisible(false);lfoTools_.setVisible(lfo);

    const bool rateGenerator=random||chaos||drift||sequencer;
    rate_.setVisible(lfo||function||rateGenerator);
    rateLabel_.setVisible(lfo||function||rateGenerator);
    shape_.setVisible(lfo);mode_.setVisible(lfo);
    curve_.setVisible(function);curveLabel_.setVisible(function);
    randomSmooth_.setVisible(random);randomSmoothLabel_.setVisible(random);
    randomHold_.setVisible(random);randomHoldLabel_.setVisible(random);
    randomDelay_.setVisible(random);randomDelayLabel_.setVisible(random);
}

void ModulationPanel::syncFromModel() {
    if(bindings_.snapshot) cached_=bindings_.snapshot().modulation;
    if(!sourceTabActive(static_cast<std::size_t>(selected_))) selected_=0;
    for(std::size_t i=0;i<tabs_.size();++i)
        tabs_[i].setVisible(sourceTabActive(i));
    sourceRemove_.setEnabled(selected_!=0);
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
        if(lfoPointDrag_<0 && lfoCurveDrag_<0)
            loadMsegShapeFromSettings(lfoMseg_[static_cast<std::size_t>(selected_-3)],l);
        shape_.setSelectedId(1,juce::dontSendNotification);
        mode_.setSelectedId(static_cast<int>(l.mode),juce::dontSendNotification);
        if(!rate_.isMouseButtonDown()) rate_.setValue(l.rateHz,juce::dontSendNotification);
    } else if(selected_==7) {
        if(!rate_.isMouseButtonDown()) rate_.setValue(cached_.function.rateHz,juce::dontSendNotification);
        if(!curve_.isMouseButtonDown()) curve_.setValue(cached_.function.curve,juce::dontSendNotification);
    } else if(selected_==8) {
        if(!rate_.isMouseButtonDown()) rate_.setValue(cached_.random.rateHz,juce::dontSendNotification);
        if(!randomSmooth_.isMouseButtonDown()) randomSmooth_.setValue(cached_.random.smoothing,juce::dontSendNotification);
        if(!randomHold_.isMouseButtonDown()) randomHold_.setValue(cached_.random.hold,juce::dontSendNotification);
        if(!randomDelay_.isMouseButtonDown()) randomDelay_.setValue(cached_.random.delaySeconds,juce::dontSendNotification);
    } else if(selected_==9) {
        rate_.setValue(cached_.chaos.rateHz,juce::dontSendNotification);
    } else if(selected_==10) {
        rate_.setValue(cached_.drift.rateHz,juce::dontSendNotification);
    } else if(selected_==11) {
        rate_.setValue(cached_.sequencer.rateHz,juce::dontSendNotification);
    }
    updateVisibleControls();updateScrollbar();repaint();
}

double ModulationPanel::gridStepSeconds() const noexcept {
    if(gridModeValue_==GridMode::Seconds) return .25;
    double bpm=tempo_.getValue(),beats=.25;
    if(gridModeValue_==GridMode::Daw) {
        bpm=bindings_.hostBpm?bindings_.hostBpm():120.0;
        static constexpr double divisionBeats[]{4.0,2.0,1.0,.5,.25,.125,1.0/3.0,1.0/6.0};
        beats=divisionBeats[static_cast<std::size_t>(juce::jlimit(0,7,division_.getSelectedId()-1))];
    }
    return 60.0/std::max(1.0,bpm)*beats;
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
    dragStart_=e.position;
    const auto local=e.getEventRelativeTo(this);

    sourceDragTab_=-1;
    for(std::size_t i=0;i<tabs_.size();++i) {
        if(e.eventComponent==&tabs_[i] && sourceTabActive(i)) {
            sourceDragTab_=static_cast<int>(i);
            sourceDragStart_=local.position;
            break;
        }
    }

    if(const auto routeId=routeDotAt(local.position)) {
        sourceDragTab_=-1;
        routeDragId_=*routeId;
        routeDragStartY_=local.position.y;
        routeDragStartAmount_=0.0f;
        for(const auto& route:cached_.routes)
            if(route.id==routeDragId_) {routeDragStartAmount_=route.amount;break;}
        return;
    }
    if(e.eventComponent!=this) return;

    dragTarget_=DragTarget::None;lfoPointDrag_=-1;lfoCurveDrag_=-1;
    if(selected_>=3 && selected_<=6 && envCanvas_.contains(e.position)) {
        lfoDragStartShape_=lfoMseg_[static_cast<std::size_t>(selected_-3)];
        lfoPointDrag_=hitMsegPoint(e.position);
        if(lfoPointDrag_<0) lfoCurveDrag_=hitMsegCurve(e.position);
        return;
    }
    if(selected_>2 || !envCanvas_.contains(e.position)) return;
    dragTarget_=hitHandle(e.position);
    dragStart_=e.position;dragEnvelope_=currentEnvelope();dragCurves_=currentCurves();
}

void ModulationPanel::mouseDoubleClick(const juce::MouseEvent& e) {
    const auto local=e.getEventRelativeTo(this);

    // Double-clicking a route gauge removes only that Matrix assignment.
    if(const auto routeId=routeDotAt(local.position)) {
        if(bindings_.modulation) {
            auto mod=bindings_.snapshot ? bindings_.snapshot().modulation : cached_;

            std::array<ModRoute,ModulationState::capacity> compact{};
            std::size_t write=0;
            for(const auto& route:mod.routes)
                if(route.id!=0 && route.id!=*routeId)
                    compact[write++]=route;

            mod.routes=compact;
            if(bindings_.modulation(mod)) {
                cached_=mod;
                routeDragId_=0;
                repaint();
            }
        }
        return;
    }

    if(e.eventComponent!=this || selected_<3 || selected_>6 || !envCanvas_.contains(e.position)) return;
    auto& shape=lfoMseg_[static_cast<std::size_t>(selected_-3)];
    const int hit=hitMsegPoint(e.position);

    if(hit>=0) {
        if(shape.count<=2) return;
        const auto index=static_cast<std::size_t>(hit);
        // Endpoints define the loop seam and are structural: never delete them.
        if(index==0 || index+1==shape.count) return;
        for(std::size_t i=index;i+1<shape.count;++i) shape.points[i]=shape.points[i+1];
        --shape.count;
        commitMsegShape();
        repaint();return;
    }

    if(shape.count>=shape.points.size()) return;

    float x=juce::jlimit(0.0f,1.0f,(e.position.x-envCanvas_.getX())/juce::jmax(1.0f,envCanvas_.getWidth()));
    if(snap_.getToggleState()) x=std::round(x*16.0f)/16.0f;
    const float y=juce::jlimit(-1.0f,1.0f,(envCanvas_.getCentreY()-e.position.y)/juce::jmax(1.0f,envCanvas_.getHeight()*.46f));

    std::size_t insert=0;
    while(insert<shape.count && shape.points[insert].x<x) ++insert;
    if(insert>0 && std::abs(shape.points[insert-1].x-x)<.004f) return;
    if(insert<shape.count && std::abs(shape.points[insert].x-x)<.004f) return;

    for(std::size_t i=shape.count;i>insert;--i) shape.points[i]=shape.points[i-1];
    shape.points[insert]={x,y,0.0f};
    ++shape.count;
    commitMsegShape();
    repaint();
}

void ModulationPanel::mouseDrag(const juce::MouseEvent& e) {
    if(routeDragId_!=0) {
        const auto local=e.getEventRelativeTo(this);
        const float amount=juce::jlimit(-1.0f,1.0f,
            routeDragStartAmount_+(routeDragStartY_-local.position.y)/42.0f);
        setRouteAmount(routeDragId_,amount);
        return;
    }

    if(sourceDragTab_>=0) {
        const auto local=e.getEventRelativeTo(this);
        if(local.position.getDistanceFrom(sourceDragStart_)>7.0f) {
            if(auto* container=juce::DragAndDropContainer::findParentDragContainerFor(this)) {
                const auto source=sourceForTab(static_cast<std::size_t>(sourceDragTab_));
                const juce::String description="MCT_MOD_SOURCE:"+juce::String(static_cast<int>(source));
                container->startDragging(description,&tabs_[static_cast<std::size_t>(sourceDragTab_)]);
            }
            sourceDragTab_=-1;
        }
        if(sourceDragTab_>=0) return;
    }

    if(selected_>=3 && selected_<=6 && (lfoPointDrag_>=0 || lfoCurveDrag_>=0)) {
        auto& shape=lfoMseg_[static_cast<std::size_t>(selected_-3)];
        if(lfoPointDrag_>=0) {
            const auto i=static_cast<std::size_t>(lfoPointDrag_);
            const auto local=e.getEventRelativeTo(this).position;
            const float y=juce::jlimit(-1.0f,1.0f,
                (envCanvas_.getCentreY()-local.y)/juce::jmax(1.0f,envCanvas_.getHeight()*.46f));

            if(i==0 || i+1==shape.count) {
                // Loop seam endpoints are vertically movable only, and are
                // always locked to the same value.
                shape.points[0].x=0.0f;
                shape.points[shape.count-1].x=1.0f;
                shape.points[0].y=y;
                shape.points[shape.count-1].y=y;
            } else {
                float x=(local.x-envCanvas_.getX())/juce::jmax(1.0f,envCanvas_.getWidth());
                if(snap_.getToggleState()) x=std::round(x*16.0f)/16.0f;
                shape.points[i].x=juce::jlimit(
                    shape.points[i-1].x+.005f,shape.points[i+1].x-.005f,x);
                shape.points[i].y=y;
            }
        } else {
            const auto i=static_cast<std::size_t>(lfoCurveDrag_);
            shape.points[i].curve=curveForHandleY(lfoDragStartShape_,i,e.position.y);
        }
        commitMsegShape();
        repaint();return;
    }
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

void ModulationPanel::mouseUp(const juce::MouseEvent&) {
    dragTarget_=DragTarget::None;lfoPointDrag_=-1;lfoCurveDrag_=-1;
    routeDragId_=0;
    sourceDragTab_=-1;
}

juce::String ModulationPanel::routeTargetLabel(std::uint32_t routeId) const {
    const ModRoute* found=nullptr;
    for(const auto& route:cached_.routes)
        if(route.id==routeId) {found=&route;break;}
    if(!found) return {};

    juce::String target;
    switch(found->destination.parameter) {
        case ModDestination::Cutoff:target="FILTER / CUTOFF";break;
        case ModDestination::Resonance:target="FILTER / RESONANCE";break;
        case ModDestination::MasterGain:target="GLOBAL / MASTER GAIN";break;
        case ModDestination::WtPosition:target="WT POSITION";break;
        case ModDestination::Octave:target="OCTAVE";break;
        case ModDestination::Semitone:target="SEMITONE";break;
        case ModDestination::Fine:target="FINE";break;
        case ModDestination::Detune:target="DETUNE";break;
        case ModDestination::Pan:target="PAN";break;
        case ModDestination::Level:target="LEVEL";break;
        case ModDestination::Process1Amount:target="PROCESS 1 AMOUNT";break;
        case ModDestination::Process2Amount:target="PROCESS 2 AMOUNT";break;
        case ModDestination::Route1Amount:target="ROUTE 1 AMOUNT";break;
        case ModDestination::Route2Amount:target="ROUTE 2 AMOUNT";break;
    }

    if(found->destination.oscillator!=0 && bindings_.snapshot) {
        const auto state=bindings_.snapshot();
        unsigned ordinal=0;
        for(const auto& osc:state.oscillators) {
            if(!osc.id) continue;
            ++ordinal;
            if(osc.id==found->destination.oscillator) {
                target="OSC "+juce::String(ordinal)+" / "+target;
                break;
            }
        }
    }

    return target;
}

void ModulationPanel::mouseMove(const juce::MouseEvent& e) {
    const auto local=e.getEventRelativeTo(this);
    const auto hit=routeDotAt(local.position);
    const auto id=hit.value_or(0);
    if(id!=routeHoverId_ || (id!=0 && local.position.getDistanceFrom(routeHoverPoint_)>2.0f)) {
        routeHoverId_=id;
        routeHoverPoint_=local.position;
        repaint();
    }
}

void ModulationPanel::mouseExit(const juce::MouseEvent&) {
    if(routeHoverId_!=0) {
        routeHoverId_=0;
        repaint();
    }
}

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
    if(!isShowing()) return;
    constexpr float dt=1.0f/30.0f;
    updateSourceHistory(dt);
    for(auto& s:traceTail_) s.age+=dt;
    while(!traceTail_.empty() && traceTail_.front().age>0.34f) traceTail_.pop_front();

    for(auto& s:lfoTraceTail_) s.age+=dt;
    while(!lfoTraceTail_.empty() && lfoTraceTail_.front().age>0.34f)
        lfoTraceTail_.pop_front();

    if(selected_>=3 && selected_<=6 && !envCanvas_.isEmpty() &&
       modulationUiTelemetry().synthActive) {
        const auto& shape=lfoMseg_[static_cast<std::size_t>(selected_-3)];
        const float phase=juce::jlimit(0.0f,1.0f,lfoTracePhase_);
        if(lastLfoTracePhase_>=0.0f && phase+0.25f<lastLfoTracePhase_)
            lfoTraceTail_.clear(); // loop seam: never draw across right -> left
        lastLfoTracePhase_=phase;
        lfoTraceTail_.push_back({msegPixel({phase,msegValue(shape,phase),0.0f}),0.0f});
        while(lfoTraceTail_.size()>28) lfoTraceTail_.pop_front();
    } else if(selected_<3 || selected_>6 || !modulationUiTelemetry().synthActive) {
        lfoTraceTail_.clear();
        lastLfoTracePhase_=-1.0f;
    }

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
    if(selected_<=8) repaint();
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
    constexpr int railWidth=116;
    sourceRail_=body.removeFromLeft(railWidth);
    body.removeFromLeft(6);

    auto rail=sourceRail_.reduced(4,5);
    auto collectionControls=rail.removeFromBottom(24);
    sourceRemove_.setBounds(collectionControls.removeFromLeft(
        (collectionControls.getWidth()-3)/2));
    collectionControls.removeFromLeft(3);
    sourceAdd_.setBounds(collectionControls);
    rail.removeFromBottom(5);

    // V32.2: source cards no longer shrink to fit the rail. The list is a real
    // scrolling collection with stable item geometry. A route-bearing item gets
    // additional height only for its divider + magnitude-circle chamber.
    sourceViewport_.setBounds(rail);

    std::array<bool,12> routed{};
    for(std::size_t i=0;i<tabs_.size();++i) {
        const auto source=sourceForTab(i);
        for(const auto& route:cached_.routes) {
            if(route.id!=0 && route.enabled && route.source==source) {
                routed[i]=true;
                break;
            }
        }
    }

    constexpr int baseRowHeight=36;
    constexpr int routedRowHeight=54;
    const int contentWidth=juce::jmax(1,sourceViewport_.getWidth()-6);
    int y=0;
    for(std::size_t i=0;i<tabs_.size();++i) {
        if(!sourceTabActive(i)) {
            tabs_[i].setBounds({});
            continue;
        }
        const int h=routed[i]?routedRowHeight:baseRowHeight;
        tabs_[i].setBounds(0,y,contentWidth,h-2);
        y+=h;
    }
    sourceContent_.setSize(contentWidth,juce::jmax(y,sourceViewport_.getHeight()));

    auto controls=body.removeFromBottom(62);
    if(selected_<=6) {
        // V33: ENV and LFO/MSEG deliberately share editor geometry.
        // V30.0.1: ENV utility controls belong with the parameter controls, not
        // inside the graph viewport. Keep ATTACK/DECAY/SUSTAIN/RELEASE on the
        // left of the bottom strip and dock SNAP / grid / tempo / zoom to their
        // right. This gives the envelope graph its full vertical canvas.
        constexpr int gap=4;
        const bool tempoVisible=gridModeValue_==GridMode::Tempo;
        const bool divisionVisible=gridModeValue_==GridMode::Daw;
        const int toolbarWidth=
            58 + gap + 70 + gap +
            (tempoVisible ? 86 + gap : 0) +
            (divisionVisible ? 70 + gap : 0) +
            28 + 2 + 28;

        auto toolbar=controls.removeFromRight(
            juce::jmin(toolbarWidth+8,juce::jmax(0,controls.getWidth()/2)));
        controls.removeFromRight(6);
        toolbar=toolbar.reduced(4,8);

        if(selected_<=2) {
            const int cell=controls.getWidth()/4;
            for(std::size_t i=0;i<4;++i) place(controls.removeFromLeft(cell),envSliders_[i],envLabels_[i]);
        } else {
            auto rc=controls.removeFromLeft(120);rateLabel_.setBounds(rc.removeFromBottom(17));rate_.setBounds(rc);
            lfoLoop_.setBounds({});
            controls.removeFromLeft(8);lfoTools_.setBounds(controls.removeFromLeft(70).reduced(2,9));
            controls.removeFromLeft(8);mode_.setBounds(controls.removeFromLeft(132).reduced(2,18));shape_.setBounds({});
        }
        snap_.setBounds(toolbar.removeFromLeft(58));toolbar.removeFromLeft(gap);
        gridMode_.setBounds(toolbar.removeFromLeft(70));toolbar.removeFromLeft(gap);
        if(tempoVisible) {
            tempo_.setBounds(toolbar.removeFromLeft(86));toolbar.removeFromLeft(gap);
        } else tempo_.setBounds({});
        if(divisionVisible) {
            division_.setBounds(toolbar.removeFromLeft(70));toolbar.removeFromLeft(gap);
        } else division_.setBounds({});
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
        if(selected_==8) {
            // Match ENV/LFO control language: full-width cells, large rotary
            // body, readable inline value field, and identical bottom labels.
            // Do NOT squeeze TextBoxRight sliders into 46px bounds; doing so
            // leaves almost no room for the actual knob and produces the
            // tiny-knob / "..." value boxes seen in V34.0.0.
            constexpr int gap=8;
            const int available=controls.getWidth()-gap*3;
            const int cellWidth=juce::jmax(118,available/4);

            auto placeRandom=[&](juce::Slider& slider,juce::Label& label,bool last){
                const int width=last ? controls.getWidth()
                                     : juce::jmin(cellWidth,controls.getWidth());
                auto cell=controls.removeFromLeft(width);
                if(!last && controls.getWidth()>0)
                    controls.removeFromLeft(juce::jmin(gap,controls.getWidth()));

                label.setBounds(cell.removeFromBottom(17));
                slider.setBounds(cell.reduced(2,0));
            };

            placeRandom(rate_,rateLabel_,false);
            placeRandom(randomSmooth_,randomSmoothLabel_,false);
            placeRandom(randomHold_,randomHoldLabel_,false);
            placeRandom(randomDelay_,randomDelayLabel_,true);
        } else {
            auto left=controls.removeFromLeft(120);
            rateLabel_.setBounds(left.removeFromBottom(17));rate_.setBounds(left);
            if(selected_==7) {
                auto cell=controls.removeFromLeft(120);
                curveLabel_.setBounds(cell.removeFromBottom(17));curve_.setBounds(cell);
            }
        }
    }
    updateVisibleControls();
}

void ModulationPanel::loadMsegShapeFromSettings(MsegShape& shape,const LfoSettings& s) noexcept {
    if(s.pointCount>=2 && s.pointCount<=s.points.size()) {
        shape={};
        shape.count=s.pointCount;
        for(std::size_t i=0;i<shape.count;++i)
            shape.points[i]={s.points[i].x,s.points[i].y,s.points[i].curve};
        return;
    }

    shape={};
    switch(s.shape) {
        case LfoShape::Saw:
            shape.count=2;
            shape.points[0]={0,-1,0}; shape.points[1]={1,1,0};
            break;
        case LfoShape::Triangle:
            shape.count=3;
            shape.points[0]={0,-1,0}; shape.points[1]={.5f,1,0}; shape.points[2]={1,-1,0};
            break;
        case LfoShape::Square:
            shape.count=4;
            shape.points[0]={0,1,0}; shape.points[1]={.4995f,1,0};
            shape.points[2]={.5f,-1,0}; shape.points[3]={1,-1,0};
            break;
        case LfoShape::Sine:
        default:
            // Minimal sine MSEG: endpoints plus exactly three internal nodes.
            // Curvature approximates the quarter-wave easing without a forest
            // of points.
            shape.count=5;
            shape.points[0]={0.00f, 0.00f, 0.00f};
            shape.points[1]={0.25f, 1.00f,-0.42f};
            shape.points[2]={0.50f, 0.00f, 0.42f};
            shape.points[3]={0.75f,-1.00f,-0.42f};
            shape.points[4]={1.00f, 0.00f, 0.42f};
            break;
    }
}

bool ModulationPanel::commitMsegShape() {
    if(selected_<3 || selected_>6 || !bindings_.snapshot || !bindings_.modulation)
        return false;

    auto mod=bindings_.snapshot().modulation;
    auto& l=lfoSettings(mod,static_cast<std::size_t>(selected_-3));
    auto& editor=lfoMseg_[static_cast<std::size_t>(selected_-3)];
    if(editor.count>=2) {
        editor.points[0].x=0.0f;
        editor.points[editor.count-1].x=1.0f;
        editor.points[editor.count-1].y=editor.points[0].y;
    }

    l.pointCount=static_cast<std::uint32_t>(std::min(editor.count,l.points.size()));
    for(std::size_t i=0;i<l.pointCount;++i)
        l.points[i]={editor.points[i].x,editor.points[i].y,editor.points[i].curve};

    if(!bindings_.modulation(mod)) return false;
    cached_=mod;
    return true;
}

void ModulationPanel::resetMsegShape(MsegShape& shape) noexcept {
    shape={};
    shape.count=5;
    shape.points[0]={0.00f, 0.00f, 0.00f};
    shape.points[1]={0.25f, 1.00f,-0.42f};
    shape.points[2]={0.50f, 0.00f, 0.42f};
    shape.points[3]={0.75f,-1.00f,-0.42f};
    shape.points[4]={1.00f, 0.00f, 0.42f};
}
float ModulationPanel::msegValue(const MsegShape& shape,float x) const noexcept {
    if(shape.count==0) return 0.0f;
    if(shape.count==1) return shape.points[0].y;
    x=juce::jlimit(0.0f,1.0f,x);
    std::size_t hi=1;
    while(hi<shape.count && x>shape.points[hi].x) ++hi;
    hi=juce::jmin(hi,shape.count-1);
    const auto& a=shape.points[hi-1];
    const auto& b=shape.points[hi];
    float t=juce::jlimit(0.0f,1.0f,(x-a.x)/juce::jmax(.0001f,b.x-a.x));
    const float cv=juce::jlimit(-1.0f,1.0f,b.curve);
    if(cv>0.0f) t=std::pow(t,1.0f+cv*4.0f);
    else if(cv<0.0f) t=1.0f-std::pow(1.0f-t,1.0f+(-cv)*4.0f);
    return a.y+(b.y-a.y)*t;
}
juce::Point<float> ModulationPanel::msegPixel(const MsegPoint& p) const noexcept {
    return {envCanvas_.getX()+p.x*envCanvas_.getWidth(),
            envCanvas_.getCentreY()-p.y*envCanvas_.getHeight()*.46f};
}
int ModulationPanel::hitMsegPoint(juce::Point<float> p) const noexcept {
    if(selected_<3 || selected_>6) return -1;
    const auto& shape=lfoMseg_[static_cast<std::size_t>(selected_-3)];
    for(std::size_t i=0;i<shape.count;++i)
        if(p.getDistanceFrom(msegPixel(shape.points[i]))<11.0f) return static_cast<int>(i);
    return -1;
}
int ModulationPanel::hitMsegCurve(juce::Point<float> p) const noexcept {
    if(selected_<3 || selected_>6) return -1;
    const auto& shape=lfoMseg_[static_cast<std::size_t>(selected_-3)];
    for(std::size_t i=1;i<shape.count;++i) {
        const float x=(shape.points[i-1].x+shape.points[i].x)*.5f;
        const auto q=msegPixel({x,msegValue(shape,x),0.0f});
        if(p.getDistanceFrom(q)<10.0f) return static_cast<int>(i);
    }
    return -1;
}
float ModulationPanel::curveForHandleY(const MsegShape& source,std::size_t segment,float targetY) const noexcept {
    if(segment==0 || segment>=source.count) return 0.0f;
    const float phase=(source.points[segment-1].x+source.points[segment].x)*.5f;
    float bestCurve=source.points[segment].curve;
    float bestDistance=std::numeric_limits<float>::max();
    MsegShape trial=source;
    for(int step=-100;step<=100;++step) {
        const float curve=static_cast<float>(step)/100.0f;
        trial.points[segment].curve=curve;
        const float y=msegPixel({phase,msegValue(trial,phase),0.0f}).y;
        const float d=std::abs(y-targetY);
        if(d<bestDistance){bestDistance=d;bestCurve=curve;}
    }
    return bestCurve;
}
void ModulationPanel::showLfoToolsMenu() {
    if(selected_<3 || selected_>6) return;
    const std::vector<NativeChoiceItem> items{
        {1,"Reset shape",true,""},
        {2,"Flip vertical",true,""},
        {3,"Normalize vertical",true,""},
        {4,"Quantize points to 1/16",true,""},
        {5,"Flatten segment curves",true,""}
    };
    showNativeChoiceMenu(lfoTools_,"LFO / MSEG TOOLS",items,0,
        [safe=juce::Component::SafePointer<ModulationPanel>(this)](int id){
            if(safe==nullptr || safe->selected_<3 || safe->selected_>6) return;
            auto& shape=safe->lfoMseg_[static_cast<std::size_t>(safe->selected_-3)];
            if(id==1) safe->resetMsegShape(shape);
            else if(id==2) for(std::size_t i=0;i<shape.count;++i) shape.points[i].y=-shape.points[i].y;
            else if(id==3) {
                float peak=0.0f;
                for(std::size_t i=0;i<shape.count;++i) peak=juce::jmax(peak,std::abs(shape.points[i].y));
                if(peak>1.0e-5f) for(std::size_t i=0;i<shape.count;++i) shape.points[i].y=juce::jlimit(-1.0f,1.0f,shape.points[i].y/peak);
            } else if(id==4) {
                for(std::size_t i=1;i+1<shape.count;++i) shape.points[i].x=std::round(shape.points[i].x*16.0f)/16.0f;
                for(std::size_t i=1;i+1<shape.count;++i)
                    shape.points[i].x=juce::jlimit(shape.points[i-1].x+.002f,shape.points[i+1].x-.002f,shape.points[i].x);
            } else if(id==5) {
                for(std::size_t i=1;i<shape.count;++i) shape.points[i].curve=0.0f;
            }
            safe->commitMsegShape();
            safe->repaint();
        });
}

void ModulationPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    constexpr int railWidth=116;
    auto rail=body.removeFromLeft(railWidth);
    body.removeFromLeft(6);

    // The rail is intentionally structural rather than another tab bar. It is
    // the future dynamic ENV/LFO collection surface.
    well(g,rail);
    paintSourceHistoryBackgrounds(g);
    text(g,"SOURCES",rail.removeFromTop(18).reduced(5,0),8.0f,Palette::muted());

    body.removeFromBottom(66);auto caption=body.removeFromTop(17);
    juce::String title;
    if(selected_<=2) title="ENV "+juce::String(selected_+1)+(selected_==0?" / AMP + SOURCE":" / MOD SOURCE");
    else if(selected_>=3 && selected_<=6)
        {
            const auto mode=lfoSettings(cached_,static_cast<std::size_t>(selected_-3)).mode;
            const char* modeName=mode==LfoMode::Free?"FREE":mode==LfoMode::Envelope?"ENVELOPE":"LOOP";
            title="LFO "+juce::String(selected_-2)+" / "+modeName;
        }
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
                            // The glow is visually continuous at ~3 px
                            // spacing. The old 1.6 px / 32-column pass could
                            // emit ~900 line draws per frame for one envelope.
                            const int columns=juce::jlimit(1,12,static_cast<int>(std::ceil(dx/3.0f)));
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

    if(selected_>=3 && selected_<=6) {
        if(envCanvas_.isEmpty()) return;
        const auto& shape=lfoMseg_[static_cast<std::size_t>(selected_-3)];
        auto r=envCanvas_;juce::Path p;
        for(int i=0;i<=16;++i){
            const float x=r.getX()+r.getWidth()*static_cast<float>(i)/16.0f;
            g.setColour(Palette::borderSoft().withAlpha(i%4==0?.55f:.24f));
            g.drawVerticalLine(juce::roundToInt(x),r.getY(),r.getBottom());
        }
        g.setColour(Palette::borderSoft().withAlpha(.42f));
        g.drawHorizontalLine(juce::roundToInt(r.getCentreY()),r.getX(),r.getRight());
        for(int i=0;i<384;++i){
            const float x=static_cast<float>(i)/383.0f;
            const auto q=msegPixel({x,msegValue(shape,x),0.0f});
            if(i==0)p.startNewSubPath(q);else p.lineTo(q);
        }
        juce::Path fill=p;fill.lineTo(r.getRight(),r.getCentreY());fill.lineTo(r.getX(),r.getCentreY());fill.closeSubPath();
        g.setColour(signalSurfaceColour(.46f,.22f));g.fillPath(fill);
        g.setColour(Palette::accent());g.strokePath(p,juce::PathStrokeType(1.5f));
        for(std::size_t i=0;i<shape.count;++i){
            auto q=msegPixel(shape.points[i]);
            auto node=juce::Rectangle<float>(10,10).withCentre(q);
            g.setColour(Palette::background());g.fillEllipse(node);
            g.setColour(signalSourceColour());g.drawEllipse(node,1.4f);
            if(i>0){
                const float x=(shape.points[i-1].x+shape.points[i].x)*.5f;
                auto cp=msegPixel({x,msegValue(shape,x),0.0f});
                auto h=juce::Rectangle<float>(7,7).withCentre(cp);
                g.setColour(Palette::background());g.fillEllipse(h);
                g.setColour(Palette::secondary());g.drawEllipse(h,1.1f);
            }
        }

        // LFO playback tracer: same visual language as ENV, rendered only for
        // the currently visible LFO editor.
        if(!lfoTraceTail_.empty()) {
            const auto head=lfoTraceTail_.back().point;
            g.setColour(signalSourceColour().withAlpha(.10f));
            g.drawVerticalLine(juce::roundToInt(head.x),r.getY(),r.getBottom());

            for(std::size_t i=1;i<lfoTraceTail_.size();++i) {
                const auto& a=lfoTraceTail_[i-1];
                const auto& b=lfoTraceTail_[i];
                const float fresh=juce::jlimit(0.0f,1.0f,1.0f-b.age/.34f);
                if(fresh<=0.0f) continue;

                g.setColour(signalShade(.34f,.025f+.10f*fresh));
                g.drawLine(b.point.x,b.point.y,b.point.x,r.getBottom(),2.2f+3.6f*fresh);

                g.setColour(juce::Colours::white.withAlpha(.06f+.17f*fresh));
                g.drawLine(a.point.x,a.point.y,b.point.x,b.point.y,3.0f+4.5f*fresh);
                g.setColour(juce::Colours::white.withAlpha(.24f+.70f*fresh));
                g.drawLine(a.point.x,a.point.y,b.point.x,b.point.y,1.3f+2.7f*fresh);
            }

            g.setColour(juce::Colours::white.withAlpha(.05f));
            g.fillEllipse(juce::Rectangle<float>(30,30).withCentre(head));
            g.setColour(juce::Colours::white.withAlpha(.13f));
            g.fillEllipse(juce::Rectangle<float>(16,16).withCentre(head));
            g.setColour(juce::Colours::white);
            g.fillEllipse(juce::Rectangle<float>(5.5f,5.5f).withCentre(head));
        }
        return;
    }
    auto r=body.reduced(10).toFloat();juce::Path p;
    if(selected_==7) {
        for(int i=0;i<256;++i) {
            const float x=float(i)/255.f,y=r.getCentreY()-FunctionGenerator::shape(cached_.function.curve,x*2)*r.getHeight()*.45f;
            if(i==0)p.startNewSubPath(r.getX(),y);else p.lineTo(r.getX()+x*r.getWidth(),y);
        }
    } else if(selected_==8) {
        // Live Random-LFO output scope. Old samples travel RIGHT -> LEFT as
        // each new output value enters at the right edge.
        g.setColour(Palette::borderSoft().withAlpha(.24f));
        for(int i=0;i<=8;++i) {
            const float x=r.getX()+r.getWidth()*float(i)/8.0f;
            g.drawVerticalLine(juce::roundToInt(x),r.getY(),r.getBottom());
        }
        g.setColour(Palette::borderSoft().withAlpha(.52f));
        g.drawHorizontalLine(juce::roundToInt(r.getCentreY()),r.getX(),r.getRight());

        const auto count=randomViewportHistory_.size();
        if(count>0) {
            const float dx=r.getWidth()/float(randomHistoryLength_-1);
            const float startX=r.getRight()-dx*float(count-1);
            std::size_t i=0;
            for(const float sample:randomViewportHistory_) {
                const float x=startX+dx*float(i++);
                const float y=r.getCentreY()-sample*r.getHeight()*.45f;
                if(i==1) p.startNewSubPath(x,y); else p.lineTo(x,y);
            }

            juce::Path fill=p;
            const float endX=r.getRight();
            fill.lineTo(endX,r.getCentreY());
            fill.lineTo(startX,r.getCentreY());
            fill.closeSubPath();
            g.setColour(signalSurfaceColour(.46f,.22f));
            g.fillPath(fill);

            // Bright latest-output head makes the viewport read like a live
            // modulation scope rather than a static random-shape preview.
            const float latest=randomViewportHistory_.back();
            const juce::Point<float> head{
                r.getRight(),
                r.getCentreY()-latest*r.getHeight()*.45f
            };
            g.setColour(signalSourceColour().withAlpha(.15f));
            g.fillEllipse(juce::Rectangle<float>(15,15).withCentre(head));
            g.setColour(juce::Colours::white);
            g.fillEllipse(juce::Rectangle<float>(4.5f,4.5f).withCentre(head));
        }
    } else {
        // Keep the compact preview for Chaos / Drift / Sequencer until their
        // dedicated editors are promoted in later passes.
        std::uint32_t seed=0x6d2b79f5u;float last=0;
        for(int i=0;i<16;++i) {
            seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;
            const float next=float((seed>>8)&0x00ffffffu)/16777215.f*2.f-1.f;
            const float x0=r.getX()+r.getWidth()*float(i)/16.f,x1=r.getX()+r.getWidth()*float(i+1)/16.f;
            const float y=r.getCentreY()-last*r.getHeight()*.45f,y2=r.getCentreY()-next*r.getHeight()*.45f;
            if(i==0)p.startNewSubPath(x0,y);p.lineTo(x1,y);p.lineTo(x1,y2);last=next;
        }
    }
    g.setColour(Palette::accent());
    if(!p.isEmpty()) g.strokePath(p,juce::PathStrokeType(selected_==8?1.8f:1.5f));
}


ModSource ModulationPanel::sourceForTab(std::size_t index) noexcept {
    static constexpr std::array<ModSource,12> sources{
        ModSource::Env1,ModSource::Env2,ModSource::Env3,
        ModSource::Lfo1,ModSource::Lfo2,ModSource::Lfo3,ModSource::Lfo4,
        ModSource::Function,ModSource::Random,ModSource::Chaos,ModSource::Drift,ModSource::Sequencer
    };
    return sources[juce::jmin(index,sources.size()-1)];
}

juce::Rectangle<float> ModulationPanel::routeDotBounds(
    std::size_t tabIndex,std::size_t dotIndex,std::size_t dotCount) const noexcept {
    if(tabIndex>=tabs_.size() || dotCount==0) return {};
    auto b=getLocalArea(&sourceContent_,tabs_[tabIndex].getBounds())
               .toFloat().reduced(5.0f,1.5f);
    auto dotArea=b.withTrimmedTop(17.5f);
    // Route gauges need enough visual area to read as controls, not status LEDs.
    constexpr float diameter=16.0f;
    constexpr float gap=5.0f;
    const auto shown=juce::jmin<std::size_t>(dotCount,6);
    const float total=shown*diameter+(shown>0 ? (shown-1)*gap : 0.0f);
    const float x0=dotArea.getCentreX()-total*0.5f;
    return {x0+static_cast<float>(dotIndex)*(diameter+gap),
            dotArea.getCentreY()-diameter*0.5f,diameter,diameter};
}

std::optional<std::uint32_t> ModulationPanel::routeDotAt(
    juce::Point<float> point) const noexcept {
    if(!sourceViewport_.getBounds().toFloat().contains(point))
        return std::nullopt;
    for(std::size_t tabIndex=0;tabIndex<tabs_.size();++tabIndex) {
        const auto source=sourceForTab(tabIndex);
        std::array<const ModRoute*,ModulationState::capacity> matches{};
        std::size_t count=0;
        for(const auto& route:cached_.routes)
            if(route.id!=0 && route.enabled && route.source==source)
                matches[count++]=&route;

        const auto shown=juce::jmin<std::size_t>(count,6);
        for(std::size_t dot=0;dot<shown;++dot)
            if(routeDotBounds(tabIndex,dot,count).expanded(2.0f).contains(point))
                return matches[dot]->id;
    }
    return std::nullopt;
}

void ModulationPanel::setRouteAmount(std::uint32_t routeId,float amount) {
    if(routeId==0 || !bindings_.route) return;
    for(auto& route:cached_.routes) {
        if(route.id!=routeId) continue;
        auto updated=route;
        updated.amount=juce::jlimit(-1.0f,1.0f,amount);
        if(bindings_.route(updated)) {
            route=updated;
            repaint();
        }
        return;
    }
}

void ModulationPanel::updateSourceHistory(float) {
    if(bindings_.snapshot)
        cached_=bindings_.snapshot().modulation;

    if(bindings_.envelopeTrace)
        sourceTrace_=bindings_.envelopeTrace();

    const bool newNote=sourceTrace_.active &&
                       sourceTrace_.order!=0 &&
                       sourceTrace_.order!=sourceTraceOrder_;
    if(newNote) {
        sourceTraceOrder_=sourceTrace_.order;
        for(std::size_t i=0;i<sourceMonitorLfos_.size();++i)
            if(lfoSettings(cached_,i).mode!=LfoMode::Free)
                sourceMonitorLfos_[i].reset();
    }

    auto& telemetry=modulationUiTelemetry();
    telemetry.state=cached_;
    telemetry.selectedSource=sourceForTab(static_cast<std::size_t>(selected_));
    telemetry.synthActive=sourceTrace_.active;

    // No audible/active envelope means no source-history display. Free-running
    // LFOs may continue mathematically, but the synth has no output to modulate.
    if(!sourceTrace_.active) {
        telemetry.sourceValues.fill(0.0f);
        for(auto& history:sourceHistory_) history.clear();
        randomViewportHistory_.clear();
        return;
    }

    std::array<float,12> samples{};
    for(std::size_t i=0;i<3;++i)
        samples[i]=juce::jlimit(0.0f,1.0f,sourceTrace_.envelopes[i].value);

    constexpr double monitorRate=30.0;
    for(std::size_t i=0;i<4;++i) {
        samples[3+i]=sourceMonitorLfos_[i].next(lfoSettings(cached_,i),monitorRate);
        if(selected_==static_cast<int>(3+i))
            lfoTracePhase_=static_cast<float>(sourceMonitorLfos_[i].phase());
    }

    samples[7]=(cached_.generatorActiveMask&0x01u)
        ? sourceMonitorFunction_.next(cached_.function,monitorRate) : 0.0f;
    samples[8]=(cached_.generatorActiveMask&0x02u)
        ? sourceMonitorRandom_.next(cached_.random,monitorRate) : 0.0f;
    samples[9]=(cached_.generatorActiveMask&0x04u)
        ? sourceMonitorChaos_.next(cached_.chaos,monitorRate) : 0.0f;
    samples[10]=(cached_.generatorActiveMask&0x08u)
        ? sourceMonitorDrift_.next(cached_.drift,monitorRate) : 0.0f;
    samples[11]=(cached_.generatorActiveMask&0x10u)
        ? sourceMonitorSequencer_.next(cached_.sequencer,monitorRate) : 0.0f;
    telemetry.sourceValues=samples;

    randomViewportHistory_.push_back(juce::jlimit(-1.0f,1.0f,samples[8]));
    while(randomViewportHistory_.size()>randomHistoryLength_)
        randomViewportHistory_.pop_front();

    const auto visibleRail=sourceViewport_.getBounds().toFloat();
    for(std::size_t i=0;i<sourceHistory_.size();++i) {
        // Histories exist only to paint the list cards. Do not maintain rolling
        // buffers for cards that are currently scrolled out of view.
        const auto card=getLocalArea(&sourceContent_,tabs_[i].getBounds()).toFloat();
        if(!card.intersects(visibleRail)) continue;

        auto& history=sourceHistory_[i];
        history.push_back(juce::jlimit(0.0f,1.0f,std::abs(samples[i])));
        while(history.size()>sourceHistoryLength_) history.pop_front();
    }
}

void ModulationPanel::paintSourceHistoryBackgrounds(juce::Graphics& g) {
    const auto red=signalSourceColour();
    const auto white=Palette::text();

    if(!modulationUiTelemetry().synthActive) return;

    juce::Graphics::ScopedSaveState viewportClip(g);
    g.reduceClipRegion(sourceViewport_.getBounds());

    for(std::size_t i=0;i<tabs_.size();++i) {
        auto b=getLocalArea(&sourceContent_,tabs_[i].getBounds())
                   .toFloat().reduced(0.75f);
        if(b.isEmpty() || !b.intersects(sourceViewport_.getBounds().toFloat())) continue;

        g.setColour(juce::Colours::black.withAlpha(0.86f));
        g.fillRoundedRectangle(b,3.5f);

        const auto& history=sourceHistory_[i];
        if(history.empty()) continue;

        const std::size_t count=history.size();
        const float strip=juce::jmax(1.0f,b.getWidth()/static_cast<float>(sourceHistoryLength_));
        const float right=b.getRight();

        for(std::size_t h=0;h<count;++h) {
            const float magnitude=juce::jlimit(0.0f,1.0f,history[h]);
            auto colour=magnitude<=0.5f
                ? juce::Colours::black.interpolatedWith(red,magnitude*2.0f)
                : red.interpolatedWith(white,(magnitude-0.5f)*2.0f);

            const float x=right-strip*static_cast<float>(count-h);
            g.setColour(colour.withAlpha(0.34f+0.26f*magnitude));
            g.fillRect(juce::Rectangle<float>(x,b.getY(),strip+0.5f,b.getHeight()));
        }
    }
}

void ModulationPanel::paintSourceRouteOverlays(juce::Graphics& g) {
    juce::Graphics::ScopedSaveState viewportClip(g);
    g.reduceClipRegion(sourceViewport_.getBounds());

    for(std::size_t tabIndex=0;tabIndex<tabs_.size();++tabIndex) {
        const auto source=sourceForTab(tabIndex);
        std::array<const ModRoute*,ModulationState::capacity> matches{};
        std::size_t count=0;
        for(const auto& route:cached_.routes)
            if(route.id!=0 && route.enabled && route.source==source)
                matches[count++]=&route;

        if(count==0) continue;

        const auto tab=getLocalArea(&sourceContent_,tabs_[tabIndex].getBounds())
                           .toFloat().reduced(4.0f,1.0f);
        const float dividerY=tab.getY()+16.5f;
        g.setColour(Palette::borderStrong().withAlpha(0.58f));
        g.drawLine(tab.getX()+4.0f,dividerY,tab.getRight()-4.0f,dividerY,0.75f);

        const auto shown=juce::jmin<std::size_t>(count,6);
        for(std::size_t dot=0;dot<shown;++dot) {
            const auto circle=routeDotBounds(tabIndex,dot,count);
            const float amount=juce::jlimit(-1.0f,1.0f,matches[dot]->amount);
            const float magnitude=std::abs(amount);

            const auto c=circle.getCentre();
            const float radius=circle.getWidth()*0.5f-1.75f;

            g.setColour(Palette::background().withAlpha(0.96f));
            g.fillEllipse(circle);
            g.setColour(Palette::borderStrong().withAlpha(0.72f));
            g.drawEllipse(circle.reduced(1.15f),1.25f);

            // 0% reference is always 12 o'clock.
            g.setColour(Palette::text().withAlpha(0.56f));
            g.drawLine(c.x,c.y-radius,
                       c.x,c.y-radius+3.1f,1.15f);

            // Clockwise magnitude ring. Explicit screen-space trig keeps the
            // direction unambiguous: -pi/2 is 12 o'clock and increasing angle
            // moves clockwise because screen Y increases downward.
            if(magnitude>0.001f) {
                constexpr int segments=48;
                const int used=juce::jmax(1,juce::roundToInt(magnitude*segments));
                juce::Path arc;

                for(int step=0;step<=used;++step) {
                    const float localT=magnitude*
                        (static_cast<float>(step)/static_cast<float>(used));
                    const float angle=-juce::MathConstants<float>::halfPi+
                                      juce::MathConstants<float>::twoPi*localT;
                    const juce::Point<float> p{
                        c.x+std::cos(angle)*radius,
                        c.y+std::sin(angle)*radius
                    };
                    if(step==0) arc.startNewSubPath(p);
                    else arc.lineTo(p);
                }

                auto colour=signalSourceColour();
                if(amount<0.0f) colour=colour.darker(0.34f);
                g.setColour(colour.withAlpha(0.98f));
                g.strokePath(arc,juce::PathStrokeType(
                    2.75f,
                    juce::PathStrokeType::curved,
                    juce::PathStrokeType::rounded));

                const float endAngle=-juce::MathConstants<float>::halfPi+
                                     juce::MathConstants<float>::twoPi*magnitude;
                const juce::Point<float> endpoint{
                    c.x+std::cos(endAngle)*radius,
                    c.y+std::sin(endAngle)*radius
                };
                g.setColour(Palette::text().withAlpha(0.95f));
                g.fillEllipse(juce::Rectangle<float>(3.2f,3.2f).withCentre(endpoint));
            } else {
                g.setColour(Palette::text().withAlpha(0.84f));
                g.fillEllipse(juce::Rectangle<float>(3.0f,3.0f)
                                  .withCentre({c.x,c.y-radius}));
            }
        }

        if(count>shown) {
            g.setColour(Palette::muted());
            g.setFont(juce::FontOptions(7.0f));
            g.drawText("+"+juce::String(static_cast<int>(count-shown)),
                       juce::Rectangle<float>(tab.getRight()-18.0f,dividerY+1.0f,16.0f,11.0f),
                       juce::Justification::centred);
        }
    }
}

void ModulationPanel::paintEnvelopeTimeMarkers(juce::Graphics& g) const {
    if(selected_>2 || envCanvas_.isEmpty()) return;

    double majorStep=1.0;
    if(gridModeValue_==GridMode::Tempo)
        majorStep=60.0/std::max(1.0,tempo_.getValue());
    else if(gridModeValue_==GridMode::Daw)
        majorStep=gridStepSeconds();

    majorStep=std::max(0.01,majorStep);
    const double visibleEnd=scrollSeconds_+
        static_cast<double>(envCanvas_.getWidth())/pixelsPerSecond_;
    double t=std::ceil(scrollSeconds_/majorStep)*majorStep;
    float lastLabelX=-1000.0f;
    int index=static_cast<int>(std::llround(t/majorStep));

    g.setFont(juce::FontOptions(8.0f));
    for(;t<=visibleEnd+1.0e-8;t+=majorStep,++index) {
        const float x=timeToX(t);
        if(x<envCanvas_.getX()-1.0f || x>envCanvas_.getRight()+1.0f) continue;

        g.setColour(Palette::borderStrong().withAlpha(0.60f));
        g.drawLine(x,envCanvas_.getY(),x,envCanvas_.getY()+5.0f,0.8f);

        if(x-lastLabelX<34.0f) continue;
        juce::String label;
        if(gridModeValue_==GridMode::Seconds)
            label=juce::String(t,t<10.0?1:0)+"s";
        else if(gridModeValue_==GridMode::Tempo)
            label=juce::String(index)+"b";
        else
            label=juce::String(index);

        g.setColour(Palette::muted().withAlpha(0.82f));
        g.drawText(label,juce::Rectangle<float>(x+3.0f,envCanvas_.getY()+2.0f,31.0f,10.0f),
                   juce::Justification::centredLeft);
        lastLabelX=x;
    }
}

void ModulationPanel::paintOverChildren(juce::Graphics& g) {
    paintSourceRouteOverlays(g);
    paintEnvelopeTimeMarkers(g);

    if(routeHoverId_!=0) {
        const auto label=routeTargetLabel(routeHoverId_);
        if(label.isNotEmpty()) {
            g.setFont(juce::FontOptions(9.0f));
            // Avoid JUCE Font width APIs here: this project is building against
            // a JUCE revision where both getStringWidthFloat() and getStringWidth()
            // are unavailable. This tooltip is short, fixed-font UI text, so a
            // deterministic character-width estimate is sufficient and portable.
            const int w=juce::jlimit(92,220,18+label.length()*7);
            juce::Rectangle<float> box(routeHoverPoint_.x+12.0f,routeHoverPoint_.y-30.0f,
                                       float(w),24.0f);
            const auto bounds=getLocalBounds().toFloat().reduced(4.0f);
            if(box.getRight()>bounds.getRight()) box.setX(routeHoverPoint_.x-float(w)-12.0f);
            if(box.getY()<bounds.getY()) box.setY(routeHoverPoint_.y+12.0f);

            g.setColour(juce::Colours::black.withAlpha(.94f));
            g.fillRoundedRectangle(box,4.0f);
            g.setColour(Palette::borderStrong());
            g.drawRoundedRectangle(box,4.0f,.9f);
            g.setColour(Palette::text());
            g.drawText(label,box.reduced(8.0f,2.0f),juce::Justification::centredLeft);
        }
    }
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
