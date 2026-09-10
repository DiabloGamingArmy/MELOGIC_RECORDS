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
    // Layout once in the canonical 1440x900 design coordinate system, then scale
    // the complete UI uniformly. This preserves spacing, typography, knob sizes,
    // and section proportions instead of reflowing individual panels while resizing.
    const auto designBounds=juce::Rectangle<int>(0,0,EditorLayout::defaultWidth,EditorLayout::defaultHeight);
    const auto layout=EditorLayout::calculate(designBounds);

    header_.setBounds(layout.header);oscillators_.setBounds(layout.oscillators);
    mixer_.setBounds(layout.mixer);filter_.setBounds(layout.filter);fxPre_.setBounds(layout.fxPre);fxPost_.setBounds(layout.fxPost);
    modulation_.setBounds(layout.modulation);macros_.setBounds(layout.macros);performance_.setBounds(layout.performance);

    const float scale=juce::jmin(
        static_cast<float>(getWidth())/static_cast<float>(EditorLayout::defaultWidth),
        static_cast<float>(getHeight())/static_cast<float>(EditorLayout::defaultHeight));

    const auto transform=juce::AffineTransform::scale(scale);
    const std::array<juce::Component*,9> components{{&header_,&oscillators_,&mixer_,&filter_,&fxPre_,&fxPost_,&modulation_,&macros_,&performance_}};
    for(auto* component:components)
        component->setTransform(transform);
}
