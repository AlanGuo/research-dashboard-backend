/**
 * Calculate Simple Moving Average (SMA)
 * @param data Array of numeric values
 * @param period Period for SMA calculation
 * @returns Array of SMA values (with undefined values for the first period-1 elements)
 */
export function calculateSMA(data: number[], period: number): number[] {
  if (!data || data.length === 0 || period <= 0) {
    return [];
  }

  const result: number[] = new Array(data.length).fill(undefined);

  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j];
    }
    result[i] = sum / period;
  }

  return result;
}

/**
 * Calculate Rate of Change (ROC)
 * @param data Array of numeric values
 * @param period Period for ROC calculation
 * @returns Array of ROC values (with undefined values for the first period elements)
 */
export function calculateROC(data: number[], period: number): number[] {
  if (!data || data.length === 0 || period <= 0) {
    return [];
  }

  const result: number[] = new Array(data.length).fill(undefined);

  for (let i = period; i < data.length; i++) {
    const currentValue = data[i];
    const previousValue = data[i - period];

    if (previousValue !== 0 && previousValue !== undefined) {
      result[i] = ((currentValue - previousValue) / previousValue) * 100;
    } else {
      result[i] = 0; // Avoid division by zero
    }
  }

  return result;
}
