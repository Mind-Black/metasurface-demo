export interface MaterialDispersion {
  getRefractiveIndex(wavelengthNm: number): { n: number; k: number };
}

/**
 * Amorphous ALD TiO2: the Devore rutile dispersion scaled so n(633 nm) = 2.41, a measured ALD
 * value. ALD index depends on process (reports span roughly 2.1-2.7), so this is representative,
 * not a specific film. The absorption tail is an illustrative Urbach edge, not fitted data.
 * Keep in sync with tools/rcwa/generate_unit_cell_table.py.
 */
export const TiO2_Dispersion: MaterialDispersion = {
  getRefractiveIndex(lambdaNm: number): { n: number; k: number } {
    const lamUm = Math.max(0.35, lambdaNm / 1000.0);
    const rutile2 = 5.913 + 0.2441 / (lamUm * lamUm - 0.0803);
    const n = Math.sqrt(1 + 0.847 * (rutile2 - 1));
    const k = 0.08 * Math.exp(-(lamUm - 0.38) / 0.02);
    return { n, k };
  }
};

/**
 * Sellmeier equation for crystalline/amorphous Silicon in NIR.
 * High refractive index (n ~ 3.5) with minimal absorption above 1100 nm,
 * but strong interband absorption in the visible range.
 */
export const Silicon_Dispersion: MaterialDispersion = {
  getRefractiveIndex(lambdaNm: number): { n: number; k: number } {
    const lamUm = Math.max(0.4, lambdaNm / 1000.0);
    const lam2 = lamUm * lamUm;
    const d1 = lam2 - 0.301516485 ** 2;
    const d2 = lam2 - 1.13475115 ** 2;
    const d3 = lam2 - 1104.0 ** 2;

    const t1 = Math.abs(d1) > 1e-6 ? (10.6684293 * lam2) / d1 : 0;
    const t2 = Math.abs(d2) > 1e-6 ? (0.0030434748 * lam2) / d2 : 0;
    const t3 = Math.abs(d3) > 1e-6 ? (1.54133408 * lam2) / d3 : 0;

    const n = Math.sqrt(Math.max(1.0, 1 + t1 + t2 + t3));
    // High loss in visible (< 800 nm), transparent in NIR
    const k = lamUm < 0.8 ? 0.5 * Math.exp(-(lamUm - 0.5) / 0.1) : 0.00001;
    return { n, k };
  }
};

/**
 * Malitson Sellmeier model for fused silica (SiO2) substrate.
 * n ~ 1.45 across the visible-to-NIR spectrum.
 */
export const SiO2_Dispersion: MaterialDispersion = {
  getRefractiveIndex(lambdaNm: number): { n: number; k: number } {
    const lamUm = Math.max(0.2, lambdaNm / 1000.0);
    const lam2 = lamUm * lamUm;
    const n2 = 1.0 +
      (0.6961663 * lam2) / (lam2 - 0.0684043 ** 2) +
      (0.4079426 * lam2) / (lam2 - 0.1162414 ** 2) +
      (0.8974794 * lam2) / (lam2 - 9.896161 ** 2);
    const n = Math.sqrt(Math.max(1.0, n2));
    return { n, k: 0.0 };
  }
};
