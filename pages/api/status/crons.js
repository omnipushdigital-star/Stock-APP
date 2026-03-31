// pages/api/status/crons.js — get/toggle cron enabled states
import { getCronState, setCronState } from "../../../lib/kv";

const CRON_NAMES = ["cash-atsl", "buy-signals", "sell-tracker", "fno-ohlc", "eod-summary", "token-health"];

export default async function handler(req, res) {
  if (req.method === "GET") {
    const states = await Promise.all(
      CRON_NAMES.map(async (name) => ({ name, ...(await getCronState(name)) }))
    );
    return res.json({ crons: states });
  }

  if (req.method === "POST") {
    const { name, enabled } = req.body;
    if (!CRON_NAMES.includes(name)) return res.status(400).json({ error: "Unknown cron" });
    const current = await getCronState(name);
    await setCronState(name, { ...current, enabled });
    return res.json({ ok: true, name, enabled });
  }

  res.status(405).end();
}
