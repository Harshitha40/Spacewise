// CUDA batched layout evaluation (built only with -DLL_CUDA=ON).
//
// Population-based optimisation (parallel tempering / large-neighbourhood
// sampling) needs the cost of thousands of candidate layouts per step. The
// dominant O(n^2) term — pairwise oriented-box overlap — maps to one thread per
// (candidate, pair). Each thread computes the exact intersection area of two
// oriented rectangles by convex clipping in registers, then reduces per candidate.
//
// Status: kernel + host launcher implemented; integration into a GPU population
// annealer (replacing optimiseParallel's CPU chains) is the next milestone.
#include <cuda_runtime.h>
#include <cstdio>

namespace ll { namespace cuda {

struct Box { float x, z, rot, w, d; int collide; };

__device__ inline void corners(const Box& b, float2 out[4]) {
  const float c = cosf(b.rot), s = sinf(b.rot), hw = b.w * 0.5f, hd = b.d * 0.5f;
  const float lx[4] = {-hw, hw, hw, -hw}, lz[4] = {-hd, -hd, hd, hd};
  for (int k = 0; k < 4; ++k) out[k] = make_float2(b.x + lx[k] * c + lz[k] * s, b.z - lx[k] * s + lz[k] * c);
}

// Sutherland–Hodgman in registers: subject (<= 8 verts) clipped by a CCW quad.
__device__ float overlapArea(const Box& a, const Box& b) {
  float2 P[8], Q[8], C[4]; int n = 4;
  corners(a, P); corners(b, C);
  for (int e = 0; e < 4 && n > 0; ++e) {
    const float2 A = C[e], B = C[(e + 1) & 3]; int m = 0;
    for (int i = 0; i < n; ++i) {
      const float2 p = P[i], q = P[(i + 1) % n];
      const float sp = (B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x);
      const float sq = (B.x - A.x) * (q.y - A.y) - (B.y - A.y) * (q.x - A.x);
      if (sp >= 0) Q[m++] = p;
      if ((sp >= 0) != (sq >= 0)) { const float t = sp / (sp - sq); Q[m++] = make_float2(p.x + t * (q.x - p.x), p.y + t * (q.y - p.y)); }
    }
    n = m; for (int i = 0; i < n; ++i) P[i] = Q[i];
  }
  float area = 0;
  for (int i = 0; i < n; ++i) area += P[i].x * P[(i + 1) % n].y - P[(i + 1) % n].x * P[i].y;
  return fabsf(area) * 0.5f;
}

// boxes: [numCandidates][numItems]; out: overlap area per candidate
__global__ void overlapKernel(const Box* boxes, int numItems, int numCandidates, float* out) {
  const int pairs = numItems * (numItems - 1) / 2;
  const int gid = blockIdx.x * blockDim.x + threadIdx.x;
  if (gid >= numCandidates * pairs) return;
  const int cand = gid / pairs; int p = gid % pairs, i = 0;
  while (p >= numItems - 1 - i) { p -= numItems - 1 - i; ++i; }
  const int j = i + 1 + p;
  const Box& a = boxes[cand * numItems + i]; const Box& b = boxes[cand * numItems + j];
  if (!a.collide || !b.collide) return;
  atomicAdd(&out[cand], overlapArea(a, b));
}

void batchOverlap(const Box* hostBoxes, int numItems, int numCandidates, float* hostOut) {
  Box* dBoxes; float* dOut;
  const size_t nb = sizeof(Box) * numItems * numCandidates;
  cudaMalloc(&dBoxes, nb); cudaMalloc(&dOut, sizeof(float) * numCandidates);
  cudaMemcpy(dBoxes, hostBoxes, nb, cudaMemcpyHostToDevice);
  cudaMemset(dOut, 0, sizeof(float) * numCandidates);
  const int total = numCandidates * numItems * (numItems - 1) / 2, block = 256;
  overlapKernel<<<(total + block - 1) / block, block>>>(dBoxes, numItems, numCandidates, dOut);
  cudaMemcpy(hostOut, dOut, sizeof(float) * numCandidates, cudaMemcpyDeviceToHost);
  cudaFree(dBoxes); cudaFree(dOut);
}

}}  // namespace ll::cuda
