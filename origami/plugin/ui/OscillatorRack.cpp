// mct-origami-v32.2.1-scroll-drag-matrix-hotfix
// mct-origami-v31.2.1-mod-ring-retrigger-refine
// mct-origami-v31.2.0-mod-visuals-wavetable-spectral
// mct-origami-v29.2.1-osc-route-display-ordinals
// mct-origami-v29.2.0-randsparse-reseed-routefix
// mct-origami-v29.1.1-rand-amp-smooth-morph-seed-button
// mct-origami-v29.1.0-rand-amp-variants-ui-polish
// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v27.1.0-expanded-cross-osc-routing
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.4.1-flat-signal-fills
// mct-origami-v26.4.0-global-signal-colour-system
// mct-origami-v26.3.2-osc-process-quick-nav
// mct-origami-v26.3.1-bend-bipolar-global-knob-shortcuts
// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-v26.2.0-native-process-library
// mct-origami-v26.1.0-live-wavetable-process-view
// mct-origami-v26.0.0-osc-process-foundation
// mct-origami-modulation-completion-v24.0.1
// mct-origami-relative-drag-linear-controls-v23.3.4
// mct-origami-basic-shapes-identity-v22.6
// mct-origami-osc-interaction-rotary-cleanup-v22.5
// mct-origami-osc1-smooth-basic-shapes-v22.3
// mct-origami-wt-pos-real-morph-v22.2.1
// mct-origami-v22.1-ui-scope-repair-1
// mct-origami-v33.1.2-osc-blend-engine
// mct-origami-v34.2.1-performance-reinforcement
#include <cmath>
// mct-origami-wt-position-wiring-v22.1
// mct-origami-osc-power-compact-pitch-v21.4.1
#include "OscillatorRack.h"
#include "NativeOscProcessMenu.h"
#include "NativeChoiceMenu.h"
#include "ModulationUiTelemetry.h"
// mct-origami-v19.3-visual-cleanup
namespace mct::origami::ui {

OscRouteSelector::OscRouteSelector() {
    setMouseCursor(juce::MouseCursor::PointingHandCursor);
    setTooltip("Choose source oscillator and cross-oscillator routing type");
    onClick=[this]{openRouteMenu();};
    refreshText();
}

void OscRouteSelector::setContext(OscillatorModuleId target,
                                  std::function<InstrumentState()> snapshotGetter) {
    targetId_=target;
    snapshotGetter_=std::move(snapshotGetter);
    refreshText();
}

void OscRouteSelector::setSelection(OscillatorModuleId source,OscRouteType type,
                                    juce::NotificationType notification) {
    const bool changed=source!=sourceId_ || type!=type_;
    sourceId_=type==OscRouteType::Off ? 0 : source;
    type_=type;
    refreshText();
    if(changed && notification!=juce::dontSendNotification && onChange) onChange();
}

void OscRouteSelector::refreshText() {
    if(type_==OscRouteType::Off || sourceId_==0) {
        setButtonText("Off");
        return;
    }

    // IMPORTANT: sourceId_ is the engine's stable module identity, NOT the
    // user-visible oscillator number. IDs intentionally keep increasing after
    // modules are removed/re-added (e.g. internal IDs 13/14/15 can visibly be
    // OSC 1/2/3). Resolve the current display ordinal from the live snapshot.
    unsigned displayOrdinal=0;
    if(snapshotGetter_) {
        const auto state=snapshotGetter_();
        unsigned ordinal=0;
        for(const auto& oscillator:state.oscillators) {
            if(oscillator.id==0) continue;
            ++ordinal;
            if(oscillator.id==sourceId_) {
                displayOrdinal=ordinal;
                break;
            }
        }
    }

    // Defensive fallback only if the referenced source disappeared between
    // state synchronization and this repaint.
    const auto labelNumber=displayOrdinal!=0
        ? juce::String(displayOrdinal)
        : juce::String("?");

    setButtonText("OSC "+labelNumber+" · "+oscRouteShortName(type_));
}

void OscRouteSelector::openRouteMenu() {
    if(!snapshotGetter_) return;
    const auto state=snapshotGetter_();
    auto safe=juce::Component::SafePointer<OscRouteSelector>(this);
    showNativeOscRouteMenu(*this,targetId_,sourceId_,type_,state,
        [safe](OscillatorModuleId source,OscRouteType type) {
            if(safe==nullptr) return;
            safe->setSelection(source,type,juce::sendNotification);
        });
}

void OscRouteSelector::cycle(int delta) {
    if(delta==0) return;

    struct Choice {
        OscillatorModuleId source=0;
        OscRouteType type=OscRouteType::Off;
    };

    std::vector<Choice> choices;
    choices.push_back({0,OscRouteType::Off});

    if(snapshotGetter_) {
        const auto state=snapshotGetter_();
        for(const auto& source:state.oscillators) {
            if(source.id==0 || source.id==targetId_) continue;
            for(auto type:oscRouteTypes)
                choices.push_back({source.id,type});
        }
    }

    if(choices.size()<=1) return;

    std::size_t current=0;
    for(std::size_t i=0;i<choices.size();++i) {
        if(choices[i].source==sourceId_ && choices[i].type==type_) {
            current=i;
            break;
        }
    }

    const int size=static_cast<int>(choices.size());
    const int wrapped=(static_cast<int>(current)+delta%size+size)%size;
    const auto next=choices[static_cast<std::size_t>(wrapped)];
    setSelection(next.source,next.type,juce::sendNotification);
}

NativeOscProcessSelector::NativeOscProcessSelector() {
    setName("OSC PROCESS SELECTOR");
    setButtonText(dsp::oscProcessName(type_));
    setTooltip("Choose oscillator process");
    setMouseCursor(juce::MouseCursor::PointingHandCursor);
    onClick=[this]{openProcessMenu();};
}
void NativeOscProcessSelector::setSelectedId(int id,juce::NotificationType notification) {
    const int raw=juce::jlimit(0,static_cast<int>(dsp::OscProcessType::Count)-1,id-1);
    const auto next=static_cast<dsp::OscProcessType>(raw);
    const bool changed=next!=type_;
    type_=next;
    setButtonText(dsp::oscProcessName(type_));
    if(changed && notification!=juce::dontSendNotification && onChange) onChange();
}
void NativeOscProcessSelector::setRoutingContext(
    OscillatorModuleId target,std::function<InstrumentState()> getter,
    std::function<void(OscillatorModuleId,OscRouteType)> onRouteSelected) {
    routeTarget_=target;routeStateGetter_=std::move(getter);onRouteSelected_=std::move(onRouteSelected);
}
void NativeOscProcessSelector::openProcessMenu() {
    if(popupActive_) return;
    popupActive_=true;
    auto safe=juce::Component::SafePointer<NativeOscProcessSelector>(this);
    auto state=routeStateGetter_?routeStateGetter_():InstrumentState{};
    const auto* routeState=routeStateGetter_?&state:nullptr;
    showNativeOscProcessMenu(*this,type_,[safe](dsp::OscProcessType selected) {
        if(safe==nullptr) return;
        safe->popupActive_=false;
        safe->setSelectedId(static_cast<int>(selected)+1,juce::sendNotification);
    },routeTarget_,routeState,[safe](OscillatorModuleId source,OscRouteType type) {
        if(safe==nullptr)return;
        safe->popupActive_=false;
        if(safe->onRouteSelected_)safe->onRouteSelected_(source,type);
    });
    if(safe!=nullptr) safe->popupActive_=false;
}

OscillatorCard::OscillatorCard(OscillatorDisplay display,std::function<void(unsigned)> remove,
                               std::function<bool(mct::origami::ParameterId,float)> setter,
                               std::function<float(mct::origami::ParameterId)> getter,
                               std::function<bool(unsigned,bool)> enabledSetter,
                               std::function<bool(unsigned)> enabledGetter,
                               std::function<bool(unsigned,const mct::origami::OscillatorModuleState&)> moduleSetter,
                               std::function<mct::origami::OscillatorModuleState(unsigned)> moduleGetter,
                               std::function<mct::origami::InstrumentState()> snapshotGetter)
    : Panel("OSC "+juce::String(display.ordinal)),display_(std::move(display)),
      enabledSetter_(std::move(enabledSetter)),enabledGetter_(std::move(enabledGetter)),
      parameterSetter_(std::move(setter)),parameterGetter_(std::move(getter)),
      moduleSetter_(std::move(moduleSetter)),moduleGetter_(std::move(moduleGetter)),
      snapshotGetter_(std::move(snapshotGetter)) {
    addAndMakeVisible(remove_);
    remove_.setTooltip("Remove this oscillator module");
    remove_.onClick=[id=display_.id,removeCallback=std::move(remove)] { removeCallback(id); };

    // The header is now an explicit oscillator configuration strip rather than
    // free-painted source text plus controls pinned to the right edge.
    addAndMakeVisible(modeSelector_);
    addAndMakeVisible(phaseSelector_);
    addAndMakeVisible(outputSelector_);
    modeSelector_.setTooltip("Oscillator mode");
    phaseSelector_.setTooltip("Oscillator phase configuration");
    outputSelector_.setTooltip("Oscillator output routing");
    modeSelector_.setMouseCursor(juce::MouseCursor::PointingHandCursor);
    phaseSelector_.setMouseCursor(juce::MouseCursor::PointingHandCursor);
    outputSelector_.setMouseCursor(juce::MouseCursor::PointingHandCursor);

    // MODE is a discrete choice, so use Origami's platform-native choice menu
    // (NSMenu on macOS) rather than a JUCE-styled PopupMenu.
    modeSelector_.onClick=[safe=juce::Component::SafePointer<OscillatorCard>(this)] {
        if(safe==nullptr) return;
        const std::vector<NativeChoiceItem> choices{
            {1,"Wavetable",true,{},true},
            {2,"Sample",false,{},false},
            {3,"Granular",false,{},false},
            {4,"Spectral",false,{},false},
            {5,"Field",false,{},false},
            {6,"Gendrift",false,{},false},
            {7,"Quasar",false,{},false},
            {8,"Kinetic",false,{},false},
            {9,"Automata",false,{},false},
            {10,"Hive",false,{},false},
            {11,"Recursion",false,{},false},
            {12,"Collider",false,{},false},
            {13,"Cipher",false,{},false},
            {14,"Daemon",false,{},false}
        };
        showNativeChoiceMenu(safe->modeSelector_,"Oscillator Mode",choices,1,[safe](int result) {
            if(safe==nullptr || result!=1) return;
            safe->modeSelector_.setButtonText("WAVETABLE");
            safe->setWorkspacePage(WorkspacePage::Main);
        });
    };
    phaseSelector_.onClick=[safe=juce::Component::SafePointer<OscillatorCard>(this)] {
        if(safe==nullptr) return;
        safe->setWorkspacePage(safe->workspacePage_==WorkspacePage::Phase
                               ? WorkspacePage::Main : WorkspacePage::Phase);
    };
    outputSelector_.onClick=[safe=juce::Component::SafePointer<OscillatorCard>(this)] {
        if(safe==nullptr) return;
        safe->setWorkspacePage(safe->workspacePage_==WorkspacePage::Routing
                               ? WorkspacePage::Main : WorkspacePage::Routing);
    };

    for(auto* button:{&phaseRandom_,&phaseFixed_,&phaseFree_,&phaseRetrigger_,&phasePerUnison_}) {
        addChildComponent(*button);
        button->setMouseCursor(juce::MouseCursor::PointingHandCursor);
    }
    phaseRandom_.setTooltip("Randomize oscillator start phase per note");
    phaseFixed_.setTooltip("Use a fixed oscillator start phase");
    phaseFree_.setTooltip("Let oscillator phase free-run");
    phaseRetrigger_.setClickingTogglesState(true);
    phaseRetrigger_.setToggleState(true,juce::dontSendNotification);
    phaseRetrigger_.setTooltip("Retrigger phase on each note");
    phasePerUnison_.setClickingTogglesState(true);
    phasePerUnison_.setToggleState(true,juce::dontSendNotification);
    phasePerUnison_.setTooltip("Randomize phase independently across unison voices");

    for(auto* slider:{&phaseAngle_,&phaseRandomRange_}) {
        addChildComponent(*slider);
        slider->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        slider->setTextBoxStyle(juce::Slider::TextBoxBelow,false,46,14);
        slider->setRotaryParameters(juce::MathConstants<float>::pi*1.20f,
                                    juce::MathConstants<float>::pi*2.80f,true);
        slider->setMouseDragSensitivity(180);
    }
    phaseAngle_.setRange(0.0,360.0,1.0);
    phaseAngle_.setValue(0.0,juce::dontSendNotification);
    phaseAngle_.setTextValueSuffix(juce::String::fromUTF8("°"));
    phaseRandomRange_.setRange(0.0,360.0,1.0);
    phaseRandomRange_.setValue(360.0,juce::dontSendNotification);
    phaseRandomRange_.setTextValueSuffix(juce::String::fromUTF8("°"));

    for(auto* label:{&phaseAngleLabel_,&phaseRandomRangeLabel_}) {
        addChildComponent(*label);
        label->setJustificationType(juce::Justification::centred);
        label->setColour(juce::Label::textColourId,Palette::muted());
        label->setFont(juce::FontOptions(7.4f));
        label->setInterceptsMouseClicks(false,false);
    }
    phaseAngleLabel_.setText("FIXED PHASE",juce::dontSendNotification);
    phaseRandomRangeLabel_.setText("RANDOM RANGE",juce::dontSendNotification);

    phaseRandom_.onClick=[this]{phaseStartMode_=PhaseStartMode::Random;refreshPhaseWorkspace();};
    phaseFixed_.onClick=[this]{phaseStartMode_=PhaseStartMode::Fixed;refreshPhaseWorkspace();};
    phaseFree_.onClick=[this]{phaseStartMode_=PhaseStartMode::Free;refreshPhaseWorkspace();};
    refreshPhaseWorkspace();

    for(auto* button:{&routeDirect_,&routeFilter1_,&routeFilter2_,&routeMulti_,&routePostChain_}) {
        addChildComponent(*button);
        button->setMouseCursor(juce::MouseCursor::PointingHandCursor);
    }
    routeDirect_.setTooltip("Route oscillator directly to the instrument output");
    routeFilter1_.setTooltip("Route oscillator through Filter 1");
    routeFilter2_.setTooltip("Route oscillator through Filter 2");
    routeMulti_.setTooltip("Use multiple oscillator output destinations");
    routePostChain_.setClickingTogglesState(true);
    routePostChain_.setToggleState(true,juce::dontSendNotification);
    routePostChain_.setTooltip("Route the post-OSC-CHAIN signal");

    for(auto* slider:{&routeDirectLevel_,&routeFilter1Level_,&routeFilter2Level_}) {
        addChildComponent(*slider);
        slider->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        slider->setTextBoxStyle(juce::Slider::TextBoxBelow,false,44,14);
        slider->setRotaryParameters(juce::MathConstants<float>::pi*1.20f,
                                    juce::MathConstants<float>::pi*2.80f,true);
        slider->setRange(0.0,1.0,0.001);
        slider->setMouseDragSensitivity(180);
        slider->setDoubleClickReturnValue(true,1.0);
    }
    routeDirectLevel_.setValue(1.0,juce::dontSendNotification);
    routeFilter1Level_.setValue(1.0,juce::dontSendNotification);
    routeFilter2Level_.setValue(1.0,juce::dontSendNotification);

    struct RouteLevelLabel { juce::Label* label; const char* text; };
    for(auto item:std::array<RouteLevelLabel,3>{
        RouteLevelLabel{&routeDirectLevelLabel_,"DIRECT LEVEL"},
        RouteLevelLabel{&routeFilter1LevelLabel_,"FILTER 1 LEVEL"},
        RouteLevelLabel{&routeFilter2LevelLabel_,"FILTER 2 LEVEL"}}) {
        addChildComponent(*item.label);
        item.label->setText(item.text,juce::dontSendNotification);
        item.label->setJustificationType(juce::Justification::centred);
        item.label->setColour(juce::Label::textColourId,Palette::muted());
        item.label->setFont(juce::FontOptions(7.2f));
        item.label->setInterceptsMouseClicks(false,false);
    }
    routeDirect_.onClick=[this]{outputRouteMode_=OutputRouteMode::Direct;refreshRoutingWorkspace();};
    routeFilter1_.onClick=[this]{outputRouteMode_=OutputRouteMode::Filter1;refreshRoutingWorkspace();};
    routeFilter2_.onClick=[this]{outputRouteMode_=OutputRouteMode::Filter2;refreshRoutingWorkspace();};
    routeMulti_.onClick=[this]{outputRouteMode_=OutputRouteMode::Multi;refreshRoutingWorkspace();};
    refreshRoutingWorkspace();

    engineBacked_ = static_cast<bool>(parameterSetter_) && static_cast<bool>(parameterGetter_);
    if(engineBacked_) {
        for(auto* slider:{&panSlider_,&levelSlider_}) {
            addAndMakeVisible(slider);
            slider->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
            slider->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
            slider->setRotaryParameters(juce::MathConstants<float>::pi*1.20f,
                                        juce::MathConstants<float>::pi*2.80f,true);
            slider->setMouseDragSensitivity(180);
        }

        addAndMakeVisible(waveformPrevious_);
        addAndMakeVisible(waveformNext_);
        waveformPrevious_.setTooltip("Previous wavetable (only Basic Shapes is currently installed)");
        waveformNext_.setTooltip("Next wavetable (only Basic Shapes is currently installed)");
        waveformPrevious_.setEnabled(false);
        waveformNext_.setEnabled(false);
        panSlider_.setName("OSC PAN");
        panSlider_.getProperties().set("mct.origami.knobDefault",0.0);
        panSlider_.setRange(-1.0,1.0,0.001);
        levelSlider_.setRange(0.0,1.0,0.001);
        panSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscPan),juce::dontSendNotification);
        levelSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscLevel),juce::dontSendNotification);

        const auto tagDestination=[this](juce::Slider& slider,ModDestination destination) {
            slider.getProperties().set("mct.mod.destination",static_cast<int>(destination));
            slider.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
        };
        tagDestination(panSlider_,ModDestination::Pan);
        tagDestination(levelSlider_,ModDestination::Level);

        waveformIndex_=juce::jlimit(0,3,juce::roundToInt(parameterGetter_(mct::origami::ParameterId::Waveform)));

        for(auto* slider:{&octaveSlider_,&semitoneSlider_,&fineSlider_}) {
            addAndMakeVisible(slider);
            slider->setSliderStyle(juce::Slider::LinearBarVertical);
            slider->setTextBoxStyle(juce::Slider::TextBoxBelow,false,38,14);
            // V23.3.4: OCT/SEM/FIN preserve their current value on mouse-down.
            slider->setSliderSnapsToMousePosition(false);
            slider->setColour(juce::Slider::backgroundColourId,Palette::inset());
            slider->setColour(juce::Slider::trackColourId,Palette::borderStrong());
            slider->setColour(juce::Slider::thumbColourId,Palette::text());
            slider->setColour(juce::Slider::textBoxTextColourId,Palette::text());
            slider->setColour(juce::Slider::textBoxBackgroundColourId,Palette::inset());
            slider->setColour(juce::Slider::textBoxOutlineColourId,Palette::borderSoft());
        }
        octaveSlider_.setName("OSC TUNING OCT");semitoneSlider_.setName("OSC TUNING SEM");fineSlider_.setName("OSC TUNING FIN");
        octaveSlider_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::Octave));
        octaveSlider_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
        semitoneSlider_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::Semitone));
        semitoneSlider_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
        fineSlider_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::Fine));
        fineSlider_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
        octaveSlider_.setRange(-4,4,1);
        semitoneSlider_.setRange(-12,12,1);
        fineSlider_.setRange(-100,100,1);

        struct TuningTitle { juce::Label* label; const char* text; };
        for (auto item : std::array<TuningTitle,3>{
            TuningTitle{&octaveTitle_,"OCT"},
            TuningTitle{&semitoneTitle_,"SEM"},
            TuningTitle{&fineTitle_,"FIN"}
        }) {
            addAndMakeVisible(*item.label);
            item.label->setText(item.text,juce::dontSendNotification);
            item.label->setJustificationType(juce::Justification::centred);
            item.label->setColour(juce::Label::textColourId,Palette::muted());
            item.label->setFont(juce::FontOptions(7.8f));
            item.label->setInterceptsMouseClicks(false,false);
        }
        octaveSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscOctave),juce::dontSendNotification);
        semitoneSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscSemitone),juce::dontSendNotification);
        fineSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscFine),juce::dontSendNotification);
        octaveSlider_.onValueChange=[this]{ parameterSetter_(mct::origami::ParameterId::OscOctave,float(octaveSlider_.getValue())); };
        semitoneSlider_.onValueChange=[this]{ parameterSetter_(mct::origami::ParameterId::OscSemitone,float(semitoneSlider_.getValue())); };
        fineSlider_.onValueChange=[this]{ parameterSetter_(mct::origami::ParameterId::OscFine,float(fineSlider_.getValue())); };

        panSlider_.onValueChange=[this]{
            parameterSetter_(mct::origami::ParameterId::OscPan,float(panSlider_.getValue()));
            repaint();
        };
        levelSlider_.onValueChange=[this]{
            parameterSetter_(mct::origami::ParameterId::OscLevel,float(levelSlider_.getValue()));
            repaint();
        };

        for (auto* slider : {&unisonSlider_, &detuneSlider_, &blendSlider_}) {
            addAndMakeVisible(*slider);
            slider->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
            slider->setTextBoxStyle(juce::Slider::NoTextBox, false, 0, 0);
            slider->setRotaryParameters(juce::MathConstants<float>::pi * 1.20f,
                                        juce::MathConstants<float>::pi * 2.80f, true);
            slider->setMouseDragSensitivity(180);
        }

        // mct-origami-audio-reengineer-p05.6-control-identity
        levelSlider_.setName("OSC LEVEL");
        unisonSlider_.setName("OSC UNISON");
        detuneSlider_.setName("OSC DETUNE");
        blendSlider_.setName("OSC BLEND");

        unisonSlider_.setRange(1.0, 16.0, 1.0);
        detuneSlider_.setRange(0.0, 100.0, 0.1);
        blendSlider_.setRange(0.0,1.0,0.001);
        blendSlider_.setTooltip("Unison blend — centre oscillator to full detuned stack");
        detuneSlider_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::Detune));
        detuneSlider_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
        unisonSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscUnison), juce::dontSendNotification);
        detuneSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscDetune), juce::dontSendNotification);
        if(moduleGetter_) {
            const auto state=moduleGetter_(display_.id);
            if(state.id) blendSlider_.setValue(state.blend,juce::dontSendNotification);
        }

        unisonSlider_.onValueChange = [this] {
            parameterSetter_(mct::origami::ParameterId::OscUnison,
                             static_cast<float>(unisonSlider_.getValue()));
            repaint();
        };
        detuneSlider_.onValueChange = [this] {
            parameterSetter_(mct::origami::ParameterId::OscDetune,
                             static_cast<float>(detuneSlider_.getValue()));
            repaint();
        };
        blendSlider_.onValueChange=[this] {
            if(!moduleGetter_ || !moduleSetter_) return;
            auto state=moduleGetter_(display_.id);
            if(!state.id) return;
            state.blend=static_cast<float>(blendSlider_.getValue());
            moduleSetter_(display_.id,state);
            repaint();
        };

        addAndMakeVisible(unisonLabel_);
        addAndMakeVisible(detuneLabel_);
        addAndMakeVisible(blendLabel_);
        unisonLabel_.setText("UNISON", juce::dontSendNotification);
        detuneLabel_.setText("DETUNE", juce::dontSendNotification);
        blendLabel_.setText("BLEND",juce::dontSendNotification);
        for (auto* label : {&unisonLabel_, &detuneLabel_, &blendLabel_}) {
            label->setJustificationType(juce::Justification::centred);
            label->setColour(juce::Label::textColourId, Palette::muted());
            label->setFont(juce::FontOptions(8.0f));
            label->setInterceptsMouseClicks(false, false);
        }
        // V22.6: browser arrows are reserved for wavetable selection.
        // Basic Shapes is currently the only installed table, so they remain disabled.
        // WT POS alone controls interpolation between frames inside Basic Shapes.

        for(auto* label:{&panLabel_,&levelLabel_}) {
            addAndMakeVisible(label);
            label->setJustificationType(juce::Justification::centred);
            label->setColour(juce::Label::textColourId,Palette::muted());
            label->setFont(juce::FontOptions(8.0f));
        }
        panLabel_.setText("PAN",juce::dontSendNotification);
        levelLabel_.setText("LEVEL",juce::dontSendNotification);
    }

    addAndMakeVisible(processRowPower_);
    addAndMakeVisible(processRowRemove_);
    processRowPower_.setClickingTogglesState(true);
    processRowPower_.setName("OSC PROCESS POWER");
    processRowPower_.setButtonText("PWR");
    processRowPower_.setToggleState(true,juce::dontSendNotification);
    processRowPower_.setTooltip("Bypass this oscillator process");
    processRowRemove_.setTooltip("Remove this oscillator process");
    processRowRemove_.onClick=[this] {
        // The row action belongs to the selected chain child, regardless of
        // whether that child is a process or an oscillator route.
        removeSelectedChainItem();
    };

    for(auto* menu:{&process1Menu_,&process2Menu_}) {
        addAndMakeVisible(*menu);
        menu->setScrollWheelEnabled(false);
        menu->setTooltip("Oscillator phase process — native system menu");
    }

    auto configureProcessArrow=[](juce::TextButton& button,const juce::String& tooltip) {
        button.setTooltip(tooltip);
        button.setMouseCursor(juce::MouseCursor::PointingHandCursor);
        button.setConnectedEdges(juce::Button::ConnectedOnLeft | juce::Button::ConnectedOnRight);
    };
    for(auto* button:{&process1Previous_,&process1Next_,&process2Previous_,&process2Next_,
                       &process1Randomize_,&process2Randomize_})
        addAndMakeVisible(*button);

    configureProcessArrow(process1Previous_,"Previous oscillator process");
    configureProcessArrow(process1Next_,"Next oscillator process");
    configureProcessArrow(process2Previous_,"Previous oscillator process");
    configureProcessArrow(process2Next_,"Next oscillator process");
    configureProcessArrow(process1Randomize_,"Re-seed random spectral process");
    configureProcessArrow(process2Randomize_,"Re-seed random spectral process");
    process1Randomize_.setName("OSC PROCESS RESEED");
    process2Randomize_.setName("OSC PROCESS RESEED");
    process1Randomize_.setButtonText({});
    process2Randomize_.setButtonText({});

    auto cycleProcess=[](NativeOscProcessSelector& selector,int delta) {
        constexpr int firstId=1;
        const int count=static_cast<int>(dsp::OscProcessType::Count);
        const int current=juce::jlimit(firstId,count,selector.getSelectedId());
        const int zeroBased=current-firstId;
        const int wrapped=(zeroBased+delta+count)%count;
        selector.setSelectedId(wrapped+firstId,juce::sendNotification);
    };

    process1Previous_.onClick=[this,cycleProcess]{cycleProcess(process1Menu_,-1);};
    process1Next_.onClick=[this,cycleProcess]{cycleProcess(process1Menu_,1);};
    process2Previous_.onClick=[this,cycleProcess]{cycleProcess(process2Menu_,-1);};
    process2Next_.onClick=[this,cycleProcess]{cycleProcess(process2Menu_,1);};

    auto reseed=[this](int slot) {
        if(!moduleGetter_ || !moduleSetter_) return;
        auto state=moduleGetter_(display_.id); if(!state.id) return;
        auto seed=static_cast<std::uint32_t>(juce::Random::getSystemRandom().nextInt());
        if(seed==0) seed=0x6d2b79f5u;
        if(slot==0 && selectedProcessId_) {
            for(std::size_t i=0;i<state.processCount;++i)
                if(state.processes[i].id==selectedProcessId_) {state.processes[i].seed=seed;break;}
        } else if(slot==0) state.process1Seed=seed;
        else state.process2Seed=seed;
        moduleSetter_(display_.id,state);syncFromModel();repaint();
    };
    process1Randomize_.onClick=[reseed]{reseed(0);};
    process2Randomize_.onClick=[reseed]{reseed(1);};

    process1Amount_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::Process1Amount));
    process1Amount_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
    process2Amount_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::Process2Amount));
    process2Amount_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
    for(auto* amount:{&process1Amount_,&process2Amount_}) {
        addAndMakeVisible(*amount);
        amount->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        amount->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
        amount->setRotaryParameters(juce::MathConstants<float>::pi*1.20f,
                                    juce::MathConstants<float>::pi*2.80f,true);
        amount->setRange(0.0,1.0,0.001);
        amount->setMouseDragSensitivity(180);
        amount->setTooltip("Process magnitude");
    }
    for(auto* label:{&process1AmountLabel_,&process2AmountLabel_}) {
        addAndMakeVisible(*label);
        label->setJustificationType(juce::Justification::centred);
        label->setColour(juce::Label::textColourId,Palette::muted());
        label->setFont(juce::FontOptions(7.2f));
        label->setInterceptsMouseClicks(false,false);
    }
    auto commitProcess=[this] {
        if(syncingProcess_ || !selectedProcessId_ || !moduleGetter_ || !moduleSetter_) return;
        auto state=moduleGetter_(display_.id); if(!state.id) return;
        for(std::size_t i=0;i<state.processCount;++i) if(state.processes[i].id==selectedProcessId_) {
            auto& process=state.processes[i];
            process.type=static_cast<dsp::OscProcessType>(
                juce::jlimit(0,static_cast<int>(dsp::OscProcessType::Count)-1,process1Menu_.getSelectedId()-1));
            process.amount=juce::jlimit(dsp::oscProcessAmountMinimum(process.type),1.0f,
                                        static_cast<float>(process1Amount_.getValue()));
            break;
        }
        moduleSetter_(display_.id,state);syncFromModel();
    };
    process1Menu_.setRoutingContext(display_.id,snapshotGetter_,
        [this](OscillatorModuleId sourceId,OscRouteType type) {
            if(!selectedProcessId_ || !moduleGetter_ || !moduleSetter_ ||
               sourceId==0 || type==OscRouteType::Off) return;
            auto state=moduleGetter_(display_.id);if(!state.id || state.routeCount>=maxOscRoutes)return;
            std::size_t index=state.processCount;
            for(std::size_t i=0;i<state.processCount;++i)
                if(state.processes[i].id==selectedProcessId_){index=i;break;}
            if(index>=state.processCount)return;
            for(std::size_t i=index+1;i<state.processCount;++i)state.processes[i-1]=state.processes[i];
            state.processes[--state.processCount]={};
            auto& route=state.routes[state.routeCount++];
            route.id=state.nextRouteId++;route.sourceId=sourceId;route.type=type;route.amount=0.5f;
            if(moduleSetter_(display_.id,state))
                selectedChainItem_={ChainItemKind::Route,route.id};
            syncFromModel();resized();repaint();
        });
    process1Menu_.onChange=commitProcess;
    process2Menu_.onChange=commitProcess;
    process1Amount_.onValueChange=commitProcess;
    process2Amount_.onValueChange=commitProcess;

    // Cross-oscillator routing duplicates the OSC PROCESS interaction density:
    // one dropdown + one magnitude knob per slot.
    route1Menu_.setContext(display_.id,snapshotGetter_);
    route2Menu_.setContext(display_.id,snapshotGetter_);
    for(auto* menu:{&route1Menu_,&route2Menu_}) addAndMakeVisible(*menu);

    // Match OSC PROCESS navigation exactly: compact left/right audition arrows
    // around both routing selectors.
    for(auto* button:{&route1Previous_,&route1Next_,&route2Previous_,&route2Next_}) {
        addAndMakeVisible(*button);
        button->setMouseCursor(juce::MouseCursor::PointingHandCursor);
        button->setConnectedEdges(juce::Button::ConnectedOnLeft | juce::Button::ConnectedOnRight);
    }
    route1Previous_.setTooltip("Previous OSC routing combination");
    route1Next_.setTooltip("Next OSC routing combination");
    route2Previous_.setTooltip("Previous OSC routing combination");
    route2Next_.setTooltip("Next OSC routing combination");

    route1Previous_.onClick=[this]{route1Menu_.cycle(-1);};
    route1Next_.onClick=[this]{route1Menu_.cycle(1);};
    route2Previous_.onClick=[this]{route2Menu_.cycle(-1);};
    route2Next_.onClick=[this]{route2Menu_.cycle(1);};

    route1Amount_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::Route1Amount));
    route1Amount_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
    route2Amount_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::Route2Amount));
    route2Amount_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
    for(auto* amount:{&route1Amount_,&route2Amount_}) {
        addAndMakeVisible(*amount);
        amount->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        amount->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
        amount->setRotaryParameters(juce::MathConstants<float>::pi*1.20f,
                                    juce::MathConstants<float>::pi*2.80f,true);
        amount->setRange(-1.0,1.0,0.001);
        amount->setName("OSC PROCESS BIPOLAR");
        amount->setMouseDragSensitivity(180);
        amount->setTooltip("Cross-oscillator routing amount");
    }
    for(auto* label:{&route1AmountLabel_,&route2AmountLabel_}) {
        addAndMakeVisible(*label);
        label->setJustificationType(juce::Justification::centred);
        label->setColour(juce::Label::textColourId,Palette::muted());
        label->setFont(juce::FontOptions(7.2f));
        label->setInterceptsMouseClicks(false,false);
    }

    auto commitRouting=[this] {
        if(syncingProcess_ || !selectedRouteId_ || !moduleGetter_ || !moduleSetter_) return;
        auto state=moduleGetter_(display_.id); if(!state.id) return;
        for(std::size_t i=0;i<state.routeCount;++i) if(state.routes[i].id==selectedRouteId_) {
            auto& route=state.routes[i];
            route.sourceId=route1Menu_.sourceId();
            route.type=route1Menu_.routeType();
            route.amount=static_cast<float>(route1Amount_.getValue());
            break;
        }
        moduleSetter_(display_.id,state);syncFromModel();
    };

    route1Menu_.onChange=commitRouting;
    route2Menu_.onChange=commitRouting;
    route1Amount_.onValueChange=commitRouting;
    route2Amount_.onValueChange=commitRouting;

    // One OSC CHAIN presentation list. Processes and routes retain separate
    // authoritative state/DSP collections underneath.
    addAndMakeVisible(chainViewport_);
    chainViewport_.setViewedComponent(&chainContent_,false);
    chainViewport_.setScrollBarsShown(true,false);
    chainViewport_.setScrollBarThickness(4);
    for(std::size_t i=0;i<maxChainItems;++i) {
        chainContent_.addAndMakeVisible(chainRowBackgrounds_[i]);
        chainContent_.addAndMakeVisible(chainSelectors_[i]);
        chainContent_.addAndMakeVisible(chainAmounts_[i]);
        chainContent_.addAndMakeVisible(chainPowers_[i]);
        chainContent_.addAndMakeVisible(chainDeletes_[i]);
        chainContent_.addAndMakeVisible(chainKinds_[i]);
        chainContent_.addAndMakeVisible(chainActions_[i]);
        chainActions_[i].setButtonText({});
        chainActions_[i].setName("OSC PROCESS RESEED");
        chainActions_[i].setTooltip("Re-seed this random oscillator process");
        chainActions_[i].setMouseCursor(juce::MouseCursor::PointingHandCursor);
        chainActions_[i].onClick=[this,i] {
            if(syncingProcess_ || i>=chainItemCount_ || !moduleGetter_ || !moduleSetter_) return;
            const auto item=chainItems_[i];
            if(item.kind!=ChainItemKind::Process) return;
            auto state=moduleGetter_(display_.id); if(!state.id) return;
            for(std::size_t n=0;n<state.processCount;++n) {
                auto& process=state.processes[n];
                if(process.id!=item.id || !dsp::oscProcessUsesSeed(process.type)) continue;
                auto seed=static_cast<std::uint32_t>(juce::Random::getSystemRandom().nextInt());
                if(seed==0) seed=0x6d2b79f5u;
                process.seed=seed;
                if(moduleSetter_(display_.id,state)) { syncFromModel(); repaint(); }
                return;
            }
        };
        chainAmounts_[i].setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        chainAmounts_[i].setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
        chainAmounts_[i].setRotaryParameters(juce::MathConstants<float>::pi*1.20f,juce::MathConstants<float>::pi*2.80f,true);
        chainAmounts_[i].setMouseDragSensitivity(180);
        chainPowers_[i].setButtonText("PWR");
        chainPowers_[i].setClickingTogglesState(true);
        chainPowers_[i].setToggleState(true,juce::dontSendNotification);
        chainPowers_[i].setTooltip("Enable / bypass this OSC CHAIN item");
        chainPowers_[i].onClick=[this,i] {
            if(syncingProcess_ || i>=chainItemCount_ || !moduleGetter_ || !moduleSetter_) return;
            auto state=moduleGetter_(display_.id);
            if(!state.id) return;
            const auto item=chainItems_[i];
            const bool enabled=chainPowers_[i].getToggleState();
            if(item.kind==ChainItemKind::Process) {
                for(std::size_t n=0;n<state.processCount;++n)
                    if(state.processes[n].id==item.id) { state.processes[n].enabled=enabled; break; }
            } else if(item.kind==ChainItemKind::Route) {
                for(std::size_t n=0;n<state.routeCount;++n)
                    if(state.routes[n].id==item.id) { state.routes[n].enabled=enabled; break; }
            }
            if(!moduleSetter_(display_.id,state))
                chainPowers_[i].setToggleState(!enabled,juce::dontSendNotification);
            syncFromModel();
            repaint();
        };
        chainDeletes_[i].setButtonText("-");
        chainKinds_[i].setJustificationType(juce::Justification::centred);
        chainKinds_[i].setColour(juce::Label::textColourId,Palette::muted());
        chainKinds_[i].setFont(juce::FontOptions(7.2f));
        chainKinds_[i].setInterceptsMouseClicks(false,false);
        chainDeletes_[i].onClick=[this,i] {
            if(i>=chainItemCount_)return;
            selectedChainItem_=chainItems_[i];removeSelectedChainItem();
        };
        chainSelectors_[i].onClick=[this,i] {
            if(i>=chainItemCount_ || !moduleGetter_ || !moduleSetter_)return;
            const auto item=chainItems_[i];auto state=moduleGetter_(display_.id);if(!state.id)return;
            auto safe=juce::Component::SafePointer<OscillatorCard>(this);
            if(item.kind==ChainItemKind::Process) {
                OscProcessSlot* slot=nullptr;
                for(std::size_t n=0;n<state.processCount;++n)if(state.processes[n].id==item.id){slot=&state.processes[n];break;}
                if(!slot)return;
                showNativeOscProcessMenu(chainSelectors_[i],slot->type,[safe,item](dsp::OscProcessType type) {
                    if(safe==nullptr || type==dsp::OscProcessType::Off)return;
                    auto s=safe->moduleGetter_(safe->display_.id);
                    for(std::size_t n=0;n<s.processCount;++n)if(s.processes[n].id==item.id){s.processes[n].type=type;s.processes[n].amount=juce::jlimit(dsp::oscProcessAmountMinimum(type),1.0f,s.processes[n].amount);break;}
                    safe->moduleSetter_(safe->display_.id,s);safe->syncFromModel();
                });
            } else if(item.kind==ChainItemKind::Route && snapshotGetter_) {
                OscRouteSlot* slot=nullptr;
                for(std::size_t n=0;n<state.routeCount;++n)if(state.routes[n].id==item.id){slot=&state.routes[n];break;}
                if(!slot)return;
                const auto snapshot=snapshotGetter_();
                showNativeOscRouteMenu(chainSelectors_[i],display_.id,slot->sourceId,slot->type,snapshot,[safe,item](OscillatorModuleId sourceId,OscRouteType type) {
                    if(safe==nullptr || sourceId==0 || type==OscRouteType::Off)return;
                    auto s=safe->moduleGetter_(safe->display_.id);
                    for(std::size_t n=0;n<s.routeCount;++n)if(s.routes[n].id==item.id){s.routes[n].sourceId=sourceId;s.routes[n].type=type;break;}
                    safe->moduleSetter_(safe->display_.id,s);safe->syncFromModel();
                });
            }
        };
        chainAmounts_[i].onValueChange=[this,i] {
            if(syncingProcess_ || i>=chainItemCount_ || !moduleGetter_ || !moduleSetter_)return;
            auto s=moduleGetter_(display_.id);const auto item=chainItems_[i];
            if(item.kind==ChainItemKind::Process)for(std::size_t n=0;n<s.processCount;++n)if(s.processes[n].id==item.id){s.processes[n].amount=float(chainAmounts_[i].getValue());break;}
            if(item.kind==ChainItemKind::Route)for(std::size_t n=0;n<s.routeCount;++n)if(s.routes[n].id==item.id){s.routes[n].amount=float(chainAmounts_[i].getValue());break;}
            moduleSetter_(display_.id,s);
        };
    }
    addAndMakeVisible(chainAdd_);addAndMakeVisible(chainRemove_);
    chainAdd_.setTooltip("Add process or routing to oscillator chain");
    chainRemove_.setTooltip("Remove selected oscillator chain item");
    chainAdd_.onClick=[this]{addChainItem();};
    chainRemove_.onClick=[this]{removeSelectedChainItem();};

    // Slot two controls are compatibility-only now; the dynamic collection
    // exposes one editor for the selected stable-ID child.
    for(auto* component:std::initializer_list<juce::Component*>{
        &process2Menu_,&process2Previous_,&process2Next_,&process2Randomize_,
        &process2Amount_,&process2AmountLabel_,&route2Menu_,&route2Previous_,
        &route2Next_,&route2Amount_,&route2AmountLabel_})
        component->setVisible(false);

    refreshVisibleNumber();

    addAndMakeVisible(power_);
    power_.setClickingTogglesState(true);
    power_.setTooltip("Enable / disable this oscillator module");
    power_.setName("Power OSC "+juce::String(display_.ordinal));
    power_.setToggleState(enabledGetter_ ? enabledGetter_(display_.id) : true,juce::dontSendNotification);
    power_.onClick=[this] {
        const bool requested=power_.getToggleState();
        if(enabledSetter_ && !enabledSetter_(display_.id,requested))
            power_.setToggleState(!requested,juce::dontSendNotification);
        repaint();
    };
   addAndMakeVisible(wtPositionSlider_);
    addAndMakeVisible(wtPositionLabel_);
    wtPositionSlider_.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    wtPositionSlider_.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    wtPositionSlider_.setRange(0.0,1.0,0.0);
    wtPositionSlider_.setName("WT POS");
    wtPositionSlider_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::WtPosition));
    wtPositionSlider_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
    wtPositionSlider_.setTooltip("Continuous position through Basic Shapes");
    wtPositionLabel_.setText("WT POS",juce::dontSendNotification);
    wtPositionLabel_.setJustificationType(juce::Justification::centred);
    wtPositionLabel_.setFont(juce::FontOptions(8.0f));
    wtPositionLabel_.setColour(juce::Label::textColourId,Palette::muted());
    if(parameterGetter_)
        wtPositionSlider_.setValue(juce::jlimit(0.0,1.0,double(parameterGetter_(mct::origami::ParameterId::Waveform))/3.0),juce::dontSendNotification);
    wtPositionSlider_.onValueChange=[this] {
        if(parameterSetter_)
            parameterSetter_(mct::origami::ParameterId::Waveform,float(wtPositionSlider_.getValue()*3.0));
        syncFromModel();
    };}

