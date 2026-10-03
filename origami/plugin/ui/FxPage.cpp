// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-fx-page-foundation-p01
#include "FxPage.h"
#include <cmath>
#include <cstring>
#include <limits>

namespace mct::origami::ui {
namespace {
using namespace mct::origami::fx;

constexpr int toolbarHeight=44;
constexpr int inspectorHeight=250;

void configureKnob(juce::Slider& s) {
    s.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    s.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    s.setRotaryParameters(juce::MathConstants<float>::pi*1.20f,juce::MathConstants<float>::pi*2.80f,true);
    s.setMouseDragSensitivity(220);
    // The wheel navigates the graph; knobs change only by dragging.
    s.setScrollWheelEnabled(false);
}

// FX parameters advertise their canonical modulation destination exactly like
// every other Origami knob, so the editor's drag/drop, right-click menu and
// range overlays work without an FX-specific path.
void tagModulationDestination(juce::Slider& s,FxNodeId node,const FxParameterDescriptor& p) {
    auto& props=s.getProperties();
    props.set("mct.mod.destination",static_cast<int>(ModDestination::FxParameter));
    props.set("mct.mod.oscillator",static_cast<int>(node));
    // Bus-qualified parameter id (FX node IDs are unique per bus graph).
    props.set("mct.mod.itemId",static_cast<int>(fxParameterAddress(mainBusId,node,p.id).itemId));
    props.set("mct.origami.knobDefault",double(p.defaultValue));
}

std::vector<const FxParameterDescriptor*> parametersFor(const FxNode& node,bool quickOnly,
                                                        std::optional<FxParameterPage> page) {
    std::vector<const FxParameterDescriptor*> result;
    if(node.kind!=FxNodeKind::Effect) return result;
    if(const auto* d=findFxEffect(node.effect))
        for(std::size_t i=0;i<d->parameterCount;++i) {
            const auto& p=d->parameters[i];
            if(quickOnly && !p.quick) continue;
            if(page && p.page!=*page) continue;
            result.push_back(&p);
        }
    return result;
}

const FxParameterDescriptor* parameterDescriptor(const FxNode& node,FxParameterId id) {
    if(const auto* d=findFxEffect(node.effect))
        for(std::size_t i=0;i<d->parameterCount;++i) if(d->parameters[i].id==id) return &d->parameters[i];
    return nullptr;
}

float physical(const FxNode& n,std::size_t index) {
    const auto* d=findFxEffect(n.effect);
    if(d==nullptr || index>=d->parameterCount) return 0.0f;
    const auto& p=d->parameters[index];
    return fxParameterValue(p,n.parameter(p.id).value_or(p.defaultValue));
}

juce::String valueText(const FxNode& n,const FxParameterDescriptor& p) {
    return juce::String(fxParameterText(p,n.parameter(p.id).value_or(p.defaultValue)));
}

juce::String sourceName(ModSource s) {
    using S=ModSource;
    switch(s) {
    case S::Env1:return "ENV 1"; case S::Env2:return "ENV 2"; case S::Env3:return "ENV 3";
    case S::Lfo1:return "LFO 1"; case S::Lfo2:return "LFO 2"; case S::Lfo3:return "LFO 3"; case S::Lfo4:return "LFO 4";
    case S::Macro1:return "MACRO 1"; case S::Macro2:return "MACRO 2"; case S::Macro3:return "MACRO 3"; case S::Macro4:return "MACRO 4";
    case S::Random:return "RANDOM"; case S::Function:return "FUNCTION";
    case S::Chaos:return "CHAOS"; case S::Drift:return "DRIFT"; case S::Sequencer:return "SEQUENCER";
    case S::ModWheel:return "MOD WHEEL"; case S::Velocity:return "VELOCITY"; case S::Keytrack:return "KEYTRACK";
    case S::Aftertouch:return "AFTERTOUCH"; case S::PitchBend:return "PITCH BEND"; case S::NoteGate:return "NOTE GATE";
    }
    return "MODULATOR";
}

struct SourceEntry { ModSource source; const char* group; };
// Canonical modulator references available in the current instrument.
std::vector<SourceEntry> availableSources(const ModulationState& m) {
    std::vector<SourceEntry> out;
    const ModSource envs[]{ModSource::Env1,ModSource::Env2,ModSource::Env3};
    for(int i=0;i<3;++i) if(m.envActiveMask&(1u<<i)) out.push_back({envs[i],"ENVELOPES"});
    const ModSource lfos[]{ModSource::Lfo1,ModSource::Lfo2,ModSource::Lfo3,ModSource::Lfo4};
    for(int i=0;i<4;++i) if(m.lfoActiveMask&(1u<<i)) out.push_back({lfos[i],"LFOS"});
    for(auto s:{ModSource::Macro1,ModSource::Macro2,ModSource::Macro3,ModSource::Macro4}) out.push_back({s,"MACROS"});
    if(m.generatorActiveMask&0x02u) out.push_back({ModSource::Random,"GENERATORS"});
    if(m.generatorActiveMask&0x01u) out.push_back({ModSource::Function,"GENERATORS"});
    if(m.generatorActiveMask&0x04u) out.push_back({ModSource::Chaos,"GENERATORS"});
    if(m.generatorActiveMask&0x08u) out.push_back({ModSource::Drift,"GENERATORS"});
    if(m.generatorActiveMask&0x10u) out.push_back({ModSource::Sequencer,"GENERATORS"});
    for(auto s:{ModSource::Velocity,ModSource::ModWheel,ModSource::Keytrack,ModSource::Aftertouch,ModSource::PitchBend,ModSource::NoteGate})
        out.push_back({s,"PERFORMANCE"});
    return out;
}

// UI-generated pictures of what each effect does, driven by its canonical
// parameters. No audio is streamed to the UI to draw these.
void paintEffectPreview(juce::Graphics& g,juce::Rectangle<float> r,const FxNode& n) {
    well(g,r.toNearestInt());
    const auto* d=findFxEffect(n.effect);
    if(d==nullptr) return;
    auto in=r.reduced(8.0f,7.0f);
    const auto ink=Palette::accent().withAlpha(n.enabled ? .85f : .28f);
    g.setColour(Palette::borderSoft().withAlpha(.8f));
    g.drawHorizontalLine(juce::roundToInt(in.getCentreY()),in.getX(),in.getRight());
    juce::Path path;
    const auto plot=[&](int count,const std::function<float(float)>& y01) {
        for(int i=0;i<=count;++i) {
            const float t=float(i)/float(count);
            const juce::Point<float> p{in.getX()+t*in.getWidth(),in.getBottom()-juce::jlimit(0.0f,1.0f,y01(t))*in.getHeight()};
            if(i==0) path.startNewSubPath(p); else path.lineTo(p);
        }
    };
    switch(d->visual) {
    case FxVisual::Transfer: {
        const float gain=std::pow(10.0f,physical(n,0)/20.0f),bias=physical(n,3);
        const float norm=std::max(std::abs(std::tanh(gain+bias)),std::abs(std::tanh(-gain+bias)));
        plot(64,[&](float t){return 0.5f+0.5f*std::tanh(gain*(2.0f*t-1.0f)+bias)/norm;});
        break;
    }
    case FxVisual::Taps: {
        const float time=physical(n,0),feedback=physical(n,1);
        const bool pingPong=physical(n,5)>=0.5f;
        const float spacing=in.getWidth()*std::sqrt(time/2000.0f)*0.9f+3.0f;
        float level=1.0f;
        g.setColour(ink);
        int tap=0;
        for(float x=in.getX()+2.0f;x<in.getRight() && level>.04f;x+=spacing,level*=std::max(feedback,0.08f),++tap) {
            const float h=level*in.getHeight()*0.5f;
            const bool up=!pingPong || tap%2==0;
            g.fillRect(juce::Rectangle<float>(x,up ? in.getCentreY()-h : in.getCentreY(),2.0f,h));
            if(feedback<0.01f) break;
        }
        return;
    }
    case FxVisual::Decay: {
        const float rt60=physical(n,1),pre=physical(n,4)/1000.0f,window=std::max(2.0f,rt60*1.2f);
        plot(64,[&](float t){
            const float seconds=t*window-pre;
            return seconds<0.0f ? 0.0f : std::exp(-6.9f*seconds/rt60)*0.95f;
        });
        auto fill=path;
        fill.lineTo(in.getRight(),in.getBottom());
        fill.lineTo(in.getX(),in.getBottom());
        fill.closeSubPath();
        g.setColour(ink.withMultipliedAlpha(.14f));
        g.fillPath(fill);
        break;
    }
    case FxVisual::Lfo: {
        const float cycles=juce::jlimit(0.5f,8.0f,physical(n,0)*2.0f),depth=physical(n,1);
        plot(96,[&](float t){return 0.5f+0.45f*depth*std::sin(juce::MathConstants<float>::twoPi*cycles*t);});
        g.setColour(ink.withMultipliedAlpha(.45f));
        juce::Path second;
        const float offset=physical(n,4)*juce::MathConstants<float>::pi;
        for(int i=0;i<=96;++i) {
            const float t=float(i)/96.0f;
            const juce::Point<float> p{in.getX()+t*in.getWidth(),in.getCentreY()-in.getHeight()*0.45f*depth*std::sin(juce::MathConstants<float>::twoPi*cycles*t+offset)};
            if(i==0) second.startNewSubPath(p); else second.lineTo(p);
        }
        g.strokePath(second,juce::PathStrokeType(1.0f));
        break;
    }
    case FxVisual::Comb: {
        const float f0=physical(n,0),fb=physical(n,1);
        const float scale=std::sqrt(1.0f-std::abs(fb));
        plot(160,[&](float t){
            const float hz=20.0f*std::pow(1000.0f,t);
            const float w=juce::MathConstants<float>::twoPi*hz/f0;
            const float mag=scale/std::sqrt(std::max(1.0e-4f,1.0f-2.0f*fb*std::cos(w)+fb*fb));
            return 0.5f+0.5f*juce::jlimit(-1.0f,1.0f,std::log10(mag)*0.6f);
        });
        break;
    }
    case FxVisual::Diffusion: {
        const float amount=physical(n,0),size=physical(n,1);
        g.setColour(ink);
        std::uint32_t seed=0x9e3779b9u;
        const int count=6+int(amount*28.0f);
        for(int i=0;i<count;++i) {
            seed=seed*1664525u+1013904223u;
            const float t=(float(i)+float(seed>>24)/255.0f)/float(count);
            const float x=in.getX()+t*in.getWidth()*(0.3f+0.7f*size);
            const float h=in.getHeight()*0.48f*std::exp(-2.5f*t)*(0.35f+0.65f*float((seed>>8)&255u)/255.0f);
            g.fillRect(juce::Rectangle<float>(x,in.getCentreY()-h,1.5f,h*2.0f));
        }
        return;
    }
    case FxVisual::Dynamics: {
        const float gain=physical(n,0),ceiling=physical(n,1);
        plot(64,[&](float t){
            const float inDb=-36.0f+t*42.0f;
            return (std::min(inDb+gain,ceiling)+36.0f)/42.0f;
        });
        g.setColour(signalShade(.6f,.5f));
        const float cy=in.getBottom()-(ceiling+36.0f)/42.0f*in.getHeight();
        g.drawHorizontalLine(juce::roundToInt(cy),in.getX(),in.getRight());
        break;
    }
    }
    g.setColour(ink);
    g.strokePath(path,juce::PathStrokeType(1.4f));
}

juce::String kindLabel(FxNodeKind kind) {
    switch(kind) {
    case FxNodeKind::Source: return "AUDIO SOURCE";
    case FxNodeKind::Effect: return "EFFECT";
    case FxNodeKind::Split: case FxNodeKind::Merge: return "ROUTING NODE";
    case FxNodeKind::Send: return "SEND";
    case FxNodeKind::Return: return "RETURN";
    case FxNodeKind::Output: return "INSTRUMENT OUTPUT";
    }
    return {};
}

float meterHeight(float linear) {
    if(linear<=1.0e-5f) return 0.0f;
    return juce::jlimit(0.0f,1.0f,(20.0f*std::log10(linear)+60.0f)/60.0f);
}

constexpr const char* moduleDragPrefix="MCT_FX_MODULE:";
constexpr const char* sourceDragPrefix="MCT_MOD_SOURCE:";
}

std::optional<FxModuleSpec> FxModuleMenu::decode(int id) {
    if(id>0 && id<1000) {
        const auto type=static_cast<FxEffectType>(id);
        if(const auto* d=findFxEffect(type); d!=nullptr && d->processesAudio) return FxModuleSpec{FxModuleKind::Effect,type,0};
        return std::nullopt;
    }
    if(id==splitId) return FxModuleSpec{FxModuleKind::Split,FxEffectType::None,0};
    if(id==mergeId) return FxModuleSpec{FxModuleKind::Merge,FxEffectType::None,0};
    if(id>busBase) return FxModuleSpec{FxModuleKind::BusSource,FxEffectType::None,static_cast<FxBusId>(id-busBase)};
    return std::nullopt; // send/return/external: not implemented, never decodable
}

// ================================================================ node

FxNodeComponent::FxNodeComponent(FxPage& page,FxNodeId id):page_(page),id_(id) {
    for(auto* b:{&power_,&menu_,&remove_,&accessory_}) addChildComponent(b);
    power_.setClickingTogglesState(true);
    power_.setName("Power FX "+juce::String(id));
    power_.onClick=[this]{page_.setNodeEnabled(id_,power_.getToggleState());};
    menu_.setName("Menu FX "+juce::String(id));
    menu_.onClick=[this]{page_.selectNode(id_);showMenu();};
    remove_.setName("Delete FX "+juce::String(id));
    // Deleting destroys this component; defer so the click unwinds first.
    remove_.onClick=[this] {
        juce::Component::SafePointer<FxPage> safePage(&page_);
        const auto nodeId=id_;
        juce::MessageManager::callAsync([safePage,nodeId]{if(safePage!=nullptr) safePage->deleteNode(nodeId);});
    };
    accessory_.setName("MASTER OUT add module");
    accessory_.onClick=[this] {
        juce::Component::SafePointer<FxPage> safePage(&page_);
        page_.showModuleMenu(accessory_,false,[safePage](FxModuleSpec spec){if(safePage!=nullptr) safePage->insertBeforeOutput(spec);});
    };
}

FxNodeComponent::~FxNodeComponent()=default;

juce::Rectangle<int> FxNodeComponent::sizeFor(const FxNode& n) noexcept {
    switch(n.kind) {
    case FxNodeKind::Source: return {0,0,150,82};
    case FxNodeKind::Output: return {0,0,164,226};
    case FxNodeKind::Split: case FxNodeKind::Merge: {
        const int branches=juce::jmax<int>(n.ports.inputs,n.ports.outputs);
        return {0,0,104,juce::jmax(80,28*branches+36)};
    }
    case FxNodeKind::Effect: case FxNodeKind::Send: case FxNodeKind::Return: break;
    }
    return {0,0,216,180};
}

void FxNodeComponent::update(const FxNode& node,bool selected) {
    const bool effect=node.kind==FxNodeKind::Effect;
    node_=node;
    selected_=selected;
    power_.setVisible(effect);
    menu_.setVisible(effect);
    remove_.setVisible(effect || node.isRouting());
    accessory_.setVisible(node.kind==FxNodeKind::Output);
    power_.setToggleState(node.enabled,juce::dontSendNotification);

    const auto quick=parametersFor(node,true,std::nullopt);
    std::vector<FxParameterId> ids;
    for(const auto* p:quick) ids.push_back(p->id);
    if(ids!=quickIds_) {
        quick_.clear();
        quickIds_=ids;
        for(const auto* p:quick) {
            const auto pid=p->id;
            auto slider=std::make_unique<juce::Slider>();
            configureKnob(*slider);
            slider->setRange(0.0,1.0,0.001);
            slider->setName("FX "+juce::String(id_)+" P"+juce::String(pid));
            tagModulationDestination(*slider,id_,*p);
            auto* raw=slider.get();
            slider->onDragStart=[this]{page_.selectNode(id_);page_.beginParameterGesture();};
            slider->onDragEnd=[this]{page_.endParameterGesture();};
            slider->onValueChange=[this,raw,pid]{page_.setParameter(id_,pid,float(raw->getValue()));};
            addAndMakeVisible(*slider);
            quick_.push_back(std::move(slider));
        }
    }
    for(std::size_t i=0;i<quick_.size();++i)
        if(!quick_[i]->isMouseButtonDown())
            quick_[i]->setValue(node.parameter(quickIds_[i]).value_or(0.0f),juce::dontSendNotification);
    // Low zoom: drop fine detail rather than drawing microscopic controls.
    const bool detailed=page_.graphZoom()>=0.6f;
    for(auto& q:quick_) q->setVisible(detailed);
    menu_.setVisible(effect && detailed);

    if(drag_!=Drag::Move)
        setBounds(sizeFor(node).withPosition(juce::roundToInt(node.position.x),juce::roundToInt(node.position.y)));
    resized();
    repaint();
}

void FxNodeComponent::setMeter(float left,float right) {
    if(std::abs(left-meterLeft_)<1.0e-6f && std::abs(right-meterRight_)<1.0e-6f) return;
    meterLeft_=left;
    meterRight_=right;
    repaint();
}

float FxNodeComponent::hitRadius() const noexcept {
    // Keep at least ~12 screen pixels of grab area at any zoom.
    return std::max(14.0f,12.0f/std::max(0.1f,page_.graphZoom()));
}

juce::Point<float> FxNodeComponent::portCentre(bool input,std::uint8_t port) const noexcept {
    const int count=input ? node_.ports.inputs : node_.ports.outputs;
    const float top=node_.isRouting() ? 28.0f : 0.0f;
    const float bottom=node_.kind==FxNodeKind::Output ? 44.0f : 0.0f;
    const float span=float(getHeight())-top-bottom;
    const float y=top+span*(float(port)+1.0f)/(float(count)+1.0f);
    return {input ? portRadius+1.5f : float(getWidth())-portRadius-1.5f,y};
}

std::optional<std::pair<bool,std::uint8_t>> FxNodeComponent::portAt(juce::Point<float> p) const noexcept {
    const float radius=hitRadius();
    for(std::uint8_t i=0;i<node_.ports.outputs;++i)
        if(p.getDistanceFrom(portCentre(false,i))<=radius) return std::make_pair(false,i);
    for(std::uint8_t i=0;i<node_.ports.inputs;++i)
        if(p.getDistanceFrom(portCentre(true,i))<=radius) return std::make_pair(true,i);
    return std::nullopt;
}

void FxNodeComponent::resized() {
    if(node_.kind==FxNodeKind::Effect) {
        auto row=getLocalBounds().removeFromTop(34).reduced(12,5);
        power_.setBounds(row.removeFromLeft(40));
        remove_.setBounds(row.removeFromRight(28));
        row.removeFromRight(4);
        menu_.setBounds(row.removeFromRight(30));
        auto knobs=getLocalBounds().withTrimmedTop(98).reduced(12,0).withTrimmedBottom(22);
        const int width=knobs.getWidth()/juce::jmax<int>(1,int(quick_.size()));
        for(auto& slider:quick_) slider->setBounds(knobs.removeFromLeft(width).withSizeKeepingCentre(46,46));
    } else if(node_.isRouting()) {
        remove_.setBounds(getWidth()-32,4,26,22);
    } else if(node_.kind==FxNodeKind::Output) {
        accessory_.setBounds(getLocalBounds().removeFromBottom(40).reduced(10,6));
    }
}

void FxNodeComponent::paint(juce::Graphics& g) {
    const auto bounds=getLocalBounds().toFloat().reduced(.5f);
    const bool routing=node_.isRouting();
    const bool detailed=page_.graphZoom()>=0.6f;
    const auto body=routing ? Palette::panel() : Palette::raised();
    g.setColour(body);
    g.fillRect(bounds);
    if(!routing) {
        g.setColour(body.brighter(.05f));
        g.fillRect(bounds.withHeight(33.0f).reduced(1.0f));
        g.setColour(Palette::borderStrong().withAlpha(.30f));
        g.drawHorizontalLine(33,8.0f,float(getWidth()-8));
    }
    g.setColour(selected_ ? signalShade(.80f,.90f) : Palette::border());
    g.drawRect(bounds,1.0f);
    if(selected_) {
        g.setColour(signalShade(.80f,.18f));
        g.drawRect(bounds.reduced(1.0f),1.0f);
    }

    const auto local=getLocalBounds();
    switch(node_.kind) {
    case FxNodeKind::Effect: {
        const auto* d=findFxEffect(node_.effect);
        auto title=local.withHeight(34).withTrimmedLeft(58).withTrimmedRight(detailed ? 74 : 44);
        text(g,node_.name,title,11.5f,node_.enabled ? Palette::text() : Palette::muted());
        if(d==nullptr || !d->processesAudio)
            text(g,"NO DSP",title,7.5f,Palette::muted().withAlpha(.75f),juce::Justification::centredRight);
        if(!detailed) break;
        paintEffectPreview(g,juce::Rectangle<float>(12.0f,40.0f,float(getWidth()-24),52.0f),node_);
        const auto quick=parametersFor(node_,true,std::nullopt);
        auto labels=local.withTrimmedTop(local.getHeight()-22).reduced(12,0);
        const int width=labels.getWidth()/juce::jmax<int>(1,int(quick.size()));
        for(const auto* p:quick) text(g,p->label,labels.removeFromLeft(width),9.0f,Palette::muted(),juce::Justification::centred);
        break;
    }
    case FxNodeKind::Source: {
        text(g,node_.name,local.withHeight(32).reduced(12,0),11.5f,Palette::text());
        if(!detailed) break;
        text(g,"SYNTH VOICE SUM",local.withTrimmedTop(32).withHeight(16).reduced(12,0),8.5f,Palette::muted());
        auto wave=juce::Rectangle<float>(12.0f,54.0f,float(getWidth())-40.0f,18.0f);
        juce::Path p;
        for(int i=0;i<=40;++i) {
            const float t=float(i)/40.0f;
            const juce::Point<float> pt{wave.getX()+t*wave.getWidth(),wave.getCentreY()-std::sin(t*juce::MathConstants<float>::twoPi*2.0f)*wave.getHeight()*.4f};
            if(i==0) p.startNewSubPath(pt); else p.lineTo(pt);
        }
        g.setColour(Palette::accent().withAlpha(.7f));
        g.strokePath(p,juce::PathStrokeType(1.2f));
        break;
    }
    case FxNodeKind::Output: {
        text(g,node_.name,local.withHeight(32).reduced(14,0),11.5f,Palette::text());
        auto meterArea=local.withTrimmedTop(40).withTrimmedBottom(44+30);
        auto meters=meterArea.withSizeKeepingCentre(64,meterArea.getHeight());
        for(int channel=0;channel<2;++channel) {
            auto column=meters.removeFromLeft(32);
            auto meterWell=column.withTrimmedBottom(16).reduced(6,0);
            well(g,meterWell);
            const float level=meterHeight(channel==0 ? meterLeft_ : meterRight_);
            if(level>0.0f) {
                auto fill=meterWell.toFloat().reduced(2.0f);
                fill=fill.withTop(fill.getBottom()-fill.getHeight()*level);
                g.setColour(signalShade(.85f,.85f));
                g.fillRect(fill);
            }
            text(g,channel==0 ? "L" : "R",column.removeFromBottom(14),9.0f,Palette::muted(),juce::Justification::centred);
        }
        const float loud=std::max(meterLeft_,meterRight_);
        text(g,loud>1.0e-5f ? juce::String(20.0f*std::log10(loud),1)+" DB" : juce::String("-INF DB"),
             local.withTrimmedBottom(44).withTrimmedTop(local.getHeight()-44-26).withHeight(20),9.0f,Palette::secondary(),juce::Justification::centred);
        break;
    }
    case FxNodeKind::Split: case FxNodeKind::Merge: {
        text(g,node_.name,{10,4,getWidth()-44,22},10.5f,Palette::secondary());
        g.setColour(Palette::accent().withAlpha(.55f));
        const bool split=node_.kind==FxNodeKind::Split;
        const auto single=portCentre(split,0);
        const auto hub=juce::Point<float>(float(getWidth())*.5f,single.y);
        g.drawLine(juce::Line<float>(single,hub),1.3f);
        const int many=split ? node_.ports.outputs : node_.ports.inputs;
        for(std::uint8_t i=0;i<many;++i) g.drawLine(juce::Line<float>(hub,portCentre(!split,i)),1.3f);
        g.fillEllipse(juce::Rectangle<float>(6.0f,6.0f).withCentre(hub));
        break;
    }
    case FxNodeKind::Send: case FxNodeKind::Return: break;
    }

    // While a cable is being dragged, inputs that would accept it light up.
    const auto wire=page_.canvas().wireSource();
    const auto paintPort=[&](bool input,std::uint8_t port) {
        const auto c=portCentre(input,port);
        auto dot=juce::Rectangle<float>(portRadius*2.0f,portRadius*2.0f).withCentre(c);
        bool compatible=false;
        if(wire && input && wire->node!=id_) {
            const auto result=page_.graph().canConnect(*wire,{id_,port});
            compatible=result==FxEditResult::Ok || result==FxEditResult::InputOccupied || result==FxEditResult::OutputOccupied;
        }
        g.setColour(Palette::inset());
        g.fillEllipse(dot);
        g.setColour(compatible ? signalSourceColour() : Palette::borderStrong());
        g.drawEllipse(compatible ? dot.expanded(2.0f) : dot,compatible ? 1.6f : 1.2f);
    };
    for(std::uint8_t i=0;i<node_.ports.inputs;++i) paintPort(true,i);
    for(std::uint8_t i=0;i<node_.ports.outputs;++i) paintPort(false,i);
}

void FxNodeComponent::mouseDown(const juce::MouseEvent& e) {
    page_.grabKeyboardFocus();
    if(e.mods.isMiddleButtonDown()) { page_.canvas().mouseDown(e.getEventRelativeTo(&page_.canvas())); return; }
    const auto port=portAt(e.position);
    if(port && e.mods.isPopupMenu()) { page_.disconnectPort(id_,port->first,port->second); return; }
    page_.selectNode(id_); // selection always brings the node to the front
    if(port && !port->first) {
        drag_=Drag::Wire;
        page_.canvas().beginWire(id_,port->second);
        return;
    }
    if(e.mods.isPopupMenu() && node_.kind==FxNodeKind::Effect) { showMenu(); return; }
    drag_=Drag::Move;
    dragOrigin_=getPosition();
}

void FxNodeComponent::mouseDrag(const juce::MouseEvent& e) {
    if(drag_==Drag::Wire) {
        page_.canvas().dragWire(e.getEventRelativeTo(&page_.canvas()).getPosition());
    } else if(drag_==Drag::Move) {
        auto at=dragOrigin_+e.getOffsetFromDragStart();
        at.x=juce::jmax(0,at.x);
        at.y=juce::jmax(0,at.y);
        if(at!=getPosition()) {
            setTopLeftPosition(at);
            page_.canvas().nodeMoved(id_);
        }
    } else if(e.mods.isMiddleButtonDown()) {
        page_.canvas().mouseDrag(e.getEventRelativeTo(&page_.canvas()));
    }
}

void FxNodeComponent::mouseUp(const juce::MouseEvent& e) {
    const auto mode=drag_;
    drag_=Drag::None;
    if(mode==Drag::Wire) page_.canvas().endWire(e.getEventRelativeTo(&page_.canvas()).getPosition());
    else if(mode==Drag::Move && getPosition()!=dragOrigin_) page_.commitMove(id_,getPosition());
    else page_.canvas().mouseUp(e.getEventRelativeTo(&page_.canvas()));
}

void FxNodeComponent::showMenu() {
    juce::Component::SafePointer<FxPage> page(&page_);
    const auto id=id_;
    showNativeChoiceMenu(menu_,"EFFECT",{
        {1,node_.enabled ? "Bypass" : "Enable",true,"EFFECT"},
        {2,"Disconnect All",true,"EFFECT"},
        {3,"Delete",true,"EFFECT"}},0,[page,id](int choice) {
        if(page==nullptr) return;
        const auto* node=page->graph().findNode(id);
        if(node==nullptr) return;
        if(choice==1) page->setNodeEnabled(id,!node->enabled);
        if(choice==2) {
            for(std::uint8_t i=0;i<node->ports.inputs;++i) page->disconnectPort(id,true,i);
            if(const auto* again=page->graph().findNode(id))
                for(std::uint8_t i=0;i<again->ports.outputs;++i) page->disconnectPort(id,false,i);
        }
        if(choice==3) page->deleteNode(id);
    });
}

// ================================================================ canvas

FxCanvas::FxCanvas(FxPage& page):page_(page) {}

FxNodeComponent* FxCanvas::nodeComponent(FxNodeId id) const noexcept {
    const auto it=nodes_.find(id);
    return it==nodes_.end() ? nullptr : it->second.get();
}

std::vector<FxNodeId> FxCanvas::nodeZOrder() const {
    std::vector<FxNodeId> order;
    for(auto* child:getChildren())
        if(auto* node=dynamic_cast<FxNodeComponent*>(child)) order.push_back(node->id());
    return order;
}

void FxCanvas::bringToFront(FxNodeId id) {
    if(auto* node=nodeComponent(id)) node->toFront(false);
}

juce::Rectangle<int> FxCanvas::contentBounds() const {
    juce::Rectangle<int> content;
    for(const auto& [id,node]:nodes_) content=content.isEmpty() ? node->getBounds() : content.getUnion(node->getBounds());
    for(const auto& wire:wires_) for(const auto& h:wire.handles) content=content.getUnion(juce::Rectangle<int>(int(h.x),int(h.y),1,1));
    return content;
}

float FxCanvas::wireHitRadius() const noexcept {
    return std::max(10.0f,10.0f/std::max(0.1f,page_.graphZoom()));
}

void FxCanvas::rebuild(const FxGraph& graph,FxNodeId selected,int minWidth,int minHeight) {
    // Reconcile by stable ID: components survive edits; only added/removed
    // nodes create or destroy components. Existing z-order is preserved.
    for(auto it=nodes_.begin();it!=nodes_.end();)
        it=graph.findNode(it->first)==nullptr ? nodes_.erase(it) : std::next(it);
    juce::Rectangle<int> content;
    for(const auto& node:graph.nodes()) {
        auto& component=nodes_[node.id];
        if(component==nullptr) {
            component=std::make_unique<FxNodeComponent>(page_,node.id);
            addAndMakeVisible(*component);
        }
        component->update(node,node.id==selected);
        content=content.getUnion(component->getBounds());
    }
    // Graph space extends well beyond the content so large graphs can grow.
    setSize(juce::jmax(minWidth,content.getRight()+900),juce::jmax(minHeight,content.getBottom()+600));
    wires_.clear();
    wires_.reserve(graph.connections().size());
    for(const auto& c:graph.connections()) {
        wires_.push_back({c,{},{},{}});
        computeWire(wires_.back());
    }
    repaint();
}

juce::Point<float> FxCanvas::portInCanvas(FxNodeId id,bool input,std::uint8_t port) const noexcept {
    const auto* node=nodeComponent(id);
    if(node==nullptr) return {};
    return node->portCentre(input,port)+node->getPosition().toFloat();
}

juce::Path FxCanvas::curve(juce::Point<float> a,juce::Point<float> b) {
    const float dx=juce::jmax(40.0f,std::abs(b.x-a.x)*.5f);
    juce::Path p;
    p.startNewSubPath(a);
    p.cubicTo(a.x+dx,a.y,b.x-dx,b.y,b.x,b.y);
    return p;
}

juce::Path FxCanvas::curveThrough(const std::vector<juce::Point<float>>& pts) {
    // Cardinal spline through every routing point, with horizontal tangents
    // at the ports so the cable still leaves/enters each port cleanly.
    juce::Path p;
    p.startNewSubPath(pts.front());
    const auto n=pts.size();
    std::vector<juce::Point<float>> tangent(n);
    tangent.front()={3.0f*juce::jmax(40.0f,std::abs(pts[1].x-pts[0].x)*.5f),0.0f};
    tangent.back()={3.0f*juce::jmax(40.0f,std::abs(pts[n-1].x-pts[n-2].x)*.5f),0.0f};
    for(std::size_t i=1;i+1<n;++i) tangent[i]=(pts[i+1]-pts[i-1])*0.5f;
    for(std::size_t i=0;i+1<n;++i) p.cubicTo(pts[i]+tangent[i]/3.0f,pts[i+1]-tangent[i+1]/3.0f,pts[i+1]);
    return p;
}

void FxCanvas::computeWire(Wire& wire) const {
    const auto a=portInCanvas(wire.connection.from.node,false,wire.connection.from.port);
    const auto b=portInCanvas(wire.connection.to.node,true,wire.connection.to.port);
    wire.handles.clear();
    for(const auto& p:wire.connection.layout) wire.handles.push_back({p.x,p.y});
    if(wire.handles.empty()) {
        wire.path=curve(a,b);
    } else {
        std::vector<juce::Point<float>> pts{a};
        pts.insert(pts.end(),wire.handles.begin(),wire.handles.end());
        pts.push_back(b);
        wire.path=curveThrough(pts);
    }
    wire.area=wire.path.getBounds().getSmallestIntegerContainer().expanded(int(wireHitRadius())+6);
}

std::optional<FxConnectionId> FxCanvas::connectionAt(juce::Point<float> p) const noexcept {
    std::optional<FxConnectionId> best;
    float bestDistance=wireHitRadius();
    for(const auto& wire:wires_) {
        if(!wire.area.expanded(int(wireHitRadius())).contains(p.toInt())) continue;
        juce::Point<float> nearest;
        wire.path.getNearestPoint(p,nearest);
        const float distance=p.getDistanceFrom(nearest);
        if(distance<=bestDistance) { bestDistance=distance; best=wire.connection.id; }
    }
    return best;
}

std::optional<std::pair<FxConnectionId,std::size_t>> FxCanvas::layoutPointAt(juce::Point<float> p) const noexcept {
    const float radius=std::max(pointHitRadius,pointHitRadius/std::max(0.1f,page_.graphZoom()));
    for(const auto& wire:wires_)
        for(std::size_t i=0;i<wire.handles.size();++i)
            if(p.getDistanceFrom(wire.handles[i])<=radius) return std::make_pair(wire.connection.id,i);
    return std::nullopt;
}

std::size_t FxCanvas::layoutInsertIndex(FxConnectionId id,juce::Point<float> p) const noexcept {
    for(const auto& wire:wires_) {
        if(wire.connection.id!=id) continue;
        std::vector<juce::Point<float>> pts{portInCanvas(wire.connection.from.node,false,wire.connection.from.port)};
        pts.insert(pts.end(),wire.handles.begin(),wire.handles.end());
        pts.push_back(portInCanvas(wire.connection.to.node,true,wire.connection.to.port));
        std::size_t best=0;
        float bestDistance=std::numeric_limits<float>::max();
        for(std::size_t i=0;i+1<pts.size();++i) {
            juce::Point<float> nearest;
            const float d=juce::Line<float>(pts[i],pts[i+1]).getDistanceFromPoint(p,nearest);
            if(d<bestDistance) { bestDistance=d; best=i; }
        }
        return best;
    }
    return 0;
}

void FxCanvas::nodeMoved(FxNodeId id) {
    for(auto& wire:wires_) {
        if(wire.connection.from.node!=id && wire.connection.to.node!=id) continue;
        repaint(wire.area);
        computeWire(wire);
        repaint(wire.area);
    }
}

void FxCanvas::beginWire(FxNodeId id,std::uint8_t port) {
    wireActive_=true;
    wireFrom_={id,port};
    wireEnd_=portInCanvas(id,false,port);
    for(auto& [nodeId,node]:nodes_) node->repaint(); // highlight compatible inputs
}

void FxCanvas::dragWire(juce::Point<int> p) {
    const auto start=portInCanvas(wireFrom_.node,false,wireFrom_.port);
    repaint(curve(start,wireEnd_).getBounds().getSmallestIntegerContainer().expanded(6));
    wireEnd_=p.toFloat();
    repaint(curve(start,wireEnd_).getBounds().getSmallestIntegerContainer().expanded(6));
}

void FxCanvas::cancelWire() {
    if(!wireActive_) return;
    wireActive_=false;
    for(auto& [id,node]:nodes_) node->repaint();
    repaint();
}

void FxCanvas::endWire(juce::Point<int> p) {
    if(!wireActive_) return;
    const auto from=wireFrom_;
    cancelWire();
    // The graph is only mutated once a valid input port receives the cable;
    // empty canvas or an invalid port cancels cleanly.
    for(const auto& [id,node]:nodes_) {
        if(!node->getBounds().expanded(20).contains(p)) continue;
        const auto port=node->portAt((p-node->getPosition()).toFloat());
        if(port && port->first) { page_.connectPorts(from,{id,port->second}); return; }
    }
}

void FxCanvas::paint(juce::Graphics& g) {
    g.fillAll(juce::Colour(0xff0a0a0a));
    const auto clip=g.getClipBounds();
    const int grid=page_.graphZoom()<0.6f ? 48 : 24;
    g.setColour(Palette::borderSoft().withAlpha(.55f));
    for(int y=(clip.getY()/grid)*grid;y<clip.getBottom();y+=grid)
        for(int x=(clip.getX()/grid)*grid;x<clip.getRight();x+=grid)
            g.fillRect(x,y,1,1);

    for(const auto& wire:wires_) {
        if(!wire.area.intersects(clip)) continue;
        g.setColour(signalShade(.9f,.10f));
        g.strokePath(wire.path,juce::PathStrokeType(4.5f));
        g.setColour(signalShade(.95f,.88f));
        g.strokePath(wire.path,juce::PathStrokeType(1.5f));
        g.setColour(signalSourceColour());
        for(const auto& end:{wire.path.getPointAlongPath(0.0f),wire.path.getPointAlongPath(wire.path.getLength())})
            g.fillEllipse(juce::Rectangle<float>(5.0f,5.0f).withCentre(end));
        for(std::size_t i=0;i<wire.handles.size();++i) {
            const bool active=(hoverPoint_ && hoverPoint_->first==wire.connection.id && hoverPoint_->second==i)
                           || (dragPoint_ && dragPoint_->first==wire.connection.id && dragPoint_->second==i);
            const float radius=active ? 5.5f : 4.5f;
            auto dot=juce::Rectangle<float>(radius*2.0f,radius*2.0f).withCentre(wire.handles[i]);
            g.setColour(Palette::inset());
            g.fillEllipse(dot);
            g.setColour(active ? signalSourceColour() : Palette::accent().withAlpha(.85f));
            g.drawEllipse(dot,1.3f);
        }
    }
    if(wireActive_) {
        auto pending=curve(portInCanvas(wireFrom_.node,false,wireFrom_.port),wireEnd_);
        juce::Path dashed;
        const float dashes[]{5.0f,4.0f};
        juce::PathStrokeType(1.3f).createDashedStroke(dashed,pending,dashes,2);
        g.setColour(Palette::accent().withAlpha(.8f));
        g.fillPath(dashed);
    }
}

void FxCanvas::showConnectionMenu(FxConnectionId id,juce::Point<float> at) {
    const auto* connection=page_.graph().findConnection(id);
    if(connection==nullptr) return;
    auto items=page_.moduleMenuItems(false);
    for(auto& item:items) item.group="INSERT MODULE / "+item.group;
    constexpr int addPoint=3001,resetRouting=3002,removeConnection=3003;
    items.push_back({addPoint,"Add Routing Point",true,"CONNECTION"});
    items.push_back({resetRouting,"Reset Routing",!connection->layout.empty(),"CONNECTION"});
    items.push_back({removeConnection,"Remove Connection",true,"CONNECTION"});
    juce::Component::SafePointer<FxPage> page(&page_);
    const auto graphAt=toGraph(at);
    const auto pointIndex=layoutInsertIndex(id,at);
    showNativeChoiceMenu(*this,"CONNECTION",items,0,[page,id,graphAt,pointIndex](int choice) {
        if(page==nullptr) return;
        if(choice==addPoint) { page->document().edit([&](FxGraph& g){return g.addLayoutPoint(id,pointIndex,graphAt)==FxEditResult::Ok;}); page->syncFromModel(); return; }
        if(choice==resetRouting) { page->resetConnectionRouting(id); return; }
        if(choice==removeConnection) { page->removeConnection(id); return; }
        if(const auto spec=FxModuleMenu::decode(choice)) page->insertModuleOnConnection(id,*spec,graphAt);
    });
}

void FxCanvas::mouseDown(const juce::MouseEvent& e) {
    page_.grabKeyboardFocus();
    const auto position=e.position;
    if(e.mods.isMiddleButtonDown()) {
        panning_=true;
        panMouseStart_=e.getEventRelativeTo(&page_.graphView()).position;
        panViewStart_=page_.graphView().pan();
        return;
    }
    if(const auto point=layoutPointAt(position)) {
        if(e.mods.isPopupMenu()) {
            juce::Component::SafePointer<FxPage> page(&page_);
            const auto target=*point;
            showNativeChoiceMenu(*this,"ROUTING POINT",{
                {1,"Remove Routing Point",true,"ROUTING"},
                {2,"Reset Routing",true,"ROUTING"}},0,[page,target](int choice) {
                if(page==nullptr) return;
                if(choice==1) page->removeLayoutPoint(target.first,target.second);
                if(choice==2) page->resetConnectionRouting(target.first);
            });
            return;
        }
        dragPoint_=point;
        return;
    }
    if(e.mods.isPopupMenu()) {
        if(const auto wire=connectionAt(position)) { showConnectionMenu(*wire,position); return; }
        // Right-click empty space: the SAME module catalog, created at the click.
        const auto at=toGraph(position);
        juce::Component::SafePointer<FxPage> page(&page_);
        page_.showModuleMenu(*this,true,[page,at](FxModuleSpec spec){if(page!=nullptr) page->addModuleAt(spec,at);});
        return;
    }
    page_.selectNode(invalidFxNodeId);
    panning_=true;
    panMouseStart_=e.getEventRelativeTo(&page_.graphView()).position;
    panViewStart_=page_.graphView().pan();
}

void FxCanvas::mouseDrag(const juce::MouseEvent& e) {
    if(dragPoint_) {
        page_.moveLayoutPoint(dragPoint_->first,dragPoint_->second,toGraph(e.position),true);
        return;
    }
    if(panning_) {
        auto& view=page_.graphView();
        const auto now=e.getEventRelativeTo(&view).position;
        view.setView(view.zoom(),panViewStart_-(now-panMouseStart_));
    }
}

void FxCanvas::mouseUp(const juce::MouseEvent& e) {
    if(dragPoint_) {
        page_.moveLayoutPoint(dragPoint_->first,dragPoint_->second,toGraph(e.position),false);
        dragPoint_.reset();
        repaint();
    }
    panning_=false;
}

void FxCanvas::mouseMove(const juce::MouseEvent& e) {
    const auto hover=layoutPointAt(e.position);
    if(hover!=hoverPoint_) { hoverPoint_=hover; repaint(); }
    setMouseCursor(hover ? juce::MouseCursor::DraggingHandCursor
                   : connectionAt(e.position) ? juce::MouseCursor::PointingHandCursor
                                              : juce::MouseCursor::NormalCursor);
}

void FxCanvas::mouseExit(const juce::MouseEvent&) {
    if(hoverPoint_) { hoverPoint_.reset(); repaint(); }
}

void FxCanvas::mouseDoubleClick(const juce::MouseEvent& e) {
    if(layoutPointAt(e.position)) return;
    if(const auto wire=connectionAt(e.position)) page_.addLayoutPoint(*wire,toGraph(e.position));
}

bool FxCanvas::isInterestedInDragSource(const SourceDetails& details) {
    return details.description.toString().startsWith(moduleDragPrefix);
}

void FxCanvas::itemDropped(const SourceDetails& details) {
    const int id=details.description.toString().fromFirstOccurrenceOf(moduleDragPrefix,false,false).getIntValue();
    if(const auto spec=FxModuleMenu::decode(id)) page_.addModuleAt(*spec,toGraph(details.localPosition.toFloat()));
}

// ================================================================ graph view

FxGraphView::FxGraphView(FxCanvas& canvas):canvas_(canvas) {
    addAndMakeVisible(canvas_);
    for(auto* bar:{&horizontal_,&vertical_}) {
        addAndMakeVisible(*bar);
        bar->addListener(this);
        bar->setAutoHide(false);
    }
}

FxGraphView::~FxGraphView() {
    horizontal_.removeListener(this);
    vertical_.removeListener(this);
}

juce::Rectangle<int> FxGraphView::viewport() const noexcept {
    return getLocalBounds().withTrimmedRight(10).withTrimmedBottom(10);
}

juce::Point<float> FxGraphView::graphToView(FxPoint p) const noexcept {
    return {p.x*zoom_-pan_.x,p.y*zoom_-pan_.y};
}

FxPoint FxGraphView::viewToGraph(juce::Point<float> p) const noexcept {
    return {(p.x+pan_.x)/zoom_,(p.y+pan_.y)/zoom_};
}

void FxGraphView::setView(float zoom,juce::Point<float> pan) {
    zoom_=std::isfinite(zoom) ? juce::jlimit(minZoom,maxZoom,zoom) : 1.0f;
    pan_=pan;
    apply();
}

void FxGraphView::zoomAround(float zoom,juce::Point<float> anchor) {
    // Keep the graph point under the pointer under the pointer.
    const auto g=viewToGraph(anchor);
    zoom_=juce::jlimit(minZoom,maxZoom,zoom);
    pan_={g.x*zoom_-anchor.x,g.y*zoom_-anchor.y};
    apply();
}

void FxGraphView::panBy(juce::Point<float> delta) {
    pan_+=delta;
    apply();
}

void FxGraphView::fitTo(juce::Rectangle<int> graphBounds) {
    if(graphBounds.isEmpty()) return;
    const auto area=viewport().toFloat();
    const auto content=graphBounds.toFloat().expanded(40.0f);
    zoom_=juce::jlimit(minZoom,maxZoom,std::min(area.getWidth()/content.getWidth(),area.getHeight()/content.getHeight()));
    pan_={content.getCentreX()*zoom_-area.getWidth()*0.5f,content.getCentreY()*zoom_-area.getHeight()*0.5f};
    apply();
}

void FxGraphView::contentChanged() { apply(); }

void FxGraphView::apply() {
    const auto area=viewport();
    const float width=float(canvas_.getWidth())*zoom_,height=float(canvas_.getHeight())*zoom_;
    pan_.x=juce::jlimit(0.0f,std::max(0.0f,width-float(area.getWidth())),pan_.x);
    pan_.y=juce::jlimit(0.0f,std::max(0.0f,height-float(area.getHeight())),pan_.y);
    canvas_.setTransform(juce::AffineTransform::scale(zoom_).translated(-pan_.x,-pan_.y));
    const juce::ScopedValueSetter<bool> guard(updating_,true);
    horizontal_.setRangeLimits(0.0,std::max<double>(width,area.getWidth()));
    horizontal_.setCurrentRange(pan_.x,area.getWidth());
    vertical_.setRangeLimits(0.0,std::max<double>(height,area.getHeight()));
    vertical_.setCurrentRange(pan_.y,area.getHeight());
    if(onViewChanged) onViewChanged();
}

void FxGraphView::resized() {
    auto area=getLocalBounds();
    vertical_.setBounds(area.removeFromRight(10).withTrimmedBottom(10));
    horizontal_.setBounds(area.removeFromBottom(10));
    apply();
}

void FxGraphView::scrollBarMoved(juce::ScrollBar* bar,double start) {
    if(updating_) return;
    if(bar==&horizontal_) pan_.x=float(start); else pan_.y=float(start);
    apply();
}

void FxGraphView::mouseWheelMove(const juce::MouseEvent& e,const juce::MouseWheelDetails& wheel) {
    const auto at=e.getEventRelativeTo(this).position;
    if(e.mods.isCommandDown() || e.mods.isCtrlDown()) {
        zoomAround(zoom_*std::exp(wheel.deltaY*1.6f),at);
        return;
    }
    constexpr float speed=420.0f;
    if(e.mods.isShiftDown()) panBy({-wheel.deltaY*speed,0.0f});
    else panBy({-wheel.deltaX*speed,-wheel.deltaY*speed});
}

void FxGraphView::mouseMagnify(const juce::MouseEvent& e,float scaleFactor) {
    zoomAround(zoom_*scaleFactor,e.getEventRelativeTo(this).position);
}

// ================================================================ sidebar

class FxSidebar::List final : public juce::Component {
public:
    explicit List(FxSidebar& owner):owner_(owner) {}
    void paint(juce::Graphics& g) override {
        const auto& rows=owner_.rows(owner_.tab());
        for(std::size_t i=0;i<rows.size();++i) {
            const auto& row=rows[i];
            auto r=rowBounds(i);
            if(row.header) {
                text(g,row.label,r.withTrimmedTop(12),8.5f,Palette::muted());
                continue;
            }
            const bool hover=int(i)==hover_ && row.enabled && (row.onClick || row.dragDescription.isNotEmpty());
            g.setColour(!row.enabled ? Palette::inset() : hover ? Palette::raised().brighter(.08f) : Palette::raised());
            g.fillRect(r);
            g.setColour(row.active ? signalShade(.75f,.9f) : row.enabled ? Palette::border() : Palette::borderSoft());
            g.drawRect(r);
            auto inner=r.reduced(10,0);
            if(row.dragDescription.isNotEmpty() && row.enabled) {
                auto grip=inner.removeFromLeft(10).toFloat();
                g.setColour(Palette::muted().withAlpha(.6f));
                for(int k=0;k<3;++k) for(int c=0;c<2;++c)
                    g.fillEllipse(grip.getX()+float(c)*4.0f,grip.getCentreY()-5.0f+float(k)*4.5f,2.0f,2.0f);
                inner.removeFromLeft(4);
            }
            if(row.active) {
                g.setColour(signalSourceColour());
                g.fillEllipse(juce::Rectangle<float>(6.0f,6.0f).withCentre({float(r.getRight()-12),float(r.getCentreY())}));
            }
            const auto colour=row.enabled ? Palette::text() : Palette::muted().withAlpha(.65f);
            if(row.detail.isNotEmpty()) {
                text(g,row.label,inner.withHeight(r.getHeight()/2+2).withY(r.getY()+3),10.5f,colour);
                text(g,row.detail,inner.withTrimmedTop(r.getHeight()/2+1),8.0f,Palette::muted());
            } else {
                text(g,row.label,inner,10.5f,colour);
            }
            if(row.badge.isNotEmpty())
                text(g,row.badge,inner.withTrimmedRight(row.active ? 14 : 0),8.0f,Palette::muted(),juce::Justification::centredRight);
        }
    }
    void mouseMove(const juce::MouseEvent& e) override {
        const int index=indexAt(e.getPosition());
        if(index!=hover_) { hover_=index; repaint(); }
    }
    void mouseExit(const juce::MouseEvent&) override { hover_=-1; repaint(); }
    void mouseDown(const juce::MouseEvent& e) override { pressed_=indexAt(e.getPosition()); dragged_=false; }
    void mouseDrag(const juce::MouseEvent& e) override {
        if(pressed_<0 || dragged_ || e.getDistanceFromDragStart()<6) return;
        const auto& row=owner_.rows(owner_.tab())[std::size_t(pressed_)];
        if(row.dragDescription.isEmpty() || !row.enabled) return;
        if(auto* container=juce::DragAndDropContainer::findParentDragContainerFor(this)) {
            dragged_=true;
            juce::Image image(juce::Image::ARGB,180,30,true);
            {
                juce::Graphics g(image);
                g.setColour(Palette::raised());
                g.fillRect(0,0,180,30);
                g.setColour(signalShade(.8f,.9f));
                g.drawRect(0,0,180,30);
                text(g,row.label,{10,0,160,30},10.5f,Palette::text());
            }
            container->startDragging(row.dragDescription,this,juce::ScaledImage(image));
        }
    }
    void mouseUp(const juce::MouseEvent& e) override {
        const int index=indexAt(e.getPosition());
        if(!dragged_ && index>=0 && index==pressed_) {
            const auto& row=owner_.rows(owner_.tab())[std::size_t(index)];
            if(row.enabled && row.onClick) row.onClick();
        }
        pressed_=-1;
    }
    int contentHeight() const { return int(owner_.rows(owner_.tab()).size())*rowHeight+8; }
private:
    juce::Rectangle<int> rowBounds(std::size_t i) const { return {0,int(i)*rowHeight,getWidth(),rowHeight-4}; }
    int indexAt(juce::Point<int> p) const {
        const auto& rows=owner_.rows(owner_.tab());
        for(std::size_t i=0;i<rows.size();++i) if(!rows[i].header && rowBounds(i).contains(p)) return int(i);
        return -1;
    }
    FxSidebar& owner_;
    int hover_=-1,pressed_=-1;
    bool dragged_=false;
};

FxSidebar::FxSidebar():list_(std::make_unique<List>(*this)) {
    const char* names[]{"SOURCES","MODULATORS","FILTERS","ROUTES"};
    for(int i=0;i<4;++i) {
        auto& tab=tabs_[std::size_t(i)];
        tab.setButtonText(names[i]);
        tab.setClickingTogglesState(true);
        tab.setRadioGroupId(0x46534231);
        tab.setToggleState(i==0,juce::dontSendNotification);
        tab.setName(juce::String("FX sidebar ")+names[i]);
        tab.onClick=[this,i]{if(tabs_[std::size_t(i)].getToggleState()) { setTab(static_cast<Tab>(i)); if(onTabChanged) onTabChanged(tab_); }};
        addAndMakeVisible(tab);
    }
    viewport_.setViewedComponent(list_.get(),false);
    viewport_.setScrollBarsShown(true,false);
    viewport_.setScrollBarThickness(8);
    addAndMakeVisible(viewport_);
}

FxSidebar::~FxSidebar() { viewport_.setViewedComponent(nullptr,false); }

void FxSidebar::setTab(Tab tab) {
    tab_=tab;
    for(int i=0;i<4;++i) tabs_[std::size_t(i)].setToggleState(i==static_cast<int>(tab),juce::dontSendNotification);
    resized();
    list_->repaint();
}

void FxSidebar::setRows(Tab tab,std::vector<Row> rows) {
    juce::String signature;
    for(const auto& r:rows) signature<<r.label<<"|"<<r.badge<<"|"<<int(r.active)<<int(r.enabled)<<";";
    const bool changed=signature!=signatures_[static_cast<std::size_t>(tab)];
    signatures_[static_cast<std::size_t>(tab)]=signature;
    rows_[static_cast<std::size_t>(tab)]=std::move(rows); // fresh callbacks either way
    if(changed && tab==tab_) { resized(); list_->repaint(); }
}

void FxSidebar::resized() {
    auto area=getLocalBounds().reduced(10,10);
    auto tabs=area.removeFromTop(60);
    // Two rows of two: generous, readable segmented tabs.
    const int half=tabs.getWidth()/2;
    auto top=tabs.removeFromTop(28),bottom=tabs.withTrimmedTop(4);
    tabs_[0].setBounds(top.removeFromLeft(half).reduced(1,0));
    tabs_[1].setBounds(top.reduced(1,0));
    tabs_[2].setBounds(bottom.removeFromLeft(half).reduced(1,0));
    tabs_[3].setBounds(bottom.reduced(1,0));
    area.removeFromTop(6);
    viewport_.setBounds(area);
    list_->setSize(area.getWidth()-10,std::max(area.getHeight(),list_->contentHeight()));
}

void FxSidebar::paint(juce::Graphics& g) {
    g.fillAll(Palette::panel());
    g.setColour(Palette::borderSoft());
    g.drawVerticalLine(getWidth()-1,0.0f,float(getHeight()));
}

// ================================================================ modal / global FX

FxModalOverlay::FxModalOverlay() {
    setWantsKeyboardFocus(true);
    setVisible(false);
}

void FxModalOverlay::show(juce::Component& content,juce::Rectangle<int> panelSize) {
    if(content_!=nullptr && content_!=&content) removeChildComponent(content_);
    content_=&content;
    panelSize_=panelSize;
    addAndMakeVisible(content);
    setVisible(true);
    toFront(true);
    resized();
    grabKeyboardFocus();
}

void FxModalOverlay::dismiss() {
    if(!isVisible()) return;
    setVisible(false);
    if(onDismissed) onDismissed();
}

void FxModalOverlay::resized() {
    if(content_!=nullptr) content_->setBounds(panelSize_.withCentre(getLocalBounds().getCentre()));
}

void FxModalOverlay::paint(juce::Graphics& g) { g.fillAll(juce::Colours::black.withAlpha(.55f)); }

void FxModalOverlay::mouseDown(const juce::MouseEvent& e) {
    if(content_==nullptr || !content_->getBounds().contains(e.getPosition())) dismiss();
}

bool FxModalOverlay::keyPressed(const juce::KeyPress& key) {
    if(key==juce::KeyPress::escapeKey) { dismiss(); return true; }
    return false;
}

FxGlobalFxEditor::FxGlobalFxEditor(FxGraphDocument& document):document_(document) {
    const char* names[]{"INPUT","DRY/WET","WIDTH","OUTPUT"};
    const double lo[]{-24.0,0.0,0.0,-24.0},hi[]{24.0,1.0,2.0,24.0},defaults[]{0.0,1.0,1.0,0.0};
    for(std::size_t i=0;i<knobs_.size();++i) {
        auto& k=knobs_[i];
        configureKnob(k);
        k.setRange(lo[i],hi[i],0.001);
        k.setName(juce::String("FX Global ")+names[i]);
        k.getProperties().set("mct.origami.knobDefault",defaults[i]);
        k.onDragStart=[this]{document_.beginGesture();gesture_=true;};
        k.onDragEnd=[this]{gesture_=false;document_.endGesture();};
        k.onValueChange=[this]{commit();};
        addAndMakeVisible(k);
    }
    order_.addItem("POST MASTER",int(FxOrder::PostMaster));
    order_.addItem("PRE MASTER",int(FxOrder::PreMaster));
    bypass_.addItem("CROSSFADE",int(FxBypassMode::Crossfade));
    bypass_.addItem("HARD",int(FxBypassMode::Hard));
    bypass_.addItem("TAIL PRESERVE",int(FxBypassMode::TailPreserve));
    order_.setName("FX Global order");
    bypass_.setName("FX Global bypass mode");
    for(auto* c:{&order_,&bypass_}) { c->onChange=[this]{commit();}; addAndMakeVisible(c); }
    close_.setName("FX Global close");
    close_.onClick=[this]{if(onClose) onClose();};
    addAndMakeVisible(close_);
    sync();
}

void FxGlobalFxEditor::sync() {
    const juce::ScopedValueSetter<bool> guard(syncing_,true);
    const auto& s=document_.graph().globals();
    const float values[]{s.inputGainDb,s.dryWet,s.width,s.outputGainDb};
    for(std::size_t i=0;i<knobs_.size();++i)
        if(!knobs_[i].isMouseButtonDown()) knobs_[i].setValue(values[i],juce::dontSendNotification);
    order_.setSelectedId(int(s.order),juce::dontSendNotification);
    bypass_.setSelectedId(int(s.bypass),juce::dontSendNotification);
    repaint();
}

void FxGlobalFxEditor::commit() {
    if(syncing_) return;
    FxGlobalSettings s;
    s.inputGainDb=float(knobs_[0].getValue());
    s.dryWet=float(knobs_[1].getValue());
    s.width=float(knobs_[2].getValue());
    s.outputGainDb=float(knobs_[3].getValue());
    s.order=static_cast<FxOrder>(order_.getSelectedId());
    s.bypass=static_cast<FxBypassMode>(bypass_.getSelectedId());
    const auto apply=[&](FxGraph& g){g.setGlobals(s);return true;};
    if(gesture_) document_.gestureEdit(apply); else document_.edit(apply);
    repaint();
}

void FxGlobalFxEditor::resized() {
    auto area=getLocalBounds().reduced(18,12);
    close_.setBounds(area.removeFromTop(28).removeFromRight(32));
    area.removeFromTop(26);
    auto knobs=area.removeFromTop(104).withTrimmedBottom(34);
    const int width=knobs.getWidth()/4;
    for(auto& k:knobs_) k.setBounds(knobs.removeFromLeft(width).withSizeKeepingCentre(52,52));
    area.removeFromTop(12);
    order_.setBounds(area.removeFromTop(28).withTrimmedLeft(130).withWidth(190));
    area.removeFromTop(30);
    bypass_.setBounds(area.removeFromTop(28).withTrimmedLeft(130).withWidth(190));
}

void FxGlobalFxEditor::paint(juce::Graphics& g) {
    const auto& s=document_.graph().globals();
    g.fillAll(Palette::panel());
    g.setColour(Palette::border());
    g.drawRect(getLocalBounds());
    auto area=getLocalBounds().reduced(18,12);
    text(g,"GLOBAL FX",area.removeFromTop(28),13.0f,Palette::text());
    text(g,"INPUT  >  FX GRAPH  >  DRY/WET  >  WIDTH  >  OUTPUT",area.removeFromTop(26),8.5f,Palette::muted());
    auto knobs=area.removeFromTop(104);
    auto values=knobs.removeFromBottom(16),labels=knobs.removeFromBottom(18);
    const int width=labels.getWidth()/4;
    const juce::String texts[]{juce::String(s.inputGainDb,1)+" dB",juce::String(juce::roundToInt(s.dryWet*100))+"%",
                               juce::String(juce::roundToInt(s.width*100))+"%",juce::String(s.outputGainDb,1)+" dB"};
    int i=0;
    for(const char* n:{"INPUT","DRY/WET","WIDTH","OUTPUT"}) {
        text(g,n,labels.removeFromLeft(width),9.5f,Palette::muted(),juce::Justification::centred);
        text(g,texts[i++],values.removeFromLeft(width),9.5f,Palette::secondary(),juce::Justification::centred);
    }
    area.removeFromTop(12);
    text(g,"FX ORDER",area.removeFromTop(28),10.0f,Palette::secondary());
    text(g,s.order==FxOrder::PreMaster ? "Voices > FX graph > master gain (drive/limit before volume)."
                                       : "Voices > master gain > FX graph.",area.removeFromTop(24),8.5f,Palette::muted());
    area.removeFromTop(6);
    text(g,"BYPASS MODE",area.removeFromTop(28),10.0f,Palette::secondary());
    text(g,s.bypass==FxBypassMode::Hard ? "Effect PWR switches instantly."
         : s.bypass==FxBypassMode::TailPreserve ? "Bypassed effects stop taking input; delay/reverb tails ring out."
                                                : "Effect PWR crossfades over 10 ms.",area.removeFromTop(24),8.5f,Palette::muted());
}

// ================================================================ inspector

class FxPage::SelectedPanel final : public Panel {
public:
    explicit SelectedPanel(FxPage& page):Panel("SELECTED EFFECT"),page_(page) {
        for(auto* b:{&power_,&remove_}) addChildComponent(b);
        power_.setClickingTogglesState(true);
        power_.setName("Power FX inspector");
        power_.onClick=[this]{if(node_) page_.setNodeEnabled(node_->id,power_.getToggleState());};
        remove_.onClick=[this]{if(node_) page_.deleteNode(node_->id);};
    }
    juce::String headline() const { return node_ ? juce::String(node_->name) : juce::String("NO NODE SELECTED"); }
    void show(const FxGraph& graph,FxNodeId id) {
        const auto* node=graph.findNode(id);
        if(node!=nullptr) node_=*node; else node_.reset();
        std::vector<const FxParameterDescriptor*> params;
        if(node_)
            for(const auto* p:parametersFor(*node_,false,FxParameterPage::Main))
                if(p->curve!=FxParameterCurve::Choice && params.size()<5) params.push_back(p);
        std::vector<FxParameterId> ids;
        for(const auto* p:params) ids.push_back(p->id);
        if(ids!=ids_ || shownId_!=id) {
            knobs_.clear();
            ids_=ids;
            shownId_=id;
            for(const auto* p:params) {
                const auto pid=p->id;
                auto knob=std::make_unique<juce::Slider>();
                configureKnob(*knob);
                knob->setRange(0.0,1.0,0.001);
                knob->setName("FX inspector P"+juce::String(pid));
                tagModulationDestination(*knob,id,*p);
                auto* raw=knob.get();
                knob->onDragStart=[this]{page_.beginParameterGesture();};
                knob->onDragEnd=[this]{page_.endParameterGesture();};
                knob->onValueChange=[this,raw,pid]{if(node_) page_.setParameter(node_->id,pid,float(raw->getValue()));};
                addAndMakeVisible(*knob);
                knobs_.push_back(std::move(knob));
            }
        }
        params_=params;
        for(std::size_t i=0;i<knobs_.size();++i)
            if(!knobs_[i]->isMouseButtonDown())
                knobs_[i]->setValue(node_->parameter(ids_[i]).value_or(0.0f),juce::dontSendNotification);
        const bool effect=node_ && node_->kind==FxNodeKind::Effect;
        power_.setVisible(effect);
        power_.setToggleState(effect && node_->enabled,juce::dontSendNotification);
        remove_.setVisible(node_ && (effect || node_->isRouting()));
        resized();
        repaint();
    }
    void resized() override {
        auto area=contentBounds().reduced(12,6).withTrimmedTop(6);
        auto row=area.removeFromTop(26);
        power_.setBounds(row.removeFromLeft(42));
        remove_.setBounds(row.removeFromRight(30));
        area.removeFromTop(6);
        area.removeFromTop(60);
        area.removeFromTop(4);
        auto knobs=area.withTrimmedBottom(30);
        const int width=knobs.getWidth()/juce::jmax<int>(1,int(knobs_.size()));
        for(auto& knob:knobs_) knob->setBounds(knobs.removeFromLeft(width).withSizeKeepingCentre(48,48));
    }
private:
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(12,6).withTrimmedTop(6);
        if(!node_) {
            text(g,"NO NODE SELECTED",area.withTrimmedBottom(area.getHeight()/2),11.0f,Palette::secondary(),juce::Justification::centredBottom);
            text(g,"Select a module in the routing canvas to edit it here.",area.withTrimmedTop(area.getHeight()/2+4),9.0f,Palette::muted(),juce::Justification::centredTop);
            return;
        }
        auto row=area.removeFromTop(26);
        const bool effect=node_->kind==FxNodeKind::Effect;
        text(g,node_->name,row.withTrimmedLeft(effect ? 52 : 0).withTrimmedRight(36),12.0f,Palette::text());
        text(g,kindLabel(node_->kind),row.withTrimmedRight(38),8.5f,Palette::muted(),juce::Justification::centredRight);
        area.removeFromTop(6);
        auto display=area.removeFromTop(60);
        if(effect) {
            paintEffectPreview(g,display.toFloat(),*node_);
            area.removeFromTop(4);
            auto values=area.removeFromBottom(14);
            auto labels=area.removeFromBottom(14);
            const int width=labels.getWidth()/juce::jmax(1,int(params_.size()));
            for(const auto* p:params_) {
                text(g,p->label,labels.removeFromLeft(width),9.0f,Palette::muted(),juce::Justification::centred);
                text(g,valueText(*node_,*p),values.removeFromLeft(width),9.0f,Palette::secondary(),juce::Justification::centred);
            }
            return;
        }
        well(g,display);
        auto lines=display.reduced(10,6);
        const auto line=[&](const juce::String& s,juce::Colour c){text(g,s,lines.removeFromTop(16),9.0f,c);};
        line(juce::String(node_->ports.inputs)+" INPUT"+(node_->ports.inputs==1?"":"S")+"  /  "
             +juce::String(node_->ports.outputs)+" OUTPUT"+(node_->ports.outputs==1?"":"S"),Palette::secondary());
        switch(node_->kind) {
        case FxNodeKind::Split: line("Copies one signal into parallel branches.",Palette::muted()); break;
        case FxNodeKind::Merge: line("Averages its live branches (1/N): parallel paths stay at unity.",Palette::muted()); break;
        case FxNodeKind::Source: line("Named audio bus entering the FX environment.",Palette::muted()); break;
        case FxNodeKind::Output: line("Final instrument output, after GLOBAL FX.",Palette::muted()); break;
        case FxNodeKind::Effect: case FxNodeKind::Send: case FxNodeKind::Return: break;
        }
    }
    FxPage& page_;
    std::optional<FxNode> node_;
    FxNodeId shownId_=invalidFxNodeId;
    juce::TextButton power_{"PWR"},remove_{"X"};
    std::vector<std::unique_ptr<juce::Slider>> knobs_;
    std::vector<FxParameterId> ids_;
    std::vector<const FxParameterDescriptor*> params_;
};

