// mct-origami-deep-audit-p01-no-rt-spectral-build
// mct-origami-v31.2.0-mod-visuals-wavetable-spectral
// mct-origami-v29.2.0-randsparse-reseed-routefix
// mct-origami-v29.1.1-rand-amp-smooth-morph-seed-button
// mct-origami-v29.1.0-rand-amp-variants-ui-polish
// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v27.1.0-expanded-cross-osc-routing
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.3.1-bend-bipolar-global-knob-shortcuts
// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-v26.2.0-native-process-library
// mct-origami-v26.1.0-live-wavetable-process-view
// mct-origami-v26.0.0-osc-process-foundation
// mct-origami-v34.2.1-performance-reinforcement
#include "Wavetable.h"
#include <algorithm>
#include <cmath>
#include <array>
#include <atomic>
#include <chrono>
#include <complex>
#include <cstring>
#include <limits>
#include <mutex>
#include <thread>
namespace mct::origami::dsp {
constexpr double pi = 3.14159265358979323846;

namespace {
constexpr std::size_t spectralSize=2048;
using Complex=std::complex<double>;

void fft2048(std::array<Complex,spectralSize>& data,bool inverse) noexcept {
    for(std::size_t i=1,j=0;i<spectralSize;++i) {
        std::size_t bit=spectralSize>>1;
        for(;j&bit;bit>>=1) j^=bit;
        j^=bit;
        if(i<j) std::swap(data[i],data[j]);
    }
    for(std::size_t len=2;len<=spectralSize;len<<=1) {
        const double angle=(inverse?2.0:-2.0)*pi/static_cast<double>(len);
        const Complex wlen{std::cos(angle),std::sin(angle)};
        for(std::size_t i=0;i<spectralSize;i+=len) {
            Complex w{1.0,0.0};
            for(std::size_t j=0;j<len/2;++j) {
                const Complex u=data[i+j];
                const Complex v=data[i+j+len/2]*w;
                data[i+j]=u+v;
                data[i+j+len/2]=u-v;
                w*=wlen;
            }
        }
    }
    if(inverse)
        for(auto& v:data) v/=static_cast<double>(spectralSize);
}

std::uint32_t spectralHash(std::uint32_t seed,std::uint32_t bin) noexcept {
    std::uint32_t x=seed ^ (bin*0x9e3779b9u) ^ 0x85ebca6bu;
    x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;
    return x;
}
double random01(std::uint32_t seed,std::uint32_t bin) noexcept {
    return static_cast<double>(spectralHash(seed,bin)&0x00ffffffu)/16777215.0;
}
double fullSpectralGain(OscProcessType type,std::size_t harmonic,std::uint32_t seed) noexcept {
    if(harmonic==0) return 0.0;
    const double h=static_cast<double>(harmonic);
    const double norm=std::clamp(h/1024.0,0.0,1.0);
    switch(type) {
        case OscProcessType::RandAmp: {
            const double r=random01(seed,static_cast<std::uint32_t>(harmonic));
            // Stronger deletion in the lows/mids while progressively protecting
            // upper harmonics. Survivors remain intentionally stark rather than
            // collapsing into a soft low-pass-like attenuation field.
            const double killThreshold=0.42-0.27*std::pow(norm,0.72);
            if(r<killThreshold) return 0.0;
            const double survivor=(r-killThreshold)/(1.0-killThreshold);
            return 0.34+0.66*std::pow(survivor,0.52);
        }
        case OscProcessType::RandSparse: {
            const double r=random01(seed,static_cast<std::uint32_t>(harmonic));
            // True hard-gated sparsity. Low/mid bins are aggressively removed;
            // very high bins have a substantially better survival probability.
            const double killThreshold=0.76-0.54*std::pow(norm,0.68);
            return r<killThreshold ? 0.0 : 1.0;
        }
        case OscProcessType::OddFocus:
            return (harmonic&1u)!=0u ? 1.0 : 0.08;
        case OscProcessType::SpectralComb:
            return (harmonic%4u)==1u ? 1.0 : ((harmonic%4u)==0u ? 0.30 : 0.06);
        case OscProcessType::HarmonicTilt:
            return std::max(0.035,1.0-0.965*std::pow(norm,0.62));
        case OscProcessType::FormantPeaks: {
            const auto bell=[&](double centre,double width) {
                const double d=(h-centre)/width;
                return std::exp(-0.5*d*d);
            };
            return std::clamp(0.055+0.95*std::max({bell(7.0,3.2),bell(23.0,7.5),bell(61.0,17.0)}),0.0,1.0);
        }
        default: return 1.0;
    }
}
float quantizedSpectralAmount(OscProcessType type,float amount) noexcept {
    if(!oscProcessIsSpectral(type)) return amount;
    const float a=std::clamp(amount,0.0f,1.0f);

    // IMPORTANT REAL-TIME RULE:
    // A cache miss performs a 2048-point FFT + IFFT. 1/256 amount keys allowed
    // a fast LFO to create hundreds of unique keys per second on the AUDIO
    // thread, continuously evicting the tiny cache and eventually starving the
    // callback. Spectral control is intentionally control-rate quantised to 33
    // anchor positions. The audible waveform still interpolates continuously
    // in time through oscillator phase; only the expensive spectral transform
    // state is bounded.
    constexpr float spectralSteps=32.0f;
    return std::round(a*spectralSteps)/spectralSteps;
}
float readCycle(const float* input,double phase) noexcept {
    phase-=std::floor(phase);
    const double pos=phase*static_cast<double>(spectralSize);
    const auto i=static_cast<std::size_t>(pos)%spectralSize;
    const auto j=(i+1)%spectralSize;
    const float f=static_cast<float>(pos-static_cast<double>(static_cast<std::size_t>(pos)));
    return input[i]+f*(input[j]-input[i]);
}
struct SpectralKey {
    const Wavetable* table=nullptr;
    std::uint64_t generation=0;
    std::uint16_t frame=0,band=0;
    OscProcessType p1=OscProcessType::Off,p2=OscProcessType::Off;
    float a1=0.0f,a2=0.0f;
    std::uint32_t s1=0,s2=0;
};
bool sameSpectralKey(const SpectralKey& a,const SpectralKey& b) noexcept {
    return a.table==b.table && a.generation==b.generation &&
           a.frame==b.frame && a.band==b.band &&
           a.p1==b.p1 && a.p2==b.p2 &&
           a.a1==b.a1 && a.a2==b.a2 && a.s1==b.s1 && a.s2==b.s2;
}
std::uint64_t spectralKeyHash(const SpectralKey& k) noexcept {
    auto mix=[](std::uint64_t h,std::uint64_t v) noexcept {
        v^=v>>33;v*=0xff51afd7ed558ccduLL;v^=v>>33;
        h^=v+0x9e3779b97f4a7c15uLL+(h<<6)+(h>>2);
        return h;
    };
    std::uint64_t h=0xcbf29ce484222325uLL;
    h=mix(h,static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(k.table)));
    h=mix(h,k.generation);h=mix(h,k.frame);h=mix(h,k.band);
    h=mix(h,static_cast<std::uint32_t>(k.p1));h=mix(h,static_cast<std::uint32_t>(k.p2));
    std::uint32_t f1=0,f2=0;
    std::memcpy(&f1,&k.a1,sizeof(f1));std::memcpy(&f2,&k.a2,sizeof(f2));
    h=mix(h,f1);h=mix(h,f2);h=mix(h,k.s1);h=mix(h,k.s2);
    return h ? h : 1u;
}
struct SpectralRequest {
    SpectralKey key{};
    std::uint64_t hash=0;
    std::array<float,spectralSize> source{};
};
class SpectralCompiler {
public:
    static constexpr std::size_t cacheWays=8,cacheBuckets=64,cacheSize=cacheWays*cacheBuckets;
    static constexpr std::size_t queueSize=64,pendingSize=256;
    ~SpectralCompiler() {
        stop_.store(true,std::memory_order_release);
        if(worker_.joinable()) worker_.join();
    }
    bool start() noexcept {
        std::lock_guard<std::mutex> guard(startMutex_);
        if(started_) return true;
        try { worker_=std::thread([this]{workerLoop();});started_=true;return true; }
        catch(...) { return false; }
    }
    float readOrRequest(const Wavetable& table,std::size_t frame,std::size_t band,
                        OscProcessType p1,float a1,std::uint32_t s1,
                        OscProcessType p2,float a2,std::uint32_t s2,
                        std::size_t index,std::size_t nextIndex,float fraction,
                        double fallbackPhase) noexcept {
        SpectralKey key{&table,table.generation,
                        static_cast<std::uint16_t>(frame),static_cast<std::uint16_t>(band),
                        p1,p2,quantizedSpectralAmount(p1,a1),quantizedSpectralAmount(p2,a2),s1,s2};
        const auto hash=spectralKeyHash(key);
        const auto bucket=(hash%cacheBuckets)*cacheWays;
        for(std::size_t w=0;w<cacheWays;++w) {
            auto& slot=cache_[bucket+w];
            if(slot.state.load(std::memory_order_acquire)!=ready) continue;
            slot.readers.fetch_add(1,std::memory_order_acquire);
            if(slot.state.load(std::memory_order_acquire)!=ready) {
                slot.readers.fetch_sub(1,std::memory_order_release);continue;
            }
            if(sameSpectralKey(slot.key,key)) {
                const float value=slot.samples[index]+fraction*(slot.samples[nextIndex]-slot.samples[index]);
                slot.age.store(clock_.fetch_add(1,std::memory_order_relaxed),std::memory_order_relaxed);
                slot.readers.fetch_sub(1,std::memory_order_release);
                return value;
            }
            slot.readers.fetch_sub(1,std::memory_order_release);
        }
        fallbackReads_.fetch_add(1,std::memory_order_relaxed);
        request(table,key,hash);
        const auto& source=table.frames[frame].bands[band].samples;
        const double pos=(fallbackPhase-std::floor(fallbackPhase))*static_cast<double>(table.tableLength);
        const auto i=static_cast<std::size_t>(pos)%table.tableLength;
        const auto j=(i+1)%table.tableLength;
        const float f=static_cast<float>(pos-static_cast<double>(static_cast<std::size_t>(pos)));
        return source[i]+f*(source[j]-source[i]);
    }
    SpectralCompilerStats stats() const noexcept {
        return {requests_.load(std::memory_order_relaxed),prepared_.load(std::memory_order_relaxed),
                fallbackReads_.load(std::memory_order_relaxed),dropped_.load(std::memory_order_relaxed)};
    }
private:
    enum : std::uint8_t {empty=0,building=1,ready=2,retiring=3};
    struct CacheSlot {
        std::atomic<std::uint8_t> state{empty};
        std::atomic<std::uint32_t> readers{0};
        std::atomic<std::uint64_t> age{0};
        SpectralKey key{};
        std::array<float,spectralSize> samples{};
    };
    struct QueueSlot { std::atomic<bool> readyFlag{false}; SpectralRequest request{}; };
    void request(const Wavetable& table,const SpectralKey& key,std::uint64_t hash) noexcept {
        const auto pendingIndex=hash%pendingSize;
        std::uint64_t expected=0;
        if(!pending_[pendingIndex].compare_exchange_strong(expected,hash,std::memory_order_acq_rel,std::memory_order_relaxed))
            return;
        std::uint64_t write=write_.load(std::memory_order_relaxed);
        for(;;) {
            const auto read=read_.load(std::memory_order_acquire);
            if(write-read>=queueSize) {
                pending_[pendingIndex].store(0,std::memory_order_release);
                dropped_.fetch_add(1,std::memory_order_relaxed);return;
            }
            if(write_.compare_exchange_weak(write,write+1,std::memory_order_acq_rel,std::memory_order_relaxed))
                break;
        }
        auto& slot=queue_[write%queueSize];
        slot.request.key=key;slot.request.hash=hash;
        const auto& source=table.frames[key.frame].bands[key.band].samples;
        std::copy_n(source.data(),spectralSize,slot.request.source.data());
        slot.readyFlag.store(true,std::memory_order_release);
        requests_.fetch_add(1,std::memory_order_relaxed);
    }
    bool pop(SpectralRequest& requestValue) noexcept {
        const auto read=read_.load(std::memory_order_relaxed);
        if(read>=write_.load(std::memory_order_acquire)) return false;
        auto& slot=queue_[read%queueSize];
        if(!slot.readyFlag.load(std::memory_order_acquire)) return false;
        requestValue=slot.request;
        slot.readyFlag.store(false,std::memory_order_release);
        read_.store(read+1,std::memory_order_release);
        return true;
    }
    CacheSlot* claimSlot(const SpectralKey& key,std::uint64_t hash) noexcept {
        const auto bucket=(hash%cacheBuckets)*cacheWays;
        CacheSlot* oldest=nullptr;
        std::uint64_t oldestAge=std::numeric_limits<std::uint64_t>::max();
        for(std::size_t w=0;w<cacheWays;++w) {
            auto& slot=cache_[bucket+w];
            auto state=slot.state.load(std::memory_order_acquire);
            if(state==ready) {
                slot.readers.fetch_add(1,std::memory_order_acquire);
                if(slot.state.load(std::memory_order_acquire)==ready && sameSpectralKey(slot.key,key)) {
                    slot.readers.fetch_sub(1,std::memory_order_release);return nullptr;
                }
                slot.readers.fetch_sub(1,std::memory_order_release);
                const auto age=slot.age.load(std::memory_order_relaxed);
                if(age<oldestAge){oldestAge=age;oldest=&slot;}
            } else if(state==empty) {
                std::uint8_t expected=empty;
                if(slot.state.compare_exchange_strong(expected,building,std::memory_order_acq_rel,std::memory_order_relaxed))
                    return &slot;
            }
        }
        if(oldest) {
            std::uint8_t expected=ready;
            if(oldest->state.compare_exchange_strong(expected,retiring,std::memory_order_acq_rel,std::memory_order_relaxed)) {
                while(oldest->readers.load(std::memory_order_acquire)!=0) std::this_thread::yield();
                oldest->state.store(building,std::memory_order_release);
                return oldest;
            }
        }
        return nullptr;
    }
    void workerLoop() noexcept {
        SpectralRequest requestValue{};
        while(!stop_.load(std::memory_order_acquire)) {
            if(!pop(requestValue)) {
                std::this_thread::sleep_for(std::chrono::microseconds(250));continue;
            }
            if(auto* slot=claimSlot(requestValue.key,requestValue.hash)) {
                renderProcessedFrame2048(requestValue.source.data(),slot->samples.data(),
                    requestValue.key.p1,requestValue.key.a1,requestValue.key.s1,
                    requestValue.key.p2,requestValue.key.a2,requestValue.key.s2);
                slot->key=requestValue.key;
                slot->age.store(clock_.fetch_add(1,std::memory_order_relaxed),std::memory_order_relaxed);
                slot->state.store(ready,std::memory_order_release);
                prepared_.fetch_add(1,std::memory_order_relaxed);
            }
            const auto pendingIndex=requestValue.hash%pendingSize;
            auto expected=requestValue.hash;
            pending_[pendingIndex].compare_exchange_strong(expected,0,std::memory_order_acq_rel,std::memory_order_relaxed);
        }
    }
    std::array<CacheSlot,cacheSize> cache_{};
    std::array<QueueSlot,queueSize> queue_{};
    std::array<std::atomic<std::uint64_t>,pendingSize> pending_{};
    std::atomic<std::uint64_t> write_{0},read_{0},clock_{1};
    std::atomic<std::uint64_t> requests_{0},prepared_{0},fallbackReads_{0},dropped_{0};
    std::atomic<bool> stop_{false};
    std::mutex startMutex_;
    std::thread worker_;
    bool started_=false;
};
SpectralCompiler& spectralCompiler() noexcept { static SpectralCompiler compiler; return compiler; }
std::atomic<std::uint64_t> wavetableGeneration{1};
} // namespace

