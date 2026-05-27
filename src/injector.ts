import { Router } from "@decky/ui";
import type { AppStatus, InjectionDiagnostics, PluginSettings } from "./types";

type StatusLookup = (appid: string) => Promise<AppStatus>;
type DiagnosticsListener = (diagnostics: InjectionDiagnostics) => void;

const STYLE_ID = "pohrai-ne-hrai-style";
const OVERLAY_CLASS = "pohrai-ne-hrai-overlay";
const BADGE_CLASS = "pohrai-ne-hrai-badge";
const PAGE_BADGE_CLASS = "pohrai-ne-hrai-page-badge";
const SCANNED_ATTR = "data-pohrai-scanned-appid";

let observer: MutationObserver | null = null;
let lookup: StatusLookup | null = null;
let settings: PluginSettings | null = null;
let diagnosticsListener: DiagnosticsListener | null = null;
const pending = new Set<string>();
const statusCache = new Map<string, AppStatus>();
let scanTimer: number | undefined;
let diagnostics: InjectionDiagnostics = {
  scans: 0,
  candidates: 0,
  appids: [],
  marked: 0,
  currentAppid: null,
  lastType: null,
  lastError: null,
};

export function startSteamUiInjection(
  nextLookup: StatusLookup,
  nextSettings: PluginSettings,
  onDiagnostics?: DiagnosticsListener,
): void {
  lookup = nextLookup;
  settings = nextSettings;
  diagnosticsListener = onDiagnostics ?? null;
  injectStyles(nextSettings);
  scanSoon();

  if (!observer) {
    observer = new MutationObserver(() => scanSoon());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "data-ds-appid", "data-app-id", "data-appid", "data-app-id-number"],
    });
  }
}