void OscillatorCard::selectChainItem(ChainItem item) {
    selectedChainItem_=item;
    selectedProcessId_=item.kind==ChainItemKind::Process ? static_cast<OscProcessSlotId>(item.id) : 0;
    selectedRouteId_=item.kind==ChainItemKind::Route ? static_cast<OscRouteSlotId>(item.id) : 0;
    syncFromModel();resized();repaint();
}
void OscillatorCard::addChainItem() {
    if(!moduleGetter_ || !moduleSetter_ || !snapshotGetter_) return;
    const auto module=moduleGetter_(display_.id);
    if(!module.id) return;
    const bool canProcess=module.processCount<maxOscProcesses;
    const bool canRoute=module.routeCount<maxOscRoutes;
    const auto snapshot=snapshotGetter_();
    auto safe=juce::Component::SafePointer<OscillatorCard>(this);
    showNativeOscChainAddMenu(chainAdd_,display_.id,snapshot,
        [safe,canProcess](dsp::OscProcessType type) {
            if(safe==nullptr || !canProcess || type==dsp::OscProcessType::Off ||
               !safe->moduleGetter_ || !safe->moduleSetter_) return;
            auto state=safe->moduleGetter_(safe->display_.id);
            if(!state.id || state.processCount>=maxOscProcesses) return;
            auto& slot=state.processes[state.processCount++];
            slot.id=state.nextProcessId++;slot.type=type;
            slot.amount=juce::jlimit(dsp::oscProcessAmountMinimum(type),1.0f,0.5f);
            slot.seed=static_cast<std::uint32_t>(juce::Random::getSystemRandom().nextInt());
            if(slot.seed==0)slot.seed=0x6d2b79f5u;
            if(safe->moduleSetter_(safe->display_.id,state))
                safe->selectedChainItem_={ChainItemKind::Process,slot.id};
            safe->syncFromModel();safe->resized();safe->repaint();
        },
        [safe,canRoute](OscillatorModuleId sourceId,OscRouteType type) {
            if(safe==nullptr || !canRoute || sourceId==0 || type==OscRouteType::Off ||
               !safe->moduleGetter_ || !safe->moduleSetter_) return;
            auto state=safe->moduleGetter_(safe->display_.id);
            if(!state.id || state.routeCount>=maxOscRoutes) return;
            auto& slot=state.routes[state.routeCount++];
            slot.id=state.nextRouteId++;slot.sourceId=sourceId;slot.type=type;slot.amount=0.5f;
            if(safe->moduleSetter_(safe->display_.id,state))
                safe->selectedChainItem_={ChainItemKind::Route,slot.id};
            safe->syncFromModel();safe->resized();safe->repaint();
        });
}
void OscillatorCard::removeSelectedChainItem() {
    if(selectedChainItem_.kind==ChainItemKind::None || !moduleGetter_ || !moduleSetter_) return;
    auto state=moduleGetter_(display_.id);if(!state.id)return;
    if(selectedChainItem_.kind==ChainItemKind::Process) {
        std::size_t index=state.processCount;
        for(std::size_t i=0;i<state.processCount;++i) if(state.processes[i].id==selectedChainItem_.id){index=i;break;}
        if(index>=state.processCount)return;
        for(std::size_t i=index+1;i<state.processCount;++i)state.processes[i-1]=state.processes[i];
        state.processes[--state.processCount]={};
    } else {
        std::size_t index=state.routeCount;
        for(std::size_t i=0;i<state.routeCount;++i) if(state.routes[i].id==selectedChainItem_.id){index=i;break;}
        if(index>=state.routeCount)return;
        for(std::size_t i=index+1;i<state.routeCount;++i)state.routes[i-1]=state.routes[i];
        state.routes[--state.routeCount]={};
    }
    selectedChainItem_={};selectedProcessId_=0;selectedRouteId_=0;
    moduleSetter_(display_.id,state);syncFromModel();resized();repaint();
}
void OscillatorCard::addProcess() {
    if(!moduleGetter_ || !moduleSetter_) return;
    auto safe=juce::Component::SafePointer<OscillatorCard>(this);
    showNativeOscProcessMenu(chainAdd_,dsp::OscProcessType::Off,[safe](dsp::OscProcessType type) {
        if(safe==nullptr || type==dsp::OscProcessType::Off || !safe->moduleGetter_ || !safe->moduleSetter_) return;
        auto state=safe->moduleGetter_(safe->display_.id);
        if(!state.id || state.processCount>=maxOscProcesses)return;
        auto& slot=state.processes[state.processCount++];
        slot.id=state.nextProcessId++;slot.type=type;
        slot.amount=juce::jlimit(dsp::oscProcessAmountMinimum(type),1.0f,0.5f);
        slot.seed=static_cast<std::uint32_t>(juce::Random::getSystemRandom().nextInt());
        if(slot.seed==0)slot.seed=0x6d2b79f5u;
        if(safe->moduleSetter_(safe->display_.id,state))
            safe->selectedChainItem_={ChainItemKind::Process,slot.id};
        safe->syncFromModel();safe->resized();safe->repaint();
    });
}
void OscillatorCard::addRoute() {
    if(!moduleGetter_ || !moduleSetter_ || !snapshotGetter_)return;
    const auto state=moduleGetter_(display_.id);if(!state.id || state.routeCount>=maxOscRoutes)return;
    const auto snapshot=snapshotGetter_();
    auto safe=juce::Component::SafePointer<OscillatorCard>(this);
    showNativeOscRouteMenu(chainAdd_,display_.id,0,OscRouteType::Off,snapshot,
        [safe](OscillatorModuleId sourceId,OscRouteType type) {
            if(safe==nullptr || type==OscRouteType::Off || sourceId==0 || !safe->moduleGetter_ || !safe->moduleSetter_)return;
            auto current=safe->moduleGetter_(safe->display_.id);
            if(!current.id || current.routeCount>=maxOscRoutes)return;
            auto& slot=current.routes[current.routeCount++];
            slot.id=current.nextRouteId++;slot.sourceId=sourceId;slot.type=type;slot.amount=0.5f;
            if(safe->moduleSetter_(safe->display_.id,current))
                safe->selectedChainItem_={ChainItemKind::Route,slot.id};
            safe->syncFromModel();safe->resized();safe->repaint();
        });
}
void OscillatorCard::syncDynamicCollections(const OscillatorModuleState& state) {
    chainItemCount_=0;
    for(std::size_t i=0;i<state.processCount && chainItemCount_<maxChainItems;++i)
        chainItems_[chainItemCount_++]={ChainItemKind::Process,state.processes[i].id};
    for(std::size_t i=0;i<state.routeCount && chainItemCount_<maxChainItems;++i)
        chainItems_[chainItemCount_++]={ChainItemKind::Route,state.routes[i].id};

    const juce::ScopedValueSetter<bool> guard(syncingProcess_,true);
    for(std::size_t i=0;i<maxChainItems;++i) {
        const bool active=i<chainItemCount_;
        chainRowBackgrounds_[i].setVisible(active);chainSelectors_[i].setVisible(active);chainAmounts_[i].setVisible(active);
        chainPowers_[i].setVisible(active);chainDeletes_[i].setVisible(active);chainKinds_[i].setVisible(active);
        chainActions_[i].setVisible(false);
        if(!active)continue;
        const auto item=chainItems_[i];
        if(item.kind==ChainItemKind::Process) {
            const OscProcessSlot* p=nullptr;
            for(std::size_t n=0;n<state.processCount;++n)if(state.processes[n].id==item.id){p=&state.processes[n];break;}
            if(!p)continue;
            chainSelectors_[i].setButtonText(juce::String(dsp::oscProcessName(p->type)));
            chainKinds_[i].setText("O S C   E F F E C T",juce::dontSendNotification);
            chainAmounts_[i].setRange(dsp::oscProcessAmountMinimum(p->type),1.0,0.001);
            chainAmounts_[i].setValue(p->amount,juce::dontSendNotification);
            chainPowers_[i].setToggleState(p->enabled,juce::dontSendNotification);
            chainAmounts_[i].getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::ProcessAmount));
            chainAmounts_[i].getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
            chainAmounts_[i].getProperties().set("mct.mod.itemId",static_cast<int>(p->id));
            chainAmounts_[i].setName(dsp::oscProcessIsBipolar(p->type)?"OSC PROCESS BIPOLAR":"OSC PROCESS UNIPOLAR");
            const bool hasAction=dsp::oscProcessUsesSeed(p->type);
            chainActions_[i].setVisible(hasAction);
            chainActions_[i].setEnabled(hasAction);
        } else {
            const OscRouteSlot* r=nullptr;
            for(std::size_t n=0;n<state.routeCount;++n)if(state.routes[n].id==item.id){r=&state.routes[n];break;}
            if(!r)continue;
            unsigned ordinal=0,displayOrdinal=0;
            if(snapshotGetter_)for(const auto& osc:snapshotGetter_().oscillators){if(!osc.id)continue;++displayOrdinal;if(osc.id==r->sourceId){ordinal=displayOrdinal;break;}}
            chainSelectors_[i].setButtonText("OSC "+juce::String(ordinal?ordinal:r->sourceId)+" · "+juce::String(oscRouteAbbreviation(r->type)));
            chainKinds_[i].setText("O S C   R O U T E",juce::dontSendNotification);
            chainAmounts_[i].setRange(-1.0,1.0,0.001);
            chainAmounts_[i].setValue(r->amount,juce::dontSendNotification);
            chainPowers_[i].setToggleState(r->enabled,juce::dontSendNotification);
            chainAmounts_[i].getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::RouteAmount));
            chainAmounts_[i].getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
            chainAmounts_[i].getProperties().set("mct.mod.itemId",static_cast<int>(r->id));
            chainAmounts_[i].setName("OSC ROUTE AMOUNT");
        }
    }
    chainAdd_.setEnabled(state.processCount<maxOscProcesses || state.routeCount<maxOscRoutes);
}

