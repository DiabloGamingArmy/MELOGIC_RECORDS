#pragma once
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mct::origami {
// Message-thread document transactions. Snapshots use the canonical codec and
// immutable shared content; render callbacks never call this object. Navigation
// is context on an edit, not a transaction of its own. Limits are conservative:
// shared content may be counted twice, never undercounted.
template<class Snapshot> class DocumentHistory {
public:
    static constexpr std::size_t entryLimit=64, byteLimit=128u*1024u*1024u;
    struct Context { int page=0; unsigned bus=1; };
    struct Entry { Snapshot before,after; std::string name; Context context; };
    std::function<Snapshot()> capture;
    std::function<bool(const Snapshot&)> restore;
    std::function<void()> changed;
    Context context{};
    void begin(std::string name) {
        if(replaying_) return;
        if(depth_++==0) { before_=capture(); name_=std::move(name); editContext_=context; }
    }
    void end() {
        if(replaying_ || depth_==0 || --depth_!=0) return;
        auto after=capture();
        if(!before_->same(after)) {
            entries_.erase(entries_.begin()+static_cast<std::ptrdiff_t>(index_),entries_.end());
            entries_.push_back({std::move(*before_),std::move(after),name_,editContext_});
            index_=entries_.size();
            while(!entries_.empty() && (entries_.size()>entryLimit || bytes()>byteLimit)) {
                entries_.erase(entries_.begin()); --index_;
            }
            if(changed) changed();
        }
        before_.reset();
    }
    bool canUndo() const {return index_>0 && depth_==0;}
    bool canRedo() const {return index_<entries_.size() && depth_==0;}
    std::string_view nextName(bool redo) const {
        if(redo ? index_>=entries_.size() : index_==0)return {};
        return entries_[redo ? index_ : index_-1].name;
    }
    bool undo() {return apply(false);}
    bool redo() {return apply(true);}
    bool replaying() const {return replaying_;}
    bool active() const {return depth_>0;}
    std::size_t size() const {return entries_.size();}
    std::size_t bytes() const {std::size_t n=saved_ ? saved_->cost() : 0;for(const auto& e:entries_) n+=sizeof(Entry)+e.name.capacity()+e.before.cost()+e.after.cost();return n;}
    void clear() {entries_.clear();index_=depth_=0;before_.reset();if(changed)changed();}
    void markSaved() {auto checkpoint=capture();if(depth_>0)before_=checkpoint;
        if(checkpoint.cost()<=byteLimit)saved_=std::move(checkpoint);else saved_.reset();
        while(!entries_.empty() && bytes()>byteLimit) {entries_.erase(entries_.begin());if(index_>0)--index_;}
    }
    bool atSaved() const {return saved_ && saved_->same(capture());}
private:
    bool apply(bool redo) {
        if(redo ? !canRedo() : !canUndo()) return false;
        auto& e=entries_[redo ? index_ : index_-1];
        replaying_=true;
        const bool ok=restore(redo ? e.after : e.before);
        replaying_=false;
        if(ok) {if(redo)++index_;else --index_;context=e.context;if(changed)changed();}
        return ok;
    }
    std::vector<Entry> entries_;
    std::size_t index_=0,depth_=0;
    std::optional<Snapshot> before_,saved_;
    Context editContext_{};
    std::string name_;
    bool replaying_=false;
};
}
