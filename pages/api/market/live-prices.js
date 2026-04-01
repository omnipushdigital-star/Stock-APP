// GET /api/market/live-prices?symbols=NSE:RELIANCE,BSE:MUTHOOTFIN&indices=1
// Returns LTP + change% for any set of exchange-qualified symbols + major indices.
// Uses getOHLC (not getLTP) so we get the previous close for change calculation.
// All symbols batched into ONE Kite call. Designed to be called every 1 second.

import { getKite } from "../../../lib/kite";

const INDEX_SYMBOLS = [
  { label: "NIFTY 50",    sym: "NSE:NIFTY 50" },
  { label: "BANK NIFTY",  sym: "NSE:NIFTY BANK" },
  { label: "SENSEX",      sym: "BSE:SENSEX" },
  { label: "NIFTY IT",    sym: "NSE:NIFTY IT" },
  { label: "MIDCAP 100",  sym: "NSE:NIFTY MIDCAP 100" },
  { label: "FIN SERVICE", sym: "NSE:NIFTY FIN SERVICE" },
];

function calcChange(ltp, close) {
  if (!ltp || !close || close === ltp) return { change: 0, changePct: 0 };
  const change    = parseFloat((ltp - close).toFixed(2));
  const changePct = parseFloat(((ltp - close) / close * 100).toFixed(2));
  return { change, changePct };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "no-store");

  const { symbols = "", indices = "1" } = req.query;
  const withIndices = indices !== "0";

  // Accept pre-qualified symbols like "NSE:RELIANCE,BSE:MUTHOOTFIN"
  const stockKeys     = symbols ? symbols.split(",").map(s => s.trim()).filter(Boolean) : [];
  const indexKeys     = withIndices ? INDEX_SYMBOLS.map(i => i.sym) : [];
  const allKeys       = [...new Set([...stockKeys, ...indexKeys])].slice(0, 1000);

  if (!allKeys.length) return res.json({ ok: true, prices: {}, indices: [] });

  try {
    const kite = await getKite();
    // getOHLC returns last_price + ohlc.close (prev day close) — needed for change%
    const data = await kite.getOHLC(allKeys);

    // Build prices map keyed by the original symbol string passed in
    const prices = {};
    for (const key of stockKeys) {
      const d = data[key];
      if (!d) continue;
      const ltp   = d.last_price;
      const close = d.ohlc?.close ?? ltp;
      prices[key] = { ltp, close, ...calcChange(ltp, close) };
    }

    // Build indices array
    const indicesOut = withIndices ? INDEX_SYMBOLS.map(({ label, sym }) => {
      const d = data[sym];
      if (!d) return { label, ltp: null, change: null, changePct: null };
      const ltp   = d.last_price;
      const close = d.ohlc?.close ?? ltp;
      return { label, ltp, close, ...calcChange(ltp, close) };
    }) : [];

    res.json({ ok: true, prices, indices: indicesOut, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, prices: {}, indices: [] });
  }
}
