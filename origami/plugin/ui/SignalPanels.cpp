#include "core/ParameterFormatting.h"
// mct-origami-unified-routing-core-fx-p04
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
#include "SourceEntity.h"
#include "ModulationUiTelemetry.h"
#include "NativeChoiceMenu.h"
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

        text(g,channels[i],caption,Type::label,Palette::muted(),juce::Justification::centred);
        well(g,muteSolo.reduced(1,0));
        text(g,"M   S",muteSolo,Type::secondary,Palette::secondary(),juce::Justification::centred);
    }
}
FilterPanel::FilterPanel(ParameterSetter setter,ParameterGetter getter,ModulationBindings bindings)
    :Panel("SYNTH FILTERS"),setter_(std::move(setter)),getter_(std::move(getter)),bindings_(std::move(bindings)) {
    addAndMakeVisible(viewport_);viewport_.setViewedComponent(&railContent_,false);viewport_.setScrollBarsShown(false,false,true,false);
    for(auto& tab:tabs_) {railContent_.addAndMakeVisible(tab);tab.addMouseListener(this,false);tab.setName("MOD SOURCE TAB FILTER");}
    for(juce::Button* button:std::initializer_list<juce::Button*>{&add_,&remove_,&output_,&power_,&type_}) addAndMakeVisible(*button);
    add_.setTooltip("Add a per-voice Synth low-pass filter (8 instance slots)");
    remove_.setTooltip("Splice out this filter and remove its modulation routes");
    add_.onClick=[this]{addFilter();};remove_.onClick=[this]{if(legacy_) {auto mod=state_.modulation;mod.filterEnabled=false;std::array<std::uint32_t,32> ids{};std::size_t n=0;for(const auto& r:mod.routes) if(r.id && (r.destination.parameter==ModDestination::Cutoff || r.destination.parameter==ModDestination::Resonance)) ids[n++]=r.id;for(std::size_t i=0;i<n;++i) removeRouteCascade(mod,ids[i]);commit(mod);} else removeFilter(selectedId_);};
    type_.setName("Synth filter type");output_.setName("Synth filter output");power_.setName("Power Synth Filter");power_.setTooltip("Enable or bypass the selected Synth filter");
    type_.onClick=[this]{std::vector<NativeChoiceItem> items;for(const auto& info:dsp::filterTypes) items.push_back({int(info.id)+1,info.name,info.synth && !legacy_,"FILTER TYPE",false,info.unavailable,{}});showNativeChoiceMenu(type_,"Filter Type",items,0,[safe=juce::Component::SafePointer<FilterPanel>(this)](int choice){if(safe && choice>0) safe->setFilterType(static_cast<dsp::FilterType>(choice-1));});};
    output_.onClick=[this]{showOutputMenu();};
    power_.onClick=[this]{const auto slot=synthFilterSlot(state_.modulation.synthFilters,selectedId_);if(slot==maxSynthFilters) return;auto mod=state_.modulation;mod.synthFilters.filters[slot].power=!mod.synthFilters.filters[slot].power;commit(mod);};

    for(std::size_t i=0;i<knobs_.size();++i) {
        auto& knob=knobs_[i];addAndMakeVisible(knob);const auto& control=dsp::synthFilterControls[i];knob.setName(control.name);knob.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);knob.setTextBoxStyle(juce::Slider::TextBoxBelow,false,66,17);knob.setMouseDragSensitivity(220);
        knob.setDoubleClickReturnValue(true,control.defaultValue);
        if(i==0) {knob.textFromValueFunction=[](double v){return juce::String(formatFrequencyHz(v));};knob.valueFromTextFunction=[](const juce::String& t){return t.getDoubleValue()*(t.containsIgnoreCase("kHz")?1000:1);};}
        knob.setRange(control.minimum,control.maximum,i==0?1:.001);if(i==0) knob.setSkewFactorFromMidPoint(1000);if(i==4) knob.setTooltip("Full keytracking doubles cutoff per octave above MIDI note 60");
        knob.getProperties().set("mct.origami.knobTrack",true);knob.getProperties().set("mct.origami.knobScale",.88);knob.setColour(juce::Slider::textBoxOutlineColourId,Palette::borderSoft());
        knob.onValueChange=[this]{if(!syncing_) editValues();};
        auto& label=labels_[i];addAndMakeVisible(label);label.setText(control.name,juce::dontSendNotification);label.setJustificationType(juce::Justification::centred);label.setFont(juce::FontOptions(Type::label));
    }
    syncFromModel();
}
bool FilterPanel::commit(ModulationState mod) {if(!bindings_.modulation || !bindings_.modulation(mod)) {output_.setTooltip("Routing rejected: cycle, invalid destination or conflicting shared input");return false;}syncFromModel();return true;}
SynthFilterId FilterPanel::addFilter() {if(!bindings_.snapshot) return 0;auto mod=bindings_.snapshot().modulation;const auto id=addSynthFilter(mod);if(!id) return 0;selectedId_=id;legacy_=false;return commit(mod)?id:0;}
bool FilterPanel::removeFilter(SynthFilterId id) {if(!bindings_.snapshot) return false;auto mod=bindings_.snapshot().modulation;return removeSynthFilter(mod,id) && commit(mod);}
bool FilterPanel::dropFilterOnOscillator(SynthFilterId f,OscillatorModuleId osc) {if(!bindings_.snapshot) return false;const auto state=bindings_.snapshot();auto mod=state.modulation;return insertSynthFilter(mod,state.oscillators,f,osc) && commit(mod);}
bool FilterPanel::dropFilterAfter(SynthFilterId f,SynthFilterId before) {if(!bindings_.snapshot) return false;auto mod=bindings_.snapshot().modulation;return insertSynthFilterAfter(mod,f,before) && commit(mod);}
void FilterPanel::syncFromModel() {
    if(bindings_.snapshot) state_=bindings_.snapshot();
    tabCount_=0;
    if(state_.modulation.filterEnabled) {tabIds_[tabCount_++]=0;tabs_[0].setButtonText("LEGACY LP");}
    for(const auto& f:state_.modulation.synthFilters.filters) if(f.id) {tabIds_[tabCount_]=f.id;tabs_[tabCount_++].setButtonText("FILTER "+juce::String(f.id));}
    if(synthFilterSlot(state_.modulation.synthFilters,selectedId_)==maxSynthFilters) {selectedId_=tabCount_?tabIds_[0]:0;legacy_=tabCount_ && selectedId_==0;}
    for(std::size_t i=0;i<tabs_.size();++i) {tabs_[i].setVisible(i<tabCount_);tabs_[i].setToggleState(i<tabCount_ && tabIds_[i]==selectedId_,juce::dontSendNotification);tabs_[i].onClick=[this,i]{selectedId_=tabIds_[i];legacy_=selectedId_==0;syncFromModel();};tabs_[i].setTooltip("Drag to an oscillator to insert; drop another filter here to insert AFTER");}
    const auto slot=synthFilterSlot(state_.modulation.synthFilters,selectedId_);
    const bool active=legacy_ || slot<maxSynthFilters;
    add_.setEnabled(state_.modulation.synthFilters.nextId<=maxSynthFilterId && std::any_of(state_.modulation.synthFilters.filters.begin(),state_.modulation.synthFilters.filters.end(),[](const auto& f){return !f.id;}));remove_.setEnabled(active);
    add_.setTooltip(add_.isEnabled()?"Add a per-voice Synth low-pass filter":state_.modulation.synthFilters.nextId>maxSynthFilterId?"Filter identity history exhausted":"All 8 Synth filter slots are in use");
    type_.setVisible(active);
    output_.setVisible(active && !legacy_);power_.setVisible(active && !legacy_);
    SynthFilterValues values;
    if(slot<maxSynthFilters) {const auto& f=state_.modulation.synthFilters.filters[slot];values=f.values;output_.setButtonText(f.next ? "FILTER "+juce::String(f.next) : (state_.buses.find(f.buses[0].bus)?juce::String(state_.buses.find(f.buses[0].bus)->label()):juce::String("BUS"))+(f.busCount>1?" +":""));output_.setTooltip(output_.getButtonText());output_.setButtonText(output_.getButtonText()+" ▾");power_.setButtonText(f.power?"ON":"OFF");power_.setToggleState(f.power,juce::dontSendNotification);}
    else if(legacy_ && getter_) {values.cutoff=getter_(ParameterId::Cutoff);values.resonance=getter_(ParameterId::Resonance);}
    const float v[]{values.cutoff,values.resonance,values.drive,values.mix,values.keytrack,values.gain};syncing_=true;
    for(std::size_t i=0;i<knobs_.size();++i) {knobs_[i].setVisible(active && (!legacy_ || i<2));labels_[i].setVisible(knobs_[i].isVisible());if(!knobs_[i].isMouseButtonDown()) knobs_[i].setValue(v[i],juce::dontSendNotification);if(i<5) knobs_[i].getProperties().set("mct.mod.destination",int(!selectedId_?(i==0?ModDestination::Cutoff:ModDestination::Resonance):static_cast<ModDestination>(401+i)));knobs_[i].getProperties().set("mct.mod.oscillator",0);knobs_[i].getProperties().set("mct.mod.itemId",int(selectedId_));}
    type_.setButtonText(juce::String(slot<maxSynthFilters?dsp::filterTypeInfo(state_.modulation.synthFilters.filters[slot].type)->name:dsp::filterTypeInfo(dsp::FilterType::LowPass)->name)+" ▾");type_.setEnabled(!legacy_ && active);labels_[0].setText(slot<maxSynthFilters?dsp::filterTypeInfo(state_.modulation.synthFilters.filters[slot].type)->frequencyLabel:"CUTOFF",juce::dontSendNotification);
    const bool gain=slot<maxSynthFilters && dsp::filterTypeInfo(state_.modulation.synthFilters.filters[slot].type)->gain;knobs_[5].setVisible(gain);labels_[5].setVisible(gain);
    syncing_=false;resized();repaint();
}
void FilterPanel::editValues() {
    if(!selectedId_) {if(setter_) {setter_(ParameterId::Cutoff,float(knobs_[0].getValue()));setter_(ParameterId::Resonance,float(knobs_[1].getValue()));}repaint();return;}
    auto mod=bindings_.snapshot?bindings_.snapshot().modulation:state_.modulation;const auto slot=synthFilterSlot(mod.synthFilters,selectedId_);if(slot==maxSynthFilters) return;
    mod.synthFilters.filters[slot].values={float(knobs_[0].getValue()),float(knobs_[1].getValue()),float(knobs_[2].getValue()),float(knobs_[3].getValue()),float(knobs_[4].getValue()),float(knobs_[5].getValue())};commit(mod);
}
std::vector<juce::String> FilterPanel::typeChoices() const {std::vector<juce::String> out;for(const auto& info:dsp::filterTypes) out.push_back(info.name);return out;}
bool FilterPanel::setFilterType(dsp::FilterType type) {if(!bindings_.snapshot || !dsp::synthFilterTypeSupported(type)) return false;auto mod=bindings_.snapshot().modulation;const auto slot=synthFilterSlot(mod.synthFilters,selectedId_);if(slot==maxSynthFilters) return false;mod.synthFilters.filters[slot].type=type;return commit(mod);}
SynthFilterValues FilterPanel::responseValues(const RuntimeVisualizationSnapshot& visual) const {
    SynthFilterValues values;const auto slot=synthFilterSlot(state_.modulation.synthFilters,selectedId_);
    if(slot<maxSynthFilters) values=state_.modulation.synthFilters.filters[slot].values;
    else if(getter_) {values.cutoff=getter_(ParameterId::Cutoff);values.resonance=getter_(ParameterId::Resonance);}
    if(slot<maxSynthFilters && visual.synthFilterIds[slot]==selectedId_) values=visual.synthFilters[slot];
    else if(slot<maxSynthFilters && !state_.modulation.synthFilters.filters[slot].power) values.mix=0;
    return values;
}
juce::Point<float> FilterPanel::responseHandle() const {
    const auto plot=editorRegions().plot.toFloat();const auto visual=bindings_.visualization?bindings_.visualization():RuntimeVisualizationSnapshot{};
    const auto values=responseValues(visual);const double rate=visual.sampleRate>0?visual.sampleRate:48000;
    if(rate!=responseRate_) {responseTable_.prepare(rate);responseRate_=rate;}
    const auto slot=synthFilterSlot(state_.modulation.synthFilters,selectedId_);const auto type=slot<maxSynthFilters?state_.modulation.synthFilters.filters[slot].type:dsp::FilterType::LowPass;
    const dsp::FilterResponseAxis axis{rate,dsp::filterTypeInfo(type)->gain?36.:18.};
    const auto c=dsp::filterDesign(type,responseTable_.make(values.cutoff,values.resonance),values.gain);const double hz=std::min({double(values.cutoff),20000.,rate*.45});
    return {plot.getX()+float(axis.x(hz))*plot.getWidth(),plot.getY()+float(axis.y(dsp::filterMagnitude(c,hz,rate,values.mix)))*plot.getHeight()};
}
bool FilterPanel::editResponseParameters(juce::Point<float> point,float resonance) {
    const auto plot=editorRegions().plot.toFloat();if(plot.isEmpty()) return false;
    const auto visual=bindings_.visualization?bindings_.visualization():RuntimeVisualizationSnapshot{};const dsp::FilterResponseAxis axis{visual.sampleRate>0?visual.sampleRate:48000};
    const auto cutoff=axis.frequency((point.x-plot.getX())/plot.getWidth());
    {const juce::ScopedValueSetter<bool> guard(syncing_,true);knobs_[0].setValue(juce::jlimit(20.,20000.,cutoff),juce::dontSendNotification);knobs_[1].setValue(juce::jlimit(0.f,1.f,resonance),juce::dontSendNotification);}editValues();return true;
}
bool FilterPanel::editResponseHandle(juce::Point<float> point) {
    const auto plot=editorRegions().plot.toFloat();if(plot.isEmpty()) return false;
    return editResponseParameters(point,float(knobs_[1].getValue())+(responseHandle().y-point.y)/plot.getHeight());
}
void FilterPanel::showOutputMenu() {
    const auto slot=synthFilterSlot(state_.modulation.synthFilters,selectedId_);if(slot==maxSynthFilters) return;
    std::vector<NativeChoiceItem> items;for(std::size_t b=0;b<state_.buses.count;++b) items.push_back({int(b+1),juce::String(state_.buses.buses[b].label()),true,"BUSES"});
    for(std::size_t f=0;f<maxSynthFilters;++f) if(state_.modulation.synthFilters.filters[f].id) {auto probe=state_.modulation;probe.synthFilters.filters[slot].next=probe.synthFilters.filters[f].id;const bool valid=validSynthFilters(probe.synthFilters,state_.oscillators);items.push_back({int(100+f),"FILTER "+juce::String(probe.synthFilters.filters[f].id),valid,"SERIAL FILTER",false,valid?juce::String():juce::String("Would create a cycle"),{}});}
    showNativeChoiceMenu(output_,"Filter output",items,0,[safe=juce::Component::SafePointer<FilterPanel>(this),slot](int choice){if(!safe) return;auto mod=safe->bindings_.snapshot().modulation;auto& f=mod.synthFilters.filters[slot];if(choice>=100) f.next=mod.synthFilters.filters[std::size_t(choice-100)].id;else {f.next=0;f.busCount=1;f.buses[0]={safe->state_.buses.buses[std::size_t(choice-1)].id,1};}safe->commit(mod);});
}
FilterPanel::EditorRegions FilterPanel::editorRegions() const noexcept {
    const auto layout=sourceRailLayout(contentBounds());auto body=layout.editor.reduced(EditorMetrics::inset,0);EditorRegions r;
    r.header={body.getX(),layout.header.getCentreY()-EditorMetrics::selectorHeight/2,body.getWidth(),EditorMetrics::selectorHeight};
    body.setY(r.header.getBottom()+EditorMetrics::gap);body.setBottom(layout.editor.getBottom()-EditorMetrics::bottom);
    const int parameterHeight=juce::jmin(EditorMetrics::parameterHeight,body.getHeight()/2);
    r.parameters=body.removeFromBottom(parameterHeight);body.removeFromBottom(EditorMetrics::bottom);r.response=body;
    auto inner=r.response.reduced(EditorMetrics::gap,EditorMetrics::plotInset);r.levelAxis=inner.removeFromLeft(EditorMetrics::levelWidth);
    r.frequencyAxis=inner.removeFromBottom(EditorMetrics::axisHeight);r.plot=inner;r.levelAxis.setHeight(inner.getHeight());
    const int count=knobs_[5].isVisible()?6:5,bankWidth=juce::jmin(r.parameters.getWidth(),juce::jmax(count*EditorMetrics::minCellWidth,juce::roundToInt(r.parameters.getWidth()*EditorMetrics::bankFraction)));
    r.parameterBank=r.parameters.withSizeKeepingCentre(bankWidth,juce::jmin(EditorMetrics::stackHeight,r.parameters.getHeight()));
    r.typeLabel=r.header.withWidth(EditorMetrics::typeLabelWidth);auto right=r.header.withTrimmedRight(EditorMetrics::powerWidth+EditorMetrics::gap);
    r.outputLabel=right.withWidth(EditorMetrics::outLabelWidth).withX(right.getRight()-EditorMetrics::outWidth-EditorMetrics::outLabelWidth-EditorMetrics::inset);
    return r;
}
void FilterPanel::resized() {
    const auto layout=sourceRailLayout(contentBounds());
    remove_.setBounds(layout.remove);add_.setBounds(layout.add);viewport_.setBounds(layout.list);
    const int width=juce::jmax(1,layout.list.getWidth());
    for(std::size_t i=0;i<tabCount_;++i) tabs_[i].setBounds(0,sourceListTopGap+int(i)*SourceEntityButton::baseHeight,width,SourceEntityButton::baseHeight-sourceRowGap);
    railContent_.setSize(width,juce::jmax(layout.list.getHeight(),sourceListTopGap+int(tabCount_)*SourceEntityButton::baseHeight));
    const juce::Point<int> viewportSize{viewport_.getWidth(),viewport_.getHeight()};
    if(revealedId_!=selectedId_ || revealedViewportSize_!=viewportSize) for(std::size_t i=0;i<tabCount_;++i) if(tabIds_[i]==selectedId_) {
        const int top=tabs_[i].getY(),bottom=tabs_[i].getBottom(),view=viewport_.getViewPositionY();
        if(top<view) viewport_.setViewPosition(0,top);
        else if(bottom>view+viewport_.getHeight()) viewport_.setViewPosition(0,bottom-viewport_.getHeight());
    }
    revealedId_=selectedId_;revealedViewportSize_=viewportSize;
    const auto regions=editorRegions();
    type_.setBounds(regions.header.withX(regions.typeLabel.getRight()).withWidth(EditorMetrics::typeWidth));
    power_.setBounds(regions.header.withX(regions.header.getRight()-EditorMetrics::powerWidth).withWidth(EditorMetrics::powerWidth));
    output_.setBounds(regions.header.withX(regions.outputLabel.getRight()+EditorMetrics::inset).withWidth(EditorMetrics::outWidth));
    auto controls=regions.parameterBank;const int count=knobs_[5].isVisible()?6:5,cellWidth=controls.getWidth()/count;
    for(std::size_t i=0;i<knobs_.size();++i) {if(!knobs_[i].isVisible()) {knobs_[i].setBounds({});labels_[i].setBounds({});continue;}
        auto cell=controls.removeFromLeft(cellWidth);labels_[i].setBounds(cell.removeFromBottom(EditorMetrics::labelHeight));cell.removeFromBottom(EditorMetrics::stackGap);
        knobs_[i].setBounds(cell.reduced(2,0));knobs_[i].setTextBoxStyle(juce::Slider::TextBoxBelow,false,juce::jmin(EditorMetrics::valueWidth,cellWidth-4),EditorMetrics::valueHeight);
    }
}
void FilterPanel::paintContent(juce::Graphics& g,juce::Rectangle<int> body) {
    const auto layout=sourceRailLayout(body);paintSourceRail(g,layout);body=layout.editor;
    if(!tabCount_) {text(g,"NO SYNTH FILTERS — + TO ADD",body,Type::label,Palette::muted(),juce::Justification::centred);return;}
    const auto regions=editorRegions();
    text(g,"TYPE",regions.typeLabel,Type::secondary,Palette::secondary());text(g,"OUT",regions.outputLabel,Type::secondary,Palette::secondary());
    g.setColour(Palette::borderSoft());g.drawHorizontalLine(regions.parameters.getY(),float(regions.parameters.getX()),float(regions.parameters.getRight()));
    body=regions.response;well(g,body);const auto plot=regions.plot.toFloat();
    const auto visual=bindings_.visualization?bindings_.visualization():RuntimeVisualizationSnapshot{};const auto values=responseValues(visual);
    const auto slot=synthFilterSlot(state_.modulation.synthFilters,selectedId_);
    const double rate=visual.sampleRate>0?visual.sampleRate:48000;if(rate!=responseRate_) {responseTable_.prepare(rate);responseRate_=rate;}
    const auto type=slot<maxSynthFilters?state_.modulation.synthFilters.filters[slot].type:dsp::FilterType::LowPass;const auto c=dsp::filterDesign(type,responseTable_.make(values.cutoff,values.resonance),values.gain);
    const dsp::FilterResponseAxis axis{rate,dsp::filterTypeInfo(type)->gain?36.:18.};
    g.setColour(Palette::borderSoft().withAlpha(.50f));
    for(double hz:{100.,1000.,10000.}) if(hz<axis.maximum()) {
        const int x=juce::roundToInt(plot.getX()+float(axis.x(hz))*plot.getWidth());g.drawVerticalLine(x,plot.getY(),plot.getBottom());
        text(g,juce::String(hz<1000?"100":hz<10000?"1k":"10k"),{x-16,regions.frequencyAxis.getY(),32,EditorMetrics::axisHeight},Type::secondary,Palette::muted(),juce::Justification::centred);
    }
    for(double db:{axis.topDb,0.,-24.,dsp::FilterResponseAxis::bottomDb}) {
        const float y=plot.getY()+float(axis.y(std::pow(10.,db/20)))*plot.getHeight();g.setColour(Palette::borderSoft().withAlpha(db==0?.6f:.3f));g.drawHorizontalLine(juce::roundToInt(y),plot.getX(),plot.getRight());
        auto label=regions.levelAxis.withHeight(12).withY(juce::jlimit(regions.levelAxis.getY(),regions.levelAxis.getBottom()-12,juce::roundToInt(y)-6));
        text(g,db==0?juce::String("0 dB"):(db>0?"+":"")+juce::String(int(db)),label,Type::secondary,db==0?Palette::secondary():Palette::muted(),juce::Justification::centredLeft);
    }
    const auto handle=responseHandle();juce::Path curve;bool inserted=false;
    for(int i=0;i<256;++i) {
        const float t=float(i)/255,x=plot.getX()+t*plot.getWidth();const double magnitude=dsp::filterMagnitude(c,axis.frequency(t),rate,values.mix);const float y=plot.getY()+float(axis.y(magnitude))*plot.getHeight();
        if(!i) curve.startNewSubPath(x,y);
        else {if(!inserted && x>=handle.x) {curve.lineTo(handle);inserted=true;}curve.lineTo(x,y);}
    }
    juce::Path fill=curve;fill.lineTo(plot.getRight(),plot.getBottom());fill.lineTo(plot.getX(),plot.getBottom());fill.closeSubPath();
    g.setColour(signalSurfaceColour(EditorMetrics::fillExposure,EditorMetrics::fillAlpha));g.fillPath(fill);
    g.setColour(Palette::text());g.strokePath(curve,juce::PathStrokeType(1.3f));
    const float size=handleHovered_ || handleDragging_?8.f:7.f;const auto circle=juce::Rectangle<float>(size,size).withCentre(handle);
    g.setColour(Palette::inset());g.fillEllipse(circle);g.setColour(handleHovered_ || handleDragging_?signalSourceColour():Palette::text());g.drawEllipse(circle,1.2f);

}
void FilterPanel::paintOverChildren(juce::Graphics& g) {
    if(dropOver_) {g.setColour(signalSourceColour());g.drawRect(contentBounds().reduced(2),2);text(g,"DROP FILTER: INSERT AFTER / DROP OSC: EXCLUSIVE ROUTE",contentBounds().removeFromBottom(22),Type::secondary,Palette::text(),juce::Justification::centred);}
    const auto& telemetry=modulationUiTelemetry();


    const auto drawRing=[&](juce::Slider& slider,ModDestination destination,std::uint32_t item) {
        const float selectedDepth=modulationUiSelectedRouteAmount(destination,0,item);
        const float depth=std::abs(selectedDepth)>=1.0e-4f ? selectedDepth
            : modulationUiPersistentRouteAmount(destination,0,item);
        const bool anyRoute=modulationUiHasAnyRoute(destination,0,item);
        if(std::abs(depth)<1.0e-4f && !anyRoute) return;

        const double min=slider.getMinimum(),max=slider.getMaximum();
        if(max<=min) return;
        const bool logarithmic=(destination==ModDestination::Cutoff || destination==ModDestination::SynthCutoff) && min>0;
        const float base=static_cast<float>(logarithmic ? std::log(slider.getValue()/min)/std::log(max/min) : (slider.getValue()-min)/(max-min));
        const bool bipolar=std::abs(selectedDepth)>=1.0e-4f
            ? modulationUiSelectedRouteIsBipolar(destination,0,item)
            : modulationUiPersistentRoutesAreBipolar(destination,0,item);
        const float extent=std::abs(depth);
        const float lo=juce::jlimit(0.0f,1.0f,bipolar?base-extent:juce::jmin(base,base+depth));
        const float hi=juce::jlimit(0.0f,1.0f,bipolar?base+extent:juce::jmax(base,base+depth));
        const float current=modulationUiEffectiveSliderPosition(slider,destination,0,item);

        auto circle=slider.getBounds().toFloat().reduced(1.0f).expanded(2.0f);
        const float d=juce::jmin(circle.getWidth(),circle.getHeight());
        circle=juce::Rectangle<float>(d,d).withCentre(circle.getCentre());
        const float start=juce::MathConstants<float>::pi*1.20f;
        const float end=juce::MathConstants<float>::pi*2.80f;
        const auto angle=[&](float n){const double v=logarithmic?min*std::pow(max/min,n):min+n*(max-min);return start+float(slider.valueToProportionOfLength(v))*(end-start);};

        if(std::abs(depth)>=1.0e-4f) {
            juce::Path range;
            range.addCentredArc(circle.getCentreX(),circle.getCentreY(),
                                circle.getWidth()*.51f,circle.getHeight()*.51f,0.0f,
                                angle(lo),angle(hi),true);
            g.setColour(signalSourceColour().withAlpha(.96f));
            g.strokePath(range,juce::PathStrokeType(2.2f));
        } else {
            juce::Path automated;
            automated.addCentredArc(circle.getCentreX(),circle.getCentreY(),
                                    circle.getWidth()*.51f,circle.getHeight()*.51f,0.0f,
                                    start,end,true);
            g.setColour(signalSourceColour().darker(.72f).withAlpha(.88f));
            g.strokePath(automated,juce::PathStrokeType(1.7f));
        }
        if(anyRoute && telemetry.synthActive) {
            const float a=start+current*(end-start);
            const auto c=circle.getCentre();
            const auto p=juce::Point<float>(
                c.x+std::sin(a)*circle.getWidth()*.51f,
                c.y-std::cos(a)*circle.getHeight()*.51f);
            g.setColour(signalSourceColour());
            g.fillEllipse(juce::Rectangle<float>(5.0f,5.0f).withCentre(p));
        }
    };

    if(!selectedId_) {drawRing(knobs_[0],ModDestination::Cutoff,0);drawRing(knobs_[1],ModDestination::Resonance,0);}
    else for(std::size_t i=0;i<5;++i) drawRing(knobs_[i],static_cast<ModDestination>(401+i),selectedId_);
}

