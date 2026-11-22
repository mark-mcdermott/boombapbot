// Loads the built VST3 binary into this process the way a host does and asks
// it for its plugin factory. Run once for each architecture of a universal
// build: a binary a host cannot load is one the host may crash on.
//
//   bundle_load_check <path to the binary inside the .vst3 bundle>

#include <dlfcn.h>

#include <cstdio>

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <binary inside the .vst3 bundle>\n", argv[0]);
    return 2;
  }

  void* const module = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
  if (module == nullptr) {
    std::fprintf(stderr, "FAIL the binary did not load: %s\n", dlerror());
    return 1;
  }

  using FactoryGetter = void* (*)();
  const auto getFactory = reinterpret_cast<FactoryGetter>(dlsym(module, "GetPluginFactory"));
  if (getFactory == nullptr) {
    std::fprintf(stderr, "FAIL the binary does not export GetPluginFactory\n");
    return 1;
  }
  if (getFactory() == nullptr) {
    std::fprintf(stderr, "FAIL GetPluginFactory returned no factory\n");
    return 1;
  }

  std::printf("ok   the binary loads and returns a plugin factory\n");
  return 0;
}
