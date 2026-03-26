export interface PolymarketOutcome {
  id: string;
  name: string;
  price: number;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  description: string;
  outcomes: string; // JSON string
  outcomePrices: string; // JSON string
  clobTokenIds: string; // JSON string
  active: boolean;
  closed: boolean;
  endDate: string;
}

export interface PolymarketEvent {
  id: string;
  title: string;
  description: string;
  markets: PolymarketMarket[];
  endDate: string;
  trackingId?: string;
}

export interface TrackingStats {
  id: string;
  title: string;
  data?: {
    stats?: {
      total: number;
      daysElapsed: number;
    }
  }
}

export interface Bucket {
  id: string;
  name: string;
  price: number;
  tokenId: string;
}