void OscillatorCard::syncFromModel() {
    if(!parameterGetter_) return;
    auto sync=[&](RackSlider& slider,ParameterId id,double scale=1.0) {
        if(!slider.isMouseButtonDown() && !slider.isEditingText())
            slider.setValue(double(parameterGetter_(id))*scale,juce::dontSendNotification);
    };
    sync(wtPositionSlider_,ParameterId::Waveform,1.0/3.0);
    sync(unisonSlider_,ParameterId::OscUnison);sync(detuneSlider_,ParameterId::OscDetune);
    sync(panSlider_,ParameterId::OscPan);sync(levelSlider_,ParameterId::OscLevel);
    sync(octaveSlider_,ParameterId::OscOctave);sync(semitoneSlider_,ParameterId::OscSemitone);
    sync(fineSlider_,ParameterId::OscFine);
    if(moduleGetter_ && !process1Menu_.isPopupActive() && !process2Menu_.isPopupActive()) {
        const auto state=moduleGetter_(display_.id);
        if(state.id) {
            if(!blendSlider_.isMouseButtonDown() && !blendSlider_.isEditingText())
                blendSlider_.setValue(state.blend,juce::dontSendNotification);
            const juce::ScopedValueSetter<bool> guard(syncingProcess_,true);
            syncDynamicCollections(state);

            const OscProcessSlot* selectedProcess=nullptr;
            for(std::size_t i=0;i<state.processCount;++i)
                if(state.processes[i].id==selectedProcessId_) {selectedProcess=&state.processes[i];break;}
            const bool haveProcess=selectedProcess!=nullptr;
            processRowPower_.setVisible(haveProcess);
            processRowRemove_.setVisible(selectedChainItem_.kind!=ChainItemKind::None);
            process1Menu_.setVisible(haveProcess);
            process1Previous_.setVisible(false);
            process1Next_.setVisible(false);
            process1Amount_.setVisible(haveProcess);
            process1AmountLabel_.setVisible(haveProcess);
            if(haveProcess) {
                process1Menu_.setSelectedId(static_cast<int>(selectedProcess->type)+1,juce::dontSendNotification);
                const double minimum=dsp::oscProcessAmountMinimum(selectedProcess->type);
                process1Amount_.setRange(minimum,1.0,0.001);
                process1Amount_.setName(dsp::oscProcessIsBipolar(selectedProcess->type)?"OSC PROCESS BIPOLAR":"OSC PROCESS UNIPOLAR");
                process1Amount_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::ProcessAmount));
                process1Amount_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
                process1Amount_.getProperties().set("mct.mod.itemId",static_cast<int>(selectedProcessId_));
                if(!process1Amount_.isMouseButtonDown())
                    process1Amount_.setValue(selectedProcess->amount,juce::dontSendNotification);
                const bool random=dsp::oscProcessUsesSeed(selectedProcess->type);
                process1Randomize_.setVisible(random);process1Randomize_.setEnabled(random);
                const int percent=juce::roundToInt(selectedProcess->amount*100.0f);
                process1AmountLabel_.setText((percent>0&&dsp::oscProcessIsBipolar(selectedProcess->type)?"+":"")+juce::String(percent)+"%",juce::dontSendNotification);
            } else process1Randomize_.setVisible(false);

            const OscRouteSlot* selectedRoute=nullptr;
            for(std::size_t i=0;i<state.routeCount;++i)
                if(state.routes[i].id==selectedRouteId_) {selectedRoute=&state.routes[i];break;}
            const bool haveRoute=selectedRoute!=nullptr;
            // Route rows share the same per-row remove action. There is no
            // separate bottom-chain remove control anymore.
            processRowRemove_.setVisible(haveProcess || haveRoute);
            route1Menu_.setVisible(haveRoute);route1Previous_.setVisible(false);
            route1Next_.setVisible(false);route1Amount_.setVisible(haveRoute);
            route1AmountLabel_.setVisible(haveRoute);
            if(haveRoute) {
                route1Menu_.setSelection(selectedRoute->sourceId,selectedRoute->type,juce::dontSendNotification);
                route1Amount_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::RouteAmount));
                route1Amount_.getProperties().set("mct.mod.oscillator",static_cast<int>(display_.id));
                route1Amount_.getProperties().set("mct.mod.itemId",static_cast<int>(selectedRouteId_));
                if(!route1Amount_.isMouseButtonDown()) route1Amount_.setValue(selectedRoute->amount,juce::dontSendNotification);
                const int percent=juce::roundToInt(selectedRoute->amount*100.0f);
                route1AmountLabel_.setText((percent>0?"+":"")+juce::String(percent)+"%",juce::dontSendNotification);
                route1Amount_.setEnabled(selectedRoute->type!=OscRouteType::Off);
            }
        }
    }
    // Compatibility-only nearest frame index; never used as wavetable identity.
    waveformIndex_=juce::jlimit(0,3,juce::roundToInt(parameterGetter_(ParameterId::Waveform)));
    if(enabledGetter_) power_.setToggleState(enabledGetter_(display_.id),juce::dontSendNotification);
    repaint();
}

