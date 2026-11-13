import { generateTargetBitmap, runGerchbergSaxton } from '@/lib/optics/gerchbergSaxton';
import type { Analyzer, PhaseMechanism, Stokes } from '@/lib/optics/polarization';
export const MAX_HOLOGRAM_ITERATIONS = 500;
export type DeviceType = 'metalens' | 'deflector' | 'vortex' | 'hologram';
export type MaterialType = 'TiO2' | 'Si';
export type RenderMode = 'field' | 'intensity' | 'phase';

export interface ActiveGradients {
  lens: boolean;
  deflect: boolean;
  vortex: boolean;
  hologram: boolean;
}

export interface OpticsState {
  // Optical Parameters
  wavelength: number;       // in micrometers (e.g. 0.532)
  designWavelength: number; // in micrometers (e.g. 0.532)
  focalLength: number;      // in micrometers (e.g. 25.0)
  diameter: number;         // in micrometers (e.g. 30.0)
  deflectionAngle: number;  // in radians (e.g. 0.35 ~20 degrees)
  topologicalCharge: number;// integer (UI range: -10 to +10)
  deviceType: DeviceType;
  material: MaterialType;

  // Active Multi-Gradients Superposition
  activeGradients: ActiveGradients;

  // Transverse XY Profile Slice Settings
  probeZ: number;           // Selected Z slice coordinate in micrometers [0.0, 60.0]
  wavefieldZoom: number;    // XZ view zoom, anchored at the substrate
  xyZoom: number;           // 1.0 = +/-25 um, 2.0 = +/-12.5 um, 5.0 = +/-5.0 um
  xyViewMode: 'panel' | 'inset'; // 'panel' = 3-panel split, 'inset' = PiP overlay in XZ card

  // Input polarization (Stokes vector S0..S3, S3 > 0 = RCP; see lib/optics/polarization.ts)
  stokes: Stokes;
  // Dynamic-phase pillars or Pancharatnam-Berry (geometric-phase) nanofins
  phaseMechanism: PhaseMechanism;
  // Output analyzer in front of the field views
  analyzer: Analyzer;

  // Nominal pillar geometry
  pitchNm: number;          // unit cell period (e.g. 250 nm)
  heightNm: number;         // structure height (e.g. 600 nm)

  // Rendering State
  renderMode: RenderMode;
  intensityScale: 'linear' | 'log';
  isPlaying: boolean;
  intensityMax: number;     // upper limit for intensity colormap mapping

  // Hologram options
  hologramTarget: 'crest' | 'smiley' | 'mu';
  hologramIterations: number;
  cghPhaseMask: number[][] | null;

  // Actions
  setWavelength: (val: number) => void;
  setDesignWavelength: (val: number) => void;
  setFocalLength: (val: number) => void;
  setDiameter: (val: number) => void;
  setDeviceType: (val: DeviceType) => void;
  setDeflectionAngle: (val: number) => void;
  setTopologicalCharge: (val: number) => void;
  setMaterial: (val: MaterialType) => void;
  setRenderMode: (val: RenderMode) => void;
  setIntensityScale: (val: 'linear' | 'log') => void;
  setIsPlaying: (val: boolean) => void;
  setIntensityMax: (val: number) => void;
  setStokes: (val: Stokes) => void;
  setPhaseMechanism: (val: PhaseMechanism) => void;
  setAnalyzer: (val: Analyzer) => void;
  setPitchNm: (val: number) => void;
  setHeightNm: (val: number) => void;
  setHologramTarget: (val: 'crest' | 'smiley' | 'mu') => void;
  setHologramIterations: (val: number) => void;
  setCghPhaseMask: (val: number[][]) => void;
  setProbeZ: (val: number) => void;
  setWavefieldZoom: (val: number) => void;
  setXyZoom: (val: number) => void;
  setXyViewMode: (val: 'panel' | 'inset') => void;
  toggleGradient: (gradient: keyof ActiveGradients) => void;
  setActiveGradients: (gradients: Partial<ActiveGradients>) => void;
}

type Listener = (state: OpticsState) => void;

