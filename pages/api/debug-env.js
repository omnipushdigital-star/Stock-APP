export default function handler(req, res) {
  res.json({
    api_key: process.env.ZERODHA_API_KEY,
    api_secret_length: process.env.ZERODHA_API_SECRET?.length,
    api_secret_first6: process.env.ZERODHA_API_SECRET?.slice(0,6),
    user_id: process.env.ZERODHA_USER_ID,
  });
}
