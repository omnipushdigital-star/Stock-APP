// lib/strategies/cash-atsl.js
// Exact JS port of cash_atsl.py — Nifty 200 6EMA crossover with adaptive TSL.
// Handles both PAPER and LIVE modes via the paper-trading / order-executor modules.

import { getExcel, putExcel, getJSON } from "../r2";
import { sendTelegram } from "../telegram";
import { todayIST, nowIST } from "../market";
import { getDailyCloses, getLTP } from "../instruments";
import { lastEma } from "../indicators";
import { executePaperTrade } from "../paper-trading";
import { executeOrder } from "../order-executor";
import { checkRisk } from "../risk-manager";

const STOCKS_FILE   = "stocks_bought-atsl.xlsx";
const NIFTY_SYMBOL  = "NIFTY 50";   // index symbol in Kite (NSE:NIFTY 50)

// ─── EMA helpers ─────────────────────────────────────────────────────────────

async function get6EMA(kite, symbol) {
  const closes = await getDailyCloses(kite, symbol, 30);
  return closes.length >= 6 ? lastEma(closes, 6) : null;
}

async function getNiftyEMA(kite) {
  // Nifty 50 index — use NIFTY as symbol in historical data
  const closes = await getDailyCloses(kite, "NIFTY 50", 30).catch(() => []);
  return closes.length >= 6 ? lastEma(closes, 6) : null;
}

// ─── Adaptive TSL buffer ─────────────────────────────────────────────────────

function tslBuffer(profitPct) {
  if (profitPct < 2)  return 0.005;  // 0.5%
  if (profitPct < 5)  return 0.004;  // 0.4%
  if (profitPct < 10) return 0.003;  // 0.3%
  return 0.002;                       // 0.2%
}

// ─── Days held helper ─────────────────────────────────────────────────────────

function daysHeld(buyDateStr) {
  if (!buyDateStr) return 0;
  const buy = new Date(buyDateStr);
  const now = new Date();
  return Math.floor((now - buy) / 86400000);
}

// ─── Main cycle ───────────────────────────────────────────────────────────────

/**
 * Run one full ATSL cycle: sell check (always) + buy check (time-gated).
 * Called by lib/strategies/index.js runStrategyCycle().
 */
