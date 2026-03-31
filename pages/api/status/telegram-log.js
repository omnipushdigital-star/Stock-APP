// pages/api/status/telegram-log.js
import { getLog } from "../../../lib/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const log = await getLog("log_telegram");
    res.json({ messages: log });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
