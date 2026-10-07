// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-page-foundation-p01
// mct-origami-deep-audit-p02-lockfree-ui-midi
// mct-origami-v32.2.1-scroll-drag-matrix-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-v26.3.1-postcommit-compile-repair
// mct-origami-v26.3.1-bend-bipolar-global-knob-shortcuts
// mct-origami-v25.3.0-arp-performance-expansion
// mct-origami-v25.2.0-arp-ux-visual-architecture
// mct-origami-v25.1.0-arp-advanced-page
// mct-origami-v25.0.0-arp-internal-clock
// mct-origami-modulation-completion-v24.0.1
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-playable-keyboard-audio-v23.1
// mct-origami-v21-build-repair-2
#include "PluginEditor.h"
#include "PluginProcessor.h"
#include "ui/NativeChoiceMenu.h"
#include "core/preset/StateCodec.h"
#include "ui/ModulationDestinations.h"
#include "ui/ModulationUiTelemetry.h"
#include <cmath>
#include <cstring>
using namespace mct::origami::ui;
namespace {
// `routesChanged` fires after every successful route/modulation mutation, from
// whichever view made it, so every view of the one ModulationState can follow.
ModulationBindings modulationBindings(OrigamiAudioProcessor& owner,std::function<void()> routesChanged) {
    const auto notify=[routesChanged](bool ok){ if(ok && routesChanged) routesChanged(); return ok; };
    return {[&owner]{return owner.getUiInstrumentState();},
        [&owner](unsigned i,float v){return owner.setUiMacro(i,v);},
        [&owner](const mct::origami::LfoSettings& s){return owner.setUiLfo(s);},
        [&owner,routesChanged]{const auto id=owner.addUiRoute(); if(id!=0 && routesChanged) routesChanged(); return id;},
        [&owner,notify](const mct::origami::ModRoute& r){return notify(owner.setUiRoute(r));},
        [&owner,notify](unsigned id){return notify(owner.removeUiRoute(id));},
        [&owner,notify](const mct::origami::ModulationState& s){return notify(owner.setUiModulationState(s));},
        [&owner]{return owner.getUiEnvelopeTraceSnapshot();},
        [&owner]{return owner.getUiPerformanceInputSnapshot();},
        [&owner]{return owner.getUiHostBpm();},
        [&owner]{return owner.getUiRuntimeVisualizationSnapshot();},
        [&owner]{return owner.getUiVisualizationMask();},
        // FX parameters as destinations of the one modulation system.
        [&owner] {
            std::vector<mct::origami::ui::FxModulationDestination> out;
            const auto state=owner.getUiInstrumentState();
            for(const auto bus:owner.getUiFxWorkspace().buses()) {
                const auto* doc=owner.getUiFxWorkspace().find(bus);
                const auto* info=state.buses.find(bus);
                const std::string busLabel=info!=nullptr ? info->label() : "BUS";
                for(const auto& node:doc->graph().nodes()) {
                    if(node.kind!=mct::origami::fx::FxNodeKind::Effect) continue;
                    const auto* d=mct::origami::fx::findFxEffect(node.effect);
                    if(d==nullptr) continue;
                    for(std::size_t i=0;i<d->parameterCount;++i) {
                        if(d->parameters[i].curve==mct::origami::fx::FxParameterCurve::Choice) continue;
                        out.push_back({mct::origami::fxParameterAddress(bus,node.id,d->parameters[i].id),
                                       "NODES / "+busLabel+" / "+node.name+" "+std::to_string(node.id),d->parameters[i].label});
                    }
                }
            }
            return out;
        },
        [&owner]{return owner.getUiModelRevision();},
        [&owner]{return owner.getUiNodesDiagnostics();},
        [&owner](unsigned index,bool begin){ if(begin) owner.beginUiMacroGesture(index); else owner.endUiMacroGesture(index); },
        [&owner,routesChanged](unsigned index,const juce::String& name){ const bool ok=owner.setUiMacroName(index,name); if(ok && routesChanged) routesChanged(); return ok; }};
}
}
OrigamiAudioProcessorEditor::OrigamiAudioProcessorEditor(OrigamiAudioProcessor& owner)
    : AudioProcessorEditor(&owner), dragBindings_(modulationBindings(owner,[this]{modulationRoutesChanged();})), processor_(owner),
      oscillators_(
          [&owner](mct::origami::ParameterId id,float value) { return owner.setUiParameter(id,value); },
          [&owner](mct::origami::ParameterId id) { return owner.getUiParameter(id); },
          [&owner]() -> unsigned { return owner.addUiOscillator(); },
          [&owner](unsigned id) -> bool { return owner.removeUiOscillator(id); },
          [&owner](unsigned id,const mct::origami::OscillatorModuleState& state) -> bool { return owner.setUiOscillatorState(id,state); },
          [&owner](unsigned id) -> mct::origami::OscillatorModuleState { return owner.getUiOscillatorState(id); },
          [&owner](unsigned id,bool enabled) -> bool { return owner.setUiOscillatorEnabled(id,enabled); },
          [&owner](unsigned id) -> bool { return owner.getUiOscillatorEnabled(id); },
          [&owner] { return owner.getUiInstrumentState(); },
          [&owner] { return owner.getUiOscillatorRevision(); }),
      filter_([&owner](auto id,float v){return owner.setUiParameter(id,v);},
              [&owner](auto id){return owner.getUiParameter(id);},
              modulationBindings(owner,[this]{modulationRoutesChanged();})),
      modulation_([&owner](auto id,float v){return owner.setUiParameter(id,v);},[&owner](auto id){return owner.getUiParameter(id);},modulationBindings(owner,[this]{modulationRoutesChanged();})),
      macros_(modulationBindings(owner,[this]{modulationRoutesChanged();})),matrix_(modulationBindings(owner,[this]{modulationRoutesChanged();})),
      performance_([&owner](int note,bool on,float velocity){return owner.enqueueUiKeyboardNote(note,on,velocity);},
          [&owner](float v){owner.setUiPitchWheel(v);},
          [&owner](float v){owner.setUiModWheel(v);},
          [&owner](float up,float down){return owner.setUiPitchBendRanges(up,down);},
          [&owner]{return std::pair<float,float>{owner.getUiPitchBendRange(),owner.getUiPitchBendDownRange()};},
          [&owner](const mct::origami::PerformanceState& p){return owner.setUiPerformanceState(p);},
          [&owner]{return owner.getUiPerformanceState();},
          [&owner](const mct::origami::ArpeggiatorState& a){return owner.setUiArpeggiatorState(a);},
          [&owner]{return owner.getUiArpeggiatorState();}),
      arpeggiator_(
          [&owner](const mct::origami::ArpeggiatorState& a){return owner.setUiArpeggiatorState(a);},
          [&owner]{return owner.getUiArpeggiatorState();},
          [&owner]{return owner.getUiArpeggiatorRuntimeSnapshot();},
          [&owner]{owner.clearUiArpeggiatorLatch();}),
      global_([&owner]{return owner.getUiVisualizationMask();},
              [&owner](std::uint32_t mask){owner.setUiVisualizationMask(mask);}),
      fxPage_(owner.getUiFxWorkspace(),modulationBindings(owner,[this]{modulationRoutesChanged();}),
              mct::origami::ui::FxPageHost{[&owner]{return owner.consumeUiFxPeaks();},
                                            [&owner]{return owner.addUiBus();},
                                            [&owner](mct::origami::BusId id){return owner.removeUiBus(id);},
                                            &owner.getUiFxViewState(),
                                            &owner.getUiControlLayout(),
                                            [&owner](mct::origami::BusId bus){return owner.consumeUiFxInputPeaks(bus);},
                                            [&owner](mct::origami::BusId bus,mct::origami::fx::FxNodeId node){return owner.consumeUiFxNodeTelemetry(bus,node);}}),
      globalFx_(std::make_unique<mct::origami::ui::FxGlobalFxEditor>(owner.getUiFxWorkspace())) {
    setLookAndFeel(&theme_);
    const std::array<juce::Component*,13> components{{&header_,&oscillators_,&mixer_,&filter_,&fxPre_,&fxPost_,&modulation_,&macros_,&performance_,&matrix_,&arpeggiator_,&global_,&fxPage_}};
    for(auto* component:components) addAndMakeVisible(component);
    addChildComponent(wavetableEditor_);
    wavetableEditor_.onClose=[this]{closeWavetableEditor();};
    oscillators_.onWavetableEditorRequested=[this](unsigned oscillatorId) {
        openWavetableEditor(oscillatorId);
    };
    // mct-origami-fixed-ratio-zoom-v1
    // Resize behaves as whole-interface zoom: the editor is constrained to one
    // canonical 16:10 canvas and every child is scaled from that same design space.
    addChildComponent(globalOverlay_);
    globalFx_->onClose=[this]{globalOverlay_.dismiss();};
    header_.onGlobalFxRequested=[this]{openGlobalFx();};
    // mct-origami-content-browser
    {
        using mct::origami::content::ContentType;
        mct::origami::ui::ContentBrowser::Host host;
        host.loadedPresetId=[this]{ return processor_.getUiCurrentPreset().id; };
        host.loadedWavetableId=[this](unsigned id)->juce::String {
            const auto source=processor_.getUiOscillatorWavetable(id);
            if(!source.data) return mct::origami::content::ContentLibrary::basicShapesId;
            return source.contentId.isNotEmpty() ? source.contentId : juce::String("custom");
        };
        host.loadPreset=[this](const mct::origami::content::ContentRecord& r){ return loadPresetRecord(r); };
        host.loadWavetable=[this](const mct::origami::content::ContentRecord& r,unsigned id){ return loadWavetableRecord(r,id); };
        host.importWavetable=[this](unsigned id){ beginWavetableImport(id); };
        host.oscillatorLabel=[this](unsigned id){ return oscillatorLabel(id); };
        host.close=[this]{ closeContentBrowser(); };
        browser_=std::make_unique<mct::origami::ui::ContentBrowser>(library_->library,std::move(host));
        addChildComponent(*browser_);
        saveDialog_=std::make_unique<mct::origami::ui::PresetSaveDialog>();
        saveDialog_->onCancel=[this]{ globalOverlay_.dismiss(); };
        saveDialog_->onSave=[this](const mct::origami::ui::PresetSaveDialog::Fields& f,bool replace) {
            const auto result=savePreset(f,replace);
            if(result.wasOk()) globalOverlay_.dismiss();
            else juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon,"SAVE PRESET",result.getErrorMessage());
        };
        header_.onPresetBrowserRequested=[this]{ if(browserOpen_ && browser_->mode()==ContentType::Preset) closeContentBrowser(); else openContentBrowser(ContentType::Preset); };
        header_.onPresetStep=[this](int step){ stepPreset(step); };
        header_.onSaveRequested=[this]{ showPresetSaveDialog(); };
        header_.onInitRequested=[this]{ if(processor_.loadUiInitPreset()) { library_->library.markUsed(ContentType::Preset,mct::origami::content::ContentLibrary::initPresetId); contentLoaded(); } };
        using Action=mct::origami::ui::OscillatorCard::WavetableAction;
        oscillators_.onWavetableAction=[this](unsigned id,Action action) {
            if(action==Action::Browse) openContentBrowser(ContentType::Wavetable,id);
            if(action==Action::Import) beginWavetableImport(id);
            if(action==Action::Export) beginWavetableExport(id);
            if(action==Action::Previous) stepWavetable(id,-1);
            if(action==Action::Next) stepWavetable(id,1);
        };
        oscillators_.wavetableData=[this](unsigned id){ return processor_.getUiOscillatorWavetable(id).data; };
        oscillators_.wavetableName=[this](unsigned id)->juce::String {
            const auto source=processor_.getUiOscillatorWavetable(id);
            return source.data ? source.data->name : juce::String("BASIC SHAPES");
        };
        wavetableEditor_.onImportFile=[this](const juce::File& file,mct::origami::content::WavetableData& data,juce::String& status) {
            mct::origami::content::ContentRecord record; bool duplicate=false;
            const auto result=library_->library.importWavetable(file,record,duplicate);
            if(result.failed()) { status="Import failed: "+result.getErrorMessage(); return false; }
            if(!library_->library.loadWavetable(record,data)) { status="Import failed: unreadable library copy"; return false; }
            status=duplicate ? "Already in the library: "+record.name : "Imported "+file.getFileName()+" into the library";
            return true;
        };
        header_.setPresetName(processor_.getUiCurrentPreset().name);
    }
    fxPage_.onOpenSynthFilter=[this]{header_.selectMode(0);};
    header_.onModeSelected=[this](int mode){
        currentPage_=mode;
        fxSelected_=mode==2;
        matrixSelected_=mode==3;
        globalSelected_=mode==4;
        arpSelected_=false;
        if(globalSelected_) global_.syncFromModel();
        if(fxSelected_) fxPage_.syncFromModel();
        resized();
    };
    performance_.onArpSettingsRequested=[this]{
        arpSelected_=!arpSelected_;
        if(arpSelected_) {
            matrixSelected_=false;
            globalSelected_=false;
            fxSelected_=false;
            header_.selectSynth();
            arpeggiator_.syncFromModel();
        }
        resized();
    };
    // Children configured their text boxes before they were attached to this
    // editor's look-and-feel; re-send it so every slider value box and label
    // uses Origami typography (not JUCE's 15 px default font).
    sendLookAndFeelChange();
    startTimerHz(15);
    setResizable(true,true);
    setResizeLimits(EditorLayout::minWidth,EditorLayout::minHeight,EditorLayout::maxWidth,EditorLayout::maxHeight);
    if (auto* constrainer=getConstrainer())
        constrainer->setFixedAspectRatio(EditorLayout::aspectRatio);
    setSize(EditorLayout::defaultWidth,EditorLayout::defaultHeight);

    // Global knob interaction policy. Register as a recursive mouse listener so
    // every current and future rotary Slider in the editor gets the same UX.
    addMouseListener(this,true);
    registerKnobDefaults(*this);
}
OrigamiAudioProcessorEditor::~OrigamiAudioProcessorEditor() {
    removeMouseListener(this);
    stopTimer();
    setLookAndFeel(nullptr);
}
bool OrigamiAudioProcessorEditor::decodeDraggedModSource(
    const juce::var& description,mct::origami::ModSource& source) noexcept {
    const auto text=description.toString();
    constexpr auto prefix="MCT_MOD_SOURCE:";
    if(!text.startsWith(prefix)) return false;
    const int raw=text.substring(static_cast<int>(std::strlen(prefix))).getIntValue();
    source=static_cast<mct::origami::ModSource>(raw);
    return raw>0;
}

