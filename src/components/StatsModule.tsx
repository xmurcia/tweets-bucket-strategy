import React, { useEffect, useMemo, useState } from 'react';
import { TrackingStats } from '../services/polymarket';
import { TweetProjection, Bucket, HeroReplayNormalizedSeries } from '../types';
import { parseApiDateMs } from '../utils/datetime';
import { HeroCurveChart } from './HeroCurveChart';

interface StatsModuleProps {
  stats: TrackingStats;
  tweetProjection?: TweetProjection | null;
  buckets?: Bucket[];
  replaySeries?: HeroReplayNormalizedSeries | null;
  isReplayEligible?: boolean;
  replayCoordinationKey?: string | null;
  replayHistoryVersion?: number;
  replayLiveVersion?: number;
}

interface ContrarianZone {
  bucketName: string;
  marketPrice: number;
  projectionProbability: number;
  divergenceRatio: number;
  ev: number; // expected value per $1 staked
}

export function StatsModule({
  stats,
  tweetProjection,
  buckets = [],
  replaySeries = null,
  isReplayEligible = false,
  replayCoordinationKey = null,
  replayHistoryVersion = 0,
  replayLiveVersion = 0,
}: StatsModuleProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  const countdownTargetMs = useMemo(() => {
    if (!stats.endDate) return null;
    return parseApiDateMs(stats.endDate);
  }, [stats.endDate]);

  useEffect(() => {
    if (countdownTargetMs === null) return;

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [countdownTargetMs]);

  const countdown = useMemo(() => {
    if (countdownTargetMs === null) return null;

    const totalSeconds = Math.max(0, Math.floor((countdownTargetMs - nowMs) / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return { days, hours, minutes, seconds, totalSeconds };
  }, [countdownTargetMs, nowMs]);

  const calculations = useMemo(() => {
    const contrarian: ContrarianZone[] = [];
    let nearestBucket: { name: string; start: number } | null = null;
    let progressToNextBucket = 0;

    const currentCount = tweetProjection?.currentCount ?? stats.total;

    if (tweetProjection && buckets.length) {
      const MIN_PROJ_PROB = 0.03;
      const DIVERGENCE_THRESHOLD = 0.70;

      for (const bucket of buckets) {
        const rangeMatch = bucket.name.match(/^(\d+)/);
        if (!rangeMatch) continue;
        const bucketStart = parseInt(rangeMatch[1], 10);
        const rangeProbEntry = tweetProjection.rangeProbabilities.find(rp => rp.rangeStart === bucketStart);
        if (!rangeProbEntry) continue;

        const marketPrice = bucket.price;
        const projProb = rangeProbEntry.probability;

        if (projProb < MIN_PROJ_PROB) continue;
        if (marketPrice <= 0 || marketPrice >= projProb * DIVERGENCE_THRESHOLD) continue;

        contrarian.push({
          bucketName: bucket.name,
          marketPrice,
          projectionProbability: projProb,
          divergenceRatio: projProb / marketPrice,
          // EV per $1: projProb * (1/marketPrice) - 1
          ev: (projProb / marketPrice) - 1,
        });
      }
      contrarian.sort((a, b) => b.divergenceRatio - a.divergenceRatio);
      contrarian.splice(3);
    }

    if (buckets.length) {
      // buckets must be sorted ascending by range start (they should be already)
      for (const bucket of buckets) {
        const rangeMatch = bucket.name.match(/^(\d+)/);
        if (!rangeMatch) continue;
        const start = parseInt(rangeMatch[1], 10);
        if (start > currentCount) {
          nearestBucket = { name: bucket.name, start };
          break;
        }
      }
    }

    if (nearestBucket && tweetProjection) {
      const prevBucketEnd = nearestBucket.start - 20;
      const range = nearestBucket.start - prevBucketEnd;
      const progress = tweetProjection.currentCount - prevBucketEnd;
      progressToNextBucket = Math.min(100, Math.max(0, (progress / range) * 100));
    }

    return { contrarian, nearestBucket, progressToNextBucket };
  }, [tweetProjection, buckets, stats.total]);

  const { contrarian, nearestBucket, progressToNextBucket } = calculations;

  // Pace acceleration: positive = speeding up, negative = slowing down
  const paceAcceleration = tweetProjection?.pace24h != null
    ? tweetProjection.pace24h - tweetProjection.tweetsPerHour
    : null;

  // Find bucket containing projected median and check for low volume warning
  const projectionBucketWarning = useMemo(() => {
    if (!tweetProjection || !buckets.length) return null;

    const projectedMedian = (tweetProjection.projectedRange.low + tweetProjection.projectedRange.high) / 2;

    let targetBucket: Bucket | null = null;
    for (const bucket of buckets) {
      const rangeMatch = bucket.name.match(/^(\d+)-(\d+)/);
      const plusMatch = bucket.name.match(/^(\d+)\+/);

      if (rangeMatch) {
        const low = parseInt(rangeMatch[1], 10);
        const high = parseInt(rangeMatch[2], 10);
        if (projectedMedian >= low && projectedMedian <= high) {
          targetBucket = bucket;
          break;
        }
      } else if (plusMatch) {
        const low = parseInt(plusMatch[1], 10);
        if (projectedMedian >= low) {
          targetBucket = bucket;
          break;
        }
      }
    }

    if (!targetBucket) return null;

    const bucketPrice = targetBucket.price;
    const totalPrice = buckets.reduce((sum, b) => sum + b.price, 0);
    const priceShare = totalPrice > 0 ? bucketPrice / totalPrice : 0;

    return {
      bucketName: targetBucket.name,
      priceShare,
      isLowVolume: priceShare < 0.20,
    };
  }, [tweetProjection, buckets]);

  return (
    <div className="space-y-6">
      {/* Tweet Counter Block */}
      {tweetProjection && (
        <div className="border border-ink p-6 bg-ink text-bg">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[10px] uppercase tracking-widest text-bg/60">
                  Current Count
                </span>
                <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-bg/60">
                  <span className="w-1.5 h-1.5 rounded-full bg-positive animate-ping inline-block" />
                  Live
                </span>
              </div>
              <span className="text-5xl font-bold tabular-nums">
                {tweetProjection.currentCount.toLocaleString()}
              </span>
            </div>
            <div className="text-right space-y-2">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-bg/60 block">
                  Avg pace
                </span>
                <span className="text-xl font-medium tabular-nums">
                  {tweetProjection.tweetsPerHour.toFixed(1)}
                  <span className="text-sm text-bg/60 ml-1">tweets/hr</span>
                </span>
              </div>
              {tweetProjection.pace24h != null && tweetProjection.pace24h !== tweetProjection.tweetsPerHour && tweetProjection.pace24h < 50 && (
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-bg/60 block">
                    Last 24h pace
                  </span>
                  <span className="text-base font-medium tabular-nums">
                    {tweetProjection.pace24h.toFixed(1)}
                    <span className="text-sm text-bg/60 ml-1">tweets/hr</span>
                    {paceAcceleration !== null && Math.abs(paceAcceleration) > 0.1 && (
                      <span className={`ml-2 text-xs font-mono ${paceAcceleration > 0 ? 'text-positive' : 'text-negative'}`}>
                        {paceAcceleration > 0 ? '↑' : '↓'} {Math.abs(paceAcceleration).toFixed(1)}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

          {nearestBucket && (
            <div className="mt-4">
              <div className="flex justify-between text-[10px] font-mono uppercase tracking-wider text-bg/60 mb-1">
                <span>Progress to {nearestBucket.name}</span>
                <span>{Math.round(progressToNextBucket)}%</span>
              </div>
              <div className="w-full bg-bg/20 h-2 overflow-hidden">
                <div
                  className="bg-bg h-full transition-all duration-500"
                  style={{ width: `${progressToNextBucket}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-5">
            <HeroCurveChart
              buckets={buckets}
              replaySeries={replaySeries}
              isReplayEligible={isReplayEligible}
              replayCoordinationKey={replayCoordinationKey}
              replayHistoryVersion={replayHistoryVersion}
              replayLiveVersion={replayLiveVersion}
            />
          </div>

          <div className="mt-4 pt-4 border-t border-bg/20 text-[10px] font-mono uppercase tracking-wider">
            <div className="flex items-center justify-between text-bg/60">
              <span>Time left</span>
              {countdown && countdown.totalSeconds === 0 && <span>Ended</span>}
            </div>
            {countdown ? (
              <div className="grid grid-cols-4 gap-2 mt-2">
                <div className="text-center">
                  <div className="text-lg sm:text-xl font-bold tabular-nums text-bg">{countdown.days}</div>
                  <div className="text-[9px] text-bg/60">days</div>
                </div>
                <div className="text-center">
                  <div className="text-lg sm:text-xl font-bold tabular-nums text-bg">{countdown.hours}</div>
                  <div className="text-[9px] text-bg/60">hrs</div>
                </div>
                <div className="text-center">
                  <div className="text-lg sm:text-xl font-bold tabular-nums text-bg">{countdown.minutes}</div>
                  <div className="text-[9px] text-bg/60">min</div>
                </div>
                <div className="text-center">
                  <div className="text-lg sm:text-xl font-bold tabular-nums text-bg">{countdown.seconds}</div>
                  <div className="text-[9px] text-bg/60">sec</div>
                </div>
              </div>
            ) : (
              <div className="mt-2 text-bg/40">Time left unavailable</div>
            )}
          </div>
        </div>
      )}

      {/* Projection + metrics grid */}
      {tweetProjection && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={`border p-4 ${projectionBucketWarning?.isLowVolume ? 'border-yellow-500 bg-yellow-500/10' : 'border-ink/10'}`}>
            <span className="font-mono text-[10px] uppercase opacity-50 block mb-1">Projected Total (80% CI)</span>
            <div className="text-2xl font-bold tabular-nums">
              {tweetProjection.projectedRange.low}–{tweetProjection.projectedRange.high}
            </div>
            <div className="text-xs font-mono opacity-40 mt-1">
              ~{Math.round(tweetProjection.projectedTotal)} model estimate
            </div>
            {projectionBucketWarning && (
              <div className="text-[10px] font-mono mt-2 text-yellow-700">
                {projectionBucketWarning.isLowVolume ? (
                  <>⚠ Low liquidity bucket ({Math.round(projectionBucketWarning.priceShare * 100)}% of market)</>
                ) : (
                  <span className="text-ink/40">Bucket: {projectionBucketWarning.bucketName}</span>
                )}
              </div>
            )}
          </div>

          <div className="border border-ink/10 p-4">
            <span className="font-mono text-[10px] uppercase opacity-50 block mb-1">Confidence</span>
            <div className="text-2xl font-bold tabular-nums">
              {Math.round(tweetProjection.confidence * 100)}%
            </div>
            <div className="text-xs font-mono opacity-40 mt-1">
              {tweetProjection.hoursElapsed.toFixed(0)}h of data
            </div>
          </div>

          <div className="border border-ink/10 p-4">
            <span className="font-mono text-[10px] uppercase opacity-50 block mb-1">Time Remaining</span>
            <div className="text-2xl font-bold tabular-nums">
              {tweetProjection.hoursRemaining.toFixed(0)}
              <span className="text-sm opacity-50 ml-1">hrs</span>
            </div>
            {(() => {
              const totalHours = tweetProjection.hoursElapsed + tweetProjection.hoursRemaining;
              const pct = totalHours > 0 ? (tweetProjection.hoursElapsed / totalHours) * 100 : 0;
              return (
                <div className="w-full bg-bg h-1 mt-2 overflow-hidden border border-ink/10"
                  role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Time progress">
                  <div className="bg-ink h-full transition-all duration-1000" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              );
            })()}
          </div>

          <div className="border border-ink/10 p-4">
            <span className="font-mono text-[10px] uppercase opacity-50 block mb-1">Tweets left est.</span>
            <div className="text-2xl font-bold tabular-nums">
              ~{Math.max(0, Math.round(tweetProjection.projectedTotal - tweetProjection.currentCount))}
            </div>
            <div className="text-xs font-mono opacity-40 mt-1">
              at {tweetProjection.tweetsPerHour.toFixed(1)}/hr
            </div>
          </div>
        </div>
      )}

      {/* Fallback: show basic stats if no projection */}
      {!tweetProjection && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-ink/10 p-4">
            <span className="font-mono text-[10px] uppercase opacity-50 block mb-1">Current Count</span>
            <div className="text-xl font-medium">{stats.total.toLocaleString()} <span className="text-xs opacity-50">tweets</span></div>
          </div>
          <div className="border border-ink/10 p-4 bg-ink text-bg">
            <span className="font-mono text-[10px] uppercase opacity-50 block mb-1 text-bg/60">Avg Velocity</span>
            <div className="text-2xl font-bold">{stats.daysElapsed > 0 ? (stats.total / stats.daysElapsed).toFixed(1) : '—'}</div>
            <div className="text-[10px] font-mono opacity-60 mt-1 uppercase tracking-wider">tweets/day</div>
          </div>
          <div className="border border-ink/10 p-4">
            <span className="font-mono text-[10px] uppercase opacity-50 block mb-1">Days Elapsed</span>
            <div className="text-xl font-medium">{stats.daysElapsed.toFixed(1)} <span className="text-xs opacity-50">days</span></div>
          </div>
        </div>
      )}

      {/* Contrarian Buy Zones */}
      {contrarian.length > 0 && (
        <div className="border-2 border-ink p-4">
          <span className="font-mono text-[10px] uppercase tracking-widest opacity-50 block mb-3">
            Contrarian Buy Zones
          </span>
          <div className="space-y-3">
            {contrarian.map((zone) => (
              <div key={zone.bucketName} className="flex items-center justify-between p-3 bg-ink text-bg">
                <div>
                  <span className="font-bold text-lg">{zone.bucketName}</span>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-bg/60 mt-1">
                    Market underpriced
                  </div>
                </div>
                <div className="text-right space-y-0.5">
                  <div className="flex items-baseline justify-end gap-2">
                    <span className="text-xs text-bg/60">Market</span>
                    <span className="font-mono font-bold">{(zone.marketPrice * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex items-baseline justify-end gap-2">
                    <span className="text-xs text-bg/60">Projection</span>
                    <span className="font-mono font-bold">{(zone.projectionProbability * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex items-baseline justify-end gap-2">
                    <span className="text-xs text-bg/60">EV / $1</span>
                    <span className={`font-mono font-bold text-sm ${zone.ev > 0 ? 'text-positive' : 'text-negative'}`}>
                      {zone.ev > 0 ? '+' : ''}{zone.ev.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-bg/50">
                    {zone.divergenceRatio.toFixed(1)}x divergence
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-mono opacity-40 mt-3">
            Buckets where market price &lt; 70% of projected probability
          </p>
        </div>
      )}
    </div>
  );
}
