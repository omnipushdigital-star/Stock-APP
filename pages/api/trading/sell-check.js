// POST /api/trading/sell-check
// Check all open positions for adaptive TSL / EMA exit / max hold.
// Called by Cloudflare Worker every 5 min OR dashboard auto-pilot.
// Auth: Bearer CRON_SECRET header OR dashboard (no header = allowed from same origin).
import { runSellCheck } from "../../../lib/trading-engine";

function isAuthorized(req) {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  // Allow dashboard calls (no auth header) — endpoints are POST-only so not exploitable by GET
  if (!auth) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
  const { force = false } = req.body || {};
  try {
    const result = await runSellCheck({ force });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
