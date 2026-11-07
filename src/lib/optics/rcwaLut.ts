import { TiO2_Dispersion, Silicon_Dispersion, MaterialDispersion } from './materials';
import { UNIT_CELL_TABLE as TABLE } from './unitCellTable';

export const TABLE_PITCH_UM = TABLE.pitchNm / 1000;
const TAU = 2 * Math.PI;
const FINE_STEP_NM = 1;
const PHASE_BINS = 1024;

interface ByDiameter { re: Float64Array; im: Float64Array }

const byWavelength = new Map<number, ByDiameter>();
const designs = new Map<number, { offset: number; diameterIndex: Int32Array }>();
const phaseResponses = new Map<string, { re: Float64Array; im: Float64Array }>();

const isTabulated = (heightNm: number, pitchNm: number, material: string) =>
  material === 'TiO2' && heightNm === TABLE.heightNm && pitchNm === TABLE.pitchNm;

/** RCWA t(d) at one wavelength on a 1 nm diameter grid, interpolated from the table. */
function responseAt(wavelengthNm: number): ByDiameter {
  let result = byWavelength.get(wavelengthNm);
  if (result) return result;
  const lams = TABLE.wavelengthsNm;
  const ds = TABLE.diametersNm;
  const clamped = Math.max(lams[0], Math.min(lams[lams.length - 1], wavelengthNm));
  let w = 0;
  while (w < lams.length - 2 && lams[w + 1] < clamped) w++;
  const u = (clamped - lams[w]) / (lams[w + 1] - lams[w]);
  const count = Math.round((ds[ds.length - 1] - ds[0]) / FINE_STEP_NM) + 1;
  result = { re: new Float64Array(count), im: new Float64Array(count) };
  const at = (lam: number, d: number, src: readonly number[]) => src[lam * ds.length + d];
  for (let i = 0; i < count; i++) {
    const pos = (i * FINE_STEP_NM) / (ds[1] - ds[0]);
    const d = Math.min(ds.length - 2, Math.floor(pos));
    const v = pos - d;
    const mix = (src: readonly number[]) =>
      (1 - u) * ((1 - v) * at(w, d, src) + v * at(w, d + 1, src)) +
      u * ((1 - v) * at(w + 1, d, src) + v * at(w + 1, d + 1, src));
    result.re[i] = mix(TABLE.re);
    result.im[i] = mix(TABLE.im);
  }
  if (byWavelength.size >= 128) byWavelength.clear();
  byWavelength.set(wavelengthNm, result);
  return result;
}

/**
 * Picks, for each target phase, the pillar whose RCWA t(d) projects most strongly on it.
 * Only phase differences matter, so the common phase offset is chosen to maximize that overlap.
 */
function designFor(wavelengthNm: number) {
  let design = designs.get(wavelengthNm);
  if (design) return design;
  const { re, im } = responseAt(wavelengthNm);
  const project = (phase: number) => {
    const c = Math.cos(phase);
    const s = Math.sin(phase);
    let best = 0;
    let value = -Infinity;
    for (let i = 0; i < re.length; i++) {
      const v = re[i] * c + im[i] * s;
      if (v > value) { value = v; best = i; }
    }
    return { best, value };
  };
  let offset = 0;
  let bestScore = -Infinity;
  for (let a = 0; a < 90; a++) {
    const trial = (a * TAU) / 90;
    let score = 0;
    for (let b = 0; b < 180; b++) score += project(((b + 0.5) * TAU) / 180 + trial).value;
    if (score > bestScore) { bestScore = score; offset = trial; }
  }
  const diameterIndex = new Int32Array(PHASE_BINS);
  for (let b = 0; b < PHASE_BINS; b++) diameterIndex[b] = project(((b + 0.5) * TAU) / PHASE_BINS + offset).best;
  design = { offset, diameterIndex };
  designs.set(wavelengthNm, design);
  return design;
}

/** Transmission at λ of the pillar designed at λ0 for each target phase bin (bin / 1024 · 2π). */
export function phaseResponse(designWavelengthUm: number, wavelengthUm: number): { re: Float64Array; im: Float64Array } {
  const key = `${designWavelengthUm}|${wavelengthUm}`;
  let result = phaseResponses.get(key);
  if (result) return result;
  const design = designFor(Math.round(designWavelengthUm * 1000));
  const t = responseAt(wavelengthUm * 1000);
  const c = Math.cos(design.offset);
  const s = Math.sin(design.offset);
  result = { re: new Float64Array(PHASE_BINS), im: new Float64Array(PHASE_BINS) };
  for (let b = 0; b < PHASE_BINS; b++) {
    const i = design.diameterIndex[b];
    result.re[b] = t.re[i] * c + t.im[i] * s;
    result.im[b] = t.im[i] * c - t.re[i] * s;
  }
  if (phaseResponses.size >= 128) phaseResponses.clear();
  phaseResponses.set(key, result);
  return result;
}

export interface UnitCellResponse {
  phase: number;        // radians [0, 2pi)
  transmission: number; // amplitude [0, 1]
  aspectRatio: number;
  fabFeasible: boolean;
  fabWarning?: string;
  nEff: number;
}

/**
 * Unit-cell response. The tabulated geometry (TiO2, see unitCellTable.ts) returns RCWA data,
 * with phase measured from the design offset at wavelengthNm. Any other geometry falls back to
 * a rough area-averaged effective-index estimate, which fails when pitch exceeds λ/n_substrate.
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

  // Area-averaged permittivity estimate
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

  if (isTabulated(heightNm, pitchNm, material)) {
    const { re, im } = responseAt(wavelengthNm);
    const first = TABLE.diametersNm[0];
    const last = TABLE.diametersNm[TABLE.diametersNm.length - 1];
    const i = Math.round((Math.max(first, Math.min(last, safeDiameter)) - first) / FINE_STEP_NM);
    const phase = Math.atan2(im[i], re[i]) - designFor(wavelengthNm).offset;
    return { phase: ((phase % TAU) + TAU) % TAU, transmission: Math.hypot(re[i], im[i]),
      aspectRatio: ar, fabFeasible: feasible, fabWarning: warning, nEff };
  }

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
 * Inverts the model used by queryUnitCellLUT. For the estimate, consider all 2π branches in the fabrication interval; if the desired phase
 * is outside its coverage, return the endpoint with least circular phase error.
 */
export function targetPhaseToDiameter(
  targetPhase: number,
  wavelengthNm: number,
  heightNm: number = 600,
  pitchNm: number = 400,
  material: 'TiO2' | 'Si' = 'TiO2'
): number {
  const tau = TAU;
  const phase = ((targetPhase % tau) + tau) % tau;
  if (isTabulated(heightNm, pitchNm, material)) {
    const bin = Math.floor((phase / tau) * PHASE_BINS) % PHASE_BINS;
    return TABLE.diametersNm[0] + designFor(wavelengthNm).diameterIndex[bin] * FINE_STEP_NM;
  }
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
