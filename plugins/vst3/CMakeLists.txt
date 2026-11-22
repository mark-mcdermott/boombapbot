# boombapbot as a VST3 instrument: РИТМ-12 on the shared render engine, inside
# a JUCE plugin. See README.md for what it does and what has been verified.
cmake_minimum_required(VERSION 3.22)

# FL Studio and other hosts still run under Rosetta on Apple silicon, and a
# plugin without their architecture can take the host down as it loads. So a
# macOS build is universal unless it is told otherwise.
if(APPLE)
  set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "Architectures of the macOS build")
  set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Oldest macOS the build runs on")
endif()

project(boombapbot_vst3 VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

get_filename_component(BOOMBAPBOT_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
set(MACHINE_RITM12_DIR "${BOOMBAPBOT_REPO_ROOT}/packages/machine-ritm12")

# ---- JUCE -------------------------------------------------------------------
# Fetched at configure time and never vendored. JUCE 8 is AGPLv3 or commercial;
# a licence has to be chosen before anything built from this is distributed.
# To build against a local checkout instead of cloning, pass
# -DFETCHCONTENT_SOURCE_DIR_JUCE=/path/to/JUCE.
include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.9
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

# ---- Shared engine ----------------------------------------------------------
# The same static library the desktop app links. Its tests and the render
# command line tool are not part of the plugin build.
set(SNARE_BUILD_TESTS OFF CACHE BOOL "Build the CTest suites" FORCE)
set(SNARE_BUILD_TOOLS OFF CACHE BOOL "Build the render command line tools" FORCE)
set(BOOMBAPBOT_MACHINE_DIRS "${MACHINE_RITM12_DIR}" CACHE STRING "Machine packages to build the engine for" FORCE)
add_subdirectory("${BOOMBAPBOT_REPO_ROOT}/engine" "${CMAKE_CURRENT_BINARY_DIR}/engine")

# ---- Plugin -----------------------------------------------------------------
# PLUGIN_MANUFACTURER_CODE and PLUGIN_CODE identify the plugin to hosts and are
# baked into saved sessions. They must not change once a build has been
# released.
juce_add_plugin(boombapbot_plugin
  PRODUCT_NAME "boombapbot"
  COMPANY_NAME "boombapbot"
  PLUGIN_MANUFACTURER_CODE Bmbp
  PLUGIN_CODE Rt12
  FORMATS VST3
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS FALSE
  VST3_CATEGORIES Instrument Drum
  COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(boombapbot_plugin PRIVATE
  Source/BeatFile.cpp
  Source/BeatFile.h
  Source/MachineRitm12.h
  Source/Panel/PanelStyle.cpp
  Source/Panel/PanelStyle.h
  Source/Panel/StepKeys.cpp
  Source/Panel/StepKeys.h
  Source/ParameterIds.h
  Source/PatternMidi.cpp
  Source/PatternMidi.h
  Source/PluginEditor.cpp
  Source/PluginEditor.h
  Source/PluginProcessor.cpp
  Source/PluginProcessor.h
  Source/Sequencer.h)

target_compile_definitions(boombapbot_plugin PUBLIC
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(boombapbot_plugin
  PRIVATE
    boombapbot_engine_ritm12
    juce::juce_audio_processors
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)

# JUCE signs the bundle and then writes moduleinfo.json into it, which leaves
# the signature not matching the bundle, and macOS refuses to load that. Custom
# commands run in the order they were added, so this one signs last, when
# every file is in place. It is an ad hoc signature: enough to load on the
# machine that built it, not a Developer ID for distribution.
if(APPLE)
  find_program(BOOMBAPBOT_CODESIGN codesign REQUIRED)
  set(plugin_bundle "$<TARGET_BUNDLE_DIR:boombapbot_plugin_VST3>")
  add_custom_command(TARGET boombapbot_plugin_VST3 POST_BUILD
    COMMAND "${BOOMBAPBOT_CODESIGN}" --force --deep --sign - "${plugin_bundle}"
    COMMAND "${BOOMBAPBOT_CODESIGN}" --verify --deep --strict "${plugin_bundle}"
    COMMENT "Signing the finished bundle"
    VERBATIM)
endif()

# ---- Tests ------------------------------------------------------------------
# The processor self-test drives the plugin's AudioProcessor without the VST3
# wrapper. It links the code the plugin is made of rather than compiling it
# again. On macOS the built bundle is checked too: its signature, its
# architectures, and that it loads. Run them with:
#   ctest --test-dir build/vst3 --output-on-failure
option(BOOMBAPBOT_VST3_BUILD_TESTS "Build the plugin's tests and register them with CTest" ON)

if(BOOMBAPBOT_VST3_BUILD_TESTS)
  enable_testing()

  # A program made of the plugin's own code: it links what the plugin is made
  # of rather than compiling it again.
  function(boombapbot_plugin_program target source)
    add_executable(${target} ${source})
    target_include_directories(${target} PRIVATE
      Source
      $<TARGET_PROPERTY:boombapbot_plugin,INCLUDE_DIRECTORIES>)
    target_compile_definitions(${target} PRIVATE
      $<TARGET_PROPERTY:boombapbot_plugin,COMPILE_DEFINITIONS>
      BOOMBAPBOT_MACHINE_FILE="${MACHINE_RITM12_DIR}/data/ritm12.machine.json"
      BOOMBAPBOT_FIXTURES_DIR="${MACHINE_RITM12_DIR}/fixtures")
    target_link_libraries(${target} PRIVATE
      boombapbot_plugin
      juce::juce_recommended_warning_flags)
  endfunction()

  boombapbot_plugin_program(boombapbot_plugin_selftest Tests/ProcessorSelfTest.cpp)
  target_sources(boombapbot_plugin_selftest PRIVATE Tests/HeapTrap.cpp Tests/HeapTrap.h)
  boombapbot_plugin_program(boombapbot_window_snapshot Tests/WindowSnapshot.cpp)
  add_test(NAME vst3.processor_selftest COMMAND boombapbot_plugin_selftest)
  add_test(NAME vst3.window_snapshot
    COMMAND boombapbot_window_snapshot "${CMAKE_CURRENT_BINARY_DIR}/window.png"
      "${MACHINE_RITM12_DIR}/fixtures/four-patterns.project.json")

  if(APPLE)
    set(plugin_binary "$<TARGET_FILE:boombapbot_plugin_VST3>")
    add_executable(boombapbot_bundle_load_check Tests/BundleLoadCheck.cpp)
    add_dependencies(boombapbot_bundle_load_check boombapbot_plugin_VST3)

    # JUCE's VST3 host, to meet the plugin through its VST3 wrapper. This
    # compiles the JUCE modules once more, with hosting switched on.
    juce_add_console_app(boombapbot_bundle_host_check PRODUCT_NAME "boombapbot_bundle_host_check")
    target_sources(boombapbot_bundle_host_check PRIVATE Tests/BundleHostCheck.cpp)
    target_compile_definitions(boombapbot_bundle_host_check PRIVATE
      JUCE_PLUGINHOST_VST3=1
      JUCE_WEB_BROWSER=0
      JUCE_USE_CURL=0)
    target_link_libraries(boombapbot_bundle_host_check PRIVATE
      juce::juce_audio_processors
      juce::juce_recommended_config_flags
      juce::juce_recommended_warning_flags)
    add_dependencies(boombapbot_bundle_host_check boombapbot_plugin_VST3)

    add_test(NAME vst3.bundle_signature
      COMMAND "${BOOMBAPBOT_CODESIGN}" --verify --deep --strict --verbose=2 "${plugin_bundle}")
    add_test(NAME vst3.bundle_loads COMMAND boombapbot_bundle_load_check "${plugin_binary}")
    add_test(NAME vst3.bundle_hosted COMMAND boombapbot_bundle_host_check "${plugin_bundle}")

    # The Intel half is run under Rosetta where there is one, which is how a
    # host that has not moved to Apple silicon runs it.
    execute_process(COMMAND arch -x86_64 /usr/bin/true RESULT_VARIABLE rosetta_missing OUTPUT_QUIET ERROR_QUIET)
    if("arm64" IN_LIST CMAKE_OSX_ARCHITECTURES AND "x86_64" IN_LIST CMAKE_OSX_ARCHITECTURES)
      add_test(NAME vst3.bundle_architectures COMMAND lipo "${plugin_binary}" -verify_arch arm64 x86_64)
      if(CMAKE_HOST_SYSTEM_PROCESSOR STREQUAL "arm64" AND NOT rosetta_missing)
        add_test(NAME vst3.processor_selftest_x86_64
          COMMAND arch -x86_64 "$<TARGET_FILE:boombapbot_plugin_selftest>")
        add_test(NAME vst3.bundle_loads_x86_64
          COMMAND arch -x86_64 "$<TARGET_FILE:boombapbot_bundle_load_check>" "${plugin_binary}")
        add_test(NAME vst3.bundle_hosted_x86_64
          COMMAND arch -x86_64 "$<TARGET_FILE:boombapbot_bundle_host_check>" "${plugin_bundle}")
      endif()
    endif()
  endif()
endif()
