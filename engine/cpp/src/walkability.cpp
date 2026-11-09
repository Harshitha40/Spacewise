// Walkability: rasterise -> exact EDT (Felzenszwalb–Huttenlocher, separable and
// therefore row/column parallel) -> multi-source BFS from doors.
#include <algorithm>
#include <cmath>
#include <limits>
#include "layout_engine.hpp"

namespace ll {

static constexpr double BODY_R = 0.30;
static const float INF = 1e20f;

// 1D squared-distance transform (lower envelope of parabolas)
static void edt1d(const float* f, float* d, int n, int* v, float* z) {
  int k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (int q = 1; q < n; ++q) {
    float s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2.f * q - 2.f * v[k]);
    while (s <= z[k]) { --k; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2.f * q - 2.f * v[k]); }
    ++k; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (int q = 0; q < n; ++q) { while (z[k + 1] < q) ++k; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

static Vec2 wallPoint(const Room& r, char wall, double t, double inset) {
  switch (wall) {
    case 'S': return {t, inset};
    case 'N': return {t, r.length - inset};
    case 'W': return {inset, t};
    default: return {r.width - inset, t};
  }
}

Grid analyseWalkability(const Room& room, const std::vector<Item>& items, double cell) {
  Grid g; g.cell = cell;
  g.nx = std::max(2, (int)std::ceil(room.width / cell));
  g.nz = std::max(2, (int)std::ceil(room.length / cell));
  const int N = g.nx * g.nz;
  g.occ.assign(N, -1); g.dist.assign(N, 0.f); g.parent.assign(N, -2);

  // 1) rasterisation — cells are independent
#pragma omp parallel for schedule(static)
  for (int j = 0; j < g.nz; ++j)
    for (int i = 0; i < g.nx; ++i) {
      const double cx = (i + 0.5) * cell, cz = (j + 0.5) * cell;
      for (int k = (int)items.size() - 1; k >= 0; --k)
        if (items[k].obstacle && pointInItem(items[k], cx, cz)) { g.occ[j * g.nx + i] = k; break; }
    }

  // 2) exact EDT to furniture (in cells), then combine with exact distance to walls
  std::vector<float> f(N);
  for (int k = 0; k < N; ++k) f[k] = g.occ[k] >= 0 ? 0.f : INF;
  const int M = std::max(g.nx, g.nz);
#pragma omp parallel
  {
    std::vector<float> in(M), out(M), z(M + 1); std::vector<int> v(M);
#pragma omp for schedule(static)
    for (int i = 0; i < g.nx; ++i) {  // columns
      for (int j = 0; j < g.nz; ++j) in[j] = f[j * g.nx + i];
      edt1d(in.data(), out.data(), g.nz, v.data(), z.data());
      for (int j = 0; j < g.nz; ++j) f[j * g.nx + i] = out[j];
    }
#pragma omp for schedule(static)
    for (int j = 0; j < g.nz; ++j) {  // rows
      edt1d(&f[j * g.nx], out.data(), g.nx, v.data(), z.data());
      std::copy(out.begin(), out.begin() + g.nx, f.begin() + j * g.nx);
    }
  }
#pragma omp parallel for schedule(static)
  for (int j = 0; j < g.nz; ++j)
    for (int i = 0; i < g.nx; ++i) {
      const double cx = (i + 0.5) * cell, cz = (j + 0.5) * cell;
      const double wallD = std::min(std::min(cx, room.width - cx), std::min(cz, room.length - cz));
      const double furnD = std::sqrt((double)f[j * g.nx + i]) * cell;
      g.dist[j * g.nx + i] = (float)std::min(wallD, furnD);
    }

  // 3) BFS from door entry cells (inherently frontier-parallel; sequential here)
  std::vector<int> queue; queue.reserve(N);
  for (const auto& door : room.doors) {
    bool any = false;
    for (double t = door.offset + 0.12; t <= door.offset + door.width - 0.12 + 1e-6; t += cell / 2) {
      const Vec2 p = wallPoint(room, door.wall, t, BODY_R + cell * 0.6);
      const int i = (int)(p[0] / cell), j = (int)(p[1] / cell);
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
      const int c = j * g.nx + i;
      if (g.dist[c] >= BODY_R) { any = true; if (g.parent[c] == -2) { g.parent[c] = -1; queue.push_back(c); } }
    }
    if (!any) ++g.blockedDoors;
  }
  static const int di[8] = {1, -1, 0, 0, 1, 1, -1, -1}, dj[8] = {0, 0, 1, -1, 1, -1, 1, -1};
  for (size_t h = 0; h < queue.size(); ++h) {
    const int c = queue[h], i = c % g.nx, j = c / g.nx;
    for (int k = 0; k < 8; ++k) {
      const int ii = i + di[k], jj = j + dj[k];
      if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue;
      const int n = jj * g.nx + ii;
      if (g.parent[n] != -2 || g.dist[n] < BODY_R) continue;
      if (k >= 4 && (g.dist[j * g.nx + ii] < BODY_R || g.dist[jj * g.nx + i] < BODY_R)) continue;
      g.parent[n] = c; queue.push_back(n);
    }
  }
  g.reached = (int)queue.size();
  return g;
}

}  // namespace ll
