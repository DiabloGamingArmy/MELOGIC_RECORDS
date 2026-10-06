// mct-origami-content-browser
#include "ContentLibrary.h"
#include "../ui/WavetableDocument.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace mct::origami::content {

const char* typeKey(ContentType t) noexcept { return t==ContentType::Wavetable ? "wavetable" : "preset"; }
const char* originName(ContentOrigin o) noexcept {
    switch(o) { case ContentOrigin::Factory: return "FACTORY"; case ContentOrigin::User: return "USER";
                case ContentOrigin::Imported: return "IMPORTED"; case ContentOrigin::Pack: return "PACK"; }
    return "USER";
}
const char* originKey(ContentOrigin o) noexcept {
    switch(o) { case ContentOrigin::Factory: return "factory"; case ContentOrigin::User: return "user";
                case ContentOrigin::Imported: return "imported"; case ContentOrigin::Pack: return "pack"; }
    return "user";
}
const char* sortName(Sort s) noexcept {
    switch(s) { case Sort::Name: return "NAME"; case Sort::Created: return "DATE CREATED"; case Sort::Modified: return "DATE MODIFIED";
                case Sort::Author: return "AUTHOR"; case Sort::RecentlyUsed: return "RECENTLY USED"; case Sort::RecentlyAdded: return "RECENTLY ADDED"; }
    return "NAME";
}
namespace {
ContentOrigin originFromKey(const juce::String& k,ContentOrigin fallback) {
    if(k=="factory") return ContentOrigin::Factory;
    if(k=="user") return ContentOrigin::User;
    if(k=="imported") return ContentOrigin::Imported;
    if(k=="pack") return ContentOrigin::Pack;
    return fallback;
}
juce::String cleanText(const juce::var& v,int maxLength) {
    if(!v.isString()) return {};
    return v.toString().substring(0,maxLength).trim();
}
juce::int64 nowMs() { return juce::Time::currentTimeMillis(); }
}

void ContentRecord::buildSearchText() {
    searchText=(name+"\n"+author+"\n"+category+"\n"+tags.joinIntoString("\n")+"\n"+description).toLowerCase();
}

juce::String formatTime(juce::int64 ms) { return ms>0 ? juce::Time(ms).toISO8601(true) : juce::String(); }
juce::int64 parseTime(const juce::String& s) {
    if(s.isEmpty()) return 0;
    const auto t=juce::Time::fromISO8601(s);
    return t.toMilliseconds()>0 ? t.toMilliseconds() : 0;
}

juce::var recordToMetadata(const ContentRecord& r) {
    auto* o=new juce::DynamicObject();
    o->setProperty("schema",metadataSchema);
    o->setProperty("id",r.id);
    o->setProperty("type",typeKey(r.type));
    o->setProperty("origin",originKey(r.origin));
    o->setProperty("name",r.name);
    o->setProperty("author",r.author);
    o->setProperty("category",r.category);
    juce::Array<juce::var> tags; for(const auto& t:r.tags) tags.add(t);
    o->setProperty("tags",tags);
    o->setProperty("description",r.description);
    o->setProperty("created",formatTime(r.created));
    o->setProperty("modified",formatTime(r.modified));
    if(r.type==ContentType::Wavetable) {
        o->setProperty("frames",r.frames);
        o->setProperty("samplesPerFrame",r.samplesPerFrame);
        if(r.contentHash.isNotEmpty()) o->setProperty("contentHash",r.contentHash);
        if(r.format.isNotEmpty()) o->setProperty("sourceFormat",r.format);
    } else {
        o->setProperty("stateVersion",r.stateVersion);
        if(r.oscillators>=0) {
            auto* s=new juce::DynamicObject();
            s->setProperty("oscillators",r.oscillators); s->setProperty("macros",r.macros);
            s->setProperty("nodes",r.nodes); s->setProperty("fx",r.fxModules);
            o->setProperty("summary",juce::var(s));
        }
    }
    return juce::var(o);
}

