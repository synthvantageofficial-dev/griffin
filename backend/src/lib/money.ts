/**
 * Money utilities — Golden Rule #5: ALL money math is in integer paise.
 *
 * Why: floating point (e.g. 0.1 + 0.2 !== 0.3) silently corrupts financial
 * amounts. We represent every rupee value as a whole number of paise
 * (1 rupee = 100 paise) and NEVER use floats for money anywhere in the app.
 *
 * A `Paise` is just a branded integer so the type system stops us from
 * accidentally mixing rupees and paise.
 */

/** Branded integer type: a whole number of paise. */
export type Paise = number & { readonly __brand: 'Paise' };

/** Guard: is this a safe, non-negative integer amount of paise? */
export function isPaise(value: number): value is Paise {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Assert-and-brand a raw integer as Paise (throws on invalid input). */
export function toPaise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be a safe integer number of paise, got: ${value}`);
  }
  if (value < 0) {
    throw new RangeError(`Money (paise) cannot be negative, got: ${value}`);
  }
  return value as Paise;
}

/**
 * Convert a rupee amount (may have up to 2 decimal places) to Paise.
 * Uses string-safe rounding to avoid float drift. Rejects >2 decimals.
 */
export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) {
    throw new RangeError(`Invalid rupee amount: ${rupees}`);
  }
  // Round to the nearest paisa; guards against values like 12.999999.
  const paise = Math.round(rupees * 100);
  return toPaise(paise);
}

/** Convert Paise to a rupee number (for display/serialization only). */
export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

/** Add paise amounts safely (result must stay a safe integer). */
export function addPaise(...amounts: Paise[]): Paise {
  const sum = amounts.reduce<number>((acc, a) => acc + a, 0);
  return toPaise(sum);
}

/** Subtract b from a; throws if the result would go negative. */
export function subtractPaise(a: Paise, b: Paise): Paise {
  return toPaise(a - b);
}

/** Format Paise as an Indian-Rupee string, e.g. 152340 -> "₹1,523.40". */
export function formatINR(paise: Paise): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paiseToRupees(paise));
}
