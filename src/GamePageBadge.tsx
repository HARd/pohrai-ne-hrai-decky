import { useParams } from "@decky/ui";
import { useEffect, useState } from "react";
import type { AppStatus } from "./types";

type Props = {
  lookup: (appid: string) => Promise<AppStatus>;
};

export default function GamePageBadge({ lookup }: Props) {
  const { appid } = useParams<{ appid: string }>();
  const [status, setStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    if (!appid) return;

    void lookup(appid).then((nextStatus) => {
      if (!cancelled) setStatus(nextStatus);
    });

    return () => {
      cancelled = true;
    };
  }, [appid, lookup]);

  if (!status?.type) return null;

  const color = status.type === "hostile" ? "#7a2a2a" : "#27ae60";
  const label = status.type === "hostile" ? "NE HRAI" : "POHRAI";
  const matches = [...status.matches.hostile, ...status.matches.ukrainian].join(", ");

  return (
    <div style={containerStyle}>
      <div style={{ ...badgeStyle, backgroundColor: color }}>
        <strong>{label}</strong>
        {matches && <span style={matchStyle}>{matches}</span>}
      </div>
    </div>
  );
}

const containerStyle = {
  position: "absolute",
  top: "58px",
  right: "22px",
  zIndex: 20,
  pointerEvents: "none",
} as const;

const badgeStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  maxWidth: "420px",
  minHeight: "32px",
  padding: "7px 10px",
  borderRadius: "4px",
  color: "#fff",
  fontSize: "13px",
  lineHeight: 1.2,
  letterSpacing: 0,
  boxShadow: "0 4px 16px rgba(0,0,0,.45)",
  textShadow: "0 1px 1px rgba(0,0,0,.45)",
} as const;

const matchStyle = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;
