// mct-origami-wt-pos-real-morph-v22.2.1
// mct-origami-v22.1-ui-scope-repair-1
#include <cmath>
// mct-origami-wt-position-wiring-v22.1
// mct-origami-osc-power-compact-pitch-v21.4.1
#include "OscillatorRack.h"
// mct-origami-v19.3-visual-cleanup
namespace mct::origami::ui {
OscillatorCard::OscillatorCard(OscillatorDisplay display,std::function<void(unsigned)> remove,
                               std::function<bool(mct::origami::ParameterId,float)> setter,
                               std::function<float(mct::origami::ParameterId)> getter,
                               std::function<bool(unsigned,bool)> enabledSetter,
                               std::function<bool(unsigned)> enabledGetter)
    : Panel("OSC "+juce::String(display.ordinal)),display_(std::move(display)),
      parameterSetter_(std::move(setter)),parameterGetter_(std::move(getter)),
      enabledSetter_(std::move(enabledSetter)),enabledGetter_(std::move(enabledGetter)) {
    addAndMakeVisible(remove_);
    remove_.setTooltip("Remove this layout module (does not change audio)");
    remove_.onClick=[id=display_.id,removeCallback=std::move(remove)] { removeCallback(id); };

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
        waveformPrevious_.setTooltip("Previous built-in waveform");
        waveformNext_.setTooltip("Next built-in waveform");
        panSlider_.setRange(-1.0,1.0,0.001);
        levelSlider_.setRange(0.0,1.0,0.001);
        panSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscPan),juce::dontSendNotification);
        levelSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscLevel),juce::dontSendNotification);
        waveformIndex_=juce::jlimit(0,3,juce::roundToInt(parameterGetter_(mct::origami::ParameterId::Waveform)));

        for(auto* slider:{&octaveSlider_,&semitoneSlider_,&fineSlider_}) {
            addAndMakeVisible(slider);
            slider->setSliderStyle(juce::Slider::LinearBarVertical);
            slider->setTextBoxStyle(juce::Slider::TextBoxBelow,false,38,14);
            slider->setColour(juce::Slider::backgroundColourId,Palette::inset());
            slider->setColour(juce::Slider::trackColourId,Palette::borderStrong());
            slider->setColour(juce::Slider::thumbColourId,Palette::text());
            slider->setColour(juce::Slider::textBoxTextColourId,Palette::text());
            slider->setColour(juce::Slider::textBoxBackgroundColourId,Palette::inset());
            slider->setColour(juce::Slider::textBoxOutlineColourId,Palette::borderSoft());
        }
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

        for (auto* slider : {&unisonSlider_, &detuneSlider_}) {
            addAndMakeVisible(*slider);
            slider->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
            slider->setTextBoxStyle(juce::Slider::NoTextBox, false, 0, 0);
            slider->setRotaryParameters(juce::MathConstants<float>::pi * 1.20f,
                                        juce::MathConstants<float>::pi * 2.80f, true);
            slider->setMouseDragSensitivity(180);
        }

        unisonSlider_.setRange(1.0, 16.0, 1.0);
        detuneSlider_.setRange(0.0, 100.0, 0.1);
        unisonSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscUnison), juce::dontSendNotification);
        detuneSlider_.setValue(parameterGetter_(mct::origami::ParameterId::OscDetune), juce::dontSendNotification);

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

        addAndMakeVisible(unisonLabel_);
        addAndMakeVisible(detuneLabel_);
        unisonLabel_.setText("UNISON", juce::dontSendNotification);
        detuneLabel_.setText("DETUNE", juce::dontSendNotification);
        for (auto* label : {&unisonLabel_, &detuneLabel_}) {
            label->setJustificationType(juce::Justification::centred);
            label->setColour(juce::Label::textColourId, Palette::muted());
            label->setFont(juce::FontOptions(8.0f));
            label->setInterceptsMouseClicks(false, false);
        }
        auto applyWaveform=[this](int delta) {
            waveformIndex_=(waveformIndex_+delta+4)%4;
            parameterSetter_(mct::origami::ParameterId::Waveform,float(waveformIndex_));
            repaint();
        };
        waveformPrevious_.onClick=[applyWaveform]{ applyWaveform(-1); };
        waveformNext_.onClick=[applyWaveform]{ applyWaveform(1); };

        for(auto* label:{&panLabel_,&levelLabel_}) {
            addAndMakeVisible(label);
            label->setJustificationType(juce::Justification::centred);
            label->setColour(juce::Label::textColourId,Palette::muted());
            label->setFont(juce::FontOptions(8.0f));
        }
        panLabel_.setText("PAN",juce::dontSendNotification);
        levelLabel_.setText("LEVEL",juce::dontSendNotification);
    }

    refreshVisibleNumber();

    addAndMakeVisible(power_);
    power_.setClickingTogglesState(true);
    power_.setTooltip("Enable / disable this oscillator module");
    power_.setName("Power OSC "+juce::String(display_.id));
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
    wtPositionSlider_.setTooltip("Position inside the selected wavetable");
    wtPositionLabel_.setText("WT POS",juce::dontSendNotification);
    wtPositionLabel_.setJustificationType(juce::Justification::centred);
    wtPositionLabel_.setFont(juce::FontOptions(8.0f));
    wtPositionLabel_.setColour(juce::Label::textColourId,Palette::muted());
    if(parameterGetter_)
        wtPositionSlider_.setValue(juce::jlimit(0.0,1.0,double(parameterGetter_(mct::origami::ParameterId::Waveform))/3.0),juce::dontSendNotification);
    wtPositionSlider_.onValueChange=[this] {
        if(parameterSetter_)
            parameterSetter_(mct::origami::ParameterId::Waveform,float(wtPositionSlider_.getValue()*3.0));
        repaint();
    };}

