import fs from "fs";
import path from "path";

const CF_CONFIGURED = process.env.CF_R2_ACCOUNT_ID && process.env.CF_KV_NAMESPACE_ID && process.env.CF_KV_API_TOKEN;
const LOCAL_KV_FILE = path.join(process.cwd(), ".kv-store.json");

function localRead() {
  try { return JSON.parse(fs.readFileSync(LOCAL_KV_FILE, "utf-8")); } catch { return {}; }
}
function localWrite(data) {
  fs.writeFileSync(LOCAL_KV_FILE, JSON.stringify(data, null, 2));
}

export async function kvGet(key) {
  if (!CF_CONFIGURED) { return localRead()[key] ?? null; }
  const BASE = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_R2_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}`;
  const H = { Authorization: `Bearer ${process.env.CF_KV_API_TOKEN}`, "Content-Type": "application/json" };
  const res = await fetch(`${BASE}/values/${encodeURIComponent(key)}`, { headers: H });
  if (res.status === 404) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

export async function kvPut(key, value, ttlSeconds = null) {
  if (!CF_CONFIGURED) { const s = localRead(); s[key] = value; localWrite(s); return; }
  const BASE = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_R2_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}`;
  const H = { Authorization: `Bearer ${process.env.CF_KV_API_TOKEN}`, "Content-Type": "application/json" };
  const url = new URL(`${BASE}/values/${encodeURIComponent(key)}`);
  if (ttlSeconds) url.searchParams.set("expiration_ttl", ttlSeconds);
  await fetch(url.toString(), { method: "PUT", headers: H, body: typeof value === "string" ? value : JSON.stringify(value) });
}

export async function kvDelete(key) {
  if (!CF_CONFIGURED) { const s = localRead(); delete s[key]; localWrite(s); return; }
  const BASE = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_R2_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}`;
  const H = { Authorization: `Bearer ${process.env.CF_KV_API_TOKEN}`, "Content-Type": "application/json" };
  await fetch(`${BASE}/values/${encodeURIComponent(key)}`, { method: "DELETE", headers: H });
}

export async function getKiteToken() { return kvGet("kite_access_token"); }
export async function setKiteToken(tokenData) { return kvPut("kite_access_token", tokenData, 86400); }
export async function getCronState(cronName) { return kvGet(`cron_state_${cronName}`) || { enabled: true, lastRun: null, lastStatus: null }; }
export async function setCronState(cronName, state) { return kvPut(`cron_state_${cronName}`, state); }
export async function appendLog(key, entry) {
  const existing = await kvGet(key) || [];
  const log = Array.isArray(existing) ? existing : [];
  log.unshift({ ...entry, ts: new Date().toISOString() });
  return kvPut(key, log.slice(0, 200));
}
export async function getLog(key) { const log = await kvGet(key); return Array.isArray(log) ? log : []; }