export function updateSteamUiInjectionSettings(nextSettings: PluginSettings): void {
  settings = nextSettings;
  injectStyles(nextSettings);
  document.querySelectorAll<HTMLElement>(`.${OVERLAY_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll<HTMLElement>(`.${BADGE_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll<HTMLElement>(`[${SCANNED_ATTR}]`).forEach((el) => el.removeAttribute(SCANNED_ATTR));
  scanSoon();
}

export function stopSteamUiInjection(): void {
  observer?.disconnect();
  observer = null;
  lookup = null;
  settings = null;
  diagnosticsListener = null;
  pending.clear();
  statusCache.clear();
  window.clearTimeout(scanTimer);
  document.getElementById(STYLE_ID)?.remove();
  document.querySelectorAll<HTMLElement>(`.${OVERLAY_CLASS}, .${BADGE_CLASS}, .${PAGE_BADGE_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll<HTMLElement>(`[${SCANNED_ATTR}]`).forEach((el) => el.removeAttribute(SCANNED_ATTR));
}

function scanSoon(): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => {
    void scanSteamUi();
  }, 250);
}

async function scanSteamUi(): Promise<void> {
  if (!lookup || !settings) return;

  const candidates = collectCandidates();
  const seenAppids = new Set<string>();
  diagnostics = {
    ...diagnostics,
    scans: diagnostics.scans + 1,
    candidates: candidates.length,
    marked: document.querySelectorAll(`.${OVERLAY_CLASS}, .${PAGE_BADGE_CLASS}`).length,
    lastError: null,
  };

  for (const candidate of candidates) {
    const appid = getAppid(candidate);
    if (!appid || candidate.getAttribute(SCANNED_ATTR) === appid) continue;
    seenAppids.add(appid);

    const container = findCardContainer(candidate);
    if (!container || container.getAttribute(SCANNED_ATTR) === appid) continue;
    container.setAttribute(SCANNED_ATTR, appid);

    const cached = statusCache.get(appid);
    if (cached) {
      applyStatus(container, cached);
      continue;
    }

    if (pending.has(appid)) continue;
    pending.add(appid);
    try {
      const status = await lookup(appid);
      statusCache.set(appid, status);
      applyStatus(container, status);
      diagnostics.lastType = status.type;
    } catch (error) {
      console.warn("[POHRAI/NE HRAI] status lookup failed", appid, error);
      diagnostics.lastError = error instanceof Error ? error.message : String(error);
      container.removeAttribute(SCANNED_ATTR);
    } finally {
      pending.delete(appid);
    }
  }

  await processCurrentAppPage(seenAppids);
  diagnostics.appids = Array.from(seenAppids).slice(0, 12);
  diagnostics.marked = document.querySelectorAll(`.${OVERLAY_CLASS}, .${PAGE_BADGE_CLASS}`).length;
  emitDiagnostics();
}

function collectCandidates(): HTMLElement[] {
  const selectors = [
    "a[href*='/app/']",
    "[data-ds-appid]",
    "[data-app-id]",
    "[data-appid]",
    "[data-app-id-number]",
    "[class*='appportrait']",
    "[class*='libraryassetimage']",
    "[class*='appgrid']",
    "[class*='gamepadhomerecentgames']",
  ];
  return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(",")))
    .filter((el) => !isInsideDecky(el) && !isInsideOverlay(el));
}

function getAppid(el: HTMLElement): string | null {
  const dataAppid =
    el.dataset.dsAppid ||
    el.dataset.appid ||
    el.getAttribute("data-app-id") ||
    el.getAttribute("data-app-id-number") ||
    readAppidFromObject(el);
  const fromData = dataAppid?.split(",")[0]?.trim();
  if (fromData && /^\d+$/.test(fromData)) return fromData;

  const href = (el as HTMLAnchorElement).href || el.getAttribute("href") || "";
  const match = href.match(/\/app\/(\d+)/) || href.match(/[?&#/]appid[=/](\d+)/i);
  return match?.[1] ?? null;
}

function findCardContainer(el: HTMLElement): HTMLElement | null {
  const preferred = el.closest<HTMLElement>(
    "[data-ds-appid], [data-app-id], [data-appid], [data-app-id-number], .appportrait, .basicgamecarousel_CarouselGameLabelWrapper, .libraryassetimage_Container, .gamepadhomerecentgames_RecentGame, .appgrid_AppGridItem, .search_result_row, .wishlist_row, [class*='appportrait'], [class*='libraryassetimage'], [class*='appgrid']"
  );
  if (preferred) return preferred;

  const maxWidth = Math.max(280, window.innerWidth * 0.72);
  let target: HTMLElement = el;
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = target.parentElement;
    if (!parent || parent === document.body) break;
    const width = parent.getBoundingClientRect().width;
    if (width === 0 || width > maxWidth) break;

    const appids = new Set(
      Array.from(parent.querySelectorAll<HTMLElement>("a[href*='/app/'], [data-ds-appid], [data-app-id], [data-appid], [data-app-id-number]"))
        .map(getAppid)
        .filter((appid): appid is string => Boolean(appid))
    );
    if (appids.size > 1) break;
    target = parent;
  }

  return target;
}

function applyStatus(container: HTMLElement, status: AppStatus): void {
  const currentSettings = settings;
  if (!currentSettings || !status.type) return;
  if (status.type === "hostile" && !currentSettings.markHostile) return;
  if (status.type === "ukrainian" && !currentSettings.markUkrainian) return;

  container.querySelectorAll<HTMLElement>(`.${OVERLAY_CLASS}, .${BADGE_CLASS}`).forEach((el) => el.remove());

  const color = status.type === "hostile" ? currentSettings.hostileColor : currentSettings.ukrainianColor;
  const label = status.type === "hostile" ? "NE HRAI" : "POHRAI";
  const title = [...status.matches.hostile, ...status.matches.ukrainian].join(", ");

  const overlay = document.createElement("div");
  overlay.className = `${OVERLAY_CLASS} ${OVERLAY_CLASS}-${status.type}`;
  overlay.style.background = color;
  overlay.style.opacity = String(currentSettings.overlayOpacity);
  overlay.title = title;

  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  container.appendChild(overlay);

  if (currentSettings.showBadges) {
    const badge = document.createElement("div");
    badge.className = `${BADGE_CLASS} ${BADGE_CLASS}-${status.type}`;
    badge.style.background = color;
    badge.textContent = label;
    badge.title = title;
    container.appendChild(badge);
  }
}

async function processCurrentAppPage(seenAppids: Set<string>): Promise<void> {
  const appid = getCurrentAppid();
  diagnostics.currentAppid = appid;
  if (!appid || !lookup) {
    document.querySelectorAll<HTMLElement>(`.${PAGE_BADGE_CLASS}`).forEach((el) => el.remove());
    return;
  }

  seenAppids.add(appid);
  const cached = statusCache.get(appid);
  if (cached) {
    applyPageStatus(cached);
    return;
  }

  if (pending.has(`page:${appid}`)) return;
  pending.add(`page:${appid}`);
  try {
    const status = await lookup(appid);
    statusCache.set(appid, status);
    diagnostics.lastType = status.type;
    applyPageStatus(status);
  } catch (error) {
    diagnostics.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    pending.delete(`page:${appid}`);
  }
}

function applyPageStatus(status: AppStatus): void {
  document.querySelectorAll<HTMLElement>(`.${PAGE_BADGE_CLASS}`).forEach((el) => el.remove());
  const currentSettings = settings;
  if (!currentSettings || !status.type) return;
  if (status.type === "hostile" && !currentSettings.markHostile) return;
  if (status.type === "ukrainian" && !currentSettings.markUkrainian) return;

  const color = status.type === "hostile" ? currentSettings.hostileColor : currentSettings.ukrainianColor;
  const label = status.type === "hostile" ? "NE HRAI" : "POHRAI";
  const matches = [...status.matches.hostile, ...status.matches.ukrainian].join(", ");
  const badge = document.createElement("div");
  badge.className = `${PAGE_BADGE_CLASS} ${PAGE_BADGE_CLASS}-${status.type}`;
  badge.style.background = color;
  badge.style.color = contrastText(color);
  badge.textContent = `${label}${matches ? `: ${matches}` : ""}`;
  badge.title = matches;
  document.body.appendChild(badge);
}

function getCurrentAppid(): string | null {
  const routeText = [
    window.location.href,
    window.location.pathname,
    window.location.hash,
    readFocusedRoute(),
  ].join(" ");
  const routeMatch =
    routeText.match(/\/app\/(\d+)/) ||
    routeText.match(/\/library\/app\/(\d+)/) ||
    routeText.match(/\/game\/(\d+)/) ||
    routeText.match(/[?&#/]appid[=/](\d+)/i);
  if (routeMatch?.[1]) return routeMatch[1];

  const routerAppid = String(Router?.MainRunningApp?.appid || "");
  if (/^\d+$/.test(routerAppid)) return routerAppid;

  return null;
}

function readFocusedRoute(): string {
  try {
    const focused = window.SteamUIStore?.GetFocusedWindowInstance?.();
    const nav = (focused as unknown as { Navigator?: { m_history?: unknown[]; m_location?: unknown } })?.Navigator;
    return JSON.stringify(nav?.m_location ?? nav?.m_history ?? "");
  } catch {
    return "";
  }
}

function readAppidFromObject(el: HTMLElement): string | null {
  const keys = Object.keys(el) as Array<keyof HTMLElement>;
  for (const key of keys) {
    if (!String(key).startsWith("__reactProps$") && !String(key).startsWith("__reactFiber$")) continue;
    const value = el[key] as unknown;
    const appid = findAppidInUnknown(value, 0);
    if (appid) return appid;
  }
  return null;
}

function findAppidInUnknown(value: unknown, depth: number): string | null {
  if (!value || depth > 4) return null;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return null;
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  for (const key of ["appid", "appID", "appId", "unAppID", "nAppID", "app_id"]) {
    const raw = record[key];
    if ((typeof raw === "number" || typeof raw === "string") && /^\d+$/.test(String(raw))) {
      return String(raw);
    }
  }

  for (const child of Object.values(record).slice(0, 30)) {
    const appid = findAppidInUnknown(child, depth + 1);
    if (appid) return appid;
  }
  return null;
}

function injectStyles(currentSettings: PluginSettings): void {
  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${OVERLAY_CLASS} {
      position: absolute;
      inset: 0;
      z-index: 50;
      pointer-events: none;
      border-radius: inherit;
      mix-blend-mode: normal;
    }
    .${BADGE_CLASS} {
      position: absolute;
      top: 6px;
      left: 6px;
      z-index: 51;
      pointer-events: none;
      color: #fff;
      font-size: 10px;
      line-height: 1;
      font-weight: 800;
      letter-spacing: 0;
      padding: 4px 6px;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,.35);
      text-shadow: 0 1px 1px rgba(0,0,0,.45);
    }
    .${BADGE_CLASS}-ukrainian {
      color: ${contrastText(currentSettings.ukrainianColor)};
    }
    .${BADGE_CLASS}-hostile {
      color: ${contrastText(currentSettings.hostileColor)};
    }
    .${PAGE_BADGE_CLASS} {
      position: fixed;
      top: 64px;
      right: 80px;
      z-index: 999999;
      max-width: min(460px, 55vw);
      padding: 8px 10px;
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,.45);
      font-size: 13px;
      line-height: 1.2;
      font-weight: 800;
      letter-spacing: 0;
      pointer-events: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;
  document.head.appendChild(style);
}

function contrastText(hex: string): string {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000";
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? "#1a1a1a" : "#ffffff";
}

function isInsideDecky(el: HTMLElement): boolean {
  return Boolean(el.closest("[class*='quickaccess'], [class*='QuickAccess'], [class*='decky']"));
}

function isInsideOverlay(el: HTMLElement): boolean {
  return Boolean(el.closest(`.${OVERLAY_CLASS}, .${BADGE_CLASS}, .${PAGE_BADGE_CLASS}`));
}

function emitDiagnostics(): void {
  diagnosticsListener?.({ ...diagnostics, appids: [...diagnostics.appids] });
}
