// mct-origami-fx-page-foundation-p01
#include "FxPage.h"
#include "NativeChoiceMenu.h"
#include <cmath>

namespace mct::origami::ui {
namespace {
using namespace mct::origami::fx;

constexpr int toolbarHeight=38;
constexpr int inspectorHeight=232;
constexpr int railWidth=112;
constexpr float portRadius=4.0f;
constexpr float portHitRadius=11.0f;

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

// Parameter-driven preview of what the module WILL do. It is drawn from model
// values only; there is no audio analysis behind it.
void paintEffectPreview(juce::Graphics& g,juce::Rectangle<float> r,const FxNode& n) {
    well(g,r.toNearestInt());
    auto in=r.reduced(7.0f,6.0f);
    const auto value=[&n](FxParameterId id,float fallback){return n.parameter(id).value_or(fallback);};
    const auto ink=Palette::accent().withAlpha(n.enabled ? .82f : .28f);
    g.setColour(Palette::borderSoft().withAlpha(.8f));
    g.drawHorizontalLine(juce::roundToInt(in.getCentreY()),in.getX(),in.getRight());
    juce::Path path;
    switch(n.effect) {
    case FxEffectType::Drive: {
        const float k=1.0f+value(1,.35f)*9.0f;
        for(int i=0;i<=48;++i) {
            const float x=-1.0f+2.0f*float(i)/48.0f;
            const float y=std::tanh(k*x)/std::tanh(k);
            const juce::Point<float> p{in.getX()+(x+1.0f)*.5f*in.getWidth(),in.getCentreY()-y*in.getHeight()*.46f};
            if(i==0) path.startNewSubPath(p); else path.lineTo(p);
        }
        g.setColour(ink);
        g.strokePath(path,juce::PathStrokeType(1.4f));
        break;
    }
    case FxEffectType::Delay: {
        const float spacing=in.getWidth()*(.10f+.26f*value(1,.4f));
        const float decay=.25f+.70f*value(2,.35f);
        float level=1.0f;
        g.setColour(ink);
        for(float x=in.getX()+2.0f;x<in.getRight() && level>.04f;x+=spacing,level*=decay)
            g.fillRect(juce::Rectangle<float>(x,in.getBottom()-level*in.getHeight(),2.0f,level*in.getHeight()));
        break;
    }
    case FxEffectType::Reverb: {
        const float pre=value(5,0.0f)*in.getWidth()*.25f;
        const float rate=6.0f-5.0f*value(2,.5f);
        const float rise=in.getX()+pre+in.getWidth()*(.03f+.10f*value(1,.6f));
        path.startNewSubPath(in.getX(),in.getBottom());
        path.lineTo(in.getX()+pre,in.getBottom());
        path.lineTo(rise,in.getY()+2.0f);
        for(int i=1;i<=40;++i) {
            const float t=float(i)/40.0f;
            path.lineTo(rise+t*(in.getRight()-rise),in.getBottom()-std::exp(-t*rate)*(in.getHeight()-2.0f));
        }
        auto fill=path;
        fill.lineTo(in.getRight(),in.getBottom());
        fill.closeSubPath();
        g.setColour(ink.withMultipliedAlpha(.14f));
        g.fillPath(fill);
        g.setColour(ink);
        g.strokePath(path,juce::PathStrokeType(1.3f));
        break;
    }
    case FxEffectType::None: break;
    }
}

juce::String kindLabel(FxNodeKind kind) {
    switch(kind) {
    case FxNodeKind::Source: return "AUDIO SOURCE";
    case FxNodeKind::Effect: return "EFFECT";
    case FxNodeKind::Split: return "ROUTING NODE";
    case FxNodeKind::Merge: return "ROUTING NODE";
    case FxNodeKind::Send: return "SEND";
    case FxNodeKind::Return: return "RETURN";
    case FxNodeKind::Output: return "INSTRUMENT OUTPUT";
    }
    return {};
}
}

// ================================================================ node

FxNodeComponent::FxNodeComponent(FxPage& page,FxNodeId id):page_(page),id_(id) {
    for(auto* b:{&power_,&menu_,&remove_}) addChildComponent(b);
    power_.setClickingTogglesState(true);
    power_.setName("Power FX "+juce::String(id));
    power_.onClick=[this]{page_.setNodeEnabled(id_,power_.getToggleState());};
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
    case FxNodeKind::Source: return {0,0,132,76};
    case FxNodeKind::Output: return {0,0,140,156};
    case FxNodeKind::Split: case FxNodeKind::Merge: {
        const int branches=juce::jmax<int>(n.ports.inputs,n.ports.outputs);
        return {0,0,76,juce::jmax(64,22*branches+26)};
    }
    case FxNodeKind::Effect: case FxNodeKind::Send: case FxNodeKind::Return: break;
    }
    return {0,0,184,150};
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
        quick_[i]->setValue(node.parameter(quickIds_[i]).value_or(0.0f),juce::dontSendNotification);