void OscillatorCard::refreshVisibleNumber() {
    title_="OSC "+juce::String(display_.ordinal);
    setName(title_);
    remove_.setName("Remove "+title_);
    remove_.setEnabled(display_.id!=1);
    power_.setName("Power "+title_);
    repaint();
}

void OscillatorCard::setOrdinal(unsigned ordinal) {
    if(display_.ordinal==ordinal) return;
    display_.ordinal=ordinal;
    refreshVisibleNumber();
}
void OscillatorCard::setDisplayOrdinal(unsigned ordinal) {
    setOrdinal(ordinal);
}

void OscillatorCard::refreshPhaseWorkspace() {
    phaseRandom_.setToggleState(phaseStartMode_==PhaseStartMode::Random,juce::dontSendNotification);
    phaseFixed_.setToggleState(phaseStartMode_==PhaseStartMode::Fixed,juce::dontSendNotification);
    phaseFree_.setToggleState(phaseStartMode_==PhaseStartMode::Free,juce::dontSendNotification);
    phaseSelector_.setButtonText(phaseStartMode_==PhaseStartMode::Random ? "RAND"
                                 : phaseStartMode_==PhaseStartMode::Fixed ? "FIXED" : "FREE");
    phaseAngle_.setEnabled(phaseStartMode_==PhaseStartMode::Fixed);
    phaseRandomRange_.setEnabled(phaseStartMode_==PhaseStartMode::Random);
    phaseRetrigger_.setEnabled(phaseStartMode_!=PhaseStartMode::Free);
    phasePerUnison_.setEnabled(phaseStartMode_==PhaseStartMode::Random);
    repaint();
}

