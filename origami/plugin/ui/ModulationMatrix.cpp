// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-modulation-completion-v24.0.1
// mct-origami-pitch-mod-real-v23.3
#include "ModulationMatrix.h"
namespace mct::origami::ui {
class ModulationMatrix::Row final : public juce::Component {
public:
    Row(ModRoute route,const InstrumentState& state,ModulationBindings bindings):route_(route),bindings_(std::move(bindings)) {
        setName("Modulation route "+juce::String(route.id));
        for(auto* box:{&source_,&destination_}) {addAndMakeVisible(box);box->setScrollWheelEnabled(false);}
        source_.setName("Route source");destination_.setName("Route destination");
        auto sourceItem=[&](const juce::String& group,const juce::String& label,ModSource source) {
            source_.addNativeItem(group,label,static_cast<int>(source));
        };

        if(state.modulation.envActiveMask&0x1u) sourceItem("Envelopes","ENV 1",ModSource::Env1);
        if(state.modulation.envActiveMask&0x2u) sourceItem("Envelopes","ENV 2",ModSource::Env2);
        if(state.modulation.envActiveMask&0x4u) sourceItem("Envelopes","ENV 3",ModSource::Env3);

        if(state.modulation.lfoActiveMask&0x1u) sourceItem("LFOs","LFO 1",ModSource::Lfo1);
        if(state.modulation.lfoActiveMask&0x2u) sourceItem("LFOs","LFO 2",ModSource::Lfo2);
        if(state.modulation.lfoActiveMask&0x4u) sourceItem("LFOs","LFO 3",ModSource::Lfo3);
        if(state.modulation.lfoActiveMask&0x8u) sourceItem("LFOs","LFO 4",ModSource::Lfo4);

        sourceItem("Macros","MACRO 1",ModSource::Macro1);
        sourceItem("Macros","MACRO 2",ModSource::Macro2);
        sourceItem("Macros","MACRO 3",ModSource::Macro3);
        sourceItem("Macros","MACRO 4",ModSource::Macro4);

        sourceItem("Performance","VELOCITY",ModSource::Velocity);
        sourceItem("Performance","MOD WHEEL",ModSource::ModWheel);
        sourceItem("Performance","KEYTRACK",ModSource::Keytrack);
        sourceItem("Performance","AFTERTOUCH",ModSource::Aftertouch);
        sourceItem("Performance","PITCH BEND",ModSource::PitchBend);
        sourceItem("Performance","NOTE GATE",ModSource::NoteGate);

        if(state.modulation.generatorActiveMask&0x02u) sourceItem("Generators","RANDOM",ModSource::Random);
        if(state.modulation.generatorActiveMask&0x01u) sourceItem("Generators","FUNCTION",ModSource::Function);
        if(state.modulation.generatorActiveMask&0x04u) sourceItem("Generators","CHAOS",ModSource::Chaos);
        if(state.modulation.generatorActiveMask&0x08u) sourceItem("Generators","DRIFT",ModSource::Drift);
        if(state.modulation.generatorActiveMask&0x10u) sourceItem("Generators","SEQUENCER",ModSource::Sequencer);
        auto add=[&](const juce::String& group,ModAddress address,const juce::String& label) {
            addresses_.push_back(address);
            destination_.addNativeItem(group,label,static_cast<int>(addresses_.size()));
        };

        if(state.modulation.filterEnabled) {
            add("Filter",{ModDestination::Cutoff,0},"CUTOFF");
            add("Filter",{ModDestination::Resonance,0},"RESONANCE");
        }
        add("Global",{ModDestination::MasterGain,0},"MASTER GAIN");

        struct OscDestinationSpec { ModDestination destination; const char* label; };
        static constexpr OscDestinationSpec oscillatorDestinations[] {
            {ModDestination::WtPosition,"WT POSITION"},
            {ModDestination::Octave,"OCTAVE"},
            {ModDestination::Semitone,"SEMITONE"},
            {ModDestination::Fine,"FINE"},
            {ModDestination::Detune,"DETUNE"},
            {ModDestination::Pan,"PAN"},
            {ModDestination::Level,"LEVEL"},
            {ModDestination::Process1Amount,"PROCESS 1 AMOUNT"},
            {ModDestination::Process2Amount,"PROCESS 2 AMOUNT"},
            {ModDestination::Route1Amount,"ROUTE 1 AMOUNT"},
            {ModDestination::Route2Amount,"ROUTE 2 AMOUNT"}
        };

        unsigned ordinal=0;
        for(const auto& m:state.oscillators) if(m.id) {
            ++ordinal;
            const auto group="OSC "+juce::String(ordinal);
            for(const auto& spec:oscillatorDestinations)
                add(group,{spec.destination,m.id},spec.label);
        }
        addAndMakeVisible(enabled_);addAndMakeVisible(remove_);addAndMakeVisible(amount_);
        enabled_.setClickingTogglesState(true);enabled_.setName("Route enabled");remove_.setName("Delete route");
        amount_.setName("Route amount");amount_.setSliderStyle(juce::Slider::LinearHorizontal);
        amount_.setTextBoxStyle(juce::Slider::TextBoxRight,false,75,22);amount_.setRange(-100,100,.1);amount_.setTextValueSuffix(" %");amount_.setScrollWheelEnabled(false);
        amount_.setTooltip("Signed fraction of destination range; cutoff uses a logarithmic range");
        sync(route);
        auto update=[this] {
            const int selected=destination_.getSelectedId()-1;
            if(selected<0 || selected>=static_cast<int>(addresses_.size())) return;
            route_.source=static_cast<ModSource>(source_.getSelectedId());route_.destination=addresses_[static_cast<std::size_t>(selected)];
            route_.enabled=enabled_.getToggleState();route_.amount=static_cast<float>(amount_.getValue()/100.0);
            if(bindings_.route) bindings_.route(route_);
        };
        source_.onChange=update;destination_.onChange=update;enabled_.onClick=update;amount_.onValueChange=update;
        remove_.onClick=[this]{if(bindings_.removeRoute) bindings_.removeRoute(route_.id);};
    }
    unsigned id() const {return route_.id;}
    void sync(const ModRoute& route) {
        route_=route;source_.setSelectedId(static_cast<int>(route.source),juce::dontSendNotification);
        for(std::size_t i=0;i<addresses_.size();++i) if(addresses_[i]==route.destination) destination_.setSelectedId(static_cast<int>(i+1),juce::dontSendNotification);
        enabled_.setToggleState(route.enabled,juce::dontSendNotification);
        if(!amount_.isMouseButtonDown() && !amount_.hasKeyboardFocus(true)) amount_.setValue(route.amount*100.0,juce::dontSendNotification);
    }
    void resized() override {
        auto b=getLocalBounds().reduced(10,8);enabled_.setBounds(b.removeFromLeft(50));b.removeFromLeft(14);
        source_.setBounds(b.removeFromLeft(170));b.removeFromLeft(24);destination_.setBounds(b.removeFromLeft(280));b.removeFromLeft(20);
        remove_.setBounds(b.removeFromRight(40));b.removeFromRight(15);amount_.setBounds(b);
    }
    void paint(juce::Graphics& g) override {well(g,getLocalBounds());}
private:
    ModRoute route_;ModulationBindings bindings_;std::vector<ModAddress> addresses_;
    NativeComboBox source_,destination_;
    juce::TextButton enabled_{"ON"},remove_{"-"};juce::Slider amount_;
};
ModulationMatrix::ModulationMatrix(ModulationBindings bindings):Panel("MODULATION MATRIX"),bindings_(std::move(bindings)) {
    addAndMakeVisible(viewport_);viewport_.setViewedComponent(&content_,false);viewport_.setScrollBarsShown(true,false);
    addAndMakeVisible(add_);add_.setName("Add modulation route");add_.onClick=[this]{if(bindings_.addRoute) bindings_.addRoute();syncFromModel();};
    syncFromModel();
}
ModulationMatrix::~ModulationMatrix(){viewport_.setViewedComponent(nullptr,false);}
void ModulationMatrix::syncFromModel() {
    if(!bindings_.snapshot) return;const auto state=bindings_.snapshot();
    std::vector<unsigned> modules,ids;for(const auto& m:state.oscillators) if(m.id) modules.push_back(m.id);
    for(const auto& r:state.modulation.routes) if(r.id) ids.push_back(r.id);
    bool rebuild=modules!=moduleIds_ || ids.size()!=rows_.size() ||
                 envMask_!=state.modulation.envActiveMask ||
                 lfoMask_!=state.modulation.lfoActiveMask ||
                 generatorMask_!=state.modulation.generatorActiveMask ||
                 filterEnabled_!=state.modulation.filterEnabled;
    for(std::size_t i=0;!rebuild && i<ids.size();++i) rebuild=rows_[i]->id()!=ids[i];
    if(rebuild) {
        moduleIds_=modules;
        envMask_=state.modulation.envActiveMask;
        lfoMask_=state.modulation.lfoActiveMask;
        generatorMask_=state.modulation.generatorActiveMask;
        filterEnabled_=state.modulation.filterEnabled;
        rows_.clear();
        for(const auto& route:state.modulation.routes) if(route.id) {
            auto row=std::make_unique<Row>(route,state,bindings_);content_.addAndMakeVisible(*row);rows_.push_back(std::move(row));
        }
        resized();
    } else for(std::size_t i=0;i<rows_.size();++i) rows_[i]->sync(state.modulation.routes[i]);
    add_.setEnabled(rows_.size()<ModulationState::capacity);repaint();
}
void ModulationMatrix::resized() {
    add_.setBounds(getWidth()-155,5,143,23);auto b=contentBounds();b.removeFromTop(36);viewport_.setBounds(b);
    const int width=juce::jmax(0,viewport_.getWidth()-14);int y=0;
    for(auto& row:rows_) {row->setBounds(0,y,width,48);y+=56;}content_.setSize(width,juce::jmax(y,viewport_.getHeight()));
}
void ModulationMatrix::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    text(g,"SOURCE  →  DESTINATION  →  AMOUNT     |     Base values stay unchanged",body.removeFromTop(28),11,Palette::secondary());
    if(rows_.empty()) text(g,"No modulation routes. Add a route to connect any envelope, LFO, macro, performance source, random or function source.",body.reduced(12),12,Palette::muted(),juce::Justification::centred);
}
}
