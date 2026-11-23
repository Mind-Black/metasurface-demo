# Optical Metasurfaces Visualizer

An interactive visualizer and physical-optics simulator for optical metasurfaces, wavefields, and subwavelength nanostructures (`optical-metasurfaces` v2.0.0). Built with zero-framework TypeScript, Vite, Three.js, WebGL2, Canvas 2D, and an off-thread Web Worker angular-spectrum / Fraunhofer solver.

---

## Table of Contents

1. [Phase profiles](#phase-profiles)
2. [Two-function designs](#two-function-designs)
3. [Architecture & Runtime Data Flow](#architecture--runtime-data-flow)
4. [Fast File Lookup Table](#fast-file-lookup-table)
5. [Core Conventions & Invariants (Agent Catch-Up Guide)](#core-conventions--invariants-agent-catch-up-guide)
6. [Agentic Development Playbooks](#agentic-development-playbooks)
7. [Development, Testing & Benchmarking](#development-testing--benchmarking)
8. [GitHub Pages](#github-pages)

---

## Phase profiles

Every single-function and two-function architecture supports arbitrary superpositions of five scalar phase profiles designed at $\lambda_0$:

- **Metalens**: hyperbolic focusing profile $\phi_{\text{lens}}(r) = -k_0(\sqrt{r^2 + f^2} - f)$ (supports positive converging and negative diverging focal lengths $f \ne 0$).
- **Beam Deflector**: linear phase ramp $\phi_{\text{deflect}}(x) = k_0 \sin(\theta_0)\,x$.
- **Optical Vortex**: spiral azimuthal phase $\phi_{\text{vortex}}(r, \theta) = \ell\,\theta$ carrying orbital angular momentum $\ell\hbar$ per photon ($\ell \in [-10, +10]$).
- **Axicon**: conical radial linear phase $\phi_{\text{axicon}}(r) = -k_0\,r\,\text{NA}_0$, where $\text{NA}_0 = \sin\theta_{a,0}$. Positive $\text{NA}_0$ converges incident waves into an extended non-diffracting Bessel beam over depth of focus $z_{\max}(\lambda) = (D/2)\cot\theta(\lambda)$ with an annular far-field ring at $\sin\theta = (\lambda/\lambda_0)|\text{NA}_0|$; negative $\text{NA}_0$ (or LCP incidence in Pancharatnam–Berry mode) produces a diverging hollow cone. Superposing an axicon with a vortex forms a higher-order $J_\ell$ Bessel beam; superposing it with a lens produces a ring focus in the focal plane.
- **CGH Hologram**: iterative Gerchberg–Saxton phase-only mask (`crest`, `smiley`, or `mu`) reconstructed in the far field.

## Two-function designs

The **Orthogonal channels** configuration assigns independent combinations of lens,
deflection, vortex, axicon, and hologram phase to an orthogonal pair of input polarizations.
The design basis is independent of the illuminating polarization. For a single layer
of linearly birefringent nanofins, the ideal response is
`J = Σ exp(i φj) conj(uj) uj†`: each input `uj` becomes its complex-conjugate output
with the assigned phase. Elliptical and circular states reverse handedness. The
Jones-vector gauge is fixed by making the largest Cartesian component real and
positive, preferring x in a tie; channel phases use that convention.

The **Dynamic + PB** configuration instead assigns a profile to each phase
contribution. With the existing `exp(-iωt)` convention, RCP is `(x + iy)/√2`.
An ideal half-wave fin produces RCP → LCP phase `D + PB + π/2` and LCP → RCP
phase `D - PB + π/2`, with fin angle `PB/2`. The `π/2` term is common to both
channels. These are two phase contributions, rather than two independently
selected channel functions.

**Ideal target** holds the design matrix fixed during wavelength scans as a
dispersion-free reference. **Library prediction** selects the best complex
Jones response from the tabulated TiO₂ nanofins at the design wavelength, then
keeps geometry fixed as illumination changes. Its transmission, undesired-channel
power, and Jones error are absolute aperture averages; far-field images are
normalized independently and are not efficiency measurements. Geometry displayed
in ideal mode is a candidate implementation, not a claim that the library exactly
realizes the target. Unsupported material, pitch, height, or wavelength choices
cannot produce a library prediction.

All field views use the same transmitted Jones aperture. Propagation treats its
two transverse components with the existing angular-spectrum approximation;
the library uses a local periodic approximation. Neither is a full-device Maxwell
simulation. See the [single-layer Jones-matrix constraints](https://pmc.ncbi.nlm.nih.gov/articles/PMC9729203/).

---

## Architecture & Runtime Data Flow

```text
[User Controls / Sliders / Presets]
        │
        ▼
  opticsStore (src/lib/store/useOpticsStore.ts)
  Immutable OpticsState snapshot (synchronously updates CGH phase masks)
        │
        ├──► NanostructureLatticeViewer (Three.js InstancedMesh + 2D phase-map inset)
        │      └── targetPhaseToDiameter (rcwaLut.ts) / selectFin (metasurface.ts)
        │
        ├──► DualViewport & MetasurfaceControls (rAF-coalesced DOM sync & reconciliation)
        │      └── fieldClient.request({ kind: 'overview', ... }) ──► auto-calibrates intensityMax & focusZ
        │
        ├──► WavefieldRenderer (WebGL2 XZ slice, y = 0) ──┐
        ├──► XYProfileRenderer (WebGL2 XY slice, z = z_p) ├──► fieldClient (src/lib/optics/fieldClient.ts)
        └──► FarFieldRenderer  (Canvas 2D Fraunhofer FT) ─┘    (1 in-flight + 1 waiting per FieldKind)
                                                                      │
                                                                      ▼  Web Worker (postMessage + Transferables)
                                                               fieldWorker (src/lib/optics/fieldWorker.ts)
                                                                      │
                                      ┌───────────────────────────────┴───────────────────────────────┐
                                      ▼                                                               ▼
                       computeXZ / computeXY (propagation.ts)                          computeFarField (farField.ts)
                       1024² FFT angular spectrum + Chirp-Z (Czt)                      Separable Matrix Fourier Transform
                                      │                                                               │
                                      └───────────────┬───────────────────────────────────────────────┘
                                                      ▼
                            Aperture Evaluators: rcwaLut.ts (dynamic pillars)
                                                 finLut.ts (legacy PB nanofins)
                                                 vectorDevice.ts + metasurface.ts (two-function Jones matrices)
```

### Four Synchronized Viewports

1. **3D Nanostructure Lattice (`#lattice-card`, `NanostructureLattice.ts`)**: Three.js scene showing the circular aperture on a fused silica ($\text{SiO}_2$) substrate with either diameter-modulated circular nanopillars (`phaseMechanism === 'dynamic'` in legacy mode) or dimension- and angle-modulated rectangular nanofins (PB mode and two-function designs), colored by target phase $\phi \in [0, 2\pi)$, alongside a 128×128 2D Canvas phase-map inset (`#lattice-phase-map`).
2. **2D Wavefield Cross-Section (`#wavefield-card`, `WavefieldCanvas.ts`)**: WebGL2 fragment shader rendering the propagated complex field envelope $E(x, 0, z)\exp(-ikz)$ over $z \in [0, 60/\text{zoom}]\,\mu\text{m}$, restoring the carrier $\exp(i(kz - 4\pi t))$ per pixel at 60 fps without re-running the solver, plus optional geometric ray overlays and a draggable $z$-probe line.
3. **Transverse XY Profile (`#xy-card`, `XYProfileCanvas.ts`)**: WebGL2 fragment shader rendering the transverse field $E(x, y, z_{\text{probe}})$ with coaxial target rings ($r = 5, 10, 20\,\mu\text{m}$), toggleable between a 3rd split-screen panel (`xyViewMode: 'panel'`) and a picture-in-picture overlay (`xyViewMode: 'inset'`).
4. **Far-Field (`#farfield-card`, `FarFieldCanvas.ts`)**: Canvas 2D Fraunhofer diffraction view plotting $\text{FT}\{E\}$ against direction sines $(\sin\theta_x, \sin\theta_y) \in [-\text{sinMax}, +\text{sinMax}]^2$ at zoom levels $1\times$ ($\pm 1$) through $16\times$ ($\pm 0.0625$), marking the $\sin\theta = 1$ evanescent horizon.

---

## Fast File Lookup Table

### Entry, Shell, Styling & Build Configs

| File Path | Key Exports / Role | When to Edit |
| :--- | :--- | :--- |
| `index.html` | HTML shell (`#dual-viewport-root`), jsDelivr preconnect | Modifying page metadata, root mount node, or static head links |
| `src/main.ts` | App bootstrap (`fieldClient.warm()`, `new DualViewport(...)`, post-load `loadKatex()`) | Startup sequence, worker pre-warming, or global math upgrade initialization |
| `src/style.css` | All application CSS (layout grid, cards, controls, responsive tabs, math fallback) | Styling viewports, controls, mobile breakpoints, or fallback math typography |
| `package.json` | Scripts (`dev`, `build`, `preview`, `check`, `test`, `bench`) & dependencies (`three`) | Adding scripts or updating dependencies |
| `tsconfig.json` | Strict ES2022 bundler config; maps `@/*` → `./src/*`; excludes banked modules & `tests/bench` | Changing TypeScript compiler flags or path aliases |
| `vite.config.ts` | Vite config (`base: './'`, `@` alias, dev server on `127.0.0.1:3000`) | Modifying bundler settings or dev server port |
| `vitest.config.ts` | Unit test runner config (`tests/unit/**/*.{test,spec}.ts`, Node environment) | Adjusting unit test discovery or environment |
| `vitest.bench.config.ts` | Solver benchmark config (`tests/bench/**/*.bench.ts`, serial execution) | Modifying benchmark runner timeouts or parallelism |
| `playwright.config.ts` | Chromium E2E test config (`tests/browser`, preview server on `127.0.0.1:4173`) | Changing browser test timeouts, ports, or device projects |
| `.github/workflows/deploy.yml` | GitHub Actions workflow building `dist/` and deploying to GitHub Pages on `main` | Updating CI/CD Node version or deployment steps |

### State Management (`src/lib/store/`)

| File Path | Key Exports | Responsibility |
| :--- | :--- | :--- |
| `src/lib/store/useOpticsStore.ts` | `opticsStore`, `useOpticsStore`, `OpticsState`, `ActiveGradients`, `DeviceType`, `MaterialType`, `RenderMode`, `MAX_HOLOGRAM_ITERATIONS` | Single source of truth for optical parameters, active phase gradients, two-function `DeviceDesign` (`legacy`, `orthogonal`, `hybrid`), saved orthogonal/hybrid states, polarization `Stokes`, `PhaseMechanism`, `Analyzer`, viewport zoom/probe settings, and synchronous Gerchberg–Saxton phase-mask updates |

### Optics & Solver Engine (`src/lib/optics/`)

| File Path | Key Exports | Responsibility |
| :--- | :--- | :--- |
| `src/lib/optics/phaseProfiles.ts` | `getMetalensTargetPhase`, `getBeamDeflectorPhase`, `getVortexBeamPhase`, `getAxiconTargetPhase`, `getPBRotationAngle`, `calculateNumericalAperture`, `calculateAbbeLimit`, `calculateChromaticFocalShift`, `calculateDeflectionAngle`, `calculateAxiconDepthOfFocus`, `calculateBesselSpotFWHM`, `calculateAxiconPeriod`, `getDemonstrationIntensityScale`, `formatIntensityValue` | Analytic scalar phase formulas $\phi(x,y) \in [0, 2\pi)$ and optical figure-of-merit calculators (NA, Abbe limit, paraxial chromatic shift, anomalous refraction angle, Bessel depth of focus & spot FWHM, intensity slider calibration) |
| `src/lib/optics/polarization.ts` | `PhaseMechanism`, `Analyzer`, `Stokes`, `Complex`, `ChannelMix`, `cmul`, `cadd`, `cabs2`, `stokesFromEllipse`, `ellipseFromStokes`, `jonesFromStokes`, `stokesFromJones`, `toCircular`, `fromCircular`, `analyzerWeights`, `finJones`, `channelMixes`, `mixKey`, `pbFinAngle` | Polarization conventions ($\exp(-i\omega t)$, $\text{RCP} \equiv S_3 = +1$), Stokes $\leftrightarrow$ polarization ellipse $(\psi, \chi)$ $\leftrightarrow$ Jones vector conversions, circular basis projections, rotated nanofin Jones matrix, and legacy dynamic/PB `ChannelMix` weights |
| `src/lib/optics/metasurface.ts` | `PhaseProfile`, `DeviceDesign`, `ResponseModel`, `JonesVector`, `JonesMatrix`, `FinSelection`, `defaultOrthogonalDesign`, `defaultHybridDesign`, `profilePhase`, `designBasis`, `targetJones`, `applyJones`, `conjVector`, `projectJones`, `designKey`, `librarySupport`, `selectFin`, `finMatrix`, `designCell` | Single-layer two-function metasurface design: canonical Jones basis gauging, ideal unitary/retarder target Jones matrices (`orthogonal` and `hybrid`), deterministic content hashing (`designKey`), and Frobenius-optimal nanofin selection (`selectFin`) from `FIN_CELL_TABLE` |
| `src/lib/optics/vectorDevice.ts` | `isVectorDevice`, `vectorDeviceKey`, `vectorChannels`, `predictionSupport`, `vectorSampler`, `vectorDiagnostics`, `DeviceDiagnostics` | Connects two-function `DeviceDesign` to the wavefield and far-field solvers via a coherent per-cell Jones aperture sampler (`vectorSampler`) and computes aperture-averaged transmission, cross-channel leakage, and RMS Jones error (`vectorDiagnostics`) |
| `src/lib/optics/propagation.ts` | `FieldWindow`, `deviceKey`, `deviceSpectrum`, `computeXY`, `computeXZ`, `fft` | Scalar and dual-component angular-spectrum propagation from the $p = 250\text{ nm}$ lattice on a $1024^2$ FFT grid (`deviceSpectrum`), arbitrary-window 2D Chirp-Z transform (`Czt`) with Matsushima band-limiting (`computeXY`), and carrier-stripped $y=0$ axial slice solver (`computeXZ`) |
| `src/lib/optics/farField.ts` | `FarFieldInput`, `FarFieldResult`, `deviceChannels`, `cellField`, `aperturePhase`, `computeFarField` | Fraunhofer far-field diffraction via a separable 2D Matrix Fourier Transform (MFT) directly onto direction-sine coordinates $(\sin\theta_x, \sin\theta_y) \in [-\text{sinMax}, +\text{sinMax}]^2$ |
| `src/lib/optics/farFieldColor.ts` | `FarFieldColorOptions`, `colorizeFarField` | Zero-allocation RGBA byte buffer colorizer for `FarFieldResult` (`field` wave animation at 2 Hz, `phase` HSV wheel with `WeakMap` phase cache, and `intensity` polynomial Inferno colormap in linear or 40 dB log scale) |
| `src/lib/optics/fft.ts` | `fft` | In-place radix-2 forward FFT with cached bit-reversal and stage-contiguous twiddle tables, strided scratch gather, multiply-free first pass, and register-paired radix-4 butterfly loops |
| `src/lib/optics/gerchbergSaxton.ts` | `HologramResult`, `sampleHologramPhase`, `hologramPupilSamples`, `dft2d`, `fftShift2D`, `generateTargetBitmap`, `runGerchbergSaxton` | Iterative Gerchberg–Saxton phase retrieval for phase-only CGH on a circular pupil with deterministic PRNG (`seed = 42`), synthetic 32×32 target bitmaps (`crest`, `smiley`, `mu`), and power-of-two FFT acceleration |
| `src/lib/optics/materials.ts` | `MaterialDispersion`, `TiO2_Dispersion`, `Silicon_Dispersion`, `SiO2_Dispersion` | Complex refractive index $n(\lambda) + i k(\lambda)$ dispersion models for ALD $\text{TiO}_2$, crystalline/amorphous $\text{Si}$, and fused silica ($\text{SiO}_2$) substrate |
| `src/lib/optics/rcwaLut.ts` | `TABLE_PITCH_UM`, `UnitCellResponse`, `phaseResponse`, `queryUnitCellLUT`, `targetPhaseToDiameter` | Dynamic-phase circular nanopillar lookup: bilinearly interpolates `UNIT_CELL_TABLE` onto a 1 nm diameter grid and 1024 phase bins (with optimal common phase offset) for tabulated $\text{TiO}_2$ ($p=250\text{ nm}, h=600\text{ nm}$), or falls back to an area-averaged effective-index Fabry–Pérot model |
| `src/lib/optics/finLut.ts` | `FinResponse`, `pbResponse`, `FIN_HEIGHT_NM`, `FIN_TABLE_SIZE` | Legacy PB rectangular nanofin lookup: linearly interpolates `FIN_CELL_TABLE` across wavelength and selects the fin geometry maximizing helicity conversion $|d|^2 = |(t_L - t_S)/2|^2$ at $\lambda_0$ |
| `src/lib/optics/unitCellTable.ts` | `UNIT_CELL_TABLE` | **Generated file** (by `tools/rcwa/generate_unit_cell_table.py`): RCWA zeroth-order complex transmission for $\text{TiO}_2$ circular pillars on $\text{SiO}_2$ ($p = 250\text{ nm}, h = 600\text{ nm}$, $d \in [60, 210]\text{ nm}$, $\lambda \in [400, 1550]\text{ nm}$) |
| `src/lib/optics/finCellTable.ts` | `FIN_CELL_TABLE` | **Generated file** (by `tools/rcwa/generate_fin_table.py`): RCWA zeroth-order complex transmission $(t_L, t_S)$ for $\text{TiO}_2$ rectangular nanofins on $\text{SiO}_2$ ($p = 250\text{ nm}, h = 600\text{ nm}$, $L \in [100, 210]\text{ nm}$, $W \in [50, 110]\text{ nm}$, $\lambda \in [400, 1550]\text{ nm}$) |
| `src/lib/optics/fieldClient.ts` | `FieldKind`, `FieldRequest`, `FieldReply`, `deviceFromState`, `fieldClient` | Main-thread Web Worker client: maps `OpticsState` → `FarFieldInput` (`deviceFromState`) and coalesces solve requests (at most 1 running + 1 latest waiting per `FieldKind`: `'xy' \| 'xz' \| 'overview' \| 'far'`) |
| `src/lib/optics/fieldWorker.ts` | Web Worker message handler | Validates incoming `FieldRequest` payloads, runs `computeXY`, `computeXZ`, or `computeFarField` off the main thread, and returns transferable typed-array buffers |

### UI & Viewport Components (`src/components/`)

| File Path | Key Exports | Responsibility |
| :--- | :--- | :--- |
| `src/components/viewer/DualViewport.ts` | `DualViewport`, `polarizationEllipsePath` | Top-level view controller: renders the 4 viewport cards, mobile tab bar, control dock, multi-gradient combiner, polarization widget, and mode-specific parameter panels; runs `overview` auto-calibration and `requestAnimationFrame`-coalesced store sync |
| `src/components/viewer/MetasurfaceControls.ts` | `MetasurfaceControls` | UI controller for single-layer design architecture selection (`Legacy`, `Orthogonal channels`, `Dynamic + PB`), response model (`Ideal target`, `Library prediction`), input basis $(\psi, \chi)$, and dual profile cards; uses custom focus-preserving DOM `reconcile()` |
| `src/components/viewer/FieldCanvas.ts` | `FieldCanvas`, `FIELD_GLSL`, `interleave` | Abstract WebGL2 base renderer for complex 2D fields: packs 1 or 2 complex channels into an `RGBA32F` texture, performs shader bilinear interpolation (`sampleField`) and carrier phase rotation, debounces resize solves (`120 ms`), and pauses off-screen via `IntersectionObserver` |
| `src/components/viewer/WavefieldCanvas.ts` | `WavefieldRenderer`, `xzFieldRequest` | WebGL2 renderer for the $y = 0$ axial XZ wavefield slice: restores axial carrier $\exp(i(kz - 4\pi t))$, draws optional geometric rays (with evanescent cutoff), substrate marker, and pointer-draggable $z$-probe line |
| `src/components/viewer/XYProfileCanvas.ts` | `XYProfileRenderer`, `xyFieldRequest` | WebGL2 renderer for the transverse XY plane at $z = \text{probeZ}$ with crosshair axes and concentric reference rings ($r = 5, 10, 20\,\mu\text{m}$) |
| `src/components/viewer/FarFieldCanvas.ts` | `FarFieldRenderer` | Canvas 2D renderer for the Fraunhofer far-field pattern: blits `colorizeFarField` via an offscreen canvas, draws $\sin\theta$ axes and the $\sin\theta = 1$ dashed horizon circle, and updates `#metasurface-metrics` |
| `src/components/viewer/NanostructureLattice.ts` | `NanostructureLatticeViewer`, `latticePositions`, `latticePhaseInput`, `latticeTargetPhase`, `latticePillarGeometry`, `latticeFinGeometry`, `latticePhaseMapCoordinates`, `phaseColor`, `phaseMapPixels` | Three.js 3D instanced lattice renderer (orbit camera, bottom-uncapped cylinder/box `InstancedMesh` with partial buffer upload ranges) and 2D Canvas top-view phase-map inset |
| `src/components/math/MathTypography.ts` | `formatLatexFallback`, `renderFormula`, `renderBlockFormula`, `loadKatex`, `upgradeMathInContainer` | Asynchronous KaTeX CSS+JS loader (`loadKatex`) and progressive DOM upgrader (`upgradeMathInContainer`) for `.math-tex` and `.math-block` elements with a pure-TS semantic HTML fallback parser |
| `src/components/metrics/PerformanceHUD.ts` | `PerformanceHUD` | Standalone metrics dashboard calculating NA, Abbe limit FWHM, 3-bit phase discretization Strehl ratio, focusing efficiency $\eta$, aspect ratio, and nanofabrication/absorption alarms |

### Offline RCWA Table Generators (`tools/rcwa/`)

| File Path | Role & Usage |
| :--- | :--- |
| `tools/rcwa/rcwa.py` | Minimal 2D Fourier Modal Method (RCWA) solver in NumPy (`conv_mat`, `pillar_grid`, `rect_grid`, `solve`, `slab`). Run directly (`python tools/rcwa/rcwa.py`) to self-test against analytical Fabry–Pérot slab transmission |
| `tools/rcwa/generate_unit_cell_table.py` | Multiprocessing script that regenerates `src/lib/optics/unitCellTable.ts` (`N = 7` harmonics, $31\text{ diameters} \times 48\text{ wavelengths} = 1488\text{ cells}$). Use `--check` to compare truncation orders $N \in \{4, 7, 10\}$ |
| `tools/rcwa/generate_fin_table.py` | Multiprocessing script that regenerates `src/lib/optics/finCellTable.ts` ($12\text{ lengths} \times 7\text{ widths} \times 48\text{ wavelengths} = 4032\text{ cells}$). Forces single-threaded BLAS per worker; use `--check` to verify convergence |

### Tests, Numerical Oracles & Benchmarks (`tests/`)

| File Path | What It Verifies |
| :--- | :--- |
| `tests/unit/optics.test.ts` | Analytic phase profiles (metalens, negative focal length, deflector, vortex, axicon), NA, Abbe limit, chromatic shift, Bessel FWHM/DOF/period, and material dispersions |
| `tests/unit/polarization.test.ts` | IEEE circular basis, Stokes $\leftrightarrow$ ellipse $\leftrightarrow$ Jones conversions, rotated nanofin Jones matrix, and `channelMixes` |
| `tests/unit/metasurface.test.ts` | Two-function `orthogonal` and `hybrid` designs, canonical basis gauge, conjugate output polarization constraints, `designKey` hashing, and `selectFin` library lookup |
| `tests/unit/vectorDevice.test.ts` | Coherent aperture sampling (`vectorSampler`), analyzer projections (`channel1`, `channel2`, `rcp`, `lcp`, `x`, `y`), propagation consistency, and `vectorDiagnostics` |
| `tests/unit/propagation.test.ts` | Angular-spectrum solver (`computeXY`, `computeXZ`), focus localization, chromatic focal shift, Bessel beam propagation, and cache keys |
| `tests/unit/pbSolver.test.ts` | Pancharatnam–Berry geometric-phase helicity conversion, RCP vs. LCP conjugate behavior, and co-polarized leakage in `computeXY`, `computeXZ`, and `computeFarField` |
| `tests/unit/farField.test.ts` | Fraunhofer MFT solver (`computeFarField`), deflection spot coordinates $\sin\theta = (\lambda/\lambda_0)\sin\theta_0$, vortex central null, axicon annular ring, and evanescent cutoff |
| `tests/unit/hologram.test.ts` | 2D DFT energy conservation (Parseval), Gerchberg–Saxton convergence, circular pupil sampling, and store integration |
| `tests/unit/pillarPhase.test.ts` | Phase-to-diameter inversion (`targetPhaseToDiameter`), RCWA LUT round-trip accuracy, and 2D phase map coordinate orientation |
| `tests/unit/lattice.test.ts` | Fixed-pitch circular aperture coordinate generation (`latticePositions`) across aperture diameters |
| `tests/unit/drawing.test.ts` | Bit-exact equivalence of `colorizeFarField` against `legacyFarFieldColor.ts` and `phaseMapPixels` rendering |
| `tests/unit/fft.test.ts` | Bit-exact equivalence and invertibility of `fft.ts` against `legacyPropagation.ts` across power-of-two lengths and strides |
| `tests/unit/gerchbergEquivalence.test.ts` | Bit-exact equivalence of flat typed-array `runGerchbergSaxton` and `dft2d` against `legacyGerchbergSaxton.ts` |
| `tests/unit/solverEquivalence.test.ts` | Bit-exact (`===`) output equivalence of optimized `deviceSpectrum`, `computeXY`, and `computeXZ` against `legacyPropagation.ts` |
| `tests/unit/solverCache.test.ts` | `deviceKey` / `maskKey` content hashing across structured clones and viewport request generation (`xzFieldRequest`, `xyFieldRequest`) |
| `tests/unit/components.test.ts` | `MathTypography` LaTeX fallback formatting, `PerformanceHUD` metrics/alarms, and `DualViewport` template & store integration |
| `tests/unit/mathUpgrade.test.ts` | Two-stage math upgrade lifecycle (`fallback` → `katex`) in `upgradeMathInContainer` |
| `tests/unit/helpers/legacy*.ts` | **Frozen numerical oracles** (`legacyFarField.ts`, `legacyFarFieldColor.ts`, `legacyGerchbergSaxton.ts`, `legacyPropagation.ts`) snapshot at commit `32233e7`. **Never edit these files** |
| `tests/browser/*.spec.ts` | Playwright Chromium suites: `app.spec.ts` (UI & controls), `metasurface.spec.ts` (two-function workflows), `mobile-viewports.spec.ts` (responsive tabs), `perf.spec.ts` (GL draw & worker job counters), `startup.spec.ts` (slow-CDN KaTeX resilience) |
| `tests/bench/solver.bench.ts` | Vitest performance benchmark suite (`npm run bench`) using `tests/bench/harness.ts` to compare median solver timings against `tests/bench/baseline.json` |

> **Note on Ignored / Excluded Paths**: `.gitignore` and `tsconfig.json` explicitly exclude `/src/components/modules/` and `/tests/unit/narrative.test.ts` ("banked explanatory content, kept locally for a later release") as well as `/docs/NEW_metasurface_website_agent_prompt.md`. Do not import from `src/components/modules/` in active code.

---

## Core Conventions & Invariants (Agent Catch-Up Guide)

### 1. Units Boundary ($\mu\text{m}$ vs. $\text{nm}$)

Maintaining the unit boundary is the most common source of bugs when editing optical calculations:

- **Micrometers ($\mu\text{m}$)**: Used everywhere in `OpticsState`, `FarFieldInput`, `phaseProfiles.ts`, `propagation.ts`, `farField.ts`, and `NanostructureLattice.ts` world coordinates:
  - `wavelength` ($\lambda$, e.g. `0.532`), `designWavelength` ($\lambda_0$, e.g. `0.532`)
  - `focalLength` ($f$, e.g. `25.0`), `diameter` ($D$, e.g. `30.0`), `probeZ` ($z \in [0, 60]$)
  - Spatial coordinates $(x, y, z)$, grid pitch `TABLE_PITCH_UM = 0.25`, spatial frequencies $(f_x, f_y, \Delta f)$ in $\mu\text{m}^{-1}$, and axial wavenumber $k_z$ in $\text{rad}/\mu\text{m}$.
- **Nanometers ($\text{nm}$)**: Used for subwavelength unit-cell geometry and material dispersion tables:
  - `pitchNm` (`250`), `heightNm` (`600`), pillar `diameterNm` (`60`–`210`), fin `lengthNm` (`100`–`210`), fin `widthNm` (`50`–`110`)
  - Arguments to `MaterialDispersion.getRefractiveIndex(wavelengthNm)`, `queryUnitCellLUT(diameterNm, wavelengthNm, ...)`, `targetPhaseToDiameter(targetPhase, wavelengthNm, ...)`, and table arrays in `UNIT_CELL_TABLE` / `FIN_CELL_TABLE`.
  - Note: UI wavelength sliders display $\text{nm}$ (`400`–`1550`) and convert via `nm / 1000.0` before calling `setWavelength()`.
- **Angles**: Stored in **radians** in `OpticsState`, `PhaseProfile`, and solvers (`deflectionAngle`, `basis.psi`, `basis.chi`, `FinSelection.angle`), and converted to **degrees** only at the UI boundary (`DualViewport.ts`, `MetasurfaceControls.ts`).

### 2. Harmonic Time, Polarization & Jones Gauge Conventions

- **Time Factor**: $\exp(-i\omega t)$ across `tools/rcwa` and `src/lib/optics`. A physical propagation delay corresponds to a **positive** phase $+\phi$.
- **Circular Basis & IEEE Handedness** (`src/lib/optics/polarization.ts`):
  $$\mathbf{e}_+ = \frac{\hat{\mathbf{x}} + i\hat{\mathbf{y}}}{\sqrt{2}} \quad (\text{RCP}, \; S_3 = +1), \qquad \mathbf{e}_- = \frac{\hat{\mathbf{x}} - i\hat{\mathbf{y}}}{\sqrt{2}} \quad (\text{LCP}, \; S_3 = -1)$$
  Circular complex amplitudes are $a_\pm = \langle \mathbf{e}_\pm | \mathbf{E} \rangle$, so $a_+ = (E_x - i E_y)/\sqrt{2}$ and $a_- = (E_x + i E_y)/\sqrt{2}$.
- **Rotated Nanofin Jones Matrix**: A birefringent nanofin with principal axis transmissions $(t_L, t_S)$ rotated by in-plane angle $\theta$ has Cartesian Jones matrix $\mathbf{J}(\theta) = \mathbf{R}(\theta)\operatorname{diag}(t_L, t_S)\mathbf{R}(-\theta)$. In the circular basis, with $c = (t_L + t_S)/2$ (co-polarized leakage) and $d = (t_L - t_S)/2$ (helicity-converted amplitude):
  $$E_+ = c\,a_+ + d\,e^{-2i\theta}a_-, \qquad E_- = c\,a_- + d\,e^{+2i\theta}a_+$$
  Setting $\theta = \phi/2$ imparts $+\phi$ to $\text{RCP} \to \text{LCP}$ and $-\phi$ to $\text{LCP} \to \text{RCP}$.
- **Canonical Jones Vector Gauges**:
  - In `metasurface.ts` (`canonical` / `designBasis`), each basis vector is normalized and phase-rotated so its **largest-magnitude Cartesian component is real and non-negative** (preferring $E_x$ in a tie within $10^{-14}$). This guarantees exact $\text{H}/\text{V}$ and $\mathbf{e}_+/\mathbf{e}_-$ vectors at presets.
  - In `polarization.ts` (`jonesFromStokes`), the global phase of an input Stokes state is fixed by real $E_x \ge 0$.
- **Dual-Component Field Packing (`ChannelMix` & `FieldWindow`)**:
  - When `analyzer !== 'none'`, the solver projects the transmitted Jones field onto the analyzer state (`rcp`, `lcp`, `x`, `y`, `channel1`, `channel2`) and returns a single complex scalar plane (`FieldWindow.data`).
  - When `analyzer === 'none'`, the solver computes two orthogonal components: component `A` ($E_x$, stored in `FieldWindow.data`, shown in `Wave` and `Phase` modes) and component `B` ($E_y$, stored in `FieldWindow.dataB`), so total intensity in `Intensity` mode is $|A|^2 + |B|^2$.

### 3. Solver Approximations & Numerical Algorithms

- **Locally Periodic Approximation**: Each lattice site $(x_i, y_j) = (i\,p, j\,p)$ within the circular aperture ($x^2 + y^2 \le (D/2)^2$) is assigned the zeroth-order complex transmission of a periodic RCWA unit cell at pitch $p = 250\text{ nm}$ (`TABLE_PITCH_UM = 0.25`).
- **Angular Spectrum (`deviceSpectrum` in `propagation.ts`)**:
  - Places aperture cell amplitudes into a $1024 \times 1024$ grid (`N = 1024`, $\Delta f = 1/(N p) = 1/256\,\mu\text{m}^{-1}$).
  - Transforms only non-empty rows, gathers only propagating columns ($|f_x| \le 1/\lambda$) into contiguous buffers to avoid cache-thrashing stride-$N$ butterflies, multiplies by the separable square-cell envelope $\operatorname{sinc}(f_x p)\operatorname{sinc}(f_y p)/N^2$, filters to propagating waves ($f_x^2 + f_y^2 < 1/\lambda^2$), and culls bins with amplitude below `CULL = 1e-3` of the peak bin.
- **Transverse Slice (`computeXY`)**:
  - Applies the **Matsushima band limit** $|f_{x,y}| \le \frac{1}{\lambda\sqrt{(2\,\Delta f\,z)^2 + 1}}$ to prevent aliased transfer-function oscillations at large $z$.
  - Evaluates the inverse Fourier transform onto the exact viewport pixel grid via a 2D **Chirp-Z Transform (`Czt`)**, choosing the axis transform order (`cols + ny < rows + nx`) that minimizes total 1D CZT runs.
- **Axial Cross-Section (`computeXZ`)**:
  - Computes the slowly varying axial envelope $E(x, 0, z)\exp(-ikz)$ so coarse axial sampling ($N_z = 256$ over $60\,\mu\text{m}$) does not alias the optical carrier; `WavefieldCanvas.ts` multiplies by $\exp(i(kz - 4\pi t))$ in the fragment shader.
  - Uses even $f_y$ rows (`!(s.iy[i] & 1)`), which folds the field at $|y| = 128\,\mu\text{m}$ onto $y = 0$ while halving the summation work, groups bins by $f_x$ column via a stable counting sort, steps along $z$ with a 4-way unrolled phasor recurrence, and transforms $f_x \to x$ via a 1D `Czt`.

### 4. State, Worker & Caching Invariants

- **Immutable Store Snapshots & Eager CGH Masks**: `opticsStore.update()` and `setProfile()` compute `runGerchbergSaxton()` **before** assigning `this.state` and notifying listeners. Never trigger store mutations or mask generation inside a subscriber or render loop.
- **Content Hashing Across Worker Boundaries**: `FieldRequest` crosses into `fieldWorker.ts` via `postMessage` (`structuredClone`), which creates a fresh array reference for `cghPhaseMask` and `design` on every message. Consequently:
  - Always use `maskKey(mask)` (`propagation.ts`) and `designKey(design)` (`metasurface.ts`) for solver cache keys.
  - On the main thread, `FieldCanvas.syncField()` memoizes `deviceKey(device)` against the immutable `OpticsState` reference so it does not re-hash hologram masks on every 60 fps animation frame.
- **Worker Backpressure (`FieldClient`)**: `fieldClient.request()` allows at most **one** running worker job and **one** latest waiting job per `FieldKind` (`'xy'`, `'xz'`, `'overview'`, `'far'`). When a job completes and a newer request of the same kind is waiting, the stale reply callback is suppressed so obsolete fields never flash.
- **LRU Cache Sizes**:
  - `propagation.ts`: `spectrumCache` (4 slots), `cztCache` (4 slots)
  - `metasurface.ts`: `candidateCache` (64 wavelengths), `selectionCache` (32,768 targets), `responseCache` (32,768 evaluations)
  - `rcwaLut.ts` & `finLut.ts`: `byWavelength`, `phaseResponses`, and `responses` maps (cleared at 128 entries)

---

## Agentic Development Playbooks

### Playbook A: Adding or Modifying a Phase Profile

1. **Formula & Helpers (`src/lib/optics/phaseProfiles.ts`)**: Add the phase function returning wrapped phase in $[0, 2\pi)$ (with coordinates and wavelength in $\mu\text{m}$) and any analytical helper functions.
2. **Types & Store (`src/lib/store/useOpticsStore.ts`)**:
   - Add the profile flag to `ActiveGradients`, `DeviceType`, and `OpticsState` (plus default values and setter/validation in `setProfile`).
3. **Two-Function & Aperture Evaluators**:
   - Update `PhaseProfile`, `defaultProfile()`, and `profilePhase()` in `src/lib/optics/metasurface.ts`.
   - Update `FarFieldInput` and `aperturePhase()` in `src/lib/optics/farField.ts`.
   - Update `scalarKey()` in `src/lib/optics/propagation.ts` and `deviceFromState()` in `src/lib/optics/fieldClient.ts`.
   - Update `validate()` in `src/lib/optics/fieldWorker.ts`.
4. **Viewports & Controls**:
   - Update ray slope calculation in `src/components/viewer/WavefieldCanvas.ts` (`FS_SOURCE` and uniforms) if geometric rays apply.
   - Update cache key in `src/components/viewer/NanostructureLattice.ts` (`updateLattice`).
   - Add toggle chips, presets, and parameter controls in `src/components/viewer/DualViewport.ts` and profile checkboxes/inputs in `src/components/viewer/MetasurfaceControls.ts`.
5. **Tests**: Add unit tests in `tests/unit/optics.test.ts`, `tests/unit/metasurface.test.ts`, and `tests/unit/farField.test.ts`.

### Playbook B: Modifying Solver or FFT Hot Paths

1. **Preserve Numerical Equivalence**: `tests/unit/fft.test.ts`, `tests/unit/solverEquivalence.test.ts`, `tests/unit/gerchbergEquivalence.test.ts`, and `tests/unit/drawing.test.ts` assert **bit-exact (`===`)** equality against the frozen reference implementations in `tests/unit/helpers/legacy*.ts`.
2. **Operation Order Matters**: Floating-point addition and butterfly ordering in `fft.ts`, `propagation.ts`, and `gerchbergSaxton.ts` are deliberately arranged to match the legacy summation order while optimizing memory locality and register reuse. Do not reorder reductions unless deliberately updating physical models.
3. **Benchmark**: Run `npm run bench` before and after performance changes to verify median wall-time improvements against `tests/bench/baseline.json`.

### Playbook C: Regenerating or Extending RCWA Lookup Tables

1. **Keep Dispersion Models Synchronized**: `n_tio2` and `n_sio2` in `tools/rcwa/generate_unit_cell_table.py` (imported by `generate_fin_table.py`) **must** match `TiO2_Dispersion` and `SiO2_Dispersion` in `src/lib/optics/materials.ts`.
2. **Convergence Check**:
   ```bash
   cd tools/rcwa
   python rcwa.py
   python generate_unit_cell_table.py --check
   python generate_fin_table.py --check
   ```
3. **Regenerate TypeScript Tables**:
   ```bash
   cd tools/rcwa
   python generate_unit_cell_table.py
   python generate_fin_table.py
   ```
   This overwrites `src/lib/optics/unitCellTable.ts` and `src/lib/optics/finCellTable.ts`. Run `npm test` afterwards to confirm all LUT and PB solver assertions pass.

### Playbook D: Adding UI Controls or Mathematical Typography

- **LaTeX Markup**: Wrap inline formulas in `<span class="math-tex">\lambda_0</span>` (or `<div class="math-block">...</div>`). When inside `DualViewport.getTemplate()`, note that the template uses `String.raw` so single backslashes (`\lambda`, `\Phi`) are preserved literally.
- **Dynamic DOM Updates**: If you inject new `.math-tex` elements after initial mount, call `upgradeMathInContainer(container)` from `src/components/math/MathTypography.ts`.
- **Two-Function Controls**: `MetasurfaceControls.ts` re-renders on store notifications using `reconcile(this.host, template.content)` so active `<input>` focus and `<details open>` states are not destroyed during typing or pointer events.

---

## Development, Testing & Benchmarking

```bash
# Install dependencies
npm ci

# Start local Vite dev server (http://127.0.0.1:3000)
npm run dev

# Type-check with TypeScript (tsc --noEmit)
npm run check

# Run all Vitest unit and numerical equivalence tests
npm test

# Run solver & FFT performance benchmarks against baseline.json
npm run bench

# Build production bundle to dist/
npm run build

# Run Playwright Chromium E2E, mobile viewport, startup, and draw-counter tests
npx playwright test
```

## GitHub Pages

Push to a GitHub repository with `main` as its default branch. In **Settings → Pages**, choose **GitHub Actions** as the source. The workflow builds and publishes the site on pushes to `main`, and can also be run from the Actions tab. The published address is shown in the workflow run and Pages settings.
