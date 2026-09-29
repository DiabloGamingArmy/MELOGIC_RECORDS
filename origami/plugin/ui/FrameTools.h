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
        for(auto* box:std::array<juce::ComboBox*,6>{{&mode_,&method_,&curve_,&scope_,&portion_,&targetPreset_}}) {
            addAndMakeVisible(*box);
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
        for(int count:{16,32,64,128,256})targetPreset_.addItem(juce::String(count),count);
        targetPreset_.setSelectedId(256,juce::dontSendNotification);
        targetPreset_.onChange=[this]{count_=targetPreset_.getSelectedId();repaint();changed();};
        mode_.onChange=[this]{
            count_=mode()==MorphMode::ToTarget?256:8;
            if(mode()==MorphMode::ToTarget)targetPreset_.setSelectedId(256,juce::dontSendNotification);
            resized();repaint();changed();
        };
        method_.onChange=[this]{changed();};curve_.onChange=[this]{changed();};
        scope_.onChange=[this]{changed();};portion_.onChange=[this]{changed();};
        addAndMakeVisible(up_);addAndMakeVisible(down_);
        up_.onClick=[this]{count_=juce::jmin(256,count_+1);syncPreset();repaint();changed();};
        down_.onClick=[this]{count_=juce::jmax(1,count_-1);syncPreset();repaint();changed();};
        setOpaque(true);
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
        const auto sx=[&](int offset){return morphX+juce::roundToInt(offset*static_cast<float>(morphWidth)/340.0f);};
        const auto countX=sx(124);
        g.setColour(juce::Colour(0xff151515));
        const auto countWidth=sx(161)-sx(124);
        g.fillRect(countX,21,countWidth,35);
        g.setColour(juce::Colour(0xff383838));g.drawRect(countX,21,countWidth,35);
        g.setColour(juce::Colours::white.withAlpha(.88f));
        g.setFont(juce::Font(juce::FontOptions("Arial",15.0f,juce::Font::plain)));
        g.drawText(juce::String(count_),countX,21,countWidth,35,juce::Justification::centred,false);
        g.setFont(juce::Font(juce::FontOptions("Arial",8.5f,juce::Font::bold)));
        g.setColour(juce::Colours::white.withAlpha(.8f));
        if(mode()==MorphMode::Between)
            g.drawText("STEPS",countX-2,67,57,11,juce::Justification::centred,false);
        g.drawText("MODE",sx(57),67,sx(123)-sx(57),11,juce::Justification::centred,false);
        g.drawText("METHOD",sx(180),67,sx(268)-sx(180),11,juce::Justification::centred,false);
        g.drawText("CURVE",sx(272),67,sx(336)-sx(272),11,juce::Justification::centred,false);
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
        const auto sx=[&](int offset){return mx+juce::roundToInt(offset*static_cast<float>(mw)/340.0f);};
        vertical(morph_,sx(6),sx(56)-sx(6));
        mode_.setBounds(sx(57),27,sx(123)-sx(57),28);
        const int countX=sx(124);
        up_.setBounds(sx(163),21,sx(177)-sx(163),17);
        down_.setBounds(sx(163),39,sx(177)-sx(163),17);
        method_.setBounds(sx(180),27,sx(268)-sx(180),28);
        curve_.setBounds(sx(272),27,sx(336)-sx(272),28);
        targetPreset_.setBounds(countX,56,sx(177)-countX,13);
        targetPreset_.setVisible(mode()==MorphMode::ToTarget);
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
            const float alpha=isEnabled()?1.0f:.28f;
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
                case Command::Before:case Command::After: {
                    const float sign=command_==Command::Before?1.0f:-1.0f;
                    line(-sign*7,-9,-sign*7,9);line(sign*6,-7,sign*6,7);
                    line(sign*6,0,-sign*2,0);line(-sign*2,0,sign*1,-3);line(-sign*2,0,sign*1,3);break;
                }
                case Command::Left:case Command::Right: {
                    const float sign=command_==Command::Left?1.0f:-1.0f;
                    line(sign*6,-8,-sign*3,0);line(-sign*3,0,sign*6,8);break;
                }
                case Command::Morph:
                    path.startNewSubPath(cx-9,cy-7);path.cubicTo(cx-2,cy-7,cx+2,cy+7,cx+9,cy+7);
                    path.startNewSubPath(cx-9,cy+7);path.cubicTo(cx-2,cy+7,cx+2,cy-7,cx+9,cy-7);
                    g.strokePath(path,juce::PathStrokeType(1.6f));break;
                case Command::Phase:case Command::Zero:
                    path.startNewSubPath(cx-10,cy);path.cubicTo(cx-4,cy-10,cx+1,cy+10,cx+9,cy);
                    g.strokePath(path,juce::PathStrokeType(1.6f));
                    line(0,-10,0,10);
                    if(command_==Command::Zero)g.drawEllipse(cx-6,cy-6,12.0f,12.0f,1.2f);break;
                case Command::Normalize:
                    path.startNewSubPath(cx-8,cy);path.cubicTo(cx-3,cy-8,cx+3,cy+8,cx+8,cy);
                    g.strokePath(path,juce::PathStrokeType(1.5f));break;
                case Command::Reverse:case Command::Invert:
                    line(-7,0,7,0);
                    if(command_==Command::Invert) {line(0,-7,0,7);line(-3,-5,0,-8);line(0,-8,3,-5);}
                    else {line(-7,0,-3,-4);line(-7,0,-3,4);line(7,0,3,-4);line(7,0,3,4);}break;
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
            g.setFont(juce::Font(juce::FontOptions("Arial",horizontal_?8.0f:8.5f,juce::Font::bold)));
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
        const std::array<int,7> proportion{{245,125,125,340,135,320,150}};
        std::array<int,7> actual{};int used=0;
        for(std::size_t i=0;i<6;++i){actual[i]=getWidth()*proportion[i]/1440;used+=actual[i];}
        actual[6]=getWidth()-used;return actual;
    }
    void changed(){if(onSettingsChanged)onSettingsChanged();}
    void syncPreset() {
        if(mode()!=MorphMode::ToTarget)return;
        if(count_==16 || count_==32 || count_==64 || count_==128 || count_==256)
            targetPreset_.setSelectedId(count_,juce::dontSendNotification);
        else targetPreset_.setText("PRESET",juce::dontSendNotification);
    }
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
    juce::ComboBox mode_,method_,curve_,scope_,portion_,targetPreset_;
};
}
