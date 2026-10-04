// mct-origami-modulation-row-consistency
#include "ModulationSourceRow.h"

namespace mct::origami::ui {

std::vector<ModulationSourceRoute> modulationSourceRoutes(const ModulationState& state,ModSource source) {
    std::vector<ModulationSourceRoute> out;
    for(const auto& route:state.routes) {
        if(route.id==0 || !route.enabled) continue;
        bool feeds=route.source==source;
        // N04: a route processed in NODES still belongs to its root sources.
        if(!feeds && isOperatorSource(route.source)) {
            std::array<ModSource,16> roots{};
            const auto count=routeRootSources(state,route,roots);
            for(std::size_t i=0;i<count;++i) feeds|=roots[i]==source;
        }
        if(feeds) out.push_back({route.id,route.amount});
    }
    return out;
}

juce::String modulationRouteTargetLabel(const InstrumentState& state,std::uint32_t routeId) {
    const ModRoute* found=nullptr;
    for(const auto& route:state.modulation.routes)
        if(route.id==routeId) {found=&route;break;}
    if(!found) return {};

    juce::String target;
    switch(found->destination.parameter) {
        case ModDestination::FxParameter:
            target="NODES / NODE "+juce::String(found->destination.oscillator)+" / P"+juce::String(fxAddressParameter(found->destination));break;
        case ModDestination::Cutoff:target="FILTER / CUTOFF";break;
        case ModDestination::Resonance:target="FILTER / RESONANCE";break;
        case ModDestination::MasterGain:target="GLOBAL / MASTER GAIN";break;
        case ModDestination::WtPosition:target="WT POSITION";break;
        case ModDestination::Octave:target="OCTAVE";break;
        case ModDestination::Semitone:target="SEMITONE";break;
        case ModDestination::Fine:target="FINE";break;
        case ModDestination::Detune:target="DETUNE";break;
        case ModDestination::Pan:target="PAN";break;
        case ModDestination::Level:target="LEVEL";break;
        case ModDestination::Process1Amount:target="PROCESS 1 AMOUNT";break;
        case ModDestination::Process2Amount:target="PROCESS 2 AMOUNT";break;
        case ModDestination::Route1Amount:target="ROUTE 1 AMOUNT";break;
        case ModDestination::Route2Amount:target="ROUTE 2 AMOUNT";break;
        case ModDestination::ProcessAmount:target="OSC PROCESS AMOUNT";break;
        case ModDestination::RouteAmount:target="OSC ROUTE AMOUNT";break;
    }

    if(found->destination.oscillator!=0 && found->destination.parameter!=ModDestination::FxParameter) {
        unsigned ordinal=0;
        for(const auto& osc:state.oscillators) {
            if(!osc.id) continue;
            ++ordinal;
            if(osc.id==found->destination.oscillator) {
                target="OSC "+juce::String(ordinal)+" / "+target;
                break;
            }
        }
    }
    return target;
}

void paintModulationRouteTooltip(juce::Graphics& g,const juce::String& label,
                                 juce::Point<float> at,juce::Rectangle<float> bounds) {
    if(label.isEmpty()) return;
    g.setFont(juce::FontOptions(9.0f));
    // Avoid JUCE Font width APIs here: this project is building against
    // a JUCE revision where both getStringWidthFloat() and getStringWidth()
    // are unavailable. This tooltip is short, fixed-font UI text, so a
    // deterministic character-width estimate is sufficient and portable.
    const int w=juce::jlimit(92,220,18+label.length()*7);
    juce::Rectangle<float> box(at.x+12.0f,at.y-30.0f,float(w),24.0f);
    if(box.getRight()>bounds.getRight()) box.setX(at.x-float(w)-12.0f);
    if(box.getY()<bounds.getY()) box.setY(at.y+12.0f);

    g.setColour(juce::Colours::black.withAlpha(.94f));
    g.fillRoundedRectangle(box,4.0f);
    g.setColour(Palette::borderStrong());
    g.drawRoundedRectangle(box,4.0f,.9f);
    g.setColour(Palette::text());
    g.drawText(label,box.reduced(8.0f,2.0f),juce::Justification::centredLeft);
}

ModulationSourceRow::ModulationSourceRow(ModSource source,const juce::String& title,const juce::String& componentName)
    :juce::TextButton(title),source_(source) {
    // "MOD SOURCE TAB" selects the source-card look in OrigamiLookAndFeel.
    setName(componentName);
}

bool ModulationSourceRow::setRoutes(std::vector<ModulationSourceRoute> routes) {
    const bool heightChanged=heightFor(routes.size())!=preferredHeight();
    bool same=routes.size()==routes_.size();
    for(std::size_t i=0;same && i<routes.size();++i)
        same=routes[i].id==routes_[i].id && routes[i].amount==routes_[i].amount;
    if(same) return false;
    routes_=std::move(routes);
    if(hoverRoute_!=0 && routeAt(hoverPoint_)!=hoverRoute_) setHover(0,{});
    repaint();
    return heightChanged;
}

// Route gauges need enough visual area to read as controls, not status LEDs.
namespace { constexpr float ringDiameter=16.0f,ringGap=5.0f; }

// As many rings as fit the row (at most maxRings); the rest read as "+N".
std::size_t ModulationSourceRow::visibleRings() const noexcept {
    const float width=float(getWidth())-10.0f-18.0f; // margins + the "+N" overflow label
    const auto fit=width<=ringDiameter ? std::size_t(1) : std::size_t((width+ringGap)/(ringDiameter+ringGap));
    return std::min({routes_.size(),maxRings,std::max<std::size_t>(1,fit)});
}

juce::Rectangle<float> ModulationSourceRow::ringBounds(std::size_t index) const noexcept {
    const auto count=routes_.size();
    if(count==0 || index>=visibleRings()) return {};
    auto b=getLocalBounds().toFloat().reduced(5.0f,1.5f);
    auto ringArea=b.withTrimmedTop(17.5f);
    constexpr float diameter=ringDiameter;
    constexpr float gap=ringGap;
    const auto shown=visibleRings();
    const float total=float(shown)*diameter+float(shown-1)*gap;
    const float x0=ringArea.getCentreX()-total*0.5f;
    return {x0+float(index)*(diameter+gap),ringArea.getCentreY()-diameter*0.5f,diameter,diameter};
}

std::uint32_t ModulationSourceRow::routeAt(juce::Point<float> p) const noexcept {
    const auto shown=std::min(routes_.size(),maxRings);
    for(std::size_t i=0;i<shown;++i)
        if(ringBounds(i).expanded(2.0f).contains(p)) return routes_[i].id;
    return 0;
}

void ModulationSourceRow::paintButton(juce::Graphics& g,bool over,bool down) {
    juce::TextButton::paintButton(g,over,down);
    const auto card=getLocalBounds().toFloat();
    // Six-dot grip: every source card is draggable onto any knob, on any page.
    paintDragGrip(g,card.withWidth(sourceEntityGripWidth+6.0f).withTrimmedLeft(4.0f).withHeight(std::min(card.getHeight(),18.0f)));
    if(routes_.empty()) return;

    const auto inner=card.reduced(4.0f,1.0f);
    const float dividerY=inner.getY()+16.5f;
    g.setColour(Palette::borderStrong().withAlpha(0.58f));
    g.drawLine(inner.getX()+4.0f,dividerY,inner.getRight()-4.0f,dividerY,0.75f);

    const auto shown=visibleRings();
    for(std::size_t i=0;i<shown;++i) paintModulationMagnitudeRing(g,ringBounds(i),routes_[i].amount);
    if(routes_.size()>shown) {
        g.setColour(Palette::muted());
        g.setFont(juce::FontOptions(7.0f));
        g.drawText("+"+juce::String(int(routes_.size()-shown)),
                   juce::Rectangle<float>(inner.getRight()-18.0f,dividerY+1.0f,16.0f,11.0f),
                   juce::Justification::centred);
    }
}

void ModulationSourceRow::mouseDown(const juce::MouseEvent& e) {
    sourceDragStarted_=false;
    ringDrag_=routeAt(e.position);
    if(onPressed) onPressed();
    if(ringDrag_!=0) {
        ringStartY_=e.position.y;
        for(const auto& r:routes_) if(r.id==ringDrag_) ringStartAmount_=r.amount;
        return; // a ring is a control, not a click on the card
    }
    juce::TextButton::mouseDown(e);
}

void ModulationSourceRow::mouseDrag(const juce::MouseEvent& e) {
    if(ringDrag_!=0) {
        const float amount=juce::jlimit(-1.0f,1.0f,ringStartAmount_+(ringStartY_-e.position.y)/42.0f);
        if(onRouteAmount) onRouteAmount(ringDrag_,amount);
        return;
    }
    juce::TextButton::mouseDrag(e);
    if(sourceDragStarted_ || e.position.getDistanceFrom(e.mouseDownPosition)<=7.0f) return;
    if(auto* container=juce::DragAndDropContainer::findParentDragContainerFor(this)) {
        sourceDragStarted_=true;
        container->startDragging("MCT_MOD_SOURCE:"+juce::String(static_cast<int>(source_)),this);
    }
}

void ModulationSourceRow::mouseUp(const juce::MouseEvent& e) {
    if(ringDrag_!=0) { ringDrag_=0; return; }
    juce::TextButton::mouseUp(e);
}

void ModulationSourceRow::mouseDoubleClick(const juce::MouseEvent& e) {
    // Double-clicking a route gauge removes only that assignment.
    if(const auto id=routeAt(e.position); id!=0 && onRouteRemove) {
        ringDrag_=0;
        onRouteRemove(id);
    }
}

void ModulationSourceRow::mouseMove(const juce::MouseEvent& e) {
    juce::TextButton::mouseMove(e);
    setHover(routeAt(e.position),e.position);
}

void ModulationSourceRow::mouseExit(const juce::MouseEvent& e) {
    juce::TextButton::mouseExit(e);
    setHover(0,{});
}

void ModulationSourceRow::setHover(std::uint32_t id,juce::Point<float> at) {
    if(id==hoverRoute_ && (id==0 || at.getDistanceFrom(hoverPoint_)<=2.0f)) return;
    hoverRoute_=id;
    hoverPoint_=at;
    if(onHoverChanged) onHoverChanged();
}

}
