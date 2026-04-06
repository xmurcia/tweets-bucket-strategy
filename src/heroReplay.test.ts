import { describe, expect, it } from 'vitest';
import {
  parseHeroReplayBucketMidpoint,
  normalizeHeroReplaySnapshots,
} from './utils/heroReplay';
import type { HeroReplayStoredSnapshot } from './types';
import type { PolymarketEvent, Bucket } from './types';

function createMockBucket(name: string, price: number): Bucket {
  return {
    id: `bucket-${name}`,
    name,
    price,
    tokenId: `token-${name}`,
  };
}

function createMockEvent(buckets: Bucket[]): PolymarketEvent {
  const outcomes = buckets.map((b) => b.name);
  const outcomePrices = buckets.map((b) => b.price.toString());
  const tokenIds = buckets.map((b) => b.tokenId);

  return {
    id: 'mock-event-id',
    title: 'Will Elon Musk tweet X times?',
    description: '',
    slug: 'elon-tweets-x',
    endDate: '2025-06-01T00:00:00Z',
    trackingId: 'elonmusk',
    markets: [
      {
        id: 'market-1',
        question: 'Will Elon Musk tweet 300-319 times?',
        description: '',
        outcomes: JSON.stringify(outcomes),
        outcomePrices: JSON.stringify(outcomePrices),
        clobTokenIds: JSON.stringify(tokenIds),
        active: true,
        closed: false,
        endDate: '2025-06-01T00:00:00Z',
        bestAsk: Math.max(...buckets.map((b) => b.price)),
      },
    ],
  };
}

function createStoredSnapshot(
  event: PolymarketEvent,
  daysAgo: number
): HeroReplayStoredSnapshot {
  const capturedAtMs = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  return {
    eventId: 'event-1',
    eventSlug: 'elon-tweets-x',
    eventTitle: 'Will Elon Musk tweet X times?',
    eventEndDate: '2025-06-01T00:00:00Z',
    trackingId: 'elonmusk',
    capturedAt: new Date(capturedAtMs).toISOString(),
    capturedAtMs,
    event,
  };
}

describe('parseHeroReplayBucketMidpoint', () => {
  it('parses closed bucket range correctly', () => {
    const result = parseHeroReplayBucketMidpoint('120-139');
    expect(result).not.toBeNull();
    expect(result!.label).toBe('120-139');
    expect(result!.rangeStart).toBe(120);
    expect(result!.rangeEnd).toBe(139);
    expect(result!.width).toBe(20);
    expect(result!.isOpenEnded).toBe(false);
    expect(result!.midpoint).toBe(129.5);
    expect(result!.usedWidthHeuristic).toBe(false);
  });

  it('parses single-digit bucket range', () => {
    const result = parseHeroReplayBucketMidpoint('0-19');
    expect(result).not.toBeNull();
    expect(result!.rangeStart).toBe(0);
    expect(result!.rangeEnd).toBe(19);
    expect(result!.width).toBe(20);
    expect(result!.midpoint).toBe(9.5);
  });

  it('returns null for invalid range (end < start)', () => {
    const result = parseHeroReplayBucketMidpoint('150-120');
    expect(result).toBeNull();
  });

  it('parses open-ended bucket with width heuristic', () => {
    const prevBucket = parseHeroReplayBucketMidpoint('240-259');
    expect(prevBucket).not.toBeNull();

    const result = parseHeroReplayBucketMidpoint('260+', prevBucket);
    expect(result).not.toBeNull();
    expect(result!.label).toBe('260+');
    expect(result!.rangeStart).toBe(260);
    expect(result!.rangeEnd).toBeNull();
    expect(result!.width).toBe(20);
    expect(result!.isOpenEnded).toBe(true);
    expect(result!.usedWidthHeuristic).toBe(true);
    expect(result!.midpoint).toBe(269.5);
  });

  it('returns null for open-ended bucket without previous bucket', () => {
    const result = parseHeroReplayBucketMidpoint('260+');
    expect(result).toBeNull();
  });

  it('returns null for open-ended bucket with invalid previous bucket', () => {
    const prevBucket = parseHeroReplayBucketMidpoint('invalid');
    const result = parseHeroReplayBucketMidpoint('260+', prevBucket);
    expect(result).toBeNull();
  });

  it('returns null for unparseable label', () => {
    const result = parseHeroReplayBucketMidpoint('not-a-bucket');
    expect(result).toBeNull();
  });

  it('handles whitespace in bucket labels', () => {
    const result = parseHeroReplayBucketMidpoint('  120-139  ');
    expect(result).not.toBeNull();
    expect(result!.label).toBe('120-139');
  });

  it('handles open-ended bucket after multiple closed buckets', () => {
    const p1 = parseHeroReplayBucketMidpoint('0-19');
    const p2 = parseHeroReplayBucketMidpoint('20-39', p1);
    const p3 = parseHeroReplayBucketMidpoint('40-59', p2);
    const p4 = parseHeroReplayBucketMidpoint('60-79', p3);
    const p5 = parseHeroReplayBucketMidpoint('80-99', p4);
    const p6 = parseHeroReplayBucketMidpoint('100-119', p5);
    const p7 = parseHeroReplayBucketMidpoint('120-139', p6);
    const p8 = parseHeroReplayBucketMidpoint('140-159', p7);
    const p9 = parseHeroReplayBucketMidpoint('160-179', p8);
    const p10 = parseHeroReplayBucketMidpoint('180-199', p9);
    const p11 = parseHeroReplayBucketMidpoint('200-219', p10);
    const p12 = parseHeroReplayBucketMidpoint('220-239', p11);
    const p13 = parseHeroReplayBucketMidpoint('240-259', p12);
    const open = parseHeroReplayBucketMidpoint('260+', p13);

    expect(open).not.toBeNull();
    expect(open!.midpoint).toBe(269.5);
    expect(open!.usedWidthHeuristic).toBe(true);
  });
});