    if(drag_!=Drag::Move)
        setBounds(sizeFor(node).withPosition(juce::roundToInt(node.position.x),juce::roundToInt(node.position.y)));
    resized();
    repaint();
}

juce::Point<float> FxNodeComponent::portCentre(bool input,std::uint8_t port) const noexcept {
    const int count=input ? node_.ports.inputs : node_.ports.outputs;
    const float top=node_.isRouting() ? 22.0f : 0.0f;
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
    auto row=getLocalBounds().removeFromTop(26).reduced(10,5);
    if(node_.kind==FxNodeKind::Effect) {
        power_.setBounds(row.removeFromLeft(30));
        remove_.setBounds(row.removeFromRight(18));
        row.removeFromRight(3);
        menu_.setBounds(row.removeFromRight(22));
        auto knobs=getLocalBounds().withTrimmedTop(84).reduced(10,0).withTrimmedBottom(16);
        const int width=knobs.getWidth()/juce::jmax<int>(1,int(quick_.size()));
        for(auto& slider:quick_) slider->setBounds(knobs.removeFromLeft(width).withSizeKeepingCentre(36,36));
    } else if(node_.isRouting()) {
        remove_.setBounds(getWidth()-21,5,15,14);
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
        g.fillRect(bounds.withHeight(25.0f).reduced(1.0f));
        g.setColour(Palette::borderStrong().withAlpha(.30f));
        g.drawHorizontalLine(25,8.0f,float(getWidth()-8));
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
        auto title=local.withHeight(26).withTrimmedLeft(46).withTrimmedRight(62);
        text(g,node_.name,title,10.5f,node_.enabled ? Palette::text() : Palette::muted());
        // Honest status: Patch 1 effects are graph/UI objects without DSP.
        text(g,"NO DSP",title,7.0f,Palette::muted().withAlpha(.75f),juce::Justification::centredRight);
        paintEffectPreview(g,juce::Rectangle<float>(10.0f,31.0f,float(getWidth()-20),46.0f),node_);
        const auto quick=parametersFor(node_,true,std::nullopt);
        auto labels=local.withTrimmedTop(local.getHeight()-20).reduced(10,0);
        const int width=labels.getWidth()/juce::jmax<int>(1,int(quick.size()));
        for(const auto* p:quick) text(g,p->label,labels.removeFromLeft(width),8.0f,Palette::muted(),juce::Justification::centred);
        break;
    }
    case FxNodeKind::Source: {
        text(g,node_.name,local.withHeight(26).reduced(10,0),10.5f,Palette::text());
        text(g,"VOICE SUM",local.withTrimmedTop(30).withHeight(14).reduced(10,0),8.0f,Palette::muted());
        auto wave=juce::Rectangle<float>(10.0f,48.0f,float(getWidth())-34.0f,18.0f);
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
        text(g,node_.name,local.withHeight(26).reduced(12,0),10.5f,Palette::text());
        // No FX renderer exists yet, so the meters stay at a truthful zero.
        auto meters=local.withTrimmedTop(34).withTrimmedBottom(36).withSizeKeepingCentre(44,local.getHeight()-70);
        for(const char* channel:{"L","R"}) {
            auto column=meters.removeFromLeft(22);
            well(g,column.withTrimmedBottom(14).reduced(4,0));
            text(g,channel,column.removeFromBottom(12),8.0f,Palette::muted(),juce::Justification::centred);
        }
        text(g,"-INF DB",local.withTrimmedTop(local.getHeight()-34).withHeight(14),8.0f,Palette::muted(),juce::Justification::centred);
        text(g,"METERS INACTIVE",local.withTrimmedTop(local.getHeight()-20).withHeight(14),7.0f,Palette::muted().withAlpha(.7f),juce::Justification::centred);
        break;
    }
    case FxNodeKind::Split: case FxNodeKind::Merge: {
        text(g,node_.name,{8,4,getWidth()-30,16},9.0f,Palette::secondary());
        // Geometry tells the story: one line fanning out, or many converging.
        g.setColour(Palette::accent().withAlpha(.55f));
        const bool split=node_.kind==FxNodeKind::Split;
        const auto hub=juce::Point<float>(float(getWidth())*.5f,portCentre(split,0).y);
        const auto single=portCentre(split,0);
        g.drawLine(juce::Line<float>(single,hub),1.2f);
        const int many=split ? node_.ports.outputs : node_.ports.inputs;
        for(std::uint8_t i=0;i<many;++i) g.drawLine(juce::Line<float>(hub,portCentre(!split,i)),1.2f);
        g.fillEllipse(juce::Rectangle<float>(5.0f,5.0f).withCentre(hub));
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
        g.drawEllipse(dot,1.0f);
    };
    for(std::uint8_t i=0;i<node_.ports.inputs;++i) paintPort(true,i);
    for(std::uint8_t i=0;i<node_.ports.outputs;++i) paintPort(false,i);
}

