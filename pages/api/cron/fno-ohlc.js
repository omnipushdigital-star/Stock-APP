// pages/api/cron/fno-ohlc.js
// Mirrors fno_ohlc_fetcher.py — fetches historical OHLC and calculates EMAs/RSI
import { getKite } from "../../../lib/kite";
import { getExcel, putJSON } from "../../../lib/r2";
import { sendTelegram } from "../../../lib/telegram";
import { getCronState, setCronState } from "../../../lib/kv";
import { isTradingDay, nowIST } from "../../../lib/market";

function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(4));
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!isTradingDay()) return res.json({ skipped: true, reason: "Not a trading day" });

  const cronName = "fno-ohlc";
  const state = await getCronState(cronName);
  if (!state.enabled) return res.json({ skipped: true, reason: "Cron disabled" });

  try {
    const kite = await getKite();
    // Load FNO stocks list
    const fnoRows = await getExcel("fno_lots.xlsx").catch(() => []);
    const symbols = fnoRows.map((r) => r["Symbol"] || r["SYMBOL"]).filter(Boolean).slice(0, 50);

    const toDate = nowIST().toISOString().split("T")[0];
    const fromDate = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];

    const results = [];

    for (const sym of symbols) {
      try {
        const clean = sym.replace(".NS", "");
        const ltpData = await kite.getLTP([`NSE:${clean}`]);
        const token = ltpData[`NSE:${clean}`]?.instrument_token;
        if (!token) continue;

        const hist = await kite.getHistoricalData(token, fromDate, toDate, "day");
        const closes = hist.map((h) => h.close);
        if (closes.length < 20) continue;

        results.push({
          symbol: sym,
          ema6: calcEMA(closes, 6),
          ema20: calcEMA(closes, 20),
          ema50: calcEMA(closes.length >= 50 ? closes : closes, 50),
          rsi: calcRSI(closes),
          lastClose: closes[closes.length - 1],
          lastVolume: hist[hist.length - 1]?.volume || 0,
        });
      } catch (e) {
        console.error(`OHLC error ${sym}:`, e.message);
      }
    }

    await putJSON("fno_historical_summary.json", results);
    await sendTelegram(`📊 *FNO OHLC Updated*\n${results.length} symbols processed`);
    await setCronState(cronName, { enabled: true, lastRun: new Date().toISOString(), lastStatus: "ok", count: results.length });
    res.json({ ok: true, processed: results.length });
  } catch (e) {
    console.error("fno-ohlc error:", e);
    await sendTelegram(`❌ *fno-ohlc cron error*\n${e.message}`);
    await setCronState(cronName, { enabled: true, lastRun: new Date().toISOString(), lastStatus: "error" });
    res.status(500).json({ error: e.message });
  }
}
