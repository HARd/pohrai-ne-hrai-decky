import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import {
  callable,
  definePlugin,
  routerHook,
  toaster,
} from "@decky/api";
import { useEffect, useState } from "react";
import { FaFlag } from "react-icons/fa";
import {
  startSteamUiInjection,
  stopSteamUiInjection,
  updateSteamUiInjectionSettings,
} from "./injector";
import {
  getLocalAppStatus,
  getLocalDatabaseStats,
  getLocalSettings,
  refreshLocalDatabaseFromRemote,
  saveLocalSettings,
  searchLocalDatabase,
} from "./localBackend";
import { patchLibraryApp } from "./patchLibraryApp";
import { initStorePatch, refreshStorePatch } from "./storePatch";
import type { AppStatus, DatabaseStats, InjectionDiagnostics, PluginSettings, SearchResults } from "./types";

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

const getAppStatus = callable<[appid: string], AppStatus>("get_app_status");
const getSettings = callable<[], PluginSettings>("get_settings");
const saveSettings = callable<[settings: PluginSettings], PluginSettings>("save_settings");
const getDatabaseStats = callable<[], DatabaseStats>("get_database_stats");
const searchDatabase = callable<[query: string, limit?: number], SearchResults>("search_database");

const BACKEND_TIMEOUT_MS = 1800;
let activeSettings = getLocalSettings();

const EMPTY_DIAGNOSTICS: InjectionDiagnostics = {
  scans: 0,
  candidates: 0,
  appids: [],
  marked: 0,
  currentAppid: null,
  lastType: null,
  lastError: null,
  route: "",
};

