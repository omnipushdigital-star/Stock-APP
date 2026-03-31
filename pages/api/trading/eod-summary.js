// POST /api/trading/eod-summary
// Send EOD P&L summary to Telegram. Pass { force: true } to resend.
import { runEODSummary } from "../../../lib/trading-engine";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { force = false } = req.body || {};
  try {
    const result = await runEODSummary({ force });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
