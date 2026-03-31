// POST /api/strategies/[id]/mode — switch between paper and live mode
// Body: { mode: "paper" | "live" }
// Live mode requires explicit confirmation to prevent accidental promotion.
import { getStrategyDef, setMode } from "../../../../lib/strategies/index";
import { sendTelegram } from "../../../../lib/telegram";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { id } = req.query;
  const { mode, confirm } = req.body || {};

  if (!mode || !["paper", "live"].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "paper" or "live"' });
  }

  // Require explicit confirmation when promoting to live
  if (mode === "live" && confirm !== true) {
    return res.status(400).json({
      error: 'Promoting to live requires { confirm: true } in request body.',
      hint:  'This will place REAL orders with REAL money.',
    });
  }

  try {
    const def     = await getStrategyDef(id);
    const updated = await setMode(id, mode);

    if (mode === "live") {
      await sendTelegram(
        `🚀 *Strategy Promoted to LIVE*\nStrategy: ${def.name} (${id})\nMode: PAPER → LIVE\n⚠️ Real orders will now be placed!`
      );
    } else {
      await sendTelegram(
        `🔄 *Strategy Moved to PAPER*\nStrategy: ${def.name} (${id})\nMode: LIVE → PAPER\nSimulated trades only.`
      );
    }

    res.json({ ok: true, id, mode, strategy: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