class FxPage::ParametersPanel final : public Panel {
public:
    static constexpr int rowHeight=32;
    explicit ParametersPanel(FxPage& page,ModulationBindings bindings):Panel("EFFECT PARAMETERS"),page_(page),bindings_(std::move(bindings)) {
        const char* names[]{"MAIN","MODULATION","ADVANCED"};
        for(int i=0;i<3;++i) {
            auto& tab=tabs_[std::size_t(i)];
            tab.setButtonText(names[i]);
            tab.setClickingTogglesState(true);
            tab.setRadioGroupId(0x4658);
            tab.setToggleState(i==0,juce::dontSendNotification);
            tab.onClick=[this,i]{if(tabs_[std::size_t(i)].getToggleState()) selectTab(i);};
            addAndMakeVisible(tab);
        }
        viewport_.setViewedComponent(&rows_,false);
        viewport_.setScrollBarsShown(true,false);
        viewport_.setScrollBarThickness(8);
        addAndMakeVisible(viewport_);
    }
    ~ParametersPanel() override { viewport_.setViewedComponent(nullptr,false); }
    int tab() const noexcept { return tab_; }
    std::size_t modulationRows() const noexcept { return rows_.modulation.size(); }
    void selectTab(int index) {
        tab_=juce::jlimit(0,2,index);
        for(int i=0;i<3;++i) tabs_[std::size_t(i)].setToggleState(i==tab_,juce::dontSendNotification);
        show(page_.graph(),page_.selectedNode(),routes_);
    }
    void show(const FxGraph& graph,FxNodeId id,const std::array<ModRoute,ModulationState::capacity>& routes) {
        routes_=routes;
        const auto* node=graph.findNode(id);
        if(node!=nullptr) node_=*node; else node_.reset();
        // MODULATION rows: canonical routes whose destination is this node.
        std::vector<ModRoute> targeting;
        if(node_ && node_->kind==FxNodeKind::Effect)
            for(const auto& r:routes)
                if(r.id && isFxDestination(r.destination.parameter) && r.destination.oscillator==node_->id) targeting.push_back(r);
        std::vector<std::uint64_t> signature;
        for(const auto& r:targeting) signature.push_back((std::uint64_t(r.id)<<32)|(std::uint64_t(r.source)<<16)|fxAddressParameter(r.destination));
        if(shownId_!=id || shownTab_!=tab_ || (node_ && node_->effect!=shownEffect_) || (tab_==1 && signature!=modulationSignature_)) {
            shownId_=id;
            shownTab_=tab_;
            shownEffect_=node_ ? node_->effect : FxEffectType::None;
            modulationSignature_=signature;
            rebuild(targeting);
        }
        for(auto& e:rows_.entries) {
            const float v=node_->parameter(e.descriptor->id).value_or(e.descriptor->defaultValue);
            if(e.slider && !e.slider->isMouseButtonDown()) e.slider->setValue(v,juce::dontSendNotification);
            if(e.toggle) { e.toggle->setToggleState(v>=0.5f,juce::dontSendNotification); e.toggle->setButtonText(v>=0.5f ? "ON" : "OFF"); }
        }
        for(auto& m:rows_.modulation)
            for(const auto& r:targeting)
                if(r.id==m.route.id) { m.route=r; if(!m.amount->isMouseButtonDown()) m.amount->setValue(r.amount,juce::dontSendNotification); }
        rows_.node=node_;
        rows_.tab=tab_;
        resized();
        rows_.repaint();
    }
    void resized() override {
        auto area=contentBounds().reduced(12,6).withTrimmedTop(6);
        auto tabs=area.removeFromTop(28);
        for(auto& tab:tabs_) tab.setBounds(tabs.removeFromLeft(124).reduced(2,0));
        area.removeFromTop(8);
        viewport_.setBounds(area);
        const int width=area.getWidth()-10;
        const int lines=tab_==1 ? int(rows_.modulation.size())+2 : int(rows_.entries.size());
        rows_.setSize(width,juce::jmax(area.getHeight(),lines*rowHeight+4));
        for(std::size_t i=0;i<rows_.entries.size();++i) {
            auto row=juce::Rectangle<int>(0,int(i)*rowHeight,width,rowHeight).withTrimmedLeft(120).withTrimmedRight(96).reduced(0,6);
            if(rows_.entries[i].slider) rows_.entries[i].slider->setBounds(row);
            if(rows_.entries[i].toggle) rows_.entries[i].toggle->setBounds(row.withWidth(80));
        }
        for(std::size_t i=0;i<rows_.modulation.size();++i) {
            auto row=juce::Rectangle<int>(0,rowHeight+int(i)*rowHeight,width,rowHeight).reduced(0,4);
            auto& m=rows_.modulation[i];
            m.remove->setBounds(row.removeFromRight(30));
            row.removeFromRight(6);
            row.removeFromRight(56); // painted amount value
            row.removeFromLeft(130);
            m.source->setBounds(row.removeFromLeft(118));
            row.removeFromLeft(8);
            m.amount->setBounds(row.reduced(0,3));
        }
    }
private:
    struct Entry {
        const FxParameterDescriptor* descriptor=nullptr;
        std::unique_ptr<juce::Slider> slider;
        std::unique_ptr<juce::TextButton> toggle;
    };
    struct ModRow {
        ModRoute route;
        std::unique_ptr<juce::Slider> amount;
        std::unique_ptr<juce::TextButton> source,remove;
    };
    struct Rows final : public juce::Component {
        std::vector<Entry> entries;
        std::vector<ModRow> modulation;
        std::optional<FxNode> node;
        int tab=0;
        void paint(juce::Graphics& g) override {
            auto area=getLocalBounds();
            if(!node || node->kind!=FxNodeKind::Effect) {
                text(g,node ? "Routing and terminal nodes have no effect parameters." : "Select an effect module to edit its parameters.",
                     area.removeFromTop(26),9.5f,Palette::muted());
                return;
            }
            if(tab==1) {
                text(g,modulation.empty() ? "No modulation. Drag a modulator onto any knob, or right-click a knob > Assign Modulator."
                                          : "Routes from Origami's modulation system targeting this effect:",
                     area.removeFromTop(rowHeight),9.0f,Palette::muted());
                for(const auto& m:modulation) {
                    auto row=area.removeFromTop(rowHeight);
                    juce::String param="PARAM";
                    if(const auto* p=parameterDescriptor(*node,fxAddressParameter(m.route.destination))) param=p->label;
                    text(g,juce::String(node->name)+" / "+param,row.removeFromLeft(130),9.5f,Palette::secondary());
                    row.removeFromRight(36); // remove button
                    text(g,(m.route.amount>=0.0f?"+":"")+juce::String(m.route.amount,2),row.removeFromRight(52),9.5f,
                         Palette::secondary(),juce::Justification::centredRight);
                }
                return;
            }
            if(entries.empty()) { text(g,"No advanced parameters for this effect.",area.removeFromTop(26),9.5f,Palette::muted()); return; }
            for(const auto& e:entries) {
                auto line=area.removeFromTop(rowHeight);
                text(g,e.descriptor->label,line.removeFromLeft(114),10.0f,Palette::secondary());
                text(g,valueText(*node,*e.descriptor),line.removeFromRight(92),10.0f,Palette::muted(),juce::Justification::centredRight);
            }
        }
    };
    void rebuild(const std::vector<ModRoute>& targeting) {
        rows_.entries.clear();
        rows_.modulation.clear();
        if(!node_ || node_->kind!=FxNodeKind::Effect) return;
        const auto nodeId=node_->id;
        if(tab_==1) {
            for(const auto& route:targeting) {
                ModRow row{route,std::make_unique<juce::Slider>(),std::make_unique<juce::TextButton>(sourceName(route.source)),
                           std::make_unique<juce::TextButton>("X")};
                auto* amount=row.amount.get();
                amount->setSliderStyle(juce::Slider::LinearHorizontal);
                amount->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
                amount->setRange(-1.0,1.0,0.001);
                amount->setName("FX modulation amount "+juce::String(route.id));
                const auto routeId=route.id;
                amount->onValueChange=[this,amount,routeId]{updateRoute(routeId,[amount](ModRoute& r){r.amount=float(amount->getValue());});};
                row.source->setName("FX modulation source "+juce::String(route.id));
                auto* sourceButton=row.source.get();
                row.source->onClick=[this,sourceButton,routeId]{chooseSource(*sourceButton,routeId);};
                row.remove->setName("FX modulation remove "+juce::String(route.id));
                row.remove->onClick=[this,routeId] {
                    juce::Component::SafePointer<FxPage> page(&page_);
                    auto remove=bindings_.removeRoute;
                    juce::MessageManager::callAsync([page,remove,routeId]{if(remove) remove(routeId); if(page!=nullptr) page->syncFromModel();});
                };
                for(juce::Component* c:{static_cast<juce::Component*>(row.amount.get()),static_cast<juce::Component*>(row.source.get()),
                                        static_cast<juce::Component*>(row.remove.get())}) rows_.addAndMakeVisible(c);
                rows_.modulation.push_back(std::move(row));
            }
            return;
        }
        for(const auto* p:parametersFor(*node_,false,tab_==0 ? FxParameterPage::Main : FxParameterPage::Advanced)) {
            Entry entry;
            entry.descriptor=p;
            const auto pid=p->id;
            if(p->curve==FxParameterCurve::Choice) {
                entry.toggle=std::make_unique<juce::TextButton>("OFF");
                entry.toggle->setClickingTogglesState(true);
                entry.toggle->setName("FX parameter "+juce::String(p->key));
                auto* raw=entry.toggle.get();
                raw->onClick=[this,raw,pid,nodeId]{page_.setParameter(nodeId,pid,raw->getToggleState() ? 1.0f : 0.0f);};
                rows_.addAndMakeVisible(*raw);
            } else {
                entry.slider=std::make_unique<juce::Slider>();
                auto* raw=entry.slider.get();
                raw->setSliderStyle(juce::Slider::LinearHorizontal);
                raw->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
                raw->setRange(0.0,1.0,0.001);
                raw->setScrollWheelEnabled(false);
                raw->setName("FX parameter "+juce::String(p->key));
                tagModulationDestination(*raw,nodeId,*p);
                raw->onDragStart=[this]{page_.beginParameterGesture();};
                raw->onDragEnd=[this]{page_.endParameterGesture();};
                raw->onValueChange=[this,raw,pid,nodeId]{page_.setParameter(nodeId,pid,float(raw->getValue()));};
                rows_.addAndMakeVisible(*raw);
            }
            rows_.entries.push_back(std::move(entry));
        }
    }
    void updateRoute(std::uint32_t id,const std::function<void(ModRoute&)>& change) {
        for(auto& m:rows_.modulation) {
            if(m.route.id!=id) continue;
            change(m.route);
            if(bindings_.route) bindings_.route(m.route);
            rows_.repaint();
        }
    }
    void chooseSource(juce::TextButton& anchor,std::uint32_t id) {
        if(!bindings_.snapshot) return;
        const auto state=bindings_.snapshot();
        std::vector<NativeChoiceItem> items;
        for(const auto& s:availableSources(state.modulation)) items.push_back({int(s.source),sourceName(s.source),true,s.group});
        juce::Component::SafePointer<ParametersPanel> safe(this);
        showNativeChoiceMenu(anchor,"SOURCE",items,0,[safe,id](int choice) {
            if(safe==nullptr || choice<=0) return;
            const auto source=static_cast<ModSource>(choice);
            for(const auto& r:safe->routes_)
                for(auto& m:safe->rows_.modulation)
                    if(m.route.id==id && r.id && r.id!=id && r.source==source && r.destination==m.route.destination) return; // no duplicates
            safe->updateRoute(id,[source](ModRoute& r){r.source=source;r.bipolar=source>=ModSource::Lfo1 && source<=ModSource::Lfo4;});
            safe->page_.syncFromModel();
        });
    }
    FxPage& page_;
    ModulationBindings bindings_;
    std::optional<FxNode> node_;
    std::array<ModRoute,ModulationState::capacity> routes_{};
    std::array<juce::TextButton,3> tabs_;
    juce::Viewport viewport_;
    Rows rows_;
    int tab_=0,shownTab_=-1;
    FxNodeId shownId_=0xffffffffu;
    FxEffectType shownEffect_=FxEffectType::None;
    std::vector<std::uint64_t> modulationSignature_;
};