juce::Slider* OrigamiAudioProcessorEditor::modulationDropTargetAt(
    juce::Point<int> point) const noexcept {
    juce::Component* component=const_cast<OrigamiAudioProcessorEditor*>(this)->getComponentAt(point);
    while(component!=nullptr && component!=this) {
        if(auto* slider=dynamic_cast<juce::Slider*>(component)) {
            if(slider->getProperties().contains("mct.mod.destination"))
                return slider;
        }
        component=component->getParentComponent();
    }
    return nullptr;
}

std::uint32_t OrigamiAudioProcessorEditor::knobDepthRoute(const juce::Slider& slider) const {
    if(!dragBindings_.snapshot) return 0;
    const auto& p=slider.getProperties();
    const mct::origami::ModAddress address{
        static_cast<mct::origami::ModDestination>(static_cast<int>(p["mct.mod.destination"])),
        p.contains("mct.mod.oscillator") ? static_cast<unsigned>(static_cast<int>(p["mct.mod.oscillator"])) : 0u,
        p.contains("mct.mod.itemId") ? static_cast<std::uint32_t>(static_cast<int>(p["mct.mod.itemId"])) : 0u};
    // The ring shows the selected source's route when it has one, otherwise
    // every route: the first (Matrix order) is the one the ring stands for.
    const auto state=dragBindings_.snapshot();
    const auto selected=mct::origami::ui::modulationUiTelemetry().selectedSource;
    std::uint32_t first=0;
    for(const auto& r:state.modulation.routes) {
        if(!r.id || !r.enabled || !(r.destination==address)) continue;
        if(r.source==selected) return r.id;
        if(!first) first=r.id;
    }
    return first;
}

