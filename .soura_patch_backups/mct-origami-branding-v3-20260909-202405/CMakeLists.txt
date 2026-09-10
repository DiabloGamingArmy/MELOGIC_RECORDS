cmake_minimum_required(VERSION 3.20)
project(MCTOrigami VERSION 0.1.0 LANGUAGES C CXX)
option(ORIGAMI_BUILD_TESTS "Build standalone tests and note renderer" ON)
option(ORIGAMI_SANITIZE "Enable address and undefined behavior sanitizers" OFF)
add_library(origami_core STATIC core/Engine.cpp core/ParameterRegistry.cpp core/Voice.cpp core/dsp/Wavetable.cpp core/dsp/Envelope.cpp)
add_library(mct::origami ALIAS origami_core)
target_include_directories(origami_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(origami_core PUBLIC cxx_std_17)
set_target_properties(origami_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
add_library(origami_patch STATIC core/preset/Patch.cpp)
target_link_libraries(origami_patch PUBLIC origami_core)
foreach(target origami_core origami_patch)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4)
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic)
  endif()
  if(ORIGAMI_SANITIZE AND CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
    target_compile_definitions(${target} PUBLIC ORIGAMI_SANITIZED=1)
    target_compile_options(${target} PUBLIC -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(${target} PUBLIC -fsanitize=address,undefined)
  endif()
endforeach()
if(ORIGAMI_BUILD_TESTS)
  enable_testing()
  add_executable(origami_tests tests/EngineTests.cpp)
  target_link_libraries(origami_tests PRIVATE origami_patch)
  # mct-origami-foundation-completion-v1
  # The release test executable overrides global new/delete to verify that the
  # realtime path allocates nothing. ASan/UBSan own allocator interception, so
  # make the sanitizer contract explicit on this executable instead of relying
  # only on transitive compile definitions from the linked libraries.
  if(ORIGAMI_SANITIZE)
    target_compile_definitions(origami_tests PRIVATE ORIGAMI_SANITIZED=1)
  endif()
  target_compile_definitions(origami_tests PRIVATE ORIGAMI_INIT_PATCH="${CMAKE_CURRENT_SOURCE_DIR}/presets/init.json")
  add_test(NAME origami_foundation COMMAND origami_tests)
  add_executable(origami_render tools/render_note.cpp)
  target_link_libraries(origami_render PRIVATE origami_patch)
endif()
# mct-origami-vst3-host-proof-v1
option(ORIGAMI_BUILD_VST3 "Build the MCT Origami JUCE VST3 host proof" OFF)
set(JUCE_DIR "" CACHE PATH "Path to a JUCE checkout containing CMakeLists.txt")
if(ORIGAMI_BUILD_VST3)
  if(NOT JUCE_DIR AND DEFINED ENV{JUCE_DIR})
    set(JUCE_DIR "$ENV{JUCE_DIR}")
  endif()
  if(NOT JUCE_DIR)
    foreach(candidate "$ENV{HOME}/JUCE" "$ENV{HOME}/Documents/JUCE" "$ENV{HOME}/Developer/JUCE" "$ENV{HOME}/Development/JUCE" "/Applications/JUCE")
      if(EXISTS "${candidate}/CMakeLists.txt" AND EXISTS "${candidate}/modules/juce_audio_processors")
        set(JUCE_DIR "${candidate}")
        break()
      endif()
    endforeach()
  endif()
  if(NOT EXISTS "${JUCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "ORIGAMI_BUILD_VST3=ON requires JUCE. Pass -DJUCE_DIR=/absolute/path/to/JUCE or set JUCE_DIR.")
  endif()
  add_subdirectory("${JUCE_DIR}" "${CMAKE_BINARY_DIR}/JUCE" EXCLUDE_FROM_ALL)
  juce_add_plugin(OrigamiPlugin
    COMPANY_NAME "Melogic Creative Technologies"
    BUNDLE_ID "studio.melogic.origami"
    PLUGIN_MANUFACTURER_CODE Mctg
    PLUGIN_CODE Orig
    PRODUCT_NAME "MCT Origami"
    PLUGIN_NAME "MCT Origami"
    DESCRIPTION "MCT Origami Universal Sound Design Instrument"
    # mct-origami-multihost-v0.2.1
    # One processor/core, three development wrappers: VST3, Logic AU, Standalone.
    FORMATS VST3 AU Standalone
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
  )
  juce_generate_juce_header(OrigamiPlugin)
  target_sources(OrigamiPlugin PRIVATE plugin/PluginProcessor.cpp plugin/PluginProcessor.h plugin/PluginEditor.cpp plugin/PluginEditor.h)
  # mct-origami-native-window-chrome-v1
  # Standalone uses a custom JUCEApplication only to request native OS window chrome.
  # AU/VST3 continue to use host-provided windows.
  target_compile_definitions(OrigamiPlugin_Standalone PRIVATE JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP=1)
  target_sources(OrigamiPlugin_Standalone PRIVATE plugin/StandaloneApp.cpp)
  target_sources(OrigamiPlugin PRIVATE
    plugin/ui/OrigamiStyle.cpp plugin/ui/OrigamiHeader.cpp
    plugin/ui/OscillatorRack.cpp plugin/ui/SignalPanels.cpp
    plugin/ui/ModulationPanel.cpp plugin/ui/PerformanceKeyboard.cpp)
  target_include_directories(OrigamiPlugin PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
  target_compile_features(OrigamiPlugin PRIVATE cxx_std_17)
  target_compile_definitions(OrigamiPlugin PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(OrigamiPlugin PRIVATE origami_core juce::juce_audio_utils juce::juce_gui_extra juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)
endif()