class FxPage::FxMacrosPanel final : public Panel {
public:
    explicit FxMacrosPanel(ModulationBindings bindings):Panel("MACROS"),bindings_(std::move(bindings)) {
        for(std::size_t i=0;i<sliders_.size();++i) {
            auto& s=sliders_[i];
            configureKnob(s);
            s.setRange(0.0,1.0,0.001);
            s.setName("FX Macro "+juce::String(int(i)+1));
            // The same four canonical macros the synth page uses: no second engine.
            s.onValueChange=[this,i]{if(bindings_.macro) bindings_.macro(unsigned(i),float(sliders_[i].getValue()));};
            addAndMakeVisible(s);
        }
    }
    void sync(const InstrumentState& state) {
        for(std::size_t i=0;i<sliders_.size();++i)
            if(!sliders_[i].isMouseButtonDown()) sliders_[i].setValue(state.modulation.macros[i],juce::dontSendNotification);
    }
    void resized() override {
        auto area=contentBounds().reduced(12,6).withTrimmedTop(26);
        const int cell=area.getWidth()/4;
        for(std::size_t i=0;i<sliders_.size();++i)
            sliders_[i].setBounds(juce::Rectangle<int>(area.getX()+int(i)*cell,area.getY(),cell,area.getHeight()).withTrimmedBottom(40).withSizeKeepingCentre(52,52));
    }
private:
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(12,6).withTrimmedTop(6);
        text(g,"SHARED WITH SYNTH MACROS  /  MODULATION SOURCES",area.removeFromTop(18),8.5f,Palette::muted());
        area.removeFromTop(2);
        const int cell=area.getWidth()/4;
        for(int i=0;i<4;++i) {
            auto r=juce::Rectangle<int>(area.getX()+i*cell,area.getY(),cell,area.getHeight()).withTrimmedBottom(16);
            text(g,"MACRO "+juce::String(i+1),r.removeFromBottom(16),9.0f,Palette::muted(),juce::Justification::centred);
        }
    }
    ModulationBindings bindings_;
    std::array<juce::Slider,4> sliders_;
};

