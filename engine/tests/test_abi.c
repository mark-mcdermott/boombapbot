/*
 * The public header is a C header. This file is compiled as C to prove it,
 * and pins the layout of every struct that crosses the ABI, because the
 * WebAssembly bridge reads them by byte offset.
 */

#include <stddef.h>

#include "boombapbot/engine.h"

_Static_assert(sizeof(SnareEvent) == 24, "SnareEvent is read as 24 bytes by wasm-engine.ts");
_Static_assert(offsetof(SnareEvent, frame) == 0, "SnareEvent.frame");
_Static_assert(offsetof(SnareEvent, step) == 8, "SnareEvent.step");
_Static_assert(offsetof(SnareEvent, track) == 12, "SnareEvent.track");
_Static_assert(offsetof(SnareEvent, accent) == 16, "SnareEvent.accent");
_Static_assert(offsetof(SnareEvent, pattern) == 20, "SnareEvent.pattern");

_Static_assert(sizeof(SnarePattern) == 52, "SnarePattern is written as 52 bytes by wasm-engine.ts");
_Static_assert(offsetof(SnarePattern, rows) == 0, "SnarePattern.rows");
_Static_assert(offsetof(SnarePattern, len1) == 48, "SnarePattern.len1");
_Static_assert(offsetof(SnarePattern, len2) == 49, "SnarePattern.len2");
_Static_assert(offsetof(SnarePattern, steps_per_beat) == 50, "SnarePattern.steps_per_beat");

_Static_assert(sizeof(SnareSoundParams) == 24, "SnareSoundParams is written as 24 bytes by wasm-engine.ts");
_Static_assert(offsetof(SnareSoundParams, sound) == 0, "SnareSoundParams.sound");
_Static_assert(offsetof(SnareSoundParams, tune) == 4, "SnareSoundParams.tune");
_Static_assert(offsetof(SnareSoundParams, tone) == 8, "SnareSoundParams.tone");
_Static_assert(offsetof(SnareSoundParams, decay) == 12, "SnareSoundParams.decay");
_Static_assert(offsetof(SnareSoundParams, snappy) == 16, "SnareSoundParams.snappy");
_Static_assert(offsetof(SnareSoundParams, seed) == 20, "SnareSoundParams.seed");

int main(void) {
  if (snare_abi_version() != SNARE_ABI_VERSION) return 1;
  SnareEngine* engine = snare_engine_create(48000.0);
  if (engine == NULL) return 2;
  if (snare_engine_is_playing(engine) != 0) return 3;
  snare_engine_destroy(engine);
  return 0;
}
