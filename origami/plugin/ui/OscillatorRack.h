#pragma once
#include "OrigamiStyle.h"
#include <memory>
#include <vector>
namespace mct::origami::ui {
// Editor-local display model; intentionally not an engine layer or patch parameter.
struct OscillatorDisplay { unsigned id; juce::String source; };
class OscillatorCard final : public Panel {
public:
    explicit OscillatorCard(OscillatorDisplay display,std::function<void(unsigned)> remove);
    unsigned id() const { return display_.id; }
    void resized() override;
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    OscillatorDisplay display_;
    juce::TextButton remove_{"-"};
};
class OscillatorRack final : public Panel {
public:
    OscillatorRack();
    ~OscillatorRack() override;
    void resized() override;
    void addOscillator();
    void removeOscillator(unsigned id);
    int count() const { return static_cast<int>(cards_.size()); }
    const juce::Viewport& viewport() const { return viewport_; }
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    void layoutCards();
    juce::Viewport viewport_;
    juce::Component content_;
    juce::TextButton add_{"+ ADD OSCILLATOR"},addTile_{"+"},left_{"<"},right_{">"};
    std::vector<std::unique_ptr<OscillatorCard>> cards_;
    unsigned nextId_=1;
    int cardWidth_=250;
};
}