class FxPage::ConfirmPanel final : public juce::Component {
public:
    explicit ConfirmPanel(FxPage& page):page_(page) {
        cancel_.setName("FX confirm cancel");
        clear_.setName("FX confirm clear");
        clear_.setColour(juce::TextButton::textColourOffId,signalShade(1.0f,1.0f));
        clear_.setColour(juce::TextButton::textColourOnId,signalShade(1.0f,1.0f));
        cancel_.onClick=[this]{page_.overlay_.dismiss();};
        clear_.onClick=[this]{page_.confirmClear();};
        addAndMakeVisible(cancel_);
        addAndMakeVisible(clear_);
    }
    juce::TextButton& clearButton() noexcept { return clear_; }
    void paint(juce::Graphics& g) override {
        g.fillAll(Palette::panel());
        g.setColour(signalShade(.6f,.8f));
        g.drawRect(getLocalBounds());
        auto area=getLocalBounds().reduced(22,18);
        text(g,"CLEAR FX GRAPH?",area.removeFromTop(28),13.0f,Palette::text());
        area.removeFromTop(6);
        text(g,"This will remove all effect and routing modules.",area.removeFromTop(20),10.0f,Palette::secondary());
        text(g,"BUS 1 > MASTER OUT will remain as the neutral route. UNDO restores the graph.",area.removeFromTop(20),9.0f,Palette::muted());
    }
    void resized() override {
        auto row=getLocalBounds().reduced(22,18).removeFromBottom(32);
        clear_.setBounds(row.removeFromRight(110));
        row.removeFromRight(10);
        cancel_.setBounds(row.removeFromRight(110));
    }
private:
    FxPage& page_;
    juce::TextButton cancel_{"CANCEL"},clear_{"CLEAR"};
};

