import { describe, it, expect } from 'vitest';
import { TiO2_Dispersion, Silicon_Dispersion, SiO2_Dispersion } from '@/lib/optics/materials';
import {
  getMetalensTargetPhase,
  getBeamDeflectorPhase,
  getVortexBeamPhase,
  calculateNumericalAperture,
  calculateAbbeLimit,
  calculateChromaticFocalShift,
  calculateDeflectionAngle,
  getPBRotationAngle,
  estimateDemonstrationMaxIntensity,
  getDemonstrationIntensityScale,
  formatIntensityValue
} from '@/lib/optics/phaseProfiles';
import { queryUnitCellLUT, targetPhaseToDiameter } from '@/lib/optics/rcwaLut';
import { runGerchbergSaxton, generateTargetBitmap } from '@/lib/optics/gerchbergSaxton';

describe('Benchmark 1: Metalens Focal Spot & NA Mechanics', () => {
  it('calculates numerical aperture and diffraction-limited Abbe spot correctly', () => {
    const lambda = 0.532; // 532 nm in um
    const f = 25.0; // um
    const D = 30.0; // um

    const na = calculateNumericalAperture(D, f);
    expect(na).toBeCloseTo(0.5145, 3);

    const fwhm = calculateAbbeLimit(lambda, na);
    // Expected ~ 0.517 um (517 nm ~ 520 nm)
    expect(fwhm * 1000).toBeCloseTo(517.0, 0);

    // Hyperbolic phase profile symmetry: phi(x) == phi(-x)
    const phasePos = getMetalensTargetPhase(5.0, 0.0, lambda, f);
    const phaseNeg = getMetalensTargetPhase(-5.0, 0.0, lambda, f);
    expect(phasePos).toBeCloseTo(phaseNeg, 5);

    // Phase at center r=0 should be 0
    const phaseCenter = getMetalensTargetPhase(0.0, 0.0, lambda, f);
    expect(phaseCenter).toBeCloseTo(0.0, 5);
  });
});

describe('Benchmark 2: Chromatic Aberration & Dispersion', () => {
  it('demonstrates negative chromatic dispersion Delta f ~ -4.5 um when shifting from 532 nm to 650 nm', () => {
    const lambda0 = 0.532; // 532 nm
    const lambda1 = 0.650; // 650 nm
    const f0 = 25.0; // um

    const { operationalFocalLength, deltaFocalLength } = calculateChromaticFocalShift(
      lambda0,
      lambda1,
      f0
    );

    // Expected f(650nm) = 25 * (532 / 650) ~ 20.46 um
    expect(operationalFocalLength).toBeCloseTo(20.4615, 2);
    // Delta f ~ -4.54 um
    expect(deltaFocalLength).toBeCloseTo(-4.538, 2);
  });

  it('validates material dispersion: TiO2 transparent in visible, Si transparent in NIR', () => {
    const tio2_vis = TiO2_Dispersion.getRefractiveIndex(532);
    expect(tio2_vis.n).toBeGreaterThan(2.3);
    expect(tio2_vis.n).toBeLessThan(2.7);
    expect(tio2_vis.k).toBeLessThan(0.001); // Negligible absorption in visible

    const si_nir = Silicon_Dispersion.getRefractiveIndex(1550);
    expect(si_nir.n).toBeGreaterThan(3.4);
    expect(si_nir.n).toBeLessThan(3.6);
    expect(si_nir.k).toBeLessThan(0.001); // Low loss in NIR

    const si_vis = Silicon_Dispersion.getRefractiveIndex(532);
    expect(si_vis.k).toBeGreaterThan(0.1); // High interband loss in visible
  });
});

describe("Benchmark 3: Generalized Snell's Law & Anomalous Refraction", () => {
  it('computes anomalous deflection angle of 20.76 degrees for dphi/dx = 2pi / 1.5 um at lambda = 532 nm', () => {
    const lambda = 0.532;
    const gradientPeriod = 1.5; // um
    const phaseGradientX = (2 * Math.PI) / gradientPeriod; // rad/um

    const thetaRad = calculateDeflectionAngle(lambda, phaseGradientX);
    const thetaDeg = (thetaRad * 180) / Math.PI;

    // Expected arcsin(0.532 / 1.5) = 20.77 degrees (approx 20.76 deg in spec table)
    expect(thetaDeg).toBeCloseTo(20.77, 1);
  });

  it('handles supercritical phase gradient (momentum bounds exceeded)', () => {
    const lambda = 0.532;
    const gradientPeriod = 0.4; // 0.4 um < 0.532 um -> sin(theta) > 1
    const phaseGradientX = (2 * Math.PI) / gradientPeriod;

    const thetaRad = calculateDeflectionAngle(lambda, phaseGradientX);
    expect(Number.isNaN(thetaRad)).toBe(true);
  });
});

