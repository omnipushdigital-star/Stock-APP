// pages/api/admin/warm-cache.js
// Manually warms the OHLC cache for all Nifty 200 symbols.
// No auth required (only reads public market data). Rate-limited to 1 call/5min via KV.

export const config = { maxDuration: 300 };

import { getKite } from "../../../lib/kite";
import { getNSETokenMap } from "../../../lib/instruments";
import { NIFTY200_SYMBOLS } from "../../../lib/nifty200";
import { loadOHLCCache, refreshOHLCCache, saveOHLCCache } from "../../../lib/ohlc-cache";
import { getJSON } from "../../../lib/r2";
import { kvGet, kvPut } from "../../../lib/kv";

export default async function handler(req, res) {
  // Rate-limit: allow one warm every 5 minutes
  const lastWarm = await kvGet("ohlc_last_warm");
  if (lastWarm && Date.now() - new Date(lastWarm).getTime() < 5 * 60 * 1000) {
    return res.json({ ok: true, skipped: true, reason: "Warmed recently", lastWarm });
  }

  try {
    const kite     = await getKite();
    const tokenMap = await getNSETokenMap(kite);

    const nifty200pre = await getJSON("EQUITY_L_NIFTY200_symbols.json").catch(() => null);
    const symbols = ((nifty200pre && nifty200pre.length) ? nifty200pre : NIFTY200_SYMBOLS)
      .filter(Boolean)
      .map(s => s.replace(".NS", "").trim());

    const cache = await loadOHLCCache();
    const stats = await refreshOHLCCache(kite, tokenMap, symbols, cache);
    await saveOHLCCache(cache);
    await kvPut("ohlc_last_warm", new Date().toISOString());

    res.json({ ok: true, symbols: symbols.length, ...stats });
  } catch (e) {
    console.error("[warm-cache]", e.message);
    res.status(500).json({ error: e.message });
  }
}
