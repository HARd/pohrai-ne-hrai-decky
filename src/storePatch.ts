import { callable, fetchNoCors } from "@decky/api";
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
let connectTimeoutId: number | undefined;

const getCefDebuggerUrl = callable<[], string>("get_cef_debugger_url");
const reportGameToPython = callable<[{ url: string; data: any }], boolean>("report_game");

function getBadgePayload(status: AppStatus, settings: PluginSettings) {
  if (!status.type) {
    if (settings.showReportButton) {
      return {
        isReport: true,
        appid: status.appid,
        remoteDatabaseUrl: settings.remoteDatabaseUrl
      };
    }
    return null;
  }
  
  if (status.type === "in_review") {
    return { type: "in_review" as const };
  }
  
  if (!settings.showBadges) return null;
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

    let script = '';

    if (payload.type === "in_review") {
      script = `
        (function() {
          var existing = document.getElementById('pohrai-ne-hrai-store-badge');
          if (existing) existing.remove();

          var badge = document.createElement('div');
          badge.id = 'pohrai-ne-hrai-store-badge';
          badge.textContent = "⏳ На розгляді";
          badge.style.cssText = [
            'position: fixed',
            'left: 22px',
            'bottom: 22px',
            'z-index: 999999',
            'box-sizing: border-box',
            'padding: 8px 16px',
            'border-radius: 8px',
            'border: 1px solid rgba(255,255,255,0.2)',
            'background: rgba(30,30,30,0.85)',
            'backdrop-filter: blur(8px)',
            'box-shadow: 0 10px 28px rgba(0,0,0,0.5)',
            'color: #ccc',
            'font-family: Motiva Sans, Arial, sans-serif',
            'font-size: 14px',
            'font-weight: bold',
            'user-select: none'
          ].join(';');

          document.body.appendChild(badge);
        })();
      `;
    } else if (payload.isReport && payload.remoteDatabaseUrl) {
      script = `
        (function() {
          var existing = document.getElementById('pohrai-ne-hrai-store-badge');
          if (existing) existing.remove();

          var badge = document.createElement('div');
          badge.id = 'pohrai-ne-hrai-store-badge';
          badge.textContent = "⚠️ Report Game";
          badge.style.cssText = [
            'position: fixed',
            'left: 22px',
            'bottom: 22px',
            'z-index: 999999',
            'box-sizing: border-box',
            'padding: 8px 16px',
            'border-radius: 8px',
            'border: 1px solid rgba(255,255,255,0.2)',
            'background: rgba(30,30,30,0.85)',
            'backdrop-filter: blur(8px)',
            'box-shadow: 0 10px 28px rgba(0,0,0,0.5)',
            'color: #ccc',
            'font-family: Motiva Sans, Arial, sans-serif',
            'font-size: 14px',
            'font-weight: bold',
            'cursor: pointer',
            'transition: all 0.2s',
            'user-select: none'
          ].join(';');

          badge.onmouseover = function() {
            badge.style.color = '#fff';
            badge.style.background = 'rgba(50,50,50,0.95)';
            badge.style.transform = 'scale(1.05)';
          };
          badge.onmouseout = function() {
            badge.style.color = '#ccc';
            badge.style.background = 'rgba(30,30,30,0.85)';
            badge.style.transform = 'scale(1)';
          };

          badge.onclick = function() {
            if (badge.dataset.sent === "1") return;
            badge.textContent = "⏳ Sending...";
            
            var appName = document.querySelector('.apphub_AppName');
            var name = appName ? appName.textContent.trim() : "Unknown";
            
            var devNodes = document.querySelectorAll('.dev_row a');
            var devs = [];
            devNodes.forEach(function(n) { devs.push(n.textContent.trim()); });
            var developer = devs.join(", ") || "Unknown";
            
            var url = ${JSON.stringify(payload.remoteDatabaseUrl)};
            if (!url.endsWith("/")) url += "/";
            url += "reports.json";
            
            var data = {
              appid: ${JSON.stringify(payload.appid)},
              name: name.substring(0, 199),
              developer: developer.substring(0, 199),
              timestamp: Date.now()
            };
            
            console.debug("POHRAI_REPORT:" + JSON.stringify({ url: url, data: data }));
          };

          document.body.appendChild(badge);
        })();
      `;
    } else {
      script = `
        (function() {
          var existing = document.getElementById('pohrai-ne-hrai-store-badge');
          if (existing) existing.remove();

          var badge = document.createElement('div');
          badge.id = 'pohrai-ne-hrai-store-badge';
          badge.textContent = ${JSON.stringify(payload.label)};
          badge.style.cssText = [
            'position: fixed',
            'left: 22px',
            'bottom: 22px',
            'z-index: 999999',
            'box-sizing: border-box',
            'max-width: min(360px, calc(100vw - 44px))',
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
    }
    
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
    const debuggerUrl = await getCefDebuggerUrl().catch(() => "http://localhost:8080/json");
    const response = await fetchNoCors(debuggerUrl);
    const tabs = (await response.json()) as SteamWebTab[];
    const storeTab = tabs.find((tab) => tab.url.includes("store.steampowered.com"));

    if (!storeTab) {
      connectTimeoutId = window.setTimeout(() => void connectToStoreDebugger(retries - 1), 1000);
      return;
    }

    if (storeWebSocket) {
      storeWebSocket.onclose = null;
      storeWebSocket.close();
      storeWebSocket = null;
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
        } else if (data?.method === "Runtime.consoleAPICalled") {
          const args = data?.params?.args;
          if (args && args.length > 0 && args[0].type === "string" && args[0].value.startsWith("POHRAI_REPORT:")) {
            try {
              const payload = JSON.parse(args[0].value.substring(14));
              reportGameToPython(payload).then((success) => {
                evaluateInStore(`console.log("POHRAI_REPLY received:", ${success});`);
                if (success) {
                  evaluateInStore(`
                    var b = document.getElementById('pohrai-ne-hrai-store-badge');
                    if (b) {
                      b.textContent = "✅ Sent!";
                      b.dataset.sent = "1";
                      b.style.background = 'rgba(39, 174, 96, 0.85)';
                      setTimeout(function() {
                        b.style.opacity = '0';
                        setTimeout(function() { b.remove(); }, 500);
                      }, 2000);
                    }
                  `);
                } else {
                  evaluateInStore(`
                    var b = document.getElementById('pohrai-ne-hrai-store-badge');
                    if (b) {
                      b.textContent = "❌ Error";
                      setTimeout(function() { b.textContent = "⚠️ Report Game"; }, 2000);
                    }
                  `);
                }
              }).catch(() => {
                evaluateInStore(`
                  var b = document.getElementById('pohrai-ne-hrai-store-badge');
                  if (b) {
                    b.textContent = "❌ Error";
                    setTimeout(function() { b.textContent = "⚠️ Report Game"; }, 2000);
                  }
                `);
              });
            } catch (e) {
              console.error("Failed to parse report payload", e);
            }
          }
        }
      } catch {
        // Ignore debugger messages that are not JSON payloads we care about.
      }
    };

    storeWebSocket.onerror = () => {
      if (isStoreMounted) {
        connectTimeoutId = window.setTimeout(() => void connectToStoreDebugger(retries - 1), 1000);
      }
    };

    storeWebSocket.onclose = () => {
      storeWebSocket = null;
      wsReady = false;
      if (isStoreMounted) {
        connectTimeoutId = window.setTimeout(() => void connectToStoreDebugger(retries), 1000);
      }
    };
  } catch {
    if (isStoreMounted) {
      connectTimeoutId = window.setTimeout(() => void connectToStoreDebugger(retries - 1), 1000);
    }
  }
}

function disconnectStoreDebugger() {
  removeBadgeFromStore();
  isStoreMounted = false;
  wsReady = false;
  currentAppid = "";

  if (connectTimeoutId) {
    window.clearTimeout(connectTimeoutId);
    connectTimeoutId = undefined;
  }

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

export function initStorePatch(lookup: Lookup, settingsGetter: SettingsGetter) {
  currentLookup = lookup;
  currentSettingsGetter = settingsGetter;

  if (historyUnlisten) {
    historyUnlisten();
  }
  if (connectTimeoutId !== undefined) {
    window.clearTimeout(connectTimeoutId);
    connectTimeoutId = undefined;
  }

  isStoreMounted = true;
  handleLocationChange(History.location?.pathname || "");
  historyUnlisten = History.listen((info: { pathname: string }) => {
    handleLocationChange(info.pathname);
  });

  return () => {
    if (historyUnlisten) {
      historyUnlisten();
      historyUnlisten = null;
    }
    if (connectTimeoutId !== undefined) {
      window.clearTimeout(connectTimeoutId);
      connectTimeoutId = undefined;
    }
    disconnectStoreDebugger();
    currentLookup = null;
    currentSettingsGetter = null;
  };
}
