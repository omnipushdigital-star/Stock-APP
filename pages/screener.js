// pages/screener.js — Intraday Gainers screener
// Shows Nifty 200 stocks up more than N% today. One-click refresh, auto-refresh every 2 min.

import { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";
import Link from "next/link";

const DEFAULT_MIN_PCT = 1;

function fmt(n, dec = 2) {
  if (n == null) return "—";
  return Number(n).toFixed(dec);
}

function Badge({ pct }) {
  const color = pct >= 3 ? "#00c853" : pct >= 2 ? "#64dd17" : "#b2dfdb";
  return (
    <span style={{
      background: color, color: "#000", borderRadius: 4,
      padding: "2px 7px", fontSize: 12, fontWeight: 700,
    }}>
      +{fmt(pct)}%
    </span>
  );
}

export default function Screener() {
  const [minPct, setMinPct]     = useState(DEFAULT_MIN_PCT);
  const [gainers, setGainers]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const timerRef = useRef(null);

  const fetchGainers = useCallback(async (pct) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/market/gainers?minPct=${pct}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "API error");
      setGainers(d.gainers || []);
      setLastFetch(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + schedule auto-refresh every 2 min
  useEffect(() => {
    fetchGainers(minPct);
    timerRef.current = setInterval(() => fetchGainers(minPct), 2 * 60 * 1000);
    return () => clearInterval(timerRef.current);
  }, [minPct, fetchGainers]);

  function handleMinPctChange(val) {
    clearInterval(timerRef.current);
    setMinPct(val);
  }

  return (
    <>
      <Head>
        <title>Gainers Screener — Stock App</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ minHeight: "100vh", background: "#0f0f0f", color: "#e0e0e0", fontFamily: "system-ui, sans-serif" }}>

        {/* Header */}
        <div style={{ background: "#1a1a2e", borderBottom: "1px solid #333", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" style={{ color: "#7c83fd", textDecoration: "none", fontSize: 14 }}>← Dashboard</Link>
          <span style={{ fontWeight: 700, fontSize: 18 }}>📈 Intraday Gainers</span>
          <span style={{ fontSize: 12, color: "#888", marginLeft: "auto" }}>Nifty 200 universe</span>
        </div>

        <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px" }}>

          {/* Controls */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e1e1e", borderRadius: 8, padding: "8px 14px", border: "1px solid #333" }}>
              <span style={{ fontSize: 13, color: "#aaa" }}>Min gain</span>
              {[1, 2, 3, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => handleMinPctChange(v)}
                  style={{
                    padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
                    background: minPct === v ? "#7c83fd" : "#2a2a2a",
                    color: minPct === v ? "#fff" : "#aaa",
                  }}
                >
                  {v}%
                </button>
              ))}
            </div>

            <button
              onClick={() => fetchGainers(minPct)}
              disabled={loading}
              style={{
                padding: "8px 18px", borderRadius: 8, border: "none", cursor: loading ? "default" : "pointer",
                background: loading ? "#333" : "#7c83fd", color: "#fff", fontWeight: 600, fontSize: 13,
              }}
            >
              {loading ? "Fetching…" : "Refresh"}
            </button>

            {lastFetch && (
              <span style={{ fontSize: 12, color: "#666" }}>
                Updated {lastFetch.toLocaleTimeString("en-IN")} · auto-refreshes every 2 min
              </span>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: "#3d1212", border: "1px solid #c62828", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#ff8a80", fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* Summary */}
          {!loading && !error && (
            <div style={{ marginBottom: 14, fontSize: 14, color: "#aaa" }}>
              {gainers.length === 0
                ? `No stocks up more than ${minPct}% in Nifty 200 right now.`
                : <><strong style={{ color: "#e0e0e0" }}>{gainers.length}</strong> stocks up ≥ {minPct}% today</>}
            </div>
          )}

          {/* Table */}
          {gainers.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #333", color: "#888" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600 }}>#</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600 }}>Symbol</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>CMP</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>Prev Close</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>Change</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>Gain</th>
                  </tr>
                </thead>
                <tbody>
                  {gainers.map((g, i) => (
                    <tr
                      key={g.symbol}
                      style={{
                        borderBottom: "1px solid #222",
                        background: i % 2 === 0 ? "transparent" : "#151515",
                      }}
                    >
                      <td style={{ padding: "9px 10px", color: "#555" }}>{i + 1}</td>
                      <td style={{ padding: "9px 10px", fontWeight: 700, color: "#e0e0e0", letterSpacing: 0.3 }}>
                        {g.symbol}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", color: "#00e676", fontWeight: 600 }}>
                        ₹{fmt(g.ltp)}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", color: "#888" }}>
                        ₹{fmt(g.prevClose)}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", color: "#00e676" }}>
                        +₹{fmt(g.change)}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right" }}>
                        <Badge pct={g.changePct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && gainers.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#555" }}>
              Scanning Nifty 200…
            </div>
          )}
        </div>
      </div>
    </>
  );
}
