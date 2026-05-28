import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  SliderField,
  DropdownItem,
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
import { t } from "./i18n";

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
  language: "uk",
  showReportButton: true,
  lastSeenHostileCount: 0,
  lastSeenUkrCount: 0,
};

const getAppStatus = callable<[appid: string], AppStatus>("get_app_status");
const getSettings = callable<[], PluginSettings>("get_settings");
const setSetting = callable<[{key: string, value: any}], PluginSettings>("set_setting");
const refreshDatabase = callable<[force: boolean], DatabaseStats>("refresh_database");
const getDatabaseStats = callable<[], DatabaseStats>("get_database_stats");

function getColorOptions(lang: "uk" | "en") {
  return [
    { data: "#e74c3c", label: t(lang, "color_red") },
    { data: "#7a2a2a", label: t(lang, "color_darkred") },
    { data: "#e67e22", label: t(lang, "color_orange") },
    { data: "#f1c40f", label: t(lang, "color_yellow") },
    { data: "#27ae60", label: t(lang, "color_green") },
    { data: "#2980b9", label: t(lang, "color_blue") },
    { data: "#8e44ad", label: t(lang, "color_purple") },
    { data: "#2c3e50", label: t(lang, "color_darkblue") },
    { data: "#bdc3c7", label: t(lang, "color_gray") },
  ];
}

function getPositionOptions(lang: "uk" | "en") {
  return [
    { data: "top-left", label: t(lang, "pos_tl") },
    { data: "top-right", label: t(lang, "pos_tr") },
    { data: "bottom-left", label: t(lang, "pos_bl") },
    { data: "bottom-right", label: t(lang, "pos_br") },
  ];
}

function getStyleOptions(lang: "uk" | "en") {
  return [
    { data: "text", label: t(lang, "style_text") },
    { data: "icon", label: t(lang, "style_icon") },
  ];
}

const BACKEND_TIMEOUT_MS = 5000;
let activeSettings = getLocalSettings();
let fetchedFromPython = false;

