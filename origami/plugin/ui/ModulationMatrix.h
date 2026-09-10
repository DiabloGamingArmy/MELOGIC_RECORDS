#pragma once
#include "OrigamiStyle.h"
#include "ModulationBindings.h"
#include <memory>
#include <vector>
namespace mct::origami::ui {
class ModulationMatrix final : public Panel {
public:
    explicit ModulationMatrix(ModulationBindings);
    ~ModulationMatrix() override;
    void resized() override;
    void syncFromModel();
private:
    class Row;
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    ModulationBindings bindings_;
    juce::Viewport viewport_;
    juce::Component content_;
    juce::TextButton add_{"+ ADD ROUTE"};
    std::vector<std::unique_ptr<Row>> rows_;
    std::vector<unsigned> moduleIds_;
};
}
