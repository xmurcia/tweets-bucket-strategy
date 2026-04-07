import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

import { captureHeroReplaySnapshot, readHeroReplaySnapshots } from "./heroReplayStore.ts";
import { normalizeHeroReplaySnapshots } from "./src/utils/heroReplay.ts";
import { calculateConfidence, getRateStability } from "./src/utils/confidence.ts";
import {
  HERO_REPLAY_MIN_HISTORY_DAYS,
  HERO_REPLAY_MIN_HISTORY_MS,
  type HeroReplayAvailabilityState,
  type HeroReplayHistoryPayload,
  type HeroReplayNormalizedSeries,
  type PolymarketEvent,
} from "./src/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://polymarket.com',
  'Referer': 'https://polymarket.com/',
};

type RangeProbability = {
  range: string;
  rangeStart: number;
  rangeEnd: number;
  probability: number;
};

const RANGE_SIZE = 20;
const MAX_RANGE_START = 2000;
const MIN_HOURS_FOR_PROJECTION = 4;
const MIN_TWEETS_FOR_PROJECTION = 20;

function buildHeroReplayAvailability(series: HeroReplayNormalizedSeries): HeroReplayAvailabilityState {
  const snapshotCount = series.snapshots.length;
  const historySpanMs = series.historySpanMs;
  const status = snapshotCount === 0
    ? 'no-history'
    : historySpanMs >= HERO_REPLAY_MIN_HISTORY_MS
      ? 'ready'
      : 'insufficient-history';

  return {
    status,
    isReplayEligible: status === 'ready',
    minimumHistoryDays: HERO_REPLAY_MIN_HISTORY_DAYS,
    minimumHistoryMs: HERO_REPLAY_MIN_HISTORY_MS,
    snapshotCount,
    historyStartAt: series.historyStartAt,
    historyEndAt: series.historyEndAt,
    historySpanMs,
    latestSnapshotAt: series.historyEndAt,
    hasLiveSnapshot: snapshotCount > 0,
  };
}

type HourlySlot = {
  date: string;
  count: number;
};

