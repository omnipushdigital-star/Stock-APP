# 📈 ATSL Stock Trading Dashboard

A Next.js web app for your Zerodha ATSL trading system — hosted on Vercel with Cloudflare R2 + KV replacing AWS S3.

---

## Architecture

```
Vercel (Next.js)
├── Dashboard UI         → Live positions, signals, history, cron controls
├── API Routes           → Portfolio, auth, signals
└── Cron Jobs            → Replace EC2 shell scripts (vercel.json)

Cloudflare R2            → Replaces AWS S3 (Excel files, JSON data)
Cloudflare KV            → Token storage, cron state, logs
Zerodha Kite API         → Trading data + order execution
Telegram Bot             → Notifications (unchanged)
```

---

## Setup Guide

### 1. Cloudflare R2 (replaces S3)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → R2
2. Create a bucket named `stock-atsl`
3. Go to **R2 → Manage R2 API Tokens** → Create Token
   - Permissions: Object Read & Write
   - Copy: Account ID, Access Key ID, Secret Access Key
4. Your endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

**Upload your existing files to R2:**
```bash
# Install rclone and configure with R2 credentials
rclone copy stocks_bought-atsl.xlsx r2:stock-atsl/
rclone copy trade_history.xlsx r2:stock-atsl/
rclone copy fno_lots.xlsx r2:stock-atsl/
rclone copy EQUITY_L_NIFTY200.csv r2:stock-atsl/
```

### 2. Cloudflare KV

1. Go to Cloudflare Dashboard → **Workers & Pages → KV**
2. Create a namespace named `stock-atsl-kv`
3. Copy the **Namespace ID**
4. Go to **My Profile → API Tokens** → Create Token
   - Permission: Account → Workers KV Storage → Edit
   - Copy the token

### 3. Deploy to Vercel

```bash
npm install -g vercel
cd stock-atsl-webapp
vercel login
vercel --prod
```

### 4. Set Environment Variables in Vercel

Go to your Vercel project → Settings → Environment Variables and add:

```
ZERODHA_API_KEY          = your_kite_api_key
ZERODHA_API_SECRET       = your_kite_api_secret
ZERODHA_USER_ID          = KVH831

TELEGRAM_BOT_TOKEN       = 7417843525:AAENjdPn5HVoLGrCkpHYpWAjt5evTpwE2gI
TELEGRAM_CHAT_ID         = -4595309435

CF_R2_ACCOUNT_ID         = your_cloudflare_account_id
CF_R2_ACCESS_KEY_ID      = your_r2_access_key
CF_R2_SECRET_ACCESS_KEY  = your_r2_secret_key
CF_R2_BUCKET_NAME        = stock-atsl
CF_R2_ENDPOINT           = https://<ACCOUNT_ID>.r2.cloudflarestorage.com

CF_KV_NAMESPACE_ID       = your_kv_namespace_id
CF_KV_API_TOKEN          = your_cf_api_token

CRON_SECRET              = generate_random_32char_string
DASHBOARD_PASSWORD       = your_password
```

### 5. Configure Zerodha Kite Redirect URL

In your [Kite Developer Console](https://developers.kite.trade):
- Set Redirect URL to: `https://your-app.vercel.app/api/auth/kite-callback`

---

## Daily Login Flow (replaces Telegram bot flow)

Every morning before market opens:

1. Open dashboard → **Positions tab**
2. Click **"Get Login URL"**
3. Click **"Open Zerodha Login ↗"** — logs you into Zerodha
4. After login, Zerodha redirects to your app with the token automatically
   **OR** copy `request_token` from the redirect URL and paste it in the dashboard

The token is saved to Cloudflare KV with 24h TTL.

---

## Cron Jobs (replaces EC2 shell scripts)

| Job | Schedule | Replaces |
|-----|----------|---------|
| token-health | 7:00 AM Mon–Fri | `restart_token_bot_if_down.sh` |
| fno-ohlc | 8:00 AM Mon–Fri | `fno_ohlc_fetcher.py` |
| cash-atsl | Every 1 min 9–21 Mon–Fri | `run_cash_atsl.sh` + cron |
| buy-signals | Every 3 min 9–15 Mon–Fri | `controller.py` → `generate_buy_signals.py` |
| sell-tracker | Every 3 min 9–15 Mon–Fri | `controller.py` → `sell_tracker.py` |
| eod-summary | 3:35 PM Mon–Fri | `send_eod_summary.py` |

---

## Key Differences from EC2

| EC2 (before) | Vercel (now) |
|---|---|
| Long-running Python loops | Serverless functions (max 60s) |
| AWS S3 for Excel files | Cloudflare R2 |
| Local JSON files | Cloudflare KV |
| Shell watchdog scripts | Vercel Cron Jobs |
| Selenium auto-login | Manual token paste on dashboard |
| Telethon listener | Telegram webhook / polling not needed |

---

## Local Development

```bash
cp .env.example .env.local
# Fill in your credentials
npm install
npm run dev
# Open http://localhost:3000
```
