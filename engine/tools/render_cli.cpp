// boombapbot-render: renders a project through the native engine. It gives the
// reference output that the WebAssembly build is compared against.
//
//   boombapbot-render --project beat.json --contracts packages/contracts
//       --assets assets [--kit 909] [--rate 44100] [--bits 24]
//       [--out loop.wav] [--midi beat.mid] [--events events.json]
//
// It also writes one synthesised sound as raw little-endian float samples:
//
//   boombapbot-render --synth 7 --raw cymbal.f32 [--rate 48000]
//       [--tune 0.5] [--tone 0.5] [--decay 0.5] [--snappy 0.5]

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <string>
#include <vector>

#include "project_io.h"

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

}  // namespace

int main(int argc, char** argv) {
  std::map<std::string, std::string> options;
  for (int i = 1; i + 1 < argc; i += 2) options[argv[i]] = argv[i + 1];
  if (options.count("--synth") && options.count("--raw")) return writeSound(options);
  if (!options.count("--project") || !options.count("--contracts") || !options.count("--assets")) {
    std::fprintf(stderr,
                 "usage: boombapbot-render --project FILE --contracts DIR --assets DIR\n"
                 "         [--kit ID] [--rate HZ] [--bits 16|24] [--out FILE.wav]\n"
                 "         [--midi FILE.mid] [--events FILE.json]\n");
    return 2;
  }

  try {
    const std::string contracts = options["--contracts"];
    const double rate = options.count("--rate") ? std::atof(options["--rate"].c_str()) : 44100.0;
    const int bits = options.count("--bits") ? std::atoi(options["--bits"].c_str()) : 24;

    const snare::io::Roles roles = snare::io::loadRoles(contracts);
    const snare::io::Project project = snare::io::loadProject(options["--project"], roles);
    const std::string kitId = options.count("--kit") ? options["--kit"] : project.kitId;

    SnareEngine* engine = snare_engine_create(rate);
    if (!engine) throw std::runtime_error("unsupported sample rate");
    snare_engine_enable_event_log(engine, 8192);
    snare_engine_commit_kit(engine, snare::io::loadKit(contracts, options["--assets"], kitId, roles));
    snare::io::applyProject(engine, project);
    const snare::io::Rendered loop = snare::io::renderLoop(engine, project.bpm, rate);

    if (options.count("--out")) {
      snare::wav::writeFile(options["--out"],
                            snare::wav::encodeStereo(loop.left, loop.right, rate, bits));
    }

    if (options.count("--events")) {
      std::vector<SnareEvent> events(static_cast<std::size_t>(snare_engine_event_count(engine)));
      if (!events.empty()) {
        snare_engine_read_events(engine, events.data(), static_cast<int>(events.size()));
      }
      std::ofstream out(options["--events"]);
      out << "[";
      for (std::size_t i = 0; i < events.size(); ++i) {
        out << (i ? "," : "") << "\n  {\"frame\": " << static_cast<long long>(events[i].frame)
            << ", \"step\": " << events[i].step << ", \"role\": " << events[i].role
            << ", \"velocity\": " << events[i].velocity << "}";
      }
      out << "\n]\n";
    }

    if (options.count("--midi")) {
      const int roleCount = static_cast<int>(roles.ids.size());
      std::vector<std::uint8_t> flat(static_cast<std::size_t>(roleCount) * SNARE_STEPS);
      for (int role = 0; role < roleCount; ++role) {
        for (int step = 0; step < SNARE_STEPS; ++step) {
          flat[static_cast<std::size_t>(role * SNARE_STEPS + step)] = project.velocities[role][step];
        }
      }
      const int size = snare_midi_export(flat.data(), roleCount, roles.gmNotes.data(), project.bpm,
                                         project.swing, nullptr, 0);
      std::vector<std::uint8_t> midi(static_cast<std::size_t>(size));
      snare_midi_export(flat.data(), roleCount, roles.gmNotes.data(), project.bpm, project.swing,
                        midi.data(), size);
      snare::wav::writeFile(options["--midi"], midi);
    }

    std::printf("%s: kit %s, %.2f bpm, swing %.1f, %zu frames at %.0f Hz\n", project.name.c_str(),
                kitId.c_str(), project.bpm, project.swing, loop.left.size(), rate);
    snare_engine_destroy(engine);
  } catch (const std::exception& error) {
    std::fprintf(stderr, "boombapbot-render: %s\n", error.what());
    return 1;
  }
  return 0;
}
