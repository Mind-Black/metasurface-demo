import { TiO2_Dispersion, Silicon_Dispersion, MaterialDispersion } from './materials';

export interface UnitCellResponse {
  phase: number;        // radians [0, 2pi)
  transmission: number; // amplitude [0, 1]
  aspectRatio: number;
  fabFeasible: boolean;
  fabWarning?: string;
  nEff: number;
}

/**
 * Analytic effective-index surrogate for circular dielectric nanopillars.
 * This is not an RCWA solver or a measured/simulated unit-cell library.
 */
export function queryUnitCellLUT(
  diameterNm: number,
  wavelengthNm: number,
  heightNm: number = 600,
  pitchNm: number = 400,
  material: 'TiO2' | 'Si' = 'TiO2'
): UnitCellResponse {
  const safeDiameter = Math.max(10, diameterNm);
  const ar = heightNm / safeDiameter;
  const gap = pitchNm - safeDiameter;

  let warning: string | undefined;
  let feasible = true;

  if (ar > 10) {
    feasible = false;
    warning = `Aspect ratio ${ar.toFixed(1)}:1 exceeds nanofab collapse limit (max 10:1)`;
  } else if (gap < 40) {
    feasible = false;
    warning = `Inter-pillar gap (${gap.toFixed(0)} nm) below critical lithography resolution (< 40 nm)`;
  }

  // Approximate effective index from the dielectric fill fraction.
  const mat: MaterialDispersion = material === 'TiO2' ? TiO2_Dispersion : Silicon_Dispersion;
  const { n, k } = mat.getRefractiveIndex(wavelengthNm);
  const nSub = 1.45; // Fused silica substrate

  // Normalized frequency / Maxwell-Garnett effective index
  const k0 = (2 * Math.PI) / (wavelengthNm * 1e-9);
  const radius = (safeDiameter * 1e-9) / 2;
  const areaRatio = Math.min(0.95, (Math.PI * radius * radius) / ((pitchNm * 1e-9) ** 2));
  const nEff = Math.sqrt(Math.max(1.0, 1.0 + areaRatio * (n * n - 1.0)));

  const rawPhase = k0 * (nEff - 1.0) * (heightNm * 1e-9);
  const wrappedPhase = ((rawPhase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // Fabry-Perot resonance transmission factor
  const r1 = (nEff - 1.0) / (nEff + 1.0);
  const r2 = (nEff - nSub) / (nEff + nSub);
  const roundTripPhase = 2 * k0 * nEff * (heightNm * 1e-9);
  const tMax = (1 - r1 * r1) * (1 - r2 * r2);
  const denom = Math.max(0.01, 1 + (r1 * r2) ** 2 - 2 * r1 * r2 * Math.cos(roundTripPhase));
  const internalLoss = Math.exp(-2 * k0 * k * (heightNm * 1e-9));
  // Fresnel products and Beer-Lambert loss above are power factors.
  const transmission = Math.sqrt(Math.min(1.0, Math.max(0, (tMax / denom) * internalLoss)));

  return {
    phase: wrappedPhase,
    transmission,
    aspectRatio: ar,
    fabFeasible: feasible,
    fabWarning: warning,
    nEff
  };
}

/**
 * Invert the same effective-index model used by queryUnitCellLUT.
 * Consider all 2π branches in the fabrication interval; if the desired phase
 * is outside its coverage, return the endpoint with least circular phase error.
 */
export function targetPhaseToDiameter(
  targetPhase: number,
  wavelengthNm: number,
  heightNm: number = 600,
  pitchNm: number = 400,
  material: 'TiO2' | 'Si' = 'TiO2'
): number {
  const tau = 2 * Math.PI;
  const phase = ((targetPhase % tau) + tau) % tau;
  const minD = Math.max(80, heightNm / 10);
  const maxD = Math.min(340, pitchNm - 40);
  if (maxD < minD) throw new RangeError('No feasible nanopillar diameter for this height and pitch.');
  const mat = material === 'TiO2' ? TiO2_Dispersion : Silicon_Dispersion;
  const { n } = mat.getRefractiveIndex(wavelengthNm);
  const coefficient = Math.PI * (n * n - 1) / (4 * pitchNm * pitchNm);
  const scale = tau * heightNm / wavelengthNm;
  const rawPhase = (diameter: number) => scale * (Math.sqrt(1 + coefficient * diameter * diameter) - 1);
  const minPhase = rawPhase(minD);
  const maxPhase = rawPhase(maxD);
  const candidates = [minD, maxD];
  if (coefficient > 0 && scale > 0) {
    for (let branch = Math.ceil((minPhase - phase) / tau); branch <= Math.floor((maxPhase - phase) / tau); branch++) {
      const effectiveIndex = 1 + (phase + branch * tau) / scale;
      const diameter = Math.sqrt((effectiveIndex * effectiveIndex - 1) / coefficient);
      candidates.push(Math.max(minD, Math.min(maxD, diameter)));
    }
  }
  let best = minD;
  let bestError = Infinity;
  let bestTransmission = -1;
  for (const diameter of candidates) {
    const response = queryUnitCellLUT(diameter, wavelengthNm, heightNm, pitchNm, material);
    const error = Math.abs(Math.atan2(Math.sin(response.phase - phase), Math.cos(response.phase - phase)));
    if (error < bestError - 1e-10 || (Math.abs(error - bestError) <= 1e-10 && response.transmission > bestTransmission)) {
      best = diameter;
      bestError = error;
      bestTransmission = response.transmission;
    }
  }
  return best;
}
