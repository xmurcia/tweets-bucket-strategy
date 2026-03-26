import React, { useState, useEffect } from 'react';
import { searchMarkets, getActiveCounts, TrackingStats } from '../services/polymarket';
import { PolymarketEvent } from '../types';
import { Loader2 } from 'lucide-react';

interface MarketSelectorProps {
  onSelect: (market: PolymarketEvent) => void;
  activeCounts: TrackingStats[];
  onRefresh: () => void;
}

export function MarketSelector({ onSelect, activeCounts, onRefresh }: MarketSelectorProps) {
  const [markets, setMarkets] = useState<PolymarketEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMarkets = async () => {
    setLoading(true);
    try {
      const data = await searchMarkets('Elon Musk');
      setMarkets(data);
    } catch (error) {
      console.error('Failed to load markets:', error);
    } finally {
      setLoading(false);
    }
  };

  const countsMap = React.useMemo(() => {
    const map: Record<string, number> = {};
    activeCounts.forEach(stat => {
      map[stat.id] = stat.total;
    });
    return map;
  }, [activeCounts]);

  useEffect(() => {
    loadMarkets();
  }, []);

  if (loading && markets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin opacity-20" />
        <p className="font-mono text-[10px] uppercase tracking-widest opacity-40">Loading active events...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-mono text-xs uppercase tracking-[0.2em] opacity-50">Active Events</h3>
        <button 
          onClick={() => {
            loadMarkets();
            onRefresh();
          }}
          className="font-mono text-[10px] uppercase tracking-widest hover:underline"
        >
          Refresh Data
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {markets.map((market) => (
          <div
            key={market.id}
            onClick={() => onSelect(market)}
            className="border border-ink/10 p-6 hover:bg-ink hover:text-bg cursor-pointer transition-all group relative overflow-hidden"
          >
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] bg-ink/5 group-hover:bg-bg/10 px-2 py-1 rounded-sm uppercase tracking-wider">
                    {market.trackingId ? 'Live Tracking' : 'Standard'}
                  </span>
                  {market.trackingId && countsMap[market.trackingId] !== undefined && (
                    <span className="font-mono text-[10px] text-green-600 group-hover:text-green-400 font-bold">
                      {countsMap[market.trackingId].toLocaleString()} TWEETS
                    </span>
                  )}
                </div>
                <span className="font-mono text-[10px] opacity-50 uppercase tracking-widest">
                  Ends: {new Date(market.endDate).toLocaleDateString()}
                </span>
              </div>
              
              <h3 className="font-serif italic text-xl md:text-2xl leading-tight mb-6 group-hover:translate-x-2 transition-transform duration-300">
                {market.title}
              </h3>

              <div className="flex justify-between items-center pt-4 border-t border-ink/10 group-hover:border-bg/20">
                <div className="flex gap-4">
                  <div className="space-y-1">
                    <span className="block font-mono text-[8px] uppercase opacity-40">Status</span>
                    <span className="block font-mono text-[10px] text-green-600 group-hover:text-green-400 uppercase">Active</span>
                  </div>
                </div>
                <span className="font-mono text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                  ANALYZE STRATEGY →
                </span>
              </div>
            </div>
            
            <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-ink/5 group-hover:bg-bg/5 rounded-full blur-2xl transition-colors" />
          </div>
        ))}
      </div>

      {markets.length === 0 && !loading && (
        <div className="text-center py-20 border border-dashed border-ink/20">
          <p className="font-serif italic text-lg opacity-40">No active events found at the moment.</p>
        </div>
      )}
    </div>
  );
}
