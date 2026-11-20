import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f6f3ec",
      }}
    >
      <svg viewBox="0 0 32 32" width="132" height="132" aria-hidden="true">
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
    </div>,
    size,
  );
}
