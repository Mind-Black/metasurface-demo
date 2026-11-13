/**
 * Polarization conventions shared by the solver, the lattice view and the UI.
 *
 * Time factor exp(-iωt), as in tools/rcwa. Jones vectors are (Ex, Ey). The circular basis is
 *   e₊ = (x̂ + iŷ)/√2,  e₋ = (x̂ − iŷ)/√2.
 * Re[e₊ exp(-iωt)] turns from x̂ towards ŷ, i.e. clockwise when viewed from the source looking along +z.
 * That is right-handed in the IEEE convention, and S₃ > 0. So here: RCP ≡ e₊ ≡ S₃ = +1, LCP ≡ e₋ ≡ S₃ = −1.
 *
 * A nanofin with long axis at angle θ to x and axis transmissions tL, tS has the Jones matrix
 * J(θ) = R(θ)·diag(tL, tS)·R(−θ). With c = (tL + tS)/2 and d = (tL − tS)/2 it acts on circular amplitudes as
 *   E₊ = c·a₊ + d·e^{−2iθ}·a₋,   E₋ = c·a₋ + d·e^{+2iθ}·a₊.
 * The PB device sets θ = φ/2, so RCP in gives LCP out carrying e^{+iφ} (the designed profile, the same sign as
 * the dynamic-phase pillars), LCP in gives RCP out carrying e^{−iφ}, and c is the unconverted leakage.
 */

export type PhaseMechanism = 'dynamic' | 'pb';
export type Analyzer = 'none' | 'rcp' | 'lcp' | 'x' | 'y';
export type Stokes = [number, number, number, number];

export interface Complex { re: number; im: number }

const SQRT1_2 = Math.SQRT1_2;
const c = (re: number, im = 0): Complex => ({ re, im });
export const cmul = (a: Complex, b: Complex): Complex => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cadd = (a: Complex, b: Complex): Complex => c(a.re + b.re, a.im + b.im);
export const cabs2 = (a: Complex): number => a.re * a.re + a.im * a.im;

/** Stokes vector of a fully polarized unit-intensity state with orientation ψ and ellipticity χ [rad]. */
export function stokesFromEllipse(psi: number, chi: number): Stokes {
  return [1, Math.cos(2 * chi) * Math.cos(2 * psi), Math.cos(2 * chi) * Math.sin(2 * psi), Math.sin(2 * chi)];
}

/** Orientation ψ ∈ (−π/2, π/2] and ellipticity χ ∈ [−π/4, π/4] of the polarized part of a Stokes vector. */
export function ellipseFromStokes(s: Stokes): { psi: number; chi: number } {
  const p = Math.hypot(s[1], s[2], s[3]);
  if (p === 0) return { psi: 0, chi: 0 };
  const chi = 0.5 * Math.asin(Math.max(-1, Math.min(1, s[3] / p)));
  let psi = 0.5 * Math.atan2(s[2], s[1]);
  if (psi <= -Math.PI / 2 + 1e-12) psi += Math.PI;
  return { psi, chi };
}

/** Unit-intensity Jones vector (Ex, Ey) of the polarized part. The global phase is fixed by real Ex ≥ 0. */
export function jonesFromStokes(s: Stokes): { ex: Complex; ey: Complex } {
  const { psi, chi } = ellipseFromStokes(s);
  const cp = Math.cos(psi), sp = Math.sin(psi), cc = Math.cos(chi), sc = Math.sin(chi);
  return { ex: c(cp * cc, -sp * sc), ey: c(sp * cc, cp * sc) };
}

export function stokesFromJones(ex: Complex, ey: Complex): Stokes {
  const xx = cabs2(ex), yy = cabs2(ey);
  // Ex* Ey
  const re = ex.re * ey.re + ex.im * ey.im;
  const im = ex.re * ey.im - ex.im * ey.re;
  return [xx + yy, xx - yy, 2 * re, 2 * im];
}

