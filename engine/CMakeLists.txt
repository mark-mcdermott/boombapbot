cmake_minimum_required(VERSION 3.22)
project(boombapbot_engine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

option(SNARE_BUILD_TESTS "Build the CTest suites" ON)
option(SNARE_BUILD_TOOLS "Build the render command line tools" ON)
# Each machine is a package with an engine/CMakeLists.txt that calls
# boombapbot_add_machine. The engine is only ever built for a machine. Left
# unset, that is every machine package beside the engine in this repository.
set(BOOMBAPBOT_MACHINE_DIRS "" CACHE STRING "Machine packages to build the engine for, separated by semicolons")

include(cmake/BoombapbotMachine.cmake)

if(SNARE_BUILD_TESTS AND NOT EMSCRIPTEN)
  enable_testing()
endif()

set(machine_dirs ${BOOMBAPBOT_MACHINE_DIRS})
if(NOT machine_dirs)
  file(GLOB machine_lists "${CMAKE_CURRENT_SOURCE_DIR}/../packages/machine-*/engine/CMakeLists.txt")
  foreach(machine_list ${machine_lists})
    get_filename_component(machine_engine_dir "${machine_list}" DIRECTORY)
    get_filename_component(machine_dir "${machine_engine_dir}" DIRECTORY)
    list(APPEND machine_dirs "${machine_dir}")
  endforeach()
endif()
if(NOT machine_dirs)
  message(FATAL_ERROR "No machine to build the engine for. Set BOOMBAPBOT_MACHINE_DIRS.")
endif()
foreach(machine_dir ${machine_dirs})
  get_filename_component(machine_name "${machine_dir}" NAME)
  add_subdirectory("${machine_dir}/engine" "machines/${machine_name}")
endforeach()
