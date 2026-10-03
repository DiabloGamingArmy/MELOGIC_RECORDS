// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-fx-page-foundation-p01
#include "FxPage.h"
#include "NativeChoiceMenu.h"
#include <cmath>
#include <limits>

namespace mct::origami::ui {
namespace {
using namespace mct::origami::fx;

constexpr int toolbarHeight=44;
constexpr int inspectorHeight=250;
constexpr int railWidth=168;

void configureKnob(juce::Slider& s) {
    s.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    s.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    s.setRotaryParameters(juce::MathConstants<float>::pi*1.20f,juce::MathConstants<float>::pi*2.80f,true);
    s.setMouseDragSensitivity(220);
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

float physical(const FxNode& n,std::size_t index) {
    const auto* d=findFxEffect(n.effect);
    if(d==nullptr || index>=d->parameterCount) return 0.0f;
    const auto& p=d->parameters[index];
    return fxParameterValue(p,n.parameter(p.id).value_or(p.defaultValue));
}

juce::String valueText(const FxNode& n,const FxParameterDescriptor& p) {
    return juce::String(fxParameterText(p,n.parameter(p.id).value_or(p.defaultValue)));
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

const char* categoryName(FxCategory c) {
    switch(c) {
    case FxCategory::Drive: return "DRIVE";
    case FxCategory::Time: return "TIME";
    case FxCategory::Space: return "SPACE";
    case FxCategory::Modulation: return "MODULATION";
    case FxCategory::Filter: return "FILTER";
    case FxCategory::Dynamics: return "DYNAMICS";
    }
    return "";
}

float meterHeight(float linear) {
    if(linear<=1.0e-5f) return 0.0f;
    return juce::jlimit(0.0f,1.0f,(20.0f*std::log10(linear)+60.0f)/60.0f);
}
}

// ================================================================ node

FxNodeComponent::FxNodeComponent(FxPage& page,FxNodeId id):page_(page),id_(id) {
    for(auto* b:{&power_,&menu_,&remove_}) addChildComponent(b);
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
}

FxNodeComponent::~FxNodeComponent()=default;

juce::Rectangle<int> FxNodeComponent::sizeFor(const FxNode& n) noexcept {
    switch(n.kind) {
    case FxNodeKind::Source: return {0,0,150,82};
    case FxNodeKind::Output: return {0,0,156,176};
    case FxNodeKind::Split: case FxNodeKind::Merge: {
        const int branches=juce::jmax<int>(n.ports.inputs,n.ports.outputs);
        return {0,0,96,juce::jmax(76,26*branches+34)};
    }
    case FxNodeKind::Effect: case FxNodeKind::Send: case FxNodeKind::Return: break;
    }
    return {0,0,212,176};
}

void FxNodeComponent::update(const FxNode& node,bool selected) {
    const bool effect=node.kind==FxNodeKind::Effect;
    node_=node;
    selected_=selected;
    power_.setVisible(effect);
    menu_.setVisible(effect);
    remove_.setVisible(effect || node.isRouting());
    power_.setToggleState(node.enabled,juce::dontSendNotification);

    const auto quick=parametersFor(node,true,std::nullopt);
    std::vector<FxParameterId> ids;
    for(const auto* p:quick) ids.push_back(p->id);
    if(ids!=quickIds_) {
        quick_.clear();
        quickIds_=ids;
        for(const auto pid:quickIds_) {
            auto slider=std::make_unique<juce::Slider>();
            configureKnob(*slider);
            slider->setRange(0.0,1.0,0.001);
            slider->setName("FX "+juce::String(id_)+" P"+juce::String(pid));
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

juce::Point<float> FxNodeComponent::portCentre(bool input,std::uint8_t port) const noexcept {
    const int count=input ? node_.ports.inputs : node_.ports.outputs;
    const float top=node_.isRouting() ? 26.0f : 0.0f;
    const float span=float(getHeight())-top;
    const float y=top+span*(float(port)+1.0f)/(float(count)+1.0f);
    return {input ? portRadius+1.5f : float(getWidth())-portRadius-1.5f,y};
}

std::optional<std::pair<bool,std::uint8_t>> FxNodeComponent::portAt(juce::Point<float> p) const noexcept {
    for(std::uint8_t i=0;i<node_.ports.outputs;++i)
        if(p.getDistanceFrom(portCentre(false,i))<=portHitRadius) return std::make_pair(false,i);
    for(std::uint8_t i=0;i<node_.ports.inputs;++i)
        if(p.getDistanceFrom(portCentre(true,i))<=portHitRadius) return std::make_pair(true,i);
    return std::nullopt;
}

void FxNodeComponent::resized() {
    if(node_.kind==FxNodeKind::Effect) {
        auto row=getLocalBounds().removeFromTop(32).reduced(12,5);
        power_.setBounds(row.removeFromLeft(38));
        remove_.setBounds(row.removeFromRight(26));
        row.removeFromRight(4);
        menu_.setBounds(row.removeFromRight(28));
        auto knobs=getLocalBounds().withTrimmedTop(96).reduced(12,0).withTrimmedBottom(20);
        const int width=knobs.getWidth()/juce::jmax<int>(1,int(quick_.size()));
        for(auto& slider:quick_) slider->setBounds(knobs.removeFromLeft(width).withSizeKeepingCentre(44,44));
    } else if(node_.isRouting()) {
        remove_.setBounds(getWidth()-30,4,24,20);
    }
}

void FxNodeComponent::paint(juce::Graphics& g) {
    const auto bounds=getLocalBounds().toFloat().reduced(.5f);
    const bool routing=node_.isRouting();
    const auto body=routing ? Palette::panel() : Palette::raised();
    g.setColour(body);
    g.fillRect(bounds);
    if(!routing) {
        g.setColour(body.brighter(.05f));
        g.fillRect(bounds.withHeight(31.0f).reduced(1.0f));
        g.setColour(Palette::borderStrong().withAlpha(.30f));
        g.drawHorizontalLine(31,8.0f,float(getWidth()-8));
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
        auto title=local.withHeight(32).withTrimmedLeft(56).withTrimmedRight(70);
        text(g,node_.name,title,11.5f,node_.enabled ? Palette::text() : Palette::muted());
        // Only placeholders are labelled; every registered effect has DSP.
        if(d==nullptr || !d->processesAudio)
            text(g,"NO DSP",title,7.5f,Palette::muted().withAlpha(.75f),juce::Justification::centredRight);
        paintEffectPreview(g,juce::Rectangle<float>(12.0f,38.0f,float(getWidth()-24),52.0f),node_);
        const auto quick=parametersFor(node_,true,std::nullopt);
        auto labels=local.withTrimmedTop(local.getHeight()-22).reduced(12,0);
        const int width=labels.getWidth()/juce::jmax<int>(1,int(quick.size()));
        for(const auto* p:quick) text(g,p->label,labels.removeFromLeft(width),9.0f,Palette::muted(),juce::Justification::centred);
        break;
    }
    case FxNodeKind::Source: {
        text(g,node_.name,local.withHeight(30).reduced(12,0),11.5f,Palette::text());
        text(g,"SYNTH VOICE SUM",local.withTrimmedTop(30).withHeight(16).reduced(12,0),8.5f,Palette::muted());
        auto wave=juce::Rectangle<float>(12.0f,52.0f,float(getWidth())-40.0f,20.0f);
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
        text(g,node_.name,local.withHeight(30).reduced(14,0),11.5f,Palette::text());
        auto meters=local.withTrimmedTop(38).withTrimmedBottom(34).withSizeKeepingCentre(60,local.getHeight()-72);
        for(int channel=0;channel<2;++channel) {
            auto column=meters.removeFromLeft(30);
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
             local.withTrimmedTop(local.getHeight()-30).withHeight(16),9.0f,Palette::secondary(),juce::Justification::centred);
        break;
    }
    case FxNodeKind::Split: case FxNodeKind::Merge: {
        text(g,node_.name,{10,4,getWidth()-40,20},10.0f,Palette::secondary());
        // Geometry tells the story: one line fanning out, or many converging.
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

    const auto paintPort=[&](bool input,std::uint8_t port) {
        const auto c=portCentre(input,port);
        auto dot=juce::Rectangle<float>(portRadius*2.0f,portRadius*2.0f).withCentre(c);
        g.setColour(Palette::inset());
        g.fillEllipse(dot);
        g.setColour(Palette::borderStrong());
        g.drawEllipse(dot,1.2f);
    };
    for(std::uint8_t i=0;i<node_.ports.inputs;++i) paintPort(true,i);
    for(std::uint8_t i=0;i<node_.ports.outputs;++i) paintPort(false,i);
}

void FxNodeComponent::mouseDown(const juce::MouseEvent& e) {
    page_.grabKeyboardFocus();
    const auto port=portAt(e.position);
    if(port && e.mods.isPopupMenu()) { page_.disconnectPort(id_,port->first,port->second); return; }
    page_.selectNode(id_); // also brings this node to the front
    if(port && !port->first) {
        drag_=Drag::Wire;
        wirePort_=port->second;
        page_.canvas().beginWire(id_,wirePort_);
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
    }
}

void FxNodeComponent::mouseUp(const juce::MouseEvent& e) {
    const auto mode=drag_;
    drag_=Drag::None;
    if(mode==Drag::Wire) page_.canvas().endWire(e.getEventRelativeTo(&page_.canvas()).getPosition());
    else if(mode==Drag::Move && getPosition()!=dragOrigin_) page_.commitMove(id_,getPosition());
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

FxCanvas::FxCanvas(FxPage& page):page_(page) {
    addAndMakeVisible(addGhost_);
    addGhost_.setName("FX canvas add effect");
    addGhost_.onClick=[this]{page_.showAddEffectMenu(addGhost_);};
}

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

FxPoint FxCanvas::toGraph(juce::Point<float> p) const noexcept {
    return {p.x,p.y};
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
    if(const auto* out=nodeComponent(graph.outputNode()))
        addGhost_.setBounds(out->getX(),out->getBottom()+16,out->getWidth(),30);
    content=content.getUnion(addGhost_.getBounds());
    // Generous room beyond the content so large graphs can grow in any direction.
    setSize(juce::jmax(minWidth,content.getRight()+600),juce::jmax(minHeight,content.getBottom()+320));

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
    for(std::size_t i=0;i+1<n;++i) {
        const auto c1=pts[i]+tangent[i]/3.0f;
        const auto c2=pts[i+1]-tangent[i+1]/3.0f;
        p.cubicTo(c1,c2,pts[i+1]);
    }
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
    wire.area=wire.path.getBounds().getSmallestIntegerContainer().expanded(int(wireHitRadius)+4);
}

void FxCanvas::repaintWire(const Wire& wire) { repaint(wire.area); }

std::optional<FxConnectionId> FxCanvas::connectionAt(juce::Point<float> p) const noexcept {
    std::optional<FxConnectionId> best;
    float bestDistance=wireHitRadius;
    for(const auto& wire:wires_) {
        if(!wire.area.contains(p.toInt())) continue;
        juce::Point<float> nearest;
        wire.path.getNearestPoint(p,nearest);
        const float distance=p.getDistanceFrom(nearest);
        if(distance<=bestDistance) { bestDistance=distance; best=wire.connection.id; }
    }
    return best;
}

std::optional<std::pair<FxConnectionId,std::size_t>> FxCanvas::layoutPointAt(juce::Point<float> p) const noexcept {
    for(const auto& wire:wires_)
        for(std::size_t i=0;i<wire.handles.size();++i)
            if(p.getDistanceFrom(wire.handles[i])<=pointHitRadius) return std::make_pair(wire.connection.id,i);
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
        repaintWire(wire);
        computeWire(wire);
        repaintWire(wire);
    }
}

void FxCanvas::beginWire(FxNodeId id,std::uint8_t port) {
    wireActive_=true;
    wireFrom_={id,port};
    wireEnd_=portInCanvas(id,false,port);
}

void FxCanvas::dragWire(juce::Point<int> p) {
    const auto start=portInCanvas(wireFrom_.node,false,wireFrom_.port);
    repaint(curve(start,wireEnd_).getBounds().getSmallestIntegerContainer().expanded(6));
    wireEnd_=p.toFloat();
    repaint(curve(start,wireEnd_).getBounds().getSmallestIntegerContainer().expanded(6));
}

void FxCanvas::endWire(juce::Point<int> p) {
    if(!wireActive_) return;
    wireActive_=false;
    repaint();
    for(const auto& [id,node]:nodes_) {
        if(!node->getBounds().expanded(16).contains(p)) continue;
        const auto port=node->portAt((p-node->getPosition()).toFloat());
        if(port && port->first) { page_.connectPorts(wireFrom_,{id,port->second}); return; }
    }
}

void FxCanvas::paint(juce::Graphics& g) {
    g.fillAll(juce::Colour(0xff0a0a0a));
    const auto clip=g.getClipBounds();
    constexpr int grid=24;
    g.setColour(Palette::borderSoft().withAlpha(.55f));
    for(int y=(clip.getY()/grid)*grid;y<clip.getBottom();y+=grid)
        for(int x=(clip.getX()/grid)*grid;x<clip.getRight();x+=grid)
            g.fillRect(x,y,1,1);

    // Signal paths: thin source-colour strokes with a very soft underlay.
    for(const auto& wire:wires_) {
        if(!wire.area.intersects(clip)) continue;
        g.setColour(signalShade(.9f,.10f));
        g.strokePath(wire.path,juce::PathStrokeType(4.5f));
        g.setColour(signalShade(.95f,.88f));
        g.strokePath(wire.path,juce::PathStrokeType(1.5f));
        g.setColour(signalSourceColour());
        for(const auto& end:{wire.path.getPointAlongPath(0.0f),wire.path.getPointAlongPath(wire.path.getLength())})
            g.fillEllipse(juce::Rectangle<float>(5.0f,5.0f).withCentre(end));
        // Routing points: Origami's draggable-point language.
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

void FxCanvas::mouseDown(const juce::MouseEvent& e) {
    page_.grabKeyboardFocus();
    const auto position=e.position;
    if(const auto point=layoutPointAt(position)) {
        if(e.mods.isPopupMenu()) {
            juce::Component::SafePointer<FxPage> page(&page_);
            const auto target=*point;
            showNativeChoiceMenu(*this,"ROUTING POINT",{{1,"Remove Routing Point",true,"ROUTING"}},0,[page,target](int choice) {
                if(page!=nullptr && choice==1) page->removeLayoutPoint(target.first,target.second);
            });
            return;
        }
        dragPoint_=point;
        return;
    }
    if(e.mods.isPopupMenu()) {
        // Right-click: the SAME native Add Effect menu, placed at the click.
        auto at=toGraph(position);
        juce::Component::SafePointer<FxPage> page(&page_);
        if(const auto wire=connectionAt(position)) {
            const auto id=*wire;
            page_.showAddEffectMenu(*this,[page,id,at](FxEffectType type) {
                if(page!=nullptr) page->insertEffectOnConnection(id,type,at);
            });
        } else {
            page_.showAddEffectMenu(*this,[page,at](FxEffectType type) {
                if(page!=nullptr) page->addEffectAt(type,at);
            });
        }
        return;
    }
    page_.selectNode(invalidFxNodeId);
    panning_=true;
    panOrigin_=page_.viewport().getViewPosition();
}

void FxCanvas::mouseDrag(const juce::MouseEvent& e) {
    if(dragPoint_) {
        page_.moveLayoutPoint(dragPoint_->first,dragPoint_->second,toGraph(e.position),true);
        return;
    }
    // Background drag pans the graph in both directions.
    if(panning_) page_.viewport().setViewPosition(panOrigin_-e.getOffsetFromDragStart());
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
    if(hover!=hoverPoint_) {
        hoverPoint_=hover;
        repaint();
    }
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

// ================================================================ rail

void FxSourceRail::setBuses(std::vector<Entry> buses) {
    const bool same=buses.size()==buses_.size() && std::equal(buses.begin(),buses.end(),buses_.begin(),
        [](const Entry& a,const Entry& b){return a.bus==b.bus && a.label==b.label && a.inGraph==b.inGraph;});
    if(same) return;
    buses_=std::move(buses);
    repaint();
}

juce::Rectangle<int> FxSourceRail::rowBounds(std::size_t index) const noexcept {
    return {12,58+int(index)*rowHeight,getWidth()-24,rowHeight-4};
}

void FxSourceRail::mouseDown(const juce::MouseEvent& e) {
    for(std::size_t i=0;i<buses_.size();++i)
        if(rowBounds(i).contains(e.getPosition()) && onBusClicked) { onBusClicked(buses_[i].bus); return; }
}

void FxSourceRail::paint(juce::Graphics& g) {
    g.fillAll(Palette::panel());
    g.setColour(Palette::borderSoft());
    g.drawVerticalLine(getWidth()-1,0.0f,float(getHeight()));
    auto area=getLocalBounds().reduced(12,10);
    text(g,"SOURCE",area.removeFromTop(22),11.5f,Palette::secondary());
    text(g,"AUDIO BUSES",area.removeFromTop(22),8.5f,Palette::muted());
    const auto row=[&](juce::Rectangle<int> r,const juce::String& label,bool available,bool active,const juce::String& badge) {
        g.setColour(available ? (active ? Palette::raised().brighter(.06f) : Palette::raised()) : Palette::inset());
        g.fillRect(r);
        g.setColour(active ? signalShade(.75f,.9f) : available ? Palette::border() : Palette::borderSoft());
        g.drawRect(r);
        if(active) {
            g.setColour(signalSourceColour());
            g.fillEllipse(juce::Rectangle<float>(6.0f,6.0f).withCentre({float(r.getRight()-12),float(r.getCentreY())}));
        }
        text(g,label,r.reduced(10,0),10.0f,available ? Palette::text() : Palette::muted().withAlpha(.65f));
        if(badge.isNotEmpty())
            text(g,badge,r.reduced(10,0),7.5f,Palette::muted().withAlpha(.8f),juce::Justification::centredRight);
    };
    for(std::size_t i=0;i<buses_.size();++i)
        row(rowBounds(i),buses_[i].label,true,buses_[i].inGraph,buses_[i].inGraph ? "" : "ADD");
    area.setTop(rowBounds(buses_.size()).getY());
    row(area.removeFromTop(rowHeight-4),"EXTERNAL IN",false,false,"LATER");
    area.removeFromTop(14);
    text(g,"CONTROL",area.removeFromTop(20),8.5f,Palette::muted());
    for(const char* label:{"ENV","LFO","MIDI"}) {
        row(area.removeFromTop(rowHeight-4),label,false,false,"MOD");
        area.removeFromTop(4);
    }
    g.setColour(Palette::muted().withAlpha(.75f));
    g.setFont(juce::FontOptions(8.5f));
    g.drawFittedText("Buses carry audio. Control sources reach FX through modulation, never as audio. "
                     "New buses arrive with the Mixer.",area.removeFromTop(72),juce::Justification::topLeft,6,1.0f);
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
            for(const auto pid:ids_) {
                auto knob=std::make_unique<juce::Slider>();
                configureKnob(*knob);
                knob->setRange(0.0,1.0,0.001);
                knob->setName("FX inspector P"+juce::String(pid));
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
        auto area=contentBounds().reduced(10,6).withTrimmedTop(6);
        auto row=area.removeFromTop(24);
        power_.setBounds(row.removeFromLeft(40));
        remove_.setBounds(row.removeFromRight(28));
        area.removeFromTop(6);
        area.removeFromTop(60);
        area.removeFromTop(6);
        auto knobs=area.withTrimmedBottom(28);
        const int width=knobs.getWidth()/juce::jmax<int>(1,int(knobs_.size()));
        for(auto& knob:knobs_) knob->setBounds(knobs.removeFromLeft(width).withSizeKeepingCentre(46,46));
    }
private:
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(10,6).withTrimmedTop(6);
        if(!node_) {
            text(g,"NO NODE SELECTED",area.withTrimmedBottom(area.getHeight()/2),11.0f,Palette::secondary(),juce::Justification::centredBottom);
            text(g,"Select a module in the routing canvas to edit it here.",area.withTrimmedTop(area.getHeight()/2+4),9.0f,Palette::muted(),juce::Justification::centredTop);
            return;
        }
        auto row=area.removeFromTop(24);
        const bool effect=node_->kind==FxNodeKind::Effect;
        text(g,node_->name,row.withTrimmedLeft(effect ? 50 : 0).withTrimmedRight(34),12.0f,Palette::text());
        text(g,kindLabel(node_->kind),row.withTrimmedRight(36),8.5f,Palette::muted(),juce::Justification::centredRight);
        area.removeFromTop(6);
        auto display=area.removeFromTop(60);
        if(effect) {
            paintEffectPreview(g,display.toFloat(),*node_);
            area.removeFromTop(6);
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
    static constexpr int rowHeight=30;
    explicit ParametersPanel(FxPage& page):Panel("EFFECT PARAMETERS"),page_(page) {
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
        // Parameter lists scroll instead of shrinking controls.
        viewport_.setViewedComponent(&rows_,false);
        viewport_.setScrollBarsShown(true,false);
        viewport_.setScrollBarThickness(8);
        addAndMakeVisible(viewport_);
    }
    ~ParametersPanel() override { viewport_.setViewedComponent(nullptr,false); }
    int tab() const noexcept { return tab_; }
    void selectTab(int index) {
        tab_=juce::jlimit(0,2,index);
        for(int i=0;i<3;++i) tabs_[std::size_t(i)].setToggleState(i==tab_,juce::dontSendNotification);
        show(page_.graph(),page_.selectedNode());
    }
    void show(const FxGraph& graph,FxNodeId id) {
        const auto* node=graph.findNode(id);
        if(node!=nullptr) node_=*node; else node_.reset();
        if(shownId_!=id || shownTab_!=tab_ || (node_ && node_->effect!=shownEffect_)) {
            shownId_=id;
            shownTab_=tab_;
            shownEffect_=node_ ? node_->effect : FxEffectType::None;
            rows_.entries.clear();
            if(node_ && tab_!=1) {
                for(const auto* p:parametersFor(*node_,false,tab_==0 ? FxParameterPage::Main : FxParameterPage::Advanced)) {
                    Entry entry;
                    entry.descriptor=p;
                    const auto pid=p->id;
                    if(p->curve==FxParameterCurve::Choice) {
                        entry.toggle=std::make_unique<juce::TextButton>("OFF");
                        entry.toggle->setClickingTogglesState(true);
                        entry.toggle->setName("FX parameter "+juce::String(p->key));
                        auto* raw=entry.toggle.get();
                        raw->onClick=[this,raw,pid]{if(node_) page_.setParameter(node_->id,pid,raw->getToggleState() ? 1.0f : 0.0f);};
                        rows_.addAndMakeVisible(*raw);
                    } else {
                        entry.slider=std::make_unique<juce::Slider>();
                        auto* raw=entry.slider.get();
                        raw->setSliderStyle(juce::Slider::LinearHorizontal);
                        raw->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
                        raw->setRange(0.0,1.0,0.001);
                        raw->setName("FX parameter "+juce::String(p->key));
                        raw->onDragStart=[this]{page_.beginParameterGesture();};
                        raw->onDragEnd=[this]{page_.endParameterGesture();};
                        raw->onValueChange=[this,raw,pid]{if(node_) page_.setParameter(node_->id,pid,float(raw->getValue()));};
                        rows_.addAndMakeVisible(*raw);
                    }
                    rows_.entries.push_back(std::move(entry));
                }
            }
        }
        for(auto& e:rows_.entries) {
            const float v=node_->parameter(e.descriptor->id).value_or(e.descriptor->defaultValue);
            if(e.slider && !e.slider->isMouseButtonDown()) e.slider->setValue(v,juce::dontSendNotification);
            if(e.toggle) {
                e.toggle->setToggleState(v>=0.5f,juce::dontSendNotification);
                e.toggle->setButtonText(v>=0.5f ? "ON" : "OFF");
            }
        }
        rows_.node=node_;
        rows_.tab=tab_;
        resized();
        rows_.repaint();
    }
    void resized() override {
        auto area=contentBounds().reduced(10,6).withTrimmedTop(6);
        auto tabs=area.removeFromTop(26);
        for(auto& tab:tabs_) tab.setBounds(tabs.removeFromLeft(110).reduced(2,0));
        area.removeFromTop(8);
        viewport_.setBounds(area);
        const int width=area.getWidth()-10;
        const int lines=rows_.tab==1 && rows_.node ? int(parametersFor(*rows_.node,false,std::nullopt).size())+1 : int(rows_.entries.size());
        rows_.setSize(width,juce::jmax(area.getHeight(),lines*rowHeight+4));
        for(std::size_t i=0;i<rows_.entries.size();++i) {
            auto row=juce::Rectangle<int>(0,int(i)*rowHeight,width,rowHeight).withTrimmedLeft(110).withTrimmedRight(84).reduced(0,5);
            if(rows_.entries[i].slider) rows_.entries[i].slider->setBounds(row);
            if(rows_.entries[i].toggle) rows_.entries[i].toggle->setBounds(row.withWidth(72));
        }
    }
private:
    struct Entry {
        const FxParameterDescriptor* descriptor=nullptr;
        std::unique_ptr<juce::Slider> slider;
        std::unique_ptr<juce::TextButton> toggle;
    };
    struct Rows final : public juce::Component {
        std::vector<Entry> entries;
        std::optional<FxNode> node;
        int tab=0;
        void paint(juce::Graphics& g) override {
            auto area=getLocalBounds();
            if(!node || node->kind!=FxNodeKind::Effect) {
                text(g,node ? "Routing and terminal nodes have no effect parameters." : "Select an effect module to edit its parameters.",
                     area.removeFromTop(24),9.5f,Palette::muted());
                return;
            }
            if(tab==1) {
                // Stable identities for the single Origami modulation system.
                text(g,"FX modulation joins the existing matrix in a later patch. Stable destinations:",area.removeFromTop(rowHeight),9.0f,Palette::muted());
                for(const auto* p:parametersFor(*node,false,std::nullopt)) {
                    auto row=area.removeFromTop(rowHeight);
                    text(g,juce::String(node->name)+"  "+p->label,row.removeFromLeft(170),9.5f,Palette::secondary());
                    text(g,"node_"+juce::String(node->id)+" / "+findFxEffect(node->effect)->key+" / "+p->key,row,9.0f,Palette::muted());
                }
                return;
            }
            if(entries.empty()) { text(g,"No advanced parameters for this effect.",area.removeFromTop(24),9.5f,Palette::muted()); return; }
            for(const auto& e:entries) {
                auto line=area.removeFromTop(rowHeight);
                text(g,e.descriptor->label,line.removeFromLeft(104),9.5f,Palette::secondary());
                text(g,valueText(*node,*e.descriptor),line.removeFromRight(80),9.5f,Palette::muted(),juce::Justification::centredRight);
            }
        }
    };
    FxPage& page_;
    std::optional<FxNode> node_;
    std::array<juce::TextButton,3> tabs_;
    juce::Viewport viewport_;
    Rows rows_;
    int tab_=0,shownTab_=-1;
    FxNodeId shownId_=0xffffffffu;
    FxEffectType shownEffect_=FxEffectType::None;
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
        auto area=contentBounds().reduced(10,6).withTrimmedTop(26);
        const int cell=area.getWidth()/2;
        for(std::size_t i=0;i<sliders_.size();++i) {
            auto r=juce::Rectangle<int>(area.getX()+int(i%2)*cell,area.getY()+int(i/2)*(area.getHeight()/2),cell,area.getHeight()/2);
            sliders_[i].setBounds(r.withTrimmedBottom(16).withSizeKeepingCentre(46,46));
        }
    }
private:
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(10,6).withTrimmedTop(6);
        text(g,"SHARED WITH SYNTH MACROS",area.removeFromTop(18),8.5f,Palette::muted());
        area.removeFromTop(2);
        const int cell=area.getWidth()/2;
        for(int i=0;i<4;++i) {
            auto r=juce::Rectangle<int>(area.getX()+(i%2)*cell,area.getY()+(i/2)*(area.getHeight()/2),cell,area.getHeight()/2);
            text(g,"MACRO "+juce::String(i+1),r.removeFromBottom(16),9.0f,Palette::muted(),juce::Justification::centred);
        }
    }
    ModulationBindings bindings_;
    std::array<juce::Slider,4> sliders_;
};

class FxPage::GlobalFxPanel final : public Panel {
public:
    explicit GlobalFxPanel(FxPage& page):Panel("GLOBAL FX"),page_(page) {
        const char* names[]{"INPUT","DRY/WET","WIDTH","OUTPUT"};
        const double lo[]{-24.0,0.0,0.0,-24.0},hi[]{24.0,1.0,2.0,24.0};
        for(std::size_t i=0;i<knobs_.size();++i) {
            auto& k=knobs_[i];
            configureKnob(k);
            k.setRange(lo[i],hi[i],0.001);
            k.setName(juce::String("FX Global ")+names[i]);
            k.onDragStart=[this]{page_.beginParameterGesture();};
            k.onDragEnd=[this]{page_.endParameterGesture();};
            k.onValueChange=[this]{
                FxGlobalSettings s;
                s.inputGainDb=float(knobs_[0].getValue());
                s.dryWet=float(knobs_[1].getValue());
                s.width=float(knobs_[2].getValue());
                s.outputGainDb=float(knobs_[3].getValue());
                page_.setGlobals(s);
            };
            addAndMakeVisible(k);
        }
        knobs_[0].setDoubleClickReturnValue(true,0.0);
        knobs_[1].setDoubleClickReturnValue(true,1.0);
        knobs_[2].setDoubleClickReturnValue(true,1.0);
        knobs_[3].setDoubleClickReturnValue(true,0.0);
        // Fixed today and stated truthfully: FX run after the synth voice sum,
        // and bypass is a short click-free crossfade.
        order_.addItem("POST SYNTH",1);
        bypass_.addItem("CROSSFADE",1);
        for(auto* c:{&order_,&bypass_}) { c->setSelectedId(1,juce::dontSendNotification); c->setEnabled(false); addAndMakeVisible(c); }
    }
    void show(const FxGlobalSettings& s) {
        settings_=s;
        const float values[]{s.inputGainDb,s.dryWet,s.width,s.outputGainDb};
        for(std::size_t i=0;i<knobs_.size();++i)
            if(!knobs_[i].isMouseButtonDown()) knobs_[i].setValue(values[i],juce::dontSendNotification);
        repaint();
    }
    void resized() override {
        auto area=contentBounds().reduced(10,6).withTrimmedTop(8);
        auto knobs=area.removeFromTop(92).withTrimmedBottom(30);
        const int width=knobs.getWidth()/4;
        for(auto& k:knobs_) k.setBounds(knobs.removeFromLeft(width).withSizeKeepingCentre(46,46));
        area.removeFromTop(10);
        order_.setBounds(area.removeFromTop(26).withTrimmedLeft(104).withWidth(170));
        area.removeFromTop(6);
        bypass_.setBounds(area.removeFromTop(26).withTrimmedLeft(104).withWidth(170));
    }
private:
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(10,6).withTrimmedTop(8);
        auto knobs=area.removeFromTop(92);
        auto values=knobs.removeFromBottom(14);
        auto labels=knobs.removeFromBottom(16);
        const int width=labels.getWidth()/4;
        const juce::String texts[]{juce::String(settings_.inputGainDb,1)+" dB",juce::String(juce::roundToInt(settings_.dryWet*100))+"%",
                                   juce::String(juce::roundToInt(settings_.width*100))+"%",juce::String(settings_.outputGainDb,1)+" dB"};
        int i=0;
        for(const char* n:{"INPUT","DRY/WET","WIDTH","OUTPUT"}) {
            text(g,n,labels.removeFromLeft(width),9.0f,Palette::muted(),juce::Justification::centred);
            text(g,texts[i++],values.removeFromLeft(width),9.0f,Palette::secondary(),juce::Justification::centred);
        }
        area.removeFromTop(10);
        text(g,"FX ORDER",area.removeFromTop(26),9.0f,Palette::secondary());
        area.removeFromTop(6);
        text(g,"BYPASS MODE",area.removeFromTop(26),9.0f,Palette::secondary());
    }
    FxPage& page_;
    FxGlobalSettings settings_{};
    std::array<juce::Slider,4> knobs_;
    juce::ComboBox order_,bypass_;
};

// ================================================================ page

FxPage::FxPage(FxGraphDocument& document,ModulationBindings bindings,PeakSource peaks)
    : document_(document),bindings_(std::move(bindings)),peaks_(std::move(peaks)),canvas_(*this) {
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
    undo_.onClick=[this]{undo();};
    redo_.onClick=[this]{redo();};
    clear_.onClick=[this]{clearGraph();};
    templates_.onClick=[this]{showTemplatesMenu(templates_);};
    add_.onClick=[this]{showAddEffectMenu(add_);};
    for(auto* b:{&undo_,&redo_,&clear_,&templates_,&add_}) addAndMakeVisible(b);
    rail_.onBusClicked=[this](BusId bus) {
        if(const auto existing=graph().sourceForBus(bus)) { selectNode(existing); return; }
        FxNodeId created=invalidFxNodeId;
        document_.edit([&](FxGraph& g){
            created=g.addBusSource(bus,{40.0f,40.0f+110.0f*float(g.nodes().size()%5)});
            return created!=invalidFxNodeId;
        });
        if(created!=invalidFxNodeId) selected_=created;
        refresh(true);
    };
    addAndMakeVisible(rail_);
    viewport_.setViewedComponent(&canvas_,false);
    viewport_.setScrollBarsShown(true,true,true,true);
    viewport_.setScrollBarThickness(10);
    addAndMakeVisible(viewport_);
    selectedPanel_=std::make_unique<SelectedPanel>(*this);
    parametersPanel_=std::make_unique<ParametersPanel>(*this);
    macrosPanel_=std::make_unique<FxMacrosPanel>(bindings_);
    globalPanel_=std::make_unique<GlobalFxPanel>(*this);
    addAndMakeVisible(*selectedPanel_);
    addAndMakeVisible(*parametersPanel_);
    addAndMakeVisible(*macrosPanel_);
    addAndMakeVisible(*globalPanel_);
    refresh(true);
    refreshRail();
}

FxPage::~FxPage() {
    stopTimer();
    viewport_.setViewedComponent(nullptr,false);
}

void FxPage::visibilityChanged() {
    // Meter animation only while the page is on screen.
    if(isVisible()) startTimerHz(30); else stopTimer();
}

void FxPage::resized() {
    auto area=getLocalBounds();
    auto toolbar=area.removeFromTop(toolbarHeight).reduced(12,8);
    toolbar.removeFromLeft(132);
    for(auto& mode:modes_) mode.setBounds(toolbar.removeFromLeft(88).reduced(2,0));
    add_.setBounds(toolbar.removeFromRight(132).reduced(2,0));
    toolbar.removeFromRight(10);
    templates_.setBounds(toolbar.removeFromRight(104).reduced(2,0));
    clear_.setBounds(toolbar.removeFromRight(74).reduced(2,0));
    redo_.setBounds(toolbar.removeFromRight(70).reduced(2,0));
    undo_.setBounds(toolbar.removeFromRight(70).reduced(2,0));

    auto inspector=area.removeFromBottom(inspectorHeight);
    rail_.setBounds(area.removeFromLeft(railWidth));
    viewport_.setBounds(area);
    const int w=inspector.getWidth();
    selectedPanel_->setBounds(inspector.removeFromLeft(juce::roundToInt(w*.28f)));
    parametersPanel_->setBounds(inspector.removeFromLeft(juce::roundToInt(w*.30f)));
    macrosPanel_->setBounds(inspector.removeFromLeft(juce::roundToInt(w*.17f)));
    globalPanel_->setBounds(inspector);
    refresh(true);
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
    if((key==juce::KeyPress::deleteKey || key==juce::KeyPress::backspaceKey) && selected_!=invalidFxNodeId)
        return deleteNode(selected_);
    return false;
}

void FxPage::syncFromModel() {
    refresh(false);
    refreshRail();
}

void FxPage::refreshRail() {
    if(!bindings_.snapshot) {
        rail_.setBuses({{fxMainBusId,"BUS 1",graph().sourceForBus(fxMainBusId)!=invalidFxNodeId}});
        return;
    }
    const auto state=bindings_.snapshot();
    std::vector<FxSourceRail::Entry> entries;
    for(std::size_t i=0;i<state.buses.count;++i) {
        const auto& bus=state.buses.buses[i];
        entries.push_back({bus.id,juce::String(bus.label()),graph().sourceForBus(bus.id)!=invalidFxNodeId});
    }
    rail_.setBuses(std::move(entries));
    macrosPanel_->sync(state);
}

void FxPage::updateMeters() {
    if(!peaks_) return;
    const auto [left,right]=peaks_();
    // Peak hold with smooth UI-side decay; the audio thread only stores peaks.
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
    canvas_.rebuild(graph,selected_,viewport_.getMaximumVisibleWidth(),viewport_.getMaximumVisibleHeight());
    selectedPanel_->show(graph,selected_);
    parametersPanel_->show(graph,selected_);
    globalPanel_->show(graph.globals());
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

FxNodeId FxPage::addEffect(FxEffectType type) {
    if(graph().routingMode()!=FxRoutingMode::Serial) {
        // Free-placement modes: drop the module in view, unconnected.
        const auto view=viewport_.getViewArea();
        return addEffectAt(type,{float(view.getX()+150),float(view.getY()+110)});
    }
    FxNodeId created=invalidFxNodeId;
    document_.edit([&](FxGraph& g){created=g.insertEffectBeforeOutput(type);return created!=invalidFxNodeId;});
    if(created!=invalidFxNodeId) selected_=created;
    refresh(true);
    canvas_.bringToFront(created);
    return created;
}

FxNodeId FxPage::addEffectAt(FxEffectType type,FxPoint at) {
    // `at` is where the user clicked; centre the new module on it.
    FxNodeId created=invalidFxNodeId;
    document_.edit([&](FxGraph& g){created=g.addEffect(type,{at.x-106.0f,at.y-88.0f});return created!=invalidFxNodeId;});
    if(created!=invalidFxNodeId) selected_=created;
    refresh(true);
    canvas_.bringToFront(created);
    return created;
}

FxNodeId FxPage::insertEffectOnConnection(FxConnectionId connection,FxEffectType type,FxPoint at) {
    // One atomic edit: A -> B becomes A -> X -> B, or nothing changes.
    FxNodeId created=invalidFxNodeId;
    document_.edit([&](FxGraph& g){
        created=g.insertEffectOnConnection(connection,type,{at.x-106.0f,at.y-88.0f});
        return created!=invalidFxNodeId;
    });
    if(created!=invalidFxNodeId) selected_=created;
    refresh(true);
    canvas_.bringToFront(created);
    return created;
}

bool FxPage::addLayoutPoint(FxConnectionId connection,FxPoint at) {
    const auto index=canvas_.layoutInsertIndex(connection,{at.x,at.y});
    const bool ok=document_.edit([&](FxGraph& g){return g.addLayoutPoint(connection,index,at)==FxEditResult::Ok;});
    refresh(true);
    return ok;
}

bool FxPage::moveLayoutPoint(FxConnectionId connection,std::size_t index,FxPoint at,bool live) {
    // A point drag is one undo step: live moves inside a gesture, commit on release.
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
    document_.edit([mode](FxGraph& g){g.setRoutingMode(mode);return true;});
    refresh(true);
}

void FxPage::clearGraph() {
    document_.edit([](FxGraph& g){g.clearProcessing();return true;});
    refresh(true);
}

void FxPage::undo() { document_.undo(); refresh(true); }
void FxPage::redo() { document_.redo(); refresh(true); }

void FxPage::commitMove(FxNodeId id,juce::Point<int> topLeft) {
    document_.edit([&](FxGraph& g){return g.moveNode(id,{float(topLeft.x),float(topLeft.y)})==FxEditResult::Ok;});
    refresh(true);
}

bool FxPage::connectPorts(FxPortRef from,FxPortRef to) {
    // Dropping onto an occupied port replaces its wire; the whole replacement
    // is one undo step and is rolled back if the new wire is invalid.
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

void FxPage::setGlobals(const FxGlobalSettings& settings) {
    const auto apply=[&](FxGraph& g){g.setGlobals(settings);return true;};
    if(gestureActive_) document_.gestureEdit(apply); else document_.edit(apply);
    refresh(false);
}

void FxPage::endParameterGesture() {
    gestureActive_=false;
    document_.endGesture();
    refreshToolbar();
}

void FxPage::showAddEffectMenu(juce::Component& anchor,std::function<void(FxEffectType)> chosen) {
    std::vector<NativeChoiceItem> items;
    for(const auto& d:fxEffectCatalog()) {
        juce::String label(d.label);
        if(!d.processesAudio) label+="  (UI only)";
        items.push_back({int(d.type),label,true,categoryName(d.category)});
    }
    juce::Component::SafePointer<FxPage> safe(this);
    showNativeChoiceMenu(anchor,"ADD EFFECT",items,0,[safe,chosen](int choice) {
        if(safe==nullptr || choice<=0) return;
        const auto type=static_cast<FxEffectType>(choice);
        if(chosen) chosen(type); else safe->addEffect(type);
    });
}

void FxPage::showTemplatesMenu(juce::Component& anchor) {
    juce::Component::SafePointer<FxPage> safe(this);
    showNativeChoiceMenu(anchor,"TEMPLATES",{
        {1,"Serial Chain",true,"ROUTING"},
        {2,"Parallel (later)",false,"ROUTING"},
        {3,"Split (later)",false,"ROUTING"},
        {4,"Send / Return (later)",false,"ROUTING"},
        {9,"Clean (BUS 1 -> MASTER OUT)",true,"START"},
        {10,"Development Graph",true,"DEVELOPMENT"}},0,[safe](int choice) {
        if(safe==nullptr) return;
        if(choice==1) safe->document_.edit([](FxGraph& g){return g.applyTemplate(FxRoutingMode::Serial);});
        if(choice==9) safe->document_.edit([](FxGraph& g){g=makeDefaultFxGraph();return true;});
        if(choice==10) safe->document_.edit([](FxGraph& g){g=makeDevelopmentFxGraph();return true;});
        safe->refresh(true);
    });
}

juce::String FxPage::inspectorHeadline() const { return selectedPanel_->headline(); }

juce::String FxPage::parameterTabName() const {
    const char* names[]{"MAIN","MODULATION","ADVANCED"};
    return names[parametersPanel_->tab()];
}

void FxPage::selectParameterTab(int index) { parametersPanel_->selectTab(index); }

}
