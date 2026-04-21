# `scripts/dev/`

Local-only developer scripts. Everything in this directory is **gitignored** except this README.

## Purpose

A home for ad-hoc test scripts, one-off migration helpers, and local-dev utilities that should not leak into production bundles or CI.

## Why gitignored?

Previous versions had scripts like `test-foreign-key.js` and `test.mjs` sitting at the repo root. They served short-term purposes, drifted out of date, and became noise. Gitignoring this folder keeps that pattern contained.

## What to put here

- **OK:** scratch scripts you wrote to debug a production incident once
- **OK:** throwaway data seeding scripts for local development
- **OK:** `local-dev-server.ts` style helpers specific to your machine

## What NOT to put here

- **Not OK:** tests that belong in a real test suite — use Vitest / Jest under a proper `tests/` directory
- **Not OK:** migration scripts — those belong under `supabase/migrations/`
- **Not OK:** production utilities — those belong under `src/utils/` or `scripts/` (without `/dev/`)

## Example

```bash
# Your local script lives here
scripts/dev/check_stock_drift.mjs

# Run it directly — never from CI
node scripts/dev/check_stock_drift.mjs
```
