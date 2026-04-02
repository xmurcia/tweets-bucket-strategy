import type {
  Bucket,
  HeroReplayBucketMidpoint,
  HeroReplayChartPoint,
  HeroReplayNormalizedBucket,
  HeroReplayNormalizedSeries,
  HeroReplayNormalizedSeriesBucket,
  HeroReplayNormalizedSnapshot,
  HeroReplayStoredSnapshot,
} from '../types';
import { parseBuckets } from '../services/polymarket';

const CLOSED_BUCKET_PATTERN = /^\s*(\d+)\s*-\s*(\d+)\s*$/;
const OPEN_BUCKET_PATTERN = /^\s*(\d+)\s*\+\s*$/;

interface ReplayBucketSnapshotValue {
  bucket: Bucket | null;
  midpoint: HeroReplayBucketMidpoint;
}

function compareSnapshots(a: HeroReplayStoredSnapshot, b: HeroReplayStoredSnapshot): number {
  if (a.capturedAtMs !== b.capturedAtMs) {
    return a.capturedAtMs - b.capturedAtMs;
  }

  return a.capturedAt.localeCompare(b.capturedAt);
}

function isValidReplayPrice(price: number): boolean {
  return Number.isFinite(price) && price > 0;
}

export function parseHeroReplayBucketMidpoint(
  label: string,
  previousBucket: HeroReplayBucketMidpoint | null = null
): HeroReplayBucketMidpoint | null {
  const trimmedLabel = label.trim();
  const closedMatch = trimmedLabel.match(CLOSED_BUCKET_PATTERN);

  if (closedMatch) {
    const rangeStart = Number.parseInt(closedMatch[1], 10);
    const rangeEnd = Number.parseInt(closedMatch[2], 10);

    if (rangeEnd < rangeStart) {
      return null;
    }

    return {
      label: trimmedLabel,
      rangeStart,
      rangeEnd,
      width: rangeEnd - rangeStart + 1,
      isOpenEnded: false,
      midpoint: (rangeStart + rangeEnd) / 2,
      usedWidthHeuristic: false,
    };
  }

  const openMatch = trimmedLabel.match(OPEN_BUCKET_PATTERN);

  if (!openMatch) {
    return null;
  }

  const rangeStart = Number.parseInt(openMatch[1], 10);
  const previousWidth = previousBucket?.width;

  if (!previousWidth || previousWidth <= 0) {
    return null;
  }

  const derivedRangeEnd = rangeStart + previousWidth - 1;

  return {
    label: trimmedLabel,
    rangeStart,
    rangeEnd: null,
    width: previousWidth,
    isOpenEnded: true,
    midpoint: (rangeStart + derivedRangeEnd) / 2,
    usedWidthHeuristic: true,
  };
}

function parseReplayBucketSnapshotValues(buckets: Bucket[]): Map<string, ReplayBucketSnapshotValue> {
  const snapshotValues = new Map<string, ReplayBucketSnapshotValue>();
  let previousMidpoint: HeroReplayBucketMidpoint | null = null;

  for (const bucket of buckets) {
    const midpoint = parseHeroReplayBucketMidpoint(bucket.name, previousMidpoint);

    if (!midpoint) {
      continue;
    }

    snapshotValues.set(bucket.name, {
      bucket,
      midpoint,
    });
    previousMidpoint = midpoint;
  }

  return snapshotValues;
}

function compareSeriesBuckets(a: HeroReplayNormalizedSeriesBucket, b: HeroReplayNormalizedSeriesBucket): number {
  if (a.x !== b.x) {
    return a.x - b.x;
  }

  return a.bucketName.localeCompare(b.bucketName);
}

