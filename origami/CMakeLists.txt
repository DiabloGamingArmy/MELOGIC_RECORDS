# mct-origami-v34.5.0-ui-rebrand
# mct-origami-v30.1.0-env-sync-native-menus-retrigger
# mct-origami-v26.2.0-native-process-library
# mct-origami-v25.1.0-arp-advanced-page
# mct-origami-v24.0.2-cmake-marker-repair
# mct-origami-modulation-completion-v24.0.1
cmake_minimum_required(VERSION 3.20)
project(MCTOrigami VERSION 0.1.0 LANGUAGES C CXX)
# mct-origami-deep-audit-p01-no-rt-spectral-build
find_package(Threads REQUIRED)
if(APPLE)
  enable_language(OBJCXX)
endif()
option(ORIGAMI_BUILD_TESTS "Build standalone tests and note renderer" ON)
option(ORIGAMI_SANITIZE "Enable diagnostic sanitizers" OFF)
set(ORIGAMI_SANITIZERS "address,undefined" CACHE STRING "Diagnostic sanitizers: address,undefined, address, or undefined")
if(ORIGAMI_SANITIZE AND NOT ORIGAMI_SANITIZERS MATCHES "^(address,undefined|address|undefined)$")
  message(FATAL_ERROR "Unsupported ORIGAMI_SANITIZERS selection")
endif()

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
add_library(origami_core STATIC core/Engine.cpp core/InstrumentState.cpp core/modulation/Modulation.cpp core/ParameterRegistry.cpp core/Voice.cpp core/dsp/Wavetable.cpp core/dsp/WavetableBank.cpp core/dsp/Envelope.cpp
  core/fx/FxGraph.cpp core/fx/FxDevelopmentGraph.cpp core/BusModel.cpp
  core/fx/FxEffects.cpp core/fx/FxRenderer.cpp core/fx/SpectralTune.cpp core/dsp/StreamingSpectrum.cpp
  core/fx/FxEnvironment.cpp core/fx/FxWorkspace.cpp
  core/nodes/ControlGraph.cpp)
