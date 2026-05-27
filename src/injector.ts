import type { AppStatus, PluginSettings } from "./types";

type StatusLookup = (appid: string) => Promise<AppStatus>;

const STYLE_ID = "pohrai-ne-hrai-style";
const OVERLAY_CLASS = "pohrai-ne-hrai-overlay";
const BADGE_CLASS = "pohrai-ne-hrai-badge";
const SCANNED_ATTR = "data-pohrai-scanned-appid";

let observer: MutationObserver | null = null;
let lookup: StatusLookup | null = null;
let settings: PluginSettings | null = null;
const pending = new Set<string>();
const statusCache = new Map<string, AppStatus>();
let scanTimer: number | undefined;

export function startSteamUiInjection(nextLookup: StatusLookup, nextSettings: PluginSettings): void {
  lookup = nextLookup;
  settings = nextSettings;
  injectStyles(nextSettings);
  scanSoon();

  if (!observer) {
    observer = new MutationObserver(() => scanSoon());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "data-ds-appid", "data-app-id", "data-appid"],
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
  pending.clear();
  statusCache.clear();
  window.clearTimeout(scanTimer);
  document.getElementById(STYLE_ID)?.remove();
  document.querySelectorAll<HTMLElement>(`.${OVERLAY_CLASS}, .${BADGE_CLASS}`).forEach((el) => el.remove());
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
  for (const candidate of candidates) {
    const appid = getAppid(candidate);
    if (!appid || candidate.getAttribute(SCANNED_ATTR) === appid) continue;

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
    } catch (error) {
      console.warn("[POHRAI/NE HRAI] status lookup failed", appid, error);
      container.removeAttribute(SCANNED_ATTR);
    } finally {
      pending.delete(appid);
    }
  }
}

function collectCandidates(): HTMLElement[] {
  const selectors = [
    "a[href*='/app/']",
    "[data-ds-appid]",
    "[data-app-id]",
    "[data-appid]",
  ];
  return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(",")))
    .filter((el) => !isInsideDecky(el) && !isInsideOverlay(el));
}

function getAppid(el: HTMLElement): string | null {
  const dataAppid = el.dataset.dsAppid || el.dataset.appid || el.getAttribute("data-app-id");
  const fromData = dataAppid?.split(",")[0]?.trim();
  if (fromData && /^\d+$/.test(fromData)) return fromData;

  const href = (el as HTMLAnchorElement).href || el.getAttribute("href") || "";
  const match = href.match(/\/app\/(\d+)/);
  return match?.[1] ?? null;
}

function findCardContainer(el: HTMLElement): HTMLElement | null {
  const preferred = el.closest<HTMLElement>(
    "[data-ds-appid], [data-app-id], [data-appid], .appportrait, .basicgamecarousel_CarouselGameLabelWrapper, .libraryassetimage_Container, .gamepadhomerecentgames_RecentGame, .appgrid_AppGridItem, .search_result_row, .wishlist_row"
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
      Array.from(parent.querySelectorAll<HTMLElement>("a[href*='/app/'], [data-ds-appid], [data-app-id], [data-appid]"))
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
  return Boolean(el.closest(`.${OVERLAY_CLASS}, .${BADGE_CLASS}`));
}
