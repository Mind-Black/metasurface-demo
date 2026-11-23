import { getAxiconTargetPhase, getBeamDeflectorPhase, getMetalensTargetPhase, getVortexBeamPhase } from './phaseProfiles';
import { generateTargetBitmap, sampleHologramPhase } from './gerchbergSaxton';
import { FIN_CELL_TABLE as TABLE } from './finCellTable';
import { finJones, type Complex } from './polarization';

export interface PhaseProfile {
  lens: boolean; deflect: boolean; vortex: boolean; axicon: boolean; hologram: boolean;
  focalLength: number; deflectionAngle: number; topologicalCharge: number; axiconNA: number;
  hologramTarget: 'crest' | 'smiley' | 'mu'; hologramIterations: number; cghPhaseMask: number[][] | null;
}
export type DeviceDesign = { kind: 'legacy' } | { kind: 'orthogonal'; basis: { psi: number; chi: number }; profiles: [PhaseProfile, PhaseProfile] } | { kind: 'hybrid'; profiles: [PhaseProfile, PhaseProfile] };
export type ResponseModel = 'ideal' | 'library';
export interface JonesVector { ex: Complex; ey: Complex }
export type JonesMatrix = [[Complex, Complex], [Complex, Complex]];
export interface FinSelection { index: number; lengthNm: number; widthNm: number; angle: number; error: number }

const TAU = 2 * Math.PI;
const C = (re: number, im = 0): Complex => ({ re, im });
const add = (a: Complex, b: Complex): Complex => C(a.re + b.re, a.im + b.im);
const mul = (a: Complex, b: Complex): Complex => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const conj = (a: Complex): Complex => C(a.re, -a.im);
const scale = (a: Complex, s: number): Complex => C(a.re * s, a.im * s);
const phase = (p: number): Complex => C(Math.cos(p), Math.sin(p));
const wrap = (p: number): number => ((p % TAU) + TAU) % TAU;
const mag2 = (a: Complex): number => a.re * a.re + a.im * a.im;
const zeroMatrix = (): JonesMatrix => [[C(0), C(0)], [C(0), C(0)]];

export function defaultOrthogonalDesign(): Extract<DeviceDesign, { kind: 'orthogonal' }> {
  return { kind: 'orthogonal', basis: { psi: 0, chi: 0 }, profiles: [defaultProfile({ lens: true, focalLength: 25 }), defaultProfile({ deflect: true, deflectionAngle: 20 * Math.PI / 180 })] };
}
export function defaultHybridDesign(): Extract<DeviceDesign, { kind: 'hybrid' }> {
  return { kind: 'hybrid', profiles: [defaultProfile({ lens: true, focalLength: 25 }), defaultProfile({ vortex: true, topologicalCharge: 1 })] };
}
function defaultProfile(changes: Partial<PhaseProfile>): PhaseProfile {
  return { lens: false, deflect: false, vortex: false, axicon: false, hologram: false, focalLength: 25, deflectionAngle: 0, topologicalCharge: 1, axiconNA: 0.35, hologramTarget: 'crest', hologramIterations: 20, cghPhaseMask: null, ...changes };
}

/** Sum the enabled scalar phase mechanisms. Coordinates and wavelength are in µm. */
export function profilePhase(profile: PhaseProfile, x: number, y: number, designWavelength: number, diameter: number): number {
  let p = 0;
  if (profile.lens) p += getMetalensTargetPhase(x, y, designWavelength, profile.focalLength);
  if (profile.deflect) p += getBeamDeflectorPhase(x, designWavelength, profile.deflectionAngle);
  if (profile.vortex) p += getVortexBeamPhase(x, y, profile.topologicalCharge);
  if (profile.axicon) p += getAxiconTargetPhase(x, y, designWavelength, profile.axiconNA);
  if (profile.hologram) {
    if (profile.cghPhaseMask?.length) p += sampleHologramPhase(profile.cghPhaseMask, x, y, diameter);
    else p += 0;
  }
  return wrap(p);
}

