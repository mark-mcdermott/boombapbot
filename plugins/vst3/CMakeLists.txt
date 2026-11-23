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

# For hunting bugs, not for a build anyone plays: everything here, JUCE and the
# engine included, built under sanitizers. "address,undefined" finds memory
# errors and undefined behaviour; "thread" finds data races between the audio
# thread, the sound thread and the panel.
set(BOOMBAPBOT_VST3_SANITIZE "" CACHE STRING "Sanitizers to build with, such as address,undefined or thread")
if(BOOMBAPBOT_VST3_SANITIZE)
  add_compile_options(-fsanitize=${BOOMBAPBOT_VST3_SANITIZE} -fno-omit-frame-pointer -g)
  add_link_options(-fsanitize=${BOOMBAPBOT_VST3_SANITIZE})
endif()

get_filename_component(BOOMBAPBOT_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
set(MACHINE_RITM12_DIR "${BOOMBAPBOT_REPO_ROOT}/packages/machine-ritm12")

# ---- JUCE -------------------------------------------------------------------
# Fetched at configure time and never vendored. JUCE 8 is AGPLv3 or commercial.
# The commercial licence's free tier is chosen: see "Licensing" in README.md
# for its limits and for what is left before anything built from this is
# distributed.
# To build against a local checkout instead of cloning, pass
# -DFETCHCONTENT_SOURCE_DIR_JUCE=/path/to/JUCE.
include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.17-security
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

# ---- Ed25519 ----------------------------------------------------------------
# The upgrade's license file is signed with Ed25519, which JUCE does not have.
# Monocypher does, in its optional unit, and is fetched like JUCE and never
# vendored. It is pinned to the commit its 4.0.2 tag names. See "Licensing" in
# README.md for its terms.
FetchContent_Declare(monocypher
  GIT_REPOSITORY https://github.com/LoupVaillant/Monocypher.git
  GIT_TAG 0d85f98c9d9b0227e42cf795cb527dff372b40a4)
FetchContent_MakeAvailable(monocypher)
add_library(boombapbot_ed25519 STATIC
  "${monocypher_SOURCE_DIR}/src/monocypher.c"
  "${monocypher_SOURCE_DIR}/src/optional/monocypher-ed25519.c")
target_include_directories(boombapbot_ed25519 SYSTEM PUBLIC
  "${monocypher_SOURCE_DIR}/src"
  "${monocypher_SOURCE_DIR}/src/optional")
set_target_properties(boombapbot_ed25519 PROPERTIES POSITION_INDEPENDENT_CODE ON)

# ---- Shared engine ----------------------------------------------------------
# The same static library the desktop app links. Its tests and the render
# command line tool are not part of the plugin build.
set(SNARE_BUILD_TESTS OFF CACHE BOOL "Build the CTest suites" FORCE)
set(SNARE_BUILD_TOOLS OFF CACHE BOOL "Build the render command line tools" FORCE)
set(BOOMBAPBOT_MACHINE_DIRS "${MACHINE_RITM12_DIR}" CACHE STRING "Machine packages to build the engine for" FORCE)
add_subdirectory("${BOOMBAPBOT_REPO_ROOT}/engine" "${CMAKE_CURRENT_BINARY_DIR}/engine")

# ---- The window: the painted panel in a web view, or the panel drawn here ----
# ON, the window shows the panel the site and the apps show, as a page in a
# web view (Source/WebPanel, plugins/vst3/web). OFF, it shows the panel drawn
# in Source/Panel, which needs no web view and no page.
option(BOOMBAPBOT_VST3_WEB_PANEL "Show the painted panel in a web view" ON)
# The page is built with pnpm as part of the build. OFF packs web/dist as it
# was last built, for a machine that has the page and not pnpm.
option(BOOMBAPBOT_VST3_BUILD_PAGE "Build the panel's page with pnpm as part of the build" ON)
set(web_panel_plugin_options "")
if(BOOMBAPBOT_VST3_WEB_PANEL)
  set(panel_page "${CMAKE_CURRENT_SOURCE_DIR}/web/dist")
  set(panel_pnpm "")
  if(BOOMBAPBOT_VST3_BUILD_PAGE)
    find_program(BOOMBAPBOT_PNPM pnpm)
    if(BOOMBAPBOT_PNPM)
      set(panel_pnpm "${BOOMBAPBOT_PNPM}")
    endif()
  endif()
  if(NOT panel_pnpm AND NOT EXISTS "${panel_page}/index.html")
    message(FATAL_ERROR
      "The plugin's window is a page that pnpm builds, and the page is not built.\n"
      "Install pnpm and run \"pnpm install\" at the repository root, or build the page yourself with\n"
      "  pnpm --filter @boombapbot/vst3-panel build\n"
      "or pass -DBOOMBAPBOT_VST3_WEB_PANEL=OFF for the panel that needs no page.")
  endif()
  set(web_panel_plugin_options NEEDS_WEB_BROWSER TRUE)
endif()

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
  COPY_PLUGIN_AFTER_BUILD FALSE
  ${web_panel_plugin_options})

