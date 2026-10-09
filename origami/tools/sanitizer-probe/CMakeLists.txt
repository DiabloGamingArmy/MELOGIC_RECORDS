cmake_minimum_required(VERSION 3.20)
project(OrigamiSanitizerRuntimeProbe LANGUAGES CXX)

# Deliberately standalone: never linked into Origami or added to its CTest suite.
set(PROBE_SANITIZERS "address,undefined" CACHE STRING "Runtime to validate")
if(NOT PROBE_SANITIZERS MATCHES "^(address|address,undefined)$")
  message(FATAL_ERROR "This probe requires AddressSanitizer")
endif()
add_executable(sanitizer_probe probe.cpp)
add_executable(sanitizer_probe_control probe.cpp)
foreach(target sanitizer_probe sanitizer_probe_control)
  target_compile_features(${target} PRIVATE cxx_std_17)
endforeach()
target_compile_options(sanitizer_probe PRIVATE
  -fsanitize=${PROBE_SANITIZERS} -fno-omit-frame-pointer)
target_link_options(sanitizer_probe PRIVATE -fsanitize=${PROBE_SANITIZERS})
