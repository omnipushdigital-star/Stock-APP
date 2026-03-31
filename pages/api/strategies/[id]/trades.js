// GET /api/strategies/[id]/trades — get paper trade history + open positions
import { getPaperTrades, getPaperPositions } from "../../../../lib/paper-trading";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const { id } = req.query;

  try {
    const [trades, positions] = await Promise.all([
      getPaperTrades(id),
      getPaperPositions(id),
    ]);
    res.json({ ok: true, strategyId: id, trades, openPositions: positions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