void FxNodeComponent::mouseDown(const juce::MouseEvent& e) {
    page_.grabKeyboardFocus();
    const auto port=portAt(e.position);
    if(port && e.mods.isPopupMenu()) { page_.disconnectPort(id_,port->first,port->second); return; }
    page_.selectNode(id_);
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
        auto* parent=getParentComponent();
        auto at=dragOrigin_+e.getOffsetFromDragStart();
        at.x=juce::jmax(0,at.x);
        at.y=juce::jlimit(0,juce::jmax(0,(parent ? parent->getHeight() : 0)-getHeight()),at.y);
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

void FxCanvas::rebuild(const FxGraph& graph,FxNodeId selected,int minWidth,int minHeight) {
    // Reconcile by stable ID: components survive edits; only added/removed
    // nodes create or destroy components.
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
        addGhost_.setBounds(out->getX(),out->getBottom()+14,out->getWidth(),24);
    content=content.getUnion(addGhost_.getBounds());
    setSize(juce::jmax(minWidth,content.getRight()+160),juce::jmax(minHeight,content.getBottom()+24));

    wires_.clear();
    wires_.reserve(graph.connections().size());
    for(const auto& c:graph.connections()) {
        wires_.push_back({c,{},{}});
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

void FxCanvas::computeWire(Wire& wire) const {
    wire.path=curve(portInCanvas(wire.connection.from.node,false,wire.connection.from.port),
                    portInCanvas(wire.connection.to.node,true,wire.connection.to.port));
    wire.area=wire.path.getBounds().getSmallestIntegerContainer().expanded(6);
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
        if(!node->getBounds().expanded(12).contains(p)) continue;
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
    page_.selectNode(invalidFxNodeId);
    panOrigin_=page_.viewport().getViewPosition();
    juce::ignoreUnused(e);
}

void FxCanvas::mouseDrag(const juce::MouseEvent& e) {
    // Background drag pans the graph when content exceeds the viewport.
    page_.viewport().setViewPosition(panOrigin_-e.getOffsetFromDragStart());
}

// ================================================================ rail

void FxSourceRail::paint(juce::Graphics& g) {
    g.fillAll(Palette::panel());
    g.setColour(Palette::borderSoft());
    g.drawVerticalLine(getWidth()-1,0.0f,float(getHeight()));
    auto area=getLocalBounds().reduced(10,8);
    text(g,"SOURCE",area.removeFromTop(18),10.0f,Palette::secondary());
    area.removeFromTop(4);
    for(const auto domain:{FxSignalDomain::Audio,FxSignalDomain::Control}) {
        text(g,domain==FxSignalDomain::Audio ? "AUDIO" : "CONTROL",area.removeFromTop(16),7.5f,Palette::muted());
        for(const auto& d:fxSourceCatalog()) {
            if(d.domain!=domain) continue;
            auto row=area.removeFromTop(22).withTrimmedBottom(3);
            g.setColour(d.available ? Palette::raised() : Palette::inset());
            g.fillRect(row);
            g.setColour(d.available ? Palette::border() : Palette::borderSoft());
            g.drawRect(row);
            if(d.available) {
                g.setColour(signalSourceColour());
                g.fillEllipse(juce::Rectangle<float>(4.0f,4.0f).withCentre({float(row.getRight()-8),float(row.getCentreY())}));
            }
            text(g,d.label,row.reduced(6,0),7.8f,d.available ? Palette::text() : Palette::muted().withAlpha(.65f));
        }
        area.removeFromTop(6);
    }
    g.setColour(Palette::muted().withAlpha(.75f));
    g.setFont(juce::FontOptions(7.2f));
    g.drawFittedText("Only SYNTH OUT carries audio today. Control buses will reach FX through modulation, never as audio.",
                     area.removeFromTop(60),juce::Justification::topLeft,5,1.0f);
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
        if(node_) params=parametersFor(*node_,false,FxParameterPage::Main);
        std::vector<FxParameterId> ids;
        for(const auto* p:params) if(ids.size()<5) ids.push_back(p->id);
        if(ids!=ids_ || shownId_!=id) {
            knobs_.clear();
            labels_.clear();
            ids_=ids;
            shownId_=id;
            for(const auto pid:ids_) {
                auto knob=std::make_unique<juce::Slider>();
                configureKnob(*knob);
                knob->setRange(0.0,1.0,0.001);
                auto* raw=knob.get();
                knob->onDragStart=[this]{page_.beginParameterGesture();};
                knob->onDragEnd=[this]{page_.endParameterGesture();};
                knob->onValueChange=[this,raw,pid]{if(node_) page_.setParameter(node_->id,pid,float(raw->getValue()));};
                addAndMakeVisible(*knob);
                knobs_.push_back(std::move(knob));
            }
            for(const auto* p:params) if(static_cast<std::size_t>(labels_.size())<ids_.size()) labels_.add(p->label);
        }
        for(std::size_t i=0;i<knobs_.size();++i)
            knobs_[i]->setValue(node_->parameter(ids_[i]).value_or(0.0f),juce::dontSendNotification);
        const bool effect=node_ && node_->kind==FxNodeKind::Effect;
        power_.setVisible(effect);
        power_.setToggleState(effect && node_->enabled,juce::dontSendNotification);
        remove_.setVisible(node_ && (effect || node_->isRouting()));
        resized();
        repaint();
    }
    void resized() override {
        auto area=contentBounds().reduced(8,6).withTrimmedTop(6);
        auto row=area.removeFromTop(20);
        power_.setBounds(row.removeFromLeft(32));
        remove_.setBounds(row.removeFromRight(20));
        area.removeFromTop(6);
        area.removeFromTop(64);
        area.removeFromTop(6);
        auto knobs=area.withTrimmedBottom(14);
        const int width=knobs.getWidth()/juce::jmax<int>(1,int(knobs_.size()));
        for(auto& knob:knobs_) knob->setBounds(knobs.removeFromLeft(width).withSizeKeepingCentre(42,42));
    }
private:
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(8,6).withTrimmedTop(6);
        if(!node_) {
            text(g,"NO NODE SELECTED",area.withTrimmedBottom(area.getHeight()/2),10.0f,Palette::secondary(),juce::Justification::centredBottom);
            text(g,"Select a module in the routing canvas to edit it here.",area.withTrimmedTop(area.getHeight()/2+4),8.5f,Palette::muted(),juce::Justification::centredTop);
            return;
        }
        auto row=area.removeFromTop(20);
        const bool effect=node_->kind==FxNodeKind::Effect;
        text(g,node_->name,row.withTrimmedLeft(effect ? 42 : 0).withTrimmedRight(26),11.0f,Palette::text());
        text(g,effect ? "EFFECT  /  UI PREVIEW, NO DSP YET" : kindLabel(node_->kind),row.withTrimmedRight(28),7.5f,
             Palette::muted(),juce::Justification::centredRight);
        area.removeFromTop(6);
        auto display=area.removeFromTop(64);
        if(effect) {
            paintEffectPreview(g,display.toFloat(),*node_);
            area.removeFromTop(6);
            auto labels=area.removeFromBottom(14);
            const int width=labels.getWidth()/juce::jmax(1,labels_.size());
            for(const auto& label:labels_) text(g,label,labels.removeFromLeft(width),8.0f,Palette::muted(),juce::Justification::centred);
            return;
        }
        well(g,display);
        auto lines=display.reduced(10,6);
        const auto line=[&](const juce::String& s,juce::Colour c){text(g,s,lines.removeFromTop(16),8.5f,c);};
        line(juce::String(node_->ports.inputs)+" INPUT"+(node_->ports.inputs==1?"":"S")+"  /  "
             +juce::String(node_->ports.outputs)+" OUTPUT"+(node_->ports.outputs==1?"":"S"),Palette::secondary());
        switch(node_->kind) {
        case FxNodeKind::Split: line("Copies one signal into parallel branches.",Palette::muted());
            line("Frequency and stereo split modes arrive with FX DSP.",Palette::muted().withAlpha(.7f)); break;
        case FxNodeKind::Merge: line("Sums parallel branches back into one signal.",Palette::muted());
            line("Branch gain and mix ratios arrive with FX DSP.",Palette::muted().withAlpha(.7f)); break;
        case FxNodeKind::Source: line("Post-voice synth sum entering the FX environment.",Palette::muted()); break;
        case FxNodeKind::Output: line("Final instrument output. Meters activate with FX DSP.",Palette::muted()); break;
        case FxNodeKind::Effect: case FxNodeKind::Send: case FxNodeKind::Return: break;
        }
    }
    FxPage& page_;
    std::optional<FxNode> node_;
    FxNodeId shownId_=invalidFxNodeId;
    juce::TextButton power_{"PWR"},remove_{"X"};
    std::vector<std::unique_ptr<juce::Slider>> knobs_;
    std::vector<FxParameterId> ids_;
    juce::StringArray labels_;
};

class FxPage::ParametersPanel final : public Panel {
public:
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
    }
    int tab() const noexcept { return tab_; }
    void selectTab(int index) {
        tab_=juce::jlimit(0,2,index);
        for(int i=0;i<3;++i) tabs_[std::size_t(i)].setToggleState(i==tab_,juce::dontSendNotification);
        show(page_.graph(),page_.selectedNode());
    }
    void show(const FxGraph& graph,FxNodeId id) {
        const auto* node=graph.findNode(id);
        if(node!=nullptr) node_=*node; else node_.reset();
        if(shownId_!=id || shownTab_!=tab_) {
            shownId_=id;
            shownTab_=tab_;
            rows_.clear();
            if(node_ && tab_!=1) {
                for(const auto* p:parametersFor(*node_,false,tab_==0 ? FxParameterPage::Main : FxParameterPage::Advanced)) {
                    Row row{p->id,p->label,std::make_unique<juce::Slider>()};
                    auto* raw=row.slider.get();
                    raw->setSliderStyle(juce::Slider::LinearHorizontal);
                    raw->setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
                    raw->setRange(0.0,1.0,0.001);
                    const auto pid=p->id;
                    raw->onDragStart=[this]{page_.beginParameterGesture();};
                    raw->onDragEnd=[this]{page_.endParameterGesture();};
                    raw->onValueChange=[this,raw,pid]{if(node_) page_.setParameter(node_->id,pid,float(raw->getValue()));};
                    addAndMakeVisible(*raw);
                    rows_.push_back(std::move(row));
                }
            }
        }
        for(auto& row:rows_) row.slider->setValue(node_->parameter(row.id).value_or(0.0f),juce::dontSendNotification);
        resized();
        repaint();
    }
    void resized() override {
        auto area=contentBounds().reduced(8,6).withTrimmedTop(6);
        auto tabs=area.removeFromTop(20);
        for(auto& tab:tabs_) tab.setBounds(tabs.removeFromLeft(90).reduced(1,0));
        area.removeFromTop(8);
        for(auto& row:rows_) row.slider->setBounds(area.removeFromTop(24).withTrimmedLeft(78).withTrimmedRight(48).reduced(0,3));
    }
private:
    struct Row { FxParameterId id; juce::String label; std::unique_ptr<juce::Slider> slider; };
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(8,6).withTrimmedTop(34);
        if(!node_ || node_->kind!=FxNodeKind::Effect) {
            text(g,node_ ? "Routing and terminal nodes have no effect parameters." : "Select an effect module to edit its parameters.",
                 area.removeFromTop(20),8.5f,Palette::muted());
            return;
        }
        if(tab_==1) {
            // Stable identities for the single Origami modulation system.
            text(g,"FX destinations join the existing modulation matrix in a later patch.",area.removeFromTop(18),8.5f,Palette::muted());
            for(const auto* p:parametersFor(*node_,false,std::nullopt)) {
                auto row=area.removeFromTop(17);
                text(g,juce::String(node_->name)+"  "+p->label,row.removeFromLeft(140),8.5f,Palette::secondary());
                text(g,"fx/"+juce::String(node_->id)+"/"+p->key,row,8.0f,Palette::muted().withAlpha(.8f));
            }
            return;
        }
        if(rows_.empty()) { text(g,"No advanced parameters for this effect.",area.removeFromTop(20),8.5f,Palette::muted()); return; }
        for(const auto& row:rows_) {
            auto line=area.removeFromTop(24);
            text(g,row.label,line.removeFromLeft(74),8.5f,Palette::secondary());
            text(g,juce::String(juce::roundToInt(row.slider->getValue()*100.0))+"%",line.removeFromRight(44),8.5f,
                 Palette::muted(),juce::Justification::centredRight);
        }
    }
    FxPage& page_;
    std::optional<FxNode> node_;
    std::array<juce::TextButton,3> tabs_;
    std::vector<Row> rows_;
    int tab_=0,shownTab_=-1;
    FxNodeId shownId_=0xffffffffu;
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
    void sync() {
        if(!bindings_.snapshot) return;
        const auto macros=bindings_.snapshot().modulation.macros;
        for(std::size_t i=0;i<sliders_.size();++i)
            if(!sliders_[i].isMouseButtonDown()) sliders_[i].setValue(macros[i],juce::dontSendNotification);
    }
    void resized() override {
        auto area=contentBounds().reduced(8,6).withTrimmedTop(24);
        const int cell=area.getWidth()/2;
        for(std::size_t i=0;i<sliders_.size();++i) {
            auto r=juce::Rectangle<int>(area.getX()+int(i%2)*cell,area.getY()+int(i/2)*(area.getHeight()/2),cell,area.getHeight()/2);
            sliders_[i].setBounds(r.withTrimmedBottom(14).withSizeKeepingCentre(40,40));
        }
    }