function unit(v: JonesVector): JonesVector {
  const n = Math.sqrt(mag2(v.ex) + mag2(v.ey));
  if (!(n > 0)) return { ex: C(1), ey: C(0) };
  return { ex: scale(v.ex, 1 / n), ey: scale(v.ey, 1 / n) };
}
/** Remove global phase by making the largest component real and nonnegative. */
function canonical(v0: JonesVector): JonesVector {
  const v = unit(v0), pivot = mag2(v.ex) >= mag2(v.ey) - 1e-14 ? v.ex : v.ey;
  const rot = C(pivot.re / Math.sqrt(mag2(pivot)), -pivot.im / Math.sqrt(mag2(pivot)));
  return { ex: mul(v.ex, rot), ey: mul(v.ey, rot) };
}
/** Basis gauges are deterministic: first vector has its largest component real positive; the orthogonal second vector is similarly gauged. This gives H/V and e+/e- exactly at the presets. */
export function designBasis(design: DeviceDesign): [JonesVector, JonesVector] {
  const { psi = 0, chi = 0 } = design.kind === 'orthogonal' ? design.basis : design.kind === 'hybrid' ? { psi: 0, chi: Math.PI / 4 } : { psi: 0, chi: 0 };
  const a = canonical({ ex: C(Math.cos(psi) * Math.cos(chi), -Math.sin(psi) * Math.sin(chi)), ey: C(Math.sin(psi) * Math.cos(chi), Math.cos(psi) * Math.sin(chi)) });
  const b = canonical({ ex: C(-a.ey.re, a.ey.im), ey: C(a.ex.re, -a.ex.im) });
  return [a, b];
}

export function targetJones(design: Exclude<DeviceDesign, { kind: 'legacy' }>, x: number, y: number, designWavelength: number, diameter: number): JonesMatrix {
  if (design.kind === 'hybrid') {
    const dynamic = phase(profilePhase(design.profiles[0], x, y, designWavelength, diameter));
    const pb = profilePhase(design.profiles[1], x, y, designWavelength, diameter);
    const base = finJones(C(0, 1), C(0, -1), pb / 2);
    return [[mul(dynamic, base[0][0]), mul(dynamic, base[0][1])], [mul(dynamic, base[1][0]), mul(dynamic, base[1][1])]];
  }
  const basis = designBasis(design), out = zeroMatrix();
  for (let j = 0; j < 2; j++) {
    const u = basis[j], z = phase(profilePhase(design.profiles[j], x, y, designWavelength, diameter));
    const q = [u.ex, u.ey];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) out[r][c] = add(out[r][c], mul(z, mul(conj(q[r]), conj(q[c]))));
  }
  return out;
}
export function applyJones(matrix: JonesMatrix, vector: JonesVector): JonesVector {
  return { ex: add(mul(matrix[0][0], vector.ex), mul(matrix[0][1], vector.ey)), ey: add(mul(matrix[1][0], vector.ex), mul(matrix[1][1], vector.ey)) };
}
export function conjVector(v: JonesVector): JonesVector { return { ex: conj(v.ex), ey: conj(v.ey) }; }
/** Complex scalar ⟨analyzer|vector⟩. */
export function projectJones(vector: JonesVector, analyzerVector: JonesVector): Complex {
  return add(mul(conj(analyzerVector.ex), vector.ex), mul(conj(analyzerVector.ey), vector.ey));
}

