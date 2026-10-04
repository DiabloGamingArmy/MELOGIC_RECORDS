// mct-origami-lfo-editor-controls
#include "OrigamiIcon.h"
#include "OrigamiStyle.h"
#include <BinaryData.h>
#include <array>

namespace mct::origami::ui {
namespace {
void collect(const juce::Drawable& d,const juce::AffineTransform& parent,std::vector<OrigamiIcon::Layer>& out) {
    const auto transform=d.getDrawableTransform().followedBy(parent);
    if(auto* shape=dynamic_cast<const juce::DrawablePath*>(&d)) {
        const auto& fill=shape->getFill();
        if(fill.isInvisible()) return;
        // Brightness of the source paint: white = 1, light grey < 1.
        const auto c=fill.colour;
        const float level=juce::jmax(c.getFloatRed(),c.getFloatGreen(),c.getFloatBlue())*c.getFloatAlpha()*fill.getOpacity();
        auto path=shape->getPath();
        path.applyTransform(transform);
        if(!path.isEmpty()) out.push_back({std::move(path),level});
        return;
    }
    if(auto* composite=dynamic_cast<const juce::DrawableComposite*>(&d))
        for(int i=0;i<composite->getNumChildren();++i) collect(composite->getChild(i),transform,out);
}

struct Resource { const char* name; const char* data; int size; };
Resource resource(IconId id) noexcept {
    switch(id) {
        case IconId::LfoRetrigger:      return {"lfo_retrigger_svg",BinaryData::lfo_retrigger_svg,BinaryData::lfo_retrigger_svgSize};
        case IconId::LfoEnvelope:       return {"lfo_envelope_svg",BinaryData::lfo_envelope_svg,BinaryData::lfo_envelope_svgSize};
        case IconId::LfoFree:           return {"lfo_free_svg",BinaryData::lfo_free_svg,BinaryData::lfo_free_svgSize};
        case IconId::LfoPingPong:       return {"lfo_ping_pong_svg",BinaryData::lfo_ping_pong_svg,BinaryData::lfo_ping_pong_svgSize};
        case IconId::LfoCustomPath:     return {"lfo_custom_path_svg",BinaryData::lfo_custom_path_svg,BinaryData::lfo_custom_path_svgSize};
        case IconId::GridAlignment:     return {"grid_alignment_svg",BinaryData::grid_alignment_svg,BinaryData::grid_alignment_svgSize};
        case IconId::SnapGrid:          return {"snap_grid_svg",BinaryData::snap_grid_svg,BinaryData::snap_grid_svgSize};
        case IconId::DirectionForward:  return {"direction_forward_svg",BinaryData::direction_forward_svg,BinaryData::direction_forward_svgSize};
        case IconId::DirectionBackward: return {"direction_backward_svg",BinaryData::direction_backward_svg,BinaryData::direction_backward_svgSize};
        case IconId::Count: break;
    }
    return {"",nullptr,0};
}
}

OrigamiIcon OrigamiIcon::fromSvg(const void* data,std::size_t size) {
    OrigamiIcon icon;
    if(data==nullptr || size==0) return icon;
    auto drawable=juce::Drawable::createFromImageData(data,size);
    if(drawable==nullptr) return icon;
    collect(*drawable,{},icon.layers_);
    float peak=0.0f;
    for(const auto& layer:icon.layers_) peak=juce::jmax(peak,layer.level);
    for(auto& layer:icon.layers_) {
        layer.level=peak>0.0f ? juce::jlimit(0.0f,1.0f,layer.level/peak) : 1.0f;
        icon.bounds_=icon.bounds_.isEmpty() ? layer.path.getBounds() : icon.bounds_.getUnion(layer.path.getBounds());
    }
    return icon;
}

juce::AffineTransform OrigamiIcon::transformFor(juce::Rectangle<float> area) const noexcept {
    if(bounds_.isEmpty() || area.isEmpty()) return {};
    const float scale=juce::jmin(area.getWidth()/bounds_.getWidth(),area.getHeight()/bounds_.getHeight());
    return juce::AffineTransform::translation(-bounds_.getCentreX(),-bounds_.getCentreY())
        .scaled(scale).translated(area.getCentreX(),area.getCentreY());
}

void OrigamiIcon::draw(juce::Graphics& g,juce::Rectangle<float> area,juce::Colour tint) const {
    if(!isValid() || area.isEmpty()) return;
    const auto t=transformFor(area);
    for(const auto& layer:layers_) {
        g.setColour(tint.withMultipliedAlpha(layer.level));
        g.fillPath(layer.path,t);
    }
}

const char* iconResourceName(IconId id) noexcept { return resource(id).name; }

const OrigamiIcon& icon(IconId id) {
    static std::array<OrigamiIcon,static_cast<std::size_t>(IconId::Count)> cache;
    static std::array<bool,static_cast<std::size_t>(IconId::Count)> loaded{};
    static const OrigamiIcon none;
    const auto index=static_cast<std::size_t>(id);
    if(index>=cache.size()) return none;
    if(!loaded[index]) {
        const auto r=resource(id);
        cache[index]=OrigamiIcon::fromSvg(r.data,static_cast<std::size_t>(juce::jmax(0,r.size)));
        loaded[index]=true;
    }
    return cache[index];
}

juce::Colour iconTint(IconState state) noexcept {
    switch(state) {
        case IconState::Normal:      return Palette::muted().brighter(.18f);
        case IconState::Hover:       return Palette::text();
        case IconState::Pressed:     return juce::Colours::white;
        case IconState::Active:      return signalSourceColour();
        case IconState::ActiveHover: return signalSourceColour().brighter(.28f);
        case IconState::Disabled:    return Palette::borderStrong().darker(.08f);
    }
    return Palette::muted();
}

IconButton::IconButton(const juce::String& name,IconId id) : juce::Button(name),icon_(id) {
    setTriggeredOnMouseDown(false);
}

IconState IconButton::stateFor(bool enabled,bool active,bool over,bool down) noexcept {
    if(!enabled) return IconState::Disabled;
    if(down) return IconState::Pressed;
    if(active) return over ? IconState::ActiveHover : IconState::Active;
    return over ? IconState::Hover : IconState::Normal;
}

IconState IconButton::visualState() const noexcept {
    return stateFor(isEnabled(),getToggleState(),isOver(),isDown());
}

juce::Rectangle<float> IconButton::glyphArea() const noexcept {
    const auto b=getLocalBounds().toFloat();
    const float h=b.getHeight()*glyphFraction_*opticalScale_;
    // Wide silhouettes (the direction arrows) may use a little more width.
    const float w=juce::jmin(b.getWidth()-4.0f,h*1.6f);
    return juce::Rectangle<float>(w,h).withCentre(b.getCentre()+opticalOffset_*h);
}

void IconButton::paintButton(juce::Graphics& g,bool over,bool down) {
    const auto state=stateFor(isEnabled(),getToggleState(),over,down);
    const auto b=getLocalBounds().toFloat().reduced(.5f);
    if(state==IconState::Pressed) { g.setColour(Palette::inset()); g.fillRoundedRectangle(b,2.0f); }
    else if(state==IconState::Hover || state==IconState::ActiveHover) { g.setColour(Palette::raised().brighter(.10f)); g.fillRoundedRectangle(b,2.0f); }
    if(getToggleState() && activeMarker_ && isEnabled()) {
        g.setColour(activeTint_.value_or(signalSourceColour()).withAlpha(.85f));
        g.fillRoundedRectangle(b.getCentreX()-6.0f,b.getBottom()-2.0f,12.0f,1.5f,.75f);
    }
    auto area=glyphArea();
    if(state==IconState::Pressed) area=area.translated(0.0f,.75f);
    auto tint=iconTint(state);
    if(activeTint_ && state==IconState::Active) tint=*activeTint_;
    else if(activeTint_ && state==IconState::ActiveHover) tint=activeTint_->brighter(.25f);
    icon(icon_).draw(g,area,tint);
}

void IconView::paint(juce::Graphics& g) {
    const auto b=getLocalBounds().toFloat();
    const float h=b.getHeight()*glyphFraction_;
    icon(icon_).draw(g,juce::Rectangle<float>(juce::jmin(b.getWidth(),h*1.6f),h).withCentre(b.getCentre()),
                     isEnabled() ? Palette::secondary().withAlpha(.82f) : iconTint(IconState::Disabled));
}

}
