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
import { getLTP, getNSETokenMap } from "../instruments";
import { lastEma } from "../indicators";
import { executePaperTrade, getPaperPositions, closePaperPosition, updatePaperPositionHigh } from "../paper-trading";
import { NIFTY200_SYMBOLS } from "../nifty200";
import { nowIST } from "../market";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function adaptiveTSL(profitPct) {
  if (profitPct < 2)  return 0.005; // 0.5%
  if (profitPct < 5)  return 0.004; // 0.4%
  if (profitPct < 10) return 0.003; // 0.3%
  return 0.002;                      // 0.2%
}

/**
 * Fetch daily closes directly using a pre-resolved token.
 * Avoids per-symbol KV lookups that getDailyCloses() does internally.
 */
async function fetchCloses(kite, token, days = 15) {
  const now  = nowIST();
  const from = new Date(now);
  from.setDate(from.getDate() - Math.ceil(days * 1.5));
  const toStr   = now.toISOString().split("T")[0];
  const fromStr = from.toISOString().split("T")[0];
  const data = await kite.getHistoricalData(token, "day", fromStr, toStr, false, false);
  if (!Array.isArray(data) || data.length === 0) return [];
  return data.slice(-days).map((c) => (Array.isArray(c) ? c[4] : c.close));
}

export async function runCycle(kite, def, _opts = {}) {
  const cfg     = def.config;
  const tag     = "[PAPER] ";
  const actions = [];

  // Fetch token map ONCE (2 KV calls total, not 2 per symbol)
  const tokenMap = await getNSETokenMap(kite);

  // ─── SELL CHECK ────────────────────────────────────────────────────────────
  const openPositions = await getPaperPositions(def.id);

  const openSyms = openPositions.map(p => (p["Symbol"] || "").replace(".NS", "").trim()).filter(Boolean);
  const ltpMap   = openSyms.length ? await getLTP(kite, openSyms) : {};

  for (const pos of openPositions) {
    const sym   = (pos["Symbol"] || "").replace(".NS", "").trim();
    const cmp   = ltpMap[sym.toUpperCase()] ?? null;
    const token = tokenMap[sym.toUpperCase()] ?? null;
    if (!sym || !cmp || !token) continue;

    try {
      await sleep(350);
      const closes = await fetchCloses(kite, token, 20);
      if (closes.length < 7) continue;

      const ema6 = lastEma(closes, 6);
      if (!ema6) continue;

      const buyPrice  = parseFloat(pos["Buy Price"]);
      const highPrice = Math.max(parseFloat(pos["Highest Price"] || buyPrice), cmp);
      const profitPct = ((cmp - buyPrice) / buyPrice) * 100;

      await updatePaperPositionHigh(def.id, pos["Symbol"], highPrice);

      let sellReason = null;

      if (cmp < ema6) {
        sellReason = `EMA Breakdown (CMP ₹${cmp.toFixed(2)} < 6EMA ₹${ema6.toFixed(2)})`;
      }

      if (!sellReason && profitPct >= 1.0) {
        const buffer   = adaptiveTSL(profitPct);
        const tslPrice = parseFloat((highPrice * (1 - buffer)).toFixed(2));
        const minStop  = parseFloat((buyPrice * 1.01).toFixed(2));
        const stopLoss = Math.max(tslPrice, minStop);
        if (cmp < stopLoss) {
          sellReason = `Trailing Stop Hit (stop ₹${stopLoss.toFixed(2)}, P&L ${profitPct.toFixed(2)}%)`;
        }
      }

      if (!sellReason && pos["Buy Date"]) {
        const days = Math.floor((Date.now() - new Date(pos["Buy Date"])) / 86400000);
        if (days > cfg.maxHoldDays) sellReason = `Max Hold ${cfg.maxHoldDays} Days`;
      }

      if (sellReason) {
        await closePaperPosition(def.id, pos["Symbol"], cmp, sellReason);
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
  const heldSyms = new Set(currentOpen.map(p => (p["Symbol"] || "").replace(".NS", "").trim().toUpperCase()));
  const maxScan  = cfg.maxScan || 55;
  const candidates = NIFTY200_SYMBOLS.filter(s => !heldSyms.has(s.toUpperCase())).slice(0, maxScan);

  // Batch LTP for all candidates in one API call
  let ltpBatch = {};
  let ltpError = null;
  try {
    ltpBatch = candidates.length ? await getLTP(kite, candidates) : {};
  } catch (e) {
    ltpError = e.message;
  }

  const ltpCount = Object.values(ltpBatch).filter(Boolean).length;
  const diag     = { scanned: candidates.length, ltpFetched: ltpCount, ltpError, noToken: 0, noLtp: 0, noCloses: 0, belowEma: 0 };

  let bought = 0;
  for (const sym of candidates) {
    if (bought >= maxNew) break;

    try {
      const cmp   = ltpBatch[sym.toUpperCase()] ?? null;
      const token = tokenMap[sym.toUpperCase()] ?? null;

      if (!cmp)   { diag.noLtp++;   continue; }
      if (!token) { diag.noToken++; continue; }

      await sleep(350);
      const closes = await fetchCloses(kite, token, 15);
      if (closes.length < 7) { diag.noCloses++; continue; }

      const ema6 = lastEma(closes, 6);
      if (!ema6) { diag.noCloses++; continue; }

      if (cmp <= ema6) { diag.belowEma++; continue; }

      const capPerStock = cfg.maxCapitalPerStock || 10000;
      const qty = Math.floor(capPerStock / cmp);
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
