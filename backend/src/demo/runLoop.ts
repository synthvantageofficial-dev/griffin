/**
 * Owna core-loop demo. Runs sample purchases through the real engine with mock
 * prices and prints what happens, step by step. No DB, no broker.
 *
 *   npm run demo
 */
import { toPaise, formatINR, type Paise } from '../lib/money.js';
import { MockPriceProvider } from '../modules/prices/priceProvider.js';
import { runSimulation, type SampleTxn, type SimConfig } from '../modules/simulation/runSimulation.js';

const rupees = (r: number): Paise => toPaise(Math.round(r * 100));

// A day in the life: everyday spends at a mix of brands.
const TXNS: readonly SampleTxn[] = [
  { ref: 't01', merchant: 'Zomato', amountPaise: rupees(320) },
  { ref: 't02', merchant: 'Starbucks Coffee', amountPaise: rupees(450) },
  { ref: 't03', merchant: 'KFC', amountPaise: rupees(390) },
  { ref: 't04', merchant: 'Vodafone Idea Recharge', amountPaise: rupees(299) },
  { ref: 't05', merchant: 'KFC', amountPaise: rupees(520) },
  { ref: 't06', merchant: 'DMART AVENUE', amountPaise: rupees(1850) },
  { ref: 't07', merchant: 'Zomato', amountPaise: rupees(260) },
  { ref: 't08', merchant: 'KFC #231 Pune', amountPaise: rupees(410) },
  { ref: 't09', merchant: 'Tanishq', amountPaise: rupees(8200) },
  { ref: 't10', merchant: 'KFC', amountPaise: rupees(600) },
  { ref: 't11', merchant: 'Amazon Pay', amountPaise: rupees(1299) },
  { ref: 't12', merchant: 'KFC', amountPaise: rupees(350) },
  { ref: 't13', merchant: 'Sharma General Store', amountPaise: rupees(240) },
  { ref: 't14', merchant: 'KFC', amountPaise: rupees(480) },
  { ref: 't15', merchant: 'KFC', amountPaise: rupees(300) },
  { ref: 't16', merchant: 'KFC', amountPaise: rupees(290) },
];

const config: SimConfig = {
  rule: { type: 'fixed', amountPaise: rupees(25) }, // set aside ₹25 per purchase
  fallbackEtfSymbol: 'NIFTYBEES',
  fallbackName: 'Nifty 50 ETF (fallback)',
};

function bar(pct: number): string {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function main(): void {
  const result = runSimulation(TXNS, config, new MockPriceProvider());

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  OWNA — core loop demo   (mock prices, ₹25 set aside / spend)');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const e of result.events) {
    const spent = TXNS.find((t) => t.ref === e.ref)!.amountPaise;
    console.log(`🛍️  ${e.merchant}  (${formatINR(spent)})`);
    console.log(`     → set aside ${formatINR(e.roundupPaise)} for ${e.entityName} [${e.symbol}]`);
    if (e.boughtQty > 0) {
      console.log(`     🎉 BOUGHT ${e.boughtQty} share${e.boughtQty > 1 ? 's' : ''} of ${e.entityName} for ${formatINR(e.boughtCostPaise)}!`);
    }
    console.log(`     ${bar(e.progressPct)} ${e.progressPct}% toward next share · balance ${formatINR(e.balancePaise)}\n`);
  }

  console.log('───────────────────────────── PORTFOLIO ─────────────────────────────\n');
  const owned = [...result.holdings.entries()];
  if (owned.length === 0) {
    console.log('  (no whole shares bought yet)');
  } else {
    for (const [symbol, qty] of owned) {
      console.log(`  📈 ${result.names.get(symbol)} [${symbol}] — ${qty} share${qty > 1 ? 's' : ''} owned`);
    }
  }

  console.log('\n  Still accumulating:');
  for (const [symbol, bal] of result.balances.entries()) {
    if (bal > 0) console.log(`     • ${result.names.get(symbol)} [${symbol}] — ${formatINR(bal)}`);
  }
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

main();
