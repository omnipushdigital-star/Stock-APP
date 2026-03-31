// POST /api/trading/token-health
// Check Kite token validity and send Telegram alert.
import { runTokenHealth } from "../../../lib/trading-engine";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const result = await runTokenHealth();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
