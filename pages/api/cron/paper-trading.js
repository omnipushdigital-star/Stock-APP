// pages/api/cron/paper-trading.js
// Runs every 5 minutes during market hours. Executes all active paper strategies.
// Vercel cron: "*/5 9-15 * * 1-5"

import { runAllActiveStrategies } from "../../../lib/strategies/index";
import { getCronState, setCronState } from "../../../lib/kv";
import { isMarketOpen } from "../../../lib/market";
import { sendTelegram } from "../../../lib/telegram";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const cronName = "paper-trading";
  const state = await getCronState(cronName);
  if (!state.enabled) return res.json({ skipped: true, reason: "Cron disabled" });
  if (!isMarketOpen()) return res.json({ skipped: true, reason: "Market closed" });

  try {
    const results = await runAllActiveStrategies();

    const totalActions = Object.values(results).reduce((sum, r) => {
      if (r?.actions) return sum + r.actions.length;
      return sum;
    }, 0);

    await setCronState(cronName, {
      enabled:    true,
      lastRun:    new Date().toISOString(),
      lastStatus: "ok",
      strategies: Object.keys(results).length,
      actions:    totalActions,
    });

    res.json({ ok: true, results, totalActions });
  } catch (e) {
    console.error("paper-trading cron error:", e);
    await sendTelegram(`❌ *paper-trading cron error*\n${e.message}`);
    await setCronState(cronName, { enabled: true, lastRun: new Date().toISOString(), lastStatus: "error" });
    res.status(500).json({ error: e.message });
  }
}
