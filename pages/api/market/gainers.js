// GET /api/market/gainers?minPct=1
// Fetches all Nifty 200 stocks in ONE getOHLC call, returns those up > minPct% today.
// Uses hardcoded symbol list (falls back from R2 JSON if unavailable).
// Sorted by changePct descending.

import { getKite } from "../../../lib/kite";
import { getJSON } from "../../../lib/r2";
import { NIFTY200_SYMBOLS } from "../../../lib/nifty200";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "no-store");

  const minPct = parseFloat(req.query.minPct ?? "1");

  try {
    const kite = await getKite();

    // Try R2 first, fall back to hardcoded list
    let symbolList = null;
    try {
      const r2List = await getJSON("EQUITY_L_NIFTY200_symbols.json");
      if (Array.isArray(r2List) && r2List.length > 0) {
        symbolList = r2List.map((s) => s.replace(".NS", "").trim().toUpperCase());
      }
    } catch {}
    if (!symbolList) symbolList = NIFTY200_SYMBOLS;

    // Build NSE: keys — all in one batch
    const keys = symbolList.map((s) => `NSE:${s}`);

    // Single batched getOHLC call — all symbols at once
    const data = await kite.getOHLC(keys);

    const gainers = [];
    for (const key of keys) {
      const d = data[key];
      if (!d) continue;
      const ltp   = d.last_price;
      const close = d.ohlc?.close;
      if (!ltp || !close || close === 0) continue;

      const changePct = parseFloat(((ltp - close) / close * 100).toFixed(2));
      if (changePct < minPct) continue;

      const sym = key.replace("NSE:", "");
      gainers.push({
        symbol:    sym,
        ltp:       parseFloat(ltp.toFixed(2)),
        prevClose: parseFloat(close.toFixed(2)),
        change:    parseFloat((ltp - close).toFixed(2)),
        changePct,
      });
    }

    gainers.sort((a, b) => b.changePct - a.changePct);

    res.json({
      ok: true,
      count: gainers.length,
      minPct,
      universe: symbolList.length,
      gainers,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
