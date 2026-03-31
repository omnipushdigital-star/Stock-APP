import { kvGet, kvPut } from "../../../lib/kv";
export default async function handler(req, res) {
  const cfConfigured = !!(process.env.CF_R2_ACCOUNT_ID && process.env.CF_KV_NAMESPACE_ID && process.env.CF_KV_API_TOKEN);
  
  // Try writing then reading
  await kvPut("test_key", { hello: "world", ts: Date.now() });
  const readBack = await kvGet("test_key");
  const token = await kvGet("kite_access_token");
  
  res.json({
    cf_configured: cfConfigured,
    cf_account_id: process.env.CF_R2_ACCOUNT_ID || "(empty)",
    cf_kv_id: process.env.CF_KV_NAMESPACE_ID || "(empty)",
    cf_kv_token: process.env.CF_KV_API_TOKEN || "(empty)",
    write_read_test: readBack,
    kite_token_found: !!token,
    kite_user: token?.user_id || null,
  });
}