bool metadataToRecord(const juce::var& v,ContentType type,ContentRecord& r) {
    auto* o=v.getDynamicObject();
    if(o==nullptr) return false;
    const auto schema=o->getProperty("schema");
    if(!(schema.isInt() || schema.isInt64() || schema.isDouble()) || static_cast<int>(schema)<1) return false;
    const auto id=cleanText(o->getProperty("id"),200);
    const auto name=cleanText(o->getProperty("name"),120);
    if(id.isEmpty() || name.isEmpty() || id.containsAnyOf("\n\r\t")) return false;
    if(o->hasProperty("type") && o->getProperty("type").toString()!=typeKey(type)) return false;
    r.id=id; r.type=type; r.name=name;
    r.origin=originFromKey(o->getProperty("origin").toString(),r.origin);
    r.author=cleanText(o->getProperty("author"),80);
    r.category=cleanText(o->getProperty("category"),60);
    r.description=cleanText(o->getProperty("description"),2000);
    r.tags.clear();
    if(const auto* tags=o->getProperty("tags").getArray())
        for(const auto& t:*tags) { const auto s=cleanText(t,40); if(s.isNotEmpty() && !r.tags.contains(s,true) && r.tags.size()<32) r.tags.add(s); }
    r.created=parseTime(o->getProperty("created").toString());
    r.modified=parseTime(o->getProperty("modified").toString());
    if(type==ContentType::Wavetable) {
        r.frames=juce::jlimit(0,maxWavetableFrames,static_cast<int>(o->getProperty("frames")));
        r.samplesPerFrame=static_cast<int>(o->getProperty("samplesPerFrame"));
        r.contentHash=cleanText(o->getProperty("contentHash"),40);
        if(o->hasProperty("sourceFormat")) r.format=cleanText(o->getProperty("sourceFormat"),60);
    } else {
        r.stateVersion=static_cast<int>(o->getProperty("stateVersion"));
        if(auto* s=o->getProperty("summary").getDynamicObject()) {
            r.oscillators=static_cast<int>(s->getProperty("oscillators")); r.macros=static_cast<int>(s->getProperty("macros"));
            r.nodes=static_cast<int>(s->getProperty("nodes")); r.fxModules=static_cast<int>(s->getProperty("fx"));
        }
    }
    r.buildSearchText();
    return true;
}

// ---- presets ------------------------------------------------------------------
juce::String encodePresetFile(const ContentRecord& meta,const juce::MemoryBlock& state) {
    auto v=recordToMetadata(meta);
    v.getDynamicObject()->setProperty("format","mct.origami.preset");
    v.getDynamicObject()->setProperty("state",state.toBase64Encoding());
    return juce::JSON::toString(v,false);
}
bool decodePresetFile(const juce::String& text,ContentRecord& meta,juce::MemoryBlock* state) {
    const auto v=juce::JSON::parse(text);
    auto* o=v.getDynamicObject();
    if(o==nullptr || o->getProperty("format").toString()!="mct.origami.preset") return false;
    if(!metadataToRecord(v,ContentType::Preset,meta)) return false;
    const auto encoded=o->getProperty("state").toString();
    if(encoded.isEmpty()) return false;
    if(state!=nullptr) {
        state->reset();
        if(!state->fromBase64Encoding(encoded) || state->getSize()<12) return false;
    }
    meta.format="origami-preset";
    return true;
}

