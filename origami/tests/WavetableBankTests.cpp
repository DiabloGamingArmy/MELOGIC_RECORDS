// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-v26.2.0-native-process-library
#include "core/dsp/WavetableBank.h"
#include <cmath>
#include <algorithm>
#include <iostream>

using namespace mct::origami::dsp;

namespace {
int failures = 0;

void expect(bool condition, const char* message) {
    if (!condition) {
        ++failures;
        std::cerr << "FAIL: " << message << '\n';
    }
}
void cachedPitchMatchesReference() {
    auto table=Wavetable::builtIns();
    WavetableOscillator oscillator;oscillator.reset(0.137);
    auto verify=[&](double frequency,double rate,float position) {
        const auto& bands=table.frames[0].bands;
        const double available=frequency>0 ? rate*.45/frequency : 1;
        std::size_t band=0;
        while(band+1<bands.size() && bands[band+1].maximumHarmonic<=available) ++band;
        const float frame=position*static_cast<float>(table.frames.size()-1);
        const auto first=static_cast<std::size_t>(frame),second=std::min(first+1,table.frames.size()-1);
        const double phase=oscillator.phase();
        const double offset=phase*static_cast<double>(table.tableLength);
        const auto i=static_cast<std::size_t>(offset),j=(i+1)%table.tableLength;
        const float fraction=static_cast<float>(offset-static_cast<double>(i));
        auto read=[&](std::size_t f) {
            const auto& values=table.frames[f].bands[band].samples;
            return values[i]+fraction*(values[j]-values[i]);
        };
        const float a=read(first),b=read(second);
        const float expected=frequency>=rate*.5 ? 0.0f : a+(frame-static_cast<float>(first))*(b-a);
        expect(oscillator.next(table,frequency,rate,position)==expected,
               "cached pitch preserves scalar band selection and interpolation");
        double nextPhase=phase+std::clamp(frequency/rate,0.0,.499);
        if(nextPhase>=1) nextPhase-=1;
        expect(oscillator.phase()==nextPhase,"cached pitch preserves exact phase advancement");
    };
    for(double rate:{44100.0,48000.0,96000.0}) {
        for(double frequency:{0.0,-100.0,10.0,93.75,440.0,1000.0,22000.0,48000.0})
            for(unsigned i=0;i<64;++i) verify(frequency,rate,0.37f);
        for(unsigned h=2;h<=512;h*=2) {
            const double edge=rate*.45/h;
            verify(std::nextafter(edge,0.0),rate,0.0f);
            verify(edge,rate,0.5f);
            verify(std::nextafter(edge,rate),rate,1.0f);
        }
    }
    verify(10.0,48000.0,0.4f);
    for(auto& frame:table.frames) frame.bands.resize(2);
    assignWavetableGeneration(table);
    verify(10.0,48000.0,0.4f); // same address/pitch, new band topology
    for(unsigned i=0;i<1024;++i)
        verify(220.0+180.0*std::sin(static_cast<double>(i)*0.03),48000.0,0.37f);
}
}

