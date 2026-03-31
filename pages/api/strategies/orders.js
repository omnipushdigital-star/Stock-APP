// GET /api/strategies/orders — today's order log from R2
import { getTodayOrders, getAllOrders } from "../../../lib/order-executor";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const { all } = req.query;

  try {
    const orders = all === "true" ? await getAllOrders() : await getTodayOrders();
    res.json({ ok: true, orders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