export function normalizeHeroReplaySnapshots(
  snapshots: HeroReplayStoredSnapshot[]
): HeroReplayNormalizedSeries {
  const orderedSnapshots = [...snapshots].sort(compareSnapshots);
  const canonicalBuckets = new Map<string, HeroReplayNormalizedSeriesBucket>();
  const lastValidPrices = new Map<string, number>();
  const bucketsWithHistoricalValue = new Set<string>();
  const normalizedSnapshots: HeroReplayNormalizedSnapshot[] = [];

  orderedSnapshots.forEach((snapshot, sourceSnapshotIndex) => {
    const parsedBuckets = parseBuckets(snapshot.event);
    const currentSnapshotValues = parseReplayBucketSnapshotValues(parsedBuckets);

    for (const [bucketName, snapshotValue] of currentSnapshotValues) {
      if (!canonicalBuckets.has(bucketName) && snapshotValue.bucket) {
        canonicalBuckets.set(bucketName, {
          bucketId: snapshotValue.bucket.id,
          bucketName,
          tokenId: snapshotValue.bucket.tokenId,
          x: snapshotValue.midpoint.midpoint,
          midpoint: snapshotValue.midpoint,
        });
      }
    }

    const snapshotBuckets: HeroReplayNormalizedBucket[] = [];
    const snapshotPoints: HeroReplayChartPoint[] = [];
    const orderedSeriesBuckets = [...canonicalBuckets.values()].sort(compareSeriesBuckets);

    for (const seriesBucket of orderedSeriesBuckets) {
      const currentValue = currentSnapshotValues.get(seriesBucket.bucketName);
      const currentBucket = currentValue?.bucket;
      const nextPrice = currentBucket && isValidReplayPrice(currentBucket.price)
        ? currentBucket.price
        : lastValidPrices.get(seriesBucket.bucketName);

      if (nextPrice === undefined) {
        continue;
      }

      const usedFallbackPrice = !currentBucket || !isValidReplayPrice(currentBucket.price);
      if (!usedFallbackPrice) {
        lastValidPrices.set(seriesBucket.bucketName, currentBucket.price);
        bucketsWithHistoricalValue.add(seriesBucket.bucketName);
      }

      const bucketId = currentBucket?.id ?? seriesBucket.bucketId;
      const tokenId = currentBucket?.tokenId ?? seriesBucket.tokenId;

      snapshotBuckets.push({
        id: bucketId,
        name: seriesBucket.bucketName,
        price: nextPrice,
        tokenId,
        midpoint: seriesBucket.midpoint,
        sourceCapturedAt: snapshot.capturedAt,
        sourceCapturedAtMs: snapshot.capturedAtMs,
        sourceSnapshotIndex,
        usedFallbackPrice,
      });

      snapshotPoints.push({
        bucketId,
        bucketName: seriesBucket.bucketName,
        tokenId,
        x: seriesBucket.x,
        y: nextPrice,
        midpoint: seriesBucket.midpoint,
        usedFallbackPrice,
      });
    }

    normalizedSnapshots.push({
      eventId: snapshot.eventId,
      eventSlug: snapshot.eventSlug,
      eventTitle: snapshot.eventTitle,
      eventEndDate: snapshot.eventEndDate,
      trackingId: snapshot.trackingId,
      capturedAt: snapshot.capturedAt,
      capturedAtMs: snapshot.capturedAtMs,
      sourceSnapshotIndex,
      buckets: snapshotBuckets,
      points: snapshotPoints,
    });
  });

  const includedBucketNames = new Set(bucketsWithHistoricalValue);
  const seriesBuckets = [...canonicalBuckets.values()]
    .filter((bucket) => includedBucketNames.has(bucket.bucketName))
    .sort(compareSeriesBuckets);

  return {
    buckets: seriesBuckets,
    snapshots: normalizedSnapshots.map((snapshot) => ({
      ...snapshot,
      buckets: snapshot.buckets.filter((bucket) => includedBucketNames.has(bucket.name)),
      points: snapshot.points.filter((point) => includedBucketNames.has(point.bucketName)),
    })),
    historyStartAt: orderedSnapshots[0]?.capturedAt ?? null,
    historyEndAt: orderedSnapshots.at(-1)?.capturedAt ?? null,
    historySpanMs: orderedSnapshots.length > 1
      ? orderedSnapshots.at(-1)!.capturedAtMs - orderedSnapshots[0]!.capturedAtMs
      : 0,
  };
}
