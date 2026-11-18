// Renders through an engine in blocks, for the tools and the tests.
#pragma once

#include <cstddef>
#include <vector>

#include "boombapbot/engine.h"

namespace snare::io {

struct Rendered {
  std::vector<float> left;
  std::vector<float> right;
};

// Renders `frames` frames in blocks of `blockSize`.
inline Rendered render(SnareEngine* engine, int frames, int blockSize = 256) {
  Rendered out;
  out.left.resize(static_cast<std::size_t>(frames));
  out.right.resize(static_cast<std::size_t>(frames));
  int done = 0;
  while (done < frames) {
    const int count = frames - done < blockSize ? frames - done : blockSize;
    snare_engine_render(engine, out.left.data() + done, out.right.data() + done, count);
    done += count;
  }
  return out;
}

}  // namespace snare::io
