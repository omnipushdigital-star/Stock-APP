// pages/api/portfolio/trade-history.js
import { getExcel } from "../../../lib/r2";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const rows = await getExcel("trade_history.xlsx");
    // Sort newest first
    const sorted = rows.sort((a, b) => {
      const da = new Date(b["Buy Date"] || 0);
      const db = new Date(a["Buy Date"] || 0);
      return da - db;
    });
    res.json({ trades: sorted, total: sorted.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