function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function normalCdf(x: number, mean: number, std: number): number {
  return 0.5 * (1 + erf((x - mean) / (std * Math.sqrt(2))));
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

function estimateDispersion(hourlyCounts: number[]): number {
  const valid = hourlyCounts.filter((count) => Number.isFinite(count) && count >= 0);
  if (valid.length < 6) return 1;

  const mean = valid.reduce((sum, count) => sum + count, 0) / valid.length;
  if (mean <= 0) return 1;

  const variance = valid.reduce((sum, count) => {
    const diff = count - mean;
    return sum + diff * diff;
  }, 0) / valid.length;

  const dispersion = variance / mean;
  if (dispersion <= 1.2) return 1;
  return Math.min(2, dispersion);
}

function buildRangeProbabilities(
  currentCount: number,
  projectedTotal: number,
  tweetsPerHour: number,
  hoursRemaining: number,
  hourlyCounts: number[]
): RangeProbability[] {
  const expectedRemaining = Math.max(0, tweetsPerHour * hoursRemaining);
  const lambda = Number.isFinite(expectedRemaining) ? expectedRemaining : 0;
  const dispersion = estimateDispersion(hourlyCounts);

  const remainingStd = Math.sqrt(Math.max(1, lambda * dispersion));
  const totalStd = remainingStd;
  const upperFromDistribution = Math.ceil((projectedTotal + totalStd * 5) / RANGE_SIZE) * RANGE_SIZE;
  const tailRangeStart = Math.max(RANGE_SIZE, Math.min(MAX_RANGE_START, upperFromDistribution));

  const rangeProbabilities: RangeProbability[] = [];

  const useNormalApproximation = (lambda * dispersion) >= 225 || (dispersion >= 1.35 && lambda >= 120);

  let poissonCdf: number[] = [];
  let maxPoissonK = -1;

  if (!useNormalApproximation && lambda > 0) {
    maxPoissonK = Math.max(0, tailRangeStart - 1 - currentCount);
    poissonCdf = new Array(maxPoissonK + 1);
    let pmf = Math.exp(-lambda);
    let cumulative = pmf;
    poissonCdf[0] = cumulative;

    for (let k = 1; k <= maxPoissonK; k += 1) {
      pmf = pmf * (lambda / k);
      cumulative += pmf;
      poissonCdf[k] = cumulative;
    }
  }

  for (let start = 0; start < tailRangeStart; start += RANGE_SIZE) {
    const end = start + (RANGE_SIZE - 1);
    let probability = 0;

    if (lambda <= 0) {
      probability = currentCount >= start && currentCount <= end ? 1 : 0;
    } else if (useNormalApproximation) {
      const mean = currentCount + lambda;
      const std = Math.max(1, totalStd);
      const lowBound = start - 0.5;
      const highBound = end + 0.5;
      probability = normalCdf(highBound, mean, std) - normalCdf(lowBound, mean, std);
    } else {
      const startK = Math.max(0, start - currentCount);
      const endK = end - currentCount;

      if (endK >= 0 && startK <= endK) {
        const cdfEnd = endK >= maxPoissonK ? 1 : poissonCdf[endK];
        const cdfStartMinusOne = startK <= 0 ? 0 : poissonCdf[startK - 1];
        probability = cdfEnd - cdfStartMinusOne;
      }
    }

    rangeProbabilities.push({
      range: `${start}-${end}`,
      rangeStart: start,
      rangeEnd: end,
      probability: clampProbability(probability),
    });
  }

  let tailProbability = 0;

  if (lambda <= 0) {
    tailProbability = currentCount >= tailRangeStart ? 1 : 0;
  } else if (useNormalApproximation) {
    const mean = currentCount + lambda;
    const std = Math.max(1, totalStd);
    tailProbability = 1 - normalCdf(tailRangeStart - 0.5, mean, std);
  } else {
    const tailStartK = tailRangeStart - currentCount;
    if (tailStartK <= 0) {
      tailProbability = 1;
    } else {
      const index = Math.min(maxPoissonK, tailStartK - 1);
      const lowerCdf = index >= 0 ? poissonCdf[index] : 0;
      tailProbability = 1 - lowerCdf;
    }
  }

  rangeProbabilities.push({
    range: `${tailRangeStart}+`,
    rangeStart: tailRangeStart,
    rangeEnd: Infinity,
    probability: clampProbability(tailProbability),
  });

  const total = rangeProbabilities.reduce((sum, p) => sum + clampProbability(p.probability), 0);
  if (total > 0 && Number.isFinite(total)) {
    rangeProbabilities.forEach((p) => {
      p.probability = clampProbability(p.probability / total);
    });
  } else {
    const mostLikelyStart = Math.max(0, Math.floor(projectedTotal / RANGE_SIZE) * RANGE_SIZE);
    rangeProbabilities.forEach((p) => {
      p.probability = p.rangeStart === mostLikelyStart ? 1 : 0;
    });
  }

  rangeProbabilities.sort((a, b) => b.probability - a.probability);
  return rangeProbabilities;
}

function buildProjectionMetrics(
  trackingId: string,
  data: {
    title: string;
    startDate: string;
    endDate: string;
    stats: {
      total: number;
      daily?: HourlySlot[];
    };
  }
) {
  const now = Date.now();
  const startTime = new Date(data.startDate).getTime();
  const endTime = new Date(data.endDate).getTime();
  const currentCount = data.stats.total;

  const hoursElapsed = Math.max(0, (now - startTime) / (1000 * 60 * 60));
  const hoursTotal = Math.max(0, (endTime - startTime) / (1000 * 60 * 60));
  const hoursRemaining = Math.max(0, hoursTotal - hoursElapsed);

  if (hoursElapsed < MIN_HOURS_FOR_PROJECTION || currentCount < MIN_TWEETS_FOR_PROJECTION) {
    return {
      error: {
        error: 'Insufficient data for projection',
        hoursElapsed,
        currentCount,
      },
    };
  }

  const dailySlots: HourlySlot[] = (data.stats.daily ?? []).filter((slot) => Number.isFinite(slot?.count));
  const hourlyCounts = dailySlots.map((slot) => Math.max(0, slot.count));

  const tweetsPerHour = hoursElapsed > 0 ? currentCount / hoursElapsed : 0;

  let pace24h: number | undefined;
  if (dailySlots.length >= 2) {
    const last24 = dailySlots.slice(-24);
    const tweetsLast24h = last24.reduce((sum, slot) => sum + slot.count, 0);
    const hoursCovered = last24.length;
    const rate = hoursCovered > 0 ? tweetsLast24h / hoursCovered : 0;
    if (rate < 50 && Math.abs(rate - tweetsPerHour) > 0.2) {
      pace24h = rate;
    }
  }

  const dispersion = estimateDispersion(hourlyCounts);

  let projectionRate = tweetsPerHour;
  if (pace24h !== undefined) {
    const recentWeight = clampNumber((hoursElapsed - 8) / 40, 0, 0.65);
    projectionRate = tweetsPerHour * (1 - recentWeight) + pace24h * recentWeight;
  }

  if (dispersion > 1.4 && projectionRate > tweetsPerHour) {
    projectionRate *= 0.95;
  }

  const expectedRemaining = Math.max(0, projectionRate * hoursRemaining);
  const projectedTotal = currentCount + expectedRemaining;

  const remainingFraction = hoursTotal > 0 ? clampNumber(hoursRemaining / hoursTotal, 0, 1) : 0;
  const processStd = Math.sqrt(Math.max(1, expectedRemaining * dispersion));
  const floorStd = Math.max(1, projectedTotal * 0.025);
  const capStd = Math.max(floorStd, projectedTotal * (0.03 + 0.12 * Math.sqrt(remainingFraction)));
  const std = Math.min(capStd, Math.max(floorStd, processStd * 1.2));

  const projectedRange = {
    low: Math.max(0, Math.floor(projectedTotal - std * 1.4)),
    high: Math.max(0, Math.ceil(projectedTotal + std * 1.4)),
  };

  const last12 = dailySlots.slice(-12);
  const recentPace12h =
    last12.length > 0 ? last12.reduce((sum, s) => sum + s.count, 0) / last12.length : tweetsPerHour;

  const confidence = calculateConfidence(
    hoursElapsed,
    hoursTotal,
    currentCount,
    recentPace12h,
    tweetsPerHour
  );
  const rateStability = getRateStability(recentPace12h, tweetsPerHour);

  const rangeProbabilities = buildRangeProbabilities(
    currentCount,
    projectedTotal,
    projectionRate,
    hoursRemaining,
    hourlyCounts
  );

  return {
    payload: {
      trackingId,
      title: data.title,
      currentCount,
      tweetsPerHour,
      pace24h,
      projectedTotal,
      projectedRange,
      confidence,
      rateStability,
      hoursElapsed,
      hoursRemaining,
      periodStart: data.startDate,
      periodEnd: data.endDate,
      rangeProbabilities,
    },
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const XTRACKER_API_URL = 'https://xtracker.polymarket.com/api';
  const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

  app.use(express.json());

  // Proxy for Polymarket API to avoid CORS issues
  app.get("/api/polymarket/events", async (req, res) => {
    try {
      const { query } = req.query;
      const baseParams = {
        active: 'true',
        closed: 'false',
        archived: 'false',
        ...(query ? { query: String(query) } : {})
      };

      // 1. Fetch Gamma events by volume + by endDate in parallel (primary sources)
      const [byVolume, byEndDate] = await Promise.all([
        fetch(`${GAMMA_API_URL}/events?${new URLSearchParams({ ...baseParams, limit: '50', order: 'volume24hr', ascending: 'false' })}`, { headers: BROWSER_HEADERS }),
        fetch(`${GAMMA_API_URL}/events?${new URLSearchParams({ ...baseParams, limit: '50', order: 'endDate', ascending: 'true' })}`, { headers: BROWSER_HEADERS }),
      ]);

      // 2. Fetch xtracker trackings after a delay to avoid rate-limit stacking
      await new Promise(r => setTimeout(r, 300));
      const xtrackerRes = await fetch(`${XTRACKER_API_URL}/users/elonmusk`, { headers: BROWSER_HEADERS });
      const xtrackerData = xtrackerRes.ok ? await xtrackerRes.json() : null;
      const trackings: Array<{ id: string; title: string; startDate: string; endDate: string; isActive?: boolean; slug?: string }> =
        xtrackerData?.data?.trackings ?? [];
      console.log(`[events] xtracker returned ${trackings.length} trackings`);

      if (!byVolume.ok) throw new Error('Failed to fetch from Polymarket');
      const volumeData: Record<string, unknown>[] = await byVolume.json();
      const endDateData: Record<string, unknown>[] = byEndDate.ok ? await byEndDate.json() : [];

      // Merge and deduplicate by id
      const seen = new Set<string>();
      const merged: Record<string, unknown>[] = [];
      for (const event of [...volumeData, ...endDateData]) {
        const id = event.id as string;
        if (!seen.has(id)) {
          seen.add(id);
          merged.push(event);
        }
      }

      // 3. For any xtracker tracking whose Gamma event isn't in the merged list yet,
      //    fetch it directly by slug pattern and add it
      // Slug lookup: sequential with delay to avoid rate-limit
      const missingTrackings = trackings
        .filter(t => t.isActive !== false)
        .filter(t => {
          const trackingEndMs = new Date(t.endDate).getTime();
          // Only consider "already present" if there's an Elon-related event with a matching endDate
          return !merged.some(e => {
            const title = ((e.title as string) || '').toLowerCase();
            if (!title.includes('elon') && !title.includes('musk')) return false;
            return Math.abs(new Date(e.endDate as string).getTime() - trackingEndMs) < 24 * 60 * 60 * 1000;
          });
        });

      console.log(`[events] ${missingTrackings.length} trackings need slug lookup`);
      const slugResults: (Record<string, unknown> | null)[] = [];
      for (const t of missingTrackings) {
        const slug = t.title
          .toLowerCase()
          .replace(/\b\d{4}\b/g, '')
          .replace(/[#]/g, 'of')
          .replace(/[^a-z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/-$/, '');
        console.log(`[slug-lookup] trying: ${slug}`);
        await new Promise(r => setTimeout(r, 200));
        try {
          const r = await fetch(`${GAMMA_API_URL}/events?slug=${encodeURIComponent(slug)}`, { headers: BROWSER_HEADERS });
          if (!r.ok) { slugResults.push(null); continue; }
          const data: Record<string, unknown>[] = await r.json();
          if (data[0]) {
            console.log(`[slug-lookup] found: ${slug} -> id ${data[0].id}`);
            // Inject xtracker trackingId so frontend can match it in countsMap
            slugResults.push({ ...data[0], trackingId: t.id });
          } else {
            slugResults.push(null);
          }
        } catch {
          console.warn(`[slug-lookup] failed for: ${slug}`);
          slugResults.push(null);
        }
      }
      for (const event of slugResults) {
        if (!event) continue;
        const id = event.id as string;
        if (!seen.has(id)) {
          seen.add(id);
          merged.push(event);
        }
      }

      // Override trackingId for all Elon events using xtracker as source of truth.
      // Match by title keyword overlap (month + day numbers) — more reliable than endDate proximity.
      const enriched = merged.map(event => {
        if (!(event.title as string || '').toLowerCase().includes('elon')) return event;
        const eventTitle = (event.title as string).toLowerCase();
        // Extract month names and numbers from title e.g. "march 20" "march 27"
        const titleWords: string[] = eventTitle.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2})\b/g) || [];
        let bestMatch: typeof trackings[0] | null = null;
        let bestScore = 0;
        for (const t of trackings) {
          const trackTitle = t.title.toLowerCase();
          const trackWords: string[] = trackTitle.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2})\b/g) || [];
          const score = titleWords.filter(w => trackWords.includes(w)).length;
          if (score > bestScore) { bestScore = score; bestMatch = t; }
        }
        // Require at least 3 matching words to be confident
        const match = bestScore >= 3 ? bestMatch : null;
        if (match) return { ...event, trackingId: match.id };
        return event;
      });

      res.json(enriched);
    } catch (error) {
      console.error('Proxy error:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  });

  app.post("/api/polymarket/hero-replay/capture", async (req, res) => {
    try {
      const { event } = req.body ?? {};

      if (!event || typeof event !== 'object') {
        return res.status(400).json({ error: 'event payload required' });
      }

      const candidateEvent = event as Partial<PolymarketEvent>;
      if (!candidateEvent.id || !candidateEvent.title || !candidateEvent.endDate || !Array.isArray(candidateEvent.markets)) {
        return res.status(400).json({ error: 'invalid event payload' });
      }

      const capture = await captureHeroReplaySnapshot(candidateEvent as PolymarketEvent);

      res.json({
        captured: capture.didAppend,
        snapshot: capture.snapshot,
      });
    } catch (error) {
      console.error('Hero replay capture error:', error);
      res.status(500).json({ error: 'Failed to capture hero replay snapshot' });
    }
  });

  app.get("/api/polymarket/hero-replay/history", async (req, res) => {
    try {
      const { eventId, slug } = req.query;

      if (!eventId || typeof eventId !== 'string') {
        return res.status(400).json({ error: 'eventId query param required' });
      }

      const snapshots = await readHeroReplaySnapshots({
        eventId,
        eventSlug: typeof slug === 'string' ? slug : undefined,
      });
      const series = normalizeHeroReplaySnapshots(snapshots);
      const payload: HeroReplayHistoryPayload = {
        availability: buildHeroReplayAvailability(series),
        series,
      };

      res.json(payload);
    } catch (error) {
      console.error('Hero replay history error:', error);
      res.status(500).json({ error: 'Failed to load hero replay history' });
    }
  });

  // Proxy para obtener todos los contadores activos de un usuario
  app.get("/api/polymarket/active-counts/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const userRes = await fetch(`${XTRACKER_API_URL}/users/${userId}`);
      if (!userRes.ok) throw new Error('Failed to fetch from XTracker');
      const userData = await userRes.json();
      // Revertimos al formato que funcionaba antes
      res.json({ data: userData.data || [] });
    } catch (error) {
      console.error('Active counts error:', error);
      res.status(500).json({ error: 'Failed to fetch active counts' });
    }
  });

  // Proxy para obtener el contador de tweets (Trackings)
  app.get("/api/polymarket/trackings/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const response = await fetch(`${XTRACKER_API_URL}/trackings/${id}?includeStats=true`);
      if (!response.ok) throw new Error('Failed to fetch tracking stats from XTracker');
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Tracking proxy error:', error);
      res.status(500).json({ error: 'Failed to fetch tracking' });
    }
  });

  // Tweet projection endpoint with calculated stats and range probabilities
  app.get("/api/polymarket/tweet-projection/:trackingId", async (req, res) => {
    try {
      const { trackingId } = req.params;
      const response = await fetch(`${XTRACKER_API_URL}/trackings/${trackingId}?includeStats=true`);

      if (!response.ok) {
        return res.status(500).json({ error: 'Failed to fetch tracking from XTracker' });
      }

      const json = await response.json();
      const data = json.data;

      if (!data || !data.stats) {
        return res.status(500).json({ error: 'Missing stats in XTracker response' });
      }

      const projection = buildProjectionMetrics(trackingId, data);
      if (projection.error) {
        return res.status(404).json(projection.error);
      }

      res.json(projection.payload);
    } catch (error) {
      console.error('Tweet projection error:', error);
      res.status(500).json({ error: 'Failed to calculate tweet projection' });
    }
  });

  // Tweet projection by event endDate/slug — matches xtracker tracking by date proximity or slug keywords
  app.get("/api/polymarket/tweet-projection-by-date", async (req, res) => {
    try {
      const { endDate, slug } = req.query;
      if (!endDate || typeof endDate !== 'string') {
        return res.status(400).json({ error: 'endDate query param required' });
      }

      // Fetch all trackings for elonmusk
      const userRes = await fetch(`${XTRACKER_API_URL}/users/elonmusk`);
      if (!userRes.ok) throw new Error('Failed to fetch user from XTracker');
      const userData = await userRes.json();
      const trackings: Array<{ id: string; title: string; startDate: string; endDate: string; isActive: boolean }> =
        userData?.data?.trackings ?? [];

      if (trackings.length === 0) {
        return res.status(404).json({ error: 'No trackings found for elonmusk' });
      }

      const activeTrackings = trackings.filter(t => t.isActive);

      // Primary match: by endDate proximity (within 2 days)
      const targetMs = new Date(endDate).getTime();
      const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

      let matched = activeTrackings
        .map(t => ({ ...t, diff: Math.abs(new Date(t.endDate).getTime() - targetMs) }))
        .filter(t => t.diff <= TWO_DAYS_MS)
        .sort((a, b) => a.diff - b.diff)[0];

      // Fallback: match by slug keywords if endDate match fails
      if (!matched && slug && typeof slug === 'string') {
        const slugWords = slug.toLowerCase().replace(/-/g, ' ').split(' ').filter(w => w.length > 2);
        matched = activeTrackings
          .map(t => {
            const titleLower = t.title.toLowerCase();
            const score = slugWords.filter(w => titleLower.includes(w)).length;
            return { ...t, diff: 0, score };
          })
          .filter(t => (t as typeof matched & { score: number }).score > 0)
          .sort((a, b) => (b as typeof matched & { score: number }).score - (a as typeof matched & { score: number }).score)[0];
      }

      if (!matched) {
        return res.status(404).json({ error: 'No matching tracking found for given endDate' });
      }

      // Fetch stats for matched tracking
      const statsRes = await fetch(`${XTRACKER_API_URL}/trackings/${matched.id}?includeStats=true`);
      if (!statsRes.ok) throw new Error('Failed to fetch tracking stats');
      const json = await statsRes.json();
      const data = json.data;

      if (!data || !data.stats) {
        return res.status(500).json({ error: 'Missing stats in XTracker response' });
      }

      const projection = buildProjectionMetrics(matched.id, data);
      if (projection.error) {
        return res.status(404).json(projection.error);
      }

      res.json(projection.payload);
    } catch (error) {
      console.error('Tweet projection by date error:', error);
      res.status(500).json({ error: 'Failed to calculate tweet projection' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
