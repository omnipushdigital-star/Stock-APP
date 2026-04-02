import { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

// ─── Helpers ────────────────────────────────────────────────
const fmt = (n, dec = 2) => n == null ? "—" : Number(n).toFixed(dec);
const fmtINR = (n) => n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const cls = (...args) => args.filter(Boolean).join(" ");

function PnlBadge({ val }) {
  const n = parseFloat(val);
  if (isNaN(n)) return <span style={{ color: "var(--text2)" }}>—</span>;
  const color = n >= 0 ? "var(--green)" : "var(--red)";
  return <span style={{ color, fontFamily: "var(--font-mono)", fontWeight: 600 }}>{n >= 0 ? "+" : ""}{fmt(n)}%</span>;
}

function StatusDot({ ok }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: ok ? "var(--green)" : "var(--red)",
      boxShadow: ok ? "0 0 6px var(--green)" : "0 0 6px var(--red)",
      animation: ok ? "pulse-green 2s infinite" : "none",
      flexShrink: 0,
    }} />
  );
}

function Spinner() {
  return <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid var(--border2)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />;
}

function Card({ title, children, action, style }) {
  return (
    <div style={{
      background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 10,
      overflow: "hidden", ...style
    }}>
      {title && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          background: "var(--bg2)",
        }}>
          <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: "0.04em", color: "var(--text2)", textTransform: "uppercase" }}>{title}</span>
          {action}
        </div>
      )}
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function Badge({ children, type = "default" }) {
  const colors = {
    default: ["var(--bg3)", "var(--text2)"],
    green:   ["rgba(0,229,153,.12)", "var(--green)"],
    red:     ["rgba(255,71,87,.12)", "var(--red)"],
    yellow:  ["rgba(255,211,42,.12)", "var(--yellow)"],
    blue:    ["rgba(0,170,255,.12)", "var(--blue)"],
  };
  const [bg, color] = colors[type] || colors.default;
  return (
    <span style={{
      background: bg, color, borderRadius: 4, padding: "2px 8px",
      fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)", letterSpacing: "0.03em",
    }}>{children}</span>
  );
}

