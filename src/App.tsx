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
  const selectedCoverage = selectedBuckets.reduce((sum, bucket) => sum + bucket.price, 0);

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

  const marketStartDate = currentStats?.startDate || tweetProjection?.periodStart;
  const marketStarted = !marketStartDate || new Date(marketStartDate) <= new Date();
  const detailStatus = !selectedMarket
    ? null
    : !marketStarted
      ? {
          label: 'Scheduled',
          tone: 'border-ink/15 bg-bg text-ink/70',
          detail: `Starts ${new Date(marketStartDate!).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        }
      : projectionInsufficient
        ? {
            label: 'Warmup',
            tone: 'border-warning/30 bg-warning/10 text-warning',
            detail: `${projectionInsufficient.currentCount.toLocaleString()} tweets so far`,
          }
        : {
            label: 'Live analysis',
            tone: 'border-positive/30 bg-positive/10 text-positive',
            detail: tweetProjection
              ? `Projected total ~${Math.round(tweetProjection.projectedTotal)}`
              : currentStats
                ? `${currentStats.total.toLocaleString()} tweets tracked`
                : 'Awaiting tracking data',
          };

  const startedStats = currentStats || tweetProjection || projectionInsufficient;

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-8 md:px-6 md:py-10">
        <header className="mb-10 space-y-5 border border-ink/10 bg-ink/[0.03] px-4 py-5 md:mb-12 md:px-6 md:py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                <span className="border border-ink/15 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.28em] opacity-60">
                  Polymarket bucket workspace
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] opacity-40">
                  Elon tweet markets only
                </span>
              </div>
                <div className="space-y-2.5">
                  <h1 className="text-4xl font-serif italic leading-none tracking-tight md:text-5xl">
                    Musk <span className="not-italic font-sans text-xl font-bold uppercase tracking-[0.18em] md:text-2xl">Oracle</span>
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-ink/65 md:text-base">
                    Editorial-grade read on live tweet-count markets. Pick the event, read the pace, then shape a tighter bucket coverage position with less guesswork.
                  </p>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:min-w-[26rem]">
              <div className="border border-ink/10 bg-bg px-4 py-3">
                <div className="font-mono text-[9px] uppercase tracking-[0.24em] opacity-45">Control room</div>
                <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink/75">
                  {manualCooldownSecondsLeft > 0
                    ? `${nextRefreshLabel} · Manual in ${formatRemainingTime(manualCooldownSecondsLeft)}`
                    : nextRefreshLabel}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.2em] opacity-40">Market</div>
                    <div className="mt-1 font-medium">{selectedMarket ? 'Detail active' : 'Selection mode'}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.2em] opacity-40">Selection</div>
                    <div className="mt-1 font-medium">{selectedBuckets.length} buckets</div>
                  </div>
                </div>
              </div>

              <div className="flex items-stretch gap-2 self-start">
                <button
                  onClick={() => {
                    void handleManualRefresh();
                  }}
                  disabled={manualRefreshDisabled}
                  aria-label={isManualRefreshing ? 'Refreshing market detail' : 'Refresh market detail'}
                  className="flex h-12 w-12 items-center justify-center border border-ink/15 bg-bg transition-colors hover:bg-ink hover:text-bg focus:outline-none focus:ring-2 focus:ring-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RotateCw className={`h-4 w-4 ${isManualRefreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={toggleTheme}
                  aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                  className="flex h-12 w-12 items-center justify-center border border-ink/15 bg-bg transition-colors hover:bg-ink hover:text-bg focus:outline-none focus:ring-2 focus:ring-ink"
                >
                  {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="h-px w-full bg-ink/10" />
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
                <div className="space-y-5 border border-ink/10 bg-ink px-5 py-6 text-bg md:px-6 md:py-7">
                  <div className="flex items-center gap-3 text-bg/70">
                    <Info className="h-4 w-4" aria-hidden="true" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.24em]">Start with the market</span>
                  </div>
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)] xl:items-end">
                    <div>
                      <h2 className="max-w-3xl font-serif text-3xl italic leading-tight md:text-4xl">
                        Choose the active event, then move straight into bucket selection and payoff shaping.
                      </h2>
                      <p className="mt-4 max-w-2xl text-sm leading-6 text-bg/72 md:text-base">
                        The interface is tuned for one decision flow: scan the event, understand the live pace, apply a strategy, then tighten the exact buckets you want to own.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                      <div className="border border-bg/15 bg-bg/6 px-4 py-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bg/45">Universe</div>
                        <div className="mt-2 text-3xl font-semibold tabular-nums">{activeCounts.length}</div>
                        <p className="mt-2 text-sm text-bg/62">Tracked markets currently visible to the workspace.</p>
                      </div>
                      <div className="border border-bg/15 bg-bg/6 px-4 py-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bg/45">Mode</div>
                        <div className="mt-2 text-lg font-medium">Coverage analysis</div>
                        <p className="mt-2 text-sm text-bg/62">Built around categorical buckets, not generic trading screens.</p>
                      </div>
                      <div className="border border-bg/15 bg-bg/6 px-4 py-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bg/45">Workflow</div>
                        <div className="mt-2 text-lg font-medium">Select -&gt; Model -&gt; Refine</div>
                        <p className="mt-2 text-sm text-bg/62">Automatic strategies are the starting point, not the final answer.</p>
                      </div>
                    </div>
                  </div>
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
                className="space-y-8 md:space-y-10"
              >
                <section className="border border-ink/10 bg-ink text-bg">
                  <div className="grid gap-4 px-5 py-4 md:px-6 md:py-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
                    <div className="space-y-4">
                      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
                        <button
                          onClick={() => setSelectedMarket(null)}
                          className="inline-flex min-h-10 items-center justify-center gap-2.5 border border-bg bg-bg px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-ink transition-colors hover:bg-transparent hover:text-bg focus:outline-none focus:ring-2 focus:ring-bg sm:justify-start"
                          aria-label="Go back to market selection"
                        >
                          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                          Back to all markets
                        </button>
                        {detailStatus && (
                          <div className={`inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] ${detailStatus.tone}`}>
                            <span>{detailStatus.label}</span>
                            <span className="opacity-70">{detailStatus.detail}</span>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <h2 className="max-w-4xl font-serif text-2xl italic leading-snug md:text-4xl">
                          {selectedMarket.title}
                        </h2>
                        <p className="max-w-3xl text-sm leading-6 text-bg/68 md:text-[15px]">
                          Read the live signal first, then pressure-test the strategy suggestions before you commit your own exact bucket mix.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="border border-bg/20 bg-bg px-4 py-3.5 text-ink">
                        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] opacity-45">Support this workspace</div>
                            <div className="mt-1.5 text-base font-medium leading-6">Keep the analysis alive if this screen is helping you make better entries.</div>
                            <p className="mt-1.5 text-sm text-ink/62">Support is promoted here on purpose so it is visible at decision time, not buried after the sizing rail.</p>
                          </div>
                          <div className="border border-ink/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink/58">
                            Polygon USDC
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2.5">
                          <a
                            href="https://polymarket.com/@polete"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center justify-between gap-3 border border-ink bg-ink px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-bg transition-colors hover:bg-bg hover:text-ink focus:outline-none focus:ring-2 focus:ring-ink"
                          >
                            <span className="flex flex-col gap-0.5 text-left">
                              <span>@polete on Polymarket</span>
                              <span className="normal-case text-[11px] tracking-normal opacity-75">Send a tip where the trading context already lives</span>
                            </span>
                            <span aria-hidden="true">→</span>
                          </a>
                          <div className="flex flex-col gap-2.5 border border-ink/15 bg-ink/[0.04] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <span className="block font-mono text-[10px] uppercase tracking-[0.18em] opacity-45">Wallet</span>
                              <span className="mt-1 block font-mono text-sm tracking-[0.08em]" title={TIPS_ADDRESS}>{truncatedAddress}</span>
                            </div>
                            <button
                              onClick={handleCopyAddress}
                              aria-label="Copy wallet address"
                              className="inline-flex items-center justify-center gap-1.5 border border-ink/20 bg-bg px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink transition-colors hover:bg-ink hover:text-bg focus:outline-none focus:ring-2 focus:ring-ink"
                            >
                              {copied ? (
                                <span>Copied</span>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" aria-hidden="true" />
                                  <span>Copy address</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                        <div className="border border-bg/15 px-4 py-4">
                          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bg/45">Buckets selected</div>
                          <div className="mt-2 text-3xl font-semibold tabular-nums">{selectedBuckets.length}</div>
                          <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-bg/55">Coverage {(selectedCoverage * 100).toFixed(1)}%</div>
                        </div>
                        <div className="border border-bg/15 px-4 py-4">
                          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bg/45">Budget</div>
                          <div className="mt-2 text-3xl font-semibold tabular-nums">${budget.toFixed(0)}</div>
                          <div className="mt-2 text-sm text-bg/60">Adjustable in the action rail</div>
                        </div>
                        <div className="border border-bg/15 px-4 py-4">
                          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bg/45">Decision flow</div>
                          <div className="mt-2 text-lg font-medium">Signal -&gt; Strategy -&gt; Sizing</div>
                          <div className="mt-2 text-sm text-bg/60">Everything below is arranged in that order.</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {startedStats && marketStarted && (() => {
                  if (projectionInsufficient) {
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="flex items-center gap-3 border border-warning/40 bg-warning/10 px-4 py-4"
                      >
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75"></span>
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning"></span>
                        </span>
                        <div>
                          <span className="block font-mono text-[10px] uppercase tracking-widest text-warning">Not enough reliable data</span>
                          <span className="font-mono text-xs opacity-60">
                            {projectionInsufficient.currentCount} tweets in {Math.max(0, projectionInsufficient.hoursElapsed).toFixed(1)}h - projections available after 4h / 20 tweets
                          </span>
                        </div>
                      </motion.div>
                    );
                  }

                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,0.9fr)]"
                    >
                      <div>
                        <StatsModule
                          stats={currentStats ?? { id: tweetProjection!.trackingId, total: tweetProjection!.currentCount, daysElapsed: tweetProjection!.hoursElapsed / 24, startDate: tweetProjection!.periodStart, endDate: tweetProjection!.periodEnd }}
                          tweetProjection={tweetProjection}
                          buckets={buckets}
                        />
                      </div>

                      <div className="flex h-full flex-col gap-4">
                        {tweetProjection && tweetProjection.rangeProbabilities.length > 0 && (
                          <div className="space-y-4 border border-ink/10 bg-ink/[0.03] p-5">
                            <div className="flex items-center justify-between gap-3">
                              <span className="block font-mono text-[10px] uppercase tracking-[0.22em] opacity-50">Top projected buckets</span>
                              <span className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-35">Highest model probability</span>
                            </div>
                            <div className="space-y-2">
                              {[...tweetProjection.rangeProbabilities]
                                .sort((a, b) => b.probability - a.probability)
                                .slice(0, 3)
                                .map((rp, i) => (
                                  <div key={rp.range} className="flex items-center gap-3 border border-ink/8 bg-bg px-3 py-3">
                                    <span className="w-5 font-mono text-[10px] opacity-30">{i + 1}</span>
                                    <div className="flex-1">
                                      <div className="mb-1 flex justify-between">
                                        <span className="font-mono text-xs font-bold">{rp.range}</span>
                                        <span className="font-mono text-xs">{(rp.probability * 100).toFixed(1)}%</span>
                                      </div>
                                      <div className="h-1.5 w-full bg-ink/10">
                                        <div className="h-full bg-ink" style={{ width: `${Math.min(100, rp.probability * 100)}%` }} />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-4 border border-ink/10 p-5">
                          <div>
                            <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] opacity-55">Market context</h4>
                            <p className="mt-2 text-sm leading-6 text-ink/62">
                              Operational links stay near the signal so the action rail can stay focused on actual position construction.
                            </p>
                          </div>
                          {selectedMarket.slug && (
                            <a
                              href={`https://polymarket.com/event/${selectedMarket.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 border border-ink/15 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] opacity-70 transition-colors hover:bg-ink hover:text-bg focus:outline-none focus:ring-2 focus:ring-ink"
                            >
                              View on Polymarket →
                            </a>
                          )}
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                            <div className="border border-ink/10 bg-ink/[0.03] px-4 py-4">
                              <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-45">Source</div>
                              <div className="mt-2 text-lg font-medium">Live market + tracker data</div>
                              <p className="mt-2 text-sm text-ink/60">Use this to validate whether the current market shape is keeping up with tweet pace.</p>
                            </div>
                            <div className="border border-ink/10 bg-ink/[0.03] px-4 py-4">
                              <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-45">Action</div>
                              <div className="mt-2 text-lg font-medium">Move to strategy below</div>
                              <p className="mt-2 text-sm text-ink/60">Suggested coverage comes first, manual bucket overrides come right after.</p>
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
                    className="border border-ink/10 bg-ink/[0.02] p-5 md:p-6"
                  >
                    <StrategyTabs
                      buckets={buckets}
                      tweetProjection={tweetProjection}
                      budget={budget}
                      onApplyStrategy={setSelectedBucketIds}
                    />
                  </motion.div>
                )}

                <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.55fr)_minmax(21rem,0.7fr)] xl:items-start">
                  <div className="order-1 space-y-6">
                    <section className="space-y-4 border border-ink/10 p-5 md:p-6">
                      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 opacity-40" aria-hidden="true" />
                          <h3 className="font-mono text-xs uppercase tracking-[0.2em] opacity-50">Bucket board</h3>
                        </div>
                        <p className="max-w-2xl text-sm text-ink/58">
                          Scan the market top-to-bottom, then tap the exact outcomes you want in the rail. Selection state is intentionally louder than the surrounding table.
                        </p>
                      </div>
                      <BucketList
                        buckets={buckets}
                        selectedIds={selectedBucketIds}
                        onToggle={handleToggleBucket}
                      />
                    </section>
                  </div>

                  <aside className="order-2">
                    <div className="sticky top-6 space-y-5 xl:top-8">
                      <div className="border border-ink/10 bg-ink px-5 py-4 text-bg">
                        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bg/45">Action rail</div>
                        <div className="mt-2 text-xl font-medium">Size the position, then sanity-check the selected spread.</div>
                      </div>

                      <BetCalculator
                        selectedBuckets={selectedBuckets}
                        budget={budget}
                        onBudgetChange={setBudget}
                      />

                      <div className="space-y-4 border border-ink/10 bg-ink/[0.03] p-5">
                        <div>
                          <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] opacity-55">Strategy viability</h4>
                          <p className="mt-2 text-sm text-ink/58">A quick read on whether the current bucket mix is broad enough to behave like coverage or narrow enough to behave like a punt.</p>
                        </div>
                        {selectedBuckets.length > 0 ? (
                          <div className="space-y-4">
                            <p className="font-serif text-base italic leading-6">
                              {selectedCoverage > 0.8
                                ? 'High coverage strategy. Low risk, but lower potential profit.'
                                : 'Selective strategy. Higher risk, requires specific outcomes to hit.'}
                            </p>
                            {currentStats && (
                              <div className="border-t border-ink/10 pt-4">
                                <span className="mb-3 block font-mono text-[10px] uppercase tracking-[0.18em] opacity-50">Distance to buckets</span>
                                <div className="space-y-2">
                                  {selectedBuckets.map(b => {
                                    const match = b.name.match(/(\d+)/);
                                    if (!match) return null;
                                    const target = parseInt(match[0]);
                                    const diff = target - currentStats.total;
                                    return (
                                      <div key={b.id} className="flex items-center justify-between gap-3 border border-ink/8 bg-bg px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                                        <span>{b.name}</span>
                                        <span className="text-ink/72">{diff > 0 ? `+${diff} needed` : 'Passed'}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="font-serif text-sm italic opacity-50">
                            Select buckets to see viability analysis.
                          </p>
                        )}
                      </div>

                    </div>
                  </aside>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </main>

        <footer className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-ink/10 pt-8 md:mt-20 md:flex-row md:items-center">
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
    </div>
  );
}
