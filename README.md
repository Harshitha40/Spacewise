# LayoutLens — photo-to-3D room layout studio

Upload a photo of a room. LayoutLens detects the furniture, asks for real dimensions, and rebuilds the room in 3D at true scale. It then flags collisions and blocked walkways, simulates daylight and TV sightlines, and generates optimised layouts. You can walk through the result in first person (desktop VR) or see it **overlaid on your own photo** (AR). It all runs in an ordinary laptop browser, with no headset required.

**Pipeline:** photo → in-browser detection → dimensions + 4-pin calibration → metric 3D room → live analysis → parallel optimisation → walk through it (VR) or see it in your photo (AR).

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # engine + calibration unit tests
npm run build          # static production build in dist/ (deployable to any static host)
```

There are three ways to start:
- **Upload a photo**: you go through detection, then dimensions and calibration, then the 3D studio.
- **Sample rooms**: these are deliberately imperfect, so the analysis has something to show.
- **Open** a saved `.layoutlens.json` project.

## Workflow

| Step | What happens |
|---|---|
| 1. Upload | Drag in a room photo (JPG/PNG). Nothing leaves the browser. |
| 2. Analyse | TensorFlow.js COCO-SSD detects furniture in the browser and infers the room type (bedroom, living room, kitchen, …). |
| 3. Dimensions | You enter the room size (ft/in or m/cm), doors and windows, and each item's size (with presets such as Queen bed or 3-seat sofa). You also drag **4 pins** onto the floor so the app can recover the photo's camera pose. |
| 4. Design & optimise | A 3D studio with drag & drop, rotation, undo/redo, live analysis and one-click optimised layout suggestions. |

### Views
- **3D** — a dollhouse view with an automatic wall cutaway. Hidden walls still cast sun shadows.
- **Plan** — an orthographic top-down view with labels.
- **Walk** — a desktop VR walkthrough with WASD + mouse-look and a collision body. Personas: standing adult, wheelchair user, child. Output modes: mono, red/cyan anaglyph, or side-by-side for cardboard viewers; WebXR is used when a headset is present.
- **AR photo** — the 3D layout rendered from the recovered camera on top of your photo. Detected original furniture is removed by inpainting (diminished reality), and a compare slider and opacity control are included.

### Analysis overlays
Collisions · walkable floor (comfortable / tight / cut-off) · animated circulation paths from doors to every access point · ergonomic clearance zones · TV sightlines and glare · daylight factor heatmap · time-of-day sun with real shadows.

## Architecture

```
src/
  core/        catalog (dimensions, clearances, semantics), units, homography calibration
  vision/      COCO-SSD detection, push-pull inpainting (diminished reality)
  engine/      geometry · walkability grid (raster → distance transform → BFS) · daylight & sightlines
               · evaluate (interpretable multi-term cost) · simulated annealing · Web-Worker pool
  scene/       Three.js viewer, room shell, procedural metric furniture, overlays, walkthrough
  ui/          dimensions step, design studio, 2D plan renderer
engine/
  cpp/         native C++17 engine (OpenMP chains + EDT, CUDA batched overlap kernel)
  bridge.mjs   HTTP bridge → app uses it via  ?engine=http://localhost:8787
docs/RESEARCH.md   paper plan: contributions, research questions, experiments, target venues
```

The UI only talks to the `LocalEngine` / `RemoteEngine` interface (`src/engine/index.js`), so the native engine can replace the browser engine without changing the UI.

### Parallelism
| Stage | Browser (now) | Native (engine/cpp) |
|---|---|---|
| Annealing chains (strategies × restarts) | Web-Worker pool (`hardwareConcurrency`) | `#pragma omp parallel for` |
| Grid rasterisation, distance transform | sequential | OpenMP, separable exact EDT |
| Batched candidate evaluation (pairwise OBB overlap) | — | CUDA kernel `batch_eval.cu` |

## Native engine
See [engine/cpp/README.md](engine/cpp/README.md). Short version:

```bash
cmake -S engine/cpp -B engine/cpp/build -DLL_OPENMP=ON   # -DLL_CUDA=ON on an NVIDIA machine
cmake --build engine/cpp/build --config Release
node engine/bridge.mjs
# open http://localhost:5173/?engine=http://localhost:8787
```

## Keyboard
`1-4` switch views · drag to move · `R` rotate 90° · `Q/E` ±15° · `Del` remove · `Alt` drag without snapping · `Ctrl+Z / Ctrl+Y` undo/redo · Walk: `WASD`, `Shift` run, `Esc` release mouse.
