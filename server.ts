import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://polymarket.com',
  'Referer': 'https://polymarket.com/',
};

async function startServer() {
  const app = express();
  const PORT = 3000;
  const XTRACKER_API_URL = 'https://xtracker.polymarket.com/api';
  const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

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

      const now = Date.now();
      const startTime = new Date(data.startDate).getTime();
      const endTime = new Date(data.endDate).getTime();
      const currentCount = data.stats.total;

      const hoursElapsed = (now - startTime) / (1000 * 60 * 60);
      const hoursTotal = (endTime - startTime) / (1000 * 60 * 60);
      const hoursRemaining = Math.max(0, hoursTotal - hoursElapsed);

      // Require at least 4h of data and 20 tweets before projecting — otherwise the rate estimate is meaningless
      const MIN_HOURS = 4;
      const MIN_TWEETS = 20;
      if (hoursElapsed < MIN_HOURS || currentCount < MIN_TWEETS) {
        return res.status(404).json({ error: 'Insufficient data for projection', hoursElapsed, currentCount });
      }

      // Guard against division by zero
      const tweetsPerHour = hoursElapsed > 0 ? currentCount / hoursElapsed : 0;

      // Calculate true last-24h pace from hourly data (sum of last 24 hourly slots / 24)
      let pace24h: number | undefined;
      const daily: Array<{ date: string; count: number }> = data.stats.daily ?? [];
      if (daily.length >= 2) {
        const last24 = daily.slice(-24);
        const tweetsLast24h = last24.reduce((sum: number, d: { count: number }) => sum + d.count, 0);
        const hoursCovered = last24.length;
        const rate = hoursCovered > 0 ? tweetsLast24h / hoursCovered : 0;
        // Only use if meaningfully different from avg pace and plausible (< 50/hr)
        if (rate < 50 && Math.abs(rate - tweetsPerHour) > 0.2) {
          pace24h = rate;
        }
      }

      // Correct projection: what we have now + expected tweets in remaining time
      const projectedTotal = currentCount + tweetsPerHour * hoursRemaining;

      // Uncertainty narrows as the period advances — std scales with hoursRemaining fraction
      const remainingFraction = hoursTotal > 0 ? hoursRemaining / hoursTotal : 0;
      const baseUncertainty = projectedTotal * 0.15;
      const std = Math.max(1, baseUncertainty * Math.sqrt(remainingFraction));

      const projectedRange = {
        low: Math.floor(projectedTotal - std * 1.5),
        high: Math.ceil(projectedTotal + std * 1.5),
      };

      // Guard against hoursTotal = 0 (malformed API data)
      const confidence = hoursTotal > 0 ? Math.min(0.95, hoursElapsed / hoursTotal + 0.1) : 0;

      // Calculate range probabilities using normal distribution
      const mean = projectedTotal;

      const erf = (x: number): number => {
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x);
        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return sign * y;
      };

      const normalCdf = (x: number, m: number, s: number): number => {
        return 0.5 * (1 + erf((x - m) / (s * Math.sqrt(2))));
      };

      const rangeProbabilities: Array<{ range: string; rangeStart: number; rangeEnd: number; probability: number }> = [];

      // Calculate probabilities for ranges 160-179, 180-199, ..., 480-499
      for (let start = 160; start < 500; start += 20) {
        const end = start + 19;
        const cdfEnd = normalCdf(end, mean, std);
        const cdfStart = normalCdf(start - 1, mean, std);
        const probability = Math.max(0, cdfEnd - cdfStart);

        rangeProbabilities.push({
          range: `${start}-${end}`,
          rangeStart: start,
          rangeEnd: end,
          probability,
        });
      }

      // Add 500+ bucket
      rangeProbabilities.push({
        range: "500+",
        rangeStart: 500,
        rangeEnd: Infinity,
        probability: 1 - normalCdf(499, mean, std),
      });

      // Normalize probabilities to sum to 1
      const total = rangeProbabilities.reduce((sum, p) => sum + p.probability, 0);
      if (total > 0) {
        rangeProbabilities.forEach((p) => (p.probability /= total));
      }

      // Sort descending by probability
      rangeProbabilities.sort((a, b) => b.probability - a.probability);

      res.json({
        trackingId,
        title: data.title,
        currentCount,
        tweetsPerHour,
        pace24h,
        projectedTotal,
        projectedRange,
        confidence,
        hoursElapsed,
        hoursRemaining,
        periodStart: data.startDate,
        periodEnd: data.endDate,
        rangeProbabilities,
      });
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

      const now = Date.now();
      const startTime = new Date(data.startDate).getTime();
      const endTime = new Date(data.endDate).getTime();
      const currentCount = data.stats.total;

      const hoursElapsed = (now - startTime) / (1000 * 60 * 60);
      const hoursTotal = (endTime - startTime) / (1000 * 60 * 60);
      const hoursRemaining = Math.max(0, hoursTotal - hoursElapsed);

      // Require at least 4h of data and 20 tweets before projecting
      const MIN_HOURS = 4;
      const MIN_TWEETS = 20;
      if (hoursElapsed < MIN_HOURS || currentCount < MIN_TWEETS) {
        return res.status(404).json({ error: 'Insufficient data for projection', hoursElapsed, currentCount });
      }

      const tweetsPerHour = hoursElapsed > 0 ? currentCount / hoursElapsed : 0;
      let pace24h: number | undefined;
      const daily2: Array<{ date: string; count: number }> = data.stats.daily ?? [];
      if (daily2.length >= 2) {
        const last24 = daily2.slice(-24);
        const tweetsLast24h = last24.reduce((sum: number, d: { count: number }) => sum + d.count, 0);
        const rate = last24.length > 0 ? tweetsLast24h / last24.length : 0;
        if (rate < 50 && Math.abs(rate - tweetsPerHour) > 0.2) pace24h = rate;
      }
      // Correct projection: current count + expected remaining tweets
      const projectedTotal = currentCount + tweetsPerHour * hoursRemaining;

      // Uncertainty narrows as period advances
      const remainingFraction = hoursTotal > 0 ? hoursRemaining / hoursTotal : 0;
      const baseUncertainty = projectedTotal * 0.15;
      const std = Math.max(1, baseUncertainty * Math.sqrt(remainingFraction));

      const projectedRange = {
        low: Math.floor(projectedTotal - std * 1.5),
        high: Math.ceil(projectedTotal + std * 1.5),
      };
      const confidence = hoursTotal > 0 ? Math.min(0.95, hoursElapsed / hoursTotal + 0.1) : 0;

      const mean = projectedTotal;

      const erf = (x: number): number => {
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x);
        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return sign * y;
      };
      const normalCdf = (x: number, m: number, s: number) => 0.5 * (1 + erf((x - m) / (s * Math.sqrt(2))));

      const rangeProbabilities: Array<{ range: string; rangeStart: number; rangeEnd: number; probability: number }> = [];
      for (let start = 160; start < 500; start += 20) {
        const end = start + 19;
        rangeProbabilities.push({
          range: `${start}-${end}`, rangeStart: start, rangeEnd: end,
          probability: Math.max(0, normalCdf(end, mean, std) - normalCdf(start - 1, mean, std)),
        });
      }
      rangeProbabilities.push({ range: '500+', rangeStart: 500, rangeEnd: Infinity, probability: 1 - normalCdf(499, mean, std) });

      const totalProb = rangeProbabilities.reduce((s, p) => s + p.probability, 0);
      if (totalProb > 0) rangeProbabilities.forEach(p => (p.probability /= totalProb));
      rangeProbabilities.sort((a, b) => b.probability - a.probability);

      res.json({
        trackingId: matched.id, title: data.title, currentCount,
        tweetsPerHour, pace24h, projectedTotal, projectedRange, confidence,
        hoursElapsed, hoursRemaining,
        periodStart: data.startDate, periodEnd: data.endDate,
        rangeProbabilities,
      });
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
