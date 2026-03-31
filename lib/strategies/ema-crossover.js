// lib/strategies/ema-crossover.js
// EMA Golden/Death Cross strategy (paper trading only initially).
// BUY: 6EMA crosses above 20EMA (golden cross on daily candles).
// SELL: 6EMA crosses below 20EMA (death cross) OR fixed 5% stop-loss.

import { sendTelegram } from "../telegram";
import { todayIST, nowIST } from "../market";
import { getDailyCloses, getLTP } from "../instruments";
import { ema, crossedAbove, crossedBelow } from "../indicators";
import { executePaperTrade, getPaperPositions, closePaperPosition } from "../paper-trading";
import { executeOrder } from "../order-executor";
import { checkRisk } from "../risk-manager";
import { getJSON } from "../r2";

// ─── Main cycle ───────────────────────────────────────────────────────────────

export async function runCycle(kite, def, { now } = {}) {
  const cfg    = def.config;
  const isLive = def.mode === "live";
  const tag    = isLive ? "" : "[PAPER] ";

  const actions = [];

  // ─── SELL CHECK: close any open paper positions ───────────────────────────
  const openPositions = await getPaperPositions(def.id);

  for (const pos of openPositions) {
    const sym = pos.symbol.replace(".NS", "").trim();
    try {
      const closes = await getDailyCloses(kite, sym, 40);
      if (closes.length < 25) continue;

      const ema6  = ema(closes, cfg.fastPeriod);
      const ema20 = ema(closes, cfg.slowPeriod);
      const cmp   = await getLTP(kite, sym);
      if (!cmp) continue;

      const buyPrice  = parseFloat(pos.buyPrice);
      const profitPct = ((cmp - buyPrice) / buyPrice) * 100;
      let   sellReason = null;

      // Death cross: 6EMA crossed below 20EMA
      if (crossedBelow(ema6, ema20)) {
        sellReason = "EMA Death Cross";
      }

      // Fixed stop-loss
      if (!sellReason && profitPct <= -cfg.stopLossPct) {
        sellReason = `Stop Loss (${profitPct.toFixed(2)}%)`;
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
      console.error(`[ema-crossover] sell ${sym}:`, e.message);
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
      const closes = await getDailyCloses(kite, sym, 40);
      if (closes.length < cfg.slowPeriod + 5) continue;

      const ema6  = ema(closes, cfg.fastPeriod);
      const ema20 = ema(closes, cfg.slowPeriod);

      // Golden cross: 6EMA just crossed above 20EMA
      if (!crossedAbove(ema6, ema20)) continue;

      const cmp = await getLTP(kite, sym);
      if (!cmp) continue;

      const qty = Math.floor((cfg.walletBalance / cfg.maxPositions) / cmp);
      if (qty < 1) continue;

      if (isLive) {
        const riskOk = await checkRisk(def.id, { symbol: sym, qty, price: cmp });
        if (!riskOk.approved) continue;
      }

      await executePaperTrade(def.id, { symbol: rawSym, side: "BUY", price: cmp, qty, reason: "EMA Golden Cross" });
      actions.push({ type: "BUY", sym, cmp, qty });

      const last6  = ema6[ema6.length - 1];
      const last20 = ema20[ema20.length - 1];
      await sendTelegram(
        `📈 *${tag}BUY — EMA Golden Cross*\nStrategy: ${def.name}\nSymbol: ${sym}\nCMP: ₹${cmp}\nQty: ${qty}\n6EMA: ₹${last6?.toFixed(2)}  20EMA: ₹${last20?.toFixed(2)}`
      );

      if (isLive) {
        await executeOrder(kite, { symbol: sym, qty, type: "MARKET", side: "BUY", strategyId: def.id });
      }
    } catch (e) {
      console.error(`[ema-crossover] buy ${sym}:`, e.message);
    }
  }

  return { ok: true, actions };
}