bool prepareSpectralCompiler() noexcept { return spectralCompiler().start(); }
void assignWavetableGeneration(Wavetable& table) noexcept {
    table.generation=wavetableGeneration.fetch_add(1,std::memory_order_relaxed);
    if(table.generation==0) table.generation=wavetableGeneration.fetch_add(1,std::memory_order_relaxed);
}
SpectralCompilerStats spectralCompilerStats() noexcept { return spectralCompiler().stats(); }

bool Wavetable::valid() const noexcept {
    if (tableLength < 2 || tableLength > 65536 || frames.empty() || frames.size() > 256 || frames[0].bands.empty()) return false;
    const auto& reference = frames[0].bands;
    if (reference.size() > 16) return false;
    for (const auto& frame : frames) {
        if (frame.bands.size() != reference.size()) return false;
        unsigned previous = 0;
        for (std::size_t b = 0; b < frame.bands.size(); ++b) {
            const auto& band = frame.bands[b];
            if (band.samples.size() != tableLength || band.maximumHarmonic <= previous || band.maximumHarmonic != reference[b].maximumHarmonic || band.maximumHarmonic > tableLength / 2) return false;
            for (float value : band.samples) if (!std::isfinite(value) || std::abs(value) > 4) return false;
            previous = band.maximumHarmonic;
        }
    }
    return reference.front().maximumHarmonic == 1;
}
Wavetable Wavetable::builtIns() {
    Wavetable table;
    table.name = "Basic waveforms: sine, saw, square, triangle";
    table.tableLength = 2048;
    table.frames.resize(4);
    for (std::size_t frame = 0; frame < 4; ++frame) {
        for (unsigned harmonics = 1; harmonics <= 512; harmonics *= 2) {
            WavetableBand band; band.maximumHarmonic = harmonics;
            band.samples.resize(table.tableLength);
            for (std::size_t i = 0; i < table.tableLength; ++i) {
                const double phase = 2 * pi * static_cast<double>(i) / static_cast<double>(table.tableLength);
                double value = 0;
                for (unsigned h = 1; h <= (frame == 0 ? 1 : harmonics); ++h) {
                    double amplitude = 0;
                    if (frame == 0) amplitude = 1;
                    if (frame == 1) amplitude = -2 / (pi * h);
                    if (frame == 2 && h % 2) amplitude = 4 / (pi * h);
                    if (frame == 3 && h % 2) amplitude = 8 * ((h % 4 == 1) ? 1 : -1) / (pi * pi * h * h);
                    value += amplitude * std::sin(phase * h);
                }
                band.samples[i] = static_cast<float>(value);
            }
            table.frames[frame].bands.push_back(std::move(band));
        }
    }
    assignWavetableGeneration(table);
    return table;
}
void WavetableOscillator::reset(double phase) noexcept { phase_ = std::isfinite(phase) ? phase - std::floor(phase) : 0; }

