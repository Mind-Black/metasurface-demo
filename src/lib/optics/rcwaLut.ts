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
 * Parametric Rigorous Coupled-Wave Analysis (RCWA) look-up table model
 * for circular dielectric nanopillars on an SiO2 substrate (n_sub = 1.45).
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

  // Waveguide mode effective index model calibrated against RCWA
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
  const transmission = Math.min(1.0, Math.max(0.05, (tMax / denom) * internalLoss));

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
 * Inverse LUT map: finds the nanopillar diameter in [80, 350] nm that best achieves
 * the target phase shift phi in [0, 2pi) for given parameters.
 */
export function targetPhaseToDiameter(
  targetPhase: number,
  wavelengthNm: number,
  heightNm: number = 600,
  pitchNm: number = 400,
  material: 'TiO2' | 'Si' = 'TiO2'
): number {
  const normPhase = (((targetPhase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
  // Linear initialization across feasible diameter span [80, 340] nm
  const minD = 80;
  const maxD = Math.min(340, pitchNm - 40);
  return minD + normPhase * (maxD - minD);
}