function Content() {
  const [settings, setSettings] = useState<PluginSettings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<InjectionDiagnostics>(EMPTY_DIAGNOSTICS);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ hostile: [], ukrainian: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const localSettings = getLocalSettings();
    activeSettings = localSettings;
    setSettings(localSettings);
    setStats(getLocalDatabaseStats());
    void refreshLocalDatabaseFromRemote(localSettings).then((nextStats) => {
      if (mounted) setStats(nextStats);
    });
    startSteamUiInjection(getResolvedAppStatus, localSettings, setDiagnostics);

    void Promise.all([
      withTimeout(getSettings(), BACKEND_TIMEOUT_MS, "get_settings"),
      withTimeout(getDatabaseStats(), BACKEND_TIMEOUT_MS, "get_database_stats"),
    ])
      .then(([loadedSettings, loadedStats]) => {
        if (!mounted) return;
        const merged = { ...DEFAULT_SETTINGS, ...loadedSettings };
        activeSettings = merged;
        setBackendError(null);
        setSettings(merged);
        setStats(loadedStats);
        void refreshLocalDatabaseFromRemote(merged).then((nextStats) => {
          if (mounted) setStats(nextStats);
        });
        startSteamUiInjection(getAppStatus, merged, setDiagnostics);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : String(error);
        setBackendError(message);
        startSteamUiInjection(getResolvedAppStatus, localSettings, setDiagnostics);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!query.trim()) {
        setResults({ hostile: [], ukrainian: [] });
        return;
      }
      const localResults = searchLocalDatabase(query, 12);
      setResults(localResults);
      if (activeSettings.remoteDatabaseEnabled) return;
      void withTimeout(searchDatabase(query, 12), BACKEND_TIMEOUT_MS, "search_database")
        .then(setResults)
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const updateSetting = <K extends keyof PluginSettings>(key: K, value: PluginSettings[K]) => {
    const next = { ...settings, [key]: value };
    activeSettings = next;
    setSettings(next);
    updateSteamUiInjectionSettings(next);
    refreshStorePatch();
  };

  const persistSettings = async () => {
    setSaving(true);
    try {
      const localSaved = saveLocalSettings(settings);
      activeSettings = localSaved;
      setSettings(localSaved);
      updateSteamUiInjectionSettings(localSaved);
      const saved = await withTimeout(saveSettings(localSaved), BACKEND_TIMEOUT_MS, "save_settings").catch(() => localSaved);
      activeSettings = saved;
      setSettings(saved);
      updateSteamUiInjectionSettings(saved);
      setStats(await refreshLocalDatabaseFromRemote(saved, true));
      refreshStorePatch();
      toaster.toast({ title: "POHRAI/NE HRAI", body: "Налаштування збережено" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PanelSection title="Маркування Steam UI">
        <PanelSectionRow>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settings.markHostile}
              onChange={(event) => updateSetting("markHostile", event.currentTarget.checked)}
            />
            <span>Маркувати ворожих розробників</span>
          </label>
        </PanelSectionRow>
        <PanelSectionRow>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settings.markUkrainian}
              onChange={(event) => updateSetting("markUkrainian", event.currentTarget.checked)}
            />
            <span>Маркувати українських розробників</span>
          </label>
        </PanelSectionRow>
        <PanelSectionRow>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settings.showBadges}
              onChange={(event) => updateSetting("showBadges", event.currentTarget.checked)}
            />
            <span>Показувати бейджі на картках</span>
          </label>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={fieldStyle}>
            <span>Прозорість: {Math.round(settings.overlayOpacity * 100)}%</span>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={settings.overlayOpacity}
              onChange={(event) => updateSetting("overlayOpacity", Number(event.currentTarget.value))}
            />
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={colorGridStyle}>
            <label style={fieldStyle}>
              <span>Ворожий</span>
              <input
                type="color"
                value={settings.hostileColor}
                onChange={(event) => updateSetting("hostileColor", event.currentTarget.value)}
              />
            </label>
            <label style={fieldStyle}>
              <span>Дружній</span>
              <input
                type="color"
                value={settings.ukrainianColor}
                onChange={(event) => updateSetting("ukrainianColor", event.currentTarget.value)}
              />
            </label>
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={saving} onClick={persistSettings}>
            {saving ? "Збереження..." : "Зберегти"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Діагностика">
        <PanelSectionRow>
          <div style={mutedStyle}>
            {`Сканів: ${diagnostics.scans}, кандидатів: ${diagnostics.candidates}, позначок: ${diagnostics.marked}`}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={mutedStyle}>
            {`Поточний appid: ${diagnostics.currentAppid || "не знайдено"}`}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={mutedStyle}>
            {`Знайдені appid: ${diagnostics.appids.length ? diagnostics.appids.join(", ") : "немає"}`}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={mutedStyle}>
            {`Останній тип: ${diagnostics.lastType || "немає"}${diagnostics.lastError ? `, помилка: ${diagnostics.lastError}` : ""}`}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={mutedStyle}>
            {`Route: ${diagnostics.route || "немає"}`}
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="База">
        <PanelSectionRow>
          <div style={mutedStyle}>
            {stats
              ? `Версія ${stats.version}: ${stats.ukrainianCount} українських, ${stats.hostileCount} ворожих, кеш ${stats.cacheCount}, джерело ${stats.source === "remote" ? "Firebase" : "вбудована"}${stats.lastRemoteError ? `, Firebase: ${stats.lastRemoteError}` : ""}`
              : backendError
                ? `Backend error: ${backendError}`
                : "Завантаження бази..."}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settings.remoteDatabaseEnabled}
              onChange={(event) => updateSetting("remoteDatabaseEnabled", event.currentTarget.checked)}
            />
            <span>Використовувати Firebase Realtime Database</span>
          </label>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={fieldStyle}>
            <span>Firebase REST URL</span>
            <input
              style={searchStyle}
              type="text"
              value={settings.remoteDatabaseUrl}
              placeholder="https://PROJECT-default-rtdb.REGION.firebasedatabase.app/pohrai-ne-hrai"
              onChange={(event) => updateSetting("remoteDatabaseUrl", event.currentTarget.value)}
            />
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <input
            style={searchStyle}
            type="text"
            value={query}
            placeholder="Пошук розробника"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ResultList title="Дружній" items={results.ukrainian} color={settings.ukrainianColor} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ResultList title="Ворожий" items={results.hostile} color={settings.hostileColor} />
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

function ResultList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items.length) return <div style={mutedStyle}>{title}: немає збігів</div>;

  return (
    <div style={fieldStyle}>
      <strong style={{ color }}>{title}</strong>
      <div style={resultListStyle}>
        {items.map((item) => (
          <div key={`${title}-${item}`} style={resultItemStyle}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "13px",
} as const;

const fieldStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  width: "100%",
  fontSize: "13px",
} as const;

const colorGridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "10px",
  width: "100%",
} as const;

const mutedStyle = {
  color: "#b8bcbf",
  fontSize: "12px",
  lineHeight: 1.35,
} as const;

const searchStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px",
  borderRadius: "4px",
  border: "1px solid rgba(255,255,255,.2)",
  background: "rgba(0,0,0,.25)",
  color: "#fff",
} as const;

const resultListStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  maxHeight: "160px",
  overflow: "auto",
} as const;

const resultItemStyle = {
  padding: "4px 0",
  borderBottom: "1px solid rgba(255,255,255,.08)",
  fontSize: "12px",
} as const;

export default definePlugin(() => {
  console.log("[POHRAI/NE HRAI] initializing");

  const libraryPatch = patchLibraryApp(getResolvedAppStatus);
  const stopStorePatch = initStorePatch(getResolvedAppStatus, () => activeSettings);
  startSteamUiInjection(getResolvedAppStatus, getLocalSettings());

  return {
    name: "POHRAI/NE HRAI",
    titleView: <div className={staticClasses.Title}>POHRAI/NE HRAI</div>,
    content: <Content />,
    icon: <FaFlag />,
    onDismount() {
      routerHook.removePatch("/library/app/:appid", libraryPatch);
      stopStorePatch();
      stopSteamUiInjection();
    },
  };
});

async function getResolvedAppStatus(appid: string): Promise<AppStatus> {
  if (activeSettings.remoteDatabaseEnabled) {
    return getLocalAppStatus(appid).catch(() => withTimeout(getAppStatus(appid), BACKEND_TIMEOUT_MS, "get_app_status"));
  }
  return withTimeout(getAppStatus(appid), BACKEND_TIMEOUT_MS, "get_app_status").catch(() => getLocalAppStatus(appid));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}
