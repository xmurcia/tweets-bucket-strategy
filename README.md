# Musk Oracle - Polymarket Tweet Bucket Analyzer

Focused React app to analyze Polymarket markets that predict how many times Elon Musk will tweet during a defined event window.

## What it does

- Fetches active Polymarket events and filters to Elon tweet-count markets.
- Parses market outcomes into tweet-count buckets and shows pricing/coverage views.
- Pulls live tracking stats for `elonmusk` and computes projection ranges/probabilities.
- Supports quick strategy comparison using projected probabilities vs market prices.

## Stack

- Frontend: React + TypeScript + Vite
- Server: Express (`server.ts`) with Vite in middleware mode during development
- Styling: Tailwind CSS v4
- Data sources (proxied server-side):
  - `https://gamma-api.polymarket.com`
  - `https://xtracker.polymarket.com/api`

## Run locally

Prerequisite: Node.js

```bash
npm install
npm run dev
```

Lint/type-check:

```bash
npm run lint
```

## Environment variables

Use `.env.local` (not `.env`).

- `GEMINI_API_KEY`: currently scaffolded and loaded by Vite, but not used by the app runtime logic.
- `DISABLE_HMR=true`: optional, only needed in constrained hosted environments.

## Architecture

- Single-page app with top-level state managed in `App.tsx` and passed down via props.
- Frontend calls only local API routes under `/api/polymarket/*`.
- Express proxies external requests to avoid browser CORS issues and centralize projection logic.

### Relevant local endpoints

- `GET /api/polymarket/events?query=...`
- `GET /api/polymarket/active-counts/:userId`
- `GET /api/polymarket/trackings/:id`
- `GET /api/polymarket/tweet-projection/:trackingId`
- `GET /api/polymarket/tweet-projection-by-date?endDate=...&slug=...`

## Hero Replay Feature

The Hero Replay feature allows users to replay market history from stored snapshots. Key notes:

- **History requirement**: Replay requires at least 4 days of historical snapshots.
- **Temporary storage**: Replay history is stored as temporary JSON files (not permanent storage). These files are created on-demand in a temp directory and should not be relied upon for long-term data persistence.
- **Playback duration**: Full replay defaults to 6-8 seconds regardless of history span.

## Projection and calibration notes (short events)

Current projection behavior is tuned to avoid overconfident outputs early in an event:

- Warmup gate: projections are withheld until at least 4 elapsed hours and 20 tweets.
- Rate calibration: base pace uses elapsed average, with optional blending toward recent 24h pace when stable enough.
- Dispersion-aware uncertainty: interval width and confidence are adjusted using observed hourly-count dispersion.
- Distribution choice: range probabilities use Poisson for lower-intensity cases and switch to Normal approximation at higher volume/dispersion.

## Roadmap (next iteration)

- Add product analytics with Plausible to track key usage flows (market selection, strategy tab usage, and refresh behavior).