/** Circular amplitudes a± = ⟨e±|E⟩. */
export function toCircular(ex: Complex, ey: Complex): { plus: Complex; minus: Complex } {
  // a₊ = (Ex − iEy)/√2, a₋ = (Ex + iEy)/√2
  return {
    plus: c((ex.re + ey.im) * SQRT1_2, (ex.im - ey.re) * SQRT1_2),
    minus: c((ex.re - ey.im) * SQRT1_2, (ex.im + ey.re) * SQRT1_2),
  };
}

export function fromCircular(plus: Complex, minus: Complex): { ex: Complex; ey: Complex } {
  // Ex = (a₊ + a₋)/√2, Ey = i(a₊ − a₋)/√2
  return {
    ex: c((plus.re + minus.re) * SQRT1_2, (plus.im + minus.im) * SQRT1_2),
    ey: c(-(plus.im - minus.im) * SQRT1_2, (plus.re - minus.re) * SQRT1_2),
  };
}

/** Output component weights (u₊, u₋): the analyzed field is u₊E₊ + u₋E₋. */
export function analyzerWeights(analyzer: Exclude<Analyzer, 'none'>): { plus: Complex; minus: Complex } {
  switch (analyzer) {
    case 'rcp': return { plus: c(1), minus: c(0) };
    case 'lcp': return { plus: c(0), minus: c(1) };
    case 'x': return { plus: c(SQRT1_2), minus: c(SQRT1_2) };
    case 'y': return { plus: c(0, SQRT1_2), minus: c(0, -SQRT1_2) };
  }
}

/** Explicit Jones matrix [[xx, xy], [yx, yy]] of a fin rotated by θ. */
export function finJones(tL: Complex, tS: Complex, theta: number): [[Complex, Complex], [Complex, Complex]] {
  const co = Math.cos(theta), si = Math.sin(theta);
  const sum = (a: number, b: number) => c(a * tL.re + b * tS.re, a * tL.im + b * tS.im);
  return [
    [sum(co * co, si * si), sum(co * si, -co * si)],
    [sum(co * si, -co * si), sum(si * si, co * co)],
  ];
}

/**
 * Per-cell output of a device for one displayed channel:
 *   dynamic: scale · t(φ)
 *   pb:      k0 + kPlus·e^{iφ} + kMinus·e^{−iφ}
 */
export interface ChannelMix {
  scale: Complex;
  k0: Complex;
  kPlus: Complex;
  kMinus: Complex;
}

/**
 * The displayed channels for an input polarization and analyzer. Channel A is what Wave and Phase show;
 * channel B (only with analyzer 'none') is the orthogonal remainder so |A|² + |B|² is the total intensity.
 * With analyzer 'none', A = Ex and B = Ey.
 */
export function channelMixes(mechanism: PhaseMechanism, stokes: Stokes, analyzer: Analyzer,
  pb: { c: Complex; d: Complex } | null): ChannelMix[] {
  const { ex, ey } = jonesFromStokes(stokes);
  const a = toCircular(ex, ey);
  const weights = analyzer === 'none' ? [analyzerWeights('x'), analyzerWeights('y')] : [analyzerWeights(analyzer)];
  const zero = c(0);
  return weights.map((u) => {
    if (mechanism === 'dynamic' || !pb) {
      return { scale: cadd(cmul(u.plus, a.plus), cmul(u.minus, a.minus)), k0: zero, kPlus: zero, kMinus: zero };
    }
    return {
      scale: zero,
      k0: cmul(pb.c, cadd(cmul(u.plus, a.plus), cmul(u.minus, a.minus))),
      kPlus: cmul(pb.d, cmul(u.minus, a.plus)),
      kMinus: cmul(pb.d, cmul(u.plus, a.minus)),
    };
  });
}

export const mixKey = (m: ChannelMix): string =>
  [m.scale.re, m.scale.im, m.k0.re, m.k0.im, m.kPlus.re, m.kPlus.im, m.kMinus.re, m.kMinus.im].join(',');

/** Fin rotation θ ∈ [0, π) that gives the designed phase φ to RCP-in → LCP-out light. */
export function pbFinAngle(targetPhase: number): number {
  const theta = targetPhase / 2;
  return ((theta % Math.PI) + Math.PI) % Math.PI;
}