OrigamiAudioProcessorEditor::ModulationDropTarget OrigamiAudioProcessorEditor::modulationDropAt(juce::Point<int> point) const {
    ModulationDropTarget out;
    juce::Component* component=const_cast<OrigamiAudioProcessorEditor*>(this)->getComponentAt(point);
    while(component!=nullptr && component!=this) {
        if(auto* row=dynamic_cast<mct::origami::ui::ModulationSourceRow*>(component)) {
            if(const auto route=row->routeAt(row->getLocalPoint(this,point).toFloat())) { out.ring=row; out.depthRoute=route; }
            return out;
        }
        if(auto* slider=dynamic_cast<juce::Slider*>(component))
            if(slider->getProperties().contains("mct.mod.destination")) {
                out.slider=slider;
                if(slider->isRotary()) {
                    // Outside 62 % of the radius: the modulation ring (Y).
                    const auto b=slider->getLocalBounds().toFloat();
                    const float radius=0.5f*juce::jmin(b.getWidth(),b.getHeight());
                    if(slider->getLocalPoint(this,point).toFloat().getDistanceFrom(b.getCentre())>=0.62f*radius)
                        out.depthRoute=knobDepthRoute(*slider);
                }
                return out;
            }
        component=component->getParentComponent();
    }
    return out;
}

bool OrigamiAudioProcessorEditor::isInterestedInDragSource(const SourceDetails& details) {
    mct::origami::ModSource source{};
    // FILTER 1 drags are accepted only so a deliberate tab hover can carry
    // them from SYNTH to the FX graph; dropping them here does nothing.
    return decodeDraggedModSource(details.description,source)
        || details.description.toString().startsWith("MCT_SYNTH_FILTER:");
}

void OrigamiAudioProcessorEditor::itemDragEnter(const SourceDetails& details) {
    mct::origami::ModSource source{};
    if(decodeDraggedModSource(details.description,source) && !modulationDrag_.active) beginModulationDrag(source);
    itemDragMove(details);
}

void OrigamiAudioProcessorEditor::itemDragMove(const SourceDetails& details) {
    mct::origami::ModSource source{};
    const bool modulator=decodeDraggedModSource(details.description,source);
    if(!modulationDrag_.active) beginModulationDrag(modulator ? source : mct::origami::ModSource::Env1);
    updateModulationDragHover(details.localPosition.toInt(),juce::Time::getMillisecondCounterHiRes());
    if(!modulator) return;
    modulation_.revealSourceAtParentPoint(details.localPosition.toInt());
    // Keep the JUCE drag alive while source tabs also act as navigation targets.
    modulation_.revealSourceAtParentPoint(details.localPosition);
    const auto target=modulationDropAt(details.localPosition);
    if(target.slider!=dragPreviewTarget_.getComponent() || target.ring!=dragPreviewRing_.getComponent()
       || target.depthRoute!=dragPreviewDepthRoute_ || source!=dragPreviewSource_) {
        dragPreviewTarget_=target.slider;
        dragPreviewRing_=target.ring;
        dragPreviewDepthRoute_=target.depthRoute;
        dragPreviewSource_=source;
        repaint();
    }
}

void OrigamiAudioProcessorEditor::itemDragExit(const SourceDetails&) {
    endModulationDrag();
    dragPreviewTarget_=nullptr;
    dragPreviewRing_=nullptr;
    dragPreviewDepthRoute_=0;
    repaint();
}

bool OrigamiAudioProcessorEditor::createDraggedRoute(
    mct::origami::ModSource source,juce::Slider& target) {
    const int destinationRaw=static_cast<int>(
        target.getProperties()["mct.mod.destination"]);
    const int oscillatorRaw=target.getProperties().contains("mct.mod.oscillator")
        ? static_cast<int>(target.getProperties()["mct.mod.oscillator"]) : 0;
    const auto itemId=target.getProperties().contains("mct.mod.itemId")
        ? static_cast<std::uint32_t>(static_cast<int>(target.getProperties()["mct.mod.itemId"])) : 0u;
    return createRouteTo(source,{static_cast<mct::origami::ModDestination>(destinationRaw),static_cast<unsigned>(oscillatorRaw),itemId});
}

bool OrigamiAudioProcessorEditor::createRouteTo(
    mct::origami::ModSource source,const mct::origami::ModAddress& address) {
    if(!dragBindings_.addRoute || !dragBindings_.snapshot || !dragBindings_.route)
        return false;

    const auto stateBefore=dragBindings_.snapshot();

    // If this exact source -> destination edge already exists, select/update it
    // rather than creating duplicate Matrix rows.
    for(const auto& existing:stateBefore.modulation.routes) {
        if(existing.id!=0 && existing.source==source && existing.destination==address) {
            auto route=existing;
            route.enabled=true;
            route.bipolar=false;
            route.amount=dragPreviewAmount_;
            return dragBindings_.route(route);
        }
    }

    mct::origami::ModRoute candidate;
    candidate.source=source;
    candidate.destination=address;
    candidate.enabled=true;
    candidate.bipolar=(source>=mct::origami::ModSource::Lfo1
                       && source<=mct::origami::ModSource::Lfo4);
    candidate.amount=dragPreviewAmount_;
    // mct-origami-nested-modulation-manual-qa: a nested drop that would close
    // a feedback loop (MACRO 1 onto MACRO 1, LFO 1 onto its own RATE...) is
    // rejected before anything is created.
    if(mct::origami::routeClosesCycle(stateBefore.modulation,candidate)) return false;

    const unsigned id=dragBindings_.addRoute();
    if(id==0) return false;
    candidate.id=id;
    if(dragBindings_.route(candidate)) return true;
    // Never leave an empty Matrix row behind a rejected drop.
    if(dragBindings_.removeRoute) dragBindings_.removeRoute(id);
    return false;
}

void OrigamiAudioProcessorEditor::itemDropped(const SourceDetails& details) {
    mct::origami::ModSource source{};
    const auto target=modulationDropAt(details.localPosition);
    if(decodeDraggedModSource(details.description,source)) {
        if(target.depthRoute) createRouteTo(source,mct::origami::routeDepthAddress(target.depthRoute)); // Y
        else if(target.slider!=nullptr) createDraggedRoute(source,*target.slider);                      // X
    }
    dragPreviewTarget_=nullptr;
    dragPreviewRing_=nullptr;
    dragPreviewDepthRoute_=0;
    endModulationDrag();
    refreshModulationViews();
    repaint();
}

