// pages/api/portfolio/zerodha-portfolio.js
// GET → live holdings (CNC delivery) + net positions from Zerodha Kite API
// No R2 involved — pure live data from the broker.

import { getKite } from "../../../lib/kite";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    const kite = await getKite();

    // Fetch in parallel
    const [holdingsRaw, positionsRaw] = await Promise.all([
      kite.getHoldings(),
      kite.getPositions(),
    ]);

    // ── CNC / Delivery Holdings ───────────────────────────────────────────────
    const holdings = (holdingsRaw || []).map((h) => {
      const avgPrice   = parseFloat(h.average_price || 0);
      const lastPrice  = parseFloat(h.last_price     || 0);
      const qty        = parseInt(h.quantity          || 0);
      const t1Qty      = parseInt(h.t1_quantity       || 0);  // pending settlement
      const pnlVal     = parseFloat(((lastPrice - avgPrice) * qty).toFixed(2));
      const pnlPct     = avgPrice > 0 ? parseFloat(((lastPrice - avgPrice) / avgPrice * 100).toFixed(2)) : 0;
      const currentVal = parseFloat((lastPrice * qty).toFixed(2));
      const invested   = parseFloat((avgPrice * qty).toFixed(2));

      return {
        symbol:       h.tradingsymbol,
        exchange:     h.exchange,
        isin:         h.isin,
        qty,
        t1Qty,           // shares pending T+1 settlement
        avgPrice,
        lastPrice,
        pnlVal,
        pnlPct,
        currentVal,
        invested,
        product:      "CNC",
        dayChange:    parseFloat(h.day_change         || 0),
        dayChangePct: parseFloat(h.day_change_percentage || 0),
        closePrice:   parseFloat(h.close_price        || 0),
      };
    });

    // ── Net Positions (intraday + short-term) ─────────────────────────────────
    const netPositions = (positionsRaw?.net || [])
      .filter((p) => p.quantity !== 0)   // only positions with open qty
      .map((p) => {
        const avgPrice  = parseFloat(p.average_price || 0);
        const lastPrice = parseFloat(p.last_price    || 0);
        const qty       = parseInt(p.quantity         || 0);
        const pnlVal    = parseFloat(p.pnl            || 0);
        const pnlPct    = avgPrice > 0 ? parseFloat(((lastPrice - avgPrice) / avgPrice * 100).toFixed(2)) : 0;

        return {
          symbol:     p.tradingsymbol,
          exchange:   p.exchange,
          qty,
          buyQty:     parseInt(p.buy_quantity  || 0),
          sellQty:    parseInt(p.sell_quantity || 0),
          avgPrice,
          lastPrice,
          pnlVal,
          pnlPct,
          product:    p.product,           // CNC / MIS / NRML
          overnight:  p.overnight_quantity,
          value:      parseFloat(p.value || 0),
        };
      });

    // ── Day P&L summary ───────────────────────────────────────────────────────
    const dayPositions = (positionsRaw?.day || []).map((p) => ({
      symbol:   p.tradingsymbol,
      product:  p.product,
      qty:      parseInt(p.quantity || 0),
      pnl:      parseFloat(p.pnl   || 0),
    }));

    // Portfolio summary totals
    const holdingsTotalInvested   = holdings.reduce((s, h) => s + h.invested,   0);
    const holdingsTotalCurrentVal = holdings.reduce((s, h) => s + h.currentVal, 0);
    const holdingsTotalPnL        = holdings.reduce((s, h) => s + h.pnlVal,     0);
    const holdingsTotalPnLPct     = holdingsTotalInvested > 0
      ? parseFloat(((holdingsTotalPnL / holdingsTotalInvested) * 100).toFixed(2))
      : 0;
    const netPnL = netPositions.reduce((s, p) => s + p.pnlVal, 0);
    const dayPnL = dayPositions.reduce((s, p) => s + p.pnl,   0);

    res.json({
      ok: true,
      holdings,
      netPositions,
      summary: {
        holdingsCount:      holdings.length,
        holdingsInvested:   parseFloat(holdingsTotalInvested.toFixed(2)),
        holdingsCurrentVal: parseFloat(holdingsTotalCurrentVal.toFixed(2)),
        holdingsPnL:        parseFloat(holdingsTotalPnL.toFixed(2)),
        holdingsPnLPct:     holdingsTotalPnLPct,
        openNetPositions:   netPositions.length,
        netPositionsPnL:    parseFloat(netPnL.toFixed(2)),
        dayPnL:             parseFloat(dayPnL.toFixed(2)),
        totalCurrentValue:  parseFloat((holdingsTotalCurrentVal + netPositions.reduce((s, p) => s + p.value, 0)).toFixed(2)),
      },
    });
  } catch (e) {
    if (e.message?.includes("NO_TOKEN") || e.message?.includes("KITE_TOKEN_EXPIRED")) {
      return res.json({ ok: false, holdings: [], netPositions: [], summary: null, error: "Kite token missing — please login" });
    }
    res.status(500).json({ error: e.message });
  }
}
