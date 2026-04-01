// lib/instruments.js — Kite instrument token lookup & historical OHLC fetching
// Caches the NSE instruments list in KV daily to avoid repeated large fetches.

import { kvGet, kvPut } from "./kv";
import { todayIST, nowIST } from "./market";

const CACHE_KEY = "instruments_nse_map";
const CACHE_DATE_KEY = "instruments_nse_map_date";

/**
 * Load symbol→token map from KV cache, or refresh from Kite API.
 * @param {import('kiteconnect').KiteConnect} kite
 * @returns {Promise<Record<string, number>>}  { RELIANCE: 738561, ... }
 */
export async function getNSETokenMap(kite) {
  const cachedDate = await kvGet(CACHE_DATE_KEY);
  const today = todayIST();

  if (cachedDate === today) {
    const map = await kvGet(CACHE_KEY);
    if (map && typeof map === "object") return map;
  }

  // Fetch fresh instruments list from Kite
  const instruments = await kite.getInstruments(["NSE"]);
  const map = {};
  for (const inst of instruments) {
    if (inst.exchange === "NSE" && inst.segment === "NSE") {
      map[inst.tradingsymbol] = inst.instrument_token;
    }
  }

  // Cache in KV (expires next day naturally since we check date)
  await kvPut(CACHE_KEY, map);
  await kvPut(CACHE_DATE_KEY, today);
  return map;
}

/**
 * Get the instrument_token for a given NSE symbol.
 * @param {import('kiteconnect').KiteConnect} kite
 * @param {string} symbol - e.g. "RELIANCE"
 * @returns {Promise<number|null>}
 */
export async function getToken(kite, symbol) {
  const clean = symbol.replace(".NS", "").toUpperCase();
  const map = await getNSETokenMap(kite);
  return map[clean] ?? null;
}

/**
 * Fetch historical daily OHLC candles for a symbol.
 * Returns candles as array: { date, open, high, low, close, volume }
 * @param {import('kiteconnect').KiteConnect} kite
 * @param {string} symbol - e.g. "RELIANCE"
 * @param {number} days - how many trading days back to fetch (default 45)
 * @returns {Promise<Array<{date:string, open:number, high:number, low:number, close:number, volume:number}>>}
 */
export async function getDailyOHLC(kite, symbol, days = 45) {
  const token = await getToken(kite, symbol);
  if (!token) return [];

  const now = nowIST();
  const from = new Date(now);
  from.setDate(from.getDate() - Math.ceil(days * 1.5)); // extra buffer for weekends/holidays

  const toStr   = now.toISOString().split("T")[0];
  const fromStr = from.toISOString().split("T")[0];

  try {
    const data = await kite.getHistoricalData(token, "day", fromStr, toStr, false, false);
    return (data || []).slice(-days).map((c) => ({
      date:   c[0] instanceof Date ? c[0].toISOString().split("T")[0] : String(c[0]).split("T")[0],
      open:   c[1],
      high:   c[2],
      low:    c[3],
      close:  c[4],
      volume: c[5],
    }));
  } catch (e) {
    console.error(`getDailyOHLC(${symbol}): ${e.message}`);
    return [];
  }
}

/**
 * Fetch daily closes for a symbol (convenience wrapper).
 * @returns {Promise<number[]>} oldest → newest
 */
export async function getDailyCloses(kite, symbol, days = 45) {
  const candles = await getDailyOHLC(kite, symbol, days);
  return candles.map((c) => c.close);
}

/**
 * Get current LTP for one OR multiple symbols in a single API call.
 * Zerodha allows up to 1,000 symbols per /quote/ltp request (1 req/sec limit).
 *
 * Single symbol: getLTP(kite, "RELIANCE") → number|null
 * Multiple symbols: getLTP(kite, ["RELIANCE", "TCS"]) → { RELIANCE: 1234, TCS: 3456 }
 */
export async function getLTP(kite, symbol) {
  const symbols = Array.isArray(symbol) ? symbol : [symbol];
  const keys = symbols.map((s) => `NSE:${s.replace(".NS", "").toUpperCase()}`);
  try {
    const data = await kite.getLTP(keys);
    if (!Array.isArray(symbol)) {
      return data[keys[0]]?.last_price ?? null;
    }
    const result = {};
    for (const s of symbols) {
      const k = `NSE:${s.replace(".NS", "").toUpperCase()}`;
      result[s.replace(".NS", "").toUpperCase()] = data[k]?.last_price ?? null;
    }
    return result;
  } catch {
    return Array.isArray(symbol) ? {} : null;
  }
}

/**
 * Get OHLC quote for today (single candle — no historical needed).
 * @returns {Promise<{open:number, high:number, low:number, close:number}|null>}
 */
export async function getTodayOHLC(kite, symbol) {
  const clean = symbol.replace(".NS", "").toUpperCase();
  try {
    const data = await kite.getOHLC([`NSE:${clean}`]);
    const q = data[`NSE:${clean}`]?.ohlc;
    return q ? { open: q.open, high: q.high, low: q.low, close: q.close } : null;
  } catch {
    return null;
  }
}
