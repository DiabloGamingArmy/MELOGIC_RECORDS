// mct-origami-modulation-completion-v24.0.1
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-playable-keyboard-audio-v23.1
// mct-origami-v21-build-repair-2
#include "PluginEditor.h"
#include "PluginProcessor.h"
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
          [&owner]{return owner.getUiPerformanceState();}) {
    setLookAndFeel(&theme_);
    const std::array<juce::Component*,10> components{{&header_,&oscillators_,&mixer_,&filter_,&fxPre_,&fxPost_,&modulation_,&macros_,&performance_,&matrix_}};
    for(auto* component:components) addAndMakeVisible(component);
    // mct-origami-fixed-ratio-zoom-v1
    // Resize behaves as whole-interface zoom: the editor is constrained to one
    // canonical 16:10 canvas and every child is scaled from that same design space.
    header_.onMatrixSelected=[this](bool selected){matrixSelected_=selected;resized();};
    startTimerHz(15);
    setResizable(true,true);
    setResizeLimits(EditorLayout::minWidth,EditorLayout::minHeight,EditorLayout::maxWidth,EditorLayout::maxHeight);
    if (auto* constrainer=getConstrainer())
        constrainer->setFixedAspectRatio(EditorLayout::aspectRatio);
    setSize(EditorLayout::defaultWidth,EditorLayout::defaultHeight);
}
OrigamiAudioProcessorEditor::~OrigamiAudioProcessorEditor() {stopTimer();setLookAndFeel(nullptr);}
void OrigamiAudioProcessorEditor::timerCallback() {
    modulation_.syncFromModel();macros_.syncFromModel();matrix_.syncFromModel();filter_.syncFromModel();
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
    matrix_.setBounds(layout.oscillators.getUnion(layout.modulation).getUnion(layout.filter).getUnion(layout.macros));
    matrix_.setVisible(matrixSelected_);
    for(auto* component:std::array<juce::Component*,4>{{&oscillators_,&modulation_,&filter_,&macros_}}) component->setVisible(!matrixSelected_);

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
    const std::array<juce::Component*,7> visibleComponents{{
        &header_,&oscillators_,&modulation_,&filter_,&macros_,&performance_,&matrix_
    }};

    for(auto* component:visibleComponents)
        component->setTransform(transform);
}
