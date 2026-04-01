// POST /api/trading/atsl-update
// Execute buys from signals (3:15–3:25 PM window) and EOD force-close.
// Called by Cloudflare Worker at 3:15, 3:18, 3:22, 3:25 PM IST.
// Pass { force: true } to run outside the time window (manual trigger).
import { runATSLUpdate } from "../../../lib/trading-engine";

function isAuthorized(req) {
  const auth = req.headers.authorization;
  return !auth || auth === `Bearer ${process.env.CRON_SECRET}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
  const { force = false } = req.body || {};
  try {
    const result = await runATSLUpdate({ force });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
