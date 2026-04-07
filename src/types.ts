export interface PolymarketOutcome {
  id: string;
  name: string;
  price: number;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  description: string;
  outcomes: string; // JSON string - use JSON.parse() to get string[]
  outcomePrices: string; // JSON string - use JSON.parse() to get string[]
  clobTokenIds: string; // JSON string - use JSON.parse() to get string[]
  active: boolean;
  closed: boolean;
  endDate: string;
  // Counter fields from API
  // Note: Market-level volume/liquidity are strings from API, unlike event-level which are numbers
  volume?: string; // String representation of volume (API returns string at market level)
  volumeNum?: number; // Numeric volume (use this for calculations)
  liquidity?: string; // Market liquidity (API returns string at market level)
  volume1wk?: number; // Volume in last week
  volume1mo?: number; // Volume in last month
  volume1yr?: number; // Volume in last year
  bestAsk?: number | string; // Market best ask (entry price to buy)
  bestBid?: number | string; // Market best bid (price to sell)
  lastTradePrice?: number; // Last trade price
  spread?: number; // Bid-ask spread
  oneDayPriceChange?: number; // 24h price change
  oneWeekPriceChange?: number; // 7d price change
  oneMonthPriceChange?: number; // 30d price change
  orderMinSize?: number; // Minimum order size
}

export interface PolymarketEvent {
  id: string;
  title: string;
  description: string;
  slug?: string;
  markets: PolymarketMarket[];
  endDate: string;
  trackingId?: string;
  // Counter fields from API
  liquidity?: number; // Total liquidity across all markets
  volume?: number; // Total volume traded
  openInterest?: number; // Current open interest
  volume24hr?: number; // Volume in last 24 hours
  volume1wk?: number; // Volume in last week
  volume1mo?: number; // Volume in last month
  volume1yr?: number; // Volume in last year
  commentCount?: number; // Number of comments
  competitive?: number; // Market competitiveness score (0-1)
}

export interface TrackingStats {
  id: string;
  total: number;
  daysElapsed: number;
  startDate: string;
  endDate: string;
  title?: string;
}

export const HERO_REPLAY_MIN_HISTORY_DAYS = 4;
export const HERO_REPLAY_MIN_HISTORY_MS = HERO_REPLAY_MIN_HISTORY_DAYS * 24 * 60 * 60 * 1000;

export type HeroReplayAvailability = 'no-history' | 'insufficient-history' | 'ready';
export type HeroReplayFrameKind = 'snapshot' | 'interpolated' | 'live';
export type HeroReplayPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'complete' | 'unavailable';

export interface HeroReplaySnapshotIdentity {
  eventId: string;
  eventSlug?: string;
  eventTitle: string;
  eventEndDate: string;
  trackingId?: string;
}

export interface HeroReplayStoredSnapshot extends HeroReplaySnapshotIdentity {
  capturedAt: string;
  capturedAtMs: number;
  // Store the raw event payload so replay reuses parseBuckets() pricing.
  event: PolymarketEvent;
}

export interface HeroReplayBucketRange {
  label: string;
  rangeStart: number;
  rangeEnd: number | null;
  width: number | null;
  isOpenEnded: boolean;
}

export interface HeroReplayBucketMidpoint extends HeroReplayBucketRange {
  midpoint: number;
  usedWidthHeuristic: boolean;
}

export interface HeroReplayNormalizedBucket extends Bucket {
  midpoint: HeroReplayBucketMidpoint;
  sourceCapturedAt: string;
  sourceCapturedAtMs: number;
  sourceSnapshotIndex: number;
  usedFallbackPrice: boolean;
}

export interface HeroReplayChartPoint {
  bucketId: string;
  bucketName: string;
  tokenId: string;
  x: number;
  y: number;
  midpoint: HeroReplayBucketMidpoint;
  usedFallbackPrice: boolean;
}

export interface HeroReplayNormalizedSnapshot extends HeroReplaySnapshotIdentity {
  capturedAt: string;
  capturedAtMs: number;
  sourceSnapshotIndex: number;
  buckets: HeroReplayNormalizedBucket[];
  points: HeroReplayChartPoint[];
}

export interface HeroReplayNormalizedSeriesBucket {
  bucketId: string;
  bucketName: string;
  tokenId: string;
  x: number;
  midpoint: HeroReplayBucketMidpoint;
}

export interface HeroReplayNormalizedSeries {
  buckets: HeroReplayNormalizedSeriesBucket[];
  snapshots: HeroReplayNormalizedSnapshot[];
  historyStartAt: string | null;
  historyEndAt: string | null;
  historySpanMs: number;
}

export interface HeroReplayFrame {
  kind: HeroReplayFrameKind;
  frameAt: string;
  frameAtMs: number;
  startedAt: string;
  startedAtMs: number;
  endedAt: string;
  endedAtMs: number;
  interpolationProgress: number;
  sourceSnapshotIndex: number;
  nextSnapshotIndex: number | null;
  isLive: boolean;
  buckets: HeroReplayNormalizedBucket[];
  points: HeroReplayChartPoint[];
}

export interface HeroReplayAvailabilityState {
  status: HeroReplayAvailability;
  isReplayEligible: boolean;
  minimumHistoryDays: number;
  minimumHistoryMs: number;
  snapshotCount: number;
  historyStartAt: string | null;
  historyEndAt: string | null;
  historySpanMs: number;
  latestSnapshotAt: string | null;
  hasLiveSnapshot: boolean;
}

export interface HeroReplayStatus {
  availability: HeroReplayAvailabilityState;
  playbackState: HeroReplayPlaybackState;
  currentFrameIndex: number;
  currentFrameKind: HeroReplayFrameKind | null;
  currentFrameAt: string | null;
  isAtLiveFrame: boolean;
  shouldStopPlayback: boolean;
}

export interface HeroReplayPlaybackConfig {
  minDurationMs: number;
  maxDurationMs: number;
  targetDurationMs: number;
}

export interface HeroReplayHistoryPayload {
  availability: HeroReplayAvailabilityState;
  series: HeroReplayNormalizedSeries;
}

export interface HeroReplayFramesPayload {
  availability: HeroReplayAvailabilityState;
  frames: HeroReplayFrame[];
  liveFrame: HeroReplayFrame | null;
}

export interface Bucket {
  id: string;
  name: string;
  price: number; // Detail view entry price (best ask when available)
  tokenId: string;
  spread?: number; // Bid-ask spread in percentage points (undefined for categorical outcomes)
}

export interface RangeProbability {
  range: string;
  rangeStart: number;
  rangeEnd: number;
  probability: number;
}

export interface ProjectionInsufficient {
  insufficient: true;
  hoursElapsed: number;
  currentCount: number;
}

export interface TweetProjection {
  trackingId: string;
  title: string;
  currentCount: number;
  tweetsPerHour: number;
  pace24h?: number;
  projectedTotal: number;
  projectedRange: { low: number; high: number };
  confidence: number;
  rateStability: 'stable' | 'unstable' | 'neutral';
  hoursElapsed: number;
  hoursRemaining: number;
  periodStart: string;
  periodEnd: string;
  rangeProbabilities: RangeProbability[];
}
