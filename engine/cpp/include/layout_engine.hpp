// LayoutLens native engine — C++17 port of src/engine/*.js
// Parallel back-ends:
//   * OpenMP : independent annealing chains (strategies x restarts), grid rasterisation,
//              separable exact Euclidean distance transform (rows, then columns)
//   * CUDA   : batched cost evaluation of many candidate layouts (see cuda/batch_eval.cu)
#pragma once
#include <array>
#include <string>
#include <vector>

namespace ll {

struct Opening { char wall; double offset, width, sill = 0, height = 0; };

struct Room {
  double width = 4, length = 4, height = 2.7;
  std::vector<Opening> doors, windows;
};

enum Access : unsigned { ACC_FRONT = 1, ACC_LEFT = 2, ACC_RIGHT = 4 };

struct Item {
  std::string id, type;
  double x = 0, z = 0, rot = 0, w = 1, d = 1, h = 1;
  bool locked = false, collide = true, obstacle = true, wallBack = false;
  double clrFront = 0, clrSides = 0, clrBack = 0;
  unsigned access = 0;
};

struct Weights {
  double overlap = 30, bounds = 30, door = 12, doorBlocked = 12, access = 3, circulation = 4, narrow = 1.5,
         clearance = 4, wall = 2, window = 3, relation = 1.5, tv = 1.5, movement = 0;
};

struct Penalties {
  double overlap = 0, bounds = 0, door = 0, doorBlocked = 0, access = 0, circulation = 0, narrow = 0,
         clearance = 0, wall = 0, window = 0, relation = 0, tv = 0, movement = 0;
  double cost(const Weights& w) const;
};

using Vec2 = std::array<double, 2>;
using Poly = std::vector<Vec2>;

// geometry.cpp
Vec2 localToWorld(const Item& it, double lx, double lz);
Vec2 worldToLocal(const Item& it, double x, double z);
Poly localRect(const Item& it, double x0, double z0, double x1, double z1);
Poly footprint(const Item& it, double pad = 0);
double polyArea(const Poly& p);
double intersectArea(const Poly& a, const Poly& b);
double outsideArea(const Poly& p, double W, double L);
bool pointInItem(const Item& it, double x, double z);

// walkability.cpp
struct Grid {
  int nx = 0, nz = 0; double cell = 0.1;
  std::vector<int> occ;     // item index or -1
  std::vector<float> dist;  // clearance (m)
  std::vector<int> parent;  // BFS tree (-2 unvisited, -1 root)
  int reached = 0, blockedDoors = 0;
};
Grid analyseWalkability(const Room& room, const std::vector<Item>& items, double cell);

// evaluate.cpp
Penalties evaluate(const Room& room, const std::vector<Item>& items, const std::vector<Item>* reference, double cell = 0.15);

// optimizer.cpp
struct Strategy { std::string name; bool fresh; Weights w; int iters; };
struct Result { std::string strategy; unsigned seed; double cost; std::vector<Item> items; double ms; };
std::vector<Strategy> defaultStrategies();
Result anneal(const Room& room, std::vector<Item> items, const Strategy& s, unsigned seed);
std::vector<Result> optimiseParallel(const Room& room, const std::vector<Item>& items,
                                     const std::vector<Strategy>& strategies, int restarts);

}  // namespace ll