// ---- wavetables -----------------------------------------------------------------
bool WavetableData::valid() const noexcept {
    if(samples.empty() || samples.size()%wavetableFrameSamples!=0 || frames()>maxWavetableFrames) return false;
    for(float s:samples) if(!std::isfinite(s) || std::abs(s)>1.0f) return false;
    return true;
}
juce::String hashFrames(const std::vector<float>& samples) {
    std::uint64_t h=1469598103934665603ull;
    for(float s:samples) {
        std::uint32_t bits; std::memcpy(&bits,&s,sizeof bits);
        for(int i=0;i<4;++i) { h^=(bits>>(i*8))&0xffu; h*=1099511628211ull; }
    }
    return juce::String::toHexString(static_cast<juce::int64>(h)).paddedLeft('0',16);
}
const char* describe(ReadResult r) noexcept {
    switch(r) {
        case ReadResult::Ok: return "OK";
        case ReadResult::Unreadable: return "Not a readable WAV / AIFF file";
        case ReadResult::BadLength: return "Length must be a whole number of 2048-sample frames";
        case ReadResult::TooManyFrames: return "More than 256 frames";
        case ReadResult::NonFinite: return "The audio contains NaN / Inf samples";
        case ReadResult::Silent: return "The audio is silent";
        case ReadResult::TooLarge: return "Too many channels for a wavetable";
    }
    return "Unknown error";
}
namespace {
std::unique_ptr<juce::AudioFormatReader> openReader(const juce::File& file) {
    juce::AudioFormatManager formats; formats.registerBasicFormats();
    return std::unique_ptr<juce::AudioFormatReader>(formats.createReaderFor(file));
}
ReadResult checkShape(const juce::AudioFormatReader& reader,int& frames) {
    if(reader.numChannels<1 || reader.numChannels>8) return ReadResult::TooLarge;
    const auto total=reader.lengthInSamples;
    if(total<wavetableFrameSamples || total%wavetableFrameSamples!=0) return ReadResult::BadLength;
    if(total/wavetableFrameSamples>maxWavetableFrames) return ReadResult::TooManyFrames;
    frames=static_cast<int>(total/wavetableFrameSamples);
    return ReadResult::Ok;
}
}
ReadResult probeWavetableFile(const juce::File& file,int& frames) {
    auto reader=openReader(file);
    if(!reader) return ReadResult::Unreadable;
    return checkShape(*reader,frames);
}
ReadResult readWavetableFile(const juce::File& file,WavetableData& out,juce::String* sourceFormat) {
    auto reader=openReader(file);
    if(!reader) return ReadResult::Unreadable;
    int frames=0;
    if(const auto shape=checkShape(*reader,frames); shape!=ReadResult::Ok) return shape;
    const int total=frames*wavetableFrameSamples,channels=static_cast<int>(reader->numChannels);
    juce::AudioBuffer<float> source(channels,total);
    if(!reader->read(&source,0,total,0,true,true)) return ReadResult::Unreadable;
    std::vector<float> samples(static_cast<std::size_t>(total));
    float peak=0.0f;
    for(int i=0;i<total;++i) {
        double sum=0.0;
        for(int c=0;c<channels;++c) sum+=source.getSample(c,i);
        const float v=static_cast<float>(sum/channels);
        if(!std::isfinite(v)) return ReadResult::NonFinite;
        samples[static_cast<std::size_t>(i)]=v;
        peak=std::max(peak,std::abs(v));
    }
    if(peak<=1.0e-8f) return ReadResult::Silent;
    if(peak>1.0f) for(auto& v:samples) v/=peak;
    out.samples=std::move(samples);
    out.name=file.getFileNameWithoutExtension();
    if(sourceFormat!=nullptr)
        *sourceFormat=reader->getFormatName().upToFirstOccurrenceOf(" ",false,false).toUpperCase()+" "+juce::String(reader->bitsPerSample)
                      +(reader->usesFloatingPointData ? "-bit float" : "-bit")+(channels==1 ? " mono" : " "+juce::String(channels)+" ch");
    return ReadResult::Ok;
}
bool writeWavetableWav(const juce::File& file,const WavetableData& data) {
    if(!data.valid()) return false;
    const int total=static_cast<int>(data.samples.size());
    juce::AudioBuffer<float> buffer(1,total);
    std::copy(data.samples.begin(),data.samples.end(),buffer.getWritePointer(0));
    const auto temp=file.getSiblingFile(file.getFileName()+".tmp");
    {
        std::unique_ptr<juce::OutputStream> stream=temp.createOutputStream();
        if(!stream) return false;
        juce::WavAudioFormat format;
        const auto options=juce::AudioFormatWriterOptions{}.withSampleRate(44100.0).withNumChannels(1).withBitsPerSample(32)
                               .withSampleFormat(juce::AudioFormatWriterOptions::SampleFormat::floatingPoint);
        auto writer=format.createWriterFor(stream,options);
        if(!writer || !writer->writeFromAudioSampleBuffer(buffer,0,total)) { temp.deleteFile(); return false; }
    }
    return temp.moveFileTo(file);
}
WavetableData basicShapes() {
    const auto doc=ui::WavetableDocument::basicShapes();
    WavetableData data; data.name="BASIC SHAPES";
    for(const auto& f:doc.frames) data.samples.insert(data.samples.end(),f.samples.begin(),f.samples.end());
    return data;
}

// ---- library state -----------------------------------------------------------
void LibraryState::touchRecent(ContentType t,const juce::String& id,juce::int64 when) {
    auto& list=recents[static_cast<std::size_t>(t)];
    list.erase(std::remove_if(list.begin(),list.end(),[&](const auto& e){ return e.first==id; }),list.end());
    list.insert(list.begin(),{id,when});
    if(list.size()>maxRecents) list.resize(maxRecents);
}
juce::int64 LibraryState::recentTime(ContentType t,const juce::String& id) const {
    for(const auto& e:recents[static_cast<std::size_t>(t)]) if(e.first==id) return e.second;
    return 0;
}
juce::var LibraryState::toVar() const {
    auto* o=new juce::DynamicObject();
    o->setProperty("schema",metadataSchema);
    juce::Array<juce::var> fav; for(const auto& f:favorites) fav.add(f);
    o->setProperty("favorites",fav);
    auto* rec=new juce::DynamicObject(); auto* modesObj=new juce::DynamicObject();
    for(std::size_t t=0;t<contentTypeCount;++t) {
        juce::Array<juce::var> list;
        for(const auto& [id,when]:recents[t]) { auto* e=new juce::DynamicObject(); e->setProperty("id",id); e->setProperty("t",when); list.add(juce::var(e)); }
        rec->setProperty(typeKey(static_cast<ContentType>(t)),list);
        auto* m=new juce::DynamicObject(); const auto& s=modes[t];
        m->setProperty("scope",s.scope); m->setProperty("facetKind",s.facetKind); m->setProperty("facetValue",s.facetValue);
        m->setProperty("sort",static_cast<int>(s.sort)); m->setProperty("descending",s.descending);
        modesObj->setProperty(typeKey(static_cast<ContentType>(t)),juce::var(m));
    }
    o->setProperty("recents",juce::var(rec));
    o->setProperty("browser",juce::var(modesObj));
    o->setProperty("author",author);
    return juce::var(o);
}
void LibraryState::fromVar(const juce::var& v) {
    auto* o=v.getDynamicObject();
    if(o==nullptr) return;
    favorites.clear();
    if(const auto* fav=o->getProperty("favorites").getArray()) for(const auto& f:*fav) if(f.isString() && f.toString().isNotEmpty()) favorites.insert(f.toString());
    for(std::size_t t=0;t<contentTypeCount;++t) {
        const auto key=typeKey(static_cast<ContentType>(t));
        recents[t].clear();
        if(auto* rec=o->getProperty("recents").getDynamicObject())
            if(const auto* list=rec->getProperty(key).getArray())
                for(const auto& e:*list) if(auto* eo=e.getDynamicObject()) {
                    const auto id=eo->getProperty("id").toString();
                    if(id.isNotEmpty() && recents[t].size()<maxRecents) recents[t].push_back({id,static_cast<juce::int64>(eo->getProperty("t"))});
                }
        if(auto* modesObj=o->getProperty("browser").getDynamicObject())
            if(auto* m=modesObj->getProperty(key).getDynamicObject()) {
                auto& s=modes[t];
                s.scope=m->getProperty("scope").toString(); if(s.scope.isEmpty()) s.scope="all";
                s.facetKind=m->getProperty("facetKind").toString(); s.facetValue=m->getProperty("facetValue").toString();
                s.sort=static_cast<Sort>(juce::jlimit(0,sortCount-1,static_cast<int>(m->getProperty("sort"))));
                s.descending=static_cast<bool>(m->getProperty("descending"));
            }
    }
    author=o->getProperty("author").toString().substring(0,80);
}

