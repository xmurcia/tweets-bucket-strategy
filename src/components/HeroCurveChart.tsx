import { useMemo } from 'react';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Bucket, HeroReplayChartPoint, HeroReplayBucketMidpoint, HeroReplayNormalizedSeries } from '../types';
import { parseHeroReplayBucketMidpoint } from '../utils/heroReplay';
import { useHeroReplayPlayback } from '../hooks/useHeroReplayPlayback';

interface HeroCurveChartProps {
  buckets: Bucket[];
  replaySeries?: HeroReplayNormalizedSeries | null;
  isReplayEligible?: boolean;
  replayCoordinationKey?: string | null;
  replayHistoryVersion?: number;
  replayLiveVersion?: number;
}

type LiveHeroCurvePoint = HeroReplayChartPoint;

function buildLiveHeroCurvePoints(buckets: Bucket[]): LiveHeroCurvePoint[] {
  const points: LiveHeroCurvePoint[] = [];
  let previousMidpoint: HeroReplayBucketMidpoint | null = null;

  for (const bucket of buckets) {
    if (!Number.isFinite(bucket.price) || bucket.price < 0) {
      continue;
    }

    const midpoint = parseHeroReplayBucketMidpoint(bucket.name, previousMidpoint);
    if (!midpoint) {
      continue;
    }

    points.push({
      bucketId: bucket.id,
      bucketName: bucket.name,
      tokenId: bucket.tokenId,
      x: midpoint.midpoint,
      y: bucket.price,
      midpoint,
      usedFallbackPrice: false,
    });

    previousMidpoint = midpoint;
  }

  return points;
}

export function HeroCurveChart({
  buckets,
  replaySeries = null,
  isReplayEligible = false,
  replayCoordinationKey = null,
  replayHistoryVersion = 0,
  replayLiveVersion = 0,
}: HeroCurveChartProps) {
  const livePoints = useMemo(() => buildLiveHeroCurvePoints(buckets), [buckets]);
  const {
    frame,
    playbackState,
    progress,
    startPlayback,
    pausePlayback,
    replayPlayback,
    resumePlayback,
  } = useHeroReplayPlayback({
    series: replaySeries,
    livePoints,
    enabled: isReplayEligible,
    autoPlay: true,
    coordinationKey: replayCoordinationKey,
    replayHistoryVersion,
    liveStateVersion: replayLiveVersion,
  });

  const points = frame?.points?.length ? frame.points : livePoints;

  if (points.length < 2) {
    return null;
  }

  const playbackLabel = playbackState === 'playing'
    ? `Replay ${Math.round(progress * 100)}%`
    : playbackState === 'paused'
      ? `Paused ${Math.round(progress * 100)}%`
    : playbackState === 'complete'
      ? 'Live'
      : 'Live';

  const replayUnavailable = playbackState === 'unavailable';
  const primaryActionLabel = playbackState === 'playing' ? 'Pause' : 'Play';
  const handlePrimaryAction = () => {
    if (playbackState === 'playing') {
      pausePlayback();
      return;
    }

    if (playbackState === 'paused') {
      resumePlayback();
      return;
    }

    startPlayback();
  };

  return (
    <div className="border border-bg/20 bg-bg/5 p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bg/55">Live curve</div>
          <p className="mt-1 text-sm leading-5 text-bg/72">
            Smoothed line for shape, real bucket dots for the current market state.
          </p>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-bg/40">
          {playbackLabel} · {points.length} buckets
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handlePrimaryAction}
          disabled={replayUnavailable}
          className="inline-flex items-center border border-bg/35 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-bg transition-colors hover:bg-bg hover:text-ink disabled:cursor-not-allowed disabled:border-bg/20 disabled:text-bg/35"
        >
          {primaryActionLabel}
        </button>
        <button
          type="button"
          onClick={replayPlayback}
          disabled={replayUnavailable}
          className="inline-flex items-center border border-bg/35 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-bg transition-colors hover:bg-bg hover:text-ink disabled:cursor-not-allowed disabled:border-bg/20 disabled:text-bg/35"
        >
          Replay
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-bg/45">
          {replayUnavailable ? 'Replay locked until history gate is met' : 'Chart controls only'}
        </span>
      </div>

      <div className="mt-4 h-56 w-full md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="rgba(228, 227, 224, 0.12)" vertical={false} />
            <XAxis
              dataKey="x"
              type="number"
              ticks={points.map((point) => point.x)}
              tickFormatter={(value) => points.find((point) => point.x === value)?.bucketName ?? ''}
              tick={{ fill: 'rgba(228, 227, 224, 0.55)', fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(value) => `${Math.round(value * 100)}%`}
              tick={{ fill: 'rgba(228, 227, 224, 0.55)', fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
              tickLine={false}
              axisLine={false}
              width={38}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(228, 227, 224, 0.18)', strokeWidth: 1 }}
              contentStyle={{
                backgroundColor: '#141414',
                border: '1px solid rgba(228, 227, 224, 0.2)',
                borderRadius: '0px',
                color: '#E4E3E0',
                fontSize: '12px',
              }}
              formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, 'Ask']}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.bucketName ?? ''}
            />
            <Line
              type="monotone"
              dataKey="y"
              stroke="#E4E3E0"
              strokeWidth={2}
              dot={{ r: 4, fill: '#141414', stroke: '#E4E3E0', strokeWidth: 2 }}
              activeDot={{ r: 5, fill: '#141414', stroke: '#E4E3E0', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
