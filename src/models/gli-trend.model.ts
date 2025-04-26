export interface GliTrendPeriod {
  startDate: string;
  endDate: string;
  trend: 'up' | 'down';
  label?: string;
  percentChange?: number; // GLI在该时段的百分比变化
}

export interface GliTrendResponse {
  success: boolean;
  data: GliTrendPeriod[];
  timestamp: string;
  error?: string;
  errors?: any[];
  message?: string;
}
