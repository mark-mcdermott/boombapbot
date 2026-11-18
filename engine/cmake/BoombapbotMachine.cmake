# What every build of the engine shares, and the one function a machine calls
# to get an engine with its voices in it. Include this file from any CMake
# project that builds a machine; it finds the engine's sources by its own
# place on disk.

get_filename_component(BOOMBAPBOT_ENGINE_DIR "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)

# The engine core. It has no voices: a machine's sources define
# boombapbot::machineVoices() (include/boombapbot/voices.h).
set(BOOMBAPBOT_CORE_SOURCES
  "${BOOMBAPBOT_ENGINE_DIR}/src/engine.cpp"
  "${BOOMBAPBOT_ENGINE_DIR}/src/midi.cpp"
  "${BOOMBAPBOT_ENGINE_DIR}/src/synth.cpp")
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
  snare_engine_set_master_volume snare_engine_set_effect snare_effect_tail_seconds
  snare_engine_set_pattern snare_engine_set_step
  snare_engine_cue_pattern snare_engine_set_panel snare_engine_arm_fill
  snare_engine_set_song snare_song_patterns
  snare_engine_play snare_engine_play_measures snare_engine_stop snare_engine_trigger
  snare_engine_render
  snare_engine_is_playing snare_engine_current_step snare_engine_current_pattern snare_engine_current_measure
  snare_engine_frames_rendered snare_engine_stop_frame
  snare_engine_active_voices snare_engine_stolen_voices snare_engine_output_level
  snare_engine_enable_event_log snare_engine_event_count snare_engine_read_events
  snare_engine_read_measures
  snare_midi_export)

# boombapbot_add_machine(<id> SOURCES <files>...)
#
# Builds the engine for one machine from the core and the machine's own
# sources. Natively that is the static library boombapbot_engine_<id>. Under
# Emscripten it is boombapbot-engine-<id>.wasm, at the top of the build tree.
function(boombapbot_add_machine id)
  cmake_parse_arguments(MACHINE "" "" "SOURCES" ${ARGN})
  if(EMSCRIPTEN)
    # A standalone module with no JavaScript glue: the AudioWorklet, the
    # offline exporter and the Node tests all instantiate the same .wasm
    # directly. No threads or shared memory, so no cross-origin isolation is
    # required. Memory starts large enough for a full set of sounds and the
    # ones a knob drag replaces, so it does not have to grow on the audio
    # thread.
    list(TRANSFORM SNARE_WASM_EXPORTS PREPEND "_" OUTPUT_VARIABLE symbols)
    list(JOIN symbols "," export_list)
    set(target boombapbot-engine-${id})
    add_executable(${target} ${BOOMBAPBOT_CORE_SOURCES} ${MACHINE_SOURCES})
    target_include_directories(${target} PRIVATE "${BOOMBAPBOT_ENGINE_DIR}/include")
    target_compile_options(${target} PRIVATE ${SNARE_WARNINGS} ${SNARE_FLOAT_FLAGS} -O3 -fno-exceptions -fno-rtti)
    target_link_options(${target} PRIVATE
      -O3 --no-entry -fno-exceptions
      -sSTANDALONE_WASM=1
      -sALLOW_MEMORY_GROWTH=1
      -sINITIAL_MEMORY=33554432
      -sSTACK_SIZE=262144
      -sEXPORTED_FUNCTIONS=${export_list})
    set_target_properties(${target} PROPERTIES SUFFIX ".wasm" RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
  else()
    set(target boombapbot_engine_${id})
    add_library(${target} STATIC ${BOOMBAPBOT_CORE_SOURCES} ${MACHINE_SOURCES})
    target_include_directories(${target} PUBLIC "${BOOMBAPBOT_ENGINE_DIR}/include")
    target_compile_options(${target} PRIVATE ${SNARE_WARNINGS} ${SNARE_FLOAT_FLAGS})
    set_target_properties(${target} PROPERTIES POSITION_INDEPENDENT_CODE ON)
  endif()
endfunction()