private:
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(8,6).withTrimmedTop(6);
        text(g,"SHARED WITH SYNTH MACROS",area.removeFromTop(16),7.5f,Palette::muted());
        area.removeFromTop(2);
        const int cell=area.getWidth()/2;
        for(int i=0;i<4;++i) {
            auto r=juce::Rectangle<int>(area.getX()+(i%2)*cell,area.getY()+(i/2)*(area.getHeight()/2),cell,area.getHeight()/2);
            text(g,"MACRO "+juce::String(i+1),r.removeFromBottom(14),8.0f,Palette::muted(),juce::Justification::centred);
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
        order_.addItem("POST SYNTH",1);
        bypass_.addItem("HARD BYPASS",1);
        for(auto* c:{&order_,&bypass_}) { c->setSelectedId(1,juce::dontSendNotification); c->setEnabled(false); addAndMakeVisible(c); }
    }
    void show(const FxGlobalSettings& s) {
        const float values[]{s.inputGainDb,s.dryWet,s.width,s.outputGainDb};
        for(std::size_t i=0;i<knobs_.size();++i) knobs_[i].setValue(values[i],juce::dontSendNotification);
    }
    void resized() override {
        auto area=contentBounds().reduced(8,6).withTrimmedTop(24);
        auto knobs=area.removeFromTop(66).withTrimmedBottom(14);
        const int width=knobs.getWidth()/4;
        for(auto& k:knobs_) k.setBounds(knobs.removeFromLeft(width).withSizeKeepingCentre(40,40));
        area.removeFromTop(12);
        order_.setBounds(area.removeFromTop(22).withTrimmedLeft(92).withWidth(150));
        area.removeFromTop(6);
        bypass_.setBounds(area.removeFromTop(22).withTrimmedLeft(92).withWidth(150));
    }
