# Hero Curve Replay Tickets

Branch context: `feat/hero-curve-replay-tickets`

Why this file lives here:
- The repo has no existing planning directory, but it does keep project-level documentation at the root (`README.md`, `CLAUDE.md`).
- `docs/tickets/` is a clean root-level location for agent-facing planning artifacts without mixing them into `src/` runtime code.
- A single markdown file keeps the execution graph and ticket contracts together for future implementation passes.

## Ticket 1: Define Hero Replay Contracts

Objective: Establish the canonical TypeScript and server-side shapes for stored snapshots, normalized buckets, replay frames, replay status, and chart points before implementation starts.

Scope:
- Add shared interfaces/types for history snapshots, normalized replay buckets, midpoint metadata, interpolated frames, and replay availability state.
- Define exact fields required to reuse live bucket pricing without inventing a second pricing source.
- Document the minimum-history gate of 4 days.

Non-scope:
- Persisting files.
- Rendering charts.
- Running playback.

Inputs:
- Existing `PolymarketEvent`, `Bucket`, `TrackingStats`, and `TweetProjection` shapes.
- Existing `parseBuckets()` pricing pipeline in `src/services/polymarket.ts`.

Outputs:
- New/updated type definitions that all later tickets can import.
- Clear distinction between raw stored snapshot shape and normalized replay frame shape.

Likely files/areas:
- `src/types.ts`
- `src/services/polymarket.ts`
- `server.ts`

Dependencies: None.

Acceptance criteria:
- There is one agreed replay snapshot contract used by both persistence and frontend history loading.
- Contracts explicitly support open-ended buckets like `260+`.
- Contracts include enough data to detect replay eligibility and stop playback on live state.

Implementation notes:
- Keep bucket pricing sourced from the same parsed market payload used today; do not create alternate price math.
- Prefer colocated domain types over a new abstraction layer.

Can run in parallel: No.

## Ticket 2: Add Per-Event History Persistence Store

Objective: Create temporary JSON persistence for hero replay snapshots, one file per event, on the server side.

Scope:
- Choose a temp storage directory and file naming convention keyed by event or slug.
- Add read/write helpers for appending snapshots safely.
- Persist timestamp, event identity, and enough raw market data to reconstruct current buckets via the existing pipeline.

Non-scope:
- Playback interpolation.
- Chart rendering.
- Continuous background capture scheduling beyond basic write support.

Inputs:
- Replay contracts from Ticket 1.
- Current event shape returned through `/api/polymarket/events`.

Outputs:
- Server helpers for loading and appending history files.
- One JSON file per tracked event in a temp/history directory.

Likely files/areas:
- `server.ts`
- New server utility file if extraction becomes necessary
- New temp data directory such as `tmp/hero-replay/` or similar

Dependencies: Ticket 1.

Acceptance criteria:
- History files are created lazily per event.
- Writes are append-safe and preserve snapshot order.
- Stored records are sufficient to rebuild bucket prices later with no secondary pricing logic.

Implementation notes:
- Keep v1 intentionally temporary and file-based.
- Include timestamp in ISO form plus a monotonic sort key if needed.

Can run in parallel: No.

## Ticket 3: Capture Historical Snapshots From Live Refresh

Objective: Wire snapshot capture into a dedicated server path so history collection is separate from replay consumption.

Scope:
- Add a server endpoint or internal capture path that records a snapshot for the currently viewed event.
- Reuse the existing event fetch payload instead of constructing custom snapshot data from frontend state.
- Ensure duplicate snapshots within a very short interval are skipped or coalesced.

Non-scope:
- Frontend replay UI.
- Interpolation math.
- Automatic playback behavior.

Inputs:
- Persistence helpers from Ticket 2.
- Existing event refresh path in `server.ts` and `src/App.tsx`.

Outputs:
- Capture-capable server route or refresh hook.
- Stored event history that grows independently of the replay feature.

Likely files/areas:
- `server.ts`
- `src/App.tsx`

Dependencies: Tickets 1-2.

Acceptance criteria:
- A selected live event can produce stored history snapshots without affecting normal refresh behavior.
- History capture is explicitly separate from replay loading in v1.
- Captured snapshots preserve the raw market information needed for later parsing.

Implementation notes:
- Keep capture trigger minimal: piggyback on existing manual/auto refresh instead of adding a new scheduler first.
- Avoid capture writes when no event is selected.

Can run in parallel: No.

## Ticket 4: Normalize Replay Buckets and X-Axis Geometry

Objective: Build the deterministic normalization layer that converts stored snapshots into replay-ready chart series aligned on bucket midpoints.

Scope:
- Parse stored snapshots using the exact existing bucket parsing pipeline.
- Derive bucket midpoint x-values from names like `120-139`.
- Handle open-ended ranges like `260+` using the previous bucket width heuristic.
- Apply missing-value fallback to the last valid ask for the same bucket.
- Exclude buckets with no valid historical value at all.