void OscillatorCard::refreshVisibleNumber() {
    title_="OSC "+juce::String(display_.ordinal);
    setName(title_);
    remove_.setName("Remove "+title_);
    repaint();
}

void OscillatorCard::setOrdinal(unsigned ordinal) {
    if(display_.ordinal==ordinal) return;
    display_.ordinal=ordinal;
    refreshVisibleNumber();
}
void OscillatorCard::setDisplayOrdinal(unsigned ordinal) {
    display_.ordinal=ordinal;
    setTitle("OSC "+juce::String(ordinal));
    repaint();
}
void OscillatorCard::resized() {
    remove_.setBounds(getWidth()-31,6,24,21);
    power_.setBounds(getWidth()-62,6,27,21);
    if(!engineBacked_) return;

    auto body=contentBounds();
    body.removeFromTop(2);
    auto controls=body.removeFromBottom(56);
    body.removeFromBottom(4);

    auto upper=body;
    const int processWidth=juce::jlimit(104,132,upper.getWidth()*34/100);
    auto process=upper.removeFromRight(processWidth);
    juce::ignoreUnused(process);
    upper.removeFromRight(7);

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
    auto panCell=controls.withX(controls.getX()+cellWidth*4).withWidth(cellWidth);
    auto levelCell=controls.withX(controls.getX()+cellWidth*5).withWidth(cellWidth);
    auto place=[&](juce::Rectangle<int> cell,juce::Slider& slider,juce::Label& label) {
        auto labelBounds=cell.removeFromBottom(18);
        slider.setBounds(cell.reduced(5,1));
        label.setBounds(labelBounds);
    };
    place(wtPositionCell,wtPositionSlider_,wtPositionLabel_);
    place(unisonCell,unisonSlider_,unisonLabel_);
    place(detuneCell,detuneSlider_,detuneLabel_);
    place(panCell,panSlider_,panLabel_);
    place(levelCell,levelSlider_,levelLabel_);
}
void OscillatorCard::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    // mct-origami-oscillator-identity-tuning-v13
    // Dense by design: this is a wavetable synth. Preserve the established
    // source -> process -> tuning -> performance-control hierarchy.

    text(g,display_.source.toUpperCase(),{87,5,getWidth()-128,25},8.2f,Palette::muted(),juce::Justification::centred);

    auto working=body;
    working.removeFromTop(2);

    const int controlsHeight=56;
    auto controls=working.removeFromBottom(controlsHeight);
    working.removeFromBottom(4);

    auto upper=working;

    // Right: oscillator-local processing.
    const int processWidth=juce::jlimit(104,132,upper.getWidth()*34/100);
    auto process=upper.removeFromRight(processWidth);
    upper.removeFromRight(7);
    const int tuningHeight=30;
    auto tuning=upper.removeFromBottom(tuningHeight);
    upper.removeFromBottom(4);

    // Left: authoritative 1:1 wavetable viewport + compact browser strip.
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

    // Exactly one oscillator cycle for the current placeholder waveform.
    juce::Path wave;
    for(int i=0;i<=96;++i) {
        const float t=float(i)/96.0f;
        const float y=.5f-.30f*std::sin(t*juce::MathConstants<float>::twoPi);
        const float px=float(inner.getX())+t*inner.getWidth();
        const float py=float(inner.getY())+y*inner.getHeight();
        if(i==0) wave.startNewSubPath(px,py); else wave.lineTo(px,py);
    }
    g.setColour(Palette::accent().withAlpha(.94f));
    g.strokePath(wave,juce::PathStrokeType(1.55f));

    // Wavetable/browser identity strip. Visual scaffold only for now.
    auto browserBox=browser.withX(preview.getX()).withWidth(preview.getWidth());
    well(g,browserBox);
    text(g,"<",browserBox.removeFromLeft(18),8.5f,Palette::muted(),juce::Justification::centred);
    text(g,">",browserBox.removeFromRight(18),8.5f,Palette::muted(),juce::Justification::centred);
    juce::String waveformName="BASIC SHAPES";
    if(engineBacked_) {
        static const juce::StringArray waveformNames{"SINE","SAW","SQUARE","TRIANGLE"};
        waveformName=waveformNames[juce::jlimit(0,3,waveformIndex_)];
    }
    text(g,waveformName,browserBox,8.2f,Palette::secondary(),juce::Justification::centred);

    // OSC PROCESS stays dense and local to the source.
    auto processBox=process.reduced(1,0);
    well(g,processBox);
    auto processInner=processBox.reduced(8);
    auto processTitle=processInner.removeFromTop(18);
    text(g,"OSC PROCESS",processTitle,8.5f,Palette::secondary(),juce::Justification::centredLeft);

    auto modeRow=processInner.removeFromTop(24);
    well(g,modeRow);
    text(g,"BEND +",modeRow.reduced(7,0),8.5f,Palette::text(),juce::Justification::centredLeft);
    text(g,"v",modeRow.reduced(7,0),8.5f,Palette::muted(),juce::Justification::centredRight);

    processInner.removeFromTop(6);
    const int dialRowHeight=processInner.getHeight()/2;
    auto topRow=processInner.removeFromTop(dialRowHeight);
    auto bottomRow=processInner;

    dial(g,topRow.removeFromLeft(topRow.getWidth()/2),"PHASE",.42f);
    dial(g,topRow,"WARP",.58f);
    dial(g,bottomRow.removeFromLeft(bottomRow.getWidth()/2),"ASYM",.35f);
    dial(g,bottomRow,"MIX",.72f);

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

    // Core oscillator controls remain compact and subordinate to the source view.
    if(engineBacked_) {
        auto firstFour=controls;
        firstFour.setWidth(controls.getWidth()*4/6);
        dials(g,firstFour,{"WT POS","UNISON","DETUNE","BLEND"});
    } else {
        if(engineBacked_) {
        const int w=controls.getWidth()/6;
        dial(g,controls.withX(controls.getX()).withWidth(w),"WT POS",.15f);
        dial(g,controls.withX(controls.getX()+w*3).withWidth(w),"BLEND",.55f);
    } else {
        if(engineBacked_) {
        const int cellWidth=controls.getWidth()/6;
        dial(g,controls.withX(controls.getX()).withWidth(cellWidth),"WT POS",.15f);
        dial(g,controls.withX(controls.getX()+cellWidth*3).withWidth(cellWidth),"BLEND",.55f);
    } else {
        if(engineBacked_) {
        // mct-origami-osc1-duplicate-knob-fix-v19.5.1
        const int cellWidth=controls.getWidth()/6;
        dial(g,controls.withX(controls.getX()).withWidth(cellWidth),"WT POS",.15f);
        dial(g,controls.withX(controls.getX()+cellWidth*3).withWidth(cellWidth),"BLEND",.55f);
    } else {   // WT POS / UNISON / DETUNE / PAN / LEVEL are live child controls.
    // BLEND remains preview-only until its DSP contract is implemented.
    {
        const int cellWidth=controls.getWidth()/6;
        auto blendCell=controls.withX(controls.getX()+cellWidth*3).withWidth(cellWidth);
        dial(g,blendCell,"BLEND",.35f);
    
    }
    }
    }
    }
}


    // V22.2.1 live WT POS overlay. Uses the actual preview rectangle detected
    // from this source file rather than hard-coded layout geometry.
    {
        const float physical=parameterGetter_
            ? juce::jlimit(0.0f,3.0f,parameterGetter_(mct::origami::ParameterId::Waveform))
            : 0.0f;
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

        juce::Path p;
        constexpr int points=256;
        for(int i=0;i<points;++i) {
            const float phase=float(i)/float(points-1);
            const float ya=shape(a,phase);
            const float yb=shape(next,phase);
            const float yv=juce::jmap(ya+(yb-ya)*blend,-1.0f,1.0f,wtRect.getBottom(),wtRect.getY());
            const float x=juce::jmap(float(i),0.0f,float(points-1),wtRect.getX(),wtRect.getRight());
            if(i==0) p.startNewSubPath(x,yv); else p.lineTo(x,yv);
        }
        g.setColour(Palette::text());
        g.strokePath(p,juce::PathStrokeType(1.5f));
    }
}

