// mct-origami-v32.2.1-scroll-drag-matrix-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.2.1-mod-ring-retrigger-refine
// mct-origami-v31.2.0-mod-visuals-wavetable-spectral
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v30.0.0-dynamic-source-layout-scaffold
// mct-origami-v26.4.3-match-signal-fill-exposure
// mct-origami-v26.4.2-curve-cropped-signal-fills
// mct-origami-v26.4.1-flat-signal-fills
// mct-origami-v26.4.0-global-signal-colour-system
#include "SignalPanels.h"
#include "ModulationUiTelemetry.h"
namespace mct::origami::ui {
void MixerPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    const juce::StringArray channels{"OSC 1","OSC 2","OSC 3","OSC 4","SUB","NOISE"};
    const int width=body.getWidth()/6;
    for(int i=0;i<6;++i) {
        auto strip=body.removeFromLeft(width).reduced(3,1);auto muteSolo=strip.removeFromBottom(19);auto caption=strip.removeFromBottom(21);
        auto track=strip.withSizeKeepingCentre(10,juce::jmax(12,strip.getHeight()-5));
        auto trackFloat=track.toFloat();
        g.setColour(Palette::inset());g.fillRoundedRectangle(trackFloat,5.0f);
        g.setColour(Palette::borderSoft());g.drawRoundedRectangle(trackFloat.reduced(.5f),5.0f,1.0f);

        const float height=static_cast<float>(track.getHeight());
        const int position=track.getY()+juce::roundToInt(height*(.31f+float(i%4)*.075f));
        auto cap=juce::Rectangle<float>(18.0f,5.0f).withCentre({float(track.getCentreX()),float(position)});
        g.setColour(Palette::raised());g.fillRoundedRectangle(cap,2.0f);
        g.setColour(Palette::borderStrong());g.drawRoundedRectangle(cap.reduced(.5f),2.0f,1.0f);
        g.setColour(Palette::accent().withAlpha(.88f));g.fillRect(cap.reduced(3.0f,2.0f));

        text(g,channels[i],caption,8.7f,Palette::muted(),juce::Justification::centred);
        well(g,muteSolo.reduced(1,0));
        text(g,"M   S",muteSolo,8.5f,Palette::secondary(),juce::Justification::centred);
    }
}
// mct-origami-core-controls-v18.2
FilterPanel::FilterPanel(ParameterSetter setter,ParameterGetter getter,ModulationBindings bindings)
    : Panel("FILTER"),setter_(std::move(setter)),getter_(std::move(getter)),
      bindings_(std::move(bindings)) {
    for(auto* slider:{&cutoff_,&resonance_}) {
        addAndMakeVisible(slider);
        slider->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        slider->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
        slider->setRotaryParameters(juce::MathConstants<float>::pi*1.20f,
                                    juce::MathConstants<float>::pi*2.80f,true);
        slider->setMouseDragSensitivity(220);
    }

    cutoff_.setRange(20.0,20000.0,1.0);
    cutoff_.setSkewFactorFromMidPoint(1000.0);
    resonance_.setRange(0.0,1.0,0.001);

    cutoff_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::Cutoff));
    cutoff_.getProperties().set("mct.mod.oscillator",0);
    resonance_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::Resonance));
    resonance_.getProperties().set("mct.mod.oscillator",0);

    if(getter_) {
        cutoff_.setValue(getter_(mct::origami::ParameterId::Cutoff),juce::dontSendNotification);
        resonance_.setValue(getter_(mct::origami::ParameterId::Resonance),juce::dontSendNotification);
    }

    cutoff_.onValueChange=[this]{
        if(setter_) setter_(mct::origami::ParameterId::Cutoff,float(cutoff_.getValue()));
        repaint();
    };
    resonance_.onValueChange=[this]{
        if(setter_) setter_(mct::origami::ParameterId::Resonance,float(resonance_.getValue()));
        repaint();
    };

    for(auto* label:{&cutoffLabel_,&resonanceLabel_}) {
        addAndMakeVisible(label);
        label->setJustificationType(juce::Justification::centred);
        label->setColour(juce::Label::textColourId,Palette::muted());
        label->setFont(juce::FontOptions(8.0f));
    }
    cutoffLabel_.setText("CUTOFF",juce::dontSendNotification);
    resonanceLabel_.setText("RESONANCE",juce::dontSendNotification);

    addAndMakeVisible(filterViewport_);
    filterViewport_.setViewedComponent(&filterContent_,false);
    filterViewport_.setScrollBarsShown(true,false);
    filterViewport_.setScrollBarThickness(6);
    filterContent_.addAndMakeVisible(filter1_);
    for(auto* button:{&filterAdd_,&filterRemove_}) addAndMakeVisible(*button);
    filter1_.setName("FILTER SOURCE TAB");
    filter1_.setClickingTogglesState(true);
    filter1_.setToggleState(true,juce::dontSendNotification);
    filter1_.setTooltip("Current engine Filter 1");
    filterAdd_.setTooltip("Add Filter 1 when the collection is empty");
    filterRemove_.setTooltip("Remove/bypass Filter 1 and its Matrix routes");

    filterAdd_.onClick=[this] {
        if(!bindings_.snapshot || !bindings_.modulation) return;
        auto mod=bindings_.snapshot().modulation;
        if(mod.filterEnabled) return;
        mod.filterEnabled=true;
        if(bindings_.modulation(mod)) {
            filterEnabled_=true;
            syncFromModel(); resized(); repaint();
        }
    };

    filterRemove_.onClick=[this] {
        if(!bindings_.snapshot || !bindings_.modulation) return;
        auto mod=bindings_.snapshot().modulation;
        if(!mod.filterEnabled) return;
        mod.filterEnabled=false;

        std::array<ModRoute,ModulationState::capacity> compact{};
        std::size_t write=0;
        for(const auto& route:mod.routes) {
            const bool targetsFilter=
                route.destination.parameter==ModDestination::Cutoff ||
                route.destination.parameter==ModDestination::Resonance;
            if(route.id!=0 && !targetsFilter) compact[write++]=route;
        }
        mod.routes=compact;

        if(bindings_.modulation(mod)) {
            filterEnabled_=false;
            syncFromModel(); resized(); repaint();
        }
    };
}

