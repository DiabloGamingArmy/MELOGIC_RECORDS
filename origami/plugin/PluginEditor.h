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
#include "ui/FxPage.h"
#include "ui/WavetableDocument.h"
#include "ui/WavetableFrameOps.h"
#include "ui/FrameTools.h"
#include "ui/NativeChoiceMenu.h"
#include <optional>
#include <set>
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

    // mct-origami-fx-modulation-graph-ux-p03
    // A modulation drag belongs to the editor, not to the component that
    // started it: hovering a page tab for a deliberate moment switches pages
    // and the SAME drag continues onto the new page's knobs.
    struct ModulationDragContext {
        bool active=false;
        mct::origami::ModSource source=mct::origami::ModSource::Env1;
        int originPage=0;
        int hoverMode=-1;
        double hoverStartMs=0.0;
        juce::Point<int> lastPosition;
    };
    static constexpr double pageSwitchHoverMs=300.0;
    const ModulationDragContext& modulationDragContext() const noexcept { return modulationDrag_; }
    void beginModulationDrag(mct::origami::ModSource);
    void updateModulationDragHover(juce::Point<int> editorPoint,double nowMs);
    void endModulationDrag();
    int currentPage() const noexcept { return currentPage_; }
    void openGlobalFx();
    bool globalFxVisible() const noexcept { return globalOverlay_.isShowing(); }
    // Shared knob menu actions (also used by tests).
    bool assignModulator(mct::origami::ModSource,juce::Slider&);
