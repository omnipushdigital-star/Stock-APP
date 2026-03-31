// lib/risk-manager.js — Pre-trade risk checks for live order execution.
// Checks position limits, capital per trade, and daily loss limits.
// All checks run before every live order; returns { approved: bool, reason: string }.

import { kvGet, kvPut } from "./kv";
import { getExcel } from "./r2";
import { todayIST } from "./market";
import { getKite } from "./kite";
import { sendTelegram } from "./telegram";
import { emergencyCloseAll } from "./order-executor";

const RISK_STATE_KEY  = (id) => `risk_state_${id}`;
const GLOBAL_RISK_KEY = "risk_state_global";

// ─── Default risk parameters (can be overridden per strategy in KV) ──────────

const DEFAULT_RISK = {
  maxPositions:      5,
  maxCapitalPerTrade: 20000,   // ₹20,000 max per single trade
  dailyLossLimit:   -5000,     // Stop all trading if day P&L < -₹5,000
  maxTotalExposure:  150000,   // Max total capital deployed at once
};

/**
 * Get risk config for a strategy (merged with defaults).
 */
export async function getRiskConfig(strategyId) {
  const saved = await kvGet(RISK_STATE_KEY(strategyId));
  return { ...DEFAULT_RISK, ...(saved?.config || {}) };
}

/**
 * Update risk config for a strategy.
 */
export async function setRiskConfig(strategyId, patch) {
  const current = await kvGet(RISK_STATE_KEY(strategyId)) || {};
  await kvPut(RISK_STATE_KEY(strategyId), {
    ...current,
    config: { ...(current.config || DEFAULT_RISK), ...patch },
  });
}

/**
 * Run all pre-trade risk checks.
 * @param {string} strategyId
 * @param {object} trade - { symbol, qty, price }
 * @returns {Promise<{approved: boolean, reason: string}>}
 */
export async function checkRisk(strategyId, trade) {
  const cfg = await getRiskConfig(strategyId);

  // 1. Global kill switch
  const global = await kvGet(GLOBAL_RISK_KEY) || {};
  if (global.killSwitch) {
    return { approved: false, reason: "Global kill switch is active" };
  }
  if (global.haltedStrategies?.includes(strategyId)) {
    return { approved: false, reason: `Strategy ${strategyId} is halted (daily loss limit)` };
  }

  // 2. Capital per trade
  const tradeValue = trade.qty * trade.price;
  if (tradeValue > cfg.maxCapitalPerTrade) {
    return {
      approved: false,
      reason:   `Trade value ₹${tradeValue.toFixed(0)} exceeds max ₹${cfg.maxCapitalPerTrade}`,
    };
  }

  // 3. Open positions check — count live positions from Kite
  try {
    const kite = await getKite();
    const kitePositions = await kite.getPositions();
    const openCount = (kitePositions?.net || []).filter(
      (p) => p.quantity !== 0 && p.product === "CNC"
    ).length;
    if (openCount >= cfg.maxPositions) {
      return { approved: false, reason: `Max positions (${cfg.maxPositions}) already open` };
    }

    // 4. Total exposure check
    const totalExposure = (kitePositions?.net || [])
      .filter((p) => p.quantity > 0)
      .reduce((sum, p) => sum + p.quantity * p.last_price, 0);
    if (totalExposure + tradeValue > cfg.maxTotalExposure) {
      return {
        approved: false,
        reason:   `Total exposure ₹${(totalExposure + tradeValue).toFixed(0)} would exceed limit ₹${cfg.maxTotalExposure}`,
      };
    }

    // 5. Daily P&L loss limit
    const todayPnL = (kitePositions?.net || []).reduce((sum, p) => sum + (p.pnl || 0), 0);
    if (todayPnL < cfg.dailyLossLimit) {
      await haltStrategy(strategyId, `Daily loss limit hit: ₹${todayPnL.toFixed(2)}`);
      return {
        approved: false,
        reason:   `Daily P&L ₹${todayPnL.toFixed(2)} below limit ₹${cfg.dailyLossLimit}`,
      };
    }
  } catch (e) {
    // If Kite is unavailable, be conservative and reject
    return { approved: false, reason: `Risk check failed (Kite unavailable): ${e.message}` };
  }

  return { approved: true, reason: "All checks passed" };
}

/**
 * Halt a strategy for the rest of the trading day due to loss limit.
 */
export async function haltStrategy(strategyId, reason) {
  const global = await kvGet(GLOBAL_RISK_KEY) || {};
  const halted = Array.isArray(global.haltedStrategies) ? global.haltedStrategies : [];
  if (!halted.includes(strategyId)) {
    halted.push(strategyId);
    await kvPut(GLOBAL_RISK_KEY, { ...global, haltedStrategies: halted });
    await sendTelegram(`⚠️ *Risk Manager: Strategy Halted*\nStrategy: ${strategyId}\nReason: ${reason}\nTrading halted for today.`);
  }
}

/**
 * Re-enable all halted strategies (call each morning before market open).
 */
export async function resetDailyHalts() {
  const global = await kvGet(GLOBAL_RISK_KEY) || {};
  await kvPut(GLOBAL_RISK_KEY, { ...global, haltedStrategies: [] });
}

/**
 * Activate global kill switch — stops ALL live orders across all strategies.
 */
export async function setKillSwitch(active) {
  const global = await kvGet(GLOBAL_RISK_KEY) || {};
  await kvPut(GLOBAL_RISK_KEY, { ...global, killSwitch: active });
  if (active) {
    await sendTelegram("🛑 *KILL SWITCH ACTIVATED* — All live trading halted immediately.");
  } else {
    await sendTelegram("✅ *Kill switch deactivated* — Live trading resumed.");
  }
}

/**
 * Emergency: close all open CNC positions via Kite.
 */
export async function emergencyCloseAllPositions() {
  try {
    const kite = await getKite();
    const pos  = await kite.getPositions();
    const open = (pos?.net || []).filter((p) => p.quantity > 0 && p.product === "CNC");
    const toClose = open.map((p) => ({ symbol: p.tradingsymbol, qty: p.quantity }));
    if (toClose.length === 0) return { closed: 0, positions: [] };
    const results = await emergencyCloseAll(kite, toClose);
    await sendTelegram(`🚨 *Emergency Close*\nClosed ${results.length} positions.`);
    return { closed: results.length, positions: results };
  } catch (e) {
    await sendTelegram(`❌ *Emergency close failed*\n${e.message}`);
    throw e;
  }
}

/**
 * Get current risk state summary.
 */
export async function getRiskState() {
  const global = await kvGet(GLOBAL_RISK_KEY) || {};
  return {
    killSwitch:        global.killSwitch || false,
    haltedStrategies:  global.haltedStrategies || [],
    date:              todayIST(),
  };
}