void FilterPanel::syncFromModel() {
    if(bindings_.snapshot) filterEnabled_=bindings_.snapshot().modulation.filterEnabled;

    filter1_.setVisible(filterEnabled_);
    filterRemove_.setEnabled(filterEnabled_);
    filterAdd_.setEnabled(!filterEnabled_);
    cutoff_.setVisible(filterEnabled_);
    resonance_.setVisible(filterEnabled_);
    cutoffLabel_.setVisible(filterEnabled_);
    resonanceLabel_.setVisible(filterEnabled_);

    if(getter_) {
        if(!cutoff_.isMouseButtonDown()) cutoff_.setValue(getter_(ParameterId::Cutoff),juce::dontSendNotification);
        if(!resonance_.isMouseButtonDown()) resonance_.setValue(getter_(ParameterId::Resonance),juce::dontSendNotification);
    }
    repaint();
}
void FilterPanel::resized() {
    auto body=contentBounds();

    constexpr int railWidth=116;
    filterRail_=body.removeFromLeft(railWidth);
    body.removeFromLeft(6);

    auto rail=filterRail_.reduced(4,5);
    auto collectionControls=rail.removeFromBottom(24);
    filterRemove_.setBounds(collectionControls.removeFromLeft(
        (collectionControls.getWidth()-3)/2));
    collectionControls.removeFromLeft(3);
    filterAdd_.setBounds(collectionControls);
    rail.removeFromBottom(5);
    filterViewport_.setBounds(rail);
    constexpr int filterRowHeight=38;
    const int contentWidth=juce::jmax(1,filterViewport_.getWidth()-6);
    filter1_.setBounds(filterEnabled_ ? juce::Rectangle<int>(0,0,contentWidth,filterRowHeight-2)
                                      : juce::Rectangle<int>{});
    filterContent_.setSize(contentWidth,juce::jmax(filterRowHeight,filterViewport_.getHeight()));

    auto controls=body.removeFromBottom(juce::jmin(57,body.getHeight()/3+10));
    const int w=controls.getWidth()/6;
    auto place=[&](int idx,juce::Slider& slider,juce::Label& label){
        auto cell=controls.withX(controls.getX()+idx*w).withWidth(w);
        auto lab=cell.removeFromBottom(17);
        slider.setBounds(cell.reduced(5,0));
        label.setBounds(lab);
    };
    place(0,cutoff_,cutoffLabel_);
    place(1,resonance_,resonanceLabel_);
}

void FilterPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    constexpr int railWidth=116;
    auto rail=body.removeFromLeft(railWidth);
    body.removeFromLeft(6);

    well(g,rail);
    text(g,"FILTERS",rail.removeFromTop(18).reduced(5,0),8.0f,Palette::muted());

    if(!filterEnabled_) {
        text(g,"NO FILTER — PRESS + TO ADD FILTER 1",body.reduced(12),10.5f,
             Palette::muted(),juce::Justification::centred);
        return;
    }

    text(g,"LOW-PASS",{body.getX()+4,5,100,24},10,Palette::muted());
    text(g,"ROUTING",{body.getRight()-96,5,90,24},9,Palette::muted(),juce::Justification::centredRight);

    auto controls=body.removeFromBottom(juce::jmin(57,body.getHeight()/3+10));
    body.removeFromBottom(7);
    auto routing=body.removeFromRight(82);
    body.removeFromRight(8);

    well(g,body);

    auto graphArea=body.reduced(8);
    g.setColour(Palette::border().withAlpha(.7f));
    for(int i=1;i<5;++i)
        g.drawVerticalLine(graphArea.getX()+graphArea.getWidth()*i/5,float(graphArea.getY()),float(graphArea.getBottom()));

    juce::Path response;
    response.startNewSubPath(float(graphArea.getX()),float(graphArea.getCentreY()));
    response.lineTo(float(graphArea.getX())+graphArea.getWidth()*.49f,float(graphArea.getCentreY()));
    response.cubicTo(float(graphArea.getX())+graphArea.getWidth()*.65f,float(graphArea.getY()),
                     float(graphArea.getX())+graphArea.getWidth()*.72f,float(graphArea.getBottom()),
                     float(graphArea.getRight()),float(graphArea.getBottom()-2));
    // Fill ONLY the response area down to the graph's bottom/source edge.
    // No gradient and no whole-viewport tint.
    {
        juce::Path fill=response;
        fill.lineTo(float(graphArea.getRight()),float(graphArea.getBottom()));
        fill.lineTo(float(graphArea.getX()),float(graphArea.getBottom()));
        fill.closeSubPath();

        g.setColour(signalSurfaceColour(0.46f,0.22f));
        g.fillPath(fill);
    }

    g.setColour(Palette::accent());
    g.strokePath(response,juce::PathStrokeType(1.3f));

    const int rowHeight=juce::jmin(24,routing.getHeight()/3);
    for(const auto& label:juce::StringArray{"Serial","Parallel","Split"}) {
        auto row=routing.removeFromTop(rowHeight).reduced(1,1);
        well(g,row);
        text(g,label,row,10,label=="Serial"?Palette::text():Palette::muted(),juce::Justification::centred);
    }

    auto remaining=controls;
    remaining.removeFromLeft((controls.getWidth()/6)*2);
    dials(g,remaining,{"DRIVE","KEYTRACK","ENV AMT","MIX"});
}
void FilterPanel::paintOverChildren(juce::Graphics& g) {
    const auto& telemetry=modulationUiTelemetry();

    const auto drawRing=[&](juce::Slider& slider,ModDestination destination) {
        const float depth=modulationUiSelectedRouteAmount(destination,0);
        const bool anyRoute=modulationUiHasAnyRoute(destination,0);
        if(std::abs(depth)<1.0e-4f && !anyRoute) return;

        const double min=slider.getMinimum(),max=slider.getMaximum();
        if(max<=min) return;
        const float base=static_cast<float>((slider.getValue()-min)/(max-min));
        const bool bipolar=modulationUiSelectedRouteIsBipolar(destination,0);
        const float extent=std::abs(depth);
        const float lo=juce::jlimit(0.0f,1.0f,bipolar?base-extent:juce::jmin(base,base+depth));
        const float hi=juce::jlimit(0.0f,1.0f,bipolar?base+extent:juce::jmax(base,base+depth));
        const float current=juce::jlimit(0.0f,1.0f,
            base+depth*modulationUiRouteDisplaySourceValue(telemetry.selectedSource,bipolar));

        auto circle=slider.getBounds().toFloat().reduced(1.0f).expanded(2.0f);
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
            g.setColour(signalSourceColour().withAlpha(.96f));
            g.strokePath(range,juce::PathStrokeType(2.2f));

            if(telemetry.synthActive) {
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

    drawRing(cutoff_,ModDestination::Cutoff);
    drawRing(resonance_,ModDestination::Resonance);
}

void FxPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    if(pre_) {
        const int height=body.getHeight()/3;
        for(const auto& label:juce::StringArray{"DIST","COMP","SAT"}) {auto slot=body.removeFromTop(height).reduced(0,3);well(g,slot);text(g,label,slot,10,Palette::muted(),juce::Justification::centred);}
    } else {
        const int width=body.getWidth()/4;
        for(const auto& label:juce::StringArray{"CHORUS","DELAY","REVERB","+"}) {
            auto slot=body.removeFromLeft(width).reduced(2,3);well(g,slot);
            if(label=="+") {
                text(g,"+",slot.withTrimmedBottom(slot.getHeight()/3),22,Palette::muted(),juce::Justification::centred);
            } else {
                auto mark=slot.withTrimmedBottom(slot.getHeight()/3).toFloat();
                g.setColour(Palette::borderStrong());
                g.drawHorizontalLine(juce::roundToInt(mark.getCentreY()),mark.getCentreX()-8.0f,mark.getCentreX()+8.0f);
            }
            if(label!="+")text(g,label,slot.removeFromBottom(33),8,Palette::muted(),juce::Justification::centred);
        }
    }
}
}