void OrigamiAudioProcessorEditor::modulationRoutesChanged() {
    triggerAsyncUpdate();
}

namespace {
// What the modulation views render from: which sources exist and their routes.
bool sameModulationView(const mct::origami::ModulationState& a,const mct::origami::ModulationState& b) noexcept {
    if(a.envActiveMask!=b.envActiveMask || a.lfoActiveMask!=b.lfoActiveMask
       || a.generatorActiveMask!=b.generatorActiveMask || a.performanceSourceActiveMask!=b.performanceSourceActiveMask)
        return false;
    for(std::size_t i=0;i<a.routes.size();++i) {
        const auto& x=a.routes[i];
        const auto& y=b.routes[i];
        if(x.id!=y.id || x.enabled!=y.enabled || x.source!=y.source || !(x.destination==y.destination)
           || x.amount!=y.amount || x.bipolar!=y.bipolar)
            return false;
    }
    return true;
}
}

void OrigamiAudioProcessorEditor::handleAsyncUpdate() {
    // Envelope/LFO edits also go through the bindings; only a change to what
    // the modulation views show is worth a refresh.
    if(sameModulationView(processor_.getUiInstrumentState().modulation,lastModulationView_)) return;
    refreshModulationViews();
}

void OrigamiAudioProcessorEditor::refreshModulationViews() {
    cancelPendingUpdate();
    lastModulationView_=processor_.getUiInstrumentState().modulation;
    modulation_.syncFromModel();
    matrix_.syncFromModel();
    fxPage_.modelChanged(); // no visual work while NODES is hidden
}

void OrigamiAudioProcessorEditor::paintOverChildren(juce::Graphics& g) {
    auto* slider=dragPreviewTarget_.getComponent();
    auto* ring=dragPreviewRing_.getComponent();
    if(slider==nullptr && ring==nullptr) return;
    namespace ui=mct::origami::ui;

    // Y: the drop targets the DEPTH of an existing route. Its ring is
    // outlined and the route is named ("Y · DEPTH OF LFO 2 → OSC 2 LEVEL").
    if(dragPreviewDepthRoute_!=0 && dragBindings_.snapshot) {
        const auto state=dragBindings_.snapshot();
        mct::origami::ModRoute probe;
        probe.source=dragPreviewSource_;
        probe.destination=mct::origami::routeDepthAddress(dragPreviewDepthRoute_);
        const bool loop=mct::origami::routeClosesCycle(state.modulation,probe);
        juce::String target;
        const auto catalog=ui::modulationDestinationCatalog(state,dragBindings_);
        for(const auto& r:state.modulation.routes)
            if(r.id==dragPreviewDepthRoute_) target=ui::modulationRouteLabel(catalog,state.modulation,r);
        juce::Rectangle<float> hit;
        if(auto* row=dynamic_cast<ui::ModulationSourceRow*>(ring)) {
            for(std::size_t k=0;k<row->routes().size() && k<row->visibleRings();++k)
                if(row->routes()[k].id==dragPreviewDepthRoute_) hit=getLocalArea(row,row->ringBounds(k)).expanded(3.0f);
        } else if(slider!=nullptr) {
            const auto b=getLocalArea(slider,slider->getLocalBounds()).toFloat();
            const float d=juce::jmin(b.getWidth(),b.getHeight())+6.0f;
            hit=juce::Rectangle<float>(d,d).withCentre(b.getCentre());
        }
        g.setColour(loop ? ui::Palette::muted() : ui::signalSourceColour().withAlpha(.94f));
        if(!hit.isEmpty()) g.drawEllipse(hit,2.4f);
        const auto dot=juce::String(juce::CharPointer_UTF8(" \xc2\xb7 "));
        ui::paintModulationRouteTooltip(g,loop ? "Y"+dot+"DEPTH: FEEDBACK LOOP, NOT ALLOWED" : "Y"+dot+"DEPTH OF "+target,
                                        hit.getCentre(),getLocalBounds().toFloat());
        return;
    }
    if(slider==nullptr) return;

    const auto b=getLocalArea(slider,slider->getLocalBounds()).toFloat();
    auto colour=mct::origami::ui::signalSourceColour().withAlpha(.94f);

    if(slider->isRotary()) {
        auto circle=b.reduced(1.0f).expanded(3.0f);
        const float d=juce::jmin(circle.getWidth(),circle.getHeight());
        circle=juce::Rectangle<float>(d,d).withCentre(circle.getCentre());
        const float start=juce::MathConstants<float>::pi*1.20f;
        const float end=juce::MathConstants<float>::pi*2.80f;
        const float base=static_cast<float>(
            (slider->getValue()-slider->getMinimum())/
            juce::jmax(1.0e-9,slider->getMaximum()-slider->getMinimum()));
        const float lo=juce::jlimit(0.0f,1.0f,base-dragPreviewAmount_);
        const float hi=juce::jlimit(0.0f,1.0f,base+dragPreviewAmount_);
        juce::Path arc;
        arc.addCentredArc(circle.getCentreX(),circle.getCentreY(),
                          circle.getWidth()*.51f,circle.getHeight()*.51f,0.0f,
                          start+lo*(end-start),start+hi*(end-start),true);
        g.setColour(colour);
        g.strokePath(arc,juce::PathStrokeType(2.4f));
    } else {
        auto line=b.reduced(3.0f);
        const float base=static_cast<float>(
            (slider->getValue()-slider->getMinimum())/
            juce::jmax(1.0e-9,slider->getMaximum()-slider->getMinimum()));
        const float x0=line.getX()+line.getWidth()*juce::jlimit(0.0f,1.0f,base-dragPreviewAmount_);
        const float x1=line.getX()+line.getWidth()*juce::jlimit(0.0f,1.0f,base+dragPreviewAmount_);
        g.setColour(colour);
        g.drawLine(x0,line.getBottom()+1.0f,x1,line.getBottom()+1.0f,2.4f);
    }

    g.setColour(juce::Colours::white.withAlpha(.95f));
    g.drawRoundedRectangle(b.expanded(3.0f),4.0f,1.0f);
    // X: the parameter. A knob that already carries a route also offers its
    // ring as the Y (depth) target.
    if(slider->isRotary() && knobDepthRoute(*slider)!=0) {
        const auto dot=juce::String(juce::CharPointer_UTF8(" \xc2\xb7 "));
        ui::paintModulationRouteTooltip(g,"X"+dot+"PARAMETER   RING: Y"+dot+"DEPTH",b.getCentre(),getLocalBounds().toFloat());
    }
}

void OrigamiAudioProcessorEditor::timerCallback() {
    // Dynamic oscillator cards can introduce new knobs after editor creation.
    // Register them lazily without disturbing existing defaults.
    registerKnobDefaults(*this);

    modulation_.syncFromModel();macros_.syncFromModel();matrix_.syncFromModel();filter_.syncFromModel();
    performance_.syncArpFromModel();
    header_.setPresetName(processor_.getUiCurrentPreset().name); // a host restore may change it
    if(arpSelected_) arpeggiator_.syncFromModel();
    if(globalSelected_) global_.syncFromModel();
    if(fxSelected_) fxPage_.syncFromModel();
    // A held drag over a page tab produces no move events: poll the hover.
    if(modulationDrag_.active) updateModulationDragHover(modulationDrag_.lastPosition,juce::Time::getMillisecondCounterHiRes());
    if(globalOverlay_.isShowing()) globalFx_->sync();
}

