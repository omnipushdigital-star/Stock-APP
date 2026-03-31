// lib/indicators.js — Technical indicator calculations (EMA, RSI, SMA)
// All functions operate on plain arrays of closing prices (oldest → newest)

/**
 * Calculate Exponential Moving Average.
 * @param {number[]} closes - Array of close prices, oldest first
 * @param {number} period
 * @returns {number[]} EMA values (same length as input, initial values are SMA-seeded)
 */
export function ema(closes, period) {
  if (!closes || closes.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  // Seed with SMA of first `period` values
  const seed = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(seed);
  for (let i = period; i < closes.length; i++) {
    result.push(closes[i] * k + result[result.length - 1] * (1 - k));
  }
  // Pad front with nulls to align with original array
  const padding = Array(period - 1).fill(null);
  return [...padding, ...result];
}

/**
 * Get last EMA value (most recent).
 * @param {number[]} closes - Array of close prices, oldest first
 * @param {number} period
 * @returns {number|null}
 */
export function lastEma(closes, period) {
  const values = ema(closes, period);
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i];
  }
  return null;
}

/**
 * Calculate RSI (Wilder's smoothing method).
 * @param {number[]} closes - Array of close prices, oldest first
 * @param {number} period - default 14
 * @returns {number[]} RSI values aligned with input (first `period` slots are null)
 */
export function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return [];

  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  // Initial averages (simple)
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const rsiValues = Array(period).fill(null); // alignment padding
  const firstRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  rsiValues.push(firstRsi);

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const r = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    rsiValues.push(r);
  }

  return rsiValues;
}

/**
 * Get last RSI value.
 */
export function lastRsi(closes, period = 14) {
  const values = rsi(closes, period);
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i];
  }
  return null;
}

/**
 * Simple Moving Average.
 */
export function sma(closes, period) {
  if (!closes || closes.length < period) return [];
  const result = Array(period - 1).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const avg = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    result.push(avg);
  }
  return result;
}

/**
 * Check if a crossover happened: series A crossed above series B between candle[-2] and candle[-1].
 * @param {number[]} a - indicator A values aligned with closes
 * @param {number[]} b - indicator B values aligned with closes
 */
export function crossedAbove(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return false;
  const prev_a = a[n - 2], prev_b = b[n - 2];
  const curr_a = a[n - 1], curr_b = b[n - 1];
  if (prev_a == null || prev_b == null || curr_a == null || curr_b == null) return false;
  return prev_a <= prev_b && curr_a > curr_b;
}

/**
 * Check if series A crossed below series B.
 */
export function crossedBelow(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return false;
  const prev_a = a[n - 2], prev_b = b[n - 2];
  const curr_a = a[n - 1], curr_b = b[n - 1];
  if (prev_a == null || prev_b == null || curr_a == null || curr_b == null) return false;
  return prev_a >= prev_b && curr_a < curr_b;
}

/**
 * Compute Sharpe Ratio from daily P&L percentage returns.
 * @param {number[]} returns - daily return percentages
 * @param {number} riskFreeRate - annualised risk-free rate (default 6.5% India)
 */
export function sharpeRatio(returns, riskFreeRate = 0.065) {
  if (!returns || returns.length < 2) return 0;
  const dailyRf = riskFreeRate / 252;
  const excess = returns.map((r) => r / 100 - dailyRf);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((a, b) => a + (b - mean) ** 2, 0) / (excess.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return parseFloat(((mean / stdDev) * Math.sqrt(252)).toFixed(2));
}

/**
 * Compute Max Drawdown from an equity curve array.
 * @param {number[]} equityCurve - portfolio values over time
 * @returns {number} max drawdown as a negative percentage (e.g. -12.5)
 */
export function maxDrawdown(equityCurve) {
  if (!equityCurve || equityCurve.length < 2) return 0;
  let peak = equityCurve[0];
  let maxDD = 0;
  for (const val of equityCurve) {
    if (val > peak) peak = val;
    const dd = (val - peak) / peak * 100;
    if (dd < maxDD) maxDD = dd;
  }
  return parseFloat(maxDD.toFixed(2));
}
