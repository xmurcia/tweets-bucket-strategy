import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  HeroReplayFrame,
  HeroReplayFrameKind,
  HeroReplayNormalizedSeries,
  HeroReplayChartPoint,
  HeroReplayPlaybackConfig,
  HeroReplayPlaybackState,
} from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

interface HeroReplayWaypoint {
  atMs: number;
  sourceSnapshotIndex: number;
  kind: HeroReplayFrameKind;
  pointsByBucket: Map<string, HeroReplayChartPoint>;
}

interface HeroReplayPlaybackSegment {
  start: HeroReplayWaypoint;
  end: HeroReplayWaypoint;
  durationMs: number;
}

interface HeroReplayTimeline {
  startedAtMs: number;
  endedAtMs: number;
  totalDurationMs: number;
  segments: HeroReplayPlaybackSegment[];
  bucketOrder: string[];
}

interface UseHeroReplayPlaybackInput {
  series: HeroReplayNormalizedSeries | null;
  livePoints: HeroReplayChartPoint[];
  enabled: boolean;
  autoPlay?: boolean;
  config?: Partial<HeroReplayPlaybackConfig>;
}

interface UseHeroReplayPlaybackResult {
  playbackState: HeroReplayPlaybackState;
  frame: HeroReplayFrame | null;
  progress: number;
  startPlayback: () => void;
  pausePlayback: () => void;
  resumePlayback: () => void;
  replayPlayback: () => void;
  resetToLive: () => void;
  durationMs: number;
}