describe('Benchmark 4: Vortex Beam & Topological Charge', () => {
  it('verifies 2pi phase accumulation around center for topological charge ell = 1', () => {
    const phaseRight = getVortexBeamPhase(1, 0, 1); // theta = 0
    const phaseTop = getVortexBeamPhase(0, 1, 1);   // theta = pi/2
    const phaseLeft = getVortexBeamPhase(-1, 0, 1); // theta = pi
    const phaseBottom = getVortexBeamPhase(0, -1, 1); // theta = -pi/2 -> 3pi/2

    expect(phaseRight).toBeCloseTo(0, 4);
    expect(phaseTop).toBeCloseTo(Math.PI / 2, 4);
    expect(phaseLeft).toBeCloseTo(Math.PI, 4);
    expect(phaseBottom).toBeCloseTo((3 * Math.PI) / 2, 4);
  });

  it('verifies Pancharatnam-Berry rotation mapping phi_PB = 2 * theta', () => {
    const targetPhase = Math.PI; // 180 deg
    const rot = getPBRotationAngle(targetPhase, 1);
    expect(rot).toBeCloseTo(Math.PI / 2, 4); // 90 deg rotation gives 180 deg PB phase
  });
});

describe('Benchmark 5: Nanofabrication Constraints & Aspect Ratio Alarms', () => {
  it('triggers aspect ratio collapse warning for h = 800 nm, d = 70 nm (AR = 11.4:1 > 10:1)', () => {
    const res = queryUnitCellLUT(70, 532, 800, 400, 'TiO2');
    expect(res.aspectRatio).toBeCloseTo(11.43, 1);
    expect(res.fabFeasible).toBe(false);
    expect(res.fabWarning).toBeDefined();
    expect(res.fabWarning).toContain('Aspect ratio 11.4:1 exceeds nanofab collapse limit');
  });

  it('triggers gap resolution warning when inter-pillar spacing < 40 nm', () => {
    const res = queryUnitCellLUT(370, 532, 600, 400, 'TiO2');
    expect(res.fabFeasible).toBe(false);
    expect(res.fabWarning).toContain('Inter-pillar gap (30 nm) below critical lithography resolution');
  });

  it('confirms feasible unit cell for standard nominal design (d = 180 nm, h = 600 nm, p = 400 nm)', () => {
    const res = queryUnitCellLUT(180, 532, 600, 400, 'TiO2');
    expect(res.fabFeasible).toBe(true);
    expect(res.aspectRatio).toBeLessThan(10);
    expect(res.transmission).toBeGreaterThan(0.6);
  });
});

describe('Computer-Generated Holography (Gerchberg-Saxton)', () => {
  it('converges target bitmap into phase mask with diminishing error', () => {
    const target = generateTargetBitmap('crest', 16);
    const result = runGerchbergSaxton(target, 5);

    expect(result.phaseMask.length).toBe(16);
    expect(result.reconstructed.length).toBe(16);
    expect(result.rmse).toBeLessThan(1.0);
  });
});

