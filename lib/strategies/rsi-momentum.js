// lib/strategies/rsi-momentum.js
// RSI Momentum strategy (paper trading only initially).
// BUY: RSI crosses above 50 from below AND price is above 20EMA.
// SELL: RSI drops below 40 OR trailing stop-loss at 3%.

import { sendTelegram } from "../telegram";
import { todayIST, nowIST } from "../market";
import { getDailyCloses, getLTP } from "../instruments";
import { ema, rsi, lastEma, lastRsi } from "../indicators";
import { executePaperTrade, getPaperPositions, closePaperPosition, updatePaperPositionHigh } from "../paper-trading";
import { executeOrder } from "../order-executor";
import { checkRisk } from "../risk-manager";
import { getJSON } from "../r2";

export async function runCycle(kite, def, { now } = {}) {
  const cfg    = def.config;
  const isLive = def.mode === "live";
  const tag    = isLive ? "" : "[PAPER] ";
  const actions = [];

  // ─── SELL CHECK ───────────────────────────────────────────────────────────
  const openPositions = await getPaperPositions(def.id);

  for (const pos of openPositions) {
    const sym = pos.symbol.replace(".NS", "").trim();
    try {
      const closes  = await getDailyCloses(kite, sym, 50);
      const cmp     = await getLTP(kite, sym);
      if (!cmp || closes.length < cfg.rsiPeriod + 5) continue;

      const rsiNow     = lastRsi(closes, cfg.rsiPeriod);
      const buyPrice   = parseFloat(pos.buyPrice);
      const highPrice  = Math.max(parseFloat(pos.highestPrice || buyPrice), cmp);
      const profitPct  = ((cmp - buyPrice) / buyPrice) * 100;

      await updatePaperPositionHigh(def.id, pos.symbol, highPrice);

      const trailStop = parseFloat((highPrice * (1 - cfg.trailPct / 100)).toFixed(2));
      let   sellReason = null;

      if (rsiNow !== null && rsiNow < cfg.rsiExit) {
        sellReason = `RSI Dropped Below ${cfg.rsiExit} (${rsiNow.toFixed(1)})`;
      }

      if (!sellReason && cmp < trailStop) {
        sellReason = `Trailing Stop Hit (${profitPct.toFixed(2)}%)`;
      }

      if (sellReason) {
        await closePaperPosition(def.id, pos.symbol, cmp, sellReason);
        actions.push({ type: "SELL", sym, cmp, reason: sellReason, pnlPct: profitPct.toFixed(2) });
        await sendTelegram(
          `📉 *${tag}SELL — ${sellReason}*\nStrategy: ${def.name}\nSymbol: ${sym}\nCMP: ₹${cmp}\nBuy: ₹${buyPrice}\nP&L: ${profitPct.toFixed(2)}%`
        );
        if (isLive && pos.qty > 0) {
          await executeOrder(kite, { symbol: sym, qty: pos.qty, type: "MARKET", side: "SELL", strategyId: def.id });
        }
      }
    } catch (e) {
      console.error(`[rsi-momentum] sell ${sym}:`, e.message);
    }
  }

  // ─── BUY CHECK ────────────────────────────────────────────────────────────
  const currentOpen = await getPaperPositions(def.id);
  if (currentOpen.length >= cfg.maxPositions) {
    return { ok: true, actions, skippedBuys: "max positions reached" };
  }

  const nifty200 = await getJSON("EQUITY_L_NIFTY200_symbols.json").catch(() => null) || [];

  for (const rawSym of nifty200) {
    if (currentOpen.length + actions.filter((a) => a.type === "BUY").length >= cfg.maxPositions) break;

    const sym = rawSym.replace(".NS", "").trim();
    const alreadyHeld = currentOpen.some((p) => p.symbol === rawSym);
    if (alreadyHeld) continue;

    try {
      const closes = await getDailyCloses(kite, sym, 50);
      if (closes.length < cfg.rsiPeriod + 5) continue;

      const rsiValues  = rsi(closes, cfg.rsiPeriod);
      const ema20Vals  = ema(closes, cfg.emaPeriod);

      const rsiCurr = rsiValues[rsiValues.length - 1];
      const rsiPrev = rsiValues[rsiValues.length - 2];
      const ema20   = ema20Vals[ema20Vals.length - 1];

      if (rsiCurr == null || rsiPrev == null || ema20 == null) continue;

      // RSI crossed above 50 from below
      const rsiCrossedAbove50 = rsiPrev < cfg.rsiEntry && rsiCurr >= cfg.rsiEntry;
      if (!rsiCrossedAbove50) continue;

      const cmp = await getLTP(kite, sym);
      if (!cmp) continue;

      // Price must be above 20EMA
      if (cmp <= ema20) continue;

      const qty = Math.floor((cfg.walletBalance / cfg.maxPositions) / cmp);
      if (qty < 1) continue;

      if (isLive) {
        const riskOk = await checkRisk(def.id, { symbol: sym, qty, price: cmp });
        if (!riskOk.approved) continue;
      }

      await executePaperTrade(def.id, {
        symbol: rawSym, side: "BUY", price: cmp, qty,
        reason: `RSI Crossed Above ${cfg.rsiEntry} (${rsiCurr.toFixed(1)})`,
      });
      actions.push({ type: "BUY", sym, cmp, qty, rsi: rsiCurr.toFixed(1) });

      await sendTelegram(
        `📈 *${tag}BUY — RSI Momentum*\nStrategy: ${def.name}\nSymbol: ${sym}\nCMP: ₹${cmp}\nQty: ${qty}\nRSI: ${rsiCurr.toFixed(1)}  20EMA: ₹${ema20.toFixed(2)}`
      );

      if (isLive) {
        await executeOrder(kite, { symbol: sym, qty, type: "MARKET", side: "BUY", strategyId: def.id });
      }
    } catch (e) {
      console.error(`[rsi-momentum] buy ${sym}:`, e.message);
    }
  }

  return { ok: true, actions };
}
