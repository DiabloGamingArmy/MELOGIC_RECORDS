# mct-origami-v34.5.0-ui-rebrand
# mct-origami-v30.1.0-env-sync-native-menus-retrigger
# mct-origami-v26.2.0-native-process-library
# mct-origami-v25.1.0-arp-advanced-page
# mct-origami-v24.0.2-cmake-marker-repair
# mct-origami-modulation-completion-v24.0.1
cmake_minimum_required(VERSION 3.20)
project(MCTOrigami VERSION 0.1.0 LANGUAGES C CXX)
if(APPLE)
  enable_language(OBJCXX)
endif()
option(ORIGAMI_BUILD_TESTS "Build standalone tests and note renderer" ON)
option(ORIGAMI_SANITIZE "Enable address and undefined behavior sanitizers" OFF)

# mct-origami-audio-reengineer-p18-simd-profiling
# Patch 18 is measurement infrastructure, not an unconditional SIMD rewrite.
# The audit explicitly requires Release/LTO evidence before changing DSP layout.
option(ORIGAMI_BUILD_DSP_PROFILE "Build the standalone Origami DSP profiling harness" OFF)
option(ORIGAMI_VECTOR_REPORTS "Emit compiler auto-vectorization diagnostics for origami_core" OFF)
option(ORIGAMI_DISABLE_AUTOVECTORIZATION "Disable compiler auto-vectorization for A/B profiling" OFF)

# mct-origami-audio-reengineer-p19-aux-rt-thread-decision-gate
# The default and current production architecture is exactly one realtime DSP
# thread: the host callback. Auxiliary realtime rendering is intentionally not
# implemented merely because more cores exist.
option(ORIGAMI_ENABLE_AUX_RT_THREADS "EXPERIMENTAL: auxiliary realtime DSP workers" OFF)
if(ORIGAMI_ENABLE_AUX_RT_THREADS)
  message(FATAL_ERROR
    "Auxiliary realtime DSP threads are intentionally gated. "
    "Run Patch 18 profiling and docs/AUXILIARY_RT_THREADING_DECISION.md first. "
    "A future implementation must provide bounded work partitioning, a no-wait "
    "deadline fallback, and platform realtime scheduling integration "
    "(Audio Workgroups on Apple / appropriate pro-audio scheduling on Windows).")
