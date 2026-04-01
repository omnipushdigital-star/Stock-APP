/**
 * ATSL Trading Automation — Cloudflare Worker
 *
 * Replaces Vercel cron jobs with a proper per-minute scheduler.
 * Runs completely automatically — no dashboard needs to be open.
 *
 * Schedule (set in wrangler.toml):
 *   every 1 minute  →  scheduled() handler fires
 *
 * IST = UTC + 5:30
 * Market hours: Mon–Fri, 09:15–15:30 IST  (03:45–10:00 UTC)
 *
 * Job schedule:
 *   Sell check      every 5 min during market hours (09:15–15:30 IST)
 *   Buy signal scan every 30 min during market hours (09:15–14:45 IST)
 *   ATSL update     at 15:15, 15:18, 15:22, 15:25 IST
 *   Token health    once at 08:30 IST (30 min before market)
 */

const BASE_URL    = "https://stock-webapp-psi.vercel.app";
const CRON_SECRET = TRADING_CRON_SECRET; // injected from Worker secret

// ─── Time helpers (all in IST) ────────────────────────────────────────────────

function toIST(date) {
  // UTC + 5h30m
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
}

function istNow() {
  return toIST(new Date());
}

function isWeekday(ist) {
  const day = ist.getUTCDay(); // 0=Sun,6=Sat (UTC day of IST date)
  return day >= 1 && day <= 5;
}

function istHHMM(ist) {
  return ist.getUTCHours() * 100 + ist.getUTCMinutes();
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function callVercel(path, body = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${CRON_SECRET}`,
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
    const ist  = istNow();
    const hhmm = istHHMM(ist);
    const min  = ist.getUTCMinutes();

    // Only run on weekdays
    if (!isWeekday(ist)) return;

    const jobs = [];

    // Token health — 08:30 IST (before market opens)
    if (hhmm === 830) {
      jobs.push(callVercel("/api/trading/token-health"));
    }

    // Sell check — every 5 min, 09:15–15:30 IST
    if (hhmm >= 915 && hhmm <= 1530 && min % 5 === 0) {
      jobs.push(callVercel("/api/trading/sell-check"));
    }

    // Buy signal scan — every 30 min, 09:15–14:45 IST
    if (hhmm >= 915 && hhmm <= 1445 && min % 30 === 0) {
      jobs.push(callVercel("/api/trading/buy-signals"));
    }

    // ATSL update — 15:15, 15:18, 15:22, 15:25 IST
    if ([1515, 1518, 1522, 1525].includes(hhmm)) {
      jobs.push(callVercel("/api/trading/atsl-update"));
    }

    // EOD summary — 15:35 IST
    if (hhmm === 1535) {
      jobs.push(callVercel("/api/trading/eod-summary"));
    }

    if (jobs.length > 0) {
      const results = await Promise.allSettled(jobs);
      console.log(`[${ist.toISOString()}] IST ${hhmm} — ran ${jobs.length} job(s)`, results);
    }
  },

  // Allow manual HTTP trigger for testing: GET /trigger?job=sell-check
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const secret = request.headers.get("Authorization");

    if (secret !== `Bearer ${CRON_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const job = url.searchParams.get("job");
    const pathMap = {
      "sell-check":   "/api/trading/sell-check",
      "buy-signals":  "/api/trading/buy-signals",
      "atsl-update":  "/api/trading/atsl-update",
      "eod-summary":  "/api/trading/eod-summary",
      "token-health": "/api/trading/token-health",
    };

    if (!job || !pathMap[job]) {
      return Response.json({ error: "Unknown job. Use ?job=sell-check|buy-signals|atsl-update|eod-summary|token-health" }, { status: 400 });
    }

    const result = await callVercel(pathMap[job]);
    return Response.json({ job, ...result });
  },
};
