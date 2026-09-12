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
#include <cmath>
#include <cstring>
using namespace mct::origami::ui;
namespace {
ModulationBindings modulationBindings(OrigamiAudioProcessor& owner) {
    return {[&owner]{return owner.getUiInstrumentState();},
        [&owner](unsigned i,float v){return owner.setUiMacro(i,v);},
        [&owner](const mct::origami::LfoSettings& s){return owner.setUiLfo(s);},
        [&owner]{return owner.addUiRoute();},
        [&owner](const mct::origami::ModRoute& r){return owner.setUiRoute(r);},
        [&owner](unsigned id){return owner.removeUiRoute(id);},
        [&owner](const mct::origami::ModulationState& s){return owner.setUiModulationState(s);},
        [&owner]{return owner.getUiEnvelopeTraceSnapshot();},
        [&owner]{return owner.getUiHostBpm();}};
}
}
OrigamiAudioProcessorEditor::OrigamiAudioProcessorEditor(OrigamiAudioProcessor& owner)
    : AudioProcessorEditor(&owner), dragBindings_(modulationBindings(owner)), processor_(owner),
      oscillators_(
          [&owner](mct::origami::ParameterId id,float value) { return owner.setUiParameter(id,value); },
          [&owner](mct::origami::ParameterId id) { return owner.getUiParameter(id); },
          [&owner]() -> unsigned { return owner.addUiOscillator(); },
          [&owner](unsigned id) -> bool { return owner.removeUiOscillator(id); },
          [&owner](unsigned id,const mct::origami::OscillatorModuleState& state) -> bool { return owner.setUiOscillatorState(id,state); },
          [&owner](unsigned id) -> mct::origami::OscillatorModuleState { return owner.getUiOscillatorState(id); },
          [&owner](unsigned id,bool enabled) -> bool { return owner.setUiOscillatorEnabled(id,enabled); },
          [&owner](unsigned id) -> bool { return owner.getUiOscillatorEnabled(id); },
          [&owner] { return owner.getUiInstrumentState(); }),
      filter_([&owner](auto id,float v){return owner.setUiParameter(id,v);},
              [&owner](auto id){return owner.getUiParameter(id);},
              modulationBindings(owner)),
      modulation_([&owner](auto id,float v){return owner.setUiParameter(id,v);},[&owner](auto id){return owner.getUiParameter(id);},modulationBindings(owner)),
      macros_(modulationBindings(owner)),matrix_(modulationBindings(owner)),
      performance_([&owner](int note,bool on,float velocity){return owner.enqueueUiKeyboardNote(note,on,velocity);},
          [&owner](float v){owner.setUiPitchWheel(v);},
          [&owner](float v){owner.setUiModWheel(v);},
          [&owner](float v){return owner.setUiPitchBendRange(v);},
          [&owner]{return owner.getUiPitchBendRange();},
          [&owner](const mct::origami::PerformanceState& p){return owner.setUiPerformanceState(p);},
          [&owner]{return owner.getUiPerformanceState();},
          [&owner](const mct::origami::ArpeggiatorState& a){return owner.setUiArpeggiatorState(a);},
          [&owner]{return owner.getUiArpeggiatorState();}),
      arpeggiator_(
          [&owner](const mct::origami::ArpeggiatorState& a){return owner.setUiArpeggiatorState(a);},
          [&owner]{return owner.getUiArpeggiatorState();},
          [&owner]{return owner.getUiArpeggiatorRuntimeSnapshot();},
          [&owner]{owner.clearUiArpeggiatorLatch();}) {
    setLookAndFeel(&theme_);
    const std::array<juce::Component*,11> components{{&header_,&oscillators_,&mixer_,&filter_,&fxPre_,&fxPost_,&modulation_,&macros_,&performance_,&matrix_,&arpeggiator_}};
    for(auto* component:components) addAndMakeVisible(component);
    // mct-origami-fixed-ratio-zoom-v1
    // Resize behaves as whole-interface zoom: the editor is constrained to one
    // canonical 16:10 canvas and every child is scaled from that same design space.
    header_.onMatrixSelected=[this](bool selected){
        matrixSelected_=selected;
        arpSelected_=false;
        resized();
    };
    performance_.onArpSettingsRequested=[this]{
        arpSelected_=!arpSelected_;
        if(arpSelected_) {
            matrixSelected_=false;
            header_.selectSynth();
            arpeggiator_.syncFromModel();
        }
        resized();
    };
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

bool OrigamiAudioProcessorEditor::isInterestedInDragSource(const SourceDetails& details) {
    mct::origami::ModSource source{};
    return decodeDraggedModSource(details.description,source);
}

void OrigamiAudioProcessorEditor::itemDragEnter(const SourceDetails& details) {
    itemDragMove(details);
}

void OrigamiAudioProcessorEditor::itemDragMove(const SourceDetails& details) {
    mct::origami::ModSource source{};
    if(!decodeDraggedModSource(details.description,source)) return;
    modulation_.revealSourceAtParentPoint(details.localPosition.toInt());
    // Keep the JUCE drag alive while source tabs also act as navigation targets.
    modulation_.revealSourceAtParentPoint(details.localPosition);
    auto* target=modulationDropTargetAt(details.localPosition);
    if(target!=dragPreviewTarget_.getComponent()) {
        dragPreviewTarget_=target;
        repaint();
    }
}

void OrigamiAudioProcessorEditor::itemDragExit(const SourceDetails&) {
    dragPreviewTarget_=nullptr;
    repaint();
}

bool OrigamiAudioProcessorEditor::createDraggedRoute(
    mct::origami::ModSource source,juce::Slider& target) {
    if(!dragBindings_.addRoute || !dragBindings_.snapshot || !dragBindings_.route)
        return false;

    const int destinationRaw=static_cast<int>(
        target.getProperties()["mct.mod.destination"]);
    const int oscillatorRaw=target.getProperties().contains("mct.mod.oscillator")
        ? static_cast<int>(target.getProperties()["mct.mod.oscillator"]) : 0;

    const auto destination=static_cast<mct::origami::ModDestination>(destinationRaw);
    const auto stateBefore=dragBindings_.snapshot();

    // If this exact source -> destination edge already exists, select/update it
    // rather than creating duplicate Matrix rows.
    for(const auto& existing:stateBefore.modulation.routes) {
        if(existing.id!=0 && existing.source==source &&
           existing.destination.parameter==destination &&
           existing.destination.oscillator==static_cast<unsigned>(oscillatorRaw)) {
            auto route=existing;
            route.enabled=true;
            route.bipolar=false;
            route.amount=dragPreviewAmount_;
            return dragBindings_.route(route);
        }
    }

    const unsigned id=dragBindings_.addRoute();
    if(id==0) return false;

    const auto state=dragBindings_.snapshot();
    for(const auto& existing:state.modulation.routes) {
        if(existing.id!=id) continue;
        auto route=existing;
        route.source=source;
        route.destination={destination,static_cast<unsigned>(oscillatorRaw)};
        route.enabled=true;
        route.bipolar=false;
        route.amount=dragPreviewAmount_;
        return dragBindings_.route(route);
    }
    return false;
}

void OrigamiAudioProcessorEditor::itemDropped(const SourceDetails& details) {
    mct::origami::ModSource source{};
    auto* target=modulationDropTargetAt(details.localPosition);
    if(target!=nullptr && decodeDraggedModSource(details.description,source))
        createDraggedRoute(source,*target);
    dragPreviewTarget_=nullptr;
    modulation_.syncFromModel();
    matrix_.syncFromModel();
    repaint();
}

void OrigamiAudioProcessorEditor::paintOverChildren(juce::Graphics& g) {
    auto* slider=dragPreviewTarget_.getComponent();
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
}

void OrigamiAudioProcessorEditor::timerCallback() {
    // Dynamic oscillator cards can introduce new knobs after editor creation.
    // Register them lazily without disturbing existing defaults.
    registerKnobDefaults(*this);

    modulation_.syncFromModel();macros_.syncFromModel();matrix_.syncFromModel();filter_.syncFromModel();
    performance_.syncArpFromModel();
    if(arpSelected_) arpeggiator_.syncFromModel();
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

    const auto state=dragBindings_.snapshot();
    std::vector<mct::origami::ModRoute> matches;
    for(const auto& route:state.modulation.routes) {
        if(route.id!=0 && route.enabled &&
           route.destination.parameter==destination &&
           route.destination.oscillator==oscillator)
            matches.push_back(route);
    }

    auto sourceName=[](mct::origami::ModSource s)->juce::String {
        using S=mct::origami::ModSource;
        switch(s) {
            case S::Env1:return "ENV 1"; case S::Env2:return "ENV 2"; case S::Env3:return "ENV 3";
            case S::Lfo1:return "LFO 1"; case S::Lfo2:return "LFO 2"; case S::Lfo3:return "LFO 3"; case S::Lfo4:return "LFO 4";
            case S::Macro1:return "MACRO 1"; case S::Macro2:return "MACRO 2"; case S::Macro3:return "MACRO 3"; case S::Macro4:return "MACRO 4";
            case S::Random:return "RANDOM"; case S::Function:return "FUNCTION";
            case S::Chaos:return "CHAOS"; case S::Drift:return "DRIFT"; case S::Sequencer:return "SEQUENCER";
            case S::ModWheel:return "MOD WHEEL"; case S::Velocity:return "VELOCITY"; case S::Keytrack:return "KEYTRACK";
            case S::Aftertouch:return "AFTERTOUCH"; case S::PitchBend:return "PITCH BEND"; case S::NoteGate:return "NOTE GATE";
        }
        return "MODULATOR";
    };
    auto groupName=[](mct::origami::ModSource s)->juce::String {
        const auto raw=static_cast<std::uint32_t>(s);
        if(raw>=1 && raw<100) return "Envelopes";
        if(raw>=100 && raw<200) return "LFOs";
        if(raw>=200 && raw<300) return "Macros";
        if(raw>=300 && raw<400) return "Performance";
        return "Generators";
    };

    std::vector<mct::origami::ui::NativeChoiceItem> items;
    if(matches.empty()) {
        items.push_back({1,"No Modulators",false,"",false});
    } else {
        items.push_back({1,"Remove All Modulators",true,"",false});
        int menuId=100;
        for(const auto& route:matches)
            items.push_back({menuId++,sourceName(route.source),true,groupName(route.source),true});
    }

    auto safe=juce::Component::SafePointer<juce::Slider>(&slider);
    showNativeChoiceMenu(slider,"KNOB PROPERTIES",items,0,
        [this,safe,matches](int id) {
            if(safe==nullptr || !dragBindings_.removeRoute) return;
            if(id==1) {
                for(const auto& route:matches) dragBindings_.removeRoute(route.id);
            } else if(id>=100) {
                const auto index=static_cast<std::size_t>(id-100);
                if(index<matches.size()) dragBindings_.removeRoute(matches[index].id);
            }
            modulation_.syncFromModel();
            matrix_.syncFromModel();
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
    matrix_.setVisible(matrixSelected_ && !arpSelected_);
    arpeggiator_.setVisible(arpSelected_);
    const bool synthVisible=!matrixSelected_ && !arpSelected_;
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
    const std::array<juce::Component*,8> visibleComponents{{
        &header_,&oscillators_,&modulation_,&filter_,&macros_,&performance_,&matrix_,&arpeggiator_
    }};

    for(auto* component:visibleComponents)
        component->setTransform(transform);
}