void OscillatorCard::refreshRoutingWorkspace() {
    routeDirect_.setToggleState(outputRouteMode_==OutputRouteMode::Direct,juce::dontSendNotification);
    routeFilter1_.setToggleState(outputRouteMode_==OutputRouteMode::Filter1,juce::dontSendNotification);
    routeFilter2_.setToggleState(outputRouteMode_==OutputRouteMode::Filter2,juce::dontSendNotification);
    routeMulti_.setToggleState(outputRouteMode_==OutputRouteMode::Multi,juce::dontSendNotification);

    const bool direct=outputRouteMode_==OutputRouteMode::Direct;
    const bool filter1=outputRouteMode_==OutputRouteMode::Filter1;
    const bool filter2=outputRouteMode_==OutputRouteMode::Filter2;
    const bool multi=outputRouteMode_==OutputRouteMode::Multi;
    routeDirectLevel_.setEnabled(direct||multi);
    routeFilter1Level_.setEnabled(filter1||multi);
    routeFilter2Level_.setEnabled(filter2||multi);

    outputSelector_.setButtonText(direct ? "DIRECT OUT"
                                  : filter1 ? "FILTER 1"
                                  : filter2 ? "FILTER 2" : "MULTI");
    repaint();
}

void OscillatorCard::setWorkspacePage(WorkspacePage page) {
    if(workspacePage_==page) return;
    workspacePage_=page;
    resized();
    repaint();
}

