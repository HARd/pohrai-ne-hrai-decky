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
  getLocalSettings,
  saveLocalSettings,
} from "./localBackend";
import { patchLibraryApp } from "./patchLibraryApp";
import { initStorePatch, refreshStorePatch } from "./storePatch";
import type { AppStatus, PluginSettings, DatabaseStats } from "./types";

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
const refreshDatabase = callable<[force: boolean], DatabaseStats>("refresh_database");
const getDatabaseStats = callable<[], DatabaseStats>("get_database_stats");

const BACKEND_TIMEOUT_MS = 1800;
let activeSettings = getLocalSettings();

function Content() {
  const [settings, setSettings] = useState<PluginSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const localSettings = getLocalSettings();
    activeSettings = localSettings;
    setSettings(localSettings);
    startSteamUiInjection(getResolvedAppStatus, localSettings);

    void withTimeout(getSettings(), BACKEND_TIMEOUT_MS, "get_settings")
      .then((loadedSettings) => {
        if (!mounted) return;
        const merged = { ...DEFAULT_SETTINGS, ...loadedSettings };
        activeSettings = merged;
        setSettings(merged);
        startSteamUiInjection(getResolvedAppStatus, merged);
      })
      .catch(() => {
        if (!mounted) return;
        startSteamUiInjection(getResolvedAppStatus, localSettings);
      });

    void withTimeout(getDatabaseStats(), BACKEND_TIMEOUT_MS, "get_database_stats")
      .then((s: any) => {
        if (!mounted) return;
        if (s && s.error) {
          setStatsError(s.error);
        } else {
          setStats(s);
          setStatsError(null);
        }
      })
      .catch((err) => {
        if (mounted) setStatsError(String(err));
      });

    return () => {
      mounted = false;
    };
  }, []);

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
      refreshStorePatch();
      toaster.toast({ title: "POHRAI/NE HRAI", body: "Налаштування збережено" });
    } finally {
      setSaving(false);
    }
  };

  const forceRefresh = async () => {
    setSyncing(true);
    try {
      const newStats = await withTimeout(refreshDatabase(true), BACKEND_TIMEOUT_MS, "refresh_database");
      setStats(newStats);
      toaster.toast({ title: "POHRAI/NE HRAI", body: "Базу даних оновлено" });
    } catch {
      toaster.toast({ title: "POHRAI/NE HRAI", body: "Помилка оновлення бази" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <PanelSection title="Інформація про базу">
        <PanelSectionRow>
          <div style={fieldStyle}>
            {statsError ? (
              <span style={{ color: "#e74c3c" }}>Помилка завантаження бекенду: {statsError}</span>
            ) : stats ? (
              <>
                <span>Джерело: {stats.source === "remote" ? "Хмарна база" : "Вбудована база"}</span>
                <span>Версія: {stats.version}</span>
                <span>Ворожих розробників: {stats.hostileCount}</span>
                <span>Українських: {stats.ukrainianCount}</span>
                {stats.lastRemoteError && (
                  <span style={{ color: "#e74c3c", marginTop: "4px" }}>
                    Помилка синхронізації: {stats.lastRemoteError}
                  </span>
                )}
              </>
            ) : (
              <span>Завантаження...</span>
            )}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={saving || syncing} onClick={forceRefresh}>
            {syncing ? "Оновлення..." : "Оновити базу даних"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

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
          <ButtonItem layout="below" disabled={saving || syncing} onClick={persistSettings}>
            {saving ? "Збереження..." : "Зберегти"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
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
  return getAppStatus(appid);
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
