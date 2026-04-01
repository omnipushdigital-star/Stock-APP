// lib/strategies/index.js — Strategy registry, config management, and cycle runner
// Each strategy is defined here with defaults; live config is persisted in KV.

import { kvGet, kvPut } from "../kv";
import { getKite } from "../kite";
import { isMarketOpen, nowIST } from "../market";

// ─── Static strategy definitions ─────────────────────────────────────────────

export const STRATEGY_DEFS = [
  {
    id: "cash-atsl-v1",
    name: "Cash ATSL 6EMA",
    version: "1.0",
    description: "Nifty 200 6EMA crossover with adaptive trailing stop-loss. Production strategy.",
    mode: "live",           // this one runs live; all others default paper
    status: "active",
    config: {
      universe: "nifty200",
      emaPeriod: 6,
      tslActivationPct: 1.0,   // activate TSL when profit > 1%
      maxHoldDays: 7,
      walletBalance: 100000,
      maxPositions: 10,
      buyWindow: { hour: 15, minStart: 15, minEnd: 25 },
      emaFilter: true,         // require NIFTY 50 > 6EMA for buys
    },
  },
  {
    id: "cash-atsl-paper",
    name: "Cash ATSL 6EMA (Paper)",
    version: "1.0",
    description: "Paper trading clone of Cash ATSL. Same 6EMA crossover + adaptive TSL logic — no real orders placed. Use this to validate signals before going live.",
    mode: "paper",
    status: "active",
    config: {
      universe: "nifty200",
      emaPeriod: 6,
      tslActivationPct: 1.0,
      maxHoldDays: 7,
      walletBalance: 1000000,  // ₹10L virtual capital
      maxPositions: 10,
      buyWindow: { hour: 15, minStart: 15, minEnd: 25 },
      emaFilter: true,
    },
  },
  {
    id: "ema-crossover",
    name: "EMA Golden/Death Cross",
    version: "1.0",
    description: "Buy when 6EMA crosses above 20EMA; sell on death cross or 5% fixed stop-loss.",
    mode: "paper",
    status: "active",
    config: {
      universe: "nifty200",
      fastPeriod: 6,
      slowPeriod: 20,
      stopLossPct: 5.0,
      walletBalance: 1000000,
      maxPositions: 5,
    },
  },
  {
    id: "rsi-momentum",
    name: "RSI Momentum",
    version: "1.0",
    description: "Buy when RSI crosses above 50 from below and price is above 20EMA. Sell on RSI < 40 or 3% trailing stop.",
    mode: "paper",
    status: "active",
    config: {
      universe: "nifty200",
      rsiPeriod: 14,
      rsiEntry: 50,
      rsiExit: 40,
      emaPeriod: 20,
      trailPct: 3.0,
      walletBalance: 1000000,
      maxPositions: 5,
    },
  },
  {
    id: "btst",
    name: "BTST (Buy Today Sell Tomorrow)",
    version: "1.0",
    description: "Buy in last 30 min if stock up >1.5% on day. Sell next day 15 min after open.",
    mode: "paper",
    status: "active",
    config: {
      universe: "nifty200",
      minDayGainPct: 1.5,
      buyWindowStart: { hour: 14, minute: 45 },
      buyWindowEnd:   { hour: 15, minute: 15 },
      sellMinutesAfterOpen: 15,
      walletBalance: 1000000,
      maxPositions: 3,
    },
  },
];

// ─── KV helpers for strategy config / state ──────────────────────────────────

const cfgKey  = (id) => `strategy_config_${id}`;
const statKey = (id) => `strategy_status_${id}`;

/**
 * Get merged strategy definition: static defaults + KV overrides.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function getStrategyDef(id) {
  const base = STRATEGY_DEFS.find((s) => s.id === id);
  if (!base) throw new Error(`Unknown strategy: ${id}`);
  const override = await kvGet(cfgKey(id));
  return override ? { ...base, ...override, config: { ...base.config, ...(override.config || {}) } } : { ...base };
}

/**
 * Get all strategies with their current KV state.
 */
export async function getAllStrategies() {
  return Promise.all(STRATEGY_DEFS.map((s) => getStrategyDef(s.id)));
}

/**
 * Persist config overrides for a strategy.
 */
export async function setStrategyConfig(id, patch) {
  const current = await getStrategyDef(id);
  const updated = { ...current, ...patch, config: { ...current.config, ...(patch.config || {}) } };
  // Strip heavy fields that shouldn't live in KV
  const { ...toStore } = updated;
  await kvPut(cfgKey(id), toStore);
  return toStore;
}

/**
 * Set mode: "paper" | "live"
 */
export async function setMode(id, mode) {
  if (mode !== "paper" && mode !== "live") throw new Error('mode must be "paper" or "live"');
  return setStrategyConfig(id, { mode });
}

/**
 * Set status: "active" | "paused" | "testing"
 */
export async function setStatus(id, status) {
  if (!["active", "paused", "testing"].includes(status)) throw new Error("Invalid status");
  return setStrategyConfig(id, { status });
}

// ─── Strategy runner ──────────────────────────────────────────────────────────

/**
 * Import and run one cycle of a strategy agent.
 * Handles paper vs live routing.
 * @param {string} id - strategy id
 * @param {object} [opts]
 * @param {boolean} [opts.forceBuy] - trigger buy check regardless of time window
 * @param {boolean} [opts.forceSell] - trigger sell check
 * @returns {Promise<object>} result summary
 */
export async function runStrategyCycle(id, opts = {}) {
  const def = await getStrategyDef(id);

  if (def.status === "paused") {
    return { skipped: true, reason: "Strategy paused" };
  }

  if (!isMarketOpen() && !opts.forceBuy && !opts.forceSell) {
    return { skipped: true, reason: "Market closed" };
  }

  // Dynamic import of the strategy agent module
  let agent;
  switch (id) {
    case "cash-atsl-v1":
    case "cash-atsl-paper":
      agent = await import("./cash-atsl.js");
      break;
    case "ema-crossover":
      agent = await import("./ema-crossover.js");
      break;
    case "rsi-momentum":
      agent = await import("./rsi-momentum.js");
      break;
    case "btst":
      agent = await import("./btst.js");
      break;
    default:
      throw new Error(`No agent module for strategy: ${id}`);
  }

  const kite = await getKite();
  const now  = nowIST();

  const result = await agent.runCycle(kite, def, { now, ...opts });

  // Persist last run timestamp
  await kvPut(statKey(id), {
    lastRun: new Date().toISOString(),
    lastResult: result,
  });

  return result;
}

/**
 * Run all active strategies (called from cron).
 */
export async function runAllActiveStrategies(opts = {}) {
  const strategies = await getAllStrategies();
  const active = strategies.filter((s) => s.status === "active");
  const results = {};

  for (const s of active) {
    try {
      results[s.id] = await runStrategyCycle(s.id, opts);
    } catch (e) {
      results[s.id] = { error: e.message };
    }
  }

  return results;
}