void OscillatorCard::resized() {
    // Persistent top bar: OSC identity | MODE | PHASE | ROUTE | PWR | remove.
    // MODE is shifted left and all three configuration entries share the same
    // compact rhythm so the bar remains readable at the fixed card width.
    constexpr int headerY=6;
    constexpr int headerH=21;
    constexpr int edge=7;
    constexpr int removeW=24;
    constexpr int powerW=31;
    constexpr int gap=3;
    constexpr int identityW=54;
    constexpr int labelW=24;

    int right=getWidth()-edge;
    remove_.setBounds(right-removeW,headerY,removeW,headerH); right-=removeW+gap;
    power_.setBounds(right-powerW,headerY,powerW,headerH); right-=powerW+gap;

    const int left=edge+identityW;
    const int available=juce::jmax(0,right-left);
    const int groupWidth=juce::jmax(1,(available-gap*2)/3);
    auto placeHeaderSelector=[&](juce::TextButton& selector,int index) {
        const int x=left+index*(groupWidth+gap);
        selector.setBounds(x+labelW,headerY,juce::jmax(1,groupWidth-labelW),headerH);
    };
    placeHeaderSelector(modeSelector_,0);
    placeHeaderSelector(phaseSelector_,1);
    placeHeaderSelector(outputSelector_,2);

    if(!engineBacked_) return;

    auto body=contentBounds();
    // The complete area below the persistent top bar is the oscillator
    // workspace. Main owns it today; Phase/Routing will take over this exact
    // rectangle without disturbing header geometry.
    workspaceBounds_=body;

    if(!isMainWorkspace()) {
        // PHASE/ROUTE own the entire body. Patch 2 establishes takeover/navigation;
        // their dedicated controls are populated in Patches 3 and 4.
        for(auto* component:std::initializer_list<juce::Component*>{
            &waveformPrevious_,&waveformNext_,
            &octaveSlider_,&semitoneSlider_,&fineSlider_,
            &wtPositionSlider_,&unisonSlider_,&detuneSlider_,&blendSlider_,&panSlider_,&levelSlider_,
            &octaveTitle_,&semitoneTitle_,&fineTitle_,
            &wtPositionLabel_,&unisonLabel_,&detuneLabel_,&blendLabel_,&panLabel_,&levelLabel_,
            &chainViewport_,&chainAdd_,&chainRemove_}) {
            component->setVisible(false);
            component->setBounds({});
        }
        for(std::size_t i=0;i<maxChainItems;++i) {
            chainRowBackgrounds_[i].setVisible(false); chainSelectors_[i].setVisible(false);
            chainAmounts_[i].setVisible(false); chainPowers_[i].setVisible(false);
            chainDeletes_[i].setVisible(false); chainKinds_[i].setVisible(false);
            chainActions_[i].setVisible(false);
        }

        const bool phasePage=workspacePage_==WorkspacePage::Phase;
        const bool routingPage=workspacePage_==WorkspacePage::Routing;
        for(auto* component:std::initializer_list<juce::Component*>{
            &phaseRandom_,&phaseFixed_,&phaseFree_,&phaseAngle_,&phaseRandomRange_,
            &phaseAngleLabel_,&phaseRandomRangeLabel_,&phaseRetrigger_,&phasePerUnison_})
            component->setVisible(phasePage);
        for(auto* component:std::initializer_list<juce::Component*>{
            &routeDirect_,&routeFilter1_,&routeFilter2_,&routeMulti_,
            &routeDirectLevel_,&routeFilter1Level_,&routeFilter2Level_,
            &routeDirectLevelLabel_,&routeFilter1LevelLabel_,&routeFilter2LevelLabel_,&routePostChain_})
            component->setVisible(routingPage);

        if(phasePage) {
            auto page=workspaceBounds_.reduced(12,10);
            page.removeFromTop(42); // title + START MODE section label
            auto modes=page.removeFromTop(30);
            const int modeGap=5;
            const int modeW=(modes.getWidth()-modeGap*2)/3;
            phaseRandom_.setBounds(modes.removeFromLeft(modeW));
            modes.removeFromLeft(modeGap);
            phaseFixed_.setBounds(modes.removeFromLeft(modeW));
            modes.removeFromLeft(modeGap);
            phaseFree_.setBounds(modes);

            page.removeFromTop(25); // PHASE POSITION section label
            auto controls=page.removeFromTop(94);
            const int half=controls.getWidth()/2;
            auto fixedArea=controls.removeFromLeft(half).reduced(12,0);
            auto randomArea=controls.reduced(12,0);
            phaseAngleLabel_.setBounds(fixedArea.removeFromTop(16));
            phaseAngle_.setBounds(fixedArea.reduced(10,0));
            phaseRandomRangeLabel_.setBounds(randomArea.removeFromTop(16));
            phaseRandomRange_.setBounds(randomArea.reduced(10,0));

            page.removeFromTop(22); // BEHAVIOR section label
            auto toggles=page.removeFromTop(28);
            const int toggleGap=6;
            const int toggleW=(toggles.getWidth()-toggleGap)/2;
            phaseRetrigger_.setBounds(toggles.removeFromLeft(toggleW));
            toggles.removeFromLeft(toggleGap);
            phasePerUnison_.setBounds(toggles);
            refreshPhaseWorkspace();
        } else if(routingPage) {
            auto page=workspaceBounds_.reduced(12,10);
            page.removeFromTop(42); // title + DESTINATION section label

            auto destinations=page.removeFromTop(30);
            constexpr int destinationGap=4;
            const int destinationW=(destinations.getWidth()-destinationGap*3)/4;
            routeDirect_.setBounds(destinations.removeFromLeft(destinationW));
            destinations.removeFromLeft(destinationGap);
            routeFilter1_.setBounds(destinations.removeFromLeft(destinationW));
            destinations.removeFromLeft(destinationGap);
            routeFilter2_.setBounds(destinations.removeFromLeft(destinationW));
            destinations.removeFromLeft(destinationGap);
            routeMulti_.setBounds(destinations);

            page.removeFromTop(25); // SEND LEVELS section label
            auto levels=page.removeFromTop(98);
            constexpr int levelGap=6;
            const int levelW=(levels.getWidth()-levelGap*2)/3;
            auto directArea=levels.removeFromLeft(levelW);
            levels.removeFromLeft(levelGap);
            auto filter1Area=levels.removeFromLeft(levelW);
            levels.removeFromLeft(levelGap);
            auto filter2Area=levels;

            auto layoutLevel=[](juce::Rectangle<int> area,juce::Label& label,RackSlider& slider) {
                label.setBounds(area.removeFromTop(16));
                slider.setBounds(area.reduced(7,0));
            };
            layoutLevel(directArea,routeDirectLevelLabel_,routeDirectLevel_);
            layoutLevel(filter1Area,routeFilter1LevelLabel_,routeFilter1Level_);
            layoutLevel(filter2Area,routeFilter2LevelLabel_,routeFilter2Level_);

            page.removeFromTop(20); // SIGNAL POINT section label
            routePostChain_.setBounds(page.removeFromTop(28).withSizeKeepingCentre(150,28));
            refreshRoutingWorkspace();
        }
        return;
    }

    for(auto* component:std::initializer_list<juce::Component*>{
        &phaseRandom_,&phaseFixed_,&phaseFree_,&phaseAngle_,&phaseRandomRange_,
        &phaseAngleLabel_,&phaseRandomRangeLabel_,&phaseRetrigger_,&phasePerUnison_,
        &routeDirect_,&routeFilter1_,&routeFilter2_,&routeMulti_,
        &routeDirectLevel_,&routeFilter1Level_,&routeFilter2Level_,
        &routeDirectLevelLabel_,&routeFilter1LevelLabel_,&routeFilter2LevelLabel_,&routePostChain_}) {
        component->setVisible(false);
        component->setBounds({});
    }

    waveformPrevious_.setVisible(true); waveformNext_.setVisible(true);
    for(auto* component:std::initializer_list<juce::Component*>{
        &octaveSlider_,&semitoneSlider_,&fineSlider_,
        &wtPositionSlider_,&unisonSlider_,&detuneSlider_,&blendSlider_,&panSlider_,&levelSlider_,
        &octaveTitle_,&semitoneTitle_,&fineTitle_,
        &wtPositionLabel_,&unisonLabel_,&detuneLabel_,&blendLabel_,&panLabel_,&levelLabel_,
        &chainAdd_})
        component->setVisible(true);
    syncDynamicCollections(moduleGetter_ ? moduleGetter_(display_.id) : OscillatorModuleState{});

    // Match the oscillator body's top inset to its left/right structural inset.
    body.removeFromTop(4);
    auto controls=body.removeFromBottom(56);
    body.removeFromBottom(4);

    auto upper=body;
    constexpr int columnGap=7;
    const int chainWidth=juce::jlimit(208,251,upper.getWidth()*50/100);
    auto chain=upper.removeFromRight(chainWidth);
    upper.removeFromRight(columnGap);

    // Full template rows stack vertically. The viewport scrolls once the
    // available chain height is exhausted; the + control remains fixed.
    auto chainButtons=chain.withTrimmedLeft(7).withTrimmedRight(7).withTrimmedBottom(7).removeFromBottom(24);
    chainRemove_.setVisible(false);chainRemove_.setBounds({});
    chainAdd_.setVisible(true);chainAdd_.setButtonText("+");chainAdd_.setBounds(chainButtons);

    constexpr int chainRowHeight=58;
    constexpr int chainRowGap=4;
    auto listArea=chain.withTrimmedLeft(7).withTrimmedRight(7);
    listArea.removeFromTop(24);
    listArea.setBottom(chainButtons.getY()-5);
    chainViewport_.setBounds(listArea);
    chainViewport_.setVisible(chainItemCount_>0);
    const int contentWidth=juce::jmax(1,listArea.getWidth()-4);
    const int contentHeight=juce::jmax(1,static_cast<int>(chainItemCount_)*(chainRowHeight+chainRowGap));
    chainContent_.setSize(contentWidth,contentHeight);

    for(std::size_t i=0;i<maxChainItems;++i) {
        if(i>=chainItemCount_) {
            chainRowBackgrounds_[i].setBounds({});chainSelectors_[i].setBounds({});chainAmounts_[i].setBounds({});
            chainPowers_[i].setBounds({});chainDeletes_[i].setBounds({});chainKinds_[i].setBounds({});chainActions_[i].setBounds({});
            continue;
        }
        auto row=juce::Rectangle<int>(0,static_cast<int>(i)*(chainRowHeight+chainRowGap),contentWidth,chainRowHeight);
        chainRowBackgrounds_[i].setBounds(row);
        chainRowBackgrounds_[i].toBack();
        auto actions=row.removeFromRight(34);
        auto amountArea=row.removeFromRight(43);
        row.removeFromRight(5);
        auto selector=row.reduced(3,2).withTrimmedBottom(17);
        selector.setWidth(juce::jmin(selector.getWidth(),128));
        chainSelectors_[i].setBounds(selector);
        auto knob=juce::Rectangle<int>(34,34).withCentre(amountArea.getCentre()).translated(-2,2);
        chainAmounts_[i].setBounds(knob);
        auto subtype=juce::Rectangle<int>(selector.getX(),selector.getBottom(),selector.getWidth(),15);
        if(chainActions_[i].isVisible()) {
            constexpr int actionSize=15;
            auto actionArea=subtype.removeFromLeft(actionSize);
            chainActions_[i].setBounds(actionArea.reduced(1));
            subtype.removeFromLeft(4);
        } else chainActions_[i].setBounds({});
        chainKinds_[i].setBounds(subtype);
        auto pwr=actions.removeFromTop(27).reduced(1,2);
        chainPowers_[i].setBounds(pwr);
        chainDeletes_[i].setBounds(actions.reduced(1,2));
    }

    // Retire the old single selected-item editor. Each list row now owns the
    // complete selector/amount/power/delete template.
    for(auto* component:std::initializer_list<juce::Component*>{
        &process1Menu_,&process1Previous_,&process1Next_,&process1Randomize_,&process1Amount_,&process1AmountLabel_,
        &route1Menu_,&route1Previous_,&route1Next_,&route1Amount_,&route1AmountLabel_,
        &process2Menu_,&process2Previous_,&process2Next_,&process2Randomize_,&process2Amount_,&process2AmountLabel_,
        &route2Menu_,&route2Previous_,&route2Next_,&route2Amount_,&route2AmountLabel_,
        &processRowPower_,&processRowRemove_}) {
        component->setBounds({});component->setVisible(false);
    }

    auto tuning=upper.removeFromBottom(30);
    upper.removeFromBottom(4);
    const int tuningCellWidth=tuning.getWidth()/3;
    auto placeTuning=[&](int index,juce::Slider& slider,juce::Label& title) {
        auto cell=tuning.withX(tuning.getX()+index*tuningCellWidth).withWidth(tuningCellWidth).reduced(3,0);
        auto titleArea=cell.removeFromTop(10);
        title.setBounds(titleArea);
        slider.setBounds(cell);
    };
    placeTuning(0,octaveSlider_,octaveTitle_);
    placeTuning(1,semitoneSlider_,semitoneTitle_);
    placeTuning(2,fineSlider_,fineTitle_);

    auto browser=upper.removeFromBottom(22);
    waveformPrevious_.setBounds(browser.removeFromLeft(22));
    waveformNext_.setBounds(browser.removeFromRight(22));

    const int cellWidth=controls.getWidth()/6;
    auto wtPositionCell=controls.withX(controls.getX()).withWidth(cellWidth);
    auto unisonCell=controls.withX(controls.getX()+cellWidth).withWidth(cellWidth);
    auto detuneCell=controls.withX(controls.getX()+cellWidth*2).withWidth(cellWidth);
    auto blendCell=controls.withX(controls.getX()+cellWidth*3).withWidth(cellWidth);
    auto panCell=controls.withX(controls.getX()+cellWidth*4).withWidth(cellWidth);
    auto levelCell=controls.withX(controls.getX()+cellWidth*5).withWidth(cellWidth);
    auto place=[&](juce::Rectangle<int> cell,juce::Slider& slider,juce::Label& label) {
        // Lower performance row sits a few pixels lower for stronger visual
        // separation from the pitch/browser section above.
        cell.translate(0,3);
        auto labelBounds=cell.removeFromBottom(18);
        slider.setBounds(cell.reduced(5,1));
        label.setBounds(labelBounds);
    };
    place(wtPositionCell,wtPositionSlider_,wtPositionLabel_);
    place(unisonCell,unisonSlider_,unisonLabel_);
    place(detuneCell,detuneSlider_,detuneLabel_);
    place(blendCell,blendSlider_,blendLabel_);
    place(panCell,panSlider_,panLabel_);
    place(levelCell,levelSlider_,levelLabel_);
}
void OscillatorCard::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    // mct-origami-oscillator-identity-tuning-v13
    // Dense by design: this is a wavetable synth. Preserve the established
    // source -> process -> tuning -> performance-control hierarchy.

    // Dedicated oscillator configuration strip. Child buttons own the selector
    // surfaces; paint only the identity and compact vertical section labels here.
    constexpr int headerY=6;
    constexpr int headerH=21;
    constexpr int edge=7;
    constexpr int identityW=54;
    constexpr int removeW=24;
    constexpr int powerW=31;
    constexpr int gap=3;
    constexpr int labelW=24;

    // Panel owns the original "OSC N" title. The three configuration groups
    // begin immediately after that reserved identity region.
    const int right=getWidth()-edge-removeW-gap-powerW-gap;
    const int left=edge+identityW;
    const int available=juce::jmax(0,right-left);
    const int groupWidth=juce::jmax(1,(available-gap*2)/3);
    auto headerLabel=[&](int index) {
        return juce::Rectangle<int>(left+index*(groupWidth+gap),headerY,labelW,headerH);
    };
    text(g,"MODE",headerLabel(0),6.8f,Palette::muted(),juce::Justification::centred);
    text(g,"PHASE",headerLabel(1),6.8f,Palette::muted(),juce::Justification::centred);
    text(g,"ROUTE",headerLabel(2),6.8f,Palette::muted(),juce::Justification::centred);

    // Patch 1 keeps the established oscillator body as the Main workspace.
    // Future Phase/Routing pages replace this body while the header above stays
    // persistent. No existing geometry or rendering is altered in Main.
    if(!isMainWorkspace()) {
        auto page=body.reduced(4);
        well(g,page);
        auto titleArea=page.removeFromTop(28);
        const auto title=workspacePage_==WorkspacePage::Phase ? "PHASE" : "ROUTING";
        text(g,title,titleArea,9.0f,Palette::secondary(),juce::Justification::centred);
        g.setColour(Palette::borderSoft());
        g.drawHorizontalLine(titleArea.getBottom(),float(page.getX()+8),float(page.getRight()-8));

        auto section=body.reduced(12,10);
        section.removeFromTop(29);
        if(workspacePage_==WorkspacePage::Phase) {
            text(g,"START MODE",section.removeFromTop(13),7.0f,Palette::muted(),juce::Justification::centredLeft);
            section.removeFromTop(34);
            text(g,"PHASE POSITION",section.removeFromTop(13),7.0f,Palette::muted(),juce::Justification::centredLeft);
            section.removeFromTop(106);
            text(g,"BEHAVIOR",section.removeFromTop(13),7.0f,Palette::muted(),juce::Justification::centredLeft);
        } else {
            text(g,"DESTINATION",section.removeFromTop(13),7.0f,Palette::muted(),juce::Justification::centredLeft);
            section.removeFromTop(34);
            text(g,"SEND LEVELS",section.removeFromTop(13),7.0f,Palette::muted(),juce::Justification::centredLeft);
            section.removeFromTop(110);
            text(g,"SIGNAL POINT",section.removeFromTop(13),7.0f,Palette::muted(),juce::Justification::centredLeft);
        }
        return;
    }

    auto working=body;
    working.removeFromTop(4);

    const int controlsHeight=56;
    working.removeFromBottom(controlsHeight);
    working.removeFromBottom(4);

    auto upper=working;

    // Right: one presentation surface for oscillator-local processes and routes.
    constexpr int columnGap=7;
    const int chainWidth=juce::jlimit(208,251,upper.getWidth()*50/100);
    auto chain=upper.removeFromRight(chainWidth);
    upper.removeFromRight(columnGap);
    const int tuningHeight=30;
    auto tuning=upper.removeFromBottom(tuningHeight);
    upper.removeFromBottom(4);

    // Left: authoritative wavetable viewport + compact browser strip.
    const int browserHeight=22;
    auto browser=upper.removeFromBottom(browserHeight);
    upper.removeFromBottom(4);

    // mct-origami-oscillator-wide-viewport-v14
    // Use the complete remaining source area instead of forcing a square.
    // OSC PROCESS keeps its fixed right-side column; the wavetable viewer fills
    // the full left-hand source workspace.
    auto preview=upper.reduced(0,1);

    well(g,preview);
    auto inner=preview.reduced(10);

    g.setColour(Palette::borderSoft().withAlpha(.72f));
    for(int i=1;i<4;++i) {
        const int x=inner.getX()+inner.getWidth()*i/4;
        g.drawVerticalLine(x,float(inner.getY()),float(inner.getBottom()));
    }
    g.setColour(Palette::borderStrong().withAlpha(.34f));
    g.drawHorizontalLine(inner.getCentreY(),float(inner.getX()),float(inner.getRight()));

    // Basic Shapes anchor label for the live continuous position.
    auto browserBox=browser.withX(preview.getX()).withWidth(preview.getWidth());
    well(g,browserBox);
    text(g,"<",browserBox.removeFromLeft(18),8.5f,Palette::muted(),juce::Justification::centred);
    text(g,">",browserBox.removeFromRight(18),8.5f,Palette::muted(),juce::Justification::centred);
    // V22.6: this strip names the selected wavetable, not the current frame.
    // Sine/Saw/Square/Triangle are internal anchor frames within Basic Shapes.
    text(g,"BASIC SHAPES",browserBox,8.2f,Palette::secondary(),juce::Justification::centred);

    // Unified OSC CHAIN: the list is presentation-only. Process and routing
    // execution remain separate, preserving the engine's established semantics.
    auto chainBox=chain.reduced(1,0);
    well(g,chainBox);
    auto chainInner=chainBox.reduced(8);
    auto chainTitle=chainInner.removeFromTop(14);
    chainTitle.translate(0,-4);
    text(g,"OSC CHAIN",chainTitle,8.5f,Palette::secondary(),juce::Justification::centred);
    if(chainItemCount_==0)
        text(g,"NO PROCESSING OR ROUTING",chainInner,7.2f,Palette::muted(),juce::Justification::centred);


    // Conventional oscillator pitch identity: OCT / SEM / FIN.
    const juce::StringArray tuneLabels{"OCT","SEM","FIN"};
    const juce::StringArray tuneValues{"0","0","0"};
    const int tuneCellWidth=tuning.getWidth()/3;
    for(int i=0;i<3;++i) {
        auto cell=tuning.withX(tuning.getX()+i*tuneCellWidth).withWidth(tuneCellWidth).reduced(3,0);
        if(!engineBacked_) {
            well(g,cell);
            auto labelArea=cell.removeFromTop(11);
            text(g,tuneLabels[i],labelArea,7.6f,Palette::muted(),juce::Justification::centred);
            text(g,tuneValues[i],cell,9.0f,Palette::text(),juce::Justification::centred);
        }
    }

    // Live child sliders own WT POS / UNISON / DETUNE / BLEND / PAN / LEVEL.

    // V22.2.1 live WT POS overlay. Uses the actual preview rectangle detected
    // from this source file rather than hard-coded layout geometry.
    {
        float physical=parameterGetter_
            ? juce::jlimit(0.0f,3.0f,parameterGetter_(mct::origami::ParameterId::Waveform))
            : 0.0f;

        // Matrix modulation must be visible in the source viewport, not merely
        // audible. WT Position is normalized 0..1 in the modulation engine.
        physical=juce::jlimit(0.0f,3.0f,
            physical+modulationUiAllRoutesValue(ModDestination::WtPosition,display_.id)*3.0f);

        const int a=juce::jlimit(0,3,int(std::floor(physical)));
        const int next=juce::jmin(3,a+1);
        const float blend=physical-float(a);

        auto shape=[](int which,float phase) {
            phase-=std::floor(phase);
            switch(which) {
                case 0: return std::sin(juce::MathConstants<float>::twoPi*phase);
                case 1: return 2.0f*phase-1.0f;
                case 2: return phase<0.5f ? 1.0f : -1.0f;
                default: return 1.0f-4.0f*std::abs(phase-0.5f);
            }
        };

        auto wtRect=preview.toFloat().reduced(10.0f,8.0f);
        g.setColour(Palette::panel());
        g.fillRect(wtRect);
        g.setColour(Palette::muted().withAlpha(0.20f));
        for(int i=1;i<4;++i) {
            const float x=wtRect.getX()+wtRect.getWidth()*float(i)/4.0f;
            g.drawVerticalLine(int(x),wtRect.getY(),wtRect.getBottom());
        }
        g.drawHorizontalLine(int(wtRect.getCentreY()),wtRect.getX(),wtRect.getRight());

        auto moduleState=moduleGetter_
            ? moduleGetter_(display_.id)
            : mct::origami::OscillatorModuleState{};

        dsp::OscProcessPlan visualPlan{};
        if(moduleState.id) {
            // Dynamic OSC CHAIN state is authoritative here, including an
            // intentionally empty chain. Legacy process1/process2 fields are
            // migration compatibility data and must not be resurrected after
            // the last dynamic process is removed.
            const auto count=std::min<std::size_t>(moduleState.processCount,maxOscProcesses);
            for(std::size_t i=0;i<count && visualPlan.count<dsp::maxOscProcessStages;++i) {
                const auto& process=moduleState.processes[i];
                if(!process.enabled || process.type==dsp::OscProcessType::Off) continue;
                const float minimum=dsp::oscProcessAmountMinimum(process.type);
                const float span=1.0f-minimum;
                const float modulated=juce::jlimit(minimum,1.0f,
                    process.amount+
                    modulationUiAllRoutesValue(ModDestination::ProcessAmount,display_.id,process.id)*span);
                // Quantise the VISUAL amount only. The audio path remains
                // continuous; this bounds repaint-driven FFT work while the
                // existing preview morph removes visible stepping.
                const float visualAmount=std::round(modulated*64.0f)/64.0f;
                visualPlan.stages[visualPlan.count++]={process.type,visualAmount,process.seed};
            }
        }

        constexpr std::size_t previewSize=2048;
        bool spectralPreview=false;
        for(std::size_t i=0;i<visualPlan.count;++i)
            spectralPreview=spectralPreview || dsp::oscProcessIsSpectral(visualPlan.stages[i].type);

        const auto samePlan=[](const dsp::OscProcessPlan& a,const dsp::OscProcessPlan& b) {
            if(a.count!=b.count) return false;
            for(std::size_t i=0;i<a.count;++i) {
                if(a.stages[i].type!=b.stages[i].type ||
                   a.stages[i].amount!=b.stages[i].amount ||
                   a.stages[i].seed!=b.stages[i].seed) return false;
            }
            return true;
        };

        if(spectralPreview) {
            const int wtKey=juce::roundToInt(physical*128.0f);
            const bool stale=!spectralPreviewValid_ ||
                spectralPreviewWtKey_!=wtKey ||
                !samePlan(spectralPreviewPlan_,visualPlan);

            if(stale) {
                if(spectralPreviewValid_)
                    spectralPreviewPrevious_=spectralPreviewCache_;
                std::array<float,previewSize> previewSource{};
                const float visualPhysical=static_cast<float>(wtKey)/128.0f;
                const int va=juce::jlimit(0,3,int(std::floor(visualPhysical)));
                const int vb=juce::jmin(3,va+1);
                const float vblend=visualPhysical-float(va);
                for(std::size_t sampleIndex=0;sampleIndex<previewSize;++sampleIndex) {
                    const float phase=static_cast<float>(sampleIndex)/static_cast<float>(previewSize);
                    const float ya=shape(va,phase),yb=shape(vb,phase);
                    previewSource[sampleIndex]=ya+(yb-ya)*vblend;
                }
                dsp::renderProcessedFrame2048(
                    previewSource.data(),spectralPreviewCache_.data(),visualPlan);

                spectralPreviewWtKey_=wtKey;
                spectralPreviewPlan_=visualPlan;
                if(!spectralPreviewValid_)
                    spectralPreviewPrevious_=spectralPreviewCache_;
                spectralPreviewValid_=true;
                spectralPreviewMorph_=0.0f;
            } else if(spectralPreviewMorph_<1.0f) {
                spectralPreviewMorph_=juce::jmin(1.0f,spectralPreviewMorph_+0.22f);
            }
        } else {
            spectralPreviewValid_=false;
            spectralPreviewMorph_=1.0f;
            spectralPreviewPlan_={};
        }

        auto processedSample=[&](float sourcePhase) {
            if(spectralPreview && spectralPreviewValid_) {
                const float wrapped=sourcePhase-std::floor(sourcePhase);
                const float pos=wrapped*static_cast<float>(previewSize);
                const auto i=static_cast<std::size_t>(pos)%previewSize;
                const auto j=(i+1)%previewSize;
                const float fraction=pos-static_cast<float>(static_cast<std::size_t>(pos));
                const float current=spectralPreviewCache_[i]+
                    fraction*(spectralPreviewCache_[j]-spectralPreviewCache_[i]);
                const float previous=spectralPreviewPrevious_[i]+
                    fraction*(spectralPreviewPrevious_[j]-spectralPreviewPrevious_[i]);
                const float t=spectralPreviewMorph_*spectralPreviewMorph_*
                    (3.0f-2.0f*spectralPreviewMorph_);
                return previous+(current-previous)*t;
            }
            double phase=static_cast<double>(sourcePhase);
            for(std::size_t i=0;i<visualPlan.count;++i) {
                const auto& stage=visualPlan.stages[i];
                phase=dsp::processOscillatorPhase(phase,stage.type,stage.amount);
            }
            const float visualPhase=static_cast<float>(phase);
            const float ya=shape(a,visualPhase),yb=shape(next,visualPhase);
            return ya+(yb-ya)*blend;
        };

        constexpr int points=384;
        std::array<juce::Point<float>,points> plot{};
        juce::Path outline;

        for(int i=0;i<points;++i) {
            const float sourcePhase=float(i)/float(points-1);

            // Preview is a bounded viewport. Even experimental/spectral
            // processes must not draw beyond its physical frame.
            const float sample=juce::jlimit(-1.0f,1.0f,processedSample(sourcePhase));
            const float x=juce::jmap(float(i),0.0f,float(points-1),wtRect.getX(),wtRect.getRight());
            const float y=juce::jlimit(
                wtRect.getY(),wtRect.getBottom(),
                juce::jmap(sample,-1.0f,1.0f,wtRect.getBottom(),wtRect.getY()));
            plot[static_cast<std::size_t>(i)]={x,y};
            if(i==0) outline.startNewSubPath(x,y); else outline.lineTo(x,y);
        }

        juce::Path fill;
        const float zeroY=wtRect.getCentreY();
        for(int i=0;i<points-1;++i) {
            const auto p0=plot[static_cast<std::size_t>(i)];
            const auto p1=plot[static_cast<std::size_t>(i+1)];
            if(std::abs(p0.y-zeroY)<0.01f && std::abs(p1.y-zeroY)<0.01f) continue;

            fill.startNewSubPath(p0.x,zeroY);
            fill.lineTo(p0.x,p0.y);
            fill.lineTo(p1.x,p1.y);
            fill.lineTo(p1.x,zeroY);
            fill.closeSubPath();
        }

        // Flat waveform-area fill: no gradient, no hotspot. Every point
        // between the zero axis and waveform gets the same derived red.
        // Clip both fill and stroke to the physical wavetable viewport.
        g.saveState();
        g.reduceClipRegion(wtRect.getSmallestIntegerContainer());
        g.setColour(signalSurfaceColour(0.46f,0.22f));
        g.fillPath(fill);

        g.setColour(Palette::muted().withAlpha(0.30f));
        g.drawHorizontalLine(int(zeroY),wtRect.getX(),wtRect.getRight());

        g.setColour(Palette::text());
        g.strokePath(outline,juce::PathStrokeType(1.5f));
        g.restoreState();
    }
}