target_sources(boombapbot_plugin PRIVATE
  Source/BeatDesk.cpp
  Source/BeatDesk.h
  Source/BeatFile.cpp
  Source/BeatFile.h
  Source/LicenseFile.cpp
  Source/LicenseFile.h
  Source/MachineRitm12.h
  Source/Panel/Panel.cpp
  Source/Panel/Panel.h
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
  JUCE_WEB_BROWSER=$<BOOL:${BOOMBAPBOT_VST3_WEB_PANEL}>
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

if(BOOMBAPBOT_VST3_WEB_PANEL)
  # The page goes into the plugin as one zip, and is served from there. It is
  # built and packed on every build, and the zip changes only when the page does.
  set(panel_zip "${CMAKE_CURRENT_BINARY_DIR}/panel.zip")
  add_custom_target(boombapbot_panel_zip
    COMMAND "${CMAKE_COMMAND}"
      "-DREPO_ROOT=${BOOMBAPBOT_REPO_ROOT}"
      "-DPAGE_DIR=${panel_page}"
      "-DPANEL_ZIP=${panel_zip}"
      "-DPNPM=${panel_pnpm}"
      -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/PackPanelPage.cmake"
    BYPRODUCTS "${panel_zip}"
    COMMENT "Building and packing the panel's page"
    VERBATIM)
  juce_add_binary_data(boombapbot_panel_page SOURCES "${panel_zip}")
  set_target_properties(boombapbot_panel_page PROPERTIES POSITION_INDEPENDENT_CODE ON)
  add_dependencies(boombapbot_panel_page boombapbot_panel_zip)
  target_sources(boombapbot_plugin PRIVATE
    Source/WebPanel/WebPanelEditor.cpp
    Source/WebPanel/WebPanelEditor.h)
  target_compile_definitions(boombapbot_plugin PUBLIC BOOMBAPBOT_WEB_PANEL=1)
  target_link_libraries(boombapbot_plugin PRIVATE boombapbot_panel_page juce::juce_gui_extra)
endif()

target_link_libraries(boombapbot_plugin
  PRIVATE
    boombapbot_ed25519
    boombapbot_engine_ritm12
    juce::juce_audio_processors
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)

# The licences of what the plugin is built from go with every copy of it,
# inside the bundle. They are written before the bundle is signed.
set(plugin_notices "$<TARGET_GENEX_EVAL:boombapbot_plugin_VST3,$<TARGET_PROPERTY:boombapbot_plugin_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>/Contents/Resources/NOTICES.txt")
set(page_notices "")
if(BOOMBAPBOT_VST3_WEB_PANEL)
  set(page_notices "-DPAGE_NOTICES=${panel_page}/third-party-notices.txt")
endif()
add_custom_command(TARGET boombapbot_plugin_VST3 POST_BUILD
  COMMAND "${CMAKE_COMMAND}"
    "-DJUCE_DIR=${juce_SOURCE_DIR}"
    "-DMONOCYPHER_DIR=${monocypher_SOURCE_DIR}"
    "-DNOTICES=${plugin_notices}"
    ${page_notices}
    -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/WriteNotices.cmake"
  COMMENT "Writing the notices that go with the plugin"
  VERBATIM)

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
      BOOMBAPBOT_FIXTURES_DIR="${MACHINE_RITM12_DIR}/fixtures"
      BOOMBAPBOT_LICENSE_CONTRACT="${BOOMBAPBOT_REPO_ROOT}/packages/contracts/src/license-file.ts"
      BOOMBAPBOT_LICENSE_PAGE="${BOOMBAPBOT_REPO_ROOT}/docs/license-file.md")
    target_link_libraries(${target} PRIVATE
      boombapbot_plugin
      juce::juce_recommended_warning_flags)
  endfunction()

  boombapbot_plugin_program(boombapbot_state_writer Tests/StateWriter.cpp)
  boombapbot_plugin_program(boombapbot_plugin_selftest Tests/ProcessorSelfTest.cpp)
  # The heap trap stands in for the allocator, and so do the sanitizers. Under
  # them the trap is left out and the check that needs it says it was skipped.
  target_sources(boombapbot_plugin_selftest PRIVATE Tests/HeapTrap.cpp Tests/HeapTrap.h)
  if(BOOMBAPBOT_VST3_SANITIZE)
    target_compile_definitions(boombapbot_plugin_selftest PRIVATE BOOMBAPBOT_NO_HEAP_TRAP=1)
  endif()
  boombapbot_plugin_program(boombapbot_window_snapshot Tests/WindowSnapshot.cpp)
  boombapbot_plugin_program(boombapbot_license_file_test Tests/LicenseFileTest.cpp)
  add_test(NAME vst3.processor_selftest COMMAND boombapbot_plugin_selftest)
  # The check of the license file is told where the machine's file is, so it
  # never reads, writes or removes the one a person keeps.
  add_test(NAME vst3.license_file COMMAND boombapbot_license_file_test)
  set(noticed_names "VST 3 SDK|Monocypher|zlib|libpng|HarfBuzz|SheenBidi|Independent JPEG Group")
  if(BOOMBAPBOT_VST3_WEB_PANEL)
    string(APPEND noticed_names "|react-dom|sofia-sans-condensed")
  endif()
  add_test(NAME vst3.bundle_notices
    COMMAND "${CMAKE_COMMAND}" "-DNOTICES=${plugin_notices}" "-DNAMES=${noticed_names}"
      -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/CheckNotices.cmake")
  set_tests_properties(vst3.license_file PROPERTIES
    ENVIRONMENT "BOOMBAPBOT_LICENSE_FILE=${CMAKE_CURRENT_BINARY_DIR}/license-file-test/boombapbot.license")
  add_test(NAME vst3.window_snapshot
    COMMAND boombapbot_window_snapshot "${CMAKE_CURRENT_BINARY_DIR}/window.png"
      "${MACHINE_RITM12_DIR}/fixtures/four-patterns.project.json")
  # The window with the page in it is opened for real, which wants a desktop.
  if(BOOMBAPBOT_VST3_WEB_PANEL AND APPLE)
    boombapbot_plugin_program(boombapbot_web_panel_check Tests/WebPanelCheck.cpp)
    target_link_libraries(boombapbot_web_panel_check PRIVATE "-framework CoreFoundation")
    add_test(NAME vst3.web_panel
      COMMAND boombapbot_web_panel_check "${MACHINE_RITM12_DIR}/fixtures/four-patterns.project.json")
  endif()

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
      JUCE_MODAL_LOOPS_PERMITTED=1
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
    # The hosted check is handed a state with a beat in it, which the plugin's
    # own code writes first.
    set(beat_state "${CMAKE_CURRENT_BINARY_DIR}/beat.state")
    add_test(NAME vst3.beat_state
      COMMAND boombapbot_state_writer "${MACHINE_RITM12_DIR}/fixtures/four-patterns.project.json" "${beat_state}")
    set_tests_properties(vst3.beat_state PROPERTIES FIXTURES_SETUP beat_state)
    add_test(NAME vst3.bundle_hosted COMMAND boombapbot_bundle_host_check "${plugin_bundle}" "${beat_state}")
    set_tests_properties(vst3.bundle_hosted PROPERTIES FIXTURES_REQUIRED beat_state)

    # Steinberg's own validator, built from its VST3 SDK, which is fetched for
    # this and is no part of the plugin. Its build is kept apart from this one
    # because the SDK's build files set options for everything around them.
    option(BOOMBAPBOT_VST3_STEINBERG_VALIDATOR "Fetch Steinberg's VST3 SDK and run its validator on the bundle" OFF)
    if(BOOMBAPBOT_VST3_STEINBERG_VALIDATOR)
      include(ExternalProject)
      string(REPLACE ";" "|" validator_architectures "${CMAKE_OSX_ARCHITECTURES}")
      ExternalProject_Add(steinberg_validator
        GIT_REPOSITORY https://github.com/steinbergmedia/vst3sdk.git
        GIT_TAG v3.8.1_build_84
        GIT_SHALLOW TRUE
        GIT_SUBMODULES base pluginterfaces public.sdk cmake
        LIST_SEPARATOR |
        CMAKE_ARGS
          -DCMAKE_BUILD_TYPE=Release
          -DCMAKE_OSX_ARCHITECTURES=${validator_architectures}
          -DCMAKE_OSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET}
          -DSMTG_ENABLE_VSTGUI_SUPPORT=OFF
          -DSMTG_ENABLE_VST3_PLUGIN_EXAMPLES=OFF
          -DSMTG_ENABLE_VST3_HOSTING_EXAMPLES=ON
          -DSMTG_RUN_VST_VALIDATOR=OFF
          -DSMTG_CREATE_PLUGIN_LINK=OFF
        BUILD_COMMAND "${CMAKE_COMMAND}" --build <BINARY_DIR> --target validator
        INSTALL_COMMAND "")
      ExternalProject_Get_Property(steinberg_validator BINARY_DIR)
      set(steinberg_validator_program "${BINARY_DIR}/bin/Release/validator")
      # -e runs the extensive tests as well as the plain ones.
      add_test(NAME vst3.steinberg_validator COMMAND "${steinberg_validator_program}" -e "${plugin_bundle}")
    endif()

    # The Intel half is run under Rosetta where there is one, which is how a
    # host that has not moved to Apple silicon runs it.
    execute_process(COMMAND arch -x86_64 /usr/bin/true RESULT_VARIABLE rosetta_missing OUTPUT_QUIET ERROR_QUIET)
    if("arm64" IN_LIST CMAKE_OSX_ARCHITECTURES AND "x86_64" IN_LIST CMAKE_OSX_ARCHITECTURES)
      add_test(NAME vst3.bundle_architectures COMMAND lipo "${plugin_binary}" -verify_arch arm64 x86_64)
      if(CMAKE_HOST_SYSTEM_PROCESSOR STREQUAL "arm64" AND NOT rosetta_missing)
        add_test(NAME vst3.processor_selftest_x86_64
          COMMAND arch -x86_64 "$<TARGET_FILE:boombapbot_plugin_selftest>")
        add_test(NAME vst3.license_file_x86_64
          COMMAND arch -x86_64 "$<TARGET_FILE:boombapbot_license_file_test>")
        set_tests_properties(vst3.license_file_x86_64 PROPERTIES
          ENVIRONMENT "BOOMBAPBOT_LICENSE_FILE=${CMAKE_CURRENT_BINARY_DIR}/license-file-test-x86_64/boombapbot.license")
        if(BOOMBAPBOT_VST3_WEB_PANEL)
          add_test(NAME vst3.web_panel_x86_64
            COMMAND arch -x86_64 "$<TARGET_FILE:boombapbot_web_panel_check>"
              "${MACHINE_RITM12_DIR}/fixtures/four-patterns.project.json")
        endif()
        add_test(NAME vst3.bundle_loads_x86_64
          COMMAND arch -x86_64 "$<TARGET_FILE:boombapbot_bundle_load_check>" "${plugin_binary}")
        add_test(NAME vst3.bundle_hosted_x86_64
          COMMAND arch -x86_64 "$<TARGET_FILE:boombapbot_bundle_host_check>" "${plugin_bundle}" "${beat_state}")
        set_tests_properties(vst3.bundle_hosted_x86_64 PROPERTIES FIXTURES_REQUIRED beat_state)
        if(BOOMBAPBOT_VST3_STEINBERG_VALIDATOR)
          add_test(NAME vst3.steinberg_validator_x86_64
            COMMAND arch -x86_64 "${steinberg_validator_program}" -e "${plugin_bundle}")
        endif()
      endif()
    endif()
  endif()
endif()
