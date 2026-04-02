// GET /api/market/gainers?minPct=1&universe=nifty200
// Fetches all Nifty 200 stocks in ONE getOHLC call, returns those up > minPct% today.
// Sorted by changePct descending.

import { getKite } from "../../../lib/kite";
import { getJSON } from "../../../lib/r2";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "no-store");

  const minPct = parseFloat(req.query.minPct ?? "1");

  try {
    const kite = await getKite();

    // Load Nifty 200 symbol list from R2
    const nifty200 = await getJSON("EQUITY_L_NIFTY200_symbols.json").catch(() => null) || [];
    if (!nifty200.length) return res.status(503).json({ ok: false, error: "Nifty 200 list not available" });

    // Build NSE: keys (strip .NS suffix)
    const keys = nifty200.map((s) => `NSE:${s.replace(".NS", "").trim().toUpperCase()}`);

    // Single batched getOHLC call — all 200 symbols at once
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

    // Sort best gainers first
    gainers.sort((a, b) => b.changePct - a.changePct);

    res.json({ ok: true, count: gainers.length, minPct, gainers, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