juce::Slider* OrigamiAudioProcessorEditor::sliderFromMouseEvent(const juce::MouseEvent& event) noexcept {
    juce::Component* component=event.originalComponent;
    while(component!=nullptr) {
        if(auto* slider=dynamic_cast<juce::Slider*>(component))
            return slider;
        component=component->getParentComponent();
    }
    return nullptr;
}

bool OrigamiAudioProcessorEditor::isKnob(const juce::Slider& slider) noexcept {
    return slider.isRotary();
}

double OrigamiAudioProcessorEditor::defaultForKnob(juce::Slider& slider) const noexcept {
    const auto name=slider.getName().toLowerCase();

    // PAN is a hard canonical centre default. Resolve this BEFORE inspecting
    // any legacy per-control JUCE double-click default so a stale constructed
    // value can never become the global Shift+click reset point.
    if(name.contains("pan")) return 0.0;

    // Preserve any other control-specific default already declared by the UI.
    if(slider.isDoubleClickReturnEnabled())
        return slider.getDoubleClickReturnValue();

    // Engine-backed canonical defaults.
    if(name.contains("wt pos")) return 1.0/3.0;
    if(name.contains("unison")) return 1.0;
    if(name.contains("detune")) return 12.0;
    if(name.contains("pan")) return 0.0;
    if(name.contains("level")) return 0.7;
    if(name.contains("cutoff")) return 8000.0;
    if(name.contains("resonance")) return 0.1;
    if(name.contains("attack")) return 0.01;
    if(name.contains("decay")) return 0.15;
    if(name.contains("sustain")) return 0.7;
    if(name.contains("release")) return 0.25;
    if(name.contains("macro")) return 0.0;
    if(name.contains("route amount")) return 0.0;
    if(name.contains("glide")) return 0.0;

    // OSC PROCESS magnitude is always neutral at 0, whether its selected type
    // is unipolar or bipolar.
    if(name.contains("osc process")) return 0.0;

    // Unknown future knob: capture its construction-time value as its default.
    return slider.getValue();
}

void OrigamiAudioProcessorEditor::registerKnobDefaults(juce::Component& root) {
    if(auto* slider=dynamic_cast<juce::Slider*>(&root); slider!=nullptr && isKnob(*slider)) {
        auto& props=slider->getProperties();
        if(!props.contains("mct.origami.knobDefault")) {
            props.set("mct.origami.knobDefault",defaultForKnob(*slider));

            // Double-click is reserved globally for typed entry. Disable JUCE's
            // native double-click-reset after preserving its declared default.
            slider->setDoubleClickReturnValue(false,defaultForKnob(*slider),
                                               juce::ModifierKeys::noModifiers);
        }
    }

    for(auto* child:root.getChildren())
        if(child!=nullptr)
            registerKnobDefaults(*child);
}

void OrigamiAudioProcessorEditor::mouseDown(const juce::MouseEvent& event) {
    auto* slider=sliderFromMouseEvent(event);
    if(slider==nullptr || !isKnob(*slider))
        return;

    if(event.mods.isPopupMenu()) {
        openKnobProperties(*slider);
        return;
    }

    if(!event.mods.isShiftDown()) return;

    auto& props=slider->getProperties();
    if(!props.contains("mct.origami.knobDefault"))
        registerKnobDefaults(*slider);

    const double reset=static_cast<double>(props["mct.origami.knobDefault"]);
    slider->setValue(juce::jlimit(slider->getMinimum(),slider->getMaximum(),reset),
                     juce::sendNotificationSync);
}

void OrigamiAudioProcessorEditor::mouseDoubleClick(const juce::MouseEvent& event) {
    auto* slider=sliderFromMouseEvent(event);
    if(slider==nullptr || !isKnob(*slider))
        return;
    openKnobValueEditor(*slider);
}

void OrigamiAudioProcessorEditor::openKnobProperties(juce::Slider& slider) {
    if(!slider.getProperties().contains("mct.mod.destination") || !dragBindings_.snapshot)
        return;

    const auto destination=static_cast<mct::origami::ModDestination>(
        static_cast<int>(slider.getProperties()["mct.mod.destination"]));
    const unsigned oscillator=slider.getProperties().contains("mct.mod.oscillator")
        ? static_cast<unsigned>(static_cast<int>(slider.getProperties()["mct.mod.oscillator"])) : 0u;
    const auto itemId=slider.getProperties().contains("mct.mod.itemId")
        ? static_cast<std::uint32_t>(static_cast<int>(slider.getProperties()["mct.mod.itemId"])) : 0u;

    const auto state=dragBindings_.snapshot();
    std::vector<mct::origami::ModRoute> matches;
    for(const auto& route:state.modulation.routes) {
        if(route.id!=0 && route.enabled &&
           route.destination.parameter==destination &&
           route.destination.oscillator==oscillator &&
           route.destination.itemId==itemId)
            matches.push_back(route);
    }

    auto sourceName=[&state](mct::origami::ModSource s)->juce::String {
        return mct::origami::ui::modulationSourceLabel(state.modulation,s); // a renamed macro shows its name
    };
    auto groupName=[](mct::origami::ModSource s)->juce::String {
        const auto raw=static_cast<std::uint32_t>(s);
        if(raw>=1 && raw<100) return "Envelopes";
        if(raw>=100 && raw<200) return "LFOs";
        if(raw>=200 && raw<300) return "Macros";
        if(raw>=300 && raw<400) return "Performance";
        return "Generators";
    };

    // One knob menu for every page: assign (no duplicates), remove, reset.
    using S=mct::origami::ModSource;
    std::vector<S> sources{S::Env1,S::Env2,S::Env3};
    for(const auto s:{S::Lfo1,S::Lfo2,S::Lfo3,S::Lfo4}) sources.push_back(s);
    for(const auto s:mct::origami::activeMacroSources(state.modulation)) sources.push_back(s); // stable macro ids
    for(const auto s:{S::Random,S::Function,S::Chaos,S::Drift,S::Sequencer}) sources.push_back(s);
    for(const auto s:{S::Velocity,S::ModWheel,S::Keytrack,S::Aftertouch,S::PitchBend,S::NoteGate}) sources.push_back(s);
    const auto available=[&state](S s) {
        const auto raw=static_cast<std::uint32_t>(s);
        if(raw>=1 && raw<=3) return (state.modulation.envActiveMask&(1u<<(raw-1)))!=0;
        if(raw>=101 && raw<=104) return (state.modulation.lfoActiveMask&(1u<<(raw-101)))!=0;
        if(const auto id=mct::origami::macroIdOf(s)) return mct::origami::macroActive(state.modulation,id);
        if(s==S::Random) return (state.modulation.generatorActiveMask&0x02u)!=0;
        if(s==S::Function) return (state.modulation.generatorActiveMask&0x01u)!=0;
        if(s==S::Chaos) return (state.modulation.generatorActiveMask&0x04u)!=0;
        if(s==S::Drift) return (state.modulation.generatorActiveMask&0x08u)!=0;
        if(s==S::Sequencer) return (state.modulation.generatorActiveMask&0x10u)!=0;
        return true;
    };
    std::vector<mct::origami::ui::NativeChoiceItem> items;
    for(const auto s:sources) {
        if(!available(s)) continue;
        bool routed=false;
        for(const auto& r:matches) routed|=r.source==s;
        items.push_back({1000+static_cast<int>(s),sourceName(s),true,"ASSIGN MODULATOR / "+groupName(s),routed});
    }
    if(matches.empty()) {
        items.push_back({1,"No Modulators",false,"REMOVE MODULATION",false});
    } else {
        items.push_back({1,"Remove All Modulators",true,"REMOVE MODULATION",false});
        int menuId=100;
        for(const auto& route:matches)
            items.push_back({menuId++,sourceName(route.source),true,"REMOVE MODULATION",false});
    }
    items.push_back({5000,"Reset Parameter",true,"PARAMETER",false});

    auto safe=juce::Component::SafePointer<juce::Slider>(&slider);
    showNativeChoiceMenu(slider,"KNOB PROPERTIES",items,0,
        [this,safe,matches](int id) {
            if(safe==nullptr || !dragBindings_.removeRoute) return;
            if(id>=1000 && id<5000) {
                assignModulator(static_cast<mct::origami::ModSource>(id-1000),*safe);
            } else if(id==5000) {
                const auto& props=safe->getProperties();
                if(props.contains("mct.origami.knobDefault"))
                    safe->setValue(juce::jlimit(safe->getMinimum(),safe->getMaximum(),static_cast<double>(props["mct.origami.knobDefault"])),
                                   juce::sendNotificationSync);
            } else if(id==1) {
                for(const auto& route:matches) dragBindings_.removeRoute(route.id);
            } else if(id>=100) {
                const auto index=static_cast<std::size_t>(id-100);
                if(index<matches.size()) dragBindings_.removeRoute(matches[index].id);
            }
            refreshModulationViews();
            repaint();
        });
}

