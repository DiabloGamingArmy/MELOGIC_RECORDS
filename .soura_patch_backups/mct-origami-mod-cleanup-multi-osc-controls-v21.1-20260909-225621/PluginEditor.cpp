// mct-origami-v21-build-repair-2
#include "PluginEditor.h"
#include "PluginProcessor.h"
using namespace mct::origami::ui;
OrigamiAudioProcessorEditor::OrigamiAudioProcessorEditor(OrigamiAudioProcessor& owner)
    : AudioProcessorEditor(&owner), processor_(owner),
      oscillators_(
          [&owner](mct::origami::ParameterId id,float value) { return owner.setUiParameter(id,value); },
          [&owner](mct::origami::ParameterId id) { return owner.getUiParameter(id); },
          [&owner]() -> unsigned { return owner.addUiOscillator(); },
          [&owner](unsigned id) -> bool { return owner.removeUiOscillator(id); }) {
    setLookAndFeel(&theme_);
    const std::array<juce::Component*,9> components{{&header_,&oscillators_,&mixer_,&filter_,&fxPre_,&fxPost_,&modulation_,&macros_,&performance_}};
    for(auto* component:components) addAndMakeVisible(component);
    // mct-origami-fixed-ratio-zoom-v1
    // Resize behaves as whole-interface zoom: the editor is constrained to one
    // canonical 16:10 canvas and every child is scaled from that same design space.
    setResizable(true,true);
    setResizeLimits(EditorLayout::minWidth,EditorLayout::minHeight,EditorLayout::maxWidth,EditorLayout::maxHeight);
    if (auto* constrainer=getConstrainer())
        constrainer->setFixedAspectRatio(EditorLayout::aspectRatio);
    setSize(EditorLayout::defaultWidth,EditorLayout::defaultHeight);
}
OrigamiAudioProcessorEditor::~OrigamiAudioProcessorEditor() {setLookAndFeel(nullptr);}
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
    const std::array<juce::Component*,6> visibleComponents{{
        &header_,&oscillators_,&modulation_,&filter_,&macros_,&performance_
    }};

    for(auto* component:visibleComponents)
        component->setTransform(transform);
}
