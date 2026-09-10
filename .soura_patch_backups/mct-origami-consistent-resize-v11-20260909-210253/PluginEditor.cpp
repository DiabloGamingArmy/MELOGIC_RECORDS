#include "PluginEditor.h"
#include "PluginProcessor.h"
using namespace mct::origami::ui;
OrigamiAudioProcessorEditor::OrigamiAudioProcessorEditor(OrigamiAudioProcessor& owner)
    : AudioProcessorEditor(&owner) {
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
    // mct-origami-two-row-synth-layout-v10
    const auto layout=EditorLayout::calculate(getLocalBounds());

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
}
