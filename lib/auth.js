// lib/auth.js — Simple password-based dashboard auth

export function withAuth(handler) {
  return async (req, res) => {
    // Allow cron routes with CRON_SECRET header
    const cronSecret = req.headers["x-cron-secret"];
    if (cronSecret && cronSecret === process.env.CRON_SECRET) {
      return handler(req, res);
    }
    // Allow dashboard session cookie
    const session = req.cookies?.session;
    if (session === process.env.DASHBOARD_PASSWORD) {
      return handler(req, res);
    }
    return res.status(401).json({ error: "Unauthorized" });
  };
}

export function withCronAuth(handler) {
  return async (req, res) => {
    const secret = req.headers["authorization"]?.replace("Bearer ", "");
    if (secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized cron call" });
    }
    return handler(req, res);
  };
}
