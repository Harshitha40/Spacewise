# LayoutLens native engine (C++17 · OpenMP · CUDA)

This is a port of the browser engine's cost function and simulated-annealing optimiser (`src/engine/*.js`).

| File | Content | Parallel back-end |
|---|---|---|
| `src/geometry.cpp` | oriented boxes, convex clipping, overlap areas | – |
| `src/walkability.cpp` | rasterise → exact EDT (Felzenszwalb) → BFS | OpenMP over cells / rows / columns |
| `src/evaluate.cpp` | multi-term layout cost | – (per-chain) |
| `src/optimizer.cpp` | simulated annealing, strategies | OpenMP over independent chains |
| `src/cuda/batch_eval.cu` | pairwise OBB overlap for *N* candidate layouts | CUDA, one thread per (candidate, pair) |
| `src/main.cpp` | dependency-free text I/O CLI | – |

## Build

```bash
# with CMake (recommended; MSVC, clang or a recent MinGW-w64)
cmake -S . -B build -DLL_OPENMP=ON            # add -DLL_CUDA=ON with the CUDA toolkit
cmake --build build --config Release

# or directly
g++ -std=c++17 -O3 -fopenmp -Iinclude src/*.cpp -o build/ll_engine
```

> On this dev machine (MinGW.org GCC 6.3, 32-bit) OpenMP fails to link because `-lpthread` is missing. The engine builds and runs without `-fopenmp`: the pragmas are ignored and the chains run serially. Install MinGW-w64 (MSYS2 `mingw-w64-ucrt-x86_64-gcc`) or Visual Studio Build Tools to get OpenMP.

## Run

```bash
node ../bridge.mjs              # from the repo root: node engine/bridge.mjs
# then open the app with ?engine=http://localhost:8787
```

## Roadmap for the parallel track
1. Replace `std::string` type compares in the hot loop with enum IDs. Reuse grid buffers per thread instead of allocating them on every evaluation.
2. Build a GPU population annealer (parallel tempering). Keep *K* replicas × *M* proposals on the device, and use `batch_eval.cu` plus a GPU walkability kernel (jump-flooding distance transform + frontier BFS).
3. Benchmarks: chains/s versus thread count (OpenMP strong scaling), and candidates/s on GPU versus CPU, for rooms of 5–40 items.
