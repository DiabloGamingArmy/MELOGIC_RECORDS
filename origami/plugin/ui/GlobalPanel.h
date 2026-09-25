#pragma once
#include "OrigamiStyle.h"
#include "VisualizationSettings.h"
#include <array>
#include <functional>

namespace mct::origami::ui {
class GlobalPanel final : public Panel {
public:
    using Getter=std::function<std::uint32_t()>;
    using Setter=std::function<void(std::uint32_t)>;
    GlobalPanel(Getter,Setter);
    void resized() override;
    void syncFromModel();
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    void updateButton(std::size_t,bool);
    Getter getter_;
    Setter setter_;
    std::array<juce::TextButton,8> toggles_;
    bool syncing_=false;
};
}
