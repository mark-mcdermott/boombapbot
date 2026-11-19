// The audio thread's half of the engine: what the render block of an
// AVAudioSourceNode calls. It makes no call but snare_engine_render, takes no
// lock and allocates nothing, and what it leaves for the control thread to
// read are atomics.
#ifndef BOOMBAPBOT_ENGINE_RENDER_H
#define BOOMBAPBOT_ENGINE_RENDER_H

#include <stdint.h>

#include "boombapbot/engine.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct BBRender BBRender;

/* Made on the control thread, with everything the audio thread will need.
 * NULL if there is no memory. */
BBRender* bb_render_create(SnareEngine* engine);
/* Only once the audio thread will not call it again. Leaves the engine be. */
void bb_render_destroy(BBRender* render);

/* Renders the next frames: into left and right, or, when right is NULL, the
 * two mixed into left. For the audio thread alone. */
void bb_render_fill(BBRender* render, float* left, float* right, uint32_t frames);

/* The largest absolute sample written since the last call. Starts the next
 * one from silence. */
float bb_render_take_peak(BBRender* render);
/* How many times the device has asked for a buffer. */
uint64_t bb_render_buffers(const BBRender* render);

#ifdef __cplusplus
}
#endif

#endif /* BOOMBAPBOT_ENGINE_RENDER_H */