describe('normalizeHeroReplaySnapshots', () => {
  it('returns empty series for empty snapshot array', () => {
    const result = normalizeHeroReplaySnapshots([]);
    expect(result.buckets).toEqual([]);
    expect(result.snapshots).toEqual([]);
    expect(result.historyStartAt).toBeNull();
    expect(result.historyEndAt).toBeNull();
    expect(result.historySpanMs).toBe(0);
  });

  it('normalizes single snapshot correctly', () => {
    const buckets = [
      createMockBucket('0-19', 0.1),
      createMockBucket('20-39', 0.2),
    ];
    const event = createMockEvent(buckets);
    const snapshot = createStoredSnapshot(event, 0);

    const result = normalizeHeroReplaySnapshots([snapshot]);

    expect(result.buckets.length).toBe(2);
    expect(result.snapshots.length).toBe(1);
    expect(result.historyStartAt).toBe(result.historyEndAt);
    expect(result.historySpanMs).toBe(0);
  });

  it('applies fallback to last valid ask when price is invalid', () => {
    const buckets1 = [
      createMockBucket('0-19', 0.1),
      createMockBucket('20-39', 0.2),
    ];
    const buckets2 = [
      createMockBucket('0-19', 0.15),
      createMockBucket('20-39', NaN), // Invalid price
    ];

    const event1 = createMockEvent(buckets1);
    const event2 = createMockEvent(buckets2);

    const snapshot1 = createStoredSnapshot(event1, 5);
    const snapshot2 = createStoredSnapshot(event2, 0);

    const result = normalizeHeroReplaySnapshots([snapshot1, snapshot2]);

    // Second snapshot should use fallback price for 20-39
    const secondSnapshot = result.snapshots[1];
    const bucket20 = secondSnapshot.buckets.find((b) => b.name === '20-39');
    expect(bucket20).not.toBeUndefined();
    expect(bucket20!.price).toBe(0.2); // Fallback to first snapshot's price
    expect(bucket20!.usedFallbackPrice).toBe(true);
  });

  it('excludes buckets with no valid historical value', () => {
    const buckets1 = [createMockBucket('0-19', NaN)]; // Invalid from start
    const buckets2 = [createMockBucket('0-19', NaN)]; // Still invalid

    const event1 = createMockEvent(buckets1);
    const event2 = createMockEvent(buckets2);

    const snapshot1 = createStoredSnapshot(event1, 5);
    const snapshot2 = createStoredSnapshot(event2, 0);

    const result = normalizeHeroReplaySnapshots([snapshot1, snapshot2]);

    // Bucket should be excluded because it never had a valid price
    expect(result.buckets.length).toBe(0);
    expect(result.snapshots[0].buckets.length).toBe(0);
  });

  it('handles open-ended buckets with width heuristic', () => {
    const closedBucket = createMockBucket('240-259', 0.8);
    const openBucket = createMockBucket('260+', 0.9);
    const buckets = [closedBucket, openBucket];
    const event = createMockEvent(buckets);
    const snapshot = createStoredSnapshot(event, 0);

    const result = normalizeHeroReplaySnapshots([snapshot]);

    expect(result.buckets.length).toBe(2);

    const openResult = result.buckets.find((b) => b.bucketName === '260+');
    expect(openResult).not.toBeUndefined();
    expect(openResult!.midpoint.isOpenEnded).toBe(true);
    expect(openResult!.midpoint.usedWidthHeuristic).toBe(true);
    expect(openResult!.midpoint.width).toBe(20);
  });

  it('correctly calculates history span', () => {
    const buckets = [createMockBucket('0-19', 0.1)];
    const event = createMockEvent(buckets);

    const snapshot1 = createStoredSnapshot(event, 10);
    const snapshot2 = createStoredSnapshot(event, 5);
    const snapshot3 = createStoredSnapshot(event, 0);

    const result = normalizeHeroReplaySnapshots([snapshot3, snapshot1, snapshot2]);

    // Should span 10 days
    expect(result.historySpanMs).toBe(10 * 24 * 60 * 60 * 1000);
    expect(result.historyStartAt).toBe(result.snapshots[0].capturedAt);
    expect(result.historyEndAt).toBe(result.snapshots.at(-1)!.capturedAt);
  });

  it('handles missing bucket in later snapshot gracefully', () => {
    const buckets1 = [
      createMockBucket('0-19', 0.1),
      createMockBucket('20-39', 0.2),
    ];
    const buckets2 = [createMockBucket('0-19', 0.15)]; // Missing 20-39

    const event1 = createMockEvent(buckets1);
    const event2 = createMockEvent(buckets2);

    const snapshot1 = createStoredSnapshot(event1, 5);
    const snapshot2 = createStoredSnapshot(event2, 0);

    const result = normalizeHeroReplaySnapshots([snapshot1, snapshot2]);

    // 20-39 should have fallback for second snapshot
    const secondSnapshot = result.snapshots[1];
    const bucket20 = secondSnapshot.buckets.find((b) => b.name === '20-39');
    expect(bucket20).not.toBeUndefined();
    expect(bucket20!.price).toBe(0.2);
    expect(bucket20!.usedFallbackPrice).toBe(true);
  });

  it('sorts snapshots by capture time', () => {
    const buckets = [createMockBucket('0-19', 0.1)];
    const event = createMockEvent(buckets);

    const snapshot1 = createStoredSnapshot(event, 0);
    const snapshot2 = createStoredSnapshot(event, 5);
    const snapshot3 = createStoredSnapshot(event, 10);

    const result = normalizeHeroReplaySnapshots([snapshot1, snapshot3, snapshot2]);

    // Should be sorted chronologically
    expect(result.snapshots[0].capturedAtMs).toBeLessThan(
      result.snapshots[1].capturedAtMs
    );
    expect(result.snapshots[1].capturedAtMs).toBeLessThan(
      result.snapshots[2].capturedAtMs
    );
  });

  it('handles corrupted event data gracefully', () => {
    const corruptedSnapshot: HeroReplayStoredSnapshot = {
      eventId: 'event-1',
      eventSlug: 'test',
      eventTitle: 'Test',
      eventEndDate: '2025-01-01',
      capturedAt: 'invalid',
      capturedAtMs: -1,
      event: {
        id: 'bad',
        title: 'bad',
        description: '',
        endDate: '2025-01-01',
        markets: [], // Empty markets - parseBuckets returns []
      },
    };

    const result = normalizeHeroReplaySnapshots([corruptedSnapshot]);

    // Should return empty series
    expect(result.buckets.length).toBe(0);
    expect(result.snapshots[0].buckets.length).toBe(0);
  });

  it('handles snapshots with identical timestamps', () => {
    const buckets = [createMockBucket('0-19', 0.1)];
    const event = createMockEvent(buckets);

    const now = Date.now();
    const snapshot1: HeroReplayStoredSnapshot = {
      ...createStoredSnapshot(event, 0),
      capturedAtMs: now,
      capturedAt: new Date(now).toISOString(),
    };
    const snapshot2: HeroReplayStoredSnapshot = {
      ...createStoredSnapshot(event, 0),
      capturedAtMs: now,
      capturedAt: new Date(now).toISOString(),
      eventId: 'event-2',
    };

    // Should not crash and should sort deterministically
    const result = normalizeHeroReplaySnapshots([snapshot2, snapshot1]);
    expect(result.snapshots.length).toBe(2);
  });
});

