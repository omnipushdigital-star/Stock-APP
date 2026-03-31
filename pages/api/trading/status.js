// GET /api/trading/status
// Returns last-run state for all trading engine jobs + market open status.
import { getCronState } from "../../../lib/kv";
import { isMarketOpen, nowIST, isTradingDay } from "../../../lib/market";

const JOBS = ["sell-tracker", "buy-signals", "cash-atsl", "eod-summary", "token-health", "paper-trading"];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const states = await Promise.all(JOBS.map(async (name) => {
      const s = await getCronState(name);
      return { name, ...s };
    }));

    const now = nowIST();
    res.json({
      ok: true,
      marketOpen:   isMarketOpen(),
      tradingDay:   isTradingDay(),
      istTime:      now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      jobs:         states,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
