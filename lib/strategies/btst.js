// lib/strategies/btst.js
// Buy Today Sell Tomorrow (BTST) strategy (paper trading only initially).
// BUY: Last 30 min of market (14:45–15:15), stock up >1.5% on day.
// SELL: Next trading day, market open + 15 minutes.

import { sendTelegram } from "../telegram";
import { todayIST, nowIST } from "../market";
import { getTodayOHLC, getLTP } from "../instruments";
import { executePaperTrade, getPaperPositions, closePaperPosition } from "../paper-trading";
import { executeOrder } from "../order-executor";
import { checkRisk } from "../risk-manager";
import { getJSON } from "../r2";

// ─── Time helpers ─────────────────────────────────────────────────────────────

function isInBuyWindow(now, cfg) {
  const mins = now.getHours() * 60 + now.getMinutes();
  const startMins = cfg.buyWindowStart.hour * 60 + cfg.buyWindowStart.minute;
  const endMins   = cfg.buyWindowEnd.hour   * 60 + cfg.buyWindowEnd.minute;
  return mins >= startMins && mins <= endMins;
}

function isInSellWindow(now, cfg) {
  // Sell in the first `sellMinutesAfterOpen` minutes after 9:15
  const openMins = 9 * 60 + 15;
  const nowMins  = now.getHours() * 60 + now.getMinutes();
  return nowMins >= openMins && nowMins <= openMins + cfg.sellMinutesAfterOpen;
}

// ─── Main cycle ───────────────────────────────────────────────────────────────

export async function runCycle(kite, def, { now, forceBuy = false, forceSell = false } = {}) {
  const cfg    = def.config;
  const isLive = def.mode === "live";
  const tag    = isLive ? "" : "[PAPER] ";
  const ist    = now || nowIST();
  const today  = todayIST();
  const actions = [];

  // ─── SELL CHECK: next morning, 15 min after open ──────────────────────────
  if (forceSell || isInSellWindow(ist, cfg)) {
    const openPositions = await getPaperPositions(def.id);
    // BTST positions are those bought on a previous day
    const toSell = openPositions.filter((p) => p.buyDate < today);

    for (const pos of toSell) {
      const sym = pos.symbol.replace(".NS", "").trim();
      try {
        const cmp = await getLTP(kite, sym);
        if (!cmp) continue;

        const buyPrice  = parseFloat(pos.buyPrice);
        const profitPct = ((cmp - buyPrice) / buyPrice) * 100;

        await closePaperPosition(def.id, pos.symbol, cmp, "BTST Next-Day Open");
        actions.push({ type: "SELL", sym, cmp, reason: "BTST Next-Day Open", pnlPct: profitPct.toFixed(2) });

        await sendTelegram(
          `📉 *${tag}SELL — BTST Next-Day*\nStrategy: ${def.name}\nSymbol: ${sym}\nCMP: ₹${cmp}\nBuy: ₹${buyPrice}\nP&L: ${profitPct.toFixed(2)}%`
        );

        if (isLive && pos.qty > 0) {
          await executeOrder(kite, { symbol: sym, qty: pos.qty, type: "MARKET", side: "SELL", strategyId: def.id });
        }
      } catch (e) {
        console.error(`[btst] sell ${sym}:`, e.message);
      }
    }
  }

  // ─── BUY CHECK: last 30 min of market ────────────────────────────────────
  if (forceBuy || isInBuyWindow(ist, cfg)) {
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
        const ohlc = await getTodayOHLC(kite, sym);
        if (!ohlc) continue;

        const cmp       = await getLTP(kite, sym);
        if (!cmp) continue;

        const dayGainPct = ((cmp - ohlc.open) / ohlc.open) * 100;
        if (dayGainPct < cfg.minDayGainPct) continue;

        const qty = Math.floor((cfg.walletBalance / cfg.maxPositions) / cmp);
        if (qty < 1) continue;

        if (isLive) {
          const riskOk = await checkRisk(def.id, { symbol: sym, qty, price: cmp });
          if (!riskOk.approved) continue;
        }

        await executePaperTrade(def.id, {
          symbol: rawSym, side: "BUY", price: cmp, qty,
          reason: `BTST — Day gain ${dayGainPct.toFixed(2)}%`,
        });
        actions.push({ type: "BUY", sym, cmp, qty, dayGainPct: dayGainPct.toFixed(2) });

        await sendTelegram(
          `📈 *${tag}BUY — BTST Entry*\nStrategy: ${def.name}\nSymbol: ${sym}\nCMP: ₹${cmp}\nQty: ${qty}\nDay gain: +${dayGainPct.toFixed(2)}%`
        );

        if (isLive) {
          await executeOrder(kite, { symbol: sym, qty, type: "MARKET", side: "BUY", strategyId: def.id });
        }
      } catch (e) {
        console.error(`[btst] buy ${sym}:`, e.message);
      }
    }
  }

  return { ok: true, actions };
}
