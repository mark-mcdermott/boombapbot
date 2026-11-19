# The plug-in's native library: the engine, built for a machine by the
# repository's own CMake, and the Oboe stream that plays it.
cmake_minimum_required(VERSION 3.22)
project(boombapbot_native LANGUAGES C CXX)

set(BOOMBAPBOT_MACHINE "ritm12" CACHE STRING "The machine this app is")

# Gradle may reach this folder through node_modules, so the repository is
# found from where the folder really is.
get_filename_component(here "${CMAKE_CURRENT_SOURCE_DIR}" REALPATH)
get_filename_component(repository "${here}/../../../../../../.." ABSOLUTE)

set(SNARE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(SNARE_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(BOOMBAPBOT_MACHINE_DIRS "${repository}/packages/machine-${BOOMBAPBOT_MACHINE}" CACHE STRING "" FORCE)
add_subdirectory("${repository}/engine" engine)
set(engine boombapbot_engine_${BOOMBAPBOT_MACHINE})
# Always optimised: the audio thread cannot wait for a debug build of the engine.
target_compile_options(${engine} PRIVATE -O3)

find_package(oboe REQUIRED CONFIG)

add_library(boombapbot_native SHARED native_engine.cpp)
set_target_properties(boombapbot_native PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON)
target_compile_options(boombapbot_native PRIVATE -Wall -Wextra -Wpedantic -Wshadow -O3)
target_link_libraries(boombapbot_native PRIVATE ${engine} oboe::oboe log)
