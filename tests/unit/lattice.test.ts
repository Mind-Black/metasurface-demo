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
