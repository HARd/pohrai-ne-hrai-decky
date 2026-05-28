export type MarkType = "hostile" | "ukrainian" | null;

export interface PluginSettings {
  markHostile: boolean;
  markUkrainian: boolean;
  hostileColor: string;
  ukrainianColor: string;
  overlayOpacity: number;
  showBadges: boolean;
  remoteDatabaseEnabled: boolean;
  remoteDatabaseUrl: string;
  libraryBadgePosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  libraryBadgeStyle: "text" | "icon";
}

export interface AppStatus {
  appid: string;
  type: MarkType;
  developers: string[];
  publishers: string[];
  matches: {
    hostile: string[];
    ukrainian: string[];
  };
}

export interface DatabaseStats {
  version: string;
  hostileCount: number;
  ukrainianCount: number;
  cacheCount: number;
  source: "bundled" | "remote";
  remoteUrl?: string;
  lastRemoteError?: string | null;
}

export interface SearchResults {
  hostile: string[];
  ukrainian: string[];
}

export interface InjectionDiagnostics {
  scans: number;
  candidates: number;
  appids: string[];
  marked: number;
  currentAppid: string | null;
  lastType: MarkType;
  lastError: string | null;
  route: string;
}
