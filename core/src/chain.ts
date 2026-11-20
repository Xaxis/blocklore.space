// Consensus arithmetic the site shows beside live chain data, computed the way Bitcoin Core does
// (GetBlockSubsidy in src/validation.cpp): pure functions of the height.

export const HALVING_INTERVAL = 210_000;
export const RETARGET_INTERVAL = 2016;
const INITIAL_SUBSIDY_SATS = 5_000_000_000n;

/** The block subsidy at `height`, in sats: 50 BTC shifted right once per halving, zero from 64. */
export function subsidySats(height: number): number {
  const halvings = Math.floor(height / HALVING_INTERVAL);
  return halvings >= 64 ? 0 : Number(INITIAL_SUBSIDY_SATS >> BigInt(halvings));
}

export function nextHalvingHeight(height: number): number {
  return (Math.floor(height / HALVING_INTERVAL) + 1) * HALVING_INTERVAL;
}

/** The first height of the retarget period after the one `height` is in. */
export function nextRetargetHeight(height: number): number {
  return (Math.floor(height / RETARGET_INTERVAL) + 1) * RETARGET_INTERVAL;
}

/** Sats as BTC text with no trailing zeros: 312500000 to "3.125". */
export function btc(sats: number): string {
  const whole = Math.floor(sats / 1e8);
  const frac = String(sats % 1e8)
    .padStart(8, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