describe('Edge Cases, Extreme Parameters & Boundary Diagnostics', () => {
  it('handles high NA approaching theoretical paraxial breakdown (NA > 0.9)', () => {
    // D = 45 um, f = 10 um -> NA = sin(atan(45 / 20)) = sin(atan(2.25)) = 2.25 / sqrt(1 + 2.25^2) ~ 0.9138
    const na = calculateNumericalAperture(45, 10);
    expect(na).toBeGreaterThan(0.9);
    expect(na).toBeLessThan(1.0);

    const fwhmNm = calculateAbbeLimit(0.532, na) * 1000;
    // For NA ~ 0.9138, FWHM = 532 / (2 * 0.9138) ~ 291 nm
    expect(fwhmNm).toBeCloseTo(291.0, 0);
  });

  it('handles negative deflection angles symmetrically', () => {
    const lambda = 0.532;
    const gradientPeriod = -1.5; // Negative gradient
    const phaseGradientX = (2 * Math.PI) / gradientPeriod;
    const thetaRad = calculateDeflectionAngle(lambda, phaseGradientX);
    const thetaDeg = (thetaRad * 180) / Math.PI;

    expect(thetaDeg).toBeCloseTo(-20.77, 1);
  });

  it('handles zero topological charge (ell = 0) as planar/constant phase', () => {
    const phase1 = getVortexBeamPhase(2, 3, 0);
    const phase2 = getVortexBeamPhase(-4, -1, 0);
    expect(phase1).toBe(0);
    expect(phase2).toBe(0);
  });

  it('detects exact aspect ratio limit boundary (AR = 10.0 feasible vs 10.05 failure)', () => {
    const resSafe = queryUnitCellLUT(60, 532, 600, 400, 'TiO2'); // AR = 600 / 60 = 10.0
    expect(resSafe.aspectRatio).toBe(10.0);
    expect(resSafe.fabFeasible).toBe(true);

    const resFail = queryUnitCellLUT(59, 532, 600, 400, 'TiO2'); // AR = 600 / 59 = 10.169 > 10.0
    expect(resFail.aspectRatio).toBeGreaterThan(10.0);
    expect(resFail.fabFeasible).toBe(false);
  });

  it('validates material dispersion at extreme wavelengths without NaN or infinities', () => {
    const tio2_uv = TiO2_Dispersion.getRefractiveIndex(360);
    expect(Number.isFinite(tio2_uv.n)).toBe(true);
    expect(Number.isFinite(tio2_uv.k)).toBe(true);
    expect(tio2_uv.k).toBeGreaterThan(0.01); // UV absorption

    const si_mir = Silicon_Dispersion.getRefractiveIndex(1600);
    expect(Number.isFinite(si_mir.n)).toBe(true);
    expect(Number.isFinite(si_mir.k)).toBe(true);
    expect(si_mir.n).toBeGreaterThan(3.4);

    const sio2 = SiO2_Dispersion.getRefractiveIndex(532);
    expect(sio2.n).toBeCloseTo(1.46, 1);
  });
});

describe('Dynamic Intensity Range Scaling Across Demonstrations', () => {
  it('correctly calculates actual peak intensities across different optical demonstrations', () => {
    const metalensMax = estimateDemonstrationMaxIntensity({ deviceType: 'metalens' });
    expect(metalensMax).toBeGreaterThan(3.0);
    expect(metalensMax).toBeLessThan(7.0);

    const deflectorMax = estimateDemonstrationMaxIntensity({ deviceType: 'deflector' });
    expect(deflectorMax).toBeGreaterThan(0.05);
    expect(deflectorMax).toBeLessThan(0.3);

    const vortexMax = estimateDemonstrationMaxIntensity({ deviceType: 'vortex' });
    expect(vortexMax).toBeGreaterThan(0.04);
    expect(vortexMax).toBeLessThan(0.25);

    const hologramMax = estimateDemonstrationMaxIntensity({ deviceType: 'hologram' });
    expect(hologramMax).toBeGreaterThan(0.1);
    expect(hologramMax).toBeLessThan(0.6);
  });

  it('guarantees constant number of ticks (100) while dynamically scaling the range', () => {
    const devices = ['metalens', 'deflector', 'vortex', 'hologram'] as const;

    for (const device of devices) {
      const scale = getDemonstrationIntensityScale({ deviceType: device });
      expect(scale.ticks).toBe(100);
      expect(scale.min).toBeLessThan(scale.nominalPeak);
      expect(scale.max).toBeGreaterThan(scale.nominalPeak);

      // Verify exact 100 ticks step relationship
      const numSteps = (scale.max - scale.min) / scale.step;
      expect(numSteps).toBeCloseTo(100, 3);
    }
  });

  it('prevents low-intensity demonstrations from being invisible by scaling ranges appropriately', () => {
    const deflectorScale = getDemonstrationIntensityScale({ deviceType: 'deflector' });
    // In deflector, max should be well below 1.0 (around 0.24) so it is not pushed to the first tick of a 25.0 range
    expect(deflectorScale.max).toBeLessThan(0.5);
    expect(deflectorScale.min).toBeLessThan(0.02);

    const vortexScale = getDemonstrationIntensityScale({ deviceType: 'vortex' });
    expect(vortexScale.max).toBeLessThan(0.5);
    expect(vortexScale.min).toBeLessThan(0.02);
  });

  it('formats intensity readouts cleanly with scale-appropriate precision', () => {
    expect(formatIntensityValue(150)).toBe('150');
    expect(formatIntensityValue(12.345)).toBe('12.3');
    expect(formatIntensityValue(4.607)).toBe('4.61');
    expect(formatIntensityValue(0.1154)).toBe('0.115');
    expect(formatIntensityValue(0.00578)).toBe('0.0058');
  });
});