private:
    void paintContent(juce::Graphics& g,juce::Rectangle<int> body) override {
        auto area=body.reduced(8,6).withTrimmedTop(6);
        text(g,"STORED WITH THE GRAPH  /  NOT YET APPLIED TO AUDIO",area.removeFromTop(16),7.5f,Palette::muted());
        area.removeFromTop(2);
        auto labels=area.removeFromTop(66).removeFromBottom(14);
        const int width=labels.getWidth()/4;
        for(const char* n:{"INPUT","DRY/WET","WIDTH","OUTPUT"}) text(g,n,labels.removeFromLeft(width),8.0f,Palette::muted(),juce::Justification::centred);
        area.removeFromTop(12);
        text(g,"FX ORDER",area.removeFromTop(22),8.0f,Palette::secondary());
        area.removeFromTop(6);
        text(g,"BYPASS MODE",area.removeFromTop(22),8.0f,Palette::secondary());
    }
    FxPage& page_;
    std::array<juce::Slider,4> knobs_;
    juce::ComboBox order_,bypass_;
};

// ================================================================ page

FxPage::FxPage(FxGraphDocument& document,ModulationBindings bindings)
    : document_(document),bindings_(std::move(bindings)),canvas_(*this) {
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
    addAndMakeVisible(rail_);
    viewport_.setViewedComponent(&canvas_,false);
    viewport_.setScrollBarsShown(true,true,true,true);
    viewport_.setScrollBarThickness(8);
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
}