const char* oscProcessName(OscProcessType type) noexcept {
    switch(type) {
        case OscProcessType::Off:return "Off"; case OscProcessType::BendPlus:return "Bend +";
        case OscProcessType::BendMinus:return "Bend -"; case OscProcessType::BendBoth:return "Bend +/-";
        case OscProcessType::Sync:return "Sync 8x"; case OscProcessType::Mirror:return "Mirror";
        case OscProcessType::Asym:return "Asym"; case OscProcessType::SCurve:return "S-Curve";
        case OscProcessType::Pinch:return "Pinch"; case OscProcessType::Expand:return "Expand";
        case OscProcessType::CenterPull:return "Center Pull"; case OscProcessType::EdgePull:return "Edge Pull";
        case OscProcessType::Sync2:return "Sync 2x"; case OscProcessType::Sync3:return "Sync 3x";
        case OscProcessType::Sync4:return "Sync 4x"; case OscProcessType::Sync16:return "Sync 16x";
        case OscProcessType::Fold:return "Phase Fold"; case OscProcessType::SoftFold:return "Soft Fold";
        case OscProcessType::ReflectLeft:return "Reflect Left"; case OscProcessType::ReflectRight:return "Reflect Right";
        case OscProcessType::AlternateReflect:return "Alt Reflect"; case OscProcessType::PhaseShift:return "Phase Shift";
        case OscProcessType::SineWarp:return "Sine Warp"; case OscProcessType::Ripple:return "Ripple";
        case OscProcessType::Twist:return "Twist"; case OscProcessType::ZigZag:return "Zig-Zag";
        case OscProcessType::Staircase:return "Staircase"; case OscProcessType::Reverse:return "Reverse Blend";
        case OscProcessType::Quantize4:return "Quantize 4"; case OscProcessType::Quantize8:return "Quantize 8";
        case OscProcessType::Quantize16:return "Quantize 16"; case OscProcessType::Scramble2:return "Scramble 2";
        case OscProcessType::Scramble4:return "Scramble 4"; case OscProcessType::Chaos:return "Chaos";
        case OscProcessType::Window:return "Window"; case OscProcessType::PulseWarp:return "Pulse Warp";
        case OscProcessType::Shred:return "Shred";
        case OscProcessType::RandAmp:return "Rand Amp";
        case OscProcessType::RandSparse:return "Rand Sparse";
        case OscProcessType::OddFocus:return "Odd Focus";
        case OscProcessType::SpectralComb:return "Spectral Comb";
        case OscProcessType::HarmonicTilt:return "Harmonic Tilt";
        case OscProcessType::FormantPeaks:return "Formant Peaks";
        case OscProcessType::Count:break;
    }
    return "Off";
}

