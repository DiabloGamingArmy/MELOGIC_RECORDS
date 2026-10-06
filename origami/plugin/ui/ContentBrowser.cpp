// mct-origami-content-browser
#include "ContentBrowser.h"
#include "NativeChoiceMenu.h"
#include "UserPreferences.h"
#include <cmath>

namespace mct::origami::ui {
using content::ContentOrigin;
using content::ContentRecord;
using content::ContentType;

namespace {
juce::String u8(const char* s) { return juce::String(juce::CharPointer_UTF8(s)); }
juce::String dateText(juce::int64 ms) { return ms>0 ? juce::Time(ms).formatted("%Y-%m-%d") : juce::String("-"); }
juce::String plural(ContentType t) { return t==ContentType::Wavetable ? "WAVETABLES" : "PRESETS"; }
void paintStar(juce::Graphics& g,juce::Rectangle<float> r,bool on) {
    juce::Path star;
    const auto c=r.getCentre(); const float ro=std::min(r.getWidth(),r.getHeight())*0.5f,ri=ro*0.45f;
    for(int i=0;i<10;++i) {
        const float a=juce::MathConstants<float>::pi*(float(i)/5.0f)-juce::MathConstants<float>::halfPi;
        const float rad=(i%2)?ri:ro;
        const juce::Point<float> p{c.x+std::cos(a)*rad,c.y+std::sin(a)*rad};
        if(i==0) star.startNewSubPath(p); else star.lineTo(p);
    }
    star.closeSubPath();
    if(on) { g.setColour(signalSourceColour()); g.fillPath(star); }
    else { g.setColour(Palette::muted()); g.strokePath(star,juce::PathStrokeType(1.0f)); }
}
void styleButton(juce::TextButton& b) { b.setColour(juce::TextButton::buttonColourId,Palette::raised()); }
}

// ---- search field ----------------------------------------------------------------
// An explicit text field: when the user has clicked into it, it owns the
// keyboard (typing, and Up / Down / Return / Escape for the results)
// regardless of CAPTURE KEYBOARD INPUT.
class ContentBrowser::SearchField final : public juce::TextEditor {
public:
    explicit SearchField(ContentBrowser& owner):juce::TextEditor("CONTENT SEARCH"),owner_(owner) {
        setFont(juce::FontOptions(Type::control));
        setTextToShowWhenEmpty("SEARCH NAME, AUTHOR, TAG, CATEGORY, DESCRIPTION",Palette::muted());
        setColour(juce::TextEditor::backgroundColourId,Palette::inset());
        setColour(juce::TextEditor::outlineColourId,Palette::borderSoft());
        setColour(juce::TextEditor::focusedOutlineColourId,Palette::borderStrong());
        setColour(juce::TextEditor::textColourId,Palette::text());
        setIndents(10,0);
        setJustification(juce::Justification::centredLeft);
        onTextChange=[this]{ owner_.setSearchText(getText()); };
    }
    bool keyPressed(const juce::KeyPress& key) override {
        if(key==juce::KeyPress::upKey) { owner_.select(std::max(0,owner_.selected_-1)); return true; }
        if(key==juce::KeyPress::downKey) { owner_.select(std::min(int(owner_.results_.size())-1,owner_.selected_+1)); return true; }
        if(key==juce::KeyPress::returnKey) { owner_.loadSelected(); return true; }
        if(key==juce::KeyPress::escapeKey) {
            if(getText().isNotEmpty()) { setText({}); return true; }
            if(owner_.host_.close) owner_.host_.close();
            return true;
        }
        return juce::TextEditor::keyPressed(key);
    }
private:
    ContentBrowser& owner_;
};

// ---- sidebar ---------------------------------------------------------------------
class ContentBrowser::Sidebar final : public juce::Component {
public:
    explicit Sidebar(ContentBrowser& owner):owner_(owner) { setName("CONTENT LIBRARY SIDEBAR"); }
    struct Item { bool header=false; juce::String label,scope,facetKind,facetValue; int count=-1; };
    void rebuild() {
        items_.clear();
        const auto type=owner_.mode_;
        const auto& snap=*owner_.snapshot_;
        int all=0,factory=0,user=0,imported=0,favorites=0,recent=0;
        for(const auto& r:snap.records) if(r.type==type) {
            ++all; factory+=r.origin==ContentOrigin::Factory; user+=r.origin==ContentOrigin::User; imported+=r.origin==ContentOrigin::Imported;
            favorites+=owner_.library_.isFavorite(r.id);
            recent+=owner_.library_.state().recentTime(type,r.id)!=0;
        }
        items_.push_back({false,"ALL "+plural(type),"all",{},{},all});
        items_.push_back({true,"LIBRARY",{},{},{},-1});
        items_.push_back({false,"FACTORY","factory",{},{},factory});
        items_.push_back({false,"USER","user",{},{},user});
        if(type==ContentType::Wavetable) items_.push_back({false,"IMPORTED","imported",{},{},imported});
        items_.push_back({true,"QUICK ACCESS",{},{},{},-1});
        items_.push_back({false,"FAVORITES","favorites",{},{},favorites});
        items_.push_back({false,"RECENTLY USED","recent",{},{},recent});
        items_.push_back({false,"RECENTLY ADDED","added",{},{},-1});
        const auto facets=content::facetsFor(snap,type);
        const auto section=[&](const char* title,const char* kind,const auto& list) {
            if(list.empty()) return;
            items_.push_back({true,title,{},{},{},-1});
            for(const auto& [value,count]:list) items_.push_back({false,value.toUpperCase(),"all",kind,value,count});
        };
        section("CATEGORIES","category",facets.categories);
        section("TAGS","tag",facets.tags);
        section("AUTHORS","author",facets.authors);
        scroll_=juce::jlimit(0,maxScroll(),scroll_);
        repaint();
    }
    const std::vector<Item>& items() const noexcept { return items_; }
    void paint(juce::Graphics& g) override {
        g.fillAll(Palette::panel());
        g.setColour(Palette::borderSoft()); g.drawVerticalLine(getWidth()-1,0.0f,float(getHeight()));
        int y=8-scroll_;
        for(const auto& item:items_) {
            const int h=item.header ? headerRow : row;
            if(y+h>0 && y<getHeight()) {
                const juce::Rectangle<int> r{0,y,getWidth()-1,h};
                if(item.header) text(g,item.label,r.reduced(14,0).withTrimmedTop(8),Type::secondary,Palette::muted());
                else {
                    const bool active=isActive(item);
                    if(active) { g.setColour(Palette::raised()); g.fillRect(r); g.setColour(signalSourceColour()); g.fillRect(r.withWidth(2)); }
                    auto inner=r.reduced(14,0);
                    if(item.count>=0) text(g,juce::String(item.count),inner.removeFromRight(40),Type::secondary,Palette::muted(),juce::Justification::centredRight);
                    text(g,item.label,inner,Type::label,active ? Palette::text() : Palette::secondary());
                }
            }
            y+=h;
        }
    }
    void mouseDown(const juce::MouseEvent& e) override {
        int y=8-scroll_;
        for(const auto& item:items_) {
            const int h=item.header ? headerRow : row;
            if(e.y>=y && e.y<y+h) {
                if(item.header) return;
                if(item.facetKind.isNotEmpty() && isActive(item)) owner_.setFacet({},{}); // a second click clears a facet
                else { owner_.query_.scope=item.scope; owner_.setFacet(item.facetKind,item.facetValue); }
                return;
            }
            y+=h;
        }
    }
    void mouseWheelMove(const juce::MouseEvent&,const juce::MouseWheelDetails& w) override {
        scroll_=juce::jlimit(0,maxScroll(),scroll_-juce::roundToInt(w.deltaY*120.0f)); repaint();
    }
private:
    static constexpr int row=26,headerRow=30;
    ContentBrowser& owner_;
    std::vector<Item> items_;
    int scroll_=0;
    bool isActive(const Item& item) const {
        const auto& q=owner_.query_;
        if(item.facetKind.isNotEmpty()) return q.facetKind==item.facetKind && q.facetValue.equalsIgnoreCase(item.facetValue);
        return q.facetKind.isEmpty() && q.scope==item.scope;
    }
    int maxScroll() const {
        int h=16; for(const auto& i:items_) h+=i.header ? headerRow : row;
        return std::max(0,h-getHeight());
    }
};

// ---- list (virtualized: only the visible rows are painted) -----------------------
class ContentBrowser::List final : public juce::Component, private juce::ScrollBar::Listener {
public:
    explicit List(ContentBrowser& owner):owner_(owner) {
        setName("CONTENT LIST");
        addAndMakeVisible(bar_); bar_.addListener(this); bar_.setAutoHide(true);
        setWantsKeyboardFocus(false);
    }
    static constexpr int rowHeight=40,columnsHeight=26;
    void update() {
        bar_.setRangeLimits(0.0,double(owner_.results_.size())*rowHeight);
        bar_.setCurrentRange(bar_.getCurrentRangeStart(),double(std::max(1,getHeight()-columnsHeight)));
        repaint();
    }
    void scrollTo(int index) {
        const double top=double(index)*rowHeight,visible=double(getHeight()-columnsHeight),start=bar_.getCurrentRangeStart();
        if(top<start) bar_.setCurrentRangeStart(top);
        else if(top+rowHeight>start+visible) bar_.setCurrentRangeStart(top+rowHeight-visible);
    }
    double scrollPosition() const { return bar_.getCurrentRangeStart(); }
    int paintedRows() const noexcept { return painted_; }
    void resized() override { bar_.setBounds(getWidth()-8,columnsHeight,8,getHeight()-columnsHeight); update(); }
    juce::Rectangle<int> column(int i) const {
        const int w=getWidth()-12;
        const int x[]{0,int(w*0.42),int(w*0.62),int(w*0.80),w-30,w};
        return {x[i]+12,0,x[i+1]-x[i]-6,0};
    }
    void paint(juce::Graphics& g) override {
        g.fillAll(Palette::background());
        auto header=getLocalBounds().removeFromTop(columnsHeight);
        g.setColour(Palette::panel()); g.fillRect(header);
        g.setColour(Palette::borderSoft()); g.drawHorizontalLine(columnsHeight-1,0.0f,float(getWidth()));
        const auto sort=owner_.query_.sort;
        const char* titles[]{"NAME","AUTHOR","CATEGORY",owner_.query_.sort==content::Sort::Created ? "CREATED" : "MODIFIED",""};
        const content::Sort sorts[]{content::Sort::Name,content::Sort::Author,content::Sort::Name,content::Sort::Modified,content::Sort::Name};
        for(int i=0;i<4;++i) {
            const bool active=(i==0 && sort==content::Sort::Name) || (i==1 && sort==content::Sort::Author) || (i==3 && (sort==content::Sort::Modified || sort==content::Sort::Created));
            juce::String t=titles[i]; if(active) t+=owner_.query_.descending ? u8("  \xe2\x96\xbc") : u8("  \xe2\x96\xb2");
            text(g,t,column(i).withY(0).withHeight(columnsHeight),Type::secondary,active ? Palette::text() : Palette::muted());
        }
        juce::ignoreUnused(sorts);
        auto body=getLocalBounds().withTrimmedTop(columnsHeight).withTrimmedRight(8);
        g.reduceClipRegion(body);
        painted_=0;
        if(owner_.results_.empty()) {
            juce::String message="NO "+plural(owner_.mode_)+" FOUND";
            if(owner_.query_.text.isNotEmpty()) message="NO RESULTS FOR \""+owner_.query_.text.toUpperCase()+"\"";
            else if(owner_.query_.scope=="favorites") message="NO FAVORITES YET: STAR A ROW TO KEEP IT HERE";
            else if(owner_.query_.scope=="recent") message="NOTHING LOADED RECENTLY";
            else if(owner_.query_.scope=="user") message=owner_.mode_==ContentType::Preset ? "NO USER PRESETS: SAVE ONE FROM THE HEADER" : "NO USER WAVETABLES";
            else if(owner_.query_.scope=="imported") message="NO IMPORTED WAVETABLES: USE IMPORT";
            text(g,message,body.withTrimmedTop(40).withHeight(30),Type::label,Palette::muted(),juce::Justification::centred);
            return;
        }
        const double start=bar_.getCurrentRangeStart();
        const int first=std::max(0,int(start/rowHeight));
        const auto loaded=owner_.loadedId();
        for(int i=first;i<int(owner_.results_.size());++i) {
            const int y=columnsHeight+i*rowHeight-int(start);
            if(y>getHeight()) break;
            const auto& r=*owner_.record(i);
            ++painted_;
            const juce::Rectangle<int> row{0,y,body.getWidth(),rowHeight};
            if(i==owner_.selected_) { g.setColour(Palette::raised()); g.fillRect(row); g.setColour(Palette::borderStrong()); g.drawRect(row,1); }
            if(r.id==loaded) { g.setColour(signalSourceColour()); g.fillRect(row.withWidth(3)); }
            g.setColour(Palette::borderSoft()); g.drawHorizontalLine(row.getBottom()-1,0.0f,float(row.getRight()));
            const auto line1=row.withHeight(24).withY(y+2),line2=row.withY(y+22).withHeight(16);
            text(g,r.name,column(0).withY(line1.getY()).withHeight(line1.getHeight()),Type::control,Palette::text());
            auto sub=r.description.isNotEmpty() ? r.description.upToFirstOccurrenceOf("\n",false,false)
                                                : juce::String(content::originName(r.origin))+(r.type==ContentType::Wavetable ? u8("  \xc2\xb7  ")+juce::String(r.frames)+" FRAMES" : juce::String());
            text(g,sub,column(0).withY(line2.getY()).withHeight(line2.getHeight()).withRight(column(2).getRight()),Type::secondary,Palette::muted());
            text(g,r.author.isNotEmpty() ? r.author : "-",column(1).withY(line1.getY()).withHeight(line1.getHeight()),Type::label,Palette::secondary());
            text(g,r.category.isNotEmpty() ? r.category.toUpperCase() : "-",column(2).withY(line1.getY()).withHeight(line1.getHeight()),Type::label,Palette::secondary());
            text(g,dateText(owner_.query_.sort==content::Sort::Created ? r.created : r.modified),column(3).withY(line1.getY()).withHeight(line1.getHeight()),Type::label,Palette::muted());
            paintStar(g,column(4).withY(y+12).withHeight(14).withWidth(14).toFloat(),owner_.library_.isFavorite(r.id));
        }
    }
    int rowAt(juce::Point<int> p) const {
        if(p.y<columnsHeight) return -1;
        const int i=int((p.y-columnsHeight+bar_.getCurrentRangeStart())/rowHeight);
        return i<int(owner_.results_.size()) ? i : -1;
    }
    void mouseDown(const juce::MouseEvent& e) override {
        if(e.y<columnsHeight) { // column headers sort
            content::Sort s=content::Sort::Name;
            if(e.x>=column(1).getX() && e.x<column(2).getX()) s=content::Sort::Author;
            else if(e.x>=column(3).getX() && e.x<column(4).getX()) s=owner_.query_.sort==content::Sort::Created ? content::Sort::Created : content::Sort::Modified;
            else if(e.x>=column(2).getX()) return;
            owner_.setSort(s,owner_.query_.sort==s ? !owner_.query_.descending : (s==content::Sort::Modified || s==content::Sort::Created));
            return;
        }
        const int i=rowAt(e.getPosition());
        if(i<0) return;
        if(e.mods.isPopupMenu()) { owner_.select(i,false); owner_.showRowMenu(i); return; }
        if(e.x>=column(4).getX()) { owner_.select(i,false); owner_.toggleFavoriteSelected(); return; }
        owner_.select(i,false);
    }
    void mouseDoubleClick(const juce::MouseEvent& e) override {
        const int i=rowAt(e.getPosition());
        if(i>=0) { owner_.select(i,false); owner_.loadSelected(); }
    }
    void mouseWheelMove(const juce::MouseEvent& e,const juce::MouseWheelDetails& w) override { bar_.mouseWheelMove(e,w); }
private:
    ContentBrowser& owner_;
    juce::ScrollBar bar_{true};
    int painted_=0;
    void scrollBarMoved(juce::ScrollBar*,double) override { repaint(); }
};

// ---- details / preview ----------------------------------------------------------------
class ContentBrowser::Details final : public juce::Component, private juce::Slider::Listener {
public:
    explicit Details(ContentBrowser& owner):owner_(owner) {
        setName("CONTENT DETAILS");
        for(auto* b:{&favorite_,&load_,&more_,&confirm_,&cancel_}) { styleButton(*b); addChildComponent(b); }
        favorite_.setName("CONTENT FAVORITE"); load_.setName("CONTENT LOAD"); more_.setName("CONTENT MORE");
        favorite_.onClick=[this]{ owner_.toggleFavoriteSelected(); };
        load_.onClick=[this]{ owner_.loadSelected(); };
        more_.onClick=[this]{ if(owner_.selected_>=0) owner_.showRowMenu(owner_.selected_); };
        confirm_.setButtonText("DELETE"); cancel_.setButtonText("CANCEL");
        confirm_.setColour(juce::TextButton::buttonColourId,signalSourceColour().darker(0.6f));
        confirm_.onClick=[this]{ confirming_=false; owner_.deleteSelected(); update(); };
        cancel_.onClick=[this]{ confirming_=false; update(); };
        addChildComponent(rename_);
        rename_.setFont(juce::FontOptions(Type::control));
        rename_.setColour(juce::TextEditor::backgroundColourId,Palette::inset());
        rename_.onReturnKey=[this]{ const auto t=rename_.getText(); rename_.setVisible(false); owner_.renameSelected(t); };
        rename_.onEscapeKey=[this]{ rename_.setVisible(false); };
        rename_.onFocusLost=[this]{ if(rename_.isVisible()) { const auto t=rename_.getText(); rename_.setVisible(false); owner_.renameSelected(t); } };
        frame_.setSliderStyle(juce::Slider::LinearHorizontal);
        frame_.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
        frame_.setName("WAVETABLE PREVIEW FRAME");
        frame_.addListener(this);
        addChildComponent(frame_);
    }
    void beginRename() {
        const auto* r=owner_.selectedRecord();
        if(r==nullptr || r->isReadOnly()) return;
        rename_.setText(r->name,false); rename_.setVisible(true); rename_.grabKeyboardFocus(); rename_.selectAll();
    }
    void confirmDelete() { confirming_=true; update(); }
    bool confirming() const noexcept { return confirming_; }
    void update() {
        const auto* r=owner_.selectedRecord();
        preview_.reset();
        if(r!=nullptr && r->type==ContentType::Wavetable) preview_=owner_.preview(*r);
        const bool has=r!=nullptr;
        favorite_.setVisible(has); load_.setVisible(has); more_.setVisible(has);
        confirm_.setVisible(has && confirming_); cancel_.setVisible(has && confirming_);
        if(has) {
            favorite_.setButtonText(owner_.library_.isFavorite(r->id) ? u8("FAVORITE \xe2\x98\x85") : juce::String("FAVORITE"));
            load_.setButtonText(r->type==ContentType::Wavetable && owner_.host_.oscillatorLabel ? "LOAD INTO "+owner_.host_.oscillatorLabel(owner_.target_) : juce::String("LOAD"));
            more_.setButtonText("...");
        }
        const int frames=preview_ ? preview_->frames() : 0;
        frame_.setVisible(frames>1);
        if(frames>1) { frame_.setRange(0.0,double(frames-1),1.0); frame_.setValue(0.0,juce::dontSendNotification); }
        resized(); repaint();
    }
    void resized() override {
        auto b=getLocalBounds().reduced(16,14);
        auto buttons=b.removeFromBottom(28);
        load_.setBounds(buttons.removeFromRight(std::min(180,buttons.getWidth()/2)));
        buttons.removeFromRight(6);
        more_.setBounds(buttons.removeFromRight(34)); buttons.removeFromRight(6);
        favorite_.setBounds(buttons.removeFromRight(std::min(110,buttons.getWidth())));
        auto confirm=getLocalBounds().reduced(16,14).withTrimmedBottom(34).removeFromBottom(28);
        cancel_.setBounds(confirm.removeFromRight(90)); confirm.removeFromRight(6); confirm_.setBounds(confirm.removeFromRight(90));
        rename_.setBounds(getLocalBounds().reduced(16,14).removeFromTop(30));
        frame_.setBounds(previewArea().withY(previewArea().getBottom()+4).withHeight(18));
    }
    juce::Rectangle<int> previewArea() const { return getLocalBounds().reduced(16,0).withY(170).withHeight(std::max(60,getHeight()/3)); }
    void paint(juce::Graphics& g) override {
        g.fillAll(Palette::panel());
        g.setColour(Palette::borderSoft()); g.drawVerticalLine(0,0.0f,float(getHeight()));
        const auto* r=owner_.selectedRecord();
        auto b=getLocalBounds().reduced(16,14);
        if(r==nullptr) { text(g,"SELECT A ROW TO SEE ITS DETAILS",b.withHeight(30),Type::label,Palette::muted()); return; }
        text(g,r->name,b.removeFromTop(30),15.0f,Palette::text());
        const auto loaded=r->id==owner_.loadedId();
        const juce::String line=juce::String(content::originName(r->origin))+(loaded ? u8("  \xc2\xb7  LOADED") : juce::String());
        text(g,line,b.removeFromTop(18),Type::secondary,loaded ? signalSourceColour() : Palette::muted());
        b.removeFromTop(8);
        const auto field=[&](const char* label,const juce::String& value) {
            auto row=b.removeFromTop(19);
            text(g,label,row.removeFromLeft(92),Type::secondary,Palette::muted());
            text(g,value.isNotEmpty() ? value : juce::String("-"),row,Type::label,Palette::secondary());
        };
        field("AUTHOR",r->author);
        field("CATEGORY",r->category.toUpperCase());
        field("TAGS",r->tags.joinIntoString(", ").toUpperCase());
        field("CREATED",dateText(r->created));
        field("MODIFIED",dateText(r->modified));
        if(r->type==ContentType::Wavetable) {
            field("FRAMES",juce::String(r->frames)+" x "+juce::String(r->samplesPerFrame>0 ? r->samplesPerFrame : content::wavetableFrameSamples)+" SAMPLES");
            if(r->format.isNotEmpty() && r->format!="builtin") field("SOURCE",r->format.toUpperCase());
            auto area=previewArea();
            area.setY(b.getY()+8);
            previewTop_=area.getY();
            paintPreview(g,area);
            b.setY(area.getBottom()+(frame_.isVisible() ? 28 : 8));
        } else if(r->oscillators>=0) {
            juce::String summary="OSC "+juce::String(r->oscillators)+"   MACROS "+juce::String(r->macros)
                                 +"   NODES "+juce::String(r->nodes)+"   FX "+juce::String(r->fxModules);
            field("CONTENTS",summary);
        }
        b.removeFromTop(8);
        text(g,"DESCRIPTION",b.removeFromTop(18),Type::secondary,Palette::muted());
        g.setColour(Palette::secondary());
        g.setFont(juce::FontOptions(Type::label));
        g.drawFittedText(r->description.isNotEmpty() ? r->description : juce::String("No description."),
                         b.withTrimmedBottom(40).withHeight(std::max(20,b.getHeight()-44)),juce::Justification::topLeft,8);
    }
    void paintPreview(juce::Graphics& g,juce::Rectangle<int> area) {
        g.setColour(Palette::inset()); g.fillRect(area);
        g.setColour(Palette::borderSoft()); g.drawRect(area,1);
        if(!preview_) { text(g,"PREVIEW UNAVAILABLE",area,Type::secondary,Palette::muted(),juce::Justification::centred); return; }
        const int frames=preview_->frames();
        // Stacked frames (thin, behind) and the selected frame (red, in front).
        const auto drawFrame=[&](int f,juce::Rectangle<float> r,juce::Colour c,float width) {
            juce::Path p;
            const float* s=preview_->samples.data()+std::size_t(f)*content::wavetableFrameSamples;
            constexpr int step=8;
            for(int i=0;i<content::wavetableFrameSamples;i+=step) {
                const float x=r.getX()+r.getWidth()*float(i)/float(content::wavetableFrameSamples);
                const float y=r.getCentreY()-s[i]*r.getHeight()*0.45f;
                if(i==0) p.startNewSubPath(x,y); else p.lineTo(x,y);
            }
            g.setColour(c); g.strokePath(p,juce::PathStrokeType(width));
        };
        const auto inner=area.reduced(8).toFloat();
        const int stack=std::min(frames,12);
        for(int k=stack-1;k>=0 && frames>1;--k) {
            const int f=int(std::round(float(k)*float(frames-1)/float(std::max(1,stack-1))));
            const float off=float(k)*3.0f;
            drawFrame(f,inner.translated(off,-off).withTrimmedRight(float(stack)*3.0f),Palette::borderStrong().withAlpha(0.6f),0.8f);
        }
        drawFrame(juce::jlimit(0,frames-1,int(frame_.getValue())),inner.withTrimmedRight(frames>1 ? float(stack)*3.0f : 0.0f),signalSourceColour(),1.6f);
        text(g,"FRAME "+juce::String(int(frame_.getValue())+1)+" / "+juce::String(frames),area.reduced(8,4).removeFromBottom(14),Type::secondary,Palette::muted(),juce::Justification::bottomRight);
    }
private:
    ContentBrowser& owner_;
    juce::TextButton favorite_{"FAVORITE"},load_{"LOAD"},more_{"..."},confirm_,cancel_;
    juce::TextEditor rename_{"CONTENT RENAME"};
    juce::Slider frame_;
    std::shared_ptr<const content::WavetableData> preview_;
    bool confirming_=false;
    int previewTop_=0;
    void sliderValueChanged(juce::Slider*) override { repaint(); }
};

// ---- browser ------------------------------------------------------------------------------
ContentBrowser::ContentBrowser(content::ContentLibrary& library,Host host):library_(library),host_(std::move(host)) {
    setName("CONTENT BROWSER");
    setWantsKeyboardFocus(true);
    search_=std::make_unique<SearchField>(*this);
    sidebar_=std::make_unique<Sidebar>(*this);
    list_=std::make_unique<List>(*this);
    details_=std::make_unique<Details>(*this);
    addAndMakeVisible(*search_); addAndMakeVisible(*sidebar_); addAndMakeVisible(*list_); addAndMakeVisible(*details_);
    for(auto* b:{&sort_,&close_,&import_}) { styleButton(*b); addAndMakeVisible(b); }
    sort_.setName("CONTENT SORT"); close_.setName("CONTENT CLOSE"); import_.setName("CONTENT IMPORT");
    sort_.onClick=[this]{ showSortMenu(); };
    close_.onClick=[this]{ if(host_.close) host_.close(); };
    import_.onClick=[this]{ if(host_.importWavetable) host_.importWavetable(target_); };
    snapshot_=library_.snapshot();
    library_.onChanged=[safe=juce::Component::SafePointer<ContentBrowser>(this)]{ if(safe!=nullptr) safe->libraryChanged(); };
}
ContentBrowser::~ContentBrowser() { library_.onChanged=nullptr; }

juce::TextEditor& ContentBrowser::searchField() noexcept { return *search_; }
juce::String ContentBrowser::loadedId() const {
    if(mode_==ContentType::Preset) return host_.loadedPresetId ? host_.loadedPresetId() : juce::String();
    if(!host_.loadedWavetableId) return {};
    const auto id=host_.loadedWavetableId(target_);
    return id.isNotEmpty() ? id : juce::String(content::ContentLibrary::basicShapesId);
}

void ContentBrowser::open(ContentType type,OscillatorModuleId target) {
    mode_=type; target_=target;
    const auto& saved=library_.state().modes[std::size_t(type)];
    query_=content::Query{}; query_.type=type;
    query_.scope=saved.scope; query_.facetKind=saved.facetKind; query_.facetValue=saved.facetValue;
    query_.sort=saved.sort; query_.descending=saved.descending;
    search_->setText({},false);
    import_.setVisible(type==ContentType::Wavetable);
    snapshot_=library_.snapshot();
    sidebar_->rebuild();
    runQuery(false);
    // Reopen on what is loaded (the preset, or the initiating oscillator's table).
    if(!selectId(loadedId())) {
        // Not in the remembered filter: fall back to everything of this type.
        query_.scope="all"; query_.facetKind={}; query_.facetValue={};
        runQuery(false);
        if(!selectId(loadedId())) select(results_.empty() ? -1 : 0);
    }
    library_.rescanAsync(); // pick up files added outside Origami (stat only)
    resized(); repaint();
}

void ContentBrowser::refresh() { snapshot_=library_.snapshot(); sidebar_->rebuild(); runQuery(true); }
void ContentBrowser::libraryChanged() { if(isShowing() || isVisible()) refresh(); }

void ContentBrowser::runQuery(bool keepSelection) {
    const auto previous=keepSelection && selectedRecord()!=nullptr ? selectedRecord()->id : juce::String();
    results_=content::runQuery(*snapshot_,query_,library_.state());
    selected_=-1;
    if(previous.isNotEmpty()) for(int i=0;i<int(results_.size());++i) if(record(i)->id==previous) { selected_=i; break; }
    if(selected_<0 && !results_.empty() && keepSelection) selected_=0;
    list_->update();
    details_->update();
    repaint();
}
const ContentRecord* ContentBrowser::record(int i) const {
    if(!snapshot_ || i<0 || i>=int(results_.size())) return nullptr;
    return &snapshot_->records[std::size_t(results_[std::size_t(i)])];
}
void ContentBrowser::setSearchText(const juce::String& t) {
    if(query_.text==t) return;
    query_.text=t;
    if(search_->getText()!=t) search_->setText(t,false);
    runQuery(true);
}
void ContentBrowser::setScope(const juce::String& scope) { query_.scope=scope; query_.facetKind={}; query_.facetValue={}; rememberModeState(); sidebar_->repaint(); runQuery(true); }
void ContentBrowser::setFacet(const juce::String& kind,const juce::String& value) {
    query_.facetKind=kind; query_.facetValue=value; if(kind.isNotEmpty()) query_.scope="all";
    rememberModeState(); sidebar_->repaint(); runQuery(true);
}
void ContentBrowser::setSort(content::Sort s,bool descending) { query_.sort=s; query_.descending=descending; rememberModeState(); runQuery(true); }
void ContentBrowser::rememberModeState() {
    auto& m=library_.state().modes[std::size_t(mode_)];
    m.scope=query_.scope; m.facetKind=query_.facetKind; m.facetValue=query_.facetValue; m.sort=query_.sort; m.descending=query_.descending;
    library_.saveState();
}
void ContentBrowser::select(int i,bool scroll) {
    if(i<-1 || i>=int(results_.size())) return;
    selected_=i;
    if(scroll && i>=0) list_->scrollTo(i);
    list_->repaint();
    details_->update();
}
bool ContentBrowser::selectId(const juce::String& id) {
    if(id.isEmpty()) return false;
    for(int i=0;i<int(results_.size());++i) if(record(i)->id==id) { select(i); return true; }
    return false;
}
bool ContentBrowser::loadSelected() {
    const auto* r=selectedRecord();
    if(r==nullptr) return false;
    const auto copy=*r;
    bool ok=false;
    if(copy.type==ContentType::Preset) ok=host_.loadPreset && host_.loadPreset(copy);
    else ok=host_.loadWavetable && host_.loadWavetable(copy,target_);
    if(!ok) return false;
    library_.markUsed(copy.type,copy.id);
    if(host_.close) host_.close();
    return true;
}
juce::String ContentBrowser::neighbour(ContentType type,const juce::String& id,int step) {
    if(mode_!=type || results_.empty()) {
        // No browser context for this type: the whole library by name.
        mode_=type; query_=content::Query{}; query_.type=type;
        snapshot_=library_.snapshot();
        results_=content::runQuery(*snapshot_,query_,library_.state());
    }
    if(results_.empty()) return {};
    int at=-1;
    for(int i=0;i<int(results_.size());++i) if(record(i)->id==id) { at=i; break; }
    const int n=int(results_.size());
    const int next=at<0 ? (step>0 ? 0 : n-1) : ((at+step)%n+n)%n;
    return record(next)->id;
}
void ContentBrowser::toggleFavoriteSelected() {
    if(const auto* r=selectedRecord()) { library_.setFavorite(r->id,!library_.isFavorite(r->id)); details_->update(); list_->repaint(); sidebar_->rebuild(); }
}
bool ContentBrowser::renameSelected(const juce::String& name) {
    const auto* r=selectedRecord();
    if(r==nullptr) return false;
    const auto id=r->id;
    if(!library_.rename(id,name).wasOk()) return false;
    refresh(); selectId(id);
    return true;
}
bool ContentBrowser::deleteSelected() {
    const auto* r=selectedRecord();
    if(r==nullptr) return false;
    const int at=selected_;
    if(!library_.remove(r->id).wasOk()) return false;
    refresh(); select(std::min(at,int(results_.size())-1));
    return true;
}
std::shared_ptr<const content::WavetableData> ContentBrowser::preview(const ContentRecord& r) {
    for(auto it=previews_.begin();it!=previews_.end();++it)
        if(it->first==r.id) { previews_.splice(previews_.begin(),previews_,it); return previews_.front().second; }
    content::WavetableData data;
    if(!library_.loadWavetable(r,data)) return nullptr;
    auto shared=std::make_shared<const content::WavetableData>(std::move(data));
    previews_.push_front({r.id,shared});
    while(previews_.size()>previewCacheSize) previews_.pop_back();
    return shared;
}
void ContentBrowser::showSortMenu() {
    std::vector<NativeChoiceItem> items;
    for(int s=0;s<content::sortCount;++s)
        items.push_back({s+1,content::sortName(content::Sort(s)),true,{},query_.sort==content::Sort(s)});
    items.push_back({100,query_.descending ? "ASCENDING" : "DESCENDING",true,"ORDER"});
    showNativeChoiceMenu(sort_,"SORT",items,0,[safe=juce::Component::SafePointer<ContentBrowser>(this)](int c) {
        if(safe==nullptr || c<=0) return;
        if(c==100) safe->setSort(safe->query_.sort,!safe->query_.descending);
        else safe->setSort(content::Sort(c-1),safe->query_.descending);
    });
}
void ContentBrowser::showRowMenu(int i) {
    const auto* r=record(i);
    if(r==nullptr) return;
    const bool user=!r->isReadOnly();
    std::vector<NativeChoiceItem> items{
        {1,library_.isFavorite(r->id) ? "UNFAVORITE" : "FAVORITE",true},
        {2,"RENAME...",user,{},false,user ? juce::String() : juce::String("Factory content is read-only")},
        {3,"DELETE...",user,{},false,user ? juce::String() : juce::String("Factory content cannot be deleted")},
        {4,"SHOW IN FINDER",r->file.existsAsFile()}};
    showNativeChoiceMenu(*list_,"CONTENT",items,0,[safe=juce::Component::SafePointer<ContentBrowser>(this),file=r->file](int c) {
        if(safe==nullptr) return;
        if(c==1) safe->toggleFavoriteSelected();
        if(c==2) safe->details_->beginRename();
        if(c==3) safe->details_->confirmDelete();
        if(c==4 && file.existsAsFile()) file.revealToUser();
    });
}

void ContentBrowser::visibilityChanged() {
    if(isVisible()) snapshot_=library_.snapshot();
}

bool ContentBrowser::keyPressed(const juce::KeyPress& key) {
    // Escape closes the browser (an open Origami editor) in both modes.
    if(key==juce::KeyPress::escapeKey) { if(host_.close) host_.close(); return true; }
    // Navigation shortcuts follow CAPTURE KEYBOARD INPUT; off, the keys go to
    // the host (Logic Musical Typing) unless the search field has focus.
    if(!captureKeyboardInput()) return false;
    const auto mods=key.getModifiers();
    if(key==juce::KeyPress::upKey) { select(std::max(0,selected_-1)); return true; }
    if(key==juce::KeyPress::downKey) { select(std::min(int(results_.size())-1,selected_+1)); return true; }
    if(key==juce::KeyPress::returnKey) { loadSelected(); return true; }
    if(mods.isCommandDown() && (key.getKeyCode()=='F' || key.getKeyCode()=='f')) { search_->grabKeyboardFocus(); return true; }
    return false;
}

void ContentBrowser::resized() {
    auto b=getLocalBounds();
    auto header=b.removeFromTop(headerHeight).reduced(12,8);
    close_.setBounds(header.removeFromRight(70)); header.removeFromRight(8);
    sort_.setBounds(header.removeFromRight(70)); header.removeFromRight(8);
    if(import_.isVisible()) { import_.setBounds(header.removeFromRight(80)); header.removeFromRight(8); }
    header.removeFromLeft(std::min(260,header.getWidth()/4)); // title (painted)
    search_->setBounds(header);
    // LEFT ~20 %, CENTER ~52 %, RIGHT ~28 %; narrow editors give the list priority.
    const int w=b.getWidth();
    const int left=juce::jlimit(150,260,w*20/100);
    const int right=w<900 ? 0 : juce::jlimit(240,420,w*28/100);
    sidebar_->setBounds(b.removeFromLeft(left));
    details_->setVisible(right>0);
    details_->setBounds(b.removeFromRight(right));
    list_->setBounds(b);
}
void ContentBrowser::paint(juce::Graphics& g) {
    g.fillAll(Palette::background());
    auto header=getLocalBounds().removeFromTop(headerHeight);
    g.setColour(Palette::panel()); g.fillRect(header);
    g.setColour(Palette::borderSoft()); g.drawHorizontalLine(headerHeight-1,0.0f,float(getWidth()));
    juce::String title=plural(mode_);
    if(mode_==ContentType::Wavetable && host_.oscillatorLabel) title+=u8("  \xe2\x86\x92  ")+host_.oscillatorLabel(target_);
    text(g,title,header.reduced(16,0).withWidth(std::min(260,getWidth()/4)),Type::title,Palette::text());
}

// ---- shared library ----------------------------------------------------------------
namespace { juce::File& testingBase() { static juce::File base; return base; } }
void SharedContentLibrary::setBaseForTesting(const juce::File& base) { testingBase()=base; }
SharedContentLibrary::SharedContentLibrary()
    :library(testingBase()!=juce::File{} ? testingBase() : content::ContentLibrary::defaultBase()) {}

// ---- save dialog ------------------------------------------------------------------------
PresetSaveDialog::PresetSaveDialog() {
    setName("PRESET SAVE DIALOG");
    for(auto* e:{&name_,&author_,&category_,&tags_,&description_}) {
        e->setFont(juce::FontOptions(Type::control));
        e->setColour(juce::TextEditor::backgroundColourId,Palette::inset());
        e->setColour(juce::TextEditor::outlineColourId,Palette::borderSoft());
        e->setColour(juce::TextEditor::focusedOutlineColourId,Palette::borderStrong());
        e->setIndents(8,6);
        addAndMakeVisible(e);
    }
    name_.setName("SAVE NAME"); author_.setName("SAVE AUTHOR"); category_.setName("SAVE CATEGORY");
    tags_.setName("SAVE TAGS"); description_.setName("SAVE DESCRIPTION");
    tags_.setTextToShowWhenEmpty("comma separated",Palette::muted());
    description_.setMultiLine(true,true); description_.setReturnKeyStartsNewLine(true);
    for(auto* b:{&saveNew_,&replace_,&cancel_}) { styleButton(*b); addAndMakeVisible(b); }
    replace_.setColour(juce::TextButton::buttonColourId,signalSourceColour().darker(0.55f));
    saveNew_.onClick=[this]{ if(onSave) onSave(fields(),false); };
    replace_.onClick=[this]{ if(onSave) onSave(fields(),true); };
    cancel_.onClick=[this]{ if(onCancel) onCancel(); };
    name_.onReturnKey=[this]{ if(onSave) onSave(fields(),replaceName_.isNotEmpty() && name_.getText().trim().equalsIgnoreCase(replaceName_)); };
}
void PresetSaveDialog::setFields(const Fields& f,const juce::String& replaceName) {
    name_.setText(f.name,false); author_.setText(f.author,false); category_.setText(f.category,false);
    tags_.setText(f.tags,false); description_.setText(f.description,false);
    replaceName_=replaceName;
    replace_.setVisible(replaceName.isNotEmpty());
    replace_.setButtonText("SAVE");
    replace_.setTooltip(replaceName.isNotEmpty() ? "Update the user preset \""+replaceName+"\"" : juce::String());
    resized();
}
PresetSaveDialog::Fields PresetSaveDialog::fields() const {
    return {name_.getText().trim(),author_.getText().trim(),category_.getText().trim(),tags_.getText().trim(),description_.getText().trim()};
}
void PresetSaveDialog::resized() {
    auto b=getLocalBounds().reduced(18,14);
    b.removeFromTop(30);
    const auto row=[&](juce::TextEditor& e,int h) { auto r=b.removeFromTop(h+18); r.removeFromTop(16); e.setBounds(r.withHeight(h)); b.removeFromTop(6); };
    row(name_,28);
    auto pair=b.removeFromTop(46); b.removeFromTop(6);
    auto left=pair.removeFromLeft(pair.getWidth()/2-4); pair.removeFromLeft(8);
    author_.setBounds(left.withTrimmedTop(16).withHeight(28)); category_.setBounds(pair.withTrimmedTop(16).withHeight(28));
    row(tags_,28);
    auto buttons=b.removeFromBottom(30); b.removeFromBottom(8);
    b.removeFromTop(16); description_.setBounds(b);
    cancel_.setBounds(buttons.removeFromRight(90)); buttons.removeFromRight(8);
    if(replace_.isVisible()) { replace_.setBounds(buttons.removeFromRight(90)); buttons.removeFromRight(8); }
    saveNew_.setBounds(buttons.removeFromRight(120));
}
void PresetSaveDialog::paint(juce::Graphics& g) {
    g.fillAll(Palette::panel());
    g.setColour(Palette::borderStrong()); g.drawRect(getLocalBounds(),1);
    auto b=getLocalBounds().reduced(18,14);
    text(g,"SAVE PRESET",b.removeFromTop(24),Type::title,Palette::text());
    const auto label=[&](juce::Component& c,const char* t) { text(g,t,c.getBounds().translated(0,-16).withHeight(16),Type::secondary,Palette::muted()); };
    label(name_,"NAME"); label(author_,"AUTHOR"); label(category_,"CATEGORY"); label(tags_,"TAGS"); label(description_,"DESCRIPTION");
}
bool PresetSaveDialog::keyPressed(const juce::KeyPress& key) {
    if(key==juce::KeyPress::escapeKey) { if(onCancel) onCancel(); return true; }
    return false;
}

}
