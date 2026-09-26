// mct-origami-v29.2.1-osc-route-display-ordinals
// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v26.2.0-native-process-library
#include "NativeOscProcessMenu.h"
#include <cstring>
namespace mct::origami::ui {
void showNativeOscProcessMenu(juce::Component& anchor,
                              dsp::OscProcessType current,
                              std::function<void(dsp::OscProcessType)> onSelected,
                              OscillatorModuleId routeTarget,
                              const InstrumentState* routeState,
                              std::function<void(OscillatorModuleId,OscRouteType)> onRouteSelected) {
    juce::PopupMenu root;
    constexpr const char* categories[]={
        "Curve / Warp","Sync / Repeat","Fold / Reflect",
        "Phase / Motion","Digital / Experimental","Spectral / Harmonics"
    };
    for(const char* category:categories) {
        juce::PopupMenu folder;
        for(std::uint32_t raw=1;raw<static_cast<std::uint32_t>(dsp::OscProcessType::Count);++raw) {
            const auto type=static_cast<dsp::OscProcessType>(raw);
            if(std::strcmp(dsp::oscProcessCategory(type),category)!=0) continue;
            folder.addItem(static_cast<int>(raw),dsp::oscProcessName(type),true,type==current);
        }
        root.addSubMenu(category,folder);
    }
    if(routeState!=nullptr && routeTarget!=0) {
        root.addSeparator();
        int routeId=1000; unsigned ordinal=0;
        for(const auto& source:routeState->oscillators) {
            if(source.id==0) continue;
            ++ordinal; if(source.id==routeTarget) continue;
            juce::PopupMenu folder;
            for(auto type:oscRouteTypes) folder.addItem(routeId++,oscRouteName(type));
            root.addSubMenu("OSC "+juce::String(ordinal),folder);
        }
    }
    auto safe=juce::Component::SafePointer<juce::Component>(&anchor);
    root.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&anchor),
        [safe,routeTarget,routeState,onSelected=std::move(onSelected),onRouteSelected=std::move(onRouteSelected)](int result) mutable {
            if(safe==nullptr || result<=0) return;
            if(result<1000) {
                const auto raw=static_cast<std::uint32_t>(result);
                if(raw>0 && raw<static_cast<std::uint32_t>(dsp::OscProcessType::Count) && onSelected)
                    onSelected(static_cast<dsp::OscProcessType>(raw));
                return;
            }
            if(routeState==nullptr || !onRouteSelected) return;
            int id=1000;
            for(const auto& source:routeState->oscillators) {
                if(source.id==0 || source.id==routeTarget) continue;
                for(auto type:oscRouteTypes)
                    if(id++==result){onRouteSelected(source.id,type);return;}
            }
        });
}
void showNativeOscChainAddMenu(juce::Component& anchor,
                               OscillatorModuleId target,
                               const InstrumentState& state,
                               std::function<void(dsp::OscProcessType)> onProcessSelected,
                               std::function<void(OscillatorModuleId,OscRouteType)> onRouteSelected) {
    juce::PopupMenu root;
    constexpr const char* categories[]={
        "Curve / Warp","Sync / Repeat","Fold / Reflect",
        "Phase / Motion","Digital / Experimental","Spectral / Harmonics"
    };
    for(const char* category:categories) {
        juce::PopupMenu folder;
        for(std::uint32_t raw=1;raw<static_cast<std::uint32_t>(dsp::OscProcessType::Count);++raw) {
            const auto type=static_cast<dsp::OscProcessType>(raw);
            if(std::strcmp(dsp::oscProcessCategory(type),category)!=0) continue;
            folder.addItem(static_cast<int>(raw),dsp::oscProcessName(type));
        }
        root.addSubMenu(category,folder);
    }
    root.addSeparator();
    int routeId=1000;
    unsigned ordinal=0;
    for(const auto& source:state.oscillators) {
        if(source.id==0) continue;
        ++ordinal;
        if(source.id==target) continue;
        juce::PopupMenu folder;
        for(auto type:oscRouteTypes) folder.addItem(routeId++,oscRouteName(type));
        root.addSubMenu("OSC "+juce::String(ordinal),folder);
    }
    auto safe=juce::Component::SafePointer<juce::Component>(&anchor);
    root.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&anchor),
        [safe,state,target,onProcessSelected=std::move(onProcessSelected),onRouteSelected=std::move(onRouteSelected)](int selected) mutable {
            if(safe==nullptr || selected<=0) return;
            if(selected<1000) {
                if(onProcessSelected && selected<static_cast<int>(dsp::OscProcessType::Count))
                    onProcessSelected(static_cast<dsp::OscProcessType>(selected));
                return;
            }
            int id=1000;
            for(const auto& source:state.oscillators) {
                if(source.id==0 || source.id==target) continue;
                for(auto type:oscRouteTypes)
                    if(id++==selected){if(onRouteSelected)onRouteSelected(source.id,type);return;}
            }
        });
}
void showNativeOscRouteMenu(juce::Component& anchor,
                            OscillatorModuleId target,
                            OscillatorModuleId currentSource,
                            OscRouteType currentType,
                            const InstrumentState& state,
                            std::function<void(OscillatorModuleId,OscRouteType)> onSelected) {
    juce::PopupMenu root;
    root.addItem(1,"Off",true,currentType==OscRouteType::Off);
    root.addSeparator();
    int resultId=100;
    unsigned displayOrdinal=0;
    for(const auto& source:state.oscillators) {
        if(source.id==0) continue;
        ++displayOrdinal;
        if(source.id==target) continue;

        juce::PopupMenu folder;
        for(auto type:oscRouteTypes)
            folder.addItem(resultId++,oscRouteName(type),true,
                           source.id==currentSource && type==currentType);

        // Never expose stable internal module IDs in presentation text.
        root.addSubMenu("OSC "+juce::String(displayOrdinal),folder);
    }
    auto safe=juce::Component::SafePointer<juce::Component>(&anchor);
    root.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&anchor),
        [safe,state,target,onSelected=std::move(onSelected)](int selected) mutable {
            if(safe==nullptr || selected<=0 || !onSelected) return;
            if(selected==1){onSelected(0,OscRouteType::Off);return;}
            int id=100;
            for(const auto& source:state.oscillators) {
                if(source.id==0 || source.id==target) continue;
                for(auto type:oscRouteTypes)
                    if(id++==selected){onSelected(source.id,type);return;}
            }
        });
}
}
