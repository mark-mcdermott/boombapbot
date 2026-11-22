// Counts the calls a thread makes to the heap while it is being watched. The
// audio thread must make none.
//
// It replaces this program's operator new and delete, which every C++
// allocation in the plugin, the engine and JUCE comes to. On macOS it also
// stands in for malloc, calloc, realloc and free as this program's code calls
// them. What a system library allocates inside itself is not seen.
#pragma once

namespace heaptrap {

// False in a build under a sanitizer, which has the allocator to itself. Then
// nothing is replaced and nothing is ever counted.
bool available();

// Watches the calling thread for as long as it lives. Other threads are not
// counted, and only one thread can be watched at a time.
class Watch {
 public:
  Watch();
  ~Watch();
  Watch(const Watch&) = delete;
  Watch& operator=(const Watch&) = delete;
};

// Takes blocks from the heap and gives them back while watching, and says
// whether every call was counted. A trap that sees nothing proves nothing.
bool seesTheHeap();

// Heap calls made by the watched thread since the last reset.
int calls();
void reset();

}  // namespace heaptrap
