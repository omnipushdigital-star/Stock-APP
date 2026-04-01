// GET /api/market/live-prices?symbols=RELIANCE,TCS,INFY&indices=1
// Returns LTP for any set of NSE symbols + optionally the 6 major indices.
// All symbols batched into ONE Kite LTP call (up to 1,000 symbols per call).
// Designed to be called every 1 second from the dashboard.

import { getKite } from "../../../lib/kite";

const INDEX_SYMBOLS = [
  { key: "NIFTY 50",         label: "NIFTY 50",     sym: "NSE:NIFTY 50" },
  { key: "NIFTY BANK",       label: "BANK NIFTY",   sym: "NSE:NIFTY BANK" },
  { key: "SENSEX",           label: "SENSEX",        sym: "BSE:SENSEX" },
  { key: "NIFTY IT",         label: "NIFTY IT",      sym: "NSE:NIFTY IT" },
  { key: "NIFTY MIDCAP 100", label: "MIDCAP 100",   sym: "NSE:NIFTY MIDCAP 100" },
  { key: "NIFTY FIN SERVICE",label: "FIN SERVICE",   sym: "NSE:NIFTY FIN SERVICE" },
];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // No server-side cache — this is a live 1s ticker
  res.setHeader("Cache-Control", "no-store");

  const { symbols = "", indices = "1" } = req.query;
  const withIndices = indices !== "0";

  // Build full symbol list: NSE stocks + optional indices
  const stockSyms   = symbols ? symbols.split(",").map(s => s.trim().toUpperCase()).filter(Boolean) : [];
  const indexKiteSyms = withIndices ? INDEX_SYMBOLS.map(i => i.sym) : [];

  // Deduplicate and cap at 1,000 (Kite limit)
  const nseStockKeys   = [...new Set(stockSyms)].slice(0, 990).map(s => `NSE:${s}`);
  const allKiteSymbols = [...new Set([...nseStockKeys, ...indexKiteSyms])];

  if (!allKiteSymbols.length) {
    return res.json({ ok: true, prices: {}, indices: [] });
  }

  try {
    const kite = await getKite();
    const data = await kite.getLTP(allKiteSymbols); // single API call

    // Build price map: SYMBOL → { ltp, close, change, changePct }
    const prices = {};
    for (const sym of stockSyms) {
      const key = `NSE:${sym}`;
      const d   = data[key];
      if (!d) continue;
      const ltp       = d.last_price;
      const close     = d.ohlc?.close ?? ltp;
      prices[sym] = {
        ltp,
        close,
        change:    parseFloat((ltp - close).toFixed(2)),
        changePct: parseFloat(((ltp - close) / close * 100).toFixed(2)),
      };
    }

    // Build indices array
    const indicesOut = withIndices ? INDEX_SYMBOLS.map(({ key, label, sym }) => {
      const d = data[sym];
      if (!d) return { label, ltp: null, change: null, changePct: null };
      const ltp   = d.last_price;
      const close = d.ohlc?.close ?? ltp;
      return {
        label,
        ltp,
        close,
        change:    parseFloat((ltp - close).toFixed(2)),
        changePct: parseFloat(((ltp - close) / close * 100).toFixed(2)),
      };
    }) : [];

    res.json({ ok: true, prices, indices: indicesOut, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, prices: {}, indices: [] });
  }
}