void OrigamiAudioProcessorEditor::openKnobValueEditor(juce::Slider& slider) {
    auto* dialog=new juce::AlertWindow(
        "Enter Knob Value",
        slider.getName().isNotEmpty() ? slider.getName() : juce::String("Numeric value"),
        juce::MessageBoxIconType::NoIcon);

    // Keep typed knob entry intentionally plain/OEM-looking: true black surface,
    // neutral white typography, minimal outline. This avoids the blue-grey JUCE
    // alert appearance while retaining the native editor workflow.
    dialog->setColour(juce::AlertWindow::backgroundColourId,juce::Colours::black);
    dialog->setColour(juce::AlertWindow::textColourId,juce::Colours::white);
    dialog->setColour(juce::AlertWindow::outlineColourId,juce::Colour(0xff383838));

    dialog->addTextEditor("value",
                          juce::String(slider.getValue(),6).trimCharactersAtEnd("0").trimCharactersAtEnd("."),
                          "Value:");
    if(auto* editor=dialog->getTextEditor("value")) {
        editor->setInputRestrictions(0,"0123456789.-+");
        editor->setFont(juce::Font(juce::FontOptions("Arial",14.0f,juce::Font::plain)));
        editor->setColour(juce::TextEditor::backgroundColourId,juce::Colours::black);
        editor->setColour(juce::TextEditor::textColourId,juce::Colours::white);
        editor->setColour(juce::TextEditor::highlightColourId,juce::Colour(0xff3f3f3f));
        editor->setColour(juce::TextEditor::highlightedTextColourId,juce::Colours::white);
        editor->setColour(juce::TextEditor::outlineColourId,juce::Colour(0xff454545));
        editor->setColour(juce::TextEditor::focusedOutlineColourId,juce::Colour(0xff707070));
        editor->selectAll();
    }

    dialog->addButton("Apply",1,juce::KeyPress(juce::KeyPress::returnKey));
    dialog->addButton("Cancel",0,juce::KeyPress(juce::KeyPress::escapeKey));

    for(const auto& name:juce::StringArray{"Apply","Cancel"}) {
        if(auto* button=dialog->getButton(name)) {
            button->setColour(juce::TextButton::buttonColourId,juce::Colour(0xff151515));
            button->setColour(juce::TextButton::buttonOnColourId,juce::Colour(0xff202020));
            button->setColour(juce::TextButton::textColourOffId,juce::Colours::white);
            button->setColour(juce::TextButton::textColourOnId,juce::Colours::white);
        }
    }

    auto safeSlider=juce::Component::SafePointer<juce::Slider>(&slider);
    dialog->enterModalState(
        true,
        juce::ModalCallbackFunction::create(
            [safeSlider,dialog](int result) {
                if(result==1 && safeSlider!=nullptr) {
                    const auto raw=dialog->getTextEditorContents("value").trim();
                    if(raw.isNotEmpty()) {
                        const double parsed=raw.getDoubleValue();
                        if(std::isfinite(parsed)) {
                            const double constrained=juce::jlimit(
                                safeSlider->getMinimum(),
                                safeSlider->getMaximum(),
                                parsed);
                            safeSlider->setValue(constrained,juce::sendNotificationSync);
                        }
                    }
                }
                delete dialog;
            }),
        false);
}
void OrigamiAudioProcessorEditor::paint(juce::Graphics& g) {g.fillAll(Palette::background());}

void OrigamiAudioProcessorEditor::openWavetableEditor(unsigned oscillatorId) {
    // mct-origami-content-browser: edit this oscillator's own table.
    const auto source=processor_.getUiOscillatorWavetable(oscillatorId);
    wavetableEditor_.loadDocument(source.data ? *source.data : mct::origami::content::basicShapes());
    wavetableEditorOscillatorId_=oscillatorId;
    wavetableEditorSelected_=true;
    resized();
    wavetableEditor_.toFront(false);
    wavetableEditor_.grabKeyboardFocus();
}

void OrigamiAudioProcessorEditor::closeWavetableEditor() {
    if(!wavetableEditorSelected_) return;

    // The oscillator that opened the editor remains the commit target for the
    // entire editor session. X and Esc both arrive through this single close
    // path, so neither can silently discard the authored table.
    const auto targetOscillator=wavetableEditorOscillatorId_;
    if(targetOscillator!=0) {
        // An unchanged table keeps its library identity; an edited one is the
        // oscillator's own (saved in the patch, exportable, no library id).
        auto data=wavetableEditor_.documentData();
        const auto source=processor_.getUiOscillatorWavetable(targetOscillator);
        const auto& reference=source.data ? *source.data : mct::origami::content::basicShapes();
        const bool unchanged=reference.samples==data.samples;
        const auto contentId=unchanged ? (source.data ? source.contentId : juce::String(mct::origami::content::ContentLibrary::basicShapesId)) : juce::String();
        if(unchanged) data.name=reference.name;
        else if(!data.name.endsWithIgnoreCase("(EDITED)")) data.name=data.name.trim()+" (EDITED)"; // never claims to be the library table
        processor_.setUiOscillatorWavetable(targetOscillator,std::move(data),contentId);
    }

    wavetableEditorSelected_=false;
    wavetableEditorOscillatorId_=0;
    oscillators_.syncFromModel();
    resized();
}

