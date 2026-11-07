const TAU = 2 * Math.PI;

interface FftTables {
  rev: Uint32Array;
  /** Twiddles for the stage with half-size h live contiguously at [h, 2h): exp(-iπk/h). */
  twRe: Float64Array;
  twIm: Float64Array;
}

const tables = new Map<number, FftTables>();

function fftTables(n: number): FftTables {
  let table = tables.get(n);
  if (!table) {
    const bits = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) rev[i] = (rev[i >> 1] >> 1) | ((i & 1) << (bits - 1));
    const twRe = new Float64Array(n);
    const twIm = new Float64Array(n);
    for (let half = 1; half < n; half <<= 1) {
      const step = n / (half << 1);
      for (let k = 0; k < half; k++) {
        // Same expression as a single n-point table indexed by k * step, so the values are identical.
        twRe[half + k] = Math.cos((TAU * (k * step)) / n);
        twIm[half + k] = -Math.sin((TAU * (k * step)) / n);
      }
    }
    table = { rev, twRe, twIm };
    tables.set(n, table);
  }
  return table;
}

const gather = new Map<number, [Float64Array, Float64Array]>();

/** In-place radix-2 forward FFT over re[offset + i * stride]. */
export function fft(re: Float64Array, im: Float64Array, n: number, offset = 0, stride = 1): void {
  if (stride !== 1) {
    // Butterflies over a strided column thrash the cache; run them on a contiguous copy instead.
    let scratch = gather.get(n);
    if (!scratch) {
      scratch = [new Float64Array(n), new Float64Array(n)];
      gather.set(n, scratch);
    }
    const [sr, si] = scratch;
    for (let i = 0, at = offset; i < n; i++, at += stride) {
      sr[i] = re[at];
      si[i] = im[at];
    }
    fftContiguous(sr, si, n, 0);
    for (let i = 0, at = offset; i < n; i++, at += stride) {
      re[at] = sr[i];
      im[at] = si[i];
    }
    return;
  }
  fftContiguous(re, im, n, offset);
}

function fftContiguous(re: Float64Array, im: Float64Array, n: number, offset: number): void {
  const { rev, twRe, twIm } = fftTables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = offset + i;
      const b = offset + j;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  const end = offset + n;
  if (n < 2) return;

  // First stage: every twiddle is 1, so the butterfly needs no multiplies.
  for (let a = offset; a < end; a += 2) {
    const xr = re[a + 1];
    const xi = im[a + 1];
    re[a + 1] = re[a] - xr;
    im[a + 1] = im[a] - xi;
    re[a] += xr;
    im[a] += xi;
  }

  // Remaining stages two at a time. Stage A (half h) pairs (i0,i1) and (i2,i3); stage B (half 2h)
  // pairs (i0,i2) and (i1,i3). Doing both in registers performs exactly the arithmetic of two
  // separate passes, in the same order per element, with half the loads and stores.
  let half = 2;
  for (; half * 2 < n; half <<= 2) {
    const span = half * 4;
    for (let start = offset; start < end; start += span) {
      for (let k = 0; k < half; k++) {
        const i0 = start + k;
        const i1 = i0 + half;
        const i2 = i1 + half;
        const i3 = i2 + half;
        const war = twRe[half + k], wai = twIm[half + k];

        let xr = re[i1] * war - im[i1] * wai;
        let xi = re[i1] * wai + im[i1] * war;
        const r1 = re[i0] - xr, m1 = im[i0] - xi;
        const r0 = re[i0] + xr, m0 = im[i0] + xi;
        xr = re[i3] * war - im[i3] * wai;
        xi = re[i3] * wai + im[i3] * war;
        const r3 = re[i2] - xr, m3 = im[i2] - xi;
        const r2 = re[i2] + xr, m2 = im[i2] + xi;

        const w0r = twRe[2 * half + k], w0i = twIm[2 * half + k];
        const w1r = twRe[3 * half + k], w1i = twIm[3 * half + k];
        xr = r2 * w0r - m2 * w0i;
        xi = r2 * w0i + m2 * w0r;
        re[i2] = r0 - xr; im[i2] = m0 - xi;
        re[i0] = r0 + xr; im[i0] = m0 + xi;
        xr = r3 * w1r - m3 * w1i;
        xi = r3 * w1i + m3 * w1r;
        re[i3] = r1 - xr; im[i3] = m1 - xi;
        re[i1] = r1 + xr; im[i1] = m1 + xi;
      }
    }
  }
  // An odd number of stages leaves one single radix-2 pass.
  for (; half < n; half <<= 1) {
    const size = half << 1;
    for (let start = offset; start < end; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = twRe[half + k];
        const wi = twIm[half + k];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}
