// mct-origami-lfo-editor-controls
#pragma once
#include "OrigamiIcon.h"
#include "core/modulation/Modulation.h"
#include <array>
#include <functional>
#include <optional>
#include <vector>

namespace mct::origami::ui {

// A compact vertical stack of text options (TOOLS/FUNC, BEATS/SECONDS/HZ).
// One component, one selection; selected = white text on a restrained red
// cell, inactive = muted grey, hover = white.
class StackSelector final : public juce::Component,public juce::SettableTooltipClient {
public:
    explicit StackSelector(juce::StringArray options);
    int selected() const noexcept { return selected_; }
    void setSelected(int index,juce::NotificationType=juce::dontSendNotification);
    int optionCount() const noexcept { return options_.size(); }
    juce::Rectangle<int> optionBounds(int index) const noexcept;
    std::function<void(int)> onChange;
    // Selection shown as red text (units) instead of a red-marked cell (pages).
    void setAccentText(bool on) noexcept { accentText_=on; repaint(); }

    void paint(juce::Graphics&) override;
    void mouseMove(const juce::MouseEvent&) override;
    void mouseExit(const juce::MouseEvent&) override;
    void mouseDown(const juce::MouseEvent&) override;
private:
    int indexAt(juce::Point<int>) const noexcept;
    juce::StringArray options_;
    int selected_=0,hover_=-1;
    bool accentText_=false;
};

// A bounded integer field: drag vertically or scroll to step, double-click
// to type. Never leaves [minimum, maximum].
class StepField final : public juce::Label {
public:
    StepField(const juce::String& name,int minimum,int maximum,int value);
    int value() const noexcept { return value_; }
    // Clamps; returns true when the value changed.
    bool setValue(int,juce::NotificationType=juce::dontSendNotification);
    std::function<void(int)> onValueChange;

    void paint(juce::Graphics&) override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseWheelMove(const juce::MouseEvent&,const juce::MouseWheelDetails&) override;
protected:
    void textWasEdited() override;
private:
    int minimum_,maximum_,value_,dragStart_=0;
    float wheel_=0.0f;
};

// The LFO editor's bottom control strip: TOOLS / FUNC.
//
// The strip is a VIEW of one canonical LfoSettings (pushed in with setLfo)
// plus editor-only state (page, rate unit, grid). It never owns sound state:
// every sound edit is a callback the host panel applies to the canonical
// ModulationState, so SYNTH, Matrix and NODES keep seeing the same LFO.
class LfoControlStrip final : public juce::Component {
public:
    enum class Page { Tools=0,Func=1 };
    enum class RateUnit { Beats=0,Seconds=1,Hz=2 };
    static constexpr int minGrid=1,maxGrid=64;
    static constexpr int defaultGridColumns=16,defaultGridRows=8;
    static constexpr int preferredHeight=62;

    struct Callbacks {
        std::function<void(LfoMode)> mode;           // sound: LfoSettings::mode
        std::function<void(float)> rateHz;           // sound: LfoSettings::rateHz
        std::function<void(juce::Component&)> pathTools; // explicit path edits (menu)
        std::function<void(bool)> snap;              // editor: shared editor snap
        std::function<void()> gridChanged;           // editor: repaint the grid
        std::function<double()> bpm;                 // BEATS display only
        std::function<void(float LfoSettings::*,float)> func; // sound: one FUNC value
        std::function<void(bool)> pingPong;          // sound: LfoSettings::pingPong
    };

    LfoControlStrip();
    void setCallbacks(Callbacks c) { callbacks_=std::move(c); }

    // Canonical state -> controls (never calls back).
    void setLfo(std::size_t index,const LfoSettings&,std::uint32_t sourceItem=0);
    void setSnap(bool);

    Page page() const noexcept { return static_cast<Page>(page_.selected()); }
    void setPage(Page);
    RateUnit rateUnit() const noexcept { return static_cast<RateUnit>(unit_.selected()); }
    void setRateUnit(RateUnit);
    int gridColumns() const noexcept { return gridColumns_.value(); }
    int gridRows() const noexcept { return gridRows_.value(); }
    void setGrid(int columns,int rows);

    // Rate presentation (one canonical rate in Hz, three representations).
    struct Division { const char* name; double wholeNotes; };
    static const std::array<Division,21>& divisions() noexcept;
    static double divisionHz(const Division&,double bpm) noexcept;
    static juce::String formatRate(float hz,RateUnit,double bpm);
    static std::optional<float> parseRate(const juce::String&,RateUnit,double bpm);
    juce::String rateText() const { return rateField_.getText(); }
    double currentBpm() const;

