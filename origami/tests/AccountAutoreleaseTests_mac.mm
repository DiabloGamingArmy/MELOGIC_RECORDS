#include <melogic/account/AccountService.h>
#import <Foundation/Foundation.h>
#include <pthread.h>
#include <cstdio>

namespace {
struct ProbeState {
    std::atomic<bool> drained{false},sameThread{false};
    pthread_t creator{};
};
}
@interface MelogicAccountPoolProbe : NSObject {
@public ProbeState* probe;
}
@end
@implementation MelogicAccountPoolProbe
- (void)dealloc {
    probe->sameThread.store(pthread_equal(probe->creator,pthread_self()));
    probe->drained.store(true);
    [super dealloc];
}
@end

bool accountAutoreleaseScopeRegression() {
    using namespace melogic::account;
    class EmptyStore final : public Store {
        bool tryLock() override{return true;}
        void unlock() noexcept override{}
        juce::String generation() override{return "fixture";}
        std::optional<Session> load(bool=false) override{return {};}
        void save(const Session&,bool) override{}
        void erase() override{}
    };
    class NativeBackend final : public Backend {
        ProbeState& state;
    public:
        explicit NativeBackend(ProbeState& s):state(s){}
        Request begin(juce::int64) override {
            state.creator=pthread_self();
            auto* object=[[MelogicAccountPoolProbe alloc] init];
            object->probe=&state;
            [object autorelease];
            throw Failure{Failure::Network};
        }
        Poll poll(const Request&,juce::int64) override{throw Failure{Failure::Network};}
        Session refresh(const Session&,juce::int64) override{throw Failure{Failure::Network};}
    };
    for(int i=0;i<50;++i){
        ProbeState state;
        Service service(std::make_unique<EmptyStore>(),std::make_unique<NativeBackend>(state));
        service.signIn();
        const auto deadline=juce::Time::getMillisecondCounter()+1000;
        while(!state.drained.load() && juce::Time::getMillisecondCounter()<deadline)juce::Thread::sleep(1);
        // Must drain before worker shutdown, not just at pthread TLS cleanup.
        const bool bounded=state.drained.load() && state.sameThread.load();
        service.shutdown();
        if(!bounded){std::fprintf(stderr,"pool fixture iteration=%d drained=%d sameThread=%d state=%d\n",i,int(state.drained.load()),int(state.sameThread.load()),int(service.snapshot().state));return false;}
    }
    return true;
}