// ---- query ---------------------------------------------------------------------
int Snapshot::indexOf(const juce::String& id) const {
    for(std::size_t i=0;i<records.size();++i) if(records[i].id==id) return static_cast<int>(i);
    return -1;
}
std::vector<int> runQuery(const Snapshot& snap,const Query& q,const LibraryState& st) {
    juce::StringArray tokens; tokens.addTokens(q.text.toLowerCase()," \t",""); tokens.removeEmptyStrings();
    const auto now=q.now>0 ? q.now : nowMs();
    constexpr juce::int64 addedWindow=juce::int64(30)*24*3600*1000;
    Sort sort=q.sort;
    if(q.scope=="recent") sort=Sort::RecentlyUsed;
    if(q.scope=="added") sort=Sort::RecentlyAdded;
    std::vector<int> out; out.reserve(snap.records.size());
    for(std::size_t i=0;i<snap.records.size();++i) {
        const auto& r=snap.records[i];
        if(r.type!=q.type) continue;
        if(q.scope=="factory" && r.origin!=ContentOrigin::Factory) continue;
        if(q.scope=="user" && r.origin!=ContentOrigin::User) continue;
        if(q.scope=="imported" && r.origin!=ContentOrigin::Imported) continue;
        if(q.scope=="favorites" && st.favorites.count(r.id)==0) continue;
        if(q.scope=="recent" && st.recentTime(q.type,r.id)==0) continue;
        if(q.scope=="added" && (r.origin==ContentOrigin::Factory || r.created<=0 || now-r.created>addedWindow)) continue;
        if(q.facetKind=="category" && !r.category.equalsIgnoreCase(q.facetValue)) continue;
        if(q.facetKind=="tag" && !r.tags.contains(q.facetValue,true)) continue;
        if(q.facetKind=="author" && !r.author.equalsIgnoreCase(q.facetValue)) continue;
        bool match=true;
        for(const auto& t:tokens) if(!r.searchText.contains(t)) { match=false; break; }
        if(match) out.push_back(static_cast<int>(i));
    }
    const auto byName=[&](int a,int b) { return snap.records[std::size_t(a)].name.compareNatural(snap.records[std::size_t(b)].name)<0; };
    std::vector<juce::int64> recent;
    if(sort==Sort::RecentlyUsed) { recent.resize(snap.records.size()); for(int i:out) recent[std::size_t(i)]=st.recentTime(q.type,snap.records[std::size_t(i)].id); }
    const auto key=[&](int i)->juce::int64 {
        const auto& r=snap.records[std::size_t(i)];
        switch(sort) {
            case Sort::Created: case Sort::RecentlyAdded: return r.created;
            case Sort::Modified: return r.modified;
            case Sort::RecentlyUsed: return recent[std::size_t(i)];
            default: return 0;
        }
    };
    const bool newestFirst=sort==Sort::RecentlyUsed || sort==Sort::RecentlyAdded;
    std::stable_sort(out.begin(),out.end(),[&](int a,int b) {
        if(sort==Sort::Author) {
            const int c=snap.records[std::size_t(a)].author.compareNatural(snap.records[std::size_t(b)].author);
            if(c!=0) return q.descending ? c>0 : c<0;
            return byName(a,b);
        }
        if(sort==Sort::Name) return q.descending ? byName(b,a) : byName(a,b);
        const auto ka=key(a),kb=key(b);
        if(ka!=kb) return (newestFirst!=q.descending) ? ka>kb : ka<kb;
        return byName(a,b);
    });
    return out;
}
Facets facetsFor(const Snapshot& snap,ContentType type) {
    std::map<juce::String,std::pair<juce::String,int>> cat,tag,auth;
    const auto add=[](auto& map,const juce::String& v) { if(v.isEmpty()) return; auto& e=map[v.toLowerCase()]; if(e.first.isEmpty()) e.first=v; ++e.second; };
    for(const auto& r:snap.records) {
        if(r.type!=type) continue;
        add(cat,r.category); add(auth,r.author);
        for(const auto& t:r.tags) add(tag,t);
    }
    Facets f;
    for(auto& [k,e]:cat) f.categories.push_back(e);
    for(auto& [k,e]:tag) f.tags.push_back(e);
    for(auto& [k,e]:auth) f.authors.push_back(e);
    return f;
}

