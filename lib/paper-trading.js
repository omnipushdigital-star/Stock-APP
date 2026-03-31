// lib/paper-trading.js — Paper trading engine
// Simulated execution — no real Zerodha orders.
// Each strategy gets its own virtual portfolio (₹10,00,000 starting capital).
// All state is persisted to R2 as Excel + JSON.

import { getExcel, putExcel, getJSON, putJSON } from "./r2";
import { todayIST } from "./market";
import { sharpeRatio, maxDrawdown } from "./indicators";
import { debitBuy, creditSell, getWallet } from "./paper-wallet";

const STARTING_CAPITAL = 1_000_000; // ₹10,00,000 per strategy

// ─── R2 key helpers ───────────────────────────────────────────────────────────

const positionsKey = (id) => `paper_positions_${id}.xlsx`;
const tradesKey    = (id) => `paper_trades_${id}.xlsx`;
const metricsKey   = (id) => `paper_metrics_${id}.json`;

// ─── Positions (open paper trades) ────────────────────────────────────────────

/**
 * Get all open paper positions for a strategy.
 * @param {string} strategyId
 * @returns {Promise<Array>}
 */
export async function getPaperPositions(strategyId) {
  const rows = await getExcel(positionsKey(strategyId));
  return rows.filter((r) => !r["Sell Date"]);
}

/**
 * Get all paper positions (open + closed) for a strategy.
 */
export async function getAllPaperRows(strategyId) {
  return getExcel(positionsKey(strategyId));
}

// ─── Execute a paper trade ─────────────────────────────────────────────────────

/**
 * Record a simulated BUY entry.
 * @param {string} strategyId
 * @param {object} trade
 * @param {string} trade.symbol
 * @param {"BUY"|"SELL"} trade.side
 * @param {number} trade.price
 * @param {number} trade.qty
 * @param {string} [trade.reason]
 */
export async function executePaperTrade(strategyId, trade) {
  const rows = await getExcel(positionsKey(strategyId));

  if (trade.side === "BUY") {
    // Check wallet has enough cash before recording the trade
    const walletResult = await debitBuy(strategyId, trade.symbol, trade.qty, trade.price);
    if (!walletResult.ok) {
      console.warn(`[paper-trading] ${strategyId} buy rejected — ${walletResult.reason}`);
      return { rejected: true, reason: walletResult.reason };
    }

    const newRow = {
      Symbol:          trade.symbol,
      "Buy Price":     trade.price,
      "Buy Date":      todayIST(),
      Quantity:        trade.qty,
      "Highest Price": trade.price,
      "Sell Date":     null,
      "Sell Price":    null,
      "Sell Reason":   null,
      Reason:          trade.reason || "",
      "Capital Used":  parseFloat((trade.price * trade.qty).toFixed(2)),
    };
    rows.push(newRow);
    await putExcel(positionsKey(strategyId), rows);
    return newRow;
  }

  if (trade.side === "SELL") {
    return closePaperPosition(strategyId, trade.symbol, trade.price, trade.reason);
  }
}

/**
 * Close an open paper position (mark as sold + append to trade history).
 */
export async function closePaperPosition(strategyId, symbol, sellPrice, sellReason) {
  const rows = await getExcel(positionsKey(strategyId));
  const idx  = rows.findIndex((r) => r["Symbol"] === symbol && !r["Sell Date"]);
  if (idx === -1) return null;

  const pos      = rows[idx];
  const buyPrice = parseFloat(pos["Buy Price"]);
  const qty      = parseInt(pos["Quantity"] || 0);
  const pnlVal   = parseFloat(((sellPrice - buyPrice) * qty).toFixed(2));
  const pnlPct   = parseFloat(((sellPrice - buyPrice) / buyPrice * 100).toFixed(2));
  const buyDate  = pos["Buy Date"] || "";
  const holdDays = buyDate ? Math.floor((new Date() - new Date(buyDate)) / 86400000) : 0;

  rows[idx]["Sell Date"]   = todayIST();
  rows[idx]["Sell Price"]  = sellPrice;
  rows[idx]["Sell Reason"] = sellReason;

  await putExcel(positionsKey(strategyId), rows);

  // Credit wallet: return cost basis + P&L
  await creditSell(strategyId, symbol, qty, buyPrice, sellPrice);

  // Append to trade history
  const historyRows = await getExcel(tradesKey(strategyId));
  historyRows.push({
    Symbol:        symbol,
    "Buy Price":   buyPrice,
    "Buy Date":    buyDate,
    "Sell Price":  sellPrice,
    "Sell Date":   todayIST(),
    "Sell Reason": sellReason,
    Qty:           qty,
    "P&L":         pnlVal,
    "P&L %":       pnlPct,
    "Hold Days":   holdDays,
  });
  await putExcel(tradesKey(strategyId), historyRows);

  return { symbol, buyPrice, sellPrice, qty, pnlVal, pnlPct };
}

