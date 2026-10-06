// mct-origami-content-browser
#pragma once
#include <JuceHeader.h>
#include <array>
#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <vector>

// The Origami content library: one model for every browsable resource type.
// A ContentType names what a record is; a ContentOrigin where it comes from.
// Records are indexed metadata only (no DSP state, no samples): full content
// is read on demand. Nothing here ever runs on the audio thread.
namespace mct::origami::content {

enum class ContentType : std::uint8_t { Preset=0, Wavetable=1 };
inline constexpr std::size_t contentTypeCount=2;
enum class ContentOrigin : std::uint8_t { Factory=0, User=1, Imported=2, Pack=3 };
const char* typeKey(ContentType) noexcept;        // "preset", "wavetable"
const char* originName(ContentOrigin) noexcept;   // "FACTORY", "USER", ...
const char* originKey(ContentOrigin) noexcept;    // "factory", "user", ...

// Metadata schema version: independent of the DSP state version.
inline constexpr int metadataSchema=1;
inline constexpr int wavetableFrameSamples=2048,maxWavetableFrames=256;

struct ContentRecord {
    juce::String id;                     // stable identity (survives rename / move)
    ContentType type=ContentType::Preset;
    ContentOrigin origin=ContentOrigin::User;
    juce::String name,author,category,description;
    juce::StringArray tags;
    juce::int64 created=0,modified=0;    // ms since epoch: stored metadata, else file times
    juce::File file;                     // empty for built-in factory content
    juce::String format;                 // "origami-preset", "wav", "builtin"
    juce::int64 fileSize=0,fileTime=0;   // index invalidation key
    juce::String contentHash;            // wavetables: hash of the canonical frames
    int frames=0,samplesPerFrame=0;      // wavetables
    int stateVersion=0;                  // presets: DSP state version
    int oscillators=-1,macros=-1,nodes=-1,fxModules=-1; // presets: summary written at save (-1 unknown)
    juce::String searchText;             // lower-case name / author / category / tags / description
    void buildSearchText();
    bool isReadOnly() const noexcept { return origin==ContentOrigin::Factory || origin==ContentOrigin::Pack; }
};

// ---- metadata (JSON; unknown fields ignored, malformed documents rejected) --
juce::var recordToMetadata(const ContentRecord&);
bool metadataToRecord(const juce::var&,ContentType,ContentRecord&);
juce::String formatTime(juce::int64 ms);
juce::int64 parseTime(const juce::String&);

// ---- presets: one file = metadata + the unchanged DSP state blob ----------
inline constexpr const char* presetExtension=".origami";
juce::String encodePresetFile(const ContentRecord&,const juce::MemoryBlock& state);
bool decodePresetFile(const juce::String& text,ContentRecord& meta,juce::MemoryBlock* state);

// ---- wavetables: canonical single-cycle frames ------------------------------
struct WavetableData {
    juce::String name;
    std::vector<float> samples;          // frames * wavetableFrameSamples, finite, |x| <= 1
    int frames() const noexcept { return static_cast<int>(samples.size()/wavetableFrameSamples); }
    bool valid() const noexcept;
};
juce::String hashFrames(const std::vector<float>&);
enum class ReadResult { Ok, Unreadable, BadLength, TooManyFrames, NonFinite, Silent, TooLarge };
const char* describe(ReadResult) noexcept;
// WAV / AIFF: N x 2048 contiguous frames (Serum's layout), mono or the mean of
// all channels; a peak above 1 is scaled down to 1, nothing else is altered.
ReadResult readWavetableFile(const juce::File&,WavetableData&,juce::String* sourceFormat=nullptr);
// Header-only probe for indexing (frame count without reading samples).
ReadResult probeWavetableFile(const juce::File&,int& frames);
// 32-bit float mono WAV: the canonical frames exactly.
bool writeWavetableWav(const juce::File&,const WavetableData&);
WavetableData basicShapes();             // the factory BASIC SHAPES table (4 frames)

// ---- user library state (never patch state) --------------------------------
enum class Sort : int { Name=0, Created, Modified, Author, RecentlyUsed, RecentlyAdded };
inline constexpr int sortCount=6;
const char* sortName(Sort) noexcept;
struct BrowserModeState {
    juce::String scope="all";            // all / factory / user / imported / favorites / recent / added
    juce::String facetKind,facetValue;   // "category" / "tag" / "author"
    Sort sort=Sort::Name;
    bool descending=false;
};
struct LibraryState {
    std::set<juce::String> favorites;
    std::array<std::vector<std::pair<juce::String,juce::int64>>,contentTypeCount> recents; // newest first
    std::array<BrowserModeState,contentTypeCount> modes;
    juce::String author;                 // default author for new user content
    static constexpr std::size_t maxRecents=50;
    void touchRecent(ContentType,const juce::String& id,juce::int64 when);
    juce::int64 recentTime(ContentType,const juce::String& id) const;
    juce::var toVar() const;
    void fromVar(const juce::var&);
};

// ---- index snapshot + query --------------------------------------------------
struct Snapshot {
    std::vector<ContentRecord> records;
    std::uint64_t generation=0;
    int indexOf(const juce::String& id) const;
};
struct Query {
    ContentType type=ContentType::Preset;
    juce::String text,scope="all",facetKind,facetValue;
    Sort sort=Sort::Name;
    bool descending=false;
    juce::int64 now=0;                   // "recently added" window reference (0: current time)
};
// Indices into snapshot.records, filtered and sorted. Pure: no file access.
std::vector<int> runQuery(const Snapshot&,const Query&,const LibraryState&);
struct Facets { std::vector<std::pair<juce::String,int>> categories,tags,authors; };
Facets facetsFor(const Snapshot&,ContentType);

// ---- the library -------------------------------------------------------------
class ContentLibrary {
public:
    // `base`: the Origami user folder (~/Library/Application Support/MCT Origami).
    explicit ContentLibrary(juce::File base);
    ~ContentLibrary();
    static juce::File defaultBase();

