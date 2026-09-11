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
    NSMenu* menu=[[NSMenu alloc]initWithTitle:[NSString stringWithUTF8String:title.toRawUTF8()]];
    [menu setAutoenablesItems:NO];
    for(const auto& choice:items) {
        NSMenuItem* item=[[NSMenuItem alloc]initWithTitle:[NSString stringWithUTF8String:choice.text.toRawUTF8()] action:@selector(choose:) keyEquivalent:@""];
        [item setTarget:target];[item setTag:choice.id];[item setEnabled:choice.enabled?YES:NO];
        [item setState:choice.id==current?NSControlStateValueOn:NSControlStateValueOff];[menu addItem:item];
#if !__has_feature(objc_arc)
        [item release];
#endif
    }
    const NSPoint screen=[NSEvent mouseLocation],window=[view.window convertPointFromScreen:screen],local=[view convertPoint:window fromView:nil];
    [menu popUpMenuPositioningItem:nil atLocation:local inView:view];
    if(target->selectedId_>=0&&callback)callback(static_cast<int>(target->selectedId_));
#if !__has_feature(objc_arc)
    [menu release];[target release];
#endif
}
}
