# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-purpose React app for analyzing Elon Musk tweet-count prediction markets on Polymarket. Not a general-purpose tool — all market queries are hard-coded to filter for events matching `"elon"` + `"tweets"`, and tracking stats always target `userId = "elonmusk"`.

## Dev server

```bash
npm run dev      # starts Express + Vite (middleware mode) on port 3000
npm run lint     # eslint src + tsc --noEmit
npm run build    # vite build → dist/
```

There is no `vite dev`. The dev server is always `npm run dev`, which runs `server.ts` via `tsx`. Vite runs in middleware mode inside Express — not as a standalone server.

## Environment variables

- `GEMINI_API_KEY` — set in `.env.local` (not `.env`). Vite loads all env vars (not just `VITE_`-prefixed) via `loadEnv(mode, '.', '')`. Currently a scaffolding leftover; the app does not use Gemini.
- `DISABLE_HMR=true` — disables Vite HMR (only needed in hosted AI Studio environments).

## Architecture

- **State**: All state lives in `App.tsx`, passed down as props. No external store.
- **API proxy**: Frontend never calls external APIs directly. All requests go through the local Express server at `/api/polymarket/*` (avoids CORS). External endpoints: `gamma-api.polymarket.com` and `xtracker.polymarket.com/api`.
- **Path alias**: `@/*` resolves to the project root, not `src/`. Components use relative imports in practice.

## Gotchas

- `PolymarketMarket.outcomes`, `outcomePrices`, and `clobTokenIds` are **JSON strings from the API**, not arrays. Always call `JSON.parse()` on them — see `parseBuckets()` in `src/services/polymarket.ts`.
- `TrackingStats` is defined in two places with different shapes. Components import from `src/services/polymarket.ts` (flat shape). The definition in `src/types.ts` is stale and unused.
- The "Distance to Buckets" feature extracts the first number from a bucket name via regex — fragile for bucket names that don't start with a number.

## Styling

Tailwind CSS v4 via `@tailwindcss/vite` plugin. No `tailwind.config.js`. Custom tokens are defined in `src/index.css` inside `@theme {}` blocks. The design uses two semantic tokens:
- `ink` → `#141414` (near-black) — use as `bg-ink`, `text-ink`, `border-ink`
- `bg` → `#E4E3E0` (off-white) — use as `bg-bg`, `text-bg`

Do not use conventional Tailwind color names like `text-primary` or `text-gray-*`.

## Commits

Follow Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, etc.
