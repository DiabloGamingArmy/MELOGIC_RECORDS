#pragma once
#include "core/InstrumentState.h"
#include <vector>
namespace mct::origami {
// Non-realtime big-endian host codec. v1: parameters; v2: oscillators; v3: modulation configuration/routes.
std::vector<std::uint8_t> encodeInstrumentState(const InstrumentState&);
bool decodeInstrumentState(const void*,std::size_t,InstrumentState&) noexcept;
}
