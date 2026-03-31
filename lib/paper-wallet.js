// lib/paper-wallet.js — Per-strategy virtual wallet for paper trading.
// Tracks available cash, deployed capital, realized + unrealized P&L.
// Persisted to R2 as paper_wallet_{strategyId}.json
// All monetary values in INR.

import { getJSON, putJSON } from "./r2";
import { todayIST } from "./market";

const DEFAULT_CAPITAL = 1_000_000; // ₹10,00,000

const walletKey = (id) => `paper_wallet_${id}.json`;

// ─── Schema ──────────────────────────────────────────────────────────────────
// {
//   strategyId:      string
//   startingCapital: number   — set once at creation
//   availableCash:   number   — cash not currently deployed
//   deployedCapital: number   — sum of open position costs (cost basis)
//   realizedPnL:     number   — cumulative P&L from all closed trades
//   txCount:         number   — total transactions (buys + sells)
//   lastUpdated:     string   — ISO timestamp
//   log:             Array<{ts, type, symbol, amount, balance}> — last 50 entries
// }

// ─── Read / Init ─────────────────────────────────────────────────────────────

/**
 * Load wallet state. Initializes with DEFAULT_CAPITAL if it doesn't exist yet.
 * @param {string} strategyId
 * @param {number} [startingCapital]
 */
export async function getWallet(strategyId, startingCapital = DEFAULT_CAPITAL) {
  const stored = await getJSON(walletKey(strategyId));
  if (stored) return stored;

  // First access — initialize
  const wallet = {
    strategyId,
    startingCapital,
    availableCash:   startingCapital,
    deployedCapital: 0,
    realizedPnL:     0,
    txCount:         0,
    lastUpdated:     new Date().toISOString(),
    log:             [],
  };
  await putJSON(walletKey(strategyId), wallet);
  return wallet;
}

// ─── Computed view ────────────────────────────────────────────────────────────

/**
 * Return wallet + computed fields. Does NOT fetch live prices (caller provides unrealizedPnL if needed).
 * @param {string} strategyId
 * @param {number} [unrealizedPnL=0] — pass in current unrealized P&L from open positions
 */
export async function getWalletView(strategyId, unrealizedPnL = 0) {
  const w = await getWallet(strategyId);
  const totalValue    = w.availableCash + w.deployedCapital + unrealizedPnL;
  const totalReturn   = ((totalValue - w.startingCapital) / w.startingCapital) * 100;
  return {
    ...w,
    unrealizedPnL: parseFloat(unrealizedPnL.toFixed(2)),
    totalValue:    parseFloat(totalValue.toFixed(2)),
    totalReturn:   parseFloat(totalReturn.toFixed(2)),
  };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Debit cash for a BUY order.
 * @param {string} strategyId
 * @param {string} symbol
 * @param {number} qty
 * @param {number} price
 * @returns {Promise<{ok: boolean, wallet: object, reason?: string}>}
 */
export async function debitBuy(strategyId, symbol, qty, price) {
  const w      = await getWallet(strategyId);
  const amount = parseFloat((qty * price).toFixed(2));

  if (amount > w.availableCash) {
    return {
      ok:     false,
      reason: `Insufficient cash — need ₹${amount.toLocaleString("en-IN")} but only ₹${w.availableCash.toLocaleString("en-IN")} available`,
      wallet: w,
    };
  }

  w.availableCash   = parseFloat((w.availableCash - amount).toFixed(2));
  w.deployedCapital = parseFloat((w.deployedCapital + amount).toFixed(2));
  w.txCount        += 1;
  w.lastUpdated     = new Date().toISOString();
  appendLog(w, { type: "BUY", symbol, amount, qty, price, balance: w.availableCash });

  await putJSON(walletKey(strategyId), w);
  return { ok: true, wallet: w, amount };
}

/**
 * Credit cash for a SELL order (returns cost basis + P&L).
 * @param {string} strategyId
 * @param {string} symbol
 * @param {number} qty
 * @param {number} buyPrice   — original cost basis per share
 * @param {number} sellPrice
 */
export async function creditSell(strategyId, symbol, qty, buyPrice, sellPrice) {
  const w        = await getWallet(strategyId);
  const costBasis = parseFloat((qty * buyPrice).toFixed(2));
  const proceeds  = parseFloat((qty * sellPrice).toFixed(2));
  const pnl       = parseFloat((proceeds - costBasis).toFixed(2));

  w.availableCash   = parseFloat((w.availableCash + proceeds).toFixed(2));
  w.deployedCapital = parseFloat(Math.max(0, w.deployedCapital - costBasis).toFixed(2));
  w.realizedPnL     = parseFloat((w.realizedPnL + pnl).toFixed(2));
  w.txCount        += 1;
  w.lastUpdated     = new Date().toISOString();
  appendLog(w, { type: "SELL", symbol, amount: proceeds, qty, price: sellPrice, pnl, balance: w.availableCash });

  await putJSON(walletKey(strategyId), w);
  return { ok: true, wallet: w, pnl, proceeds };
}

/**
 * Reset wallet to a new starting capital (clears all history).
 * @param {string} strategyId
 * @param {number} [capital=DEFAULT_CAPITAL]
 */
export async function resetWallet(strategyId, capital = DEFAULT_CAPITAL) {
  const wallet = {
    strategyId,
    startingCapital: capital,
    availableCash:   capital,
    deployedCapital: 0,
    realizedPnL:     0,
    txCount:         0,
    lastUpdated:     new Date().toISOString(),
    log:             [{ ts: new Date().toISOString(), type: "RESET", amount: capital, balance: capital }],
  };
  await putJSON(walletKey(strategyId), wallet);
  return wallet;
}

/**
 * Update starting capital without clearing trade history.
 * Recalculates availableCash proportionally.
 */
export async function setStartingCapital(strategyId, newCapital) {
  const w   = await getWallet(strategyId);
  const diff = newCapital - w.startingCapital;
  w.startingCapital = newCapital;
  w.availableCash   = parseFloat(Math.max(0, w.availableCash + diff).toFixed(2));
  w.lastUpdated     = new Date().toISOString();
  appendLog(w, { type: "CAPITAL_CHANGE", amount: newCapital, balance: w.availableCash });
  await putJSON(walletKey(strategyId), w);
  return w;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function appendLog(wallet, entry) {
  wallet.log = wallet.log || [];
  wallet.log.unshift({ ts: new Date().toISOString(), ...entry });
  wallet.log = wallet.log.slice(0, 50); // keep last 50 entries
}
