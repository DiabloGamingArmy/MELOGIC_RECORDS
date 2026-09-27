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
        static constexpr int editorHeaderHeight=30;
        static constexpr int regionHeaderHeight=20;
        static constexpr int timelineHeight=125;
        static constexpr int tableHeight=44;
        static constexpr int contentGutter=4;

        class EditorRegion final : public juce::Component {
        public:
            explicit EditorRegion(juce::String title):title_(std::move(title)) {}
            juce::Rectangle<int> contentBounds() const noexcept {
                return getLocalBounds().withTrimmedTop(regionHeaderHeight).reduced(contentGutter);
            }
            void paint(juce::Graphics& g) override {
                const auto bounds=getLocalBounds();
                const auto header=bounds.withHeight(regionHeaderHeight);
                const auto content=contentBounds();

                g.setColour(juce::Colour(0xff0b0b0b));
                g.fillRect(bounds);
                g.setColour(juce::Colour(0xff303030));
                g.drawRect(bounds.toFloat().reduced(0.5f),1.0f);

                g.setColour(juce::Colour(0xff111111));
                g.fillRect(header.reduced(1,1));
                g.setColour(juce::Colour(0xff303030));
                g.drawLine(1.0f,static_cast<float>(regionHeaderHeight)-0.5f,
                           static_cast<float>(getWidth())-1.0f,
                           static_cast<float>(regionHeaderHeight)-0.5f,1.0f);

                if(!content.isEmpty()) {
                    g.setColour(juce::Colour(0xff080808));
                    g.fillRect(content);
                    g.setColour(juce::Colour(0xff242424));
                    g.drawRect(content.toFloat().reduced(0.5f),1.0f);
                }

                g.setColour(juce::Colours::white.withAlpha(0.62f));
                g.setFont(juce::Font(juce::FontOptions("Arial",8.5f,juce::Font::bold)));
                g.drawText(title_,header.reduced(7,0),juce::Justification::centredLeft,false);
            }
        private:
            juce::String title_;
        };
    public:
        std::function<void()> onClose;
        WavetableEditorSurface()
            : tools_("TOOLS"),waveform_("WAVEFORM"),spectrum_("SPECTRUM"),
              timeline_("FRAMES"),table_("TABLE") {
            setWantsKeyboardFocus(true);
            setFocusContainerType(juce::Component::FocusContainerType::keyboardFocusContainer);
            for(auto* region:std::array<EditorRegion*,5>{{&tools_,&waveform_,&spectrum_,&timeline_,&table_}})
                addAndMakeVisible(region);
            addAndMakeVisible(close_);
            close_.setButtonText("X");
            close_.setTooltip("Close wavetable editor");
            close_.setMouseCursor(juce::MouseCursor::PointingHandCursor);
            close_.onClick=[this] { if(onClose) onClose(); };
        }
        void resized() override {
            constexpr int closeSize=24;
            constexpr int closeInset=5;

            auto area=getLocalBounds();
            auto title=area.removeFromTop(editorHeaderHeight);
            close_.setBounds(title.removeFromRight(closeSize).withSizeKeepingCentre(closeSize,closeSize)
                                 .translated(-closeInset,0));

            table_.setBounds(area.removeFromBottom(tableHeight));
            timeline_.setBounds(area.removeFromBottom(timelineHeight));

            const int toolsWidth=juce::roundToInt(static_cast<float>(area.getWidth())*.14f);
            const int spectrumWidth=juce::roundToInt(static_cast<float>(area.getWidth())*.30f);
            tools_.setBounds(area.removeFromLeft(toolsWidth));
            spectrum_.setBounds(area.removeFromRight(spectrumWidth));
            waveform_.setBounds(area);

            close_.toFront(false);
        }
        void paint(juce::Graphics& g) override {
            g.fillAll(mct::origami::ui::Palette::background());
            const auto title=juce::Rectangle<int>(0,0,getWidth(),editorHeaderHeight);
            g.setColour(juce::Colour(0xff0b0b0b));
            g.fillRect(title);
            g.setColour(juce::Colour(0xff303030));
            g.drawLine(0.0f,static_cast<float>(editorHeaderHeight)-0.5f,
                       static_cast<float>(getWidth()),static_cast<float>(editorHeaderHeight)-0.5f,1.0f);
            g.setColour(juce::Colours::white.withAlpha(0.72f));
            g.setFont(juce::Font(juce::FontOptions("Arial",9.0f,juce::Font::bold)));
            g.drawText("WAVETABLE EDITOR",title.reduced(10,0),juce::Justification::centredLeft,false);
        }
        bool keyPressed(const juce::KeyPress& key) override {
            if(key==juce::KeyPress::escapeKey && onClose) {
                onClose();
                return true;
            }
            return false;
        }
    private:
        EditorRegion tools_,waveform_,spectrum_,timeline_,table_;
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
