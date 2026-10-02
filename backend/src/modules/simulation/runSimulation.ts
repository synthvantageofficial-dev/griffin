/**
 * Core-loop glue — ties merchant mapping + accumulation engine + price provider.
 *
 * `applyTransaction` is the single source of truth for "process one purchase
 * against some accumulation state". Both the batch simulation and the live API
 * use it, so the money logic lives in exactly one place.
 */
import { toPaise, type Paise } from '../../lib/money.js';
import { resolveMerchant } from '../mapping/resolveMerchant.js';
import { resolveTarget } from '../accumulation/routing.js';
import { processPurchase, progressPercent } from '../accumulation/engine.js';
import type { RoundupRule } from '../accumulation/types.js';
import type { PriceProvider } from '../prices/priceProvider.js';

export interface SampleTxn {
  readonly ref: string;
  readonly merchant: string;
  readonly amountPaise: Paise;
}

export interface SimConfig {
  readonly rule: RoundupRule;
  readonly fallbackEtfSymbol: string;
  readonly fallbackName?: string;
}

export interface SimEvent {
  readonly ref: string;
  readonly merchant: string;
  readonly entityName: string;
  readonly symbol: string;
  readonly kind: string;
  readonly roundupPaise: Paise;
  readonly boughtQty: number;
  readonly boughtCostPaise: Paise;
  readonly balancePaise: Paise;
  readonly progressPct: number;
}

/** Mutable accumulation state (per user). Keyed by target symbol = per-brand buckets. */
export interface LoopState {
  readonly balances: Map<string, Paise>;
  readonly holdings: Map<string, number>;
  readonly names: Map<string, string>;
}

export function newLoopState(): LoopState {
  return { balances: new Map(), holdings: new Map(), names: new Map() };
}

/** Process ONE purchase against `state`, mutating it, and return what happened. */
export function applyTransaction(
  state: LoopState,
  txn: SampleTxn,
  config: SimConfig,
  prices: PriceProvider,
): SimEvent {
  const mapping = resolveMerchant(txn.merchant);
  const target = resolveTarget(mapping, config.fallbackEtfSymbol);
  const price = prices.getPricePaise(target.symbol) ?? toPaise(0);
  const current = state.balances.get(target.symbol) ?? toPaise(0);

  const r = processPurchase({
    purchasePaise: txn.amountPaise,
    rule: config.rule,
    mapping,
    fallbackEtfSymbol: config.fallbackEtfSymbol,
    currentBalancePaise: current,
    sharePricePaise: price,
    idempotencyKey: txn.ref,
  });

  state.balances.set(target.symbol, r.finalBalancePaise);

  // Display the ACTUAL target: fallback routes show the ETF, not the brand.
  const entityName =
    target.symbol === config.fallbackEtfSymbol
      ? (config.fallbackName ?? 'Index ETF (fallback)')
      : (mapping?.entityName ?? target.symbol);
  state.names.set(target.symbol, entityName);

  if (r.execution.shouldBuy) {
    state.holdings.set(target.symbol, (state.holdings.get(target.symbol) ?? 0) + r.execution.qty);
  }

  return {
    ref: txn.ref,
    merchant: txn.merchant,
    entityName,
    symbol: target.symbol,
    kind: target.kind,
    roundupPaise: r.roundupPaise,
    boughtQty: r.execution.shouldBuy ? r.execution.qty : 0,
    boughtCostPaise: r.execution.shouldBuy ? r.execution.costPaise : toPaise(0),
    balancePaise: r.finalBalancePaise,
    progressPct: progressPercent(r.finalBalancePaise, price),
  };
}

export interface SimResult {
  readonly events: SimEvent[];
  readonly holdings: Map<string, number>;
  readonly balances: Map<string, Paise>;
  readonly names: Map<string, string>;
}

export function runSimulation(
  txns: readonly SampleTxn[],
  config: SimConfig,
  prices: PriceProvider,
): SimResult {
  const state = newLoopState();
  const events = txns.map((t) => applyTransaction(state, t, config, prices));
  return { events, holdings: state.holdings, balances: state.balances, names: state.names };
}
