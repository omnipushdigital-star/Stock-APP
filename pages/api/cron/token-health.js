// pages/api/cron/token-health.js
import { getTokenStatus, getLoginUrl } from "../../../lib/kite";
import { sendTelegram } from "../../../lib/telegram";
import { setCronState, getCronState, appendLog } from "../../../lib/kv";

export default async function handler(req, res) {
  // Vercel cron auth
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const cronName = "token-health";
  const state = await getCronState(cronName);
  if (!state.enabled) return res.json({ skipped: true, reason: "Cron disabled" });

  try {
    const status = await getTokenStatus();
    const now = new Date().toISOString();

    if (status.valid) {
      await sendTelegram(
        `✅ *Token Health Check OK*\nUser: ${status.user_name} (${status.user_id})\nValid since: ${status.timestamp}`
      );
      await appendLog("log_telegram", { type: "token_health", status: "ok", user: status.user_name });
    } else {
      const loginUrl = getLoginUrl();
      await sendTelegram(
        `⚠️ *Token Invalid — Login Required*\nReason: ${status.reason}\n\n🔗 Login: ${loginUrl}\n\nOr paste request_token on the dashboard.`
      );
      await appendLog("log_telegram", { type: "token_health", status: "expired", reason: status.reason });
    }

    await setCronState(cronName, { enabled: true, lastRun: now, lastStatus: status.valid ? "ok" : "expired" });
    res.json({ ok: true, tokenValid: status.valid });
  } catch (e) {
    await setCronState(cronName, { enabled: true, lastRun: new Date().toISOString(), lastStatus: "error" });
    res.status(500).json({ error: e.message });
  }
}
