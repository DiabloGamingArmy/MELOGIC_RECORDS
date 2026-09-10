#pragma once
#include "core/InstrumentState.h"
#include <vector>
namespace mct::origami {
// Non-realtime big-endian host codec. v1: flat parameters; v2: complete model.
std::vector<std::uint8_t> encodeInstrumentState(const InstrumentState&);
bool decodeInstrumentState(const void*,std::size_t,InstrumentState&) noexcept;
}
