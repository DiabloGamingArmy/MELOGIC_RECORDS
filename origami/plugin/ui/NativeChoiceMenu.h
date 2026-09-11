// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
#pragma once
#include <JuceHeader.h>
#include <functional>
#include <vector>
namespace mct::origami::ui {
struct NativeChoiceItem {
    int id=0;
    juce::String text;
    bool enabled=true;
    juce::String group;
};
void showNativeChoiceMenu(juce::Component&,const juce::String&,const std::vector<NativeChoiceItem>&,int,std::function<void(int)>);
}
