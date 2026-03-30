import React, { useState, useMemo, useEffect } from 'react';
import { Bucket } from '../types';
import { TweetProjection } from '../types';

interface StrategyTabsProps {
  buckets: Bucket[];
  tweetProjection: TweetProjection | null;
  budget: number;
  onApplyStrategy: (bucketIds: Set<string>) => void;
}

interface StrategyBucket extends Bucket {
  projectedProb?: number;
}

type TabId = 'projection' | 'silence' | 'longshot';

const TAB_META: Record<TabId, { label: string; sublabel: string }> = {
  projection: {
    label: 'Projection',
    sublabel: 'Most likely zone based on current pace',
  },
  silence: {
    label: 'Slowdown',
    sublabel: 'Pace drops significantly — lower buckets gain probability',
  },
  longshot: {
    label: 'Longshot',
    sublabel: 'Low probability zone — high upside if it hits',
  },
};

function formatPct(n: number) {
  return (n * 100).toFixed(1) + '%';
}

function formatUSD(n: number) {
  return '$' + n.toFixed(2);
}

function coverageToReturn(coverage: number) {
  // If buckets sum to X in coverage, payout is 1/X per $1 invested
  // Net ROI = (1/coverage - 1) * 100
  if (coverage <= 0 || coverage >= 1) return 0;
  return ((1 / coverage) - 1) * 100;
}

function parseBucketRange(name: string): { start: number; end: number } | null {
  const rangeMatch = name.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    return {
      start: parseInt(rangeMatch[1], 10),
      end: parseInt(rangeMatch[2], 10),
    };
  }

  const plusMatch = name.match(/^(\d+)\s*\+$/);
  if (plusMatch) {
    return {
      start: parseInt(plusMatch[1], 10),
      end: Number.POSITIVE_INFINITY,
    };
  }

  return null;
}

