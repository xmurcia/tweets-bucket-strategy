import React, { useState, useMemo } from 'react';
import { MarketSelector } from './components/MarketSelector';
import { BucketList } from './components/BucketList';
import { BetCalculator } from './components/BetCalculator';
import { PolymarketEvent, Bucket } from './types';
import { parseBuckets, getTrackingStats, getActiveCounts, TrackingStats } from './services/polymarket';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Info, TrendingUp } from 'lucide-react';
import { StatsModule } from './components/StatsModule';

export default function App() {
  const [selectedMarket, setSelectedMarket] = useState<PolymarketEvent | null>(null);
  const [selectedBucketIds, setSelectedBucketIds] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState<number>(100);
  const [currentStats, setCurrentStats] = useState<TrackingStats | null>(null);
  const [activeCounts, setActiveCounts] = useState<TrackingStats[]>([]);

  const buckets = useMemo(() => {
    return selectedMarket ? parseBuckets(selectedMarket) : [];
  }, [selectedMarket]);

  const selectedBuckets = useMemo(() => {
    return buckets.filter(b => selectedBucketIds.has(b.id));
  }, [buckets, selectedBucketIds]);

  const handleToggleBucket = (id: string) => {
    const next = new Set(selectedBucketIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedBucketIds(next);
  };

  const loadActiveCounts = async () => {
    const counts = await getActiveCounts();
    setActiveCounts(counts);
  };

  React.useEffect(() => {
    loadActiveCounts();
  }, []);

  const handleMarketSelect = async (market: PolymarketEvent) => {
    setSelectedMarket(market);
    setSelectedBucketIds(new Set());
    
    // Try to find stats in pre-fetched activeCounts
    const preFetched = activeCounts.find(s => s.id === market.trackingId);
    if (preFetched) {
      setCurrentStats(preFetched);
    } else if (market.trackingId) {
      // Fallback to individual fetch
      const stats = await getTrackingStats(market.trackingId);
      setCurrentStats(stats);
    } else {
      setCurrentStats(null);
    }
  };

  return (
    <div className="min-h-screen max-w-6xl mx-auto px-4 py-12 md:py-20">
      <header className="mb-12 md:mb-20 space-y-4">
        <div className="flex justify-between items-baseline">
          <h1 className="text-5xl md:text-7xl font-serif italic tracking-tighter">
            Bucket <span className="not-italic font-sans font-bold uppercase text-2xl md:text-4xl tracking-normal">Strategy</span>
          </h1>
          <div className="font-mono text-[10px] uppercase tracking-widest opacity-50">
            Polymarket Analysis Tool v1.3
          </div>
        </div>
        <div className="h-px bg-ink w-full" />
      </header>

      <main>
        <AnimatePresence mode="wait">
          {!selectedMarket ? (
            <motion.section
              key="selector"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center gap-4 text-ink/60">
                <Info className="w-4 h-4" />
                <p className="font-serif italic text-lg">
                  Select an active categorical event to begin analyzing bucket coverage strategies.
                </p>
              </div>
              <MarketSelector 
                onSelect={handleMarketSelect} 
                activeCounts={activeCounts}
                onRefresh={loadActiveCounts}
              />
            </motion.section>
          ) : (
            <motion.section
              key="analysis"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-12"
            >
              <div className="space-y-8">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setSelectedMarket(null)}
                    className="p-2 border border-ink/20 hover:bg-ink hover:text-bg transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div className="flex-1">
                    <h2 className="text-2xl md:text-4xl font-serif italic leading-tight">
                      {selectedMarket.title}
                    </h2>
                    {currentStats && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="font-mono text-sm font-bold uppercase tracking-wider">
                          Live: {currentStats.total.toLocaleString()} tweets
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {currentStats && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <StatsModule stats={currentStats} />
                  </motion.div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                  <div className="lg:col-span-2 space-y-8">
                    <div className="bg-white/50 border border-ink/5 p-4 rounded-sm">
                      <p className="text-sm text-ink/70 leading-relaxed">
                        {selectedMarket.description}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 opacity-40" />
                        <h3 className="font-mono text-xs uppercase tracking-[0.2em] opacity-50">Available Buckets</h3>
                      </div>
                      <BucketList
                        buckets={buckets}
                        selectedIds={selectedBucketIds}
                        onToggle={handleToggleBucket}
                      />
                    </div>
                  </div>

                  <aside className="space-y-8">
                    <div className="sticky top-8">
                      <h3 className="font-mono text-xs uppercase tracking-[0.2em] mb-4 opacity-50">Betting Metrics</h3>
                      <BetCalculator
                        selectedBuckets={selectedBuckets}
                        budget={budget}
                        onBudgetChange={setBudget}
                      />
                      
                      <div className="mt-8 p-4 border border-dashed border-ink/20 rounded-sm space-y-3">
                        <h4 className="font-mono text-[10px] uppercase tracking-widest">Strategy Viability</h4>
                        {selectedBuckets.length > 0 ? (
                          <div className="space-y-4">
                            <p className="text-sm italic font-serif">
                              {selectedBuckets.reduce((sum, b) => sum + b.price, 0) > 0.8 
                                ? "High coverage strategy. Low risk, but lower potential profit."
                                : "Selective strategy. Higher risk, requires specific outcomes to hit."}
                            </p>
                            {currentStats && (
                              <div className="pt-4 border-t border-ink/10">
                                <span className="font-mono text-[10px] uppercase opacity-50 block mb-2">Distance to Buckets</span>
                                <div className="space-y-2">
                                  {selectedBuckets.map(b => {
                                    const match = b.name.match(/(\d+)/);
                                    if (!match) return null;
                                    const target = parseInt(match[0]);
                                    const diff = target - currentStats.total;
                                    return (
                                      <div key={b.id} className="flex justify-between text-[10px] font-mono">
                                        <span>{b.name}</span>
                                        <span className={diff > 0 ? "text-blue-600" : "text-green-600"}>
                                          {diff > 0 ? `+${diff} needed` : "Passed"}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm italic font-serif opacity-50">
                            Select buckets to see viability analysis.
                          </p>
                        )}
                      </div>
                    </div>
                  </aside>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <footer className="mt-24 pt-8 border-t border-ink/10 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="font-mono text-[10px] uppercase tracking-widest opacity-30">
          Data provided by Polymarket Gamma API
        </div>
        <div className="flex gap-6 font-mono text-[10px] uppercase tracking-widest opacity-30">
          <span>Real-time</span>
          <span>Categorical</span>
          <span>Analysis</span>
        </div>
      </footer>
    </div>
  );
}
