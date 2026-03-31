// pages/api/cron/eod-summary.js
// Mirrors send_eod_summary.py — sends end-of-day P&L summary to Telegram
import { getExcel } from "../../../lib/r2";
import { isEODFlagSet, setEODFlag } from "../../../lib/r2";
import { sendTelegram } from "../../../lib/telegram";
import { getCronState, setCronState, appendLog } from "../../../lib/kv";
import { todayIST, isTradingDay } from "../../../lib/market";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!isTradingDay()) return res.json({ skipped: true, reason: "Not a trading day" });

  const today = todayIST();
  const alreadySent = await isEODFlagSet(today);
  if (alreadySent) return res.json({ skipped: true, reason: "EOD already sent today" });

  const cronName = "eod-summary";
  const state = await getCronState(cronName);
  if (!state.enabled) return res.json({ skipped: true, reason: "Cron disabled" });

  try {
    const rows = await getExcel("stocks_bought-atsl.xlsx");

    // Sold today
    const todaySells = rows.filter((r) => r["Sell Date"] === today);
    // Still open
    const stillOpen = rows.filter((r) => !r["Sell Date"]);

    let totalPnl = 0;
    let winners = 0, losers = 0;
    const lines = ["📊 *EOD Summary — " + today + "*", ""];

    for (const r of todaySells) {
      const buy = parseFloat(r["Buy Price"] || 0);
      const sell = parseFloat(r["Sell Price"] || 0);
      const qty = parseFloat(r["Qty"] || 1);
      if (!buy || !sell) continue;
      const pnlPct = ((sell - buy) / buy * 100).toFixed(2);
      const pnlAmt = ((sell - buy) * qty).toFixed(0);
      totalPnl += parseFloat(pnlAmt);
      if (parseFloat(pnlPct) >= 0) winners++; else losers++;
      lines.push(`• ${r["Symbol"]?.replace(".NS", "")} → ₹${sell} | ${pnlPct}% | ₹${pnlAmt} | ${r["Sell Reason"]}`);
    }

    lines.push("");
    lines.push(`📈 Winners: ${winners} | 📉 Losers: ${losers}`);
    lines.push(`💰 Total P&L: ₹${totalPnl.toFixed(0)}`);
    lines.push(`📂 Open Positions: ${stillOpen.length}`);

    if (todaySells.length === 0) {
      lines.push("No trades closed today.");
    }

    const msg = lines.join("\n");
    await sendTelegram(msg);
    await setEODFlag(today);
    await appendLog("log_telegram", { type: "eod_summary", date: today, pnl: totalPnl, winners, losers });

    await setCronState(cronName, { enabled: true, lastRun: new Date().toISOString(), lastStatus: "ok" });
    res.json({ ok: true, sells: todaySells.length, pnl: totalPnl });
  } catch (e) {
    console.error("eod-summary error:", e);
    await sendTelegram(`❌ *eod-summary error*\n${e.message}`);
    res.status(500).json({ error: e.message });
  }
}
