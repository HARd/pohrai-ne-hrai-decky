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
  remoteDatabaseEnabled: true,
  remoteDatabaseUrl: "https://hrai-decky-default-rtdb.europe-west1.firebasedatabase.app/",
};

const SETTINGS_KEY = "pohrai-ne-hrai-settings";
const CACHE_KEY = "pohrai-ne-hrai-appdetails-cache";
const REMOTE_DATABASE_CACHE_KEY = "pohrai-ne-hrai-remote-database-cache";
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const REMOTE_DATABASE_TTL_MS = 60 * 60 * 1000;

type CachedInfo = {
  developers: string[];
  publishers: string[];
  fetchedAt: number;
};

type DeveloperDatabase = {
  version: string;
  source?: string;
  hostile: readonly string[];
  ukrainian: readonly string[];
};

type RemoteDatabaseCache = {
  url: string;
  fetchedAt: number;
  database: DeveloperDatabase;
};

let activeDatabase: DeveloperDatabase = developerDatabase;
let activeDatabaseSource: DatabaseStats["source"] = "bundled";
let activeRemoteUrl = "";
let lastRemoteError: string | null = null;
let hostileSet = new Set<string>(activeDatabase.hostile);
let ukrainianSet = new Set<string>(activeDatabase.ukrainian);

export function getLocalDatabaseStats(): DatabaseStats {
  return {
    version: activeDatabase.version,
    hostileCount: activeDatabase.hostile.length,
    ukrainianCount: activeDatabase.ukrainian.length,
    cacheCount: Object.keys(loadCache()).length,
    source: activeDatabaseSource,
    remoteUrl: activeRemoteUrl || undefined,
    lastRemoteError,
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
    hostile: activeDatabase.hostile.filter((name) => name.toLowerCase().includes(needle)).slice(0, cappedLimit),
    ukrainian: activeDatabase.ukrainian.filter((name) => name.toLowerCase().includes(needle)).slice(0, cappedLimit),
  };
}

export async function refreshLocalDatabaseFromRemote(settings = getLocalSettings(), force = false): Promise<DatabaseStats> {
  if (!settings.remoteDatabaseEnabled || !settings.remoteDatabaseUrl.trim()) {
    setActiveDatabase(developerDatabase, "bundled", "");
    lastRemoteError = null;
    return getLocalDatabaseStats();
  }

  const url = toFirebaseJsonUrl(settings.remoteDatabaseUrl);
  const cached = loadRemoteDatabaseCache();
  if (!force && cached?.url === url && Date.now() - cached.fetchedAt < REMOTE_DATABASE_TTL_MS) {
    setActiveDatabase(cached.database, "remote", url);
    lastRemoteError = null;
    return getLocalDatabaseStats();
  }

  try {
    const response = await fetchNoCors(url, { method: "GET", credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = validateDeveloperDatabase(await response.json());
    saveRemoteDatabaseCache({ url, fetchedAt: Date.now(), database: payload });
    setActiveDatabase(payload, "remote", url);
    lastRemoteError = null;
  } catch (error) {
    lastRemoteError = error instanceof Error ? error.message : String(error);
    if (cached?.url === url) {
      setActiveDatabase(cached.database, "remote", url);
    } else {
      setActiveDatabase(developerDatabase, "bundled", "");
    }
  }

  return getLocalDatabaseStats();
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

function setActiveDatabase(database: DeveloperDatabase, source: DatabaseStats["source"], remoteUrl: string): void {
  activeDatabase = database;
  activeDatabaseSource = source;
  activeRemoteUrl = remoteUrl;
  hostileSet = new Set(database.hostile);
  ukrainianSet = new Set(database.ukrainian);
}

function validateDeveloperDatabase(payload: any): DeveloperDatabase {
  if (!payload || !Array.isArray(payload.hostile) || !Array.isArray(payload.ukrainian)) {
    throw new Error("Remote database must contain hostile[] and ukrainian[] arrays");
  }

  return {
    version: String(payload.version || "remote"),
    source: typeof payload.source === "string" ? payload.source : "Firebase Realtime Database",
    hostile: payload.hostile.filter((name: unknown): name is string => typeof name === "string"),
    ukrainian: payload.ukrainian.filter((name: unknown): name is string => typeof name === "string"),
  };
}

function toFirebaseJsonUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const [withoutHash] = trimmed.split("#");
  if (withoutHash.endsWith(".json") || withoutHash.includes(".json?")) return trimmed;

  try {
    const url = new URL(withoutHash);
    const path = url.pathname.replace(/\/+$/, "");
    const jsonPath = path ? `${path}.json` : "/.json";
    return `${url.origin}${jsonPath}${url.search}`;
  } catch {
    const [base, query] = withoutHash.split("?");
    const normalizedBase = base.replace(/\/+$/, "");
    return `${normalizedBase}.json${query ? `?${query}` : ""}`;
  }
}

function loadRemoteDatabaseCache(): RemoteDatabaseCache | null {
  const raw = localStorage.getItem(REMOTE_DATABASE_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveRemoteDatabaseCache(cache: RemoteDatabaseCache): void {
  localStorage.setItem(REMOTE_DATABASE_CACHE_KEY, JSON.stringify(cache));
}