void OscillatorCard::paintOverChildren(juce::Graphics& g) {
    const auto& telemetry=modulationUiTelemetry();

    const auto drawRotary=[&](juce::Slider& slider,ModDestination destination,std::uint32_t itemId=0) {
        const float selectedDepth=modulationUiSelectedRouteAmount(destination,display_.id,itemId);
        const bool selectedHasRoute=std::abs(selectedDepth)>=1.0e-4f;
        const float persistentDepth=modulationUiPersistentRouteAmount(destination,display_.id,itemId);
        const bool anyRoute=modulationUiHasAnyRoute(destination,display_.id,itemId);
        const float depth=selectedHasRoute?selectedDepth:persistentDepth;
        if(std::abs(depth)<1.0e-4f && !anyRoute) return;

        const double min=slider.getMinimum(),max=slider.getMaximum();
        if(max<=min) return;
        const float base=static_cast<float>((slider.getValue()-min)/(max-min));
        const bool bipolar=selectedHasRoute
            ?modulationUiSelectedRouteIsBipolar(destination,display_.id)
            :modulationUiPersistentRoutesAreBipolar(destination,display_.id,itemId);
        const float extent=std::abs(depth);
        const float lo=juce::jlimit(0.0f,1.0f,bipolar?base-extent:juce::jmin(base,base+depth));
        const float hi=juce::jlimit(0.0f,1.0f,bipolar?base+extent:juce::jmax(base,base+depth));
        const float current=juce::jlimit(0.0f,1.0f,
            base+depth*modulationUiRouteDisplaySourceValue(telemetry.selectedSource,bipolar));

        // Sliders in OSC CHAIN rows are descendants of chainContent_, not
        // direct OscillatorCard children. Convert their bounds into this
        // component's coordinate space before painting modulation overlays.
        auto circle=getLocalArea(&slider,slider.getLocalBounds()).toFloat().reduced(1.0f).expanded(2.0f);
        const float d=juce::jmin(circle.getWidth(),circle.getHeight());
        circle=juce::Rectangle<float>(d,d).withCentre(circle.getCentre());
        const float start=juce::MathConstants<float>::pi*1.20f;
        const float end=juce::MathConstants<float>::pi*2.80f;
        const auto angle=[&](float n){return start+n*(end-start);};

        if(std::abs(depth)>=1.0e-4f) {
            juce::Path range;
            range.addCentredArc(circle.getCentreX(),circle.getCentreY(),
                                circle.getWidth()*.51f,circle.getHeight()*.51f,0.0f,
                                angle(lo),angle(hi),true);
            // Keep the selected source vivid. Persistent modulation from other
            // sources stays derived from the user's signal colour, but is
            // deliberately quieter: half saturation, half brightness, thinner.
            auto rangeColour=signalSourceColour();
            float rangeThickness=2.2f;
            if(!selectedHasRoute) {
                rangeColour=rangeColour.withSaturation(rangeColour.getSaturation()*0.5f)
                                       .withBrightness(rangeColour.getBrightness()*0.5f);
                rangeThickness=1.35f;
            }
            g.setColour(rangeColour.withAlpha(.96f));
            g.strokePath(range,juce::PathStrokeType(rangeThickness));

            if(selectedHasRoute && telemetry.synthActive) {
                const float a=angle(current);
                const auto c=circle.getCentre();
                const auto p=juce::Point<float>(
                    c.x+std::sin(a)*circle.getWidth()*.51f,
                    c.y-std::cos(a)*circle.getHeight()*.51f);
                g.setColour(Palette::text());
                g.fillEllipse(juce::Rectangle<float>(5.0f,5.0f).withCentre(p));
            }
        } else {
            juce::Path automated;
            automated.addCentredArc(circle.getCentreX(),circle.getCentreY(),
                                    circle.getWidth()*.51f,circle.getHeight()*.51f,0.0f,
                                    start,end,true);
            g.setColour(signalSourceColour().darker(.72f).withAlpha(.88f));
            g.strokePath(automated,juce::PathStrokeType(1.7f));
        }
    };

    const auto drawLinear=[&](juce::Slider& slider,ModDestination destination) {
        const float depth=modulationUiSelectedRouteAmount(destination,display_.id);
        const bool anyRoute=modulationUiHasAnyRoute(destination,display_.id);
        if(std::abs(depth)<1.0e-4f && !anyRoute) return;
        const double min=slider.getMinimum(),max=slider.getMaximum();
        if(max<=min) return;
        const float base=static_cast<float>((slider.getValue()-min)/(max-min));
        const bool bipolar=modulationUiSelectedRouteIsBipolar(destination,display_.id);
        const float extent=std::abs(depth);
        const float lo=juce::jlimit(0.0f,1.0f,bipolar?base-extent:juce::jmin(base,base+depth));
        const float hi=juce::jlimit(0.0f,1.0f,bipolar?base+extent:juce::jmax(base,base+depth));
        const float current=juce::jlimit(0.0f,1.0f,
            base+depth*modulationUiRouteDisplaySourceValue(telemetry.selectedSource,bipolar));

        auto b=slider.getBounds().toFloat().reduced(3.0f);
        const float y=b.getBottom()+1.0f;
        const float x0=b.getX()+b.getWidth()*lo;
        const float x1=b.getX()+b.getWidth()*hi;
        const float xc=b.getX()+b.getWidth()*current;
        if(std::abs(depth)>=1.0e-4f) {
            g.setColour(signalSourceColour().withAlpha(.96f));
            g.drawLine(x0,y,x1,y,2.2f);
            if(telemetry.synthActive) {
                g.setColour(Palette::text());
                g.fillEllipse(juce::Rectangle<float>(5.0f,5.0f).withCentre({xc,y}));
            }
        } else {
            g.setColour(signalSourceColour().darker(.72f).withAlpha(.88f));
            g.drawRoundedRectangle(b.expanded(1.0f),2.5f,1.4f);
        }
    };

    drawRotary(wtPositionSlider_,ModDestination::WtPosition);
    drawLinear(octaveSlider_,ModDestination::Octave);
    drawLinear(semitoneSlider_,ModDestination::Semitone);
    drawLinear(fineSlider_,ModDestination::Fine);
    drawRotary(detuneSlider_,ModDestination::Detune);
    drawRotary(panSlider_,ModDestination::Pan);
    drawRotary(levelSlider_,ModDestination::Level);
    // Dynamic chain editors must address the selected stable child ID. Never
    // paint a hidden/removed editor merely because an old generic route exists.
    if(process1Amount_.isVisible() && selectedProcessId_!=0)
        drawRotary(process1Amount_,ModDestination::ProcessAmount,selectedProcessId_);
    if(route1Amount_.isVisible() && selectedRouteId_!=0)
        drawRotary(route1Amount_,ModDestination::RouteAmount,selectedRouteId_);

    // Each full OSC CHAIN row owns its modulation target and visualization.
    // These overlays are painted by OscillatorCard (above its children), while
    // the row controls live inside a clipped Viewport. Mirror the viewport clip
    // here so modulation arcs/dots cannot escape the scrolling OSC CHAIN area.
    g.saveState();
    g.reduceClipRegion(getLocalArea(&chainViewport_,chainViewport_.getLocalBounds()));
    for(std::size_t i=0;i<chainItemCount_;++i) {
        if(!chainAmounts_[i].isVisible())continue;
        const auto item=chainItems_[i];
        if(item.kind==ChainItemKind::Process)
            drawRotary(chainAmounts_[i],ModDestination::ProcessAmount,item.id);
        else if(item.kind==ChainItemKind::Route)
            drawRotary(chainAmounts_[i],ModDestination::RouteAmount,item.id);
    }
    g.restoreState();
}

