#pragma once
#include <array>
#include <cstdint>
namespace mct::origami::dsp {
// Persistent Nodes choice IDs. Synth and Nodes menus derive from this table.
enum class FilterType : std::uint8_t {LowPass=0,HighPass=1,BandPass=2,Notch=3,Bell=4,AllPass=5,LowShelf=6,HighShelf=7,Comb=8};
struct FilterControlInfo {const char* name;const char* unit;float minimum,maximum,defaultValue;};
inline constexpr std::array<FilterControlInfo,6> synthFilterControls{{{"CUTOFF","Hz",20,20000,8000},{"RESONANCE","",0,1,.1f},{"DRIVE","dB",0,24,0},{"MIX","",0,1,1},{"KEYTRACK","",0,1,0},{"GAIN","dB",-24,24,0}}};
struct FilterTypeInfo {FilterType id;const char* name;bool synth;bool gain;bool resonance;const char* unavailable;const char* frequencyLabel;};
inline constexpr std::array<FilterTypeInfo,9> filterTypes{{
    {FilterType::LowPass,"LOW PASS",true,false,true,"","CUTOFF"},
    {FilterType::HighPass,"HIGH PASS",true,false,true,"","CUTOFF"},
    {FilterType::BandPass,"BAND PASS",true,false,true,"","FREQUENCY"},
    {FilterType::Notch,"NOTCH",true,false,true,"","FREQUENCY"},
    {FilterType::Bell,"PEAK",true,true,true,"","FREQUENCY"},
    {FilterType::AllPass,"ALL PASS",true,false,true,"","FREQUENCY"},
    {FilterType::LowShelf,"LOW SHELF",true,true,true,"","FREQUENCY"},
    {FilterType::HighShelf,"HIGH SHELF",true,true,true,"","FREQUENCY"},
    {FilterType::Comb,"COMB",false,false,false,"Requires a separately budgeted per-voice delay pool and fractional-delay response","FREQUENCY"}
}};
inline constexpr auto filterTypeLabels=[] {std::array<const char*,filterTypes.size()> names{};for(std::size_t i=0;i<names.size();++i) names[i]=filterTypes[i].name;return names;}();
inline const FilterTypeInfo* filterTypeInfo(FilterType type) noexcept {const auto i=static_cast<unsigned>(type);return i<filterTypes.size()?&filterTypes[i]:nullptr;}
inline bool synthFilterTypeSupported(FilterType type) noexcept {const auto* info=filterTypeInfo(type);return info && info->synth;}
}
