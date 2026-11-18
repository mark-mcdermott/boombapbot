# The engine's own suites. The engine is only ever built for a machine, so
# they are built with the test machine in test_machine.cpp and need no other.
boombapbot_add_machine(test SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/test_machine.cpp")

foreach(suite timeline scheduler pattern_bank sequencer accent voices choke midi realtime synthesis swing fx)
  add_executable(test_${suite} "${CMAKE_CURRENT_SOURCE_DIR}/test_${suite}.cpp")
  target_link_libraries(test_${suite} PRIVATE boombapbot_engine_test)
  target_compile_options(test_${suite} PRIVATE ${SNARE_WARNINGS})
  set_target_properties(test_${suite} PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
  add_test(NAME engine.${suite} COMMAND test_${suite})
endforeach()

# Compiled as C, to prove engine.h is a C header and pin its struct layouts.
add_executable(test_abi "${CMAKE_CURRENT_SOURCE_DIR}/test_abi.c")
set_target_properties(test_abi PROPERTIES
  C_STANDARD 11 C_STANDARD_REQUIRED ON LINKER_LANGUAGE CXX RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
target_link_libraries(test_abi PRIVATE boombapbot_engine_test)
target_compile_options(test_abi PRIVATE ${SNARE_WARNINGS})
add_test(NAME engine.abi COMMAND test_abi)
