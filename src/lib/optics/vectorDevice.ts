import type { FarFieldInput } from './farField';
import { cabs2, jonesFromStokes, type ChannelMix } from './polarization';
import { applyJones, conjVector, designBasis, designCell, designKey, librarySupport,
  projectJones, targetJones, type JonesVector } from './metasurface';

export const isVectorDevice = (p: FarFieldInput): boolean => !!p.design && p.design.kind !== 'legacy';

export function vectorDeviceKey(p: FarFieldInput): string {
  return JSON.stringify([designKey(p.design ?? { kind: 'legacy' }), p.responseModel ?? 'ideal',
    p.designWavelength, p.wavelength, p.diameter, p.material ?? 'TiO2', p.pitchNm ?? 250,
    p.heightNm ?? 600, p.stokes ?? [1, 0, 0, 1], p.analyzer ?? 'none']);
}

export function vectorChannels(p: FarFieldInput): ChannelMix[] {
  const zero = { re: 0, im: 0 };
  return (p.analyzer && p.analyzer !== 'none' ? [0] : [0, 1]).map((apertureComponent) => ({
    apertureComponent: apertureComponent as 0 | 1, scale: zero, k0: zero, kPlus: zero, kMinus: zero,
  }));
}

export function predictionSupport(p: FarFieldInput): string | null {
  return librarySupport(p.designWavelength, p.wavelength, p.material ?? 'TiO2', p.pitchNm ?? 250, p.heightNm ?? 600);
}

/** One common aperture evaluator for every propagated view. Projection is coherent. */
export function vectorSampler(p: FarFieldInput): (x: number, y: number, component: number, out: Float64Array) => void {
  const design = p.design;
  if (!design || design.kind === 'legacy') throw new Error('A two-function design is required.');
  if (p.responseModel === 'library') {
    const error = predictionSupport(p);
    if (error) throw new RangeError(error);
  }
  const input = jonesFromStokes(p.stokes ?? [1, 0, 0, 1]);
  const basis = designBasis(design);
  const analyzer = p.analyzer ?? 'none';
  let projection: JonesVector | null = null;
  if (analyzer === 'channel1' || analyzer === 'channel2') projection = conjVector(basis[analyzer === 'channel1' ? 0 : 1]);
  else if (analyzer !== 'none') {
    const s = analyzer === 'rcp' ? [1, 0, 0, 1] : analyzer === 'lcp' ? [1, 0, 0, -1]
      : analyzer === 'x' ? [1, 1, 0, 0] : [1, -1, 0, 0];
    projection = jonesFromStokes(s as [number, number, number, number]);
  }
  return (x, y, component, out) => {
    const matrix = p.responseModel === 'library'
      ? designCell(design, x, y, p.designWavelength, p.diameter, p.wavelength, 'library').matrix
      : targetJones(design, x, y, p.designWavelength, p.diameter);
    const field = applyJones(matrix, input);
    const value = projection ? projectJones(field, projection) : component === 0 ? field.ex : field.ey;
    out[0] = value.re;
    out[1] = value.im;
  };
}

export interface DeviceDiagnostics {
  transmission: number;
  leakage: [number, number];
  rmsJonesError: number;
}

/** Absolute powers for unit illumination, never derived from normalized plot brightness. */
export function vectorDiagnostics(p: FarFieldInput): DeviceDiagnostics | undefined {
  const design = p.design;
  if (!design || design.kind === 'legacy' || predictionSupport(p)) return undefined;
  const input = jonesFromStokes(p.stokes ?? [1, 0, 0, 1]);
  const basis = designBasis(design);
  const outputs = basis.map(conjVector);
  const pitch = (p.pitchNm ?? 250) / 1000;
  const radius = p.diameter / 2, limit = Math.floor(radius / pitch);
  let count = 0, transmission = 0, error = 0;
  const leakage: [number, number] = [0, 0];
  for (let iy = -limit; iy <= limit; iy++) for (let ix = -limit; ix <= limit; ix++) {
    const x = ix * pitch, y = iy * pitch;
    if (x * x + y * y > radius * radius) continue;
    const cell = designCell(design, x, y, p.designWavelength, p.diameter, p.wavelength, 'library');
    const field = applyJones(cell.matrix, input);
    transmission += cabs2(field.ex) + cabs2(field.ey);
    for (let j = 0; j < 2; j++) {
      leakage[j] += cabs2(projectJones(applyJones(cell.matrix, basis[j]), outputs[1 - j]));
      for (let k = 0; k < 2; k++) {
        const a = cell.matrix[j][k], b = cell.target[j][k];
        error += (a.re - b.re) ** 2 + (a.im - b.im) ** 2;
      }
    }
    count++;
  }
  return { transmission: transmission / count, leakage: [leakage[0] / count, leakage[1] / count],
    rmsJonesError: Math.sqrt(error / (4 * count)) };
}
