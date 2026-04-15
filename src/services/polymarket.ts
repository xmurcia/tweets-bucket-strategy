import type { HeroReplayHistoryPayload, TrackingStats } from '../types';
import { PolymarketEvent, Bucket, TweetProjection, ProjectionInsufficient } from '../types';
import { isDateInPast } from '../utils/datetime';

export type { TrackingStats } from '../types';

export interface TokenQuote {
  ask?: number;
  bid?: number;
  spread?: number;
}

export interface ElonPost {
  id: string;
  text: string;
  createdAt: string;
  url: string;
}

export interface ElonPostAuthor {
  name: string;
  handle: string;
  avatarUrl: string | null;
}

export interface GetElonPostsParams {
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface ElonPostsResponse {
  author: ElonPostAuthor;
  items: ElonPost[];
}

export async function getElonPosts(params: GetElonPostsParams): Promise<ElonPostsResponse> {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.limit !== undefined) query.set('limit', String(params.limit));

  const queryString = query.toString();
  const response = await fetch(`/api/polymarket/elon-posts${queryString ? `?${queryString}` : ''}`);
  if (!response.ok) {
    throw new Error('Failed to fetch Elon posts');
  }

  return await response.json() as ElonPostsResponse;
}

export async function searchMarkets(query: string): Promise<PolymarketEvent[]> {
  try {
    const response = await fetch(`/api/polymarket/events?query=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Failed to fetch events');
    const data = await response.json();
    
    // Filtrado estricto por TÍTULO del evento: "elon" y "tweets"
    const nowMs = Date.now();

    return data
      .filter((e: PolymarketEvent) => {
        const title = e.title.toLowerCase();
        return title.includes('elon') && title.includes('tweets');
      })
      .map((e: PolymarketEvent) => ({
        ...e,
        trackingId: e.trackingId || (e.markets?.[0] as unknown as Record<string, string>)?.trackingId
      }))
      .filter((e: PolymarketEvent) => !isDateInPast(e.endDate, nowMs));
  } catch (error) {
    console.error('Error searching events:', error);
    return [];
  }
}

export async function captureHeroReplaySnapshot(event: PolymarketEvent): Promise<void> {
  try {
    const response = await fetch('/api/polymarket/hero-replay/capture', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event }),
    });

    if (!response.ok) {
      throw new Error('Failed to capture hero replay snapshot');
    }
  } catch (error) {
    console.error('Error capturing hero replay snapshot:', error);
  }
}

export async function getHeroReplayHistory(event: Pick<PolymarketEvent, 'id' | 'slug'>): Promise<HeroReplayHistoryPayload> {
  const params = new URLSearchParams({ eventId: event.id });
  if (event.slug) {
    params.set('slug', event.slug);
  }

  const response = await fetch(`/api/polymarket/hero-replay/history?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Failed to fetch hero replay history');
  }

  return await response.json() as HeroReplayHistoryPayload;
}

export function parseNumericField(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseJsonStringArray(value: unknown): string[] | null {
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;

    const normalized = parsed.map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item === 'number' && Number.isFinite(item)) return String(item);
      return null;
    });

    if (normalized.some((item) => item === null)) return null;
    return normalized as string[];
  } catch {
    return null;
  }
}