Non-scope:
- Visual smoothing.
- Playback controls.
- Live refresh integration.

Inputs:
- Tickets 1-3 outputs.
- `parseBuckets()` behavior in `src/services/polymarket.ts`.

Outputs:
- A normalized time-series structure that every chart frame can consume.
- Stable x-axis ordering and per-bucket replay continuity.

Likely files/areas:
- `src/services/polymarket.ts`
- New frontend utility such as `src/utils/heroReplay.ts`
- `src/types.ts`

Dependencies: Tickets 1-3.

Acceptance criteria:
- Replay normalization uses the same bucket prices as the existing live bucket board.
- Missing per-bucket values reuse the last valid ask for that bucket.
- Buckets with zero valid history are dropped from replay output.
- Open-ended buckets get a midpoint derived from the previous bucket width heuristic.

Implementation notes:
- Treat normalization as a pure transform so it can be tested independently.
- This is the contract boundary between raw history and every later chart ticket.

Can run in parallel: No.

## Ticket 5: Expose Replay History to the Frontend With Eligibility Gate

Objective: Add the frontend/server loading path for replay history and enforce the minimum 4-day history gate.

Scope:
- Add a history-read API returning raw or normalized replay data for the selected event.
- Add frontend service calls and local state for replay history availability.
- Enable replay only when at least 4 full days of history exist.
- Surface a clear unavailable state when history is too short.

Non-scope:
- Rendering the chart itself.
- Playback motion.
- Live refresh reconciliation.

Inputs:
- Persistence from Ticket 2.
- Normalization from Ticket 4.
- Existing selected-market flow in `App.tsx`.

Outputs:
- One frontend fetch path for replay history.
- Replay-availability state tied to the selected market.

Likely files/areas:
- `server.ts`
- `src/services/polymarket.ts`
- `src/App.tsx`

Dependencies: Tickets 2 and 4.

Acceptance criteria:
- Replay is disabled when history span is under 4 days.
- The UI can distinguish "no history", "insufficient history", and "history ready".
- Loading replay history does not block the rest of the page.

Implementation notes:
- Return enough metadata to avoid recomputing eligibility entirely in the component tree.
- Keep the fetch separate from live projection refresh calls.

Can run in parallel: Yes, after Tickets 2 and 4.

## Ticket 6: Render Static Hero Curve Chart

Objective: Introduce the non-animated hero chart that shows the live curve and real bucket points using normalized replay-compatible data.

Scope:
- Build the hero chart component using the existing `recharts` dependency.
- Render a smooth line plus real bucket points.
- Preserve truthful live-state rendering even if smoothing is visually applied to the line.
- Slot the chart into the existing top signal area without breaking current stats usage.

Non-scope:
- Playback timeline motion.
- Pause/resume controls.
- Historical interpolation.

Inputs:
- Normalized live/replay chart data.
- Existing signal area around `StatsModule` in `src/App.tsx`.

Outputs:
- A static hero chart component wired into the detail view.

Likely files/areas:
- New component such as `src/components/HeroCurveChart.tsx`
- `src/components/StatsModule.tsx`
- `src/App.tsx`

Dependencies: Tickets 1 and 4.

Acceptance criteria:
- The hero area displays a smooth line and visible real bucket points.
- The current live state remains truthful even if the line is smoothed.
- Mobile and desktop layouts remain usable.

Implementation notes:
- Keep smoothing visual-only; dots/tooltip values must come from real bucket prices.
- Favor integrating near `StatsModule` instead of introducing a new top-level page section.

Can run in parallel: Yes, after Ticket 4.

## Ticket 7: Build Replay Interpolation Engine

Objective: Create the playback engine that interpolates between stored snapshots and completes in roughly 6-8 seconds.

Scope:
- Convert normalized snapshots into animation frames.
- Interpolate bucket values between stored timestamps.
- Run from earliest snapshot to present.
- Stop exactly on the live state.
- Tune default timing to land within a 6-8 second full replay window.

Non-scope:
- Final playback controls UI.
- Live refresh updates during playback.
- Broader page interaction locking.

Inputs:
- Normalized history from Ticket 4.
- Static chart rendering contract from Ticket 6.

Outputs:
- A reusable playback state machine or hook that emits current replay frame data.

Likely files/areas:
- New hook/utility such as `src/utils/heroReplay.ts` or `src/hooks/useHeroReplay.ts`
- `src/types.ts`

Dependencies: Tickets 4 and 6.

Acceptance criteria:
- Playback starts at the earliest snapshot and ends on the current live frame.
- Interpolation occurs between stored snapshots rather than stepping only on exact captures.
- Default full run time is between 6 and 8 seconds.

Implementation notes:
- Duration should be derived from total history span plus a cap, not hardcoded per frame count alone.
- Keep playback independent from fetch timing so later live refresh integration stays manageable.

Can run in parallel: Yes, after Tickets 4 and 6.

