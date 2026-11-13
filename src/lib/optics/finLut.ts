import { FIN_CELL_TABLE as TABLE } from './finCellTable';
import type { Complex } from './polarization';

export interface FinResponse {
  lengthNm: number;
  widthNm: number;
  tL: Complex;   // long-axis transmission
  tS: Complex;   // short-axis transmission
  c: Complex;    // (tL + tS)/2: co-polarized leakage amplitude
  d: Complex;    // (tL − tS)/2: helicity-converted (PB) amplitude
}

const nL = TABLE.lengthsNm.length;
const nW = TABLE.widthsNm.length;
const designs = new Map<number, number>();
const responses = new Map<string, FinResponse>();

/** Fin `g` (index l * nW + k) at wavelength λ [nm], linear in λ between table rows, clamped at the ends. */
function finAt(g: number, wavelengthNm: number): { tL: Complex; tS: Complex } {
  const lams = TABLE.wavelengthsNm;
  const clamped = Math.max(lams[0], Math.min(lams[lams.length - 1], wavelengthNm));
  let w = 0;
  while (w < lams.length - 2 && lams[w + 1] < clamped) w++;
  const u = (clamped - lams[w]) / (lams[w + 1] - lams[w]);
  const a = w * nL * nW + g;
  const b = (w + 1) * nL * nW + g;
  const mix = (src: readonly number[]) => (1 - u) * src[a] + u * src[b];
  return {
    tL: { re: mix(TABLE.longRe), im: mix(TABLE.longIm) },
    tS: { re: mix(TABLE.shortRe), im: mix(TABLE.shortIm) },
  };
}

/** The tabulated fin with the highest helicity conversion |d|² at the design wavelength. */
function designFin(designWavelengthNm: number): number {
  let best = designs.get(designWavelengthNm);
  if (best !== undefined) return best;
  best = 0;
  let value = -1;
  for (let g = 0; g < nL * nW; g++) {
    const { tL, tS } = finAt(g, designWavelengthNm);
    const v = (tL.re - tS.re) ** 2 + (tL.im - tS.im) ** 2;
    if (v > value) { value = v; best = g; }
  }
  designs.set(designWavelengthNm, best);
  return best;
}

/** Response at λ of the fin chosen for the design wavelength λ₀ (both in µm). */
export function pbResponse(designWavelengthUm: number, wavelengthUm: number): FinResponse {
  const key = `${designWavelengthUm}|${wavelengthUm}`;
  let result = responses.get(key);
  if (result) return result;
  const g = designFin(Math.round(designWavelengthUm * 1000));
  const { tL, tS } = finAt(g, wavelengthUm * 1000);
  result = {
    lengthNm: TABLE.lengthsNm[Math.floor(g / nW)],
    widthNm: TABLE.widthsNm[g % nW],
    tL, tS,
    c: { re: (tL.re + tS.re) / 2, im: (tL.im + tS.im) / 2 },
    d: { re: (tL.re - tS.re) / 2, im: (tL.im - tS.im) / 2 },
  };
  if (responses.size >= 128) responses.clear();
  responses.set(key, result);
  return result;
}

export const FIN_HEIGHT_NM = TABLE.heightNm;
export const FIN_TABLE_SIZE = { lengths: TABLE.lengthsNm, widths: TABLE.widthsNm, wavelengths: TABLE.wavelengthsNm };
