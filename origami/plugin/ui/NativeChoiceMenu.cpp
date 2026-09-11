// mct-origami-v30.1.0-env-sync-native-menus-retrigger
#include "NativeChoiceMenu.h"
namespace mct::origami::ui {
void showNativeChoiceMenu(juce::Component& anchor,const juce::String&,const std::vector<NativeChoiceItem>& items,int current,std::function<void(int)> callback) {
    juce::PopupMenu menu;
    for(const auto& item:items) menu.addItem(item.id,item.text,item.enabled,item.id==current);
    auto safe=juce::Component::SafePointer<juce::Component>(&anchor);
    menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&anchor),
        [safe,callback=std::move(callback)](int id) mutable {if(safe!=nullptr&&id>0&&callback)callback(id);});
}
}
