#pragma once
#include "core/ParameterRegistry.h"
#include <string>
#include <string_view>
namespace mct::origami {
struct Patch {
    static constexpr unsigned version = 1;
    std::string name = "Init";
    ParameterValues parameters = defaultParameters();
};
// Non-realtime codec, deliberately separate from the DSP library. All version-1
// fields/parameters are required; unsupported versions and unknown IDs fail closed.
bool parsePatch(std::string_view json, Patch& output, std::string& error);
std::string serializePatch(const Patch& patch);
}
