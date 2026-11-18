// boombapbot-render: renders through the native engine. It gives the
// reference output that the WebAssembly build is compared against, and it
// knows no machine: it is built once for each, with that machine's voices.
//
// From an engine setup: the file names a sample rate, a setup as the editor
// writes one, the pattern to play and for how many measures, and optionally
// the notes and velocities of a MIDI file. What is written is those
// measures, from silence.
//
//   boombapbot-render --setup run.json [--bits 16|24]
//       [--out measures.wav] [--midi beat.mid] [--events events.json]
//
// One synthesised sound, as raw little-endian float samples:
//
//   boombapbot-render --synth 7 --raw sound.f32 [--rate 48000]
//       [--tune 0.5] [--tone 0.5] [--decay 0.5] [--snappy 0.5]

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <string>
#include <vector>

#include "render.h"
#include "setup_io.h"
#include "wav_io.h"

namespace {

int writeSound(std::map<std::string, std::string>& options) {
  const auto knob = [&options](const char* name) {
    return options.count(name) ? static_cast<float>(std::atof(options[name].c_str())) : 0.5f;
  };
  const double rate = options.count("--rate") ? std::atof(options["--rate"].c_str()) : 44100.0;
  const SnareSoundParams params{std::atoi(options["--synth"].c_str()), knob("--tune"), knob("--tone"),
                                knob("--decay"), knob("--snappy"), 0};
  const int frames = snare_synth_frames(&params, rate);
  if (frames <= 0) {
    std::fprintf(stderr, "boombapbot-render: sound %d cannot be synthesised at %.0f Hz\n", params.sound, rate);
    return 1;
  }
  std::vector<float> pcm(static_cast<std::size_t>(frames));
  snare_synth_render(&params, rate, pcm.data(), frames);
  std::ofstream out(options["--raw"], std::ios::binary);
  out.write(reinterpret_cast<const char*>(pcm.data()),
            static_cast<std::streamsize>(pcm.size() * sizeof(float)));
  return out ? 0 : 1;
}

void writeEvents(const SnareEngine* engine, const std::string& path) {
  std::vector<SnareEvent> events(static_cast<std::size_t>(snare_engine_event_count(engine)));
  if (!events.empty()) snare_engine_read_events(engine, events.data(), static_cast<int>(events.size()));
  std::ofstream out(path);
  out << "[";
  for (std::size_t i = 0; i < events.size(); ++i) {
    out << (i ? "," : "") << "\n  {\"frame\": " << static_cast<long long>(events[i].frame)
        << ", \"step\": " << events[i].step << ", \"track\": " << events[i].track
        << ", \"accent\": " << events[i].accent << ", \"pattern\": " << events[i].pattern << "}";
  }
  out << "\n]\n";
}

void writeMidi(const std::string& path, const SnarePattern* patterns, int count,
               const std::vector<std::uint8_t>& sequence, const std::uint8_t* notes, int plain, int accented,
               double bpm) {
  const int measures = static_cast<int>(sequence.size());
  const int size =
      snare_midi_export(patterns, count, sequence.data(), measures, notes, plain, accented, bpm, nullptr, 0);
  if (size < 0) throw std::runtime_error("the engine refused the MIDI export");
  std::vector<std::uint8_t> midi(static_cast<std::size_t>(size));
  snare_midi_export(patterns, count, sequence.data(), measures, notes, plain, accented, bpm, midi.data(), size);
  snare::wav::writeFile(path, midi);
}

int renderSetup(std::map<std::string, std::string>& options) {
  const snare::json::Value run = snare::json::parseFile(options["--setup"]);
  const double rate = run.at("rate").number;
  const int bits = options.count("--bits") ? std::atoi(options["--bits"].c_str()) : 24;
  const snare::io::Setup setup = snare::io::readSetup(run.at("setup"));
  const int index = run.at("pattern").asInt();
  const int measures = run.at("measures").asInt();
  if (index < 0 || index >= static_cast<int>(setup.patterns.size())) throw std::runtime_error("no such pattern");
  if (measures < 1) throw std::runtime_error("nothing to play");

  SnareEngine* engine = snare_engine_create(rate);
  if (!engine) throw std::runtime_error("unsupported sample rate");
  snare_engine_enable_event_log(engine, 8192);
  snare::io::applySetup(engine, setup);
  const SnarePattern& pattern = setup.patterns[static_cast<std::size_t>(index)];
  const int frames =
      static_cast<int>(snare_tick_frame(static_cast<double>(measures) * snare_pattern_ticks(&pattern), setup.tempo, rate));
  snare::io::must(snare_engine_cue_pattern(engine, index), "the pattern");
  snare::io::must(snare_engine_play_measures(engine, measures), "to play");
  const snare::io::Rendered audio = snare::io::render(engine, frames);

  if (options.count("--out")) {
    snare::wav::writeFile(options["--out"], snare::wav::encodeStereo(audio.left, audio.right, rate, bits));
  }
  if (options.count("--events")) writeEvents(engine, options["--events"]);
  if (options.count("--midi")) {
    const snare::json::Value& midi = run.at("midi");
    std::uint8_t notes[SNARE_TRACKS]{};
    for (std::size_t track = 0; track < SNARE_TRACKS && track < midi.at("notes").array.size(); ++track) {
      notes[track] = static_cast<std::uint8_t>(midi.at("notes").array[track].asInt());
    }
    const std::vector<std::uint8_t> sequence(static_cast<std::size_t>(measures), static_cast<std::uint8_t>(index));
    writeMidi(options["--midi"], setup.patterns.data(), static_cast<int>(setup.patterns.size()), sequence, notes,
              midi.at("plain").asInt(), midi.at("accented").asInt(), setup.tempo);
  }
  std::printf("pattern %d, %d measure(s), %.2f bpm, %d frames at %.0f Hz\n", index, measures, setup.tempo, frames,
              rate);
  snare_engine_destroy(engine);
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  std::map<std::string, std::string> options;
  for (int i = 1; i + 1 < argc; i += 2) options[argv[i]] = argv[i + 1];
  if (options.count("--synth") && options.count("--raw")) return writeSound(options);
  if (!options.count("--setup")) {
    std::fprintf(stderr,
                 "usage: boombapbot-render --setup FILE [--bits 16|24] [--out FILE.wav] [--midi FILE.mid]\n"
                 "         [--events FILE.json]\n"
                 "       boombapbot-render --synth N --raw FILE.f32 [--rate HZ] [--tune 0..1] [--tone 0..1]\n"
                 "         [--decay 0..1] [--snappy 0..1]\n");
    return 2;
  }
  try {
    return renderSetup(options);
  } catch (const std::exception& error) {
    std::fprintf(stderr, "boombapbot-render: %s\n", error.what());
    return 1;
  }
}
