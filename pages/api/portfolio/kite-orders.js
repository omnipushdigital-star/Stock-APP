// pages/api/portfolio/kite-orders.js
// GET → today's orders from Zerodha Kite API (real live orders)
// Returns order book with status, fills, and P&L details

import { getKite } from "../../../lib/kite";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    const kite   = await getKite();
    const orders = await kite.getOrders();

    const mapped = (orders || []).map((o) => ({
      orderId:         o.order_id,
      parentOrderId:   o.parent_order_id || null,
      symbol:          o.tradingsymbol,
      exchange:        o.exchange,
      side:            o.transaction_type,        // "BUY" | "SELL"
      orderType:       o.order_type,              // "MARKET" | "LIMIT" | "SL" | "SL-M"
      product:         o.product,                 // "CNC" | "MIS" | "NRML"
      qty:             o.quantity,
      filledQty:       o.filled_quantity,
      pendingQty:      o.pending_quantity,
      price:           o.price || 0,
      avgPrice:        o.average_price || 0,
      triggerPrice:    o.trigger_price || 0,
      status:          o.status,                  // "COMPLETE" | "REJECTED" | "CANCELLED" | "OPEN" | "TRIGGER PENDING"
      statusMessage:   o.status_message || null,
      validity:        o.validity,
      tag:             o.tag || null,
      placedAt:        o.order_timestamp,
      exchangeTime:    o.exchange_update_timestamp,
      variety:         o.variety,
    }));

    // Sort newest first
    mapped.sort((a, b) => new Date(b.placedAt || 0) - new Date(a.placedAt || 0));

    res.json({ ok: true, orders: mapped, count: mapped.length });
  } catch (e) {
    // If token expired or not logged in, return empty rather than 500
    if (e.message?.includes("NO_TOKEN") || e.message?.includes("KITE_TOKEN_EXPIRED")) {
      return res.json({ ok: false, orders: [], error: "Kite token not available — please login" });
    }
    res.status(500).json({ error: e.message });
  }
}
