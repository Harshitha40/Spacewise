// Simulated annealing with OpenMP-parallel independent chains.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <random>
#include "layout_engine.hpp"
#ifdef _OPENMP
#include <omp.h>
#endif

namespace ll {

static constexpr double PI = 3.14159265358979323846;

std::vector<Strategy> defaultStrategies() {
  Weights minimal; minimal.movement = 1.2;
  Weights balanced; balanced.movement = 0.05;
  Weights spacious; spacious.circulation = 12; spacious.narrow = 5; spacious.clearance = 6;
  Weights comfort; comfort.tv = 5; comfort.window = 8;
  return {{"minimal", false, minimal, 4000}, {"balanced", false, balanced, 6000},
          {"spacious", true, spacious, 6000}, {"comfort", true, comfort, 6000}};
}

static void clampIn(const Room& r, Item& it) {
  const double c = std::fabs(std::cos(it.rot)), s = std::fabs(std::sin(it.rot));
  const double ex = (it.w * c + it.d * s) / 2, ez = (it.w * s + it.d * c) / 2;
  it.x = std::min(std::max(it.x, ex), std::max(ex, r.width - ex));
  it.z = std::min(std::max(it.z, ez), std::max(ez, r.length - ez));
}

static void snapToWall(const Room& r, Item& it, std::mt19937& rng) {
  std::uniform_real_distribution<double> U(0, 1);
  const char walls[4] = {'S', 'N', 'W', 'E'};
  const char w = walls[rng() % 4];
  const double L = (w == 'S' || w == 'N') ? r.width : r.length;
  const double t = it.w / 2 + U(rng) * std::max(0.0, L - it.w), inset = it.d / 2 + 0.01;
  switch (w) {
    case 'S': it.rot = 0; it.x = t; it.z = inset; break;
    case 'N': it.rot = PI; it.x = t; it.z = r.length - inset; break;
    case 'W': it.rot = PI / 2; it.x = inset; it.z = t; break;
    default: it.rot = -PI / 2; it.x = r.width - inset; it.z = t; break;
  }
}

Result anneal(const Room& room, std::vector<Item> items, const Strategy& s, unsigned seed) {
  const auto t0 = std::chrono::steady_clock::now();
  std::mt19937 rng(seed);
  std::uniform_real_distribution<double> U(0, 1);
  std::normal_distribution<double> G(0, 1);
  const std::vector<Item> reference = items;
  std::vector<int> movable;
  for (size_t i = 0; i < items.size(); ++i) if (!items[i].locked) movable.push_back((int)i);
  if (s.fresh)
    for (int k : movable) {
      if (items[k].wallBack) snapToWall(room, items[k], rng);
      else { items[k].x = U(rng) * room.width; items[k].z = U(rng) * room.length; items[k].rot = (rng() % 4) * PI / 2; }
      clampIn(room, items[k]);
    }
  double cost = evaluate(room, items, &reference).cost(s.w);
  std::vector<Item> best = items; double bestCost = cost;
  const double T0 = 3.0, T1 = 0.004;
  for (int n = 0; n < s.iters && !movable.empty(); ++n) {
    const double frac = (double)n / s.iters, T = T0 * std::pow(T1 / T0, frac);
    const int k = movable[rng() % movable.size()];
    const Item backup = items[k];
    const double u = U(rng);
    Item& it = items[k];
    if (u < 0.5) { const double sg = 0.04 + 0.8 * (1 - frac); it.x += G(rng) * sg; it.z += G(rng) * sg; }
    else if (u < 0.7) it.rot += (U(rng) < 0.5 ? 1 : -1) * PI / 2;
    else if (u < 0.85 && it.wallBack) snapToWall(room, it, rng);
    else { it.x = U(rng) * room.width; it.z = U(rng) * room.length; }
    clampIn(room, it);
    const double c = evaluate(room, items, &reference).cost(s.w);
    if (c <= cost || U(rng) < std::exp((cost - c) / T)) {
      cost = c;
      if (c < bestCost) { bestCost = c; best = items; }
    } else items[k] = backup;
  }
  const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  return {s.name, seed, bestCost, best, ms};
}

std::vector<Result> optimiseParallel(const Room& room, const std::vector<Item>& items,
                                     const std::vector<Strategy>& strategies, int restarts) {
  const int jobs = (int)strategies.size() * restarts;
  std::vector<Result> all(jobs);
  // Independent Markov chains -> embarrassingly parallel
#pragma omp parallel for schedule(dynamic, 1)
  for (int j = 0; j < jobs; ++j)
    all[j] = anneal(room, items, strategies[j / restarts], 1u + 7919u * (unsigned)j);
  std::vector<Result> best;
  for (const auto& s : strategies) {
    const Result* b = nullptr;
    for (const auto& r : all) if (r.strategy == s.name && (!b || r.cost < b->cost)) b = &r;
    if (b) best.push_back(*b);
  }
  return best;
}

}  // namespace ll
