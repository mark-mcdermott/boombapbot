cmake_minimum_required(VERSION 3.22)
project(boombapbot_engine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

option(SNARE_BUILD_TESTS "Build the CTest suites" ON)
option(SNARE_BUILD_TOOLS "Build the boombapbot-render command line tool" ON)

set(SNARE_SOURCES src/engine.cpp src/midi.cpp src/synth808.cpp)
set(SNARE_WARNINGS -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wno-sign-conversion)
# No fused multiply-add, so native and WebAssembly builds do the same
# arithmetic and render the same samples.
set(SNARE_FLOAT_FLAGS -ffp-contract=off)

# Functions the WebAssembly build exports. Keep in step with engine.h.
set(SNARE_WASM_EXPORTS
  malloc free
  snare_abi_version snare_step_ticks snare_pattern_ticks snare_frames_per_tick snare_tick_frame
  snare_synth_frames snare_synth_render
  snare_sound_create snare_sound_data snare_sound_destroy
  snare_engine_create snare_engine_destroy snare_engine_set_sound snare_engine_synth_sound snare_engine_collect
  snare_engine_set_tempo snare_engine_set_track snare_engine_set_track_level snare_engine_set_accent
  snare_engine_set_master_volume
  snare_engine_set_pattern snare_engine_set_step
  snare_engine_cue_pattern snare_engine_set_panel snare_engine_arm_fill
  snare_engine_play snare_engine_play_measures snare_engine_stop snare_engine_trigger
  snare_engine_render
  snare_engine_is_playing snare_engine_current_step snare_engine_current_pattern snare_engine_current_measure
  snare_engine_frames_rendered snare_engine_stop_frame
  snare_engine_active_voices snare_engine_stolen_voices
  snare_engine_enable_event_log snare_engine_event_count snare_engine_read_events
  snare_engine_read_measures
  snare_midi_export)

if(EMSCRIPTEN)
  # A standalone module with no JavaScript glue: the AudioWorklet, the offline
  # exporter and the Node tests all instantiate the same .wasm directly. No
  # threads or shared memory, so no cross-origin isolation is required.
  # Memory starts large enough for a full set of sounds and the ones a knob
  # drag replaces, so it does not have to grow on the audio thread.
  list(TRANSFORM SNARE_WASM_EXPORTS PREPEND "_" OUTPUT_VARIABLE SNARE_EXPORT_SYMBOLS)
  list(JOIN SNARE_EXPORT_SYMBOLS "," SNARE_EXPORT_LIST)
  add_executable(boombapbot-engine ${SNARE_SOURCES})
  target_include_directories(boombapbot-engine PRIVATE include)
  target_compile_options(boombapbot-engine PRIVATE ${SNARE_WARNINGS} ${SNARE_FLOAT_FLAGS} -O3 -fno-exceptions -fno-rtti)
  target_link_options(boombapbot-engine PRIVATE
    -O3 --no-entry -fno-exceptions
    -sSTANDALONE_WASM=1
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=33554432
    -sSTACK_SIZE=262144
    -sEXPORTED_FUNCTIONS=${SNARE_EXPORT_LIST})
  set_target_properties(boombapbot-engine PROPERTIES SUFFIX ".wasm")
  return()
endif()

add_library(boombapbot_engine STATIC ${SNARE_SOURCES})
target_include_directories(boombapbot_engine PUBLIC include)
target_compile_options(boombapbot_engine PRIVATE ${SNARE_WARNINGS} ${SNARE_FLOAT_FLAGS})
set_target_properties(boombapbot_engine PROPERTIES POSITION_INDEPENDENT_CODE ON)

get_filename_component(SNARE_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
set(SNARE_PATH_DEFINITIONS
  SNARE_CONTRACTS_DIR="${SNARE_REPO_ROOT}/packages/contracts"
  SNARE_ASSETS_DIR="${SNARE_REPO_ROOT}/assets")

if(SNARE_BUILD_TOOLS)
  add_executable(boombapbot-render tools/render_cli.cpp)
  target_link_libraries(boombapbot-render PRIVATE boombapbot_engine)
  target_compile_options(boombapbot-render PRIVATE ${SNARE_WARNINGS})
endif()

if(SNARE_BUILD_TESTS)
  enable_testing()
  foreach(suite timeline scheduler pattern_bank sequencer accent voices choke midi sound_map realtime synth)
    add_executable(test_${suite} tests/test_${suite}.cpp)
    target_link_libraries(test_${suite} PRIVATE boombapbot_engine)
    target_compile_options(test_${suite} PRIVATE ${SNARE_WARNINGS})
    target_compile_definitions(test_${suite} PRIVATE ${SNARE_PATH_DEFINITIONS})
    add_test(NAME engine.${suite} COMMAND test_${suite})
  endforeach()

  # Compiled as C, to prove engine.h is a C header and pin its struct layouts.
  add_executable(test_abi tests/test_abi.c)
  set_target_properties(test_abi PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED ON LINKER_LANGUAGE CXX)
  target_link_libraries(test_abi PRIVATE boombapbot_engine)
  target_compile_options(test_abi PRIVATE ${SNARE_WARNINGS})
  add_test(NAME engine.abi COMMAND test_abi)
endif()
