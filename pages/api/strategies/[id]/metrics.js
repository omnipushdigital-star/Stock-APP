// GET /api/strategies/[id]/metrics — get performance metrics (or recalculate)
// ?refresh=true forces recalculation from trade history
import { getMetrics, calcAndSaveMetrics } from "../../../../lib/paper-trading";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const { id, refresh } = req.query;

  try {
    const metrics = refresh === "true"
      ? await calcAndSaveMetrics(id)
      : (await getMetrics(id)) || await calcAndSaveMetrics(id);

    res.json({ ok: true, strategyId: id, metrics });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