OscillatorRack::OscillatorRack(ParameterSetter setter,ParameterGetter getter,
                                   ModuleAdder moduleAdder,ModuleRemover moduleRemover,
                                   ModuleStateSetter moduleStateSetter,ModuleStateGetter moduleStateGetter,ModuleEnabledSetter moduleEnabledSetter,ModuleEnabledGetter moduleEnabledGetter)
    : Panel("OSCILLATORS"),parameterSetter_(std::move(setter)),parameterGetter_(std::move(getter)),
      moduleAdder_(std::move(moduleAdder)),moduleRemover_(std::move(moduleRemover)),
      moduleStateSetter_(std::move(moduleStateSetter)),moduleStateGetter_(std::move(moduleStateGetter)),
      moduleEnabledSetter_(std::move(moduleEnabledSetter)),moduleEnabledGetter_(std::move(moduleEnabledGetter)) {
    addAndMakeVisible(viewport_);viewport_.setViewedComponent(&content_,false);
    viewport_.setScrollBarsShown(false,true);viewport_.setScrollBarThickness(10);
    viewport_.setScrollOnDragMode(juce::Viewport::ScrollOnDragMode::nonHover);
    for(auto* button:{&add_,&left_,&right_}) addAndMakeVisible(button);
    add_.setTooltip("Add a visual oscillator module. Additional oscillator DSP is not implemented.");addTile_.setTooltip(add_.getTooltip());
    addTile_.setName("Add oscillator module");content_.addAndMakeVisible(addTile_);
    add_.onClick=[this]{addOscillator();};addTile_.onClick=add_.onClick;
    left_.setName("Scroll oscillators left");right_.setName("Scroll oscillators right");
    left_.onClick=[this]{viewport_.setViewPosition(juce::jmax(0,viewport_.getViewPositionX()-cardWidth_-8),0);};
    right_.onClick=[this]{viewport_.setViewPosition(viewport_.getViewPositionX()+cardWidth_+8,0);};
    for(int i=0;i<4;++i) addOscillator();
}
OscillatorRack::~OscillatorRack() {viewport_.setViewedComponent(nullptr,false);}
void OscillatorRack::addOscillator() {
    unsigned moduleId=1;
    if(!cards_.empty()) {
        if(!moduleAdder_) return;
        moduleId=moduleAdder_();
        if(moduleId==0) return;
    }

    juce::Component::SafePointer<OscillatorRack> safe(this);
    auto card=std::make_unique<OscillatorCard>(
        OscillatorDisplay{moduleId,static_cast<unsigned>(cards_.size()+1),"Wavetable"},
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
        },
        [this,moduleId](unsigned,bool enabled) -> bool {
            return moduleEnabledSetter_ ? moduleEnabledSetter_(moduleId,enabled) : false;
        },
        [this,moduleId](unsigned) -> bool {
            return moduleEnabledGetter_ ? moduleEnabledGetter_(moduleId) : true;
        });

    content_.addAndMakeVisible(*card);
    cards_.push_back(std::move(card));
    layoutCards();
    repaint();
    if(viewport_.getWidth()>0)
        viewport_.setViewPosition(
            juce::jmax(0,content_.getWidth()-viewport_.getMaximumVisibleWidth()),0);
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
    cardWidth_=336;
    const int height=juce::jmax(0,viewport_.getHeight()-12);
    int x=0;for(auto& card:cards_) {card->setBounds(x,0,cardWidth_,height);x+=cardWidth_+8;}
    addTile_.setBounds(x,0,74,height);content_.setSize(juce::jmax(viewport_.getWidth(),x+74),height);
    viewport_.setViewPosition(juce::jmin(previousX,juce::jmax(0,content_.getWidth()-viewport_.getMaximumVisibleWidth())),0);
}
void OscillatorRack::resized() {
    add_.setBounds(getWidth()-155,5,143,23);
    auto body=contentBounds();left_.setBounds(body.removeFromLeft(25).reduced(0,8));body.removeFromLeft(7);
    right_.setBounds(body.removeFromRight(25).reduced(0,8));body.removeFromRight(7);viewport_.setBounds(body);layoutCards();
}
void OscillatorRack::paintContent(juce::Graphics& g,juce::Rectangle<int>) {
    text(g,juce::String(count())+" MODULES",{140,5,getWidth()-305,24},8.5f,Palette::muted(),juce::Justification::centredRight);
}
}
