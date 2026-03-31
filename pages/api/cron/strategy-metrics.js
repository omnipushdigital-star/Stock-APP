// pages/api/cron/strategy-metrics.js
// Runs daily at 16:00 IST after market close.
// Calculates and saves performance metrics for all strategies.
// Vercel cron: "30 10 * * 1-5"  (10:30 UTC = 16:00 IST)

import { getAllStrategies } from "../../../lib/strategies/index";
import { calcAndSaveMetrics } from "../../../lib/paper-trading";
import { getCronState, setCronState } from "../../../lib/kv";
import { sendTelegram } from "../../../lib/telegram";
import { isTradingDay } from "../../../lib/market";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const cronName = "strategy-metrics";
  const state = await getCronState(cronName);
  if (!state.enabled) return res.json({ skipped: true, reason: "Cron disabled" });
  if (!isTradingDay()) return res.json({ skipped: true, reason: "Not a trading day" });

  try {
    const strategies = await getAllStrategies();
    const results = {};
    const summaryLines = [];

    for (const s of strategies) {
      try {
        const metrics = await calcAndSaveMetrics(s.id);
        results[s.id] = metrics;

        const pnlSign = metrics.totalPnL >= 0 ? "+" : "";
        summaryLines.push(
          `*${s.name}* (${s.mode.toUpperCase()})\n` +
          `  P&L: ${pnlSign}₹${Math.abs(metrics.totalPnL).toLocaleString("en-IN")} (${pnlSign}${metrics.pnlPct}%)\n` +
          `  Trades: ${metrics.totalTrades} | Win: ${metrics.winRate}% | Sharpe: ${metrics.sharpeRatio}\n` +
          `  Max DD: ${metrics.maxDrawdown}% | Open: ${metrics.openPositions}`
        );
      } catch (e) {
        results[s.id] = { error: e.message };
        summaryLines.push(`*${s.name}*: ❌ metrics error — ${e.message}`);
      }
    }

    // Daily summary Telegram
    if (summaryLines.length > 0) {
      await sendTelegram(
        `📊 *Daily Strategy Report*\n\n` +
        summaryLines.join("\n\n")
      );
    }

    await setCronState(cronName, {
      enabled:    true,
      lastRun:    new Date().toISOString(),
      lastStatus: "ok",
      count:      strategies.length,
    });

    res.json({ ok: true, results });
  } catch (e) {
    console.error("strategy-metrics cron error:", e);
    await sendTelegram(`❌ *strategy-metrics cron error*\n${e.message}`);
    await setCronState(cronName, { enabled: true, lastRun: new Date().toISOString(), lastStatus: "error" });
    res.status(500).json({ error: e.message });
  }
}
