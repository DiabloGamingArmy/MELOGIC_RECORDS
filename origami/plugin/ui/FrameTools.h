#pragma once
#include "WavetableFrameOps.h"
#include <JuceHeader.h>
#include <array>
#include <functional>

namespace mct::origami::ui {
class FrameTools final : public juce::Component {
public:
    enum class Command { Copy,Paste,Duplicate,Delete,Before,After,Left,Right,Morph,Phase,Zero,
                         Normalize,Reverse,Invert,Smooth,Import,Export };
    enum class MorphMode { Between=1,ToTarget=2 };
    std::function<void(Command)> onCommand;
    std::function<void()> onSettingsChanged;
    FrameTools() {
        const std::array<Button*,17> buttons{{&copy_,&paste_,&duplicate_,&delete_,&before_,&after_,
            &left_,&right_,&morph_,&phase_,&zero_,&normalize_,&reverse_,&invert_,&smooth_,&import_,&export_}};
        for(auto* button:buttons) {
            addAndMakeVisible(*button);
            button->onClick=[this,button]{if(onCommand)onCommand(button->command());};
        }
        for(auto* box:std::array<juce::ComboBox*,6>{{&mode_,&countBox_,&method_,&curve_,&scope_,&portion_}}) {
            addAndMakeVisible(*box);
            box->setLookAndFeel(&lookAndFeel_);
            box->setColour(juce::ComboBox::backgroundColourId,juce::Colour(0xff171717));
            box->setColour(juce::ComboBox::outlineColourId,juce::Colour(0xff383838));
            box->setColour(juce::ComboBox::textColourId,juce::Colours::white.withAlpha(.85f));
            box->setColour(juce::ComboBox::arrowColourId,juce::Colours::white.withAlpha(.7f));
            box->setJustificationType(juce::Justification::centredLeft);
        }
        mode_.addItem("BETWEEN",1);mode_.addItem("TO TARGET",2);mode_.setSelectedId(2,juce::dontSendNotification);
        method_.addItem("CROSSFADE",1);method_.addItem("PHASE-ALIGNED",2);
        method_.addItem("SPECTRAL",3);method_.addItem("HARMONIC",4);
        method_.addItem("HARMONIC SHIFT",5);method_.addItem("HYBRID",6);
        method_.setSelectedId(1,juce::dontSendNotification);
        curve_.addItem("LINEAR",1);curve_.addItem("EASE IN",2);curve_.addItem("EASE OUT",3);
        curve_.addItem("S-CURVE",4);curve_.setSelectedId(1,juce::dontSendNotification);
        scope_.addItem("SINGLE",1);scope_.addItem("SELECTED",2);scope_.addItem("ALL",3);
        scope_.setSelectedId(1,juce::dontSendNotification);
        portion_.addItem("ALL",1);portion_.addItem("SELECTION",2);
        portion_.setSelectedId(1,juce::dontSendNotification);
        countBox_.setEditableText(true);
        configureCountChoices();
        countBox_.onChange=[this] {
            const auto value=countBox_.getSelectedId()>0?countBox_.getSelectedId():countBox_.getText().getIntValue();
            count_=juce::jlimit(1,256,value);
            syncCountBox();changed();
        };
        mode_.onChange=[this]{
            count_=mode()==MorphMode::ToTarget?256:8;
            configureCountChoices();repaint();changed();
        };
        method_.onChange=[this]{updateMethodTooltip();changed();};curve_.onChange=[this]{changed();};
        scope_.onChange=[this]{changed();};portion_.onChange=[this]{changed();};
        addAndMakeVisible(up_);addAndMakeVisible(down_);
        up_.onClick=[this]{count_=juce::jmin(256,count_+1);syncCountBox();changed();};
        down_.onClick=[this]{count_=juce::jmax(1,count_-1);syncCountBox();changed();};
        morph_.setTooltip("Generate intermediate wavetable frames");
        phase_.setTooltip("Align selected frame phase to one fixed reference");
        zero_.setTooltip("Align to the nearest positive-going zero crossing");
        countBox_.setTooltip("Final wavetable frame count; type a value or choose a preset");
        mode_.setTooltip("Generate between selected frames or densify the whole table");
        curve_.setTooltip("Interpolation progression between source frames");
        updateMethodTooltip();
        setOpaque(true);
    }
    ~FrameTools() override {
        for(auto* box:std::array<juce::ComboBox*,6>{{&mode_,&countBox_,&method_,&curve_,&scope_,&portion_}})
            box->setLookAndFeel(nullptr);
    }
    MorphMode mode() const noexcept {return static_cast<MorphMode>(mode_.getSelectedId());}
    MorphMethod method() const noexcept {return static_cast<MorphMethod>(method_.getSelectedId());}
    MorphCurve curve() const noexcept {return static_cast<MorphCurve>(curve_.getSelectedId());}
    int count() const noexcept {return count_;}
    int scope() const noexcept {return scope_.getSelectedId();}
    int portion() const noexcept {return portion_.getSelectedId();}
    void setStatus(const juce::String& status) {import_.setTooltip(status);export_.setTooltip(status);}
    void setAvailability(bool hasClipboard,bool canAdd,bool canDelete,bool canLeft,bool canRight,bool canMorph) {
        delete_.setEnabled(canDelete);
        paste_.setEnabled(hasClipboard && canAdd);duplicate_.setEnabled(canAdd);
        before_.setEnabled(canAdd);after_.setEnabled(canAdd);
        left_.setEnabled(canLeft);right_.setEnabled(canRight);morph_.setEnabled(canMorph);
        paste_.setTooltip(!hasClipboard?"Copy a frame before pasting":!canAdd?"256-frame limit reached":"Insert a copy of the clipboard frame");
        delete_.setTooltip(canDelete?"Delete selected frames":"At least one frame must remain");
        left_.setTooltip(canLeft?"Move selected frame or range left":"Selection is already at the left edge");
        right_.setTooltip(canRight?"Move selected frame or range right":"Selection is already at the right edge");
        morph_.setTooltip(canMorph?"Generate intermediate wavetable frames":
            mode()==MorphMode::Between?"Select two adjacent source frames and leave room for the requested steps":
            "Choose a target count larger than the current frame count");
    }
    void paint(juce::Graphics& g) override {
        g.fillAll(juce::Colour(0xff0c0c0c));
        g.setColour(juce::Colour(0xff383838));
        g.drawHorizontalLine(0,0.0f,static_cast<float>(getWidth()));
        g.drawHorizontalLine(getHeight()-1,0.0f,static_cast<float>(getWidth()));
        const auto widths=groupWidths();int x=0;
        const std::array<const char*,7> titles{{"EDIT","INSERT","MOVE","MORPH","ALIGN","PROCESS","IMPORT / EXPORT"}};
        g.setFont(juce::Font(juce::FontOptions("Arial",9.0f,juce::Font::bold)));
        for(std::size_t group=0;group<widths.size();++group) {
            if(group>0) {
                g.setColour(juce::Colour(0xff424242));
                g.drawVerticalLine(x,8.0f,static_cast<float>(getHeight()-8));
            }
            g.setColour(juce::Colours::white.withAlpha(.82f));
            g.drawText(titles[group],x+9,5,widths[group]-12,12,juce::Justification::centredLeft,false);
            x+=widths[group];
        }
        const auto morphX=widths[0]+widths[1]+widths[2];
        const auto morphWidth=widths[3];
        const auto sx=[&](int offset){return morphX+juce::roundToInt(offset*static_cast<float>(morphWidth)/375.0f);};
        g.setFont(juce::Font(juce::FontOptions("Arial",8.5f,juce::Font::bold)));
        g.setColour(juce::Colours::white.withAlpha(.8f));
        g.drawText(mode()==MorphMode::Between?"STEPS":"TARGET",sx(134),67,sx(205)-sx(134),11,juce::Justification::centred,false);
        g.drawText("MODE",sx(60),67,sx(130)-sx(60),11,juce::Justification::centred,false);
        g.drawText("METHOD",sx(209),67,sx(291)-sx(209),11,juce::Justification::centred,false);
        g.drawText("CURVE",sx(295),67,sx(370)-sx(295),11,juce::Justification::centred,false);
    }
    void resized() override {
        const auto widths=groupWidths();int x=0;
        auto vertical=[&](Button& button,int left,int width) {button.setBounds(left,21,width,63);};
        auto distribute=[&](std::initializer_list<Button*> buttons,int groupWidth) {
            const auto cell=(groupWidth-13)/static_cast<int>(buttons.size());int pos=x+7;
            for(auto* button:buttons){vertical(*button,pos,cell-2);pos+=cell;}
        };
        distribute({&copy_,&paste_,&duplicate_,&delete_},widths[0]);x+=widths[0];
        distribute({&before_,&after_},widths[1]);x+=widths[1];
        distribute({&left_,&right_},widths[2]);x+=widths[2];
        const int mx=x,mw=widths[3];
        const auto sx=[&](int offset){return mx+juce::roundToInt(offset*static_cast<float>(mw)/375.0f);};
        vertical(morph_,sx(6),sx(55)-sx(6));
        mode_.setBounds(sx(60),27,sx(130)-sx(60),28);
        countBox_.setBounds(sx(134),27,sx(187)-sx(134),28);
        up_.setBounds(sx(190),21,sx(205)-sx(190),17);
        down_.setBounds(sx(190),39,sx(205)-sx(190),17);
        method_.setBounds(sx(209),27,sx(291)-sx(209),28);
        curve_.setBounds(sx(295),27,sx(370)-sx(295),28);
        x+=mw;
        distribute({&phase_,&zero_},widths[4]);x+=widths[4];
        const int processWidth=widths[5];
        scope_.setBounds(x+8,21,processWidth/2-14,25);
        portion_.setBounds(x+processWidth/2+2,21,processWidth/2-10,25);
        const int processCell=(processWidth-16)/4;
        int px=x+8;
        for(auto* button:{&normalize_,&reverse_,&invert_,&smooth_}) {
            button->setBounds(px,52,processCell-3,32);px+=processCell;
        }
        x+=processWidth;
        distribute({&import_,&export_},widths[6]);
    }
private:
    class Button final : public juce::Button {
    public:
        Button(Command command,const char* label,bool horizontal=false)
            :juce::Button({}),command_(command),label_(label),horizontal_(horizontal) {
            setMouseCursor(juce::MouseCursor::PointingHandCursor);
        }
        Command command() const noexcept{return command_;}
        void paintButton(juce::Graphics& g,bool over,bool down) override {
            auto b=getLocalBounds().toFloat();
            const auto outer=b;
            const float alpha=isEnabled()?1.0f:.52f;
            const auto icon=horizontal_ ? b.removeFromLeft(21.0f) : b.removeFromTop(b.getHeight()-16.0f);
            g.setColour(juce::Colour(down?0xff292929:over?0xff222222:0xff1a1a1a));
            const auto background=horizontal_?outer:icon;
            g.fillRect(background);
            g.setColour(juce::Colour(0xff353535));g.drawRect(background.reduced(.5f),1.0f);
            g.setColour(juce::Colours::white.withAlpha(.88f*alpha));
            const float cx=icon.getCentreX(),cy=icon.getCentreY();
            auto line=[&](float x1,float y1,float x2,float y2){g.drawLine(cx+x1,cy+y1,cx+x2,cy+y2,1.6f);};
            juce::Path path;
            switch(command_) {
                case Command::Copy:case Command::Paste:
                    g.drawRect(cx-7,cy-8,14.0f,17.0f,1.3f);
                    g.drawRect(cx-4,cy-10,8.0f,4.0f,1.3f);
                    for(int i=0;i<3;++i)line(-4,-3+i*4,4,-3+i*4);
                    break;
                case Command::Duplicate:
                    g.drawRect(cx-8,cy-6,11.0f,13.0f,1.4f);g.drawRect(cx-3,cy-9,11.0f,13.0f,1.4f);break;
                case Command::Delete:
                    g.drawRect(cx-6,cy-5,12.0f,14.0f,1.5f);line(-8,-7,8,-7);line(-3,-10,3,-10);
                    line(-2,-2,-2,6);line(2,-2,2,6);break;
                case Command::Before:
                    line(-9,-9,-9,9);line(6,-7,-2,0);line(-2,0,6,7);break;
                case Command::After:
                    line(9,-9,9,9);line(-6,-7,2,0);line(2,0,-6,7);break;
                case Command::Left:case Command::Right: {
                    const float sign=command_==Command::Left?1.0f:-1.0f;
                    line(sign*6,-8,-sign*3,0);line(-sign*3,0,sign*6,8);break;
                }
                case Command::Morph:
                    path.startNewSubPath(cx-9,cy-7);path.cubicTo(cx-2,cy-7,cx+2,cy+7,cx+9,cy+7);
                    path.startNewSubPath(cx-9,cy+7);path.cubicTo(cx-2,cy+7,cx+2,cy-7,cx+9,cy-7);
                    g.strokePath(path,juce::PathStrokeType(1.6f));break;
                case Command::Phase:
                    path.startNewSubPath(cx-10,cy+3);path.cubicTo(cx-5,cy-8,cx-1,cy-8,cx+3,cy+3);
                    path.cubicTo(cx+6,cy+9,cx+9,cy+6,cx+10,cy+1);
                    g.strokePath(path,juce::PathStrokeType(1.7f));
                    line(-1,-10,-1,10);break;
                case Command::Zero:
                    g.drawEllipse(cx-8,cy-8,16.0f,16.0f,1.6f);
                    line(-6,6,6,-6);break;
                case Command::Normalize:
                    path.startNewSubPath(cx-8,cy);path.cubicTo(cx-3,cy-8,cx+3,cy+8,cx+8,cy);
                    g.strokePath(path,juce::PathStrokeType(1.5f));break;
                case Command::Reverse:
                    line(-8,0,8,0);line(-8,0,-4,-4);line(-8,0,-4,4);
                    line(8,0,4,-4);line(8,0,4,4);break;
                case Command::Invert:
                    line(0,-8,0,8);line(0,-8,-4,-4);line(0,-8,4,-4);
                    line(0,8,-4,4);line(0,8,4,4);break;
                case Command::Smooth:
                    path.startNewSubPath(cx-8,cy+3);path.cubicTo(cx-5,cy-8,cx-1,cy-8,cx+2,cy);
                    path.cubicTo(cx+5,cy+7,cx+8,cy+5,cx+9,cy-2);
                    g.strokePath(path,juce::PathStrokeType(1.5f));break;
                case Command::Import:case Command::Export: {
                    const float sign=command_==Command::Import?1.0f:-1.0f;
                    line(0,-sign*6,0,sign*8);line(0,-sign*6,-4,0);line(0,-sign*6,4,0);
                    line(-8,6,-8,10);line(-8,10,8,10);line(8,10,8,6);break;
                }
            }
            g.setFont(juce::Font(juce::FontOptions("Arial",horizontal_?9.0f:9.2f,juce::Font::bold)));
            g.drawText(label_,b.toNearestInt(),juce::Justification::centred,false);
        }
    private:Command command_;juce::String label_;bool horizontal_;
    };
    class StepButton final : public juce::Button {
    public:
        explicit StepButton(bool up):juce::Button({}),up_(up){}
        void paintButton(juce::Graphics& g,bool,bool) override {
            g.fillAll(juce::Colour(0xff202020));
            g.setColour(juce::Colours::white.withAlpha(.78f));
            juce::Path p;const float x=getWidth()*.5f,y=getHeight()*.5f;
            p.startNewSubPath(x-3,up_?y+1:y-1);p.lineTo(x,up_?y-2:y+2);
            p.lineTo(x+3,up_?y+1:y-1);g.strokePath(p,juce::PathStrokeType(1.25f));
        }
    private:bool up_;
    };
    std::array<int,7> groupWidths() const noexcept {
        const std::array<int,7> proportion{{225,115,115,375,125,350,135}};
        std::array<int,7> actual{};int used=0;
        for(std::size_t i=0;i<6;++i){actual[i]=getWidth()*proportion[i]/1440;used+=actual[i];}
        actual[6]=getWidth()-used;return actual;
    }
    void changed(){if(onSettingsChanged)onSettingsChanged();}
    void configureCountChoices() {
        countBox_.clear(juce::dontSendNotification);
        if(mode()==MorphMode::ToTarget)for(const auto value:{16,32,64,128,256})
            countBox_.addItem(juce::String(value),value);
        else for(const auto value:{1,2,4,8,16,32,64})
            countBox_.addItem(juce::String(value),value);
        countBox_.setTooltip(mode()==MorphMode::ToTarget
            ?"Final wavetable frame count; type a value or choose a preset"
            :"Number of frames to insert between selected anchors");
        syncCountBox();
    }
    void syncCountBox() {
        if(countBox_.indexOfItemId(count_)>=0)countBox_.setSelectedId(count_,juce::dontSendNotification);
        else countBox_.setText(juce::String(count_),juce::dontSendNotification);
    }
    void updateMethodTooltip() {
        const char* description="Direct sample interpolation";
        switch(method()) {
            case MorphMethod::Crossfade:break;
            case MorphMethod::PhaseAligned:description="Circularly align waveforms before blending";break;
            case MorphMethod::Spectral:description="Interpolate FFT magnitudes and meaningful phases";break;
            case MorphMethod::Harmonic:description="Interpolate partial amplitudes with coherent source phases";break;
            case MorphMethod::HarmonicShift:description="Transport matched harmonics across partial indices";break;
            case MorphMethod::Hybrid:description="Blend coherent waveform and spectral evolution";break;
        }
        method_.setTooltip(description);
    }
    class ToolLookAndFeel final : public juce::LookAndFeel_V4 {
    public:
        juce::Font getComboBoxFont(juce::ComboBox&) override {
            return juce::Font(juce::FontOptions(10.0f));
        }
    } lookAndFeel_;
    int count_=256;
    Button copy_{Command::Copy,"COPY"},paste_{Command::Paste,"PASTE"},
        duplicate_{Command::Duplicate,"DUPLICATE"},delete_{Command::Delete,"DELETE"},
        before_{Command::Before,"BEFORE"},after_{Command::After,"AFTER"},
        left_{Command::Left,"LEFT"},right_{Command::Right,"RIGHT"},morph_{Command::Morph,"MORPH"},
        phase_{Command::Phase,"PHASE"},zero_{Command::Zero,"ZERO"},
        normalize_{Command::Normalize,"NORMALIZE",true},reverse_{Command::Reverse,"REVERSE",true},
        invert_{Command::Invert,"INVERT",true},smooth_{Command::Smooth,"SMOOTH",true},
        import_{Command::Import,"IMPORT"},export_{Command::Export,"EXPORT"};
    StepButton up_{true},down_{false};
    juce::ComboBox mode_,countBox_,method_,curve_,scope_,portion_;
};
}
