// POST /api/strategies/[id]/run — manually trigger one strategy cycle
// Body: { forceBuy?: boolean, forceSell?: boolean }
import { runStrategyCycle } from "../../../../lib/strategies/index";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { id } = req.query;
  const { forceBuy = false, forceSell = false } = req.body || {};

  try {
    const result = await runStrategyCycle(id, { forceBuy, forceSell });
    res.json({ ok: true, strategyId: id, result });
  } catch (e) {
    console.error(`Manual run error [${id}]:`, e);
    res.status(500).json({ error: e.message });
  }
}
