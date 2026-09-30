# Backend — investing-app

Node.js + TypeScript backend. This is where the **accumulation engine** (the heart of
the product) lives. Read [`../CLAUDE.md`](../CLAUDE.md) first — it is the master plan and
contains the non-negotiable Golden Rules (execution-only, integer paise, never hold funds, etc.).

## Stack
- **Runtime:** Node.js ≥ 20, TypeScript (strict), ES modules
- **Web:** Fastify 5 + @fastify/helmet
- **Validation:** zod (also validates env at startup)
- **Logging:** pino (pretty in dev)
- **Tests:** vitest
- **DB (next):** PostgreSQL (integer-paise, double-entry ledger)

## Getting started
```bash
cd backend
npm install
cp .env.example .env   # then edit
npm run dev            # starts on http://127.0.0.1:4000
```
Health check: `GET /health`.

## Scripts
| Script | What it does |
|---|---|
| `npm run dev` | Watch-mode dev server (tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled build |
| `npm run typecheck` | Type-check only (no emit) |
| `npm test` | Run the test suite |
| `npm run format` | Prettier format |

## Layout
```
src/
  config/env.ts     # zod-validated environment
  lib/money.ts      # integer-paise money helpers (Golden Rule #5)
  server.ts         # Fastify app factory
  index.ts          # bootstrap + graceful shutdown
tests/              # vitest specs
```
Business modules (accumulation, detection, mapping, execution, …) are added under
`src/modules/` as we build them, piece by piece.

## Money rule (critical)
All money is **integer paise**. Never use floats for money. Use `src/lib/money.ts`.