void OrigamiAudioProcessorEditor::resized() {
    // mct-origami-consistent-resize-v11
    const auto designBounds=juce::Rectangle<int>(0,0,EditorLayout::defaultWidth,EditorLayout::defaultHeight);
    const auto layout=EditorLayout::calculate(designBounds);

    header_.setBounds(layout.header);
    oscillators_.setBounds(layout.oscillators);
    modulation_.setBounds(layout.modulation);
    filter_.setBounds(layout.filter);
    macros_.setBounds(layout.macros);
    performance_.setBounds(layout.performance);
    const auto mainArea=layout.oscillators.getUnion(layout.modulation).getUnion(layout.filter).getUnion(layout.macros);
    matrix_.setBounds(mainArea);
    arpeggiator_.setBounds(mainArea);
    global_.setBounds(mainArea);
    fxPage_.setBounds(mainArea);
    // Wavetable editing is an application-level takeover: preserve the global
    // Origami header and performance keyboard, replace everything between them.
    wavetableEditor_.setBounds(mainArea);
    // mct-origami-content-browser: the browser replaces the workspace too.
    browser_->setBounds(mainArea);
    browser_->setVisible(browserOpen_);
    const bool takeover=wavetableEditorSelected_ || browserOpen_;
    wavetableEditor_.setVisible(wavetableEditorSelected_ && !browserOpen_);
    matrix_.setVisible(!takeover && matrixSelected_ && !arpSelected_);
    arpeggiator_.setVisible(!takeover && arpSelected_);
    global_.setVisible(!takeover && globalSelected_ && !arpSelected_);
    fxPage_.setVisible(!takeover && fxSelected_ && !arpSelected_);
    const bool synthVisible=!takeover && !matrixSelected_ && !arpSelected_ && !globalSelected_ && !fxSelected_;
    for(auto* component:std::array<juce::Component*,4>{{&oscillators_,&modulation_,&filter_,&macros_}})
        component->setVisible(synthVisible);

    mixer_.setVisible(false);
    fxPre_.setVisible(false);
    fxPost_.setVisible(false);
    mixer_.setBounds({});
    fxPre_.setBounds({});
    fxPost_.setBounds({});

    const float sx=static_cast<float>(getWidth())/static_cast<float>(EditorLayout::defaultWidth);
    const float sy=static_cast<float>(getHeight())/static_cast<float>(EditorLayout::defaultHeight);
    const float scale=juce::jmin(sx,sy);

    const auto transform=juce::AffineTransform::scale(scale);
    globalOverlay_.setBounds(designBounds);
    const std::array<juce::Component*,13> visibleComponents{{
        &header_,&oscillators_,&modulation_,&filter_,&macros_,&performance_,&matrix_,&arpeggiator_,&global_,&fxPage_,&wavetableEditor_,browser_.get(),&globalOverlay_
    }};

    for(auto* component:visibleComponents)
        component->setTransform(transform);

    if(wavetableEditorSelected_)
        wavetableEditor_.toFront(false);
    if(browserOpen_) browser_->toFront(false);
    if(globalOverlay_.isShowing()) globalOverlay_.toFront(true);
}

void OrigamiAudioProcessorEditor::openGlobalFx() {
    globalFx_->sync();
    globalOverlay_.show(*globalFx_,{0,0,620,330});
}

void OrigamiAudioProcessorEditor::beginModulationDrag(mct::origami::ModSource source) {
    modulationDrag_={};
    modulationDrag_.active=true;
    modulationDrag_.source=source;
    modulationDrag_.originPage=currentPage_;
}

void OrigamiAudioProcessorEditor::updateModulationDragHover(juce::Point<int> point,double nowMs) {
    if(!modulationDrag_.active) return;
    modulationDrag_.lastPosition=point;
    const int mode=header_.modeAt(header_.getLocalPoint(this,point));
    if(mode!=modulationDrag_.hoverMode) {
        modulationDrag_.hoverMode=mode;
        modulationDrag_.hoverStartMs=nowMs;
        return;
    }
    // Deliberate hover only: passing over a tab never switches pages.
    if(mode>=0 && mode!=currentPage_ && header_.modeEnabled(mode)
       && nowMs-modulationDrag_.hoverStartMs>=pageSwitchHoverMs)
        header_.selectMode(mode);
}

void OrigamiAudioProcessorEditor::endModulationDrag() {
    modulationDrag_={};
}

bool OrigamiAudioProcessorEditor::assignModulator(mct::origami::ModSource source,juce::Slider& slider) {
    if(!slider.getProperties().contains("mct.mod.destination") || !dragBindings_.snapshot) return false;
    const auto destination=static_cast<mct::origami::ModDestination>(static_cast<int>(slider.getProperties()["mct.mod.destination"]));
    const auto oscillator=slider.getProperties().contains("mct.mod.oscillator") ? static_cast<unsigned>(static_cast<int>(slider.getProperties()["mct.mod.oscillator"])) : 0u;
    const auto itemId=slider.getProperties().contains("mct.mod.itemId") ? static_cast<std::uint32_t>(static_cast<int>(slider.getProperties()["mct.mod.itemId"])) : 0u;
    // An existing identical source -> destination route is kept as is (its
    // amount is the user's); assignment never creates a duplicate row.
    for(const auto& r:dragBindings_.snapshot().modulation.routes)
        if(r.id && r.source==source && r.destination==mct::origami::ModAddress{destination,oscillator,itemId}) return true;
    return createDraggedRoute(source,slider);
}