add_library(mct::origami ALIAS origami_core)
target_include_directories(origami_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(origami_core PUBLIC Threads::Threads)
if(APPLE)
  target_link_libraries(origami_core PUBLIC "-framework Accelerate")
endif()
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
    target_compile_options(${target} PUBLIC -fsanitize=${ORIGAMI_SANITIZERS} -fno-omit-frame-pointer)
    target_link_options(${target} PUBLIC -fsanitize=${ORIGAMI_SANITIZERS})
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

  # mct-origami-fx-page-foundation-p01
  add_executable(origami_fx_tests tests/FxGraphTests.cpp)
  target_link_libraries(origami_fx_tests PRIVATE origami_patch)
  if(ORIGAMI_SANITIZE)
    target_compile_definitions(origami_fx_tests PRIVATE ORIGAMI_SANITIZED=1)
  endif()
  add_test(NAME origami_fx_graph COMMAND origami_fx_tests)
  add_executable(origami_spectral_tests tests/SpectralTuneTests.cpp)
  target_link_libraries(origami_spectral_tests PRIVATE origami_patch)
  if(APPLE AND NOT ORIGAMI_SANITIZE)
    add_library(origami_spectral_heap_probe SHARED tests/SpectralHeapProbe.cpp)
    target_link_libraries(origami_spectral_tests PRIVATE origami_spectral_heap_probe)
  endif()
  if(ORIGAMI_SANITIZE)
    target_compile_definitions(origami_spectral_tests PRIVATE ORIGAMI_SANITIZED=1)
  endif()
  add_test(NAME origami_spectral_tune COMMAND origami_spectral_tests)
  add_executable(origami_spectral_quality_tests tests/SpectralQualityTests.cpp)
  target_link_libraries(origami_spectral_quality_tests PRIVATE origami_patch)
  add_test(NAME origami_spectral_quality COMMAND origami_spectral_quality_tests)

  # mct-origami-nodes-n07-consolidation: deterministic NODES benchmark.
  add_executable(origami_nodes_bench tools/nodes_bench.cpp)
  target_link_libraries(origami_nodes_bench PRIVATE origami_core)
  target_include_directories(origami_nodes_bench PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
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
  # Shared, non-realtime Melogic account module; no dependency from DSP/core.
  file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../config/firebase-client.json" melogic_client_config)
  string(JSON MELOGIC_FIREBASE_PROJECT GET "${melogic_client_config}" projectId)
  string(JSON MELOGIC_FIREBASE_API_KEY GET "${melogic_client_config}" apiKey)
  if(NOT MELOGIC_FIREBASE_PROJECT MATCHES "^[a-z0-9-]+$" OR NOT MELOGIC_FIREBASE_API_KEY MATCHES "^[A-Za-z0-9_-]+$")
    message(FATAL_ERROR "Invalid public Firebase client configuration")
  endif()
  set(melogic_account_dir "${CMAKE_CURRENT_SOURCE_DIR}/../shared/melogic/account")
  configure_file("${melogic_account_dir}/MelogicFirebaseConfig.h.in" "${CMAKE_BINARY_DIR}/MelogicAccount/MelogicFirebaseConfig.h" @ONLY)
  add_library(melogic_account STATIC "${melogic_account_dir}/AccountService.cpp" "${melogic_account_dir}/KeychainStore.cpp" "${melogic_account_dir}/FirebaseBackend.cpp")
  target_include_directories(melogic_account PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../shared" PRIVATE "${CMAKE_BINARY_DIR}/MelogicAccount")
  target_compile_features(melogic_account PUBLIC cxx_std_17)
  target_compile_definitions(melogic_account PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
  target_link_libraries(melogic_account PUBLIC juce::juce_core juce::juce_cryptography Threads::Threads)
  if(APPLE)
    target_link_libraries(melogic_account PUBLIC "-framework Security")
  endif()
  if(ORIGAMI_SANITIZE)
    target_compile_definitions(melogic_account PUBLIC ORIGAMI_SANITIZED=1)
    target_compile_options(melogic_account PUBLIC -fsanitize=${ORIGAMI_SANITIZERS} -fno-omit-frame-pointer)
    target_link_options(melogic_account PUBLIC -fsanitize=${ORIGAMI_SANITIZERS})
  endif()
  # mct-origami-branding-v3
  # mct-origami-header-wordmark-v6
  juce_add_binary_data(OrigamiAssets
    SOURCES
      assets/branding/mct_origami_logo.png
      assets/branding/mct_origami_wordmark.png
      assets/synthui/oragami_header.png
      # mct-origami-lfo-editor-controls: monochrome source icons (tinted in code)
      assets/icons/lfo/lfo_retrigger.svg
      assets/icons/lfo/lfo_envelope.svg
      assets/icons/lfo/lfo_free.svg
      assets/icons/lfo/lfo_ping_pong.svg
      assets/icons/lfo/lfo_custom_path.svg
      assets/icons/lfo/grid_alignment.svg
      assets/icons/lfo/snap_grid.svg
      assets/icons/lfo/direction_forward.svg
      assets/icons/lfo/direction_backward.svg
  )
  # mct-origami-native-app-icon-v21.3
  # mct-origami-favicon-fill-v21.3.1
  set(ORIGAMI_APP_ICON "${CMAKE_CURRENT_SOURCE_DIR}/assets/branding/mct_favicon_native.png")
  if(NOT EXISTS "${ORIGAMI_APP_ICON}")
    message(FATAL_ERROR "MCT Origami app icon missing: ${ORIGAMI_APP_ICON}")
  endif()
  include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/ReleaseIdentity.cmake")
  juce_add_plugin(OrigamiPlugin
    VERSION "${PROJECT_VERSION}"
    BUILD_VERSION "${ORIGAMI_BUILD_NUMBER}"
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
  # Public screenshot/build identity. Re-evaluate HEAD on every build, but
  # rewrite the generated header only when its contents actually change.
  find_package(Git QUIET)

  if(NOT ORIGAMI_BUILD_CHANNEL MATCHES "^[A-Za-z0-9 ._-]+$")
    message(FATAL_ERROR "ORIGAMI_BUILD_CHANNEL must contain public label characters only")
  endif()
  add_custom_target(OrigamiBuildIdentity
    COMMAND ${CMAKE_COMMAND}
      "-DSOURCE_ROOT=${CMAKE_CURRENT_SOURCE_DIR}/.."
      "-DGIT_EXECUTABLE=${GIT_EXECUTABLE}"
      "-DPUBLIC_VERSION=${ORIGAMI_RELEASE_VERSION}"
      "-DPUBLIC_CHANNEL=${ORIGAMI_BUILD_CHANNEL}"
      "-DRELEASE_CHANNEL=${ORIGAMI_RELEASE_CHANNEL}"
      "-DBUILD_NUMBER=${ORIGAMI_BUILD_NUMBER}"
      "-DOUTPUT_DIR=${CMAKE_CURRENT_BINARY_DIR}/generated"
      "-DTEMPLATE=${CMAKE_CURRENT_SOURCE_DIR}/cmake/OrigamiBuildIdentity.h.in"
      -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/WriteBuildIdentity.cmake"
    BYPRODUCTS "${CMAKE_CURRENT_BINARY_DIR}/generated/OrigamiBuildIdentity.h"
    VERBATIM)
  add_library(melogic_update STATIC "${melogic_account_dir}/../update/ArtifactDownload.cpp" "${melogic_account_dir}/../update/UpdateService.cpp" "${melogic_account_dir}/../update/ReleaseManifest.cpp")
  add_dependencies(melogic_update OrigamiBuildIdentity)
  target_include_directories(melogic_update PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated")
  target_link_libraries(melogic_update PUBLIC melogic_account)
  target_compile_features(melogic_update PUBLIC cxx_std_17)
  add_dependencies(OrigamiPlugin OrigamiBuildIdentity)
  target_include_directories(OrigamiPlugin PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated")
  juce_generate_juce_header(OrigamiPlugin)
  target_sources(OrigamiPlugin PRIVATE plugin/PluginProcessor.cpp plugin/PluginProcessor.h plugin/PluginEditor.cpp plugin/PluginEditor.h)
  # mct-origami-native-window-chrome-v1
  # Standalone uses a custom JUCEApplication only to request native OS window chrome.
  # AU/VST3 continue to use host-provided windows.
  target_compile_definitions(OrigamiPlugin_Standalone PRIVATE JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP=1)
  target_sources(OrigamiPlugin_Standalone PRIVATE plugin/StandaloneApp.cpp)
  set(ORIGAMI_CODESIGN_IDENTITY "" CACHE STRING "Optional stable local signing identity for Standalone Keychain continuity")
  if(APPLE AND NOT ORIGAMI_CODESIGN_IDENTITY STREQUAL "")
    add_custom_command(TARGET OrigamiPlugin_Standalone POST_BUILD
      COMMAND /usr/bin/codesign --force --sign "${ORIGAMI_CODESIGN_IDENTITY}"
        --identifier studio.melogic.origami --timestamp=none
        "$<TARGET_BUNDLE_DIR:OrigamiPlugin_Standalone>"
      VERBATIM)
  endif()
  option(ORIGAMI_ACCOUNT_QUIT_PROBE "Enable local Standalone normal-quit lifecycle probe" OFF)
  if(ORIGAMI_ACCOUNT_QUIT_PROBE)
    if(NOT ORIGAMI_BUILD_TESTS)
      message(FATAL_ERROR "ORIGAMI_ACCOUNT_QUIT_PROBE requires ORIGAMI_BUILD_TESTS for isolated account fixtures")
    endif()
    target_compile_definitions(OrigamiPlugin_Standalone PRIVATE ORIGAMI_ACCOUNT_QUIT_PROBE=1)
  endif()
  target_sources(OrigamiPlugin PRIVATE
    plugin/ui/OrigamiStyle.cpp plugin/ui/OrigamiHeader.cpp plugin/ui/GlobalPanel.cpp
    plugin/ui/OscillatorRack.cpp plugin/ui/SignalPanels.cpp
    plugin/ui/ModulationPanel.cpp plugin/ui/LfoControlStrip.cpp plugin/ui/OrigamiIcon.cpp plugin/ui/ModulationSourceRow.cpp plugin/ui/ModulationMatrix.cpp
    plugin/ui/ModulationDestinations.cpp plugin/ui/UserPreferences.cpp plugin/content/ContentLibrary.cpp plugin/ui/ContentBrowser.cpp
    plugin/ui/PerformanceKeyboard.cpp plugin/ui/ArpeggiatorPanel.cpp
    plugin/ui/FxPage.cpp)
  if(APPLE)
    target_sources(OrigamiPlugin PRIVATE plugin/ui/NativeOscProcessMenu_mac.mm plugin/ui/NativeChoiceMenu_mac.mm)
  else()
    target_sources(OrigamiPlugin PRIVATE plugin/ui/NativeOscProcessMenu.cpp plugin/ui/NativeChoiceMenu.cpp)
  endif()
  target_include_directories(OrigamiPlugin PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
  target_compile_features(OrigamiPlugin PRIVATE cxx_std_17)
  target_link_libraries(OrigamiPlugin PUBLIC melogic_update)
  target_compile_definitions(OrigamiPlugin PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(OrigamiPlugin PRIVATE origami_patch OrigamiAssets juce::juce_audio_utils juce::juce_gui_extra juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)
  if(ORIGAMI_BUILD_TESTS)
    add_library(origami_account_test_support STATIC tests/AccountTestSupport.cpp)
    target_compile_definitions(origami_account_test_support PUBLIC MELOGIC_ACCOUNT_TESTING=1)
    target_link_libraries(origami_account_test_support PUBLIC melogic_account)
    if(ORIGAMI_ACCOUNT_QUIT_PROBE)
      target_link_libraries(OrigamiPlugin_Standalone PRIVATE origami_account_test_support)
    endif()
    add_executable(origami_plugin_tests tests/PluginTests.cpp "${melogic_account_dir}/FirebaseBackend.cpp")
    target_include_directories(origami_plugin_tests PRIVATE "${CMAKE_BINARY_DIR}/MelogicAccount")
    get_target_property(origami_plugin_definitions OrigamiPlugin COMPILE_DEFINITIONS)
    list(FILTER origami_plugin_definitions EXCLUDE REGEX "^JUCE_STANDALONE_APPLICATION=")
    target_compile_definitions(origami_plugin_tests PRIVATE ${origami_plugin_definitions})
    # Patch 05/19: sanitizer builds leave allocator interception to ASan/UBSan.
    if(ORIGAMI_SANITIZE)
      target_compile_definitions(origami_plugin_tests PRIVATE ORIGAMI_SANITIZED=1)
    endif()
    target_include_directories(origami_plugin_tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/OrigamiPlugin_artefacts/JuceLibraryCode")
    target_link_libraries(origami_plugin_tests PRIVATE origami_account_test_support OrigamiPlugin origami_patch OrigamiAssets juce::juce_audio_utils juce::juce_gui_extra)
    add_test(NAME origami_plugin_ui COMMAND origami_plugin_tests)
    # mct-origami-content-browser: content model / library / wavetable I/O.
    add_executable(origami_content_tests tests/ContentTests.cpp)
    target_compile_definitions(origami_content_tests PRIVATE ${origami_plugin_definitions})
    target_include_directories(origami_content_tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/OrigamiPlugin_artefacts/JuceLibraryCode")
    target_link_libraries(origami_content_tests PRIVATE OrigamiPlugin origami_patch OrigamiAssets juce::juce_audio_utils juce::juce_gui_extra)
    add_test(NAME origami_content COMMAND origami_content_tests)
    # mct-origami-dsp-performance-stereo-chain: performance regression harness
    # (a measurement tool: built with the tests, never registered as a gate).
    add_executable(origami_perf_bench tests/PerfBench.cpp)
    target_compile_definitions(origami_perf_bench PRIVATE ${origami_plugin_definitions})
    target_include_directories(origami_perf_bench PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/OrigamiPlugin_artefacts/JuceLibraryCode")
    target_link_libraries(origami_perf_bench PRIVATE origami_account_test_support OrigamiPlugin origami_patch OrigamiAssets juce::juce_audio_utils juce::juce_gui_extra)
    add_executable(origami_account_tests tests/AccountTests.cpp)
    if(APPLE)
      target_sources(origami_account_tests PRIVATE tests/AccountAutoreleaseTests_mac.mm)
    endif()
    target_link_libraries(origami_account_tests PRIVATE origami_account_test_support)
    add_test(NAME origami_account COMMAND origami_account_tests)
    add_executable(origami_update_tests tests/UpdateTests.cpp "${melogic_account_dir}/FirebaseBackend.cpp")
    target_compile_definitions(origami_update_tests PRIVATE MELOGIC_ACCOUNT_TESTING=1)
    target_include_directories(origami_update_tests PRIVATE "${CMAKE_BINARY_DIR}/MelogicAccount")
    target_link_libraries(origami_update_tests PRIVATE melogic_update)
    add_test(NAME origami_update COMMAND origami_update_tests)
    add_executable(origami_download_tests tests/DownloadTests.cpp)
    target_link_libraries(origami_download_tests PRIVATE melogic_update)
    add_test(NAME origami_download COMMAND origami_download_tests)
    set_tests_properties(origami_download PROPERTIES TIMEOUT 90)
    set_tests_properties(origami_update PROPERTIES TIMEOUT 90)
    set_tests_properties(origami_account PROPERTIES TIMEOUT 60)
    add_executable(origami_eq_headroom tests/EqHeadroomTests.cpp)
    target_link_libraries(origami_eq_headroom PRIVATE origami_patch)
    add_test(NAME origami_eq_headroom COMMAND origami_eq_headroom)
    set_tests_properties(origami_eq_headroom PROPERTIES TIMEOUT 900)
    # B01: production processor + direct-kernel adversarial regression gate.
    add_executable(origami_dsp_torture tests/DspTortureTests.cpp)
    target_compile_definitions(origami_dsp_torture PRIVATE ${origami_plugin_definitions})
    target_include_directories(origami_dsp_torture PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/OrigamiPlugin_artefacts/JuceLibraryCode")
    target_link_libraries(origami_dsp_torture PRIVATE origami_account_test_support OrigamiPlugin origami_patch OrigamiAssets juce::juce_audio_utils juce::juce_gui_extra)
    add_test(NAME origami_dsp_torture COMMAND origami_dsp_torture)
    set_tests_properties(origami_dsp_torture PROPERTIES TIMEOUT 900)
    add_custom_target(origami_plugin_rt_gate
      COMMAND $<TARGET_FILE:origami_plugin_tests>
      DEPENDS origami_plugin_tests
      COMMENT "Running MCT Origami plugin realtime allocation gate")
  endif()
endif()