export function StrategyTabs({ buckets, tweetProjection, budget, onApplyStrategy }: StrategyTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('projection');
  const [isExplainOpen, setIsExplainOpen] = useState(false);

  useEffect(() => {
    if (!isExplainOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsExplainOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExplainOpen]);

  const enrichedBuckets: StrategyBucket[] = useMemo(() => {
    if (!tweetProjection) return buckets;
    return buckets.map(b => {
      const match = b.name.match(/^(\d+)/);
      if (!match) return b;
      const start = parseInt(match[1], 10);
      const rp = tweetProjection.rangeProbabilities.find(r => r.rangeStart === start);
      return { ...b, projectedProb: rp?.probability };
    });
  }, [buckets, tweetProjection]);

  // --- PROJECTION TAB ---
  // Pick buckets greedily by projected probability descending until coverage >= 0.60
  const projectionStrategy = useMemo(() => {
    if (!tweetProjection) {
      // Fallback: pick by price descending until sum >= 0.60
      const sorted = [...buckets].sort((a, b) => b.price - a.price);
      const selected: Bucket[] = [];
      let sum = 0;
      for (const b of sorted) {
        if (sum >= 0.60) break;
        selected.push(b);
        sum += b.price;
      }
      return { selected, coverage: sum };
    }
    const sorted = [...enrichedBuckets]
      .filter(b => b.projectedProb !== undefined)
      .sort((a, b) => (b.projectedProb ?? 0) - (a.projectedProb ?? 0));
    const selected: StrategyBucket[] = [];
    let sum = 0;
    for (const b of sorted) {
      if (sum >= 0.60) break;
      selected.push(b);
      sum += b.price;
    }
    return { selected, coverage: sum };
  }, [enrichedBuckets, tweetProjection, buckets]);

  // --- SILENCE TAB ---
  // Hypothesis: Elon goes quiet → count stays low → lowest buckets gain probability
  // Pick the N lowest buckets that together reach ~60% coverage
  const silenceStrategy = useMemo(() => {
    const feasible = enrichedBuckets.filter(b => {
      if (!tweetProjection) return true;
      const parsed = parseBucketRange(b.name);
      if (!parsed) return true;
      return parsed.end >= tweetProjection.currentCount;
    });

    const sorted = [...feasible].sort((a, b) => {
      const aParsed = parseBucketRange(a.name);
      const bParsed = parseBucketRange(b.name);
      const aStart = aParsed?.start ?? parseInt(a.name.match(/^(\d+)/)?.[1] ?? '9999', 10);
      const bStart = bParsed?.start ?? parseInt(b.name.match(/^(\d+)/)?.[1] ?? '9999', 10);
      return aStart - bStart;
    });
    const selected: StrategyBucket[] = [];
    let sum = 0;
    for (const b of sorted) {
      if (sum >= 0.60) break;
      selected.push(b);
      sum += b.price;
    }
    return { selected, coverage: sum };
  }, [enrichedBuckets, tweetProjection]);

  // --- LONGSHOT TAB ---
  // High upside: pick buckets with very low market price but non-trivial projected probability
  // These are the most underpriced by the market relative to projection
  const longshotStrategy = useMemo(() => {
    if (!tweetProjection) return { selected: [], coverage: 0 };

    const candidates = enrichedBuckets
      .filter(b => {
        if (b.projectedProb === undefined || b.price <= 0 || b.price >= 0.15 || (b.projectedProb ?? 0) < 0.03) return false;
        const parsed = parseBucketRange(b.name);
        if (!parsed) return true;
        return parsed.end >= tweetProjection.currentCount;
      })
      .sort((a, b) => {
        // Sort by value ratio: projectedProb / marketPrice (highest = most underpriced)
        const aRatio = (a.projectedProb ?? 0) / a.price;
        const bRatio = (b.projectedProb ?? 0) / b.price;
        return bRatio - aRatio;
      });

    const selected: StrategyBucket[] = [];
    let sum = 0;
    // Take up to 5 candidates, stop at 60% or when we run out of good ones
    for (const b of candidates.slice(0, 5)) {
      selected.push(b);
      sum += b.price;
    }
    return { selected, coverage: sum };
  }, [enrichedBuckets, tweetProjection]);

  const strategies: Record<TabId, { selected: StrategyBucket[]; coverage: number }> = {
    projection: projectionStrategy,
    silence: silenceStrategy,
    longshot: longshotStrategy,
  };

  const current = strategies[activeTab];
  const roi = coverageToReturn(current.coverage);
  const perBucketBudget = current.selected.length > 0 ? budget / current.selected.length : 0;

  function handleApply() {
    onApplyStrategy(new Set(current.selected.map(b => b.id)));
  }

  const currentCount = tweetProjection?.currentCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-1">
          <h3 className="font-mono text-xs uppercase tracking-[0.2em] opacity-50">Suggested strategies</h3>
          <button
            type="button"
            onClick={() => setIsExplainOpen(true)}
            className="font-mono text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ink"
            aria-haspopup="dialog"
            aria-expanded={isExplainOpen}
            aria-controls="strategy-explainability-modal"
          >
            How this works
          </button>
        </div>
        <p className="text-sm font-serif italic opacity-60">
          Automatic coverage at ~60% — minimum 40% return. Fine-tune manually below.
        </p>
      </div>

      {isExplainOpen && (
        <div
          className="fixed inset-0 z-50 bg-ink/60 px-4 py-6 md:px-6 md:py-10"
          onClick={() => setIsExplainOpen(false)}
        >
          <div
            id="strategy-explainability-modal"
            role="dialog"
            aria-modal="true"
            aria-label="How suggested strategies are calculated"
            className="mx-auto max-w-3xl max-h-full overflow-y-auto border border-ink/20 bg-bg p-5 md:p-6"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <h4 className="font-mono text-xs uppercase tracking-[0.2em] opacity-70">How suggested strategies work</h4>
              <button
                type="button"
                onClick={() => setIsExplainOpen(false)}
                className="font-mono text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ink"
              >
                Close
              </button>
            </div>

            <div className="space-y-5 text-sm">
              <div className="space-y-2">
                <h5 className="font-mono text-[10px] uppercase tracking-widest opacity-50">Definitions</h5>
                <dl className="space-y-2">
                  <div>
                    <dt className="font-mono text-xs uppercase tracking-wider">Bucket</dt>
                    <dd className="opacity-70">A final tweet-count range (for example, 80-89). If the final count lands in that range, that bucket settles at $1.</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs uppercase tracking-wider">Market</dt>
                    <dd className="opacity-70">Current market-implied probability for a bucket, shown as a percent. Approximation: market probability = price.</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs uppercase tracking-wider">Proj.</dt>
                    <dd className="opacity-70">Model projection for the probability of each bucket from tweet pace and time remaining.</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs uppercase tracking-wider">EV/$1</dt>
                    <dd className="opacity-70">Expected value per $1 staked using projection vs market. Formula: EV/$1 = (Proj. / Market) - 1.</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs uppercase tracking-wider">Kelly stake $</dt>
                    <dd className="opacity-70">Suggested dollars for that bucket from Kelly sizing. Formula: Kelly fraction = (Proj. - Market) / (1 - Market), then Kelly stake $ = Kelly fraction × budget.</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs uppercase tracking-wider">Payout</dt>
                    <dd className="opacity-70">Gross payout if that specific bucket hits at current price. Formula: payout = stake / price.</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs uppercase tracking-wider">Coverage</dt>
                    <dd className="opacity-70">Total market probability of selected buckets. Formula: coverage = sum of selected market prices.</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs uppercase tracking-wider">Min ROI</dt>
                    <dd className="opacity-70">Worst-case net return if any selected bucket resolves true. Formula: Min ROI = (1 / Coverage - 1) × 100%.</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs uppercase tracking-wider">Payout if hit</dt>
                    <dd className="opacity-70">Target gross payout of the whole selection when one selected bucket wins. Formula: payout if hit = budget / coverage.</dd>
                  </div>
                </dl>
              </div>

              <div className="border-t border-ink/10 pt-4 space-y-2">
                <h5 className="font-mono text-[10px] uppercase tracking-widest opacity-50">Data source and caveats</h5>
                <p className="opacity-70">Market prices come from the local Polymarket proxy endpoint. Projection inputs come from the tracker endpoint.</p>
                <p className="opacity-70">These strategies are heuristic and depend on noisy real-time data. Projections can be wrong, buckets can be mispriced, and liquidity/slippage are not modeled.</p>
                <p className="opacity-70">This interface is for analysis and education only, not financial advice.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-ink/20">
        {(Object.keys(TAB_META) as TabId[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 font-mono text-[10px] uppercase tracking-widest transition-colors focus:outline-none focus:ring-2 focus:ring-ink ${
              activeTab === tab
                ? 'border-b-2 border-ink text-ink -mb-px'
                : 'text-ink/40 hover:text-ink/70'
            }`}
            aria-selected={activeTab === tab}
            role="tab"
          >
            {TAB_META[tab].label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div role="tabpanel" className="space-y-4">
        {/* Description */}
        <p className="text-xs font-mono opacity-50 uppercase tracking-wider">
          {TAB_META[activeTab].sublabel}
        </p>

        {/* Silence tab: explain the thesis */}
        {activeTab === 'silence' && currentCount !== undefined && tweetProjection && (
          <div className="border border-ink/20 p-3 text-xs font-mono space-y-1">
            <p className="opacity-70">
              Current: <span className="font-bold text-ink">{currentCount} tweets</span> ·
              Pace: <span className="font-bold">{tweetProjection.tweetsPerHour.toFixed(1)}/hr</span>
            </p>
            <p className="opacity-50">
              {(() => {
                const slowPace = Math.max(0.5, tweetProjection.tweetsPerHour * 0.3);
                const slowProjected = Math.round(currentCount + slowPace * tweetProjection.hoursRemaining);
                return `If pace drops to ~${slowPace.toFixed(1)}/hr (30% of current), final count would land around ${slowProjected} — shifting probability toward lower buckets.`;
              })()}
            </p>
          </div>
        )}

        {/* Longshot tab: explain the thesis */}
        {activeTab === 'longshot' && (
          <div className="border border-ink/20 p-3 text-xs font-mono space-y-1">
            <p className="opacity-50">
              Low market price but meaningful projected probability.
              High upside if correct — market underprices these buckets relative to projection.
            </p>
          </div>
        )}

        {/* No data fallback */}
        {!tweetProjection && activeTab === 'longshot' && (
          <p className="text-xs font-mono opacity-40">No projection data available for this strategy.</p>
        )}

        {/* Bucket list */}
        {current.selected.length > 0 ? (
          <div className="border border-ink/10">
            {/* Column headers */}
            <div className="grid grid-cols-12 px-4 py-2 border-b border-ink/10 font-mono text-[9px] uppercase tracking-wider opacity-40">
              <span className="col-span-3">Bucket</span>
              <span className="col-span-2 text-right">Market</span>
              {tweetProjection && <span className="col-span-2 text-right">Proj.</span>}
              {tweetProjection && <span className="col-span-2 text-right">EV/$1</span>}
              <span className={`${tweetProjection ? 'col-span-1' : 'col-span-5'} text-right`}>Kelly stake $</span>
              <span className="col-span-2 text-right">Payout</span>
            </div>

            {current.selected.map(b => {
              const payout = perBucketBudget / b.price;
              // EV per $1: projProb * (1/marketPrice) - 1
              const ev = b.projectedProb !== undefined
                ? (b.projectedProb / b.price) - 1
                : null;
              // Kelly fraction: (edge) / (odds - 1) = (projProb - marketPrice) / (1/marketPrice - 1)
              // Simplified: (projProb - marketPrice) / (1 - marketPrice)
              const kelly = b.projectedProb !== undefined && b.price < 1
                ? Math.max(0, (b.projectedProb - b.price) / (1 - b.price))
                : null;
              const kellyStake = kelly !== null ? kelly * budget : null;
              return (
                <div
                  key={b.id}
                  className="grid grid-cols-12 px-4 py-3 border-b border-ink/5 last:border-0 items-center text-sm"
                >
                  <span className="col-span-3 font-mono font-bold">{b.name}</span>
                  <span className="col-span-2 text-right font-mono">{formatPct(b.price)}</span>
                  {tweetProjection && (
                    <span className="col-span-2 text-right font-mono opacity-60">
                      {b.projectedProb !== undefined ? formatPct(b.projectedProb) : '—'}
                    </span>
                  )}
                  {tweetProjection && (
                    <span className={`col-span-2 text-right font-mono text-xs ${ev !== null && ev > 0 ? 'text-positive font-bold' : ev !== null && ev < 0 ? 'text-negative' : 'opacity-40'}`}>
                      {ev !== null ? `${ev > 0 ? '+' : ''}${ev.toFixed(2)}` : '—'}
                    </span>
                  )}
                  <span className={`${tweetProjection ? 'col-span-1' : 'col-span-5'} text-right font-mono text-xs opacity-60`}>
                    {kellyStake !== null ? formatUSD(kellyStake) : formatUSD(perBucketBudget)}
                  </span>
                  <span className="col-span-2 text-right font-mono font-bold">
                    {formatUSD(payout)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs font-mono opacity-40 py-4">No buckets available for this strategy.</p>
        )}

        {/* Summary row */}
        {current.selected.length > 0 && (
          <div className="flex items-end justify-between pt-2 border-t border-ink/10">
            <div className="space-y-1">
              <div className="flex gap-6">
                <div>
                  <span className="font-mono text-[9px] uppercase opacity-40 block">Coverage</span>
                  <span className="font-mono font-bold text-lg">{formatPct(current.coverage)}</span>
                </div>
                <div>
                  <span className="font-mono text-[9px] uppercase opacity-40 block">Min. ROI</span>
                  <span className={`font-mono font-bold text-lg ${roi > 0 ? 'text-positive' : roi < 0 ? 'text-negative' : 'text-neutral'}`}>
                    {roi > 0 ? '+' : ''}{roi.toFixed(0)}%
                  </span>
                </div>
                <div>
                  <span className="font-mono text-[9px] uppercase opacity-40 block">Payout if hit</span>
                  <span className="font-mono font-bold text-lg">{formatUSD(budget / current.coverage)}</span>
                </div>
              </div>
            </div>
            <button
              onClick={handleApply}
              className="px-4 py-2 bg-ink text-bg font-mono text-[10px] uppercase tracking-widest hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-ink focus:ring-offset-2"
            >
              Apply selection ↓
            </button>
          </div>
        )}
      </div>

      {/* Divider + manual note */}
      <div className="pt-4 border-t border-ink/10">
        <p className="text-xs font-serif italic opacity-40 text-center">
          ↓ Manual bucket and budget adjustment
        </p>
      </div>
    </div>
  );
}
