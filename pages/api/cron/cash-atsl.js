// pages/api/cron/cash-atsl.js
// Mirrors cash_atsl.py — ATSL strategy: monitors positions, triggers buys at 3:18 PM, sells on ATSL breach
import { getKite } from "../../../lib/kite";
import { getExcel, putExcel, isEODFlagSet } from "../../../lib/r2";
import { sendTelegram } from "../../../lib/telegram";
import { getCronState, setCronState, appendLog } from "../../../lib/kv";
import { isMarketOpen, nowIST, todayIST } from "../../../lib/market";

const NIFTY200_KEY = "EQUITY_L_NIFTY200.csv";
const STOCKS_FILE = "stocks_bought-atsl.xlsx";
const WALLET_BALANCE = 100000;

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const cronName = "cash-atsl";
  const state = await getCronState(cronName);
  if (!state.enabled) return res.json({ skipped: true, reason: "Cron disabled" });
  if (!isMarketOpen()) return res.json({ skipped: true, reason: "Market closed" });

  const now = nowIST();
  const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  const isBuyWindow = now.getHours() === 15 && now.getMinutes() >= 15 && now.getMinutes() <= 25;
  const isCloseWindow = now.getHours() === 15 && now.getMinutes() >= 25;

  try {
    const kite = await getKite();
    const rows = await getExcel(STOCKS_FILE);
    const unsold = rows.filter((r) => !r["Sell Date"]);

    let actions = [];

    // ── SELL CHECK: ATSL (All Time Stop Loss) breach ──────────────────────
    for (const stock of unsold) {
      const sym = (stock["Symbol"] || "").replace(".NS", "");
      if (!sym) continue;

      try {
        const ltpData = await kite.getLTP([`NSE:${sym}`]);
        const cmp = ltpData[`NSE:${sym}`]?.last_price;
        if (!cmp) continue;

        const atsl = parseFloat(stock["ATSL"] || stock["Stop Loss"] || 0);
        const buyPrice = parseFloat(stock["Buy Price"] || 0);

        // Sell if CMP < ATSL
        if (atsl > 0 && cmp < atsl) {
          const idx = rows.findIndex(
            (r) => r["Symbol"] === stock["Symbol"] && !r["Sell Date"]
          );
          if (idx !== -1) {
            rows[idx]["Sell Date"] = todayIST();
            rows[idx]["Sell Price"] = cmp;
            rows[idx]["Sell Reason"] = "ATSL Breach";
            const pnl = ((cmp - buyPrice) / buyPrice * 100).toFixed(2);
            actions.push({ type: "SELL", sym, reason: "ATSL Breach", cmp, atsl, pnl });
            await sendTelegram(
              `📉 *SELL — ATSL Breach*\nSymbol: ${sym}\nCMP: ₹${cmp}\nATSL: ₹${atsl}\nBuy: ₹${buyPrice}\nP&L: ${pnl}%`
            );
          }
        }

        // Force close at 3:25 PM
        if (isCloseWindow) {
          const idx = rows.findIndex(
            (r) => r["Symbol"] === stock["Symbol"] && !r["Sell Date"]
          );
          if (idx !== -1) {
            rows[idx]["Sell Date"] = todayIST();
            rows[idx]["Sell Price"] = cmp;
            rows[idx]["Sell Reason"] = "EOD Force Close";
            actions.push({ type: "SELL", sym, reason: "EOD Close", cmp });
          }
        }
      } catch (e) {
        console.error(`LTP error for ${sym}:`, e.message);
      }
    }

    // ── BUY CHECK: 3:15–3:25 PM window ───────────────────────────────────
    if (isBuyWindow) {
      try {
        // Load Nifty 200 stock list from R2
        const { getJSON } = await import("../../../lib/r2");
        const signals = await getJSON("buy_signals_today.json") || [];

        for (const signal of signals.slice(0, 3)) {
          const sym = signal.symbol?.replace(".NS", "");
          if (!sym) continue;
          // Check not already bought today
          const alreadyBought = rows.some(
            (r) => r["Symbol"] === signal.symbol && r["Buy Date"] === todayIST()
          );
          if (alreadyBought) continue;

          try {
            const ltpData = await kite.getLTP([`NSE:${sym}`]);
            const cmp = ltpData[`NSE:${sym}`]?.last_price;
            if (!cmp) continue;

            const qty = Math.floor(WALLET_BALANCE / 10 / cmp);
            if (qty < 1) continue;

            const atsl = parseFloat((cmp * 0.97).toFixed(2)); // 3% stop loss

            rows.push({
              Symbol: signal.symbol,
              "Buy Date": todayIST(),
              "Buy Price": cmp,
              Qty: qty,
              ATSL: atsl,
              "Sell Date": null,
              "Sell Price": null,
              "Sell Reason": null,
            });

            actions.push({ type: "BUY", sym, cmp, qty, atsl });
            await sendTelegram(
              `📈 *BUY — ATSL Entry*\nSymbol: ${sym}\nPrice: ₹${cmp}\nQty: ${qty}\nATSL: ₹${atsl}\nReason: ${signal.reason || "ATSL Signal"}`
            );
          } catch (e) {
            console.error(`Buy error for ${sym}:`, e.message);
          }
        }
      } catch (e) {
        console.error("Buy window error:", e.message);
      }
    }

    // Save updated positions back to R2
    if (actions.length > 0) {
      await putExcel(STOCKS_FILE, rows);
      await appendLog("log_buy_signals", ...actions.filter((a) => a.type === "BUY"));
      await appendLog("log_sell_signals", ...actions.filter((a) => a.type === "SELL"));
    }

    const now2 = new Date().toISOString();
    await setCronState(cronName, { enabled: true, lastRun: now2, lastStatus: "ok", actions: actions.length });
    res.json({ ok: true, time: timeStr, actions });
  } catch (e) {
    console.error("cash-atsl error:", e);
    await sendTelegram(`❌ *cash-atsl cron error*\n${e.message}`);
    await setCronState(cronName, { enabled: true, lastRun: new Date().toISOString(), lastStatus: "error" });
    res.status(500).json({ error: e.message });
  }
}
