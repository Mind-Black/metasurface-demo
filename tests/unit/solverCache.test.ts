import { describe, expect, it } from 'vitest';
import type { FarFieldInput } from '@/lib/optics/farField';
import { deviceKey, deviceSpectrum } from '@/lib/optics/propagation';
import { generateTargetBitmap, runGerchbergSaxton } from '@/lib/optics/gerchbergSaxton';
import { opticsStore } from '@/lib/store/useOpticsStore';
import { xyFieldRequest } from '@/components/viewer/XYProfileCanvas';
import { xzFieldRequest } from '@/components/viewer/WavefieldCanvas';

const base: FarFieldInput = {
  wavelength: 0.532, designWavelength: 0.532, focalLength: 25, diameter: 12, deflectionAngle: 0.35,
  topologicalCharge: 1, lens: true, deflect: false, vortex: false, hologram: false,
};
const mask = runGerchbergSaxton(generateTargetBitmap('crest'), 5).phaseMask;
const holo: FarFieldInput = { ...base, lens: false, hologram: true, cghPhaseMask: mask };

describe('device key and spectrum cache', () => {
  it('is stable across structuredClone, as happens through postMessage', () => {
    expect(deviceKey(structuredClone(holo))).toBe(deviceKey(holo));
  });

  it('changes when one mask element changes', () => {
    const edited = structuredClone(holo);
    edited.cghPhaseMask![3][4] += 1e-6;
    expect(deviceKey(edited)).not.toBe(deviceKey(holo));
  });

  it('ignores the mask outside hologram mode', () => {
    expect(deviceKey({ ...base, cghPhaseMask: mask })).toBe(deviceKey(base));
  });

  it('serves a cloned hologram from the cache', () => {
    const first = deviceSpectrum(holo);
    expect(deviceSpectrum(structuredClone(holo))).toBe(first);
  });

  it('keeps two devices cached so A, B, A hits, and evicts on a third', () => {
    const a = { ...base, focalLength: 20 };
    const b = { ...base, focalLength: 30 };
    const c = { ...base, focalLength: 40 };
    const sa = deviceSpectrum(a);
    const sb = deviceSpectrum(b);
    expect(deviceSpectrum(a)).toBe(sa);
    expect(deviceSpectrum(b)).toBe(sb);
    deviceSpectrum(c);
    expect(deviceSpectrum(b)).toBe(sb);
    expect(deviceSpectrum(a)).not.toBe(sa);
  }, 60000);
});

describe('field requests for hidden or degenerate panels', () => {
  const state = opticsStore.getState();

  it('returns null for zero-sized panels', () => {
    expect(xyFieldRequest(state, 0, 0)).toBeNull();
    expect(xyFieldRequest(state, 300, 0)).toBeNull();
    expect(xzFieldRequest(state, 0, 0)).toBeNull();
    expect(xzFieldRequest(state, 0, 200)).toBeNull();
  });

  it('produces finite windows at phone and extreme aspect ratios', () => {
    for (const [w, h] of [[390, 320], [1920, 200], [200, 1200], [1, 1]] as const) {
      for (const request of [xyFieldRequest(state, w, h), xzFieldRequest(state, w, h)]) {
        expect(request).not.toBeNull();
        for (const v of [request!.halfX, request!.halfV, request!.nx, request!.nv]) expect(Number.isFinite(v)).toBe(true);
        expect(request!.nx).toBeGreaterThan(0);
        expect(request!.nv).toBeGreaterThan(0);
      }
    }
  });
});
