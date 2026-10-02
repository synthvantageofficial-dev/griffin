/**
 * Accumulation engine core — pure, deterministic, integer-paise.
 *
 * This is the heart of the product (CLAUDE.md §1). It has NO I/O: callers load
 * balances/prices/mappings from the DB, run these functions, then persist the
 * returned ledger entries + balances. Keeping it pure makes it fully testable
 * and makes the future fractional-shares swap a drop-in (§3).
 */
import { toPaise, addPaise, subtractPaise, type Paise } from '../../lib/money.js';
import { computeRoundup } from './roundup.js';
import { resolveTarget } from './routing.js';
import type { RoundupRule, MerchantMapping, Target, LedgerEntry, ExecutionDecision } from './types.js';

export interface AccumulationResult {
  readonly newBalancePaise: Paise;
  readonly ledgerEntry: LedgerEntry;
}

/** Credit a set-aside amount into a target's running balance (idempotent via key). */
export function applyRoundup(
  currentBalancePaise: Paise,
  roundupPaise: Paise,
  idempotencyKey: string,
): AccumulationResult {
  return {
    newBalancePaise: addPaise(currentBalancePaise, roundupPaise),
    ledgerEntry: { direction: 'credit', amountPaise: roundupPaise, reason: 'roundup', idempotencyKey },
  };
}

/**
 * Decide how many WHOLE shares/units the accumulated balance can buy at the
 * current price. This is the bridge model (buy whole shares); when fractional
 * shares become legal we swap this one function (§3).
 */
export function evaluateExecution(balancePaise: Paise, sharePricePaise: Paise): ExecutionDecision {
  if (sharePricePaise <= 0 || balancePaise < sharePricePaise) {
    return { shouldBuy: false, qty: 0, costPaise: toPaise(0), remainingPaise: balancePaise };
  }
  const qty = Math.floor(balancePaise / sharePricePaise);
  const costPaise = toPaise(qty * sharePricePaise);
  return { shouldBuy: true, qty, costPaise, remainingPaise: subtractPaise(balancePaise, costPaise) };
}

/** Progress toward the next whole share, 0-100 (for the UI progress bar, §1 step 8). */
export function progressPercent(balancePaise: Paise, sharePricePaise: Paise): number {
  if (sharePricePaise <= 0) return 0;
  const withinOneShare = balancePaise % sharePricePaise;
  return Math.min(100, Math.floor((withinOneShare / sharePricePaise) * 100));
}

export interface ProcessPurchaseInput {
  readonly purchasePaise: Paise;
  readonly rule: RoundupRule;
  readonly mapping: MerchantMapping | null;
  readonly fallbackEtfSymbol: string;
  /** Current accumulated balance for the RESOLVED target, before this purchase. */
  readonly currentBalancePaise: Paise;
  /** Current price of one share/unit of the resolved target. */
  readonly sharePricePaise: Paise;
  /** Unique key for this purchase; used to derive idempotent ledger keys. */
  readonly idempotencyKey: string;
}

export interface ProcessPurchaseResult {
  readonly target: Target;
  readonly roundupPaise: Paise;
  readonly creditEntry: LedgerEntry;
  readonly execution: ExecutionDecision;
  /** Present only when a buy is triggered. */
  readonly debitEntry?: LedgerEntry;
  /** Balance left accumulating after any buy. */
  readonly finalBalancePaise: Paise;
}

/**
 * End-to-end pure evaluation of a single detected purchase:
 * round-up -> resolve target -> credit balance -> decide whether to buy.
 * Returns everything the persistence layer needs to write; writes nothing itself.
 */
export function processPurchase(input: ProcessPurchaseInput): ProcessPurchaseResult {
  const roundupPaise = computeRoundup(input.purchasePaise, input.rule);
  const target = resolveTarget(input.mapping, input.fallbackEtfSymbol);

  const credited = applyRoundup(input.currentBalancePaise, roundupPaise, `${input.idempotencyKey}:credit`);
  const execution = evaluateExecution(credited.newBalancePaise, input.sharePricePaise);

  if (execution.shouldBuy) {
    const debitEntry: LedgerEntry = {
      direction: 'debit',
      amountPaise: execution.costPaise,
      reason: 'buy',
      idempotencyKey: `${input.idempotencyKey}:debit`,
    };
    return {
      target,
      roundupPaise,
      creditEntry: credited.ledgerEntry,
      execution,
      debitEntry,
      finalBalancePaise: execution.remainingPaise,
    };
  }

  return {
    target,
    roundupPaise,
    creditEntry: credited.ledgerEntry,
    execution,
    finalBalancePaise: credited.newBalancePaise,
  };
}