/** Compact deterministic 64-bit-ish content hash; includes every mask sample, independent of identity. */
export function designKey(design: DeviceDesign): string {
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  const feed = (token: string) => { for (let i = 0; i < token.length; i++) { const n = token.charCodeAt(i); h1 = Math.imul(h1 ^ n, 0x01000193); h2 = Math.imul(h2 ^ n, 0x85ebca6b); } };
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { feed('['); for (const item of value) visit(item); feed(']'); return; }
    if (value && typeof value === 'object') { feed('{'); for (const k of Object.keys(value as object).sort()) { feed(k); visit((value as Record<string, unknown>)[k]); } feed('}'); return; }
    feed(`${typeof value}:${String(value)};`);
  };
  visit(design);
  return `m2-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

const LAMS = TABLE.wavelengthsNm;
const nL = TABLE.lengthsNm.length, nW = TABLE.widthsNm.length;
const selectionCache = new Map<string, FinSelection>();
const responseCache = new Map<string, JonesMatrix>();
const candidateCache = new Map<number, Array<{ tL: Complex; tS: Complex }>>();
function cachePut<K, V>(map: Map<K, V>, key: K, value: V, max = 512): void { if (map.size >= max) map.delete(map.keys().next().value as K); map.set(key, value); }
export function librarySupport(designWavelength: number, wavelength: number, material = 'TiO2', pitchNm = 250, heightNm = 600): string | null {
  if (material !== 'TiO2') return `The response library supports TiO2, not ${material}.`;
  if (pitchNm !== TABLE.pitchNm) return `The response library uses a ${TABLE.pitchNm} nm pitch.`;
  if (heightNm !== TABLE.heightNm) return `The response library uses a ${TABLE.heightNm} nm height.`;
  for (const [label, value] of [['Design wavelength', designWavelength], ['Operating wavelength', wavelength]] as const) {
    const nm = value * 1000;
    if (!Number.isFinite(nm) || nm < LAMS[0] || nm > LAMS[LAMS.length - 1]) return `${label} must be within ${LAMS[0]}–${LAMS[LAMS.length - 1]} nm for the response library.`;
  }
  return null;
}

function interp(g: number, wavelengthNm: number): { tL: Complex; tS: Complex } {
  let lo = 0; while (lo < LAMS.length - 2 && LAMS[lo + 1] < wavelengthNm) lo++;
  const u = (wavelengthNm - LAMS[lo]) / (LAMS[lo + 1] - LAMS[lo]);
  const i = lo * nL * nW + g, j = (lo + 1) * nL * nW + g;
  const pair = (re: readonly number[], im: readonly number[]): Complex => C(re[i] * (1 - u) + re[j] * u, im[i] * (1 - u) + im[j] * u);
  return { tL: pair(TABLE.longRe, TABLE.longIm), tS: pair(TABLE.shortRe, TABLE.shortIm) };
}
function matrixEntries(angle: number, tL: Complex, tS: Complex): JonesMatrix { return finJones(tL, tS, angle); }
function frobenius2(a: JonesMatrix, b: JonesMatrix): number { let s = 0; for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) { const d = C(a[r][c].re - b[r][c].re, a[r][c].im - b[r][c].im); s += mag2(d); } return s; }
export function selectFin(target: JonesMatrix, designWavelength: number): FinSelection {
  const unsupported = librarySupport(designWavelength, designWavelength);
  if (unsupported) throw new RangeError(unsupported);
  const key = `${designWavelength}|${target.flat(2).map(z => `${z.re},${z.im}`).join(';')}`;
  const cached = selectionCache.get(key); if (cached) return cached;
  const nm = designWavelength * 1000;
  let best: FinSelection = { index: 0, lengthNm: TABLE.lengthsNm[0], widthNm: TABLE.widthsNm[0], angle: 0, error: Infinity };
  let candidates = candidateCache.get(nm);
  if (!candidates) {
    candidates = Array.from({ length: nL * nW }, (_, g) => interp(g, nm));
    cachePut(candidateCache, nm, candidates, 64);
  }
  for (let g = 0; g < nL * nW; g++) {
    const { tL, tS } = candidates[g];
    // For each pair of complex axis transmissions, project the full target onto
    // the rotated diagonal-fin family. Both axis assignments are represented by
    // theta and theta + pi/2; the Frobenius objective includes nonsymmetric terms.
    const d = scale(C(tL.re - tS.re, tL.im - tS.im), 0.5);
    const anisoX = C(target[0][0].re - target[1][1].re, target[0][0].im - target[1][1].im);
    const anisoY = add(target[0][1], target[1][0]);
    const dotX = (d.re * anisoX.re + d.im * anisoX.im);
    const dotY = d.re * anisoY.re + d.im * anisoY.im;
    const theta = 0.5 * Math.atan2(dotY, dotX);
    const candidate = matrixEntries(theta, tL, tS);
    const err = frobenius2(target, candidate);
    if (err < best.error * best.error) best = { index: g, lengthNm: TABLE.lengthsNm[Math.floor(g / nW)], widthNm: TABLE.widthsNm[g % nW], angle: theta, error: Math.sqrt(err) };
  }
  cachePut(selectionCache, key, best, 32768); return best;
}
export function finMatrix(selection: FinSelection, wavelength: number): JonesMatrix {
  const nm = wavelength * 1000;
  if (!Number.isFinite(nm) || nm < LAMS[0] || nm > LAMS[LAMS.length - 1]) throw new RangeError(`Wavelength must be within ${LAMS[0]}–${LAMS[LAMS.length - 1]} nm for the fin response table.`);
  const key = `${selection.index}|${selection.angle}|${nm}`;
  const got = responseCache.get(key); if (got) return got;
  const { tL, tS } = interp(selection.index, nm), value = finJones(tL, tS, selection.angle);
  cachePut(responseCache, key, value, 32768); return value;
}
export function designCell(design: Exclude<DeviceDesign, { kind: 'legacy' }>, x: number, y: number, designWavelength: number, diameter: number, wavelength: number, response: ResponseModel): { target: JonesMatrix; matrix: JonesMatrix; fin: FinSelection } {
  const target = targetJones(design, x, y, designWavelength, diameter);
  const fin = selectFin(target, designWavelength);
  const matrix = response === 'ideal' ? target : finMatrix(fin, wavelength);
  return { target, matrix, fin };
}