    // FUNC bank: the nine processing knobs and whether each is implemented.
    static constexpr std::size_t funcCount=9;
    // field == nullptr: no canonical parameter (the knob stays disabled).
    struct FuncInfo {
        const char* name; const char* tooltip; bool implemented;
        float LfoSettings::* field; double minimum,maximum,neutral,centre;
    };
    static const std::array<FuncInfo,funcCount>& funcInfo() noexcept;
    // User-facing value text (%, ms / s, degrees, levels).
    static juce::String funcValueText(std::size_t index,double value);

    // Inspection (tests, layout audits).
    IconButton& modeButton(LfoMode) noexcept;
    IconButton& pingPongButton() noexcept { return pingPong_; }
    IconButton& customPathButton() noexcept { return customPath_; }
    IconButton& snapButton() noexcept { return snap_; }
    IconButton& forwardButton() noexcept { return forward_; }
    IconButton& reverseButton() noexcept { return reverse_; }
    IconView& gridIcon() noexcept { return gridIcon_; }
    StepField& gridColumnsField() noexcept { return gridColumns_; }
    StepField& gridRowsField() noexcept { return gridRows_; }
    StackSelector& pageSelector() noexcept { return page_; }
    StackSelector& unitSelector() noexcept { return unit_; }
    juce::Slider& rateKnob() noexcept { return rate_; }
    juce::Label& rateField() noexcept { return rateField_; }
    juce::Slider& funcKnob(std::size_t i) noexcept { return func_[i]; }
    juce::Label& funcLabel(std::size_t i) noexcept { return funcLabels_[i]; }
    juce::Viewport& toolsViewport() noexcept { return toolsViewport_; }
    juce::Viewport& funcViewport() noexcept { return funcViewport_; }
    // Group boxes in tools-content coordinates: time, behaviour, grid, direction.
    const std::array<juce::Rectangle<int>,4>& toolGroups() const noexcept { return tools_.groups; }
    static int minimumToolsWidth() noexcept;
    static int minimumFuncWidth() noexcept;

    void resized() override;
    void paint(juce::Graphics&) override;
    void paintOverChildren(juce::Graphics&) override;
    // mct-origami-nested-modulation-manual-qa: LFO RATE is a destination.
    bool rateModulated() const noexcept;

private:
    struct Content final : juce::Component {
        std::array<juce::Rectangle<int>,4> groups{};
        juce::Rectangle<int> divider{};
        void paint(juce::Graphics&) override;
    };
    void configureRateKnob();
    float rateKnobProportion(float hz);
    void refreshRateField();
    void rateKnobMoved();
    void commitRateText();
    void layoutTools(int width);
    void layoutFunc(int width);

    Callbacks callbacks_;
    LfoSettings lfo_{};
    std::size_t index_=0;
    std::uint32_t sourceItem_=1;

    StackSelector page_{{"TOOLS","FUNC"}};
    juce::Viewport toolsViewport_,funcViewport_;
    Content tools_,funcBank_;

    StackSelector unit_{{"BEATS","SECONDS","HZ"}};
    juce::Slider rate_;
    juce::Label rateLabel_,rateField_;

    IconButton retrigger_{"LFO MODE RETRIGGER",IconId::LfoRetrigger};
    IconButton envelope_{"LFO MODE ENVELOPE",IconId::LfoEnvelope};
    IconButton free_{"LFO MODE FREE",IconId::LfoFree};
    IconButton pingPong_{"LFO PING-PONG",IconId::LfoPingPong};
    IconButton customPath_{"LFO CUSTOM PATH",IconId::LfoCustomPath};

    IconView gridIcon_{IconId::GridAlignment};
    // TOP field = horizontal grid lines (level divisions), BOTTOM = vertical
    // grid lines (time divisions), matching the two halves of the grid icon.
    StepField gridRows_{"LFO GRID HORIZONTAL",minGrid,maxGrid,defaultGridRows};
    StepField gridColumns_{"LFO GRID VERTICAL",minGrid,maxGrid,defaultGridColumns};
    IconButton snap_{"LFO SNAP TO GRID",IconId::SnapGrid};

    IconButton forward_{"LFO DIRECTION FORWARD",IconId::DirectionForward};
    IconButton reverse_{"LFO DIRECTION REVERSE",IconId::DirectionBackward};

    std::vector<std::size_t> beatChoices_; // divisions reachable at the current tempo (fast -> slow order reversed: knob clockwise = faster)
    double beatBpm_=0.0;
    std::array<juce::Slider,funcCount> func_{};
    std::array<juce::Label,funcCount> funcLabels_{};
};

}
