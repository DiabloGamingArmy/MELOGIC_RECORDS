// mct-origami-v32.0.0-dynamic-mod-filter-collections
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
    std::uint32_t envMask_=0,lfoMask_=0;
    bool filterEnabled_=true;
};
}
