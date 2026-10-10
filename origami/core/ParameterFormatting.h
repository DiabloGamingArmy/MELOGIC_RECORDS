#pragma once
#include <cstdio>
#include <string>
namespace mct::origami {
inline std::string formatFrequencyHz(double hz) {char text[32];if(hz>=10000) std::snprintf(text,sizeof(text),"%.1f kHz",hz/1000);else if(hz>=1000) std::snprintf(text,sizeof(text),"%.2f kHz",hz/1000);else std::snprintf(text,sizeof(text),"%.0f Hz",hz);return text;}
}
