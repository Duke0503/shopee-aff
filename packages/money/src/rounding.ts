/**
 * Rounding rules. Two functions, and they are NOT interchangeable.
 *
 * `roundDong` rounds a half UP and is the rule for money the customer sees
 * and receives. Python's own `round()` rounds a half to the nearest EVEN
 * number, which is why `legacyRoundHalfEven` exists: today's Python code
 * rounds the service fee and the withheld tax with `round()`, and the port
 * must reproduce that exactly until the owner decides otherwise.
 */

/**
 * Round to whole dong, halves upward.
 * Ports Python `round_dong()`: `int(Decimal(str(amount)).quantize(1, ROUND_HALF_UP))`.
 * The `str(amount)` step matters: it uses the shortest decimal that
 * round-trips, so `0.49999999999999994` becomes 0, not 1.
 */
export function roundDong(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundDong: expected a finite number, received ${value}`);
  }
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  if (Number.isInteger(abs)) {
    return sign * abs;
  }
  const text = abs.toString();
  if (text.includes("e") || text.includes("E")) {
    return sign * Math.floor(abs + 0.5);
  }
  const [intPart = "0", fracPart = ""] = text.split(".");
  const integer = Number(intPart);
  const firstFractionDigit = fracPart.length > 0 ? Number(fracPart[0]) : 0;
  return sign * (integer + (firstFractionDigit >= 5 ? 1 : 0));
}

/**
 * Round a half to the nearest EVEN number.
 * Ports Python's built-in `round()` exactly, as used today for the service
 * fee and the withheld tax in the commission split.
 */
export function legacyRoundHalfEven(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`legacyRoundHalfEven: expected a finite number, received ${value}`);
  }
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder > 0.5) return floor + 1;
  if (remainder < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}
