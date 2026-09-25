#include "GlobalPanel.h"

namespace mct::origami::ui {
namespace {
constexpr std::array<const char*,8> names{{
    "ENV","LFO","RANDOM","FUNCTION","CHAOS","DRIFT","SEQUENCER","OSC"
}};
}

GlobalPanel::GlobalPanel(Getter getter,Setter setter)
    : Panel("GLOBAL"),getter_(std::move(getter)),setter_(std::move(setter)) {
    for(std::size_t i=0;i<toggles_.size();++i) {
        auto& button=toggles_[i];
        addAndMakeVisible(button);
        button.setClickingTogglesState(true);
        button.setName(juce::String(names[i])+" visualization");
        button.onClick=[this,i] {
            if(syncing_) return;
            auto mask=getter_ ? getter_() : defaultVisualizationMask;
            const auto bit=1u<<static_cast<std::uint32_t>(i);
            if(toggles_[i].getToggleState()) mask|=bit; else mask&=~bit;
            if(setter_) setter_(mask);
            updateButton(i,toggles_[i].getToggleState());
        };
    }
    syncFromModel();
}

void GlobalPanel::updateButton(std::size_t index,bool enabled) {
    auto& button=toggles_[index];
    button.setButtonText(enabled ? "ON" : "OFF");
    button.setColour(juce::TextButton::buttonOnColourId,
                     signalSourceColour().darker(.72f));
}

void GlobalPanel::syncFromModel() {
    const auto mask=getter_ ? getter_() : defaultVisualizationMask;
    const juce::ScopedValueSetter<bool> guard(syncing_,true);
    for(std::size_t i=0;i<toggles_.size();++i) {
        const bool enabled=(mask&(1u<<static_cast<std::uint32_t>(i)))!=0;
        toggles_[i].setToggleState(enabled,juce::dontSendNotification);
        updateButton(i,enabled);
    }
}

void GlobalPanel::resized() {
    auto area=contentBounds().reduced(28,22);
    area.removeFromTop(44);
    constexpr int rowHeight=48;
    for(std::size_t i=0;i<toggles_.size();++i) {
        const int column=static_cast<int>(i%2),row=static_cast<int>(i/2);
        auto cell=juce::Rectangle<int>(area.getX()+column*area.getWidth()/2,
                                      area.getY()+row*rowHeight,
                                      area.getWidth()/2,rowHeight).reduced(12,6);
        toggles_[i].setBounds(cell.removeFromRight(86));
    }
}

void GlobalPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    auto area=body.reduced(28,22);
    text(g,"VISUALIZATION",area.removeFromTop(24),11.0f,Palette::text());
    text(g,"Display only — these switches never change synthesis, modulation, or automation.",
         area.removeFromTop(20),8.5f,Palette::muted());
    constexpr int rowHeight=48;
    for(std::size_t i=0;i<names.size();++i) {
        const int column=static_cast<int>(i%2),row=static_cast<int>(i/2);
        auto cell=juce::Rectangle<int>(area.getX()+column*area.getWidth()/2,
                                      area.getY()+row*rowHeight,
                                      area.getWidth()/2,rowHeight).reduced(12,6);
        well(g,cell);
        text(g,names[i],cell.reduced(12,0),9.5f,Palette::secondary());
    }
}
}
