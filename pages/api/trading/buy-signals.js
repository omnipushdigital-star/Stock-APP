// POST /api/trading/buy-signals
// Scan Nifty 200 for 6EMA crossover buy candidates and save to R2.
// Called by dashboard every 3 min during market hours.
import { runBuySignalScan } from "../../../lib/trading-engine";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const result = await runBuySignalScan();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
