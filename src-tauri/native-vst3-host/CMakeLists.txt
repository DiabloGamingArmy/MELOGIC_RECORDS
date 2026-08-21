cmake_minimum_required(VERSION 3.25)
project(soura_native_vst3_host LANGUAGES C CXX OBJC OBJCXX)

if(NOT DEFINED VST3_SDK_ROOT)
  message(FATAL_ERROR "VST3_SDK_ROOT must point at a recursive Steinberg vst3sdk checkout")
endif()

set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)

add_subdirectory("${VST3_SDK_ROOT}" "${CMAKE_BINARY_DIR}/vst3sdk" EXCLUDE_FROM_ALL)

# Keep the Soura FFI bridge self-contained at the high-level hosting boundary.
# These two Steinberg implementation files define the exact symbols that were
# unresolved when Cargo attempted to reconstruct sdk_hosting/sdk archive order:
#   VST3::Hosting::Module::create(...)
#   Steinberg::Vst::PlugProvider::{PlugProvider,initialize}
# Compiling them into Soura's own archive prevents those host entry points from
# depending on Apple's static-archive member extraction behavior.
add_library(soura_native_vst3_host STATIC
  soura_vst3_host.mm
  "${VST3_SDK_ROOT}/public.sdk/source/vst/hosting/module_mac.mm"
  "${VST3_SDK_ROOT}/public.sdk/source/vst/hosting/plugprovider.cpp"
)

target_compile_features(soura_native_vst3_host PRIVATE cxx_std_17)
target_compile_options(soura_native_vst3_host PRIVATE "$<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>")
target_include_directories(soura_native_vst3_host PRIVATE "${VST3_SDK_ROOT}")

# sdk_hosting remains available for EventList/HostApplication/HostProcessData
# and related helpers. The directly compiled Module/PlugProvider objects satisfy
# the high-level host symbols before ld considers duplicate archive members.
target_link_libraries(soura_native_vst3_host PRIVATE
  sdk_hosting
  sdk
  "-framework Cocoa"
  "-framework Foundation"
)

set_target_properties(soura_native_vst3_host PROPERTIES POSITION_INDEPENDENT_CODE ON)
install(TARGETS soura_native_vst3_host ARCHIVE DESTINATION lib)
