// mct-origami-lfo-editor-controls
#pragma once
#include <JuceHeader.h>
#include <optional>
#include <vector>

namespace mct::origami::ui {

// A monochrome vector icon compiled into the binary (assets/icons/...).
//
// The SVG is parsed ONCE into filled paths; each path keeps its relative
// brightness (the source art is white with a few light-grey layers), so one
// tint colour reproduces the drawing's internal hierarchy. Rendering is pure
// vector filling at the destination resolution: crisp at every editor scale
// and on Retina, no raster cache, no state-specific copies of the asset.
class OrigamiIcon {
public:
    struct Layer { juce::Path path; float level=1.0f; };

    static OrigamiIcon fromSvg(const void* data,std::size_t size);

    bool isValid() const noexcept { return !layers_.empty() && !bounds_.isEmpty(); }
    std::size_t layerCount() const noexcept { return layers_.size(); }
    // Union of the painted geometry (not the SVG viewBox): what is centred.
    juce::Rectangle<float> contentBounds() const noexcept { return bounds_; }

    // Fits the drawing's content into `area` (aspect preserved, centred) and
    // fills every layer with `tint` scaled by the layer's level.
    void draw(juce::Graphics&,juce::Rectangle<float> area,juce::Colour tint) const;
    juce::AffineTransform transformFor(juce::Rectangle<float> area) const noexcept;

private:
    std::vector<Layer> layers_;
    juce::Rectangle<float> bounds_{};
};

// Every icon Origami compiles in. Order is the LFO toolbar order.
enum class IconId {
    LfoRetrigger,LfoEnvelope,LfoFree,LfoPingPong,LfoCustomPath,
    GridAlignment,SnapGrid,DirectionForward,DirectionBackward,
    Count
};

// The compiled resource behind an icon (BinaryData symbol name).
const char* iconResourceName(IconId) noexcept;
// Parsed once on first use (message thread) from the compiled resources.
const OrigamiIcon& icon(IconId);

// Interaction state -> tint. One table for every Origami icon control.
enum class IconState { Normal,Hover,Pressed,Active,ActiveHover,Disabled };
juce::Colour iconTint(IconState) noexcept;

// A clickable icon. Toggle state == "active/selected" (red). Geometry also
// carries state so colour is never the only cue: hover lifts the cell,
// pressed darkens it and nudges the glyph, active adds a base marker.
class IconButton : public juce::Button {
public:
    IconButton(const juce::String& name,IconId);
    IconId iconId() const noexcept { return icon_; }
    // Glyph size as a fraction of the cell height (0.55..0.70 by design).
    void setGlyphFraction(float f) noexcept { glyphFraction_=f; repaint(); }
    float glyphFraction() const noexcept { return glyphFraction_; }
    // Small per-icon optical correction (in units of the glyph box).
    void setOpticalAdjust(float scale,juce::Point<float> offset={}) noexcept { opticalScale_=scale; opticalOffset_=offset; repaint(); }
    // Show the base marker for the active state (off inside stacked selectors,
    // where the cell background already reads as the selection).
    void setActiveMarker(bool on) noexcept { activeMarker_=on; repaint(); }
    // Status indicators (on/off facts rather than a selected choice) can show
    // "active" in a neutral tint so red stays reserved for selections.
    void setActiveTint(std::optional<juce::Colour> c) noexcept { activeTint_=c; repaint(); }

    static IconState stateFor(bool enabled,bool active,bool over,bool down) noexcept;
    IconState visualState() const noexcept;
    juce::Rectangle<float> glyphArea() const noexcept;

protected:
    void paintButton(juce::Graphics&,bool over,bool down) override;

private:
    IconId icon_;
    float glyphFraction_=0.62f,opticalScale_=1.0f;
    juce::Point<float> opticalOffset_{};
    bool activeMarker_=true;
    std::optional<juce::Colour> activeTint_;
};

// A display-only icon (no interaction), e.g. the GRID label glyph.
class IconView : public juce::Component,public juce::SettableTooltipClient {
public:
    explicit IconView(IconId id) : icon_(id) { setInterceptsMouseClicks(true,false); }
    void setGlyphFraction(float f) noexcept { glyphFraction_=f; repaint(); }
    void paint(juce::Graphics&) override;
private:
    IconId icon_;
    float glyphFraction_=0.62f;
};

}