// ---- library ---------------------------------------------------------------------
juce::File sidecarFor(const juce::File& wav) { return wav.getSiblingFile(wav.getFileName()+".json"); }

namespace {
class ScanThread final : public juce::Thread {
public:
    explicit ScanThread(std::function<void()> job):juce::Thread("Origami content index"),job_(std::move(job)) {}
    void run() override { job_(); }
private:
    std::function<void()> job_;
};
juce::int64 fileStamp(const juce::File& f) {
    auto t=f.getLastModificationTime().toMilliseconds();
    if(f.hasFileExtension(".wav") || f.hasFileExtension(".aif") || f.hasFileExtension(".aiff")) {
        const auto side=sidecarFor(f);
        if(side.existsAsFile()) t=std::max(t,side.getLastModificationTime().toMilliseconds());
    }
    return t;
}
bool writeTextAtomically(const juce::File& file,const juce::String& text) {
    file.getParentDirectory().createDirectory();
    juce::TemporaryFile temp(file);
    if(!temp.getFile().replaceWithText(text,false,false,"\n")) return false;
    return temp.overwriteTargetFileWithTemporary();
}
}

ContentLibrary::ContentLibrary(juce::File base):base_(std::move(base)),alive_(std::make_shared<std::atomic<bool>>(true)) {
    const auto stateFile=base_.getChildFile("Library.json");
    if(stateFile.existsAsFile()) state_.fromVar(juce::JSON::parse(stateFile.loadFileAsString()));
    loadIndex();
}
ContentLibrary::~ContentLibrary() {
    alive_->store(false);
    if(worker_) worker_->stopThread(10000);
}
juce::File ContentLibrary::defaultBase() {
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
        .getChildFile("Application Support").getChildFile("MCT Origami");
}

std::vector<ContentRecord> ContentLibrary::factoryRecords() {
    std::vector<ContentRecord> out;
    ContentRecord init; init.id=initPresetId; init.type=ContentType::Preset; init.origin=ContentOrigin::Factory;
    init.name="INIT"; init.author="MCT"; init.category="Init"; init.format="builtin";
    init.description="The default Origami patch: one oscillator, no modulation, neutral FX.";
    init.oscillators=-1; init.buildSearchText(); out.push_back(init);
    ContentRecord shapes; shapes.id=basicShapesId; shapes.type=ContentType::Wavetable; shapes.origin=ContentOrigin::Factory;
    shapes.name="BASIC SHAPES"; shapes.author="MCT"; shapes.category="Basic"; shapes.format="builtin";
    shapes.description="Sine, saw, square and triangle: Origami's built-in table.";
    shapes.frames=4; shapes.samplesPerFrame=wavetableFrameSamples; shapes.buildSearchText(); out.push_back(shapes);
    return out;
}

