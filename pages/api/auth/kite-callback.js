// pages/api/auth/kite-callback.js
// Zerodha redirects here after login: ?request_token=xxx&status=success
import { generateSession } from "../../../lib/kite";

export default async function handler(req, res) {
  const { request_token, status } = req.query;
  if (status !== "success" || !request_token) {
    return res.redirect("/?auth=failed");
  }
  try {
    await generateSession(request_token);
    return res.redirect("/?auth=success");
  } catch (e) {
    console.error(e);
    return res.redirect("/?auth=error&msg=" + encodeURIComponent(e.message));
  }
}
