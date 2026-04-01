import React, { useState, useMemo, useRef, useEffect } from 'react';
import { MarketSelector } from './components/MarketSelector';
import { BucketList } from './components/BucketList';
import { BetCalculator } from './components/BetCalculator';
import { PolymarketEvent, TweetProjection, ProjectionInsufficient } from './types';
import { searchMarkets, parseBuckets, getTrackingStats, getActiveCounts, getTweetProjection, getTweetProjectionByDate, TrackingStats } from './services/polymarket';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Info, TrendingUp, Sun, Moon, Copy, RotateCw } from 'lucide-react';
import { StatsModule } from './components/StatsModule';
import { StrategyTabs } from './components/StrategyTabs';

export default function App() {
  const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const AUTO_REFRESH_RETRY_DELAY_MS = 10 * 1000;
  const MANUAL_REFRESH_COOLDOWN_MS = 20 * 1000;

  const [selectedMarket, setSelectedMarket] = useState<PolymarketEvent | null>(null);
  const [selectedBucketIds, setSelectedBucketIds] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState<number>(100);
  const [currentStats, setCurrentStats] = useState<TrackingStats | null>(null);
  const [activeCounts, setActiveCounts] = useState<TrackingStats[]>([]);
  const [tweetProjection, setTweetProjection] = useState<TweetProjection | null>(null);
  const [projectionInsufficient, setProjectionInsufficient] = useState<ProjectionInsufficient | null>(null);
  const [dark, setDark] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [nextAutoRefreshAt, setNextAutoRefreshAt] = useState<number | null>(null);
  const [manualCooldownUntil, setManualCooldownUntil] = useState<number | null>(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedMarketRef = useRef<PolymarketEvent | null>(null);
  const refreshRequestIdRef = useRef(0);
  const refreshInFlightRef = useRef(false);

  const TIPS_ADDRESS = '0x137789060E41030417b7835B6647EFe9b712F6F3';
  const truncatedAddress = `${TIPS_ADDRESS.slice(0, 6)}...${TIPS_ADDRESS.slice(-4)}`;

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(TIPS_ADDRESS).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
  };

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

  useEffect(() => {
    const ticker = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(ticker);
  }, []);

  const refreshMarketData = React.useCallback(async (market: PolymarketEvent, refreshEventData = true) => {
    const requestId = ++refreshRequestIdRef.current;
    const isCurrentRequest = () => refreshRequestIdRef.current === requestId;

    let marketForDetail = market;

    if (refreshEventData) {
      const markets = await searchMarkets('Elon Musk');
      if (!isCurrentRequest()) return;

      const refreshed = markets.find(m => m.id === market.id || (market.slug && m.slug === market.slug));
      if (refreshed) {
        marketForDetail = refreshed;
        if (isCurrentRequest()) {
          setSelectedMarket(prev => (prev && prev.id === refreshed.id ? refreshed : prev));
        }
        const availableBucketIds = new Set(parseBuckets(refreshed).map(b => b.id));
        if (isCurrentRequest()) {
          setSelectedBucketIds(prev => {
            const next = new Set<string>();
            for (const id of prev) {
              if (availableBucketIds.has(id)) {
                next.add(id);
              }
            }
            return next.size === prev.size ? prev : next;
          });
        }
      }
    }

    if (marketForDetail.trackingId) {
      const stats = await getTrackingStats(marketForDetail.trackingId);
      if (!isCurrentRequest()) return;
      setCurrentStats(stats);
    } else {
      if (!isCurrentRequest()) return;
      setCurrentStats(null);
    }

    const result = marketForDetail.trackingId
      ? await getTweetProjection(marketForDetail.trackingId)
      : marketForDetail.endDate
        ? await getTweetProjectionByDate(marketForDetail.endDate, marketForDetail.slug)
        : null;
    if (!isCurrentRequest()) return;

    if (result && 'insufficient' in result) {
      setProjectionInsufficient(result);
      setTweetProjection(null);
    } else {
      setTweetProjection(result as TweetProjection | null);
      setProjectionInsufficient(null);
    }
  }, []);

  useEffect(() => {
    selectedMarketRef.current = selectedMarket;
  }, [selectedMarket]);

  const clearAutoRefresh = React.useCallback(() => {
    if (autoRefreshRef.current !== null) {
      clearTimeout(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
  }, []);

  const scheduleAutoRefresh = React.useCallback((delayMs = AUTO_REFRESH_INTERVAL_MS) => {
    clearAutoRefresh();
    const nextAt = Date.now() + delayMs;
    setNextAutoRefreshAt(nextAt);

    autoRefreshRef.current = window.setTimeout(async () => {
      const market = selectedMarketRef.current;
      if (!market) {
        setNextAutoRefreshAt(null);
        return;
      }

      if (refreshInFlightRef.current) {
        scheduleAutoRefresh(AUTO_REFRESH_RETRY_DELAY_MS);
        return;
      }

      refreshInFlightRef.current = true;
      try {
        await refreshMarketData(market);
      } catch (error) {
        console.error('Auto refresh failed:', error);
      } finally {
        refreshInFlightRef.current = false;
        if (selectedMarketRef.current) {
          scheduleAutoRefresh(AUTO_REFRESH_INTERVAL_MS);
        } else {
          setNextAutoRefreshAt(null);
        }
      }
    }, delayMs);
  }, [AUTO_REFRESH_INTERVAL_MS, AUTO_REFRESH_RETRY_DELAY_MS, clearAutoRefresh, refreshMarketData]);

  const selectedMarketId = selectedMarket?.id;

  useEffect(() => {
    if (!selectedMarketId) {
      clearAutoRefresh();
      setNextAutoRefreshAt(null);
      setManualCooldownUntil(null);
      return;
    }

    scheduleAutoRefresh();

    return () => {
      clearAutoRefresh();
    };
  }, [clearAutoRefresh, scheduleAutoRefresh, selectedMarketId]);

  const handleManualRefresh = async () => {
    const market = selectedMarketRef.current;
    const remainingCooldownMs = manualCooldownUntil ? manualCooldownUntil - Date.now() : 0;
    if (!market || isManualRefreshing || refreshInFlightRef.current || remainingCooldownMs > 0) {
      return;
    }

    setManualCooldownUntil(Date.now() + MANUAL_REFRESH_COOLDOWN_MS);
    setIsManualRefreshing(true);
    refreshInFlightRef.current = true;
    try {
      await refreshMarketData(market);
      scheduleAutoRefresh();
    } finally {
      refreshInFlightRef.current = false;
      setIsManualRefreshing(false);
    }
  };

  const autoRefreshSecondsLeft = nextAutoRefreshAt ? Math.max(0, Math.ceil((nextAutoRefreshAt - nowMs) / 1000)) : null;
  const manualCooldownSecondsLeft = manualCooldownUntil ? Math.max(0, Math.ceil((manualCooldownUntil - nowMs) / 1000)) : 0;
  const manualRefreshDisabled = !selectedMarket || isManualRefreshing || manualCooldownSecondsLeft > 0;

  const formatRemainingTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs.toString().padStart(2, '0')}s`;
  };

  const handleMarketSelect = async (market: PolymarketEvent) => {
    setSelectedMarket(market);
    setSelectedBucketIds(new Set());
    setTweetProjection(null);
    setProjectionInsufficient(null);

    await refreshMarketData(market, false);
  };

  const nextRefreshLabel = !selectedMarket
    ? 'Next refresh in -- (select market)'
    : `Next refresh in ${formatRemainingTime(autoRefreshSecondsLeft ?? 0)}`;

  return (
    <div className="min-h-screen max-w-6xl mx-auto px-4 py-12 md:py-20">
      <header className="mb-12 md:mb-20 space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="text-5xl md:text-7xl font-serif italic tracking-tighter">
            Musk <span className="not-italic font-sans font-bold uppercase text-2xl md:text-4xl tracking-normal">Oracle</span>
          </h1>
          <div className="flex w-full justify-end sm:w-auto">
            <div className="flex w-full flex-col items-end sm:w-auto">
              <div className="flex w-full items-center justify-between gap-2 border border-ink/20 px-2 py-1.5 sm:w-auto">
                <div className="min-w-0 font-mono text-[10px] uppercase tracking-widest opacity-70 whitespace-nowrap">
                  {manualCooldownSecondsLeft > 0
                    ? `${nextRefreshLabel} · Manual in ${formatRemainingTime(manualCooldownSecondsLeft)}`
                    : nextRefreshLabel}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      void handleManualRefresh();
                    }}
                    disabled={manualRefreshDisabled}
                    aria-label={isManualRefreshing ? 'Refreshing market detail' : 'Refresh market detail'}
                    className="p-2 border border-ink/20 hover:bg-ink hover:text-bg transition-colors focus:outline-none focus:ring-2 focus:ring-ink disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isManualRefreshing ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={toggleTheme}
                    aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                    className="p-2 border border-ink/20 hover:bg-ink hover:text-bg transition-colors focus:outline-none focus:ring-2 focus:ring-ink"
                  >
                    {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
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
                <Info className="w-4 h-4" aria-hidden="true" />
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
                    className="p-2 border border-ink/20 hover:bg-ink hover:text-bg transition-colors focus:outline-none focus:ring-2 focus:ring-ink"
                    aria-label="Go back to market selection"
                  >
                    <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <div className="flex-1">
                    <h2 className="text-2xl md:text-4xl font-serif italic leading-tight">
                      {selectedMarket.title}
                    </h2>
                    {(currentStats || tweetProjection || projectionInsufficient) && (() => {
                      const startDate = currentStats?.startDate || tweetProjection?.periodStart;
                      const started = !startDate || new Date(startDate) <= new Date();
                      if (!started) return (
                        <div className="mt-2 flex items-center gap-2" aria-live="polite">
                          <span className="font-mono text-sm uppercase tracking-wider opacity-50">
                            Starts {new Date(startDate!).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                      if (projectionInsufficient) return (
                        <div className="mt-2 flex items-center gap-2" aria-live="polite">
                          <span className="w-2 h-2 rounded-full animate-pulse bg-warning" aria-hidden="true" />
                          <span className="font-mono text-sm font-bold uppercase tracking-wider text-warning">
                            Warmup — {projectionInsufficient.currentCount.toLocaleString()} tweets
                          </span>
                        </div>
                      );
                      return null;
                    })()}
                  </div>
                </div>

                {(currentStats || tweetProjection || projectionInsufficient) && (() => {
                  const startDate = currentStats?.startDate || tweetProjection?.periodStart;
                  const started = !startDate || new Date(startDate) <= new Date();
                  if (!started) return null;
                  if (projectionInsufficient) return (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="border border-warning/40 p-4 flex items-center gap-3"
                    >
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning"></span>
                      </span>
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-warning block">Not enough reliable data</span>
                        <span className="font-mono text-xs opacity-60">
                          {projectionInsufficient.currentCount} tweets in {Math.max(0, projectionInsufficient.hoursElapsed).toFixed(1)}h — projections available after 4h / 20 tweets
                        </span>
                      </div>
                    </motion.div>
                  );
                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch"
                    >
                      <div className="lg:col-span-2">
                        <StatsModule
                          stats={currentStats ?? { id: tweetProjection!.trackingId, total: tweetProjection!.currentCount, daysElapsed: tweetProjection!.hoursElapsed / 24, startDate: tweetProjection!.periodStart, endDate: tweetProjection!.periodEnd }}
                          tweetProjection={tweetProjection}
                          buckets={buckets}
                        />
                      </div>
                      <div className="flex flex-col justify-between h-full gap-4">
                        {tweetProjection && tweetProjection.rangeProbabilities.length > 0 && (
                          <div className="p-4 border border-ink/10 space-y-3">
                            <span className="font-mono text-[10px] uppercase tracking-widest opacity-50 block">Top projected buckets</span>
                            <div className="space-y-2">
                              {[...tweetProjection.rangeProbabilities]
                                .sort((a, b) => b.probability - a.probability)
                                .slice(0, 3)
                                .map((rp, i) => (
                                  <div key={rp.range} className="flex items-center gap-2">
                                    <span className="font-mono text-[10px] opacity-30 w-3">{i + 1}</span>
                                    <div className="flex-1">
                                      <div className="flex justify-between mb-0.5">
                                        <span className="font-mono text-xs font-bold">{rp.range}</span>
                                        <span className="font-mono text-xs">{(rp.probability * 100).toFixed(1)}%</span>
                                      </div>
                                      <div className="w-full bg-ink/10 h-1">
                                        <div className="bg-ink h-full" style={{ width: `${Math.min(100, rp.probability * 100)}%` }} />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                        <div className="p-4 border border-dashed border-ink/20 space-y-3">
                          <h4 className="font-mono text-[10px] uppercase tracking-widest">Support the analyst</h4>
                          {selectedMarket.slug && (
                            <a
                              href={`https://polymarket.com/event/${selectedMarket.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block font-mono text-[10px] uppercase tracking-widest opacity-50 hover:opacity-100 hover:underline transition-opacity"
                            >
                              View on Polymarket →
                            </a>
                          )}
                          <a
                            href="https://polymarket.com/@polete"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center justify-between gap-2 rounded-sm border border-ink bg-ink text-bg px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors hover:bg-bg hover:text-ink focus:outline-none focus:ring-2 focus:ring-ink"
                          >
                            <span className="flex flex-col gap-0.5">
                              <span>@polete on Polymarket</span>
                              <span className="normal-case text-[9px] tracking-wide opacity-80">Leave me a tip on Polymarket</span>
                            </span>
                            <span aria-hidden="true">→</span>
                          </a>
                          <div className="rounded-md border border-ink/30 bg-ink text-bg p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[10px] uppercase tracking-widest block opacity-80">Tips (Polygon USDC)</span>
                              <span className="font-mono text-[9px] uppercase tracking-widest border border-bg/30 px-1.5 py-0.5">Wallet</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs tracking-wide" title={TIPS_ADDRESS}>{truncatedAddress}</span>
                              <button
                                onClick={handleCopyAddress}
                                aria-label="Copy wallet address"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-bg/30 bg-bg text-ink hover:bg-transparent hover:text-bg transition-colors focus:outline-none focus:ring-2 focus:ring-bg"
                              >
                                {copied ? (
                                  <span className="font-mono text-[9px] uppercase tracking-widest">Copied!</span>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" aria-hidden="true" />
                                    <span className="font-mono text-[9px] uppercase tracking-widest">Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })()}

                {buckets.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="border border-ink/10 p-6"
                  >
                    <StrategyTabs
                      buckets={buckets}
                      tweetProjection={tweetProjection}
                      budget={budget}
                      onApplyStrategy={setSelectedBucketIds}
                    />
                  </motion.div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                  <div className="order-1 lg:order-none lg:col-span-2 space-y-8">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 opacity-40" aria-hidden="true" />
                        <h3 className="font-mono text-xs uppercase tracking-[0.2em] opacity-50">Available Buckets</h3>
                      </div>
                      <BucketList
                        buckets={buckets}
                        selectedIds={selectedBucketIds}
                        onToggle={handleToggleBucket}
                      />
                    </div>
                  </div>

                  <aside className="order-2 lg:order-none space-y-8">
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
                                        <span className="text-ink">
                                          {diff > 0 ? `+${diff} needed` : "✓ Passed"}
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

                      <div className="mt-8 p-4 border border-dashed border-ink/20 rounded-sm space-y-3">
                        <h4 className="font-mono text-[10px] uppercase tracking-widest">Support the analyst</h4>
                        <a
                          href="https://polymarket.com/@polete"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-center justify-between gap-2 rounded-sm border border-ink bg-ink text-bg px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors hover:bg-bg hover:text-ink focus:outline-none focus:ring-2 focus:ring-ink"
                        >
                          <span className="flex flex-col gap-0.5">
                            <span>@polete on Polymarket</span>
                            <span className="normal-case text-[9px] tracking-wide opacity-80">Leave me a tip on Polymarket</span>
                          </span>
                          <span aria-hidden="true">→</span>
                        </a>
                        <div className="rounded-md border border-ink/30 bg-ink text-bg p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] uppercase tracking-widest block opacity-80">Tips (Polygon USDC)</span>
                            <span className="font-mono text-[9px] uppercase tracking-widest border border-bg/30 px-1.5 py-0.5">Wallet</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs tracking-wide" title={TIPS_ADDRESS}>{truncatedAddress}</span>
                            <button
                              onClick={handleCopyAddress}
                              aria-label="Copy wallet address"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-bg/30 bg-bg text-ink hover:bg-transparent hover:text-bg transition-colors focus:outline-none focus:ring-2 focus:ring-bg"
                            >
                              {copied ? (
                                <span className="font-mono text-[9px] uppercase tracking-widest">Copied!</span>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" aria-hidden="true" />
                                  <span className="font-mono text-[9px] uppercase tracking-widest">Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
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
