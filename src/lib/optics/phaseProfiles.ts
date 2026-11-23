/**
 * Hyperbolic focusing phase profile for a spherical aberration-free metalens.
 * phi(r) = -k0 * (sqrt(r^2 + f^2) - f)
 * @param x Lateral coordinate in micrometers
 * @param y Lateral coordinate in micrometers
 * @param wavelength Free-space wavelength in micrometers
 * @param focalLength Design focal length in micrometers
 * @returns Wrapped phase shift in radians [0, 2pi)
 */
export function getMetalensTargetPhase(
  x: number,
  y: number,
  wavelength: number,
  focalLength: number
): number {
  if (focalLength === 0) return 0;
  const r2 = x * x + y * y;
  const k0 = (2 * Math.PI) / wavelength;
  const sign = Math.sign(focalLength);
  const phase = -sign * k0 * (Math.sqrt(r2 + focalLength * focalLength) - Math.abs(focalLength));
  return ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Linear phase gradient profile for anomalous beam deflection.
 * Generalized Snell's law: n_t sin(theta_t) - n_i sin(theta_i) = (lambda / 2pi) * dphi/dx
 * @param x Lateral position in micrometers
 * @param wavelength Free-space wavelength in micrometers
 * @param deflectionAngleRad Target deflection angle in radians
 * @returns Wrapped phase shift in radians [0, 2pi)
 */
export function getBeamDeflectorPhase(
  x: number,
  wavelength: number,
  deflectionAngleRad: number
): number {
  const k0 = (2 * Math.PI) / wavelength;
  const phase = k0 * Math.sin(deflectionAngleRad) * x;
  return ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Spiral phase plate profile for optical vortex beam generation.
 * Imparts orbital angular momentum (OAM) of L = ell * hbar per photon.
 * phi(r, theta) = ell * theta
 * @param x Lateral coordinate in micrometers
 * @param y Lateral coordinate in micrometers
 * @param topologicalCharge Integer orbital charge ell
 * @returns Wrapped phase shift in radians [0, 2pi)
 */
export function getVortexBeamPhase(
  x: number,
  y: number,
  topologicalCharge: number
): number {
  const theta = Math.atan2(y, x);
  const phase = topologicalCharge * theta;
  return ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Conical (linear radial) phase profile for an optical axicon generating a Bessel beam.
 * phi(r) = -k0 * r * NA_0, where NA_0 = sin(theta_a) is the design numerical aperture.
 * Positive NA converges rays inward toward the optical axis; negative NA diverges outward.
 * @param x Lateral coordinate in micrometers
 * @param y Lateral coordinate in micrometers
 * @param wavelength Free-space design wavelength in micrometers
 * @param axiconNA Design numerical aperture sin(theta_a) (dimensionless, |NA| < 1)
 * @returns Wrapped phase shift in radians [0, 2pi)
 */
export function getAxiconTargetPhase(
  x: number,
  y: number,
  wavelength: number,
  axiconNA: number
): number {
  const r = Math.hypot(x, y);
  const k0 = (2 * Math.PI) / wavelength;
  const phase = -k0 * r * axiconNA;
  return ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Pancharatnam-Berry (PB) / Geometric Phase.
 * The cross-polarized output carries phase phi = 2 * sigma * theta, where theta is the in-plane rotation
 * angle of the nanofin and sigma = +1 for RCP input, -1 for LCP input (conventions in ./polarization.ts).
 */
export function getPBRotationAngle(targetPhase: number, helicity: 1 | -1 = 1): number {
  const theta = (helicity * targetPhase) / 2;
  return ((theta % Math.PI) + Math.PI) % Math.PI;
}

/**
 * Computes Numerical Aperture: NA = sin(arctan(D / (2 * f)))
 */
export function calculateNumericalAperture(diameter: number, focalLength: number): number {
  if (focalLength === 0 || !Number.isFinite(focalLength) || diameter <= 0) return 0;
  const halfAngle = Math.atan(diameter / (2 * Math.abs(focalLength)));
  return Math.sin(halfAngle);
}

/**
 * Computes diffraction-limited Airy spot FWHM: FWHM = lambda / (2 * NA)
 */
export function calculateAbbeLimit(wavelength: number, numericalAperture: number): number {
  if (numericalAperture <= 0) return Infinity;
  return wavelength / (2 * numericalAperture);
}

/**
 * Paraxial chromatic focal shift for a single-layer diffractive/metasurface lens:
 * f(lambda) = f0 * (lambda0 / lambda). Away from lambda0 the true focus differs at finite NA.
 * Delta f = f(lambda) - f0.
 */
export function calculateChromaticFocalShift(
  designWavelength: number,
  operationalWavelength: number,
  designFocalLength: number
): { operationalFocalLength: number; deltaFocalLength: number } {
  if (operationalWavelength <= 0) {
    return { operationalFocalLength: designFocalLength, deltaFocalLength: 0 };
  }
  const operationalFocalLength = designFocalLength * (designWavelength / operationalWavelength);
  const deltaFocalLength = operationalFocalLength - designFocalLength;
  return { operationalFocalLength, deltaFocalLength };
}

/**
 * Computes anomalous refraction angle from interfacial phase gradient:
 * theta_t = arcsin((lambda / 2pi) * (dphi/dx))
 */
export function calculateDeflectionAngle(wavelength: number, phaseGradientX: number): number {
  const k0 = (2 * Math.PI) / wavelength;
  const sinTheta = phaseGradientX / k0;
  if (Math.abs(sinTheta) > 1.0) {
    return NaN; // Evanescent / momentum bound exceeded
  }
  return Math.asin(sinTheta);
}

/**
 * Computes the geometric Bessel-zone depth of focus z_max for a converging axicon:
 * z_max(lambda) = (D / 2) * sqrt(1 - sin^2(theta)) / sin(theta),
 * where sin(theta) = (lambda / lambda0) * axiconNA.
 * Returns 0 for non-converging (axiconNA <= 0) or invalid inputs, and NaN when evanescent (sin(theta) >= 1).
 */
export function calculateAxiconDepthOfFocus(
  diameter: number,
  designWavelength: number,
  operationalWavelength: number,
  axiconNA: number
): number {
  if (diameter <= 0 || designWavelength <= 0 || operationalWavelength <= 0 || axiconNA <= 0) {
    return 0;
  }
  const sinTheta = (operationalWavelength / designWavelength) * axiconNA;
  if (sinTheta >= 1.0) {
    return NaN; // Evanescent cutoff
  }
  return (diameter / 2) * Math.sqrt(1 - sinTheta * sinTheta) / sinTheta;
}

/**
 * Computes the transverse central-core FWHM of a zero-order Bessel beam J_0(k_r r),
 * where k_r = (2pi / lambda0) * |NA_0| is wavelength-invariant for a phase-gradient axicon.
 * |J_0(u0)|^2 = 0.5 at u0 ≈ 1.126365, giving FWHM = (u0 / pi) * (lambda0 / |NA_0|) ≈ 0.3585 * lambda0 / |NA_0|.
 */
export function calculateBesselSpotFWHM(designWavelength: number, axiconNA: number): number {
  if (designWavelength <= 0 || axiconNA === 0) return Infinity;
  return (1.126365 / Math.PI) * (designWavelength / Math.abs(axiconNA));
}

/**
 * Computes the radial 2pi phase period of an axicon: Lambda_r = lambda0 / |NA_0|.
 */
export function calculateAxiconPeriod(designWavelength: number, axiconNA: number): number {
  if (designWavelength <= 0 || axiconNA === 0) return Infinity;
  return designWavelength / Math.abs(axiconNA);
}

export interface IntensityScaleRange {
  nominalPeak: number;
  min: number;
  max: number;
  step: number;
  ticks: number;
}

/**
 * Slider range calibrated to the peak intensity of the solved field, with a constant
 * number of ticks across demonstrations.
 */
export function getDemonstrationIntensityScale(peak: number): IntensityScaleRange {
  const nominalPeak = Math.max(0.005, peak);
  const min = Math.max(0.001, nominalPeak * 0.05);
  const max = nominalPeak * 2.05;
  const ticks = 100;
  return { nominalPeak, min, max, step: (max - min) / ticks, ticks };
}

/**
 * Formats an intensity value with precision appropriate to its scale.
 */
export function formatIntensityValue(val: number): string {
  if (val >= 100) return val.toFixed(0);
  if (val >= 10) return val.toFixed(1);
  if (val >= 1) return val.toFixed(2);
  if (val >= 0.1) return val.toFixed(3);
  return val.toFixed(4);
}
