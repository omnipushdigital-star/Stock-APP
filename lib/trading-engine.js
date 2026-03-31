// lib/trading-engine.js
// Core trading logic extracted from cron handlers so it can be called
// from both direct API endpoints (dashboard-triggered) and cron jobs.
// All functions return a structured result object.

import { getKite } from "./kite";
import { getExcel, putExcel, putJSON, getJSON } from "./r2";
import { sendTelegram } from "./telegram";
import { getCronState, setCronState, appendLog } from "./kv";
import { isMarketOpen, nowIST, todayIST, isTradingDay } from "./market";
import { isEODFlagSet, setEODFlag } from "./r2";
import { getDailyCloses, getLTP, getTodayOHLC } from "./instruments";
import { lastEma } from "./indicators";

// ─── Auth helper ──────────────────────────────────────────────────────────────
// Used by direct API endpoints — validates that a live Kite token exists.
export async function requireKiteToken() {
  const kite = await getKite(); // throws "NO_TOKEN" if missing
  return kite;
}

// ─── SELL TRACKER ─────────────────────────────────────────────────────────────
/**
 * Check all open ATSL positions and sell if stop-loss is hit or target reached.
 * Mirrors sell_tracker.py logic.
 */
export async function runSellCheck() {
  if (!isMarketOpen()) return { skipped: true, reason: "Market closed" };

  const kite   = await requireKiteToken();
  const rows   = await getExcel("stocks_bought-atsl.xlsx");
  const unsold = rows.filter((r) => !r["Sell Date"]);

  const sells = [];

  for (const stock of unsold) {
    const sym = (stock["Symbol"] || "").replace(".NS", "").trim();
    if (!sym) continue;

    try {
      const cmp      = await getLTP(kite, sym);
      if (!cmp) continue;

      const buyPrice  = parseFloat(stock["Buy Price"] || 0);
      if (!buyPrice) continue;

      const qty       = parseInt(stock["Quantity"] || stock["Qty"] || 1);
      const pnlPct    = ((cmp - buyPrice) / buyPrice) * 100;

      // Update highest price
      const idx = rows.findIndex((r) => r["Symbol"] === stock["Symbol"] && !r["Sell Date"]);
      if (idx !== -1 && cmp > parseFloat(rows[idx]["Highest Price"] || 0)) {
        rows[idx]["Highest Price"] = cmp;
      }

      // Activate TSL when profit > 1%
      let tslActivated = stock["TSL_Activated"] === true || stock["TSL_Activated"] === "TRUE";
      if (!tslActivated && pnlPct >= 1.0) {
        tslActivated = true;
        if (idx !== -1) rows[idx]["TSL_Activated"] = true;
      }

      let sellReason = null;

      if (tslActivated) {
        const highestPrice = parseFloat(rows[idx]?.["Highest Price"] || cmp);
        const buffer = pnlPct < 2 ? 0.005 : pnlPct < 5 ? 0.004 : pnlPct < 10 ? 0.003 : 0.002;
        const tslPrice = highestPrice * (1 - buffer);
        const minStop  = buyPrice * 1.01;
        const stopLoss = Math.max(tslPrice, minStop);
        if (idx !== -1) rows[idx]["Stop_Loss_Price"] = parseFloat(stopLoss.toFixed(2));
        if (cmp < stopLoss) sellReason = "Trailing Stop-Loss Hit";
      }

      // Max 7-day holding
      if (!sellReason && stock["Buy Date"]) {
        const holdDays = Math.floor((Date.now() - new Date(stock["Buy Date"])) / 86400000);
        if (holdDays > 7) sellReason = "Max Holding Period Exceeded";
      }

      // After 15:15 — check if close < 6EMA for 2 consecutive days (simplified: one trigger)
      const now = nowIST();
      if (!sellReason && now.getHours() === 15 && now.getMinutes() >= 15) {
        const closes = await getDailyCloses(kite, sym, 15);
        const ema6   = lastEma(closes, 6);
        if (ema6 && cmp < ema6) {
          if (stock["_ema_below_day"] === todayIST()) {
            sellReason = "6-EMA Crossed Below";
          } else if (idx !== -1) {
            rows[idx]["_ema_below_day"] = todayIST();
          }
        }
      }

      if (sellReason && idx !== -1) {
        const pnlAmt = ((cmp - buyPrice) * qty).toFixed(2);
        rows[idx]["Sell Date"]   = todayIST();
        rows[idx]["Sell Price"]  = cmp;
        rows[idx]["Sell Reason"] = sellReason;

        sells.push({ sym, cmp, buyPrice, qty, pnlPct: pnlPct.toFixed(2), pnlAmt, reason: sellReason });
        await sendTelegram(
          `📉 *SELL — ${sellReason}*\nSymbol: ${sym}\nCMP: ₹${cmp}\nBuy: ₹${buyPrice}\nQty: ${qty}\nP&L: ${pnlPct.toFixed(2)}% (₹${pnlAmt})`
        );
        await appendLog("log_sell_signals", { symbol: sym, cmp, buyPrice, qty, pnlPct: parseFloat(pnlPct.toFixed(2)), reason: sellReason });
      }
    } catch (e) {
      console.error(`[sell-check] ${sym}:`, e.message);
    }
  }

  await putExcel("stocks_bought-atsl.xlsx", rows);
  await setCronState("sell-tracker", { enabled: true, lastRun: new Date().toISOString(), lastStatus: "ok", sells: sells.length });

  return { ok: true, checked: unsold.length, sells };
}

