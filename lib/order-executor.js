// lib/order-executor.js — Live order execution wrapper for Kite API.
// Handles BUY/SELL MARKET/LIMIT orders with logging and Telegram notifications.
// Only called when a strategy is in "live" mode.

import { getExcel, putExcel } from "./r2";
import { sendTelegram } from "./telegram";
import { todayIST } from "./market";

const ORDER_LOG_FILE = "order_log.xlsx";

/**
 * Place a live order via Kite API.
 * @param {import('kiteconnect').KiteConnect} kite
 * @param {object} params
 * @param {string}  params.symbol      - NSE symbol e.g. "RELIANCE"
 * @param {number}  params.qty
 * @param {"BUY"|"SELL"} params.side
 * @param {"MARKET"|"LIMIT"} params.type
 * @param {number}  [params.limitPrice] - required if type === "LIMIT"
 * @param {string}  [params.strategyId]
 * @returns {Promise<{orderId: string, status: string}>}
 */
export async function executeOrder(kite, params) {
  const { symbol, qty, side, type = "MARKET", limitPrice, strategyId = "manual" } = params;
  const clean = symbol.replace(".NS", "").toUpperCase();

  const orderParams = {
    exchange:          "NSE",
    tradingsymbol:     clean,
    transaction_type:  side,           // "BUY" | "SELL"
    quantity:          qty,
    product:           "CNC",          // Cash and Carry (delivery)
    order_type:        type,           // "MARKET" | "LIMIT"
    validity:          "DAY",
    tag:               strategyId.slice(0, 8), // Kite tag max 8 chars
  };

  if (type === "LIMIT" && limitPrice) {
    orderParams.price = limitPrice;
  }

  let orderId = null;
  let status  = "PLACED";
  let errorMsg = null;

  try {
    const response = await kite.placeOrder("regular", orderParams);
    orderId = response.order_id;
  } catch (e) {
    status   = "FAILED";
    errorMsg = e.message;
    console.error(`[order-executor] ${side} ${clean} ×${qty} FAILED:`, e.message);
  }

  // Log to R2
  await logOrder({
    orderId,
    symbol:     clean,
    side,
    type,
    qty,
    limitPrice: limitPrice || null,
    status,
    error:      errorMsg,
    strategyId,
    date:       todayIST(),
    ts:         new Date().toISOString(),
  });

  // Telegram notification
  const emoji  = side === "BUY" ? "📈" : "📉";
  const statusIcon = status === "PLACED" ? "✅" : "❌";
  await sendTelegram(
    `${statusIcon} *Order ${status}*\n` +
    `${emoji} ${side} ${clean} ×${qty} @ ${type}${limitPrice ? " ₹" + limitPrice : ""}\n` +
    `Strategy: ${strategyId}\n` +
    (orderId ? `Order ID: ${orderId}` : `Error: ${errorMsg}`)
  );

  if (status === "FAILED") {
    throw new Error(`Order failed for ${clean}: ${errorMsg}`);
  }

  return { orderId, status };
}

/**
 * Append an order record to the order log Excel file on R2.
 */
async function logOrder(record) {
  try {
    const rows = await getExcel(ORDER_LOG_FILE);
    rows.push(record);
    await putExcel(ORDER_LOG_FILE, rows);
  } catch (e) {
    console.error("[order-executor] log error:", e.message);
  }
}

/**
 * Get today's orders from the log file.
 */
export async function getTodayOrders() {
  const today = todayIST();
  const rows  = await getExcel(ORDER_LOG_FILE);
  return rows.filter((r) => r["date"] === today);
}

/**
 * Get all logged orders (all time).
 */
export async function getAllOrders() {
  return getExcel(ORDER_LOG_FILE);
}

/**
 * Emergency stop: place MARKET SELL for all provided positions.
 * @param {import('kiteconnect').KiteConnect} kite
 * @param {Array<{symbol: string, qty: number}>} positions
 */
export async function emergencyCloseAll(kite, positions) {
  const results = [];
  for (const pos of positions) {
    try {
      const r = await executeOrder(kite, {
        symbol: pos.symbol,
        qty:    pos.qty,
        side:   "SELL",
        type:   "MARKET",
        strategyId: "emergency",
      });
      results.push({ ...pos, ...r });
    } catch (e) {
      results.push({ ...pos, status: "FAILED", error: e.message });
    }
  }
  return results;
}
