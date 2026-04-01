// GET /api/market/indices
// Returns real-time LTP + OHLC for major Indian indices via Zerodha Kite.
import { getKite } from "../../../lib/kite";

const INDICES = [
  { key: "NIFTY 50",        symbol: "NSE:NIFTY 50",          label: "NIFTY 50" },
  { key: "NIFTY BANK",      symbol: "NSE:NIFTY BANK",        label: "BANK NIFTY" },
  { key: "SENSEX",          symbol: "BSE:SENSEX",            label: "SENSEX" },
  { key: "NIFTY IT",        symbol: "NSE:NIFTY IT",          label: "NIFTY IT" },
  { key: "NIFTY MIDCAP 100",symbol: "NSE:NIFTY MIDCAP 100", label: "MIDCAP 100" },
  { key: "NIFTY FIN SERVICE",symbol: "NSE:NIFTY FIN SERVICE",label: "FIN SERVICE" },
];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // Cache for 15 seconds
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");

  try {
    const kite = await getKite();
    const symbols = INDICES.map((i) => i.symbol);
    const data = await kite.getLTP(symbols);

    const indices = INDICES.map(({ key, symbol, label }) => {
      const d = data[symbol];
      if (!d) return { label, symbol, ltp: null, change: null, changePct: null };
      const ltp       = d.last_price;
      const close     = d.ohlc?.close || ltp;
      const change    = parseFloat((ltp - close).toFixed(2));
      const changePct = parseFloat(((ltp - close) / close * 100).toFixed(2));
      return { label, symbol, ltp, close, change, changePct };
    });

    res.json({ ok: true, indices, ts: new Date().toISOString() });
  } catch (e) {
    // Return empty on auth error so ticker shows gracefully
    res.json({ ok: false, indices: [], error: e.message });
  }
}