std::vector<ContentRecord> ContentLibrary::scan(const juce::File& base,const Snapshot* cached) {
    std::map<juce::String,const ContentRecord*> previous;
    if(cached) for(const auto& r:cached->records) if(r.file!=juce::File{}) previous[r.file.getFullPathName()]=&r;
    std::vector<ContentRecord> out;
    const auto reuse=[&](const juce::File& f,juce::int64 size,juce::int64 stamp)->bool {
        const auto it=previous.find(f.getFullPathName());
        if(it==previous.end() || it->second->fileSize!=size || it->second->fileTime!=stamp) return false;
        out.push_back(*it->second);
        return true;
    };
    // Presets
    for(const auto& f:base.getChildFile("Presets").findChildFiles(juce::File::findFiles,true,juce::String("*")+presetExtension)) {
        const auto size=f.getSize(),stamp=fileStamp(f);
        if(reuse(f,size,stamp)) continue;
        ContentRecord r; r.origin=ContentOrigin::User;
        if(!decodePresetFile(f.loadFileAsString(),r,nullptr)) continue; // malformed: not indexed
        if(r.origin!=ContentOrigin::User && r.origin!=ContentOrigin::Pack) r.origin=ContentOrigin::User;
        if(r.created<=0) r.created=f.getCreationTime().toMilliseconds();
        if(r.modified<=0) r.modified=f.getLastModificationTime().toMilliseconds();
        r.file=f; r.fileSize=size; r.fileTime=stamp;
        out.push_back(std::move(r));
    }
    // Wavetables: User/ and User/Imported/
    const auto tables=base.getChildFile("Wavetables");
    const auto imported=tables.getChildFile("Imported");
    for(const auto& f:tables.findChildFiles(juce::File::findFiles,true,"*.wav")) {
        const auto size=f.getSize(),stamp=fileStamp(f);
        if(reuse(f,size,stamp)) continue;
        int frames=0;
        if(probeWavetableFile(f,frames)!=ReadResult::Ok) continue;
        ContentRecord r; r.type=ContentType::Wavetable;
        r.origin=f.isAChildOf(imported) ? ContentOrigin::Imported : ContentOrigin::User;
        const auto side=sidecarFor(f);
        bool meta=false;
        if(side.existsAsFile()) meta=metadataToRecord(juce::JSON::parse(side.loadFileAsString()),ContentType::Wavetable,r);
        if(!meta) {
            // No (valid) sidecar: identity from the library-relative path.
            r.id="file.wavetable."+juce::String::toHexString(f.getRelativePathFrom(tables).toLowerCase().hashCode64());
            r.name=f.getFileNameWithoutExtension();
        }
        if(r.origin==ContentOrigin::Factory) r.origin=ContentOrigin::User;
        r.frames=frames; r.samplesPerFrame=wavetableFrameSamples;
        if(r.created<=0) r.created=f.getCreationTime().toMilliseconds();
        if(r.modified<=0) r.modified=f.getLastModificationTime().toMilliseconds();
        r.file=f; r.fileSize=size; r.fileTime=stamp;
        r.buildSearchText();
        out.push_back(std::move(r));
    }
    // A duplicated file (copied in Finder with its sidecar) keeps the first id.
    std::set<juce::String> seen;
    for(auto& r:out) {
        if(seen.count(r.id)) r.id+=".dup."+juce::String::toHexString(r.file.getFullPathName().hashCode64());
        seen.insert(r.id);
    }
    return out;
}

void ContentLibrary::install(std::vector<ContentRecord> records) {
    auto snap=std::make_shared<Snapshot>();
    snap->records=factoryRecords();
    snap->records.insert(snap->records.end(),std::make_move_iterator(records.begin()),std::make_move_iterator(records.end()));
    snap->generation=nextGeneration_++;
    snapshot_=std::move(snap);
    if(onChanged) onChanged();
}

void ContentLibrary::rescanNow() {
    install(scan(base_,snapshot_.get()));
    writeIndex();
}

void ContentLibrary::rescanAsync() {
    if(scanning_.exchange(true)) return;
    if(worker_) worker_->stopThread(10000);
    const auto cached=snapshot_;
    const auto base=base_;
    const auto mutationsAtStart=mutations_.load();
    auto alive=alive_;
    worker_=std::make_unique<ScanThread>([this,cached,base,mutationsAtStart,alive] {
        auto records=scan(base,cached.get());
        juce::MessageManager::callAsync([this,alive,records=std::move(records),mutationsAtStart]() mutable {
            if(!alive->load()) return;
            scanning_.store(false);
            if(mutations_.load()!=mutationsAtStart) { rescanAsync(); return; } // an edit raced the scan
            install(std::move(records));
            writeIndex();
        });
    });
    worker_->startThread(juce::Thread::Priority::low);
}

const ContentRecord* ContentLibrary::find(const juce::String& id) const {
    if(!snapshot_) return nullptr;
    const auto i=snapshot_->indexOf(id);
    return i>=0 ? &snapshot_->records[std::size_t(i)] : nullptr;
}

void ContentLibrary::replaceRecord(const ContentRecord& record) {
    ++mutations_;
    std::vector<ContentRecord> records;
    if(snapshot_) for(const auto& r:snapshot_->records) if(r.origin!=ContentOrigin::Factory && r.id!=record.id) records.push_back(r);
    records.push_back(record);
    install(std::move(records));
    writeIndex();
}
void ContentLibrary::dropRecord(const juce::String& id) {
    ++mutations_;
    std::vector<ContentRecord> records;
    if(snapshot_) for(const auto& r:snapshot_->records) if(r.origin!=ContentOrigin::Factory && r.id!=id) records.push_back(r);
    install(std::move(records));
    writeIndex();
}