// ================================================================ page

FxPage::FxPage(FxGraphDocument& document,ModulationBindings bindings,PeakSource peaks,FxViewState* view)
    : document_(document),bindings_(std::move(bindings)),peaks_(std::move(peaks)),viewState_(view),canvas_(*this),view_(canvas_) {
    setWantsKeyboardFocus(true);
    const char* modeNames[]{"SERIAL","PARALLEL","SPLIT","SEND","CUSTOM"};
    for(int i=0;i<5;++i) {
        auto& b=modes_[std::size_t(i)];
        b.setButtonText(modeNames[i]);
        b.setClickingTogglesState(true);
        b.setRadioGroupId(0x4647);
        b.onClick=[this,i]{if(modes_[std::size_t(i)].getToggleState()) setRoutingMode(static_cast<FxRoutingMode>(i+1));};
        addAndMakeVisible(b);
    }
    // SEND needs send/return DSP, which does not exist yet: visibly pending.
    modes_[3].setEnabled(false);
    modes_[3].setTooltip("Send / return routing is pending");
    undo_.onClick=[this]{undo();};
    redo_.onClick=[this]{redo();};
    clear_.onClick=[this]{requestClear();};
    clear_.setColour(juce::TextButton::textColourOffId,signalShade(.95f,.9f));
    templates_.onClick=[this]{showTemplatesMenu(templates_);};
    add_.setName("FX toolbar add module");
    add_.onClick=[this]{showAddEffectMenu(add_);};
    zoomOut_.onClick=[this]{zoomOut();};
    zoomIn_.onClick=[this]{zoomIn();};
    zoomReset_.onClick=[this]{zoomReset();};
    zoomFit_.onClick=[this]{zoomToFit();};
    for(auto* b:{&undo_,&redo_,&clear_,&templates_,&add_,&zoomOut_,&zoomReset_,&zoomIn_,&zoomFit_}) addAndMakeVisible(b);
    addAndMakeVisible(sidebar_);
    sidebar_.onTabChanged=[this](FxSidebar::Tab){storeView();};
    addAndMakeVisible(view_);
    view_.onViewChanged=[this] {
        zoomReset_.setButtonText(juce::String(juce::roundToInt(view_.zoom()*100.0f))+"%");
        storeView();
    };
    selectedPanel_=std::make_unique<SelectedPanel>(*this);
    parametersPanel_=std::make_unique<ParametersPanel>(*this,bindings_);
    macrosPanel_=std::make_unique<FxMacrosPanel>(bindings_);
    confirmPanel_=std::make_unique<ConfirmPanel>(*this);
    addAndMakeVisible(*selectedPanel_);
    addAndMakeVisible(*parametersPanel_);
    addAndMakeVisible(*macrosPanel_);
    addChildComponent(overlay_);
    if(viewState_!=nullptr && viewState_->valid)
        sidebar_.setTab(static_cast<FxSidebar::Tab>(juce::jlimit(0,3,viewState_->sidebarTab)));
    refresh(true);
    refreshSidebar();
}