endif()
add_library(origami_core STATIC core/Engine.cpp core/InstrumentState.cpp core/modulation/Modulation.cpp core/ParameterRegistry.cpp core/Voice.cpp core/dsp/Wavetable.cpp core/dsp/WavetableBank.cpp core/dsp/Envelope.cpp)
add_library(mct::origami ALIAS origami_core)
target_include_directories(origami_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(origami_core PUBLIC cxx_std_17)
set_target_properties(origami_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
add_library(origami_patch STATIC core/preset/Patch.cpp core/preset/StateCodec.cpp)
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

# Patch 18/19: compiler-vectorization evidence belongs on the core DSP target.
# Keep all of this opt-in so normal production/test builds remain unchanged.
if(CMAKE_CXX_COMPILER_ID MATCHES "AppleClang|Clang")
  if(ORIGAMI_VECTOR_REPORTS)
    target_compile_options(origami_core PRIVATE
      -Rpass=loop-vectorize
      -Rpass-missed=loop-vectorize
      -Rpass-analysis=loop-vectorize
      -Rpass=slp-vectorizer
      -Rpass-missed=slp-vectorizer)
  endif()
  if(ORIGAMI_DISABLE_AUTOVECTORIZATION)
    target_compile_options(origami_core PRIVATE -fno-vectorize -fno-slp-vectorize)
  endif()
elseif(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
  if(ORIGAMI_VECTOR_REPORTS)
    target_compile_options(origami_core PRIVATE -fopt-info-vec-optimized -fopt-info-vec-missed)
  endif()
  if(ORIGAMI_DISABLE_AUTOVECTORIZATION)
    target_compile_options(origami_core PRIVATE -fno-tree-vectorize)
  endif()
elseif(MSVC)
  if(ORIGAMI_VECTOR_REPORTS)
    message(STATUS "ORIGAMI_VECTOR_REPORTS: use MSVC vectorization diagnostics for the selected toolchain")
  endif()
  if(ORIGAMI_DISABLE_AUTOVECTORIZATION)
    message(WARNING "ORIGAMI_DISABLE_AUTOVECTORIZATION is not forced for MSVC; use the toolchain vectorization controls for A/B profiling")
  endif()
endif()

if(ORIGAMI_BUILD_DSP_PROFILE)
  add_executable(origami_dsp_profile tools/profile_simd.cpp)
  target_link_libraries(origami_dsp_profile PRIVATE origami_core)
  target_compile_features(origami_dsp_profile PRIVATE cxx_std_17)
endif()

if(ORIGAMI_BUILD_TESTS)
  enable_testing()
  add_executable(origami_state_tests tests/StateTests.cpp)
  target_link_libraries(origami_state_tests PRIVATE origami_patch)
  add_test(NAME origami_state COMMAND origami_state_tests)
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
  # mct-origami-wavetable-core-foundation-v22.0
  add_executable(origami_wavetable_bank_tests tests/WavetableBankTests.cpp)
  target_link_libraries(origami_wavetable_bank_tests PRIVATE origami_core)
  add_test(NAME origami_wavetable_bank_foundation COMMAND origami_wavetable_bank_tests)

  # mct-origami-modulation-core-foundation-v23.0
  add_executable(origami_modulation_tests tests/ModulationTests.cpp)
  target_link_libraries(origami_modulation_tests PRIVATE origami_patch)
  add_test(NAME origami_modulation_core COMMAND origami_modulation_tests)
endif()
# mct-origami-vst3-host-proof-v1
option(ORIGAMI_BUILD_VST3 "Build the MCT Origami JUCE VST3 host proof" OFF)
# mct-origami-audio-reengineer-p05.2-plugin-test-target-contract
# Modern alias for the historical VST3-named switch, which now builds VST3, AU and Standalone.
option(ORIGAMI_BUILD_PLUGIN "Build the MCT Origami JUCE plugin wrappers and plugin tests" OFF)
if(ORIGAMI_BUILD_PLUGIN)
  set(ORIGAMI_BUILD_VST3 ON)
endif()
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
  # mct-origami-branding-v3
  # mct-origami-header-wordmark-v6
  juce_add_binary_data(OrigamiAssets
    SOURCES
      assets/branding/mct_origami_logo.png
      assets/branding/mct_origami_wordmark.png
      assets/synthui/oragami_header.png
  )
  # mct-origami-native-app-icon-v21.3
  # mct-origami-favicon-fill-v21.3.1
  set(ORIGAMI_APP_ICON "${CMAKE_CURRENT_SOURCE_DIR}/assets/branding/mct_favicon_native.png")
  if(NOT EXISTS "${ORIGAMI_APP_ICON}")
    message(FATAL_ERROR "MCT Origami app icon missing: ${ORIGAMI_APP_ICON}")
  endif()
  juce_add_plugin(OrigamiPlugin
    COMPANY_NAME "Melogic Creative Technologies"
    BUNDLE_ID "studio.melogic.origami"
    PLUGIN_MANUFACTURER_CODE Mctg
    PLUGIN_CODE Orig
    PRODUCT_NAME "MCT Origami"
    ICON_BIG "${ORIGAMI_APP_ICON}"
    ICON_SMALL "${ORIGAMI_APP_ICON}"
    PLUGIN_NAME "Origami"
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
    plugin/ui/ModulationPanel.cpp plugin/ui/ModulationMatrix.cpp
    plugin/ui/PerformanceKeyboard.cpp plugin/ui/ArpeggiatorPanel.cpp)
  if(APPLE)
    target_sources(OrigamiPlugin PRIVATE plugin/ui/NativeOscProcessMenu_mac.mm plugin/ui/NativeChoiceMenu_mac.mm)
  else()
    target_sources(OrigamiPlugin PRIVATE plugin/ui/NativeOscProcessMenu.cpp plugin/ui/NativeChoiceMenu.cpp)
  endif()
  target_include_directories(OrigamiPlugin PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
  target_compile_features(OrigamiPlugin PRIVATE cxx_std_17)
  target_compile_definitions(OrigamiPlugin PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(OrigamiPlugin PRIVATE origami_patch OrigamiAssets juce::juce_audio_utils juce::juce_gui_extra juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)
  if(ORIGAMI_BUILD_TESTS)
    add_executable(origami_plugin_tests tests/PluginTests.cpp)
    get_target_property(origami_plugin_definitions OrigamiPlugin COMPILE_DEFINITIONS)
    list(FILTER origami_plugin_definitions EXCLUDE REGEX "^JUCE_STANDALONE_APPLICATION=")
    target_compile_definitions(origami_plugin_tests PRIVATE ${origami_plugin_definitions})
    # Patch 05/19: sanitizer builds leave allocator interception to ASan/UBSan.
    if(ORIGAMI_SANITIZE)
      target_compile_definitions(origami_plugin_tests PRIVATE ORIGAMI_SANITIZED=1)
    endif()
    target_include_directories(origami_plugin_tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/OrigamiPlugin_artefacts/JuceLibraryCode")
    target_link_libraries(origami_plugin_tests PRIVATE OrigamiPlugin origami_patch OrigamiAssets juce::juce_audio_utils juce::juce_gui_extra)
    add_test(NAME origami_plugin_ui COMMAND origami_plugin_tests)
    add_custom_target(origami_plugin_rt_gate
      COMMAND $<TARGET_FILE:origami_plugin_tests>
      DEPENDS origami_plugin_tests
      COMMENT "Running MCT Origami plugin realtime allocation gate")
  endif()
endif()
