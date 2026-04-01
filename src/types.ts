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

export interface Bucket {
  id: string;
  name: string;
  price: number; // Detail view entry price (best ask when available)
  tokenId: string;
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
  hoursElapsed: number;
  hoursRemaining: number;
  periodStart: string;
  periodEnd: string;
  rangeProbabilities: RangeProbability[];
}