void FilterPanel::mouseDown(const juce::MouseEvent& e) {dragStarted_=false;handleDragging_=e.eventComponent==this && editorRegions().plot.contains(e.getPosition());if(handleDragging_) {handleDragStart_=e.position;handleDragResonance_=float(knobs_[1].getValue());editResponseParameters(e.position,handleDragResonance_);repaint();}}
void FilterPanel::mouseUp(const juce::MouseEvent&) {handleDragging_=false;repaint();}
void FilterPanel::mouseMove(const juce::MouseEvent& e) {const bool hover=e.position.getDistanceFrom(responseHandle())<9; if(hover!=handleHovered_) {handleHovered_=hover;setMouseCursor(hover?juce::MouseCursor::PointingHandCursor:juce::MouseCursor::NormalCursor);repaint();}}
void FilterPanel::mouseExit(const juce::MouseEvent&) {handleHovered_=false;setMouseCursor(juce::MouseCursor::NormalCursor);repaint();}
void FilterPanel::mouseDrag(const juce::MouseEvent& e) {if(handleDragging_) {editResponseParameters(e.position,handleDragResonance_-(e.position.y-handleDragStart_.y)/float(editorRegions().plot.getHeight()));return;}if(dragStarted_ || e.getDistanceFromDragStart()<7) return;for(std::size_t i=0;i<tabCount_;++i) if(e.eventComponent==&tabs_[i]) {if(auto* container=juce::DragAndDropContainer::findParentDragContainerFor(this)) {dragStarted_=true;container->startDragging("MCT_SYNTH_FILTER:"+juce::String(tabIds_[i]),&tabs_[i]);}return;}}
bool FilterPanel::isInterestedInDragSource(const SourceDetails& d) {const auto text=d.description.toString();return !legacy_ && selectedId_ && (text.startsWith("MCT_SYNTH_OSC:") || text.startsWith("MCT_SYNTH_FILTER:"));}
void FilterPanel::itemDragEnter(const SourceDetails&) {dropOver_=true;repaint();}
void FilterPanel::itemDragExit(const SourceDetails&) {dropOver_=false;repaint();}
void FilterPanel::itemDropped(const SourceDetails& d) {dropOver_=false;const auto text=d.description.toString();const auto id=std::uint32_t(text.fromFirstOccurrenceOf(":",false,false).getIntValue());SynthFilterId target=selectedId_;const auto point=d.localPosition;for(std::size_t i=0;i<tabCount_;++i) if(tabs_[i].isVisible() && tabs_[i].getLocalBounds().contains(tabs_[i].getLocalPoint(this,point))) target=tabIds_[i];if(text.startsWith("MCT_SYNTH_OSC:")) dropFilterOnOscillator(target,id);else dropFilterAfter(id,target);repaint();}

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
            if(label!="+")text(g,label,slot.removeFromBottom(33),Type::secondary,Palette::muted(),juce::Justification::centred);
        }
    }
}
}
