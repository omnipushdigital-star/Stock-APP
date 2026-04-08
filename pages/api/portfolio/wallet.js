// pages/api/portfolio/wallet.js
// GET  → Zerodha live margin/funds + today's realised P&L from Kite API
// POST { action: "reset", strategyId, capital? } → reset a paper wallet
// POST { action: "set_capital", strategyId, capital } → update paper wallet starting capital

import { getKite } from "../../../lib/kite";
import { resetWallet, setStartingCapital, getWallet } from "../../../lib/paper-wallet";
import { getAllStrategies } from "../../../lib/strategies/index";
import { getPaperPositions } from "../../../lib/paper-trading";
import { getWalletView } from "../../../lib/paper-wallet";
import { putExcel } from "../../../lib/r2";

export default async function handler(req, res) {
  // ── GET — fetch Zerodha funds + all paper wallets ──────────────────────────
  if (req.method === "GET") {
    const result = { zerodha: null, paper: {}, error: null };

    // Zerodha live funds
    try {
      const kite    = await getKite();
      const margins = await kite.getMargins();
      const eq      = margins?.equity || {};

      result.zerodha = {
        // Available (usable) cash
        availableCash:   parseFloat(eq.available?.cash              ?? 0),
        // Live cash balance (post-collateral)
        liveCash:        parseFloat(eq.available?.live_balance       ?? 0),
        // Collateral / stock holding value
        collateral:      parseFloat(eq.available?.collateral         ?? 0),
        // Net: margin left including collateral
        net:             parseFloat(eq.net                           ?? 0),
        // Total utilized
        utilised:        parseFloat(eq.utilised?.debits              ?? 0),
        // Today's P&L across all positions
        todayPnL:        null, // computed below from positions
        currency:        "INR",
      };

      // Fetch today P&L from live positions
      try {
        const positions = await kite.getPositions();
        const todayPnL  = (positions?.day || []).reduce((sum, p) => sum + (p.pnl || 0), 0);
        const netPnL    = (positions?.net  || []).reduce((sum, p) => sum + (p.pnl || 0), 0);
        result.zerodha.todayPnL = parseFloat(todayPnL.toFixed(2));
        result.zerodha.netPnL   = parseFloat(netPnL.toFixed(2));
      } catch {}
    } catch (e) {
      result.error = e.message;
    }

    // All paper strategy wallets
    try {
      const strategies = await getAllStrategies();
      await Promise.all(
        strategies.map(async (s) => {
          try {
            const openPositions = await getPaperPositions(s.id);
            // Rough unrealised P&L from open positions (highest price as proxy)
            const unrealizedPnL = openPositions.reduce((sum, r) => {
              const bp  = parseFloat(r["Buy Price"] || 0);
              const hp  = parseFloat(r["Highest Price"] || bp);
              const qty = parseInt(r["Quantity"] || 0);
              return sum + (hp - bp) * qty;
            }, 0);
            result.paper[s.id] = await getWalletView(s.id, unrealizedPnL);
          } catch (e) {
            result.paper[s.id] = { error: e.message };
          }
        })
      );
    } catch {}

    return res.json({ ok: true, ...result });
  }

  // ── POST — paper wallet mutations ──────────────────────────────────────────
  if (req.method === "POST") {
    const { action, strategyId, capital } = req.body || {};

    if (!strategyId) return res.status(400).json({ error: "strategyId required" });

    try {
      if (action === "reset") {
        const cap    = capital ? parseFloat(capital) : undefined;
        const wallet = await resetWallet(strategyId, cap);
        // Clear open positions and trade history from R2
        await putExcel(`paper_positions_${strategyId}.xlsx`, []);
        await putExcel(`paper_trades_${strategyId}.xlsx`, []);
        return res.json({ ok: true, action: "reset", wallet });
      }

      if (action === "set_capital") {
        if (!capital || isNaN(parseFloat(capital))) {
          return res.status(400).json({ error: "capital must be a number" });
        }
        const wallet = await setStartingCapital(strategyId, parseFloat(capital));
        return res.json({ ok: true, action: "set_capital", wallet });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).end();
}