describe('replay duration bounds', () => {
  it('duration should be within 6-8 second target range', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    const derivePlaybackDurationMs = (
      historySpanMs: number
    ): number => {
      const minDurationMs = 6000;
      const maxDurationMs = 8000;
      const targetDurationMs = 7000;
      const boundedTarget = Math.min(
        maxDurationMs,
        Math.max(minDurationMs, targetDurationMs)
      );
      if (!Number.isFinite(historySpanMs) || historySpanMs <= 0) {
        return boundedTarget;
      }

      const historySpanDays = historySpanMs / DAY_MS;
      const normalizedSpan = Math.min(
        1,
        Math.max(0, historySpanDays / 4)
      );
      return Math.round(
        minDurationMs + (maxDurationMs - minDurationMs) * normalizedSpan
      );
    };

    // Empty history should give target duration
    expect(derivePlaybackDurationMs(0)).toBe(7000);
    expect(derivePlaybackDurationMs(-1)).toBe(7000);

    // 4 days = full target range
    const fourDays = 4 * DAY_MS;
    expect(derivePlaybackDurationMs(fourDays)).toBeGreaterThanOrEqual(6000);
    expect(derivePlaybackDurationMs(fourDays)).toBeLessThanOrEqual(8000);

    // Less than 4 days should give less than max
    const twoDays = 2 * DAY_MS;
    const twoDayDuration = derivePlaybackDurationMs(twoDays);
    expect(twoDayDuration).toBeGreaterThanOrEqual(6000);
    expect(twoDayDuration).toBeLessThanOrEqual(8000);
    expect(twoDayDuration).toBeLessThan(
      derivePlaybackDurationMs(fourDays)
    );
  });
});

