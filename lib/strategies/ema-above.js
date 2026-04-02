// lib/strategies/ema-above.js
// "Above 6EMA" paper trading strategy.
//
// BUY conditions (all must be true):
//   1. CMP > 6EMA  (stock is in an uptrend)
//   2. Previous day close > previous day 6EMA  (trend confirmed for >=1 day)
//   3. NIFTY 50 > its own 6EMA  (broad market filter — no buys in bear market)
//   4. CMP > previous day close  (positive momentum today)
//
// SELL conditions (first triggered wins):
//   1. CMP drops below 6EMA  → "EMA Breakdown"
//   2. Adaptive TSL breach (same 4-tier as Cash ATSL)
//   3. Max hold 10 days
//
// Universe: Nifty 200
// Mode: paper only

import { sendTelegram } from "../telegram";
import { todayIST, nowIST } from "../market";
import { getDailyOHLC, getDailyCloses, getLTP } from "../instruments";
import { lastEma } from "../indicators";
import { executePaperTrade, getPaperPositions, closePaperPosition, updatePaperPositionHigh } from "../paper-trading";
import { getJSON } from "../r2";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function adaptiveTSL(profitPct) {
  if (profitPct < 2)  return 0.005; // 0.5%
  if (profitPct < 5)  return 0.004; // 0.4%
  if (profitPct < 10) return 0.003; // 0.3%
  return 0.002;                      // 0.2%
}

