export interface GliTrendPeriod {
  startDate: string;
  endDate: string;
  trend: 'up' | 'down';
  label?: string;
}

export interface GliTrendResponse {
  success: boolean;
  data: GliTrendPeriod[];
  timestamp: string;
}
