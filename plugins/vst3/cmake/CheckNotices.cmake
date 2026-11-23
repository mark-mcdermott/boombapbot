# Checks that the built plugin carries its notices, and that they name what
# they must. Run as a script:
#
#   cmake -DNOTICES=... -DNAMES=one|two -P CheckNotices.cmake
if(NOT EXISTS "${NOTICES}")
  message(FATAL_ERROR "The plugin carries no notices at ${NOTICES}.")
endif()
file(READ "${NOTICES}" notices)
string(REPLACE "|" ";" names "${NAMES}")
foreach(name IN LISTS names)
  string(FIND "${notices}" "${name}" at)
  if(at EQUAL -1)
    message(FATAL_ERROR "The plugin's notices do not name ${name}.")
  endif()
endforeach()
