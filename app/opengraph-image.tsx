import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Project Ophanim: know your IOCs at a glance";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "32px",
          padding: "80px",
          backgroundColor: "#FFFDF6",
          backgroundImage:
            "radial-gradient(rgba(73,73,73,0.10) 1.5px, transparent 1.5px)",
          backgroundSize: "32px 32px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <svg width="96" height="96" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill="#2b2b2b" />
            <path
              d="M4 16 C 9 8.5, 23 8.5, 28 16 C 23 23.5, 9 23.5, 4 16 Z"
              fill="none"
              stroke="#FFFDF6"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="16" r="5" fill="#f59e0b" />
            <circle cx="16" cy="16" r="1.9" fill="#2b2b2b" />
          </svg>
          <span style={{ fontSize: "72px", fontWeight: 700, color: "#353535" }}>
            Project Ophanim
          </span>
        </div>
        <span style={{ fontSize: "38px", color: "#6b7280" }}>
          Check an IP, domain, or file hash against many threat-intel sources.
        </span>
      </div>
    ),
    size,
  );
}