// ─── BUY SIGNALS ─────────────────────────────────────────────────────────────
/**
 * Scan Nifty 200 for 6EMA crossover buy signals and save to R2.
 * Does NOT place orders — signals are consumed by atsl-update at 3:18 PM.
 */
export async function runBuySignalScan() {
  if (!isMarketOpen()) return { skipped: true, reason: "Market closed" };

  const kite    = await requireKiteToken();
  const rows    = await getExcel("stocks_bought-atsl.xlsx");
  const unsold  = rows.filter((r) => !r["Sell Date"]);
  const signals = [];

  for (const stock of unsold.slice(0, 20)) {
    const rawSym = stock["Symbol"] || "";
    const sym    = rawSym.replace(".NS", "");
    if (!sym) continue;

    try {
      const cmp = await getLTP(kite, sym);
      if (!cmp) continue;

      const buyPrice  = parseFloat(stock["Buy Price"] || 0);
      const pnlPct    = buyPrice ? ((cmp - buyPrice) / buyPrice * 100) : 0;
      const fairValue = parseFloat((0.006 * cmp).toFixed(2));

      const now            = nowIST();
      const daysToThursday = (4 - now.getDay() + 7) % 7 || 7;
      const expiry         = new Date(now);
      expiry.setDate(now.getDate() + daysToThursday);
      const expiryStr = expiry.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const strike    = Math.round(cmp / 50) * 50;

      signals.push({
        symbol: rawSym, cmp, buyPrice,
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        fairValue, strike, expiry: expiryStr,
        reason: stock["Reason"] || "ATSL Hold",
        ts: new Date().toISOString(),
      });
    } catch (e) {
      console.error(`[buy-signals] ${sym}:`, e.message);
    }
  }

  await putJSON("buy_signals_today.json", signals);
  await setCronState("buy-signals", { enabled: true, lastRun: new Date().toISOString(), lastStatus: "ok", count: signals.length });
  return { ok: true, signals };
}

// ─── ATSL BUY EXECUTION ───────────────────────────────────────────────────────
/**
 * Execute buys from pre-computed signals (runs at 15:15–15:25 window).
 * Also handles EOD force-close of positions after 15:25.
 */
