// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-nodes-menu-hierarchy-fix
#include "NativeChoiceMenu.h"
namespace mct::origami::ui {
namespace {
void addChoice(juce::PopupMenu& menu,const NativeChoiceItem& item,int current) {
    if(item.id==0) { menu.addSeparator(); return; }
    menu.addItem(item.id,item.text,item.enabled,item.checked || item.id==current);
}
// A node's direct entries first, a separator, then its sub-categories.
void addNode(juce::PopupMenu& menu,const NativeChoiceNode& node,int current) {
    for(const auto& item:node.items) addChoice(menu,item,current);
    if(!node.items.empty() && !node.children.empty()) menu.addSeparator();
    for(const auto& child:node.children) {
        juce::PopupMenu submenu;
        addNode(submenu,child,current);
        menu.addSubMenu(child.name,submenu);
    }
}
}

void showNativeChoiceMenu(juce::Component& anchor,const juce::String&,const std::vector<NativeChoiceItem>& items,int current,std::function<void(int)> callback,
                          NativeMenuLayout layout) {
    juce::PopupMenu menu;
    if(layout==NativeMenuLayout::Hierarchical) addNode(menu,buildNativeChoiceTree(items),current);
    else for(std::size_t i=0;i<items.size();) {
        if(items[i].group.isEmpty()) {
            const auto& item=items[i++];
            if(item.id==0) { menu.addSeparator(); continue; }
            menu.addItem(item.id,item.text,item.enabled,item.checked || item.id==current);
            continue;
        }

        const auto group=items[i].group;
        juce::PopupMenu submenu;
        while(i<items.size() && items[i].group==group) {
            const auto& item=items[i++];
            if(item.id==0) { submenu.addSeparator(); continue; }
            submenu.addItem(item.id,item.text,item.enabled,item.checked || item.id==current);
        }
        menu.addSubMenu(group,submenu);
    }
    auto safe=juce::Component::SafePointer<juce::Component>(&anchor);
    // Open at the cursor when it is over the anchor (canvas right-click); otherwise under the anchor.
    const auto mouse=juce::Desktop::getMousePosition();
    auto options=anchor.getScreenBounds().contains(mouse)
        ? juce::PopupMenu::Options().withTargetScreenArea({mouse.x,mouse.y,1,1})
        : juce::PopupMenu::Options().withTargetComponent(&anchor);
    menu.showMenuAsync(options,
        [safe,callback=std::move(callback)](int id) mutable {if(safe!=nullptr&&id>0&&callback)callback(id);});
}
}
