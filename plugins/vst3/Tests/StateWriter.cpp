// Writes the plugin's state with a beat loaded, as a host would save it, so
// that the hosted check can hand it to the built bundle.
//
//   state_writer <beat file> <out>

#include "PluginProcessor.h"

#include <cstdio>
#include <memory>

int main(int argc, char** argv) {
  if (argc != 3) {
    std::fprintf(stderr, "usage: %s <beat file> <out>\n", argv[0]);
    return 2;
  }
  const juce::ScopedJuceInitialiser_GUI juceInitialiser;
  const juce::File directory = juce::File::getCurrentWorkingDirectory();

  const std::unique_ptr<juce::AudioProcessor> processor(createPluginFilter());
  const juce::Result loaded = dynamic_cast<BoombapbotAudioProcessor&>(*processor).loadBeat(
      directory.getChildFile(juce::String::fromUTF8(argv[1])).loadFileAsString());
  if (loaded.failed()) {
    std::fprintf(stderr, "FAIL the beat did not load: %s\n", loaded.getErrorMessage().toRawUTF8());
    return 1;
  }

  juce::MemoryBlock state;
  processor->getStateInformation(state);
  const juce::File out = directory.getChildFile(juce::String::fromUTF8(argv[2]));
  if (!out.replaceWithData(state.getData(), state.getSize())) {
    std::fprintf(stderr, "FAIL the state could not be written to %s\n", out.getFullPathName().toRawUTF8());
    return 1;
  }
  std::printf("ok   wrote a state of %d bytes with the beat in it\n", static_cast<int>(state.getSize()));
  return 0;
}
