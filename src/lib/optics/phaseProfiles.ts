import { hologramPupilSamples } from './gerchbergSaxton';

/**
 * Hyperbolic focusing phase profile for a spherical aberration-free metalens.
 * phi(r) = -k0 * (sqrt(r^2 + f^2) - f)
 * @param x Lateral coordinate in micrometers
 * @param y Lateral coordinate in micrometers
 * @param wavelength Free-space wavelength in micrometers
 * @param focalLength Design focal length in micrometers
 * @returns Wrapped phase shift in radians [0, 2pi)
 */
export function getMetalensTargetPhase(
  x: number,
  y: number,
  wavelength: number,
  focalLength: number
): number {
  const r2 = x * x + y * y;
  const k0 = (2 * Math.PI) / wavelength;
  const phase = -k0 * (Math.sqrt(r2 + focalLength * focalLength) - focalLength);
  return ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Linear phase gradient profile for anomalous beam deflection.
 * Generalized Snell's law: n_t sin(theta_t) - n_i sin(theta_i) = (lambda / 2pi) * dphi/dx
 * @param x Lateral position in micrometers
 * @param wavelength Free-space wavelength in micrometers
 * @param deflectionAngleRad Target deflection angle in radians
 * @returns Wrapped phase shift in radians [0, 2pi)
 */
export function getBeamDeflectorPhase(
  x: number,
  wavelength: number,
  deflectionAngleRad: number
): number {
  const k0 = (2 * Math.PI) / wavelength;
  const phase = k0 * Math.sin(deflectionAngleRad) * x;
  return ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Spiral phase plate profile for optical vortex beam generation.
 * Imparts orbital angular momentum (OAM) of L = ell * hbar per photon.
 * phi(r, theta) = ell * theta
 * @param x Lateral coordinate in micrometers
 * @param y Lateral coordinate in micrometers
 * @param topologicalCharge Integer orbital charge ell
 * @returns Wrapped phase shift in radians [0, 2pi)
 */
export function getVortexBeamPhase(
  x: number,
  y: number,
  topologicalCharge: number
): number {
  const theta = Math.atan2(y, x);
  const phase = topologicalCharge * theta;
  return ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Pancharatnam-Berry (PB) / Geometric Phase.
 * Imparts phase phi = 2 * sigma * theta for circularly polarized light,
 * where sigma = +1 for LCP, -1 for RCP, and theta is the in-plane rotation angle of the nanofin.
 */
export function getPBRotationAngle(targetPhase: number, helicity: 1 | -1 = 1): number {
  const theta = (helicity * targetPhase) / 2;
  return ((theta % Math.PI) + Math.PI) % Math.PI;
}

/**
 * Computes Numerical Aperture: NA = sin(arctan(D / (2 * f)))
 */
export function calculateNumericalAperture(diameter: number, focalLength: number): number {
  if (focalLength <= 0 || diameter <= 0) return 0;
  const halfAngle = Math.atan(diameter / (2 * focalLength));
  return Math.sin(halfAngle);
}

/**
 * Computes diffraction-limited Airy spot FWHM: FWHM = lambda / (2 * NA)
 */
export function calculateAbbeLimit(wavelength: number, numericalAperture: number): number {
  if (numericalAperture <= 0) return Infinity;
  return wavelength / (2 * numericalAperture);
}

/**
 * Computes chromatic focal shift for single-layer diffractive/metasurface lens.
 * Because phase is fixed at fabrication: f(lambda) = f0 * (lambda0 / lambda).
 * Delta f = f(lambda) - f0.
 */
export function calculateChromaticFocalShift(
  designWavelength: number,
  operationalWavelength: number,
  designFocalLength: number
): { operationalFocalLength: number; deltaFocalLength: number } {
  if (operationalWavelength <= 0) {
    return { operationalFocalLength: designFocalLength, deltaFocalLength: 0 };
  }
  const operationalFocalLength = designFocalLength * (designWavelength / operationalWavelength);
  const deltaFocalLength = operationalFocalLength - designFocalLength;
  return { operationalFocalLength, deltaFocalLength };
}

/**
 * Computes anomalous refraction angle from interfacial phase gradient:
 * theta_t = arcsin((lambda / 2pi) * (dphi/dx))
 */
export function calculateDeflectionAngle(wavelength: number, phaseGradientX: number): number {
  const k0 = (2 * Math.PI) / wavelength;
  const sinTheta = phaseGradientX / k0;
  if (Math.abs(sinTheta) > 1.0) {
    return NaN; // Evanescent / momentum bound exceeded
  }
  return Math.asin(sinTheta);
}

export interface IntensityScaleRange {
  nominalPeak: number;
  min: number;
  max: number;
  step: number;
  ticks: number;
}

export interface DemonstrationIntensityState {
  deviceType: 'metalens' | 'deflector' | 'vortex' | 'hologram';
  activeGradients?: {
    lens: boolean;
    deflect: boolean;
    vortex: boolean;
    hologram: boolean;
  };
  wavelength?: number;
  designWavelength?: number;
  focalLength?: number;
  diameter?: number;
  deflectionAngle?: number;
  topologicalCharge?: number;
  cghPhaseMask?: number[][] | null;
}

const SCALE_CACHE = new Map<string, IntensityScaleRange>();
const MASK_IDS = new WeakMap<number[][], number>();
let nextMaskId = 1;

/**
 * Estimates the maximum wavefield intensity |E|^2 for a specific optical demonstration
 * by sampling the simulated Huygens-Fresnel wavefield.
 */
export function estimateDemonstrationMaxIntensity(state: DemonstrationIntensityState): number {
  const deviceType = state.deviceType || 'metalens';
  const focalLength = state.focalLength ?? 25.0;
  const diameter = state.diameter ?? 30.0;
  const wavelength = state.wavelength ?? 0.532;
  const designWavelength = state.designWavelength ?? 0.532;
  const deflectionAngle = state.deflectionAngle ?? 0.35;
  const topologicalCharge = state.topologicalCharge ?? 1;
  const cghPhaseMask = state.cghPhaseMask;

  const NUM_ELEMENTS = 128;
  const PI = Math.PI;
  const kDesign = (2.0 * PI) / Math.max(0.2, designWavelength);
  const k = (2.0 * PI) / Math.max(0.2, wavelength);
  const elementSpacing = diameter / NUM_ELEMENTS;
  const radius = diameter * 0.5;
  // Constant spatial scale bounds regardless of metaoptics parameters
  const zMax = 60.0;
  const xMax = 45.0;

  const lensOn = state.activeGradients ? state.activeGradients.lens : (deviceType === 'metalens');
  const deflectOn = state.activeGradients ? state.activeGradients.deflect : (deviceType === 'deflector');
  const vortexOn = state.activeGradients ? state.activeGradients.vortex : (deviceType === 'vortex');
  const holoOn = state.activeGradients ? state.activeGradients.hologram : (deviceType === 'hologram');

  let maxI = 0.005;
  const points: [number, number][] = [];

  const sinDeflect = (wavelength / designWavelength) * Math.sin(deflectionAngle);
  const theta = Math.asin(Math.min(1.0, Math.max(-1.0, sinDeflect)));
  const tanTheta = Math.tan(theta);

  if (lensOn) {
    const actualFocal = focalLength * (designWavelength / wavelength);
    const centerX = deflectOn ? actualFocal * tanTheta : 0.0;
    for (let zDelta = -4; zDelta <= 4; zDelta += 0.5) {
      const z = actualFocal + zDelta;
      if (z > 0 && z <= zMax) {
        for (let dx = -2; dx <= 2; dx += 0.5) {
          const x = centerX + dx;
          if (Math.abs(x) <= xMax) points.push([x, z]);
        }
      }
    }
  } else if (deflectOn) {
    for (let z = 1.0; z <= zMax; z += zMax / 25) {
      const centerX = z * tanTheta;
      for (let dx = -radius * 0.8; dx <= radius * 0.8; dx += radius * 0.2) {
        const x = centerX + dx;
        if (Math.abs(x) <= xMax) points.push([x, z]);
      }
    }
  } else if (vortexOn) {
    for (let z = zMax * 0.1; z <= zMax; z += zMax / 20) {
      for (let x = -radius * 0.8; x <= radius * 0.8; x += radius * 0.1) {
        points.push([x, z]);
      }
    }
  } else {
    // Hologram or general
    for (let z = zMax * 0.1; z <= zMax; z += zMax / 20) {
      for (let x = -xMax * 0.8; x <= xMax * 0.8; x += xMax * 0.15) {
        points.push([x, z]);
      }
    }
  }

  const useHologramPupil = holoOn && cghPhaseMask && cghPhaseMask.length > 0;
  const pupil = useHologramPupil ? hologramPupilSamples(cghPhaseMask, diameter) : null;
  const count = pupil ? pupil.length : NUM_ELEMENTS;

  for (let p = 0; p < points.length; p++) {
    const [x, z] = points[p];
    let eRe = 0;
    let eIm = 0;
    for (let i = 0; i < count; i++) {
      const xPos = pupil ? pupil[i].x : -radius + (i + 0.5) * elementSpacing;
      const yPos = pupil ? pupil[i].y : 0;
      let targetPhase = 0;
      if (lensOn) {
        targetPhase += -kDesign * (Math.sqrt(xPos * xPos + yPos * yPos + focalLength * focalLength) - focalLength);
      }
      if (deflectOn) {
        targetPhase += kDesign * Math.sin(deflectionAngle) * xPos;
      }
      if (vortexOn) {
        const normPos = xPos / Math.max(0.001, radius);
        targetPhase += topologicalCharge * (useHologramPupil ? Math.atan2(yPos, xPos) : (normPos >= 0.0 ? 0.0 : PI));
      }
      if (holoOn) {
        if (pupil) {
          targetPhase += pupil[i].phase;
        } else {
          const norm = i / 128;
          targetPhase += (((Math.sin(norm * 18.8495) * 1.5 + Math.cos(norm * 37.699)) % (2 * PI)) + 2 * PI) % (2 * PI);
        }
      }
      const dx = x - xPos;
      const dist = Math.max(0.001, Math.sqrt(dx * dx + yPos * yPos + z * z));
      const obliquity = 0.5 * (1.0 + z / dist);
      let amp = obliquity / (pupil ? dist : Math.sqrt(dist));
      if (!pupil && vortexOn && Math.abs(topologicalCharge) > 0.01) {
        amp *= (0.2 + 0.8 * Math.abs(xPos / radius));
      }
      const totalPhase = targetPhase + k * dist;
      eRe += amp * Math.cos(totalPhase);
      eIm += amp * Math.sin(totalPhase);
    }
    eRe /= Math.sqrt(count);
    eIm /= Math.sqrt(count);
    if (!pupil && vortexOn && Math.abs(topologicalCharge) > 0.01) {
      const coreCenterX = (lensOn && deflectOn) ? (focalLength * (designWavelength / wavelength) * tanTheta) : (deflectOn ? z * tanTheta : 0.0);
      const coreRadius = (0.4 + 0.3 * Math.abs(topologicalCharge)) * (wavelength / 0.532) * (1.0 + 0.4 * (z / Math.max(0.1, focalLength)));
      const vortexCore = Math.min(1.0, Math.max(0.0, Math.abs(x - coreCenterX) / coreRadius));
      eRe *= vortexCore;
      eIm *= vortexCore;
    }
    const I = eRe * eRe + eIm * eIm;
    if (I > maxI) maxI = I;
  }
  return maxI;
}

/**
 * Calculates a dynamic, continuous intensity slider scale range calibrated
 * to the actual peak intensity of a demonstration.
 * Maintains a constant number of ticks (100) across all demonstrations.
 */
export function getDemonstrationIntensityScale(state: DemonstrationIntensityState): IntensityScaleRange {
  const gKey = state.activeGradients ? `${state.activeGradients.lens}_${state.activeGradients.deflect}_${state.activeGradients.vortex}_${state.activeGradients.hologram}` : state.deviceType;
  let maskId = 0;
  if (state.cghPhaseMask) {
    if (!MASK_IDS.has(state.cghPhaseMask)) MASK_IDS.set(state.cghPhaseMask, nextMaskId++);
    maskId = MASK_IDS.get(state.cghPhaseMask)!;
  }
  const cacheKey = `${state.deviceType}_${gKey}_${state.wavelength}_${state.designWavelength}_${state.focalLength}_${state.diameter}_${state.deflectionAngle}_${state.topologicalCharge}_${maskId}`;
  const cached = SCALE_CACHE.get(cacheKey);
  if (cached) return cached;

  const peak = estimateDemonstrationMaxIntensity(state);
  const safePeak = Math.max(0.005, peak);
  const min = Math.max(0.001, safePeak * 0.05);
  const max = safePeak * 2.05;
  const ticks = 100;
  const step = (max - min) / ticks;

  const result: IntensityScaleRange = {
    nominalPeak: safePeak,
    min,
    max,
    step,
    ticks
  };
  if (SCALE_CACHE.size >= 256) SCALE_CACHE.clear();
  SCALE_CACHE.set(cacheKey, result);
  return result;
}

/**
 * Formats an intensity value with precision appropriate to its scale.
 */
export function formatIntensityValue(val: number): string {
  if (val >= 100) return val.toFixed(0);
  if (val >= 10) return val.toFixed(1);
  if (val >= 1) return val.toFixed(2);
  if (val >= 0.1) return val.toFixed(3);
  return val.toFixed(4);
}
