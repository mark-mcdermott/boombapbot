# Builds the page the plugin's window shows and packs it into one zip, for the
# plugin to carry. Run at build time, as a script:
#
#   cmake -DREPO_ROOT=... -DPAGE_DIR=... -DPANEL_ZIP=... [-DPNPM=...] -P PackPanelPage.cmake
#
# With PNPM the page is built first; without, the page as it was last built is
# packed. The zip is only replaced when what it holds has changed, so a build
# with nothing new in the page relinks nothing.
if(PNPM)
  execute_process(
    COMMAND "${PNPM}" --filter @boombapbot/vst3-panel build
    WORKING_DIRECTORY "${REPO_ROOT}"
    RESULT_VARIABLE page_failed
    OUTPUT_VARIABLE page_log
    ERROR_VARIABLE page_log)
  if(page_failed)
    message(FATAL_ERROR "The panel's page did not build:\n${page_log}\n"
      "Run \"pnpm install\" at the repository root if its packages are missing.")
  endif()
endif()

if(NOT EXISTS "${PAGE_DIR}/index.html")
  message(FATAL_ERROR "The panel's page is not built, and pnpm was not found to build it.\n"
    "Install pnpm, or run: pnpm --filter @boombapbot/vst3-panel build")
endif()

file(GLOB_RECURSE page_files RELATIVE "${PAGE_DIR}" "${PAGE_DIR}/*")
list(SORT page_files)
# One date for every file: the zip is then the same bytes for the same page.
execute_process(
  COMMAND "${CMAKE_COMMAND}" -E tar cf "${PANEL_ZIP}.new" --format=zip "--mtime=2000-01-01 00:00:00 UTC" -- ${page_files}
  WORKING_DIRECTORY "${PAGE_DIR}"
  RESULT_VARIABLE pack_failed)
if(pack_failed)
  message(FATAL_ERROR "The panel's page could not be packed into ${PANEL_ZIP}.")
endif()
execute_process(COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${PANEL_ZIP}.new" "${PANEL_ZIP}")
file(REMOVE "${PANEL_ZIP}.new")
