#include <atomic>
#include <cstdlib>
#include <malloc/malloc.h>
#define DYLD_INTERPOSE(replacement,original) \
    __attribute__((used)) static struct {const void* newer;const void* older;} interpose_##original \
    __attribute__((section("__DATA,__interpose,interposing"))) = {reinterpret_cast<const void*>(&replacement),reinterpret_cast<const void*>(&original)};
namespace {
std::atomic<bool> watching{false};
std::atomic<unsigned> allocations{0},frees{0};
void* trackedMalloc(std::size_t n){if(watching.load(std::memory_order_relaxed))++allocations;return malloc_zone_malloc(malloc_default_zone(),n);}
void* trackedCalloc(std::size_t n,std::size_t size){if(watching.load(std::memory_order_relaxed))++allocations;return malloc_zone_calloc(malloc_default_zone(),n,size);}
void* trackedRealloc(void* p,std::size_t n){if(watching.load(std::memory_order_relaxed))++allocations;return malloc_zone_realloc(malloc_default_zone(),p,n);}
void trackedFree(void* p){if(!p)return;if(watching.load(std::memory_order_relaxed))++frees;malloc_zone_free(malloc_default_zone(),p);}
DYLD_INTERPOSE(trackedMalloc,malloc)
DYLD_INTERPOSE(trackedCalloc,calloc)
DYLD_INTERPOSE(trackedRealloc,realloc)
DYLD_INTERPOSE(trackedFree,free)
}
// Test-only image: Darwin interposition applies to references in other images.
extern "C" void origamiSpectralHeapGuard(bool enabled){watching.store(enabled,std::memory_order_relaxed);}
extern "C" void origamiSpectralHeapCounts(unsigned* allocs,unsigned* deletes,bool reset){*allocs=allocations.load();*deletes=frees.load();if(reset){allocations.store(0);frees.store(0);}}