    juce::File presetsDirectory() const { return base_.getChildFile("Presets"); }
    juce::File wavetablesDirectory() const { return base_.getChildFile("Wavetables"); }
    juce::File importedWavetablesDirectory() const { return wavetablesDirectory().getChildFile("Imported"); }

    // Message thread. The snapshot is immutable; a new one replaces it.
    std::shared_ptr<const Snapshot> snapshot() const { return snapshot_; }
    const ContentRecord* find(const juce::String& id) const;
    // Cold start: the cached index (no file parsing). rescan*: stat every
    // file, parse only new / changed ones.
    void rescanAsync();
    void rescanNow();
    bool scanning() const noexcept { return scanning_.load(); }
    std::function<void()> onChanged;     // message thread, after the snapshot changed

    LibraryState& state() noexcept { return state_; }
    void saveState();
    void setFavorite(const juce::String& id,bool favorite);
    bool isFavorite(const juce::String& id) const { return state_.favorites.count(id)!=0; }
    void markUsed(ContentType,const juce::String& id);

    // Mutations (message thread): the index updates incrementally.
    juce::Result savePreset(ContentRecord meta,const juce::MemoryBlock& state,ContentRecord& saved);
    juce::Result importWavetable(const juce::File& source,ContentRecord& out,bool& duplicate);
    juce::Result rename(const juce::String& id,const juce::String& newName);
    juce::Result remove(const juce::String& id);  // user content only; moved to the Trash
    juce::Result updateMetadata(const ContentRecord&); // user content: author / category / tags / description

    bool loadPresetState(const ContentRecord&,juce::MemoryBlock& state) const;
    bool loadWavetable(const ContentRecord&,WavetableData&) const;

    // Factory content ids.
    static constexpr const char* initPresetId="factory.preset.init";
    static constexpr const char* basicShapesId="factory.wavetable.basic-shapes";

private:
    struct Cache;
    juce::File base_;
    std::shared_ptr<const Snapshot> snapshot_;
    LibraryState state_;
    std::atomic<bool> scanning_{false};
    std::atomic<std::uint64_t> mutations_{0};
    std::shared_ptr<std::atomic<bool>> alive_;
    std::unique_ptr<juce::Thread> worker_;
    std::uint64_t nextGeneration_=1;

    static std::vector<ContentRecord> factoryRecords();
    static std::vector<ContentRecord> scan(const juce::File& base,const Snapshot* cached);
    void install(std::vector<ContentRecord> records);
    void replaceRecord(const ContentRecord&);
    void dropRecord(const juce::String& id);
    void writeIndex() const;
    void loadIndex();
    juce::File uniqueFile(const juce::File& directory,const juce::String& name,const juce::String& extension) const;
};

// Writes a metadata sidecar beside a wavetable file ("<file>.json").
juce::File sidecarFor(const juce::File& wav);

}
