// Paints the plugin's window to a PNG, with no host and no screen, so the
// panel can be looked at and so a build that paints nothing is caught.
//
//   window_snapshot <out.png> [beat file]

#include "PluginEditor.h"
#include "PluginProcessor.h"

#include <cstdio>
#include <memory>
#include <set>

namespace {

constexpr float kScale = 2.0f;
// A panel that painted has many colours in it; a blank one has one.
constexpr int kColoursLeast = 64;

int coloursIn(const juce::Image& image) {
  std::set<juce::uint32> seen;
  const juce::Image::BitmapData pixels(image, juce::Image::BitmapData::readOnly);
  for (int y = 0; y < image.getHeight(); y += 3) {
    for (int x = 0; x < image.getWidth(); x += 3) seen.insert(pixels.getPixelColour(x, y).getARGB());
  }
  return static_cast<int>(seen.size());
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2 || argc > 3) {
    std::fprintf(stderr, "usage: %s <out.png> [beat file]\n", argv[0]);
    return 2;
  }
  const juce::ScopedJuceInitialiser_GUI juceInitialiser;

  const std::unique_ptr<juce::AudioProcessor> processor(createPluginFilter());
  processor->setPlayConfigDetails(0, 2, 48000.0, 512);
  processor->prepareToPlay(48000.0, 512);
  if (argc == 3) {
    const juce::File beat = juce::File::getCurrentWorkingDirectory().getChildFile(juce::String::fromUTF8(argv[2]));
    const juce::Result loaded = dynamic_cast<BoombapbotAudioProcessor&>(*processor).loadBeat(beat.loadFileAsString());
    if (loaded.failed()) {
      std::fprintf(stderr, "FAIL the beat did not load: %s\n", loaded.getErrorMessage().toRawUTF8());
      return 1;
    }
  }

  juce::AudioProcessorEditor* const editor = new BoombapbotEditor(dynamic_cast<BoombapbotAudioProcessor&>(*processor));
  if (editor == nullptr || editor->getWidth() <= 0 || editor->getHeight() <= 0) {
    std::fprintf(stderr, "FAIL the plugin has no window\n");
    return 1;
  }
  const juce::Image image = editor->createComponentSnapshot(editor->getLocalBounds(), true, kScale);
  const int width = editor->getWidth();
  const int height = editor->getHeight();
  // Closed as a host closes it: the processor is told before the window goes.
  processor->editorBeingDeleted(editor);
  delete editor;

  const juce::File out = juce::File::getCurrentWorkingDirectory().getChildFile(juce::String::fromUTF8(argv[1]));
  out.deleteFile();
  juce::FileOutputStream stream(out);
  if (!stream.openedOk() || !juce::PNGImageFormat().writeImageToStream(image, stream)) {
    std::fprintf(stderr, "FAIL the picture could not be written to %s\n", out.getFullPathName().toRawUTF8());
    return 1;
  }

  const int colours = coloursIn(image);
  std::printf("%s the window is %d x %d and its picture holds %d colours\n", colours >= kColoursLeast ? "ok  " : "FAIL",
              width, height, colours);
  return colours >= kColoursLeast ? 0 : 1;
}
