// mct-origami-v34.5.0-ui-rebrand
// mct-origami-v25.1.0-arp-advanced-page
#include "OrigamiHeader.h"
#include <BinaryData.h>
namespace mct::origami::ui {
OrigamiHeader::OrigamiHeader() {
    // V34.5: one authoritative, precomposed MCT Origami header asset.
    // BinaryData keeps AU/VST3/Standalone independent of runtime disk paths.
    logo_=juce::ImageCache::getFromMemory(BinaryData::oragami_header_png,
                                         BinaryData::oragami_header_pngSize);
    wordmark_={};
    for(auto* button:{&previous_,&next_,&preset_,&browse_,&save_,&settings_}) {addAndMakeVisible(button);button->setEnabled(false);button->setTooltip("Preset and utility controls are reserved for a later release.");}
    const juce::StringArray labels{"SYNTH","MIXER","FX","MATRIX","GLOBAL"};
    for(int i=0;i<5;++i) {auto& button=modes_[static_cast<std::size_t>(i)];button.setButtonText(labels[i]);button.setToggleState(i==0,juce::dontSendNotification);button.setEnabled(i==0 || i==3);button.setTooltip(i==0?"Synthesizer":i==3?"Modulation routing":"Not implemented");addAndMakeVisible(button);
        button.onClick=[this,i] {for(std::size_t j=0;j<modes_.size();++j) modes_[j].setToggleState(j==static_cast<std::size_t>(i),juce::dontSendNotification);if(onMatrixSelected) onMatrixSelected(i==3);};}
}
void OrigamiHeader::selectSynth() {
    for(std::size_t i=0;i<modes_.size();++i)
        modes_[i].setToggleState(i==0,juce::dontSendNotification);
}
void OrigamiHeader::paint(juce::Graphics& g) {
    // Supplied artwork is 800x182. Display the complete composition without
    // cropping or stretching inside the existing 72px header.
    const juce::Rectangle<int> brandBounds{10,4,286,64};
    if(logo_.isValid()) {
        g.setImageResamplingQuality(juce::Graphics::highResamplingQuality);
        g.drawImageWithin(logo_,brandBounds.getX(),brandBounds.getY(),
                          brandBounds.getWidth(),brandBounds.getHeight(),
                          (juce::RectanglePlacement::xLeft | juce::RectanglePlacement::yMid) |
                          juce::RectanglePlacement::onlyReduceInSize);
    }

    g.setColour(Palette::borderSoft());
    g.drawHorizontalLine(getHeight()-1,0.f,float(getWidth()));
}
void OrigamiHeader::resized() {
    auto area=getLocalBounds().withTrimmedLeft(324).reduced(0,10);
    auto utilities=area.removeFromRight(juce::jmin(170,area.getWidth()/4));
    settings_.setBounds(utilities.removeFromRight(34).reduced(2,6));save_.setBounds(utilities.removeFromRight(55).reduced(2,6));browse_.setBounds(utilities.reduced(2,6));
    area.removeFromRight(10);auto modes=area.removeFromRight(300);for(auto& mode:modes_)mode.setBounds(modes.removeFromLeft(60).reduced(1,6));
    area.removeFromRight(14);previous_.setBounds(area.removeFromLeft(27).reduced(0,6));next_.setBounds(area.removeFromRight(27).reduced(0,6));preset_.setBounds(area.reduced(3,6));
}
}
