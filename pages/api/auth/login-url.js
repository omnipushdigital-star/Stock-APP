// pages/api/auth/login-url.js
import { getLoginUrl } from "../../../lib/kite";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  res.json({ url: getLoginUrl() });
}