function LogicPanel({ logic }) {
  if (!logic) return null;
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px", background: "rgba(124,131,253,.04)", fontSize: 12 }}>
      {logic.buy?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: "var(--green)", marginBottom: 5, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>▲ Buy Conditions</div>
          {logic.buy.map((c, i) => (
            <div key={i} style={{ color: "var(--text2)", padding: "2px 0 2px 10px", borderLeft: "2px solid rgba(0,229,153,.3)" }}>{c}</div>
          ))}
        </div>
      )}
      {logic.sell?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: "var(--red)", marginBottom: 5, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>▼ Sell / Exit Conditions</div>
          {logic.sell.map((c, i) => (
            <div key={i} style={{ color: "var(--text2)", padding: "2px 0 2px 10px", borderLeft: "2px solid rgba(255,71,87,.3)" }}>{c}</div>
          ))}
        </div>
      )}
      {logic.config && Object.keys(logic.config).length > 0 && (
        <div>
          <div style={{ fontWeight: 700, color: "var(--blue)", marginBottom: 5, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>⚙ Parameters</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
            {Object.entries(logic.config).map(([k, v]) => (
              <span key={k} style={{ color: "var(--text3)" }}><span style={{ color: "var(--text2)", fontWeight: 600 }}>{k}:</span> {v}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <label style={{ position: "relative", display: "inline-block", width: 36, height: 20, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} style={{ opacity: 0, width: 0, height: 0 }} />
      <span style={{
        position: "absolute", inset: 0, borderRadius: 10,
        background: checked ? "var(--green)" : "var(--bg3)",
        transition: "background 0.2s",
        border: "1px solid var(--border2)",
      }}>
        <span style={{
          position: "absolute", top: 2, left: checked ? 18 : 2, width: 14, height: 14,
          borderRadius: "50%", background: checked ? "var(--bg)" : "var(--text3)",
          transition: "left 0.2s",
        }} />
      </span>
    </label>
  );
}

// ─── Sections ───────────────────────────────────────────────

function TokenPanel({ token, onRefresh }) {
  const [loginUrl, setLoginUrl] = useState("");
  const [requestToken, setRequestToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function openZerodhaLogin() {
    try {
      const r = await fetch("/api/auth/login-url");
      const d = await r.json();
      setLoginUrl(d.url);
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch(e) {
      setMsg("❌ Could not get login URL");
    }
  }

  // Extract request_token from full URL or use raw token
  function extractToken(raw) {
    const s = raw.trim();
    try {
      const url = new URL(s);
      const t = url.searchParams.get("request_token");
      if (t) return t;
    } catch {}
    return s;
  }

  async function submitToken(rawValue) {
    const val = rawValue ?? requestToken;
    const extracted = extractToken(val);
    if (!extracted) return;
    setLoading(true); setMsg("");
    try {
      const r = await fetch("/api/auth/set-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestToken: extracted }),
      });
      const d = await r.json();
      if (d.ok) { setMsg(`✅ Logged in as ${d.user_name} (${d.user_id})`); setRequestToken(""); onRefresh(); }
      else setMsg(`❌ ${d.error}`);
    } catch (e) { setMsg("❌ Request failed: " + e.message); }
    setLoading(false);
  }

  // Auto-submit when user pastes a full Zerodha redirect URL
  function handlePaste(e) {
    const pasted = e.clipboardData.getData("text");
    if (pasted.includes("request_token=")) {
      e.preventDefault();
      const extracted = extractToken(pasted);
      setRequestToken(extracted);
      setMsg("⏳ Token extracted — submitting…");
      submitToken(pasted);
    }
  }

  return (
    <Card title="Zerodha Token" action={
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <StatusDot ok={token?.valid} />
        <span style={{ fontSize: 12, color: token?.valid ? "var(--green)" : "var(--red)" }}>
          {token?.valid ? `${token.user_name} (${token.user_id})` : "Not logged in"}
        </span>
      </div>
    }>
      {token?.valid ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span style={{ color: "var(--text2)", fontSize: 12 }}>User ID: <span className="mono" style={{ color: "var(--text)" }}>{token.user_id}</span></span>
            <span style={{ color: "var(--text2)", fontSize: 12 }}>Token set: <span className="mono" style={{ color: "var(--text)" }}>{token.timestamp ? new Date(token.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</span></span>
          </div>
          <p style={{ color: "var(--text2)", fontSize: 12 }}>Token is valid. Refresh every morning before market open.</p>
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ padding: "10px 14px", background: "rgba(255,211,42,0.06)", border: "1px solid rgba(255,211,42,0.2)", borderRadius: 8, fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
          <strong style={{ color: "var(--yellow)" }}>Daily login flow:</strong><br />
          1. Click <strong style={{ color: "var(--accent)" }}>"Open Zerodha Login ↗"</strong> — opens Kite in a new tab<br />
          2. Enter your <strong style={{ color: "var(--text)" }}>User ID + Password + TOTP</strong> from your authenticator app<br />
          3. Zerodha automatically redirects back here — token is saved instantly ✅
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={openZerodhaLogin} style={btnStyle("green")}>
            🔑 Open Zerodha Login ↗
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={requestToken}
            onChange={(e) => setRequestToken(e.target.value)}
            onPaste={handlePaste}
            placeholder="Paste full redirect URL or raw request_token…"
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12 }}
            onKeyDown={(e) => e.key === "Enter" && submitToken()}
          />
          <button onClick={() => submitToken()} disabled={loading || !requestToken} style={btnStyle("accent")}>
            {loading ? <Spinner /> : "Set Token"}
          </button>
        </div>
        {msg && <p style={{ fontSize: 12, color: msg.startsWith("✅") ? "var(--green)" : msg.startsWith("⏳") ? "var(--yellow)" : "var(--red)" }}>{msg}</p>}
      </div>
    </Card>
  );
}

function PositionsTable({ positions, loading, isMobile }) {
  if (loading) return <div style={{ textAlign: "center", padding: 32 }}><Spinner /></div>;
  if (!positions?.length) return <p style={{ color: "var(--text3)", fontSize: 13, textAlign: "center", padding: 24 }}>No open positions</p>;
  const th = mThStyle(isMobile);
  const td = mTdStyle(isMobile);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>{["Symbol","Buy Date","Buy Price","CMP","P&L %","Qty","ATSL","Status"].map(h => (
            <th key={h} style={th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {positions.map((r, i) => {
            const pnl = parseFloat(r.pnlPct);
            return (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ ...td, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>{(r["Symbol"] || "").replace(".NS", "")}</td>
                <td style={{ ...td, color: "var(--text2)" }}>{r["Buy Date"] || "—"}</td>
                <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{fmtINR(r["Buy Price"])}</td>
                <td style={{ ...td, fontFamily: "var(--font-mono)", color: "var(--blue)" }}>{r.cmp ? fmtINR(r.cmp) : "—"}</td>
                <td style={td}><PnlBadge val={r.pnlPct} /></td>
                <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{r["Qty"] || "—"}</td>
                <td style={{ ...td, fontFamily: "var(--font-mono)", color: "var(--yellow)" }}>{fmtINR(r["ATSL"] || r["Stop Loss"])}</td>
                <td style={td}><Badge type={!isNaN(pnl) && pnl >= 0 ? "green" : "red"}>{!isNaN(pnl) && pnl >= 0 ? "PROFIT" : "LOSS"}</Badge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SignalsLog({ signals, loading, type }) {
  if (loading) return <div style={{ textAlign: "center", padding: 24 }}><Spinner /></div>;
  if (!signals?.length) return <p style={{ color: "var(--text3)", fontSize: 13, textAlign: "center", padding: 20 }}>No signals yet today</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
      {signals.slice(0, 50).map((s, i) => (
        <div key={i} style={{
          display: "flex", gap: 12, alignItems: "flex-start",
          padding: "8px 10px", borderRadius: 6,
          background: type === "buy" ? "rgba(0,229,153,.05)" : "rgba(255,71,87,.05)",
          borderLeft: `3px solid ${type === "buy" ? "var(--green)" : "var(--red)"}`,
          fontSize: 12,
        }}>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, minWidth: 80, color: type === "buy" ? "var(--green)" : "var(--red)" }}>
            {(s.symbol || "").replace(".NS", "")}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--blue)", minWidth: 60 }}>{s.cmp ? fmtINR(s.cmp) : ""}</span>
          {s.pnlPct != null && <PnlBadge val={s.pnlPct} />}
          {s.strike && <span style={{ color: "var(--text2)" }}>Strike: {s.strike}</span>}
          {s.reason && <span style={{ color: "var(--text3)", flexGrow: 1 }}>{s.reason}</span>}
          {s.ts && <span style={{ color: "var(--text3)", marginLeft: "auto", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{new Date(s.ts).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
      ))}
    </div>
  );
}

function TradeHistory({ trades, loading, isMobile }) {
  if (loading) return <div style={{ textAlign: "center", padding: 32 }}><Spinner /></div>;
  if (!trades?.length) return <p style={{ color: "var(--text3)", fontSize: 13, textAlign: "center", padding: 24 }}>No trade history</p>;

  // P&L chart data
  let cumPnl = 0;
  const chartData = trades.slice().reverse().map((t) => {
    const b = parseFloat(t["Buy Price"] || 0);
    const s = parseFloat(t["Sell Price"] || 0);
    const q = parseFloat(t["Qty"] || 1);
    const pnl = b && s ? (s - b) * q : 0;
    cumPnl += pnl;
    return { date: t["Sell Date"] || t["Buy Date"] || "—", pnl: parseFloat(cumPnl.toFixed(0)) };
  });

  const th = mThStyle(isMobile);
  const td = mTdStyle(isMobile);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--green)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--green)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Tooltip
              contentStyle={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
              formatter={(v) => [`₹${v.toLocaleString("en-IN")}`, "Cumulative P&L"]}
            />
            <ReferenceLine y={0} stroke="var(--border2)" strokeDasharray="3 3" />
            <Area type="monotone" dataKey="pnl" stroke="var(--green)" strokeWidth={2} fill="url(#pnlGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>{["Symbol","Buy Date","Buy Price","Sell Date","Sell Price","P&L %","Reason"].map(h => (
              <th key={h} style={th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {trades.slice(0, 100).map((r, i) => {
              const b = parseFloat(r["Buy Price"] || 0);
              const s = parseFloat(r["Sell Price"] || 0);
              const pnlPct = b && s ? ((s - b) / b * 100).toFixed(2) : null;
              return (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...td, fontFamily: "var(--font-mono)", fontWeight: 600 }}>{(r["Symbol"] || "").replace(".NS", "")}</td>
                  <td style={{ ...td, color: "var(--text2)" }}>{r["Buy Date"] || "—"}</td>
                  <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{fmtINR(r["Buy Price"])}</td>
                  <td style={{ ...td, color: "var(--text2)" }}>{r["Sell Date"] || "—"}</td>
                  <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{fmtINR(r["Sell Price"])}</td>
                  <td style={td}><PnlBadge val={pnlPct} /></td>
                  <td style={{ ...td, color: "var(--text3)", fontSize: 11 }}>{r["Sell Reason"] || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CronsPanel({ crons, loading, onToggle }) {
  const labels = {
    "token-health":  { label: "Token Health", desc: "7:00 AM daily — checks Kite token", icon: "🔐" },
    "fno-ohlc":      { label: "FNO OHLC Fetch", desc: "8:00 AM daily — fetch historical data", icon: "📊" },
    "cash-atsl":     { label: "Cash ATSL", desc: "Every minute 9:15–9:30 PM — ATSL strategy", icon: "📈" },
    "buy-signals":   { label: "Buy Signals", desc: "Every 3 min 9:15–3:30 PM — scan signals", icon: "🟢" },
    "sell-tracker":  { label: "Sell Tracker", desc: "Every 3 min 9:15–3:30 PM — track exits", icon: "🔴" },
    "eod-summary":   { label: "EOD Summary", desc: "3:35 PM — send Telegram summary", icon: "📋" },
  };

  if (loading) return <div style={{ textAlign: "center", padding: 32 }}><Spinner /></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {crons.map((c) => {
        const info = labels[c.name] || { label: c.name, desc: "", icon: "⚙️" };
        const statusColor = c.lastStatus === "ok" ? "var(--green)" : c.lastStatus === "error" ? "var(--red)" : "var(--text3)";
        return (
          <div key={c.name} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
            borderRadius: 8, background: "var(--bg2)", border: "1px solid var(--border)",
          }}>
            <span style={{ fontSize: 16 }}>{info.icon}</span>
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{info.label}</div>
              <div style={{ color: "var(--text3)", fontSize: 11 }}>{info.desc}</div>
              {c.lastRun && (
                <div style={{ color: statusColor, fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 2 }}>
                  Last: {new Date(c.lastRun).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} — {c.lastStatus || "—"}
                </div>
              )}
            </div>
            <Toggle checked={!!c.enabled} onChange={(e) => onToggle(c.name, e.target.checked)} />
          </div>
        );
      })}
    </div>
  );
}

function TelegramLog({ messages, loading }) {
  if (loading) return <div style={{ textAlign: "center", padding: 24 }}><Spinner /></div>;
  if (!messages?.length) return <p style={{ color: "var(--text3)", fontSize: 13, textAlign: "center", padding: 20 }}>No Telegram messages logged</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
      {messages.slice(0, 60).map((m, i) => (
        <div key={i} style={{
          padding: "8px 12px", borderRadius: 6, background: "var(--bg2)",
          border: "1px solid var(--border)", fontSize: 12, display: "flex", gap: 10,
        }}>
          <span style={{ color: "var(--text3)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", fontSize: 11 }}>
            {m.ts ? new Date(m.ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }) : "—"}
          </span>
          <span style={{ color: "var(--blue)", minWidth: 80, fontWeight: 600 }}>{m.type || "—"}</span>
          <span style={{ color: "var(--text2)", flexGrow: 1 }}>
            {m.user_name || m.symbol || m.reason || m.date || JSON.stringify(m).slice(0, 80)}
          </span>
          {m.pnl != null && <span style={{ fontFamily: "var(--font-mono)", color: m.pnl >= 0 ? "var(--green)" : "var(--red)" }}>₹{m.pnl?.toFixed(0)}</span>}
        </div>
      ))}
    </div>
  );
}


// ─── ATSL Tracker Component ──────────────────────────────────
function ATSLTracker({ positions, loading }) {
  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;
  if (!positions || positions.length === 0) return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
      No open positions. Positions appear here after Zerodha login and ATSL buys.
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {positions.map((p, i) => {
        const buyPrice = parseFloat(p["Buy Price"] || p.buyPrice || 0);
        const cmp = parseFloat(p.cmp || 0);
        const atslPct = 0.07; // 7% trailing stop loss
        const atslLevel = buyPrice * (1 - atslPct);
        const highPrice = parseFloat(p["High Price"] || cmp || buyPrice);
        const trailingATSL = highPrice * (1 - atslPct);
        const effectiveATSL = Math.max(atslLevel, trailingATSL);
        const pnlPct = cmp && buyPrice ? ((cmp - buyPrice) / buyPrice * 100) : null;
        const distToATSL = cmp ? ((cmp - effectiveATSL) / cmp * 100) : null;
        const atRisk = distToATSL !== null && distToATSL < 3;
        const sym = (p["Symbol"] || p.symbol || "—").replace(".NS", "");

        return (
          <div key={i} style={{
            background: "var(--bg1)", border: `1px solid ${atRisk ? "rgba(255,77,106,0.4)" : "var(--border)"}`,
            borderRadius: 10, padding: "16px 20px",
            boxShadow: atRisk ? "0 0 12px rgba(255,77,106,0.15)" : "none",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              {/* Left: Symbol + dates */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text)" }}>{sym}</span>
                  {atRisk && <span style={{ background: "var(--red-dim)", color: "var(--red)", border: "1px solid rgba(255,77,106,0.3)", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>⚠ NEAR ATSL</span>}
                </div>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>
                  Buy: {p["Buy Date"] || "—"} · Reason: {p["Reason"] || "ATSL"}
                </span>
              </div>
              {/* Right: P&L */}
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: pnlPct === null ? "var(--text2)" : pnlPct >= 0 ? "var(--green)" : "var(--red)" }}>
                  {pnlPct === null ? "—" : `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`}
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>unrealised P&L</div>
              </div>
            </div>

            {/* Price bar */}
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                { label: "Buy Price", value: buyPrice ? `₹${buyPrice.toFixed(2)}` : "—", color: "var(--text2)" },
                { label: "CMP", value: cmp ? `₹${cmp.toFixed(2)}` : "—", color: "var(--text)" },
                { label: "ATSL Level", value: `₹${effectiveATSL.toFixed(2)}`, color: atRisk ? "var(--red)" : "var(--yellow)" },
                { label: "Distance to ATSL", value: distToATSL !== null ? `${distToATSL.toFixed(2)}%` : "—", color: atRisk ? "var(--red)" : "var(--green)" },
              ].map((item, j) => (
                <div key={j} style={{ background: "var(--bg2)", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10, color: "var(--text3)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "var(--font-mono)", color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* ATSL progress bar */}
            {cmp && buyPrice ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>
                  <span>ATSL ₹{effectiveATSL.toFixed(2)}</span>
                  <span>CMP ₹{cmp.toFixed(2)}</span>
                </div>
                <div style={{ height: 6, background: "var(--bg3)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    width: `${Math.min(100, Math.max(0, distToATSL * 5))}%`,
                    background: atRisk ? "var(--red)" : distToATSL < 8 ? "var(--yellow)" : "var(--green)",
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── P&L Calendar Component ───────────────────────────────────
function PnLCalendar({ trades }) {
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return { month: now.getMonth(), year: now.getFullYear() };
  });

  // Build daily P&L map from trades
  const dailyPnL = {};
  (trades || []).forEach(t => {
    const sellDate = t["Sell Date"] || t.sellDate;
    if (!sellDate) return;
    const dateStr = String(sellDate).split("T")[0].split(" ")[0];
    const bp = parseFloat(t["Buy Price"] || t.buyPrice || 0);
    const sp = parseFloat(t["Sell Price"] || t.sellPrice || 0);
    const qty = parseFloat(t["Quantity"] || t["Qty"] || t.qty || 1);
    if (!bp || !sp) return;
    const pnl = (sp - bp) * qty;
    dailyPnL[dateStr] = (dailyPnL[dateStr] || 0) + pnl;
  });

  const pnlData = dailyPnL;

  const { month, year } = viewDate;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = new Date(year, month).toLocaleString("en-IN", { month: "long", year: "numeric" });

  const totalPnL = Object.values(pnlData).reduce((a, b) => a + b, 0);
  const tradingDays = Object.values(pnlData);
  const winDays = tradingDays.filter(v => v > 0).length;
  const lossDays = tradingDays.filter(v => v < 0).length;
  const bestDay = tradingDays.length ? Math.max(...tradingDays, 0) : 0;
  const worstDay = tradingDays.length ? Math.min(...tradingDays, 0) : 0;

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {[
          { label: "Month P&L", value: `${totalPnL >= 0 ? "+" : ""}₹${Math.abs(totalPnL).toLocaleString("en-IN")}`, color: totalPnL >= 0 ? "var(--green)" : "var(--red)" },
          { label: "Win Days", value: winDays, color: "var(--green)" },
          { label: "Loss Days", value: lossDays, color: "var(--red)" },
          { label: "Best Day", value: `+₹${bestDay.toLocaleString("en-IN")}`, color: "var(--green)" },
          { label: "Worst Day", value: `-₹${Math.abs(worstDay).toLocaleString("en-IN")}`, color: "var(--red)" },
        ].map((s, i) => (
          <div key={i} style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "var(--text3)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-mono)", color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
          <button onClick={() => setViewDate(v => {
            const d = new Date(v.year, v.month - 1);
            return { month: d.getMonth(), year: d.getFullYear() };
          })} style={{ ...btnStyle("default"), padding: "4px 12px" }}>← Prev</button>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", fontFamily: "var(--font-display)" }}>{monthName}</span>
          <button onClick={() => setViewDate(v => {
            const d = new Date(v.year, v.month + 1);
            return { month: d.getMonth(), year: d.getFullYear() };
          })} style={{ ...btnStyle("default"), padding: "4px 12px" }}>Next →</button>
        </div>

        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border)" }}>
          {days.map(d => (
            <div key={d} style={{ padding: "8px 4px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--text3)", letterSpacing: "0.05em" }}>{d}</div>
          ))}
        </div>

        {/* Calendar cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {cells.map((day, i) => {
            if (!day) return <div key={i} style={{ minHeight: 72, borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const pnl = pnlData[dateStr];
            const isToday = dateStr === new Date().toISOString().split("T")[0];
            const isWeekend = new Date(year, month, day).getDay() === 0 || new Date(year, month, day).getDay() === 6;

            return (
              <div key={i} style={{
                minHeight: 72, padding: "8px 10px",
                borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
                background: isToday ? "rgba(0,229,160,0.06)" : isWeekend ? "rgba(0,0,0,0.15)" : "transparent",
                position: "relative",
              }}>
                <div style={{
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  color: isToday ? "var(--accent)" : isWeekend ? "var(--text3)" : "var(--text2)",
                  marginBottom: 4,
                }}>{day}</div>
                {pnl !== undefined && !isWeekend && (
                  <div style={{
                    fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)",
                    color: pnl >= 0 ? "var(--green)" : "var(--red)",
                    background: pnl >= 0 ? "rgba(0,229,160,0.1)" : "rgba(255,77,106,0.1)",
                    borderRadius: 4, padding: "2px 4px", display: "inline-block",
                  }}>
                    {pnl >= 0 ? "+" : ""}₹{Math.abs(pnl).toLocaleString("en-IN")}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {Object.keys(pnlData).length === 0 && (
          <div style={{ padding: "10px 16px", background: "rgba(255,211,42,0.05)", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text3)" }}>
            No closed trades yet — P&L will appear here once trades are recorded in your Excel files on Cloudflare R2
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Style helpers ───────────────────────────────────────────
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const thStyle = { textAlign: "left", padding: "8px 12px", color: "var(--text3)", fontWeight: 600, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const tdStyle  = { padding: "8px 12px", color: "var(--text)", whiteSpace: "nowrap" };
// Mobile-aware style helpers (takes isMobile param)
const mThStyle = (isMobile) => ({ ...thStyle, fontSize: isMobile ? 10 : 11, padding: isMobile ? "6px 8px" : "8px 12px" });
const mTdStyle = (isMobile) => ({ ...tdStyle, fontSize: isMobile ? 11 : 13, padding: isMobile ? "6px 8px" : "8px 12px" });
const inputStyle = {
  flex: 1, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6,
  color: "var(--text)", padding: "8px 12px", fontSize: 13, fontFamily: "var(--font-mono)",
  outline: "none", minWidth: 0,
};
const btnStyle = (type) => ({
  background: type === "accent" ? "var(--green)" : type === "blue" ? "var(--blue2)" : type === "green" ? "rgba(0,229,153,.15)" : "var(--bg3)",
  color: type === "accent" ? "var(--bg)" : type === "blue" ? "#fff" : type === "green" ? "var(--green)" : "var(--text)",
  border: `1px solid ${type === "green" ? "var(--green2)" : type === "blue" ? "var(--blue2)" : "var(--border2)"}`,
  borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6, transition: "opacity 0.15s",
  opacity: 1, whiteSpace: "nowrap",
});

// ─── Main Dashboard ──────────────────────────────────────────
const TABS = ["Positions", "ATSL Tracker", "P&L", "Signals", "History", "Lab", "Orders", "Engine", "Crons", "Telegram", "Screener"];

// Logic summaries shown when a job/strategy card is clicked
const ENGINE_LOGIC = {
  "sell-check": {
    title: "Sell Tracker — Logic",
    buy: [],
    sell: [
      "Adaptive TSL activates when profit ≥ 1%",
      "TSL buffer: 0.5% (P&L <2%), 0.4% (<5%), 0.3% (<10%), 0.2% (≥10%)",
      "Stop = max(highestPrice × (1−buffer), buyPrice × 1.01)",
      "Max hold: 7 days → force sell",
      "After 3:15 PM: sell if CMP < 6EMA",
    ],
    config: { "Universe": "Open ATSL positions (Excel)", "Frequency": "Every 5 min via Cloudflare / 30s autopilot", "Orders": "Live market sell via Kite" },
  },
  "buy-signals": {
    title: "Buy Signal Scan — Logic",
    buy: [
      "C1: prev day open < 6EMA  (was below EMA)",
      "C2: prev day close < 6EMA  (confirmed below)",
      "C3: CMP > 6EMA × 1.002  (crossed above with buffer)",
      "NIFTY 50 must also be above its own 6EMA",
      "Signals saved to R2 — orders placed later by ATSL Buy/Close",
    ],
    sell: [],
    config: { "Universe": "Nifty 200", "EMA period": "6", "Frequency": "Every 30 min via Cloudflare / 3 min autopilot", "Output": "buy_signals_today.json in R2" },
  },
  "atsl-update": {
    title: "ATSL Buy/Close — Logic",
    buy: [
      "Window: 3:15–3:25 PM IST",
      "Reads today's signals from R2 (buy_signals_today.json)",
      "Buys top 3 signals not already held today",
      "Position size: ₹10,000 per trade (₹1L wallet ÷ 10)",
      "Initial stop set at CMP × 0.97 (3% below buy)",
    ],
    sell: [
      "Window: after 3:25 PM IST",
      "Force-closes ALL open positions at market price (EOD)",
    ],
    config: { "Universe": "From pre-scanned signals", "Buy window": "3:15–3:25 PM", "Close window": "After 3:25 PM", "Max buys": "3 per day", "Orders": "Live market via Kite" },
  },
  "eod-summary": {
    title: "EOD Summary — Logic",
    buy: [],
    sell: [],
    config: { "Runs at": "3:35 PM IST", "Action": "Calculates today's closed P&L, sends Telegram summary", "Flag": "Sets eod_done flag to prevent double-send", "Output": "Telegram message with winners/losers/total P&L" },
  },
  "token-health": {
    title: "Token Health — Logic",
    buy: [],
    sell: [],
    config: { "Runs at": "8:30 AM IST", "Action": "Validates Kite access token, sends Telegram reminder if expired", "Alert": "Includes login URL if token is invalid" },
  },
};

const STRATEGY_LOGIC = {
  "cash-atsl-v1": {
    buy: ["C1: prev open < 6EMA", "C2: prev close < 6EMA", "C3: CMP > 6EMA × 1.002", "NIFTY 50 > its 6EMA (market filter)", "Buy window: 3:15–3:25 PM IST"],
    sell: ["Adaptive TSL (4 tiers: 0.5%/0.4%/0.3%/0.2%), activates at 1% profit", "Max hold: 7 days", "CMP < 6EMA after 3:15 PM"],
    config: { "Universe": "Nifty 200", "EMA": "6-period", "Capital": "₹1L", "Max positions": "10", "Mode": "LIVE — real orders" },
  },
  "cash-atsl-paper": {
    buy: ["C1: prev open < 6EMA", "C2: prev close < 6EMA", "C3: CMP > 6EMA × 1.002", "NIFTY 50 > its 6EMA (market filter)", "Buy window: 3:15–3:25 PM IST"],
    sell: ["Adaptive TSL (4 tiers: 0.5%/0.4%/0.3%/0.2%), activates at 1% profit", "Max hold: 7 days", "CMP < 6EMA after 3:15 PM"],
    config: { "Universe": "Nifty 200", "EMA": "6-period", "Capital": "₹10L (virtual)", "Max positions": "10", "Mode": "PAPER — no real orders" },
  },
  "ema-above": {
    buy: ["Prev day close > 6EMA  (confirmed uptrend)", "Today close > 6EMA  (trend continues)", "Today close > prev close  (positive day)", "CMP > 6EMA  (live confirmation)", "NIFTY 50 > its own 6EMA  (market filter)"],
    sell: ["EMA Breakdown: CMP drops below 6EMA", "Adaptive TSL (4 tiers: 0.5%/0.4%/0.3%/0.2%), activates at 1% profit", "Max hold: 10 days"],
    config: { "Universe": "Nifty 200", "EMA": "6-period", "Capital": "₹10L (virtual)", "Max positions": "10", "Mode": "PAPER" },
  },
  "ema-crossover": {
    buy: ["6EMA crosses above 20EMA (golden cross)"],
    sell: ["6EMA crosses below 20EMA (death cross)", "Fixed 5% stop-loss from buy price"],
    config: { "Universe": "Nifty 200", "Fast EMA": "6", "Slow EMA": "20", "Stop-loss": "5%", "Mode": "PAPER" },
  },
  "rsi-momentum": {
    buy: ["RSI crosses above 50 from below", "Price above 20EMA"],
    sell: ["RSI drops below 40", "3% trailing stop from highest price"],
    config: { "Universe": "Nifty 200", "RSI period": "14", "Entry": "RSI > 50", "Exit": "RSI < 40", "Trail": "3%", "Mode": "PAPER" },
  },
  "btst": {
    buy: ["Stock up > 1.5% on the day", "Buy in last 30 min (2:45–3:15 PM)"],
    sell: ["Sell next day, 15 min after market open (9:30 AM)"],
    config: { "Universe": "Nifty 200", "Min day gain": "1.5%", "Buy window": "2:45–3:15 PM", "Sell": "Next day 9:30 AM", "Max positions": "3", "Mode": "PAPER" },
  },
};

export default function Dashboard() {
  const [tab, setTab] = useState("Positions");
  const [token, setToken] = useState(null);
  const [positions, setPositions] = useState([]);
  const [soldPositions, setSoldPositions] = useState([]);
  const [buySignals, setBuySignals] = useState([]);
  const [sellSignals, setSellSignals] = useState([]);
  const [trades, setTrades] = useState([]);
  const [crons, setCrons] = useState([]);
  const [telegramLog, setTelegramLog] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [labTrades, setLabTrades] = useState({});
  const [orders, setOrders] = useState([]);
  const [kiteOrders, setKiteOrders] = useState([]);
  const [wallet, setWallet] = useState({ zerodha: null, paper: {} });
  const [zerodhaPortfolio, setZerodhaPortfolio] = useState({ holdings: [], netPositions: [], summary: null, error: null });
  const [engineStatus, setEngineStatus] = useState({ marketOpen: false, tradingDay: false, jobs: [] });
  const [engineLog, setEngineLog] = useState([]);   // { ts, job, result }
  const [autoSell, setAutoSell] = useState(false);
  const [autoBuy, setAutoBuy] = useState(false);
  const [promoteConfirm, setPromoteConfirm] = useState(null);
  const [walletEdit, setWalletEdit] = useState(null); // { strategyId, capital }
  const [orderForm, setOrderForm] = useState({ symbol: "", qty: "", price: "", type: "MARKET", side: "BUY" });
  const [loading, setLoading] = useState({});
  const [marketOpen, setMarketOpen] = useState(false);
  const [istTime, setIstTime] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [authMsg, setAuthMsg] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [indices, setIndices] = useState([]);
  const [livePrices, setLivePrices] = useState({}); // { SYMBOL: { ltp, change, changePct } }
  const liveTickerRef = useRef(null); // holds the 1s interval id
  const [gainers, setGainers] = useState([]);
  const [gainerMinPct, setGainerMinPct] = useState(1);
  const [gainerLastFetch, setGainerLastFetch] = useState(null);
  const [gainerError, setGainerError] = useState(null);
  const [gainerUniverse, setGainerUniverse] = useState(null);
  const [expandedJob, setExpandedJob] = useState(null);       // Engine tab
  const [expandedStrategy, setExpandedStrategy] = useState(null); // Lab tab

  // Mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const setLoad = (key, val) => setLoading((l) => ({ ...l, [key]: val }));

  // IST clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const ist = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 3600000);
      const h = ist.getHours(), m = ist.getMinutes();
      const mins = h * 60 + m;
      setMarketOpen(ist.getDay() > 0 && ist.getDay() < 6 && mins >= 555 && mins <= 930);
      setIstTime(ist.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Unified 1-second live price ticker ─────────────────────────────────────
  // Batches ALL symbols (indices + holdings + ATSL positions) into ONE LTP call.
  // Zerodha allows: 1 req/sec, up to 1,000 symbols per call — perfect fit.
  // Only runs during market hours to avoid wasting calls on stale data.
  const livePriceSymbolsRef = useRef([]); // updated whenever positions/holdings change

  // Collect all symbols with exchange prefix (e.g. "NSE:RELIANCE", "BSE:MUTHOOTFIN")
  // Holdings/positions carry their exchange from Zerodha; ATSL positions default to NSE
  useEffect(() => {
    const syms = new Set();
    // ATSL R2 positions — always NSE
    positions.forEach(r => {
      const s = (r["Symbol"] || "").replace(".NS","").trim();
      if (s) syms.add(`NSE:${s}`);
    });
    // Zerodha holdings — use actual exchange from broker
    zerodhaPortfolio.holdings.forEach(h => {
      if (h.symbol && h.exchange) syms.add(`${h.exchange}:${h.symbol}`);
    });
    zerodhaPortfolio.netPositions.forEach(p => {
      if (p.symbol && p.exchange) syms.add(`${p.exchange}:${p.symbol}`);
    });
    livePriceSymbolsRef.current = [...syms];
  }, [positions, zerodhaPortfolio]);

  // 1s ticker — only during market hours
  useEffect(() => {
    const doFetch = async () => {
      try {
        const syms = livePriceSymbolsRef.current.join(",");
        const url  = `/api/market/live-prices?indices=1${syms ? `&symbols=${encodeURIComponent(syms)}` : ""}`;
        const d    = await (await fetch(url)).json();
        if (!d.ok) return;
        if (d.indices?.length) setIndices(d.indices);
        if (d.prices)          setLivePrices(d.prices);
      } catch {}
    };

    const tick = () => { if (marketOpen) doFetch(); };

    // Initial fetch regardless of market hours (shows last known prices)
    doFetch();

    if (liveTickerRef.current) clearInterval(liveTickerRef.current);
    liveTickerRef.current = setInterval(tick, 1000);
    return () => clearInterval(liveTickerRef.current);
  }, [marketOpen]); // restarts when market opens/closes

  // Check URL auth param + auto-handle request_token from Zerodha redirect
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const requestToken = p.get("request_token");
    const status = p.get("status");

    if (requestToken && status === "success") {
      setAuthMsg("⏳ Zerodha login detected — saving token...");
      fetch("/api/auth/set-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestToken }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) {
            setAuthMsg("✅ Logged in as " + d.user_name + " (" + d.user_id + ")");
            fetchToken();
            window.history.replaceState({}, "", "/");
          } else {
            setAuthMsg("❌ " + d.error);
          }
        })
        .catch(() => setAuthMsg("❌ Token save failed"));
    } else if (p.get("auth") === "success") {
      setAuthMsg("✅ Zerodha login successful!");
    } else if (p.get("auth") === "failed") {
      setAuthMsg("❌ Zerodha login failed.");
    } else if (p.get("auth") === "error") {
      setAuthMsg("❌ " + (p.get("msg") || "Login error"));
    }
  }, []);

  const fetchToken = useCallback(async () => {
    setLoad("token", true);
    try { const d = await (await fetch("/api/auth/token-status")).json(); setToken(d); }
    catch { setToken({ valid: false }); }
    setLoad("token", false);
  }, []);

  const fetchPositions = useCallback(async () => {
    setLoad("positions", true);
    try {
      const d = await (await fetch("/api/portfolio/positions?live=1")).json();
      setPositions(d.unsold || []);
      setSoldPositions(d.sold || []);
    } catch {}
    setLoad("positions", false);
  }, []);

  const fetchSignals = useCallback(async () => {
    setLoad("signals", true);
    try {
      const [b, s] = await Promise.all([
        fetch("/api/signals/buy").then(r => r.json()),
        fetch("/api/signals/sell").then(r => r.json()),
      ]);
      setBuySignals(b.signals || []);
      setSellSignals(s.signals || []);
    } catch {}
    setLoad("signals", false);
  }, []);

  const fetchTrades = useCallback(async () => {
    setLoad("trades", true);
    try { const d = await (await fetch("/api/portfolio/trade-history")).json(); setTrades(d.trades || []); }
    catch {}
    setLoad("trades", false);
  }, []);

  const fetchCrons = useCallback(async () => {
    setLoad("crons", true);
    try { const d = await (await fetch("/api/status/crons")).json(); setCrons(d.crons || []); }
    catch {}
    setLoad("crons", false);
  }, []);

  const fetchTelegramLog = useCallback(async () => {
    setLoad("telegram", true);
    try { const d = await (await fetch("/api/status/telegram-log")).json(); setTelegramLog(d.messages || []); }
    catch {}
    setLoad("telegram", false);
  }, []);

  const fetchStrategies = useCallback(async () => {
    setLoad("lab", true);
    try { const d = await (await fetch("/api/strategies")).json(); setStrategies(d.strategies || []); }
    catch {}
    setLoad("lab", false);
  }, []);

  const fetchLabTrades = useCallback(async (id) => {
    try {
      const d = await (await fetch(`/api/strategies/${id}/trades`)).json();
      setLabTrades((prev) => ({ ...prev, [id]: { trades: d.trades || [], open: d.openPositions || [] } }));
    } catch {}
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoad("orders", true);
    try { const d = await (await fetch("/api/strategies/orders")).json(); setOrders(d.orders || []); }
    catch {}
    setLoad("orders", false);
  }, []);

  const fetchKiteOrders = useCallback(async () => {
    setLoad("kiteOrders", true);
    try { const d = await (await fetch("/api/portfolio/kite-orders")).json(); setKiteOrders(d.orders || []); }
    catch {}
    setLoad("kiteOrders", false);
  }, []);

  const fetchWallet = useCallback(async () => {
    setLoad("wallet", true);
    try { const d = await (await fetch("/api/portfolio/wallet")).json(); setWallet({ zerodha: d.zerodha, paper: d.paper || {} }); }
    catch {}
    setLoad("wallet", false);
  }, []);

  const fetchEngineStatus = useCallback(async () => {
    try { const d = await (await fetch("/api/trading/status")).json(); if (d.ok) setEngineStatus(d); }
    catch {}
  }, []);

  const runJob = useCallback(async (job, opts = {}) => {
    const endpoints = {
      "sell-check":   "/api/trading/sell-check",
      "buy-signals":  "/api/trading/buy-signals",
      "atsl-update":  "/api/trading/atsl-update",
      "eod-summary":  "/api/trading/eod-summary",
      "token-health": "/api/trading/token-health",
    };
    const url = endpoints[job];
    if (!url) return;
    const ts = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" });
    try {
      const d = await (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) })).json();
      setEngineLog((prev) => [{ ts, job, result: d, ok: !d.error }, ...prev].slice(0, 50));
      fetchEngineStatus();
      if (job === "sell-check" || job === "atsl-update") fetchPositions();
    } catch (e) {
      setEngineLog((prev) => [{ ts, job, result: { error: e.message }, ok: false }, ...prev].slice(0, 50));
    }
  }, [fetchEngineStatus]);

  const fetchZerodhaPortfolio = useCallback(async () => {
    setLoad("zPortfolio", true);
    try {
      const d = await (await fetch("/api/portfolio/zerodha-portfolio")).json();
      setZerodhaPortfolio({ holdings: d.holdings || [], netPositions: d.netPositions || [], summary: d.summary || null, error: d.error || null });
    } catch (e) {
      setZerodhaPortfolio((p) => ({ ...p, error: e.message }));
    }
    setLoad("zPortfolio", false);
  }, []);

  // Initial load — staggered to avoid simultaneous Kite API calls
  useEffect(() => {
    fetchToken();
    fetchPositions();
    setTimeout(() => fetchZerodhaPortfolio(), 1500); // +1.5s: holdings + positions (2 Kite calls)
    setTimeout(() => fetchSignals(),          3000); // +3s
    setTimeout(() => fetchWallet(),           4500); // +4.5s: margins (1 Kite call)
  }, []);

  const fetchGainers = useCallback(async (pct) => {
    setLoad("gainers", true);
    setGainerError(null);
    try {
      const d = await (await fetch(`/api/market/gainers?minPct=${pct}`)).json();
      if (d.ok) {
        setGainers(d.gainers || []);
        setGainerLastFetch(new Date());
        setGainerUniverse(d.universe || null);
      } else {
        setGainerError(d.error || "Failed to fetch gainers");
      }
    } catch (e) {
      setGainerError(e.message);
    }
    setLoad("gainers", false);
  }, []);

  useEffect(() => { if (tab === "History" || tab === "P&L") fetchTrades(); }, [tab]);
  useEffect(() => { if (tab === "Crons") fetchCrons(); }, [tab]);
  useEffect(() => { if (tab === "Telegram") fetchTelegramLog(); }, [tab]);
  useEffect(() => { if (tab === "Lab") { fetchStrategies(); fetchWallet(); } }, [tab]);
  useEffect(() => { if (tab === "Orders") { fetchOrders(); fetchKiteOrders(); } }, [tab]);
  useEffect(() => { if (tab === "Positions") fetchZerodhaPortfolio(); }, [tab]);
  useEffect(() => { if (tab === "Engine") fetchEngineStatus(); }, [tab]);
  useEffect(() => { if (tab === "Screener") fetchGainers(gainerMinPct); }, [tab, gainerMinPct]);

  // Structure refresh (holdings list, qty, avg prices) — slow, separate from live prices
  // LTP is handled by the 1s live-prices ticker above
  useEffect(() => {
    // Refresh portfolio structure every 5 min during market hours, 15 min outside
    const interval = marketOpen ? 5 * 60 * 1000 : 15 * 60 * 1000;
    const id = setInterval(() => {
      if (tab === "Positions" || tab === "ATSL Tracker") {
        fetchPositions();
        setTimeout(() => fetchZerodhaPortfolio(), 1000);
      }
    }, interval);
    return () => clearInterval(id);
  }, [tab, marketOpen]);

  // Auto-sell poll: every 60s when enabled (quote API: 1 req/sec — don't hammer)
  useEffect(() => {
    if (!autoSell) return;
    const id = setInterval(() => runJob("sell-check"), 60000);
    return () => clearInterval(id);
  }, [autoSell, runJob]);

  // Auto buy-signal scan: every 3 min when enabled
  useEffect(() => {
    if (!autoBuy) return;
    const id = setInterval(() => runJob("buy-signals"), 180000);
    return () => clearInterval(id);
  }, [autoBuy, runJob]);

  // Auto ATSL update: check every 60s if we're in buy/close window
  useEffect(() => {
    if (!autoBuy) return;
    const id = setInterval(() => {
      const now = new Date();
      const ist = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 3600000);
      const h = ist.getHours(), m = ist.getMinutes();
      if (h === 15 && m >= 14 && m <= 30) runJob("atsl-update");
    }, 60000);
    return () => clearInterval(id);
  }, [autoBuy, runJob]);

  async function handleRefresh() {
    setRefreshing(true);
    // Stagger Kite API calls: 10 req/sec limit for REST endpoints
    // Each group waits 500ms to avoid simultaneous calls hitting rate limits
    fetchToken();
    fetchPositions();
    await new Promise(r => setTimeout(r, 500));
    fetchZerodhaPortfolio();
    await new Promise(r => setTimeout(r, 500));
    fetchSignals();
    await new Promise(r => setTimeout(r, 500));
    await fetchWallet();
    setRefreshing(false);
  }

  async function toggleCron(name, enabled) {
    await fetch("/api/status/crons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, enabled }),
    });
    fetchCrons();
  }

  // Stats
  const totalPnl = positions.reduce((acc, r) => acc + (parseFloat(r.pnlPct) || 0), 0);
  const winners = positions.filter((r) => parseFloat(r.pnlPct) >= 0).length;
  const losers  = positions.filter((r) => parseFloat(r.pnlPct) < 0).length;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <header style={{
        background: "var(--bg1)", borderBottom: "1px solid var(--border)",
        padding: "0 20px", height: 52, display: "flex", alignItems: "center", gap: 16,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>📈</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "0.01em" }}>ATSL Trading</span>
          {!isMobile && <span style={{ color: "var(--text3)", fontSize: 12 }}>Dashboard</span>}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? 8 : 14 }}>
          {/* Market status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusDot ok={marketOpen} />
            {!isMobile && (
              <span style={{ fontSize: 12, color: marketOpen ? "var(--green)" : "var(--text3)" }}>
                {marketOpen ? "Market Open" : "Market Closed"}
              </span>
            )}
          </div>

          {/* Zerodha wallet balance — hidden on mobile */}
          {wallet.zerodha && (
            <div style={{ display: isMobile ? "none" : "flex", alignItems: "center", gap: 10, padding: "4px 10px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 6 }}>
              <span style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Zerodha</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--green)" }}>
                ₹{wallet.zerodha.availableCash.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </span>
              {wallet.zerodha.todayPnL != null && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: wallet.zerodha.todayPnL >= 0 ? "var(--green)" : "var(--red)" }}>
                  {wallet.zerodha.todayPnL >= 0 ? "+" : ""}₹{Math.abs(wallet.zerodha.todayPnL).toLocaleString("en-IN", { maximumFractionDigits: 0 })} today
                </span>
              )}
              <button onClick={fetchWallet} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 11, padding: 0 }}>
                {loading.wallet ? "…" : "⟳"}
              </button>
            </div>
          )}

          {/* IST clock — hidden on mobile */}
          <span style={{ display: isMobile ? "none" : "inline", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text2)" }}>{istTime} IST</span>

          {/* Refresh */}
          <button onClick={handleRefresh} disabled={refreshing} style={{ ...btnStyle("default"), padding: "5px 10px", fontSize: 12 }}>
            {refreshing ? <Spinner /> : "⟳ Refresh"}
          </button>
        </div>
      </header>

      {/* Indices Ticker Strip */}
      {indices.length > 0 && (
        <div style={{
          background: "var(--bg2)", borderBottom: "1px solid var(--border)",
          overflowX: "auto", whiteSpace: "nowrap",
          padding: "0 16px", display: "flex", alignItems: "center", gap: 0,
          height: 36, flexShrink: 0,
        }}>
          {indices.map((idx, i) => {
            const up = idx.changePct >= 0;
            return (
              <div key={i} style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "0 16px", borderRight: "1px solid var(--border)",
                height: "100%", flexShrink: 0,
              }}>
                <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, letterSpacing: "0.03em" }}>{idx.label}</span>
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text)" }}>
                  {idx.ltp != null ? idx.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                </span>
                {idx.changePct != null && (
                  <span style={{
                    fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
                    color: up ? "var(--green)" : "var(--red)",
                  }}>
                    {up ? "▲" : "▼"} {Math.abs(idx.changePct).toFixed(2)}%
                  </span>
                )}
              </div>
            );
          })}
          <span style={{ fontSize: 10, color: "var(--text3)", paddingLeft: 12, flexShrink: 0 }}>
            via Zerodha · {marketOpen ? "live 1s" : "market closed"}
          </span>
        </div>
      )}

      {/* Auth message */}
      {authMsg && (
        <div style={{
          background: authMsg.startsWith("✅") ? "rgba(0,229,153,.1)" : "rgba(255,71,87,.1)",
          borderBottom: `1px solid ${authMsg.startsWith("✅") ? "var(--green2)" : "var(--red2)"}`,
          padding: "10px 20px", fontSize: 13, textAlign: "center",
          color: authMsg.startsWith("✅") ? "var(--green)" : "var(--red)",
        }}>
          {authMsg}
          <button onClick={() => setAuthMsg("")} style={{ marginLeft: 12, background: "none", border: "none", cursor: "pointer", color: "inherit" }}>×</button>
        </div>
      )}

      <div style={{ display: "flex", flex: 1 }}>
        {/* Sidebar — desktop only */}
        {!isMobile && (
          <nav style={{
            width: 200, background: "var(--bg1)", borderRight: "1px solid var(--border)",
            padding: "16px 10px", display: "flex", flexDirection: "column", gap: 4,
            position: "sticky", top: 52, height: "calc(100vh - 52px)", overflowY: "auto",
          }}>
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: tab === t ? "rgba(0,229,153,.08)" : "transparent",
                color: tab === t ? "var(--green)" : "var(--text2)",
                border: tab === t ? "1px solid rgba(0,229,153,.2)" : "1px solid transparent",
                borderRadius: 7, padding: "9px 12px", cursor: "pointer", textAlign: "left",
                fontSize: 13, fontWeight: tab === t ? 600 : 400, transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {t === "Positions" && "📂"}
                {t === "ATSL Tracker" && "🎯"}
                {t === "P&L" && "💰"}
                {t === "Signals" && "⚡"}
                {t === "History" && "📜"}
                {t === "Lab" && "🧪"}
                {t === "Orders" && "📋"}
                {t === "Engine" && "⚙️"}
                {t === "Crons" && "⏱"}
                {t === "Telegram" && "📨"}
                {t === "Screener" && "📊"}
                {t}
              </button>
            ))}

            {/* Token status in sidebar */}
            <div style={{ marginTop: "auto", padding: "12px 8px", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <StatusDot ok={token?.valid} />
                <span style={{ fontSize: 11, color: "var(--text3)" }}>Kite Token</span>
              </div>
              {token?.valid
                ? <span style={{ fontSize: 11, color: "var(--green)", fontFamily: "var(--font-mono)" }}>{token.user_id}</span>
                : <button onClick={() => setTab("Positions")} style={{ fontSize: 11, color: "var(--red)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Login required</button>
              }
            </div>
          </nav>
        )}

        {/* Bottom nav bar — mobile only */}
        {isMobile && (
          <nav style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200,
            background: "var(--bg1)", borderTop: "1px solid var(--border)",
            display: "flex", overflowX: "auto", padding: "4px 0",
          }}>
            {TABS.map(t => {
              const icons = { "Positions": "📂", "ATSL Tracker": "🎯", "P&L": "💰", "Signals": "⚡", "History": "📜", "Lab": "🧪", "Orders": "📋", "Engine": "⚙️", "Crons": "⏱", "Telegram": "📨" };
              return (
                <button key={t} onClick={() => setTab(t)} style={{
                  flex: "0 0 auto", padding: "6px 14px", background: "none",
                  border: "none", cursor: "pointer", fontSize: 10,
                  color: tab === t ? "var(--green)" : "var(--text3)",
                  fontWeight: tab === t ? 700 : 400,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  borderBottom: tab === t ? "2px solid var(--green)" : "2px solid transparent",
                }}>
                  <span style={{ fontSize: 16 }}>{icons[t]}</span>
                  <span>{t}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Main content */}
        <main style={{ flex: 1, padding: isMobile ? "12px 10px" : 20, paddingBottom: isMobile ? 80 : 20, overflowY: "auto", maxWidth: "100%" }}>

          {/* ── POSITIONS ── */}
          {tab === "Positions" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.25s ease" }}>

              {/* Error / login prompt */}
              {zerodhaPortfolio.error && (
                <div style={{ padding: "12px 16px", background: "rgba(255,71,87,.08)", border: "1px solid rgba(255,71,87,.2)", borderRadius: 8, fontSize: 13, color: "var(--red)" }}>
                  ⚠ {zerodhaPortfolio.error}
                </div>
              )}

              {/* Summary stat cards — live recalculated from livePrices */}
              {zerodhaPortfolio.summary && (() => {
                const s = zerodhaPortfolio.summary;
                // Recalculate with live prices if available
                let liveInvested = 0, liveCurVal = 0, liveDayPnL = 0;
                const hasLive = Object.keys(livePrices).length > 0 && zerodhaPortfolio.holdings.some(h => livePrices[`${h.exchange}:${h.symbol}`]);
                if (hasLive && zerodhaPortfolio.holdings.length) {
                  zerodhaPortfolio.holdings.forEach(h => {
                    const lp     = livePrices[`${h.exchange}:${h.symbol}`] || livePrices[h.symbol];
                    const ltp    = lp?.ltp ?? h.lastPrice;
                    const close  = lp?.close ?? h.closePrice ?? h.lastPrice;
                    liveInvested += h.invested;
                    liveCurVal   += ltp * h.qty;
                    liveDayPnL   += (ltp - close) * h.qty;
                  });
                } else {
                  liveInvested = s.holdingsInvested;
                  liveCurVal   = s.holdingsCurrentVal;
                  liveDayPnL   = s.dayPnL;
                }
                const livePnL    = liveCurVal - liveInvested;
                const livePnLPct = liveInvested ? (livePnL / liveInvested * 100) : 0;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                    {[
                      { label: "Holdings", value: s.holdingsCount, color: "var(--blue)" },
                      { label: "Invested", value: `₹${Math.round(liveInvested).toLocaleString("en-IN")}`, color: "var(--text)" },
                      { label: "Current Value", value: `₹${Math.round(liveCurVal).toLocaleString("en-IN")}`, color: "var(--blue)" },
                      { label: "Total P&L", value: `${livePnL >= 0 ? "+" : ""}₹${Math.round(Math.abs(livePnL)).toLocaleString("en-IN")}`, color: livePnL >= 0 ? "var(--green)" : "var(--red)" },
                      { label: "P&L %", value: `${livePnLPct >= 0 ? "+" : ""}${livePnLPct.toFixed(2)}%`, color: livePnLPct >= 0 ? "var(--green)" : "var(--red)" },
                      { label: "Day P&L", value: `${liveDayPnL >= 0 ? "+" : ""}₹${Math.round(Math.abs(liveDayPnL)).toLocaleString("en-IN")}`, color: liveDayPnL >= 0 ? "var(--green)" : "var(--red)" },
                    ].map((stat) => (
                      <div key={stat.label} style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
                        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4, letterSpacing: "0.05em", textTransform: "uppercase" }}>{stat.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-mono)", color: stat.color }}>{stat.value}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <TokenPanel token={token} onRefresh={fetchToken} />

              {/* Zerodha Holdings (CNC / Delivery) */}
              <Card title="Zerodha Holdings (Delivery)" action={
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Badge type="blue">{zerodhaPortfolio.holdings.length} stocks</Badge>
                  <button onClick={fetchZerodhaPortfolio} style={{ ...btnStyle("default"), padding: "4px 10px", fontSize: 11 }}>
                    {loading.zPortfolio ? <Spinner /> : "↻ Refresh"}
                  </button>
                </div>
              }>
                {loading.zPortfolio && zerodhaPortfolio.holdings.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 24, color: "var(--text3)" }}><Spinner /> Fetching from Zerodha…</div>
                ) : zerodhaPortfolio.holdings.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 24, color: "var(--text3)" }}>
                    {token?.valid ? "No holdings in your Zerodha account" : "Login to Zerodha to see holdings"}
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>{["Symbol","Qty","T+1","Avg Price","LTP","Invested","Current","P&L","P&L %","Day Chg %"].map(h => <th key={h} style={mThStyle(isMobile)}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {zerodhaPortfolio.holdings.map((h, i) => {
                          // Look up by exchange:symbol key (e.g. "NSE:RELIANCE")
                          const lp      = livePrices[`${h.exchange}:${h.symbol}`] || livePrices[h.symbol];
                          const ltp     = lp?.ltp ?? h.lastPrice;
                          const curVal  = ltp * h.qty;
                          const pnlVal  = curVal - h.invested;
                          const pnlPct  = h.invested ? (pnlVal / h.invested * 100) : 0;
                          const dayChg  = lp?.changePct ?? h.dayChangePct;
                          return (
                          <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", fontWeight: 700 }}>{h.symbol}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)" }}>{h.qty}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", color: h.t1Qty > 0 ? "var(--yellow)" : "var(--text3)" }}>
                              {h.t1Qty > 0 ? h.t1Qty : "—"}
                            </td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)" }}>₹{fmt(h.avgPrice)}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", fontWeight: 600, color: lp ? "var(--accent)" : "inherit" }}>₹{fmt(ltp)}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", color: "var(--text2)" }}>₹{Math.round(h.invested).toLocaleString("en-IN")}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)" }}>₹{Math.round(curVal).toLocaleString("en-IN")}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", color: pnlVal >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                              {pnlVal >= 0 ? "+" : ""}₹{Math.round(Math.abs(pnlVal)).toLocaleString("en-IN")}
                            </td>
                            <td style={mTdStyle(isMobile)}><PnlBadge val={pnlPct.toFixed(2)} /></td>
                            <td style={mTdStyle(isMobile)}><PnlBadge val={dayChg} /></td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Net Positions (intraday / MIS / overnight) */}
              {zerodhaPortfolio.netPositions.length > 0 && (
                <Card title="Net Positions" action={<Badge type="yellow">{zerodhaPortfolio.netPositions.length} open</Badge>}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>{["Symbol","Product","Qty","Avg Price","LTP","P&L","P&L %"].map(h => <th key={h} style={mThStyle(isMobile)}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {zerodhaPortfolio.netPositions.map((p, i) => {
                          const lp     = livePrices[`${p.exchange}:${p.symbol}`] || livePrices[p.symbol];
                          const ltp    = lp?.ltp ?? p.lastPrice;
                          const pnlVal = p.qty * (ltp - p.avgPrice);
                          const pnlPct = p.avgPrice ? (pnlVal / (Math.abs(p.qty) * p.avgPrice) * 100) : 0;
                          return (
                          <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", fontWeight: 700 }}>{p.symbol}</td>
                            <td style={mTdStyle(isMobile)}><Badge type={p.product === "CNC" ? "blue" : "yellow"}>{p.product}</Badge></td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", color: p.qty > 0 ? "var(--green)" : "var(--red)" }}>{p.qty > 0 ? "+" : ""}{p.qty}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)" }}>₹{fmt(p.avgPrice)}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", fontWeight: 600, color: lp ? "var(--accent)" : "inherit" }}>₹{fmt(ltp)}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", color: pnlVal >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                              {pnlVal >= 0 ? "+" : ""}₹{Math.round(Math.abs(pnlVal)).toLocaleString("en-IN")}
                            </td>
                            <td style={mTdStyle(isMobile)}><PnlBadge val={pnlPct.toFixed(2)} /></td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {/* ATSL-tracked positions from R2 (strategy layer) */}
              {positions.length > 0 && (
                <Card title="ATSL Strategy Positions (R2 Tracked)" action={
                  <button onClick={fetchPositions} style={{ ...btnStyle("default"), padding: "4px 10px", fontSize: 11 }}>
                    {loading.positions ? <Spinner /> : "↻"}
                  </button>
                }>
                  <PositionsTable positions={positions} loading={loading.positions} isMobile={isMobile} />
                </Card>
              )}

              {/* Closed positions from R2 */}
              {soldPositions.length > 0 && (
                <Card title="Closed ATSL Positions">
                  <div style={{ overflowX: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>{["Symbol","Buy Date","Buy Price","Sell Date","Sell Price","P&L %","Reason"].map(h => <th key={h} style={mThStyle(isMobile)}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {soldPositions.slice(0, 20).map((r, i) => {
                          const b = parseFloat(r["Buy Price"] || 0), s = parseFloat(r["Sell Price"] || 0);
                          const pnl = b && s ? ((s - b) / b * 100).toFixed(2) : null;
                          return (
                            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", fontWeight: 600 }}>{(r["Symbol"] || "").replace(".NS", "")}</td>
                              <td style={{ ...mTdStyle(isMobile), color: "var(--text2)" }}>{r["Buy Date"] || "—"}</td>
                              <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)" }}>{fmtINR(r["Buy Price"])}</td>
                              <td style={{ ...mTdStyle(isMobile), color: "var(--text2)" }}>{r["Sell Date"] || "—"}</td>
                              <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)" }}>{fmtINR(r["Sell Price"])}</td>
                              <td style={mTdStyle(isMobile)}><PnlBadge val={pnl} /></td>
                              <td style={{ ...mTdStyle(isMobile), color: "var(--text3)", fontSize: 11 }}>{r["Sell Reason"] || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}


          {/* ── ATSL TRACKER ── */}
          {tab === "ATSL Tracker" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.25s ease" }}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 12 }}>
                {[
                  { label: "Open Positions", value: positions.length, color: "var(--blue)" },
                  { label: "At Risk (near ATSL)", value: positions.filter(p => {
                      const bp = parseFloat(p["Buy Price"] || 0);
                      const cmp = parseFloat(p.cmp || 0);
                      if (!bp || !cmp) return false;
                      const atsl = Math.max(bp * 0.93, (parseFloat(p["High Price"] || cmp)) * 0.93);
                      return cmp && ((cmp - atsl) / cmp * 100) < 3;
                    }).length, color: "var(--red)" },
                  { label: "In Profit", value: positions.filter(p => parseFloat(p.pnlPct || p.pnl || 0) > 0).length, color: "var(--green)" },
                  { label: "In Loss", value: positions.filter(p => parseFloat(p.pnlPct || p.pnl || 0) < 0).length, color: "var(--yellow)" },
                ].map((s, i) => (
                  <div key={i} style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 20px" }}>
                    <div style={{ fontSize: 11, color: "var(--text3)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>{s.label}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <Card title="ATSL Position Tracker" action={
                <button onClick={fetchPositions} style={{ ...btnStyle("default"), padding: "4px 10px", fontSize: 11 }}>
                  {loading.positions ? <Spinner /> : "↻ Refresh LTP"}
                </button>
              }>
                <ATSLTracker positions={positions} loading={loading.positions} />
              </Card>
            </div>
          )}

          {/* ── P&L CALENDAR ── */}
          {tab === "P&L" && (
            <div style={{ animation: "fadeIn 0.25s ease" }}>
              <PnLCalendar trades={trades} />
            </div>
          )}

          {/* ── SIGNALS ── */}
          {tab === "Signals" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.25s ease" }}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                <Card title="Buy Signals" action={
                  <Badge type="green">{buySignals.length} signals</Badge>
                }>
                  <SignalsLog signals={buySignals} loading={loading.signals} type="buy" />
                </Card>
                <Card title="Sell Signals" action={
                  <Badge type="red">{sellSignals.length} signals</Badge>
                }>
                  <SignalsLog signals={sellSignals} loading={loading.signals} type="sell" />
                </Card>
              </div>
            </div>
          )}

          {/* ── HISTORY ── */}
          {tab === "History" && (
            <div style={{ animation: "fadeIn 0.25s ease" }}>
              <Card title="Trade History" action={
                <span style={{ fontSize: 12, color: "var(--text3)" }}>{trades.length} trades</span>
              }>
                <TradeHistory trades={trades} loading={loading.trades} isMobile={isMobile} />
              </Card>
            </div>
          )}

          {/* ── LAB ── */}
          {tab === "Lab" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.25s ease" }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🧪 Strategy Lab</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text3)" }}>Paper trading engine — all strategies start here before going live</p>
                </div>
                <button onClick={fetchStrategies} style={{ ...btnStyle("default"), padding: "6px 12px", fontSize: 12 }}>
                  {loading.lab ? <Spinner /> : "↻ Refresh"}
                </button>
              </div>

              {/* Strategy Cards */}
              {loading.lab && strategies.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "var(--text3)" }}><Spinner /> Loading strategies…</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
                  {strategies.map((s) => {
                    const m  = s.metrics || {};
                    const w  = wallet.paper[s.id] || s.wallet || {};
                    const isLive = s.mode === "live";
                    const isPaused = s.status === "paused";
                    const pnlColor = (m.totalPnL || 0) >= 0 ? "var(--green)" : "var(--red)";
                    return (
                      <div key={s.id} style={{
                        background: "var(--bg1)", border: `1px solid ${isLive ? "rgba(0,229,153,.3)" : "var(--border)"}`,
                        borderRadius: 12, overflow: "hidden",
                        opacity: isPaused ? 0.6 : 1,
                      }}>
                        {/* Card header */}
                        <div
                          style={{ padding: "12px 16px", background: "var(--bg2)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" }}
                          onClick={() => setExpandedStrategy(expandedStrategy === s.id ? null : s.id)}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                              {s.name}
                              <Badge type={isLive ? "green" : "blue"}>{isLive ? "LIVE" : "PAPER"}</Badge>
                              {isPaused && <Badge type="yellow">PAUSED</Badge>}
                              <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 2 }}>{expandedStrategy === s.id ? "▲" : "▼"}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{s.description}</div>
                          </div>
                          {/* Toggle pause/active */}
                          <Toggle
                            checked={!isPaused}
                            onChange={async (e) => {
                              e.stopPropagation && e.stopPropagation();
                              await fetch(`/api/strategies/${s.id}/toggle`, { method: "POST" });
                              fetchStrategies();
                            }}
                          />
                        </div>
                        {/* Logic summary */}
                        {expandedStrategy === s.id && <LogicPanel logic={STRATEGY_LOGIC[s.id]} />}

                        {/* Metrics grid */}
                        <div style={{ padding: 16 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
                            {[
                              { label: "Total P&L", value: m.totalPnL != null ? `${m.pnlPct >= 0 ? "+" : ""}${m.pnlPct}%` : "—", color: pnlColor },
                              { label: "Win Rate", value: m.winRate != null ? `${m.winRate}%` : "—", color: "var(--text)" },
                              { label: "Trades", value: m.totalTrades ?? "—", color: "var(--text)" },
                              { label: "Sharpe", value: m.sharpeRatio ?? "—", color: "var(--blue)" },
                              { label: "Max DD", value: m.maxDrawdown != null ? `${m.maxDrawdown}%` : "—", color: "var(--red)" },
                              { label: "Open", value: m.openPositions ?? "—", color: "var(--yellow)" },
                            ].map((stat) => (
                              <div key={stat.label} style={{ textAlign: "center" }}>
                                <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{stat.label}</div>
                                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-mono)", color: stat.color }}>{stat.value}</div>
                              </div>
                            ))}
                          </div>

                          {/* Paper wallet strip */}
                          {!isLive && w.startingCapital != null && (
                            <div style={{ margin: "10px 0", padding: "10px 12px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <span style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Paper Wallet</span>
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  {walletEdit?.strategyId === s.id ? (
                                    <>
                                      <input
                                        value={walletEdit.capital}
                                        onChange={(e) => setWalletEdit((p) => ({ ...p, capital: e.target.value }))}
                                        style={{ ...inputStyle, width: 90, padding: "3px 6px", fontSize: 11 }}
                                        placeholder="₹ amount"
                                      />
                                      <button style={{ ...btnStyle("accent"), padding: "3px 8px", fontSize: 11 }} onClick={async () => {
                                        await fetch("/api/portfolio/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_capital", strategyId: s.id, capital: walletEdit.capital }) });
                                        setWalletEdit(null); fetchWallet(); fetchStrategies();
                                      }}>Save</button>
                                      <button style={{ ...btnStyle("default"), padding: "3px 6px", fontSize: 11 }} onClick={() => setWalletEdit(null)}>×</button>
                                    </>
                                  ) : (
                                    <>
                                      <button style={{ ...btnStyle("default"), padding: "3px 8px", fontSize: 10 }} onClick={() => setWalletEdit({ strategyId: s.id, capital: w.startingCapital })}>Edit Capital</button>
                                      <button style={{ ...btnStyle("default"), padding: "3px 8px", fontSize: 10, color: "var(--red)" }} onClick={async () => {
                                        if (!confirm(`Reset paper wallet for ${s.name}? This will restore ₹${(w.startingCapital || 1000000).toLocaleString("en-IN")} cash.`)) return;
                                        await fetch("/api/portfolio/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset", strategyId: s.id }) });
                                        fetchWallet(); fetchStrategies();
                                      }}>Reset</button>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                                {[
                                  { label: "Available", value: w.availableCash, color: "var(--green)" },
                                  { label: "Deployed", value: w.deployedCapital, color: "var(--yellow)" },
                                  { label: "Total Value", value: w.totalValue, color: (w.totalValue || 0) >= (w.startingCapital || 0) ? "var(--green)" : "var(--red)" },
                                ].map((stat) => (
                                  <div key={stat.label}>
                                    <div style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{stat.label}</div>
                                    <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: stat.color }}>
                                      {stat.value != null ? `₹${Math.round(stat.value).toLocaleString("en-IN")}` : "—"}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {/* Return % bar */}
                              {w.totalReturn != null && (
                                <div style={{ marginTop: 8 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text3)", marginBottom: 3 }}>
                                    <span>Return</span>
                                    <span style={{ color: w.totalReturn >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                                      {w.totalReturn >= 0 ? "+" : ""}{w.totalReturn}%
                                    </span>
                                  </div>
                                  <div style={{ height: 4, background: "var(--bg)", borderRadius: 2, overflow: "hidden" }}>
                                    <div style={{
                                      height: "100%", borderRadius: 2, transition: "width 0.4s",
                                      background: w.totalReturn >= 0 ? "var(--green)" : "var(--red)",
                                      width: `${Math.min(100, Math.abs(w.totalReturn) * 5)}%`,
                                    }} />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Mini equity curve */}
                          {m.equityCurve && m.equityCurve.length > 1 && (
                            <div style={{ height: 60, marginBottom: 14 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={m.equityCurve} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                                  <defs>
                                    <linearGradient id={`grad-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor={isLive ? "#00e599" : "#00aaff"} stopOpacity={0.3} />
                                      <stop offset="95%" stopColor={isLive ? "#00e599" : "#00aaff"} stopOpacity={0} />
                                    </linearGradient>
                                  </defs>
                                  <Area type="monotone" dataKey="value" stroke={isLive ? "#00e599" : "#00aaff"} strokeWidth={1.5} fill={`url(#grad-${s.id})`} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          )}

                          {/* Action buttons */}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              onClick={() => { fetchLabTrades(s.id); }}
                              style={{ ...btnStyle("default"), padding: "5px 10px", fontSize: 11 }}
                            >
                              View Trades
                            </button>
                            <button
                              onClick={async () => {
                                setLoad(`run_${s.id}`, true);
                                try {
                                  const r = await fetch(`/api/strategies/${s.id}/run`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ forceBuy: true, forceSell: true }),
                                  });
                                  const d = await r.json();
                                  const msg = d.error
                                    ? `❌ ${d.error}`
                                    : d.result?.skipped
                                    ? `⏭ Skipped: ${d.result.reason}`
                                    : d.result?.buys?.length || d.result?.sells?.length
                                    ? `✅ Buys: ${d.result.buys?.length || 0}, Sells: ${d.result.sells?.length || 0}`
                                    : `✅ Ran — no signals`;
                                  alert(msg);
                                  fetchStrategies();
                                  fetchLabTrades(s.id);
                                } catch(e) {
                                  alert(`❌ ${e.message}`);
                                } finally {
                                  setLoad(`run_${s.id}`, false);
                                }
                              }}
                              disabled={loading[`run_${s.id}`]}
                              style={{ ...btnStyle("accent"), padding: "5px 10px", fontSize: 11 }}
                            >
                              {loading[`run_${s.id}`] ? <Spinner /> : "▶ Run Now"}
                            </button>
                            {!isLive ? (
                              promoteConfirm === s.id ? (
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  <span style={{ fontSize: 11, color: "var(--yellow)" }}>⚠ Real orders!</span>
                                  <button
                                    onClick={async () => {
                                      await fetch(`/api/strategies/${s.id}/mode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "live", confirm: true }) });
                                      setPromoteConfirm(null);
                                      fetchStrategies();
                                    }}
                                    style={{ ...btnStyle("accent"), padding: "4px 10px", fontSize: 11 }}
                                  >
                                    Confirm Live
                                  </button>
                                  <button onClick={() => setPromoteConfirm(null)} style={{ ...btnStyle("default"), padding: "4px 8px", fontSize: 11 }}>Cancel</button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setPromoteConfirm(s.id)}
                                  style={{ ...btnStyle("green"), padding: "5px 10px", fontSize: 11 }}
                                >
                                  🚀 Promote to Live
                                </button>
                              )
                            ) : (
                              <button
                                onClick={async () => {
                                  await fetch(`/api/strategies/${s.id}/mode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "paper", confirm: true }) });
                                  fetchStrategies();
                                }}
                                style={{ ...btnStyle("default"), padding: "5px 10px", fontSize: 11 }}
                              >
                                Move to Paper
                              </button>
                            )}
                          </div>

                          {/* Per-strategy trade log (lazy loaded) */}
                          {labTrades[s.id] && (
                            <div style={{ marginTop: 14 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Recent Trades</div>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ ...tableStyle, fontSize: 11 }}>
                                  <thead>
                                    <tr>{["Symbol","Buy","Sell","P&L%","Reason"].map(h => <th key={h} style={{ ...mThStyle(isMobile), padding: isMobile ? "3px 5px" : "4px 6px" }}>{h}</th>)}</tr>
                                  </thead>
                                  <tbody>
                                    {(labTrades[s.id].trades || []).slice(-5).reverse().map((t, i) => {
                                      const pnl = parseFloat(t["P&L %"] || 0);
                                      return (
                                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                                          <td style={{ ...mTdStyle(isMobile), padding: isMobile ? "3px 5px" : "3px 6px", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{(t["Symbol"] || "").replace(".NS","")}</td>
                                          <td style={{ ...mTdStyle(isMobile), padding: isMobile ? "3px 5px" : "3px 6px" }}>{t["Buy Price"] ? `₹${t["Buy Price"]}` : "—"}</td>
                                          <td style={{ ...mTdStyle(isMobile), padding: isMobile ? "3px 5px" : "3px 6px" }}>{t["Sell Price"] ? `₹${t["Sell Price"]}` : "—"}</td>
                                          <td style={{ ...mTdStyle(isMobile), padding: isMobile ? "3px 5px" : "3px 6px" }}><PnlBadge val={pnl} /></td>
                                          <td style={{ ...mTdStyle(isMobile), padding: isMobile ? "3px 5px" : "3px 6px", color: "var(--text3)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t["Sell Reason"] || "—"}</td>
                                        </tr>
                                      );
                                    })}
                                    {(labTrades[s.id].trades || []).length === 0 && (
                                      <tr><td colSpan={5} style={{ ...mTdStyle(isMobile), textAlign: "center", color: "var(--text3)", padding: 8 }}>No closed trades yet</td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {strategies.length === 0 && !loading.lab && (
                    <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "var(--text3)" }}>No strategies found</div>
                  )}
                </div>
              )}

              {/* Combined equity curve chart */}
              {strategies.some((s) => s.metrics?.equityCurve?.length > 1) && (
                <Card title="Equity Curves — All Strategies">
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text3)" }} />
                        <YAxis tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "var(--text3)" }} />
                        <Tooltip formatter={(v) => [`₹${Number(v).toLocaleString("en-IN")}`, ""]} labelStyle={{ color: "var(--text2)" }} contentStyle={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
                        {strategies.filter((s) => s.metrics?.equityCurve?.length > 1).map((s, idx) => {
                          const colors = ["#00e599", "#00aaff", "#ff9f43", "#ff4757", "#a29bfe"];
                          const color = colors[idx % colors.length];
                          return (
                            <Area key={s.id} data={s.metrics.equityCurve} type="monotone" dataKey="value" name={s.name}
                              stroke={color} fill="none" strokeWidth={2} dot={false} />
                          );
                        })}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ── ORDERS ── */}
          {tab === "Orders" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.25s ease" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📋 Order Book</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text3)" }}>Zerodha live orders + paper strategy order log</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { fetchKiteOrders(); fetchOrders(); }} style={{ ...btnStyle("default"), padding: "6px 12px", fontSize: 12 }}>
                    {(loading.kiteOrders || loading.orders) ? <Spinner /> : "↻ Refresh All"}
                  </button>
                </div>
              </div>

              {/* Zerodha Wallet Summary */}
              {wallet.zerodha && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                  {[
                    { label: "Available Cash", value: `₹${wallet.zerodha.availableCash.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: "var(--green)" },
                    { label: "Net Margin", value: `₹${wallet.zerodha.net.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: "var(--blue)" },
                    { label: "Utilised", value: `₹${wallet.zerodha.utilised.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: "var(--yellow)" },
                    { label: "Today P&L", value: wallet.zerodha.todayPnL != null ? `${wallet.zerodha.todayPnL >= 0 ? "+" : ""}₹${Math.abs(wallet.zerodha.todayPnL).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—", color: (wallet.zerodha.todayPnL || 0) >= 0 ? "var(--green)" : "var(--red)" },
                    { label: "Net P&L", value: wallet.zerodha.netPnL != null ? `${wallet.zerodha.netPnL >= 0 ? "+" : ""}₹${Math.abs(wallet.zerodha.netPnL).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—", color: (wallet.zerodha.netPnL || 0) >= 0 ? "var(--green)" : "var(--red)" },
                  ].map((s) => (
                    <div key={s.label} style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
                      <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)", color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Zerodha Live Orders (from Kite API) */}
              <Card title="Zerodha Live Orders" action={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge type={kiteOrders.length > 0 ? "green" : "default"}>{kiteOrders.length} orders</Badge>
                  <button onClick={fetchKiteOrders} style={{ ...btnStyle("default"), padding: "3px 8px", fontSize: 11 }}>
                    {loading.kiteOrders ? <Spinner /> : "↻"}
                  </button>
                </div>
              }>
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>{["Time","Symbol","Side","Type","Product","Qty","Filled","Avg Price","Status","Order ID"].map(h => <th key={h} style={mThStyle(isMobile)}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {kiteOrders.map((o, i) => {
                        const statusType = o.status === "COMPLETE" ? "green" : o.status === "REJECTED" || o.status === "CANCELLED" ? "red" : "yellow";
                        return (
                          <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ ...mTdStyle(isMobile), color: "var(--text3)" }}>{o.placedAt ? new Date(o.placedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", fontWeight: 600 }}>{o.symbol}</td>
                            <td style={mTdStyle(isMobile)}><Badge type={o.side === "BUY" ? "green" : "red"}>{o.side}</Badge></td>
                            <td style={{ ...mTdStyle(isMobile), color: "var(--text2)" }}>{o.orderType}</td>
                            <td style={{ ...mTdStyle(isMobile), color: "var(--text3)" }}>{o.product}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)" }}>{o.qty}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", color: o.filledQty === o.qty ? "var(--green)" : "var(--text2)" }}>{o.filledQty}</td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)" }}>{o.avgPrice ? `₹${o.avgPrice}` : "—"}</td>
                            <td style={mTdStyle(isMobile)}>
                              <Badge type={statusType}>{o.status}</Badge>
                              {o.statusMessage && <div style={{ fontSize: 10, color: "var(--red)", marginTop: 2 }}>{o.statusMessage}</div>}
                            </td>
                            <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)" }}>{o.orderId}</td>
                          </tr>
                        );
                      })}
                      {kiteOrders.length === 0 && (
                        <tr><td colSpan={10} style={{ ...mTdStyle(isMobile), textAlign: "center", color: "var(--text3)", padding: 20 }}>
                          {loading.kiteOrders ? <Spinner /> : "No live orders today — or login required"}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Paper Order Log (from R2) */}
              <Card title="Paper & Strategy Order Log" action={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge type="blue">{orders.length} entries</Badge>
                  <button onClick={fetchOrders} style={{ ...btnStyle("default"), padding: "3px 8px", fontSize: 11 }}>
                    {loading.orders ? <Spinner /> : "↻"}
                  </button>
                </div>
              }>
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>{["Time","Symbol","Side","Type","Qty","Price","Status","Strategy","Order ID"].map(h => <th key={h} style={mThStyle(isMobile)}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {orders.map((o, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ ...mTdStyle(isMobile), color: "var(--text3)" }}>{o.ts ? new Date(o.ts).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", fontWeight: 600 }}>{o.symbol || "—"}</td>
                          <td style={mTdStyle(isMobile)}><Badge type={o.side === "BUY" ? "green" : "red"}>{o.side}</Badge></td>
                          <td style={{ ...mTdStyle(isMobile), color: "var(--text2)" }}>{o.type || "—"}</td>
                          <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)" }}>{o.qty || "—"}</td>
                          <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)" }}>{o.limitPrice ? `₹${o.limitPrice}` : "MKT"}</td>
                          <td style={mTdStyle(isMobile)}><Badge type={o.status === "PLACED" ? "green" : o.status === "FAILED" ? "red" : "default"}>{o.status || "—"}</Badge></td>
                          <td style={{ ...mTdStyle(isMobile), color: "var(--text3)" }}>{o.strategyId || "—"}</td>
                          <td style={{ ...mTdStyle(isMobile), fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)" }}>{o.orderId || "—"}</td>
                        </tr>
                      ))}
                      {orders.length === 0 && (
                        <tr><td colSpan={9} style={{ ...mTdStyle(isMobile), textAlign: "center", color: "var(--text3)", padding: 20 }}>No logged orders today</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ── ENGINE ── */}
          {tab === "Engine" && (() => {
            const isOpen = engineStatus.marketOpen;
            const jobs = [
              { key: "sell-check",   label: "Sell Tracker",    desc: "Check ATSL / TSL breach on all open positions",    icon: "📉", auto: autoSell, setAuto: setAutoSell, interval: "every 30s" },
              { key: "buy-signals",  label: "Buy Signal Scan",  desc: "Scan Nifty 200 for 6EMA crossover candidates",     icon: "🔍", auto: autoBuy,  setAuto: setAutoBuy,  interval: "every 3 min" },
              { key: "atsl-update",  label: "ATSL Buy/Close",   desc: "Execute buys at 3:15 PM & EOD force-close at 3:25", icon: "📈", auto: autoBuy,  setAuto: setAutoBuy,  interval: "auto at 3:15 PM" },
              { key: "eod-summary",  label: "EOD Summary",      desc: "Send today's P&L summary to Telegram",             icon: "📊" },
              { key: "token-health", label: "Token Health",     desc: "Check Kite token validity and alert via Telegram",  icon: "🔑" },
            ];

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.25s ease" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>⚙️ Trading Engine</h2>
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text3)" }}>
                      Direct API triggers — runs in your browser, no cron jobs needed
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: isOpen ? "rgba(0,229,153,.08)" : "rgba(255,71,87,.08)", border: `1px solid ${isOpen ? "rgba(0,229,153,.25)" : "rgba(255,71,87,.25)"}`, borderRadius: 8 }}>
                      <StatusDot ok={isOpen} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: isOpen ? "var(--green)" : "var(--red)" }}>
                        {isOpen ? "Market Open" : "Market Closed"}
                      </span>
                    </div>
                    <button onClick={fetchEngineStatus} style={{ ...btnStyle("default"), padding: "6px 10px", fontSize: 12 }}>↻ Status</button>
                  </div>
                </div>

                {/* Auto-pilot banner */}
                <div style={{ padding: "12px 16px", background: (autoSell || autoBuy) ? "rgba(0,229,153,.06)" : "rgba(255,211,42,.05)", border: `1px solid ${(autoSell || autoBuy) ? "rgba(0,229,153,.2)" : "rgba(255,211,42,.2)"}`, borderRadius: 8, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: (autoSell || autoBuy) ? "var(--green)" : "var(--yellow)" }}>
                    {(autoSell || autoBuy) ? "🟢 Auto-pilot ON — keep this tab open during market hours" : "⚡ Auto-pilot OFF — toggle to start automated polling"}
                  </span>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                      <Toggle checked={autoSell} onChange={() => { setAutoSell(!autoSell); if (!autoSell) runJob("sell-check"); }} />
                      <span>Auto Sell (30s)</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                      <Toggle checked={autoBuy} onChange={() => { setAutoBuy(!autoBuy); if (!autoBuy) runJob("buy-signals"); }} />
                      <span>Auto Buy (3 min)</span>
                    </label>
                  </div>
                </div>

                {/* Job cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                  {jobs.map((job) => {
                    const state = engineStatus.jobs?.find((j) => j.name === job.key) || {};
                    const isAutoOn = job.auto;
                    const lastRun  = state.lastRun ? new Date(state.lastRun).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
                    const statusOk = state.lastStatus === "ok";
                    const isExpanded = expandedJob === job.key;
                    return (
                      <div key={job.key} style={{ background: "var(--bg1)", border: `1px solid ${isExpanded ? "rgba(124,131,253,.4)" : isAutoOn ? "rgba(0,229,153,.25)" : "var(--border)"}`, borderRadius: 10, overflow: "hidden" }}>
                        <div
                          style={{ padding: 16, cursor: "pointer" }}
                          onClick={() => setExpandedJob(isExpanded ? null : job.key)}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 700 }}>{job.icon} {job.label}
                                <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 6 }}>{isExpanded ? "▲" : "▼"}</span>
                              </div>
                              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>{job.desc}</div>
                            </div>
                            {isAutoOn && (
                              <Badge type="green">{job.interval}</Badge>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                            <div style={{ fontSize: 11, color: "var(--text3)" }}>
                              {lastRun
                                ? <span>Last: <span style={{ color: statusOk ? "var(--green)" : "var(--red)", fontFamily: "var(--font-mono)" }}>{lastRun}</span> <Badge type={statusOk ? "green" : "red"}>{state.lastStatus}</Badge></span>
                                : <span style={{ color: "var(--text3)" }}>Never run</span>
                              }
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); runJob(job.key); }}
                              style={{ ...btnStyle("accent"), padding: "5px 12px", fontSize: 12 }}
                            >
                              ▶ Run Now
                            </button>
                          </div>
                        </div>
                        {isExpanded && <LogicPanel logic={ENGINE_LOGIC[job.key]} />}
                      </div>
                    );
                  })}
                </div>

                {/* Live engine log */}
                <Card title="Engine Log" action={
                  <button onClick={() => setEngineLog([])} style={{ ...btnStyle("default"), padding: "3px 8px", fontSize: 11 }}>Clear</button>
                }>
                  {engineLog.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 20, color: "var(--text3)", fontSize: 12 }}>No activity yet — run a job or enable auto-pilot</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto" }}>
                      {engineLog.map((entry, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, padding: "8px 10px", background: "var(--bg2)", borderRadius: 6, border: `1px solid ${entry.ok ? "var(--border)" : "rgba(255,71,87,.2)"}`, fontSize: 12 }}>
                          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text3)", whiteSpace: "nowrap" }}>{entry.ts}</span>
                          <span style={{ fontWeight: 600, color: entry.ok ? "var(--green)" : "var(--red)", whiteSpace: "nowrap" }}>{entry.job}</span>
                          <span style={{ color: "var(--text2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {entry.result?.skipped
                              ? `⏭ Skipped — ${entry.result.reason}`
                              : entry.result?.error
                              ? `❌ ${entry.result.error}`
                              : entry.result?.sells?.length > 0
                              ? `📉 ${entry.result.sells.length} sell(s): ${entry.result.sells.map(s => s.sym).join(", ")}`
                              : entry.result?.signals?.length > 0
                              ? `🔍 ${entry.result.signals.length} signal(s) found`
                              : entry.result?.actions?.length > 0
                              ? `📈 ${entry.result.actions.length} action(s): ${entry.result.actions.map(a => `${a.type} ${a.sym}`).join(", ")}`
                              : entry.result?.ok
                              ? "✅ OK"
                              : JSON.stringify(entry.result).slice(0, 80)
                            }
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            );
          })()}

          {/* ── CRONS ── */}
          {tab === "Crons" && (
            <div style={{ animation: "fadeIn 0.25s ease" }}>
              <Card title="Scheduled Jobs" action={
                <button onClick={fetchCrons} style={{ ...btnStyle("default"), padding: "4px 10px", fontSize: 11 }}>
                  {loading.crons ? <Spinner /> : "↻ Refresh"}
                </button>
              }>
                <CronsPanel crons={crons} loading={loading.crons} onToggle={toggleCron} />
              </Card>
              <div style={{ marginTop: 12, padding: "12px 16px", background: "rgba(255,211,42,.05)", border: "1px solid rgba(255,211,42,.2)", borderRadius: 8, fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
                <strong style={{ color: "var(--yellow)" }}>⚠️ Note:</strong> Cron jobs are triggered by Vercel on the schedule defined in <span className="mono">vercel.json</span>.
                The toggles here disable execution logic but Vercel will still call the endpoint.
                Cron jobs only run on <strong style={{ color: "var(--text)" }}>trading days (Mon–Fri)</strong> and respect <strong style={{ color: "var(--text)" }}>market hours</strong> internally.
              </div>
            </div>
          )}

          {/* ── TELEGRAM ── */}
          {tab === "Telegram" && (
            <div style={{ animation: "fadeIn 0.25s ease" }}>
              <Card title="Telegram Notification Log" action={
                <button onClick={fetchTelegramLog} style={{ ...btnStyle("default"), padding: "4px 10px", fontSize: 11 }}>
                  {loading.telegram ? <Spinner /> : "↻ Refresh"}
                </button>
              }>
                <TelegramLog messages={telegramLog} loading={loading.telegram} />
              </Card>
            </div>
          )}

          {/* ── SCREENER ── */}
          {tab === "Screener" && (
            <div style={{ animation: "fadeIn 0.25s ease" }}>
              <Card title="Intraday Gainers — Nifty 200" action={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {[1, 2, 3, 5].map((v) => (
                    <button key={v} onClick={() => setGainerMinPct(v)} style={{
                      ...btnStyle(gainerMinPct === v ? "primary" : "default"),
                      padding: "3px 10px", fontSize: 11,
                    }}>
                      ≥{v}%
                    </button>
                  ))}
                  <button onClick={() => fetchGainers(gainerMinPct)} disabled={loading.gainers} style={{ ...btnStyle("default"), padding: "3px 10px", fontSize: 11 }}>
                    {loading.gainers ? <Spinner /> : "↻ Refresh"}
                  </button>
                  {gainerLastFetch && (
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>
                      {gainerLastFetch.toLocaleTimeString("en-IN")}
                    </span>
                  )}
                </div>
              }>
                {gainerError ? (
                  <div style={{ padding: "12px 16px", background: "rgba(255,71,87,.08)", border: "1px solid rgba(255,71,87,.25)", borderRadius: 8, color: "var(--red)", fontSize: 13 }}>
                    ❌ {gainerError}
                  </div>
                ) : loading.gainers && gainers.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 32, color: "var(--text3)" }}>Scanning {gainerUniverse ?? "Nifty 200"} symbols…</div>
                ) : gainers.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 32, color: "var(--text3)" }}>
                    No stocks up ≥{gainerMinPct}% across {gainerUniverse ?? "—"} symbols scanned.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
                      <strong style={{ color: "var(--text)" }}>{gainers.length}</strong> stocks up ≥{gainerMinPct}% today
                      {gainerUniverse && <span> · scanned {gainerUniverse} symbols</span>}
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text3)" }}>
                            <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600 }}>#</th>
                            <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600 }}>Symbol</th>
                            <th style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>CMP</th>
                            <th style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>Prev Close</th>
                            <th style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>Change</th>
                            <th style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>Gain %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gainers.map((g, i) => (
                            <tr key={g.symbol} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.02)" }}>
                              <td style={{ padding: "8px 10px", color: "var(--text3)", fontSize: 11 }}>{i + 1}</td>
                              <td style={{ padding: "8px 10px", fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)", letterSpacing: "0.02em" }}>{g.symbol}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--green)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                                ₹{g.ltp.toFixed(2)}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--text2)", fontFamily: "var(--font-mono)" }}>
                                ₹{g.prevClose.toFixed(2)}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--green)", fontFamily: "var(--font-mono)" }}>
                                +₹{g.change.toFixed(2)}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right" }}>
                                <span style={{
                                  background: g.changePct >= 3 ? "rgba(0,200,83,.2)" : "rgba(0,229,153,.12)",
                                  color: "var(--green)", borderRadius: 4,
                                  padding: "2px 8px", fontSize: 12, fontWeight: 700,
                                }}>
                                  +{g.changePct.toFixed(2)}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
