// Money, in one place.
//
// `amount` is a Postgres double, and that is a deliberate choice rather than an
// oversight: at household magnitudes the representation error is around 1e-6 rupees, so
// nothing anyone can spend is mis-totalled. Decimal would be right for a ledger and
// would cost a Decimal.js value at every read and write of every amount, which is not a
// price worth paying to fix an error smaller than a paisa.
//
// What Float genuinely does do is surface artefacts: sum enough of them and you get
// 45200.000000001, which in a downloaded file looks like the app cannot add up. So
// every amount that reaches a human or a file goes through here, and there is exactly
// one answer to "how does this round".

/** Two decimal places, the smallest unit anyone actually pays in. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Adds amounts the way a person would.
 *
 * Rounds once at the end rather than per item — rounding each term first would let a
 * hundred half-paise become half a rupee of drift in the total.
 */
export function sumAmounts(values: (number | null | undefined)[]): number {
  let total = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return round2(total);
}

/**
 * `₹45,200` / `₹45,200.50`.
 *
 * Paise are shown only when there are any: a list of round figures reads far better
 * without a column of `.00`, and when a bill genuinely is ₹1,234.56 that matters and
 * gets shown.
 */
export function formatINR(value: number | null | undefined): string {
  const n = round2(typeof value === "number" && Number.isFinite(value) ? value : 0);
  const hasPaise = Math.abs(n % 1) > 0.0001;
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A percentage change, or null when there is nothing meaningful to compare against.
 *
 * Null rather than 0 or Infinity for a zero baseline on purpose: "up from nothing" is
 * not a percentage, and the caller has to decide how to say that. Returning a number
 * here is how "∞% higher than average" reaches a screen.
 */
export function percentChange(current: number, baseline: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null;
  if (baseline <= 0) return null;
  return Math.round(((current - baseline) / baseline) * 100);
}