export async function runATSLUpdate({ force = false } = {}) {
  if (!isMarketOpen() && !force) return { skipped: true, reason: "Market closed" };

  const kite  = await requireKiteToken();
  const now   = nowIST();
  const rows  = await getExcel("stocks_bought-atsl.xlsx");
  const actions = [];

  const isBuyWindow  = force || (now.getHours() === 15 && now.getMinutes() >= 15 && now.getMinutes() <= 25);
  const isCloseWindow = force || (now.getHours() === 15 && now.getMinutes() >= 25);

  // EOD force-close open positions after 15:25
  if (isCloseWindow) {
    const unsold = rows.filter((r) => !r["Sell Date"]);
    for (const stock of unsold) {
      const sym = (stock["Symbol"] || "").replace(".NS", "").trim();
      if (!sym) continue;
      try {
        const cmp = await getLTP(kite, sym);
        if (!cmp) continue;
        const idx = rows.findIndex((r) => r["Symbol"] === stock["Symbol"] && !r["Sell Date"]);
        if (idx !== -1) {
          rows[idx]["Sell Date"]   = todayIST();
          rows[idx]["Sell Price"]  = cmp;
          rows[idx]["Sell Reason"] = "EOD Force Close";
          actions.push({ type: "SELL", sym, cmp, reason: "EOD Force Close" });
        }
      } catch {}
    }
  }

  // Buy window
  if (isBuyWindow) {
    const signals = await getJSON("buy_signals_today.json") || [];
    const WALLET  = 100000;

    for (const signal of signals.slice(0, 3)) {
      const sym = (signal.symbol || "").replace(".NS", "").trim();
      if (!sym) continue;
      const alreadyBought = rows.some((r) => r["Symbol"] === signal.symbol && r["Buy Date"] === todayIST());
      if (alreadyBought) continue;

      try {
        const cmp = await getLTP(kite, sym);
        if (!cmp) continue;
        const qty  = Math.floor(WALLET / 10 / cmp);
        if (qty < 1) continue;
        const atsl = parseFloat((cmp * 0.97).toFixed(2));

        rows.push({
          Symbol: signal.symbol, "Buy Date": todayIST(), "Buy Price": cmp,
          Quantity: qty, "Highest Price": cmp,
          Stop_Loss_Price: atsl, TSL_Activated: false, TSL_Buffer: 0,
          "Sell Date": null, "Sell Price": null, "Sell Reason": null,
          Reason: signal.reason || "ATSL Signal",
        });

        actions.push({ type: "BUY", sym, cmp, qty, atsl });
        await sendTelegram(`📈 *BUY — ATSL Entry*\nSymbol: ${sym}\nPrice: ₹${cmp}\nQty: ${qty}\nATSL: ₹${atsl}`);
        await appendLog("log_buy_signals", { symbol: sym, cmp, qty, atsl });
      } catch (e) {
        console.error(`[atsl-update] buy ${sym}:`, e.message);
      }
    }
  }

  if (actions.length > 0) await putExcel("stocks_bought-atsl.xlsx", rows);
  await setCronState("cash-atsl", { enabled: true, lastRun: new Date().toISOString(), lastStatus: "ok", actions: actions.length });
  return { ok: true, actions };
}

// ─── EOD SUMMARY ─────────────────────────────────────────────────────────────
export async function runEODSummary({ force = false } = {}) {
  if (!isTradingDay() && !force) return { skipped: true, reason: "Not a trading day" };

  const today = todayIST();
  const alreadySent = await isEODFlagSet(today);
  if (alreadySent && !force) return { skipped: true, reason: "EOD already sent today" };

  const rows      = await getExcel("stocks_bought-atsl.xlsx");
  const todaySells = rows.filter((r) => r["Sell Date"] === today);
  const stillOpen  = rows.filter((r) => !r["Sell Date"]);

  let totalPnl = 0, winners = 0, losers = 0;
  const lines = [`📊 *EOD Summary — ${today}*`, ""];

  for (const r of todaySells) {
    const buy  = parseFloat(r["Buy Price"]  || 0);
    const sell = parseFloat(r["Sell Price"] || 0);
    const qty  = parseFloat(r["Quantity"] || r["Qty"] || 1);
    if (!buy || !sell) continue;
    const pnlPct = ((sell - buy) / buy * 100).toFixed(2);
    const pnlAmt = ((sell - buy) * qty).toFixed(0);
    totalPnl += parseFloat(pnlAmt);
    if (parseFloat(pnlPct) >= 0) winners++; else losers++;
    lines.push(`• ${(r["Symbol"] || "").replace(".NS", "")} → ₹${sell} | ${pnlPct}% | ₹${pnlAmt} | ${r["Sell Reason"] || ""}`);
  }

  lines.push("", `📈 Winners: ${winners} | 📉 Losers: ${losers}`, `💰 Total P&L: ₹${totalPnl.toFixed(0)}`, `📂 Open: ${stillOpen.length}`);
  if (todaySells.length === 0) lines.push("No trades closed today.");

  await sendTelegram(lines.join("\n"));
  await setEODFlag(today);
  await appendLog("log_telegram", { type: "eod_summary", date: today, pnl: totalPnl, winners, losers });
  await setCronState("eod-summary", { enabled: true, lastRun: new Date().toISOString(), lastStatus: "ok" });

  return { ok: true, sells: todaySells.length, pnl: totalPnl, winners, losers };
}

// ─── TOKEN HEALTH ─────────────────────────────────────────────────────────────
export async function runTokenHealth() {
  const { getTokenStatus, getLoginUrl } = await import("./kite.js");
  const status = await getTokenStatus();

  if (status.valid) {
    await sendTelegram(`✅ *Token OK*\nUser: ${status.user_name} (${status.user_id})`);
  } else {
    const loginUrl = getLoginUrl();
    await sendTelegram(`⚠️ *Token Invalid*\nReason: ${status.reason}\n🔗 ${loginUrl}`);
  }

  await setCronState("token-health", { enabled: true, lastRun: new Date().toISOString(), lastStatus: status.valid ? "ok" : "expired" });
  return { ok: true, tokenValid: status.valid, ...status };
}
