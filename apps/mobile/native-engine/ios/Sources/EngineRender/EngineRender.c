#include "EngineRender.h"

#include <math.h>
#include <stdatomic.h>
#include <stdlib.h>

/* Room for the right channel when the device takes one: a mono buffer is
 * rendered this many frames at a time. */
#define SCRATCH_FRAMES 4096

struct BBRender {
  SnareEngine* engine;
  /* The bits of a float that is not negative order as the float does. */
  _Atomic uint32_t peak_bits;
  _Atomic uint64_t buffers;
  float scratch[SCRATCH_FRAMES];
};

BBRender* bb_render_create(SnareEngine* engine) {
  if (!engine) return NULL;
  BBRender* render = calloc(1, sizeof(BBRender));
  if (!render) return NULL;
  render->engine = engine;
  atomic_init(&render->peak_bits, 0);
  atomic_init(&render->buffers, 0);
  return render;
}

void bb_render_destroy(BBRender* render) { free(render); }

static uint32_t bits_of(float value) {
  union {
    float value;
    uint32_t bits;
  } both = {.value = value};
  return both.bits;
}

static float float_of(uint32_t bits) {
  union {
    uint32_t bits;
    float value;
  } both = {.bits = bits};
  return both.value;
}

static void note_peak(BBRender* render, float peak) {
  const uint32_t bits = bits_of(peak);
  uint32_t seen = atomic_load_explicit(&render->peak_bits, memory_order_relaxed);
  while (bits > seen &&
         !atomic_compare_exchange_weak_explicit(&render->peak_bits, &seen, bits, memory_order_relaxed,
                                                memory_order_relaxed)) {
  }
}

/* fmaxf passes over a sample that is not a number. */
static float loudest(const float* samples, uint32_t frames, float peak) {
  for (uint32_t i = 0; i < frames; ++i) peak = fmaxf(peak, fabsf(samples[i]));
  return peak;
}

void bb_render_fill(BBRender* render, float* left, float* right, uint32_t frames) {
  if (!render || !left) return;
  float peak = 0.0f;
  if (right) {
    snare_engine_render(render->engine, left, right, (int32_t)frames);
    peak = loudest(right, frames, loudest(left, frames, peak));
  } else {
    for (uint32_t done = 0; done < frames;) {
      const uint32_t count = frames - done < SCRATCH_FRAMES ? frames - done : SCRATCH_FRAMES;
      float* mono = left + done;
      snare_engine_render(render->engine, mono, render->scratch, (int32_t)count);
      peak = loudest(render->scratch, count, loudest(mono, count, peak));
      for (uint32_t i = 0; i < count; ++i) mono[i] = 0.5f * (mono[i] + render->scratch[i]);
      done += count;
    }
  }
  note_peak(render, peak);
  atomic_fetch_add_explicit(&render->buffers, 1, memory_order_relaxed);
}

float bb_render_take_peak(BBRender* render) {
  return render ? float_of(atomic_exchange_explicit(&render->peak_bits, 0, memory_order_relaxed)) : 0.0f;
}

uint64_t bb_render_buffers(const BBRender* render) {
  return render ? atomic_load_explicit(&((BBRender*)render)->buffers, memory_order_relaxed) : 0;
}
