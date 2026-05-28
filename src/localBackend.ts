import type { PluginSettings } from "./types";

const DEFAULT_SETTINGS: PluginSettings = {
  markHostile: true,
  markUkrainian: true,
  hostileColor: "#7a2a2a",
  ukrainianColor: "#27ae60",
  overlayOpacity: 0.35,
  showBadges: true,
  remoteDatabaseEnabled: true,
  remoteDatabaseUrl: "https://hrai-decky-default-rtdb.europe-west1.firebasedatabase.app/",
};

const SETTINGS_KEY = "pohrai-ne-hrai-settings";

export function getLocalSettings(): PluginSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveLocalSettings(settings: PluginSettings): PluginSettings {
  const sanitized = {
    ...DEFAULT_SETTINGS,
    ...settings,
    overlayOpacity: Math.min(1, Math.max(0.05, Number(settings.overlayOpacity))),
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitized));
  return sanitized;
}
