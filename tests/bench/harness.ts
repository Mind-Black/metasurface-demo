import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll } from 'vitest';

export type Timings = Record<string, number>;

const results: Timings = {};

/** Median wall time of `fn` in milliseconds after `warmup` discarded runs. */
export function measure(name: string, fn: () => void, runs = 5, warmup = 1): number {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  results[name] = Math.round(median * 100) / 100;
  return median;
}

/** Prints a table, writes tests/bench/latest.json, and compares with tests/bench/baseline.json when present. */
export function reportAtEnd(): void {
  afterAll(() => {
    const baselinePath = new URL('./baseline.json', import.meta.url);
    const baseline: Timings = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
    writeFileSync(new URL('./latest.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
    const rows = Object.entries(results).map(([name, ms]) => {
      const base = baseline[name];
      const delta = base ? `${(base / ms).toFixed(2)}x vs baseline ${base} ms` : 'no baseline';
      return `${name.padEnd(46)} ${String(ms).padStart(9)} ms   ${delta}`;
    });
    console.log('\n' + rows.join('\n') + '\n');
  });
}
