import { useParams } from "@decky/ui";
import { useEffect, useState } from "react";
import type { AppStatus, PluginSettings } from "./types";
import { UkrIcon, RusIcon } from "./icons";
import { t } from "./i18n";

type Props = {
  lookup: (appid: string) => Promise<AppStatus>;
  getSettings: () => PluginSettings;
  placement?: "library" | "store";
};

export default function GamePageBadge({ lookup, getSettings, placement = "library" }: Props) {
  const { appid } = useParams<{ appid: string }>();
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [settings, setLocalSettings] = useState(getSettings());

  useEffect(() => {
    const listener = () => setLocalSettings(getSettings());
    window.addEventListener("pohrai-settings-changed", listener);
    return () => window.removeEventListener("pohrai-settings-changed", listener);
  }, [getSettings]);

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

  const isIcon = settings.libraryBadgeStyle === "icon";
  const iconSrc = status.type === "hostile" ? RusIcon : UkrIcon;
  const color = status.type === "hostile" ? settings.hostileColor : settings.ukrainianColor;
  const label = status.type === "hostile" ? t(settings.language, "badge_hostile") : t(settings.language, "badge_friendly");
  const matches = [...status.matches.hostile, ...status.matches.ukrainian].join(", ");

  const positionStyles = getLibraryPositionStyles(settings.libraryBadgePosition);
  const containerStyle = placement === "store" ? storeContainerStyle : { ...libraryContainerStyle, ...positionStyles };

  if (isIcon) {
    return (
      <div style={containerStyle}>
        <img 
          src={iconSrc} 
          alt={label} 
          style={{ width: "128px", height: "auto", filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.6))" }} 
        />
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ ...badgeStyle, backgroundColor: color }}>
        <strong>{label}</strong>
        {matches && <span style={matchStyle}>{matches}</span>}
      </div>
    </div>
  );
}

function getLibraryPositionStyles(pos: string) {
  switch (pos) {
    case "top-left":
      return { top: "58px", left: "22px", right: "auto" };
    case "top-right":
      return { top: "58px", right: "22px", left: "auto" };
    case "bottom-left":
      return { top: "170px", left: "22px", right: "auto" };
    case "bottom-right":
    default:
      return { top: "170px", right: "22px", left: "auto" };
  }
}

const libraryContainerStyle = {
  position: "absolute",
  top: "170px",
  right: "22px",
  zIndex: 20,
  pointerEvents: "none",
} as const;

const storeContainerStyle = {
  position: "fixed",
  top: "72px",
  right: "92px",
  zIndex: 999999,
  pointerEvents: "none",
} as const;

const badgeStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  maxWidth: "520px",
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
