// lib/kite.js — Zerodha KiteConnect helper using Cloudflare KV for token storage

import { KiteConnect } from "kiteconnect";
import { getKiteToken, setKiteToken } from "./kv";
import { sendTelegram } from "./telegram";

// Return Zerodha OAuth login URL
export function getLoginUrl() {
  const kite = new KiteConnect({ api_key: process.env.ZERODHA_API_KEY });
  return kite.getLoginURL();
}

// Exchange request_token → access_token, save to KV
export async function generateSession(requestToken) {
  const kite = new KiteConnect({ api_key: process.env.ZERODHA_API_KEY });
  const session = await kite.generateSession(requestToken, process.env.ZERODHA_API_SECRET);
  const tokenData = {
    api_key: process.env.ZERODHA_API_KEY,
    access_token: session.access_token,
    user_id: session.user_id,
    user_name: session.user_name,
    timestamp: new Date().toISOString(),
  };
  await setKiteToken(tokenData);
  await sendTelegram(
    `✅ *Zerodha Login Successful*\nUser: ${session.user_name} (${session.user_id})\nTime: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
  );
  return tokenData;
}

// Get an authenticated KiteConnect instance from KV token
export async function getKite() {
  const tokenData = await getKiteToken();
  if (!tokenData) throw new Error("NO_TOKEN: Login required");
  const kite = new KiteConnect({ api_key: tokenData.api_key });
  kite.setAccessToken(tokenData.access_token);
  return kite;
}

// Get token validity status
export async function getTokenStatus() {
  try {
    const tokenData = await getKiteToken();
    if (!tokenData) return { valid: false, reason: "No token found" };
    const kite = new KiteConnect({ api_key: tokenData.api_key });
    kite.setAccessToken(tokenData.access_token);
    const profile = await kite.getProfile();
    return {
      valid: true,
      user_id: profile.user_id,
      user_name: profile.user_name,
      timestamp: tokenData.timestamp,
    };
  } catch (e) {
    return { valid: false, reason: e.message };
  }
}

// Safe wrapper — catches token errors
export async function safeKiteCall(kite, fn) {
  try {
    return await fn(kite);
  } catch (e) {
    if (e.message?.includes("TokenException") || e.message?.toLowerCase().includes("access_token")) {
      throw new Error("KITE_TOKEN_EXPIRED");
    }
    throw e;
  }
}
