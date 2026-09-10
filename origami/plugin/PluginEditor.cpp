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
#include <cmath>
using namespace mct::origami::ui;
namespace {
ModulationBindings modulationBindings(OrigamiAudioProcessor& owner) {
    return {[&owner]{return owner.getUiInstrumentState();},
        [&owner](unsigned i,float v){return owner.setUiMacro(i,v);},
        [&owner](const mct::origami::LfoSettings& s){return owner.setUiLfo(s);},
        [&owner]{return owner.addUiRoute();},
        [&owner](const mct::origami::ModRoute& r){return owner.setUiRoute(r);},
        [&owner](unsigned id){return owner.removeUiRoute(id);},
        [&owner](const mct::origami::ModulationState& s){return owner.setUiModulationState(s);}};
}
}
OrigamiAudioProcessorEditor::OrigamiAudioProcessorEditor(OrigamiAudioProcessor& owner)
    : AudioProcessorEditor(&owner), processor_(owner),
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
      filter_([&owner](auto id,float v){return owner.setUiParameter(id,v);},[&owner](auto id){return owner.getUiParameter(id);}),
      modulation_([&owner](auto id,float v){return owner.setUiParameter(id,v);},[&owner](auto id){return owner.getUiParameter(id);},modulationBindings(owner)),
      macros_(modulationBindings(owner)),matrix_(modulationBindings(owner)),
      performance_(owner.uiKeyboardState(),
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
    // Preserve any control-specific default already declared by the UI.
    if(slider.isDoubleClickReturnEnabled())
        return slider.getDoubleClickReturnValue();

    const auto name=slider.getName().toLowerCase();

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
    if(slider==nullptr || !isKnob(*slider) || !event.mods.isShiftDown())
        return;

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

void OrigamiAudioProcessorEditor::openKnobValueEditor(juce::Slider& slider) {
    auto* dialog=new juce::AlertWindow(
        "Enter Knob Value",
        slider.getName().isNotEmpty() ? slider.getName() : juce::String("Numeric value"),
        juce::MessageBoxIconType::NoIcon);

    dialog->addTextEditor("value",
                          juce::String(slider.getValue(),6).trimCharactersAtEnd("0").trimCharactersAtEnd("."),
                          "Value:");
    if(auto* editor=dialog->getTextEditor("value")) {
        editor->setInputRestrictions(0,"0123456789.-+");
        editor->selectAll();
    }

    dialog->addButton("Apply",1,juce::KeyPress(juce::KeyPress::returnKey));
    dialog->addButton("Cancel",0,juce::KeyPress(juce::KeyPress::escapeKey));

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