const char* oscProcessCategory(OscProcessType type) noexcept {
    switch(type) {
        case OscProcessType::BendPlus: case OscProcessType::BendMinus: case OscProcessType::BendBoth:
        case OscProcessType::SCurve: case OscProcessType::Pinch: case OscProcessType::Expand:
        case OscProcessType::CenterPull: case OscProcessType::EdgePull: return "Curve / Warp";

        case OscProcessType::Sync: case OscProcessType::Sync2: case OscProcessType::Sync3:
        case OscProcessType::Sync4: case OscProcessType::Sync16: return "Sync / Repeat";

        case OscProcessType::Mirror: case OscProcessType::Fold: case OscProcessType::SoftFold:
        case OscProcessType::ReflectLeft: case OscProcessType::ReflectRight:
        case OscProcessType::AlternateReflect: return "Fold / Reflect";

        case OscProcessType::Asym: case OscProcessType::PhaseShift: case OscProcessType::SineWarp:
        case OscProcessType::Ripple: case OscProcessType::Twist: case OscProcessType::ZigZag:
        case OscProcessType::Staircase: case OscProcessType::Reverse: return "Phase / Motion";

        case OscProcessType::Quantize4: case OscProcessType::Quantize8: case OscProcessType::Quantize16:
        case OscProcessType::Scramble2: case OscProcessType::Scramble4: case OscProcessType::Chaos:
        case OscProcessType::Window: case OscProcessType::PulseWarp: case OscProcessType::Shred:
            return "Digital / Experimental";
        case OscProcessType::RandAmp: case OscProcessType::RandSparse:
        case OscProcessType::OddFocus: case OscProcessType::SpectralComb:
        case OscProcessType::HarmonicTilt: case OscProcessType::FormantPeaks:
            return "Spectral / Harmonics";

        case OscProcessType::Off: case OscProcessType::Count: return "";
    }
    return "";
}