private:
    class WavetableEditorSurface final : public juce::Component {
        static constexpr int editorHeaderHeight=30;
        static constexpr int regionHeaderHeight=28;
        static constexpr int timelineHeight=125;
        static constexpr int frameToolsHeight=96;
        static constexpr int contentGutter=4;

        class EditorRegion final : public juce::Component {
        public:
            explicit EditorRegion(juce::String title):title_(std::move(title)) {}
            juce::Rectangle<int> contentBounds() const noexcept {
                return getLocalBounds().withTrimmedTop(regionHeaderHeight).reduced(contentGutter);
            }
            void setHeaderAccessory(juce::Component& component,int width=116) {
                headerAccessory_=&component; headerAccessoryWidth_=width;
                addAndMakeVisible(component); resized(); repaint();
            }
            void setHeaderAccessoryWidth(int width) {
                headerAccessoryWidth_=width; resized(); repaint();
            }
            void setContentComponent(juce::Component& component) {
                if(content_==&component) { component.setVisible(true); resized(); return; }
                if(content_!=nullptr) content_->setVisible(false);
                content_=&component;
                addAndMakeVisible(component);
                component.toFront(false);
                resized();
                repaint();
            }
        void resized() override {
                if(content_!=nullptr) content_->setBounds(contentBounds());
                if(headerAccessory_!=nullptr)
                    headerAccessory_->setBounds(getLocalBounds().withHeight(regionHeaderHeight).removeFromRight(headerAccessoryWidth_).reduced(3,2));
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
                g.setFont(juce::Font(juce::FontOptions("Arial",10.0f,juce::Font::bold)));
                g.drawText(title_,header.reduced(7,0),juce::Justification::centredLeft,false);
            }
        private:
            juce::String title_;
            juce::Component* content_=nullptr;
            juce::Component* headerAccessory_=nullptr;
            int headerAccessoryWidth_=116;
        };

        class FrameStrip final : public juce::Component {
            class FrameCard final : public juce::Component {
            public:
                std::function<void(unsigned,juce::ModifierKeys)> onSelected;
                FrameCard(std::uint64_t frameId,unsigned displayIndex,
                          const std::array<float,mct::origami::ui::kWavetableFrameSize>& samples)
                    :displayIndex_(displayIndex),samples_(&samples) {
                    juce::ignoreUnused(frameId);
                    setMouseCursor(juce::MouseCursor::PointingHandCursor);
                    setInterceptsMouseClicks(true,false);
                }
                void setSelected(bool selected,bool primary) {
                    if(selected_==selected && primary_==primary) return;
                    selected_=selected; primary_=primary;
                    repaint();
                }
                void mouseDown(const juce::MouseEvent& event) override {
                    grabKeyboardFocus();
                    if(onSelected) onSelected(displayIndex_,event.mods);
                }
                void paint(juce::Graphics& g) override {
                    const auto b=getLocalBounds().toFloat().reduced(0.5f);
                    g.setColour(juce::Colour(0xff0d0d0d));
                    g.fillRect(getLocalBounds());
                    g.setColour(primary_ ? juce::Colour(0xffff1018) : selected_ ? juce::Colour(0xffb0b0b0) : juce::Colour(0xff353535));
                    g.drawRect(b,selected_ ? 1.5f : 1.0f);

                    auto wave=getLocalBounds().reduced(11,10);
                    wave.removeFromBottom(18);
                    if(samples_!=nullptr && !wave.isEmpty()) {
                        const float mid=static_cast<float>(wave.getCentreY());
                        const float amp=static_cast<float>(wave.getHeight())*.42f;
                        const int columns=juce::jmax(2,wave.getWidth());
                        const int sampleCount=static_cast<int>(samples_->size());
                        const float samplesPerColumn=static_cast<float>(sampleCount)/static_cast<float>(columns);

                        // Estimate local waveform density from zero crossings.  Sparse
                        // shapes retain the smooth trace; dense shapes use a min/max
                        // column envelope so sub-pixel peaks cannot disappear.
                        int zeroCrossings=0;
                        float previous=(*samples_)[0];
                        for(int i=1;i<sampleCount;++i) {
                            const float current=(*samples_)[static_cast<std::size_t>(i)];
                            if((previous<0.0f && current>=0.0f) || (previous>0.0f && current<=0.0f))
                                ++zeroCrossings;
                            previous=current;
                        }
                        const float cycles=0.5f*static_cast<float>(zeroCrossings);
                        const bool dense=cycles>static_cast<float>(columns)*0.18f;

                        juce::Path trace,body;
                        if(!dense) {
                            // Interpolated sampling avoids the nearest-sample stepping
                            // that made even simple thumbnails less faithful.
                            for(int x=0;x<columns;++x) {
                                const float position=static_cast<float>(x)*static_cast<float>(sampleCount-1)
                                                     /static_cast<float>(columns-1);
                                const int i0=juce::jlimit(0,sampleCount-1,static_cast<int>(position));
                                const int i1=juce::jmin(sampleCount-1,i0+1);
                                const float frac=position-static_cast<float>(i0);
                                const float sample=juce::jmap(frac,(*samples_)[static_cast<std::size_t>(i0)],
                                                                   (*samples_)[static_cast<std::size_t>(i1)]);
                                const float px=static_cast<float>(wave.getX()+x);
                                const float py=mid-sample*amp;
                                if(x==0) { trace.startNewSubPath(px,py); body.startNewSubPath(px,mid); }
                                else trace.lineTo(px,py);
                                body.lineTo(px,py);
                            }
                            body.lineTo(static_cast<float>(wave.getRight()),mid);
                            body.closeSubPath();
                            g.setColour(mct::origami::ui::signalSurfaceColour(0.48f,0.34f));
                            g.fillPath(body);
                            g.setColour(juce::Colours::white.withAlpha(0.94f));
                            const float stroke=cycles>static_cast<float>(columns)*0.08f?1.35f:2.0f;
                            g.strokePath(trace,juce::PathStrokeType(stroke,juce::PathStrokeType::curved,
                                                                  juce::PathStrokeType::rounded));
                        } else {
                            // One bounded scan of the 2048 source samples, partitioned
                            // by screen column.  Min/max retains every visible excursion
                            // without constructing a 2048-segment antialiased path.
                            juce::Path envelope;
                            for(int x=0;x<columns;++x) {
                                const int begin=juce::jlimit(0,sampleCount-1,
                                    static_cast<int>(std::floor(static_cast<float>(x)*samplesPerColumn)));
                                const int end=juce::jlimit(begin+1,sampleCount,
                                    static_cast<int>(std::ceil(static_cast<float>(x+1)*samplesPerColumn)));
                                float minimum=(*samples_)[static_cast<std::size_t>(begin)];
                                float maximum=minimum;
                                for(int i=begin+1;i<end;++i) {
                                    const float v=(*samples_)[static_cast<std::size_t>(i)];
                                    minimum=juce::jmin(minimum,v); maximum=juce::jmax(maximum,v);
                                }
                                const float px=static_cast<float>(wave.getX()+x)+0.5f;
                                const float top=mid-maximum*amp;
                                const float bottom=mid-minimum*amp;
                                envelope.startNewSubPath(px,top);
                                envelope.lineTo(px,bottom);
                            }
                            g.setColour(mct::origami::ui::signalSourceColour().withAlpha(0.28f));
                            g.strokePath(envelope,juce::PathStrokeType(1.0f));
                            g.setColour(juce::Colours::white.withAlpha(0.90f));
                            g.strokePath(envelope,juce::PathStrokeType(0.72f));
                        }
                    }
                    g.setFont(juce::Font(juce::FontOptions("Arial",9.5f,juce::Font::bold)));
                    g.setColour(juce::Colours::white.withAlpha(0.78f));
                    g.drawText(juce::String(displayIndex_+1),getLocalBounds().removeFromBottom(18),
                               juce::Justification::centred,false);
                }
            private:
                unsigned displayIndex_=0;
                const std::array<float,mct::origami::ui::kWavetableFrameSize>* samples_=nullptr;
                bool selected_=false;
                bool primary_=false;
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
            std::function<void()> onAddRequested;
            explicit FrameStrip(mct::origami::ui::WavetableDocument& document):document_(document) {
                viewport_.setViewedComponent(&content_,false);
                // The frame strip is intentionally horizontal-only. JUCE reserves
                // scrollbar space instead of overlaying the frame cards, so dense
                // tables remain fully visible when horizontal scrolling is needed.
                viewport_.setScrollBarsShown(false,true,false,false);
                viewport_.setScrollBarThickness(frameScrollBarThickness);
                viewport_.setWantsKeyboardFocus(true);
                addAndMakeVisible(viewport_);
                add_.onClicked=[this] { if(onAddRequested) onAddRequested(); };
                rebuild();
            }
            void rebuild() {
                cards_.clear();
                for(unsigned i=0;i<document_.frames.size();++i) {
                    const auto& frame=document_.frames[i];
                    auto card=std::make_unique<FrameCard>(frame.id,i,frame.samples);
                    card->onSelected=[this](unsigned index,juce::ModifierKeys mods){ select(index,mods); };
                    content_.addAndMakeVisible(*card);
                    cards_.push_back(std::move(card));
                }
                content_.addAndMakeVisible(add_);
                add_.setAvailable(document_.frames.size()<mct::origami::ui::kMaxWavetableFrames);
                if(document_.selectedFrame>=cards_.size()) document_.selectedFrame=0;
                selected_.clear();selected_.insert(static_cast<unsigned>(document_.selectedFrame));
                anchor_=static_cast<unsigned>(document_.selectedFrame);
                updateSelection();
                resized();
            }
            void resized() override {
                constexpr int cardWidth=90;
                constexpr int gap=5;
                constexpr int verticalInset=3;
                const int requiredWidth=static_cast<int>(cards_.size()+1)*cardWidth
                    + static_cast<int>(cards_.size())*gap;
                const bool needsHorizontalScroll=requiredWidth>getWidth();

                // Reserve a bottom lane only while the horizontal scrollbar exists.
                // This prevents JUCE's scrollbar from covering frame cards while
                // preserving the full strip height for small tables.
                auto viewportBounds=getLocalBounds();
                if(needsHorizontalScroll)
                    viewportBounds.removeFromBottom(frameScrollBarGap);
                viewport_.setBounds(viewportBounds);

                const int cardHeight=juce::jmax(1,viewportBounds.getHeight()-verticalInset*2);
                int x=0;
                for(auto& card:cards_) {
                    card->setBounds(x,verticalInset,cardWidth,cardHeight);
                    x+=cardWidth+gap;
                }
                add_.setBounds(x,verticalInset,cardWidth,cardHeight);
                content_.setSize(juce::jmax(viewportBounds.getWidth(),x+cardWidth),
                                 viewportBounds.getHeight());
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
            void select(unsigned index,juce::ModifierKeys mods={}) {
                if(index>=cards_.size()) return;
                if(mods.isShiftDown()) {
                    selected_.clear();
                    for(unsigned i=std::min(anchor_,index);i<=std::max(anchor_,index);++i) selected_.insert(i);
                } else if(mods.isCommandDown()) {
                    if(selected_.find(index) != selected_.end() && selected_.size()>1) selected_.erase(index);
                    else selected_.insert(index);
                    anchor_=index;
                } else { selected_.clear();selected_.insert(index);anchor_=index; }
                document_.selectedFrame=selected_.find(index)!=selected_.end()?index:*selected_.begin();
                updateSelection();
                reveal(static_cast<unsigned>(document_.selectedFrame));
                if(onFrameSelected) onFrameSelected(static_cast<unsigned>(document_.selectedFrame));
            }
            std::vector<unsigned> selectedIndices() const {return {selected_.begin(),selected_.end()};}
            void selectRange(const std::vector<unsigned>& indices,unsigned primary) {
                selected_.clear();for(auto index:indices) if(index<cards_.size())selected_.insert(index);
                if(selected_.empty()) selected_.insert(primary);
                document_.selectedFrame=primary;anchor_=primary;updateSelection();reveal(primary);
                if(onFrameSelected) onFrameSelected(primary);
            }
            void refreshSelectedThumbnail() {
                if(document_.selectedFrame<cards_.size()) cards_[document_.selectedFrame]->repaint();
            }
            void refreshThumbnail(unsigned index) {
                if(index<cards_.size()) cards_[index]->repaint();
            }
        private:
            void updateSelection() {
                for(unsigned i=0;i<cards_.size();++i)
                    cards_[i]->setSelected(selected_.find(i) != selected_.end(),i==document_.selectedFrame);
            }
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
            static constexpr int frameScrollBarThickness=9;
            static constexpr int frameScrollBarGap=frameScrollBarThickness+2;
            mct::origami::ui::WavetableDocument& document_;
            juce::Viewport viewport_;
            juce::Component content_;
            std::vector<std::unique_ptr<FrameCard>> cards_;
            AddCard add_;
            std::set<unsigned> selected_;
            unsigned anchor_=0;
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
        struct WaveformSelection {
            bool active=false;
            std::uint64_t frameId=0;
            std::size_t start=0,end=0;
        };
        struct CurvePoint {
            std::uint64_t id=0;
            std::size_t sample=0;
            float value=0.0f;
        };
        struct CurveSegment {
            std::uint64_t leftId=0,rightId=0;
            float controlX=0.5f;
            float controlY=0.0f;
            float hardness=0.5f;
        };
        struct CurveDraft {
            bool active=false;
            std::uint64_t frameId=0;
            std::array<float,mct::origami::ui::kWavetableFrameSize> original{};
            std::vector<CurvePoint> points;
            std::vector<CurveSegment> segments;
            std::uint64_t selectedPointId=0;
            int selectedSegment=-1;
        };

        class WaveformCanvas final : public juce::Component {
        public:
            std::function<void()> onSamplesChanged;
            std::function<void(bool)> onSelectionChanged;
            std::function<void(bool)> onCurveDraftChanged;
            std::function<void(std::uint64_t,const std::array<float,mct::origami::ui::kWavetableFrameSize>&,
                               const std::array<float,mct::origami::ui::kWavetableFrameSize>&)> onEditCommitted;
            explicit WaveformCanvas(mct::origami::ui::WavetableDocument& document,GridSettings& grid)
                :grid_(grid),document_(document) {
                setInterceptsMouseClicks(true,false);
                setMouseCursor(juce::MouseCursor::CrosshairCursor);
            }
            void refresh() { repaint(); }
            bool hasPendingShape() const noexcept { return lineDrawing_ || curve_.active; }
            bool hasCurveDraft() const noexcept { return curve_.active; }
            std::function<void()> onCurveSelectionChanged;
            int curvePointCount() const noexcept { return static_cast<int>(curve_.points.size()); }
            int selectedCurvePointIndex() const noexcept {
                for(std::size_t i=0;i<curve_.points.size();++i) if(curve_.points[i].id==curve_.selectedPointId) return static_cast<int>(i);
                return -1;
            }
            int selectedCurveSegmentIndex() const noexcept { return curve_.selectedSegment; }
            bool selectedCurvePointValues(int& sample,float& value) const noexcept {
                const int i=selectedCurvePointIndex(); if(i<0) return false;
                sample=static_cast<int>(curve_.points[static_cast<std::size_t>(i)].sample); value=curve_.points[static_cast<std::size_t>(i)].value; return true;
            }
            bool selectedCurveSegmentValues(float& x,float& y,float& hardness) const noexcept {
                const int i=curve_.selectedSegment; if(i<0 || i>=static_cast<int>(curve_.segments.size())) return false;
                const auto& seg=curve_.segments[static_cast<std::size_t>(i)]; x=seg.controlX; y=seg.controlY; hardness=seg.hardness; return true;
            }
            void setSelectedCurvePoint(int sample,float value) {
                const int i=selectedCurvePointIndex(); if(i<0) return;
                auto& p=curve_.points[static_cast<std::size_t>(i)];
                const std::size_t lo=i>0 ? curve_.points[static_cast<std::size_t>(i-1)].sample+1 : 0;
                const std::size_t hi=static_cast<std::size_t>(i)+1<curve_.points.size() ? curve_.points[static_cast<std::size_t>(i+1)].sample-1 : 2047;
                p.sample=juce::jlimit(lo,hi,static_cast<std::size_t>(juce::jlimit(0,2047,sample)));
                p.value=juce::jlimit(-1.0f,1.0f,value); rebuildCurveSegments(static_cast<std::size_t>(i)); renderCurvePreview(); repaint();
                if(onCurveSelectionChanged) onCurveSelectionChanged();
            }
            void setSelectedCurveSegment(float x,float y,float hardness) {
                const int i=curve_.selectedSegment; if(i<0 || i>=static_cast<int>(curve_.segments.size())) return;
                auto& seg=curve_.segments[static_cast<std::size_t>(i)];
                seg.controlX=juce::jlimit(0.02f,0.98f,x); seg.controlY=juce::jlimit(-1.0f,1.0f,y); seg.hardness=juce::jlimit(0.0f,1.0f,hardness);
                renderCurvePreview(); repaint(); if(onCurveSelectionChanged) onCurveSelectionChanged();
            }
            void resetSelectedCurveSegment() {
                const int i=curve_.selectedSegment; if(i<0 || i>=static_cast<int>(curve_.segments.size())) return;
                auto& seg=curve_.segments[static_cast<std::size_t>(i)]; const auto& a=curve_.points[static_cast<std::size_t>(i)]; const auto& b=curve_.points[static_cast<std::size_t>(i+1)];
                seg.controlX=0.5f; seg.controlY=(a.value+b.value)*0.5f; seg.hardness=0.5f; renderCurvePreview(); repaint();
                if(onCurveSelectionChanged) onCurveSelectionChanged();
            }
            void deleteSelectedCurvePoint() {
                const int i=selectedCurvePointIndex(); if(i<0 || curve_.points.size()<=1) return;
                curve_.points.erase(curve_.points.begin()+i); curve_.selectedPointId=0; curve_.selectedSegment=-1;
                rebuildCurveSegments(0); renderCurvePreview(); repaint(); if(onCurveSelectionChanged) onCurveSelectionChanged();
            }
            void cancelPendingShape() {
                lineDrawing_=false;
                if(curve_.active) {
                    curve_={};
                    curvePreview_={};
                    if(onCurveDraftChanged) onCurveDraftChanged(false);
                }
                repaint();
            }
            void applyCurveDraft() {
                if(!curve_.active || !document_.valid()) return;
                auto& frame=document_.frames[document_.selectedFrame];
                if(frame.id!=curve_.frameId) { cancelPendingShape(); return; }
                const auto before=curve_.original;
                frame.samples=curvePreview_;
                const auto after=frame.samples;
                const auto id=curve_.frameId;
                curve_={};
                samplesChanged();
                if(onCurveDraftChanged) onCurveDraftChanged(false);
                if(after!=before && onEditCommitted) onEditCommitted(id,before,after);
                repaint();
            }
            void setTool(WaveformTool tool) {
                if(tool_!=tool) cancelPendingShape();
                tool_=tool; setMouseCursor(juce::MouseCursor::CrosshairCursor); repaint();
            }
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
                    selecting_=true; selectionAnchor_=sampleForX(event.position.x);
                    selection_={true,document_.frames[document_.selectedFrame].id,selectionAnchor_,selectionAnchor_};
                    repaint(); if(onSelectionChanged) onSelectionChanged(true); return;
                }
                if(tool_==WaveformTool::curve) { curveMouseDown(event); return; }
                if(tool_==WaveformTool::line) {
                    lineDrawing_=true; editFrameId_=document_.frames[document_.selectedFrame].id;
                    editBefore_=document_.frames[document_.selectedFrame].samples;
                    const auto p=pointForEvent(event);
                    lineStart_=p; lineEnd_=p; linePreview_=editBefore_; repaint(); return;
                }
                drawing_=true; editFrameId_=document_.frames[document_.selectedFrame].id;
                editBefore_=document_.frames[document_.selectedFrame].samples;
                const auto point=pointForEvent(event); lastSample_=point.first; lastValue_=point.second;
                document_.setFrameSample(document_.selectedFrame,lastSample_,lastValue_); samplesChanged();
            }
            void mouseDrag(const juce::MouseEvent& event) override {
                if(tool_==WaveformTool::select) {
                    if(!selecting_ || !document_.valid()) return;
                    const auto sample=sampleForX(event.position.x);
                    selection_.start=juce::jmin(selectionAnchor_,sample); selection_.end=juce::jmax(selectionAnchor_,sample);
                    repaint(); return;
                }
                if(tool_==WaveformTool::curve) { curveMouseDrag(event); return; }
                if(tool_==WaveformTool::line && lineDrawing_) {
                    lineEnd_=pointForEvent(event); renderLinePreview(); repaint(); return;
                }
                if(!drawing_ || !document_.valid()) return;
                const auto point=pointForEvent(event); const auto currentSample=point.first; const float currentValue=point.second;
                if(currentSample==lastSample_) document_.setFrameSample(document_.selectedFrame,currentSample,currentValue);
                else {
                    const auto low=juce::jmin(lastSample_,currentSample), high=juce::jmax(lastSample_,currentSample);
                    const float denominator=static_cast<float>(static_cast<long long>(currentSample)-static_cast<long long>(lastSample_));
                    for(std::size_t sample=low;sample<=high;++sample) {
                        const float t=static_cast<float>(static_cast<long long>(sample)-static_cast<long long>(lastSample_))/denominator;
                        document_.setFrameSample(document_.selectedFrame,sample,lastValue_+t*(currentValue-lastValue_));
                    }
                }
                lastSample_=currentSample; lastValue_=currentValue; samplesChanged();
            }
            void mouseUp(const juce::MouseEvent& event) override {
                if(tool_==WaveformTool::select) {
                    if(!selecting_) return; selecting_=false; if(selection_.start==selection_.end) clearSelection(); return;
                }
                if(tool_==WaveformTool::curve) { curveMouseUp(event); return; }
                if(tool_==WaveformTool::line && lineDrawing_) {
                    lineDrawing_=false; if(!document_.valid()) return;
                    auto& frame=document_.frames[document_.selectedFrame]; frame.samples=linePreview_;
                    samplesChanged(); if(frame.samples!=editBefore_ && onEditCommitted) onEditCommitted(editFrameId_,editBefore_,frame.samples);
                    repaint(); return;
                }
                if(!drawing_) return; drawing_=false; if(!document_.valid()) return;
                const auto& after=document_.frames[document_.selectedFrame].samples;
                if(after!=editBefore_ && onEditCommitted) onEditCommitted(editFrameId_,editBefore_,after);
            }
            void paint(juce::Graphics& g) override {
                const auto bounds=getLocalBounds();
                if(bounds.isEmpty() || !document_.valid()) return;
                g.fillAll(juce::Colour(0xff080808));
                const auto plot=plotBounds();
                g.setColour(juce::Colour(0xff1d1d1d));
                for(int division=0;division<=8;++division) {
                    const float x=static_cast<float>(plot.getX())+static_cast<float>(division)/8.0f*static_cast<float>(plot.getWidth());
                    g.drawVerticalLine(juce::roundToInt(x),static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()));
                }
                for(int division=0;division<=4;++division) {
                    const float y=static_cast<float>(plot.getY())+static_cast<float>(division)/4.0f*static_cast<float>(plot.getHeight());
                    g.drawHorizontalLine(juce::roundToInt(y),static_cast<float>(plot.getX()),static_cast<float>(plot.getRight()));
                }
                if(grid_.showGrid && grid_.divisions>0) {
                    g.setColour(juce::Colours::white.withAlpha(0.035f));
                    for(int division=0;division<=grid_.divisions;++division) {
                        const float x=static_cast<float>(plot.getX())+static_cast<float>(division)/static_cast<float>(grid_.divisions)*static_cast<float>(plot.getWidth());
                        g.drawVerticalLine(juce::roundToInt(x),static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()));
                    }
                }
                g.setFont(juce::Font(juce::FontOptions("Arial",8.5f,juce::Font::plain)));
                g.setColour(juce::Colours::white.withAlpha(0.34f));
                const char* ampLabels[]{"+1.0","+0.5","0.0","-0.5","-1.0"};
                for(int i=0;i<5;++i) {
                    const float y=static_cast<float>(plot.getY())+static_cast<float>(i)/4.0f*static_cast<float>(plot.getHeight());
                    g.drawText(ampLabels[i],2,juce::roundToInt(y)-7,28,14,juce::Justification::centredRight,false);
                }
                for(int i=0;i<=8;++i) {
                    const int sample=i==8?2047:i*256;
                    const float x=static_cast<float>(plot.getX())+static_cast<float>(i)/8.0f*static_cast<float>(plot.getWidth());
                    g.drawText(juce::String(sample),juce::roundToInt(x)-18,plot.getBottom()+4,36,12,juce::Justification::centred,false);
                }
                const auto& source=curve_.active ? curvePreview_ : (lineDrawing_ ? linePreview_ : document_.frames[document_.selectedFrame].samples);
                const int columns=juce::jmax(1,plot.getWidth());
                juce::Path body,trace;
                const float mid=static_cast<float>(plot.getCentreY());
                for(int column=0;column<columns;++column) {
                    const auto begin=static_cast<std::size_t>((static_cast<long long>(column)*2048)/columns);
                    const auto end=juce::jmin<std::size_t>(2047,static_cast<std::size_t>((static_cast<long long>(column+1)*2048)/columns));
                    float minValue=1.0f,maxValue=-1.0f;
                    for(std::size_t sample=begin;sample<=end;++sample) { minValue=juce::jmin(minValue,source[sample]); maxValue=juce::jmax(maxValue,source[sample]); }
                    const float x=static_cast<float>(plot.getX()+column);
                    const float yMin=valueToY(minValue),yMax=valueToY(maxValue);
                    if(column==0) body.startNewSubPath(x,mid);
                    body.lineTo(x,yMax); body.lineTo(x,yMin);
                }
                body.lineTo(static_cast<float>(plot.getRight()),mid); body.closeSubPath();
                g.setColour(mct::origami::ui::signalSurfaceColour(0.48f,0.34f)); g.fillPath(body);
                for(int column=0;column<columns;++column) {
                    const auto sample=juce::jmin<std::size_t>(2047,static_cast<std::size_t>((static_cast<long long>(column)*2047)/juce::jmax(1,columns-1)));
                    const float x=static_cast<float>(plot.getX()+column),y=valueToY(source[sample]);
                    if(column==0) trace.startNewSubPath(x,y); else trace.lineTo(x,y);
                }
                g.setColour(juce::Colours::white.withAlpha(0.94f));
                g.strokePath(trace,juce::PathStrokeType(3.5f,juce::PathStrokeType::curved,juce::PathStrokeType::rounded));
                if(selection_.active && selection_.frameId==document_.frames[document_.selectedFrame].id) {
                    const float x1=sampleToX(selection_.start),x2=sampleToX(selection_.end);
                    g.setColour(mct::origami::ui::signalSourceColour().withAlpha(0.10f)); g.fillRect(juce::Rectangle<float>(x1,static_cast<float>(plot.getY()),juce::jmax(1.0f,x2-x1),static_cast<float>(plot.getHeight())));
                    g.setColour(juce::Colours::white.withAlpha(0.46f)); g.drawVerticalLine(juce::roundToInt(x1),static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()));
                    g.drawVerticalLine(juce::roundToInt(x2),static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()));
                }
                if(curve_.active) paintCurveDraft(g);
                juce::String readout="FRAME "+juce::String(static_cast<int>(document_.selectedFrame+1)).paddedLeft('0',3)+"     2048 SAMPLES";
                if(curve_.active) readout+="     CURVE DRAFT · "+juce::String(static_cast<int>(curve_.points.size()))+" POINTS";
                else if(selection_.active) readout+="     "+juce::String(static_cast<int>(selection_.start))+"-"+juce::String(static_cast<int>(selection_.end))+" · "+juce::String(static_cast<int>(selection_.end-selection_.start+1))+" SELECTED";
                g.drawText(readout,plot.getX(),3,plot.getWidth(),14,juce::Justification::centredRight,false);
            }
        private:
            juce::Rectangle<int> plotBounds() const noexcept { return getLocalBounds().withTrimmedLeft(34).withTrimmedRight(10).withTrimmedTop(22).withTrimmedBottom(20); }
            float sampleToX(std::size_t sample) const noexcept { const auto p=plotBounds(); return static_cast<float>(p.getX())+static_cast<float>(sample)/2047.0f*static_cast<float>(p.getWidth()); }
            float valueToY(float value) const noexcept { const auto p=plotBounds(); return static_cast<float>(p.getCentreY())-value*(static_cast<float>(p.getHeight())*0.5f); }
            float yToValue(float y) const noexcept { const auto p=plotBounds(); return juce::jlimit(-1.0f,1.0f,(static_cast<float>(p.getCentreY())-y)/(static_cast<float>(p.getHeight())*0.5f)); }
            std::size_t sampleForX(float eventX) const noexcept {
                const auto plot=plotBounds(); const float x=juce::jlimit(static_cast<float>(plot.getX()),static_cast<float>(plot.getRight()),eventX);
                const float norm=(x-static_cast<float>(plot.getX()))/static_cast<float>(juce::jmax(1,plot.getWidth()));
                return static_cast<std::size_t>(juce::jlimit(0,2047,juce::roundToInt(norm*2047.0f)));
            }
            std::pair<std::size_t,float> pointForEvent(const juce::MouseEvent& event) const noexcept {
                const auto plot=plotBounds(); const float x=juce::jlimit(static_cast<float>(plot.getX()),static_cast<float>(plot.getRight()),event.position.x);
                const float y=juce::jlimit(static_cast<float>(plot.getY()),static_cast<float>(plot.getBottom()),event.position.y);
                int sample=juce::jlimit(0,2047,juce::roundToInt((x-static_cast<float>(plot.getX()))/static_cast<float>(juce::jmax(1,plot.getWidth()))*2047.0f));
                float value=juce::jlimit(-1.0f,1.0f,1.0f-2.0f*(y-static_cast<float>(plot.getY()))/static_cast<float>(juce::jmax(1,plot.getHeight())));
                const bool bypass=juce::ModifierKeys::getCurrentModifiersRealtime().isAltDown();
                if(!bypass && grid_.snapX && grid_.divisions>0) { const float step=2047.0f/static_cast<float>(grid_.divisions); sample=juce::jlimit(0,2047,juce::roundToInt(std::round(static_cast<float>(sample)/step)*step)); }
                if(!bypass && grid_.snapZero && std::abs(value)<=48.0f/static_cast<float>(juce::jmax(1,plot.getHeight()))) value=0.0f;
                if(!bypass && grid_.snapY && grid_.amplitudeSteps>0) { const float step=2.0f/static_cast<float>(grid_.amplitudeSteps); value=juce::jlimit(-1.0f,1.0f,std::round((value+1.0f)/step)*step-1.0f); }
                return {static_cast<std::size_t>(sample),value};
            }
            void samplesChanged() {
                repaint();
                if(onSamplesChanged) onSamplesChanged();
            }
            void renderLinePreview() {
                linePreview_=editBefore_;
                auto a=lineStart_,b=lineEnd_; if(a.first>b.first) std::swap(a,b);
                const float denom=static_cast<float>(juce::jmax<std::size_t>(1,b.first-a.first));
                for(std::size_t i=a.first;i<=b.first;++i) linePreview_[i]=juce::jlimit(-1.0f,1.0f,a.second+(b.second-a.second)*static_cast<float>(i-a.first)/denom);
            }
            int hitPoint(juce::Point<float> pos) const {
                for(int i=static_cast<int>(curve_.points.size())-1;i>=0;--i)
                    if(pos.getDistanceFrom({sampleToX(curve_.points[static_cast<std::size_t>(i)].sample),valueToY(curve_.points[static_cast<std::size_t>(i)].value)})<10.0f) return i;
                return -1;
            }
            int hitControl(juce::Point<float> pos) const {
                for(int i=static_cast<int>(curve_.segments.size())-1;i>=0;--i) {
                    const auto& seg=curve_.segments[static_cast<std::size_t>(i)];
                    const auto& a=curve_.points[static_cast<std::size_t>(i)],&b=curve_.points[static_cast<std::size_t>(i+1)];
                    const float sx=static_cast<float>(a.sample)+(static_cast<float>(b.sample)-static_cast<float>(a.sample))*seg.controlX;
                    if(pos.getDistanceFrom({sampleToX(static_cast<std::size_t>(sx)),valueToY(seg.controlY)})<10.0f) return i;
                }
                return -1;
            }
            void beginCurve(const std::pair<std::size_t,float>& p) {
                curve_={}; curve_.active=true; curve_.frameId=document_.frames[document_.selectedFrame].id;
                curve_.original=document_.frames[document_.selectedFrame].samples;
                curvePreview_=curve_.original;
                curve_.points.push_back({nextCurvePointId_++,p.first,p.second}); curve_.selectedPointId=curve_.points.back().id;
                awaitingSecondPoint_=true; mouseMovedSinceDown_=false;
                if(onCurveDraftChanged) onCurveDraftChanged(true); repaint();
            }
            void addCurvePoint(const std::pair<std::size_t,float>& p) {
                if(!curve_.active) { beginCurve(p); return; }
                CurvePoint point{nextCurvePointId_++,p.first,p.second};
                auto it=std::lower_bound(curve_.points.begin(),curve_.points.end(),point.sample,[](const CurvePoint& a,std::size_t sample){ return a.sample<sample; });
                if(it!=curve_.points.end() && it->sample==point.sample) { it->value=point.value; curve_.selectedPointId=it->id; renderCurvePreview(); return; }
                const auto index=static_cast<std::size_t>(std::distance(curve_.points.begin(),it));
                curve_.points.insert(it,point); curve_.selectedPointId=point.id; curve_.selectedSegment=-1; rebuildCurveSegments(index); renderCurvePreview(); if(onCurveSelectionChanged) onCurveSelectionChanged();
            }
            void rebuildCurveSegments(std::size_t insertedIndex) {
                juce::ignoreUnused(insertedIndex);
                std::vector<CurveSegment> rebuilt;
                for(std::size_t i=0;i+1<curve_.points.size();++i) {
                    CurveSegment seg; seg.leftId=curve_.points[i].id; seg.rightId=curve_.points[i+1].id;
                    seg.controlX=0.5f; seg.controlY=(curve_.points[i].value+curve_.points[i+1].value)*0.5f; seg.hardness=0.5f;
                    rebuilt.push_back(seg);
                }
                curve_.segments=std::move(rebuilt);
            }
            static float quadratic(float a,float c,float b,float t) noexcept { const float u=1.0f-t; return u*u*a+2.0f*u*t*c+t*t*b; }
            static float solveBezierTForX(float target,float ax,float cx,float bx) noexcept {
                float lo=0.0f,hi=1.0f;
                for(int n=0;n<18;++n) { const float mid=(lo+hi)*0.5f; if(quadratic(ax,cx,bx,mid)<target) lo=mid; else hi=mid; }
                return (lo+hi)*0.5f;
            }
            void renderCurvePreview() {
                curvePreview_=curve_.original;
                if(curve_.points.size()<2) return;
                for(std::size_t si=0;si<curve_.segments.size();++si) {
                    const auto& a=curve_.points[si],&b=curve_.points[si+1]; const auto& seg=curve_.segments[si];
                    if(b.sample<=a.sample) continue;
                    const float ax=static_cast<float>(a.sample),bx=static_cast<float>(b.sample),cx=ax+(bx-ax)*juce::jlimit(0.02f,0.98f,seg.controlX);
                    const float hardness=juce::jlimit(0.0f,1.0f,seg.hardness);
                    for(std::size_t sample=a.sample;sample<=b.sample;++sample) {
                        const float t=solveBezierTForX(static_cast<float>(sample),ax,cx,bx);
                        const float shaped=hardness==0.5f ? t : (hardness>0.5f ? std::pow(t,1.0f+(hardness-0.5f)*4.0f) : 1.0f-std::pow(1.0f-t,1.0f+(0.5f-hardness)*4.0f));
                        curvePreview_[sample]=juce::jlimit(-1.0f,1.0f,quadratic(a.value,seg.controlY,b.value,shaped));
                    }
                }
            }
            void curveMouseDown(const juce::MouseEvent& event) {
                const auto pointIndex=hitPoint(event.position);
                if(pointIndex>=0) { draggingPoint_=pointIndex; curve_.selectedPointId=curve_.points[static_cast<std::size_t>(pointIndex)].id; curve_.selectedSegment=-1; if(onCurveSelectionChanged) onCurveSelectionChanged(); return; }
                const auto controlIndex=hitControl(event.position);
                if(controlIndex>=0) { draggingControl_=controlIndex; curve_.selectedSegment=controlIndex; curve_.selectedPointId=0; if(onCurveSelectionChanged) onCurveSelectionChanged(); return; }
                const auto p=pointForEvent(event);
                if(!curve_.active) { beginCurve(p); pendingClickPoint_=p; return; }
                pendingClickPoint_=p; pendingAdd_=true; mouseMovedSinceDown_=false;
            }
            void curveMouseDrag(const juce::MouseEvent& event) {
                mouseMovedSinceDown_=true;
                if(draggingPoint_>=0) {
                    auto p=pointForEvent(event); auto& point=curve_.points[static_cast<std::size_t>(draggingPoint_)];
                    const std::size_t lo=draggingPoint_>0 ? curve_.points[static_cast<std::size_t>(draggingPoint_-1)].sample+1 : 0;
                    const std::size_t hi=static_cast<std::size_t>(draggingPoint_)+1<curve_.points.size() ? curve_.points[static_cast<std::size_t>(draggingPoint_+1)].sample-1 : 2047;
                    point.sample=juce::jlimit(lo,hi,p.first); point.value=p.second; rebuildCurveSegments(static_cast<std::size_t>(draggingPoint_)); renderCurvePreview(); repaint(); if(onCurveSelectionChanged) onCurveSelectionChanged(); return;
                }
                if(draggingControl_>=0) {
                    auto& seg=curve_.segments[static_cast<std::size_t>(draggingControl_)];
                    const auto& a=curve_.points[static_cast<std::size_t>(draggingControl_)],&b=curve_.points[static_cast<std::size_t>(draggingControl_+1)];
                    const auto p=pointForEvent(event);
                    seg.controlX=juce::jlimit(0.02f,0.98f,static_cast<float>(static_cast<long long>(p.first)-static_cast<long long>(a.sample))/static_cast<float>(juce::jmax<std::size_t>(1,b.sample-a.sample)));
                    seg.controlY=p.second; renderCurvePreview(); repaint(); if(onCurveSelectionChanged) onCurveSelectionChanged(); return;
                }
                if(curve_.active && curve_.points.size()==1) {
                    auto p=pointForEvent(event); if(curve_.points.front().sample==p.first) p.first=juce::jmin<std::size_t>(2047,p.first+1);
                    if(curve_.points.size()==1) { addCurvePoint(p); draggingPoint_=hitPoint(event.position); awaitingSecondPoint_=false; }
                }
            }
            void curveMouseUp(const juce::MouseEvent&) {
                if(draggingPoint_>=0 || draggingControl_>=0) { draggingPoint_=-1; draggingControl_=-1; repaint(); return; }
                if(pendingAdd_) { addCurvePoint(pendingClickPoint_); pendingAdd_=false; awaitingSecondPoint_=false; repaint(); return; }
                if(curve_.active && curve_.points.size()==1 && !mouseMovedSinceDown_) {
                    if(awaitingSecondPoint_) { awaitingSecondPoint_=false; pendingAdd_=true; }
                }
            }
            void paintCurveDraft(juce::Graphics& g) {
                for(std::size_t i=0;i<curve_.segments.size();++i) {
                    const auto& seg=curve_.segments[i]; const auto& a=curve_.points[i],&b=curve_.points[i+1];
                    const float sx=static_cast<float>(a.sample)+(static_cast<float>(b.sample)-static_cast<float>(a.sample))*seg.controlX;
                    const juce::Point<float> c{sampleToX(static_cast<std::size_t>(sx)),valueToY(seg.controlY)};
                    g.setColour(mct::origami::ui::signalSourceColour().withAlpha(curve_.selectedSegment==static_cast<int>(i)?1.0f:0.78f)); g.fillEllipse(c.x-4.0f,c.y-4.0f,8.0f,8.0f);
                }
                for(const auto& p:curve_.points) {
                    const juce::Point<float> pos{sampleToX(p.sample),valueToY(p.value)};
                    g.setColour(p.id==curve_.selectedPointId?mct::origami::ui::signalSourceColour():juce::Colours::white);
                    g.fillEllipse(pos.x-4.5f,pos.y-4.5f,9.0f,9.0f);
                }
            }
            GridSettings& grid_; mct::origami::ui::WavetableDocument& document_;
            WaveformTool tool_=WaveformTool::pencil;
            WaveformSelection selection_{}; bool selecting_=false; std::size_t selectionAnchor_=0;
            bool drawing_=false; std::size_t lastSample_=0; float lastValue_=0.0f;
            bool lineDrawing_=false; std::pair<std::size_t,float> lineStart_{},lineEnd_{};
            std::array<float,mct::origami::ui::kWavetableFrameSize> linePreview_{};
            CurveDraft curve_{}; std::array<float,mct::origami::ui::kWavetableFrameSize> curvePreview_{};
            std::uint64_t nextCurvePointId_=1; int draggingPoint_=-1,draggingControl_=-1;
            bool awaitingSecondPoint_=false,pendingAdd_=false,mouseMovedSinceDown_=false;
            std::pair<std::size_t,float> pendingClickPoint_{};
            std::uint64_t editFrameId_=0;
            std::array<float,mct::origami::ui::kWavetableFrameSize> editBefore_{};
        };

        class SpectrumCanvas final : public juce::Component {
        public:
            enum class EditMode { Independent, Subtractive, Additive };
            void setEditMode(EditMode mode) {
                if(editMode_==mode) return;
                editMode_=mode;
                if(document_.valid()) {
                    auto& frame=document_.frames[document_.selectedFrame];
                    if(mode==EditMode::Additive) {
                        ensureAdditiveStateInitialized(frame);
                        additiveContributions_=frame.additiveContributions;
                        setAdditivePhases();
                        rebuildAdditiveMagnitudes();
                        editMagnitudes_=magnitudes_;
                        reconstructPreview();
                    } else {
                        ensureSpectralStateInitialized(frame);
                        if(mode==EditMode::Independent) {
                            magnitudes_=frame.independentMagnitudes;
                            setIndependentPhases();
                            editMagnitudes_=magnitudes_;
                            reconstructPreview();
                        } else {
                            phases_=frame.subtractiveSourcePhases;
                            rebuildSubtractiveMagnitudes(frame);
                            editMagnitudes_=magnitudes_;
                            reconstructPreview();
                        }
                    }
                }
                repaint();
            }
            EditMode editMode() const noexcept { return editMode_; }
            void selectPreviousHarmonic() noexcept { selectedBin_=juce::jmax(1,(selectedBin_>0?selectedBin_:firstBin_)-1); ensureSelectedBinVisible(); repaint(); }
            void selectNextHarmonic() noexcept { selectedBin_=juce::jmin(static_cast<int>(kBins)-1,(selectedBin_>0?selectedBin_:firstBin_)+1); ensureSelectedBinVisible(); repaint(); }
            void increaseSelectedMagnitude() { nudgeSelectedMagnitude(1); }
            void decreaseSelectedMagnitude() { nudgeSelectedMagnitude(-1); }
            void panLeft() noexcept { firstBin_-=juce::jmax(1,visibleBinCount()/8); clampFirstBin(); repaint(); }
            void panRight() noexcept { firstBin_+=juce::jmax(1,visibleBinCount()/8); clampFirstBin(); repaint(); }
            void zoomIn() noexcept { setZoom(zoom_+1); }
            void zoomOut() noexcept { setZoom(zoom_-1); }
            std::function<void()> onSamplesChanged;
            std::function<void(std::uint64_t,const std::array<float,mct::origami::ui::kWavetableFrameSize>&,
                               const std::array<float,mct::origami::ui::kWavetableFrameSize>&)> onEditCommitted;
            explicit SpectrumCanvas(mct::origami::ui::WavetableDocument& document):document_(document) {
                magnitudes_.fill(0.0f); phases_.fill(0.0f); real_.fill(0.0f); imag_.fill(0.0f);
            }
            void refresh() {
                if(editing_) return;
                if(!document_.valid()) { repaint(); return; }
                auto& frame=document_.frames[document_.selectedFrame];
                ensureSpectralStateInitialized(frame);
                if(editMode_==EditMode::Independent) {
                    magnitudes_=frame.independentMagnitudes;
                    // Canonicalise legacy/current frame state before it reaches the
                    // working spectrum. Only the visible H1..H1023 controls are authoritative.
                    magnitudes_[0]=0.0f;
                    magnitudes_[kFftSize/2]=0.0f;
                    frame.independentMagnitudes[0]=0.0f;
                    frame.independentMagnitudes[kFftSize/2]=0.0f;
                    setIndependentPhases();
                } else if(editMode_==EditMode::Additive) {
                    ensureAdditiveStateInitialized(frame);
                    additiveContributions_=frame.additiveContributions;
                    setAdditivePhases();
                    rebuildAdditiveMagnitudes();
                } else {
                    phases_=frame.subtractiveSourcePhases;
                    rebuildSubtractiveMagnitudes(frame);
                }
                repaint();
            }
            void mouseMove(const juce::MouseEvent& e) override { hoveredBin_=binForX(e.position.x); repaint(); }
            void mouseExit(const juce::MouseEvent&) override { hoveredBin_=-1; repaint(); }
            void mouseDown(const juce::MouseEvent& e) override {
                if(!document_.valid()) return;
                selectedBin_=binForX(e.position.x);
                editing_=true; editFrameId_=document_.frames[document_.selectedFrame].id;
                editBefore_=document_.frames[document_.selectedFrame].samples;
                loadAuthoringOrAnalyse(); editMagnitudes_=magnitudes_;
                lastEditedBin_=-1; editAt(e.position); 
            }
            void mouseDrag(const juce::MouseEvent& e) override { if(editing_) editAt(e.position); }
            void mouseUp(const juce::MouseEvent&) override {
                if(!editing_ || !document_.valid()) return;
                editing_=false; const auto after=document_.frames[document_.selectedFrame].samples;
                if(after!=editBefore_ && onEditCommitted) onEditCommitted(editFrameId_,editBefore_,after);
                // Do not FFT the peak-fitted output back into an authored spectrum here.
                // The selected mode's control-domain coefficients are the source of truth.
                if(editMode_==EditMode::Independent) {
                    const auto& frame=document_.frames[document_.selectedFrame];
                    magnitudes_=frame.independentMagnitudes;
                    setIndependentPhases();
                } else if(editMode_==EditMode::Additive) {
                    const auto& frame=document_.frames[document_.selectedFrame];
                    additiveContributions_=frame.additiveContributions;
                    setAdditivePhases();
                    rebuildAdditiveMagnitudes();
                } else {
                    auto& frame=document_.frames[document_.selectedFrame];
                    phases_=frame.subtractiveSourcePhases;
                    rebuildSubtractiveMagnitudes(frame);
                }
                repaint();
            }
            void mouseWheelMove(const juce::MouseEvent& e,const juce::MouseWheelDetails& wheel) override {
                const bool pan=e.mods.isShiftDown() || std::abs(wheel.deltaX)>std::abs(wheel.deltaY);
                if(pan) {
                    const float delta=std::abs(wheel.deltaX)>0.0001f?wheel.deltaX:wheel.deltaY;
                    const int step=juce::jmax(1,visibleBinCount()/8);
                    firstBin_+=delta>0.0f?-step:step;
                    clampFirstBin(); repaint(); return;
                }
                if(wheel.deltaY==0.0f) return;
                setZoom(zoom_+(wheel.deltaY>0.0f?1:-1));
            }
            void paint(juce::Graphics& g) override {
                g.fillAll(juce::Colour(0xff080808));
                auto full=getLocalBounds().reduced(8,7); if(full.getWidth()<8||full.getHeight()<16) return;
                const int gap=6;
                auto top=full.removeFromTop((full.getHeight()-gap)/2);
                full.removeFromTop(gap);
                auto lower=full;
                g.setColour(juce::Colour(0xff101010));
                g.fillRoundedRectangle(lower.toFloat(),2.0f);
                g.setColour(juce::Colour(0xff202020));
                g.drawRoundedRectangle(lower.toFloat().reduced(0.5f),2.0f,1.0f);
                auto bounds=top;
                auto labelArea=bounds.removeFromBottom(18);
                auto scaleArea=bounds.removeFromLeft(31);
                g.setFont(juce::Font(juce::FontOptions("Arial",8.5f,juce::Font::plain)));
                for(int i=0;i<=6;++i) {
                    const float y=static_cast<float>(bounds.getY())+static_cast<float>(i)/6.0f*static_cast<float>(bounds.getHeight());
                    g.setColour(juce::Colour(0xff1c1c1c));
                    g.drawHorizontalLine(juce::roundToInt(y),static_cast<float>(bounds.getX()),static_cast<float>(bounds.getRight()));
                    g.setColour(juce::Colours::white.withAlpha(0.34f));
                    g.drawText(juce::String(-12*i),scaleArea.getX(),juce::roundToInt(y)-6,scaleArea.getWidth()-4,12,juce::Justification::centredRight,false);
                }
                for(int i=0;i<=4;++i) {
                    const float x=static_cast<float>(bounds.getX())+static_cast<float>(i)/4.0f*static_cast<float>(bounds.getWidth());
                    g.setColour(juce::Colour(0xff181818));
                    g.drawVerticalLine(juce::roundToInt(x),static_cast<float>(bounds.getY()),static_cast<float>(bounds.getBottom()));
                }
                const int count=visibleBinCount(); const float slot=static_cast<float>(bounds.getWidth())/static_cast<float>(count);
                for(int n=0;n<count;++n) {
                    const int bin=firstBin_+n; if(bin>=static_cast<int>(kBins)) break;
                    const float level=editMode_==EditMode::Additive
                        ? juce::jlimit(0.0f,1.0f,additiveContributions_[static_cast<std::size_t>(bin)])
                        : juce::jlimit(0.0f,1.0f,(juce::Decibels::gainToDecibels(
                            displayAmplitudeForBin(bin,magnitudes_[static_cast<std::size_t>(bin)]),-72.0f)+72.0f)/72.0f);
                    const float height=level*static_cast<float>(bounds.getHeight());
                    const float x=static_cast<float>(bounds.getX())+static_cast<float>(n)*slot;
                    const float width=juce::jmax(1.0f,slot-1.0f);
                    if(editMode_==EditMode::Subtractive && document_.valid()) {
                        // Show the editable subtractive ceiling separately from the
                        // resulting spectrum. It is intentionally darker than the output bars.
                        const auto& frame=document_.frames[document_.selectedFrame];
                        const float sourceAmplitude=displayAmplitudeForBin(
                            bin,frame.subtractiveSourceMagnitudes[static_cast<std::size_t>(bin)]);
                        const float sourceLevel=juce::jlimit(0.0f,1.0f,
                            (juce::Decibels::gainToDecibels(sourceAmplitude,-72.0f)+72.0f)/72.0f);
                        const float maskY=static_cast<float>(bounds.getBottom())-sourceLevel*static_cast<float>(bounds.getHeight());
                        g.setColour(mct::origami::ui::signalSourceColour().darker(0.65f).withAlpha(0.90f));
                        g.fillRect(juce::Rectangle<float>(x,maskY-1.5f,width,3.0f));
                    }
                    g.setColour(mct::origami::ui::signalSourceColour().withAlpha(0.78f));
                    g.fillRect(juce::Rectangle<float>(x,static_cast<float>(bounds.getBottom())-height,width,height));
                    if(bin==(hoveredBin_>0?hoveredBin_:selectedBin_)) { g.setColour(juce::Colours::white.withAlpha(0.9f)); g.drawRect(juce::Rectangle<float>(x,static_cast<float>(bounds.getY()),width,static_cast<float>(bounds.getHeight())),1.0f); }
                }
                g.setColour(juce::Colours::white.withAlpha(0.38f)); g.setFont(juce::Font(juce::FontOptions("Arial",8.5f,juce::Font::plain)));
                for(int n=0;n<=4;++n) {
                    const int bin=firstBin_+(count-1)*n/4;
                    const float x=static_cast<float>(bounds.getX())+static_cast<float>(n)/4.0f*static_cast<float>(bounds.getWidth());
                    const auto label=noteNameForFrequency(referenceFundamentalHz_*static_cast<float>(bin));
                    g.drawText(label,juce::roundToInt(x)-22,labelArea.getY(),44,labelArea.getHeight(),juce::Justification::centred,false);
                }
                juce::String status="HARMONICS · "+juce::String(zoom_)+"x";
                if(hoveredBin_>0 && hoveredBin_<static_cast<int>(kBins)) {
                    const float frequency=referenceFundamentalHz_*static_cast<float>(hoveredBin_);
                    if(editMode_==EditMode::Additive) {
                        const float pct=100.0f*additiveContributions_[static_cast<std::size_t>(hoveredBin_)];
                        status+="     H "+juce::String(hoveredBin_)+"  "+noteNameForFrequency(frequency)+"  "+juce::String(frequency,1)+" Hz  "+juce::String(pct,1)+"%";
                    } else if(editMode_==EditMode::Subtractive && document_.valid()) {
                        const float pct=100.0f*document_.frames[document_.selectedFrame].subtractiveGains[static_cast<std::size_t>(hoveredBin_)];
                        status+="     H "+juce::String(hoveredBin_)+"  "+noteNameForFrequency(frequency)+"  "+juce::String(frequency,1)+" Hz  "+juce::String(pct,1)+"%";
                    } else {
                        const float db=juce::Decibels::gainToDecibels(displayAmplitudeForBin(hoveredBin_,magnitudes_[static_cast<std::size_t>(hoveredBin_)]),-72.0f);
                        status+="     H "+juce::String(hoveredBin_)+"  "+noteNameForFrequency(frequency)+"  "+juce::String(frequency,1)+" Hz  "+juce::String(db,1)+" dB";
                    }
                }
                g.setColour(juce::Colours::white.withAlpha(0.52f)); g.drawText(status,bounds.getX(),bounds.getY()+2,bounds.getWidth()-4,12,juce::Justification::topRight,false);
            }
        private:
            static constexpr std::size_t kFftSize=mct::origami::ui::kWavetableFrameSize;
            static constexpr std::size_t kBins=kFftSize/2+1;
            static constexpr float independentDefaultPhase_=-juce::MathConstants<float>::halfPi;
            int visibleBinCount() const noexcept { return juce::jmax(16,128/zoom_); }
            juce::Rectangle<int> plotBounds() const noexcept {
                auto full=getLocalBounds().reduced(8,7);
                const int gap=6;
                auto top=full.removeFromTop((full.getHeight()-gap)/2);
                top.removeFromBottom(18);
                top.removeFromLeft(31);
                return top;
            }
            static juce::String noteNameForFrequency(float hz) {
                if(!std::isfinite(hz) || hz<=0.0f) return {};
                const int midi=juce::roundToInt(69.0f+12.0f*std::log2(hz/440.0f));
                static constexpr const char* names[]={"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"};
                const int pc=((midi%12)+12)%12;
                return juce::String(names[pc])+juce::String(midi/12-1);
            }
            void clampFirstBin() noexcept { firstBin_=juce::jlimit(1,juce::jmax(1,static_cast<int>(kBins)-visibleBinCount()),firstBin_); }
            void ensureSelectedBinVisible() noexcept {
                if(selectedBin_<firstBin_) firstBin_=selectedBin_;
                else if(selectedBin_>=firstBin_+visibleBinCount()) firstBin_=selectedBin_-visibleBinCount()+1;
                clampFirstBin();
            }
            void nudgeSelectedMagnitude(int direction) {
                if(!document_.valid()) return;
                if(selectedBin_<1) selectedBin_=firstBin_;
                const auto index=static_cast<std::size_t>(selectedBin_);
                auto& frame=document_.frames[document_.selectedFrame];
                ensureSpectralStateInitialized(frame);
                const auto before=frame.samples;
                loadAuthoringOrAnalyse(); editMagnitudes_=magnitudes_;
                if(editMode_==EditMode::Additive) {
                    ensureAdditiveStateInitialized(frame); additiveContributions_=frame.additiveContributions;
                    additiveContributions_[index]=juce::jlimit(0.0f,1.0f,additiveContributions_[index]+0.02f*static_cast<float>(direction));
                    setAdditivePhases(); rebuildAdditiveMagnitudes();
                } else if(editMode_==EditMode::Subtractive) {
                    const float source=frame.subtractiveSourceMagnitudes[index];
                    const float current=displayAmplitudeForBin(selectedBin_,source*frame.subtractiveGains[index]);
                    const float db=juce::Decibels::gainToDecibels(current,-72.0f);
                    const float desired=fftMagnitudeForDisplayAmplitude(selectedBin_,juce::Decibels::decibelsToGain(juce::jlimit(-72.0f,0.0f,db+static_cast<float>(direction))));
                    frame.subtractiveGains[index]=source>1.0e-9f?juce::jlimit(0.0f,1.0f,desired/source):0.0f;
                    phases_=frame.subtractiveSourcePhases; rebuildSubtractiveMagnitudes(frame);
                } else {
                    const float current=displayAmplitudeForBin(selectedBin_,frame.independentMagnitudes[index]);
                    const float db=juce::Decibels::gainToDecibels(current,-72.0f);
                    frame.independentMagnitudes[index]=fftMagnitudeForDisplayAmplitude(selectedBin_,juce::Decibels::decibelsToGain(juce::jlimit(-72.0f,0.0f,db+static_cast<float>(direction))));
                    frame.independentPhases[index]=independentDefaultPhase_; magnitudes_=frame.independentMagnitudes; setIndependentPhases();
                }
                editMagnitudes_=magnitudes_; reconstructPreview();
                const auto after=frame.samples;
                if(after!=before && onEditCommitted) onEditCommitted(frame.id,before,after);
                repaint();
            }
            void setZoom(int value) noexcept {
                const int old=zoom_;
                zoom_=juce::jlimit(1,8,value);
                if(zoom_==old) return;
                const int anchor=hoveredBin_>0?hoveredBin_:firstBin_+visibleBinCount()/2;
                firstBin_=anchor-visibleBinCount()/2;
                clampFirstBin();
                repaint();
            }
            int binForX(float x) const noexcept {
                const auto p=plotBounds(); if(!p.contains(juce::roundToInt(x),p.getCentreY())) return -1;
                const float norm=juce::jlimit(0.0f,0.999999f,(x-static_cast<float>(p.getX()))/static_cast<float>(juce::jmax(1,p.getWidth())));
                return juce::jlimit(1,static_cast<int>(kBins)-1,firstBin_+static_cast<int>(norm*static_cast<float>(visibleBinCount())));
            }
            static float displayAmplitudeForBin(int bin,float magnitude) noexcept {
                return (bin<=0||bin>=static_cast<int>(kBins)-1)?magnitude/static_cast<float>(kFftSize):2.0f*magnitude/static_cast<float>(kFftSize);
            }
            static float fftMagnitudeForDisplayAmplitude(int bin,float amplitude) noexcept {
                return (bin<=0||bin>=static_cast<int>(kBins)-1)?amplitude*static_cast<float>(kFftSize):0.5f*amplitude*static_cast<float>(kFftSize);
            }
            void editAt(juce::Point<float> pos) {
                const int bin=binForX(pos.x); if(bin<1) return;
                const auto p=plotBounds();
                const float level=juce::jlimit(0.0f,1.0f,(static_cast<float>(p.getBottom())-pos.y)/static_cast<float>(juce::jmax(1,p.getHeight())));
                // The floor is a real zero, not merely -72 dB. This makes a wiped
                // harmonic genuinely absent from reconstruction.
                const float displayAmplitude=level<=0.002f
                    ? 0.0f
                    : juce::Decibels::decibelsToGain(-72.0f+72.0f*level);
                const float target=editMode_==EditMode::Additive
                    ? level
                    : fftMagnitudeForDisplayAmplitude(bin,displayAmplitude);
                if(lastEditedBin_>0 && lastEditedBin_!=bin) {
                    const int lo=juce::jmin(lastEditedBin_,bin),hi=juce::jmax(lastEditedBin_,bin);
                    const float start=editMode_==EditMode::Additive
                        ? additiveContributions_[static_cast<std::size_t>(lastEditedBin_)]
                        : editMagnitudes_[static_cast<std::size_t>(lastEditedBin_)];
                    for(int b=lo;b<=hi;++b) {
                        const float t=static_cast<float>(b-lastEditedBin_)/static_cast<float>(bin-lastEditedBin_);
                        const float value=juce::jmax(0.0f,start+t*(target-start));
                        if(editMode_==EditMode::Additive) additiveContributions_[static_cast<std::size_t>(b)]=juce::jlimit(0.0f,1.0f,value);
                        else if(editMode_==EditMode::Subtractive) {
                            auto& frame=document_.frames[document_.selectedFrame];
                            const auto index=static_cast<std::size_t>(b);
                            const float source=frame.subtractiveSourceMagnitudes[index];
                            const float desired=juce::jmin(source,value);
                            frame.subtractiveGains[index]=source>1.0e-9f
                                ? juce::jlimit(0.0f,1.0f,desired/source) : 0.0f;
                        }
                        else {
                            auto& frame=document_.frames[document_.selectedFrame];
                            const auto index=static_cast<std::size_t>(b);
                            editMagnitudes_[index]=value;
                            phases_[index]=independentDefaultPhase_;
                            frame.independentPhases[index]=independentDefaultPhase_;
                        }
                    }
                } else {
                    if(editMode_==EditMode::Additive) additiveContributions_[static_cast<std::size_t>(bin)]=juce::jlimit(0.0f,1.0f,target);
                    else if(editMode_==EditMode::Subtractive) {
                        auto& frame=document_.frames[document_.selectedFrame];
                        const auto index=static_cast<std::size_t>(bin);
                        const float source=frame.subtractiveSourceMagnitudes[index];
                        const float desired=juce::jmin(source,target);
                        frame.subtractiveGains[index]=source>1.0e-9f
                            ? juce::jlimit(0.0f,1.0f,desired/source) : 0.0f;
                    }
                    else {
                        auto& frame=document_.frames[document_.selectedFrame];
                        const auto index=static_cast<std::size_t>(bin);
                        editMagnitudes_[index]=target;
                        phases_[index]=independentDefaultPhase_;
                        frame.independentPhases[index]=independentDefaultPhase_;
                    }
                }
                if(editMode_==EditMode::Additive) rebuildAdditiveMagnitudes();
                else if(editMode_==EditMode::Subtractive) rebuildSubtractiveMagnitudes(document_.frames[document_.selectedFrame]);
                lastEditedBin_=bin; reconstructPreview(); hoveredBin_=bin; repaint();
            }
            void ensureSpectralStateInitialized(mct::origami::ui::WavetableFrame& frame) {
                if(frame.hasIndependentSpectrum && frame.hasSubtractiveSpectrum) return;
                analyseDocumentFrame();
                if(!frame.hasIndependentSpectrum) {
                    frame.independentMagnitudes=magnitudes_;
                    // INDEPENDENT exposes H1..H1023 as its complete authored domain.
                    // DC and Nyquist have no controls, so they must never survive as
                    // invisible coefficients inherited from the source waveform.
                    frame.independentMagnitudes[0]=0.0f;
                    frame.independentMagnitudes[kFftSize/2]=0.0f;
                    frame.independentPhases.fill(0.0f);
                    for(std::size_t bin=1;bin<kBins;++bin)
                        frame.independentPhases[bin]=independentDefaultPhase_;
                    frame.hasIndependentSpectrum=true;
                }
                if(!frame.hasSubtractiveSpectrum) {
                    frame.subtractiveSourceMagnitudes=magnitudes_;
                    frame.subtractiveSourcePhases=phases_;
                    frame.subtractiveGains.fill(1.0f);
                    frame.hasSubtractiveSpectrum=true;
                }
            }
            void ensureAdditiveStateInitialized(mct::origami::ui::WavetableFrame& frame) {
                if(frame.hasAdditiveSpectrum) return;
                frame.additiveContributions.fill(1.0f);
                frame.additiveContributions[0]=0.0f;
                frame.hasAdditiveSpectrum=true;
            }
            void setIndependentPhases() noexcept {
                phases_.fill(0.0f);
                for(std::size_t bin=1;bin<kBins;++bin)
                    phases_[bin]=independentDefaultPhase_;
            }
            void setAdditivePhases() noexcept {
                phases_.fill(0.0f);
                for(std::size_t bin=1;bin<kBins;++bin)
                    phases_[bin]=-juce::MathConstants<float>::halfPi;
            }
            void loadAuthoringOrAnalyse() {
                if(!document_.valid()) return;
                auto& frame=document_.frames[document_.selectedFrame];
                ensureSpectralStateInitialized(frame);
                if(editMode_==EditMode::Independent) {
                    magnitudes_=frame.independentMagnitudes;
                    setIndependentPhases();
                } else if(editMode_==EditMode::Additive) {
                    ensureAdditiveStateInitialized(frame);
                    additiveContributions_=frame.additiveContributions;
                    setAdditivePhases();
                    rebuildAdditiveMagnitudes();
                } else {
                    phases_=frame.subtractiveSourcePhases;
                    rebuildSubtractiveMagnitudes(frame);
                }
            }
            void storeAuthoringState(mct::origami::ui::WavetableFrame& frame) {
                if(editMode_==EditMode::Independent) {
                    frame.hasIndependentSpectrum=true;
                    frame.independentMagnitudes=magnitudes_;
                    frame.independentPhases.fill(0.0f);
                    for(std::size_t bin=1;bin<kBins;++bin)
                        frame.independentPhases[bin]=independentDefaultPhase_;
                } else if(editMode_==EditMode::Additive) {
                    frame.hasAdditiveSpectrum=true;
                    frame.additiveContributions=additiveContributions_;
                }
            }
            void rebuildSubtractiveMagnitudes(const mct::origami::ui::WavetableFrame& frame) {
                editMagnitudes_.fill(0.0f);
                for(std::size_t bin=0;bin<kBins;++bin)
                    editMagnitudes_[bin]=frame.subtractiveSourceMagnitudes[bin]
                        * juce::jlimit(0.0f,1.0f,frame.subtractiveGains[bin]);
                magnitudes_=editMagnitudes_;
            }
            void rebuildAdditiveMagnitudes() {
                editMagnitudes_.fill(0.0f);
                editMagnitudes_[0]=0.0f;
                for(std::size_t bin=1;bin<kBins;++bin) {
                    // Square Fourier profile: odd harmonics at 1/n, even harmonics absent.
                    const float amplitude=(bin%2==1)?additiveContributions_[bin]/static_cast<float>(bin):0.0f;
                    editMagnitudes_[bin]=fftMagnitudeForDisplayAmplitude(static_cast<int>(bin),amplitude);
                }
                magnitudes_=editMagnitudes_;
            }
            void analyseDocumentFrame() {
                magnitudes_.fill(0.0f); phases_.fill(0.0f); real_.fill(0.0f); imag_.fill(0.0f);
                if(!document_.valid()) return;
                const auto& samples=document_.frames[document_.selectedFrame].samples;
                for(std::size_t i=0;i<kFftSize;++i) real_[i]=samples[i];
                performFft(false);
                for(std::size_t bin=0;bin<kBins;++bin) {
                    const float magnitude=std::sqrt(real_[bin]*real_[bin]+imag_[bin]*imag_[bin]);
                    magnitudes_[bin]=magnitude; phases_[bin]=std::atan2(imag_[bin],real_[bin]);
                }
            }
            void reconstructPreview() {
                if(!document_.valid()) return;
                // Final boundary guard for INDEPENDENT: invisible DC/Nyquist bins
                // cannot influence the IFFT or the authored frame.
                if(editMode_==EditMode::Independent) {
                    editMagnitudes_[0]=0.0f;
                    editMagnitudes_[kFftSize/2]=0.0f;
                }
                real_.fill(0.0f); imag_.fill(0.0f);
                real_[0]=editMagnitudes_[0]*std::cos(phases_[0]); imag_[0]=0.0f;
                for(std::size_t bin=1;bin<kFftSize/2;++bin) {
                    const float magnitude=editMagnitudes_[bin],phase=phases_[bin];
                    const float re=magnitude*std::cos(phase),im=magnitude*std::sin(phase);
                    real_[bin]=re; imag_[bin]=im; real_[kFftSize-bin]=re; imag_[kFftSize-bin]=-im;
                }
                real_[kFftSize/2]=editMagnitudes_[kFftSize/2]*std::cos(phases_[kFftSize/2]); imag_[kFftSize/2]=0.0f;
                performFft(true);
                float peak=0.0f;
                for(std::size_t i=0;i<kFftSize;++i) peak=juce::jmax(peak,std::abs(real_[i]/static_cast<float>(kFftSize)));
                const float scale=peak>1.0f?1.0f/peak:1.0f;
                auto& frame=document_.frames[document_.selectedFrame];
                for(std::size_t i=0;i<kFftSize;++i) frame.samples[i]=(real_[i]/static_cast<float>(kFftSize))*scale;
                // INDEPENDENT keeps the user's harmonic coefficients authoritative:
                // output peak fitting must never push untouched bars down.
                magnitudes_=editMagnitudes_;
                if(editMode_==EditMode::Independent)
                    setIndependentPhases();
                if(editMode_!=EditMode::Subtractive)
                    storeAuthoringState(document_.frames[document_.selectedFrame]);
                if(onSamplesChanged) onSamplesChanged();
            }
            void performFft(bool inverse) noexcept {
                for(std::size_t i=1,j=0;i<kFftSize;++i) {
                    std::size_t bit=kFftSize>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit;
                    if(i<j) { std::swap(real_[i],real_[j]); std::swap(imag_[i],imag_[j]); }
                }
                constexpr float twoPi=6.28318530717958647692f;
                for(std::size_t length=2;length<=kFftSize;length<<=1) {
                    const float angle=(inverse?1.0f:-1.0f)*twoPi/static_cast<float>(length);
                    const float stepReal=std::cos(angle),stepImag=std::sin(angle);
                    for(std::size_t base=0;base<kFftSize;base+=length) {
                        float wr=1.0f,wi=0.0f; const std::size_t half=length>>1;
                        for(std::size_t j=0;j<half;++j) {
                            const std::size_t even=base+j,odd=even+half;
                            const float ore=real_[odd]*wr-imag_[odd]*wi, oim=real_[odd]*wi+imag_[odd]*wr;
                            const float ere=real_[even],eim=imag_[even];
                            real_[even]=ere+ore; imag_[even]=eim+oim; real_[odd]=ere-ore; imag_[odd]=eim-oim;
                            const float nr=wr*stepReal-wi*stepImag; wi=wr*stepImag+wi*stepReal; wr=nr;
                        }
                    }
                }
            }
            mct::origami::ui::WavetableDocument& document_;
            std::array<float,kFftSize> real_{},imag_{};
            std::array<float,kBins> magnitudes_{},phases_{},editMagnitudes_{},additiveContributions_{};
            std::array<float,kFftSize> editBefore_{};
            std::uint64_t editFrameId_=0;
            static constexpr float referenceFundamentalHz_=130.81278265f; // C3 display reference
            int zoom_=1,firstBin_=1,hoveredBin_=-1,selectedBin_=1,lastEditedBin_=-1; bool editing_=false;
            EditMode editMode_=EditMode::Independent;
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

        class SpectrumIconButton final : public juce::Button {
        public:
            enum class Icon { left,right,up,down,zoomOut,zoomIn };
            explicit SpectrumIconButton(Icon icon):juce::Button({}),icon_(icon) { setMouseCursor(juce::MouseCursor::PointingHandCursor); }
            void paintButton(juce::Graphics& g,bool over,bool downState) override {
                const auto b=getLocalBounds().toFloat().reduced(0.5f);
                g.setColour(downState?juce::Colour(0xff242424):(over?juce::Colour(0xff1b1b1b):juce::Colour(0xff0b0b0b)));
                g.fillRect(b); g.setColour(juce::Colour(0xff343434)); g.drawRect(b,1.0f);
                g.setColour(juce::Colours::white.withAlpha(isEnabled()?0.82f:0.28f));
                const float cx=b.getCentreX(),cy=b.getCentreY();
                if(icon_==Icon::zoomOut || icon_==Icon::zoomIn) {
                    g.drawLine(cx-4.0f,cy,cx+4.0f,cy,1.5f);
                    if(icon_==Icon::zoomIn) g.drawLine(cx,cy-4.0f,cx,cy+4.0f,1.5f);
                    return;
                }
                float dx=0.0f,dy=0.0f;
                if(icon_==Icon::left) dx=-1.0f; else if(icon_==Icon::right) dx=1.0f;
                else if(icon_==Icon::up) dy=-1.0f; else dy=1.0f;
                const float x0=cx-dx*4.0f,y0=cy-dy*4.0f,x1=cx+dx*4.0f,y1=cy+dy*4.0f;
                g.drawLine(x0,y0,x1,y1,1.5f);
                juce::Path head;
                if(dx!=0.0f) { head.startNewSubPath(x1-dx*3.0f,y1-3.0f); head.lineTo(x1,y1); head.lineTo(x1-dx*3.0f,y1+3.0f); }
                else { head.startNewSubPath(x1-3.0f,y1-dy*3.0f); head.lineTo(x1,y1); head.lineTo(x1+3.0f,y1-dy*3.0f); }
                g.strokePath(head,juce::PathStrokeType(1.5f,juce::PathStrokeType::curved,juce::PathStrokeType::rounded));
            }
        private: Icon icon_;
        };
        class SpectrumSeparator final : public juce::Component {
            void paint(juce::Graphics& g) override { g.setColour(juce::Colours::white.withAlpha(0.20f)); g.drawVerticalLine(getWidth()/2,3.0f,static_cast<float>(getHeight())-3.0f); }
        };
        class DisclosureButton final : public juce::TextButton {
        public:
            void setOpen(bool open) { if(open_!=open) { open_=open; repaint(); } }
            void paintButton(juce::Graphics& g,bool over,bool down) override {
                const auto b=getLocalBounds().toFloat().reduced(0.5f);
                g.setColour(down?juce::Colour(0xff252525):(over?juce::Colour(0xff202020):juce::Colour(0xff1c1c1c))); g.fillRect(b);
                g.setColour(juce::Colour(0xff383838)); g.drawRect(b,1.0f);
                g.setColour(juce::Colours::white.withAlpha(0.72f)); g.setFont(juce::Font(juce::FontOptions("Arial",9.5f,juce::Font::bold)));
                g.drawText(getButtonText(),getLocalBounds().reduced(8,0).withTrimmedRight(18),juce::Justification::centred,false);
                const float cx=static_cast<float>(getWidth())-10.0f,cy=static_cast<float>(getHeight())*0.5f; juce::Path p;
                if(open_) { p.startNewSubPath(cx-3.5f,cy-2.0f); p.lineTo(cx+3.5f,cy-2.0f); p.lineTo(cx,cy+2.5f); }
                else { p.startNewSubPath(cx-2.0f,cy-3.5f); p.lineTo(cx+2.5f,cy); p.lineTo(cx-2.0f,cy+3.5f); }
                p.closeSubPath(); g.fillPath(p);
            }
        private: bool open_=false;
        };

        class ToolsPanel final : public juce::Component {
        public:
            std::function<void(int,float,float,float)> onGenerate;
            std::function<void(int,float,float)> onTransform;
            std::function<void()> onContentHeightChanged;
            int preferredHeight() const noexcept { return calculateRequiredHeight(); }
            ToolsPanel(GridSettings& grid,WaveformCanvas& canvas):grid_(grid),canvas_(canvas) {
                setWantsKeyboardFocus(true);
                for(auto* b:std::array<DisclosureButton*,4>{{&drawHeader_,&gridHeader_,&generateHeader_,&transformHeader_}}) {
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
                drawHeader_.setOpen(drawOpen_); layoutSectionHeader(area,drawHeader_,"DRAW");
                setGroupVisible({&pencil_,&line_,&curve_,&select_},drawOpen_);
                if(drawOpen_) {
                    auto row=area.removeFromTop(26); pencil_.setBounds(row.removeFromLeft(row.getWidth()/2)); line_.setBounds(row);
                    area.removeFromTop(3); row=area.removeFromTop(26); curve_.setBounds(row.removeFromLeft(row.getWidth()/2)); select_.setBounds(row); area.removeFromTop(7);
                }

                gridHeader_.setOpen(gridOpen_); layoutSectionHeader(area,gridHeader_,"SNAP & GRID");
                setGroupVisible({&gridResolution_,&xSnap_,&yGrid_,&ySnap_,&zeroSnap_},gridOpen_);
                if(gridOpen_) {
                    layoutRow(area,xGridText_,gridResolution_); layoutRow(area,xSnapText_,xSnap_);
                    layoutRow(area,yGridText_,yGrid_); layoutRow(area,ySnapText_,ySnap_);
                    layoutRow(area,zeroText_,zeroSnap_); area.removeFromTop(5);
                }

                generateHeader_.setOpen(generateOpen_); layoutSectionHeader(area,generateHeader_,"GENERATE");
                setGroupVisible({&generatorType_,&cycles_,&phase_,&pulseWidth_,&apply_},generateOpen_);
                if(generateOpen_) {
                    layoutRow(area,typeText_,generatorType_); layoutRow(area,cyclesText_,cycles_);
                    layoutRow(area,phaseText_,phase_); layoutRow(area,widthText_,pulseWidth_);
                    apply_.setBounds(area.removeFromTop(26)); area.removeFromTop(7);
                }

                transformHeader_.setOpen(transformOpen_); layoutSectionHeader(area,transformHeader_,"TRANSFORM");
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
                g.setFont(juce::Font(juce::FontOptions("Arial",9.5f,juce::Font::bold)));
                g.setFont(juce::Font(juce::FontOptions("Arial",9.0f,juce::Font::plain)));
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
            static void styleSectionButton(DisclosureButton& b) {
                b.setColour(juce::TextButton::buttonColourId,juce::Colour(0xff1c1c1c));
                b.setColour(juce::TextButton::buttonOnColourId,juce::Colour(0xff1c1c1c));
                b.setColour(juce::TextButton::textColourOffId,juce::Colours::white.withAlpha(0.68f));
                b.setMouseCursor(juce::MouseCursor::PointingHandCursor);
            }
            static void setGroupVisible(std::initializer_list<juce::Component*> items,bool visible) {
                for(auto* c:items) c->setVisible(visible);
            }
            static void layoutSectionHeader(juce::Rectangle<int>& area,DisclosureButton& b,const juce::String& title) {
                b.setButtonText(title);
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
            DisclosureButton drawHeader_,gridHeader_,generateHeader_,transformHeader_;
            juce::TextButton pencil_{"PENCIL"},line_{"LINE"},curve_{"CURVE"},select_{"SELECT"},apply_{"APPLY"};
            juce::TextButton transformApply_{"APPLY"},invert_{"INVERT"},reverse_{"REVERSE"},zero_{"ZERO"},normalize_{"NORMALIZE"},smooth_{"SMOOTH"},fadeIn_{"FADE IN"},fadeOut_{"FADE OUT"},removeDc_{"REMOVE DC"};
            NativeChoiceBox gridResolution_,xSnap_,yGrid_,ySnap_,zeroSnap_,generatorType_;
            juce::TextEditor cycles_,phase_,pulseWidth_,gain_,offset_;
            bool drawOpen_=true,gridOpen_=true,generateOpen_=false,transformOpen_=true;
            int contentHeight_=0;
        };

        class CurveInspector final : public juce::Component {
        public:
            std::function<void()> onApply,onCancel;
            explicit CurveInspector(WaveformCanvas& canvas):canvas_(canvas) {
                for(auto* c:std::array<juce::Component*,11>{{&mode_,&selection_,&x_,&y_,&hardness_,&deletePoint_,&resetCurve_,&addHint_,&apply_,&cancel_,&title_}}) addAndMakeVisible(c);
                title_.setText("CURVE",juce::dontSendNotification); mode_.setText("INSPECTOR",juce::dontSendNotification);
                addHint_.setText("CLICK WAVEFORM TO ADD POINT",juce::dontSendNotification);
                for(auto* l:std::array<juce::Label*,4>{{&title_,&mode_,&selection_,&addHint_}}) {
                    l->setColour(juce::Label::textColourId,juce::Colours::white.withAlpha(l==&title_?0.82f:0.55f));
                    l->setFont(juce::Font(juce::FontOptions("Arial",l==&title_?11.0f:9.5f,l==&title_?juce::Font::bold:juce::Font::plain)));
                    l->setJustificationType(juce::Justification::centredLeft);
                }
                setupNumber(x_); setupNumber(y_); setupNumber(hardness_);
                for(auto* b:std::array<juce::TextButton*,4>{{&deletePoint_,&resetCurve_,&apply_,&cancel_}}) styleButton(*b);
                deletePoint_.setButtonText("DELETE POINT"); resetCurve_.setButtonText("RESET CURVE"); apply_.setButtonText("APPLY CURVE"); cancel_.setButtonText("CANCEL");
                deletePoint_.onClick=[this]{ canvas_.deleteSelectedCurvePoint(); refresh(); };
                resetCurve_.onClick=[this]{ canvas_.resetSelectedCurveSegment(); refresh(); };
                apply_.onClick=[this]{ if(onApply) onApply(); }; cancel_.onClick=[this]{ if(onCancel) onCancel(); };
                auto commit=[this]{ commitEditors(); }; x_.onReturnKey=commit; y_.onReturnKey=commit; hardness_.onReturnKey=commit;
                x_.onFocusLost=commit; y_.onFocusLost=commit; hardness_.onFocusLost=commit;
                refresh();
            }
            void refresh() {
                const int point=canvas_.selectedCurvePointIndex(),segment=canvas_.selectedCurveSegmentIndex();
                selection_.setText(point>=0 ? "POINT "+juce::String(point+1)+" / "+juce::String(canvas_.curvePointCount())
                                           : (segment>=0 ? "SEGMENT "+juce::String(segment+1) : "NO SELECTION"),juce::dontSendNotification);
                int sample=0; float value=0.0f,x=0.5f,y=0.0f,hardness=0.5f;
                const bool hasPoint=canvas_.selectedCurvePointValues(sample,value);
                const bool hasSegment=canvas_.selectedCurveSegmentValues(x,y,hardness);
                if(hasPoint) { x_.setText(juce::String(sample),false); y_.setText(juce::String(value,3),false); }
                else if(hasSegment) { x_.setText(juce::String(x*100.0f,1),false); y_.setText(juce::String(y,3),false); hardness_.setText(juce::String(hardness*100.0f,1),false); }
                x_.setEnabled(hasPoint||hasSegment); y_.setEnabled(hasPoint||hasSegment); hardness_.setEnabled(hasSegment);
                deletePoint_.setVisible(hasPoint); resetCurve_.setVisible(hasSegment);
                repaint();
            }
            void resized() override {
                auto a=getLocalBounds().reduced(7); mode_.setBounds(a.removeFromTop(18)); title_.setBounds(a.removeFromTop(22)); selection_.setBounds(a.removeFromTop(22)); a.removeFromTop(5);
                xLabel_=a.removeFromTop(14); x_.setBounds(a.removeFromTop(25)); a.removeFromTop(4);
                yLabel_=a.removeFromTop(14); y_.setBounds(a.removeFromTop(25)); a.removeFromTop(4);
                hardLabel_=a.removeFromTop(14); hardness_.setBounds(a.removeFromTop(25)); a.removeFromTop(6);
                if(deletePoint_.isVisible()) deletePoint_.setBounds(a.removeFromTop(25));
                if(resetCurve_.isVisible()) resetCurve_.setBounds(a.removeFromTop(25));
                a.removeFromTop(8); addHint_.setBounds(a.removeFromTop(20));
                auto bottom=getLocalBounds().reduced(7).removeFromBottom(58); apply_.setBounds(bottom.removeFromTop(26)); bottom.removeFromTop(4); cancel_.setBounds(bottom.removeFromTop(26));
            }
            void paint(juce::Graphics& g) override {
                g.fillAll(juce::Colour(0xff080808)); g.setColour(juce::Colours::white.withAlpha(0.42f)); g.setFont(juce::Font(juce::FontOptions("Arial",9.0f,juce::Font::bold)));
                const bool point=canvas_.selectedCurvePointIndex()>=0;
                g.drawText(point?"X SAMPLE":"CONTROL X %",xLabel_,juce::Justification::centredLeft,false);
                g.drawText(point?"Y VALUE":"CONTROL Y",yLabel_,juce::Justification::centredLeft,false);
                g.drawText("HARDNESS %",hardLabel_,juce::Justification::centredLeft,false);
            }
        private:
            static void setupNumber(juce::TextEditor& e) { e.setColour(juce::TextEditor::backgroundColourId,juce::Colour(0xff0d0d0d)); e.setColour(juce::TextEditor::textColourId,juce::Colours::white.withAlpha(0.86f)); e.setColour(juce::TextEditor::outlineColourId,juce::Colour(0xff353535)); e.setInputRestrictions(8,"-0123456789."); e.setJustification(juce::Justification::centredLeft); }
            static void styleButton(juce::TextButton& b) { b.setColour(juce::TextButton::buttonColourId,juce::Colour(0xff101010)); b.setColour(juce::TextButton::textColourOffId,juce::Colours::white.withAlpha(0.78f)); }
            void commitEditors() {
                if(canvas_.selectedCurvePointIndex()>=0) canvas_.setSelectedCurvePoint(x_.getText().getIntValue(),y_.getText().getFloatValue());
                else if(canvas_.selectedCurveSegmentIndex()>=0) canvas_.setSelectedCurveSegment(x_.getText().getFloatValue()/100.0f,y_.getText().getFloatValue(),hardness_.getText().getFloatValue()/100.0f);
                refresh();
            }
            WaveformCanvas& canvas_; juce::Label mode_,title_,selection_,addHint_; juce::TextEditor x_,y_,hardness_;
            juce::TextButton deletePoint_,resetCurve_,apply_,cancel_; juce::Rectangle<int> xLabel_,yLabel_,hardLabel_;
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
                    label->setFont(juce::Font(juce::FontOptions("Arial",10.0f,juce::Font::bold)));
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
              timeline_("FRAMES"),frameStrip_(document_),waveformCanvas_(document_,gridSettings_),spectrumCanvas_(document_),
              toolsPanel_(gridSettings_,waveformCanvas_),toolsScroller_(toolsPanel_),curveInspector_(waveformCanvas_) {
            setWantsKeyboardFocus(true);
            setFocusContainerType(juce::Component::FocusContainerType::keyboardFocusContainer);
            addAndMakeVisible(header_);
            header_.onClose=[this] { if(onClose) onClose(); };
            header_.onUndo=[this] { undo(); };
            header_.onRedo=[this] { redo(); };
            for(auto* region:std::array<EditorRegion*,4>{{&tools_,&waveform_,&spectrum_,&timeline_}})
                addAndMakeVisible(region);
            addAndMakeVisible(frameTools_);
            frameTools_.onCommand=[this](auto command) { runFrameCommand(command); };
            frameTools_.onSettingsChanged=[this] { updateFrameTools(); };
            frameStrip_.onAddRequested=[this] { runFrameCommand(mct::origami::ui::FrameTools::Command::Duplicate); };
            tools_.setContentComponent(toolsScroller_);
            timeline_.setContentComponent(frameStrip_);
            waveform_.setContentComponent(waveformCanvas_);
            spectrum_.setContentComponent(spectrumCanvas_);
            spectrumMode_.setButtonText("INDEPENDENT");
            spectrumMode_.setTooltip("Spectral editing mode");
            spectrum_.setHeaderAccessory(spectrumControls_,360);
            for(auto* b:std::array<juce::Button*,8>{{&spectrumPrev_,&spectrumNext_,&spectrumMagnitudeUp_,&spectrumMagnitudeDown_,&spectrumPanLeft_,&spectrumPanRight_,&spectrumZoomOut_,&spectrumZoomIn_}})
                spectrumControls_.addAndMakeVisible(*b);
            spectrumControls_.addAndMakeVisible(spectrumSeparator_);
            spectrumControls_.addAndMakeVisible(spectrumMode_);
            spectrumPrev_.setTooltip("Select previous harmonic"); spectrumNext_.setTooltip("Select next harmonic");
            spectrumMagnitudeUp_.setTooltip("Increase selected harmonic magnitude"); spectrumMagnitudeDown_.setTooltip("Decrease selected harmonic magnitude");
            spectrumPanLeft_.setTooltip("Pan spectrum left"); spectrumPanRight_.setTooltip("Pan spectrum right");
            spectrumZoomOut_.setTooltip("Zoom out"); spectrumZoomIn_.setTooltip("Zoom in");
            spectrumPrev_.onClick=[this]{ spectrumCanvas_.selectPreviousHarmonic(); };
            spectrumNext_.onClick=[this]{ spectrumCanvas_.selectNextHarmonic(); };
            spectrumMagnitudeUp_.onClick=[this]{ spectrumCanvas_.increaseSelectedMagnitude(); };
            spectrumMagnitudeDown_.onClick=[this]{ spectrumCanvas_.decreaseSelectedMagnitude(); };
            spectrumPanLeft_.onClick=[this]{ spectrumCanvas_.panLeft(); };
            spectrumPanRight_.onClick=[this]{ spectrumCanvas_.panRight(); };
            spectrumZoomOut_.onClick=[this]{ spectrumCanvas_.zoomOut(); };
            spectrumZoomIn_.onClick=[this]{ spectrumCanvas_.zoomIn(); };
            spectrumMode_.onClick=[this] {
                const std::vector<mct::origami::ui::NativeChoiceItem> items={
                    {1,"INDEPENDENT",true,"",spectrumCanvas_.editMode()==SpectrumCanvas::EditMode::Independent},
                    {2,"SUBTRACTIVE",true,"",spectrumCanvas_.editMode()==SpectrumCanvas::EditMode::Subtractive},
                    {3,"ADDITIVE",true,"",spectrumCanvas_.editMode()==SpectrumCanvas::EditMode::Additive}
                };
                const int selected=spectrumCanvas_.editMode()==SpectrumCanvas::EditMode::Independent?1:spectrumCanvas_.editMode()==SpectrumCanvas::EditMode::Subtractive?2:3;
                mct::origami::ui::showNativeChoiceMenu(spectrumMode_,"Spectral mode",items,selected,[this](int id) {
                    if(id<1 || id>3) return;
                    const auto mode=id==1?SpectrumCanvas::EditMode::Independent:id==2?SpectrumCanvas::EditMode::Subtractive:SpectrumCanvas::EditMode::Additive;
                    spectrumCanvas_.setEditMode(mode);
                    spectrumMode_.setButtonText(id==1?"INDEPENDENT":id==2?"SUBTRACTIVE":"ADDITIVE");
                });
            };
            frameStrip_.onFrameSelected=[this](unsigned) { waveformCanvas_.cancelPendingShape(); waveformCanvas_.clearSelection(); refreshSelectedFrame();updateFrameTools(); };
            waveformCanvas_.onSamplesChanged=[this] {
                invalidateSelectedTimeDomainSpectralState();
                frameStrip_.refreshSelectedThumbnail();
                spectrumCanvas_.refresh();
            };
            spectrumCanvas_.onSamplesChanged=[this] { waveformCanvas_.refresh(); frameStrip_.refreshSelectedThumbnail(); };
            spectrumCanvas_.onEditCommitted=[this](std::uint64_t id,const auto& before,const auto& after) { commitEdit(id,before,after); };
            waveformCanvas_.onSelectionChanged=[this](bool active) { toolsPanel_.setSelectionAvailable(active); };
            waveformCanvas_.onCurveDraftChanged=[this](bool active) {
                if(active) { tools_.setContentComponent(curveInspector_); curveInspector_.refresh(); }
                else tools_.setContentComponent(toolsScroller_);
            };
            waveformCanvas_.onCurveSelectionChanged=[this] { curveInspector_.refresh(); };
            curveInspector_.onApply=[this] {
                waveformCanvas_.applyCurveDraft();
                tools_.setContentComponent(toolsScroller_);
            };
            curveInspector_.onCancel=[this] {
                waveformCanvas_.cancelPendingShape();
                tools_.setContentComponent(toolsScroller_);
            };
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
            updateFrameTools();
        }
        void refreshSelectedFrame() {
            header_.setDocumentName(document_.name);
            header_.setFrameStatus(static_cast<unsigned>(document_.selectedFrame),
                                   static_cast<unsigned>(document_.frames.size()));
            waveformCanvas_.refresh();
            spectrumCanvas_.refresh();
        }
        void resized() override {
            auto area=getLocalBounds();
            header_.setBounds(area.removeFromTop(editorHeaderHeight));

            frameTools_.setBounds(area.removeFromBottom(frameToolsHeight));
            timeline_.setBounds(area.removeFromBottom(timelineHeight));

            const int toolsWidth=juce::roundToInt(static_cast<float>(area.getWidth())*.14f);
            const int spectrumWidth=juce::roundToInt(static_cast<float>(area.getWidth())*.30f);
            tools_.setBounds(area.removeFromLeft(toolsWidth));
            spectrum_.setBounds(area.removeFromRight(spectrumWidth));
            waveform_.setBounds(area);

            // spectrumControls_ is a plain JUCE Component, so its child layout
            // belongs to this editor's resized() pass rather than a callback.
            auto spectrumHeader=spectrumControls_.getLocalBounds();
            spectrumMode_.setBounds(spectrumHeader.removeFromRight(120));
            spectrumHeader.removeFromRight(4);
            const int spectrumControlWidth=24;
            for(auto* button:std::array<juce::Button*,4>{{&spectrumPrev_,&spectrumNext_,&spectrumMagnitudeUp_,&spectrumMagnitudeDown_}})
                button->setBounds(spectrumHeader.removeFromLeft(spectrumControlWidth).reduced(1,0));
            spectrumSeparator_.setBounds(spectrumHeader.removeFromLeft(9));
            for(auto* button:std::array<juce::Button*,4>{{&spectrumPanLeft_,&spectrumPanRight_,&spectrumZoomOut_,&spectrumZoomIn_}})
                button->setBounds(spectrumHeader.removeFromLeft(spectrumControlWidth).reduced(1,0));
        }
        void paint(juce::Graphics& g) override {
            g.fillAll(mct::origami::ui::Palette::background());
        }
        mct::origami::dsp::Wavetable compiledWavetable() const {
            mct::origami::dsp::Wavetable table;
            table.name=document_.name.toStdString();
            table.tableLength=mct::origami::ui::kWavetableFrameSize;
            table.frames.reserve(document_.frames.size());
            for(const auto& source:document_.frames) {
                mct::origami::dsp::WavetableFrame frame;
                mct::origami::dsp::WavetableBand band;
                band.maximumHarmonic=static_cast<unsigned>(mct::origami::ui::kWavetableFrameSize/2);
                band.samples.assign(source.samples.begin(),source.samples.end());
                frame.bands.push_back(std::move(band));
                table.frames.push_back(std::move(frame));
            }
            return table;
        }

        bool keyPressed(const juce::KeyPress& key) override {
            const auto mods=key.getModifiers();
            if(mods.isCommandDown() && key.getTextCharacter()=='a') { waveformCanvas_.selectAll(); return true; }
            if(mods.isCommandDown() && key.getTextCharacter()=='z') {
                if(mods.isShiftDown()) redo(); else undo();
                return true;
            }
            if(key==juce::KeyPress::returnKey && waveformCanvas_.hasCurveDraft()) {
                waveformCanvas_.applyCurveDraft(); return true;
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
        void updateFrameTools() {
            const auto selected=frameStrip_.selectedIndices();
            const auto count=document_.frames.size();
            const bool contiguous=selected.empty() || selected.back()-selected.front()+1==selected.size();
            const bool canMorph=frameTools_.mode()==mct::origami::ui::FrameTools::MorphMode::ToTarget
                ? count>=2 && static_cast<std::size_t>(frameTools_.count())>count
                : selected.size()==2 && selected[1]==selected[0]+1 && count+static_cast<std::size_t>(frameTools_.count())<=mct::origami::ui::kMaxWavetableFrames;
            frameTools_.setAvailability(clipboard_.has_value(),count<mct::origami::ui::kMaxWavetableFrames,
                selected.size()<count && !selected.empty(),
                contiguous && !selected.empty() && selected.front()>0,
                contiguous && !selected.empty() && selected.back()+1<count,canMorph);
        }
        bool structuralEdit(const std::function<bool(std::vector<unsigned>&)>& edit) {
            auto before=document_.frames;
            const auto nameBefore=document_.name;
            const auto selectedBefore=document_.selectedFrame;
            const auto selectionBefore=frameStrip_.selectedIndices();
            std::vector<unsigned> afterSelection;
            if(!edit(afterSelection)) return false;
            frameStrip_.rebuild();
            if(afterSelection.empty()) afterSelection.push_back(static_cast<unsigned>(document_.selectedFrame));
            frameStrip_.selectRange(afterSelection,static_cast<unsigned>(document_.selectedFrame));
            commitStructure(std::move(before),selectedBefore,selectionBefore,nameBefore);
            updateFrameTools();
            return true;
        }
        void runFrameCommand(mct::origami::ui::FrameTools::Command command) {
            using Command=mct::origami::ui::FrameTools::Command;
            using Document=mct::origami::ui::WavetableDocument;
            const auto selected=frameStrip_.selectedIndices();
            const auto count=document_.frames.size();
            if(selected.empty() || count==0) return;
            const auto primary=document_.selectedFrame;
            const bool space=count<mct::origami::ui::kMaxWavetableFrames;
            if(command==Command::Copy) {
                clipboard_=document_.frames[primary];updateFrameTools();return;
            }
            if(command==Command::Import) {beginFrameImport();return;}
            if(command==Command::Export) {beginFrameExport();return;}
            if(command==Command::Paste || command==Command::Duplicate || command==Command::Before || command==Command::After) {
                if(!space || (command==Command::Paste && !clipboard_))return;
                structuralEdit([&](std::vector<unsigned>&) {
                    mct::origami::ui::WavetableFrame frame;
                    if(command==Command::Paste)frame=*clipboard_;
                    else if(command==Command::Duplicate)frame=document_.frames[primary];
                    frame.id=Document::nextFrameId();
                    const auto index=primary+(command==Command::Before?0:1);
                    document_.frames.insert(document_.frames.begin()+static_cast<std::ptrdiff_t>(index),std::move(frame));
                    document_.selectedFrame=index;
                    return true;
                });
                return;
            }
            if(command==Command::Delete) {
                if(selected.size()>=count)return;
                structuralEdit([&](std::vector<unsigned>&) {
                    for(auto it=selected.rbegin();it!=selected.rend();++it)
                        document_.frames.erase(document_.frames.begin()+static_cast<std::ptrdiff_t>(*it));
                    document_.selectedFrame=std::min<std::size_t>(selected.front(),document_.frames.size()-1);
                    return true;
                });return;
            }
            if(command==Command::Left || command==Command::Right) {
                if(selected.back()-selected.front()+1!=selected.size())return;
                const auto first=selected.front(),last=selected.back();
                if((command==Command::Left && first==0) || (command==Command::Right && last+1>=count))return;
                structuralEdit([&](std::vector<unsigned>& after) {
                    auto& frames=document_.frames;
                    if(command==Command::Left)
                        std::rotate(frames.begin()+first-1,frames.begin()+first,frames.begin()+last+1);
                    else std::rotate(frames.begin()+first,frames.begin()+last+1,frames.begin()+last+2);
                    const int delta=command==Command::Left?-1:1;
                    document_.selectedFrame=static_cast<std::size_t>(static_cast<int>(primary)+delta);
                    for(auto index:selected)after.push_back(static_cast<unsigned>(static_cast<int>(index)+delta));
                    return true;
                });return;
            }
            if(command==Command::Morph) {
                const auto method=frameTools_.method();
                const auto curve=frameTools_.curve();
                if(frameTools_.mode()==mct::origami::ui::FrameTools::MorphMode::ToTarget) {
                    const auto target=static_cast<std::size_t>(frameTools_.count());
                    if(target<=count || target>mct::origami::ui::kMaxWavetableFrames)return;
                    structuralEdit([&](std::vector<unsigned>&) {
                        return mct::origami::ui::densify(document_,target,method,curve);
                    });
                } else {
                    if(selected.size()!=2 || selected[1]!=selected[0]+1)return;
                    structuralEdit([&](std::vector<unsigned>&) {
                        return mct::origami::ui::morphBetween(document_,selected[0],selected[1],
                            static_cast<std::size_t>(frameTools_.count()),method,curve);
                    });
                }
                return;
            }
            if(command==Command::Phase || command==Command::Zero) {
                structuralEdit([&](std::vector<unsigned>& after) {
                    after=selected;
                    if(command==Command::Phase)
                        return mct::origami::ui::alignPhaseSelection(document_,selected);
                    bool changed=false;
                    for(auto index:selected) {
                        auto& frame=document_.frames[index];
                        const auto before=frame.samples;
                        mct::origami::ui::alignZero(frame);
                        changed|=frame.samples!=before;
                    }
                    return changed;
                });return;
            }
            int operation=0;
            if(command==Command::Normalize)operation=1;
            else if(command==Command::Reverse)operation=2;
            else if(command==Command::Invert)operation=3;
            else if(command==Command::Smooth)operation=4;
            if(operation==0)return;
            auto targets=selected;
            if(frameTools_.scope()==1)targets={static_cast<unsigned>(primary)};
            if(frameTools_.scope()==3) {targets.clear();for(unsigned i=0;i<count;++i)targets.push_back(i);}
            std::size_t first=0,last=mct::origami::ui::kWavetableFrameSize-1;
            if(frameTools_.portion()==2) {
                const auto& waveformSelection=waveformCanvas_.selection();
                if(!waveformSelection.active || waveformSelection.frameId!=document_.frames[primary].id)return;
                first=waveformSelection.start;last=waveformSelection.end;
            }
            structuralEdit([&](std::vector<unsigned>& after) {
                after=selected;
                bool changed=false;
                for(auto index:targets) {
                    const auto before=document_.frames[index].samples;
                    mct::origami::ui::processFrame(document_.frames[index],operation,first,last);
                    changed|=document_.frames[index].samples!=before;
                }
                return changed;
            });
        }
        void beginFrameImport() {
            frameFileChooser_=std::make_unique<juce::FileChooser>("Import Wavetable",juce::File{},"*.wav;*.aif;*.aiff");
            auto safe=juce::Component::SafePointer<WavetableEditorSurface>(this);
            frameFileChooser_->launchAsync(juce::FileBrowserComponent::openMode|juce::FileBrowserComponent::canSelectFiles,
                [safe](const juce::FileChooser& chooser) {
                    if(safe==nullptr)return;
                    const auto file=chooser.getResult();
                    if(file.existsAsFile())safe->finishFrameImport(file);
                    safe->frameFileChooser_.reset();
                });
        }
        void finishFrameImport(const juce::File& file) {
            juce::AudioFormatManager formats;formats.registerBasicFormats();
            std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(file));
            if(!reader) {frameTools_.setStatus("Import failed: unreadable audio file");return;}
            const auto total=reader->lengthInSamples;
            if(total<static_cast<juce::int64>(mct::origami::ui::kWavetableFrameSize) ||
               total%static_cast<juce::int64>(mct::origami::ui::kWavetableFrameSize)!=0 ||
               total>static_cast<juce::int64>(mct::origami::ui::kWavetableFrameSize*mct::origami::ui::kMaxWavetableFrames)) {
                frameTools_.setStatus("Import requires 1–256 contiguous 2048-sample frames");return;
            }
            juce::AudioBuffer<float> source(juce::jmax(1,static_cast<int>(reader->numChannels)),static_cast<int>(total));
            if(!reader->read(&source,0,static_cast<int>(total),0,true,true)) {
                frameTools_.setStatus("Import failed: audio could not be read");return;
            }
            std::vector<mct::origami::ui::WavetableFrame> frames;
            frames.resize(static_cast<std::size_t>(total)/mct::origami::ui::kWavetableFrameSize);
            float peak=0.0f;
            for(std::size_t frameIndex=0;frameIndex<frames.size();++frameIndex) {
                auto& frame=frames[frameIndex];frame.id=mct::origami::ui::WavetableDocument::nextFrameId();
                for(std::size_t i=0;i<frame.samples.size();++i) {
                    double sum=0.0;
                    const auto sampleIndex=static_cast<int>(frameIndex*frame.samples.size()+i);
                    for(int channel=0;channel<source.getNumChannels();++channel)
                        sum+=source.getSample(channel,sampleIndex);
                    const auto value=static_cast<float>(sum/source.getNumChannels());
                    if(!std::isfinite(value)) {frameTools_.setStatus("Import failed: non-finite audio");return;}
                    frame.samples[i]=value;peak=std::max(peak,std::abs(value));
                }
            }
            if(peak<=1.0e-8f) {frameTools_.setStatus("Import failed: empty signal");return;}
            if(peak>1.0f)for(auto& frame:frames)for(auto& value:frame.samples)value/=peak;
            structuralEdit([&](std::vector<unsigned>&) {
                document_.frames=std::move(frames);document_.selectedFrame=0;
                document_.name=file.getFileNameWithoutExtension().toUpperCase();
                return true;
            });
            frameTools_.setStatus("Imported "+file.getFileName());
        }
        void beginFrameExport() {
            frameFileChooser_=std::make_unique<juce::FileChooser>("Export Wavetable",
                juce::File::getSpecialLocation(juce::File::userDocumentsDirectory)
                    .getChildFile(document_.name+".wav"),"*.wav");
            auto safe=juce::Component::SafePointer<WavetableEditorSurface>(this);
            frameFileChooser_->launchAsync(juce::FileBrowserComponent::saveMode|juce::FileBrowserComponent::canSelectFiles|
                                           juce::FileBrowserComponent::warnAboutOverwriting,
                [safe](const juce::FileChooser& chooser) {
                    if(safe==nullptr)return;
                    const auto file=chooser.getResult();
                    if(file!=juce::File{})safe->finishFrameExport(file.withFileExtension(".wav"));
                    safe->frameFileChooser_.reset();
                });
        }
        void finishFrameExport(const juce::File& file) {
            const auto sampleCount=static_cast<int>(document_.frames.size()*mct::origami::ui::kWavetableFrameSize);
            juce::AudioBuffer<float> buffer(1,sampleCount);
            for(std::size_t frameIndex=0;frameIndex<document_.frames.size();++frameIndex)
                for(std::size_t i=0;i<mct::origami::ui::kWavetableFrameSize;++i)
                    buffer.setSample(0,static_cast<int>(frameIndex*mct::origami::ui::kWavetableFrameSize+i),
                                     document_.frames[frameIndex].samples[i]);
            std::unique_ptr<juce::OutputStream> stream=file.createOutputStream();
            if(!stream) {frameTools_.setStatus("Export failed: cannot write file");return;}
            juce::WavAudioFormat format;
            const auto options=juce::AudioFormatWriterOptions{}.withSampleRate(44100.0).withNumChannels(1).withBitsPerSample(16);
            auto writer=format.createWriterFor(stream,options);
            if(!writer) {frameTools_.setStatus("Export failed: cannot create WAV writer");return;}
            if(!writer->writeFromAudioSampleBuffer(buffer,0,sampleCount))
                frameTools_.setStatus("Export failed: WAV write error");
            else frameTools_.setStatus("Exported "+file.getFileName());
        }
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
            invalidateTimeDomainSpectralState(frame);
            commitEdit(frame.id,before,after);
            waveformCanvas_.refresh(); spectrumCanvas_.refresh(); frameStrip_.refreshSelectedThumbnail();
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
            invalidateTimeDomainSpectralState(frame);
            commitEdit(frame.id,before,after);
            waveformCanvas_.refresh();
            spectrumCanvas_.refresh();
            frameStrip_.refreshSelectedThumbnail();
        }
        void invalidateTimeDomainSpectralState(mct::origami::ui::WavetableFrame& frame) {
            // Time-domain edits create a new spectral source. Independent and
            // subtractive state must be rebuilt from those samples on next refresh.
            // Additive is intentionally independent and is not touched here.
            frame.hasIndependentSpectrum=false;
            frame.hasSubtractiveSpectrum=false;
            frame.subtractiveGains.fill(1.0f);
        }
        void invalidateSelectedTimeDomainSpectralState() {
            if(document_.valid())
                invalidateTimeDomainSpectralState(document_.frames[document_.selectedFrame]);
        }
        void commitEdit(std::uint64_t id,
                        const std::array<float,mct::origami::ui::kWavetableFrameSize>& before,
                        const std::array<float,mct::origami::ui::kWavetableFrameSize>& after) {
            if(before==after) return;
            if(historyIndex_<history_.size())
                history_.erase(history_.begin()+static_cast<std::ptrdiff_t>(historyIndex_),history_.end());
            history_.push_back({id,before,after,{}});
            if(history_.size()>128) history_.erase(history_.begin());
            historyIndex_=history_.size();
            refreshHistoryButtons();
        }
        void commitStructure(std::vector<mct::origami::ui::WavetableFrame> before,
                             std::size_t selectedBefore,std::vector<unsigned> selectionBefore,
                             juce::String nameBefore) {
            if(historyIndex_<history_.size())
                history_.erase(history_.begin()+static_cast<std::ptrdiff_t>(historyIndex_),history_.end());
            HistoryEntry entry;
            entry.structure=std::make_shared<StructuralHistory>();
            entry.structure->before=std::move(before);
            entry.structure->after=document_.frames;
            entry.structure->selectedBefore=selectedBefore;
            entry.structure->selectedAfter=document_.selectedFrame;
            entry.structure->selectionBefore=std::move(selectionBefore);
            entry.structure->selectionAfter=frameStrip_.selectedIndices();
            entry.structure->nameBefore=std::move(nameBefore);
            entry.structure->nameAfter=document_.name;
            history_.push_back(std::move(entry));
            while(history_.size()>1 && (history_.size()>128 || historyBytes()>96*1024*1024)) {
                history_.erase(history_.begin());
            }
            historyIndex_=history_.size();
            refreshHistoryButtons();
        }
        std::size_t historyBytes() const {
            std::size_t bytes=0;
            for(const auto& item:history_) {
                bytes+=sizeof(item);
                if(item.structure) bytes+=(item.structure->before.size()+item.structure->after.size())
                    *sizeof(mct::origami::ui::WavetableFrame);
            }
            return bytes;
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
        struct StructuralHistory {
            std::vector<mct::origami::ui::WavetableFrame> before,after;
            std::size_t selectedBefore=0,selectedAfter=0;
            std::vector<unsigned> selectionBefore,selectionAfter;
            juce::String nameBefore,nameAfter;
        };
        struct HistoryEntry {
            std::uint64_t frameId=0;
            std::array<float,mct::origami::ui::kWavetableFrameSize> before{},after{};
            std::shared_ptr<StructuralHistory> structure;
        };
        void applyHistory(const HistoryEntry& entry,bool useAfter) {
            if(entry.structure) {
                const auto& snapshot=*entry.structure;
                document_.frames=useAfter?snapshot.after:snapshot.before;
                document_.selectedFrame=useAfter?snapshot.selectedAfter:snapshot.selectedBefore;
                document_.name=useAfter?snapshot.nameAfter:snapshot.nameBefore;
                frameStrip_.rebuild();
                frameStrip_.selectRange(useAfter?snapshot.selectionAfter:snapshot.selectionBefore,
                                        static_cast<unsigned>(document_.selectedFrame));
                refreshSelectedFrame();
                updateFrameTools();
                refreshHistoryButtons();
                return;
            }
            for(std::size_t i=0;i<document_.frames.size();++i) {
                if(document_.frames[i].id!=entry.frameId) continue;
                document_.frames[i].samples=useAfter ? entry.after : entry.before;
                invalidateTimeDomainSpectralState(document_.frames[i]);
                if(document_.selectedFrame==i) { waveformCanvas_.refresh(); spectrumCanvas_.refresh(); }
                frameStrip_.refreshThumbnail(static_cast<unsigned>(i));
                break;
            }
            refreshHistoryButtons();
        }
        void refreshHistoryButtons() { header_.setHistoryAvailable(historyIndex_>0,historyIndex_<history_.size()); }
        mct::origami::ui::WavetableDocument document_;
        GridSettings gridSettings_;
        EditorHeader header_;
        EditorRegion tools_,waveform_,spectrum_,timeline_;
        mct::origami::ui::FrameTools frameTools_;
        FrameStrip frameStrip_;
        WaveformCanvas waveformCanvas_;
        SpectrumCanvas spectrumCanvas_;
        juce::Component spectrumControls_;
        juce::TextButton spectrumMode_;
        SpectrumIconButton spectrumPrev_{SpectrumIconButton::Icon::left};
        SpectrumIconButton spectrumNext_{SpectrumIconButton::Icon::right};
        SpectrumIconButton spectrumMagnitudeUp_{SpectrumIconButton::Icon::up};
        SpectrumIconButton spectrumMagnitudeDown_{SpectrumIconButton::Icon::down};
        SpectrumSeparator spectrumSeparator_;
        SpectrumIconButton spectrumPanLeft_{SpectrumIconButton::Icon::left};
        SpectrumIconButton spectrumPanRight_{SpectrumIconButton::Icon::right};
        SpectrumIconButton spectrumZoomOut_{SpectrumIconButton::Icon::zoomOut};
        SpectrumIconButton spectrumZoomIn_{SpectrumIconButton::Icon::zoomIn};
        ToolsPanel toolsPanel_;
        ToolsScroller toolsScroller_;
        CurveInspector curveInspector_;
        std::vector<HistoryEntry> history_;
        std::optional<mct::origami::ui::WavetableFrame> clipboard_;
        std::unique_ptr<juce::FileChooser> frameFileChooser_;
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
    bool fxSelected_=false;
    int currentPage_=0;
    ModulationDragContext modulationDrag_;
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
    mct::origami::ui::FxPage fxPage_;
    mct::origami::ui::FxModalOverlay globalOverlay_;
    std::unique_ptr<mct::origami::ui::FxGlobalFxEditor> globalFx_;
    // Tooltips intentionally disabled. Origami now relies on direct labels,
    // native context menus and explicit controls instead of stale hover copy.
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(OrigamiAudioProcessorEditor)
};
