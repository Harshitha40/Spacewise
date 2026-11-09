// Cost function — mirrors src/engine/evaluate.js (fast mode).
#include <algorithm>
#include <cmath>
#include <map>
#include "layout_engine.hpp"

namespace ll {

static constexpr double PI = 3.14159265358979323846;
static constexpr double COMFORT_R = 0.45, BODY_R = 0.30;

double Penalties::cost(const Weights& w) const {
  return w.overlap * overlap + w.bounds * bounds + w.door * door + w.doorBlocked * doorBlocked + w.access * access +
         w.circulation * circulation + w.narrow * narrow + w.clearance * clearance + w.wall * wall + w.window * window +
         w.relation * relation + w.tv * tv + w.movement * movement;
}

static bool tucks(const Item& a, const Item& b) {
  auto t = [](const Item& c, const Item& t) {
    return (c.type == "dining_chair" && t.type == "dining_table") || (c.type == "office_chair" && t.type == "desk");
  };
  return t(a, b) || t(b, a);
}
static Vec2 wallPt(const Room& r, char wall, double t, double inset) {
  switch (wall) {
    case 'S': return {t, inset};
    case 'N': return {t, r.length - inset};
    case 'W': return {inset, t};
    default: return {r.width - inset, t};
  }
}
static double dist(const Vec2& a, const Vec2& b) { return std::hypot(a[0] - b[0], a[1] - b[1]); }
static double wrap(double a) { while (a > PI) a -= 2 * PI; while (a <= -PI) a += 2 * PI; return a; }
static double angleBetween(Vec2 u, Vec2 v) {
  const double lu = std::hypot(u[0], u[1]) + 1e-12, lv = std::hypot(v[0], v[1]) + 1e-12;
  return std::acos(std::max(-1.0, std::min(1.0, (u[0] * v[0] + u[1] * v[1]) / (lu * lv))));
}
static Vec2 fwd(const Item& it) { return {std::sin(it.rot), std::cos(it.rot)}; }

Penalties evaluate(const Room& room, const std::vector<Item>& items, const std::vector<Item>* reference, double cell) {
  Penalties P;
  const size_t n = items.size();
  std::vector<Poly> fp(n);
  for (size_t i = 0; i < n; ++i) fp[i] = footprint(items[i]);

  // collisions & bounds — O(n^2) pairs; this is the term batched on the GPU (cuda/batch_eval.cu)
  for (size_t i = 0; i < n; ++i) {
    if (!items[i].collide) continue;
    P.bounds += std::max(0.0, outsideArea(fp[i], room.width, room.length) - 1e-3);
    for (size_t j = i + 1; j < n; ++j)
      if (items[j].collide && !tucks(items[i], items[j])) P.overlap += intersectArea(fp[i], fp[j]);
  }
  // clearance zones
  for (size_t i = 0; i < n; ++i) {
    const Item& it = items[i]; const double hw = it.w / 2, hd = it.d / 2;
    std::vector<Poly> zones;
    if (it.clrFront > 0) zones.push_back(localRect(it, -hw, hd, hw, hd + it.clrFront));
    if (it.clrBack > 0) zones.push_back(localRect(it, -hw, -hd - it.clrBack, hw, -hd));
    if (it.clrSides > 0) {
      const double z0 = it.type == "bed" ? -hd + 0.4 : -hd;
      zones.push_back(localRect(it, -hw - it.clrSides, z0, -hw, hd));
      zones.push_back(localRect(it, hw, z0, hw + it.clrSides, hd));
    }
    for (const Poly& z : zones) {
      P.clearance += outsideArea(z, room.width, room.length) * 0.6;
      for (size_t j = 0; j < n; ++j)
        if (j != i && items[j].obstacle && !tucks(it, items[j])) P.clearance += intersectArea(z, fp[j]);
    }
  }
  // doors / windows
  for (const auto& d : room.doors) {
    const Poly z = {wallPt(room, d.wall, d.offset, 0), wallPt(room, d.wall, d.offset + d.width, 0),
                    wallPt(room, d.wall, d.offset + d.width, d.width), wallPt(room, d.wall, d.offset, d.width)};
    for (size_t j = 0; j < n; ++j) if (items[j].obstacle) P.door += intersectArea(z, fp[j]);
  }
  for (const auto& w : room.windows) {
    const Poly z = {wallPt(room, w.wall, w.offset, 0), wallPt(room, w.wall, w.offset + w.width, 0),
                    wallPt(room, w.wall, w.offset + w.width, 0.45), wallPt(room, w.wall, w.offset, 0.45)};
    for (size_t j = 0; j < n; ++j) if (items[j].obstacle && items[j].h >= w.sill + 0.1) P.window += intersectArea(z, fp[j]);
  }
  // wall affinity
  for (const Item& it : items) {
    if (!it.wallBack) continue;
    const Vec2 back = localToWorld(it, 0, -it.d / 2); const Vec2 f = fwd(it); const Vec2 b = {-f[0], -f[1]};
    const struct { char w; double d; Vec2 out; } walls[4] = {
        {'S', back[1], {0, -1}}, {'N', room.length - back[1], {0, 1}}, {'W', back[0], {-1, 0}}, {'E', room.width - back[0], {1, 0}}};
    double best = 1e9;
    for (auto& w : walls) best = std::min(best, std::fabs(w.d) + (1 - (b[0] * w.out[0] + b[1] * w.out[1])) * 1.5);
    P.wall += std::max(0.0, best - 0.06);
  }
  // walkability
  const Grid g = analyseWalkability(room, items, cell);
  P.doorBlocked += g.blockedDoors;
  int narrow = 0;
  for (int k = 0; k < g.nx * g.nz; ++k) if (g.parent[k] != -2 && g.dist[k] < COMFORT_R) ++narrow;
  const double emptyWalk = std::max(1.0, (room.width - 2 * BODY_R) * (room.length - 2 * BODY_R) / (cell * cell));
  P.circulation += 1 - std::min(1.0, g.reached / emptyWalk);
  P.narrow += g.reached ? (double)narrow / g.reached : 0;
  auto reachable = [&](double x, double z) {
    const int R = (int)std::ceil(0.25 / cell), ci = (int)(x / cell), cj = (int)(z / cell);
    for (int dj = -R; dj <= R; ++dj) for (int di = -R; di <= R; ++di) {
      const int i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < g.nx && j < g.nz && g.parent[j * g.nx + i] != -2) return true;
    }
    return false;
  };
  for (const Item& it : items) {
    int unreached = 0, sides = 0;
    const double hw = it.w / 2, hd = it.d / 2, off = 0.38;
    auto test = [&](unsigned flag, double lx, double lz) {
      if (!(it.access & flag)) return;
      ++sides; const Vec2 p = localToWorld(it, lx, lz);
      const bool inside = p[0] >= 0 && p[1] >= 0 && p[0] <= room.width && p[1] <= room.length;
      if (!inside) { if (flag == ACC_FRONT) ++unreached; return; }
      if (!reachable(p[0], p[1])) ++unreached;
    };
    test(ACC_FRONT, 0, hd + off); test(ACC_LEFT, -hw - off, 0.1); test(ACC_RIGHT, hw + off, 0.1);
    P.access += unreached - (it.type == "bed" && unreached == 1 && sides == 2 ? 0.7 : 0);
  }
  // functional relations
  auto first = [&](std::initializer_list<const char*> types) -> const Item* {
    for (const char* t : types) for (const Item& it : items) if (it.type == t) return &it;
    return nullptr;
  };
  for (const Item& ns : items) if (ns.type == "nightstand") {
    double best = 1e9;
    for (const Item& bed : items) if (bed.type == "bed") for (int s : {-1, 1}) {
      const Vec2 t = localToWorld(bed, s * (bed.w / 2 + ns.w / 2 + 0.03), -bed.d / 2 + ns.d / 2 + 0.02);
      best = std::min(best, dist(t, {ns.x, ns.z}) + 0.3 * std::fabs(wrap(ns.rot - bed.rot)));
    }
    if (best < 1e9) P.relation += best;
  }
  if (const Item* sofa = first({"sofa", "armchair"}))
    for (const Item& ct : items) if (ct.type == "coffee_table") {
      const Vec2 t = localToWorld(*sofa, 0, sofa->d / 2 + 0.42 + ct.d / 2);
      P.relation += dist(t, {ct.x, ct.z}) * 0.8 + 0.2 * std::fabs(std::sin(ct.rot - sofa->rot));
    }
  if (const Item* desk = first({"desk"}))
    for (const Item& ch : items) if (ch.type == "office_chair") {
      const Vec2 t = localToWorld(*desk, 0, desk->d / 2 + 0.2); const Vec2 f = fwd(*desk);
      P.relation += dist(t, {ch.x, ch.z}) + 0.3 * angleBetween(fwd(ch), {-f[0], -f[1]});
    }
  if (const Item* tv = first({"tv_stand"}))
    if (const Item* v = first({"sofa", "armchair", "bed"})) {
      const Vec2 toV = {v->x - tv->x, v->z - tv->z};
      const double d = std::hypot(toV[0], toV[1]);
      P.tv += std::max(0.0, angleBetween(fwd(*tv), toV) - 0.35) + std::max(0.0, angleBetween(fwd(*v), {-toV[0], -toV[1]}) - 0.45) +
              std::max(0.0, 1.2 - d) + 0.5 * std::max(0.0, d - 4.5);
    }
  // stability w.r.t. reference layout
  if (reference) {
    std::map<std::string, const Item*> ref;
    for (const Item& r : *reference) ref[r.id] = &r;
    for (const Item& it : items) {
      auto f = ref.find(it.id); if (f == ref.end()) continue;
      P.movement += std::hypot(it.x - f->second->x, it.z - f->second->z) + 0.6 * std::fabs(std::sin((it.rot - f->second->rot) / 2));
    }
  }
  return P;
}

}  // namespace ll