export async function runCycle(kite, def, { now, forceBuy = false } = {}) {
  const cfg    = def.config;
  const isLive = def.mode === "live";
  const ist    = now || nowIST();

  const isBuyWindow = forceBuy || (
    ist.getHours() === cfg.buyWindow.hour &&
    ist.getMinutes() >= cfg.buyWindow.minStart &&
    ist.getMinutes() <= cfg.buyWindow.minEnd
  );

  const isPostClose = ist.getHours() === 15 && ist.getMinutes() >= 15;

  // Load open positions from R2 (live uses the shared ATSL file)
  const allRows = await getExcel(STOCKS_FILE);
  const unsold  = allRows.filter((r) => !r["Sell Date"]);

  const actions = [];

  // ─── SELL CHECK ───────────────────────────────────────────────────────────
  for (const stock of unsold) {
    const sym = (stock["Symbol"] || "").replace(".NS", "").trim();
    if (!sym) continue;

    try {
      const cmp = await getLTP(kite, sym);
      if (!cmp) continue;

      const buyPrice    = parseFloat(stock["Buy Price"] || 0);
      const qty         = parseInt(stock["Quantity"] || stock["Qty"] || 0);
      const highestPrice = Math.max(parseFloat(stock["Highest Price"] || buyPrice), cmp);
      const profitPct   = ((cmp - buyPrice) / buyPrice) * 100;

      // Update Highest Price
      const idx = allRows.findIndex((r) => r["Symbol"] === stock["Symbol"] && !r["Sell Date"]);

      if (idx !== -1 && cmp > parseFloat(allRows[idx]["Highest Price"] || 0)) {
        allRows[idx]["Highest Price"] = cmp;
      }

      // Activate TSL when profit > activation threshold
      let tslActivated = stock["TSL_Activated"] === true || stock["TSL_Activated"] === "TRUE";
      if (!tslActivated && profitPct >= cfg.tslActivationPct) {
        tslActivated = true;
        if (idx !== -1) allRows[idx]["TSL_Activated"] = true;
      }

      let sellReason = null;

      if (tslActivated) {
        const buffer   = tslBuffer(profitPct);
        const tslPrice = parseFloat((highestPrice * (1 - buffer)).toFixed(2));
        // Min stop = buy × 1.01 (lock in 1% once activated)
        const minStop  = parseFloat((buyPrice * 1.01).toFixed(2));
        const stopLoss = Math.max(tslPrice, minStop);

        if (idx !== -1) allRows[idx]["Stop_Loss_Price"] = stopLoss;

        if (cmp < stopLoss) {
          sellReason = "Trailing Stop-Loss Hit";
        }
      }

      // Max holding period
      if (!sellReason && daysHeld(stock["Buy Date"]) > cfg.maxHoldDays) {
        sellReason = "Max Holding Period Exceeded";
      }

      // Post 15:15 → check 2 consecutive closes below 6EMA
      if (!sellReason && isPostClose) {
        const ema6 = await get6EMA(kite, sym);
        if (ema6 && cmp < ema6) {
          const prevDayBelow = parseFloat(stock["TSL_Buffer"] || 0) > 0 &&
            parseFloat(stock["Stop_Loss_Price"] || 0) === -1; // sentinel
          // Simpler approach: check today close < EMA and mark; sell next cycle
          if (stock["_ema_below_day"] === todayIST()) {
            sellReason = "6-EMA Crossed Below";
          } else if (idx !== -1) {
            allRows[idx]["_ema_below_day"] = todayIST();
          }
        } else if (idx !== -1) {
          allRows[idx]["_ema_below_day"] = null;
        }
      }

      if (sellReason && idx !== -1) {
        const pnlVal = ((cmp - buyPrice) * qty).toFixed(2);
        const pnlPct = ((cmp - buyPrice) / buyPrice * 100).toFixed(2);

        allRows[idx]["Sell Date"]   = todayIST();
        allRows[idx]["Sell Price"]  = cmp;
        allRows[idx]["Sell Reason"] = sellReason;

        actions.push({ type: "SELL", sym, cmp, reason: sellReason, pnlPct, pnlVal });

        const tag = isLive ? "" : "[PAPER] ";
        await sendTelegram(
          `📉 *${tag}SELL — ${sellReason}*\n` +
          `Symbol: ${sym}\nCMP: ₹${cmp}\nBuy: ₹${buyPrice}\nQty: ${qty}\nP&L: ${pnlPct}% (₹${pnlVal})`
        );

        if (isLive && qty > 0) {
          await executeOrder(kite, { symbol: sym, qty, type: "MARKET", side: "SELL", strategyId: def.id });
        }
      }
    } catch (e) {
      console.error(`[cash-atsl] sell check ${sym}:`, e.message);
    }
  }

  // ─── BUY CHECK (time-gated) ───────────────────────────────────────────────
  if (isBuyWindow) {
    try {
      // Gate: NIFTY 50 must be above its 6EMA
      if (cfg.emaFilter) {
        const niftyEMA = await getNiftyEMA(kite);
        const niftyCMP = await getLTP(kite, "NIFTY 50").catch(() => null);
        if (niftyEMA && niftyCMP && niftyCMP <= niftyEMA) {
          actions.push({ type: "INFO", msg: "NIFTY 50 below 6EMA — all buys skipped" });
          await putExcel(STOCKS_FILE, allRows);
          return { ok: true, actions };
        }
      }

      // Load pre-computed Nifty200 stock list from R2 (generated by fno-ohlc cron)
      const nifty200 = await getJSON("EQUITY_L_NIFTY200_symbols.json").catch(() => null);
      const universe = nifty200 || [];

      const openPositions = allRows.filter((r) => !r["Sell Date"]).length;
      const maxNew = Math.max(0, cfg.maxPositions - openPositions);
      let bought = 0;

      for (const rawSym of universe) {
        if (bought >= maxNew) break;

        const sym = rawSym.replace(".NS", "").trim();
        const alreadyHeld = allRows.some((r) => r["Symbol"] === rawSym && !r["Sell Date"]);
        if (alreadyHeld) continue;

        try {
          const candles  = await getDailyCloses(kite, sym, 30);
          if (candles.length < 8) continue;

          const ema6Vals  = candles.map((_, i) => lastEma(candles.slice(0, i + 1), 6)).filter(Boolean);
          const ema6Today = lastEma(candles, 6);

          // Previous day (second to last) OHLC is embedded in candles; need open separately
          // getDailyOHLC gives full candle — re-use it
          const { getDailyOHLC } = await import("../instruments.js");
          const ohlcCandles = await getDailyOHLC(kite, sym, 10);
          if (ohlcCandles.length < 2) continue;

          const prevDay  = ohlcCandles[ohlcCandles.length - 2];
          const prevEma6 = lastEma(candles.slice(0, -1), 6);

          // BUY conditions:
          const c1 = prevDay.open  < prevEma6;    // Prev day open < 6EMA
          const c2 = prevDay.close < prevEma6;    // Prev day close < 6EMA
          const cmp = await getLTP(kite, sym);
          if (!cmp || !ema6Today) continue;
          const c3 = cmp > ema6Today * 1.002;     // Today CMP > 6EMA × 1.002

          if (!c1 || !c2 || !c3) continue;

          const qty = Math.floor((cfg.walletBalance / cfg.maxPositions) / cmp);
          if (qty < 1) continue;

          if (isLive) {
            const riskOk = await checkRisk(def.id, { symbol: sym, qty, price: cmp });
            if (!riskOk.approved) {
              console.log(`[cash-atsl] risk rejected ${sym}: ${riskOk.reason}`);
              continue;
            }
          }

          const newRow = {
            Symbol:           rawSym,
            "Buy Price":      cmp,
            "Buy Date":       todayIST(),
            Quantity:         qty,
            "Highest Price":  cmp,
            Stop_Loss_Price:  null,
            TSL_Activated:    false,
            TSL_Buffer:       0,
            "Sell Date":      null,
            "Sell Price":     null,
            "Sell Reason":    null,
            Reason:           "6EMA Crossover",
          };

          if (isLive) {
            await executeOrder(kite, { symbol: sym, qty, type: "MARKET", side: "BUY", strategyId: def.id });
          } else {
            await executePaperTrade(def.id, { symbol: rawSym, side: "BUY", price: cmp, qty, reason: "6EMA Crossover" });
          }

          allRows.push(newRow);
          bought++;
          actions.push({ type: "BUY", sym, cmp, qty, ema6Today });

          const tag = isLive ? "" : "[PAPER] ";
          await sendTelegram(
            `📈 *${tag}BUY — 6EMA Crossover*\nSymbol: ${sym}\nCMP: ₹${cmp}\nQty: ${qty}\n6EMA: ₹${ema6Today?.toFixed(2)}`
          );
        } catch (e) {
          console.error(`[cash-atsl] buy check ${sym}:`, e.message);
        }
      }
    } catch (e) {
      console.error("[cash-atsl] buy window error:", e.message);
    }
  }

  // Save updated rows back to R2
  if (actions.some((a) => a.type === "BUY" || a.type === "SELL")) {
    await putExcel(STOCKS_FILE, allRows);
  } else {
    // Still save updated Highest Price and TSL values
    await putExcel(STOCKS_FILE, allRows);
  }

  return { ok: true, actions, positions: unsold.length };
}
