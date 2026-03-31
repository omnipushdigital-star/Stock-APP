// POST /api/trading/atsl-update
// Execute buys from signals (3:15–3:25 PM window) and EOD force-close.
// Pass { force: true } to run outside the time window (manual trigger).
import { runATSLUpdate } from "../../../lib/trading-engine";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { force = false } = req.body || {};
  try {
    const result = await runATSLUpdate({ force });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
