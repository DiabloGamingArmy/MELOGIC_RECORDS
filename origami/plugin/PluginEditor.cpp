#include "PluginEditor.h"
#include "PluginProcessor.h"
using namespace mct::origami::ui;
OrigamiAudioProcessorEditor::OrigamiAudioProcessorEditor(OrigamiAudioProcessor& owner)
    : AudioProcessorEditor(&owner) {
    setLookAndFeel(&theme_);
    const std::array<juce::Component*,9> components{{&header_,&oscillators_,&mixer_,&filter_,&fxPre_,&fxPost_,&modulation_,&macros_,&performance_}};
    for(auto* component:components) addAndMakeVisible(component);
    setResizable(true,true);
    setResizeLimits(EditorLayout::minWidth,EditorLayout::minHeight,2200,1500);
    setSize(EditorLayout::defaultWidth,EditorLayout::defaultHeight);
}
OrigamiAudioProcessorEditor::~OrigamiAudioProcessorEditor() {setLookAndFeel(nullptr);}
void OrigamiAudioProcessorEditor::paint(juce::Graphics& g) {g.fillAll(Palette::background());}
void OrigamiAudioProcessorEditor::resized() {
    const auto layout=EditorLayout::calculate(getLocalBounds());
    header_.setBounds(layout.header);oscillators_.setBounds(layout.oscillators);
    mixer_.setBounds(layout.mixer);filter_.setBounds(layout.filter);fxPre_.setBounds(layout.fxPre);fxPost_.setBounds(layout.fxPost);
    modulation_.setBounds(layout.modulation);macros_.setBounds(layout.macros);performance_.setBounds(layout.performance);
}
