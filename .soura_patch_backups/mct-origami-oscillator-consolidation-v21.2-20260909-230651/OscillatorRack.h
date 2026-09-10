// mct-origami-v21.1-build-repair-1
#pragma once
#include "OrigamiStyle.h"
#include "core/OscillatorModule.h"
#include "core/ParameterRegistry.h"
#include <memory>
#include <vector>
namespace mct::origami::ui {
// Editor-local display model; intentionally not an engine layer or patch parameter.
// mct-origami-oscillator-live-numbering-v5
struct OscillatorDisplay {
    unsigned id;
    unsigned ordinal;
    juce::String source;
};
class OscillatorCard final : public Panel {
public:
    explicit OscillatorCard(OscillatorDisplay display,std::function<void(unsigned)> remove,
                            std::function<bool(mct::origami::ParameterId,float)> setter={},
                            std::function<float(mct::origami::ParameterId)> getter={});
    unsigned id() const { return display_.id; }
    unsigned ordinal() const { return display_.ordinal; }
    void setOrdinal(unsigned ordinal);
    void resized() override;
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    void refreshVisibleNumber();
    OscillatorDisplay display_;
    juce::TextButton remove_{"-"};
    std::function<bool(mct::origami::ParameterId,float)> parameterSetter_;
    std::function<float(mct::origami::ParameterId)> parameterGetter_;
    juce::Slider panSlider_,levelSlider_;
        // mct-origami-unison-detune-v19.2
    juce::Slider unisonSlider_, detuneSlider_;
    juce::Label unisonLabel_, detuneLabel_;
// mct-origami-tuning-engine-v17
    juce::Slider octaveSlider_,semitoneSlider_,fineSlider_;
    // mct-origami-tuning-labels-v18.3
    juce::Label octaveTitle_,semitoneTitle_,fineTitle_;
    juce::Label panLabel_,levelLabel_;
    juce::TextButton waveformPrevious_{"<"},waveformNext_{">"};
    bool engineBacked_=false;
    int waveformIndex_=0;
};
class OscillatorRack final : public Panel {
public:
    using ParameterSetter=std::function<bool(mct::origami::ParameterId,float)>;
    using ParameterGetter=std::function<float(mct::origami::ParameterId)>;
    using ModuleAdder=std::function<unsigned()>;
    using ModuleRemover=std::function<bool(unsigned)>;
    using ModuleStateSetter=std::function<bool(unsigned,const mct::origami::OscillatorModuleState&)>;
    using ModuleStateGetter=std::function<mct::origami::OscillatorModuleState(unsigned)>;
    OscillatorRack(ParameterSetter setter={},ParameterGetter getter={},
                   ModuleAdder moduleAdder={},ModuleRemover moduleRemover={},
                   ModuleStateSetter moduleStateSetter={},ModuleStateGetter moduleStateGetter={});
    ~OscillatorRack() override;
    void resized() override;
    void addOscillator();
    void removeOscillator(unsigned id);
    int count() const { return static_cast<int>(cards_.size()); }
    const juce::Viewport& viewport() const { return viewport_; }
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    void renumberOscillators();
    void layoutCards();
    juce::Viewport viewport_;
    juce::Component content_;
    juce::TextButton add_{"+ ADD OSCILLATOR"},addTile_{"+"},left_{"<"},right_{">"};
    std::vector<std::unique_ptr<OscillatorCard>> cards_;
    ParameterSetter parameterSetter_;
    ParameterGetter parameterGetter_;
    ModuleAdder moduleAdder_;
    ModuleRemover moduleRemover_;
    ModuleStateSetter moduleStateSetter_;
    ModuleStateGetter moduleStateGetter_;
    unsigned nextId_=1;
    int cardWidth_=250;
};
}
