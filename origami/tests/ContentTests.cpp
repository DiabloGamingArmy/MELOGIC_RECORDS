// mct-origami-content-browser: content model / library / wavetable I/O tests.
#include "plugin/content/ContentLibrary.h"
#include <JuceHeader.h>
#include <chrono>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace mct::origami::content;
namespace {
const char* content_origin_name(const ContentRecord& r) { return originName(r.origin); }
unsigned checks=0;
void check(bool ok,const char* label) { ++checks; if(!ok) throw std::runtime_error(label); }
double msSince(std::chrono::steady_clock::time_point t) { return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-t).count(); }
juce::File freshBase(const char* name) {
    auto dir=juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(juce::String("origami-content-")+name+"-"+juce::String(juce::Random::getSystemRandom().nextInt64()));
    dir.deleteRecursively(); dir.createDirectory();
    return dir;
}
WavetableData table(int frames,float seed) {
    WavetableData d; d.name="T";
    d.samples.resize(std::size_t(frames)*wavetableFrameSamples);
    for(std::size_t i=0;i<d.samples.size();++i) d.samples[i]=0.8f*std::sin(float(i)*0.0031f*(seed+1.0f))*float((i%wavetableFrameSamples)+1)/float(wavetableFrameSamples);
    return d;
}
bool writeRawWav(const juce::File& f,const std::vector<float>& samples,int channels,int bits) {
    juce::AudioBuffer<float> b(channels,int(samples.size()/std::size_t(channels)));
    for(int c=0;c<channels;++c) for(int i=0;i<b.getNumSamples();++i) b.setSample(c,i,samples[std::size_t(i*channels+c)]);
    f.deleteFile();
    std::unique_ptr<juce::OutputStream> stream=f.createOutputStream();
    if(!stream) return false;
    juce::WavAudioFormat format;
    auto options=juce::AudioFormatWriterOptions{}.withSampleRate(44100.0).withNumChannels(channels).withBitsPerSample(bits);
    if(bits==32) options=options.withSampleFormat(juce::AudioFormatWriterOptions::SampleFormat::floatingPoint);
    auto w=format.createWriterFor(stream,options);
    return w && w->writeFromAudioSampleBuffer(b,0,b.getNumSamples());
}
ContentRecord rec(const juce::String& id,const juce::String& name,ContentType t=ContentType::Preset) {
    ContentRecord r; r.id=id; r.name=name; r.type=t; r.origin=ContentOrigin::User; r.buildSearchText(); return r;
}

void metadataTests() {
    ContentRecord r=rec("user.preset.1","Murphy Bass");
    r.author="Gino"; r.category="Bass"; r.tags={"dark","mono"}; r.description="Wide metallic lead."; r.created=1700000000000; r.modified=1700000500000;
    r.oscillators=2; r.macros=4; r.nodes=3; r.fxModules=1; r.stateVersion=34;
    ContentRecord back;
    check(metadataToRecord(recordToMetadata(r),ContentType::Preset,back),"metadata encode / decode");
    check(back.id==r.id && back.name==r.name && back.author=="Gino" && back.category=="Bass" && back.tags==r.tags && back.description==r.description
          && back.created==r.created && back.modified==r.modified && back.macros==4 && back.fxModules==1,"metadata round trip is exact");
    auto withUnknown=recordToMetadata(r);
    withUnknown.getDynamicObject()->setProperty("futureField",juce::var("x")); withUnknown.getDynamicObject()->setProperty("schema",7);
    check(metadataToRecord(withUnknown,ContentType::Preset,back) && back.name==r.name,"unknown fields and a newer schema are ignored, known fields kept");
    for(const char* bad:{"[]","\"text\"","{}","{\"schema\":1,\"name\":\"x\"}","{\"schema\":1,\"id\":\"a\"}","{\"id\":\"a\",\"name\":\"b\"}","{\"schema\":1,\"id\":\"a\",\"name\":\"b\",\"type\":\"wavetable\"}"})
        check(!metadataToRecord(juce::JSON::parse(bad),ContentType::Preset,back),"malformed metadata rejected");
    juce::MemoryBlock state; state.append("ORIGAMI-STATE-BYTES-000",23);
    const auto text=encodePresetFile(r,state);
    ContentRecord meta; juce::MemoryBlock decoded;
    check(decodePresetFile(text,meta,&decoded) && decoded==state && meta.name==r.name,"preset file: metadata + the unchanged state blob");
    check(!decodePresetFile("{\"format\":\"mct.origami.preset\",\"schema\":1,\"id\":\"a\",\"name\":\"b\"}",meta,&decoded),"preset file without state rejected");
    check(!decodePresetFile(text.replace("mct.origami.preset","other"),meta,&decoded),"wrong format tag rejected");
    check(!decodePresetFile(text.substring(0,text.length()/2),meta,&decoded),"truncated preset file rejected");
    // Metadata never touches the state: favourite / description edits keep the blob identical.
    auto edited=r; edited.description="Different words"; edited.tags.add("new");
    check(decodePresetFile(encodePresetFile(edited,state),meta,&decoded) && decoded==state,"metadata edits never change the DSP state");
}

