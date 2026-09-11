// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v26.2.0-native-process-library
// mct-origami-v26.2.0-native-menu-include-repair
// mct-origami-v26.2.0-objc-global-scope-repair
//
// Cocoa must be parsed before JuceHeader.h enters this Objective-C++ TU.
#import <Cocoa/Cocoa.h>
#include "NativeOscProcessMenu.h"
#include <cstring>

// Objective-C declarations MUST live at global scope.
// Do not place @interface / @implementation inside a C++ namespace.
@interface MCTOrigamiProcessMenuTarget : NSObject {
@public
    NSInteger selectedTag_;
}
- (void)chooseProcess:(id)sender;
@end

@implementation MCTOrigamiProcessMenuTarget
- (instancetype)init {
    self=[super init];
    if(self != nil)
        selectedTag_=-1;
    return self;
}

- (void)chooseProcess:(id)sender {
    selectedTag_=[sender tag];
}
@end

namespace mct::origami::ui {
namespace {

NSString* toNS(const char* text) {
    return [NSString stringWithUTF8String:(text != nullptr ? text : "")];
}

NSMenuItem* makeItem(dsp::OscProcessType type,
                     dsp::OscProcessType current,
                     MCTOrigamiProcessMenuTarget* target) {
    NSMenuItem* item=[[NSMenuItem alloc] initWithTitle:toNS(dsp::oscProcessName(type))
                                               action:@selector(chooseProcess:)
                                        keyEquivalent:@""];
    [item setTarget:target];
    [item setTag:static_cast<NSInteger>(type)];
    [item setState:type==current ? NSControlStateValueOn : NSControlStateValueOff];
    [item setEnabled:YES];
    return item;
}

} // namespace

void showNativeOscProcessMenu(juce::Component& anchor,
                              dsp::OscProcessType current,
                              std::function<void(dsp::OscProcessType)> onSelected) {
    auto* peer=anchor.getPeer();
    if(peer==nullptr || peer->getNativeHandle()==nullptr)
        return;

    NSView* view=(__bridge NSView*) peer->getNativeHandle();
    if(view==nil || view.window==nil)
        return;

    MCTOrigamiProcessMenuTarget* target=[[MCTOrigamiProcessMenuTarget alloc] init];
    NSMenu* menu=[[NSMenu alloc] initWithTitle:@"OSC PROCESS"];
    [menu setAutoenablesItems:NO];

    NSMenuItem* off=makeItem(dsp::OscProcessType::Off,current,target);
    [menu addItem:off];
#if !__has_feature(objc_arc)
    [off release];
#endif

    [menu addItem:[NSMenuItem separatorItem]];

    constexpr const char* categories[]={
        "Curve / Warp",
        "Sync / Repeat",
        "Fold / Reflect",
        "Phase / Motion",
        "Digital / Experimental",
        "Spectral / Harmonics"
    };

    for(const char* category:categories) {
        NSMenuItem* parent=[[NSMenuItem alloc] initWithTitle:toNS(category)
                                                     action:nil
                                              keyEquivalent:@""];
        NSMenu* submenu=[[NSMenu alloc] initWithTitle:toNS(category)];
        [submenu setAutoenablesItems:NO];

        for(std::uint32_t raw=1;
            raw<static_cast<std::uint32_t>(dsp::OscProcessType::Count);
            ++raw) {
            const auto type=static_cast<dsp::OscProcessType>(raw);
            if(std::strcmp(dsp::oscProcessCategory(type),category)!=0)
                continue;

            NSMenuItem* item=makeItem(type,current,target);
            [submenu addItem:item];
#if !__has_feature(objc_arc)
            [item release];
#endif
        }

        [parent setSubmenu:submenu];
        [menu addItem:parent];

#if !__has_feature(objc_arc)
        [submenu release];
        [parent release];
#endif
    }

    const NSPoint screen=[NSEvent mouseLocation];
    const NSPoint window=[view.window convertPointFromScreen:screen];
    const NSPoint local=[view convertPoint:window fromView:nil];

    [menu popUpMenuPositioningItem:nil atLocation:local inView:view];

    const NSInteger selected=target->selectedTag_;
    if(selected>=0 &&
       selected<static_cast<NSInteger>(dsp::OscProcessType::Count) &&
       onSelected) {
        onSelected(static_cast<dsp::OscProcessType>(selected));
    }

#if !__has_feature(objc_arc)
    [menu release];
    [target release];
#endif
}


void showNativeOscRouteMenu(juce::Component& anchor,
                            OscillatorModuleId targetId,
                            OscillatorModuleId currentSource,
                            OscRouteType currentType,
                            const InstrumentState& state,
                            std::function<void(OscillatorModuleId,OscRouteType)> onSelected) {
    auto* peer=anchor.getPeer();
    if(peer==nullptr || peer->getNativeHandle()==nullptr) return;
    NSView* view=(__bridge NSView*)peer->getNativeHandle();
    if(view==nil || view.window==nil) return;

    MCTOrigamiProcessMenuTarget* target=[[MCTOrigamiProcessMenuTarget alloc] init];
    NSMenu* menu=[[NSMenu alloc] initWithTitle:@"OSC ROUTING"];
    [menu setAutoenablesItems:NO];

    NSMenuItem* off=[[NSMenuItem alloc] initWithTitle:@"Off" action:@selector(chooseProcess:) keyEquivalent:@""];
    [off setTarget:target];[off setTag:1];
    [off setState:currentType==OscRouteType::Off ? NSControlStateValueOn : NSControlStateValueOff];
    [menu addItem:off];
#if !__has_feature(objc_arc)
    [off release];
#endif
    [menu addItem:[NSMenuItem separatorItem]];

    NSInteger resultId=100;
    for(const auto& source:state.oscillators) {
        if(source.id==0 || source.id==targetId) continue;
        NSString* title=[NSString stringWithFormat:@"OSC %u",source.id];
        NSMenuItem* parent=[[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
        NSMenu* submenu=[[NSMenu alloc] initWithTitle:title];
        [submenu setAutoenablesItems:NO];

        for(auto type:oscRouteTypes) {
            NSMenuItem* item=[[NSMenuItem alloc] initWithTitle:toNS(oscRouteName(type))
                                                       action:@selector(chooseProcess:)
                                                keyEquivalent:@""];
            [item setTarget:target];[item setTag:resultId++];
            [item setState:(source.id==currentSource && type==currentType)
                ? NSControlStateValueOn : NSControlStateValueOff];
            [submenu addItem:item];
#if !__has_feature(objc_arc)
            [item release];
#endif
        }
        [parent setSubmenu:submenu];[menu addItem:parent];
#if !__has_feature(objc_arc)
        [submenu release];[parent release];
#endif
    }

    const NSPoint screen=[NSEvent mouseLocation];
    const NSPoint window=[view.window convertPointFromScreen:screen];
    const NSPoint local=[view convertPoint:window fromView:nil];
    [menu popUpMenuPositioningItem:nil atLocation:local inView:view];

    const NSInteger selected=target->selectedTag_;
    if(selected==1 && onSelected) {
        onSelected(0,OscRouteType::Off);
    } else if(selected>=100 && onSelected) {
        NSInteger cursor=100;
        bool done=false;
        for(const auto& source:state.oscillators) {
            if(done) break;
            if(source.id==0 || source.id==targetId) continue;
            for(auto type:oscRouteTypes) {
                if(cursor++==selected) {
                    onSelected(source.id,type);
                    done=true;
                    break;
                }
            }
        }
    }

#if !__has_feature(objc_arc)
    [menu release];
    [target release];
#endif
}

} // namespace mct::origami::ui
