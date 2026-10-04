#pragma once
#include "core/InstrumentState.h"
#include <vector>
namespace mct::origami {
// Non-realtime big-endian host codec. v1: parameters; v2: oscillators; v3: modulation configuration/routes.
std::vector<std::uint8_t> encodeInstrumentState(const InstrumentState&);
bool decodeInstrumentState(const void*,std::size_t,InstrumentState&) noexcept;
// N07: what decoding had to repair. A malformed NODES graph (dangling ids,
// invalid ports, type mismatches, cycles, duplicate ids, extra sequencers...)
// keeps every valid part; only the invalid parts are disconnected or removed.
struct DecodeReport { std::size_t graphRepairs=0; };
bool decodeInstrumentState(const void*,std::size_t,InstrumentState&,DecodeReport*) noexcept;
}
