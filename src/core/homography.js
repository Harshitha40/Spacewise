// Single-image metric calibration from a user-marked floor quadrilateral.
//
// Given 4 floor points with known room coordinates (X,Z) and their pixels (u,v):
//   1. DLT homography  H : (X,Z,1) -> (u-cx, v-cy, 1)
//   2. focal length from the orthogonality / equal-norm constraints of the
//      rotation columns (principal point at the image centre, square pixels)
//   3. decompose  H ~ K [r1 r2 t]  -> camera rotation & translation
// This recovers the full camera pose of the photograph, which lets the 3D room
// be rendered *registered onto the user's own photo* (photo-grounded AR).

export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Homography mapping src[i] -> dst[i] (4 correspondences). Returns row-major 3x3. */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

export function applyH(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

export function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const norm = (v) => Math.hypot(...v);
const scale = (v, s) => v.map((x) => x * s);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * @param planPts [[X,Z]x4] room-floor coordinates (metres)
 * @param imgPts  [[u,v]x4] pixel coordinates in the original image
 * @returns calibration {ok, f, fovY, R (cam<-world, OpenCV), t, position, viewMatrix (row-major 4x4, world->three camera), H, Hinv}
 */
export function calibrate(planPts, imgPts, imgW, imgH) {
  const cx = imgW / 2, cy = imgH / 2;
  const centred = imgPts.map(([u, v]) => [u - cx, v - cy]);
  const Hc = homography(planPts, centred);
  if (!Hc) return { ok: false, error: 'Degenerate points' };
  const h1 = [Hc[0][0], Hc[1][0], Hc[2][0]], h2 = [Hc[0][1], Hc[1][1], Hc[2][1]], h3 = [Hc[0][2], Hc[1][2], Hc[2][2]];

  const est = [];
  const d1 = h1[2] * h2[2];
  if (Math.abs(d1) > 1e-12) { const e = -(h1[0] * h2[0] + h1[1] * h2[1]) / d1; if (e > 0) est.push(e); }
  const d2 = h2[2] * h2[2] - h1[2] * h1[2];
  if (Math.abs(d2) > 1e-12) { const e = (h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2) / d2; if (e > 0) est.push(e); }
  let f = est.length ? Math.sqrt(est.length === 2 ? Math.sqrt(est[0] * est[1]) : est[0]) : NaN;
  const fFromFov = (deg) => (imgH / 2) / Math.tan((deg * Math.PI) / 360);
  let estimated = true;
  if (!isFinite(f) || f < fFromFov(120) || f > fFromFov(20)) { f = fFromFov(55); estimated = false; }

  const Ki = (h) => [h[0] / f, h[1] / f, h[2]];
  const k1 = Ki(h1), k2 = Ki(h2), k3 = Ki(h3);
  let lam = 2 / (norm(k1) + norm(k2));
  // choose sign so the floor lies in front of the camera
  if (k3[2] * lam < 0) lam = -lam;
  let r1 = scale(k1, lam), r2 = scale(k2, lam);
  const t = scale(k3, lam);
  r1 = scale(r1, 1 / norm(r1));
  r2 = sub(r2, scale(r1, dot(r2, r1))); r2 = scale(r2, 1 / norm(r2));
  const r3 = cross(r1, r2);
  // world->cam (OpenCV): columns for world X, Y, Z are r1, -r3, r2
  const R = [
    [r1[0], -r3[0], r2[0]],
    [r1[1], -r3[1], r2[1]],
    [r1[2], -r3[2], r2[2]],
  ];
  // camera centre C = -R^T t
  const position = [0, 1, 2].map((j) => -(R[0][j] * t[0] + R[1][j] * t[1] + R[2][j] * t[2]));
  if (position[1] <= 0) return { ok: false, error: 'Point order looks mirrored — check that the pins match the plan letters.' };
  // OpenCV cam -> three.js cam: flip Y and Z
  const viewMatrix = [
    R[0][0], R[0][1], R[0][2], t[0],
    -R[1][0], -R[1][1], -R[1][2], -t[1],
    -R[2][0], -R[2][1], -R[2][2], -t[2],
    0, 0, 0, 1,
  ];
  // homography in raw pixel coordinates
  const T = [[1, 0, cx], [0, 1, cy], [0, 0, 1]];
  const H = T.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * Hc[k][j], 0)));
  const fovY = (2 * Math.atan(imgH / 2 / f) * 180) / Math.PI;
  // reprojection residual on the 4 input points (sanity metric)
  return { ok: true, f, fovY, estimatedFocal: estimated, R, t, position, viewMatrix, H, Hinv: invert3(H), imgW, imgH };
}

/** Project a world point (x,y,z) to pixels using a calibration. */
export function projectPoint(cal, [x, y, z]) {
  const R = cal.R, t = cal.t;
  const X = R[0][0] * x + R[0][1] * y + R[0][2] * z + t[0];
  const Y = R[1][0] * x + R[1][1] * y + R[1][2] * z + t[1];
  const Z = R[2][0] * x + R[2][1] * y + R[2][2] * z + t[2];
  if (Z <= 1e-6) return null;
  return [cal.f * X / Z + cal.imgW / 2, cal.f * Y / Z + cal.imgH / 2];
}

/** Image pixel -> floor coordinate. */
export function pixelToFloor(cal, u, v) { return applyH(cal.Hinv, u, v); }
