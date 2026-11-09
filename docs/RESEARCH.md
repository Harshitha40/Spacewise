# Research plan — Q1 journal paper

**Working title:** *Seeing the Better Room: Photo-Grounded Mixed-Reality Layout Exploration with Physically-Based Visual Analytics on Commodity Laptops*

The novelty is on the **computer graphics and VR** side, as requested. The optimiser and the parallel engine are enabling infrastructure; they are reported for completeness, not claimed as the contribution.

## 1. Problem
Interior-layout tools fall into two groups:
- **3D planners**: geometrically exact, but disconnected from the user's actual room.
- **AR apps**: grounded in the real room, but they need depth sensors or a headset and offer little analysis.

Lay users and designers therefore find it hard to judge *why* a layout is better (walkability, daylight, views) or what it would *look like in their own room*.

## 2. Contributions (candidate)
1. **Photo-grounded layout registration from a single uncalibrated photograph.** Four user-placed floor pins plus known room dimensions → planar homography → closed-form focal length and pose (`src/core/homography.js`). Proposed layouts are re-rendered *in the user's own photo* with contact shadows. Original furniture is removed with pyramid push-pull inpainting (diminished reality) and compared with a before/after slider. No depth sensor or headset is needed.
2. **In-situ physically-based visual analytics.** Three analyses are rendered *in the 3D scene and in the registered photo*:
   - walkability fields (exact distance transform + reachability)
   - animated circulation flows
   - CIE uniform-sky daylight factor with furniture occlusion, and TV sightline/glare cones

   This links each "why" directly to scene geometry.
3. **Persona-based desktop VR walkthrough for accessibility evaluation.** First-person exploration with a physical body capsule, using eye heights and body radii for a standing adult, a wheelchair user, and a child. It offers anaglyph and side-by-side stereo on a normal laptop, and WebXR when a headset is present.
4. **Interpretable, analysis-coupled layout suggestions.** Every term of the cost is a physical quantity (m² of overlap, % of unreachable floor, DF %), and the issues it reports name the blocking object (culprit search). Diverse strategies (minimal-change, open, light & views) produce alternatives for the user to explore rather than one opaque answer.

## 3. Research questions
- **RQ1 (accuracy)**: How accurately does single-image floor calibration register virtual furniture onto real photos? Measure reprojection error in px and pose error in cm/deg against ground truth.
- **RQ2 (comprehension)**: Do in-situ analytics overlays (in 3D and in AR) help users find layout problems faster and more accurately than a plain 3D planner?
- **RQ3 (decision quality)**: Does photo-grounded AR preview change user confidence and preference agreement with expert designers, compared with a 3D-only preview?
- **RQ4 (accessibility)**: Do persona walkthroughs reveal clearance and visibility problems that standing-adult inspection misses?
- **RQ5 (performance)**: Can the interactive analysis (< 16 ms/frame) and optimisation (< 3 s) run on commodity laptops? Report browser vs. native engine.

## 4. Experiments
| # | Study | Data / participants | Metrics |
|---|---|---|---|
| E1 | Calibration accuracy | Synthetic renders with known cameras (done in a unit test: exact recovery), plus ~40 real rooms with tape-measured ground truth | Reprojection px error, camera height error, FOV error; sensitivity to pin noise (Monte-Carlo ±5–20 px) |
| E2 | Analysis validity | Daylight factor vs. a Radiance/DIVA reference on 10 rooms; walkability vs. expert annotations | RMSE of DF, IoU of walkable area |
| E3 | Layout quality | 3D-FRONT bedrooms/living rooms (scaled to the catalog) and the user-study rooms | Cost terms, expert ratings (Likert), pairwise preference vs. original/expert layouts |
| E4 | Within-subject user study | 24–32 participants (designers, architects, home owners) | Task time, problem-detection F1, SUS, NASA-TLX, confidence; conditions: 3D-only / 3D+analytics / 3D+analytics+AR |
| E5 | Persona study | Subset of E4 plus accessibility experts | Problems found per persona |
| E6 | Performance | 3 laptops (integrated GPU → mid-range dGPU) | Frame time, analysis ms, optimisation s; native OpenMP scaling as a secondary result |

## 5. Related work to cover (verify each citation before use)
- Rule- and optimisation-based layout: Merrell et al., *Interactive Furniture Layout Using Interior Design Guidelines* (SIGGRAPH 2011); Yu et al., *Make It Home* (SIGGRAPH 2011).
- Learned scene synthesis: ATISS (NeurIPS 2021), DiffuScene (CVPR 2024), LayoutGPT (NeurIPS 2023); dataset 3D-FRONT (ICCV 2021).
- Single-image room layout: LayoutNet (CVPR 2018), HorizonNet (CVPR 2019).
- Diminished reality and AR interior design; mixed-reality visual analytics; accessibility evaluation in VR.

## 6. Target venues (Q1)
IEEE TVCG (with an IEEE VR / ISMAR journal track) · Computers & Graphics · Virtual Reality (Springer) · Automation in Construction · Building and Environment (if the daylight validation is strong) · International Journal of Human-Computer Studies (if the user study leads). Check each venue's current quartile in SJR/JCR at submission time.

## 7. Next steps for the paper
1. Collect the real-room dataset (photo + tape measurements + pins) for E1/E3.
2. Add a pin-noise robustness study and an optional automatic pin proposal (vanishing points / layout network). This is a strong follow-up contribution.
3. Add a study-logging mode (task timer, event log export) to the app for E4.
4. Validate daylight against Radiance on 10 rooms (E2).