void ContentLibrary::writeIndex() const {
    juce::Array<juce::var> list;
    if(snapshot_) for(const auto& r:snapshot_->records) {
        if(r.origin==ContentOrigin::Factory) continue;
        auto v=recordToMetadata(r);
        auto* o=v.getDynamicObject();
        o->setProperty("file",r.file.getFullPathName());
        o->setProperty("fileSize",r.fileSize);
        o->setProperty("fileTime",r.fileTime);
        o->setProperty("format",r.format);
        list.add(v);
    }
    auto* root=new juce::DynamicObject();
    root->setProperty("schema",metadataSchema);
    root->setProperty("records",list);
    writeTextAtomically(base_.getChildFile("Index.json"),juce::JSON::toString(juce::var(root),true));
}
void ContentLibrary::loadIndex() {
    std::vector<ContentRecord> records;
    const auto file=base_.getChildFile("Index.json");
    const auto parsed=file.existsAsFile() ? juce::JSON::parse(file.loadFileAsString()) : juce::var();
    const auto recordsVar=parsed.getProperty("records",{});
    if(const auto* list=recordsVar.getArray())
            for(const auto& v:*list) {
                const auto type=v.getProperty("type",{}).toString()=="wavetable" ? ContentType::Wavetable : ContentType::Preset;
                ContentRecord r;
                if(!metadataToRecord(v,type,r) || r.origin==ContentOrigin::Factory) continue;
                r.file=juce::File(v.getProperty("file",{}).toString());
                r.fileSize=static_cast<juce::int64>(v.getProperty("fileSize",0));
                r.fileTime=static_cast<juce::int64>(v.getProperty("fileTime",0));
                r.format=v.getProperty("format",{}).toString();
                records.push_back(std::move(r));
            }
    install(std::move(records));
}

void ContentLibrary::saveState() {
    writeTextAtomically(base_.getChildFile("Library.json"),juce::JSON::toString(state_.toVar(),true));
}
void ContentLibrary::setFavorite(const juce::String& id,bool favorite) {
    if(favorite) state_.favorites.insert(id); else state_.favorites.erase(id);
    saveState();
    if(onChanged) onChanged();
}
void ContentLibrary::markUsed(ContentType type,const juce::String& id) {
    state_.touchRecent(type,id,nowMs());
    saveState();
}

juce::File ContentLibrary::uniqueFile(const juce::File& directory,const juce::String& name,const juce::String& extension) const {
    auto stem=juce::File::createLegalFileName(name.trim()).trim();
    if(stem.isEmpty()) stem="Untitled";
    auto f=directory.getChildFile(stem+extension);
    for(int n=2;f.exists();++n) f=directory.getChildFile(stem+" "+juce::String(n)+extension);
    return f;
}

juce::Result ContentLibrary::savePreset(ContentRecord meta,const juce::MemoryBlock& state,ContentRecord& saved) {
    meta.name=meta.name.trim().substring(0,120);
    if(meta.name.isEmpty()) return juce::Result::fail("A preset needs a name");
    if(state.getSize()<12) return juce::Result::fail("Empty state");
    const auto now=nowMs();
    const auto* existing=meta.id.isNotEmpty() ? find(meta.id) : nullptr;
    juce::File target;
    if(existing!=nullptr && !existing->isReadOnly() && existing->type==ContentType::Preset && existing->file.existsAsFile()) {
        // Overwrite the user preset in place (same identity); a new name renames the file.
        meta.created=existing->created>0 ? existing->created : now;
        target=existing->file;
        if(!meta.name.equalsIgnoreCase(existing->name)) target=uniqueFile(presetsDirectory(),meta.name,presetExtension);
    } else {
        meta.id="user.preset."+juce::Uuid().toDashedString();
        meta.created=now;
        target=uniqueFile(presetsDirectory(),meta.name,presetExtension);
    }
    meta.type=ContentType::Preset; meta.origin=ContentOrigin::User; meta.modified=now; meta.format="origami-preset";
    if(!writeTextAtomically(target,encodePresetFile(meta,state))) return juce::Result::fail("Could not write "+target.getFullPathName());
    if(existing!=nullptr && existing->file.existsAsFile() && existing->file!=target && !existing->isReadOnly()) existing->file.deleteFile();
    meta.file=target; meta.fileSize=target.getSize(); meta.fileTime=fileStamp(target);
    meta.buildSearchText();
    saved=meta;
    replaceRecord(meta);
    return juce::Result::ok();
}

juce::Result ContentLibrary::importWavetable(const juce::File& source,ContentRecord& out,bool& duplicate) {
    duplicate=false;
    WavetableData data; juce::String sourceFormat;
    const auto result=readWavetableFile(source,data,&sourceFormat);
    if(result!=ReadResult::Ok) return juce::Result::fail(describe(result));
    const auto hash=hashFrames(data.samples);
    // Deterministic duplicate policy: identical canonical frames are the same
    // resource, whatever the source file was called.
    if(snapshot_) for(const auto& r:snapshot_->records)
        if(r.type==ContentType::Wavetable && r.contentHash==hash && !r.isReadOnly() && r.file.existsAsFile()) { out=r; duplicate=true; return juce::Result::ok(); }
    const auto dir=importedWavetablesDirectory();
    dir.createDirectory();
    const auto target=uniqueFile(dir,source.getFileNameWithoutExtension(),".wav");
    if(!writeWavetableWav(target,data)) return juce::Result::fail("Could not write "+target.getFullPathName());
    ContentRecord r; r.type=ContentType::Wavetable; r.origin=ContentOrigin::Imported;
    r.id="user.wavetable."+juce::Uuid().toDashedString();
    r.name=target.getFileNameWithoutExtension(); r.author=state_.author;
    r.created=r.modified=nowMs(); r.frames=data.frames(); r.samplesPerFrame=wavetableFrameSamples;
    r.contentHash=hash; r.format=sourceFormat;
    r.description="Imported from "+source.getFileName();
    if(!writeTextAtomically(sidecarFor(target),juce::JSON::toString(recordToMetadata(r),true))) {
        target.deleteFile(); return juce::Result::fail("Could not write the metadata");
    }
    r.file=target; r.fileSize=target.getSize(); r.fileTime=fileStamp(target);
    r.buildSearchText();
    out=r;
    replaceRecord(r);
    return juce::Result::ok();
}

