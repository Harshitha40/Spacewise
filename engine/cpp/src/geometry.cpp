#include <algorithm>
#include <cmath>
#include "layout_engine.hpp"

namespace ll {

Vec2 localToWorld(const Item& it, double lx, double lz) {
  const double c = std::cos(it.rot), s = std::sin(it.rot);
  return {it.x + lx * c + lz * s, it.z - lx * s + lz * c};
}
Vec2 worldToLocal(const Item& it, double x, double z) {
  const double c = std::cos(it.rot), s = std::sin(it.rot), dx = x - it.x, dz = z - it.z;
  return {dx * c - dz * s, dx * s + dz * c};
}
Poly localRect(const Item& it, double x0, double z0, double x1, double z1) {
  return {localToWorld(it, x0, z0), localToWorld(it, x1, z0), localToWorld(it, x1, z1), localToWorld(it, x0, z1)};
}
Poly footprint(const Item& it, double pad) {
  const double hw = it.w / 2 + pad, hd = it.d / 2 + pad;
  return localRect(it, -hw, -hd, hw, hd);
}
double polyArea(const Poly& p) {
  double a = 0;
  for (size_t i = 0; i < p.size(); ++i) {
    const Vec2& u = p[i]; const Vec2& v = p[(i + 1) % p.size()];
    a += u[0] * v[1] - v[0] * u[1];
  }
  return a / 2;
}
static Poly ccw(Poly p) { if (polyArea(p) < 0) std::reverse(p.begin(), p.end()); return p; }

// Sutherland–Hodgman clipping of convex polygons
static Poly clip(const Poly& subject, const Poly& clipPoly) {
  Poly out = ccw(subject); const Poly c = ccw(clipPoly);
  for (size_t i = 0; i < c.size() && !out.empty(); ++i) {
    const Vec2 a = c[i], b = c[(i + 1) % c.size()];
    auto inside = [&](const Vec2& p) { return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0; };
    Poly in = out; out.clear();
    for (size_t j = 0; j < in.size(); ++j) {
      const Vec2 P = in[j], Q = in[(j + 1) % in.size()];
      const bool pin = inside(P), qin = inside(Q);
      if (pin) out.push_back(P);
      if (pin != qin) {
        const double dx = Q[0] - P[0], dz = Q[1] - P[1];
        const double den = (b[0] - a[0]) * dz - (b[1] - a[1]) * dx;
        if (std::fabs(den) > 1e-12) {
          const double t = ((a[0] - P[0]) * (b[1] - a[1]) - (a[1] - P[1]) * (b[0] - a[0])) / -den;
          out.push_back({P[0] + t * dx, P[1] + t * dz});
        }
      }
    }
  }
  return out;
}
static void bounds(const Poly& p, double& x0, double& z0, double& x1, double& z1) {
  x0 = z0 = 1e30; x1 = z1 = -1e30;
  for (auto& q : p) { x0 = std::min(x0, q[0]); x1 = std::max(x1, q[0]); z0 = std::min(z0, q[1]); z1 = std::max(z1, q[1]); }
}
double intersectArea(const Poly& a, const Poly& b) {
  double ax0, az0, ax1, az1, bx0, bz0, bx1, bz1;
  bounds(a, ax0, az0, ax1, az1); bounds(b, bx0, bz0, bx1, bz1);
  if (ax1 <= bx0 || bx1 <= ax0 || az1 <= bz0 || bz1 <= az0) return 0;
  const Poly r = clip(a, b);
  return r.size() >= 3 ? std::fabs(polyArea(r)) : 0;
}
double outsideArea(const Poly& p, double W, double L) {
  const Poly in = clip(p, {{0, 0}, {W, 0}, {W, L}, {0, L}});
  return std::fabs(polyArea(p)) - (in.size() >= 3 ? std::fabs(polyArea(in)) : 0);
}
bool pointInItem(const Item& it, double x, double z) {
  const Vec2 l = worldToLocal(it, x, z);
  return std::fabs(l[0]) <= it.w / 2 && std::fabs(l[1]) <= it.d / 2;
}

}  // namespace ll