int main() {
    cachedPitchMatchesReference();
    auto bank = WavetableBank::builtIns();

    expect(bank.size() == 1, "built-in bank contains one canonical table");
    expect(bank.contains(BuiltinWavetableId::BasicShapes), "Basic Shapes stable ID resolves");

    const auto* byId = bank.resolve(BuiltinWavetableId::BasicShapes);
    const auto* byKey = bank.resolve("basic.shapes");
    expect(byId != nullptr, "resolve by stable ID");
    expect(byKey == byId, "resolve by key returns same table");
    expect(byId && byId->valid(), "built-in table is valid");
    expect(byId && byId->frames.size() == 4, "Basic Shapes preserves four existing frames");

    auto low = WavetableBank::sanitizeSelection({BuiltinWavetableId::BasicShapes, -5.0f});
    auto high = WavetableBank::sanitizeSelection({BuiltinWavetableId::BasicShapes, 5.0f});
    auto nan = WavetableBank::sanitizeSelection({0, std::nanf("")});
    expect(low.position == 0.0f, "WT position clamps low");
    expect(high.position == 1.0f, "WT position clamps high");
    expect(nan.tableId == BuiltinWavetableId::BasicShapes, "zero table ID normalizes to built-in");
    expect(nan.position == 0.0f, "non-finite WT position normalizes to zero");

    Wavetable invalid;
    expect(!bank.install(2, "invalid", std::move(invalid)), "invalid table rejected");

    auto second = Wavetable::builtIns();
    second.name = "Test Clone";
    expect(bank.install(2, "test.clone", std::move(second)), "valid secondary table installs");
    expect(bank.size() == 2, "secondary table increments catalog");
    expect(!bank.install(2, "duplicate.id", Wavetable::builtIns()), "duplicate stable ID rejected");
    expect(!bank.install(3, "test.clone", Wavetable::builtIns()), "duplicate stable key rejected");
    expect(!bank.remove(BuiltinWavetableId::BasicShapes), "canonical built-in cannot be removed");
    expect(bank.remove(2), "secondary table can be removed");
    expect(bank.size() == 1, "secondary removal updates catalog");

   // V22.1 canonical WT position
    {
        const auto zero=WavetableBank::sanitizeSelection({BuiltinWavetableId::BasicShapes,0.0f});
        const auto mid=WavetableBank::sanitizeSelection({BuiltinWavetableId::BasicShapes,0.5f});
        const auto one=WavetableBank::sanitizeSelection({BuiltinWavetableId::BasicShapes,1.0f});
        expect(zero.position*3.0f==0.0f,"V22.1 canonical WT position zero");
        expect(mid.position*3.0f==1.5f,"V22.1 canonical WT position midpoint");
        expect(one.position*3.0f==3.0f,"V22.1 canonical WT position end");
    }
    WavetableOscillator oscillator;
    const auto* table = bank.resolve(BuiltinWavetableId::BasicShapes);
    expect(table != nullptr, "table available for oscillator");
    if (table) {
        oscillator.reset(0.123);
        const float a = oscillator.next(*table, 220.0, 48000.0, 0.0f);
        oscillator.reset(0.123);
        const float b = oscillator.next(*table, 220.0, 48000.0, 1.0f);
        expect(std::isfinite(a) && std::isfinite(b), "endpoint renders finite");
        expect(std::abs(a-b) > 1.0e-5f, "WT position changes rendered frame");
    }

    for(std::uint32_t raw=0;raw<static_cast<std::uint32_t>(OscProcessType::Count);++raw) {
        const auto type=static_cast<OscProcessType>(raw);
        expect(validOscProcessType(type),"expanded OSC process catalog type validates");

        const std::array<float,7> amounts=oscProcessIsBipolar(type)
            ? std::array<float,7>{-1.0f,-0.65f,-0.15f,0.0f,0.15f,0.65f,1.0f}
            : std::array<float,7>{0.0f,0.0f,0.0f,0.0f,0.15f,0.65f,1.0f};

        for(double phase:{0.0,0.001,0.125,0.25,0.499,0.5,0.731,0.999}) {
            const double neutral=processOscillatorPhase(phase,type,0.0f);
            expect(std::abs(neutral-phase)<1.0e-12,"OSC process zero amount is neutral");

            for(float amount:amounts) {
                const double processed=processOscillatorPhase(phase,type,amount);
                expect(std::isfinite(processed),"OSC process output finite");
                expect(processed>=0.0 && processed<1.0,"OSC process output phase-bounded");
            }

            if(!oscProcessIsBipolar(type)) {
                const double negative=processOscillatorPhase(phase,type,-0.5f);
                expect(std::abs(negative-phase)<1.0e-12,
                       "unipolar OSC process rejects negative magnitude as neutral");
            }
        }
    }

    if (failures) {
        std::cerr << failures << " wavetable-bank checks failed\n";
        return 1;
    }

    std::cout << "PASS: V22.0 wavetable-bank foundation\n";
    return 0;
}
