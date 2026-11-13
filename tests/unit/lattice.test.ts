import { describe, expect, it } from 'vitest';
import { latticePositions } from '@/components/viewer/NanostructureLattice';

describe('lattice aperture', () => {
  it('adds fixed-pitch nanostructures as the circular aperture grows', () => {
    const small = latticePositions(15, 0.4);
    const large = latticePositions(50, 0.4);
    const largePositions = new Set(large.map(([x, y]) => `${x},${y}`));
    expect(large.length).toBeGreaterThan(small.length * 10);
    expect(small.every(([x, y]) => largePositions.has(`${x},${y}`))).toBe(true);
    expect(large.every(([x, y]) => x * x + y * y <= 25 * 25)).toBe(true);
    expect(large.length).toBeLessThan(127 * 127);
  });
});

describe('PB nanofin lattice', () => {
  it('uses one fin geometry rotated by half the target phase', async () => {
    const { latticeFinGeometry } = await import('@/components/viewer/NanostructureLattice');
    const { opticsStore } = await import('@/lib/store/useOpticsStore');
    const state = { ...opticsStore.getState(), phaseMechanism: 'pb' as const };
    const fins = [[0, 0], [3, 1], [-5, 4]].map(([x, y]) => latticeFinGeometry(state, x, y));
    for (const fin of fins) {
      expect(fin.lengthNm).toBe(fins[0].lengthNm);
      expect(fin.widthNm).toBe(fins[0].widthNm);
      expect(fin.angle).toBeGreaterThanOrEqual(0);
      expect(fin.angle).toBeLessThan(Math.PI);
      expect(Math.cos(2 * fin.angle)).toBeCloseTo(Math.cos(fin.targetPhase), 10);
      expect(Math.sin(2 * fin.angle)).toBeCloseTo(Math.sin(fin.targetPhase), 10);
    }
  });
});