export async function runCycle(kite, def, { now, forceBuy = false, forceSell = false } = {}) {
  const cfg     = def.config;
  const tag     = "[PAPER] ";
  const actions = [];
  const ist     = now || nowIST();

  // ─── SELL CHECK ────────────────────────────────────────────────────────────
  const openPositions = await getPaperPositions(def.id);

  // Batch LTP for all open positions
  const openSyms   = openPositions.map(p => p.symbol.replace(".NS","").trim()).filter(Boolean);
  const ltpMap     = openSyms.length ? await getLTP(kite, openSyms) : {};

  for (const pos of openPositions) {
    const sym      = pos.symbol.replace(".NS", "").trim();
    const cmp      = ltpMap[sym.toUpperCase()] ?? null;
    if (!cmp) continue;

    try {
      await sleep(350); // respect 3 req/sec historical limit
      const closes     = await getDailyCloses(kite, sym, 20);
      if (closes.length < 7) continue;

      const ema6       = lastEma(closes, 6);
      if (!ema6) continue;

      const buyPrice   = parseFloat(pos.buyPrice);
      const highPrice  = Math.max(parseFloat(pos.highestPrice || buyPrice), cmp);
      const profitPct  = ((cmp - buyPrice) / buyPrice) * 100;

      await updatePaperPositionHigh(def.id, pos.symbol, highPrice);

      let sellReason = null;

      // 1. EMA Breakdown — CMP crossed below 6EMA
      if (cmp < ema6) {
        sellReason = `EMA Breakdown (CMP ₹${cmp.toFixed(2)} < 6EMA ₹${ema6.toFixed(2)})`;
      }

      // 2. Adaptive TSL (activates after 1% profit)
      if (!sellReason && profitPct >= 1.0) {
        const buffer   = adaptiveTSL(profitPct);
        const tslPrice = parseFloat((highPrice * (1 - buffer)).toFixed(2));
        const minStop  = parseFloat((buyPrice * 1.01).toFixed(2));
        const stopLoss = Math.max(tslPrice, minStop);
        if (cmp < stopLoss) {
          sellReason = `Trailing Stop Hit (stop ₹${stopLoss.toFixed(2)}, P&L ${profitPct.toFixed(2)}%)`;
        }
      }

      // 3. Max hold 10 days
      if (!sellReason && pos.buyDate) {
        const days = Math.floor((Date.now() - new Date(pos.buyDate)) / 86400000);
        if (days > cfg.maxHoldDays) sellReason = `Max Hold ${cfg.maxHoldDays} Days`;
      }

      if (sellReason) {
        await closePaperPosition(def.id, pos.symbol, cmp, sellReason);
        actions.push({ type: "SELL", sym, cmp, reason: sellReason, pnlPct: profitPct.toFixed(2) });
        await sendTelegram(
          `📉 *${tag}SELL — Above 6EMA*\nSymbol: ${sym}\nCMP: ₹${cmp}\nBuy: ₹${buyPrice}\nReason: ${sellReason}\nP&L: ${profitPct.toFixed(2)}%`
        );
      }
    } catch (e) {
      console.error(`[ema-above] sell ${sym}:`, e.message);
    }
  }

  // ─── BUY CHECK ─────────────────────────────────────────────────────────────
  const currentOpen = await getPaperPositions(def.id);
  if (currentOpen.length >= cfg.maxPositions) {
    return { ok: true, actions, skippedBuys: "max positions reached" };
  }

  // NIFTY 50 filter — skip all buys if market is below 6EMA
  try {
    await sleep(350);
    const niftyCloses = await getDailyCloses(kite, "NIFTY 50", 20);
    const niftyEma6   = lastEma(niftyCloses, 6);
    const niftyLtp    = await getLTP(kite, "NIFTY 50");
    if (niftyEma6 && niftyLtp && niftyLtp <= niftyEma6) {
      return { ok: true, actions, skippedBuys: "NIFTY 50 below 6EMA — market filter" };
    }
  } catch (e) {
    console.error("[ema-above] NIFTY filter:", e.message);
  }

  const nifty200 = await getJSON("EQUITY_L_NIFTY200_symbols.json").catch(() => null) || [];
  let bought     = 0;
  const maxNew   = cfg.maxPositions - currentOpen.length;

  for (const rawSym of nifty200) {
    if (bought >= maxNew) break;

    const sym        = rawSym.replace(".NS", "").trim();
    const alreadyHeld = currentOpen.some((p) => p.symbol === rawSym);
    if (alreadyHeld) continue;

    try {
      await sleep(350); // 3 req/sec historical limit
      const ohlcCandles = await getDailyOHLC(kite, sym, 15);
      if (ohlcCandles.length < 8) continue;

      const closes      = ohlcCandles.map(c => c.close);
      const ema6Today   = lastEma(closes, 6);
      const prevCloses  = closes.slice(0, -1);
      const ema6Prev    = lastEma(prevCloses, 6);

      if (!ema6Today || !ema6Prev) continue;

      const prevCandle  = ohlcCandles[ohlcCandles.length - 2];
      const todayCandle = ohlcCandles[ohlcCandles.length - 1];

      // BUY conditions
      const c1 = prevCandle.close > ema6Prev;            // yesterday closed above 6EMA
      const c2 = todayCandle.close > ema6Today;          // today closed above 6EMA
      const c3 = todayCandle.close > prevCandle.close;   // positive day (today > yesterday)

      if (!c1 || !c2 || !c3) continue;

      // Get live CMP to verify still above EMA
      const cmp = await getLTP(kite, sym);
      if (!cmp || cmp <= ema6Today) continue;

      const qty = Math.floor((cfg.walletBalance / cfg.maxPositions) / cmp);
      if (qty < 1) continue;

      await executePaperTrade(def.id, {
        symbol: rawSym, side: "BUY", price: cmp, qty,
        reason: `Above 6EMA (EMA ₹${ema6Today.toFixed(2)})`,
      });

      bought++;
      actions.push({ type: "BUY", sym, cmp, qty, ema6: ema6Today.toFixed(2) });

      await sendTelegram(
        `📈 *${tag}BUY — Above 6EMA*\nSymbol: ${sym}\nCMP: ₹${cmp}\nQty: ${qty}\n6EMA: ₹${ema6Today.toFixed(2)}\nPrev Close: ₹${prevCandle.close}`
      );
    } catch (e) {
      console.error(`[ema-above] buy ${sym}:`, e.message);
    }
  }

  return { ok: true, actions, openPositions: currentOpen.length + bought };
}
