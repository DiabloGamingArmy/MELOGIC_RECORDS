// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
#include "NativeChoiceMenu.h"
namespace mct::origami::ui {
void showNativeChoiceMenu(juce::Component& anchor,const juce::String&,const std::vector<NativeChoiceItem>& items,int current,std::function<void(int)> callback) {
    juce::PopupMenu menu;
    for(std::size_t i=0;i<items.size();) {
        if(items[i].group.isEmpty()) {
            const auto& item=items[i++];
            menu.addItem(item.id,item.text,item.enabled,item.id==current);
            continue;
        }

        const auto group=items[i].group;
        juce::PopupMenu submenu;
        while(i<items.size() && items[i].group==group) {
            const auto& item=items[i++];
            submenu.addItem(item.id,item.text,item.enabled,item.id==current);
        }
        menu.addSubMenu(group,submenu);
    }
    auto safe=juce::Component::SafePointer<juce::Component>(&anchor);
    menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&anchor),
        [safe,callback=std::move(callback)](int id) mutable {if(safe!=nullptr&&id>0&&callback)callback(id);});
}
}
