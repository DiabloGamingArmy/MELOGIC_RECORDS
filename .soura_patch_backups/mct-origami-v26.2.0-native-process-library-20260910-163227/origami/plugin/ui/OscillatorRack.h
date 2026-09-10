// mct-origami-v26.0.0-osc-process-foundation
// mct-origami-v21.1-build-repair-1
#pragma once
#include "OrigamiStyle.h"
#include "core/OscillatorModule.h"
#include "core/ParameterRegistry.h"
#include "core/InstrumentState.h"
#include <memory>
#include <vector>
namespace mct::origami::ui {
// Display ordinals are derived from the engine-owned stable module IDs.
// mct-origami-oscillator-live-numbering-v5
struct OscillatorDisplay {
    unsigned id;
    unsigned ordinal;
    juce::String source;
};
// Rack controls delegate every wheel event to the component ancestry. JUCE's
// Viewport retains native axis/modifier handling; explicit slider drags are unchanged.
// Use this type for future editable rack sliders, including pitch text boxes.
class RackSlider final : public juce::Slider {
public:
    bool isEditingText() const {
        for(auto* child:getChildren())
            if(auto* label=dynamic_cast<juce::Label*>(child)) if(label->isBeingEdited()) return true;
        return false;
    }
    void mouseWheelMove(const juce::MouseEvent& e,const juce::MouseWheelDetails& wheel) override {
        juce::Component::mouseWheelMove(e,wheel);
    }
};
class OscillatorCard final : public Panel {
public:
    explicit OscillatorCard(OscillatorDisplay display,std::function<void(unsigned)> remove,
                            std::function<bool(mct::origami::ParameterId,float)> setter={},
                            std::function<float(mct::origami::ParameterId)> getter={},
                            std::function<bool(unsigned,bool)> enabledSetter={},
                            std::function<bool(unsigned)> enabledGetter={},
                            std::function<bool(unsigned,const mct::origami::OscillatorModuleState&)> moduleSetter={},
                            std::function<mct::origami::OscillatorModuleState(unsigned)> moduleGetter={});
    unsigned id() const { return display_.id; }
    unsigned ordinal() const { return display_.ordinal; }
    void setOrdinal(unsigned ordinal);
    void resized() override;
    void syncFromModel();
    void setDisplayOrdinal(unsigned ordinal);
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    void refreshVisibleNumber();
    OscillatorDisplay display_;
    juce::TextButton remove_{"-"};
    juce::TextButton power_{"PWR"};
    std::function<bool(unsigned,bool)> enabledSetter_;
    std::function<bool(unsigned)> enabledGetter_;
    std::function<bool(mct::origami::ParameterId,float)> parameterSetter_;
    std::function<float(mct::origami::ParameterId)> parameterGetter_;
    std::function<bool(unsigned,const mct::origami::OscillatorModuleState&)> moduleSetter_;
    std::function<mct::origami::OscillatorModuleState(unsigned)> moduleGetter_;
    RackSlider panSlider_,levelSlider_;
        // mct-origami-unison-detune-v19.2
    RackSlider wtPositionSlider_;
    juce::Label wtPositionLabel_;
    RackSlider unisonSlider_, detuneSlider_;
    juce::Label unisonLabel_, detuneLabel_;
// mct-origami-tuning-engine-v17
    RackSlider octaveSlider_,semitoneSlider_,fineSlider_;
    juce::ComboBox process1Menu_,process2Menu_;
    RackSlider process1Amount_,process2Amount_;
    juce::Label process1AmountLabel_,process2AmountLabel_;
    bool syncingProcess_=false;
    // mct-origami-tuning-labels-v18.3
    juce::Label octaveTitle_,semitoneTitle_,fineTitle_;
    juce::Label panLabel_,levelLabel_;
    juce::TextButton waveformPrevious_{"<"},waveformNext_{">"};
    bool engineBacked_=false;
    int waveformIndex_=0;
};
// Observe native wheel delivery across all content descendants, including JUCE
// SliderLabelComp (which swallows mouseWheelMove). Ignore their bubbled copy;
// the recursive listener delivers the original exactly once. Keep JUCE's native
// axis, modifier, edge and inertia policy in Viewport.
class RackViewport final : public juce::Viewport {
public:
    void mouseWheelMove(const juce::MouseEvent& e,const juce::MouseWheelDetails& wheel) override {
        auto* content=getViewedComponent();
        const bool fromContent=content && (e.originalComponent==content || content->isParentOf(e.originalComponent));
        if(e.eventComponent==this && fromContent) return;
        juce::Viewport::mouseWheelMove(e.getEventRelativeTo(this),wheel);
    }
};
class OscillatorRack final : public Panel, private juce::Timer {
public:
    using ParameterSetter=std::function<bool(mct::origami::ParameterId,float)>;
    using ParameterGetter=std::function<float(mct::origami::ParameterId)>;
    using ModuleAdder=std::function<unsigned()>;
    using ModuleRemover=std::function<bool(unsigned)>;
    using ModuleStateSetter=std::function<bool(unsigned,const mct::origami::OscillatorModuleState&)>;
    using ModuleStateGetter=std::function<mct::origami::OscillatorModuleState(unsigned)>;
    using ModuleEnabledSetter=std::function<bool(unsigned,bool)>;
    using ModuleEnabledGetter=std::function<bool(unsigned)>;
    OscillatorRack(ParameterSetter setter={},ParameterGetter getter={},
                   ModuleAdder moduleAdder={},ModuleRemover moduleRemover={},
                   ModuleStateSetter moduleStateSetter={},ModuleStateGetter moduleStateGetter={},
                   ModuleEnabledSetter moduleEnabledSetter={},ModuleEnabledGetter moduleEnabledGetter={},
                   std::function<InstrumentState()> snapshotGetter={});
    ~OscillatorRack() override;
    void resized() override;
    void syncFromModel();
    void addOscillator();
    void removeOscillator(unsigned id);
    int count() const { return static_cast<int>(cards_.size()); }
    const juce::Viewport& viewport() const { return viewport_; }
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    void timerCallback() override { syncFromModel(); }
    void createCard(unsigned moduleId);
    std::function<InstrumentState()> snapshotGetter_;
    void renumberOscillators();
    void layoutCards();
    RackViewport viewport_;
    juce::Component content_;
    juce::TextButton add_{"+ ADD OSCILLATOR"},addTile_{"+"},left_{"<"},right_{">"};
    std::vector<std::unique_ptr<OscillatorCard>> cards_;
    ParameterSetter parameterSetter_;
    ParameterGetter parameterGetter_;
    ModuleAdder moduleAdder_;
    ModuleRemover moduleRemover_;
    ModuleStateSetter moduleStateSetter_;
    ModuleStateGetter moduleStateGetter_;
    ModuleEnabledSetter moduleEnabledSetter_;
    ModuleEnabledGetter moduleEnabledGetter_;
    int cardWidth_=250;
};
}