void wavetableIoTests() {
    const auto dir=freshBase("wav");
    for(int frames:{1,4,64,256}) {
        const auto t=table(frames,float(frames));
        const auto f=dir.getChildFile("t"+juce::String(frames)+".wav");
        check(writeWavetableWav(f,t),"export writes a 32-bit float WAV");
        WavetableData back; juce::String fmt;
        check(readWavetableFile(f,back,&fmt)==ReadResult::Ok && back.samples==t.samples,"export -> import round trip is bit-exact");
        check(back.frames()==frames && fmt.contains("32-bit float"),"frame count and source format");
        int probed=0; check(probeWavetableFile(f,probed)==ReadResult::Ok && probed==frames,"header probe counts frames");
    }
    const auto f=dir.getChildFile("bad.wav");
    check(writeRawWav(f,std::vector<float>(3000,0.5f),1,16) && readWavetableFile(f,*std::make_unique<WavetableData>())==ReadResult::BadLength,"a length that is not N x 2048 is rejected");
    check(writeRawWav(f,std::vector<float>(2048*257,0.5f),1,16) && readWavetableFile(f,*std::make_unique<WavetableData>())==ReadResult::TooManyFrames,"more than 256 frames rejected");
    check(writeRawWav(f,std::vector<float>(2048,0.0f),1,16) && readWavetableFile(f,*std::make_unique<WavetableData>())==ReadResult::Silent,"silent table rejected");
    std::vector<float> nan(2048,0.25f); nan[100]=std::numeric_limits<float>::quiet_NaN();
    check(writeRawWav(f,nan,1,32) && readWavetableFile(f,*std::make_unique<WavetableData>())==ReadResult::NonFinite,"NaN rejected");
    nan[100]=std::numeric_limits<float>::infinity();
    check(writeRawWav(f,nan,1,32) && readWavetableFile(f,*std::make_unique<WavetableData>())==ReadResult::NonFinite,"Inf rejected");
    // Truncated file: header claims more data than present.
    check(writeRawWav(f,std::vector<float>(2048*4,0.5f),1,16),"write a 4-frame table");
    {
        juce::MemoryBlock all; f.loadFileAsData(all);
        f.replaceWithData(all.getData(),all.getSize()/2);
        WavetableData d; const auto r=readWavetableFile(f,d);
        check(r!=ReadResult::Ok || d.frames()<4,"a truncated WAV is rejected or only its complete frames read");
    }
    f.replaceWithText("not audio at all");
    check(readWavetableFile(f,*std::make_unique<WavetableData>())==ReadResult::Unreadable,"a non-audio file is rejected");
    check(f.withFileExtension(".txt").replaceWithText("x") && readWavetableFile(f.withFileExtension(".txt"),*std::make_unique<WavetableData>())==ReadResult::Unreadable,"an unsupported format is rejected");
    // Stereo: the mean of the channels; a peak above 1 is scaled to 1 (documented, nothing else changes).
    std::vector<float> st(2048*2*2);
    for(std::size_t i=0;i<st.size()/2;++i) { st[2*i]=0.5f; st[2*i+1]=-0.1f; }
    WavetableData d;
    check(writeRawWav(f,st,2,32) && readWavetableFile(f,d)==ReadResult::Ok && std::abs(d.samples[7]-0.2f)<1e-6f && d.frames()==2,"stereo is mixed to mono");
    std::vector<float> loud(2048,0.0f); loud[10]=2.0f; loud[11]=-1.0f;
    check(writeRawWav(f,loud,1,32) && readWavetableFile(f,d)==ReadResult::Ok && d.samples[10]==1.0f && d.samples[11]==-0.5f,"a peak above 1 is scaled down to 1");
    check(basicShapes().frames()==4 && basicShapes().valid(),"factory BASIC SHAPES");
    check(hashFrames(table(2,1).samples).length()==16 && hashFrames(table(2,1).samples)==hashFrames(table(2,1).samples) && hashFrames(table(2,1).samples)!=hashFrames(table(2,2).samples),"content hash is deterministic and distinguishing");
    dir.deleteRecursively();
}

