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
#include "ui/NativeChoiceMenu.h"
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
                        juce::Path trace,body;
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
                            if(i==0) {
                                trace.startNewSubPath(x,y);
                                body.startNewSubPath(x,mid);
                            } else {
                                trace.lineTo(x,y);
                            }
                            body.lineTo(x,y);
                        }
                        body.lineTo(static_cast<float>(wave.getRight()),mid);
                        body.closeSubPath();

                        // Match the main editor's visual language: the preview body
                        // follows Origami's user-customisable global signal colour.
                        g.setColour(mct::origami::ui::signalSurfaceColour(0.48f,0.34f));
                        g.fillPath(body);
                        g.setColour(juce::Colours::white.withAlpha(0.94f));
                        g.strokePath(trace,juce::PathStrokeType(2.0f,juce::PathStrokeType::curved,
                                                               juce::PathStrokeType::rounded));
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

        struct GridSettings {
            int divisions=16;
            int amplitudeSteps=8;
            bool snapX=false;
            bool snapY=false;
            bool snapZero=true;
            bool showGrid=true;
        };

        enum class WaveformTool { pencil, line, curve, select };
        struct ShapeSegment {
            std::size_t startSample=0,endSample=0;
            float startValue=0.0f,endValue=0.0f,curve=0.0f;
            float evaluate(float t) const noexcept {
                t=juce::jlimit(0.0f,1.0f,t);
                if(std::abs(curve)>0.0001f) {
                    const float power=std::pow(2.0f,std::abs(curve)*3.0f);
                    t=curve>0.0f ? std::pow(t,power) : 1.0f-std::pow(1.0f-t,power);
                }
                return startValue+(endValue-startValue)*t;
            }
        };
        struct WaveformSelection {
            bool active=false;
            std::uint64_t frameId=0;
            std::size_t start=0,end=0;
        };

        class WaveformCanvas final : public juce::Component {
        public:
            std::function<void()> onSamplesChanged;
            std::function<void(bool)> onSelectionChanged;
            std::function<void(std::uint64_t,const std::array<float,mct::origami::ui::kWavetableFrameSize>&,
                               const std::array<float,mct::origami::ui::kWavetableFrameSize>&)> onEditCommitted;
            explicit WaveformCanvas(mct::origami::ui::WavetableDocument& document,GridSettings& grid)
                :document_(document),grid_(grid) {
                setInterceptsMouseClicks(true,false);
                setMouseCursor(juce::MouseCursor::CrosshairCursor);
            }
            void refresh() { repaint(); }
            bool hasPendingShape() const noexcept { return shapeState_!=ShapeEditState::idle; }
            void cancelPendingShape() { shapeState_=ShapeEditState::idle; shapeDraggingHandle_=false; repaint(); }
            void setTool(WaveformTool tool) { cancelPendingShape(); tool_=tool; setMouseCursor(juce::MouseCursor::CrosshairCursor); repaint(); }
            WaveformTool tool() const noexcept { return tool_; }
            bool hasSelection() const noexcept { return selection_.active; }
            const WaveformSelection& selection() const noexcept { return selection_; }
            void clearSelection() { selection_={}; selecting_=false; repaint(); if(onSelectionChanged) onSelectionChanged(false); }
            void selectAll() {
                if(!document_.valid()) return;
                selection_={true,document_.frames[document_.selectedFrame].id,0,mct::origami::ui::kWavetableFrameSize-1};
                repaint(); if(onSelectionChanged) onSelectionChanged(true);
            }
            void mouseDown(const juce::MouseEvent& event) override {
                if(!document_.valid()) return;
                if(tool_==WaveformTool::select) {
                    selecting_=true;
                    selectionAnchor_=sampleForX(event.position.x);
                    selection_={true,document_.frames[document_.selectedFrame].id,selectionAnchor_,selectionAnchor_};
                    repaint(); if(onSelectionChanged) onSelectionChanged(true); return;
                }
                if(tool_==WaveformTool::curve && shapeState_==ShapeEditState::editingCurve) {
                    const auto handle=curveHandlePosition();
                    if(event.position.getDistanceFrom(handle)<14.0f) {
                        shapeDraggingHandle_=true; return;
                    }
                    commitPendingShape(); return;
                }
                if(tool_==WaveformTool::line || tool_==WaveformTool::curve) {
                    shapeState_=ShapeEditState::drawingEndpoints;
                    editFrameId_=document_.frames[document_.selectedFrame].id;
                    editBefore_=document_.frames[document_.selectedFrame].samples;
                    const auto p=pointForEvent(event);
                    shape_={p.first,p.first,p.second,p.second,0.0f};
                    shapePreview_=editBefore_;
                    repaint(); return;
                }
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
                if(tool_==WaveformTool::select) {
                    if(!selecting_ || !document_.valid()) return;
                    const auto sample=sampleForX(event.position.x);
                    selection_.start=juce::jmin(selectionAnchor_,sample);
                    selection_.end=juce::jmax(selectionAnchor_,sample);
                    repaint(); return;
                }
                if(tool_==WaveformTool::curve && shapeState_==ShapeEditState::editingCurve && shapeDraggingHandle_) {
                    const auto plot=plotBounds();
                    const float midY=(valueToY(shape_.startValue)+valueToY(shape_.endValue))*0.5f;
                    const float scale=juce::jmax(48.0f,static_cast<float>(plot.getHeight())*0.28f);
                    shape_.curve=juce::jlimit(-1.0f,1.0f,(midY-event.position.y)/scale);
                    renderShapePreview(); repaint(); return;
                }
                if((tool_==WaveformTool::line || tool_==WaveformTool::curve) && shapeState_==ShapeEditState::drawingEndpoints) {
                    const auto p=pointForEvent(event);
                    shape_.endSample=p.first; shape_.endValue=p.second; shape_.curve=0.0f;
                    renderShapePreview(); repaint(); return;
                }
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
                if(tool_==WaveformTool::select) {
                    if(!selecting_) return;
                    selecting_=false;
                    if(selection_.start==selection_.end) clearSelection();
                    return;
                }
                if(tool_==WaveformTool::curve && shapeState_==ShapeEditState::editingCurve && shapeDraggingHandle_) {
                    shapeDraggingHandle_=false; repaint(); return;
                }
                if((tool_==WaveformTool::line || tool_==WaveformTool::curve) && shapeState_==ShapeEditState::drawingEndpoints) {
                    if(tool_==WaveformTool::curve) {
                        shapeState_=ShapeEditState::editingCurve; renderShapePreview(); repaint(); return;
                    }
                    commitPendingShape(); return;
                }
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
                if(grid_.showGrid && grid_.divisions>divisions) {
                    for(int division=1;division<grid_.divisions;++division) {
                        if((division*divisions)%grid_.divisions==0) continue;
                        const float t=static_cast<float>(division)/static_cast<float>(grid_.divisions);
                        const float x=static_cast<float>(plot.getX())+t*static_cast<float>(plot.getWidth());
                        g.setColour(juce::Colours::white.withAlpha(0.035f));
                        g.drawVerticalLine(juce::roundToInt(x),static_cast<float>(plot.getY()),
                                           static_cast<float>(plot.getBottom()));
                    }
                }
                for(int division=0;division<=divisions;++division) {
                    const float t=static_cast<float>(division)/static_cast<float>(divisions);
                    const float x=static_cast<float>(plot.getX())+t*static_cast<float>(plot.getWidth());
                    g.setColour(juce::Colours::white.withAlpha(division==0 || division==divisions ? 0.12f : 0.065f));
                    g.drawVerticalLine(juce::roundToInt(x),static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()));
                    const int sample=division==divisions ? 2047 : division*256;
                    g.setColour(juce::Colours::white.withAlpha(0.25f));
                    g.drawText(juce::String(sample),juce::roundToInt(x)-19,plot.getBottom()+3,38,12,juce::Justification::centred,false);
                }

                if(selection_.active && selection_.frameId==document_.frames[document_.selectedFrame].id) {
                    const float left=static_cast<float>(plot.getX())+
                        static_cast<float>(selection_.start)/2047.0f*static_cast<float>(plot.getWidth());
                    const float right=static_cast<float>(plot.getX())+
                        static_cast<float>(selection_.end)/2047.0f*static_cast<float>(plot.getWidth());
                    const juce::Rectangle<float> selected(left,static_cast<float>(plot.getY()),
                        juce::jmax(1.0f,right-left),static_cast<float>(plot.getHeight()));
                    g.setColour(mct::origami::ui::signalSourceColour().withAlpha(0.08f)); g.fillRect(selected);
                    g.setColour(juce::Colours::white.withAlpha(0.42f));
                    g.drawVerticalLine(juce::roundToInt(left),static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()));
                    g.drawVerticalLine(juce::roundToInt(right),static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()));
                }

                const auto& samples=document_.frames[document_.selectedFrame].samples;
                const int columns=juce::jmax(1,plot.getWidth());
                juce::Path envelope,fill;
                const float zeroY=mapY(0.0f);
                bool envelopeStarted=false;
                for(int column=0;column<columns;++column) {
                    const std::size_t begin=static_cast<std::size_t>((static_cast<std::uint64_t>(column)*samples.size())/static_cast<std::uint64_t>(columns));
                    const std::size_t end=juce::jmax(begin+1,static_cast<std::size_t>((static_cast<std::uint64_t>(column+1)*samples.size())/static_cast<std::uint64_t>(columns)));
                    float minimum=1.0f,maximum=-1.0f,sum=0.0f;
                    std::size_t count=0;
                    for(std::size_t i=begin;i<juce::jmin(end,samples.size());++i) {
                        minimum=juce::jmin(minimum,samples[i]);
                        maximum=juce::jmax(maximum,samples[i]);
                        sum+=samples[i];
                        ++count;
                    }
                    if(count==0) continue;
                    const float x=static_cast<float>(plot.getX()+column)+0.5f;
                    const float representative=sum/static_cast<float>(count);
                    const float y=mapY(representative);
                    if(!envelopeStarted) {
                        envelope.startNewSubPath(x,y);
                        envelopeStarted=true;
                    } else {
                        envelope.lineTo(x,y);
                    }

                    // Preserve the min/max bucket in the coloured body so narrow
                    // transients remain visible even when 2048 samples are compressed.
                    const float top=mapY(maximum),bottom=mapY(minimum);
                    fill.startNewSubPath(x,zeroY); fill.lineTo(x,top);
                    fill.startNewSubPath(x,zeroY); fill.lineTo(x,bottom);
                }
                g.setColour(mct::origami::ui::signalSurfaceColour(0.48f,0.34f));
                g.strokePath(fill,juce::PathStrokeType(1.0f));

                // The primary trace is a continuous waveform path. Previously it
                // was made from independent vertical min/max segments; thick rounded
                // strokes exposed tiny visual gaps between those disconnected pieces.
                g.setColour(juce::Colours::white.withAlpha(0.97f));
                g.strokePath(envelope,juce::PathStrokeType(3.5f,juce::PathStrokeType::curved,
                                                          juce::PathStrokeType::rounded));

                g.setColour(juce::Colours::white.withAlpha(0.32f));
                g.setFont(juce::Font(juce::FontOptions("Arial",7.5f,juce::Font::bold)));
                if(shapeState_!=ShapeEditState::idle) {
                    juce::Path preview;
                    const auto low=juce::jmin(shape_.startSample,shape_.endSample);
                    const auto high=juce::jmax(shape_.startSample,shape_.endSample);
                    for(std::size_t i=low;i<=high;++i) {
                        const float x=static_cast<float>(plot.getX())+static_cast<float>(i)/2047.0f*static_cast<float>(plot.getWidth());
                        const float y=mapY(shapePreview_[i]);
                        if(i==low) preview.startNewSubPath(x,y); else preview.lineTo(x,y);
                    }
                    g.setColour(juce::Colours::white.withAlpha(0.95f));
                    g.strokePath(preview,juce::PathStrokeType(2.0f,juce::PathStrokeType::curved,juce::PathStrokeType::rounded));
                    auto handle=[&](std::size_t i,float v) {
                        const float x=static_cast<float>(plot.getX())+static_cast<float>(i)/2047.0f*static_cast<float>(plot.getWidth());
                        g.fillEllipse(x-3.0f,mapY(v)-3.0f,6.0f,6.0f);
                    };
                    handle(shape_.startSample,shape_.startValue); handle(shape_.endSample,shape_.endValue);
                    if(shapeState_==ShapeEditState::editingCurve) {
                        const auto hp=curveHandlePosition();
                        g.setColour(mct::origami::ui::signalSourceColour().withAlpha(0.95f));
                        g.fillEllipse(hp.x-4.0f,hp.y-4.0f,8.0f,8.0f);
                        g.setColour(juce::Colours::white.withAlpha(0.65f));
                        g.drawEllipse(hp.x-4.0f,hp.y-4.0f,8.0f,8.0f,1.0f);
                    }
                }

                juce::String readout="FRAME "+juce::String(static_cast<int>(document_.selectedFrame+1)).paddedLeft('0',3)+"     2048 SAMPLES";
                if(selection_.active) readout+="     "+juce::String(static_cast<int>(selection_.start))+"-"+juce::String(static_cast<int>(selection_.end))+
                    " · "+juce::String(static_cast<int>(selection_.end-selection_.start+1))+" SELECTED";
                g.drawText(readout,plot.getX(),3,plot.getWidth(),14,juce::Justification::centredRight,false);
            }
        private:
            juce::Rectangle<int> plotBounds() const noexcept {
                return getLocalBounds().withTrimmedLeft(34).withTrimmedRight(10).withTrimmedTop(22).withTrimmedBottom(20);
            }
            float valueToY(float value) const noexcept {
                const auto plot=plotBounds();
                return static_cast<float>(plot.getCentreY())-value*(static_cast<float>(plot.getHeight())*0.5f);
            }
            juce::Point<float> curveHandlePosition() const noexcept {
                const auto plot=plotBounds();
                const auto midSample=(shape_.startSample+shape_.endSample)/2;
                const float x=static_cast<float>(plot.getX())+static_cast<float>(midSample)/2047.0f*static_cast<float>(plot.getWidth());
                const float base=(valueToY(shape_.startValue)+valueToY(shape_.endValue))*0.5f;
                const float scale=juce::jmax(48.0f,static_cast<float>(plot.getHeight())*0.28f);
                return {x,base-shape_.curve*scale};
            }
            void commitPendingShape() {
                if(shapeState_==ShapeEditState::idle || !document_.valid()) return;
                auto& frame=document_.frames[document_.selectedFrame];
                frame.samples=shapePreview_;
                const auto after=frame.samples;
                shapeState_=ShapeEditState::idle; shapeDraggingHandle_=false;
                samplesChanged();
                if(after!=editBefore_ && onEditCommitted) onEditCommitted(editFrameId_,editBefore_,after);
                repaint();
            }
            void renderShapePreview() {
                shapePreview_=editBefore_;
                const auto low=juce::jmin(shape_.startSample,shape_.endSample);
                const auto high=juce::jmax(shape_.startSample,shape_.endSample);
                ShapeSegment seg=shape_;
                if(shape_.startSample>shape_.endSample) {
                    std::swap(seg.startSample,seg.endSample);
                    std::swap(seg.startValue,seg.endValue);
                    seg.curve=-seg.curve;
                }
                const float denom=static_cast<float>(juce::jmax<std::size_t>(1,high-low));
                for(std::size_t i=low;i<=high;++i)
                    shapePreview_[i]=juce::jlimit(-1.0f,1.0f,seg.evaluate(static_cast<float>(i-low)/denom));
            }
            std::size_t sampleForX(float eventX) const noexcept {
                const auto plot=plotBounds();
                const float x=juce::jlimit(static_cast<float>(plot.getX()),static_cast<float>(plot.getRight()),eventX);
                const float norm=(x-static_cast<float>(plot.getX()))/static_cast<float>(juce::jmax(1,plot.getWidth()));
                return static_cast<std::size_t>(juce::jlimit(0,2047,juce::roundToInt(norm*2047.0f)));
            }
            std::pair<std::size_t,float> pointForEvent(const juce::MouseEvent& event) const noexcept {
                const auto plot=plotBounds();
                const float x=juce::jlimit(static_cast<float>(plot.getX()),static_cast<float>(plot.getRight()),event.position.x);
                const float y=juce::jlimit(static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()),event.position.y);
                const float xNorm=(x-static_cast<float>(plot.getX()))/static_cast<float>(juce::jmax(1,plot.getWidth()));
                const float yNorm=(y-static_cast<float>(plot.getY()))/static_cast<float>(juce::jmax(1,plot.getHeight()));
                int sample=juce::jlimit(0,2047,juce::roundToInt(xNorm*2047.0f));
                float value=juce::jlimit(-1.0f,1.0f,1.0f-2.0f*yNorm);
                const bool bypass=juce::ModifierKeys::getCurrentModifiersRealtime().isAltDown();
                if(!bypass && grid_.snapX && grid_.divisions>0) {
                    const float gridPosition=static_cast<float>(sample)*static_cast<float>(grid_.divisions)/2047.0f;
                    sample=juce::jlimit(0,2047,juce::roundToInt(std::round(gridPosition)*2047.0f/
                                                               static_cast<float>(grid_.divisions)));
                }
                if(!bypass && grid_.snapZero) {
                    const float zeroThreshold=12.0f/static_cast<float>(juce::jmax(1,plot.getHeight()));
                    if(std::abs(value)<=zeroThreshold*2.0f) value=0.0f;
                }
                if(!bypass && grid_.snapY && grid_.amplitudeSteps>0) {
                    const float halfSteps=static_cast<float>(grid_.amplitudeSteps)/2.0f;
                    value=juce::jlimit(-1.0f,1.0f,std::round(value*halfSteps)/halfSteps);
                }
                return {static_cast<std::size_t>(sample),value};
            }
            void samplesChanged() {
                repaint();
                if(onSamplesChanged) onSamplesChanged();
            }
            mct::origami::ui::WavetableDocument& document_;
            GridSettings& grid_;
            WaveformTool tool_=WaveformTool::pencil;
            enum class ShapeEditState { idle, drawingEndpoints, editingCurve };
            ShapeSegment shape_{};
            std::array<float,mct::origami::ui::kWavetableFrameSize> shapePreview_{};
            ShapeEditState shapeState_=ShapeEditState::idle;
            bool shapeDraggingHandle_=false;
            WaveformSelection selection_{};
            bool selecting_=false;
            std::size_t selectionAnchor_=0;
            bool drawing_=false;
            std::size_t lastSample_=0;
            float lastValue_=0.0f;
            std::uint64_t editFrameId_=0;
            std::array<float,mct::origami::ui::kWavetableFrameSize> editBefore_{};
        };

        class NativeChoiceBox final : public juce::Component {
        public:
            std::function<void()> onChange;
            void addNativeItem(const juce::String& text,int id) {
                nativeItems_.push_back({id,text,true,{},false});
                labels_[id]=text;
            }
            void setSelectedId(int id,juce::NotificationType notification=juce::sendNotification) {
                if(selectedId_==id) return;
                selectedId_=id;
                repaint();
                if(notification!=juce::dontSendNotification && onChange) onChange();
            }
            int getSelectedId() const noexcept { return selectedId_; }
            void mouseDown(const juce::MouseEvent&) override {
                if(!isEnabled() || menuOpen_) return;
                menuOpen_=true;
                repaint();
                mct::origami::ui::showNativeChoiceMenu(
                    *this,{},nativeItems_,selectedId_,
                    [safe=juce::Component::SafePointer<NativeChoiceBox>(this)](int id) {
                        if(safe!=nullptr && id>0) safe->setSelectedId(id,juce::sendNotification);
                    });
                menuOpen_=false;
                repaint();
            }
            void paint(juce::Graphics& g) override {
                const auto bounds=getLocalBounds().toFloat().reduced(0.5f);
                const float alpha=isEnabled()?1.0f:0.34f;
                g.setColour(juce::Colour(0xff080808).withMultipliedAlpha(alpha));
                g.fillRect(bounds);
                g.setColour((menuOpen_?mct::origami::ui::signalSourceColour():juce::Colour(0xff383838))
                                .withMultipliedAlpha(alpha));
                g.drawRect(bounds,1.0f);
                g.setColour(juce::Colours::white.withAlpha(0.82f*alpha));
                g.setFont(juce::Font(juce::FontOptions("Arial",8.5f,juce::Font::plain)));
                const auto text=labels_.count(selectedId_)!=0?labels_.at(selectedId_):juce::String{};
                g.drawText(text,getLocalBounds().reduced(8,0).withTrimmedRight(18),
                           juce::Justification::centredLeft,false);
                juce::Path arrow;
                const float cx=static_cast<float>(getWidth()-10),cy=static_cast<float>(getHeight())*0.5f;
                arrow.startNewSubPath(cx-3.0f,cy-1.5f);
                arrow.lineTo(cx,cy+1.5f);
                arrow.lineTo(cx+3.0f,cy-1.5f);
                g.setColour(juce::Colours::white.withAlpha(0.72f*alpha));
                g.strokePath(arrow,juce::PathStrokeType(1.2f,juce::PathStrokeType::curved,
                                                        juce::PathStrokeType::rounded));
            }
        private:
            std::vector<mct::origami::ui::NativeChoiceItem> nativeItems_;
            std::map<int,juce::String> labels_;
            int selectedId_=0;
            bool menuOpen_=false;
        };

        class ToolsPanel final : public juce::Component {
        public:
            std::function<void(int,float,float,float)> onGenerate;
            std::function<void(int,float,float)> onTransform;
            std::function<void()> onContentHeightChanged;
            int preferredHeight() const noexcept { return calculateRequiredHeight(); }
            ToolsPanel(GridSettings& grid,WaveformCanvas& canvas):grid_(grid),canvas_(canvas) {
                setWantsKeyboardFocus(true);
                for(auto* b:std::array<juce::TextButton*,4>{{&drawHeader_,&gridHeader_,&generateHeader_,&transformHeader_}}) {
                    addAndMakeVisible(b); styleSectionButton(*b);
                }
                drawHeader_.onClick=[this]{ drawOpen_=!drawOpen_; relayout(); };
                gridHeader_.onClick=[this]{ gridOpen_=!gridOpen_; relayout(); };
                generateHeader_.onClick=[this]{ generateOpen_=!generateOpen_; relayout(); };
                transformHeader_.onClick=[this]{ transformOpen_=!transformOpen_; relayout(); };
                addAndMakeVisible(pencil_); addAndMakeVisible(line_); addAndMakeVisible(curve_); addAndMakeVisible(select_);
                pencil_.setButtonText("PENCIL"); line_.setButtonText("LINE"); curve_.setButtonText("CURVE"); select_.setButtonText("SELECT");
                for(auto* b:std::array<juce::TextButton*,4>{{&pencil_,&line_,&curve_,&select_}}) b->setClickingTogglesState(false);
                pencil_.onClick=[this] { canvas_.setTool(WaveformTool::pencil); updateToolButtons(); };
                line_.onClick=[this] { canvas_.setTool(WaveformTool::line); updateToolButtons(); };
                curve_.onClick=[this] { canvas_.setTool(WaveformTool::curve); updateToolButtons(); };
                select_.onClick=[this] { canvas_.setTool(WaveformTool::select); updateToolButtons(); };
                for(auto* c:std::array<juce::Component*,9>{{&gridResolution_,&xSnap_,&yGrid_,&ySnap_,&zeroSnap_,
                                                            &generatorType_,&cycles_,&phase_,&pulseWidth_}})
                    addAndMakeVisible(c);
                addAndMakeVisible(apply_);
                for(auto* c:std::array<juce::Component*,11>{{&gain_,&offset_,&transformApply_,&invert_,&reverse_,&zero_,&normalize_,&smooth_,&fadeIn_,&fadeOut_,&removeDc_}})
                    addAndMakeVisible(c);

                setupCombo(gridResolution_,{"OFF","1/4","1/8","1/16","1/32","1/64"});
                setupCombo(xSnap_,{"OFF","ON"});
                setupCombo(yGrid_,{"1/8","1/16","1/32","1/64"});
                setupCombo(ySnap_,{"OFF","ON"});
                setupCombo(zeroSnap_,{"OFF","ON"});
                setupCombo(generatorType_,{"SINE","SAW","SQUARE","TRIANGLE","NOISE"});
                gridResolution_.setSelectedId(4,juce::dontSendNotification);
                xSnap_.setSelectedId(1,juce::dontSendNotification);
                yGrid_.setSelectedId(1,juce::dontSendNotification);
                ySnap_.setSelectedId(1,juce::dontSendNotification);
                zeroSnap_.setSelectedId(2,juce::dontSendNotification);
                generatorType_.setSelectedId(1,juce::dontSendNotification);

                setupNumber(cycles_,"1.00");
                setupNumber(phase_,"0.00");
                setupNumber(pulseWidth_,"50");
                apply_.setButtonText("APPLY");
                apply_.setMouseCursor(juce::MouseCursor::PointingHandCursor);
                styleButton(pencil_); styleButton(line_); styleButton(curve_); styleButton(select_); styleButton(apply_);
                setupNumber(gain_,"1.00"); setupNumber(offset_,"0.00");
                transformApply_.setButtonText("APPLY");
                invert_.setButtonText("INVERT"); reverse_.setButtonText("REVERSE");
                zero_.setButtonText("ZERO"); normalize_.setButtonText("NORMALIZE"); smooth_.setButtonText("SMOOTH"); fadeIn_.setButtonText("FADE IN"); fadeOut_.setButtonText("FADE OUT"); removeDc_.setButtonText("REMOVE DC");
                for(auto* b:std::array<juce::TextButton*,9>{{&transformApply_,&invert_,&reverse_,&zero_,&normalize_,&smooth_,&fadeIn_,&fadeOut_,&removeDc_}}) styleButton(*b);
                transformApply_.onClick=[this] { if(onTransform) onTransform(1,gain_.getText().getFloatValue(),offset_.getText().getFloatValue()); };
                invert_.onClick=[this] { if(onTransform) onTransform(2,0,0); };
                reverse_.onClick=[this] { if(onTransform) onTransform(3,0,0); };
                zero_.onClick=[this] { if(onTransform) onTransform(4,0,0); };
                normalize_.onClick=[this] { if(onTransform) onTransform(5,0,0); };
                smooth_.onClick=[this] { if(onTransform) onTransform(6,0,0); };
                fadeIn_.onClick=[this] { if(onTransform) onTransform(7,0,0); };
                fadeOut_.onClick=[this] { if(onTransform) onTransform(8,0,0); };
                removeDc_.onClick=[this] { if(onTransform) onTransform(9,0,0); };
                updateToolButtons();

                gridResolution_.onChange=[this] {
                    static constexpr int values[]{0,4,8,16,32,64};
                    const int id=juce::jlimit(1,6,gridResolution_.getSelectedId());
                    grid_.showGrid=id>1; grid_.divisions=values[id-1]; canvas_.repaint();
                };
                xSnap_.onChange=[this] { grid_.snapX=xSnap_.getSelectedId()==2; };
                yGrid_.onChange=[this] {
                    static constexpr int values[]{8,16,32,64};
                    grid_.amplitudeSteps=values[juce::jlimit(1,4,yGrid_.getSelectedId())-1];
                };
                ySnap_.onChange=[this] { grid_.snapY=ySnap_.getSelectedId()==2; };
                zeroSnap_.onChange=[this] { grid_.snapZero=zeroSnap_.getSelectedId()==2; };
                generatorType_.onChange=[this] { updateGeneratorFields(); };
                apply_.onClick=[this] {
                    if(!onGenerate) return;
                    const float cycles=juce::jlimit(0.25f,32.0f,cycles_.getText().getFloatValue());
                    const float phase=phase_.getText().getFloatValue();
                    const float width=juce::jlimit(1.0f,99.0f,pulseWidth_.getText().getFloatValue());
                    cycles_.setText(juce::String(cycles,2),false);
                    phase_.setText(juce::String(phase,2),false);
                    pulseWidth_.setText(juce::String(width,0),false);
                    onGenerate(generatorType_.getSelectedId(),cycles,phase,width*0.01f);
                };
                updateGeneratorFields();
            }
            void mouseDown(const juce::MouseEvent& event) override {
                dismissNumberEditorIfNeeded(event.eventComponent);
            }
            void mouseUp(const juce::MouseEvent& event) override {
                dismissNumberEditorIfNeeded(event.eventComponent);
            }
            void resized() override {
                auto area=getLocalBounds().reduced(5);
                layoutSectionHeader(area,drawHeader_,"DRAW");
                setGroupVisible({&pencil_,&line_,&curve_,&select_},drawOpen_);
                if(drawOpen_) {
                    auto row=area.removeFromTop(26); pencil_.setBounds(row.removeFromLeft(row.getWidth()/2)); line_.setBounds(row);
                    area.removeFromTop(3); row=area.removeFromTop(26); curve_.setBounds(row.removeFromLeft(row.getWidth()/2)); select_.setBounds(row); area.removeFromTop(7);
                }

                layoutSectionHeader(area,gridHeader_,"SNAP & GRID");
                setGroupVisible({&gridResolution_,&xSnap_,&yGrid_,&ySnap_,&zeroSnap_},gridOpen_);
                if(gridOpen_) {
                    layoutRow(area,xGridText_,gridResolution_); layoutRow(area,xSnapText_,xSnap_);
                    layoutRow(area,yGridText_,yGrid_); layoutRow(area,ySnapText_,ySnap_);
                    layoutRow(area,zeroText_,zeroSnap_); area.removeFromTop(5);
                }

                layoutSectionHeader(area,generateHeader_,"GENERATE");
                setGroupVisible({&generatorType_,&cycles_,&phase_,&pulseWidth_,&apply_},generateOpen_);
                if(generateOpen_) {
                    layoutRow(area,typeText_,generatorType_); layoutRow(area,cyclesText_,cycles_);
                    layoutRow(area,phaseText_,phase_); layoutRow(area,widthText_,pulseWidth_);
                    apply_.setBounds(area.removeFromTop(26)); area.removeFromTop(7);
                }

                layoutSectionHeader(area,transformHeader_,"TRANSFORM");
                setGroupVisible({&gain_,&offset_,&transformApply_,&invert_,&reverse_,&zero_,&normalize_,&smooth_,&fadeIn_,&fadeOut_,&removeDc_},transformOpen_);
                if(transformOpen_) {
                    layoutRow(area,gainText_,gain_); layoutRow(area,offsetText_,offset_);
                    transformApply_.setBounds(area.removeFromTop(24)); area.removeFromTop(3);
                    { auto row=area.removeFromTop(24); invert_.setBounds(row.removeFromLeft(row.getWidth()/2)); reverse_.setBounds(row); }
                    area.removeFromTop(3); { auto row=area.removeFromTop(24); zero_.setBounds(row.removeFromLeft(row.getWidth()/2)); normalize_.setBounds(row); }
                    area.removeFromTop(8); processLabel_=area.removeFromTop(16);
                    smooth_.setBounds(area.removeFromTop(24)); area.removeFromTop(3);
                    { auto row=area.removeFromTop(24); fadeIn_.setBounds(row.removeFromLeft(row.getWidth()/2)); fadeOut_.setBounds(row); }
                    area.removeFromTop(3); removeDc_.setBounds(area.removeFromTop(24)); area.removeFromTop(6);
                }
                contentHeight_=calculateRequiredHeight();
            }
            void paint(juce::Graphics& g) override {
                g.setColour(juce::Colours::white.withAlpha(0.38f));
                g.setFont(juce::Font(juce::FontOptions("Arial",8.0f,juce::Font::bold)));
                g.setFont(juce::Font(juce::FontOptions("Arial",7.5f,juce::Font::plain)));
                g.setColour(juce::Colours::white.withAlpha(0.55f));
                if(gridOpen_) g.drawText("X GRID",xGridText_,juce::Justification::centredLeft,false);
                if(gridOpen_) g.drawText("X SNAP",xSnapText_,juce::Justification::centredLeft,false);
                if(gridOpen_) g.drawText("Y GRID",yGridText_,juce::Justification::centredLeft,false);
                if(gridOpen_) g.drawText("Y SNAP",ySnapText_,juce::Justification::centredLeft,false);
                if(gridOpen_) g.drawText("ZERO SNAP",zeroText_,juce::Justification::centredLeft,false);
                if(generateOpen_) g.drawText("TYPE",typeText_,juce::Justification::centredLeft,false);
                if(generateOpen_) g.drawText("CYCLES",cyclesText_,juce::Justification::centredLeft,false);
                if(generateOpen_) g.drawText("PHASE",phaseText_,juce::Justification::centredLeft,false);
                if(generateOpen_) g.drawText("P.WIDTH",widthText_,juce::Justification::centredLeft,false);
                if(transformOpen_) g.drawText("GAIN",gainText_,juce::Justification::centredLeft,false);
                if(transformOpen_) g.drawText("OFFSET",offsetText_,juce::Justification::centredLeft,false);
                if(transformOpen_) g.drawText("PROCESS",processLabel_,juce::Justification::centredLeft,false);
                if(drawOpen_) {
                    auto drawToolBorder=[&](juce::TextButton& b,WaveformTool tool) {
                        g.setColour(canvas_.tool()==tool ? mct::origami::ui::signalSourceColour().withAlpha(0.82f)
                                                        : juce::Colour(0xff383838));
                        g.drawRect(b.getBounds().toFloat(),1.0f);
                    };
                    drawToolBorder(pencil_,WaveformTool::pencil); drawToolBorder(line_,WaveformTool::line);
                    drawToolBorder(curve_,WaveformTool::curve); drawToolBorder(select_,WaveformTool::select);
                }
                if(generateOpen_) { g.setColour(mct::origami::ui::signalSourceColour().withAlpha(0.75f)); g.drawRect(apply_.getBounds().toFloat(),1.0f); }
            }
        private:
            int calculateRequiredHeight() const noexcept {
                int h=10;
                h+=29; if(drawOpen_) h+=26+3+26+7;
                h+=29; if(gridOpen_) h+=5*29+5;
                h+=29; if(generateOpen_) h+=4*29+26+7;
                h+=29; if(transformOpen_) h+=2*29+24+3+24+3+24+8+16+24+3+24+3+24+6;
                return h;
            }
            void relayout() {
                resized(); repaint();
                if(onContentHeightChanged) onContentHeightChanged();
            }
            static void styleSectionButton(juce::TextButton& b) {
                b.setColour(juce::TextButton::buttonColourId,juce::Colour(0xff1c1c1c));
                b.setColour(juce::TextButton::buttonOnColourId,juce::Colour(0xff1c1c1c));
                b.setColour(juce::TextButton::textColourOffId,juce::Colours::white.withAlpha(0.68f));
                b.setMouseCursor(juce::MouseCursor::PointingHandCursor);
            }
            static void setGroupVisible(std::initializer_list<juce::Component*> items,bool visible) {
                for(auto* c:items) c->setVisible(visible);
            }
            static void layoutSectionHeader(juce::Rectangle<int>& area,juce::TextButton& b,const juce::String& title) {
                b.setButtonText(title+"    V");
                b.setBounds(area.removeFromTop(24)); area.removeFromTop(5);
            }
            void updateToolButtons() {
                pencil_.setColour(juce::TextButton::buttonColourId,canvas_.tool()==WaveformTool::pencil ?
                    mct::origami::ui::signalSourceColour().withAlpha(0.24f):juce::Colour(0xff080808));
                line_.setColour(juce::TextButton::buttonColourId,canvas_.tool()==WaveformTool::line ?
                    mct::origami::ui::signalSourceColour().withAlpha(0.24f):juce::Colour(0xff080808));
                curve_.setColour(juce::TextButton::buttonColourId,canvas_.tool()==WaveformTool::curve ?
                    mct::origami::ui::signalSourceColour().withAlpha(0.24f):juce::Colour(0xff080808));
                select_.setColour(juce::TextButton::buttonColourId,canvas_.tool()==WaveformTool::select ?
                    mct::origami::ui::signalSourceColour().withAlpha(0.24f):juce::Colour(0xff080808));
            }
        public:
            void setSelectionAvailable(bool available) {
                for(auto* c:std::array<juce::Component*,9>{{&gain_,&offset_,&transformApply_,&invert_,&reverse_,&zero_,&normalize_,&smooth_,&fadeIn_}})
                    c->setEnabled(available);
                fadeOut_.setEnabled(available); removeDc_.setEnabled(available);
            }
        private:
            void dismissNumberEditorIfNeeded(juce::Component* clicked) {
                if(clicked==&cycles_ || clicked==&phase_ || clicked==&pulseWidth_ || clicked==&gain_ || clicked==&offset_) return;
                for(auto* editor:std::array<juce::TextEditor*,5>{{&cycles_,&phase_,&pulseWidth_,&gain_,&offset_}}) {
                    editor->setHighlightedRegion({});
                    if(editor->hasKeyboardFocus(true)) editor->giveAwayKeyboardFocus();
                }
                grabKeyboardFocus();
            }
            static void setupCombo(NativeChoiceBox& box,std::initializer_list<const char*> items) {
                int id=1; for(auto* item:items) box.addNativeItem(item,id++);
                box.setMouseCursor(juce::MouseCursor::PointingHandCursor);
            }
            static void setupNumber(juce::TextEditor& editor,const juce::String& value) {
                editor.setText(value,false);
                editor.setJustification(juce::Justification::centredLeft);
                editor.setInputRestrictions(7,"0123456789.-");
                editor.setSelectAllWhenFocused(true);
                editor.setColour(juce::TextEditor::backgroundColourId,juce::Colour(0xff080808));
                editor.setColour(juce::TextEditor::textColourId,juce::Colours::white.withAlpha(0.82f));
                editor.setColour(juce::TextEditor::outlineColourId,juce::Colour(0xff383838));
                editor.setColour(juce::TextEditor::focusedOutlineColourId,
                                 mct::origami::ui::signalSourceColour().withAlpha(0.85f));
                editor.setColour(juce::TextEditor::highlightColourId,
                                 mct::origami::ui::signalSourceColour().withAlpha(0.38f));
                editor.setColour(juce::TextEditor::highlightedTextColourId,juce::Colours::white);
                editor.setColour(juce::TextEditor::shadowColourId,juce::Colours::transparentBlack);
                editor.setIndents(8,0);
            }
            static void styleButton(juce::TextButton& button) {
                button.setColour(juce::TextButton::buttonColourId,juce::Colour(0xff080808));
                button.setColour(juce::TextButton::buttonOnColourId,
                                 mct::origami::ui::signalSourceColour().withAlpha(0.28f));
                button.setColour(juce::TextButton::textColourOffId,juce::Colours::white.withAlpha(0.82f));
                button.setColour(juce::TextButton::textColourOnId,juce::Colours::white);
            }
            template<typename Control>
            static void layoutRow(juce::Rectangle<int>& area,juce::Rectangle<int>& label,Control& control) {
                auto row=area.removeFromTop(26); label=row.removeFromLeft(52); control.setBounds(row); area.removeFromTop(3);
            }
            void updateGeneratorFields() {
                const int type=generatorType_.getSelectedId();
                const bool noise=type==5;
                cycles_.setEnabled(!noise);
                phase_.setEnabled(!noise);
                pulseWidth_.setEnabled(type==3);
            }
            GridSettings& grid_; WaveformCanvas& canvas_;
            juce::Rectangle<int> xGridText_,xSnapText_,yGridText_,ySnapText_,zeroText_;
            juce::Rectangle<int> typeText_,cyclesText_,phaseText_,widthText_,gainText_,offsetText_,processLabel_;
            juce::TextButton drawHeader_,gridHeader_,generateHeader_,transformHeader_;
            juce::TextButton pencil_{"PENCIL"},line_{"LINE"},curve_{"CURVE"},select_{"SELECT"},apply_{"APPLY"};
            juce::TextButton transformApply_{"APPLY"},invert_{"INVERT"},reverse_{"REVERSE"},zero_{"ZERO"},normalize_{"NORMALIZE"},smooth_{"SMOOTH"},fadeIn_{"FADE IN"},fadeOut_{"FADE OUT"},removeDc_{"REMOVE DC"};
            NativeChoiceBox gridResolution_,xSnap_,yGrid_,ySnap_,zeroSnap_,generatorType_;
            juce::TextEditor cycles_,phase_,pulseWidth_,gain_,offset_;
            bool drawOpen_=true,gridOpen_=true,generateOpen_=false,transformOpen_=true;
            int contentHeight_=0;
        };

        class ToolsScroller final : public juce::Component {
        public:
            explicit ToolsScroller(ToolsPanel& panel):panel_(panel) {
                addAndMakeVisible(viewport_);
                viewport_.setViewedComponent(&panel_,false);
                viewport_.setScrollBarsShown(true,false);
                viewport_.setScrollBarThickness(5);
                viewport_.setWantsKeyboardFocus(false);
                panel_.onContentHeightChanged=[this] { updateContentSize(); };
            }
            void resized() override { viewport_.setBounds(getLocalBounds()); updateContentSize(); }
        private:
            void updateContentSize() {
                const int width=juce::jmax(1,viewport_.getMaximumVisibleWidth());
                panel_.setSize(width,juce::jmax(viewport_.getHeight(),panel_.preferredHeight()));
            }
            ToolsPanel& panel_;
            juce::Viewport viewport_;
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
              timeline_("FRAMES"),table_("TABLE"),frameStrip_(document_),waveformCanvas_(document_,gridSettings_),
              toolsPanel_(gridSettings_,waveformCanvas_),toolsScroller_(toolsPanel_) {
            setWantsKeyboardFocus(true);
            setFocusContainerType(juce::Component::FocusContainerType::keyboardFocusContainer);
            addAndMakeVisible(header_);
            header_.onClose=[this] { if(onClose) onClose(); };
            header_.onUndo=[this] { undo(); };
            header_.onRedo=[this] { redo(); };
            for(auto* region:std::array<EditorRegion*,5>{{&tools_,&waveform_,&spectrum_,&timeline_,&table_}})
                addAndMakeVisible(region);
            tools_.setContentComponent(toolsScroller_);
            timeline_.setContentComponent(frameStrip_);
            waveform_.setContentComponent(waveformCanvas_);
            frameStrip_.onFrameSelected=[this](unsigned) { waveformCanvas_.cancelPendingShape(); waveformCanvas_.clearSelection(); refreshSelectedFrame(); };
            waveformCanvas_.onSamplesChanged=[this] { frameStrip_.refreshSelectedThumbnail(); };
            waveformCanvas_.onSelectionChanged=[this](bool active) { toolsPanel_.setSelectionAvailable(active); };
            waveformCanvas_.onEditCommitted=[this](std::uint64_t id,const auto& before,const auto& after) {
                commitEdit(id,before,after);
            };
            toolsPanel_.onGenerate=[this](int type,float cycles,float phase,float pulseWidth) {
                generateSelectedFrame(type,cycles,phase,pulseWidth);
            };
            toolsPanel_.onTransform=[this](int op,float gain,float offset) { transformSelection(op,gain,offset); };
            header_.setDocumentName(document_.name);
            toolsPanel_.setSelectionAvailable(false);
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
            if(mods.isCommandDown() && key.getTextCharacter()=='a') { waveformCanvas_.selectAll(); return true; }
            if(mods.isCommandDown() && key.getTextCharacter()=='z') {
                if(mods.isShiftDown()) redo(); else undo();
                return true;
            }
            if(key==juce::KeyPress::escapeKey && waveformCanvas_.hasPendingShape()) {
                waveformCanvas_.cancelPendingShape(); return true;
            }
            if(key==juce::KeyPress::escapeKey && waveformCanvas_.hasSelection()) {
                waveformCanvas_.clearSelection(); return true;
            }
            if(key==juce::KeyPress::escapeKey && onClose) {
                onClose();
                return true;
            }
            return false;
        }
    private:
        void transformSelection(int op,float gain,float offset) {
            if(!document_.valid() || !waveformCanvas_.hasSelection()) return;
            const auto selection=waveformCanvas_.selection();
            auto& frame=document_.frames[document_.selectedFrame];
            if(frame.id!=selection.frameId) return;
            const auto before=frame.samples;
            const auto first=selection.start,last=selection.end;
            if(op==1) {
                for(std::size_t i=first;i<=last;++i) frame.samples[i]=juce::jlimit(-1.0f,1.0f,frame.samples[i]*gain+offset);
            } else if(op==2) {
                for(std::size_t i=first;i<=last;++i) frame.samples[i]=-frame.samples[i];
            } else if(op==3) {
                std::reverse(frame.samples.begin()+static_cast<std::ptrdiff_t>(first),
                             frame.samples.begin()+static_cast<std::ptrdiff_t>(last+1));
            } else if(op==4) {
                std::fill(frame.samples.begin()+static_cast<std::ptrdiff_t>(first),
                          frame.samples.begin()+static_cast<std::ptrdiff_t>(last+1),0.0f);
            } else if(op==5) {
                float peak=0.0f;
                for(std::size_t i=first;i<=last;++i) peak=juce::jmax(peak,std::abs(frame.samples[i]));
                if(peak>1.0e-7f) for(std::size_t i=first;i<=last;++i) frame.samples[i]=juce::jlimit(-1.0f,1.0f,frame.samples[i]/peak);
            } else if(op==6) {
                const auto source=frame.samples;
                for(std::size_t i=first;i<=last;++i) {
                    const auto lo=juce::jmax(first,i>2?i-2:first), hi=juce::jmin(last,i+2);
                    float sum=0.0f; for(std::size_t j=lo;j<=hi;++j) sum+=source[j];
                    frame.samples[i]=sum/static_cast<float>(hi-lo+1);
                }
            } else if(op==7 || op==8) {
                const float denom=static_cast<float>(juce::jmax<std::size_t>(1,last-first));
                for(std::size_t i=first;i<=last;++i) {
                    float t=static_cast<float>(i-first)/denom; if(op==8) t=1.0f-t;
                    frame.samples[i]*=t;
                }
            } else if(op==9) {
                float mean=0.0f; for(std::size_t i=first;i<=last;++i) mean+=frame.samples[i];
                mean/=static_cast<float>(last-first+1);
                for(std::size_t i=first;i<=last;++i) frame.samples[i]=juce::jlimit(-1.0f,1.0f,frame.samples[i]-mean);
            }
            const auto after=frame.samples;
            if(after==before) return;
            commitEdit(frame.id,before,after);
            waveformCanvas_.refresh(); frameStrip_.refreshSelectedThumbnail();
        }
        void generateSelectedFrame(int type,float cycles,float phaseOffset,float pulseWidth) {
            if(!document_.valid()) return;
            auto& frame=document_.frames[document_.selectedFrame];
            const auto before=frame.samples;
            juce::Random noise(static_cast<juce::int64>(++generationSeed_));
            for(std::size_t i=0;i<frame.samples.size();++i) {
                const float base=static_cast<float>(i)/static_cast<float>(frame.samples.size());
                const float p=base*cycles+phaseOffset;
                const float wrapped=p-std::floor(p);
                float value=0.0f;
                switch(type) {
                    case 1: value=std::sin(p*juce::MathConstants<float>::twoPi); break;
                    case 2: value=2.0f*wrapped-1.0f; break;
                    case 3: value=wrapped<pulseWidth ? 1.0f : -1.0f; break;
                    case 4: value=wrapped<0.5f ? (-1.0f+4.0f*wrapped) : (3.0f-4.0f*wrapped); break;
                    case 5: value=noise.nextFloat()*2.0f-1.0f; break;
                    default: return;
                }
                frame.samples[i]=juce::jlimit(-1.0f,1.0f,value);
            }
            const auto after=frame.samples;
            if(after==before) return;
            commitEdit(frame.id,before,after);
            waveformCanvas_.refresh();
            frameStrip_.refreshSelectedThumbnail();
        }
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
        GridSettings gridSettings_;
        EditorHeader header_;
        EditorRegion tools_,waveform_,spectrum_,timeline_,table_;
        FrameStrip frameStrip_;
        WaveformCanvas waveformCanvas_;
        ToolsPanel toolsPanel_;
        ToolsScroller toolsScroller_;
        std::vector<HistoryEntry> history_;
        std::size_t historyIndex_=0;
        std::uint64_t generationSeed_=0;
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
