// pages/api/cron/buy-signals.js
// Mirrors generate_buy_signals.py — analyzes unsold stocks, calculates option signals
import { getKite } from "../../../lib/kite";
import { getExcel, putJSON } from "../../../lib/r2";
import { sendTelegram } from "../../../lib/telegram";
import { getCronState, setCronState, appendLog } from "../../../lib/kv";
import { isMarketOpen, nowIST, todayIST } from "../../../lib/market";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const cronName = "buy-signals";
  const state = await getCronState(cronName);
  if (!state.enabled) return res.json({ skipped: true, reason: "Cron disabled" });
  if (!isMarketOpen()) return res.json({ skipped: true, reason: "Market closed" });

  try {
    const kite = await getKite();
    const rows = await getExcel("stocks_bought-atsl.xlsx");
    const unsold = rows.filter((r) => !r["Sell Date"]);

    const signals = [];
    const skipped = [];

    for (const stock of unsold.slice(0, 20)) {
      const rawSym = stock["Symbol"] || "";
      const sym = rawSym.replace(".NS", "");
      if (!sym) continue;

      try {
        const ltpData = await kite.getLTP([`NSE:${sym}`]);
        const cmp = ltpData[`NSE:${sym}`]?.last_price;
        if (!cmp) { skipped.push({ sym, reason: "No LTP" }); continue; }

        const buyPrice = parseFloat(stock["Buy Price"] || 0);
        const pnlPct = buyPrice ? ((cmp - buyPrice) / buyPrice * 100) : 0;

        // Fair value estimate (mirrors Python: 0.006 * cmp * beta ≈ 0.6% premium)
        const fairValue = parseFloat((0.006 * cmp).toFixed(2));

        // Next expiry Thursday
        const now = nowIST();
        const daysToThursday = (4 - now.getDay() + 7) % 7 || 7;
        const expiry = new Date(now);
        expiry.setDate(now.getDate() + daysToThursday);
        const expiryStr = expiry.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

        // Round strike to nearest 50
        const strike = Math.round(cmp / 50) * 50;

        signals.push({
          symbol: rawSym,
          cmp,
          buyPrice,
          pnlPct: parseFloat(pnlPct.toFixed(2)),
          fairValue,
          strike,
          expiry: expiryStr,
          reason: stock["Reason"] || "ATSL Hold",
          ts: new Date().toISOString(),
        });
      } catch (e) {
        skipped.push({ sym, reason: e.message });
      }
    }

    // Save signals to R2 for cash-atsl to consume
    await putJSON("buy_signals_today.json", signals);

    // Log to KV
    if (signals.length > 0) {
      for (const sig of signals) {
        await appendLog("log_buy_signals", {
          symbol: sig.symbol,
          cmp: sig.cmp,
          pnlPct: sig.pnlPct,
          strike: sig.strike,
          expiry: sig.expiry,
          reason: sig.reason,
        });
      }
    }

    const now2 = new Date().toISOString();
    await setCronState(cronName, { enabled: true, lastRun: now2, lastStatus: "ok", count: signals.length });
    res.json({ ok: true, signals: signals.length, skipped: skipped.length });
  } catch (e) {
    console.error("buy-signals error:", e);
    await sendTelegram(`❌ *buy-signals cron error*\n${e.message}`);
    await setCronState(cronName, { enabled: true, lastRun: new Date().toISOString(), lastStatus: "error" });
    res.status(500).json({ error: e.message });
  }
}
