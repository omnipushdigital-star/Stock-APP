// pages/api/auth/set-token.js
// For the Telegram bot flow: user pastes request_token from the Zerodha redirect URL
import { generateSession } from "../../../lib/kite";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { requestToken } = req.body;
  if (!requestToken) return res.status(400).json({ error: "requestToken required" });
  try {
    const tokenData = await generateSession(requestToken.trim());
    return res.json({ ok: true, user_id: tokenData.user_id, user_name: tokenData.user_name });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}