const DEFAULT_CONFIG: HeroReplayPlaybackConfig = {
  minDurationMs: 6000,
  maxDurationMs: 8000,
  targetDurationMs: 7000,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function derivePlaybackDurationMs(historySpanMs: number, config: HeroReplayPlaybackConfig): number {
  const boundedTarget = clamp(config.targetDurationMs, config.minDurationMs, config.maxDurationMs);
  if (!Number.isFinite(historySpanMs) || historySpanMs <= 0) {
    return boundedTarget;
  }

  const historySpanDays = historySpanMs / DAY_MS;
  const normalizedSpan = clamp(historySpanDays / 4, 0, 1);
  return Math.round(config.minDurationMs + ((config.maxDurationMs - config.minDurationMs) * normalizedSpan));
}

function buildPointsMap(points: HeroReplayChartPoint[]): Map<string, HeroReplayChartPoint> {
  const pointsByBucket = new Map<string, HeroReplayChartPoint>();

  for (const point of points) {
    pointsByBucket.set(point.bucketName, point);
  }

  return pointsByBucket;
}

function buildReplayTimeline(
  series: HeroReplayNormalizedSeries | null,
  livePoints: HeroReplayChartPoint[],
  config: HeroReplayPlaybackConfig,
): HeroReplayTimeline | null {
  if (!series || series.snapshots.length === 0 || livePoints.length < 2) {
    return null;
  }

  const firstSnapshot = series.snapshots[0];
  const lastSnapshot = series.snapshots.at(-1);

  if (!firstSnapshot || !lastSnapshot) {
    return null;
  }

  const liveAtMs = Math.max(Date.now(), lastSnapshot.capturedAtMs);
  const snapshotWaypoints: HeroReplayWaypoint[] = series.snapshots.map((snapshot) => ({
    atMs: snapshot.capturedAtMs,
    sourceSnapshotIndex: snapshot.sourceSnapshotIndex,
    kind: 'snapshot',
    pointsByBucket: buildPointsMap(snapshot.points),
  }));

  const liveWaypoint: HeroReplayWaypoint = {
    atMs: liveAtMs,
    sourceSnapshotIndex: lastSnapshot.sourceSnapshotIndex,
    kind: 'live',
    pointsByBucket: buildPointsMap(livePoints),
  };

  const waypoints = [...snapshotWaypoints, liveWaypoint];
  if (waypoints.length < 2) {
    return null;
  }

  const totalDurationMs = derivePlaybackDurationMs(liveAtMs - firstSnapshot.capturedAtMs, config);
  const rawSegmentWeights = waypoints.slice(0, -1).map((waypoint, index) => {
    const deltaMs = waypoints[index + 1].atMs - waypoint.atMs;
    return Math.max(1, deltaMs);
  });
  const weightSum = rawSegmentWeights.reduce((sum, weight) => sum + weight, 0);

  const segments: HeroReplayPlaybackSegment[] = waypoints.slice(0, -1).map((start, index) => ({
    start,
    end: waypoints[index + 1],
    durationMs: (rawSegmentWeights[index] / weightSum) * totalDurationMs,
  }));

  const bucketOrder = series.buckets.map((bucket) => bucket.bucketName);

  return {
    startedAtMs: firstSnapshot.capturedAtMs,
    endedAtMs: liveAtMs,
    totalDurationMs,
    segments,
    bucketOrder,
  };
}

function resolvePoint(
  bucketName: string,
  start: HeroReplayWaypoint,
  end: HeroReplayWaypoint,
): { startPoint: HeroReplayChartPoint | null; endPoint: HeroReplayChartPoint | null } {
  const startPoint = start.pointsByBucket.get(bucketName) ?? null;
  const endPoint = end.pointsByBucket.get(bucketName) ?? null;

  if (startPoint || endPoint) {
    return { startPoint, endPoint };
  }

  return { startPoint: null, endPoint: null };
}

function interpolatePoints(
  bucketOrder: string[],
  start: HeroReplayWaypoint,
  end: HeroReplayWaypoint,
  progress: number,
): HeroReplayChartPoint[] {
  const points: HeroReplayChartPoint[] = [];

  for (const bucketName of bucketOrder) {
    const { startPoint, endPoint } = resolvePoint(bucketName, start, end);
    if (!startPoint && !endPoint) {
      continue;
    }

    const leftPoint = startPoint ?? endPoint;
    const rightPoint = endPoint ?? startPoint;

    if (!leftPoint || !rightPoint) {
      continue;
    }

    points.push({
      bucketId: rightPoint.bucketId,
      bucketName,
      tokenId: rightPoint.tokenId,
      x: rightPoint.x,
      y: leftPoint.y + ((rightPoint.y - leftPoint.y) * progress),
      midpoint: rightPoint.midpoint,
      usedFallbackPrice: leftPoint.usedFallbackPrice || rightPoint.usedFallbackPrice,
    });
  }

  return points;
}

function buildLivePoints(
  bucketOrder: string[],
  liveWaypoint: HeroReplayWaypoint,
): HeroReplayChartPoint[] {
  const points: HeroReplayChartPoint[] = [];
  const seenBuckets = new Set<string>();

  for (const bucketName of bucketOrder) {
    const point = liveWaypoint.pointsByBucket.get(bucketName);
    if (!point) {
      continue;
    }

    points.push({ ...point });
    seenBuckets.add(bucketName);
  }

  const extraLivePoints = [...liveWaypoint.pointsByBucket.values()]
    .filter((point) => !seenBuckets.has(point.bucketName))
    .sort((left, right) => left.bucketName.localeCompare(right.bucketName));

  for (const point of extraLivePoints) {
    points.push({ ...point });
  }

  return points;
}

function buildFrame(
  timeline: HeroReplayTimeline,
  segment: HeroReplayPlaybackSegment,
  elapsedMs: number,
  localProgress: number,
  isComplete: boolean,
): HeroReplayFrame {
  const clampedLocalProgress = clamp(localProgress, 0, 1);
  const frameAtMs = Math.round(segment.start.atMs + ((segment.end.atMs - segment.start.atMs) * clampedLocalProgress));
  const points = isComplete
    ? buildLivePoints(timeline.bucketOrder, segment.end)
    : interpolatePoints(timeline.bucketOrder, segment.start, segment.end, clampedLocalProgress);
  const buckets = points.map((point) => ({
    id: point.bucketId,
    name: point.bucketName,
    price: point.y,
    tokenId: point.tokenId,
    midpoint: point.midpoint,
    sourceCapturedAt: new Date(frameAtMs).toISOString(),
    sourceCapturedAtMs: frameAtMs,
    sourceSnapshotIndex: segment.start.sourceSnapshotIndex,
    usedFallbackPrice: point.usedFallbackPrice,
  }));

  const kind: HeroReplayFrameKind = isComplete
    ? 'live'
    : clampedLocalProgress === 0 && segment.start.kind === 'snapshot'
      ? 'snapshot'
      : 'interpolated';

  return {
    kind,
    frameAt: new Date(frameAtMs).toISOString(),
    frameAtMs,
    startedAt: new Date(timeline.startedAtMs).toISOString(),
    startedAtMs: timeline.startedAtMs,
    endedAt: new Date(timeline.endedAtMs).toISOString(),
    endedAtMs: timeline.endedAtMs,
    interpolationProgress: clamp(elapsedMs / timeline.totalDurationMs, 0, 1),
    sourceSnapshotIndex: segment.start.sourceSnapshotIndex,
    nextSnapshotIndex: segment.end.kind === 'live' ? null : segment.end.sourceSnapshotIndex,
    isLive: isComplete,
    buckets,
    points,
  };
}

function locateSegment(
  timeline: HeroReplayTimeline,
  elapsedMs: number,
): { segment: HeroReplayPlaybackSegment; localElapsedMs: number } {
  let consumedMs = 0;

  for (const segment of timeline.segments) {
    const segmentEndMs = consumedMs + segment.durationMs;
    if (elapsedMs <= segmentEndMs) {
      return {
        segment,
        localElapsedMs: elapsedMs - consumedMs,
      };
    }
    consumedMs = segmentEndMs;
  }

  const lastSegment = timeline.segments.at(-1)!;
  return {
    segment: lastSegment,
    localElapsedMs: lastSegment.durationMs,
  };
}

export function useHeroReplayPlayback({
  series,
  livePoints,
  enabled,
  autoPlay = true,
  config,
}: UseHeroReplayPlaybackInput): UseHeroReplayPlaybackResult {
  const mergedConfig = useMemo<HeroReplayPlaybackConfig>(() => ({
    minDurationMs: config?.minDurationMs ?? DEFAULT_CONFIG.minDurationMs,
    maxDurationMs: config?.maxDurationMs ?? DEFAULT_CONFIG.maxDurationMs,
    targetDurationMs: config?.targetDurationMs ?? DEFAULT_CONFIG.targetDurationMs,
  }), [config?.maxDurationMs, config?.minDurationMs, config?.targetDurationMs]);

  const timeline = useMemo(
    () => buildReplayTimeline(series, livePoints, mergedConfig),
    [series, livePoints, mergedConfig],
  );

  const [playbackState, setPlaybackState] = useState<HeroReplayPlaybackState>('idle');
  const [frame, setFrame] = useState<HeroReplayFrame | null>(null);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startedAtPerfMsRef = useRef<number | null>(null);
  const elapsedMsRef = useRef(0);
  const isUnavailable = !enabled || !timeline;

  const cancelPlayback = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const resetToLive = useCallback(() => {
    cancelPlayback();
    if (!timeline) {
      startedAtPerfMsRef.current = null;
      elapsedMsRef.current = 0;
      setFrame(null);
      setPlaybackState(enabled ? 'idle' : 'unavailable');
      setProgress(0);
      return;
    }

    const finalSegment = timeline.segments.at(-1)!;
    const liveFrame = buildFrame(
      timeline,
      finalSegment,
      timeline.totalDurationMs,
      1,
      true,
    );

    setFrame(liveFrame);
    setProgress(1);
    startedAtPerfMsRef.current = null;
    elapsedMsRef.current = timeline.totalDurationMs;
    setPlaybackState('complete');
  }, [cancelPlayback, enabled, timeline]);

  const runPlaybackFromElapsed = useCallback((initialElapsedMs: number) => {
    cancelPlayback();

    if (!enabled || !timeline) {
      startedAtPerfMsRef.current = null;
      elapsedMsRef.current = 0;
      setPlaybackState('unavailable');
      setProgress(0);
      return;
    }

    const safeInitialElapsedMs = clamp(initialElapsedMs, 0, timeline.totalDurationMs);
    elapsedMsRef.current = safeInitialElapsedMs;
    startedAtPerfMsRef.current = performance.now() - safeInitialElapsedMs;
    setPlaybackState('playing');

    const tick = (nowPerfMs: number) => {
      const startedAtPerfMs = startedAtPerfMsRef.current;
      if (startedAtPerfMs === null) {
        return;
      }

      const elapsedMs = nowPerfMs - startedAtPerfMs;
      const clampedElapsedMs = clamp(elapsedMs, 0, timeline.totalDurationMs);
      elapsedMsRef.current = clampedElapsedMs;

      const isComplete = clampedElapsedMs >= timeline.totalDurationMs;
      const { segment, localElapsedMs } = locateSegment(timeline, clampedElapsedMs);
      const localProgress = segment.durationMs <= 0 ? 1 : clamp(localElapsedMs / segment.durationMs, 0, 1);

      setFrame(buildFrame(timeline, segment, clampedElapsedMs, localProgress, isComplete));
      setProgress(clamp(clampedElapsedMs / timeline.totalDurationMs, 0, 1));

      if (isComplete) {
        startedAtPerfMsRef.current = null;
        elapsedMsRef.current = timeline.totalDurationMs;
        setPlaybackState('complete');
        rafRef.current = null;
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [cancelPlayback, enabled, timeline]);

  const startPlayback = useCallback(() => {
    setProgress(0);
    elapsedMsRef.current = 0;
    runPlaybackFromElapsed(0);
  }, [runPlaybackFromElapsed]);

  const pausePlayback = useCallback(() => {
    if (playbackState !== 'playing') {
      return;
    }

    cancelPlayback();

    if (timeline && startedAtPerfMsRef.current !== null) {
      const elapsedMs = clamp(performance.now() - startedAtPerfMsRef.current, 0, timeline.totalDurationMs);
      elapsedMsRef.current = elapsedMs;
      setProgress(clamp(elapsedMs / timeline.totalDurationMs, 0, 1));
    }

    startedAtPerfMsRef.current = null;
    setPlaybackState(isUnavailable ? 'unavailable' : 'paused');
  }, [cancelPlayback, isUnavailable, playbackState, timeline]);

  const resumePlayback = useCallback(() => {
    if (playbackState === 'playing') {
      return;
    }

    runPlaybackFromElapsed(elapsedMsRef.current);
  }, [playbackState, runPlaybackFromElapsed]);

  const replayPlayback = useCallback(() => {
    startPlayback();
  }, [startPlayback]);

  useEffect(() => {
    if (isUnavailable) {
      cancelPlayback();
      startedAtPerfMsRef.current = null;
      elapsedMsRef.current = 0;
      return;
    }

    if (!autoPlay) {
      const resetFrame = requestAnimationFrame(() => {
        resetToLive();
      });
      return () => {
        cancelAnimationFrame(resetFrame);
      };
    }

    const playbackFrame = requestAnimationFrame(() => {
      startPlayback();
    });

    return () => {
      cancelAnimationFrame(playbackFrame);
      cancelPlayback();
      startedAtPerfMsRef.current = null;
    };
  }, [autoPlay, cancelPlayback, isUnavailable, resetToLive, startPlayback]);

  useEffect(() => () => cancelPlayback(), [cancelPlayback]);

  return {
    playbackState: isUnavailable ? 'unavailable' : playbackState,
    frame: isUnavailable ? null : frame,
    progress: isUnavailable ? 0 : progress,
    startPlayback,
    pausePlayback,
    resumePlayback,
    replayPlayback,
    resetToLive,
    durationMs: timeline?.totalDurationMs ?? 0,
  };
}