double processOscillatorPhase(double phase,OscProcessType type,float rawAmount) noexcept {
    const auto wrap01=[](double x) noexcept { x-=std::floor(x); return std::clamp(x,0.0,std::nextafter(1.0,0.0)); };
    const auto mix=[](double a,double b,double t) noexcept { return a+(b-a)*t; };
    const auto triangle=[](double x) noexcept { x-=std::floor(x/2.0)*2.0; return 1.0-std::abs(x-1.0); };
    const auto quantize=[](double x,int steps) noexcept { return std::floor(x*steps)/static_cast<double>(steps); };

    const double p=std::clamp(phase,0.0,std::nextafter(1.0,0.0));
    const double amount=std::clamp(static_cast<double>(rawAmount),
                                   static_cast<double>(oscProcessAmountMinimum(type)),1.0);
    if(std::abs(amount)<=std::numeric_limits<double>::epsilon() || type==OscProcessType::Off)
        return p;

    switch(type) {
        case OscProcessType::BendPlus: {
            const double shaped=std::pow(p,1.0+amount*4.0);
            return p+(shaped-p)*amount;
        }
        case OscProcessType::BendMinus: {
            const double shaped=1.0-std::pow(1.0-p,1.0+amount*4.0);
            return p+(shaped-p)*amount;
        }
        case OscProcessType::BendBoth: {
            // True bipolar bend. Positive values pinch phase toward the outer
            // edges; negative values expand it toward the centre. The mapping
            // is monotonic on both halves and exactly neutral at 0.
            const double magnitude=std::abs(amount);
            const double exponent=amount>=0.0
                ? 1.0+magnitude*4.0
                : 1.0/(1.0+magnitude*4.0);
            const double shaped=p<0.5
                ? 0.5*std::pow(p*2.0,exponent)
                : 1.0-0.5*std::pow((1.0-p)*2.0,exponent);
            return std::clamp(shaped,0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Sync: {
            const double cycles=1.0+amount*7.0;
            const double synced=p*cycles;
            return synced-std::floor(synced);
        }
        case OscProcessType::Mirror: {
            const double mirrored=1.0-std::abs(p*2.0-1.0);
            return std::clamp(p+(mirrored-p)*amount,0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Asym: {
            // Bipolar: negative moves the split left; positive moves it right.
            const double midpoint=0.5+amount*0.38;
            if(p<midpoint) return 0.5*(p/midpoint);
            return 0.5+0.5*((p-midpoint)/(1.0-midpoint));
        }
        case OscProcessType::SCurve: {
            const double s=p*p*(3.0-2.0*p);
            return std::clamp(mix(p,s,amount),0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Pinch: {
            const double x=p*2.0-1.0;
            const double y=std::copysign(std::pow(std::abs(x),1.0+amount*5.0),x);
            return std::clamp(y*0.5+0.5,0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Expand: {
            const double x=p*2.0-1.0;
            const double y=std::copysign(std::pow(std::abs(x),1.0/(1.0+amount*4.0)),x);
            return std::clamp(y*0.5+0.5,0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::CenterPull:
            return std::clamp(0.5+(p-0.5)*(1.0-amount*0.88),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::EdgePull: {
            const double k=1.0-amount*0.88;
            return std::clamp(p<0.5 ? p*k : 1.0-(1.0-p)*k,0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Sync2:return wrap01(p*(1.0+amount));
        case OscProcessType::Sync3:return wrap01(p*(1.0+amount*2.0));
        case OscProcessType::Sync4:return wrap01(p*(1.0+amount*3.0));
        case OscProcessType::Sync16:return wrap01(p*(1.0+amount*15.0));
        case OscProcessType::Fold:return std::clamp(triangle(p*(1.0+amount*5.0)),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::SoftFold: {
            const double f=triangle(p*(1.0+amount*4.0));
            return std::clamp(0.5-0.5*std::cos(f*pi),0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::ReflectLeft:
            return std::clamp(mix(p,p<0.5?p:1.0-p,amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::ReflectRight:
            return std::clamp(mix(p,p<0.5?1.0-p:p,amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::AlternateReflect: {
            const int s=std::min(3,static_cast<int>(p*4.0)); const double local=p*4.0-s;
            const double target=(s+(s%2?1.0-local:local))/4.0;
            return std::clamp(mix(p,target,amount),0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::PhaseShift:
            // +/- 180 degrees; 0 is the physical top/center of the amount knob.
            return wrap01(p+amount*0.5);
        case OscProcessType::SineWarp:
            return wrap01(p+std::sin(2.0*pi*p)*amount*0.16);
        case OscProcessType::Ripple:
            return wrap01(p+std::sin(4.0*pi*p)*amount*0.10);
        case OscProcessType::Twist:
            return wrap01(p+(std::sin(2.0*pi*p)*0.10+std::sin(6.0*pi*p)*0.055)*amount);
        case OscProcessType::ZigZag:return std::clamp(mix(p,triangle(p*3.0),amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Staircase: {
            const int steps=2+static_cast<int>(std::round(amount*14.0));
            return std::clamp(mix(p,quantize(p,steps),amount),0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Reverse:return std::clamp(mix(p,1.0-p,amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Quantize4:return std::clamp(mix(p,quantize(p,4),amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Quantize8:return std::clamp(mix(p,quantize(p,8),amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Quantize16:return std::clamp(mix(p,quantize(p,16),amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Scramble2:return wrap01(mix(p,wrap01(p+0.5),amount));
        case OscProcessType::Scramble4: {
            static constexpr int perm[4]={2,0,3,1};
            const int s=std::min(3,static_cast<int>(p*4.0)); const double local=p*4.0-s;
            return std::clamp(mix(p,(perm[s]+local)/4.0,amount),0.0,std::nextafter(1.0,0.0));
        }
        case OscProcessType::Chaos:return std::clamp(mix(p,4.0*p*(1.0-p),amount),0.0,std::nextafter(1.0,0.0));
        case OscProcessType::Window: {
            // Positive expands outward; negative compresses inward.
            const double scale=amount>=0.0
                ? 1.0+amount*5.0
                : 1.0/(1.0+std::abs(amount)*5.0);
            return wrap01(0.5+(p-0.5)*scale);
        }
        case OscProcessType::PulseWarp: {
            // Bipolar pulse-width style skew around the neutral midpoint.
            const double midpoint=0.5+std::sin(amount*pi*0.5)*0.42;
            return p<midpoint ? 0.5*(p/midpoint) : 0.5+0.5*((p-midpoint)/(1.0-midpoint));
        }
        case OscProcessType::Shred:
            return wrap01(p+std::sin(16.0*pi*p)*amount*0.095);
        case OscProcessType::RandAmp:
        case OscProcessType::RandSparse:
        case OscProcessType::OddFocus:
        case OscProcessType::SpectralComb:
        case OscProcessType::HarmonicTilt:
        case OscProcessType::FormantPeaks:
            return p;
        case OscProcessType::Off:
        case OscProcessType::Count:
        default:return p;
    }
}


void renderProcessedFrame2048(const float* input,float* output,
                              OscProcessType process1,float amount1,std::uint32_t seed1,
                              OscProcessType process2,float amount2,std::uint32_t seed2) noexcept {
    if(input==nullptr || output==nullptr) return;
    std::array<Complex,spectralSize> bins{};
    for(std::size_t i=0;i<spectralSize;++i) {
        double phase=static_cast<double>(i)/static_cast<double>(spectralSize);
        if(!oscProcessIsSpectral(process1)) phase=processOscillatorPhase(phase,process1,amount1);
        if(!oscProcessIsSpectral(process2)) phase=processOscillatorPhase(phase,process2,amount2);
        bins[i]=Complex{static_cast<double>(readCycle(input,phase)),0.0};
    }
    if(!oscProcessIsSpectral(process1) && !oscProcessIsSpectral(process2)) {
        for(std::size_t i=0;i<spectralSize;++i) output[i]=static_cast<float>(bins[i].real());
        return;
    }

    fft2048(bins,false);
    const double a1=oscProcessIsSpectral(process1)?quantizedSpectralAmount(process1,amount1):0.0;
    const double a2=oscProcessIsSpectral(process2)?quantizedSpectralAmount(process2,amount2):0.0;

    // Rand Amp and Rand Sparse both expose 12 full-strength seeded anchor
    // spectra. The knob morphs continuously between adjacent masks.
    auto randomVariantTarget=[](OscProcessType type,
                                std::size_t harmonic,
                                std::uint32_t baseSeed,
                                float amount) noexcept {
        const float position=std::clamp(amount,0.0f,1.0f)*
                             static_cast<float>(randAmpVariantCount()-1);
        const int lower=static_cast<int>(std::floor(position));
        const int upper=std::min(lower+1,randAmpVariantCount()-1);
        const double blend=static_cast<double>(position-static_cast<float>(lower));

        const auto seedFor=[baseSeed](int variant) noexcept {
            return baseSeed ^
                   (0x9e3779b9u*static_cast<std::uint32_t>(variant+1));
        };

        const double a=fullSpectralGain(type,harmonic,seedFor(lower));
        const double b=fullSpectralGain(type,harmonic,seedFor(upper));
        return a+(b-a)*blend;
    };

    const auto isRandomVariant=[](OscProcessType type) noexcept {
        return type==OscProcessType::RandAmp ||
               type==OscProcessType::RandSparse;
    };

    bins[0]=Complex{};
    for(std::size_t h=1;h<spectralSize/2;++h) {
        double gain=1.0;
        if(oscProcessIsSpectral(process1)) {
            const bool randomVariant=isRandomVariant(process1);
            const double target=randomVariant
                ? randomVariantTarget(process1,h,seed1,static_cast<float>(a1))
                : fullSpectralGain(process1,h,seed1);
            gain*=randomVariant ? target : 1.0+a1*(target-1.0);
        }
        if(oscProcessIsSpectral(process2)) {
            const bool randomVariant=isRandomVariant(process2);
            const double target=randomVariant
                ? randomVariantTarget(process2,h,seed2,static_cast<float>(a2))
                : fullSpectralGain(process2,h,seed2);
            gain*=randomVariant ? target : 1.0+a2*(target-1.0);
        }
        // gain is a real scalar applied to the existing complex FFT value:
        // magnitude changes, phase angle is preserved exactly.
        bins[h]*=gain;
        bins[spectralSize-h]*=gain;
    }
    bins[spectralSize/2]=Complex{};
    fft2048(bins,true);

    double peak=1.0e-12;
    for(const auto& v:bins) peak=std::max(peak,std::abs(v.real()));

    const bool randomAmplitudePass=
        process1==OscProcessType::RandAmp || process1==OscProcessType::RandSparse ||
        process2==OscProcessType::RandAmp || process2==OscProcessType::RandSparse;

    // Random spectral deletion often removes substantial energy. For Rand Amp /
    // Rand Sparse, always apply post-IFFT make-up normalization so the strongest
    // remaining partial reaches the canonical preview/audio peak again. Other
    // spectral processes retain the prior safety-only attenuation behavior.
    const double normalise=randomAmplitudePass
        ? (peak>1.0e-12 ? 0.985/peak : 1.0)
        : (peak>0.985 ? 0.985/peak : 1.0);

    for(std::size_t i=0;i<spectralSize;++i)
        output[i]=static_cast<float>(
            std::clamp(bins[i].real()*normalise,-0.985,0.985));
}

float WavetableOscillator::next(const Wavetable& table,double frequency,double sampleRate,float position,
                                OscProcessType process1,float amount1,
                                OscProcessType process2,float amount2,
                                double phaseOffsetCycles,
                                double phaseSkew,
                                std::uint32_t process1Seed,
                                std::uint32_t process2Seed) noexcept {
    if (table.frames.empty() || sampleRate <= 0 || !std::isfinite(frequency) || !std::isfinite(position)) return 0;
    // Caller installs validated banks. Bound phase every sample, never accumulate time.
    const double increment = std::clamp(frequency / sampleRate, 0.0, .499);
    const double available = frequency > 0 ? sampleRate * .45 / frequency : 1;
    const auto& bands = table.frames[0].bands;
    std::size_t bandIndex = 0;
    while (bandIndex + 1 < bands.size() && bands[bandIndex + 1].maximumHarmonic <= available) ++bandIndex;
    const float framePosition = std::clamp(position, 0.f, 1.f) * static_cast<float>(table.frames.size() - 1);
    const auto first = static_cast<std::size_t>(framePosition);
    const auto second = std::min(first + 1, table.frames.size() - 1);
    double readPhase=phase_ + (std::isfinite(phaseOffsetCycles) ? phaseOffsetCycles : 0.0);
    readPhase-=std::floor(readPhase);

    // Cross-oscillator PSK dynamically moves the half-cycle split point while
    // preserving a continuous 0..1 phase domain.
    if(std::isfinite(phaseSkew) && std::abs(phaseSkew)>1.0e-12) {
        const double midpoint=std::clamp(0.5+phaseSkew,0.06,0.94);
        readPhase=readPhase<midpoint
            ? 0.5*(readPhase/midpoint)
            : 0.5+0.5*((readPhase-midpoint)/(1.0-midpoint));
    }

    const bool spectral=table.tableLength==spectralSize &&
        (oscProcessIsSpectral(process1) || oscProcessIsSpectral(process2));
    if(!spectral) {
        readPhase=processOscillatorPhase(readPhase,process1,amount1);
        readPhase=processOscillatorPhase(readPhase,process2,amount2);
    }
    const double tablePosition=readPhase*static_cast<double>(table.tableLength);
    const auto index=static_cast<std::size_t>(tablePosition)%table.tableLength;
    const auto nextIndex=(index+1)%table.tableLength;
    const float fraction=static_cast<float>(tablePosition-static_cast<double>(static_cast<std::size_t>(tablePosition)));
    auto read=[&](std::size_t frame) {
        if(spectral) {
            double fallbackPhase=readPhase;
            if(!oscProcessIsSpectral(process1)) fallbackPhase=processOscillatorPhase(fallbackPhase,process1,amount1);
            if(!oscProcessIsSpectral(process2)) fallbackPhase=processOscillatorPhase(fallbackPhase,process2,amount2);
            return spectralCompiler().readOrRequest(table,frame,bandIndex,
                process1,amount1,process1Seed,process2,amount2,process2Seed,
                index,nextIndex,fraction,fallbackPhase);
        }
        const auto& samples=table.frames[frame].bands[bandIndex].samples;
        return samples[index]+fraction*(samples[nextIndex]-samples[index]);
    };
    const float a=read(first),b=read(second);
    const float output = a + (framePosition - static_cast<float>(first)) * (b - a);
    phase_ += increment; if (phase_ >= 1) phase_ -= 1;
    return frequency >= sampleRate * .5 ? 0 : output;
}
double midiFrequency(int note) noexcept { return 440.0 * std::exp2((std::clamp(note, 0, 127) - 69) / 12.0); }
}
