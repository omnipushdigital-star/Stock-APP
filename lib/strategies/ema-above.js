// lib/strategies/ema-above.js
// "Above 6EMA" paper trading strategy.
//
// BUY condition:
//   CMP > 6EMA  (only condition)
//
// SELL conditions (first triggered wins):
//   1. CMP drops below 6EMA  → "EMA Breakdown"
//   2. Adaptive TSL breach (4-tier: 0.5%/0.4%/0.3%/0.2%, activates at 1% profit)
//   3. Max hold 10 days
//
// Universe: Nifty 200 (hardcoded)
// Mode: paper only

import { sendTelegram } from "../telegram";
import { nowIST } from "../market";
import { getDailyCloses, getLTP } from "../instruments";
import { lastEma } from "../indicators";
import { executePaperTrade, getPaperPositions, closePaperPosition, updatePaperPositionHigh } from "../paper-trading";
import { NIFTY200_SYMBOLS } from "../nifty200";

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

  // ─── SELL CHECK ────────────────────────────────────────────────────────────
  const openPositions = await getPaperPositions(def.id);

  // Batch LTP for all open positions in one call
  const openSyms = openPositions.map(p => p.symbol.replace(".NS", "").trim()).filter(Boolean);
  const ltpMap   = openSyms.length ? await getLTP(kite, openSyms) : {};

  for (const pos of openPositions) {
    const sym = pos.symbol.replace(".NS", "").trim();
    const cmp = ltpMap[sym.toUpperCase()] ?? null;
    if (!cmp) continue;

    try {
      await sleep(350);
      const closes = await getDailyCloses(kite, sym, 20);
      if (closes.length < 7) continue;

      const ema6 = lastEma(closes, 6);
      if (!ema6) continue;

      const buyPrice  = parseFloat(pos.buyPrice);
      const highPrice = Math.max(parseFloat(pos.highestPrice || buyPrice), cmp);
      const profitPct = ((cmp - buyPrice) / buyPrice) * 100;

      await updatePaperPositionHigh(def.id, pos.symbol, highPrice);

      let sellReason = null;

      // 1. EMA Breakdown
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

  const maxNew   = cfg.maxPositions - currentOpen.length;
  const heldSyms = new Set(currentOpen.map(p => p.symbol.replace(".NS", "").trim().toUpperCase()));
  // Limit scan to avoid Vercel timeout (350ms/symbol × N = budget). Default 55 symbols ≈ 20s max.
  const maxScan  = cfg.maxScan || 55;
  const candidates = NIFTY200_SYMBOLS.filter(s => !heldSyms.has(s.toUpperCase())).slice(0, maxScan);

  // Batch LTP for all candidates in one call
  let ltpBatch = {};
  let ltpError = null;
  try {
    ltpBatch = candidates.length ? await getLTP(kite, candidates) : {};
  } catch (e) {
    ltpError = e.message;
    console.error("[ema-above] getLTP batch failed:", e.message);
  }

  const ltpCount  = Object.values(ltpBatch).filter(Boolean).length;
  const diag      = { scanned: candidates.length, ltpFetched: ltpCount, ltpError, noLtp: 0, noCloses: 0, belowEma: 0, closesError: null };

  // Probe one symbol — call getHistoricalData directly so errors aren't swallowed
  if (candidates.length) {
    try {
      const { getToken } = await import("../instruments.js");
      const sym0 = candidates[0];
      const tok = await getToken(kite, sym0);
      if (!tok) {
        diag.closesError = `No token for ${sym0} — instruments map empty in KV`;
      } else {
        const now2 = new Date();
        const from2 = new Date(now2); from2.setDate(from2.getDate() - 23);
        const toStr2   = now2.toISOString().split("T")[0];
        const fromStr2 = from2.toISOString().split("T")[0];
        try {
          const raw = await kite.getHistoricalData(tok, "day", fromStr2, toStr2, false, false);
          const len = Array.isArray(raw) ? raw.length : JSON.stringify(raw).slice(0, 80);
          diag.closesError = `Direct getHistoricalData(${sym0}, token:${tok}): returned ${JSON.stringify(len)} rows`;
        } catch (he) {
          diag.closesError = `getHistoricalData threw: ${he.message}`;
        }
      }
    } catch (e) {
      diag.closesError = `Probe error: ${e.message}`;
    }
  }

  let bought = 0;
  for (const sym of candidates) {
    if (bought >= maxNew) break;

    try {
      const cmp = ltpBatch[sym.toUpperCase()] ?? null;
      if (!cmp) { diag.noLtp++; continue; }

      await sleep(350);
      const closes = await getDailyCloses(kite, sym, 15);
      if (closes.length < 7) { diag.noCloses++; continue; }

      const ema6 = lastEma(closes, 6);
      if (!ema6) { diag.noCloses++; continue; }

      // Single buy condition: CMP > 6EMA
      if (cmp <= ema6) { diag.belowEma++; continue; }

      const qty = Math.floor((cfg.walletBalance / cfg.maxPositions) / cmp);
      if (qty < 1) continue;

      await executePaperTrade(def.id, {
        symbol: sym, side: "BUY", price: cmp, qty,
        reason: `Above 6EMA (EMA ₹${ema6.toFixed(2)})`,
      });

      bought++;
      actions.push({ type: "BUY", sym, cmp, qty, ema6: ema6.toFixed(2) });

      await sendTelegram(
        `📈 *${tag}BUY — Above 6EMA*\nSymbol: ${sym}\nCMP: ₹${cmp}\nQty: ${qty}\n6EMA: ₹${ema6.toFixed(2)}`
      );
    } catch (e) {
      console.error(`[ema-above] buy ${sym}:`, e.message);
    }
  }

  return { ok: true, actions, openPositions: currentOpen.length + bought, diag };
}
