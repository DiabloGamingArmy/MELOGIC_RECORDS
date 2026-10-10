// mct-origami-lfo-editor-controls
#include "LfoControlStrip.h"
#include "ModulationUiTelemetry.h"
#include "OrigamiStyle.h"
#include <cmath>

namespace mct::origami::ui {
namespace {
constexpr float rateMinHz=.01f,rateMaxHz=40.0f;
// SECONDS knob: the same canonical range expressed as a period.
constexpr double periodMinSeconds=1.0/rateMaxHz,periodMaxSeconds=1.0/rateMinHz;
// Shared geometry (design units == px at the 1440 x 900 default editor).
// mct-origami-lfo-editor-polish: controls fill their groups. Groups are 58
// tall in a 62-tall strip with 4-5 px padding, 4 px between groups; the
// complete TOOLS row is exactly the 636-unit strip, so it is one row at
// every editor size (the editor scales uniformly). Narrower hosts scroll,
// the bar in its own gutter; controls are never shrunk to fit.
constexpr int groupHeight=58,groupGap=4,maxGroupGap=8,pageWidth=64,scrollThickness=6;
constexpr int padX=5,padY=4;
constexpr int iconCell=38,unitWidth=60,knobWidth=44,fieldWidth=72;
constexpr int gridIconWidth=24,gridFieldWidth=36,directionWidth=36;
constexpr int funcCell=60;
constexpr int timeWidth=padX+unitWidth+4+knobWidth+4+fieldWidth+padX;
constexpr int behaviourDivider=6;
constexpr int behaviourWidth=4+3*iconCell+behaviourDivider+2*iconCell+4;
constexpr int gridWidth=padX+gridIconWidth+3+gridFieldWidth+4+iconCell+4;
constexpr int directionGroupWidth=4+directionWidth+4;

void styleKnob(juce::Slider& s,const juce::String& name) {
    s.setName(name);
    s.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    s.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    s.setRotaryParameters(juce::MathConstants<float>::pi*1.2f,juce::MathConstants<float>::pi*2.8f,true);
    s.setMouseDragSensitivity(220);
    s.setScrollWheelEnabled(false);
}
void styleCaption(juce::Label& l,const juce::String& text) {
    l.setText(text,juce::dontSendNotification);
    l.setJustificationType(juce::Justification::centred);
    l.setFont(juce::FontOptions(Type::label));
    l.setBorderSize({});
    l.setColour(juce::Label::textColourId,Palette::text().withAlpha(.82f));
    l.setInterceptsMouseClicks(false,false);
}
}

// ---- StackSelector ----------------------------------------------------------
StackSelector::StackSelector(juce::StringArray options) : options_(std::move(options)) {
    setRepaintsOnMouseActivity(true);
}
void StackSelector::setSelected(int index,juce::NotificationType n) {
    index=juce::jlimit(0,juce::jmax(0,options_.size()-1),index);
    if(index==selected_) return;
    selected_=index; repaint();
    if(n!=juce::dontSendNotification && onChange) onChange(selected_);
}
juce::Rectangle<int> StackSelector::optionBounds(int index) const noexcept {
    const auto b=getLocalBounds().reduced(1);
    const int n=juce::jmax(1,options_.size());
    const int top=b.getY()+b.getHeight()*index/n,bottom=b.getY()+b.getHeight()*(index+1)/n;
    return {b.getX(),top,b.getWidth(),bottom-top};
}
int StackSelector::indexAt(juce::Point<int> p) const noexcept {
    for(int i=0;i<options_.size();++i) if(optionBounds(i).contains(p)) return i;
    return -1;
}
void StackSelector::paint(juce::Graphics& g) {
    const auto box=getLocalBounds().toFloat().reduced(.5f);
    g.setColour(Palette::inset()); g.fillRoundedRectangle(box,2.0f);
    g.setColour(Palette::borderSoft()); g.drawRoundedRectangle(box,2.0f,1.0f);
    const float size=juce::jlimit(Type::secondary,11.5f,static_cast<float>(optionBounds(0).getHeight())*.62f);
    for(int i=0;i<options_.size();++i) {
        const auto r=optionBounds(i);
        const bool on=i==selected_;
        if(on && !accentText_) {
            // Restrained: a dark red wash and a thin red edge, white text.
            g.setColour(signalShade(.30f,.32f)); g.fillRect(r.reduced(1,1));
            g.setColour(signalSourceColour()); g.fillRect(r.getX()+1,r.getY()+3,2,r.getHeight()-6);
        } else if(i==hover_) {
            g.setColour(Palette::raised().brighter(.06f)); g.fillRect(r.reduced(1,1));
        }
        const auto colour=on ? (accentText_ ? signalSourceColour() : Palette::text())
                             : (i==hover_ ? Palette::text() : Palette::muted());
        g.setColour(colour);
        g.setFont(juce::FontOptions(size).withStyle(on ? "Bold" : "Regular"));
        g.drawText(options_[i],r,juce::Justification::centred,false);
    }
}
void StackSelector::mouseMove(const juce::MouseEvent& e) { const int h=indexAt(e.getPosition()); if(h!=hover_) { hover_=h; repaint(); } }
void StackSelector::mouseExit(const juce::MouseEvent&) { hover_=-1; repaint(); }
void StackSelector::mouseDown(const juce::MouseEvent& e) {
    const int i=indexAt(e.getPosition());
    if(i>=0) setSelected(i,juce::sendNotificationSync);
}

// ---- StepField --------------------------------------------------------------
StepField::StepField(const juce::String& name,int minimum,int maximum,int value)
    : minimum_(minimum),maximum_(maximum),value_(juce::jlimit(minimum,maximum,value)) {
    setName(name);
    setEditable(false,true,false);
    setJustificationType(juce::Justification::centred);
    setFont(juce::FontOptions(12.0f));
    setColour(juce::Label::textColourId,Palette::text());
    setColour(juce::Label::textWhenEditingColourId,Palette::text());
    setColour(juce::Label::backgroundWhenEditingColourId,Palette::inset());
    setColour(juce::Label::outlineWhenEditingColourId,Palette::borderStrong());
    setText(juce::String(value_),juce::dontSendNotification);
    setRepaintsOnMouseActivity(true);
    setMouseCursor(juce::MouseCursor::UpDownResizeCursor);
}
bool StepField::setValue(int v,juce::NotificationType n) {
    v=juce::jlimit(minimum_,maximum_,v);
    setText(juce::String(v),juce::dontSendNotification);
    if(v==value_) return false;
    value_=v; repaint();
    if(n!=juce::dontSendNotification && onValueChange) onValueChange(value_);
    return true;
}
void StepField::paint(juce::Graphics& g) {
    if(isBeingEdited()) return;
    const auto box=getLocalBounds().toFloat().reduced(.5f);
    g.setColour(Palette::inset()); g.fillRoundedRectangle(box,2.0f);
    g.setColour(isMouseOverOrDragging() ? Palette::borderStrong() : Palette::borderSoft());
    g.drawRoundedRectangle(box,2.0f,1.0f);
    g.setColour(isEnabled() ? Palette::text() : Palette::muted());
    g.setFont(getFont());
    g.drawText(juce::String(value_),getLocalBounds(),juce::Justification::centred,false);
}
void StepField::mouseDown(const juce::MouseEvent& e) { dragStart_=value_; juce::Label::mouseDown(e); }
void StepField::mouseDrag(const juce::MouseEvent& e) {
    // 6 px per step; up = larger.
    setValue(dragStart_-e.getDistanceFromDragStartY()/6,juce::sendNotificationSync);
}
void StepField::mouseWheelMove(const juce::MouseEvent&,const juce::MouseWheelDetails& w) {
    wheel_+=w.deltaY*(w.isReversed?-1.0f:1.0f)*8.0f;
    const int steps=static_cast<int>(wheel_);
    if(steps!=0) { wheel_-=static_cast<float>(steps); setValue(value_+steps,juce::sendNotificationSync); }
}
void StepField::textWasEdited() {
    const auto t=getText().trim();
    if(t.containsOnly("0123456789") && t.isNotEmpty()) setValue(t.getIntValue(),juce::sendNotificationSync);
    setText(juce::String(value_),juce::dontSendNotification);
}

// ---- LfoControlStrip --------------------------------------------------------
const std::array<LfoControlStrip::Division,21>& LfoControlStrip::divisions() noexcept {
    // Slowest -> fastest. wholeNotes = cycle length in whole notes (4 beats).
    static const std::array<Division,21> table{{
        {"16/1",16.0},{"8/1",8.0},{"4/1",4.0},{"2/1",2.0},{"1/1",1.0},
        {"1/2D",.75},{"1/2",.5},{"1/2T",1.0/3.0},{"1/4D",.375},{"1/4",.25},{"1/4T",1.0/6.0},
        {"1/8D",.1875},{"1/8",.125},{"1/8T",1.0/12.0},{"1/16D",.09375},{"1/16",.0625},{"1/16T",1.0/24.0},
        {"1/32",1.0/32.0},{"1/32T",1.0/48.0},{"1/64",1.0/64.0},{"1/64T",1.0/96.0}}};
    return table;
}
double LfoControlStrip::divisionHz(const Division& d,double bpm) noexcept {
    return bpm/60.0/(d.wholeNotes*4.0);
}

juce::String LfoControlStrip::formatRate(float hz,RateUnit unit,double bpm) {
    if(!std::isfinite(hz) || hz<=0.0f) return "-";
    if(unit==RateUnit::Hz) return juce::String(hz,hz<10.0f?2:1)+" Hz";
    if(unit==RateUnit::Seconds) {
        const double s=1.0/hz;
        return juce::String(s,s<1.0?3:(s<10.0?2:1))+" s";
    }
    // BEATS: the nearest musical division at the current tempo; "~" marks a
    // rate that is not exactly on a division (e.g. set in Hz).
    const auto& table=divisions();
    std::size_t best=0; double bestError=1.0e9;
    for(std::size_t i=0;i<table.size();++i) {
        const double e=std::abs(std::log(divisionHz(table[i],bpm)/double(hz)));
        if(e<bestError) { bestError=e; best=i; }
    }
    return (bestError<.005 ? juce::String() : juce::String("~"))+table[best].name;
}

std::optional<float> LfoControlStrip::parseRate(const juce::String& raw,RateUnit unit,double bpm) {
    auto t=raw.trim().toLowerCase().removeCharacters(" ~");
    if(t.isEmpty()) return std::nullopt;
    double hz=0.0;
    if(unit==RateUnit::Beats) {
        bool found=false;
        for(const auto& d:divisions()) if(t==juce::String(d.name).toLowerCase()) { hz=divisionHz(d,bpm); found=true; break; }
        if(!found) return std::nullopt;
    } else {
        const bool ms=t.endsWith("ms");
        t=t.trimCharactersAtEnd("hzms");
        if(!t.containsOnly("0123456789.") || t.isEmpty()) return std::nullopt;
        const double v=t.getDoubleValue();
        if(!(v>0.0)) return std::nullopt;
        hz=unit==RateUnit::Hz ? v : 1.0/(ms ? v/1000.0 : v);
    }
    if(!std::isfinite(hz) || hz<rateMinHz-1.0e-6 || hz>rateMaxHz+1.0e-6) return std::nullopt;
    return static_cast<float>(juce::jlimit(double(rateMinHz),double(rateMaxHz),hz));
}

const std::array<LfoControlStrip::FuncInfo,LfoControlStrip::funcCount>& LfoControlStrip::funcInfo() noexcept {
    // Each implemented knob edits one canonical LfoSettings field. STEREO has
    // no field: LFO values are one number per voice, so there is no left /
    // right modulation for a destination to receive yet.
    constexpr double maxT=LfoSettings::maxTimeSeconds;
    static const std::array<FuncInfo,funcCount> table{{
        {"SMOOTH","Smooth: slews the LFO output, rounding steps and sharp corners",true,&LfoSettings::smooth,0,1,0,.25},
        {"ATTACK","Attack: fades the modulation depth in after the delay",true,&LfoSettings::attackSeconds,0,maxT,0,1},
        {"DELAY","Delay: holds the LFO at zero before it starts (per note; FREE: after the engine starts)",true,&LfoSettings::delaySeconds,0,maxT,0,1},
        {"PHASE","Phase: offsets where the LFO reads its curve",true,&LfoSettings::phase,0,1,0,.5},
        {"STEREO","Stereo: offsets the RIGHT channel's LFO phase from LEFT (up to 180 deg). Moves LEVEL, CUTOFF and RESONANCE per channel; other destinations follow LEFT",true,&LfoSettings::stereo,0,1,0,.5},
        {"SKEW","Skew: warps time inside each cycle (slow rise / fast fall, or the reverse) without changing the levels",true,&LfoSettings::skew,-1,1,0,0},
        {"QUANTIZE","Quantize: steps the LFO output into a fixed number of levels",true,&LfoSettings::quantize,0,1,0,.5},
        {"ENTROPY","Entropy: slow, organic drift in timing and depth, different on every cycle",true,&LfoSettings::entropy,0,1,0,.5},
        {"FRACTURE","Fracture: breaks each cycle into repeated, mirrored and folded fragments",true,&LfoSettings::fracture,0,1,0,.5}}};
    return table;
}

juce::String LfoControlStrip::funcValueText(std::size_t index,double v) {
    const auto& info=funcInfo()[index];
    if(info.field==&LfoSettings::attackSeconds || info.field==&LfoSettings::delaySeconds)
        return v<=0.0 ? juce::String("OFF") : v<1.0 ? juce::String(juce::roundToInt(v*1000.0))+" ms" : juce::String(v,2)+" s";
    if(info.field==&LfoSettings::phase) return juce::String(juce::roundToInt(v*360.0))+juce::String(juce::CharPointer_UTF8("\xc2\xb0"));
    // STEREO shows the L / R phase separation it produces (0..180 deg).
    if(info.field==&LfoSettings::stereo) return juce::String(juce::roundToInt(v*180.0))+juce::String(juce::CharPointer_UTF8("\xc2\xb0"));
    if(info.field==&LfoSettings::skew) { const int pct=juce::roundToInt(v*100.0); return (pct>0 ? "+" : "")+juce::String(pct)+"%"; }
    if(info.field==&LfoSettings::quantize) { const int levels=Lfo::quantizeLevels(static_cast<float>(v)); return levels==0 ? juce::String("OFF") : juce::String(levels)+" LEVELS"; }
    return juce::String(juce::roundToInt(v*100.0))+"%";
}

int LfoControlStrip::minimumToolsWidth() noexcept {
    return timeWidth+behaviourWidth+gridWidth+directionGroupWidth+3*groupGap;
}
int LfoControlStrip::minimumFuncWidth() noexcept { return static_cast<int>(funcCount)*funcCell+8; }

LfoControlStrip::LfoControlStrip() {
    setName("LFO CONTROL STRIP");
    addAndMakeVisible(page_);
    page_.setName("LFO TOOLS FUNC");
    page_.setTooltip("TOOLS: rate, playback and grid  /  FUNC: function processing");
    page_.onChange=[this](int){ resized(); repaint(); };

    for(auto* v:{&toolsViewport_,&funcViewport_}) {
        addChildComponent(*v);
        v->setScrollBarsShown(false,true,false,true);
        v->setScrollBarThickness(scrollThickness);
    }
    toolsViewport_.setViewedComponent(&tools_,false);
    funcViewport_.setViewedComponent(&funcBank_,false);

    // ---- time / rate ----
    tools_.addAndMakeVisible(unit_);
    unit_.setName("LFO RATE UNIT");
    unit_.setAccentText(true);
    unit_.setSelected(static_cast<int>(RateUnit::Hz));
    unit_.setTooltip("Rate display and knob units. One rate: switching units never changes the sound");
    unit_.onChange=[this](int){ configureRateKnob(); refreshRateField(); };
    styleKnob(rate_,"LFO RATE");
    tools_.addAndMakeVisible(rate_);
    rate_.onValueChange=[this]{ rateKnobMoved(); };
    rate_.setTooltip("LFO rate");
    styleCaption(rateLabel_,"RATE");
    tools_.addAndMakeVisible(rateLabel_);
    tools_.addAndMakeVisible(rateField_);
    rateField_.setName("LFO RATE VALUE");
    rateField_.setEditable(false,true,false);
    rateField_.setJustificationType(juce::Justification::centred);
    rateField_.setFont(juce::FontOptions(12.5f));
    rateField_.setColour(juce::Label::textColourId,Palette::text());
    rateField_.setColour(juce::Label::backgroundColourId,Palette::inset());
    rateField_.setColour(juce::Label::outlineColourId,Palette::borderSoft());
    rateField_.setColour(juce::Label::backgroundWhenEditingColourId,Palette::inset());
    rateField_.setColour(juce::Label::textWhenEditingColourId,Palette::text());
    rateField_.setTooltip("Double-click to type a rate (Hz, seconds, or a division such as 1/4, 1/8T, 1/4D)");
    rateField_.onTextChange=[this]{ commitRateText(); };

    // ---- behaviour ----
    const auto mode=[this](LfoMode m){ return [this,m]{ if(callbacks_.mode && lfo_.mode!=m) callbacks_.mode(m); }; };
    retrigger_.onClick=mode(LfoMode::Loop);
    envelope_.onClick=mode(LfoMode::Envelope);
    free_.onClick=mode(LfoMode::Free);
    retrigger_.setTooltip("Retrigger LFO: restarts on every note, then loops (per voice)");
    envelope_.setTooltip("Envelope / One-Shot LFO: restarts on every note, plays the path once and holds the end (per voice)");
    free_.setTooltip("Free-Running LFO: one shared LFO that never restarts");
    pingPong_.setTooltip("Ping-Pong: each cycle reads the curve forward then back (0 -> 1 -> 0)");
    pingPong_.onClick=[this]{ if(callbacks_.pingPong) callbacks_.pingPong(!lfo_.pingPong); };
    customPath_.setTooltip("Custom Path: the LFO plays the editable point path above. Click for path tools");
    customPath_.onClick=[this]{ if(callbacks_.pathTools) callbacks_.pathTools(customPath_); };
    // "Has a custom path" is a status, not a selection: neutral white, not red.
    customPath_.setActiveTint(Palette::text());
    for(auto* b:{&retrigger_,&envelope_,&free_,&pingPong_,&customPath_}) tools_.addAndMakeVisible(*b);
    // Optical corrections: the retrigger arrow and the free wave carry their
    // weight off-centre / small in the 600x600 art.
    free_.setOpticalAdjust(1.04f);
    pingPong_.setOpticalAdjust(.94f);

    // ---- grid ----
    gridIcon_.setTooltip("Grid Alignment: horizontal (time) and vertical (level) editor grid divisions");
    gridIcon_.setGlyphFraction(.62f);
    gridRows_.setTooltip("Horizontal grid lines: level divisions across the full range (1-64)");
    gridColumns_.setTooltip("Vertical grid lines: time divisions per LFO cycle (1-64)");
    for(auto* f:{&gridColumns_,&gridRows_}) f->onValueChange=[this](int){ if(callbacks_.gridChanged) callbacks_.gridChanged(); };
    snap_.setTooltip("Snap to Grid: new and dragged points land on the grid (never moves existing points)");
    snap_.onClick=[this]{ const bool on=!snap_.getToggleState(); snap_.setToggleState(on,juce::dontSendNotification); if(callbacks_.snap) callbacks_.snap(on); };
    for(juce::Component* c:{static_cast<juce::Component*>(&gridIcon_),static_cast<juce::Component*>(&gridColumns_),
                            static_cast<juce::Component*>(&gridRows_),static_cast<juce::Component*>(&snap_)}) tools_.addAndMakeVisible(*c);

    // ---- direction ----
    forward_.setTooltip("Forward: LFO paths play left to right");
    reverse_.setTooltip("Reverse: not available yet. LFO playback has no direction setting");
    forward_.setToggleState(true,juce::dontSendNotification);
    reverse_.setEnabled(false);
    // The arrows are long, thin silhouettes: let them use the cell width.
    for(auto* b:{&forward_,&reverse_}) { b->setActiveMarker(false); b->setGlyphFraction(.62f); b->setMaxGlyphAspect(5.0f); tools_.addAndMakeVisible(*b); }

    // ---- FUNC ----
    for(std::size_t i=0;i<funcCount;++i) {
        const auto& info=funcInfo()[i];
        styleKnob(func_[i],juce::String("LFO FUNC ")+info.name);
        juce::NormalisableRange<double> range(info.minimum,info.maximum);
        if(info.centre>info.minimum && info.centre<info.maximum && info.field!=&LfoSettings::skew) range.setSkewForCentre(info.centre);
        func_[i].setNormalisableRange(range);
        func_[i].setValue(info.neutral,juce::dontSendNotification);
        func_[i].setDoubleClickReturnValue(true,info.neutral);
        func_[i].textFromValueFunction=[i](double v){ return funcValueText(i,v); };
        func_[i].setPopupDisplayEnabled(true,false,nullptr);
        func_[i].setTooltip(info.tooltip);
        if(info.field==&LfoSettings::skew) func_[i].getProperties().set("mct.origami.bipolar",true);
        func_[i].onValueChange=[this,i]{
            const auto& f=funcInfo()[i];
            if(f.field==nullptr || !callbacks_.func) return;
            const float v=static_cast<float>(func_[i].getValue());
            if(lfo_.*(f.field)!=v) callbacks_.func(f.field,v);
        };
        styleCaption(funcLabels_[i],info.name);
        funcBank_.addAndMakeVisible(func_[i]);
        funcBank_.addAndMakeVisible(funcLabels_[i]);
        if(!info.implemented) {
            func_[i].setEnabled(false);
            func_[i].setAlpha(.38f);
            funcLabels_[i].setAlpha(.45f);
        }
    }

    configureRateKnob();
    refreshRateField();
}

IconButton& LfoControlStrip::modeButton(LfoMode m) noexcept {
    return m==LfoMode::Loop ? retrigger_ : m==LfoMode::Envelope ? envelope_ : free_;
}

double LfoControlStrip::currentBpm() const {
    const double bpm=callbacks_.bpm ? callbacks_.bpm() : 120.0;
    return std::isfinite(bpm) && bpm>0.0 ? bpm : 120.0;
}

void LfoControlStrip::setLfo(std::size_t index,const LfoSettings& lfo,std::uint32_t sourceItem) {
    sourceItem_=sourceItem ? sourceItem : std::uint32_t(index+1);
    index_=index; lfo_=lfo;
    // mct-origami-nested-modulation-manual-qa: the RATE knob is the canonical
    // LFO RATE destination of the shown LFO (drop a source here, knob menu).
    rate_.getProperties().set("mct.mod.destination",static_cast<int>(ModDestination::LfoRate));
    rate_.getProperties().set("mct.mod.itemId",static_cast<int>(sourceItem_));
    for(auto m:{LfoMode::Loop,LfoMode::Envelope,LfoMode::Free})
        modeButton(m).setToggleState(lfo.mode==m,juce::dontSendNotification);
    customPath_.setToggleState(lfo.pointCount>=2,juce::dontSendNotification);
    pingPong_.setToggleState(lfo.pingPong,juce::dontSendNotification);
    for(std::size_t i=0;i<funcCount;++i) {
        const auto& f=funcInfo()[i];
        if(f.field==nullptr) continue;
        if(!func_[i].isMouseButtonDown()) func_[i].setValue(lfo.*(f.field),juce::dontSendNotification);
        func_[i].setTooltip(juce::String(f.name)+" "+funcValueText(i,lfo.*(f.field))+"  -  "+juce::String(f.tooltip).fromFirstOccurrenceOf(": ",false,false));
    }
    if(rateUnit()==RateUnit::Beats && std::abs(currentBpm()-beatBpm_)>1.0e-6) configureRateKnob();
    if(!rate_.isMouseButtonDown()) {
        if(rateUnit()==RateUnit::Beats) {
            std::size_t best=0; double bestError=1.0e9;
            for(std::size_t i=0;i<beatChoices_.size();++i) {
                const double e=std::abs(std::log(divisionHz(divisions()[beatChoices_[i]],beatBpm_)/double(lfo.rateHz)));
                if(e<bestError) { bestError=e; best=i; }
            }
            rate_.setValue(static_cast<double>(best),juce::dontSendNotification);
        } else if(rateUnit()==RateUnit::Seconds) rate_.setValue(1.0/double(lfo.rateHz),juce::dontSendNotification);
        else rate_.setValue(lfo.rateHz,juce::dontSendNotification);
    }
    refreshRateField();
}

void LfoControlStrip::setSnap(bool on) { snap_.setToggleState(on,juce::dontSendNotification); }
void LfoControlStrip::setPage(Page p) { page_.setSelected(static_cast<int>(p)); resized(); repaint(); }
void LfoControlStrip::setRateUnit(RateUnit u) { unit_.setSelected(static_cast<int>(u)); configureRateKnob(); refreshRateField(); }
void LfoControlStrip::setGrid(int columns,int rows) {
    const bool a=gridColumns_.setValue(columns),b=gridRows_.setValue(rows);
    if((a||b) && callbacks_.gridChanged) callbacks_.gridChanged();
}

void LfoControlStrip::configureRateKnob() {
    // Re-mapping the knob is a view change: it never writes the canonical rate.
    if(rateUnit()==RateUnit::Beats) {
        beatBpm_=currentBpm();
        beatChoices_.clear();
        for(std::size_t i=0;i<divisions().size();++i) {
            const double hz=divisionHz(divisions()[i],beatBpm_);
            if(hz>=rateMinHz && hz<=rateMaxHz) beatChoices_.push_back(i);
        }
        rate_.setNormalisableRange({0.0,double(juce::jmax<std::size_t>(1,beatChoices_.size())-1),1.0});
        std::size_t best=0; double bestError=1.0e9;
        for(std::size_t i=0;i<beatChoices_.size();++i) {
            const double e=std::abs(std::log(divisionHz(divisions()[beatChoices_[i]],beatBpm_)/double(lfo_.rateHz)));
            if(e<bestError) { bestError=e; best=i; }
        }
        rate_.setValue(double(best),juce::dontSendNotification);
    } else if(rateUnit()==RateUnit::Seconds) {
        // SECONDS shows TIME: clockwise = longer period = slower LFO.
        juce::NormalisableRange<double> range(periodMinSeconds,periodMaxSeconds);
        range.setSkewForCentre(1.0);
        rate_.setNormalisableRange(range);
        rate_.setValue(1.0/double(lfo_.rateHz),juce::dontSendNotification);
    } else {
        // HZ: clockwise = faster (unchanged).
        juce::NormalisableRange<double> range(rateMinHz,rateMaxHz);
        range.setSkewForCentre(2.0);
        rate_.setNormalisableRange(range);
        rate_.setValue(lfo_.rateHz,juce::dontSendNotification);
    }
}

void LfoControlStrip::refreshRateField() {
    if(rateField_.isBeingEdited()) return;
    rateField_.setText(formatRate(lfo_.rateHz,rateUnit(),rateUnit()==RateUnit::Beats ? beatBpm_ : currentBpm()),juce::dontSendNotification);
}

void LfoControlStrip::rateKnobMoved() {
    float hz=static_cast<float>(rate_.getValue());
    if(rateUnit()==RateUnit::Seconds) hz=static_cast<float>(1.0/juce::jmax(periodMinSeconds,rate_.getValue()));
    if(rateUnit()==RateUnit::Beats) {
        if(beatChoices_.empty()) return;
        const auto i=static_cast<std::size_t>(juce::jlimit(0,int(beatChoices_.size())-1,juce::roundToInt(rate_.getValue())));
        hz=static_cast<float>(divisionHz(divisions()[beatChoices_[i]],beatBpm_));
    }
    hz=juce::jlimit(rateMinHz,rateMaxHz,hz);
    if(hz==lfo_.rateHz) return;
    if(callbacks_.rateHz) callbacks_.rateHz(hz);
}

void LfoControlStrip::commitRateText() {
    const auto hz=parseRate(rateField_.getText(),rateUnit(),currentBpm());
    if(hz && *hz!=lfo_.rateHz && callbacks_.rateHz) callbacks_.rateHz(*hz);
    refreshRateField();
}

void LfoControlStrip::paint(juce::Graphics&) {}

// mct-origami-nested-modulation-manual-qa: incoming LFO RATE modulation on the
// RATE knob, in the SYNTH knob language. Modulation moves the canonical rate
// on its log scale; each view (HZ / SECONDS / BEATS) maps that to its knob.
float LfoControlStrip::rateKnobProportion(float hz) {
    double value=hz;
    if(rateUnit()==RateUnit::Seconds) value=1.0/juce::jmax(1.0e-6,double(hz));
    else if(rateUnit()==RateUnit::Beats) {
        std::size_t best=0; double bestError=1.0e9;
        for(std::size_t i=0;i<beatChoices_.size();++i) {
            const double e=std::abs(std::log(divisionHz(divisions()[beatChoices_[i]],beatBpm_)/juce::jmax(1.0e-6,double(hz))));
            if(e<bestError) { bestError=e; best=i; }
        }
        value=double(best);
    }
    return static_cast<float>(juce::jlimit(0.0,1.0,rate_.valueToProportionOfLength(juce::jlimit(rate_.getMinimum(),rate_.getMaximum(),value))));
}
bool LfoControlStrip::rateModulated() const noexcept {
    return modulationUiHasAnyRoute(ModDestination::LfoRate,0,sourceItem_);
}
void LfoControlStrip::paintOverChildren(juce::Graphics& g) {
    if(page()!=Page::Tools || !rate_.isShowing() || !rateModulated()) return;
    const auto id=sourceItem_;
    const float base=lfoRateToNormalized(lfo_.rateHz);
    const auto range=knobModulationRange(base,ModDestination::LfoRate,0,id);
    const float lo=rateKnobProportion(lfoRateFromNormalized(range.lo)),hi=rateKnobProportion(lfoRateFromNormalized(range.hi));
    const float effective=rateKnobProportion(lfoRateFromNormalized(juce::jlimit(0.0f,1.0f,base+modulationUiEffectiveNormalizedOffset(ModDestination::LfoRate,0,id))));
    paintKnobModulationOverlay(g,getLocalArea(&rate_,rate_.getLocalBounds()).toFloat(),juce::jmin(lo,hi),juce::jmax(lo,hi),
                               range.hasDepth,range.anyRoute,modulationUiTelemetry().synthActive,effective,range.selected);
}

void LfoControlStrip::Content::paint(juce::Graphics& g) {
    // Dark raised group cells; no outline on individual controls.
    for(const auto& r:groups) {
        if(r.isEmpty()) continue;
        const auto box=r.toFloat().reduced(.5f);
        g.setColour(Palette::raised()); g.fillRoundedRectangle(box,2.5f);
        g.setColour(Palette::borderSoft()); g.drawRoundedRectangle(box,2.5f,1.0f);
    }
    if(!divider.isEmpty()) { g.setColour(Palette::borderSoft()); g.fillRect(divider); }
}

void LfoControlStrip::resized() {
    auto b=getLocalBounds();
    const int gh=juce::jmin(groupHeight,b.getHeight());
    page_.setBounds(b.removeFromLeft(pageWidth).withSizeKeepingCentre(pageWidth,gh));
    b.removeFromLeft(groupGap);
    const bool tools=page()==Page::Tools;
    toolsViewport_.setVisible(tools); funcViewport_.setVisible(!tools);
    auto& viewport=tools ? toolsViewport_ : funcViewport_;
    viewport.setBounds(b);
    const int need=tools ? minimumToolsWidth() : minimumFuncWidth();
    const bool scrolls=need>b.getWidth();
    const int width=juce::jmax(need,b.getWidth());
    // Scroll gutter: content stops above the bar instead of being covered.
    const int height=scrolls ? b.getHeight()-scrollThickness-1 : b.getHeight();
    (tools ? tools_ : funcBank_).setSize(width,height);
    if(tools) layoutTools(width); else layoutFunc(width);
}

void LfoControlStrip::layoutTools(int width) {
    const int h=tools_.getHeight();
    const int gh=juce::jmin(groupHeight,h);
    // Same top edge as the TOOLS/FUNC selector (centred in the strip), or
    // top-aligned above a scrollbar.
    const int y=h>=groupHeight ? (h-gh)/2 : 0;
    // Dense: extra width only opens the gaps a little; the rest trails.
    const int gap=juce::jmin(maxGroupGap,groupGap+(width-minimumToolsWidth())/3);
    int x=0;
    auto group=[&](int w) { juce::Rectangle<int> r{x,y,w,gh}; x+=w+gap; return r; };

    auto time=group(timeWidth);
    auto behaviour=group(behaviourWidth);
    auto grid=group(gridWidth);
    auto direction=group(directionGroupWidth);
    tools_.groups={time,behaviour,grid,direction};

    auto t=time.reduced(padX,padY);
    unit_.setBounds(t.removeFromLeft(unitWidth));
    t.removeFromLeft(4);
    // The knob owns the full group height; its RATE caption sits above the value.
    rate_.setBounds(t.removeFromLeft(knobWidth));
    t.removeFromLeft(4);
    auto valueColumn=t.removeFromLeft(fieldWidth);
    const int fieldHeight=26,captionHeight=12;
    auto stack=valueColumn.withSizeKeepingCentre(fieldWidth,captionHeight+2+fieldHeight);
    rateLabel_.setBounds(stack.removeFromTop(captionHeight));
    stack.removeFromTop(2);
    rateField_.setBounds(stack);

    auto bh=behaviour.reduced(4,padY);
    for(auto* button:{&retrigger_,&envelope_,&free_}) button->setBounds(bh.removeFromLeft(iconCell));
    auto div=bh.removeFromLeft(behaviourDivider);
    tools_.divider={div.getCentreX(),div.getY()+8,1,div.getHeight()-16};
    for(auto* button:{&pingPong_,&customPath_}) button->setBounds(bh.removeFromLeft(iconCell));

    auto gr=grid.withTrimmedLeft(padX).withTrimmedRight(4).reduced(0,padY);
    gridIcon_.setBounds(gr.removeFromLeft(gridIconWidth));
    gr.removeFromLeft(3);
    auto fields=gr.removeFromLeft(gridFieldWidth);
    const int fh=(fields.getHeight()-4)/2;
    gridRows_.setBounds(fields.removeFromTop(fh));
    gridColumns_.setBounds(fields.removeFromBottom(fh));
    gr.removeFromLeft(4);
    snap_.setBounds(gr.removeFromLeft(iconCell));

    auto d=direction.reduced(4,padY);
    const int half=(d.getHeight()-2)/2;
    forward_.setBounds(d.removeFromTop(half));
    reverse_.setBounds(d.removeFromBottom(half));
}

void LfoControlStrip::layoutFunc(int width) {
    const int h=funcBank_.getHeight();
    const int gh=juce::jmin(groupHeight,h);
    const int y=h>=groupHeight ? (h-gh)/2 : 0;
    // Knobs keep one cell size; a wide strip does not spread them apart.
    const int w=juce::jmin(width,minimumFuncWidth()+static_cast<int>(funcCount)*16);
    const juce::Rectangle<int> group{0,y,w,gh};
    funcBank_.groups={group,{},{},{}};
    auto r=group.reduced(4,2);
    const int cell=r.getWidth()/static_cast<int>(funcCount);
    for(std::size_t i=0;i<funcCount;++i) {
        auto c=r.removeFromLeft(i+1==funcCount ? r.getWidth() : cell);
        funcLabels_[i].setBounds(c.removeFromBottom(11));
        func_[i].setBounds(c.withSizeKeepingCentre(knobWidth,c.getHeight()));
    }
}

}