FxPage::~FxPage() { stopTimer(); }

void FxPage::visibilityChanged() {
    if(isVisible()) startTimerHz(30); else stopTimer();
}

void FxPage::storeView() {
    if(viewState_==nullptr) return;
    viewState_->zoom=view_.zoom();
    viewState_->panX=view_.pan().x;
    viewState_->panY=view_.pan().y;
    viewState_->sidebarTab=static_cast<int>(sidebar_.tab());
    viewState_->valid=true;
}

void FxPage::resized() {
    auto area=getLocalBounds();
    auto toolbar=area.removeFromTop(toolbarHeight).reduced(12,8);
    toolbar.removeFromLeft(132);
    for(auto& mode:modes_) mode.setBounds(toolbar.removeFromLeft(86).reduced(2,0));
    toolbar.removeFromLeft(18);
    zoomOut_.setBounds(toolbar.removeFromLeft(34).reduced(2,0));
    zoomReset_.setBounds(toolbar.removeFromLeft(62).reduced(2,0));
    zoomIn_.setBounds(toolbar.removeFromLeft(34).reduced(2,0));
    zoomFit_.setBounds(toolbar.removeFromLeft(52).reduced(2,0));
    add_.setBounds(toolbar.removeFromRight(140).reduced(2,0));
    toolbar.removeFromRight(10);
    templates_.setBounds(toolbar.removeFromRight(104).reduced(2,0));
    clear_.setBounds(toolbar.removeFromRight(74).reduced(2,0));
    redo_.setBounds(toolbar.removeFromRight(70).reduced(2,0));
    undo_.setBounds(toolbar.removeFromRight(70).reduced(2,0));

    auto inspector=area.removeFromBottom(inspectorHeight);
    sidebar_.setBounds(area.removeFromLeft(FxSidebar::width));
    const bool firstLayout=view_.getWidth()==0;
    view_.setBounds(area);
    const int w=inspector.getWidth();
    selectedPanel_->setBounds(inspector.removeFromLeft(juce::roundToInt(w*.30f)));
    parametersPanel_->setBounds(inspector.removeFromLeft(juce::roundToInt(w*.45f)));
    macrosPanel_->setBounds(inspector);
    overlay_.setBounds(getLocalBounds());
    refresh(true);
    if(firstLayout && viewState_!=nullptr && viewState_->valid)
        view_.setView(viewState_->zoom,{viewState_->panX,viewState_->panY});
}