FxPage::~FxPage() {
    viewport_.setViewedComponent(nullptr,false);
}

void FxPage::resized() {
    auto area=getLocalBounds();
    auto toolbar=area.removeFromTop(toolbarHeight).reduced(10,7);
    toolbar.removeFromLeft(118);
    for(auto& mode:modes_) mode.setBounds(toolbar.removeFromLeft(76).reduced(1,0));
    add_.setBounds(toolbar.removeFromRight(112).reduced(1,0));
    toolbar.removeFromRight(8);
    templates_.setBounds(toolbar.removeFromRight(92).reduced(1,0));
    clear_.setBounds(toolbar.removeFromRight(62).reduced(1,0));
    redo_.setBounds(toolbar.removeFromRight(58).reduced(1,0));
    undo_.setBounds(toolbar.removeFromRight(58).reduced(1,0));

    auto inspector=area.removeFromBottom(inspectorHeight);
    rail_.setBounds(area.removeFromLeft(railWidth));
    viewport_.setBounds(area);
    const int w=inspector.getWidth();
    selectedPanel_->setBounds(inspector.removeFromLeft(juce::roundToInt(w*.29f)));
    parametersPanel_->setBounds(inspector.removeFromLeft(juce::roundToInt(w*.29f)));
    macrosPanel_->setBounds(inspector.removeFromLeft(juce::roundToInt(w*.18f)));
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
    text(g,"EFFECT ROUTING",toolbar.reduced(12,0).withWidth(116),10.5f,Palette::secondary());
}

