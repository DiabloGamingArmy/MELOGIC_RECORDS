// mct-origami-nodes-n01
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-modulation-completion-v24.0.1
// mct-origami-pitch-mod-real-v23.3
#include "ModulationMatrix.h"
#include "ModulationDestinations.h"
namespace mct::origami::ui {

// ---------------------------------------------------------------- monitor

void ModulationRouteMonitor::push(float contribution,bool active) noexcept {
    if(!std::isfinite(contribution) || !active) contribution=0.0f;
    history_[head_]=juce::jlimit(-1.0f,1.0f,contribution);
    head_=(head_+1)%historyLength;
    count_=std::min(count_+1,historyLength);
    if(active!=active_) { active_=active; }
    repaint();
}

void ModulationRouteMonitor::clear() noexcept {
    history_.fill(0.0f);
    head_=count_=0;
    repaint();
}

float ModulationRouteMonitor::latest() const noexcept {
    return count_==0 ? 0.0f : history_[(head_+historyLength-1)%historyLength];
}

void ModulationRouteMonitor::paint(juce::Graphics& g) {
    // Same vocabulary as the SYNTH source-card history: black card, strips
    // ramping black -> signal red -> white with magnitude, newest on the right.
    auto b=getLocalBounds().toFloat().reduced(0.5f);
    g.setColour(juce::Colours::black.withAlpha(active_ ? 0.86f : 0.5f));
    g.fillRoundedRectangle(b,3.0f);
    g.setColour(Palette::borderSoft());
    g.drawRoundedRectangle(b,3.0f,0.8f);
    const float mid=b.getCentreY();
    const float half=b.getHeight()*0.5f-2.0f;
    g.setColour(Palette::borderStrong().withAlpha(active_ ? 0.55f : 0.3f));
    g.drawHorizontalLine(juce::roundToInt(mid),b.getX()+2.0f,b.getRight()-2.0f);
    if(!active_ || count_==0) return;
    const auto red=signalSourceColour();
    const auto white=Palette::text();
    const float strip=(b.getWidth()-4.0f)/float(historyLength);
    for(std::size_t i=0;i<count_;++i) {
        const float v=history_[(head_+historyLength-count_+i)%historyLength];
        const float magnitude=std::abs(v);
        if(magnitude<1.0e-4f) continue;
        const auto colour=magnitude<=0.5f ? juce::Colours::black.interpolatedWith(red,magnitude*2.0f)
                                          : red.interpolatedWith(white,(magnitude-0.5f)*2.0f);
        const float x=b.getRight()-2.0f-strip*float(count_-i);
        const float h=std::max(1.0f,magnitude*half);
        g.setColour(colour.withAlpha(0.55f+0.4f*magnitude));
        g.fillRect(juce::Rectangle<float>(x,v>0.0f ? mid-h : mid,strip+0.35f,h));
    }
}

// ---------------------------------------------------------------- route row

class ModulationMatrix::Row final : public juce::Component {
public:
    Row(ModRoute route,const InstrumentState& state,ModulationBindings bindings,unsigned ordinal,bool compact)
        :route_(route),bindings_(std::move(bindings)),ordinal_(ordinal),compact_(compact) {
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
        // The shared destination catalog (also the NODES PARAMETER picker).
        for(const auto& entry:modulationDestinationCatalog(state,bindings_)) {
            if(entry.separatorBefore) destination_.addNativeSeparator(entry.group);
            addresses_.push_back(entry.address);
            destination_.addNativeItem(entry.group,entry.label,static_cast<int>(addresses_.size()));
        }
        addAndMakeVisible(enabled_);addAndMakeVisible(bipolar_);addAndMakeVisible(monitor_);addAndMakeVisible(remove_);addAndMakeVisible(amount_);
        enabled_.setClickingTogglesState(true);enabled_.setName("MATRIX ROUTE ENABLE");
        bipolar_.setClickingTogglesState(true);bipolar_.setName("MATRIX ROUTE POLARITY");
        bipolar_.setTooltip("Off: unipolar 0 to +depth. On: bipolar -depth to +depth.");
        monitor_.setName("MATRIX ROUTE MONITOR");
        remove_.setName("MATRIX ROUTE DELETE");remove_.setTooltip("Delete this modulation route");
        amount_.setName("MATRIX ROUTE AMOUNT");amount_.setSliderStyle(juce::Slider::LinearHorizontal);
        amount_.setTextBoxStyle(juce::Slider::TextBoxRight,false,compact_ ? 58 : 75,compact_ ? 18 : 22);
        amount_.setRange(-100,100,.1);amount_.setTextValueSuffix(" %");amount_.setScrollWheelEnabled(false);
        amount_.setTooltip("Signed fraction of destination range; cutoff uses a logarithmic range");
        sync(route,state.modulation);
        source_.onChange=[this] {
            auto edited=route_;
            edited.source=static_cast<ModSource>(source_.getSelectedId());
            // A new source must not recreate an existing (source, destination)
            // pair: the destination is cleared rather than duplicated.
            if(routeDuplicates(modulation_,edited)) edited.destination={ModDestination::None,0,0};
            commit(edited);
        };
        destination_.onChange=[this] {
            const int selected=destination_.getSelectedId()-1;
            if(selected<0 || selected>=static_cast<int>(addresses_.size())) return;
            auto edited=route_;
            edited.destination=addresses_[static_cast<std::size_t>(selected)];
            commit(edited); // the model rejects a duplicate pair; sync() reverts
        };
        enabled_.onClick=[this] {
            auto edited=route_;edited.enabled=enabled_.getToggleState();commit(edited);
        };
        bipolar_.onClick=[this] {
            auto edited=route_;edited.bipolar=bipolar_.getToggleState();commit(edited);
        };
        amount_.onValueChange=[this] {
            auto edited=route_;edited.amount=static_cast<float>(amount_.getValue()/100.0);
            commit(edited);
        };
        remove_.onClick=[this]{if(bindings_.removeRoute) bindings_.removeRoute(route_.id);};
    }
    unsigned id() const {return route_.id;}
    const ModRoute& route() const noexcept { return route_; }
    ModulationRouteMonitor& monitor() noexcept { return monitor_; }
    void commit(const ModRoute& edited) {
        if(bindings_.route && bindings_.route(edited)) {
            auto mod=modulation_;
            for(auto& r:mod.routes) if(r.id==edited.id) r=edited;
            sync(edited,mod);
        } else sync(route_,modulation_);
    }
    void sync(const ModRoute& route,const ModulationState& modulation) {
        route_=route;modulation_=modulation;
        source_.setSelectedId(static_cast<int>(route.source),juce::dontSendNotification);
        if(route.source==ModSource::None) source_.setText("SELECT SOURCE",juce::dontSendNotification);
        // N04: a PROCESSED route (its source is a NODES operator) is one row,
        // never flattened. Its chain is edited in NODES; amount, polarity,
        // destination and deletion stay here.
        const bool processed=isOperatorSource(route.source);
        source_.setEnabled(!processed);
        source_.setTooltip(processed ? "Processed in NODES: edit its processing chain on the NODES page" : juce::String());
        if(processed) {
            juce::String label="NODES";
            if(const auto* op=findControlOperator(modulation,operatorIdOf(route.source)))
                if(const auto* info=controlOpInfo(op->type)) {
                    label+=": "+juce::String(info->label);
                    // N06: a multi-output node names the output that drives this row.
                    if(info->outputCount>1) label+=" "+juce::String(controlOutputName(*info,operatorPortOf(route.source)));
                }
            std::array<ModSource,16> roots{};
            const auto count=routeRootSources(modulation,route,roots);
            juce::StringArray names;
            for(std::size_t i=0;i<count;++i)
                for(int item=0;item<source_.getNumItems();++item)
                    if(source_.getItemId(item)==static_cast<int>(roots[i])) names.add(source_.getItemText(item));
            if(!names.isEmpty()) label+="  ("+names.joinIntoString(" + ")+")";
            source_.setText(label,juce::dontSendNotification);
        }
        int selected=0;
        for(std::size_t i=0;i<addresses_.size();++i) {
            const int itemId=static_cast<int>(i+1);
            if(addresses_[i]==route.destination) selected=itemId;
            // Destinations already fed by this source are unavailable.
            auto probe=route;probe.destination=addresses_[i];
            const bool taken=route.source!=ModSource::None && routeDuplicates(modulation,probe);
            destination_.setNativeItemUnavailable(itemId,taken ? "Already routed from "+source_.getText() : juce::String());
        }
        destination_.setSelectedId(selected,juce::dontSendNotification);
        if(!selected) destination_.setText(route.destination.parameter==ModDestination::None
                                           ? "SELECT DESTINATION" : "UNAVAILABLE DESTINATION",juce::dontSendNotification);
        enabled_.setToggleState(route.enabled,juce::dontSendNotification);
        bipolar_.setToggleState(route.bipolar,juce::dontSendNotification);
        enabled_.setButtonText("");
        bipolar_.setButtonText(route.bipolar?"BIPOLAR":"UNIPOLAR");
        if(!amount_.isMouseButtonDown() && !amount_.hasKeyboardFocus(true)) amount_.setValue(route.amount*100.0,juce::dontSendNotification);
    }
    bool destinationAvailable(const ModAddress& address) const {
        for(std::size_t i=0;i<addresses_.size();++i)
            if(addresses_[i]==address) return destination_.isItemEnabled(static_cast<int>(i+1));
        return false;
    }
    juce::String destinationReason(const ModAddress& address) const {
        for(std::size_t i=0;i<addresses_.size();++i)
            if(addresses_[i]==address) return destination_.nativeItemReason(static_cast<int>(i+1));
        return {};
    }
    void resized() override {
        if(compact_) {
            // NODES > MATRIX: one route per card, the same fields stacked.
            auto b=getLocalBounds().reduced(8,6);
            auto top=b.removeFromTop(22);
            top.removeFromLeft(22); // route number
            enabled_.setBounds(top.removeFromLeft(40));top.removeFromLeft(6);
            bipolar_.setBounds(top.removeFromLeft(84));
            remove_.setBounds(top.removeFromRight(24));
            b.removeFromTop(4);source_.setBounds(b.removeFromTop(22));
            b.removeFromTop(3);destination_.setBounds(b.removeFromTop(22));
            b.removeFromTop(3);amount_.setBounds(b.removeFromTop(22));
            b.removeFromTop(4);monitor_.setBounds(b.removeFromTop(24));
            return;
        }
        auto b=getLocalBounds().reduced(10,8);
        b.removeFromLeft(48); // route number / future drag handle
        enabled_.setBounds(b.removeFromLeft(58));b.removeFromLeft(12);
        bipolar_.setBounds(b.removeFromLeft(110));b.removeFromLeft(18);
        source_.setBounds(b.removeFromLeft(220));b.removeFromLeft(18);
        destination_.setBounds(b.removeFromLeft(300));b.removeFromLeft(20);
        remove_.setBounds(b.removeFromRight(42));b.removeFromRight(10);
        monitor_.setBounds(b.removeFromRight(monitorWidth).reduced(0,2));
        b.removeFromRight(14);
        amount_.setBounds(b);
    }
    void paint(juce::Graphics& g) override {
        well(g,getLocalBounds());
        auto numberArea=compact_ ? getLocalBounds().reduced(8,6).removeFromTop(22).removeFromLeft(20)
                                 : getLocalBounds().reduced(10,8).removeFromLeft(38);
        text(g,juce::String(ordinal_),numberArea,11,Palette::secondary(),juce::Justification::centred);
    }
    static constexpr int monitorWidth=132;
private:
    ModRoute route_;ModulationBindings bindings_;std::vector<ModAddress> addresses_;
    ModulationState modulation_{};
    unsigned ordinal_=0;
    bool compact_=false;
    NativeComboBox source_,destination_;
    juce::TextButton enabled_{""},bipolar_{"BIPOLAR"},remove_{""};juce::Slider amount_;
    ModulationRouteMonitor monitor_;
};

// ---------------------------------------------------------------- matrix

ModulationMatrix::ModulationMatrix(ModulationBindings bindings,Layout layout)
    :Panel("MODULATION MATRIX"),bindings_(std::move(bindings)),layout_(layout) {
    addAndMakeVisible(viewport_);viewport_.setViewedComponent(&content_,false);viewport_.setScrollBarsShown(true,false);
    if(layout_==Layout::Sidebar) { viewport_.setScrollBarThickness(8); setName("NODES MATRIX"); }
    addAndMakeVisible(add_);add_.setName("Add modulation route");
    add_.onClick=[this]{if(bindings_.addRoute) bindings_.addRoute();syncFromModel();};
    syncFromModel();
    // Monitors sample the published source slots at UI cadence only.
    startTimerHz(30);
}
ModulationMatrix::~ModulationMatrix(){stopTimer();viewport_.setViewedComponent(nullptr,false);}

juce::Component* ModulationMatrix::routeRow(std::size_t index) const noexcept {
    return index<rows_.size() ? rows_[index].get() : nullptr;
}

const ModulationRouteMonitor* ModulationMatrix::monitor(std::size_t index) const noexcept {
    return index<rows_.size() ? &rows_[index]->monitor() : nullptr;
}

bool ModulationMatrix::destinationAvailable(std::size_t index,const ModAddress& address) const {
    return index<rows_.size() && rows_[index]->destinationAvailable(address);
}

juce::String ModulationMatrix::destinationReason(std::size_t index,const ModAddress& address) const {
    return index<rows_.size() ? rows_[index]->destinationReason(address) : juce::String();
}

void ModulationMatrix::timerCallback() {
    if(isShowing()) sampleMonitors();
}

void ModulationMatrix::sampleMonitors() {
    if(rows_.empty() || !bindings_.visualization) return;
    const auto visual=bindings_.visualization();
    for(auto& row:rows_) {
        const auto& route=row->route();
        const bool active=route.enabled && routeComplete(route);
        row->monitor().push(routeContribution(route,modulation_,visual.routeSources),active);
    }
}

void ModulationMatrix::syncFromModel() {
    if(!bindings_.snapshot) return;const auto state=bindings_.snapshot();
    modulation_=state.modulation;
    std::vector<unsigned> modules,ids;for(const auto& m:state.oscillators) if(m.id) modules.push_back(m.id);
    std::vector<std::pair<ModAddress,std::uint32_t>> dynamicDestinations;
    for(const auto& module:state.oscillators) if(module.id) {
        for(std::size_t i=0;i<module.processCount;++i) if(module.processes[i].id)
            dynamicDestinations.push_back({
                {ModDestination::ProcessAmount,module.id,module.processes[i].id},
                static_cast<std::uint32_t>(module.processes[i].type)});
        for(std::size_t i=0;i<module.routeCount;++i) if(module.routes[i].id)
            dynamicDestinations.push_back({
                {ModDestination::RouteAmount,module.id,module.routes[i].id},
                static_cast<std::uint32_t>(module.routes[i].type)});
    }
    for(const auto& r:state.modulation.routes) if(r.id) ids.push_back(r.id);
    if(bindings_.fxDestinations)
        for(const auto& fx:bindings_.fxDestinations())
            dynamicDestinations.push_back({fx.address,static_cast<std::uint32_t>(std::hash<std::string>{}(fx.group+fx.label))});
    bool rebuild=modules!=moduleIds_ || ids.size()!=rows_.size() ||
                 dynamicDestinations!=dynamicDestinations_ ||
                 envMask_!=state.modulation.envActiveMask ||
                 lfoMask_!=state.modulation.lfoActiveMask ||
                 generatorMask_!=state.modulation.generatorActiveMask ||
                 filterEnabled_!=state.modulation.filterEnabled;
    for(std::size_t i=0;!rebuild && i<ids.size();++i) rebuild=rows_[i]->id()!=ids[i];
    if(rebuild) {
        moduleIds_=modules;
        dynamicDestinations_=std::move(dynamicDestinations);
        envMask_=state.modulation.envActiveMask;
        lfoMask_=state.modulation.lfoActiveMask;
        generatorMask_=state.modulation.generatorActiveMask;
        filterEnabled_=state.modulation.filterEnabled;
        rows_.clear();
        for(const auto& route:state.modulation.routes) if(route.id) {
            auto row=std::make_unique<Row>(route,state,bindings_,static_cast<unsigned>(rows_.size()+1),layout_==Layout::Sidebar);content_.addAndMakeVisible(*row);rows_.push_back(std::move(row));
        }
        resized();
    } else for(std::size_t i=0;i<rows_.size();++i) rows_[i]->sync(state.modulation.routes[i],state.modulation);
    add_.setEnabled(rows_.size()<ModulationState::capacity);repaint();
}
juce::Rectangle<int> ModulationMatrix::listBounds() const {
    if(layout_==Layout::Sidebar) return getLocalBounds().withTrimmedTop(34);
    auto b=contentBounds();b.removeFromTop(36);return b;
}

void ModulationMatrix::paint(juce::Graphics& g) {
    if(layout_==Layout::Page) { Panel::paint(g); return; }
    // Sidebar: hosted inside the NODES sidebar, which owns the chrome.
    if(rows_.empty())
        text(g,"No modulation routes. Add a route, then choose its source and destination.",
             listBounds().reduced(8,12).withHeight(60),9.5f,Palette::muted(),juce::Justification::centredTop);
}

void ModulationMatrix::resized() {
    if(layout_==Layout::Sidebar) add_.setBounds(getLocalBounds().removeFromTop(28).reduced(0,2));
    else add_.setBounds(getWidth()-155,5,143,23);
    viewport_.setBounds(listBounds());
    const int width=juce::jmax(0,viewport_.getWidth()-(layout_==Layout::Sidebar ? 10 : 14));
    const int height=layout_==Layout::Sidebar ? sidebarRowHeight : pageRowHeight;
    int y=0;
    for(auto& row:rows_) {row->setBounds(0,y,width,height);y+=height+4;}
    content_.setSize(width,juce::jmax(y,viewport_.getHeight()));
}
void ModulationMatrix::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    auto header=body.removeFromTop(28);
    const auto colour=Palette::secondary();
    const int y=header.getY(),h=header.getHeight();
    int x=header.getX()+10;

    text(g,"#",{x,y,38,h},11,colour,juce::Justification::centred);
    x+=48;
    text(g,"ON",{x,y,58,h},11,colour,juce::Justification::centredLeft);
    x+=70;
    text(g,"POLARITY",{x,y,110,h},11,colour,juce::Justification::centredLeft);
    x+=128;
    text(g,"SOURCE",{x,y,220,h},11,colour,juce::Justification::centredLeft);
    x+=238;
    text(g,"DESTINATION",{x,y,300,h},11,colour,juce::Justification::centredLeft);
    x+=320;

    const int deleteX=header.getRight()-10-42;
    const int monitorX=deleteX-10-Row::monitorWidth;
    const int amountRight=monitorX-14;
    text(g,"AMOUNT",{x,y,juce::jmax(0,amountRight-x),h},11,colour,juce::Justification::centredLeft);
    text(g,"MONITOR",{monitorX,y,Row::monitorWidth,h},11,colour,juce::Justification::centredLeft);

    if(rows_.empty()) text(g,"No modulation routes. Add a route, then choose its source and destination.",body.reduced(12),12,Palette::muted(),juce::Justification::centred);
}
}