/**
 * Update the highest price reached for an open position (for trailing stop tracking).
 */
export async function updatePaperPositionHigh(strategyId, symbol, newHigh) {
  const rows = await getExcel(positionsKey(strategyId));
  const idx  = rows.findIndex((r) => r["Symbol"] === symbol && !r["Sell Date"]);
  if (idx !== -1 && newHigh > parseFloat(rows[idx]["Highest Price"] || 0)) {
    rows[idx]["Highest Price"] = newHigh;
    await putExcel(positionsKey(strategyId), rows);
  }
}

// ─── Metrics calculation ──────────────────────────────────────────────────────

/**
 * Calculate and persist performance metrics for a strategy.
 * @param {string} strategyId
 * @returns {Promise<object>} metrics object
 */
export async function calcAndSaveMetrics(strategyId) {
  const [trades, openRows, wallet] = await Promise.all([
    getExcel(tradesKey(strategyId)),
    getPaperPositions(strategyId),
    getWallet(strategyId),
  ]);

  const closed      = trades;
  const totalTrades = closed.length;
  const wins        = closed.filter((t) => parseFloat(t["P&L"] || 0) > 0).length;
  const winRate     = totalTrades > 0 ? parseFloat((wins / totalTrades * 100).toFixed(1)) : 0;

  const totalPnL = closed.reduce((sum, t) => sum + parseFloat(t["P&L"] || 0), 0);
  const returns  = closed.map((t) => parseFloat(t["P&L %"] || 0));
  const avgHold  = totalTrades > 0
    ? parseFloat((closed.reduce((s, t) => s + parseInt(t["Hold Days"] || 0), 0) / totalTrades).toFixed(1))
    : 0;

  // Equity curve from wallet: start at startingCapital, apply each trade P&L in chronological order
  const startCapital = wallet.startingCapital || STARTING_CAPITAL;
  let running = startCapital;
  const sortedClosed = [...closed].sort((a, b) => (a["Sell Date"] || "").localeCompare(b["Sell Date"] || ""));
  const equityCurve = [{ date: sortedClosed[0]?.["Buy Date"] || todayIST(), value: startCapital }];
  for (const t of sortedClosed) {
    running += parseFloat(t["P&L"] || 0);
    equityCurve.push({ date: t["Sell Date"] || todayIST(), value: parseFloat(running.toFixed(2)) });
  }

  const sharpe = sharpeRatio(returns);
  const maxDD  = maxDrawdown(equityCurve.map((e) => e.value));

  // Unrealised P&L from open positions (Highest Price as last-known CMP proxy)
  const unrealizedPnL = openRows.reduce((sum, r) => {
    const bp  = parseFloat(r["Buy Price"] || 0);
    const hp  = parseFloat(r["Highest Price"] || bp);
    const qty = parseInt(r["Quantity"] || 0);
    return sum + (hp - bp) * qty;
  }, 0);

  // Current value = available cash + deployed capital + unrealized P&L
  const currentValue = parseFloat((wallet.availableCash + wallet.deployedCapital + unrealizedPnL).toFixed(2));

  const metrics = {
    strategyId,
    startCapital,
    availableCash:   parseFloat(wallet.availableCash.toFixed(2)),
    deployedCapital: parseFloat(wallet.deployedCapital.toFixed(2)),
    realizedPnL:     parseFloat(wallet.realizedPnL.toFixed(2)),
    unrealizedPnL:   parseFloat(unrealizedPnL.toFixed(2)),
    currentValue,
    totalPnL:        parseFloat(totalPnL.toFixed(2)),
    pnlPct:          parseFloat(((currentValue - startCapital) / startCapital * 100).toFixed(2)),
    winRate,
    totalTrades,
    openPositions:   openRows.length,
    sharpeRatio:     sharpe,
    maxDrawdown:     maxDD,
    avgHoldDays:     avgHold,
    equityCurve,
    updatedAt:       new Date().toISOString(),
  };

  await putJSON(metricsKey(strategyId), metrics);
  return metrics;
}

/**
 * Get cached metrics for a strategy (does not recalculate).
 */
export async function getMetrics(strategyId) {
  return getJSON(metricsKey(strategyId));
}

/**
 * Get full paper trade history for a strategy.
 */
export async function getPaperTrades(strategyId) {
  return getExcel(tradesKey(strategyId));
}

/**
 * Get wallet state with computed unrealizedPnL from open positions.
 * Re-exported from paper-wallet for convenience.
 */
export { getWallet, getWalletView, resetWallet, setStartingCapital } from "./paper-wallet";
