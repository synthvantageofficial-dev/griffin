/**
 * End-to-end simulation of the core loop (no DB, no broker) — ties together
 * merchant mapping + accumulation engine + price provider. Pure: returns data;
 * the demo script does the printing.
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

export interface SimResult {
  readonly events: SimEvent[];
  readonly holdings: Map<string, number>; // symbol -> whole shares/units owned
  readonly balances: Map<string, Paise>; // symbol -> still-accumulating balance
  readonly names: Map<string, string>; // symbol -> human-readable entity name
}

export function runSimulation(
  txns: readonly SampleTxn[],
  config: SimConfig,
  prices: PriceProvider,
): SimResult {
  const balances = new Map<string, Paise>();
  const holdings = new Map<string, number>();
  const names = new Map<string, string>();
  const events: SimEvent[] = [];

  for (const t of txns) {
    const mapping = resolveMerchant(t.merchant);
    const target = resolveTarget(mapping, config.fallbackEtfSymbol);
    const price = prices.getPricePaise(target.symbol) ?? toPaise(0);
    const current = balances.get(target.symbol) ?? toPaise(0);

    const r = processPurchase({
      purchasePaise: t.amountPaise,
      rule: config.rule,
      mapping,
      fallbackEtfSymbol: config.fallbackEtfSymbol,
      currentBalancePaise: current,
      sharePricePaise: price,
      idempotencyKey: t.ref,
    });

    balances.set(target.symbol, r.finalBalancePaise);

    // Display the ACTUAL target: fallback routes show the ETF, not the brand.
    const entityName =
      target.symbol === config.fallbackEtfSymbol
        ? (config.fallbackName ?? 'Index ETF (fallback)')
        : (mapping?.entityName ?? target.symbol);
    names.set(target.symbol, entityName);

    if (r.execution.shouldBuy) {
      holdings.set(target.symbol, (holdings.get(target.symbol) ?? 0) + r.execution.qty);
    }

    events.push({
      ref: t.ref,
      merchant: t.merchant,
      entityName,
      symbol: target.symbol,
      kind: target.kind,
      roundupPaise: r.roundupPaise,
      boughtQty: r.execution.shouldBuy ? r.execution.qty : 0,
      boughtCostPaise: r.execution.shouldBuy ? r.execution.costPaise : toPaise(0),
      balancePaise: r.finalBalancePaise,
      progressPct: progressPercent(r.finalBalancePaise, price),
    });
  }

  return { events, holdings, balances, names };
}