export async function getTokenQuotes(tokenIds: string[]): Promise<Record<string, TokenQuote>> {
  const uniqueTokenIds = Array.from(new Set(tokenIds.filter(Boolean)));
  if (uniqueTokenIds.length === 0) return {};

  try {
    const params = new URLSearchParams({ tokenIds: uniqueTokenIds.join(',') });
    const response = await fetch(`/api/polymarket/token-quotes?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch token quotes');

    const payload = await response.json() as {
      quotes?: Record<string, { ask?: number | string; bid?: number | string; spread?: number | string }>;
    };

    const quotes = payload.quotes ?? {};
    const normalized: Record<string, TokenQuote> = {};

    for (const [tokenId, quote] of Object.entries(quotes)) {
      normalized[tokenId] = {
        ask: parseNumericField(quote.ask),
        bid: parseNumericField(quote.bid),
        spread: parseNumericField(quote.spread),
      };
    }

    return normalized;
  } catch (error) {
    console.error('Error fetching token quotes:', error);
    return {};
  }
}

export async function getActiveCounts(): Promise<TrackingStats[]> {
  try {
    const response = await fetch(`/api/polymarket/active-counts/elonmusk`);
    if (!response.ok) throw new Error('Failed to fetch active counts');
    const json = await response.json();
    
    // Manejo robusto: data puede ser un array o un objeto con trackings
    const rawData = json.data || [];
    const trackings = Array.isArray(rawData) ? rawData : (rawData.trackings || []);
    
    const statsPromises = trackings.map(async (d: { id: string; title?: string }) => {
      const stats = await getTrackingStats(d.id);
      if (stats) {
        return {
          ...stats,
          title: d.title
        };
      }
      return null;
    });
    
    const results = await Promise.all(statsPromises);
    return results.filter(Boolean) as TrackingStats[];
  } catch (error) {
    console.error('Error fetching active counts:', error);
    return [];
  }
}

export async function getTrackingStats(trackingId: string): Promise<TrackingStats | null> {
  try {
    const response = await fetch(`/api/polymarket/trackings/${trackingId}`);
    if (!response.ok) return null;
    const json = await response.json();
    const d = json.data || {};
    
    const now = new Date();
    let calculatedDaysElapsed = 0;
    if (d.startDate) {
      const startDate = new Date(d.startDate);
      const elapsedMs = now.getTime() - startDate.getTime();
      calculatedDaysElapsed = Math.max(0, elapsedMs / (1000 * 60 * 60 * 24));
    }
    
    let metricsObj = d.metrics || d.stats || {};
    if (typeof metricsObj === 'string') {
      try {
        metricsObj = JSON.parse(metricsObj);
      } catch {
        metricsObj = {};
      }
    }
    const metrics = metricsObj.stats || metricsObj;
    const total = metrics.total ?? metrics.count ?? metrics.current ?? metrics.currentValue ?? metrics.value ?? d.stats?.total ?? d.stats?.cumulative ?? d.total ?? d.count ?? d.current ?? d.currentValue ?? d.value ?? d.target ?? d.targetValue ?? 0;
    if (total === 0) {
      console.warn(`[getTrackingStats] No well-known field yielded a number above 0 for trackingId: ${trackingId}`);
    }
    const daysElapsed = metrics.daysElapsed ?? d.daysElapsed ?? calculatedDaysElapsed;
    
    return {
      id: trackingId,
      total,
      daysElapsed,
      startDate: d.startDate ?? "",
      endDate: d.endDate ?? ""
    };
  } catch (error) {
    console.error('Error fetching tracking stats:', error);
    return null;
  }
}

export function parseBuckets(event: PolymarketEvent): Bucket[] {
  const allBuckets: Bucket[] = [];

  event.markets.forEach((market) => {
    if (market.closed) return;

    try {
      const outcomes = parseJsonStringArray(market.outcomes);
      const outcomePrices = parseJsonStringArray(market.outcomePrices);
      const tokenIds = parseJsonStringArray(market.clobTokenIds);

      if (!outcomes || !outcomePrices || !tokenIds) {
        console.warn(`[parseBuckets] Skipping invalid market ${market.id}: malformed outcomes/outcomePrices/clobTokenIds`);
        return;
      }

      if (
        outcomes.length === 0 ||
        outcomePrices.length === 0 ||
        tokenIds.length === 0 ||
        outcomes.length !== outcomePrices.length ||
        outcomes.length !== tokenIds.length
      ) {
        console.warn(`[parseBuckets] Skipping invalid market ${market.id}: inconsistent outcome arrays`);
        return;
      }

      const marketBestAsk = parseNumericField(market.bestAsk);
      const marketBestBid = parseNumericField(market.bestBid);
      const marketSpread =
        marketBestAsk !== undefined && marketBestBid !== undefined
          ? (marketBestAsk - marketBestBid) * 100
          : undefined;

      // Caso 1: Mercado binario (Yes/No)
      // Extraemos el rango de la pregunta
      if (outcomes.length === 2 && outcomes.includes('Yes') && outcomes.includes('No')) {
        const yesIndex = outcomes.indexOf('Yes');

        // Intentar extraer el rango de la pregunta (ej: "300-319" o "320+")
        const q = market.question;
        const rangeMatch = q.match(/(\d+)-(\d+)/);
        const plusMatch = q.match(/(\d+)\+/);

        let bucketName: string;
        if (rangeMatch) {
          bucketName = rangeMatch[0];
        } else if (plusMatch) {
          bucketName = plusMatch[0];
        } else {
          // Si no hay rango claro, usamos la pregunta simplificada
          bucketName = q.replace(/Will Elon Musk tweet |times\?/gi, '').trim();
        }

        allBuckets.push({
          id: `${market.id}-${yesIndex}`,
          name: bucketName,
          price: marketBestAsk !== undefined && marketBestAsk > 0
            ? marketBestAsk
            : parseNumericField(outcomePrices[yesIndex]) ?? 0,
          tokenId: tokenIds[yesIndex],
          spread: marketSpread,
        });
      }
      // Caso 2: Mercado categórico (múltiples outcomes en un solo mercado)
      else {
        outcomes.forEach((name: string, index: number) => {
          allBuckets.push({
            id: `${market.id}-${index}`,
            name,
            // Gamma only exposes market-level bestAsk, so for categorical outcomes
            // we keep per-outcome prices as fallback until per-outcome ask is available.
            price: parseNumericField(outcomePrices[index]) ?? 0,
            tokenId: tokenIds[index],
          });
        });
      }
    } catch (error) {
      console.warn(`[parseBuckets] Skipping invalid market ${market.id}:`, error);
    }
  });

  // Ordenar buckets por el valor numérico inicial
  return allBuckets.sort((a, b) => {
    const valA = parseInt(a.name.match(/\d+/)?.[0] || '0');
    const valB = parseInt(b.name.match(/\d+/)?.[0] || '0');
    return valA - valB;
  });
}

export async function getTweetProjection(trackingId: string): Promise<TweetProjection | ProjectionInsufficient | null> {
  try {
    const response = await fetch(`/api/polymarket/tweet-projection/${trackingId}`);
    if (response.status === 404) {
      const body = await response.json().catch(() => ({}));
      if (body.error === 'Insufficient data for projection') {
        return { insufficient: true, hoursElapsed: body.hoursElapsed ?? 0, currentCount: body.currentCount ?? 0 };
      }
      return null;
    }
    if (!response.ok) return null;
    const data = await response.json();
    return data as TweetProjection;
  } catch (error) {
    console.error('Error fetching tweet projection:', error);
    return null;
  }
}

export async function getTweetProjectionByDate(endDate: string, slug?: string): Promise<TweetProjection | ProjectionInsufficient | null> {
  try {
    const params = new URLSearchParams({ endDate });
    if (slug) params.set('slug', slug);
    const response = await fetch(`/api/polymarket/tweet-projection-by-date?${params.toString()}`);
    if (response.status === 404) {
      const body = await response.json().catch(() => ({}));
      if (body.error === 'Insufficient data for projection') {
        return { insufficient: true, hoursElapsed: body.hoursElapsed ?? 0, currentCount: body.currentCount ?? 0 };
      }
      return null;
    }
    if (!response.ok) return null;
    return await response.json() as TweetProjection;
  } catch (error) {
    console.error('Error fetching tweet projection by date:', error);
    return null;
  }
}
