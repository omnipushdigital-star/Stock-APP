// GET /api/strategies — list all strategies with current status, metrics, and wallet
import { getAllStrategies } from "../../../lib/strategies/index";
import { getMetrics, getPaperPositions } from "../../../lib/paper-trading";
import { getWalletView } from "../../../lib/paper-wallet";
import { kvGet } from "../../../lib/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    const strategies = await getAllStrategies();

    // Attach metrics, wallet, and last-run state to each strategy
    const enriched = await Promise.all(
      strategies.map(async (s) => {
        const [metrics, lastRunState, openPositions] = await Promise.all([
          getMetrics(s.id).catch(() => null),
          kvGet(`strategy_status_${s.id}`).catch(() => null),
          getPaperPositions(s.id).catch(() => []),
        ]);

        // Compute unrealised P&L from open positions
        const unrealizedPnL = openPositions.reduce((sum, r) => {
          const bp  = parseFloat(r["Buy Price"] || 0);
          const hp  = parseFloat(r["Highest Price"] || bp);
          const qty = parseInt(r["Quantity"] || 0);
          return sum + (hp - bp) * qty;
        }, 0);

        const wallet = await getWalletView(s.id, unrealizedPnL).catch(() => null);

        return { ...s, metrics: metrics || null, wallet: wallet || null, lastRun: lastRunState || null };
      })
    );

    res.json({ ok: true, strategies: enriched });
  } catch (e) {
    console.error("GET /api/strategies error:", e);
    res.status(500).json({ error: e.message });
  }
}
