# investing-app (working title)

An India-only "**invest where you shop**" app. When a user spends at a publicly-listed
company, we set aside a small amount and, once it reaches the price of one whole share,
automatically buy that company's share for the user. (India-adapted "Grifin" model.)

> 📖 **[CLAUDE.md](CLAUDE.md) is the single source of truth** — vision, the model, legal
> guardrails (Golden Rules), monetization, architecture, and the phased roadmap. Read it first.

## Repository layout
```
CLAUDE.md      # master plan (read this first)
backend/       # Node.js + TypeScript backend (accumulation engine lives here)
mobile/        # React Native app (added later, when we build UI screens)
```

## Status
Early development. Building **Phase 1 (MVP)** piece by piece, starting with the backend
accumulation engine. See the roadmap in `CLAUDE.md` §9.
