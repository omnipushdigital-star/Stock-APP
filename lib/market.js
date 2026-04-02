// lib/market.js — IST market timing helpers

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function nowIST() {
  return new Date(Date.now() + new Date().getTimezoneOffset() * 60000 + IST_OFFSET_MS);
}

export function todayIST() {
  return nowIST().toISOString().split("T")[0];
}

const HOLIDAYS = new Set([
  "2025-02-26","2025-03-14","2025-03-31","2025-04-10","2025-04-14",
  "2025-04-18","2025-05-01","2025-08-15","2025-08-27","2025-10-02",
  "2025-10-21","2025-10-22","2025-11-05","2025-12-25",
  "2026-01-26","2026-03-19","2026-04-14","2026-05-01",
  "2026-08-15","2026-10-02","2026-11-14","2026-12-25",
]);

export function isMarketOpen() {
  const now = nowIST();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  if (HOLIDAYS.has(todayIST())) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= 555 && mins <= 930; // 9:15 to 15:30
}

export function isTradingDay() {
  const now = nowIST();
  const day = now.getDay();
  return day !== 0 && day !== 6 && !HOLIDAYS.has(todayIST());
}

export function istTimeString() {
  return nowIST().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
