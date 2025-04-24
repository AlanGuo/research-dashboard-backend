export interface GliDataPoint {
  timestamp: number;
  datetime: string;
  
  // Exchange rates
  eurusd?: number;
  cnyusd?: number;
  jpyusd?: number;
  gbpusd?: number;
  cadusd?: number;
  audusd?: number;
  inrusd?: number;
  chfusd?: number;
  rubusd?: number;
  brlusd?: number;
  krwusd?: number;
  mxnusd?: number;
  idrusd?: number;
  zarusd?: number;
  myrusd?: number;
  sekusd?: number;
  nzdusd?: number;
  
  // Central banks
  fed?: number;
  rrp?: number;
  tga?: number;
  ecb?: number;
  pbc?: number;
  boj?: number;
  other_cb_total?: number;
  
  // M2 supply
  usa?: number;
  eu?: number;
  china?: number;
  japan?: number;
  other_m2_total?: number;
  
  // Total
  total: number;
}

export interface GliResponse {
  success: boolean;
  data?: GliDataPoint[];
  error?: string;
  timestamp: string;
  params?: any;
  message?: string;
}
