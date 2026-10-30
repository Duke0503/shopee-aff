/**
 * The headline cashback share: how much of a net commission a customer
 * receives. Read from the environment with the agreed default, so every caller
 * that needs the rate agrees on it.
 */
export function cashbackRate(): number {
  return Number(process.env.CASHBACK_RATE ?? 0.8);
}
