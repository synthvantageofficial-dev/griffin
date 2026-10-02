/**
 * Round-up / set-aside calculation. Pure, integer-paise.
 * CLAUDE.md §1 step 4.
 */
import { toPaise, type Paise } from '../../lib/money.js';
import type { RoundupRule } from './types.js';

/**
 * Compute how much to set aside from a single purchase.
 *
 * - `round_up_nearest`: round the purchase up to the nearest unit and set aside
 *   the difference. A purchase that is already a multiple sets aside 0.
 * - `fixed`: set aside a fixed amount, never more than the purchase itself.
 */
export function computeRoundup(purchasePaise: Paise, rule: RoundupRule): Paise {
  if (purchasePaise <= 0) return toPaise(0);

  if (rule.type === 'fixed') {
    return toPaise(Math.min(rule.amountPaise, purchasePaise));
  }

  // round_up_nearest
  const n = rule.nearestPaise;
  if (n <= 0) return toPaise(0);
  const remainder = purchasePaise % n;
  return toPaise(remainder === 0 ? 0 : n - remainder);
}