void FxPage::paint(juce::Graphics& g) {
    g.fillAll(Palette::background());
    auto toolbar=getLocalBounds().removeFromTop(toolbarHeight);
    g.setColour(Palette::panel());
    g.fillRect(toolbar);
    g.setColour(Palette::borderSoft());
    g.drawHorizontalLine(toolbar.getBottom()-1,0.0f,float(getWidth()));
    text(g,"EFFECT ROUTING",toolbar.reduced(14,0).withWidth(128),11.5f,Palette::secondary());
}

bool FxPage::keyPressed(const juce::KeyPress& key) {
    const auto mods=key.getModifiers();
    const bool command=mods.isCommandDown() || mods.isCtrlDown();
    if(key==juce::KeyPress::escapeKey) {
        if(overlay_.isShowing()) overlay_.dismiss();
        canvas_.cancelWire();
        return true;
    }
    if((key==juce::KeyPress::deleteKey || key==juce::KeyPress::backspaceKey) && !command && selected_!=invalidFxNodeId)
        return deleteNode(selected_);
    const auto c=juce::CharacterFunctions::toLowerCase(key.getTextCharacter()!=0 ? key.getTextCharacter() : juce::juce_wchar(key.getKeyCode()));
    if(command && c=='z') { if(mods.isShiftDown()) redo(); else undo(); return true; }
    if(command && c=='0') { zoomReset(); return true; }
    if(command && c=='1') { zoomToFit(); return true; }
    if(command && (c=='=' || c=='+')) { zoomIn(); return true; }
    if(command && c=='-') { zoomOut(); return true; }
    if(!command && c=='f') { zoomToFit(); return true; }
    return false;
}

fx::FxPoint FxPage::viewCentre() const {
    const auto area=view_.viewport().toFloat();
    return view_.viewToGraph(area.getCentre());
}

void FxPage::zoomIn() { view_.zoomAround(view_.zoom()*1.25f,view_.viewport().toFloat().getCentre()); }
void FxPage::zoomOut() { view_.zoomAround(view_.zoom()/1.25f,view_.viewport().toFloat().getCentre()); }
void FxPage::zoomReset() { view_.zoomAround(1.0f,view_.viewport().toFloat().getCentre()); }
void FxPage::zoomToFit() { view_.fitTo(canvas_.contentBounds()); }

void FxPage::syncFromModel() {
    refresh(false);
    refreshSidebar();
}

void FxPage::refreshSidebar() {
    InstrumentState state;
    if(bindings_.snapshot) state=bindings_.snapshot();
    macrosPanel_->sync(state);
    // Routes can change from other pages (Matrix, Synth drags): keep MODULATION live.
    if(parametersPanel_->tab()==1) parametersPanel_->show(graph(),selected_,state.modulation.routes);

    using Row=FxSidebar::Row;
    juce::Component::SafePointer<FxPage> safe(this);
    // SOURCES: canonical audio buses (never ENV/LFO/MIDI).
    std::vector<Row> sources{{"AUDIO BUSES",{},{},{},true,false,true,{}}};
    for(std::size_t i=0;i<state.buses.count;++i) {
        const auto& bus=state.buses.buses[i];
        const bool inGraph=graph().sourceForBus(bus.id)!=invalidFxNodeId;
        const auto id=bus.id;
        Row row{juce::String(bus.label()),inGraph ? "IN GRAPH" : "ADD",i==0 ? "Synth voice sum" : "",
                inGraph ? juce::String() : juce::String(moduleDragPrefix)+juce::String(FxModuleMenu::busBase+int(id)),true,inGraph,false,
                [safe,id] {
                    if(safe==nullptr) return;
                    if(const auto existing=safe->graph().sourceForBus(id)) safe->selectNode(existing);
                    else safe->addModule({FxModuleKind::BusSource,FxEffectType::None,id});
                }};
        sources.push_back(row);
    }
    sources.push_back({"EXTERNAL IN","PENDING","Not available yet",{},false,false,false,{}});
    sidebar_.setRows(FxSidebar::Tab::Sources,std::move(sources));

    // MODULATORS: references to the canonical sources. Dragging one is
    // identical to dragging it from the SYNTH page.
    std::vector<Row> modulators;
    const char* lastGroup="";
    for(const auto& s:availableSources(state.modulation)) {
        if(std::strcmp(lastGroup,s.group)!=0) { modulators.push_back({s.group,{},{},{},true,false,true,{}}); lastGroup=s.group; }
        int count=0;
        for(const auto& r:state.modulation.routes) count+=r.id && r.source==s.source && isFxDestination(r.destination.parameter);
        modulators.push_back({sourceName(s.source),count ? juce::String(count)+" FX" : juce::String(),{},
                              juce::String(sourceDragPrefix)+juce::String(int(s.source)),true,count>0,false,{}});
    }
    sidebar_.setRows(FxSidebar::Tab::Modulators,std::move(modulators));

    // FILTERS: the synth's per-voice filter sits BEFORE the voice sum, so it is
    // not a post-mix graph processor. It is shown truthfully and can be opened.
    const bool filterOn=state.modulation.filterEnabled;
    sidebar_.setRows(FxSidebar::Tab::Filters,{
        {"SYNTH FILTERS",{},{},{},true,false,true,{}},
        {"FILTER 1",filterOn ? "ON" : "OFF","Per-voice low-pass, before BUS 1",{},true,filterOn,false,
         [safe]{if(safe!=nullptr && safe->onOpenSynthFilter) safe->onOpenSynthFilter();}},
        {"IN THE GRAPH",{},{},{},true,false,true,{}},
        {"POST-MIX FILTERING","NOTE","Use COMB; FX filter modules later",{},false,false,false,{}}});

    // ROUTES: topology tools. SEND/RETURN stay pending until their DSP exists.
    sidebar_.setRows(FxSidebar::Tab::Routes,{
        {"ROUTING MODULES",{},{},{},true,false,true,{}},
        {"SPLIT","1 IN / 2 OUT","Drag onto the graph",juce::String(moduleDragPrefix)+juce::String(FxModuleMenu::splitId),true,false,false,
         [safe]{if(safe!=nullptr) safe->addModuleAt({FxModuleKind::Split,FxEffectType::None,0},safe->viewCentre());}},
        {"MERGE","2 IN / 1 OUT","Drag onto the graph",juce::String(moduleDragPrefix)+juce::String(FxModuleMenu::mergeId),true,false,false,
         [safe]{if(safe!=nullptr) safe->addModuleAt({FxModuleKind::Merge,FxEffectType::None,0},safe->viewCentre());}},
        {"SEND","PENDING","Needs send/return DSP",{},false,false,false,{}},
        {"RETURN","PENDING","Needs send/return DSP",{},false,false,false,{}}});
}

void FxPage::updateMeters() {
    if(!peaks_) return;
    const auto [left,right]=peaks_();
    meterLeft_=std::max(left,meterLeft_*0.86f);
    meterRight_=std::max(right,meterRight_*0.86f);
    if(meterLeft_<1.0e-5f) meterLeft_=0.0f;
    if(meterRight_<1.0e-5f) meterRight_=0.0f;
    if(auto* out=canvas_.nodeComponent(graph().outputNode())) out->setMeter(meterLeft_,meterRight_);
}