void libraryTests() {
    const auto base=freshBase("lib");
    juce::MemoryBlock state; state.append("ORIGAMI-STATE-0123456789",24);
    {
        ContentLibrary lib(base);
        check(lib.find(ContentLibrary::initPresetId)!=nullptr && lib.find(ContentLibrary::basicShapesId)!=nullptr,"factory INIT and BASIC SHAPES are always indexed");
        check(lib.find(ContentLibrary::initPresetId)->isReadOnly(),"factory content is read-only");
        check(lib.rename(ContentLibrary::initPresetId,"X").failed() && lib.remove(ContentLibrary::basicShapesId).failed(),"factory content cannot be renamed or deleted");
        ContentRecord meta=rec({},"Murphy Bass"); meta.author="Gino"; meta.category="Bass"; meta.tags={"dark"}; meta.description="Low and wide";
        ContentRecord saved;
        check(lib.savePreset(meta,state,saved).wasOk() && saved.id.startsWith("user.preset.") && saved.file.existsAsFile(),"user preset saved with a stable id");
        check(saved.created>0 && saved.modified>=saved.created && saved.author=="Gino","created / modified / author stored");
        const auto id=saved.id;
        check(lib.rename(id,"Murphy Sub").wasOk() && lib.find(id)!=nullptr && lib.find(id)->name=="Murphy Sub" && lib.find(id)->file.getFileName()=="Murphy Sub.origami","rename keeps the id, renames the file");
        lib.setFavorite(id,true); lib.markUsed(ContentType::Preset,id);
        juce::MemoryBlock loaded;
        check(lib.loadPresetState(*lib.find(id),loaded) && loaded==state,"load returns the exact state");
        // Replace in place (same identity) vs save as new.
        auto again=*lib.find(id); again.description="Updated";
        ContentRecord replaced; check(lib.savePreset(again,state,replaced).wasOk() && replaced.id==id && replaced.created==saved.created,"SAVE over a user preset keeps id and created date");
        auto copy=*lib.find(id); copy.id={};
        ContentRecord second; check(lib.savePreset(copy,state,second).wasOk() && second.id!=id && second.file!=lib.find(id)->file,"SAVE AS NEW creates a new identity and file");
        // Factory edited and saved -> a user resource; the factory stays.
        auto fromFactory=*lib.find(ContentLibrary::initPresetId);
        ContentRecord user; check(lib.savePreset(fromFactory,state,user).wasOk() && user.origin==ContentOrigin::User && user.id!=ContentLibrary::initPresetId,"saving a factory preset creates a user preset");
        // Wavetable import: validated, copied, duplicate by content.
        const auto src=base.getSiblingFile(base.getFileName()+"-src.wav");
        check(writeWavetableWav(src,table(8,3)),"source table");
        ContentRecord imp; bool dup=true;
        check(lib.importWavetable(src,imp,dup).wasOk() && !dup && imp.origin==ContentOrigin::Imported && imp.frames==8 && imp.file.isAChildOf(lib.importedWavetablesDirectory()),"import copies into the Imported library");
        src.deleteFile(); // the library never depends on the source file
        ContentRecord dupRec; check(writeWavetableWav(src.getSiblingFile("other-name.wav"),table(8,3)) && lib.importWavetable(src.getSiblingFile("other-name.wav"),dupRec,dup).wasOk() && dup && dupRec.id==imp.id,"a duplicate import (same frames, any name) reuses the existing resource");
        WavetableData w; check(lib.loadWavetable(*lib.find(imp.id),w) && w.samples==table(8,3).samples,"imported table loads after its source is gone");
        check(lib.rename(imp.id,"Metal Sweep").wasOk() && lib.find(imp.id)->name=="Metal Sweep" && sidecarFor(lib.find(imp.id)->file).existsAsFile(),"wavetable rename keeps id (sidecar)");
        lib.setFavorite(imp.id,true); lib.markUsed(ContentType::Wavetable,imp.id);
        check(lib.remove(second.id).wasOk() && lib.find(second.id)==nullptr,"delete removes a user preset");
    }
    {
        // Persistence: a new library instance (next launch) has the same index and state.
        ContentLibrary lib(base);
        auto snap=lib.snapshot();
        int presets=0,tables=0; for(const auto& r:snap->records) { presets+=r.type==ContentType::Preset && r.origin!=ContentOrigin::Factory; tables+=r.type==ContentType::Wavetable && r.origin!=ContentOrigin::Factory; }
        if(!(presets==2 && tables==1)) for(const auto& r:snap->records) std::cerr<<"  "<<r.id<<" "<<r.name<<" "<<content_origin_name(r)<<"\n";
        check(presets==2 && tables==1,"the cached index restores the library without scanning");
        const ContentRecord* murphy=nullptr; for(const auto& r:snap->records) if(r.name=="Murphy Sub") murphy=&r;
        check(murphy!=nullptr && lib.isFavorite(murphy->id) && lib.state().recentTime(ContentType::Preset,murphy->id)>0,"favorites and recents persist");
        check(lib.state().recents[0].size()<=LibraryState::maxRecents,"recents are bounded");
        // Invalidation: add / modify / delete files outside Origami, then rescan.
        juce::MemoryBlock st; st.append("ORIGAMI-STATE-ABCDEFGHIJ",24);
        ContentRecord ext=rec("user.preset.external","Outside");
        lib.presetsDirectory().getChildFile("Outside.origami").replaceWithText(encodePresetFile(ext,st));
        lib.presetsDirectory().getChildFile("Broken.origami").replaceWithText("{not json");
        check(writeWavetableWav(lib.wavetablesDirectory().getChildFile("Loose.wav"),table(2,5)),"a loose wav dropped in the folder");
        const auto murphyId=murphy->id; const auto murphyFile=murphy->file;
        murphyFile.deleteFile();
        lib.rescanNow();
        check(lib.find("user.preset.external")!=nullptr,"a new file is indexed");
        check(lib.find(murphyId)==nullptr,"a deleted file leaves the index");
        bool loose=false; for(const auto& r:lib.snapshot()->records) loose|=r.name=="Loose" && r.origin==ContentOrigin::User && r.frames==2;
        check(loose,"a wav without metadata is indexed with a path identity");
        bool broken=false; for(const auto& r:lib.snapshot()->records) broken|=r.name.contains("Broken");
        check(!broken,"a malformed preset is skipped, not indexed");
        ext.description="Changed outside";
        juce::Thread::sleep(1100); // file times have 1 s resolution on some volumes
        lib.presetsDirectory().getChildFile("Outside.origami").replaceWithText(encodePresetFile(ext,st));
        lib.rescanNow();
        check(lib.find("user.preset.external")->description=="Changed outside","a modified file is re-parsed");
    }
    base.deleteRecursively();
}

