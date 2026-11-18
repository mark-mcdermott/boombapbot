# The engine built for РИТМ-12: the core with its eight voices.
boombapbot_add_machine(ritm12 SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/voices.cpp")

if(EMSCRIPTEN)
  return()
endif()

if(SNARE_BUILD_TOOLS)
  # The core's render tool with this machine's voices in it: what the
  # WebAssembly build of РИТМ-12 is compared with.
  add_executable(boombapbot-render-ritm12 "${BOOMBAPBOT_ENGINE_DIR}/tools/render_cli.cpp")
  target_link_libraries(boombapbot-render-ritm12 PRIVATE boombapbot_engine_ritm12)
  target_compile_options(boombapbot-render-ritm12 PRIVATE ${SNARE_WARNINGS})
  set_target_properties(boombapbot-render-ritm12 PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
endif()

if(SNARE_BUILD_TESTS)
  add_executable(test_ritm12_voices "${CMAKE_CURRENT_SOURCE_DIR}/test_voices.cpp")
  target_include_directories(test_ritm12_voices PRIVATE "${BOOMBAPBOT_ENGINE_DIR}/tests")
  target_link_libraries(test_ritm12_voices PRIVATE boombapbot_engine_ritm12)
  target_compile_options(test_ritm12_voices PRIVATE ${SNARE_WARNINGS})
  set_target_properties(test_ritm12_voices PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
  add_test(NAME ritm12.voices COMMAND test_ritm12_voices)
endif()
