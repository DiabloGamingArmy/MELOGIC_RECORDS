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
            void refreshSelectedThumbnail() {
                if(document_.selectedFrame<cards_.size()) cards_[document_.selectedFrame]->repaint();
            }
            void refreshThumbnail(unsigned index) {
                if(index<cards_.size()) cards_[index]->repaint();
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
            std::function<void()> onSamplesChanged;
            std::function<void(std::uint64_t,const std::array<float,mct::origami::ui::kWavetableFrameSize>&,
                               const std::array<float,mct::origami::ui::kWavetableFrameSize>&)> onEditCommitted;
            explicit WaveformCanvas(mct::origami::ui::WavetableDocument& document):document_(document) {
                setInterceptsMouseClicks(true,false);
                setMouseCursor(juce::MouseCursor::CrosshairCursor);
            }
            void refresh() { repaint(); }
            void mouseDown(const juce::MouseEvent& event) override {
                if(!document_.valid()) return;
                drawing_=true;
                editFrameId_=document_.frames[document_.selectedFrame].id;
                editBefore_=document_.frames[document_.selectedFrame].samples;
                const auto point=pointForEvent(event);
                lastSample_=point.first;
                lastValue_=point.second;
                document_.setFrameSample(document_.selectedFrame,lastSample_,lastValue_);
                samplesChanged();
            }
            void mouseDrag(const juce::MouseEvent& event) override {
                if(!drawing_ || !document_.valid()) return;
                const auto point=pointForEvent(event);
                const auto currentSample=point.first;
                const float currentValue=point.second;
                if(currentSample==lastSample_) {
                    document_.setFrameSample(document_.selectedFrame,currentSample,currentValue);
                } else {
                    const auto low=juce::jmin(lastSample_,currentSample);
                    const auto high=juce::jmax(lastSample_,currentSample);
                    const float denominator=static_cast<float>(static_cast<long long>(currentSample)-static_cast<long long>(lastSample_));
                    for(std::size_t sample=low;sample<=high;++sample) {
                        const float t=static_cast<float>(static_cast<long long>(sample)-static_cast<long long>(lastSample_))/denominator;
                        document_.setFrameSample(document_.selectedFrame,sample,lastValue_+t*(currentValue-lastValue_));
                    }
                }
                lastSample_=currentSample;
                lastValue_=currentValue;
                samplesChanged();
            }
            void mouseUp(const juce::MouseEvent&) override {
                if(!drawing_) return;
                drawing_=false;
                if(!document_.valid()) return;
                const auto& after=document_.frames[document_.selectedFrame].samples;
                if(after!=editBefore_ && onEditCommitted) onEditCommitted(editFrameId_,editBefore_,after);
            }

            void paint(juce::Graphics& g) override {
                const auto bounds=getLocalBounds();
                if(bounds.isEmpty() || !document_.valid()) return;
                const auto plot=plotBounds();
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
                    g.drawText(label,2,juce::roundToInt(y)-7,27,14,juce::Justification::centredRight,false);
                }

                constexpr int divisions=8;
                for(int division=0;division<=divisions;++division) {
                    const float t=static_cast<float>(division)/static_cast<float>(divisions);
                    const float x=static_cast<float>(plot.getX())+t*static_cast<float>(plot.getWidth());
                    g.setColour(juce::Colours::white.withAlpha(division==0 || division==divisions ? 0.12f : 0.065f));
                    g.drawVerticalLine(juce::roundToInt(x),static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()));
                    const int sample=division==divisions ? 2047 : division*256;
                    g.setColour(juce::Colours::white.withAlpha(0.25f));
                    g.drawText(juce::String(sample),juce::roundToInt(x)-19,plot.getBottom()+3,38,12,juce::Justification::centred,false);
                }

                const auto& samples=document_.frames[document_.selectedFrame].samples;
                const int columns=juce::jmax(1,plot.getWidth());
                juce::Path envelope,fill;
                const float zeroY=mapY(0.0f);
                for(int column=0;column<columns;++column) {
                    const std::size_t begin=static_cast<std::size_t>((static_cast<std::uint64_t>(column)*samples.size())/static_cast<std::uint64_t>(columns));
                    const std::size_t end=juce::jmax(begin+1,static_cast<std::size_t>((static_cast<std::uint64_t>(column+1)*samples.size())/static_cast<std::uint64_t>(columns)));
                    float minimum=1.0f,maximum=-1.0f;
                    for(std::size_t i=begin;i<juce::jmin(end,samples.size());++i) {
                        minimum=juce::jmin(minimum,samples[i]); maximum=juce::jmax(maximum,samples[i]);
                    }
                    const float x=static_cast<float>(plot.getX()+column)+0.5f;
                    const float top=mapY(maximum),bottom=mapY(minimum);
                    envelope.startNewSubPath(x,top); envelope.lineTo(x,bottom);
                    fill.startNewSubPath(x,zeroY); fill.lineTo(x,top);
                    fill.startNewSubPath(x,zeroY); fill.lineTo(x,bottom);
                }
                // Wavetable body follows Origami's user-customisable global
                // signal colour; never substitute the neutral Palette::accent().
                g.setColour(mct::origami::ui::signalSurfaceColour(0.48f,0.34f));
                g.strokePath(fill,juce::PathStrokeType(1.0f));
                // Deliberately heavy primary trace for precise draw/edit visibility.
                g.setColour(juce::Colours::white.withAlpha(0.97f));
                g.strokePath(envelope,juce::PathStrokeType(3.5f,juce::PathStrokeType::curved,
                                                          juce::PathStrokeType::rounded));

                g.setColour(juce::Colours::white.withAlpha(0.32f));
                g.setFont(juce::Font(juce::FontOptions("Arial",7.5f,juce::Font::bold)));
                const auto readout="FRAME "+juce::String(static_cast<int>(document_.selectedFrame+1)).paddedLeft('0',3)+"     2048 SAMPLES";
                g.drawText(readout,plot.getX(),3,plot.getWidth(),14,juce::Justification::centredRight,false);
            }
        private:
            juce::Rectangle<int> plotBounds() const noexcept {
                return getLocalBounds().withTrimmedLeft(34).withTrimmedRight(10).withTrimmedTop(22).withTrimmedBottom(20);
            }
            std::pair<std::size_t,float> pointForEvent(const juce::MouseEvent& event) const noexcept {
                const auto plot=plotBounds();
                const float x=juce::jlimit(static_cast<float>(plot.getX()),static_cast<float>(plot.getRight()),event.position.x);
                const float y=juce::jlimit(static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()),event.position.y);
                const float xNorm=(x-static_cast<float>(plot.getX()))/static_cast<float>(juce::jmax(1,plot.getWidth()));
                const float yNorm=(y-static_cast<float>(plot.getY()))/static_cast<float>(juce::jmax(1,plot.getHeight()));
                const auto sample=static_cast<std::size_t>(juce::jlimit(0,2047,juce::roundToInt(xNorm*2047.0f)));
                return {sample,juce::jlimit(-1.0f,1.0f,1.0f-2.0f*yNorm)};
            }
            void samplesChanged() {
                repaint();
                if(onSamplesChanged) onSamplesChanged();
            }
            mct::origami::ui::WavetableDocument& document_;
            bool drawing_=false;
            std::size_t lastSample_=0;
            float lastValue_=0.0f;
            std::uint64_t editFrameId_=0;
            std::array<float,mct::origami::ui::kWavetableFrameSize> editBefore_{};
        };

        class ToolsPanel final : public juce::Component {
        public:
            ToolsPanel() {
                addAndMakeVisible(pencil_);
                pencil_.setButtonText("PENCIL");
                pencil_.setEnabled(false);
            }
            void resized() override {
                auto area=getLocalBounds().reduced(5);
                labelBounds_=area.removeFromTop(18);
                pencil_.setBounds(area.removeFromTop(26));
            }
            void paint(juce::Graphics& g) override {
                g.setColour(juce::Colours::white.withAlpha(0.38f));
                g.setFont(juce::Font(juce::FontOptions("Arial",8.0f,juce::Font::bold)));
                g.drawText("DRAW",labelBounds_,juce::Justification::centredLeft,false);
                const auto b=pencil_.getBounds().toFloat();
                g.setColour(juce::Colour(0xffff1018).withAlpha(0.75f));
                g.drawRect(b,1.0f);
            }
        private:
            juce::Rectangle<int> labelBounds_;
            juce::TextButton pencil_{"PENCIL"};
        };

        class EditorHeader final : public juce::Component {
        public:
            std::function<void()> onClose;
            std::function<void()> onUndo;
            std::function<void()> onRedo;
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
                undo_.onClick=[this] { if(onUndo) onUndo(); };
                redo_.onClick=[this] { if(onRedo) onRedo(); };
            }
            void setHistoryAvailable(bool canUndo,bool canRedo) {
                undo_.setEnabled(canUndo);
                redo_.setEnabled(canRedo);
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
            header_.onUndo=[this] { undo(); };
            header_.onRedo=[this] { redo(); };
            for(auto* region:std::array<EditorRegion*,5>{{&tools_,&waveform_,&spectrum_,&timeline_,&table_}})
                addAndMakeVisible(region);
            tools_.setContentComponent(toolsPanel_);
            timeline_.setContentComponent(frameStrip_);
            waveform_.setContentComponent(waveformCanvas_);
            frameStrip_.onFrameSelected=[this](unsigned) { refreshSelectedFrame(); };
            waveformCanvas_.onSamplesChanged=[this] { frameStrip_.refreshSelectedThumbnail(); };
            waveformCanvas_.onEditCommitted=[this](std::uint64_t id,const auto& before,const auto& after) {
                commitEdit(id,before,after);
            };
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
            const auto mods=key.getModifiers();
            if(mods.isCommandDown() && key.getTextCharacter()=='z') {
                if(mods.isShiftDown()) redo(); else undo();
                return true;
            }
            if(key==juce::KeyPress::escapeKey && onClose) {
                onClose();
                return true;
            }
            return false;
        }
    private:
        void commitEdit(std::uint64_t id,
                        const std::array<float,mct::origami::ui::kWavetableFrameSize>& before,
                        const std::array<float,mct::origami::ui::kWavetableFrameSize>& after) {
            if(before==after) return;
            if(historyIndex_<history_.size())
                history_.erase(history_.begin()+static_cast<std::ptrdiff_t>(historyIndex_),history_.end());
            history_.push_back({id,before,after});
            if(history_.size()>128) history_.erase(history_.begin());
            historyIndex_=history_.size();
            refreshHistoryButtons();
        }
        void undo() {
            if(historyIndex_==0) return;
            --historyIndex_;
            applyHistory(history_[historyIndex_],false);
        }
        void redo() {
            if(historyIndex_>=history_.size()) return;
            applyHistory(history_[historyIndex_],true);
            ++historyIndex_;
            refreshHistoryButtons();
        }
        struct HistoryEntry {
            std::uint64_t frameId=0;
            std::array<float,mct::origami::ui::kWavetableFrameSize> before{},after{};
        };
        void applyHistory(const HistoryEntry& entry,bool useAfter) {
            for(std::size_t i=0;i<document_.frames.size();++i) {
                if(document_.frames[i].id!=entry.frameId) continue;
                document_.frames[i].samples=useAfter ? entry.after : entry.before;
                if(document_.selectedFrame==i) waveformCanvas_.refresh();
                frameStrip_.refreshThumbnail(static_cast<unsigned>(i));
                break;
            }
            refreshHistoryButtons();
        }
        void refreshHistoryButtons() { header_.setHistoryAvailable(historyIndex_>0,historyIndex_<history_.size()); }
        mct::origami::ui::WavetableDocument document_;
        EditorHeader header_;
        EditorRegion tools_,waveform_,spectrum_,timeline_,table_;
        ToolsPanel toolsPanel_;
        FrameStrip frameStrip_;
        WaveformCanvas waveformCanvas_;
        std::vector<HistoryEntry> history_;
        std::size_t historyIndex_=0;
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
