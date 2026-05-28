import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  SliderField,
  DropdownItem,
  DropdownOption,
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
  libraryBadgePosition: "bottom-right",
  libraryBadgeStyle: "text",
};

const getAppStatus = callable<[appid: string], AppStatus>("get_app_status");
const getSettings = callable<[], PluginSettings>("get_settings");
const saveSettings = callable<[{ settings: PluginSettings }], PluginSettings>("save_settings");
const refreshDatabase = callable<[force: boolean], DatabaseStats>("refresh_database");
const getDatabaseStats = callable<[], DatabaseStats>("get_database_stats");

const COLOR_OPTIONS: DropdownOption[] = [
  { data: "#e74c3c", label: "Червоний" },
  { data: "#7a2a2a", label: "Темно-червоний" },
  { data: "#e67e22", label: "Помаранчевий" },
  { data: "#f1c40f", label: "Жовтий" },
  { data: "#27ae60", label: "Зелений" },
  { data: "#2980b9", label: "Синій" },
  { data: "#8e44ad", label: "Фіолетовий" },
  { data: "#2c3e50", label: "Темно-синій" },
  { data: "#bdc3c7", label: "Світло-сірий" },
];
const POSITION_OPTIONS: DropdownOption[] = [
  { data: "top-left", label: "Верхній лівий кут" },
  { data: "top-right", label: "Верхній правий кут" },
  { data: "bottom-left", label: "Знизу ліворуч" },
  { data: "bottom-right", label: "Знизу праворуч" },
];

const STYLE_OPTIONS: DropdownOption[] = [
  { data: "text", label: "Напис" },
  { data: "icon", label: "Іконка" },
];

const BACKEND_TIMEOUT_MS = 1800;
let activeSettings = getLocalSettings();
let fetchedFromPython = false;

function Content() {
  const [settings, setSettings] = useState<PluginSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setSettings(activeSettings);
    startSteamUiInjection(getResolvedAppStatus, activeSettings);

    if (!fetchedFromPython) {
      void withTimeout(getSettings(), BACKEND_TIMEOUT_MS, "get_settings")
        .then((loadedSettings) => {
          fetchedFromPython = true;
          if (!mounted) return;
          const merged = { ...DEFAULT_SETTINGS, ...loadedSettings };
          activeSettings = merged;
          setSettings(merged);
          saveLocalSettings(merged);
          startSteamUiInjection(getResolvedAppStatus, merged);
        })
        .catch(() => {
          fetchedFromPython = true;
        });
    }

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
    
    // Immediately save to localStorage to survive component unmounts 
    // (Decky DropdownItem pushes a new view and unmounts Content)
    saveLocalSettings(next);
    
    setSettings(next);
    updateSteamUiInjectionSettings(next);
    refreshStorePatch();
    window.dispatchEvent(new CustomEvent("pohrai-settings-changed"));
  };

  const persistSettings = async () => {
    setSaving(true);
    try {
      const localSaved = saveLocalSettings(settings);
      activeSettings = localSaved;
      setSettings(localSaved);
      updateSteamUiInjectionSettings(localSaved);
      const saved = await withTimeout(
        saveSettings({ settings: localSaved }),
        BACKEND_TIMEOUT_MS,
        "save_settings"
      ).catch((e) => {
        console.error("Failed to save settings to Python backend", e);
        return localSaved;
      });
      activeSettings = saved;
      setSettings(saved);
      updateSteamUiInjectionSettings(saved);
      refreshStorePatch();
      window.dispatchEvent(new CustomEvent("pohrai-settings-changed"));
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
          <ToggleField
            label="Маркувати ворожих розробників"
            checked={settings.markHostile}
            onChange={(checked) => updateSetting("markHostile", checked)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Маркувати українських розробників"
            checked={settings.markUkrainian}
            onChange={(checked) => updateSetting("markUkrainian", checked)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Показувати бейджі на картках"
            checked={settings.showBadges}
            onChange={(checked) => updateSetting("showBadges", checked)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField
            label="Прозорість бейджа"
            description={`${Math.round(settings.overlayOpacity * 100)}%`}
            value={settings.overlayOpacity}
            min={0.05}
            max={1}
            step={0.05}
            onChange={(value) => updateSetting("overlayOpacity", value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            menuLabel="Колір ворожих проектів"
            rgOptions={COLOR_OPTIONS}
            selectedOption={settings.hostileColor}
            onChange={(option) => updateSetting("hostileColor", option.data as string)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            menuLabel="Колір дружніх проектів"
            rgOptions={COLOR_OPTIONS}
            selectedOption={settings.ukrainianColor}
            onChange={(option) => updateSetting("ukrainianColor", option.data as string)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            menuLabel="Позиція плашки в картці гри"
            rgOptions={POSITION_OPTIONS}
            selectedOption={settings.libraryBadgePosition}
            onChange={(option) => updateSetting("libraryBadgePosition", option.data as PluginSettings["libraryBadgePosition"])}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            menuLabel="Вигляд плашки в картці гри"
            rgOptions={STYLE_OPTIONS}
            selectedOption={settings.libraryBadgeStyle}
            onChange={(option) => updateSetting("libraryBadgeStyle", option.data as PluginSettings["libraryBadgeStyle"])}
          />
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

const fieldStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  width: "100%",
  fontSize: "13px",
} as const;

export default definePlugin(() => {
  console.log("[POHRAI/NE HRAI] initializing");

  const libraryPatch = patchLibraryApp(getResolvedAppStatus, () => activeSettings);
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
