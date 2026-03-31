// lib/telegram.js — Telegram bot notifications

export async function sendTelegram(message, parseMode = "Markdown") {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: parseMode }),
    });
    return res.json();
  } catch (e) {
    console.error("Telegram send failed:", e.message);
  }
}
