/**
 * Axis ticks for a chart: clean whole steps (1, 2, 2.5 or 5 times a power of ten) from below the
 * lowest value to above the highest, zero always included, about four intervals. Geometry only:
 * the values are the server's, the ticks are where the gridlines go.
 */
const NICE = [1, 2, 2.5, 5, 10];

function niceStep(span: number, intervals: number): number {
  const raw = span / intervals;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE.find((n) => n * power >= raw) ?? 10) * power;
  return Math.max(1, Math.ceil(step));
}

export function niceTicks(values: readonly number[], intervals = 4): number[] {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  if (lo === hi) return [0, 1];
  const step = niceStep(hi - lo, intervals);
  const first = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let t = first; t < hi + step; t += step) ticks.push(t);
  return ticks;
}
