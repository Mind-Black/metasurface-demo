import { generateTargetBitmap, runGerchbergSaxton } from '@/lib/optics/gerchbergSaxton';
import type { Analyzer, PhaseMechanism, Stokes } from '@/lib/optics/polarization';
import { defaultHybridDesign, defaultOrthogonalDesign } from '@/lib/optics/metasurface';
import type { DeviceDesign, PhaseProfile, ResponseModel } from '@/lib/optics/metasurface';
export const MAX_HOLOGRAM_ITERATIONS = 500;
export type DeviceType = 'metalens' | 'deflector' | 'vortex' | 'axicon' | 'hologram';
export type MaterialType = 'TiO2' | 'Si';
export type RenderMode = 'field' | 'intensity' | 'phase';

export interface ActiveGradients {
  lens: boolean;
  deflect: boolean;
  vortex: boolean;
  axicon: boolean;
  hologram: boolean;
}

export interface OpticsState {
  design: DeviceDesign;
  responseModel: ResponseModel;
  savedOrthogonalResponseModel: ResponseModel;
  savedHybridResponseModel: ResponseModel;
  savedOrthogonalDesign: Extract<DeviceDesign, { kind: 'orthogonal' }>;
  savedHybridDesign: Extract<DeviceDesign, { kind: 'hybrid' }>;
  phaseMapChannel: 0 | 1;
  // Optical Parameters
  wavelength: number;       // in micrometers (e.g. 0.532)
  designWavelength: number; // in micrometers (e.g. 0.532)
  focalLength: number;      // in micrometers (e.g. 25.0)
  diameter: number;         // in micrometers (e.g. 30.0)
  deflectionAngle: number;  // in radians (e.g. 0.35 ~20 degrees)
  topologicalCharge: number;// integer (UI range: -10 to +10)
  axiconNA: number;         // design NA = sin(theta_a), dimensionless (UI range: -0.85 to +0.85)
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
  setDesignKind: (kind: 'legacy' | 'orthogonal' | 'hybrid') => void;
  setDesignBasis: (psi: number, chi: number) => void;
  setProfile: (index: 0 | 1, patch: Partial<PhaseProfile>) => void;
  setResponseModel: (model: ResponseModel) => void;
  setPhaseMapChannel: (channel: 0 | 1) => void;
  setDesignWavelength: (val: number) => void;
  setFocalLength: (val: number) => void;
  setDiameter: (val: number) => void;
  setDeviceType: (val: DeviceType) => void;
  setDeflectionAngle: (val: number) => void;
  setTopologicalCharge: (val: number) => void;
  setAxiconNA: (val: number) => void;
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
      design: { kind: 'legacy' },
      responseModel: 'ideal',
      savedOrthogonalResponseModel: 'ideal',
      savedHybridResponseModel: 'ideal',
      savedOrthogonalDesign: defaultOrthogonalDesign(),
      savedHybridDesign: defaultHybridDesign(),
      phaseMapChannel: 0,
      wavelength: 0.532,
      designWavelength: 0.532,
      focalLength: 25.0,
      diameter: 30.0,
      deflectionAngle: 0.35, // ~20 degrees
      topologicalCharge: 1,
      axiconNA: 0.35,        // ~20.5 deg cone half-angle (z_max ~40.1 um at D=30 um)
      deviceType: 'metalens',
      material: 'TiO2',
      activeGradients: {
        lens: true,
        deflect: false,
        vortex: false,
        axicon: false,
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
      setDesignKind: (kind) => {
        if (kind === 'legacy') this.update({ design: { kind } });
        else if (kind === 'orthogonal') this.update({ design: this.state.savedOrthogonalDesign, responseModel: this.state.savedOrthogonalResponseModel });
        else this.update({ design: this.state.savedHybridDesign, responseModel: this.state.savedHybridResponseModel });
      },
      setDesignBasis: (psi, chi) => {
        if (!Number.isFinite(psi) || !Number.isFinite(chi)) return;
        const saved = this.state.savedOrthogonalDesign;
        const design = { ...saved, basis: { psi: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, psi)),
          chi: Math.max(-Math.PI / 4, Math.min(Math.PI / 4, chi)) } };
        this.update({ savedOrthogonalDesign: design, ...(this.state.design.kind === 'orthogonal' ? { design } : {}) });
      },
      setProfile: (index, patch) => {
        const kind = this.state.design.kind;
        if (kind === 'legacy') return;
        const base = kind === 'orthogonal' ? this.state.savedOrthogonalDesign : this.state.savedHybridDesign;
        const profiles = base.profiles.map((profile, i) => {
          if (i !== index) return profile;
          const updated = { ...profile, ...patch };
          if (![updated.focalLength, updated.deflectionAngle, updated.topologicalCharge, updated.axiconNA, updated.hologramIterations].every(Number.isFinite)
            || updated.focalLength <= 0 || Math.abs(updated.axiconNA) >= 1) {
            throw new RangeError('Profile parameters must be finite, focal length positive, and |axicon NA| < 1.');
          }
          updated.topologicalCharge = Math.max(-10, Math.min(10, Math.round(updated.topologicalCharge)));
          updated.hologramIterations = Math.max(1, Math.min(MAX_HOLOGRAM_ITERATIONS, Math.round(updated.hologramIterations)));
          if (patch.cghPhaseMask) {
            const mask = patch.cghPhaseMask;
            if (!mask.length || !mask[0].length || mask.some(row => row.length !== mask[0].length || row.some(v => !Number.isFinite(v)))) {
              throw new RangeError('A hologram mask must be a nonempty rectangular array of finite phases.');
            }
            updated.cghPhaseMask = mask.map(row => row.map(v => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)));
          }
          if (updated.hologram && (!updated.cghPhaseMask || patch.hologramTarget !== undefined || patch.hologramIterations !== undefined)) {
            updated.cghPhaseMask = runGerchbergSaxton(generateTargetBitmap(updated.hologramTarget), updated.hologramIterations).phaseMask;
          } else if (!updated.hologram && (patch.hologramTarget !== undefined || patch.hologramIterations !== undefined)) updated.cghPhaseMask = null;
          return updated;
        }) as [PhaseProfile, PhaseProfile];
        const next = { ...base, profiles } as typeof base;
        this.update(kind === 'orthogonal'
          ? { savedOrthogonalDesign: next as Extract<DeviceDesign, { kind: 'orthogonal' }>, design: next as DeviceDesign }
          : { savedHybridDesign: next as Extract<DeviceDesign, { kind: 'hybrid' }>, design: next as DeviceDesign });
      },
      setResponseModel: (responseModel) => this.update({ responseModel,
        ...(this.state.design.kind === 'orthogonal' ? { savedOrthogonalResponseModel: responseModel }
          : this.state.design.kind === 'hybrid' ? { savedHybridResponseModel: responseModel } : {}) }),
      setPhaseMapChannel: (phaseMapChannel) => this.update({ phaseMapChannel }),
      setDesignWavelength: (designWavelength) => this.update({ designWavelength }),
      setFocalLength: (focalLength) => this.update({ focalLength }),
      setDiameter: (diameter) => this.update({ diameter }),
      setDeviceType: (deviceType) => {
        const activeGradients: ActiveGradients = {
          lens: deviceType === 'metalens',
          deflect: deviceType === 'deflector',
          vortex: deviceType === 'vortex',
          axicon: deviceType === 'axicon',
          hologram: deviceType === 'hologram',
        };
        this.update({ deviceType, activeGradients });
      },
      setActiveGradients: (gradients) => {
        const activeGradients: ActiveGradients = { ...this.state.activeGradients, ...gradients };
        let dev: DeviceType = 'metalens';
        if (activeGradients.hologram) dev = 'hologram';
        else if (activeGradients.axicon && !activeGradients.lens) dev = 'axicon';
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
      setAxiconNA: (value) => {
        if (Number.isFinite(value)) this.update({ axiconNA: Math.max(-0.85, Math.min(0.85, value)) });
      },
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