## Ticket 8: Add Replay Controls and Chart-Scoped Pause Behavior

Objective: Add replay controls while keeping pause behavior isolated to the chart module so the rest of the page remains usable.

Scope:
- Add play/replay/pause UI in or adjacent to the hero chart.
- Ensure pausing only affects replay inside the chart module.
- Keep bucket board, strategy tools, and the rest of the page interactive during playback.
- Show a clear “live” terminal state when playback has completed.

Non-scope:
- Capturing more history.
- Changing page-wide refresh policies.
- New strategy behavior.

Inputs:
- Playback engine from Ticket 7.
- Static hero chart from Ticket 6.

Outputs:
- User-facing replay controls integrated into the chart module.

Likely files/areas:
- `src/components/HeroCurveChart.tsx`
- `src/App.tsx`
- Possibly a small chart-controls subcomponent

Dependencies: Tickets 6-7.

Acceptance criteria:
- Users can play and pause replay from the chart module.
- Pausing replay does not disable the rest of the detail page.
- Replay completion leaves the chart in truthful live state.

Implementation notes:
- Keep paused/running state local to the chart module unless a parent truly needs to know.
- Do not introduce page-level modal or overlay behavior.

Can run in parallel: No.

## Ticket 9: Reconcile Live Refresh With Replay State

Objective: Make live refresh coexist cleanly with hero replay so fresh data lands without corrupting playback behavior.

Scope:
- Define what happens when live market refresh completes during playback.
- Ensure replay terminates on the latest live state rather than stale state.
- Keep history capture separate from replay loading, per v1 plan.
- Prevent refresh race conditions from swapping markets or replay datasets mid-animation.

Non-scope:
- New persistence storage design.
- New chart visuals.
- Analytics.

Inputs:
- Existing manual/auto refresh flow in `src/App.tsx`.
- Playback behavior from Tickets 7-8.

Outputs:
- A stable coordination rule between replay state and live detail refresh.

Likely files/areas:
- `src/App.tsx`
- `src/components/HeroCurveChart.tsx`
- `src/services/polymarket.ts`

Dependencies: Tickets 3, 5, 7, and 8.

Acceptance criteria:
- Replay always settles on the latest known live state.
- Refreshes do not freeze the rest of the UI.
- History capture remains a separate concern from replay consumption.

Implementation notes:
- Prefer versioned frame datasets or request IDs over implicit mutable state.
- Reuse the app’s existing request invalidation pattern where possible.

Can run in parallel: No.

## Ticket 10: Harden Replay With Tests and Failure States

Objective: Close the feature with targeted hardening around edge cases, correctness, and operator confidence.

Scope:
- Add tests for midpoint derivation, missing-value fallback, bucket exclusion, replay duration bounds, and live-stop behavior.
- Add empty/error/insufficient-history states.
- Verify open-ended bucket handling and truthful live-state rendering.
- Document any temporary storage caveats for v1.

Non-scope:
- New product analytics.
- Long-term durable storage.
- Non-hero chart redesign.

Inputs:
- Implemented replay flow from Tickets 1-9.

Outputs:
- Tests plus resilience polish for the shipped v1 replay experience.

Likely files/areas:
- `src/utils/heroReplay.ts` or equivalent tests
- `src/components/HeroCurveChart.tsx`
- `src/services/polymarket.ts`
- `README.md` if a short implementation caveat is worth documenting

Dependencies: Tickets 1-9.

Acceptance criteria:
- Critical replay transforms and behaviors are covered by tests.
- Insufficient history and malformed history fail gracefully.
- The feature preserves truthful live values at rest.

Implementation notes:
- Prioritize pure-function tests first; they will carry most of the correctness risk.
- If UI tests are expensive, keep them narrow and focus on state transitions.

Can run in parallel: No.

## Dependency And Execution Plan

Sequential backbone:
1. Ticket 1 -> contracts
2. Ticket 2 -> persistence store
3. Ticket 3 -> capture path
4. Ticket 4 -> normalization and midpoint geometry
5. Ticket 5 -> frontend history loading and eligibility gate
6. Ticket 6 -> static hero chart
7. Ticket 7 -> interpolation engine
8. Ticket 8 -> replay controls and chart-scoped pause
9. Ticket 9 -> live refresh reconciliation
10. Ticket 10 -> hardening and tests

Parallel windows:
- Tickets 5 and 6 can overlap once Ticket 4 exists, but Ticket 5 still needs Ticket 2.
- Ticket 7 can start once Tickets 4 and 6 are stable.
- No ticket before Ticket 4 should be parallelized; the replay pipeline depends on shared contracts and normalization.

Recommended agent batches:
1. Batch A: Tickets 1-4 sequentially.
2. Batch B: Tickets 5 and 6 in parallel.
3. Batch C: Ticket 7.
4. Batch D: Tickets 8 and 9 sequentially.
5. Batch E: Ticket 10.
