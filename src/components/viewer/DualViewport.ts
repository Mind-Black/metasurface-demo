import { opticsStore, DeviceType, RenderMode, MaterialType, ActiveGradients } from '@/lib/store/useOpticsStore';
import { WavefieldRenderer } from './WavefieldCanvas';
import { NanostructureLatticeViewer } from './NanostructureLattice';
import { XYProfileRenderer } from './XYProfileCanvas';
import { FarFieldRenderer } from './FarFieldCanvas';
import { PerformanceHUD } from '../metrics/PerformanceHUD';
import { getDemonstrationIntensityScale, formatIntensityValue, IntensityScaleRange, calculateDeflectionAngle } from '@/lib/optics/phaseProfiles';

export class DualViewport {
  private container: HTMLElement;
  private wavefieldRenderer: WavefieldRenderer | null = null;
  private latticeViewer: NanostructureLatticeViewer | null = null;
  private xyRenderer: XYProfileRenderer | null = null;
  private farFieldRenderer: FarFieldRenderer | null = null;
  private hud: PerformanceHUD | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    this.initComponents();
    this.attachEventListeners();
  }

  public static getTemplate(): string {
    return `
      <div class="dual-viewport-root">
        <!-- Sticky Header Controls Bar -->
        <header class="viewport-toolbar">
          <div class="toolbar-section">
            <span class="toolbar-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/></svg>
              Dual Viewport Visualizer
            </span>

            <!-- Device Selector -->
            <div class="segmented-control" role="tablist" aria-label="Metasurface Device Mode">
              <button class="seg-btn active" data-device="metalens" role="tab" aria-selected="true">Metalens</button>
              <button class="seg-btn" data-device="deflector" role="tab" aria-selected="false">Deflector</button>
              <button class="seg-btn" data-device="vortex" role="tab" aria-selected="false">Vortex (OAM)</button>
              <button class="seg-btn" data-device="hologram" role="tab" aria-selected="false">Hologram</button>
            </div>
          </div>

          <div class="toolbar-section">
            <!-- 2D Render Mode Selector -->
            <div class="segmented-control" role="tablist" aria-label="Field Render Mode">
              <button class="seg-btn active" data-render="field" role="tab" aria-selected="true" title="Instantaneous Electric Field Re{E}">Wave Re{E}</button>
              <button class="seg-btn" data-render="intensity" role="tab" aria-selected="false" title="Optical Intensity |E|²">Intensity |E|²</button>
              <button class="seg-btn" data-render="phase" role="tab" aria-selected="false" title="Transmitted Phase arg(E)">Phase arg(E)</button>
            </div>

            <!-- Action buttons -->
            <button class="icon-btn" id="btn-toggle-play" title="Play / Pause Animation" aria-label="Pause Animation">
              <svg id="icon-pause" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              <svg id="icon-play" class="hidden" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>

            <button class="icon-btn" id="btn-toggle-rays" title="Toggle Geometric Rays Overlay" aria-label="Toggle Rays">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/></svg>
            </button>

            <button class="icon-btn" id="btn-reset-cam" title="Reset 3D Camera" aria-label="Reset Camera">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
          </div>
        </header>

        <!-- Viewports Split Screen -->
        <div class="split-viewports">
          <!-- Left: 3D Nanostructure Lattice View -->
          <div class="viewport-card" id="lattice-card">
            <div class="viewport-header-badge">
              <span class="badge-label">3D Nanostructure Lattice</span>
              <span class="badge-info">32×32 array (p = 400 nm)</span>
            </div>
            <div class="canvas-wrapper" id="lattice-container">
              <canvas id="lattice-canvas"></canvas>
            </div>
          </div>

          <!-- Right: 2D Wavefield Cross-Section -->
          <div class="viewport-card" id="wavefield-card">
            <div class="viewport-header-badge">
              <span class="badge-label">Wavefield Cross-Section</span>
              <span class="badge-info">Huygens–Fresnel diffraction</span>
            </div>

            <!-- Physical Spatial Scale Ruler (Constant 10 µm) -->
            <div class="wavefield-scale-ruler" id="wavefield-scale-ruler" title="Constant spatial scale: 10 µm">
              <div class="scale-ruler-bar" id="scale-ruler-bar"></div>
              <span class="scale-ruler-label">10 µm</span>
            </div>

            <div class="canvas-wrapper" id="wavefield-container">
              <canvas id="wavefield-canvas"></canvas>
            </div>
          </div>

          <!-- Panel 3: Transverse XY Profile Slice View (or Inset PiP) -->
          <div class="viewport-card" id="xy-card">
            <div class="viewport-header-badge">
              <span class="badge-label">Transverse XY Profile</span>
              <span class="badge-info">Plane <span class="math-tex">z = </span><span id="xy-badge-z-val">25.0</span> µm</span>
            </div>

            <!-- XY Profile Floating Overlay Controls -->
            <div class="xy-profile-controls-overlay" id="xy-controls-overlay" role="region" aria-label="Transverse Slice Controls">
              <div class="xy-controls-row">
                <div class="xy-probe-scrub-group">
                  <label for="xy-probe-slider" class="xy-ctrl-label">Probe <span class="math-tex">z</span>:</label>
                  <input
                    type="range"
                    id="xy-probe-slider"
                    class="xy-probe-slider"
                    min="0"
                    max="60"
                    step="0.5"
                    value="25"
                    aria-label="Probe Z coordinate in micrometers"
                  />
                  <span class="xy-probe-val-text" id="xy-probe-val-display">25.0 µm</span>
                </div>

                <!-- View Mode Toggle: 3-Panel Split vs Picture-in-Picture Inset -->
                <button class="xy-mode-toggle-btn" id="btn-toggle-xy-mode" title="Toggle 3-Panel Split vs Inset Picture-in-Picture">
                  <svg class="icon-split-view" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                  <span id="xy-mode-btn-text">Inset</span>
                </button>
              </div>

              <!-- Quick snap buttons & Zoom level -->
              <div class="xy-quick-row">
                <div class="xy-snap-chips">
                  <button type="button" class="xy-snap-chip" data-snap-z="0" title="Snap to Metasurface Substrate (z = 0)">z = 0</button>
                  <button type="button" class="xy-snap-chip active" data-snap-z="focal" title="Snap to Focal Plane (z = f)">z = f</button>
                  <button type="button" class="xy-snap-chip" data-snap-z="50" title="Snap to Far Field (z = 50 µm)">z = 50µm</button>
                </div>
                <div class="xy-zoom-chips">
                  <span class="xy-zoom-label">Zoom:</span>
                  <button type="button" class="xy-zoom-chip active" data-xy-zoom="1">1×</button>
                  <button type="button" class="xy-zoom-chip" data-xy-zoom="2">2×</button>
                  <button type="button" class="xy-zoom-chip" data-xy-zoom="5">5×</button>
                </div>
              </div>
            </div>

            <!-- Physical Spatial Scale Ruler for Transverse XY Profile -->
            <div class="xy-scale-ruler" id="xy-scale-ruler" title="Transverse spatial scale">
              <div class="xy-scale-ruler-bar" id="xy-scale-ruler-bar"></div>
              <span class="xy-scale-ruler-label" id="xy-scale-ruler-label">10 µm</span>
            </div>

            <div class="canvas-wrapper" id="xy-container">
              <canvas id="xy-profile-canvas"></canvas>
            </div>
          </div>
          <!-- Panel 4: Far-field (Fourier transform of the aperture field) -->
          <div class="viewport-card" id="farfield-card">
            <div class="viewport-header-badge">
              <span class="badge-label">Far-Field (Fourier Transform)</span>
              <span class="badge-info" title="Fraunhofer far-field = 2D Fourier transform of the aperture field; sinθ = λ·f. Dashed circle: sinθ = 1 (propagating-wave limit).">|FT{E}|² vs. sin θ</span>
            </div>
            <div class="segmented-control farfield-scale-toggle" role="tablist" aria-label="Far-field intensity scale">
              <button class="seg-btn active" data-ff-scale="log" role="tab" aria-selected="true">Log</button>
              <button class="seg-btn" data-ff-scale="linear" role="tab" aria-selected="false">Linear</button>
            </div>
            <div class="segmented-control farfield-zoom-toggle" role="group" aria-label="Far-field angular range">
              <button class="seg-btn active" data-ff-zoom="1" title="Full range sin θ ∈ [-1, 1]">1×</button>
              <button class="seg-btn" data-ff-zoom="0.5" title="sin θ ∈ [-0.5, 0.5]">2×</button>
              <button class="seg-btn" data-ff-zoom="0.25" title="sin θ ∈ [-0.25, 0.25]">4×</button>
              <button class="seg-btn" data-ff-zoom="0.125" title="sin θ ∈ [-0.125, 0.125]">8×</button>
              <button class="seg-btn" data-ff-zoom="0.0625" title="sin θ ∈ [-0.0625, 0.0625]">16×</button>
            </div>
            <div class="canvas-wrapper" id="farfield-container">
              <canvas id="farfield-canvas"></canvas>
            </div>
          </div>

          <!-- Shared Intensity Max Display Slider (drives both XZ and XY views) -->
          <div class="wavefield-intensity-panel hidden" id="wavefield-intensity-panel" role="region" aria-label="Intensity Scale Controls (XZ and XY views)">
            <div class="intensity-panel-header">
              <span class="intensity-label">Max Display <span class="math-tex">|E|²</span> (XZ + XY):</span>
              <span class="intensity-value-display" id="intensity-max-display">4.61</span>
            </div>
            <div class="intensity-slider-row">
              <input
                type="range"
                id="slider-intensity-max"
                class="intensity-range-slider"
                min="0.23"
                max="9.45"
                step="0.092"
                value="4.61"
                aria-label="Adjust maximum displayed intensity for both views"
              />
            </div>
            <div class="slider-ticks" id="intensity-slider-ticks">
              <span id="intensity-tick-min">0.23</span>
              <span id="intensity-tick-mid" class="clickable-tick" title="Click to reset to nominal peak intensity">Peak: 4.61</span>
              <span id="intensity-tick-max">9.45</span>
            </div>
            <div class="intensity-scale-bar" title="Inferno colormap normalization [0, Max]">
              <span class="scale-min">0</span>
              <div class="inferno-gradient-bar"></div>
              <span class="scale-max" id="intensity-scale-max">4.61</span>
            </div>
          </div>
        </div>

        <!-- Demonstration Sliders & Interactive Parameters Bar -->
        <div class="viewport-controls-panel" id="viewport-controls-panel" role="region" aria-label="Demonstration Parameters">
          <div class="panel-header">
            <div class="panel-header-left">
              <span class="panel-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
                  <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
                  <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
                  <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
                </svg>
                Demonstration Controls
              </span>
              <span class="panel-mode-tag" id="demo-mode-tag">Metalens Parameters</span>
            </div>
            <div class="panel-header-right">
              <span class="panel-hint">Controls directly drive the 3D lattice, XZ cross-section &amp; transverse XY slice in real time</span>
            </div>
          </div>

          <!-- Multi-Gradient Superposition Combiner Bar -->
          <div class="multi-gradient-section" id="multi-gradient-section">
            <div class="multi-gradient-header">
              <div class="multi-gradient-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <circle cx="12" cy="12" r="9"/>
                  <line x1="12" y1="8" x2="12" y2="16"/>
                  <line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                Phase Gradient Superposition <span class="math-tex">(\Phi_{\text{total}} = \sum \Phi_i)</span>:
              </div>
              <div class="multi-gradient-hint">Combine independent phase functions into a multi-functional metasurface</div>
            </div>

            <!-- Active Gradient Toggle Chips -->
            <div class="gradient-toggles-bar" role="group" aria-label="Toggle Active Phase Gradients">
              <button type="button" class="gradient-toggle-btn active" data-gradient="lens">
                <span class="grad-check">✓</span> Lens Focus <span class="math-tex">(\Phi_{\text{lens}})</span>
              </button>
              <button type="button" class="gradient-toggle-btn" data-gradient="deflect">
                <span class="grad-check">+</span> Beam Deflection <span class="math-tex">(\Phi_{\text{deflect}})</span>
              </button>
              <button type="button" class="gradient-toggle-btn" data-gradient="vortex">
                <span class="grad-check">+</span> Optical Vortex <span class="math-tex">(\Phi_{\text{vortex}})</span>
              </button>
              <button type="button" class="gradient-toggle-btn" data-gradient="hologram">
                <span class="grad-check">+</span> CGH Hologram <span class="math-tex">(\Phi_{\text{holo}})</span>
              </button>
            </div>

            <!-- Instant Preset Combination Chips -->
            <div class="gradient-presets-bar">
              <span class="presets-label">Demonstration Presets:</span>
              <button type="button" class="gradient-preset-chip active" data-preset="single-lens">Metalens</button>
              <button type="button" class="gradient-preset-chip" data-preset="single-deflect">Deflector</button>
              <button type="button" class="gradient-preset-chip" data-preset="single-vortex">Vortex Singlet</button>
              <button type="button" class="gradient-preset-chip" data-preset="offaxis-lens">Off-Axis Metalens (Lens + Deflect)</button>
              <button type="button" class="gradient-preset-chip" data-preset="focused-vortex">Focused Vortex (Lens + OAM)</button>
              <button type="button" class="gradient-preset-chip" data-preset="steered-vortex">Steered Vortex (Deflect + OAM)</button>
              <button type="button" class="gradient-preset-chip" data-preset="offaxis-vortex">Off-Axis Vortex (Lens + Deflect + OAM)</button>
            </div>
          </div>

          <!-- 1. Metalens Mode Controls -->
          <div class="demo-mode-panel" id="demo-controls-metalens">
            <div class="demo-controls-grid">
              <!-- Focal Length Slider -->
              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <label for="demo-slider-focal" class="demo-label">
                    <span>Focal Length (<span class="math-tex">f</span>):</span>
                  </label>
                  <span id="demo-label-focal" class="demo-val">25.0 µm</span>
                </div>
                <input
                  type="range"
                  id="demo-slider-focal"
                  class="demo-slider-input"
                  min="10"
                  max="45"
                  step="0.5"
                  value="25"
                  aria-label="Demonstration Focal Length"
                />
                <div class="demo-presets-row">
                  <button type="button" class="demo-chip" data-demo-focal="15">Short (15 µm)</button>
                  <button type="button" class="demo-chip active" data-demo-focal="25">Nominal (25 µm)</button>
                  <button type="button" class="demo-chip" data-demo-focal="38">Long (38 µm)</button>
                </div>
              </div>

              <!-- Aperture Diameter Slider -->
              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <label for="demo-slider-diameter" class="demo-label">
                    <span>Aperture Diameter (<span class="math-tex">D</span>):</span>
                  </label>
                  <span id="demo-label-diameter" class="demo-val">30.0 µm</span>
                </div>
                <input
                  type="range"
                  id="demo-slider-diameter"
                  class="demo-slider-input"
                  min="15"
                  max="45"
                  step="1"
                  value="30"
                  aria-label="Demonstration Aperture Diameter"
                />
                <div class="demo-presets-row">
                  <button type="button" class="demo-chip" data-demo-diam="20">D = 20 µm</button>
                  <button type="button" class="demo-chip active" data-demo-diam="30">D = 30 µm</button>
                  <button type="button" class="demo-chip" data-demo-diam="40">D = 40 µm</button>
                </div>
              </div>

              <!-- Wavelength Slider -->
              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <label for="demo-slider-wavelength" class="demo-label">
                    <span>Wavelength (<span class="math-tex">\lambda</span>):</span>
                  </label>
                  <span id="demo-label-wavelength" class="demo-val">532 nm</span>
                </div>
                <input
                  type="range"
                  id="demo-slider-wavelength"
                  class="demo-slider-input"
                  min="400"
                  max="1550"
                  step="10"
                  value="532"
                  aria-label="Demonstration Wavelength"
                />
                <div class="demo-presets-row">
                  <button type="button" class="demo-chip chip-wl-blue" data-demo-wl="400">400nm (Blue)</button>
                  <button type="button" class="demo-chip chip-wl-green active" data-demo-wl="532">532nm (Green)</button>
                  <button type="button" class="demo-chip chip-wl-red" data-demo-wl="650">650nm (Red)</button>
                  <button type="button" class="demo-chip chip-wl-nir" data-demo-wl="1550">1550nm (NIR)</button>
                </div>
              </div>

              <!-- Material Selector -->
              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <span class="demo-label">Dielectric Material:</span>
                  <span id="demo-label-material" class="demo-val">TiO₂</span>
                </div>
                <div class="demo-btn-group" id="demo-material-picker">
                  <button type="button" class="demo-toggle-btn active" data-demo-mat="TiO2">TiO₂ (Visible)</button>
                  <button type="button" class="demo-toggle-btn" data-demo-mat="Si">Silicon (Si - NIR)</button>
                </div>
                <div class="demo-helper-note">
                  Refractive index <span class="math-tex">n \approx 2.4</span> for TiO₂, <span class="math-tex">n \approx 3.48</span> for Si
                </div>
              </div>
            </div>
          </div>

          <!-- 2. Deflector Mode Controls -->
          <div class="demo-mode-panel hidden" id="demo-controls-deflector">
            <div class="demo-controls-grid">
              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <label for="demo-slider-deflection" class="demo-label">
                    <span>Deflection Angle (<span class="math-tex">\theta</span>):</span>
                  </label>
                  <span id="demo-label-deflection" class="demo-val">+20.0°</span>
                </div>
                <input
                  type="range"
                  id="demo-slider-deflection"
                  class="demo-slider-input"
                  min="-60"
                  max="60"
                  step="1"
                  value="20"
                  aria-label="Demonstration Deflection Angle"
                />
                <div class="demo-presets-row">
                  <button type="button" class="demo-chip" data-demo-deg="-30">-30°</button>
                  <button type="button" class="demo-chip" data-demo-deg="0">0°</button>
                  <button type="button" class="demo-chip active" data-demo-deg="20">+20°</button>
                  <button type="button" class="demo-chip" data-demo-deg="45">+45°</button>
                </div>
              </div>

              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <label for="demo-slider-period" class="demo-label">
                    <span>Phase Gradient Period (<span class="math-tex">\Gamma</span>):</span>
                  </label>
                  <span id="demo-label-period" class="demo-val">1.56 µm</span>
                </div>
                <input
                  type="range"
                  id="demo-slider-period"
                  class="demo-slider-input"
                  min="0.6"
                  max="3.5"
                  step="0.05"
                  value="1.56"
                  aria-label="Demonstration Phase Gradient Period"
                />
                <div class="demo-helper-note">
                  <span class="math-tex">\Gamma = \lambda / \sin\theta</span>
                </div>
              </div>

              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <label for="demo-slider-deflect-wl" class="demo-label">
                    <span>Wavelength (<span class="math-tex">\lambda</span>):</span>
                  </label>
                  <span id="demo-label-deflect-wl" class="demo-val">532 nm</span>
                </div>
                <input
                  type="range"
                  id="demo-slider-deflect-wl"
                  class="demo-slider-input"
                  min="400"
                  max="1550"
                  step="10"
                  value="532"
                  aria-label="Demonstration Deflector Wavelength"
                />
                <div class="demo-presets-row">
                  <button type="button" class="demo-chip chip-wl-blue" data-demo-wl="400">400nm</button>
                  <button type="button" class="demo-chip chip-wl-green active" data-demo-wl="532">532nm</button>
                  <button type="button" class="demo-chip chip-wl-red" data-demo-wl="650">650nm</button>
                  <button type="button" class="demo-chip chip-wl-nir" data-demo-wl="1550">1550nm</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Vortex Mode Controls -->
          <div class="demo-mode-panel hidden" id="demo-controls-vortex">
            <div class="demo-controls-grid">
              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <span class="demo-label">Topological Charge (<span class="math-tex">\ell</span>):</span>
                  <span id="demo-label-charge" class="demo-val">ℓ = +1</span>
                </div>
                <div class="demo-btn-group" id="demo-charge-selector">
                  <button type="button" class="demo-toggle-btn" data-demo-charge="-2">ℓ = -2</button>
                  <button type="button" class="demo-toggle-btn" data-demo-charge="-1">ℓ = -1</button>
                  <button type="button" class="demo-toggle-btn active" data-demo-charge="1">ℓ = +1</button>
                  <button type="button" class="demo-toggle-btn" data-demo-charge="2">ℓ = +2</button>
                </div>
                <div class="demo-helper-note">
                  OAM carried = <span class="math-tex">\ell \hbar</span> per photon
                </div>
              </div>

              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <label for="demo-slider-vortex-diam" class="demo-label">
                    <span>Aperture Diameter (<span class="math-tex">D</span>):</span>
                  </label>
                  <span id="demo-label-vortex-diam" class="demo-val">30.0 µm</span>
                </div>
                <input
                  type="range"
                  id="demo-slider-vortex-diam"
                  class="demo-slider-input"
                  min="15"
                  max="45"
                  step="1"
                  value="30"
                  aria-label="Demonstration Vortex Diameter"
                />
              </div>

              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <label for="demo-slider-vortex-wl" class="demo-label">
                    <span>Wavelength (<span class="math-tex">\lambda</span>):</span>
                  </label>
                  <span id="demo-label-vortex-wl" class="demo-val">532 nm</span>
                </div>
                <input
                  type="range"
                  id="demo-slider-vortex-wl"
                  class="demo-slider-input"
                  min="400"
                  max="1550"
                  step="10"
                  value="532"
                  aria-label="Demonstration Vortex Wavelength"
                />
              </div>
            </div>
          </div>

          <!-- 4. Hologram Mode Controls -->
          <div class="demo-mode-panel hidden" id="demo-controls-hologram">
            <div class="demo-controls-grid">
              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <span class="demo-label">Hologram Target Pattern:</span>
                  <span id="demo-label-holo-target" class="demo-val">Optics Crest</span>
                </div>
                <div class="demo-btn-group" id="demo-hologram-targets">
                  <button type="button" class="demo-toggle-btn active" data-demo-cgh="crest">Optics Crest</button>
                  <button type="button" class="demo-toggle-btn" data-demo-cgh="smiley">Diffraction Smiley</button>
                  <button type="button" class="demo-toggle-btn" data-demo-cgh="mu">Micro-Mu (µ)</button>
                </div>
              </div>

              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <label for="demo-slider-holo-diam" class="demo-label">
                    <span>Aperture Diameter (<span class="math-tex">D</span>):</span>
                  </label>
                  <span id="demo-label-holo-diam" class="demo-val">30.0 µm</span>
                </div>
                <input
                  type="range"
                  id="demo-slider-holo-diam"
                  class="demo-slider-input"
                  min="15"
                  max="45"
                  step="1"
                  value="30"
                  aria-label="Demonstration Hologram Diameter"
                />
              </div>

              <div class="demo-control-group">
                <div class="demo-control-label-row">
                  <label for="demo-slider-holo-wl" class="demo-label">
                    <span>Wavelength (<span class="math-tex">\lambda</span>):</span>
                  </label>
                  <span id="demo-label-holo-wl" class="demo-val">532 nm</span>
                </div>
                <input
                  type="range"
                  id="demo-slider-holo-wl"
                  class="demo-slider-input"
                  min="400"
                  max="1550"
                  step="10"
                  value="532"
                  aria-label="Demonstration Hologram Wavelength"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- HUD Performance Dashboard -->
        <div id="hud-root"></div>
      </div>
    `;
  }

  private render(): void {
    this.container.innerHTML = DualViewport.getTemplate();
  }

  private initComponents(): void {
    const wavefieldCanvas = this.container.querySelector<HTMLCanvasElement>('#wavefield-canvas');
    if (wavefieldCanvas) {
      this.wavefieldRenderer = new WavefieldRenderer(wavefieldCanvas);
      this.wavefieldRenderer.start();
    }

    const xyCanvas = this.container.querySelector<HTMLCanvasElement>('#xy-profile-canvas');
    if (xyCanvas) {
      this.xyRenderer = new XYProfileRenderer(xyCanvas);
      this.xyRenderer.start();
    }

    const farCanvas = this.container.querySelector<HTMLCanvasElement>('#farfield-canvas');
    if (farCanvas) {
      this.farFieldRenderer = new FarFieldRenderer(farCanvas);
      this.farFieldRenderer.update();
      const zoomBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-ff-zoom]');
      zoomBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.farFieldRenderer?.setSinMax(parseFloat(btn.dataset.ffZoom || '1'));
          zoomBtns.forEach((b) => b.classList.toggle('active', b === btn));
        });
      });
      const ffBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-ff-scale]');
      ffBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.farFieldRenderer?.setLogScale(btn.dataset.ffScale === 'log');
          ffBtns.forEach((b) => {
            const on = b === btn;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
          });
        });
      });
    }

    const latticeContainer = this.container.querySelector<HTMLElement>('#lattice-container');
    const latticeCanvas = this.container.querySelector<HTMLCanvasElement>('#lattice-canvas');
    if (latticeContainer && latticeCanvas) {
      this.latticeViewer = new NanostructureLatticeViewer(latticeContainer, latticeCanvas);
    }

    const hudRoot = this.container.querySelector<HTMLElement>('#hud-root');
    if (hudRoot) {
      this.hud = new PerformanceHUD(hudRoot);
    }

    // Handle window resize
    window.addEventListener('resize', this.handleResize);

    // Initial resize trigger
    setTimeout(() => {
      this.handleResize();
    }, 100);
  }

  private handleResize = (): void => {
    if (this.wavefieldRenderer) this.wavefieldRenderer.resize();
    if (this.xyRenderer) this.xyRenderer.resize();
    if (this.farFieldRenderer) this.farFieldRenderer.resize();
    if (this.latticeViewer) this.latticeViewer.resize();
    this.updateScaleRuler();
    this.updateXyScaleRuler();
  };

  private updateScaleRuler = (): void => {
    const wavefieldCanvas = this.container.querySelector<HTMLCanvasElement>('#wavefield-canvas');
    const rulerBar = this.container.querySelector<HTMLElement>('#scale-ruler-bar');
    if (!wavefieldCanvas || !rulerBar) return;
    const w = wavefieldCanvas.clientWidth;
    const h = wavefieldCanvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    const aspect = w / Math.max(1, h);
    const xMax = Math.max(30.0, 30.0 * aspect);
    // 10 um in pixels: w * (10.0 / (2.0 * xMax))
    const rulerPx = Math.round(w * (10.0 / (2.0 * xMax)));
    rulerBar.style.width = `${rulerPx}px`;
  };

  private updateXyScaleRuler = (): void => {
    const xyCanvas = this.container.querySelector<HTMLCanvasElement>('#xy-profile-canvas');
    const rulerBar = this.container.querySelector<HTMLElement>('#xy-scale-ruler-bar');
    const rulerLabel = this.container.querySelector<HTMLElement>('#xy-scale-ruler-label');
    if (!xyCanvas || !rulerBar || !rulerLabel) return;
    const w = xyCanvas.clientWidth;
    if (w <= 0) return;
    const zoom = opticsStore.getState().xyZoom || 1.0;
    const halfSpan = 25.0 / zoom;
    const totalSpanUm = 2.0 * halfSpan;
    const scaleUm = zoom >= 5.0 ? 2.0 : (zoom >= 2.0 ? 5.0 : 10.0);
    const rulerPx = Math.round(w * (scaleUm / totalSpanUm));
    rulerBar.style.width = `${rulerPx}px`;
    rulerLabel.textContent = `${scaleUm} µm`;
  };

  private attachEventListeners(): void {
    // Device buttons
    const deviceBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-device]');
    deviceBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const dev = btn.dataset.device as DeviceType;
        opticsStore.getState().setDeviceType(dev);
        deviceBtns.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      });
    });

    // Render mode buttons
    const renderBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-render]');
    renderBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.render as RenderMode;
        opticsStore.getState().setRenderMode(mode);
        renderBtns.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      });
    });

    // Play/Pause button
    const playBtn = this.container.querySelector<HTMLButtonElement>('#btn-toggle-play');
    const iconPause = this.container.querySelector('#icon-pause');
    const iconPlay = this.container.querySelector('#icon-play');

    playBtn?.addEventListener('click', () => {
      const state = opticsStore.getState();
      const nextPlay = !state.isPlaying;
      state.setIsPlaying(nextPlay);
      if (nextPlay) {
        iconPause?.classList.remove('hidden');
        iconPlay?.classList.add('hidden');
        playBtn.setAttribute('aria-label', 'Pause Animation');
      } else {
        iconPause?.classList.add('hidden');
        iconPlay?.classList.remove('hidden');
        playBtn.setAttribute('aria-label', 'Play Animation');
      }
    });

    // Toggle rays button
    const raysBtn = this.container.querySelector<HTMLButtonElement>('#btn-toggle-rays');
    raysBtn?.addEventListener('click', () => {
      if (this.wavefieldRenderer) {
        const active = this.wavefieldRenderer.toggleRays();
        raysBtn.classList.toggle('active', active);
      }
    });

    // Reset camera button
    const resetCamBtn = this.container.querySelector<HTMLButtonElement>('#btn-reset-cam');
    resetCamBtn?.addEventListener('click', () => {
      this.latticeViewer?.resetCamera();
    });

    // --- Multi-Gradient Superposition Listeners ---
    const gradientBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-gradient]');
    gradientBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const grad = btn.dataset.gradient as keyof ActiveGradients;
        if (grad) {
          opticsStore.getState().toggleGradient(grad);
        }
      });
    });

    const presetChips = this.container.querySelectorAll<HTMLButtonElement>('[data-preset]');
    presetChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const preset = chip.dataset.preset;
        if (preset === 'single-lens') {
          opticsStore.getState().setActiveGradients({ lens: true, deflect: false, vortex: false, hologram: false });
        } else if (preset === 'single-deflect') {
          opticsStore.getState().setActiveGradients({ lens: false, deflect: true, vortex: false, hologram: false });
        } else if (preset === 'single-vortex') {
          opticsStore.getState().setActiveGradients({ lens: false, deflect: false, vortex: true, hologram: false });
        } else if (preset === 'single-hologram') {
          opticsStore.getState().setActiveGradients({ lens: false, deflect: false, vortex: false, hologram: true });
        } else if (preset === 'offaxis-lens') {
          opticsStore.getState().setActiveGradients({ lens: true, deflect: true, vortex: false, hologram: false });
        } else if (preset === 'focused-vortex') {
          opticsStore.getState().setActiveGradients({ lens: true, deflect: false, vortex: true, hologram: false });
        } else if (preset === 'steered-vortex') {
          opticsStore.getState().setActiveGradients({ lens: false, deflect: true, vortex: true, hologram: false });
        } else if (preset === 'offaxis-vortex') {
          opticsStore.getState().setActiveGradients({ lens: true, deflect: true, vortex: true, hologram: false });
        }
      });
    });

    // --- Transverse XY Profile Slice View Listeners ---
    const xyProbeSlider = this.container.querySelector<HTMLInputElement>('#xy-probe-slider');
    const xyProbeValDisplay = this.container.querySelector<HTMLElement>('#xy-probe-val-display');
    const xyBadgeZVal = this.container.querySelector<HTMLElement>('#xy-badge-z-val');

    xyProbeSlider?.addEventListener('input', () => {
      const z = parseFloat(xyProbeSlider.value);
      if (!isNaN(z)) {
        opticsStore.getState().setProbeZ(z);
      }
    });

    const snapChips = this.container.querySelectorAll<HTMLButtonElement>('[data-snap-z]');
    snapChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const target = chip.dataset.snapZ;
        if (target === '0') {
          opticsStore.getState().setProbeZ(0.0);
        } else if (target === 'focal') {
          opticsStore.getState().setProbeZ(opticsStore.getState().focalLength);
        } else if (target === '50') {
          opticsStore.getState().setProbeZ(50.0);
        }
      });
    });

    const zoomChips = this.container.querySelectorAll<HTMLButtonElement>('[data-xy-zoom]');
    zoomChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const zoom = parseFloat(chip.dataset.xyZoom || '1');
        opticsStore.getState().setXyZoom(zoom);
        this.updateXyScaleRuler();
      });
    });

    const toggleXyModeBtn = this.container.querySelector<HTMLButtonElement>('#btn-toggle-xy-mode');
    const xyCard = this.container.querySelector<HTMLElement>('#xy-card');
    const splitViewports = this.container.querySelector<HTMLElement>('.split-viewports');
    const xyModeBtnText = this.container.querySelector<HTMLElement>('#xy-mode-btn-text');

    toggleXyModeBtn?.addEventListener('click', () => {
      const currentMode = opticsStore.getState().xyViewMode || 'panel';
      const nextMode = currentMode === 'panel' ? 'inset' : 'panel';
      opticsStore.getState().setXyViewMode(nextMode);
    });

    // --- Demonstration Controls Panel Listeners ---
    // Metalens controls
    const demoFocalSlider = this.container.querySelector<HTMLInputElement>('#demo-slider-focal');
    const demoDiamSlider = this.container.querySelector<HTMLInputElement>('#demo-slider-diameter');
    const demoWlSlider = this.container.querySelector<HTMLInputElement>('#demo-slider-wavelength');
    const demoMatBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-demo-mat]');
    const demoFocalChips = this.container.querySelectorAll<HTMLButtonElement>('[data-demo-focal]');
    const demoDiamChips = this.container.querySelectorAll<HTMLButtonElement>('[data-demo-diam]');
    const demoWlChips = this.container.querySelectorAll<HTMLButtonElement>('[data-demo-wl]');

    demoFocalSlider?.addEventListener('input', () => {
      const f = parseFloat(demoFocalSlider.value);
      if (!isNaN(f)) {
        opticsStore.getState().setFocalLength(f);
      }
    });

    demoDiamSlider?.addEventListener('input', () => {
      const d = parseFloat(demoDiamSlider.value);
      if (!isNaN(d)) {
        opticsStore.getState().setDiameter(d);
      }
    });

    demoWlSlider?.addEventListener('input', () => {
      const nm = parseFloat(demoWlSlider.value);
      if (!isNaN(nm)) {
        opticsStore.getState().setWavelength(nm / 1000.0);
      }
    });

    demoFocalChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const val = parseFloat(chip.dataset.demoFocal || '25');
        opticsStore.getState().setFocalLength(val);
      });
    });

    demoDiamChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const val = parseFloat(chip.dataset.demoDiam || '30');
        opticsStore.getState().setDiameter(val);
      });
    });

    demoWlChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const val = parseFloat(chip.dataset.demoWl || '532');
        opticsStore.getState().setWavelength(val / 1000.0);
      });
    });

    demoMatBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mat = btn.dataset.demoMat as MaterialType;
        if (mat) {
          opticsStore.getState().setMaterial(mat);
        }
      });
    });

    // Deflector controls
    const demoDeflectSlider = this.container.querySelector<HTMLInputElement>('#demo-slider-deflection');
    const demoPeriodSlider = this.container.querySelector<HTMLInputElement>('#demo-slider-period');
    const demoDeflectWlSlider = this.container.querySelector<HTMLInputElement>('#demo-slider-deflect-wl');
    const demoDegChips = this.container.querySelectorAll<HTMLButtonElement>('[data-demo-deg]');

    demoDeflectSlider?.addEventListener('input', () => {
      const deg = parseFloat(demoDeflectSlider.value);
      if (!isNaN(deg)) {
        const rad = (deg * Math.PI) / 180.0;
        opticsStore.getState().setDeflectionAngle(rad);

        // Sync period slider
        const lambda = opticsStore.getState().wavelength;
        const sinTheta = Math.abs(Math.sin(rad));
        if (sinTheta > 0.01 && demoPeriodSlider) {
          const periodUm = Math.min(3.5, Math.max(0.6, lambda / sinTheta));
          demoPeriodSlider.value = periodUm.toFixed(2);
          const labelPeriod = this.container.querySelector('#demo-label-period');
          if (labelPeriod) labelPeriod.textContent = `${periodUm.toFixed(2)} µm`;
        }
      }
    });

    demoPeriodSlider?.addEventListener('input', () => {
      const periodUm = parseFloat(demoPeriodSlider.value);
      if (!isNaN(periodUm)) {
        const lambda = opticsStore.getState().wavelength;
        const thetaRad = calculateDeflectionAngle(lambda, (2 * Math.PI) / periodUm);
        if (!Number.isNaN(thetaRad)) {
          opticsStore.getState().setDeflectionAngle(thetaRad);
          if (demoDeflectSlider) {
            demoDeflectSlider.value = ((thetaRad * 180) / Math.PI).toFixed(1);
          }
        }
      }
    });

    demoDeflectWlSlider?.addEventListener('input', () => {
      const nm = parseFloat(demoDeflectWlSlider.value);
      if (!isNaN(nm)) {
        opticsStore.getState().setWavelength(nm / 1000.0);
      }
    });

    demoDegChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const deg = parseFloat(chip.dataset.demoDeg || '20');
        const rad = (deg * Math.PI) / 180.0;
        opticsStore.getState().setDeflectionAngle(rad);
      });
    });

    // Vortex controls
    const demoChargeBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-demo-charge]');
    const demoVortexDiamSlider = this.container.querySelector<HTMLInputElement>('#demo-slider-vortex-diam');
    const demoVortexWlSlider = this.container.querySelector<HTMLInputElement>('#demo-slider-vortex-wl');

    demoChargeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const charge = parseInt(btn.dataset.demoCharge || '1', 10);
        opticsStore.getState().setTopologicalCharge(charge);
      });
    });

    demoVortexDiamSlider?.addEventListener('input', () => {
      const d = parseFloat(demoVortexDiamSlider.value);
      if (!isNaN(d)) opticsStore.getState().setDiameter(d);
    });

    demoVortexWlSlider?.addEventListener('input', () => {
      const nm = parseFloat(demoVortexWlSlider.value);
      if (!isNaN(nm)) opticsStore.getState().setWavelength(nm / 1000.0);
    });

    // Hologram controls
    const demoCghBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-demo-cgh]');
    const demoHoloDiamSlider = this.container.querySelector<HTMLInputElement>('#demo-slider-holo-diam');
    const demoHoloWlSlider = this.container.querySelector<HTMLInputElement>('#demo-slider-holo-wl');

    demoCghBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.demoCgh as 'crest' | 'smiley' | 'mu';
        if (target) opticsStore.getState().setHologramTarget(target);
      });
    });

    demoHoloDiamSlider?.addEventListener('input', () => {
      const d = parseFloat(demoHoloDiamSlider.value);
      if (!isNaN(d)) opticsStore.getState().setDiameter(d);
    });

    demoHoloWlSlider?.addEventListener('input', () => {
      const nm = parseFloat(demoHoloWlSlider.value);
      if (!isNaN(nm)) opticsStore.getState().setWavelength(nm / 1000.0);
    });

    // Intensity modality max value slider controls
    const intensityPanel = this.container.querySelector<HTMLElement>('#wavefield-intensity-panel');
    const intensitySlider = this.container.querySelector<HTMLInputElement>('#slider-intensity-max');
    const intensityDisplay = this.container.querySelector<HTMLElement>('#intensity-max-display');
    const scaleMaxDisplay = this.container.querySelector<HTMLElement>('#intensity-scale-max');
    const tickMin = this.container.querySelector<HTMLElement>('#intensity-tick-min');
    const tickMid = this.container.querySelector<HTMLElement>('#intensity-tick-mid');
    const tickMax = this.container.querySelector<HTMLElement>('#intensity-tick-max');

    let currentScale: IntensityScaleRange = getDemonstrationIntensityScale(opticsStore.getState());
    let relativePosition = 0.475; // ~50% default on slider, corresponding to nominal peak
    let lastDemonstrationKey = '';
    let lastDeviceType = opticsStore.getState().deviceType;

    const applyScaleRange = (scale: IntensityScaleRange, preserveRelative: boolean = true) => {
      currentScale = scale;
      if (!intensitySlider) return;

      intensitySlider.min = scale.min.toString();
      intensitySlider.max = scale.max.toString();
      intensitySlider.step = scale.step.toString();

      let targetVal: number;
      if (preserveRelative) {
        targetVal = scale.min + relativePosition * (scale.max - scale.min);
      } else {
        targetVal = scale.nominalPeak;
        relativePosition = Math.max(0, Math.min(1, (targetVal - scale.min) / (scale.max - scale.min)));
      }

      intensitySlider.value = targetVal.toString();
      opticsStore.getState().setIntensityMax(targetVal);

      const formatted = formatIntensityValue(targetVal);
      if (intensityDisplay) intensityDisplay.textContent = formatted;
      if (scaleMaxDisplay) scaleMaxDisplay.textContent = formatted;

      if (tickMin) tickMin.textContent = formatIntensityValue(scale.min);
      if (tickMid) tickMid.textContent = `Peak: ${formatIntensityValue(scale.nominalPeak)}`;
      if (tickMax) tickMax.textContent = formatIntensityValue(scale.max);
    };

    // Initial state setup for intensity panel
    const initialStore = opticsStore.getState();
    lastDemonstrationKey = `${initialStore.deviceType}_${initialStore.wavelength}_${initialStore.designWavelength}_${initialStore.focalLength}_${initialStore.diameter}_${initialStore.deflectionAngle}_${initialStore.topologicalCharge}_${Boolean(initialStore.cghPhaseMask)}`;
    applyScaleRange(currentScale, false);
    intensityPanel?.classList.toggle('hidden', initialStore.renderMode !== 'intensity');

    intensitySlider?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const val = parseFloat(target.value);
      if (!isNaN(val)) {
        if (currentScale.max > currentScale.min) {
          relativePosition = Math.max(0, Math.min(1, (val - currentScale.min) / (currentScale.max - currentScale.min)));
        }
        opticsStore.getState().setIntensityMax(val);
        const formatted = formatIntensityValue(val);
        if (intensityDisplay) intensityDisplay.textContent = formatted;
        if (scaleMaxDisplay) scaleMaxDisplay.textContent = formatted;
        this.wavefieldRenderer?.render();
      }
    });

    tickMid?.addEventListener('click', () => {
      if (currentScale && intensitySlider) {
        relativePosition = (currentScale.nominalPeak - currentScale.min) / (currentScale.max - currentScale.min);
        intensitySlider.value = currentScale.nominalPeak.toString();
        opticsStore.getState().setIntensityMax(currentScale.nominalPeak);
        const formatted = formatIntensityValue(currentScale.nominalPeak);
        if (intensityDisplay) intensityDisplay.textContent = formatted;
        if (scaleMaxDisplay) scaleMaxDisplay.textContent = formatted;
        this.wavefieldRenderer?.render();
      }
    });

    // Sync button active classes if store changed externally
    this.unsubscribe = opticsStore.subscribe((state) => {
      deviceBtns.forEach((b) => {
        const isMatch = b.dataset.device === state.deviceType;
        b.classList.toggle('active', isMatch);
        b.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
      renderBtns.forEach((b) => {
        const isMatch = b.dataset.render === state.renderMode;
        b.classList.toggle('active', isMatch);
        b.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });

      // Update visibility of the intensity slider when renderMode changes
      const isIntensity = state.renderMode === 'intensity';
      intensityPanel?.classList.toggle('hidden', !isIntensity);

      // Active gradients resolution
      const ag = state.activeGradients || {
        lens: state.deviceType === 'metalens',
        deflect: state.deviceType === 'deflector',
        vortex: state.deviceType === 'vortex',
        hologram: state.deviceType === 'hologram',
      };

      // Sync active gradient buttons
      gradientBtns.forEach((btn) => {
        const grad = btn.dataset.gradient as keyof ActiveGradients;
        const isActive = Boolean(ag[grad]);
        btn.classList.toggle('active', isActive);
        const check = btn.querySelector('.grad-check');
        if (check) check.textContent = isActive ? '✓' : '+';
      });

      // Sync preset chips
      presetChips.forEach((chip) => {
        const preset = chip.dataset.preset;
        const isMatch =
          (preset === 'single-lens' && ag.lens && !ag.deflect && !ag.vortex && !ag.hologram) ||
          (preset === 'single-deflect' && !ag.lens && ag.deflect && !ag.vortex && !ag.hologram) ||
          (preset === 'single-vortex' && !ag.lens && !ag.deflect && ag.vortex && !ag.hologram) ||
          (preset === 'single-hologram' && !ag.lens && !ag.deflect && !ag.vortex && ag.hologram) ||
          (preset === 'offaxis-lens' && ag.lens && ag.deflect && !ag.vortex && !ag.hologram) ||
          (preset === 'focused-vortex' && ag.lens && !ag.deflect && ag.vortex && !ag.hologram) ||
          (preset === 'steered-vortex' && !ag.lens && ag.deflect && ag.vortex && !ag.hologram) ||
          (preset === 'offaxis-vortex' && ag.lens && ag.deflect && ag.vortex && !ag.hologram);
        chip.classList.toggle('active', Boolean(isMatch));
      });

      // Update demonstration mode panels visibility based on active gradients
      const modePanels = {
        metalens: this.container.querySelector('#demo-controls-metalens'),
        deflector: this.container.querySelector('#demo-controls-deflector'),
        vortex: this.container.querySelector('#demo-controls-vortex'),
        hologram: this.container.querySelector('#demo-controls-hologram'),
      };
      modePanels.metalens?.classList.toggle('hidden', !ag.lens && state.deviceType !== 'metalens');
      modePanels.deflector?.classList.toggle('hidden', !ag.deflect && state.deviceType !== 'deflector');
      modePanels.vortex?.classList.toggle('hidden', !ag.vortex && state.deviceType !== 'vortex');
      modePanels.hologram?.classList.toggle('hidden', !ag.hologram && state.deviceType !== 'hologram');

      const modeTag = this.container.querySelector('#demo-mode-tag');
      if (modeTag) {
        const modeLabels: Record<DeviceType, string> = {
          metalens: 'Metalens Parameters',
          deflector: 'Beam Deflector Parameters',
          vortex: 'Optical Vortex Parameters',
          hologram: 'Hologram Parameters',
        };
        const activeNames: string[] = [];
        if (ag.lens) activeNames.push('Lens');
        if (ag.deflect) activeNames.push('Deflector');
        if (ag.vortex) activeNames.push('Vortex');
        if (ag.hologram) activeNames.push('Hologram');

        modeTag.textContent = activeNames.length > 1
          ? `Superposition: ${activeNames.join(' + ')}`
          : (modeLabels[state.deviceType] || 'Demonstration Parameters');
      }

      // Sync Transverse XY Profile controls
      const pZ = state.probeZ ?? 25.0;
      if (xyProbeSlider && document.activeElement !== xyProbeSlider) {
        xyProbeSlider.value = pZ.toFixed(1);
      }
      if (xyProbeValDisplay) xyProbeValDisplay.textContent = `${pZ.toFixed(1)} µm`;
      if (xyBadgeZVal) xyBadgeZVal.textContent = pZ.toFixed(1);

      snapChips.forEach((chip) => {
        const target = chip.dataset.snapZ;
        let isSnapActive = false;
        if (target === '0') isSnapActive = Math.abs(pZ - 0.0) < 0.25;
        else if (target === 'focal') isSnapActive = Math.abs(pZ - state.focalLength) < 0.25;
        else if (target === '50') isSnapActive = Math.abs(pZ - 50.0) < 0.25;
        chip.classList.toggle('active', isSnapActive);
      });

      zoomChips.forEach((chip) => {
        const zoom = parseFloat(chip.dataset.xyZoom || '1');
        chip.classList.toggle('active', Math.abs((state.xyZoom || 1.0) - zoom) < 0.05);
      });

      const isInset = state.xyViewMode === 'inset';
      xyCard?.classList.toggle('xy-inset-mode', isInset);
      splitViewports?.classList.toggle('inset-active', isInset);
      if (xyModeBtnText) xyModeBtnText.textContent = isInset ? '3-Panel' : 'Inset';
      this.updateXyScaleRuler();

      // Sync Metalens controls
      const labelDemoFocal = this.container.querySelector('#demo-label-focal');
      if (labelDemoFocal) labelDemoFocal.textContent = `${state.focalLength.toFixed(1)} µm`;
      if (demoFocalSlider && document.activeElement !== demoFocalSlider) {
        demoFocalSlider.value = state.focalLength.toString();
      }

      const labelDemoDiam = this.container.querySelector('#demo-label-diameter');
      if (labelDemoDiam) labelDemoDiam.textContent = `${state.diameter.toFixed(1)} µm`;
      if (demoDiamSlider && document.activeElement !== demoDiamSlider) {
        demoDiamSlider.value = state.diameter.toString();
      }

      const wlNm = state.wavelength * 1000;
      const labelDemoWl = this.container.querySelector('#demo-label-wavelength');
      if (labelDemoWl) labelDemoWl.textContent = `${wlNm.toFixed(0)} nm`;
      if (demoWlSlider && document.activeElement !== demoWlSlider) {
        demoWlSlider.value = wlNm.toString();
      }

      const labelDemoMat = this.container.querySelector('#demo-label-material');
      if (labelDemoMat) labelDemoMat.textContent = state.material === 'Si' ? 'Silicon (Si)' : 'TiO₂';
      demoMatBtns.forEach((b) => b.classList.toggle('active', b.dataset.demoMat === state.material));

      demoFocalChips.forEach((chip) => {
        const val = parseFloat(chip.dataset.demoFocal || '0');
        chip.classList.toggle('active', Math.abs(state.focalLength - val) < 0.2);
      });

      demoDiamChips.forEach((chip) => {
        const val = parseFloat(chip.dataset.demoDiam || '0');
        chip.classList.toggle('active', Math.abs(state.diameter - val) < 0.5);
      });

      demoWlChips.forEach((chip) => {
        const val = parseFloat(chip.dataset.demoWl || '0');
        chip.classList.toggle('active', Math.abs(wlNm - val) < 2);
      });

      // Sync Deflector controls
      const deg = (state.deflectionAngle * 180) / Math.PI;
      const labelDemoDeflect = this.container.querySelector('#demo-label-deflection');
      if (labelDemoDeflect) labelDemoDeflect.textContent = `${deg >= 0 ? '+' : ''}${deg.toFixed(1)}°`;
      if (demoDeflectSlider && document.activeElement !== demoDeflectSlider) {
        demoDeflectSlider.value = deg.toFixed(1);
      }

      const sinTheta = Math.abs(Math.sin(state.deflectionAngle));
      const periodUm = sinTheta > 0.01 ? Math.min(3.5, Math.max(0.6, state.wavelength / sinTheta)) : 3.5;
      const labelDemoPeriod = this.container.querySelector('#demo-label-period');
      if (labelDemoPeriod) labelDemoPeriod.textContent = `${periodUm.toFixed(2)} µm`;
      if (demoPeriodSlider && document.activeElement !== demoPeriodSlider) {
        demoPeriodSlider.value = periodUm.toFixed(2);
      }

      const labelDemoDeflectWl = this.container.querySelector('#demo-label-deflect-wl');
      if (labelDemoDeflectWl) labelDemoDeflectWl.textContent = `${wlNm.toFixed(0)} nm`;
      if (demoDeflectWlSlider && document.activeElement !== demoDeflectWlSlider) {
        demoDeflectWlSlider.value = wlNm.toString();
      }

      demoDegChips.forEach((chip) => {
        const val = parseFloat(chip.dataset.demoDeg || '0');
        chip.classList.toggle('active', Math.abs(deg - val) < 0.5);
      });

      // Sync Vortex controls
      const labelDemoCharge = this.container.querySelector('#demo-label-charge');
      if (labelDemoCharge) labelDemoCharge.textContent = `ℓ = ${state.topologicalCharge >= 0 ? '+' : ''}${state.topologicalCharge}`;
      demoChargeBtns.forEach((b) => {
        const val = parseInt(b.dataset.demoCharge || '0', 10);
        b.classList.toggle('active', val === state.topologicalCharge);
      });

      const labelDemoVortexDiam = this.container.querySelector('#demo-label-vortex-diam');
      if (labelDemoVortexDiam) labelDemoVortexDiam.textContent = `${state.diameter.toFixed(1)} µm`;
      if (demoVortexDiamSlider && document.activeElement !== demoVortexDiamSlider) {
        demoVortexDiamSlider.value = state.diameter.toString();
      }

      const labelDemoVortexWl = this.container.querySelector('#demo-label-vortex-wl');
      if (labelDemoVortexWl) labelDemoVortexWl.textContent = `${wlNm.toFixed(0)} nm`;
      if (demoVortexWlSlider && document.activeElement !== demoVortexWlSlider) {
        demoVortexWlSlider.value = wlNm.toString();
      }

      // Sync Hologram controls
      demoCghBtns.forEach((b) => {
        b.classList.toggle('active', b.dataset.demoCgh === state.hologramTarget);
      });
      const labelDemoHoloTarget = this.container.querySelector('#demo-label-holo-target');
      if (labelDemoHoloTarget) {
        const targetNames: Record<string, string> = { crest: 'Optics Crest', smiley: 'Diffraction Smiley', mu: 'Micro-Mu (µ)' };
        labelDemoHoloTarget.textContent = targetNames[state.hologramTarget] || 'Target Pattern';
      }

      const labelDemoHoloDiam = this.container.querySelector('#demo-label-holo-diam');
      if (labelDemoHoloDiam) labelDemoHoloDiam.textContent = `${state.diameter.toFixed(1)} µm`;
      if (demoHoloDiamSlider && document.activeElement !== demoHoloDiamSlider) {
        demoHoloDiamSlider.value = state.diameter.toString();
      }

      const labelDemoHoloWl = this.container.querySelector('#demo-label-holo-wl');
      if (labelDemoHoloWl) labelDemoHoloWl.textContent = `${wlNm.toFixed(0)} nm`;
      if (demoHoloWlSlider && document.activeElement !== demoHoloWlSlider) {
        demoHoloWlSlider.value = wlNm.toString();
      }

      // Check if demonstration or optical parameters changed
      const demonstrationKey = `${state.deviceType}_${ag.lens}_${ag.deflect}_${ag.vortex}_${ag.hologram}_${state.wavelength}_${state.designWavelength}_${state.focalLength}_${state.diameter}_${state.deflectionAngle}_${state.topologicalCharge}_${Boolean(state.cghPhaseMask)}`;
      if (demonstrationKey !== lastDemonstrationKey) {
        lastDemonstrationKey = demonstrationKey;
        const deviceChanged = lastDeviceType !== state.deviceType;
        lastDeviceType = state.deviceType;
        const newScale = getDemonstrationIntensityScale(state);
        applyScaleRange(newScale, !deviceChanged);
        this.wavefieldRenderer?.render();
        this.xyRenderer?.render();
      } else if (intensitySlider && document.activeElement !== intensitySlider && state.intensityMax !== undefined) {
        // If external store update directly changed intensityMax
        const currentSliderVal = parseFloat(intensitySlider.value);
        if (Math.abs(currentSliderVal - state.intensityMax) > 1e-4) {
          intensitySlider.value = state.intensityMax.toString();
          const formatted = formatIntensityValue(state.intensityMax);
          if (intensityDisplay) intensityDisplay.textContent = formatted;
          if (scaleMaxDisplay) scaleMaxDisplay.textContent = formatted;
          if (currentScale.max > currentScale.min) {
            relativePosition = Math.max(0, Math.min(1, (state.intensityMax - currentScale.min) / (currentScale.max - currentScale.min)));
          }
        }
      }

      this.xyRenderer?.render();
      this.farFieldRenderer?.update();
    });
  }

  public destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.wavefieldRenderer?.destroy();
    this.xyRenderer?.destroy();
    this.farFieldRenderer?.destroy();
    this.latticeViewer?.destroy();
    this.hud?.destroy();
  }
}

