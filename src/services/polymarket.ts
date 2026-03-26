import { PolymarketEvent, Bucket } from '../types';

export async function searchMarkets(query: string): Promise<PolymarketEvent[]> {
  try {
    const response = await fetch(`/api/polymarket/events?query=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Failed to fetch events');
    const data = await response.json();
    
    // Filtrado estricto por TÍTULO del evento: "elon" y "tweets"
    return data
      .filter((e: PolymarketEvent) => {
        const title = e.title.toLowerCase();
        return title.includes('elon') && title.includes('tweets');
      })
      .map((e: PolymarketEvent) => ({
        ...e,
        trackingId: e.trackingId || (e.markets?.[0] as unknown as Record<string, string>)?.trackingId
      }));
  } catch (error) {
    console.error('Error searching events:', error);
    return [];
  }
}

export interface TrackingStats {
  id: string;
  total: number;
  daysElapsed: number;
  startDate: string;
  endDate: string;
  title?: string;
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
    const startDate = new Date(d.startDate);
    const elapsedMs = now.getTime() - startDate.getTime();
    const calculatedDaysElapsed = Math.max(0, elapsedMs / (1000 * 60 * 60 * 24));
    
    let metricsObj = d.metrics || d.stats || {};
    if (typeof metricsObj === 'string') {
      try {
        metricsObj = JSON.parse(metricsObj);
      } catch {
        metricsObj = {};
      }
    }
    const metrics = metricsObj.stats || metricsObj;
    const total = metrics.total ?? metrics.count ?? metrics.current ?? metrics.currentValue ?? metrics.value ?? d.total ?? d.count ?? d.current ?? d.currentValue ?? d.value ?? d.target ?? d.targetValue ?? (Number(d.metrics) || 0);
    const daysElapsed = metrics.daysElapsed ?? d.daysElapsed ?? calculatedDaysElapsed;
    
    return {
      id: trackingId,
      total,
      daysElapsed,
      startDate: d.startDate,
      endDate: d.endDate
    };
  } catch (error) {
    console.error('Error fetching tracking stats:', error);
    return null;
  }
}

export function parseBuckets(event: PolymarketEvent): Bucket[] {
  try {
    const allBuckets: Bucket[] = [];
    
    event.markets.forEach(market => {
      if (market.closed) return;
      
      const outcomes = JSON.parse(market.outcomes);
      const prices = JSON.parse(market.outcomePrices);
      const tokenIds = JSON.parse(market.clobTokenIds);

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
          bucketName = q.replace(/Will Elon Musk tweet | times\?|/gi, '').trim();
        }

        allBuckets.push({
          id: `${market.id}-${yesIndex}`,
          name: bucketName,
          price: parseFloat(prices[yesIndex] || '0'),
          tokenId: tokenIds[yesIndex],
        });
      } 
      // Caso 2: Mercado categórico (múltiples outcomes en un solo mercado)
      else {
        outcomes.forEach((name: string, index: number) => {
          allBuckets.push({
            id: `${market.id}-${index}`,
            name,
            price: parseFloat(prices[index] || '0'),
            tokenId: tokenIds[index],
          });
        });
      }
    });

    // Ordenar buckets por el valor numérico inicial
    return allBuckets.sort((a, b) => {
      const valA = parseInt(a.name.match(/\d+/)?.[0] || '0');
      const valB = parseInt(b.name.match(/\d+/)?.[0] || '0');
      return valA - valB;
    });
  } catch (e) {
    console.error('Error parsing buckets from event:', e);
    return [];
  }
}
