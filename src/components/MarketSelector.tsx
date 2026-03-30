import React, { useState, useEffect, useCallback } from 'react';
import { searchMarkets, TrackingStats } from '../services/polymarket';
import { PolymarketEvent } from '../types';
import { Loader2, DollarSign, TrendingUp, Users, Activity } from 'lucide-react';

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
      setMarkets([...data]);
    } catch (error) {
      console.error('Failed to load markets:', error);
    } finally {
      setLoading(false);
    }
  };

  const countsMap = React.useMemo(() => {
    const map: Record<string, TrackingStats> = {};
    activeCounts.forEach(stat => {
      map[stat.id] = stat;
    });
    return map;
  }, [activeCounts]);

  useEffect(() => {
    loadMarkets();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, market: PolymarketEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(market);
    }
  }, [onSelect]);

  const formatCurrency = (value: number | undefined): string => {
    if (value === undefined || value === null) return '—';
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  };

  if (loading && markets.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 space-y-4"
        role="status"
        aria-label="Loading active events"
      >
        <Loader2 className="w-8 h-8 animate-spin opacity-20" aria-hidden="true" />
        <p className="font-mono text-[10px] uppercase tracking-widest opacity-40">Loading active events...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" aria-busy={loading}>
      <div className="flex justify-between items-center">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] opacity-50">Active Events</h2>
        <button
          onClick={() => {
            loadMarkets();
            onRefresh();
          }}
          disabled={loading}
          className="font-mono text-[10px] uppercase tracking-widest hover:underline disabled:opacity-40 flex items-center gap-2"
        >
          {loading && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
          Refresh Data
        </button>
      </div>

      {(() => {
        const getStartMs = (m: PolymarketEvent) => {
          const stat = m.trackingId ? countsMap[m.trackingId] : undefined;
          return stat?.startDate ? new Date(stat.startDate).getTime() : new Date(m.endDate || 0).getTime();
        };
        const getDurationDays = (m: PolymarketEvent) => {
          const stat = m.trackingId ? countsMap[m.trackingId] : undefined;
          if (stat?.startDate && stat?.endDate) {
            return (new Date(stat.endDate).getTime() - new Date(stat.startDate).getTime()) / 86400000;
          }
          return 7; // default to weekly if unknown
        };
        const sorted = [...markets].sort((a, b) => getStartMs(a) - getStartMs(b));
        const weekly = sorted.filter(m => getDurationDays(m) >= 5);
        const shortTerm = sorted.filter(m => getDurationDays(m) < 5);
        const renderCard = (market: PolymarketEvent) => (
          <div
            key={market.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(market)}
            onKeyDown={(e) => handleKeyDown(e, market)}
            className="border border-ink/10 p-6 hover:bg-ink hover:text-bg cursor-pointer transition-all group relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-ink focus:ring-offset-2"
            aria-label={`${market.title}. Volume: ${formatCurrency(market.volume)}. Liquidity: ${formatCurrency(market.liquidity)}. Press Enter to analyze.`}
          >
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] bg-ink/5 group-hover:bg-bg/10 px-2 py-1 rounded-sm uppercase tracking-wider">
                    {market.trackingId ? 'Live Tracking' : 'Standard'}
                  </span>
                  {market.trackingId && countsMap[market.trackingId] !== undefined && (() => {
                    const stat = countsMap[market.trackingId];
                    const started = !stat.startDate || new Date(stat.startDate) <= new Date();
                    return started ? (
                      <span
                        className="font-mono text-[10px] text-ink group-hover:text-bg font-bold"
                        aria-live="polite"
                      >
                        {stat.total.toLocaleString()} TWEETS
                      </span>
                    ) : null;
                  })()}
                </div>
                <span className="font-mono text-[10px] opacity-50 uppercase tracking-widest">
                  Ends: {market.endDate ? new Date(market.endDate).toLocaleDateString() : 'TBD'}
                </span>
              </div>

              <h3 className="font-serif italic text-xl md:text-2xl leading-tight mb-4 group-hover:translate-x-2 transition-transform duration-300">
                {market.title}
              </h3>

              {/* Market Counters */}
              <div className="grid grid-cols-4 gap-2 mb-4 py-3 border-y border-ink/10 group-hover:border-bg/20">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <DollarSign className="w-3 h-3 opacity-40" aria-hidden="true" />
                    <span className="font-mono text-[8px] uppercase opacity-40">Volume</span>
                  </div>
                  <span className="font-mono text-xs font-medium">{formatCurrency(market.volume)}</span>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Activity className="w-3 h-3 opacity-40" aria-hidden="true" />
                    <span className="font-mono text-[8px] uppercase opacity-40">Liquidity</span>
                  </div>
                  <span className="font-mono text-xs font-medium">{formatCurrency(market.liquidity)}</span>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingUp className="w-3 h-3 opacity-40" aria-hidden="true" />
                    <span className="font-mono text-[8px] uppercase opacity-40">Open Int.</span>
                  </div>
                  <span className="font-mono text-xs font-medium">{formatCurrency(market.openInterest)}</span>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Users className="w-3 h-3 opacity-40" aria-hidden="true" />
                    <span className="font-mono text-[8px] uppercase opacity-40">24h Vol</span>
                  </div>
                  <span className="font-mono text-xs font-medium">{formatCurrency(market.volume24hr)}</span>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2">
                <div className="flex gap-4">
                  <div className="space-y-1">
                    <span className="block font-mono text-[8px] uppercase opacity-40">Status</span>
                    {(() => {
                      const stat = market.trackingId ? countsMap[market.trackingId] : undefined;
                      const started = !stat?.startDate || new Date(stat.startDate) <= new Date();
                      if (!started) return (
                        <span className="block font-mono text-[10px] uppercase font-medium flex items-center gap-1.5">
                          <span className="relative flex h-2 w-2">
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-ink/40 group-hover:bg-bg/40"></span>
                          </span>
                          <span className="opacity-50">
                            Starting {new Date(stat!.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </span>
                      );
                      const hoursElapsed = stat?.startDate ? (Date.now() - new Date(stat.startDate).getTime()) / 3600000 : 99;
                      // Use xtracker endDate (precise) if available, else fall back to Gamma endDate + 16h offset
                      const endMs = stat?.endDate
                        ? new Date(stat.endDate).getTime()
                        : market.endDate ? new Date(market.endDate).getTime() + 16 * 3600000 : null;
                      const hoursUntilEnd = endMs ? (endMs - Date.now()) / 3600000 : 999;
                      // Warmup only if: early in the tracking period AND not ending within 8h
                      const warming = market.trackingId && hoursUntilEnd > 8 && (!stat || stat.total < 20 || hoursElapsed < 4);
                      return warming ? (
                        <span className="block font-mono text-[10px] uppercase font-medium flex items-center gap-1.5">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-warning"></span>
                          </span>
                          <span className="text-warning group-hover:text-bg">Warmup</span>
                        </span>
                      ) : (
                        <span className="block font-mono text-[10px] uppercase font-medium flex items-center gap-1.5">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-positive opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-positive"></span>
                          </span>
                          <span className="text-positive group-hover:text-bg">Active</span>
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <span className="font-mono text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                  ANALYZE STRATEGY →
                </span>
              </div>
            </div>

            <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-ink/5 group-hover:bg-bg/5 rounded-full blur-2xl transition-colors" aria-hidden="true" />
          </div>
        );

        return (
          <div className="space-y-10">
            {weekly.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-40">Weekly Events</h3>
                <div className="grid grid-cols-1 gap-6">
                  {weekly.map(m => <React.Fragment key={m.id}>{renderCard(m)}</React.Fragment>)}
                </div>
              </div>
            )}
            {shortTerm.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-40">Short-Term Events</h3>
                <div className="grid grid-cols-1 gap-6">
                  {shortTerm.map(m => <React.Fragment key={m.id}>{renderCard(m)}</React.Fragment>)}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {markets.length === 0 && !loading && (
        <div className="text-center py-20 border border-dashed border-ink/20" role="status">
          <p className="font-serif italic text-lg opacity-40">No active events found at the moment.</p>
        </div>
      )}
    </div>
  );
}
