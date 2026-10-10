// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-nodes-menu-hierarchy-fix
#pragma once
#include <JuceHeader.h>
#include <functional>
#include <vector>
namespace mct::origami::ui {
// Optional document owner: asynchronous menu choices are one conceptual edit.
struct DocumentActionHost {
    virtual ~DocumentActionHost()=default;
    virtual void beginDocumentAction()=0;
    virtual void endDocumentAction()=0;
    virtual bool replayDocumentAction(bool redo)=0;
};
struct NativeChoiceItem {
    int id=0;
    juce::String text;
    bool enabled=true;
    juce::String group;
    bool checked=false;
    juce::String tooltip; // secondary explanation (e.g. why an item is disabled)
    // Structured category path (outermost first), from canonical catalog
    // metadata. When empty, a hierarchical menu derives the path from `group`
    // by splitting on '/'. Each component is one menu level.
    juce::StringArray path;
};

// Grouped: one submenu per consecutive `group` (every existing menu).
// Hierarchical: categories become real nested submenus (see NativeChoiceTree).
enum class NativeMenuLayout { Grouped,Hierarchical };

void showNativeChoiceMenu(juce::Component&,const juce::String&,const std::vector<NativeChoiceItem>&,int,std::function<void(int)>,
                          NativeMenuLayout layout=NativeMenuLayout::Grouped);

// ---- Category tree (built once per menu, never during paint) -------------
// One node per category name at each level; items keep catalog order and
// categories appear in order of first use, so the catalog defines the order.
struct NativeChoiceNode {
    juce::String name;                       // empty for the root
    std::vector<NativeChoiceItem> items;     // directly selectable entries
    std::vector<NativeChoiceNode> children;  // sub-categories
    bool empty() const noexcept { return items.empty() && children.empty(); }
};

// The item's category path: its structured `path`, else `group` split on '/'.
// Components are trimmed; empty components ("CONTROL /", "A //B") are dropped.
inline juce::StringArray nativeChoicePath(const NativeChoiceItem& item) {
    juce::StringArray raw;
    if(!item.path.isEmpty()) raw=item.path;
    else raw.addTokens(item.group,"/","");
    juce::StringArray path;
    for(auto part:raw) { part=part.trim(); if(part.isNotEmpty()) path.add(part); }
    return path;
}

inline NativeChoiceNode buildNativeChoiceTree(const std::vector<NativeChoiceItem>& items) {
    NativeChoiceNode root;
    for(const auto& item:items) {
        auto* node=&root;
        for(const auto& name:nativeChoicePath(item)) {
            auto it=std::find_if(node->children.begin(),node->children.end(),[&](const NativeChoiceNode& c){ return c.name==name; });
            if(it==node->children.end()) { node->children.push_back({name,{},{}}); it=node->children.end()-1; }
            node=&*it;
        }
        node->items.push_back(item);
    }
    // Defensive: a category with nothing selectable below it is never shown.
    std::function<void(NativeChoiceNode&)> prune=[&](NativeChoiceNode& n) {
        for(auto& c:n.children) prune(c);
        n.children.erase(std::remove_if(n.children.begin(),n.children.end(),[](const NativeChoiceNode& c){ return c.empty(); }),n.children.end());
    };
    prune(root);
    return root;
}
}
