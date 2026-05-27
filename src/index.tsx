import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import {
  callable,
  definePlugin,
  toaster,
} from "@decky/api";
import { useEffect, useState } from "react";
import { FaFlag } from "react-icons/fa";
import {
  startSteamUiInjection,
  stopSteamUiInjection,
  updateSteamUiInjectionSettings,
} from "./injector";
import type { AppStatus, DatabaseStats, PluginSettings, SearchResults } from "./types";

const DEFAULT_SETTINGS: PluginSettings = {
  markHostile: true,
  markUkrainian: true,
  hostileColor: "#7a2a2a",
  ukrainianColor: "#27ae60",
  overlayOpacity: 0.35,
  showBadges: true,
};

const getAppStatus = callable<[appid: string], AppStatus>("get_app_status");
const getSettings = callable<[], PluginSettings>("get_settings");
const saveSettings = callable<[settings: PluginSettings], PluginSettings>("save_settings");
const getDatabaseStats = callable<[], DatabaseStats>("get_database_stats");
const searchDatabase = callable<[query: string, limit?: number], SearchResults>("search_database");

function Content() {
  const [settings, setSettings] = useState<PluginSettings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ hostile: [], ukrainian: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    void Promise.all([getSettings(), getDatabaseStats()]).then(([loadedSettings, loadedStats]) => {
      if (!mounted) return;
      const merged = { ...DEFAULT_SETTINGS, ...loadedSettings };
      setSettings(merged);
      setStats(loadedStats);
      updateSteamUiInjectionSettings(merged);
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
      void searchDatabase(query, 12).then(setResults);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const updateSetting = <K extends keyof PluginSettings>(key: K, value: PluginSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    updateSteamUiInjectionSettings(next);
  };

  const persistSettings = async () => {
    setSaving(true);
    try {
      const saved = await saveSettings(settings);
      setSettings(saved);
      updateSteamUiInjectionSettings(saved);
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
              <span>NE HRAI</span>
              <input
                type="color"
                value={settings.hostileColor}
                onChange={(event) => updateSetting("hostileColor", event.currentTarget.value)}
              />
            </label>
            <label style={fieldStyle}>
              <span>POHRAI</span>
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

      <PanelSection title="База">
        <PanelSectionRow>
          <div style={mutedStyle}>
            {stats
              ? `Версія ${stats.version}: ${stats.ukrainianCount} українських, ${stats.hostileCount} ворожих, кеш ${stats.cacheCount}`
              : "Завантаження бази..."}
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
          <ResultList title="POHRAI" items={results.ukrainian} color={settings.ukrainianColor} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ResultList title="NE HRAI" items={results.hostile} color={settings.hostileColor} />
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

  void getSettings().then((loadedSettings) => {
    const merged = { ...DEFAULT_SETTINGS, ...loadedSettings };
    startSteamUiInjection(getAppStatus, merged);
  });

  return {
    name: "POHRAI/NE HRAI",
    titleView: <div className={staticClasses.Title}>POHRAI/NE HRAI</div>,
    content: <Content />,
    icon: <FaFlag />,
    onDismount() {
      stopSteamUiInjection();
    },
  };
});
