import { fetchNoCors } from "@decky/api";
import { developerDatabase } from "./developers";
import type { AppStatus, DatabaseStats, PluginSettings, SearchResults } from "./types";

const DEFAULT_SETTINGS: PluginSettings = {
  markHostile: true,
  markUkrainian: true,
  hostileColor: "#7a2a2a",
  ukrainianColor: "#27ae60",
  overlayOpacity: 0.35,
  showBadges: true,
};

const SETTINGS_KEY = "pohrai-ne-hrai-settings";
const CACHE_KEY = "pohrai-ne-hrai-appdetails-cache";
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type CachedInfo = {
  developers: string[];
  publishers: string[];
  fetchedAt: number;
};

const hostileSet = new Set<string>(developerDatabase.hostile);
const ukrainianSet = new Set<string>(developerDatabase.ukrainian);

export function getLocalDatabaseStats(): DatabaseStats {
  return {
    version: developerDatabase.version,
    hostileCount: developerDatabase.hostile.length,
    ukrainianCount: developerDatabase.ukrainian.length,
    cacheCount: Object.keys(loadCache()).length,
  };
}

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

export function searchLocalDatabase(query: string, limit = 40): SearchResults {
  const needle = query.trim().toLowerCase();
  if (!needle) return { hostile: [], ukrainian: [] };
  const cappedLimit = Math.max(1, Math.min(limit, 100));
  return {
    hostile: developerDatabase.hostile.filter((name) => name.toLowerCase().includes(needle)).slice(0, cappedLimit),
    ukrainian: developerDatabase.ukrainian.filter((name) => name.toLowerCase().includes(needle)).slice(0, cappedLimit),
  };
}

export async function getLocalAppStatus(appid: string): Promise<AppStatus> {
  const normalized = String(appid).trim();
  if (!normalized) return emptyStatus(normalized);

  const cache = loadCache();
  const cached = cache[normalized];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return markStatus(normalized, cached.developers, cached.publishers);
  }

  const info = await fetchAppDetails(normalized);
  if (!info) return emptyStatus(normalized);

  cache[normalized] = { ...info, fetchedAt: Date.now() };
  saveCache(cache);
  return markStatus(normalized, info.developers, info.publishers);
}

function markStatus(appid: string, developers: string[], publishers: string[]): AppStatus {
  const settings = getLocalSettings();
  const names = [...developers, ...publishers];
  const hostile = names.filter((name) => hostileSet.has(name));
  const ukrainian = names.filter((name) => ukrainianSet.has(name));
  let type: AppStatus["type"] = null;
  if (settings.markHostile && hostile.length) type = "hostile";
  else if (settings.markUkrainian && ukrainian.length) type = "ukrainian";

  return {
    appid,
    type,
    developers,
    publishers,
    matches: { hostile, ukrainian },
  };
}

function emptyStatus(appid: string): AppStatus {
  return {
    appid,
    type: null,
    developers: [],
    publishers: [],
    matches: { hostile: [], ukrainian: [] },
  };
}

async function fetchAppDetails(appid: string): Promise<{ developers: string[]; publishers: string[] } | null> {
  try {
    const response = await fetchNoCors(`https://store.steampowered.com/api/appdetails?appids=${appid}`, {
      method: "GET",
      credentials: "omit",
    });
    if (!response.ok) return null;
    const json = await response.json();
    const entry = json?.[appid];
    if (!entry?.success || !entry?.data) return null;
    return {
      developers: entry.data.developers || [],
      publishers: entry.data.publishers || [],
    };
  } catch (error) {
    console.warn("[POHRAI/NE HRAI] local appdetails fetch failed", appid, error);
    return null;
  }
}

function loadCache(): Record<string, CachedInfo> {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CachedInfo>): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}
