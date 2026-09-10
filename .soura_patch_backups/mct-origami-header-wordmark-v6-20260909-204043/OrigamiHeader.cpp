#include "OrigamiHeader.h"
#include <BinaryData.h>
namespace mct::origami::ui {
OrigamiHeader::OrigamiHeader() {
    logo_=juce::ImageCache::getFromMemory(BinaryData::mct_origami_logo_png,
                                         BinaryData::mct_origami_logo_pngSize);
    for(auto* button:{&previous_,&next_,&preset_,&browse_,&save_,&settings_}) {addAndMakeVisible(button);button->setEnabled(false);button->setTooltip("Preset and utility controls are reserved for a later release.");}
    const juce::StringArray labels{"SYNTH","FX","MATRIX","GLOBAL"};
    for(int i=0;i<4;++i) {auto& button=modes_[static_cast<std::size_t>(i)];button.setButtonText(labels[i]);button.setToggleState(i==0,juce::dontSendNotification);button.setEnabled(false);button.setTooltip("Workspace navigation preview");addAndMakeVisible(button);}
}
void OrigamiHeader::paint(juce::Graphics& g) {
    const juce::Rectangle<int> logoBounds{10,8,46,46};
    if(logo_.isValid()) {
        g.setImageResamplingQuality(juce::Graphics::highResamplingQuality);
        g.drawImageWithin(logo_,logoBounds.getX(),logoBounds.getY(),logoBounds.getWidth(),logoBounds.getHeight(),
                          juce::RectanglePlacement::centred | juce::RectanglePlacement::onlyReduceInSize);
    }

    text(g,"MCT ORIGAMI",{68,9,220,27},22,Palette::text());
    text(g,"MELOGIC CREATIVE TECHNOLOGIES",{69,38,230,15},8.2f,Palette::muted());

    g.setColour(Palette::borderSoft());
    g.drawHorizontalLine(getHeight()-1,0.f,float(getWidth()));
}
void OrigamiHeader::resized() {
    auto area=getLocalBounds().withTrimmedLeft(324).reduced(0,10);
    auto utilities=area.removeFromRight(juce::jmin(170,area.getWidth()/4));
    settings_.setBounds(utilities.removeFromRight(34).reduced(2,6));save_.setBounds(utilities.removeFromRight(55).reduced(2,6));browse_.setBounds(utilities.reduced(2,6));
    area.removeFromRight(10);auto modes=area.removeFromRight(264);for(auto& mode:modes_)mode.setBounds(modes.removeFromLeft(66).reduced(1,6));
    area.removeFromRight(14);previous_.setBounds(area.removeFromLeft(27).reduced(0,6));next_.setBounds(area.removeFromRight(27).reduced(0,6));preset_.setBounds(area.reduced(3,6));
}
}
