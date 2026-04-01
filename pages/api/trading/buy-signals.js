// POST /api/trading/buy-signals
// Scan Nifty 200 for 6EMA crossover buy candidates and save to R2.
// Called by Cloudflare Worker every 30 min OR dashboard auto-pilot.
import { runBuySignalScan } from "../../../lib/trading-engine";

function isAuthorized(req) {
  const auth = req.headers.authorization;
  return !auth || auth === `Bearer ${process.env.CRON_SECRET}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const result = await runBuySignalScan();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
