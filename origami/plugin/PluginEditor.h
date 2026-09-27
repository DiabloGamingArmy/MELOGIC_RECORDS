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
#include "ui/WavetableDocument.h"
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
        static constexpr int tableHeight=66;
        static constexpr int contentGutter=4;

        class EditorRegion final : public juce::Component {
        public:
            explicit EditorRegion(juce::String title):title_(std::move(title)) {}
            juce::Rectangle<int> contentBounds() const noexcept {
                return getLocalBounds().withTrimmedTop(regionHeaderHeight).reduced(contentGutter);
            }
            void setContentComponent(juce::Component& component) {
                content_=&component;
                addAndMakeVisible(component);
                resized();
            }
        void resized() override {
                if(content_!=nullptr) content_->setBounds(contentBounds());
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
            juce::Component* content_=nullptr;
        };

        class FrameStrip final : public juce::Component {
            class FrameCard final : public juce::Component {
            public:
                std::function<void(unsigned)> onSelected;
                FrameCard(std::uint64_t frameId,unsigned displayIndex,
                          const std::array<float,mct::origami::ui::kWavetableFrameSize>& samples)
                    :displayIndex_(displayIndex),samples_(&samples) {
                    juce::ignoreUnused(frameId);
                    setMouseCursor(juce::MouseCursor::PointingHandCursor);
                    setInterceptsMouseClicks(true,false);
                }
                void setSelected(bool selected) {
                    if(selected_==selected) return;
                    selected_=selected;
                    repaint();
                }
                void mouseDown(const juce::MouseEvent&) override {
                    grabKeyboardFocus();
                    if(onSelected) onSelected(displayIndex_);
                }
                void paint(juce::Graphics& g) override {
                    const auto b=getLocalBounds().toFloat().reduced(0.5f);
                    g.setColour(juce::Colour(0xff0d0d0d));
                    g.fillRect(getLocalBounds());
                    g.setColour(selected_ ? juce::Colour(0xffff1018) : juce::Colour(0xff353535));
                    g.drawRect(b,selected_ ? 1.5f : 1.0f);

                    auto wave=getLocalBounds().reduced(11,10);
                    wave.removeFromBottom(18);
                    if(samples_!=nullptr && !wave.isEmpty()) {
                        juce::Path p;
                        const float mid=static_cast<float>(wave.getCentreY());
                        const float amp=static_cast<float>(wave.getHeight())*.42f;
                        const int points=juce::jmax(2,wave.getWidth());
                        for(int i=0;i<points;++i) {
                            const float t=static_cast<float>(i)/static_cast<float>(points-1);
                            const auto sampleIndex=juce::jmin(
                                samples_->size()-1,
                                static_cast<std::size_t>(t*static_cast<float>(samples_->size()-1)));
                            const float x=static_cast<float>(wave.getX())+t*static_cast<float>(wave.getWidth());
                            const float y=mid-(*samples_)[sampleIndex]*amp;
                            if(i==0) p.startNewSubPath(x,y); else p.lineTo(x,y);
                        }
                        g.setColour(juce::Colours::white.withAlpha(0.78f));
                        g.strokePath(p,juce::PathStrokeType(1.0f));
                    }
                    g.setFont(juce::Font(juce::FontOptions("Arial",8.0f,juce::Font::bold)));
                    g.setColour(juce::Colours::white.withAlpha(0.78f));
                    g.drawText(juce::String(displayIndex_+1),getLocalBounds().removeFromBottom(18),
                               juce::Justification::centred,false);
                }
            private:
                unsigned displayIndex_=0;
                const std::array<float,mct::origami::ui::kWavetableFrameSize>* samples_=nullptr;
                bool selected_=false;
            };

            class AddCard final : public juce::Component {
            public:
                std::function<void()> onClicked;
                AddCard() {
                    setMouseCursor(juce::MouseCursor::PointingHandCursor);
                    setInterceptsMouseClicks(true,false);
                }
                void setAvailable(bool available) {
                    available_=available;
                    setEnabled(available);
                    repaint();
                }
                void mouseDown(const juce::MouseEvent&) override {
                    if(available_ && onClicked) onClicked();
                }
                void paint(juce::Graphics& g) override {
                    const auto b=getLocalBounds().toFloat().reduced(0.5f);
                    g.setColour(juce::Colour(0xff0d0d0d)); g.fillRect(getLocalBounds());
                    g.setColour(available_ ? juce::Colour(0xff353535) : juce::Colour(0xff242424)); g.drawRect(b,1.0f);
                    g.setColour(juce::Colours::white.withAlpha(available_ ? 0.62f : 0.24f));
                    g.setFont(juce::Font(juce::FontOptions("Arial",16.0f,juce::Font::plain)));
                    g.drawText("+",getLocalBounds(),juce::Justification::centred,false);
                }
            private:
                bool available_=true;
            };

        public:
            std::function<void(unsigned)> onFrameSelected;
            explicit FrameStrip(mct::origami::ui::WavetableDocument& document):document_(document) {
                viewport_.setViewedComponent(&content_,false);
                viewport_.setScrollBarsShown(false,false,false,false);
                viewport_.setWantsKeyboardFocus(true);
                addAndMakeVisible(viewport_);
                add_.onClicked=[this] {
                    if(document_.duplicateFrameAfter(document_.selectedFrame)) {
                        rebuild();
                        select(static_cast<unsigned>(document_.selectedFrame));
                    }
                };
                rebuild();
            }
            void rebuild() {
                cards_.clear();
                for(unsigned i=0;i<document_.frames.size();++i) {
                    const auto& frame=document_.frames[i];
                    auto card=std::make_unique<FrameCard>(frame.id,i,frame.samples);
                    card->onSelected=[this](unsigned index){ select(index); };
                    content_.addAndMakeVisible(*card);
                    cards_.push_back(std::move(card));
                }
                content_.addAndMakeVisible(add_);
                add_.setAvailable(document_.frames.size()<mct::origami::ui::kMaxWavetableFrames);
                if(document_.selectedFrame>=cards_.size()) document_.selectedFrame=0;
                for(unsigned i=0;i<cards_.size();++i)
                    cards_[i]->setSelected(i==document_.selectedFrame);
                resized();
            }
            void resized() override {
                viewport_.setBounds(getLocalBounds());
                constexpr int cardWidth=90;
                constexpr int gap=5;
                constexpr int verticalInset=3;
                const int cardHeight=juce::jmax(1,getHeight()-verticalInset*2);
                int x=0;
                for(auto& card:cards_) {
                    card->setBounds(x,verticalInset,cardWidth,cardHeight);
                    x+=cardWidth+gap;
                }
                add_.setBounds(x,verticalInset,cardWidth,cardHeight);
                content_.setSize(juce::jmax(getWidth(),x+cardWidth),getHeight());
            }
            bool keyPressed(const juce::KeyPress& key) override {
                if(key==juce::KeyPress::leftKey && document_.selectedFrame>0) {
                    select(static_cast<unsigned>(document_.selectedFrame-1)); return true;
                }
                if(key==juce::KeyPress::rightKey && document_.selectedFrame+1<cards_.size()) {
                    select(static_cast<unsigned>(document_.selectedFrame+1)); return true;
                }
                return false;
            }
            void select(unsigned index) {
                if(index>=cards_.size()) return;
                document_.selectedFrame=index;
                for(unsigned i=0;i<cards_.size();++i) cards_[i]->setSelected(i==index);
                reveal(index);
                if(onFrameSelected) onFrameSelected(index);
            }
        private:
            void reveal(unsigned index) {
                if(index>=cards_.size()) return;
                const auto card=cards_[index]->getBounds();
                const int viewLeft=viewport_.getViewPositionX();
                const int viewRight=viewLeft+viewport_.getWidth();
                int target=viewLeft;
                if(card.getX()<viewLeft) target=card.getX();
                else if(card.getRight()>viewRight) target=card.getRight()-viewport_.getWidth();
                target=juce::jlimit(0,juce::jmax(0,content_.getWidth()-viewport_.getWidth()),target);
                viewport_.setViewPosition(target,0);
            }
            mct::origami::ui::WavetableDocument& document_;
            juce::Viewport viewport_;
            juce::Component content_;
            std::vector<std::unique_ptr<FrameCard>> cards_;
            AddCard add_;
        };

        class WaveformCanvas final : public juce::Component {
        public:
            explicit WaveformCanvas(mct::origami::ui::WavetableDocument& document):document_(document) {
                setInterceptsMouseClicks(false,false);
            }
            void refresh() { repaint(); }
            void paint(juce::Graphics& g) override {
                const auto bounds=getLocalBounds();
                if(bounds.isEmpty() || !document_.valid()) return;

                constexpr int leftPad=34;
                constexpr int rightPad=10;
                constexpr int topPad=22;
                constexpr int bottomPad=20;
                auto plot=bounds.withTrimmedLeft(leftPad).withTrimmedRight(rightPad)
                                .withTrimmedTop(topPad).withTrimmedBottom(bottomPad);
                if(plot.getWidth()<2 || plot.getHeight()<2) return;

                const auto mapY=[&](float value) {
                    return static_cast<float>(plot.getCentreY())-
                           value*(static_cast<float>(plot.getHeight())*0.5f);
                };

                g.setFont(juce::Font(juce::FontOptions("Arial",7.5f,juce::Font::plain)));
                const std::array<float,5> levels{{1.0f,0.5f,0.0f,-0.5f,-1.0f}};
                for(const float level:levels) {
                    const float y=mapY(level);
                    const bool zero=std::abs(level)<0.001f;
                    g.setColour(juce::Colours::white.withAlpha(zero ? 0.22f : 0.09f));
                    g.drawHorizontalLine(juce::roundToInt(y),static_cast<float>(plot.getX()),
                                         static_cast<float>(plot.getRight()));
                    g.setColour(juce::Colours::white.withAlpha(zero ? 0.48f : 0.28f));
                    const juce::String label=zero ? "0.0" : juce::String(level,1);
                    g.drawText(label,2,juce::roundToInt(y)-7,leftPad-7,14,
                               juce::Justification::centredRight,false);
                }

                constexpr int divisions=8;
                for(int division=0;division<=divisions;++division) {
                    const float t=static_cast<float>(division)/static_cast<float>(divisions);
                    const float x=static_cast<float>(plot.getX())+t*static_cast<float>(plot.getWidth());
                    g.setColour(juce::Colours::white.withAlpha(division==0 || division==divisions ? 0.12f : 0.065f));
                    g.drawVerticalLine(juce::roundToInt(x),static_cast<float>(plot.getY()),
                                       static_cast<float>(plot.getBottom()));
                    const int sample=division==divisions ? 2047 : division*256;
                    g.setColour(juce::Colours::white.withAlpha(0.25f));
                    const int labelWidth=38;
                    g.drawText(juce::String(sample),juce::roundToInt(x)-labelWidth/2,plot.getBottom()+3,
                               labelWidth,12,juce::Justification::centred,false);
                }

                const auto& samples=document_.frames[document_.selectedFrame].samples;
                const int columns=juce::jmax(1,plot.getWidth());
                juce::Path envelope;
                bool started=false;
                for(int column=0;column<columns;++column) {
                    const std::size_t begin=static_cast<std::size_t>(
                        (static_cast<std::uint64_t>(column)*samples.size())/static_cast<std::uint64_t>(columns));
                    const std::size_t end=juce::jmax(begin+1,
                        static_cast<std::size_t>((static_cast<std::uint64_t>(column+1)*samples.size())/
                                                 static_cast<std::uint64_t>(columns)));
                    float minimum=1.0f,maximum=-1.0f;
                    for(std::size_t i=begin;i<juce::jmin(end,samples.size());++i) {
                        minimum=juce::jmin(minimum,samples[i]);
                        maximum=juce::jmax(maximum,samples[i]);
                    }
                    const float x=static_cast<float>(plot.getX()+column)+0.5f;
                    const float yTop=mapY(maximum);
                    const float yBottom=mapY(minimum);
                    if(!started) { envelope.startNewSubPath(x,yTop); started=true; }
                    else envelope.startNewSubPath(x,yTop);
                    envelope.lineTo(x,yBottom);
                }
                g.setColour(juce::Colours::white.withAlpha(0.90f));
                g.strokePath(envelope,juce::PathStrokeType(1.0f));

                g.setColour(juce::Colours::white.withAlpha(0.32f));
                g.setFont(juce::Font(juce::FontOptions("Arial",7.5f,juce::Font::bold)));
                const auto readout="FRAME "+juce::String(static_cast<int>(document_.selectedFrame+1)).paddedLeft('0',3)+
                                   "     2048 SAMPLES";
                g.drawText(readout,plot.getX(),3,plot.getWidth(),14,juce::Justification::centredRight,false);
            }
        private:
            mct::origami::ui::WavetableDocument& document_;
        };

        class EditorHeader final : public juce::Component {
        public:
            std::function<void()> onClose;
            EditorHeader() {
                for(auto* component:std::array<juce::Component*,5>{{&document_,&frame_,&undo_,&redo_,&close_}})
                    addAndMakeVisible(component);

                document_.setText("BASIC SHAPES",juce::dontSendNotification);
                frame_.setText("FRAME 001 / 004",juce::dontSendNotification);
                for(auto* label:std::array<juce::Label*,2>{{&document_,&frame_}}) {
                    label->setFont(juce::Font(juce::FontOptions("Arial",8.5f,juce::Font::bold)));
                    label->setColour(juce::Label::textColourId,juce::Colours::white.withAlpha(0.68f));
                    label->setJustificationType(juce::Justification::centred);
                    label->setInterceptsMouseClicks(false,false);
                }

                undo_.setButtonText("UNDO");
                redo_.setButtonText("REDO");
                undo_.setEnabled(false);
                redo_.setEnabled(false);

                close_.setButtonText("X");
                close_.setTooltip("Close wavetable editor");
                close_.setMouseCursor(juce::MouseCursor::PointingHandCursor);
                close_.onClick=[this] { if(onClose) onClose(); };
            }
            void setDocumentName(const juce::String& name) {
                document_.setText(name,juce::dontSendNotification);
            }
            void setFrameStatus(unsigned zeroBasedIndex,unsigned count) {
                const auto display=zeroBasedIndex+1u;
                frame_.setText("FRAME "+juce::String(display).paddedLeft('0',3)+" / "+
                               juce::String(count).paddedLeft('0',3),juce::dontSendNotification);
            }
            void resized() override {
                constexpr int closeSize=24;
                constexpr int inset=5;
                constexpr int historyWidth=44;
                auto area=getLocalBounds();

                close_.setBounds(area.removeFromRight(closeSize).withSizeKeepingCentre(closeSize,closeSize)
                                     .translated(-inset,0));
                area.removeFromRight(inset+3);
                redo_.setBounds(area.removeFromRight(historyWidth).reduced(2,4));
                undo_.setBounds(area.removeFromRight(historyWidth).reduced(2,4));

                auto left=area.removeFromLeft(150);
                titleBounds_=left;
                area.removeFromLeft(8);
                document_.setBounds(area.removeFromLeft(150).reduced(2,4));
                frame_.setBounds(area.withSizeKeepingCentre(130,area.getHeight()).reduced(2,4));
            }
            void paint(juce::Graphics& g) override {
                g.fillAll(juce::Colour(0xff0b0b0b));
                g.setColour(juce::Colour(0xff303030));
                g.drawLine(0.0f,static_cast<float>(getHeight())-0.5f,
                           static_cast<float>(getWidth()),static_cast<float>(getHeight())-0.5f,1.0f);
                g.setColour(juce::Colours::white.withAlpha(0.72f));
                g.setFont(juce::Font(juce::FontOptions("Arial",9.0f,juce::Font::bold)));
                g.drawText("WAVETABLE EDITOR",titleBounds_.reduced(10,0),
                           juce::Justification::centredLeft,false);
            }
        private:
            juce::Rectangle<int> titleBounds_;
            juce::Label document_,frame_;
            juce::TextButton undo_{"UNDO"},redo_{"REDO"},close_{"X"};
        };

    public:
        std::function<void()> onClose;
        WavetableEditorSurface()
            : document_(mct::origami::ui::WavetableDocument::basicShapes()),
              tools_("TOOLS"),waveform_("WAVEFORM"),spectrum_("SPECTRUM"),
              timeline_("FRAMES"),table_("TABLE"),frameStrip_(document_),waveformCanvas_(document_) {
            setWantsKeyboardFocus(true);
            setFocusContainerType(juce::Component::FocusContainerType::keyboardFocusContainer);
            addAndMakeVisible(header_);
            header_.onClose=[this] { if(onClose) onClose(); };
            for(auto* region:std::array<EditorRegion*,5>{{&tools_,&waveform_,&spectrum_,&timeline_,&table_}})
                addAndMakeVisible(region);
            timeline_.setContentComponent(frameStrip_);
            waveform_.setContentComponent(waveformCanvas_);
            frameStrip_.onFrameSelected=[this](unsigned) { refreshSelectedFrame(); };
            header_.setDocumentName(document_.name);
            refreshSelectedFrame();
        }
        void refreshSelectedFrame() {
            header_.setDocumentName(document_.name);
            header_.setFrameStatus(static_cast<unsigned>(document_.selectedFrame),
                                   static_cast<unsigned>(document_.frames.size()));
            waveformCanvas_.refresh();
        }
        void resized() override {
            auto area=getLocalBounds();
            header_.setBounds(area.removeFromTop(editorHeaderHeight));

            table_.setBounds(area.removeFromBottom(tableHeight));
            timeline_.setBounds(area.removeFromBottom(timelineHeight));

            const int toolsWidth=juce::roundToInt(static_cast<float>(area.getWidth())*.14f);
            const int spectrumWidth=juce::roundToInt(static_cast<float>(area.getWidth())*.30f);
            tools_.setBounds(area.removeFromLeft(toolsWidth));
            spectrum_.setBounds(area.removeFromRight(spectrumWidth));
            waveform_.setBounds(area);
        }
        void paint(juce::Graphics& g) override {
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
        mct::origami::ui::WavetableDocument document_;
        EditorHeader header_;
        EditorRegion tools_,waveform_,spectrum_,timeline_,table_;
        FrameStrip frameStrip_;
        WaveformCanvas waveformCanvas_;
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
