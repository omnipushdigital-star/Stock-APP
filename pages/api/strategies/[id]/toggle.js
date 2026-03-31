// POST /api/strategies/[id]/toggle — pause or resume a strategy
import { getStrategyDef, setStatus } from "../../../../lib/strategies/index";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { id } = req.query;

  try {
    const def = await getStrategyDef(id);
    const newStatus = def.status === "paused" ? "active" : "paused";
    const updated = await setStatus(id, newStatus);
    res.json({ ok: true, id, status: newStatus, strategy: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
