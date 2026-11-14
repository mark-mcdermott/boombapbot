# boombapbot VST3 compile spike.
#
# Proves that the shared render engine in engine/ links into a JUCE VST3
# instrument with MIDI input. It is not a product build. See README.md for what
# was verified and what was not.
cmake_minimum_required(VERSION 3.22)
project(boombapbot_vst3 VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

get_filename_component(SNARE_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

# ---- JUCE -------------------------------------------------------------------
# Fetched at configure time and never vendored. JUCE 8 is AGPLv3 or commercial;
# a licensing path has to be chosen before anything built from this is
# distributed. To build against a local checkout instead of cloning, pass
# -DFETCHCONTENT_SOURCE_DIR_JUCE=/path/to/JUCE.
include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.9
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

# ---- Shared engine ----------------------------------------------------------
# The same static library the native tools and tests use. Its tests and the
# render CLI are not part of the plugin build.
set(SNARE_BUILD_TESTS OFF CACHE BOOL "Build the CTest suites" FORCE)
set(SNARE_BUILD_TOOLS OFF CACHE BOOL "Build the boombapbot-render command line tool" FORCE)
add_subdirectory("${SNARE_REPO_ROOT}/engine" "${CMAKE_CURRENT_BINARY_DIR}/engine")

# ---- Built-in sounds --------------------------------------------------------
# The 808 demo kit is compiled into the plugin, so it makes sound with no file
# access at runtime. File names come from packages/contracts/data/kits/808.kit.json.
set(SNARE_KIT_808_DIR "${SNARE_REPO_ROOT}/assets/kits/808")
juce_add_binary_data(boombapbot_kit_808
  HEADER_NAME "Kit808Data.h"
  NAMESPACE Kit808Data
  SOURCES
    "${SNARE_KIT_808_DIR}/kick.wav"
    "${SNARE_KIT_808_DIR}/snare.wav"
    "${SNARE_KIT_808_DIR}/closed_hat.wav"
    "${SNARE_KIT_808_DIR}/open_hat.wav"
    "${SNARE_KIT_808_DIR}/low_tom.wav"
    "${SNARE_KIT_808_DIR}/high_tom.wav"
    "${SNARE_KIT_808_DIR}/clap.wav"
    "${SNARE_KIT_808_DIR}/cymbal.wav")
# It is a static library that ends up inside a shared object.
set_target_properties(boombapbot_kit_808 PROPERTIES POSITION_INDEPENDENT_CODE ON)

# ---- Plugin -----------------------------------------------------------------
# PLUGIN_MANUFACTURER_CODE and PLUGIN_CODE identify the plugin to hosts and are
# baked into saved sessions. They must not change once a build has been
# released. (JUCE wants exactly four characters; the manufacturer code needs at
# least one upper-case letter and the plugin code exactly one.)
juce_add_plugin(boombapbot_plugin
  PRODUCT_NAME "boombapbot"
  COMPANY_NAME "boombapbot"
  PLUGIN_MANUFACTURER_CODE Snbb
  PLUGIN_CODE Sbd1
  FORMATS VST3
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS FALSE
  VST3_CATEGORIES Instrument Drum
  COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(boombapbot_plugin PRIVATE
  Source/PluginProcessor.cpp
  Source/PluginProcessor.h)

# wav_io.h is the engine's tool-side WAV decoder. It is header-only and is used
# off the audio thread to decode the embedded kit.
target_include_directories(boombapbot_plugin PRIVATE "${SNARE_REPO_ROOT}/engine/tools")

target_compile_definitions(boombapbot_plugin PUBLIC
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(boombapbot_plugin
  PRIVATE
    boombapbot_kit_808
    boombapbot_engine
    juce::juce_audio_processors
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)

# ---- Processor self-test ----------------------------------------------------
# A console program that compiles Source/PluginProcessor.cpp directly and drives
# the processor without the VST3 wrapper. It is a separate target: it shares the
# engine and kit libraries with the plugin and changes nothing the plugin builds
# or links. Run it with: ctest --test-dir build/vst3 --output-on-failure
option(SNARE_VST3_BUILD_SELFTEST "Build the processor self-test and register it with CTest" ON)

if(SNARE_VST3_BUILD_SELFTEST)
  enable_testing()

  juce_add_console_app(boombapbot_plugin_selftest
    PRODUCT_NAME "boombapbot_plugin_selftest")

  target_sources(boombapbot_plugin_selftest PRIVATE
    Tests/ProcessorSelfTest.cpp
    Source/PluginProcessor.cpp
    Source/PluginProcessor.h)

  target_include_directories(boombapbot_plugin_selftest PRIVATE
    Source
    "${SNARE_REPO_ROOT}/engine/tools")

  # JucePlugin_Name normally comes from juce_add_plugin; the processor uses it
  # for getName().
  target_compile_definitions(boombapbot_plugin_selftest PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JucePlugin_Name="boombapbot")

  target_link_libraries(boombapbot_plugin_selftest PRIVATE
    boombapbot_kit_808
    boombapbot_engine
    juce::juce_audio_processors
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)

  add_test(NAME vst3.processor_selftest COMMAND boombapbot_plugin_selftest)
endif()
