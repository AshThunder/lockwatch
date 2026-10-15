import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Lockwatch — Never miss an unlock. Never leave BTC idle.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const tile = (ch: string, w = 76) => (
  <div style={{ width: w, height: 104, background: "#1B1F23", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", color: "#F1EEE6", fontSize: 72, fontWeight: 700 }}>
    {ch}
    <div style={{ position: "absolute", left: 0, right: 0, top: 51, height: 2, background: "#0E1012" }} />
  </div>
);

export default function OG() {
  const rows: [string, string, string, string][] = [["THU", "00:00", "VEBTC LOCKS", "DEPARTING"], ["THU", "00:05", "KEEPER CLAIM", "ON TIME"], ["THU", "01:00", "VOTED LOCKS", "CLEARED"]];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#0E1012", display: "flex", flexDirection: "column", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 44, height: 34, background: "#F1EEE6", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
            <div style={{ width: 20, height: 5, background: "#F7931A", borderRadius: 3, marginTop: -10 }} />
          </div>
          <div style={{ color: "#F1EEE6", fontSize: 34, fontWeight: 800, letterSpacing: 4 }}>LOCKWATCH</div>
          <div style={{ marginLeft: "auto", color: "#A9ADAB", fontSize: 24, letterSpacing: 3 }}>MEZO · veBTC</div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 56 }}>{"THURSDAY".split("").map((c) => tile(c))}</div>
        <div style={{ display: "flex", flexDirection: "column", color: "#F1EEE6", fontSize: 58, fontWeight: 700, marginTop: 36, lineHeight: 1.08, maxWidth: 1000, letterSpacing: 1 }}><span>NEVER MISS AN UNLOCK.</span><span style={{ color: "#F7931A" }}>NEVER LEAVE BTC IDLE.</span></div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", gap: 10 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 28, fontSize: 26, color: i === 0 ? "#F7931A" : "#A9ADAB", letterSpacing: 2, borderTop: "2px solid #2C3238", paddingTop: 10 }}>
              <div style={{ width: 80 }}>{r[0]}</div><div style={{ width: 110 }}>{r[1]}</div><div style={{ flex: 1, color: "#F1EEE6" }}>{r[2]}</div><div>{r[3]}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
