// lib/ohlc-cache.js — Rolling 30-day OHLC cache stored in R2
//
// Structure in R2 (ohlc_cache.json):
//   { "RELIANCE": [{date, open, high, low, close}, ...newest first (LIFO)], ... }
//
// Benefits:
//   - First run of day: fetches only delta since last cached date (1-2 candles)
//   - Same-day re-runs: zero historical API calls
//   - EMA always available from cache — strategies just read memory

import { getJSON, putJSON } from "./r2";
import { nowIST } from "./market";

const CACHE_KEY   = "ohlc_cache.json";
const MAX_CANDLES = 30;

/**
 * Load the full OHLC cache from R2.
 * Returns {} if not yet created.
 */
export async function loadOHLCCache() {
  try {
    const data = await getJSON(CACHE_KEY);
    return (data && typeof data === "object") ? data : {};
  } catch {
    return {};
  }
}

/**
 * Save the full OHLC cache back to R2.
 */
export async function saveOHLCCache(cache) {
  await putJSON(CACHE_KEY, cache);
}

/**
 * Get candles for one symbol from cache (newest first / LIFO).
 * Returns [] if symbol not cached.
 */
export function getCachedCandles(cache, symbol) {
  return cache[symbol.toUpperCase()] || [];
}

/**
 * Get closes for EMA computation (oldest→newest, as EMA expects).
 */
export function getCachedCloses(cache, symbol) {
  const candles = getCachedCandles(cache, symbol);
  return [...candles].reverse().map(c => c.close);
}

/**
 * Refresh cache for a list of symbols — fetches only missing candles since last cached date.
 * On first run: fetches 30 days. On same-day re-run: skips. Otherwise: delta only.
 *
 * @param {object} kite       - authenticated KiteConnect instance
 * @param {object} tokenMap   - { SYMBOL: token } pre-fetched map
 * @param {string[]} symbols  - list of NSE symbols to refresh
 * @param {object} cache      - existing cache (mutated in place)
 * @returns {object} stats    - { fetched, skipped, failed }
 */
export async function refreshOHLCCache(kite, tokenMap, symbols, cache) {
  const now     = nowIST();
  const today   = now.toISOString().split("T")[0];
  const stats   = { fetched: 0, skipped: 0, failed: 0 };
  const sleep   = (ms) => new Promise(r => setTimeout(r, ms));

  // Full fetch from date
  const fullFrom = new Date(now);
  fullFrom.setDate(fullFrom.getDate() - Math.ceil(MAX_CANDLES * 1.6)); // buffer for weekends
  const fullFromStr = fullFrom.toISOString().split("T")[0];

  for (const sym of symbols) {
    const key    = sym.toUpperCase();
    const token  = tokenMap[key] ?? null;
    if (!token) { stats.failed++; continue; }

    const cached    = cache[key] || [];
    const lastDate  = cached.length ? cached[0].date : null;  // newest = index 0

    // Already up to date for today
    if (lastDate === today) { stats.skipped++; continue; }

    try {
      await sleep(150); // stay under Kite rate limit

      // Delta fetch: from day after last cached date, or full fetch if empty
      const fromStr = lastDate
        ? (() => { const d = new Date(lastDate); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0]; })()
        : fullFromStr;

      const data = await kite.getHistoricalData(token, "day", fromStr, today, false, false);
      if (!Array.isArray(data) || data.length === 0) { stats.skipped++; continue; }

      // Parse new candles (newest first for LIFO prepend)
      const newCandles = data
        .map(c => Array.isArray(c)
          ? { date: String(c[0]).split("T")[0], open: c[1], high: c[2], low: c[3], close: c[4] }
          : { date: String(c[0]).split("T")[0], open: c.open, high: c.high, low: c.low, close: c.close }
        )
        .reverse(); // newest first

      // Prepend new candles, deduplicate by date, trim to MAX_CANDLES
      const merged = [...newCandles, ...cached];
      const seen   = new Set();
      cache[key]   = merged
        .filter(c => { if (seen.has(c.date)) return false; seen.add(c.date); return true; })
        .slice(0, MAX_CANDLES);

      stats.fetched++;
    } catch (e) {
      console.error(`[ohlc-cache] ${sym}: ${e.message}`);
      stats.failed++;
    }
  }

  return stats;
}

/**
 * One-shot: load cache, refresh for given symbols, save, return cache.
 * Use this at the start of each strategy run.
 */
export async function getRefreshedCache(kite, tokenMap, symbols) {
  const cache = await loadOHLCCache();
  const stats = await refreshOHLCCache(kite, tokenMap, symbols, cache);
  await saveOHLCCache(cache);
  console.log(`[ohlc-cache] fetched:${stats.fetched} skipped:${stats.skipped} failed:${stats.failed}`);
  return { cache, stats };
}
