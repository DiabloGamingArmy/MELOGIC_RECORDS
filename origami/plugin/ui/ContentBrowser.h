// mct-origami-content-browser
#pragma once
#include "OrigamiStyle.h"
#include "../content/ContentLibrary.h"
#include "core/OscillatorModule.h"
#include <functional>
#include <list>
#include <memory>
#include <vector>

// The one Origami content browser. A mode (ContentType) selects what is
// browsed; everything else (search, library sidebar, list, details, keyboard,
// favorites, recents, sorting) is shared, so a future content type is a new
// mode, not a new browser. It occupies the editor's whole workspace between
// the header and the performance bar.
namespace mct::origami::ui {

class ContentBrowser final : public juce::Component {
public:
    using ContentType=content::ContentType;
    struct Host {
        std::function<juce::String()> loadedPresetId;
        std::function<juce::String(OscillatorModuleId)> loadedWavetableId;
        std::function<bool(const content::ContentRecord&)> loadPreset;
        std::function<bool(const content::ContentRecord&,OscillatorModuleId)> loadWavetable;
        std::function<void(OscillatorModuleId)> importWavetable;
        std::function<juce::String(OscillatorModuleId)> oscillatorLabel; // "OSC 2"
        std::function<void()> close;
    };
    ContentBrowser(content::ContentLibrary&,Host);
    ~ContentBrowser() override;

    // Opens a mode. `target`: the oscillator a wavetable will be loaded into.
    void open(ContentType,OscillatorModuleId target=0);
    ContentType mode() const noexcept { return mode_; }
    OscillatorModuleId target() const noexcept { return target_; }

    // Query / selection (also used by tests and the header's < >).
    void setSearchText(const juce::String&);
    void setScope(const juce::String& scope);
    void setFacet(const juce::String& kind,const juce::String& value);
    void setSort(content::Sort,bool descending=false);
    const std::vector<int>& results() const noexcept { return results_; }
    const content::ContentRecord* record(int resultIndex) const;
    int selectedIndex() const noexcept { return selected_; }
    const content::ContentRecord* selectedRecord() const { return record(selected_); }
    void select(int resultIndex,bool scrollIntoView=true);
    bool selectId(const juce::String& id);
    bool loadSelected();
    // The id after / before `id` in the current results (wraps); empty if none.
    juce::String neighbour(ContentType,const juce::String& id,int step);
    juce::TextEditor& searchField() noexcept;
    void refresh(); // re-run the query on the current snapshot

    // Library maintenance for the selected record (user content only).
    bool renameSelected(const juce::String& name);
    bool deleteSelected();          // after confirmation
    void toggleFavoriteSelected();

    void resized() override;
    void paint(juce::Graphics&) override;
    bool keyPressed(const juce::KeyPress&) override;
    void visibilityChanged() override;

    static constexpr int headerHeight=44;

private:
    class SearchField; class Sidebar; class List; class Details;
    content::ContentLibrary& library_;
    Host host_;
    ContentType mode_=ContentType::Preset;
    OscillatorModuleId target_=0;
    content::Query query_;
    std::shared_ptr<const content::Snapshot> snapshot_;
    std::vector<int> results_;
    int selected_=-1;
    std::unique_ptr<SearchField> search_;
    juce::TextButton sort_{"SORT"},close_{"CLOSE"},import_{"IMPORT"};
    std::unique_ptr<Sidebar> sidebar_;
    std::unique_ptr<List> list_;
    std::unique_ptr<Details> details_;
    // Bounded preview cache: full wavetable frames of recently selected rows.
    std::list<std::pair<juce::String,std::shared_ptr<const content::WavetableData>>> previews_;
    static constexpr std::size_t previewCacheSize=8;
    std::shared_ptr<const content::WavetableData> preview(const content::ContentRecord&);
    friend class Details;
    friend class List;
    friend class Sidebar;
    void runQuery(bool keepSelection);
    void rememberModeState();
    void libraryChanged();
    void showSortMenu();
    void showRowMenu(int resultIndex);
    juce::String loadedId() const;
};

// One content library per process, shared by every editor (all instances
// read / write the same user folder). Tests point it at a temporary folder.
struct SharedContentLibrary {
    SharedContentLibrary();
    content::ContentLibrary library;
    static void setBaseForTesting(const juce::File&);
};

// SAVE: a compact Origami-native form for the preset metadata.
class PresetSaveDialog final : public juce::Component {
public:
    struct Fields { juce::String name,author,category,tags,description; };
    PresetSaveDialog();
    // `replaceName`: the loaded user preset SAVE would update (empty: none).
    void setFields(const Fields&,const juce::String& replaceName);
    Fields fields() const;
    std::function<void(const Fields&,bool replace)> onSave;
    std::function<void()> onCancel;
    void resized() override;
    void paint(juce::Graphics&) override;
    bool keyPressed(const juce::KeyPress&) override;
    juce::TextEditor& nameField() noexcept { return name_; }
    juce::TextButton& saveNewButton() noexcept { return saveNew_; }
    juce::TextButton& replaceButton() noexcept { return replace_; }
private:
    juce::TextEditor name_,author_,category_,tags_,description_;
    juce::TextButton saveNew_{"SAVE AS NEW"},replace_{"SAVE"},cancel_{"CANCEL"};
    juce::String replaceName_;
};

}