class OpticsStore {
  private state: OpticsState;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.state = {
      wavelength: 0.532,
      designWavelength: 0.532,
      focalLength: 25.0,
      diameter: 30.0,
      deflectionAngle: 0.35, // ~20 degrees
      topologicalCharge: 1,
      deviceType: 'metalens',
      material: 'TiO2',
      activeGradients: {
        lens: true,
        deflect: false,
        vortex: false,
        hologram: false
      },
      probeZ: 25.0,
      wavefieldZoom: 1.0,
      xyZoom: 1.0,
      xyViewMode: 'panel',
      stokes: [1, 0, 0, 1], // Right Circular Polarization (RCP)
      phaseMechanism: 'dynamic',
      analyzer: 'none',
      pitchNm: 250,
      heightNm: 600,
      renderMode: 'field',
      intensityScale: 'linear',
      isPlaying: true,
      intensityMax: 1.0,
      hologramTarget: 'crest',
      hologramIterations: 15,
      cghPhaseMask: null,

      setWavelength: (wavelength) => this.update({ wavelength }),
      setDesignWavelength: (designWavelength) => this.update({ designWavelength }),
      setFocalLength: (focalLength) => this.update({ focalLength }),
      setDiameter: (diameter) => this.update({ diameter }),
      setDeviceType: (deviceType) => {
        const activeGradients: ActiveGradients = {
          lens: deviceType === 'metalens',
          deflect: deviceType === 'deflector',
          vortex: deviceType === 'vortex',
          hologram: deviceType === 'hologram',
        };
        this.update({ deviceType, activeGradients });
      },
      setActiveGradients: (gradients) => {
        const activeGradients: ActiveGradients = { ...this.state.activeGradients, ...gradients };
        let dev: DeviceType = 'metalens';
        if (activeGradients.hologram) dev = 'hologram';
        else if (activeGradients.vortex && !activeGradients.lens) dev = 'vortex';
        else if (activeGradients.deflect && !activeGradients.lens) dev = 'deflector';
        else dev = 'metalens';
        this.update({ activeGradients, deviceType: dev });
      },
      toggleGradient: (gradient) => {
        const activeGradients: ActiveGradients = {
          ...this.state.activeGradients,
          [gradient]: !this.state.activeGradients[gradient]
        };
        const hasAny = Object.values(activeGradients).some(Boolean);
        if (!hasAny) activeGradients[gradient] = true;
        this.state.setActiveGradients(activeGradients);
      },
      setProbeZ: (probeZ) => this.update({ probeZ }),
      setWavefieldZoom: (wavefieldZoom) => this.update({ wavefieldZoom }),
      setXyZoom: (xyZoom) => this.update({ xyZoom }),
      setXyViewMode: (xyViewMode) => this.update({ xyViewMode }),
      setDeflectionAngle: (deflectionAngle) => this.update({ deflectionAngle }),
      setTopologicalCharge: (topologicalCharge) => this.update({ topologicalCharge }),
      setMaterial: (material) => {
        const designWl = material === 'Si' ? 1.55 : 0.532;
        this.update({ material, designWavelength: designWl });
      },
      setRenderMode: (renderMode) => this.update({ renderMode }),
      setIntensityScale: (intensityScale) => this.update({ intensityScale }),
      setIsPlaying: (isPlaying) => this.update({ isPlaying }),
      setIntensityMax: (intensityMax) => this.update({ intensityMax }),
      setStokes: (stokes) => {
        if (!stokes.every(Number.isFinite) || Math.hypot(stokes[1], stokes[2], stokes[3]) === 0) {
          throw new RangeError('The input polarization must be a finite, polarized Stokes vector.');
        }
        this.update({ stokes: [...stokes] as Stokes });
      },
      setPhaseMechanism: (phaseMechanism) => this.update({ phaseMechanism }),
      setAnalyzer: (analyzer) => this.update({ analyzer }),
      setPitchNm: (pitchNm) => this.update({ pitchNm }),
      setHeightNm: (heightNm) => this.update({ heightNm }),
      setHologramTarget: (hologramTarget) => this.update({ hologramTarget }),
      setHologramIterations: (value) => {
        if (Number.isFinite(value)) this.update({ hologramIterations: Math.max(1, Math.min(MAX_HOLOGRAM_ITERATIONS, Math.round(value))) });
      },
      setCghPhaseMask: (mask) => {
        if (!mask.length || !mask[0].length || mask.some((row) => row.length !== mask[0].length || row.some((phase) => !Number.isFinite(phase)))) {
          throw new RangeError('A hologram phase mask must be a nonempty rectangular array of finite phases.');
        }
        // Own a fresh snapshot so CPU and GPU caches observe replacements,
        // including callers that reuse and edit their input array.
        this.update({ cghPhaseMask: mask.map((row) => row.map((phase) => ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))) });
      },
    };
  }

  public getState(): OpticsState {
    return this.state;
  }

  public update(partial: Partial<OpticsState>): void {
    const next = { ...this.state, ...partial };
    // Publish a complete optical state once. Renderers must never generate masks
    // while notifying subscribers, which used to leave other views one update behind.
    if (next.activeGradients.hologram && (!next.cghPhaseMask ||
      next.hologramTarget !== this.state.hologramTarget ||
      next.hologramIterations !== this.state.hologramIterations)) {
      next.cghPhaseMask = runGerchbergSaxton(
        generateTargetBitmap(next.hologramTarget), next.hologramIterations
      ).phaseMask;
    } else if (!next.activeGradients.hologram &&
      (next.hologramTarget !== this.state.hologramTarget || next.hologramIterations !== this.state.hologramIterations)) {
      next.cghPhaseMask = null;
    }
    this.state = next;
    this.notify();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const opticsStore = new OpticsStore();
export const useOpticsStore = () => opticsStore.getState();
