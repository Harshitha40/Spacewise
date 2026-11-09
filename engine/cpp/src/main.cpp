// CLI front-end. Reads a project in a line-based text format on stdin (produced
// by engine/bridge.mjs from the app's JSON), runs the parallel optimiser and
// prints results. Keeping I/O dependency-free makes the engine easy to build
// anywhere (MinGW, MSVC, clang, nvcc host compiler).
//
//   room <W> <L> <H>
//   door <wall> <offset> <width>
//   window <wall> <offset> <width> <sill> <height>
//   item <id> <type> <x> <z> <rot> <w> <d> <h> <locked> <collide> <obstacle> <wallBack> <cf> <cs> <cb> <accessMask>
//   opt <restarts> [iterScale]
//
// Output:  result <strategy> <cost> <ms>  followed by  pose <id> <x> <z> <rot>  lines, then  end
#include <chrono>
#include <cstdio>
#include <iostream>
#include <sstream>
#include "layout_engine.hpp"
#ifdef _OPENMP
#include <omp.h>
#endif

int main(int argc, char** argv) {
  using namespace ll;
  Room room; std::vector<Item> items; int restarts = 2; double iterScale = 1.0;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream ss(line); std::string tag; ss >> tag;
    if (tag == "room") ss >> room.width >> room.length >> room.height;
    else if (tag == "door") { Opening o{}; ss >> o.wall >> o.offset >> o.width; room.doors.push_back(o); }
    else if (tag == "window") { Opening o{}; ss >> o.wall >> o.offset >> o.width >> o.sill >> o.height; room.windows.push_back(o); }
    else if (tag == "item") {
      Item it; int lk, co, ob, wb;
      ss >> it.id >> it.type >> it.x >> it.z >> it.rot >> it.w >> it.d >> it.h >> lk >> co >> ob >> wb >> it.clrFront >> it.clrSides >> it.clrBack >> it.access;
      it.locked = lk; it.collide = co; it.obstacle = ob; it.wallBack = wb;
      items.push_back(it);
    } else if (tag == "opt") { ss >> restarts; if (!(ss >> iterScale)) iterScale = 1.0; }
  }
  auto strategies = defaultStrategies();
  for (auto& s : strategies) s.iters = (int)(s.iters * iterScale);
  int threads = 1;
#ifdef _OPENMP
  threads = omp_get_max_threads();
#endif
  const auto t0 = std::chrono::steady_clock::now();
  const auto res = optimiseParallel(room, items, strategies, restarts);
  const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  std::printf("meta %d %d %.1f\n", threads, (int)strategies.size() * restarts, ms);
  for (const auto& r : res) {
    std::printf("result %s %.6f %.1f\n", r.strategy.c_str(), r.cost, r.ms);
    for (const auto& it : r.items) std::printf("pose %s %.5f %.5f %.6f\n", it.id.c_str(), it.x, it.z, it.rot);
  }
  std::printf("end\n");
  return 0;
}