OscillatorRack::OscillatorRack(ParameterSetter setter,ParameterGetter getter,
                                   ModuleAdder moduleAdder,ModuleRemover moduleRemover,
                                   ModuleStateSetter moduleStateSetter,ModuleStateGetter moduleStateGetter,ModuleEnabledSetter moduleEnabledSetter,ModuleEnabledGetter moduleEnabledGetter,
                                   std::function<InstrumentState()> snapshotGetter)
    : Panel("OSCILLATORS"),snapshotGetter_(std::move(snapshotGetter)),parameterSetter_(std::move(setter)),parameterGetter_(std::move(getter)),
      moduleAdder_(std::move(moduleAdder)),moduleRemover_(std::move(moduleRemover)),
      moduleStateSetter_(std::move(moduleStateSetter)),moduleStateGetter_(std::move(moduleStateGetter)),
      moduleEnabledSetter_(std::move(moduleEnabledSetter)),moduleEnabledGetter_(std::move(moduleEnabledGetter)) {
    addAndMakeVisible(viewport_);viewport_.setViewedComponent(&content_,false);
    content_.addMouseListener(&viewport_,true);
    viewport_.setScrollBarsShown(false,true);viewport_.setScrollBarThickness(10);
    viewport_.setScrollOnDragMode(juce::Viewport::ScrollOnDragMode::nonHover);
    for(auto* button:{&add_,&left_,&right_}) addAndMakeVisible(button);
    add_.setTooltip("Add an independent oscillator module");addTile_.setTooltip(add_.getTooltip());
    addTile_.setName("Add oscillator module");content_.addAndMakeVisible(addTile_);
    add_.onClick=[this]{addOscillator();};addTile_.onClick=add_.onClick;
    left_.setName("Scroll oscillators left");right_.setName("Scroll oscillators right");
    left_.onClick=[this]{viewport_.setViewPosition(juce::jmax(0,viewport_.getViewPositionX()-cardWidth_-4),0);};
    right_.onClick=[this]{viewport_.setViewPosition(viewport_.getViewPositionX()+cardWidth_+4,0);};
    // mct-origami-audio-reengineer-p05.4-initial-editor-model-sync
    // Hidden timer polling stays suppressed, but construction requires one
    // unconditional model -> card topology synchronization.
    syncFromModel();
    // Keep oscillator animation at display cadence. This timer only drives
    // visible-card synchronization/repaint; DSP remains audio-thread driven.
    startTimerHz(60);
}
OscillatorRack::~OscillatorRack() {stopTimer();content_.removeMouseListener(&viewport_);viewport_.setViewedComponent(nullptr,false);}
void OscillatorRack::addOscillator() {
    if(!moduleAdder_ || moduleAdder_()==0) return;
    timerCallback();
    viewport_.setViewPosition(juce::jmax(0,content_.getWidth()-viewport_.getMaximumVisibleWidth()),0);
}
void OscillatorRack::syncFromModel() {
    if(!snapshotGetter_) return;
    const auto state=snapshotGetter_();
    std::vector<unsigned> ids;
    for(const auto& m:state.oscillators) if(m.id) ids.push_back(m.id);
    bool changed=ids.size()!=cards_.size();
    for(std::size_t i=0;!changed && i<ids.size();++i) changed=ids[i]!=cards_[i]->id();
    if(changed) {
        const auto x=viewport_.getViewPositionX();

        // Stable module IDs own card lifetime. A sibling topology change must
        // not destroy/recreate every existing OSC CHAIN editor.
        std::vector<std::unique_ptr<OscillatorCard>> oldCards;
        oldCards.swap(cards_);
        cards_.reserve(ids.size());
        for(auto id:ids) {
            auto existing=std::find_if(oldCards.begin(),oldCards.end(),
                [id](const auto& card){return card && card->id()==id;});
            if(existing!=oldCards.end())
                cards_.push_back(std::move(*existing));
            else
                createCard(id);
        }

        layoutCards();viewport_.setViewPosition(x,0);repaint();
    }
    const auto visible=juce::Rectangle<int>(
        viewport_.getViewPositionX(),viewport_.getViewPositionY(),
        viewport_.getWidth(),viewport_.getHeight()).expanded(24,0);
    for(auto& card:cards_) {
        if(card->getBounds().intersects(visible))
            card->syncFromModel();
    }
    add_.setEnabled(ids.size()<OscillatorModuleBank::capacity);
    addTile_.setEnabled(add_.isEnabled());
}
void OscillatorRack::createCard(unsigned moduleId) {
    juce::Component::SafePointer<OscillatorRack> safe(this);
    auto card=std::make_unique<OscillatorCard>(
        OscillatorDisplay{moduleId,static_cast<unsigned>(cards_.size()+1),"Basic Shapes"},
        [safe](unsigned id) {
            juce::MessageManager::callAsync([safe,id] {
                if(safe!=nullptr) safe->removeOscillator(id);
            });
        },
        [this,moduleId](mct::origami::ParameterId pid,float value) -> bool {
            if(moduleId==1) return parameterSetter_ ? parameterSetter_(pid,value) : false;
            if(!moduleStateGetter_ || !moduleStateSetter_) return false;
            auto s=moduleStateGetter_(moduleId);

            switch(pid) {
                case mct::origami::ParameterId::Waveform: s.waveform=value; s.wtPosition=juce::jlimit(0.0f,1.0f,value/3.0f); break;
                case mct::origami::ParameterId::OscOctave: s.octave=value; break;
                case mct::origami::ParameterId::OscSemitone: s.semitone=value; break;
                case mct::origami::ParameterId::OscFine: s.fineCents=value; break;
                case mct::origami::ParameterId::OscUnison: s.unison=static_cast<unsigned>(juce::jlimit(1,16,juce::roundToInt(value))); break;
                case mct::origami::ParameterId::OscDetune: s.detuneCents=value; break;
                case mct::origami::ParameterId::OscPan: s.pan=value; break;
                case mct::origami::ParameterId::OscLevel: s.level=value; break;
                case mct::origami::ParameterId::Cutoff:
                case mct::origami::ParameterId::Resonance:
                case mct::origami::ParameterId::Attack:
                case mct::origami::ParameterId::Decay:
                case mct::origami::ParameterId::Sustain:
                case mct::origami::ParameterId::Release:
                case mct::origami::ParameterId::MasterGain:
                    return false;
            }
            return moduleStateSetter_(moduleId,s);
        },
        [this,moduleId](mct::origami::ParameterId pid) -> float {
            if(moduleId==1) return parameterGetter_ ? parameterGetter_(pid) : 0.0f;
            if(!moduleStateGetter_) return 0.0f;
            const auto s=moduleStateGetter_(moduleId);
            switch(pid) {
                case mct::origami::ParameterId::Waveform: return juce::jlimit(0.0f,1.0f,s.wtPosition)*3.0f;
                case mct::origami::ParameterId::OscOctave: return s.octave;
                case mct::origami::ParameterId::OscSemitone: return s.semitone;
                case mct::origami::ParameterId::OscFine: return s.fineCents;
                case mct::origami::ParameterId::OscUnison: return static_cast<float>(s.unison);
                case mct::origami::ParameterId::OscDetune: return s.detuneCents;
                case mct::origami::ParameterId::OscPan: return s.pan;
                case mct::origami::ParameterId::OscLevel: return s.level;
                case mct::origami::ParameterId::Cutoff:
                case mct::origami::ParameterId::Resonance:
                case mct::origami::ParameterId::Attack:
                case mct::origami::ParameterId::Decay:
                case mct::origami::ParameterId::Sustain:
                case mct::origami::ParameterId::Release:
                case mct::origami::ParameterId::MasterGain:
                    return 0.0f;
            }
            return 0.0f;
        },
        [this,moduleId](unsigned,bool enabled) -> bool {
            return moduleEnabledSetter_ ? moduleEnabledSetter_(moduleId,enabled) : false;
        },
        [this,moduleId](unsigned) -> bool {
            return moduleEnabledGetter_ ? moduleEnabledGetter_(moduleId) : true;
        },
        [this](unsigned id,const mct::origami::OscillatorModuleState& state) -> bool {
            return moduleStateSetter_ ? moduleStateSetter_(id,state) : false;
        },
        [this](unsigned id) -> mct::origami::OscillatorModuleState {
            return moduleStateGetter_ ? moduleStateGetter_(id) : mct::origami::OscillatorModuleState{};
        },
        [this]() -> mct::origami::InstrumentState {
            return snapshotGetter_ ? snapshotGetter_() : mct::origami::InstrumentState{};
        });

    content_.addAndMakeVisible(*card);
    cards_.push_back(std::move(card));
    layoutCards();
    repaint();

}
void OscillatorRack::removeOscillator(unsigned id) {
    if(id==1) return;
    if(moduleRemover_ && !moduleRemover_(id)) return;

    cards_.erase(std::remove_if(cards_.begin(),cards_.end(),
        [id](const auto& card){return card->id()==id;}),cards_.end());

    for(std::size_t i=0;i<cards_.size();++i)
        cards_[i]->setDisplayOrdinal(static_cast<unsigned>(i+1));

    layoutCards();
    repaint();
}

void OscillatorRack::renumberOscillators() {
    for(std::size_t index=0;index<cards_.size();++index)
        cards_[index]->setOrdinal(static_cast<unsigned>(index+1));
}
void OscillatorRack::layoutCards() {
    const auto previousX=viewport_.getViewPositionX();
    cardWidth_=420;
    // Fill the oscillator viewport vertically. The previous -12 px allowance
    // left a dead strip beneath every oscillator card even when no horizontal
    // scrollbar occupied that space.
    const int height=juce::jmax(0,viewport_.getHeight());
    int x=0;for(auto& card:cards_) {card->setBounds(x,0,cardWidth_,height);x+=cardWidth_+4;}
    addTile_.setBounds(x,0,74,height);content_.setSize(juce::jmax(viewport_.getWidth(),x+74),height);
    viewport_.setViewPosition(juce::jmin(previousX,juce::jmax(0,content_.getWidth()-viewport_.getMaximumVisibleWidth())),0);
}
void OscillatorRack::resized() {
    add_.setBounds(getWidth()-155,5,143,23);
    auto body=contentBounds();left_.setBounds(body.removeFromLeft(25).reduced(0,5));body.removeFromLeft(4);
    right_.setBounds(body.removeFromRight(25).reduced(0,5));body.removeFromRight(4);viewport_.setBounds(body);layoutCards();
}
void OscillatorRack::paintContent(juce::Graphics& g,juce::Rectangle<int>) {
    text(g,juce::String(count())+" MODULES",{140,5,getWidth()-305,24},8.5f,Palette::muted(),juce::Justification::centredRight);
}
}
