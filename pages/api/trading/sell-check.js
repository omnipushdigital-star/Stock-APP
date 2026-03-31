// POST /api/trading/sell-check
// Check all open positions for ATSL breach / stop-loss / holding period.
// Called by dashboard every 30s during market hours. No CRON_SECRET needed.
import { runSellCheck } from "../../../lib/trading-engine";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const result = await runSellCheck();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
