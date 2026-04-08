// pages/api/cron/refresh-ohlc-cache.js
// Pre-market OHLC cache warmer — runs at 8:30 AM IST (3:00 AM UTC) on weekdays.
// Fetches 30-day rolling OHLC for all Nifty 200 symbols and stores in R2.
// Strategy "Run Now" clicks throughout the day read from this warm cache (zero API calls).

import { getKite } from "../../../lib/kite";
import { getNSETokenMap } from "../../../lib/instruments";
import { NIFTY200_SYMBOLS } from "../../../lib/nifty200";
import { getRefreshedCache } from "../../../lib/ohlc-cache";
import { getJSON } from "../../../lib/r2";

export const config = { maxDuration: 300 }; // 5-minute budget for cold fetch

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const kite      = await getKite();
    const tokenMap  = await getNSETokenMap(kite);

    const nifty200pre = await getJSON("EQUITY_L_NIFTY200_symbols.json").catch(() => null);
    const symbols = ((nifty200pre && nifty200pre.length) ? nifty200pre : NIFTY200_SYMBOLS)
      .filter(Boolean)
      .map(s => s.replace(".NS", "").trim());

    const { stats } = await getRefreshedCache(kite, tokenMap, symbols);

    console.log(`[refresh-ohlc-cache] done — fetched:${stats.fetched} skipped:${stats.skipped} failed:${stats.failed}`);
    res.json({ ok: true, symbols: symbols.length, ...stats });
  } catch (e) {
    console.error("[refresh-ohlc-cache]", e.message);
    res.status(500).json({ error: e.message });
  }
}
