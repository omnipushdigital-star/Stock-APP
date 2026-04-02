/**
 * ATSL Trading Automation — Cloudflare Worker
 * Secrets accessed via env.TRADING_CRON_SECRET (module worker syntax)
 *
 * Job schedule (IST):
 *   08:30              → token-health
 *   09:15–15:30 / 5min → sell-check
 *   09:15–14:45 / 30min→ buy-signals
 *   15:15,18,22,25     → atsl-update
 *   15:35              → eod-summary
 */

const BASE_URL = "https://stock-webapp-psi.vercel.app";

// ─── Time helpers ─────────────────────────────────────────────────────────────

function istNow() {
  const now = new Date();
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
}

function isWeekday(ist) {
  const day = ist.getUTCDay();
  return day >= 1 && day <= 5;
}

function hhmm(ist) {
  return ist.getUTCHours() * 100 + ist.getUTCMinutes();
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function callVercel(path, secret, body = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

// ─── Scheduled handler ────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    const secret = env.TRADING_CRON_SECRET;
    const ist    = istNow();
    const time   = hhmm(ist);
    const min    = ist.getUTCMinutes();

    if (!isWeekday(ist)) return;

    const jobs = [];

    // Token health — 08:30 IST
    if (time === 830)
      jobs.push(["token-health", callVercel("/api/trading/token-health", secret)]);

    // Sell check — every 5 min, 09:15–15:30 IST
    if (time >= 915 && time <= 1530 && min % 5 === 0)
      jobs.push(["sell-check", callVercel("/api/trading/sell-check", secret)]);

    // Buy signals — every 30 min, 09:15–14:45 IST
    if (time >= 915 && time <= 1445 && min % 30 === 0)
      jobs.push(["buy-signals", callVercel("/api/trading/buy-signals", secret)]);

    // ATSL update — once at 15:20 IST
    if (time === 1520)
      jobs.push(["atsl-update", callVercel("/api/trading/atsl-update", secret)]);

    // EOD summary — 15:35 IST
    if (time === 1535)
      jobs.push(["eod-summary", callVercel("/api/trading/eod-summary", secret)]);

    if (jobs.length > 0) {
      const results = await Promise.allSettled(jobs.map(([, p]) => p));
      results.forEach((r, i) => {
        const name = jobs[i][0];
        if (r.status === "fulfilled") {
          console.log(`[${name}] HTTP ${r.value.status}`, JSON.stringify(r.value.data).slice(0, 200));
        } else {
          console.error(`[${name}] FAILED`, r.reason);
        }
      });
    }
  },

  // Manual trigger: GET /?job=sell-check  with Authorization header
  async fetch(request, env, ctx) {
    const secret = env.TRADING_CRON_SECRET;
    if (request.headers.get("Authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const job = new URL(request.url).searchParams.get("job");
    const pathMap = {
      "sell-check":   "/api/trading/sell-check",
      "buy-signals":  "/api/trading/buy-signals",
      "atsl-update":  "/api/trading/atsl-update",
      "eod-summary":  "/api/trading/eod-summary",
      "token-health": "/api/trading/token-health",
    };

    if (!job || !pathMap[job]) {
      return Response.json({ error: "Use ?job=sell-check|buy-signals|atsl-update|eod-summary|token-health" }, { status: 400 });
    }

    const result = await callVercel(pathMap[job], secret);
    return Response.json({ job, ...result });
  },
};
