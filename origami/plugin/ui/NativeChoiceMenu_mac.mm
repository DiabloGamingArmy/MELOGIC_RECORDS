// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
#import <Cocoa/Cocoa.h>
#include "NativeChoiceMenu.h"
@interface MCTOrigamiChoiceTarget : NSObject {@public NSInteger selectedId_;} -(void)choose:(id)sender; @end
@implementation MCTOrigamiChoiceTarget
-(instancetype)init {self=[super init];if(self)selectedId_=-1;return self;}
-(void)choose:(id)sender {selectedId_=[sender tag];}
@end
namespace mct::origami::ui {
void showNativeChoiceMenu(juce::Component& anchor,const juce::String& title,const std::vector<NativeChoiceItem>& items,int current,std::function<void(int)> callback) {
    auto* peer=anchor.getPeer();if(!peer||!peer->getNativeHandle())return;
    NSView* view=(__bridge NSView*)peer->getNativeHandle();if(!view||!view.window)return;
    auto* target=[[MCTOrigamiChoiceTarget alloc]init];
    NSString* rootTitle=[NSString stringWithUTF8String:title.toRawUTF8()];
    if(rootTitle==nil) rootTitle=@"Select";
    NSMenu* menu=[[NSMenu alloc]initWithTitle:rootTitle];
    [menu setAutoenablesItems:NO];

    juce::String activeGroup;
    NSMenu* activeMenu=menu;
    std::vector<NSMenu*> ownedSubmenus;

    for(const auto& choice:items) {
        if(choice.group!=activeGroup) {
            activeGroup=choice.group;
            activeMenu=menu;

            if(activeGroup.isNotEmpty()) {
                NSString* groupTitle=[NSString stringWithUTF8String:activeGroup.toRawUTF8()];
                if(groupTitle==nil) groupTitle=@"Other";
                NSMenuItem* parent=[[NSMenuItem alloc]initWithTitle:groupTitle action:nil keyEquivalent:@""];
                NSMenu* submenu=[[NSMenu alloc]initWithTitle:groupTitle];
                [submenu setAutoenablesItems:NO];
                [parent setSubmenu:submenu];
                [menu addItem:parent];
                activeMenu=submenu;
                ownedSubmenus.push_back(submenu);
#if !__has_feature(objc_arc)
                [parent release];
#endif
            }
        }

        NSString* itemTitle=[NSString stringWithUTF8String:choice.text.toRawUTF8()];
        if(itemTitle==nil) itemTitle=@"";
        NSMenuItem* item=[[NSMenuItem alloc]initWithTitle:itemTitle action:@selector(choose:) keyEquivalent:@""];
        [item setTarget:target];[item setTag:choice.id];[item setEnabled:choice.enabled?YES:NO];
        [item setState:(choice.checked || choice.id==current)?NSControlStateValueOn:NSControlStateValueOff];
        [activeMenu addItem:item];
#if !__has_feature(objc_arc)
        [item release];
#endif
    }
    const NSPoint screen=[NSEvent mouseLocation],window=[view.window convertPointFromScreen:screen],local=[view convertPoint:window fromView:nil];
    [menu popUpMenuPositioningItem:nil atLocation:local inView:view];
    if(target->selectedId_>=0&&callback)callback(static_cast<int>(target->selectedId_));
#if !__has_feature(objc_arc)
    for(auto* submenu:ownedSubmenus) [submenu release];
    [menu release];[target release];
#endif
}
}
