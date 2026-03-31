// pages/api/signals/sell.js
import { getLog } from "../../../lib/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const log = await getLog("log_sell_signals");
    res.json({ signals: log });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
