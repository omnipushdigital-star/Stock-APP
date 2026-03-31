// pages/api/auth/token-status.js
import { getTokenStatus } from "../../../lib/kite";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const status = await getTokenStatus();
  res.json(status);
}