// ---- mct-origami-content-browser ----------------------------------------------------
void OrigamiAudioProcessorEditor::openContentBrowser(mct::origami::content::ContentType type,unsigned oscillatorId) {
    browserOpen_=true;
    resized();
    browser_->open(type,oscillatorId);
    browser_->grabKeyboardFocus(); // Escape closes; other keys follow CAPTURE KEYBOARD INPUT
}
void OrigamiAudioProcessorEditor::closeContentBrowser() {
    if(!browserOpen_) return;
    browserOpen_=false;
    resized();
}
juce::String OrigamiAudioProcessorEditor::oscillatorLabel(unsigned oscillatorId) const {
    unsigned ordinal=0;
    for(const auto& m:processor_.getUiInstrumentState().oscillators) if(m.id) { ++ordinal; if(m.id==oscillatorId) return "OSC "+juce::String(ordinal); }
    return "OSC";
}
void OrigamiAudioProcessorEditor::contentLoaded() {
    header_.setPresetName(processor_.getUiCurrentPreset().name);
    oscillators_.syncFromModel();
    refreshModulationViews();
}
bool OrigamiAudioProcessorEditor::loadPresetRecord(const mct::origami::content::ContentRecord& r) {
    bool ok=false;
    if(r.id==mct::origami::content::ContentLibrary::initPresetId) ok=processor_.loadUiInitPreset();
    else {
        juce::MemoryBlock state;
        ok=library_->library.loadPresetState(r,state) && processor_.loadUiPresetState(state,r.id,r.name);
    }
    if(ok) contentLoaded();
    return ok;
}
bool OrigamiAudioProcessorEditor::loadWavetableRecord(const mct::origami::content::ContentRecord& r,unsigned oscillatorId) {
    if(oscillatorId==0) return false;
    mct::origami::content::WavetableData data;
    if(!library_->library.loadWavetable(r,data)) return false;
    if(!processor_.setUiOscillatorWavetable(oscillatorId,std::move(data),r.id)) return false;
    library_->library.markUsed(r.type,r.id);
    oscillators_.syncFromModel();
    return true;
}
juce::Result OrigamiAudioProcessorEditor::importWavetableFile(unsigned oscillatorId,const juce::File& file) {
    mct::origami::content::ContentRecord record; bool duplicate=false;
    const auto result=library_->library.importWavetable(file,record,duplicate);
    if(result.failed()) return result;
    if(oscillatorId!=0 && !loadWavetableRecord(record,oscillatorId)) return juce::Result::fail("Imported, but the table could not be loaded");
    if(browserOpen_) { browser_->refresh(); browser_->selectId(record.id); }
    return juce::Result::ok();
}
juce::Result OrigamiAudioProcessorEditor::exportWavetableFile(unsigned oscillatorId,const juce::File& file) {
    const auto source=processor_.getUiOscillatorWavetable(oscillatorId);
    const auto data=source.data ? *source.data : mct::origami::content::basicShapes();
    return mct::origami::content::writeWavetableWav(file,data) ? juce::Result::ok() : juce::Result::fail("Could not write "+file.getFullPathName());
}
void OrigamiAudioProcessorEditor::beginWavetableImport(unsigned oscillatorId) {
    contentChooser_=std::make_unique<juce::FileChooser>("IMPORT WAVETABLE",juce::File{},"*.wav;*.aif;*.aiff");
    juce::Component::SafePointer<OrigamiAudioProcessorEditor> safe(this);
    contentChooser_->launchAsync(juce::FileBrowserComponent::openMode|juce::FileBrowserComponent::canSelectFiles,
        [safe,oscillatorId](const juce::FileChooser& chooser) {
            if(safe==nullptr) return;
            const auto file=chooser.getResult();
            if(file.existsAsFile()) {
                const auto result=safe->importWavetableFile(oscillatorId,file);
                if(result.failed()) juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon,"IMPORT WAVETABLE",file.getFileName()+": "+result.getErrorMessage());
            }
        });
}
void OrigamiAudioProcessorEditor::beginWavetableExport(unsigned oscillatorId) {
    const auto source=processor_.getUiOscillatorWavetable(oscillatorId);
    const auto name=source.data ? source.data->name : juce::String("BASIC SHAPES");
    contentChooser_=std::make_unique<juce::FileChooser>("EXPORT WAVETABLE",
        juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile(juce::File::createLegalFileName(name)+".wav"),"*.wav");
    juce::Component::SafePointer<OrigamiAudioProcessorEditor> safe(this);
    contentChooser_->launchAsync(juce::FileBrowserComponent::saveMode|juce::FileBrowserComponent::canSelectFiles|juce::FileBrowserComponent::warnAboutOverwriting,
        [safe,oscillatorId](const juce::FileChooser& chooser) {
            if(safe==nullptr) return;
            const auto file=chooser.getResult();
            if(file==juce::File{}) return;
            const auto result=safe->exportWavetableFile(oscillatorId,file.withFileExtension(".wav"));
            if(result.failed()) juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon,"EXPORT WAVETABLE",result.getErrorMessage());
        });
}
void OrigamiAudioProcessorEditor::stepPreset(int step) {
    using mct::origami::content::ContentType;
    const auto next=browser_->neighbour(ContentType::Preset,processor_.getUiCurrentPreset().id,step);
    if(const auto* r=library_->library.find(next)) { const auto copy=*r; if(loadPresetRecord(copy)) library_->library.markUsed(ContentType::Preset,copy.id); }
}
void OrigamiAudioProcessorEditor::stepWavetable(unsigned oscillatorId,int step) {
    using mct::origami::content::ContentType;
    const auto source=processor_.getUiOscillatorWavetable(oscillatorId);
    const auto current=source.data ? source.contentId : juce::String(mct::origami::content::ContentLibrary::basicShapesId);
    const auto next=browser_->neighbour(ContentType::Wavetable,current,step);
    if(const auto* r=library_->library.find(next)) { const auto copy=*r; loadWavetableRecord(copy,oscillatorId); }
}
void OrigamiAudioProcessorEditor::showPresetSaveDialog() {
    const auto current=processor_.getUiCurrentPreset();
    const auto* record=library_->library.find(current.id);
    mct::origami::ui::PresetSaveDialog::Fields f;
    juce::String replaceName;
    if(record!=nullptr && !record->isReadOnly()) {
        f={record->name,record->author,record->category,record->tags.joinIntoString(", "),record->description};
        replaceName=record->name;
    } else {
        f.name=record!=nullptr || current.name=="UNTITLED" ? juce::String() : current.name;
        f.author=library_->library.state().author;
        if(record!=nullptr) { f.category=record->category; }
    }
    saveDialog_->setFields(f,replaceName);
    globalOverlay_.show(*saveDialog_,{0,0,520,430});
    saveDialog_->nameField().grabKeyboardFocus();
}
juce::Result OrigamiAudioProcessorEditor::savePreset(const mct::origami::ui::PresetSaveDialog::Fields& f,bool replace) {
    auto& library=library_->library;
    mct::origami::content::ContentRecord meta;
    meta.type=mct::origami::content::ContentType::Preset;
    const auto current=processor_.getUiCurrentPreset();
    if(replace) if(const auto* r=library.find(current.id); r!=nullptr && !r->isReadOnly()) meta.id=r->id;
    meta.name=f.name; meta.author=f.author; meta.category=f.category; meta.description=f.description;
    meta.tags.addTokens(f.tags,",",""); meta.tags.trim(); meta.tags.removeEmptyStrings(); meta.tags.removeDuplicates(true);
    // An indexed summary (computed now, cheaply): the browser never decodes presets.
    const auto state=processor_.getUiInstrumentState();
    meta.oscillators=0; for(const auto& m:state.oscillators) meta.oscillators+=m.id!=0;
    meta.macros=0; for(std::size_t i=0;i<mct::origami::maxMacros;++i) meta.macros+=mct::origami::macroActive(state.modulation,i+1);
    meta.nodes=0; for(const auto& op:state.modulation.operators) meta.nodes+=op.id!=0;
    meta.fxModules=0;
    for(const auto bus:processor_.getUiFxWorkspace().buses())
        for(const auto& node:processor_.getUiFxWorkspace().document(bus).graph().nodes()) meta.fxModules+=node.kind==mct::origami::fx::FxNodeKind::Effect;
    meta.stateVersion=static_cast<int>(mct::origami::encodeInstrumentState(state)[7]);
    // The saved state carries the new identity, so a session reopens on it.
    juce::MemoryBlock bytes;
    processor_.getStateInformation(bytes);
    mct::origami::content::ContentRecord saved;
    const auto result=library.savePreset(meta,bytes,saved);
    if(result.failed()) return result;
    processor_.setUiCurrentPreset(saved.id,saved.name);
    library.state().author=f.author;
    library.markUsed(meta.type,saved.id);
    header_.setPresetName(saved.name);
    if(browserOpen_) browser_->refresh();
    return juce::Result::ok();
}
bool OrigamiAudioProcessorEditor::isInterestedInFileDrag(const juce::StringArray& files) {
    for(const auto& f:files) { const juce::File file(f); if(file.hasFileExtension(".wav;.aif;.aiff")) return true; }
    return false;
}
void OrigamiAudioProcessorEditor::filesDropped(const juce::StringArray& files,int x,int y) {
    // A Finder drop onto an oscillator imports (same pipeline) into it.
    unsigned target=0;
    for(auto* c=getComponentAt(x,y);c!=nullptr && c!=this;c=c->getParentComponent())
        if(auto* card=dynamic_cast<mct::origami::ui::OscillatorCard*>(c)) { target=card->id(); break; }
    for(const auto& f:files) {
        const juce::File file(f);
        if(!file.hasFileExtension(".wav;.aif;.aiff")) continue;
        const auto result=importWavetableFile(target,file);
        if(result.failed()) juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon,"IMPORT WAVETABLE",file.getFileName()+": "+result.getErrorMessage());
        break; // one table per oscillator
    }
}

mct::origami::dsp::Wavetable OrigamiAudioProcessorEditor::WavetableEditorSurface::compiledWavetable() const {
    return OrigamiAudioProcessor::compileWavetable(documentData());
}