juce::Result ContentLibrary::updateMetadata(const ContentRecord& edited) {
    const auto* existing=find(edited.id);
    if(existing==nullptr) return juce::Result::fail("Unknown content");
    if(existing->isReadOnly()) return juce::Result::fail("Factory content is read-only");
    auto r=*existing;
    r.author=edited.author.substring(0,80); r.category=edited.category.substring(0,60);
    r.tags=edited.tags; r.description=edited.description.substring(0,2000);
    r.modified=nowMs();
    if(r.type==ContentType::Preset) {
        ContentRecord meta; juce::MemoryBlock state;
        if(!decodePresetFile(r.file.loadFileAsString(),meta,&state)) return juce::Result::fail("Unreadable preset");
        if(!writeTextAtomically(r.file,encodePresetFile(r,state))) return juce::Result::fail("Could not write the preset");
    } else if(!writeTextAtomically(sidecarFor(r.file),juce::JSON::toString(recordToMetadata(r),true)))
        return juce::Result::fail("Could not write the metadata");
    r.fileSize=r.file.getSize(); r.fileTime=fileStamp(r.file);
    r.buildSearchText();
    replaceRecord(r);
    return juce::Result::ok();
}

juce::Result ContentLibrary::rename(const juce::String& id,const juce::String& newName) {
    const auto* existing=find(id);
    if(existing==nullptr) return juce::Result::fail("Unknown content");
    if(existing->isReadOnly()) return juce::Result::fail("Factory content cannot be renamed");
    const auto name=newName.trim().substring(0,120);
    if(name.isEmpty()) return juce::Result::fail("Empty name");
    auto r=*existing; r.name=name; r.modified=nowMs();
    if(r.type==ContentType::Preset) {
        ContentRecord meta; juce::MemoryBlock state;
        if(!decodePresetFile(r.file.loadFileAsString(),meta,&state)) return juce::Result::fail("Unreadable preset");
        const auto target=uniqueFile(r.file.getParentDirectory(),name,presetExtension);
        if(!writeTextAtomically(target,encodePresetFile(r,state))) return juce::Result::fail("Could not write the preset");
        r.file.deleteFile(); r.file=target;
    } else {
        const auto oldSide=sidecarFor(r.file);
        const auto target=uniqueFile(r.file.getParentDirectory(),name,".wav");
        if(!r.file.moveFileTo(target)) return juce::Result::fail("Could not rename the file");
        oldSide.deleteFile();
        r.file=target; // the sidecar keeps the identity (written even if there was none)
        if(!writeTextAtomically(sidecarFor(target),juce::JSON::toString(recordToMetadata(r),true))) return juce::Result::fail("Could not write the metadata");
    }
    r.fileSize=r.file.getSize(); r.fileTime=fileStamp(r.file);
    r.buildSearchText();
    replaceRecord(r);
    return juce::Result::ok();
}

juce::Result ContentLibrary::remove(const juce::String& id) {
    const auto* existing=find(id);
    if(existing==nullptr) return juce::Result::fail("Unknown content");
    if(existing->isReadOnly()) return juce::Result::fail("Factory content cannot be deleted");
    const auto file=existing->file;
    if(file.existsAsFile() && !file.moveToTrash() && !file.deleteFile()) return juce::Result::fail("Could not delete the file");
    if(existing->type==ContentType::Wavetable) { const auto side=sidecarFor(file); if(side.existsAsFile() && !side.moveToTrash()) side.deleteFile(); }
    state_.favorites.erase(id);
    for(auto& list:state_.recents) list.erase(std::remove_if(list.begin(),list.end(),[&](const auto& e){ return e.first==id; }),list.end());
    saveState();
    dropRecord(id);
    return juce::Result::ok();
}

bool ContentLibrary::loadPresetState(const ContentRecord& r,juce::MemoryBlock& state) const {
    if(r.type!=ContentType::Preset || r.format=="builtin" || !r.file.existsAsFile()) return false;
    ContentRecord meta;
    return decodePresetFile(r.file.loadFileAsString(),meta,&state);
}
bool ContentLibrary::loadWavetable(const ContentRecord& r,WavetableData& data) const {
    if(r.type!=ContentType::Wavetable) return false;
    if(r.id==basicShapesId) { data=basicShapes(); return true; }
    if(!r.file.existsAsFile() || readWavetableFile(r.file,data)!=ReadResult::Ok) return false;
    data.name=r.name;
    return true;
}

}