void queryTests() {
    Snapshot snap; LibraryState st;
    const auto add=[&](const juce::String& id,const juce::String& name,const juce::String& author,const juce::String& cat,juce::StringArray tags,juce::int64 created,ContentOrigin o) {
        auto r=rec(id,name); r.author=author; r.category=cat; r.tags=tags; r.created=created; r.modified=created+10; r.origin=o; r.buildSearchText(); snap.records.push_back(r);
    };
    const juce::int64 now=1800000000000;
    add("a","Alpha Lead","Gino","Lead",{"bright"},now-1000,ContentOrigin::Factory);
    add("b","beta bass","Ann","Bass",{"dark","mono"},now-5LL*24*3600*1000,ContentOrigin::User);
    add("c","Gamma Pad","Gino","Pad",{"wide"},now-90LL*24*3600*1000,ContentOrigin::User);
    add("d","Metallic Lead","Zed","Lead",{"metallic","bright"},now-2000,ContentOrigin::User);
    auto w=rec("w","Wave",ContentType::Wavetable); snap.records.push_back(w);
    Query q; q.now=now;
    const auto names=[&](const std::vector<int>& idx){ juce::StringArray s; for(int i:idx) s.add(snap.records[std::size_t(i)].id); return s.joinIntoString(","); };
    check(names(runQuery(snap,q,st))=="a,b,c,d","natural name sort, case-insensitive, type filtered");
    q.descending=true; check(names(runQuery(snap,q,st))=="d,c,b,a","descending"); q.descending=false;
    q.text="lead"; check(names(runQuery(snap,q,st))=="a,d","search matches name / category");
    q.text="gino pad"; check(names(runQuery(snap,q,st))=="c","every token must match (author + name)");
    q.text="METALLIC"; check(names(runQuery(snap,q,st))=="d","search is case-insensitive over tags");
    q.text={}; q.scope="factory"; check(names(runQuery(snap,q,st))=="a","FACTORY scope");
    q.scope="user"; check(names(runQuery(snap,q,st))=="b,c,d","USER scope");
    st.favorites={"c"}; q.scope="favorites"; check(names(runQuery(snap,q,st))=="c","FAVORITES scope");
    st.touchRecent(ContentType::Preset,"b",10); st.touchRecent(ContentType::Preset,"d",20);
    q.scope="recent"; check(names(runQuery(snap,q,st))=="d,b","RECENTLY USED, newest first");
    q.scope="added"; check(names(runQuery(snap,q,st))=="d,b","RECENTLY ADDED: user content of the last 30 days, newest first");
    q.scope="all"; q.facetKind="category"; q.facetValue="lead"; check(names(runQuery(snap,q,st))=="a,d","category facet");
    q.facetKind="tag"; q.facetValue="Bright"; check(names(runQuery(snap,q,st))=="a,d","tag facet");
    q.facetKind="author"; q.facetValue="gino"; check(names(runQuery(snap,q,st))=="a,c","author facet");
    q.facetKind={}; q.sort=Sort::Author; check(names(runQuery(snap,q,st))=="b,a,c,d","author sort, then name");
    q.sort=Sort::Created; check(names(runQuery(snap,q,st))=="c,b,d,a","created ascending");
    q.sort=Sort::Modified; q.descending=true; check(names(runQuery(snap,q,st))=="a,d,b,c","modified descending");
    const auto f=facetsFor(snap,ContentType::Preset);
    check(f.categories.size()==3 && f.tags.size()==5 && f.authors.size()==3,"facets derived from the index");
    for(int i=0;i<200;++i) st.touchRecent(ContentType::Preset,"x"+juce::String(i),i);
    check(st.recents[0].size()==LibraryState::maxRecents,"recents bounded to 50");
    LibraryState back; back.fromVar(juce::JSON::parse(juce::JSON::toString(st.toVar())));
    check(back.favorites==st.favorites && back.recents[0]==st.recents[0],"library state round trip");
    back.fromVar(juce::JSON::parse("{\"favorites\":5,\"recents\":[],\"browser\":\"x\"}"));
    check(back.favorites.empty(),"malformed library state degrades to defaults");
}

