import { fetchNoCors } from "@decky/api";
import { findModuleExport } from "@decky/ui";
import type { AppStatus, PluginSettings } from "./types";

type Lookup = (appid: string) => Promise<AppStatus>;
type SettingsGetter = () => PluginSettings;

interface SteamWebTab {
  id: string;
  url: string;
  webSocketDebuggerUrl: string;
}

const HistoryModule = findModuleExport((exp: any) => exp?.m_history !== undefined);
const History = HistoryModule?.m_history;

let isStoreMounted = false;
let storeWebSocket: WebSocket | null = null;
let historyUnlisten: (() => void) | null = null;
let wsReady = false;
let messageId = 1;
let currentAppid = "";
let currentLookup: Lookup | null = null;
let currentSettingsGetter: SettingsGetter | null = null;

function getBadgePayload(status: AppStatus, settings: PluginSettings) {
  if (!settings.showBadges || !status.type) return null;
  if (status.type === "hostile" && !settings.markHostile) return null;
  if (status.type === "ukrainian" && !settings.markUkrainian) return null;

  const isHostile = status.type === "hostile";
  return {
    label: isHostile ? "Ворожий проект" : "Дружній проект",
    background: isHostile ? settings.hostileColor : settings.ukrainianColor,
    border: isHostile ? "rgba(255, 190, 190, .65)" : "rgba(200, 255, 220, .65)",
    shadow: isHostile ? "rgba(122, 42, 42, .45)" : "rgba(39, 174, 96, .38)",
  };
}

function evaluateInStore(expression: string) {
  if (!storeWebSocket || storeWebSocket.readyState !== WebSocket.OPEN || !wsReady) {
    return;
  }

  storeWebSocket.send(JSON.stringify({
    id: messageId++,
    method: "Runtime.evaluate",
    params: { expression },
  }));
}

function removeBadgeFromStore() {
  evaluateInStore(`
    (function() {
      var badge = document.getElementById('pohrai-ne-hrai-store-badge');
      if (badge) badge.remove();
    })();
  `);
}

async function injectBadgeIntoStore(appid: string) {
  if (!currentLookup || !currentSettingsGetter) return;
  if (!storeWebSocket || storeWebSocket.readyState !== WebSocket.OPEN || !wsReady) return;

  try {
    const status = await currentLookup(appid);
    const payload = getBadgePayload(status, currentSettingsGetter());
    if (!payload) {
      removeBadgeFromStore();
      return;
    }

    const script = `
      (function() {
        var existing = document.getElementById('pohrai-ne-hrai-store-badge');
        if (existing) existing.remove();

        var badge = document.createElement('div');
        badge.id = 'pohrai-ne-hrai-store-badge';
        badge.textContent = ${JSON.stringify(payload.label)};
        badge.style.cssText = [
          'position: fixed',
          'left: 50%',
          'bottom: 22px',
          'transform: translateX(-50%)',
          'z-index: 999999',
          'box-sizing: border-box',
          'max-width: calc(100vw - 48px)',
          'padding: 8px 16px',
          'border-radius: 8px',
          'border: 1px solid ${payload.border}',
          'background: ${payload.background}',
          'box-shadow: 0 10px 28px ${payload.shadow}',
          'color: #fff',
          'font-family: Motiva Sans, Arial, sans-serif',
          'font-size: 18px',
          'font-weight: 800',
          'line-height: 22px',
          'letter-spacing: 0',
          'text-align: center',
          'white-space: normal',
          'overflow-wrap: anywhere',
          'pointer-events: none'
        ].join(';');

        document.body.appendChild(badge);
      })();
    `;
    evaluateInStore(script);
  } catch (error) {
    removeBadgeFromStore();
  }
}

function extractAppIdFromUrl(url: string): string {
  if (!url.includes("store.steampowered.com/app/")) return "";
  const match = url.match(/\/app\/(\d+)\/?/);
  return match?.[1] ?? "";
}

function updateAppIdFromUrl(url: string) {
  const appid = extractAppIdFromUrl(url);
  if (currentAppid === appid) return;

  currentAppid = appid;
  if (appid) {
    void injectBadgeIntoStore(appid);
  } else {
    removeBadgeFromStore();
  }
}

async function connectToStoreDebugger(retries = 5): Promise<void> {
  if (retries <= 0 || !isStoreMounted) return;

  try {
    const response = await fetchNoCors("http://localhost:8080/json");
    const tabs = (await response.json()) as SteamWebTab[];
    const storeTab = tabs.find((tab) => tab.url.includes("store.steampowered.com"));

    if (!storeTab) {
      window.setTimeout(() => void connectToStoreDebugger(retries - 1), 1000);
      return;
    }

    updateAppIdFromUrl(storeTab.url);
    storeWebSocket = new WebSocket(storeTab.webSocketDebuggerUrl);

    storeWebSocket.onopen = (event) => {
      const ws = event.target as WebSocket;
      ws.send(JSON.stringify({ id: messageId++, method: "Page.enable" }));
      ws.send(JSON.stringify({ id: messageId++, method: "Runtime.enable" }));

      window.setTimeout(() => {
        wsReady = true;
        if (currentAppid) {
          void injectBadgeIntoStore(currentAppid);
        }
      }, 300);
    };

    storeWebSocket.onmessage = (event) => {
      if (!isStoreMounted) return;
      try {
        const data = JSON.parse(event.data);
        const url = data?.params?.frame?.url;
        if (data?.method === "Page.frameNavigated" && typeof url === "string") {
          window.setTimeout(() => updateAppIdFromUrl(url), 500);
        }
      } catch {
        // Ignore debugger messages that are not JSON payloads we care about.
      }
    };

    storeWebSocket.onerror = () => {
      if (isStoreMounted) {
        window.setTimeout(() => void connectToStoreDebugger(retries - 1), 1000);
      }
    };

    storeWebSocket.onclose = () => {
      storeWebSocket = null;
      wsReady = false;
      if (isStoreMounted) {
        window.setTimeout(() => void connectToStoreDebugger(retries), 1000);
      }
    };
  } catch {
    if (isStoreMounted) {
      window.setTimeout(() => void connectToStoreDebugger(retries - 1), 1000);
    }
  }
}

function disconnectStoreDebugger() {
  removeBadgeFromStore();
  isStoreMounted = false;
  wsReady = false;
  currentAppid = "";

  if (storeWebSocket) {
    storeWebSocket.close();
    storeWebSocket = null;
  }
}

function handleLocationChange(pathname: string) {
  if (pathname === "/steamweb") {
    isStoreMounted = true;
    void connectToStoreDebugger();
  } else if (isStoreMounted) {
    disconnectStoreDebugger();
  }
}

export function refreshStorePatch() {
  if (currentAppid) {
    void injectBadgeIntoStore(currentAppid);
  }
}

export function initStorePatch(lookup: Lookup, getSettings: SettingsGetter): () => void {
  currentLookup = lookup;
  currentSettingsGetter = getSettings;

  if (!History) {
    return () => {};
  }

  handleLocationChange(History.location?.pathname || "");
  historyUnlisten = History.listen((info: { pathname: string }) => {
    handleLocationChange(info.pathname);
  });

  return () => {
    if (historyUnlisten) {
      historyUnlisten();
      historyUnlisten = null;
    }
    disconnectStoreDebugger();
    currentLookup = null;
    currentSettingsGetter = null;
  };
}