bool FxPage::keyPressed(const juce::KeyPress& key) {
    if((key==juce::KeyPress::deleteKey || key==juce::KeyPress::backspaceKey) && selected_!=invalidFxNodeId)
        return deleteNode(selected_);
    return false;
}

void FxPage::syncFromModel() {
    refresh(false);
    macrosPanel_->sync();
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
    if(id==selected_) return;
    selected_=id;
    refresh(true);
}

bool FxPage::deleteNode(FxNodeId id) {
    const bool removed=document_.edit([id](FxGraph& g){return g.removeNode(id)==FxEditResult::Ok;});
    if(removed && selected_==id) selected_=invalidFxNodeId;
    refresh(true);
    return removed;
}

FxNodeId FxPage::addEffect(FxEffectType type) {
    FxNodeId created=invalidFxNodeId;
    document_.edit([&](FxGraph& g) {
        if(g.routingMode()==FxRoutingMode::Serial) {
            created=g.insertEffectBeforeOutput(type);
        } else {
            // Free-placement modes: drop the module in view, unconnected.
            const auto view=viewport_.getViewArea();
            created=g.addEffect(type,{float(view.getX()+40),float(view.getY()+24)});
        }
        return created!=invalidFxNodeId;
    });
    if(created!=invalidFxNodeId) selected_=created;
    refresh(true);
    return created;
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

void FxPage::showAddEffectMenu(juce::Component& anchor) {
    std::vector<NativeChoiceItem> items;
    for(const auto& d:fxEffectCatalog())
        items.push_back({int(d.type),juce::String(d.label)+"  (UI preview, no DSP)",true,"DEVELOPMENT"});
    juce::Component::SafePointer<FxPage> safe(this);
    showNativeChoiceMenu(anchor,"ADD EFFECT",items,0,[safe](int choice) {
        if(safe!=nullptr && choice>0) safe->addEffect(static_cast<FxEffectType>(choice));
    });
}

void FxPage::showTemplatesMenu(juce::Component& anchor) {
    juce::Component::SafePointer<FxPage> safe(this);
    showNativeChoiceMenu(anchor,"TEMPLATES",{
        {1,"Serial Chain",true,"ROUTING"},
        {2,"Parallel (later)",false,"ROUTING"},
        {3,"Split (later)",false,"ROUTING"},
        {4,"Send / Return (later)",false,"ROUTING"},
        {10,"Development Graph",true,"DEVELOPMENT"}},0,[safe](int choice) {
        if(safe==nullptr) return;
        if(choice==1) safe->document_.edit([](FxGraph& g){return g.applyTemplate(FxRoutingMode::Serial);});
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
