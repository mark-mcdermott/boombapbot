# Writes the notices that go with every copy of the plugin: the licence of
# each piece of somebody else's work that is built into it. Run at build time,
# as a script:
#
#   cmake -DJUCE_DIR=... -DMONOCYPHER_DIR=... -DNOTICES=... [-DPAGE_NOTICES=...] -P WriteNotices.cmake
#
# The texts are read from the sources the build fetched, so they are the ones
# that came with the code that was compiled. PAGE_NOTICES is what the panel's
# page wrote of the packages in it (plugins/vst3/web/vite.config.ts).
set(modules "${JUCE_DIR}/modules")

function(notice name where file)
  if(NOT EXISTS "${file}")
    message(FATAL_ERROR "The licence of ${name} is not at ${file}, so the plugin's notices cannot be written.")
  endif()
  file(READ "${file}" text)
  string(APPEND notices "\n${name}\n${where}\n\n${text}\n================================================================\n")
  set(notices "${notices}" PARENT_SCOPE)
endfunction()

set(notices "boombapbot, the РИТМ-12 plugin, is built with JUCE (https://juce.com) and carries the work listed below.
Each is used under the licence printed beneath it.
================================================================
")

notice("VST 3 SDK" "https://github.com/steinbergmedia/vst3sdk"
  "${modules}/juce_audio_processors_headless/format_types/VST3_SDK/LICENSE.txt")
notice("Monocypher, taken under the 2-clause BSD licence" "https://monocypher.org"
  "${MONOCYPHER_DIR}/LICENCE.md")
notice("zlib" "https://zlib.net" "${modules}/juce_core/zip/zlib/LICENSE")
notice("libpng" "http://www.libpng.org" "${modules}/juce_graphics/image_formats/pnglib/LICENSE")
notice("HarfBuzz" "https://harfbuzz.github.io" "${modules}/juce_graphics/fonts/harfbuzz/COPYING")
notice("SheenBidi" "https://github.com/Tehreer/SheenBidi" "${modules}/juce_graphics/unicode/sheenbidi/LICENSE")

string(APPEND notices "\nlibjpeg\nhttps://ijg.org\n\nThis software is based in part on the work of the Independent JPEG Group.\n"
  "\n================================================================\n")

if(PAGE_NOTICES)
  if(NOT EXISTS "${PAGE_NOTICES}")
    message(FATAL_ERROR "The panel's page did not write the notices of its packages to ${PAGE_NOTICES}.")
  endif()
  file(READ "${PAGE_NOTICES}" page_notices)
  string(APPEND notices "\nIn the page the plugin's window shows:\n${page_notices}")
endif()

get_filename_component(notices_dir "${NOTICES}" DIRECTORY)
file(MAKE_DIRECTORY "${notices_dir}")
file(WRITE "${NOTICES}" "${notices}")
