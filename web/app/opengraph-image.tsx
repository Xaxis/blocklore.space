import { ImageResponse } from "next/og";
import { bundle } from "@/lib/data";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Blocklore: a library of Bitcoin facts that checks itself.";

export default function OpenGraph() {
  const s = bundle.stats;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#f6f3ec",
        color: "#1c1a16",
        padding: "72px 80px",
        fontFamily: "serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40 }}>
        <svg viewBox="0 0 32 32" width="64" height="64" aria-hidden="true">
          <rect
            x="3"
            y="3"
            width="26"
            height="26"
            rx="4"
            fill="none"
            stroke="#1c1a16"
            strokeWidth="2.5"
          />
          <path
            d="M9 12h14M9 17h14M9 22h8"
            stroke="#1c1a16"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <rect x="20" y="19" width="6" height="6" rx="1" fill="#f7931a" />
        </svg>
        Blocklore
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: -2 }}>
          A library of Bitcoin facts
        </div>
        <div
          style={{
            fontSize: 76,
            lineHeight: 1.05,
            letterSpacing: -2,
            color: "#b5400b",
            fontStyle: "italic",
          }}
        >
          that checks itself.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 40,
          fontSize: 26,
          color: "#47433b",
          fontFamily: "monospace",
        }}
      >
        <span>{s.claims} claims</span>
        <span>{s.sources} sources</span>
        <span>{s.checks} chain and code checks</span>
        <span>block {bundle.generated.height.toLocaleString("en-US")}</span>
      </div>
    </div>,
    size,
  );
}