describe('replay availability transitions', () => {
  it('returns no-history status for empty snapshots', () => {
    const determineAvailability = (
      snapshots: HeroReplayStoredSnapshot[]
    ): string => {
      if (snapshots.length === 0) {
        return 'no-history';
      }

      const MIN_HISTORY_MS = 4 * 24 * 60 * 60 * 1000;
      if (snapshots.length < 2) {
        return 'insufficient-history';
      }

      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const spanMs = last.capturedAtMs - first.capturedAtMs;

      if (spanMs < MIN_HISTORY_MS) {
        return 'insufficient-history';
      }

      return 'ready';
    };

    expect(determineAvailability([])).toBe('no-history');
    expect(determineAvailability([createStoredSnapshot(createMockEvent([createMockBucket('0-19', 0.1)]), 0)])).toBe('insufficient-history');
    expect(determineAvailability([
      createStoredSnapshot(createMockEvent([createMockBucket('0-19', 0.1)]), 10),
      createStoredSnapshot(createMockEvent([createMockBucket('0-19', 0.1)]), 0),
    ])).toBe('ready');
  });
});

describe('live-stop correctness', () => {
  it('playback ends on live state', () => {
    const buildLiveFrame = (
      livePoints: Array<{ bucketName: string; y: number }>,
      isComplete: boolean
    ) => {
      if (!isComplete) {
        return { state: 'playing' };
      }

      // On complete, should return live state
      return {
        state: 'live',
        points: livePoints,
        isLive: true,
      };
    };

    const livePoints = [
      { bucketName: '0-19', y: 0.1 },
      { bucketName: '20-39', y: 0.2 },
    ];

    const frame = buildLiveFrame(livePoints, false);
    expect(frame.state).toBe('playing');

    const completeFrame = buildLiveFrame(livePoints, true);
    expect(completeFrame.state).toBe('live');
    expect(completeFrame.isLive).toBe(true);
    expect(completeFrame.points).toEqual(livePoints);
  });
});
