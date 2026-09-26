// mct-origami-v32.2.1-scroll-drag-matrix-hotfix
// mct-origami-v26.3.1-postcommit-compile-repair
// mct-origami-v26.3.1-bend-bipolar-global-knob-shortcuts
// mct-origami-v25.1.0-arp-advanced-page
#pragma once
#include <JuceHeader.h>
#include "ui/OrigamiHeader.h"
#include "ui/OscillatorRack.h"
#include "ui/SignalPanels.h"
#include "ui/ModulationPanel.h"
#include "ui/ModulationMatrix.h"
#include "ui/PerformanceKeyboard.h"
#include "ui/ArpeggiatorPanel.h"
#include "ui/OrigamiLayout.h"
#include "ui/GlobalPanel.h"
class OrigamiAudioProcessor;
class OrigamiAudioProcessorEditor final : public juce::AudioProcessorEditor,
                                         public juce::DragAndDropContainer,
                                         public juce::DragAndDropTarget,
                                         private juce::Timer {
public:
    explicit OrigamiAudioProcessorEditor(OrigamiAudioProcessor&);
    ~OrigamiAudioProcessorEditor() override;
    void paint(juce::Graphics&) override;
    void paintOverChildren(juce::Graphics&) override;
    void resized() override;

    bool isInterestedInDragSource(const SourceDetails&) override;
    void itemDragEnter(const SourceDetails&) override;
    void itemDragMove(const SourceDetails&) override;
    void itemDragExit(const SourceDetails&) override;
    void itemDropped(const SourceDetails&) override;
private:
    class WavetableEditorSurface final : public juce::Component {
    public:
        std::function<void()> onClose;
        WavetableEditorSurface() {
            setWantsKeyboardFocus(true);
            setFocusContainerType(juce::Component::FocusContainerType::keyboardFocusContainer);
            addAndMakeVisible(close_);
            close_.setButtonText("X");
            close_.setTooltip("Close wavetable editor");
            close_.setMouseCursor(juce::MouseCursor::PointingHandCursor);
            close_.onClick=[this] { if(onClose) onClose(); };
        }
        void resized() override {
            constexpr int size=24;
            constexpr int inset=8;
            close_.setBounds(getWidth()-inset-size,inset,size,size);
            close_.toFront(false);
        }
        void paint(juce::Graphics& g) override {
            // Editing tools/content intentionally remain absent. The close
            // control is navigation chrome, not part of the editor toolset.
            g.fillAll(mct::origami::ui::Palette::background());
        }
        bool keyPressed(const juce::KeyPress& key) override {
            if(key==juce::KeyPress::escapeKey && onClose) {
                onClose();
                return true;
            }
            return false;
        }
    private:
        juce::TextButton close_{"X"};
    };
    void openWavetableEditor(unsigned oscillatorId);
    void closeWavetableEditor();
    void timerCallback() override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDoubleClick(const juce::MouseEvent&) override;
    static juce::Slider* sliderFromMouseEvent(const juce::MouseEvent&) noexcept;
    static bool isKnob(const juce::Slider&) noexcept;
    void registerKnobDefaults(juce::Component&);
    double defaultForKnob(juce::Slider&) const noexcept;
    void openKnobValueEditor(juce::Slider&);
    void openKnobProperties(juce::Slider&);
    juce::Slider* modulationDropTargetAt(juce::Point<int>) const noexcept;
    static bool decodeDraggedModSource(const juce::var&,mct::origami::ModSource&) noexcept;
    bool createDraggedRoute(mct::origami::ModSource,juce::Slider&);
    mct::origami::ui::ModulationBindings dragBindings_;
    juce::Component::SafePointer<juce::Slider> dragPreviewTarget_;
    float dragPreviewAmount_=0.5f;

    bool matrixSelected_=false;
    bool arpSelected_=false;
    bool globalSelected_=false;
    bool wavetableEditorSelected_=false;
    unsigned wavetableEditorOscillatorId_=0;
    WavetableEditorSurface wavetableEditor_;
    [[maybe_unused]] OrigamiAudioProcessor& processor_;
    mct::origami::ui::OrigamiLookAndFeel theme_;
    mct::origami::ui::OrigamiHeader header_;
    mct::origami::ui::OscillatorRack oscillators_;
    mct::origami::ui::MixerPanel mixer_;
    mct::origami::ui::FilterPanel filter_;
    mct::origami::ui::FxPanel fxPre_{true},fxPost_{false};
    mct::origami::ui::ModulationPanel modulation_;
    mct::origami::ui::MacroPanel macros_;
    mct::origami::ui::ModulationMatrix matrix_;
    mct::origami::ui::PerformanceKeyboard performance_;
    mct::origami::ui::ArpeggiatorPanel arpeggiator_;
    mct::origami::ui::GlobalPanel global_;
    // Tooltips intentionally disabled. Origami now relies on direct labels,
    // native context menus and explicit controls instead of stale hover copy.
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(OrigamiAudioProcessorEditor)
};