void scaleTests() {
    // Synthetic libraries: search / filter / sort timings and index memory.
    const char* words[]{"bass","lead","pad","pluck","keys","metallic","vocal","dark","bright","wide","growl","glass","noise","sub","arp"};
    for(int n:{100,1000,10000}) {
        Snapshot snap; LibraryState st;
        juce::Random rng(n);
        for(int i=0;i<n;++i) {
            auto r=rec("user.preset."+juce::String(i),juce::String(words[rng.nextInt(15)])+" "+juce::String(words[rng.nextInt(15)])+" "+juce::String(i));
            r.author=juce::String("Author ")+juce::String(rng.nextInt(40)); r.category=words[rng.nextInt(5)];
            r.tags={words[rng.nextInt(15)],words[rng.nextInt(15)]}; r.description="Synthetic description "+juce::String(i)+" "+words[rng.nextInt(15)];
            r.created=r.modified=1700000000000+i; r.buildSearchText();
            snap.records.push_back(std::move(r));
        }
        Query q;
        auto t=std::chrono::steady_clock::now(); auto all=runQuery(snap,q,st); const double sortName=msSince(t);
        q.text="metallic"; t=std::chrono::steady_clock::now(); auto hit=runQuery(snap,q,st); const double search=msSince(t);
        q.text="met"; t=std::chrono::steady_clock::now(); runQuery(snap,q,st); const double prefix=msSince(t);
        q.text={}; q.facetKind="category"; q.facetValue="bass"; t=std::chrono::steady_clock::now(); auto filtered=runQuery(snap,q,st); const double filter=msSince(t);
        q.facetKind={}; q.sort=Sort::Modified; q.descending=true; t=std::chrono::steady_clock::now(); runQuery(snap,q,st); const double sortDate=msSince(t);
        t=std::chrono::steady_clock::now(); facetsFor(snap,ContentType::Preset); const double facets=msSince(t);
        std::size_t bytes=sizeof(Snapshot)+snap.records.capacity()*sizeof(ContentRecord);
        for(const auto& r:snap.records) bytes+=std::size_t(r.name.getNumBytesAsUTF8()+r.author.getNumBytesAsUTF8()+r.category.getNumBytesAsUTF8()+r.description.getNumBytesAsUTF8()+r.searchText.getNumBytesAsUTF8()+r.id.getNumBytesAsUTF8())+r.tags.size()*24+6*24;
        std::cout<<"[content scale] "<<n<<" records: sort(name) "<<sortName<<" ms, search \"metallic\" "<<search<<" ms ("<<hit.size()<<"), search \"met\" "<<prefix
                 <<" ms, filter "<<filter<<" ms ("<<filtered.size()<<"), sort(date) "<<sortDate<<" ms, facets "<<facets<<" ms, index ~"<<(bytes/1024)<<" KB\n";
        check(all.size()==std::size_t(n),"all records listed");
        check(search<(n>=10000 ? 60.0 : 15.0),"search stays interactive");
    }
    // Index persistence at 10 000 records: cold load of the cached index.
    const auto base=freshBase("scale");
    {
        juce::Array<juce::var> list;
        for(int i=0;i<10000;++i) {
            auto r=rec("user.preset."+juce::String(i),"Preset "+juce::String(i)); r.description="Synthetic"; r.created=r.modified=1700000000000;
            auto v=recordToMetadata(r); v.getDynamicObject()->setProperty("file",base.getChildFile("Presets/P"+juce::String(i)+".origami").getFullPathName());
            list.add(v);
        }
        auto* root=new juce::DynamicObject(); root->setProperty("schema",1); root->setProperty("records",list);
        base.getChildFile("Index.json").replaceWithText(juce::JSON::toString(juce::var(root)));
    }
    auto t=std::chrono::steady_clock::now();
    ContentLibrary lib(base);
    const double cold=msSince(t);
    std::cout<<"[content scale] cached index of 10000 records loaded in "<<cold<<" ms\n";
    check(lib.snapshot()->records.size()==10002,"10 000 cached records + 2 factory");
    t=std::chrono::steady_clock::now(); lib.rescanNow(); const double rescan=msSince(t);
    std::cout<<"[content scale] rescan of a folder whose files are gone: "<<rescan<<" ms\n";
    check(lib.snapshot()->records.size()==2,"files missing on disk leave the index on rescan");
    base.deleteRecursively();
    // Cold scan of real files (1 000 presets).
    const auto real=freshBase("cold");
    juce::MemoryBlock st; st.append("ORIGAMI-STATE-0123456789",24);
    for(int i=0;i<1000;++i) { auto r=rec("user.preset.c"+juce::String(i),"Cold "+juce::String(i)); real.getChildFile("Presets").createDirectory(); real.getChildFile("Presets/Cold "+juce::String(i)+".origami").replaceWithText(encodePresetFile(r,st)); }
    {
        ContentLibrary cold(real);
        t=std::chrono::steady_clock::now(); cold.rescanNow(); const double scan=msSince(t);
        t=std::chrono::steady_clock::now(); cold.rescanNow(); const double cached=msSince(t);
        std::cout<<"[content scale] 1000 preset files: cold scan "<<scan<<" ms, rescan with index "<<cached<<" ms\n";
        check(cold.snapshot()->records.size()==1002,"cold scan indexes every file");
    }
    real.deleteRecursively();
}
}

int main() {
    juce::ScopedJuceInitialiser_GUI gui;
    try {
        metadataTests(); wavetableIoTests(); libraryTests(); queryTests(); scaleTests();
        std::cout<<"PASS: "<<checks<<" content library checks\n";
        return 0;
    } catch(const std::exception& e) { std::cerr<<"FAIL: "<<e.what()<<"\n"; return 1; }
}
