// pages/api/cron/sell-tracker.js
// Mirrors sell_tracker.py — tracks open positions and triggers sells
import { getKite } from "../../../lib/kite";
import { getExcel, putExcel } from "../../../lib/r2";
import { sendTelegram } from "../../../lib/telegram";
import { getCronState, setCronState, appendLog } from "../../../lib/kv";
import { isMarketOpen, todayIST } from "../../../lib/market";

const PROFIT_TARGET_PCT = 15;  // Take profit at +15%
const STOP_LOSS_PCT     = -5;  // Stop loss at -5%
const TRAIL_STEP_PCT    = 3;   // Trail by 3%

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const cronName = "sell-tracker";
  const state = await getCronState(cronName);
  if (!state.enabled) return res.json({ skipped: true, reason: "Cron disabled" });
  if (!isMarketOpen()) return res.json({ skipped: true, reason: "Market closed" });

  try {
    const kite = await getKite();
    const rows = await getExcel("buy_signals_aws.xlsx").catch(() => getExcel("stocks_bought-atsl.xlsx"));
    const unsold = rows.filter((r) => !r["Sell Date"]);

    const sells = [];

    for (const stock of unsold) {
      const sym = (stock["Symbol"] || "").replace(".NS", "");
      if (!sym) continue;

      try {
        const ltpData = await kite.getLTP([`NSE:${sym}`]);
        const cmp = ltpData[`NSE:${sym}`]?.last_price;
        if (!cmp) continue;

        const buyPrice = parseFloat(stock["Buy Price"] || 0);
        if (!buyPrice) continue;

        const pnlPct = ((cmp - buyPrice) / buyPrice) * 100;
        let sellReason = null;

        if (pnlPct >= PROFIT_TARGET_PCT) {
          sellReason = `Target Hit (+${pnlPct.toFixed(2)}%)`;
        } else if (pnlPct <= STOP_LOSS_PCT) {
          sellReason = `Stop Loss (${pnlPct.toFixed(2)}%)`;
        }

        if (sellReason) {
          const idx = rows.findIndex(
            (r) => r["Symbol"] === stock["Symbol"] && !r["Sell Date"]
          );
          if (idx !== -1) {
            rows[idx]["Sell Date"] = todayIST();
            rows[idx]["Sell Price"] = cmp;
            rows[idx]["Sell Reason"] = sellReason;

            sells.push({ sym, cmp, buyPrice, pnlPct: pnlPct.toFixed(2), reason: sellReason });

            await sendTelegram(
              `📉 *SELL — ${sellReason}*\n` +
              `Symbol: ${sym}\nCMP: ₹${cmp}\nBuy: ₹${buyPrice}\nP&L: ${pnlPct.toFixed(2)}%`
            );
            await appendLog("log_sell_signals", {
              symbol: sym, cmp, buyPrice, pnlPct: parseFloat(pnlPct.toFixed(2)), reason: sellReason,
            });
          }
        }
      } catch (e) {
        console.error(`Sell check error ${sym}:`, e.message);
      }
    }

    if (sells.length > 0) {
      await putExcel("stocks_bought-atsl.xlsx", rows);
    }

    await setCronState(cronName, { enabled: true, lastRun: new Date().toISOString(), lastStatus: "ok", sells: sells.length });
    res.json({ ok: true, sells: sells.length });
  } catch (e) {
    console.error("sell-tracker error:", e);
    await sendTelegram(`❌ *sell-tracker cron error*\n${e.message}`);
    await setCronState(cronName, { enabled: true, lastRun: new Date().toISOString(), lastStatus: "error" });
    res.status(500).json({ error: e.message });
  }
}
