// pages/api/portfolio/positions.js
// Returns open (unsold) and closed positions from stocks_bought-atsl.xlsx in R2
import { getExcel } from "../../../lib/r2";
import { getKite } from "../../../lib/kite";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const rows = await getExcel("stocks_bought-atsl.xlsx");
    const unsold = rows.filter((r) => !r["Sell Date"]);
    const sold = rows.filter((r) => r["Sell Date"]);

    // Optionally fetch live LTPs
    let ltpMap = {};
    if (req.query.live === "1" && unsold.length > 0) {
      try {
        const kite = await getKite();
        const symbols = [...new Set(unsold.map((r) => r["Symbol"]).filter(Boolean))];
        const keys = symbols.map((s) => `NSE:${s.replace(".NS", "")}`);
        if (keys.length > 0) {
          const ltp = await kite.getLTP(keys);
          Object.entries(ltp).forEach(([k, v]) => {
            ltpMap[k.replace("NSE:", "")] = v.last_price;
          });
        }
      } catch {
        // LTP fetch optional — proceed without it
      }
    }

    const unsoldWithLTP = unsold.map((r) => {
      const sym = (r["Symbol"] || "").replace(".NS", "");
      const cmp = ltpMap[sym] || null;
      const buyPrice = parseFloat(r["Buy Price"]) || 0;
      const pnl = cmp && buyPrice ? ((cmp - buyPrice) / buyPrice * 100).toFixed(2) : null;
      return { ...r, cmp, pnl };
    });

    res.json({ unsold: unsoldWithLTP, sold, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
