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
namespace {
NSString* nsString(const juce::String& text,NSString* fallback) {
    NSString* s=[NSString stringWithUTF8String:text.toRawUTF8()];
    return s!=nil ? s : fallback;
}
NSMenuItem* choiceItem(const NativeChoiceItem& choice,int current,MCTOrigamiChoiceTarget* target) {
    if(choice.id==0) return [NSMenuItem separatorItem];
    NSMenuItem* item=[[NSMenuItem alloc]initWithTitle:nsString(choice.text,@"") action:@selector(choose:) keyEquivalent:@""];
    [item setTarget:target];[item setTag:choice.id];[item setEnabled:choice.enabled?YES:NO];
    [item setState:(choice.checked || choice.id==current)?NSControlStateValueOn:NSControlStateValueOff];
    if(choice.tooltip.isNotEmpty()) [item setToolTip:nsString(choice.tooltip,@"")];
#if !__has_feature(objc_arc)
    [item autorelease];
#endif
    return item;
}
// mct-origami-nodes-menu-hierarchy-fix: categories as real nested submenus.
// A node's direct entries first, a separator, then its sub-categories.
void addNode(NSMenu* menu,const NativeChoiceNode& node,int current,MCTOrigamiChoiceTarget* target) {
    for(const auto& choice:node.items) [menu addItem:choiceItem(choice,current,target)];
    if(!node.items.empty() && !node.children.empty()) [menu addItem:[NSMenuItem separatorItem]];
    for(const auto& child:node.children) {
        NSString* name=nsString(child.name,@"Other");
        NSMenuItem* parent=[[NSMenuItem alloc]initWithTitle:name action:nil keyEquivalent:@""];
        NSMenu* submenu=[[NSMenu alloc]initWithTitle:name];
        [submenu setAutoenablesItems:NO];
        addNode(submenu,child,current,target);
        [parent setSubmenu:submenu];
        [menu addItem:parent];
#if !__has_feature(objc_arc)
        [submenu release];[parent release];
#endif
    }
}
}

void showNativeChoiceMenu(juce::Component& anchor,const juce::String& title,const std::vector<NativeChoiceItem>& items,int current,std::function<void(int)> callback,
                          NativeMenuLayout layout) {
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

    if(layout==NativeMenuLayout::Hierarchical) addNode(menu,buildNativeChoiceTree(items),current,target);
    else for(const auto& choice:items) {
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

        // Use the same item builder as hierarchical menus: id 0 is a real
        // separator, not an empty selectable item checked by current == 0.
        [activeMenu addItem:choiceItem(choice,current,target)];
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
