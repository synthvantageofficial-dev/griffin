/**
 * Postgres-backed AccumulationStore (Supabase). Durable + atomic.
 *
 * Each transaction runs inside a single DB transaction. We lock the user row
 * (`select ... for update`) to serialize that user's spends, so balances and
 * ledger stay consistent. Money is integer paise (bigint); every financial
 * write is idempotent via unique keys.
 */
import pg from 'pg';
import { toPaise } from '../../lib/money.js';
import { resolveMerchant, normalize } from '../mapping/resolveMerchant.js';
import { resolveTarget } from '../accumulation/routing.js';
import { processPurchase, progressPercent, evaluateExecution } from '../accumulation/engine.js';
import type { RoundupRule } from '../accumulation/types.js';
import type { PriceProvider } from '../prices/priceProvider.js';
import type { AccumulationStore, Portfolio, ProcessResult, UnmappedMerchant, SweepBuy } from './store.js';
import type { SimConfig, SampleTxn } from '../simulation/runSimulation.js';

function ruleFromRow(type: string, valuePaise: number): RoundupRule {
  return type === 'fixed'
    ? { type: 'fixed', amountPaise: toPaise(valuePaise) }
    : { type: 'round_up_nearest', nearestPaise: toPaise(valuePaise) };
}

export class PgStore implements AccumulationStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly prices: PriceProvider,
  ) {}

  async createUser(config: SimConfig): Promise<string> {
    const valuePaise = config.rule.type === 'fixed' ? config.rule.amountPaise : config.rule.nearestPaise;
    const res = await this.pool.query(
      `insert into users (rule_type, rule_value_paise, fallback_symbol, fallback_name)
       values ($1, $2, $3, $4) returning id`,
      [config.rule.type, valuePaise, config.fallbackEtfSymbol, config.fallbackName ?? 'Index ETF (fallback)'],
    );
    return res.rows[0].id as string;
  }

  async getUserConfig(userId: string): Promise<SimConfig | null> {
    const res = await this.pool.query(
      `select rule_type, rule_value_paise, fallback_symbol, fallback_name from users where id = $1`,
      [userId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      rule: ruleFromRow(row.rule_type, Number(row.rule_value_paise)),
      fallbackEtfSymbol: row.fallback_symbol,
      fallbackName: row.fallback_name,
    };
  }

  async processTransaction(userId: string, txn: SampleTxn): Promise<ProcessResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');

      // Lock the user row -> serializes this user's transactions. Also loads config.
      const u = await client.query(
        `select rule_type, rule_value_paise, fallback_symbol, fallback_name
         from users where id = $1 for update`,
        [userId],
      );
      if (!u.rows[0]) {
        await client.query('rollback');
        return null;
      }
      const cfg: SimConfig = {
        rule: ruleFromRow(u.rows[0].rule_type, Number(u.rows[0].rule_value_paise)),
        fallbackEtfSymbol: u.rows[0].fallback_symbol,
        fallbackName: u.rows[0].fallback_name,
      };

      const mapping = resolveMerchant(txn.merchant);
      const target = resolveTarget(mapping, cfg.fallbackEtfSymbol);
      const price = this.prices.getPricePaise(target.symbol) ?? toPaise(0);
      const entityName =
        target.symbol === cfg.fallbackEtfSymbol
          ? (cfg.fallbackName ?? 'Index ETF (fallback)')
          : (mapping?.entityName ?? target.symbol);

      // Idempotency: at most one (user, source, external_ref).
      const ins = await client.query(
        `insert into transactions (user_id, merchant_key, amount_paise, occurred_at, source, external_ref)
         values ($1, $2, $3, now(), 'api', $4)
         on conflict (user_id, source, external_ref) do nothing
         returning id`,
        [userId, txn.merchant, txn.amountPaise, txn.ref],
      );

      if (!ins.rows[0]) {
        // Already processed — return current state for this target, change nothing.
        const bal = await client.query(
          `select balance_paise from accumulation_balances where user_id = $1 and target_symbol = $2`,
          [userId, target.symbol],
        );
        await client.query('commit');
        const balancePaise = toPaise(bal.rows[0] ? Number(bal.rows[0].balance_paise) : 0);
        return {
          duplicate: true,
          event: {
            ref: txn.ref, merchant: txn.merchant, entityName, symbol: target.symbol, kind: target.kind,
            roundupPaise: toPaise(0), boughtQty: 0, boughtCostPaise: toPaise(0),
            balancePaise, progressPct: progressPercent(balancePaise, price),
          },
        };
      }
      const transactionId = ins.rows[0].id as string;

      // Log merchants we couldn't map, so we can grow the mapping by frequency.
      if (!mapping) {
        const key = normalize(txn.merchant);
        if (key) {
          await client.query(
            `insert into unmapped_merchants (merchant_key, sample_name, hits, first_seen, last_seen)
             values ($1, $2, 1, now(), now())
             on conflict (merchant_key)
             do update set hits = unmapped_merchants.hits + 1, sample_name = excluded.sample_name, last_seen = now()`,
            [key, txn.merchant],
          );
        }
      }

      // Current balance for this target (locked row if present).
      const cur = await client.query(
        `select balance_paise from accumulation_balances where user_id = $1 and target_symbol = $2 for update`,
        [userId, target.symbol],
      );
      const current = toPaise(cur.rows[0] ? Number(cur.rows[0].balance_paise) : 0);

      const r = processPurchase({
        purchasePaise: txn.amountPaise,
        rule: cfg.rule,
        mapping,
        fallbackEtfSymbol: cfg.fallbackEtfSymbol,
        currentBalancePaise: current,
        sharePricePaise: price,
        idempotencyKey: `${userId}:${txn.ref}`,
      });

      // Record the set-aside (only when there is one — CHECK constraints require > 0).
      if (r.roundupPaise > 0) {
        await client.query(
          `insert into roundups (transaction_id, user_id, amount_paise, rule, target_kind, target_symbol)
           values ($1, $2, $3, $4, $5, $6)`,
          [transactionId, userId, r.roundupPaise, cfg.rule.type, target.kind, target.symbol],
        );
        await client.query(
          `insert into ledger_entries (user_id, target_symbol, direction, amount_paise, idempotency_key, reason)
           values ($1, $2, 'credit', $3, $4, 'roundup')`,
          [userId, target.symbol, r.roundupPaise, `${userId}:${txn.ref}:credit`],
        );
      }

      // Upsert the running balance (only if it actually changed or a buy happened).
      if (r.finalBalancePaise !== current || r.execution.shouldBuy) {
        await client.query(
          `insert into accumulation_balances (user_id, target_kind, target_symbol, balance_paise, name, updated_at)
           values ($1, $2, $3, $4, $5, now())
           on conflict (user_id, target_symbol)
           do update set balance_paise = excluded.balance_paise, name = excluded.name, updated_at = now()`,
          [userId, target.kind, target.symbol, r.finalBalancePaise, entityName],
        );
      }

      if (r.execution.shouldBuy) {
        await client.query(
          `insert into orders (user_id, target_kind, symbol, qty, cost_paise, status, idempotency_key)
           values ($1, $2, $3, $4, $5, 'filled', $6)`,
          [userId, target.kind, target.symbol, r.execution.qty, r.execution.costPaise, `${userId}:${txn.ref}:order`],
        );
        await client.query(
          `insert into ledger_entries (user_id, target_symbol, direction, amount_paise, idempotency_key, reason)
           values ($1, $2, 'debit', $3, $4, 'buy')`,
          [userId, target.symbol, r.execution.costPaise, `${userId}:${txn.ref}:debit`],
        );
        await client.query(
          `insert into holdings (user_id, symbol, qty, name, updated_at)
           values ($1, $2, $3, $4, now())
           on conflict (user_id, symbol)
           do update set qty = holdings.qty + excluded.qty, name = excluded.name, updated_at = now()`,
          [userId, target.symbol, r.execution.qty, entityName],
        );
      }

      await client.query('commit');

      return {
        duplicate: false,
        event: {
          ref: txn.ref, merchant: txn.merchant, entityName, symbol: target.symbol, kind: target.kind,
          roundupPaise: r.roundupPaise,
          boughtQty: r.execution.shouldBuy ? r.execution.qty : 0,
          boughtCostPaise: r.execution.shouldBuy ? r.execution.costPaise : toPaise(0),
          balancePaise: r.finalBalancePaise,
          progressPct: progressPercent(r.finalBalancePaise, price),
        },
      };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async getPortfolio(userId: string): Promise<Portfolio | null> {
    const exists = await this.pool.query(`select 1 from users where id = $1`, [userId]);
    if (!exists.rows[0]) return null;
    const h = await this.pool.query(
      `select symbol, name, qty from holdings where user_id = $1 and qty > 0 order by symbol`,
      [userId],
    );
    const b = await this.pool.query(
      `select target_symbol as symbol, name, balance_paise from accumulation_balances
       where user_id = $1 and balance_paise > 0 order by target_symbol`,
      [userId],
    );
    return {
      userId,
      holdings: h.rows.map((row) => ({ symbol: row.symbol, name: row.name || row.symbol, qty: Number(row.qty) })),
      accumulating: b.rows.map((row) => ({
        symbol: row.symbol,
        name: row.name || row.symbol,
        balancePaise: Number(row.balance_paise),
      })),
    };
  }

  async runSweep(): Promise<SweepBuy[]> {
    const candidates = await this.pool.query(
      `select user_id, target_kind, target_symbol, balance_paise, name
       from accumulation_balances where balance_paise > 0`,
    );
    const buys: SweepBuy[] = [];

    for (const row of candidates.rows) {
      const price = this.prices.getPricePaise(row.target_symbol) ?? toPaise(0);
      if (price <= 0 || Number(row.balance_paise) < price) continue;

      const client = await this.pool.connect();
      try {
        await client.query('begin');
        const cur = await client.query(
          `select balance_paise from accumulation_balances
           where user_id = $1 and target_symbol = $2 for update`,
          [row.user_id, row.target_symbol],
        );
        if (!cur.rows[0]) {
          await client.query('rollback');
          continue;
        }
        const dec = evaluateExecution(toPaise(Number(cur.rows[0].balance_paise)), price);
        if (!dec.shouldBuy) {
          await client.query('rollback');
          continue;
        }
        const key = `sweep:${row.user_id}:${row.target_symbol}:${Date.now()}`;
        await client.query(
          `update accumulation_balances set balance_paise = $3, updated_at = now()
           where user_id = $1 and target_symbol = $2`,
          [row.user_id, row.target_symbol, dec.remainingPaise],
        );
        await client.query(
          `insert into orders (user_id, target_kind, symbol, qty, cost_paise, status, idempotency_key)
           values ($1, $2, $3, $4, $5, 'filled', $6)`,
          [row.user_id, row.target_kind, row.target_symbol, dec.qty, dec.costPaise, `${key}:order`],
        );
        await client.query(
          `insert into ledger_entries (user_id, target_symbol, direction, amount_paise, idempotency_key, reason)
           values ($1, $2, 'debit', $3, $4, 'sweep_buy')`,
          [row.user_id, row.target_symbol, dec.costPaise, `${key}:debit`],
        );
        await client.query(
          `insert into holdings (user_id, symbol, qty, name, updated_at)
           values ($1, $2, $3, $4, now())
           on conflict (user_id, symbol) do update set qty = holdings.qty + excluded.qty, updated_at = now()`,
          [row.user_id, row.target_symbol, dec.qty, row.name],
        );
        await client.query('commit');
        buys.push({
          userId: row.user_id,
          symbol: row.target_symbol,
          name: row.name || row.target_symbol,
          qty: dec.qty,
          costPaise: dec.costPaise,
        });
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    }
    return buys;
  }

  async topUnmapped(limit: number): Promise<UnmappedMerchant[]> {
    const res = await this.pool.query(
      `select merchant_key, sample_name, hits from unmapped_merchants
       order by hits desc, last_seen desc limit $1`,
      [limit],
    );
    return res.rows.map((row) => ({
      merchantKey: row.merchant_key,
      sample: row.sample_name,
      hits: Number(row.hits),
    }));
  }
}