void FxPage::refresh(bool force) {
    if(!force && lastRevision_==document_.revision()) return;
    lastRevision_=document_.revision();
    const auto& graph=document_.graph();
    if(graph.findNode(selected_)==nullptr) selected_=invalidFxNodeId;
    const auto area=view_.viewport();
    canvas_.rebuild(graph,selected_,int(float(area.getWidth())/view_.zoom())+1,int(float(area.getHeight())/view_.zoom())+1);
    view_.contentChanged();
    selectedPanel_->show(graph,selected_);
    InstrumentState state;
    if(bindings_.snapshot) state=bindings_.snapshot();
    parametersPanel_->show(graph,selected_,state.modulation.routes);
    refreshToolbar();
}

void FxPage::refreshToolbar() {
    const auto mode=static_cast<int>(document_.graph().routingMode())-1;
    for(int i=0;i<5;++i) modes_[std::size_t(i)].setToggleState(i==mode,juce::dontSendNotification);
    undo_.setEnabled(document_.canUndo());
    redo_.setEnabled(document_.canRedo());
}

void FxPage::selectNode(FxNodeId id) {
    if(graph().findNode(id)==nullptr) id=invalidFxNodeId;
    // The active node always comes to the front (UI-only; DSP order is the graph's).
    if(id!=invalidFxNodeId) canvas_.bringToFront(id);
    if(id==selected_) return;
    selected_=id;
    refresh(true);
}

bool FxPage::deleteNode(FxNodeId id) {
    const bool removed=document_.edit([id](FxGraph& g){return g.removeNodeBridging(id)==FxEditResult::Ok;});
    if(removed && selected_==id) selected_=invalidFxNodeId;
    refresh(true);
    return removed;
}

FxNodeId FxPage::addModule(const FxModuleSpec& spec) {
    if(spec.kind==FxModuleKind::BusSource) {
        FxNodeId created=invalidFxNodeId;
        document_.edit([&](FxGraph& g){
            created=g.addBusSource(spec.bus,{40.0f,40.0f+120.0f*float(g.nodes().size()%5)});
            return created!=invalidFxNodeId;
        });
        if(created) selected_=created;
        refresh(true);
        return created;
    }
    if(spec.kind!=FxModuleKind::Effect) return addModuleAt(spec,viewCentre());
    // Workflow templates decide where an added effect goes. They never
    // rebuild the graph by themselves; they only shape new insertions.
    const auto mode=graph().routingMode();
    const auto output=graph().outputNode();
    const auto* outputWire=graph().connectionAt({output,0},true);
    FxNodeId created=invalidFxNodeId;
    if(mode==FxRoutingMode::Serial) {
        document_.edit([&](FxGraph& g){created=g.insertEffectBeforeOutput(spec.effect);return created!=invalidFxNodeId;});
    } else if(mode==FxRoutingMode::Parallel) {
        const auto* selected=graph().findNode(selected_);
        const bool chained=selected && selected->kind==FxNodeKind::Effect
            && graph().connectionAt({selected_,0},true) && graph().connectionAt({selected_,0},false);
        const auto wire=outputWire ? outputWire->id : 0u;
        document_.edit([&](FxGraph& g){
            created=chained ? g.parallelAroundNode(selected_,spec.effect) : wire ? g.parallelOnConnection(wire,spec.effect) : invalidFxNodeId;
            return created!=invalidFxNodeId;
        });
    } else if(mode==FxRoutingMode::Split) {
        const auto* fromSelected=graph().connectionAt({selected_,0},false);
        const auto wire=fromSelected ? fromSelected->id : outputWire ? outputWire->id : 0u;
        document_.edit([&](FxGraph& g){created=wire ? g.branchFromConnection(wire,spec.effect) : invalidFxNodeId;return created!=invalidFxNodeId;});
    }
    if(created==invalidFxNodeId) return addModuleAt(spec,viewCentre()); // CUSTOM, or nothing unambiguous to attach to
    selected_=created;
    refresh(true);
    canvas_.bringToFront(created);
    return created;
}

FxNodeId FxPage::addModuleAt(const FxModuleSpec& spec,FxPoint centre) {
    FxNodeId created=invalidFxNodeId;
    document_.edit([&](FxGraph& g){
        FxNode probe;
        probe.kind=spec.kind==FxModuleKind::Split ? FxNodeKind::Split : spec.kind==FxModuleKind::Merge ? FxNodeKind::Merge
                 : spec.kind==FxModuleKind::BusSource ? FxNodeKind::Source : FxNodeKind::Effect;
        probe.ports=fxPortTopology(probe.kind);
        const auto size=FxNodeComponent::sizeFor(probe);
        created=g.addModule(spec,{centre.x-float(size.getWidth())*0.5f,centre.y-float(size.getHeight())*0.5f});
        return created!=invalidFxNodeId;
    });
    if(created!=invalidFxNodeId) selected_=created;
    refresh(true);
    canvas_.bringToFront(created);
    return created;
}

FxNodeId FxPage::insertModuleOnConnection(FxConnectionId connection,const FxModuleSpec& spec,FxPoint centre) {
    // One atomic edit: A -> B becomes A -> X -> B, or nothing changes.
    FxNodeId created=invalidFxNodeId;
    FxNode probe;
    probe.kind=spec.kind==FxModuleKind::Split ? FxNodeKind::Split : spec.kind==FxModuleKind::Merge ? FxNodeKind::Merge : FxNodeKind::Effect;
    probe.ports=fxPortTopology(probe.kind);
    const auto size=FxNodeComponent::sizeFor(probe);
    document_.edit([&](FxGraph& g){
        created=g.insertModuleOnConnection(connection,spec,{centre.x-float(size.getWidth())*0.5f,centre.y-float(size.getHeight())*0.5f});
        return created!=invalidFxNodeId;
    });
    if(created!=invalidFxNodeId) selected_=created;
    refresh(true);
    canvas_.bringToFront(created);
    return created;
}

FxNodeId FxPage::insertBeforeOutput(const FxModuleSpec& spec) {
    const auto output=graph().outputNode();
    const auto* out=graph().findNode(output);
    if(out==nullptr || spec.kind==FxModuleKind::BusSource) return addModule(spec);
    const FxPoint near{out->position.x-150.0f,out->position.y+90.0f};
    if(const auto* wire=graph().connectionAt({output,0},true)) return insertModuleOnConnection(wire->id,spec,near);
    const auto created=addModuleAt(spec,near);
    if(created!=invalidFxNodeId && spec.kind==FxModuleKind::Effect) connectPorts({created,0},{output,0});
    return created;
}

bool FxPage::removeConnection(FxConnectionId id) {
    const bool ok=document_.edit([id](FxGraph& g){return g.disconnect(id);});
    refresh(true);
    return ok;
}

bool FxPage::resetConnectionRouting(FxConnectionId id) {
    const bool ok=document_.edit([id](FxGraph& g){
        const auto* c=g.findConnection(id);
        if(c==nullptr || c->layout.empty()) return false;
        while(!g.findConnection(id)->layout.empty()) g.removeLayoutPoint(id,0);
        return true;
    });
    refresh(true);
    return ok;
}

bool FxPage::addLayoutPoint(FxConnectionId connection,FxPoint at) {
    const auto index=canvas_.layoutInsertIndex(connection,{at.x,at.y});
    const bool ok=document_.edit([&](FxGraph& g){return g.addLayoutPoint(connection,index,at)==FxEditResult::Ok;});
    refresh(true);
    return ok;
}

bool FxPage::moveLayoutPoint(FxConnectionId connection,std::size_t index,FxPoint at,bool live) {
    if(live) {
        if(!gestureActive_) beginParameterGesture();
        const bool ok=document_.gestureEdit([&](FxGraph& g){return g.moveLayoutPoint(connection,index,at)==FxEditResult::Ok;});
        refresh(false);
        return ok;
    }
    if(gestureActive_) endParameterGesture();
    return true;
}

bool FxPage::removeLayoutPoint(FxConnectionId connection,std::size_t index) {
    const bool ok=document_.edit([&](FxGraph& g){return g.removeLayoutPoint(connection,index)==FxEditResult::Ok;});
    refresh(true);
    return ok;
}

void FxPage::setRoutingMode(FxRoutingMode mode) {
    if(mode==FxRoutingMode::Send) { refreshToolbar(); return; } // pending, never faked
    document_.edit([mode](FxGraph& g){g.setRoutingMode(mode);return true;});
    refresh(true);
}

void FxPage::requestClear() {
    overlay_.show(*confirmPanel_,{0,0,520,180});
}

void FxPage::confirmClear() {
    overlay_.dismiss();
    // One canonical transaction (one undo step). Connections and their routing
    // points go with the modules; the processor prunes FX modulation routes.
    document_.edit([](FxGraph& g){g.clearProcessing();return true;});
    selected_=invalidFxNodeId;
    refresh(true);
}

void FxPage::undo() { document_.undo(); refresh(true); }
void FxPage::redo() { document_.redo(); refresh(true); }

void FxPage::commitMove(FxNodeId id,juce::Point<int> topLeft) {
    document_.edit([&](FxGraph& g){return g.moveNode(id,{float(topLeft.x),float(topLeft.y)})==FxEditResult::Ok;});
    refresh(true);
}

bool FxPage::connectPorts(FxPortRef from,FxPortRef to) {
    const bool ok=document_.edit([&](FxGraph& g) {
        g.disconnectPort(to.node,true,to.port);
        g.disconnectPort(from.node,false,from.port);
        return g.connect(from,to)==FxEditResult::Ok;
    });
    refresh(true);
    return ok;
}

void FxPage::disconnectPort(FxNodeId id,bool input,std::uint8_t port) {
    document_.edit([&](FxGraph& g){return g.disconnectPort(id,input,port)>0;});
    refresh(true);
}

void FxPage::setNodeEnabled(FxNodeId id,bool enabled) {
    document_.edit([&](FxGraph& g){return g.setEnabled(id,enabled)==FxEditResult::Ok;});
    refresh(true);
}

void FxPage::beginParameterGesture() {
    document_.beginGesture();
    gestureActive_=true;
}

void FxPage::setParameter(FxNodeId id,FxParameterId parameter,float value) {
    const auto apply=[&](FxGraph& g){return g.setParameter(id,parameter,value)==FxEditResult::Ok;};
    if(gestureActive_) document_.gestureEdit(apply); else document_.edit(apply);
    refresh(false);
}

void FxPage::endParameterGesture() {
    gestureActive_=false;
    document_.endGesture();
    refreshToolbar();
}

std::vector<NativeChoiceItem> FxPage::moduleMenuItems(bool allowSources) const {
    std::vector<NativeChoiceItem> items;
    for(const auto& d:fxEffectCatalog())
        if(d.processesAudio) items.push_back({int(d.type),juce::String(d.label),true,"EFFECTS"});
    items.push_back({FxModuleMenu::splitId,"Split",true,"ROUTING"});
    items.push_back({FxModuleMenu::mergeId,"Merge",true,"ROUTING"});
    items.push_back({FxModuleMenu::sendId,"Send (pending)",false,"ROUTING"});
    items.push_back({FxModuleMenu::returnId,"Return (pending)",false,"ROUTING"});
    if(allowSources) {
        InstrumentState state;
        if(bindings_.snapshot) state=bindings_.snapshot();
        for(std::size_t i=0;i<state.buses.count;++i) {
            const auto& bus=state.buses.buses[i];
            if(graph().sourceForBus(bus.id)==invalidFxNodeId)
                items.push_back({FxModuleMenu::busBase+int(bus.id),juce::String(bus.label()),true,"SOURCES"});
        }
        items.push_back({FxModuleMenu::externalId,"External Input (pending)",false,"SOURCES"});
    }
    return items;
}

std::vector<int> FxPage::moduleMenuIds(bool allowSources) const {
    std::vector<int> ids;
    for(const auto& item:moduleMenuItems(allowSources)) if(item.enabled) ids.push_back(item.id);
    return ids;
}

void FxPage::showModuleMenu(juce::Component& anchor,bool allowSources,std::function<void(FxModuleSpec)> chosen) {
    juce::Component::SafePointer<FxPage> safe(this);
    showNativeChoiceMenu(anchor,"ADD MODULE",moduleMenuItems(allowSources),0,[safe,chosen](int choice) {
        if(safe==nullptr) return;
        if(const auto spec=FxModuleMenu::decode(choice); spec && chosen) chosen(*spec);
    });
}

void FxPage::applyTemplate(int id) {
    switch(id) {
    case 1: document_.edit([](FxGraph& g){g=makeDefaultFxGraph();return true;}); break;
    case 2: document_.edit([](FxGraph& g){g=makeSerialChainTemplate();return true;}); break;
    case 3: document_.edit([](FxGraph& g){g=makeParallelTemplate();return true;}); break;
    case 4: document_.edit([](FxGraph& g){return g.applyTemplate(FxRoutingMode::Serial);}); break;
    case 10: document_.edit([](FxGraph& g){g=makeDevelopmentFxGraph();return true;}); break;
    default: return;
    }
    selected_=invalidFxNodeId;
    refresh(true);
    zoomToFit();
}

void FxPage::showTemplatesMenu(juce::Component& anchor) {
    juce::Component::SafePointer<FxPage> safe(this);
    showNativeChoiceMenu(anchor,"TEMPLATES",{
        {1,"Empty (BUS 1 > MASTER OUT)",true,"GRAPH PRESETS"},
        {2,"Serial Chain (Drive > Delay > Reverb)",true,"GRAPH PRESETS"},
        {3,"Parallel Processing (dry + Reverb)",true,"GRAPH PRESETS"},
        {5,"Delay / Reverb Send (pending)",false,"GRAPH PRESETS"},
        {4,"Rearrange Current as Serial Chain",true,"CURRENT GRAPH"},
        {10,"Development Graph",true,"DEVELOPMENT"}},0,[safe](int choice) {
        if(safe!=nullptr) safe->applyTemplate(choice);
    });
}

juce::String FxPage::inspectorHeadline() const { return selectedPanel_->headline(); }

juce::String FxPage::parameterTabName() const {
    const char* names[]{"MAIN","MODULATION","ADVANCED"};
    return names[parametersPanel_->tab()];
}

void FxPage::selectParameterTab(int index) { parametersPanel_->selectTab(index); }

std::size_t FxPage::modulationRowCount() const { return parametersPanel_->modulationRows(); }

}
