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
  
  // 原始数据（未经汇率转换）
  raw_ecb?: number;  // 欧洲央行原始数据
  raw_pbc?: number;  // 中国央行原始数据
  raw_boj?: number;  // 日本央行原始数据
  
  // M2 supply
  usa?: number;
  eu?: number;
  china?: number;
  japan?: number;
  other_m2_total?: number;
  
  // 原始M2数据（未经汇率转换）
  raw_eu?: number;    // 欧洲M2原始数据
  raw_china?: number; // 中国M2原始数据
  raw_japan?: number; // 日本M2原始数据
  
  // Total values
  central_bank_total?: number;
  m2_total?: number;
  central_bank_div_m2_ratio?: number;
}

export interface GliResponse {
  success: boolean;
  data?: GliDataPoint[];
  error?: string;
  timestamp: string;
  params?: any;
  message?: string;
}