function Content() {
  const [settings, setSettings] = useState<PluginSettings>(activeSettings);
  const [isLoaded, setIsLoaded] = useState(fetchedFromPython);
  const [syncing, setSyncing] = useState(false);
  const [db, setDb] = useState<DatabaseStats | null>(null);
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
          setIsLoaded(true);
          saveLocalSettings(merged);
          startSteamUiInjection(getResolvedAppStatus, merged);
        })
        .catch(() => {
          fetchedFromPython = true;
          if (mounted) setIsLoaded(true);
        });
    }

    void withTimeout(getDatabaseStats(), BACKEND_TIMEOUT_MS, "get_database_stats")
      .then((s: any) => {
        if (!mounted) return;
        if (s && s.error) {
          setStatsError(s.error);
        } else {
          setDb(s);
          setStatsError(null);
          
          if (
            s.hostileCount > settings.lastSeenHostileCount || 
            s.ukrainianCount > settings.lastSeenUkrCount
          ) {
            const diffH = Math.max(0, s.hostileCount - (settings.lastSeenHostileCount || 0));
            const diffU = Math.max(0, s.ukrainianCount - (settings.lastSeenUkrCount || 0));
            if (settings.lastSeenHostileCount !== 0) {
              toaster.toast({ 
                title: "POHRAI/NE HRAI", 
                body: t(settings.language, "toast_db_diff", { h: diffH, u: diffU }) 
              });
            }
            updateSetting("lastSeenHostileCount", s.hostileCount);
            updateSetting("lastSeenUkrCount", s.ukrainianCount);
          }
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
    
    saveLocalSettings(next);
    
    setSettings(next);
    updateSteamUiInjectionSettings(next);
    refreshStorePatch();
    window.dispatchEvent(new CustomEvent("pohrai-settings-changed"));
    
    // Auto-save to Python backend in the background
    void setSetting({ key: key as string, value })
      .catch((e) => {
        console.error("Failed to auto-save setting to Python backend", e);
      });
  };

  const forceRefresh = async () => {
    setSyncing(true);
    try {
      const dbStats = await refreshDatabase(true);
      setDb(dbStats);
      refreshStorePatch();
      window.dispatchEvent(new CustomEvent("pohrai-settings-changed"));
      
      let notifiedDiff = false;
      if (
        dbStats.hostileCount > settings.lastSeenHostileCount || 
        dbStats.ukrainianCount > settings.lastSeenUkrCount
      ) {
        const diffH = Math.max(0, dbStats.hostileCount - (settings.lastSeenHostileCount || 0));
        const diffU = Math.max(0, dbStats.ukrainianCount - (settings.lastSeenUkrCount || 0));
        if (settings.lastSeenHostileCount !== 0) {
          toaster.toast({ 
            title: "POHRAI/NE HRAI", 
            body: t(settings.language, "toast_db_diff", { h: diffH, u: diffU }) 
          });
          notifiedDiff = true;
        }
        updateSetting("lastSeenHostileCount", dbStats.hostileCount);
        updateSetting("lastSeenUkrCount", dbStats.ukrainianCount);
      }
      
      if (!notifiedDiff) {
        toaster.toast({ title: "POHRAI/NE HRAI", body: t(settings.language, "toast_db_updated") });
      }
    } finally {
      setSyncing(false);
    }
  };

  const lang = settings.language;

  if (!isLoaded) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <div style={fieldStyle}>{t(lang, "loading")}</div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <>
      <PanelSection title={t(lang, "section_db")}>
        <PanelSectionRow>
          <div style={fieldStyle}>
            {statsError ? (
              <span style={{ color: "#e74c3c" }}>{t(lang, "db_error")}: {statsError}</span>
            ) : db ? (
              <>
                <div>{t(lang, "db_source")}: <strong>{db.source === "bundled" ? t(lang, "db_bundled") : t(lang, "db_remote")}</strong></div>
                <div>{t(lang, "db_version")}: <strong>{db.version}</strong></div>
                <div>{t(lang, "db_hostile_count")}: <strong>{db.hostileCount}</strong></div>
                <div>{t(lang, "db_ukr_count")}: <strong>{db.ukrainianCount}</strong></div>
                {db.lastRemoteError && (
                  <div style={{ color: "#e74c3c", marginTop: "4px" }}>
                    {t(lang, "db_error_sync")}: {db.lastRemoteError}
                  </div>
                )}
              </>
            ) : (
              <span>{t(lang, "loading")}</span>
            )}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={fieldStyle}>
            <ButtonItem layout="below" disabled={syncing} onClick={forceRefresh}>
              {syncing ? t(lang, "loading") : t(lang, "menu_refresh_db")}
            </ButtonItem>
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={t(lang, "section_ui")}>
        <PanelSectionRow>
          <DropdownItem
            menuLabel={t(lang, "menu_language")}
            rgOptions={[
              { data: "uk", label: "Українська" },
              { data: "en", label: "English" },
            ]}
            selectedOption={settings.language}
            onChange={(option) => updateSetting("language", option.data as "uk" | "en")}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label={t(lang, "menu_hostile_dev")}
            checked={settings.markHostile}
            onChange={(checked) => updateSetting("markHostile", checked)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label={t(lang, "menu_ukrainian_dev")}
            checked={settings.markUkrainian}
            onChange={(checked) => updateSetting("markUkrainian", checked)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label={t(lang, "menu_show_badges")}
            checked={settings.showBadges}
            onChange={(checked) => updateSetting("showBadges", checked)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label={t(lang, "menu_show_report")}
            checked={settings.showReportButton}
            onChange={(checked) => updateSetting("showReportButton", checked)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField
            label={t(lang, "menu_overlay_opacity")}
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
            menuLabel={t(lang, "menu_hostile_color")}
            rgOptions={getColorOptions(lang)}
            selectedOption={settings.hostileColor}
            onChange={(option) => updateSetting("hostileColor", option.data as string)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            menuLabel={t(lang, "menu_ukrainian_color")}
            rgOptions={getColorOptions(lang)}
            selectedOption={settings.ukrainianColor}
            onChange={(option) => updateSetting("ukrainianColor", option.data as string)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            menuLabel={t(lang, "menu_badge_position")}
            rgOptions={getPositionOptions(lang)}
            selectedOption={settings.libraryBadgePosition}
            onChange={(option) => updateSetting("libraryBadgePosition", option.data as PluginSettings["libraryBadgePosition"])}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            menuLabel={t(lang, "menu_badge_style")}
            rgOptions={getStyleOptions(lang)}
            selectedOption={settings.libraryBadgeStyle}
            onChange={(option) => updateSetting("libraryBadgeStyle", option.data as PluginSettings["libraryBadgeStyle"])}
          />
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
