// mct-origami-v26.2.0-native-process-library
#include "NativeOscProcessMenu.h"
#include <cstring>
namespace mct::origami::ui {
void showNativeOscProcessMenu(juce::Component& anchor,
                              dsp::OscProcessType current,
                              std::function<void(dsp::OscProcessType)> onSelected) {
    juce::PopupMenu root;
    root.addItem(1,dsp::oscProcessName(dsp::OscProcessType::Off),true,current==dsp::OscProcessType::Off);
    root.addSeparator();
    constexpr const char* categories[]={
        "Curve / Warp","Sync / Repeat","Fold / Reflect",
        "Phase / Motion","Digital / Experimental"
    };
    for(const char* category:categories) {
        juce::PopupMenu folder;
        for(std::uint32_t raw=1;raw<static_cast<std::uint32_t>(dsp::OscProcessType::Count);++raw) {
            const auto type=static_cast<dsp::OscProcessType>(raw);
            if(std::strcmp(dsp::oscProcessCategory(type),category)!=0) continue;
            folder.addItem(static_cast<int>(raw)+1,dsp::oscProcessName(type),true,type==current);
        }
        root.addSubMenu(category,folder);
    }
    auto safe=juce::Component::SafePointer<juce::Component>(&anchor);
    root.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&anchor),
        [safe,onSelected=std::move(onSelected)](int result) mutable {
            if(safe==nullptr || result<=0 || !onSelected) return;
            const auto raw=static_cast<std::uint32_t>(result-1);
            if(raw>=static_cast<std::uint32_t>(dsp::OscProcessType::Count)) return;
            onSelected(static_cast<dsp::OscProcessType>(raw));
        });
}
}
